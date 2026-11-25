'use strict';
// Интерфейс «Ягодки»: вкладки, колонка сервисов и расширений, адресная строка, вторая панель, быстрый переход, настройки.
const $ = id => document.getElementById(id);
const api = window.lokal;
let S = null;            // состояние от основного процесса
let overlay = null;      // какое окно открыто поверх: palette | settings | auth
let dragging = false;    // тянем разделитель панелей
let addrDirty = false;
let settingsTab = 'services', settingsRedraw = null;
let infoTimer = null;
let fading = false, fadeTimer = null;   // окно поверх плавно закрывается — страницы пока не возвращаем

const ICON = {
  back: '<path d="M10 3 5 8l5 5"/>', forward: '<path d="m6 3 5 5-5 5"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.6-3.6"/><path d="M13.2 2.4v2.8h-2.8"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>', plus: '<path d="M8 3v10M3 8h10"/>',
  star: '<path d="m8 2 1.8 3.8 4.2.6-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.6z"/>',
  split: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M9.5 3v10"/>',
  menu: '<path d="M3 4.5h10M3 8h10M3 11.5h10"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  up: '<path d="m4 10 4-4 4 4"/>', down: '<path d="m4 6 4 4 4-4"/>',
  swap: '<path d="M3 6h9l-2.5-2.5M13 10H4l2.5 2.5"/>',
  trash: '<path d="M3.5 5h9M6.5 5V3.5h3V5M5 5l.5 8h5L11 5"/>',
  globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11"/>',
  pin: '<path d="M8 2v7M4.5 9h7M8 9v5M5.5 2h5"/>',
  logo: '<circle cx="8" cy="9.6" r="4.3" fill="currentColor" stroke="none"/><path d="M8 5.2c.1-1.6 1.1-2.7 2.9-2.9"/><path d="M7.9 5.1C6.9 3.6 5.5 3.3 4.2 3.8"/>',
  copy: '<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6"/><path d="M10.5 5.5V4.2A1.2 1.2 0 0 0 9.3 3H4.2A1.2 1.2 0 0 0 3 4.2v5.1a1.2 1.2 0 0 0 1.2 1.2h1.3"/>',
  key: '<circle cx="5.5" cy="10.5" r="2.6"/><path d="m7.4 8.6 5.4-5.4M10.6 5.4l1.7 1.7"/>',
};
const svg = n => '<svg viewBox="0 0 16 16" aria-hidden="true">' + ICON[n] + '</svg>';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'icon') el.innerHTML = svg(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) el.append(c); });
  return el;
}
function letter(name) {
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.codePointAt(0)) % 360;
  return h('span', { class: 'letter', style: 'background:hsl(' + n + ' 50% 46%)' }, (String(name).trim()[0] || '?').toUpperCase());
}
function iconEl(src, name) {
  if (!src) return letter(name);
  const img = h('img', { src, alt: '', draggable: false });
  img.addEventListener('error', () => img.replaceWith(letter(name)));
  return img;
}
const activeTab = () => S && S.tabs.find(t => t.id === S.activeId);
const sideTab = () => S && S.tabs.find(t => t.id === S.sideId);
const tabTitle = t => t.title || (t.start ? 'Новая вкладка' : t.url);
const prettyUrl = u => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// ---------- отрисовка ----------
// Обновляет список на месте: старые элементы остаются (их анимации не сбрасываются), новые въезжают, лишние уезжают.
function sync(parent, items, make, update, animate) {
  const old = new Map();
  [...parent.children].forEach(c => { if (!c._leaving) old.set(c._key, c); });
  let prev = null;
  items.forEach(it => {
    let el = old.get(it.id);
    if (el) old.delete(it.id);
    else {
      el = make(it); el._key = it.id;
      if (animate && parent._ready) { el.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter'))); }
    }
    update(el, it);
    const ref = prev ? prev.nextSibling : parent.firstChild;
    if (ref !== el) parent.insertBefore(el, ref);
    prev = el;
  });
  old.forEach(el => {
    if (!animate) return el.remove();
    el._leaving = true; el.classList.add('leave');
    setTimeout(() => el.remove(), 280);
  });
  parent._ready = true;
}

function render() {
  const root = document.documentElement;
  root.classList.toggle('dark', !!S.dark);
  root.classList.toggle('still', S.settings.motion === false);
  root.dataset.accent = S.settings.accent || 'lilac';
  renderTabs(); renderRail(); renderToolbar(); renderPanes(); renderProgress();
  if (overlay === 'settings' && settingsRedraw) settingsRedraw();
  report();
}

function renderTabs() {
  sync($('tabs'), S.tabs.filter(t => t.kind === 'tab'), t => h('div', {
    class: 'tab', role: 'tab', tabIndex: 0,
    onclick: () => api.send('activate', t.id),
    onauxclick: e => { if (e.button === 1) api.send('closeTab', t.id); },
    oncontextmenu: e => { e.preventDefault(); api.send('menu', 'tab', t.id); },
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') api.send('activate', t.id); },
  }, h('span', { class: 'ico' }), h('span', { class: 'title' }),
    h('button', { class: 'x', icon: 'x', title: 'Закрыть (Ctrl+W)', onclick: e => { e.stopPropagation(); api.send('closeTab', t.id); } })),
  (el, t) => {
    el.classList.toggle('active', t.id === S.activeId);
    el.classList.toggle('side', t.id === S.sideId);
    const title = tabTitle(t);
    if (el.title !== title) { el.title = title; el.children[1].textContent = title; }
    const sig = t.loading ? 'spin' : (t.favicon || (t.start ? '+' : 'o'));
    if (el._sig !== sig) {
      el._sig = sig;
      el.children[0].replaceChildren(t.loading ? h('span', { class: 'spin' }) : t.favicon ? iconEl(t.favicon, title) : h('span', { icon: t.start ? 'plus' : 'globe' }));
    }
  }, true);
}

function renderRail() {
  sync($('services'), S.services, s => h('button', {
    class: 'rail-item',
    onclick: e => api.send('openService', s.id, e.ctrlKey || e.metaKey ? 'side' : 'main'),
    onauxclick: e => { if (e.button === 1) api.send('openService', s.id, 'side'); },
    oncontextmenu: e => { e.preventDefault(); api.send('menu', 'service', s.id); },
  }, h('span', { class: 'pic' })),
  (el, s) => {
    const i = S.services.indexOf(s), t = S.tabs.find(x => x.serviceId === s.id);
    el.classList.toggle('active', !!t && t.id === S.activeId);
    el.classList.toggle('side', !!t && t.id === S.sideId);
    el.classList.toggle('loaded', !!t);
    el.title = s.name + (i < 9 ? ' (Alt+' + (i + 1) + ')' : '') + '\nCtrl+клик — открыть рядом';
    const sig = (s.favicon || '') + '|' + s.name;
    if (el._sig !== sig) { el._sig = sig; el.firstChild.replaceChildren(iconEl(s.favicon, s.name)); }
  }, true);

  const list = S.extensions.filter(x => x.hasPanel || x.hasOptions || x.hasAction);
  $('extSep').hidden = !list.length;
  sync($('exts'), list, x => h('button', {
    class: 'rail-item',
    onclick: () => {
      const now = S.extensions.find(y => y.id === x.id) || x;
      if (!now.enabled) return api.send('menu', 'ext', x.id);
      api.send(now.hasPanel || now.hasAction ? 'openExt' : 'extOptions', x.id);
    },
    oncontextmenu: e => { e.preventDefault(); api.send('menu', 'ext', x.id); },
  }, h('span', { class: 'pic' })),
  (el, x) => {
    const t = S.tabs.find(y => y.kind === 'ext' && y.extId === x.id);
    el.classList.toggle('active', !!t && t.id === S.activeId);
    el.classList.toggle('side', !!t && t.id === S.sideId);
    el.classList.toggle('off', !x.enabled);
    el.title = x.title || x.name;
    if (el._sig !== x.icon) { el._sig = x.icon; el.firstChild.replaceChildren(iconEl(x.icon, x.name)); }
    const badge = x.enabled && x.badge ? x.badge + '|' + x.badgeColor : '';
    if (el._badge !== badge) {
      el._badge = badge;
      const old = el.querySelector('.badge');
      if (old) old.remove();
      if (badge) el.append(h('span', { class: 'badge', style: 'background:' + x.badgeColor }, x.badge));
    }
  }, true);
  requestAnimationFrame(moveIndicator);
}
// Цветная полоска слева переезжает к активному значку.
function moveIndicator() {
  const ind = $('rail-ind'), cur = $('sidebar').querySelector('.rail-item.active:not(.leave)');
  if (!cur) { ind.style.opacity = 0; return; }
  const y = cur.getBoundingClientRect().top - $('sidebar').getBoundingClientRect().top + (cur.offsetHeight - 22) / 2;
  ind.style.transform = 'translateY(' + Math.round(y) + 'px)';
  ind.style.opacity = 1;
}
$('services').addEventListener('scroll', moveIndicator);
$('exts').addEventListener('scroll', moveIndicator);

function renderToolbar() {
  const a = activeTab();
  $('back').disabled = !a || !a.canBack;
  $('forward').disabled = !a || !a.canForward;
  const want = a && a.loading ? 'x' : 'reload';
  if ($('reload')._icon !== want) { $('reload')._icon = want; $('reload').innerHTML = svg(want); }
  $('reload').title = a && a.loading ? 'Остановить' : 'Обновить (Ctrl+R)';
  if (!addrDirty || document.activeElement !== $('addr')) $('addr').value = !a || a.start ? '' : a.url;
  const glyph = a && /^https:/.test(a.url) ? 'lock' : a && a.start ? 'search' : 'globe';
  if ($('addr-icon')._icon !== glyph) { $('addr-icon')._icon = glyph; $('addr-icon').innerHTML = svg(glyph); }
  const marked = a && S.bookmarks.some(b => b.url === a.url);
  $('star').classList.toggle('on', !!marked);
  $('star').title = marked ? 'Убрать из закладок (Ctrl+D)' : 'В закладки (Ctrl+D)';
  $('star').disabled = !a || !/^https?:/.test(a.url);
  $('split').classList.toggle('on', !!S.sideId);
}

// Полоска загрузки под адресной строкой.
function renderProgress() {
  const el = $('progress'), a = activeTab(), on = !!(a && a.loading && !a.start);
  if (on) el.className = 'on';
  else if (el.className === 'on') { el.className = 'done'; setTimeout(() => { if (el.className === 'done') el.className = ''; }, 500); }
}

function renderPanes() {
  const a = activeTab(), s = sideTab();
  $('start').hidden = !(a && a.start && !a.error);
  if (!$('start').hidden) renderStart(); else $('start')._sig = null;
  $('error').hidden = !(a && a.error);
  if (a && a.error) {
    const sig = a.id + '|' + a.error.url + '|' + a.error.code;
    if ($('error')._sig !== sig) {
      $('error')._sig = sig;
      $('error').replaceChildren(h('div', { class: 'err' },
        h('div', { class: 'face' }, '🛰️'),
        h('h1', null, 'Не удалось открыть страницу'),
        h('p', null, a.error.url || a.url),
        h('p', null, a.error.desc + (a.error.code ? ' (' + a.error.code + ')' : '')),
        h('div', { class: 'foot', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: () => api.send('reload') }, 'Повторить'))));
    }
  } else $('error')._sig = null;
  $('content').classList.toggle('split', !!s);
  if (s) {
    const sig = s.favicon + '|' + tabTitle(s);
    if ($('side-icon')._sig !== sig) { $('side-icon')._sig = sig; $('side-icon').replaceChildren(s.favicon ? iconEl(s.favicon, tabTitle(s)) : ''); }
    $('side-title').textContent = s.error ? 'Не удалось открыть: ' + s.error.desc : tabTitle(s);
    $('sideBack').disabled = !s.canBack;
  }
  if (!dragging) $('content').style.setProperty('--side', Math.round((S.settings.sideRatio || 0.36) * 1000) / 10 + '%');
}

