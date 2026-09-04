import { describe, expect, it } from 'vitest'
import { staticPolicy } from '../src/policy.ts'

describe('music plugin static policy', () => {
  it('accepts the minimal MusicFree shape', () => {
    const code = 'module.exports={platform:"Fixture",version:"1",author:"test",allowedHosts:["archive.org"],userVariables:[],async search(){return {isEnd:true,data:[]}},async getMediaSource(){return {url:"https://archive.org/a.mp3"}}}'
    expect(staticPolicy(code, 100_000).every(check => check.ok)).toBe(true)
  })

  it.each([
    ['process.env.SECRET', 'Node globals'],
    ['require("node:fs")', 'module loading'],
    ['({}).constructor.constructor("return 1")()', 'prototype'],
    ['new WebSocket("wss://example.com")', 'network channels'],
  ])('blocks %s', (code, expected) => {
    expect(staticPolicy(code, 100_000).find(check => !check.ok)?.detail).toContain(expected)
  })
})
