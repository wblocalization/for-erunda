// Баннер с приветствием, утренняя сводка, быстрые статусы и личные заметки к каналам.
// Данные берутся из API самого Band (Mattermost, /api/v4) под текущим входом — так же, как это делает Band.
// Всё, что мы добавляем, живёт вне дерева React (прямо в <body>) и только позиционируется над окном чата.
(function () {
  "use strict";
  var R = window.BAND_RESTYLE;
  var settings = R.DEFAULTS;
  var extras = { heroImage: null };

  // ---------- API Band ----------
  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function api(path, method, body) {
    var headers = { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" };
    if (method && method !== "GET") {
      headers["X-CSRF-Token"] = cookie("MMCSRF");
      headers["Content-Type"] = "application/json";
    }
    return fetch("/api/v4" + path, { method: method || "GET", credentials: "include", headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
  }

  var cache = { me: null, teams: {}, users: {} };

  function me() {
    if (cache.me) return Promise.resolve(cache.me);
    return api("/users/me").then(function (u) { cache.me = u; return u; });
  }

  function teamName() {
    var p = location.pathname.split("/").filter(Boolean);
    return p[0] && ["login", "admin_console", "select_team", "plug", "boards", "playbooks"].indexOf(p[0]) < 0 ? p[0] : "";
  }

  function team() {
    var name = teamName();
    if (!name) return Promise.resolve(null);
    if (cache.teams[name]) return Promise.resolve(cache.teams[name]);
    return api("/teams/name/" + encodeURIComponent(name)).then(function (t) { cache.teams[name] = t; return t; });
  }

  function usersByIds(ids) {
    var need = ids.filter(function (id) { return !cache.users[id]; });
    if (!need.length) return Promise.resolve();
    return api("/users/ids", "POST", need).then(function (list) {
      (list || []).forEach(function (u) { cache.users[u.id] = u; });
    }).catch(function () { /* имена личных переписок не критичны */ });
  }

  function displayName(u) {
    if (!u) return "";
    var full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full || u.nickname || u.username || "";
  }

  // ---------- Сводка ----------
  var digest = { at: 0, data: null, pending: null, error: "" };

  function loadDigest() {
    if (digest.pending) return digest.pending;
    if (digest.data && Date.now() - digest.at < 90 * 1000) return Promise.resolve(digest.data);
    digest.pending = Promise.all([me(), team()]).then(function (res) {
      var u = res[0], t = res[1];
      if (!t) return { mentions: 0, threads: 0, threadMentions: 0, channels: [] };
      return Promise.all([
        api("/users/me/teams/unread").catch(function () { return []; }),
        api("/users/me/teams/" + t.id + "/channels"),
        api("/users/me/teams/" + t.id + "/channels/members"),
        api("/users/" + u.id + "/teams/" + t.id + "/threads?per_page=1&unread=true&totalsOnly=true").catch(function () { return null; })
      ]).then(function (r) {
        var unreadTeams = r[0] || [], chans = r[1] || [], members = r[2] || [], threads = r[3];
        var byId = {};
        chans.forEach(function (c) { byId[c.id] = c; });
        var list = members.filter(function (m) { return m.mention_count > 0 && byId[m.channel_id]; }).map(function (m) {
          return { ch: byId[m.channel_id], mentions: m.mention_count };
        }).sort(function (a, b) { return b.mentions - a.mentions; });
        var mentions = unreadTeams.reduce(function (n, x) { return n + (x.mention_count || 0); }, 0);
        if (!unreadTeams.length) mentions = list.reduce(function (n, x) { return n + x.mentions; }, 0);
        var dmIds = [];
        list.forEach(function (x) {
          if (x.ch.type === "D") x.ch.name.split("__").forEach(function (id) { if (id !== u.id) dmIds.push(id); });
        });
        return usersByIds(dmIds).then(function () {
          return {
            mentions: mentions,
            threads: threads ? (threads.total_unread_threads || 0) : 0,
            threadMentions: threads ? (threads.total_unread_mentions || 0) : 0,
            channels: list.slice(0, 4).map(function (x) {
              var c = x.ch, name = c.display_name, href = "/" + t.name + "/channels/" + c.name;
              if (c.type === "D") {
                var other = cache.users[c.name.split("__").filter(function (id) { return id !== u.id; })[0]];
                name = displayName(other) || "Личные сообщения";
                if (other) href = "/" + t.name + "/messages/@" + other.username;
              }
              return { name: name, mentions: x.mentions, href: href, dm: c.type === "D" };
            })
          };
        });
      });
    }).then(function (data) {
      digest = { at: Date.now(), data: data, pending: null, error: "" };
      return data;
    }, function (e) {
      digest = { at: Date.now(), data: digest.data, pending: null, error: String(e && e.message || e) };
      try { chrome.storage.local.set({ bandStatus: { ok: false, error: digest.error, at: Date.now() } }); } catch (x) { /* ignore */ }
      return digest.data;
    });
    return digest.pending;
  }

  // ---------- Статусы ----------
  var EMOJI = {
    hamburger: "🍔", coffee: "☕", headphones: "🎧", house: "🏠", dart: "🎯", palm_tree: "🌴", calendar: "📅",
    car: "🚗", thermometer_face: "🤒", sleeping: "😴", rocket: "🚀", pizza: "🍕", computer: "💻", speech_balloon: "💬"
  };

  function presets() {
    return String(settings.statusPresets || "").split("\n").map(function (line) {
      var p = line.split("|").map(function (x) { return x.trim(); });
      if (p.length < 2 || !p[1]) return null;
      return { emoji: p[0] || "speech_balloon", text: p[1], minutes: parseInt(p[2], 10) || 0 };
    }).filter(Boolean).slice(0, 6);
  }

  function setStatus(pr) {
    var body = { emoji: pr.emoji, text: pr.text };
    if (pr.minutes) {
      body.duration = "date_and_time";
      body.expires_at = new Date(Date.now() + pr.minutes * 60000).toISOString();
    } else {
      body.duration = "today";
      var end = new Date(); end.setHours(23, 59, 59, 0);
      body.expires_at = end.toISOString();
    }
    return api("/users/me/status/custom", "PUT", body).then(function () {
      cache.me = null;
      toast((EMOJI[pr.emoji] || "💬") + " Статус: " + pr.text + (pr.minutes ? " до " + hhmm(new Date(Date.now() + pr.minutes * 60000)) : " до конца дня"));
    }, function (e) { toast("Не получилось поставить статус (" + e.message + ")"); });
  }

  function clearStatus() {
    return api("/users/me/status/custom", "DELETE").then(function () { cache.me = null; toast("Статус сброшен"); },
      function (e) { toast("Не получилось сбросить статус (" + e.message + ")"); });
  }

  // ---------- Мелочи ----------
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var DAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  function hhmm(d) { return d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(text) {
    var t = el("div", "brs-toast", text);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("brs-toast-out"); }, 2600);
    setTimeout(function () { t.remove(); }, 3100);
  }

  // ---------- Баннер ----------
  var hero = null;

  function buildHero() {
    hero = el("div", "brs-hero");
    hero.innerHTML = '<div class="brs-hero-bg"></div><div class="brs-hero-main"><b class="brs-hello"></b><span class="brs-date"></span>' +
      '<div class="brs-digest"></div></div><div class="brs-status"></div><button class="brs-collapse" title="Свернуть баннер">⌃</button>';
    hero.querySelector(".brs-collapse").onclick = function () {
      chrome.storage.sync.set({ heroCollapsed: !settings.heroCollapsed });
    };
    document.body.appendChild(hero);
  }

  function renderHero() {
    var on = settings.hero !== false && document.getElementById("channel_view");
    document.documentElement.classList.toggle("brs-hero-on", !!on && !settings.heroCollapsed);
    document.documentElement.classList.toggle("brs-hero-mini", !!on && !!settings.heroCollapsed);
    if (!on) { if (hero) { hero.remove(); hero = null; } return; }
    if (!hero) buildHero();
    hero.classList.toggle("collapsed", !!settings.heroCollapsed);
    hero.querySelector(".brs-collapse").textContent = settings.heroCollapsed ? "⌄" : "⌃";
    hero.querySelector(".brs-collapse").title = settings.heroCollapsed ? "Развернуть баннер" : "Свернуть баннер";

    me().then(function (u) {
      var name = (settings.greetingName || "").trim() || (u && (u.first_name || u.nickname || u.username)) || "";
      var h = new Date().getHours();
      var hello = (h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер") + (name ? ", " + name : "") + " ✨";
      setText(hero.querySelector(".brs-hello"), hello);
    }).catch(function () { setText(hero.querySelector(".brs-hello"), "Привет ✨"); });
    var now = new Date();
    setText(hero.querySelector(".brs-date"), DAYS[now.getDay()] + ", " + now.getDate() + " " + MONTHS[now.getMonth()]);

    var dg = hero.querySelector(".brs-digest");
    if (settings.digest === false) dg.innerHTML = "";
    else loadDigest().then(function (d) { renderDigest(dg, d); });

    var st = hero.querySelector(".brs-status");
    if (settings.statuses === false) st.innerHTML = "";
    else renderStatuses(st);
  }

  function renderDigest(box, d) {
    if (!d) { box.innerHTML = ""; return; }
    var parts = [];
    parts.push(d.mentions ? d.mentions + " " + plural(d.mentions, "упоминание", "упоминания", "упоминаний") : "Упоминаний нет 🎉");
    if (d.threads) parts.push(d.threads + " " + plural(d.threads, "тред ждёт", "треда ждут", "тредов ждут") + " ответа");
    var html = '<span class="brs-sum">' + esc(parts.join(" · ")) + "</span>";
    if (d.channels.length) {
      html += '<span class="brs-chips">' + d.channels.map(function (c) {
        return '<a class="brs-chip" href="' + esc(c.href) + '">' + (c.dm ? "@" : "#") + " " + esc(c.name) + "<em>" + c.mentions + "</em></a>";
      }).join("") + "</span>";
    }
    if (d.threads) {
      var tn = teamName();
      html += '<a class="brs-chip brs-chip-threads" href="/' + esc(tn) + '/threads">Обсуждения<em>' + d.threads + "</em></a>";
    }
    if (box.getAttribute("data-html") !== html) {
      box.setAttribute("data-html", html);
      box.innerHTML = html;
      // Переходы внутри Band без перезагрузки страницы.
      box.querySelectorAll("a").forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          history.pushState({}, "", a.getAttribute("href"));
          window.dispatchEvent(new PopStateEvent("popstate"));
        };
      });
    }
  }

  function renderStatuses(box) {
    var list = presets();
    var key = JSON.stringify(list);
    if (box.getAttribute("data-key") === key) return;
    box.setAttribute("data-key", key);
    box.innerHTML = "";
    list.forEach(function (pr) {
      var b = el("button", "brs-st");
      b.appendChild(el("span", "", EMOJI[pr.emoji] || "💬"));
      b.appendChild(document.createTextNode(" " + pr.text + (pr.minutes ? " · " + (pr.minutes % 60 ? pr.minutes + " мин" : pr.minutes / 60 + " ч") : "")));
      b.title = "Поставить статус «" + pr.text + "»";
      b.onclick = function () { setStatus(pr); };
      box.appendChild(b);
    });
    var c = el("button", "brs-st brs-st-clear", "✕ Сбросить");
    c.title = "Сбросить свой статус";
    c.onclick = clearStatus;
    box.appendChild(c);
  }

  function setText(e, t) { if (e && e.textContent !== t) e.textContent = t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  // ---------- Заметки ----------
  var note = null, notes = {};

  function noteKey() {
    var p = location.pathname.split("/").filter(Boolean);
    if (p.length < 3 || (p[1] !== "channels" && p[1] !== "messages")) return "";
    return p[0] + "/" + p[1] + "/" + decodeURIComponent(p[2]);
  }

  function buildNote() {
    note = el("div", "brs-note");
    note.innerHTML = '<button class="brs-note-btn"></button><div class="brs-note-panel"><div class="brs-note-head"><b></b><button class="brs-note-close" title="Свернуть">✕</button></div>' +
      '<textarea placeholder="Заметка только для тебя: о канале или человеке, договорённости, ссылки…"></textarea><small>Сохраняется сама · видна только тебе</small></div>';
    var ta = note.querySelector("textarea"), timer = null;
    note.querySelector(".brs-note-btn").onclick = function () { note.classList.add("open"); ta.focus(); };
    note.querySelector(".brs-note-close").onclick = function () { note.classList.remove("open"); };
    ta.oninput = function () {
      clearTimeout(timer);
      var key = note.getAttribute("data-key"), val = ta.value;
      timer = setTimeout(function () {
        if (val.trim()) notes[key] = { text: val, at: Date.now() }; else delete notes[key];
        chrome.storage.local.set({ notes: notes });
        updateNoteBtn();
      }, 400);
    };
    // Клавиши внутри заметки не должны срабатывать как горячие клавиши Band.
    ta.addEventListener("keydown", function (e) { e.stopPropagation(); });
    document.body.appendChild(note);
  }

  function updateNoteBtn() {
    var key = note.getAttribute("data-key"), n = notes[key];
    var btn = note.querySelector(".brs-note-btn");
    btn.textContent = n ? "📝 " + n.text.split("\n")[0].slice(0, 40) + (n.text.length > 40 ? "…" : "") : "📝 Заметка";
    note.classList.toggle("has-note", !!n);
  }

  function renderNote() {
    var key = noteKey();
    var on = settings.notes !== false && key && document.getElementById("channel-header");
    if (!on) { if (note) { note.remove(); note = null; } return; }
    if (!note) buildNote();
    if (note.getAttribute("data-key") !== key) {
      note.setAttribute("data-key", key);
      note.classList.remove("open");
      var p = key.split("/");
      setText(note.querySelector(".brs-note-head b"), (p[1] === "messages" ? "" : "#") + p[2]);
      note.querySelector("textarea").value = notes[key] ? notes[key].text : "";
      updateNoteBtn();
    }
  }

  // ---------- Позиционирование над окном чата ----------
  function place() {
    var cv = document.getElementById("channel_view");
    var H = Math.max(110, Math.min(260, +settings.heroHeight || 170));
    var mini = settings.heroCollapsed;
    document.documentElement.style.setProperty("--brs-hero-h", (mini ? 44 : H) + "px");
    if (hero && cv) {
      var r = cv.getBoundingClientRect();
      hero.style.left = (r.left + 10) + "px";
      hero.style.top = (r.top + 10) + "px";
      hero.style.width = Math.max(0, r.width - 20) + "px";
      hero.style.height = (mini ? 40 : H) + "px";
    }
    var hdr = document.getElementById("channel-header");
    if (note && hdr) {
      var h = hdr.getBoundingClientRect(), c = cv ? cv.getBoundingClientRect() : h;
      note.style.top = (h.bottom + 10) + "px";
      note.style.right = Math.max(8, window.innerWidth - c.right + 18) + "px";
    }
  }

  // ---------- Запуск ----------
  function load() {
    chrome.storage.sync.get(R.DEFAULTS, function (s) {
      chrome.storage.local.get({ images: [], notes: {} }, function (local) {
        settings = s;
        notes = local.notes || {};
        var img = s.heroImage && s.heroImage !== "theme" && s.heroImage !== "none" &&
          (local.images || []).filter(function (i) { return i.id === s.heroImage; })[0];
        var th = R.themeFor(s) || R.THEMES.vice;
        extras.heroImage = img ? img.data : (s.heroImage === "theme" && th.wallpaper ? chrome.runtime.getURL(th.wallpaper) : null);
        applyStyle(th);
        if (note) note.setAttribute("data-key", ""); // перечитать заметку
        tick();
      });
    });
  }

  var featStyle = document.createElement("style");
  featStyle.id = "band-restyle-features";

  function applyStyle(th) {
    var t = th.t || R.THEMES.vice.t, mix = R.mix, rgba = R.rgba;
    var grad = th.gradient || ("linear-gradient(120deg," + (th.accent2 || t.tertiary) + "," + t.primary + ")");
    var heroBg = extras.heroImage ? "url(\"" + extras.heroImage + "\") center " + (+settings.heroPos || 40) + "%/cover no-repeat"
      : (th.header || "linear-gradient(120deg," + t.darker + "," + t.primary + ")");
    var css = [
      "html.brs-hero-on #channel_view,html.brs-hero-mini #channel_view{padding-top:calc(var(--brs-hero-h) + 10px)!important;box-sizing:border-box}",
      ".brs-hero{position:fixed;z-index:20;border-radius:16px;overflow:hidden;color:#fff;display:flex;align-items:flex-end;gap:16px;padding:16px 20px;box-sizing:border-box;" +
        "font-family:\"Band Restyle UI\",\"Open Sans\",sans-serif;box-shadow:0 8px 24px rgba(20,10,40,.18);text-shadow:0 2px 10px rgba(0,0,0,.35)}",
      ".brs-hero-bg{position:absolute;inset:0;z-index:-1;background:linear-gradient(0deg,rgba(0,0,0,.5) 0,rgba(0,0,0,.08) 70%)," + heroBg + "}",
      ".brs-hero-main{flex:1;min-width:0}",
      ".brs-hello{display:block;font:700 28px/1.15 \"Band Restyle Display\",\"Band Restyle UI\",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".brs-date{display:block;margin-top:4px;font-size:14px;opacity:.9}",
      ".brs-digest{margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px}",
      ".brs-sum{font-weight:600;font-size:14px;margin-right:6px}",
      ".brs-chips{display:contents}",
      ".brs-chip,.brs-st{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:10px;border:0;font-family:inherit;font-weight:600;font-size:12.5px;line-height:1.3;color:#fff!important;" +
        "text-decoration:none!important;background:rgba(255,255,255,.2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3);backdrop-filter:blur(10px);cursor:pointer;text-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap}",
      ".brs-chip:hover,.brs-st:hover{background:rgba(255,255,255,.32)}",
      ".brs-chip em{font-style:normal;padding:0 7px;border-radius:8px;background:" + grad + ";text-shadow:none}",
      ".brs-status{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:46%}",
      ".brs-st-clear{background:rgba(0,0,0,.18)}",
      ".brs-collapse{position:absolute;top:8px;right:10px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(255,255,255,.22);color:#fff;cursor:pointer;font-size:14px;line-height:26px;padding:0}",
      ".brs-hero.collapsed{padding:0 48px 0 16px;align-items:center}",
      ".brs-hero.collapsed .brs-date,.brs-hero.collapsed .brs-digest,.brs-hero.collapsed .brs-status{display:none}",
      ".brs-hero.collapsed .brs-hello{font-size:16px}",
      ".brs-hero.collapsed .brs-collapse{top:7px}",
      // Заметка.
      ".brs-note{position:fixed;z-index:21;font-family:\"Band Restyle UI\",\"Open Sans\",sans-serif;max-width:340px}",
      ".brs-note-btn{display:block;margin-left:auto;max-width:300px;padding:6px 12px;border-radius:10px;border:1px solid " + rgba(t.primary, .25) + ";background:rgba(255,255,255,.85);" +
        "color:" + t.dark + ";font-family:inherit;font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgba(20,10,40,.08)}",
      ".brs-note.has-note .brs-note-btn{background:#FFF6C9;border-color:#F2D46B;color:#6B5310}",
      ".brs-note-panel{display:none;width:320px;padding:12px;border-radius:14px;background:#FFF9DC;border:1px solid #F2D46B;box-shadow:0 12px 30px rgba(20,10,40,.18)}",
      ".brs-note.open .brs-note-btn{display:none}.brs-note.open .brs-note-panel{display:block}",
      ".brs-note-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#6B5310}",
      ".brs-note-close{border:0;background:none;cursor:pointer;color:#6B5310;font-size:13px}",
      ".brs-note textarea{width:100%;height:130px;box-sizing:border-box;resize:vertical;border:0;border-radius:8px;padding:8px;background:rgba(255,255,255,.7);font-family:inherit;font-size:13px;line-height:1.45;color:#3D3110;outline:none}",
      ".brs-note small{display:block;margin-top:6px;color:#8C7530;font-size:11px}",
      // Всплывашка.
      ".brs-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:3000;padding:10px 16px;border-radius:12px;background:" + mix(t.darker, "#000000", .3) +
        ";color:#fff;font:600 13px \"Band Restyle UI\",\"Open Sans\",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .4s,transform .4s}",
      ".brs-toast-out{opacity:0;transform:translate(-50%,10px)}"
    ];
    featStyle.textContent = css.join("\n");
  }

  var pending = false;
  function tick() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      if (!document.body) return;
      if (!featStyle.isConnected) document.head.appendChild(featStyle);
      renderHero();
      renderNote();
      place();
    });
  }

  function start() {
    load();
    chrome.storage.onChanged.addListener(function (ch) {
      if (ch.notes && Object.keys(ch).length === 1) return; // свои сохранения заметок
      if (ch.bandStatus && Object.keys(ch).length === 1) return;
      load();
    });
    var lastPath = location.pathname;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var n = muts[i].target;
        if (n.closest && n.closest(".brs-hero, .brs-note, .brs-toast")) continue;
        if (location.pathname !== lastPath) { lastPath = location.pathname; digest.at = 0; }
        tick();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", tick);
    setInterval(function () { digest.at = 0; tick(); }, 2 * 60 * 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
