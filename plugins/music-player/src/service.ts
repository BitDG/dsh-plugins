import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ResolvedConfig } from './config.ts'
import { staticPolicy, normalizeDescriptor } from './policy.ts'
import { IsolatedPluginRunner } from './runner.ts'
import { fetchTrustedMedia } from './media-proxy.ts'
import { createTrustedProviders, type TrustedMediaSource, type TrustedProvider } from './trusted-providers.ts'
import type { GenerationJob, MediaSource, MusicItem, PluginDescriptor, ReviewResult } from './types.ts'

type InstalledPlugin = { descriptor: PluginDescriptor; code: string }

export class MusicService {
  readonly runner: IsolatedPluginRunner
  private readonly installed = new Map<string, InstalledPlugin>()
  private readonly trusted: Map<string, TrustedProvider>
  private readonly mediaTickets = new Map<string, { source: TrustedMediaSource; expiresAt: number }>()
  private readonly reviews = new Map<string, ReviewResult>()
  private readonly reviewCode = new Map<string, string>()
  private readonly jobs = new Map<string, GenerationJob>()
  private readonly reviewsRoot: string
  private readonly installedRoot: string
  private readonly generationsRoot: string

  constructor(readonly config: ResolvedConfig, trustedProviders?: Map<string, TrustedProvider>) {
    this.runner = new IsolatedPluginRunner(config)
    this.reviewsRoot = join(config.storageRoot, 'reviews')
    this.installedRoot = join(config.storageRoot, 'installed')
    this.generationsRoot = join(config.storageRoot, 'generations')
    this.trusted = trustedProviders ?? createTrustedProviders(config)
    for (const directory of [config.storageRoot, this.reviewsRoot, this.installedRoot, this.generationsRoot]) mkdirSync(directory, { recursive: true })
    this.loadInstalled()
  }

  plugins(): PluginDescriptor[] {
    const dynamic = [...this.installed.values()].filter(item => !this.trusted.has(item.descriptor.id)).map(item => item.descriptor)
    return [...this.trusted.values()].map(item => item.descriptor).concat(dynamic)
  }

