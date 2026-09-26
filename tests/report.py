#!/usr/bin/env python3
"""从 --dump-dom 的输出里抓出测试结果并打印。

用法：report.py <case> <dom-file>
退出码：0 = 全部通过，1 = 有失败项（可直接用于 CI / run.sh 汇总）
"""
import html
import json
import re
import sys

case, path = sys.argv[1], sys.argv[2]
raw = open(path, encoding='utf-8', errors='replace').read()

m = re.search(r'__TESTS_START__(.*?)__TESTS_END__', raw, re.S)
if not m:
    print(f'❌ [{case}] 没拿到结果 —— 页面在断言前就崩了')
    for line in re.findall(r'Uncaught[^<]{0,160}', raw)[:5]:
        print('    ', line.strip())
    sys.exit(1)

try:
    data = json.loads(html.unescape(m.group(1)))
except Exception as error:  # noqa: BLE001
    print(f'❌ [{case}] 结果无法解析：{error}')
    sys.exit(1)

failed = data['failed']
print(f"=== [{case}] 通过 {data['total'] - failed}/{data['total']}"
      + ('  ✅' if failed == 0 else f"  ❌ {failed} 项失败") + ' ===')
for r in data['results']:
    if 'section' in r:
        print(f"  ── {r['section']}")
    elif not r['pass']:
        print(f"  ❌ {r['name']}" + (f"   → {r['extra']}" if r['extra'] else ''))

sys.exit(0 if failed == 0 else 1)
