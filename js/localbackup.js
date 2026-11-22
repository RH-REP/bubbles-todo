/* この端末の中に自動でバックアップを残す（2026-11-21 Issue #83「ローカルへの自動バックアップ追加」。既定は切ってある）。

   ■ ねらい
   app の更新・サーバーの更新などで記録が消えたとき、この端末に残した前の記録から戻せるようにする。
   フォルダへの自動の書き出し（js/folderbackup.js）は Chrome・Edge だけなので、どのブラウザ（iPhone の Safari・Android の app も）でも使える置き場として、
   このブラウザの IndexedDB に置く。ファイルもフォルダも選ばなくてよい。

   ■ いつ残すか（仕様。Issue #83 の「1日1回か起動時か、上書きか都度か、最新と前回か」への答え）
     ・app を開いたとき（サーバーと合わせる前の、この端末の記録を残すため）
     ・開いたままのときは 1 日 1 回（30 分ごとに見て、最後に残した日と今日が違えば残す）
     ・設定の［今すぐ残す］を押したとき
   **前に残したものと中身が同じなら残さない。上書きはしない**（いつも新しく1つ足す）。
   新しいほうから KEEP（7）個を残し、それより古いものは消す。
   上書きしないのは、記録が消えた状態で app を開いたとき、消える前のバックアップを消えた中身で上書きしないため。
   中身が変わらない限り数は増えないので、消えたまま何度開いても、前のものは押し出されない。

   ■ 中身
   フォルダへの書き出しと同じ（js/folderbackup.js の buildBackup。format は 'bubbles-backup'）。
   すべての海の記録（doc と印）・海の一覧・海域の一覧（名前と住所）。**合言葉・鍵は入れない**。暗号化はしない
   （記録そのものも同じブラウザの中に平文で置いてあるので、包んでも守れるものが無いため）。

   ■ 守れないこと
   ブラウザの「サイトのデータを消す」・すべて初期化・ブラウザが置き場を消したとき（iPhone の Safari は、ホーム画面に置いていないサイトの
   データを、7 日開かないと消すことがある）は、記録と一緒にこのバックアップも消える。それに備えるにはファイル・フォルダ・サーバーに書き出す。
   始めるときに navigator.storage.persist()（ブラウザに「消さないで」と頼む）を呼ぶ。

   DOM には触らない（設定の画面 js/screens/settings.js が使う。テストは tests/localbackup.test.mjs）。 */

import { store } from './store.js';
import { allEntries } from './spacelist.js';
import { regionList, regionsPayload } from './regions.js';
import { collectBoxes, buildBackup, readBackup, backupSummary, folderBackup } from './folderbackup.js';
import { deviceLabel } from './device.js';

export const CONF_KEY = 'bubble_todo_local_backup';
export const KEEP = 7;
export const CHECK_MS = 30 * 60 * 1000;
const DB_NAME = 'bubble_todo_local_backup';
const DB_STORE = 'snaps';

/* 端末の日付（YYYY-MM-DD） */
export function dayOf(ms) {
  const d = new Date(ms), z = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/* 中身が同じかを見る目印（時刻 at・端末は除く） */
function sameKey(p) { return JSON.stringify({ boxes: p.boxes, seas: p.seas, regions: p.regions || [] }); }

/* ---- 設定（localStorage。頭が bubble_todo なので「すべて初期化」で消える）---- */
export function loadConf(ls = globalThis.localStorage) {
  try {
    const o = JSON.parse(ls.getItem(CONF_KEY) || 'null');
    if (o && typeof o === 'object') return { on: !!o.on, lastAt: Number(o.lastAt) || 0 };
  } catch (e) { /* 読めなければ切ってある */ }
  return { on: false, lastAt: 0 };
}
export function saveConf(c, ls = globalThis.localStorage) {
  try { ls.setItem(CONF_KEY, JSON.stringify(c)); } catch (e) { /* 入らなくても残すのは止めない */ }
}

/* ---- 残したもの（IndexedDB）。1つ = { id, at, device, todos, seas, text } ---- */
function openDb(idb) {
  return new Promise((resolve, reject) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE, { keyPath: 'id' });
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
    tx.onabort = () => { db.close(); reject(tx.error || new Error('書けなかった')); };
  }));
}
export function idbSnaps(idb = globalThis.indexedDB) {
  const none = () => Promise.reject(new Error('このブラウザでは端末の中に残せない（IndexedDB が無い）'));
  return {
    list: () => (idb ? idbDo(idb, 'readonly', s => s.getAll()).then(a => a || []) : none()),
    put: (snap) => (idb ? idbDo(idb, 'readwrite', s => s.put(snap)) : none()),
    remove: (id) => (idb ? idbDo(idb, 'readwrite', s => s.delete(id)) : none()),
    clear: () => (idb ? idbDo(idb, 'readwrite', s => s.clear()) : Promise.resolve()),
  };
}
export function localBackupSupported(g = globalThis) { return !!g.indexedDB; }

