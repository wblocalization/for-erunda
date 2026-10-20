// Темы, шрифты и сборка CSS для Tracker (tracker.wb.ru). Подключается и на странице трекера, и в окне настроек.
// Классы трекера — CSS-модули с хешем в конце (sidebar_root_Iex1Dy1N), поэтому ищем их по началу имени.
(function (root) {
  "use strict";

  var THEMES = {
    original: { name: "Как было", note: "Без изменений", swatch: ["#6B5BD6", "#F2F2F5"] },
    vice: {
      name: "Вайс-Сити", note: "Закат, пальмы, неон", swatch: ["#7C5BB0", "#F29A96"],
      t: { darker: "#6E1F5E", dark: "#A3307E", primary: "#C23F8C", secondary: "#D45E9E", tertiary: "#E79AC2", light: "#F5D2E5", lighter: "#FAE6F0", lighterAlt: "#FEF5F9" },
      sidebar: "#2E2566", accent2: "#F7A777",
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
      gradient: "linear-gradient(120deg, #F5A623 0%, #E26A12 50%, #8A3A08 100%)",
      wallpaper: "halloween.webp", displayFont: "rubik-wet-paint"
    },
    custom: { name: "Свой цвет", note: "Выбери цвета сама", swatch: ["#E0457B", "#7C5BB0"], custom: true }
  };

  var FONTS = {
    original: { name: "Как было (IBM Plex Sans)" },
    golos: { name: "Golos Text", file: "golos-text" },
    inter: { name: "Inter", file: "inter" },
    manrope: { name: "Manrope", file: "manrope" },
    onest: { name: "Onest", file: "onest" },
    montserrat: { name: "Montserrat", file: "montserrat" },
    nunito: { name: "Nunito", note: "мягкий", file: "nunito" },
    rubik: { name: "Rubik", file: "rubik" },
    roboto: { name: "Roboto", file: "roboto" },
    jost: { name: "Jost", file: "jost" },
    raleway: { name: "Raleway", file: "raleway" },
    exo2: { name: "Exo 2", note: "техно", file: "exo-2" },
    comfortaa: { name: "Comfortaa", note: "круглый", file: "comfortaa" }
  };

  // Декоративные шрифты для заголовков. v — переменный вес, иначе статичный файл веса w.
  var DISPLAY_FONTS = {
    unbounded: { name: "Unbounded", file: "unbounded", v: true },
    "rubik-wet-paint": { name: "Rubik Wet Paint", note: "стекающий", file: "rubik-wet-paint", w: 400 },
    lobster: { name: "Lobster", note: "ретро", file: "lobster", w: 400 },
    caveat: { name: "Caveat", note: "от руки", file: "caveat", v: true, size: 1.25 },
    pacifico: { name: "Pacifico", note: "курсив", file: "pacifico", w: 400 },
    "russo-one": { name: "Russo One", file: "russo-one", w: 400 },
    "rubik-bubbles": { name: "Rubik Bubbles", note: "пузыри", file: "rubik-bubbles", w: 400 },
    "amatic-sc": { name: "Amatic SC", note: "узкий", file: "amatic-sc", w: 700, size: 1.3 },
    "press-start-2p": { name: "Press Start 2P", note: "пиксельный", file: "press-start-2p", w: 400, size: .62 }
  };

  // Размер текста: множитель к размерам трекера (xsmall 12, small 14, medium 16).
  var TEXT_SIZES = { normal: { name: "Как было", k: 1 }, big: { name: "Крупнее", k: 1.12 }, bigger: { name: "Ещё крупнее", k: 1.24 } };

  function displayFontFor(s, th) {
    var pick = s && s.displayFont;
    if (pick === "off") return null;
    if (pick && pick !== "auto" && pick !== "on" && DISPLAY_FONTS[pick]) return pick;
    var td = th && th.displayFont;
    if (s && s.style !== "glass") return null;
    return td === true ? "unbounded" : td || null;
  }

  var DEFAULTS = {
    style: "glass", theme: "vice", font: "golos", wallpaper: "theme", dim: 10, blur: 22, customColor: "#E0457B", customColor2: "#7C5BB0",
    sidebarTone: "dark", panelOpacity: 88, radius: 18, displayFont: "auto", textSize: "big",
    hideSurvey: true, statusStripes: true, solidText: true
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
      gradient: "linear-gradient(120deg, " + c2 + " 0%, " + c1 + " 100%)"
    };
  }

  function themeFor(s) {
    if (s.theme === "custom") return customTheme(s.customColor, s.customColor2);
    return THEMES[s.theme];
  }

  // Класс CSS-модуля по началу имени: k("sidebar_root") → элементы с классом sidebar_root_XXXX.
  function k(name) { return ":is([class^=\"" + name + "_\"],[class*=\" " + name + "_\"])"; }

  var SIDEBAR = "html " + k("sidebar_root");
  var CONTENT = "html " + k("sidebar-layout_contentArea");
  var PREVIEW = "html " + k("slide-panel_panel");
  var CARD = "html " + k("card_card");
  var COLUMN = "html .kanban-column-body";
  var EMPTY_COL = "html " + k("swimlanes_emptyColumn");
  var COL_HEAD = "html " + k("column-header_emptyBlock");

  // Токены дизайн-системы трекера: подменяем акцентный (основной) цвет на цвет темы.
  function tokensCss(th) {
    var t = th.t, out = [
      "--color-background-accent-primary-bolder-default:" + t.primary,
      "--color-background-accent-primary-bolder-hovered:" + t.dark,
      "--color-background-accent-primary-bolder-pressed:" + t.darker,
      "--color-background-accent-primary-subtler-default:" + t.lighter,
      "--color-background-accent-primary-subtlest-default:" + t.lighterAlt,
      "--color-text-accent-primary-default:" + t.dark,
      "--color-icon-accent-primary-default:" + t.primary,
      "--color-border-accent-primary:" + t.primary,
      "--color-border-focused:" + t.primary,
      "--color-text-link-default:" + t.dark
    ];
    return "html:root,html [class*=\"wb-ids-theme\"]{" + out.map(function (x) { return x + "!important"; }).join(";") + "}";
  }

  // Общие правки цвета: кнопки, вкладки, ссылки, счётчики, статусы — для обоих стилей.
  function colorsCss(th, s) {
    var t = th.t, gradient = th.gradient || ("linear-gradient(120deg," + th.accent2 + "," + t.primary + ")");
    var out = [];
    out.push("html [data-testid=\"create_issue_button\"],html button[class*=\"_root_color_primary_bold\"]{background:" + gradient + "!important;border:0!important;color:#fff!important;" +
      "box-shadow:0 6px 16px " + rgba(t.primary, .28) + "!important;border-radius:12px!important}");
    out.push("html [data-testid=\"create_issue_button\"] *,html button[class*=\"_root_color_primary_bold\"] *{color:#fff!important}");
    out.push("html [data-testid=\"create_issue_button\"]:hover{filter:brightness(1.06) saturate(1.1)}");
    // Вкладки «Список / Бэклог / Доска / Гант» и вкладки в задаче.
    out.push("html [role=\"tab\"][aria-selected=\"true\"],html [role=\"tab\"][aria-selected=\"true\"] *{color:" + t.dark + "!important}");
    out.push("html [role=\"tab\"][aria-selected=\"true\"]::after,html [role=\"tab\"][aria-selected=\"true\"]::before{background:" + t.primary + "!important;border-color:" + t.primary + "!important}");
    out.push("html [role=\"tab\"]{border-radius:10px 10px 0 0}");
    out.push("html [role=\"tab\"]:hover{background:" + rgba(t.primary, .07) + "!important}");
    // Выбранный чип «Все задачи».
    out.push("html button[aria-pressed=\"true\"][class*=\"_root_isSelected\"]{background:" + rgba(t.primary, .12) + "!important;border-color:" + rgba(t.primary, .45) + "!important;color:" + t.darker + "!important;border-radius:10px!important}");
    out.push("html button[aria-pressed=\"true\"][class*=\"_root_isSelected\"] *{color:" + t.darker + "!important}");
    // Ссылки в описании задачи и номера задач на карточках.
    out.push("html .TextEditor a,html [class*=\"TextEditor\"] a{color:" + t.dark + "!important}");
    out.push("html " + k("issue-card_id") + "{color:" + t.dark + "!important;font-weight:700!important;letter-spacing:.01em}");
    out.push("html [data-testid=\"issue_header_current_code\"]{color:" + t.dark + "!important}");
    // Счётчики у колонок и людей.
    out.push("html " + k("column-header_headInfo") + " [role=\"row\"],html " + k("swimlane-header_content") + " [role=\"row\"]{background:" + rgba(t.primary, .14) + "!important;color:" + t.darker + "!important;border-radius:999px!important}");
    out.push("html " + k("column-header_headInfo") + " [role=\"row\"] *,html " + k("swimlane-header_content") + " [role=\"row\"] *{color:" + t.darker + "!important;font-weight:700!important}");
    // Статусы: аккуратные таблетки.
    out.push("html " + k("issue-card_header") + " > span:not(" + k("issue-card_id") + "),html [data-testid=\"issue_sidebar_status_value\"] > span{border-radius:999px!important;padding:1px 9px!important;letter-spacing:.03em}");
    // Выбранный пункт в боковой панели.
    out.push(SIDEBAR + " [role=\"row\"][aria-selected=\"true\"] > [role=\"gridcell\"] > * > div{background:" + rgba(t.primary, .13) + "!important;border-radius:10px!important}");
    out.push(SIDEBAR + " [role=\"row\"][aria-selected=\"true\"] :is(span,a){color:" + t.darker + "!important;font-weight:650}");
    // Фокус.
    out.push("html :focus-visible{outline-color:" + t.primary + "!important}");
    return out.join("\n");
  }

  // Карточки задач: белые, скруглённые, с тенью; цветная полоска слева по статусу.
  function cardsCss(th, s, R) {
    var t = th.t, out = [], Rc = Math.min(14, R);
    out.push(CARD + "{background:var(--trs-card)!important;border-radius:" + Rc + "px!important;border:1px solid var(--trs-card-line)!important;" +
      "box-shadow:0 2px 8px rgba(30,20,60,.06)!important;transition:transform .15s,box-shadow .15s;overflow:hidden}");
    out.push(CARD + ":hover{transform:translateY(-1px);box-shadow:0 8px 22px " + rgba(t.darker, .14) + "!important;border-color:" + rgba(t.primary, .35) + "!important}");
    if (s.statusStripes !== false) {
      [["success", "#2FA36B"], ["discovery", t.primary], ["warning", "#E8A317"], ["danger", "#D9534F"]].forEach(function (c) {
        out.push(CARD + ":has(" + k("issue-card_header") + " [class*=\"_" + c[0] + "\"]){box-shadow:inset 4px 0 0 " + c[1] + ",0 2px 8px rgba(30,20,60,.06)!important}");
        out.push(CARD + ":has(" + k("issue-card_header") + " [class*=\"_" + c[0] + "\"]):hover{box-shadow:inset 4px 0 0 " + c[1] + ",0 8px 22px " + rgba(t.darker, .14) + "!important}");
      });
      out.push(CARD + " " + k("card_content") + "{padding-left:4px}");
    }
    // Колонки: мягкий оттенок темы вместо серого.
    out.push(COLUMN + "," + EMPTY_COL + "{background:var(--trs-column)!important;border-radius:" + Rc + "px!important}");
    out.push(COL_HEAD + "{background:var(--trs-column-head)!important;border-radius:" + Rc + "px!important;box-shadow:inset 0 -3px 0 " + rgba(t.primary, .35) + "}");
    out.push(COL_HEAD + " span{font-weight:700!important;color:var(--trs-ink)!important}");
    return out.join("\n");
  }

  // Текст трекера бледно-серый: делаем сплошным и чуть крупнее.
  function textCss(s) {
    var z = (TEXT_SIZES[s.textSize] || TEXT_SIZES.normal).k, out = [];
    if (z !== 1) {
      [["xsmall", 12, 16], ["small", 14, 20], ["medium", 16, 24], ["large", 20, 28]].forEach(function (x) {
        out.push("html [class*=\"_textRoot_size_" + x[0] + "\"]{font-size:" + (x[1] * z).toFixed(1) + "px!important;line-height:" + (x[2] * z).toFixed(1) + "px!important}");
      });
      out.push(SIDEBAR + " [role=\"row\"]{font-size:" + (14 * z).toFixed(1) + "px!important}");
      out.push("html .TextEditor,html .TextEditor p,html .TextEditor li{font-size:" + (14 * z).toFixed(1) + "px!important;line-height:1.5!important}");
      out.push("html [role=\"tab\"]{font-size:" + (14 * z).toFixed(1) + "px!important}");
    }
    if (s.solidText !== false) {
      out.push("html [class*=\"_textRoot_color_default\"]{color:var(--trs-ink)!important}");
      out.push("html [class*=\"_textRoot_color_subtle\"]:not([class*=\"_textRoot_color_subtlest\"]){color:var(--trs-ink-soft)!important}");
      out.push("html [class*=\"_textRoot_color_subtlest\"]{color:var(--trs-ink-mute)!important}");
      out.push("html .TextEditor{color:var(--trs-ink)!important}");
    }
    return out.join("\n");
  }

  function glassCss(th, s, extras) {
    var t = th.t, light = s.sidebarTone === "light";
    var R = Math.max(0, Math.min(28, s.radius == null ? 18 : +s.radius)), R2 = Math.max(0, R - 4);
    var panel = Math.max(.5, Math.min(1, (+s.panelOpacity || 88) / 100));
    var dim = Math.max(0, Math.min(70, +s.dim || 0)) / 100;
    var blur = Math.max(0, Math.min(40, +s.blur || 0));
    var bf = "backdrop-filter:blur(" + blur + "px) saturate(1.4);-webkit-backdrop-filter:blur(" + blur + "px) saturate(1.4)";
    var wall = extras.wallpaper ? "url(\"" + extras.wallpaper + "\")"
      : "linear-gradient(135deg," + t.tertiary + " 0%," + t.light + " 45%," + t.lighterAlt + " 100%)";
    var sb = light ? mix(t.lighter, "#FFFFFF", .35) : th.sidebar;
    var st = light ? mix(th.sidebar, "#000000", .35) : "#FFFFFF";
    var stSoft = light ? mix(st, "#FFFFFF", .2) : "rgba(255,255,255,.82)";
    var out = [];

    out.push("html body{background:linear-gradient(rgba(0,0,0," + dim + "),rgba(0,0,0," + dim + "))," + wall + " center/cover no-repeat fixed!important}");
    out.push("html body #root,html [class*=\"wb-ids-theme\"],html [data-overlay-container],html " + k("sidebar-layout_root") + ",html " + k("sidebar-layout_sidebarColumn") + "," +
      "html " + k("sidebar-layout_sidebarReal") + ",html " + k("board-layout_root") + ",html " + k("board-header_root") + ",html " + k("route-component_filterWrapper") + "," +
      "html " + k("route-component_boardWrapper") + ",html " + k("board_content") + ",html " + k("column-header_container") + ",html " + k("swimlanes_root") + "," +
      "html [data-testid=\"board-root\"],html [data-testid=\"board-columns\"]{background:transparent!important;background-color:transparent!important}");

    // Боковая панель — стеклянная карточка в цвете темы.
    out.push("html " + k("sidebar-layout_root") + "{padding:10px!important;box-sizing:border-box!important}");
    out.push(SIDEBAR + "{background:" + rgba(sb, light ? .74 : .66) + "!important;position:relative;isolation:isolate;" +
      "height:100%!important;box-sizing:border-box;border-radius:" + R + "px;border:0!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 12px 32px rgba(20,10,40,.2)!important;overflow:hidden}");
    out.push(SIDEBAR + "::before{content:\"\";position:absolute;inset:0;border-radius:inherit;" + bf + ";z-index:-1;pointer-events:none}");
    out.push(SIDEBAR + " *{border-color:" + (light ? rgba(t.primary, .12) : "rgba(255,255,255,.12)") + "!important}");
    out.push(SIDEBAR + " :is(div,section,header,footer,nav,aside):not([class*=\"_root_color-\"]):not([class*=\"avatar\"]){background-color:transparent!important}");
    out.push(SIDEBAR + " :is(span,a,div,button,p):not([class*=\"_root_color-\"]):not([class*=\"_root_color-\"] *):not([data-testid=\"create_issue_button\"]):not([data-testid=\"create_issue_button\"] *){color:" + stSoft + "!important}");
    out.push(SIDEBAR + " svg:not([class*=\"_root_color-\"] svg):not([data-testid=\"create_issue_button\"] svg){color:" + stSoft + "!important}");
    out.push(SIDEBAR + "{--color-icon-default:" + stSoft + ";--color-icon-subtle:" + stSoft + ";--color-text-default:" + st + ";--color-text-subtle:" + stSoft + "}");
    out.push(SIDEBAR + " [role=\"row\"] > [role=\"gridcell\"] > * > div{border-radius:" + Math.min(12, R) + "px!important;transition:background .15s}");
    out.push(SIDEBAR + " [role=\"row\"]:hover > [role=\"gridcell\"] > * > div{background:" + (light ? rgba(t.primary, .08) : "rgba(255,255,255,.1)") + "!important}");
    out.push(SIDEBAR + " [role=\"row\"][aria-selected=\"true\"] > [role=\"gridcell\"] > * > div{background:" + (light ? rgba(t.primary, .14) : "rgba(255,255,255,.18)") + "!important;" +
      "box-shadow:inset 3px 0 0 " + (light ? t.primary : th.accent2) + "}");
    out.push(SIDEBAR + " [role=\"row\"][aria-selected=\"true\"] :is(span,a,div){color:" + st + "!important;font-weight:650}");
    if (!light) out.push(SIDEBAR + " " + k("logo_logo") + " img{filter:brightness(0) invert(1)}");
    out.push(SIDEBAR + " [data-testid=\"create_issue_button\"],"+ SIDEBAR + " [data-testid=\"create_issue_button\"] *{color:#fff!important}");
    out.push("html " + k("resize-handle_line") + "{background:transparent!important}");

    // Основная область — светлая стеклянная панель.
    out.push(CONTENT + "{background:var(--trs-panel)!important;position:relative;isolation:isolate;margin-left:8px;border-radius:" + R + "px;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.55),0 12px 32px rgba(20,10,40,.16)!important;overflow:hidden;min-width:0}");
    out.push(CONTENT + "::before{content:\"\";position:absolute;inset:0;border-radius:inherit;" + bf + ";z-index:-1;pointer-events:none}");
    out.push("html " + k("board-header_boardTools") + " span{color:var(--trs-ink)!important}");
    out.push("html " + k("board-header_tabsWrapper") + "{border-color:" + rgba(t.primary, .14) + "!important}");

    // Баннер с опросом сверху — тоже в цвет темы, если не спрятан.
    out.push("html [data-overlay-container] > div:has(" + k("survey-banner_link") + "){background:" + (th.gradient || t.primary) + "!important}");

    // Окно задачи справа.
    out.push(PREVIEW + "{background:var(--trs-preview)!important;border-radius:" + R + "px 0 0 " + R + "px!important;" +
      "box-shadow:-12px 0 40px rgba(20,10,40,.22)!important;border:0!important}");
    out.push(PREVIEW + " " + k("issue-preview-header_root") + "{background:transparent!important}");

    // Всплывающие меню и окна — скругления.
    out.push("html [role=\"dialog\"],html [role=\"menu\"],html [role=\"listbox\"],html .react-aria-Popover{border-radius:" + Math.max(8, R2) + "px!important}");

    out.push("html ::-webkit-scrollbar{width:10px;height:10px}html ::-webkit-scrollbar-thumb{border:3px solid transparent;background-clip:content-box;border-radius:10px;background-color:rgba(0,0,0,.22)}");
    out.push(SIDEBAR + " ::-webkit-scrollbar-thumb{background-color:" + (light ? "rgba(0,0,0,.2)" : "rgba(255,255,255,.28)") + "}");
    out.push("html ::-webkit-scrollbar-track{background:transparent}");
    return out.join("\n");
  }

  // Переменные цветов: светлый и тёмный режим трекера.
  function surfaceVars(th, s) {
    var t = th.t, panel = Math.max(.5, Math.min(1, (+s.panelOpacity || 88) / 100));
    var ink = mix(th.sidebar, "#141020", .7);
    var glass = s.style === "glass";
    return [
      "html.wb-ids-light,html:not(.wb-ids-dark){--trs-ink:" + ink + ";--trs-ink-soft:" + mix(ink, "#FFFFFF", .25) + ";--trs-ink-mute:" + mix(ink, "#FFFFFF", .42) + ";" +
        "--trs-panel:rgba(255,255,255," + panel + ");--trs-preview:rgba(255,255,255,.98);--trs-card:#FFFFFF;--trs-card-line:" + rgba(t.primary, .1) + ";" +
        "--trs-column:" + (glass ? rgba(t.lighter, .72) : mix(t.lighterAlt, "#F3F3F6", .4)) + ";--trs-column-head:" + (glass ? rgba(t.lighter, .8) : t.lighter) + "}",
      "html.wb-ids-dark{--trs-ink:#ECEAF4;--trs-ink-soft:#C9C5D8;--trs-ink-mute:#A19CB4;" +
        "--trs-panel:" + rgba(mix(th.sidebar, "#0E0C16", .55), panel) + ";--trs-preview:" + rgba(mix(th.sidebar, "#0E0C16", .6), .98) + ";" +
        "--trs-card:" + mix(th.sidebar, "#1A1724", .7) + ";--trs-card-line:rgba(255,255,255,.08);--trs-column:rgba(255,255,255,.05);--trs-column-head:" + rgba(t.primary, .22) + "}"
    ].join("\n");
  }

  var CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";
  var LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

  function fontCss(fontId, displayFont, urlFor) {
    var f = FONTS[fontId], out = [];
    function faces(family, file, weight) {
      [["cyrillic", CYRILLIC], ["latin", LATIN]].forEach(function (sub) {
        out.push("@font-face{font-family:\"" + family + "\";src:url(\"" + urlFor("fonts/" + file + "-" + sub[0] + "-wght-normal.woff2") +
          "\") format(\"woff2\");font-weight:" + weight + ";font-style:normal;font-display:swap;unicode-range:" + sub[1] + "}");
      });
    }
    if (f && f.file) {
      // Подменяем IBM Plex Sans (шрифт трекера) своим и ставим свой шрифт явно.
      faces("IBM Plex Sans", f.file, "100 900");
      faces("Tracker Restyle UI", f.file, "100 900");
      out.push("html body,html body :is(div,span,a,p,li,button,input,textarea,label,h1,h2,h3,h4,h5,h6,td,th,select){font-family:\"Tracker Restyle UI\",\"IBM Plex Sans\",sans-serif!important}");
    }
    var df = displayFont && DISPLAY_FONTS[displayFont];
    if (df) {
      [["cyrillic", CYRILLIC], ["latin", LATIN]].forEach(function (sub) {
        out.push("@font-face{font-family:\"Tracker Restyle Display\";src:url(\"" + urlFor("fonts/" + df.file + "-" + sub[0] + "-" + (df.v ? "wght" : df.w) + "-normal.woff2") +
          "\") format(\"woff2\");font-weight:" + (df.v ? "200 900" : df.w) + ";font-style:normal;font-display:swap;unicode-range:" + sub[1] + "}");
      });
      var w = df.v ? 650 : df.w, z = df.size || 1;
      out.push("html " + k("board-header_boardTools") + " span{font-family:\"Tracker Restyle Display\",sans-serif!important;font-weight:" + w + "!important;font-size:" + Math.round(26 * z) + "px!important;line-height:1.25!important;letter-spacing:0}");
    } else {
      out.push("html " + k("board-header_boardTools") + " span{font-size:24px!important;font-weight:700!important;line-height:1.25!important}");
    }
    out.push("html code,html pre,html kbd{font-family:Menlo,Consolas,\"Courier New\",monospace!important}");
    return out.join("\n");
  }

  function surveyCss() {
    return "html [data-overlay-container] > div:has(" + k("survey-banner_link") + "){display:none!important}";
  }

  function buildCss(s, urlFor, extras) {
    extras = extras || {};
    var th = themeFor(s);
    var css = [];
    if (s.hideSurvey !== false) css.push(surveyCss());
    if (th && th.t) {
      var R = Math.max(0, Math.min(28, s.radius == null ? 18 : +s.radius));
      css.push(tokensCss(th));
      css.push(surfaceVars(th, s));
      css.push(colorsCss(th, s));
      css.push(cardsCss(th, s, R));
      if (s.style === "glass") css.push(glassCss(th, s, extras));
    }
    if (th && th.t || s.textSize !== "normal") {
      if (!(th && th.t)) css.push(surfaceVars(THEMES.lavender, s));
      css.push(textCss(s));
    }
    css.push(fontCss(s.font, displayFontFor(s, th), urlFor));
    return css.join("\n");
  }

  root.TRACKER_RESTYLE = {
    THEMES: THEMES, FONTS: FONTS, DISPLAY_FONTS: DISPLAY_FONTS, TEXT_SIZES: TEXT_SIZES, displayFontFor: displayFontFor,
    DEFAULTS: DEFAULTS, buildCss: buildCss, themeFor: themeFor, mix: mix, rgba: rgba
  };
})(typeof window !== "undefined" ? window : globalThis);
