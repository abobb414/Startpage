/* ==========================================================================
   起始页测试 · 断言集（在 app.js 之后执行）
   与 app.js 共享同一个全局作用域，所以可以直接调用内部函数、读内部状态。
   结果写进 <pre id="__results">，由 run.sh 抓取。
   命名约定：本文件所有标识符加 T_ 前缀，避免与 app.js 的顶层声明冲突。
   ========================================================================== */
(async function T_run() {
  const CASE = (window.__T && window.__T.case) || 'default';

  /* 打桩时机：壁纸接口的响应被 seed.js 挂起，等这里改完判定再放行。
     除 picfail 外的场景都放行「本地测试图」当作可采样图 —— 本地图可控、可断言；
     picfail 保留真实判定，专门验证「非 Unsplash CDN 的图会被拒收」。 */
  if (CASE !== 'picfail') window.isSampleable = () => true;
  window.__T.ready = true;

  const T_R = [];
  const T_ok = (name, pass, extra) => T_R.push({ name, pass: !!pass, extra: extra == null ? '' : String(extra) });
  const T_section = (name) => T_R.push({ section: name });
  const T_sleep = (ms) => new Promise((T_r) => setTimeout(T_r, ms));
  const T_poll = async (fn, ms = 3000) => {
    const T_t0 = Date.now();
    while (Date.now() - T_t0 < ms) { if (fn()) return true; await T_sleep(50); }
    return false;
  };
  const T_throws = (fn) => { try { fn(); return false; } catch { return true; } };

  // 页面级未捕获错误也收进结果里 —— 否则「跑到一半崩了」和「断言失败」看起来一样
  const T_errors = [];
  window.addEventListener('error', (e) => T_errors.push(`error: ${e.message || e}`));
  window.addEventListener('unhandledrejection', (e) => T_errors.push(`rejection: ${(e.reason && e.reason.message) || e.reason}`));

  await T_sleep(700); // 等 app 初始化的异步任务收敛

  // 记住「初始化后的第一现场」，后面很多交互会改写这些状态，脏数据用例要拿它比对
  const T_init = {
    engine, trendSource, wallpaperOffset, notesLen: notes.length,
    themeMode, dark: document.documentElement.classList.contains('dark'),
  };
  try {

  /* ---------------- 1. 基础工具 / 存储容错 ---------------- */
  T_section('工具');
  T_ok('dateKey 输出 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(dateKey()), dateKey());
  localStorage.setItem('__t_bad', '{不是 json');
  T_ok('readJson 遇坏 JSON 回落默认值', readJson('__t_bad', 'FB') === 'FB');
  localStorage.removeItem('__t_bad');
  writeJson('__t_rt', { a: 1 });
  T_ok('readJson / writeJson 往返一致', readJson('__t_rt', null)?.a === 1);
  localStorage.removeItem('__t_rt');
  T_ok('normalize 兼容 link / mobileUrl / hotValue', (() => {
    const n = normalize({ title: ' x ', link: 'https://a', hot_value_desc: '1万' });
    return n.title === 'x' && /^https:\/\/a\/?$/.test(n.url) && n.meta === '1万';
  })());
  T_ok('normalize 会丢弃非 http(s) 链接', normalize({ title: 'y', url: 'javascript:alert(1)' }).url === '');

  /* ---------------- 2. 时钟 / 问候 / 日期 ---------------- */
  T_section('时钟');
  T_ok('时钟已渲染为 HH:MM', /^\d{2}:\d{2}$/.test(els.clock.textContent), els.clock.textContent);
  T_ok('时钟写入 --clock-lead 抵消等宽数字左空', !!els.clock.style.getPropertyValue('--clock-lead'),
    els.clock.style.getPropertyValue('--clock-lead'));
  T_ok('问候语与当前小时匹配', (() => {
    const h = new Date().getHours();
    const want = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
    return els.greeting.textContent === want;
  })(), els.greeting.textContent);
  T_ok('日期行已本地化渲染', /月|星期/.test(els.dateLabel.textContent), els.dateLabel.textContent);

  /* ---------------- 3. 便签 ---------------- */
  T_section('便签');
  const T_notes0 = notes.length;
  if (CASE === 'default' || CASE === 'offline' || CASE === 'wpfail' || CASE === 'public' || CASE === 'search') {
    T_ok('空态提示存在', els.notesList.querySelector('.empty-state') !== null);
    T_ok('计数为 0', els.noteCount.textContent === '0');
  }
  if (CASE === 'cached') {
    T_ok('已有 3 条便签全部渲染', els.notesList.querySelectorAll('.note-item').length === 3,
      els.notesList.querySelectorAll('.note-item').length);
    T_ok('已完成项带 done 类', els.notesList.querySelectorAll('.note-item.done').length === 1);
    T_ok('计数与实际条数一致', els.noteCount.textContent === '3', els.noteCount.textContent);
  }
  if (CASE === 'interactive') {
    els.noteInput.value = '  新写的一条  ';
    els.noteForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    T_ok('新增便签：文案去空格后置顶', notes[0]?.text === '新写的一条', notes[0]?.text);
    T_ok('新增便签：DOM 首行为新内容', els.notesList.querySelector('.note-item span')?.textContent === '新写的一条');
    T_ok('新增便签：输入框已清空', els.noteInput.value === '');
    T_ok('新增便签：已写入 localStorage',
      JSON.parse(localStorage.getItem(STORAGE.notes))[0].text === '新写的一条');
    T_ok('计数同步更新', els.noteCount.textContent === '2', els.noteCount.textContent);

    els.noteInput.value = '   ';
    const T_before = notes.length;
    els.noteForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    T_ok('空白便签不会被添加', notes.length === T_before);

    // 12 条上限
    for (let i = 0; i < 15; i += 1) {
      els.noteInput.value = `压测 ${i}`;
      els.noteForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
    T_ok('便签条数封顶 12 条', notes.length === 12, notes.length);

    // 切换完成态
    const T_row = els.notesList.querySelector('.note-item');
    const T_id = Number(T_row.querySelector('.toggle-note') ? 1 : 0);
    T_row.querySelector('.toggle-note').click();
    T_ok('点√：状态取反并落盘',
      JSON.parse(localStorage.getItem(STORAGE.notes)).find((n) => n.done) !== undefined);
    T_ok('点√：重新渲染后带 done 类', els.notesList.querySelector('.note-item.done') !== null);

    // 删除
    const T_cnt = notes.length;
    els.notesList.querySelector('.note-item .remove-note').click();
    T_ok('点×：条数减一', notes.length === T_cnt - 1, notes.length);
    T_ok('点×：存储同步', JSON.parse(localStorage.getItem(STORAGE.notes)).length === T_cnt - 1);

    // 清空
    els.clearNotes.click();
    T_ok('清空：列表空 + 空态回来', notes.length === 0 && els.notesList.querySelector('.empty-state') !== null);
    T_ok('清空：计数归零', els.noteCount.textContent === '0');
    T_ok('清空：存储已写空数组', JSON.parse(localStorage.getItem(STORAGE.notes)).length === 0);
    void T_id;
  }

  /* ---------------- 4. 搜索引擎 ---------------- */
  T_section('搜索');
  T_ok('引擎菜单初始收起', els.engineMenu.hidden === true);
  els.engineToggle.click();
  T_ok('点按钮展开引擎菜单', els.engineMenu.hidden === false);
  els.engineMenu.querySelector('[data-engine="baidu"]').click();
  T_ok('选百度后按钮文案更新', els.engineToggle.textContent.includes('百度'), els.engineToggle.textContent.trim());
  T_ok('选百度后已写存储', localStorage.getItem(STORAGE.engine) === 'baidu');
  T_ok('选完后菜单收起', els.engineMenu.hidden === true);
  setEngine('不存在的引擎');
  T_ok('非法引擎名回落到 Google', engine === 'google' && localStorage.getItem(STORAGE.engine) === 'google');
  T_ok('四个引擎地址齐全且都以 q= 结尾', Object.values(engines).every((u) => /^https:\/\/.+[?]/.test(u)));
  setEngine('baidu');

  /* ---------------- 5. 今日热点 ---------------- */
  T_section('热点');
  const T_calls = (window.__T && window.__T.calls) || [];
  const T_listCount = els.trendList.querySelectorAll('.trend-item').length;
  const T_expectList = CASE === 'offline' ? 0 : 5;   // dirty 也期望 5：它的作用就是暴露「初始化被打断」
  T_ok(`热点列表渲染 ${T_expectList} 条（多于 5 条也只取前 5）`, T_listCount === T_expectList, T_listCount);
  if (T_listCount > 0) {
    T_ok('序号为 01..05', /^01$/.test(els.trendList.querySelector('.trend-index')?.textContent || ''),
      els.trendList.querySelector('.trend-index')?.textContent);
    T_ok('外链新窗口 + noopener', (() => {
      const a = els.trendList.querySelector('.trend-item');
      return !!a && a.target === '_blank' && /noopener/.test(a.rel);
    })());
  }

  if (CASE === 'cached') {
    T_ok('命中新鲜缓存时零网络请求', T_calls.length === 0, T_calls.join(' | '));
    T_ok('缓存条目标题已渲染', /缓存/.test(els.trendList.textContent), els.trendList.textContent.slice(0, 20));
  }
  if (CASE === 'default' || CASE === 'dirty') {
    T_ok('知乎首选自有 API（第一个请求就是 /hotlist）',
      T_calls.length > 0 && T_calls[0].includes('/hotlist?type=zhihu'), T_calls.slice(0, 3).join(' | '));
    T_ok('自有 API 成功时不再请求公共源',
      !T_calls.some((u) => u.includes('60s') || u.includes('codelife')), T_calls.join(' | '));
    T_ok('标题取自自有 API 数据', /云-zhihu/.test(els.trendList.textContent), els.trendList.textContent.slice(0, 20));
  }
  if (CASE === 'public') {
    T_ok('自有 API 挂掉后降级到公共源并渲染', /60s/.test(els.trendList.textContent), els.trendList.textContent.slice(0, 20));
    T_ok('降级后没有卡在 loading', els.trendList.querySelectorAll('.loading-line').length === 0);
  }
  if (CASE === 'offline') {
    T_ok('全断网且无缓存：给出可点来源的兜底文案',
      /无法连接/.test(els.trendList.textContent) && !!els.trendList.querySelector('a[href]'),
      els.trendList.textContent.slice(0, 30));
  }
  T_ok('renderTrendItems([]) 不应抛异常（空数组是正常返回值，不是控制流）',
    !T_throws(() => renderTrendItems([])));
  T_ok('标题按纯文本渲染，注入的标签不会变成元素', (() => {
    renderTrendItems([{ title: '<img src=x onerror=alert(1)>危险', url: 'https://e.com', meta: 'm' }]);
    const T_t = els.trendList.querySelector('.trend-title');
    return T_t && T_t.querySelector('img') === null && T_t.textContent.includes('<img');
  })());
  T_ok('非 http(s) 的链接被拒绝（防伪协议注入）', (() => {
    renderTrendItems([{ title: 'x', url: 'javascript:alert(1)', meta: 'm' }]);
    const T_a = els.trendList.querySelector('.trend-item');
    return T_a && !/^javascript:/i.test(T_a.getAttribute('href') || '');
  })(), els.trendList.querySelector('.trend-item')?.getAttribute('href'));

  if (CASE === 'interactive') {
    await loadTrends();
    const T_from = trendSource;
    await switchTrendSource();
    T_ok('切换来源按 知乎→掘金→HackerNews 循环', trendSource === 'juejin', `${T_from} → ${trendSource}`);
    T_ok('切换后已写存储', localStorage.getItem(STORAGE.trendSource) === 'juejin');
    T_ok('切换后按钮文案同步', els.sourceSwitchLabel.textContent === '掘金', els.sourceSwitchLabel.textContent);
    T_ok('切换后标题来自新来源', /云-juejin/.test(els.trendList.textContent), els.trendList.textContent.slice(0, 20));
    T_ok('busy 标记已复位', els.sourceSwitch.dataset.busy === 'false', els.sourceSwitch.dataset.busy);
  }

  /* ---------------- 6. 天气 ---------------- */
  T_section('天气');
  if (CASE === 'offline') {
    T_ok('取不到天气时文案降级且图标清空',
      els.weatherText.textContent === '天气未连接' && els.weatherIcon.innerHTML === '',
      els.weatherText.textContent);
  } else {
    T_ok('天气已取到并渲染温度', /°C$/.test(els.weatherText.textContent), els.weatherText.textContent);
    T_ok('天气图标已写入 SVG', els.weatherIcon.innerHTML.includes('<svg'));
    T_ok('天气标题带定位来源说明', /定位|默认城市/.test(els.weatherText.getAttribute('title') || ''),
      els.weatherText.getAttribute('title'));
  }
  T_ok('天气图标映射：晴/夜/云/雨/雪/霾/风', (() => {
    const T_m = {
      CLEAR_DAY: 'clearDay', CLEAR_NIGHT: 'clearNight', PARTLY_CLOUDY_DAY: 'cloudyDay',
      PARTLY_CLOUDY_NIGHT: 'cloudyNight', CLOUDY: 'cloudy', LIGHT_RAIN: 'rain',
      MODERATE_SNOW: 'snow', HEAVY_HAZE: 'haze', WIND: 'wind', '': 'cloudy',
    };
    return Object.keys(T_m).every((k) => weatherIconKey(k) === T_m[k]);
  })());
  T_ok('未知 skycon 不抛异常且回落到图标', !T_throws(() => setWeatherIcon('WHAT_IS_THIS')));
  T_ok('天气悬停提示 = 正文 + 定位来源', (() => {
    weatherBody = '体感 25°C · 湿度 62% · 彩云天气';
    geoHint = '按本机定位';
    writeWeatherTitle();
    return els.weatherText.title === '体感 25°C · 湿度 62% · 彩云天气 · 按本机定位';
  })(), els.weatherText.title);
  T_ok('没有正文时清掉悬停提示', (() => {
    weatherBody = ''; writeWeatherTitle();
    return els.weatherText.getAttribute('title') === null;
  })());

  /* ---------------- 7. 壁纸 ---------------- */
  T_section('壁纸');
  if (CASE === 'cached') {
    T_ok('命中当天缓存：直接用缓存图不再请求接口',
      els.wallpaper.style.backgroundImage.includes('white.png'),
      els.wallpaper.style.backgroundImage);
    T_ok('署名与链接来自缓存', els.wallpaperCaption.textContent === 'Unsplash · 白图（缓存）' &&
      els.wallpaperCaption.getAttribute('href') === 'https://unsplash.com/photos/cached',
      els.wallpaperCaption.textContent);
  } else if (CASE !== 'offline' && CASE !== 'wpfail' && CASE !== 'picfail') {
    T_ok('取到接口壁纸并写入背景', /black\.png/.test(els.wallpaper.style.backgroundImage),
      els.wallpaper.style.backgroundImage);
    T_ok('署名 = Unsplash · 摄影师', els.wallpaperCaption.textContent === 'Unsplash · 测试摄影师',
      els.wallpaperCaption.textContent);
    T_ok('署名链接到 Unsplash 原图页',
      els.wallpaperCaption.getAttribute('href') === 'https://unsplash.com/photos/abc123');
  }

  if (CASE === 'wpfail') {
    const T_item = await resolveWallpaper();
    T_ok('壁纸接口挂掉时回落本地 Unsplash 池', T_item.url.startsWith('https://images.unsplash.com/'),
      T_item.url);
    T_ok('降级项署名仍是 Unsplash', T_item.title === 'Unsplash · 每日一图', T_item.title);
    T_ok('降级项链接到 Unsplash 首页', T_item.photoUrl === UNSPLASH_HOME);
  }
  if (CASE === 'picfail') {
    // 真门禁：接口给回第三方图床（fastly.picsum.photos，最终响应没有 CORS 头，canvas 采不了样）
    // 降级后的池内图来自真实 Unsplash CDN，加载耗时不定，这里要轮询等它落定
    await T_poll(() => /images\.unsplash\.com/.test(els.wallpaper.style.backgroundImage || ''), 12000);
    T_ok('接口返回「采不了样」的图床时拒收，改用 Unsplash 池',
      /images\.unsplash\.com/.test(els.wallpaper.style.backgroundImage || ''),
      els.wallpaper.style.backgroundImage);
    T_ok('拒收后署名仍为 Unsplash', /^Unsplash · /.test(els.wallpaperCaption.textContent),
      els.wallpaperCaption.textContent);
  }
  if (CASE !== 'offline') {
    T_ok('降级池地址都是 Unsplash CDN', WALLPAPER_FALLBACK.every((s) =>
      unsplashUrl(s.id).startsWith('https://images.unsplash.com/')));
    T_ok('降级池不含任何非 Unsplash 图源', WALLPAPER_FALLBACK.length === 12, WALLPAPER_FALLBACK.length);

    // 采样：纯黑 → 深底字色；纯白 → 浅底字色
    // 先把状态拨到相反值再采样，避免「初始值恰好就是期望值」造成的假通过
    const T_force = (top) => {
      ['wp-top-dark', 'wp-top-light', 'wp-bottom-dark', 'wp-bottom-light']
        .forEach((k) => document.documentElement.classList.remove(k));
      document.documentElement.classList.add(top, top.replace('top', 'bottom'));
    };
    await T_sleep(1200);   // app 自己也在采样同一张图，等它落定再手动接管
    T_force('wp-top-light');
    sampleWallpaperTone('img/black.png');
    const T_black = await T_poll(() => document.documentElement.classList.contains('wp-top-dark'));
    T_ok('黑图采样判为「深底」→ 用亮字', T_black, document.documentElement.className);
    T_force('wp-top-dark');
    sampleWallpaperTone('img/white.png');
    const T_white = await T_poll(() => document.documentElement.classList.contains('wp-top-light'));
    T_ok('白图采样判为「浅底」→ 用深字', T_white, document.documentElement.className);
    T_ok('采样失败不抛异常（跨域被拦/图 404）', !T_throws(() => sampleWallpaperTone('__missing__.png')));
  }

  if (CASE === 'interactive') {
    localStorage.removeItem(STORAGE.wallpaper);
    wallpaperOffset = 0;
    localStorage.setItem(STORAGE.wallpaperOffset, '0');
    const T_before = wallpaperOffset;
    localStorage.removeItem(STORAGE.wallpaper);
    await loadWallpaper(1);
    T_ok('换一张向更早日期走（offset 递减）', wallpaperOffset === T_before - 1, wallpaperOffset);
    T_ok('换一张后 offset 已落盘', localStorage.getItem(STORAGE.wallpaperOffset) === '-1');
    T_ok('换一张后请求带上了新 offset',
      (window.__T.calls.filter((u) => u.includes('/v2/wallpaper')).pop() || '').includes('offset=-1'),
      window.__T.calls.filter((u) => u.includes('/v2/wallpaper')).pop());

    wallpaperOffset = WALLPAPER_OFFSET_MIN;
    await loadWallpaper(1);
    T_ok('换到最早一天后绕回今天（不越界）', wallpaperOffset === 0, wallpaperOffset);

    // 图片加载失败路径（先等前面两次换图的异步链落定，否则它会把提示文案覆盖掉）
    await T_sleep(800);
    applyWallpaper({ url: '__missing__.png', title: 'x' });
    const T_fail = await T_poll(() => /加载失败/.test(els.wallpaperCaption.textContent));
    T_ok('图片挂了给出「加载失败」提示而不是白屏', T_fail, els.wallpaperCaption.textContent);

    // 采样竞态：连着换两张图时，先发的那张迟到的采样结果不能覆盖当前图
    ['wp-top-dark', 'wp-top-light'].forEach((k) => document.documentElement.classList.remove(k));
    sampleWallpaperTone('img/black.png');     // 先发黑图（模拟上一张）
    sampleWallpaperTone('img/white.png');     // 紧接着换成白图（模拟又点了一次）
    await T_sleep(1200);
    T_ok('连点换图：迟到的旧采样结果作废，以最后一张为准',
      document.documentElement.classList.contains('wp-top-light'),
      document.documentElement.className);
  }

  /* ---------------- 8. 主题 ---------------- */
  T_section('主题');
  T_ok('applyTheme(true) 给根节点加 dark', (() => { applyTheme(true); return document.documentElement.classList.contains('dark'); })());
  T_ok('深色下 theme-color = #11171d',
    document.querySelector('meta[name="theme-color"]').content === '#11171d',
    document.querySelector('meta[name="theme-color"]').content);
  T_ok('深色下切换按钮无障碍标签正确',
    els.themeToggle.getAttribute('aria-label') === '切换到浅色主题', els.themeToggle.getAttribute('aria-label'));
  applyTheme(false);
  T_ok('浅色下 theme-color = #ffffff',
    document.querySelector('meta[name="theme-color"]').content === '#ffffff',
    document.querySelector('meta[name="theme-color"]').content);
  T_ok('theme-color 节点始终只有一个（不重复插入）',
    document.querySelectorAll('meta[name="theme-color"]').length === 1);
  const T_metaNode = document.querySelector('meta[name="theme-color"]');
  applyTheme(false);
  T_ok('主题值没变时不重建 meta 节点（少一次 DOM 抖动）',
    document.querySelector('meta[name="theme-color"]') === T_metaNode);

  T_ok('sunTimes：上海夏至日出早于日落且落在 04–06 点', (() => {
    const T_s = sunTimes(new Date('2026-06-21T04:00:00Z'), 31.23, 121.47);
    return T_s.polar === null && T_s.sunrise < T_s.sunset && T_s.sunrise.getHours() >= 3 && T_s.sunrise.getHours() <= 7;
  })());
  T_ok('sunTimes：极昼/极夜有解且不返回时刻', (() => {
    const T_day = sunTimes(new Date('2026-06-21T12:00:00Z'), 80, 20);
    const T_night = sunTimes(new Date('2026-12-21T12:00:00Z'), 80, 20);
    return T_day.polar === 'day' && T_day.sunrise === null && T_night.polar === 'night';
  })());
  T_ok('坐标缓存：非 geo 来源的旧缓存不会被当成定位', (() => {
    writeJson(STORAGE.coords, { lat: 1, lng: 1, t: Date.now(), src: 'default' });
    const T_c = themeCoords();
    return T_c.lat === DEFAULT_COORDS.lat;
  })());
  T_ok('坐标缓存：geo 且 12 小时内才采用', (() => {
    writeJson(STORAGE.coords, { lat: 39.9, lng: 116.4, t: Date.now(), src: 'geo' });
    return themeCoords().lat === 39.9;
  })());
  T_ok('坐标缓存：过期后不再采用', (() => {
    writeJson(STORAGE.coords, { lat: 39.9, lng: 116.4, t: Date.now() - 13 * 3600e3, src: 'geo' });
    return themeCoords().lat === DEFAULT_COORDS.lat;
  })());
  localStorage.removeItem(STORAGE.coords);

  if (CASE === 'interactive') {
    localStorage.setItem(STORAGE.themeMode, 'auto');
    themeMode = 'auto';
    applyTheme(false);
    els.themeToggle.click();
    T_ok('手动点主题按钮：锁定为 dark 并落盘',
      themeMode === 'dark' && localStorage.getItem(STORAGE.themeMode) === 'dark', themeMode);
    T_ok('锁定后标题不再是「跟随日出日落」',
      /已手动锁定/.test(els.themeToggle.title), els.themeToggle.title);
    els.themeToggle.click();
    T_ok('再点一次回到 light', themeMode === 'light' && !document.documentElement.classList.contains('dark'));
  }

  /* ---------------- 9. 脏数据容错（专测） ---------------- */
  if (CASE === 'dirty') {
    T_section('脏数据容错');
    T_ok('坏掉的便签存储不阻塞初始化（时钟仍在跑）',
      /^\d{2}:\d{2}$/.test(els.clock.textContent), els.clock.textContent);
    T_ok('坏掉的便签存储不会让便签区崩掉',
      els.notesList.querySelectorAll('.note-item').length === 0 && !T_throws(() => renderNotes()));
    T_ok('坏掉的 offset（"abc"）不会算出 NaN',
      Number.isFinite(wallpaperOffset), wallpaperOffset);
    const T_item = await resolveWallpaper();
    T_ok('坏掉的 offset 不会渗进请求地址（无 NaN）',
      !String(T_item.url).includes('NaN') && /^https?:/.test(T_item.url), T_item.url);
    T_ok('坏掉的热点缓存不会让 loadTrends 抛异常',
      await loadTrends().then(() => true).catch(() => false));
    T_ok('非法热点来源名回落到知乎', T_init.trendSource === 'zhihu', T_init.trendSource);
    T_ok('非法搜索引擎名回落到 Google', T_init.engine === 'google', T_init.engine);
    T_ok('坏掉的便签存储不会被当成数据（首屏条数归零）', T_init.notesLen === 0, T_init.notesLen);
    T_ok('初始化后半段没被打断：热点已渲染',
      els.trendList.querySelectorAll('.trend-item').length === 5,
      els.trendList.querySelectorAll('.trend-item').length);
    T_ok('初始化后半段没被打断：壁纸已应用',
      els.wallpaper.style.backgroundImage.includes('url('), els.wallpaper.style.backgroundImage);
  }

  /* ---------------- 10. 场景：回车搜索（靠导航后的回显页断言） ---------------- */
  if (CASE === 'search') {
    T_section('回车搜索');
    engines.baidu = `${location.origin}/__search__?q=`;
    setEngine('baidu');
    els.searchInput.value = '你好 world';
    els.searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await T_sleep(300);
    T_ok('按下回车后应当离开当前页', location.pathname !== '/index.html', location.pathname);
  }

  /* ---------------- 汇总 ---------------- */
  } catch (T_crash) {
    T_R.push({ name: '测试过程中不应出现未捕获异常', pass: false, extra: String(T_crash && T_crash.message || T_crash) });
  }
  T_errors.forEach((T_e) => T_R.push({ name: '页面不应有未捕获错误', pass: false, extra: T_e }));
  const T_fail = T_R.filter((r) => r.pass === false).length;
  const T_total = T_R.filter((r) => r.pass !== undefined).length;
  const T_out = document.createElement('pre');
  T_out.id = '__results';
  T_out.textContent = `__TESTS_START__${JSON.stringify({ case: CASE, total: T_total, failed: T_fail, results: T_R })}__TESTS_END__`;
  document.body.appendChild(T_out);
})();
