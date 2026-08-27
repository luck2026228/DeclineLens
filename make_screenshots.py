# -*- coding: utf-8 -*-
"""自动生成 README 用的两张截图。

    python make_screenshots.py

干什么：用无头 Chrome 把**真正的界面代码**渲染出来截图，不是手画的示意图。
所以 UI 改了之后重跑一遍，截图自动跟上，不会出现"文档里是旧界面"的情况。

产出：
    docs/screenshot-popup.png       插件版弹窗（460px 宽）
    docs/screenshot-userscript.png  油猴版：浮球 + 展开的面板，浮在一个示例结账页上

喂进去的是假数据（下面 SAMPLE 那一段），域名是 demo-shop.example.com，
金额时间都是编的 —— 不会泄露任何真实支付信息。

依赖：Chrome（自动找）+ Pillow（裁掉底部空白用）。两样都没有的话会说清楚缺哪个。
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

# ── 别删：Windows 中文控制台的编码坑 ────────────────────────────────────────
# 中文 Windows 的控制台默认是 GBK，打不出 ✓ ✗ ⚠ 这类符号。直接在终端里
# 跑没事（Python 走的是宽字符接口），但只要把输出重定向进文件、或者接一根管道
# （python build.py > log.txt / | more / CI 里收集日志），编码就退回 GBK，
# 遇到这些符号会直接 UnicodeEncodeError 把整个脚本崩掉 —— 而且崩在打印那一句，
# 看着像"构建失败"，其实活儿早干完了。
# 下面两句只把打不出的字符降级成 ?，不动编码、不动中文、不动任何逻辑。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:                       # 老 Python 或非标准流，忽略
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "docs")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

# ── 示例记录 ────────────────────────────────────────────────────────────────
# 挑这四条是有讲究的：正好覆盖 advice_code 的三种颜色（红=别再试、黄=可以再试、
# 绿=信息填错了），加一条没有 advice_code 的，展示"Stripe 没表态时不编"。
BASE_TS = 1787900000000          # 固定时间戳 —— 每次重跑截图完全一致

SAMPLE = [
    {
        "ts": BASE_TS,
        "host": "api.stripe.com",
        "httpStatus": 402,
        "code": "transaction_not_allowed",
        "type": "card_error",
        "message": "Your card does not support this type of purchase.",
        "adviceCode": "do_not_try_again",
        "networkCode": "57",
        "riskLevel": "normal",
        "amount": 4900,
        "currency": "usd",
    },
    {
        "ts": BASE_TS - 96 * 1000,
        "host": "api.stripe.com",
        "httpStatus": 402,
        "code": "incorrect_cvc",
        "type": "card_error",
        "message": "Your card's security code is incorrect.",
        "adviceCode": "confirm_card_data",
        "networkCode": None,
        "riskLevel": "normal",
        "amount": 1299,
        "currency": "usd",
    },
    {
        "ts": BASE_TS - 11 * 60 * 1000,
        "host": "api.stripe.com",
        "httpStatus": 402,
        "code": "try_again_later",
        "type": "card_error",
        "message": "The payment could not be processed. Please try again later.",
        "adviceCode": "try_again_later",
        "networkCode": "91",
        "riskLevel": "normal",
        "amount": 2000,
        "currency": "usd",
    },
    {
        "ts": BASE_TS - 43 * 60 * 1000,
        "host": "api.stripe.com",
        "httpStatus": 402,
        "code": "insufficient_funds",
        "type": "card_error",
        "message": "Your card has insufficient funds.",
        "adviceCode": None,
        "networkCode": "51",
        "riskLevel": "normal",
        "amount": 3980,
        "currency": "usd",
    },
]


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "chromium", "chrome", "msedge"):
        p = shutil.which(name)
        if p:
            return p
    return None


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def shoot(chrome, html_path, out_png, width, height):
    """无头渲染一张图。virtual-time-budget 让页面里的 setTimeout 跑完再截。"""
    url = "file:///" + os.path.abspath(html_path).replace("\\", "/")
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",       # 2 倍图，README 里看着清楚
        "--virtual-time-budget=4000",
        "--default-background-color=00000000",
        "--window-size=%d,%d" % (width, height),
        "--screenshot=" + os.path.abspath(out_png),
        url,
    ]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    p.communicate()
    return os.path.exists(out_png)


def crop_bottom(png, bg_rgb, pad=0):
    """裁掉底部纯背景色的空白。窗口高度是拍脑袋给的，多出来的部分在这里剪掉。"""
    try:
        from PIL import Image
    except ImportError:
        sys.stderr.write("  ! 没装 Pillow，跳过裁剪（图能用，只是底下有空白）\n")
        return
    im = Image.open(png).convert("RGB")
    w, h = im.size
    px = im.load()
    last = h - 1
    while last > 0:
        row_is_bg = True
        for x in range(0, w, max(1, w // 60)):     # 抽样查，够用且快
            if px[x, last] != bg_rgb:
                row_is_bg = False
                break
        if not row_is_bg:
            break
        last -= 1
    new_h = min(h, last + 1 + pad)
    if new_h < h:
        im.crop((0, 0, w, new_h)).save(png)


# ── 插件版弹窗 ──────────────────────────────────────────────────────────────

def build_popup_harness(tmp):
    """把 popup.html 原样搬过来，只在 dict.js 前面塞一个假的 chrome.storage。"""
    for f in ("dict.js", "popup.js"):
        shutil.copy2(os.path.join(HERE, f), os.path.join(tmp, f))

    html = read(os.path.join(HERE, "popup.html"))

    shim = (
        "<script>\n"
        "/* 截图专用：假的 chrome.storage，只喂假数据，不动任何真实代码 */\n"
        "window.chrome = {\n"
        "  storage: {\n"
        "    local: {\n"
        "      _d: { declines: " + json.dumps(SAMPLE, ensure_ascii=False) + ", hookFail: {} },\n"
        "      get: function (k, cb) { cb(this._d); },\n"
        "      set: function (o, cb) { if (cb) cb(); }\n"
        "    },\n"
        "    onChanged: { addListener: function () {} }\n"
        "  }\n"
        "};\n"
        "</script>\n"
    )
    marker = '<script src="dict.js"></script>'
    assert html.count(marker) == 1
    html = html.replace(marker, shim + marker, 1)

    # 弹窗真实宽度是 460px，让 body 撑满、去掉滚动条限制，好一次截全
    html = html.replace("#list { max-height: 460px; overflow-y: auto; }",
                        "#list { overflow: visible; }", 1)

    out = os.path.join(tmp, "shot_popup.html")
    write(out, html)
    return out


# ── 油猴版浮球 + 面板 ───────────────────────────────────────────────────────

DEMO_PAGE = u"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Demo Shop</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:"Microsoft YaHei","PingFang SC",-apple-system,sans-serif;
       background:#f4f5f7;color:#1a1d21;min-height:100vh}
  .bar{background:#fff;border-bottom:1px solid #e3e6ea;padding:14px 28px;
       font-weight:700;font-size:15px;letter-spacing:.5px;color:#4a5158}
  .bar span{color:#a6adb5;font-weight:400;font-size:12px;margin-left:10px}
  .wrap{max-width:520px;margin:44px auto;background:#fff;border:1px solid #e3e6ea;
        border-radius:12px;padding:30px 34px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  h1{font-size:19px;margin:0 0 4px}
  .sub{color:#8b939b;font-size:13px;margin-bottom:26px}
  label{display:block;font-size:12px;color:#6b7280;margin:16px 0 6px;font-weight:600}
  .fld{border:1px solid #d7dbe0;border-radius:7px;padding:11px 13px;font-size:14px;
       color:#33383d;background:#fbfcfd}
  .two{display:flex;gap:12px}.two>div{flex:1}
  .total{display:flex;justify-content:space-between;margin:26px 0 18px;
         padding-top:18px;border-top:1px solid #eceef1;font-size:15px}
  .total b{font-size:19px}
  .pay{width:100%;background:#5b8dd9;color:#fff;border:0;border-radius:7px;
       padding:13px;font-size:15px;font-weight:700}
  .err{margin-top:16px;background:#fdf0f0;border:1px solid #f5c9c9;color:#b23c3c;
       border-radius:7px;padding:12px 14px;font-size:13.5px;line-height:1.6}
  .err b{display:block;margin-bottom:2px}
  .err i{font-style:normal;color:#c98080;font-size:12px}
</style></head><body>
<div class="bar">DEMO SHOP <span>示例站点 · 用于截图</span></div>
<div class="wrap">
  <h1>结账</h1>
  <div class="sub">Pro 订阅 · 按年</div>
  <label>邮箱</label>
  <div class="fld">buyer@example.com</div>
  <label>卡号</label>
  <div class="fld">4000 0000 0000 0002</div>
  <div class="two">
    <div><label>有效期</label><div class="fld">09 / 28</div></div>
    <div><label>CVC</label><div class="fld">•••</div></div>
  </div>
  <div class="total"><span>合计</span><b>$49.00</b></div>
  <button class="pay">支付 $49.00</button>
  <div class="err">
    <b>Your card was declined.</b>
    <i>&mdash;&mdash; 页面就说了这一句，没有编号，没有解释，没有下一步。</i>
  </div>
</div>
</body></html>
"""


