/* ============================================================================
 * 📊 Статистика переводов — для таблицы Зары (старый формат, ничего в ней не меняет).
 *
 * Читает листы:
 *   «Заказы на перевод пушей…»    — дата, продукт, языки, комментарии, лимит, RU, переводы
 *   «Заказы на перевод баннеров…» — дата, продукт, язык, тип, ТЗ, лимит, RU, переводы
 *   «Анализ переводов»            — сметы: слова и стоимость (для ставки за слово)
 * и показывает отчёт: запросы по месяцам, языки, продукты, типы баннеров и
 * ПОВТОРЫ — тексты, которые уже переводили раньше, а заказали снова.
 *
 * Установка (один раз):
 *   1. Расширения → Apps Script → «+» → Скрипт → назвать «Статистика» → вставить этот код.
 *   2. «+» → HTML → назвать «Stats» → вставить Stats.html.
 *   3. Сохранить, в списке функций выбрать zsSetup → «Выполнить» → разрешить доступ.
 *   4. Обновить таблицу: появится меню «📊 Статистика».
 * Если в проекте уже есть свой onOpen — ничего страшного, меню добавится отдельным триггером.
 * ========================================================================== */

// Таблица: открытая (скрипт внутри таблицы) или по ID (скрипт-мост для расширения).
let ZS_SS_ = null;
function zsSS_() {
  if (ZS_SS_) return ZS_SS_;
  const a = SpreadsheetApp.getActive();
  if (a) return (ZS_SS_ = a);
  const id = PropertiesService.getScriptProperties().getProperty('ZS_SHEET_ID');
  if (!id) throw new Error('Мост не подключён к таблице: запустите zsBridgeSetup');
  return (ZS_SS_ = SpreadsheetApp.openById(id));
}
function zsCache_() { return CacheService.getDocumentCache() || CacheService.getScriptCache(); }
function zsProps_() { return PropertiesService.getDocumentProperties() || PropertiesService.getScriptProperties(); }
function zsLock_() { return LockService.getDocumentLock() || LockService.getScriptLock(); }

const ZS_CFG = {
  PUSH: 'Заказы на перевод пушей',        // начало названия листа
  BANNER: 'Заказы на перевод баннеров',
  COST: 'Анализ переводов',
  LANGS: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN'],
  ALL6: ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA'],
  NAMES: { 'казах': 'KK', 'кыргыз': 'KY', 'киргиз': 'KY', 'узбек': 'UZ', 'армян': 'HY', 'таджик': 'TG', 'грузин': 'KA', 'азербайджан': 'AZ', 'англ': 'EN' },
  PRODUCTS: ['Магазинка', 'WB Банк', 'WB Клуб', 'WB Такси', 'WB Flot', 'Портал продавца', 'Другое'],
  FUZZY: 0.9,
  CACHE_MIN: 20,
};

/* ---------- меню ---------- */

function zsSetup() {
  const ss = SpreadsheetApp.getActive();
  // Запустили не из таблицы, а в отдельном проекте моста — там нужен zsBridgeSetup.
  if (!ss) {
    if (typeof zsBridgeSetup === 'function') { Logger.log('Это проект моста — запускаю zsBridgeSetup вместо zsSetup.'); return zsBridgeSetup(); }
    throw new Error('zsSetup запускается из таблицы: «Расширения» → «Apps Script» внутри таблицы Зары.');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['zsOnOpen', 'zsOnEdit'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('zsOnOpen').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('zsOnEdit').forSpreadsheet(ss).onEdit().create();
  zsOnOpen();
  SpreadsheetApp.getUi().alert('Готово!\n\n• Меню «📊 Статистика» — отчёт по таблице.\n' +
    '• Когда в «Пуши» или «Баннеры» вписывают текст RU, я ищу его в архиве и подставляю готовые переводы в ПУСТЫЕ ячейки нужных языков ' +
    '(зелёные — тот же текст или другие эмодзи, жёлтые — другие цифры или знаки, проверить). Откуда взят перевод — в заметке.\n' +
    '• Ничего уже заполненного я не меняю.');
}

function zsOnOpen() {
  SpreadsheetApp.getUi().createMenu('📊 Статистика')
    .addItem('Открыть отчёт', 'zsShow')
    .addItem('Пересчитать заново', 'zsShowFresh')
    .addSeparator()
    .addItem('📥 Загрузить переводы от подрядчика (xliff)…', 'zsShowUpload')
    .addItem('♻️ Проверить выделенные строки по архиву', 'zsCheckSelected')
    .addToUi();
}

function zsShow() { zsOpen_(); }
function zsShowFresh() { zsBump_(); zsOpen_(); }

// Метка свежести: меняется — и все сохранённые подсчёты считаются устаревшими.
function zsStamp_() { return zsProps_().getProperty('zs_fresh') || '0'; }
function zsBump_() { zsProps_().setProperty('zs_fresh', String(Date.now())); }

function zsOpen_() {
  const html = HtmlService.createHtmlOutputFromFile('StatsReport').setWidth(1180).setHeight(820);
  SpreadsheetApp.getUi().showModalDialog(html, '📊 Переводы маркетинга — статистика');
}

/* ---------- данные для страницы ---------- */

// from, to — 'ГГГГ-ММ-ДД' включительно. Без них — текущий месяц.
function zsGetData(from, to) {
  const per = zsPeriod_(from, to);
  const key = 'zs_stats_' + zsStamp_() + '_' + per.from + '_' + per.to;
  const cache = zsCache_();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = zsBuild_(per.from, per.to);
  try { cache.put(key, JSON.stringify(out), ZS_CFG.CACHE_MIN * 60); } catch (e) { /* больше 100 КБ — без кэша */ }
  return out;
}

function zsPeriod_(from, to) {
  const ok = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); };
  if (ok(from) && ok(to)) return from <= to ? { from: from, to: to } : { from: to, to: from };
  const tz = zsSS_().getSpreadsheetTimeZone(), now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1), last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: Utilities.formatDate(first, tz, 'yyyy-MM-dd'), to: Utilities.formatDate(last, tz, 'yyyy-MM-dd') };
}

