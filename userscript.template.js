// ==UserScript==
// @name         DeclineLens 拒付透视镜
// @name:en      DeclineLens — Stripe decline reason decoder
// @namespace    __REPO_URL__
// @version      __VERSION__
// @description  支付被拒时，把 Stripe 藏在响应里的真实原因翻译成人话，并告诉你下一步该做什么。纯本地运行，不上传任何数据。
// @description:en Decodes the real Stripe decline reason hidden in the API response and tells you what to do next. 100% local, nothing is uploaded.
// @author       DeclineLens
// @license      MIT
// @homepageURL  __REPO_URL__
// @supportURL   __REPO_URL__/issues
// @downloadURL  __REPO_URL__/raw/main/DeclineLens.user.js
// @updateURL    __REPO_URL__/raw/main/DeclineLens.user.js
// @match        http://*/*
// @match        https://*/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

/* ============================================================================
 * 这个文件是**模板**，不要直接安装它。
 *
 * build.py 会做两件事，产出根目录下的 DeclineLens.user.js：
 *   1. 把 dict.js 整段替换进下面那个 DICT_INLINE 占位注释
 *   2. 把版本号与项目地址两个占位符，换成 manifest.json 和 dict.js 里的真值
 *
 * 注意本段文字里不能出现那三个占位符的字面写法——replace 是全局替换，
 * 写在注释里也会被一起换掉，结果就是注释被字典撑爆、脚本语法错误。
 * （第一次 build 就是这么炸的。）
 *
 * 为什么不让油猴版自己抄一份字典：v2.1 就是这么干的，结果扩展版 42 条、
 * 油猴版 19 条，两边诊断结论不一样，而注释里还写着"与扩展版同源"。
 * ========================================================================== */

