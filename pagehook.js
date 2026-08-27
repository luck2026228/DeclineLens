/* ============================================================================
 * DeclineLens 页面钩子（主世界 / MAIN world）
 * ----------------------------------------------------------------------------
 * 职责单一：在页面自己的上下文里包住 fetch 与 XMLHttpRequest，从支付相关的
 * 响应里挖出拒绝原因，postMessage 给隔离世界的 content.js 去落盘。
 *
 * 必须跑在主世界，因为要替换的是**页面的** window.fetch。内容脚本默认的隔离
 * 世界有一个自己的 window，在那里改 fetch 页面根本看不见。
 *
 * 必须跑在 document_start，因为页面的 bundle 常把 fetch 存进闭包；晚一步钩上，
 * 之后所有请求都从你眼前溜走，而且是静默溜走——你看到的现象是"什么都没抓到"，
 * 极容易误以为是选择器写错了。
 * ========================================================================== */
(function () {
  "use strict";

  if (window.__declineLensHooked) return;
  window.__declineLensHooked = true;

  /* 跨"世界"的握手标记。
   *
   * v2.1 的 bug 就在这里：content.js 在隔离世界里判 window.__declineLensHooked，
   * 而这个标记设在主世界——两个 window 是不同对象，那个判断永远为假，于是
   * Chrome 上每个页面都会被多插一次 script 标签（靠上面那道 return 兜住才没出错）。
   * DOM 是两个世界唯一共享的东西，所以握手要走 DOM 属性。 */
  try { document.documentElement.setAttribute("data-declinelens", "1"); } catch (e) {}

  /* 同源 postMessage。opaque origin（sandbox iframe）下 location.origin 是
   * 字符串 "null"，拿它当 targetOrigin 会投递失败，这种情况退回 "*"。
   * 收信方 content.js 会再校验 e.source === window，不靠 targetOrigin 兜底。 */
  const ORIGIN = (function () {
    try { return location.origin && location.origin !== "null" ? location.origin : "*"; }
    catch (e) { return "*"; }
  })();

  const report = function (payload) {
    try { window.postMessage({ __sda: true, payload: payload }, ORIGIN); } catch (e) {}
  };

  /* 只有 URL 命中这个才去解析响应体。
   *
   * 这道闸决定了本扩展的隐私边界：不命中的请求，响应体连碰都不碰。
   * 关键词要窄——v3.0 里的 "/confirm" 太松，会把全站的 confirm-email /
   * confirm-order 之类的接口都拖进来解析，已删（Stripe 自己的 confirm 走
   * api.stripe.com，被域名规则覆盖）；checkout\.stripe / js\.stripe 两条
   * 也被第一条域名规则覆盖，一并删掉。
   * 域名后面必须跟边界（/ : ? # 或结尾），否则 stripe.com.evil.com 这种
   * 仿冒域名也会命中。 */
  const PAY_URL = /(^|\/\/|\.)stripe\.com(?=[\/:?#]|$)|\/v1\/payment_intents?|\/v1\/setup_intents?|\/v1\/payment_methods?|\/v1\/charges?|\/v1\/tokens?|\/billing_portal/i;

  /* 从任意形状的响应里挖错误主体。
   * Stripe 在不同接口里把错误放在不同位置，全都要照顾到。 */
  const findError = function (o) {
    return o.error
      || o.last_payment_error
      || o.last_setup_error
      || (o.payment_intent && o.payment_intent.last_payment_error)
      || (o.setup_intent && o.setup_intent.last_setup_error)
      || null;
  };

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

    /* 判定"这是一次失败"。
     *
     * 之前的版本里 httpStatus >= 400 单独就能成立，结果任何一个 404 / 401 的
     * 轮询接口都会记下一条 code 和 message 全空的垃圾。列表是 unshift + 封顶 200，
     * 垃圾会把真正的拒付记录顶出去——这是本工具最不该发生的事。
     * 所以现在要求：必须有码、或有类型、或报文里有失败字样。光有 HTTP 状态码不算。 */
    const looksLikeFailure = /declin|refus|fail|reject|insufficient|not[ _]support|expired|incorrect|invalid|拒绝|拒付|失败|不支持/i;
    const isErrorish = !!code
      || type === "card_error"
      || (httpStatus >= 400 && !!msg)
      || (!!msg && looksLikeFailure.test(String(msg)));
    if (!isErrorish) return;

    const pi = obj.payment_intent || (err && err.payment_intent) || null;

    report({
      ts: Date.now(),
      host: (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || location.host,
      httpStatus: httpStatus,
      code: code,
      type: type,
      message: msg,
      /* Stripe 官方的"还有没有救"。整个响应里最有价值的一个字段，
       * 之前的版本抓了它却从来没显示过。 */
      adviceCode: (err && err.advice_code) || null,
      networkCode: (outcome && outcome.network_decline_code) || null,
      riskLevel: (outcome && outcome.risk_level) || null,
      amount: (obj.amount != null ? obj.amount : (pi && pi.amount != null ? pi.amount : null)),
      currency: obj.currency || (pi && pi.currency) || null,
    });

    /* 注意这里没有 raw 字段。
     *
     * v2.1 存了 JSON.stringify(obj).slice(0, 600)——支付接口响应的前 600 字符
     * 很可能带邮箱、姓名、账单地址、卡后四位，而 UI 从头到尾没有一处读它。
     * 白担的风险，删掉。README 里"不收集任何信息"这句话，得由代码来兑现。 */
  };

  /* ── fetch ────────────────────────────────────────────────────────────── */
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      const args = arguments;
      const p = origFetch.apply(this, args);
      try {
        const a0 = args[0];
        const url = (a0 && typeof a0 === "object" && a0.url) ? a0.url : String(a0);
        if (PAY_URL.test(url)) {
          p.then(function (resp) {
            try {
              /* clone() 才能读，否则会把 body 从页面手里抢走。 */
              resp.clone().json().then(function (j) { dig(j, url, resp.status); })
                  .catch(function () {});
            } catch (e) {}
            return resp;
          }).catch(function () {});
        }
      } catch (e) {}
      /* 必须原样返回 origFetch 的 Promise。
       * 早期版本写成 async function + await，等于给页面换了一个新 Promise，
       * 任何依赖 Promise 身份或同步 .then 时序的页面都可能被弄坏。 */
      return p;
    };
  }

  /* ── XMLHttpRequest ───────────────────────────────────────────────────── */
  const XHR = window.XMLHttpRequest;
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
              /* responseType 是 json/blob 等时 responseText 会抛，别让它冒到页面。 */
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
})();
