# Changelog

本站的所有显著改动都会记录在这个文件里。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 2026-09-30（II）· favicon 源图升级为 icons8 原生 1600px

#### Changed

- **找到并换用原生大尺寸源**：icons8 的图片 CDN 免登录、免 API key，直接可取 1600px ——
  `https://img.icons8.com/pulsar-color/1600/home-page.png`。此前一直用的是网站免费档的 100px，
  1024 那张是插值放大的、发软。
  🔴 **slug 是 `home-page`，不是 `home`**：同一风格下显示名都叫 "Home" 的图标有一串不同 slug，
  `pulsar-color/home` 是灰紫**拱门**，`home-page` 才是浅蓝**带烟囱的房子**。只能靠主色 +
  归一化 bbox + 逐像素比对来认（实测色距 0 / MAE 4.55，而 `home` 是 80 / 37.24）。
- 全套资产改由 1600px 原生源重出，其余参数不变（构图、透明边距原样，七档尺寸档位不变，
  `apple-touch-icon.png` 仍铺 `#f4f6f8` 不透明底）。
- **画质对比（1024 档）**：边缘过渡带宽 **14px → 2px（锐 7×）**，细节梯度（99.5 分位）**15.0 → 47.0**。
  这不是参数差异，是「源图只有 100px」与「源图是 1600px」的本质区别。
- 体积：`favicon.png` 210 → **342 KB**、`favicon.ico` 54 → 79 KB、`favicon.svg` 15 → 23 KB、
  `apple-touch-icon.png` 12 → **8 KB**（原生源边缘更干净，反而压得更小）。

#### 验证

- 各档位（1024 + ICO 七帧 + svg 内嵌）**可见纯白像素均为 0**；`favicon.png` 边缘半透明像素
  `B-R` 中位数 39（浅蓝 105 / 深蓝 42，趋近 0 即为偏白）。
- ICO 七帧尺寸阶梯 `[16,24,32,48,64,128,256]`、逐帧 `RGBA`（IHDR colorType=6）；测试台 10 场景全绿
  （assets 67/67）；`?v=` 指纹由 `bust-cache.py` 重算。

### 2026-09-30 · favicon 换成原始位图的等比放大版

#### Changed

- **图标全套换成原始 100px 位图的等比放大版**：不做矢量化重建、不裁留白、不补正方形、不做调色板量化 —— 原图（内容长边占画布 86%、四边留白原样、透明图层原样）直接等比放大，一份母版出全套：`favicon.png` 1024×1024（RGBA 真彩）、`favicon.ico` 16/24/32/48/64/128/256 七档、`apple-touch-icon.png` 180×180（原图铺满 + `#f4f6f8` 不透明底）、`favicon.svg` 内嵌 128px 位图。
- `favicon.svg` 必须一起换：浏览器对 `<link rel=icon type=image/svg+xml>` 的优先级高于 ICO/PNG，留着旧版等于换了没换。
- 唯一的非纯缩放处理是**透明底的抗锯齿缩放方式**：原图透明区 RGB 是纯黑，直接 LANCZOS 会让抗锯齿边缘向黑插值、放大后出现黑边。做法是 **alpha bleed**（把透明像素的 RGB 用最近的非透明像素颜色填满，再对 RGB 与 alpha 分别缩放）。
- **修复：图形外轮廓的一圈半透明白晕**。初版走的是「alpha 预乘 → LANCZOS → 除回来」，数学上没错，但 LANCZOS 是带负瓣的 sinc 近似核，在「透明 → 图形色」的阶跃处会过冲，过冲值再除以很小的 alpha（`a=9` 时放大 28 倍）会撞上 255 被 clip 成纯白 —— 实测 1024 那张的轮廓整段 RGB 变成 `(255,255,255)`，可见纯白像素 3810 个、最高 alpha 118。浅色底看不出，**深色标签栏上就是一道白线**。改用 alpha bleed 后归零。

#### 验证

- 测试台 10 场景全绿（assets 场景 67/67）；`favicon.png` 回缩到 100px 与原图逐像素比对（RGB MAE 12.6/255，差异集中在边缘抗锯齿）；ICO 七档尺寸阶梯 + 逐帧 RGBA（IHDR colorType=6）断言通过；`?v=` 指纹由 `bust-cache.py` 重算。
- 白晕修复的两条硬验收：① 可见纯白像素（`alpha>30 且 RGB 全 >240`）为 **0 个**；② 边缘半透明像素的 `B-R` 中位数贴近主色（浅蓝 105 / 深蓝 42），趋近 0 即为偏白。
- 修复只动颜色、没动构图：1024 那张的 **alpha 剖面与修复前逐点一致**，图形 bbox 同为 `(67,108)-(957,967)`。
- 体积（真彩不量化的代价）：favicon.png 210 KB、favicon.ico 54 KB、favicon.svg 15 KB、apple-touch-icon.png 12 KB。

### 2026-09-27（II）· 交互统一 + 桌面锁一屏

#### Added

- **桌面端锁一屏**（≥701px）：外壳钉在 `100svh`、纵向 flex、`overflow:hidden`，内容在顶栏与页脚之间以 `justify-content:safe center` 垂直居中 —— 桌面上不再出现页面级滚动条；放不下的便签/热点列表改为**卡片内滚动**（4px 极细滚动条，随主题淡色）。移动端保持自然流式不受影响。另加矮桌面窗口（≤820px 高）压缩档：收紧顶栏留白与字号，小窗/分屏也一屏不滚。

