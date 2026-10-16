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
          var reading = s.readingImage && s.readingImage !== "none" &&
            (local.images || []).filter(function (i) { return i.id === s.readingImage; })[0];
          style.textContent = R.buildCss(s, urlFor, { wallpaper: wall, emptyImage: local.emptyImage,
            heroImage: hero ? hero.data : null, readingImage: reading ? reading.data : null });
          document.documentElement.classList.toggle("ors-glass", s.style === "glass");
          schedule();
        });
      });
    });
  }

  load();
  chrome.storage.onChanged.addListener(load);

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

  function firstName() {
    var btn = document.querySelector('button[aria-label^="Меню "]');
    if (!btn) return "";
    // «Меню Фамилия Имя Отчество с подменю» → Имя
    var parts = btn.getAttribute("aria-label").replace(/^Меню\s+/, "").replace(/\s+с подменю.*$/, "").split(/\s+/);
    return parts.length >= 2 ? parts[1] : parts[0];
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

    // Крупный текст на баннере.
    var headerView = document.getElementById("primaryHeaderView");
    var hero = document.querySelector(".ors-hero");
    if (heroOn && greetOn && headerView) {
      if (!hero) {
        hero = document.createElement("div");
        hero.className = "ors-hero";
        hero.appendChild(document.createElement("b"));
        hero.appendChild(document.createElement("span"));
        headerView.appendChild(hero);
      }
      var n = inboxUnread();
      var sub = DAYS[now.getDay()] + ", " + now.getDate() + " " + MONTHS[now.getMonth()] +
        (n ? " · " + n + " " + plural(n, "непрочитанное", "непрочитанных", "непрочитанных") + " во входящих" : "");
      setText(hero.firstChild, hello + " ✨");
      setText(hero.lastChild, sub);
    } else if (hero) hero.remove();
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
        if (n && n.classList && (n.classList.contains("ors-av") || n.classList.contains("ors-greet") || n.classList.contains("ors-hero") || (n.parentElement && n.parentElement.classList && n.parentElement.classList.contains("ors-hero")))) continue;
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
