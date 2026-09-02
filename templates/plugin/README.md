# @dship/__NAME__

> 复制 `templates/plugin` 为 `plugins/<你的插件名>` 后，把本文件与包内所有 `__NAME__` 占位符替换掉。

## 功能

一句话描述这个插件做什么。

## 开发

1. 在仓库根 `cordis.dev.yml` 的 `insert` 段加一行：

```yaml
    - id: __NAME__
      name: './plugins/__NAME__/src/index.ts'
```

2. 启动：

```powershell
node scripts/dev.mjs
```

3. 打开 `http://127.0.0.1:3081` 验证。

## 安装（发布形态）

```powershell
cd <deepseek-harness-checkout>
pnpm dsh plugin --profile web add <collection-root>\plugins\__NAME__
```

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `greeting` | `Hi from __NAME__` | 问候语 |
| `enableTool` | `true` | 是否注册示例工具 |

规范与机制见 `docs/`。
