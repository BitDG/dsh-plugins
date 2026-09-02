# DSHP 文档：DSH 插件开发规范（项目内缩写）

本目录把 DSH 官方插件开发规范与运行逻辑缩写为**本仓库可执行的规范**：
每个插件 = `plugins/` 下的一个文件夹，导出一个 Cordis 插件模块，由 loader 按 `cordis.yml`
组合挂载。官方文档（位于 DSH checkout）是规范的真源，本目录各页末尾都给出对应源码路径。

| 页面 | 内容 | 官方真源 |
| --- | --- | --- |
| [01-plugin-contract.md](./01-plugin-contract.md) | 插件模块契约：name / inject / apply / Config / schema | `docs/cordis-tutorial/01-first-plugin.md`、`docs/user/develop/basic/config.md` |
| [02-lifecycle-effects.md](./02-lifecycle-effects.md) | Fiber 生命周期状态机、effect 自动清理、dispose、HMR | `docs/cordis-tutorial/02-lifecycle-and-effects.md`、`docs/user/develop/framework/index.md` |
| [03-services-events.md](./03-services-events.md) | 服务注入、事件、waterfall 钩子 | `docs/cordis-tutorial/03-services.md`、`04-events.md`、`docs/cordis-api/*` |
| [04-extension-points.md](./04-extension-points.md) | 扩展点总表：工具/钩子/会话/系统提示词/LLM 适配器等 | `docs/cookbook/extension-cookbook.md`、`docs/tool-catalog.md` |
| [05-composition-loading.md](./05-composition-loading.md) | `cordis.yml` 语法、patch 层顺序、开发挂载方式 | `docs/cordis-tutorial/index.md`（setup）、`docs/user/develop/basic/config.md` |
| [06-package-install.md](./06-package-install.md) | bundle / profile 两种清单、`dsh plugin` 安装、发布 | `docs/user/develop/basic/publish.md` |

## 术语（与官方一致）

- **插件（Plugin）**：一个导出 `apply` 的模块（函数/对象/类三种形态）。输出 ```name`（可选）、`inject`（依赖的服务）、`Config` 类型 + schema。
- **Fiber**：一个已加载插件实例的运行时句柄，有 PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED（FAILED）状态机。
- **effect**：由 `ctx` 建立、会自动撤销的注册（事件监听、工具注册、子插件、`ctx.effect()` 管理的资源）。
- **bundle（组合包）**：附带一个配置层（`cordis.patch.yml`）的 npm 包，`package.json` 声明 `dsh.bundle`。
- **profile**：`$DSH_HOME/profiles/<名>` 下描述"由哪些 bundle 按什么顺序组成"的目录，声明 `dsh.profile`。
- **patch overlay**：一个 YAML patch 条目数组；`dsh web --patch <文件>` 把它作为一层追加进组合。

## 快速结论（写插件前必读）

1. 一切可调参数 → `Config` 字段（schema 带默认值）；不要硬编码。
2. 一切通过 `ctx` 做的注册都是 effect，卸载自动撤销；`ctx` 管不到的资源（定时器/连接/watcher）包进 `ctx.effect()` 并返回 disposer。
3. `inject` 声明服务依赖；缺 provider 时插件停在 PENDING，不会报错——查状态而非猜代码。
4. patch 按行 `id` 覆盖**整行 config**（不做键级深合并）；后应用层胜。
5. 想发布成 bundle，尽量写成**运行时零 DSH 依赖**的形态（只用 `import type` + 注册原始 schema），profile 安装环境最稳。
