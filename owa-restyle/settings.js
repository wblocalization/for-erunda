(function () {
  "use strict";
  var R = window.OWA_RESTYLE;
  var popup = /popup=1/.test(location.search);
  document.body.classList.add(popup ? "popup" : "full");
  var $ = function (id) { return document.getElementById(id); };

  var STYLES = {
    glass: { name: "Стекло", note: "Обои, карточки, украшения" },
    classic: { name: "Классика", note: "Только цвета и шрифт" }
  };

  // Шрифты для превью прямо в списке.
  Object.keys(R.FONTS).forEach(function (id) {
    var f = R.FONTS[id];
    if (!f.file) return;
    ["cyrillic", "latin"].forEach(function (sub) {
      new FontFace("ors-" + id, "url(fonts/" + f.file + "-" + sub + "-wght-normal.woff2)", { weight: "100 900" })
        .load().then(function (ff) { document.fonts.add(ff); }, function () {});
    });
  });

  var cur = R.DEFAULTS, local = { images: [], emptyImage: null };

  function save(patch) {
    cur = Object.assign({}, cur, patch);
    chrome.storage.sync.set(cur, render);
  }

  function saveLocal(patch, cb) {
    local = Object.assign({}, local, patch);
    chrome.storage.local.set(patch, function () {
      if (chrome.runtime.lastError) alert("Не получилось сохранить картинку: " + chrome.runtime.lastError.message);
      render();
      if (cb) cb();
    });
  }

  function btn(cls, html) {
    var b = document.createElement("button");
    b.className = cls;
    b.innerHTML = html || "";
    return b;
  }

  function wallTile(label, bg, active, onClick, onDelete) {
    var b = btn("wall" + (active ? " on" : ""), "<span></span>");
    b.querySelector("span").textContent = label;
    if (bg) b.style.backgroundImage = bg;
    b.onclick = onClick;
    if (onDelete) {
      var d = document.createElement("span");
      d.className = "del";
      d.textContent = "✕";
      d.title = "Удалить картинку";
      d.onclick = function (e) { e.stopPropagation(); onDelete(); };
      b.appendChild(d);
    }
    return b;
  }

  // Галерея «своих» картинок для одного места (шапка, виджет, область чтения).
  function gallery(id, key, noneLabel, noneValue, posKey) {
    var box = $(id); box.innerHTML = "";
    var none = wallTile(noneLabel, null, !cur[key] || cur[key] === noneValue, function () { var p = {}; p[key] = noneValue; save(p); });
    none.style.background = "repeating-linear-gradient(45deg,#f1eff6 0 8px,#fafafa 8px 16px)";
    none.querySelector("span").style.color = "#6b7280";
    none.querySelector("span").style.background = "none";
    box.appendChild(none);
    (local.images || []).forEach(function (img) {
      var tile = wallTile(img.name || "Моя картинка", "url(" + img.data + ")", cur[key] === img.id, function () { var p = {}; p[key] = img.id; save(p); });
      tile.style.backgroundPosition = "center " + cur[posKey] + "%";
      box.appendChild(tile);
    });
    var add = wallTile("+ Загрузить", null, false, function () {
      if (popup) chrome.runtime.openOptionsPage(); else { uploadTarget = key; $("wallFile").click(); }
    });
    add.classList.add("add");
    box.appendChild(add);
  }

  // Ряд кнопок-переключателей с кружком цвета.
  function seg(id, key, opts) {
    var box = $(id); box.innerHTML = "";
    opts.forEach(function (o) {
      var b = btn(cur[key] === o[0] ? "on" : "", "<i></i><span></span>");
      b.querySelector("i").style.background = o[2];
      b.querySelector("span").textContent = o[1];
      b.onclick = function () {
        var p = {}; p[key] = o[0];
        if (key === "accentText" && o[0] === "custom" && !cur.accentTextColor) p.accentTextColor = o[2];
        save(p);
      };
      box.appendChild(b);
    });
  }

  function render() {
    var glass = cur.style === "glass";
    $("glassOnly").hidden = !glass;
    $("glassOnly2").hidden = !glass;
    $("glassOnly3").hidden = !glass;
    $("heroWrap").hidden = (+cur.heroHeight || 50) <= 50;
    $("openFull").hidden = !popup;

    var st = $("styles"); st.innerHTML = "";
    Object.keys(STYLES).forEach(function (id) {
      var b = btn(cur.style === id ? "on" : "", "<b></b><small></small>");
      b.querySelector("b").textContent = STYLES[id].name;
      b.querySelector("small").textContent = STYLES[id].note;
      b.onclick = function () { save({ style: id }); };
      st.appendChild(b);
    });

    var th = R.themeFor(cur) || {};
    var walls = $("walls"); walls.innerHTML = "";
    var themeBg = th.wallpaper ? "url(" + th.wallpaper + ")" :
      (th.t ? "linear-gradient(135deg," + th.t.tertiary + "," + th.t.light + "," + th.t.lighterAlt + ")" : "linear-gradient(135deg,#ddd,#f5f5f5)");
    walls.appendChild(wallTile("По теме", themeBg, cur.wallpaper === "theme", function () { save({ wallpaper: "theme" }); }));
    (local.images || []).forEach(function (img) {
      walls.appendChild(wallTile(img.name || "Моя картинка", "url(" + img.data + ")", cur.wallpaper === img.id,
        function () { save({ wallpaper: img.id }); },
        function () {
          if (!confirm("Удалить эту картинку?")) return;
          saveLocal({ images: local.images.filter(function (x) { return x.id !== img.id; }) });
          if (cur.wallpaper === img.id) save({ wallpaper: "theme" });
          if (cur.heroImage === img.id) save({ heroImage: "wallpaper" });
          if (cur.readingImage === img.id) save({ readingImage: "none" });
          if (cur.widgetImage === img.id) save({ widgetImage: "none" });
        }));
    });
    var add = wallTile("+ Загрузить свою", null, false, function () {
      if (popup) chrome.runtime.openOptionsPage(); else { uploadTarget = "wallpaper"; $("wallFile").click(); }
    });
    add.classList.add("add");
    walls.appendChild(add);

    gallery("heroes", "heroImage", "Как фон", "wallpaper", "heroPos");
    gallery("widgets", "widgetImage", "Цвет темы", "none", "widgetPos");
    gallery("readings", "readingImage", "Без картинки", "none", "readingPos");
    $("readingPosWrap").hidden = !cur.readingImage || cur.readingImage === "none";
    $("widgetPosWrap").hidden = !cur.widgetImage || cur.widgetImage === "none";
    $("widgetWrap").hidden = cur.heroLayout === "wide" || (+cur.heroHeight || 50) < 150;

    var lay = $("heroLayouts"); lay.innerHTML = "";
    [["split", "Баннер + виджет", "Картинка слева, приветствие и созвоны справа"], ["wide", "Один баннер", "Картинка на всю ширину"]].forEach(function (o) {
      var b = btn((cur.heroLayout || "split") === o[0] ? "on" : "", "<b></b><small></small>");
      b.querySelector("b").textContent = o[1];
      b.querySelector("small").textContent = o[2];
      b.onclick = function () { save({ heroLayout: o[0] }); };
      lay.appendChild(b);
    });

    $("heroHeight").value = cur.heroHeight;
    $("heroPos").value = cur.heroPos;

    $("dim").value = cur.dim;
    $("blur").value = cur.blur;

    var themes = $("themes"); themes.innerHTML = "";
    Object.keys(R.THEMES).forEach(function (id) {
      var t = R.THEMES[id];
      var sw = t.custom ? [cur.customColor || t.swatch[0], cur.customColor2 || t.swatch[1]] : t.swatch;
      var b = btn("theme" + (cur.theme === id ? " on" : ""),
        '<div class="sw"><span style="background:' + sw[0] + '"></span><span style="background:' + sw[1] + '"></span></div><b></b><small></small>');
      b.querySelector("b").textContent = t.name;
      b.querySelector("small").textContent = t.note || "";
      b.onclick = function () { save({ theme: id }); };
      themes.appendChild(b);
    });

    $("customColors").hidden = cur.theme !== "custom";
    if (document.activeElement !== $("customColor")) $("customColor").value = cur.customColor || "#E0457B";
    if (document.activeElement !== $("customColor2")) $("customColor2").value = cur.customColor2 || "#7C5BB0";

    var th2 = R.themeFor(cur) || {};
    var accentDefault = th2.t ? th2.t.primary : "#C23F8C";
    seg("heroTexts", "heroText", [["white", "Белый", "#FFFFFF"], ["dark", "Тёмный", "#1F2328"], ["custom", "Свой", cur.heroTextColor || "#FFFFFF"]]);
    seg("accentTexts", "accentText", [["theme", "По теме", accentDefault], ["custom", "Свой", cur.accentTextColor || accentDefault]]);
    $("heroTextRow").hidden = cur.style !== "glass";
    $("heroTextPick").hidden = cur.heroText !== "custom";
    $("accentTextPick").hidden = cur.accentText !== "custom";
    if (document.activeElement !== $("heroTextColor")) $("heroTextColor").value = cur.heroTextColor || "#FFFFFF";
    if (document.activeElement !== $("accentTextColor")) $("accentTextColor").value = cur.accentTextColor || accentDefault;

    var fonts = $("fonts"); fonts.innerHTML = "";
    Object.keys(R.FONTS).forEach(function (id) {
      var f = R.FONTS[id];
      var b = btn("font" + (cur.font === id ? " on" : ""), "<span></span><small></small>");
      var name = b.querySelector("span");
      name.textContent = f.name;
      name.style.fontFamily = f.file ? "ors-" + id + ", sans-serif" :
        f.local ? f.local.map(function (n) { return '"' + n + '"'; }).join(",") + ", sans-serif" : '"Segoe UI", sans-serif';
      b.querySelector("small").textContent = f.note || "";
      b.onclick = function () { save({ font: id }); };
      fonts.appendChild(b);
    });

    document.querySelectorAll(".toggles input").forEach(function (cb) {
      cb.checked = cur[cb.dataset.key] !== false;
    });

    $("emptyPreview").style.backgroundImage = local.emptyImage ? "url(" + local.emptyImage + ")" : "none";
    $("emptyPreview").textContent = "";
    if (!local.emptyImage) {
      $("emptyPreview").style.backgroundImage = "none";
      $("emptyPreview").textContent = "Стандартная";
    }
    $("emptyReset").hidden = !local.emptyImage;

    var cs = local.calendarStatus;
    $("calStatus").textContent = !cs ? "Созвоны загрузятся, когда откроешь почту." :
      cs.ok ? "Календарь подключён: созвонов сегодня — " + cs.count + "." :
      "Не получилось загрузить созвоны. Пришли этот текст — поправлю:\n" + cs.error;
  }

  // Уменьшаем картинку, чтобы не раздувать хранилище: фон до 2560px (JPEG), «пустые места» до 600px (PNG).
  function readImage(file, maxSide, type, quality, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL(type, quality));
      };
      img.onerror = function () { alert("Не получилось открыть файл " + file.name); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  var uploadTarget = "wallpaper";
  $("wallFile").onchange = function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    (function next(lastId) {
      var f = files.shift();
      if (!f) {
        if (lastId) { var p = { style: "glass" }; p[uploadTarget] = lastId; save(p); }
        uploadTarget = "wallpaper";
        return;
      }
      readImage(f, 2560, "image/jpeg", 0.88, function (data) {
        var id = "img" + Date.now() + Math.floor(Math.random() * 1000);
        var name = f.name.replace(/\.[^.]+$/, "").slice(0, 24);
        saveLocal({ images: (local.images || []).concat([{ id: id, name: name, data: data }]) }, function () { next(id); });
      });
    })(null);
  };

  $("emptyUpload").onclick = function () {
    if (popup) chrome.runtime.openOptionsPage(); else $("emptyFile").click();
  };
  $("emptyFile").onchange = function (e) {
    var f = e.target.files[0];
    e.target.value = "";
    if (f) readImage(f, 600, "image/png", undefined, function (data) { saveLocal({ emptyImage: data }); });
  };
  $("emptyReset").onclick = function () { saveLocal({ emptyImage: null }); };
  $("openFull").onclick = function () { chrome.runtime.openOptionsPage(); };

  ["dim", "blur", "heroHeight", "heroPos", "readingPos", "widgetPos"].forEach(function (k) {
    var timer = null;
    $(k).oninput = function () {
      var v = +this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { var p = {}; p[k] = v; save(p); }, 200);
    };
  });
  document.querySelectorAll(".toggles input").forEach(function (cb) {
    cb.onchange = function () { var p = {}; p[cb.dataset.key] = cb.checked; save(p); };
  });

  ["customColor", "customColor2", "heroTextColor", "accentTextColor"].forEach(function (k) {
    var timer = null;
    $(k).oninput = function () {
      var v = this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { var p = {}; p[k] = v; save(p); }, 250);
    };
  });

  var nameTimer = null;
  $("greetingName").oninput = function () {
    var v = this.value;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(function () { save({ greetingName: v }); }, 400);
  };

  chrome.storage.sync.get(R.DEFAULTS, function (s) {
    cur = s;
    chrome.storage.local.get({ images: [], emptyImage: null, calendarStatus: null }, function (l) { local = l; render(); });
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === "local") chrome.storage.local.get({ images: [], emptyImage: null, calendarStatus: null }, function (l) { local = l; render(); });
  });
})();