const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер'; };
const clockText = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function renderStart() {
  // Собираем один раз, пока не поменялись сервисы и закладки: иначе анимации перезапускались бы при каждом обновлении.
  const sig = JSON.stringify([S.services.map(s => [s.id, s.name, s.favicon]), S.bookmarks.slice(0, 30)]);
  if ($('start')._sig === sig) return;
  $('start')._sig = sig;
  const keys = [['Ctrl+K', 'быстрый переход'], ['Ctrl+T', 'новая вкладка'], ['Ctrl+\\', 'вторая панель'], ['Alt+1…9', 'сервисы'],
    ['Ctrl+клик', 'открыть рядом'], ['Ctrl+Shift+T', 'вернуть закрытую'], ['Ctrl+F', 'поиск по странице']];
  const hero = h('input', { type: 'text', spellcheck: false, placeholder: 'Куда отправимся?', 'aria-label': 'Адрес или поиск',
    onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) api.send('navigate', e.target.value); } });
  $('start').replaceChildren(
    h('div', { class: 'aurora' }, h('i'), h('i'), h('i')),
    h('div', { class: 'start' },
      h('div', { class: 'clock', id: 'clock' }, clockText()),
      h('h1', { id: 'hello' }, greeting()),
      h('label', { class: 'hero' }, h('span', { icon: 'search' }), hero, h('kbd', null, 'Ctrl+K — всё сразу')),
      h('h2', null, 'Сервисы'),
      h('div', { class: 'tiles' }, S.services.map((s, i) => h('button', {
        class: 'tile', title: s.url, style: '--i:' + i, onclick: e => api.send('openService', s.id, e.ctrlKey ? 'side' : 'main'),
      }, iconEl(s.favicon, s.name), h('span', { class: 'name' }, s.name)))),
      S.bookmarks.length ? h('h2', null, 'Закладки') : null,
      S.bookmarks.length ? h('div', { class: 'rows' }, S.bookmarks.slice(0, 30).map(b => h('button', {
        class: 'row', onclick: () => api.send('navigate', b.url),
        oncontextmenu: e => { e.preventDefault(); api.send('removeBookmark', b.url); },
        title: 'Правая кнопка — убрать из закладок',
      }, h('span', { icon: 'star' }), h('span', { class: 't' }, b.title), h('span', { class: 'u' }, prettyUrl(b.url))))) : null,
      h('h2', null, 'Клавиши'),
      h('div', { class: 'keys' }, keys.map(k => h('div', null, h('b', null, k[0]), k[1])))));
}
setInterval(() => { if ($('clock')) { $('clock').textContent = clockText(); $('hello').textContent = greeting(); } }, 15000);

