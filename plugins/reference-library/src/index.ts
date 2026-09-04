import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import {
  canonicalGitHubRepositoryUrl,
  type ReferenceCatalogResponse,
  type ReferenceKind,
  type ReferenceRecord,
} from './shared.ts'
import { resolveOnlineConfig } from './online/config.ts'
import { OnlineReferenceService } from './online/service.ts'
import { mountWebApi as mountOnlineWebApi } from './online/web-api.ts'
import {
  REFERENCE_LIBRARY_SETTINGS_NAMESPACE,
  type ReferenceLibrarySettings,
} from './settings-contract.ts'

export const name = 'dship-reference-library'
export const inject = ['webServer', 'connection']
export const CATALOG_ENDPOINT = '/api/dship/reference-library/catalog'
export const REQUEST_ENDPOINT = '/api/dship/reference-library/requests'
export const CODEPEN_POSTER_ENDPOINT = '/api/dship/reference-library/codepen-poster'
export const CODEPEN_PREVIEW_ENDPOINT = '/api/dship/reference-library/codepen-preview'

export interface Config extends ReferenceLibrarySettings {
  /** Root containing catalog/index.json, cards/, Res/, and inbox/requests/. */
  readonly libraryRoot?: string
}

/** Configuration schema shared with the Host settings namespace. */
export const Config: Schema<Config> = Schema.object({
  libraryRoot: Schema.string(),
  pinterestDefaultQuery: Schema.string().default('design inspiration'),
  // Keep legacy 1–29 values schema-valid so resolveOnlineConfig can migrate
  // them to the new 30-card runtime minimum during an in-place upgrade.
  pinterestResultLimit: Schema.number().step(1).min(1).max(50).default(30),
  zlibraryDomain: Schema.string(),
  zlibraryDefaultQuery: Schema.string().default('design'),
  zlibraryRequestTimeoutMs: Schema.number().min(2_000).max(30_000).default(15_000),
  zlibraryResultLimit: Schema.number().step(1).min(1).max(20).default(10),
})

type HostContext = Context & {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
    }): () => void
  }
  connection: { requestRejection(req: IncomingMessage): 401 | 403 | undefined }
}

interface RawRecord {
  readonly id?: unknown
  readonly kind?: unknown
  readonly title?: unknown
  readonly category?: unknown
  readonly summary?: unknown
  readonly useFor?: unknown
  readonly tags?: unknown
  readonly localPath?: unknown
  readonly entryPoints?: unknown
  readonly card?: unknown
  readonly source?: unknown
  readonly license?: unknown
}

interface RawCatalog { readonly records?: unknown }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function reply(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function replySvg(res: ServerResponse, status: number, value: string): void {
  res.writeHead(status, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'private, max-age=300',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
  })
  res.end(value)
}

