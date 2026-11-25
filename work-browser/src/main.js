'use strict';
// «Локаль» — рабочий браузер: вкладки, закреплённые сервисы, вторая панель рядом и свои расширения из папки.
const path = require('path');
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, dialog, session, nativeTheme, clipboard, protocol } = require('electron');
const { JsonFile, DEFAULTS, SEARCH } = require('./store');
const Extensions = require('./extensions');

protocol.registerSchemesAsPrivileged([
  { scheme: 'locext', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true, stream: true } },
]);
app.setName('Lokal');
if (process.env.LOKAL_USER_DATA) app.setPath('userData', process.env.LOKAL_USER_DATA);
// Сайты видят обычный Chrome: без пометки Electron вход в Google и подобные сервисы работает надёжнее.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|Lokal|lokal-browser)\/\S+/gi, '');

const START = 'lokal://start';
const TAB_PREFS = () => ({ preload: path.join(__dirname, 'preload-tab.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true });
const COLORS = { light: { bar: '#f1eefa', symbol: '#2b2440' }, dark: { bar: '#13101b', symbol: '#e9e4f5' } };

let win, store, exts;
let tabs = [], activeId = 0, sideId = 0, lastTabId = 0, seq = 0;
let rects = { main: null, side: null }, fsTab = null, statePending = false;
const closed = [], downloads = new Set(), auths = new Map(), granted = {};
let authSeq = 0;

const byId = id => tabs.find(t => t.id === id);
const active = () => byId(activeId);
const byWc = wc => tabs.find(t => t.wc === wc);
const ui = (name, payload) => { if (win && !win.isDestroyed()) win.webContents.send('ui:event', name, payload); };
const host = u => { try { return new URL(u).host; } catch (e) { return ''; } };

// ---------- адрес или поиск ----------
function toUrl(input) {
  const s = String(input || '').trim();
  if (!s) return START;
  if (/^(https?|locext|file|about|view-source):/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^\s:]+:\d+/.test(s)) return searchUrl(s);   // чужие схемы (javascript: и т.п.) не открываем
  if (!/\s/.test(s) && (/^localhost(:\d+)?(\/|$)/i.test(s) || /^[^\s/]+\.[^\s/.]{2,}(:\d+)?(\/.*)?$/.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s))) {
    return (/^(localhost|\d)/i.test(s) ? 'http://' : 'https://') + s;
  }
  return searchUrl(s);
}
function searchUrl(q) {
  const eng = SEARCH[store.data.settings.search] || SEARCH.yandex;
  return eng.url.replace('%s', encodeURIComponent(q));
}

// ---------- вкладки ----------
function createTab(o) {
  o = o || {};
  const view = new WebContentsView(o.webContents ? { webContents: o.webContents } : { webPreferences: TAB_PREFS() });
  const tab = {
    id: ++seq, view, wc: view.webContents, kind: o.kind || 'tab', serviceId: o.serviceId || null, extId: o.extId || null,
    url: o.url || START, title: o.title || '', favicon: '', loading: false, error: null, pendingUrl: null,
  };
  view.setBackgroundColor('#ffffff');
  if (view.setBorderRadius) view.setBorderRadius(8);
  view.setVisible(false);
  win.contentView.addChildView(view);
  wire(tab);
  if (o.index != null) tabs.splice(o.index, 0, tab); else tabs.push(tab);
  if (!o.webContents && tab.url !== START) {
    if (o.lazy) tab.pendingUrl = tab.url; else tab.wc.loadURL(tab.url).catch(() => {});
  }
  if (o.activate !== false) activateTab(tab.id); else pushState();
  return tab;
}

function wire(tab) {
  const wc = tab.wc;
  wc.on('page-title-updated', (e, title) => { tab.title = title; touchHistory(tab); pushState(); });
  wc.on('page-favicon-updated', (e, icons) => {
    tab.favicon = icons[0] || '';
    const svc = tab.serviceId && store.data.services.find(s => s.id === tab.serviceId);
    if (svc && tab.favicon && host(tab.url) === host(svc.url) && svc.favicon !== tab.favicon) { svc.favicon = tab.favicon; store.save(); }
    pushState();
  });
  wc.on('did-start-loading', () => { tab.loading = true; pushState(); tabEvent(tab, { status: 'loading' }); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushState(); tabEvent(tab, { status: 'complete' }); });
  wc.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain && !inPlace && tab.error) { tab.error = null; applyLayout(); pushState(); } });
  const navigated = () => {
    tab.url = wc.getURL() || tab.url;
    touchHistory(tab);
    pushState(); saveSession();
    tabEvent(tab, { url: tab.url });
  };
  wc.on('did-navigate', navigated);
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) navigated(); });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    tab.error = { code, desc, url }; tab.url = url || tab.url; tab.loading = false;
    applyLayout(); pushState();
  });
  wc.on('render-process-gone', (e, d) => {
    if (d.reason === 'clean-exit') return;
    tab.error = { code: 0, desc: 'Страница неожиданно закрылась (' + d.reason + ')', url: tab.url };
    applyLayout(); pushState();
  });
  wc.on('found-in-page', (e, r) => { if (tab.id === activeId) ui('found', { active: r.activeMatchOrdinal, total: r.matches }); });
  wc.on('enter-html-full-screen', () => { fsTab = tab; applyLayout(); });
  wc.on('leave-html-full-screen', () => { fsTab = null; applyLayout(); });
  wc.on('before-input-event', onKey(tab));
  wc.on('context-menu', (e, p) => pageMenu(tab, p));
  wc.on('will-navigate', (e, url) => { if (!/^(https?|locext|about|blob|data|file):/i.test(url)) { e.preventDefault(); externalLink(url); } });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (!/^(https?|locext|about):/i.test(url)) { externalLink(url); return { action: 'deny' }; }
    return {
      action: 'allow',
      createWindow: options => createTab({ webContents: options.webContents, url, activate: disposition !== 'background-tab', index: nextIndex(tab) }).wc,
    };
  });
}
// Ссылки вроде mailto: и tg: открывает система — после вопроса.
function externalLink(url) {
  const scheme = String(url).split(':')[0].toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme) || ['javascript', 'vbscript', 'file', 'chrome'].indexOf(scheme) >= 0) return;
  dialog.showMessageBox(win, { type: 'question', buttons: ['Открыть', 'Отмена'], cancelId: 1, message: 'Открыть ссылку в другой программе?', detail: String(url).slice(0, 300) })
    .then(r => { if (r.response === 0) shell.openExternal(url); });
}
const nextIndex = tab => { const i = tabs.indexOf(tab); return tab.kind === 'tab' && i >= 0 ? i + 1 : null; };

