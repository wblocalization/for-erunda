// Встречи на сегодня из календаря OWA. Запрос идёт на тот же сервер (mail.rwb.ru) под текущим входом,
// так же как это делает сама OWA. Данные никуда больше не отправляются.
(function (root) {
  "use strict";

  var cache = { day: "", items: null, at: 0, pending: null };
  var TTL = 5 * 60 * 1000;

  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name.replace(/[-.]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localIso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function prop(uri) { return { __type: "PropertyUri:#Exchange", FieldURI: uri }; }

  function header(withTz) {
    var h = { __type: "JsonRequestHeaders:#Exchange", RequestServerVersion: "Exchange2013" };
    if (withTz) h.TimeZoneContext = {
      __type: "TimeZoneContext:#Exchange",
      TimeZoneDefinition: { __type: "TimeZoneDefinitionType:#Exchange", Id: "Russian Standard Time" }
    };
    return h;
  }

  function findItem(start, end, withTz) {
    return {
      __type: "FindItemJsonRequest:#Exchange",
      Header: header(withTz),
      Body: {
        __type: "FindItemRequest:#Exchange",
        ItemShape: {
          __type: "ItemResponseShape:#Exchange",
          BaseShape: "IdOnly",
          AdditionalProperties: [prop("Subject"), prop("Start"), prop("End"), prop("Location"),
            prop("IsAllDayEvent"), prop("IsCancelled"), prop("LegacyFreeBusyStatus")]
        },
        ParentFolderIds: [{ __type: "DistinguishedFolderId:#Exchange", Id: "calendar" }],
        Traversal: "Shallow",
        Paging: { __type: "CalendarView:#Exchange", StartDate: localIso(start), EndDate: localIso(end), MaxEntriesReturned: 60 }
      }
    };
  }

  function calendarView(start, end) {
    return {
      __type: "GetCalendarViewJsonRequest:#Exchange",
      Header: header(true),
      Body: {
        __type: "GetCalendarViewRequest:#Exchange",
        CalendarId: {
          __type: "TargetFolderId:#Exchange",
          BaseFolderId: { __type: "DistinguishedFolderId:#Exchange", Id: "calendar" }
        },
        RangeStart: localIso(start) + ".001",
        RangeEnd: localIso(end) + ".000"
      }
    };
  }

  // Варианты запроса: разные версии OWA принимают данные по-разному.
  var VARIANTS = [
    { id: "finditem-body", action: "FindItem", via: "body", build: function (s, e) { return findItem(s, e, true); } },
    { id: "finditem-header", action: "FindItem", via: "header", build: function (s, e) { return findItem(s, e, true); } },
    { id: "finditem-notz", action: "FindItem", via: "body", build: function (s, e) { return findItem(s, e, false); } },
    { id: "calendarview-body", action: "GetCalendarView", via: "body", build: calendarView },
    { id: "calendarview-header", action: "GetCalendarView", via: "header", build: calendarView }
  ];

  // Ищем в ответе массив элементов с полями Start/End — где бы он ни лежал.
  function findItems(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return null;
    if (Array.isArray(node)) {
      if (node.length && node[0] && typeof node[0] === "object" && "Start" in node[0] && "End" in node[0]) return node;
      for (var i = 0; i < node.length; i++) { var r = findItems(node[i], depth + 1); if (r) return r; }
      return null;
    }
    for (var k in node) { var x = findItems(node[k], depth + 1); if (x) return x; }
    return null;
  }

  function responseError(json) {
    var body = json && json.Body;
    var msg = body && body.ResponseMessages && body.ResponseMessages.Items && body.ResponseMessages.Items[0];
    var cls = (msg && msg.ResponseClass) || (body && body.ResponseClass);
    if (cls && cls !== "Success") return (msg && (msg.ResponseCode || msg.MessageText)) || (body && (body.ResponseCode || body.MessageText)) || cls;
    if (json && (json.ErrorCode || json.Message)) return json.ErrorCode || json.Message;
    return null;
  }

  function parse(json) {
    var err = responseError(json);
    if (err) throw new Error(err);
    var items = findItems(json, 0);
    if (!items) {
      // Успешный ответ без встреч: пустой список.
      var body = json && json.Body;
      if (body) return [];
      throw new Error("непонятный ответ");
    }
    return items.map(function (it) {
      return {
        subject: it.Subject || "(без темы)",
        start: new Date(it.Start),
        end: new Date(it.End),
        location: it.Location && (it.Location.DisplayName || (typeof it.Location === "string" ? it.Location : "")) || "",
        allDay: !!it.IsAllDayEvent,
        cancelled: !!it.IsCancelled,
        free: it.LegacyFreeBusyStatus === "Free" || it.FreeBusyType === "Free"
      };
    }).filter(function (m) { return !isNaN(m.start) && !m.cancelled; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  function report(status) {
    try { chrome.storage.local.set({ calendarStatus: Object.assign({ at: Date.now() }, status) }); } catch (e) { /* нет доступа к storage */ }
  }

  function send(v, start, end) {
    var payload = JSON.stringify(v.build(start, end));
    var headers = {
      "Action": v.action,
      "X-OWA-ActionName": v.action,
      "X-OWA-CANARY": cookie("X-OWA-CANARY"),
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/json; charset=utf-8"
    };
    if (v.via === "header") headers["X-OWA-UrlPostData"] = encodeURIComponent(payload);
    return fetch("/owa/service.svc?action=" + v.action + "&app=Calendar", {
      method: "POST",
      credentials: "same-origin",
      headers: headers,
      body: v.via === "body" ? payload : ""
    }).then(function (r) {
      return r.text().then(function (text) {
        if (!r.ok) throw new Error("HTTP " + r.status + (text ? ": " + text.replace(/\s+/g, " ").slice(0, 120) : ""));
        var json;
        try { json = JSON.parse(text); } catch (e) { throw new Error("не JSON: " + text.replace(/\s+/g, " ").slice(0, 80)); }
        return parse(json);
      });
    });
  }

  var working = null; // id варианта, который сработал

  function tryVariants(start, end) {
    var order = VARIANTS.slice();
    if (working) order.sort(function (a, b) { return (b.id === working) - (a.id === working); });
    var errors = [];
    function next(i) {
      if (i >= order.length) {
        var e = new Error(errors.join(" | "));
        e.details = errors;
        return Promise.reject(e);
      }
      return send(order[i], start, end).then(function (items) {
        working = order[i].id;
        try { chrome.storage.local.set({ calendarVariant: working }); } catch (e) { /* ignore */ }
        return { items: items, variant: order[i].id };
      }, function (e) {
        errors.push(order[i].id + ": " + (e && e.message || e));
        return next(i + 1);
      });
    }
    return next(0);
  }

  try { chrome.storage.local.get({ calendarVariant: null }, function (r) { working = r.calendarVariant; }); } catch (e) { /* ignore */ }

  function load() {
    var now = new Date();
    var day = now.toDateString();
    if (cache.day === day && Date.now() - cache.at < TTL) return Promise.resolve(cache.items);
    if (cache.pending) return cache.pending;
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(start.getTime() + 24 * 3600 * 1000);
    cache.pending = tryVariants(start, end).then(function (res) {
      cache = { day: day, items: res.items, at: Date.now(), pending: null };
      report({ ok: true, count: res.items.length, variant: res.variant });
      return res.items;
    }, function (e) {
      cache = { day: day, items: cache.items || null, at: Date.now(), pending: null };
      report({ ok: false, error: e.details ? e.details.join("\n") : String(e && e.message || e) });
      return cache.items;
    });
    return cache.pending;
  }

  root.OWA_RESTYLE_MEETINGS = { load: load };
})(typeof window !== "undefined" ? window : globalThis);
