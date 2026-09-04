# @dship/reference-library

把本地与在线参考统一接入 DeepSeek Harness Web 原生 `@` 引用菜单。

## 功能

- 只在输入框当前光标处触发 `@` 菜单，不增加侧栏按钮或独立遮罩层。
- 在原生“文件与文件夹”旁增加 `CodePen`、`Pinterest`、`Z-Library`、`GitHub` 四个页签；按 `~` 可从左向右循环切换。
- `CodePen` 只显示本地参考库项目，并在高亮卡片内运行受限的同源预览；`Pinterest` 显示普通 Chrome 当前页面读取出的 Pin 瀑布流；`Z-Library` 显示封面与书籍元数据；`GitHub` 显示本地收录的仓库卡片。
- 引用页签共用固定高度和内部滚动；数据请求期间显示加载文案、进度条和骨架状态。
- Pinterest 和 Z-Library 的空查询分别使用配置的默认关键词；Pinterest 也会回退到最近一次读取的真实 Pin。Pin 首批显示 30 张，滚动到底时让 Chrome 页面继续加载并追加；Z-Library 顶部排序切换会重新请求元数据。Pin 结果提供“保存”，书籍结果把“下载”放在书籍信息下方的独立一行。
- 设置卡可管理 Pinterest 默认关键词、结果数、本地引用库目录和 Z-Library 数据来源。
- 选择结果只在当前草稿插入原子引用，不会自动发送。Z-Library 不下载、缓存或绕过访问控制获取书籍文件。
- 当前会话出现未收录的 GitHub 仓库链接时，输入框上方会询问是否写入参考库请求队列。

## Pinterest：继承普通 Chrome 登录状态

本插件不再使用 Pinterest Developer OAuth，也不要求 App ID、App Secret 或企业开发者权限。它通过随包提供的 Manifest V3 Chrome 扩展，在普通 Chrome 已登录的 Pinterest 页面内读取当前可见的 Pin 标题、图片和链接，再交给 DSH 以原生瀑布流渲染。

首次使用：

1. 在普通 Chrome 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选中设置卡显示的 `chrome-extension` 目录。
4. 在 DSH 的 Pinterest 引用页签点击“打开 Pinterest 并读取”。

DSH 会生成一个五分钟有效的随机配对码，并把它放在 Pinterest URL 的 fragment 中；fragment 不随 HTTP 请求发送给 Pinterest。扩展只允许访问 Pinterest 页面与本机 `127.0.0.1`/`localhost` 回传接口，不申请 Cookie、历史记录、书签或浏览器资料权限。它不会复制或解析 Chrome Cookie/登录资料。

普通网页受同源策略限制，无法直接读取另一个 `pinterest.com` 标签页；因此首次安装这个受限扩展是复用普通 Chrome 登录状态的必要步骤。

## 配置

```yaml
- id: dship-reference-library
  name: '@dship/reference-library'
  config:
    libraryRoot: F:/VibeSpace/codepen
    pinterestDefaultQuery: design inspiration
    pinterestResultLimit: 30
    zlibraryRequestTimeoutMs: 15000
    zlibraryDefaultQuery: design
    zlibraryResultLimit: 10
```

`libraryRoot` 也可以由 `VIBESPACE_REFERENCE_LIBRARY_ROOT` 或 `DSH_REFERENCE_LIBRARY_ROOT` 提供。目录必须包含 `catalog/index.json`；排队时插件按需创建 `inbox/requests/`。

`pinterestDefaultQuery` 默认为 `design inspiration`，每批结果数为 30–50，默认 30。读取结果在内存中保留 30 分钟；每次点击读取都会创建独立的五分钟短效配对会话。

可选的 `zlibraryDomain` 固定一个 HTTPS 元数据域名；未设置时会从受限候选列表探测。`zlibraryRequestTimeoutMs` 默认为 15000 毫秒，有效范围为 2000–30000 毫秒；`zlibraryResultLimit` 为 1–20。

所有常规 HTTP 路由先调用 Harness `connection.requestRejection()` 并拒绝跨源请求。唯一不依赖 Harness Cookie 的扩展回传路由同时要求 Chrome 扩展 Origin 与短效随机配对码，并只接受经过 Pinterest URL、Pin 详情路径、`pinimg.com` 图片主机和字段长度校验的数据。

## Harness 兼容性

这个版本使用 Harness 的来源页签、原生缩略图候选与高亮项目预览能力：`InputTriggerSource.menuTab`、`InputTriggerCandidate.thumbnail` 与 `InputTriggerCandidate.preview`。预览只接受同源路径，仅在当前高亮 CodePen 卡片中挂载 `sandbox="allow-scripts"` 的 iframe，不加载在线 CodePen 页面。

## 开发

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run verify
```

发布前必须安装并启动精确 tarball，在非 3080 的隔离 DSH Home/Profile 上验证安装、组合配置、认证、监听进程和真实 UI。
