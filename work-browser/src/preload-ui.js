'use strict';
// Мост между интерфейсом браузера (панели, вкладки, адресная строка) и основным процессом.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lokal', {
  send: (cmd, ...args) => ipcRenderer.invoke('ui', cmd, ...args),
  on: handler => { ipcRenderer.on('ui:event', (e, name, payload) => handler(name, payload)); },
});
