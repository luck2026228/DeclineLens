/* ============================================================================
 * DeclineLens 弹窗 UI（扩展版）
 * ----------------------------------------------------------------------------
 * 字典、诊断逻辑、转义、金额格式化全部来自 dict.js，本文件只管画。
 * popup.html 里 dict.js 必须排在本文件之前。
 * ========================================================================== */
(function () {
  "use strict";

  const KEY = "declines";
  /* content.js 里有一个同样的字面量，两边要一起改 */
  const FAIL_KEY = "hookFail";

  const $ = function (id) { return document.getElementById(id); };

  /* 页脚的 issue 链接指向 dict.js 里的 REPO_URL —— 改一处，两个宿主同时生效。
   * 仓库还没建（REPO_URL 还是占位符）时把入口藏起来：
   * 指向 404 的"发个 issue"比没有这个链接更伤信任。 */
  const repoLink = $("repo");
  if (repoLink) {
    if (REPO_OK) repoLink.href = REPO_URL + "/issues/new";
    else repoLink.style.display = "none";
  }

  /* 渲染一条记录。
   * 每一处插值都过 esc()——code / message / host 全都来自被访问站点的响应，
   * 而 popup 跑在扩展自己的上下文里，这里漏一个就是把扩展权限拱手让人。 */
  const renderItem = function (d) {
    const g = diagnose(d);
    const amt = moneyStr(d);
    const site = d.host || "";

    let adviceRow = "";
    if (g.advice) {
      adviceRow =
        '<div class="official" style="border-left-color:' + esc(g.advice.color) + '">' +
          '<span class="oflag" style="color:' + esc(g.advice.color) + '">Stripe 官方判断：' +
            esc(g.advice.label) +
          '</span><br>' + esc(g.advice.text) +
        '</div>';
    }

    let extra = "";
    if (d.networkCode && d.networkCode !== d.code) {
      extra += '<span class="tag">银行原始码 ' + esc(d.networkCode) + '</span>';
    }
    if (d.riskLevel) {
      extra += '<span class="tag">风险 ' + esc(d.riskLevel) + '</span>';
    }
    if (d.type && d.type !== "card_error") {
      extra += '<span class="tag">' + esc(d.type) + '</span>';
    }

    return '<div class="item">' +
      '<div class="row1">' +
        '<span class="code">' + esc(g.code) + '</span>' +
        (amt ? '<span class="amt">' + esc(amt) + '</span>' : "") +
        (site ? '<span class="site">' + esc(site) + '</span>' : "") +
      '</div>' +
      adviceRow +
      '<div class="advice">' +
        '<div>📖 ' + esc(g.why) + '</div>' +
        '<div>🛠️ ' + esc(g.fix) + '</div>' +
      '</div>' +
      (extra ? '<div class="tags">' + extra + '</div>' : "") +
      (d.message ? '<div class="msg">原始报文：' + esc(d.message) + '</div>' : "") +
      '<div class="time">' + esc(fmtTime(d.ts)) + '</div>' +
    '</div>';
  };

  const EMPTY_HTML =
    '<div class="empty">' +
      '🕊️ 还没有捕获到记录<br><br>' +
      '去提交一次支付，<b>被拒时</b>这里会出现诊断<br>' +
      '<span class="dim">成功的支付不会被记录</span>' +
    '</div>';
  /* 上一版这里写的是"成功或失败，这里都会有诊断"，但 pagehook 明确只在
   * 判定为失败时才上报。用户照着做一次成功支付、发现什么都没有，
   * 只会以为插件坏了。文案必须跟代码说同一件事。 */

  const render = function () {
    chrome.storage.local.get([KEY, FAIL_KEY], function (r) {
      const list = (r && r[KEY]) || [];

      $("statTotal").textContent = String(list.length);

      const codes = {};
      list.forEach(function (d) {
        const c = (diagnose(d).code) || "未知";
        codes[c] = (codes[c] || 0) + 1;
      });
      const top = Object.keys(codes)
        .map(function (k) { return [k, codes[k]]; })
        .sort(function (a, b) { return b[1] - a[1]; })[0];
      $("statTop").textContent = top ? (top[0] + " ×" + top[1]) : "—";

      $("list").innerHTML = list.length ? list.map(renderItem).join("") : EMPTY_HTML;

      /* 注入失败提醒：这些站点的 CSP 把钩子拦了，在上面支付抓不到记录。
       * 只显示最近 7 天的——更久之前的大概率是旧版本留下的尸体。 */
      const fails = (r && r[FAIL_KEY]) || {};
      const now = Date.now();
      const hosts = Object.keys(fails).filter(function (h) {
        return now - fails[h] < 7 * 24 * 3600 * 1000;
      });
      const w = $("hookwarn");
      if (w) {
        if (hosts.length) {
          w.style.display = "block";
          /* textContent 不用过 esc()：它不做 HTML 解析，host 再坏也炸不出来 */
          w.textContent = "⚠️ 以下站点的安全策略（CSP）拦住了注入，在这些站上抓不到记录："
            + hosts.slice(0, 5).join("、")
            + (hosts.length > 5 ? " 等 " + hosts.length + " 个" : "");
        } else {
          w.style.display = "none";
        }
      }
    });
  };

  $("clear").onclick = function () {
    chrome.storage.local.set({ [KEY]: [], [FAIL_KEY]: {} }, render);
  };

  $("copy").onclick = function () {
    chrome.storage.local.get(KEY, function (r) {
      const list = (r && r[KEY]) || [];
      const txt = list.length
        ? list.map(reportLine).join("\n\n")
        : "（无记录）";
      navigator.clipboard.writeText(txt).then(function () {
        const b = $("copy");
        b.textContent = "✅ 已复制";
        setTimeout(function () { b.textContent = "📋 复制报告"; }, 1200);
      }).catch(function () {
        const b = $("copy");
        b.textContent = "❌ 复制失败";
        setTimeout(function () { b.textContent = "📋 复制报告"; }, 1200);
      });
    });
  };

  /* 只在本地存储的 declines / hookFail 变了才重画，
   * 别让任何一次无关的存储变动都触发重排。 */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes && (changes[KEY] || changes[FAIL_KEY])) render();
  });

  render();
})();
