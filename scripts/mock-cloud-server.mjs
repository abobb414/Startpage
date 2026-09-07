// 本地 mock 云端服务：静态托管 dist-web + 模拟 startApi 全部接口
// 用法：node scripts/mock-cloud-server.mjs [端口] （默认 4173）
// 任何邮箱/密码/邀请码都可以注册登录，数据保存在内存里。
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.argv[2] || 4173)
const ROOT = new URL('../dist-web', import.meta.url).pathname

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// ---- 内存数据 ----
const notesByEmail = new Map()
let noteSeq = 1

const HOT_TITLES = { zhihu: '知乎热榜', juejin: '掘金热榜', hackernews: 'Hacker News' }
function hotList(type) {
  const base = [
    ['AI 编程助手正在重塑开发者的工作流', '2598 万热度'],
    ['新一代折叠屏手机发布，售价惊喜', '1987 万热度'],
    ['全国多地迎来秋季首个晴好天气', '1502 万热度'],
    ['开源社区年度报告：贡献者创新高', '1233 万热度'],
    ['宇航员完成新一轮太空行走任务', '1098 万热度'],
    ['新能源汽车渗透率再创历史新高', '966 万热度'],
    ['经典游戏重制版官宣回归', '845 万热度'],
    ['量子计算研究取得关键突破', '731 万热度'],
  ]
  return {
    success: true,
    title: HOT_TITLES[type] || '热榜',
    subtitle: 'Mock 数据 · 本地演示',
    updateTime: new Date().toISOString(),
    data: base.map(([title, hot], i) => ({
      index: i + 1,
      title,
      hot,
      url: 'https://example.com/',
    })),
  }
}

const sampleNotes = (email) => {
  if (!notesByEmail.has(email)) {
    const now = Date.now()
    notesByEmail.set(email, [
      {
        id: `n${noteSeq++}`,
        title: '试试点击便签切换完成状态',
        body: '这是一条 mock 便签，点击可以打勾',
        done: 0,
        createdAt: new Date(now - 3600e3).toISOString(),
      },
      {
        id: `n${noteSeq++}`,
        title: '给右下角图标加上形变动画',
        body: 'morphicons 风格：悬停时图标平滑变成另一个',
        done: 1,
        createdAt: new Date(now - 7200e3).toISOString(),
      },
    ])
  }
  return notesByEmail.get(email)
}

function inviteFields() {
  return {
    invites: [
      {
        code: 'DEMO-INVITE-001',
        status: 'active',
        usedCount: 0,
        maxUses: 5,
        createdAt: new Date().toISOString(),
        usedAt: null,
      },
    ],
    invitedCount: 1,
    invitePoints: 10,
    canCreateInvites: true,
  }
}

// ---- 工具 ----
function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

async function serveStatic(res, urlPath) {
  let filePath = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  if (filePath === '/' || filePath === '') filePath = '/index.html'
  const abs = join(ROOT, filePath)
  if (!abs.startsWith(ROOT)) return json(res, { error: 'forbidden' }, 403)
  try {
    const buf = await readFile(abs)
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(buf)
  } catch {
    // SPA fallback
    try {
      const buf = await readFile(join(ROOT, 'index.html'))
      res.writeHead(200, { 'Content-Type': MIME['.html'] })
      res.end(buf)
    } catch {
      json(res, { error: 'notFound' }, 404)
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  // 邮件验证码接口（web 模式 sendAuthCode 会调用）
  if (req.method === 'POST' && path === '/api/auth/code') {
    const body = await readBody(req)
    console.log(`[mock] 验证码已"发送"到 ${body.email}（随便填即可）`)
    return json(res, { ok: true })
  }

  // 认证
  if (req.method === 'POST' && path === '/auth/register') {
    const { email } = await readBody(req)
    console.log(`[mock] 注册 ${email}`)
    return json(res, { ok: true })
  }
  if (req.method === 'POST' && path === '/auth/login') {
    const { email } = await readBody(req)
    console.log(`[mock] 登录 ${email}`)
    return json(res, { ok: true })
  }
  if (req.method === 'POST' && path === '/auth/reset') return json(res, { ok: true })
  if (req.method === 'POST' && path === '/invites/validate') return json(res, { ok: true })
  if (req.method === 'POST' && path === '/invites/consume') return json(res, { ok: true })

  // 数据
  if (req.method === 'GET' && path === '/dashboard') {
    const email = url.searchParams.get('email') || 'demo@local'
    return json(res, {
      notes: sampleNotes(email),
      rssSources: [],
      ...inviteFields(),
    })
  }
  if (req.method === 'GET' && path === '/invites') return json(res, inviteFields())
  if (req.method === 'POST' && path === '/invites') return json(res, { ok: true })
  if (req.method === 'GET' && path === '/hotlist') {
    return json(res, hotList(url.searchParams.get('type') || 'zhihu'))
  }
  if (req.method === 'GET' && path === '/weather') {
    return json(res, {
      success: false,
      city: '',
      cityCode: '',
      temp: 0,
      type: '',
      wind: '',
      humidity: '',
      quality: '',
      updateTime: new Date().toISOString(),
    })
  }
  if (req.method === 'GET' && path === '/dock') return json(res, { data: { items: [], groups: [] } })
  if (req.method === 'PUT' && path === '/dock') return json(res, { ok: true })

  // 便签
  if (req.method === 'POST' && path === '/notes') {
    const { email, body } = await readBody(req)
    const note = {
      id: `n${noteSeq++}`,
      title: body.slice(0, 30),
      body,
      done: 0,
      createdAt: new Date().toISOString(),
    }
    sampleNotes(email).unshift(note)
    return json(res, { note: { id: note.id, title: note.title, body: note.body } })
  }
  const noteMatch = path.match(/^\/notes\/([^/]+)$/)
  if (noteMatch) {
    const id = decodeURIComponent(noteMatch[1])
    if (req.method === 'PATCH') {
      const { email, done } = await readBody(req)
      const note = sampleNotes(email || 'demo@local').find((n) => n.id === id)
      if (note) note.done = done ? 1 : 0
      return json(res, { ok: true })
    }
    if (req.method === 'DELETE') {
      const email = url.searchParams.get('email') || 'demo@local'
      const list = sampleNotes(email)
      const idx = list.findIndex((n) => n.id === id)
      if (idx >= 0) list.splice(idx, 1)
      return json(res, { ok: true })
    }
  }

  // RSS 源
  if (req.method === 'POST' && path === '/rss') {
    const { title, url: rssUrl } = await readBody(req)
    return json(res, { source: { id: `r${noteSeq++}`, title, url: rssUrl } })
  }
  if (req.method === 'DELETE' && path.startsWith('/rss/')) return json(res, { ok: true })

  // 其余全部走静态文件
  await serveStatic(res, path)
})

server.listen(PORT, () => {
  console.log(`[mock] Mock 云端 + 静态服务已启动: http://localhost:${PORT}`)
  console.log('[mock] 任意邮箱 + 任意密码(≥6位) + 任意邀请码均可注册/登录')
})
