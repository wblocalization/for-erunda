/* ============================================================================
 * Переводы маркетинга: запросы на перевод пушей и баннеров.
 * Пуши — на «📥 Пуши», баннеры — на «🖼 Баннеры». Новый запрос пишут в первую пустую строку внизу.
 * Скрипт:
 *  - ставит ID, дату и статус;
 *  - ищет текст в архиве и подставляет готовые переводы
 *    (тот же текст / другой эмодзи — зелёным, другие цифры или знаки — жёлтым);
 *  - подсвечивает переводы длиннее лимита;
 *  - загружает переводы из Smartcat (zip / xliff) в нужные строки;
 *  - строит статистику;
 *  - отдаёт данные расширению (doGet / doPost с ключом).
 * Всё работает и без расширения — через меню «🌍 Переводы».
 * ========================================================================== */

const CFG = {
  REQS: [
    { name: '📥 Пуши', type: 'Пуш', prefix: 'P' },
    { name: '🖼 Баннеры', type: 'Баннер', prefix: 'B' },
  ],
  ARC: '📚 Архив переводов',
  STATS: '📊 Статистика',
  LANGS: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN'],
  ALL: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA'],            // что значит «все»
  LANG_WORDS: {
    KK: ['казах', 'kk'], KY: ['кыргыз', 'киргиз', 'ky'], UZ: ['узбек', 'uz'], HY: ['армян', 'hy'],
    TG: ['таджик', 'tg'], KA: ['грузин', 'ka'], AZ: ['азербайджан', 'az'], EN: ['англ', 'en'],
  },
  ST: { NEW: 'Новый', ARCHIVE: 'Из архива', CHECK: 'Проверить', VENDOR: 'У подрядчика', DONE: 'Готово', SENT: 'Отдан', CANCEL: 'Отменён' },
  // Как статус выглядит в таблице (с иконкой). Скрипт понимает и старые значения без иконок.
  ST_LABEL: { 'Новый': '🆕 Новый', 'Из архива': '♻️ Из архива', 'Проверить': '⚠️ Проверить', 'У подрядчика': '📤 У подрядчика',
    'Готово': '✅ Готово', 'Отдан': '📨 Отдан', 'Отменён': '✖️ Отменён' },
  GREEN: '#e2f6ec',   // перевод из архива, можно брать
  YELLOW: '#fff4dc',  // из архива, но проверить (цифры, знаки)
  RED: '#ffd6e0',     // длиннее лимита
  FUZZY: 0.9,         // «почти такой же» — только подсказка, без подстановки
  TOKEN_PROP: 'EXT_TOKEN',
};

/* ---------- меню ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🌍 Переводы')
    .addItem('♻️ Проверить по архиву: выделенные строки', 'matchSelected')
    .addItem('♻️ Проверить по архиву: все новые', 'matchAllNew')
    .addItem('📥 Загрузить переводы из Smartcat…', 'showSmartcatDialog')
    .addSeparator()
    .addItem('📤 Выделенные → «У подрядчика»', 'markVendor')
    .addItem('📨 Выделенные → «Отдан»', 'markSent')
    .addItem('📚 Пополнить архив готовыми', 'archiveDone')
    .addItem('📊 Обновить статистику', 'buildStats')
    .addSeparator()
    .addItem('📖 Что значат цвета и статусы', 'showLegend')
    .addItem('🔑 Ключ для расширения', 'showToken')
    .addItem('⚙️ Настроить таблицу (владелец)', 'setup')
    .addToUi();
}

/* ---------- общие помощники ---------- */

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '».');
  return sh;
}

function reqDef_(name) { return CFG.REQS.filter(function (d) { return d.name === name; })[0] || null; }

// Вкладки с запросами, которые есть в таблице: [{def, sh}].
function reqSheets_() {
  const ss = SpreadsheetApp.getActive();
  return CFG.REQS.map(function (d) { return { def: d, sh: ss.getSheetByName(d.name) }; }).filter(function (x) { return x.sh; });
}

// Названия колонок: первая строка заголовка без иконки («✍️ Текст RU\nподсказка» → «Текст RU»).
function head_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) {
    return String(h).split('\n')[0].replace(/^[^\p{L}\p{N}]+/u, '').trim();
  });
}

// «✅ Готово» → «Готово» и обратно.
function stPlain_(v) { return String(v || '').replace(/^[^\p{L}]+/u, '').trim(); }
function stLabel_(st) { return CFG.ST_LABEL[st] || st; }

// Индексы колонок вкладки запросов по названиям (0-based).
function reqCols_(head, name) {
  const c = function (h) { return head.indexOf(h); };
  const out = {
    id: c('ID'), date: c('Дата'), btype: c('Тип баннера'), product: c('Продукт'), langs: c('Языки'),
    limit: c('Лимит'), deadline: c('Дедлайн'), link: c('Ссылка (тред / Figma)'), ctx: c('Контекст'),
    ru: c('Текст RU'), status: c('Статус'), match: c('Уже переводили?'), lang: {},
  };
  CFG.LANGS.forEach(function (l) { out.lang[l] = c(l); });
  ['id', 'ru', 'status', 'match'].forEach(function (k) {
    if (out[k] === -1) throw new Error('На «' + (name || '?') + '» нет колонки «' + { id: 'ID', ru: 'Текст RU', status: 'Статус', match: 'Уже переводили?' }[k] + '».');
  });
  return out;
}

function selectedRows_(sh) {
  const rows = [];
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = Math.max(2, r.getRow()); i <= r.getLastRow(); i++) if (rows.indexOf(i) === -1) rows.push(i);
  });
  return rows;
}

function activeReq_() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!reqDef_(sh.getName())) {
    SpreadsheetApp.getUi().alert('Откройте вкладку «' + CFG.REQS.map(function (d) { return d.name; }).join('» или «') + '» и выделите строки.');
    return null;
  }
  return sh;
}

