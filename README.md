# Startpage

Startpage 是一个面向个人浏览器主页场景的网页起始页应用，当前线上地址为：

https://start.abobb.site

它优先面向普通浏览器网页使用，而不是浏览器插件。项目提供时钟、搜索、背景、快速链接、Dock、主题设置、账号、便签、热榜、天气、推荐码和云端数据能力。

<img width="1943" height="1162" alt="截屏2026-06-23 18 15 23" src="https://github.com/user-attachments/assets/a08ef04c-e9c0-4267-ab9b-c4a109c8de6d" />


## 当前定位

- **产品形态**：Vite + Vue 3 + TypeScript 网页应用。
- **前端部署**：Vercel，主域名 `start.abobb.site`。
- **后端 API**：Cloudflare Worker，接口域名 `start-api.abobb.site`。
- **数据库**：Cloudflare D1，数据库名 `start_abobb_site`。
- **邮件验证码**：Resend，通过 Vercel API 路由发送注册/找回验证码。
- **适用场景**：浏览器主页、启动页、个人导航页。

## 已实现功能

- **首页体验**
  - 大号时钟、日期、农历日期。
  - 搜索框和搜索引擎偏好。
  - 线条风格天气控件，放在搜索框上方。
  - 背景图、Bing 壁纸、本地/在线背景配置。
  - 一言展示。

- **账号系统**
  - 邮箱注册、登录、找回密码。
  - 邮件验证码由 Resend 发送。
  - 登录状态保存在本机，账号密码校验走 Cloudflare D1。
  - `abo_bb@qq.com` 是推荐码管理员账号，可以无限生成推荐码。

- **云端数据**
  - 快捷链接 / Dock 数据会按账号保存。
  - 便签 / 待办按账号保存。
  - RSS 订阅源按账号保存。
  - 推荐码、使用状态、邀请统计按账号保存。

- **便签 / 待办**
  - 支持新增、完成/取消完成、删除。
  - 自动清理超过 3 天的便签。
  - 首页右侧抽屉和个人中心都可以查看。

- **热榜**
  - 接入知乎、掘金（本周最热）和 Hacker News 热榜。
  - 通过 Cloudflare Worker 代理聚合热榜接口，避免前端直接依赖第三方响应格式。
  - 官方 API 失效时自动切换到多个公共 RSSHub 实例的 RSS 源兜底。

- **个人中心**
  - 使用和设置页统一的双栏风格。
  - 管理推荐码、便签和订阅源。

- **网页应用体验**
  - 去掉不适合网页主页的浏览器插件入口。
  - 删除主界面书签入口、书签侧栏和无关按钮。
  - 顶部/角落按钮顺序整理为：便签、热榜、设置、登录。

## 数据保存范围

登录后会保存到云端的数据：

- 邮箱账号和密码哈希。
- 快捷链接、分组和 Dock 数据。
- 便签 / 待办内容、完成状态和日期。
- RSS 订阅源。
- 推荐码列表、使用状态和邀请统计。

仍主要保存在本机的数据：

- 大部分主题和布局设置。
- 本地上传背景图。
- 搜索历史。
- 天气缓存。
- 图标缓存。

## 技术架构

```text
start.abobb.site
  └─ Vercel 静态前端
      ├─ web/index.html
      ├─ web/src/main.ts
      └─ entrypoints/newtab/*

start-api.abobb.site
  └─ Cloudflare Worker
      ├─ /auth/register
      ├─ /auth/login
      ├─ /auth/reset
      ├─ /dashboard
      ├─ /dock
      ├─ /notes
      ├─ /rss
      ├─ /hotlist
      └─ /invites

Cloudflare D1
  ├─ users
  ├─ dock_snapshots
  ├─ notes
  ├─ rss_sources
  ├─ widgets
  └─ invite_codes
```

## 关键目录

- `web/index.html`：网页入口 HTML。
- `web/src/main.ts`：网页入口脚本。
- `entrypoints/newtab/App.vue`：主界面根组件。
- `entrypoints/newtab/components/AuthDialog.vue`：登录、注册、找回密码弹窗。
- `entrypoints/newtab/components/PersonalCenterDialog.vue`：个人中心。
- `entrypoints/newtab/components/WidgetsBoard.vue`：便签和热榜抽屉入口。
- `entrypoints/newtab/components/WeatherWidget.vue`：天气控件。
- `entrypoints/newtab/components/QuickLinks`：快捷链接、Dock、Launchpad。
- `shared/cloud/startApi.ts`：前端访问 Cloudflare Worker 的封装。
- `cloudflare/worker.ts`：Cloudflare Worker API。
- `migrations`：Cloudflare D1 数据库迁移。
- `api/auth/code.js`：Vercel 上的邮件验证码接口。
- `api/bing/[...path].js`：Vercel 上的 Bing 壁纸代理。
- `web/shim/extension.ts`：网页环境下的浏览器插件 API 降级层。

## 本地开发

要求：

- Node.js 24+
- pnpm

安装依赖：

```sh
pnpm install
```

启动网页开发环境：

```sh
pnpm dev
```

类型检查：

```sh
pnpm type-check
```

构建网页：

```sh
pnpm build:web
```

预览构建产物：

