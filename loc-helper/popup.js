// Окошко расширения: задачи с дедлайнами по срочности и колокольчик напоминаний у каждой.
(function () {
  "use strict";
  var B = self.LocBrief, $ = function (id) { return document.getElementById(id); };
  var GROUPS = [["overdue", "Просрочено"], ["today", "Сегодня"], ["tomorrow", "Завтра"], ["later", "Позже"]];

  function send(type, payload) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload), function (res) {
        if (chrome.runtime.lastError || !res) return reject(new Error("Расширение не отвечает. Закройте и откройте окошко ещё раз."));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    });
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mine(it, st) {
    if (!st.me || st.settings.scope === "all") return true;
    return st.settings.scope === "creator" ? it.creatorId === st.me.id : it.executorId === st.me.id;
  }

  function render(st) {
    var list = $("list"), error = $("error");
    list.textContent = "";
    error.hidden = !st.lastError;
    error.textContent = st.lastError ? "Не удалось обновить список: " + st.lastError : "";
    fillResult(st);
    if (!st.connected) {
      $("meta").textContent = "";
      var e = node("div", "empty", "Tracker ещё не подключён. Нужен ваш API-токен и номер любой задачи локализации.");
      list.appendChild(e);
      return;
    }
    var items = st.issues.filter(function (it) { return it.deadline && mine(it, st); })
      .sort(function (a, b) { return a.deadline - b.deadline; });
    var noDeadline = st.issues.filter(function (it) { return !it.deadline && mine(it, st); }).length;
    var when = st.lastSync ? new Date(st.lastSync).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "—";
    $("meta").textContent = st.project.name + " · с дедлайном: " + items.length + (noDeadline ? " · без дедлайна: " + noDeadline : "") + " · обновлено в " + when;
    if (!items.length) {
      list.appendChild(node("div", "empty", st.deadlineField ? "Открытых задач с дедлайном нет." : "В задачах не нашлось поля «Дедлайн». Проверьте задачу-образец в настройках."));
      return;
    }
    GROUPS.forEach(function (g) {
      var part = items.filter(function (it) { return B.urgency(it.deadline, st.now) === g[0]; });
      if (!part.length) return;
      list.appendChild(node("div", "group " + g[0], g[1] + " · " + part.length));
      part.forEach(function (it) {
        var row = node("div", "item"), link = node("a", "", it.id + " · " + it.name);
        link.href = st.settings.urlTemplate.replace("{code}", it.id);
        link.target = "_blank";
        var sub = node("div", "sub");
        sub.appendChild(node("span", "due " + g[0], B.formatDeadline(it.deadline)));
        sub.appendChild(document.createTextNode([it.state, it.executor].filter(Boolean).join(" · ")));
        var auto = st.settings.remindAll, on = !!st.reminders[it.id];
        var bell = node("button", "bell", "🔔");
        bell.setAttribute("aria-pressed", on || auto ? "true" : "false");
        bell.title = auto ? "Напоминания включены для всех задач (см. настройки)" : (on ? "Напоминание включено. Нажмите, чтобы выключить" : "Напомнить о дедлайне");
        bell.setAttribute("aria-label", bell.title);
        bell.disabled = auto;
        bell.addEventListener("click", function () {
          send("setReminder", { id: it.id, on: !on }).then(load).catch(show);
        });
        row.appendChild(link); row.appendChild(bell); row.appendChild(sub);
        list.appendChild(row);
      });
    });
  }

  // ---------- Результат в тикет ----------
  // Берём открытую вкладку (страницу вики, документ, перевод) и дописываем ссылку на неё в описание выбранного тикета.
  var CODE = /^[A-ZА-Я0-9_]+-\d+/i;

  function pageTitle(tab) {
    var t = (tab.title || "").trim(), host = "";
    try { host = new URL(tab.url).hostname; } catch (e) { /* не страница */ }
    // В WB Wiki заголовок вкладки — «Страница – Пространство – Wiki»: оставляем название страницы.
    if (/(^|\.)wiki\.wb\.ru$/.test(host)) t = t.split(/\s+[–—-]\s+/)[0];
    return t;
  }

  function fillResult(st) {
    var list = $("resTickets");
    list.textContent = "";
    st.issues.slice().sort(function (a, b) {
      var am = st.me && a.executorId === st.me.id ? 0 : 1, bm = st.me && b.executorId === st.me.id ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name, "ru");
    }).forEach(function (it) { list.appendChild(new Option("", it.id + " · " + it.name)); });
    $("result").hidden = !st.connected;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !/^https?:/.test(tab.url || "")) { $("resHint").textContent = "Откройте вкладку со страницей, которую нужно добавить."; return; }
    $("resTitle").value = pageTitle(tab);
    $("resUrl").value = tab.url;
  });

  $("resGo").addEventListener("click", function () {
    var msg = $("resMsg"), b = $("resGo");
    var code = ($("resTicket").value.trim().match(CODE) || [""])[0], url = $("resUrl").value.trim();
    var title = $("resTitle").value.trim().replace(/[\[\]]/g, ""), note = $("resNote").value.trim();
    var say = function (cls, text) { msg.className = "note " + cls; msg.textContent = text; msg.hidden = false; };
    if (!code) return say("err", "Укажите тикет: начните печатать номер или название и выберите из списка.");
    if (!/^https?:\/\//.test(url)) return say("err", "Нужна ссылка, которая начинается с http.");
    var block = "Результат: [" + (title || url) + "](" + url + ")" + (note ? "\n" + note : "");
    b.disabled = true; b.textContent = "Дописываю…";
    send("appendResult", { code: code, block: block }).then(function (res) {
      if (res.lost.length) say("warn", "Ссылка добавлена в " + res.id + ", но Tracker очистил поля: " + res.lost.join(", ") + ". Проверьте тикет.");
      else if (!res.written) say("warn", "Tracker принял запрос, но ссылки в описании " + res.id + " не видно. Проверьте тикет.");
      else say("ok", "Добавлено в описание " + res.id + " · " + res.name);
      $("resNote").value = "";
    }).catch(function (e) { say("err", e.message); })
      .then(function () { b.disabled = false; b.textContent = "Дописать в описание"; });
  });

  function show(e) { $("error").hidden = false; $("error").textContent = e.message; }
  function load() { return send("status").then(render).catch(show); }

  $("settings").addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
  $("sync").addEventListener("click", function () {
    var b = $("sync");
    b.disabled = true; b.textContent = "Обновляю…";
    send("sync").then(render).catch(function (e) { return load().then(function () { show(e); }); })
      .then(function () { b.disabled = false; b.textContent = "Обновить"; });
  });
  load();
})();
