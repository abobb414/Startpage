/* ==========================================================================
   Start / Daily Workspace — 行为脚本
   --------------------------------------------------------------------------
   结构（按依赖顺序，看上往下读即可）：
     1. 启动时机        滚动位置还原策略
     2. 配置            接口基址 / 数据源 / 壁纸池 / 搜索引擎
     3. 存储层          localStorage 读写 + 脏数据清洗（这一层保证「绝不因存储异常影响页面」）
     4. DOM 引用
     5. 通用工具        日期、带超时的 fetch、JSONP
     6. 时钟与问候
     7. 便签
     8. 搜索
     9. 今日热点        自有 API → 公共源逐级降级
    10. 天气            彩云 JSONP
    11. 壁纸            Unsplash 每日一图 + 明暗自适应
    12. 主题            跟随日出日落 / 手动锁定
    13. 事件绑定与启动
   --------------------------------------------------------------------------
   两条硬规则（历史上踩过坑，改动前先读）：
     · 任何从 localStorage 读出来的东西都必须当成「不可信输入」清洗，
       一个写坏的键曾经让便签区抛错、连累后面所有初始化都不执行。
     · 初始化里的异步任务必须彼此隔离，任何一块挂掉都不能影响其他块。
   ========================================================================== */

/* ---------- 1. 启动时机 ----------
   症状：手机 Safari「刚打开页面、还没滚动」时，底部胶囊工具栏悬在正文文字上。
   根因不是布局，而是 Safari 的滚动位置恢复：起始页标签页一直开着，上次停留在
   热点区，刷新/重开时 Safari 自动滚回原位置，此时底栏处于「收起胶囊」态，
   悬浮在页面内容上方，字就正好被压在工具栏旁边。
   起始页的正确行为是每次都从页首开始：禁用浏览器的滚动恢复（reload 生效），
   bfcache 前进/后退恢复的页面（persisted=true）也强制回页首。
   页首状态下底栏是展开的、占布局空间，内容不可能钻到它底下。 */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
window.addEventListener('pageshow', (e) => { if (e.persisted) window.scrollTo(0, 0); });

/* ---------- 2. 配置 ---------- */

// 自有 API（Cloudflare Worker）。浏览器跨域白名单只放行 start.abobb.com / start.abobb.site，
// 其它来源（本地 127.0.0.1 预览等）会被 CORS 拦下并自动降级到下面的公共源。
const CLOUD_API = 'https://start-api.abobb.site';
const CLOUD_TIMEOUT = 6000;      // 自有 API 排第一，但别让它的慢拖累后面
// 60s API：返回 Access-Control-Allow-Origin: * ，多实例互为备份
const SIXTY_BASES = ['https://60s-api.viki.moe', 'https://60s.7se.cn', 'https://60s.viki.moe'];
// 今日热榜节点（与 tophub 节点 id 一致），会回显请求 Origin，可跨域直连
const CODELIFE_NODE = { zhihu: 'mproPpoq6O', juejin: 'QaqeEaVe9R' };
const CODELIFE_BASE = 'https://api.codelife.cc/api/top/list?lang=cn&id=';

const TREND_ORDER = ['zhihu', 'juejin', 'hackernews'];
const TREND_SOURCES = {
  zhihu: { label: '知乎', homepage: 'https://www.zhihu.com/hot' },
  juejin: { label: '掘金', homepage: 'https://juejin.cn/hot/articles' },
  hackernews: { label: 'Hacker News', homepage: 'https://news.ycombinator.com/' },
};

// 彩云天气（realtime），接口支持 JSONP，静态页面可直连
const CAIYUN_TOKEN = '3U9bhVb0tY08F7zX';
const CAIYUN_SKYCON = {
  CLEAR_DAY: '晴', CLEAR_NIGHT: '晴', PARTLY_CLOUDY_DAY: '多云', PARTLY_CLOUDY_NIGHT: '多云', CLOUDY: '阴',
  LIGHT_HAZE: '轻度雾霾', MODERATE_HAZE: '中度雾霾', HEAVY_HAZE: '重度雾霾',
  LIGHT_RAIN: '小雨', MODERATE_RAIN: '中雨', HEAVY_RAIN: '大雨', STORM_RAIN: '暴雨',
  FOG: '雾', LIGHT_SNOW: '小雪', MODERATE_SNOW: '中雪', HEAVY_SNOW: '大雪', STORM_SNOW: '暴雪',
  DUST: '浮尘', SAND: '沙尘', WIND: '大风',
};
const DEFAULT_COORDS = { lng: 121.4737, lat: 31.2304 };

// 降级壁纸池：全部是 Unsplash 精选。主源是自有 API 的 Unsplash 每日一图（resolveWallpaper），
// 接口不可用、或返回的图「采不了样」时才回落到这里 —— 全站不引入 Unsplash 以外的图源。
const WALLPAPER_FALLBACK = [
  { id: 'photo-1470770841072-f978cf4d019e' },
  { id: 'photo-1506744038136-46273834b3fb' },
  { id: 'photo-1441974231531-c6227db76b6e' },
  { id: 'photo-1469474968028-56623f02e42e' },
  { id: 'photo-1501785888041-af3ef285b470' },
  { id: 'photo-1472214103451-9374bd1c798e' },
  { id: 'photo-1433086966358-54859d0ed716' },
  { id: 'photo-1475924156734-496f6cac6ec1' },
  { id: 'photo-1519681393784-d120267933ba' },
  { id: 'photo-1500530855697-b586d89ba3ee' },
  { id: 'photo-1444927714506-8492d94b4e3d' },
  { id: 'photo-1494548162494-384bba4ab999' },
];

