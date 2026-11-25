'use strict';
// Загружается в каждую вкладку. Сам по себе ничего сайтам не даёт:
// только запускает расширения — контент-скрипты на подходящих сайтах и chrome.* на страницах расширений.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

(function () {
  if (!process.isMainFrame) return;
  const proto = location.protocol;
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'locext:') return;

  let info;
  try { info = ipcRenderer.sendSync('ext:frame-info', location.href); } catch (e) { return; }
  if (!info) return;

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
  if (info.page) {
    contextBridge.exposeInMainWorld('__locBridge', bridgeFor(info.page, info.page.kind));
    webFrame.executeJavaScript('(' + info.shim + ')(window.__locBridge);');
    return;
  }

  // Контент-скрипты: у каждого расширения свой изолированный мир, как в Chrome.
  const groups = info.scripts || [];
  if (!groups.length) return;
  function whenRoot(fn) {
    if (document.documentElement) return fn();
    const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); fn(); } });
    mo.observe(document, { childList: true });
  }
  function whenDom(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
  const shimmed = {};
  groups.forEach(g => {
    const run = () => {
      if (g.world === 'MAIN') {
        g.files.forEach(code => webFrame.executeJavaScript(code));
        return;
      }
      const sources = [];
      if (!shimmed[g.worldId]) {
        shimmed[g.worldId] = true;
        // Своя политика содержимого у мира расширения: его стили и картинки не блокирует политика сайта (как в Chrome).
        try { webFrame.setIsolatedWorldInfo(g.worldId, { name: g.extId, securityOrigin: location.origin, csp: "script-src 'self' 'unsafe-eval'; object-src 'self'" }); } catch (e) { /* ignore */ }
        contextBridge.exposeInIsolatedWorld(g.worldId, '__locBridge', bridgeFor(g, 'content'));
        sources.push({ code: '(' + info.shim + ')(globalThis.__locBridge);' });
      }
      g.files.forEach(code => sources.push({ code }));
      webFrame.executeJavaScriptInIsolatedWorld(g.worldId, sources);
    };
    if (g.runAt === 'document_start') whenRoot(run); else whenDom(run);
  });
})();
