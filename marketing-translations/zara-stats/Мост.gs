/* ============================================================================
 * 🌉 Мост для расширения «Переводы Зары».
 * Это ОТДЕЛЬНЫЙ скрипт на Google Диске (не внутри таблицы Зары), поэтому её doGet,
 * загрузка через Index.html и остальной код не задеваются.
 *
 * Установка (один раз):
 *   1. script.google.com → «Новый проект» → назвать «Мост переводов Зары».
 *   2. Файлы: «Статистика» (Статистика.gs), «Мост» (этот файл), HTML «StatsReport».
 *   3. Вписать ссылку на таблицу Зары в ZS_TABLE_URL ниже → 💾 → выбрать zsBridgeSetup → «Выполнить» → разрешить доступ.
 *      В окне выполнения появится ключ для расширения.
 *   4. «Начать развёртывание» → «Новое развёртывание» → «Веб-приложение»:
 *      запуск от имени: «от моего имени», доступ: «Все» → скопировать ссылку …/exec.
 *   5. В расширении ⚙ → вставить ссылку и ключ.
 * Без ключа мост ничего не отдаёт.
 * ========================================================================== */

const ZS_TABLE_URL = '';   // ← ссылка на таблицу Зары, например https://docs.google.com/spreadsheets/d/…/edit

function zsBridgeSetup() {
  const m = String(ZS_TABLE_URL).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error('Впишите ссылку на таблицу Зары в ZS_TABLE_URL вверху файла «Мост»');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ZS_SHEET_ID', m[1]);
  let t = props.getProperty('ZS_TOKEN');
  if (!t) { t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('ZS_TOKEN', t); }
  Logger.log('Ключ для расширения:\n' + t);
  // Проверяем, что таблица открывается. Если нет — говорим почему, ключ всё равно уже сохранён.
  let ss;
  try { ss = SpreadsheetApp.openById(m[1]); }
  catch (e) {
    Logger.log('⚠️ Не открылась таблица: ' + (e && e.message || e) + '\n' +
      'Проверьте: 1) ссылка ведёт на Google Таблицу (рядом с названием нет значка .XLSX); ' +
      '2) у этого аккаунта есть доступ к таблице; 3) в браузере открыт только один Google-аккаунт (или откройте script.google.com в режиме инкогнито).');
    return;
  }
  const P = zsSheet_(ZS_CFG.PUSH), B = zsSheet_(ZS_CFG.BANNER);
  Logger.log('✅ Мост подключён к таблице «' + ss.getName() + '».\n' +
    'Пуши: ' + (P ? '«' + P.getName() + '», строк ' + P.getLastRow() : 'лист не найден') + '\n' +
    'Баннеры: ' + (B ? '«' + B.getName() + '», строк ' + B.getLastRow() : 'лист не найден'));
}

// 🩺 Проверка по шагам: запускайте zsTest, если zsBridgeSetup пишет «неизвестная ошибка».
function zsTest() {
  Logger.log('Шаг 1 ✅ скрипт запускается');
  PropertiesService.getScriptProperties().setProperty('ZS_PING', String(Date.now()));
  Logger.log('Шаг 2 ✅ настройки скрипта работают');
  const m = String(ZS_TABLE_URL).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) { Logger.log('Шаг 3 ❌ в ZS_TABLE_URL нет ссылки на таблицу'); return; }
  Logger.log('Шаг 3 ✅ ссылка распознана');
  let f;
  try { f = DriveApp.getFileById(m[1]); }
  catch (e) { Logger.log('Шаг 4 ❌ файл не найден этим аккаунтом (' + Session.getEffectiveUser().getEmail() + '): нет доступа или ссылка не та'); return; }
  Logger.log('Шаг 4 ✅ файл «' + f.getName() + '», тип: ' + f.getMimeType());
  if (f.getMimeType() !== 'application/vnd.google-apps.spreadsheet') { Logger.log('Шаг 5 ❌ это не Google Таблица, а файл Excel. Откройте его → «Файл» → «Сохранить как Google Таблицу» и возьмите новую ссылку'); return; }
  const ss = SpreadsheetApp.openById(m[1]);
  Logger.log('Шаг 5 ✅ таблица открылась, листы: ' + ss.getSheets().map(function (x) { return x.getName(); }).join(', '));
}

function zsToken_() { return PropertiesService.getScriptProperties().getProperty('ZS_TOKEN') || ''; }
function zsJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// GET: ?token=…&page=report — полный отчёт в новой вкладке; ?token=…&action=list — запросы.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!zsToken_() || p.token !== zsToken_()) return zsJson_({ error: 'нет доступа' });
  if (p.page === 'report') {
    const t = HtmlService.createTemplate(
      '<script>window.ZS_TOKEN = <?= token ?>;</script>' + HtmlService.createHtmlOutputFromFile('StatsReport').getContent());
    t.token = p.token;
    return t.evaluate().setTitle('Переводы маркетинга — статистика').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  if (p.action === 'list') return zsJson_(zsList_());
  return zsJson_({ ok: true });
}

