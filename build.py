# -*- coding: utf-8 -*-
"""DeclineLens 打包器

一条命令产出三样东西：
    dist/DeclineLens-v<ver>-chrome.zip     Chrome / Edge 扩展
    dist/DeclineLens-v<ver>-firefox.zip    Firefox 扩展
    DeclineLens.user.js                    油猴脚本（把 dict.js 内联进模板）

版本号只在 manifest.json 里写一次，其余全部由这里推导；
项目地址只在 dict.js 的 REPO_URL 里写一次，油猴脚本的 @downloadURL 等也从那里取。
两个"唯一来源"是这个脚本存在的全部理由——v2.1 的教训是：
凡是需要人记得"两边都要改"的地方，早晚会漂。
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile

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

SRC = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(SRC, "dist")
os.makedirs(DIST, exist_ok=True)


def read(name):
    with io.open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def write(name, text):
    write_abs(os.path.join(SRC, name), text)


def write_abs(path, text):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# ── 唯一来源 ────────────────────────────────────────────────────────────────
MANIFEST = json.loads(read("manifest.json"))
VERSION = MANIFEST["version"]

DICT_SRC = read("dict.js")

m = re.search(r'REPO_URL\s*=\s*"([^"]+)"', DICT_SRC)
if not m:
    sys.exit("✗ dict.js 里找不到 REPO_URL，无法生成油猴脚本的 @downloadURL")
REPO_URL = m.group(1).rstrip("/")

if "CHANGE-ME" in REPO_URL:
    print("⚠  dict.js 的 REPO_URL 还是占位符，建仓后记得替换：%s" % REPO_URL)

# Firefox 的 manifest 版本号必须跟主 manifest 一致，否则两个 zip 会对不上号
FF = json.loads(read("manifest.firefox.json"))
if FF["version"] != VERSION:
    FF["version"] = VERSION
    write("manifest.firefox.json", json.dumps(FF, ensure_ascii=False, indent=2) + "\n")
    print("↻ manifest.firefox.json 版本号已同步为 %s" % VERSION)

# package.json 的版本号也一起同步。
# 它不参与构建，但 npm 页面、GitHub 侧边栏、以及 `npm test` 的使用者都会看到它，
# 对不上号的话在外人眼里就是"这项目版本管理很随意"。
# 版本号的唯一来源始终是 manifest.json，这里只是跟着走。
PKG = json.loads(read("package.json"))
if PKG.get("version") != VERSION:
    PKG["version"] = VERSION
    write("package.json", json.dumps(PKG, ensure_ascii=False, indent=2) + "\n")
    print("↻ package.json 版本号已同步为 %s" % VERSION)


# ── 油猴脚本 ───────────────────────────────────────────────────────────────
# 拼出来而不是写死，免得这三个字符串本身在替换时把自己也换掉
PLACEHOLDER = "//__" + "DICT_INLINE" + "__"
PH_VERSION = "__" + "VERSION" + "__"
PH_REPO = "__" + "REPO_URL" + "__"


def build_userscript():
    tpl = read("userscript.template.js")

    # 占位符必须**恰好出现一次**。
    # 第一次 build 就栽在这儿：模板的头部注释里写了一句"把 dict.js 替换进
    # <占位符>"，而 str.replace 是全局替换，于是整份字典也被塞进了那句注释，
    # 把 /* */ 撑爆，产物直接语法错误。计数比信任更靠得住。
    n_ph = tpl.count(PLACEHOLDER)
    if n_ph != 1:
        sys.exit("✗ 模板里的 %s 占位符出现了 %d 次，必须恰好 1 次" % (PLACEHOLDER, n_ph))

    # 内联时缩进两格，纯粹为了生成物读起来像手写的；不缩进也能跑
    body = "\n".join(("  " + ln if ln.strip() else ln)
                     for ln in DICT_SRC.rstrip().split("\n"))

    out = tpl.replace(PLACEHOLDER, body)
    out = out.replace(PH_VERSION, VERSION).replace(PH_REPO, REPO_URL)

    # 自检：占位符必须全部消失，否则装上去是坏的
    for ph in (PH_VERSION, PH_REPO, PLACEHOLDER):
        if ph in out:
            sys.exit("✗ 占位符 %s 未被替换" % ph)
    # 自检：油猴的元数据块必须完好，缺了油猴会拒绝安装
    if "// ==UserScript==" not in out or "// ==/UserScript==" not in out:
        sys.exit("✗ UserScript 元数据块损坏")
    # 自检：字典真的进去了
    if "generic_decline" not in out:
        sys.exit("✗ 字典没有被内联进去")

    write("DeclineLens.user.js", out)

    # 有 node 就顺手做一次语法检查。
    # 生成物的语法错误在浏览器里是静默的（油猴装得上、但什么都不做），
    # 这一步能把它挡在发布之前。没装 node 就跳过，不影响打包。
    try:
        import subprocess
        r = subprocess.run(["node", "--check", os.path.join(SRC, "DeclineLens.user.js")],
                           capture_output=True, shell=(os.name == "nt"))
        if r.returncode == 0:
            print("✓ 语法检查通过")
        else:
            sys.exit("✗ 生成的 DeclineLens.user.js 语法错误：\n"
                     + r.stderr.decode("utf-8", "replace"))
    except FileNotFoundError:
        pass

    n = len(DICT_SRC.split("\n"))
    print("🐒 DeclineLens.user.js  (%d KB，内联字典 %d 行)"
          % (len(out.encode("utf-8")) // 1024, n))
    return out


# ── 扩展 zip ───────────────────────────────────────────────────────────────
# dict.js 必须在列表里：popup.html 用 <script src="dict.js"> 加载它，
# 漏掉的话弹窗会静默空白（诊断函数全部 undefined）。
FILES = ["content.js", "pagehook.js", "dict.js", "popup.html", "popup.js",
         "README.md", "LICENSE",
         "icon16.png", "icon48.png", "icon128.png"]


# ── 发出去的 README 要单独处理一下 ──────────────────────────────────────────
# README 里那两张截图写的是相对路径 docs/screenshot-*.png，在 GitHub 仓库页面
# 上没问题；但成品目录和 zip 里没有 docs/ 这个文件夹，也不该有——两张图快 600 KB，
# 塞进扩展包纯属浪费，商店审核还会问这是干嘛用的。原样搬过去的结果是：谁打开
# 成品里的 README，看到的都是两个碎图标。
# 所以搬之前先把图片链接改掉：
#   地址已经填好 → 指向 GitHub 上的原图，在哪儿打开都能正常显示；
#   还是占位符   → 整行去掉，换成一句话。宁可没有图，也不留碎图标。
IMG_RE = re.compile(r'^!\[([^\]]*)\]\(docs/(screenshot-[a-z]+\.png)\)[ \t]*$', re.M)

# 同一个道理，README 正文里那些指向别的文档的相对链接（ARCHITECTURE.md、
# PRIVACY.md、README.en.md……）在成品里同样是死的——包里只有 README 自己和
# 上面 FILES 那几个文件。所以把"没跟着一起进包"的相对链接改成 GitHub 上的
# 绝对地址；跟着进包的（LICENSE、pagehook.js 这些）保持相对，本地能点开。
LINK_RE = re.compile(r'\]\((?!https?://|mailto:|#)([^)\s#]+)((?:#[^)\s]*)?)\)')


def _abs_links(t):
    def rep(m):
        path, frag = m.group(1), m.group(2)
        if path in FILES:
            return m.group(0)
        return "](%s/blob/main/%s%s)" % (REPO_URL, path, frag)
    return LINK_RE.sub(rep, t)



def _drop_shot_note(t):
    """图都没了，图底下那段"这两张图是怎么来的"的注释也一并去掉，别自说自话。
    按引用块（连续的 > 开头行）整段找，不按具体措辞找——以后改文案不会失灵。"""
    lines, out, i = t.split("\n"), [], 0
    while i < len(lines):
        if lines[i].startswith(">"):
            j = i
            while j < len(lines) and lines[j].startswith(">"):
                j += 1
            if "make_screenshots.py" in "\n".join(lines[i:j]):
                i = j
                while i < len(lines) and not lines[i].strip():   # 顺带吃掉后面的空行
                    i += 1
                continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def readme_for_ship():
    t = read("README.md")
    if "CHANGE-ME" in REPO_URL:
        # 地址还没填，拼不出绝对链接，图和链接都只能原样留着
        return _drop_shot_note(IMG_RE.sub("（界面截图见项目主页）", t))
    # 顺序不能反：先把图换成绝对地址，_abs_links 才会因为它已经是 https:// 而跳过它。
    # 反过来的话 docs/screenshot-*.png 会被改成 /blob/ 链接，那是网页不是图片。
    return _abs_links(IMG_RE.sub(r'![\1](%s/raw/main/docs/\2)' % REPO_URL, t))


SHIP_README = readme_for_ship()


def pack(manifest_name, out_name):
    missing = [f for f in FILES if not os.path.exists(os.path.join(SRC, f))]
    if missing:
        sys.exit("✗ 缺少文件：%s" % ", ".join(missing))

    out = os.path.join(DIST, out_name)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            if f == "README.md":
                z.writestr(f, SHIP_README)
            else:
                z.write(os.path.join(SRC, f), f)
        z.write(os.path.join(SRC, manifest_name), "manifest.json")
    print("📦 %s  (%d KB)" % (out_name, os.path.getsize(out) // 1024))


# ── 分发到两个成品目录（python build.py --deploy）───────────────────────────
#
# 本目录是**开发目录**：字典、模板、build、测试都在这儿，是唯一的改动入口。
# --deploy 会把成品铺到上一级的两个目录里，各自可以独立拿去用 / 独立开仓：
#
#     ../STRIPE插件/chrome/      解压即可加载的 Chrome / Edge 扩展
#     ../STRIPE插件/firefox/     同上，Firefox 版 manifest
#     ../STRIPE油猴脚本/          单文件油猴脚本（字典已内联，天生自包含）
#
# 路径用相对的（SRC 的上一级），不写死盘符——写死绝对路径的教训见 make_icons.py
# 的注释。默认不执行，必须显式加 --deploy，别人 clone 下来跑不会在他盘上乱建目录。
PARENT = os.path.dirname(SRC)
EXT_DIR = os.path.join(PARENT, "STRIPE插件")
US_DIR = os.path.join(PARENT, "STRIPE油猴脚本")


def _fresh(path):
    """清掉旧成品再铺新的，避免留下上一版的孤儿文件。

    只删确认是我们自己铺出来的目录（里面有 manifest.json 或 DeclineLens.user.js），
    否则原样保留并报错退出——不拿别人的目录赌。"""
    if os.path.isdir(path):
        ours = (os.path.exists(os.path.join(path, "manifest.json"))
                or os.path.exists(os.path.join(path, "DeclineLens.user.js")))
        entries = os.listdir(path)
        if entries and not ours:
            sys.exit("✗ %s 里有内容但不像是本项目铺的，没敢删，请自己确认" % path)
        if ours:
            shutil.rmtree(path)
    os.makedirs(path, exist_ok=True)


def deploy():
    print("\n── 分发成品 ──")

    # 1. 扩展：chrome / firefox 各一份完整目录，直接"加载已解压的扩展程序"
    for sub, manifest in (("chrome", "manifest.json"),
                          ("firefox", "manifest.firefox.json")):
        d = os.path.join(EXT_DIR, sub)
        _fresh(d)
        for f in FILES:
            if f == "README.md":
                write_abs(os.path.join(d, f), SHIP_README)
            else:
                shutil.copy2(os.path.join(SRC, f), os.path.join(d, f))
        shutil.copy2(os.path.join(SRC, manifest), os.path.join(d, "manifest.json"))
        print("🧩 %s  (%d 个文件)" % (d, len(FILES) + 1))

    # zip 一并放过去，发 Release 时直接传
    zdir = os.path.join(EXT_DIR, "zip")
    os.makedirs(zdir, exist_ok=True)
    for z in os.listdir(DIST):
        if z.endswith(".zip"):
            shutil.copy2(os.path.join(DIST, z), os.path.join(zdir, z))
    print("📦 %s  (发布用 zip)" % zdir)

    # 2. 油猴：单文件 + 说明 + 许可证。
    #    字典已经内联进去了，所以这一个文件本身就是完整的——这也是当初收拢
    #    dict.js 的附带好处：油猴版可以被随便搬走，不会因为少带一个文件而变哑。
    _fresh(US_DIR)
    for f in ("DeclineLens.user.js", "README.md", "LICENSE"):
        if f == "README.md":
            write_abs(os.path.join(US_DIR, f), SHIP_README)
        else:
            shutil.copy2(os.path.join(SRC, f), os.path.join(US_DIR, f))
    print("🐒 %s  (单文件脚本 + README + LICENSE)" % US_DIR)

    # 3. 每个成品目录留一张字条。
    #    三个月后回来看，最容易犯的错是直接在成品目录里改代码——改完下次
    #    --deploy 一跑就没了，而且改的还只是两份里的一份。
    note = (
        "这个目录是【成品】，由 build.py 自动生成，不要在这里改代码。\n"
        "\n"
        "开发目录（唯一改动入口）：\n"
        "    %s\n"
        "\n"
        "改完在开发目录里跑：\n"
        "    python build.py --deploy\n"
        "\n"
        "本目录里的文件下次 --deploy 会被整个覆盖。\n"
        "\n"
        "版本：v%s\n"
    ) % (SRC, VERSION)

    for d, extra in ((EXT_DIR, "浏览器扩展版。chrome/ 和 firefox/ 各是一份可直接加载的完整扩展：\n"
                               "  Chrome/Edge: chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 chrome 文件夹\n"
                               "  Firefox:     about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选 firefox/manifest.json\n"
                               "               （Firefox 临时载入重启就失效，长期用建议装油猴版）\n"
                               "  zip/ 里是发 GitHub Release 用的压缩包。\n"),
                     (US_DIR, "油猴脚本版。DeclineLens.user.js 一个文件就是完整的（字典已内联）。\n"
                              "  安装：先装 Tampermonkey，然后把这个文件拖进浏览器，或者从 GitHub raw 链接点安装。\n")):
        with io.open(os.path.join(d, "这是成品目录_请看我.txt"), "w",
                     encoding="utf-8", newline="\r\n") as f:
            f.write(extra + "\n" + "-" * 60 + "\n\n" + note)

    print("📝 两个目录各留了一张「这是成品目录_请看我.txt」")

    print("\n⚠ 这两个目录是**成品**，改代码请回到 %s，" % os.path.basename(SRC))
    print("  改完重跑 python build.py --deploy —— 手改成品下次会被覆盖。")


if __name__ == "__main__":
    build_userscript()
    pack("manifest.json", "DeclineLens-v%s-chrome.zip" % VERSION)
    pack("manifest.firefox.json", "DeclineLens-v%s-firefox.zip" % VERSION)
    print("\n✅ v%s 打包完成：扩展在 dist/，油猴脚本在项目根目录" % VERSION)

    if "--deploy" in sys.argv:
        deploy()
