import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MusicSidebar } from '../src/client/MusicSidebar.tsx'
import type { MusicSnapshot } from '../src/client/controller.ts'

describe('compact music sidebar', () => {
  it('contains search, scrollable results, and playback controls in the sidebar', () => {
    const snapshot: MusicSnapshot = {
      active: true, sidebarWidth: 278, csrf: 'csrf', plugins: [{ id: 'youtube-music', platform: 'YouTube Music', version: '1', author: 'DSHP', description: '', allowedHosts: [], installed: true, builtin: true, trusted: true }], selectedPluginId: 'youtube-music', query: 'ambient',
      results: [{ id: 'track', platform: 'YouTube Music', title: 'Ambient Track', artist: 'Artist', publishedAt: '2025-04-03T00:00:00Z' }], current: null, source: null, playing: false, currentTime: 0, duration: 0, loading: false, error: null, notice: null, generation: null,
    }
    const html = renderToStaticMarkup(<MusicSidebar sidebarWidth={278} useMusic={selector => selector(snapshot)} activate={() => {}} deactivate={() => {}} selectPlugin={() => {}} setQuery={() => {}} search={async () => {}} play={async () => {}} togglePlayback={() => {}} seekPlayback={() => {}} />)
    expect(html).toContain('aria-label="搜索音乐"')
    expect(html).toContain('aria-label="搜索结果"')
    expect(html).toContain('Ambient Track')
    expect(html).toContain('aria-label="选择音乐平台"')
    expect(html).toContain('<option value="youtube-music" selected="">YouTube Music</option>')
    expect(html).not.toContain('dmp-source-list')
    expect(html).not.toContain('dmp-ai-link')
    expect(html).toContain('2025/04/03')
    expect(html).toContain('dmp-progress')
    expect(html).toContain('overflow-y:auto')
  })
})