// ---------- где показывать страницы ----------
let reportQueued = false;
function report() {
  if (reportQueued || !S) return;
  reportQueued = true;
  requestAnimationFrame(() => {
    reportQueued = false;
    const hide = !!overlay || dragging || fading, a = activeTab();
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
    api.send('layout', {
      main: hide || !a || a.start || a.error ? null : rect($('ph-main')),
      side: hide || !S.sideId ? null : rect($('ph-side')),
    });
  });
}
new ResizeObserver(report).observe($('ph-main'));
new ResizeObserver(report).observe($('ph-side'));
addEventListener('resize', report);

function setShots(s) {
  [['ph-main', s && s.main], ['ph-side', s && s.side]].forEach(([id, data]) => {
    $(id).style.backgroundImage = data ? 'url(' + data + ')' : '';
    $(id).style.backgroundSize = '100% 100%';
  });
}

// ---------- окна поверх страницы ----------
// Страницы сайтов рисуются поверх интерфейса, поэтому на время окна их заменяет снимок.
async function openOverlay(kind, build) {
  clearTimeout(fadeTimer);
  if (!overlay && !fading) setShots(await api.send('snapshot'));
  fading = false;
  overlay = kind;
  const d = $('dialog');
  d.className = kind;
  d.replaceChildren();
  build(d);
  $('overlay').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (overlay) $('overlay').classList.add('open'); }));
  report();
}
function closeOverlay(keepFocus) {
  if (!overlay) return;
  overlay = null; settingsRedraw = null; fading = true;
  $('overlay').classList.remove('open');
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    fading = false;
    $('overlay').hidden = true;
    report();
    setTimeout(() => { if (!overlay && !dragging && !fading) setShots(null); }, 160);
    if (!keepFocus) api.send('focusPage');
  }, document.documentElement.classList.contains('still') ? 0 : 170);
}
$('overlay').addEventListener('mousedown', e => { if (e.target === $('overlay') && overlay !== 'auth') closeOverlay(); });

