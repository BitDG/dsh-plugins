# 04 扩展点总表

DSH 是微内核：**每个产品功能都映射到一个文档化扩展点上的监听器**，没有任何一行功能修改智能体循环本身。
这使第三方插件能与内置插件以完全相同的机制组合。下表浓缩自 DSH 实操手册的"功能→机制映射"。

## 一、最常用：工具（Tool）

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet the named person.',
    parameters: {
      who: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) { return `Hello, ${args.who}!` },
  }))
}
```

- `defineTool`：由 `parameters` 生成向模型展示的 JSON Schema、推导 `args` 类型、执行前校验模型参数；
  `execute` 返回 `output.schema` 声明的规范值，`output.render` 生成可持久化的结果内容。
- `ctx.tools.register()` 也接受**原始 JSON Schema `ToolDefinition`**（MCP 来源的工具就是这样到达的）——
  这是"运行时零 DSH 依赖"形态的关键（见 docs/06）。
- 完整写法（嵌套 schema、后台执行、PTC、UI 卡片、策略钩子）见 `docs/cookbook/adding-a-tool.md`。

## 二、钩子（waterfall 策略层）

| 扩展点 | 用途 | 决策形态 |
| --- | --- | --- |
| `tools/pre-execute` | 权限门禁/沙箱/plan-mode 拦截 | 返回 `{kind:'allow'}` / `{kind:'deny',reason}` / `{kind:'ask'}` 或 `next()` |
| `tools/execute` | 超时/重试/指标（只可替换 `exec.signal`） | 包裹分发 |
| `tools/post-execute` | 显式结果变换 | 返回新结果 |
| `tools/result` | 只读观察权威结果（审计/指标/capture） | 无返回 |
| `ctx.tools.guard()` | 单调的最终拒绝 | 一组谓词 |
| `ctx.tools.restrict()` | 过滤模型可见工具集（ToolSearch/渐进式披露） | 作用域内替换注册 |
| `agent/session-start` `agent/pre-step` `agent/request` `agent/turn-stopping` | 会话级钩子（用户/项目级钩子系统由此桥接） | waterfall 决策；turn-stopping 可 steering 触发下一步 |

钩子插件 = 在拦截点上运行的普通 Cordis 插件，不需要外部协议。

## 三、会话与 UI

- 监听 `session/event`：助手 token 以 `assistant/chunk` 到达（`text-delta` 等），加上轮次/步骤边界与工具活动；
  输入侧用 `agent.followup()` / `agent.steer()` 驱动回去。
- `/loop` 类：在 `turn/end` 上 `followup()` 下一轮。
- Web Client 业务节点：注册 `ConversationNodeDefinition` 与 keyed Chat renderer（见 conversation 子系统）。
- 遥测/回放：`session/event` → JSONL；回放 = `sessions.create(id, { seed })`。

## 四、系统提示词、LLM、其余能力面

| 能力 | 机制 |
| --- | --- |
| 系统提示词可配置 | `ctx.systemPrompt.section()`（支持排序与作用域局部覆盖） |
| AGENTS.md 读取 / 子目录按需注入 | section 提供方；watcher/工具结果 → `agent.inject()` |
| LLM 适配器 | `ctx.llm.registerAdapter(names, adapter)`，适配器继承 `LlmAdapter` |
| 记忆 | section 提供方 + 工具 |
| 定时任务 | 注册面向模型的调度工具；定时器触发 → 空闲 `followup()` / 忙碌 `inject()` |
| 子代理委派 | `ctx.subagents` 提供方注册表 |
| 压缩（自动/手动） | `ctx.compaction` seam + `dsh-compaction-basic`；自动压力检查在 `agent/pre-step` |
| 动态工作流 | `ctx.workflowEngine` + worker-thread 引擎 |
| MCP | 每服务器一个插件：发现工具 → `ctx.tools.register()` |
| 权限系统 / AskUserQuestion | `tools/pre-execute` 返回 `ask` → `ctx.approval` 应答 |
| 沙箱能力 | `ctx.sandbox` 后端（`dsh-bash-sandbox`） |
| plan-mode | `@deepseek-ai/dsh-plan-mode`：`plan/mode` 状态、`plan:policy` 引导、`exit_plan_mode` 出口 |
| 目标/任务 | `ctx.goals`（`/goal` 的持久状态） |

> 生成式真源：DSH checkout 的 `docs/tool-catalog.md`（每个工具的 schema）、
> `docs/subsystems/*.md` 的 cordis-surface 区块（每个系统可注入/可监听的内容）、
> `docs/cookbook/extension-cookbook.md`（完整功能→机制映射表）。
