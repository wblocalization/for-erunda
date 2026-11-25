// Замена объекта chrome.* для расширений, которые запускает «Локаль».
// Выполняется внутри страницы расширения или в отдельном мире контент-скрипта; bridge даёт связь с браузером.
(function (bridge) {
  'use strict';
  var M = bridge.manifest, base = bridge.baseUrl, kind = bridge.kind;
  var privileged = kind === 'page' || kind === 'background';

  function Evt() {
    var ls = [];
    return {
      addListener: function (f) { if (typeof f === 'function' && ls.indexOf(f) < 0) ls.push(f); },
      removeListener: function (f) { var i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
      hasListener: function (f) { return ls.indexOf(f) >= 0; },
      hasListeners: function () { return ls.length > 0; },
      _fire: function () {
        var a = arguments;
        return ls.slice().map(function (f) { try { return f.apply(null, a); } catch (e) { console.error(e); } });
      },
    };
  }

  var runtime = { id: bridge.extId, lastError: undefined };

  function call(method, args) {
    return bridge.call(method, args || []).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Ошибка расширения');
      return r.value;
    });
  }
  // Поддерживает оба стиля: с колбэком (и chrome.runtime.lastError) и с промисом.
  function done(promise, cb) {
    if (typeof cb !== 'function') return promise;
    promise.then(function (v) { cb(v); }, function (e) {
      runtime.lastError = { message: String((e && e.message) || e) };
      try { cb(); } finally { runtime.lastError = undefined; }
    });
  }
  function lastFn(args) { var f = args[args.length - 1]; return typeof f === 'function' ? f : null; }

  // ---- storage ----
  var storageChanged = Evt();
  function area(name) {
    var changed = Evt();
    var a = {
      get: function (keys, cb) { if (typeof keys === 'function') { cb = keys; keys = null; } return done(call('storage.get', [name, keys === undefined ? null : keys]), cb); },
      set: function (items, cb) { return done(call('storage.set', [name, items]), cb); },
      remove: function (keys, cb) { return done(call('storage.remove', [name, keys]), cb); },
      clear: function (cb) { return done(call('storage.clear', [name]), cb); },
      getBytesInUse: function (keys, cb) { if (typeof keys === 'function') cb = keys; return done(Promise.resolve(0), cb); },
      onChanged: changed,
    };
    return a;
  }
  var storage = { local: area('local'), sync: area('sync'), session: area('session'), onChanged: storageChanged };

  // ---- runtime ----
  runtime.getURL = function (p) { return base + String(p || '').replace(/^\/+/, ''); };
  runtime.getManifest = function () { return JSON.parse(JSON.stringify(M)); };
  runtime.onMessage = Evt();
  runtime.onInstalled = Evt();
  runtime.onStartup = Evt();
  runtime.onSuspend = Evt();
  runtime.onConnect = Evt();
  runtime.sendMessage = function () {
    var args = Array.prototype.slice.call(arguments), cb = lastFn(args);
    if (cb) args.pop();
    var msg = args.length > 1 && typeof args[0] === 'string' && args[0] === runtime.id ? args[1] : args[0];
    return done(call('sendMessage', [msg]), cb);
  };
  runtime.openOptionsPage = function (cb) { return done(call('openOptionsPage', []), cb); };
  runtime.reload = function () { location.reload(); };
  runtime.getPlatformInfo = function (cb) { return done(Promise.resolve({ os: 'win', arch: 'x86-64' }), cb); };

  // ---- остальное ----
  var notifClicked = Evt(), notifClosed = Evt(), alarmEvt = Evt(), actionClicked = Evt();
  var alarms = {};
  function alarmFire(name) { alarmEvt._fire({ name: name, scheduledTime: Date.now() }); }
  function alarmClear(name) {
    var a = alarms[name]; if (!a) return false;
    clearTimeout(a.t); clearInterval(a.i); delete alarms[name]; return true;
  }

  var chromeApi = {
    runtime: runtime,
    storage: storage,
    i18n: { getMessage: function () { return ''; }, getUILanguage: function () { return 'ru'; } },
    extension: { getURL: runtime.getURL },
  };

  if (privileged) {
    chromeApi.tabs = {
      create: function (o, cb) { return done(call('tabs.create', [String((o && o.url) || '')]).then(function () { return { id: 1 }; }), cb); },
      query: function (o, cb) { return done(Promise.resolve([]), cb); },
      onUpdated: Evt(), onActivated: Evt(), onRemoved: Evt(),
    };
    chromeApi.windows = {
      getLastFocused: function (o, cb) { if (typeof o === 'function') cb = o; return done(Promise.resolve({ id: 1, focused: true }), cb); },
      getCurrent: function (o, cb) { if (typeof o === 'function') cb = o; return done(Promise.resolve({ id: 1, focused: true }), cb); },
      WINDOW_ID_CURRENT: -2,
    };
    function act(patch) { return call('action', [patch]); }
    chromeApi.action = {
      setBadgeText: function (o, cb) { return done(act({ text: String((o && o.text) || '') }), cb); },
      setBadgeBackgroundColor: function (o, cb) { return done(act({ color: o && o.color }), cb); },
      setBadgeTextColor: function (o, cb) { return done(Promise.resolve(), cb); },
      setTitle: function (o, cb) { return done(act({ title: String((o && o.title) || '') }), cb); },
      setIcon: function (o, cb) { return done(Promise.resolve(), cb); },
      setPopup: function (o, cb) { return done(act({ popup: String((o && o.popup) || '') }), cb); },
      openPopup: function (o, cb) { if (typeof o === 'function') cb = o; return done(call('openPanel', []), cb); },
      onClicked: actionClicked,
    };
    chromeApi.sidePanel = {
      setPanelBehavior: function (o, cb) { return done(Promise.resolve(), cb); },
      setOptions: function (o, cb) { return done(Promise.resolve(), cb); },
      open: function (o, cb) { return done(call('openPanel', []), cb); },
    };
    chromeApi.notifications = {
      create: function () {
        var args = Array.prototype.slice.call(arguments), cb = lastFn(args);
        if (cb) args.pop();
        var id = typeof args[0] === 'string' ? args.shift() : 'n' + Date.now() + Math.random().toString(36).slice(2, 7);
        return done(call('notify', [id, args[0] || {}]).then(function () { return id; }), cb);
      },
      clear: function (id, cb) { return done(call('notify.clear', [id]).then(function () { return true; }), cb); },
      onClicked: notifClicked, onClosed: notifClosed, onButtonClicked: Evt(),
    };
    chromeApi.alarms = {
      create: function (name, info) {
        if (typeof name !== 'string') { info = name; name = ''; }
        info = info || {};
        alarmClear(name);
        var first = info.when ? Math.max(0, info.when - Date.now()) : (info.delayInMinutes != null ? info.delayInMinutes : (info.periodInMinutes || 1)) * 60000;
        var a = alarms[name] = { name: name, period: info.periodInMinutes };
        a.t = setTimeout(function () {
          alarmFire(name);
          if (a.period) a.i = setInterval(function () { alarmFire(name); }, a.period * 60000);
          else delete alarms[name];
        }, first);
        return Promise.resolve();
      },
      clear: function (name, cb) { if (typeof name === 'function') { cb = name; name = ''; } return done(Promise.resolve(alarmClear(name || '')), cb); },
      clearAll: function (cb) { Object.keys(alarms).forEach(alarmClear); return done(Promise.resolve(true), cb); },
      get: function (name, cb) { var a = alarms[name]; return done(Promise.resolve(a ? { name: a.name, periodInMinutes: a.period } : undefined), cb); },
      getAll: function (cb) { return done(Promise.resolve(Object.keys(alarms).map(function (n) { return { name: n, periodInMinutes: alarms[n].period }; })), cb); },
      onAlarm: alarmEvt,
    };
  }

  // ---- события от браузера ----
  bridge.on(function (name, p) {
    if (name === 'storage.changed') {
      storageChanged._fire(p.changes, p.area);
      if (storage[p.area]) storage[p.area].onChanged._fire(p.changes);
    } else if (name === 'message') {
      var replied = false;
      function reply(v) { if (replied) return; replied = true; call('respond', [p.id, v === undefined ? null : v, false]).catch(function () {}); }
      var res = runtime.onMessage._fire(p.msg, p.sender, reply);
      var async = false;
      res.forEach(function (r) {
        if (r === true) async = true;
        else if (r && typeof r.then === 'function') { async = true; r.then(reply, function () { reply(undefined); }); }
      });
      if (!async && !replied) { replied = true; call('respond', [p.id, null, true]).catch(function () {}); }
    } else if (name === 'notification.clicked') notifClicked._fire(p.id);
    else if (name === 'notification.closed') notifClosed._fire(p.id, true);
    else if (name === 'action.clicked') actionClicked._fire({ id: 1 });
  });

  // ---- запросы к сайтам из host_permissions идут в обход проверки источника, как у настоящих расширений ----
  if (privileged && typeof fetch === 'function') {
    var pats = (M.host_permissions || []).concat(M.permissions || []).map(function (p) {
      if (p === '<all_urls>') return /^https?:\/\//;
      var m = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(p);
      if (!m) return null;
      var esc = function (s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); };
      var host = m[2] === '*' ? '[^/]*' : m[2].indexOf('*.') === 0 ? '(?:[^/]*\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
      return new RegExp('^' + (m[1] === '*' ? 'https?' : m[1]) + '://' + host + esc(m[3]) + '$');
    }).filter(Boolean);
    var nativeFetch = fetch.bind(globalThis);
    globalThis.fetch = function (input, init) {
      var url;
      try { url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href).href; } catch (e) { return nativeFetch(input, init); }
      var clean = url.split('#')[0];
      if (!/^https?:/.test(url) || !pats.some(function (re) { return re.test(clean); })) return nativeFetch(input, init);
      init = init || {};
      var headers = {};
      try { new Headers(init.headers || (input && input.headers) || {}).forEach(function (v, k) { headers[k] = v; }); } catch (e) { /* ignore */ }
      var body = init.body;
      var ready = body == null || typeof body === 'string' ? Promise.resolve(body == null ? null : body) : new Response(body).text();
      return ready.then(function (text) {
        return call('fetch', [url, { method: init.method || (input && input.method) || 'GET', headers: headers, body: text }]);
      }).then(function (r) {
        var nobody = r.status === 204 || r.status === 205 || r.status === 304;
        return new Response(nobody ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
      });
    };
  }

  var c = globalThis.chrome || {};
  for (var k in chromeApi) { try { c[k] = chromeApi[k]; } catch (e) { /* ignore */ } }
  try { globalThis.chrome = c; } catch (e) { /* ignore */ }
  try { globalThis.browser = c; } catch (e) { /* ignore */ }

  if (kind === 'background') {
    globalThis.importScripts = function () {};   // файлы уже подключены на странице фона
    addEventListener('load', function () { setTimeout(function () { runtime.onInstalled._fire({ reason: 'update' }); }, 0); });
  }
})
