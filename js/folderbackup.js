/* 決めたフォルダに自動で控える（2026-11-12 利用者の指示：「公開サーバーに接続できていないときの保険として、
   設定したフォルダにバックアップを取れる機能」）。

   ■ すること
   設定で1度フォルダを選ぶと、この app を開いている間、
     ・書き換えてから 30 秒たったとき（続けて書いている間は待つ）
     ・10 分ごと
     ・画面を裏に回したとき
   に、そのフォルダの bubbles-backup-<日付>.json へ、この端末のすべての海の記録を書く。
   1日1つのファイルで、その日のうちは上書きする。古い日のファイルは消さない（利用者のフォルダのものを app は消さない）。
   中身が前に書いたときと同じなら書かない。
   サーバーに繋いでいるかどうかに関係なく書く（繋がらない間に書いたものを確かに残すため）。

   ■ 中身
   引っ越しのファイル（js/movefile.js の buildPayload）と同じ形で、暗号化はしない。format は 'bubbles-backup'。
   海の記録（doc と印）と海の一覧だけ。**サーバーの住所・合言葉・鍵は入れない**（平文で置くため）。
   戻すときは設定の「控えのファイルから戻す」で、引っ越しと同じく記録ごとに新しいほうを残して重ねる。

   ■ 使えるところ
   File System Access API（showDirectoryPicker）のあるブラウザだけ（Chrome・Edge。Mac の Chrome でインストールした app も）。
   選んだフォルダの handle は IndexedDB に置く（localStorage には入らない形のため）。
   書く許しは、開き直すと聞き直しになることがある。許しは押した手の続きでしか求められないので、
   そのときは設定（とトースト）の「書く許しを出し直す」で求める。許しが無い間は書かない（黙って止まらず、状態に出す）。

   DOM には触らない（設定の画面 js/screens/settings.js が使う。テストは tests/folderbackup.test.mjs）。 */

import { store } from './store.js';
import { seaList, allEntries, boxKey } from './spacelist.js';
import { allSpaceIds } from './regions.js';
import { buildPayload, boxToState, moveSummary } from './movefile.js';
import { deviceLabel } from './csvio.js';

export const FORMAT = 'bubbles-backup';
export const CONF_KEY = 'bubble_todo_folder_backup';
export const AFTER_EDIT_MS = 30 * 1000;
export const EVERY_MS = 10 * 60 * 1000;
const DB_NAME = 'bubble_todo_fs';
const DB_STORE = 'handles';
const DB_KEY = 'backupDir';

/* このブラウザで使えるか */
export function folderBackupSupported(g = globalThis) {
  return typeof g.showDirectoryPicker === 'function';
}

/* 書くファイルの名前。端末の時刻の日付（1日1つ） */
export function backupFileName(now = Date.now()) {
  const d = new Date(now), z = x => String(x).padStart(2, '0');
  return `bubbles-backup-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.json`;
}

/* この端末の海の記録。開いている海は store から、ほかは箱（localStorage）から（settings.js の collectBoxes と同じ） */
export function collectBoxes(st = store, ls = globalThis.localStorage) {
  const boxes = {};
  /* すべての海域の個人と海（js/regions.js）。海域の外れた海も箱があれば入れる */
  const ids = ['me'].concat(allSpaceIds(), seaList().map(e => e.id)).filter((v, i, a) => a.indexOf(v) === i);
  ids.forEach(id => {
    if (id === st.space()) { boxes[id] = st.exportState(); return; }
    let raw = null;
    try { raw = JSON.parse(ls.getItem(boxKey(id)) || 'null'); } catch (e) { raw = null; }
    const s = boxToState(raw);
    if (s) boxes[id] = s;
  });
  return boxes;
}

/* 控えの中身。サーバーの住所・鍵は入れない */
export function buildBackup({ boxes, seas, at = Date.now(), device = '' }) {
  return Object.assign(buildPayload({ boxes, seas, server: null, at, device }), { format: FORMAT });
}

