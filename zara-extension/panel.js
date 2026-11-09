const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (!chrome.sidePanel) document.documentElement.classList.add('popup');   // браузер без боковой панели — обычное окошко

const LANG_NAMES = { KK: 'казахский', KY: 'кыргызский', UZ: 'узбекский', HY: 'армянский', TG: 'таджикский', KA: 'грузинский', AZ: 'азербайджанский', EN: 'английский' };
// Вкладки: в таблице Зары нет статусов — смотрим, какие заказанные языки уже переведены.
const TABS = [
  { key: 'wait', name: 'Ждут перевода', cls: 'st-new', f: x => x.missing.length > 0, hint: 'Заказанные языки без перевода (красные). Проверьте по архиву или загрузите xliff во вкладке «📥 Файлы».' },
  { key: 'arc', name: 'Из архива', cls: 'st-arc', f: x => /^♻️/.test(x.note), hint: 'Переводы подставлены из архива — откуда, видно в заметке. Жёлтые языки проверьте.' },
  { key: 'done', name: 'Переведено', cls: 'st-done', f: x => x.missing.length === 0, hint: 'Все заказанные языки на месте.' },
];
let DATA = null, TAB = 0, KIND = '', Q = '', UNITS = [], STATS = null, SECTION = 'req', PERIOD = 'month';
const DAY = 864e5;

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 1900); }
async function copy(text, msg) { await navigator.clipboard.writeText(text); toast(msg || 'Скопировано'); }

/* ---------- разделы ---------- */

function show(sec) {
  SECTION = sec;
  ['req', 'search', 'stats', 'sc', 'settings'].forEach(s => $(s).classList.toggle('hidden', s !== sec));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  if (sec === 'stats') loadStats();
  if (sec === 'search') $('sq').focus();
}
$('nav').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.sec); };

/* ---------- запросы ---------- */

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
    if (SECTION === 'stats') loadStats(true);
  } catch (e) {
    $('sub').textContent = e.message;
    if (/не подключено/.test(e.message)) openSettings();
  }
}

function render() {
  $('sub').textContent = 'обновлено ' + DATA.updated;
  const items = DATA.items.slice().reverse();   // свежие сверху
  const fresh = x => !x.t || Date.now() - x.t < 14 * DAY;
  $('navNew').textContent = items.filter(x => x.missing.length && fresh(x)).length || '';
  $('tiles').style.gridTemplateColumns = 'repeat(3,1fr)';
  $('tiles').innerHTML = TABS.map((t, i) => '<button class="tile ' + t.cls + (i === TAB ? ' on' : '') + '" data-i="' + i + '"><b>' + items.filter(t.f).length + '</b><span>' + t.name + '</span></button>').join('');
  $('tabHint').textContent = TABS[TAB].hint;
  const q = Q.toLowerCase();
  const list = items.filter(x => TABS[TAB].f(x) && (!KIND || x.sheet === KIND) &&
    (!q || [x.ru, x.product, x.btype, x.row].join(' ').toLowerCase().indexOf(q) !== -1));
  $('bulk').innerHTML = '';
  $('list').innerHTML = list.length ? list.slice(0, 150).map(card).join('') : '<div class="empty">Здесь пусто 🌴</div>';
}