#### Changed

- **每日短句改为随机短句**：50 条文艺短句（≤12 字）每次刷新随机抽一条，`sessionStorage` 记住上一条避免连刷撞句；仍只在启动时抽一次，点「换一张」不会把它换掉。替代原「按日期固定、同一天全设备同句」逻辑，README 同步。
- **hover 反馈统一语言**：换一张 / 热点来源切换 / 清空 / 天气链接 / 页脚署名共 5 处，从「accent 变色」（含暗色模式金色特例）统一改为 `opacity:.75` —— 白字上是比白深一点的灰、黑字上是比黑浅一点的灰，任何壁纸与主题下都不跳色。
- **时钟上下留白均衡**：`h1` 外边距改为 em 单位（`-.02em 0 .14em`），补偿 `line-height:.85` 裁行盒后字迹偏下造成的「上空下挤」，em 随字号缩放，手机小字号同样成立。
- **logo 彻底不可点**：`<a class="brand">` 改为 `<div>`，去掉 `href` 后点击不再刷新页面；`cursor:default`、`user-select:none`，点按无任何视觉反馈。

#### Fixed

- **便签输入框的蓝色框/底**：`autocomplete/autocapitalize/spellcheck` 全关，消除选择历史记录时弹出的浏览器下拉与淡蓝框；再兜一层 `-webkit-autofill` 抹色规则，autofill 不再糊蓝底。
- **桌面页脚挤在中间**：锁一屏后页脚成为 flex 子项，原 `margin:0 auto` 会阻止 stretch、把 `space-between` 的两项缩成内容宽挤到中间 —— 显式 `width:100%` 撑满后左右铺开恢复。

#### 验证

- 本地测试台回归通过；线上 `start.abobb.com` / `start.abobb.site` 首页与本地逐字节一致，带指纹资源 200，锁一屏 / autofill 抹色 / 卡内滚动 / logo div 全部标记在线上生效。

### 2026-09-27 · 壁纸文字可读性重做 + Icons8 图标全套替换

#### Fixed

- **壁纸文字看不清的根修**：字色判定从「亮像素占比 ≥75% 二选一」「WCAG 对比度评分」（当天上过又撤的两版）最终定案为**区域平均亮度二选一** —— 对问候区/页脚真实文字覆盖的壁纸区域求 sRGB 相对亮度平均值，`≥ 0.45` 全部用黑色字、否则全部用白色字（`TONE_SWITCH`）。此前三版算法在中间调、明暗混合照片上都会把字放进错误的色阶。
- 采样带位置始终按「元素此刻在视口里的真实位置」取窗，且坐标系与壁纸层盒子（`fixed + top:-140px + height:calc(100vh+280px)`）对齐，避免 cover 换算错位；采样结果回来时校验仍是当前壁纸，连点「换一张」时迟到的旧采样作废。
- 移动端点按按钮时出现的**半透明圆角矩形选择框**：全局 `-webkit-tap-highlight-color: transparent`，点按瞬间的 `:focus` outline 也一并去掉（键盘操作的 `:focus-visible` 焦点框保留）。

#### Changed

- **文字颜色统一**：一个区域只有一族字色 —— 纯白 `#ffffff` 或中性黑 `#101010`；次要文字（日期、天气行、「daily workspace」、页脚署名）只用同族半透明（如 `rgba(255,255,255,.92/.78)`），清掉全部蓝灰色调（`#e4eff3` / `#c9dbe1` / `#74808b` 这类）。
- **不加任何文字阴影/描边**：此前「明暗混合背景启用细描边」的方案整体移除，可读性完全交给平均亮度判定 + 字色对比。
- **文字适当加粗**：大时钟 500→600、日期 600 / 问候 700、天气行 600、品牌「Start」700、页脚 500。
- **天气图标全套换成 Icons8「SF Regular」风格**（100px PNG，`assets/weather/`）：晴/月/多云白天/多云夜间/阴/雨/雪/雷暴/雾/风共 10 档，`weatherIconKey` 新增 `THUNDER → storm` 档（此前雷暴会错显示成雾）。图标用 CSS `mask + currentColor` 渲染，颜色永远跟文字一族，尺寸 16→20px。
- **主题切换按钮同族化**：内联 morph SVG 换成用户提供的 Icons8 太阳/月亮 PNG（`assets/theme/`），同样 mask + currentColor；按钮颜色跟随 `--wp-top-ink`（之前继承蓝黑 `--ink`，壁纸上不跟字色）；hover 从蓝色 accent 改为透明度变化，focus 焦点框改用 `currentColor`。

#### Tooling

- `tests/`：断言从对比度评分语义改为平均值语义，新增混合背景、CSS 令牌、mask 图标、雷暴映射等用例；**9 场景 541 项断言全绿**。
- `bust-cache.py`：资源清单从写死改为**自动发现 `assets/` 下所有文件**（修复新增 `assets/weather/`、`assets/theme/` 时被静默漏掉、永远拿不到内容指纹的问题），幂等验证通过。
- `.gitignore`：排除 WorkBuddy 本地工作区数据（`.workbuddy/`）。

#### 验证

- 线上 `start.abobb.com` 全量核对通过：首页与全部带指纹资源 200，10 个天气图标 + 2 个主题图标逐项可达。
