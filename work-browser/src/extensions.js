'use strict';
// Мини-движок расширений: запускает распакованные расширения Chrome (Manifest V3) прямо из папки.
// Поддерживает контент-скрипты, страницы расширения (панель, настройки), фоновый скрипт
// и те части chrome.*, которые описаны в chrome-shim.js.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, protocol, session, Notification, nativeImage } = require('electron');
const { JsonFile } = require('./store');

const SHIM = fs.readFileSync(path.join(__dirname, 'chrome-shim.js'), 'utf8').trim();
const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  wasm: 'application/wasm', task: 'application/octet-stream',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wav: 'audio/wav', mp3: 'audio/mpeg',
  ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
};

function patternToRegExp(p) {
  if (p === '<all_urls>') return /^https?:\/\//;
  const m = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(p);
  if (!m) return null;
  const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const host = m[2] === '*' ? '[^/]*' : m[2].startsWith('*.') ? '(?:[^/]*\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
  return new RegExp('^' + (m[1] === '*' ? 'https?' : m[1]) + '://' + host + esc(m[3]) + '$');
}
const compile = list => (list || []).map(patternToRegExp).filter(Boolean);
const matches = (res, url) => res.some(re => re.test(url));

function create({ userData, bundledDir, only, store, host }) {
  const byId = new Map();
  const pending = new Map();
  const notes = new Map();
  const injects = new Map();
  let injSeq = 0;
  let seq = 0;

  function load(dir, bundled) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) { return null; }
    if (!manifest || !manifest.name || !manifest.manifest_version) return null;
    let id = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ext';
    while (byId.has(id)) id += '-2';
    const icons = Object.assign({}, manifest.icons, manifest.action && manifest.action.default_icon);
    const best = Object.keys(icons).map(Number).sort((a, b) => b - a)[0];
    const ext = {
      id, dir: path.resolve(dir), bundled, manifest,
      name: manifest.name, version: manifest.version || '', description: manifest.description || '',
      baseUrl: 'locext://' + id + '/',
      icon: best ? String(icons[best]).replace(/^\/+/, '') : '',
      panel: (manifest.side_panel && manifest.side_panel.default_path) || '',
      popup: (manifest.action && manifest.action.default_popup) || '',
      options: manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '',
      scripts: (manifest.content_scripts || []).map(cs => ({
        include: compile(cs.matches), exclude: compile(cs.exclude_matches),
        files: cs.js || [], world: cs.world === 'MAIN' ? 'MAIN' : 'ISOLATED', runAt: cs.run_at || 'document_idle',
      })),
      hosts: compile((manifest.host_permissions || []).concat(manifest.permissions || [])),
      badge: { text: '', color: '#e5638f' }, title: manifest.name,
      contexts: new Set(), files: new Map(), bg: null, offscreen: null, grant: null, worldId: 1000 + byId.size,
      hasAction: !!manifest.action, activeTab: (manifest.permissions || []).indexOf('activeTab') >= 0,
      storage: new JsonFile(path.join(userData, 'ext-storage', id + '.json'), { local: {}, sync: {} }),
      mem: {},
    };
    byId.set(id, ext);
    return ext;
  }

  function scan() {
    const dirs = [];
    try {
      fs.readdirSync(bundledDir, { withFileTypes: true }).forEach(d => {
        if (d.isDirectory() && (!only || only.indexOf(d.name) >= 0) && fs.existsSync(path.join(bundledDir, d.name, 'manifest.json'))) dirs.push([path.join(bundledDir, d.name), true]);
      });
    } catch (e) { /* нет встроенных */ }
    (store.data.extPaths || []).forEach(p => dirs.push([p, false]));
    dirs.forEach(([d, b]) => load(d, b));
  }

  const enabled = ext => store.data.extDisabled.indexOf(ext.id) < 0;

  function readFile(ext, rel) {
    if (!ext.files.has(rel)) {
      const file = path.resolve(ext.dir, rel);
      let code = '';
      if (file.startsWith(ext.dir + path.sep)) { try { code = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(ext.id, 'нет файла', rel); } }
      ext.files.set(rel, code + '\n//# sourceURL=' + ext.baseUrl + rel);
    }
    return ext.files.get(rel);
  }

  function register(ext, wc) {
    if (ext.contexts.has(wc)) return;
    ext.contexts.add(wc);
    wc.once('destroyed', () => ext.contexts.delete(wc));
  }
  function emit(ext, name, payload, except) {
    ext.contexts.forEach(wc => { if (wc !== except && !wc.isDestroyed()) wc.send('ext:event', ext.id, name, payload); });
  }

  function frameInfo(wc, href) {
    let u;
    try { u = new URL(href); } catch (e) { return null; }
    if (u.protocol === 'locext:') {
      const ext = byId.get(u.hostname);
      if (!ext || !enabled(ext)) return null;
      register(ext, wc);
      return { shim: SHIM, page: { extId: ext.id, manifest: ext.manifest, baseUrl: ext.baseUrl, kind: u.pathname === '/_background.html' ? 'background' : 'page' } };
    }
    const url = href.split('#')[0];
    const scripts = [];
    byId.forEach(ext => {
      if (!enabled(ext)) return;
      ext.scripts.forEach(cs => {
        if (!matches(cs.include, url) || matches(cs.exclude, url)) return;
        register(ext, wc);
        scripts.push({
          extId: ext.id, manifest: ext.manifest, baseUrl: ext.baseUrl, worldId: ext.worldId,
          world: cs.world, runAt: cs.runAt, files: cs.files.map(f => readFile(ext, f)),
        });
      });
    });
    return scripts.length ? { shim: SHIM, scripts } : null;
  }

  // ---- хранилище ----
  function bag(ext, area) {
    if (area === 'session') return ext.mem;
    if (area !== 'local' && area !== 'sync') throw new Error('Неизвестное хранилище');
    return ext.storage.data[area];
  }
  function storageGet(ext, area, keys) {
    const data = bag(ext, area), out = {};
    if (keys == null) return Object.assign({}, data);
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) keys.forEach(k => { if (k in data) out[k] = data[k]; });
    else Object.keys(keys).forEach(k => { out[k] = k in data ? data[k] : keys[k]; });
    return out;
  }
  function storageWrite(ext, area, fn) {
    const data = bag(ext, area), changes = {};
    fn(data, changes);
    if (!Object.keys(changes).length) return;
    if (area !== 'session') ext.storage.save();
    emit(ext, 'storage.changed', { area, changes });
  }

  // ---- вызовы chrome.* ----
  async function call(e, claimedId, method, args) {
    const frame = e.senderFrame;
    const url = (frame && frame.url) || e.sender.getURL();
    let ext, privileged = false;
    if (url.startsWith('locext://')) { ext = byId.get(new URL(url).hostname); privileged = true; }
    else {
      ext = byId.get(claimedId);
      const clean = url.split('#')[0];
      if (!ext || !(ext.contexts.has(e.sender) || ext.scripts.some(cs => matches(cs.include, clean)))) throw new Error('Нет доступа');
    }
    if (!ext || !enabled(ext)) throw new Error('Расширение отключено');

    switch (method) {
      case 'storage.get': return storageGet(ext, args[0], args[1]);
      case 'storage.set': return storageWrite(ext, args[0], (data, ch) => {
        Object.keys(args[1] || {}).forEach(k => {
          const nv = args[1][k];
          if (JSON.stringify(data[k]) === JSON.stringify(nv)) return;
          ch[k] = { oldValue: data[k], newValue: nv }; data[k] = nv;
        });
      });
      case 'storage.remove': return storageWrite(ext, args[0], (data, ch) => {
        [].concat(args[1] || []).forEach(k => { if (k in data) { ch[k] = { oldValue: data[k] }; delete data[k]; } });
      });
      case 'storage.clear': return storageWrite(ext, args[0], (data, ch) => {
        Object.keys(data).forEach(k => { ch[k] = { oldValue: data[k] }; delete data[k]; });
      });
      case 'sendMessage': {
        const targets = [...ext.contexts].filter(wc => wc !== e.sender && !wc.isDestroyed());
        if (!targets.length) return undefined;
        const id = ++seq;
        return new Promise(resolve => {
          const p = { left: targets.length, resolve, timer: setTimeout(() => { pending.delete(id); resolve(undefined); }, 30000) };
          pending.set(id, p);
          targets.forEach(wc => wc.send('ext:event', ext.id, 'message', { id, msg: args[0], sender: { id: ext.id, url } }));
        });
      }
      case 'respond': {
        const p = pending.get(args[0]);
        if (!p) return;
        if (args[2] && --p.left > 0) return;
        clearTimeout(p.timer); pending.delete(args[0]);
        p.resolve(args[2] ? undefined : args[1]);
        return;
      }
      case 'openOptionsPage':
        if (ext.options) host.openTab(ext.baseUrl + ext.options);
        return;
    }
    if (!privileged) throw new Error('Недоступно из контент-скрипта: ' + method);

    switch (method) {
      case 'fetch': {
        const target = String(args[0]), o = args[1] || {};
        if (!/^https?:/.test(target) || !matches(ext.hosts, target.split('#')[0])) throw new Error('Сайт не разрешён в manifest.json');
        const method2 = String(o.method || 'GET').toUpperCase();
        const r = await session.defaultSession.fetch(target, {
          method: method2, headers: o.headers || {}, redirect: 'follow',
          credentials: o.credentials === 'include' ? 'include' : 'omit',
          body: method2 === 'GET' || method2 === 'HEAD' || o.body == null ? undefined : (typeof o.body === 'string' ? o.body : Buffer.from(o.body)),
        });
        const headers = {};
        r.headers.forEach((v, k) => { if (k !== 'content-encoding' && k !== 'content-length') headers[k] = v; });
        return { status: r.status, statusText: r.statusText, headers, body: new Uint8Array(await r.arrayBuffer()) };
      }
      case 'tabs.create': {
        const o = typeof args[0] === 'string' ? { url: args[0] } : (args[0] || {});
        const target = new URL(String(o.url || ''), ext.baseUrl).href;
        if (!/^(https?|locext):/.test(target)) throw new Error('Такой адрес открыть нельзя');
        return host.tabs.create(target, o.active !== false);
      }
      case 'tabs.query': {
        const o = args[0] || {};
        const res = o.url ? compile([].concat(o.url)) : null;
        return host.tabs.list().filter(t => (!res || matches(res, t.url.split('#')[0])) && (o.active === undefined || t.active === !!o.active));
      }
      case 'tabs.get': {
        const t = host.tabs.get(Number(args[0]));
        if (!t) throw new Error('No tab with id: ' + args[0]);
        return t;
      }
      case 'tabs.update': {
        const t = host.tabs.update(args[0] == null ? null : Number(args[0]), args[1] || {});
        if (!t) throw new Error('No tab with id: ' + args[0]);
        return t;
      }
      case 'tabs.remove': [].concat(args[0] || []).forEach(id => host.tabs.remove(Number(id))); return;
      case 'tabs.reload': host.tabs.reload(args[0] == null ? null : Number(args[0])); return;
      case 'windows.update': if (args[0] && args[0].focused) host.focus(); return;
      case 'scripting.execute': return execute(ext, args[0] || {});
      case 'offscreen.has': return !!(ext.offscreen && !ext.offscreen.isDestroyed());
      case 'offscreen.close': closeOffscreen(ext); return;
      case 'offscreen.create': {
        if (ext.offscreen && !ext.offscreen.isDestroyed()) throw new Error('Only a single offscreen document may be created.');
        const target = new URL(String((args[0] || {}).url || ''), ext.baseUrl).href;
        if (!target.startsWith(ext.baseUrl)) throw new Error('Страница должна быть из расширения');
        const w = ext.offscreen = new BrowserWindow({
          show: false, width: 300, height: 200,
          webPreferences: { preload: path.join(__dirname, 'preload-tab.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
        });
        await w.loadURL(target);
        return;
      }
      case 'action':
        if (args[0].text !== undefined) ext.badge.text = String(args[0].text).slice(0, 4);
        if (args[0].color) ext.badge.color = Array.isArray(args[0].color) ? 'rgb(' + args[0].color.slice(0, 3).join(',') + ')' : String(args[0].color);
        if (args[0].title !== undefined) ext.title = args[0].title || ext.name;
        if (args[0].popup !== undefined) ext.popup = args[0].popup;
        host.changed();
        return;
      case 'openPanel': host.openExtPage(ext.id, 'panel', true); return;
      case 'notify': return notify(ext, String(args[0]), args[1] || {});
      case 'notify.clear': {
        const n = notes.get(ext.id + ':' + args[0]);
        if (n) { n.close(); notes.delete(ext.id + ':' + args[0]); }
        return;
      }
    }
    throw new Error('Не поддерживается: ' + method);
  }

  // chrome.scripting.executeScript: выполнить файл или функцию расширения на странице вкладки.
  async function execute(ext, o) {
    const tabId = Number(o.tabId);
    if (!host.tabs.get(tabId)) throw new Error('No tab with id: ' + o.tabId);
    await host.tabs.ready(tabId);
    const t = host.tabs.get(tabId);
    if (!t) throw new Error('No tab with id: ' + o.tabId);
    const url = t.url.split('#')[0];
    if (t.error || !/^https?:/.test(url)) throw new Error('Cannot access contents of the page (error page).');
    const granted = ext.grant && ext.grant.tabId === tabId && ext.grant.origin === new URL(url).origin;
    if (!matches(ext.hosts, url) && !granted) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    const files = o.func ? ['(' + String(o.func) + ')(...' + JSON.stringify(o.args || []) + ')'] : [].concat(o.files || []).map(f => readFile(ext, String(f).replace(/^\/+/, '')));
    if (!files.length) throw new Error('Нужно указать files или func');
    const wc = host.tabs.wc(tabId);
    register(ext, wc);
    return new Promise((resolve, reject) => {
      const id = ++injSeq;
      const timer = setTimeout(() => { injects.delete(id); reject(new Error('Страница не ответила')); }, 600000);
      injects.set(id, { wc, resolve, reject, timer });
      wc.send('ext:inject', id, { extId: ext.id, manifest: ext.manifest, baseUrl: ext.baseUrl, worldId: ext.worldId, world: o.world === 'MAIN' ? 'MAIN' : 'ISOLATED', files, shim: SHIM });
    });
  }
  function closeOffscreen(ext) {
    if (ext.offscreen && !ext.offscreen.isDestroyed()) ext.offscreen.destroy();
    ext.offscreen = null;
  }

  function notify(ext, id, o) {
    const title = String(o.title || ext.name), body = [o.message, o.contextMessage].filter(Boolean).join('\n');
    const button = o.buttons && o.buttons[0] && o.buttons[0].title;
    host.info({ text: title + (o.message ? ' — ' + o.message : ''), ext: ext.id, action: button || undefined, cmd: button ? ['extNotifyButton', ext.id, id, 0] : undefined });
    if (!Notification.isSupported()) return;
    let icon;
    try {
      const src = String(o.iconUrl || '');
      if (src.startsWith('data:')) icon = nativeImage.createFromDataURL(src);
      else if (src.startsWith(ext.baseUrl)) icon = nativeImage.createFromPath(path.join(ext.dir, decodeURIComponent(src.slice(ext.baseUrl.length))));
      else if (ext.icon) icon = nativeImage.createFromPath(path.join(ext.dir, ext.icon));
    } catch (e) { /* без картинки */ }
    const key = ext.id + ':' + id;
    const old = notes.get(key);
    if (old) old.close();
    const n = new Notification({ title, body, icon: icon && !icon.isEmpty() ? icon : undefined });
    n.on('click', () => { host.focus(); emit(ext, 'notification.clicked', { id }); });
    n.on('close', () => { if (notes.get(key) === n) notes.delete(key); });
    notes.set(key, n);
    n.show();
  }

  // ---- фоновый скрипт: скрытая страница вместо service worker ----
  function startBackground(ext) {
    stopBackground(ext);
    const bg = ext.manifest.background;
    if (!bg || !(bg.service_worker || (bg.scripts && bg.scripts.length)) || !enabled(ext)) return;
    ext.bg = new BrowserWindow({
      show: false, width: 400, height: 300,
      webPreferences: { preload: path.join(__dirname, 'preload-tab.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    ext.bg.webContents.on('console-message', (e) => { if (process.env.LOKAL_DEBUG) console.log('[' + ext.id + ']', e.message); });
    ext.bg.loadURL(ext.baseUrl + '_background.html');
  }
  function stopBackground(ext) {
    if (ext.bg && !ext.bg.isDestroyed()) ext.bg.destroy();
    ext.bg = null;
    closeOffscreen(ext);
  }
  function backgroundHtml(ext) {
    const bg = ext.manifest.background || {};
    const files = bg.service_worker ? [bg.service_worker] : (bg.scripts || []);
    const tags = [];
    files.forEach(f => {
      let src = '';
      try { src = fs.readFileSync(path.join(ext.dir, f), 'utf8'); } catch (e) { /* ignore */ }
      for (const m of src.matchAll(/importScripts\(([^)]*)\)/g)) {
        for (const x of m[1].matchAll(/['"]([^'"]+)['"]/g)) tags.push('<script src="' + x[1] + '"></script>');
      }
      tags.push('<script src="' + f + '"' + (bg.type === 'module' ? ' type="module"' : '') + '></script>');
    });
    return '<!doctype html><meta charset="utf-8"><title>' + ext.id + '</title>' + tags.join('');
  }

  function handleProtocol() {
    protocol.handle('locext', async req => {
      const u = new URL(req.url);
      const ext = byId.get(u.hostname);
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
      if (!ext) return new Response('', { status: 404 });
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (rel === '_background.html') return new Response(backgroundHtml(ext), { headers: Object.assign({ 'content-type': MIME.html }, headers) });
      const file = path.resolve(ext.dir, rel);
      if (!file.startsWith(ext.dir + path.sep)) return new Response('', { status: 403 });
      try {
        const buf = await fs.promises.readFile(file);
        const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
        return new Response(buf, { headers: Object.assign({ 'content-type': type }, headers) });
      } catch (e) { return new Response('', { status: 404 }); }
    });
  }

  function start() {
    handleProtocol();
    scan();
    ipcMain.on('ext:frame-info', (e, href) => {
      try { e.returnValue = frameInfo(e.sender, String(href)); } catch (err) { console.error(err); e.returnValue = null; }
    });
    ipcMain.on('ext:inject-result', (e, id, r) => {
      const p = injects.get(id);
      if (!p || p.wc !== e.sender) return;
      injects.delete(id); clearTimeout(p.timer);
      if (r && r.ok) p.resolve(r.value); else p.reject(new Error((r && r.error) || 'Скрипт не выполнился'));
    });
    ipcMain.handle('ext:call', async (e, extId, method, args) => {
      try { return { ok: true, value: await call(e, String(extId), String(method), Array.isArray(args) ? args : []) }; }
      catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    });
  }
  // Фоновые части расширений запускаются чуть позже окна, чтобы не задерживать старт.
  let bgStarted = false;
  function startBackgrounds() { if (bgStarted) return; bgStarted = true; byId.forEach(startBackground); }

  function reload() {
    byId.forEach(ext => { stopBackground(ext); ext.storage.flush(); });
    byId.clear();
    scan();
    byId.forEach(startBackground);
    host.changed();
  }

  return {
    start, reload, startBackgrounds,
    get: id => byId.get(id),
    list: () => [...byId.values()].map(ext => ({
      id: ext.id, name: ext.name, version: ext.version, description: ext.description, bundled: ext.bundled, dir: ext.dir,
      icon: ext.icon ? ext.baseUrl + ext.icon : '', enabled: enabled(ext),
      badge: ext.badge.text, badgeColor: ext.badge.color, title: ext.title,
      hasPanel: !!(ext.panel || ext.popup), hasOptions: !!ext.options, hasAction: ext.hasAction,
      sites: (ext.manifest.content_scripts || []).flatMap(cs => cs.matches || []).filter((v, i, a) => a.indexOf(v) === i),
    })),
    pageUrl(id, which) {
      const ext = byId.get(id);
      if (!ext) return '';
      const p = which === 'options' ? (ext.options || ext.popup || ext.panel) : (ext.panel || ext.popup || ext.options);
      return p ? ext.baseUrl + p.replace(/^\/+/, '') : '';
    },
    setEnabled(id, on) {
      const ext = byId.get(id);
      if (!ext) return;
      const list = store.data.extDisabled, i = list.indexOf(id);
      if (on && i >= 0) list.splice(i, 1);
      if (!on && i < 0) list.push(id);
      store.save();
      if (on) startBackground(ext); else stopBackground(ext);
      host.changed();
    },
    // Клик по значку расширения без панели: расширение получает текущую вкладку и доступ к ней (activeTab).
    clicked(id) {
      const ext = byId.get(id);
      if (!ext || !enabled(ext)) return;
      if (!bgStarted) { startBackgrounds(); setTimeout(() => this.clicked(id), 900); return; }   // нажали раньше, чем расширение проснулось
      const tab = host.tabs.active();
      if (tab && ext.activeTab && /^https?:/.test(tab.url)) ext.grant = { tabId: tab.id, origin: new URL(tab.url).origin };
      emit(ext, 'action.clicked', { tab });
    },
    tabUpdated(id, info, tab) { byId.forEach(ext => { if (enabled(ext)) emit(ext, 'tabs.updated', { id, info, tab }); }); },
    tabRemoved(id) { byId.forEach(ext => { if (enabled(ext)) emit(ext, 'tabs.removed', { id }); }); },
    notifyButton(extId, id, index) { const ext = byId.get(extId); if (ext) emit(ext, 'notification.button', { id, index }); },
    flush() { byId.forEach(ext => ext.storage.flush()); },
  };
}

module.exports = { create };
