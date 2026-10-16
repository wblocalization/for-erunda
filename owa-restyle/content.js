// Вставляет стиль выбранной темы на страницу OWA и обновляет его при смене настроек.
(function () {
  "use strict";
  var R = window.OWA_RESTYLE;
  var STYLE_ID = "owa-restyle-style";

  var style = document.createElement("style");
  style.id = STYLE_ID;
  (document.head || document.documentElement).appendChild(style);

  function urlFor(path) { return chrome.runtime.getURL(path); }

  function apply(settings) {
    style.textContent = R.buildCss(settings.theme, settings.font, urlFor);
  }

  // Держим наш стиль последним в <head>: так он перекрывает стили OWA, которые она добавляет на ходу.
  function keepLast() {
    var head = document.head;
    if (head && head.lastElementChild !== style) head.appendChild(style);
  }

  chrome.storage.sync.get(R.DEFAULTS, apply);

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    chrome.storage.sync.get(R.DEFAULTS, apply);
  });

  document.addEventListener("DOMContentLoaded", function () {
    keepLast();
    var timer = null;
    new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () { timer = null; keepLast(); }, 200);
    }).observe(document.head, { childList: true });
  });
})();
