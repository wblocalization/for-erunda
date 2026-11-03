/* ============================================================================
 * Переводы маркетинга: запросы на перевод пушей и баннеров.
 * Маркетологи пишут строки на «📥 Запросы», скрипт:
 *  - ставит ID, дату и статус;
 *  - ищет текст в архиве и подставляет готовые переводы
 *    (точное совпадение / отличается эмодзи — зелёным, отличаются цифры — жёлтым);
 *  - подсвечивает переводы длиннее лимита;
 *  - загружает переводы из Smartcat (zip / xliff) в нужные строки;
 *  - строит статистику;
 *  - отдаёт данные расширению (doGet / doPost с ключом).
 * Всё работает и без расширения — через меню «🌍 Переводы».
 * ========================================================================== */

const CFG = {
  REQ: '📥 Запросы',
  ARC: '📚 Архив переводов',
  STATS: '📊 Статистика',
  LANGS: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN'],
  ALL: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA'],            // что значит «все»
  LANG_WORDS: {
    KK: ['казах', 'kk'], KY: ['кыргыз', 'киргиз', 'ky'], UZ: ['узбек', 'uz'], HY: ['армян', 'hy'],
    TG: ['таджик', 'tg'], KA: ['грузин', 'ka'], AZ: ['азербайджан', 'az'], EN: ['англ', 'en'],
  },
  ST: { NEW: 'Новый', ARCHIVE: 'Из архива', CHECK: 'Проверить', VENDOR: 'У подрядчика', DONE: 'Готово', SENT: 'Отдан', CANCEL: 'Отменён' },
  GREEN: '#e2f6ec',   // перевод из архива, можно брать
  YELLOW: '#fff4dc',  // из архива, но проверить (цифры, знаки)
  RED: '#ffd6e0',     // длиннее лимита
  FUZZY: 0.9,         // «почти такой же» — только подсказка, без подстановки
  PREFIX: { 'Пуш': 'P', 'Баннер': 'B', 'Имейл': 'E', 'Исследование': 'R', 'Инструкция': 'I', 'Другое': 'X' },
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

function head_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
}

// Индексы колонок «Запросов» по названиям (0-based).
function reqCols_(head) {
  const c = function (h) { return head.indexOf(h); };
  const out = {
    id: c('ID'), date: c('Дата'), type: c('Тип'), btype: c('Тип баннера'), product: c('Продукт'), langs: c('Языки'),
    limit: c('Лимит'), deadline: c('Дедлайн'), link: c('Ссылка (тред / Figma)'), ctx: c('Контекст'),
    ru: c('Текст RU'), status: c('Статус'), match: c('Уже переводили?'), lang: {},
  };
  CFG.LANGS.forEach(function (l) { out.lang[l] = c(l); });
  ['id', 'ru', 'status', 'match'].forEach(function (k) {
    if (out[k] === -1) throw new Error('На «' + CFG.REQ + '» нет колонки «' + { id: 'ID', ru: 'Текст RU', status: 'Статус', match: 'Уже переводили?' }[k] + '».');
  });
  return out;
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

// Записи: { src: 'P-0123' | 'архив: <файл>', ru, tr: {KK: ...} }. Свежие — первыми.
function loadArchive_(skipRow) {
  const list = [];
  const req = sheet_(CFG.REQ);
  if (req.getLastRow() >= 2) {
    const head = head_(req), C = reqCols_(head);
    const vals = req.getRange(2, 1, req.getLastRow() - 1, head.length).getDisplayValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (i + 2 === skipRow) continue;
      const r = vals[i];
      const st = r[C.status];
      if (st !== CFG.ST.DONE && st !== CFG.ST.SENT && st !== CFG.ST.ARCHIVE) continue;
      const tr = {};
      CFG.LANGS.forEach(function (l) { if (C.lang[l] !== -1 && String(r[C.lang[l]]).trim()) tr[l] = r[C.lang[l]]; });
      if (Object.keys(tr).length && String(r[C.ru]).trim()) list.push({ src: r[C.id], ru: r[C.ru], tr: tr });
    }
  }
  const ss = SpreadsheetApp.getActive().getSheetByName(CFG.ARC);
  if (ss && ss.getLastRow() >= 2) {
    const head = head_(ss);
    const ru = head.indexOf('Текст RU'), srcCol = head.indexOf('Источник');
    const vals = ss.getRange(2, 1, ss.getLastRow() - 1, head.length).getDisplayValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      const r = vals[i];
      if (!String(r[ru]).trim()) continue;
      const tr = {};
      CFG.LANGS.forEach(function (l) { const c = head.indexOf(l); if (c !== -1 && String(r[c]).trim()) tr[l] = r[c]; });
      if (Object.keys(tr).length) list.push({ src: 'архив' + (srcCol !== -1 && r[srcCol] ? ': ' + String(r[srcCol]).slice(0, 40) : ''), ru: r[ru], tr: tr });
    }
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
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== CFG.REQ) { SpreadsheetApp.getUi().alert('Выделите строки на листе «' + CFG.REQ + '».'); return; }
  const rows = [];
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = Math.max(2, r.getRow()); i <= r.getLastRow(); i++) rows.push(i);
  });
  const res = matchRows_(rows, true);
  SpreadsheetApp.getActive().toast(summary_(res), 'Проверка по архиву', 8);
}