function touchHistory(tab) {
  const url = tab.url;
  if (!/^https?:/.test(url) || tab.error) return;
  const h = store.data.history;
  const i = h.findIndex(x => x.url === url);
  const item = i >= 0 ? h.splice(i, 1)[0] : { url, title: '' };
  item.title = tab.title || item.title; item.t = Date.now();
  h.unshift(item);
  if (h.length > 3000) h.length = 3000;
  store.save();
}

function activateTab(id) {
  const tab = byId(id);
  if (!tab) return;
  if (sideId === id) sideId = 0;
  activeId = id;
  tab.seen = Date.now();
  if (tab.kind === 'tab') lastTabId = id;
  wake(tab);
  applyLayout(); rise(tab); pushState(); saveSession();
  if (tab.url === START) { win.webContents.focus(); ui('cmd', 'focus-address'); } else tab.wc.focus();
}
function wake(tab) {
  if (tab.pendingUrl) { const u = tab.pendingUrl; tab.pendingUrl = null; tab.wc.loadURL(u).catch(() => {}); }
}

function closeTab(id) {
  const tab = byId(id);
  if (!tab) return;
  const i = tabs.indexOf(tab);
  if (tab.kind === 'tab' && tab.url !== START) { closed.push({ url: tab.url, title: tab.title }); if (closed.length > 25) closed.shift(); }
  tabs.splice(i, 1);
  if (exts && tab.kind !== 'ext') exts.tabRemoved(tab.id);
  if (fsTab === tab) fsTab = null;
  if (sideId === id) sideId = 0;
  win.contentView.removeChildView(tab.view);
  if (!tab.wc.isDestroyed()) tab.wc.close();
  if (activeId === id) {
    // Закрыли обычную вкладку — идём на соседнюю; выгрузили сервис — возвращаемся на последнюю вкладку.
    const plain = tabs.filter(t => t.kind === 'tab' && t.id !== sideId);
    const prev = byId(lastTabId);
    const next = tab.kind !== 'tab' && prev && prev.id !== sideId ? prev : (plain.find(t => tabs.indexOf(t) >= i) || plain[plain.length - 1]);
    if (next) activateTab(next.id); else createTab({});
  } else { applyLayout(); pushState(); saveSession(); }
}

function navigate(tab, input) {
  const url = toUrl(input);
  if (url === START) return;
  tab.error = null; tab.pendingUrl = null; tab.url = url;
  tab.wc.loadURL(url).catch(() => {});
  applyLayout(); pushState();
  tab.wc.focus();
}

function setSide(id) {
  const tab = byId(id);
  if (!tab) { sideId = 0; applyLayout(); pushState(); return; }
  if (activeId === id) {
    const other = tabs.find(t => t.kind === 'tab' && t.id !== id && t.id === lastTabId) || tabs.find(t => t.kind === 'tab' && t.id !== id);
    sideId = id;
    if (other) activateTab(other.id); else createTab({});
  } else sideId = id;
  wake(tab);
  applyLayout(); pushState();
}

