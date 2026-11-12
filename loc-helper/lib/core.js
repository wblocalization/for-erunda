// Работа с WB Tracker Public API и вся логика без привязки к браузеру:
// подключение, список задач с дедлайнами, создание задач и подзадач, напоминания.
// Зависимости (fetch, хранилище, часы) передаются снаружи, чтобы это же можно было проверить вне расширения.
(function (root) {
  "use strict";
  var B = root.LocBrief;
  var BASE = "https://tracker.wb.ru";
  var PAGE = 100, MAX_PAGES = 10, GAP_MS = 250; // лимит API — 5 запросов в секунду

  var DEFAULT_SETTINGS = {
    scope: "all",            // чьи задачи показывать: all | executor | creator
    hoursBefore: [24, 3],    // за сколько часов до дедлайна напоминать
    remindAll: false,        // напоминать по всем показанным задачам, а не только по отмеченным
    deadlineTime: "18:00",   // время дедлайна, когда в брифе только дата
    urlTemplate: BASE + "/issue/{code}"
  };

  function create(deps) {
    var fetchFn = deps.fetch, store = deps.store, now = deps.now || Date.now, base = deps.base || BASE;
    var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var lastCall = 0;

    // В спецификации указана Basic-авторизация, но формат личного токена не описан,
    // поэтому при подключении перебираем варианты и запоминаем тот, что подошёл.
    function authVariants(token, login) {
      var b64 = function (s) { return btoa(unescape(encodeURIComponent(s))); };
      var list = [
        ["basic-raw", "Basic " + token], ["bearer", "Bearer " + token],
        ["basic-b64", "Basic " + b64(token)], ["basic-user", "Basic " + b64(token + ":")],
        ["basic-pass", "Basic " + b64(":" + token)], ["raw", token]
      ];
      if (login) list.unshift(["basic-login", "Basic " + b64(login + ":" + token)]);
      return list;
    }

    async function call(auth, method, path, query, body) {
      var wait = lastCall + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      var url = base + path;
      if (query) {
        var qs = Object.keys(query).filter(function (k) { return query[k] != null && query[k] !== ""; })
          .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(query[k]); }).join("&");
        if (qs) url += "?" + qs;
      }
      var res;
      try {
        res = await fetchFn(url, {
          method: method, credentials: "omit",
          headers: Object.assign({ Authorization: auth, Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}),
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (e) {
        throw fail("Нет связи с Tracker. Проверьте VPN и интернет.", 0);
      }
      var text = await res.text(), json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* не JSON */ }
      if (!res.ok) {
        var detail = json && (json.message || json.error || json.detail || json.title);
        if (detail && typeof detail !== "string") detail = JSON.stringify(detail);
        throw fail(explain(res.status) + (detail ? " (" + detail + ")" : ""), res.status, json);
      }
      return json;
    }

    function explain(status) {
      if (status === 401) return "Tracker не принял токен";
      if (status === 403) return "У токена нет прав на это действие";
      if (status === 404) return "Tracker не нашёл такую задачу или адрес";
      if (status === 429) return "Слишком много запросов к Tracker, попробуйте через минуту";
      if (status === 400) return "Tracker отклонил запрос: неверные данные";
      return "Ошибка Tracker " + status;
    }

    function fail(message, status, body) {
      var e = new Error(message);
      e.status = status; e.body = body;
      return e;
    }

    async function api(method, path, query, body) {
      var s = await store.get(["auth"]);
      if (!s.auth) throw fail("Tracker не подключён. Откройте настройки Loc Helper.", 0);
      return call(s.auth, method, path, query, body);
    }

    // ---------- Поля ----------
    // В задаче поля приходят как {id, value} без названия. Названия берём из описания полей типа задачи:
    // и по id поля, и по id его снимков — в разных местах API встречается и то, и другое.
    function indexFields(list, index) {
      (list || []).forEach(function (f) {
        if (!f || !f.id) return;
        var snaps = f.fieldSnapshots || {}, title = f.title || f.name || "";
        Object.keys(snaps).forEach(function (k) { if (snaps[k] && snaps[k].title) title = snaps[k].title; });
        var entry = { title: title, type: f.typeCode || "" };
        index[f.id] = entry;
        Object.keys(snaps).forEach(function (k) { if (snaps[k] && snaps[k].id) index[snaps[k].id] = entry; });
      });
      return index;
    }

    // Поля типа задачи в коротком виде для формы: только выпадающие списки и даты.
    // Поля с людьми (Reviewer) и числа (SP) заполняет исполнитель по ходу работы, в форму их не берём.
    function formFields(list) {
      var out = [];
      (list || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (f) {
        var snaps = f.fieldSnapshots || {}, key = Object.keys(snaps)[0], snap = key && snaps[key];
        if (!snap || !snap.id) return;
        var meta = snap.meta || {}, input = meta.input || {}, body = input[input.kind] || {};
        var pick = function (v) { return { id: v.id, label: v.label }; };
        if (f.typeCode === "choice") {
          out.push({
            id: snap.id, title: snap.title, type: "choice", multiple: !!body.multiple,
            required: !!(body.required || (meta.restrictions || {}).required),
            options: (body.variants || []).map(pick), defaults: (body.defaultValues || []).map(pick)
          });
        } else if (f.typeCode === "datetime") {
          out.push({ id: snap.id, title: snap.title, type: "datetime" });
        }
      });
      return out;
    }

    function isDeadlineTitle(title) { return /дедлайн|deadline|срок/i.test(title || ""); }

    function personName(u) {
      if (!u || !u.id) return "";
      return [u.lastName, u.firstName].filter(Boolean).join(" ") || u.login || "";
    }

    function isClosed(issue) {
      var cat = issue.state && issue.state.category && issue.state.category.code || "";
      var closedAt = issue.closedAt && !/^0001/.test(issue.closedAt) ? issue.closedAt : null;
      return issue.isActive === false || !!closedAt || /done|close|complete|cancel|reject|resolved/i.test(cat);
    }

    // Короткая карточка задачи для списка и напоминаний.
    function brief(issue, index, deadlineIds) {
      var deadline = null, deadlineFieldId = null;
      (issue.fields || []).forEach(function (f) {
        var known = index[f.id];
        if (deadlineIds.indexOf(f.id) >= 0 || isDeadlineTitle(f.name) || (known && isDeadlineTitle(known.title))) {
          var ts = B.parseTrackerDate(f.value);
          if (ts) { deadline = ts; deadlineFieldId = f.id; }
        }
      });
      return {
        id: issue.id, name: issue.name || "", deadline: deadline, deadlineFieldId: deadlineFieldId,
        state: issue.state && issue.state.name || "", closed: isClosed(issue),
        executorId: issue.executor && issue.executor.id || "", executor: personName(issue.executor),
        creatorId: issue.creator && issue.creator.id || "", creator: personName(issue.creator),
        type: issue.issueType && issue.issueType.alias || "", parent: issue.parentIssueId || null
      };
    }

    // ---------- Подключение ----------
    async function connect(token, sampleCode, login) {
      token = String(token || "").trim();
      sampleCode = String(sampleCode || "").trim().toUpperCase();
      if (!token) throw fail("Вставьте токен.", 0);
      if (!/^[A-ZА-Я0-9_]+-\d+$/.test(sampleCode)) throw fail("Номер задачи должен выглядеть как LOCAL-2210.", 0);
      var variants = authVariants(token, String(login || "").trim()), issue = null, auth = null, lastErr = null;
      for (var i = 0; i < variants.length && !issue; i++) {
        try {
          issue = (await call(variants[i][1], "GET", "/public-api/v1/issue/" + encodeURIComponent(sampleCode))) || {};
          auth = variants[i];
        } catch (e) {
          lastErr = e;
          if (e.status !== 401 && e.status !== 403) break;
        }
      }
      if (!issue) throw lastErr;
      issue = issue.issue || issue;
      if (!issue.id) throw fail("Tracker ответил, но задачи в ответе нет.", 0);

      var index = indexFields(issue.issueType && issue.issueType.fields, {});
      try {
        var f = await call(auth[1], "GET", "/public-api/v1/issue-type/" + issue.issueType.id + "/fields");
        indexFields(f && f.fields, index);
      } catch (e) { /* названия полей возьмём из самой задачи */ }

      var deadlineIds = (issue.fields || []).filter(function (x) { return index[x.id] && isDeadlineTitle(index[x.id].title); })
        .map(function (x) { return x.id; });
      Object.keys(index).forEach(function (id) {
        if (isDeadlineTitle(index[id].title) && /date/i.test(index[id].type) && deadlineIds.indexOf(id) < 0) deadlineIds.push(id);
      });

      var conn = {
        auth: auth[1], authKind: auth[0], sample: issue.id,
        ns: { code: issue.namespace.code, alias: issue.namespace.alias, name: issue.namespace.name },
        project: { code: issue.project.code, alias: issue.project.alias, name: issue.project.name },
        types: [{ id: issue.issueType.id, name: issue.issueType.name, alias: issue.issueType.alias }],
        fieldIndex: index, deadlineIds: deadlineIds, lastError: ""
      };
      await store.set(conn);
      await sync();
      return status();
    }

    // ---------- Список задач ----------
    async function sync() {
      var s = await store.get(["auth", "ns", "project", "fieldIndex", "deadlineIds", "types", "settings", "me", "people", "typeFields"]);
      if (!s.auth) return null;
      var typeFields = s.typeFields || {};
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings), index = s.fieldIndex || {};
      var query = { namespace_code: s.ns.code, project_code: s.project.code, limit: PAGE, sort: "updated_at", order: "DESC" };
      if (s.me && settings.scope === "executor") query.executor_id = s.me.id;
      if (s.me && settings.scope === "creator") query.creator_id = s.me.id;

      var types = {}, people = {}, issues = [], total = null;
      (s.types || []).forEach(function (t) { types[t.id] = t; });
      (s.people || []).forEach(function (p) { people[p.id] = p; });
      try {
        for (var page = 0; page < MAX_PAGES; page++) {
          query.offset = page * PAGE;
          var r = await api("GET", "/public-api/v1/issues", query);
          var list = r && r.issues || [];
          total = r && typeof r.total === "number" ? r.total : total;
          list.forEach(function (it) {
            if (it.issueType && it.issueType.id) {
              types[it.issueType.id] = { id: it.issueType.id, name: it.issueType.name, alias: it.issueType.alias };
              indexFields(it.issueType.fields, index);
            }
            [it.executor, it.creator].forEach(function (u) { if (u && u.id) people[u.id] = { id: u.id, name: personName(u), login: u.login || "" }; });
            var b = brief(it, index, s.deadlineIds || []);
            if (!b.closed) issues.push(b);
          });
          if (list.length < PAGE || (total !== null && query.offset + PAGE >= total)) break;
        }
      } catch (e) {
        await store.set({ lastError: e.message, lastSync: now() });
        throw e;
      }
      // Поля типов задач нужны форме. Читаем один раз на тип; кнопка «Обновить» перечитывает заново.
      var ids = Object.keys(types);
      for (var i = 0; i < ids.length; i++) {
        var t = types[ids[i]];
        if (typeFields[t.alias] && !sync.refreshFields) continue;
        try {
          var fr = await api("GET", "/public-api/v1/issue-type/" + t.id + "/fields");
          indexFields(fr && fr.fields, index);
          typeFields[t.alias] = formFields(fr && fr.fields);
        } catch (e) { /* форма покажет только общие поля */ }
      }
      sync.refreshFields = false;
      var sortByName = function (a, b) { return a.name.localeCompare(b.name, "ru"); };
      await store.set({
        issues: issues, total: total, lastSync: now(), lastError: "", fieldIndex: index, typeFields: typeFields,
        types: Object.keys(types).map(function (k) { return types[k]; }).sort(sortByName),
        people: Object.keys(people).map(function (k) { return people[k]; }).sort(sortByName)
      });
      return issues;
    }

    async function status() {
      var s = await store.get(null);
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      return {
        connected: !!s.auth, sample: s.sample || "", ns: s.ns || null, project: s.project || null,
        types: s.types || [], people: s.people || [], me: s.me || null, settings: settings, typeFields: s.typeFields || {},
        issues: s.issues || [], reminders: s.reminders || {}, total: s.total || 0,
        lastSync: s.lastSync || 0, lastError: s.lastError || "",
        deadlineField: (s.deadlineIds || []).length > 0, now: now()
      };
    }

    function issueUrl(template, code) { return (template || DEFAULT_SETTINGS.urlTemplate).replace("{code}", code); }

    // ---------- Создание ----------
    async function postIssue(body) {
      var r = await api("POST", "/public-api/v1/issue", null, body);
      return r && r.issue || r;
    }

    function dayStart(isoDate) { return isoDate + "T00:00:00Z"; }
    function dayEnd(isoDate) { return isoDate + "T23:59:59Z"; }

    // Тело запроса на создание задачи из того, что выбрано в форме.
    function issueBody(input, s, settings, typeAlias) {
      var body = {
        name: input.name, description: input.description || "",
        projectAlias: s.project.alias, namespaceAlias: s.ns.alias, issueTypeAlias: typeAlias
      };
      var defs = (s.typeFields || {})[typeAlias] || [], fields = [], known = {};
      defs.forEach(function (d) { known[d.id] = d; });
      Object.keys(input.choices || {}).forEach(function (id) {
        if (known[id] && input.choices[id].length) fields.push({ id: id, value: input.choices[id] });
      });
      // Обязательное поле без выбора получает значение по умолчанию (например, приоритет Normal).
      defs.forEach(function (d) {
        var set = fields.some(function (f) { return f.id === d.id; });
        if (d.type === "choice" && d.required && !set && d.defaults.length) fields.push({ id: d.id, value: d.defaults });
      });
      var deadline = defs.filter(function (d) { return d.type === "datetime" && isDeadlineTitle(d.title); })[0];
      var deadlineId = deadline ? deadline.id : (s.deadlineIds || [])[0];
      if (deadlineId && input.deadline) fields.push({ id: deadlineId, value: [B.toTrackerDate(input.deadline, settings.deadlineTime)] });
      if (fields.length) body.fields = fields;
      if (input.executorId) body.executor = input.executorId;
      if (input.start) body.startedAt = dayStart(input.start);
      if (input.end) body.completedAt = dayEnd(input.end);
      return body;
    }

    // Что в созданной задаче осталось пустым — показываем менеджеру, ничего не додумывая.
    function unfilled(input, s, typeAlias) {
      var out = [];
      if (!input.executorId) out.push("Исполнитель");
      if (!input.deadline) out.push("Дедлайн");
      ((s.typeFields || {})[typeAlias] || []).forEach(function (d) {
        if (d.type === "choice" && !d.required && !((input.choices || {})[d.id] || []).length) out.push(d.title);
      });
      return out;
    }

    // В подзадаче на один язык в поле «Страны» оставляем страну этого языка, если она есть в списке.
    function forLanguage(choices, lang, s, typeAlias) {
      var defs = (s.typeFields || {})[typeAlias] || [], out = Object.assign({}, choices);
      var own = B.suggest({ languages: [lang], product: "" }, "", defs.filter(function (d) { return /стран/i.test(d.title); }));
      Object.keys(own).forEach(function (id) { out[id] = own[id]; });
      return out;
    }

    // Из брифа: новая задача, подзадача в выбранный тикет или комментарий в существующий.
    // По желанию — подзадачи на каждый язык (и отдельно на редактуру).
    async function createFromBrief(input) {
      var s = await store.get(["ns", "project", "deadlineIds", "settings", "types", "typeFields"]);
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      var link = function (id) { return issueUrl(settings.urlTemplate, id); };
      var target = String(input.targetCode || "").trim().toUpperCase();
      if (input.mode !== "new" && input.mode && !/^[A-ZА-Я0-9_]+-\d+$/.test(target)) throw fail("Укажите номер тикета, например LOCAL-2210.", 0);

      if (input.mode === "comment") {
        await api("POST", "/public-api/v1/issue/" + encodeURIComponent(target) + "/discussion", null,
          { text: (input.name ? input.name + "\n\n" : "") + (input.description || ""), fileIds: [] });
        return { id: target, url: link(target), comment: true, subs: [], errors: [], unfilled: [] };
      }

      var body = issueBody(input, s, settings, input.typeAlias);
      if (input.mode === "sub") body.parentIssueId = target;
      var parent = await postIssue(body), subs = [], errors = [];

      var has = function (alias) { return (s.types || []).some(function (t) { return t.alias === alias; }); };
      // Перевод и редактура — разные типы задач, если они заведены в проекте.
      var first = input.subTypeAlias || (input.withEditing && has("perevod") ? "perevod" : input.typeAlias);
      var stages = [{ suffix: "", type: first }];
      if (input.withEditing) stages.push({ suffix: " (редактура)", type: has("redaktura") ? "redaktura" : stages[0].type });
      for (var i = 0; i < (input.languages || []).length; i++) {
        for (var j = 0; j < stages.length; j++) {
          var lang = input.languages[i], title = input.name + " — " + lang.name + stages[j].suffix;
          try {
            var sub = issueBody(Object.assign({}, input, { name: title, executorId: null, choices: forLanguage(input.choices, lang, s, stages[j].type) }), s, settings, stages[j].type);
            sub.parentIssueId = parent.id;
            var created = await postIssue(sub);
            subs.push({ id: created.id, lang: lang.name + stages[j].suffix, url: link(created.id) });
          } catch (e) {
            errors.push(lang.name + stages[j].suffix + ": " + e.message);
          }
        }
      }
      sync().catch(function () {});
      return {
        id: parent.id, url: link(parent.id), parent: input.mode === "sub" ? target : null,
        subs: subs, errors: errors, unfilled: unfilled(input, s, input.typeAlias)
      };
    }

    // Копии задачи для переводчиков: то же описание и поля, родитель — исходная задача.
    async function cloneForLanguages(code, langs, opts) {
      opts = opts || {};
      var s = await store.get(["ns", "project", "settings", "fieldIndex"]);
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings), index = s.fieldIndex || {};
      var src = await api("GET", "/public-api/v1/issue/" + encodeURIComponent(code));
      src = src.issue || src;
      // Файлы и пустые значения не копируем: файл привязан к исходной задаче.
      var fields = (src.fields || []).filter(function (f) {
        var empty = f.value == null || (Array.isArray(f.value) && !f.value.length);
        return !empty && !(index[f.id] && /file/i.test(index[f.id].type));
      }).map(function (f) { return { id: f.id, value: f.value }; });
      var base = {
        description: src.description || "", issueTypeAlias: opts.typeAlias || src.issueType.alias,
        projectAlias: src.project.alias, namespaceAlias: src.namespace.alias, parentIssueId: src.id
      };
      var made = [], errors = [], withoutFields = false;
      for (var i = 0; i < langs.length; i++) {
        var body = Object.assign({ name: src.name + " — " + langs[i].name }, base);
        try {
          var created;
          try {
            created = await postIssue(fields.length && !withoutFields ? Object.assign({ fields: fields }, body) : body);
          } catch (e) {
            // Часть полей может не подойти другому типу задачи — тогда создаём без полей и говорим об этом.
            if (e.status !== 400 || !fields.length || withoutFields) throw e;
            withoutFields = true;
            created = await postIssue(body);
          }
          made.push({ id: created.id, lang: langs[i].name, url: issueUrl(settings.urlTemplate, created.id) });
        } catch (e) {
          errors.push(langs[i].name + ": " + e.message);
        }
      }
      sync().catch(function () {});
      return { source: src.id, made: made, errors: errors, withoutFields: withoutFields };
    }

    // ---------- Диагностика ----------
    // Что Tracker отдаёт про типы задач и их поля. Токена здесь нет; из задачи-образца берём только названия и поля.
    async function diagnose() {
      var s = await store.get(["sample", "types", "ns", "project", "deadlineIds", "authKind", "settings"]);
      var out = { version: 1, ns: s.ns, project: s.project, authKind: s.authKind, deadlineIds: s.deadlineIds, urlTemplate: (s.settings || {}).urlTemplate || null, types: [], errors: [] };
      try {
        var it = await api("GET", "/public-api/v1/issue/" + encodeURIComponent(s.sample));
        it = it.issue || it;
        out.sample = {
          id: it.id, name: it.name, issueType: it.issueType, state: it.state, fields: it.fields, tags: it.tags,
          startedAt: it.startedAt || null, completedAt: it.completedAt || null, parentIssueId: it.parentIssueId,
          keys: Object.keys(it)
        };
      } catch (e) { out.errors.push("sample: " + e.message); }
      for (var i = 0; i < (s.types || []).length; i++) {
        var t = s.types[i];
        try {
          var f = await api("GET", "/public-api/v1/issue-type/" + t.id + "/fields");
          out.types.push({ id: t.id, name: t.name, alias: t.alias, fields: f && f.fields || f });
        } catch (e) { out.errors.push(t.name + ": " + e.message); }
      }
      return out;
    }

    // ---------- Напоминания ----------
    function inScope(issue, me, scope) {
      if (!me || scope === "all") return true;
      return scope === "creator" ? issue.creatorId === me.id : issue.executorId === me.id;
    }

    // Что напомнить прямо сейчас. Каждое напоминание выдаётся один раз (помним в notified).
    async function dueReminders() {
      var s = await store.get(["issues", "reminders", "settings", "notified", "me"]);
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      var t = now(), notified = s.notified || {}, out = [], reminders = s.reminders || {};
      (s.issues || []).forEach(function (it) {
        if (!it.deadline || !(reminders[it.id] || (settings.remindAll && inScope(it, s.me, settings.scope)))) return;
        var left = it.deadline - t, key = null, text = "";
        if (left <= 0) {
          if (left > -864e5) { key = "over"; text = "Дедлайн прошёл: " + B.formatDeadline(it.deadline); }
        } else {
          var hours = settings.hoursBefore.slice().sort(function (a, b) { return a - b; });
          for (var i = 0; i < hours.length; i++) {
            if (left <= hours[i] * 36e5) {
              key = "h" + hours[i];
              text = "До дедлайна " + leftText(left) + " (" + B.formatDeadline(it.deadline) + ")";
              break;
            }
          }
        }
        var id = key && it.id + "|" + key + "|" + it.deadline;
        if (id && !notified[id]) {
          notified[id] = t;
          out.push({ id: it.id, title: it.id + " · " + it.name, text: text, url: issueUrl(settings.urlTemplate, it.id) });
        }
      });
      Object.keys(notified).forEach(function (k) { if (t - notified[k] > 14 * 864e5) delete notified[k]; });
      if (out.length) await store.set({ notified: notified });
      return out;
    }

    function leftText(ms) {
      var total = Math.round(ms / 6e4), h = Math.floor(total / 60), m = total % 60;
      return h >= 1 ? h + " ч" + (h < 6 && m ? " " + m + " мин" : "") : Math.max(m, 1) + " мин";
    }

    // Сколько задач горит (просрочено или сегодня) — для счётчика на значке.
    async function hotCount() {
      var s = await store.get(["issues", "settings", "me"]);
      var settings = Object.assign({}, DEFAULT_SETTINGS, s.settings), t = now();
      return (s.issues || []).filter(function (it) {
        var u = B.urgency(it.deadline, t);
        return inScope(it, s.me, settings.scope) && (u === "overdue" || u === "today");
      }).length;
    }

    return {
      connect: connect, sync: sync, status: status, createFromBrief: createFromBrief,
      refresh: function () { sync.refreshFields = true; return sync(); },
      cloneForLanguages: cloneForLanguages, diagnose: diagnose, dueReminders: dueReminders, hotCount: hotCount, issueUrl: issueUrl
    };
  }

  root.LocCore = { create: create, DEFAULT_SETTINGS: DEFAULT_SETTINGS, BASE: BASE };
})(typeof self !== "undefined" ? self : globalThis);
