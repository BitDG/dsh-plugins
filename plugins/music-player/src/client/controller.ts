import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GenerationJob, MediaSource, MusicItem, PluginDescriptor } from '../types.ts'

export interface MusicSnapshot {
  active: boolean
  sidebarWidth: number
  csrf: string
  plugins: PluginDescriptor[]
  selectedPluginId: string
  query: string
  results: MusicItem[]
  current: MusicItem | null
  source: MediaSource | null
  playing: boolean
  currentTime: number
  duration: number
  loading: boolean
  error: string | null
  notice: string | null
  generation: GenerationJob | null
}

type Bootstrap = { csrf?: unknown; plugins?: unknown; error?: unknown }

function initialSnapshot(): MusicSnapshot {
  return { active: false, sidebarWidth: 240, csrf: '', plugins: [], selectedPluginId: 'audiomack', query: 'ambient', results: [], current: null, source: null, playing: false, currentTime: 0, duration: 0, loading: false, error: null, notice: null, generation: null }
}

export class MusicController {
  readonly store: SnapshotStore<MusicSnapshot> = createSnapshotStore(initialSnapshot())
  private loaded = false
  private readonly abort = new AbortController()
  private pollTimer: number | undefined
  private audio: HTMLAudioElement | null = null
  private queue: MusicItem[] = []
  private queueIndex = -1