const PREVIEW_MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function replyPreview(res: ServerResponse, path: string, value: Buffer): void {
  res.writeHead(200, {
    'content-type': PREVIEW_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'private, max-age=60',
    'content-security-policy': "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; media-src 'self' https: data: blob:; connect-src 'self' https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
  })
  res.end(value)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function posterLines(value: string): readonly string[] {
  const chars = Array.from(value.trim())
  return [chars.slice(0, 22).join(''), chars.slice(22, 44).join('')].filter(Boolean)
}

function posterPalette(category: string): readonly [string, string, string] {
  const key = category.toLowerCase()
  if (key.includes('game')) return ['#161a2e', '#6c7cff', '#f3c969']
  if (key.includes('webgl') || key.includes('shader')) return ['#121b22', '#45c4b0', '#8f7cff']
  if (key.includes('css') || key.includes('typography')) return ['#231a1e', '#ff7a90', '#ffd37a']
  if (key.includes('interactive')) return ['#142026', '#45b8d8', '#90e0c0']
  return ['#1b1b20', '#8a8f98', '#d8dbe2']
}

function codePenPoster(record: ReferenceRecord): string {
  const [background, accent, accentTwo] = posterPalette(record.category)
  const lines = posterLines(record.title)
  const title = lines.map((line, index) => `<tspan x="38" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${escapeXml(record.title)}">
  <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".055"/></pattern><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}" stop-opacity=".42"/><stop offset="1" stop-color="${accentTwo}" stop-opacity=".05"/></linearGradient></defs>
  <rect width="640" height="360" rx="22" fill="${background}"/><rect width="640" height="360" rx="22" fill="url(#grid)"/>
  <circle cx="524" cy="74" r="112" fill="url(#glow)"/><path d="M420 292c58-74 104-112 184-154" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/><path d="M445 312c42-58 93-96 159-130" fill="none" stroke="${accentTwo}" stroke-opacity=".72" stroke-width="2" stroke-dasharray="8 10"/>
  <rect x="38" y="34" width="96" height="28" rx="14" fill="${accent}" fill-opacity=".18" stroke="${accent}" stroke-opacity=".72"/><text x="86" y="53" fill="#f6f7fb" font-family="Arial,sans-serif" font-size="12" text-anchor="middle">CODEPEN</text>
  <text x="38" y="218" fill="#f6f7fb" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="28" font-weight="700">${title}</text>
  <text x="38" y="320" fill="#f6f7fb" fill-opacity=".58" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="14">${escapeXml(record.category.toUpperCase())}</text>
</svg>`
}

function rejectUnauthenticated(host: HostContext, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = host.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'content-type must be application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 8 * 1024) throw new HttpError(413, 'request body is too large')
    chunks.push(buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body must be valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'request body must be an object')
  }
  return parsed as Record<string, unknown>
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`catalog record ${field} must be a string`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function objectField(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function projectRecord(root: string, raw: RawRecord): ReferenceRecord {
  const kind = raw.kind
  if (kind !== 'codepen' && kind !== 'github-project') throw new Error('catalog record kind is unsupported')
  const localPath = stringField(raw.localPath, 'localPath')
  const absolutePath = resolve(root, localPath)
  if (!contained(root, absolutePath)) throw new Error(`catalog record localPath escapes the library root: ${localPath}`)
  const source = objectField(raw.source)
  const license = objectField(raw.license)
  const rawSourceUrl = optionalString(source.url)
  const sourceUrl = kind === 'github-project' && rawSourceUrl !== null
    ? canonicalGitHubRepositoryUrl(rawSourceUrl) ?? rawSourceUrl
    : rawSourceUrl
  return {
    id: stringField(raw.id, 'id'),
    kind: kind as ReferenceKind,
    title: stringField(raw.title, 'title'),
    category: stringField(raw.category, 'category'),
    summary: stringField(raw.summary, 'summary'),
    useFor: typeof raw.useFor === 'string' ? raw.useFor : '',
    tags: stringList(raw.tags),
    localPath,
    absolutePath,
    entryPoints: stringList(raw.entryPoints),
    card: stringField(raw.card, 'card'),
    sourceUrl,
    sourceRevision: optionalString(source.revision),
    sourceBranch: optionalString(source.branch),
    licenseType: optionalString(license.type) ?? 'unverified',
  }
}

class CatalogStore {
  private modified = -1
  private records: readonly ReferenceRecord[] = []

  constructor(readonly root: string) {}

  async snapshot(): Promise<ReferenceCatalogResponse> {
    const catalogPath = resolve(this.root, 'catalog', 'index.json')
    const info = await stat(catalogPath)
    if (!info.isFile()) throw new Error('catalog/index.json is not a file')
    if (info.mtimeMs !== this.modified) {
      const parsed = JSON.parse(await readFile(catalogPath, 'utf8')) as RawCatalog
      if (!Array.isArray(parsed.records)) throw new Error('catalog/index.json records must be an array')
      this.records = parsed.records.map(item => projectRecord(this.root, objectField(item) as RawRecord))
      this.modified = info.mtimeMs
    }
    const knownGitHubUrls = this.records
      .filter(record => record.kind === 'github-project')
      .flatMap(record => {
        const canonical = record.sourceUrl === null ? undefined : canonicalGitHubRepositoryUrl(record.sourceUrl)
        return canonical === undefined ? [] : [canonical]
      })
    return {
      records: this.records,
      knownGitHubUrls,
      pendingGitHubUrls: await pendingRequests(this.root),
    }
  }
}

async function pendingRequests(root: string): Promise<readonly string[]> {
  const directory = resolve(root, 'inbox', 'requests')
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const urls = new Set<string>()
  for (const entry of entries.filter(name => name.toLowerCase().endsWith('.txt')).slice(0, 1_000)) {
    const canonical = canonicalGitHubRepositoryUrl((await readFile(resolve(directory, entry), 'utf8')).trim())
    if (canonical !== undefined) urls.add(canonical)
  }
  return [...urls]
}

async function enqueueRequest(root: string, value: unknown): Promise<{ status: 'known' | 'pending' | 'queued'; url: string }> {
  if (typeof value !== 'string') throw new HttpError(400, 'url must be a string')
  const url = canonicalGitHubRepositoryUrl(value)
  if (url === undefined) throw new HttpError(400, 'url must identify an https://github.com/owner/repo repository')
  const store = new CatalogStore(root)
  const snapshot = await store.snapshot()
  if (snapshot.knownGitHubUrls.includes(url)) return { status: 'known', url }
  if (snapshot.pendingGitHubUrls.includes(url)) return { status: 'pending', url }

  const directory = resolve(root, 'inbox', 'requests')
  await mkdir(directory, { recursive: true })
  const realDirectory = await realpath(directory)
  if (!contained(root, realDirectory)) throw new Error('inbox/requests resolves outside the library root')
  const slug = url.slice('https://github.com/'.length).replace('/', '--').replace(/[^A-Za-z0-9_.-]/g, '-')
  const target = resolve(realDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}-${randomUUID()}.txt`)
  if (!contained(realDirectory, target)) throw new Error('request target resolves outside inbox/requests')
  await writeFile(target, `${url}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return { status: 'queued', url }
}

function configuredRoot(config: Config): string {
  const value = config.libraryRoot
    ?? process.env.VIBESPACE_REFERENCE_LIBRARY_ROOT
    ?? process.env.DSH_REFERENCE_LIBRARY_ROOT
  if (value === undefined || value.trim() === '') {
    throw new Error('reference-library requires libraryRoot or VIBESPACE_REFERENCE_LIBRARY_ROOT')
  }
  return resolve(value)
}

export function apply(ctx: Context, config: Config = {}): void {
  const host = ctx as HostContext
  const extensionPath = fileURLToPath(new URL('../chrome-extension', import.meta.url))
  let current = (): Config => config
  let onlineConfig = resolveOnlineConfig(current())
  let onlineSignature = JSON.stringify(onlineConfig)
  let online = new OnlineReferenceService(onlineConfig, extensionPath)
  const retired: Promise<void>[] = []
  const refreshOnline = (): void => {
    const nextConfig = resolveOnlineConfig(current())
    const nextSignature = JSON.stringify(nextConfig)
    if (nextSignature === onlineSignature) return
    const previous = online
    onlineConfig = nextConfig
    onlineSignature = nextSignature
    online = new OnlineReferenceService(nextConfig, extensionPath)
    retired.push(previous.dispose())
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, REFERENCE_LIBRARY_SETTINGS_NAMESPACE, Config, config, {
      setSource: source => { current = source },
      onChange: refreshOnline,
    })
  })
  mountOnlineWebApi(ctx, {
    search: (...args) => online.search(...args),
    get pinterest() { return online.pinterest },
  })
  ctx.effect(() => async () => {
    await online.dispose()
    await Promise.allSettled(retired)
  }, 'reference-library: online browser lifecycle')
  ctx.effect(() => {
    let rootPath: string | undefined
    let rootPromise: Promise<string> | undefined
    let storePromise: Promise<CatalogStore> | undefined
    const currentStore = (): Promise<CatalogStore> => {
      const nextRoot = configuredRoot(current())
      if (rootPath !== nextRoot || storePromise === undefined) {
        rootPath = nextRoot
        rootPromise = realpath(nextRoot)
        storePromise = rootPromise.then(root => new CatalogStore(root))
      }
      return storePromise
    }
    const currentRoot = async (): Promise<string> => {
      await currentStore()
      return rootPromise!
    }
    const catalogOff = host.webServer.register({
      kind: 'exact',
      path: CATALOG_ENDPOINT,
      async handler(req, res) {
        if (rejectUnauthenticated(host, req, res)) return
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          reply(res, 200, await (await currentStore()).snapshot())
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn(`reference-library: catalog request failed: ${message}`)
          reply(res, 500, { error: message })
        }
      },
    })
    const requestOff = host.webServer.register({
      kind: 'exact',
      path: REQUEST_ENDPOINT,
      async handler(req, res) {
        if (rejectUnauthenticated(host, req, res)) return
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await jsonBody(req)
          const result = await enqueueRequest(await currentRoot(), body.url)
          reply(res, result.status === 'queued' ? 201 : 200, result)
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 500
          const message = error instanceof Error ? error.message : String(error)
          if (status === 500) ctx.logger.warn(`reference-library: request queue failed: ${message}`)
          reply(res, status, { error: message })
        }
      },
    })
    const posterOff = host.webServer.register({
      kind: 'exact',
      path: CODEPEN_POSTER_ENDPOINT,
      async handler(req, res) {
        if (rejectUnauthenticated(host, req, res)) return
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        const id = new URL(req.url ?? CODEPEN_POSTER_ENDPOINT, 'http://127.0.0.1').searchParams.get('id')
        const record = (await (await currentStore()).snapshot()).records.find(item => item.id === id && item.kind === 'codepen')
        if (record === undefined) {
          reply(res, 404, { error: 'CodePen project not found' })
          return
        }
        replySvg(res, 200, codePenPoster(record))
      },
    })
    const previewOff = host.webServer.register({
      kind: 'prefix',
      path: CODEPEN_PREVIEW_ENDPOINT,
      async handler(req, res) {
        if (rejectUnauthenticated(host, req, res)) return
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          const pathname = new URL(req.url ?? CODEPEN_PREVIEW_ENDPOINT, 'http://127.0.0.1').pathname
          const suffix = pathname.slice(CODEPEN_PREVIEW_ENDPOINT.length).replace(/^\/+/, '')
          const slash = suffix.indexOf('/')
          if (slash <= 0) throw new HttpError(404, 'CodePen preview not found')
          const id = decodeURIComponent(suffix.slice(0, slash))
          const asset = decodeURIComponent(suffix.slice(slash + 1)) || 'index.html'
          const record = (await (await currentStore()).snapshot()).records.find(item => item.id === id && item.kind === 'codepen')
          if (record === undefined) throw new HttpError(404, 'CodePen project not found')
          const projectRoot = await realpath(resolve(await currentRoot(), record.localPath))
          const unresolvedAsset = resolve(projectRoot, asset)
          if (!contained(projectRoot, unresolvedAsset)) throw new HttpError(400, 'CodePen preview path escapes the project')
          const assetPath = await realpath(unresolvedAsset)
          if (!contained(projectRoot, assetPath)) throw new HttpError(400, 'CodePen preview symlink escapes the project')
          const info = await stat(assetPath)
          if (!info.isFile()) throw new HttpError(404, 'CodePen preview asset not found')
          replyPreview(res, assetPath, await readFile(assetPath))
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 404
          reply(res, status, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    return () => {
      catalogOff()
      requestOff()
      posterOff()
      previewOff()
    }
  }, 'reference-library: authenticated catalog and request routes')
  ctx.logger.info(`[${name}] native data reference tabs active; bundle=0.6.7-pagination-sort`)
}

export { normalizeBook, ZLibrarySearchService } from './online/book.ts'
export { PinterestChromeBridge } from './online/pinterest-bridge.ts'
export { appendReferenceToDraft, normalizeSelection, providerStartUrl } from './online/reference.ts'
export { API_ROOT as ONLINE_API_ROOT, PINTEREST_BRIDGE_ROOT } from './online/web-api.ts'
