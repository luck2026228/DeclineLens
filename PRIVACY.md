# 隐私政策

**最后更新：2026-08-28 · 适用版本：3.1.2**

一句话版本：**DeclineLens 不收集、不传输、不共享任何数据。它一次网络请求都不发。**

下面是能逐条对着源码验的完整说明。

---

## 一、收集什么

支付失败时，本工具会从 Stripe 的 API 响应里提取 **11 个字段**，存到你自己浏览器的本地存储里：

| 字段 | 内容 | 例 |
| --- | --- | --- |
| `ts` | 时间戳 | `1724832727000` |
| `host` | 请求打到的域名 | `api.stripe.com` |
| `httpStatus` | HTTP 状态码 | `402` |
| `code` | Stripe 的拒付原因码 | `transaction_not_allowed` |
| `type` | Stripe 的错误分类 | `card_error` |
| `message` | Stripe 返回的原始英文报文 | `Your card does not support…` |
| `adviceCode` | Stripe 官方的重试建议 | `do_not_try_again` |
| `networkCode` | 银行/卡组织的原始拒绝码 | `57` |
| `riskLevel` | Stripe 的风控评级 | `normal` |
| `amount` | 金额（最小货币单位） | `4900` |
| `currency` | 币种 | `usd` |

**就这 11 个，一个不多。**

## 二、明确不收集什么

- ❌ 卡号、有效期、CVV —— 代码里没有一处读取 `input` 元素。抓的是 HTTP 响应，不是页面 DOM。
- ❌ 姓名、邮箱、电话、账单地址、收货地址
- ❌ 原始响应体。3.0.0 之前的版本存过响应的前 600 字节，那里面可能夹着上述隐私字段。**已删除**，只留上表 11 项。
- ❌ 浏览历史、Cookie、localStorage、任何页面内容
- ❌ 设备指纹、IP、任何标识符

## 三、只读取哪些请求

**只有 URL 匹配下面这条正则的响应，响应体才会被读取。**

```js
/(^|\/\/|\.)stripe\.com(?=[\/:?#]|$)|\/v1\/payment_intents?|\/v1\/setup_intents?|\/v1\/payment_methods?|\/v1\/charges?|\/v1\/tokens?|\/billing_portal/i
```

不匹配的请求，代码连 `.clone()` 都不执行 —— 不是"读了之后过滤掉不显示"，是**根本没读**。

工具虽然声明了 `http://*/*` 和 `https://*/*` 的匹配范围（因为不可能预知你在哪个网站付款），但实际的读取范围就是上面这一行。

## 四、数据存在哪、存多久

| | |
| --- | --- |
| **存在哪** | 插件版：`chrome.storage.local`。油猴版：`GM_setValue`。**都是你本机。** |
| **会不会同步到别的设备** | **不会。** 用的是 `storage.local`，不是 `storage.sync`。 |
| **存多久** | 直到你点「清空」，或者被新记录挤掉。 |
| **上限** | **200 条**，超了自动丢最旧的。 |
| **怎么删干净** | 界面上的「清空」按钮。或者直接卸载 —— 卸载会连带清掉扩展/脚本的全部存储。 |

另外有一张 `hookFail` 表（`{域名: 时间戳}`），记录钩子注入失败的站点，用来在弹窗顶部提醒你。只记顶层窗口，只显示最近 7 天。

## 五、传输

**没有传输。**

- 没有服务器。这个项目不存在任何后端。
- 没有分析、没有遥测、没有崩溃上报。
- **连"检查更新"都没有。** 油猴版的自动更新是 Tampermonkey 自己去 GitHub 拉的，本工具的代码不参与。

自己验一遍：全仓库 `grep` 一下 `XMLHttpRequest`、`sendBeacon`、`navigator.send`、对外的 `fetch(` —— 只会找到那个被包装的 `origFetch` 调用（把页面自己的请求原样送走）。

## 六、权限

| 平台 | 声明的权限 | 干什么用 |
| --- | --- | --- |
| Chrome / Edge | `storage` | 存那 200 条记录。**列表就这一项。** |
| Firefox | `storage`, `scripting` | `scripting` 用于注册 MAIN 世界脚本（Firefox MV3 不能在清单里声明 `world:"MAIN"`） |
| Firefox | `host_permissions: http://*/*, https://*/*` | `scripting.registerContentScripts` 的硬性要求 |
| 油猴版 | `unsafeWindow`, `GM_setValue`, `GM_getValue`, `GM_addValueChangeListener`, `GM_registerMenuCommand`, `GM_setClipboard` | 分别是：钩页面真正的 fetch、本地存取、跨标签同步、菜单命令、复制报告到剪贴板 |

**没有** `tabs`、**没有** `webRequest`、**没有** `cookies`、**没有** `downloads`、**没有** `identity`。

## 七、第三方

没有第三方。零依赖，不加载任何外部资源 —— 没有 CDN、没有字体、没有图标库、没有 analytics。所有代码都在这个仓库里。

## 八、一个反直觉的点

这个工具需要 XSS 防护，**因为它自己是攻击面**。

记录会存下来，并在**之后打开的每一个页面**上重新渲染。也就是说，如果在一个恶意站点收到的响应报文是 `<img src=x onerror=...>`，这段代码会在你下次打开 `checkout.stripe.com` 时于那个上下文里执行。

所以：所有插入 HTML 的字段一律过 `esc()` 转义，油猴版的界面整个塞进 `mode:"closed"` 的 Shadow DOM 并加 `:host{all:initial}`。自检的第 4 节专门喂恶意 payload 验这件事。

## 九、变更

这份文件跟着代码走。任何影响上述内容的改动都会写进 `CHANGELOG.md`。

**"零网络请求"和"只存那 11 个字段"是硬承诺，不接受例外**（见 `CONTRIBUTING.md` 第五节）。

## 十、联系

有问题开 issue。这个项目没有邮箱、没有客服、没有任何需要你提供联系方式的渠道。

---

MIT · 源码全部公开，上面每一条都可以自己验。
