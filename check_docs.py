# -*- coding: utf-8 -*-
"""文档体检：占位符 / 损坏字符 / 内部死链，一次查完。

    python check_docs.py          # 或者 npm run docs

三件事，都是踩过坑才加的：

  1. 残留占位符 —— 建仓时 `<你的用户名>` 和 `CHANGE-ME` 要被 setup_repo.py 换掉。
     漏一个，用户点的安装链接就是 404。

  2. 损坏字符 U+FFFD —— 中文文件被错误编码写过一遍就会留下这个"替换字符"，
     肉眼几乎看不出来（它显示成一个方块或问号，夹在一堆汉字里很难注意到），
     但它是永久性的：原字符已经没了，只能靠人重新打一遍。所以必须机器查。

  3. 内部死链 —— markdown 里指向本仓库文件的相对链接、以及 `#锚点`。
     这类链接在本地写的时候都对，改个标题、挪个文件就悄悄坏了，
     而 GitHub 页面上点进去才发现是 404。第一次跑这个检查就抓出两条：
       · PR 模板写 `(CODE_OF_CONDUCT.md)`，但模板自己在 .github/ 里，
         实际解析成 .github/CODE_OF_CONDUCT.md —— 不存在
       · README 写 `(../../releases)`，在 GitHub 页面上能跳对，
         但这份 README 会被打进扩展 zip，在那儿就是死链

退出码 0 = 全过，1 = 有问题（CI 靠这个判红绿）。
"""
import glob
import io
import os
import re
import sys

# ── 别删：Windows 中文控制台的编码坑（同 build.py，原因见那边的长注释）────────
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

# 这三个"要找的字符串"必须拼出来，不能直接写死 —— 本文件自己也在扫描范围里，
# 写死的话第一个被抓的就是它自己。build.py 里的 PLACEHOLDER 用的是同一招。
PH_USER = "<你的" + "用户名>"
PH_REPO = "CHANGE" + "-ME"
BROKEN = chr(0xFFFD)

SELF = os.path.basename(os.path.abspath(__file__))

# 占位符和损坏字符：扫这些
DOCS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "ROADMAP.md",
        "CODE_OF_CONDUCT.md", "PRIVACY.md", "CHANGELOG.md", "package.json"]

# 损坏字符另外还要扫代码和流水线 —— 中文注释在这些文件里同样会被咬坏
CODE = ["build.py", "setup_repo.py", "make_release_notes.py", "make_icons.py",
        "make_screenshots.py", "test.js", "dict.js", "content.js", "pagehook.js",
        "popup.js", "popup.html", "userscript.template.js"]

# CHANGE-ME 在 README 5.6 节是**故意**留着的 —— 那一节讲的就是这个占位符长什么样。
REPO_PH_OK = {"README.md"}

problems = []


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def md_files():
    out = list(DOCS)
    out += sorted(x.replace("\\", "/") for x in glob.glob(".github/**/*.md", recursive=True))
    return [p for p in out if os.path.exists(p)]


# ── 1 + 2. 占位符与损坏字符 ─────────────────────────────────────────────────
#
# 两件事的适用范围不一样，别混：
#   · 占位符只查**文档**。build.py / setup_repo.py / test.js 这些是**处理**占位符
#     的工具，它们必须提到 CHANGE-ME 和 <你的用户名>，在那儿出现是正常的。
#   · 损坏字符要查**全部**，包括代码 —— 源码里的中文注释一样会被咬坏，而且
#     代码里出了这事更难发现，没人会逐行读注释。
def check_text():
    docs = md_files()
    for p in docs:
        t = read(p)
        if PH_USER in t:
            problems.append("%s 里还有没替换的用户名占位符" % p)
        if PH_REPO in t and p not in REPO_PH_OK:
            problems.append("%s 里还有没替换的仓库地址占位符" % p)

    seen = []
    for p in docs + [x for x in CODE if os.path.exists(x)]:
        if os.path.basename(p) == SELF:
            continue
        seen.append(p)
        t = read(p)
        if BROKEN in t:
            for i, ln in enumerate(t.split("\n"), 1):
                if BROKEN in ln:
                    problems.append("%s 第 %d 行有损坏字符 U+FFFD（编码事故）：%s"
                                    % (p, i, ln.strip()[:60]))
    return seen


# ── 3. 内部链接 ────────────────────────────────────────────────────────────
def anchors(text):
    """按 GitHub 的规则把标题转成锚点：小写、去标点、空格换成短横。

    中文标题 GitHub 是原样保留的（`## 一、只想报…` → `#一只想报…`），
    所以这里不能只留 ASCII，得把汉字放行。"""
    out = set()
    for m in re.finditer(r"^#{1,6}\s+(.*?)\s*$", text, re.M):
        h = m.group(1)
        h = re.sub(r"`([^`]*)`", r"\1", h)                # 行内代码只留内容
        h = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", h)    # 链接只留文字
        h = re.sub(r"[*_~]", "", h)                       # 去掉加粗/斜体标记
        s = re.sub(r"[^\w一-鿿\s-]", "", h.lower().strip(), flags=re.U)
        out.add(s.strip().replace(" ", "-"))
    return out


def check_links():
    cache = {p: read(p) for p in md_files()}
    anch = {p: anchors(t) for p, t in cache.items()}
    n = 0
    for p, t in cache.items():
        for m in re.finditer(r"\[([^\]]+)\]\(([^)\s]+)\)", t):
            href = m.group(2)
            if href.startswith(("http://", "https://", "mailto:", "#L")):
                continue
            n += 1
            if href.startswith("#"):
                tgt, frag = p, href[1:]
            else:
                part = href.split("#", 1)
                tgt = os.path.normpath(
                    os.path.join(os.path.dirname(p), part[0])).replace("\\", "/")
                frag = part[1] if len(part) > 1 else ""
            if not os.path.exists(tgt):
                problems.append("%s 里的链接指向不存在的文件：%s" % (p, href))
                continue
            if frag:
                if tgt not in anch:
                    anch[tgt] = anchors(read(tgt)) if tgt.endswith(".md") else set()
                if frag not in anch[tgt]:
                    problems.append("%s 里的锚点找不到：%s" % (p, href))
    return n


def main():
    files = check_text()
    links = check_links()

    if problems:
        sys.stdout.write("\n文档体检没过：\n")
        for x in problems:
            # ::error:: 是 GitHub Actions 的标记，会在网页上高亮成红条；
            # 本地跑的时候它只是多几个冒号，不影响阅读。
            sys.stdout.write("::error::%s\n" % x)
        sys.stdout.write("\n共 %d 处。\n" % len(problems))
        return 1

    sys.stdout.write("OK：%d 个文件、%d 条内部链接，没有残留占位符，"
                     "没有损坏字符，没有死链\n" % (len(files), links))
    return 0


if __name__ == "__main__":
    sys.exit(main())
