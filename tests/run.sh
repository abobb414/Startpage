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
# ==========================================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="${TMP:-/tmp/sp-tests}"
PORT="${PORT:-8896}"

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

ALL_CASES=(default cached dirty public offline interactive wpfail picfail search)

CASES=("$@")
[ ${#CASES[@]} -eq 0 ] && CASES=("${ALL_CASES[@]}")

echo "被测源码：$SRC"
echo "浏览器　：$CHROME"
echo

# ---------- 组装临时站点 ----------
rm -rf "$TMP"; mkdir -p "$TMP/img"
cp "$SRC/index.html" "$SRC/app.js" "$SRC/styles.css" "$TMP/"
cp -R "$SRC/assets" "$TMP/assets"
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

# 注入测试脚本
"$PY" - "$TMP/index.html" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s, n = re.subn(r'<script src="/app\.js[^"]*"></script>',
               '<script src="/seed.js"></script><script src="/app.js"></script><script src="/test.js"></script>',
               s)
assert n == 1, '注入失败：没找到 app.js 的 script 标签'
open(p, 'w', encoding='utf-8').write(s)
PYEOF

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
  "$CHROME" --headless=new --disable-gpu --no-sandbox --dump-dom \
      --virtual-time-budget=20000 ${EXTRA[@]+"${EXTRA[@]}"} \
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
