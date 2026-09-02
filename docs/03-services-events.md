# 03 服务与事件

插件之间不直接互相引用：它们通过**命名服务**（`ctx.xxx`）与**事件**连接。

## 服务（Service）

- 服务 = 一个注册在 ctx 上的命名能力，如 `ctx.tools`、`ctx.llm`、`ctx.agents`、`ctx.goals`。
- 消费方用 `inject: ['tools']` 声明依赖；服务未就绪时插件停在 PENDING，就绪后 `apply` 才运行。
- 提供方用类形态（`class MyService extends Service { constructor(ctx){ super(ctx,'myService') } }`）。
- 服务消失（提供方被替换）→ 依赖它的插件自动卸载，恢复后重载。

```ts
export const inject = ['tools', 'llm']
export function apply(ctx: Context) {
  // 到这里 ctx.tools 与 ctx.llm 一定可用。
}
```

## 事件与 waterfall 钩子

- 普通事件：`ctx.on('event-name', handler)`；payload 类型靠声明合并获得，例如 `import type {} from '@deepseek-ai/dsh-tools'` 之后 `'tools/result'` 自动带类型。
- **waterfall 钩子**：带 `next()` 的事件，监听器返回**类型化决策**（允许/拒绝/放行），形成可重排的策略层：

```ts
export const name = 'permission-gate'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (/* 策略不允许 */) return { kind: 'deny', reason: 'Denied by policy.' }
    return next()  // 放行到下一层
  })
}
```

waterfall 的选择规则（以 tools 为例，扩展点总表见 04）：
- 策略层（可重排、可拒绝）→ `tools/pre-execute`
- 包裹分发生命周期（超时/重试/指标；只有 `exec.signal` 可替换）→ `tools/execute`
- 显式结果变换 → `tools/post-execute`
- 只读观察不可变结果 → `tools/result`
- 需要单调的最终拒绝 → `ctx.tools.guard()`

## 事件命名空间速查（常见）

| 命名空间 | 语义 |
| --- | --- |
| `tools/*` | `pre-execute` / `execute` / `post-execute` / `result` |
| `agent/*` | `session-start` / `pre-step` / `request` / `turn-stopping` |
| `session/event` | 会话事件流（`assistant/chunk` 文本/推理分片、轮次/步骤边界、工具活动） |
| `turn/end` | 轮次结束（`/loop` 类插件在此 followup 下一轮） |
| `plan/*` | plan-mode 状态（`plan/mode` 等） |

> 完整、可注入/可监听的清单是**生成**的：见 DSH checkout 的 `docs/subsystems/*.md` 中
> `<!-- BEGIN GENERATED cordis-surface -->` 区块（由 `scripts/gen-cordis-catalog.ts` 生成，
> 包源码里的 JSDoc 是真源）。
