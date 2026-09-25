const STORAGE = {
  notes: 'start-local-notes-v1',
  theme: 'start-local-theme-v1',
  themeMode: 'start-local-theme-mode-v1',
  coords: 'start-local-coords-v1',
  engine: 'start-local-engine-v1',
  wallpaper: 'start-local-wallpaper-v1',
  wallpaperOffset: 'start-local-wallpaper-offset-v1',
  trends: 'start-local-trends-v2',
  trendSource: 'start-local-trend-source-v2',
};

const $ = (selector) => document.querySelector(selector);
const els = {
  root: document.documentElement,
  wallpaper: $('#wallpaper'), wallpaperCaption: $('#wallpaperCaption'), wallpaperRefresh: $('#wallpaperRefresh'),
  themeToggle: $('#themeToggle'), dateLabel: $('#dateLabel'), greeting: $('#greeting'), clock: $('#clock'), weatherText: $('#weatherText'), weatherIcon: $('#weatherIcon'), heroNote: $('#heroNote'),
  searchInput: $('#searchInput'), engineToggle: $('#engineToggle'), engineMenu: $('#engineMenu'),
  noteForm: $('#noteForm'), noteInput: $('#noteInput'), notesList: $('#notesList'), noteCount: $('#noteCount'), clearNotes: $('#clearNotes'),
  trendList: $('#trendList'), trendCaption: $('#trendCaption'), sourceSwitch: $('#sourceSwitch'), sourceSwitchLabel: $('#sourceSwitchLabel'),
};

/* ---------- 壁纸盒高钉死：修「手机往下滑背景壁纸被放大」 ----------
   壁纸是 position:fixed 的满屏盒、背景走 background-size:cover。手机地址栏收起/展开时，
   fixed 盒的包含块（视口）会变高变矮，cover 就以盒子为基准重新缩放整个画面。
   实测证据：视口 844→780 时盒高 860.9→795.6，差 65.3px —— 滚一下就缩放一次。
   修法两层：
     ① CSS 已把盒高从 `inset:0`（跟着动态视口走）改成恒定的 `height:100vh`
        （经典 vh 在手机上恒等于「地址栏收起」的大视口，不随工具栏变化）；
     ② 这里再把高度钉成具体像素，并【只在宽度变化时重算】：宽度没变 = 只是地址栏在动，一律忽略。
   仅在触屏设备（hover:none）上生效 —— 桌面端窗口纵向缩放必须正常跟随，不能钉死。 */
(function pinWallpaperHeight() {
  if (!window.matchMedia('(hover: none)').matches) return;   // 桌面端交给 CSS 的 100vh，不干预
  const root = document.documentElement;
  const largeViewportHeight = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:-9999px;width:0;height:100vh';
    root.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return Math.round(Math.max(h || 0, window.innerHeight || 0, root.clientHeight || 0));
  };
  let lastWidth = -1;
  const paint = () => {
    if (window.innerWidth === lastWidth) return;             // 纯高度变化 → 地址栏在动，忽略
    lastWidth = window.innerWidth;
    root.style.setProperty('--wp-h', largeViewportHeight() + 'px');
  };
  paint();
  window.addEventListener('resize', paint, { passive: true });
  window.addEventListener('orientationchange', () => { lastWidth = -1; paint(); });
})();

/* ---------- 数据源配置 ---------- */

// 与 GitHub 仓库 abobb414/Startpage 一致的自有 API（Cloudflare Worker），
// 部署在同源白名单下时优先使用；本地 file:// / 127.0.0.1 预览会被 CORS 拦下，自动降级到下面的公共源。
const CLOUD_API = 'https://start-api.abobb.site';
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

