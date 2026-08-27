# -*- coding: utf-8 -*-
"""生成 GitHub Release 的正文，打到标准输出。

    python make_release_notes.py             # 用 manifest.json 里的当前版本
    python make_release_notes.py 3.1.2       # 指定版本
    python make_release_notes.py > notes.md  # 存文件（CI 就是这么用的）

为什么要有这个脚本：Release 正文里有三样东西是会漂的 ——
版本号、仓库地址、这一版改了什么。手写就意味着每次发版都要在三个地方
抄一遍，抄错了没人会发现（Release 正文没有任何自检）。

这里全部从唯一来源取：
    版本号   ← manifest.json 的 version
    仓库地址 ← dict.js 的 REPO_URL
    改动说明 ← CHANGELOG.md 里对应版本那一段

跟 build.py 用的是同两个来源，所以三者永远对得上。
"""
import io
import json
import os
import re
import sys

# ── 别删：Windows 中文控制台的编码坑 ────────────────────────────────────────
# 中文 Windows 的控制台默认是 GBK，打不出 ✓ ✗ ⚠ 这类符号。直接在终端里
# 跑没事（Python 走的是宽字符接口），但只要把输出重定向进文件、或者接一根管道
# （python make_release_notes.py > notes.md / CI 里收集日志），编码就退回 GBK，
# 遇到这些符号会直接 UnicodeEncodeError 把整个脚本崩掉。
#
# 这个脚本比别的更要紧：它的**正文本身**就是要重定向进文件的，而正文里全是中文。
# 所以这儿不能只做 errors="replace"（那会把中文变成一串问号，正文就毁了），
# 必须真的把标准输出切成 UTF-8。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                       # 老 Python 或非标准流，忽略
        pass

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    with io.open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def changelog_section(text, version):
    """从 CHANGELOG.md 里抠出某个版本那一段。

    认的是这种标题：
        ## [3.1.2] — 2026-08-28
        ## [3.1.2] - 2026-08-28
        ## 3.1.2
    一直吃到下一个 ## 为止。末尾那条 --- 分隔线属于版面装饰，去掉。
    """
    pat = re.compile(
        r"^##\s*\[?" + re.escape(version) + r"\]?\s*(?:[^\n]*)$",
        re.M,
    )
    m = pat.search(text)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"^##\s", rest, re.M)
    body = rest[: nxt.start()] if nxt else rest
    body = body.strip()
    body = re.sub(r"\n+-{3,}\s*$", "", body).strip()
    return body


def main():
    version = sys.argv[1].lstrip("v") if len(sys.argv) > 1 else None
    if not version:
        version = json.loads(read("manifest.json"))["version"]

    m = re.search(r'REPO_URL\s*=\s*"([^"]+)"', read("dict.js"))
    if not m:
        sys.stderr.write("✗ dict.js 里找不到 REPO_URL\n")
        return 1
    repo = m.group(1).rstrip("/")

    if "CHANGE-ME" in repo:
        sys.stderr.write("✗ dict.js 的 REPO_URL 还是占位符，"
                         "先跑 setup_repo.py 把地址填上\n")
        return 1

    body = changelog_section(read("CHANGELOG.md"), version)
    if body is None:
        sys.stderr.write("✗ CHANGELOG.md 里没有 %s 这一段，"
                         "发版之前请先补上\n" % version)
        return 1

    out = []
    w = out.append

    w("Stripe 拒付原因翻译器。把 `Your card was declined.` 这一句话，"
      "还原成银行到底说了什么、以及该怎么办。")
    w("")
    w("**两种装法，功能一样，挑一个：**")
    w("")
    w("| | 怎么装 |")
    w("|---|---|")
    w("| **油猴脚本**（推荐，最省事） | 装好 Tampermonkey 后点这个链接："
      "[DeclineLens.user.js](%s/raw/main/DeclineLens.user.js) |" % repo)
    w("| **Chrome / Edge 扩展** | 下面下载 `DeclineLens-v%s-chrome.zip`，解压，"
      "浏览器地址栏进 `chrome://extensions`，打开右上角「开发者模式」，"
      "点「加载已解压的扩展程序」，选解压出来的文件夹 |" % version)
    w("| **Firefox 扩展** | 下面下载 `DeclineLens-v%s-firefox.zip`，"
      "进 `about:debugging` → 「此 Firefox」→「临时载入附加组件」 |" % version)
    w("")
    w("**它不做什么**：不发任何网络请求，不上传任何数据，"
      "全部记录只存在你自己浏览器里，随时一键清空。"
      "详见 [PRIVACY.md](%s/blob/main/PRIVACY.md)。" % repo)
    w("")
    w("---")
    w("")
    w("## 这一版改了什么")
    w("")
    w(body)
    w("")
    w("---")
    w("")
    w("完整说明见 [README](%s#readme)。"
      "用着有问题、或者碰到没收录的拒付码，欢迎 [发个 issue](%s/issues)。"
      % (repo, repo))

    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
