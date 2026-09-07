export interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

type UserRow = {
  id: string
  email: string
  invite_points: number
  password_hash: string | null
}

type InviteRow = {
  code: string
  status: string
  used_count: number
  max_uses: number
  created_at?: string
  used_at?: string | null
}

type HotListKind = 'zhihu' | 'juejin' | 'hackernews'

type HotListItem = {
  index?: number
  title?: string
  desc?: string
  hot?: string | number
  pic?: string
  url?: string
  mobilUrl?: string
  mobileUrl?: string
  word?: string
  note?: string
  appUrl?: string
  mobil_url?: string
}

type VhanHotListGroup = {
  name?: string
  title?: string
  subtitle?: string
  updateTime?: string
  update_time?: string
  data?: HotListItem[]
}

type OpenMeteoCurrent = {
  temperature_2m?: number
  relative_humidity_2m?: number
  weather_code?: number
  wind_speed_10m?: number
}

type OpenMeteoResponse = {
  current?: OpenMeteoCurrent
  timezone?: string
}

type GeoPayload = {
  city?: string
  locality?: string
  principalSubdivision?: string
}

type OpenStreetMapGeoPayload = {
  address?: {
    city?: string
    region?: string
    state?: string
  }
}

const TEST_INVITE_CODE = 'TEST'
const INVITE_ADMIN_EMAIL = 'abo_bb@qq.com'
const DEFAULT_RSS_SOURCE = {
  title: '聚合热榜',
  url: 'https://api.vvhan.com/api/hotlist?type=zhihu',
}
const jsonHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
  Expires: '0',
  Pragma: 'no-cache',
}

function normalizeEmail(email: unknown) {
  if (typeof email !== 'string') return ''
  return email.trim().toLowerCase()
}

function normalizeInviteCode(code: unknown) {
  if (typeof code !== 'string') return ''
  return code.trim().toUpperCase()
}

function normalizeChinaPlaceName(name: unknown) {
  if (typeof name !== 'string') return ''
  return name
    .trim()
    .replace(/(省|市|自治区|特别行政区|地区|盟|自治州|区|县)$/u, '')
    .replace(/\s+/g, '')
}

function createCorsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigins = (env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const isWildcard = allowedOrigins.includes('*')
  const isAllowed = isWildcard || allowedOrigins.includes(origin)
  const allowOrigin = isAllowed ? origin || '*' : allowedOrigins[0] || '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Start-User',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(request: Request, env: Env, data: JsonValue, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...createCorsHeaders(request, env),
      ...init.headers,
    },
  })
}

async function readJson(request: Request) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

function getEmail(request: Request, url: URL, body?: Record<string, unknown>) {
  return normalizeEmail(body?.email ?? url.searchParams.get('email') ?? request.headers.get('X-Start-User'))
}

function requireEmail(request: Request, env: Env, email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(request, env, { error: 'invalidEmail' }, { status: 400 })
  }
  return null
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length]
  return `START-${suffix}`
}

function canCreateUnlimitedInvites(email: string) {
  return email === INVITE_ADMIN_EMAIL
}

function normalizePasswordHash(hash: unknown) {
  if (typeof hash !== 'string') return ''
  const value = hash.trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(value) ? value : ''
}

async function userCount(env: Env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  return row?.count ?? 0
}

