# DeclineLens 拒付透视镜

**支付失败的时候，Stripe 其实已经把真正的原因写在响应里了 —— 只是页面不给你看。这个工具把它捞出来，翻译成人话，再告诉你下一步该干什么。**

纯本地运行，零网络请求，不上传任何数据。两种形态任选：**浏览器插件**（Chrome / Edge / Firefox）或**油猴脚本**（单文件，Tampermonkey / Violentmonkey）。

`MIT` · `55 个原因码` · `12 条报文规则` · `60 项自检` · `零依赖`

[更新日志](CHANGELOG.md) · [隐私政策](PRIVACY.md) · [参与进来](CONTRIBUTING.md)

---

## 一、痛点：为什么会有这个东西

我在做境外支付的时候，卡了整整两天。

页面上就一句话：

> **Your card was declined.**

没有编号，没有解释，没有下一步。于是开始猜：是余额不够？是卡不支持境外？是被风控了？是 3DS 没过？还是商户那边配置有问题？每猜一个就得重刷一遍订单，重填一遍卡号，等一次超时。**猜错的成本是十几分钟，而且猜错了你根本不知道自己猜错了。**

后来我按 F12 打开 Network，翻到那个 402 的请求，展开响应体，看到了这个：

```json
{
  "error": {
    "code": "card_declined",
    "decline_code": "transaction_not_allowed",
    "advice_code": "do_not_try_again",
    "message": "Your card does not support this type of purchase.",
    "type": "card_error"
  },
  "outcome": { "network_decline_code": "57", "risk_level": "normal" }
}
```

`transaction_not_allowed`。翻译过来是：**这张卡不支持这一类消费**（比如订阅、跨境、或者某个特定的 MCC 商户类别）。跟余额没有一毛钱关系。

更关键的是 `advice_code: "do_not_try_again"` —— 这是 Stripe 官方在告诉你：**别再试了，重试一百次也是这个结果，换卡吧。**

我当时的反应是：这些信息一直都在，只是被前端吞掉了。**我猜了两天的东西，答案第一次失败的时候就已经在响应里了。**

### 具体被吞掉了什么

| 页面告诉你的 | 响应里实际有的 | 差别 |
| --- | --- | --- |
| Your card was declined. | `insufficient_funds` | 余额不够，换张卡或者充钱 |
| Your card was declined. | `transaction_not_allowed` | 卡不支持这类消费，重试无用 |
| Your card was declined. | `do_not_honor` | 发卡行不明原因拒绝，打电话给银行 |
| Your card was declined. | `lost_card` / `stolen_card` | 卡被挂失/报失，**不要再试**，会触发风控 |
| Your card was declined. | `try_again_later` | 纯粹的临时故障，等几分钟原样再来一次就行 |
| Your card was declined. | `authentication_required` | 需要 3DS 验证，弹窗被拦了或者没弹出来 |
| Your card was declined. | `card_velocity_exceeded` | 短时间刷太多次，被频率风控了，等一段时间 |

同样一句 "declined"，上面这七种情况的正确应对**完全不同**，甚至有两种是「继续试会让情况更糟」。

### 谁需要这个

- **跨境电商 / SaaS 卖家** —— 客服在处理"我付不了款"的工单，需要一句能给客户的具体答复
- **做 Stripe 接入的开发** —— 联调时不想每次都开 F12 翻 Network
- **测试 / QA** —— 需要留一份可复现的失败记录贴到工单里
- **任何在境外网站被拒付过的人** —— 想知道是自己的卡的问题，还是对方网站的问题

### 这个工具不做什么

说清楚边界，免得期望错位：

- **不能让一张被拒的卡变成能用的卡。** 它只解释，不施法。
- **不能改变支付结果。** 它是只读的旁听者，请求原样送走，响应原样交回页面。
- **不碰钱。** 不接触卡号、不接触 CVV、不接触任何输入框。
- **不联网。** 一次请求都不发，包括「检查更新」。

---

## 二、它长什么样

**油猴版**：右下角一个小球，出现拒付记录时才显示，带角标计数。点开是一块面板，每条记录都有「原因码 → 为什么 → 怎么办」三行，底部有「复制报告」和「清空」。

