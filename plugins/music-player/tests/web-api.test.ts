import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { mountWebApi } from '../src/web-api.ts'

function mounted(rejection: 401 | 403 | undefined, provided?: object) {
  let handler: ((req: never, res: never) => Promise<void>) | undefined
  const service = provided ?? { plugins: () => [{ id: 'fixture' }] }
  const ctx = {
    inject(_deps: string[], callback: (value: unknown) => void) { callback(this) },
    effect(factory: () => unknown) { factory() },
    webServer: { register(route: { handler(req: never, res: never): Promise<void> }) { handler = route.handler; return () => {} } },
    connection: { requestRejection() { return rejection } },
  }
  mountWebApi(ctx as unknown as Context, service as never)
  return handler!
}

async function request(handler: (req: never, res: never) => Promise<void>) {
  const req = Readable.from([]) as Readable & { method: string; url: string; headers: Record<string, string> }
  req.method = 'GET'; req.url = '/api/dship/music/bootstrap'; req.headers = { host: '127.0.0.1:3182' }
  let status = 0; let body = ''
  const res = { writeHead(value: number) { status = value }, end(value: string) { body = value } }
  await handler(req as never, res as never)
  return { status, body: JSON.parse(body) as Record<string, unknown> }
}

describe('music Web authentication boundary', () => {
  it('rejects unauthenticated access before data', async () => {
    expect(await request(mounted(401))).toMatchObject({ status: 401, body: { error: 'Authentication required' } })
  })
  it('returns plugins and CSRF to authenticated access', async () => {
    const result = await request(mounted(undefined))
    expect(result.status).toBe(200); expect(result.body.plugins).toEqual([{ id: 'fixture' }]); expect(typeof result.body.csrf).toBe('string')
  })

  it('proxies an authenticated byte range with only safe media headers', async () => {
    const service = {
      plugins: () => [],
      async stream(ticket: string, range?: string) {
        expect(ticket).toBe('00000000-0000-4000-8000-000000000001'); expect(range).toBe('bytes=0-3')
        return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-3/9', 'x-upstream-secret': 'blocked' } })
      },
    }
    const handler = mounted(undefined, service)
    const req = Readable.from([]) as Readable & { method: string; url: string; headers: Record<string, string> }
    req.method = 'GET'; req.url = '/api/dship/music/stream/00000000-0000-4000-8000-000000000001'; req.headers = { host: '127.0.0.1:3182', range: 'bytes=0-3' }
    let status = 0; let headers: Record<string, string> = {}; const chunks: Buffer[] = []
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } }) as Writable & { writeHead(status: number, values: Record<string, string>): void }
    res.writeHead = (value, values) => { status = value; headers = values }
    await handler(req as never, res as never)
    expect(status).toBe(206); expect(headers['content-type']).toBe('audio/mp4'); expect(headers['x-upstream-secret']).toBeUndefined()
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]))
  })
})
