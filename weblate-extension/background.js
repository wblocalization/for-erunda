/* Нажатие на значок расширения: на странице Weblate открывает окно выгрузки/загрузки,
   на любой другой странице — открывает Weblate. */
const WEBLATE_URL = 'https://weblate.wb.ru/';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !/^https?:\/\/[^/]*weblate/i.test(tab.url)) {
    chrome.tabs.create({ url: WEBLATE_URL });
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['weblate-export.js'] });
  } catch (e) {
    console.error('Weblate LQA:', e);
  }
});

/* ---------- Smartcat API ----------
   Ключ API хранится только здесь (chrome.storage расширения), на страницу Weblate он не попадает.
   Страница присылает сообщения { type: 'sc-…' }, запросы к Smartcat идут отсюда (у страницы их не пускает CORS). */
const SC_SERVERS = { eu: 'https://smartcat.com', us: 'https://us.smartcat.com', ea: 'https://ea.smartcat.com' };
const SC_API = '/api/integration/v1';

async function scConfig() {
  const { sc = {} } = await chrome.storage.local.get('sc');
  return sc;
}
function scBase(c) {
  if (c.server === 'custom') return (c.customUrl || '').replace(/\/+$/, '');
  return SC_SERVERS[c.server] || SC_SERVERS.eu;
}
async function scFetch(path, init = {}) {
  const c = await scConfig();
  if (!c.accountId || !c.apiKey) throw new Error('Smartcat не подключён: ⚙ → Account ID и API-ключ');
  const headers = Object.assign({}, init.headers, { Authorization: 'Basic ' + btoa(c.accountId + ':' + c.apiKey) });
  /* init.timeout (мс) — не ждать Smartcat вечно */
  const ac = init.timeout ? new AbortController() : null, tm = ac ? setTimeout(() => ac.abort(), init.timeout) : 0;
  let r;
  try { r = await fetch(scBase(c) + SC_API + path, Object.assign({}, init, { headers }, ac ? { signal: ac.signal } : {})); }
  catch (e) { if (ac && ac.signal.aborted) throw new Error('Smartcat не ответил за ' + Math.round(init.timeout / 1000) + ' с'); throw e; }
  finally { if (tm) clearTimeout(tm); }
  if (!r.ok && r.status !== 204) {
    const t = await r.text();
    throw new Error('Smartcat ' + r.status + (r.status === 401 ? ' (неверный Account ID или ключ)' : '') + ': ' + t.slice(0, 400));
  }
  return r;
}
/* тело файла: текст или двоичный файл в base64 (docx, xlsx…) */
const fileBody = (f) => (f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : f.text);
/* шрифт окна (Onest, OFL) — отдаём странице данными: так не нужны web_accessible_resources и не мешает CSP Weblate */
const SC_FONTS = ['cyrillic', 'latin'].flatMap((s) => [400, 500, 600, 700].map((w) => ({ s, w })));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* поля про папку документа (folderId и т.п.) — нужны для ссылки на папку в сообщении в чат */
function folderFields(d) {
  const o = {};
  Object.keys(d || {}).forEach((k) => { if (/folder/i.test(k)) o[k] = d[k]; });
  return o;
}
const SC_HANDLERS = {
  async 'ui-fonts'() {
    return Promise.all(SC_FONTS.map(async (f) => {
      const buf = new Uint8Array(await (await fetch(chrome.runtime.getURL('fonts/onest-' + f.s + '-' + f.w + '-normal.woff2'))).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { s: f.s, w: f.w, b64: btoa(bin) };
    }));
  },
  async 'sc-get-config'() {
    const c = await scConfig();
    return { server: c.server || 'eu', customUrl: c.customUrl || '', accountId: c.accountId || '', hasKey: !!c.apiKey,
      langMap: c.langMap || '', extra: c.extra || '', project: c.project || '',
      enAndroid: c.enAndroid || '', enIos: c.enIos || '', enWeb: c.enWeb || '', enAssign: c.enAssign || [], enEdit: c.enEdit || [], langWeb: c.langWeb || '', langMob: c.langMob || '', links: c.links || '', bandTpl: c.bandTpl || '', bandHook: c.bandHook || '', bandAuto: !!c.bandAuto, bandPeople: c.bandPeople || '', bandTplWeb: c.bandTplWeb || '', bandTplApp: c.bandTplApp || '', linksMob: c.linksMob || '', enAssignOn: c.enAssignOn !== false, enAsgAuto: !!c.enAsgAuto, schedOn: !!c.schedOn, sched: c.sched || SCHED_DEFAULT, sound: c.sound || SOUND_DEFAULT, parts: c.parts || null, base: scBase(c), setups: c.setups || [], setup: c.setup || '' };
  },
  async 'sc-set-config'(m) {
    const c = await scConfig();
    const n = Object.assign({}, c, m.config);
    if (!m.config.apiKey) n.apiKey = c.apiKey;   // пустое поле = оставить сохранённый ключ
    await chrome.storage.local.set({ sc: n });
    return { saved: true };
  },
  async 'sc-check'() {
    const r = await scFetch('/account');
    const j = await r.json();
    return { name: j.name || j.id || '' };
  },
  async 'sc-create'(m) {
    // multipart собираем вручную: «model» — JSON-поле без имени файла (как в примерах Smartcat), дальше файлы
    const boundary = '----weblate' + Math.random().toString(16).slice(2);
    const q = (v) => String(v).replace(/"/g, '%22');
    const parts = ['--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\nContent-Type: application/json\r\n\r\n' +
      JSON.stringify(m.model) + '\r\n'];
    m.files.forEach((f) => parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + q(f.name) +
      '"\r\nContent-Type: application/octet-stream\r\n\r\n', fileBody(f), '\r\n'));
    parts.push('--' + boundary + '--\r\n');
    const r = await scFetch('/project/create', {
      method: 'POST', body: new Blob(parts), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }
    });
    return await r.json();
  },
  async 'sc-find'(m) {
    // есть ли уже проект с таким именем (для предупреждения); список ищет по вхождению — сверяем точно
    const r = await scFetch('/project/list?projectName=' + encodeURIComponent(m.name) + '&limit=20');
    const list = await r.json();
    return (Array.isArray(list) ? list : []).filter((p) => p.name === m.name).map((p) => ({ id: p.id, name: p.name }));
  },
  /* проект для машперевода: ссылка (…/projects/<id>…) или точное название → { id, name, targetLanguages } */
  async 'sc-resolve-project'(m) {
    const ref = String(m.ref || '').trim();
    const idm = /\/projects?\/([0-9a-f-]{16,})/i.exec(ref) || (/^[0-9a-f-]{16,}$/i.test(ref) ? [0, ref] : null);
    if (idm) {
      const j = await (await scFetch('/project/' + encodeURIComponent(idm[1]))).json();
      return { id: j.id, name: j.name, targetLanguages: j.targetLanguages || [] };
    }
    const list = await (await scFetch('/project/list?projectName=' + encodeURIComponent(ref) + '&limit=50')).json();
    const hit = (Array.isArray(list) ? list : []).filter((p) => p.name === ref);
    if (!hit.length) throw new Error('в Smartcat не нашёлся проект «' + ref + '» — вставь ссылку на него');
    if (hit.length > 1) throw new Error('в Smartcat несколько проектов «' + ref + '» — вставь ссылку на нужный');
    /* в списке проектов языков может не быть — берём из карточки проекта */
    let langs = hit[0].targetLanguages || [];
    if (!langs.length) {
      try { langs = (await (await scFetch('/project/' + encodeURIComponent(hit[0].id))).json()).targetLanguages || []; } catch (e) {}
    }
    return { id: hit[0].id, name: hit[0].name, targetLanguages: langs };
  },
  /* добавить файлы в существующий проект (путь в имени файла = папка) и вернуть только новые документы */
  async 'sc-add-docs'(m) {
    const before = await (await scFetch('/project/' + encodeURIComponent(m.projectId))).json();
    const known = new Set((before.documents || []).map((d) => d.id));
    const boundary = '----weblate' + Math.random().toString(16).slice(2);
    const q = (v) => String(v).replace(/"/g, '%22');
    const parts = [];
    // языки перевода — у каждого файла свои (файл на язык)
    if (m.files.some((f) => f.targetLanguages)) {
      const models = m.files.map((f) => (f.targetLanguages ? { targetLanguages: f.targetLanguages } : {}));
      parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="documentModel"\r\nContent-Type: application/json\r\n\r\n' +
        JSON.stringify(models) + '\r\n');
    }
    m.files.forEach((f) => parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + q(f.name) +
      '"\r\nContent-Type: application/octet-stream\r\n\r\n', fileBody(f), '\r\n'));
    parts.push('--' + boundary + '--\r\n');
    await scFetch('/project/document?projectId=' + encodeURIComponent(m.projectId), {
      method: 'POST', body: new Blob(parts), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }
    });
    const after = await (await scFetch('/project/' + encodeURIComponent(m.projectId))).json();
    return { name: after.name, documents: (after.documents || []).filter((d) => !known.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, fullPath: d.fullPath || d.path || '', targetLanguage: d.targetLanguage, ...folderFields(d) })) };
  },
  /* список отправок в Smartcat — копия в расширении, чтобы не терялся вместе с данными страницы */
  async 'sc-list-get'() {
    const { scProjects = [] } = await chrome.storage.local.get('scProjects');
    return scProjects;
  },
  async 'sc-list-set'(m) {
    await chrome.storage.local.set({ scProjects: m.list || [] });
    return { saved: true };
  },
  async 'sc-project'(m) {
    const r = await scFetch('/project/' + encodeURIComponent(m.id));
    return await r.json();
  },
  async 'sc-export'(m) {
    const r = await scFetch('/document/export?documentIds=' + encodeURIComponent(m.documentId) + '&type=target', { method: 'POST' });
    const task = await r.json();
    for (let i = 0; i < 60; i++) {
      const d = await scFetch('/document/export/' + encodeURIComponent(task.id));
      if (d.status === 200) return { text: await d.text() };
      await sleep(2000);
    }
    throw new Error('Smartcat долго готовит файл — попробуй ещё раз позже');
  },
};