function zsSheet_(prefix) {
  const list = zsSS_().getSheets();
  for (let i = 0; i < list.length; i++) if (list[i].getName().indexOf(prefix) === 0) return list[i];
  return null;
}

function zs_s(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function zs_langs(v) {
  const t = zs_s(v).toLowerCase();
  if (!t) return [];
  if (/(^|[^а-яё])вс[еёи]([^а-яё]|$)/.test(t)) return ZS_CFG.ALL6.slice();
  const out = [];
  Object.keys(ZS_CFG.NAMES).forEach(function (k) { if (t.indexOf(k) !== -1) out.push(ZS_CFG.NAMES[k]); });
  ZS_CFG.LANGS.forEach(function (c) { if (new RegExp('(^|[^a-z])' + c.toLowerCase() + '([^a-z]|$)').test(t)) out.push(c); });
  return ZS_CFG.LANGS.filter(function (c) { return out.indexOf(c) !== -1; });
}

function zs_product(v) {
  const t = zs_s(v).replace(/\s+/g, ' ');
  for (let i = 0; i < ZS_CFG.PRODUCTS.length; i++) if (t.toLowerCase() === ZS_CFG.PRODUCTS[i].toLowerCase()) return ZS_CFG.PRODUCTS[i];
  return t || 'не указан';
}

function zs_sample(tr) {
  return tr.some(function (x) { return /^\s*текст\s*(пуша\s*)?на\s*\S+|^\s*текстна/i.test(zs_s(x)); });
}

// Нормализация, как в основной таблице: регистр, ё/е, пробелы, эмодзи, знаки, цифры.
const ZS_EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
function zs_k1(t) { return String(t).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function zs_k2(t) { return zs_k1(String(t).replace(ZS_EMO, ' ')).replace(/[^\p{L}\p{N}%]+/gu, ' ').trim(); }
function zs_k3(t) { return zs_k2(t).replace(/\d+/g, '#'); }
function zs_emos(t) { return (String(t).match(ZS_EMO) || []).join(''); }
function zs_words(t) { return (String(t).replace(ZS_EMO, ' ').match(/[\p{L}\p{N}%]+/gu) || []).length; }

function zs_ratio(a, b, maxShare) {
  if (a === b) return 1;
  const m = a.length, n = b.length, big = Math.max(m, n), lim = Math.ceil(big * maxShare);
  if (Math.abs(m - n) > lim) return 0;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i; let rm = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      if (cur[j] < rm) rm = cur[j];
    }
    if (rm > lim) return 0;
    const t = prev; prev = cur; cur = t;
  }
  return 1 - prev[n] / big;
}

