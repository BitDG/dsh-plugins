import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTrustedProviders } from '../src/trusted-providers.ts'
import type { ResolvedConfig } from '../src/config.ts'

const config: ResolvedConfig = {
  storageRoot: 'F:/VibeSpace/DSHP/tmp/music-provider-tests',
  runnerTimeoutMs: 8_000,
  requestTimeoutMs: 6_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxPluginBytes: 256 * 1024,
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.restoreAllMocks() })

describe('trusted music providers', () => {
  it('registers only online music and white-noise platforms without starting network work', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const providers = createTrustedProviders(config)
    expect([...providers.keys()]).toEqual([
      'bilibili', 'youtube-music', 'audiomack', 'maoer-fm', 'udio', 'suno', 'netease', 'ximalaya',
      'somafm', 'radio-browser', 'white-noise',
    ])
    expect([...providers.values()].every(provider => provider.descriptor.trusted === true)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finds the matching Bilibili UP creator and maps submissions newest first', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ code: 0, data: { b_3: 'device-3', b_4: 'device-4' } }))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [
        { mid: 200, uname: '测试音乐分部', videos: 5 },
        { mid: 100, uname: '<em>测试音乐</em>', videos: 40 },
      ] } }))
      .mockResolvedValueOnce(json({ code: 0, data: { nav: {
        img: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
        sub: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
      } } }))
      .mockResolvedValueOnce(json({ code: 0, data: {
        page: { pn: 1, ps: 30, count: 2 },
        list: { vlist: [
          { bvid: 'BV1older', aid: 41, title: '较早投稿', author: '测试音乐', length: '1:23', pic: '//i.example/older.jpg', created: 1_700_000_000 },
          { bvid: 'BV1newer', aid: 42, title: '最新投稿', author: '测试音乐', length: '2:03', pic: '//i.example/newer.jpg', created: 1_800_000_000 },
        ] },
      } }))
      .mockResolvedValueOnce(json({ code: 0, data: { cid: 99 } }))
      .mockResolvedValueOnce(json({ code: 0, data: { dash: { audio: [{ baseUrl: 'https://xy.example.bilivideo.cn/audio.m4s', bandwidth: 64_000 }] } } }))
    const provider = createTrustedProviders(config).get('bilibili')!
    const result = await provider.search('测试音乐', 1)
    expect(result.data.map(item => item.id)).toEqual(['BV1newer', 'BV1older'])
    expect(result.data[0]).toMatchObject({ title: '最新投稿', artist: '测试音乐', duration: 123, publishedAt: '2027-01-15T08:00:00.000Z' })
    const creatorUrl = new URL(String(fetch.mock.calls[1]?.[0]))
    expect(creatorUrl.searchParams.get('search_type')).toBe('bili_user')
    const archiveUrl = new URL(String(fetch.mock.calls[3]?.[0]))
    expect(archiveUrl.pathname).toBe('/x/space/wbi/arc/search')
    expect(archiveUrl.searchParams.get('mid')).toBe('100')
    expect(archiveUrl.searchParams.get('order')).toBe('pubdate')
    expect(archiveUrl.searchParams.get('w_rid')).toMatch(/^[a-f0-9]{32}$/)
    const source = await provider.media(result.data[0]!, 'standard')
    expect(source.url).toBe('https://xy.example.bilivideo.cn/audio.m4s')
    expect(source.headers?.referer).toContain('/video/BV1newer')
    expect(source.allowedMediaHosts).toContain('*.bilivideo.cn')
  })

  it('returns no Bilibili submissions when the UP creator search has no match', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ code: 0, data: { b_3: 'device-3', b_4: 'device-4' } }))
      .mockResolvedValueOnce(json({ code: 0, data: { result: [] } }))
    const result = await createTrustedProviders(config).get('bilibili')!.search('不存在的UP主', 1)
    expect(result).toEqual({ isEnd: true, data: [] })
  })

  it('maps SomaFM channels to permanent public streams', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ channels: [{
      id: 'dronezone', title: 'Drone Zone', description: 'Atmospheric textures', genre: 'ambient', lastPlaying: 'Artist - Track',
      largeimage: 'https://api.somafm.com/logos/256/dronezone256.png', updated: '1700000000',
    }] }))
    const provider = createTrustedProviders(config).get('somafm')!
    const result = await provider.search('ambient', 1)
    expect(result.data[0]).toMatchObject({ id: 'dronezone', title: 'Drone Zone', artist: 'Artist - Track', publishedLabel: '直播' })
    expect((await provider.media(result.data[0]!, 'standard')).url).toBe('https://ice.somafm.com/dronezone-128-mp3')
  })

  it('maps non-HLS Radio Browser stations and preserves the exact stream host boundary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json([{
      stationuuid: 'station-1', name: 'Ambient Radio', url_resolved: 'https://radio.example/live.mp3', homepage: 'https://radio.example/',
      favicon: 'https://radio.example/icon.png', tags: 'ambient,sleep', countrycode: 'US', codec: 'MP3', bitrate: 128, hls: 0,
      lastchangetime_iso8601: '2026-08-01T00:00:00Z',
    }, { stationuuid: 'station-hls', name: 'HLS', url_resolved: 'https://radio.example/live.m3u8', hls: 1 }]))
    const provider = createTrustedProviders(config).get('radio-browser')!
    const result = await provider.search('ambient', 1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: 'station-1', title: 'Ambient Radio', artist: 'US · MP3 · 128 kbps', publishedLabel: '直播' })
    expect((await provider.media(result.data[0]!, 'standard')).allowedMediaHosts).toEqual(['radio.example'])
  })

  it('keeps the white-noise platform focused on actual noise and nature soundscapes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json([
        { stationuuid: 'white', name: 'White Noise Radio', url_resolved: 'https://noise.example/white.mp3', hls: 0 },
        { stationuuid: 'edm', name: 'Noise FM - EDM', url_resolved: 'https://noise.example/edm.mp3', hls: 0 },
      ]))
      .mockResolvedValueOnce(json([{ stationuuid: 'music', name: 'Sleep Music', tags: 'sleep,music', url_resolved: 'https://noise.example/music.mp3', hls: 0 }]))
      .mockResolvedValueOnce(json([{ stationuuid: 'rain', name: 'Nature Relax', tags: 'rain,ocean,nature sounds', url_resolved: 'https://noise.example/rain.mp3', hls: 0 }]))
    const provider = createTrustedProviders(config).get('white-noise')!
    const result = await provider.search('noise', 1)
    expect(result.data.map(item => item.id)).toEqual(['white', 'rain'])
  })

  it('signs Audiomack search and playback requests and keeps the returned CDN host exact', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ results: [{ id: 42, title: 'Open Song', artist: 'Artist', album: 'Album', duration: 180, image: 'https://assets.audiomack.com/cover.jpg' }] }))
      .mockResolvedValueOnce(json({ signedUrl: 'https://stream.example.audiomack.com/song.mp3?signature=ok' }))
    const provider = createTrustedProviders(config).get('audiomack')!
    const result = await provider.search('open song', 1)
    const searchUrl = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(searchUrl.pathname).toBe('/v1/search')
    expect(searchUrl.searchParams.get('oauth_signature')).toBeTruthy()
    expect(result.data[0]).toMatchObject({ id: '42', title: 'Open Song', artist: 'Artist', duration: 180 })
    const source = await provider.media(result.data[0]!, 'standard')
    expect(source.url).toContain('stream.example.audiomack.com/song.mp3')
    expect(source.allowedMediaHosts).toEqual(['stream.example.audiomack.com'])
  })

  it('flattens only free Maoer FM drama episodes and resolves their public sound URL', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ info: { pagination: { p: 1, maxpage: 1 }, Datas: [
        { id: 1, name: 'Free Drama', author: 'Studio', cover: 'https://static.maoercdn.com/free.jpg', pay_type: 0, episodes: [{ sound_id: 101, soundstr: 'Episode 1', duration: '185000' }] },
        { id: 2, name: 'Paid Drama', pay_type: 2, episodes: [{ sound_id: 202, soundstr: 'Paid Episode' }] },
      ] } }))
      .mockResolvedValueOnce(json({ info: { sound: { pay_type: 0, soundurl: 'https://static.maoercdn.com/audio/free.mp3' } } }))
    const provider = createTrustedProviders(config).get('maoer-fm')!
    const result = await provider.search('drama', 1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: '101', title: 'Episode 1', artist: 'Studio', album: 'Free Drama', duration: 185 })
    expect((await provider.media(result.data[0]!, 'standard')).url).toBe('https://static.maoercdn.com/audio/free.mp3')
  })

  it('maps Udio public songs and reuses the public song path for playback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ data: [{
      id: 'udio-1', title: 'Synthetic Dawn', artist: 'Creator', song_path: 'https://storage.udio.com/audio.mp3',
      image_path: 'https://storage.udio.com/image.jpg', duration: 152, created_at: '2026-08-01T00:00:00Z',
    }] }))
    const provider = createTrustedProviders(config).get('udio')!
    const result = await provider.search('dawn', 1)
    expect(result.data[0]).toMatchObject({ id: 'udio-1', title: 'Synthetic Dawn', artist: 'Creator', publishedAt: '2026-08-01T00:00:00.000Z' })
    expect((await provider.media(result.data[0]!, 'standard')).allowedMediaHosts).toEqual(['storage.udio.com'])
  })

  it('filters the current Suno Explore feed locally and rejects explicit or private items', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ feeds: [{ items: [
      { content_item: { id: 'suno-1', title: 'Ambient Lake', display_name: 'Maker', is_public: true, explicit: false, created_at: '2026-09-01T00:00:00Z', metadata: { tags: 'ambient', duration: 120 }, media_urls: ['https://cdn1.suno.ai/suno-1.mp3'] } },
      { content_item: { id: 'suno-2', title: 'Ambient Explicit', is_public: true, explicit: true, media_urls: ['https://cdn1.suno.ai/suno-2.mp3'] } },
      { content_item: { id: 'suno-3', title: 'Ambient Private', is_public: false, explicit: false, media_urls: ['https://cdn1.suno.ai/suno-3.mp3'] } },
    ] }] }))
    const provider = createTrustedProviders(config).get('suno')!
    const result = await provider.search('ambient', 1)
    expect(result.data.map(item => item.id)).toEqual(['suno-1'])
    expect((await provider.media(result.data[0]!, 'standard')).url).toBe('https://cdn1.suno.ai/suno-1.mp3')
  })

  it('keeps only free NetEase songs and rejects trial playback responses', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ code: 200, result: {
        songCount: 2,
        songs: [
          { id: 11, name: 'Free Song', fee: 0, dt: 200000, ar: [{ name: 'Singer' }], al: { name: 'Album', picUrl: 'https://p1.music.126.net/free.jpg' } },
          { id: 12, name: 'VIP Song', fee: 1, ar: [{ name: 'Singer' }], al: { name: 'VIP Album' } },
        ], privileges: [{ id: 11, fee: 0, st: 0 }, { id: 12, fee: 1, st: 0 }],
      } }))
      .mockResolvedValueOnce(json({ code: 200, data: [{ id: 11, url: 'https://m801.music.126.net/free.m4a', freeTrialInfo: null }] }))
    const provider = createTrustedProviders(config).get('netease')!
    const result = await provider.search('free', 1)
    expect(result.data.map(item => item.id)).toEqual(['11'])
    expect(result.data[0]).toMatchObject({ title: 'Free Song', artist: 'Singer', duration: 200, fee: 0 })
    expect(fetch.mock.calls[0]?.[1]?.body).toBeInstanceOf(URLSearchParams)
    expect((await provider.media(result.data[0]!, 'standard')).allowedMediaHosts).toEqual(['m801.music.126.net'])
  })

  it('plays only public, non-paid, non-sample Ximalaya tracks', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ ret: 200, data: { track: { total: 2, docs: [
        { id: 31, title: 'Public Track', nickname: 'Anchor', albumTitle: 'Public Album', duration: 600, isPaid: false, isNoCopyright: false, isTrailerBool: false, coverPath: 'http://imagev2.xmcdn.com/public.jpg' },
        { id: 32, title: 'Paid Track', isPaid: true, isNoCopyright: false },
      ] } } }))
      .mockResolvedValueOnce(json({ ret: 0, data: { debugInfo: { debugDetailMap: { detailTrackDto: { result: {
        isPaid: false, isSample: false, isPublic: true,
        playPathDto: { originPlayPath: 'http://aod.cos.tx.xmcdn.com/public.m4a' },
      } } } } } }))
    const provider = createTrustedProviders(config).get('ximalaya')!
    const result = await provider.search('public', 1)
    expect(result.data.map(item => item.id)).toEqual(['31'])
    expect(result.data[0]).toMatchObject({ title: 'Public Track', artist: 'Anchor', ximalayaPublic: true })
    expect((await provider.media(result.data[0]!, 'standard')).url).toBe('http://aod.cos.tx.xmcdn.com/public.m4a')
  })
})
