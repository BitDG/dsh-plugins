# 01 插件模块契约

DSH 插件是一个被 loader 挂载的 Cordis 模块。约定：**文件名无关紧要，导出内容决定契约**。

## 三种形态

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. 函数形态（最常见；不需要对外提供服务时一直用它）
export function apply(ctx: Context) {}

// 2. 对象形态：带 apply 方法的对象
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. 类形态：Service 子类（公开服务时才用，见 docs/03）
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myService')
  }
}
```

## 命名导出

| 导出 | 类型 | 是否必选 | 作用 |
| --- | --- | --- | --- |
| `apply` | `(ctx, config?) => void \| Promise<void>` | ✅ 函数/对象形态 | 插件主体；loader 用上下文调用 |
| `name` | `string` | 可选 | 仅诊断元数据（日志/面板里标识插件） |
| `inject` | `string[]` | 可选 | 依赖的服务名；全部就绪前插件停在 PENDING |
| `Config` | `Schema<Config>`（Schemastery） | 可选 | 配置类型 + 校验 schema，**必须与同名接口配套** |

## 最小插件

```ts
// plugins/your-plugin/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'your-plugin'

export interface Config {
  greeting: string
  intervalMs: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello from DSHP'),
  intervalMs: Schema.number().default(5000),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  ctx.logger.info(`[${name}] ${config.greeting}`)
  ctx.effect(() => {
    const timer = setInterval(() => ctx.logger.info('heartbeat'), config.intervalMs)
    return () => clearInterval(timer)
  })
}
```

## 配置约定（硬性）

1. **无硬编码可调参数**：凡不同部署可能需要不同值的参数，一律是 `Config` 字段。
   检验标准：能否在 `cordis.yml` 里改这个值而不改代码？
2. **配置错误要响亮**：用 Schemastery schema 表达约束（`Schema.string().required()` 等），
   非法配置在加载时直接 FAILED 并给出明确错误。
3. **默认值写进 schema**（`.default(...)`），不要手写 `??` 兜底。
4. `Config` 导出必须是 Standard Schema 实例，**不要导出普通对象**，否则校验失效。

## 加载流程（为什么这样写才会生效）

1. loader 读取配置（`cordis.yml` 行 / patch 插入行）；
2. 解析模块（路径或包名）；**解析失败**只由 logger 报告、进程不崩（最常见：拼错路径/包名）；
3. 检查依赖：`inject` 服务未就绪 → PENDING；就绪 → 执行 `apply`；
4. `apply` 抛错 → FAILED，显式报错（裸运行时会让进程终止）；
5. 校验 `config`（若声明了 schema）→ 非法即 FAILED。

> 排查"插件没生效"：先看它是 PENDING 还是 FAILED，别猜代码。
> 真源：`docs/cordis-tutorial/01-first-plugin.md`、`docs/user/develop/basic/config.md`
