# whale-purse 🐋

> 一只住在 DeepSeek Harness（DSH）里的鲸鱼娘桌宠，帮你盯着 DeepSeek 账户余额和当前会话的用量/花费。

把「DeepSeek 余额 + 会话 token 用量/预估花费」做成一只可拖拽的二次元鲸鱼娘，浮在 DSH Web GUI 上。点她弹出用量明细面板（当前 / 历史双 Tab），拖她换位置，位置自动记住；余额 30s、花费 3s 自动刷新。

![preview](assets/preview.png)

## 特性

- 🐋 **鲸鱼娘桌宠**：透明立绘悬浮在页面上，随波轻微摇摆，脚底带投影
- 🖱️ **可拖拽**：拖动换位（`localStorage` 记忆，刷新/重开保持），点击开面板
- 🔔 **任务完成提醒**：后台会话跑完时鲸鱼娘弹跳 + 头顶冒泡「任务完成啦」，点气泡直达完成会话
- 🏃 **状态动作**：有任务运行时鲸鱼娘忙碌抖动 + 「忙…」标签；点击她 squash 弹跳回应（纯 CSS，不动形象）
- 💰 **余额监视**：DeepSeek 官方 `Get User Balance` 接口，30s 轮询 + 并发去重；请求失败保留上次快照并提示过期
- ⚠️ **低余额/预算提醒**：余额低于阈值或今日花费超过预算时，面板警告 + 鲸鱼娘红点；浏览器有通知权限时低余额发送 Notification
- ⚙️ **面板设置**：点面板右上角齿轮即可改 `model` / 低余额阈值 / 今日预算，保存到本地 JSON，无需手改 YAML
- 🧮 **会话用量**：读 `sessionProjections` 的 `tokenUsage` 投影，按官方价格折算花费（输入/缓存读/缓存写/输出分桶）；`model: auto` 时按会话实际请求头识别 flash/pro，识别为非 DeepSeek 模型（如 GPT / Claude）的会话不估算花费；已落盘消息按各自发生时的峰谷档与模型计价，进行中增量按当前档计价；DSH「在新会话中新建分支」checkout 出的历史 seed 不会重复计费，只统计新建分支后的新增用量
- 📊 **历史趋势（双 Tab 面板）**：「当前」Tab 看余额与实时花费；「历史」Tab 看近 7 天花费柱状图（有 `sessionPersistence` 时自动合并已保存会话）+ 本会话每条提问的花费明细（多步循环自动合并成一行，问题前 10 字 + Tokens + 花费）
- ⚡ **峰谷定价**：北京 9:00-12:00 / 14:00-18:00 高峰价自动切换；面板显示当前档位与距下次切换倒计时；官方定价页每 6h 自动抓取；2026-08-17 前发生的消息按生效前标准价计入历史
- 🌗 **主题适配**：面板颜色与柱状图深浅随 DSH 浅色/深色主题切换（`--dsw-alias-*` token）
- 🖥️ **多屏适配**：外接大屏/笔记本切换时自动把桌宠夹回视口内，不会丢
- 🛡️ **友好错误**：余额/定价请求超时显示「请求超时」而非英文 `This operation was aborted`
- 🧩 **兼容 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**：适配其 Explorer 面板的浮层层级，桌宠拖进面板区域也不会被遮挡

## 安装

1. 把本仓库软链进你的 DSH web profile 依赖：

   ```bash
   ln -s /path/to/whale-purse ~/.dsh/profiles/web/node_modules/whale-purse
   ```

2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 里加一条 insert：

   ```yaml
   - insert:
       - id: whale-purse
         name: 'whale-purse'
         config:
           model: auto           # auto | pro | flash
           refreshIntervalSeconds: 30
           lowBalanceThreshold: 20   # 余额低于 20 元时提醒（可不写，默认 10）
           dailyBudget: 5            # 今日花费超过 5 元时提醒（可不写，默认不提醒）
   ```

3. 保存后刷新浏览器即可（`Cmd+Shift+R`）。

余额接口需要能解析到 `DEEPSEEK_API_KEY`（凭据缝 → 启动环境 → `process.env`，逐层回退）。

> 推荐在鲸鱼娘面板右上角点 **⚙ 设置** 修改 `model`、低余额阈值、今日预算；保存后写入 `~/.dsh/whale-purse.settings.json`，优先级高于下面 YAML 里的同名配置，无需重启。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `model` | `auto` | 计价模型：`auto`（按会话实际请求头识别；非 DeepSeek 模型不估算花费）/ `pro` / `flash` |
| `refreshIntervalSeconds` | `30` | 余额轮询间隔（秒） |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | API key 的环境变量名 |
| `baseUrl` | `https://api.deepseek.com` | 余额接口 base URL |
| `pricingRefreshHours` | `6` | 官方定价页抓取间隔（小时） |
| `lowBalanceThreshold` | `10` | 余额低于该值（CNY）时触发低余额提示 |
| `dailyBudget` | 未设置 | 今日花费预算（CNY），超过后面板提示 |
| `enabled` | `true` | 是否启用余额查询 |

## 项目结构

```
whale-purse/
├── lib/
│   ├── index.js        # host 端：余额服务 + HTTP 路由（/api/whale-purse/balance、/api/whale-purse/balance/daily、/api/whale-purse/balance/messages、/api/whale-purse/settings）
│   └── client.js       # 浏览器端：鲸鱼娘桌宠 + 双 Tab 面板（WebP 立绘 base64 内联）
├── assets/
│   ├── whale-sprite.webp       # 内联立绘（280×373，透明，约 41KB）
│   ├── whale-sprite.png        # 鲸鱼娘立绘源 PNG（280×373，透明）
│   ├── whale-front-source.png  # 立绘源图
│   └── preview.png             # 预览图
└── scripts/
    ├── embed-asset.mjs         # 把 whale-sprite.webp/png 重新内联进 lib/client.js
    ├── screenshot.mjs          # Playwright 截图脚本
    └── smoke-test.mjs          # 模型识别/计价逻辑冒烟测试（node scripts/smoke-test.mjs）
```

`whale-sprite.webp` 由 PNG 源图生成：`cwebp -q 90 -alpha_q 100 -m 6 assets/whale-sprite.png -o assets/whale-sprite.webp`。改完素材后运行 `npm run embed` 重新内联。

## 素材来源与版权

- 鲸鱼娘立绘来自 [dafeiyu-pet](https://github.com/1190fasheqi/dafeiyu-pet)（MIT License），是 DeepSeek 鲸鱼形象的二创桌宠。
- 本项目为 DeepSeek / DSH 的非官方插件，与 DeepSeek 官方无关联。

## License

[MIT](LICENSE)
