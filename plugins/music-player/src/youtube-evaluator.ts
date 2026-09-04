import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

type EvaluatorReply = { ok: true; value: unknown } | { ok: false; error: string }

export class IsolatedYoutubeEvaluator {
  private readonly childPath = fileURLToPath(new URL('./youtube-eval-child.js', import.meta.url))

  constructor(private readonly timeoutMs: number, private readonly maxBytes = 2 * 1024 * 1024) {}

  async evaluate(output: string): Promise<Record<string, unknown> | void> {
    if (Buffer.byteLength(output, 'utf8') > this.maxBytes) throw new Error('YouTube evaluator input is too large')
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=64', '--permission', `--allow-fs-read=${this.childPath}`, this.childPath], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { NODE_NO_WARNINGS: '1', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '' },
      })
      const stdout: Buffer[] = []; const stderr: Buffer[] = []; let bytes = 0; let settled = false
      const finish = (error?: Error, value?: Record<string, unknown> | void): void => {
        if (settled) return
        settled = true; clearTimeout(timer)
        if (error === undefined) resolve(value); else reject(error)
      }
      const timer = setTimeout(() => { child.kill(); finish(new Error('YouTube script evaluation timed out')) }, this.timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > this.maxBytes) { child.kill(); finish(new Error('YouTube evaluator output is too large')); return }
        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).length < 16_384) stderr.push(chunk) })
      child.on('error', error => { finish(error) })
      child.on('close', () => {
        if (settled) return
        try {
          const reply = JSON.parse(Buffer.concat(stdout).toString('utf8')) as EvaluatorReply
          if (!reply.ok) throw new Error(reply.error)
          const value = reply.value
          if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new Error('YouTube evaluator returned an invalid value')
          finish(undefined, value as Record<string, unknown> | undefined)
        } catch (error) {
          const detail = Buffer.concat(stderr).toString('utf8').trim()
          finish(new Error(`${error instanceof Error ? error.message : String(error)}${detail === '' ? '' : `: ${detail}`}`))
        }
      })
      child.stdin.end(JSON.stringify({ output }))
    })
  }
}