function openService(id, where) {
  const svc = store.data.services.find(s => s.id === id);
  if (!svc) return;
  const tab = tabs.find(t => t.serviceId === id) || createTab({ kind: 'service', serviceId: id, url: svc.url, title: svc.name, activate: false, lazy: true });
  if (where === 'side') setSide(tab.id); else activateTab(tab.id);
}

function openExtPage(id, which, forceOpen, where) {
  const url = exts.pageUrl(id, which);
  if (!url) { exts.clicked(id); return; }
  if (which === 'options') { createTab({ url }); return; }
  let tab = tabs.find(t => t.kind === 'ext' && t.extId === id);
  if (!tab) tab = createTab({ kind: 'ext', extId: id, url, title: (exts.get(id) || {}).name, activate: false });
  if (where === 'main') activateTab(tab.id);
  else if (sideId === tab.id && !forceOpen) setSide(0);
  else if (sideId !== tab.id) setSide(tab.id);
}

// Страница при переключении чуть «подъезжает» снизу: короткое движение вместо резкой смены.
function rise(tab) {
  if (store.data.settings.motion === false || fsTab || !tab.view.getVisible()) return;
  clearInterval(tab.riseTimer);
  const steps = [14, 9, 5, 2, 1, 0];
  let i = 0;
  const frame = () => {
    const r = rects.main;
    if (tab.id !== activeId || !r || fsTab || tab.wc.isDestroyed() || i >= steps.length) { clearInterval(tab.riseTimer); if (tab.id === activeId) applyLayout(); return; }
    tab.view.setBounds({ x: Math.round(r.x), y: Math.round(r.y) + steps[i++], width: Math.round(r.width), height: Math.round(r.height) });
  };
  frame();
  tab.riseTimer = setInterval(frame, 22);
}

function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const full = win.getContentBounds();
  tabs.forEach(t => {
    let r = null;
    if (fsTab) r = t === fsTab ? { x: 0, y: 0, width: full.width, height: full.height } : null;
    else if (t.id === activeId) r = t.error || t.url === START ? null : rects.main;
    else if (t.id === sideId) r = t.error ? null : rects.side;
    if (r && r.width > 1 && r.height > 1) {
      t.view.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      t.view.setVisible(true);
    } else t.view.setVisible(false);
  });
}

// ---------- вкладки глазами расширений (chrome.tabs) ----------
const tabInfo = t => ({
  id: t.id, windowId: 1, index: tabs.indexOf(t), url: t.pendingUrl || t.url, title: t.title, active: t.id === activeId, highlighted: t.id === activeId,
  status: t.pendingUrl ? 'unloaded' : t.loading ? 'loading' : 'complete', lastAccessed: t.seen || 0, pinned: t.kind === 'service', incognito: false,
});
function tabEvent(tab, info) { if (exts && tab.kind !== 'ext') exts.tabUpdated(tab.id, info, tabInfo(tab)); }
const EXT_TABS = {
  list: () => tabs.filter(t => t.kind !== 'ext').map(tabInfo),
  get: id => { const t = byId(id); return t && t.kind !== 'ext' ? Object.assign(tabInfo(t), { error: !!t.error }) : null; },
  active: () => { const t = active(); return t && t.kind !== 'ext' ? tabInfo(t) : null; },
  wc: id => byId(id).wc,
  create: (url, activate) => tabInfo(createTab({ url, activate })),
  update(id, p) {
    const t = id == null ? active() : byId(id);
    if (!t || t.kind === 'ext') return null;
    if (p.url) navigate(t, p.url);
    if (p.active && t.id !== sideId && t.id !== activeId) activateTab(t.id);
    return tabInfo(t);
  },
  remove: id => { const t = byId(id); if (t && t.kind !== 'ext') closeTab(id); },
  reload: id => { const t = id == null ? active() : byId(id); if (t) t.wc.reload(); },
  // Дождаться, пока во вкладке появится страница (спящую вкладку сначала будим).
  ready: id => new Promise(resolve => {
    const t = byId(id);
    if (!t) return resolve();
    wake(t);
    if (!t.wc.isLoadingMainFrame()) return resolve();
    const done = () => { clearTimeout(timer); t.wc.off('dom-ready', done); t.wc.off('did-fail-load', done); resolve(); };
    const timer = setTimeout(done, 30000);
    t.wc.on('dom-ready', done); t.wc.on('did-fail-load', done);
  }),
};