// ---------- быстрый переход ----------
function openPalette() {
  openOverlay('palette', d => {
    const input = h('input', { class: 'pal-input', type: 'text', spellcheck: false, placeholder: 'Сервис, вкладка, закладка, адрес или запрос' });
    const list = h('div', { class: 'pal-list rows' });
    d.append(h('div', { class: 'pal-top' }, h('span', { icon: 'search' }), input), list, h('div', { class: 'pal-hint' }, 'Enter — открыть · Ctrl+Enter — открыть рядом · Esc — закрыть'));
    let items = [], sel = 0, token = 0;
    const go = (item, where) => { closeOverlay(true); item.run(where); };

    function collect(q, hist) {
      const words = q.split(/\s+/).filter(Boolean);
      const ok = (...parts) => { const hay = parts.join(' ').toLowerCase(); return words.every(w => hay.indexOf(w) >= 0); };
      const out = [], seen = new Set();
      S.services.forEach(s => { if (ok(s.name, s.url)) { out.push({ k: 'Сервис', t: s.name, u: prettyUrl(s.url), icon: s.favicon, run: w => api.send('openService', s.id, w) }); seen.add(s.url); } });
      S.extensions.forEach(x => { if (x.enabled && x.hasPanel && ok(x.name)) out.push({ k: 'Расширение', t: x.name, u: x.description, icon: x.icon, run: w => api.send('openExt', x.id, w === 'side' ? undefined : 'main') }); });
      S.tabs.forEach(t => { if (t.kind === 'tab' && !t.start && t.id !== S.activeId && ok(t.title, t.url)) { out.push({ k: 'Вкладка', t: tabTitle(t), u: prettyUrl(t.url), icon: t.favicon, run: w => api.send(w === 'side' ? 'setSide' : 'activate', t.id) }); seen.add(t.url); } });
      S.bookmarks.forEach(b => { if (!seen.has(b.url) && ok(b.title, b.url)) { out.push({ k: 'Закладка', t: b.title, u: prettyUrl(b.url), run: w => api.send('newTab', b.url, w) }); seen.add(b.url); } });
      hist.forEach(x => { if (!seen.has(x.url)) { out.push({ k: 'История', t: x.title || prettyUrl(x.url), u: prettyUrl(x.url), run: w => api.send('newTab', x.url, w) }); seen.add(x.url); } });
      const top = out.slice(0, 11);
      if (q) {
        const isUrl = !/\s/.test(q) && /^([a-z]+:\/\/|localhost|[^\s/]+\.[^\s/.]{2,})/i.test(q);
        const direct = { glyph: isUrl ? 'globe' : 'search', k: isUrl ? 'Адрес' : 'Поиск', t: isUrl ? 'Открыть ' + q : 'Искать «' + q + '»', u: '', run: w => api.send('newTab', q, w) };
        if (isUrl) top.unshift(direct); else top.push(direct);
      }
      return top;
    }
    let drawn = null;
    function draw() {
      if (drawn !== items) {
        drawn = items;
        list.classList.add('fresh');
        list.replaceChildren(...items.map((it, i) => h('button', {
          class: 'row', style: '--i:' + i, onclick: e => go(it, e.ctrlKey ? 'side' : 'main'), onmousemove: () => { if (sel !== i) { sel = i; draw(); } },
        }, it.glyph ? h('span', { class: 'glyph', icon: it.glyph }) : it.icon ? iconEl(it.icon, it.t) : letter(it.t), h('span', { class: 't' }, it.t), h('span', { class: 'u' }, it.u || ''), h('span', { class: 'k' }, it.k))));
      }
      [...list.children].forEach((el, i) => el.classList.toggle('sel', i === sel));
      const cur = list.children[sel];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    async function update() {
      const q = input.value.trim().toLowerCase(), my = ++token;
      const hist = await api.send('suggest', q);
      if (my !== token) return;
      items = collect(input.value.trim(), hist || []);
      sel = 0; draw();
    }
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) go(items[sel], e.ctrlKey ? 'side' : 'main');
    });
    update();
    setTimeout(() => input.focus(), 0);
  });
}

