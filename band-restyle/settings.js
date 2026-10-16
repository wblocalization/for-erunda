(function () {
  "use strict";
  var R = window.BAND_RESTYLE;
  var popup = /popup=1/.test(location.search);
  document.body.classList.add(popup ? "popup" : "full");
  var $ = function (id) { return document.getElementById(id); };

  var STYLES = {
    glass: { name: "Стекло", note: "Обои и стеклянные панели" },
    classic: { name: "Только цвета", note: "Палитра и шрифт" }
  };

  Object.keys(R.FONTS).forEach(function (id) {
    var f = R.FONTS[id];
    if (!f.file) return;
    ["cyrillic", "latin"].forEach(function (sub) {
      new FontFace("brs-" + id, "url(fonts/" + f.file + "-" + sub + "-wght-normal.woff2)", { weight: "100 900" })
        .load().then(function (ff) { document.fonts.add(ff); }, function () {});
    });
  });

  var cur = R.DEFAULTS, local = { images: [] };

  function save(patch) { cur = Object.assign({}, cur, patch); chrome.storage.sync.set(cur, render); }
  function saveLocal(patch, cb) {
    local = Object.assign({}, local, patch);
    chrome.storage.local.set(patch, function () {
      if (chrome.runtime.lastError) alert("Не получилось сохранить картинку: " + chrome.runtime.lastError.message);
      render();
      if (cb) cb();
    });
  }

  function btn(cls, html) { var b = document.createElement("button"); b.className = cls; b.innerHTML = html || ""; return b; }

  function wallTile(label, bg, active, onClick, onDelete) {
    var b = btn("wall" + (active ? " on" : ""), "<span></span>");
    b.querySelector("span").textContent = label;
    if (bg) b.style.backgroundImage = bg;
    b.onclick = onClick;
    if (onDelete) {
      var d = document.createElement("span");
      d.className = "del"; d.textContent = "✕"; d.title = "Удалить картинку";
      d.onclick = function (e) { e.stopPropagation(); onDelete(); };
      b.appendChild(d);
    }
    return b;
  }

  // Ряд кнопок-переключателей с кружком цвета (или без него).
  function seg(id, key, opts) {
    var box = $(id); box.innerHTML = "";
    opts.forEach(function (o) {
      var b = btn(cur[key] === o[0] ? "on" : "", (o[2] ? "<i></i>" : "") + "<span></span>");
      if (o[2]) b.querySelector("i").style.background = o[2];
      b.querySelector("span").textContent = o[1];
      b.onclick = function () { var p = {}; p[key] = o[0]; save(p); };
      box.appendChild(b);
    });
  }

  function render() {
    $("glassOnly").hidden = cur.style !== "glass";
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
        }));
    });
    var add = wallTile("+ Загрузить свою", null, false, function () { if (popup) chrome.runtime.openOptionsPage(); else $("wallFile").click(); });
    add.classList.add("add");
    walls.appendChild(add);
    $("dim").value = cur.dim;
    $("blur").value = cur.blur;

    var themes = $("themes"); themes.innerHTML = "";
    Object.keys(R.THEMES).forEach(function (id) {
      var t = R.THEMES[id];
      var sw = t.custom ? [cur.customColor, cur.customColor2] : t.swatch;
      var b = btn("theme" + (cur.theme === id ? " on" : ""),
        '<div class="sw"><span style="background:' + sw[0] + '"></span><span style="background:' + sw[1] + '"></span></div><b></b><small></small>');
      b.querySelector("b").textContent = t.name;
      b.querySelector("small").textContent = t.note || "";
      b.onclick = function () { save({ theme: id }); };
      themes.appendChild(b);
    });
    $("customColors").hidden = cur.theme !== "custom";
    if (document.activeElement !== $("customColor")) $("customColor").value = cur.customColor;
    if (document.activeElement !== $("customColor2")) $("customColor2").value = cur.customColor2;

    $("chatOpacity").value = cur.chatOpacity;
    $("radius").value = cur.radius;
    var accentDefault = th.t ? th.t.dark : "#A3307E";
    seg("sidebarTones", "sidebarTone", [["dark", "Тёмная", th.sidebar || "#2E2566"], ["light", "Светлая", th.t ? th.t.lighter : "#F4F4F6"]]);
    seg("headerTexts", "headerText", [["white", "Белый", "#FFFFFF"], ["dark", "Тёмный", "#1F2328"], ["custom", "Свой", cur.headerTextColor]]);
    seg("accentTexts", "accentText", [["theme", "По теме", accentDefault], ["custom", "Свой", cur.accentTextColor]]);
    seg("displayFonts", "displayFont", [["auto", "По теме"], ["on", "Декоративный (Unbounded)"], ["off", "Обычный"]]);
    $("headerTextRow").hidden = cur.style !== "glass";
    $("headerTextPick").hidden = cur.headerText !== "custom";
    $("accentTextPick").hidden = cur.accentText !== "custom";
    if (document.activeElement !== $("headerTextColor")) $("headerTextColor").value = cur.headerTextColor;
    if (document.activeElement !== $("accentTextColor")) $("accentTextColor").value = cur.accentTextColor;

    var fonts = $("fonts"); fonts.innerHTML = "";
    Object.keys(R.FONTS).forEach(function (id) {
      var f = R.FONTS[id];
      var b = btn("font" + (cur.font === id ? " on" : ""), "<span></span><small></small>");
      var name = b.querySelector("span");
      name.textContent = f.name;
      name.style.fontFamily = f.file ? "brs-" + id + ", sans-serif" : '"Open Sans", sans-serif';
      b.onclick = function () { save({ font: id }); };
      fonts.appendChild(b);
    });
  }

  function readImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, 2560 / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = function () { alert("Не получилось открыть файл " + file.name); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $("wallFile").onchange = function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    (function next(lastId) {
      var f = files.shift();
      if (!f) { if (lastId) save({ wallpaper: lastId, style: "glass" }); return; }
      readImage(f, function (data) {
        var id = "img" + Date.now() + Math.floor(Math.random() * 1000);
        saveLocal({ images: (local.images || []).concat([{ id: id, name: f.name.replace(/\.[^.]+$/, "").slice(0, 24), data: data }]) }, function () { next(id); });
      });
    })(null);
  };
  $("openFull").onclick = function () { chrome.runtime.openOptionsPage(); };

  ["dim", "blur", "chatOpacity", "radius", "customColor", "customColor2", "headerTextColor", "accentTextColor"].forEach(function (k) {
    var timer = null;
    $(k).oninput = function () {
      var v = this.type === "range" ? +this.value : this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { var p = {}; p[k] = v; save(p); }, 220);
    };
  });

  chrome.storage.sync.get(R.DEFAULTS, function (s) {
    cur = s;
    chrome.storage.local.get({ images: [] }, function (l) { local = l; render(); });
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === "local") chrome.storage.local.get({ images: [] }, function (l) { local = l; render(); });
  });
})();