function card(x) {
  const kind = x.sheet === 'баннер' ? 'banner' : 'push';
  const label = x.sheet === 'баннер' ? 'Баннер' + (x.btype ? ' · ' + x.btype : '') : 'Пуш';
  const langs = x.langs.map(l => '<span class="lchip ' + (x.tr[l] ? 'ok' : 'no') + '" title="' + (x.tr[l] ? 'переведено' : 'нет перевода') + '">' + l + '</span>').join('');
  let match = '';
  if (/^♻️/.test(x.note)) match = '<div class="match ' + (/Проверить:/.test(x.note) ? 'm-check' : 'm-arc') + '">' + esc(x.note) + '</div>';
  else if (/^🔎/.test(x.note)) match = '<div class="match m-hint">' + esc(x.note) + '</div>';
  const trs = x.langs.filter(l => x.tr[l]).map(l => '<div class="tr" data-copy="' + esc(x.tr[l]) + '" title="Нажмите, чтобы скопировать"><b>' + l + '</b><span>' + esc(x.tr[l]) + '</span><span></span></div>').join('');
  const btn = (act, text, cls) => '<button data-act="' + act + '" data-id="' + esc(x.id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</button>';
  const btns = [];
  if (x.missing.length) btns.push(btn('check', '♻️ Проверить по архиву', 'p'));
  if (trs) btns.push(btn('copy', '⧉ Копировать переводы'));
  btns.push(btn('open', '↗ Строка ' + x.row));
  return '<div class="card ' + (x.missing.length ? 'st-new' : 'st-done') + '"><div class="top"><span class="chip ' + kind + '">' + esc(label) + '</span>' +
    (x.date ? '<span>от ' + esc(x.date) + '</span>' : '') + (x.product ? '<span>· ' + esc(x.product) + '</span>' : '') + '</div>' +
    (langs ? '<div class="langs">' + langs + '</div>' : '<div class="miss">языки не указаны</div>') +
    '<div class="ru">' + esc(x.ru) + '</div>' + match + trs +
    '<div class="btns">' + btns.join('') + '</div></div>';
}

$('tiles').onclick = e => { const b = e.target.closest('.tile'); if (b) { TAB = Number(b.dataset.i); render(); $('list').scrollTop = 0; } };
$('kind').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  KIND = b.dataset.k; document.querySelectorAll('#kind button').forEach(x => x.classList.toggle('on', x === b)); render();
};
$('q').oninput = e => { Q = e.target.value.trim(); render(); };

$('list').addEventListener('click', async e => {
  const t = e.target.closest('.tr[data-copy]');
  if (t) return copy(t.dataset.copy, t.querySelector('b').textContent + ' скопирован');
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const a = b.dataset.act, x = DATA.items.find(i => i.id === b.dataset.id);
  if (a === 'open') return chrome.tabs.create({ url: x.url || DATA.url });
  if (a === 'copy') return copy(x.langs.filter(l => x.tr[l]).map(l => l + ':\n' + x.tr[l]).join('\n\n'), 'Переводы скопированы — вставьте в тред');
  if (a === 'check') {
    b.disabled = true;
    try {
      const r = await API.post({ action: 'check', sheet: x.sheet, row: x.row });
      DATA = r; await chrome.storage.local.set({ data: DATA }); render();
      const c = r.check || {};
      toast(c.filled ? 'Подставила из архива: ' + c.filled + (c.check ? ' (проверить: ' + c.check + ')' : '') : c.fuzzy ? 'Точно такого нет, есть похожий — смотрите заметку' : 'В архиве такого текста нет — нужно заказывать');
    } catch (err) { toast(err.message); b.disabled = false; }
  }
});

/* ---------- поиск по архиву ---------- */

