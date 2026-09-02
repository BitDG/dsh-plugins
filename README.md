# DSH Plugins

这是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件的公开集合仓库。集合只保存开发工具、文档和插件版本指针；每个插件都是独立的公开 GitHub 仓库，通过 Git submodule 固定到经过验证的提交。

## 插件

| 路径 | 独立仓库 | 用途 |
|---|---|---|
| `plugins/model-radar` | `BitDG/dsh-model-radar` | 模型选择雷达视图 |
| `plugins/project-actions` | `BitDG/dsh-project-actions` | 工作区项目快捷操作 |
| `plugins/workflow-governance` | `BitDG/dsh-workflow-governance` | 工作流约束、证据与经验管理 |
| `plugins/cloud-model-providers` | `BitDG/dsh-cloud-model-providers` | Ant Digital MaaS 与 NVIDIA NIM 模型路由 |
| `dsh-omniroute-persistent` | `BitDG/dsh-omniroute-persistent` | OmniRoute 本地生命周期与持久化接入 |

`dsh-omniroute-persistent` 暂时保留在集合根目录，以兼容已有的本地 `file:` 安装路径。

## 获取完整集合

```powershell
git clone --recurse-submodules https://github.com/BitDG/dsh-plugins.git
cd dsh-plugins
corepack enable
pnpm run setup
```

已有 clone 可运行：

```powershell
git submodule sync --recursive
git submodule update --init --recursive
pnpm run setup
```

`setup` 会在每个插件仓库中使用其锁文件安装开发依赖，不会在集合根目录生成共享依赖树。

## 开发运行

设置 `DSH_ROOT` 指向 DeepSeek Harness checkout；未设置时默认查找集合相邻的 `../KB/deepseek-harness`：

```powershell
$env:DSH_ROOT = 'F:\path\to\deepseek-harness'
pnpm run dev
```

开发脚本会从 [`cordis.dev.yml`](./cordis.dev.yml) 生成忽略提交的本机 overlay，把治理数据定向到集合的 `tmp/`，并默认监听 `127.0.0.1:3081`。端口被占用时，可在运行前设置 `$env:DSHP_DEV_PORT = '3082'`。云模型路由和 OmniRoute 替换包不会被自动启用，需要按各自仓库 README 显式安装。

## 验证

```powershell
pnpm run verify
```

集合验证会检查 submodule 指针、必需文件、禁止嵌套目录和插件工作树状态。每个插件的完整验证命令记录在其独立仓库 README 和 `package.json` 中。

## 新插件

1. 从 [`templates/plugin`](./templates/plugin/) 创建独立仓库；
2. 完成 LICENSE、README、测试、构建和真实 Harness 加载验证；
3. 将公开仓库作为 submodule 添加到 `plugins/<name>`；
4. 更新本表、`cordis.dev.yml` 和集合验证脚本。

插件契约、生命周期与加载说明见 [`docs/`](./docs/README.md)。

## License

集合仓库使用 [MIT](./LICENSE) 许可证。各插件仓库独立授权；派生自 DeepSeek Harness 的代码保留原始版权与许可证说明。
