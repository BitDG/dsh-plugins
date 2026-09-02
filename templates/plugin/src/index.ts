// 插件骨架：配置 + 工具注册 + effect 清理。复制模板后请替换 __NAME__ / __name__。
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '__NAME__'

export interface Config {
  greeting: string
  enableTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hi from __NAME__'),
  enableTool: Schema.boolean().default(true),
})

// 依赖的工具注册表；未就绪时插件停在 PENDING。
export const inject = ['tools']

export function apply(ctx: Context, config: Config) {
  ctx.logger.info(`[${name}] loaded with greeting=${config.greeting}`)

  // 工具：defineTool 由 parameters 生成 JSON Schema、推导 args 类型、执行前校验。
  if (config.enableTool) {
    ctx.tools.register(defineTool({
      name: '__name___greet',
      description: 'Greet the named person.',
      parameters: {
        who: { type: 'string', required: true, description: 'Who to greet' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args) {
        return `${config.greeting}, ${args.who}!`
      },
    }))
  }

  // 插件级资源：挂载时获取，卸载时自动执行 disposer（HMR / config 变更也适用）。
  ctx.effect(() => {
    // 例：在这里创建连接、watcher、定时器……
    return () => ctx.logger.info(`[${name}] cleaned up`)
  })
}
