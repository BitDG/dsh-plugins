import type { Context } from '@deepseek-ai/cordis'
import { Config as ConfigSchema, resolveConfig, type Config as ConfigShape } from './config.ts'
import { MusicService } from './service.ts'
import { mountWebApi } from './web-api.ts'

export const name = 'music-player'
export const Config = ConfigSchema
export interface Config extends ConfigShape {}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const service = new MusicService(resolved)
  mountWebApi(ctx, service)
  ctx.logger.info(`[${name}] active; storage=${resolved.storageRoot}`)
}

export { resolveConfig } from './config.ts'
export { staticPolicy } from './policy.ts'
export { MusicService } from './service.ts'
export { createTrustedProviders } from './trusted-providers.ts'
export { fetchTrustedMedia } from './media-proxy.ts'
export { IsolatedYoutubeEvaluator } from './youtube-evaluator.ts'
