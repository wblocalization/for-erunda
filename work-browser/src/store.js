'use strict';
// Простое хранилище: один JSON-файл, запись с задержкой и через временный файл.
const fs = require('fs');
const path = require('path');

class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.data = defaults;
    this.timer = null;
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* файла ещё нет */ }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('Не удалось сохранить', this.file, e.message); }
  }
}

const DEFAULTS = () => ({
  settings: { search: 'yandex', theme: 'system', accent: 'lilac', motion: true, sideRatio: 0.36 },
  services: [
    { id: 'mail', name: 'Почта', url: 'https://mail.rwb.ru/' },
    { id: 'band', name: 'Band', url: 'https://band.wb.ru/' },
    { id: 'tracker', name: 'Tracker', url: 'https://tracker.wb.ru/' },
    { id: 'wiki', name: 'Wiki', url: 'https://wiki.wb.ru/' },
    { id: 'smartcat', name: 'Smartcat', url: 'https://smartcat.com/' },
    { id: 'sheets', name: 'Таблицы', url: 'https://docs.google.com/spreadsheets/' },
  ],
  // Что предлагать для выделенного текста: %s заменяется на текст.
  lookups: [
    { name: 'Яндекс Переводчик', url: 'https://translate.yandex.ru/?text=%s' },
    { name: 'Google Переводчик', url: 'https://translate.google.com/?sl=auto&tl=ru&text=%s' },
  ],
  bookmarks: [],
  history: [],
  session: { tabs: [], active: 0 },
  window: { width: 1440, height: 900 },
  extPaths: [],
  extDisabled: [],
});

const SEARCH = {
  yandex: { name: 'Яндекс', url: 'https://yandex.ru/search/?text=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
};

module.exports = { JsonFile, DEFAULTS, SEARCH };
