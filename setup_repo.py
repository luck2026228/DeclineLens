# -*- coding: utf-8 -*-
"""建好 GitHub 仓库之后跑这一次，把仓库地址填进去。

    python setup_repo.py <你的GitHub用户名> [仓库名]

一条命令做完六件事：
    1. 把仓库地址写进 dict.js（全项目唯一的一处来源）
    2. 替换 README 里的安装链接占位符
    3. 重新构建（油猴脚本的 @downloadURL 等标签从 dict.js 取值，必须重出）
    4. 重出两张界面截图（地址填好后界面底部会多出「发个 issue」入口）
    5. 逐项检查有没有漏网的占位符
    6. 本地 git：建仓库 / 提交这一版 / 记下远程地址 —— 做完只差一条 git push

为什么需要这么个脚本：仓库地址是分散不了的 —— 油猴脚本的 @downloadURL /
@updateURL（自动更新全靠它）、@homepageURL、@supportURL、两个界面里的
「发个 issue」入口、README 里的安装链接，全都指向同一个地址。地址只有
dict.js 里那一份是唯一来源，其余都是 build.py 注入或 README 里的占位符。
这个脚本把这两处一起改掉，然后重新构建，免得漏掉哪一处。

不改对的后果很具体：@updateURL 指向不存在的地址 → 用户装上之后永远收不到
更新；REPO_OK 门禁会一直生效 → 两个界面都不显示 issue 入口 → 项目唯一的
贡献渠道是关着的。

跑第二遍、第三遍都没关系，不会重复搞坏东西。
"""
import io
import os
import re
import shutil
import subprocess
import sys

# ── 别删：Windows 中文控制台的编码坑 ────────────────────────────────────────
# 中文 Windows 的控制台默认是 GBK，打不出 ✓ ✗ ⚠ 这类符号。直接在终端里
# 跑没事（Python 走的是宽字符接口），但只要把输出重定向进文件、或者接一根管道
# （python build.py > log.txt / | more / CI 里收集日志），编码就退回 GBK，
# 遇到这些符号会直接 UnicodeEncodeError 把整个脚本崩掉 —— 而且崩在打印那一句，
# 看着像"构建失败"，其实活儿早干完了。
# 下面两句只把打不出的字符降级成 ?，不动编码、不动中文、不动任何逻辑。
# 顺带打开 line_buffering：这个脚本会去调 build.py / make_screenshots.py，
# 不打开的话一旦把输出接进管道或文件，本脚本的提示会被攒着最后一起吐，
# 看上去像"先截图后填地址"，其实顺序是对的，只是显示乱了。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace", line_buffering=True)
    except Exception:                       # 老 Python 或非标准流，忽略
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
PLACEHOLDER = "CHANGE-ME"
USER_PH = "<你的用户名>"