/* 控えのファイルを読む。形が違えば投げる。戻り値は buildBackup の形（mergeIntoDevice にそのまま渡せる） */
export function readBackup(text) {
  let p;
  try { p = JSON.parse(String(text || '')); } catch (e) { throw new Error('控えのファイルではない（JSON として読めない）'); }
  if (!p || typeof p !== 'object' || p.format !== FORMAT) {
    if (p && p.format === 'bubbles-move') throw new Error('これは引っ越しのファイル（暗号化）。「暗号化したファイル」から開く');
    throw new Error('控えのファイルではない（bubbles-backup の形でない）');
  }
  if (!p.boxes || typeof p.boxes !== 'object' || Array.isArray(p.boxes)) throw new Error('控えのファイルが壊れている');
  delete p.server;                       /* 控えには入れていない。入っていても使わない */
  if (!Array.isArray(p.seas)) p.seas = [];
  return p;
}

export function backupSummary(p) { return moveSummary(p); }

/* 中身が同じかを見る目印（時刻 at は除く） */
function sameKey(p) { return JSON.stringify({ boxes: p.boxes, seas: p.seas }); }

/* ---- 設定（localStorage）---- */
export function loadConf(ls = globalThis.localStorage) {
  try {
    const o = JSON.parse(ls.getItem(CONF_KEY) || 'null');
    if (o && typeof o === 'object') {
      return { on: !!o.on, folder: String(o.folder || ''), lastAt: Number(o.lastAt) || 0, lastName: String(o.lastName || '') };
    }
  } catch (e) { /* 読めなければ切ってある */ }
  return { on: false, folder: '', lastAt: 0, lastName: '' };
}
export function saveConf(c, ls = globalThis.localStorage) {
  try { ls.setItem(CONF_KEY, JSON.stringify(c)); } catch (e) { /* 入らなくても書くのは止めない */ }
}

