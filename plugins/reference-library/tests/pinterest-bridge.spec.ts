import { describe, expect, it } from 'vitest'
import { PinterestChromeBridge } from '../src/online/pinterest-bridge.ts'

function bridge(now = 1_000) {
  let clock = now
  const instance = new PinterestChromeBridge({
    defaultQuery: 'design inspiration',
    resultLimit: 2,
    extensionPath: 'C:/plugin/chrome-extension',
    now: () => clock,
    token: () => 'one-time-token',
  })
  return { instance, advance: (ms: number) => { clock += ms } }
}

describe('Pinterest normal-Chrome bridge', () => {
  it('opens Pinterest with a loopback origin and short-lived pairing token in the fragment', () => {
    const { instance } = bridge()
    const url = new URL(instance.begin('http://127.0.0.1:3185', '  concept   art  '))
    expect(url.origin).toBe('https://www.pinterest.com')
    expect(url.pathname).toBe('/search/pins/')
    expect(url.searchParams.get('q')).toBe('concept art')
    const fragment = new URLSearchParams(url.hash.slice(1))
    expect(fragment.get('dship_ref_token')).toBe('one-time-token')
    expect(fragment.get('dship_ref_origin')).toBe('http://127.0.0.1:3185')
    expect(fragment.get('dship_ref_limit')).toBe('2')
  })

  it('normalizes visible Pin cards, rejects foreign images, and returns cached native data', () => {
    const { instance } = bridge()
    instance.begin('http://127.0.0.1:3185', '')
    expect(instance.ingest('one-time-token', { results: [
      { url: 'https://www.pinterest.com/pin/123/', title: 'First', imageUrl: 'https://i.pinimg.com/736x/a/b/c.jpg' },
      { url: 'https://www.pinterest.com/pin/456/', title: 'Second', imageUrl: 'https://evil.example/tracker.jpg' },
      { url: 'https://example.com/not-a-pin', title: 'Bad' },
    ] })).toEqual({ accepted: true, resultCount: 2 })
    expect(instance.search('')).toMatchObject({
      provider: 'pinterest', query: 'design inspiration', source: 'chrome-session',
      results: [
        { id: '123', title: 'First', imageUrl: 'https://i.pinimg.com/736x/a/b/c.jpg' },
        { id: '456', title: 'Second' },
      ],
    })
  })

  it('reports login state and expires pairing sessions', () => {
    const { instance, advance } = bridge()
    instance.begin('http://localhost:3185', 'ui design')
    instance.ingest('one-time-token', { status: 'login-required', results: [] })
    expect(instance.search('ui design').notice).toBe('pinterest-login-required')
    expect(instance.status()).toMatchObject({ state: 'login-required', lastQuery: 'ui design', resultCount: 0 })
    advance(5 * 60_000 + 1)
    expect(() => instance.ingest('one-time-token', { results: [] })).toThrow('invalid or expired')
  })

  it('never exposes an OAuth configuration notice', () => {
    const { instance } = bridge()
    expect(instance.search('ideas')).toMatchObject({ notice: 'pinterest-chrome-required', results: [] })
  })

  it('accumulates capture batches, paginates them, and uses the latest real capture for an empty query', () => {
    const { instance } = bridge()
    instance.begin('http://127.0.0.1:3185', 'interaction design')
    instance.ingest('one-time-token', { results: [
      { url: 'https://www.pinterest.com/pin/101/', title: 'One', imageUrl: 'https://i.pinimg.com/736x/1.jpg' },
      { url: 'https://www.pinterest.com/pin/102/', title: 'Two', imageUrl: 'https://i.pinimg.com/736x/2.jpg' },
    ] })
    instance.ingest('one-time-token', { results: [
      { url: 'https://www.pinterest.com/pin/102/', title: 'Two again', imageUrl: 'https://i.pinimg.com/736x/2.jpg' },
      { url: 'https://www.pinterest.com/pin/103/', title: 'Three', imageUrl: 'https://i.pinimg.com/736x/3.jpg' },
    ] })
    expect(instance.search('interaction design', 0, 2).results.map(item => item.id)).toEqual(['101', '102'])
    expect(instance.search('interaction design', 2, 2).results.map(item => item.id)).toEqual(['103'])
    expect(instance.search('').results.map(item => item.id)).toEqual(['101', '102'])
    expect(instance.status()).toMatchObject({ state: 'synced', resultCount: 3 })
  })
})
