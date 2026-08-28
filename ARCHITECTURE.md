# 内部结构

想改代码、想 fork、或者单纯好奇它是怎么工作的，看这份。只是想装来用的话回 [README](README.md) 就行。

- [为什么是两个文件](#为什么是两个文件)
- [能调的参数](#能调的参数)
- [自检](#自检)
- [仓库结构](#仓库结构)
- [发一个新版本](#发一个新版本)

---

## 为什么是两个文件

### MAIN world 和 ISOLATED world 是两个 window

浏览器扩展的内容脚本默认跑在隔离世界里。隔离世界能拿到 `chrome.storage`，但它的 `window` 不是页面的 `window`。在那里改 `window.fetch`，页面的 `fetch` 一点事没有。

反过来，主世界（`world: "MAIN"`）能改页面的 `fetch`，但拿不到 `chrome.storage`。

所以必须两个文件配合：

```
pagehook.js  (MAIN 世界)      content.js  (ISOLATED 世界)
     │                              │
  包住页面的 fetch                 拿得到 chrome.storage
     │                              │
     └──── postMessage ────────────>┘
```

`postMessage` 是它们之间唯一的通道。

v2.1 在这里栽过：用一个 `window` 变量做「已经钩过了」的握手标记。两个世界的 `window` 是不同对象，这个标记永远传不过去，于是重复注入。v3 改成往 DOM 上插属性：

```js
document.documentElement.setAttribute("data-declinelens", "1");
```

DOM 是两个世界唯一共享的东西。油猴版也插同一面旗子，这就是为什么两版同装不会记两遍。

### 油猴里必须用 unsafeWindow

这是 v2.1 最致命的一个 bug，因为它完全静默。

Tampermonkey 里只要 `@grant` 了任何一项（不是 `none`），脚本就跑在沙箱里。此时：

```js
window.fetch = wrapped;             // 包住的是沙箱的 fetch，页面根本不受影响
unsafeWindow.fetch = wrapped;       // 包住的是页面真正在用的那个
```

写错的后果是：装上去一切正常，图标在、面板能开、没有任何报错，只是永远抓不到东西。这种 bug 靠肉眼审代码非常难发现。

所以：

```js
const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
```

`test.js` 第 3 节专门为这个 bug 造了一个「沙箱 + 页面」双 `window` 结构，钩错对象那一节会当场全红。

### 另外几个踩过的小坑

- **`fetch` 包装器不能是 `async` 函数。** `async` 会把返回值重新包一层 Promise，交给页面的就不是原始那个 Promise 对象了。必须原样 `return origFetch(...)`，解析工作挂在 `.then()` 里做。
- **`chrome.storage` 的读改写有竞态。** 一次支付提交可能同时触发 `confirm` 和 `payment_intent` 两个响应，两次 `get → 改 → set` 撞上就丢一条。`content.js` 用一条 Promise 链把写操作排成队列。
- **油猴版不能用队列**，因为 `GM_setValue` 是每帧同步的，跨 iframe 的写会互相覆盖。那边靠 `ts + code + host` 组 key 去重合并。
- **UI 只画一次。** 钩子会进每个 frame（`all_frames: true`），但界面得判断 `if (!IS_TOP) return;`，否则 Stripe 那个卡号 iframe 里会再画一个浮球。

---

## 能调的参数

改完重新 `python build.py` 就生效。

### 抓取范围 PAY_URL

```js
// pagehook.js:49  ·  userscript.template.js 里有一份逐字相同的
const PAY_URL = /(^|\/\/|\.)stripe\.com(?=[\/:?#]|$)|\/v1\/payment_intents?|\/v1\/setup_intents?|\/v1\/payment_methods?|\/v1\/charges?|\/v1\/tokens?|\/billing_portal/i;
```

只有匹配这条正则的 URL，响应体才会被读取。其它请求连 `.clone()` 都不做，直接原样放过。这不是把结果过滤掉不显示，是根本没看。

两个细节是有意为之：

- `(?=[\/:?#]|$)` 要求域名后面必须跟边界符。少了这个先行断言，`stripe.com.evil.com` 也会匹配上。
- `\/v1\/payment_intents?` 单复数都收，Stripe 两种路径形式都在用。

要扩到别的支付网关（Adyen、Braintree、自建后端），改这一行就行。**两个文件必须一起改**，自检第 5 节会逐字比对，不一致直接失败。这条规则存在的理由是：这行正则就是隐私边界，两边跑偏意味着一个版本的读取范围悄悄大于另一个。

### 判定「这是一次失败」

```js
// pagehook.js
const looksLikeFailure = /declin|refus|fail|reject|insufficient|not[ _]support|expired|incorrect|invalid|拒绝|拒付|失败|不支持/i;

const isErrorish = !!code                                  // 有 decline_code / code
  || type === "card_error"                                 // Stripe 明确说是卡的问题
  || (httpStatus >= 400 && !!msg)                          // 4xx 且带报文
  || (!!msg && looksLikeFailure.test(String(msg)));        // 报文本身看起来像失败
```

第三条那个 `&& !!msg` 不能去掉。光凭 HTTP 4xx 不算失败，很多站点在正常轮询 401/404，去掉这个条件它们会往记录里灌一堆空壳。而记录是 `unshift` 进数组、超过 200 条丢尾部的，空壳灌满 200 条就会把真正的拒付记录全挤掉。

### 存储

| 参数 | 值 | 在哪 | 说明 |
| --- | --- | --- | --- |
| `KEY` | `"declines"` | `content.js:16` / 油猴脚本 | 记录数组的键名，两版同名但互不相通 |
| `CAP` | `200` | `content.js:17` / 油猴脚本 | 最多留 200 条，新的 `unshift` 到头部，旧的从尾部丢 |
| `FAIL_KEY` | `"hookFail"` | `content.js:19`（`popup.js` 里有同样的字面量，两边一起改） | 注入失败的域名表：`{host: 时间戳}` |
| 注入失败检测 | `3000` ms | `content.js:130` | 3 秒后 DOM 上还没有 `data-declinelens` 就判定钩子没装上。只记顶层窗口，否则广告 iframe 会把一堆你根本没付过款的域名写进去 |
| 失败提示窗口 | `7 * 24 * 3600 * 1000` | `popup.js:104` | 只显示最近 7 天的失败域名，过期的自动不再提醒 |
| 存储后端 | `chrome.storage.local` / `GM_setValue` | | 插件版走前者，油猴版走后者 |

### 记录里存了哪 11 个字段

```js
{
  ts:          1724832727000,                  // 时间戳
  host:        "api.stripe.com",               // 请求打到哪个域名
  httpStatus:  402,                            // HTTP 状态码
  code:        "transaction_not_allowed",      // decline_code 优先，退回 error.code
  type:        "card_error",                   // Stripe 的错误分类
  message:     "Your card does not support…",  // Stripe 的原始英文报文
  adviceCode:  "do_not_try_again",             // 官方「还有没有救」，最有价值的一个字段
  networkCode: "57",                           // 银行/卡组织的原始拒绝码
  riskLevel:   "normal",                       // Stripe 风控评级
  amount:      4900,                           // 最小货币单位
  currency:    "usd"
}
```

这里没有 `raw` 字段，是刻意删掉的。v2.1 存了 `JSON.stringify(响应).slice(0, 600)`，那 600 字节里可能夹着邮箱、姓名、账单地址、卡号后四位，而界面上从来没读过它，等于存了一份谁都不看的敏感数据。v3 砍掉，只留上面 11 个诊断必需的字段。

`amount` 存的是最小货币单位（Stripe 的原样）。显示的时候按币种换算：

```js
// dict.js:177
const ZERO_DECIMAL = ["bif","clp","djf","gnf","jpy","kmf","krw","mga",
                      "pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"];
```

这 16 个是零小数币种（日元、韩元、越南盾等），不能除以 100。`4900 jpy` 是 4900 日元，不是 49 日元。

### 字典 dict.js

| 表 | 条数 | 内容 |
| --- | --- | --- |
| `DICT` | 55 | 原因码 → `{why: 为什么, fix: 怎么办}` |
| `MSG_RULES` | 12 | 报文关键词 → 解释。数组顺序即优先级，越靠前越先命中 |
| `ADVICE_DICT` | 3 | `advice_code` → 中文（`do_not_try_again` / `try_again_later` / `do_not_try_again_or_use_alternative`）|
| `TYPE_DICT` | 6 | `error.type` → 中文 |

`diagnose()` 里有个门禁，决定报文规则什么时候能接管：

```js
const isVague = !code
  || code === "generic_decline"
  || code === "do_not_honor"
  || code === "card_declined";
```

只有原因码本身含糊时才让 `MSG_RULES` 接管。否则一个精确的 `insufficient_funds` 会被某条泛化的报文规则盖成「未知拒付」，信息量反而变少。

`dict.js` 有一个硬约束：必须保持纯净，只能有 `const` 和函数声明，不能有 `import` / `export`，不能碰 `window` / `chrome` / `GM_*`，不能有任何副作用。因为这个文件要同时活在两种环境里，`build.py` 把它逐字内联进油猴脚本，`popup.html` 用 `<script>` 标签直接加载它，任何环境相关的东西都会在另一边炸掉。

### 唯一来源

| 东西 | 唯一来源 | 其它地方怎么来的 |
| --- | --- | --- |
| 版本号 | `manifest.json` 的 `version` | `build.py` 同步进 `manifest.firefox.json`、注入 `@version`、命名 zip |
| 仓库地址 | `dict.js` 的 `REPO_URL` | 注入油猴脚本的 `@namespace` / `@homepageURL` / `@supportURL` / `@downloadURL` / `@updateURL`，以及两个界面里的「发个 issue」入口 |

```js
// dict.js:22 —— 建仓后第一件事就是改这一行
const REPO_URL = "https://github.com/CHANGE-ME/DeclineLens";
const REPO_OK  = REPO_URL.indexOf("CHANGE-ME") < 0;
```

`REPO_OK` 是个门禁：只要地址还是占位符，两个界面都会隐藏「发个 issue」链接。指向 404 的链接比没有链接更伤信任。

改完必须重新 `python build.py`，否则 `DeclineLens.user.js` 里还是旧地址，自动更新会失效。`setup_repo.py` 会把这两步一起做掉。

别的地方出现版本号或仓库地址的硬编码，都是 bug。

### 兼容性下限

| 参数 | 值 | 为什么是这个数 |
| --- | --- | --- |
| `minimum_chrome_version` | `"111"` | 清单里声明 `world: "MAIN"` 是 Chrome 111 才支持的 |
| `strict_min_version`（Firefox） | `"109.0"` | Firefox MV3 的起点 |
| `permissions`（Chrome） | `["storage"]` | 就一个。没有 `tabs`、`webRequest`、`host_permissions` |
| `permissions`（Firefox） | `["storage", "scripting"]` | `scripting` 用来注册 MAIN 世界脚本 |
| `host_permissions`（Firefox） | `["http://*/*", "https://*/*"]` | `scripting.registerContentScripts` 硬要求，缺了官方通道不启动 |
| `run_at` / `@run-at` | `document_start` | 必须。页面打包产物在解析阶段就把 `window.fetch` 存进闭包了，晚一步就永远抓不到 |
| `all_frames` | `true` | Stripe 的卡号输入框本身就是个 iframe |
| `@grant`（油猴） | `unsafeWindow` `GM_setValue` `GM_getValue` `GM_addValueChangeListener` `GM_registerMenuCommand` `GM_setClipboard` | `unsafeWindow` 是必需的，见上面那一节 |

---

## 自检

```bash
node test.js        # 或者 npm test
```

60 项断言，零依赖，不需要浏览器。用 Node 的 `vm` 模块造假页面，把 `pagehook.js` 和构建好的油猴脚本分别放进去跑，喂真实形状的 Stripe 响应。

| 节 | 管什么 |
| --- | --- |
| 1 字典 | `diagnose()` 的判定顺序、`isVague` 门禁、零小数币种换算 |
| 2 扩展版抓取 | 抓到没、抓对没、`isErrorish` 的门槛、有没有吞掉页面的请求 |
| 3 油猴版抓取 | `unsafeWindow` 那个坑（双 `window` 结构验证）、DOM 旗子 |
| 4 XSS | 喂恶意 payload，验转义和 Shadow DOM 隔离 |
| 5 双版本一致性 | 内联字典与 `dict.js` 逐字一致、`PAY_URL` 逐字相同、三处版本号对齐 |

第 4 节值得多说一句：**这个工具自己就是攻击面**。记录会存下来，并在之后打开的每一个页面上重新渲染。在恶意站点收到的 `<img src=x onerror=...>` 会在你下次打开 `checkout.stripe.com` 时于那个上下文里执行。所以所有插进 HTML 的字段一律过 `esc()`，油猴版的界面整个塞在 `mode: "closed"` 的 Shadow DOM 里加 `:host{all:initial}`。v2.1 的油猴版两样都没有。

第 5 节存在的理由：v2.1 时字典是手抄进油猴脚本的，两边跑偏了，插件版 42 条、油猴版 19 条，同一个原因码在两个版本里给出不同解释。现在字典只有一份，`build.py` 内联，自检逐字比对。

---

## 仓库结构

```
DeclineLens/
├── manifest.json              # Chrome MV3 清单 —— 版本号的唯一来源
├── manifest.firefox.json      # Firefox 清单（scripting + host_permissions 那条路）
├── pagehook.js                # MAIN 世界：包住页面的 fetch
├── content.js                 # ISOLATED 世界：收信 + 落盘 + Firefox 回退
├── dict.js                    # 字典与诊断引擎 —— REPO_URL 的唯一来源
├── popup.html / popup.js      # 插件版界面
├── userscript.template.js     # 油猴版模板（不能直接装，含占位符）
├── DeclineLens.user.js        # 构建产物，但要提交 —— raw 安装链接和自动更新都指着它
│
├── build.py                   # 打包：两个 zip + 油猴脚本，带自检
├── test.js                    # 60 项自检，零依赖
├── check_docs.py              # 文档体检：占位符 / 损坏字符 / 内部死链
├── make_icons.py              # 生成三个尺寸的图标
├── make_screenshots.py        # 用无头浏览器渲染真实界面，生成 docs/ 里的两张截图
├── make_release_notes.py      # 从 CHANGELOG + manifest + dict.js 拼出 Release 正文
├── setup_repo.py              # 建仓后跑一次：把 REPO_URL 换成你的地址并重新构建
├── icon16/48/128.png
│
├── .gitattributes             # 全仓库强制 LF（CI 有一步靠 git diff 判同步）
├── .editorconfig              # 缩进与换行统一，免得编辑器互相改空白
├── .github/
│   ├── workflows/
│   │   ├── ci.yml             # 每次 push：重新构建 + 验同步 + 60 项自检 + 文档体检
│   │   └── release.yml        # 推一个 v* tag：自动构建 + 建 Release + 传两个 zip
│   ├── ISSUE_TEMPLATE/        # 「没收录的码」和「坏了」两个模板
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml         # 每月跟进 CI 用到的官方 Action 版本
│
├── README.md                  # 装和用
├── README.en.md               # 英文简版
├── ARCHITECTURE.md            # 就是这份
├── CHANGELOG.md               # 版本历史（v2.1 那几个静默 bug 都记在里面）
├── CONTRIBUTING.md            # 改代码前必读的几条硬约束
├── PRIVACY.md                 # 隐私政策，逐条可验
├── SECURITY.md                # 威胁模型 + 漏洞怎么报
├── SUPPORT.md                 # 遇到问题去哪儿问 + 常见问题
├── ROADMAP.md                 # 打算做什么、明确不做什么
├── CODE_OF_CONDUCT.md         # 行为准则
├── LICENSE                    # MIT
└── docs/                      # 两张截图（由 make_screenshots.py 生成）
```

`DeclineLens.user.js` 是唯一一个「生成物却要提交」的文件，因为用户的安装链接和油猴的自动更新都直接指向它。永远不要手改它，改 `userscript.template.js` 或 `dict.js` 然后重新构建。

`dist/` 在 `.gitignore` 里。扩展的两个 zip 通过 GitHub Release 分发，不进仓库。

---

## 发一个新版本

版本号只在 `manifest.json` 里改一处，剩下的交给 CI：

```bash
# 1. 改 manifest.json 的 version
# 2. 在 CHANGELOG.md 里补上这一版的段落   ← 漏了这步 release.yml 会红，是故意的
python build.py && node test.js
git commit -am "DeclineLens v3.2.0" && git push
git tag v3.2.0 && git push origin v3.2.0     # ← 这一推，剩下全自动
```

最后一条一推，`.github/workflows/release.yml` 会自己跑完：核对 tag 与 `manifest.json` 版本号一致 → 跑 60 项自检 → 文档体检 → 构建 → 用 `make_release_notes.py` 拼正文 → 建 Release → 传两个 zip。任何一步不过就不发。