def build_userscript_harness(tmp):
    """油猴版只塞 3 条。面板是 max-height:70vh，4 条装不下底边会被切断，
       截出来像渲染坏了。3 条正好把红 / 绿 / 黄三种建议色全露出来。"""
    shutil.copy2(os.path.join(HERE, "DeclineLens.user.js"),
                 os.path.join(tmp, "DeclineLens.user.js"))

    shim = (
        "<script>\n"
        "/* 截图专用的油猴环境替身。脚本本身一个字没改。 */\n"
        "var __store = { declines: " + json.dumps(json.dumps(SAMPLE[:3], ensure_ascii=False),
                                                  ensure_ascii=False) + " };\n"
        "window.unsafeWindow = window;\n"
        "window.GM_getValue = function (k, d) { return (k in __store) ? __store[k] : d; };\n"
        "window.GM_setValue = function (k, v) { __store[k] = v; };\n"
        "window.GM_addValueChangeListener = function () {};\n"
        "window.GM_registerMenuCommand = function () {};\n"
        "window.GM_setClipboard = function () {};\n"
        "/* 面板藏在 closed 影子里，外面点不到。截图时临时改成 open，"
        "只影响这个替身页面。 */\n"
        "var __origAttach = Element.prototype.attachShadow;\n"
        "Element.prototype.attachShadow = function (o) {\n"
        "  return __origAttach.call(this, { mode: 'open' });\n"
        "};\n"
        "</script>\n"
        "<script src=\"DeclineLens.user.js\"></script>\n"
        "<script>\n"
        "setTimeout(function () {\n"
        "  var h = document.getElementById('declinelens-root');\n"
        "  if (h && h.shadowRoot) {\n"
        "    var b = h.shadowRoot.querySelector('.ball');\n"
        "    if (b) b.click();\n"
        "  }\n"
        "}, 400);\n"
        "</script>\n"
    )

    html = DEMO_PAGE.replace("</body></html>", shim + "</body></html>", 1)
    out = os.path.join(tmp, "shot_userscript.html")
    write(out, html)
    return out


