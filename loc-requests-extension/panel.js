const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (!chrome.sidePanel) document.documentElement.classList.add('popup');   // браузер без боковой панели — обычное окошко

const LANG_NAMES = { KK: 'казахский', KY: 'кыргызский', UZ: 'узбекский', HY: 'армянский', TG: 'таджикский', KA: 'грузинский', AZ: 'азербайджанский', EN: 'английский' };
// Вкладки запросов: статус → цвет (как в таблице) и что делать дальше.
const TABS = [
  { st: 'Новый', name: 'Новые', cls: 'st-new', hint: 'Новые запросы. Нет в архиве — отдайте подрядчику.' },
  { st: 'Из архива', name: 'Из архива', cls: 'st-arc', hint: 'Перевод подставлен из архива — можно сразу отдавать заказчику.' },
  { st: 'Проверить', name: 'Проверить', cls: 'st-chk', hint: 'Подставлено из архива, но отличаются цифры или знаки — проверьте и отдайте.' },
  { st: 'У подрядчика', name: 'У подрядчика', cls: 'st-ven', hint: 'Ждём переводы. Загрузите zip из Smartcat во вкладке «📥 Smartcat».' },
  { st: 'Готово', name: 'Готово', cls: 'st-done', hint: 'Переводы на месте — отдайте заказчику.' },
];
const ST_CLS = Object.fromEntries(TABS.map(t => [t.st, t.cls]));
let DATA = null, TAB = 0, KIND = '', Q = '', UNITS = [], STATS = null, SECTION = 'req';

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
  const count = st => items.filter(x => x.status === st).length;
  $('navNew').textContent = count('Новый') || '';
  $('tiles').innerHTML = TABS.map((t, i) => '<button class="tile ' + t.cls + (i === TAB ? ' on' : '') + '" data-i="' + i + '"><b>' + count(t.st) + '</b><span>' + t.name + '</span></button>').join('');
  $('tabHint').textContent = TABS[TAB].hint;
  const q = Q.toLowerCase();
  const list = items.filter(x => x.status === TABS[TAB].st && (!KIND || x.type === KIND) &&
    (!q || [x.id, x.ru, x.product, x.btype].join(' ').toLowerCase().indexOf(q) !== -1));
  // Массовые действия для текущей вкладки.
  const st = TABS[TAB].st;
  const bulk = st === 'Новый' ? ['match', '♻️ Проверить все ' + list.length + ' по архиву']
    : (st === 'Из архива' || st === 'Готово') ? ['sent', '📨 Отметить все ' + list.length + ' как «Отдан»'] : null;
  $('bulk').innerHTML = bulk && list.length > 1 ? '<button data-bulk="' + bulk[0] + '">' + bulk[1] + '</button>' : '';
  $('list').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">Здесь пусто 🌴</div>';
  $('list').dataset.ids = list.map(x => x.id).join(',');
}

function deadline(x) {
  if (!x.deadline) return '';
  const open = ['Новый', 'Проверить', 'У подрядчика'].indexOf(x.status) !== -1;
  let cls = '', word = '';
  if (open && x.dl) {
    const h = (x.dl - Date.now()) / 36e5;
    if (h < 0) { cls = 'late'; word = ' · просрочен'; } else if (h < 24) { cls = 'soon'; word = ' · скоро'; }
  }
  return '<span class="dl ' + cls + '">⏰ ' + esc(x.deadline) + word + '</span>';
}

