import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MusicService } from '../src/service.ts'
import type { ResolvedConfig } from '../src/config.ts'
import type { TrustedProvider } from '../src/trusted-providers.ts'

describe('trusted provider service boundary', () => {
  it('normalizes search data and exposes only an expiring same-origin ticket', async () => {
    const provider: TrustedProvider = {
      descriptor: { id: 'fixture-trusted', platform: 'Fixture', version: '1', author: 'test', description: 'fixture', allowedHosts: ['media.example'], installed: true, builtin: true, trusted: true },
      async search() { return { isEnd: true, data: [
        { id: 'old', platform: 'wrong', title: 'Old', artist: 'Artist', publishedAt: '2021-01-01T00:00:00Z' },
        { id: 'unknown', platform: 'wrong', title: 'Unknown', artist: 'Artist' },
        { id: 'new', platform: 'wrong', title: 'New', artist: 'Artist', publishedAt: '2025-01-01T00:00:00Z' },
      ] } },
      async media() { return { url: 'https://media.example/audio.mp3', headers: { referer: 'https://example/' }, allowedMediaHosts: ['media.example'] } },
    }
    const config: ResolvedConfig = { storageRoot: mkdtempSync(join(tmpdir(), 'dship-music-')), runnerTimeoutMs: 8_000, requestTimeoutMs: 6_000, maxResponseBytes: 2_097_152, maxPluginBytes: 262_144 }
    const service = new MusicService(config, new Map([[provider.descriptor.id, provider]]))
    expect(service.plugins().map(item => item.id)).toEqual(['fixture-trusted'])
    const results = (await service.search('fixture-trusted', 'track')).data
    expect(results.map(item => item.id)).toEqual(['old', 'unknown', 'new'])
    expect(results[0]?.platform).toBe('Fixture')
    const source = await service.media('fixture-trusted', { id: 'id', platform: 'Fixture', title: 'Track', artist: 'Artist' })
    expect(source.url).toMatch(/^\/api\/dship\/music\/stream\/[0-9a-f-]{36}$/)
    expect(source.headers).toBeUndefined()
  })
})
