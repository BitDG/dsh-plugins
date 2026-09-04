import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MusicOverlay } from '../src/client/MusicOverlay.tsx'
import type { MusicSnapshot } from '../src/client/controller.ts'

describe('background playback surface', () => {
  it('keeps the audio element and source mounted while the music UI is inactive', () => {
    const snapshot: MusicSnapshot = {
      active: false, sidebarWidth: 240, csrf: 'csrf', plugins: [], selectedPluginId: 'youtube-music', query: 'ambient', results: [],
      current: { id: 'track', platform: 'YouTube Music', title: 'Track', artist: 'Artist' },
      source: { url: '/api/dship/music/stream/00000000-0000-4000-8000-000000000001' }, playing: true, currentTime: 12, duration: 180,
      loading: false, error: null, notice: null, generation: null,
    }
    const html = renderToStaticMarkup(<MusicOverlay useMusic={selector => selector(snapshot)} generate={async () => {}} install={async () => {}} attachAudio={() => {}} resumePlayback={() => {}} generatorOpen={false} closeGenerator={() => {}} />)
    expect(html).not.toContain('音乐工作台')
    expect(html).toContain('dmp-audio-host')
    expect(html).toContain('<audio')
    expect(html).toContain('/api/dship/music/stream/00000000-0000-4000-8000-000000000001')
  })
})