/* 新しい順に並べる */
function newestFirst(a) { return a.slice().sort((x, y) => (y.at - x.at) || String(y.id).localeCompare(String(x.id))); }

/* 残す係。deps を差し替えてテストする。
   状態 state: 'off'／'ok'／'error'（message 付き）／'unsupported' */
export function createLocalBackup(deps = {}) {
  const st = deps.store || store;
  const ls = deps.localStorage || globalThis.localStorage;
  const snaps = deps.snaps || idbSnaps(deps.indexedDB);
  const now = deps.now || (() => Date.now());
  const timers = deps.timers || globalThis;
  const device = deps.device || '';
  const seas = deps.seas || (() => allEntries());
  const regions = deps.regions || (() => regionsPayload(regionList().map(r => r.id)));
  const supported = 'supported' in deps ? !!deps.supported : localBackupSupported();
  const keep = deps.keep || KEEP;
  /* 新しく1つ残したあとに呼ぶ（フォルダにも同時に書き出す。Issue #83 の返事。待たない・落ちても残したものはそのまま） */
  const after = typeof deps.after === 'function' ? deps.after : null;

  let state = { state: supported ? (loadConf(ls).on ? 'ok' : 'off') : 'unsupported', message: '' };
  let checkTimer = null, running = null;
  const listeners = new Set();

  function set(s, message = '') {
    state = { state: s, message };
    listeners.forEach(f => { try { f(state); } catch (e) { /* 聞き手が落ちても続ける */ } });
  }

  /* 残したものの一覧（新しい順） */
  async function list() {
    if (!supported) return [];
    try { return newestFirst(await snaps.list()); } catch (e) { return []; }
  }

  /* 今すぐ残す。force なら切ってあっても・中身が同じでも残す（［今すぐ残す］）。戻り値 { state, saved } */
  async function runNow(force = false) {
    if (running) return running;
    running = (async () => {
      const conf = loadConf(ls);
      if (!supported) { set('unsupported'); return { state: 'unsupported', saved: false }; }
      if (!conf.on && !force) { set('off'); return { state: 'off', saved: false }; }
      try { if (typeof st.flush === 'function') st.flush(); } catch (e) { /* 残すのは止めない */ }
      const at = now();
      const p = buildBackup({ boxes: collectBoxes(st, ls), seas: seas(), at, device, regions: regions() });
      try {
        const all = newestFirst(await snaps.list());
        const last = all[0];
        if (!force && last && sameKey(readBackup(last.text)) === sameKey(p)) {
          saveConf(Object.assign(loadConf(ls), { lastAt: at }), ls);   /* 見たことは覚える（1日1回の数え） */
          set('ok');
          return { state: 'ok', saved: false };
        }
        const sum = backupSummary(p);
        const id = 'b' + at + '-' + Math.random().toString(36).slice(2, 6);
        await snaps.put({ id, at, device, todos: sum.todos, seas: sum.seas, text: JSON.stringify(p) });
        /* 新しいほうから keep 個を残す */
        const old = all.slice(Math.max(0, keep - 1));
        for (const o of old) { try { await snaps.remove(o.id); } catch (e) { /* 消せなくても続ける */ } }
      } catch (e) {
        set('error', (e && e.message) || String(e));
        return { state: 'error', saved: false };
      }
      saveConf(Object.assign(loadConf(ls), { lastAt: at }), ls);
      set(loadConf(ls).on ? 'ok' : 'off');
      if (after) { try { Promise.resolve(after()).catch(() => {}); } catch (e) { /* 残したものはそのまま */ } }
      return { state: 'ok', saved: true };
    })();
    try { return await running; }
    finally { running = null; }
  }

  /* 1日1回: 最後に残した（見た）日と今日が違えば残す */
  function checkDay() {
    const c = loadConf(ls);
    if (!c.on) return;
    if (!c.lastAt || dayOf(c.lastAt) !== dayOf(now())) runNow();
  }

  /* 開いたとき: 切ってあれば何もしない。入っていれば、すぐ1回と、30 分ごとに日を見る */
  function start() {
    if (checkTimer) return;
    checkTimer = timers.setInterval(checkDay, CHECK_MS);
    if (loadConf(ls).on) runNow();
  }
  function stop() {
    if (checkTimer) timers.clearInterval(checkTimer);
    checkTimer = null;
  }

  /* 入れる（設定のボタン）。すぐ1つ残す */
  async function turnOn() {
    saveConf(Object.assign(loadConf(ls), { on: true }), ls);
    try {
      const sm = deps.storageManager || (globalThis.navigator && globalThis.navigator.storage);
      if (sm && typeof sm.persist === 'function') await sm.persist();
    } catch (e) { /* 頼めなくても残すのは続ける */ }
    return runNow(true);
  }
  /* 切る。wipe なら残したものも消す */
  async function turnOff(wipe = false) {
    saveConf(Object.assign(loadConf(ls), { on: false }), ls);
    if (wipe) { try { await snaps.clear(); } catch (e) { /* 消せなくても切るのは済んでいる */ } }
    set(supported ? 'off' : 'unsupported');
    return state;
  }
  /* 1つを読む → readBackup の形（mergeIntoDevice にそのまま渡せる） */
  async function read(id) {
    const s = (await snaps.list()).find(x => x.id === id);
    if (!s) throw new Error('そのバックアップはもう無い');
    return readBackup(s.text);
  }
  async function remove(id) { await snaps.remove(id); set(state.state, state.message); }

  return {
    runNow, start, stop, turnOn, turnOff, list, read, remove, checkDay,
    status: () => Object.assign({}, state, { conf: loadConf(ls) }),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/* 同時にフォルダにも書き出す（2026-11-22 Issue #83 の返事「この端末（自動）でバックアップした時に、同時に指定したファイルに書き出すことはできる？
   ローカルでキャッシュが消えた時用に」）。フォルダへの自動の書き出し（js/folderbackup.js）を入れてあれば、
   この端末の中に新しく1つ残すたびに、そのフォルダのその日のファイルにも書く（ブラウザのデータが消えてもフォルダのファイルは残る）。
   ブラウザは、押す操作なしにファイルを書かせないので、フォルダに書けるのは File System Access API のある Chrome・Edge だけ。
   フォルダの許可が切れていれば書かない（その知らせは app.js のトーストと設定に出る） */
export function alsoFolder(fb = folderBackup) {
  if (!fb) return null;
  const c = fb.status().conf;
  return c && c.on ? fb.runNow(true) : null;
}

/* 画面で使う1つ。app.js が読み込んだら動き出す（設定で切ってあれば何もしない） */
export const localBackup = (typeof window !== 'undefined' && !globalThis.__BUBBLES_NO_AUTO_MOUNT__)
  ? createLocalBackup({ device: deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1), after: () => alsoFolder() })
  : null;
if (localBackup) {
  localBackup.start();
  /* 画面に戻ったときにも日を見る（端末を閉じたまま日をまたいだとき） */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') localBackup.checkDay();
  });
}
