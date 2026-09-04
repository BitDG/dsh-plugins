import { randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { MusicService } from './service.ts'
import type { MusicItem } from './types.ts'

const API_ROOT = '/api/dship/music'
const BODY_LIMIT = 512 * 1024

type WebContext = Context & {
  webServer: { register(route: { kind: 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void }
  connection: { requestRejection(request: IncomingMessage): 401 | 403 | undefined }
}

function reply(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`
}

function csrfMatches(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers['x-music-csrf']
  if (typeof supplied !== 'string') return false
  const left = Buffer.from(supplied); const right = Buffer.from(token)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requestedRange(req: IncomingMessage): string | undefined {
  const value = req.headers.range
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^bytes=(?:\d+-\d*|\d*-\d+)$/.test(value)) throw new Error('Invalid Range header')
  return value
}

async function pipeMedia(res: ServerResponse, upstream: Response): Promise<void> {
  const headers: Record<string, string> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name)
    if (value !== null) headers[name] = value
  }
  res.writeHead(upstream.status, headers)
  if (upstream.body === null) { res.end(); return }
  try {
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      if (!res.write(Buffer.from(chunk))) await once(res, 'drain')
    }
    res.end()
  } catch { res.destroy() }
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); bytes += chunk.length
    if (bytes > BODY_LIMIT) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be an object')
  return value as Record<string, unknown>
}

export function mountWebApi(ctx: Context, service: MusicService): void {
  ctx.inject(['webServer', 'connection'], (injected: Context) => {
    const web = injected as WebContext; const csrf = randomBytes(32).toString('base64url')
    web.effect(() => web.webServer.register({
      kind: 'prefix', path: API_ROOT,
      async handler(req, res) {
        try {
          const rejection = web.connection.requestRejection(req)
          if (rejection !== undefined) { reply(res, rejection, { error: rejection === 401 ? 'Authentication required' : 'Request authority rejected' }); return }
          if (!sameOrigin(req)) { reply(res, 403, { error: 'Cross-origin request rejected' }); return }
          const url = new URL(req.url ?? '/', 'http://local'); const route = url.pathname.slice(API_ROOT.length) || '/'; const method = req.method ?? 'GET'
          if (method !== 'GET' && !csrfMatches(req, csrf)) { reply(res, 403, { error: 'Invalid CSRF token' }); return }
          if (route === '/bootstrap' && method === 'GET') { reply(res, 200, { csrf, plugins: service.plugins() }); return }
          if (route.startsWith('/stream/') && method === 'GET') {
            const ticket = route.slice('/stream/'.length)
            await pipeMedia(res, await service.stream(ticket, requestedRange(req))); return
          }
          if (route === '/search' && method === 'POST') {
            const body = await jsonBody(req)
            if (typeof body.pluginId !== 'string' || typeof body.query !== 'string') throw new Error('pluginId and query must be strings')
            reply(res, 200, await service.search(body.pluginId, body.query, Number.isInteger(body.page) ? body.page as number : 1)); return
          }
          if (route === '/source' && method === 'POST') {
            const body = await jsonBody(req)
            if (typeof body.pluginId !== 'string' || body.item === null || typeof body.item !== 'object' || Array.isArray(body.item)) throw new Error('pluginId and item are required')
            reply(res, 200, await service.media(body.pluginId, body.item as MusicItem, typeof body.quality === 'string' ? body.quality : 'standard')); return
          }
          if (route === '/plugins/review' && method === 'POST') {
            const body = await jsonBody(req)
            if (typeof body.code !== 'string') throw new Error('code must be a string')
            reply(res, 201, await service.review(body.code)); return
          }
          if (route === '/plugins/install' && method === 'POST') {
            const body = await jsonBody(req)
            if (typeof body.reviewId !== 'string' || typeof body.confirmed !== 'boolean') throw new Error('reviewId and confirmed are required')
            reply(res, 201, { plugin: service.install(body.reviewId, body.confirmed), plugins: service.plugins() }); return
          }
          if (route === '/generations' && method === 'POST') {
            const body = await jsonBody(req)
            if (typeof body.sourceUrl !== 'string' || typeof body.query !== 'string' || typeof body.author !== 'string' || typeof body.authorized !== 'boolean') throw new Error('sourceUrl, query, author, and authorized are required')
            reply(res, 201, service.createGeneration({ sourceUrl: body.sourceUrl, query: body.query, author: body.author, authorized: body.authorized })); return
          }
          if (route === '/generation' && method === 'GET') {
            const id = url.searchParams.get('id') ?? ''
            if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid generation id')
            reply(res, 200, await service.generation(id)); return
          }
          reply(res, 404, { error: 'Not found' })
        } catch (error) { reply(res, 400, { error: error instanceof Error ? error.message : String(error) }) }
      },
    }), `music-player: ${API_ROOT}`)
  })
}
