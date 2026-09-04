import { constants, createCipheriv, createHmac, publicEncrypt, randomBytes, randomUUID } from 'node:crypto'
import type { ResolvedConfig } from './config.ts'
import type { TrustedMediaSource, TrustedProvider } from './trusted-providers.ts'
import type { MusicItem, PluginDescriptor } from './types.ts'

type JsonRecord = Record<string, unknown>

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36'
const AUDIOMACK_SECRET = 'f3ac5b086f3eab260520d8e3049561e6'
const NETEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function boolean(value: unknown): boolean | undefined { return typeof value === 'boolean' ? value : undefined }

function httpsUrl(value: unknown): string {
  const raw = string(value).trim()
  if (!raw) return ''
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('http://')) return `https://${raw.slice('http://'.length)}`
  return raw
}

function date(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value
    return new Date(milliseconds).toISOString()
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return undefined
}

function duration(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : number(value)
  if (parsed === undefined || !Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed > 10_000 ? parsed / 1_000 : parsed
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

function dynamicMedia(url: string, headers: Record<string, string> = {}): TrustedMediaSource {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Media URL must use HTTP or HTTPS')
  return { url: parsed.toString(), headers, allowedMediaHosts: [parsed.hostname] }
}

function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function audiomackUrl(path: string, parameters: Record<string, string | number | boolean>): URL {
  const endpoint = `https://api.audiomack.com/v1${path}`
  const normalized = Object.entries(parameters)
    .map(([key, value]) => [oauthEncode(key), oauthEncode(String(value))] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`).join('&')
  const signatureBase = ['GET', endpoint, normalized].map(oauthEncode).join('&')
  const signature = createHmac('sha1', `${AUDIOMACK_SECRET}&`).update(signatureBase).digest('base64')
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
  url.searchParams.set('oauth_signature', signature)
  return url
}

function audiomackParameters(extra: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  return {
    oauth_consumer_key: 'audiomack-js', oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.round(Date.now() / 1_000), oauth_version: '1.0', ...extra,
  }
}

class AudiomackProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'audiomack', platform: 'Audiomack', version: '0.1.0', author: 'DSHP',
    description: 'Public Audiomack song search and signed public streams. No account session is used.',
    allowedHosts: ['api.audiomack.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const pageSize = 20
    const url = audiomackUrl('/search', audiomackParameters({ limit: pageSize, page, q: query, show: 'songs', sort: 'popular' }))
    const payload = await fetchJson(url, this.config, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } })
    const results = array(payload.results).map(record)
    return {
      isEnd: results.length < pageSize,
      data: results.map((item): MusicItem | undefined => {
        const id = number(item.id) ?? string(item.id); const title = string(item.title)
        if (id === '' || !title) return undefined
        const artistValue = item.artist; const artist = typeof artistValue === 'string' ? artistValue : string(record(artistValue).name)
        const released = date(item.released ?? item.created)
        return {
          id: String(id), platform: this.descriptor.platform, title, artist: artist || 'Audiomack artist', album: string(item.album),
          duration: duration(item.duration), artwork: httpsUrl(item.image) || httpsUrl(item.image_base), ...(released ? { publishedAt: released } : {}),
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem): Promise<TrustedMediaSource> {
    if (!/^\d+$/.test(item.id)) throw new Error('Audiomack item id is invalid')
    const url = audiomackUrl(`/music/play/${item.id}`, audiomackParameters({ environment: 'desktop-web', hq: true, section: '/search' }))
    const payload = await fetchJson(url, this.config, { headers: { accept: 'application/json', origin: 'https://audiomack.com', referer: 'https://audiomack.com/', 'user-agent': USER_AGENT } })
    const mediaUrl = string(payload.signedUrl)
    if (!mediaUrl) throw new Error('Audiomack returned no public stream')
    return dynamicMedia(mediaUrl, { origin: 'https://audiomack.com', referer: 'https://audiomack.com/', 'user-agent': USER_AGENT })
  }
}

class MaoerFmProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'maoer-fm', platform: '猫耳FM', version: '0.1.0', author: 'DSHP',
    description: 'Searches free Maoer FM dramas and exposes their public free episodes.',
    allowedHosts: ['www.missevan.com', '*.maoercdn.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const url = new URL('https://www.missevan.com/dramaapi/search'); url.searchParams.set('s', query); url.searchParams.set('page', String(page))
    const payload = await fetchJson(url, this.config, { headers: { accept: 'application/json', referer: 'https://www.missevan.com/', 'user-agent': USER_AGENT } })
    const info = record(payload.info); const pagination = record(info.pagination)
    const dramas = array(info.Datas).map(record).filter(drama => number(drama.pay_type) === 0)
    const data = dramas.flatMap((drama): MusicItem[] => {
      const artwork = httpsUrl(drama.cover); const artist = string(drama.author) || '猫耳FM'; const album = string(drama.name)
      return array(drama.episodes).map(record).map((episode): MusicItem | undefined => {
        const id = number(episode.sound_id); const title = string(episode.soundstr) || string(episode.name)
        if (id === undefined || !title) return undefined
        return { id: String(id), platform: this.descriptor.platform, title, artist, album, artwork, duration: duration(episode.duration) }
      }).filter((item): item is MusicItem => item !== undefined)
    })
    const current = number(pagination.p) ?? page; const maximum = number(pagination.maxpage)
    return { isEnd: maximum === undefined ? dramas.length === 0 : current >= maximum, data }
  }

  async media(item: MusicItem, quality: string): Promise<TrustedMediaSource> {
    if (!/^\d+$/.test(item.id)) throw new Error('Maoer FM sound id is invalid')
    const url = new URL('https://www.missevan.com/sound/getsound'); url.searchParams.set('soundid', item.id)
    const payload = await fetchJson(url, this.config, { headers: { accept: 'application/json', referer: `https://www.missevan.com/sound/player?id=${item.id}`, 'user-agent': USER_AGENT } })
    const sound = record(record(payload.info).sound)
    if (number(sound.pay_type) !== undefined && number(sound.pay_type) !== 0) throw new Error('Maoer FM episode is not public and free')
    const mediaUrl = quality === 'low' ? string(sound.soundurl_128) || string(sound.soundurl) : string(sound.soundurl) || string(sound.soundurl_128)
    if (!mediaUrl) throw new Error('Maoer FM returned no public stream')
    return dynamicMedia(mediaUrl, { referer: `https://www.missevan.com/sound/player?id=${item.id}`, 'user-agent': USER_AGENT })
  }
}

class UdioProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'udio', platform: 'Udio', version: '0.1.0', author: 'DSHP',
    description: 'Public Udio community-song search and direct public audio playback.',
    allowedHosts: ['www.udio.com', '*.udio.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const pageSize = 30
    const payload = await fetchJson('https://www.udio.com/api/songs/search', this.config, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', origin: 'https://www.udio.com', referer: 'https://www.udio.com/', 'user-agent': USER_AGENT },
      body: JSON.stringify({ searchQuery: { sort: 'plays', searchTerm: query }, pageParam: page - 1, pageSize, trendingId: '93de406e-bdc1-40a6-befd-90637a362158' }),
    })
    const results = array(payload.data).map(record)
    return {
      isEnd: results.length < pageSize,
      data: results.map((item): MusicItem | undefined => {
        const id = string(item.id); const title = string(item.title); const mediaUrl = string(item.song_path)
        if (!id || !title || !mediaUrl) return undefined
        const publishedAt = date(item.created_at)
        return {
          id, platform: this.descriptor.platform, title, artist: string(item.artist) || 'Udio creator', artwork: httpsUrl(item.image_path),
          duration: duration(item.duration), url: mediaUrl, ...(publishedAt ? { publishedAt } : {}),
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem): Promise<TrustedMediaSource> {
    if (typeof item.url !== 'string' || !item.url) throw new Error('Udio item is missing its public stream')
    return dynamicMedia(item.url, { referer: 'https://www.udio.com/', 'user-agent': USER_AGENT })
  }
}

function sunoMediaUrls(item: JsonRecord): string[] {
  return array(item.media_urls).map(candidate => typeof candidate === 'string' ? candidate : string(record(candidate).url || record(candidate).src))
    .filter(value => /^https:\/\//i.test(value))
}

class SunoProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'suno', platform: 'Suno', defaultQuery: '热门', version: '0.1.0', author: 'DSHP',
    description: 'Current public Suno Explore feed with local title, creator, and tag filtering.',
    allowedHosts: ['studio-api-prod.suno.com', 'cdn1.suno.ai', 'cdn2.suno.ai', '*.cloudfront.net'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const browserToken = JSON.stringify({ token: Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64url') })
    const payload = await fetchJson('https://studio-api-prod.suno.com/api/unified/homepage/explore', this.config, {
      method: 'POST', headers: {
        accept: 'application/json', 'accept-language': 'en', 'browser-token': browserToken, 'content-type': 'application/json',
        'device-id': randomUUID(), origin: 'https://suno.com', referer: 'https://suno.com/explore', 'user-agent': USER_AGENT,
      }, body: JSON.stringify({ cursor: null }),
    })
    const terms = /^(热门|explore)$/i.test(query.trim()) ? [] : query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const seen = new Set<string>()
    const items = array(payload.feeds).map(record).flatMap(feed => array(feed.items)).map(entry => record(record(entry).content_item || entry))
      .filter(item => {
        const id = string(item.id); if (!id || seen.has(id) || boolean(item.is_public) === false || boolean(item.explicit) === true) return false
        const metadata = record(item.metadata)
        const haystack = [string(item.title), string(item.display_name), string(item.handle), string(item.display_tags), string(metadata.tags), string(metadata.prompt)].join(' ').toLocaleLowerCase()
        if (!terms.every(term => haystack.includes(term))) return false
        seen.add(id); return true
      })
    return {
      isEnd: true,
      data: items.map((item): MusicItem | undefined => {
        const mediaUrls = sunoMediaUrls(item); const mediaUrl = mediaUrls[0]
        if (!mediaUrl) return undefined
        const metadata = record(item.metadata); const publishedAt = date(item.created_at)
        return {
          id: string(item.id), platform: this.descriptor.platform, title: string(item.title) || 'Untitled Suno song',
          artist: string(item.display_name) || string(item.handle) || 'Suno creator', artwork: httpsUrl(item.image_large_url) || httpsUrl(item.image_url),
          duration: duration(metadata.duration), album: string(metadata.tags) || string(item.display_tags), url: mediaUrl, mediaUrls,
          ...(publishedAt ? { publishedAt } : {}),
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem): Promise<TrustedMediaSource> {
    const candidates = Array.isArray(item.mediaUrls) ? item.mediaUrls.filter((value): value is string => typeof value === 'string') : []
    const mediaUrl = string(item.url) || candidates[0]
    if (!mediaUrl) throw new Error('Suno item is missing its public stream')
    return dynamicMedia(mediaUrl, { origin: 'https://suno.com', referer: 'https://suno.com/', 'user-agent': USER_AGENT })
  }
}

function aesCbcBase64(value: string, key: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from('0102030405060708', 'utf8'))
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64')
}

function neteaseWeapi(payload: JsonRecord): URLSearchParams {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const entropy = randomBytes(16)
  const secret = Array.from(entropy, value => alphabet[value % alphabet.length]).join('')
  const first = aesCbcBase64(JSON.stringify(payload), '0CoJUm6Qyw8W8jud')
  const params = aesCbcBase64(first, secret)
  const reversed = Buffer.from([...secret].reverse().join(''), 'utf8')
  const padded = Buffer.alloc(128); reversed.copy(padded, padded.length - reversed.length)
  const encSecKey = publicEncrypt({ key: NETEASE_PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex').padStart(256, '0')
  return new URLSearchParams({ params, encSecKey })
}

class NeteaseProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'netease', platform: '网易云音乐', version: '0.1.0', author: 'DSHP',
    description: 'Public and free NetEase Cloud Music search and playback; VIP, trials, and unavailable tracks are rejected.',
    allowedHosts: ['music.163.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const limit = 30; const offset = (page - 1) * limit
    const payload = await fetchJson('https://music.163.com/weapi/cloudsearch/pc', this.config, {
      method: 'POST', headers: {
        accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', cookie: 'os=pc; appver=9.1.40;',
        origin: 'https://music.163.com', referer: 'https://music.163.com/search/', 'user-agent': USER_AGENT,
      }, body: neteaseWeapi({ s: query, type: 1, limit, offset, total: true, csrf_token: '' }),
    })
    if (number(payload.code) !== 200) throw new Error(`NetEase search rejected: ${String(payload.code)}`)
    const result = record(payload.result); const privileges = new Map(array(result.privileges).map(record).map(entry => [String(number(entry.id) ?? string(entry.id)), entry]))
    const songs = array(result.songs).map(record).filter(song => {
      const id = String(number(song.id) ?? string(song.id)); const privilege = privileges.get(id)
      const fee = number(song.fee) ?? number(privilege?.fee)
      return fee === 0 && (number(privilege?.st) ?? 0) >= 0
    })
    const total = number(result.songCount)
    return {
      isEnd: total === undefined ? songs.length < limit : offset + limit >= total,
      data: songs.map((song): MusicItem | undefined => {
        const id = number(song.id) ?? string(song.id); const title = string(song.name); if (id === '' || !title) return undefined
        const artists = array(song.ar || song.artists).map(entry => string(record(entry).name)).filter(Boolean).join(', ')
        const album = record(song.al || song.album); const publishedAt = date(song.publishTime)
        return {
          id: String(id), platform: this.descriptor.platform, title, artist: artists || '网易云音乐', album: string(album.name),
          artwork: httpsUrl(album.picUrl), duration: duration(song.dt ?? song.duration), ...(publishedAt ? { publishedAt } : {}), fee: 0,
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem, quality: string): Promise<TrustedMediaSource> {
    if (!/^\d+$/.test(item.id) || item.fee !== 0) throw new Error('NetEase item is not confirmed public and free')
    const level = quality === 'super' ? 'lossless' : quality === 'high' ? 'exhigh' : quality === 'low' ? 'standard' : 'higher'
    const payload = await fetchJson('https://music.163.com/weapi/song/enhance/player/url/v1', this.config, {
      method: 'POST', headers: {
        accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', cookie: 'os=pc; appver=9.1.40;',
        origin: 'https://music.163.com', referer: `https://music.163.com/song?id=${item.id}`, 'user-agent': USER_AGENT,
      }, body: neteaseWeapi({ ids: `[${item.id}]`, level, encodeType: 'aac', csrf_token: '' }),
    })
    if (number(payload.code) !== 200) throw new Error(`NetEase playback rejected: ${String(payload.code)}`)
    const source = record(array(payload.data)[0]); const mediaUrl = string(source.url)
    if (!mediaUrl || Object.keys(record(source.freeTrialInfo)).length > 0) throw new Error('NetEase returned no full public stream')
    return dynamicMedia(mediaUrl, { referer: `https://music.163.com/song?id=${item.id}`, 'user-agent': USER_AGENT })
  }
}

class XimalayaProvider implements TrustedProvider {
  readonly descriptor: PluginDescriptor = {
    id: 'ximalaya', platform: '喜马拉雅', version: '0.1.0', author: 'DSHP',
    description: 'Public Ximalaya track search with anonymous playback limited to non-paid, non-trailer tracks that expose a full public stream.',
    allowedHosts: ['www.ximalaya.com', 'mobile.ximalaya.com', '*.xmcdn.com'], installed: true, builtin: true, trusted: true,
  }
  constructor(private readonly config: ResolvedConfig) {}

  async search(query: string, page: number): Promise<{ isEnd: boolean; data: MusicItem[] }> {
    const rows = 20
    const url = new URL('https://www.ximalaya.com/revision/search/seo')
    for (const [key, value] of Object.entries({ page: String(page), rows: String(rows), spellchecker: 'true', kw: query, device: 'iPhone', core: 'track', condition: 'relation' })) url.searchParams.set(key, value)
    const payload = await fetchJson(url, this.config, { headers: { accept: 'application/json', referer: `https://www.ximalaya.com/search/${encodeURIComponent(query)}`, 'user-agent': USER_AGENT } })
    if (number(payload.ret) !== 200) throw new Error(`Ximalaya search rejected: ${string(payload.msg) || String(payload.ret)}`)
    const track = record(record(payload.data).track); const docs = array(track.docs).map(record).filter(item => boolean(item.isPaid) === false && boolean(item.isNoCopyright) === false && boolean(item.isTrailerBool) !== true)
    const total = number(track.total) ?? number(track.totalCount)
    return {
      isEnd: total === undefined ? array(track.docs).length < rows : page * rows >= total,
      data: docs.map((item): MusicItem | undefined => {
        const id = number(item.id); const title = string(item.title); if (id === undefined || !title) return undefined
        const publishedAt = date(item.updatedAt ?? item.createdAt)
        return {
          id: String(id), platform: this.descriptor.platform, title, artist: string(item.nickname) || '喜马拉雅主播', album: string(item.albumTitle),
          duration: duration(item.duration), artwork: httpsUrl(item.coverPath), ...(publishedAt ? { publishedAt } : {}), ximalayaPublic: true,
        }
      }).filter((item): item is MusicItem => item !== undefined),
    }
  }

  async media(item: MusicItem, quality: string): Promise<TrustedMediaSource> {
    if (!/^\d+$/.test(item.id) || item.ximalayaPublic !== true) throw new Error('Ximalaya item is not confirmed public and free')
    const url = `https://mobile.ximalaya.com/mobile-playpage/playpage/track/quality/${item.id}/${String(Date.now())}`
    const payload = await fetchJson(url, this.config, { headers: { accept: '*/*', origin: 'https://mobile.ximalaya.com', referer: 'https://mobile.ximalaya.com/', 'user-agent': USER_AGENT } })
    if (number(payload.ret) !== 0) throw new Error(`Ximalaya playback rejected: ${string(payload.msg) || String(payload.ret)}`)
    const details = record(record(record(record(record(record(payload.data).debugInfo).debugDetailMap).detailTrackDto).result))
    if (boolean(details.isPaid) !== false || boolean(details.isSample) === true || boolean(details.isPublic) !== true) {
      throw new Error('Ximalaya track is paid, a trailer, or unavailable')
    }
    const paths = record(details.playPathDto)
    const mediaUrl = quality === 'low'
      ? string(paths.mp332) || string(paths.playPath32) || string(paths.originPlayPath)
      : string(paths.playPathAacV224) || string(paths.playPathAacV164) || string(paths.playPathAacv224) || string(paths.playPathAacv164)
        || string(paths.mp364) || string(paths.playPath64) || string(paths.originPlayPath)
    if (!mediaUrl) throw new Error('Ximalaya returned no full public stream')
    return dynamicMedia(mediaUrl, { origin: 'https://www.ximalaya.com', referer: `https://www.ximalaya.com/sound/${item.id}`, 'user-agent': USER_AGENT })
  }
}

export function createOnlineMusicProviders(config: ResolvedConfig): TrustedProvider[] {
  return [
    new AudiomackProvider(config), new MaoerFmProvider(config), new UdioProvider(config), new SunoProvider(config),
    new NeteaseProvider(config), new XimalayaProvider(config),
  ]
}
