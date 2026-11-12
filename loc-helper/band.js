// Band (Mattermost): кнопка «→ Tracker» у сообщения. Открывает форму, заполненную из брифа,
// создаёт задачу в Tracker и пишет ссылку на неё в тред.
// Данные треда берём из API самого Band под текущим входом — так же, как это делает Band.
(function () {
  "use strict";
  var U = self.LocUI, B = self.LocBrief, el = U.el;

  // ---------- API Band ----------
  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function api(path, method, body) {
    var headers = { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" };
    if (method && method !== "GET") {
      headers["X-CSRF-Token"] = cookie("MMCSRF");
      headers["Content-Type"] = "application/json";
    }
    return fetch("/api/v4" + path, { method: method || "GET", credentials: "include", headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error("Band: HTTP " + r.status + (j && j.message ? " — " + j.message : ""));
          });
        }
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
  }

  function teamName() {
    var p = location.pathname.split("/").filter(Boolean);
    return p[0] && ["login", "admin_console", "select_team", "plug", "boards", "playbooks"].indexOf(p[0]) < 0 ? p[0] : "";
  }

  function userName(u) {
    if (!u) return "";
    var full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full ? full + " (@" + u.username + ")" : "@" + u.username;
  }

  function stamp(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // Тред целиком: сообщения по порядку, авторы, ссылка на первое сообщение.
  function loadThread(postId) {
    return api("/posts/" + postId).then(function (post) {
      var rootId = post.root_id || post.id;
      return Promise.all([api("/posts/" + rootId + "/thread"), api("/users/me")]).then(function (r) {
        var posts = Object.keys(r[0].posts).map(function (k) { return r[0].posts[k]; })
          .filter(function (p) { return !p.delete_at && !/^system_/.test(p.type || ""); })
          .sort(function (a, b) { return a.create_at - b.create_at; });
        var ids = posts.map(function (p) { return p.user_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        return api("/users/ids", "POST", ids).then(function (users) {
          var byId = {};
          (users || []).forEach(function (u) { byId[u.id] = u; });
          var team = teamName();
          return {
            rootId: rootId, channelId: post.channel_id, posts: posts, users: byId, me: r[1],
            link: location.origin + (team ? "/" + team : "") + "/pl/" + rootId
          };
        });
      });
    });
  }

  // Заказчик может прислать исправленный бриф в треде — берём последнее сообщение, похожее на бриф.
  function pickBrief(thread) {
    var best = null;
    thread.posts.forEach(function (p) {
      var parsed = B.parseBrief(p.message);
      // Новый бриф в треде засчитываем, только если его прислал автор первого сообщения.
      if (parsed.found >= 2 && p.user_id === thread.posts[0].user_id) best = { post: p, parsed: parsed };
    });
    return best || { post: thread.posts[0], parsed: B.parseBrief(thread.posts[0].message) };
  }

  function describe(thread, briefPost, withThread) {
    var files = thread.posts.reduce(function (n, p) { return n + (p.file_ids ? p.file_ids.length : 0); }, 0);
    var out = [B.digest(briefPost.message, B.parseBrief(briefPost.message)), "", "---", "Бриф в Band: " + thread.link, "Заказчик: " + userName(thread.users[briefPost.user_id])];
    if (files) out.push("Вложений в треде: " + files + " (смотрите по ссылке)");
    if (withThread) {
      var rest = thread.posts.filter(function (p) { return p.id !== briefPost.id && p.message.trim(); });
      if (rest.length) {
        out.push("", "Переписка в треде:");
        rest.forEach(function (p) { out.push(userName(thread.users[p.user_id]) + ", " + stamp(p.create_at) + ": " + p.message.trim()); });
      }
    }
    return out.join("\n");
  }

  function remember(key, value) {
    try {
      if (value === undefined) return localStorage.getItem("locHelper." + key);
      localStorage.setItem("locHelper." + key, value);
    } catch (e) { /* хранилище недоступно — просто не запоминаем */ }
    return null;
  }

  // ---------- Форма ----------
  function openForm(postId) {
    var m = U.modal("Задача в Tracker"), busy = el("div.note", { text: "Читаю тред…" });
    m.body.appendChild(busy);
    Promise.all([U.send("status"), loadThread(postId)]).then(function (r) {
      busy.remove();
      if (!r[0].connected) return notConnected(m);
      buildForm(m, r[0], r[1]);
    }).catch(function (e) {
      busy.className = "note err";
      busy.textContent = e.message;
    });
  }

  function notConnected(m) {
    m.body.appendChild(el("div.note.warn", { text: "Tracker ещё не подключён: нужен ваш API-токен и номер любой задачи локализации." }));
    m.foot.appendChild(el("button.btn.primary", { text: "Открыть настройки", onclick: function () { U.send("openOptions"); m.close(); } }));
  }

  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function buildForm(m, st, thread) {
    var picked = pickBrief(thread), parsed = picked.parsed, CODE = /^[A-ZА-Я0-9_]+-\d+/i;

    // Куда отправить: новая задача, подзадача в свой тикет или комментарий в существующий.
    var mode = el("select", {}, [
      el("option", { value: "new", text: "Новая задача" }),
      el("option", { value: "sub", text: "Подзадача в тикет…" }),
      el("option", { value: "comment", text: "Комментарий в тикет…" })
    ]);
    var target = el("input", { type: "text", placeholder: "номер или название тикета" });
    var targets = el("datalist", { id: "loc-targets" });
    var mineFirst = st.issues.slice().sort(function (a, b) {
      var am = st.me && a.executorId === st.me.id ? 0 : 1, bm = st.me && b.executorId === st.me.id ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name, "ru");
    });
    mineFirst.forEach(function (it) { targets.appendChild(el("option", { value: it.id + " · " + it.name })); });
    target.setAttribute("list", "loc-targets");
    var targetField = U.field("Тикет", target);
    mode.value = remember("mode") || "new";

    var name = el("input", { type: "text", value: parsed.title || "Перевод", maxLength: 250 });
    var type = el("select"), subType = el("select"), executor = el("select");
    st.types.forEach(function (t) { type.appendChild(el("option", { value: t.alias, text: t.name })); });
    subType.appendChild(el("option", { value: "", text: "как у основной" }));
    st.types.forEach(function (t) { subType.appendChild(el("option", { value: t.alias, text: t.name })); });
    executor.appendChild(el("option", { value: "", text: "не назначать" }));
    st.people.forEach(function (p) { executor.appendChild(el("option", { value: p.id, text: p.name })); });
    if (remember("type")) type.value = remember("type");
    if (remember("subType")) subType.value = remember("subType");
    if (!type.value && st.types[0]) type.value = st.types[0].alias;
    // Исполнитель по умолчанию — тот, кто нажал кнопку.
    if (st.me) executor.value = st.me.id;

    var date = el("input", { type: "date", value: parsed.deadline || "" });
    var start = el("input", { type: "date", value: today() });
    var end = el("input", { type: "date", value: parsed.deadline || "" });
    var endTouched = false;
    end.addEventListener("input", function () { endTouched = true; });
    date.addEventListener("input", function () { if (!endTouched) end.value = date.value; });

    // Поля-списки выбранного типа задачи: приоритет, бизнес-заказчик, формат, страны…
    var extra = el("div.section"), inputs = [], kept = {};
    function drawExtra() {
      inputs.forEach(function (i) { kept[i.def.id] = i.input.get(); });
      var defs = (st.typeFields[type.value] || []).filter(function (d) { return d.type === "choice"; });
      var hints = B.suggest(parsed, picked.post.message, defs);
      extra.textContent = "";
      inputs = defs.map(function (d) {
        var input = U.choiceInput(d, kept[d.id] || hints[d.id] || []);
        var guessed = !kept[d.id] && hints[d.id] && !d.required;
        extra.appendChild(U.field(d.title + (guessed ? " (подставлено по брифу, проверьте)" : ""), input.el));
        return { def: d, input: input };
      });
    }
    type.addEventListener("change", drawExtra);
    drawExtra();

    var langs = U.langPicker(parsed.languages);
    var subs = el("select", {}, [
      el("option", { value: "", text: "не создавать" }),
      el("option", { value: "lang", text: "на каждый выбранный язык" }),
      el("option", { value: "lang+edit", text: "на каждый язык: перевод и редактура" })
    ]);
    subs.value = remember("subsMode") || "";
    var whole = el("input", { type: "checkbox" });
    var desc = el("textarea", { value: describe(thread, picked.post, false) });
    var descTouched = false;
    desc.addEventListener("input", function () { descTouched = true; });
    whole.addEventListener("change", function () {
      if (descTouched && !confirm("Описание будет собрано заново, ваши правки в нём пропадут. Продолжить?")) { whole.checked = !whole.checked; return; }
      desc.value = describe(thread, picked.post, whole.checked);
      descTouched = false;
    });
    var reply = el("input", { type: "checkbox", checked: remember("reply") !== "0" });
    var react = el("input", { type: "checkbox", checked: remember("react") !== "0" });
    var error = el("div.note.err", { hidden: true });

    if (parsed.missing.length) {
      var ask = "Привет! Чтобы взять задачу в работу, дополните, пожалуйста, бриф: " + parsed.missing.join(", ") +
        ". Пришлите обновлённый бриф целиком в этом треде.";
      m.body.appendChild(el("div.note.warn", {}, [
        "В брифе не нашлось: " + parsed.missing.join(", ") + ". Это подсказка: задачу можно создать и так. ",
        el("a", { href: "#", text: "Скопировать ответ заказчику", onclick: function (e) {
          e.preventDefault();
          navigator.clipboard.writeText(ask).then(function () { U.toast("Ответ скопирован, вставьте его в тред."); });
        } })
      ]));
    }
    if (!st.deadlineField) m.body.appendChild(el("div.note.warn", { text: "В задаче-образце нет поля «Дедлайн», поэтому срок попадёт только в описание." }));

    // Всё, что относится только к новой задаче (в комментарии не нужно).
    var taskOnly = el("div.section", {}, [
      el("div.row", {}, [U.field("Тип задачи", type), U.field("Исполнитель", executor)]),
      U.field("Дедлайн" + (parsed.deadlineRaw ? " (в брифе: " + parsed.deadlineRaw.split("\n")[0].slice(0, 40) + ")" : ""), date),
      el("div.row", {}, [U.field("Дата начала", start), U.field("Дата завершения", end)]),
      extra,
      U.field("Языки", langs.el),
      el("div.row", {}, [U.field("Подзадачи", subs), U.field("Тип подзадач", subType)])
    ]);

    m.body.appendChild(el("div.row", {}, [U.field("Куда отправить", mode), targetField]));
    m.body.appendChild(targets);
    m.body.appendChild(U.field("Название", name));
    m.body.appendChild(taskOnly);
    m.body.appendChild(U.field("Описание", desc));
    m.body.appendChild(el("label.check", {}, [whole, "Добавить в описание всю переписку из треда"]));
    m.body.appendChild(el("label.check", {}, [reply, "Написать в тред ссылку на задачу"]));
    m.body.appendChild(el("label.check", {}, [react, "Поставить ✅ на бриф"]));
    m.body.appendChild(error);

    var go = el("button.btn.primary");
    m.foot.appendChild(el("span.grow", { text: st.project ? st.project.name + " · " + st.ns.name : "" }));
    m.foot.appendChild(el("button.btn", { text: "Отмена", onclick: m.close }));
    m.foot.appendChild(go);

    function goLabel() { return mode.value === "comment" ? "Добавить комментарий" : mode.value === "sub" ? "Создать подзадачу" : "Создать задачу"; }
    function onMode() {
      targetField.hidden = mode.value === "new";
      taskOnly.hidden = mode.value === "comment";
      target.value = mode.value === "new" ? "" : (remember("target." + mode.value) || "");
      go.textContent = goLabel();
    }
    mode.addEventListener("change", onMode);
    onMode();

    go.addEventListener("click", function () {
      var chosen = langs.get(), code = (target.value.trim().match(CODE) || [""])[0].toUpperCase();
      var isComment = mode.value === "comment", wantSubs = !isComment && subs.value;
      error.hidden = true;
      if (!name.value.trim()) return showError("Заполните название.");
      if (mode.value !== "new" && !code) return showError("Укажите тикет: начните печатать номер или название и выберите из списка.");
      if (!isComment && !type.value) return showError("Выберите тип задачи.");
      if (wantSubs && !chosen.length) return showError("Чтобы создать подзадачи, выберите хотя бы один язык.");
      var count = wantSubs ? chosen.length * (subs.value === "lang+edit" ? 2 : 1) : 0;
      if (count > 5 && !confirm("Будет создано задач: " + (count + 1) + ". Продолжить?")) return;
      remember("mode", mode.value); remember("type", type.value); remember("subType", subType.value); remember("subsMode", subs.value);
      remember("reply", reply.checked ? "1" : "0"); remember("react", react.checked ? "1" : "0");
      if (mode.value !== "new") remember("target." + mode.value, target.value.trim());
      var choices = {};
      inputs.forEach(function (i) { choices[i.def.id] = i.input.get(); });
      go.disabled = true;
      go.textContent = "Отправляю…";
      U.send("create", { input: {
        mode: mode.value, targetCode: code, name: name.value.trim(), description: desc.value,
        typeAlias: type.value, subTypeAlias: subType.value, executorId: executor.value || null,
        deadline: date.value || null, start: start.value || null, end: end.value || null, choices: choices,
        languages: wantSubs ? chosen : [], withEditing: subs.value === "lang+edit"
      } }).then(function (res) {
        return announce(thread, res, reply.checked, react.checked).then(function (warn) { done(m, res, warn); });
      }).catch(function (e) {
        go.disabled = false;
        go.textContent = goLabel();
        showError(e.message);
      });
    });

    function showError(text) { error.textContent = text; error.hidden = false; }
  }

  // Ссылка и реакция в треде. Задача уже создана, так что ошибка Band здесь — предупреждение, а не провал.
  function announce(thread, res, reply, react) {
    var jobs = [];
    if (reply) {
      var text = res.comment ? "Добавлено в тикет Tracker: [" + res.id + "](" + res.url + ")" : "Задача в Tracker: [" + res.id + "](" + res.url + ")";
      if (res.subs.length) text += "\nПодзадачи: " + res.subs.map(function (s) { return s.lang + " — [" + s.id + "](" + s.url + ")"; }).join(", ");
      jobs.push(api("/posts", "POST", { channel_id: thread.channelId, root_id: thread.rootId, message: text }));
    }
    if (react) {
      jobs.push(api("/reactions", "POST", { user_id: thread.me.id, post_id: thread.rootId, emoji_name: "white_check_mark", create_at: 0 }));
    }
    return Promise.all(jobs.map(function (j) { return j.then(function () { return null; }, function (e) { return e.message; }); }))
      .then(function (r) { return r.filter(Boolean).join("; "); });
  }

  function done(m, res, warn) {
    m.body.textContent = "";
    m.foot.textContent = "";
    var link = el("a", { href: res.url, target: "_blank", rel: "noopener", text: res.id });
    m.body.appendChild(el("div.note.ok", {}, res.comment ? ["Бриф добавлен комментарием в ", link, "."] :
      [res.parent ? "Создана подзадача " : "Создана задача ", link, res.parent ? " в тикете " + res.parent : "",
        res.subs.length ? " и подзадач: " + res.subs.length + "." : "."]));
    if (res.unfilled.length) m.body.appendChild(el("div.note.warn", { text: "Остались пустыми: " + res.unfilled.join(", ") + "." }));
    if (res.errors.length) m.body.appendChild(el("div.note.err", { text: "Не удалось создать подзадачи: " + res.errors.join("; ") }));
    if (warn) m.body.appendChild(el("div.note.warn", { text: "В Tracker всё создано, но в тред написать не получилось: " + warn }));
    m.foot.appendChild(el("button.btn.primary", { text: "Готово", onclick: m.close }));
  }

  // ---------- Кнопка у сообщения ----------
  var chip = null, hideTimer = null, currentPost = null;

  function postOf(node) {
    var p = node && node.closest ? node.closest('[id^="post_"], [id^="rhsPost_"]') : null;
    return p && /^(?:rhsPost|post)_[a-z0-9]{26}$/.test(p.id) ? p : null;
  }

  function showChip(post) {
    if (!chip) {
      chip = el("button", { type: "button", text: "→ Tracker", title: "Создать задачу в Tracker из этого треда" });
      chip.style.cssText = "position:fixed;z-index:2147483645;border:0;border-radius:999px;padding:3px 10px;font:600 12px/1.4 Inter,system-ui,sans-serif;" +
        "background:#7a5af8;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(40,20,120,.35)";
      chip.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
      chip.addEventListener("mouseleave", hideSoon);
      chip.addEventListener("click", function () { if (currentPost) openForm(currentPost.id.replace(/^(?:rhsPost|post)_/, "")); });
      U.layer().appendChild(chip);
    }
    clearTimeout(hideTimer);
    currentPost = post;
    var r = post.getBoundingClientRect();
    // Правее стоит собственное меню Band (реакции, «…»), поэтому встаём левее него.
    chip.style.top = Math.max(r.top - 11, 4) + "px";
    chip.style.left = Math.max(r.right - 330, r.left + 60) + "px";
    chip.style.display = "";
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (chip) chip.style.display = "none"; }, 350);
  }

  document.addEventListener("mouseover", function (e) {
    var post = postOf(e.target);
    if (post) showChip(post);
    else if (chip && e.target.id !== "loc-helper-layer") hideSoon();
  }, true);
  document.addEventListener("scroll", function () { if (chip) chip.style.display = "none"; }, true);
})();
