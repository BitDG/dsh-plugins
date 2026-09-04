# DSH Pinterest Reference Bridge

1. 在普通 Google Chrome 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选中本目录。
4. 回到 DSH 的 Pinterest 引用页签，点击“打开 Pinterest 并读取”。

扩展只在 `pinterest.com` 页面读取当前可见的 Pin 标题、图片和链接，并通过一次性短效配对码发送到本机 `127.0.0.1`/`localhost` DSH。它不读取 Cookie、密码、浏览器资料目录或其他网站。

首次读取会自动滚动 Pinterest 页面并收集最多 30 张真实 Pin。之后在 DSH 的 Pinterest 页签向下滚动到底部时，扩展会继续滚动已登录的 Pinterest 页面、读取新增 Pin，并把去重后的增量结果追加到当前引用列表。
