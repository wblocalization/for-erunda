// Разбор брифа на перевод из сообщения в Band и работа с датами.
// Файл общий: подключается и на страницах (Band, Tracker), и в фоновом скрипте.
(function (root) {
  "use strict";

  // Названия языков, как их пишут в брифах → код. Незнакомые слова остаются как есть.
  var LANGS = [
    ["en", "Английский", /^англ/], ["ka", "Грузинский", /^груз/], ["kk", "Казахский", /^каз/],
    ["uz", "Узбекский", /^узб/], ["ky", "Киргизский", /^к[иы]рг/], ["hy", "Армянский", /^арм/],
    ["tg", "Таджикский", /^тадж/], ["az", "Азербайджанский", /^азер/], ["am", "Амхарский", /^амхар/],
    ["tr", "Турецкий", /^тур/], ["zh", "Китайский", /^кит/], ["ar", "Арабский", /^араб/],
    ["he", "Иврит", /^иврит/], ["be", "Белорусский", /^бел/], ["ru", "Русский", /^рус/],
    ["de", "Немецкий", /^нем/], ["fr", "Французский", /^франц/], ["es", "Испанский", /^исп/],
    ["mn", "Монгольский", /^монг/], ["sr", "Сербский", /^серб/], ["pl", "Польский", /^поль/]
  ];

  var MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

  // Поля брифа: ключ → как он может называться в начале строки.
  var KEYS = [
    ["languages", /^(?:языки?(?:\s+перевода)?|languages?)$/],
    ["deadline", /^(?:сроки?|дедлайн|ддл|deadline)$/],
    ["product", /^(?:продукт|проект|product)$/],
    ["context", /^(?:контекст|описание|context)$/],
    ["visual", /^(?:визуал|скрин(?:ы|шоты?)?|макеты?|visual)$/],
    ["text", /^(?:тексты?|исходник|text)$/],
    ["responsible", /^ответственны[йе](?:\s+за\s+перевод)?$/],
    ["weblate", /^(?:веблейт|weblate)$/]
  ];

  var REQUIRED = [["languages", "языки"], ["deadline", "сроки"], ["product", "продукт"], ["context", "контекст"], ["text", "текст"]];

  function keyOf(label) {
    var l = label.toLowerCase().replace(/[*_`]/g, "").trim();
    for (var i = 0; i < KEYS.length; i++) if (KEYS[i][1].test(l)) return KEYS[i][0];
    return null;
  }

  function stripBullet(line) {
    return line.replace(/^\s*(?:[*\-•–—]|\d+[.)])\s+/, "").trim();
  }

  function language(word) {
    var w = word.trim().replace(/[.;]+$/, "");
    if (!w) return null;
    var low = w.toLowerCase();
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i][2].test(low)) return { code: LANGS[i][0], name: LANGS[i][1] };
    return { code: w, name: w };
  }

  function languages(value) {
    var out = [], seen = {};
    value.split(/[,;\n]|\s+и\s+/).forEach(function (part) {
      var l = language(stripBullet(part));
      if (l && !seen[l.code]) { seen[l.code] = 1; out.push(l); }
    });
    return out;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // «до 20.11», «12.11.2026», «до 16 октября (если возможно)» → "2026-11-20". Не разобрали — null.
  function parseDate(value, now) {
    now = now || new Date();
    var v = value.toLowerCase(), d, m, y, x;
    if ((x = v.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/))) {
      d = +x[1]; m = +x[2]; y = x[3] ? +x[3] : null;
    } else if ((x = v.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/))) {
      d = +x[1]; y = x[3] ? +x[3] : null;
      for (var i = 0; i < MONTHS.length; i++) if (x[2].indexOf(MONTHS[i]) === 0 && (i !== 4 || /^ма[йя]/.test(x[2]))) m = i + 1;
      if (/^март/.test(x[2])) m = 3;
    } else if (/сегодня/.test(v)) {
      return iso(now);
    } else if (/завтра/.test(v)) {
      return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    }
    if (!d || !m || m > 12 || d > 31) return null;
    if (y !== null && y < 100) y += 2000;
    if (y === null) {
      y = now.getFullYear();
      // Год не указан: дата больше чем на полгода в прошлом — значит, речь о следующем годе.
      if (now - new Date(y, m - 1, d) > 183 * 864e5) y += 1;
    }
    var date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 ? iso(date) : null;
  }

  function iso(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }

  // ---------- Бриф, написанный свободным текстом ----------
  // Язык в середине фразы узнаём только по полному прилагательному («на английский», «грузинского»),
  // иначе «немного» станет немецким, а «пользователь» — польским.
  var LANG_WORDS = [
    ["en", /английск/], ["ka", /грузинск/], ["kk", /казахск/], ["uz", /узбекск/], ["ky", /к[иы]ргизск/],
    ["hy", /армянск/], ["tg", /таджикск/], ["az", /азербайджанск/], ["am", /амхарск/], ["tr", /турецк/],
    ["zh", /китайск/], ["ar", /арабск/], ["he", /иврит/], ["be", /белорусск/], ["de", /немецк/],
    ["fr", /французск/], ["es", /испанск/], ["mn", /монгольск/], ["sr", /сербск/], ["pl", /польск/]
  ];

  function languagesAnywhere(text) {
    var found = [];
    String(text).toLowerCase().replace(/[а-яё]+/g, function (word, pos) {
      LANG_WORDS.forEach(function (l) {
        if (word.search(l[1]) === 0 && !found.some(function (f) { return f.code === l[0]; })) found.push({ code: l[0], pos: pos });
      });
      return word;
    });
    if (/на все(?:х)? язык/i.test(text)) return [];
    return found.map(function (f) {
      for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === f.code) return { code: f.code, name: LANGS[i][1] };
    });
  }

  // Срок в свободном тексте: сначала дата после «до / к / срок / дедлайн / не позднее», потом любая дата.
  var DATE = "(?:\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?|\\d{1,2}\\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*(?:\\s+\\d{4})?|сегодня|завтра)";
  function deadlineAnywhere(text, now) {
    var clean = String(text).replace(/https?:\/\/\S+/g, " ");
    var m = clean.match(new RegExp("(?:^|[^а-яё])((?:до|к|ко|срок[а-яё]*|дедлайн[а-яё]*|ддл|не\\s+позднее|крайний\\s+срок)[\\s:—-]*" + DATE + ")", "i")) ||
      clean.match(new RegExp("(?:^|[^\\d.])(" + DATE.replace("|сегодня|завтра", "") + ")", "i"));
    if (!m) return null;
    var date = parseDate(m[1], now);
    return date ? { date: date, raw: m[1].trim() } : null;
  }

  function links(text) {
    var out = [];
    String(text).replace(/https?:\/\/[^\s<>()\[\]]+/g, function (u) {
      u = u.replace(/[.,;:!?]+$/, "");
      if (out.indexOf(u) < 0) out.push(u);
      return u;
    });
    return out;
  }

  // Приветствия, благодарности и прочая вежливость, которая не нужна в задаче.
  var POLITE = new RegExp("^(?:" + [
    "(?:всем\\s+|коллеги,?\\s*)?(?:добр(?:ый|ое|ого)\\s+(?:день|вечер|утро|времени\\s+суток|дня|вечера|утра)|привет(?:ствую)?|здравствуйте|хай|hello|hi)(?:\\s+всем)?(?:,?\\s*коллеги)?",
    "коллеги", "(?:заранее\\s+)?(?:большое\\s+)?спасибо(?:\\s+(?:большое|заранее|огромное))?", "(?:заранее\\s+)?благодар(?:ю|им)",
    "хорошего\\s+(?:дня|вечера)", "буд(?:у|ем)\\s+(?:очень\\s+)?(?:благодар\\S+|признательн\\S+)", "извините\\s+за\\s+беспокойство",
    "подскажите,?\\s+пожалуйста", "пожалуйста"
  ].join("|") + ")[\\s,.!)(:;—-]*", "i");

  function cleanText(text) {
    var out = [], source = false;
    String(text || "").replace(/\r/g, "").split("\n").forEach(function (line) {
      var l = line.trim(), prev;
      // После строки «Текст:» идёт то, что надо переводить: там ничего не трогаем.
      if (source) { out.push(line.replace(/\s+$/, "")); return; }
      if (/^(?:[*\-•]\s*)?(?:тексты?|исходник|text)\s*:/i.test(l)) { source = true; out.push(l); return; }
      do { prev = l; l = l.replace(POLITE, "").trim(); } while (l !== prev && l);
      l = l.replace(/[\s,]*(?:(?:заранее\s+)?(?:большое\s+)?спасибо(?:\s+(?:большое|заранее|огромное))?|(?:заранее\s+)?благодар(?:ю|им))[\s.!)]*$/i, "").trim();
      if (l) out.push(l.charAt(0).toUpperCase() + l.slice(1));
      else if (!line.trim() && out.length && out[out.length - 1] !== "") out.push("");
    });
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n");
  }

  // Обрезаем по границе слова, чтобы название задачи не кончалось на полуслове.
  function shorten(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[,;:—-]+$/, "") + "…";
  }

  function parseBrief(text, now) {
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var fields = {}, current = null, intro = [];
    lines.forEach(function (line) {
      var m = stripBullet(line).match(/^([^:\n]{2,40}?)\s*:\s*(.*)$/);
      var key = m && !/^https?$/i.test(m[1]) ? keyOf(m[1]) : null;
      if (key) {
        current = key;
        fields[key] = m[2].trim();
      } else if (current) {
        fields[current] += (fields[current] ? "\n" : "") + line.trim();
      } else {
        intro.push(line.trim());
      }
    });
    Object.keys(fields).forEach(function (k) { fields[k] = fields[k].replace(/\n{2,}/g, "\n").trim(); });

    // Чего нет в полях «Языки:» и «Сроки:», ищем по всему тексту.
    var langs = fields.languages ? languages(fields.languages) : languagesAnywhere(text);
    var deadline = fields.deadline ? parseDate(fields.deadline, now) : null, deadlineRaw = fields.deadline || "";
    if (!deadline) {
      var guess = deadlineAnywhere(fields.deadline || text, now);
      if (guess) { deadline = guess.date; deadlineRaw = deadlineRaw || guess.raw; }
    }
    var product = (fields.product || "").split("\n")[0].trim();
    var gist = cleanText(intro.join("\n")).split("\n").filter(Boolean)[0] || "";
    var have = { languages: langs.length, deadline: deadline, product: product, context: fields.context, text: fields.text || fields.weblate };
    return {
      found: Object.keys(fields).length,
      fields: fields,
      languages: langs,
      deadline: deadline,
      deadlineRaw: deadlineRaw,
      product: product,
      links: links(text),
      title: product ? "Перевод: " + product : shorten(gist.split(/[.!?…](?:\s|$)/)[0], 70),
      missing: REQUIRED.filter(function (r) { return !have[r[0]]; }).map(function (r) { return r[1]; })
    };
  }

  // Текст для описания задачи. Бриф по шаблону оставляем как есть, только без приветствий.
  // Свободный текст начинаем с выжимки: языки, срок, ссылки — и ниже слова заказчика.
  function digest(text, parsed) {
    var clean = cleanText(text);
    if (parsed.found >= 3) return clean;
    var head = [];
    if (parsed.languages.length) head.push("Языки: " + parsed.languages.map(function (l) { return l.name; }).join(", "));
    if (parsed.deadline) head.push("Срок: " + parsed.deadline.split("-").reverse().join(".") + (parsed.deadlineRaw ? " (в сообщении: «" + parsed.deadlineRaw.split("\n")[0] + "»)" : ""));
    if (parsed.product) head.push("Продукт: " + parsed.product);
    if (parsed.links.length) head.push("Ссылки:\n" + parsed.links.map(function (u) { return "- " + u; }).join("\n"));
    return (head.length ? head.join("\n") + "\n\n" : "") + "Сообщение заказчика:\n" + clean;
  }

  // Значение поля «Дата» в Tracker («22.08.2026 09:00») или дата в ISO → число миллисекунд. Не дата — null.
  function parseTrackerDate(v) {
    if (v == null) return null;
    if (Array.isArray(v)) v = v[0];
    if (typeof v !== "string" || !v) return null;
    var m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59).getTime();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      var t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    return null;
  }

  // "2026-11-20" + "18:00" (по местному времени) → "2026-11-20T15:00:00Z": Tracker принимает дату только в RFC 3339.
  function toTrackerDate(isoDate, time) {
    var p = isoDate.split("-"), t = (time || "18:00").split(":");
    return new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]).toISOString().replace(/\.\d+Z$/, "Z");
  }

  // Срочность дедлайна: просрочен, сегодня, завтра, позже.
  function urgency(deadline, now) {
    if (!deadline) return "none";
    now = now || Date.now();
    if (deadline < now) return "overdue";
    var d = new Date(now), endToday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (deadline < endToday) return "today";
    if (deadline < endToday + 864e5) return "tomorrow";
    return "later";
  }

  function formatDeadline(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  root.LocBrief = {
    LANGS: LANGS.map(function (l) { return { code: l[0], name: l[1] }; }),
    parseBrief: parseBrief, parseDate: parseDate, language: language, cleanText: cleanText, digest: digest,
    parseTrackerDate: parseTrackerDate, toTrackerDate: toTrackerDate,
    urgency: urgency, formatDeadline: formatDeadline
  };
})(typeof self !== "undefined" ? self : globalThis);
