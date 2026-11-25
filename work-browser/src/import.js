'use strict';
// Перенос из Chrome и других браузеров на Chromium (Edge, Яндекс): закладки, история и куки.
// Пароли сюда не берём. Чтение — только файлов браузера; куки расшифровываются ключом Windows (DPAPI).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EPOCH = 11644473600000;                       // между 1601-01-01 и 1970-01-01, мс
const chromeTime = v => v ? Math.round(Number(v) / 1000 - EPOCH) : 0;   // микросекунды с 1601 → мс с 1970

// Где браузеры держат профили (User Data). Берём первый существующий путь.
function browsers() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const win = [
    ['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
    ['Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
    ['Яндекс Браузер', path.join(local, 'Yandex', 'YandexBrowser', 'User Data')],
    ['Chromium', path.join(local, 'Chromium', 'User Data')],
    ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
  ];
  const mac = [
    ['Google Chrome', path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
    ['Microsoft Edge', path.join(home, 'Library', 'Application Support', 'Microsoft Edge')],
    ['Яндекс Браузер', path.join(home, 'Library', 'Application Support', 'Yandex', 'YandexBrowser')],
  ];
  const linux = [
    ['Google Chrome', path.join(home, '.config', 'google-chrome')],
    ['Chromium', path.join(home, '.config', 'chromium')],
    ['Microsoft Edge', path.join(home, '.config', 'microsoft-edge')],
    ['Яндекс Браузер', path.join(home, '.config', 'yandex-browser')],
  ];
  let list = process.platform === 'darwin' ? mac : process.platform === 'win32' ? win : linux;
  if (process.env.LOKAL_IMPORT_ROOT) list = [['Тест', process.env.LOKAL_IMPORT_ROOT]];
  return list.filter(([, dir]) => { try { return fs.existsSync(path.join(dir, 'Local State')) || fs.existsSync(path.join(dir, 'Default')); } catch (e) { return false; } })
    .map(([name, dir]) => ({ name, dir }));
}

// Профили внутри User Data: папки, где есть закладки или куки.
function profiles(dir) {
  const out = [];
  let names = {};
  try { names = (JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8')).profile || {}).info_cache || {}; } catch (e) { /* не всегда есть */ }
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (e) { return out; }
  entries.filter(n => n === 'Default' || /^Profile \d+$/.test(n)).forEach(n => {
    if (fs.existsSync(path.join(dir, n, 'Bookmarks')) || fs.existsSync(path.join(dir, n, 'Cookies')) || fs.existsSync(path.join(dir, n, 'Network', 'Cookies')) || fs.existsSync(path.join(dir, n, 'History'))) {
      out.push({ id: n, dir: path.join(dir, n), name: (names[n] && names[n].name) || n });
    }
  });
  return out;
}

// Заблокированный браузером файл базы нельзя открыть напрямую — копируем во временный.
function openDb(file) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = path.join(os.tmpdir(), 'lokal-imp-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.db');
  fs.copyFileSync(file, tmp);
  for (const suf of ['-wal', '-shm']) { try { if (fs.existsSync(file + suf)) fs.copyFileSync(file + suf, tmp + suf); } catch (e) { /* ignore */ } }
  const db = new DatabaseSync(tmp, { readOnly: true });
  db._tmp = tmp;
  return db;
}
function closeDb(db) {
  try { db.close(); } catch (e) { /* ignore */ }
  for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(db._tmp + suf); } catch (e) { /* ignore */ } }
}

function readBookmarks(profile) {
  const out = [];
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(profile.dir, 'Bookmarks'), 'utf8')); } catch (e) { return out; }
  const walk = node => {
    if (!node) return;
    if (node.type === 'url' && /^https?:/.test(node.url)) out.push({ url: node.url, title: node.name || node.url, t: chromeTime(node.date_added) || Date.now() });
    (node.children || []).forEach(walk);
  };
  Object.values(data.roots || {}).forEach(walk);
  return out;
}

function readHistory(profile, limit) {
  const file = path.join(profile.dir, 'History');
  if (!fs.existsSync(file)) return [];
  let db;
  try {
    db = openDb(file);
    const st = db.prepare("SELECT url, title, last_visit_time FROM urls WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ?");
    st.setReadBigInts(true);   // метки времени не помещаются в обычное число
    return st.all(limit || 3000).map(r => ({ url: r.url, title: r.title || '', t: chromeTime(r.last_visit_time) }));
  } catch (e) { throw tagLock(e); }
  finally { if (db) closeDb(db); }
}