def main():
    chrome = find_chrome()
    if not chrome:
        sys.stderr.write("[X] 没找到 Chrome 或 Edge。装一个再跑，或者手动截图。\n")
        return 1
    print("用的浏览器：%s" % chrome)

    if not os.path.isdir(DOCS):
        os.makedirs(DOCS)

    tmp = tempfile.mkdtemp(prefix="dlshot_")
    try:
        # 1) 插件版弹窗
        p1 = build_popup_harness(tmp)
        o1 = os.path.join(DOCS, "screenshot-popup.png")
        if shoot(chrome, p1, o1, 460, 1400):
            crop_bottom(o1, (15, 17, 19), pad=0)       # body 背景 #0f1113
            print("[OK] docs/screenshot-popup.png       %d KB"
                  % (os.path.getsize(o1) // 1024))
        else:
            sys.stderr.write("[X] 弹窗截图失败\n")
            return 1

        # 2) 油猴版浮球 + 面板
        p2 = build_userscript_harness(tmp)
        o2 = os.path.join(DOCS, "screenshot-userscript.png")
        if shoot(chrome, p2, o2, 1020, 1060):
            print("[OK] docs/screenshot-userscript.png  %d KB"
                  % (os.path.getsize(o2) // 1024))
        else:
            sys.stderr.write("[X] 油猴版截图失败\n")
            return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n两张图都在 docs/ 里了。README 第二节会自动引用它们。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
