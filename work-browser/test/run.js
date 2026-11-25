'use strict';
// Прогон браузера в виртуальном экране: xvfb-run -a npx electron test/run.js --no-sandbox --no-proxy-server
const path = require('path'), fs = require('fs'), os = require('os');
const { execSync } = require('child_process');
const { app, BrowserWindow, webContents } = require('electron');

const shots = process.env.SHOTS || path.join(os.tmpdir(), 'lokal-shots');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-profile-'));
process.env.LOKAL_USER_DATA = profile;
process.env.LOKAL_TEST_STUB = path.join(__dirname, 'stub.js');
process.env.LOKAL_EXT_DIR = path.join(__dirname, '..', '..');
process.env.LOKAL_EXT_ALL = '1';   // в проверках участвуют все расширения из репозитория, не только встроенные в сборку
require('../src/main.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(name, ok, extra) { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; }
function shot(name) {
  try { execSync('import -window root ' + JSON.stringify(path.join(shots, name + '.png')), { stdio: 'ignore' }); } catch (e) { console.log('нет снимка', name); }
}
const page = re => webContents.getAllWebContents().find(w => re.test(w.getURL()));

app.whenReady().then(async () => {
  fs.mkdirSync(shots, { recursive: true });
  await sleep(2500);
  const uiWc = page(/ui\/index\.html/);
  uiWc.on('console-message', e => console.log('[ui]', e.message));
  const ui = code => uiWc.executeJavaScript(code, true);
  const state = () => ui('JSON.parse(JSON.stringify(S))');
  const send = (...a) => ui('window.lokal.send(...' + JSON.stringify(a) + ')');

  let s = await state();
  check('стартовая вкладка', s.tabs.length === 1 && s.tabs[0].start);
  check('сервисы по умолчанию', s.services.length === 6);
  check('расширения найдены', s.extensions.length >= 6, s.extensions.map(x => x.id).join(','));
  shot('01-start');

  await send('navigate', 'wiki.wb.ru/page');
  await sleep(1500);
  s = await state();
  check('адрес открылся', s.tabs[0].url === 'https://wiki.wb.ru/page' && /Заглушка/.test(s.tabs[0].title), s.tabs[0].url + ' | ' + s.tabs[0].title);
  shot('02-page');

  await send('openService', 'mail');
  await sleep(2500);
  s = await state();
  const mail = s.tabs.find(t => t.serviceId === 'mail');
  check('сервис открыт и активен', mail && s.activeId === mail.id);
  const owa = await page(/mail\.rwb\.ru/).executeJavaScript('({ applied: [...document.querySelectorAll("style")].filter(x => x.sheet && x.sheet.cssRules.length).length, bg: getComputedStyle(document.body).backgroundImage.slice(0, 60), styles: document.querySelectorAll("style").length, cls: document.documentElement.className, attrs: document.documentElement.getAttributeNames().join(","), chrome: typeof window.chrome === "object" && !!window.chrome.storage })');
  check('контент-скрипт OWA Restyle изменил страницу', owa.styles > 0 || !!owa.cls || /data-|style/.test(owa.attrs), JSON.stringify(owa));
  check('chrome.storage не виден самому сайту', owa.chrome === false);
  check('стили расширения применились несмотря на политику сайта', owa.applied > 0, 'applied=' + owa.applied);
  shot('03-mail-restyled');

  await send('openExt', 'loc-requests-extension');
  await sleep(2000);
  s = await state();
  const extTab = s.tabs.find(t => t.kind === 'ext');
  check('панель расширения открыта рядом', extTab && s.sideId === extTab.id, extTab && extTab.url);
  const panel = await page(/locext:\/\/loc-requests-extension\/panel\.html/).executeJavaScript('(async () => { await chrome.storage.sync.set({ url: "https://script.example.test/exec", token: "t", every: 2 }); await new Promise(r => setTimeout(r, 1200)); const r = await chrome.runtime.sendMessage("poll"); const st = await chrome.storage.local.get({ data: null }); return { poll: r, items: st.data && st.data.items.length }; })()');
  check('панель → фон → запрос к таблице → хранилище', panel.poll === true && panel.items === 1, JSON.stringify(panel));
  await sleep(800);
  s = await state();
  const lx = s.extensions.find(x => x.id === 'loc-requests-extension');
  check('значок расширения показывает число новых', lx.badge === '1', 'badge=' + lx.badge + ' title=' + lx.title);
  shot('04-side-panel');

  // Расширения с вкладками, скриптами на странице и невидимой страницей («Задачи и сметы», Weblate).
  check('новые расширения найдены', ['smeta-extension', 'weblate-extension'].every(id => s.extensions.some(x => x.id === id)));
  await send('openExt', 'smeta-extension');
  await sleep(2500);
  s = await state();
  const sm = s.tabs.find(t => t.kind === 'ext' && t.extId === 'smeta-extension');
  check('панель «Задачи и сметы» открыта рядом', sm && s.sideId === sm.id);
  shot('04b-smeta');
  const smeta = await page(/locext:\/\/smeta-extension\/sidepanel\.html/).executeJavaScript(`(async () => {
    const out = {};
    const tabs = await chrome.tabs.query({ url: 'https://mail.rwb.ru/*' });
    out.found = tabs.length; out.status = tabs[0] && tabs[0].status;
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'MAIN', func: async (a, b) => document.title + a + b.n, args: ['!', { n: 7 }] });
    out.result = r.result;
    try { await chrome.scripting.executeScript({ target: { tabId: (await chrome.tabs.query({ url: 'https://wiki.wb.ru/*' }))[0].id }, func: () => 1 }); out.denied = false; } catch (e) { out.denied = true; }
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'проверка' });
    out.offscreen = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length;
    const created = await chrome.tabs.create({ url: 'https://disk.wb.ru/apps/files/', active: false });
    out.created = created.id > 0 && created.active === false;
    await new Promise(res => { const f = (id, info) => { if (id === created.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); res(); } }; chrome.tabs.onUpdated.addListener(f); setTimeout(res, 8000); });
    out.loaded = (await chrome.tabs.get(created.id)).status;
    await chrome.tabs.remove(created.id);
    out.errors = window.__errs || 0;
    return out;
  })()`);
  check('chrome.tabs.query видит сервис «Почта»', smeta.found === 1 && smeta.status === 'complete', JSON.stringify(smeta));
  check('chrome.scripting.executeScript выполнил функцию на странице', smeta.result === 'Заглушка mail.rwb.ru!7', String(smeta.result));
  check('скрипт не пускают на сайт вне host_permissions', smeta.denied === true);
  check('невидимая страница (offscreen) создана', smeta.offscreen === 1);
  check('вкладка создана в фоне, загрузилась и закрылась', smeta.created && smeta.loaded === 'complete', smeta.loaded);

  await send('newTab', 'https://weblate.wb.ru/projects/');
  await sleep(1800);
  const wl = page(/weblate\.wb\.ru/);
  const count = () => wl.executeJavaScript('document.querySelectorAll("*").length');
  const n0 = await count();
  await send('openExt', 'weblate-extension');
  await sleep(2500);
  const n1 = await count();
  check('клик по значку Weblate встроил его окно в страницу', n1 > n0, n0 + ' → ' + n1);
  shot('04c-weblate');
  s = await state();
  await send('closeTab', s.tabs.find(t => /weblate\.wb\.ru/.test(t.url)).id);
  await sleep(400);

  await send('extOptions', 'owa-restyle');
  await sleep(1800);
  s = await state();
  check('настройки расширения во вкладке', s.tabs.some(t => /locext:\/\/owa-restyle\/settings\.html/.test(t.url) && t.id === s.activeId));
  shot('05-ext-options');

  await send('newTab', 'https://band.wb.ru/');
  await sleep(1800);
  const before = (await state()).tabs.length;
  await page(/band\.wb\.ru/).executeJavaScript('document.getElementById("blank").click()', true);
  await sleep(1800);
  s = await state();
  check('ссылка в новом окне стала вкладкой', s.tabs.length === before + 1 && s.tabs.some(t => t.url === 'https://wiki.wb.ru/other'), s.tabs.map(t => t.url).join(' '));

  await send('activate', s.tabs.find(t => /band\.wb\.ru/.test(t.url)).id);
  await sleep(500);
  await ui('openPalette(); 1');
  await sleep(900);
  await ui('(() => { const i = document.querySelector(".pal-input"); i.value = "trac"; i.dispatchEvent(new Event("input")); })()');
  await sleep(500);
  const first = await ui('document.querySelector(".pal-list .row .t").textContent');
  check('быстрый переход находит сервис', first === 'Tracker', first);
  shot('06-palette');
  await ui('document.querySelector(".pal-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); 1');
  await sleep(1800);
  s = await state();
  check('переход открыл сервис', (s.tabs.find(t => t.id === s.activeId) || {}).serviceId === 'tracker');
  shot('06b-tracker');

  await ui('openSettings("extensions"); 1');
  await sleep(900);
  shot('07-settings');
  check('в настройках видны расширения', await ui('document.querySelectorAll(".ext-card").length') >= 4);
  await ui('closeOverlay(); 1');
  await sleep(300);

  await send('saveSettings', { theme: 'dark' });
  await send('activate', (await state()).tabs.find(t => t.kind === 'tab' && /wiki\.wb\.ru\/page/.test(t.url)).id);
  await sleep(1000);
  shot('08-dark');

  await send('toggleBookmark');
  await sleep(300);
  s = await state();
  check('закладка добавлена', s.bookmarks.length === 1);
  const n = s.tabs.filter(t => t.kind === 'tab').length;
  await send('closeTab', s.activeId);
  await sleep(600);
  s = await state();
  check('вкладка закрылась, активна другая', s.tabs.filter(t => t.kind === 'tab').length === n - 1 && s.tabs.some(t => t.id === s.activeId));

  app.once('will-quit', () => {
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
    check('сессия сохранена на диск', saved.session.tabs.length >= 1 && saved.bookmarks.length === 1, saved.session.tabs.map(t => t.url).join(' '));
    check('хранилище расширения сохранено', fs.existsSync(path.join(profile, 'ext-storage', 'loc-requests-extension.json')));
    console.log(failed ? '\nПровалено проверок: ' + failed : '\nВсе проверки прошли');
    process.exitCode = failed ? 1 : 0;
  });
  app.quit();
}).catch(e => { console.error(e); app.exit(2); });