function zs_day(d) { return Utilities.formatDate(d, zsSS_().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }

function zsReadRows_() {
  const rows = [];
  const P = zsSheet_(ZS_CFG.PUSH), B = zsSheet_(ZS_CFG.BANNER);
  if (P && P.getLastRow() > 1) {
    let last = null;
    P.getRange(2, 1, P.getLastRow() - 1, 13).getValues().forEach(function (r) {
      const ru = zs_s(r[5]);
      if (!ru || ru.toUpperCase().indexOf('ПРИМЕР') === 0) return;
      if (r[0] instanceof Date) last = { date: r[0], product: r[1], langs: r[2] };
      else if (!last) return;
      const trv = r.slice(6, 13).map(zs_s);
      if (zs_sample(trv)) return;
      const tr = {};
      ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ'].forEach(function (l, i) { if (trv[i]) tr[l] = trv[i]; });
      rows.push({ date: last.date, type: 'push', product: zs_product(r[1] || last.product), langs: zs_langs(r[2] || last.langs), ru: ru, tr: tr, btype: '' });
    });
  }
  if (B && B.getLastRow() > 1) {
    B.getRange(2, 1, B.getLastRow() - 1, 15).getValues().forEach(function (r) {
      const ru = zs_s(r[6]);
      if (!ru || !(r[0] instanceof Date)) return;
      const trv = r.slice(7, 15).map(zs_s);
      if (zs_sample(trv)) return;
      const tr = {};
      ZS_CFG.LANGS.forEach(function (l, i) { if (trv[i]) tr[l] = trv[i]; });
      rows.push({ date: r[0], type: 'banner', product: zs_product(r[1]), langs: zs_langs(r[2]), ru: ru, tr: tr, btype: zs_s(r[3]) || 'не указан' });
    });
  }
  rows.forEach(function (x) {
    if (!x.langs.length) x.langs = ZS_CFG.LANGS.filter(function (l) { return x.tr[l]; });
    x.day = zs_day(x.date);
  });
  rows.sort(function (a, b) { return a.date - b.date; });
  return rows;
}

// Средняя ставка за слово по сметам «Анализ переводов»: стоимость без НДС / слова по языкам.
function zsCostRate_() {
  const A = zsSheet_(ZS_CFG.COST);
  let cost = 0, words = 0, orders = 0;
  if (A && A.getLastRow() > 1) {
    A.getRange(2, 1, A.getLastRow() - 1, 12).getValues().forEach(function (r) {
      if (!zs_s(r[0])) return;
      orders++;
      let w = 0;
      for (let i = 2; i <= 6; i++) { const v = Number(String(r[i]).replace(',', '.')); if (v > 0) w += v; }
      const c = Number(String(r[9]).replace(',', '.'));
      if (w > 0 && c > 0) { cost += c; words += w; }
    });
  }
  return { rate: words ? Math.round(cost / words * 100) / 100 : 0, cost: Math.round(cost), words: Math.round(words), orders: orders };
}

// Вся история с отметкой повторов (повтор считается относительно всех более ранних дней).
function zsAnalyze_() {
  const rows = zsReadRows_();
  const LEVEL = ['exact', 'emoji', 'punct', 'num', 'fuzzy'];
  const idx = { k1: {}, k2: {}, k3: {} };
  const tz = zsSS_().getSpreadsheetTimeZone();
  const fmtD = function (d) { return Utilities.formatDate(d, tz, 'dd.MM.yyyy'); };

  rows.forEach(function (x, i) {
    x.k1 = zs_k1(x.ru); x.k2 = zs_k2(x.ru); x.k3 = zs_k3(x.ru); x.w = zs_words(x.ru);
    x.wset = x.k2.split(' ').filter(function (w) { return w.length >= 3; });
    const cands = [];
    const usable = function (y) { return y.day < x.day && x.langs.some(function (l) { return y.tr[l]; }); };
    (idx.k1[x.k1] || []).forEach(function (y) { if (usable(y)) cands.push([y, 'exact']); });
    (idx.k2[x.k2] || []).forEach(function (y) {
      if (y.k1 === x.k1 || !usable(y)) return;
      const lvl = zs_emos(y.ru) !== zs_emos(x.ru) && zs_k1(y.ru.replace(ZS_EMO, '')) === zs_k1(x.ru.replace(ZS_EMO, '')) ? 'emoji' : 'punct';
      cands.push([y, lvl]);
    });
    (idx.k3[x.k3] || []).forEach(function (y) { if (y.k2 !== x.k2 && usable(y)) cands.push([y, 'num']); });
    if (!cands.length && x.k2.length > 8 && x.wset.length) {
      const need = Math.max(1, Math.ceil(x.wset.length * 0.6));
      for (let j = 0; j < i; j++) {
        const y = rows[j];
        if (!usable(y) || Math.abs(y.k2.length - x.k2.length) > 0.1 * x.k2.length) continue;
        let common = 0;
        for (let w = 0; w < x.wset.length; w++) if (y.wset.indexOf(x.wset[w]) !== -1) common++;
        if (common < need) continue;
        if (zs_ratio(y.k2, x.k2, 1 - ZS_CFG.FUZZY) >= ZS_CFG.FUZZY) { cands.push([y, 'fuzzy']); break; }
      }
    }
    if (cands.length) {
      cands.sort(function (a, b) { return LEVEL.indexOf(a[1]) - LEVEL.indexOf(b[1]) || b[0].date - a[0].date; });
      const y = cands[0][0];
      x.rep = { level: cands[0][1], prev: y.date, prev_ru: y.ru, covered: x.langs.filter(function (l) { return y.tr[l]; }) };
    }
    ['k1', 'k2', 'k3'].forEach(function (k) { (idx[k][x[k]] = idx[k][x[k]] || []).push(x); });
  });

  return rows;
}

function zsBuild_(from, to) {
  const all = zsAnalyze_();
  if (!all.length) return { empty: true };
  const LEVEL = ['exact', 'emoji', 'punct', 'num', 'fuzzy'];
  const tz = zsSS_().getSpreadsheetTimeZone();
  const fmtD = function (d) { return Utilities.formatDate(d, tz, 'dd.MM.yyyy'); };
  const f = function (d) { return d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4); };
  const rows = all.filter(function (x) { return x.day >= from && x.day <= to; });
  // шаг графика: до двух месяцев — по дням, дольше — по месяцам
  const span = (new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 864e5 + 1;
  const step = span <= 62 ? 'day' : 'month';
  const months = {};
  if (step === 'day') {
    for (let d = new Date(from + 'T12:00:00'); Utilities.formatDate(d, tz, 'yyyy-MM-dd') <= to; d.setDate(d.getDate() + 1))
      months[Utilities.formatDate(d, tz, 'yyyy-MM-dd')] = { push: 0, banner: 0, words: 0, rep: 0, rep_words: 0 };
  }
  const lang = {}, prod = {}, btype = {}, levels = {}, lvlWords = {};
  let allWords = 0, repCount = 0, repWords = 0, push = 0, banner = 0;
  rows.forEach(function (x) {
    const mk = step === 'day' ? x.day : x.day.slice(0, 7);
    const m = months[mk] = months[mk] || { push: 0, banner: 0, words: 0, rep: 0, rep_words: 0 };
    m[x.type]++; if (x.type === 'push') push++; else banner++;
    m.words += x.w * x.langs.length; allWords += x.w * x.langs.length;
    x.langs.forEach(function (l) { lang[l] = (lang[l] || 0) + 1; });
    prod[x.product] = (prod[x.product] || 0) + 1;
    if (x.type === 'banner') btype[x.btype] = (btype[x.btype] || 0) + 1;
    if (x.rep) {
      const lw = x.w * x.rep.covered.length;
      levels[x.rep.level] = (levels[x.rep.level] || 0) + 1;
      lvlWords[x.rep.level] = (lvlWords[x.rep.level] || 0) + lw;
      if (x.rep.level !== 'fuzzy') { repCount++; repWords += lw; m.rep++; m.rep_words += lw; }
    }
  });

  // чаще всего заказывали заново: тексты периода, которые заказывали в разные дни (за всю историю)
  const inPeriod = {};
  rows.forEach(function (x) { inPeriod[x.k2] = true; });
  const grp = {};
  all.forEach(function (x) { if (inPeriod[x.k2]) (grp[x.k2] = grp[x.k2] || []).push(x); });
  const top = Object.keys(grp).map(function (k) {
    const g = grp[k], days = {};
    g.forEach(function (x) { days[x.day] = true; });
    const ds = Object.keys(days).sort();
    const langsU = {};
    g.forEach(function (x) { x.langs.forEach(function (l) { langsU[l] = true; }); });
    return { g: g, n: ds.length, w: g.reduce(function (s, x) { return s + x.w; }, 0), first: ds[0], last: ds[ds.length - 1],
      langs: ZS_CFG.LANGS.filter(function (l) { return langsU[l]; }) };
  }).filter(function (t) { return t.n > 1; }).sort(function (a, b) { return b.n - a.n || b.w - a.w; }).slice(0, 12).map(function (t) {
    return { ru: t.g[t.g.length - 1].ru.slice(0, 140), times: t.n, first: f(t.first), last: f(t.last), langs: t.langs };
  });

  const examples = [];
  LEVEL.forEach(function (lvl) {
    rows.filter(function (x) { return x.rep && x.rep.level === lvl; }).slice(-2).forEach(function (x) {
      examples.push({ level: lvl, ru: x.ru.slice(0, 140), date: fmtD(x.date), prev_ru: x.rep.prev_ru.slice(0, 140), prev: fmtD(x.rep.prev), langs: x.rep.covered });
    });
  });

  const sortObj = function (o) { const r = {}; Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).forEach(function (k) { r[k] = o[k]; }); return r; };
  const mo = {}; Object.keys(months).sort().forEach(function (k) { mo[k] = months[k]; });
  const cr = zsCostRate_();
  return {
    generated: Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm'),
    range: [f(from), f(to)], period: { from: from, to: to }, step: step,
    data_range: [all[0].day, all[all.length - 1].day],
    total: rows.length, push: push, banner: banner, all_words: allWords,
    rep_count: repCount, rep_words: repWords, fuzzy_count: levels.fuzzy || 0, lvl_words: lvlWords, rate: cr.rate,
    levels: levels, months: mo, lang: sortObj(lang), prod: sortObj(prod), btype: sortObj(btype),
    top: top, examples: examples, paid: { cost: cr.cost, words: cr.words, orders: cr.orders },
  };
}


