import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { OnlineReferenceService } from './service.ts'
import type { ReferenceProvider } from './types.ts'
import type { OnlineSearchOptions, ZLibrarySort } from './types.ts'

export const API_ROOT = '/api/dship/reference-library/online'
export const PINTEREST_BRIDGE_ROOT = `${API_ROOT}/pinterest-bridge`

type WebContext = Context & {
  webServer: { register(route: { kind: 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void }
  connection: { requestRejection(req: IncomingMessage): 401 | 403 | undefined }
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }

function reply(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(value))
}

function replyBridge(res: ServerResponse, status: number, value: unknown, origin?: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(origin === undefined ? {} : {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    }),
  })
  res.end(status === 204 ? undefined : JSON.stringify(value))
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`
}

function parseProvider(value: string | null): ReferenceProvider {
  if (value !== 'pinterest' && value !== 'codepen' && value !== 'zlibrary') throw new HttpError(400, 'provider must be codepen, pinterest, or zlibrary')
  return value
}

function searchOptions(url: URL): OnlineSearchOptions {
  const offset = Math.max(0, Math.min(10_000, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0))
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '0', 10) || undefined
  const limit = rawLimit === undefined ? undefined : Math.max(1, Math.min(50, rawLimit))
  const rawSort = url.searchParams.get('sort')
  const sort: ZLibrarySort = rawSort === 'newest' || rawSort === 'oldest' || rawSort === 'title' ? rawSort : 'relevance'
  return { offset, ...(limit === undefined ? {} : { limit }), sort, refresh: url.searchParams.get('refresh') === '1' }
}

function loopbackOrigin(req: IncomingMessage): string {
  const url = new URL(`http://${req.headers.host ?? ''}`)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') throw new HttpError(400, 'Pinterest Chrome bridge requires a loopback DSH origin')
  return url.origin
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'content-type must be application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 128 * 1024) throw new HttpError(413, 'request body is too large')
    chunks.push(buffer)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch { throw new HttpError(400, 'request body must be a JSON object') }
}

function extensionOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : undefined
}

export function mountWebApi(ctx: Context, service: Pick<OnlineReferenceService, 'search' | 'pinterest'>): void {
  const web = ctx as WebContext
  ctx.effect(() => web.webServer.register({
    kind: 'prefix', path: API_ROOT,
    async handler(req, res) {
      try {
        const url = new URL(req.url ?? '/', 'http://local')
        const route = url.pathname.slice(API_ROOT.length) || '/'

        // The normal-Chrome extension has no Harness session cookie. This single
        // route instead requires a short-lived random pairing token and an extension origin.
        if (route === '/pinterest-bridge/ingest') {
          const origin = extensionOrigin(req)
          if (origin === undefined) { replyBridge(res, 403, { error: 'Chrome extension origin required' }); return }
          if (req.method === 'OPTIONS') { replyBridge(res, 204, {}, origin); return }
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST, OPTIONS' }); res.end(); return }
          const token = url.searchParams.get('token')?.trim() ?? ''
          try { replyBridge(res, 200, service.pinterest.ingest(token, await jsonBody(req)), origin) }
          catch (error) { replyBridge(res, 401, { error: error instanceof Error ? error.message : String(error) }, origin) }
          return
        }

        const rejection = web.connection.requestRejection(req)
        if (rejection !== undefined) { reply(res, rejection, { error: rejection === 401 ? 'Authentication required' : 'Request authority rejected' }); return }
        if (!sameOrigin(req)) { reply(res, 403, { error: 'Cross-origin request rejected' }); return }

        if (route === '/pinterest-bridge/open') {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
          const query = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
          res.writeHead(302, { location: service.pinterest.begin(loopbackOrigin(req), query), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
          res.end()
          return
        }
        if (route === '/pinterest-bridge/status') {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
          reply(res, 200, service.pinterest.status())
          return
        }
        if (route !== '/search') { reply(res, 404, { error: 'Not found' }); return }
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const query = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
        reply(res, 200, await service.search(parseProvider(url.searchParams.get('provider')), query, undefined, searchOptions(url)))
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 502
        reply(res, status, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), `reference-library: structured search ${API_ROOT}`)
}
