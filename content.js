/* ============================================================================
 * DeclineLens 内容脚本（隔离世界 / ISOLATED world）
 * ----------------------------------------------------------------------------
 * 三件事：
 *   1. 收 pagehook 从主世界发来的 postMessage，写进 chrome.storage.local
 *   2. Firefox 回退——128+ 由 manifest 的 world:"MAIN" 直接搞定，
 *      128 以下不认这个 key，在这里用 script 标签补注入
 *   3. 注入失败检测——钩子没装上时在 storage 里留标记，popup 会提醒用户
 *
 * 主世界拿不到 chrome.storage，隔离世界钩不到页面的 fetch，所以必须两边配合，
 * postMessage 是它们之间唯一的通道。
 * ========================================================================== */
(function () {
  "use strict";

  const KEY = "declines";
  const CAP = 200;
  /* popup.js 里有一个同样的字面量，两边要一起改 */
  const FAIL_KEY = "hookFail";

  /* ── 收信 ─────────────────────────────────────────────────────────────── */

  /* 写入串行化。
   *
   * chrome.storage 的 get→改→set 是异步的读改写，两条记录挨得近就会丢一条
   * （后写的那次 get 拿到的还是旧数组）。支付场景下一次提交可能同时触发
   * confirm 和 payment_intent 两个响应，这个竞态是真会发生的。
   * 用一条 Promise 链把写操作排成队。declines 和 hookFail 共用这条链。 */
  let writeQueue = Promise.resolve();

  const enqueueWrite = function (fn) {
    writeQueue = writeQueue.then(function () {
      return new Promise(function (resolve) {
        try { fn(resolve); }
        catch (e) { resolve(); }
      });
    }).catch(function () { /* 扩展被重载时 storage 会抛，别让链断掉 */ });
    return writeQueue;
  };

  const appendRecord = function (rec) {
    return enqueueWrite(function (resolve) {
      chrome.storage.local.get(KEY, function (r) {
        const list = (r && r[KEY]) || [];
        list.unshift(rec);
        chrome.storage.local.set({ [KEY]: list.slice(0, CAP) }, resolve);
      });
    });
  };

  /* 谁负责落盘：只有顶层窗口。
   *
   * content.js 是 all_frames:true，顶层页面和每个 iframe 各跑一份实例。
   * 上面那条 writeQueue 只在**自己这份实例内**排队，跨 frame 完全不排队；
   * 而 chrome.storage.local 是所有 frame 共用的同一份。两个 frame 同时
   * get→改→set，后写的那次拿到的是旧数组，会把另一条记录整个盖掉。
   * Stripe Elements 的确认请求恰恰是从 iframe 里发出去的，顶层同时还有
   * payment_intents 的响应——正是最容易撞车的场景。
   *
   * 所以：子 frame 不落盘，把记录转给顶层，由顶层那一份实例排队统一写。 */
  const isTop = (function () {
    try { return window.top === window; } catch (e) { return false; }
  })();

  const relayUp = function (payload) {
    try { window.top.postMessage({ __sda_up: true, payload: payload }, "*"); }
    catch (e) { appendRecord(payload); }   /* 顶层够不着就自己写，别把记录弄丢 */
  };

  window.addEventListener("message", function (e) {
    const d = e.data;
    if (!d || !d.payload || typeof d.payload !== "object") return;

    /* 自家 pagehook 发来的（同一个 window）。
     * e.source === window 能挡掉别的 frame 冒充；页面自己伪造消息最多是往
     * 本地列表里塞假记录，没有更坏的后果（渲染端一律转义）。 */
    if (d.__sda === true && e.source === window) {
      if (isTop) appendRecord(d.payload);
      else relayUp(d.payload);
      return;
    }

    /* 子 frame 转上来的。只有顶层认这个，而且必须真是别的窗口发来的，
     * 免得页面在顶层自己给自己发一条混进来。 */
    if (d.__sda_up === true && isTop && e.source !== window) {
      appendRecord(d.payload);
    }
  }, false);

  /* ── Firefox 回退注入 ─────────────────────────────────────────────────── */

  /* 握手走 DOM 属性，不走 window 变量——两个世界的 window 是不同对象，
   * 拿 window.__declineLensHooked 判断永远为假（v2.1 的老 bug）。 */
  const alreadyHooked = function () {
    try { return document.documentElement.hasAttribute("data-declinelens"); }
    catch (e) { return false; }
  };

  const inject = function () {
    if (alreadyHooked()) return;
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("pagehook.js");
      s.async = false;                       // 保持执行顺序，别被页面脚本插队
      /* 成功、失败都得把标签摘掉。只写 onload 的话，一旦加载失败（manifest
       * 漏了 web_accessible_resources、或者页面 CSP 把它拦了），页面 DOM 里
       * 就会留一个死 <script> 元素，白白给页面留痕。 */
      const drop = function () { try { s.remove(); } catch (e) {} };
      s.onload = drop;
      s.onerror = drop;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  };

  /* 这里原来有个 registerMainWorld()，用 browser.scripting.registerContentScripts
   * 走 Firefox 的官方 MAIN 世界通道。那是死代码，已删——scripting 这套 API
   * 在内容脚本里根本不存在（内容脚本只拿得到 storage / runtime / i18n 那一小撮），
   * browser.scripting 恒为 undefined，函数每次都在第一句就 return，从来没生效过。
   *
   * 现在改成正路：manifest.firefox.json 的 content_scripts 里直接给 pagehook.js
   * 写 "world": "MAIN"（Firefox 128 起原生支持，Mozilla 官方博客有确认）。
   * Firefox 128 以下不认识这个 key，会把 pagehook 塞进隔离世界——pagehook.js
   * 开头有一句世界判定，认出来就直接退出，于是照旧落到下面的 script 标签兜底。
   *
   * 立刻注，不要等。
   *
   * v2.1 在这里 setTimeout 了 800ms，等于自废武功：整套设计的前提就是赶在
   * 页面 bundle 把 fetch 存进闭包之前钩上，晚 800ms 基本什么都抓不到了。
   *
   * Chrome：manifest 里 pagehook 以 world:"MAIN" 先跑，属性已经在了，这里直接返回。
   * Firefox：manifest 没有 MAIN 世界这条，属性不在，于是在这里补注入。 */
  inject();

  /* 再兜一次。两个内容脚本谁先跑理论上按 manifest 顺序，但不同浏览器/版本
   * 不保证，microtask 后再确认一遍，代价可以忽略。 */
  Promise.resolve().then(inject);

  /* ── 注入失败检测 ───────────────────────────────────────────────────────
   *
   * 3 秒后还没有握手属性，钩子就是没装上（多半是 CSP 把 script 标签拦了，
   * Firefox 回退路径的已知盲区）。只记顶层窗口——子 frame 失败会把新闻站、
   * 广告 iframe 一串域名写进弹窗，用户付款都没付过。
   * 写入走同一条队列，避免多 frame 同时到点把 host 列表盖掉。 */
  setTimeout(function () {
    if (alreadyHooked() || !location.host) return;
    try {
      if (window.top !== window) return;
    } catch (e) { return; }
    enqueueWrite(function (resolve) {
      chrome.storage.local.get(FAIL_KEY, function (r) {
        const m = (r && r[FAIL_KEY]) || {};
        m[location.host] = Date.now();
        chrome.storage.local.set({ [FAIL_KEY]: m }, resolve);
      });
    });
  }, 3000);
})();