/* ---- フォルダの handle（IndexedDB）---- */
function openDb(idb) {
  return new Promise((resolve, reject) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbDo(idb, mode, fn) {
  return openDb(idb).then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const req = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => { db.close(); resolve(req && req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}
export function idbHandles(idb = globalThis.indexedDB) {
  return {
    load: () => (idb ? idbDo(idb, 'readonly', s => s.get(DB_KEY)).catch(() => null) : Promise.resolve(null)),
    save: (h) => (idb ? idbDo(idb, 'readwrite', s => s.put(h, DB_KEY)) : Promise.reject(new Error('IndexedDB が無い'))),
    clear: () => (idb ? idbDo(idb, 'readwrite', s => s.delete(DB_KEY)).catch(() => null) : Promise.resolve(null)),
  };
}

/* 1つのファイルを書く */
export async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/* 書く係。deps を差し替えてテストする。
   状態 state: 'off'（切ってある）／'no-folder'／'need-permission'／'ok'／'error'（message 付き）／'unsupported' */
export function createFolderBackup(deps = {}) {
  const st = deps.store || store;
  const ls = deps.localStorage || globalThis.localStorage;
  const handles = deps.handles || idbHandles(deps.indexedDB);
  const now = deps.now || (() => Date.now());
  const timers = deps.timers || globalThis;
  const device = deps.device || '';
  const seas = deps.seas || (() => allEntries());
  const supported = 'supported' in deps ? !!deps.supported : folderBackupSupported();

  let conf = loadConf(ls);
  let state = { state: supported ? (conf.on ? 'no-folder' : 'off') : 'unsupported', message: '' };
  let lastKey = '', lastName = '';
  let editTimer = null, everyTimer = null, running = null;
  const listeners = new Set();

  function set(s, message = '') {
    state = { state: s, message };
    listeners.forEach(f => { try { f(state); } catch (e) { /* 聞き手が落ちても続ける */ } });
  }

  /* 今すぐ書く。force なら中身が同じでも書く（「今すぐ控える」）。戻り値 状態 */
  async function runNow(force = false) {
    /* 書いている最中なら、その回を待つ（その後の変更は、次の 30 秒・10 分の回で書く） */
    if (running) return running;
    running = (async () => {
      conf = loadConf(ls);
      if (!supported) { set('unsupported'); return state; }
      if (!conf.on) { set('off'); return state; }
      const dir = await handles.load();
      if (!dir) { set('no-folder'); return state; }
      let perm = 'granted';
      try { if (typeof dir.queryPermission === 'function') perm = await dir.queryPermission({ mode: 'readwrite' }); }
      catch (e) { perm = 'prompt'; }
      if (perm !== 'granted') { set('need-permission'); return state; }
      try { if (typeof st.flush === 'function') st.flush(); } catch (e) { /* 書くのは止めない */ }
      const at = now();
      const p = buildBackup({ boxes: collectBoxes(st, ls), seas: seas(), at, device });
      const key = sameKey(p), name = backupFileName(at);
      if (!force && key === lastKey && name === lastName) { set('ok'); return state; }
      try {
        await writeFile(dir, name, JSON.stringify(p, null, 1) + '\n');
      } catch (e) {
        set('error', (e && e.message) || String(e));
        return state;
      }
      lastKey = key; lastName = name;
      conf = Object.assign(loadConf(ls), { lastAt: at, lastName: name });
      saveConf(conf, ls);
      set('ok');
      return state;
    })();
    try { return await running; }
    finally { running = null; }
  }

  function onEdit() {
    if (!conf.on) return;
    if (editTimer) timers.clearTimeout(editTimer);
    editTimer = timers.setTimeout(() => { editTimer = null; runNow(); }, AFTER_EDIT_MS);
  }

  function start() {
    if (everyTimer) return;
    everyTimer = timers.setInterval(() => runNow(), EVERY_MS);
    if (typeof st.on === 'function') st.on(onEdit);
    runNow();
  }
  function stop() {
    if (everyTimer) timers.clearInterval(everyTimer);
    if (editTimer) timers.clearTimeout(editTimer);
    everyTimer = editTimer = null;
  }

  /* フォルダを決める（設定のボタンの続きで呼ぶ。dir は showDirectoryPicker の戻り値） */
  async function useFolder(dir) {
    await handles.save(dir);
    conf = Object.assign(loadConf(ls), { on: true, folder: String((dir && dir.name) || '') });
    saveConf(conf, ls);
    lastKey = '';
    return runNow(true);
  }
  /* 書く許しを求め直す（ボタンの続きで呼ぶ） */
  async function regrant() {
    const dir = await handles.load();
    if (!dir) { set('no-folder'); return state; }
    let perm = 'granted';
    if (typeof dir.requestPermission === 'function') perm = await dir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { set('need-permission'); return state; }
    return runNow(true);
  }
  /* 止める（フォルダの覚えも捨てる。書いたファイルは消さない） */
  async function turnOff() {
    conf = Object.assign(loadConf(ls), { on: false, folder: '' });
    saveConf(conf, ls);
    await handles.clear();
    lastKey = '';
    set(supported ? 'off' : 'unsupported');
    return state;
  }

  return {
    runNow, start, stop, useFolder, regrant, turnOff, onEdit,
    status: () => Object.assign({}, state, { conf: loadConf(ls) }),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/* 画面で使う1つ。app.js が読み込んだら動き出す（設定で切ってあれば何もしない） */
export const folderBackup = (typeof window !== 'undefined' && !globalThis.__BUBBLES_NO_AUTO_MOUNT__)
  ? createFolderBackup({ device: deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1) })
  : null;
if (folderBackup) {
  folderBackup.start();
  /* 裏に回るとき（閉じる前も含む）にも控える。書き終わる前に止まることはある */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') folderBackup.runNow();
  });
}