function parseLangs_(v) {
  const t = String(v || '').toLowerCase();
  if (!t.trim()) return [];
  if (/(^|[^а-яё])вс[еёи]([^а-яё]|$)/.test(t)) return CFG.ALL.slice();
  return CFG.LANGS.filter(function (l) {
    return CFG.LANG_WORDS[l].some(function (w) {
      return w.length > 2 ? t.indexOf(w) !== -1 : new RegExp('(^|[^a-z])' + w + '([^a-z]|$)').test(t);
    });
  });
}

function limitOf_(v) {
  const m = String(v || '').match(/\d+/);
  return m ? Number(m[0]) : 0;
}


/* ---------- нормализация текста для поиска совпадений ---------- */

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

function kSpace_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function kEmoji_(s) { return kSpace_(String(s || '').replace(EMOJI_RE, ' ')).replace(/[^\p{L}\p{N}%]+/gu, ' ').trim(); }
function kNum_(s) { return kEmoji_(s).replace(/\d+/g, '#'); }
function emojis_(s) { return String(s || '').match(/(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}][\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]*)+/gu) || []; }
function numbers_(s) { return String(s || '').match(/\d+(?:[ .,]\d+)*/g) || []; }

function ratio_(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    }
    const t = prev; prev = cur; cur = t;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// Переносит эмодзи нового текста в старый перевод: старые эмодзи по порядку меняются на новые.
function swapEmoji_(oldSrc, newSrc, tr) {
  const a = emojis_(oldSrc), b = emojis_(newSrc);
  let out = String(tr);
  if (a.join('') === b.join('')) return out;
  if (a.length && a.length === b.length) {
    a.forEach(function (e, i) { out = out.replace(e, '\u0000' + i + '\u0000'); });
    b.forEach(function (e, i) { out = out.replace('\u0000' + i + '\u0000', e); });
    return out;
  }
  // Количество разное: убираем старые и ставим новые туда же, где они в новом тексте (начало / конец).
  a.forEach(function (e) { out = out.replace(e, ''); });
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
  const lead = String(newSrc).trim().match(/^((?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}][\u{FE0F}\u{200D}]*\s*)+)/u);
  const tail = String(newSrc).trim().match(/((?:\s*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}][\u{FE0F}\u{200D}]*)+)$/u);
  if (lead) out = lead[1] + out;
  if (tail && (!lead || tail[1].trim() !== lead[1].trim())) out = out + tail[1];
  return out;
}

// Меняет в переводе числа старого исходника на числа нового (по порядку).
function swapNumbers_(oldSrc, newSrc, tr) {
  const a = numbers_(oldSrc), b = numbers_(newSrc);
  if (a.length !== b.length) return null;
  let out = String(tr);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (out.indexOf(a[i]) === -1) return null;
    out = out.replace(a[i], '\u0000' + i + '\u0000');
  }
  for (let i = 0; i < b.length; i++) out = out.replace('\u0000' + i + '\u0000', b[i]);
  return out;
}


/* ---------- архив: всё, что уже переводили ---------- */

// Записи: { src: 'P-0123' | 'архив: <файл>', ru, tr: {KK: ...} }.
function loadArchive_(skip) {
  const list = [];
  reqSheets_().forEach(function (x) {
    const sh = x.sh;
    if (sh.getLastRow() < 2) return;
    const head = head_(sh), C = reqCols_(head, x.def.name);
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getDisplayValues();
    vals.forEach(function (r, i) {
      if (skip && skip.sheet === x.def.name && skip.row === i + 2) return;
      const st = stPlain_(r[C.status]);
      if (st !== CFG.ST.DONE && st !== CFG.ST.SENT && st !== CFG.ST.ARCHIVE) return;
      const tr = {};
      CFG.LANGS.forEach(function (l) { if (C.lang[l] !== -1 && String(r[C.lang[l]]).trim()) tr[l] = r[C.lang[l]]; });
      if (Object.keys(tr).length && String(r[C.ru]).trim()) list.push({ src: r[C.id], ru: r[C.ru], tr: tr });
    });
  });
  const arc = SpreadsheetApp.getActive().getSheetByName(CFG.ARC);
  if (arc && arc.getLastRow() >= 2) {
    const head = head_(arc);
    const ru = head.indexOf('Текст RU'), srcCol = head.indexOf('Источник');
    arc.getRange(2, 1, arc.getLastRow() - 1, head.length).getDisplayValues().forEach(function (r) {
      if (!String(r[ru]).trim()) return;
      const tr = {};
      CFG.LANGS.forEach(function (l) { const c = head.indexOf(l); if (c !== -1 && String(r[c]).trim()) tr[l] = r[c]; });
      if (Object.keys(tr).length) list.push({ src: 'архив' + (srcCol !== -1 && r[srcCol] ? ': ' + String(r[srcCol]).slice(0, 40) : ''), ru: r[ru], tr: tr });
    });
  }
  list.forEach(function (x) { x.k1 = kSpace_(x.ru); x.k2 = kEmoji_(x.ru); x.k3 = kNum_(x.ru); });
  return list;
}

/*
 * Ищет текст в архиве. Для каждого нужного языка — лучший вариант:
 *   exact  — тот же текст;
 *   emoji  — отличаются только эмодзи (эмодзи в переводе заменяются);
 *   punct  — отличаются знаки препинания (проверить);
 *   num    — отличаются только цифры (цифры заменяются, проверить);
 *   fuzzy  — похоже на ≥ 90% (только подсказка).
 */
