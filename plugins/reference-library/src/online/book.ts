import type { OnlineSearchOptions, OnlineSearchPayload, OnlineSearchResult, ZLibrarySort } from './types.ts'

export const DEFAULT_ZLIBRARY_QUERY = 'design'

const DEFAULT_DOMAINS = ['z-library.ec', 'z-library.sk', '1lib.sk', 'zh.z-lib.fm'] as const
const HEALTH_TTL_MS = 5 * 60_000
const SEARCH_TTL_MS = 30_000

export interface BookSearchConfig { readonly domain?: string; readonly defaultQuery?: string; readonly timeoutMs: number; readonly resultLimit: number }
type CachedSearch = { readonly expiresAt: number; readonly payload: OnlineSearchPayload }

function compact(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text === '' ? undefined : text.slice(0, limit)
}

function configuredDomain(value?: string): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const parsed = new URL(text.includes('://') ? text : `https://${text}`)
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '' || parsed.pathname !== '/') {
    throw new Error('Z-Library domain must be an HTTPS hostname without credentials, a port, or a path')
  }
  return parsed.hostname.toLowerCase()
}

function bookUrl(domain: string, raw: Record<string, unknown>): string | undefined {
  const href = compact(raw.href ?? raw.url, 4096)
  if (href !== undefined) {
    try {
      const parsed = new URL(href, `https://${domain}/`)
      if (parsed.protocol !== 'https:' || parsed.hostname !== domain) return undefined
      parsed.hash = ''
      return parsed.href
    } catch { return undefined }
  }
  const id = compact(raw.id, 80)
  const hash = compact(raw.hash ?? raw.book_hash, 160)
  return id === undefined || hash === undefined ? undefined : `https://${domain}/book/${encodeURIComponent(id)}/${encodeURIComponent(hash)}`
}

export function normalizeBook(domain: string, raw: unknown): OnlineSearchResult | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const title = compact(record.title ?? record.name, 240)
  const id = compact(record.id, 80)
  const url = bookUrl(domain, record)
  if (title === undefined || id === undefined || url === undefined) return undefined
  const optional = (key: 'author' | 'year' | 'language' | 'extension' | 'size' | 'imageUrl', value: unknown, limit: number) => {
    const text = compact(value, limit)
    if (text === undefined) return {}
    if (key === 'imageUrl') {
      try { if (new URL(text).protocol !== 'https:') return {} } catch { return {} }
    }
    return { [key]: text }
  }
  return {
    provider: 'zlibrary', id, title, url,
    ...optional('author', record.author, 240), ...optional('year', record.year, 24),
    ...optional('language', record.language, 80), ...optional('extension', record.extension, 24),
    ...optional('size', record.filesize ?? record.size, 40),
    ...optional('imageUrl', record.cover ?? record.cover_url, 4096),
  }
}

function combinedSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return outer === undefined ? timeout : AbortSignal.any([outer, timeout])
}

export class ZLibrarySearchService {
  private selected?: { readonly domain: string; readonly expiresAt: number }
  private readonly cache = new Map<string, CachedSearch>()
  private readonly configured?: string

  constructor(private readonly config: BookSearchConfig, private readonly request: typeof fetch = fetch) {
    this.configured = configuredDomain(config.domain)
  }

  private domains(): readonly string[] { return this.configured === undefined ? DEFAULT_DOMAINS : [this.configured] }

  private async healthy(domain: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.request(`https://${domain}/eapi/info/domains`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 DSH-Reference-Library/0.4' }, redirect: 'manual', signal: combinedSignal(this.config.timeoutMs, signal) })
      if (!response.ok || response.status !== 200) return false
      const value = await response.json() as unknown
      return value !== null && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).domains)
    } catch { return false }
  }

  private async resolveDomain(signal?: AbortSignal): Promise<string> {
    if (this.selected !== undefined && this.selected.expiresAt > Date.now()) return this.selected.domain
    for (const domain of this.domains()) {
      if (await this.healthy(domain, signal)) {
        this.selected = { domain, expiresAt: Date.now() + HEALTH_TTL_MS }
        return domain
      }
    }
    throw new Error('当前没有可用的 Z-Library 元数据接口')
  }

  async search(rawQuery: string, signal?: AbortSignal, options: OnlineSearchOptions = {}): Promise<OnlineSearchPayload> {
    const enteredQuery = rawQuery.replace(/\s+/g, ' ').trim().slice(0, 200)
    const query = enteredQuery === '' ? this.config.defaultQuery ?? DEFAULT_ZLIBRARY_QUERY : enteredQuery
    if (query.length < 2) return { provider: 'zlibrary', query, results: [] }
    const sort: ZLibrarySort = options.sort ?? 'relevance'
    const key = `${query.toLocaleLowerCase()}\u0000${sort}`
    const cached = this.cache.get(key)
    if (options.refresh !== true && cached !== undefined && cached.expiresAt > Date.now()) return cached.payload
    const domain = await this.resolveDomain(signal)
    const response = await this.request(`https://${domain}/eapi/book/search`, {
      method: 'POST', redirect: 'manual', signal: combinedSignal(this.config.timeoutMs, signal),
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 DSH-Reference-Library/0.4' },
      body: new URLSearchParams({ message: query, page: '1', limit: String(this.config.resultLimit) }),
    })
    if (!response.ok || response.status !== 200) { this.selected = undefined; throw new Error(`Z-Library 元数据搜索返回 HTTP ${response.status}`) }
    const value = await response.json() as unknown
    if (value === null || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).books)) throw new Error('Z-Library 元数据搜索返回了无法识别的数据')
    const results = (value as { books: unknown[] }).books.map(item => normalizeBook(domain, item)).filter((item): item is OnlineSearchResult => item !== undefined).slice(0, this.config.resultLimit)
    if (sort === 'title') results.sort((left, right) => left.title.localeCompare(right.title))
    if (sort === 'newest' || sort === 'oldest') {
      const direction = sort === 'newest' ? -1 : 1
      results.sort((left, right) => {
        const leftYear = Number.parseInt(left.year ?? '', 10)
        const rightYear = Number.parseInt(right.year ?? '', 10)
        if (!Number.isFinite(leftYear)) return Number.isFinite(rightYear) ? 1 : 0
        if (!Number.isFinite(rightYear)) return -1
        return (leftYear - rightYear) * direction
      })
    }
    const payload = { provider: 'zlibrary' as const, query, results, source: domain }
    this.cache.set(key, { expiresAt: Date.now() + SEARCH_TTL_MS, payload })
    return payload
  }
}
