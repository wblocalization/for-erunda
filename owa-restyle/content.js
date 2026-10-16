// Вставляет стиль выбранной темы на страницу OWA и добавляет «живые» украшения:
// аватарки в списке писем, приветствие в шапке, иллюстрацию в пустой области чтения.
(function () {
  "use strict";
  var R = window.OWA_RESTYLE;
  var STYLE_ID = "owa-restyle-style";
  var settings = R.DEFAULTS;

  var style = document.createElement("style");
  style.id = STYLE_ID;
  (document.head || document.documentElement).appendChild(style);

  function urlFor(path) { return chrome.runtime.getURL(path); }

  function resolveWallpaper(s, local, cb) {
    var th = R.THEMES[s.theme] || {};
    if (s.wallpaper === "none") return cb(null);
    if (s.wallpaper && s.wallpaper !== "theme") {
      var img = (local.images || []).filter(function (i) { return i.id === s.wallpaper; })[0];
      if (img) return cb(img.data);
    }
    cb(th.wallpaper ? urlFor(th.wallpaper) : null);
  }

  function load() {
    chrome.storage.sync.get(R.DEFAULTS, function (s) {
      chrome.storage.local.get({ images: [], emptyImage: null }, function (local) {
        resolveWallpaper(s, local, function (wall) {
          settings = s;
          var hero = s.heroImage && s.heroImage !== "wallpaper" &&
            (local.images || []).filter(function (i) { return i.id === s.heroImage; })[0];
          var widget = s.widgetImage && s.widgetImage !== "none" &&
            (local.images || []).filter(function (i) { return i.id === s.widgetImage; })[0];
          var reading = s.readingImage && s.readingImage !== "none" &&
            (local.images || []).filter(function (i) { return i.id === s.readingImage; })[0];
          // В календаре OWA вёрстка завязана на ширину Segoe UI — там оставляем родной шрифт.
          var css = isCalendar() ? Object.assign({}, s, { font: "original" }) : s;
          style.textContent = R.buildCss(css, urlFor, { wallpaper: wall, emptyImage: local.emptyImage,
            heroImage: hero ? hero.data : null, readingImage: reading ? reading.data : null, widgetImage: widget ? widget.data : null });
          document.documentElement.classList.toggle("ors-glass", s.style === "glass");
          schedule();
        });
      });
    });
  }

  function isCalendar() { return /path=\/calendar/i.test(location.hash + location.search) || /\/calendar/i.test(location.pathname); }

  load();
  chrome.storage.onChanged.addListener(load);
  var wasCalendar = isCalendar();
  window.addEventListener("hashchange", function () {
    if (isCalendar() !== wasCalendar) { wasCalendar = isCalendar(); load(); }
  });

  // ---- Украшения в стиле «Стекло» ----

  var AV_COLORS = [
    ["#F7A777", "#E5638F"], ["#8E5BC0", "#C23F8C"], ["#4F94BF", "#7C5BB0"], ["#3FA58C", "#4F94BF"],
    ["#E9818F", "#9A5AAE"], ["#F2B35E", "#E97A5B"], ["#6A7FDB", "#9C6ADE"], ["#2E9AA6", "#3FA58C"]
  ];

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(name) {
    var words = name.replace(/["'«»()<>\[\]]/g, " ").trim().split(/[\s@._-]+/).filter(Boolean);
    if (!words.length) return "?";
    var a = words[0].charAt(0), b = words.length > 1 ? words[1].charAt(0) : "";
    return (a + b).toUpperCase();
  }

  function decorateList() {
    var on = settings.style === "glass" && settings.avatars !== false;
    var items = document.querySelectorAll('[role="option"]._lvv_C1, [role="option"].listItemDefaultBackground');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var av = it.querySelector(":scope > .ors-av");
      if (!on) {
        if (av) av.remove();
        it.classList.remove("ors-has-av");
        continue;
      }
      var from = it.querySelector(".lvHighlightFromClass") || it.querySelector("._lvv_L1");
      var name = from ? from.textContent.trim() : "";
      if (!name) continue;
      if (!av) {
        av = document.createElement("span");
        av.className = "ors-av";
        it.insertBefore(av, it.firstChild);
        it.classList.add("ors-has-av");
      }
      if (av.getAttribute("data-name") !== name) {
        var c = AV_COLORS[hash(name) % AV_COLORS.length];
        av.setAttribute("data-name", name);
        av.textContent = initials(name);
        av.style.background = "linear-gradient(135deg," + c[0] + "," + c[1] + ")";
      }
    }
  }

  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var DAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

  var SURNAME = /(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|ко|енко|ук|юк|ич|ян|дзе|швили|ова-|ой)$/i;

  // Имя для приветствия: из настроек, иначе из кнопки профиля OWA («Меню Фамилия Имя Отчество с подменю»).
  function firstName() {
    if (settings.greetingName && settings.greetingName.trim()) return settings.greetingName.trim();
    var btn = document.querySelector('button[aria-label^="Меню "], button[aria-label^="Menu "]');
    if (!btn) return "";
    var parts = btn.getAttribute("aria-label").replace(/^(Меню|Menu)\s+/, "").replace(/\s+(с подменю|with submenu).*$/i, "")
      .split(/\s+/).filter(Boolean);
    if (parts.length >= 3) return parts[1];                          // Фамилия Имя Отчество
    if (parts.length === 2) return SURNAME.test(parts[0]) ? parts[1] : parts[0]; // Фамилия Имя / Имя Фамилия
    return parts[0] || "";
  }

  function inboxUnread() {
    var name = document.querySelector('div[autoid="_n_a"] ._n_C4[title="Входящие"], div[autoid="_n_a"] ._n_C4[title="Inbox"]');
    var row = name && name.closest('[role="treeitem"]');
    var cnt = row && row.querySelector("._n_E4");
    var n = cnt ? parseInt(cnt.textContent.replace(/\D/g, ""), 10) : 0;
    return n || 0;
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  function decorateHeader() {
    var glass = settings.style === "glass";
    var heroOn = glass && (+settings.heroHeight || 50) > 50;
    var greetOn = glass && settings.greeting !== false;
    var now = new Date(), h = now.getHours();
    var hello = (h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер") +
      (firstName() ? ", " + firstName() : "");

    // Маленькое приветствие по центру шапки — когда баннер выключен.
    var center = document.querySelector("#O365_NavHeader .o365cs-nav-centerAlign");
    var greet = document.querySelector(".ors-greet");
    if (greetOn && !heroOn && center) {
      if (!greet) { greet = document.createElement("span"); greet.className = "ors-greet"; center.appendChild(greet); }
      setText(greet, hello + " ✨");
    } else if (greet) greet.remove();

    // Текст шапки: в режиме «баннер + виджет» он живёт в виджете справа, в режиме «широкая» — на баннере.
    var H = +settings.heroHeight || 50;
    var split = settings.heroLayout !== "wide" && H >= 150;
    var meetOn = heroOn && settings.meetings !== false && !!window.OWA_RESTYLE_MEETINGS;
    var headerView = document.getElementById("primaryHeaderView");

    // Приветствие и дата — на баннере (слева), созвоны — в виджете (справа) или справа на широком баннере.
    var hero = document.querySelector(".ors-hero");
    if (heroOn && greetOn && headerView) {
      if (!hero) {
        hero = document.createElement("div");
        hero.className = "ors-hero";
        hero.appendChild(document.createElement("b"));
        hero.appendChild(document.createElement("span"));
        hero.children[1].className = "ors-date";
        headerView.appendChild(hero);
      }
      var n = inboxUnread();
      setText(hero.children[0], hello + " ✨");
      setText(hero.children[1], DAYS[now.getDay()] + ", " + now.getDate() + " " + MONTHS[now.getMonth()] +
        (n ? " · " + n + " " + plural(n, "непрочитанное", "непрочитанных", "непрочитанных") + " во входящих" : ""));
    } else if (hero) hero.remove();

    var widget = document.querySelector(".ors-widget");
    if (meetOn && headerView) {
      if (!widget) {
        widget = document.createElement("div");
        widget.className = "ors-widget";
        widget.appendChild(document.createElement("span"));
        widget.appendChild(document.createElement("div"));
        widget.children[0].className = "ors-sum";
        widget.children[1].className = "ors-meet";
        headerView.appendChild(widget);
      }
      setText(widget.children[0], meetSummary);
      widget.children[0].hidden = !meetSummary;
      var meetBox = widget.children[1];
      var max = split ? Math.max(1, Math.min(6, Math.floor((H - 100) / 30))) : (H >= 200 ? 3 : H >= 150 ? 2 : 1);
      window.OWA_RESTYLE_MEETINGS.load().then(function (items) {
        renderMeetings(meetBox, items, max, false);
        var s = summarize(items, true);
        if (s !== meetSummary) { meetSummary = s; schedule(); }
      });
    } else {
      if (widget) widget.remove();
      meetSummary = "";
    }
  }

  var meetSummary = "";

  function calls(n) { return n + " " + plural(n, "созвон", "созвона", "созвонов"); }

  function short(s) { return s.length > 40 ? s.slice(0, 39) + "…" : s; }

  // Сводка для строки под приветствием.
  function summarize(items, split) {
    if (!items) return "";
    var now = new Date();
    var timed = items.filter(function (m) { return !m.allDay; });
    if (!timed.length) return "Сегодня без созвонов 🎉";
    var current = timed.filter(function (m) { return m.start <= now && m.end > now; })[0];
    var upcoming = timed.filter(function (m) { return m.start > now; });
    if (current) {
      if (split) return "Сегодня " + calls(timed.length) + ", сейчас идёт:";
      return "Сейчас созвон «" + short(current.subject) + "»" + (upcoming.length ? ", потом ещё " + calls(upcoming.length) : "");
    }
    if (!upcoming.length) return "Созвоны на сегодня закончились 🎉";
    if (split) return "Сегодня " + calls(timed.length) + (upcoming.length < timed.length ? ", осталось " + upcoming.length : "") + ":";
    return calls(timed.length) + " сегодня, " + (upcoming.length < timed.length ? "следующий" : "ближайший") + " в " + hhmm(upcoming[0].start);
  }

  function hhmm(d) { return d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(); }

  function inMinutes(ms) {
    var m = Math.round(ms / 60000);
    if (m < 60) return "через " + m + " мин";
    var h = Math.floor(m / 60), r = m % 60;
    return "через " + h + " ч" + (r ? " " + r + " мин" : "");
  }

  function renderMeetings(box, items, max, showDone) {
    if (!items) { if (box.childNodes.length) box.textContent = ""; return; } // не загрузилось — молчим
    var now = new Date();
    var big = max > 1;
    var allDay = items.filter(function (m) { return m.allDay; });
    var left = items.filter(function (m) { return !m.allDay && m.end > now; });
    var html = [];
    function chip(cls, time, subject, tail, title) {
      return '<a class="ors-chip ' + cls + '" href="/owa/#path=/calendar" title="' + esc(title) + '"><i>' + esc(time) + "</i><b>" +
        esc(subject) + "</b>" + (tail ? "<em>" + esc(tail) + "</em>" : "") + "</a>";
    }
    var show = (max === 1 || !showDone) ? Math.min(max, left.length) : (left.length > max ? max - 1 : max);
    left.slice(0, show).forEach(function (m, i) {
      var nowOn = m.start <= now;
      var tail = nowOn ? "сейчас" : (i === 0 || (left[0].start <= now && i === 1)) ? inMinutes(m.start - now) : "";
      html.push(chip(nowOn ? "now" : (tail ? "next" : ""), hhmm(m.start) + "–" + hhmm(m.end), m.subject, tail,
        m.subject + (m.location ? " · " + m.location : "")));
    });
    if (left.length > show && max > 1 && showDone) html.push('<a class="ors-chip more" href="/owa/#path=/calendar"><b>ещё ' + calls(left.length - show) + "</b></a>");
    if (!left.length && showDone) {
      html.push('<a class="ors-chip done" href="/owa/#path=/calendar"><b>' +
        (items.length - allDay.length ? "Созвоны на сегодня закончились 🎉" : "Сегодня без созвонов 🎉") + "</b></a>");
    }
    if (big && allDay.length && html.length < 4) html.unshift(chip("allday", "весь день", allDay[0].subject, "", allDay[0].subject));
    var out = html.join("");
    if (box.getAttribute("data-html") !== out) { box.setAttribute("data-html", out); box.innerHTML = out; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; });
  }

  // Длинные названия папок обрезаем многоточием, чтобы не наезжали на счётчики.
  function fitFolders() {
    var card = document.querySelector('div[autoid="_n_a"]');
    var names = card ? card.querySelectorAll("._n_C4") : [];
    var on = settings.style === "glass";
    if (!card) return;
    var right = card.getBoundingClientRect().right - 16;
    for (var i = 0; i < names.length; i++) {
      var el = names[i];
      if (!on) { el.classList.remove("ors-fit"); el.style.maxWidth = ""; continue; }
      el.classList.add("ors-fit");
      var row = el.closest('[role="treeitem"]');
      var cnt = row && row.querySelector("._n_F4");
      var cw = cnt && cnt.offsetWidth && cnt.textContent.trim() ? cnt.offsetWidth + 10 : 0;
      var max = Math.max(40, Math.floor(right - el.getBoundingClientRect().left - cw - 6));
      if (el.style.maxWidth !== max + "px") el.style.maxWidth = max + "px";
    }
  }

  function decorateFolders() {
    // Корневая папка ящика (имя владельца) получает иконку человека.
    var nodes = document.querySelectorAll('._n_N4 [role="treeitem"] ._n_C4');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].closest(".subfolders")) nodes[i].classList.add("ors-account");
    }
  }

  function decorateReading() {
    var pane = document.querySelector("._n_Y");
    if (!pane) return;
    // Письмо не открыто: в области чтения пусто или видна заглушка OWA «Чтобы прочитать сообщение…».
    var stub = pane.querySelector("._n_O2");
    var stubVisible = stub && stub.offsetParent !== null;
    var empty = settings.style === "glass" && (stubVisible || pane.innerText.trim().length === 0);
    pane.classList.toggle("ors-reading-empty", empty);
    pane.classList.toggle("ors-reading-stub", !!stubVisible);
  }

  // Держим наш стиль последним в <head>: так он перекрывает стили, которые OWA добавляет на ходу.
  function keepLast() {
    var head = document.head;
    if (head && head.lastElementChild !== style) head.appendChild(style);
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      if (!document.body) return;
      keepLast();
      decorateList();
      decorateHeader();
      decorateFolders();
      fitFolders();
      decorateReading();
    }, 150);
  }

  function start() {
    schedule();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var n = muts[i].target;
        if (n && n.classList && (n.classList.contains("ors-av") || n.classList.contains("ors-greet") || n.classList.contains("ors-hero") || (n.closest && n.closest(".ors-hero, .ors-widget")) || n.classList.contains("ors-widget") || (n.parentElement && n.parentElement.classList && n.parentElement.classList.contains("ors-hero")))) continue;
        schedule();
        return;
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(schedule, 60000); // обновить приветствие по времени суток
    window.addEventListener("resize", schedule);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
