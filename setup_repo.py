# -*- coding: utf-8 -*-
"""建好 GitHub 仓库之后跑这一次，把仓库地址填进去。

    python setup_repo.py <你的GitHub用户名> [仓库名]

一条命令做完六件事：
    1. 把仓库地址写进 dict.js（全项目唯一的一处来源）
    2. 把全部文档里的仓库地址统一成新的（占位符要换，上一次填的旧账号也要换）
    3. 重新构建（油猴脚本的 @downloadURL 等标签从 dict.js 取值，必须重出）
    4. 重出两张界面截图（地址填好后界面底部会多出「发个 issue」入口）
    5. 逐项检查有没有漏网的占位符或旧地址
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

    # ── 2. 所有文档里的仓库地址 ────────────────────────────────────────
    #
    # 这一步以前只换 README 里的 <你的用户名> 占位符。换 GitHub 账号那次就栽在
    # 这儿：README 早在第一次建仓时就把占位符换成旧用户名了，于是占位符一个都
    # 搜不到，脚本高高兴兴打印「没有待替换的占位符」，而整套文档里全是指向旧账号
    # 的死链接 —— 最后是手动 sed 补回来的。所以现在两件事一起干：
    #     a) 占位符 <你的用户名>              → 新用户名
    #     b) 上一次填进去的 旧用户名/旧仓库名  → 新用户名/新仓库名
    # 旧地址取自第 1 步从 dict.js 读到的 old。那是全项目唯一的地址来源，
    # 拿它当基准，比在正文里瞎猜哪个词是用户名靠谱得多。
    #
    # 用户名在文档里一共有四种长相，四种都得换 —— 头一版只换了第一种，
    # 剩下三种是拿假账号跑一遍才炸出来的：
    #     https://github.com/用户/仓库                     ← 正文链接
    #     https://raw.githubusercontent.com/用户/仓库/...   ← 一键安装链接，换了个域名
    #     https://img.shields.io/github/license/用户/仓库   ← README 顶上那排徽章
    #     @用户                                            ← .github/CODEOWNERS 里的 @ 提及
    # 前三种的共同点是「用户/仓库」这对路径段，所以按这对整体替换，一次盖住三种。
    DOCS = ["README.md", "README.en.md", "ARCHITECTURE.md", "CONTRIBUTING.md",
            "SECURITY.md", "SUPPORT.md",
            "ROADMAP.md", "CODE_OF_CONDUCT.md", "PRIVACY.md", "CHANGELOG.md",
            "package.json",
            ".github/CODEOWNERS",
            ".github/PULL_REQUEST_TEMPLATE.md",
            ".github/ISSUE_TEMPLATE/config.yml"]

    old_user = old_repo = None
    subs = [(USER_PH, user)]
    mo = re.match(r"https?://github\.com/([^/]+)/([^/\s]+)", old or "")
    if mo and PLACEHOLDER not in old and (mo.group(1), mo.group(2)) != (user, repo):
        old_user, old_repo = mo.group(1), mo.group(2)
        subs.append(("%s/%s" % (old_user, old_repo), "%s/%s" % (user, repo)))
        # 行为准则和安全策略里留的联系邮箱也是按用户名拼出来的
        subs.append(("%s@users.noreply.github.com" % old_user,
                     "%s@users.noreply.github.com" % user))
        # CODEOWNERS 里的 @提及。加 \b 是怕碰上 @张三 和 @张三丰 这种前缀撞车
        subs.append((re.compile(r"@" + re.escape(old_user) + r"\b"), "@" + user))
        print("·  发现旧地址 %s/%s，文档里一并改成 %s/%s"
              % (old_user, old_repo, user, repo))

    touched = 0
    for p in DOCS:
        if not os.path.exists(os.path.join(HERE, p)):
            continue
        t0 = read(p)
        t, hit = t0, 0
        for a, b in subs:
            if hasattr(a, "sub"):
                t, k = a.subn(b, t)
                hit += k
            else:
                hit += t.count(a)
                t = t.replace(a, b)
        if t != t0:
            write(p, t)
            touched += 1
            print("✓ %-34s 改了 %d 处" % (p, hit))
    if not touched:
        print("·  文档里的地址本来就是对的，没动")

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
    #   ARCHITECTURE.md 「唯一来源」那一节 讲的就是这个占位符长什么样
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

    # 除了本项目自己的地址，文档里出现别的 github.com/xxx/yyy 多半是旧账号没换干净。
    # 下面两类是**合法**的，不能报：
    #   · ARCHITECTURE.md 「唯一来源」那一节讲的就是占位符长什么样
    #   · 行为准则里引的 Mozilla 那套处理阶梯，是真的外部链接
    #
    # 注意这一段**不按 DOCS 名单扫，而是整个仓库扫一遍**。
    # 按名单扫有个要命的毛病：漏掉一个文件，它就既不会被替换、也不会被检查，
    # 于是脚本一路绿灯报"已完成"，而那个文件里全是死链接。反过来整树扫的话，
    # 新加的文档忘了进名单，这里会直接红，红的内容正好告诉你该往名单里加谁。
    OUTSIDE_OK = {("mozilla", "diversity")}
    SKIP_DIR = {".git", "dist", "docs", "__pycache__", "node_modules", ".idea", ".vscode"}
    SCAN_EXT = (".md", ".json", ".js", ".yml", ".yaml", ".py", ".txt", ".html")
    # 跳过本脚本自己。占位符和示例地址的定义就写在这个文件里（USER_PH、上面那几行
    # 注释），扫到自己必然报红，而且报的全是假的。build.py 里的 PLACEHOLDER 用拼接
    # 绕开同一个问题，这里文件就一个，直接跳过更省事。
    SELF = os.path.basename(os.path.abspath(__file__))

    scanned = []
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [x for x in dirs if x not in SKIP_DIR]
        for fn in files:
            if fn == SELF:
                continue
            if not (fn.endswith(SCAN_EXT) or fn == "CODEOWNERS"):
                continue
            rel = os.path.relpath(os.path.join(root, fn), HERE).replace("\\", "/")
            try:
                t = read(rel)
            except (UnicodeDecodeError, OSError):
                continue
            scanned.append(rel)
            if USER_PH in t:
                problems.append("%s 里还有没替换掉的 %s" % (rel, USER_PH))
            if old_user and old_user in t:
                problems.append("%s 里还留着旧用户名 %s（多半是没进 DOCS 名单）"
                                % (rel, old_user))
            for u2, r2 in set(re.findall(
                    r"github\.com/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)", t)):
                r2 = r2[:-4] if r2.endswith(".git") else r2   # 克隆地址带 .git 后缀
                if (u2, r2) == (user, repo) or (u2, r2) in OUTSIDE_OK:
                    continue
                if PLACEHOLDER in u2 or PLACEHOLDER in r2:
                    continue
                problems.append("%s 里还留着别的仓库地址：github.com/%s/%s" % (rel, u2, r2))

    if problems:
        sys.stderr.write("\n✗ 没弄干净：\n")
        for x in problems:
            sys.stderr.write("   - %s\n" % x)
        return 1

    print("·  全仓库扫了 %d 个文件，没有残留的占位符或旧地址" % len(scanned))

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
    print("   推完之后发第一个版本 —— 只要打个 tag，剩下全自动：")
    print("        git tag v%s && git push origin v%s" % (ver, ver))
    print("")
    print("   这一推会触发 .github/workflows/release.yml，它替你干完这些：")
    print("        跑自检 → 构建 → 核对版本号 → 生成 Release 正文 → 建 Release → 传两个 zip")
    print("   （dist/ 不进仓库，README 里的下载链接指的就是这个 Release）")
    print("")
    print("   建仓库那步也能用 GitHub 官方命令行 gh 一条顶掉：")
    print("     gh repo create %s --public --source=. --push" % repo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
