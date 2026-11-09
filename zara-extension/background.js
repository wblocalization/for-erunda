// Раз в пару минут спрашивает таблицу о запросах: новые → уведомление, на значке — сколько ждут.
importScripts('api.js');

const FRESH = 14 * 864e5;                    // «новые» — за последние 2 недели
const ICON = chrome.runtime.getURL('icons/icon128.png');

// Показывает уведомление. Если браузер не смог загрузить картинку — пробует ещё раз с картинкой, вшитой в текст.
async function notify(id, opts) {
  const make = o => new Promise(res => chrome.notifications.create(id, o, nid => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : '')));
  let err = await make(Object.assign({ type: 'basic', iconUrl: ICON }, opts));
  if (err) err = await make(Object.assign({ type: 'basic', iconUrl: await iconData() }, opts));
  await chrome.storage.local.set({ notifyError: err || '' });
  return err;
}

async function iconData() {
  const buf = new Uint8Array(await (await fetch(ICON)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return 'data:image/png;base64,' + btoa(bin);
}

async function poll() {
  let data;
  try { data = await API.list(); }
  catch (e) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#9a8fb0' });
    chrome.action.setTitle({ title: 'Маркетинг: пуши и баннеры: ' + e.message });
    return;
  }
  // На значке — сколько свежих запросов ждут перевода.
  const waiting = data.items.filter(i => i.missing.length && !i.status && (!i.t || Date.now() - i.t < FRESH)).length;
  chrome.action.setBadgeText({ text: waiting ? String(waiting) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e5638f' });
  chrome.action.setTitle({ title: 'Маркетинг: пуши и баннеры: новых без статуса ' + waiting });

  const st = await chrome.storage.local.get({ seen: null });
  const key = i => i.id + ':' + i.ru.slice(0, 40);   // строка + начало текста: если строку перезаписали — это новый запрос
  const ids = data.items.map(key);
  if (st.seen === null) { await chrome.storage.local.set({ seen: ids, data }); return; }   // первый запуск: без шквала уведомлений
  const seen = new Set(st.seen);
  const fresh = data.items.filter(i => !seen.has(key(i)));
  fresh.slice(0, 5).forEach(i => {
    const reuse = /^♻️/.test(i.note) ? ' · ♻️ подставлено из архива' : /^🔎/.test(i.note) ? ' · 🔎 похожий уже был' : '';
    notify('req:' + i.id, {
      priority: 1,
      title: 'Новый ' + i.sheet + ': ' + (i.product || '') + reuse,
      message: i.ru.slice(0, 180),
      contextMessage: i.langs.length ? 'языки: ' + i.langs.join(', ') : '',
    });
  });
  if (fresh.length > 5) {
    notify('req:more', { title: 'Ещё новых запросов: ' + (fresh.length - 5), message: 'Откройте панель расширения' });
  }
  await chrome.storage.local.set({ seen: Array.from(new Set(st.seen.concat(ids))).slice(-3000), data });
}

async function schedule() {
  const s = await API.settings();
  chrome.alarms.create('poll', { periodInMinutes: Math.max(1, Number(s.every) || 2) });
}

// Клик по значку открывает боковую панель. Где браузер её не умеет (например, Яндекс) — обычное окошко.
function panelMode() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  else chrome.action.setPopup({ popup: 'panel.html' });
}
panelMode();

chrome.runtime.onInstalled.addListener(() => { panelMode(); schedule(); poll(); });
chrome.runtime.onStartup.addListener(() => { panelMode(); schedule(); poll(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'poll') poll(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.url || ch.token || ch.every)) { schedule(); poll(); } });
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m === 'poll') { poll().then(() => reply(true)); return true; }
  if (m === 'test-notify') {
    notify('test', { title: '🔔 Уведомления работают', message: 'Так будет выглядеть новый запрос из таблицы.' }).then(err => reply(err));
    return true;
  }
});

// Клик по уведомлению — открыть боковую панель (или окошко / таблицу, если браузер не умеет).
chrome.notifications.onClicked.addListener(async id => {
  chrome.notifications.clear(id);
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const w = await chrome.windows.getLastFocused();
      await chrome.sidePanel.open({ windowId: w.id });
    } else await chrome.action.openPopup();
  } catch (e) {
    const { data } = await chrome.storage.local.get({ data: null });
    if (data && data.url) chrome.tabs.create({ url: data.url });
  }
});