// 搜索引擎官方图标（本地官方资产，来源见 assets/engines/SOURCES.txt）
const ENGINE_ICONS = {
  duckduckgo: '/assets/engines/duckduckgo.png?v=a047a0e9',
  bing: '/assets/engines/bing.svg?v=a457db0f',
  google: '/assets/engines/google.svg?v=ed9087d7',
  baidu: '/assets/engines/baidu.png?v=4999f55a',
};
const ENGINE_LABELS = { duckduckgo: 'DuckDuckGo', bing: 'Bing', google: 'Google', baidu: '百度' };
const engines = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
};
function engineName(key) { return ENGINE_LABELS[key] || key; }
function engineIcon(key) {
  const src = ENGINE_ICONS[key];
  return src ? `<span class="engine-ico"><img src="${src}" alt="" /></span>` : '';
}

/* ---------- 3. 存储层 ----------
   localStorage 在隐私模式、被禁 Cookie、用户手改等情况下都可能抛异常或存着垃圾。
   这一层把所有读写都包起来：读坏了给默认值，写失败就静默放弃（宁可这次不持久化，
   也不能让页面崩在半路）。 */

const STORAGE = {
  notes: 'start-local-notes-v1',
  theme: 'start-local-theme-v1',          // 旧键，仅用于一次性迁移
  themeMode: 'start-local-theme-mode-v1',
  coords: 'start-local-coords-v1',
  engine: 'start-local-engine-v1',
  wallpaper: 'start-local-wallpaper-v2',
  wallpaperOffset: 'start-local-wallpaper-offset-v2',
  trends: 'start-local-trends-v2',
  trendSource: 'start-local-trend-source-v2',
};

function readText(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeText(key, value) { try { localStorage.setItem(key, value); } catch { /* 存不下就算了 */ } }
function readJson(key, fallback) {
  const raw = readText(key);
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { writeText(key, JSON.stringify(value)); }
// 只认数组：存成对象 / 字符串 / null 时一律当空，避免下游 .length / .forEach 直接抛
function readArray(key, shape) {
  const value = readJson(key, null);
  if (!Array.isArray(value)) return [];
  return shape ? value.filter(shape) : value;
}
// 只认有限数字：'abc' / NaN / Infinity 一律回落，避免算进索引变成 NaN
function readNumber(key, fallback) {
  const value = Number(readText(key));
  return Number.isFinite(value) ? value : fallback;
}

/* ---------- 4. DOM 引用 ---------- */

const $ = (selector) => document.querySelector(selector);
const els = {
  root: document.documentElement,
  wallpaper: $('#wallpaper'), wallpaperCaption: $('#wallpaperCaption'), wallpaperRefresh: $('#wallpaperRefresh'),
  themeToggle: $('#themeToggle'), dateLabel: $('#dateLabel'), greeting: $('#greeting'), clock: $('#clock'),
  weatherText: $('#weatherText'), weatherIcon: $('#weatherIcon'), heroNote: $('#heroNote'),
  searchInput: $('#searchInput'), engineToggle: $('#engineToggle'), engineMenu: $('#engineMenu'),
  noteForm: $('#noteForm'), noteInput: $('#noteInput'), notesList: $('#notesList'), noteCount: $('#noteCount'), clearNotes: $('#clearNotes'),
  trendList: $('#trendList'), trendCaption: $('#trendCaption'), sourceSwitch: $('#sourceSwitch'), sourceSwitchLabel: $('#sourceSwitchLabel'),
};

/* ---------- 5. 通用工具 ---------- */

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
async function fetchJson(url, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function jsonp(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const name = `__start_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const done = (fn, payload) => { clearTimeout(timer); delete window[name]; script.remove(); fn(payload); };
    const timer = setTimeout(() => done(reject, new Error('jsonp timeout')), timeout);
    window[name] = (data) => done(resolve, data);
    script.onerror = () => done(reject, new Error('jsonp failed'));
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`;
    document.head.appendChild(script);
  });
}
// 只放行 http(s)：外部接口给回来的链接不能是 javascript: / data: 之类
function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try { const url = new URL(text, location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
}
// 初始化里的异步任务一律从这里跑：任何一块失败都只记一条日志，不连累别人、不产生未捕获拒绝
function runAsync(label, task) {
  Promise.resolve().then(task).catch((error) => console.warn(`[start] ${label} 失败：`, error));
}

/* ---------- 6. 时钟与问候 ---------- */

/* 每日短句：纯日期决定，不依赖任何接口 —— 同一天在所有设备上是同一句。
   ⚠️ 不要掺进壁纸 offset：点「换一张」不该把今天的句子换掉。 */
const HERO_NOTES = [
  '今天也只做三件事',
  '把最难的那件放前面',
  '先喝口水',
  '慢一点，比较快',
  '记得抬头看看天',
  '做完这条就起身走走',
  '一天很长，别急',
  '留一点空白给自己',
  '想不清楚就先写下来',
  '晚上适合做减法',
];
function renderHeroNote() {
  const day = Math.floor(Date.now() / 86400000);
  const total = HERO_NOTES.length;
  els.heroNote.textContent = HERO_NOTES[(((day % total) + total) % total)];
}

// 等宽数字（tnum）为了让四个数字等宽，字形在字身里居中，左边距随首位数字变化：
// Manrope 的 0 / 1 / 2 分别是 186 / 364 / 166（单位 1/2000em）。把它从 margin-left 里扣掉，
// 大字的墨迹才永远压在块左缘 —— 不扣的话，09 点跳到 10 点，整块数字会横移 8.4px。
const CLOCK_LEAD = { '0': '-.093em', '1': '-.182em', '2': '-.083em' };

function updateClock() {
  const now = new Date();
  const hour = now.getHours();
  const hh = String(hour).padStart(2, '0');
  els.clock.textContent = `${hh}:${String(now.getMinutes()).padStart(2, '0')}`;
  els.clock.style.setProperty('--clock-lead', CLOCK_LEAD[hh[0]] || '-.083em');
  els.greeting.textContent = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  els.dateLabel.textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
}

/* ---------- 7. 便签 ---------- */

const NOTE_LIMIT = 12;
let notes = readArray(STORAGE.notes, (note) => note && typeof note.text === 'string');

function renderNotes() {
  els.notesList.innerHTML = '';
  if (!notes.length) {
    els.notesList.innerHTML = '<p class="empty-state">还没有便签，写下今天想记住的事。</p>';
  } else {
    notes.forEach((note) => {
      const row = document.createElement('div');
      row.className = `note-item${note.done ? ' done' : ''}`;
      row.innerHTML = `<button class="toggle-note" type="button" aria-label="${note.done ? '取消完成' : '标记完成'}">${note.done ? '✓' : ''}</button><span></span><button class="remove-note" type="button" aria-label="删除便签">×</button>`;
      row.querySelector('span').textContent = note.text;   // 纯文本，不解析用户输入
      row.querySelector('.toggle-note').addEventListener('click', () => {
        note.done = !note.done;
        writeJson(STORAGE.notes, notes);
        renderNotes();
      });
      row.querySelector('.remove-note').addEventListener('click', () => {
        notes = notes.filter((item) => item.id !== note.id);
        writeJson(STORAGE.notes, notes);
        renderNotes();
      });
      els.notesList.appendChild(row);
    });
  }
  els.noteCount.textContent = String(notes.length);
}
function addNote(event) {
  event.preventDefault();
  const text = els.noteInput.value.trim();
  if (!text) return;
  notes.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, done: false });
  notes = notes.slice(0, NOTE_LIMIT);
  writeJson(STORAGE.notes, notes);
  els.noteInput.value = '';
  renderNotes();
}
function clearNotes() {
  notes = [];
  writeJson(STORAGE.notes, notes);
  renderNotes();
}

