#!/bin/bash
# ==========================================================================
# Start · Daily Workspace — 无头浏览器回归测试
#
#   把被测源码复制到临时目录，注入 seed.js（打桩 fetch / JSONP / localStorage）
#   与 test.js（断言集），用无头 Chrome 逐场景跑一遍并把结果抓回来。
#
# 用法：
#   ./run.sh                 # 跑全部场景
#   ./run.sh dirty offline   # 只跑指定场景
#
# 可用的环境变量覆盖：
#   SRC=/path/to/site        # 被测源码目录（默认：本脚本上一级目录）
#   CHROME=/path/to/chrome   # 浏览器可执行文件（默认自动探测）
#   PY=/path/to/python3      # Python 解释器（默认 python3）
#   PORT=8896                # 测试服务端口
#   VTB=60000                # Chrome 虚拟时间预算（毫秒），见下方注释
# ==========================================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="${TMP:-/tmp/sp-tests}"
PORT="${PORT:-8896}"

# 虚拟时间预算。Chrome 的虚拟时钟会以「尽可能快」的速度推进 —— 页面里的
# setInterval(updateClock, 1000) 让时钟一直有活干，于是预算被瞬间烧完；
# 一旦耗尽，Chrome 立刻 dump DOM，而此时 <script src="/app.js"> 的**真实**网络
# 加载可能还没回来，抓到的就只是一份原始 HTML（时钟还是 --:--、热点还是骨架），
# report.py 于是报「页面在断言前就崩了」。表现是随机/轮换的失败场景 ——
# 以前靠重跑掩盖了它。20000 太紧，给足空间才能稳定。
VTB="${VTB:-60000}"

# ---------- 被测源码 ----------
# 优先用脚本的上一级目录（仓库 clone 的布局：<repo>/tests/run.sh），
# 找不到再回退到本地部署目录。这样同一个脚本在两种位置都能直接跑。
if [ -z "${SRC:-}" ]; then
  if [ -f "$HERE/../index.html" ] && [ -f "$HERE/../app.js" ]; then
    SRC="$(cd "$HERE/.." && pwd)"
  else
    SRC="/Volumes/Abobb-disk/startpage-deploy"
  fi
fi
[ -f "$SRC/index.html" ] || { echo "❌ 在 $SRC 里找不到 index.html，请用 SRC=... 指定被测目录"; exit 1; }

