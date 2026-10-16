// Темы, шрифты и сборка CSS для Band (Mattermost). Подключается и на странице Band, и в окне настроек.
(function (root) {
  "use strict";

  // t — оттенки акцентного цвета (как в почтовом расширении), sidebar — цвет боковой панели,
  // accent2 — второй цвет для градиентов и активного канала.
  var THEMES = {
    original: { name: "Как было", note: "Без изменений", swatch: ["#1C58D9", "#F4F4F6"] },
    vice: {
      name: "Вайс-Сити", note: "Закат, пальмы, неон", swatch: ["#7C5BB0", "#F29A96"],
      t: { darker: "#6E1F5E", dark: "#A3307E", primary: "#C23F8C", secondary: "#D45E9E", tertiary: "#E79AC2", light: "#F5D2E5", lighter: "#FAE6F0", lighterAlt: "#FEF5F9" },
      sidebar: "#2E2566", accent2: "#F7A777",
      header: "linear-gradient(90deg, rgba(74,62,156,.72) 0%, rgba(154,90,174,.6) 50%, rgba(233,129,143,.55) 80%, rgba(247,167,119,.5) 100%)",
      gradient: "linear-gradient(120deg, #F7A777 0%, #E5638F 45%, #8E5BC0 100%)",
      wallpaper: "vice-sunset.webp", displayFont: true
    },
    cloud: {
      name: "Облако", note: "Синяя, спокойная", swatch: ["#0F6CBD", "#DEECF9"],
      t: { darker: "#0C3B5E", dark: "#115EA3", primary: "#0F6CBD", secondary: "#2886DE", tertiary: "#62ABF5", light: "#CFE4FA", lighter: "#E6F0FB", lighterAlt: "#F4F8FD" },
      sidebar: "#123A63", accent2: "#62ABF5"
    },
    powder: {
      name: "Пудра", note: "Розовая", swatch: ["#C2507A", "#F9E7EE"],
      t: { darker: "#7F2C4B", dark: "#A83D65", primary: "#C2507A", secondary: "#D06B90", tertiary: "#E39BB6", light: "#F4D7E2", lighter: "#F9E9EF", lighterAlt: "#FDF7F9" },
      sidebar: "#5A2440", accent2: "#E39BB6"
    },
    sage: {
      name: "Шалфей", note: "Мягкая зелёная", swatch: ["#2E7D6B", "#E3F2EE"],
      t: { darker: "#1A4C41", dark: "#24695A", primary: "#2E7D6B", secondary: "#3F9580", tertiary: "#7CBFAE", light: "#CDE8E0", lighter: "#E5F3EF", lighterAlt: "#F4FAF8" },
      sidebar: "#173F36", accent2: "#7CBFAE"
    },
    lavender: {
      name: "Лаванда", note: "Фиолетовая", swatch: ["#6A5ACD", "#EBE8FB"],
      t: { darker: "#3F3390", dark: "#5848B8", primary: "#6A5ACD", secondary: "#7D6FD6", tertiary: "#A99FE6", light: "#DCD7F7", lighter: "#EDEAFB", lighterAlt: "#F8F7FE" },
      sidebar: "#2C2466", accent2: "#A99FE6"
    },
    halloween: {
      name: "Хэллоуин", note: "Тыквы, луна, чёрные коты", swatch: ["#E8711C", "#1E1714"],
      t: { darker: "#6E2F06", dark: "#B4520C", primary: "#E26A12", secondary: "#EE8A3E", tertiary: "#F4B27A", light: "#F9D9BC", lighter: "#FCEADA", lighterAlt: "#FEF6EE" },
      sidebar: "#1E1714", accent2: "#8BD42C",
      header: "linear-gradient(90deg, rgba(30,23,20,.82) 0%, rgba(58,36,24,.7) 50%, rgba(226,106,18,.6) 100%)",
      gradient: "linear-gradient(120deg, #F5A623 0%, #E26A12 50%, #8A3A08 100%)",
      wallpaper: "halloween.webp", displayFont: "rubik-wet-paint"
    },
    custom: { name: "Свой цвет", note: "Выбери цвета сама", swatch: ["#E0457B", "#7C5BB0"], custom: true }
  };

  var FONTS = {
    original: { name: "Как было (Open Sans)" },
    golos: { name: "Golos Text", file: "golos-text" },
    inter: { name: "Inter", file: "inter" },
    manrope: { name: "Manrope", file: "manrope" },
    onest: { name: "Onest", file: "onest" }
  };

  var DEFAULTS = {
    style: "glass", theme: "vice", font: "golos", wallpaper: "theme", dim: 10, blur: 22, customColor: "#E0457B", customColor2: "#7C5BB0",
    sidebarTone: "dark", chatOpacity: 90, radius: 18, headerText: "white", headerTextColor: "#FFFFFF",
    accentText: "theme", accentTextColor: "#C23F8C", displayFont: "auto",
    hero: true, heroHeight: 170, heroImage: "theme", heroPos: 40, heroCollapsed: false, greetingName: "",
    digest: true, statuses: true, notes: true,
    statusPresets: "hamburger | Обед | 60\nheadphones | На созвоне | 60\nhouse | Не за компом | 30\ndart | Фокус, пишите позже | 120"
  };

  function rgbOf(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    if (!/^[0-9a-f]{6}$/i.test(h)) h = "E0457B";
    var n = parseInt(h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }

  function mix(hex, withHex, k) {
    var a = rgbOf(hex), b = rgbOf(withHex);
    return "#" + a.map(function (v, i) {
      var x = Math.round(v + (b[i] - v) * k);
      return (x < 16 ? "0" : "") + x.toString(16);
    }).join("").toUpperCase();
  }

  function rgba(hex, a) { return "rgba(" + rgbOf(hex).join(",") + "," + a + ")"; }

  function customTheme(c1, c2) {
    c1 = c1 || "#E0457B"; c2 = c2 || c1;
    return {
      t: {
        darker: mix(c1, "#000000", .45), dark: mix(c1, "#000000", .2), primary: mix(c1, "#000000", 0), secondary: mix(c1, "#FFFFFF", .18),
        tertiary: mix(c1, "#FFFFFF", .45), light: mix(c1, "#FFFFFF", .75), lighter: mix(c1, "#FFFFFF", .87), lighterAlt: mix(c1, "#FFFFFF", .95)
      },
      sidebar: mix(c1, "#140F24", .72), accent2: c2,
      header: "linear-gradient(90deg," + rgba(mix(c1, "#000000", .3), .7) + "," + rgba(c2, .5) + ")",
      gradient: "linear-gradient(120deg, " + c2 + " 0%, " + c1 + " 100%)"
    };
  }

  function themeFor(s) {
    if (s.theme === "custom") return customTheme(s.customColor, s.customColor2);
    return THEMES[s.theme];
  }

  // Базовые цвета темы Mattermost из нашей палитры.
  function sidebarOf(th, s) {
    return s && s.sidebarTone === "light" ? mix(th.t.lighter, "#FFFFFF", .35) : th.sidebar;
  }

  function baseColors(th, s) {
    var t = th.t, light = s && s.sidebarTone === "light";
    var sb = sidebarOf(th, s), st = light ? mix(th.sidebar, "#1F1B2E", .35) : "#FFFFFF";
    var link = s && s.accentText === "custom" && s.accentTextColor ? s.accentTextColor : t.dark;
    return {
      "--sidebar-bg": sb,
      "--sidebar-text": st,
      "--sidebar-unread-text": st,
      "--sidebar-text-hover-bg": light ? mix(sb, t.primary, .1) : mix(sb, "#FFFFFF", .12),
      "--sidebar-text-active-border": light ? t.primary : th.accent2,
      "--sidebar-text-active-color": light ? t.darker : "#FFFFFF",
      "--sidebar-header-bg": light ? mix(sb, t.primary, .05) : mix(sb, "#000000", .1),
      "--sidebar-teambar-bg": light ? mix(t.light, "#FFFFFF", .25) : mix(sb, "#000000", .22),
      "--sidebar-header-text-color": st,
      "--online-indicator": "#3FC1A0",
      "--away-indicator": "#F5AB07",
      "--dnd-indicator": "#D24B4E",
      "--mention-bg": t.primary,
      "--mention-color": "#FFFFFF",
      "--center-channel-bg": "#FFFFFF",
      "--center-channel-color": mix(th.sidebar, "#141020", .75),
      "--new-message-separator": t.primary,
      "--link-color": link,
      "--button-bg": t.primary,
      "--button-color": "#FFFFFF",
      "--error-text": "#D24B4E",
      "--mention-highlight-bg": mix(th.accent2, "#FFFFFF", .55),
      "--mention-highlight-link": s && s.accentText === "custom" && s.accentTextColor ? mix(s.accentTextColor, "#000000", .2) : t.darker
    };
  }

  // Полупрозрачные варианты, которые Band держит рядом с каждым цветом (взято из разметки band.wb.ru).
  var ALPHAS = {
    "--sidebar-text": ["08", "16", "30", "40", "50", "60", "72", "80"],
    "--sidebar-header-text-color": ["80"],
    "--center-channel-bg": ["88", "80", "64", "56", "40", "30", "20", "16", "08"],
    "--center-channel-color": ["88", "80", "72", "64", "56", "48", "40", "32", "24", "20", "16", "08", "04"],
    "--link-color": ["08"],
    "--button-bg": ["88", "80", "72", "64", "56", "48", "40", "30", "24", "16", "08", "04"],
    "--button-color": ["88", "80", "72", "64", "56", "48", "40", "32", "24", "16", "08", "04"],
    "--error-text": ["08", "12"]
  };

  function varsCss(th, s) {
    var c = baseColors(th, s), out = [];
    Object.keys(c).forEach(function (k) {
      out.push(k + ":" + c[k] + "!important");
      out.push(k + "-rgb:" + rgbOf(c[k]).join(", ") + "!important");
    });
    Object.keys(ALPHAS).forEach(function (k) {
      ALPHAS[k].forEach(function (suf) {
        var a = suf === "30" && k === "--button-bg" ? .32 : parseInt(suf, 10) / 100;
        out.push(k + "-" + suf + ":" + rgba(c[k], a) + "!important");
      });
    });
    out.push("--error-text-color-rgb:" + rgbOf(c["--error-text"]).join(", ") + "!important");
    out.push("--mention-highlight-bg-mixed-rgb:" + rgbOf(mix(c["--mention-highlight-bg"], "#FFFFFF", .5)).join(",") + "!important");
    out.push("--pinned-highlight-bg-mixed-rgb:" + rgbOf(mix(c["--mention-highlight-bg"], "#FFFFFF", .76)).join(",") + "!important");
    out.push("--own-highlight-bg-rgb:" + rgbOf(mix(c["--mention-highlight-bg"], "#000000", .04)).join(",") + "!important");
    return "html:root{" + out.join(";") + "}";
  }

  var CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";
  var LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

  // Шрифт: подменяем Open Sans и Metropolis (шрифты Band) своим — с теми же весами, чтобы наши описания победили.
  function fontCss(fontId, displayFont, urlFor) {
    var f = FONTS[fontId], out = [];
    function faces(family, file, weights) {
      weights.forEach(function (w) {
        [["cyrillic", CYRILLIC], ["latin", LATIN]].forEach(function (sub) {
          out.push("@font-face{font-family:\"" + family + "\";src:url(\"" + urlFor("fonts/" + file + "-" + sub[0] + "-wght-normal.woff2") +
            "\") format(\"woff2\");font-weight:" + w + ";font-style:normal;font-display:swap;unicode-range:" + sub[1] + "}");
        });
      });
    }
    if (f && f.file) {
      faces("Open Sans", f.file, ["300", "400", "500", "600", "700", "800"]);
      faces("Metropolis", f.file, ["300", "400", "500", "600", "700"]);
      faces("Band Restyle UI", f.file, ["100 900"]);
      out.push("html body,html input,html textarea,html button{font-family:\"Band Restyle UI\",\"Open Sans\",sans-serif}");
    }
    if (displayFont) {
      // true — Unbounded (переменный вес), строка — статичный шрифт из fonts/ (например, «rubik-wet-paint»).
      var file = displayFont === true ? "unbounded" : displayFont, w = displayFont === true ? 600 : 400;
      if (displayFont === true) faces("Band Restyle Display", "unbounded", ["200 900"]);
      else [["cyrillic", CYRILLIC], ["latin", LATIN]].forEach(function (sub) {
        out.push("@font-face{font-family:\"Band Restyle Display\";src:url(\"" + urlFor("fonts/" + file + "-" + sub[0] + "-400-normal.woff2") +
          "\") format(\"woff2\");font-weight:400;font-style:normal;font-display:swap;unicode-range:" + sub[1] + "}");
      });
      out.push("html .channel-header__top .channel-header__heading,html #channelHeaderTitle,html .channel-header__title strong,html #sidebarTeamMenuButton span" +
        "{font-family:\"Band Restyle Display\",sans-serif!important;font-weight:" + w + "!important;letter-spacing:0}");
      if (w === 400) out.push(".brs-hello{font-weight:400!important}");
      out.push("html #sidebarTeamMenuButton span{font-size:15px!important}");
    }
    // Код и моноширинный текст не трогаем.
    out.push("html code,html pre,html kbd,html .post-code{font-family:Menlo,Consolas,\"Courier New\",monospace!important}");
    return out.join("\n");
  }

  function lum(hex) {
    var c = rgbOf(hex).map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  }

  function glassCss(th, s, extras) {
    var t = th.t, sb = sidebarOf(th, s), lightSide = s.sidebarTone === "light";
    var R = Math.max(0, Math.min(28, s.radius == null ? 18 : +s.radius)), R2 = Math.max(0, R - 2);
    var chat = Math.max(.5, Math.min(1, (+s.chatOpacity || 84) / 100));
    var ht = s.headerText === "dark" ? "#1F2328" : s.headerText === "custom" ? (s.headerTextColor || "#FFFFFF") : "#FFFFFF";
    var lightText = lum(ht) > .4;
    var dim = Math.max(0, Math.min(70, +s.dim || 0)) / 100;
    var blur = Math.max(0, Math.min(40, +s.blur || 0));
    var bf = "backdrop-filter:blur(" + blur + "px) saturate(1.4);-webkit-backdrop-filter:blur(" + blur + "px) saturate(1.4)";
    var wall = extras.wallpaper ? "url(\"" + extras.wallpaper + "\")"
      : "linear-gradient(135deg," + t.tertiary + " 0%," + t.light + " 45%," + t.lighterAlt + " 100%)";
    var gradient = th.gradient || ("linear-gradient(120deg," + th.accent2 + "," + t.primary + ")");
    var header = th.header || ("linear-gradient(90deg," + rgba(t.darker, .7) + "," + rgba(t.primary, .5) + ")");
    if (!lightText) header = "linear-gradient(90deg," + rgba(t.lighterAlt, .78) + "," + rgba(t.light, .62) + ")";
    var out = [];

    out.push("html body{background:linear-gradient(rgba(0,0,0," + dim + "),rgba(0,0,0," + dim + "))," + wall + " center/cover no-repeat fixed!important}");
    // Подложки делаем прозрачными, карточки — стеклянными.
    out.push("html #root,html .main-wrapper,html .channel-view-inner,html .inner-wrap,html .row.main,html .app__content,html #app-content," +
      "html .channel-header,html #post-list,html .post-list-holder-by-time,html .post-list__dynamic,html .post-list__table,html .post-create__container," +
      "html #channel-header,html .channel-intro,html .sidebarHeaderContainer,html .SidebarChannelGroupHeader,html #lhsNavigator,html .SidebarNavContainer," +
      "html .team-wrapper,html .app-bar{background:transparent!important;background-color:transparent!important}");
    out.push("html .app-bar,html .team-sidebar,html #SidebarContainer,html #channel_view,html #sidebar-right,html .channel-header{border-color:transparent!important;box-shadow:none}");

    // Верхняя панель.
    out.push("html #global-header{background:" + header + "!important;" + bf + ";border:0!important;box-shadow:0 1px 0 rgba(255,255,255,.18)}");
    out.push("html #global-header,html #global-header i,html #global-header button,html #global-header span:not(.emoticon){color:" + ht + "!important}");
    out.push("html #searchFormContainer{background:rgba(255,255,255," + (lightText ? ".18" : ".6") + ")!important;border:1px solid rgba(255,255,255," + (lightText ? ".3" : ".8") + ")!important;" +
      "border-radius:12px!important;color:" + ht + "!important}");
    out.push("html #searchFormContainer:hover{background:rgba(255,255,255," + (lightText ? ".28" : ".8") + ")!important}");
    out.push("html #global-header button:hover{background:rgba(255,255,255," + (lightText ? ".18" : ".5") + ")!important;border-radius:10px}");
    out.push("html #userAccountMenuButton img.Avatar{box-shadow:0 0 0 2px rgba(255,255,255,.9)}");

    // Колонка команд, список каналов, центр, правая панель — стеклянные карточки с отступами.
    out.push("html .team-sidebar{background:" + rgba(mix(sb, "#000000", .2), .42) + "!important;" + bf + ";margin:8px 0 8px 8px;border-radius:" + R2 + "px;height:auto!important;box-sizing:border-box}");
    out.push("html #SidebarContainer{background:" + rgba(sb, lightSide ? .72 : .62) + "!important;" + bf + ";margin:8px 4px 8px 6px;border-radius:" + R + "px;overflow:hidden;height:auto!important;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 10px 30px rgba(20,10,40,.18)!important}");
    out.push("html #channel_view{background:rgba(255,255,255," + chat + ")!important;" + bf + ";margin:8px 8px 8px 4px;border-radius:" + R + "px;overflow:hidden;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.6),0 10px 30px rgba(20,10,40,.14)!important}");
    out.push("html #sidebar-right{background:rgba(255,255,255,.9)!important;" + bf + ";border-radius:" + R + "px;margin:8px 8px 8px 0;overflow:hidden}");
    out.push("html .app-bar{border-left:0!important}");
    out.push("html .app-bar__icon-inner{border-radius:10px}");

    // Каналы: активный — «таблетка» с градиентной полоской.
    out.push("html #SidebarContainer .SidebarLink{border-radius:" + Math.min(10, R) + "px;margin:1px 8px}");
    out.push("html #SidebarContainer .SidebarChannel.active>.SidebarLink,html #SidebarContainer .SidebarChannel.active .SidebarLink{background:" + (lightSide ? rgba(t.primary, .12) : "rgba(255,255,255,.16)") + "!important;" +
      "box-shadow:inset 3px 0 0 " + (lightSide ? t.primary : th.accent2) + "}");
    out.push("html #SidebarContainer .SidebarChannel.active:before{display:none!important}");
    out.push("html .SidebarChannelGroupHeader_groupButton{letter-spacing:.06em;opacity:" + (lightSide ? "1" : ".75") + "}");
    out.push("html #SidebarContainer .SidebarChannelLinkLabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}");
    out.push("html #SidebarContainer .SidebarChannelLinkLabel_wrapper{min-width:0;overflow:hidden}");
    out.push("html .badge,html .SidebarChannel .badge{background:" + gradient + "!important;color:#fff!important}");
    out.push("html .team-container.active .TeamIcon{box-shadow:0 0 0 2px " + th.accent2 + ";border-radius:12px}");

    // Центр: заголовок канала, сообщения, поле ввода.
    out.push("html .channel-header{border-bottom:1px solid " + rgba(t.primary, .1) + "!important}");
    out.push("html .post:hover,html .post.post--hovered{background:" + rgba(t.primary, .05) + "!important;border-radius:12px}");
    out.push("html .post .post__header .user-popover,html .post .post__header button.user-popover{color:" + (s.accentText === "custom" && s.accentTextColor ? s.accentTextColor : t.dark) + "!important;font-weight:700}");
    out.push("html .AdvancedTextEditor{background:#fff!important;border-radius:" + R2 + "px!important;border:1px solid " + rgba(t.primary, .18) + "!important;" +
      "box-shadow:0 6px 20px rgba(20,10,40,.08)!important;overflow:hidden}");
    out.push("html .AdvancedTextEditor:focus-within{border-color:" + rgba(t.primary, .45) + "!important;box-shadow:0 0 0 3px " + rgba(t.primary, .14) + ",0 6px 20px rgba(20,10,40,.08)!important}");
    out.push("html #post-create .send-button:not(.disabled),html .btn-primary,html .btn.btn-primary{background:" + gradient + "!important;border:0!important}");
    out.push("html .new-messages__button,html .toast{background:" + gradient + "!important}");
    out.push("html .Avatar{border-radius:50%}");
    out.push("html .post__img .Avatar{box-shadow:0 2px 8px rgba(20,10,40,.15)}");

    // Тонкие скроллбары.
    out.push("html ::-webkit-scrollbar{width:10px;height:10px}html ::-webkit-scrollbar-thumb{border:3px solid transparent;background-clip:content-box;border-radius:10px;background-color:rgba(0,0,0,.22)}");
    out.push("html #SidebarContainer ::-webkit-scrollbar-thumb,html #SidebarContainer .scrollbar--vertical{background-color:" + (lightSide ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.28)") + "!important}");
    out.push("html ::-webkit-scrollbar-track{background:transparent}");
    return out.join("\n");
  }

  // Светлая панель: Band рисует прочитанные каналы полупрозрачным цветом текста — на светлом фоне это бледно-серый.
  // Делаем текст насыщенным тёмным цветом темы.
  function lightSidebarCss(th) {
    var ink = mix(th.sidebar, "#000000", .35), soft = mix(ink, "#FFFFFF", .18);
    return [
      "html #SidebarContainer .SidebarLink,html #SidebarContainer .SidebarLink .icon,html #SidebarContainer .SidebarLink i," +
        "html #SidebarContainer .SidebarChannelLinkLabel{color:" + soft + "!important;opacity:1!important}",
      "html #SidebarContainer .SidebarChannel.unread .SidebarLink,html #SidebarContainer .SidebarChannel.unread .SidebarChannelLinkLabel," +
        "html #SidebarContainer .SidebarChannel.active .SidebarLink,html #SidebarContainer .SidebarChannel.active .SidebarChannelLinkLabel{color:" + ink + "!important;font-weight:700}",
      "html #SidebarContainer .SidebarChannelGroupHeader_groupButton,html #SidebarContainer .SidebarChannelGroupHeader_groupButton *{color:" + soft + "!important;opacity:.9!important}",
      "html #SidebarContainer #sidebarTeamMenuButton,html #SidebarContainer #sidebarTeamMenuButton *,html #SidebarContainer .sidebarHeaderContainer button{color:" + ink + "!important}",
      "html #SidebarContainer #SidebarChannelNavigatorButton{color:" + soft + "!important;background:" + rgba(th.t.primary, .08) + "!important}",
      "html #SidebarContainer #SidebarChannelNavigatorButton *{color:" + soft + "!important}",
      "html #SidebarContainer .SidebarChannelNavigator_shortcutText{opacity:.7}"
    ].join("\n");
  }

  // Band рисует текст сообщений и заголовки полупрозрачным цветом — на стекле это бледно-серый. Делаем сплошным.
  function readableTextCss() {
    var ink = "var(--center-channel-color)";
    return [
      "html .post-message__text,html .post-message__text p,html .post-message__text li,html .post-message__text td,html .post-message__text th," +
        "html .post-message__text blockquote,html .post-message__text h1,html .post-message__text h2,html .post-message__text h3," +
        "html .post-message__text h4,html .post-message__text h5,html .post-message__text h6,html .post-message__text .markdown__heading," +
        "html .post__body,html .post-message,html .post-attachment,html .attachment__body,html .attachment__text,html .attachment__title," +
        "html .channel-intro,html .channel-intro__text{color:" + ink + "!important;opacity:1!important}",
      "html .post-message__text h1,html .post-message__text h2,html .post-message__text h3,html .post-message__text .markdown__heading{font-weight:700}",
      "html .post-message__text blockquote{border-left-color:" + "rgba(var(--button-bg-rgb),.4)!important}",
      "html .post__time,html .post-edited__indicator,html .post__header .post-pre-header{color:rgba(var(--center-channel-color-rgb),.62)!important;opacity:1!important}",
      "html .channel-header__description,html .channel-header__description *{color:rgba(var(--center-channel-color-rgb),.7)!important}"
    ].join("\n");
  }

  // Значки статуса у людей: свои цвета (онлайн — зелёный и т. д.), даже если иконкам в панели задан другой цвет.
  function statusIconsCss() {
    var scope = ["html #SidebarContainer .SidebarLink ", "html #SidebarContainer ", "html "];
    function rule(cls, color) {
      return scope.map(function (sc) { return sc + "." + cls + "," + sc + "." + cls + " *"; }).join(",") +
        "{color:" + color + "!important;fill:" + color + "!important;opacity:1!important}";
    }
    return [
      rule("online--icon", "var(--online-indicator)"),
      rule("away--icon", "var(--away-indicator)"),
      rule("dnd--icon", "var(--dnd-indicator)"),
      rule("offline--icon", "rgba(var(--sidebar-text-rgb),.5)"),
      // Старый вариант разметки статуса (svg внутри .status).
      "html #SidebarContainer .status.online svg,html #SidebarContainer .status--online svg{fill:var(--online-indicator)!important}",
      "html #SidebarContainer .status.away svg,html #SidebarContainer .status--away svg{fill:var(--away-indicator)!important}",
      "html #SidebarContainer .status.dnd svg,html #SidebarContainer .status--dnd svg{fill:var(--dnd-indicator)!important}"
    ].join("\n");
  }

  function buildCss(s, urlFor, extras) {
    extras = extras || {};
    var th = themeFor(s);
    var css = [];
    if (th && th.t) {
      css.push(varsCss(th, s));
      css.push(readableTextCss());
      if (s.style === "glass") css.push(glassCss(th, s, extras));
      if (s.sidebarTone === "light") css.push(lightSidebarCss(th));
      css.push(statusIconsCss());
    }
    var display = s.displayFont === "on" ? (th && th.displayFont) || true
      : s.displayFont !== "off" && th && th.displayFont && s.style === "glass" ? th.displayFont : false;
    css.push(fontCss(s.font, display, urlFor));
    return css.join("\n");
  }

  root.BAND_RESTYLE = { THEMES: THEMES, FONTS: FONTS, DEFAULTS: DEFAULTS, buildCss: buildCss, themeFor: themeFor, mix: mix, rgba: rgba };
})(typeof window !== "undefined" ? window : globalThis);