/* ---------- 8. 搜索 ---------- */

let engine = ENGINE_LABELS[readText(STORAGE.engine)] ? readText(STORAGE.engine) : 'google';
function setEngine(next) {
  engine = engines[next] ? next : 'google';
  writeText(STORAGE.engine, engine);
  els.engineToggle.innerHTML = `${engineIcon(engine)}<span class="engine-name">${engineName(engine)}</span><span class="chev">⌄</span>`;
  els.engineMenu.hidden = true;
}
function search() {
  const query = els.searchInput.value.trim();
  if (query && engines[engine]) window.location.href = `${engines[engine]}${encodeURIComponent(query)}`;
}

/* ---------- 9. 今日热点：自有 API → 公共源逐级降级 ---------- */

function normalize(item) {
  return {
    title: String(item.title || '').trim(),
    url: safeUrl(item.url || item.link || item.mobileUrl),
    meta: String(item.meta || item.hot || item.hotValue || item.hot_value_desc || '').trim(),
  };
}
function usable(item) { return !!item.title; }

async function fromCloud(kind, timeout = CLOUD_TIMEOUT) {
  const payload = await fetchJson(`${CLOUD_API}/hotlist?type=${encodeURIComponent(kind)}`, timeout);
  if (!Array.isArray(payload?.data) || !payload.data.length) throw new Error('empty');
  return payload.data.map((item) => normalize({ title: item.title, url: item.url || item.mobileUrl, meta: item.hot }));
}
async function zhihuFromSixty() {
  let lastError;
  for (const base of SIXTY_BASES) {
    try {
      const payload = await fetchJson(`${base}/v2/zhihu`);
      const list = Array.isArray(payload?.data) ? payload.data : [];
      const items = list.map((item) => normalize({ title: item.title, url: item.link, meta: item.hot_value_desc })).filter(usable);
      if (!items.length) throw new Error('empty');
      return items;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('unavailable');
}
async function fromCodelife(kind) {
  const payload = await fetchJson(`${CODELIFE_BASE}${CODELIFE_NODE[kind]}`);
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const items = list.map((item) => normalize({ title: item.title, url: item.link, meta: item.hotValue })).filter(usable);
  if (!items.length) throw new Error('empty');
  return items;
}
async function hackerNews() {
  const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!Array.isArray(ids) || !ids.length) throw new Error('empty');
  const items = await Promise.all(ids.slice(0, 10).map(async (id) => {
    try { return await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, 7000); } catch { return null; }
  }));
  const list = items.filter((item) => item?.title).map((item) => {
    const url = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
    let host = 'news.ycombinator.com';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* 保持默认 */ }
    return normalize({ title: item.title, url, meta: host });
  });
  if (!list.length) throw new Error('empty');
  return list;
}

