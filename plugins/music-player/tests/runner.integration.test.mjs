import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MusicService } from '../lib/index.js'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function service(timeout = 1500, maxResponseBytes = 128 * 1024) {
  const root = mkdtempSync(join(tmpdir(), 'dship-music-test-')); roots.push(root)
  return new MusicService({ storageRoot: root, runnerTimeoutMs: timeout, requestTimeoutMs: 1000, maxResponseBytes, maxPluginBytes: 256 * 1024 })
}

const fixture = `module.exports={platform:"Fixture Audio",version:"1.0.0",author:"tests",description:"fixture",allowedHosts:["archive.org"],userVariables:[],supportedSearchType:["music"],async search(q,p,t){return {isEnd:true,data:[{id:"one",title:q,artist:"Fixture"}]}},async getMediaSource(){return {url:"https://archive.org/download/fixture/audio.mp3"}}}`

describe('isolated MusicFree runner', () => {
  it('reviews, explicitly installs, searches, and resolves media', async () => {
    const target = service(); const review = await target.review(fixture)
    expect(review.accepted).toBe(true)
    expect(() => target.install(review.id, false)).toThrow(/confirmation/)
    expect(target.plugins().some(item => item.id === 'fixture-audio')).toBe(false)
    const installed = target.install(review.id, true); expect(installed.id).toBe('fixture-audio')
    expect((await target.search(installed.id, 'hello')).data[0]).toMatchObject({ id: 'one', title: 'hello', platform: 'Fixture Audio' })
    expect((await target.media(installed.id, { id: 'one', title: 'hello', artist: 'Fixture', platform: 'Fixture Audio' })).url).toContain('archive.org/download/')
  })

  it('rejects undeclared domains inside the child runner', async () => {
    const target = service(); const code = fixture.replace('return {isEnd:true,data:', 'await fetch("https://example.com/data");return {isEnd:true,data:')
    const review = await target.review(code); const installed = target.install(review.id, true)
    await expect(target.search(installed.id, 'hello')).rejects.toThrow(/Undeclared network host/)
  })

  it('terminates an infinite plugin without blocking the host', async () => {
    const target = service(700); const code = fixture.replace('return {isEnd:true,data:', 'while(true){};return {isEnd:true,data:')
    const review = await target.review(code); const installed = target.install(review.id, true)
    await expect(target.search(installed.id, 'hello')).rejects.toThrow(/timed out|terminated/)
    expect(target.plugins().some(item => item.id === 'youtube-music')).toBe(true)
  })

  it('stops oversized plugin output', async () => {
    const target = service(1500, 1024); const code = fixture.replace('artist:"Fixture"', 'artist:"x".repeat(5000)')
    const review = await target.review(code); const installed = target.install(review.id, true)
    await expect(target.search(installed.id, 'hello')).rejects.toThrow(/too large|JSON/)
  })

  it('detects AI output, reviews it, and leaves installation explicit', async () => {
    const target = service(); const job = target.createGeneration({ sourceUrl: 'https://archive.org/details/netlabels', query: 'ambient', author: 'tests', authorized: true })
    expect(existsSync(job.outputPath)).toBe(false); expect(readFileSync(join(job.directory, 'prompt.md'), 'utf8')).toContain('musicfree-plugin-dev')
    writeFileSync(job.outputPath, fixture, 'utf8')
    const reviewed = await target.generation(job.id)
    expect(reviewed.status).toBe('reviewed'); expect(reviewed.review?.accepted).toBe(true)
    expect(target.plugins().some(item => item.id === 'fixture-audio')).toBe(false)
  })
})
