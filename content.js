/* ============================================================================
 * DeclineLens 内容脚本（隔离世界 / ISOLATED world）
 * ----------------------------------------------------------------------------
 * 三件事：
 *   1. 收 pagehook 从主世界发来的 postMessage，写进 chrome.storage.local
 *   2. Firefox 回退——那边 manifest 不支持 world:"MAIN"，128+ 优先走
 *      scripting API 的官方 MAIN 世界通道，再老的版本用 script 标签补注入
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

  /* 只认本窗口发来的、带自家标记的消息。
   * e.source !== window 能挡掉别的 frame 冒充；页面自己伪造消息最多是往
   * 本地列表里塞假记录，没有更坏的后果（渲染端一律转义）。 */
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sda !== true || !d.payload || typeof d.payload !== "object") return;
    appendRecord(d.payload);
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
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  };

  /* Firefox 128+ 的正路：用 scripting API 把 pagehook 注册进 MAIN 世界。
   *
   * script 标签注入有两个治不好的病：
   *   1. 页面 CSP 的 script-src 会把它直接拦掉——严格 CSP 的收银台一拦一个准，
   *      而且拦得无声无息，用户看到的就是"什么都抓不到"
   *   2. 它要先加载扩展文件，永远比页面内联脚本慢半拍；页面 bundle 在解析期
   *      就把 fetch 存进闭包的话，钩不上
   * 官方 MAIN 世界通道两个病都没有。注意注册只对**之后的**页面加载生效，
   * 当前这个页面来不及，仍靠上面的 inject()。
   *
   * Chrome 没有 browser 命名空间（它的 manifest 里已有 world:"MAIN"），
   * 这段在 Chrome 上自动跳过；Firefox 109–127 的 registerContentScripts
   * 不认识 world:"MAIN" 会抛，落进 catch，照旧走 script 标签。 */
  const registerMainWorld = function () {
    try {
      if (typeof browser === "undefined" || !browser.scripting
          || !browser.scripting.registerContentScripts) return;
      browser.scripting.registerContentScripts([{
        id: "declinelens-pagehook",
        js: ["pagehook.js"],
        matches: ["http://*/*", "https://*/*"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: true,
        persistAcrossSessions: false,
      }]).catch(function () { /* 每个 frame 都会走到这，同 id 重复注册必抛，忽略 */ });
    } catch (e) {}
  };

  /* 立刻注，不要等。
   *
   * v2.1 在这里 setTimeout 了 800ms，等于自废武功：整套设计的前提就是赶在
   * 页面 bundle 把 fetch 存进闭包之前钩上，晚 800ms 基本什么都抓不到了。
   *
   * Chrome：manifest 里 pagehook 以 world:"MAIN" 先跑，属性已经在了，这里直接返回。
   * Firefox：manifest 没有 MAIN 世界这条，属性不在，于是在这里补注入。 */
  inject();
  registerMainWorld();

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