async function getUserByEmail(env: Env, email: string) {
  return env.DB.prepare('SELECT id, email, invite_points, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>()
}

async function cleanupExpiredNotes(env: Env, userId: string) {
  await env.DB.prepare(
    "DELETE FROM notes WHERE user_id = ? AND datetime(created_at) < datetime('now', '-3 days')",
  )
    .bind(userId)
    .run()
}

async function ensureDefaultRssSources(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM rss_sources WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>()
  if ((row?.count ?? 0) > 0) return

  await env.DB.prepare(
    'INSERT INTO rss_sources (id, user_id, title, url, position) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id('rss'), userId, DEFAULT_RSS_SOURCE.title, DEFAULT_RSS_SOURCE.url, 0)
    .run()
}

async function ensureUser(env: Env, email: string, invitedBy?: string | null) {
  const existing = await getUserByEmail(env, email)
  if (existing) return existing

  const user: UserRow = {
    id: id('user'),
    email,
    invite_points: 3,
    password_hash: null,
  }
  await env.DB.prepare(
    'INSERT INTO users (id, email, invited_by, invite_points) VALUES (?, ?, ?, ?)',
  )
    .bind(user.id, user.email, invitedBy ?? null, user.invite_points)
    .run()
  return user
}

async function registerAuth(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const passwordHash = normalizePasswordHash(body.passwordHash)
  if (!passwordHash) return json(request, env, { error: 'weakPassword' }, { status: 400 })

  const existing = await getUserByEmail(env, email)
  if (existing?.password_hash) {
    return json(request, env, { error: 'accountExists' }, { status: 400 })
  }

  let invitedBy: string | null = null
  if (!existing) {
    const code = normalizeInviteCode(body.inviteCode)
    const result = await canUseInvite(env, code)
    if (!result.ok) {
      return json(request, env, { error: result.invite ? 'inviteUsed' : 'inviteInvalid' }, { status: 400 })
    }

    invitedBy = result.invite
      ? (
          await env.DB.prepare('SELECT owner_user_id FROM invite_codes WHERE code = ?')
            .bind(code)
            .first<{ owner_user_id: string | null }>()
        )?.owner_user_id ?? null
      : null

    await ensureUser(env, email, invitedBy)
    if (result.invite) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM invite_codes WHERE code = ?').bind(code),
        env.DB.prepare(
          'UPDATE users SET invite_points = invite_points + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).bind(invitedBy ?? ''),
      ])
    }
  }

  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?')
    .bind(passwordHash, email)
    .run()
  return json(request, env, { ok: true })
}

async function loginAuth(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const passwordHash = normalizePasswordHash(body.passwordHash)
  if (!passwordHash) return json(request, env, { error: 'invalidCredentials' }, { status: 400 })

  const user = await getUserByEmail(env, email)
  if (!user?.password_hash) {
    return json(request, env, { error: 'passwordNotSet' }, { status: 400 })
  }
  if (user.password_hash !== passwordHash) {
    return json(request, env, { error: 'invalidCredentials' }, { status: 400 })
  }

  return json(request, env, { ok: true })
}

async function resetAuth(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const passwordHash = normalizePasswordHash(body.passwordHash)
  if (!passwordHash) return json(request, env, { error: 'weakPassword' }, { status: 400 })

  const user = await getUserByEmail(env, email)
  if (!user) return json(request, env, { error: 'accountNotFound' }, { status: 404 })

  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?')
    .bind(passwordHash, email)
    .run()
  return json(request, env, { ok: true })
}

async function getInvite(env: Env, code: string) {
  return env.DB.prepare(
    'SELECT code, status, used_count, max_uses FROM invite_codes WHERE code = ?',
  )
    .bind(code)
    .first<InviteRow>()
}

async function canUseInvite(env: Env, code: string) {
  const firstUser = (await userCount(env)) === 0
  if (firstUser) return { ok: true, firstUser, invite: null as InviteRow | null }
  if (code === TEST_INVITE_CODE) return { ok: true, firstUser, invite: null as InviteRow | null }

  const invite = await getInvite(env, code)
  const ok = Boolean(invite && invite.status === 'active' && invite.used_count < invite.max_uses)
  return { ok, firstUser, invite }
}

async function validateInvite(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const code = normalizeInviteCode(body.code)
  const result = await canUseInvite(env, code)
  if (!result.ok) {
    return json(request, env, { error: result.invite ? 'inviteUsed' : 'inviteInvalid' }, { status: 400 })
  }
  return json(request, env, { ok: true, firstUser: result.firstUser })
}