// 彩云天气（real-time），接口支持 JSONP，静态页面可直连
const CAIYUN_TOKEN = '3U9bhVb0tY08F7zX';
const CAIYUN_SKYCON = {
  CLEAR_DAY: '晴', CLEAR_NIGHT: '晴', PARTLY_CLOUDY_DAY: '多云', PARTLY_CLOUDY_NIGHT: '多云', CLOUDY: '阴',
  LIGHT_HAZE: '轻度雾霾', MODERATE_HAZE: '中度雾霾', HEAVY_HAZE: '重度雾霾',
  LIGHT_RAIN: '小雨', MODERATE_RAIN: '中雨', HEAVY_RAIN: '大雨', STORM_RAIN: '暴雨',
  FOG: '雾', LIGHT_SNOW: '小雪', MODERATE_SNOW: '中雪', HEAVY_SNOW: '大雪', STORM_SNOW: '暴雪',
  DUST: '浮尘', SAND: '沙尘', WIND: '大风',
};
const DEFAULT_COORDS = { lng: 121.4737, lat: 31.2304 };

// 壁纸池：第 0 位是必应每日一图（每日自动换），其余为 Unsplash 精选，可手动轮换
const WALLPAPER_SLOTS = [
  { source: 'bing' },
  { source: 'unsplash', id: 'photo-1470770841072-f978cf4d019e' },
  { source: 'unsplash', id: 'photo-1506744038136-46273834b3fb' },
  { source: 'unsplash', id: 'photo-1441974231531-c6227db76b6e' },
  { source: 'unsplash', id: 'photo-1469474968028-56623f02e42e' },
  { source: 'unsplash', id: 'photo-1501785888041-af3ef285b470' },
  { source: 'unsplash', id: 'photo-1472214103451-9374bd1c798e' },
  { source: 'unsplash', id: 'photo-1433086966358-54859d0ed716' },
  { source: 'unsplash', id: 'photo-1475924156734-496f6cac6ec1' },
  { source: 'unsplash', id: 'photo-1519681393784-d120267933ba' },
  { source: 'unsplash', id: 'photo-1500530855697-b586d89ba3ee' },
  { source: 'unsplash', id: 'photo-1444927714506-8492d94b4e3d' },
  { source: 'unsplash', id: 'photo-1494548162494-384bba4ab999' },
];

// 搜索引擎官方图标（本地官方资产，来源见 assets/engines/SOURCES.txt）
const ENGINE_ICONS = {
  duckduckgo: '/assets/engines/duckduckgo.png?v=a047a0e9',
  bing: '/assets/engines/bing.svg?v=a457db0f',
  google: '/assets/engines/google.svg?v=ed9087d7',
  baidu: '/assets/engines/baidu.png?v=4999f55a',
};
const ENGINE_LABELS = { duckduckgo: 'DuckDuckGo', bing: 'Bing', google: 'Google', baidu: '百度' };
function engineName(key) { return ENGINE_LABELS[key] || key; }
function engineIcon(key) {
  const src = ENGINE_ICONS[key];
  return src ? `<span class="engine-ico"><img src="${src}" alt="" /></span>` : '';
}
const engines = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
};

let notes = readJson(STORAGE.notes, []);
let engine = localStorage.getItem(STORAGE.engine) || 'google';
let trendSource = TREND_SOURCES[localStorage.getItem(STORAGE.trendSource)] ? localStorage.getItem(STORAGE.trendSource) : 'zhihu';
let wallpaperOffset = Number(localStorage.getItem(STORAGE.wallpaperOffset) || 0);
let trendsBusy = false;

/* ---------- 基础工具 ---------- */

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
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

/* ---------- 时钟 / 便签 / 搜索 ---------- */

