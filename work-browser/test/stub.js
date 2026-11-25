'use strict';
// Только для проверок: вместо настоящих рабочих сайтов (они доступны лишь из сети компании) отдаёт простые страницы.
const { protocol } = require('electron');
module.exports = function () {
  protocol.handle('https', req => {
    const u = new URL(req.url);
    if (u.pathname === '/favicon.ico') return new Response('', { status: 404 });
    if (u.hostname === 'script.example.test') {
      return new Response(JSON.stringify({ url: 'https://docs.example.test/table', items: [
        { id: 'r1', status: 'Новый', product: 'Маркет', type: 'Пуш', ru: 'Скидки до 50% только сегодня', langs: ['KK', 'UZ'], deadline: '30.11', match: '' },
      ] }), { headers: { 'content-type': 'application/json' } });
    }
    const body = '<!doctype html><html><head><meta charset="utf-8"><title>Заглушка ' + u.hostname + '</title></head><body>'
      + '<h1 id="h">' + u.hostname + u.pathname + '</h1><p>Съешь ещё этих мягких французских булок, да выпей чаю.</p>'
      + '<p><a id="blank" href="https://wiki.wb.ru/other" target="_blank">ссылка в новую вкладку</a></p><input id="inp"></body></html>';
    // Строгая политика содержимого, как на настоящих сайтах: стили расширений должны проходить и через неё.
    return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'self'" } });
  });
};