/* ---------- Уведомление «перевод готов» ----------
   Раз в пару минут смотрим отправки из списка: когда Smartcat перевёл все их документы — показываем уведомление.
   Загружать в Weblate всё равно нажимает человек. */
const WATCH_DAYS = 3, WATCH_DAYS_HUMAN = 14;
/* машперевод (проект из сетапа / AI translation…) или переводчики (МП…) — как в окне */
function scKind(pr, sc) {
  if (pr.kind) return pr.kind;
  const proj = String(pr.name || '').split(' / ')[0], ref = String(sc.project || 'AI translation 4 MP');
  if (/ai translation|машперевод|machine/i.test(proj)) return 'mt';
  /* обычный сетап (не Магазинка): переводят люди */
  const sname = pr.setup || 'Магазинка', so = (sc.setups || []).find((x) => x.name === sname);
  if (sname !== 'Магазинка' && !(so && so.parts && so.parts.kind === 'shop')) return 'human';
  const idm = /([0-9a-f]{8}-[0-9a-f-]{27,})/i.exec(ref);
  return (idm ? pr.id === idm[1] : proj === ref) || /ai translation|машперевод|machine/i.test(proj) ? 'mt' : 'human';
}
function humanDone(d) {
  if (String(d.status || '').toLowerCase() === 'completed') return true;
  const st = d.workflowStages || [];
  return st.length > 0 && st.every((x) => (x.progress || 0) >= 100);
}