/* 每日短句：纯日期决定，不依赖任何接口 —— 同一天在所有设备上是同一句 */
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
  const day = Math.floor(Date.now() / 86400000) + wallpaperOffset;
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
function renderNotes() {
  els.notesList.innerHTML = '';
  if (!notes.length) els.notesList.innerHTML = '<p class="empty-state">还没有便签，写下今天想记住的事。</p>';
  notes.forEach((note) => {
    const row = document.createElement('div');
    row.className = `note-item${note.done ? ' done' : ''}`;
    row.innerHTML = `<button class="toggle-note" type="button" aria-label="${note.done ? '取消完成' : '标记完成'}">${note.done ? '✓' : ''}</button><span></span><button class="remove-note" type="button" aria-label="删除便签">×</button>`;
    row.querySelector('span').textContent = note.text;
    row.querySelector('.toggle-note').addEventListener('click', () => { note.done = !note.done; writeJson(STORAGE.notes, notes); renderNotes(); });
    row.querySelector('.remove-note').addEventListener('click', () => { notes = notes.filter((item) => item.id !== note.id); writeJson(STORAGE.notes, notes); renderNotes(); });
    els.notesList.appendChild(row);
  });
  els.noteCount.textContent = String(notes.length);
}
function addNote(event) {
  event.preventDefault();
  const text = els.noteInput.value.trim();
  if (!text) return;
  notes.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, done: false });
  notes = notes.slice(0, 12);
  writeJson(STORAGE.notes, notes);
  els.noteInput.value = '';
  renderNotes();
}
function setEngine(next) {
  engine = engines[next] ? next : 'google';
  localStorage.setItem(STORAGE.engine, engine);
  els.engineToggle.innerHTML = `${engineIcon(engine)}<span class="engine-name">${engineName(engine)}</span><span class="chev">⌄</span>`;
  els.engineMenu.hidden = true;
}
function search() {
  const query = els.searchInput.value.trim();
  if (query) window.location.href = `${engines[engine]}${encodeURIComponent(query)}`;
}

/* ---------- 今日热点：自有 API → 公共源逐级降级 ---------- */

function normalize(item) {
  return { title: String(item.title || '').trim(), url: item.url || item.link || item.mobileUrl || '', meta: item.meta || item.hot || item.hotValue || item.hot_value_desc || '' };
}

async function fromCloud(kind) {
  const payload = await fetchJson(`${CLOUD_API}/hotlist?type=${encodeURIComponent(kind)}`);
  if (!Array.isArray(payload?.data) || !payload.data.length) throw new Error('empty');
  return payload.data.map((item) => normalize({ title: item.title, url: item.url || item.mobileUrl, meta: item.hot }));
}
async function zhihuFromSixty() {
  let lastError;
  for (const base of SIXTY_BASES) {
    try {
      const payload = await fetchJson(`${base}/v2/zhihu`);
      const list = Array.isArray(payload?.data) ? payload.data : [];
      if (!list.length) throw new Error('empty');
      return list.map((item) => normalize({ title: item.title, url: item.link, meta: item.hot_value_desc }));
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('unavailable');
}
async function fromCodelife(kind) {
  const payload = await fetchJson(`${CODELIFE_BASE}${CODELIFE_NODE[kind]}`);
  const list = Array.isArray(payload?.data) ? payload.data : [];
  if (!list.length) throw new Error('empty');
  return list.map((item) => normalize({ title: item.title, url: item.link, meta: item.hotValue }));
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
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
    return normalize({ title: item.title, url, meta: host });
  });
  if (!list.length) throw new Error('empty');
  return list;
}

function providerChain(kind) {
  if (kind === 'zhihu') return [zhihuFromSixty, () => fromCodelife('zhihu'), () => fromCloud('zhihu')];
  if (kind === 'juejin') return [() => fromCodelife('juejin'), () => fromCloud('juejin')];
  return [hackerNews, () => fromCloud('hackernews')];
}

function renderTrendItems(items) {
  els.trendList.innerHTML = '';
  items.slice(0, 5).forEach((item, index) => {
    const link = document.createElement('a');
    link.className = 'trend-item';
    link.href = item.url || TREND_SOURCES[trendSource].homepage;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerHTML = '<span class="trend-index">0' + (index + 1) + '</span><span><span class="trend-title"></span><span class="trend-domain"></span></span>';
    link.querySelector('.trend-title').textContent = item.title;
    link.querySelector('.trend-domain').textContent = item.meta || TREND_SOURCES[trendSource].label;
    els.trendList.appendChild(link);
  });
  if (!items.length) throw new Error('No items');
}
function cacheKey(kind) { return `${STORAGE.trends}-${kind}`; }

