type Request = { output: string }
type Reply = { ok: true; value: unknown } | { ok: false; error: string }

async function input(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const request = JSON.parse(await input()) as Request
  if (typeof request.output !== 'string') throw new Error('YouTube evaluator requires script output')
  // YouTube.js emits a reduced decipher function, not the original player bundle.
  // This process has no network or filesystem permission and receives no application environment.
  const value = Function(`"use strict";\n${request.output}`)() as unknown
  const reply: Reply = { ok: true, value }
  process.stdout.write(JSON.stringify(reply))
} catch (error) {
  const reply: Reply = { ok: false, error: error instanceof Error ? error.message : String(error) }
  process.stdout.write(JSON.stringify(reply)); process.exitCode = 1
}