// ---------- состояние для интерфейса ----------
function pushState() {
  if (statePending) return;
  statePending = true;
  setImmediate(() => {
    statePending = false;
    if (!win || win.isDestroyed()) return;
    const d = store.data;
    ui('state', {
      tabs: tabs.map(t => ({
        id: t.id, kind: t.kind, serviceId: t.serviceId, extId: t.extId, url: t.url, title: t.title, favicon: t.favicon,
        loading: t.loading, error: t.error, start: t.url === START,
        canBack: !t.wc.isDestroyed() && t.wc.navigationHistory.canGoBack(), canForward: !t.wc.isDestroyed() && t.wc.navigationHistory.canGoForward(),
      })),
      activeId, sideId,
      services: d.services, lookups: d.lookups, bookmarks: d.bookmarks, settings: d.settings,
      extensions: exts.list(), search: Object.keys(SEARCH).map(k => ({ id: k, name: SEARCH[k].name })),
      closed: closed.length, dark: nativeTheme.shouldUseDarkColors, version: app.getVersion(), platform: process.platform,
    });
  });
}
function saveSession() {
  const plain = tabs.filter(t => t.kind === 'tab' && t.url !== START);
  store.data.session = { tabs: plain.map(t => ({ url: t.url, title: t.title })), active: Math.max(0, plain.findIndex(t => t.id === activeId)) };
  store.save();
}

// ---------- клавиши ----------
function onKey(tab) {
  return (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta, c = input.code, t = tab || active();
    let hit = true;
    if (ctrl && !input.alt) {
      const digit = /^Digit([1-9])$/.exec(c);
      if (c === 'KeyT') input.shift ? reopen() : createTab({});
      else if (c === 'KeyW' || c === 'F4') { if (t) closeOrUnload(t); }
      else if (c === 'KeyL') focusAddress();
      else if (c === 'KeyK') { win.webContents.focus(); ui('cmd', 'palette'); }
      else if (c === 'KeyR') { if (t) input.shift ? t.wc.reloadIgnoringCache() : t.wc.reload(); }
      else if (c === 'KeyF') { win.webContents.focus(); ui('cmd', 'find'); }
      else if (c === 'KeyD') toggleBookmark();
      else if (c === 'KeyP') { if (t) t.wc.print(); }
      else if (c === 'Tab') cycle(input.shift ? -1 : 1);
      else if (digit) { const plain = tabs.filter(x => x.kind === 'tab'); const x = digit[1] === '9' ? plain[plain.length - 1] : plain[digit[1] - 1]; if (x) activateTab(x.id); }
      else if (c === 'Equal' || c === 'NumpadAdd') zoom(t, 0.5);
      else if (c === 'Minus' || c === 'NumpadSubtract') zoom(t, -0.5);
      else if (c === 'Digit0' || c === 'Numpad0') zoom(t, 0);
      else if (c === 'Backslash') setSide(sideId ? 0 : pickSide());
      else if (c === 'KeyI' && input.shift) { if (t) t.wc.toggleDevTools(); }
      else hit = false;
    } else if (input.alt && !ctrl) {
      const digit = /^Digit([1-9])$/.exec(c);
      if (c === 'ArrowLeft') { if (t) t.wc.navigationHistory.goBack(); }
      else if (c === 'ArrowRight') { if (t) t.wc.navigationHistory.goForward(); }
      else if (digit) { const s = store.data.services[digit[1] - 1]; if (s) openService(s.id); }
      else hit = false;
    } else if (c === 'F5') { if (t) t.wc.reload(); }
    else if (c === 'F6') focusAddress();
    else if (c === 'F12') { if (t) t.wc.toggleDevTools(); }
    else hit = false;
    if (hit) e.preventDefault();
  };
}
function closeOrUnload(t) { if (t.id === sideId && t.kind !== 'tab') setSide(0); else closeTab(t.id); }
function focusAddress() { win.webContents.focus(); ui('cmd', 'focus-address'); }
function pickSide() { const t = tabs.find(x => x.kind !== 'tab' && x.id !== activeId); return t ? t.id : 0; }
function zoom(t, d) { if (t) t.wc.setZoomLevel(d === 0 ? 0 : Math.max(-3, Math.min(4, t.wc.getZoomLevel() + d))); }
function cycle(dir) {
  const plain = tabs.filter(t => t.kind === 'tab' && t.id !== sideId);
  if (!plain.length) return;
  const i = plain.findIndex(t => t.id === activeId);
  activateTab(plain[(i + dir + plain.length) % plain.length].id);
}
function reopen() { const c = closed.pop(); if (c) createTab({ url: c.url, title: c.title }); }
function toggleBookmark() {
  const t = active();
  if (!t || !/^https?:/.test(t.url)) return;
  const b = store.data.bookmarks, i = b.findIndex(x => x.url === t.url);
  if (i >= 0) b.splice(i, 1); else b.unshift({ url: t.url, title: t.title || t.url });
  store.save(); pushState();
}

// ---------- меню ----------
function popup(template) { Menu.buildFromTemplate(template.filter(Boolean)).popup({ window: win }); }