// ---------- настройки ----------
function openSettings(tab) {
  if (tab) settingsTab = tab;
  let services = S.services.map(s => Object.assign({}, s));
  let lookups = S.lookups.map(l => Object.assign({}, l));
  openOverlay('settings', d => {
    const body = h('div', { class: 'set-body' });
    const TABS = [['services', 'Сервисы'], ['lookups', 'Перевод выделенного'], ['extensions', 'Расширения'], ['passwords', 'Пароли'], ['general', 'Общее']];
    const pwBox = h('div');
    const tabsEl = h('div', { class: 'set-tabs' });
    d.append(h('div', { class: 'set-head' }, h('h1', null, 'Настройки'), h('button', { class: 'icon-btn', icon: 'x', title: 'Закрыть', onclick: () => closeOverlay() })), tabsEl, body);

    function listEditor(rows, cols, blank) {
      const wrap = h('div');
      const draw = () => wrap.replaceChildren(...rows.map((r, i) => h('div', { class: 'grid-row' },
        cols.map(c => h('input', { class: 'field', type: 'text', value: r[c.key] || '', placeholder: c.ph, spellcheck: false, 'aria-label': c.ph, oninput: e => { r[c.key] = e.target.value; } })),
        h('div', { class: 'acts' },
          h('button', { class: 'icon-btn small', icon: 'up', title: 'Выше', disabled: i === 0, onclick: () => { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); draw(); } }),
          h('button', { class: 'icon-btn small', icon: 'down', title: 'Ниже', disabled: i === rows.length - 1, onclick: () => { rows.splice(i + 1, 0, rows.splice(i, 1)[0]); draw(); } }),
          h('button', { class: 'icon-btn small', icon: 'trash', title: 'Удалить', onclick: () => { rows.splice(i, 1); draw(); } })))),
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => { rows.push(blank()); draw(); wrap.querySelector('.grid-row:last-of-type input').focus(); } }, 'Добавить')));
      draw();
      return wrap;
    }
    const SECTIONS = {
      services: () => [
        h('p', { class: 'note' }, 'Сервисы закреплены в левой колонке и остаются открытыми, пока работает браузер. Ctrl+клик по значку открывает сервис рядом с текущей страницей.'),
        listEditor(services, [{ key: 'name', ph: 'Название' }, { key: 'url', ph: 'Адрес' }], () => ({ name: '', url: '' })),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { api.send('saveServices', services); toast('Сервисы сохранены.'); } }, 'Сохранить')),
      ],
      lookups: () => [
        h('p', { class: 'note' }, 'Выделите текст на любой странице и нажмите правую кнопку: эти пункты откроют его рядом. В адресе %s заменяется на выделенный текст.'),
        listEditor(lookups, [{ key: 'name', ph: 'Название' }, { key: 'url', ph: 'Адрес с %s' }], () => ({ name: '', url: 'https://' })),
        h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { api.send('saveLookups', lookups); toast('Сохранено.'); } }, 'Сохранить')),
      ],
      extensions: () => [
        h('p', { class: 'note' }, 'Расширения запускаются прямо из папки, без магазина. Поддерживаются контент-скрипты, боковая панель, настройки, фоновый скрипт, уведомления и хранилище. Расширения из магазина Chrome, которым нужны другие возможности, могут не заработать.'),
        S.extensions.length ? null : h('p', { class: 'note' }, 'Пока нет ни одного расширения.'),
        S.extensions.map(x => h('div', { class: 'ext-card' },
          iconEl(x.icon, x.name),
          h('div', { class: 'meta' }, h('b', null, x.name + (x.version ? ' ' + x.version : '')), h('span', null, x.description), x.sites.length ? h('span', null, 'Работает на: ' + x.sites.map(prettyUrl).join(', ')) : null, x.bundled ? null : h('span', null, x.dir)),
          h('div', { class: 'acts' },
            h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: x.enabled, onchange: e => api.send('extEnable', x.id, e.target.checked) }), 'Включено'),
            x.hasOptions ? h('button', { class: 'btn ghost', onclick: () => { closeOverlay(true); api.send('extOptions', x.id); } }, 'Настройки') : null,
            x.bundled ? null : h('button', { class: 'btn danger', onclick: () => api.send('extRemove', x.id) }, 'Убрать')))),
        h('div', { class: 'foot' },
          h('button', { class: 'btn', onclick: () => api.send('extAdd') }, 'Добавить из папки…'),
          h('button', { class: 'btn ghost', onclick: () => api.send('extReload') }, 'Перезапустить расширения')),
      ],
      passwords: () => {
        const load = async () => {
          const ok = await api.send('pwAvailable'), list = ok ? await api.send('pwList') : [];
          pwBox.replaceChildren(...(!ok ? [h('p', { class: 'note' }, 'Система не даёт зашифровать пароли, поэтому сохранение недоступно.')]
            : !list.length ? [h('p', { class: 'note' }, 'Пока ничего не сохранено. Войдите на любой сайт — браузер предложит запомнить пароль.')]
            : list.map(i => h('div', { class: 'ext-card pw-row' },
              h('span', { class: 'pw-ico', icon: 'key' }),
              h('div', { class: 'meta' }, h('b', null, prettyUrl(i.origin)), h('span', null, i.username || 'без логина')),
              h('div', { class: 'acts', style: 'flex-direction:row' },
                h('button', { class: 'btn ghost', onclick: async () => { toast(await api.send('pwCopy', i.id) ? 'Пароль скопирован. Через 30 секунд он сам сотрётся из буфера.' : 'Не удалось расшифровать пароль.'); } }, 'Скопировать'),
                h('button', { class: 'btn danger', onclick: async () => { await api.send('pwDelete', i.id); load(); } }, 'Удалить'))))));
        };
        load();
        return [
          h('p', { class: 'note' }, 'Пароли хранятся только на этом компьютере и зашифрованы средствами Windows: открыть их можно лишь под вашей учётной записью. Подставить сохранённый пароль вручную — правая кнопка мыши в поле ввода.'),
          h('div', { class: 'foot', style: 'margin:0 0 14px' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.settings.savePasswords !== false, onchange: e => api.send('saveSettings', { savePasswords: e.target.checked }) }), 'Предлагать сохранять пароли')),
          pwBox,
        ];
      },
      general: () => [
        h('label', { class: 'lbl', for: 'setSearch' }, 'Поиск из адресной строки'),
        h('select', { class: 'field', id: 'setSearch', style: 'max-width:260px', onchange: e => api.send('saveSettings', { search: e.target.value }) },
          S.search.map(e => h('option', { value: e.id, selected: e.id === S.settings.search }, e.name))),
        h('h2', null, 'Цвет'),
        h('div', { class: 'swatches' }, [['lilac', 'Сирень', '#7c3aed,#c026d3,#f472b6'], ['sunset', 'Закат', '#f0582a,#e83e8c,#8b5cf6'], ['mint', 'Мята', '#0d9f76,#0aa5c4,#6366f1'],
          ['ocean', 'Океан', '#2563eb,#5b5bf0,#22b8cf'], ['graphite', 'Графит', '#505a6b,#6b7280,#94a3b8']].map(a => h('button', {
          class: 'swatch' + ((S.settings.accent || 'lilac') === a[0] ? ' on' : ''), onclick: () => api.send('saveSettings', { accent: a[0] }),
        }, h('i', { style: 'background:linear-gradient(135deg,' + a[2] + ')' }), a[1]))),
        h('h2', null, 'Оформление'),
        h('select', { class: 'field', 'aria-label': 'Оформление', style: 'max-width:260px', onchange: e => api.send('saveSettings', { theme: e.target.value }) },
          [['system', 'Как в системе'], ['light', 'Светлое'], ['dark', 'Тёмное']].map(o => h('option', { value: o[0], selected: o[0] === S.settings.theme }, o[1]))),
        h('div', { class: 'foot' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.settings.motion !== false, onchange: e => api.send('saveSettings', { motion: e.target.checked }) }), 'Анимации')),
        h('h2', null, 'Данные'),
        h('p', { class: 'note' }, 'Всё хранится только на этом компьютере, в папке профиля браузера.'),
        h('div', { class: 'foot' },
          h('button', { class: 'btn ghost', onclick: () => api.send('clearHistory') }, 'Очистить историю'),
          h('button', { class: 'btn danger', onclick: () => api.send('clearData') }, 'Выйти со всех сайтов…')),
        h('h2', null, 'О программе'),
        h('p', { class: 'note' }, 'Ягодка ' + S.version + ' — рабочий браузер на Chromium.'),
      ],
    };
    function draw() {
      tabsEl.replaceChildren(...TABS.map(t => h('button', { class: t[0] === settingsTab ? 'on' : '', onclick: () => { settingsTab = t[0]; draw(); } }, t[1])));
      body.replaceChildren(...SECTIONS[settingsTab]().flat().filter(Boolean));
    }
    settingsRedraw = () => { if (settingsTab === 'extensions' || settingsTab === 'general') draw(); };
    draw();
  });
}