function findInArchive_(ru, langs, arc) {
  const k1 = kSpace_(ru), k2 = kEmoji_(ru), k3 = kNum_(ru);
  const rank = { exact: 0, emoji: 1, punct: 2, num: 3, fuzzy: 4 };
  const per = {};
  let fuzzy = null;
  arc.forEach(function (x) {
    let level = null;
    if (x.k1 === k1) level = 'exact';
    else if (x.k2 === k2) level = emojis_(x.ru).join('') !== emojis_(ru).join('') && kSpace_(String(x.ru).replace(EMOJI_RE, '')) === kSpace_(String(ru).replace(EMOJI_RE, '')) ? 'emoji' : 'punct';
    else if (x.k3 === k3) level = 'num';
    if (!level) {
      if (!fuzzy && Math.abs(x.k2.length - k2.length) <= 0.1 * Math.max(k2.length, 1) && k2.length > 8) {
        const r = ratio_(x.k2, k2);
        if (r >= CFG.FUZZY) fuzzy = { src: x.src, ru: x.ru, score: Math.round(r * 100) };
      }
      return;
    }
    langs.forEach(function (l) {
      if (!x.tr[l]) return;
      if (per[l] && rank[per[l].level] <= rank[level]) return;
      let text = x.tr[l];
      if (level === 'emoji' || level === 'punct') text = swapEmoji_(x.ru, ru, text);
      if (level === 'num') {
        const swapped = swapNumbers_(x.ru, ru, swapEmoji_(x.ru, ru, text));
        if (swapped === null) return;
        text = swapped;
      }
      per[l] = { level: level, text: text, src: x.src, ru: x.ru };
    });
  });
  return { per: per, fuzzy: fuzzy };
}

const LEVEL_WORDS = { exact: 'тот же текст', emoji: 'отличается только эмодзи', punct: 'отличаются знаки — проверь', num: 'отличаются цифры — проверь число' };


/* ---------- проверка строк ---------- */

function matchSelected() {
  const sh = activeReq_();
  if (!sh) return;
  const res = matchRows_(sh, selectedRows_(sh), true);
  SpreadsheetApp.getActive().toast(summary_(res), 'Проверка по архиву', 8);
}

function matchAllNew() {
  const res = { rows: 0, filled: 0, check: 0, fuzzy: 0 };
  reqSheets_().forEach(function (x) {
    const sh = x.sh;
    if (sh.getLastRow() < 2) return;
    const C = reqCols_(head_(sh), x.def.name);
    const st = sh.getRange(2, C.status + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    const rows = [];
    st.forEach(function (v, i) { if (!v[0] || stPlain_(v[0]) === CFG.ST.NEW) rows.push(i + 2); });
    const r = matchRows_(sh, rows, true);
    Object.keys(res).forEach(function (k) { res[k] += r[k]; });
  });
  SpreadsheetApp.getActive().toast(summary_(res), 'Проверка по архиву', 8);
}

function summary_(res) {
  return 'Проверено строк: ' + res.rows + '. Подставлено переводов: ' + res.filled + ' (на проверку: ' + res.check + '). Похожих подсказок: ' + res.fuzzy + '.';
}

// Проверяет строки: ID/дата/статус, поиск в архиве, лимиты. Пустые переводы заполняет, заполненные не трогает.
function matchRows_(sh, rowNums, force) {
  const def = reqDef_(sh.getName());
  const head = head_(sh), C = reqCols_(head, def.name);
  const res = { rows: 0, filled: 0, check: 0, fuzzy: 0 };
  if (!rowNums.length) return res;
  const arc = loadArchive_(rowNums.length === 1 ? { sheet: def.name, row: rowNums[0] } : null);
  const ids = existingIds_(sh, C);
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  rowNums.forEach(function (rn) {
    const rng = sh.getRange(rn, 1, 1, head.length);
    const v = rng.getValues()[0], bg = rng.getBackgrounds()[0], notes = rng.getNotes()[0];
    const ru = String(v[C.ru] || '').trim();
    if (!ru) return;
    res.rows++;
    let changed = false;
    if (!String(v[C.id]).trim()) {
      ids[def.prefix] = (ids[def.prefix] || 0) + 1;
      v[C.id] = def.prefix + '-' + ('000' + ids[def.prefix]).slice(-4);
      changed = true;
    }
    if (C.date !== -1 && !v[C.date]) { v[C.date] = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00'); changed = true; }
    if (!String(v[C.status]).trim()) { v[C.status] = stLabel_(CFG.ST.NEW); changed = true; }

    const langs = parseLangs_(C.langs !== -1 ? v[C.langs] : '');
    const want = langs.length ? langs : CFG.ALL;
    const st = stPlain_(v[C.status]);
    if (force || st === CFG.ST.NEW) {
      const found = findInArchive_(ru, want, arc);
      const filled = [], check = [], missing = [];
      let first = null;
      want.forEach(function (l) {
        const c = C.lang[l];
        if (c === -1) return;
        const p = found.per[l];
        if (String(v[c]).trim()) return;           // уже есть перевод — не трогаем
        if (!p) { missing.push(l); return; }
        v[c] = p.text;
        const warn = p.level === 'num' || p.level === 'punct';
        bg[c] = warn ? CFG.YELLOW : CFG.GREEN;
        notes[c] = 'Из архива (' + p.src + '): ' + LEVEL_WORDS[p.level] + '\nИсходник там: ' + p.ru;
        (warn ? check : filled).push(l);
        if (!first || (warn && first.level !== 'num')) first = p;
        changed = true;
      });
      res.filled += filled.length + check.length;
      res.check += check.length;
      let text = '';
      if (first) {
        text = '♻️ ' + first.src + ' · ' + LEVEL_WORDS[first.level] + '\nподставлено: ' + filled.concat(check).join(', ');
        if (check.length) text += '\nпроверить: ' + check.join(', ');
        if (missing.length) text += '\nнет в архиве: ' + missing.join(', ');
      } else if (found.fuzzy) {
        text = '🔎 похоже на ' + found.fuzzy.src + ' (' + found.fuzzy.score + '%): «' + String(found.fuzzy.ru).slice(0, 80) + '»';
        res.fuzzy++;
      } else {
        text = 'новый текст';
      }
      if (text !== v[C.match]) { v[C.match] = text; changed = true; }
      if (first && !missing.length && st === CFG.ST.NEW) { v[C.status] = stLabel_(check.length ? CFG.ST.CHECK : CFG.ST.ARCHIVE); changed = true; }
    }
    if (checkLimits_(v, bg, C)) changed = true;
    if (changed) {
      rng.setValues([v]);
      rng.setBackgrounds([bg]);
      rng.setNotes([notes]);
    }
  });
  return res;
}

// Переводы длиннее лимита — красным; вернувшиеся в лимит — без заливки.
function checkLimits_(v, bg, C) {
  const lim = C.limit !== -1 ? limitOf_(v[C.limit]) : 0;
  let changed = false;
  CFG.LANGS.forEach(function (l) {
    const c = C.lang[l];
    if (c === -1) return;
    const over = lim && String(v[c]).length > lim;
    if (over && bg[c] !== CFG.RED) { bg[c] = CFG.RED; changed = true; }
    if (!over && bg[c] === CFG.RED) { bg[c] = '#ffffff'; changed = true; }
  });
  return changed;
}

function existingIds_(sh, C) {
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, C.id + 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
    const m = String(r[0]).match(/^([A-Z])-(\d+)$/);
    if (m) out[m[1]] = Math.max(out[m[1]] || 0, Number(m[2]));
  });
  return out;
}