async function consumeInvite(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const code = normalizeInviteCode(body.code)
  const result = await canUseInvite(env, code)
  if (!result.ok) {
    return json(request, env, { error: result.invite ? 'inviteUsed' : 'inviteInvalid' }, { status: 400 })
  }

  const owner = result.invite
    ? await env.DB.prepare('SELECT owner_user_id FROM invite_codes WHERE code = ?')
        .bind(code)
        .first<{ owner_user_id: string | null }>()
    : null
  await ensureUser(env, email, owner?.owner_user_id ?? null)

  if (result.invite) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invite_codes WHERE code = ?').bind(code),
      env.DB.prepare(
        'UPDATE users SET invite_points = invite_points + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).bind(owner?.owner_user_id ?? ''),
    ])
  }

  return json(request, env, { ok: true, firstUser: result.firstUser })
}

async function getDock(request: Request, env: Env, url: URL) {
  const email = getEmail(request, url)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  const row = await env.DB.prepare('SELECT data FROM dock_snapshots WHERE user_id = ?')
    .bind(user.id)
    .first<{ data: string }>()
  return json(request, env, {
    data: row?.data ? JSON.parse(row.data) : { items: [], groups: [] },
  })
}

async function putDock(request: Request, env: Env, url: URL) {
  const body = await readJson(request)
  const email = getEmail(request, url, body)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  const data = JSON.stringify(body.data ?? { items: [], groups: [] })
  await env.DB.prepare(
    'INSERT INTO dock_snapshots (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP',
  )
    .bind(user.id, data)
    .run()
  return json(request, env, { ok: true })
}

async function getDashboard(request: Request, env: Env, url: URL) {
  const email = getEmail(request, url)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  await cleanupExpiredNotes(env, user.id)
  await ensureDefaultRssSources(env, user.id)
  const [notes, rssSources, inviteStats] = await Promise.all([
    env.DB.prepare(
      'SELECT id, title, body, done, position, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE user_id = ? ORDER BY position ASC, created_at ASC',
    )
      .bind(user.id)
      .all(),
    env.DB.prepare(
      'SELECT id, title, url, position, created_at AS createdAt FROM rss_sources WHERE user_id = ? ORDER BY position ASC, created_at ASC',
    )
      .bind(user.id)
      .all(),
    env.DB.prepare('SELECT COUNT(*) AS invitedCount FROM users WHERE invited_by = ?')
      .bind(user.id)
      .first<{ invitedCount: number }>(),
  ])

  return json(request, env, {
    notes: notes.results ?? [],
    rssSources: rssSources.results ?? [],
    invites: [],
    invitedCount: inviteStats?.invitedCount ?? 0,
    invitePoints: user.invite_points,
    canCreateInvites: canCreateUnlimitedInvites(email),
  })
}

async function listInvites(request: Request, env: Env, url: URL) {
  const email = getEmail(request, url)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  await env.DB.prepare(
    "DELETE FROM invite_codes WHERE owner_user_id = ? AND (status != 'active' OR used_count >= max_uses)",
  )
    .bind(user.id)
    .run()

  const [invites, inviteStats] = await Promise.all([
    env.DB.prepare(
      "SELECT code, status, used_count AS usedCount, max_uses AS maxUses, created_at AS createdAt, used_at AS usedAt FROM invite_codes WHERE owner_user_id = ? AND status = 'active' AND used_count < max_uses ORDER BY created_at DESC LIMIT 50",
    )
      .bind(user.id)
      .all(),
    env.DB.prepare('SELECT COUNT(*) AS invitedCount FROM users WHERE invited_by = ?')
      .bind(user.id)
      .first<{ invitedCount: number }>(),
  ])

  return json(request, env, {
    invites: invites.results ?? [],
    invitedCount: inviteStats?.invitedCount ?? 0,
    invitePoints: user.invite_points,
    canCreateInvites: canCreateUnlimitedInvites(email),
  })
}

async function createNote(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  await cleanupExpiredNotes(env, user.id)
  const note = {
    id: id('note'),
    title: typeof body.title === 'string' ? body.title.slice(0, 80) : '',
    body: typeof body.body === 'string' ? body.body.slice(0, 2000) : '',
  }
  await env.DB.prepare(
    'INSERT INTO notes (id, user_id, title, body, position) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(note.id, user.id, note.title, note.body, Date.now())
    .run()
  return json(request, env, { note })
}

async function updateNote(request: Request, env: Env, noteId: string) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await getUserByEmail(env, email)
  if (!user) return json(request, env, { error: 'accountNotFound' }, { status: 404 })

  await env.DB.prepare(
    'UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), done = COALESCE(?, done), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
  )
    .bind(
      typeof body.title === 'string' ? body.title.slice(0, 80) : null,
      typeof body.body === 'string' ? body.body.slice(0, 2000) : null,
      typeof body.done === 'boolean' ? (body.done ? 1 : 0) : null,
      noteId,
      user.id,
    )
    .run()
  return json(request, env, { ok: true })
}