async function checkSmartcatReady() {
  const { scProjects = [], scReady = {}, sc = {} } = await chrome.storage.local.get(['scProjects', 'scReady', 'sc']);
  if (!sc.accountId || !sc.apiKey) return scReady;
  let changed = false;
  for (const pr of scProjects) {
    const key = pr.key || pr.id;
    if (pr.uploaded || scReady[key] || !pr.docs || !Object.keys(pr.docs).length) continue;
    const human = scKind(pr, sc) === 'human';
    if (pr.created && Date.now() - Date.parse(pr.created) > (human ? WATCH_DAYS_HUMAN : WATCH_DAYS) * 864e5) continue;
    let proj;
    try { proj = await (await scFetch('/project/' + encodeURIComponent(pr.id))).json(); } catch (e) { continue; }
    const docs = (proj.documents || []).filter((d) => pr.docs[d.id]);
    if (!docs.length) continue;
    const ready = docs.every((d) => human ? humanDone(d) : (!d.documentDisassemblingStatus || d.documentDisassemblingStatus === 'success') &&
      d.pretranslateCompleted !== false);
    if (!ready) continue;
    scReady[key] = new Date().toISOString();
    changed = true;
    try {
      await notify('sc-ready|' + key, {
        type: 'basic', iconUrl: 'icons/icon128.png', title: human ? 'Smartcat: переводчики закончили' : 'Smartcat: машперевод готов',
        message: (pr.name || 'Отправка') + ' — ' + docs.length + ' файл(ов). Нажми, чтобы открыть и загрузить в Weblate.',
        priority: 2
      });
    } catch (e) { console.error('Weblate LQA:', e); }
  }
  if (changed) await chrome.storage.local.set({ scReady });
  return scReady;
}

/* ---------- Звук уведомлений: «системный» — как решит Chrome/ОС; остальные играем сами в offscreen-документе ---------- */
const SOUND_DEFAULT = 'system';
async function playSound(sound) {
  if (!sound || sound === 'system' || sound === 'off') return;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Звук уведомления о готовом переводе' });
    }
  } catch (e) { /* документ уже создаётся параллельно */ }
  chrome.runtime.sendMessage({ type: 'wlx-play-sound', sound }).catch(() => {});
}
async function notify(id, opts) {
  const sound = (await scConfig()).sound || SOUND_DEFAULT;
  if (sound !== 'system') opts.silent = true;
  await chrome.notifications.create(id, opts);
  playSound(sound);
}
SC_HANDLERS['play-sound'] = async (m) => { await playSound(m.sound); return { ok: true }; };

function ensureAlarm() {
  chrome.alarms.get('sc-watch', (a) => { if (!a) chrome.alarms.create('sc-watch', { periodInMinutes: 2 }); });
  chrome.alarms.get('sc-sched', (a) => { if (!a) chrome.alarms.create('sc-sched', { periodInMinutes: 1 }); });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sc-watch') checkSmartcatReady().catch((e) => console.error('Weblate LQA:', e));
  if (a.name === 'sc-sched') schedTick().catch((e) => console.error('Weblate LQA:', e));
});

/* ---------- Отправка android + ios в Smartcat по расписанию (время московское) ----------
   В назначенное время открываем Weblate в фоновой вкладке и жмём «🚀 Выгрузить и отправить в Smartcat».
   Пропустили (компьютер спал, Chrome закрыт) — уведомление с кнопкой «Отправить сейчас», само не шлём.
   Если сегодня уже отправляли android / ios — второй раз не отправляем. */