/* ---------- правки на листе (триггер ставит «Настроить таблицу») ---------- */

function onRequestEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const def = reqDef_(sh.getName());
  if (!def || e.range.getLastRow() < 2) return;
  const head = head_(sh), C = reqCols_(head, def.name);
  const first = e.range.getColumn() - 1, last = e.range.getLastColumn() - 1;
  const touches = function (c) { return c !== -1 && c >= first && c <= last; };
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    const rows = [];
    for (let r = Math.max(2, e.range.getRow()); r <= e.range.getLastRow(); r++) rows.push(r);
    if (touches(C.ru) || touches(C.langs)) {
      matchRows_(sh, rows, false);
    } else if (touches(C.status) && /^(Готово|Отдан)$/.test(stPlain_(e.value))) {
      archiveRows_(sh, rows);
    } else {
      // Поправили перевод или лимит — перепроверяем длину.
      rows.forEach(function (rn) {
        const rng = sh.getRange(rn, 1, 1, head.length);
        const v = rng.getValues()[0], bg = rng.getBackgrounds()[0];
        if (checkLimits_(v, bg, C)) rng.setBackgrounds([bg]);
      });
    }
  } finally {
    lock.releaseLock();
  }
}

/* ---------- статусы ---------- */

function markVendor() { setStatusSelected_(CFG.ST.VENDOR); }
function markSent() { setStatusSelected_(CFG.ST.SENT); }

function setStatusSelected_(status) {
  const sh = activeReq_();
  if (!sh) return;
  const C = reqCols_(head_(sh), sh.getName());
  const rows = selectedRows_(sh).filter(function (i) { return String(sh.getRange(i, C.ru + 1).getValue()).trim(); });
  rows.forEach(function (i) { sh.getRange(i, C.status + 1).setValue(stLabel_(status)); });
  if (status === CFG.ST.SENT) archiveRows_(sh, rows);
  SpreadsheetApp.getActive().toast('Статус «' + status + '»: ' + rows.length + ' строк.', 'Переводы', 5);
}

/* ---------- архив ---------- */

// Готовые и отданные запросы, которых ещё нет в архиве, дописываются в «📚 Архив переводов».
function archiveDone() {
  let n = 0;
  reqSheets_().forEach(function (x) {
    const sh = x.sh;
    if (sh.getLastRow() < 2) return;
    const C = reqCols_(head_(sh), x.def.name);
    const st = sh.getRange(2, C.status + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    const rows = [];
    st.forEach(function (v, i) { const p = stPlain_(v[0]); if (p === CFG.ST.DONE || p === CFG.ST.SENT) rows.push(i + 2); });
    n += archiveRows_(sh, rows);
  });
  try { SpreadsheetApp.getActive().toast('В архив добавлено: ' + n + '.', 'Архив', 5); } catch (e) { /* вызов из расширения */ }
  return n;
}

function archiveRows_(sh, rowNums) {
  const def = reqDef_(sh.getName()), arc = sheet_(CFG.ARC);
  const head = head_(sh), C = reqCols_(head, def.name);
  const ah = head_(arc);
  const srcCol = ah.indexOf('Источник');
  const have = new Set();
  if (arc.getLastRow() >= 2 && srcCol !== -1) {
    arc.getRange(2, srcCol + 1, arc.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { have.add(String(r[0])); });
  }
  const out = [];
  rowNums.forEach(function (rn) {
    const v = sh.getRange(rn, 1, 1, head.length).getValues()[0];
    const id = String(v[C.id]);
    if (!id || have.has(id) || !String(v[C.ru]).trim()) return;
    const row = ah.map(function (h) {
      if (h === 'Источник') return id;
      if (h === 'Дата') return C.date !== -1 ? v[C.date] : '';
      if (h === 'Тип') return def.type;
      if (h === 'Текст RU') return v[C.ru];
      if (C.lang[h] !== undefined && C.lang[h] !== -1) return v[C.lang[h]];
      return '';
    });
    if (CFG.LANGS.some(function (l) { const c = ah.indexOf(l); return c !== -1 && String(row[c]).trim(); })) {
      out.push(row);
      have.add(id);
    }
  });
  if (out.length) arc.getRange(arc.getLastRow() + 1, 1, out.length, ah.length).setValues(out);
  return out.length;
}

/* ---------- загрузка из Smartcat ---------- */

function showSmartcatDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Smartcat').setWidth(760).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Загрузить переводы из Smartcat');
}

const SC_LANG = { kk: 'KK', ky: 'KY', uz: 'UZ', hy: 'HY', tg: 'TG', ka: 'KA', az: 'AZ', en: 'EN' };

