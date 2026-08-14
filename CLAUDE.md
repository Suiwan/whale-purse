# whale-watch

DeepSeek Harness 的鲸鱼娘桌宠插件：显示 DeepSeek 账户余额 + 当前会话用量/花费，透明立绘悬浮、可拖拽、点击开面板。

## 技术栈

- 语言：纯 ES（无构建步骤），服务端纯 ESM cordis 插件，浏览器端经 `window.__ModuleLoader__` 注入
- 框架：React（经 require 种子词注入）、cordis（DSH 组合层）
- 素材：dafeiyu-pet 鲸鱼娘立绘（base64 内联）

## 启动

```bash
# 安装（软链进 DSH web profile）
ln -s "$(pwd)" ~/.dsh/profiles/web/node_modules/whale-watch

# 在 ~/.dsh/profiles/web/cordis.patch.yml 加 insert（见 README.md），保存即热重载
# 刷新浏览器：Cmd+Shift+R
```

## 注意

- 立绘 base64 内联在 `lib/client.js` 里（约 270KB），改动后刷新浏览器即可生效，无需构建。
- 服务端 `lib/index.js` 改动需重启 DSH 进程才完全生效（客户端有兜底）。
- 截图脚本 `scripts/screenshot.mjs` 依赖本机 playwright-core 缓存路径，仅本地调试用。