const SCHED_DEFAULT = 'вт 14:00, пт 10:00';
const DOW = { 'вс': 0, 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6 };
const DOW_NAME = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function parseSched(t) {
  return String(t || '').split(/[,;\n]+/).map((x) => {
    const m = /(вс|пн|вт|ср|чт|пт|сб)\D*(\d{1,2})[:.](\d{2})/i.exec(x.trim());
    return m ? { dow: DOW[m[1].toLowerCase()], h: +m[2], m: +m[3], label: m[1].toLowerCase() + ' ' + m[2].padStart(2, '0') + ':' + m[3] } : null;
  }).filter(Boolean);
}
const mskNow = (t = Date.now()) => new Date(t + 3 * 3600e3);        // UTC-поля этой даты = московское время
const ddmmyyMsk = (d) => String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCFullYear()).slice(-2);
async function schedTick() {
  const { sc = {}, schedState = {} } = await chrome.storage.local.get(['sc', 'schedState']);
  if (!sc.schedOn) return;
  const now = Date.now(), m = mskNow(now), day = m.toISOString().slice(0, 10);
  let changed = false;
  for (const s of parseSched(sc.sched || SCHED_DEFAULT)) {
    if (m.getUTCDay() !== s.dow) continue;
    const slot = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate(), s.h, s.m) - 3 * 3600e3;
    const key = day + ' ' + s.label;
    if (now < slot || schedState[key]) continue;
    changed = true;
    if (now - slot <= 20 * 60e3) { schedState[key] = 'run'; await chrome.storage.local.set({ schedState }); await runAuto(s.label); }
    else {
      schedState[key] = 'missed';
      notify('sc-sched-miss|' + s.label + '|' + now, { type: 'basic', iconUrl: 'icons/icon128.png', priority: 2, requireInteraction: true,
        title: 'Smartcat: пропущена отправка ' + s.label, message: 'В ' + s.label + ' (МСК) компьютер или Chrome были выключены. Выгрузить android и ios и отправить сейчас?',
        buttons: [{ title: 'Отправить сейчас' }, { title: 'Не надо' }] });
    }
  }
  Object.keys(schedState).forEach((k) => { if (Date.parse(k.slice(0, 10)) < now - 14 * 864e5) { delete schedState[k]; changed = true; } });
  if (changed) await chrome.storage.local.set({ schedState });
}
function schedNote(title, message, id) {
  notify(id || 'sc-sched-done|' + Date.now(), { type: 'basic', iconUrl: 'icons/icon128.png', priority: 2, title, message });
}
let autoTabId = null;
async function runAuto(label) {
  const { scProjects = [] } = await chrome.storage.local.get('scProjects');
  const ld = new Date(), local = String(ld.getDate()).padStart(2, '0') + String(ld.getMonth() + 1).padStart(2, '0') + String(ld.getFullYear()).slice(-2);
  const days = [ddmmyyMsk(mskNow()), local];          // имя папки — по часам компьютера; на всякий случай и московская дата
  const already = scProjects.filter((p) => days.some((d) => new RegExp('#' + d + '_(android|ios)$').test(p.key || '')));
  if (already.length) { schedNote('Smartcat: по расписанию не отправляю', 'Сегодня уже отправлено: ' + already.map((p) => p.name).join(', ') + '. Второй раз не шлю.'); return; }
  const tab = await chrome.tabs.create({ url: WEBLATE_URL, active: false });
  autoTabId = tab.id;
  await new Promise((res) => {
    const f = (tid, info) => { if (tid === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); res(); } };
    chrome.tabs.onUpdated.addListener(f);
    setTimeout(res, 60000);
  });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['weblate-export.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (l) => { window.__wlExport && window.__wlExport.autoSend(l); }, args: [label || 'сейчас'] });
  } catch (e) { schedNote('Smartcat: отправка по расписанию не удалась', String(e.message || e)); }
}
SC_HANDLERS['sc-auto-done'] = async (m) => {
  const text = m.error ? '✗ ' + m.error : m.nothing ? 'Нечего отправлять — всё переведено 🎉'
    : 'Отправлено: ' + (m.made || []).join(', ') + ((m.en || []).length ? '. Английский: ' + m.en.join(', ') : '');
  schedNote(m.error ? 'Smartcat: отправка по расписанию не удалась' : 'Smartcat: отправлено по расписанию (' + (m.slot || '') + ')', text.slice(0, 300));
  if (autoTabId) { const id = autoTabId; autoTabId = null; setTimeout(() => chrome.tabs.remove(id).catch(() => {}), 60000); }
  return { ok: true };
};
SC_HANDLERS['sc-sched-run-now'] = async () => { await runAuto('вручную'); return { ok: true }; };
chrome.notifications.onButtonClicked.addListener((id, idx) => {
  if (!id.startsWith('sc-sched-miss|')) return;
  chrome.notifications.clear(id);
  if (idx === 0) runAuto(id.split('|')[1]).catch((e) => console.error('Weblate LQA:', e));
});
chrome.runtime.onStartup.addListener(() => { schedTick().catch(() => {}); });

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('sc-ready|') && !id.startsWith('sc-sched-done|')) return;
  chrome.notifications.clear(id);
  const tabs = await chrome.tabs.query({ url: WEBLATE_URL + '*' });
  let tab = tabs[0];
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    tab = await chrome.tabs.create({ url: WEBLATE_URL });
    await new Promise((res) => {
      const f = (tid, info) => { if (tid === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); res(); } };
      chrome.tabs.onUpdated.addListener(f);
    });
  }
  await chrome.windows.update(tab.windowId, { focused: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['weblate-export.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__wlExport && window.__wlExport.openTab('sc') });
  } catch (e) { console.error('Weblate LQA:', e); }
});