function card(x) {
  const kind = x.type === 'Баннер' ? 'banner' : 'push';
  const label = x.type === 'Баннер' && x.btype ? 'Баннер · ' + x.btype : (x.type || 'Запрос');
  const meta = [x.product, x.langs.length ? x.langs.join(', ') : '', x.limit ? 'до ' + x.limit + ' симв.' : ''].filter(Boolean).map(esc).join(' · ');
  let match = '';
  if (/^♻️/.test(x.match)) match = '<div class="match ' + (x.status === 'Проверить' ? 'm-check' : 'm-arc') + '">' + esc(x.match) + '</div>';
  else if (/^🔎/.test(x.match)) match = '<div class="match m-hint">' + esc(x.match) + '</div>';
  else if (x.match) match = '<div class="match m-new">🆕 ' + esc(x.match) + ' — в архиве нет</div>';
  const want = x.langs.length ? x.langs : Object.keys(x.tr);
  const tags = { archive: 'из архива', check: 'проверить', over: 'длиннее лимита' };
  const trs = want.filter(l => x.tr[l]).map(l => '<div class="tr" data-copy="' + esc(x.tr[l].text) + '" title="Нажмите, чтобы скопировать"><b>' + l + '</b><span>' + esc(x.tr[l].text) + '</span>' +
    (x.tr[l].mark ? '<span class="tag ' + x.tr[l].mark + '">' + tags[x.tr[l].mark] + '</span>' : '<span></span>') + '</div>').join('');
  const miss = want.filter(l => !x.tr[l]);
  const btn = (act, text, cls) => '<button data-act="' + act + '" data-id="' + esc(x.id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</button>';
  const btns = [];
  if (x.status === 'Новый') btns.push(btn('vendor', '📤 Отдать подрядчику', 'p'), btn('match', '♻️ Проверить по архиву'));
  if (['Из архива', 'Проверить', 'Готово'].indexOf(x.status) !== -1) btns.push(btn('sent', '📨 Отдан заказчику', 'p'), btn('copy', '⧉ Копировать все'));
  if (x.status === 'У подрядчика') btns.push(btn('done', '✅ Перевод готов', 'p'));
  btns.push(btn('open', '↗ Строка'));
  if (x.link) btns.push('<button data-act="link" data-url="' + esc(x.link) + '">💬 Тред</button>');
  return '<div class="card ' + (ST_CLS[x.status] || '') + '"><div class="top"><span class="chip ' + kind + '">' + esc(label) + '</span><span class="id">' + esc(x.id) + '</span>' +
    (x.date ? '<span>от ' + esc(x.date) + '</span>' : '') + deadline(x) + '</div>' +
    (meta ? '<div class="meta">' + meta + '</div>' : '') +
    '<div class="ru">' + esc(x.ru) + '</div>' + match + trs +
    (miss.length && x.status !== 'Новый' ? '<div class="miss">нет перевода: ' + miss.join(', ') + '</div>' : '') +
    '<div class="btns">' + btns.join('') + '</div></div>';
}

$('tiles').onclick = e => { const b = e.target.closest('.tile'); if (b) { TAB = Number(b.dataset.i); render(); $('list').scrollTop = 0; } };
$('kind').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  KIND = b.dataset.k; document.querySelectorAll('#kind button').forEach(x => x.classList.toggle('on', x === b)); render();
};
$('q').oninput = e => { Q = e.target.value.trim(); render(); };

const ACT_STATUS = { vendor: 'У подрядчика', sent: 'Отдан', done: 'Готово' };
async function act(body, okMsg, b) {
  if (b) b.disabled = true;
  try {
    DATA = await API.post(body);
    await chrome.storage.local.set({ data: DATA });
    render();
    toast(okMsg);
    chrome.runtime.sendMessage('poll');
  } catch (err) { toast(err.message); if (b) b.disabled = false; }
}

$('bulk').onclick = e => {
  const b = e.target.closest('button[data-bulk]'); if (!b) return;
  const ids = ($('list').dataset.ids || '').split(',').filter(Boolean);
  if (b.dataset.bulk === 'sent') {
    if (!confirm('Отметить ' + ids.length + ' запросов как «Отдан»? Они уйдут в архив.')) return;
    act({ action: 'status', ids, status: 'Отдан' }, 'Отдано: ' + ids.length, b);
  } else act({ action: 'match', ids }, 'Проверила по архиву: ' + ids.length, b);
};

