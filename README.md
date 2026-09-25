# Startpage

个人起始页 / 新标签页。**纯静态，无构建步骤**，直接由静态文件构成。

线上地址：<https://start.abobb.com/>

## 目录结构

```
index.html              页面结构
styles.css              样式（浅色/深色主题、移动端断点）
app.js                  交互逻辑（时钟 / 天气 / 热榜 / 便签 / 搜索 / 主题切换）
assets/fonts/           自托管字体（Manrope、DM Mono）
assets/engines/         搜索引擎图标 + 来源说明 SOURCES.txt
assets/brand-home.png   主视觉图
favicon.ico / .png      站点图标（16/32/48 三帧）
favicon.svg             站点图标，含深浅色自适应
apple-touch-icon.png    iOS 主屏图标
robots.txt
```

## 本地预览

`file://` 下热榜接口会因 CORS 失败，请起一个静态服务：

```bash
python3 -m http.server 8931 --bind 127.0.0.1
# 打开 http://127.0.0.1:8931/
```

## 部署

Vercel 项目 `startpage`（纯静态：framework / buildCommand / installCommand / outputDirectory 全部为空），
在本目录执行 `vercel deploy --prod` 即可。

两个入口指向同一份部署：

| 域名 | 链路 |
|---|---|
| `start.abobb.site` | 项目域名，直连 Vercel |
| `start.abobb.com` | 经 Cloudflare Worker `abobb-vercel-proxy` 反代到 `start.abobb.site` |

## ⚠️ 改完必须更新内容指纹

`index.html` 里对 `styles.css`、`app.js`、`assets/**`、favicon 的引用都带 `?v=<内容哈希前 8 位>`。
**改动这些文件后如果不同步更新 `?v=`，访客会继续命中旧缓存，表现为「改了但线上没生效」。**

```bash
# 逐个算哈希并替换（幂等）
for f in app.js styles.css assets/brand-home.png; do
  printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -c1-8)" "$f"
done
# 然后按新哈希更新 index.html / styles.css / app.js 里的 ?v= 值
```

## 缓存策略

两个 Cloudflare zone（`abobb.com` / `abobb.site`）的「浏览器缓存 TTL」已设为 **0（遵循现有请求头）**，
静态资源下发 `max-age=0, must-revalidate`，配合上面的内容指纹可即时生效，无需访客强刷。

## 许可

`LICENSE` 为 **AGPL-3.0**，沿用自本项目前身（原 Vue / 浏览器扩展项目）。
本仓库的页面结构与样式由该项目构建产物改写而来，许可证一并保留。