/* ============================================================================
 * ♻️ Подстановка из архива, когда заказчик вписывает текст
 * Пишет ТОЛЬКО в пустые ячейки переводов той строки, где вписали текст RU или языки.
 * ========================================================================== */

const ZS_FILL = { GREEN: '#d9f2e3', YELLOW: '#fff1c9', MAX_ROWS: 60 };
const ZS_LEVEL_WORDS = { exact: 'тот же текст', emoji: 'отличаются только эмодзи', punct: 'отличаются знаки — проверь', num: 'отличаются цифры — проверь число' };

// Раскладка листов старой таблицы (номера колонок с 1).
function zsLayout_(sh) {
  const n = sh.getName();
  if (n.indexOf(ZS_CFG.PUSH) === 0) return { kind: 'пуш', date: 1, langs: 3, ru: 6, tr: { KK: 7, KY: 8, UZ: 9, HY: 10, TG: 11, KA: 12, AZ: 13 }, width: 13 };
  if (n.indexOf(ZS_CFG.BANNER) === 0) return { kind: 'баннер', date: 1, langs: 3, ru: 7, tr: { KK: 8, KY: 9, UZ: 10, HY: 11, TG: 12, KA: 13, AZ: 14, EN: 15 }, width: 15 };
  return null;
}

function zsEmojiList_(s) { return String(s || '').match(/(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}][\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]*)+/gu) || []; }
function zsNumbers_(s) { return String(s || '').match(/\d+(?:[ .,]\d+)*/g) || []; }