function openAuth(p) {
  openOverlay('auth', d => {
    const user = h('input', { class: 'field', type: 'text', placeholder: 'Логин', 'aria-label': 'Логин' });
    const pass = h('input', { class: 'field', type: 'password', placeholder: 'Пароль', 'aria-label': 'Пароль' });
    const answer = ok => { closeOverlay(); api.send('authReply', p.id, ok ? user.value : null, pass.value); };
    d.append(h('b', null, (p.proxy ? 'Прокси ' : 'Сайт ') + p.host + ' просит логин и пароль'), user, pass,
      h('div', { class: 'foot', style: 'justify-content:flex-end' },
        h('button', { class: 'btn ghost', onclick: () => answer(false) }, 'Отмена'),
        h('button', { class: 'btn', onclick: () => answer(true) }, 'Войти')));
    d.onkeydown = e => { if (e.key === 'Enter') answer(true); else if (e.key === 'Escape') { e.stopPropagation(); answer(false); } };
    setTimeout(() => user.focus(), 0);
  });
}

// ---------- строка сообщений и поиск по странице ----------
function toast(text, action, cmd, hold) {
  $('infoText').textContent = text;
  $('infoText').title = text;
  $('infoAction').hidden = !action;
  $('infoAction').textContent = action || '';
  $('infoAction').onclick = cmd ? () => { api.send(...cmd); hideInfo(); } : null;
  $('infobar').hidden = false;
  clearTimeout(infoTimer);
  infoTimer = setTimeout(hideInfo, hold || 9000);
}
function hideInfo() { $('infobar').hidden = true; clearTimeout(infoTimer); }

