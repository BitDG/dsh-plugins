import { randomBytes } from 'node:crypto'
import type { OnlineSearchPayload, OnlineSearchResult } from './types.ts'
import { normalizeSelection, providerStartUrl, type CapturePayload } from './reference.ts'

const SESSION_TTL_MS = 5 * 60_000
const CAPTURE_TTL_MS = 30 * 60_000
const MAX_CAPTURE_RESULTS = 1_000

export type PinterestBridgeState = 'waiting' | 'synced' | 'login-required'

export interface PinterestBridgeStatus {
  readonly state: PinterestBridgeState
  readonly extensionPath: string
  readonly lastQuery?: string
  readonly resultCount?: number
  readonly syncedAt?: string
}

interface Session {
  readonly query: string
  readonly expiresAt: number
}

interface Capture {
  readonly query: string
  readonly results: readonly OnlineSearchResult[]
  readonly state: Exclude<PinterestBridgeState, 'waiting'>
  readonly capturedAt: number
}

interface BridgeOptions {
  readonly defaultQuery: string
  readonly resultLimit: number
  readonly extensionPath: string
  readonly now?: () => number
  readonly token?: () => string
}

interface IngestPayload {
  readonly status?: unknown
  readonly results?: unknown
}

function normalizedQuery(value: string, fallback: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 200) || fallback
}

function cacheKey(value: string): string { return value.toLocaleLowerCase() }

function pinterestImage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'pinimg.com' || url.hostname.endsWith('.pinimg.com'))
      ? url.href
      : undefined
  } catch { return undefined }
}

function normalizeResult(value: unknown): OnlineSearchResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const record = value as CapturePayload
    const result = normalizeSelection('pinterest', record)
    const imageUrl = pinterestImage(result.imageUrl)
    return { ...result, ...(imageUrl === undefined ? { imageUrl: undefined } : { imageUrl }) }
  } catch { return undefined }
}

function pinterestTarget(query: string): string {
  try {
    const url = new URL(query)
    if (url.protocol === 'https:' && (url.hostname === 'pinterest.com' || url.hostname.endsWith('.pinterest.com'))) {
      url.hash = ''
      return url.href
    }
  } catch {
    // A normal keyword uses the Pinterest search page.
  }
  return providerStartUrl('pinterest', query)
}

/** Short-lived exchange between authenticated DSH and a Pinterest content script in normal Chrome. */
export class PinterestChromeBridge {
  private readonly sessions = new Map<string, Session>()
  private readonly captures = new Map<string, Capture>()
  private latest: Capture | undefined
  private readonly now: () => number
  private readonly makeToken: () => string

  constructor(private readonly options: BridgeOptions) {
    this.now = options.now ?? Date.now
    this.makeToken = options.token ?? (() => randomBytes(24).toString('base64url'))
  }

  private prune(): void {
    const now = this.now()
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token)
    for (const [key, capture] of this.captures) if (capture.capturedAt + CAPTURE_TTL_MS <= now) this.captures.delete(key)
    if (this.latest !== undefined && this.latest.capturedAt + CAPTURE_TTL_MS <= now) this.latest = undefined
  }

  search(value: string, rawOffset = 0, rawLimit = this.options.resultLimit): OnlineSearchPayload {
    this.prune()
    const entered = value.replace(/\s+/g, ' ').trim().slice(0, 200)
    const query = normalizedQuery(value, this.options.defaultQuery)
    const exact = this.captures.get(cacheKey(query))
    const capture = exact ?? (entered === '' && this.latest?.state === 'synced' ? this.latest : undefined)
    const offset = Math.max(0, Math.min(MAX_CAPTURE_RESULTS, Math.floor(rawOffset)))
    const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)))
    if (capture?.state === 'synced') return {
      provider: 'pinterest', query, results: capture.results.slice(offset, offset + limit), source: 'chrome-session',
      hasMore: capture.results.length > offset + limit || capture.results.length < MAX_CAPTURE_RESULTS,
    }
    return {
      provider: 'pinterest',
      query,
      results: [],
      source: 'chrome-session',
      notice: capture?.state === 'login-required' ? 'pinterest-login-required' : 'pinterest-chrome-required',
    }
  }

  begin(origin: string, value: string): string {
    this.prune()
    const query = normalizedQuery(value, this.options.defaultQuery)
    const token = this.makeToken()
    this.sessions.set(token, { query, expiresAt: this.now() + SESSION_TTL_MS })
    const target = new URL(pinterestTarget(query))
    const bridge = new URLSearchParams({
      dship_ref_token: token,
      dship_ref_origin: origin,
      dship_ref_query: query,
      dship_ref_limit: String(this.options.resultLimit),
    })
    target.hash = bridge.toString()
    return target.href
  }

  ingest(token: string, payload: IngestPayload): { accepted: true; resultCount: number } {
    this.prune()
    const session = this.sessions.get(token)
    if (session === undefined) throw new Error('Pinterest bridge session is invalid or expired')
    const status = payload.status === 'login-required' ? 'login-required' : 'synced'
    const raw = Array.isArray(payload.results) ? payload.results.slice(0, 100) : []
    const previous = this.captures.get(cacheKey(session.query))
    const deduped = new Map<string, OnlineSearchResult>(previous?.state === 'synced'
      ? previous.results.map(result => [result.url, result])
      : [])
    for (const item of raw) {
      const result = normalizeResult(item)
      if (result !== undefined) deduped.set(result.url, result)
      if (deduped.size >= MAX_CAPTURE_RESULTS) break
    }
    const capture: Capture = {
      query: session.query,
      results: status === 'login-required' ? [] : [...deduped.values()],
      state: status,
      capturedAt: this.now(),
    }
    this.captures.set(cacheKey(session.query), capture)
    this.latest = capture
    return { accepted: true, resultCount: capture.results.length }
  }

  status(): PinterestBridgeStatus {
    this.prune()
    if (this.latest === undefined) return { state: 'waiting', extensionPath: this.options.extensionPath }
    return {
      state: this.latest.state,
      extensionPath: this.options.extensionPath,
      lastQuery: this.latest.query,
      resultCount: this.latest.results.length,
      syncedAt: new Date(this.latest.capturedAt).toISOString(),
    }
  }
}
