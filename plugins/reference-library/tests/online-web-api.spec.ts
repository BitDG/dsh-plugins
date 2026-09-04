import { describe, expect, it, vi } from 'vitest'
import { API_ROOT, mountWebApi } from '../src/online/web-api.ts'

function harness(rejection?: 401 | 403) {
  let route: { handler(req: any, res: any): Promise<void> | void } | undefined
  const ctx = { webServer: { register(value: typeof route) { route = value; return () => {} } }, connection: { requestRejection() { return rejection } }, effect(callback: () => unknown) { callback() } }
  const pinterest = {
    begin: vi.fn(() => 'https://www.pinterest.com/search/pins/?q=motion#bridge'),
    ingest: vi.fn(() => ({ accepted: true, resultCount: 1 })),
    status: vi.fn(() => ({ state: 'waiting', extensionPath: 'C:/extension' })),
  }
  const service = { search: vi.fn(async (provider: string, query: string) => ({ provider, query, results: [{ provider, id: '1', title: 'Result', url: 'https://example.test/1' }] })), pinterest }
  mountWebApi(ctx as never, service as never)
  return { route: () => route!, service, pinterest }
}

function request(url: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    url, method, headers: { host: '127.0.0.1:3185', ...headers },
    async *[Symbol.asyncIterator]() { yield* bytes },
  }
}
function response() { return { status: 0, headers: {} as Record<string, string>, body: '', writeHead(status: number, headers?: object) { this.status = status; this.headers = (headers ?? {}) as Record<string, string> }, end(body = '') { this.body = body } } }

describe('secured structured search API', () => {
  it('rejects unauthenticated requests before search', async () => {
    const h = harness(401); const res = response(); await h.route().handler(request(`${API_ROOT}/search?provider=codepen&q=motion`), res)
    expect(res.status).toBe(401); expect(h.service.search).not.toHaveBeenCalled()
  })

  it.each(['codepen', 'pinterest', 'zlibrary'])('returns native data for %s', async (provider) => {
    const h = harness(); const res = response(); await h.route().handler(request(`${API_ROOT}/search?provider=${provider}&q=motion`), res)
    expect(res.status).toBe(200); expect(h.service.search).toHaveBeenCalledWith(provider, 'motion', undefined, {
      offset: 0, sort: 'relevance', refresh: false,
    })
    expect(JSON.parse(res.body).results[0].title).toBe('Result')
  })

  it('opens Pinterest only after Harness authentication', async () => {
    const rejected = harness(401); const denied = response()
    await rejected.route().handler(request(`${API_ROOT}/pinterest-bridge/open?q=motion`), denied)
    expect(denied.status).toBe(401)
    const h = harness(); const res = response()
    await h.route().handler(request(`${API_ROOT}/pinterest-bridge/open?q=motion`), res)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('pinterest.com')
    expect(h.pinterest.begin).toHaveBeenCalledWith('http://127.0.0.1:3185', 'motion')
  })

  it('accepts bridge data only from a Chrome extension with a short-lived token', async () => {
    const h = harness(401)
    const forbidden = response()
    await h.route().handler(request(`${API_ROOT}/pinterest-bridge/ingest?token=once`, 'POST', { origin: 'https://pinterest.com', 'content-type': 'application/json' }, { results: [] }), forbidden)
    expect(forbidden.status).toBe(403)
    const res = response()
    await h.route().handler(request(`${API_ROOT}/pinterest-bridge/ingest?token=once`, 'POST', { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'content-type': 'application/json' }, { results: [{}] }), res)
    expect(res.status).toBe(200)
    expect(h.pinterest.ingest).toHaveBeenCalledWith('once', { results: [{}] })
    expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnopabcdefghijklmnop')
  })

  it('rejects cross-origin and unknown providers', async () => {
    const h = harness(); const cross = response(); await h.route().handler(request(`${API_ROOT}/search?provider=codepen&q=x`, 'GET', { origin: 'https://evil.example' }), cross)
    expect(cross.status).toBe(403)
    const invalid = response(); await h.route().handler(request(`${API_ROOT}/search?provider=unknown&q=x`), invalid)
    expect(invalid.status).toBe(400)
  })

  it('forwards bounded pagination, sort, and refresh options', async () => {
    const h = harness(); const res = response()
    await h.route().handler(request(`${API_ROOT}/search?provider=zlibrary&q=design&offset=30&limit=30&sort=newest&refresh=1`), res)
    expect(res.status).toBe(200)
    expect(h.service.search).toHaveBeenCalledWith('zlibrary', 'design', undefined, {
      offset: 30, limit: 30, sort: 'newest', refresh: true,
    })
  })

  it('has no viewer, frame, input, or select endpoints', async () => {
    const h = harness()
    for (const route of ['/view', '/frame', '/input', '/select']) { const res = response(); await h.route().handler(request(`${API_ROOT}${route}`), res); expect(res.status).toBe(404) }
  })
})
