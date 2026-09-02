# 06 打包与安装：bundle 与 profile

开发验证通过后，把插件以可安装**组合包（bundle）**交付。两个概念、两种 manifest，都由 `package.json` 描述：

| 概念 | manifest 键 | 回答的问题 | 位置 |
| --- | --- | --- | --- |
| **组合包 bundle** | `dsh.bundle` | 这个包贡献什么？（一个 patch 层） | 你写的插件包 |
| **profile** | `dsh.profile` | 这套组合由哪些 bundle 按什么顺序组成？ | `$DSH_HOME/profiles/<名>` |

## 插件包的三件套（本仓库每个 plugins/<名> 文件夹即是）

```
plugins/<name>/
├── package.json       # 声明 dsh.bundle.patch
├── cordis.patch.yml   # 该插件贡献的层：insert 插件行（按包名引用自己）
└── src/index.ts       # 插件模块
```

```json
{
  "name": "@dship/your-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "files": ["src", "cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: your-plugin
      name: '@dship/your-plugin'
```

## 安装进 profile

```powershell
cd F:VibeSpaceKBdeepseek-harness
pnpm dsh plugin --profile web add <collection-root>\plugins\your-plugin
pnpm dsh --profile web --dump-config   # 应出现 "# == @dship/your-plugin" 层
pnpm dsh plugin --profile web remove @dship/your-plugin   # 移除依赖 + 对应层
```

- `dsh plugin --profile <名> <pnpm 子命令>` 在 profile 目录内转发给 pnpm，所有 pnpm 子命令可用；
- 相对路径参数会被锚定到**你调用命令的目录**（比如从插件 checkout 里 `add .` 不会把 profile 自链接进去）；
- 包声明 `dsh.bundle` 才加入层栈；否则只作普通依赖（并打一条提示）。
  **库包（被插件 import、不自行启用）就用这种形态。**

## 加载顺序与覆盖推论（尊重它）

1. 生效配置顺序：profile bundles → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` →
   每个 `--patch` overlay。后应用层胜，且 patch 覆盖整行 `config`。
2. 你的 patch 可以按 id 覆盖内置层，但必须重述整行所有键。
3. 用户能用自己的 profile patch 覆盖你的行——默认值给在 schema 里，其余交给用户覆盖。

## 运行时依赖策略（发布形态的关键）

profile 的 pnpm 只从 registry 安装树外包；`@deepseek-ai/*` 内置包从 dsh 安装目录解析。
为了让 bundle 在任何环境都稳：

1. **尽量零运行时 DSH 依赖**：`import type { Context } from '@deepseek-ai/cordis'`（类型擦除，无运行时解析）；
   注册工具用原始 `ToolDefinition` 而不是 `defineTool`；
2. 真的需要 `defineTool` / 其它运行时包时，在插件 package.json 里声明依赖并在 profile 环境实测；
3. 开发时想怎么用 `defineTool` 都行（overlay 跑在 checkout 里，全量解析可用）。

## 让表层组合包持有自己的命令行（高级）

包内挂载一个普通提供方插件（`name: '@dship/xxx/startup'`，`inject: ['cmdlineArgs']`），用
`@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 解析同一份不可变参数快照；需要参数的插件行用
`config: { port: !!js ctx.myStartup.port ?? 8080 }` 读取。

> 真源：`docs/user/develop/basic/publish.md`、`apps/cli/src/plugin.ts`（`dsh plugin` 实现）。