// Переносит эмодзи нового текста в старый перевод: старые эмодзи по порядку меняются на новые.
function zsSwapEmoji_(oldSrc, newSrc, tr) {
  const a = zsEmojiList_(oldSrc), b = zsEmojiList_(newSrc);
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
function zsSwapNumbers_(oldSrc, newSrc, tr) {
  const a = zsNumbers_(oldSrc), b = zsNumbers_(newSrc);
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



// Архив: все строки пушей и баннеров с переводами + «Репозиторий». skip — строки, которые сейчас проверяем.
function zsArchive_(skip) {
  const list = [];
  const tz = zsSS_().getSpreadsheetTimeZone();
  [zsSheet_(ZS_CFG.PUSH), zsSheet_(ZS_CFG.BANNER)].forEach(function (sh) {
    if (!sh || sh.getLastRow() < 2) return;
    const L = zsLayout_(sh);
    let lastDate = null;
    sh.getRange(2, 1, sh.getLastRow() - 1, L.width).getValues().forEach(function (r, i) {
      if (r[L.date - 1] instanceof Date) lastDate = r[L.date - 1];
      if (skip && skip[sh.getName() + '#' + (i + 2)]) return;
      const ru = zs_s(r[L.ru - 1]);
      if (!ru || ru.toUpperCase().indexOf('ПРИМЕР') === 0) return;
      const tr = {};
      Object.keys(L.tr).forEach(function (l) { const v = zs_s(r[L.tr[l] - 1]); if (v) tr[l] = v; });
      if (!Object.keys(tr).length || zs_sample(Object.keys(tr).map(function (k) { return tr[k]; }))) return;
      list.push({ src: L.kind + (lastDate ? ' от ' + Utilities.formatDate(lastDate, tz, 'dd.MM.yyyy') : '') + ' (строка ' + (i + 2) + ')', ru: ru, tr: tr, t: lastDate ? lastDate.getTime() : 0 });
    });
  });
  const R = zsSheet_('Репозиторий');
  if (R && R.getLastRow() > 1) {
    let file = '';
    R.getRange(2, 1, R.getLastRow() - 1, 9).getValues().forEach(function (r) {
      if (zs_s(r[0])) file = zs_s(r[0]);
      const ru = zs_s(r[1]);
      if (!ru) return;
      const tr = {};
      ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ'].forEach(function (l, j) { const v = zs_s(r[2 + j]); if (v) tr[l] = v; });
      if (Object.keys(tr).length) list.push({ src: 'репозиторий' + (file ? ': ' + file.slice(0, 40) : ''), ru: ru, tr: tr, t: 0 });
    });
  }
  // свежие — первыми: при равном совпадении берём последний перевод
  list.sort(function (a, b) { return b.t - a.t; });
  const idx = { k1: {}, k2: {}, k3: {} };
  list.forEach(function (x) {
    x.k1 = zs_k1(x.ru); x.k2 = zs_k2(x.ru); x.k3 = zs_k3(x.ru);
    ['k1', 'k2', 'k3'].forEach(function (k) { (idx[k][x[k]] = idx[k][x[k]] || []).push(x); });
  });
  list.idx = idx;
  return list;
}

function zsFind_(ru, langs, arc) {
  const k1 = zs_k1(ru), k2 = zs_k2(ru), k3 = zs_k3(ru);
  const rank = { exact: 0, emoji: 1, punct: 2, num: 3 };
  const per = {};
  const take = function (x, level) {
    langs.forEach(function (l) {
      if (!x.tr[l] || (per[l] && rank[per[l].level] <= rank[level])) return;
      let text = x.tr[l];
      if (level === 'emoji' || level === 'punct') text = zsSwapEmoji_(x.ru, ru, text);
      if (level === 'num') { const sw = zsSwapNumbers_(x.ru, ru, zsSwapEmoji_(x.ru, ru, text)); if (sw === null) return; text = sw; }
      per[l] = { level: level, text: text, src: x.src, ru: x.ru };
    });
  };
  (arc.idx.k1[k1] || []).forEach(function (x) { take(x, 'exact'); });
  (arc.idx.k2[k2] || []).forEach(function (x) {
    if (x.k1 === k1) return;
    take(x, zs_emos(x.ru) !== zs_emos(ru) && zs_k1(x.ru.replace(ZS_EMO, '')) === zs_k1(ru.replace(ZS_EMO, '')) ? 'emoji' : 'punct');
  });
  (arc.idx.k3[k3] || []).forEach(function (x) { if (x.k2 !== k2) take(x, 'num'); });
  let fuzzy = null;
  if (!Object.keys(per).length && k2.length > 8) {
    const words = k2.split(' ').filter(function (w) { return w.length >= 3; });
    const need = Math.max(1, Math.ceil(words.length * 0.6));
    for (let i = 0; i < arc.length && !fuzzy; i++) {
      const x = arc[i];
      if (Math.abs(x.k2.length - k2.length) > 0.1 * k2.length) continue;
      if (!x.ws) x.ws = x.k2.split(' ').filter(function (w) { return w.length >= 3; });
      let common = 0;
      for (let w = 0; w < words.length; w++) if (x.ws.indexOf(words[w]) !== -1) common++;
      if (common < need) continue;
      const r = zs_ratio(x.k2, k2, 1 - ZS_CFG.FUZZY);
      if (r >= ZS_CFG.FUZZY) fuzzy = { src: x.src, ru: x.ru, score: Math.round(r * 100) };
    }
  }
  return { per: per, fuzzy: fuzzy };
}

// Языки строки: свои или от строки с датой выше (в старой таблице так продолжают запрос).
function zsRowLangs_(sh, L, row, own) {
  if (zs_s(own)) return zs_langs(own);
  const from = Math.max(2, row - 40);
  const vals = sh.getRange(from, 1, row - from + 1, L.langs).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (zs_s(vals[i][L.langs - 1])) return zs_langs(vals[i][L.langs - 1]);
    if (vals[i][L.date - 1] instanceof Date) break;
  }
  return [];
}

function zsCheckRows_(sh, rows) {
  const L = zsLayout_(sh);
  if (!L) return { rows: 0, filled: 0, check: 0, fuzzy: 0 };
  const skip = {};
  rows.forEach(function (r) { skip[sh.getName() + '#' + r] = true; });
  const arc = zsArchive_(skip);
  const res = { rows: 0, filled: 0, check: 0, fuzzy: 0 };
  rows.forEach(function (rn) {
    const rng = sh.getRange(rn, 1, 1, L.width);
    const v = rng.getValues()[0];
    const ru = zs_s(v[L.ru - 1]);
    if (!ru || ru.toUpperCase().indexOf('ПРИМЕР') === 0) return;
    const want = zsRowLangs_(sh, L, rn, v[L.langs - 1]).filter(function (l) { return L.tr[l]; });
    if (!want.length) return;
    res.rows++;
    const found = zsFind_(ru, want, arc);
    const filled = [], check = [], missing = [];
    let first = null;
    want.forEach(function (l) {
      const col = L.tr[l];
      if (zs_s(v[col - 1])) return;                 // уже есть перевод — не трогаем
      const p = found.per[l];
      if (!p) { missing.push(l); return; }
      const warn = p.level === 'num' || p.level === 'punct';
      const cell = sh.getRange(rn, col);
      cell.setValue(p.text).setBackground(warn ? ZS_FILL.YELLOW : ZS_FILL.GREEN)
        .setNote('♻️ Из архива (' + p.src + '): ' + ZS_LEVEL_WORDS[p.level] + '\nИсходник там: ' + p.ru);
      (warn ? check : filled).push(l);
      if (!first || (warn && first.level !== 'num')) first = p;
    });
    res.filled += filled.length + check.length;
    res.check += check.length;
    // Заметка на тексте RU — только если там нет чужой заметки.
    const ruCell = sh.getRange(rn, L.ru);
    const oldNote = ruCell.getNote();
    if (oldNote && !/^(♻️|🔎)/.test(oldNote)) return;
    let note = '';
    if (first) {
      note = '♻️ Уже переводили: ' + first.src + ' · ' + ZS_LEVEL_WORDS[first.level] + '\nПодставлено: ' + filled.concat(check).join(', ');
      if (check.length) note += '\nПроверить: ' + check.join(', ');
      if (missing.length) note += '\nНет в архиве: ' + missing.join(', ');
    } else if (found.fuzzy) {
      note = '🔎 Похоже на ' + found.fuzzy.src + ' (' + found.fuzzy.score + '%):\n«' + found.fuzzy.ru.slice(0, 160) + '»\nПроверьте — может, перевод можно взять оттуда.';
      res.fuzzy++;
    }
    if (note !== oldNote) ruCell.setNote(note);
  });
  if (res.filled || res.fuzzy) zsBump_();
  return res;
}

// Триггер на правку: реагируем только на текст RU и колонку языков в листах пушей и баннеров.
function zsOnEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), L = zsLayout_(sh);
  if (!L || e.range.getLastRow() < 2) return;
  const c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
  const hits = function (c) { return c >= c1 && c <= c2; };
  if (!hits(L.ru) && !hits(L.langs)) return;
  const rows = [];
  for (let r = Math.max(2, e.range.getRow()); r <= e.range.getLastRow() && rows.length < ZS_FILL.MAX_ROWS; r++) rows.push(r);
  const lock = zsLock_();
  if (!lock.tryLock(15000)) return;
  try { zsCheckRows_(sh, rows); } finally { lock.releaseLock(); }
}