async function search() {
  const q = $('sq').value.trim();
  if (!q) return;
  $('sres').innerHTML = '<div class="empty">Ищу…</div>';
  let r;
  try { r = await API.post({ action: 'search', q }); } catch (e) { $('sres').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
  let html = '';
  const langs = Object.keys(r.per);
  if (langs.length) {
    // Группы по источнику и уровню совпадения.
    const groups = {};
    langs.forEach(l => { const p = r.per[l]; const k = p.src + '|' + p.level; (groups[k] = groups[k] || { p, langs: [] }).langs.push(l); });
    const all = langs.map(l => l + ':\n' + r.per[l].text).join('\n\n');
    html += '<div class="res"><h3>♻️ Уже переводили</h3>' + Object.values(groups).map(g =>
      '<div class="match ' + (g.p.level === 'num' || g.p.level === 'punct' ? 'm-check' : 'm-arc') + '">' + esc(g.p.src) + ' · ' + esc(g.p.words) + '\nисходник: ' + esc(g.p.ru) + '</div>' +
      g.langs.map(l => '<div class="tr" data-copy="' + esc(r.per[l].text) + '" title="Нажмите, чтобы скопировать"><b>' + l + '</b><span>' + esc(r.per[l].text) + '</span><span></span></div>').join('')
    ).join('') + '<div class="btns"><button class="p" data-copyall="' + esc(all) + '">⧉ Копировать все переводы</button></div></div>';
  } else if (r.fuzzy) {
    html += '<div class="res"><div class="match m-hint">🔎 Точно такого нет, но похоже на ' + esc(r.fuzzy.src) + ' (' + r.fuzzy.score + '%):\n«' + esc(r.fuzzy.ru) + '»</div></div>';
  } else {
    html += '<div class="res"><div class="match m-new">🆕 Такого текста не переводили — нужно заказывать.' + (r.hits.length ? '\nНиже — тексты с теми же словами, вдруг пригодятся.' : '') + '</div></div>';
  }
  if (r.hits.length) {
    html += '<div class="res"><h3>Где ещё встречается (' + r.hits.length + ')</h3>' + r.hits.map(h =>
      '<details><summary>' + esc(Array.from(h.ru).slice(0, 110).join('')) + ' <small>· ' + esc(h.src) + '</small></summary>' +
      Object.keys(h.tr).map(l => '<div class="tr" data-copy="' + esc(h.tr[l]) + '" title="Нажмите, чтобы скопировать"><b>' + l + '</b><span>' + esc(h.tr[l]) + '</span><span></span></div>').join('') +
      '</details>').join('') + '</div>';
  }
  $('sres').innerHTML = html;
}
$('sgo').onclick = search;
$('sq').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) search(); };
$('sres').addEventListener('click', e => {
  const t = e.target.closest('.tr[data-copy]');
  if (t) return copy(t.dataset.copy, t.querySelector('b').textContent + ' скопирован');
  const b = e.target.closest('[data-copyall]');
  if (b) copy(b.dataset.copyall, 'Все переводы скопированы');
});

/* ---------- статистика ---------- */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_F = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function periodRange(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  if (p === 'prev') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (p === '3m') return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))];
  if (p === 'all') return STATS && STATS.data_range ? STATS.data_range : [iso(new Date(y - 3, 0, 1)), iso(n)];
  return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
}

