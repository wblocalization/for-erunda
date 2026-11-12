#!/usr/bin/env node
// Loc Bot: бот локализации для Band (Mattermost) и WB Tracker.
// Ничего не делает сам: менеджер пишет в треде с брифом команду, бот показывает превью задачи
// и создаёт её только после подтверждения. Разбор брифа и работа с Tracker — те же, что в расширении Loc Helper.
// Нужен Node.js 22 или новее. Сторонних пакетов нет.
"use strict";
const fs = require("fs");
const path = require("path");
require("../loc-helper/lib/brief.js");
require("../loc-helper/lib/core.js");
const B = globalThis.LocBrief, LocCore = globalThis.LocCore;

const MARK = "from_loc_bot"; // пометка наших сообщений, чтобы не отвечать самим себе

// ---------- Хранилище в файле ----------
function fileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { /* первый запуск */ }
  return {
    get: async (keys) => {
      if (keys === null) return Object.assign({}, data);
      const out = {};
      [].concat(keys).forEach((k) => { if (k in data) out[k] = data[k]; });
      return out;
    },
    set: async (obj) => {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
      fs.writeFileSync(file + ".tmp", JSON.stringify(data));
      fs.renameSync(file + ".tmp", file);
    }
  };
}

// ---------- Band ----------
function bandClient(cfg, fetchFn) {
  const base = cfg.bandUrl.replace(/\/+$/, "");
  async function api(pathname, method, body) {
    const res = await fetchFn(base + "/api/v4" + pathname, {
      method: method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + cfg.bandToken, Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* не JSON */ }
    if (!res.ok) throw new Error("Band: HTTP " + res.status + (json && json.message ? " — " + json.message : ""));
    return json;
  }
  return {
    base,
    api,
    me: () => api("/users/me"),
    thread: (rootId) => api("/posts/" + rootId + "/thread"),
    post: (id) => api("/posts/" + id),
    users: (ids) => api("/users/ids", "POST", ids),
    userByName: (name) => api("/users/username/" + encodeURIComponent(name)),
    channel: (id) => api("/channels/" + id),
    direct: (a, b) => api("/channels/direct", "POST", [a, b]),
    say: (channelId, rootId, message) => api("/posts", "POST", { channel_id: channelId, root_id: rootId || "", message, props: { [MARK]: true } }),
    react: (userId, postId, emoji) => api("/reactions", "POST", { user_id: userId, post_id: postId, emoji_name: emoji, create_at: 0 })
  };
}

// ---------- Логика бота ----------
function createBot(deps) {
  const { cfg, band, core, log } = deps;
  const prefix = cfg.prefix || "!";
  const managers = (cfg.managers || []).map((m) => m.toLowerCase().replace(/^@/, ""));
  const pending = new Map(); // тред → превью, которое ждёт подтверждения
  const channelNames = new Map();
  let me = null;

  const userName = (u) => {
    if (!u) return "";
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full ? full + " (@" + u.username + ")" : "@" + u.username;
  };
  const ru = (isoDate) => isoDate.split("-").reverse().join(".");
  const linkTo = (id, url) => "[" + id + "](" + url + ")";

  async function start() {
    me = await band.me();
    log("Band: вошёл как @" + me.username);
    if (!managers.length) log("ВНИМАНИЕ: список managers пуст — бот не будет слушать ничьи команды.");
    const st = await core.connect(cfg.trackerToken, cfg.sampleIssue, cfg.trackerLogin);
    log("Tracker: " + st.project.name + " · " + st.ns.name + ", типов задач: " + st.types.length + ", открытых задач: " + st.issues.length);
    return me;
  }

  async function watched(channelId) {
    if (!(cfg.channels || []).length) return true;
    if (!channelNames.has(channelId)) {
      const ch = await band.channel(channelId);
      channelNames.set(channelId, [ch.name, ch.display_name].map((x) => String(x || "").toLowerCase()));
    }
    const names = channelNames.get(channelId);
    return cfg.channels.some((c) => c === channelId || names.indexOf(String(c).toLowerCase()) >= 0);
  }

  async function loadThread(rootId) {
    const t = await band.thread(rootId);
    const posts = Object.values(t.posts)
      .filter((p) => !p.delete_at && !/^system_/.test(p.type || "") && !(p.props && p.props[MARK]) && p.message.trim().indexOf(prefix) !== 0)
      .sort((a, b) => a.create_at - b.create_at);
    if (!posts.length) throw new Error("В треде нет сообщений с брифом.");
    const users = {};
    (await band.users([...new Set(posts.map((p) => p.user_id))]) || []).forEach((u) => { users[u.id] = u; });
    return { rootId, channelId: posts[0].channel_id, posts, users, link: band.base + "/_redirect/pl/" + rootId };
  }

  // Последнее сообщение автора треда, похожее на бриф; иначе первое сообщение.
  function pickBrief(thread) {
    let best = null;
    thread.posts.forEach((p) => {
      const parsed = B.parseBrief(p.message);
      if (parsed.found >= 2 && p.user_id === thread.posts[0].user_id) best = { post: p, parsed };
    });
    return best || { post: thread.posts[0], parsed: B.parseBrief(thread.posts[0].message) };
  }

  function describe(thread, post, parsed) {
    const files = thread.posts.reduce((n, p) => n + (p.file_ids ? p.file_ids.length : 0), 0);
    const out = [B.digest(post.message, parsed), "", "---", "Бриф в Band: " + thread.link, "Заказчик: " + userName(thread.users[post.user_id])];
    if (files) out.push("Вложений в треде: " + files + " (смотрите по ссылке)");
    return out.join("\n");
  }

  function findType(st, wanted) {
    const w = String(wanted || "").trim().toLowerCase();
    return st.types.find((t) => t.name.toLowerCase() === w || t.alias.toLowerCase() === w) || null;
  }

  // Исполнитель — тот, кто дал команду: ищем его в Tracker по логину из Band.
  function trackerPerson(st, bandUser) {
    const login = bandUser.username.toLowerCase();
    return st.people.find((p) => (p.login || "").toLowerCase() === login) || null;
  }

  async function preview(thread, author) {
    const st = await core.status();
    const picked = pickBrief(thread), parsed = picked.parsed;
    const type = findType(st, cfg.defaultType) || st.types[0];
    const defs = (st.typeFields[type.alias] || []).filter((d) => d.type === "choice");
    const choices = B.suggest(parsed, picked.post.message, defs);
    const person = trackerPerson(st, author);
    const draft = {
      name: parsed.title || "Перевод", description: describe(thread, picked.post, parsed), typeAlias: type.alias,
      executorId: person ? person.id : null, deadline: parsed.deadline, start: B.parseDate("сегодня"), end: parsed.deadline,
      choices, languages: parsed.languages
    };
    pending.set(thread.rootId, { draft, author: author.id, at: Date.now() });

    const none = "не указано";
    const lines = ["**Превью задачи в Tracker** (ничего ещё не создано)", "",
      "Название: " + draft.name,
      "Тип: " + type.name,
      "Исполнитель: " + (person ? person.name : "не нашёл @" + author.username + " в Tracker, задача будет без исполнителя"),
      "Языки: " + (parsed.languages.length ? parsed.languages.map((l) => l.name).join(", ") : none),
      "Дедлайн: " + (parsed.deadline ? ru(parsed.deadline) + (parsed.deadlineRaw ? " (в брифе: «" + parsed.deadlineRaw.split("\n")[0] + "»)" : "") : none)];
    defs.forEach((d) => {
      const v = choices[d.id];
      lines.push(d.title + ": " + (v ? v.map((o) => o.label).join(", ") + (d.required ? "" : " (по брифу, проверьте)") : none));
    });
    if (parsed.missing.length) lines.push("", "В брифе не нашлось: " + parsed.missing.join(", ") + ". Это подсказка, создать можно и так.");
    const p = "`" + prefix;
    lines.push("", "Что дальше:",
      "- " + p + "создай` — новая задача",
      "- " + p + "создай подзадачи` — и подзадача на каждый язык (`" + prefix + "создай подзадачи редактура` — отдельно перевод и редактура)",
      "- " + p + "создай в LOCAL-123` — подзадачей в этот тикет",
      "- " + p + "комментарий в LOCAL-123` — комментарием в этот тикет",
      "- можно добавить `тип=Перевод`, `заказчик=WBP Чаты`, `срок=25.12`",
      "- " + p + "отмена`");
    return lines.join("\n");
  }

  // «тип=Перевод заказчик=WBP Чаты срок=25.12» → поправки к превью. Значение идёт до следующего «ключ=».
  function applyOptions(text, draft, st) {
    const notes = [], re = /(тип|заказчик|срок)\s*=\s*([^=]+?)(?=\s+(?:тип|заказчик|срок)\s*=|$)/gi;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1].toLowerCase(), value = m[2].trim();
      if (key === "тип") {
        const t = findType(st, value);
        if (t) draft.typeAlias = t.alias; else notes.push("типа «" + value + "» нет (есть: " + st.types.map((x) => x.name).join(", ") + ")");
      } else if (key === "срок") {
        const d = B.parseDate(value);
        if (d) { draft.deadline = d; draft.end = d; } else notes.push("не понял срок «" + value + "»");
      } else {
        const def = (st.typeFields[draft.typeAlias] || []).find((d) => /заказчик/i.test(d.title));
        const opt = def && def.options.find((o) => o.label.trim().toLowerCase() === value.toLowerCase());
        if (opt) draft.choices[def.id] = [opt]; else notes.push("заказчика «" + value + "» нет в списке Tracker");
      }
    }
    return notes;
  }

  async function create(thread, cmd, rest) {
    const p = pending.get(thread.rootId);
    if (!p) return "Сначала покажу превью: напишите `" + prefix + "задача`.";
    const st = await core.status(), draft = Object.assign({}, p.draft, { choices: Object.assign({}, p.draft.choices) });
    const notes = applyOptions(rest, draft, st);
    if (notes.length) return "Не создаю: " + notes.join("; ") + ".";
    const code = (rest.match(/(?:^|\s)в\s+([A-ZА-Я0-9_]+-\d+)/i) || [])[1];
    const wantSubs = cmd === "создай" && /подзадач/i.test(rest);
    if (cmd === "комментарий" && !code) return "Укажите тикет: `" + prefix + "комментарий в LOCAL-123`.";
    if (wantSubs && !draft.languages.length) return "В брифе нет языков, подзадачи создать не из чего.";

    const res = await core.createFromBrief(Object.assign(draft, {
      mode: cmd === "комментарий" ? "comment" : code ? "sub" : "new", targetCode: code || "",
      languages: wantSubs ? draft.languages : [], withEditing: wantSubs && /редактур/i.test(rest)
    }));
    pending.delete(thread.rootId);
    band.react(me.id, thread.rootId, "white_check_mark").catch(() => {});
    if (res.comment) return "Добавил бриф комментарием в " + linkTo(res.id, res.url) + ".";
    const out = [(res.parent ? "Создал подзадачу " : "Создал задачу ") + linkTo(res.id, res.url) + (res.parent ? " в тикете " + res.parent : "") + "."];
    if (res.subs.length) out.push("Подзадачи: " + res.subs.map((s) => s.lang + " — " + linkTo(s.id, s.url)).join(", "));
    if (res.errors.length) out.push("Не создал: " + res.errors.join("; "));
    if (res.unfilled.length) out.push("Остались пустыми: " + res.unfilled.join(", ") + ".");
    return out.join("\n");
  }

  async function allowed(userId) {
    const u = (await band.users([userId]) || [])[0];
    return u && managers.indexOf(u.username.toLowerCase()) >= 0 ? u : null;
  }

  // Команда в треде: !задача, !создай …, !комментарий в …, !отмена, !помощь
  async function onPost(post) {
    if (!post || (post.props && post.props[MARK])) return;
    const text = (post.message || "").trim();
    if (text.indexOf(prefix) !== 0) return;
    const m = text.slice(prefix.length).match(/^(\S+)\s*([\s\S]*)$/);
    const cmd = m ? m[1].toLowerCase() : "", rest = m ? m[2].trim() : "";
    if (["задача", "создай", "комментарий", "отмена", "помощь"].indexOf(cmd) < 0) return;
    if (!(await watched(post.channel_id))) return;
    const author = await allowed(post.user_id);
    if (!author) return; // команды не от менеджеров молча пропускаем
    const rootId = post.root_id || post.id;
    let reply;
    try {
      if (cmd === "помощь") {
        reply = "Напишите `" + prefix + "задача` в треде с брифом: покажу превью и ничего не создам без подтверждения.";
      } else if (cmd === "отмена") {
        reply = pending.delete(rootId) ? "Отменил, ничего не создано." : "Отменять нечего.";
      } else if (!post.root_id) {
        reply = "Команду нужно писать в треде с брифом, а не отдельным сообщением.";
      } else {
        const thread = await loadThread(rootId);
        reply = cmd === "задача" ? await preview(thread, author) : await create(thread, cmd, rest);
      }
    } catch (e) {
      log("Ошибка: " + e.message);
      reply = "Не получилось: " + e.message;
    }
    await band.say(post.channel_id, rootId, reply);
  }

  // Реакция менеджера на бриф (если в настройках задан reactionTrigger) — то же, что !задача.
  async function onReaction(reaction) {
    if (!cfg.reactionTrigger || !reaction || reaction.emoji_name !== cfg.reactionTrigger) return;
    const author = await allowed(reaction.user_id);
    if (!author) return;
    const post = await band.post(reaction.post_id);
    if (!(await watched(post.channel_id))) return;
    const rootId = post.root_id || post.id;
    let reply;
    try { reply = await preview(await loadThread(rootId), author); } catch (e) { reply = "Не получилось: " + e.message; }
    await band.say(post.channel_id, rootId, reply);
  }

  async function onEvent(evt) {
    try {
      if (evt.event === "posted") await onPost(JSON.parse(evt.data.post));
      else if (evt.event === "reaction_added") await onReaction(JSON.parse(evt.data.reaction));
    } catch (e) {
      log("Ошибка обработки события: " + e.message);
    }
  }

  // Напоминания о дедлайнах личным сообщением исполнителю. Только тем, кто перечислен в reminders.users.
  async function remind() {
    const r = cfg.reminders || {};
    if (!r.enabled) return 0;
    const due = await core.dueReminders(), st = await core.status();
    const users = (r.users || []).map((u) => u.toLowerCase().replace(/^@/, ""));
    let sent = 0;
    for (const d of due) {
      const issue = st.issues.find((i) => i.id === d.id);
      const person = issue && st.people.find((p) => p.id === issue.executorId);
      const login = person && (person.login || "").toLowerCase();
      if (!login || users.indexOf(login) < 0) continue;
      try {
        const u = await band.userByName(login);
        const ch = await band.direct(me.id, u.id);
        await band.say(ch.id, "", "⏰ " + linkTo(d.id, d.url) + " · " + issue.name + "\n" + d.text);
        sent++;
      } catch (e) { log("Не смог напомнить @" + login + ": " + e.message); }
    }
    return sent;
  }

  return { start, onEvent, remind, pending };
}