async function deleteNote(request: Request, env: Env, url: URL, noteId: string) {
  const email = getEmail(request, url)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await getUserByEmail(env, email)
  if (user) {
    await env.DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(noteId, user.id).run()
  }
  return json(request, env, { ok: true })
}

async function createRss(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!/^https?:\/\//.test(url)) return json(request, env, { error: 'invalidUrl' }, { status: 400 })

  const user = await ensureUser(env, email)
  const source = {
    id: id('rss'),
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 60) : url,
    url: url.slice(0, 500),
  }
  await env.DB.prepare(
    'INSERT INTO rss_sources (id, user_id, title, url, position) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(source.id, user.id, source.title, source.url, Date.now())
    .run()
  return json(request, env, { source })
}

async function deleteRss(request: Request, env: Env, url: URL, sourceId: string) {
  const email = getEmail(request, url)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await getUserByEmail(env, email)
  if (user) {
    await env.DB.prepare('DELETE FROM rss_sources WHERE id = ? AND user_id = ?')
      .bind(sourceId, user.id)
      .run()
  }
  return json(request, env, { ok: true })
}

function normalizeHotListItem(item: HotListItem, index: number) {
  const title = item.title || item.word || item.note || ''
  return {
    index: Number(item.index ?? index + 1),
    title,
    desc: item.desc || '',
    hot: item.hot === undefined ? '' : String(item.hot),
    pic: item.pic || '',
    url: item.url || item.mobileUrl || item.mobilUrl || item.mobil_url || item.appUrl || '',
    mobileUrl: item.mobileUrl || item.mobilUrl || item.mobil_url || item.appUrl || item.url || '',
  }
}

function hotListDisplayName(type: HotListKind) {
  return type === 'zhihu' ? '知乎热榜' : type === 'juejin' ? '掘金热榜' : 'Hacker News'
}

function hotListMatcher(type: HotListKind, group: VhanHotListGroup) {
  // vvhan 仅作为知乎热榜的最后兜底，其余类型直接走 RSS
  return type === 'zhihu' && (group.name || '') === '知乎热榜'
}

async function fetchVhanHotList(type: HotListKind) {
  const upstream = await fetch('https://hot-api.vhan.eu.org/v2?type=all', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'startpage/1.0',
    },
    cf: {
      cacheTtl: 120,
      cacheEverything: true,
    },
  })
  if (!upstream.ok) return null

  const payload = (await upstream.json().catch(() => null)) as { data?: VhanHotListGroup[] } | null
  const group = payload?.data?.find((item) => hotListMatcher(type, item))
  if (!group?.data?.length) return null

  return {
    success: true,
    title: group.name || hotListDisplayName(type),
    subtitle: group.subtitle || '',
    updateTime: group.update_time || '',
    data: group.data.map(normalizeHotListItem).filter((item) => item.title && item.url).slice(0, 30),
  }
}

async function fetchZhihuHotList() {
  const upstream = await fetch('https://api.zhihu.com/topstory/hot-list?limit=50', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'startpage/1.0',
    },
    cf: {
      cacheTtl: 120,
      cacheEverything: true,
    },
  })
  if (!upstream.ok) return null

  const payload = (await upstream.json().catch(() => null)) as {
    data?: Array<{
      target?: { title?: string; url?: string }
      detail_text?: string
    }>
  } | null
  const rows = payload?.data
  if (!rows?.length) return null

  return {
    success: true,
    title: '知乎热榜',
    subtitle: '热门讨论',
    updateTime: new Date().toISOString(),
    data: rows
      .map((item, index) => ({
        index: index + 1,
        title: item.target?.title || '',
        desc: '',
        hot: item.detail_text || '',
        pic: '',
        url: item.target?.url
          ? item.target.url.replace('api.zhihu.com/questions', 'www.zhihu.com/question')
          : '',
        mobileUrl: item.target?.url
          ? item.target.url.replace('api.zhihu.com/questions', 'www.zhihu.com/question')
          : '',
      }))
      .filter((item) => item.title && item.url)
      .slice(0, 30),
  }
}

