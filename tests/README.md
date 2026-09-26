# 回归测试台

无头 Chrome 驱动的自动化回归，覆盖起始页的正常路径与故障路径。

```bash
./run.sh                 # 跑全部 10 个场景
./run.sh dirty offline   # 只跑指定场景
```

被测源码默认取**本目录的上一级**（即仓库根目录），所以 clone 下来即可直接跑。
需要 Chrome / Chromium 与 `python3`。

## 它是怎么工作的

不是模拟 DOM，而是**驱动真实页面**：

```
临时目录 /tmp/sp-tests/
├── index.html      ← 从被测源码复制，并把样式与三个脚本全部【内联】进去
├── favicon.* / apple-touch-icon.png   ← assets 场景核对引用用
├── assets/         ← 字体与搜索引擎图标
├── img/            ← 现生成的纯黑 / 纯白 PNG，用来验证壁纸明暗采样
├── seed.js         ← 排在 app.js 之前：打桩 fetch / JSONP / 播种 localStorage
└── test.js         ← 排在 app.js 之后：跑断言集，结果写进 DOM 供 dump
```

> 🔴 **必须内联，不能写成 `<script src="/app.js">`。** 测试跑在 `--virtual-time-budget` 下，
> 而 Chrome 的虚拟时钟**不把外部脚本的加载算作 pending 任务**：预算一耗尽就 dump DOM，
> 此时脚本可能还没执行，抓回来的只是一份原始 HTML（时钟还是 `--:--`、热点还是骨架），
> 表现为随机报「页面在断言前就崩了」、且每轮失败的场景都不一样。

`report.py` 再从 `--dump-dom` 的输出里把断言结果抓出来（页面的错误信息本身就构成了断言，
不依赖任何测试框架），全部通过时退出码为 0。`test.js` 是**边跑边写**结果的（心跳），
所以即使页面在中途被 dump，也能看到最后跑到哪个断言、卡在哪一步。

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
| `assets` | 四条图标声明（ICO 七尺寸 / SVG / 1024 PNG / 180 主屏）与内容指纹 |
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
- 🔴 **`navigator.geolocation = {…}` 是静默失败的**：它是 `Navigator.prototype` 上的
  访问器属性（只有 getter），非严格模式下赋值不报错也不生效 —— 测试一直在调真实定位服务，
  快的场景天气正常、慢的场景停在「天气加载中」，表现为每轮失败场景都不同。必须用
  `Object.defineProperty` 打桩；`navigator.permissions.query` 同理。已经加了一条断言
  专门检查「桩是否真的挂上了」。
- 🔴 **别在跑测试的同时并发做别的事**（尤其开别的 Chrome、批量处理图片）：抢 CPU 会把
  `--virtual-time-budget` 的推进拖慢，随机出现「页面在断言前就崩了」。这不是代码问题，
  是环境问题 —— 先独占重跑，别急着改代码。
- 🔴 **`re.subn` 的替换串里反斜杠有转义含义**：内联注入时要把 `</script` 转义成 `<\/script`，
  这个字符串作为**替换串**传给 `re.subn` 会触发 `bad escape \/` 报错。用 lambda 形式的
  替换回调（返回值不做转义处理）就没事。
- **内联后 DOM 里带着 test.js 的源码**：`report.py` 找结果标记时不能只取第一处匹配
  （源码里的模板字面量会先命中），要逐个尝试、取真正能解析成结果对象的那一处。
- 🔴 **验证 CSS 动画时，用两个 `--virtual-time-budget` 各截一张图再比对是无效的**：
  **CSS 动画不随虚拟时钟推进**，实测新旧两版都是 0 差异像素，这个测法什么都测不出来。
  正确做法：页面里 `document.getAnimations()` 全部 `pause()` 后再拨 `currentTime`，读
  `getComputedStyle(el).transform`（以及 `animations.length` / `animationName` 判断动画是否还存在）。
- ⚠️ **拨时刻别选半周期**：180° 旋转对称的图形（比如双向箭头 ⇄）在 0° 与 180° 时像素几乎重合
  （实测只差 8 个像素，会误判成「没动」）。要拨到 **90°**（900ms 周期 → 225ms）才有可量化的差异。