**插件版**：点工具栏图标弹出 460px 面板，同样的三行结构，另外多一条黄色警示栏 —— 如果某个站点的钩子装不上（被 CSP 拦了），它会把域名列出来告诉你。

单条记录读起来是这样：

```
🔴 transaction_not_allowed                    14:32:07  shop.example.com
   为什么   这张卡不支持这类消费（订阅 / 跨境 / 特定商户类别）
   怎么办   换一张卡。Stripe 官方建议：不要重试（do_not_try_again）
   金额     49.00 USD   ·   HTTP 402   ·   银行原始码 57   ·   风险 normal
```

**油猴版**——左边是页面给你的全部信息，右边是同一次拒付实际说了什么：

![油猴版浮球与面板](docs/screenshot-userscript.png)

**插件版**——点工具栏图标弹出：

![插件版弹窗](docs/screenshot-popup.png)

> 这两张图是 `python make_screenshots.py` 用**真正的界面代码**渲染出来的（无头浏览器 + 假数据），
> 不是手画的示意图。界面改了重跑一遍，截图自动跟上。图里的域名、金额、时间全是编的。

---

## 三、装哪个版本

两个版本功能**完全一样**，共用同一套字典和同一条抓取规则（有一项自检专门逐字比对这两份代码，防止它们偷偷跑偏）。区别只在装法和寿命：

| | 油猴脚本版 | 浏览器插件版 |
| --- | --- | --- |
| **文件** | `DeclineLens.user.js` 单文件 | 一个 zip / 一个目录 |
| **前置** | 需要先装 Tampermonkey 或 Violentmonkey | 不需要任何前置 |
| **装法** | 点一下链接，确认安装 | 开发者模式加载已解压的扩展 |
| **自动更新** | ✅ 走 `@updateURL`，仓库一推新版就自动跟 | ❌ 手动重新加载 |
| **重启浏览器后** | 一直在 | Chrome 在；**Firefox 临时加载会失效** |
| **界面** | 页面右下角浮球 + 面板 | 工具栏图标 + 弹窗 |
| **存储** | `GM_setValue`（油猴自己的库） | `chrome.storage.local` |
| **抗 CSP** | 强（油猴在浏览器层注入） | Chrome 强；Firefox 老版本可能被 CSP 挡 |

**结论：先装油猴版。** 装起来一步，自动更新，重启不掉，抗 CSP 更好。插件版留给「不想装油猴框架」和「要上应用商店」的场景。

---

## 四、使用方法

### 4.1 油猴脚本版（推荐）

**第一步**：装一个脚本管理器，二选一 ——

