import type { PluginDescriptor } from './types.ts'

const BLOCKED: Array<[RegExp, string]> = [
  [/\b(?:require|importScripts)\s*\(/, 'module loading is not allowed'],
  [/\b(?:process|global|Buffer)\b/, 'Node globals are not allowed'],
  [/\b(?:eval|Function)\b/, 'dynamic code generation is not allowed'],
  [/(?:__proto__|prototype|constructor)/, 'prototype access is not allowed'],
  [/\b(?:child_process|worker_threads|node:|file:)\b/, 'host capabilities are not allowed'],
  [/\b(?:WebSocket|EventSource)\b/, 'unreviewed network channels are not allowed'],
]

export function staticPolicy(code: string, maxBytes: number): Array<{ name: string; ok: boolean; detail: string }> {
  const checks = [{ name: 'size', ok: Buffer.byteLength(code) <= maxBytes, detail: `${Buffer.byteLength(code)} / ${maxBytes} bytes` }]
  for (const [pattern, detail] of BLOCKED) checks.push({ name: `blocked:${pattern.source}`, ok: !pattern.test(code), detail })
  return checks
}

export function normalizeDescriptor(value: unknown, installed = false, builtin = false): PluginDescriptor {
  if (value === null || typeof value !== 'object') throw new Error('Plugin export must be an object')
  const raw = value as Record<string, unknown>
  const platform = requiredText(raw.platform, 'platform', 80)
  const version = requiredText(raw.version, 'version', 40)
  const author = requiredText(raw.author, 'author', 80)
  const description = typeof raw.description === 'string' ? raw.description.slice(0, 500) : ''
  if (!Array.isArray(raw.userVariables)) throw new Error('userVariables must be an array')
  if (typeof raw.search !== 'boolean' || !raw.search) throw new Error('search(query, page, type) is required')
  if (typeof raw.getMediaSource !== 'boolean' || !raw.getMediaSource) throw new Error('getMediaSource(musicItem, quality) is required')
  if (!Array.isArray(raw.allowedHosts) || raw.allowedHosts.length === 0 || !raw.allowedHosts.every(host => typeof host === 'string' && validHost(host))) {
    throw new Error('allowedHosts must contain valid exact host names')
  }
  const id = platform.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  if (id === '') throw new Error('platform must produce a stable plugin id')
  return { id, platform, version, author, description, allowedHosts: [...new Set(raw.allowedHosts as string[])], installed, builtin }
}

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`)
  return value.trim().slice(0, limit)
}

function validHost(host: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(host) && !host.includes('..') && host === host.toLowerCase()
}
