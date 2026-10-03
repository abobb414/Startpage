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
/* 坐标的获取顺序：① 浏览器定位（最准，需要授权）→ ② IP 定位（无需授权，城市级）
   → ③ 下面这个默认城市（兜底）。
   ⚠️ IP 定位**必须用国内可直连的接口**。很多用户（包括本项目这台机器）把境外流量交给
   代理，境外 IP 接口只会看到代理出口的国家 —— 拿那个坐标算日出日落，等于按另一个
   半球的时间切主题。所以这里挑的是境内直连、且带 CORS 的接口，并配一道时区自检
   （见 ipPlaceFromPayload）：时区在中文区、IP 却说在境外，一律不采信。 */
const IP_GEO_API = 'https://api.mir6.com/api/ip?type=json';
const IP_GEO_TIMEOUT = 5000;
// 城市名 → 经纬度：复用天气那个彩云 token。该接口不支持 CORS（带 Origin 直接 403），只能走 JSONP。
const CAIYUN_PLACE = 'https://api.caiyunapp.com/v2/place';
// 中文区时区 / 国家代码，用于「IP 归属地与浏览器时区是否自洽」的校验
const ZH_TIMEZONES = ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Kashgar', 'PRC', 'Asia/Macau', 'Asia/Hong_Kong', 'Asia/Taipei'];
const ZH_COUNTRIES = ['CN', 'HK', 'MO', 'TW'];
const DEFAULT_COORDS = { lng: 121.4737, lat: 31.2304, src: 'default', label: '默认城市' };

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
  duckduckgo: '/assets/engines/duckduckgo.svg?v=a96b9590',
  bing: '/assets/engines/bing.svg?v=a457db0f',
  google: '/assets/engines/google.svg?v=ed9087d7',
  baidu: '/assets/engines/baidu.svg?v=3e022421',
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
  theme: 'start-local-theme-v1',          // 旧键：只用于清理（主题不再持久化）
  themeMode: 'start-local-theme-mode-v1', // 旧键：只用于清理（同上）
  coords: 'start-local-coords-v1',
  engine: 'start-local-engine-v1',
  wallpaper: 'start-local-wallpaper-v2',
  wallpaperOffset: 'start-local-wallpaper-offset-v2',
  trends: 'start-local-trends-v2',
  trendSource: 'start-local-trend-source-v2',
};