  constructor(private readonly submitGenerationPrompt: (prompt: string) => void | Promise<void>) {}
  dispose(): void { this.abort.abort(); if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer); this.attachAudio(null) }
  activate(sidebarWidth: number): void { this.patch({ active: true, sidebarWidth }); void this.ensureLoaded() }
  deactivate(): void { this.patch({ active: false }) }
  selectPlugin(id: string): void {
    const plugin = this.store.getSnapshot().plugins.find(item => item.id === id)
    if (this.audio !== null) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load() }
    this.queue = []; this.queueIndex = -1
    this.patch({ selectedPluginId: id, query: plugin?.defaultQuery ?? this.store.getSnapshot().query, results: [], current: null, source: null, playing: false, currentTime: 0, duration: 0, notice: null })
  }
  setQuery(query: string): void { this.patch({ query }) }

  attachAudio = (audio: HTMLAudioElement | null): void => {
    if (this.audio === audio) return
    if (this.audio !== null) this.listenToAudio(this.audio, 'removeEventListener')
    this.audio = audio
    if (audio !== null) { this.listenToAudio(audio, 'addEventListener'); this.updatePlayback() }
  }

  resumePlayback = (): void => { if (this.audio !== null) void this.audio.play().catch(() => {}) }
  togglePlayback = (): void => {
    if (this.audio === null || this.store.getSnapshot().source === null) return
    if (this.audio.paused) void this.audio.play().catch(error => { this.fail(error) })
    else this.audio.pause()
  }
  seekPlayback = (seconds: number): void => {
    if (this.audio === null || !Number.isFinite(seconds)) return
    this.audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(this.audio.duration) ? this.audio.duration : seconds))
    this.updatePlayback()
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.patch({ loading: true, error: null })
    try {
      const response = await fetch('/api/dship/music/bootstrap', { signal: this.abort.signal, cache: 'no-store' })
      const data = await response.json() as Bootstrap
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${String(response.status)}`)
      const plugins = Array.isArray(data.plugins) ? data.plugins as PluginDescriptor[] : []
      this.patch({ csrf: typeof data.csrf === 'string' ? data.csrf : '', plugins, selectedPluginId: plugins.some(item => item.id === this.store.getSnapshot().selectedPluginId) ? this.store.getSnapshot().selectedPluginId : plugins[0]?.id ?? '' })
      this.loaded = true
    } catch (error) { this.fail(error) }
    finally { this.patch({ loading: false }) }
  }

  async search(): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.query.trim() === '' || state.selectedPluginId === '') return
    this.patch({ loading: true, error: null, notice: null })
    try {
      const result = await this.write('/search', { pluginId: state.selectedPluginId, query: state.query.trim(), page: 1 }) as { data?: unknown }
      this.patch({ results: Array.isArray(result.data) ? result.data as MusicItem[] : [] })
    } catch (error) { this.fail(error) }
    finally { this.patch({ loading: false }) }
  }

  async play(item: MusicItem): Promise<void> {
    const results = this.store.getSnapshot().results
    const index = results.findIndex(candidate => candidate.id === item.id && candidate.platform === item.platform)
    this.queue = index < 0 ? [item] : [...results]
    this.queueIndex = index < 0 ? 0 : index
    await this.resolveAndPlay(item)
  }

  private async resolveAndPlay(item: MusicItem): Promise<void> {
    this.patch({ current: item, source: null, playing: false, currentTime: 0, duration: 0, loading: true, error: null })
    try {
      const source = await this.write('/source', { pluginId: this.store.getSnapshot().selectedPluginId, item, quality: 'standard' }) as MediaSource
      this.patch({ source })
    } catch (error) { this.fail(error) }
    finally { this.patch({ loading: false }) }
  }

  async generate(input: { sourceUrl: string; query: string; author: string; authorized: boolean }): Promise<void> {
    this.patch({ loading: true, error: null, notice: null })
    try {
      const job = await this.write('/generations', input) as GenerationJob
      this.patch({ generation: job, notice: '已创建隔离生成目录，正在当前对话中启动 AI。' })
      await this.submitGenerationPrompt(job.prompt)
      this.startPolling(job.id)
    } catch (error) { this.fail(error); throw error }
    finally { this.patch({ loading: false }) }
  }

  async install(reviewId: string): Promise<void> {
    this.patch({ loading: true, error: null, notice: null })
    try {
      const result = await this.write('/plugins/install', { reviewId, confirmed: true }) as { plugins?: unknown; plugin?: PluginDescriptor }
      this.patch({ plugins: Array.isArray(result.plugins) ? result.plugins as PluginDescriptor[] : this.store.getSnapshot().plugins, selectedPluginId: result.plugin?.id ?? this.store.getSnapshot().selectedPluginId, notice: `已安装 ${result.plugin?.platform ?? '音乐插件'}。` })
    } catch (error) { this.fail(error); throw error }
    finally { this.patch({ loading: false }) }
  }

  private startPolling(id: string): void {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/dship/music/generation?id=${encodeURIComponent(id)}`, { signal: this.abort.signal, cache: 'no-store' })
        const data = await response.json() as GenerationJob & { error?: string }
        if (!response.ok) throw new Error(data.error ?? `HTTP ${String(response.status)}`)
        this.patch({ generation: data })
        if (['reviewed', 'installed', 'failed'].includes(data.status) && this.pollTimer !== undefined) { window.clearInterval(this.pollTimer); this.pollTimer = undefined }
      } catch (error) { if (!this.abort.signal.aborted) this.fail(error) }
    }
    this.pollTimer = window.setInterval(() => { void poll() }, 2_000)
    void poll()
  }

  private async write(path: string, body: object): Promise<unknown> {
    const response = await fetch(`/api/dship/music${path}`, { method: 'POST', signal: this.abort.signal, headers: { 'content-type': 'application/json', 'x-music-csrf': this.store.getSnapshot().csrf }, body: JSON.stringify(body) })
    const data = await response.json() as { error?: unknown }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${String(response.status)}`)
    return data
  }
  private readonly updatePlayback = (): void => {
    const audio = this.audio
    if (audio === null) return
    this.patch({ playing: !audio.paused && !audio.ended, currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
  }
  private readonly playNext = (): void => {
    this.updatePlayback()
    const next = this.queue[this.queueIndex + 1]
    if (next === undefined) { this.patch({ notice: this.queue.length > 0 ? '当前搜索结果已播放完。' : null }); return }
    this.queueIndex += 1
    void this.resolveAndPlay(next)
  }
  private listenToAudio(audio: HTMLAudioElement, operation: 'addEventListener' | 'removeEventListener'): void {
    for (const event of ['play', 'pause', 'timeupdate', 'durationchange'] as const) audio[operation](event, this.updatePlayback)
    audio[operation]('ended', this.playNext)
  }
  private fail(error: unknown): void { this.patch({ error: error instanceof Error ? error.message : String(error) }) }
  private patch(change: Partial<MusicSnapshot>): void { this.store.set({ ...this.store.getSnapshot(), ...change }) }
}