function pageMenu(tab, p) {
  const wc = tab.wc, m = [];
  const sel = (p.selectionText || '').trim();
  if (p.linkURL) {
    m.push({ label: 'Открыть в новой вкладке', click: () => createTab({ url: p.linkURL, activate: false, index: nextIndex(tab) }) });
    m.push({ label: 'Открыть рядом', click: () => setSide(createTab({ url: p.linkURL, activate: false }).id) });
    m.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) });
    m.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    m.push({ label: 'Открыть картинку в новой вкладке', click: () => createTab({ url: p.srcURL }) });
    m.push({ label: 'Сохранить картинку…', click: () => wc.downloadURL(p.srcURL) });
    m.push({ label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) });
    m.push({ type: 'separator' });
  }
  if (p.isEditable) {
    (p.dictionarySuggestions || []).slice(0, 5).forEach(s => m.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    if (p.misspelledWord) {
      m.push({ label: 'Добавить «' + p.misspelledWord + '» в словарь', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      m.push({ type: 'separator' });
    }
    m.push({ label: 'Отменить', role: 'undo', enabled: p.editFlags.canUndo });
    m.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut });
    m.push({ label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy });
    m.push({ label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste });
    m.push({ label: 'Вставить без оформления', role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste });
    m.push({ label: 'Выделить всё', role: 'selectAll' });
    m.push({ type: 'separator' });
  } else if (sel) {
    m.push({ label: 'Копировать', role: 'copy' });
  }
  if (sel) {
    const short = sel.length > 28 ? sel.slice(0, 28) + '…' : sel;
    store.data.lookups.forEach(l => {
      if (!/^https?:\/\//.test(l.url)) return;
      m.push({ label: l.name + ': «' + short + '» — рядом', click: () => openLookup(l, sel) });
    });
    m.push({ label: 'Найти в ' + (SEARCH[store.data.settings.search] || SEARCH.yandex).name + ': «' + short + '»', click: () => createTab({ url: searchUrl(sel), index: nextIndex(tab) }) });
    m.push({ type: 'separator' });
  }
  if (!p.linkURL && !p.isEditable && !sel && p.mediaType === 'none') {
    m.push({ label: 'Назад', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
    m.push({ label: 'Вперёд', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
    m.push({ label: 'Обновить', click: () => wc.reload() });
    m.push({ type: 'separator' });
    if (tab.id !== sideId) m.push({ label: 'Показать эту страницу рядом', click: () => setSide(tab.id) });
    if (/^https?:/.test(tab.url)) m.push({ label: 'Закрепить как сервис', click: () => addService(tab) });
    m.push({ label: 'Печать…', click: () => wc.print() });
    m.push({ type: 'separator' });
  }
  m.push({ label: 'Просмотреть код', click: () => wc.inspectElement(p.x, p.y) });
  popup(m);
}
// Один и тот же поиск по выделенному открывается в одной и той же вкладке рядом.
function openLookup(l, text) {
  const url = l.url.replace('%s', encodeURIComponent(text));
  let tab = tabs.find(t => t.lookup === l.name);
  if (tab) { tab.error = null; tab.wc.loadURL(url).catch(() => {}); }
  else { tab = createTab({ url, activate: false }); tab.lookup = l.name; }
  if (tab.id !== activeId) setSide(tab.id);
}
function addService(tab) {
  const u = new URL(tab.url);
  const svc = { id: 's' + Date.now().toString(36), name: (tab.title || u.host).slice(0, 40), url: tab.url, favicon: tab.favicon || '' };
  store.data.services.push(svc);
  store.save(); pushState();
  ui('info', { text: 'Закреплено: ' + svc.name + '. Название и адрес можно поменять в настройках.' });
}

const MENUS = {
  tab(id) {
    const t = byId(id); if (!t) return;
    popup([
      { label: 'Обновить', click: () => t.wc.reload() },
      { label: 'Дублировать', click: () => createTab({ url: t.url, index: nextIndex(t) }) },
      { label: 'Показать рядом', click: () => setSide(t.id) },
      /^https?:/.test(t.url) && { label: 'Закрепить как сервис', click: () => addService(t) },
      { type: 'separator' },
      { label: 'Закрыть', click: () => closeTab(t.id) },
      { label: 'Закрыть остальные', click: () => tabs.filter(x => x.kind === 'tab' && x.id !== t.id).forEach(x => closeTab(x.id)) },
      { label: 'Вернуть закрытую', enabled: closed.length > 0, click: reopen },
    ]);
  },
  service(id) {
    const s = store.data.services.find(x => x.id === id); if (!s) return;
    const t = tabs.find(x => x.serviceId === id);
    popup([
      { label: 'Открыть', click: () => openService(id) },
      { label: 'Открыть рядом', click: () => openService(id, 'side') },
      { label: 'Открыть в обычной вкладке', click: () => createTab({ url: s.url }) },
      { type: 'separator' },
      { label: 'Вернуться на главную сервиса', enabled: !!t, click: () => { navigate(t, s.url); } },
      { label: 'Выгрузить из памяти', enabled: !!t, click: () => closeTab(t.id) },
      { type: 'separator' },
      { label: 'Изменить…', click: () => ui('cmd', 'settings:services') },
      { label: 'Убрать', click: () => { if (t) closeTab(t.id); store.data.services = store.data.services.filter(x => x.id !== id); store.save(); pushState(); } },
    ]);
  },
  ext(id) {
    const x = exts.list().find(e => e.id === id); if (!x) return;
    popup([
      x.hasPanel && { label: 'Открыть рядом', click: () => openExtPage(id, 'panel', true) },
      x.hasPanel && { label: 'Открыть на всю страницу', click: () => openExtPage(id, 'panel', true, 'main') },
      x.hasOptions && { label: 'Настройки расширения', click: () => openExtPage(id, 'options') },
      { type: 'separator' },
      { label: x.enabled ? 'Отключить' : 'Включить', click: () => exts.setEnabled(id, !x.enabled) },
      { label: 'Все расширения…', click: () => ui('cmd', 'settings:extensions') },
    ]);
  },
  main() {
    const t = active();
    popup([
      { label: 'Новая вкладка', accelerator: 'Ctrl+T', click: () => createTab({}) },
      { label: 'Вернуть закрытую вкладку', accelerator: 'Ctrl+Shift+T', enabled: closed.length > 0, click: reopen },
      { label: 'Быстрый переход', accelerator: 'Ctrl+K', click: () => { win.webContents.focus(); ui('cmd', 'palette'); } },
      { type: 'separator' },
      { label: 'Найти на странице', accelerator: 'Ctrl+F', click: () => { win.webContents.focus(); ui('cmd', 'find'); } },
      { label: 'Крупнее', accelerator: 'Ctrl+=', click: () => zoom(t, 0.5) },
      { label: 'Мельче', accelerator: 'Ctrl+-', click: () => zoom(t, -0.5) },
      { label: 'Обычный размер', accelerator: 'Ctrl+0', click: () => zoom(t, 0) },
      { label: 'Печать…', accelerator: 'Ctrl+P', click: () => t && t.wc.print() },
      { type: 'separator' },
      { label: 'Инструменты разработчика', accelerator: 'F12', click: () => t && t.wc.toggleDevTools() },
      { label: 'Настройки', click: () => ui('cmd', 'settings') },
    ].map(i => i.accelerator ? Object.assign(i, { registerAccelerator: false }) : i));
  },
};

// ---------- команды интерфейса ----------
const UI = {
  ready() { pushState(); },
  layout(r) { rects = { main: r && r.main, side: r && r.side }; applyLayout(); },
  async snapshot() {
    const shot = async id => {
      const t = byId(id);
      if (!t || !t.view.getVisible()) return '';
      try { return 'data:image/jpeg;base64,' + (await t.wc.capturePage()).toJPEG(72).toString('base64'); } catch (e) { return ''; }
    };
    return { main: await shot(activeId), side: await shot(sideId) };
  },
  newTab(url, where) {
    const t = createTab({ url: url ? toUrl(url) : START, activate: where !== 'side' });
    if (where === 'side') setSide(t.id);
  },
  closeTab(id) { closeTab(id); },
  activate(id) { activateTab(id); },
  navigate(input, id) { const t = byId(id) || active(); if (t) navigate(t, input); },
  back(id) { const t = byId(id) || active(); if (t) t.wc.navigationHistory.goBack(); },
  forward(id) { const t = byId(id) || active(); if (t) t.wc.navigationHistory.goForward(); },
  reload(id) { const t = byId(id) || active(); if (!t) return; if (t.error) navigate(t, t.error.url || t.url); else if (t.loading) t.wc.stop(); else t.wc.reload(); },
  focusPage() { const t = active(); if (t && t.url !== START) t.wc.focus(); },
  setSide(id) { setSide(id); },
  swap() { const s = sideId, a = activeId; if (!s) return; sideId = 0; activateTab(s); if (byId(a)) setSide(a); },
  toggleSide() {
    if (sideId) return setSide(0);
    const id = pickSide();
    if (id) setSide(id);
    else ui('info', { text: 'Чтобы открыть что-то рядом: Ctrl+клик по сервису слева, значок расширения или «Открыть рядом» по правой кнопке мыши.' });
  },
  openService(id, where) { openService(id, where); },
  openExt(id, where) { openExtPage(id, 'panel', false, where); },
  menu(kind, id) { if (MENUS[kind]) MENUS[kind](id); },
  toggleBookmark() { toggleBookmark(); },
  removeBookmark(url) { store.data.bookmarks = store.data.bookmarks.filter(b => b.url !== url); store.save(); pushState(); },
  addService() { const t = active(); if (t && /^https?:/.test(t.url)) addService(t); else ui('info', { text: 'Откройте страницу, которую нужно закрепить, и нажмите «+» ещё раз.' }); },
  saveServices(list) {
    const clean = (Array.isArray(list) ? list : []).map(s => ({
      id: String(s.id || 's' + Math.random().toString(36).slice(2, 9)), name: String(s.name || '').slice(0, 40), url: toUrl(s.url), favicon: String(s.favicon || ''),
    })).filter(s => s.name && /^https?:/.test(s.url));
    const old = store.data.services;
    tabs.filter(t => t.serviceId).forEach(t => {
      const now = clean.find(s => s.id === t.serviceId), was = old.find(s => s.id === t.serviceId);
      if (!now) closeTab(t.id);
      else if (was && was.url !== now.url) { now.favicon = ''; navigate(t, now.url); }
    });
    store.data.services = clean; store.save(); pushState();
  },
  saveLookups(list) {
    store.data.lookups = (Array.isArray(list) ? list : []).map(l => ({ name: String(l.name || '').slice(0, 40), url: String(l.url || '') }))
      .filter(l => l.name && /^https?:\/\//.test(l.url) && l.url.indexOf('%s') >= 0);
    store.save(); pushState();
  },
  saveSettings(patch) {
    const s = store.data.settings;
    if (patch.search && SEARCH[patch.search]) s.search = patch.search;
    if (['system', 'light', 'dark'].indexOf(patch.theme) >= 0) { s.theme = patch.theme; nativeTheme.themeSource = s.theme; }
    if (['lilac', 'sunset', 'mint', 'ocean', 'graphite'].indexOf(patch.accent) >= 0) s.accent = patch.accent;
    if (typeof patch.motion === 'boolean') s.motion = patch.motion;
    if (typeof patch.sideRatio === 'number') s.sideRatio = Math.max(0.2, Math.min(0.7, patch.sideRatio));
    store.save(); pushState();
  },
  suggest(q) {
    q = String(q || '').toLowerCase().trim();
    if (!q) return store.data.history.slice(0, 6);
    const words = q.split(/\s+/);
    const out = [];
    for (const h of store.data.history) {
      const hay = (h.title + ' ' + h.url).toLowerCase();
      if (words.every(w => hay.indexOf(w) >= 0)) { out.push(h); if (out.length >= 8) break; }
    }
    return out;
  },
  clearHistory() { store.data.history = []; closed.length = 0; store.save(); pushState(); ui('info', { text: 'История очищена.' }); },
  async clearData() {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Очистить', 'Отмена'], cancelId: 1, message: 'Выйти со всех сайтов и удалить их данные?', detail: 'Удалятся куки, кэш и сохранённые данные сайтов. Закладки, сервисы и расширения останутся.' });
    if (r.response !== 0) return;
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    ui('info', { text: 'Данные сайтов удалены.' });
  },
  find(text, forward, next) { const t = active(); if (!t) return; if (text) t.wc.findInPage(String(text), { forward: forward !== false, findNext: !!next }); else t.wc.stopFindInPage('clearSelection'); },
  findStop() { const t = active(); if (t) { t.wc.stopFindInPage('keepSelection'); t.wc.focus(); } },
  extEnable(id, on) { exts.setEnabled(String(id), !!on); },
  extOptions(id) { openExtPage(String(id), 'options'); },
  extReload() { tabs.filter(t => t.kind === 'ext').forEach(t => closeTab(t.id)); exts.reload(); ui('info', { text: 'Расширения перезапущены. Обновите открытые страницы, чтобы изменения применились.' }); },
  async extAdd() {
    const r = await dialog.showOpenDialog(win, { title: 'Папка расширения (в ней лежит manifest.json)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    const dir = r.filePaths[0];
    if (!require('fs').existsSync(path.join(dir, 'manifest.json'))) { ui('info', { text: 'В этой папке нет manifest.json — это не расширение.' }); return; }
    if (store.data.extPaths.indexOf(dir) < 0) store.data.extPaths.push(dir);
    store.save(); UI.extReload();
  },
  extNotifyButton(extId, id, index) { exts.notifyButton(String(extId), String(id), Number(index) || 0); },
  extRemove(id) {
    const x = exts.get(String(id));
    if (!x || x.bundled) return;
    store.data.extPaths = store.data.extPaths.filter(p => path.resolve(p) !== x.dir);
    store.save(); UI.extReload();
  },
  authReply(id, user, pass) { const cb = auths.get(id); if (!cb) return; auths.delete(id); if (user == null) cb(); else cb(String(user), String(pass || '')); },
  showItem(file) { if (downloads.has(file)) shell.showItemInFolder(file); },
};

// ---------- запуск ----------
function createWindow() {
  const w = store.data.window;
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: w.width, height: w.height, x: w.x, y: w.y, minWidth: 860, minHeight: 560, show: false,
    title: 'Локаль', backgroundColor: (dark ? COLORS.dark : COLORS.light).bar,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: (dark ? COLORS.dark : COLORS.light).bar, symbolColor: (dark ? COLORS.dark : COLORS.light).symbol, height: 42 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  if (w.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', onKey(null));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.on('resize', applyLayout);
  const remember = () => {
    if (win.isDestroyed()) return;
    store.data.window = Object.assign(win.isMaximized() ? store.data.window : win.getNormalBounds(), { maximized: win.isMaximized() });
    store.save();
  };
  win.on('resized', remember); win.on('moved', remember); win.on('maximize', remember); win.on('unmaximize', remember);
  win.on('closed', () => { win = null; app.quit(); });
}

// При запуске из исходников берём из соседних папок только те расширения, что входят в сборку.
function bundledOnly() {
  if (app.isPackaged || process.env.LOKAL_EXT_ALL) return null;
  try { return require('../package.json').build.extraResources.map(r => path.basename(r.to)); } catch (e) { return null; }
}

function themeChanged() {
  if (!win || win.isDestroyed()) return;
  const c = nativeTheme.shouldUseDarkColors ? COLORS.dark : COLORS.light;
  try { win.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: 42 }); } catch (e) { /* не везде есть */ }
  win.setBackgroundColor(c.bar);
  pushState();
}

function setupSession() {
  const ses = session.defaultSession;
  const AUTO = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications', 'pointerLock', 'window-management']);
  const ASK = { media: 'камеру или микрофон', geolocation: 'ваше местоположение', 'display-capture': 'запись экрана', midi: 'MIDI-устройства' };
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    if (AUTO.has(perm)) return cb(true);
    if (!ASK[perm]) return cb(false);
    const h = host((details && details.requestingUrl) || wc.getURL()), key = h + '|' + perm;
    if (key in granted) return cb(granted[key]);
    dialog.showMessageBox(win, { type: 'question', buttons: ['Разрешить', 'Запретить'], cancelId: 1, message: h + ' просит доступ', detail: 'Сайт хочет использовать ' + ASK[perm] + '.' })
      .then(r => { granted[key] = r.response === 0; cb(granted[key]); });
  });
  ses.setPermissionCheckHandler((wc, perm, origin) => AUTO.has(perm) || granted[host(origin) + '|' + perm] === true);
  ses.on('will-download', (e, item) => {
    item.once('done', (ev, state) => {
      if (state !== 'completed') return;
      const file = item.getSavePath();
      downloads.add(file);
      ui('info', { text: 'Скачано: ' + item.getFilename(), action: 'Показать в папке', cmd: ['showItem', file] });
    });
  });
  try { ses.setSpellCheckerLanguages(['ru', 'en-US']); } catch (e) { /* словари недоступны */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const url = argv.slice(1).find(a => /^https?:\/\//.test(a));
    if (url) createTab({ url });
  });

  app.whenReady().then(() => {
    store = new JsonFile(path.join(app.getPath('userData'), 'state.json'), DEFAULTS());
    nativeTheme.themeSource = store.data.settings.theme || 'system';
    nativeTheme.on('updated', themeChanged);
    Menu.setApplicationMenu(null);
    app.setAppUserModelId(app.isPackaged ? 'ru.lokal.browser' : process.execPath);
    setupSession();
    if (process.env.LOKAL_TEST_STUB) require(process.env.LOKAL_TEST_STUB)();

    exts = Extensions.create({
      userData: app.getPath('userData'), store,
      bundledDir: process.env.LOKAL_EXT_DIR || (app.isPackaged ? path.join(process.resourcesPath, 'extensions') : path.join(__dirname, '..', '..')),
      only: bundledOnly(),
      host: {
        tabs: EXT_TABS,
        openTab: url => createTab({ url }),
        openExtPage,
        changed: pushState,
        info: o => ui('info', o),
        focus: () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } },
      },
    });

    ipcMain.handle('ui', (e, cmd, ...args) => {
      if (!win || e.sender !== win.webContents || !Object.prototype.hasOwnProperty.call(UI, cmd)) return undefined;
      return UI[cmd](...args);
    });

    createWindow();
    exts.start();

    const s = store.data.session;
    (s.tabs || []).forEach((t, i) => createTab({ url: t.url, title: t.title, lazy: true, activate: false }));
    const plain = tabs.filter(t => t.kind === 'tab');
    if (plain.length) activateTab((plain[s.active] || plain[0]).id); else createTab({});
  });

  app.on('login', (event, wc, details, authInfo, cb) => {
    if (!win) return;
    event.preventDefault();
    const id = ++authSeq;
    auths.set(id, cb);
    win.webContents.focus();
    ui('auth', { id, host: authInfo.host, proxy: authInfo.isProxy });
  });
  app.on('before-quit', () => { if (store) { saveSession(); store.flush(); } if (exts) exts.flush(); });
  app.on('window-all-closed', () => app.quit());
}