def read(p):
    with io.open(os.path.join(HERE, p), encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(os.path.join(HERE, p), "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def sh(*a):
    """跑一条命令，返回 (退出码, 输出)。不抛异常，失败了让调用方决定怎么办。"""
    p = subprocess.Popen(a, cwd=HERE, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT)
    out, _ = p.communicate()
    return p.returncode, out.decode("utf-8", "replace").strip()


def git_prepare(url, user, ver):
    """把本地仓库准备到「只差一条 git push」的程度。

    全程不碰网络：建仓库、存这一版、把远程地址记上，就这三件事。
    可以重复跑：已经是仓库就不再 init，没有新改动就不再重复提交。
    没装 git 就跳过，不影响前面的活儿。"""
    if shutil.which("git") is None:
        print("·  没找到 git 命令，本地仓库这一步跳过（装了 git 再跑一次就行）")
        return False

    if not os.path.isdir(os.path.join(HERE, ".git")):
        rc, out = sh("git", "init", "-q", "-b", "main")
        if rc:
            print("·  git init 没成：%s" % out)
            return False
        print("✓ 建好本地仓库，分支 main")
    else:
        print("·  这儿已经是 git 仓库了，不重复建")

    # 提交必须带署名。你电脑上没配过全局署名，所以在**这个仓库内部**配一个，
    # 不动你的全局设置。邮箱用 GitHub 官方的匿名地址，提交记录里不会露出真邮箱。
    #
    # 换 GitHub 账号的情况也管：如果现在配着的邮箱正是本脚本上次写进去的那种
    # 匿名地址、而且跟这次的用户名对不上，就更新成新的。只认自己留下的痕迹——
    # 你要是手写过署名，这儿一个字都不会动。
    mail = "%s@users.noreply.github.com" % user
    rc, cur = sh("git", "config", "user.email")
    if rc != 0 or (cur.endswith("@users.noreply.github.com") and cur != mail):
        sh("git", "config", "user.name", user)
        sh("git", "config", "user.email", mail)
        print("✓ 署名设为 %s <%s>（只在这个仓库里生效）" % (user, mail))

    sh("git", "add", "-A")
    if not sh("git", "status", "--porcelain")[1]:
        print("·  跟上次比没有变化，不用重复提交")
    else:
        rc, out = sh("git", "commit", "-q", "-m", "DeclineLens v%s" % ver)
        if rc:
            print("·  提交没成：%s" % out)
            return False
        print("✓ 这一版已存进本地仓库：DeclineLens v%s" % ver)

    remote = "%s.git" % url
    if sh("git", "remote", "get-url", "origin")[0] == 0:
        sh("git", "remote", "set-url", "origin", remote)
    else:
        sh("git", "remote", "add", "origin", remote)
    print("✓ 远程地址记上了：%s" % remote)
    return True


def main():
    if len(sys.argv) < 2:
        sys.stderr.write(__doc__ + "\n")
        return 2

    user = sys.argv[1].strip().strip("/")
    repo = (sys.argv[2].strip() if len(sys.argv) > 2 else "DeclineLens").strip("/")

    if not re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$", user):
        sys.stderr.write("✗ 用户名看着不对：%r\n" % user)
        return 1
    if not re.match(r"^[A-Za-z0-9._-]+$", repo):
        sys.stderr.write("✗ 仓库名看着不对：%r\n" % repo)
        return 1

    url = "https://github.com/%s/%s" % (user, repo)

    # ── 1. dict.js —— 仓库地址的唯一来源 ────────────────────────────────
    d = read("dict.js")
    m = re.search(r'^const REPO_URL = "([^"]*)";', d, re.M)
    if not m:
        sys.stderr.write("✗ dict.js 里找不到 REPO_URL 那一行\n")
        return 1
    old = m.group(1)
    if PLACEHOLDER not in old and old != url:
        sys.stderr.write("⚠ dict.js 里已经是别的地址了：%s\n" % old)
        sys.stderr.write("  确认要改成 %s 就再加一个 --force\n" % url)
        if "--force" not in sys.argv:
            return 1
    d = d.replace('const REPO_URL = "%s";' % old,
                  'const REPO_URL = "%s";' % url, 1)
    write("dict.js", d)
    print("✓ dict.js       REPO_URL → %s" % url)

    # ── 2. README 里的安装链接占位符 ───────────────────────────────────
    r = read("README.md")
    n = r.count(USER_PH)
    if n:
        r = r.replace(USER_PH, user)
        write("README.md", r)
        print("✓ README.md     替换了 %d 处 %s" % (n, USER_PH))
    else:
        print("·  README.md    没有待替换的占位符")

    # ── 3. 重新构建 —— 不做这一步等于没改 ───────────────────────────────
    print("\n── 重新构建 ──")
    rc = subprocess.call([sys.executable, os.path.join(HERE, "build.py")])
    if rc != 0:
        sys.stderr.write("✗ 构建失败，上面有输出\n")
        return rc

    # ── 3.5 顺手重出截图 ───────────────────────────────────────────────
    # 地址一填，两个界面底部就会多出「发个 issue」入口（REPO_OK 那个门禁开了）。
    # 不重截的话，README 里的图和用户装完看到的界面对不上。
    shots = os.path.join(HERE, "make_screenshots.py")
    if os.path.exists(shots):
        print("")
        print("── 重出截图 ──")
        if subprocess.call([sys.executable, shots]) != 0:
            print("·  截图这步没成，不影响使用；想要的话事后单独跑 python make_screenshots.py")

    # ── 4. 验一遍真的没有残留 ───────────────────────────────────────────
    # 不能简单地全文搜 "CHANGE-ME"，会误报。有三处是**故意**留着的：
    #   dict.js:27          REPO_OK = REPO_URL.indexOf("CHANGE-ME") < 0   ← 门禁本身
    #   DeclineLens.user.js 同一行被内联进去的副本
    #   README.md 第 5.6 节 讲的就是这个占位符长什么样，属于文档
    # 所以只查真正必须变的东西：两处 REPO_URL 赋值 + 油猴脚本那五个 @ 标签 +
    # README 里给用户抄的安装链接。
    problems = []

    m = re.search(r'const REPO_URL\s*=\s*"([^"]*)"', read("dict.js"))
    if not m:
        problems.append("dict.js 里找不到 REPO_URL 那一行了")
    elif PLACEHOLDER in m.group(1):
        problems.append("dict.js 的 REPO_URL 还是占位符")

    us = read("DeclineLens.user.js")
    m = re.search(r'const REPO_URL\s*=\s*"([^"]*)"', us)
    if not m:
        problems.append("DeclineLens.user.js 里没有内联到 REPO_URL")
    elif PLACEHOLDER in m.group(1):
        problems.append("DeclineLens.user.js 里内联的 REPO_URL 还是占位符"
                        "（多半是忘了重新 build）")

    for tag in ("@downloadURL", "@updateURL", "@supportURL", "@homepageURL", "@namespace"):
        mm = re.search(r"//\s*%s\s+(\S+)" % tag, us)
        if not mm:
            problems.append("油猴脚本缺 %s" % tag)
        elif PLACEHOLDER in mm.group(1):
            problems.append("油猴脚本的 %s 还是占位符" % tag)

    if USER_PH in read("README.md"):
        problems.append("README.md 里还有没替换掉的 %s" % USER_PH)

    if problems:
        sys.stderr.write("\n✗ 没弄干净：\n")
        for x in problems:
            sys.stderr.write("   - %s\n" % x)
        return 1

    for tag in ("@downloadURL", "@updateURL", "@supportURL", "@homepageURL", "@namespace"):
        mm = re.search(r"//\s*%s\s+(\S+)" % tag, us)
        print("  %-13s %s" % (tag, mm.group(1) if mm else "✗ 缺失"))

    ver = re.search(r'"version": "([^"]+)"', read("manifest.json")).group(1)

    # ── 5. 本地 git：能提前做的全做掉 ──────────────────────────────────
    print("")
    print("── 本地 git ──")
    git_ok = git_prepare(url, user, ver)

    print("")
    if git_ok:
        print("✅ 全好了。你只剩两件事：")
        print("")
        print("   第一件：打开 https://github.com/new 建仓库")
        print("      · 名字填          %s" % repo)
        print("      · 选              Public")
        print("      · 下面 README / .gitignore / License 三个勾**一个都别勾**")
        print("        （本地已经有了，勾了反而会撞车）")
        print("")
        print("   第二件：回到这个目录，敲这一条：")
        print("        git push -u origin main")
        print("      弹出来让你登录 GitHub 就登录，浏览器里点一下授权即可。")
    else:
        print("✅ 地址已就位。本地 git 没能自动弄，手动敲这几条：")
        print("   git init && git add -A")
        print('   git commit -m "DeclineLens v%s"' % ver)
        print("   git branch -M main")
        print("   git remote add origin %s.git" % url)
        print("   git push -u origin main")

    print("")
    print("   推完之后，最后去仓库页面 Releases → Create a new release，")
    print("   Tag 填 v%s，把这两个文件拖进去：" % ver)
    for kind in ("chrome", "firefox"):
        print("        dist/DeclineLens-v%s-%s.zip" % (ver, kind))
    print("   （dist/ 不进仓库，README 里的下载链接指的就是这个 Release）")
    print("")
    print("   装了 GitHub 官方命令行 gh 的话，上面这些可以两条顶掉：")
    print("     gh repo create %s --public --source=. --push" % repo)
    print('     gh release create v%s dist/*.zip --title "v%s" --notes-file CHANGELOG.md'
          % (ver, ver))
    return 0


if __name__ == "__main__":
    sys.exit(main())