// ---------- Запуск ----------
function connectSocket(cfg, onEvent, log) {
  let attempt = 0, seq = 1;
  (function open() {
    const ws = new WebSocket(cfg.bandUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/api/v4/websocket");
    let alive = null;
    ws.addEventListener("open", () => {
      attempt = 0;
      ws.send(JSON.stringify({ seq: seq++, action: "authentication_challenge", data: { token: cfg.bandToken } }));
      alive = setInterval(() => { try { ws.send(JSON.stringify({ seq: seq++, action: "ping" })); } catch (e) { /* закроется само */ } }, 30000);
      log("Band: слушаю события");
    });
    ws.addEventListener("message", (m) => {
      let evt;
      try { evt = JSON.parse(m.data); } catch (e) { return; }
      if (evt.event) onEvent(evt);
    });
    ws.addEventListener("close", () => {
      clearInterval(alive);
      const wait = Math.min(60, 2 ** Math.min(attempt++, 6)) * 1000;
      log("Band: соединение закрыто, переподключусь через " + wait / 1000 + " с");
      setTimeout(open, wait);
    });
    ws.addEventListener("error", () => { /* за ошибкой придёт close */ });
  })();
}

async function main() {
  const dir = __dirname, file = path.join(dir, "config.json");
  if (!fs.existsSync(file)) {
    console.error("Нет файла config.json. Скопируйте config.example.json в config.json и заполните его.");
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof WebSocket === "undefined") { console.error("Нужен Node.js 22 или новее (сейчас " + process.version + ")."); process.exit(1); }
  const log = (text) => console.log(new Date().toLocaleTimeString("ru") + " " + text);
  const store = fileStore(path.join(dir, "state.json"));
  const core = LocCore.create({ fetch: (u, i) => fetch(u, i), store, base: cfg.trackerUrl });
  const r = cfg.reminders || {};
  const settings = { scope: "all", remindAll: true, hoursBefore: r.hoursBefore || [24, 3] };
  if (cfg.issueUrl) settings.urlTemplate = cfg.issueUrl;
  await store.set({ settings: Object.assign({}, (await store.get(["settings"])).settings, settings) });
  const bot = createBot({ cfg, band: bandClient(cfg, (u, i) => fetch(u, i)), core, log });
  await bot.start();
  connectSocket(cfg, bot.onEvent, log);
  // Раз в 10 минут обновляем задачи из Tracker (типы, люди, дедлайны) и рассылаем напоминания.
  setInterval(async () => {
    try { await core.sync(); const n = await bot.remind(); if (n) log("Напоминаний отправлено: " + n); } catch (e) { log("Tracker: " + e.message); }
  }, 10 * 60 * 1000);
}

if (require.main === module) main().catch((e) => { console.error("Не запустился: " + e.message); process.exit(1); });
module.exports = { createBot, bandClient, fileStore, connectSocket, MARK };