async function fetchVvhanHotList(type: HotListKind) {
  const upstream = await fetch(`https://api.vvhan.com/api/hotlist?type=${encodeURIComponent(type)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'startpage/1.0',
    },
    cf: {
      cacheTtl: 300,
      cacheEverything: true,
    },
  })
  if (!upstream.ok) return null

  const payload = (await upstream.json().catch(() => null)) as VhanHotListGroup | null
  if (!payload?.data?.length) return null

  return {
    success: true,
    title: payload.title || payload.name || hotListDisplayName(type),
    subtitle: payload.subtitle || '',
    updateTime: payload.updateTime || payload.update_time || new Date().toISOString(),
    data: payload.data.map(normalizeHotListItem).filter((item) => item.title && item.url).slice(0, 30),
  }
}

// ===== RSS 兜底源 =====
// 公共 RSSHub 实例上持续维护的热榜路由，已逐条实测可用性与更新频率（2026-09）。
// 官方 API 取不到时依次尝试；某个实例挂掉会自动切到下一个。
const RSS_HOTLIST_FEEDS: Record<HotListKind, string[]> = {
  zhihu: [
    'https://rsshub.woodland.cafe/zhihu/hot',
    'https://hub.slarker.me/zhihu/hot',
    'https://rss.quickso.cn/zhihu/hot',
  ],
  juejin: [
    'https://rsshub.woodland.cafe/juejin/trending/all/weekly',
    'https://hub.slarker.me/juejin/trending/all/weekly',
    'https://rss.quickso.cn/juejin/trending/all/weekly',
  ],
  hackernews: ['https://hnrss.org/frontpage', 'https://hnrss.org/best'],
}

function decodeXmlText(input: string) {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function extractXmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXmlText(match[1]) : ''
}

function parseRssItems(xml: string) {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || []
  return blocks
    .map((block) => {
      const title = extractXmlTag(block, 'title')
      const link = extractXmlTag(block, 'link') || extractXmlTag(block, 'guid')
      return {
        title,
        desc: '',
        hot: '',
        pic: '',
        url: link,
        mobileUrl: link,
      }
    })
    .filter((item) => item.title && item.url)
}

async function fetchRssHotList(type: HotListKind) {
  for (const feedUrl of RSS_HOTLIST_FEEDS[type]) {
    try {
      const upstream = await fetch(feedUrl, {
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'startpage/1.0',
        },
        cf: {
          cacheTtl: 120,
          cacheEverything: true,
        },
      })
      if (!upstream.ok) continue

      const xml = await upstream.text()
      const items = parseRssItems(xml)
        .map(normalizeHotListItem)
        .filter((item) => item.title && item.url)
        .slice(0, 30)
      if (!items.length) continue

      return {
        success: true,
        title: hotListDisplayName(type),
        subtitle: '',
        updateTime: new Date().toISOString(),
        data: items,
      }
    } catch {
      continue
    }
  }
  return null
}

async function getHotList(request: Request, env: Env, url: URL) {
  const type = url.searchParams.get('type') as HotListKind | null
  if (type !== 'zhihu' && type !== 'juejin' && type !== 'hackernews') {
    return json(request, env, { error: 'invalidHotListType' }, { status: 400 })
  }

  const payload =
    (type === 'zhihu' ? await fetchZhihuHotList() : null) ||
    (await fetchRssHotList(type)) ||
    (type === 'zhihu' ? (await fetchVvhanHotList(type)) || (await fetchVhanHotList(type)) : null)

  if (!payload?.data.length) {
    return json(request, env, { error: 'hotListUnavailable' }, { status: 502 })
  }

  return json(request, env, payload)
}

function getCfLocation(request: Request) {
  const cf = (request as any).cf
  if (!cf) return null
  const lat = Number.parseFloat(cf.latitude)
  const lon = Number.parseFloat(cf.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { latitude: lat, longitude: lon }
}

function parseLatLng(url: URL) {
  const lat = Number.parseFloat(url.searchParams.get('lat') || '')
  const lon = Number.parseFloat(url.searchParams.get('lon') || '')
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { latitude: lat, longitude: lon }
}

function wmoToChinese(code: number): string {
  if (code === 0) return '晴'
  if (code <= 3) return '多云'
  if (code === 45 || code === 48) return '雾'
  if (code <= 57) return '毛毛雨'
  if (code <= 67) return '雨'
  if (code <= 77) return '雪'
  if (code <= 82) return '阵雨'
  if (code <= 86) return '阵雪'
  if (code <= 99) return '雷暴'
  return '晴'
}

function formatWind(kmh: number): string {
  if (kmh < 1) return '无风'
  if (kmh < 6) return '微风'
  if (kmh < 12) return '轻风'
  if (kmh < 20) return '和风'
  if (kmh < 29) return '清风'
  if (kmh < 39) return '强风'
  if (kmh < 50) return '疾风'
  if (kmh < 62) return '大风'
  return '烈风'
}

async function getFallbackLocation(request: Request): Promise<{ lat: number; lon: number; city: string } | null> {
  try {
    const resp = await fetch('http://ip-api.com/json/?lang=zh-CN&fields=lat,lon,city', {
      headers: { 'User-Agent': 'startpage/1.0' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
    if (!resp.ok) return null
    const data = (await resp.json().catch(() => null)) as { lat?: number; lon?: number; city?: string } | null
    if (data?.lat && data?.lon) return { lat: data.lat, lon: data.lon, city: data.city || '' }
    return null
  } catch {
    return null
  }
}

function appendCitySuffix(city: string): string {
  if (!city) return ''
  if (city.endsWith('市') || city.endsWith('区') || city.endsWith('县') || city.endsWith('镇')) return city
  return `${city}市`
}

async function getWeather(request: Request, env: Env, url: URL) {
  // Resolve coordinates: query params → CF IP → ip-api.com fallback
  const queryLoc = parseLatLng(url)
  const cfLoc = queryLoc ? null : getCfLocation(request)
  let latitude = queryLoc?.latitude ?? cfLoc?.latitude
  let longitude = queryLoc?.longitude ?? cfLoc?.longitude
  let ipCity = ''

  if (latitude == null || longitude == null) {
    const fallback = await getFallbackLocation(request)
    if (fallback) {
      latitude = fallback.lat
      longitude = fallback.lon
      ipCity = fallback.city
    }
  }

  if (latitude == null || longitude == null) {
    return json(request, env, { error: 'weatherUnavailable' }, { status: 502 })
  }

  // Fetch weather from Open-Meteo; reverse geocode only when city is unknown
  const weatherPromise = fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
    {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 1800, cacheEverything: true },
    },
  )

  const [weatherResp, geoPayload] = await Promise.all([
    weatherPromise,
    ipCity ? Promise.resolve(null) : reverseGeocode({ latitude, longitude }),
  ])

  if (!weatherResp.ok) {
    return json(request, env, { error: 'weatherUnavailable' }, { status: 502 })
  }

  const weather = (await weatherResp.json().catch(() => null)) as OpenMeteoResponse | null
  const cur = weather?.current
  if (!cur || cur.temperature_2m == null) {
    return json(request, env, { error: 'weatherUnavailable' }, { status: 502 })
  }

  const rawGeoCity = (geoPayload?.city || geoPayload?.locality || '').trim()
  const city = appendCitySuffix(rawGeoCity || ipCity) || '未知'

  const windKmh = cur.wind_speed_10m ?? 0

  return json(request, env, {
    success: true,
    city,
    cityCode: '',
    temp: cur.temperature_2m,
    type: wmoToChinese(cur.weather_code ?? 0),
    wind: formatWind(windKmh),
    humidity: cur.relative_humidity_2m != null ? `${cur.relative_humidity_2m}%` : '',
    quality: '',
    updateTime: new Date().toISOString(),
  })
}

async function reverseGeocode(location: { latitude: number; longitude: number }) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    localityLanguage: 'zh',
  })
  const geo = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'startpage/1.0',
    },
    cf: {
      cacheTtl: 86400,
      cacheEverything: true,
    },
  })
  if (geo.ok) {
    const payload = (await geo.json().catch(() => null)) as GeoPayload | null
    if (payload?.principalSubdivision && (payload.city || payload.locality)) return payload
  }

  const osmParams = new URLSearchParams({
    format: 'jsonv2',
    lat: String(location.latitude),
    lon: String(location.longitude),
    'accept-language': 'zh-CN',
  })
  const osm = await fetch(`https://nominatim.openstreetmap.org/reverse?${osmParams.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Startpage weather widget/1.0 (https://start.abobb.site)',
    },
    cf: {
      cacheTtl: 86400,
      cacheEverything: true,
    },
  })
  if (!osm.ok) return null

  const osmPayload = (await osm.json().catch(() => null)) as OpenStreetMapGeoPayload | null
  const address = osmPayload?.address
  if (!address) return null
  return {
    city: address.city || address.region,
    principalSubdivision: address.state,
  }
}

