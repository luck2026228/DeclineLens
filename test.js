/* ============================================================================
 * DeclineLens 自检   ——   node test.js
 * ----------------------------------------------------------------------------
 * 不需要浏览器。用 vm 造一个假页面，把 pagehook.js 和生成好的油猴脚本分别
 * 放进去跑，喂几份真实形状的 Stripe 响应，看它们到底抓没抓到、抓对没抓对。
 *
 * 为什么值得写这个：v2.1 的油猴版有一个**完全静默**的致命 bug（沙箱里的
 * window.fetch 根本不是页面的 fetch），装上去看起来一切正常，只是永远抓不到
 * 东西。这种 bug 靠肉眼看代码很难发现，但在这里跑一遍就会当场暴露。
 * ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = __dirname;
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  →  " + detail : "")); }
}

function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

/* ── 假页面 ───────────────────────────────────────────────────────────────
 * 只提供被测代码真正会碰到的东西，多一个都不给——这样如果它偷偷依赖了别的
 * 全局，测试会直接抛错而不是悄悄通过。 */
function makePage(opts) {
  opts = opts || {};
  const page = {};
  page.window = page;
  page.self = page;
  page.top = opts.isTop ? page : {};          // 非顶层 → 油猴版会跳过 UI
  page.location = { origin: "https://shop.example.com", host: "shop.example.com" };
  page.document = {
    readyState: "complete",
    documentElement: {
      _attrs: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      hasAttribute(k) { return k in this._attrs; },
    },
    addEventListener() {},
  };
  page.captured = [];
  page.postMessage = function (msg) { page.captured.push(msg); };
  page.XMLHttpRequest = function () {};
  page.XMLHttpRequest.prototype = { open() {}, send() {} };
  page.console = console;
  return page;
}

/* Response 替身：只实现 pagehook 会用到的三个成员 */
function fakeResponse(json, status) {
  const r = {
    status: status || 402,
    clone() { return r; },
    json() { return Promise.resolve(json); },
  };
  return r;
}

/* ── 真实形状的样本 ─────────────────────────────────────────────────────── */

const SAMPLE_DECLINE = {           // 最常见：卡不支持这类交易
  error: {
    type: "card_error",
    code: "card_declined",
    decline_code: "transaction_not_allowed",
    advice_code: "do_not_try_again",
    message: "Your card does not support this type of purchase.",
    payment_intent: { amount: 2000, currency: "usd" },
  },
};

const SAMPLE_VAGUE = {             // 码没信息量，线索全在 message 里
  error: {
    type: "card_error",
    code: "card_declined",
    decline_code: "generic_decline",
    message: "Your card was declined. This transaction requires 3D Secure authentication.",
  },
};

const SAMPLE_OUTCOME = {           // 错误藏在 charge.outcome 里
  id: "pi_x",
  amount: 100000,
  currency: "jpy",
  last_payment_error: {
    type: "card_error",
    decline_code: "fraudulent",
    message: "Your card was declined.",
  },
  charge: {
    outcome: {
      network_decline_code: "59",
      risk_level: "highest",
      seller_message: "The bank returned the decline code fraudulent.",
    },
  },
};

const SAMPLE_MERCHANT_BUG = {      // 不是用户的卡的问题
  error: {
    type: "invalid_request_error",
    message: "No such payment_intent: 'pi_nope'",
  },
};

const SAMPLE_OK = {                // 成功，绝对不该被记录
  id: "pi_ok", status: "succeeded", amount: 2000, currency: "usd",
};

const SAMPLE_JUNK = {              // 404 且没有任何错误字段 —— 也不该被记录
  message: "",
};

