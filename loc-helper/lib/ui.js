// Общие кусочки интерфейса для страниц Band и Tracker: окно-форма, выбор языков, всплывающая плашка.
// Всё рисуется в закрытом shadow DOM, чтобы стили сайта и расширения не мешали друг другу.
(function (root) {
  "use strict";
  var B = root.LocBrief;

  // Оформление лежит в theme.css (общий файл с окошком и настройками) и подключается внутрь shadow DOM.
  // Шрифт объявляется в самом документе: @font-face внутри shadow DOM браузер не учитывает.
  var host = null, shadow = null;
  function layer() {
    if (host && host.isConnected) return shadow;
    host = document.createElement("div");
    host.id = "loc-helper-layer";
    shadow = host.attachShadow({ mode: "closed" });
    var base = document.createElement("style");
    base.textContent = ":host{all:initial}";
    shadow.appendChild(base);
    var theme = document.createElement("link");
    theme.rel = "stylesheet";
    theme.href = chrome.runtime.getURL("theme.css");
    // Пока тема не загрузилась, ничего не показываем — иначе форма мелькнёт без оформления.
    host.style.visibility = "hidden";
    var reveal = function () { host.style.visibility = ""; };
    theme.addEventListener("load", reveal);
    theme.addEventListener("error", reveal);
    setTimeout(reveal, 1500);
    shadow.appendChild(theme);
    if (!document.getElementById("loc-helper-fonts")) {
      var fonts = document.createElement("link");
      fonts.id = "loc-helper-fonts";
      fonts.rel = "stylesheet";
      fonts.href = chrome.runtime.getURL("fonts.css");
      (document.head || document.documentElement).appendChild(fonts);
    }
    document.documentElement.appendChild(host);
    return shadow;
  }

  // el("div.note.warn", {text: "…"}, [children])
  function el(spec, props, kids) {
    var parts = spec.split("."), node = document.createElement(parts[0] || "div");
    if (parts.length > 1) node.className = parts.slice(1).join(" ");
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), props[k]);
      else if (k in node && k !== "list") node[k] = props[k];
      else node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function field(label, control) { return el("label", {}, [label, control]); }

  function modal(title) {
    var body = el("div.body"), foot = el("div.foot");
    var veil = el("div.veil", {}, [el("div.win", { role: "dialog", "aria-modal": "true", "aria-label": title }, [
      el("div.head", {}, [el("h2", { text: title }), el("button.x", { text: "×", title: "Закрыть", onclick: close })]),
      body, foot
    ])]);
    function onKey(e) { if (e.key === "Escape") close(); }
    function close() { veil.remove(); document.removeEventListener("keydown", onKey, true); }
    // Сайт под окном не должен ловить нажатия клавиш, пока мы печатаем в форме.
    ["keydown", "keyup", "keypress"].forEach(function (t) { veil.addEventListener(t, function (e) { e.stopPropagation(); }); });
    document.addEventListener("keydown", onKey, true);
    layer().appendChild(veil);
    return { body: body, foot: foot, close: close };
  }

  // Чипы языков: выбранные из брифа + остальные известные + «свой».
  function langPicker(selected) {
    var chosen = {}, order = [], box = el("div.chips");
    function add(lang, on) {
      if (order.some(function (l) { return l.code === lang.code; })) { if (on) chosen[lang.code] = true; return; }
      order.push(lang);
      if (on) chosen[lang.code] = true;
    }
    (selected || []).forEach(function (l) { add(l, true); });
    B.LANGS.filter(function (l) { return l.code !== "ru"; }).forEach(function (l) { add(l, false); });
    function draw() {
      box.textContent = "";
      order.forEach(function (l) {
        box.appendChild(el("button.chip", {
          type: "button", text: l.name, "aria-pressed": chosen[l.code] ? "true" : "false",
          onclick: function () { chosen[l.code] = !chosen[l.code]; draw(); }
        }));
      });
      box.appendChild(el("button.chip.add", {
        type: "button", text: "+ свой", onclick: function () {
          var name = (prompt("Название языка или локали") || "").trim();
          if (name) { add(B.language(name), true); draw(); }
        }
      }));
    }
    draw();
    return { el: box, get: function () { return order.filter(function (l) { return chosen[l.code]; }); } };
  }

  // Поле-список из Tracker. Короткий список с несколькими значениями — чипы; один вариант — выпадающий список;
  // длинный список (сотни заказчиков) — строка поиска с подсказками.
  var seq = 0;
  function choiceInput(def, selected) {
    var chosen = (selected || []).slice(), box = el("div"), byLabel = {};
    def.options.forEach(function (o) { byLabel[o.label.trim().toLowerCase()] = o; });
    function has(o) { return chosen.some(function (c) { return c.id === o.id; }); }

    if (!def.multiple && def.options.length <= 30) {
      var sel = el("select");
      if (!def.required) sel.appendChild(el("option", { value: "", text: "не выбрано" }));
      def.options.forEach(function (o) { sel.appendChild(el("option", { value: o.id, text: o.label })); });
      sel.value = chosen[0] ? chosen[0].id : (def.required && def.options[0] ? sel.value : "");
      box.appendChild(sel);
      return { el: box, get: function () { return def.options.filter(function (o) { return o.id === sel.value; }); } };
    }

    var chips = el("div.chips"), search = null;
    function draw() {
      chips.textContent = "";
      var shown = def.multiple && def.options.length <= 20 ? def.options : chosen;
      shown.forEach(function (o) {
        chips.appendChild(el("button.chip", {
          type: "button", text: o.label + (shown === chosen ? " ×" : ""), "aria-pressed": has(o) ? "true" : "false",
          title: shown === chosen ? "Убрать" : "",
          onclick: function () {
            if (has(o)) chosen = chosen.filter(function (c) { return c.id !== o.id; });
            else chosen = def.multiple ? chosen.concat([o]) : [o];
            draw();
          }
        }));
      });
      chips.hidden = !shown.length;
    }
    if (!(def.multiple && def.options.length <= 20)) {
      var listId = "loc-dl-" + (++seq), dl = el("datalist", { id: listId });
      def.options.forEach(function (o) { dl.appendChild(el("option", { value: o.label })); });
      search = el("input", { type: "text", placeholder: "начните печатать: " + def.options.length + " вариантов" });
      search.setAttribute("list", listId);
      var take = function () {
        var o = byLabel[search.value.trim().toLowerCase()];
        if (!o) return;
        if (!has(o)) chosen = def.multiple ? chosen.concat([o]) : [o];
        search.value = "";
        draw();
      };
      search.addEventListener("input", take);
      search.addEventListener("change", take);
      box.appendChild(search);
      box.appendChild(dl);
      chips.style.marginTop = "6px";
    }
    box.appendChild(chips);
    draw();
    return { el: box, get: function () { return chosen.slice(); } };
  }

  function toast(text, link) {
    var t = el("div.toast", { role: "status" }, [text, link ? " " : null, link ? el("a", { href: link.url, target: "_blank", rel: "noopener", text: link.text }) : null]);
    layer().appendChild(t);
    setTimeout(function () { t.remove(); }, link ? 12000 : 5000);
  }

  // Запрос к фоновому скрипту. После обновления расширения старая страница теряет с ним связь — говорим об этом понятно.
  function send(type, payload) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, payload), function (res) {
          if (chrome.runtime.lastError || !res) return reject(new Error("Нет связи с расширением. Обновите страницу (F5)."));
          res.ok ? resolve(res.data) : reject(new Error(res.error));
        });
      } catch (e) {
        reject(new Error("Расширение обновилось. Обновите страницу (F5)."));
      }
    });
  }

  root.LocUI = { el: el, field: field, modal: modal, langPicker: langPicker, choiceInput: choiceInput, toast: toast, send: send, layer: layer };
})(self);
