'use strict';
// Загружается в каждую вкладку. Сам по себе ничего сайтам не даёт:
// только запускает расширения — контент-скрипты на подходящих сайтах и chrome.* на страницах расширений.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ---- пароли: запомнить при входе и подставить в следующий раз ----
(function () {
  if (!process.isMainFrame || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
  const USER_TYPES = ['text', 'email', 'tel', ''];
  const shown = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const userLike = el => el instanceof HTMLInputElement && USER_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) >= 0;
  let lastUser = '', sent = '';

  function setValue(el, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Поле логина — ближайшее текстовое поле перед полем пароля (в той же форме, если она есть).
  function userField(pw) {
    const all = [...(pw.form || document).querySelectorAll('input')];
    for (let i = all.indexOf(pw) - 1; i >= 0; i--) if (userLike(all[i]) && (shown(all[i]) || all[i].value)) return all[i];
    return null;
  }
  function capture() {
    const filled = [...document.querySelectorAll('input[type=password]')].filter(p => p.value);
    if (!filled.length) return;
    const pw = filled[filled.length - 1], u = userField(pw);
    const cred = { username: (u && u.value.trim()) || lastUser, password: pw.value };
    const key = cred.username + '\n' + cred.password;
    if (key === sent) return;
    sent = key;
    ipcRenderer.send('pw:captured', cred);
  }
  function fill(cred, force) {
    const pw = [...document.querySelectorAll('input[type=password]')].find(p => shown(p) && (force || !p.value));
    if (!pw) return false;
    const u = userField(pw);
    if (u && cred.username && (force || !u.value)) setValue(u, cred.username);
    setValue(pw, cred.password);
    sent = cred.username + '\n' + cred.password;
    return true;
  }

  document.addEventListener('change', e => {
    const el = e.target;
    if (userLike(el) && el.value && /user|login|email|mail|логин|почт|name/i.test((el.name || '') + (el.id || '') + (el.autocomplete || '') + (el.placeholder || ''))) lastUser = el.value.trim();
  }, true);
  document.addEventListener('submit', capture, true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) capture(); }, true);
  document.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('button, input[type=submit], input[type=button], [role=button], a')) capture(); }, true);
  window.addEventListener('pagehide', capture);

  ipcRenderer.on('pw:fill', (e, cred) => { if (cred) fill(cred, true); });

  // Автоподстановка: форма входа может появиться не сразу, поэтому первые секунды следим за страницей.
  let creds = null, done = false;
  async function auto() {
    if (done || !document.querySelector('input[type=password]')) return;
    if (!creds) creds = ipcRenderer.invoke('pw:get');
    const list = await creds;
    if (done || !list || !list.length) return;
    if (fill(list[0], false)) done = true;
  }
  const start = () => {
    auto();
    const mo = new MutationObserver(() => { clearTimeout(mo.t); mo.t = setTimeout(auto, 150); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 20000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();

(function () {
  if (!process.isMainFrame) return;
  const proto = location.protocol;
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'locext:') return;

  let info = null;
  try { info = ipcRenderer.sendSync('ext:frame-info', location.href); } catch (e) { /* без расширений */ }

  const listeners = {};
  ipcRenderer.on('ext:event', (e, extId, name, payload) => {
    (listeners[extId] || []).forEach(f => { try { f(name, payload); } catch (err) { /* ignore */ } });
  });
  function bridgeFor(x, kind) {
    listeners[x.extId] = listeners[x.extId] || [];
    return {
      extId: x.extId, manifest: x.manifest, baseUrl: x.baseUrl, kind,
      call: (method, args) => ipcRenderer.invoke('ext:call', x.extId, method, args),
      on: f => { listeners[x.extId].push(f); },
    };
  }

  // Страница самого расширения (панель, настройки, фон): chrome.* прямо в странице.
  if (info && info.page) {
    contextBridge.exposeInMainWorld('__locBridge', bridgeFor(info.page, info.page.kind));
    webFrame.executeJavaScript('(' + info.shim + ')(window.__locBridge);');
    return;
  }

  // Скрипты расширений на сайте: у каждого расширения свой изолированный мир, как в Chrome.
  const shimmed = {};
  function inject(g, shim) {
    if (g.world === 'MAIN') {
      let last;
      g.files.forEach(code => { last = webFrame.executeJavaScript(code); });
      return last;
    }
    const sources = [];
    if (!shimmed[g.worldId]) {
      shimmed[g.worldId] = true;
      // Своя политика содержимого у мира расширения: его стили и картинки не блокирует политика сайта (как в Chrome).
      try { webFrame.setIsolatedWorldInfo(g.worldId, { name: g.extId, securityOrigin: location.origin, csp: "script-src 'self' 'unsafe-eval'; object-src 'self'" }); } catch (e) { /* ignore */ }
      contextBridge.exposeInIsolatedWorld(g.worldId, '__locBridge', bridgeFor(g, 'content'));
      sources.push({ code: '(' + shim + ')(globalThis.__locBridge);' });
    }
    g.files.forEach(code => sources.push({ code }));
    return webFrame.executeJavaScriptInIsolatedWorld(g.worldId, sources);
  }
  function whenRoot(fn) {
    if (document.documentElement) return fn();
    const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); fn(); } });
    mo.observe(document, { childList: true });
  }
  function whenDom(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  // chrome.scripting.executeScript: браузер просит выполнить скрипт расширения на этой странице.
  ipcRenderer.on('ext:inject', (e, reqId, g) => {
    const reply = r => { try { ipcRenderer.send('ext:inject-result', reqId, r); } catch (err) { ipcRenderer.send('ext:inject-result', reqId, { ok: true, value: null }); } };
    Promise.resolve().then(() => inject(g, g.shim)).then(
      v => reply({ ok: true, value: v === undefined ? null : v }),
      err => reply({ ok: false, error: String((err && err.message) || err) }));
  });

  ((info && info.scripts) || []).forEach(g => {
    const run = () => { try { const p = inject(g, info.shim); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } };
    if (g.runAt === 'document_start') whenRoot(run); else whenDom(run);
  });
})();