// units: [{file, lang: 'uz-Latn', src, tgt, max}]. apply=false — только показать, что куда встанет.
// push_… ищется на вкладке пушей, banner_… — на вкладке баннеров (не нашлось — на другой).
function smartcatImport(units, apply) {
  const tabs = reqSheets_().map(function (x) {
    const head = head_(x.sh), C = reqCols_(head, x.def.name);
    const n = Math.max(x.sh.getLastRow() - 1, 0);
    const t = { def: x.def, sh: x.sh, head: head, C: C, vals: n ? x.sh.getRange(2, 1, n, head.length).getValues() : [],
      bgs: n ? x.sh.getRange(2, 1, n, head.length).getBackgrounds() : [], byKey: {}, byEmoji: {}, touched: {} };
    t.vals.forEach(function (r, i) {
      const ru = String(r[C.ru] || '');
      if (!ru.trim()) return;
      (t.byKey[kSpace_(ru)] = t.byKey[kSpace_(ru)] || []).push(i);
      (t.byEmoji[kEmoji_(ru)] = t.byEmoji[kEmoji_(ru)] || []).push(i);
    });
    return t;
  });
  const report = [];
  units.forEach(function (u) {
    const lang = SC_LANG[String(u.lang).toLowerCase().split('-')[0]];
    const kind = /^banner/i.test(u.file) ? 'Баннер' : /^push/i.test(u.file) ? 'Пуш' : '';
    const item = { file: u.file, lang: lang || u.lang, src: u.src, tgt: u.tgt };
    if (!lang) { item.status = 'язык не найден'; report.push(item); return; }
    const order = tabs.slice().sort(function (a, b) { return (b.def.type === kind) - (a.def.type === kind); });
    let t = null, cand = [];
    for (let k = 0; k < order.length && !cand.length; k++) {
      t = order[k];
      if (t.C.lang[lang] === -1) continue;
      cand = t.byKey[kSpace_(u.src)] || t.byEmoji[kEmoji_(u.src)] || [];
    }
    if (!cand.length) { item.status = 'строка не найдена'; report.push(item); return; }
    // Самая свежая строка (новые внизу), где этот язык ещё пуст; иначе самая свежая.
    const C = t.C;
    const empty = cand.filter(function (i) { return !String(t.vals[i][C.lang[lang]]).trim(); });
    const i = (empty.length ? empty : cand).slice(-1)[0];
    item.row = i + 2;
    item.id = t.vals[i][C.id];
    item.sheet = t.def.name;
    const cur = String(t.vals[i][C.lang[lang]] || '').trim();
    const max = Number(u.max) || (C.limit !== -1 ? limitOf_(t.vals[i][C.limit]) : 0);
    if (cur && cur !== String(u.tgt).trim()) item.status = 'уже есть другой перевод';
    else if (cur) item.status = 'уже стоит';
    else item.status = 'встанет';
    if (max && String(u.tgt).length > max) item.over = String(u.tgt).length + ' / ' + max;
    if (apply && item.status === 'встанет') {
      t.vals[i][C.lang[lang]] = u.tgt;
      t.bgs[i][C.lang[lang]] = item.over ? CFG.RED : '#ffffff';
      t.touched[i] = true;
      item.status = 'вставлено';
    }
    report.push(item);
  });
  if (apply) tabs.forEach(function (t) {
    const C = t.C;
    Object.keys(t.touched).forEach(function (k) {
      const i = Number(k), v = t.vals[i];
      const want = parseLangs_(C.langs !== -1 ? v[C.langs] : '');
      const list = want.length ? want : CFG.LANGS.filter(function (l) { return C.lang[l] !== -1 && String(v[C.lang[l]]).trim(); });
      if (list.every(function (l) { return C.lang[l] !== -1 && String(v[C.lang[l]]).trim(); }) && stPlain_(v[C.status]) !== CFG.ST.SENT) v[C.status] = stLabel_(CFG.ST.DONE);
      t.sh.getRange(i + 2, 1, 1, t.head.length).setValues([v]);
      t.sh.getRange(i + 2, 1, 1, t.head.length).setBackgrounds([t.bgs[i]]);
    });
  });
  return report;
}

/* ---------- статистика ---------- */

// Считает всё для статистики: и для листа «📊 Статистика», и для боковой панели расширения.
function collectStats_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const S = { total: 0, push: 0, banner: 0, fromArc: 0, months: {}, langs: {}, products: {}, btypes: {}, statuses: {}, overdue: 0 };
  const now = new Date();
  reqSheets_().forEach(function (x) {
    const sh = x.sh;
    if (sh.getLastRow() < 2) return;
    const head = head_(sh), C = reqCols_(head, x.def.name);
    sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().forEach(function (r) {
      if (!String(r[C.ru]).trim()) return;
      S.total++;
      const isBanner = x.def.type === 'Баннер';
      const m = r[C.date] instanceof Date ? Utilities.formatDate(r[C.date], tz, 'yyyy-MM') : '—';
      const mo = S.months[m] = S.months[m] || { push: 0, banner: 0, arc: 0 };
      if (isBanner) { mo.banner++; S.banner++; } else { mo.push++; S.push++; }
      parseLangs_(C.langs !== -1 ? r[C.langs] : '').forEach(function (l) { S.langs[l] = (S.langs[l] || 0) + 1; });
      const p = String((C.product !== -1 && r[C.product]) || '—').trim(); S.products[p] = (S.products[p] || 0) + 1;
      if (isBanner) { const b = String((C.btype !== -1 && r[C.btype]) || 'не указан'); S.btypes[b] = (S.btypes[b] || 0) + 1; }
      if (/^♻️/.test(String(r[C.match]))) { S.fromArc++; mo.arc++; }
      const st = stPlain_(r[C.status]) || CFG.ST.NEW;
      S.statuses[st] = (S.statuses[st] || 0) + 1;
      const open = [CFG.ST.NEW, CFG.ST.CHECK, CFG.ST.VENDOR].indexOf(st) !== -1;
      if (open && C.deadline !== -1 && r[C.deadline] instanceof Date && r[C.deadline] < now) S.overdue++;
    });
  });
  S.thisMonth = Utilities.formatDate(now, tz, 'yyyy-MM');
  S.updated = Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm');
  return S;
}