/* все проекты аккаунта (постранично), свежие сверху */
SC_HANDLERS['sc-projects'] = async () => {
  const out = [], seen = new Set(), step = 100;
  for (let off = 0; off < 3000; off += step) {
    const list = await (await scFetch('/project/list?offset=' + off + '&limit=' + step)).json();
    if (!Array.isArray(list) || !list.length) break;
    let fresh = 0;
    list.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); fresh++; out.push({ id: p.id, name: p.name, status: p.status || '',
      created: p.creationDate || '', modified: p.modificationDate || p.creationDate || '', deadline: p.deadline || '',
      targetLanguages: p.targetLanguages || [] }); } });
    if (list.length < step || !fresh) break;       // последняя страница (или API не умеет offset)
  }
  out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return out;
};
/* «Моя команда» в Smartcat — для назначения переводчиков */
SC_HANDLERS['sc-team'] = async () => {
  const out = [], seen = new Set();
  for (let skip = 0; skip < 2000; skip += 100) {
    const r = await scFetch('/account/searchMyTeam', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skip, limit: 100 }) });
    const list = await r.json();
    const arr = Array.isArray(list) ? list : (list && (list.items || list.users || list.result)) || [];
    let fresh = 0;
    arr.forEach((x) => {
      const id = x.id || x.userId; if (!id || seen.has(id)) return;
      seen.add(id); fresh++;
      out.push({ id, name: [x.firstName, x.lastName].filter(Boolean).join(' ') || x.name || x.email || id, email: x.email || '' });
    });
    if (arr.length < 100 || !fresh) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
};
/* назначить людей из «Моей команды» на документы (этап 1 — перевод); документ после загрузки ещё разбирается — повторяем */
/* проекты «с задачами» (новый режим Smartcat): людей назначают на задачу, а не на документ.
   Задачи берём из /projectTask/{проект}/list, свои находим по id документа, этап — по номеру или типу задачи */
