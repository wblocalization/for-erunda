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

  function render() {
    var glass = cur.style === "glass";
    $("glassOnly").hidden = !glass;
    $("glassOnly2").hidden = !glass;
    $("openFull").hidden = !popup;

    var st = $("styles"); st.innerHTML = "";
    Object.keys(STYLES).forEach(function (id) {
      var b = btn(cur.style === id ? "on" : "", "<b></b><small></small>");
      b.querySelector("b").textContent = STYLES[id].name;
      b.querySelector("small").textContent = STYLES[id].note;
      b.onclick = function () { save({ style: id }); };
      st.appendChild(b);
    });

    var th = R.THEMES[cur.theme] || {};
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
    var add = wallTile("+ Загрузить свою", null, false, function () {
      if (popup) chrome.runtime.openOptionsPage(); else $("wallFile").click();
    });
    add.classList.add("add");
    walls.appendChild(add);

    $("dim").value = cur.dim;
    $("blur").value = cur.blur;

    var themes = $("themes"); themes.innerHTML = "";
    Object.keys(R.THEMES).forEach(function (id) {
      var t = R.THEMES[id];
      var b = btn("theme" + (cur.theme === id ? " on" : ""),
        '<div class="sw"><span style="background:' + t.swatch[0] + '"></span><span style="background:' + t.swatch[1] + '"></span></div><b></b><small></small>');
      b.querySelector("b").textContent = t.name;
      b.querySelector("small").textContent = t.note || "";
      b.onclick = function () { save({ theme: id }); };
      themes.appendChild(b);
    });

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

  $("wallFile").onchange = function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    (function next(lastId) {
      var f = files.shift();
      if (!f) { if (lastId) save({ wallpaper: lastId, style: "glass" }); return; }
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

  ["dim", "blur"].forEach(function (k) {
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

  chrome.storage.sync.get(R.DEFAULTS, function (s) {
    cur = s;
    chrome.storage.local.get({ images: [], emptyImage: null }, function (l) { local = l; render(); });
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === "local") chrome.storage.local.get({ images: [], emptyImage: null }, function (l) { local = l; render(); });
  });
})();
