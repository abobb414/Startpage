# 回归测试台

无头 Chrome 驱动的自动化回归，覆盖起始页的正常路径与故障路径。

```bash
./run.sh                 # 跑全部 9 个场景
./run.sh dirty offline   # 只跑指定场景
```

被测源码默认取**本目录的上一级**（即仓库根目录），所以 clone 下来即可直接跑。
需要 Chrome / Chromium 与 `python3`。

## 它是怎么工作的

不是模拟 DOM，而是**驱动真实页面**：

```
临时目录 /tmp/sp-tests/
├── index.html      ← 从被测源码复制，并注入下面两个脚本
├── styles.css
├── app.js
├── assets/
├── img/            ← 现生成的纯黑 / 纯白 PNG，用来验证壁纸明暗采样
├── seed.js         ← 插在 app.js 之前：打桩 fetch / JSONP / 播种 localStorage
└── test.js         ← 插在 app.js 之后：跑断言集，结果写进 DOM
```

`report.py` 再从 `--dump-dom` 的输出里把断言结果抓出来（页面的错误信息本身就构成了断言，
不依赖任何测试框架），全部通过时退出码为 0。

## 场景

| 场景 | 覆盖内容 |
|---|---|
| `default` | 首屏正常加载，各模块渲染完整 |
| `cached` | 命中 localStorage 缓存的分支 |
| `dirty` | 存储被写坏（非数组、非数字、非法 URL）时页面不崩 |
| `public` | 自有 API 挂掉 → 公共源降级 |
| `offline` | 完全断网（`--host-resolver-rules` 屏蔽全部域名） |
| `interactive` | 主题切换、引擎切换、便签增删、热点换源、换壁纸 |
| `wpfail` | 壁纸接口失败 → 本地精选池 |
| `picfail` | 壁纸图加载失败 → 提示与重试 |
| `search` | 回车搜索的跳转目标地址正确 |

## 为什么值得写这套东西

因为它测的是真代码，抓到的都是真 bug。首轮基线一口气抓出了 8 个此前一直潜伏的缺陷 ——
其中最严重的一个是：**localStorage 里一个被写坏的 `notes` 键会让便签区抛错，连累后面
所有初始化都不执行**，表现为热点空白、天气永远「加载中」、壁纸不加载。

## 几个踩过的坑

- **`set -u` + bash 3.2**：不能展开空数组，要写成 `${EXTRA[@]+"${EXTRA[@]}"}`
- **heredoc 与管道不能同时喂 stdin**：`echo "$OUT" | python - <<EOF` 拿不到结果，
  改成把 DOM 落到文件、把路径当参数传进去
- **别在工具调用里 `cmd &` 起服务**：调用结束进程就被收走，要用后台任务启动
- **`window.jsonp = ...` 会被 `function jsonp(){}` 覆盖**：函数声明提升会盖掉之前的赋值，
  改为从 `document.head.appendChild` 拦截 script 标签
- **别让测试和应用抢同一张图**：应用自己也在采样壁纸，断言前要先等它落定
- **降级池指向真实 CDN 时不要太早断言**：`virtual-time-budget` 下不保证加载完，要轮询等待
