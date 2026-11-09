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
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'zsOnOpen') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('zsOnOpen').forSpreadsheet(ss).onOpen().create();
  zsOnOpen();
  SpreadsheetApp.getUi().alert('Готово! Меню «📊 Статистика» появилось сверху. Отчёт строится из листов пушей и баннеров — таблица не меняется.');
}

function zsOnOpen() {
  SpreadsheetApp.getUi().createMenu('📊 Статистика')
    .addItem('Открыть отчёт', 'zsShow')
    .addItem('Пересчитать заново', 'zsShowFresh')
    .addToUi();
}

function zsShow() { zsOpen_(); }
function zsShowFresh() { CacheService.getDocumentCache().remove('zs_stats'); zsOpen_(); }

function zsOpen_() {
  const html = HtmlService.createHtmlOutputFromFile('StatsReport').setWidth(1180).setHeight(820);
  SpreadsheetApp.getUi().showModalDialog(html, '📊 Переводы маркетинга — статистика');
}

/* ---------- данные для страницы ---------- */

function zsGetData() {
  const cache = CacheService.getDocumentCache();
  const hit = cache.get('zs_stats');
  if (hit) return JSON.parse(hit);
  const out = zsBuild_();
  try { cache.put('zs_stats', JSON.stringify(out), ZS_CFG.CACHE_MIN * 60); } catch (e) { /* больше 100 КБ — без кэша */ }
  return out;
}

function zsSheet_(prefix) {
  const list = SpreadsheetApp.getActive().getSheets();
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

function zs_day(d) { return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }

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

function zsBuild_() {
  const rows = zsReadRows_();
  if (!rows.length) return { empty: true };
  const LEVEL = ['exact', 'emoji', 'punct', 'num', 'fuzzy'];
  const idx = { k1: {}, k2: {}, k3: {} };
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
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

  const months = {}, lang = {}, prod = {}, btype = {}, levels = {}, lvlWords = {};
  let allWords = 0, repCount = 0, repWords = 0, push = 0, banner = 0;
  rows.forEach(function (x) {
    const mk = x.day.slice(0, 7);
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

  // чаще всего заказывали заново: один и тот же текст в разные дни
  const grp = {};
  rows.forEach(function (x) { (grp[x.k2] = grp[x.k2] || []).push(x); });
  const top = Object.keys(grp).map(function (k) {
    const g = grp[k], days = {};
    g.forEach(function (x) { days[x.day] = true; });
    const ds = Object.keys(days).sort();
    const langsU = {};
    g.forEach(function (x) { x.langs.forEach(function (l) { langsU[l] = true; }); });
    return { g: g, n: ds.length, w: g.reduce(function (s, x) { return s + x.w; }, 0), first: ds[0], last: ds[ds.length - 1],
      langs: ZS_CFG.LANGS.filter(function (l) { return langsU[l]; }) };
  }).filter(function (t) { return t.n > 1; }).sort(function (a, b) { return b.n - a.n || b.w - a.w; }).slice(0, 12).map(function (t) {
    const f = function (d) { return d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4); };
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
    range: [fmtD(rows[0].date), fmtD(rows[rows.length - 1].date)],
    total: rows.length, push: push, banner: banner, all_words: allWords,
    rep_count: repCount, rep_words: repWords, fuzzy_count: levels.fuzzy || 0, lvl_words: lvlWords, rate: cr.rate,
    levels: levels, months: mo, lang: sortObj(lang), prod: sortObj(prod), btype: sortObj(btype),
    top: top, examples: examples, paid: { cost: cr.cost, words: cr.words, orders: cr.orders },
  };
}
