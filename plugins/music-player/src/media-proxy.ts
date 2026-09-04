import { lookup } from 'node:dns/promises'
import type { TrustedMediaSource } from './trusted-providers.ts'

export function isPrivateNetworkAddress(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower)) return true
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]; const value = mapped ?? address
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function mediaHostnameAllowed(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase()
  return patterns.some(pattern => pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern)
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(item => isPrivateNetworkAddress(item.address))) throw new Error(`Private or unresolved media host rejected: ${hostname}`)
}

export async function fetchTrustedMedia(source: TrustedMediaSource, range: string | undefined, timeoutMs: number): Promise<Response> {
  let url = new URL(source.url)
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!['http:', 'https:'].includes(url.protocol) || !mediaHostnameAllowed(url.hostname, source.allowedMediaHosts)) throw new Error(`Untrusted media host rejected: ${url.hostname}`)
    await assertPublicHost(url.hostname)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = new Headers(source.headers)
      if (range !== undefined) headers.set('range', range)
      const response = await fetch(url, { headers, redirect: 'manual', signal: controller.signal })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null) throw new Error(`Media redirect ${String(response.status)} has no location`)
        url = new URL(location, url); continue
      }
      if (!response.ok && response.status !== 206) throw new Error(`Media upstream HTTP ${String(response.status)}`)
      const type = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (type && !type.startsWith('audio/') && !type.startsWith('video/') && !type.startsWith('application/octet-stream') && !type.startsWith('application/ogg')) {
        await response.body?.cancel(); throw new Error(`Unexpected media content type: ${type}`)
      }
      return response
    } finally { clearTimeout(timer) }
  }
  throw new Error('Too many media redirects')
}
