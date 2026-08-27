# 截图

这两张图**不用手截**，跑一条命令就出来：

```bash
python make_screenshots.py
```

| 文件 | 内容 |
| --- | --- |
| `screenshot-popup.png` | 插件版弹窗，460px 原宽，4 条记录 |
| `screenshot-userscript.png` | 油猴版：浮球（带角标）+ 展开的面板，浮在一个示例结账页上 |

它做的事：把 `popup.html` / `DeclineLens.user.js` **原封不动**丢进无头 Chrome，喂一组写死的假数据，然后截图。所以

- **界面改了，重跑一遍，截图自动跟上** —— 不会出现「文档里是旧界面」。
- **不会泄露任何东西** —— 域名写死 `api.stripe.com`，金额时间全是编的，从头到尾没碰过真实支付页面。
- **每次结果完全一样** —— 时间戳是常量，不会因为今天几号导致图片差一个字节，白白产生 diff。

脚本只在**替身页面**里做了两件事，仓库代码一个字没改：假的 `chrome.storage`（喂数据用）和把 `attachShadow` 临时改成 `open`（面板真身藏在 `mode:"closed"` 的影子里，外面点不开，得撬一下才能截到展开态）。

需要 Chrome 或 Edge（自动找），外加 Pillow 裁掉底部空白（没装也能跑，只是图底下留白）。

---

**想自己手截的话**，两点注意：

- **别截真实支付页面**，域名金额时间都会露出去。用 Stripe 官方[测试卡号](https://stripe.com/docs/testing#declined-payments)造记录：
  - `4000000000000002` → `generic_decline`
  - `4000000000009995` → `insufficient_funds`
  - `4000000000009987` → `lost_card`
  - `4000000000000069` → `expired_card`
  - `4000000000000127` → `incorrect_cvc`
- GitHub 的 README 深浅两种主题下都会被看到，白边在暗色主题里很扎眼，尽量截得贴边。
