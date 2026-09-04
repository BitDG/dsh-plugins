import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import { resolveOnlineConfig } from '../src/online/config.ts'

describe('online reference configuration', () => {
  it('allows enough time for the default Z-Library domain probe', () => {
    expect(resolveOnlineConfig({}).zlibraryRequestTimeoutMs).toBe(15_000)
  })

  it('keeps an explicit bounded Z-Library timeout', () => {
    expect(resolveOnlineConfig({ zlibraryRequestTimeoutMs: 9_000 }).zlibraryRequestTimeoutMs).toBe(9_000)
  })

  it('exposes safe defaults through the DSH settings schema', () => {
    expect(Config({})).toMatchObject({
      pinterestDefaultQuery: 'design inspiration',
      pinterestResultLimit: 30,
      zlibraryDefaultQuery: 'design',
      zlibraryResultLimit: 10,
    })
  })

  it('does not expose OAuth, browser-profile, or developer-app settings', () => {
    expect(Config({})).not.toHaveProperty('pinterestAccessTokenEnv')
    expect(Config({})).not.toHaveProperty('pinterestAppId')
    expect(Config({})).not.toHaveProperty('profileRoot')
    expect(Config({})).not.toHaveProperty('browserPath')
  })

  it('normalizes user-configurable default queries', () => {
    expect(resolveOnlineConfig({ pinterestDefaultQuery: '  concept   art ', zlibraryDefaultQuery: '  interaction   design ' }))
      .toMatchObject({ pinterestDefaultQuery: 'concept art', zlibraryDefaultQuery: 'interaction design' })
  })

  it('migrates old small Pinterest pages to the 30-card minimum', () => {
    expect(Config({ pinterestResultLimit: 10 }).pinterestResultLimit).toBe(10)
    expect(resolveOnlineConfig({ pinterestResultLimit: 10 }).pinterestResultLimit).toBe(30)
  })
})
