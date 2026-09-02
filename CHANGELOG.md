# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

版本号的唯一来源是 `manifest.json` 的 `version`，`build.py` 会把它同步到 Firefox 清单、油猴脚本的 `@version` 和 zip 文件名。

---

## [3.1.3] — 2026-09-02

### 修复

- **Firefox 的「官方 MAIN 世界通道」以前是死代码，现在真的走通了。**
  `content.js` 里的 `registerMainWorld()` 在内容脚本里调用 `browser.scripting.registerContentScripts`，
  但 `scripting` 这套 API 在内容脚本里根本不存在（内容脚本只拿得到 `storage` / `runtime` / `i18n` 那一小撮），
  `browser.scripting` 恒为 `undefined`，函数每次都在第一句就 `return` —— v3.1.2 补的 `host_permissions`
  也救不了它。后果是 Firefox 上只剩 `script` 标签注入这一条路，而它会被页面 CSP 挡掉，
  `checkout.stripe.com` 自己就是严格 CSP，**恰恰是最该抓到的那个页面抓不到**。
  改法：`manifest.firefox.json` 的 `content_scripts` 里直接给 `pagehook.js` 声明 `"world": "MAIN"`
  （Firefox 128 起原生支持）。`registerMainWorld()` 整段删除，`scripting` 权限一并去掉。
  Firefox 127 及以下不认识 `world` 这个 key，会把 `pagehook.js` 塞进隔离世界 —— 那样它会插上握手旗子、
  让 `script` 标签兜底不再执行，等于把老版本钩废；所以 `pagehook.js` 开头加了一句世界判定
  （隔离世界里 `browser.runtime.id` 有值，主世界里没有），认出来直接退出，照旧落回兜底路径。

- **XHR 对象被复用时，监听器会一直堆积。**
  `pagehook.js` 每次 `send()` 命中白名单就 `addEventListener("load", ...)`，从不摘除。
  同一个 XHR 复用 N 次就挂 N 个监听器，`load` 时全部触发：一个响应被记 N 条；
  更糟的是，命中支付接口留下的监听器，会在后续**不命中**的请求 `load` 时照样触发，
  去读白名单之外的响应体 —— 直接破掉「不命中的请求，响应体连碰都不碰」这条自己写的隐私边界。
  改法：每次 `send()` 打一个自增序号，闭包捕获，监听器里序号对不上立刻 `return`；
  监听器改成 `{ once: true }`，触发完自动摘除。序号是**每次 send 都加**，不是只在命中时加 ——
  否则「命中的请求被中断、同一个对象接着发一个不命中的请求」时序号仍然对得上，漏洞照旧。
  油猴版有同样的代码，一并改了。

- **跨 frame 的写入竞态。**
  `content.js` 是 `all_frames: true`，顶层页面和每个 iframe 各跑一份实例；
  里面那条 `writeQueue` 只在自己这份实例内排队，跨 frame 完全不排队，
  而 `chrome.storage.local` 是所有 frame 共用的同一份 —— 两个 frame 同时 `get→改→set`，
  后写的那次拿到旧数组，会把另一条记录整个盖掉。Stripe Elements 的确认请求恰恰是从 iframe 里发出去的，
  正是最容易撞车的场景。
  改法：子 frame 不再自己落盘，把记录 `postMessage` 给顶层，由顶层那一份实例排队统一写。

- **`/v1/tokens`、`/v1/charges` 这几条泛路径会误抓非支付站点。**
  任何站点自家的 `/api/v1/tokens`（比如登录换 token）都会命中白名单，失败响应里的 `error.code`
  被记成一条「拒付」，弹窗里冒出莫名其妙的「未收录的原因码」。
  改法：URL 不是 `stripe.com` 域名、只靠泛路径命中时，追加一道校验 —— `error.type` 必须是 Stripe
  的六种官方类型之一，或者响应里有 Stripe 特有的 `outcome` / `object` 结构，否则不落盘。
  `PAY_URL` 那一行没动（两个版本必须逐字一致，`test.js` 会查）。

- **Chrome 版的兜底注入以前是死路。**
  `content.js` 用 `<script src="chrome-extension://...">` 加载 `pagehook.js`，
  但 Chrome 清单里没有 `web_accessible_resources`，MV3 下这条路必然加载失败，
  失败后 `<script>` 元素还留在页面 DOM 里（只写了 `onload` 清理、没写 `onerror`）。
  实际影响很小（Chrome 走清单的 MAIN 世界很可靠，兜底路平时不执行），但补上了：
  Chrome 清单加 `web_accessible_resources`，注入代码加 `onerror` 清理。

### 测试

- 自检从 60 项加到 **71 项**：泛路径闸门 2 条、XHR 复用 3 条、结构性检查 6 条。

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