function openFind() {
  $('findbar').hidden = false;
  $('findInput').focus(); $('findInput').select();
  if ($('findInput').value) api.send('find', $('findInput').value, true, false);
}
function closeFind() {
  if ($('findbar').hidden) return;
  $('findbar').hidden = true; $('findCount').textContent = '';
  api.send('findStop');
}

// ---------- кнопки ----------
[['back', 'back'], ['forward', 'forward'], ['reload', 'reload'], ['star', 'star'], ['split', 'split'], ['menu', 'menu'], ['newTab', 'plus'],
  ['addService', 'pin'], ['openSettings', 'gear'], ['findPrev', 'up'], ['findNext', 'down'], ['findClose', 'x'], ['infoClose', 'x'],
  ['sideBack', 'back'], ['sideReload', 'reload'], ['sideSwap', 'swap'], ['sideClose', 'x']].forEach(([id, icon]) => { $(id).innerHTML = svg(icon); });
$('logo').innerHTML = svg('logo');

$('back').onclick = () => api.send('back');
$('forward').onclick = () => api.send('forward');
$('reload').onclick = () => api.send('reload');
$('star').onclick = () => api.send('toggleBookmark');
$('split').onclick = () => api.send('toggleSide');
$('menu').onclick = () => api.send('menu', 'main');
$('newTab').onclick = () => api.send('newTab');
$('addService').onclick = () => api.send('addService');
$('openSettings').onclick = () => openSettings();
$('sideBack').onclick = () => api.send('back', S.sideId);
$('sideReload').onclick = () => api.send('reload', S.sideId);
$('sideSwap').onclick = () => api.send('swap');
$('sideClose').onclick = () => api.send('setSide', 0);
$('infoClose').onclick = hideInfo;
$('findClose').onclick = closeFind;
$('findNext').onclick = () => api.send('find', $('findInput').value, true, true);
$('findPrev').onclick = () => api.send('find', $('findInput').value, false, true);
$('findInput').addEventListener('input', () => { api.send('find', $('findInput').value, true, false); if (!$('findInput').value) $('findCount').textContent = ''; });
$('findInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') api.send('find', $('findInput').value, !e.shiftKey, true);
  else if (e.key === 'Escape') closeFind();
});