function buildStats() {
  const ss = SpreadsheetApp.getActive();
  const st = ss.getSheetByName(CFG.STATS) || ss.insertSheet(CFG.STATS);
  st.getCharts().forEach(function (c) { st.removeChart(c); });
  st.clear();
  const S = collectStats_();
  if (!S.total) { st.getRange(1, 1).setValue('Пока нет запросов.'); return; }
  const write = function (row, col, title, rows) {
    st.getRange(row, col).setValue(title).setFontWeight('bold').setFontSize(12);
    st.getRange(row + 1, col, rows.length, rows[0].length).setValues(rows);
    st.getRange(row + 1, col, 1, rows[0].length).setFontWeight('bold').setBackground('#2e2566').setFontColor('#ffffff');
    return st.getRange(row + 1, col, rows.length, rows[0].length);
  };
  const desc = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); };
  st.getRange(1, 1).setValue('📊 Переводы маркетинга').setFontSize(16).setFontWeight('bold');
  st.getRange(2, 1).setValue('Обновлено ' + S.updated + ' · всего ' + S.total +
    ' (пуши ' + S.push + ', баннеры ' + S.banner + ') · из архива: ' + S.fromArc + ' (' + Math.round(S.fromArc * 100 / S.total) + '%)');
  const mRows = [['Месяц', 'Пуши', 'Баннеры']].concat(Object.keys(S.months).sort().map(function (m) { return [m, S.months[m].push, S.months[m].banner]; }));
  const mR = write(4, 1, 'По месяцам', mRows);
  const lRows = [['Язык', 'Запросов']].concat(desc(S.langs).map(function (l) { return [l, S.langs[l]]; }));
  const lR = write(4, 5, 'Какие языки просят', lRows);
  const pRows = [['Продукт', 'Запросов']].concat(desc(S.products).map(function (p) { return [p, S.products[p]]; }));
  const pR = write(4, 8, 'Для чего (продукт)', pRows);
  const bRows = [['Тип баннера', 'Запросов']].concat(desc(S.btypes).map(function (b) { return [b, S.btypes[b]]; }));
  const bR = bRows.length > 1 ? write(4, 11, 'Какие баннеры', bRows) : null;
  const top = Math.max(mRows.length, lRows.length, pRows.length, bRows.length) + 7;
  st.insertChart(st.newChart().asColumnChart().addRange(mR).setNumHeaders(1).setPosition(top, 1, 0, 0)
    .setOption('title', 'Запросы по месяцам').setOption('colors', ['#2a78d6', '#eb6834']).setOption('width', 620).setOption('height', 320).build());
  st.insertChart(st.newChart().asBarChart().addRange(lR).setNumHeaders(1).setPosition(top, 7, 0, 0)
    .setOption('title', 'Языки').setOption('colors', ['#2a78d6']).setOption('legend', { position: 'none' }).setOption('width', 460).setOption('height', 320).build());
  st.insertChart(st.newChart().asBarChart().addRange(pR).setNumHeaders(1).setPosition(top + 17, 1, 0, 0)
    .setOption('title', 'Продукты').setOption('colors', ['#2a78d6']).setOption('legend', { position: 'none' }).setOption('width', 620).setOption('height', 280).build());
  if (bR) st.insertChart(st.newChart().asBarChart().addRange(bR).setNumHeaders(1).setPosition(top + 17, 7, 0, 0)
    .setOption('title', 'Типы баннеров').setOption('colors', ['#eb6834']).setOption('legend', { position: 'none' }).setOption('width', 460).setOption('height', 280).build());
  st.autoResizeColumns(1, 12);
}

// Поиск по всему, что уже переводили: «такой же / почти такой же» текст + все тексты, где встречаются эти слова.
function searchArchive_(q) {
  q = String(q || '').trim();
  if (!q) return { per: {}, fuzzy: null, hits: [] };
  const arc = loadArchive_(null);
  const found = findInArchive_(q, CFG.LANGS, arc);
  const per = {};
  Object.keys(found.per).forEach(function (l) {
    const p = found.per[l];
    per[l] = { level: p.level, words: LEVEL_WORDS[p.level], text: p.text, src: p.src, ru: p.ru };
  });
  // Тексты, где встречаются слова из запроса: больше совпавших слов — выше, при равенстве — свежее.
  const words = kEmoji_(q).split(' ').filter(function (w) { return w.length >= 3; });
  const need = Math.max(1, Math.ceil(words.length * 0.6));
  const scored = [], seen = {};
  for (let i = arc.length - 1; i >= 0 && words.length; i--) {
    const x = arc[i];
    if (seen[x.k1]) continue;
    const n = words.filter(function (w) { return x.k2.indexOf(w) !== -1; }).length;
    if (n < need) continue;
    seen[x.k1] = true;
    scored.push({ n: n, i: i, hit: { src: x.src, ru: x.ru, tr: x.tr } });
  }
  scored.sort(function (a, b) { return b.n - a.n || b.i - a.i; });
  const hits = scored.slice(0, 25).map(function (x) { return x.hit; });
  return { per: per, fuzzy: found.fuzzy, hits: hits };
}

/* ---------- настройка ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onRequestEdit', 'buildStats', 'flushInput'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onRequestEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('buildStats').timeBased().everyDays(1).atHour(7).create();
  reqSheets_().forEach(function (x) {
    const sh = x.sh, C = reqCols_(head_(sh), x.def.name);
    // Служебные колонки: правка возможна, но с предупреждением.
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (String(p.getDescription()).indexOf('Переводы:') === 0) p.remove(); });
    [C.id, C.match].forEach(function (c) {
      sh.getRange(1, c + 1, sh.getMaxRows(), 1).protect().setDescription('Переводы: заполняется автоматически').setWarningOnly(true);
    });
  });
  reqSheets_().forEach(function (x) { restyle_(x.sh); });
  token_();
  buildStats();
  SpreadsheetApp.getUi().alert('Готово: триггеры поставлены, оформление обновлено, статистика построена.\nКлюч для расширения — меню «🌍 Переводы» → «🔑 Ключ для расширения».');
}

/* ---------- оформление (для таблиц, созданных до новой версии) ---------- */