// Ключ, которым Chrome шифрует куки: лежит в Local State, зашифрован DPAPI (только Windows).
function cookieKey(userDataDir) {
  if (process.env.LOKAL_IMPORT_KEY) return Buffer.from(process.env.LOKAL_IMPORT_KEY, 'base64');   // для проверок вместо DPAPI
  let blob;
  try { blob = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8')).os_crypt.encrypted_key; } catch (e) { return null; }
  if (!blob) return null;
  const buf = Buffer.from(blob, 'base64');
  if (buf.slice(0, 5).toString() !== 'DPAPI') return null;
  if (process.platform !== 'win32') return null;       // расшифровать ключ можно только на том же Windows
  return dpapiUnprotect(buf.slice(5));
}

// Снятие защиты DPAPI через PowerShell — без сторонних модулей. Вход/выход — base64.
function dpapiUnprotect(buf) {
  const ps = 'Add-Type -AssemblyName System.Security;' +
    '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:LOKAL_DP),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { env: Object.assign({}, process.env, { LOKAL_DP: buf.toString('base64') }), timeout: 20000, windowsHide: true });
  return Buffer.from(String(out).trim(), 'base64');
}

// Расшифровка значения куки: v10/v11 — AES-256-GCM ключом из Local State.
function decryptValue(enc, key) {
  if (!enc || !enc.length) return '';
  const tag = enc.slice(0, 3).toString();
  if (tag === 'v10' || tag === 'v11') {
    if (!key) return null;
    const nonce = enc.slice(3, 15), body = enc.slice(15, enc.length - 16), gcmTag = enc.slice(enc.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(gcmTag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  }
  if (tag === 'v20') return null;       // новое шифрование Chrome, привязано к самому браузеру — не переносим
  if (process.platform === 'win32') { try { return dpapiUnprotect(enc).toString('utf8'); } catch (e) { return null; } }
  return null;
}

const SAMESITE = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };

// Куки: читаем базу, расшифровываем значения, отдаём готовыми к session.cookies.set.
function readCookies(profile, userDataDir, counter) {
  const file = fs.existsSync(path.join(profile.dir, 'Network', 'Cookies')) ? path.join(profile.dir, 'Network', 'Cookies') : path.join(profile.dir, 'Cookies');
  if (!fs.existsSync(file)) return [];
  const key = cookieKey(userDataDir);
  if (!key && process.platform === 'win32') counter.noKey = true;
  let db;
  try {
    db = openDb(file);
    const st = db.prepare('SELECT host_key, name, encrypted_value, value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies');
    st.setReadBigInts(true);   // срок жизни куки не помещается в обычное число
    const rows = st.all();
    const out = [];
    for (const r of rows) {
      let val = r.value;
      if ((!val || !val.length) && r.encrypted_value && r.encrypted_value.length) {
        val = decryptValue(Buffer.from(r.encrypted_value), key);
        if (val == null) { counter.skipped = (counter.skipped || 0) + 1; continue; }
      }
      const host = String(r.host_key || '');
      if (!host || val == null) continue;
      const secure = !!r.is_secure;
      const url = (secure ? 'https://' : 'http://') + (host[0] === '.' ? host.slice(1) : host) + (r.path || '/');
      const c = { url, name: r.name, value: val, path: r.path || '/', secure, httpOnly: !!r.is_httponly, sameSite: SAMESITE[r.samesite] || 'unspecified' };
      if (host[0] === '.') c.domain = host;
      if (r.expires_utc && Number(r.expires_utc) > 0) {
        const exp = chromeTime(r.expires_utc) / 1000;
        if (exp > Date.now() / 1000) c.expirationDate = exp; else continue;    // просроченные пропускаем
      }
      out.push(c);
    }
    return out;
  } catch (e) { throw tagLock(e); }
  finally { if (db) closeDb(db); }
}

function tagLock(e) {
  const m = String(e && e.message || e);
  if (/lock|busy|EBUSY|EPERM|being used|занят/i.test(m)) { const err = new Error('locked'); err.locked = true; return err; }
  return e;
}

// Что вообще можно перенести: список браузеров и профилей для окна выбора.
function scan() {
  return browsers().map(b => ({ name: b.name, dir: b.dir, profiles: profiles(b.dir).map(p => ({ id: p.id, name: p.name })) }))
    .filter(b => b.profiles.length);
}

// Перенос одного профиля. want — какие части брать. Возвращает счётчики и настоящие данные.
function collect(browserDir, profileId, want) {
  const prof = profiles(browserDir).find(p => p.id === profileId);
  if (!prof) throw new Error('Профиль не найден');
  const res = { bookmarks: [], history: [], cookies: [], counts: {}, locked: false, noKey: false, skipped: 0 };
  if (want.bookmarks) { res.bookmarks = readBookmarks(prof); res.counts.bookmarks = res.bookmarks.length; }
  if (want.history) { try { res.history = readHistory(prof); res.counts.history = res.history.length; } catch (e) { if (e.locked) res.locked = true; else throw e; } }
  if (want.cookies) {
    const counter = {};
    try { res.cookies = readCookies(prof, browserDir, counter); res.counts.cookies = res.cookies.length; res.noKey = !!counter.noKey; res.skipped = counter.skipped || 0; }
    catch (e) { if (e.locked) res.locked = true; else throw e; }
  }
  return res;
}

module.exports = { scan, collect };
