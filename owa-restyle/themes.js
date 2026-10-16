// Темы и шрифты для OWA Restyle. Файл подключается и в content script, и в popup.
(function (root) {
  "use strict";

  // Оттенки акцентного цвета в терминах OWA (theme*): см. классы ms-bgc-t*, ms-fcl-t*, ms-bcl-t*.
  var THEMES = {
    original: {
      name: "Как было",
      note: "Без изменений",
      swatch: ["#DB626C", "#F7E0E2"]
    },
    cloud: {
      name: "Облако",
      note: "Светлая, синяя, как новый Outlook",
      swatch: ["#0F6CBD", "#DEECF9"],
      t: {
        darker: "#0C3B5E", dark: "#115EA3", darkAlt: "#115EA3", primary: "#0F6CBD",
        secondary: "#2886DE", tertiary: "#62ABF5", light: "#CFE4FA", lighter: "#E6F0FB", lighterAlt: "#F4F8FD"
      },
      header: "linear-gradient(90deg, #0F6CBD 0%, #2886DE 100%)",
      pane: "#F5F7FA"
    },
    powder: {
      name: "Пудра",
      note: "Розовая, но спокойная",
      swatch: ["#C2507A", "#F9E7EE"],
      t: {
        darker: "#7F2C4B", dark: "#A83D65", darkAlt: "#A83D65", primary: "#C2507A",
        secondary: "#D06B90", tertiary: "#E39BB6", light: "#F4D7E2", lighter: "#F9E9EF", lighterAlt: "#FDF7F9"
      },
      header: "linear-gradient(90deg, #B8466F 0%, #E0839F 100%)",
      pane: "#FBF6F8"
    },
    sage: {
      name: "Шалфей",
      note: "Мягкая зелёная",
      swatch: ["#2E7D6B", "#E3F2EE"],
      t: {
        darker: "#1A4C41", dark: "#24695A", darkAlt: "#24695A", primary: "#2E7D6B",
        secondary: "#3F9580", tertiary: "#7CBFAE", light: "#CDE8E0", lighter: "#E5F3EF", lighterAlt: "#F4FAF8"
      },
      header: "linear-gradient(90deg, #2E7D6B 0%, #4AA58C 100%)",
      pane: "#F4F8F7"
    },
    lavender: {
      name: "Лаванда",
      note: "Фиолетовая",
      swatch: ["#6A5ACD", "#EBE8FB"],
      t: {
        darker: "#3F3390", dark: "#5848B8", darkAlt: "#5848B8", primary: "#6A5ACD",
        secondary: "#7D6FD6", tertiary: "#A99FE6", light: "#DCD7F7", lighter: "#EDEAFB", lighterAlt: "#F8F7FE"
      },
      header: "linear-gradient(90deg, #6A5ACD 0%, #9483E8 100%)",
      pane: "#F7F6FC"
    },
    vice: {
      name: "Вайс-Сити",
      note: "Закат, пальмы, неон",
      swatch: ["#7C5BB0", "#F29A96"],
      t: {
        darker: "#6E1F5E", dark: "#A3307E", darkAlt: "#A3307E", primary: "#C23F8C",
        secondary: "#D45E9E", tertiary: "#E79AC2", light: "#F5D2E5", lighter: "#FAE6F0", lighterAlt: "#FEF5F9"
      },
      header: "linear-gradient(90deg, #4A3E9C 0%, #9A5AAE 45%, #E9818F 80%, #F7A777 100%)",
      gradient: "linear-gradient(120deg, #F7A777 0%, #E5638F 45%, #8E5BC0 100%)",
      pane: "#FBF5FA",
      wallpaper: "vice-sunset.webp",
      displayFont: true
    },
    custom: {
      name: "Свой цвет",
      note: "Выбери цвета сама",
      swatch: ["#E0457B", "#7C5BB0"],
      custom: true
    },
    graphite: {
      name: "Графит",
      note: "Тёмная тема (бета)",
      swatch: ["#1E1F24", "#7AA2FF"],
      dark: true,
      // Тёмная тема делается инверсией страницы, поэтому цвета здесь «светлые»:
      // после инверсии они превращаются в тёмный фон и голубой акцент.
      t: {
        darker: "#14306E", dark: "#1C3F8C", darkAlt: "#1C3F8C", primary: "#2450A8",
        secondary: "#3563BD", tertiary: "#6E8FD2", light: "#D5DEF3", lighter: "#E6EBF7", lighterAlt: "#F2F4FA"
      },
      header: "#E8EAEF",
      headerText: "#111111",
      pane: "#F0F1F4"
    }
  };

  var FONTS = {
    original: { name: "Как было (Segoe UI)" },
    segoevar: { name: "Segoe UI Variable", note: "Шрифт Windows 11", local: ["Segoe UI Variable Text", "Segoe UI Variable"] },
    inter: { name: "Inter", file: "inter" },
    manrope: { name: "Manrope", file: "manrope" },
    golos: { name: "Golos Text", file: "golos-text" },
    onest: { name: "Onest", file: "onest" }
  };

  var FAMILY = "OWA Restyle UI";

  // Имена шрифтов, которыми OWA рисует интерфейс. Письма в Outlook пишутся Calibri/Arial
  // (класс owa-font-compose), их мы не трогаем.
  var ALIASES = [
    "Segoe UI", "Segoe UI WestEuropean", "Segoe WP", "Segoe UI Semilight", "Segoe WP Semilight",
    "Segoe UI Light", "Segoe WP Light", "Segoe UI Semibold", "Segoe WP Semibold",
    "wf_segoe-ui_normal", "wf_segoe-ui_semilight", "wf_segoe-ui_light"
  ];

  var CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";
  var LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

  var SHADES = {
    darker: "tdr", dark: "td", darkAlt: "tda", primary: "tp", secondary: "ts",
    tertiary: "tt", light: "tl", lighter: "tlr", lighterAlt: "tlra"
  };

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Повторяет набор классов из темы OWA, но с большей специфичностью (префикс html).
  function themeColorCss(t) {
    var out = [];
    Object.keys(SHADES).forEach(function (shade) {
      var c = t[shade], s = SHADES[shade], long = "theme" + cap(shade);
      [
        ["ms-bg-color-" + long, "ms-bgc-" + s, "background-color"],
        ["ms-border-color-" + long, "ms-bcl-" + s, "border-color"],
        ["ms-font-color-" + long, "ms-fcl-" + s, "color", "ms-fontColor-" + long]
      ].forEach(function (k) {
        var sel = [
          "." + k[0], "." + k[1],
          "." + k[0] + "-hover:hover", "." + k[0] + "-focus:focus", "." + k[0] + "-before:before",
          "." + k[1] + "-h:hover", "." + k[1] + "-f:focus", "." + k[1] + "-b:before"
        ];
        if (k[3]) sel.push("." + k[3]);
        out.push(sel.map(function (x) { return "html " + x; }).join(",") + "{" + k[2] + ":" + c + "}");
      });
    });
    out.push("html .ms-border-color-top-themePrimary,html .ms-bcl-t-tp,html .ms-bcl-t-tp-h:hover,html .ms-bcl-t-tp-b:before{border-top-color:" + t.primary + "}");
    return out.join("\n");
  }

  function fontCss(fontId, urlFor) {
    var f = FONTS[fontId];
    if (!f || fontId === "original") return "";
    var faces = [];
    function face(family, weight) {
      if (f.local) {
        faces.push("@font-face{font-family:\"" + family + "\";src:" +
          f.local.map(function (n) { return "local(\"" + n + "\")"; }).join(",") +
          ";font-weight:" + weight + ";font-display:swap}");
        return;
      }
      [["cyrillic", CYRILLIC], ["latin", LATIN]].forEach(function (sub) {
        faces.push("@font-face{font-family:\"" + family + "\";src:url(\"" +
          urlFor("fonts/" + f.file + "-" + sub[0] + "-wght-normal.woff2") +
          "\") format(\"woff2\");font-weight:" + weight + ";font-display:swap;unicode-range:" + sub[1] + "}");
      });
    }
    face(FAMILY, "100 900");
    ALIASES.forEach(function (a) {
      // У wf_* шрифтов OWA вес не указан, поэтому дескриптор должен совпадать, иначе наш не победит.
      face(a, a.indexOf("wf_") === 0 ? "normal" : "100 900");
    });
    face("wf_segoe-ui_semibold", "bold");

    var ui = "\"" + FAMILY + "\", \"Segoe UI\", Tahoma, Arial, sans-serif";
    var rules = [
      ":root{--ors-font:" + ui + "}",
      "html body,html .ms-font-su,html .ms-font-xxl,html .ms-font-xl,html .ms-font-l,html .ms-font-m,html .ms-font-s,html .ms-font-xs,html .ms-font-mi," +
        "html .ms-fwt-l,html .ms-fwt-sl,html .ms-fwt-r,html .ms-fwt-sb," +
        "html .ms-font-weight-light,html .ms-font-weight-semilight,html .ms-font-weight-regular,html .ms-font-weight-semibold," +
        "html .ms-Button,html .ms-Label,html .ms-TextField-field,html input,html button,html select,html textarea{font-family:var(--ors-font)}",
      "html .ms-font-su,html .ms-font-xxl,html .ms-font-xl{font-weight:600;letter-spacing:-0.01em}",
      "html .ms-fwt-l,html .ms-fwt-sl,html .ms-fwt-r,html .ms-font-weight-light,html .ms-font-weight-semilight,html .ms-font-weight-regular{font-weight:400}",
      "html .ms-fwt-sb,html .ms-font-weight-semibold,html .ms-fwt-sb-h:hover,html .ms-fwt-sb-b:before{font-weight:600}",
      "html .folderHeaderLabel.folderHeaderLabel{font-weight:600}",
      // Письма и окно написания письма остаются в шрифтах Outlook.
      "html .owa-font-compose,html [contenteditable=\"true\"]{font-family:Calibri, Arial, Helvetica, sans-serif}"
    ];
    return faces.join("\n") + "\n" + rules.join("\n");
  }

  // Общая «косметика»: шапка, панели, кнопки, счётчики, скроллбары.
  function baseCss(th) {
    var t = th.t;
    var headerText = th.headerText || "#FFFFFF";
    return [
      ":root{--ors-accent:" + t.primary + ";--ors-accent-dark:" + t.dark + ";--ors-accent-soft:" + t.lighter +
        ";--ors-accent-softer:" + t.lighterAlt + ";--ors-accent-light:" + t.light + ";--ors-pane:" + th.pane +
        ";--ors-header:" + th.header + ";--ors-header-text:" + headerText + ";--ors-line:#E6E8EC}",

      // Шапка: вместо картинки темы ровная заливка/градиент.
      "html #O365_NavHeader,html #O365_NavHeader.o365cs-topnavBGImage,html .o365cs-topnavBGColor-2,html ._n_c,html ._n_c._n_d{background:var(--ors-header)!important;background-image:var(--ors-header)!important}",
      "html .o365cs-base.o365cst .o365cs-topnavText,html .o365cs-base.o365cst .o365cs-topnavText:hover,html .o365cs-base.o365cst .o365cs-navMenuButton,html #O365_NavHeader .o365cs-nav-brandingText{color:var(--ors-header-text)!important}",
      "html #O365_NavHeader .o365cs-nav-brandingText{font-weight:600;letter-spacing:.01em}",
      "html .o365cs-base.o365cst .o365cs-topnavLinkBackground-2,html .o365cs-base.o365cst.o365cs-topnavBGColor-2{background-color:transparent!important}",
      "html .o365cs-base.o365cst .o365cs-appLauncherBackground{background-color:" + t.darker + "}",
      "html #O365_NavHeader .o365cs-nav-button{border-radius:6px}",
      "html #O365_NavHeader .o365cs-nav-button:hover{background-color:rgba(255,255,255,.18)!important}",

      // Левая панель (поиск + папки).
      "html div[autoid=\"_n_a\"].ms-bgc-nlr{background-color:var(--ors-pane)!important}",
      "html div[autoid=\"_n_a\"] .ms-bgc-tlr{background-color:transparent!important}",
      // Поиск: скруглённое поле.
      "html button._n_j{background-color:#FFFFFF!important;border:1px solid var(--ors-line)!important;border-radius:8px!important;margin:10px 12px!important;width:calc(100% - 24px)!important;box-sizing:border-box;box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      "html button._n_j:hover{border-color:var(--ors-accent-light)!important}",
      // Папки: выделение «таблеткой».
      "html ._n_I4[role=\"treeitem\"]{border-radius:8px;margin:1px 8px;transition:background-color .12s}",
      "html ._n_I4[role=\"treeitem\"]:hover{background-color:rgba(0,0,0,.045)}",
      "html ._n_I4.ms-bgc-tl,html ._n_I4.ms-bg-color-themeLight{background-color:var(--ors-accent-soft)!important;box-shadow:inset 3px 0 0 var(--ors-accent)}",
      "html ._n_I4.ms-bgc-tl ._n_C4{color:var(--ors-accent-dark)!important}",
      // Счётчики непрочитанных: аккуратные бейджи вместо крупных красных цифр.
      "html ._n_F4{background:transparent!important}",
      "html ._n_E4{display:inline-block;min-width:22px;padding:0 7px;border-radius:999px;text-align:center;font-size:12px!important;line-height:20px;" +
        "background-color:var(--ors-accent-soft);color:var(--ors-accent-dark)!important;box-sizing:border-box}",
      "html .ms-bg-color-neutralLighter._n_F4{background:transparent!important}",

      // Панель команд над списком.
      "html ._fce_a.ms-bg-color-themeLighterAlt,html ._n_t1.ms-bg-color-themeLighterAlt{background-color:#FFFFFF!important}",
      "html ._fce_a{border-bottom:1px solid var(--ors-line)}",
      "html ._fce_e{border-radius:6px}",
      // Кнопка «Создать» — заметная, залитая акцентом.
      "html button[title^=\"Создать новое сообщение\"],html button[title^=\"New message\"]{background-color:var(--ors-accent)!important;color:#FFFFFF!important;border-radius:6px 0 0 6px;padding:0 12px 0 8px!important}",
      "html button[title^=\"Создать новое сообщение\"] *,html button[title^=\"New message\"] *{color:#FFFFFF!important}",
      "html button[title^=\"Создать новое сообщение\"] .owaimg:before,html button[title^=\"New message\"] .owaimg:before{color:#FFFFFF!important}",
      "html button[title^=\"Создать новое сообщение\"]:hover,html button[title^=\"New message\"]:hover{background-color:var(--ors-accent-dark)!important}",
      "html button[title^=\"Создать новое сообщение\"] ~ ._fce_k{display:none}",
      "html button[title^=\"Создать новое сообщение\"] ~ button[title^=\"Отобразить больше новых\"]{background-color:var(--ors-accent)!important;color:#FFFFFF!important;border-radius:0 6px 6px 0;border-left:1px solid rgba(255,255,255,.35)}",
      "html button[title^=\"Создать новое сообщение\"] ~ button[title^=\"Отобразить больше новых\"] *{color:#FFFFFF!important}",
      "html button[title^=\"Создать новое сообщение\"] ~ button[title^=\"Отобразить больше новых\"]:hover{background-color:var(--ors-accent-dark)!important}",

      // Список писем.
      "html .listItemDefaultBackground{transition:background-color .12s}",
      "html [role=\"option\"].listItemDefaultBackground:hover{background-color:var(--ors-accent-softer)}",
      "html [role=\"option\"].ms-bgc-tl,html [role=\"option\"].ms-bg-color-themeLight{background-color:var(--ors-accent-soft)!important}",
      "html ._lvv_F1.ms-bgc-ts{width:3px!important;border-radius:3px}",
      "html .folderHeaderLabel{color:#1F2328!important}",
      "html ._db_k2{border-radius:6px}",

      // Скроллбары: тонкие.
      "html .customScrollBar::-webkit-scrollbar{width:10px;height:10px}",
      "html .customScrollBar::-webkit-scrollbar-button{display:none}",
      "html .customScrollBar::-webkit-scrollbar-track,html .customScrollBar::-webkit-scrollbar-corner{background-color:transparent}",
      "html .customScrollBar::-webkit-scrollbar-thumb,html .customScrollBar::-webkit-scrollbar-thumb:hover{border:3px solid transparent;background-clip:content-box;border-radius:10px;background-color:rgba(0,0,0,.22)}",
      "html .customScrollBar::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,.38)}",

      // Всплывающие меню и диалоги — мягкие тени и скругления.
      "html .popupShadow{box-shadow:0 8px 24px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.08)!important;border-radius:8px}"
    ].join("\n");
  }

  function darkCss() {
    // Инверсия всей страницы, а картинки/аватарки/видео возвращаем как были.
    return [
      "html{filter:invert(.93) hue-rotate(180deg);background:#FFFFFF}",
      "html img,html video,html canvas,html picture,html [style*=\"background-image\"],html ._pe_h{filter:invert(1) hue-rotate(180deg)}",
      "html ._pe_h img{filter:none}"
    ].join("\n");
  }

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    var n = parseInt(h, 16);
    if (!/^[0-9a-f]{6}$/i.test(h)) n = 0xE0457B;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }

  function mix(hex, withHex, k) {
    var a = hexToRgb(hex), b = hexToRgb(withHex);
    return "#" + a.map(function (v, i) {
      var x = Math.round(v + (b[i] - v) * k);
      return (x < 16 ? "0" : "") + x.toString(16);
    }).join("").toUpperCase();
  }

  // Своя тема: вся палитра оттенков собирается из одного-двух цветов.
  function customTheme(c1, c2) {
    c1 = c1 || "#E0457B";
    c2 = c2 || c1;
    return {
      name: "Свой цвет",
      t: {
        darker: mix(c1, "#000000", .45), dark: mix(c1, "#000000", .2), darkAlt: mix(c1, "#000000", .2), primary: mix(c1, "#000000", 0),
        secondary: mix(c1, "#FFFFFF", .18), tertiary: mix(c1, "#FFFFFF", .45), light: mix(c1, "#FFFFFF", .75),
        lighter: mix(c1, "#FFFFFF", .87), lighterAlt: mix(c1, "#FFFFFF", .95)
      },
      header: "linear-gradient(90deg, " + mix(c1, "#000000", .15) + " 0%, " + c2 + " 100%)",
      gradient: "linear-gradient(120deg, " + c2 + " 0%, " + c1 + " 100%)",
      pane: mix(c1, "#FFFFFF", .96)
    };
  }

  function themeFor(settings) {
    if (settings.theme === "custom") return customTheme(settings.customColor, settings.customColor2);
    return THEMES[settings.theme];
  }

  // Свой цвет для заголовков и акцентного текста: «Входящие», выбранная папка, счётчики, темы непрочитанных, ссылки.
  function accentTextCss(c) {
    var dark = mix(c, "#000000", .18);
    var cls = ["tp", "ts", "td", "tda", "tdr"];
    var longs = ["themePrimary", "themeSecondary", "themeDark", "themeDarkAlt", "themeDarker"];
    var sel = [];
    cls.forEach(function (k) { sel.push(".ms-fcl-" + k, ".ms-fcl-" + k + "-h:hover", ".ms-fcl-" + k + "-b:before"); });
    longs.forEach(function (k) { sel.push(".ms-font-color-" + k, ".ms-fontColor-" + k, ".ms-font-color-" + k + "-hover:hover", ".ms-font-color-" + k + "-before:before"); });
    return [
      sel.map(function (x) { return "html body " + x; }).join(",") + "{color:" + c + "}",
      "html body ._n_E4,html body ._n_I4.ms-bgc-tl ._n_C4{color:" + dark + "!important}",
      "html body .folderHeaderLabel.folderHeaderLabel{color:" + c + "!important;background:none!important;-webkit-text-fill-color:" + c + "}"
    ].join("\n");
  }

  function buildCss(settings, urlFor, extras) {
    extras = extras || {};
    var css = [];
    var th = themeFor(settings);
    var glass = settings.style === "glass";
    if (th && th.t) {
      css.push(themeColorCss(th.t));
      css.push(baseCss(th));
      if (th.dark && !glass) css.push(darkCss());
    }
    if (glass) css.push(root.OWA_RESTYLE_GLASS.css(th && th.t ? th : THEMES.cloud, settings, extras, urlFor));
    if (settings.accentText === "custom" && settings.accentTextColor) css.push(accentTextCss(settings.accentTextColor));
    css.push(fontCss(settings.font, urlFor));
    return css.join("\n");
  }

  root.OWA_RESTYLE = {
    THEMES: THEMES,
    FONTS: FONTS,
    DEFAULTS: { style: "glass", theme: "cloud", font: "golos", wallpaper: "theme", dim: 15, blur: 24, greeting: true, avatars: true, folderIcons: true, heroHeight: 220, heroImage: "wallpaper", heroPos: 30, readingImage: "none", readingPos: 50, greetingName: "", meetings: true, heroLayout: "split", widgetImage: "none", widgetPos: 50, customColor: "#E0457B", customColor2: "#7C5BB0", heroText: "white", heroTextColor: "#FFFFFF", accentText: "theme", accentTextColor: "#C23F8C" },
    buildCss: buildCss,
    themeFor: themeFor
  };
})(typeof window !== "undefined" ? window : globalThis);