  async search(pluginId: string, query: string, page = 1): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const trusted = this.trusted.get(pluginId)
    if (trusted !== undefined) {
      const result = await trusted.search(query.slice(0, 120), Math.max(1, Math.min(50, page)))
      const data = result.data.slice(0, 50).map(item => this.musicItem(item, trusted.descriptor.platform))
      return { isEnd: result.isEnd, data }
    }
    const plugin = this.plugin(pluginId)
    const value = await this.runner.run(plugin.code, 'search', [query.slice(0, 120), Math.max(1, Math.min(50, page)), 'music'], plugin.descriptor.allowedHosts)
    if (value === null || typeof value !== 'object') throw new Error('search returned an invalid result')
    const raw = value as { isEnd?: unknown; data?: unknown }
    if (!Array.isArray(raw.data)) throw new Error('search.data must be an array')
    const data = raw.data.slice(0, 50).map(item => this.musicItem(item, plugin.descriptor.platform))
    return { isEnd: raw.isEnd !== false, data }
  }

  async media(pluginId: string, item: MusicItem, quality = 'standard'): Promise<MediaSource> {
    const trusted = this.trusted.get(pluginId)
    if (trusted !== undefined) {
      const source = await trusted.media(this.musicItem(item, trusted.descriptor.platform), quality)
      const url = new URL(source.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Trusted media source must use HTTP or HTTPS')
      const ticket = randomUUID()
      this.mediaTickets.set(ticket, { source: { ...source, url: url.toString() }, expiresAt: Date.now() + 30 * 60 * 1000 })
      return { url: `/api/dship/music/stream/${ticket}` }
    }
    const plugin = this.plugin(pluginId)
    const value = await this.runner.run(plugin.code, 'getMediaSource', [item, quality], plugin.descriptor.allowedHosts)
    if (value === null || typeof value !== 'object' || typeof (value as MediaSource).url !== 'string') throw new Error('getMediaSource must return { url }')
    const source = value as MediaSource
    const url = new URL(source.url)
    if (!['http:', 'https:'].includes(url.protocol) || !plugin.descriptor.allowedHosts.includes(url.hostname.toLowerCase())) throw new Error(`Media source host is undeclared: ${url.hostname}`)
    if (source.headers !== undefined && Object.keys(source.headers).length > 0) throw new Error('Browser PoC does not install sources that require custom playback headers')
    return { url: url.toString() }
  }

  async stream(ticket: string, range?: string): Promise<Response> {
    if (!/^[0-9a-f-]{36}$/.test(ticket)) throw new Error('Invalid media ticket')
    const now = Date.now()
    for (const [id, entry] of this.mediaTickets) if (entry.expiresAt <= now) this.mediaTickets.delete(id)
    const entry = this.mediaTickets.get(ticket)
    if (entry === undefined) throw new Error('Media ticket is missing or expired')
    return fetchTrustedMedia(entry.source, range, Math.max(this.config.requestTimeoutMs, 15_000))
  }

  async review(code: string): Promise<ReviewResult> {
    const id = randomUUID(); const createdAt = Date.now()
    const checks = staticPolicy(code, this.config.maxPluginBytes)
    let descriptor: PluginDescriptor | undefined
    if (checks.every(check => check.ok)) {
      try {
        const inspected = await this.runner.run(code, 'inspect', [], [])
        descriptor = normalizeDescriptor(inspected)
        checks.push({ name: 'musicfree-contract', ok: true, detail: `${descriptor.platform} ${descriptor.version}; search + getMediaSource` })
      } catch (error) { checks.push({ name: 'musicfree-contract', ok: false, detail: error instanceof Error ? error.message : String(error) }) }
    }
    const codePath = join(this.reviewsRoot, `${id}.js`)
    const result: ReviewResult = { id, accepted: checks.every(check => check.ok), createdAt, ...(descriptor === undefined ? {} : { descriptor }), codePath, checks }
    writeFileSync(codePath, code, { encoding: 'utf8', flag: 'wx' })
    writeFileSync(join(this.reviewsRoot, `${id}.json`), JSON.stringify(result, null, 2), { encoding: 'utf8', flag: 'wx' })
    this.reviews.set(id, result); this.reviewCode.set(id, code)
    return result
  }

  install(reviewId: string, confirmed: boolean): PluginDescriptor {
    if (!confirmed) throw new Error('Explicit install confirmation is required')
    const review = this.reviews.get(reviewId) ?? this.readReview(reviewId)
    const code = this.reviewCode.get(reviewId) ?? (review.codePath === undefined ? undefined : readFileSync(review.codePath, 'utf8'))
    if (!review.accepted || review.descriptor === undefined || code === undefined) throw new Error('Only an accepted review can be installed')
    const descriptor = { ...review.descriptor, installed: true, builtin: false }
    const codePath = join(this.installedRoot, `${descriptor.id}.js`); const manifestPath = join(this.installedRoot, `${descriptor.id}.json`)
    const tempCode = `${codePath}.${review.id}.tmp`; const tempManifest = `${manifestPath}.${review.id}.tmp`
    writeFileSync(tempCode, code, 'utf8'); writeFileSync(tempManifest, JSON.stringify(descriptor, null, 2), 'utf8')
    renameSync(tempCode, codePath); renameSync(tempManifest, manifestPath)
    this.installed.set(descriptor.id, { descriptor, code })
    return descriptor
  }

  createGeneration(input: { sourceUrl: string; query: string; author: string; authorized: boolean }): GenerationJob {
    if (!input.authorized) throw new Error('Confirm that you are authorized to adapt this source')
    const source = new URL(input.sourceUrl)
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('sourceUrl must use HTTP or HTTPS')
    const id = randomUUID(); const directory = join(this.generationsRoot, id); mkdirSync(directory, { recursive: false })
    const outputPath = join(directory, 'plugin.js')
    const prompt = [
      'Use the musicfree-plugin-dev skill to generate one MusicFree JavaScript plugin for the source below.',
      `Source: ${source.toString()}`,
      `Author: ${input.author.trim().slice(0, 80) || 'DSHP user'}`,
      `Acceptance query: ${input.query.trim().slice(0, 80) || 'music'}`,
      'Implement platform, version, author, description, allowedHosts, userVariables, supportedSearchType, async search(query,page,type), and async getMediaSource(musicItem,quality).',
      'Use only global fetch and browser-standard URL APIs. Do not use require/import/process/fs/child_process/eval/Function or prototype tricks. Declare every exact network hostname in allowedHosts.',
      'Only adapt sources the user is authorized to access. Do not bypass login, paywalls, DRM, signatures, or anti-bot controls.',
      `Write only the final CommonJS plugin to this exact path: ${outputPath}`,
    ].join('\n')
    const job: GenerationJob = { id, createdAt: Date.now(), sourceUrl: source.toString(), query: input.query.trim().slice(0, 80) || 'music', author: input.author.trim().slice(0, 80) || 'DSHP user', status: 'waiting-for-ai', prompt, directory, outputPath }
    writeFileSync(join(directory, 'spec.json'), JSON.stringify({ id, sourceUrl: job.sourceUrl, query: job.query, author: job.author, authorized: true, outputPath }, null, 2), 'utf8')
    writeFileSync(join(directory, 'prompt.md'), `${prompt}\n`, 'utf8')
    this.jobs.set(id, job)
    return job
  }

  async generation(id: string): Promise<GenerationJob> {
    const job = this.jobs.get(id)
    if (job === undefined) throw new Error('Generation job not found')
    if (job.status === 'waiting-for-ai' && existsSync(job.outputPath)) {
      job.status = 'reviewing'
      try { job.review = await this.review(readFileSync(job.outputPath, 'utf8')); job.status = 'reviewed' }
      catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error) }
    }
    return job
  }

  private plugin(id: string): InstalledPlugin {
    const plugin = this.installed.get(id)
    if (plugin === undefined) throw new Error(`Music plugin is not installed: ${id}`)
    return plugin
  }

  private musicItem(value: unknown, platform: string): MusicItem {
    if (value === null || typeof value !== 'object') throw new Error('Search item must be an object')
    const raw = value as Record<string, unknown>
    if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.title !== 'string' || typeof raw.artist !== 'string') throw new Error('Search item requires string id, title, and artist')
    const publishedAt = typeof raw.publishedAt === 'string' && Number.isFinite(Date.parse(raw.publishedAt)) ? new Date(raw.publishedAt).toISOString() : undefined
    const publishedLabel = typeof raw.publishedLabel === 'string' ? raw.publishedLabel.slice(0, 40) : undefined
    return { ...raw, id: raw.id.slice(0, 300), title: raw.title.slice(0, 300), artist: raw.artist.slice(0, 300), platform, ...(publishedAt === undefined ? {} : { publishedAt }), ...(publishedLabel === undefined ? {} : { publishedLabel }) }
  }

  private readReview(id: string): ReviewResult {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid review id')
    const path = join(this.reviewsRoot, `${id}.json`)
    if (!existsSync(path)) throw new Error('Review not found')
    const review = JSON.parse(readFileSync(path, 'utf8')) as ReviewResult
    this.reviews.set(id, review)
    return review
  }

  private loadInstalled(): void {
    for (const name of readdirSync(this.installedRoot)) {
      if (!name.endsWith('.json')) continue
      try {
        const descriptor = JSON.parse(readFileSync(join(this.installedRoot, name), 'utf8')) as PluginDescriptor
        const code = readFileSync(join(this.installedRoot, `${basename(name, '.json')}.js`), 'utf8')
        this.installed.set(descriptor.id, { descriptor, code })
      } catch { /* Ignore incomplete or invalid user-installed pairs. */ }
    }
  }
}
