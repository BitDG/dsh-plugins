import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ResolvedConfig } from './config.ts'
import type { RunnerRequest } from './types.ts'

type ChildReply = { ok: true; value: unknown } | { ok: false; error: string }

export class IsolatedPluginRunner {
  private readonly childPath = fileURLToPath(new URL('./runner-child.js', import.meta.url))
  constructor(private readonly config: ResolvedConfig) {}

  async run(code: string, method: RunnerRequest['method'], args: unknown[], allowedHosts: string[]): Promise<unknown> {
    const request: RunnerRequest = {
      code, method, args, allowedHosts,
      requestTimeoutMs: this.config.requestTimeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${this.childPath}`, this.childPath], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { NODE_NO_WARNINGS: '1', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '' },
      })
      const stdout: Buffer[] = []; const stderr: Buffer[] = []
      let outputBytes = 0; let settled = false
      const finish = (error?: Error, value?: unknown): void => {
        if (settled) return
        settled = true; clearTimeout(timer)
        if (error === undefined) resolve(value); else reject(error)
      }
      const timer = setTimeout(() => { child.kill(); finish(new Error(`Plugin exceeded ${String(this.config.runnerTimeoutMs)} ms and was terminated`)) }, this.config.runnerTimeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > this.config.maxResponseBytes) { child.kill(); finish(new Error('Plugin result is too large')); return }
        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).length < 16_384) stderr.push(chunk) })
      child.on('error', error => { finish(error) })
      child.on('close', () => {
        if (settled) return
        try {
          const reply = JSON.parse(Buffer.concat(stdout).toString('utf8')) as ChildReply
          if (!reply.ok) throw new Error(reply.error)
          finish(undefined, reply.value)
        } catch (error) {
          const detail = Buffer.concat(stderr).toString('utf8').trim()
          finish(new Error(`${error instanceof Error ? error.message : String(error)}${detail === '' ? '' : `: ${detail}`}`))
        }
      })
      child.stdin.end(JSON.stringify(request))
    })
  }
}