/* 降级顺序：自有 API 打头（Cloudflare 边缘 + 服务端缓存，最快也最稳），
   后面才是公共源。给自有 API 单独设了更短的超时，它慢就早点让位。 */
function providerChain(kind) {
  const cloud = () => fromCloud(kind);
  if (kind === 'zhihu') return [cloud, zhihuFromSixty, () => fromCodelife('zhihu')];
  if (kind === 'juejin') return [cloud, () => fromCodelife('juejin')];
  return [cloud, hackerNews];
}

/* 返回是否真的渲染了内容 —— 空数组是「这个来源没货」，不是异常。
   历史上这里用 throw 当控制流，结果缓存分支上一旦遇到空数组就冒出未捕获异常。 */
function renderTrendItems(items) {
  const list = (Array.isArray(items) ? items : []).filter(usable).slice(0, 5);
  if (!list.length) return false;
  els.trendList.innerHTML = '';
  list.forEach((item, index) => {
    const link = document.createElement('a');
    link.className = 'trend-item';
    // 出口再兜一道协议校验：normalize 已经筛过，但渲染函数不能假设调用方一定清洗过
    link.href = safeUrl(item.url) || TREND_SOURCES[trendSource].homepage;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerHTML = `<span class="trend-index">0${index + 1}</span><span><span class="trend-title"></span><span class="trend-domain"></span></span>`;
    link.querySelector('.trend-title').textContent = item.title;
    link.querySelector('.trend-domain').textContent = item.meta || TREND_SOURCES[trendSource].label;
    els.trendList.appendChild(link);
  });
  return true;
}
function cacheKey(kind) { return `${STORAGE.trends}-${kind}`; }
function readTrendCache(kind) {
  const cache = readJson(cacheKey(kind), null);
  if (!cache || !Array.isArray(cache.items)) return null;
  return { at: Number(cache.at) || 0, items: cache.items };
}

let trendSource = TREND_SOURCES[readText(STORAGE.trendSource)] ? readText(STORAGE.trendSource) : 'zhihu';
let trendsBusy = false;

async function loadTrends() {
  const kind = trendSource;
  const cache = readTrendCache(kind);
  const fresh = cache && Date.now() - cache.at < 15 * 60 * 1000;
  els.trendCaption.textContent = `来源：${TREND_SOURCES[kind].label} · 自动更新`;
  if (fresh && renderTrendItems(cache.items)) return;
  els.trendList.innerHTML = '<div class="loading-line"></div><div class="loading-line short"></div><div class="loading-line"></div>';
  for (const provider of providerChain(kind)) {
    try {
      const items = await provider();
      if (kind !== trendSource) return;            // 期间用户切了来源，这份结果作废
      if (!renderTrendItems(items)) continue;      // 这个来源没货，换下一个
      writeJson(cacheKey(kind), { at: Date.now(), items });
      return;
    } catch { /* 换下一个来源 */ }
  }
  if (cache && renderTrendItems(cache.items)) {
    els.trendCaption.textContent = `来源：${TREND_SOURCES[kind].label} · 显示上次缓存`;
    return;
  }
  els.trendList.innerHTML = `<p class="empty-state">${TREND_SOURCES[kind].label}暂时无法连接。<br><a href="${TREND_SOURCES[kind].homepage}" target="_blank" rel="noopener noreferrer">直接打开来源</a></p>`;
}
function syncSourceSwitch() {
  els.sourceSwitchLabel.textContent = TREND_SOURCES[trendSource].label;
  els.sourceSwitch.title = `切换热点来源（当前：${TREND_SOURCES[trendSource].label}）`;
  els.sourceSwitch.setAttribute('aria-label', `切换热点来源，当前 ${TREND_SOURCES[trendSource].label}`);
  els.sourceSwitch.dataset.busy = String(trendsBusy);
}
async function switchTrendSource() {
  if (trendsBusy) return;
  trendsBusy = true;
  trendSource = TREND_ORDER[(TREND_ORDER.indexOf(trendSource) + 1) % TREND_ORDER.length];
  writeText(STORAGE.trendSource, trendSource);
  syncSourceSwitch();
  try { await loadTrends(); } finally { trendsBusy = false; syncSourceSwitch(); }
}

/* ---------- 10. 天气：彩云天气（JSONP） ---------- */

/* 天气线性图标：24 网格、1.5 线宽、currentColor 描边，与文字同一视觉重量。
   只按彩云 skycon 分档取值，不做动画 —— 起始页上的动效越少越耐看。 */
