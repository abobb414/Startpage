import type { QuickLinksData } from '@/shared/quickLinks/quickLinksStorage'

const env = import.meta.env as Record<string, string | boolean | undefined>
const isWeb = env.WEB === true
const apiBaseUrl = typeof env.VITE_CLOUD_API_URL === 'string' ? env.VITE_CLOUD_API_URL : ''

export interface StartNote {
  id: string
  title: string
  body: string
  done: number | boolean
  position?: number
  createdAt?: string
  updatedAt?: string
}

export interface RssSource {
  id: string
  title: string
  url: string
  position?: number
  createdAt?: string
}

export type HotListKind = 'zhihu' | 'juejin' | 'hackernews'

export interface HotListItem {
  index: number
  title: string
  desc?: string
  hot?: string
  pic?: string
  url: string
  mobileUrl?: string
}

export interface HotListData {
  success: boolean
  title: string
  subtitle?: string
  updateTime?: string
  data: HotListItem[]
}

export interface DomesticWeatherData {
  success: boolean
  city: string
  cityCode: string
  temp: number
  type: string
  wind: string
  humidity?: string
  quality?: string
  updateTime?: string
}

export interface InviteCode {
  code: string
  status: string
  usedCount: number
  maxUses: number
  createdAt?: string
  usedAt?: string | null
}

export interface DashboardData {
  notes: StartNote[]
  rssSources: RssSource[]
  invites: InviteCode[]
  invitedCount: number
  invitePoints: number
  canCreateInvites?: boolean
}

export function isStartCloudEnabled() {
  return isWeb && apiBaseUrl.length > 0
}

function endpoint(path: string) {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isStartCloudEnabled()) {
    throw new Error('cloudUnavailable')
  }

  const response = await fetch(endpoint(path), {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.error || 'cloudRequestFailed')
  }
  return data as T
}

export async function validateInviteCode(email: string, code: string) {
  return request<{ ok: true; firstUser?: boolean }>('/invites/validate', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

export async function consumeInviteCode(email: string, code: string) {
  return request<{ ok: true; firstUser?: boolean }>('/invites/consume', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

export async function registerCloudAccount(email: string, passwordHash: string, inviteCode: string) {
  return request<{ ok: true }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, passwordHash, inviteCode }),
  })
}

export async function loginCloudAccount(email: string, passwordHash: string) {
  return request<{ ok: true }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, passwordHash }),
  })
}

export async function resetCloudAccountPassword(email: string, passwordHash: string) {
  return request<{ ok: true }>('/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ email, passwordHash }),
  })
}

export async function fetchCloudDock(email: string) {
  const params = new URLSearchParams({ email })
  const result = await request<{ data: QuickLinksData }>(`/dock?${params.toString()}`)
  return result.data
}

export async function saveCloudDock(email: string, data: QuickLinksData) {
  return request<{ ok: true }>('/dock', {
    method: 'PUT',
    body: JSON.stringify({ email, data }),
  })
}

export async function fetchDashboard(email: string) {
  const params = new URLSearchParams({ email, t: String(Date.now()) })
  return request<DashboardData>(`/dashboard?${params.toString()}`)
}

export async function fetchInvites(email: string) {
  const params = new URLSearchParams({ email, t: String(Date.now()) })
  return request<Pick<DashboardData, 'invites' | 'invitedCount' | 'invitePoints' | 'canCreateInvites'>>(
    `/invites?${params.toString()}`,
  )
}

export async function fetchHotList(type: HotListKind) {
  const params = new URLSearchParams({ type })
  return request<HotListData>(`/hotlist?${params.toString()}`)
}

export async function fetchDomesticWeather(location?: { latitude: number; longitude: number }) {
  const params = new URLSearchParams()
  if (location) {
    params.set('lat', String(location.latitude))
    params.set('lon', String(location.longitude))
  }
  const qs = params.toString()
  return request<DomesticWeatherData>(`/weather${qs ? `?${qs}` : ''}`)
}

export async function createNote(email: string, body: string) {
  return request<{ note: Pick<StartNote, 'id' | 'title' | 'body'> }>('/notes', {
    method: 'POST',
    body: JSON.stringify({ email, body }),
  })
}

export async function updateNote(email: string, id: string, patch: Partial<StartNote>) {
  return request<{ ok: true }>(`/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ email, ...patch }),
  })
}

export async function deleteNote(email: string, id: string) {
  const params = new URLSearchParams({ email })
  return request<{ ok: true }>(`/notes/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'DELETE',
  })
}

export async function createRssSource(email: string, title: string, url: string) {
  return request<{ source: Pick<RssSource, 'id' | 'title' | 'url'> }>('/rss', {
    method: 'POST',
    body: JSON.stringify({ email, title, url }),
  })
}

export async function deleteRssSource(email: string, id: string) {
  const params = new URLSearchParams({ email })
  return request<{ ok: true }>(`/rss/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'DELETE',
  })
}

export async function createInvite(email: string) {
  return request<{ code: string; invite?: InviteCode }>('/invites', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
