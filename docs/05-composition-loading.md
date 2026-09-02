# 05 组合与加载：cordis.yml 与 patch 层

## cordis.yml 是什么

一份 **loader patch 条目数组**（顶层 YAML 数组）。loader 逐个挂载；各项**并发启动**，
先后顺序由 `inject` 依赖决定，**与文件位置无关**。

行字段（loader 条目）：

| 字段 | 说明 |
| --- | --- |
| `name` | 模块指定符：相对路径（`./plugins/x/src/index.ts`）、包名（`@deepseek-ai/dsh-tools`） |
| `id` | 行的稳定标识，供其他层按 id 覆盖/禁用 |
| `config` | 传给 `apply(ctx, config)` 的配置（经导出的 schema 校验 + 填默认值） |
| `disabled` | `true` 禁用该行 |
| `inject` | 行级覆盖依赖声明（高级用法） |
| `!!js` 表达式 | config 值可引用已注册服务，如 `port: !!js ctx.myAppStartup.port ?? 8080` |

## patch 三种动作

- `- insert:` — 追加行（列表）。
- `- id: xxx` + `config:` — 覆盖前面层中该 id 的整行 config。
- `- id: xxx` + `disabled: true` — 禁用某行。

> ⚠️ patch 覆盖**整行 config**，不做键级深合并。覆盖时必须重述该行需要的每一个键。

## 层顺序（后应用者胜，逐层叠加在空根之上）

```
1. profile 的 dsh.profile.bundles 列表（按顺序：dsh-base → 各 bundle 按其加入顺序）
2. profile 自己的 cordis.patch.yml
3. $DSH_HOME/cordis.patch.yml（各 profile 共享的机器本地偏好）
4. 每个 --patch <文件> overlay（按 argv 顺序）
```

内置组合包名（`@deepseek-ai/dsh-base` 等）始终从 dsh 安装目录解析；pnpm 只管理树外包。

## 本仓库的两种挂载方式

**A. 开发：源码 overlay（cordis.dev.yml）**

```yaml
- id: webserver
  config: { host: 127.0.0.1, port: 3081 }   # 固定开发端口

- insert:
    - id: your-plugin
      name: './plugins/your-plugin/src/index.ts'
      config: { greeting: 'Hello', intervalMs: 5000 }
```

启动：`node scripts/dev.mjs`。脚本会生成含本机数据路径的临时 overlay，再交给 DSH checkout 启动。
源码 overlay 里 `name` 用相对路径 → 模块从源文件直接解析（类型/运行时靠 junction node_modules）。

**B. 安装：bundle 包（见 docs/06）**——patch 行用包名引用，如 `name: '@dship/your-plugin'`。

## 排障

- 新增行“没效果” → 先查拼写/路径（解析失败只记日志、进程不崩，启动期日志可能丢）。
- 插件停留 PENDING → `inject` 的服务 provider 没在组合里（例如工具插件缺 `@deepseek-ai/dsh-tools`）。
- `apply` 抛错 / config 校验失败 → FAILED，裸运行时进程终止；校验错误清晰可见。
- 想看最终组合 → `dsh --profile <名> --dump-config`（显示各层边界注释）。

> 真源：`docs/cordis-tutorial/index.md`（环境设置）、`01-first-plugin.md`、`docs/user/develop/basic/config.md`。