async function loadTrends() {
  const kind = trendSource;
  const cache = readJson(cacheKey(kind), null);
  const fresh = cache && Date.now() - cache.at < 15 * 60 * 1000;
  els.trendCaption.textContent = `来源：${TREND_SOURCES[kind].label} · 自动更新`;
  if (fresh) { renderTrendItems(cache.items); return; }
  els.trendList.innerHTML = '<div class="loading-line"></div><div class="loading-line short"></div><div class="loading-line"></div>';
  for (const provider of providerChain(kind)) {
    try {
      const items = await provider();
      if (kind !== trendSource) return;
      renderTrendItems(items);
      writeJson(cacheKey(kind), { at: Date.now(), items });
      return;
    } catch { /* 尝试下一个来源 */ }
  }
  if (cache?.items?.length) {
    renderTrendItems(cache.items);
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
  syncSourceSwitch();
  trendSource = TREND_ORDER[(TREND_ORDER.indexOf(trendSource) + 1) % TREND_ORDER.length];
  localStorage.setItem(STORAGE.trendSource, trendSource);
  syncSourceSwitch();
  try { await loadTrends(); } finally { trendsBusy = false; syncSourceSwitch(); }
}

/* ---------- 天气：彩云天气（JSONP） ---------- */

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
  const night = skycon.endsWith('_NIGHT');
  if (skycon.startsWith('CLEAR')) return night ? 'clearNight' : 'clearDay';
  if (skycon.startsWith('PARTLY_CLOUDY')) return night ? 'cloudyNight' : 'cloudyDay';
  if (skycon === 'CLOUDY') return 'cloudy';
  if (skycon.includes('RAIN')) return 'rain';
  if (skycon.includes('SNOW')) return 'snow';
  if (skycon.includes('WIND')) return 'wind';
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
async function loadWeather() {
  try {
    // 实在拿不到定位就退回默认城市（至少还有天气可看），提示里会注明
    const coords = (await resolveCoordsOnce()) || DEFAULT_COORDS;
    const payload = await jsonp(`https://api.caiyunapp.com/v2.6/${CAIYUN_TOKEN}/${coords.lng.toFixed(4)},${coords.lat.toFixed(4)}/realtime.json`);
    const realtime = payload?.result?.realtime;
    if (!realtime) throw new Error('bad payload');
    const label = CAIYUN_SKYCON[realtime.skycon] || '天气平稳';
    const humidity = Math.round(Number(realtime.humidity ?? 0) * 100);
    const apparent = Math.round(realtime.apparent_temperature ?? realtime.temperature);
    els.weatherText.textContent = `${label} ${Math.round(realtime.temperature)}°C`;
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

/* ---------- 壁纸：必应每日一图 + Unsplash 精选，按日轮换 ---------- */

function unsplashUrl(id) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=2400&q=85`;
}
function currentSlot() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const total = WALLPAPER_SLOTS.length;
  return WALLPAPER_SLOTS[(((dayIndex + wallpaperOffset) % total) + total) % total];
}
async function resolveSlot(slot) {
  if (slot.source === 'bing') {
    const cache = readJson(`${STORAGE.wallpaper}-bing`, null);
    if (cache?.date === dateKey() && cache.url) return cache;
    for (const base of SIXTY_BASES) {
      try {
        const payload = await fetchJson(`${base}/v2/bing`);
        const image = payload?.data;
        if (!image?.cover) throw new Error('empty');
        const item = { date: dateKey(), url: image.cover_4k || image.cover, title: `必应每日壁纸 · ${image.title || image.headline || '今日一图'}` };
        writeJson(`${STORAGE.wallpaper}-bing`, item);
        return item;
      } catch { /* 尝试下一个实例 */ }
    }
    return { url: unsplashUrl(WALLPAPER_SLOTS[1].id), title: 'Unsplash · 每日一图' };
  }
  return { url: unsplashUrl(slot.id), title: 'Unsplash · 每日一图' };
}
function applyWallpaper(item) {
  const image = new Image();
  image.onload = () => {
    els.wallpaper.style.backgroundImage = `url("${item.url}")`;
    els.wallpaperCaption.textContent = item.title;
    writeJson(STORAGE.wallpaper, item);
    sampleWallpaperTone(item.url);
  };
  image.onerror = () => { els.wallpaperCaption.textContent = '壁纸加载失败 · 点击重试'; };
  image.src = item.url;
}

/* 采样壁纸顶部（问候区）与底部（页脚区）平均亮度，自动切换文字深浅
   ⚠️ 两个必须遵守的前提（否则电脑/手机会判出完全相反的字色）：
   ① 裁剪比例要用「当前视口的真实宽高比」。写死 16:9 时，竖屏手机会采到原图中间一条
      横带，跟它实际看到的画面毫无关系。
   ② 采样带位置要用「元素此刻在视口里的真实位置」。问候区在竖屏和横屏下位置差很多，
      写死百分比必然错配。
   做法：把原图按 cover + 居中裁成一块「与视口同比」的小画布（= 用户眼睛看到的那幅画），
   再在这块画布上按元素位置取带。 */
let lastWallpaperUrl = '';
let lastToneRatio = 0;
function sampleWallpaperTone(url) {
  if (url) lastWallpaperUrl = url;
  if (!lastWallpaperUrl) return;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
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
  image.onerror = () => { /* 跨域失败（如必应图）保持默认 */ };
  image.src = lastWallpaperUrl;
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
    wallpaperOffset += step;
    localStorage.setItem(STORAGE.wallpaperOffset, String(wallpaperOffset));
  } else {
    const cached = readJson(STORAGE.wallpaper, null);
    if (cached?.date === dateKey() && cached.url) { applyWallpaper(cached); return; }
  }
  els.wallpaperCaption.textContent = '壁纸加载中…';
  const slot = currentSlot();
  const item = await resolveSlot(slot);
  applyWallpaper({ ...item, date: dateKey() });
}

/* ---------- 主题：默认跟随所在地的日出日落 ---------- */

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
  const saved = localStorage.getItem(STORAGE.themeMode);
  if (saved === 'auto' || saved === 'light' || saved === 'dark') return saved;
  const legacy = localStorage.getItem(STORAGE.theme);
  return legacy === 'light' || legacy === 'dark' ? legacy : 'auto';
})();

// 坐标优先用 12 小时内的缓存；没有缓存时先用默认城市的坐标「同步」判一次，
// 避免「先白后黑」的闪屏 —— 真实定位由 syncThemeLocation() 异步补上后再重判。
// 只认 src === 'geo' 的缓存：否则一旦写进过默认城市坐标，会被当成有效定位用满 12 小时。
function themeCoords() {
  const cached = readJson(STORAGE.coords, null);
  const fresh = cached && cached.src === 'geo' && Date.now() - cached.t < 12 * 3600e3;
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
    if (themeMode === 'auto') applyTheme(autoDark());
  } else {
    geoHint = '未取到定位，按默认城市';
  }
  writeWeatherTitle();
}

/* ---------- 事件绑定 ---------- */

els.noteForm.addEventListener('submit', addNote);
els.clearNotes.addEventListener('click', () => { notes = []; writeJson(STORAGE.notes, notes); renderNotes(); });
els.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); });
els.engineToggle.addEventListener('click', () => { els.engineMenu.hidden = !els.engineMenu.hidden; });
els.engineMenu.addEventListener('click', (event) => { const button = event.target.closest('[data-engine]'); if (button) setEngine(button.dataset.engine); });
document.addEventListener('click', (event) => { if (!event.target.closest('.search-panel')) els.engineMenu.hidden = true; });
els.sourceSwitch.addEventListener('click', switchTrendSource);
els.wallpaperRefresh.addEventListener('click', () => loadWallpaper(1));
els.themeToggle.addEventListener('click', () => {
  // 手动点一下就锁定，不再跟随日出日落（title 会显示「已手动锁定」）
  themeMode = els.root.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem(STORAGE.themeMode, themeMode);
  applyTheme(themeMode === 'dark');
});

initTheme();
// 定位拿到真实坐标后重判一次主题（首次用的是缓存或默认城市的坐标）；
// 之后每分钟检查一次，跨过日出 / 日落就自动切换。两者都是纯计算，开销可忽略。
syncThemeLocation();
setInterval(() => { if (themeMode === 'auto') applyTheme(autoDark()); }, 60000);
// 壁纸明暗类先按「浅底」初始化（默认占位背景是浅色），采样成功后自动纠正
els.root.classList.add('wp-top-light', 'wp-bottom-light');
setEngine(engine);
syncSourceSwitch();
updateClock();
renderHeroNote();
renderNotes();
loadTrends();
loadWeather();
loadWallpaper();
setInterval(updateClock, 1000);
