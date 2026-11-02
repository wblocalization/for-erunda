/* ---------- данные для сайта-глоссария ----------
 * Добавьте этот файл в проект скрипта таблицы на все языки (рядом с кодом глоссария).
 * Сайт раз в час забирает отсюда термины. Без ключа таблица ничего не отдаёт.
 */
const SITE = {
  TOKEN_PROP: 'SITE_TOKEN',
  // Ссылка на Termbase — показывается на сайте в «Как это работает». Можно оставить пустой.
  TERMBASE_URL: '',
};

// Меню «Глоссарий → Ключ для сайта»: создаёт ключ (один раз) и показывает его.
function siteToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(SITE.TOKEN_PROP);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(SITE.TOKEN_PROP, token);
  }
  SpreadsheetApp.getUi().alert('Ключ для сайта — вставьте его в GitHub как секрет TERMBASE_TOKEN:\n\n' + token);
}

// Сайт приходит сюда за терминами: …/exec?token=<ключ>.
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty(SITE.TOKEN_PROP);
  const ok = token && e && e.parameter && e.parameter.token === token;
  return ContentService.createTextOutput(JSON.stringify(ok ? siteData_() : { error: 'нет доступа' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function siteData_() {
  const t = readApproved_();
  const col = function (h) { return t.head.indexOf(h); };
  const pick = function (r, h) { return col(h) === -1 ? '' : String(r[col(h)]).trim(); };

  const variants = {};
  const vs = SpreadsheetApp.getActive().getSheetByName(GA.VARIANTS_TAB);
  if (vs && vs.getLastRow() >= 2) {
    vs.getRange(2, 1, vs.getLastRow() - 1, VARIANT_HEADERS.length).getDisplayValues().forEach(function (v) {
      const id = String(v[0]).trim(), lang = String(v[2]).trim().toUpperCase(), text = String(v[3]).trim();
      if (!id || !text || GA.LANGUAGES.indexOf(lang) === -1) return;
      variants[id] = variants[id] || {};
      (variants[id][lang] = variants[id][lang] || []).push({ text: text, when: String(v[4]).trim() });
    });
  }

  const ss = SpreadsheetApp.getActive();
  const base = ss.getUrl() + '#gid=' + ss.getSheetByName(GA.APPROVED_TAB).getSheetId() + '&range=';
  const langs = GA.LANGUAGES.filter(function (l) { return col(l) !== -1; });
  const terms = t.rows.map(function (r, i) { return { r: r, row: i + 2 }; })
    .filter(function (x) { return pick(x.r, 'RU'); }).map(function (x) {
    const r = x.r;
    const id = pick(r, 'ID');
    const tr = {};
    langs.forEach(function (l) { const v = pick(r, l); if (v) tr[l] = v; });
    const term = {
      id: id, ru: pick(r, 'RU'), en: pick(r, 'EN'), def: pick(r, 'Комментарий RU'),
      ex: pick(r, 'Примеры использования RU'), project: pick(r, 'Проект'), status: pick(r, 'Что пришло'), tr: tr,
      link: base + x.row + ':' + x.row,   // «поправить в таблице» — открывает строку термина
    };
    if (variants[id]) term.variants = variants[id];
    return term;
  });
  return {
    updated: Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'),
    languages: langs,
    links: { table: ss.getUrl(), termbase: SITE.TERMBASE_URL },
    terms: terms,
  };
}