function readText(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeText(key, value) { try { localStorage.setItem(key, value); } catch { /* 存不下就算了 */ } }
function removeText(key) { try { localStorage.removeItem(key); } catch { /* 删不掉就算了 */ } }
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

/* 每次刷新随机短句：50 条文艺短句里随机抽一条。sessionStorage 记住上一条，
   避免连续两次刷新撞到同一句。纯本地，不依赖任何接口；
   只在启动时抽一次 —— 点「换一张」不会把它换掉。 */
const HERO_NOTES = [
  '慢一点，比较快',
  '今天也只做三件事',
  '把最难的那件放前面',
  '先喝口水',
  '记得抬头看看天',
  '做完这条就起身走走',
  '一天很长，别急',
  '留一点空白给自己',
  '想不清楚就先写下来',
  '晚上适合做减法',
  '风很温柔，你也是',
  '太阳落了还有月亮',
  '今天的云很好看',
  '日子是过出来的',
  '别和昨天较劲',
  '心事放一放，先吃饭',
  '走慢点，路还长',
  '好事多磨，不急这一时',
  '有缝隙，才有光',
  '心里有点光，就不怕晚',
  '看世界，也找自己',
  '认真生活的人不慌张',
  '烦恼多半是想象出来的',
  '今天的风值得出门',
  '光会落在你身上',
  '一切都会过去，包括今天',
  '深呼吸，然后继续',
  '与其焦虑，不如动手',
  '累了就休息，不是放弃',
  '少刷一点，多睡一点',
  '世界很大，先睡个好觉',
  '平凡的一天也值得纪念',
  '把日子过成喜欢的样子',
  '你已经很努力了',
  '允许一切如其所是',
  '开心最重要，别的再说',
  '早点睡，明天会亮',
  '保持热爱，奔赴山海',
  '心情不好就去晒太阳',
  '微小的事也值得认真',
  '别急，花开有时',
  '窗外的天空免费看',
  '情绪没有对错',
  '简单一点，再简单一点',
  '快乐是攒出来的',
  '睡前原谅一切',
  '醒来便是新生',
  '一杯热茶救一个下午',
  '安静也是一种回答',
  '今天的你辛苦了',
];
function renderHeroNote() {
  let last = '';
  try { last = sessionStorage.getItem('sp:lastHeroNote') || ''; } catch (_) { /* 隐私模式等场景下不可用，退化为纯随机 */ }
  let note = last;
  while (note === last) note = HERO_NOTES[Math.floor(Math.random() * HERO_NOTES.length)];
  try { sessionStorage.setItem('sp:lastHeroNote', note); } catch (_) { /* 同上，失败不影响显示 */ }
  els.heroNote.textContent = note;
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

/* 天气图标：Icons8「SF Regular」风格 PNG（assets/weather/，100px，用户 2026-09-27 提供/指定）。
   用 CSS mask 渲染成 currentColor —— 图标颜色永远跟文字一族（纯白或纯黑），
   尺寸由 .weather-ico 控制（20px）。只按彩云 skycon 分档取值，不做动画。
   版本号由 bust-cache.py 维护；新图标先放 assets/weather/ 再跑一遍脚本。 */
const WEATHER_ICONS = {
  clearDay: '/assets/weather/sun.png?v=cb3b9a5f',
  clearNight: '/assets/weather/moon.png?v=f46fa0d1',
  cloudyDay: '/assets/weather/partly-cloudy-day.png?v=540a4528',
  cloudyNight: '/assets/weather/partly-cloudy-night.png?v=d29d4c08',
  cloudy: '/assets/weather/cloud.png?v=f8d90f07',
  rain: '/assets/weather/rain.png?v=e2eb8336',
  snow: '/assets/weather/snow.png?v=4ccccd1c',
  storm: '/assets/weather/storm.png?v=62b1902a',
  haze: '/assets/weather/fog-day.png?v=35ca5b72',
  wind: '/assets/weather/wind.png?v=14154a30',
};
function weatherIconKey(skycon) {
  if (!skycon) return 'cloudy';
  const night = String(skycon).endsWith('_NIGHT');
  if (String(skycon).startsWith('CLEAR')) return night ? 'clearNight' : 'clearDay';
  if (String(skycon).startsWith('PARTLY_CLOUDY')) return night ? 'cloudyNight' : 'cloudyDay';
  if (skycon === 'CLOUDY') return 'cloudy';
  if (String(skycon).includes('THUNDER')) return 'storm';
  if (String(skycon).includes('RAIN')) return 'rain';
  if (String(skycon).includes('SNOW')) return 'snow';
  if (String(skycon).includes('WIND')) return 'wind';
  return 'haze';
}
function setWeatherIcon(skycon) {
  if (!els.weatherIcon) return;
  const url = WEATHER_ICONS[weatherIconKey(skycon)] || WEATHER_ICONS.cloudy;
  els.weatherIcon.style.webkitMaskImage = `url("${url}")`;
  els.weatherIcon.style.maskImage = `url("${url}")`;
}

/* 取当前位置。只有「浏览器已经明确拒绝」才静默回落；其余情况都必须真的调一次
   getCurrentPosition —— 旧写法只读 permissions 状态、从不发起请求，首次访问时状态停在
   'prompt'，于是直接返回默认城市坐标：授权框永远不会弹，用户永远拿不到自己的位置。
   返回 null 表示这次没拿到真实位置，由调用方决定怎么回落。 */
async function gpsCoords() {
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

/* IP 定位第 ① 步：解析接口返回的省 / 市，并做「时区 ↔ IP 归属地」自检（纯函数，便于测试）。
   返回 null 有两种原因：接口没给出城市，或两者互相矛盾 —— 后者说明浏览器的出口被代理到了
   境外（本机默认网关就是 OpenClash，境外流量走日本），此时坐标是代理所在地，绝不能采用。 */
function ipPlaceFromPayload(payload, timeZone) {
  const data = payload && payload.data;
  const city = String((data && data.city) || '').trim();
  if (!city) return null;
  const country = String((data && data.countryCode) || '').toUpperCase();
  if (ZH_TIMEZONES.includes(timeZone) && country && !ZH_COUNTRIES.includes(country)) return null;
  return { city, label: `${String((data.province) || '').trim()}${city}` };
}
/* IP 定位第 ② 步：城市名 → 经纬度（彩云 place，JSONP）。任何一步失败都返回 null，
   由调用方回落到默认城市 —— 宁可用兜底坐标，也不能拿一个错城市的时刻去切主题。 */
async function ipCoords() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const place = ipPlaceFromPayload(await fetchJson(IP_GEO_API, IP_GEO_TIMEOUT), timeZone);
  if (!place) return null;
  const payload = await jsonp(
    `${CAIYUN_PLACE}?query=${encodeURIComponent(place.city.replace(/市$/, ''))}&token=${CAIYUN_TOKEN}&lang=zh_CN`,
    6000,
  );
  const hit = payload && Array.isArray(payload.places) && payload.places[0];
  const lat = Number(hit && hit.location && hit.location.lat);
  const lng = Number(hit && hit.location && hit.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, src: 'ip', label: place.label };
}

/* 浏览器定位优先，失败再退到 IP 定位。返回值带上来源与地名，供提示文案区分
   「按本机定位 / 按 IP 定位（山西省阳泉市）/ 默认城市」。
   IP 结果先查 12 小时内的缓存：浏览器定位每次刷新都会问（浏览器自己有 maximumAge），
   而 IP 接口没必要同一台设备一天问好几遍 —— 不给定位授权的手机上这是每次加载的两个请求。 */
async function resolveCoords() {
  const gps = await gpsCoords();
  if (gps) return { ...gps, src: 'geo', label: '本机定位' };
  const cached = readJson(STORAGE.coords, null);
  const reusable = cached && cached.src === 'ip'
    && Date.now() - Number(cached.t) < 12 * 3600e3
    && Number.isFinite(cached.lat) && Number.isFinite(cached.lng);
  if (reusable) return cached;
  try { return await ipCoords(); } catch { return null; }
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
    if (els.weatherIcon) {
      els.weatherIcon.innerHTML = '';
      els.weatherIcon.style.webkitMaskImage = '';
      els.weatherIcon.style.maskImage = '';
    }
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

/* 采样壁纸顶部（问候区）与底部（页脚区）的平均亮度，自动选择文字色
   ⚠️ 四个必须遵守的前提（否则电脑/手机会判出完全相反的字色）：
   ① 采样坐标系必须与「壁纸层这个盒子」对齐，不是视口。壁纸层是
      position:fixed + top:-140px + height:calc(100vh + 280px)，比视口高一截，
      CSS 的 cover 是按这个盒子算的。以前这里拿视口宽高比去做 cover，两套坐标系
      错开一百多像素 —— 问候区明明压在深蓝浪头上，却采到了旁边的米色亮区，
      判成浅底，深色字直接看不见。
   ② 采样带位置要用「元素此刻在视口里的真实位置」。问候区在竖屏和横屏下位置差很多，
      写死百分比必然错配。
   ③ 横向要收窄到「文字真正占据的那一段」。块级元素的 getBoundingClientRect 给的是
      整栏容器宽度（撑满 1030px），得用 Range 量内容节点才拿得到文字的实际宽度。
   ④ 结果回来时要确认「还是当前这张图」。连点换一张 / 旋屏重采都会让两次采样并存，
      迟到的旧结果会把新图的判定覆盖掉。

   判定规则（用户定案，别再复杂化）：
   对那块壁纸区域求平均亮度（sRGB 相对亮度，非线性 RGB 平均会把中间调整体推亮），
   亮于阈值 → 整块文字全用黑色；暗于阈值 → 整块全用白色。
   不加任何文字阴影 / 描边；一个区域只有一种字色，不做混合模式。 */

/* 平均亮度阈值：0 = 纯黑，1 = 纯白。0.45 偏向白字 —— 同样处于中间调的照片，
   白字压暗块比黑字压亮块更不容易消失。 */
const TONE_SWITCH = 0.45;
/* 字色只有一族：亮背景 = 中性黑，暗背景 = 纯白。
   次要文字只允许用「同族半透明」，不许带蓝灰色调（用户定案：统一颜色，别加淡蓝）。 */
const TONE_PALETTE = {
  dark: {
    ink: '#101010', muted: 'rgba(0,0,0,.86)', faint: 'rgba(0,0,0,.7)', divider: 'rgba(16,16,16,.5)',
    accent: '#b3722a',
  },
  light: {
    ink: '#ffffff', muted: 'rgba(255,255,255,.92)', faint: 'rgba(255,255,255,.78)', divider: 'rgba(255,255,255,.6)',
    accent: '#ffd18a',
  },
};
let lastWallpaperUrl = '';
let lastToneRatio = 0;

function channelLuma(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function pixelLuma(r, g, b) {
  return 0.2126 * channelLuma(r) + 0.7152 * channelLuma(g) + 0.0722 * channelLuma(b);
}

/* 把一块背景变成「该用哪种字色」：只看平均亮度。
   只依赖数字数组，测试可以直接覆盖纯色、中间调和混合背景。 */
function scoreTone(lumas) {
  if (!lumas.length) return { text: 'dark', average: 0 };
  const average = lumas.reduce((sum, v) => sum + v, 0) / lumas.length;
  return { text: average >= TONE_SWITCH ? 'dark' : 'light', average };
}

function writeTone(region, result) {
  const palette = TONE_PALETTE[result.text] || TONE_PALETTE.dark;
  const prefix = `--wp-${region}-`;
  Object.entries(palette).forEach(([name, value]) => els.root.style.setProperty(`${prefix}${name}`, value));
  const background = result.text === 'light' ? 'dark' : 'light';
  els.root.classList.toggle(`wp-${region}-dark`, background === 'dark');
  els.root.classList.toggle(`wp-${region}-light`, background === 'light');
}

/* ---------- 11b. 工具栏按壁纸着色 ----------
   iOS 26 的 Safari 不再读 meta theme-color，改成取「视口边缘那层元素的 background-color」；
   顶栏和页脚都是透明的，往下就是壁纸层和 .app-shell，底色一直是 --bg（浅灰），
   系统取到浅灰 → 工具栏发白，网页看着像浮在两条白栏之间。
   修法：把壁纸均值色写进那几层的底色（see styles.css 的 --chrome-tint），
   系统不管取到哪一层，拿到的都是跟壁纸同调的颜色。
   深色模式不参与 —— 底色本来就是深的，工具栏跟它一致（用户定案：深色没问题，别动）。 */
let wallpaperAverage = null;   /* 最近一次采到的壁纸均值色；切主题时用它重写 */

function rgbToHex(c) {
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function writeChromeTint(average) {
  if (average) wallpaperAverage = average;
  const dark = els.root.classList.contains('dark');
  const tint = !dark && wallpaperAverage ? rgbToHex(wallpaperAverage) : '';
  /* 深色 / 未采样：撤掉内联值，交回 CSS 的 var(--bg) 与壁纸层原底色，与改动前逐像素一致 */
  ['--chrome-tint', '--chrome-tint-wallpaper'].forEach((name) => {
    if (tint) els.root.style.setProperty(name, tint);
    else els.root.style.removeProperty(name);
  });

  const color = dark ? '#11171d' : (tint || '#ffffff');
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
      /* 采样坐标系必须与「壁纸层这个盒子」对齐，而不是视口 —— 它是
           position:fixed; top:-140px; height:calc(100vh + 280px); background-size:cover
         比视口高一截，CSS 的 cover 是按它算的。以前这里拿视口宽高比去 cover，两套
         坐标系错开一百多像素：问候区明明压在深蓝浪头上，却采到了旁边的米色亮区，
         于是判成浅底、深色字直接看不见。
         offsetWidth/offsetHeight 给的是布局尺寸，不受 transform:scale(1.02) 影响；
         offsetTop/offsetLeft 同样不含 transform，正好用来还原这个盒子。 */
      const wp = els.wallpaper;
      const boxW = wp.offsetWidth || vw;
      const boxH = wp.offsetHeight || vh;
      const boxLeft = wp.offsetLeft;
      const boxTop = wp.offsetTop;
      const CW = 72;
      const CH = Math.max(8, Math.round((CW * boxH) / boxW));
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const cover = CW / CH;
      const ratio = image.width / image.height;
      let sx, sy, sw, sh;
      if (ratio > cover) { sh = image.height; sw = sh * cover; sx = (image.width - sw) / 2; sy = 0; }
      else { sw = image.width; sh = sw / cover; sx = 0; sy = (image.height - sh) / 2; }
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, CW, CH);
      /* 读取窗口内每个像素的线性相对亮度。窗口是归一化坐标，原点在壁纸层左上角。 */
      const lumasOf = (x0, x1, y0, y1) => {
        const colA = Math.max(0, Math.min(CW - 1, Math.floor(x0 * CW)));
        const colB = Math.max(colA + 1, Math.min(CW, Math.ceil(x1 * CW)));
        const rowA = Math.max(0, Math.min(CH - 1, Math.floor(y0 * CH)));
        const rowB = Math.max(rowA + 1, Math.min(CH, Math.ceil(y1 * CH)));
        const data = ctx.getImageData(colA, rowA, colB - colA, rowB - rowA).data;
        const lumas = [];
        for (let i = 0; i < data.length; i += 4) {
          lumas.push(pixelLuma(data[i], data[i + 1], data[i + 2]));
        }
        return lumas;
      };
      /* 同一块区域的「平均色」（sRGB 直接平均，不做线性化 —— 这里要的是肉眼看到的
         那个颜色，不是亮度）。给工具栏着色用，取整张 = 壁纸均值色。 */
      const averageColorOf = (x0, x1, y0, y1) => {
        const colA = Math.max(0, Math.min(CW - 1, Math.floor(x0 * CW)));
        const colB = Math.max(colA + 1, Math.min(CW, Math.ceil(x1 * CW)));
        const rowA = Math.max(0, Math.min(CH - 1, Math.floor(y0 * CH)));
        const rowB = Math.max(rowA + 1, Math.min(CH, Math.ceil(y1 * CH)));
        const data = ctx.getImageData(colA, rowA, colB - colA, rowB - rowA).data;
        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
        return n ? { r: r / n, g: g / n, b: b / n } : null;
      };
      /* 文字实际占据的矩形。块级元素的 getBoundingClientRect 给的是「整栏容器宽度」
         （撑满 1030px），不是文字渲染出来的那一小截宽 —— 必须用 Range 罩住内容节点，
         否则窗口根本没变窄，等于没修。 */
      const textRect = (el) => {
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return rect;
        } catch { /* 下面退回元素自身矩形 */ }
        return el.getBoundingClientRect();
      };
      /* 一组元素的并集矩形（视口坐标） */
      const unionRect = (selector, asText) => {
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        document.querySelectorAll(selector).forEach((el) => {
          const rect = asText ? textRect(el) : el.getBoundingClientRect();
          if (!(rect.width > 0) || !(rect.height > 0)) return;
          left = Math.min(left, rect.left); right = Math.max(right, rect.right);
          top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom);
        });
        return Number.isFinite(left) ? { left, right, top, bottom } : null;
      };
      /* 视口矩形 -> 壁纸层坐标系的归一化窗口 [x0, x1, y0, y1]（少量外扩 + clamp） */
      const toWindow = (rect, padX, padY) => {
        if (!rect) return [0, 1, 0, 1];
        return [
          Math.max(0, (rect.left - boxLeft) / boxW - padX),
          Math.min(1, (rect.right - boxLeft) / boxW + padX),
          Math.max(0, (rect.top - boxTop) / boxH - padY),
          Math.min(1, (rect.bottom - boxTop) / boxH + padY),
        ];
      };
      /* 问候区：横向只取三行文字真正压着的那一段，纵向覆盖整个问候区。
         横向若按整栏取平均，文字旁边大片与它无关的明暗区会把判定带偏。 */
      const topWindow = toWindow(
        unionRect('.hero-block .eyebrow, .hero-block #clock, .hero-block .hero-meta', true)
          || unionRect('.hero-block', false),
        0.02, 0.05,
      );
      writeTone('top', scoreTone(lumasOf(...topWindow)));
      writeTone('bottom', scoreTone(lumasOf(...toWindow(unionRect('.bottom-bar', false), 0.01, 0.02))));
      /* 工具栏着色：整张壁纸的均值色，一次采样两用，不额外加载图片 */
      writeChromeTint(averageColorOf(0, 1, 0, 1));
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

// 主题模式：auto（默认，跟当地日出日落）/ light / dark（用户点过一次按钮）。
// 手动只在本次浏览内有效、不落盘 —— 刷新后一律回到 auto，按地点与时间重判（用户定案）。
// 顺手删掉旧版本残留的锁定值，否则升过级的老用户会被永久锁在旧档。
let themeMode = 'auto';
removeText(STORAGE.themeMode);
removeText(STORAGE.theme);

// 坐标优先用 12 小时内的缓存；没有缓存时先用默认城市的坐标「同步」判一次，
// 避免「先白后黑」的闪屏 —— 真实定位由 syncThemeLocation() 异步补上后再重判。
// 只认 src 为 geo / ip 的缓存：否则一旦写进过默认城市坐标，会被当成有效定位用满 12 小时。
const COORDS_SOURCES = ['geo', 'ip'];
function themeCoords() {
  const cached = readJson(STORAGE.coords, null);
  const fresh = cached && COORDS_SOURCES.includes(cached.src) && Date.now() - Number(cached.t) < 12 * 3600e3;
  return fresh && Number.isFinite(cached.lat) && Number.isFinite(cached.lng) ? cached : DEFAULT_COORDS;
}
// 当天的日出日落（含坐标来源与地名），主题判定与提示文案共用同一份计算。
function todaySun() {
  const { lat, lng, src, label } = themeCoords();
  return { ...sunTimes(new Date(), lat, lng), src: src || 'default', label: label || DEFAULT_COORDS.label };
}
// 日出前 30 分钟（民用晨光）转浅色、日落后 30 分钟（民用暮光结束）转深色 —— 天色先于人眼
// 感知变化，卡在日出日落那一秒会让屏幕在天还没亮透时就白、天还有余光时就黑。
const SUN_BUFFER = 30 * 60e3;
function autoDark() {
  const sun = todaySun();
  if (sun.polar === 'day') return false;
  if (sun.polar === 'night') return true;
  const now = Date.now();
  return now < sun.sunrise.getTime() - SUN_BUFFER || now >= sun.sunset.getTime() + SUN_BUFFER;
}
const SUN_CLOCK = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
// 提示文案只说「现在是什么色 + 当地今天几点日出日落 + 坐标哪来的」，手动档与自动档同构。
// **不写「手动 / 自动 / 再点会切到哪 / 刷新会怎样」这类说明**（用户定案）：
// 切换是手动、刷新回自动，行为本身就直白，用不着在按钮上再讲一遍；
// aria-label 也只说这个按钮做什么。角标指示灯同样不做。
function paintThemeHint(dark) {
  const sun = todaySun();
  const place = ` · ${sun.label}`;
  els.themeToggle.setAttribute('aria-label', `切换到${dark ? '浅色' : '深色'}主题`);
  if (sun.polar === 'day') {
    els.themeToggle.title = `浅色 · 当地极昼，全天有日光${place}`;
  } else if (sun.polar === 'night') {
    els.themeToggle.title = `深色 · 当地极夜，全天无日光${place}`;
  } else {
    els.themeToggle.title = `${dark ? '深色' : '浅色'} · 日出 ${SUN_CLOCK.format(sun.sunrise)} / 日落 ${SUN_CLOCK.format(sun.sunset)}${place}`;
  }
}
function applyTheme(dark) {
  els.root.classList.toggle('dark', dark);
  paintThemeHint(dark);

  /* 工具栏着色跟着主题走：深色 = 原样（#11171d），浅色 = 壁纸均值色。
     ⚠️ 两个雷区（沿用）：
     ① 绝不用「改一下再改回来」的闪烁 hack —— auto 模式下 applyTheme 每分钟都可能被调，
        工具栏会跟着反复闪，这就是「深色模式抽风」的由来；
     ② 值没变就别动 DOM（重建 meta 节点会让 WebKit 重新读一遍工具栏颜色，是没必要的抖动）。 */
  writeChromeTint();
}
function initTheme() {
  applyTheme(themeMode === 'auto' ? autoDark() : themeMode === 'dark');
}
// 定位到手后重判一次，并把坐标缓存半天（天气与主题共用同一份）。
// 只有真拿到坐标才写缓存：否则会把默认城市坐标当有效值存下来，
// 之后 12 小时内都不会再尝试真定位（这也是「改了定位却一直没变」的另一个坑）。
async function syncThemeLocation() {
  const coords = await resolveCoordsOnce();
  if (coords) {
    writeJson(STORAGE.coords, { lat: coords.lat, lng: coords.lng, t: Date.now(), src: coords.src, label: coords.label });
    geoHint = coords.src === 'ip' ? `按 IP 定位（${coords.label}）` : '按本机定位';
    const dark = themeMode === 'auto' ? autoDark() : els.root.classList.contains('dark');
    if (dark !== els.root.classList.contains('dark')) applyTheme(dark);
    else paintThemeHint(dark);   // 主题没变也要重画提示：坐标换了，日出日落时刻跟着变
  } else {
    geoHint = '未取到定位，按默认城市';
  }
  writeWeatherTitle();
}
// 每分钟检查一次，跨过日出 / 日落就自动切换（纯计算，开销可忽略）；
// 顺便重画一次提示：日期一过零点，日出日落时刻就变了。
// 手动档直接早退：这次浏览里用户说了算，刷新后再交回「地点 + 时间」。
function tickTheme() {
  if (themeMode !== 'auto') return;
  const dark = autoDark();
  if (dark !== els.root.classList.contains('dark')) applyTheme(dark);
  else paintThemeHint(dark);
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
/* 点击 = 相对**当前显示**切到反面（深 ↔ 浅），所以每次点都看得见变化；
   不写 localStorage：手动只活在这次浏览里，刷新后重新从 auto 起步。 */
els.themeToggle.addEventListener('click', () => {
  themeMode = els.root.classList.contains('dark') ? 'light' : 'dark';
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