const WEATHER_ICONS = {
  clearDay: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/></svg>',
  clearNight: '<svg viewBox="0 0 24 24"><path d="M20.4 14.7A8.6 8.6 0 0 1 9.3 3.6a8.7 8.7 0 1 0 11.1 11.1Z"/></svg>',
  cloudyDay: '<svg viewBox="0 0 24 24"><path d="M15.4 5.6l.9-1.7M18.8 7.2l1.8-.6M18.4 10.4l1.7.9"/><path d="M7.2 18.6h9.6a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.1-.5 3.6 3.6 0 0 0-.8 7.5Z"/></svg>',
  cloudyNight: '<svg viewBox="0 0 24 24"><path d="M15.6 4.4a3.4 3.4 0 0 0 4.2 4.4 3.9 3.9 0 0 1-4.2-4.4Z"/><path d="M7.2 19h9.6a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.1-.5 3.6 3.6 0 0 0-.8 7.5Z"/></svg>',
  cloudy: '<svg viewBox="0 0 24 24"><path d="M6.6 15.2h11a3.6 3.6 0 0 0 .3-7.2 4.9 4.9 0 0 0-9.3-.4 3.7 3.7 0 0 0-2 7.6Z"/></svg>',
  rain: '<svg viewBox="0 0 24 24"><path d="M6.6 14.8h11a3.6 3.6 0 0 0 .3-7.2 4.9 4.9 0 0 0-9.3-.4 3.7 3.7 0 0 0-2 7.6Z"/><path d="M8.8 17.4 8.1 19.8M12 17.4 11.3 19.8M15.2 17.4 14.5 19.8"/></svg>',
  snow: '<svg viewBox="0 0 24 24"><path d="M6.6 14.8h11a3.6 3.6 0 0 0 .3-7.2 4.9 4.9 0 0 0-9.3-.4 3.7 3.7 0 0 0-2 7.6Z"/><path d="M9 18.2h.01M12 19.6h.01M15 18.2h.01"/></svg>',
  haze: '<svg viewBox="0 0 24 24"><path d="M4.4 9.6h10.2M7.6 13.2h12M5.6 16.8h9.2"/></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3.6 9.4h9.2a2.6 2.6 0 1 0-2.6-2.6M3.6 14.6h13.2a2.6 2.6 0 1 1-2.6 2.6"/></svg>',
};
function weatherIconKey(skycon) {
  if (!skycon) return 'cloudy';
  const night = String(skycon).endsWith('_NIGHT');
  if (String(skycon).startsWith('CLEAR')) return night ? 'clearNight' : 'clearDay';
  if (String(skycon).startsWith('PARTLY_CLOUDY')) return night ? 'cloudyNight' : 'cloudyDay';
  if (skycon === 'CLOUDY') return 'cloudy';
  if (String(skycon).includes('RAIN')) return 'rain';
  if (String(skycon).includes('SNOW')) return 'snow';
  if (String(skycon).includes('WIND')) return 'wind';
  return 'haze';
}
function setWeatherIcon(skycon) {
  if (!els.weatherIcon) return;
  els.weatherIcon.innerHTML = WEATHER_ICONS[weatherIconKey(skycon)] || WEATHER_ICONS.cloudy;
}

/* 取当前位置。只有「浏览器已经明确拒绝」才静默回落；其余情况都必须真的调一次
   getCurrentPosition —— 旧写法只读 permissions 状态、从不发起请求，首次访问时状态停在
   'prompt'，于是直接返回默认城市坐标：授权框永远不会弹，用户永远拿不到自己的位置。
   返回 null 表示这次没拿到真实位置，由调用方决定怎么回落。 */
async function resolveCoords() {
  if (!navigator.geolocation) return null;
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'denied') return null;   // 已拒绝就别再骚扰，浏览器也会立刻 reject
    }
  } catch { /* 部分浏览器不支持对 geolocation 做 query：忽略，直接去请求 */ }
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,   // 城市级足够（只用来算日出日落），高精度在桌面端容易超时
        timeout: 15000,              // 首次要唤起系统定位服务，6s 太紧
        maximumAge: 10 * 60e3,       // 10 分钟内复用浏览器已有定位，刷新页面秒回
      });
    });
    const { latitude: lat, longitude: lng } = position.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch { return null; }           // 拒绝 / 超时 / 系统定位服务不可用
}
// 定位一次就够：天气与「日出日落自动主题」共用同一个 promise，避免连着申请两次 GPS。
let coordsPending = null;
function resolveCoordsOnce() {
  if (!coordsPending) coordsPending = resolveCoords();
  return coordsPending;
}
// 天气的悬停提示 = 天气正文 + 定位来源。定位结果可能比天气晚到（也可能反过来），
// 所以两者分开存、由这里统一拼装，谁后到都重写一次。
let weatherBody = '';
let geoHint = '';
function writeWeatherTitle() {
  if (!els.weatherText) return;
  if (!weatherBody) els.weatherText.removeAttribute('title');
  else els.weatherText.title = geoHint ? `${weatherBody} · ${geoHint}` : weatherBody;
}
function roundOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
async function loadWeather() {
  try {
    // 实在拿不到定位就退回默认城市（至少还有天气可看），提示里会注明
    const coords = (await resolveCoordsOnce()) || DEFAULT_COORDS;
    const payload = await jsonp(`https://api.caiyunapp.com/v2.6/${CAIYUN_TOKEN}/${coords.lng.toFixed(4)},${coords.lat.toFixed(4)}/realtime.json`);
    const realtime = payload?.result?.realtime;
    const temperature = Number(realtime?.temperature);
    if (!realtime || !Number.isFinite(temperature)) throw new Error('bad payload');
    const label = CAIYUN_SKYCON[realtime.skycon] || '天气平稳';
    const humidity = roundOr(Number(realtime.humidity) * 100, 0);
    const apparent = roundOr(realtime.apparent_temperature ?? temperature, Math.round(temperature));
    els.weatherText.textContent = `${label} ${Math.round(temperature)}°C`;
    weatherBody = `体感 ${apparent}°C · 湿度 ${humidity}% · 彩云天气`;
    writeWeatherTitle();
    setWeatherIcon(realtime.skycon);
  } catch {
    els.weatherText.textContent = '天气未连接';
    if (els.weatherIcon) els.weatherIcon.innerHTML = '';
    weatherBody = '';
    writeWeatherTitle();
  }
}