async function createInvite(request: Request, env: Env) {
  const body = await readJson(request)
  const email = normalizeEmail(body.email)
  const invalidEmail = requireEmail(request, env, email)
  if (invalidEmail) return invalidEmail

  const user = await ensureUser(env, email)
  const unlimitedInvites = canCreateUnlimitedInvites(email)
  if (!unlimitedInvites) {
    return json(request, env, { error: 'inviteForbidden' }, { status: 403 })
  }
  if (!unlimitedInvites && user.invite_points <= 0) {
    return json(request, env, { error: 'inviteQuotaEmpty' }, { status: 400 })
  }

  const code = inviteCode()
  await env.DB.prepare('INSERT INTO invite_codes (code, owner_user_id) VALUES (?, ?)')
    .bind(code, user.id)
    .run()
  return json(request, env, {
    code,
    invite: {
      code,
      status: 'active',
      usedCount: 0,
      maxUses: 1,
      createdAt: new Date().toISOString(),
      usedAt: null,
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: createCorsHeaders(request, env) })
    }

    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (path === '/health') return json(request, env, { ok: true })
      if (path === '/auth/register' && request.method === 'POST') return registerAuth(request, env)
      if (path === '/auth/login' && request.method === 'POST') return loginAuth(request, env)
      if (path === '/auth/reset' && request.method === 'POST') return resetAuth(request, env)
      if (path === '/invites/validate' && request.method === 'POST') return validateInvite(request, env)
      if (path === '/invites/consume' && request.method === 'POST') return consumeInvite(request, env)
      if (path === '/invites' && request.method === 'GET') return listInvites(request, env, url)
      if (path === '/invites' && request.method === 'POST') return createInvite(request, env)
      if (path === '/dock' && request.method === 'GET') return getDock(request, env, url)
      if (path === '/dock' && request.method === 'PUT') return putDock(request, env, url)
      if (path === '/dashboard' && request.method === 'GET') return getDashboard(request, env, url)
      if (path === '/hotlist' && request.method === 'GET') return getHotList(request, env, url)
      if (path === '/weather' && request.method === 'GET') return getWeather(request, env, url)
      if (path === '/notes' && request.method === 'POST') return createNote(request, env)
      if (path.startsWith('/notes/') && request.method === 'PATCH') {
        return updateNote(request, env, path.split('/')[2] || '')
      }
      if (path.startsWith('/notes/') && request.method === 'DELETE') {
        return deleteNote(request, env, url, path.split('/')[2] || '')
      }
      if (path === '/rss' && request.method === 'POST') return createRss(request, env)
      if (path.startsWith('/rss/') && request.method === 'DELETE') {
        return deleteRss(request, env, url, path.split('/')[2] || '')
      }
      return json(request, env, { error: 'notFound' }, { status: 404 })
    } catch (error) {
      console.error(error)
      return json(request, env, { error: 'serverError' }, { status: 500 })
    }
  },
}
