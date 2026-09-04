import { createHash, createHmac } from 'node:crypto'
import { join } from 'node:path'
import { Innertube, Platform, UniversalCache } from 'youtubei.js'
import type { ResolvedConfig } from './config.ts'
import type { MediaSource, MusicItem, PluginDescriptor } from './types.ts'
import { createOnlineMusicProviders } from './online-music-providers.ts'
import { IsolatedYoutubeEvaluator } from './youtube-evaluator.ts'

export interface TrustedMediaSource extends MediaSource {
  allowedMediaHosts: string[]
}

export interface TrustedProvider {
  descriptor: PluginDescriptor
  search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }>
  media(item: MusicItem, quality: string): Promise<TrustedMediaSource>
}

type JsonRecord = Record<string, unknown>

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36'

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

function decodeText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parts = value.split(':').map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part))) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const BILIBILI_WBI_MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const

function bilibiliWbiFileKey(value: string): string {
  const filename = value.slice(value.lastIndexOf('/') + 1)
  return filename.slice(0, filename.lastIndexOf('.'))
}

function bilibiliWbiMixinKey(imgKey: string, subKey: string): string {
  const source = imgKey + subKey
  return BILIBILI_WBI_MIXIN.map(index => source[index] ?? '').join('').slice(0, 32)
}

function normalizeBilibiliCreatorName(value: string): string {
  return decodeText(value).normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

async function fetchJson(url: URL | string, config: ResolvedConfig, init: RequestInit = {}): Promise<JsonRecord> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    if (!response.ok) throw new Error(`Upstream HTTP ${String(response.status)} from ${new URL(response.url).hostname}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > config.maxResponseBytes) throw new Error('Upstream response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > config.maxResponseBytes) throw new Error('Upstream response is too large')
    return record(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
  } finally { clearTimeout(timer) }
}

async function fetchJsonArray(url: URL | string, config: ResolvedConfig, init: RequestInit = {}): Promise<unknown[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
    if (!response.ok) throw new Error(`Upstream HTTP ${String(response.status)} from ${new URL(response.url).hostname}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > config.maxResponseBytes) throw new Error('Upstream response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > config.maxResponseBytes) throw new Error('Upstream response is too large')
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed)) throw new Error('Upstream response must be an array')
    return parsed
  } finally { clearTimeout(timer) }
}

async function withDeadline<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`${label} timed out`)) }, timeoutMs) }),
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

class BilibiliProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'bilibili', platform: 'Bilibili', version: '0.3.0', author: 'DSHP',
    description: 'Searches a Bilibili UP creator by name, then lists that creator\'s public submissions newest first.',
    allowedHosts: ['api.bilibili.com', '*.bilivideo.cn', '*.bilivideo.com'], installed: true, builtin: true, trusted: true,
  }
  private cookie?: Promise<string>
  private wbiKeys?: Promise<{ img: string; sub: string; expiresAt: number }>

  constructor(protected readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const cookie = await this.getCookie()
    const creatorUrl = new URL('https://api.bilibili.com/x/web-interface/search/type')
    const params: Record<string, string> = {
      context: '', page: '1', order: '', page_size: '20', keyword: query, duration: '', tids_1: '', tids_2: '',
      __refresh__: 'true', _extra: '', highlight: '1', single_column: '0', platform: 'pc', from_source: '', search_type: 'bili_user', dynamic_offset: '0',
    }
    for (const [key, value] of Object.entries(params)) creatorUrl.searchParams.set(key, value)
    const creatorPayload = await fetchJson(creatorUrl, this.config, { headers: {
      accept: 'application/json', cookie, origin: 'https://search.bilibili.com', referer: 'https://search.bilibili.com/', 'user-agent': USER_AGENT,
    } })
    if (number(creatorPayload.code) !== 0) throw new Error(`Bilibili creator search rejected: ${string(creatorPayload.message) || String(creatorPayload.code)}`)
    const creatorResults = array(record(creatorPayload.data).result).map(record)
    const normalizedQuery = normalizeBilibiliCreatorName(query)
    const creator = creatorResults.find(item => normalizeBilibiliCreatorName(string(item.uname)) === normalizedQuery)
      ?? creatorResults.find(item => number(item.mid) !== undefined)
    const mid = number(creator?.mid)
    if (mid === undefined) return { isEnd: true, data: [] }

    const pageSize = 30
    const archiveUrl = await this.signWbiUrl('https://api.bilibili.com/x/space/wbi/arc/search', {
      mid, ps: pageSize, tid: 0, pn: page, web_location: 1550101, order_avoided: true, order: 'pubdate', keyword: '', platform: 'web',
      dm_img_list: '[]', dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
      dm_cover_img_str: 'QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgR1RYIDE2NTAgKDB4MDAwMDFGOTEpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKE5WSURJQS',
      dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
    })
    const archivePayload = await fetchJson(archiveUrl, this.config, { headers: {
      accept: '*/*', cookie, origin: 'https://space.bilibili.com', referer: `https://space.bilibili.com/${String(mid)}/video`,
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site', 'user-agent': USER_AGENT,
    } })
    if (number(archivePayload.code) !== 0) throw new Error(`Bilibili creator submissions rejected: ${string(archivePayload.message) || String(archivePayload.code)}`)
    const archiveData = record(archivePayload.data); const results = array(record(archiveData.list).vlist)
    const creatorName = decodeText(string(creator?.uname)) || 'Bilibili UP'
    const count = number(record(archiveData.page).count)
    return {
      isEnd: count === undefined ? results.length < pageSize : page * pageSize >= count,
      data: results.map((entry): MusicItem | undefined => {
        const item = record(entry); const bvid = string(item.bvid); const aid = number(item.aid); const id = bvid || (aid === undefined ? '' : String(aid))
        if (!id) return undefined
        const published = number(item.created) ?? number(item.pubdate)
        return {
          id, platform: this.descriptor.platform, title: decodeText(string(item.title)), artist: decodeText(string(item.author)) || creatorName,
          album: bvid || String(aid ?? ''), duration: durationSeconds(item.length ?? item.duration), artwork: string(item.pic).replace(/^\/\//, 'https://'),
          ...(published === undefined ? {} : { publishedAt: new Date(published * 1_000).toISOString() }),
          bvid, ...(aid === undefined ? {} : { aid }),
        }
      }).filter((item): item is MusicItem => item !== undefined)
        .sort((left, right) => Date.parse(right.publishedAt ?? '') - Date.parse(left.publishedAt ?? '')),
    }
  }

  async media(item: MusicItem, quality: string): Promise<TrustedMediaSource> {
    const bvid = typeof item.bvid === 'string' ? item.bvid : ''; const aid = typeof item.aid === 'number' ? item.aid : undefined
    if (!bvid && aid === undefined) throw new Error('Bilibili item is missing bvid/aid')
    const view = new URL('https://api.bilibili.com/x/web-interface/view'); view.searchParams.set(bvid ? 'bvid' : 'aid', bvid || String(aid))
    const viewPayload = await fetchJson(view, this.config, { headers: { accept: 'application/json', referer: 'https://www.bilibili.com/', 'user-agent': USER_AGENT } })
    const cid = number(record(viewPayload.data).cid)
    if (cid === undefined) throw new Error('Bilibili did not return a playable cid')
    const play = new URL('https://api.bilibili.com/x/player/playurl'); play.searchParams.set(bvid ? 'bvid' : 'aid', bvid || String(aid)); play.searchParams.set('cid', String(cid)); play.searchParams.set('fnval', '16')
    const playPayload = await fetchJson(play, this.config, { headers: { accept: 'application/json', referer: `https://www.bilibili.com/video/${bvid || String(aid)}`, 'user-agent': USER_AGENT } })
    if (number(playPayload.code) !== 0) throw new Error(`Bilibili playback rejected: ${string(playPayload.message) || String(playPayload.code)}`)
    const data = record(playPayload.data); const dash = record(data.dash)
    const audio = array(dash.audio).map(record).filter(entry => string(entry.baseUrl) || string(entry.base_url)).sort((left, right) => (number(left.bandwidth) ?? 0) - (number(right.bandwidth) ?? 0))
    let selected: JsonRecord | undefined
    if (audio.length > 0) {
      const ratio = quality === 'low' ? 0 : quality === 'high' || quality === 'super' ? 1 : 0.5
      selected = audio[Math.round((audio.length - 1) * ratio)]
    }
    const legacy = record(array(data.durl)[0]); const mediaUrl = string(selected?.baseUrl) || string(selected?.base_url) || string(legacy.url)
    if (!mediaUrl) throw new Error('Bilibili returned no public audio stream')
    return {
      url: mediaUrl,
      headers: { accept: '*/*', referer: `https://www.bilibili.com/video/${bvid || String(aid)}`, 'user-agent': USER_AGENT },
      allowedMediaHosts: ['*.bilivideo.cn', '*.bilivideo.com'],
    }
  }

  private getCookie(): Promise<string> {
    this.cookie ??= fetchJson('https://api.bilibili.com/x/frontend/finger/spi', this.config, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } }).then(payload => {
      const data = record(payload.data); const b3 = string(data.b_3); const b4 = string(data.b_4)
      if (!b3 || !b4) throw new Error('Bilibili anonymous device cookie is unavailable')
      return `buvid3=${b3}; buvid4=${b4}`
    })
    return this.cookie
  }

  private async signWbiUrl(endpoint: string, params: Record<string, string | number | boolean>): Promise<URL> {
    const keys = await this.getWbiKeys()
    const signed: Record<string, string | number | boolean> = { ...params, wts: Math.round(Date.now() / 1_000).toString() }
    const entries = Object.keys(signed).sort().map(key => {
      const raw = signed[key]
      const value = typeof raw === 'string' ? raw.replace(/[!'()*]/g, '') : String(raw)
      return [key, value] as const
    })
    const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    const url = new URL(endpoint)
    for (const [key, value] of entries) url.searchParams.append(key, value)
    url.searchParams.set('w_rid', createHash('md5').update(query + bilibiliWbiMixinKey(keys.img, keys.sub)).digest('hex'))
    return url
  }

  private getWbiKeys(): Promise<{ img: string; sub: string; expiresAt: number }> {
    if (this.wbiKeys === undefined) this.wbiKeys = this.fetchWbiKeys()
    return this.wbiKeys.then(keys => {
      if (keys.expiresAt > Date.now()) return keys
      this.wbiKeys = this.fetchWbiKeys()
      return this.wbiKeys
    })
  }

  private async fetchWbiKeys(): Promise<{ img: string; sub: string; expiresAt: number }> {
    const timestamp = Math.floor(Date.now() / 1_000)
    const ticketUrl = new URL('https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket')
    ticketUrl.searchParams.set('key_id', 'ec02')
    ticketUrl.searchParams.set('hexsign', createHmac('sha256', 'XgwSnGZ1p').update(`ts${String(timestamp)}`).digest('hex'))
    ticketUrl.searchParams.set('context[ts]', String(timestamp))
    ticketUrl.searchParams.set('csrf', '')
    const payload = await fetchJson(ticketUrl, this.config, { method: 'POST', headers: { accept: 'application/json', 'user-agent': USER_AGENT } })
    if (number(payload.code) !== 0) throw new Error(`Bilibili WBI ticket rejected: ${string(payload.message) || String(payload.code)}`)
    const nav = record(record(payload.data).nav); const img = bilibiliWbiFileKey(string(nav.img)); const sub = bilibiliWbiFileKey(string(nav.sub))
    if (!img || !sub) throw new Error('Bilibili WBI keys are unavailable')
    const expiry = new Date(); expiry.setHours(24, 0, 0, 0)
    return { img, sub, expiresAt: expiry.getTime() }
  }
}

class SomaFmProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'somafm', platform: 'SomaFM', defaultQuery: 'ambient', version: '0.1.0', author: 'DSHP',
    description: 'Commercial-free listener-supported online radio using SomaFM public channel data and permanent streams.',
    allowedHosts: ['api.somafm.com', '*.somafm.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const payload = await fetchJson('https://api.somafm.com/channels.json', this.config, { headers: { accept: 'application/json', 'user-agent': 'DSHP-Music-Player/0.3' } })
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const channels = array(payload.channels).map(record).filter(channel => {
      const haystack = [string(channel.title), string(channel.description), string(channel.genre), string(channel.lastPlaying)].join(' ').toLocaleLowerCase()
      return terms.length === 0 || terms.every(term => haystack.includes(term))
    })
    return {
      isEnd: true,
      data: channels.slice(0, 50).map((channel): MusicItem | undefined => {
        const id = string(channel.id); const title = string(channel.title)
        if (!id || !title) return undefined
        const updated = Number(string(channel.updated))
        return {
          id, platform: this.descriptor.platform, title, artist: string(channel.lastPlaying) || string(channel.description) || 'SomaFM live radio',
          album: string(channel.genre) || 'Online radio', artwork: string(channel.largeimage) || string(channel.image),
          ...(Number.isFinite(updated) ? { publishedAt: new Date(updated * 1_000).toISOString(), publishedLabel: '直播' } : { publishedLabel: '直播' }),
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem): Promise<TrustedMediaSource> {
    if (!/^[a-z0-9]+$/i.test(item.id)) throw new Error('SomaFM channel id is invalid')
    return { url: `https://ice.somafm.com/${item.id}-128-mp3`, headers: { 'user-agent': 'DSHP-Music-Player/0.3' }, allowedMediaHosts: ['*.somafm.com'] }
  }
}

const RADIO_BROWSER_ENDPOINTS = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info']

async function radioBrowserSearch(config: ResolvedConfig, parameters: Record<string, string>): Promise<unknown[]> {
  let lastError: unknown
  for (const endpoint of RADIO_BROWSER_ENDPOINTS) {
    const url = new URL('/json/stations/search', endpoint)
    for (const [key, value] of Object.entries({ limit: '30', hidebroken: 'true', order: 'clickcount', reverse: 'true', ...parameters })) url.searchParams.set(key, value)
    try { return await fetchJsonArray(url, config, { headers: { accept: 'application/json', 'user-agent': 'DSHP-Music-Player/0.3' } }) }
    catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('Radio Browser is unavailable')
}

function radioItems(entries: unknown[], platform: string): MusicItem[] {
  const seen = new Set<string>()
  return entries.map(record).map((station): MusicItem | undefined => {
    const id = string(station.stationuuid); const title = string(station.name).trim(); const mediaUrl = string(station.url_resolved) || string(station.url)
    if (!id || !title || seen.has(id)) return undefined
    let url: URL
    try { url = new URL(mediaUrl) } catch { return undefined }
    if (!['http:', 'https:'].includes(url.protocol) || number(station.hls) === 1 || /\.m3u8(?:$|\?)/i.test(url.pathname)) return undefined
    seen.add(id)
    const codec = string(station.codec); const bitrate = number(station.bitrate); const country = string(station.countrycode)
    const details = [country, codec, bitrate === undefined || bitrate <= 0 ? '' : `${String(bitrate)} kbps`].filter(Boolean).join(' · ')
    const publishedAt = string(station.lastchangetime_iso8601)
    return {
      id, platform, title, artist: details || 'Online radio', album: string(station.tags) || 'Live station', artwork: string(station.favicon),
      url: url.toString(), homepage: string(station.homepage), publishedLabel: '直播', ...(publishedAt ? { publishedAt } : {}),
    }
  }).filter((item): item is MusicItem => item !== undefined)
}

class RadioBrowserProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'radio-browser', platform: '网络电台', defaultQuery: 'ambient', version: '0.1.0', author: 'DSHP',
    description: 'Public live stations from the free and open Radio Browser directory.',
    allowedHosts: ['*.api.radio-browser.info'], installed: true, builtin: true, trusted: true,
  }
  constructor(protected readonly config: ResolvedConfig) {}
  async search(query: string): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    return { isEnd: true, data: radioItems(await radioBrowserSearch(this.config, { name: query }), this.descriptor.platform) }
  }
  async media(item: MusicItem): Promise<TrustedMediaSource> { return this.stationMedia(item) }
  protected stationMedia(item: MusicItem): TrustedMediaSource {
    if (typeof item.url !== 'string' || !item.url) throw new Error('Radio station is missing its stream URL')
    const stream = new URL(item.url); const allowedMediaHosts = [stream.hostname]
    return { url: stream.toString(), headers: { 'icy-metadata': '1', 'user-agent': 'DSHP-Music-Player/0.3' }, allowedMediaHosts }
  }
}

class WhiteNoiseProvider extends RadioBrowserProvider {
  override readonly descriptor: PluginDescriptor = {
    id: 'white-noise', platform: '白噪音', defaultQuery: 'noise', version: '0.1.0', author: 'DSHP',
    description: 'Curated live white-noise, sleep, meditation, and nature-sound stations from Radio Browser.',
    allowedHosts: ['*.api.radio-browser.info'], installed: true, builtin: true, trusted: true,
  }
  override async search(query: string): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const searches = await Promise.all([
      radioBrowserSearch(this.config, { name: query || 'noise' }),
      radioBrowserSearch(this.config, { tag: 'sleep' }),
      radioBrowserSearch(this.config, { tag: 'nature' }),
    ])
    const focused = searches.flat().filter(entry => {
      const station = record(entry)
      const text = [string(station.name), string(station.tags)].join(' ')
      return /white\s*noise|brown\s*noise|pink\s*noise|mynoise|cooling\s*fan|soundscape|rain|ocean|nature\s*(?:sound|relax)|sounds?\s*of\s*nature/i.test(text)
    })
    return { isEnd: true, data: radioItems(focused, this.descriptor.platform).slice(0, 50) }
  }
}

class YouTubeMusicProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'youtube-music', platform: 'YouTube Music', version: '0.1.0', author: 'DSHP',
    description: 'Public YouTube Music search through the maintained YouTube.js connector. No login or restricted-content bypass.',
    allowedHosts: ['www.youtube.com', 'music.youtube.com', '*.googlevideo.com'], installed: true, builtin: true, trusted: true,
  }
  private client?: Promise<Awaited<ReturnType<typeof Innertube.create>>>

  constructor(private readonly config: ResolvedConfig) {
    const evaluator = new IsolatedYoutubeEvaluator(Math.min(config.runnerTimeoutMs, 5_000))
    Platform.shim.eval = data => evaluator.evaluate(data.output)
  }

  async search(query: string): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const client = await withDeadline(this.getClient(), this.config.requestTimeoutMs, 'YouTube initialization')
    const result = await withDeadline(client.music.search(query, { type: 'song' }), this.config.requestTimeoutMs, 'YouTube search')
    const items = [...(result.songs?.contents ?? [])].slice(0, 30)
    return {
      isEnd: true,
      data: items.map(item => {
        const year = typeof item.year === 'string' && /^\d{4}$/.test(item.year) ? item.year : undefined
        return {
          id: item.id ?? '', platform: this.descriptor.platform, title: item.title ?? item.name ?? 'Untitled',
          artist: item.artists?.map(artist => artist.name).filter(Boolean).join(', ') || item.author?.name || 'YouTube creator',
          ...(item.album?.name === undefined ? {} : { album: item.album.name }),
          ...(item.duration?.seconds === undefined ? {} : { duration: item.duration.seconds }),
          ...(item.thumbnails.at(-1)?.url === undefined ? {} : { artwork: item.thumbnails.at(-1)!.url }),
          ...(year === undefined ? {} : { publishedAt: `${year}-01-01T00:00:00.000Z`, publishedLabel: year }),
        }
      }).filter(item => item.id !== ''),
    }
  }

  async media(item: MusicItem, quality: string): Promise<TrustedMediaSource> {
    const client = await withDeadline(this.getClient(), this.config.requestTimeoutMs, 'YouTube initialization')
    const info = await withDeadline(client.music.getInfo(item.id), this.config.requestTimeoutMs, 'YouTube source resolution')
    const format = info.chooseFormat({ type: 'audio', quality: quality === 'low' ? 'bestefficiency' : 'best', format: 'any' })
    const url = await format.decipher(client.session.player)
    if (!url) throw new Error('YouTube returned no decipherable public audio stream')
    return { url, headers: { 'user-agent': USER_AGENT }, allowedMediaHosts: ['*.googlevideo.com'] }
  }

  private getClient(): Promise<Awaited<ReturnType<typeof Innertube.create>>> {
    this.client ??= Innertube.create({ cache: new UniversalCache(true, join(this.config.storageRoot, 'youtube-cache')) })
    return this.client
  }
}

export function createTrustedProviders(config: ResolvedConfig): Map<string, TrustedProvider> {
  const providers: TrustedProvider[] = [
    new BilibiliProvider(config), new YouTubeMusicProvider(config), ...createOnlineMusicProviders(config),
    new SomaFmProvider(config), new RadioBrowserProvider(config), new WhiteNoiseProvider(config),
  ]
  return new Map(providers.map(provider => [provider.descriptor.id, provider]))
}