$('list').addEventListener('click', async e => {
  const t = e.target.closest('.tr[data-copy]');
  if (t) return copy(t.dataset.copy, t.querySelector('b').textContent + ' скопирован');
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const a = b.dataset.act, x = DATA.items.find(i => i.id === b.dataset.id);
  if (a === 'open') return chrome.tabs.create({ url: x.url || DATA.url });
  if (a === 'link') return chrome.tabs.create({ url: b.dataset.url });
  if (a === 'copy') {
    const want = x.langs.length ? x.langs : Object.keys(x.tr);
    return copy(want.filter(l => x.tr[l]).map(l => l + ':\n' + x.tr[l].text).join('\n\n'), 'Переводы скопированы — вставьте в тред');
  }
  if (a === 'match') return act({ action: 'match', id: x.id }, 'Проверила по архиву', b);
  act({ action: 'status', id: x.id, status: ACT_STATUS[a] }, x.id + ' → ' + ACT_STATUS[a], b);
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

async function loadStats(force) {
  if (!STATS) {
    const { stats } = await chrome.storage.local.get({ stats: null });
    if (stats) { STATS = stats; renderStats(); }
  }
  if (STATS && !force && Date.now() - (STATS._at || 0) < 5 * 60e3) return;
  try {
    STATS = await API.get('stats');
    STATS._at = Date.now();
    await chrome.storage.local.set({ stats: STATS });
    renderStats();
  } catch (e) { if (!STATS) $('stbody').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const monthName = (m, full) => { const [y, mm] = m.split('-'); return MONTHS[Number(mm) - 1] + (full ? ' ' + y : ''); };

function bars(obj, opts) {
  opts = opts || {};
  let keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
  if (opts.top && keys.length > opts.top) {   // хвост — в «Остальное», чтобы список не разрастался
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
  if (!S.total) { $('stbody').innerHTML = '<div class="empty">Пока нет запросов.</div>'; return; }
  const months = Object.keys(S.months).filter(m => m !== '—').sort().slice(-12);
  const cur = S.months[S.thisMonth] || { push: 0, banner: 0, arc: 0 };
  const max = Math.max(...months.map(m => S.months[m].push + S.months[m].banner), 1);
  const open = (S.statuses['Новый'] || 0) + (S.statuses['Проверить'] || 0) + (S.statuses['У подрядчика'] || 0);
  $('stbody').innerHTML =
    '<div class="kpis">' +
      '<div class="kpi"><b>' + (cur.push + cur.banner) + '</b><span>запросов в ' + MONTHS_IN[Number(S.thisMonth.split('-')[1]) - 1] + ' (пуши ' + cur.push + ', баннеры ' + cur.banner + ')</span></div>' +
      '<div class="kpi"><b>' + open + '</b><span>в работе сейчас: новые, проверить, у подрядчика</span></div>' +
      '<div class="kpi"><b>' + cur.arc + '</b><span>в этом месяце взято из архива — не пришлось заказывать (всего ' + S.fromArc + ')</span></div>' +
      '<div class="kpi' + (S.overdue ? ' bad' : '') + '"><b>' + S.overdue + '</b><span>просрочено по дедлайну</span></div>' +
    '</div>' +
    '<div class="box"><h3>Запросы по месяцам</h3><div class="sub">последние ' + months.length + ' мес. · всего ' + S.total.toLocaleString('ru') + '</div>' +
      '<div class="legend"><span><i style="background:var(--c-push)"></i>Пуши</span><span><i style="background:var(--c-banner)"></i>Баннеры</span></div>' +
      '<div class="cols">' + months.map(m => {
        const x = S.months[m], h = v => (v / max * 100).toFixed(1) + '%';
        return '<div class="col" data-tip="' + esc(monthName(m, true) + '\nПуши: ' + x.push + '\nБаннеры: ' + x.banner + '\nИз архива: ' + x.arc) + '">' +
          (x.push ? '<div class="pu" style="height:' + h(x.push) + '"></div>' : '') + (x.banner ? '<div class="b" style="height:' + h(x.banner) + '"></div>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="xl">' + months.map(m => '<span>' + monthName(m) + '</span>').join('') + '</div></div>' +
    '<div class="box"><h3>Какие языки просят</h3><div class="sub">в скольких запросах есть язык</div>' + bars(S.langs, { label: l => l + ' · ' + (LANG_NAMES[l] || l) }) + '</div>' +
    '<div class="box"><h3>Для каких продуктов</h3><div class="sub">запросов на продукт</div>' + bars(S.products, { top: 7 }) + '</div>' +
    (Object.keys(S.btypes).length ? '<div class="box"><h3>Какие баннеры</h3><div class="sub">запросов по типу баннера</div>' + bars(S.btypes, { top: 7, orange: true }) + '</div>' : '') +
    '<div class="row"><button id="stOpen">↗ Лист «📊 Статистика» в таблице</button><span class="mute small">обновлено ' + esc(S.updated) + '</span></div>';
  $('stOpen').onclick = () => DATA && chrome.tabs.create({ url: DATA.url });
}

// Подсказка при наведении на столбик / полоску.
document.addEventListener('mousemove', e => {
  const t = e.target.closest('[data-tip]'), tip = $('tip');
  if (!t) { tip.classList.remove('show'); return; }
  tip.textContent = t.dataset.tip;
  tip.classList.add('show');
  const w = tip.offsetWidth, x = Math.min(e.clientX + 12, window.innerWidth - w - 6);
  tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
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
  const box = $('screp');
  box.textContent = 'Читаю файлы…';
  const files = [];
  try { for (const f of list) await collect(f.name, new Uint8Array(await f.arrayBuffer()), files); }
  catch (e) { box.textContent = 'Не получилось распаковать: ' + e.message; return; }
  UNITS = files.flatMap(parse);
  if (!UNITS.length) { box.textContent = 'В файлах не нашлось переводов.'; return; }
  box.textContent = 'Переводов: ' + UNITS.length + '. Ищу строки в таблице…';
  try { showReport(await API.post({ action: 'smartcat', units: UNITS, apply: false })); }
  catch (e) { box.textContent = e.message; }
}

const RCLS = { 'встанет': 'archive', 'вставлено': 'archive', 'уже стоит': '', 'уже есть другой перевод': 'check', 'строка не найдена': 'over', 'язык не найден': 'over' };
const ORDER = ['вставлено', 'встанет', 'уже есть другой перевод', 'уже стоит', 'строка не найдена', 'язык не найден'];
function showReport(res) {
  const rep = (res.report || []).slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const ready = rep.filter(r => r.status === 'встанет').length, done = rep.filter(r => r.status === 'вставлено').length;
  $('screp').innerHTML = '<b>' + (done ? '✅ Вставлено: ' + done + '. Где переведены все языки — статус «Готово».' : 'Встанет: ' + ready + ' из ' + rep.length + '. Уже заполненные ячейки не трогаю.') + '</b>' +
    rep.map(r => '<div class="r"><span>' + esc(r.id || '—') + '</span><b>' + esc(r.lang) + '</b><span>' + esc(Array.from(r.src).slice(0, 70).join('')) +
      (r.over ? ' <span class="tag over">длиннее ' + esc(r.over) + '</span>' : '') + '</span><span class="tag ' + (RCLS[r.status] || '') + '">' + esc(r.status) + '</span></div>').join('') +
    (ready ? '<div class="btns"><button class="p" id="scApply">Вставить в таблицу</button><button id="scCancel">Отмена</button></div>' : '<div class="btns"><button id="scCancel">Закрыть</button></div>');
  const ap = $('scApply');
  if (ap) ap.onclick = async () => {
    ap.disabled = true;
    try { showReport(await API.post({ action: 'smartcat', units: UNITS, apply: true })); load(); }
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
    $('smsg').textContent = '✅ Подключено! Запросов в работе: ' + d.items.length;
    await chrome.storage.local.set({ data: d, seen: d.items.map(i => i.id) });
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
