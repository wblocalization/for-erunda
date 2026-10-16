(function () {
  "use strict";
  var R = window.OWA_RESTYLE;
  var themesEl = document.getElementById("themes");
  var fontsEl = document.getElementById("fonts");

  // Шрифты для превью в самом окошке.
  Object.keys(R.FONTS).forEach(function (id) {
    var f = R.FONTS[id];
    if (!f.file) return;
    ["cyrillic", "latin"].forEach(function (sub) {
      var face = new FontFace("ors-" + id, "url(fonts/" + f.file + "-" + sub + "-wght-normal.woff2)", { weight: "100 900" });
      face.load().then(function (ff) { document.fonts.add(ff); }, function () {});
    });
  });

  function render(cur) {
    themesEl.innerHTML = "";
    Object.keys(R.THEMES).forEach(function (id) {
      var t = R.THEMES[id];
      var b = document.createElement("button");
      b.className = "theme" + (cur.theme === id ? " on" : "");
      b.innerHTML = '<div class="sw"><span style="background:' + t.swatch[0] + '"></span><span style="background:' + t.swatch[1] + '"></span></div>' +
        "<b></b><small></small>";
      b.querySelector("b").textContent = t.name;
      b.querySelector("small").textContent = t.note || "";
      b.onclick = function () { save({ theme: id }); };
      themesEl.appendChild(b);
    });
    fontsEl.innerHTML = "";
    Object.keys(R.FONTS).forEach(function (id) {
      var f = R.FONTS[id];
      var b = document.createElement("button");
      b.className = "font" + (cur.font === id ? " on" : "");
      b.innerHTML = "<span></span><small></small>";
      var name = b.querySelector("span");
      name.textContent = f.name;
      if (f.file) name.style.fontFamily = "ors-" + id + ", sans-serif";
      else if (f.local) name.style.fontFamily = f.local.map(function (n) { return '"' + n + '"'; }).join(",") + ", sans-serif";
      else name.style.fontFamily = '"Segoe UI", sans-serif';
      b.querySelector("small").textContent = f.note || "";
      b.onclick = function () { save({ font: id }); };
      fontsEl.appendChild(b);
    });
  }

  function save(patch) {
    chrome.storage.sync.get(R.DEFAULTS, function (cur) {
      var next = Object.assign({}, cur, patch);
      chrome.storage.sync.set(next, function () { render(next); });
    });
  }

  chrome.storage.sync.get(R.DEFAULTS, render);
})();