async function loadStats(force) {
  if (!STATS) {
    const { stats } = await chrome.storage.local.get({ stats: null });
    if (stats && stats._p === PERIOD) { STATS = stats; renderStats(); }
  }
  if (STATS && STATS._p === PERIOD && !force && Date.now() - (STATS._at || 0) < 5 * 60e3) return;
  if (!STATS || STATS._p !== PERIOD) $('stbody').innerHTML = '<div class="empty">Считаю статистику… первый раз до минуты</div>';
  try {
    const [from, to] = periodRange(PERIOD);
    const d = await API.post({ action: 'stats', from, to });
    d._at = Date.now(); d._p = PERIOD;
    STATS = d;
    await chrome.storage.local.set({ stats: STATS });
    renderStats();
  } catch (e) { $('stbody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

function bars(obj, opts) {
  opts = opts || {};
  let keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
  if (opts.top && keys.length > opts.top) {
    const rest = keys.slice(opts.top).reduce((s, k) => s + obj[k], 0);
    obj = Object.assign({}, obj, { 'Остальное': rest });
    keys = keys.slice(0, opts.top).concat('Остальное');
  }
  const max = Math.max(...keys.map(k => obj[k]), 1);
  return '<div class="bars' + (opts.orange ? ' orange' : '') + '">' + keys.map(k =>
    '<div class="br" data-tip="' + esc((opts.label ? opts.label(k) : k) + ': ' + obj[k]) + '"><span>' + esc(opts.label ? opts.label(k) : k) + '</span><div class="track"><div class="fill" style="width:' + (obj[k] / max * 100).toFixed(1) + '%"></div></div><span class="v">' + obj[k].toLocaleString('ru') + '</span></div>').join('') + '</div>';
}

function renderStats() {
  const S = STATS;
  const presets = [['month', 'Этот месяц'], ['prev', 'Прошлый'], ['3m', '3 месяца'], ['all', 'Всё время']];
  let h = '<div class="seg pseg">' + presets.map(p => '<button data-period="' + p[0] + '" class="' + (p[0] === PERIOD ? 'on' : '') + '">' + p[1] + '</button>').join('') + '</div>';
  if (!S || S.empty || !S.total) {
    $('stbody').innerHTML = h + '<div class="empty">За этот период запросов нет.</div>';
    return;
  }
  const keys = Object.keys(S.months);
  const max = Math.max(...keys.map(k => S.months[k].push + S.months[k].banner), 1);
  const lbl = (k, full) => { const [y, m, d] = k.split('-'); return d ? (full ? (+d) + '.' + m + '.' + y : String(+d)) : (full ? MONTHS_F[+m - 1] + ' ' + y : MONTHS[+m - 1]); };
  const every = keys.length > 20 ? 5 : keys.length > 12 ? 2 : 1;
  const saved = Math.round(S.rep_words * S.rate);
  h += '<div class="sub2">' + esc(S.range[0] + ' – ' + S.range[1]) + '</div>' +
    '<div class="kpis">' +
      '<div class="kpi"><b>' + S.total.toLocaleString('ru') + '</b><span>запросов (пуши ' + S.push + ', баннеры ' + S.banner + ')</span></div>' +
      '<div class="kpi"><b>' + S.all_words.toLocaleString('ru') + '</b><span>слов к переводу (слова × языки)</span></div>' +
      '<div class="kpi"><b>' + S.rep_count + '</b><span>заказали повторно — уже переводили' + (S.fuzzy_count ? ' · ещё ' + S.fuzzy_count + ' похожих' : '') + '</span></div>' +
      '<div class="kpi bad"><b>≈ ' + saved.toLocaleString('ru') + ' ₽</b><span>можно было не платить (' + S.rep_words + ' слов × ' + String(S.rate).replace('.', ',') + ' ₽)</span></div>' +
    '</div>' +
    '<div class="box"><h3>Запросы ' + (S.step === 'day' ? 'по дням' : 'по месяцам') + '</h3>' +
      '<div class="legend"><span><i style="background:var(--c-push)"></i>Пуши</span><span><i style="background:var(--c-banner)"></i>Баннеры</span></div>' +
      '<div class="cols">' + keys.map(k => {
        const x = S.months[k], hh = v => (v / max * 100).toFixed(1) + '%';
        return '<div class="col" data-tip="' + esc(lbl(k, true) + '\nПуши: ' + x.push + '\nБаннеры: ' + x.banner + '\nПовторов: ' + x.rep) + '">' +
          (x.push ? '<div class="pu" style="height:' + hh(x.push) + '"></div>' : '') + (x.banner ? '<div class="b" style="height:' + hh(x.banner) + '"></div>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="xl">' + keys.map((k, i) => '<span>' + (i % every === 0 ? lbl(k) : '') + '</span>').join('') + '</div></div>' +
    '<div class="box"><h3>Какие языки просят</h3><div class="sub">в скольких запросах есть язык</div>' + bars(S.lang, { label: l => l + ' · ' + (LANG_NAMES[l] || l) }) + '</div>' +
    '<div class="box"><h3>Для каких продуктов</h3>' + bars(S.prod, { top: 7 }) + '</div>' +
    (Object.keys(S.btype).length ? '<div class="box"><h3>Какие баннеры</h3>' + bars(S.btype, { top: 7, orange: true }) + '</div>' : '') +
    (S.top.length ? '<div class="box"><h3>Чаще всего заказывали заново</h3>' + S.top.slice(0, 6).map(t => '<div class="toprow"><b>' + t.times + '×</b><span>' + esc(t.ru) + '</span></div>').join('') + '</div>' : '') +
    '<div class="row"><button class="p" id="stFull">📊 Полный отчёт</button><span class="mute small">обновлено ' + esc(S.generated) + '</span></div>';
  $('stbody').innerHTML = h;
  $('stFull').onclick = async () => { const s = await API.settings(); chrome.tabs.create({ url: s.url + '?page=report&token=' + encodeURIComponent(s.token) }); };
}
$('stbody').addEventListener('click', e => {
  const b = e.target.closest('button[data-period]'); if (!b) return;
  PERIOD = b.dataset.period; loadStats(true);
});

// Подсказка при наведении на столбик / полоску.
document.addEventListener('mousemove', e => {
  const t = e.target.closest('[data-tip]'), tip = $('tip');
  if (!t) { tip.classList.remove('show'); return; }
  tip.textContent = t.dataset.tip;
  tip.classList.add('show');
  const w = tip.offsetWidth, x = Math.min(e.clientX + 12, window.innerWidth - w - 6);
  tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
});

/* ---------- загрузка файлов от подрядчика (.xliff, по одному или в zip) ---------- */

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
  const box = $('screp');
  box.textContent = 'Читаю файлы…';
  const files = [];
  try { for (const f of list) await collect(f.name, new Uint8Array(await f.arrayBuffer()), files); }
  catch (e) { box.textContent = 'Не получилось распаковать: ' + e.message; return; }
  UNITS = files.flatMap(parse);
  if (!UNITS.length) { box.textContent = 'В файлах не нашлось переводов.'; return; }
  box.textContent = 'Переводов: ' + UNITS.length + '. Ищу строки в таблице…';
  try { showReport(await API.post({ action: 'import', units: UNITS, apply: false })); }
  catch (e) { box.textContent = e.message; }
}

const RCLS = { 'вставлю': 'archive', 'вставлено': 'archive', 'уже есть': '', 'другой перевод': 'check', 'язык не заказывали': '', 'нет в таблице': 'over', 'язык не распознан': 'over' };
const ORDER = ['вставлено', 'вставлю', 'другой перевод', 'уже есть', 'язык не заказывали', 'нет в таблице', 'язык не распознан'];
function showReport(res) {
  const rep = (res.report || []).slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const ready = rep.filter(r => r.status === 'вставлю').length, done = rep.filter(r => r.status === 'вставлено').length;
  $('screp').innerHTML = '<b>' + (done ? '✅ Вставлено: ' + done + '. Незаказанные языки не трогала.' : 'Вставлю ' + ready + ' из ' + rep.length + '. Только в заказанные языки и пустые ячейки.') + '</b>' +
    rep.map(r => '<div class="r"><span>' + (r.row ? (r.sheet === 'баннер' ? 'Б ' : 'П ') + r.row : '—') + '</span><b>' + esc(r.lang) + '</b><span>' + esc(Array.from(r.src).slice(0, 70).join('')) +
      (r.over ? ' <span class="tag over">длиннее ' + esc(r.over) + '</span>' : '') + '</span><span class="tag ' + (RCLS[r.status] || '') + '">' + esc(r.status) + '</span></div>').join('') +
    (ready ? '<div class="btns"><button class="p" id="scApply">Вставить в таблицу</button><button id="scCancel">Отмена</button></div>' : '<div class="btns"><button id="scCancel">Закрыть</button></div>');
  const ap = $('scApply');
  if (ap) ap.onclick = async () => {
    ap.disabled = true;
    try { showReport(await API.post({ action: 'import', units: UNITS, apply: true })); load(); }
    catch (e) { toast(e.message); ap.disabled = false; }
  };
  $('scCancel').onclick = () => { $('screp').innerHTML = ''; UNITS = []; };
}

/* ---------- настройки ---------- */

async function openSettings() {
  const s = await API.settings();
  $('url').value = s.url; $('token').value = s.token; $('every').value = String(s.every);
  show('settings');
}
$('gear').onclick = openSettings;
$('back').onclick = () => show('req');
$('sheet').onclick = () => DATA ? chrome.tabs.create({ url: DATA.url }) : openSettings();
$('save').onclick = async () => {
  const url = $('url').value.trim(), token = $('token').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { $('smsg').textContent = 'Нужна ссылка вида https://script.google.com/macros/s/…/exec'; return; }
  await chrome.storage.sync.set({ url, token, every: Number($('every').value) });
  $('smsg').textContent = 'Проверяю…';
  try {
    const d = await API.list();
    $('smsg').textContent = '✅ Подключено! Ждут перевода: ' + d.counts.wait;
    await chrome.storage.local.set({ data: d, seen: d.items.map(i => i.id + ':' + i.ru.slice(0, 40)) });
    DATA = d;
    setTimeout(() => { show('req'); render(); }, 900);
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

// Панель открыта долго — обновляемся сами, когда фон заметил изменения.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.data && ch.data.newValue && JSON.stringify(ch.data.newValue.items) !== JSON.stringify(DATA && DATA.items)) { DATA = ch.data.newValue; render(); }
});

load(true);