function taskStage(t) {
  const n = t.stageNumber ?? t.workflowStageNumber ?? (t.stage && (t.stage.number ?? t.stage.stageNumber)) ??
    (t.workflowStage && (t.workflowStage.number ?? t.workflowStage.stageNumber ?? t.workflowStage.order));
  if (n != null && !isNaN(+n)) return +n;
  const ty = String(t.stageType || t.taskType || t.type || (t.workflowStage && (t.workflowStage.type || t.workflowStage.stageType)) || (t.stage && t.stage.type) || '').toLowerCase();
  if (/transl|перев/.test(ty)) return 1;
  if (/edit|proof|review|post|редакт|коррект/.test(ty)) return 2;
  return null;
}
async function assignByTasks(projectIds, docIds, stage, userIds) {
  const json = (o) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  const done = new Set(), info = [], tasksDone = [], modes = new Set(), diag = [];
  /* режим «все, кто примет» (crowd) ставится задаче отдельной командой; в каком порядке с приглашением — в API не сказано,
     поэтому пробуем до приглашения и после него и запоминаем, что сработало */
  const crowd = { ok: 0, fail: 0, when: '', err: '' };
  const cleanErr = (e) => String(e.message).replace(/Error processing request\.|Correlation id: [\w-]+,?|Trace id: \w+/g, '').trim().slice(0, 160);
  const setCrowd = (pid, tid) => scFetch('/projectTask/' + encodeURIComponent(pid) + '/' + encodeURIComponent(tid) +
    '/set-invitation-strategy-type?invitationStrategyType=crowd', { method: 'PUT', timeout: 30000 });
  /* id документа Smartcat — «<документ>_<язык>»; в задаче может быть полный id или только «<документ>» */
  const base = (id) => { id = String(id); const i = id.lastIndexOf('_'); return i > 0 ? id.slice(0, i) : id; };
  const hit = (str, id) => str.includes('"' + id + '"') || str.includes('"' + base(id) + '"');
  for (const pid of [...new Set(projectIds)]) {
    let list;
    /* список задач Smartcat отдаёт только с валютой (в задачах есть стоимость) */
    let lastErr = null;
    for (const cur of ['USD', 'RUB', 'EUR', '']) {
      try { list = await (await scFetch('/projectTask/' + encodeURIComponent(pid) + '/list' + (cur ? '?currency=' + cur : ''))).json(); lastErr = null; break; }
      catch (e) { lastErr = e; if (!/currency/i.test(String(e.message))) break; }
    }
    if (lastErr) { info.push(pid + ': ' + String(lastErr.message).slice(0, 160)); continue; }   // проект без задач — пропускаем
    list = Array.isArray(list) ? list : (list && (list.items || list.tasks || list.result || list.data)) || [];
    const mine = list.map((t) => ({ t, s: JSON.stringify(t) })).filter((x) => docIds.some((id) => hit(x.s, id)));
    info.push(pid + ': задач ' + list.length + ', наших ' + mine.length + (list[0] ? ', пример: ' + JSON.stringify(list[0]).slice(0, 300) : ''));
    const staged = mine.filter((x) => taskStage(x.t) === stage);
    const pick = staged.length ? staged : (stage === 1 && mine.length && mine.every((x) => taskStage(x.t) == null) ? mine : []);
    for (const { t } of pick) {
      const tid = t.id || t.taskId || t.projectTaskId;
      if (!tid) continue;
      const path = '/projectTask/' + encodeURIComponent(pid) + '/' + encodeURIComponent(tid) + '/individual-assignment';
      /* сразу после загрузки Smartcat ещё считает слова — у задачи «нулевой объём», назначать нельзя: ждём и повторяем */
      for (let tryN = 0; ; tryN++) {
        try {
          /* режим «Все, кто примет»: в задаче поле может называться по-разному — шлём все варианты, лишние Smartcat игнорирует */
          /* в API назначения на задачу режима нет (только userIds) — Smartcat ставит «Первый, кто принял»;
             «Все, кто примет» выбирается в самом Smartcat у задачи */
          const variants = [['userIds', { userIds }]].concat(userIds.length === 1 ? [['userId', { userId: userIds[0] }]] : []);
          const vErr = [];
          let ok = null;
          let before = false, beforeErr = '';
          try { await setCrowd(pid, tid); before = true; } catch (e) { beforeErr = cleanErr(e); }
          for (const [name, body] of variants) {
            try { await scFetch(path, json(body)); ok = name; break; } catch (e) {
              if (/zero volume/i.test(String(e.message))) throw e;
              vErr.push(name + ': ' + String(e.message).replace(/Error processing request\.|Correlation id: [\w-]+,?|Trace id: \w+/g, '').trim().slice(0, 140));
            }
          }
          if (!ok) throw new Error(vErr.join(' | '));
          if (vErr.length) diag.push('этап ' + stage + ': прошёл «' + ok + '» (до этого: ' + vErr.join(' | ').slice(0, 400) + ')');
          let after = false, afterErr = '';
          try { await setCrowd(pid, tid); after = true; } catch (e) { afterErr = cleanErr(e); }
          /* проверяем, какой режим реально стоит у задачи: «все, кто примет» — обязательное условие */
          let real = '';
          try {
            const tj = await (await scFetch('/projectTask/' + encodeURIComponent(pid) + '/' + encodeURIComponent(tid) + '?currency=USD', { timeout: 30000 })).json();
            real = String(tj && tj.invitationStrategyType != null ? tj.invitationStrategyType : '').toLowerCase();
          } catch (e) { /* не смогли перечитать — судим по ответам команд */ }
          const isCrowd = real === 'crowd' || (real !== 'rocket' && (before || after));
          if (isCrowd) { crowd.ok++; crowd.when = after ? (before ? 'до и после приглашения' : 'после приглашения') : 'до приглашения'; if (real) modes.add(real); }
          else {
            /* режим не встал — приглашения «первый, кто принял» не оставляем: отзываем */
            crowd.fail++; crowd.err = (real === 'rocket' ? 'у задачи остался режим «первый, кто принял»' : '') + (afterErr || beforeErr ? ' ' + (afterErr || beforeErr) : '');
            let undone = 0;
            for (const uid of userIds) {
              try { await scFetch(path + '?userId=' + encodeURIComponent(uid), { method: 'DELETE', timeout: 30000 }); undone++; } catch (e) { /* уже нет */ }
            }
            const er = new Error('режим «все, кто примет» поставить не получилось (' + crowd.err.trim() + '). Приглашения отозвала: ' + undone + ' из ' + userIds.length + ' — назначь в Smartcat вручную');
            er.crowdFail = true; throw er;
          }
          break;
        } catch (e) {
          if (e.crowdFail || !/zero volume/i.test(String(e.message)) || tryN >= 12) throw e;
          await sleep(10000);
        }
      }
      const ts = JSON.stringify(t);
      docIds.forEach((id) => { if (hit(ts, id)) done.add(id); });
      tasksDone.push({ pid, tid });
    }
  }
  /* перечитать задачи и показать, какой режим назначения реально стоит в Smartcat */
  for (const { pid, tid } of tasksDone.slice(0, 3)) {
    try {
      let l = await (await scFetch('/projectTask/' + encodeURIComponent(pid) + '/list?currency=USD')).json();
      l = Array.isArray(l) ? l : (l && (l.items || l.tasks || l.result || l.data)) || [];
      const t = l.filter((x) => (x.id || x.taskId || x.projectTaskId) === tid)[0];
      const md = t && taskMode(t);
      if (md) modes.add(md);
    } catch (e) { /* не страшно */ }
  }
  if (!done.size) throw new Error('в проекте с задачами не нашла задач этапа ' + stage + ' для этих документов. ' + info.join(' | '));
  return { n: done.size, mode: [...modes].join(', '), diag: diag.slice(0, 2).join('; '), crowd, tasks: tasksDone.length };
}
/* режим назначения задачи — поле с mode / strategy / distribution в названии (на 1–2 уровня вглубь) */
function taskMode(t, depth = 0) {
  for (const k of Object.keys(t || {})) {
    const v = t[k];
    if (/mode|strateg|distribut/i.test(k) && (typeof v === 'string' || typeof v === 'number')) return k + '=' + v;   // у задач — invitationStrategyType
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) { const r = taskMode(v, depth + 1); if (r) return r; }
  }
  return '';
}
/* срок у загруженных файлов: в Smartcat срок ставится задаче (у каждого документа по языку и этапу — своя задача).
   Ищем задачи этих документов и ставим им срок; задачи появляются не сразу после загрузки — ждём до ~30 с */