(function () {
  "use strict";

  /* ══════════════════════════════════════════════════════════════════════
   * 字典与诊断引擎（由 build.py 从 dict.js 内联）
   * ════════════════════════════════════════════════════════════════════ */

  //__DICT_INLINE__

  /* ══════════════════════════════════════════════════════════════════════
   * 第一部分：页面钩子
   *
   * 【v2.1 最致命的 bug 在这里】
   * 只要出现除 none 以外的任何 @grant，油猴就把脚本放进沙箱运行，此时脚本里的
   * window 是一个代理对象，跟页面真正的 window **不是同一个**。v2.1 写的是
   *     window.fetch = wrapped;
   * 于是包住的是沙箱的 fetch，页面自己调 fetch 时走的还是原版——脚本大概率
   * 从来就没抓到过任何东西，而且是静默失败，看起来就像"这个站不用 Stripe"。
   *
   * 要钩页面，必须用 unsafeWindow。
   * ════════════════════════════════════════════════════════════════════ */

  const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;

  const KEY = "declines";
  const CAP = 200;
  const IS_TOP = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  /* ── 存储 ─────────────────────────────────────────────────────────────
   * GM_setValue 是同步的，天然没有扩展版那个读改写竞态；
   * 但它在 iframe 里也能写，所以顶层窗口要靠 GM_addValueChangeListener 感知。 */

  const loadAll = function () {
    try {
      const raw = GM_getValue(KEY, "[]");
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  };

  const saveAll = function (list) {
    try { GM_setValue(KEY, JSON.stringify(list.slice(0, CAP))); } catch (e) {}
  };

  /* 跨 iframe 合并写入。
   *
   * GM_setValue 在单 frame 里是同步的，但 Stripe 卡号框本身就是 iframe，
   * 钩子进每个 frame。两个 frame 同时 loadAll → unshift → saveAll，
   * 后写的那次会把先写的那条盖掉——扩展版 content.js 专门为这个排过队，
   * 油猴这边用「按 ts+code+host 去重后再拼」把两边的新记录都留下。 */
  const recKey = function (r) {
    return String(r && r.ts) + "\0" + String(r && r.code) + "\0" + String(r && r.host);
  };

  const appendRecord = function (rec) {
    const prev = loadAll();
    const seen = {};
    const next = [];
    [rec].concat(prev).forEach(function (r) {
      const k = recKey(r);
      if (seen[k]) return;
      seen[k] = 1;
      next.push(r);
    });
    saveAll(next);
    if (IS_TOP) render();
  };

  /* ── 抓取 ───────────────────────────────────────────────────────────── */

  if (W.__declineLensHooked) return;
  try { W.__declineLensHooked = true; } catch (e) {}
  /* 同一面 DOM 旗子：插件版的 content.js 只能看见 DOM，看不见页面 window。
     不插这一句，两个版本同装时插件版会误报「CSP 拦住了注入」。 */
  try { document.documentElement.setAttribute("data-declinelens", "1"); } catch (e) {}

  /* 只有 URL 命中这个才去解析响应体。
   * 这道闸就是本脚本的隐私边界：不命中的请求，响应体连碰都不碰。
   * 这一行必须与 pagehook.js 里的逐字相同（test.js 第 5 节会查）——
   * 收窄史与域名边界的理由见 pagehook.js 的注释。 */
  const PAY_URL = /(^|\/\/|\.)stripe\.com(?=[\/:?#]|$)|\/v1\/payment_intents?|\/v1\/setup_intents?|\/v1\/payment_methods?|\/v1\/charges?|\/v1\/tokens?|\/billing_portal/i;

  const findError = function (o) {
    return o.error
      || o.last_payment_error
      || o.last_setup_error
      || (o.payment_intent && o.payment_intent.last_payment_error)
      || (o.setup_intent && o.setup_intent.last_setup_error)
      || null;
  };

  const looksLikeFailure = /declin|refus|fail|reject|insufficient|not[ _]support|expired|incorrect|invalid|拒绝|拒付|失败|不支持/i;

  const dig = function (obj, url, httpStatus) {
    if (!obj || typeof obj !== "object") return;

    const err = findError(obj);
    const outcome = obj.outcome || (obj.charge && obj.charge.outcome)
      || (err && err.payment_intent && err.payment_intent.charges
          && err.payment_intent.charges.data && err.payment_intent.charges.data[0]
          && err.payment_intent.charges.data[0].outcome)
      || null;

    const code = (err && (err.decline_code || err.code))
      || (outcome && (outcome.network_decline_code || outcome.reason))
      || null;
    const type = (err && err.type) || null;
    const msg = (err && (err.message || err.raw_message))
      || (outcome && outcome.seller_message)
      || null;

    /* 光有 HTTP 4xx 不算失败——否则任何一个 401/404 的轮询接口都会记下一条
     * 码和报文全空的垃圾，而列表是 unshift + 封顶 200，垃圾会把真正的拒付
     * 记录顶出去。这是本工具最不该发生的事。 */
    const isErrorish = !!code
      || type === "card_error"
      || (httpStatus >= 400 && !!msg)
      || (!!msg && looksLikeFailure.test(String(msg)));
    if (!isErrorish) return;

    const pi = obj.payment_intent || (err && err.payment_intent) || null;

    appendRecord({
      ts: Date.now(),
      host: (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || location.host,
      httpStatus: httpStatus,
      code: code,
      type: type,
      message: msg,
      adviceCode: (err && err.advice_code) || null,
      networkCode: (outcome && outcome.network_decline_code) || null,
      riskLevel: (outcome && outcome.risk_level) || null,
      amount: (obj.amount != null ? obj.amount : (pi && pi.amount != null ? pi.amount : null)),
      currency: obj.currency || (pi && pi.currency) || null,
    });

    /* 这里没有 raw 字段，是故意的。
     * v2.1 存了响应体前 600 字符——那里面很可能有邮箱、姓名、账单地址、卡后四位，
     * 而 UI 从头到尾没有一处读它。白担的风险。
     * README 里"不上传任何数据"这句话，得由代码来兑现。 */
  };

  /* fetch ───────────────────────────────────────────────────────────────
   * 必须在 document-start 就包住：页面 bundle 常把 fetch 存进闭包，
   * 晚一步钩上，之后所有请求都从眼前静默溜走。 */
  try {
    const origFetch = W.fetch;
    if (typeof origFetch === "function") {
      W.fetch = function () {
        const args = arguments;
        const p = origFetch.apply(this, args);
        try {
          const a0 = args[0];
          const url = (a0 && typeof a0 === "object" && a0.url) ? a0.url : String(a0);
          if (PAY_URL.test(url)) {
            p.then(function (resp) {
              try {
                /* clone() 才能读，否则就把 body 从页面手里抢走了 */
                resp.clone().json().then(function (j) { dig(j, url, resp.status); })
                    .catch(function () {});
              } catch (e) {}
              return resp;
            }).catch(function () {});
          }
        } catch (e) {}
        /* 原样返回 origFetch 的 Promise：换成 async 包装会给页面一个新的
         * Promise 对象，依赖 Promise 身份或同步 then 时序的页面可能被弄坏。 */
        return p;
      };
    }
  } catch (e) {}

  /* XMLHttpRequest ──────────────────────────────────────────────────── */
  try {
    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;

      XHR.prototype.open = function (m, u) {
        try { this.__sda_url = String(u); } catch (e) {}
        return origOpen.apply(this, arguments);
      };

      XHR.prototype.send = function () {
        try {
          const self = this;
          if (PAY_URL.test(self.__sda_url || "")) {
            self.addEventListener("load", function () {
              try {
                /* responseType 是 json/blob 时读 responseText 会抛，别让异常冒到页面 */
                const t = self.responseType;
                if (t && t !== "" && t !== "text") {
                  if (t === "json" && self.response) dig(self.response, self.__sda_url, self.status);
                  return;
                }
                dig(JSON.parse(self.responseText), self.__sda_url, self.status);
              } catch (e) {}
            });
          }
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  } catch (e) {}

  /* ══════════════════════════════════════════════════════════════════════
   * 第二部分：界面
   *
   * 只在顶层窗口画。钩子要进每一个 frame（Stripe 的卡片输入框本身就是 iframe，
   * 而 checkout 常被嵌在 iframe 里），但界面只该出现一次，否则一个页面上会
   * 冒出好几个悬浮球。
   *
   * 用 Shadow DOM 装 UI：宿主页面的 CSS 五花八门，不隔离的话面板会被页面样式
   * 揉碎；反过来我们的样式也不该污染人家的页面。
   * ════════════════════════════════════════════════════════════════════ */

  if (!IS_TOP) return;

  let host = null, root = null, open = false;

  const CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:'Microsoft YaHei','PingFang SC',-apple-system,sans-serif}",
    ".ball{position:fixed;right:20px;bottom:20px;width:46px;height:46px;border-radius:50%;",
      "background:#16191c;border:1px solid #2a2e33;color:#9acd32;font-size:20px;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;z-index:2147483646;",
      "box-shadow:0 4px 16px rgba(0,0,0,.45)}",
    ".ball:hover{background:#1d2126}",
    ".badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;",
      "background:#ff6b6b;color:#fff;font-size:11px;line-height:18px;text-align:center;padding:0 5px}",
    ".panel{position:fixed;right:20px;bottom:78px;width:400px;max-height:70vh;overflow-y:auto;",
      "background:#0f1113;color:#e8e8e8;border:1px solid #2a2e33;border-radius:10px;",
      "z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.6);font-size:13px}",
    ".panel::-webkit-scrollbar{width:6px}",
    ".panel::-webkit-scrollbar-thumb{background:#2a2e33;border-radius:3px}",
    ".hd{position:sticky;top:0;background:#16191c;padding:10px 14px;border-bottom:1px solid #232628;",
      "display:flex;justify-content:space-between;align-items:center}",
    ".hd b{color:#9acd32}",
    ".hd button{background:#2a2e33;color:#ccc;border:0;border-radius:4px;padding:4px 9px;",
      "font-size:11px;cursor:pointer;margin-left:5px}",
    ".hd button:hover{background:#3a3e43}",
    ".item{padding:11px 14px;border-bottom:1px solid #1e2124}",
    ".row1{display:flex;gap:9px;flex-wrap:wrap;align-items:baseline}",
    ".code{color:#ff6b6b;font-weight:700;font-family:Consolas,monospace;word-break:break-all}",
    ".site{color:#5b8dd9;font-size:11px;font-family:Consolas,monospace}",
    ".amt{color:#ffd166;font-size:11px;font-family:Consolas,monospace}",
    ".official{margin-top:6px;padding:6px 9px;background:#16191c;border-left:3px solid #ffd166;",
      "border-radius:0 4px 4px 0;font-size:12px;color:#bbb;line-height:1.6}",
    ".oflag{font-weight:700}",
    ".advice{margin-top:6px;padding:6px 9px;background:#131a10;border-radius:4px;",
      "color:#9acd32;line-height:1.7}",
    ".tags{margin-top:5px}",
    ".tag{display:inline-block;font-size:10px;color:#7a8288;background:#1a1e22;",
      "border:1px solid #2a2e33;border-radius:3px;padding:1px 6px;margin-right:5px;",
      "font-family:Consolas,monospace}",
    ".msg{color:#999;font-size:12px;margin-top:6px;word-break:break-all}",
    ".time{color:#555;font-size:11px;margin-top:5px}",
    ".empty{padding:34px 18px;text-align:center;color:#555;line-height:2}",
    ".ft{padding:8px 14px;border-top:1px solid #232628;background:#14171a;font-size:11px;color:#666;",
      "display:flex;justify-content:space-between;align-items:center}",
    ".ft a{color:#7f8a95;text-decoration:none}",
    ".ft a:hover{color:#9acd32;text-decoration:underline}",
  ].join("");

  const renderItem = function (d) {
    const g = diagnose(d);
    const amt = moneyStr(d);

    let officialRow = "";
    if (g.advice) {
      officialRow =
        '<div class="official" style="border-left-color:' + esc(g.advice.color) + '">' +
          '<span class="oflag" style="color:' + esc(g.advice.color) + '">Stripe 官方判断：' +
            esc(g.advice.label) + '</span><br>' + esc(g.advice.text) +
        '</div>';
    }

    let tags = "";
    if (d.networkCode && d.networkCode !== d.code) tags += '<span class="tag">银行原始码 ' + esc(d.networkCode) + '</span>';
    if (d.riskLevel) tags += '<span class="tag">风险 ' + esc(d.riskLevel) + '</span>';
    if (d.type && d.type !== "card_error") tags += '<span class="tag">' + esc(d.type) + '</span>';

    /* 每一处插值都过 esc()。
     * code 和 message 是被访问站点响应里的字符串，而记录会存下来、在**之后打开的
     * 每一个页面**上重新渲染——在 A 站种下的 <img onerror> 会在 checkout.stripe.com
     * 上引爆。v2.1 的油猴版正好两样都缺：既不转义，又对全站生效。 */
    return '<div class="item">' +
      '<div class="row1">' +
        '<span class="code">' + esc(g.code) + '</span>' +
        (amt ? '<span class="amt">' + esc(amt) + '</span>' : "") +
        (d.host ? '<span class="site">' + esc(d.host) + '</span>' : "") +
      '</div>' +
      officialRow +
      '<div class="advice"><div>📖 ' + esc(g.why) + '</div><div>🛠️ ' + esc(g.fix) + '</div></div>' +
      (tags ? '<div class="tags">' + tags + '</div>' : "") +
      (d.message ? '<div class="msg">原始报文：' + esc(d.message) + '</div>' : "") +
      '<div class="time">' + esc(fmtTime(d.ts)) + '</div>' +
    '</div>';
  };

  const ensureUI = function () {
    if (host && host.isConnected) return true;
    if (!document.body) return false;

    host = document.createElement("div");
    host.id = "declinelens-root";
    try { root = host.attachShadow({ mode: "closed" }); }
    catch (e) { root = host; }          // 极老的浏览器：退化成普通节点
    document.body.appendChild(host);

    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    const ball = document.createElement("div");
    ball.className = "ball";
    ball.title = "DeclineLens 拒付透视镜";
    ball.innerHTML = '🔍<span class="badge" style="display:none">0</span>';
    ball.addEventListener("click", function () { open = !open; render(); });
    root.appendChild(ball);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.display = "none";
    root.appendChild(panel);

    return true;
  };

  function render() {
    if (!ensureUI()) return;

    const list = loadAll();
    const ball = root.querySelector(".ball");
    const badge = root.querySelector(".badge");
    const panel = root.querySelector(".panel");

    /* 一条记录都没有时不显示悬浮球。
     * 这是个大部分时间该完全隐形的工具——支付页上凭空多个球，本身就是干扰。 */
    ball.style.display = list.length ? "flex" : "none";
    badge.style.display = list.length ? "block" : "none";
    badge.textContent = String(list.length);

    if (!open) { panel.style.display = "none"; return; }

    panel.style.display = "block";
    panel.innerHTML =
      '<div class="hd"><b>🔍 拒付透视镜 · ' + list.length + ' 条</b>' +
        '<span><button data-act="copy">📋 复制报告</button>' +
        '<button data-act="clear">清空</button></span></div>' +
      (list.length ? list.map(renderItem).join("")
                   : '<div class="empty">还没有捕获到记录<br>被拒时这里会出现诊断</div>') +
      '<div class="ft"><span>🔒 纯本地，无上传</span>' +
        /* 仓库还没建（REPO_URL 是占位符）时不放 issue 链接——指向 404 的
         * "发个 issue" 比没有链接更伤信任。建仓后这里自动恢复。 */
        (REPO_OK
          ? '<a href="' + esc(REPO_URL) + '/issues/new" target="_blank" rel="noopener noreferrer">' +
            '未收录的码？发个 issue →</a>'
          : '<span>未收录的码会持续补进字典</span>') +
        '</div>';

    panel.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-act") === "clear") { saveAll([]); render(); return; }
        copyReport(b);
      });
    });
  }

  const copyReport = function (btn) {
    const list = loadAll();
    const txt = list.length ? list.map(reportLine).join("\n\n") : "（无记录）";
    try { GM_setClipboard(txt, "text"); }
    catch (e) { try { navigator.clipboard.writeText(txt); } catch (e2) {} }
    if (btn) {
      btn.textContent = "✅ 已复制";
      setTimeout(function () { btn.textContent = "📋 复制报告"; }, 1200);
    }
  };

  /* 子 frame 里抓到的记录要能立刻反映到顶层的球上。
   * Greasemonkey 没有这个 API，所以先探再用。 */
  try {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(KEY, function () { render(); });
    }
  } catch (e) {}

  try {
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("📋 复制拒付报告", function () { copyReport(null); });
      GM_registerMenuCommand("🗑️ 清空记录", function () { saveAll([]); render(); });
    }
  } catch (e) {}

  /* document-start 时还没有 body，等 DOM 就绪再画。
   * 钩子已经在上面装好了，这里晚一点没有任何损失。 */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
