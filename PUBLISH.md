# 小红书发布交接信息（给下一个会话/操作者）

## 项目位置

- 项目根目录：`/Users/lizijian/workspace/dsh_workspace/whale-watch/`
- 小红书文案（标题三选一、正文、标签、配图顺序）：`/Users/lizijian/workspace/dsh_workspace/whale-watch/docs/xiaohongshu.md`

## 发布内容（最终版）

**标题**：给你的 DeepSeek 装只鲸鱼娘桌宠

**正文**：
```
给 DeepSeek Harness 装了一只鲸鱼娘桌宠🐋

就是 DeepSeek 蓝鲸 logo 的娘化形象——白发蓝瞳女仆装（立绘二创自 dafeiyu-pet，MIT）

✨ 她能干什么：
▫️ 账户余额实时浮在头顶
▫️ 当前会话 token 用量 + 预估花费，分桶展示
▫️ 拖到哪待哪，位置自动记住
▫️ 点她弹出明细面板，峰谷价自动算
▫️ 请求超时显示友好提示，不糊英文

🔧 装法：
软链进 DSH profile + cordis.patch.yml 加一条 insert，刷新即生效，纯 ES 无构建

📦 已开源：GitHub 搜 Suiwan/whale-watch

非官方二创插件，与 DeepSeek 官方无关联
```

**标签**：DeepSeek、桌宠、开源、AI工具、摸鱼神器、效率工具、二次元、鲸鱼娘

## 配图（绝对路径，按顺序）

1. 首图：`/Users/lizijian/workspace/dsh_workspace/whale-watch/assets/cover.png`（3:4 竖版封面）
2. `/Users/lizijian/workspace/dsh_workspace/whale-watch/assets/shot-panel.png`（面板截图）
3. `/Users/lizijian/workspace/dsh_workspace/whale-watch/assets/preview.png`（立绘特写）

## 小红书 MCP 环境（本机）

- HTTP 版 MCP 二进制：`/Users/lizijian/.local/bin/xiaohongshu-mcp-darwin-arm64`
- 启动：`xiaohongshu-mcp-darwin-arm64 -port :18060`（headless 默认开；headed 加 `-headless=false`）
- MCP 端点：`http://localhost:18060/mcp`
- 登录状态：**已登录**（账号已扫码，cookies 持久化在 MCP 的浏览器 profile 里，重启 MCP 不需要重新扫码）
- 通用调用脚本：`/Users/lizijian/.agents/skills/xiaohongshu-research/scripts/mcp-call.sh <tool> '<json>'`
- `publish_content` 参数：`{"title": "...", "content": "...", "images": ["绝对路径..."], "tags": [...], "is_original": true}`

## 已知问题（重要）

- 用 `publish_content` 发布时报错：**「没有找到发布 TAB - 上传图文」**。日志显示 MCP 反复「尝试移除遮挡」后失败（headless/headed 都试过）。
- 证据：2026-03-29 该 MCP 曾成功发布（旧日志 `~/.xiaohongshu/mcp.log`，笔记「🦐嗨！我是你的AI新闻主播」），当时无「上传图文 TAB」步骤；现在小红书网页版创作者中心 UI 改版，MCP 的 TAB 选择器失效。
- 另一个会话可尝试：检查 MCP 二进制是否有新版；或改用网页版手动发布流程；或在 App 手动发布（内容已备好）。

## GitHub 仓库（另一条线）

- 本地仓库：`/Users/lizijian/workspace/dsh_workspace/whale-watch/`（git 已 init，main 分支 3 commits）
- 目标：`Suiwan/whale-watch`
- gh 已装；GitHub 直连超时，需走代理：`export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897`
- 需用户 gh auth login（设备码流程）后 `gh repo create Suiwan/whale-watch --public --source . --push`