const SAMPLE_XSS = {               // 恶意站点在原因码和报文里塞脚本
  error: {
    type: "card_error",
    decline_code: '<img src=x onerror="alert(1)">',
    message: '</div><script>alert(document.domain)</script>',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 字典与诊断引擎
 * ════════════════════════════════════════════════════════════════════════ */
console.log("\n[1] dict.js 诊断引擎");

const dictCtx = vm.createContext({ console });
/* dict.js 里全是 const —— const 声明进的是脚本的词法环境，不会挂到全局对象上，
 * 所以 vm 跑完从 context 上是取不到的。追加一段把它们导出来。
 * （浏览器里不需要这一步：同一个页面里后加载的 popup.js 能直接看到这些绑定。） */
const EXPORTS = ["DICT", "MSG_RULES", "ADVICE_DICT", "TYPE_DICT", "REPO_URL", "REPO_OK",
                 "ZERO_DECIMAL", "esc", "moneyStr", "fmtTime", "diagnose", "reportLine"];
vm.runInContext(
  read("dict.js") + "\n;globalThis.__X = {" + EXPORTS.join(",") + "};",
  dictCtx, { filename: "dict.js" });
const D = dictCtx.__X;

ok("字典条目 ≥ 45 条", Object.keys(D.DICT).length >= 45,
   "实际 " + Object.keys(D.DICT).length + " 条");

let badEntry = null;
for (const k of Object.keys(D.DICT)) {
  const v = D.DICT[k];
  if (!Array.isArray(v) || v.length !== 2 || !v[0] || !v[1]) { badEntry = k; break; }
}
ok("每条都是 [为什么, 怎么办] 且两项都不为空", badEntry === null, "问题条目: " + badEntry);

/* 源码里查重复 key：JS 对象会静默吃掉后一个，靠 Object.keys 是查不出来的。
 * 必须只在 DICT 那一块里查——try_again_later 在 DICT 和 ADVICE_DICT 里各有一条，
 * 那是 Stripe 自己的命名（decline_code 和 advice_code 恰好同名），不是重复。 */
const dictSrc = read("dict.js");
function objBlock(src, name) {
  const i = src.indexOf("const " + name + " = {");
  if (i < 0) return "";
  const j = src.indexOf("\n};", i);
  return src.slice(i, j < 0 ? undefined : j);
}
const dictKeyLines = objBlock(dictSrc, "DICT").match(/^\s{2}([a-z_]+):\s*\[/gm) || [];
const seen = {}, dups = [];
dictKeyLines.forEach((l) => {
  const k = l.trim().split(":")[0];
  if (seen[k]) dups.push(k); else seen[k] = 1;
});
ok("DICT 里没有重复的原因码", dups.length === 0, dups.join(", "));
eq("源码条数 = 解析后条数（没有 key 被静默吃掉）",
   dictKeyLines.length, Object.keys(D.DICT).length);

eq("命中精确码", D.diagnose({ code: "expired_card" }).why, "卡已过期");
eq("余额不足必须走字典，不能掉进未收录",
   D.diagnose({ code: "insufficient_funds" }).why, "余额不足");
eq("card_declined 是空码，允许报文规则覆盖",
   D.diagnose({ code: "card_declined", message: "Your card does not support this type of purchase." }).why,
   "卡不支持这种购买类型");
eq("命中 3DS 报文规则（码宽泛时才允许覆盖）",
   D.diagnose({ code: "generic_decline", message: "requires 3D Secure authentication" }).why,
   "缺 3DS 验证");
eq("精确码不该被报文规则改写",
   D.diagnose({ code: "expired_card", message: "international transaction" }).why,
   "卡已过期");
eq("未收录的码要老实说不知道",
   D.diagnose({ code: "zzz_never_seen" }).why, "未收录的原因码");
/* REPO_URL 还是占位符时，任何文案都不许把用户引向那个 404 的 issue 页 */
ok("占位符期间，未收录码的建议不指向死链 issue",
   D.REPO_URL.indexOf("CHANGE-ME") >= 0
     ? (D.REPO_OK === false && D.diagnose({ code: "zzz_never_seen" }).fix.indexOf("issue") < 0)
     : D.REPO_OK === true);
ok("Stripe 没给 advice_code 时不许编一个",
   D.diagnose({ code: "generic_decline" }).advice === null);
eq("给了就要认出来",
   D.diagnose({ code: "generic_decline", adviceCode: "do_not_try_again" }).advice.label,
   "别再试了");

eq("金额：美元除以 100", D.moneyStr({ amount: 2000, currency: "usd" }), "20.00 USD");
eq("金额：日元不除（零小数币种）", D.moneyStr({ amount: 100000, currency: "jpy" }), "100000 JPY");
eq("金额：没有就留空", D.moneyStr({}), "");

eq("转义 <", D.esc("<script>"), "&lt;script&gt;");
eq("转义引号与 &", D.esc(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
eq("null 不该变成字符串 null", D.esc(null), "");

ok("复制报告里不含原始响应体",
   D.reportLine({ ts: 0, code: "expired_card", message: "x", raw: "SECRET" }).indexOf("SECRET") < 0);

/* ══════════════════════════════════════════════════════════════════════════
 * 2. pagehook.js（扩展版的抓取路径）
 * ════════════════════════════════════════════════════════════════════════ */
console.log("\n[2] pagehook.js 抓取");

async function runHook(src, filename, setup) {
  const page = makePage({ isTop: false });
  let origCalls = 0;
  page.fetch = function (url) {
    origCalls++;
    return Promise.resolve(fakeResponse(page.__nextJson, page.__nextStatus));
  };
  if (setup) setup(page);
  vm.runInContext(src, vm.createContext(page), { filename });
  page.__origCalls = () => origCalls;
  return page;
}

async function feed(page, url, json, status) {
  page.__nextJson = json;
  page.__nextStatus = status || 402;
  await page.fetch(url);
  await new Promise((r) => setTimeout(r, 0));   // 让内部的 .then 链跑完
  await new Promise((r) => setTimeout(r, 0));
}

const STRIPE_URL = "https://api.stripe.com/v1/payment_intents/pi_x/confirm";

(async function () {
  const p = await runHook(read("pagehook.js"), "pagehook.js");

  ok("跨世界握手用的是 DOM 属性，不是 window 变量",
     p.document.documentElement.hasAttribute("data-declinelens"));

  await feed(p, STRIPE_URL, SAMPLE_DECLINE);
  eq("抓到 1 条", p.captured.length, 1);
  const r1 = p.captured[0].payload;
  eq("原因码取的是 decline_code 而不是 code", r1.code, "transaction_not_allowed");
  eq("抓到了官方 advice_code", r1.adviceCode, "do_not_try_again");
  eq("金额从 payment_intent 里取到", r1.amount, 2000);
  eq("站点域名来自请求 URL", r1.host, "api.stripe.com");
  ok("没有 raw 字段（不存原始响应体）", !("raw" in r1),
     "多出来的字段: " + Object.keys(r1).join(","));

  await feed(p, STRIPE_URL, SAMPLE_OUTCOME);
  const r2 = p.captured[1].payload;
  eq("outcome 里的银行原始码", r2.networkCode, "59");
  eq("outcome 里的风险等级", r2.riskLevel, "highest");
  eq("日元金额原样保留", r2.amount, 100000);

  await feed(p, STRIPE_URL, SAMPLE_MERCHANT_BUG, 400);
  eq("商户集成错误也要记（并归类为不是你的问题）",
     D.diagnose(p.captured[2].payload).why, "商户的集成配置有问题");

  const before = p.captured.length;
  await feed(p, STRIPE_URL, SAMPLE_OK, 200);
  eq("成功的支付不记录", p.captured.length, before);

  await feed(p, STRIPE_URL, SAMPLE_JUNK, 404);
  eq("光有 4xx、没有任何错误字段 → 不记录（否则垃圾会顶掉真记录）",
     p.captured.length, before);

  await feed(p, "https://cdn.example.com/analytics.js", SAMPLE_DECLINE);
  eq("非支付 URL 的响应体连碰都不碰", p.captured.length, before);

  /* v3.1 的闸门收窄回归测试 */
  await feed(p, "https://shop.example.com/account/confirm-email", SAMPLE_DECLINE);
  eq("商户自己的 /confirm-xxx 接口不再被拖进来解析（v3.0 的 /confirm 太松）",
     p.captured.length, before);

  await feed(p, "https://stripe.com.evil.com/v1/balance", SAMPLE_DECLINE);
  eq("仿冒域名 stripe.com.evil.com 不命中（域名后必须有边界）",
     p.captured.length, before);

  await feed(p, "https://stripe.com", SAMPLE_DECLINE);
  eq("裸域名 https://stripe.com（无路径）仍然命中", p.captured.length, before + 1);

  await feed(p, "https://shop.example.com/api/charges", SAMPLE_DECLINE);
  eq("商户自己的 /api/charges 不再被路径规则拖进来（必须 /v1/ 前缀）",
     p.captured.length, before + 1);

  await feed(p, "https://shop.example.com/v1/payment_intents", SAMPLE_DECLINE);
  eq("自建代理若走 Stripe 风格 /v1/payment_intents 仍命中",
     p.captured.length, before + 2);

  /* ════════════════════════════════════════════════════════════════════════
   * 3. 生成的油猴脚本（这才是 v2.1 真正坏掉的地方）
   * ══════════════════════════════════════════════════════════════════════ */
  console.log("\n[3] DeclineLens.user.js 抓取（unsafeWindow 路径）");

  const userSrc = read("DeclineLens.user.js");

  ok("元数据块完整", /\/\/ ==UserScript==[\s\S]*\/\/ ==\/UserScript==/.test(userSrc));
  ok("版本号已注入（不是占位符）", /@version\s+\d+\.\d+\.\d+/.test(userSrc));
  ok("声明了 unsafeWindow 权限", /@grant\s+unsafeWindow/.test(userSrc));
  ok("字典确实被内联了", userSrc.indexOf("generic_decline") > 0);
  ok("钩的是 unsafeWindow 而不是沙箱的 window —— v2.1 的致命 bug",
     /const W = \(typeof unsafeWindow/.test(userSrc));

  /* 造一个"沙箱 + 页面"的双 window 结构：
   * 脚本自己的 window 是 sandbox，页面的是 pageWin。
   * 如果脚本钩错了对象，pageWin.fetch 就不会被包住，下面一条都抓不到。 */
  const pageWin = makePage({ isTop: false });
  let pageFetchCalls = 0;
  pageWin.fetch = function () {
    pageFetchCalls++;
    return Promise.resolve(fakeResponse(pageWin.__nextJson, pageWin.__nextStatus));
  };
  const origPageFetch = pageWin.fetch;

  const store = {};
  const sandbox = makePage({ isTop: false });
  sandbox.unsafeWindow = pageWin;
  sandbox.GM_getValue = (k, d) => (k in store ? store[k] : d);
  sandbox.GM_setValue = (k, v) => { store[k] = v; };
  sandbox.GM_addValueChangeListener = () => {};
  sandbox.GM_registerMenuCommand = () => {};
  sandbox.GM_setClipboard = () => {};

  vm.runInContext(userSrc, vm.createContext(sandbox), { filename: "DeclineLens.user.js" });

  ok("包住的是页面的 fetch（沙箱里那个原封不动）",
     pageWin.fetch !== origPageFetch && sandbox.fetch === undefined);

  /* v3.1.2 补：油猴版也必须在 DOM 上插旗子。真实浏览器里沙箱和页面共用同一个
     document，插件版的 content.js 只能靠这面旗子知道"已经有人钩过了"。
     缺这一句 → 两版同装时插件版会误报「CSP 拦住了注入」。 */
  ok("油猴版在 DOM 上插了握手旗子 data-declinelens",
     sandbox.document.documentElement.hasAttribute("data-declinelens"));
  ok("插件版的 content.js 认的就是这同一面旗子",
     read("content.js").indexOf("data-declinelens") > 0);

  pageWin.__nextJson = SAMPLE_DECLINE;
  pageWin.__nextStatus = 402;
  await pageWin.fetch(STRIPE_URL);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const stored = JSON.parse(store["declines"] || "[]");
  eq("油猴版抓到并落盘了 1 条", stored.length, 1);
  eq("原因码正确", stored[0] && stored[0].code, "transaction_not_allowed");
  eq("原始 fetch 仍然被调用了一次（没吞掉页面的请求）", pageFetchCalls, 1);
  ok("落盘的记录里没有原始响应体", stored[0] && !("raw" in stored[0]));

  /* ════════════════════════════════════════════════════════════════════════
   * 4. XSS —— 这条最要紧
   *
   * 记录会存下来，并在**之后打开的每一个页面**上重新渲染。也就是说在一个恶意
   * 站点上种下的 payload，会在你下次打开 checkout.stripe.com 时、在那个源的
   * 上下文里执行。v2.1 的油猴版正好两样都缺：既不转义，又对全站生效。
   * ══════════════════════════════════════════════════════════════════════ */
  console.log("\n[4] XSS 防护");

  pageWin.__nextJson = SAMPLE_XSS;
  await pageWin.fetch(STRIPE_URL);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const evil = JSON.parse(store["declines"] || "[]")[0];
  ok("恶意 payload 确实被存了下来（所以渲染端必须转义）",
     evil && String(evil.code).indexOf("<img") >= 0);
  ok("转义后不含可执行标签",
     D.esc(evil.code).indexOf("<") < 0 && D.esc(evil.message).indexOf("<script") < 0);

  /* 渲染端逐个检查：凡是把外部字符串拼进 innerHTML 的地方，必须先过 esc()。
   *
   * 只扫**正在拼 HTML 的那些行**。reportLine 生成的是纯文本报告，那里直接拼
   * d.message 是对的——转义了反而会让用户复制出来的报告里出现 &lt; 这种噪音。
   * 判据：这一行里出现了 HTML 标签的字面写法。 */
  const FIELD = /\+\s*(?:d|g)\.(?:code|message|host|type|networkCode|riskLevel|why|fix)\b/;
  const HTMLISH = /<\/?\w|<span|<div/;
  const renderSrcs = [["popup.js", read("popup.js")],
                      ["DeclineLens.user.js", userSrc]];
  for (const [name, src] of renderSrcs) {
    const bad = src.split("\n").filter((ln) => HTMLISH.test(ln) && FIELD.test(ln));
    ok(name + " 拼 HTML 的地方没有未转义字段", bad.length === 0,
       bad.map((l) => l.trim()).join(" | "));
  }
  ok("纯文本报告里是直接拼的（那里本就不该转义）",
     userSrc.indexOf('"  原始报文: " + (d.message') > 0);

  /* ════════════════════════════════════════════════════════════════════════
   * 5. 两个版本必须同源
   * ══════════════════════════════════════════════════════════════════════ */
  console.log("\n[5] 双版本一致性");

  /* 内联的字典必须跟 dict.js **逐字**相同。
   * 这比"条数对得上"严得多：条数一样但某条建议被人手改过，这里会当场发现。
   * 这是整个 v3 重构的核心承诺——两个版本给出的诊断永远是同一个。 */
  const dedent = userSrc.split("\n")
    .map((l) => (l.slice(0, 2) === "  " ? l.slice(2) : l)).join("\n");
  ok("油猴版内联的字典与 dict.js 逐字一致",
     dedent.indexOf(dictSrc.trim()) >= 0);

  /* PAY_URL 是本工具的隐私边界，两边必须是同一行 */
  const payLine = (src) =>
    (src.split("\n").find((l) => l.indexOf("const PAY_URL") >= 0) || "").trim();
  eq("扩展版和油猴版的 PAY_URL 白名单逐字相同",
     payLine(userSrc), payLine(read("pagehook.js")));

  const ver = require("fs").readFileSync(path.join(SRC, "manifest.json"), "utf8");
  const mv = JSON.parse(ver).version;
  const fv = JSON.parse(read("manifest.firefox.json")).version;
  eq("Chrome / Firefox manifest 版本号一致", fv, mv);
  ok("油猴脚本版本号与 manifest 一致",
     userSrc.indexOf("@version      " + mv) > 0 || userSrc.indexOf("@version " + mv) > 0);

  /* ── 收尾 ─────────────────────────────────────────────────────────────── */
  console.log("\n" + "─".repeat(52));
  console.log(fail === 0
    ? "✅ 全部通过：" + pass + " 项"
    : "❌ " + fail + " 项失败 / 共 " + (pass + fail) + " 项");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\n测试自身崩了：", e);
  process.exit(2);
});