/* все задачи проекта: Smartcat отдаёт их страницами (по 50) — листаем offset/limit, запасной вариант skip/take;
   если параметры не понимает (та же страница) — останавливаемся */
let scCur = null;
async function scTaskList(pid, until, errs) {
  const get = async (q) => {
    const u = '/projectTask/' + encodeURIComponent(pid) + '/list?' + q;
    const r = await (await scFetch(u, { timeout: 30000 })).json();
    return Array.isArray(r) ? r : (r && (r.items || r.tasks || r.result || r.data)) || [];
  };
  let first = null;
  for (const cur of scCur ? [scCur] : ['USD', 'RUB', 'EUR', '']) {
    try { first = await get(cur ? 'currency=' + cur : ''); scCur = cur; break; }
    catch (e) { if (!/currency/i.test(String(e.message))) { errs.push(String(e.message).slice(0, 160)); return null; } }
  }
  if (!first) return null;
  const cq = scCur ? 'currency=' + scCur + '&' : '', size = first.length, all = first.slice();
  const idOf = (t) => String(t.id || t.taskId || t.projectTaskId || JSON.stringify(t));
  const have = new Set(all.map(idOf));
  if (!size) return all;
  for (const [o, l] of [['offset', 'limit'], ['skip', 'take']]) {
    let grew = false;
    for (let off = size, pg = 0; pg < 60 && Date.now() < until; off += size, pg++) {
      let page;
      try { page = await get(cq + o + '=' + off + '&' + l + '=' + size); } catch (e) { errs.push(String(e.message).slice(0, 160)); break; }
      const fresh = page.filter((t) => !have.has(idOf(t)));
      if (!fresh.length) break;
      fresh.forEach((t) => { have.add(idOf(t)); all.push(t); });
      grew = true;
      if (page.length < size) break;
    }
    if (grew) break;
  }
  return all;
}
SC_HANDLERS['sc-deadline'] = async (m) => {
  const iso = String(m.deadline || '');
  if (!iso) throw new Error('срок не указан');
  const base = (id) => { id = String(id); const i = id.lastIndexOf('_'); return i > 0 ? id.slice(0, i) : id; };
  const hit = (str, id) => str.includes('"' + id + '"') || str.includes('"' + base(id) + '"');
  const ids = [...new Set((m.documentIds || []).map(String))];
  let n = 0, found = 0, noTasks = 0, seen = 0; const errs = [], doneTask = {}, covered = {};
  const until = Date.now() + 120000;   /* всего не больше ~2 мин: большие проекты отдают задачи долго и страницами */
  for (const pid of [...new Set(m.projectIds || [])]) {
    /* задачи у файлов появляются не сразу и не все разом (у части языков — когда их возьмут) —
       ждём до ~1 мин, пока задачи не найдутся у всех документов, ставим срок каждой новой */
    let listed = false;
    for (let round = 0; round < 12 && Date.now() < until; round++) {
      const list = await scTaskList(pid, until, errs);
      if (!list) break;
      listed = true;
      seen = Math.max(seen, list.length);
      for (const t of list) {
        const js = JSON.stringify(t), mineIds = ids.filter((id) => hit(js, id));
        const tid = t.id || t.taskId || t.projectTaskId;
        if (!mineIds.length || !tid || doneTask[tid]) continue;
        doneTask[tid] = 1; found++;
        const path = '/projectTask/' + encodeURIComponent(pid) + '/' + encodeURIComponent(tid) + '/deadline';
        const tries = [
          [path + '?deadline=' + encodeURIComponent(iso), { method: 'PUT' }],
          [path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: iso }) }],
          [path + '?deadline=' + encodeURIComponent(iso), { method: 'POST' }]
        ];
        let ok = false;
        for (const [u, init] of tries) { try { await scFetch(u, Object.assign({ timeout: 20000 }, init)); ok = true; break; } catch (e) { errs.push(String(e.message).slice(0, 160)); } }
        if (ok) { n++; mineIds.forEach((id) => { covered[id] = 1; }); }
      }
      if (ids.every((id) => covered[id]) || Date.now() > until) break;
      await sleep(5000);
    }
    if (listed && !found) noTasks++;
  }
  const left = ids.filter((id) => !covered[id]).length;
  if (!n) throw new Error(found ? 'Smartcat не принял срок: ' + (errs[errs.length - 1] || '') : 'у этих файлов в Smartcat нет задач — в этом проекте срок ставится вручную' + (seen ? ' (задач в проекте: ' + seen + ', но не этих файлов)' : ' (в проекте нет ни одной задачи)') + (errs[0] ? ' ' + errs[0] : ''));
  return { ok: true, tasks: n, of: found, docs: ids.length, left: left };
};
SC_HANDLERS['sc-assign'] = async (m) => {
  const stage = m.stage || 1;
  const json = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  /* Smartcat: POST /document/assign?documentId=…&stageNumber=… — по одному документу,
     в теле исполнители и режим «распределить между всеми, кто принял»; запасной путь — «Моя команда».
     Если проект «работает с задачами» — назначаем на задачи (assignByTasks) */
  const taskDocs = new Set();
  const assignOne = async (docId) => {
    const q = '/document/assign?documentId=' + encodeURIComponent(docId) + '&stageNumber=' + stage;
    const errs = [];
    for (const mode of ['distributeAmongAll', 'DistributeAmongAll']) {
      try {
        await scFetch(q, json({ executives: m.userIds.map((id) => ({ id, wordsCount: 0 })), minWordsCountForExecutive: 0, assignmentMode: mode }));
        return 'assign';
      } catch (e) {
        if (/works with tasks/i.test(String(e.message))) { const t = new Error('tasks'); t.tasks = true; throw t; }
        errs.push('assign: ' + String(e.message).slice(0, 200)); if (!/mode/i.test(String(e.message))) break;
      }
    }
    try {
      await scFetch('/document/assignFromMyTeam', json({ documentIds: [docId], stageNumber: stage, strategy: 'distributeAmongAll', userIds: m.userIds }));
      return 'myTeam';
    } catch (e) { errs.push('myTeam: ' + String(e.message).slice(0, 200)); }
    throw new Error(errs.join(' | '));
  };
  const left = new Set(m.documentIds), done = [], errs = {};
  for (let round = 0; round < 6 && left.size; round++) {
    let notReady = false;
    for (const id of [...left]) {
      try { await assignOne(id); left.delete(id); done.push(id); } catch (e) {
        if (e.tasks) { left.delete(id); taskDocs.add(id); continue; }    // проект «с задачами» — назначим ниже через задачи
        const t = String(e.message); errs[id] = t;
        if (/disassembl|not ready|processing|is being|not found.*document|документ/i.test(t)) notReady = true;
      }
    }
    if (!left.size || !notReady) break;   // ошибка не про «документ ещё разбирается» — ждать смысла нет
    await sleep(5000);
  }
  let how = 'assign';
  if (taskDocs.size) {
    if (!m.projectIds || !m.projectIds.length) throw new Error('проект работает с задачами, а id проекта не передан');
    let lastErr = null, n = 0; var taskMode_ = '', taskDiag_ = '', taskCrowd_ = null, taskN_ = 0;
    for (let round = 0; round < 6; round++) {       // задачи появляются не сразу после загрузки файла
      try { const r = await assignByTasks(m.projectIds, [...taskDocs], stage, m.userIds); n = r.n; taskMode_ = r.mode; taskDiag_ = r.diag; taskCrowd_ = r.crowd; taskN_ = r.tasks; lastErr = null; break; }
      catch (e) { lastErr = e; if (!/не нашла задач/.test(String(e.message))) break; await sleep(5000); }
    }
    if (lastErr) throw lastErr;
    done.push(...Array(n).fill(0)); how = 'tasks';
  }
  if (left.size) {
    const first = errs[[...left][0]] || '';
    throw new Error((done.length ? 'назначено ' + done.length + ' из ' + m.documentIds.length + ', не получилось: ' : '') + first);
  }
  return { ok: true, how, docs: done.length, mode: typeof taskMode_ !== 'undefined' ? taskMode_ : '', diag: typeof taskDiag_ !== 'undefined' ? taskDiag_ : '',
    crowd: typeof taskCrowd_ !== 'undefined' ? taskCrowd_ : null, tasks: typeof taskN_ !== 'undefined' ? taskN_ : 0 };
};
/* сообщение в рабочий чат по вебхуку (Band / Mattermost / Slack-совместимый: JSON {"text": …}).
   «простой» запрос без предварительной проверки: ответ чата не читается, поэтому успех не гарантирован */
SC_HANDLERS['band-send'] = async (m) => {
  const url = String(m.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('ссылка вебхука должна начинаться с https://');
  await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ text: String(m.text || '') }) });
  return { sent: true };
};
SC_HANDLERS['sc-ready-get'] = async () => (await chrome.storage.local.get('scReady')).scReady || {};
SC_HANDLERS['sc-watch-now'] = () => checkSmartcatReady();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && SC_HANDLERS[msg.type];
  if (!h) return;
  h(msg).then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});
