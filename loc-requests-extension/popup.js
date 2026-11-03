const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [
  ['Новые', ['Новый']],
  ['Из архива', ['Из архива', 'Проверить']],
  ['У подрядчика', ['У подрядчика']],
  ['Готово', ['Готово']],
];
let DATA = null, TAB = 0, UNITS = [];

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 1800); }

/* ---------- список запросов ---------- */

async function load(fromCache) {
  if (fromCache) {
    const { data } = await chrome.storage.local.get({ data: null });
    if (data) { DATA = data; render(); }
  }
  $('sub').textContent = 'обновляю…';
  try {
    DATA = await API.list();
    await chrome.storage.local.set({ data: DATA });
    render();
  } catch (e) {
    $('sub').textContent = e.message;
    if (/не подключено/.test(e.message)) openSettings();
  }
}

function render() {
  const items = DATA.items.slice().reverse();
  $('sub').textContent = 'обновлено ' + DATA.updated;
  const nav = $('tabs');
  nav.innerHTML = '';
  TABS.forEach(([name, sts], i) => {
    const n = items.filter(x => sts.indexOf(x.status) !== -1).length;
    const b = document.createElement('button');
    b.textContent = name + ' ' + n;
    b.className = i === TAB ? 'on' : '';
    b.onclick = () => { TAB = i; render(); };
    nav.appendChild(b);
  });
  const list = items.filter(x => TABS[TAB][1].indexOf(x.status) !== -1);
  $('list').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">Здесь пусто 🌴</div>';
}

function card(x) {
  const kind = x.type === 'Пуш' ? 'push' : x.type === 'Баннер' ? 'banner' : 'other';
  const label = x.type === 'Баннер' && x.btype ? 'Баннер · ' + x.btype : (x.type || 'Запрос');
  const meta = [x.id, x.product, x.langs.length ? x.langs.join(', ') : '', x.limit ? 'до ' + x.limit + ' симв.' : '', x.deadline ? '⏰ ' + x.deadline : ''].filter(Boolean).join(' · ');
  let match = '';
  if (/^♻️/.test(x.match)) match = '<div class="match ' + (x.status === 'Проверить' || /провер/.test(x.match) ? 'm-check' : 'm-arc') + '">' + esc(x.match) + '</div>';
  else if (/^🔎/.test(x.match)) match = '<div class="match m-hint">' + esc(x.match) + '</div>';
  const want = x.langs.length ? x.langs : Object.keys(x.tr);
  const tags = { archive: 'из архива', check: 'проверить', over: 'длиннее лимита' };
  const trs = want.filter(l => x.tr[l]).map(l => '<div class="tr"><b>' + l + '</b><span>' + esc(x.tr[l].text) + '</span>' +
    (x.tr[l].mark ? '<span class="tag ' + x.tr[l].mark + '">' + tags[x.tr[l].mark] + '</span>' : '<span></span>') + '</div>').join('');
  const miss = want.filter(l => !x.tr[l]);
  const btn = (act, text, cls) => '<button data-act="' + act + '" data-id="' + esc(x.id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</button>';
  const btns = [];
  if (x.status === 'Новый') btns.push(btn('match', '♻️ Проверить по архиву'), btn('vendor', '📤 У подрядчика'));
  if (['Из архива', 'Проверить', 'Готово'].indexOf(x.status) !== -1) btns.push(btn('sent', '📨 Отдан', 'p'), btn('copy', '⧉ Копировать переводы'));
  if (x.status === 'У подрядчика') btns.push(btn('done', '✅ Готово'));
  btns.push(btn('open', '↗ В таблице'));
  if (x.link) btns.push('<button data-act="link" data-url="' + esc(x.link) + '">💬 Тред</button>');
  return '<div class="card"><div class="top"><span class="chip ' + kind + '">' + esc(label) + '</span>' + esc(meta) + '</div>' +
    '<div class="ru">' + esc(x.ru) + '</div>' + match + trs +
    (miss.length && x.status !== 'Новый' ? '<div class="miss">нет перевода: ' + miss.join(', ') + '</div>' : '') +
    '<div class="btns">' + btns.join('') + '</div></div>';
}

$('list').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act, x = DATA.items.find(i => i.id === b.dataset.id);
  if (act === 'open') return chrome.tabs.create({ url: x.url || DATA.url });
  if (act === 'link') return chrome.tabs.create({ url: b.dataset.url });
  if (act === 'copy') {
    const want = x.langs.length ? x.langs : Object.keys(x.tr);
    const text = want.filter(l => x.tr[l]).map(l => l + ':\n' + x.tr[l].text).join('\n\n');
    await navigator.clipboard.writeText(text);
    return toast('Переводы скопированы — вставьте в тред');
  }
  const body = act === 'match' ? { action: 'match', id: x.id }
    : { action: 'status', id: x.id, status: { vendor: 'У подрядчика', sent: 'Отдан', done: 'Готово' }[act] };
  b.disabled = true;
  try {
    DATA = await API.post(body);
    await chrome.storage.local.set({ data: DATA });
    render();
    toast(act === 'match' ? 'Проверила по архиву' : 'Статус: ' + body.status);
    chrome.runtime.sendMessage('poll');
  } catch (err) { toast(err.message); b.disabled = false; }
});

/* ---------- загрузка из Smartcat ---------- */