function matchAllNew() {
  const sh = sheet_(CFG.REQ);
  const head = head_(sh), C = reqCols_(head);
  if (sh.getLastRow() < 2) return;
  const st = sh.getRange(2, C.status + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const rows = [];
  st.forEach(function (v, i) { if (!v[0] || v[0] === CFG.ST.NEW) rows.push(i + 2); });
  const res = matchRows_(rows, true);
  SpreadsheetApp.getActive().toast(summary_(res), 'Проверка по архиву', 8);
}

function summary_(res) {
  return 'Проверено строк: ' + res.rows + '. Подставлено переводов: ' + res.filled + ' (на проверку: ' + res.check + '). Похожих подсказок: ' + res.fuzzy + '.';
}

// Проверяет строки: ID/дата/статус, поиск в архиве, лимиты. Пустые переводы заполняет, заполненные не трогает.
function matchRows_(rowNums, force) {
  const sh = sheet_(CFG.REQ);
  const head = head_(sh), C = reqCols_(head);
  const res = { rows: 0, filled: 0, check: 0, fuzzy: 0 };
  if (!rowNums.length) return res;
  const arc = loadArchive_(rowNums.length === 1 ? rowNums[0] : 0);
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
      const pre = CFG.PREFIX[String(v[C.type]).trim()] || 'P';
      ids[pre] = (ids[pre] || 0) + 1;
      v[C.id] = pre + '-' + ('000' + ids[pre]).slice(-4);
      changed = true;
    }
    if (C.date !== -1 && !v[C.date]) { v[C.date] = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00'); changed = true; }
    if (!String(v[C.status]).trim()) { v[C.status] = CFG.ST.NEW; changed = true; }

    const langs = parseLangs_(C.langs !== -1 ? v[C.langs] : '');
    const want = langs.length ? langs : CFG.ALL;
    const st = v[C.status];
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
      if (first && !missing.length && st === CFG.ST.NEW) { v[C.status] = check.length ? CFG.ST.CHECK : CFG.ST.ARCHIVE; changed = true; }
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
  if (sh.getName() !== CFG.REQ || e.range.getLastRow() < 2) return;
  const head = head_(sh), C = reqCols_(head);
  const first = e.range.getColumn() - 1, last = e.range.getLastColumn() - 1;
  const touches = function (c) { return c !== -1 && c >= first && c <= last; };
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    const rows = [];
    for (let r = Math.max(2, e.range.getRow()); r <= e.range.getLastRow(); r++) rows.push(r);
    if (touches(C.ru) || touches(C.langs) || touches(C.type)) {
      matchRows_(rows, false);
    } else if (touches(C.status) && /^(Готово|Отдан)$/.test(String(e.value || ''))) {
      archiveRows_(rows);
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
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== CFG.REQ) { SpreadsheetApp.getUi().alert('Выделите строки на листе «' + CFG.REQ + '».'); return; }
  const C = reqCols_(head_(sh));
  let n = 0;
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = Math.max(2, r.getRow()); i <= r.getLastRow(); i++) {
      if (!String(sh.getRange(i, C.ru + 1).getValue()).trim()) continue;
      sh.getRange(i, C.status + 1).setValue(status);
      n++;
    }
  });
  if (status === CFG.ST.SENT) archiveSelected_();
  SpreadsheetApp.getActive().toast('Статус «' + status + '»: ' + n + ' строк.', 'Переводы', 5);
}

function archiveSelected_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const rows = [];
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = Math.max(2, r.getRow()); i <= r.getLastRow(); i++) rows.push(i);
  });
  archiveRows_(rows);
}

/* ---------- архив ---------- */

