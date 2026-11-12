// Страница настроек: подключение к Tracker и параметры напоминаний.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  function send(type, payload) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload), function (res) {
        if (chrome.runtime.lastError || !res) return reject(new Error("Расширение не отвечает. Обновите страницу настроек."));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    });
  }

  function fail(id, e) { $(id).textContent = e.message; $(id).hidden = false; }

  function render(st) {
    $("connected").hidden = !st.connected;
    $("connectForm").hidden = st.connected;
    $("prefs").hidden = !st.connected;
    if (!st.connected) return;
    $("connInfo").textContent = "Tracker подключён. Открытых задач в проекте: " + st.issues.length + ".";
    var dl = $("connDetails");
    dl.textContent = "";
    [["Пространство", st.ns.name + " (" + st.ns.code + ")"], ["Проект", st.project.name + " (" + st.project.code + ")"],
      ["Задача-образец", st.sample], ["Типы задач", st.types.map(function (t) { return t.name; }).join(", ") || "—"],
      ["Поле «Дедлайн»", st.deadlineField ? "найдено" : "не найдено: подсветка и напоминания работать не будут"]
    ].forEach(function (r) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0]; dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var me = $("me");
    me.textContent = "";
    me.appendChild(new Option("не выбрано", ""));
    st.people.forEach(function (p) { me.appendChild(new Option(p.name + (p.login ? " (" + p.login + ")" : ""), p.id)); });
    me.value = st.me ? st.me.id : "";
    $("scope").value = st.settings.scope;
    $("hours").value = st.settings.hoursBefore.join(", ");
    $("deadlineTime").value = st.settings.deadlineTime;
    $("remindAll").checked = st.settings.remindAll;
    $("urlTemplate").value = st.settings.urlTemplate;
  }

  $("connectForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("connect");
    $("connError").hidden = true;
    b.disabled = true; b.textContent = "Подключаю…";
    send("connect", { token: $("token").value, sample: $("sample").value, login: $("login").value })
      .then(function (st) { $("token").value = ""; render(st); })
      .catch(function (err) { fail("connError", err); })
      .then(function () { b.disabled = false; b.textContent = "Подключить"; });
  });

  $("disconnect").addEventListener("click", function () {
    if (!confirm("Токен, список задач и отмеченные напоминания будут стёрты из этого браузера. Отключить?")) return;
    send("disconnect").then(render).catch(function (e) { fail("connError", e); });
  });

  $("save").addEventListener("click", function () {
    $("prefsError").hidden = true;
    $("saved").textContent = "";
    var hours = $("hours").value.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!hours.length || hours.some(function (h) { return !(h > 0 && h <= 720); })) {
      return fail("prefsError", new Error("Часы до дедлайна — числа через запятую, например: 24, 3."));
    }
    var url = $("urlTemplate").value.trim();
    if (!/^https:\/\/tracker\.wb\.ru\/.*\{code\}/.test(url)) {
      return fail("prefsError", new Error("Ссылка должна начинаться с https://tracker.wb.ru/ и содержать {code}."));
    }
    var scope = $("scope").value, meId = $("me").value;
    if (scope !== "all" && !meId) return fail("prefsError", new Error("Чтобы показывать только свои задачи, выберите себя в списке «Кто я»."));
    var b = $("save");
    b.disabled = true;
    send("saveSettings", {
      me: meId ? { id: meId } : null,
      settings: { scope: scope, hoursBefore: hours, deadlineTime: $("deadlineTime").value || "18:00", remindAll: $("remindAll").checked, urlTemplate: url }
    }).then(function (st) {
      render(st);
      $("saved").textContent = st.lastError ? "" : "Сохранено.";
      if (st.lastError) fail("prefsError", new Error("Сохранено, но список задач обновить не удалось: " + st.lastError));
    }).catch(function (e) { fail("prefsError", e); }).then(function () { b.disabled = false; });
  });

  $("diagnose").addEventListener("click", function () {
    var b = $("diagnose");
    $("connError").hidden = true;
    b.disabled = true; b.textContent = "Собираю…";
    send("diagnose").then(function (data) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "loc-helper-fields.json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }).catch(function (e) { fail("connError", e); })
      .then(function () { b.disabled = false; b.textContent = "Скачать описание полей"; });
  });

  $("test").addEventListener("click", function () {
    chrome.notifications.create("loc-test-" + Date.now(), {
      type: "basic", iconUrl: "icons/icon128.png", title: "LOCAL-0000 · Пробная задача", message: "До дедлайна 3 ч (так выглядит напоминание)", priority: 2
    });
  });

  send("status").then(render).catch(function (e) { $("connectForm").hidden = false; fail("connError", e); });
})();
