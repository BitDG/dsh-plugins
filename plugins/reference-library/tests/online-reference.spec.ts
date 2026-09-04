import { describe, expect, it } from 'vitest'
import { appendReferenceToDraft, formatReference, normalizeSelection, providerStartUrl } from '../src/online/reference.ts'

describe('online result normalization', () => {
  it('normalizes Pinterest detail data and image preview', () => {
    expect(normalizeSelection('pinterest', { url: 'https://uk.pinterest.com/pin/12345/?x=1', title: '  Layout idea ', imageUrl: 'https://i.pinimg.com/example.jpg' })).toEqual({ provider: 'pinterest', id: '12345', url: 'https://www.pinterest.com/pin/12345/', title: 'Layout idea', imageUrl: 'https://i.pinimg.com/example.jpg' })
  })

  it('normalizes a CodePen record and derives its preview URL', () => {
    expect(normalizeSelection('codepen', { url: 'https://codepen.io/alice/pen/AbC12?editors=1010', title: 'Motion' })).toEqual({ provider: 'codepen', id: 'AbC12', author: 'alice', url: 'https://codepen.io/alice/pen/AbC12', title: 'Motion', embedUrl: 'https://codepen.io/alice/embed/AbC12' })
  })

  it('rejects search pages, foreign hosts, and non-HTTPS pages', () => {
    expect(() => normalizeSelection('pinterest', { url: 'https://www.pinterest.com/search/pins/?q=ui' })).toThrow('Pin')
    expect(() => normalizeSelection('codepen', { url: 'https://evil.example/alice/pen/demo' })).toThrow('CodePen')
    expect(() => normalizeSelection('codepen', { url: 'http://codepen.io/alice/pen/demo' })).toThrow('HTTPS')
  })

  it('appends without submitting and supports book metadata only', () => {
    const pen = normalizeSelection('codepen', { url: 'https://codepen.io/alice/pen/demo', title: 'Demo' })
    expect(appendReferenceToDraft('原草稿', pen)).toContain('原草稿\n\n[CodePen：Demo]')
    expect(formatReference({ provider: 'zlibrary', url: 'https://z-library.ec/book/1/x', title: 'Book', author: 'Alice', year: '2024' })).toBe('[Z-Library：Book](https://z-library.ec/book/1/x)\nAlice · 2024')
  })

  it('builds real provider search addresses', () => {
    expect(providerStartUrl('pinterest', 'game ui')).toBe('https://www.pinterest.com/search/pins/?q=game%20ui')
    expect(providerStartUrl('codepen', 'shader')).toBe('https://codepen.io/search/pens?q=shader')
  })
})
