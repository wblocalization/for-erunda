// Фоновый скрипт: ходит в Tracker, раз в 10 минут обновляет список задач,
// показывает напоминания о дедлайнах и счётчик на значке.
importScripts("lib/brief.js", "lib/core.js");

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj)
};
const core = LocCore.create({ fetch: (url, init) => fetch(url, init), store });
const SYNC_ALARM = "loc-sync";

// Токен лежит в хранилище расширения; страницам сайтов (и скриптам на них) доступ к нему закрыт.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

async function tick(doSync) {
  if (doSync) {
    try { await core.sync(); } catch (e) { /* ошибка уже записана в lastError и видна в окошке */ }
  }
  const due = await core.dueReminders();
  for (const r of due) {
    chrome.notifications.create("loc|" + r.url + "|" + Date.now() + Math.random(), {
      type: "basic", iconUrl: "icons/icon128.png", title: r.title, message: r.text, priority: 2
    });
  }
  const hot = await core.hotCount();
  chrome.action.setBadgeBackgroundColor({ color: "#E5484D" });
  chrome.action.setBadgeText({ text: hot ? String(hot) : "" });
}

function schedule() {
  chrome.alarms.get(SYNC_ALARM, (a) => { if (!a) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 10, delayInMinutes: 1 }); });
}

chrome.runtime.onInstalled.addListener(() => { schedule(); tick(true); });
chrome.runtime.onStartup.addListener(() => { schedule(); tick(true); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === SYNC_ALARM) tick(true); });

chrome.notifications.onClicked.addListener((id) => {
  const url = id.split("|")[1];
  if (id.indexOf("loc|") === 0 && /^https:\/\/tracker\.wb\.ru\//.test(url)) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

const handlers = {
  status: () => core.status(),
  connect: (m) => core.connect(m.token, m.sample, m.login).then((s) => tick(false).then(() => s)),
  disconnect: async () => { await chrome.storage.local.clear(); await tick(false); return core.status(); },
  sync: async () => { await core.sync(); await tick(false); return core.status(); },
  create: (m) => core.createFromBrief(m.input).then((r) => tick(false).then(() => r)),
  clone: (m) => core.cloneForLanguages(m.code, m.languages, m.opts).then((r) => tick(false).then(() => r)),
  setReminder: async (m) => {
    const s = await store.get(["reminders"]);
    const reminders = s.reminders || {};
    if (m.on) reminders[m.id] = true; else delete reminders[m.id];
    await store.set({ reminders });
    await tick(false);
    return reminders;
  },
  saveSettings: async (m) => {
    const s = await store.get(["settings"]);
    const before = Object.assign({}, LocCore.DEFAULT_SETTINGS, s.settings);
    const patch = { settings: Object.assign({}, s.settings, m.settings) };
    if ("me" in m) patch.me = m.me;
    await store.set(patch);
    // Сменили «чьи задачи» или «кто я» — список надо перечитать.
    if ("me" in m || (m.settings.scope && m.settings.scope !== before.scope)) {
      try { await core.sync(); } catch (e) { /* см. lastError */ }
    }
    await tick(false);
    return core.status();
  },
  // Страница Tracker подсказала, как выглядит ссылка на задачу.
  learnUrl: async (m) => {
    if (!/^https:\/\/tracker\.wb\.ru\/.*\{code\}/.test(m.template)) return false;
    const s = await store.get(["settings"]);
    if (s.settings && s.settings.urlLearned === m.template) return true;
    await store.set({ settings: Object.assign({}, s.settings, { urlTemplate: m.template, urlLearned: m.template }) });
    return true;
  },
  openOptions: () => { chrome.runtime.openOptionsPage(); return true; }
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(() => h(msg))
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message || String(e) }));
  return true;
});
