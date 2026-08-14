# whale-watch 🐋

> 一只住在 DeepSeek Harness（DSH）里的鲸鱼娘桌宠，帮你盯着 DeepSeek 账户余额和当前会话的用量/花费。

把「DeepSeek 余额 + 会话 token 用量/预估花费」做成一只可拖拽的二次元鲸鱼娘，浮在 DSH Web GUI 上。点她弹出用量明细面板，拖她换位置，位置自动记住；余额 30s、花费 3s 自动刷新。

![preview](assets/preview.png)

## 特性

- 🐋 **鲸鱼娘桌宠**：透明立绘悬浮在页面上，随波轻微摇摆，脚底带投影
- 🖱️ **可拖拽**：拖动换位（`localStorage` 记忆，刷新/重开保持），点击开面板
- 💰 **余额监视**：DeepSeek 官方 `Get User Balance` 接口，30s 轮询 + 并发去重
- 🧮 **会话用量**：读 `sessionProjections` 的 `tokenUsage` 投影，按官方价格折算花费（输入/缓存读/缓存写/输出分桶）
- ⚡ **峰谷定价**：北京 9:00-12:00 / 14:00-18:00 高峰价自动切换；官方定价页每 6h 自动抓取
- 🌗 **主题适配**：面板颜色跟随 DSH 浅色/深色主题（`--dsw-alias-*` token）
- 🛡️ **友好错误**：余额/定价请求超时显示「请求超时」而非英文 `This operation was aborted`

## 安装

1. 把本仓库软链进你的 DSH web profile 依赖：

   ```bash
   ln -s /path/to/whale-watch ~/.dsh/profiles/web/node_modules/whale-watch
   ```

2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 里加一条 insert：

   ```yaml
   - insert:
       - id: whale-watch
         name: 'whale-watch'
         config:
           model: pro            # pro | flash
           refreshIntervalSeconds: 30
   ```

3. 保存后刷新浏览器即可（`Cmd+Shift+R`）。

余额接口需要能解析到 `DEEPSEEK_API_KEY`（凭据缝 → 启动环境 → `process.env`，逐层回退）。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `model` | `pro` | 计价模型：`pro` / `flash` |
| `refreshIntervalSeconds` | `30` | 余额轮询间隔（秒） |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | API key 的环境变量名 |
| `baseUrl` | `https://api.deepseek.com` | 余额接口 base URL |
| `pricingRefreshHours` | `6` | 官方定价页抓取间隔（小时） |
| `enabled` | `true` | 是否启用余额查询 |

## 项目结构

```
whale-watch/
├── lib/
│   ├── index.js        # host 端：余额服务 + HTTP 路由（/api/balance 等）
│   └── client.js       # 浏览器端：鲸鱼娘桌宠 + 面板（立绘 base64 内联）
├── assets/
│   ├── whale-sprite.png        # 鲸鱼娘立绘（280×373，透明）
│   ├── whale-front-source.png  # 立绘源图
│   └── preview.png             # 预览图
└── scripts/screenshot.mjs      # Playwright 截图脚本
```

## 素材来源与版权

- 鲸鱼娘立绘来自 [dafeiyu-pet](https://github.com/1190fasheqi/dafeiyu-pet)（MIT License），是 DeepSeek 鲸鱼形象的二创桌宠。
- 本项目为 DeepSeek / DSH 的非官方插件，与 DeepSeek 官方无关联。

## License

[MIT](LICENSE)
