// Работает в «мире страницы» Band (world: MAIN): ловит момент, когда Band показывает уведомление,
// и сообщает об этом расширению; по желанию глушит стандартный звук уведомления Band.
(function () {
  "use strict";
  if (window.__brsNotifyHook) return;
  window.__brsNotifyHook = true;

  var Native = window.Notification;
  if (Native) {
    var Wrapped = function (title, options) {
      try {
        window.dispatchEvent(new CustomEvent("brs-notify", {
          // Строкой: объекты между «мирами» страницы и расширения передаются ненадёжно.
          detail: JSON.stringify({ title: String(title || ""), body: String(options && options.body || ""), tag: String(options && options.tag || "") })
        }));
      } catch (e) { /* не мешаем Band */ }
      return new Native(title, options);
    };
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(Wrapped, "permission", { get: function () { return Native.permission; } });
    Wrapped.requestPermission = function () { return Native.requestPermission.apply(Native, arguments); };
    try { window.Notification = Wrapped; } catch (e) { /* ignore */ }
  }

  // Стандартные звуки уведомлений Band (не звонки!) — глушим, если включено в настройках расширения.
  var BAND_SOUNDS = /(bing|crackle|down|hello|ripple|upstairs)[^/]*\.(mp3|wav|ogg)(\?|$)/i;
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      var src = this.currentSrc || this.src || "";
      if (document.documentElement.getAttribute("data-brs-mute-band") === "1" && BAND_SOUNDS.test(src)) {
        return Promise.resolve();
      }
    } catch (e) { /* ignore */ }
    return play.apply(this, arguments);
  };
})();