# ---------- 浏览器 ----------
if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
    if [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
if [ -z "${CHROME:-}" ]; then
  for c in google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then CHROME="$(command -v "$c")"; break; fi
  done
fi
[ -n "${CHROME:-}" ] || { echo "❌ 找不到 Chrome / Chromium，请用 CHROME=/path/to/chrome 指定"; exit 1; }

# ---------- Python ----------
if [ -z "${PY:-}" ]; then PY="$(command -v python3 || true)"; fi
[ -n "${PY:-}" ] || { echo "❌ 找不到 python3"; exit 1; }

ALL_CASES=(default cached dirty public offline interactive wpfail picfail assets search)

CASES=("$@")
[ ${#CASES[@]} -eq 0 ] && CASES=("${ALL_CASES[@]}")

echo "被测源码：$SRC"
echo "浏览器　：$CHROME"
echo

# ---------- 组装临时站点 ----------
rm -rf "$TMP"; mkdir -p "$TMP/img"
cp "$SRC/index.html" "$SRC/app.js" "$SRC/styles.css" "$TMP/"
cp -R "$SRC/assets" "$TMP/assets"
# 图标也带上：assets 场景要核「引用是否指得对」，文件在不在会额外验证一遍可达性
cp "$SRC"/favicon.ico "$SRC"/favicon.png "$SRC"/favicon.svg "$SRC"/apple-touch-icon.png "$TMP/" 2>/dev/null || true
cp "$HERE/seed.js" "$HERE/test.js" "$TMP/"

# 纯黑 / 纯白测试图，用来验证壁纸明暗采样
"$PY" - "$TMP/img" <<'PYEOF'
import struct, sys, zlib
out = sys.argv[1]
def png(path, rgb, w=600, h=400):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    open(path, 'wb').write(data)
png(out + '/black.png', (0, 0, 0))
png(out + '/white.png', (255, 255, 255))
PYEOF

# 注入测试脚本。
# 关键：**内联**，不要写成 <script src="/seed.js">。
# Chrome 的虚拟时钟不把「外部脚本的加载」算作 pending 任务，--virtual-time-budget
# 可能在 app.js 还没执行时就用尽并 dump DOM —— 抓到的是一份原始 HTML（时钟仍是 --:--、
# 热点还是骨架），report.py 只能报「页面在断言前就崩了」，且每次失败的场景都不一样。
# 内联后解析器读到就执行，没有网络往返，这条竞争通道就没了。样式同理。
"$PY" - "$TMP/index.html" "$TMP" <<'PYEOF'
import pathlib, re, sys

page, tmp = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
s = page.read_text(encoding='utf-8')

def inline(text):
    # JS 里若出现 `</script>` 会提前闭合标签，按 HTML 规则转义掉
    return text.replace('</script', r'<\/script')

scripts = ''.join(f'<script>{inline((tmp / n).read_text(encoding="utf-8"))}</script>'
                  for n in ('seed.js', 'app.js', 'test.js'))
# 用函数式替换：替换串里的反斜杠在 re.subn 里有转义含义，直接传字符串会报 bad escape
s, n_js = re.subn(r'<script src="/app\.js[^"]*"></script>', lambda _m: scripts, s)
assert n_js == 1, '注入失败：没找到 app.js 的 script 标签'

css = (tmp / 'styles.css').read_text(encoding='utf-8')
# 注意 link 标签是自闭合写法（`" />`），pattern 要吃掉多于一个空格与尾斜杠
s, n_css = re.subn(r'<link rel="stylesheet" href="/styles\.css[^"]*"[^>]*>', lambda _m: f'<style>{css}</style>', s)
assert n_css == 1, '注入失败：没找到 styles.css 的 link 标签'

page.write_text(s, encoding='utf-8')
PYEOF
# 注入失败就别往下跑：拿没注入过的原始页面跑测试只会得到一堆假失败
if ! grep -q '<style>' "$TMP/index.html"; then echo "❌ 注入未生效，中止"; exit 1; fi

# ---------- 起服务 ----------
"$PY" "$HERE/server.py" "$TMP" "$PORT" >/dev/null 2>&1 &
SRV=$!

trap 'kill $SRV 2>/dev/null' EXIT
sleep 1.2
curl -s -o /dev/null -w "测试服务 %{http_code}\n" "http://127.0.0.1:$PORT/index.html"

# ---------- 逐场景跑 ----------
FAILED=0
for c in "${CASES[@]}"; do
  EXTRA=()
  [ "$c" = "offline" ] && EXTRA=(--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1")
  DOM="/tmp/sp-dom-$c.html"
  # 不要给 headless Chrome 指定全新的 --user-data-dir：在本机会让启动阶段直接挂住
  # （连 about:blank 都不返回）。不指定时 Chrome 自建临时 profile，不会与用户
  # 日常浏览器的默认 profile 冲突。
  "$CHROME" --headless=new --disable-gpu --no-sandbox --dump-dom \
      --no-first-run --no-default-browser-check \
      --virtual-time-budget="$VTB" ${EXTRA[@]+"${EXTRA[@]}"} \
      "http://127.0.0.1:$PORT/index.html?case=$c" > "$DOM" 2>/dev/null

  if [ "$c" = "search" ]; then
    if grep -q "__SEARCH_HIT__/__search__?q=%E4%BD%A0%E5%A5%BD%20world" "$DOM"; then
      echo "=== [search] ✅ 回车后跳到引擎地址，查询串已正确编码 ==="
    else
      echo "=== [search] ❌ 未跳到预期地址：$(grep -o '__SEARCH_HIT__[^<]*' "$DOM" | head -1) ==="
      FAILED=$((FAILED + 1))
    fi
    continue
  fi

  "$PY" "$HERE/report.py" "$c" "$DOM" || FAILED=$((FAILED + 1))
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "全部场景通过 ✅"
else
  echo "有 $FAILED 个场景存在失败项 ❌"
fi
exit "$FAILED"
