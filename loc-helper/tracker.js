// Tracker: подсветка карточек по дедлайну (жёлтый — сегодня, красный — просрочено)
// и кнопка «Подзадачи по языкам» в открытой задаче.
// Сроки берём из списка, который фоновый скрипт получает через API, а на странице ищем только номера задач.
(function () {
  "use strict";
  var U = self.LocUI, B = self.LocBrief, el = U.el;
  var CODE = /^[A-ZА-Я][A-ZА-Я0-9_]*-\d+$/;
  var byId = {}, connected = false, types = [];

  var style = document.createElement("style");
  style.textContent =
    '[data-loc-due="overdue"]{box-shadow:inset 0 0 0 2px #E5484D,0 2px 8px rgba(229,72,77,.25)!important;background-image:linear-gradient(rgba(229,72,77,.09),rgba(229,72,77,.09))!important}' +
    '[data-loc-due="today"]{box-shadow:inset 0 0 0 2px #F5B700,0 2px 8px rgba(245,183,0,.25)!important;background-image:linear-gradient(rgba(245,183,0,.12),rgba(245,183,0,.12))!important}' +
    '[data-loc-due="tomorrow"]{box-shadow:inset 0 0 0 1px #F5B700!important}' +
    ".loc-due{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;font:600 11px/18px Inter,system-ui,sans-serif;vertical-align:middle;white-space:nowrap}" +
    '.loc-due[data-u="overdue"]{background:#E5484D;color:#fff}.loc-due[data-u="today"]{background:#F5B700;color:#3b2c00}' +
    '.loc-due[data-u="tomorrow"]{background:#FFF1C2;color:#6b4a00}.loc-due[data-u="later"]{background:#ECE9F5;color:#4a4660}' +
    ".loc-clone{margin-left:10px;border:0;border-radius:999px;padding:3px 11px;font:600 12px/1.5 Inter,system-ui,sans-serif;background:#7a5af8;color:#fff;cursor:pointer;vertical-align:middle}";
  (document.head || document.documentElement).appendChild(style);

  function refresh() {
    return U.send("status").then(function (st) {
      connected = st.connected;
      types = st.types;
      byId = {};
      st.issues.forEach(function (it) { byId[it.id] = it; });
      paint();
    }).catch(function () { /* расширение перезагрузили — подсветка вернётся после F5 */ });
  }

  function label(urgency, deadline) {
    if (urgency === "overdue") return "просрочено " + B.formatDeadline(deadline);
    if (urgency === "today") return "сегодня " + B.formatDeadline(deadline).slice(6);
    if (urgency === "tomorrow") return "завтра " + B.formatDeadline(deadline).slice(6);
    return "до " + B.formatDeadline(deadline).slice(0, 5);
  }

  function paint() {
    var now = Date.now();
    document.querySelectorAll('[class*="issue-card_id"]').forEach(function (idEl) {
      var code = (idEl.firstChild && idEl.firstChild.nodeType === 3 ? idEl.firstChild.textContent : idEl.textContent).trim();
      var card = idEl.closest('[class*="card_card"]') || idEl.parentElement;
      var it = CODE.test(code) ? byId[code] : null, badge = idEl.querySelector(".loc-due");
      var u = it && it.deadline ? B.urgency(it.deadline, now) : "none";
      if (u === "none") {
        if (badge) badge.remove();
        if (card) card.removeAttribute("data-loc-due");
        return;
      }
      if (card && card.getAttribute("data-loc-due") !== u) card.setAttribute("data-loc-due", u);
      var text = label(u, it.deadline);
      if (!badge) { badge = el("span.loc-due"); idEl.appendChild(badge); }
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.getAttribute("data-u") !== u) badge.setAttribute("data-u", u);
    });
    header();
  }

  // Открытая задача: запоминаем вид ссылки и добавляем кнопку клонирования.
  function header() {
    var h = document.querySelector('[data-testid="issue_header_current_code"]');
    if (!h) return;
    var code = h.textContent.trim().split(/\s/)[0];
    if (!CODE.test(code)) return;
    if (location.href.indexOf(code) >= 0 && header.learned !== location.pathname) {
      header.learned = location.pathname;
      U.send("learnUrl", { template: location.href.split("#")[0].replace(code, "{code}") }).catch(function () {});
    }
    var host = h.parentElement, btn = host && host.querySelector(".loc-clone");
    if (!connected || !host) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = el("button.loc-clone", { type: "button", text: "Подзадачи по языкам", title: "Создать копии этой задачи для переводчиков" });
      btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); cloneForm(btn.dataset.code); });
      h.insertAdjacentElement("afterend", btn);
    }
    btn.dataset.code = code;
  }

  function cloneForm(code) {
    var m = U.modal("Подзадачи по языкам · " + code);
    var langs = U.langPicker([]), type = el("select"), error = el("div.note.err", { hidden: true });
    type.appendChild(el("option", { value: "", text: "как у этой задачи" }));
    types.forEach(function (t) { type.appendChild(el("option", { value: t.alias, text: t.name })); });
    m.body.appendChild(el("div.note", { text: "Для каждого языка создаётся подзадача с тем же описанием и полями. Вложения-файлы не копируются." }));
    m.body.appendChild(U.field("Языки", langs.el));
    m.body.appendChild(U.field("Тип подзадач", type));
    m.body.appendChild(error);
    var go = el("button.btn.primary", { text: "Создать подзадачи" });
    m.foot.appendChild(el("button.btn", { text: "Отмена", onclick: m.close }));
    m.foot.appendChild(go);
    go.addEventListener("click", function () {
      var chosen = langs.get();
      error.hidden = true;
      if (!chosen.length) { error.textContent = "Выберите хотя бы один язык."; error.hidden = false; return; }
      go.disabled = true;
      go.textContent = "Создаю…";
      U.send("clone", { code: code, languages: chosen, opts: { typeAlias: type.value } }).then(function (res) {
        m.body.textContent = "";
        m.foot.textContent = "";
        if (res.made.length) {
          var ok = el("div.note.ok", {}, ["Создано: "]);
          res.made.forEach(function (x, i) {
            ok.appendChild(el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.id }));
            ok.appendChild(document.createTextNode(" (" + x.lang + ")" + (i < res.made.length - 1 ? ", " : ".")));
          });
          m.body.appendChild(ok);
        }
        if (res.withoutFields) m.body.appendChild(el("div.note.warn", { text: "Tracker не принял поля исходной задачи, поэтому подзадачи созданы только с названием и описанием." }));
        if (res.errors.length) m.body.appendChild(el("div.note.err", { text: "Не создано: " + res.errors.join("; ") }));
        m.foot.appendChild(el("button.btn.primary", { text: "Готово", onclick: function () { m.close(); refresh(); } }));
      }).catch(function (e) {
        go.disabled = false;
        go.textContent = "Создать подзадачи";
        error.textContent = e.message;
        error.hidden = false;
      });
    });
  }

  // Доска перерисовывается сама (React), поэтому следим за изменениями, но красим не чаще раза в 300 мс.
  var timer = null;
  new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; paint(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Список задач обновляет фоновый скрипт раз в 10 минут; страница перечитывает его раз в минуту.
  setInterval(refresh, 60000);
  refresh();
})();
