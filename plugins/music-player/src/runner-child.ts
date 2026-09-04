import { lookup } from 'node:dns/promises'
import vm from 'node:vm'
import type { RunnerRequest } from './types.ts'

type ChildReply = { ok: true; value: unknown } | { ok: false; error: string }

async function readInput(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function privateAddress(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower)) return true
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  const value = mapped ?? address
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(item => privateAddress(item.address))) throw new Error(`Private or unresolved host rejected: ${hostname}`)
}

async function boundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new Error(`Response exceeds ${String(maxBytes)} bytes`)
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new Error(`Response exceeds ${String(maxBytes)} bytes`) }
    chunks.push(next.value)
  }
  const output = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function makeFetch(request: RunnerRequest): typeof fetch {
  const allowed = new Set(request.allowedHosts)
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      if (!['http:', 'https:'].includes(url.protocol) || !allowed.has(url.hostname.toLowerCase())) throw new Error(`Undeclared network host rejected: ${url.hostname}`)
      await assertPublicHost(url.hostname)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), request.requestTimeoutMs)
      try {
        const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json,text/plain;q=0.9', 'user-agent': 'DSHP-Music-Plugin/0.1' } })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (location === null) throw new Error(`Redirect ${String(response.status)} has no location`)
          url = new URL(location, url)
          continue
        }
        if (!response.ok) throw new Error(`Upstream HTTP ${String(response.status)}`)
        const body = await boundedBody(response, request.maxResponseBytes)
        const copy = new Uint8Array(body.byteLength); copy.set(body)
        return new Response(copy.buffer, { status: response.status, statusText: response.statusText, headers: response.headers })
      } finally { clearTimeout(timer) }
    }
    throw new Error('Too many redirects')
  }) as typeof fetch
}

async function execute(request: RunnerRequest): Promise<unknown> {
  const sandbox = Object.assign(Object.create(null), {
    URL, URLSearchParams, fetch: makeFetch(request), module: { exports: {} }, exports: {},
  }) as Record<string, unknown>
  const context = vm.createContext(sandbox, { name: 'dship-music-plugin', codeGeneration: { strings: false, wasm: false } })
  new vm.Script(`"use strict";\n${request.code}\n;globalThis.__plugin = module.exports;`, { filename: 'musicfree-plugin.js' }).runInContext(context, { timeout: 500 })
  const plugin = sandbox.__plugin as Record<string, unknown> | undefined
  if (plugin === undefined || plugin === null || typeof plugin !== 'object') throw new Error('Plugin did not export an object')
  if (request.method === 'inspect') {
    return {
      platform: plugin.platform, version: plugin.version, author: plugin.author, description: plugin.description,
      allowedHosts: plugin.allowedHosts, userVariables: plugin.userVariables,
      search: typeof plugin.search === 'function', getMediaSource: typeof plugin.getMediaSource === 'function',
    }
  }
  if (typeof plugin[request.method] !== 'function') throw new Error(`Plugin method is missing: ${request.method}`)
  sandbox.__args = request.args
  return await Promise.resolve(new vm.Script(`globalThis.__plugin[${JSON.stringify(request.method)}](...globalThis.__args)`).runInContext(context, { timeout: 500 }))
}

try {
  const request = JSON.parse(await readInput()) as RunnerRequest
  const value = await execute(request)
  const reply: ChildReply = { ok: true, value }
  process.stdout.write(JSON.stringify(reply))
} catch (error) {
  const reply: ChildReply = { ok: false, error: error instanceof Error ? error.message : String(error) }
  process.stdout.write(JSON.stringify(reply))
  process.exitCode = 1
}