// POST (text/plain JSON): {token, action: list | stats | search | check | import, …}
function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents); } catch (err) { return zsJson_({ error: 'плохой запрос' }); }
  if (!zsToken_() || b.token !== zsToken_()) return zsJson_({ error: 'нет доступа' });
  try {
    if (b.action === 'list') return zsJson_(zsList_());
    if (b.action === 'stats') return zsJson_(zsGetData(b.from, b.to));
    if (b.action === 'search') return zsJson_(zsSearch_(b.q));
    if (b.action === 'import') return zsJson_({ report: zsImport(b.units || [], !!b.apply) });
    if (b.action === 'check') {
      const sh = b.sheet === 'баннер' ? zsSheet_(ZS_CFG.BANNER) : zsSheet_(ZS_CFG.PUSH);
      const lock = zsLock_();
      if (!lock.tryLock(20000)) return zsJson_({ error: 'таблица занята, попробуйте ещё раз' });
      let res;
      try { res = zsCheckRows_(sh, [Number(b.row)]); } finally { lock.releaseLock(); }
      const out = zsList_();
      out.check = res;
      return zsJson_(out);
    }
    return zsJson_({ error: 'неизвестное действие' });
  } catch (err) {
    return zsJson_({ error: String(err && err.message || err) });
  }
}

// Для страницы полного отчёта, открытой по ссылке с ключом.
function zsGetDataT(token, from, to) { if (token !== zsToken_()) throw new Error('нет доступа'); return zsGetData(from, to); }
function zsExportT(token, from, to) { if (token !== zsToken_()) throw new Error('нет доступа'); return zsExport(from, to); }

/* ---------- запросы для панели ---------- */

// Последние строки пушей и баннеров: что заказали, какие языки уже переведены, какие ждут.
function zsList_() {
  const ss = zsSS_(), tz = zsTz_();
  const items = [];
  [zsSheet_(ZS_CFG.PUSH), zsSheet_(ZS_CFG.BANNER)].forEach(function (sh) {
    if (!sh || sh.getLastRow() < 2) return;
    const L = zsLayout_(sh);
    // Читаем весь лист: внизу бывают одиночные строки далеко от остальных, поэтому «последние N строк» не годятся.
    const last = sh.getLastRow(), from = 2, head = 2;
    const vals = sh.getRange(head, 1, last - head + 1, L.width).getValues();
    const notes = sh.getRange(head, L.ru, last - head + 1, 1).getNotes();
    let langs = '', date = null, product = '', btype = '';
    vals.forEach(function (r, i) {
      const row = head + i;
      if (r[L.date - 1] instanceof Date) { date = r[L.date - 1]; langs = ''; product = zs_s(r[1]); btype = L.kind === 'баннер' ? zs_s(r[3]) : ''; }
      if (zs_s(r[L.langs - 1])) langs = r[L.langs - 1];
      if (zs_s(r[1])) product = zs_s(r[1]);
      if (row < from) return;
      const ru = zs_s(r[L.ru - 1]);
      if (!ru || ru.toUpperCase().indexOf('ПРИМЕР') === 0) return;
      const want = zs_langs(langs).filter(function (l) { return L.tr[l]; });
      const tr = {};
      Object.keys(L.tr).forEach(function (l) { const v = zs_s(r[L.tr[l] - 1]); if (v) tr[l] = v; });
      const missing = want.filter(function (l) { return !tr[l]; });
      items.push({
        id: (L.kind === 'пуш' ? 'P' : 'B') + row, sheet: L.kind, row: row,
        date: date ? zs_day(date).split('-').reverse().join('.') : '', t: date ? date.getTime() : 0,
        product: product, btype: btype, langs: want, ru: ru, tr: tr, missing: missing,
        note: notes[i][0] || '',
        url: ss.getUrl() + '#gid=' + sh.getSheetId() + '&range=A' + row,
      });
    });
  });
  items.sort(function (a, b) { return a.t - b.t || (a.sheet === b.sheet ? a.row - b.row : (a.sheet < b.sheet ? -1 : 1)); });
  const recent = items.slice(-300);
  return {
    updated: Utilities.formatDate(new Date(), tz, 'dd.MM HH:mm'),
    url: ss.getUrl(),
    counts: { wait: recent.filter(function (x) { return x.missing.length; }).length, done: recent.filter(function (x) { return !x.missing.length; }).length },
    items: recent,
  };
}

/* ---------- поиск по архиву ---------- */

function zsSearch_(q) {
  q = String(q || '').trim();
  if (!q) return { per: {}, fuzzy: null, hits: [] };
  const arc = zsArchive_(null);
  const found = zsFind_(q, ZS_CFG.LANGS, arc);
  const per = {};
  Object.keys(found.per).forEach(function (l) {
    const p = found.per[l];
    per[l] = { level: p.level, words: ZS_LEVEL_WORDS[p.level], text: p.text, src: p.src, ru: p.ru };
  });
  const words = zs_k2(q).split(' ').filter(function (w) { return w.length >= 3; });
  const need = Math.max(1, Math.ceil(words.length * 0.6));
  const scored = [], seen = {};
  arc.forEach(function (x, i) {
    if (!words.length || seen[x.k1]) return;
    const n = words.filter(function (w) { return x.k2.indexOf(w) !== -1; }).length;
    if (n < need) return;
    seen[x.k1] = true;
    scored.push({ n: n, i: i, hit: { src: x.src, ru: x.ru, tr: x.tr } });
  });
  scored.sort(function (a, b) { return b.n - a.n || a.i - b.i; });
  return { per: per, fuzzy: found.fuzzy, hits: scored.slice(0, 25).map(function (x) { return x.hit; }) };
}