$('drop').onclick = () => $('file').click();
$('file').onchange = e => readFiles(e.target.files);
['dragover', 'dragenter'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', e => readFiles(e.dataTransfer.files));

async function collect(name, data, out) {
  if (/\.zip$/i.test(name)) {
    const zip = await JSZip.loadAsync(data);
    for (const f of Object.values(zip.files)) if (!f.dir) await collect(f.name.split('/').pop(), await f.async('uint8array'), out);
  } else if (/\.(xliff|xlf|sdlxliff)$/i.test(name)) {
    out.push({ name, text: new TextDecoder('utf-8').decode(data) });
  }
}

function parse(file) {
  const doc = new DOMParser().parseFromString(file.text, 'application/xml');
  const units = [];
  doc.querySelectorAll('file').forEach(f => {
    const lang = f.getAttribute('target-language') || (file.name.match(/\(ru-RU-([^)]+)\)/) || [])[1] || '';
    f.querySelectorAll('trans-unit').forEach(u => {
      const src = u.querySelector('source'), tgt = u.querySelector('target');
      if (src && tgt && tgt.textContent.trim()) units.push({ file: file.name, lang, src: src.textContent, tgt: tgt.textContent, max: u.getAttribute('maxwidth') || '' });
    });
  });
  return units;
}

async function readFiles(list) {
  const box = $('sc');
  box.classList.remove('hidden');
  box.innerHTML = 'Читаю файлы…';
  const files = [];
  try { for (const f of list) await collect(f.name, new Uint8Array(await f.arrayBuffer()), files); }
  catch (e) { box.textContent = 'Не получилось распаковать: ' + e.message; return; }
  UNITS = files.flatMap(parse);
  if (!UNITS.length) { box.textContent = 'В файлах не нашлось переводов.'; return; }
  box.innerHTML = 'Переводов: ' + UNITS.length + '. Ищу строки в таблице…';
  try { showReport(await API.post({ action: 'smartcat', units: UNITS, apply: false })); }
  catch (e) { box.textContent = e.message; }
}

const RCLS = { 'встанет': 'archive', 'вставлено': 'archive', 'уже стоит': '', 'уже есть другой перевод': 'check', 'строка не найдена': 'over', 'язык не найден': 'over' };
const ORDER = ['вставлено', 'встанет', 'уже есть другой перевод', 'уже стоит', 'строка не найдена', 'язык не найден'];
function showReport(res) {
  const rep = (res.report || []).slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const ready = rep.filter(r => r.status === 'встанет').length, done = rep.filter(r => r.status === 'вставлено').length;
  $('sc').innerHTML = '<b>' + (done ? '✅ Вставлено: ' + done : 'Встанет: ' + ready + ' из ' + rep.length) + '</b>' +
    rep.map(r => '<div class="r"><span>' + esc(r.id || '—') + '</span><b>' + esc(r.lang) + '</b><span>' + esc(r.src).slice(0, 70) +
      (r.over ? ' <span class="tag over">длиннее ' + esc(r.over) + '</span>' : '') + '</span><span class="tag ' + (RCLS[r.status] || '') + '">' + esc(r.status) + '</span></div>').join('') +
    (ready ? '<div class="btns"><button class="p" id="scApply">Вставить в таблицу</button><button id="scCancel">Отмена</button></div>' : '<div class="btns"><button id="scCancel">Закрыть</button></div>');
  const ap = $('scApply');
  if (ap) ap.onclick = async () => {
    ap.disabled = true;
    try { showReport(await API.post({ action: 'smartcat', units: UNITS, apply: true })); load(); }
    catch (e) { toast(e.message); ap.disabled = false; }
  };
  $('scCancel').onclick = () => { $('sc').classList.add('hidden'); UNITS = []; };
}

/* ---------- настройки ---------- */

async function openSettings() {
  const s = await API.settings();
  $('url').value = s.url; $('token').value = s.token; $('every').value = String(s.every);
  $('main').classList.add('hidden'); $('settings').classList.remove('hidden');
}
$('gear').onclick = openSettings;
$('back').onclick = () => { $('settings').classList.add('hidden'); $('main').classList.remove('hidden'); };
$('save').onclick = async () => {
  const url = $('url').value.trim(), token = $('token').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $('smsg').textContent = 'Нужна ссылка вида https://script.google.com/macros/s/…/exec'; return; }
  await chrome.storage.sync.set({ url, token, every: Number($('every').value) });
  $('smsg').textContent = 'Проверяю…';
  try {
    const d = await API.list();
    $('smsg').textContent = '✅ Подключено! Запросов в работе: ' + d.items.length;
    await chrome.storage.local.set({ data: d, seen: d.items.map(i => i.id) });
    DATA = d;
    setTimeout(() => { $('back').click(); render(); }, 900);
  } catch (e) { $('smsg').textContent = '❌ ' + e.message; }
};
$('testn').onclick = () => {
  $('smsg').textContent = 'Отправляю тестовое уведомление…';
  chrome.runtime.sendMessage('test-notify', err => {
    $('smsg').textContent = err
      ? '❌ Браузер не показал уведомление: ' + err
      : '✅ Отправила. Не видно в углу экрана? Значит, уведомления браузеру запрещены в системе:\n' +
        '• Windows: Параметры → Система → Уведомления → включить для вашего браузера; выключить «Не беспокоить».\n' +
        '• Mac: Системные настройки → Уведомления → ваш браузер → разрешить.';
  });
};
$('refresh').onclick = () => load();

load(true);
