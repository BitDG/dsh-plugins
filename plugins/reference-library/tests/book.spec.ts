import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ZLIBRARY_QUERY, normalizeBook, ZLibrarySearchService } from '../src/online/book.ts'

describe('Z-Library metadata normalization', () => {
  it('keeps bounded public metadata and a same-domain HTTPS page', () => {
    expect(normalizeBook('z-library.ec', { id: 42, title: ' Example  Book ', author: 'Alice', year: 2026, language: 'English', extension: 'EPUB', filesize: '2 MB', href: '/book/42/abc', cover: 'https://covers.example/42.jpg' })).toEqual({ provider: 'zlibrary', id: '42', title: 'Example Book', author: 'Alice', year: '2026', language: 'English', extension: 'EPUB', size: '2 MB', url: 'https://z-library.ec/book/42/abc', imageUrl: 'https://covers.example/42.jpg' })
  })

  it('rejects foreign page URLs', () => { expect(normalizeBook('z-library.ec', { id: 42, title: 'Bad', href: 'https://evil.example/file' })).toBeUndefined() })

  it('probes once, normalizes results and reuses the short cache', async () => {
    const request = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/eapi/info/domains') ? new Response(JSON.stringify({ domains: [] }), { status: 200 }) : new Response(JSON.stringify({ books: [{ id: '7', title: 'Cached', href: '/book/7/hash' }] }), { status: 200 }))
    const service = new ZLibrarySearchService({ domain: 'z-library.ec', timeoutMs: 2_000, resultLimit: 10 }, request)
    const first = await service.search('cache me'); const second = await service.search(' CACHE ME ')
    expect(first.results[0]?.title).toBe('Cached'); expect(second).toEqual(first); expect(request).toHaveBeenCalledTimes(2)
  })

  it('loads real default books when the @ query is empty', async () => {
    const request = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/eapi/info/domains')
      ? new Response(JSON.stringify({ domains: [] }), { status: 200 })
      : new Response(JSON.stringify({ books: [{ id: '8', title: 'Default book', href: '/book/8/hash' }] }), { status: 200 }))
    const service = new ZLibrarySearchService({ domain: 'z-library.ec', timeoutMs: 2_000, resultLimit: 10 }, request)
    const payload = await service.search('')
    expect(payload.query).toBe(DEFAULT_ZLIBRARY_QUERY)
    expect(payload.results[0]?.title).toBe('Default book')
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain(`message=${DEFAULT_ZLIBRARY_QUERY}`)
  })

  it('uses a configured default book query', async () => {
    const request = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/eapi/info/domains')
      ? new Response(JSON.stringify({ domains: [] }), { status: 200 })
      : new Response(JSON.stringify({ books: [] }), { status: 200 }))
    const service = new ZLibrarySearchService({ domain: 'z-library.ec', timeoutMs: 2_000, resultLimit: 10, defaultQuery: 'visual systems' }, request)
    await expect(service.search('')).resolves.toMatchObject({ query: 'visual systems', results: [] })
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('message=visual+systems')
  })

  it('re-fetches and orders books when a sort control requests refresh', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ domains: ['z-library.ec'] }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ books: [
        { id: 1, title: 'Older', year: 1999, href: '/book/1/older' },
        { id: 2, title: 'Newest', year: 2025, href: '/book/2/newest' },
      ] }), { status: 200 }))
    const service = new ZLibrarySearchService({ domain: 'z-library.ec', timeoutMs: 2_000, resultLimit: 10 }, request)
    expect((await service.search('design', undefined, { sort: 'newest', refresh: true })).results.map(item => item.title)).toEqual(['Newest', 'Older'])
    expect((await service.search('design', undefined, { sort: 'oldest', refresh: true })).results.map(item => item.title)).toEqual(['Older', 'Newest'])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not call the provider for one-character searches', async () => {
    const request = vi.fn<typeof fetch>(); const service = new ZLibrarySearchService({ timeoutMs: 2_000, resultLimit: 10 }, request)
    await expect(service.search('a')).resolves.toEqual({ provider: 'zlibrary', query: 'a', results: [] }); expect(request).not.toHaveBeenCalled()
  })
})
