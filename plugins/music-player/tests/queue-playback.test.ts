import { afterEach, describe, expect, it, vi } from 'vitest'
import { MusicController } from '../src/client/controller.ts'

class FakeAudio extends EventTarget {
  paused = true
  ended = false
  currentTime = 0
  duration = 90
  async play(): Promise<void> { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')) }
  pause(): void { this.paused = true; this.dispatchEvent(new Event('pause')) }
  removeAttribute(): void {}
  load(): void { this.currentTime = 0; this.duration = Number.NaN }
}

afterEach(() => { vi.restoreAllMocks() })

describe('search result playback queue', () => {
  it('starts with the browser-verified Audiomack source', () => {
    const controller = new MusicController(() => {})
    expect(controller.store.getSnapshot()).toMatchObject({ selectedPluginId: 'audiomack', query: 'ambient' })
    controller.dispose()
  })

  it('loads the next result when the current track ends', async () => {
    const results = [
      { id: 'first', platform: 'Fixture', title: 'First', artist: 'Artist', publishedAt: '2026-02-01T00:00:00Z' },
      { id: 'second', platform: 'Fixture', title: 'Second', artist: 'Artist', publishedAt: '2026-01-01T00:00:00Z' },
    ]
    let sourceCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/bootstrap')) return new Response(JSON.stringify({ csrf: 'csrf', plugins: [{ id: 'fixture', platform: 'Fixture', defaultQuery: 'music' }] }), { status: 200 })
      if (url.endsWith('/search')) return new Response(JSON.stringify({ data: results }), { status: 200 })
      if (url.endsWith('/source')) { sourceCount += 1; return new Response(JSON.stringify({ url: `/stream/${String(sourceCount)}` }), { status: 200 }) }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    })
    const controller = new MusicController(() => {})
    const audio = new FakeAudio()
    controller.attachAudio(audio as unknown as HTMLAudioElement)
    await controller.ensureLoaded()
    controller.setQuery('music')
    await controller.search()
    await controller.play(results[0]!)

    audio.paused = true; audio.ended = true; audio.currentTime = 90
    audio.dispatchEvent(new Event('ended'))

    await vi.waitFor(() => {
      expect(controller.store.getSnapshot()).toMatchObject({ current: results[1], source: { url: '/stream/2' } })
    })
    expect(sourceCount).toBe(2)

    controller.selectPlugin('fixture')
    expect(audio.paused).toBe(true)
    expect(controller.store.getSnapshot()).toMatchObject({ current: null, source: null, playing: false })
  })
})