const LOOK = {
  CLIENT: { 'Тип баннера': 'из списка', 'Продукт': 'из списка', 'Языки': '«все» или KK, UZ…', 'Лимит': 'символов', 'Дедлайн': 'когда нужен',
    'Ссылка (тред / Figma)': 'Band / Figma', 'Контекст': 'где и зачем этот текст', 'Текст RU': 'одна строка = один текст' },
  AUTO: { 'ID': 'сам', 'Дата': 'сама', 'Статус': 'меняет локализация', 'Уже переводили?': 'таблица ищет в архиве сама' },
  LANG: { KK: ['казахский', '#1f8a8a'], KY: ['кыргызский', '#c0392b'], UZ: ['узбекский', '#2a78d6'], HY: ['армянский', '#d9822b'],
    TG: ['таджикский', '#2e8b57'], KA: ['грузинский', '#b0306a'], AZ: ['азербайджанский', '#5b4bc4'], EN: ['английский', '#5f6b7a'] },
  // статус → [заливка, текст], как в «📖 Как заполнять»
  ST: { 'Новый': ['#ffd3e2', '#a1204f'], 'Из архива': ['#e0d9fa', '#4a3a8c'], 'Проверить': ['#ffe7b0', '#7a4f00'], 'У подрядчика': ['#d6e6fb', '#1d5fb8'],
    'Готово': ['#c9eef0', '#0e6b70'], 'Отдан': ['#b7e4c7', '#146b3a'], 'Отменён': ['#f5f5f5', '#9a9a9a'] },
};

// Заголовки с подсказками, статусы с иконками, выпадающий список и цвета статусов.
function restyle_(sh) {
  const head = head_(sh), C = reqCols_(head, sh.getName());
  const bold = SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor('#ffffff').setFontSize(10).build();
  const small = SpreadsheetApp.newTextStyle().setBold(false).setItalic(true).setForegroundColor('#f3eefa').setFontSize(8).build();
  head.forEach(function (h, i) {
    let title = h, hint = '', bg = '#2e2566';
    if (LOOK.CLIENT[h] !== undefined) { title = '✍️ ' + h; hint = LOOK.CLIENT[h]; bg = '#c2477a'; }
    else if (LOOK.AUTO[h] !== undefined) { title = '🤖 ' + h; hint = LOOK.AUTO[h]; bg = h === 'Статус' ? '#2e2566' : '#6b6580'; }
    else if (LOOK.LANG[h]) { hint = LOOK.LANG[h][0]; bg = LOOK.LANG[h][1]; }
    else return;
    const text = title + '\n' + hint;
    const rt = SpreadsheetApp.newRichTextValue().setText(text)
      .setTextStyle(0, title.length, bold).setTextStyle(title.length + 1, text.length, small).build();
    sh.getRange(1, i + 1).setRichTextValue(rt).setBackground(bg).setWrap(true).setVerticalAlignment('middle');
  });
  sh.setRowHeight(1, 44);
  const n = sh.getMaxRows() - 1;
  // Старые статусы без иконок → с иконками.
  if (sh.getLastRow() >= 2) {
    const rng = sh.getRange(2, C.status + 1, sh.getLastRow() - 1, 1);
    const vals = rng.getValues();
    let ch = false;
    vals.forEach(function (r) { const p = stPlain_(r[0]); if (p && CFG.ST_LABEL[p] && r[0] !== CFG.ST_LABEL[p]) { r[0] = CFG.ST_LABEL[p]; ch = true; } });
    if (ch) rng.setValues(vals);
  }
  const labels = Object.keys(CFG.ST_LABEL).map(function (k) { return CFG.ST_LABEL[k]; });
  sh.getRange(2, C.status + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(labels, true).setAllowInvalid(true).build());
  // Цвета: статус, розовый ID у новых, серый текст у закрытых строк.
  const col = function (c) { return sh.getRange(2, c + 1, n, 1).getA1Notation().replace(/\d+/g, ''); };
  const sc = col(C.status).split(':')[0];
  const rules = [];
  Object.keys(LOOK.ST).forEach(function (st) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + sc + '2="' + CFG.ST_LABEL[st] + '"')
      .setBackground(LOOK.ST[st][0]).setFontColor(LOOK.ST[st][1]).setBold(true).setRanges([sh.getRange(2, C.status + 1, n, 1)]).build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + sc + '2="' + CFG.ST_LABEL['Новый'] + '"')
    .setBackground('#ffd3e2').setFontColor('#a1204f').setBold(true).setRanges([sh.getRange(2, C.id + 1, n, 1)]).build());
  const grayRanges = [sh.getRange(2, C.id + 2, n, C.status - C.id - 1), sh.getRange(2, C.match + 1, n, 1)];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=OR($' + sc + '2="' + CFG.ST_LABEL['Отдан'] + '",$' + sc + '2="' + CFG.ST_LABEL['Отменён'] + '")')
    .setFontColor('#8c8a94').setRanges(grayRanges).build());
  sh.setConditionalFormatRules(rules);
}

function token_() {
  const props = PropertiesService.getScriptProperties();
  let t = props.getProperty(CFG.TOKEN_PROP);
  if (!t) { t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty(CFG.TOKEN_PROP, t); }
  return t;
}

