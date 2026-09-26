/* ==========================================================================
   起始页测试 · 场景注入（必须在 app.js 之前执行）
   作用：
     1. 按 ?case=xxx 预置 localStorage（含故意写坏的脏数据）；
     2. 把 window.fetch 换成可控桩 —— 测试不能依赖真实第三方接口
        （CORS、限流、超时都会让结果飘），所有响应都在这里造；
     3. 记录实际请求过的 URL，用于断言「有没有走缓存」「降级链走对了没」。
   ========================================================================== */
(function () {
  const CASE = new URLSearchParams(location.search).get('case') || 'default';
  const day = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const trendItems = (n, tag) =>
    Array.from({ length: n }, (_, i) => ({
      title: `${tag} 第 ${i + 1} 条`,
      url: `https://example.com/${i + 1}`,
      meta: `${i + 1} 万热度`,
    }));

  const SEEDS = {
    // 干净状态：模拟第一次访问
    default: {},
    // 各类缓存都在：走缓存分支、不走网络
    cached: {
      'start-local-notes-v1': JSON.stringify([
        { id: 'n1', text: '买牛奶', done: false },
        { id: 'n2', text: '写周报', done: true },
        { id: 'n3', text: '去跑步', done: false },
      ]),
      'start-local-theme-mode-v1': 'dark',
      'start-local-wallpaper-v2': JSON.stringify({
        date: day(), offset: 0,
        url: 'img/white.png', title: 'Unsplash · 白图（缓存）',
        photoUrl: 'https://unsplash.com/photos/cached',
      }),
      'start-local-trends-v2-zhihu': JSON.stringify({ at: Date.now(), items: trendItems(5, '缓存') }),
    },
    // 故意写坏的存储：任何一项都不该让页面崩
    dirty: {
      'start-local-notes-v1': '{"oops":"not an array"}',
      'start-local-wallpaper-offset-v2': 'abc',
      'start-local-wallpaper-v2': 'not json at all',
      'start-local-trends-v2-zhihu': '"a string, not an object"',
      'start-local-trend-source-v2': '不存在的源',
      'start-local-engine-v1': '不存在的引擎',
    },
    // 自有 API 挂掉，公共源可用 —— 验证降级链顺序
    public: {},
    // 全断网
    offline: {},
    // 交互驱动
    interactive: {
      'start-local-notes-v1': JSON.stringify([{ id: 'x1', text: '已有的一条', done: false }]),
    },
    // 只测回车搜索跳转
    search: {},
    // 接口返回第三方图床（采不了样），验证前端会拒收并改用 Unsplash 池
    picfail: {},
  };

  const seed = SEEDS[CASE] || {};
  Object.keys(seed).forEach((k) => localStorage.setItem(k, seed[k]));

  const state = { case: CASE, calls: [], ready: false };
  window.__T = state;

  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  const IMG = location.origin + '/img/black.png';

  window.fetch = async (url) => {
    const u = String(url);
    state.calls.push(u);
    if (CASE === 'offline') throw new TypeError('Failed to fetch');
    const target = new URL(u, location.href);

    if (target.pathname.endsWith('/hotlist')) {
      if (CASE === 'public') throw new TypeError('cloud down');
      const type = target.searchParams.get('type');
      return json({
        success: true,
        data: trendItems(8, `云-${type}`).map((it, i) => ({ index: i + 1, title: it.title, url: it.url, hot: it.meta })),
      });
    }
    if (target.pathname.endsWith('/v2/wallpaper')) {
      if (CASE === 'wpfail') throw new TypeError('wallpaper api down');
      // 挂起直到 test.js 打完桩再返回 —— 否则 app 的壁纸请求会在 test.js 之前就解析完，
      // 用例就没机会替换「能不能采样」的判定。
      await new Promise((r) => {
        const t = setInterval(() => { if (state.ready) { clearInterval(t); r(); } }, 10);
      });
      const offset = Number(target.searchParams.get('offset'));
      // picfail：故意返回一个「采不了样」的第三方图床地址，验证真门禁会拒收并改用 Unsplash 池
      if (CASE === 'picfail') {
        return json({
          success: true, source: 'picsum', provider: 'Unsplash 图库', day,
          url: 'https://fastly.picsum.photos/id/809/2400/1400.jpg',
          thumb: 'https://fastly.picsum.photos/id/809/320/200.jpg',
          author: 'Namphuong Van', photoUrl: 'https://unsplash.com/photos/sP4UZnpSiN4', offset,
        });
      }
      return json({
        success: true, source: 'unsplash', provider: 'Unsplash', day,
        url: IMG, thumb: IMG, title: '测试标题',
        author: '测试摄影师', authorUrl: 'https://unsplash.com/@tester',
        photoUrl: 'https://unsplash.com/photos/abc123', offset,
      });
    }
    if (u.includes('60s')) {
      if (CASE === 'default' || CASE === 'cached' || CASE === 'dirty' || CASE === 'interactive') {
        throw new TypeError('public disabled in this case');
      }
      return json({ data: trendItems(6, '60s').map((it) => ({ title: it.title, link: it.url, hot_value_desc: it.meta })) });
    }
    if (u.includes('codelife')) {
      if (CASE === 'default' || CASE === 'cached' || CASE === 'dirty' || CASE === 'interactive') {
        throw new TypeError('public disabled in this case');
      }
      return json({ data: trendItems(6, 'codelife').map((it) => ({ title: it.title, link: it.url, hotValue: it.meta })) });
    }
    if (u.includes('hacker-news')) {
      if (CASE === 'default' || CASE === 'cached' || CASE === 'dirty' || CASE === 'interactive') {
        throw new TypeError('public disabled in this case');
      }
      return json([1, 2, 3, 4, 5, 6]);
    }
    if (u.includes('/item/')) {
      return json({ id: Number(target.pathname.split('/').pop().replace('.json', '')), title: `HN 第 ${target.pathname} 条`, url: 'https://example.com/hn' });
    }
    throw new TypeError('unexpected request: ' + u);
  };

  /* 天气走 JSONP（<script> 注入），fetch 桩拦不到；而 app.js 里 jsonp 是函数声明，
     直接 window.jsonp = ... 会被后来的声明覆盖。改为从更底层的
     document.head.appendChild 拦截：认出彩云的 script 就立刻回调桩数据，不发真请求。 */
  const realAppend = document.head.appendChild.bind(document.head);
  document.head.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && /caiyunapp\.com/.test(node.src || '')) {
      const cb = new URL(node.src).searchParams.get('callback');
      setTimeout(() => {
        if (CASE === 'offline') { if (node.onerror) node.onerror(); return; }
        if (typeof window[cb] === 'function') {
          window[cb]({
            status: 'ok',
            result: { realtime: { skycon: 'LIGHT_RAIN', temperature: 23.4, apparent_temperature: 25.6, humidity: 0.62 } },
          });
        }
      }, 0);
      return node;   // 不真正插入 DOM，避免真打彩云接口
    }
    return realAppend(node);
  };

  // 定位：桩掉，避免无头浏览器弹权限/超时影响用例
  if (CASE === 'geo') {
    // 保留真实 API，用于验证定位拒绝后的降级
  } else {
    navigator.geolocation = {
      getCurrentPosition: (ok, err) => setTimeout(() => err(new Error('denied in tests')), 0),
    };
    /* permissions.query 是真实异步 API，不受虚拟时钟管辖：--virtual-time-budget 会在它返回
       之前就把页面 dump 出来，表现为 offline 用例偶发「没拿到结果」或天气停在「加载中」。
       它只用来快速判断「是否已被拒绝」，桩掉不影响被测逻辑。 */
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      const realQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (desc) =>
        (desc && desc.name === 'geolocation' ? Promise.resolve({ state: 'prompt' }) : realQuery(desc));
    }
  }
})();