const addr = $('addr');
addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));
addr.addEventListener('input', () => { addrDirty = true; });
addr.addEventListener('blur', () => { addrDirty = false; if (S) renderToolbar(); });
addr.addEventListener('keydown', e => {
  if (e.key === 'Enter' && addr.value.trim()) { addrDirty = false; api.send('navigate', addr.value); addr.blur(); }
  else if (e.key === 'Escape') { addrDirty = false; addr.blur(); api.send('focusPage'); }
});

// Разделитель панелей.
(function () {
  const div = $('divider');
  let down = false, ratio = 0;
  div.addEventListener('pointerdown', async e => {
    e.preventDefault();
    down = true; ratio = 0;
    div.setPointerCapture(e.pointerId);
    const shots = await api.send('snapshot');
    if (!down) return;
    setShots(shots);
    dragging = true; div.classList.add('drag-on'); $('content').classList.add('resizing');
    report();
  });
  div.addEventListener('pointermove', e => {
    if (!down) return;
    const c = $('content').getBoundingClientRect();
    ratio = Math.max(0.2, Math.min(0.7, (c.right - e.clientX) / c.width));
    $('content').style.setProperty('--side', Math.round(ratio * 1000) / 10 + '%');
  });
  const up = () => {
    if (!down) return;
    down = false; dragging = false; div.classList.remove('drag-on'); $('content').classList.remove('resizing');
    if (ratio) api.send('saveSettings', { sideRatio: ratio });
    report();
    setTimeout(() => { if (!overlay && !dragging) setShots(null); }, 160);
  };
  div.addEventListener('pointerup', up);
  div.addEventListener('pointercancel', up);
})();

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (overlay && overlay !== 'auth') closeOverlay();
  else if (!$('findbar').hidden) closeFind();
});

// ---------- события от браузера ----------
api.on((name, p) => {
  if (name === 'state') { S = p; render(); }
  else if (name === 'cmd') {
    if (p === 'focus-address') { closeOverlay(true); addr.focus(); addr.select(); }
    else if (p === 'palette') overlay === 'palette' ? closeOverlay() : openPalette();
    else if (p === 'find') openFind();
    else if (p === 'settings') openSettings();
    else if (p.indexOf('settings:') === 0) openSettings(p.slice(9));
  } else if (name === 'found') $('findCount').textContent = p.total ? p.active + ' из ' + p.total : 'не найдено';
  else if (name === 'info') toast(p.text, p.action, p.cmd, p.hold);
  else if (name === 'auth') openAuth(p);
});
api.send('ready');
