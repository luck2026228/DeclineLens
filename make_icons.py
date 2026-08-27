# -*- coding: utf-8 -*-
"""生成 DeclineLens 图标（PIL 手绘：放大镜 + 拒绝符号）

只在改图标时才需要跑；仓库里已经带了生成好的 png。
"""
import os
import subprocess
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pillow"], check=True)
    from PIL import Image, ImageDraw

# 输出到脚本自己所在的目录。
# 旧版这里硬编码了一条本机绝对路径，别人克隆下来一跑就往自己盘上乱写文件。
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

for size in (16, 48, 128):
    img = Image.new("RGBA", (size, size), (15, 17, 19, 255))
    d = ImageDraw.Draw(img)
    u = size / 128.0  # 缩放因子
    # 放大镜圆圈
    d.ellipse([28 * u, 28 * u, 78 * u, 78 * u],
              outline=(154, 205, 50, 255), width=max(2, int(7 * u)))
    # 手柄
    d.line([72 * u, 72 * u, 98 * u, 98 * u],
           fill=(154, 205, 50, 255), width=max(2, int(9 * u)))
    # 圈内的 X（拒绝）
    d.line([42 * u, 42 * u, 64 * u, 64 * u], fill=(255, 107, 107, 255), width=max(1, int(7 * u)))
    d.line([64 * u, 42 * u, 42 * u, 64 * u], fill=(255, 107, 107, 255), width=max(1, int(7 * u)))

    out = os.path.join(HERE, "icon%d.png" % size)
    img.save(out)
    print("icon%d.png ok" % size)
