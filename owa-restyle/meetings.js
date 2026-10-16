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

  function request(start, end) {
    return {
      __type: "FindItemJsonRequest:#Exchange",
      Header: {
        __type: "JsonRequestHeaders:#Exchange",
        RequestServerVersion: "Exchange2013",
        TimeZoneContext: {
          __type: "TimeZoneContext:#Exchange",
          TimeZoneDefinition: { __type: "TimeZoneDefinitionType:#Exchange", Id: "Russian Standard Time" }
        }
      },
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

  function parse(json) {
    var msgs = json && json.Body && json.Body.ResponseMessages && json.Body.ResponseMessages.Items;
    var msg = msgs && msgs[0];
    if (!msg) throw new Error("пустой ответ");
    if (msg.ResponseClass && msg.ResponseClass !== "Success") throw new Error(msg.ResponseCode || msg.MessageText || msg.ResponseClass);
    var items = (msg.RootFolder && msg.RootFolder.Items) || [];
    return items.map(function (it) {
      return {
        subject: it.Subject || "(без темы)",
        start: new Date(it.Start),
        end: new Date(it.End),
        location: it.Location && (it.Location.DisplayName || it.Location) || "",
        allDay: !!it.IsAllDayEvent,
        cancelled: !!it.IsCancelled,
        free: it.LegacyFreeBusyStatus === "Free"
      };
    }).filter(function (m) { return !isNaN(m.start) && !m.cancelled; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  function report(status) {
    try { chrome.storage.local.set({ calendarStatus: Object.assign({ at: Date.now() }, status) }); } catch (e) { /* нет доступа к storage */ }
  }

  function load() {
    var now = new Date();
    var day = now.toDateString();
    if (cache.items && cache.day === day && Date.now() - cache.at < TTL) return Promise.resolve(cache.items);
    if (cache.pending) return cache.pending;
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var end = new Date(start.getTime() + 24 * 3600 * 1000);
    cache.pending = fetch("/owa/service.svc?action=FindItem&app=Calendar", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Action": "FindItem",
        "Content-Type": "application/json; charset=utf-8",
        "X-OWA-CANARY": cookie("X-OWA-CANARY"),
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(request(start, end))
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (json) {
      var items = parse(json);
      cache = { day: day, items: items, at: Date.now(), pending: null };
      report({ ok: true, count: items.length });
      return items;
    }).catch(function (e) {
      cache.pending = null;
      cache.at = Date.now();
      cache.day = day;
      cache.items = cache.items || null;
      report({ ok: false, error: String(e && e.message || e) });
      return cache.items;
    });
    return cache.pending;
  }

  root.OWA_RESTYLE_MEETINGS = { load: load };
})(typeof window !== "undefined" ? window : globalThis);
