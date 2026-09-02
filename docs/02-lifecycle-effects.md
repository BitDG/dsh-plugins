# 02 生命周期与 effect

## Fiber 状态机

每个已加载插件实例拥有一个 **Fiber**：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

| 状态 | 含义 |
| --- | --- |
| PENDING | 已声明，依赖（`inject`）未就绪 |
| LOADING | 依赖就绪，`apply` 正在执行 |
| ACTIVE | 运行中 |
| FAILED | `apply` 或配置校验抛异常 |
| UNLOADING / DISPOSED | disposer 执行中 / 已完全拆除 |

卸载触发条件：配置修改、HMR、显式 `fiber.dispose()`、或所需服务消失（提供方被替换时自动卸载，
服务恢复后重新加载）。

## effect：自动清理机制

通过 `ctx` 做的注册都是 effect，插件卸载时自动撤销：

- `ctx.on(event, handler)` — 事件监听
- `ctx.plugin(childPlugin)` — 子插件（随父一起 dispose，含递归）
- `ctx.tools.register(tool)` / `ctx.llm.registerAdapter(names, adapter)` — 注册表
- `ctx.effect(() => cleanupFn)` — 自定义资源

disposer 按**注册逆序**开始调用；多个**异步** disposer 并发执行。
若拆除步骤存在顺序依赖，必须放进同一个 disposer 内串行等待，不要拆成多个 effect。

## ctx.effect 的正确用法

```ts
export function apply(ctx: Context) {
  // Cordis 管不到的资源：效应主体内获取，返回 disposer。
  ctx.effect(() => {
    const timer = setInterval(() => ctx.logger.info('tick'), 200)
    return () => {
      clearInterval(timer)
      ctx.logger.info('cleaned up')
    }
  })
}
```

- 效应主体在**加载期间**执行；disposer 在**卸载期间**执行。
- 生命周期与插件一致的资源，永远不需要手动调用 disposer。

## 手动提前终止

```ts
import type { Context } from '@deepseek-ai/cordis'
declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)  // 返回 fiber 句柄
await fiber.dispose()               // 清除全部注册；递归卸载子插件；等待异步清理完成
```

## HMR（热模块替换）

挂载 `@deepseek-ai/cordis-plugin-hmr` 后：
- 修改插件**源码** → 卸载旧实例 → 重载新代码 → 重跑 `apply`（旧注册因 effect 全部清掉，不会残留）；
- 修改 `cordis.yml` 中某插件的 `config` → 同样的卸载→重载。

> 真源：`docs/cordis-tutorial/02-lifecycle-and-effects.md`、`docs/user/develop/framework/index.md`
