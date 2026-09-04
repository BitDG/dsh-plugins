import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, CATALOG_ENDPOINT, CODEPEN_POSTER_ENDPOINT, CODEPEN_PREVIEW_ENDPOINT, REQUEST_ENDPOINT } from '../src/index.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

class FakeResponse {
  status = 0
  headers: Record<string, unknown> = {}
  body: string | Buffer = ''

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(body?: string | Buffer): this {
    this.body = body ?? ''
    return this
  }
}

function request(method: string, body?: unknown, url?: string): IncomingMessage {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: body === undefined ? { host: '127.0.0.1:3185' } : { host: '127.0.0.1:3185', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield* bytes
    },
  } as unknown as IncomingMessage
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dship-reference-library-'))
  await mkdir(join(root, 'catalog'), { recursive: true })
  await writeFile(join(root, 'catalog', 'index.json'), JSON.stringify({
    records: [{
      id: 'github:known/repo',
      kind: 'github-project',
      title: 'Known repo',
      category: 'tool',
      summary: 'Known.',
      useFor: '',
      tags: ['tool'],
      localPath: 'Res/known/repo',
      entryPoints: ['README.md'],
      card: 'cards/projects/known-repo.md',
      source: { url: 'https://github.com/known/repo.git', revision: 'abc', branch: 'main' },
      license: { type: 'MIT' },
    }, {
      id: 'codepen:poster-demo',
      kind: 'codepen',
      title: 'Poster <Demo>',
      category: 'game',
      summary: 'Visual project.',
      useFor: '',
      tags: ['game'],
      localPath: 'Res/poster-demo',
      entryPoints: ['index.html'],
      card: 'cards/codepen/poster-demo.md',
      source: { url: 'https://codepen.io/example' },
      license: { type: 'unverified' },
    }],
  }), 'utf8')
  await mkdir(join(root, 'Res', 'poster-demo'), { recursive: true })
  await writeFile(join(root, 'Res', 'poster-demo', 'index.html'), '<!doctype html><title>Local preview</title><script>document.body.dataset.ready = "yes"</script>', 'utf8')
  await writeFile(join(root, 'Res', 'poster-demo', 'style.css'), 'body { background: #123; }', 'utf8')
  return root
}

