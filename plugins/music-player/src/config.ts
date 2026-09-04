import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  storageRoot?: string
  runnerTimeoutMs?: number
  requestTimeoutMs?: number
  maxResponseBytes?: number
  maxPluginBytes?: number
}

export interface ResolvedConfig {
  storageRoot: string
  runnerTimeoutMs: number
  requestTimeoutMs: number
  maxResponseBytes: number
  maxPluginBytes: number
}

export const Config: Schema<Config> = Schema.object({
  storageRoot: Schema.string().description('Music plugin state root. Empty uses $DSH_HOME/music-player.'),
  runnerTimeoutMs: Schema.number().min(500).max(30_000).default(8_000),
  requestTimeoutMs: Schema.number().min(500).max(30_000).default(6_000),
  maxResponseBytes: Schema.number().min(16_384).max(10 * 1024 * 1024).default(2 * 1024 * 1024),
  maxPluginBytes: Schema.number().min(1_024).max(1024 * 1024).default(256 * 1024),
})

export function resolveConfig(input: Config): ResolvedConfig {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return {
    storageRoot: resolve(input.storageRoot?.trim() || join(dshHome, 'music-player')),
    runnerTimeoutMs: input.runnerTimeoutMs ?? 8_000,
    requestTimeoutMs: input.requestTimeoutMs ?? 6_000,
    maxResponseBytes: input.maxResponseBytes ?? 2 * 1024 * 1024,
    maxPluginBytes: input.maxPluginBytes ?? 256 * 1024,
  }
}
