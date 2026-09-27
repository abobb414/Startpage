# Changelog

本站的所有显著改动都会记录在这个文件里。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
