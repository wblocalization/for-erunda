'use strict';
// Загружается в каждую вкладку. Сам по себе ничего сайтам не даёт:
// только запускает расширения — контент-скрипты на подходящих сайтах и chrome.* на страницах расширений.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
