#!/usr/bin/env python3
"""从 --dump-dom 的输出里抓出测试结果并打印。

用例结果由 test.js 边跑边写进 <pre id="__results">（partial 心跳），
所以「跑到一半页面被 dump」也能看出卡在哪个 section，而不是笼统一句「崩了」。

用法：report.py <case> <dom-file>
退出码：0 = 全部通过，1 = 有失败项 / 没跑完（可直接用于 CI / run.sh 汇总）
"""
import html
import json
import re
import sys

case, path = sys.argv[1], sys.argv[2]
raw = open(path, encoding='utf-8', errors='replace').read()

# 测试脚本是内联进页面的，DOM 里因此会带上 test.js 的**源码**，
# 其中就包含 `__TESTS_START__${JSON.stringify(...)}__TESTS_END__` 这个模板字面量。
# 所以不能只取第一处匹配 —— 要逐个试，取真正能解析成结果对象的那一处。
candidates = re.findall(r'__TESTS_START__(.*?)__TESTS_END__', raw, re.S)
data = None
for chunk in candidates:
    try:
        parsed = json.loads(html.unescape(chunk))
    except Exception:  # noqa: BLE001
        continue
    if isinstance(parsed, dict) and 'results' in parsed and 'total' in parsed:
        data = parsed
        break

if data is None:
    print(f'❌ [{case}] 没拿到结果 —— 页面在断言前就崩了')
    for line in re.findall(r'Uncaught[^<]{0,160}', raw)[:5]:
        print('    ', line.strip())
    sys.exit(1)

failed = data['failed']
total = data['total']
partial = bool(data.get('partial'))

if partial:
    print(f"⚠️  [{case}] 页面没跑完就被 dump —— 最后走到「{data.get('stage')}」，"
          f"已完成 {total - failed}/{total} 项")
else:
    print(f"=== [{case}] 通过 {total - failed}/{total}"
          + ('  ✅' if failed == 0 else f"  ❌ {failed} 项失败") + ' ===')

for r in data['results']:
    if 'section' in r:
        print(f"  ── {r['section']}")
    elif not r['pass']:
        print(f"  ❌ {r['name']}" + (f"   → {r['extra']}" if r.get('extra') else ''))

if partial:
    print('     ⓘ 虚拟时间预算耗尽时页面会被直接 dump，不一定是代码问题；先重跑一次看是否复现')

sys.exit(0 if (failed == 0 and not partial) else 1)
