// Связь с таблицей: веб-приложение Apps Script (ссылка …/exec) + ключ из меню «🌍 Переводы → 🔑 Ключ для расширения».
const API = {
  async settings() {
    const s = await chrome.storage.sync.get({ url: '', token: '', every: 2 });
    return s;
  },
  async list() {
    const s = await API.settings();
    if (!s.url || !s.token) throw new Error('Расширение не подключено к таблице');
    const r = await fetch(s.url + '?action=list&token=' + encodeURIComponent(s.token), { redirect: 'follow' });
    return API.read(r);
  },
  async post(body) {
    const s = await API.settings();
    if (!s.url || !s.token) throw new Error('Расширение не подключено к таблице');
    // text/plain — чтобы Apps Script принял запрос без лишних проверок браузера.
    const r = await fetch(s.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: s.token }, body)) });
    return API.read(r);
  },
  async read(r) {
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(/accounts\.google|ServiceLogin/.test(text) ? 'Веб-приложение просит вход: при развёртывании выберите доступ «Все»' : 'Таблица ответила не данными (HTTP ' + r.status + ')');
    }
    if (data.error) throw new Error(data.error);
    return data;
  },
};