// Меню: проверить выделенные строки вручную.
function zsCheckSelected() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!zsLayout_(sh)) { SpreadsheetApp.getUi().alert('Откройте лист «Заказы на перевод пушей» или «…баннеров» и выделите строки.'); return; }
  const rows = [];
  sh.getActiveRangeList().getRanges().forEach(function (r) {
    for (let i = Math.max(2, r.getRow()); i <= r.getLastRow() && rows.length < 300; i++) if (rows.indexOf(i) === -1) rows.push(i);
  });
  const res = zsCheckRows_(sh, rows);
  zsSS_().toast('Проверено строк: ' + res.rows + '. Подставлено переводов: ' + res.filled + (res.check ? ' (проверить: ' + res.check + ')' : '') +
    (res.fuzzy ? '. Похожих подсказок: ' + res.fuzzy : '') + '. Заполненные ячейки не трогала.', '♻️ Архив', 8);
}


/* ============================================================================
 * ⬇️ Выгрузка статистики за период — в НОВУЮ отдельную Google Таблицу (рабочая таблица не меняется)
 * ========================================================================== */
function zsExport(from, to) {
  const per = zsPeriod_(from, to);
  const d = zsBuild_(per.from, per.to);
  if (d.empty) throw new Error('Нет данных');
  const all = zsAnalyze_().filter(function (x) { return x.day >= per.from && x.day <= per.to; });
  const tz = zsSS_().getSpreadsheetTimeZone();
  const LN = { KK: 'Казахский', KY: 'Кыргызский', UZ: 'Узбекский', HY: 'Армянский', TG: 'Таджикский', KA: 'Грузинский', AZ: 'Азербайджанский', EN: 'Английский' };
  const LV = { exact: 'тот же текст', emoji: 'только эмодзи', punct: 'знаки', num: 'цифры', fuzzy: 'похоже 90%+' };
  const out = SpreadsheetApp.create('Статистика переводов ' + d.range[0] + '–' + d.range[1]);
  const put = function (name, rows, widths) {
    let sh = out.getSheets()[0];
    if (sh.getName() !== 'Лист1' && sh.getName() !== 'Sheet1' || sh.getLastRow() > 0) sh = out.insertSheet(name); else sh.setName(name);
    if (!rows.length) return;
    sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#2e2566').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    (widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  };
  const saved = Math.round(d.rep_words * d.rate);
  put('Итоги', [
    ['Показатель', 'Значение'],
    ['Период', d.range[0] + ' – ' + d.range[1]],
    ['Запросов', d.total], ['Пуши', d.push], ['Баннеры', d.banner],
    ['Слов к переводу (слова × языки)', d.all_words],
    ['Заказали повторно (уже переводили)', d.rep_count],
    ['Слов в повторах', d.rep_words],
    ['Ставка за слово, ₽ (без НДС, по сметам)', d.rate],
    ['Можно было не платить, ₽ (оценка)', saved],
    ['Похожих на 90%+ (не в сумме)', d.fuzzy_count],
    ['Выгружено', Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm')],
  ], [320, 200]);
  const tbl = function (o, h, label) { return [h].concat(Object.keys(o).map(function (k) { return [label ? label(k) : k, o[k]]; })); };
  put('Языки', tbl(d.lang, ['Язык', 'Запросов'], function (k) { return LN[k] || k; }), [200, 120]);
  put('Продукты', tbl(d.prod, ['Продукт', 'Запросов']), [200, 120]);
  if (Object.keys(d.btype).length) put('Типы баннеров', tbl(d.btype, ['Тип баннера', 'Запросов']), [200, 120]);
  put(d.step === 'day' ? 'По дням' : 'По месяцам', [[d.step === 'day' ? 'День' : 'Месяц', 'Пуши', 'Баннеры', 'Слов к переводу', 'Повторов', 'Слов в повторах']].concat(
    Object.keys(d.months).map(function (k) { const m = d.months[k]; return [k, m.push, m.banner, m.words, m.rep, m.rep_words]; })), [120, 80, 80, 140, 100, 140]);
  put('Повторы', [['Дата', 'Тип', 'Текст RU', 'Совпадение', 'Уже было', 'Текст тогда', 'Можно было взять']].concat(
    all.filter(function (x) { return x.rep; }).map(function (x) {
      return [x.date, x.type === 'push' ? 'пуш' : 'баннер', x.ru, LV[x.rep.level], x.rep.prev, x.rep.prev_ru, x.rep.covered.join(', ')];
    })), [100, 70, 360, 120, 100, 360, 160]);
  put('Все запросы', [['Дата', 'Тип', 'Продукт', 'Языки', 'Текст RU', 'Слов', 'Повтор']].concat(
    all.map(function (x) { return [x.date, x.type === 'push' ? 'пуш' : 'баннер', x.product, x.langs.join(', '), x.ru, x.w, x.rep ? LV[x.rep.level] : '']; })),
    [100, 70, 120, 200, 420, 60, 120]);
  return { url: out.getUrl(), name: out.getName() };
}


/* ============================================================================
 * 📥 Переводы от подрядчика (.xliff) → в строки заказчиков
 * Пишет только в ПУСТЫЕ ячейки языков, которые в этой строке заказывали.
 * Незаказанные языки не трогает (их красит существующий скрипт таблицы, как и раньше).
 * ========================================================================== */
function zsShowUpload() {
  const html = HtmlService.createHtmlOutputFromFile('ZsUpload').setWidth(780).setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Загрузить переводы от подрядчика');
}

const ZS_XLANG = { kk: 'KK', ky: 'KY', uz: 'UZ', hy: 'HY', tg: 'TG', ka: 'KA', az: 'AZ', en: 'EN' };

// units: [{file, lang: 'az-Latn', src, tgt}]. apply=false — только показать, что куда попадёт.
function zsImport(units, apply) {
  const lock = zsLock_();
  if (apply && !lock.tryLock(20000)) throw new Error('Таблица занята, попробуйте ещё раз');
  try {
    const tabs = [zsSheet_(ZS_CFG.PUSH), zsSheet_(ZS_CFG.BANNER)].filter(Boolean).map(function (sh) {
      const L = zsLayout_(sh), n = Math.max(sh.getLastRow() - 1, 0);
      const vals = n ? sh.getRange(2, 1, n, L.width).getValues() : [];
      const t = { sh: sh, L: L, vals: vals, k1: {}, k2: {}, langs: [] };
      let lastLangs = '';
      vals.forEach(function (r, i) {
        if (zs_s(r[L.langs - 1])) lastLangs = r[L.langs - 1];
        else if (r[L.date - 1] instanceof Date) lastLangs = '';
        t.langs[i] = zs_langs(zs_s(r[L.langs - 1]) || lastLangs);
        const ru = zs_s(r[L.ru - 1]);
        if (!ru || ru.toUpperCase().indexOf('ПРИМЕР') === 0) return;
        (t.k1[zs_k1(ru)] = t.k1[zs_k1(ru)] || []).push(i);
        (t.k2[zs_k2(ru)] = t.k2[zs_k2(ru)] || []).push(i);
      });
      return t;
    });
    const seen = {}, report = [];
    (units || []).forEach(function (u) {
      const lang = ZS_XLANG[String(u.lang || '').toLowerCase().split(/[-_]/)[0]];
      const key = lang + '|' + zs_k1(u.src) + '|' + zs_s(u.tgt);
      if (seen[key]) return;                      // повтор внутри файла — один раз
      seen[key] = true;
      const item = { lang: lang || u.lang, src: u.src, tgt: u.tgt, file: u.file };
      if (!lang) { item.status = 'язык не распознан'; report.push(item); return; }
      const kind = /^banner/i.test(u.file) ? 'баннер' : /^push/i.test(u.file) ? 'пуш' : '';
      const order = tabs.slice().sort(function (a, b) { return (b.L.kind === kind) - (a.L.kind === kind); });
      let t = null, cand = [];
      for (let k = 0; k < order.length && !cand.length; k++) {
        t = order[k];
        if (!t.L.tr[lang]) continue;
        cand = t.k1[zs_k1(u.src)] || t.k2[zs_k2(u.src)] || [];
      }
      if (!cand.length) { item.status = 'нет в таблице'; report.push(item); return; }
      const col = t.L.tr[lang];
      const ordered = cand.filter(function (i) { return t.langs[i].indexOf(lang) !== -1; });
      if (!ordered.length) {
        item.status = 'язык не заказывали'; item.row = cand[cand.length - 1] + 2; item.sheet = t.L.kind; report.push(item); return;
      }
      // самая свежая строка (новые внизу), где этот язык ещё пуст; иначе самая свежая
      const empty = ordered.filter(function (i) { return !zs_s(t.vals[i][col - 1]); });
      const i = (empty.length ? empty : ordered).slice(-1)[0];
      item.row = i + 2; item.sheet = t.L.kind;
      const cur = zs_s(t.vals[i][col - 1]);
      if (cur && cur !== zs_s(u.tgt)) item.status = 'другой перевод';
      else if (cur) item.status = 'уже есть';
      else item.status = 'вставлю';
      if (apply && item.status === 'вставлю') {
        t.sh.getRange(i + 2, col).setValue(u.tgt).setBackground(null);   // снимаем подсветку «нет перевода»
        t.vals[i][col - 1] = u.tgt;
        item.status = 'вставлено';
      }
      report.push(item);
    });
    if (apply) zsBump_();
    return report;
  } finally {
    if (apply) lock.releaseLock();
  }
}