- [Tampermonkey](https://www.tampermonkey.net/)（最常用，Chrome / Edge / Firefox / Safari 都有）
- [Violentmonkey](https://violentmonkey.github.io/)（开源，Chrome / Edge / Firefox）

**第二步**：点这个链接，管理器会自动弹出安装确认页 ——

```
https://raw.githubusercontent.com/luck2026228/DeclineLens/main/DeclineLens.user.js
```

> 如果没自动弹窗：把上面的链接打开，全选复制，然后 Tampermonkey → 添加新脚本 → 粘贴 → `Ctrl+S`。

**第三步**：装完就生效了，不需要重启浏览器，不需要任何配置。

**怎么用**：正常付款。付款成功的话你什么都看不见（这是设计好的 —— 零记录时浮球完全隐藏）。一旦有拒付，右下角浮球出现并带上角标，点开看原因。

**菜单命令**（在 Tampermonkey 图标的下拉菜单里）：

| 命令 | 作用 |
| --- | --- |
| 打开面板 | 手动唤出面板，浮球被页面元素挡住时用 |
| 复制最近一条报告 | 一键复制成纯文本，直接贴工单 / issue |
| 清空记录 | 全删，立即生效 |

### 4.2 插件版 · Chrome / Edge

**方式 A — 用打包好的 zip**

1. 从 [Releases](../../releases) 下载 `DeclineLens-v3.1.2-chrome.zip`
2. 解压到一个**你不会随手删掉的目录**（Chrome 每次启动都要从这个路径读，删了插件就消失）
3. 地址栏输 `chrome://extensions`
4. 右上角打开「开发者模式」
5. 点「加载已解压的扩展程序」，选中刚才解压出来的目录
6. 建议把图标固定到工具栏（拼图图标 → 图钉）

**方式 B — 直接用仓库源码**

仓库根目录本身就是一个可加载的 Chrome 扩展（`manifest.json` 和所有源文件都在根上）。所以：

```bash
git clone https://github.com/luck2026228/DeclineLens.git
# 然后 chrome://extensions → 加载已解压的扩展程序 → 选中 DeclineLens 目录
```

多出来的 `build.py` / `test.js` / `userscript.template.js` 不影响运行，Chrome 会忽略它们。

**方式 C — 自己打包**

```bash
python build.py          # 生成 dist/ 里的两个 zip 和根目录的 .user.js
python build.py --deploy # 额外把成品分发到本地目录
```

只需要 Python 3，不需要 pip 装任何东西。装了 Node 的话 `build.py` 会顺手调 `node --check` 做一遍语法自检。

### 4.3 插件版 · Firefox

Firefox 要用另一份清单（MV3 那边不支持在清单里声明 `world:"MAIN"`，得走 `scripting` API）：

1. 下载 `DeclineLens-v3.1.2-firefox.zip` 并解压
2. 地址栏输 `about:debugging#/runtime/this-firefox`
3. 「临时载入附加组件」→ 选中目录里的 `manifest.json`
4. **打开 `about:addons` → DeclineLens → 权限 → 允许它「访问所有网站的数据」**

第 4 步不是可选的。Firefox 的 `scripting.registerContentScripts` 要求扩展持有目标页面的主机权限，没授权的话官方注入通道不会启动，会静默退化成 `script` 标签注入 —— 那条路会被有 CSP 的站点（包括 `checkout.stripe.com` 本身）挡住。

**Firefox 的已知限制**：「临时载入」在浏览器重启后会失效，每次开机都得重来一遍。要长期用得先做 AMO 签名。**所以 Firefox 上直接用油猴版更省事**，功能完全一样。

### 4.4 两个版本同时装了会怎样

不会记两遍。两边共用页面 `window` 上的同一个标记和 DOM 上的同一面旗子（`data-declinelens`），谁先跑谁装钩子，后到的那个自己退出。你会看到两个界面（浮球 + 工具栏图标），但它们背后是**两份独立的存储**，所以同一笔拒付只会出现在先装上钩子的那一边。

想干净一点就只留一个。

---

## 五、代码参数

所有可调的东西都在这里，改完重新 `python build.py` 就生效。

### 5.1 抓取范围 `PAY_URL` —— 隐私边界就是这一行

```js
// pagehook.js:49  ·  userscript.template.js 里有一份逐字相同的
const PAY_URL = /(^|\/\/|\.)stripe\.com(?=[\/:?#]|$)|\/v1\/payment_intents?|\/v1\/setup_intents?|\/v1\/payment_methods?|\/v1\/charges?|\/v1\/tokens?|\/billing_portal/i;
```

**只有匹配这条正则的 URL，响应体才会被读取。** 其它请求连 `.clone()` 都不做，直接原样放过。这不是"过滤显示"，是"根本没看"。

两个细节是有意为之：

- `(?=[\/:?#]|$)` —— 域名后面必须跟边界符。少了这个先行断言，`stripe.com.evil.com` 也会匹配上。
- `\/v1\/payment_intents?` —— 单复数都收，Stripe 两种路径形式都在用。

**要扩到别的支付网关**（Adyen / Braintree / 自建后端），改这一行就行。**两个文件必须一起改**，第 5 节的自检会逐字比对，不一致直接测试失败。

### 5.2 判定"这是一次失败" `isErrorish`

```js
// pagehook.js
const looksLikeFailure = /declin|refus|fail|reject|insufficient|not[ _]support|expired|incorrect|invalid|拒绝|拒付|失败|不支持/i;

const isErrorish = !!code                                  // 有 decline_code / code
  || type === "card_error"                                 // Stripe 明确说是卡的问题
  || (httpStatus >= 400 && !!msg)                          // 4xx 且**带报文**
  || (!!msg && looksLikeFailure.test(String(msg)));        // 报文本身看起来像失败
```

第三条那个 `&& !!msg` 不能去掉。**光凭 HTTP 4xx 不算失败** —— 很多站点在正常轮询 401/404，去掉这个条件的话它们会往记录里灌一堆空壳。而记录是 `unshift` 进数组、超过 200 条丢尾部的，空壳灌满 200 条就会把真正的拒付记录全部挤掉。

### 5.3 存储

| 参数 | 值 | 在哪 | 说明 |
| --- | --- | --- | --- |
| `KEY` | `"declines"` | `content.js:16` / 油猴脚本 | 记录数组的键名，两版同名但**互不相通** |
| `CAP` | `200` | `content.js:17` / 油猴脚本 | 最多留 200 条，新的 `unshift` 到头部，旧的从尾部丢 |
| `FAIL_KEY` | `"hookFail"` | `content.js:19`（`popup.js` 里有同样的字面量，两边一起改） | 注入失败的域名表：`{host: 时间戳}` |
| 注入失败检测 | `3000` ms | `content.js:130` | 3 秒后 DOM 上还没有 `data-declinelens` 就判定钩子没装上；**只记顶层窗口**，否则广告 iframe 会把一堆你根本没付款的域名写进去 |
| 失败提示窗口 | `7 * 24 * 3600 * 1000` | `popup.js:104` | 只显示最近 7 天的失败域名，过期的自动不再提醒 |
| 存储后端 | `chrome.storage.local` / `GM_setValue` | | 插件版走前者，油猴版走后者 |

### 5.4 每条记录存了哪 11 个字段

```js
{
  ts:          1724832727000,                  // 时间戳
  host:        "api.stripe.com",               // 请求打到哪个域名
  httpStatus:  402,                            // HTTP 状态码
  code:        "transaction_not_allowed",      // decline_code 优先，退回 error.code
  type:        "card_error",                   // Stripe 的错误分类
  message:     "Your card does not support…",  // Stripe 的原始英文报文
  adviceCode:  "do_not_try_again",             // ★ 官方"还有没有救"，最有价值的一个字段
  networkCode: "57",                           // 银行/卡组织的原始拒绝码
  riskLevel:   "normal",                       // Stripe 风控评级
  amount:      4900,                           // 最小货币单位
  currency:    "usd"
}
```

**这里没有 `raw` 字段，是刻意删掉的。** v2.1 版本存了 `JSON.stringify(响应).slice(0, 600)`，那 600 字节里可能夹着邮箱、姓名、账单地址、卡号后四位，而界面上从来没读过它 —— 存了一份谁都不看的敏感数据。v3 直接砍掉，只留上面这 11 个诊断必需的字段。

`amount` 存的是**最小货币单位**（Stripe 的原样）。显示的时候按币种换算：

```js
// dict.js:177
const ZERO_DECIMAL = ["bif","clp","djf","gnf","jpy","kmf","krw","mga",
                      "pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"];
```

这 16 个是零小数币种（日元、韩元、越南盾……），**不能除以 100**。`4900 jpy` 是 4900 日元，不是 49 日元。

### 5.5 字典 `dict.js`

| 表 | 条数 | 内容 |
| --- | --- | --- |
| `DICT` | **55** | 原因码 → `{why: 为什么, fix: 怎么办}` |
| `MSG_RULES` | **12** | 报文关键词 → 解释。**数组顺序即优先级**，越靠前越先命中 |
| `ADVICE_DICT` | **3** | `advice_code` → 中文（`do_not_try_again` / `try_again_later` / `do_not_try_again_or_use_alternative`）|
| `TYPE_DICT` | **6** | `error.type` → 中文 |

`diagnose()` 的判定顺序，以及为什么 `MSG_RULES` 不能无条件覆盖 `DICT`：

```js
const isVague = !code
  || code === "generic_decline"
  || code === "do_not_honor"
  || code === "card_declined";
```

**只有原因码本身含糊时**，才让报文规则接管。否则一个精确的 `insufficient_funds` 会被某条泛化的报文规则盖成"未知拒付"，**信息量反而变少了**。

`dict.js` 有一个硬约束：**必须保持"纯净"** —— 只有 `const` 和函数声明，不能有 `import` / `export`，不能碰 `window` / `chrome` / `GM_*`，不能有任何副作用。因为这个文件会被 `build.py` 逐字内联进油猴脚本，同时被 `popup.html` 用 `<script>` 直接加载，两种环境都得跑得起来。

### 5.6 唯一来源（改的时候只改一处）

| 东西 | 唯一来源 | 其它地方怎么来的 |
| --- | --- | --- |
| **版本号** | `manifest.json` 的 `version` | `build.py` 同步进 `manifest.firefox.json`、注入 `@version`、命名 zip |
| **仓库地址** | `dict.js` 的 `REPO_URL` | 注入油猴脚本的 `@namespace` / `@homepageURL` / `@supportURL` / `@downloadURL` / `@updateURL`，以及两个界面里的「发个 issue」入口 |

```js
// dict.js:22 —— 建仓后第一件事就是改这一行
const REPO_URL = "https://github.com/CHANGE-ME/DeclineLens";
const REPO_OK  = REPO_URL.indexOf("CHANGE-ME") < 0;
```

`REPO_OK` 是个门禁：只要地址还是占位符，两个界面都会**隐藏**「发个 issue」链接。指向 404 的链接比没有链接更伤信任。

**改完必须重新 `python build.py`**，否则 `DeclineLens.user.js` 里还是旧地址，自动更新会失效。

### 5.7 兼容性下限

| 参数 | 值 | 为什么是这个数 |
| --- | --- | --- |
| `minimum_chrome_version` | `"111"` | 清单里声明 `world: "MAIN"` 是 Chrome 111 才支持的 |
| `strict_min_version`（Firefox） | `"109.0"` | Firefox MV3 的起点 |
| `permissions`（Chrome） | `["storage"]` | 就一个。**没有** `tabs`、`webRequest`、`host_permissions` |
| `permissions`（Firefox） | `["storage", "scripting"]` | `scripting` 用来注册 MAIN 世界脚本 |
| `host_permissions`（Firefox） | `["http://*/*", "https://*/*"]` | `scripting.registerContentScripts` 硬要求，缺了官方通道不启动 |
| `run_at` / `@run-at` | `document_start` | **必须**。页面打包产物在解析阶段就把 `window.fetch` 存进闭包了，晚一步就永远抓不到 |
| `all_frames` | `true` | Stripe 的卡号输入框本身就是个 iframe |
| `@grant`（油猴） | `unsafeWindow` `GM_setValue` `GM_getValue` `GM_addValueChangeListener` `GM_registerMenuCommand` `GM_setClipboard` | `unsafeWindow` 是必需的，见第七节 |

---

## 六、隐私

不是一句"我们重视您的隐私"，是能逐条对着代码验的：

| 承诺 | 怎么验 |
| --- | --- |
| **零网络请求** | 全仓库 `grep` 一遍：没有 `XMLHttpRequest` 的发起、没有对外 `fetch`、没有 `sendBeacon`、没有 `<img>` 打点。连"检查更新"都没有 |
| **只读匹配 `PAY_URL` 的响应** | 见 5.1。不匹配的请求连 `.clone()` 都不执行 |
| **不接触输入框** | 全仓库没有一处 `document.querySelector` 去读 `input`。抓的是 HTTP 响应，不是页面 DOM |
| **不存原始响应体** | 见 5.4。只有那 11 个字段落盘 |
| **数据只在你机器上** | `chrome.storage.local` / `GM_setValue`，都是本地。清空按钮是真删 |
| **权限最小** | Chrome 就一个 `storage` |

顺带说个反直觉的点：**这个工具需要 XSS 防护，因为它自己是攻击面**。记录会存下来，并在**之后打开的每一个页面**上重新渲染。也就是说，如果在恶意站点 A 上收到一条报文是 `<img src=x onerror=...>` 的响应，这段代码会在你下次打开 `checkout.stripe.com` 时在那个上下文里执行。

所以：所有插入 HTML 的字段一律过 `esc()`，油猴版的界面整个塞在 `mode: "closed"` 的 Shadow DOM 里加 `:host{all:initial}`。自检里有一节（第 4 节）专门喂恶意 payload 验这件事 —— v2.1 的油猴版两样都没有。

完整逐条版本见 [PRIVACY.md](PRIVACY.md)。

---

## 七、架构：为什么是两个文件，而不是一个

这一节是给想改代码的人看的。里面有两个坑，都是踩过的。

### 坑一：MAIN world 和 ISOLATED world 是两个 `window`

浏览器扩展的内容脚本默认跑在**隔离世界**里。隔离世界能拿到 `chrome.storage`，但它的 `window` 不是页面的 `window` —— 在那里改 `window.fetch`，页面的 `fetch` 一点事没有。

反过来，主世界（`world: "MAIN"`）能改页面的 `fetch`，但拿不到 `chrome.storage`。

所以必须两个文件配合：

```
pagehook.js  (MAIN 世界)      content.js  (ISOLATED 世界)
     │                              │
  包住页面的 fetch                 拿得到 chrome.storage
     │                              │
     └──── postMessage ────────────>┘
```

`postMessage` 是它们之间**唯一**的通道。

**v2.1 在这里栽了**：用一个 `window` 变量做"已经钩过了"的握手标记。两个世界的 `window` 是不同对象，所以这个标记永远传不过去 —— 隔离世界看不见主世界设的值，于是重复注入。v3 改成往 DOM 上插属性：

```js
document.documentElement.setAttribute("data-declinelens", "1");
```

DOM 是两个世界**唯一共享**的东西。油猴版也插同一面旗子（这就是为什么两版同装不会记两遍）。

### 坑二：油猴里必须用 `unsafeWindow`

这是 v2.1 最致命的一个 bug，因为它**完全静默**。

Tampermonkey 里只要 `@grant` 了任何一项（不是 `none`），脚本就跑在沙箱里。此时：

```js
window.fetch = wrapped;             // ❌ 包住的是沙箱的 fetch，页面根本不受影响
unsafeWindow.fetch = wrapped;       // ✅ 包住的是页面真正在用的那个
```

写错的后果是：装上去一切正常，图标在、面板能开、没有任何报错 —— **只是永远抓不到东西**。这种 bug 靠肉眼审代码非常难发现。

所以：

```js
const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;
```

而 `test.js` 的第 3 节专门为这个 bug 造了一个"沙箱 + 页面"双 `window` 结构 —— 如果钩错了对象，那一节会当场全红。

### 顺带几个也踩过的小坑

- **`fetch` 包装器不能是 `async` 函数。** `async` 会把返回值重新包一层 Promise，交给页面的就不是原始那个 Promise 对象了。必须原样 `return origFetch(...)`，解析工作挂在 `.then()` 里做。
- **`chrome.storage` 的读改写是有竞态的。** 一次支付提交可能同时触发 `confirm` 和 `payment_intent` 两个响应，两次 `get→改→set` 撞上就丢一条。`content.js` 用一条 Promise 链把写操作排成队列解决。
- **油猴版不能用队列**，因为 `GM_setValue` 是每帧同步的，跨 iframe 的写会互相覆盖。那边靠 `ts + code + host` 组成 key 去重合并。
- **UI 只画一次。** 钩子进每个 frame（`all_frames: true`），但界面得判断 `if (!IS_TOP) return;`，否则 Stripe 那个卡号 iframe 里会再画一个浮球。

---

## 八、自检

```bash
node test.js        # 或者 npm test
```

**60 项断言，零依赖**，不需要浏览器 —— 用 Node 的 `vm` 模块造假页面，把 `pagehook.js` 和构建好的油猴脚本分别放进去跑，喂真实形状的 Stripe 响应。

五节分别管什么：

| 节 | 管什么 |
| --- | --- |
| **[1] 字典** | `diagnose()` 的判定顺序、`isVague` 门禁、零小数币种换算 |
| **[2] 扩展版抓取** | 抓到没、抓对没、`isErrorish` 的门槛、有没有吞掉页面的请求 |
| **[3] 油猴版抓取** | **`unsafeWindow` 那个坑**（双 `window` 结构验证）、DOM 旗子 |
| **[4] XSS** | 喂恶意 payload，验转义和 Shadow DOM 隔离 |
| **[5] 双版本一致性** | 内联字典与 `dict.js` **逐字**一致、`PAY_URL` **逐字**相同、三处版本号对齐 |

第 5 节存在的理由：v2.1 时字典是手抄进油猴脚本的，结果两边跑偏了 —— 插件版 42 条，油猴版 19 条，同一个原因码在两个版本里给出不同的解释。现在字典只有一份，`build.py` 内联，自检逐字比对。

---

## 九、想加原因码 / 遇到没收录的

Stripe 的原因码在持续增加，字典肯定有漏的。碰到一条没收录的，界面上会直接显示原始码并给一个入口。

**最省事的做法**：点「复制报告」，开个 issue，把内容粘进去。报告是纯文本的，不含任何隐私字段（就是 5.4 那 11 个），可以直接贴。

**自己动手改**：`dict.js` 里加一条就行，格式一目了然 ——

```js
insufficient_funds: {
  why: "卡里余额不够，或者超出了信用额度",
  fix: "换一张卡，或者给这张卡充钱之后重试",
},
```

加完跑一遍 `node test.js`，然后 `python build.py`（**别手改 `DeclineLens.user.js`**，那是生成物，下次构建就被覆盖了）。

改代码之前的几条硬约束（`dict.js` 为什么必须保持纯净、`PAY_URL` 为什么两份必须逐字相同、这个项目明确不要什么）写在 [CONTRIBUTING.md](CONTRIBUTING.md) 里。

---

## 十、常见问题

**Q：装了它，我的支付会不会变慢或者失败？**
不会。它是旁听者：请求原样送走，响应 `.clone()` 一份自己看，原始那份原样交回页面。就算解析代码整段抛异常，也包在 `try/catch` 里，不影响支付流程。

**Q：为什么付款成功的时候什么都没有？**
设计如此。零记录时浮球完全隐藏，成功的支付不会留任何痕迹。

**Q：它能记录我在别的网站的什么行为吗？**
只有匹配 `PAY_URL`（第 5.1 节那一行正则）的响应会被读取。其它请求它连看都不看。整个仓库没有一处对外发请求的代码，你可以自己 `grep`。

**Q：在 `checkout.stripe.com` 上能用吗？**
能。这也是为什么 `run_at` 必须是 `document_start`、`all_frames` 必须是 `true` —— Stripe 自己的收银台和卡号输入框都是 iframe。

**Q：某个网站上浮球一直不出现？**
两种可能。一是这个站没触发拒付（正常）。二是钩子被 CSP 挡了 —— 插件版的弹窗顶部会出现一条黄色警示栏列出域名。**这种情况换油猴版**，油猴在浏览器层注入，不受页面 CSP 约束。

**Q：记录会一直存着吗？占地方吗？**
最多 200 条，超了自动丢最旧的。每条就那 11 个字段，200 条也才几十 KB。

**Q：数据会同步到别的设备吗？**
不会。用的是 `storage.local` 不是 `storage.sync`，油猴版用的是 `GM_setValue`。全部只在本机。

---

## 十一、仓库结构

```
DeclineLens/
├── manifest.json              # Chrome MV3 清单 —— 版本号的唯一来源
├── manifest.firefox.json      # Firefox 清单（scripting + host_permissions 那条路）
├── pagehook.js                # MAIN 世界：包住页面的 fetch
├── content.js                 # ISOLATED 世界：收信 + 落盘 + Firefox 回退
├── dict.js                    # 字典与诊断引擎 —— REPO_URL 的唯一来源
├── popup.html / popup.js      # 插件版界面
├── userscript.template.js     # 油猴版模板（不能直接装，含占位符）
├── DeclineLens.user.js        # ★ 构建产物，但**要提交** —— raw 链接安装和自动更新都指着它
├── build.py                   # 打包：两个 zip + 油猴脚本，带自检
├── test.js                    # 60 项自检，零依赖
├── make_icons.py              # 生成三个尺寸的图标
├── make_screenshots.py        # 用无头浏览器渲染真实界面，生成 docs/ 里的两张截图
├── setup_repo.py              # 建仓后跑一次：把 REPO_URL 换成你的地址并重新构建
├── icon16/48/128.png
├── .gitattributes             # 全仓库强制 LF（CI 有一步靠 git diff 判同步）
├── .github/
│   ├── workflows/ci.yml       # 每次 push：重新构建 + 验同步 + 跑 60 项自检
│   └── ISSUE_TEMPLATE/        # 「没收录的码」和「坏了」两个模板
├── CHANGELOG.md               # 版本历史（v2.1 那几个静默 bug 都记在里面）
├── CONTRIBUTING.md            # 改代码前必读的几条硬约束
├── PRIVACY.md                 # 隐私政策，逐条可验
└── docs/                      # 两张截图（由 make_screenshots.py 生成）
```

`DeclineLens.user.js` 是唯一一个"生成物却要提交"的文件 —— 因为用户的安装链接和油猴的自动更新都直接指向它。**永远不要手改它**，改 `userscript.template.js` 或 `dict.js` 然后重新构建。

`dist/` 在 `.gitignore` 里。扩展的两个 zip 通过 **GitHub Release** 分发，不进仓库。

---

## 十二、License

MIT。拿去改、拿去卖、拿去嵌进你自己的产品，都行，留个版权声明就好。

字典部分（`dict.js`）如果你在别的项目里用，我会很高兴 —— 那 55 条 + 12 条规则是一条一条对着 Stripe 文档和真实响应攒出来的。

---

<a name="english"></a>

## English

**DeclineLens** decodes what Stripe actually said when a payment failed.

The page shows you "Your card was declined." The API response contains `decline_code`, `advice_code`, `network_decline_code` and a human-readable `message` — the frontend just throws them away. This tool intercepts the response, decodes the code, and tells you what to do next.

**Two formats, identical features:**

- **Userscript** — single file, one-click install via Tampermonkey/Violentmonkey, auto-updates. *Recommended.*
- **Browser extension** — Chrome/Edge (MV3, `world:"MAIN"`, needs Chrome 111+) and Firefox (`scripting` API + host permission).

**Privacy, verifiable line by line:**

- **Zero network requests.** Not one. Including update checks.
- **Only responses matching one regex** (`PAY_URL`, see §5.1) are ever read. Everything else isn't even cloned.
- **Never touches input fields.** It reads HTTP responses, not the DOM.
- **11 fields stored, no raw body.** No email, no name, no billing address, no card digits.
- **`storage.local` / `GM_setValue`** — local only, never synced. Capped at 200 records.
- **Chrome permissions: `["storage"]`.** That's the whole list.

**Two bugs worth knowing about if you fork this:**

1. **MAIN and ISOLATED worlds have different `window` objects.** The handshake flag must live on the DOM (`data-declinelens`), not on `window`. v2.1 used a `window` variable and it silently never propagated.
2. **In Tampermonkey, any `@grant` other than `none` sandboxes your script.** `window.fetch = wrapped` then wraps the *sandbox's* fetch — the extension appears to work perfectly and captures nothing, forever. You must use `unsafeWindow`. `test.js` §3 builds a two-layer sandbox/page window structure specifically to catch this.

**Contributing:** hit an unrecognized code? Click "复制报告" (copy report) and open an issue — the report is plain text with no private fields. Or add an entry to `dict.js` yourself, run `node test.js`, then `python build.py`. Never hand-edit `DeclineLens.user.js`; it's generated.

```bash
node test.js        # 60 assertions, zero dependencies, no browser needed
python build.py     # builds both extension zips + the userscript
```

---

**MIT** · 这个工具不碰钱，只解释钱为什么没花出去。
