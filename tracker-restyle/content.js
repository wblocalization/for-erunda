// Вставляет стиль выбранной темы на страницу трекера и держит его последним в <head>.
(function () {
  "use strict";
  var R = window.TRACKER_RESTYLE;
  var style = document.createElement("style");
  style.id = "tracker-restyle-style";
  (document.head || document.documentElement).appendChild(style);

  function urlFor(path) { return chrome.runtime.getURL(path); }

  function load() {
    chrome.storage.sync.get(R.DEFAULTS, function (s) {
      chrome.storage.local.get({ images: [] }, function (local) {
        var th = R.themeFor(s) || {};
        var wall = null;
        if (s.wallpaper && s.wallpaper !== "theme" && s.wallpaper !== "none") {
          var img = (local.images || []).filter(function (i) { return i.id === s.wallpaper; })[0];
          if (img) wall = img.data;
        }
        if (!wall && s.wallpaper !== "none" && th.wallpaper) wall = urlFor(th.wallpaper);
        style.textContent = R.buildCss(s, urlFor, { wallpaper: wall });
      });
    });
  }

  function keepLast() {
    var head = document.head;
    if (head && head.lastElementChild !== style) head.appendChild(style);
  }

  load();
  chrome.storage.onChanged.addListener(load);

  function start() {
    keepLast();
    var timer = null;
    new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () { timer = null; keepLast(); }, 200);
    }).observe(document.head, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
