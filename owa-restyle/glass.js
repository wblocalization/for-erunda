// Стиль «Стекло»: обои на весь экран, панели почты как полупрозрачные карточки,
// иконки папок, аватарки, иллюстрации. Классы и вложенность взяты из разметки OWA 15.2 (mail.rwb.ru).
(function (root) {
  "use strict";

  function svgUrl(svg) {
    return "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\")";
  }

  function icon(paths) {
    return svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + "</svg>");
  }

  var ICONS = {
    folder: icon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
    inbox: icon('<path d="M3 13.5V17a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3.5"/><path d="M3 13.5 5.6 6.2A2 2 0 0 1 7.5 5h9a2 2 0 0 1 1.9 1.2l2.6 7.3"/><path d="M3 13.5h4.5l1.2 2.2h6.6l1.2-2.2H21"/>'),
    drafts: icon('<path d="M4 20h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m14.5 7.5 3 3"/>'),
    sent: icon('<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4.5-7-7-4.5z"/>'),
    trash: icon('<path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v6M14 11v6"/>'),
    notes: icon('<path d="M6 3h9l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 11h8M8 15h6"/>'),
    junk: icon('<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>'),
    archive: icon('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>'),
    outbox: icon('<path d="M3 13.5V17a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3.5"/><path d="M12 3v10M8 7l4-4 4 4"/>'),
    star: icon('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    person: icon('<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>')
  };

  // Названия стандартных папок OWA (рус. и англ. интерфейс).
  var FOLDERS = [
    ["inbox", ["Входящие", "Inbox"]],
    ["drafts", ["Черновики", "Drafts"]],
    ["sent", ["Отправленные", "Sent Items"]],
    ["trash", ["Удаленные", "Удалённые", "Deleted Items"]],
    ["notes", ["Заметки", "Notes"]],
    ["junk", ["Нежелательная почта", "Junk Email"]],
    ["archive", ["Архив", "Archive"]],
    ["outbox", ["Исходящие", "Outbox"]]
  ];

  // Иллюстрация для пустых мест: пустой ящик с письмом, цвета берутся из темы.
  function emptyIllustration(t) {
    return svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180">' +
      '<ellipse cx="120" cy="160" rx="84" ry="10" fill="' + t.light + '"/>' +
      '<circle cx="190" cy="40" r="16" fill="' + t.lighter + '"/><circle cx="48" cy="58" r="9" fill="' + t.lighter + '"/>' +
      '<path d="M42 92 72 52h96l30 40v52a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10z" fill="#fff" stroke="' + t.tertiary + '" stroke-width="3"/>' +
      '<path d="M42 92h44l8 16h52l8-16h44" fill="none" stroke="' + t.tertiary + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<g transform="rotate(-8 120 60)"><rect x="92" y="30" width="58" height="40" rx="6" fill="' + t.lighter + '" stroke="' + t.primary + '" stroke-width="3"/>' +
      '<path d="m94 34 27 20 27-20" fill="none" stroke="' + t.primary + '" stroke-width="3" stroke-linejoin="round"/></g>' +
      '<path d="M190 96l4 8 8 4-8 4-4 8-4-8-8-4 8-4z" fill="' + t.secondary + '"/>' +
      '<path d="M36 120l3 5 5 3-5 3-3 5-3-5-5-3 5-3z" fill="' + t.tertiary + '"/>' +
      "</svg>");
  }

  function rgba(hex, a) {
    var n = parseInt(hex.replace("#", ""), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }

  function css(th, s, extras, urlFor) {
    var t = th.t;
    var dim = Math.max(0, Math.min(70, +s.dim || 0)) / 100;
    var blur = Math.max(0, Math.min(40, +s.blur || 0));
    var wall = extras.wallpaper
      ? "url(\"" + extras.wallpaper + "\")"
      : "linear-gradient(135deg, " + t.tertiary + " 0%, " + t.light + " 45%, " + t.lighterAlt + " 100%)";
    var gradient = th.gradient || ("linear-gradient(120deg, " + t.secondary + ", " + t.primary + ")");
    var empty = extras.emptyImage ? "url(\"" + extras.emptyImage + "\")" : emptyIllustration(t);
    var bf = "backdrop-filter:blur(" + blur + "px) saturate(1.5);-webkit-backdrop-filter:blur(" + blur + "px) saturate(1.5)";
    var out = [];

    out.push(":root{--ors-glass:rgba(255,255,255,.74);--ors-glass-strong:rgba(255,255,255,.93);--ors-glass-line:rgba(255,255,255,.65);" +
      "--ors-gap:8px;--ors-radius:18px;--ors-gradient:" + gradient + ";--ors-empty:" + empty + "}");

    // Обои на всю страницу + лёгкое затемнение, чтобы белый текст в шапке читался.
    out.push("html body{background:linear-gradient(rgba(0,0,0," + dim + "),rgba(0,0,0," + dim + "))," + wall + " center/cover no-repeat fixed!important}");

    // Все слои-подложки OWA делаем прозрачными.
    out.push([
      "#primaryContainer", "#primaryContainer>div", "._n_T", "[role=\"main\"]._n_X", ".conductorContent",
      "html ._n_c", "html ._n_c._n_d", "#primaryHeaderView", ".vResize", "._n_t1", "._n_t1.ms-bg-color-themeLighterAlt",
      "._n_q1", "._n_r1", "._fce_a", "._fce_a.ms-bg-color-themeLighterAlt", "._n_e1"
    ].map(function (x) { return "html " + x.replace(/^html /, ""); }).join(",") + "{background:transparent!important;background-image:none!important}");

    // Служебные разделители и рамки OWA между панелями — убираем (перетаскивать границу панелей можно по-прежнему).
    out.push("html [role=\"main\"] .vResize,html [role=\"main\"] .vResize *,html ._n_e1,html ._n_e1 *{background:transparent!important;border-color:transparent!important;box-shadow:none!important;outline:0!important}");
    out.push("html [role=\"main\"] .vResize::before,html [role=\"main\"] .vResize::after{display:none!important}");
    out.push("html [role=\"main\"]._n_X,html [role=\"main\"] ._n_X,html ._n_q1,html ._n_r1,html ._fce_a,html ._n_t1,html ._n_T,html #primaryHeaderView,html #primaryContainer>div" +
      "{border-color:transparent!important}");
    out.push("html #primaryHeaderView,html #primaryHeaderView>div,html ._n_c,html ._n_t1{border:0!important;box-shadow:none!important}");

    // Шапка прозрачная, поверх обоев.
    out.push("html #O365_NavHeader,html #O365_NavHeader.o365cs-topnavBGImage,html .o365cs-topnavBGColor-2{background:linear-gradient(180deg,rgba(0,0,0,.22),rgba(0,0,0,0))!important}");
    out.push("html #O365_NavHeader .o365cs-nav-brandingText,html .ors-greet{text-shadow:0 1px 8px rgba(0,0,0,.25)}");

    // Карточки: прозрачная рамка = отступ между карточками, стекло рисуем псевдоэлементом.
    var cards = ["div[autoid=\"_n_a\"]._n_X", "._n_d1", "._n_Y"];
    out.push(cards.map(function (x) { return "html " + x; }).join(",") +
      "{box-sizing:border-box!important;border:var(--ors-gap) solid transparent!important;border-radius:calc(var(--ors-radius) + var(--ors-gap))!important;background:transparent!important;z-index:0}");
    out.push(cards.map(function (x) { return "html " + x + "::before"; }).join(",") +
      "{content:\"\";position:absolute;inset:0;border-radius:var(--ors-radius);background:var(--ors-glass);" + bf +
      ";box-shadow:inset 0 0 0 1px var(--ors-glass-line),0 10px 30px rgba(20,10,40,.12);z-index:-1;pointer-events:none}");
    out.push("html div[autoid=\"_n_a\"]._n_X{border-right-width:4px!important}");
    out.push("html ._n_d1{border-left-width:4px!important;border-right-width:4px!important}");
    out.push("html ._n_Y{border-left-width:4px!important}");
    out.push("html ._n_Y::before{background:var(--ors-glass-strong)}");

    // Панель команд — «пилюля» над списком и областью чтения.
    out.push("html ._n_q1{box-sizing:border-box!important;border:solid transparent!important;border-width:4px var(--ors-gap) 0 4px!important;z-index:0}");
    out.push("html ._n_q1::before{content:\"\";position:absolute;inset:0;border-radius:14px;background:var(--ors-glass);" + bf +
      ";box-shadow:inset 0 0 0 1px var(--ors-glass-line);z-index:-1;pointer-events:none}");
    out.push("html ._fce_a{border-bottom:0!important}");

    // Внутри карточек всё, что было белым/серым, — прозрачное.
    out.push([
      ".ms-bgc-nlr", "div[autoid=\"_n_a\"] .ms-bgc-tlr", ".listItemDefaultBackground", "._n_d1 .ms-bgc-w", "._n_d1 .ms-bg-color-white",
      "._lvv_X", "._lvv_W", "._lvv_X1", "._lvv_W1", "._n_Z", "._n_31", ".folderHeadContainer", "._n_g1",
      "._n_d4", "._n_h4", "._n_j4", "._lvv_42"
    ].map(function (x) { return "html " + x; }).join(",") + "{background-color:transparent!important}");
    // Поиск: аккуратная «пилюля» с лупой слева.
    out.push("html button._n_j{display:flex!important;align-items:center;gap:10px;height:40px!important;min-height:0!important;margin:12px 12px 0!important;width:calc(100% - 24px)!important;" +
      "padding:0 14px!important;box-sizing:border-box!important;position:relative!important;top:auto!important;left:auto!important;line-height:normal!important;" +
      "background:rgba(255,255,255,.85)!important;border:1px solid rgba(255,255,255,.9)!important;border-radius:12px!important;box-shadow:0 2px 8px rgba(20,10,40,.06)!important;" +
      "text-align:left;white-space:nowrap;overflow:hidden;cursor:text;transition:box-shadow .15s,background-color .15s}");
    out.push("html button._n_j:hover{background:#fff!important;box-shadow:0 0 0 3px " + rgba(t.primary, .14) + ",0 2px 8px rgba(20,10,40,.06)!important}");
    out.push("html button._n_j ._n_m{order:-1;flex:none;position:static!important;float:none!important;margin:0!important;font-size:16px!important;line-height:1!important;width:auto!important;height:auto!important}");
    out.push("html button._n_j ._n_m:before{color:" + t.primary + "!important}");
    out.push("html button._n_j ._n_l{flex:1;min-width:0;position:static!important;float:none!important;margin:0!important;padding:0!important;line-height:normal!important;" +
      "overflow:hidden;text-overflow:ellipsis;font-size:14px!important;color:#6b6f7a!important}");
    // Дерево папок в OWA имеет фиксированную ширину 256px — подгоняем под ширину карточки.
    out.push("html div[autoid=\"_n_a\"] ._n_j4>div{width:auto!important;right:0!important}");


    // Строки списка писем: мягкие карточки при наведении и выборе.
    out.push("html [role=\"option\"]._lvv_C1{border-radius:12px;margin:2px 8px;border-bottom-color:transparent!important}");
    out.push("html [role=\"option\"].listItemDefaultBackground:hover{background-color:rgba(255,255,255,.6)!important}");
    out.push("html [role=\"option\"].ms-bgc-tl,html [role=\"option\"].ms-bg-color-themeLight{background-color:rgba(255,255,255,.85)!important;box-shadow:0 2px 10px rgba(20,10,40,.08)}");
    out.push("html ._lvv_F1.ms-bgc-ts{background:var(--ors-gradient)!important}");

    // Кнопка «Создать» и выбранная папка — градиент темы.
    out.push("html button[title^=\"Создать новое сообщение\"],html button[title^=\"New message\"],html button[title^=\"Создать новое сообщение\"] ~ button[title^=\"Отобразить больше новых\"]{background:var(--ors-gradient)!important}");
    out.push("html button[title^=\"Создать новое сообщение\"]{border-radius:10px 0 0 10px}");
    out.push("html button[title^=\"Создать новое сообщение\"] ~ button[title^=\"Отобразить больше новых\"]{border-radius:0 10px 10px 0}");
    out.push("html ._n_I4.ms-bgc-tl,html ._n_I4.ms-bg-color-themeLight{background-color:rgba(255,255,255,.75)!important;box-shadow:inset 3px 0 0 " + t.primary + ",0 2px 8px rgba(20,10,40,.06)}");

    // Иконки папок.
    if (s.folderIcons !== false) {
      out.push("html ._n_C4::before,html #MailFolderPane\\.FavoritesHeader::before{content:\"\";display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:-3px;" +
        "background:" + t.primary + ";-webkit-mask:" + ICONS.folder + " center/contain no-repeat;mask:" + ICONS.folder + " center/contain no-repeat}");
      FOLDERS.forEach(function (f) {
        var sel = f[1].map(function (n) { return "html ._n_C4[title=\"" + n + "\"]::before"; }).join(",");
        out.push(sel + "{-webkit-mask-image:" + ICONS[f[0]] + ";mask-image:" + ICONS[f[0]] + "}");
      });
      out.push("html #MailFolderPane\\.FavoritesHeader::before{-webkit-mask-image:" + ICONS.star + ";mask-image:" + ICONS.star + "}");
      out.push("html ._n_C4.ors-account::before{-webkit-mask-image:" + ICONS.person + ";mask-image:" + ICONS.person + "}");
    }

    // Аватарки (элементы добавляет content.js).
    out.push("html .ors-av{position:absolute;left:18px;top:12px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
      "font:600 13px/1 var(--ors-font, \"Segoe UI\", sans-serif);letter-spacing:.02em;color:#fff;pointer-events:none;z-index:1;transition:opacity .12s;box-shadow:0 2px 6px rgba(20,10,40,.15)}");
    out.push("html [role=\"option\"].ors-has-av{padding-left:64px!important}");
    out.push("html [role=\"option\"].ors-has-av ._lvv_G1{position:absolute!important;left:22px!important;top:18px!important;margin:0!important}");
    out.push("html [role=\"option\"].ors-has-av:hover .ors-av{opacity:0}");

    // Пустая папка: картинка вместо значка.
    out.push("html ._n_O2>span.owaimg{display:block!important;width:240px!important;height:180px!important;margin:0 auto 8px!important;font-size:0!important;" +
      "background:var(--ors-empty) center/contain no-repeat!important}");
    out.push("html ._n_O2>span.owaimg::before{content:none!important}");

    // Пустая область чтения: иллюстрация и подсказка (класс ставит content.js).
    out.push("html ._n_Y.ors-reading-empty:not(.ors-reading-stub)::after{content:\"Выберите письмо — оно откроется здесь\";position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);" +
      "padding-top:200px;text-align:center;color:#6b6280;font:500 15px/1.4 var(--ors-font, \"Segoe UI\", sans-serif);" +
      "background:var(--ors-empty) center top/240px 180px no-repeat;pointer-events:none}");

    // Панель папок шире (OWA задаёт 256px в inline-стилях; если ширину перетащить мышкой, оставляем как есть).
    var FW = 296;
    out.push("html [role=\"main\"]._n_X>div[style*=\"width: 256px\"]{width:" + FW + "px!important}");
    out.push("html [role=\"main\"]._n_X>.vResize[style*=\"256px\"],html [role=\"main\"]._n_X>._n_X[style*=\"256px\"]{left:" + FW + "px!important}");
    // Длинные названия папок — с многоточием (max-width выставляет content.js).
    out.push("html div[autoid=\"_n_a\"] ._n_C4.ors-fit{display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}");
    out.push("html #O365_NavHeader .o365cs-nav-button{background-color:transparent!important}");
    // Меню приложений (плитка ▦): плотный фон цвета темы поверх всего.
    out.push("html #O365_NavHeader{position:relative;z-index:5}");
    out.push("html .ors-hero{z-index:1}");
    out.push("html .o365cs-nav-navMenu,html .o365cs-nav-navMenu .o365cs-appLauncherBackground{background-color:" + rgba(t.darker, .94) + "!important;" + bf + "}");
    out.push("html .o365cs-nav-navMenu{z-index:1000!important;border-radius:16px!important;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.28)!important}");

    // Шапка-баннер.
    var H = Math.max(50, Math.min(320, +s.heroHeight || 50));
    if (H > 50) {
      var heroBg = extras.heroImage ? "url(\"" + extras.heroImage + "\") center " + (+s.heroPos || 0) + "%/cover no-repeat" :
        extras.wallpaper ? "transparent" : (th.header || gradient);
      out.push("html #primaryHeaderView{height:" + H + "px!important;z-index:1}");
      out.push(["inset: 50px", "inset:50px", "top: 50px", "top:50px"].map(function (v) { return "html #primaryContainer>div[style*=\"" + v + "\"],html #primaryContainer>a[style*=\"" + v + "\"]"; }).join(",") + "{top:" + H + "px!important}");
      out.push("html ._n_c{height:" + H + "px!important}");
      out.push("html #primaryHeaderView::before{content:\"\";position:absolute;inset:8px 8px 0 8px;border-radius:22px;z-index:-1;pointer-events:none;" +
        "background:linear-gradient(180deg,rgba(0,0,0,.28) 0,rgba(0,0,0,0) 70px),linear-gradient(0deg,rgba(0,0,0,.36) 0,rgba(0,0,0,0) 65%)," + heroBg + ";" +
        "box-shadow:inset 0 0 0 1px rgba(255,255,255,.35),0 10px 30px rgba(20,10,40,.15)}");
      out.push("html #O365_NavHeader,html #O365_NavHeader.o365cs-topnavBGImage,html .o365cs-topnavBGColor-2{background:transparent!important;margin:8px 8px 0;border-radius:22px 22px 0 0}");
      out.push("html .ors-hero{position:absolute;left:36px;right:36px;bottom:20px;color:#fff;pointer-events:none;text-shadow:0 2px 12px rgba(0,0,0,.35)}");
      out.push("html .ors-hero b{display:block;font:700 " + (H >= 150 ? 34 : 24) + "px/1.15 var(--ors-display, var(--ors-font, \"Segoe UI\", sans-serif));letter-spacing:-.01em}");
      out.push("html .ors-hero span{display:block;margin-top:6px;font:500 15px/1.3 var(--ors-font, \"Segoe UI\", sans-serif);opacity:.92}");
      if (H < 110) out.push("html .ors-hero span{display:none}");
      out.push("html .ors-hero{right:330px}");
      out.push("html .ors-meet{position:absolute;right:28px;bottom:18px;z-index:1;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:300px}");
      out.push("html .ors-chip{display:flex;align-items:center;gap:8px;max-width:300px;padding:6px 12px;border-radius:12px;text-decoration:none!important;color:#fff!important;" +
        "background:rgba(255,255,255,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);" + bf + ";font:500 13px/1.25 var(--ors-font, \"Segoe UI\", sans-serif);" +
        "text-shadow:0 1px 4px rgba(0,0,0,.25);transition:background-color .15s}");
      out.push("html .ors-chip:hover{background:rgba(255,255,255,.3)}");
      out.push("html .ors-chip i{font-style:normal;font-weight:600;opacity:.85;white-space:nowrap}");
      out.push("html .ors-chip b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}");
      out.push("html .ors-chip em{font-style:normal;white-space:nowrap;padding:2px 8px;border-radius:8px;background:rgba(255,255,255,.22);font-size:12px}");
      out.push("html .ors-chip.now{background:" + rgba(t.primary, .82) + ";box-shadow:inset 0 0 0 1px rgba(255,255,255,.45),0 0 0 3px " + rgba(t.primary, .25) + "}");
      out.push("html .ors-chip.now em{background:#fff;color:" + t.dark + ";text-shadow:none;animation:orsPulse 2s ease-in-out infinite}");
      out.push("@keyframes orsPulse{50%{opacity:.6}}");
      out.push("html .ors-chip.allday i,html .ors-chip.more b,html .ors-chip.done b{opacity:.9}");
      if (H < 150) out.push("html .ors-meet{bottom:auto;top:50%;transform:translateY(-10%)}");
    }

    // Своя картинка в пустой области чтения (пока письмо не открыто).
    if (extras.readingImage) {
      out.push("html ._n_Y.ors-reading-empty::before{background:url(\"" + extras.readingImage + "\") center " + (+s.readingPos || 50) + "%/cover no-repeat}");
      out.push("html ._n_Y.ors-reading-empty ._n_O2>span.owaimg,html ._n_Y.ors-reading-empty::after{display:none!important}");
      out.push("html ._n_Y.ors-reading-empty ._n_O2{width:fit-content!important;max-width:90%;margin-left:auto!important;margin-right:auto!important;padding:10px 18px;border-radius:14px;" +
        "background:rgba(255,255,255,.72);" + bf + ";box-shadow:0 6px 20px rgba(20,10,40,.15);white-space:nowrap}");
    }

    // Приветствие в шапке.
    out.push("html .ors-greet{color:#fff;font:600 16px/50px var(--ors-display, var(--ors-font, \"Segoe UI\", sans-serif));letter-spacing:.01em;white-space:nowrap}");
    // Верхняя панель: своя гибкая раскладка, круглые «стеклянные» кнопки, аватарка кружком.
    // display у кнопок не трогаем — OWA прячет часть из них через inline display:none.
    out.push("html #O365_NavHeader{display:flex!important;align-items:center;height:50px!important;padding:0 12px 0 8px!important;box-sizing:border-box}");
    out.push("html #O365_NavHeader>.o365cs-nav-leftAlign{display:flex!important;align-items:center;position:static!important;float:none!important;flex:none}");
    out.push("html #O365_NavHeader>.o365cs-nav-centerAlign{display:flex!important;justify-content:center;align-items:center;flex:1 1 auto;min-width:0;position:static!important;float:none!important;width:auto!important}");
    out.push("html #O365_NavHeader>.o365cs-nav-rightAlign,html #O365_NavHeader>.o365cs-nav-rightAlign>div,html #O365_NavHeader .o365cs-nav-rightMenus,html #O365_NavHeader .o365cs-nav-rightMenus>div" +
      "{display:flex!important;align-items:center;gap:6px;position:static!important;float:none!important;width:auto!important;margin-left:auto}");
    out.push("html #O365_NavHeader .o365cs-nav-topItem{border:0!important;box-shadow:none!important;background:none!important;float:none!important;position:relative;height:auto!important}");
    out.push("html #O365_NavHeader .o365cs-nav-topItem>div{display:flex;align-items:center}");
    out.push("html #O365_NavHeader button.o365cs-nav-button{width:38px!important;height:38px!important;min-width:0!important;padding:0!important;margin:0!important;line-height:38px!important;text-align:center;" +
      "border:0!important;border-radius:50%!important;background:rgba(255,255,255,.16)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);transition:background-color .15s}");
    out.push("html #O365_NavHeader button.o365cs-nav-button:hover{background:rgba(255,255,255,.3)!important}");
    out.push("html #O365_NavHeader button.o365cs-nav-button .owaimg{line-height:38px!important;font-size:17px!important;color:#fff!important}");
    out.push("html #O365_NavHeader #O365_MainLink_NavMenu{background:transparent!important;box-shadow:none}");
    out.push("html #O365_NavHeader #O365_MainLink_NavMenu:hover{background:rgba(255,255,255,.2)!important}");
    out.push("html #O365_NavHeader .o365cs-nav-o365Branding,html #O365_NavHeader .o365cs-nav-appTitle{text-decoration:none!important;border:0!important;box-shadow:none!important;padding-left:6px!important;margin:0!important}");
    // Аватарка: сама кнопка — кружок 40×40, фото заполняет его целиком, обводка рисуется внутри (её не обрежут контейнеры OWA).
    out.push("html #O365_NavHeader button._ho2_2{position:relative!important;flex:none;width:40px!important;height:40px!important;min-width:0!important;padding:0!important;" +
      "margin:0 16px 0 8px!important;border:0!important;border-radius:50%!important;overflow:hidden!important;background:rgba(255,255,255,.2)!important;box-shadow:none!important;vertical-align:middle}");
    out.push("html #O365_NavHeader button._ho2_2::after{content:\"\";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(255,255,255,.9);pointer-events:none}");
    out.push("html #O365_NavHeader button._ho2_2:hover::after{box-shadow:inset 0 0 0 2px #fff,inset 0 0 0 40px rgba(255,255,255,.12)}");
    out.push("html #O365_NavHeader button._ho2_2 ._pe_62,html #O365_NavHeader button._ho2_2 ._pe_g{display:none!important}");
    out.push("html #O365_NavHeader button._ho2_2 ._ho2_5,html #O365_NavHeader button._ho2_2 ._pe_h,html #O365_NavHeader button._ho2_2 ._pe_h>div,html #O365_NavHeader button._ho2_2 ._pe_h>div>div" +
      "{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;" +
      "border-radius:50%!important;overflow:hidden!important;font-size:0!important;line-height:0!important;background:transparent!important}");
    out.push("html #O365_NavHeader button._ho2_2 img{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover;border-radius:50%;margin:0!important}");
    out.push("html #O365_NavHeader .o365cs-nav-topItem:has(button._ho2_2){width:auto!important;margin:0!important;padding:0!important;overflow:visible!important}");

    // Шрифт для заголовков у тем с «характером».
    if (th.displayFont) {
      var fam = "OWA Restyle Display";
      ["cyrillic", "latin"].forEach(function (sub) {
        out.push("@font-face{font-family:\"" + fam + "\";src:url(\"" + urlFor("fonts/unbounded-" + sub + "-wght-normal.woff2") +
          "\") format(\"woff2\");font-weight:200 900;font-display:swap;unicode-range:" + (sub === "cyrillic" ? "U+0400-045F,U+0490-0491,U+2116" : "U+0000-00FF,U+2000-206F") + "}");
      });
      out.push(":root{--ors-display:\"" + fam + "\", sans-serif}");
      out.push("html .folderHeaderLabel.folderHeaderLabel,html #O365_NavHeader .o365cs-nav-brandingText{font-family:var(--ors-display)!important;font-weight:600!important;letter-spacing:0}");
      out.push("html .folderHeaderLabel.folderHeaderLabel{background:var(--ors-gradient);-webkit-background-clip:text;background-clip:text;color:transparent!important}");
    }

    return out.join("\n");
  }

  root.OWA_RESTYLE_GLASS = { css: css };
})(typeof window !== "undefined" ? window : globalThis);
