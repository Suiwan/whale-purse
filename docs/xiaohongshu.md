# 小红书发布内容（whale-watch）

> 自动发布（小红书 MCP `publish_content`）因网页版创作者中心「上传图文」TAB 找不到而失败，
> 此文档作为手动发布的完整文案，复制粘贴即可。

## 标题（任选其一，≤20 字）

1. 给你的 DeepSeek 装只鲸鱼娘桌宠🐋（推荐）
2. DeepSeek 鲸鱼娘桌宠，余额一眼看
3. 摸鱼神器：让鲸鱼娘帮你盯余额

## 正文

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

## 标签

`#DeepSeek` `#桌宠` `#开源` `#AI工具` `#摸鱼神器` `#效率工具` `#二次元` `#鲸鱼娘`

## 配图（顺序）

1. `assets/cover.png` —— 首图（3:4 竖版封面，海蓝渐变 + 鲸鱼娘立绘 + 标题）
2. `assets/shot-panel.png` —— 功能图（点开用量面板）
3. `assets/preview.png` —— 鲸鱼娘立绘特写

## 发布参数（MCP publish_content 已尝试，失败）

```json
{
  "title": "给你的 DeepSeek 装只鲸鱼娘桌宠",
  "content": "<正文，见上>",
  "images": [
    "<abs>/whale-watch/assets/cover.png",
    "<abs>/whale-watch/assets/shot-panel.png",
    "<abs>/whale-watch/assets/preview.png"
  ],
  "tags": ["DeepSeek", "桌宠", "开源", "AI工具", "摸鱼神器", "效率工具", "二次元", "鲸鱼娘"],
  "is_original": true
}
```