// Готовые и отданные запросы, которых ещё нет в архиве, дописываются в «📚 Архив переводов».
function archiveDone() {
  const sh = sheet_(CFG.REQ);
  const C = reqCols_(head_(sh));
  if (sh.getLastRow() < 2) return;
  const st = sh.getRange(2, C.status + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const rows = [];
  st.forEach(function (v, i) { if (v[0] === CFG.ST.DONE || v[0] === CFG.ST.SENT) rows.push(i + 2); });
  const n = archiveRows_(rows);
  SpreadsheetApp.getActive().toast('В архив добавлено: ' + n + '.', 'Архив', 5);
}

function archiveRows_(rowNums) {
  const sh = sheet_(CFG.REQ), arc = sheet_(CFG.ARC);
  const head = head_(sh), C = reqCols_(head);
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
      if (h === 'Тип') return C.type !== -1 ? v[C.type] : '';
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
function smartcatImport(units, apply) {
  const sh = sheet_(CFG.REQ);
  const head = head_(sh), C = reqCols_(head);
  const n = Math.max(sh.getLastRow() - 1, 0);
  const vals = n ? sh.getRange(2, 1, n, head.length).getValues() : [];
  const bgs = n ? sh.getRange(2, 1, n, head.length).getBackgrounds() : [];
  const byKey = {}, byEmoji = {};
  vals.forEach(function (r, i) {
    const ru = String(r[C.ru] || '');
    if (!ru.trim()) return;
    (byKey[kSpace_(ru)] = byKey[kSpace_(ru)] || []).push(i);
    (byEmoji[kEmoji_(ru)] = byEmoji[kEmoji_(ru)] || []).push(i);
  });
  const report = [];
  const touched = {};
  units.forEach(function (u) {
    const lang = SC_LANG[String(u.lang).toLowerCase().split('-')[0]];
    const kind = /^banner/i.test(u.file) ? 'Баннер' : /^push/i.test(u.file) ? 'Пуш' : '';
    const item = { file: u.file, lang: lang || u.lang, src: u.src, tgt: u.tgt };
    if (!lang || C.lang[lang] === -1) { item.status = 'язык не найден'; report.push(item); return; }
    let cand = byKey[kSpace_(u.src)] || byEmoji[kEmoji_(u.src)] || [];
    if (kind && C.type !== -1) {
      const same = cand.filter(function (i) { return String(vals[i][C.type]) === kind; });
      if (same.length) cand = same;
    }
    // Свежая строка, где этот язык ещё пуст; иначе самая свежая.
    const empty = cand.filter(function (i) { return !String(vals[i][C.lang[lang]]).trim(); });
    const i = (empty.length ? empty : cand).slice(-1)[0];
    if (i === undefined) { item.status = 'строка не найдена'; report.push(item); return; }
    item.row = i + 2;
    item.id = vals[i][C.id];
    const cur = String(vals[i][C.lang[lang]] || '').trim();
    const max = Number(u.max) || (C.limit !== -1 ? limitOf_(vals[i][C.limit]) : 0);
    if (cur && cur !== String(u.tgt).trim()) item.status = 'уже есть другой перевод';
    else if (cur) item.status = 'уже стоит';
    else item.status = 'встанет';
    if (max && String(u.tgt).length > max) item.over = String(u.tgt).length + ' / ' + max;
    if (apply && item.status === 'встанет') {
      vals[i][C.lang[lang]] = u.tgt;
      bgs[i][C.lang[lang]] = item.over ? CFG.RED : '#ffffff';
      touched[i] = true;
      item.status = 'вставлено';
    }
    report.push(item);
  });
  if (apply && Object.keys(touched).length) {
    Object.keys(touched).forEach(function (k) {
      const i = Number(k);
      const want = parseLangs_(C.langs !== -1 ? vals[i][C.langs] : '');
      const list = want.length ? want : CFG.LANGS.filter(function (l) { return C.lang[l] !== -1 && String(vals[i][C.lang[l]]).trim(); });
      const st = String(vals[i][C.status]);
      if (list.every(function (l) { return String(vals[i][C.lang[l]]).trim(); }) && st !== CFG.ST.SENT) vals[i][C.status] = CFG.ST.DONE;
      sh.getRange(i + 2, 1, 1, head.length).setValues([vals[i]]);
      sh.getRange(i + 2, 1, 1, head.length).setBackgrounds([bgs[i]]);
    });
  }
  return report;
}

/* ---------- статистика ---------- */

function buildStats() {
  const sh = sheet_(CFG.REQ);
  const head = head_(sh), C = reqCols_(head);
  const ss = SpreadsheetApp.getActive();
  let st = ss.getSheetByName(CFG.STATS) || ss.insertSheet(CFG.STATS);
  st.getCharts().forEach(function (c) { st.removeChart(c); });
  st.clear();
  if (sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().filter(function (r) { return String(r[C.ru]).trim(); });
  const tz = ss.getSpreadsheetTimeZone();
  const months = {}, langs = {}, products = {}, btypes = {};
  let fromArc = 0, push = 0, banner = 0;
  vals.forEach(function (r) {
    const type = String(r[C.type] || 'Пуш');
    const m = r[C.date] instanceof Date ? Utilities.formatDate(r[C.date], tz, 'yyyy-MM') : '—';
    months[m] = months[m] || { push: 0, banner: 0, other: 0 };
    if (type === 'Пуш') { months[m].push++; push++; } else if (type === 'Баннер') { months[m].banner++; banner++; } else months[m].other++;
    parseLangs_(r[C.langs]).forEach(function (l) { langs[l] = (langs[l] || 0) + 1; });
    const p = String(r[C.product] || '—').trim(); products[p] = (products[p] || 0) + 1;
    if (type === 'Баннер') { const b = String(r[C.btype] || 'не указан'); btypes[b] = (btypes[b] || 0) + 1; }
    if (/^♻️/.test(String(r[C.match]))) fromArc++;
  });
  const write = function (row, col, title, rows) {
    st.getRange(row, col).setValue(title).setFontWeight('bold').setFontSize(12);
    st.getRange(row + 1, col, rows.length, rows[0].length).setValues(rows);
    st.getRange(row + 1, col, 1, rows[0].length).setFontWeight('bold').setBackground('#2e2566').setFontColor('#ffffff');
    return st.getRange(row + 1, col, rows.length, rows[0].length);
  };
  st.getRange(1, 1).setValue('📊 Переводы маркетинга').setFontSize(16).setFontWeight('bold');
  st.getRange(2, 1).setValue('Обновлено ' + Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm') + ' · всего ' + vals.length +
    ' (пуши ' + push + ', баннеры ' + banner + ') · из архива: ' + fromArc + ' (' + Math.round(fromArc * 100 / Math.max(vals.length, 1)) + '%)');
  const mRows = [['Месяц', 'Пуши', 'Баннеры', 'Другое']].concat(Object.keys(months).sort().map(function (m) { return [m, months[m].push, months[m].banner, months[m].other]; }));
  const mR = write(4, 1, 'По месяцам', mRows);
  const lRows = [['Язык', 'Запросов']].concat(Object.keys(langs).sort(function (a, b) { return langs[b] - langs[a]; }).map(function (l) { return [l, langs[l]]; }));
  const lR = write(4, 6, 'Какие языки просят', lRows);
  const pRows = [['Продукт', 'Запросов']].concat(Object.keys(products).sort(function (a, b) { return products[b] - products[a]; }).map(function (p) { return [p, products[p]]; }));
  const pR = write(4, 9, 'Для чего (продукт)', pRows);
  const bRows = [['Тип баннера', 'Запросов']].concat(Object.keys(btypes).sort(function (a, b) { return btypes[b] - btypes[a]; }).map(function (b) { return [b, btypes[b]]; }));
  const bR = bRows.length > 1 ? write(4, 12, 'Какие баннеры', bRows) : null;
  const top = Math.max(mRows.length, lRows.length, pRows.length, bRows.length) + 7;
  st.insertChart(st.newChart().asColumnChart().addRange(mR).setNumHeaders(1).setPosition(top, 1, 0, 0)
    .setOption('title', 'Запросы по месяцам').setOption('colors', ['#2a78d6', '#eb6834', '#1baf7a']).setOption('width', 620).setOption('height', 320).build());
  st.insertChart(st.newChart().asBarChart().addRange(lR).setNumHeaders(1).setPosition(top, 8, 0, 0)
    .setOption('title', 'Языки').setOption('colors', ['#2a78d6']).setOption('legend', { position: 'none' }).setOption('width', 460).setOption('height', 320).build());
  st.insertChart(st.newChart().asBarChart().addRange(pR).setNumHeaders(1).setPosition(top + 17, 1, 0, 0)
    .setOption('title', 'Продукты').setOption('colors', ['#2a78d6']).setOption('legend', { position: 'none' }).setOption('width', 620).setOption('height', 280).build());
  if (bR) st.insertChart(st.newChart().asBarChart().addRange(bR).setNumHeaders(1).setPosition(top + 17, 8, 0, 0)
    .setOption('title', 'Типы баннеров').setOption('colors', ['#eb6834']).setOption('legend', { position: 'none' }).setOption('width', 460).setOption('height', 280).build());
  st.autoResizeColumns(1, 13);
}

/* ---------- настройка ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onRequestEdit', 'buildStats'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onRequestEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('buildStats').timeBased().everyDays(1).atHour(7).create();
  const sh = sheet_(CFG.REQ), C = reqCols_(head_(sh));
  // Служебные колонки: правка возможна, но с предупреждением.
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (String(p.getDescription()).indexOf('Переводы:') === 0) p.remove(); });
  [C.id, C.match].forEach(function (c) {
    sh.getRange(1, c + 1, sh.getMaxRows(), 1).protect().setDescription('Переводы: заполняется автоматически').setWarningOnly(true);
  });
  token_();
  buildStats();
  SpreadsheetApp.getUi().alert('Готово: триггеры поставлены, статистика построена.\nКлюч для расширения — меню «🌍 Переводы» → «🔑 Ключ для расширения».');
}

function token_() {
  const props = PropertiesService.getScriptProperties();
  let t = props.getProperty(CFG.TOKEN_PROP);
  if (!t) { t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty(CFG.TOKEN_PROP, t); }
  return t;
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
  return json_({ ok: true });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'плохой запрос' }); }
  if (body.token !== token_()) return json_({ error: 'нет доступа' });
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return json_({ error: 'таблица занята, попробуйте ещё раз' });
  try {
    // Переводы из Smartcat, присланные расширением: сначала apply=false (что куда встанет), потом apply=true.
    if (body.action === 'smartcat') return json_({ report: smartcatImport(body.units || [], !!body.apply) });
    const rn = rowById_(body.id);
    if (!rn) return json_({ error: 'не нашла ' + body.id });
    if (body.action === 'match') matchRows_([rn], true);
    else if (body.action === 'status') {
      const C = reqCols_(head_(sheet_(CFG.REQ)));
      if (Object.keys(CFG.ST).map(function (k) { return CFG.ST[k]; }).indexOf(body.status) === -1) return json_({ error: 'нет такого статуса' });
      sheet_(CFG.REQ).getRange(rn, C.status + 1).setValue(body.status);
      if (body.status === CFG.ST.SENT || body.status === CFG.ST.DONE) archiveRows_([rn]);
    }
    return json_(listForExtension_());
  } finally {
    lock.releaseLock();
  }
}

function rowById_(id) {
  const sh = sheet_(CFG.REQ), C = reqCols_(head_(sh));
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, C.id + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === id) return i + 2;
  return 0;
}

// Незакрытые запросы + счётчики. Расширение по ним показывает уведомления и подсказки.
function listForExtension_() {
  const ss = SpreadsheetApp.getActive();
  const sh = sheet_(CFG.REQ), head = head_(sh), C = reqCols_(head);
  const tz = ss.getSpreadsheetTimeZone();
  const counts = {};
  const items = [];
  if (sh.getLastRow() >= 2) {
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
    const bgs = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getBackgrounds();
    vals.forEach(function (r, i) {
      if (!String(r[C.ru]).trim()) return;
      const st = String(r[C.status] || CFG.ST.NEW);
      counts[st] = (counts[st] || 0) + 1;
      if ([CFG.ST.SENT, CFG.ST.CANCEL].indexOf(st) !== -1) return;
      const tr = {};
      CFG.LANGS.forEach(function (l) {
        const c = C.lang[l];
        if (c !== -1 && String(r[c]).trim()) tr[l] = { text: String(r[c]), mark: bgs[i][c] === CFG.GREEN ? 'archive' : bgs[i][c] === CFG.YELLOW ? 'check' : bgs[i][c] === CFG.RED ? 'over' : '' };
      });
      const fmt = function (d, f) { return d instanceof Date ? Utilities.formatDate(d, tz, f) : String(d || ''); };
      items.push({
        id: String(r[C.id]), row: i + 2, status: st, type: String(r[C.type] || ''), btype: C.btype !== -1 ? String(r[C.btype] || '') : '',
        product: C.product !== -1 ? String(r[C.product] || '') : '', langs: parseLangs_(C.langs !== -1 ? r[C.langs] : ''),
        limit: C.limit !== -1 ? limitOf_(r[C.limit]) : 0, date: fmt(r[C.date], 'dd.MM'), deadline: C.deadline !== -1 ? fmt(r[C.deadline], 'dd.MM HH:mm') : '',
        link: C.link !== -1 ? String(r[C.link] || '') : '', ru: String(r[C.ru]), match: String(r[C.match] || ''), tr: tr,
      });
    });
  }
  return {
    updated: Utilities.formatDate(new Date(), tz, 'dd.MM HH:mm'),
    url: ss.getUrl() + '#gid=' + sh.getSheetId(),
    counts: counts,
    items: items.slice(-300),
  };
}
