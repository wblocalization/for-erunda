// Страница «Новый тикет»: создаёт задачу в Tracker из открытой вкладки (страницы вики, документа, перевода).
// Открывается отдельным окном из окошка расширения; название и ссылка страницы приходят в адресе.
(function () {
  "use strict";
  var U = self.LocUI, el = U.el, app = document.getElementById("app");
  var params = new URLSearchParams(location.search);
  var page = { title: (params.get("title") || "").trim(), url: (params.get("url") || "").trim() };
  var CODE = /^[A-ZА-Я0-9_]+-\d+/i;

  function today() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function remember(key, value) {
    try {
      if (value === undefined) return localStorage.getItem("create." + key);
      localStorage.setItem("create." + key, value);
    } catch (e) { /* не запомнили — не страшно */ }
    return null;
  }

  function numberInput(def, kept) {
    var input = el("input", { type: "text", inputMode: "numeric", placeholder: "число", value: kept && kept.length ? String(kept[0]) : "" });
    return { el: input, get: function () {
      var v = input.value.trim().replace(",", ".");
      return v !== "" && isFinite(v) ? [Math.round(Number(v))] : [];
    } };
  }

  function card(title, kids) { return el("div.card", {}, [title ? el("h2", { text: title }) : null].concat(kids)); }

  function build(st) {
    app.textContent = "";
    if (!st.connected) {
      app.appendChild(card("", [
        el("div.note.warn", { text: "Tracker ещё не подключён: нужен ваш API-токен и номер любой задачи локализации." }),
        el("button.btn.primary", { text: "Открыть настройки", onclick: function () { U.send("openOptions"); } })
      ]));
      return;
    }
    document.getElementById("where").textContent = st.project.name + " · " + st.ns.name;

    var name = el("input", { type: "text", value: page.title, maxLength: 250, placeholder: "что сделано" });
    var type = el("select"), executor = el("select");
    st.types.forEach(function (t) { type.appendChild(el("option", { value: t.alias, text: t.name })); });
    if (remember("type")) type.value = remember("type");
    if (!type.value && st.types[0]) type.value = st.types[0].alias;
    executor.appendChild(el("option", { value: "", text: "не назначать" }));
    st.people.forEach(function (p) { executor.appendChild(el("option", { value: p.id, text: p.name })); });
    if (st.me) executor.value = st.me.id;

    var mode = el("select", {}, [el("option", { value: "new", text: "Отдельный тикет" }), el("option", { value: "sub", text: "Подзадача в тикет…" })]);
    var target = el("input", { type: "text", placeholder: "номер или название тикета" });
    var targets = el("datalist", { id: "targets" });
    st.issues.slice().sort(function (a, b) {
      var am = st.me && a.executorId === st.me.id ? 0 : 1, bm = st.me && b.executorId === st.me.id ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name, "ru");
    }).forEach(function (it) { targets.appendChild(el("option", { value: it.id + " · " + it.name })); });
    target.setAttribute("list", "targets");
    var targetField = U.field("Родительский тикет", target);
    mode.value = remember("mode") || "new";
    function onMode() { targetField.hidden = mode.value !== "sub"; if (mode.value === "sub" && !target.value) target.value = remember("target") || ""; }
    mode.addEventListener("change", onMode);
    onMode();

    var deadline = el("input", { type: "date" }), start = el("input", { type: "date", value: today() }), end = el("input", { type: "date" });

    // Поля-списки и числа выбранного типа задачи. Здесь нет брифа, поэтому ничего не подставляем, кроме обязательных значений по умолчанию.
    var extra = el("div.section"), inputs = [], kept = {};
    function drawExtra() {
      inputs.forEach(function (i) { kept[i.def.id] = i.input.get(); });
      var hidden = (st.settings.hiddenFields || []).map(function (h) { return h.trim().toLowerCase(); });
      var defs = (st.typeFields[type.value] || []).filter(function (d) {
        return (d.type === "choice" || d.type === "number") && hidden.indexOf(d.title.trim().toLowerCase()) < 0;
      });
      extra.textContent = "";
      inputs = defs.map(function (d) {
        var input = d.type === "number" ? numberInput(d, kept[d.id]) : U.choiceInput(d, kept[d.id] || (d.required ? d.defaults.slice(0, 1) : []));
        extra.appendChild(U.field(d.title, input.el));
        return { def: d, input: input };
      });
    }
    type.addEventListener("change", drawExtra);
    drawExtra();

    var result = page.url ? "Результат: [" + (page.title.replace(/[\[\]]/g, "") || page.url) + "](" + page.url + ")" : "";
    var desc = el("textarea", { value: result, placeholder: "что сделано и где лежит результат" });
    desc.style.minHeight = "110px";
    var error = el("div.note.err", { hidden: true });
    var go = el("button.btn.primary.big", { text: "Создать тикет" });

    app.appendChild(card("Что сделано", [U.field("Название", name), U.field("Описание", desc)]));
    app.appendChild(card("Тикет", [
      el("div.row", {}, [U.field("Тип задачи", type), U.field("Исполнитель", executor)]),
      el("div.row", {}, [U.field("Куда", mode), targetField]), targets,
      el("div.row", {}, [U.field("Дата начала", start), U.field("Дата завершения", end)]),
      U.field("Дедлайн", deadline)
    ]));
    app.appendChild(card("Поля Tracker", [extra]));
    app.appendChild(error);
    app.appendChild(el("div.sticky-foot", {}, [go]));

    go.addEventListener("click", function () {
      var code = (target.value.trim().match(CODE) || [""])[0].toUpperCase();
      error.hidden = true;
      if (!name.value.trim()) return showError("Заполните название.");
      if (!type.value) return showError("Выберите тип задачи.");
      if (mode.value === "sub" && !code) return showError("Укажите родительский тикет: начните печатать номер или название и выберите из списка.");
      remember("type", type.value); remember("mode", mode.value);
      if (mode.value === "sub") remember("target", target.value.trim());
      var choices = {};
      inputs.forEach(function (i) { choices[i.def.id] = i.input.get(); });
      go.disabled = true;
      go.textContent = "Создаю…";
      U.send("create", { input: {
        mode: mode.value, targetCode: code, name: name.value.trim(), description: desc.value.trim(), typeAlias: type.value,
        executorId: executor.value || null, deadline: deadline.value || null, start: start.value || null, end: end.value || null,
        choices: choices, languages: []
      } }).then(done).catch(function (e) {
        go.disabled = false;
        go.textContent = "Создать тикет";
        showError(e.message);
      });
    });

    function showError(text) { error.textContent = text; error.hidden = false; error.scrollIntoView({ block: "nearest" }); }
  }

  function done(res) {
    app.textContent = "";
    var link = el("a", { href: res.url, target: "_blank", rel: "noopener", text: res.id });
    app.appendChild(card("Готово", [
      el("div.note.ok", {}, [res.parent ? "Создана подзадача " : "Создан тикет ", link, res.parent ? " в тикете " + res.parent + "." : "."]),
      res.unfilled.length ? el("div.note.warn", { text: "Остались пустыми: " + res.unfilled.join(", ") + "." }) : null,
      el("div.actions", {}, [
        el("a.btn.primary", { href: res.url, target: "_blank", rel: "noopener", text: "Открыть тикет" }),
        el("button.btn", { text: "Скопировать ссылку", onclick: function (e) {
          navigator.clipboard.writeText(res.url).then(function () { e.target.textContent = "Скопировано"; });
        } }),
        el("button.btn", { text: "Закрыть", onclick: function () { window.close(); } })
      ])
    ]));
  }

  U.send("status").then(build).catch(function (e) {
    app.textContent = "";
    app.appendChild(el("div.note.err", { text: e.message }));
  });
})();