function showLegend() {
  SpreadsheetApp.getUi().alert('Как читать таблицу',
    'Заголовки:\n✍️ розовые — заполняет заказчик\n🤖 серые — заполняются сами\nцветные KK, UZ… — переводы\n\n' +
    'Статусы:\n🆕 Новый — ждёт разбора\n♻️ Из архива — перевод взят из архива, заказывать не нужно\n⚠️ Проверить — из архива, но отличаются цифры или знаки\n' +
    '📤 У подрядчика — отдан на перевод\n✅ Готово — переводы на месте\n📨 Отдан — отдан заказчику\n✖️ Отменён\n\n' +
    'Ячейки переводов:\n🟩 зелёная — из архива, можно брать\n🟨 жёлтая — из архива, проверить число / знаки\n🟥 красная — длиннее лимита',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function showToken() {
  SpreadsheetApp.getUi().alert('Ключ для расширения (вставьте в его настройки вместе со ссылкой веб-приложения):\n\n' + token_());
}

/* ---------- API для расширения ---------- */
// Развёртывание: «Начать развёртывание» → «Веб-приложение», от имени владельца, доступ «Все».
// Без ключа ничего не отдаёт.

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== token_()) return json_({ error: 'нет доступа' });
  if (p.action === 'list') return json_(listForExtension_());
  if (p.action === 'stats') return json_(collectStats_());
  if (p.action === 'search') return json_(searchArchive_(p.q));
  return json_({ ok: true });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'плохой запрос' }); }
  if (body.token !== token_()) return json_({ error: 'нет доступа' });
  if (body.action === 'search') return json_(searchArchive_(body.q));
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return json_({ error: 'таблица занята, попробуйте ещё раз' });
  try {
    // Переводы из Smartcat, присланные расширением: сначала apply=false (что куда встанет), потом apply=true.
    if (body.action === 'smartcat') return json_({ report: smartcatImport(body.units || [], !!body.apply) });
    if (body.action === 'archive') { archiveDone(); return json_(listForExtension_()); }
    const ids = body.ids || [body.id];
    if (body.action === 'status' && Object.keys(CFG.ST).map(function (k) { return CFG.ST[k]; }).indexOf(body.status) === -1) return json_({ error: 'нет такого статуса' });
    const byTab = {};   // проверка по архиву — одним заходом на вкладку
    for (let k = 0; k < ids.length; k++) {
      const at = rowById_(ids[k]);
      if (!at) return json_({ error: 'не нашла ' + ids[k] });
      if (body.action === 'match') (byTab[at.sh.getName()] = byTab[at.sh.getName()] || { sh: at.sh, rows: [] }).rows.push(at.row);
      else if (body.action === 'status') {
        const C = reqCols_(head_(at.sh), at.sh.getName());
        at.sh.getRange(at.row, C.status + 1).setValue(stLabel_(body.status));
        if (body.status === CFG.ST.SENT || body.status === CFG.ST.DONE) archiveRows_(at.sh, [at.row]);
      }
    }
    Object.keys(byTab).forEach(function (n) { matchRows_(byTab[n].sh, byTab[n].rows, true); });
    return json_(listForExtension_());
  } finally {
    lock.releaseLock();
  }
}

function rowById_(id) {
  const tabs = reqSheets_();
  for (let k = 0; k < tabs.length; k++) {
    const sh = tabs[k].sh, C = reqCols_(head_(sh), tabs[k].def.name);
    if (sh.getLastRow() < 2) continue;
    const ids = sh.getRange(2, C.id + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return { sh: sh, row: i + 2 };
  }
  return null;
}

// Незакрытые запросы + счётчики (старые первыми, свежие в конце). Расширение по ним показывает уведомления и подсказки.
function listForExtension_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const counts = {};
  let items = [];
  reqSheets_().forEach(function (x) {
    const sh = x.sh;
    if (sh.getLastRow() < 2) return;
    const head = head_(sh), C = reqCols_(head, x.def.name);
    const base = ss.getUrl() + '#gid=' + sh.getSheetId();
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
    const bgs = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getBackgrounds();
    vals.forEach(function (r, i) {
      if (!String(r[C.ru]).trim() || !String(r[C.id]).trim()) return;
      const st = stPlain_(r[C.status]) || CFG.ST.NEW;
      counts[st] = (counts[st] || 0) + 1;
      if ([CFG.ST.SENT, CFG.ST.CANCEL].indexOf(st) !== -1) return;
      const tr = {};
      CFG.LANGS.forEach(function (l) {
        const c = C.lang[l];
        if (c !== -1 && String(r[c]).trim()) tr[l] = { text: String(r[c]), mark: bgs[i][c] === CFG.GREEN ? 'archive' : bgs[i][c] === CFG.YELLOW ? 'check' : bgs[i][c] === CFG.RED ? 'over' : '' };
      });
      const fmt = function (d, f) { return d instanceof Date ? Utilities.formatDate(d, tz, f) : String(d || ''); };
      items.push({
        id: String(r[C.id]), row: i + 2, url: base + '&range=A' + (i + 2), status: st, type: x.def.type,
        btype: C.btype !== -1 ? String(r[C.btype] || '') : '', product: C.product !== -1 ? String(r[C.product] || '') : '',
        langs: parseLangs_(C.langs !== -1 ? r[C.langs] : ''), limit: C.limit !== -1 ? limitOf_(r[C.limit]) : 0,
        date: fmt(r[C.date], 'dd.MM'), sort: r[C.date] instanceof Date ? r[C.date].getTime() : 0,
        deadline: C.deadline !== -1 ? fmt(r[C.deadline], 'dd.MM HH:mm') : '',
        dl: C.deadline !== -1 && r[C.deadline] instanceof Date ? r[C.deadline].getTime() : 0,
        link: C.link !== -1 ? String(r[C.link] || '') : '', ru: String(r[C.ru]), match: String(r[C.match] || ''), tr: tr,
      });
    });
  });
  items.sort(function (a, b) { return a.sort - b.sort || (a.id < b.id ? -1 : 1); });
  items = items.slice(-300);
  const first = reqSheets_()[0];
  return {
    updated: Utilities.formatDate(new Date(), tz, 'dd.MM HH:mm'),
    url: ss.getUrl() + (first ? '#gid=' + first.sh.getSheetId() : ''),
    counts: counts,
    items: items,
  };
}