function bench(root: string, rejection: 401 | 403 | undefined = undefined) {
  const handlers = new Map<string, Handler>()
  const cleanups: (() => void | Promise<void>)[] = []
  const ctx = {
    webServer: {
      register: ({ path, handler }: { path: string; handler: Handler }) => {
        handlers.set(path, handler)
        return () => { handlers.delete(path) }
      },
    },
    connection: { requestRejection: () => rejection },
    subprocess: {},
    get: () => undefined,
    inject: () => undefined,
    logger: { info: () => undefined, warn: () => undefined },
    effect: (factory: () => void | (() => void | Promise<void>)) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  } as unknown as Context
  apply(ctx, { libraryRoot: root })
  return {
    handlers,
    async dispose() {
      for (const cleanup of cleanups.reverse()) await cleanup()
    },
  }
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('authenticated reference-library routes', () => {
  it('rejects before reading the catalog', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root, 401)
    const response = new FakeResponse()
    await app.handlers.get(CATALOG_ENDPOINT)!(request('GET'), response as unknown as ServerResponse)
    expect(response.status).toBe(401)
    expect(response.body).toBe('unauthorized')
    await app.dispose()
  })

  it('serves the projected catalog and known canonical GitHub roots', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root)
    const response = new FakeResponse()
    await app.handlers.get(CATALOG_ENDPOINT)!(request('GET'), response as unknown as ServerResponse)
    expect(response.status).toBe(200)
    const payload = JSON.parse(String(response.body)) as { records: unknown[] }
    expect(payload).toMatchObject({
      knownGitHubUrls: ['https://github.com/known/repo'],
      pendingGitHubUrls: [],
    })
    expect(payload.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'github:known/repo', absolutePath: join(root, 'Res/known/repo') }),
    ]))
    await app.dispose()
  })

  it('serves an authenticated deterministic CodePen poster and escapes its title', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root)
    const response = new FakeResponse()
    await app.handlers.get(CODEPEN_POSTER_ENDPOINT)!(
      request('GET', undefined, `${CODEPEN_POSTER_ENDPOINT}?id=${encodeURIComponent('codepen:poster-demo')}`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/svg+xml; charset=utf-8')
    expect(response.body).toContain('CODEPEN')
    expect(response.body).toContain('Poster &lt;Demo&gt;')
    expect(response.body).not.toContain('Poster <Demo>')
    await app.dispose()
  })

  it('protects the CodePen poster route before catalog access', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root, 401)
    const response = new FakeResponse()
    await app.handlers.get(CODEPEN_POSTER_ENDPOINT)!(request('GET'), response as unknown as ServerResponse)
    expect(response.status).toBe(401)
    await app.dispose()
  })

  it('serves local CodePen assets through the authenticated preview route', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root)
    const response = new FakeResponse()
    await app.handlers.get(CODEPEN_PREVIEW_ENDPOINT)!(
      request('GET', undefined, `${CODEPEN_PREVIEW_ENDPOINT}/${encodeURIComponent('codepen:poster-demo')}/index.html`),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(String(response.body)).toContain('Local preview')
    expect(response.headers['content-security-policy']).toContain("frame-src 'none'")
    await app.dispose()
  })

  it('rejects unauthenticated and escaping CodePen preview requests', async () => {
    const root = await fixture()
    roots.push(root)
    const rejected = bench(root, 401)
    const unauthenticated = new FakeResponse()
    await rejected.handlers.get(CODEPEN_PREVIEW_ENDPOINT)!(request('GET'), unauthenticated as unknown as ServerResponse)
    expect(unauthenticated.status).toBe(401)
    await rejected.dispose()

    const app = bench(root)
    const escaping = new FakeResponse()
    await app.handlers.get(CODEPEN_PREVIEW_ENDPOINT)!(
      request('GET', undefined, `${CODEPEN_PREVIEW_ENDPOINT}/${encodeURIComponent('codepen:poster-demo')}/${encodeURIComponent('../catalog/index.json')}`),
      escaping as unknown as ServerResponse,
    )
    expect(escaping.status).toBe(400)
    await app.dispose()
  })

  it('queues one canonical request with an exclusive file and reports duplicates', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root)
    const first = new FakeResponse()
    await app.handlers.get(REQUEST_ENDPOINT)!(
      request('POST', { url: 'https://github.com/new/project/issues/12' }),
      first as unknown as ServerResponse,
    )
    expect(first.status).toBe(201)
    expect(JSON.parse(String(first.body))).toEqual({ status: 'queued', url: 'https://github.com/new/project' })
    const files = await readdir(join(root, 'inbox', 'requests'))
    expect(files).toHaveLength(1)
    expect(await readFile(join(root, 'inbox', 'requests', files[0]!), 'utf8')).toBe('https://github.com/new/project\n')

    const second = new FakeResponse()
    await app.handlers.get(REQUEST_ENDPOINT)!(
      request('POST', { url: 'https://github.com/new/project' }),
      second as unknown as ServerResponse,
    )
    expect(second.status).toBe(200)
    expect(JSON.parse(String(second.body))).toEqual({ status: 'pending', url: 'https://github.com/new/project' })
    await app.dispose()
  })

  it('refuses malformed repository URLs without writing a request', async () => {
    const root = await fixture()
    roots.push(root)
    const app = bench(root)
    const response = new FakeResponse()
    await app.handlers.get(REQUEST_ENDPOINT)!(
      request('POST', { url: 'https://example.com/not/github' }),
      response as unknown as ServerResponse,
    )
    expect(response.status).toBe(400)
    expect(response.body).toContain('github.com/owner/repo')
    await app.dispose()
  })
})