/* ---------- 11. 壁纸：Unsplash 每日一图（自有 API）→ 本地精选池降级 ----------
   主源走自有 Worker 的 /v2/wallpaper：服务端用 Unsplash 官方 API 取当天一图
   （D1 按日缓存、UTC+8 口径），并带回摄影师署名与原图页链接。 */

// 「换一张」向更早的日期走。API 的 offset 键空间是 [-29, 0]（服务端还会夹紧），
// 走到头绕回今天 —— 键空间有限，随便点也刷不爆配额。
const WALLPAPER_OFFSET_MIN = -29;
const UNSPLASH_HOME = 'https://unsplash.com/?utm_source=abobb_startpage&utm_medium=referral';

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(WALLPAPER_OFFSET_MIN, Math.min(0, Math.round(n)));
}
let wallpaperOffset = clampOffset(readNumber(STORAGE.wallpaperOffset, 0));

function unsplashUrl(id) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=2400&q=85`;
}
/* 这张图能不能被 canvas 采样？（决定文字自动转深/转浅能不能用）
   images.unsplash.com 回 access-control-allow-origin: *，可以；
   picsum 的最终图（fastly.picsum.photos）只给 timing-allow-origin，取像素会被拦 ——
   采样失败时字色会僵在上一张的判定上，暗图配深字就看不见了。
   所以「采不了样的图」在这里一律不采用，改用本地 Unsplash 精选池（同源同为 Unsplash 图）。 */
function isSampleable(url) {
  try { return new URL(url, location.href).hostname === 'images.unsplash.com'; } catch { return false; }
}
function fallbackWallpaper() {
  const dayIndex = Math.floor(Date.now() / 86400000) + wallpaperOffset;
  const total = WALLPAPER_FALLBACK.length;
  const slot = WALLPAPER_FALLBACK[(((dayIndex % total) + total) % total)];
  return { url: unsplashUrl(slot.id), title: 'Unsplash · 每日一图', photoUrl: UNSPLASH_HOME, source: 'unsplash' };
}
async function resolveWallpaper() {
  try {
    const payload = await fetchJson(`${CLOUD_API}/v2/wallpaper?offset=${clampOffset(wallpaperOffset)}`);
    if (payload?.success && isSampleable(payload.url)) {
      return {
        url: payload.url,
        title: `Unsplash · ${payload.author || '每日一图'}`,
        photoUrl: safeUrl(payload.photoUrl) || UNSPLASH_HOME,
        source: payload.source || 'unsplash',
      };
    }
  } catch { /* 落到本地精选池 */ }
  return fallbackWallpaper();
}
function writeWallpaperCaption(item) {
  els.wallpaperCaption.textContent = item.title || 'Unsplash · 每日一图';
  const href = safeUrl(item.photoUrl);
  if (href) els.wallpaperCaption.href = href;
}
function applyWallpaper(item) {
  const image = new Image();
  image.onload = () => {
    els.wallpaper.style.backgroundImage = `url("${item.url}")`;
    writeWallpaperCaption(item);
    writeJson(STORAGE.wallpaper, item);
    sampleWallpaperTone(item.url);
  };
  image.onerror = () => { els.wallpaperCaption.textContent = '壁纸加载失败 · 点击重试'; };
  image.src = item.url;
}

/* 采样壁纸顶部（问候区）与底部（页脚区）平均亮度，自动切换文字深浅
   ⚠️ 三个必须遵守的前提（否则电脑/手机会判出完全相反的字色）：
   ① 裁剪比例要用「当前视口的真实宽高比」。写死 16:9 时，竖屏手机会采到原图中间一条
      横带，跟它实际看到的画面毫无关系。
   ② 采样带位置要用「元素此刻在视口里的真实位置」。问候区在竖屏和横屏下位置差很多，
      写死百分比必然错配。
   ③ 结果回来时要确认「还是当前这张图」。连点换一张 / 旋屏重采都会让两次采样并存，
      迟到的旧结果会把新图的判定覆盖掉。 */
let lastWallpaperUrl = '';
let lastToneRatio = 0;
function sampleWallpaperTone(url) {
  if (url) lastWallpaperUrl = url;
  const target = lastWallpaperUrl;
  if (!target) return;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (target !== lastWallpaperUrl) return;   // 期间换过图，这次结果作废
    try {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const CW = 72;
      const CH = Math.max(8, Math.round((CW * vh) / vw));
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const cover = CW / CH;
      const ratio = image.width / image.height;
      let sx, sy, sw, sh;
      if (ratio > cover) { sh = image.height; sw = sh * cover; sx = (image.width - sw) / 2; sy = 0; }
      else { sw = image.width; sh = sw / cover; sx = 0; sy = (image.height - sh) / 2; }
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, CW, CH);
      const luminance = (y0, y1) => {
        const rowA = Math.max(0, Math.min(CH - 1, Math.floor(y0 * CH)));
        const rowB = Math.max(rowA + 1, Math.min(CH, Math.ceil(y1 * CH)));
        const data = ctx.getImageData(0, rowA, CW, rowB - rowA).data;
        let sum = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n += 1; }
        return sum / n;
      };
      /* 元素位置 -> 视口归一化区间（含少量外扩，避免文字正好压在明暗交界上） */
      const bandOf = (selector, pad, fallback) => {
        const el = document.querySelector(selector);
        if (!el) return fallback;
        const r = el.getBoundingClientRect();
        if (!(r.height > 0)) return fallback;
        const t = Math.max(0, r.top / vh - pad);
        const b = Math.min(1, r.bottom / vh + pad);
        return b - t > 0.02 ? [t, b] : fallback;
      };
      const top = luminance(...bandOf('.hero-block', 0.05, [0.14, 0.52]));
      const bottom = luminance(...bandOf('.bottom-bar', 0.02, [0.6, 1]));
      els.root.classList.toggle('wp-top-dark', top < 132);
      els.root.classList.toggle('wp-top-light', top >= 132);
      els.root.classList.toggle('wp-bottom-dark', bottom < 132);
      els.root.classList.toggle('wp-bottom-light', bottom >= 132);
      lastToneRatio = vw / vh;
    } catch { /* 画布被跨域污染时保持当前深浅，不做切换 */ }
  };
  image.onerror = () => { /* 取不到像素（跨域被拦/图挂了）就保持默认字色 */ };
  image.src = target;
}
/* 旋屏 / 改窗口大小后重新判定：只有宽高比真的变了才重采（手机滚动时地址栏收缩也会触发 resize） */
let toneTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(toneTimer);
  toneTimer = setTimeout(() => {
    const ratio = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    if (!lastToneRatio || Math.abs(ratio - lastToneRatio) / lastToneRatio > 0.02) sampleWallpaperTone();
  }, 220);
});

async function loadWallpaper(step = 0) {
  if (step) {
    // 换一张 = 往更早一天走（offset 负数），走到 -29 绕回今天
    wallpaperOffset = wallpaperOffset <= WALLPAPER_OFFSET_MIN ? 0 : wallpaperOffset - 1;
  } else {
    const cached = readJson(STORAGE.wallpaper, null);
    const usableCache = cached && cached.url && cached.date === dateKey() && clampOffset(cached.offset) === wallpaperOffset;
    if (usableCache) { applyWallpaper(cached); return; }
  }
  writeText(STORAGE.wallpaperOffset, String(wallpaperOffset));
  els.wallpaperCaption.textContent = '壁纸加载中…';
  const item = await resolveWallpaper();
  applyWallpaper({ ...item, date: dateKey(), offset: wallpaperOffset });
}

/* ---------- 12. 主题：默认跟随所在地的日出日落 ---------- */

// 太阳位置算法（SunCalc / NOAA 简化式，纯计算、零网络、零依赖）。
// 传入某天与经纬度，返回当天的日出 / 日落时刻（Date 是真实时刻，按本地时区显示）。
// 极昼极夜无解，用 polar 标记（'day' 全天有日 / 'night' 全天无日）。
const SUN_RAD = Math.PI / 180, SUN_DAY = 86400000, SUN_J1970 = 2440588, SUN_J2000 = 2451545;
function sunTimes(date, lat, lng) {
  const toJulian = (value) => value / SUN_DAY - 0.5 + SUN_J1970;
  const fromJulian = (value) => new Date((value + 0.5 - SUN_J1970) * SUN_DAY);
  const lw = SUN_RAD * -lng, phi = SUN_RAD * lat;
  const d = toJulian(date.getTime()) - SUN_J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = SUN_RAD * (357.5291 + 0.98560028 * ds);
  const C = SUN_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + SUN_RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(SUN_RAD * 23.4397));
  const noon = SUN_J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosH = (Math.sin(SUN_RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const H = Math.acos(cosH) / (2 * Math.PI);
  return { sunrise: fromJulian(noon - H), sunset: fromJulian(noon + H), polar: null };
}

// 主题模式：auto（默认，跟日出日落）/ light / dark（用户点过按钮后锁定）。
// 旧键 STORAGE.theme 里若存着 light / dark，迁移成锁定模式，不丢既有偏好。
let themeMode = (() => {
  const saved = readText(STORAGE.themeMode);
  if (saved === 'auto' || saved === 'light' || saved === 'dark') return saved;
  const legacy = readText(STORAGE.theme);
  return legacy === 'light' || legacy === 'dark' ? legacy : 'auto';
})();

// 坐标优先用 12 小时内的缓存；没有缓存时先用默认城市的坐标「同步」判一次，
// 避免「先白后黑」的闪屏 —— 真实定位由 syncThemeLocation() 异步补上后再重判。
// 只认 src === 'geo' 的缓存：否则一旦写进过默认城市坐标，会被当成有效定位用满 12 小时。
function themeCoords() {
  const cached = readJson(STORAGE.coords, null);
  const fresh = cached && cached.src === 'geo' && Date.now() - Number(cached.t) < 12 * 3600e3;
  return fresh && Number.isFinite(cached.lat) && Number.isFinite(cached.lng) ? cached : DEFAULT_COORDS;
}
// 日出后、日落前算白天，其余算夜晚；晨昏各留 30 分钟缓冲，免得天还没亮屏幕先白。
const SUN_BUFFER = 30 * 60e3;
function autoDark() {
  const { lat, lng } = themeCoords();
  const sun = sunTimes(new Date(), lat, lng);
  if (sun.polar === 'day') return false;
  if (sun.polar === 'night') return true;
  const now = Date.now();
  return now < sun.sunrise.getTime() - SUN_BUFFER || now >= sun.sunset.getTime() + SUN_BUFFER;
}
function applyTheme(dark) {
  els.root.classList.toggle('dark', dark);
  els.themeToggle.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
  els.themeToggle.title = `${dark ? '深色' : '浅色'} · ${themeMode === 'auto' ? '跟随日出日落' : '已手动锁定'}`;

  /* theme-color 同步：iOS Safari 顶/底栏的颜色读这个 meta。
     ⚠️ 两个雷区：
     ① 绝不用「改一下再改回来」的闪烁 hack —— auto 模式下 applyTheme 每分钟都可能被调，
        工具栏会跟着反复闪，这就是「深色模式抽风」的由来；
     ② 值没变就别动 DOM（重建 meta 节点会让 WebKit 重新读一遍工具栏颜色，是没必要的抖动）。 */
  const color = dark ? '#11171d' : '#ffffff';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.content === color) return;
  if (meta) meta.content = color;
  else {
    const created = document.createElement('meta');
    created.name = 'theme-color';
    created.content = color;
    document.head.appendChild(created);
  }
}
function initTheme() {
  applyTheme(themeMode === 'auto' ? autoDark() : themeMode === 'dark');
}
// 真实定位到手后重判一次，并把坐标缓存半天（天气与主题共用同一份）。
// 只有真拿到定位才写缓存：否则会把默认城市坐标当有效值存下来，
// 之后 12 小时内都不会再尝试真定位（这也是「改了定位却一直没变」的另一个坑）。
async function syncThemeLocation() {
  const coords = await resolveCoordsOnce();
  if (coords) {
    writeJson(STORAGE.coords, { lat: coords.lat, lng: coords.lng, t: Date.now(), src: 'geo' });
    geoHint = '按本机定位';
    if (themeMode === 'auto' && autoDark() !== els.root.classList.contains('dark')) applyTheme(autoDark());
  } else {
    geoHint = '未取到定位，按默认城市';
  }
  writeWeatherTitle();
}
// 每分钟检查一次，跨过日出 / 日落就自动切换（纯计算，开销可忽略）
function tickTheme() {
  if (themeMode !== 'auto') return;
  const dark = autoDark();
  if (dark !== els.root.classList.contains('dark')) applyTheme(dark);
}

/* ---------- 13. 事件绑定与启动 ---------- */

els.noteForm.addEventListener('submit', addNote);
els.clearNotes.addEventListener('click', clearNotes);
els.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); });
els.engineToggle.addEventListener('click', () => { els.engineMenu.hidden = !els.engineMenu.hidden; });
els.engineMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-engine]');
  if (button) setEngine(button.dataset.engine);
});
document.addEventListener('click', (event) => { if (!event.target.closest('.search-panel')) els.engineMenu.hidden = true; });
els.sourceSwitch.addEventListener('click', switchTrendSource);
els.wallpaperRefresh.addEventListener('click', () => runAsync('换一张', () => loadWallpaper(1)));
els.themeToggle.addEventListener('click', () => {
  // 手动点一下就锁定，不再跟随日出日落（title 会显示「已手动锁定」）
  themeMode = els.root.classList.contains('dark') ? 'light' : 'dark';
  writeText(STORAGE.themeMode, themeMode);
  applyTheme(themeMode === 'dark');
});

/* 启动：同步的先做完（首屏不该有等待），耗时的并行跑、彼此隔离 ——
   任何一块失败都只影响它自己。 */
initTheme();
setEngine(engine);
syncSourceSwitch();
updateClock();
renderHeroNote();
renderNotes();
// 壁纸明暗类先按「浅底」初始化（默认占位背景是浅色），采样成功后自动纠正
els.root.classList.add('wp-top-light', 'wp-bottom-light');
runAsync('热榜', loadTrends);
runAsync('天气', loadWeather);
runAsync('壁纸', () => loadWallpaper());
runAsync('定位', syncThemeLocation);
setInterval(updateClock, 1000);
setInterval(tickTheme, 60000);