```sh
pnpm preview:web
```

Lint：

```sh
pnpm lint
```

## 环境变量

前端构建和邮件发送需要这些环境变量：

| 变量 | 用途 |
| --- | --- |
| `VITE_CLOUD_API_URL` | 前端请求的 Cloudflare Worker API 地址，例如 `https://start-api.abobb.site` |
| `RESEND_API_KEY` | Resend API Key |
| `RESEND_FROM` | Resend 发件人，例如 `Startpage <noreply@start.abobb.site>` |

Cloudflare Worker 使用：

| 变量 / 绑定 | 用途 |
| --- | --- |
| `DB` | Cloudflare D1 数据库绑定 |
| `ALLOWED_ORIGIN` | 允许跨域访问的前端域名，当前为 `https://start.abobb.site` |

## Cloudflare D1

创建 D1 数据库：

```sh
pnpm cf:d1:create
```

应用远端迁移：

```sh
pnpm cf:d1:migrate
```

当前迁移：

- `migrations/0001_start_data.sql`：创建用户、Dock 快照、便签、RSS、组件配置和推荐码表。
- `migrations/0002_user_password_hash.sql`：为用户表增加 `password_hash` 字段，用于跨浏览器登录。

## 部署

部署 Cloudflare Worker：

```sh
pnpm cf:deploy
```

部署 Vercel 前端：

```sh
vercel deploy --prod --yes
```

当前线上域名：

- 前端：https://start.abobb.site
- API：https://start-api.abobb.site

## 安全说明

- 当前账号密码以 `SHA-256(email:password)` 形式在前端计算哈希，再将哈希传给 Worker 校验和保存。
- 这能避免明文密码入库，但不是完整的高强度密码存储方案。
- 如果未来开放给更多真实用户，建议迁移到服务端强哈希方案，例如 PBKDF2、bcrypt、scrypt 或 Argon2，并加入每用户随机 salt。
- 邮件验证码用于注册和找回密码，验证码有效期为 10 分钟。

## 项目整理

当前代码按网页应用形态整理，已去掉这些不再需要的入口：

- WXT 浏览器插件构建配置。
- 浏览器插件 background 入口。
- 浏览器插件 popup 入口。
- 浏览器书签侧栏 UI 和入口。
- 快捷链接右键菜单里的“添加到浏览器书签”。
- 左上/角落下载壁纸按钮。
- 与主界面无关的书签设置页入口。

保留的兼容层：

- `web/shim/extension.ts` 仍保留部分浏览器 API 降级实现，因为项目中还有设置、存储、快速链接、图标缓存等模块依赖统一的 `browser` 抽象。
- `shared/settings` 中部分历史 `bookmark` 字段仍保留，用于兼容旧配置迁移，避免旧数据升级失败。

## 致谢与参考

Startpage 是当前仓库维护的独立项目。开发过程中参考或使用了以下开源项目、服务与公开接口：

- **开源参考**：[Redlnn/lemon-new-tab](https://github.com/Redlnn/lemon-new-tab)  
  感谢该项目在起始页交互、设置结构、主题、背景、快速链接和 Dock 等方向提供参考。

- **视觉参考**：[青柠起始页](https://limestart.cn/)  
  感谢其在简洁起始页体验上的视觉启发。

- **壁纸能力**：
  - Bing 每日壁纸接口来源于 Bing 公开页面接口 `HPImageArchive.aspx`。
  - 本地和在线壁纸缓存逻辑参考了相关开源实现思路。

- **热榜来源**：
  - 知乎热榜：官方 API 直取，[VVHan 聚合 API](https://www.vvhan.com/article/zhihu-baidu-weibo-api-kaiyuan) 作最后兜底。
  - 掘金热榜：RSSHub 公共实例的 `/juejin/trending/all/weekly` 路由（本周最热）。
  - Hacker News：[hnrss.org](https://hnrss.org) 官方 RSS 源。
  - 均由 Cloudflare Worker 统一抓取并整理格式，RSS 兜底链自动切换实例。

- **天气来源**：[Open-Meteo](https://open-meteo.com/)  
  天气控件使用 Open-Meteo 的免费天气接口，不需要前端 API Key。

- **邮件来源**：[Resend](https://resend.com/)  
  邮件验证码通过 Resend API 发送。

- **部署与数据来源**：
  - [Vercel](https://vercel.com/)：前端和 Vercel API 路由。
  - [Cloudflare Workers](https://workers.cloudflare.com/)：后端 API。
  - [Cloudflare D1](https://developers.cloudflare.com/d1/)：账号和用户数据。

- **前端技术来源**：
  - [Vue 3](https://vuejs.org/)
  - [Vite](https://vite.dev/)
  - [TypeScript](https://www.typescriptlang.org/)
  - [Element Plus](https://element-plus.org/)
  - [Pinia](https://pinia.vuejs.org/)
  - [VueUse](https://vueuse.org/)
  - [Iconify](https://iconify.design/)
  - [Day.js](https://day.js.org/)

- **自定义资产**：
  - 当前 favicon 和部分图标动效参考由项目所有者提供的设计稿和截图改造。

## License

本项目采用 AGPL-3.0 许可证。请在继续分发、部署或改造时遵守许可证要求。
