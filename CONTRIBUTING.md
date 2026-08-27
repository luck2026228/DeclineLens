# 参与进来

这个项目最需要的贡献不是代码，是**字典条目**。

Stripe 的原因码在持续增加，`dict.js` 里那 55 条肯定有漏的。你在真实场景里遇到一条没收录的，那条信息比我自己坐着翻文档翻出来的有价值得多 —— 因为它是真的发生过的。

### 先确认你要找的是不是这份文档

| 你想干的事 | 去哪儿 |
| --- | --- |
| 装不上、不出球、看不懂结果 | [SUPPORT.md](SUPPORT.md) —— 那边有三步自查，多数问题在那儿就解决了 |
| 报一条没收录的原因码 | 本文档 [第一节](#一只想报一条没收录的码30-秒) |
| 改代码、提 PR | 本文档 [第三节](#三改代码之前先知道这几条) 起 |
| 发现了安全问题 | [SECURITY.md](SECURITY.md) —— **别开公开 issue** |
| 想知道以后要做什么、为什么某个功能不做 | [ROADMAP.md](ROADMAP.md) |
| 交流时的行为准则 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

无论走哪条路，有一条是共同的：**任何地方都不要贴真实支付数据**（完整卡号、卡号后四位、持卡人姓名、账单地址、真实邮箱、订单号、未脱敏的 Stripe 原始响应）。要复现就用 [Stripe 官方测试卡](https://docs.stripe.com/testing)。

---

## 一、只想报一条没收录的码（30 秒）

界面上点「复制报告」→ 开 issue → 粘进去。选「没收录的原因码」那个模板，它会问该问的东西。

报告是纯文本，只含 11 个诊断字段，不含任何隐私字段（README 第 5.4 节列了完整清单）。

---

## 二、想自己动手加

### 加一条原因码

`dict.js` 里的 `DICT`：

```js
insufficient_funds: {
  why: "卡里余额不够，或者超出了信用额度",
  fix: "换一张卡，或者给这张卡充钱之后重试",
},
```

两条写作要求，请务必遵守：

- **`why` 说的是"发生了什么"，不是把原因码翻译一遍。**
  ❌ `why: "交易不被允许"` —— 这是把 `transaction_not_allowed` 直译，读者没多知道任何东西。
  ✅ `why: "这张卡不支持这一类消费（订阅 / 跨境 / 特定商户类别）"`
- **`fix` 必须是一个能立刻执行的动作。**
  ❌ `fix: "请联系发卡行"` —— 联系了说什么？
  ✅ `fix: "打发卡行客服，说明是境外订阅类交易被拒，请他们放开这一类"`
  如果这个码就是"没救了"，那就直说：`fix: "换卡。这个码重试无效。"`

### 加一条报文规则

`MSG_RULES` 是数组，**顺序即优先级**，越靠前越先命中。加新规则时想清楚它该排在哪：

```js
[/does not support this type of purchase/i, "这张卡不支持这一类消费"],
```

注意 `MSG_RULES` **不会无条件覆盖 `DICT`**。只有原因码本身含糊时才让它接管：

```js
const isVague = !code || code === "generic_decline"
             || code === "do_not_honor" || code === "card_declined";
```

否则一个精确的 `insufficient_funds` 会被某条泛化的报文规则盖掉，信息量反而变少。

---

## 三、改代码之前先知道这几条

### 1. `dict.js` 必须保持"纯净"

只能有 `const` 和函数声明。**不能**有 `import` / `export`，**不能**碰 `window` / `chrome` / `GM_*`，**不能**有任何副作用。

因为这一个文件要同时活在两种环境里：`build.py` 把它逐字内联进油猴脚本，`popup.html` 用 `<script>` 标签直接加载它。任何环境相关的东西都会在另一边炸掉。

### 2. **永远不要手改 `DeclineLens.user.js`**

它是 `build.py` 的产物（虽然要提交进仓库 —— 因为用户的安装链接和油猴自动更新都指着它）。手改的内容下次构建就没了。

改 `userscript.template.js` 或 `dict.js`，然后 `python build.py`。

### 3. `PAY_URL` 两个文件里各有一份，必须逐字相同

`pagehook.js` 和 `userscript.template.js`。自检第 5 节会**逐字**比对，不一致直接失败。这条规则存在的理由是：这行正则就是隐私边界，两边跑偏意味着一个版本的读取范围悄悄大于另一个。

### 4. 唯一来源

| 东西 | 改哪里 |
| --- | --- |
| 版本号 | 只改 `manifest.json` 的 `version`。`build.py` 会同步 Firefox 清单、注入 `@version`、命名 zip |
| 仓库地址 | 只改 `dict.js` 的 `REPO_URL`。`build.py` 会注入油猴脚本的五个元数据字段和两个界面的 issue 入口 |

别的地方出现这两样东西的硬编码，都是 bug。

### 5. `fetch` 包装器不能是 `async`

`async` 会把返回值重新包一层 Promise，交给页面的就不是原始那个 Promise 对象了。必须原样 `return origFetch(...)`，解析工作挂在 `.then()` 里做。

### 6. 所有插进 HTML 的字段必须过 `esc()`

**这个工具自己就是攻击面。** 记录会存下来并在之后打开的每一个页面上重新渲染 —— 在恶意站点收到的 `<img src=x onerror=...>` 会在你下次打开 `checkout.stripe.com` 时于那个上下文里执行。自检第 4 节专门喂恶意 payload 验这件事，别绕过它。

---

## 四、提交前

```bash
node test.js        # 或 npm test —— 必须 60 项全绿
python build.py     # 必须重新构建，并把 DeclineLens.user.js 一起提交
```

CI 会做同样两件事，另外还会检查这几项 —— 全都是踩过的坑，所以才写进流水线：

| CI 检查什么 | 为什么有这一条 |
| --- | --- |
| 提交的 `DeclineLens.user.js` 与源码同步 | 在 CI 里重跑 `build.py`，然后要求 `git diff` 干净。忘了重新构建的话直接红 |
| 六个 JS 文件都能过 `node --check` | 生成物的语法错误在浏览器里是**静默**的：油猴装得上，但什么都不做 |
| 版本号四处一致 | `manifest.json`、`manifest.firefox.json`、`package.json`、油猴 `@version` |
| 文档体检（`python check_docs.py`） | 残留占位符、损坏字符 `U+FFFD`、markdown 内部死链。本地跑 `npm run docs` 一样 |

开 PR 的时候会自动带出一份[检查清单](.github/PULL_REQUEST_TEMPLATE.md)，逐条勾一下就行 —— 那上面每一条都对应一个真实发生过的 bug，不是凑数的。

加了新行为的话，顺手在 `test.js` 里加条断言。那个文件零依赖、不需要浏览器，加一条的成本很低。

---

## 五、这个项目不想要什么

说清楚，免得白写：

- **任何形式的网络请求。** 包括「检查更新」、包括匿名统计、包括错误上报。「零网络请求」是这个工具的核心承诺，不接受任何例外。
- **扩大权限。** Chrome 那边就一个 `storage`，不加 `tabs`、不加 `webRequest`、不加 `host_permissions`。
- **存原始响应体。** v2.1 干过这事（存了 600 字节，里面可能夹着邮箱、姓名、账单地址、卡号后四位），已经删了，不会回来。
- **引入依赖。** 零依赖是硬约束。`build.py` 只要 Python 3 标准库，`test.js` 只要 Node 标准库。
- **自动重试支付。** 这个工具是只读旁听者。让它去点「重新支付」按钮，性质就完全变了，而且有些原因码（`lost_card` / `stolen_card` / `card_velocity_exceeded`）重试会让用户的情况更糟。
- **云端同步记录。** 记录只存在你自己的浏览器里。要同步就要有服务器，有服务器就有了泄露面。

这几条不是「暂时不做」，是**边界**。[ROADMAP.md](ROADMAP.md) 里另有一份「想做但还没想清楚」的清单 —— 那些是可以聊的，这些不是。

---

## 六、行为准则

参与讨论请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。核心就一句：对事不对人，别贴真实支付数据。

---

MIT 许可。提 PR 就默认你同意以 MIT 授权你的贡献。
