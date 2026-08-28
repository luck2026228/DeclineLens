# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

版本号的唯一来源是 `manifest.json` 的 `version`，`build.py` 会把它同步到 Firefox 清单、油猴脚本的 `@version` 和 zip 文件名。

---

## [3.1.2] — 2026-08-28

### 修复

- **油猴版现在也会在 DOM 上插握手旗子 `data-declinelens`。**
  之前只设了页面 `window` 上的标记。两个版本同时安装、且油猴版抢先跑到时，插件版的 `content.js` 看不到任何标记，3 秒后就会往 `hookFail` 里写一条 —— 弹窗顶部弹出「CSP 拦住了注入」的黄条，**而实际上一切正常**。属于虚惊一场型的误报，现在消除了。
- **Firefox 清单补上 `host_permissions: ["http://*/*", "https://*/*"]`。**
  `browser.scripting.registerContentScripts` 除了 `scripting` 权限，还要求扩展持有目标页面的主机权限，否则注入的脚本不会运行。缺这一条的后果是：文档里写的「Firefox 128+ 走官方 MAIN 世界通道」这条正路**从来没有真正启动过**，每次都静默退化成 `script` 标签注入 —— 而那条路会被有 CSP 的站点挡掉。
  注意 Firefox MV3 里 `host_permissions` 默认是可选权限，用户仍需在 `about:addons` 里手动授权，README 的 Firefox 安装步骤里已写明这一步。

### 测试

- 自检从 58 项加到 **60 项**，新增两条专盯上面第一个问题：油猴版必须插旗子、`content.js` 必须认同一面旗子。

---

## [3.1.1]

### 修复

- `make_icons.py` 改成相对 `__file__` 定位输出目录（之前硬编码了一个本机绝对路径，别人 clone 下来跑会写到错误的地方）。
- `build.py` 的占位符改成运行时拼接（`"//__" + "DICT_INLINE" + "__"`）。之前占位符字面量直接写在源码里，`str.replace` 在替换时会把自己文档里的那份说明一起换掉，第一次构建就炸了。

---

## [3.1.0]

### 新增

- `build.py --deploy`：构建完成后把成品分发到本地目录，附带一张「这是成品目录」的字条，防止把成品目录当源码目录去改。
- `_fresh()` 安全护栏：分发前清空目标目录，但如果目录里的内容看起来不像自己上次的输出，直接拒绝删除。

---

## [3.0.0] — 重写

v2.1 有几个**完全静默**的致命 bug：装上去看起来一切正常，只是永远抓不到东西，或者抓到了但解释是错的。这一版是针对它们的重写。

### 修复（致命级）

- **油猴版钩错了对象。** `@grant` 了任何一项（不是 `none`）之后，脚本就跑在沙箱里，`window.fetch = wrapped` 包住的是**沙箱的** fetch，页面的 fetch 毫发无损。改用 `unsafeWindow`。这个 bug 没有任何报错、没有任何症状，只是永远零记录。`test.js` 第 3 节专门为它造了一个「沙箱 + 页面」双 `window` 结构。
- **两个世界的握手标记传不过去。** 主世界（`world:"MAIN"`）和隔离世界（内容脚本）的 `window` 是不同对象，用 `window` 变量做「已钩过」标记永远传不到对面，导致重复注入。改成往 DOM 上插属性 —— DOM 是两个世界唯一共享的东西。
- **油猴版把注入推迟了 800 毫秒。** `setTimeout(hook, 800)` 直接自废了 `@run-at document-start` 的全部意义：页面打包产物在解析阶段就把 `window.fetch` 存进闭包了，晚一步就永远抓不到。删掉延迟。
- **油猴版没有 XSS 防护。** 记录会在**之后打开的每一个页面**上重新渲染，所以在恶意站点收到的 `<img src=x onerror=...>` 会在你下次打开 `checkout.stripe.com` 时于那个上下文里执行。补上 `esc()` 全字段转义 + `mode:"closed"` 的 Shadow DOM + `:host{all:initial}`。
- **两个版本的字典跑偏了。** 之前是手抄的，插件版 42 条，油猴版 19 条 —— 同一个原因码在两个版本里给出不同解释。现在字典只有 `dict.js` 一份，`build.py` 逐字内联，自检逐字比对。

### 修复（数据与隐私）

- **删掉 `raw` 字段。** v2.1 存了 `JSON.stringify(响应).slice(0, 600)`，那 600 字节里可能夹着邮箱、姓名、账单地址、卡号后四位，而界面从来没读过它 —— 存了一份谁都不看的敏感数据。现在只留 11 个诊断必需字段。
- **`isErrorish` 加上 `&& !!msg` 门槛。** 光凭 HTTP 4xx 不算失败：很多站点在正常轮询 401/404，没这道门槛它们会往记录里灌空壳，而记录只留 200 条，空壳灌满就把真正的拒付记录全挤掉了。
- **`PAY_URL` 加边界先行断言 `(?=[\/:?#]|$)`。** 没有它，`stripe.com.evil.com` 也会被当成 Stripe 域名，等于把响应体读取范围偷偷放大到任何攻击者控制的域名。
- **`chrome.storage` 写入串行化。** get→改→set 是异步读改写，一次支付提交可能同时触发 `confirm` 和 `payment_intent` 两个响应，两次写撞上就丢一条。用一条 Promise 链排队。
- **零小数币种。** 新增 `ZERO_DECIMAL` 16 项（日元、韩元、越南盾……），这些币种的 `amount` 不能除以 100。之前 `4900 jpy` 会显示成 `49.00 JPY`。
- **注入失败检测只记顶层窗口。** 之前每个 frame 都记，广告 iframe 会把一串你根本没付款过的域名写进警示栏。

### 新增

- `advice_code` 终于显示出来了。v2.1 抓了这个字段却从来没用过 —— 而它是整个响应里最有价值的一个：Stripe 官方直接告诉你「还有没有救」。
- `network_decline_code`（银行/卡组织原始码）、`risk_level`（风控评级）。
- `MSG_RULES` 报文规则表 12 条，配 `isVague` 门禁：只有原因码本身含糊（`generic_decline` / `do_not_honor` / `card_declined` / 无码）时才让报文接管，否则精确的 `insufficient_funds` 会被泛化规则盖成「未知拒付」。
- `REPO_OK` 门禁：`REPO_URL` 还是占位符时，两个界面都隐藏「发个 issue」入口。指向 404 的链接比没有链接更伤信任。
- `test.js`：零依赖自检，用 Node 的 `vm` 造假页面。
- Firefox 支持：独立清单 + `scripting.registerContentScripts` 官方通道 + `script` 标签回退。

---

## [2.1.0] 及更早

早期版本。上面 3.0.0 那一串就是从这里挖出来的，不建议使用。
