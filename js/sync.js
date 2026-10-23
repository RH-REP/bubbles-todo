/* サーバーと記録を合わせる（2026-10-23。利用者の指示：複数の端末から同じ記録を使う）。

   ■ 繋がないとき
   設定でサーバーの住所を入れていなければ、何もしない。今までどおり
   localStorage だけで動く（GitHub Pages のお試し版はこれ）。

   ■ 繋いだとき
     1. GET  <住所>/api/data           … サーバーの記録と版（version）を取る
     2. 手元の記録と合わせる（merge.js。記録ごとに新しいほうが残る）
        手元が変わるなら store に入れる（画面が描き直る）
     3. サーバーが変わるなら PUT <住所>/api/data { base: 版, data }
        その間に別の端末が書いていたら 409 が返るので、1. からやり直す
   合図: 起動したとき、保存したとき（少し待ってまとめる）、画面に戻ったとき、
   網が戻ったとき、それと開いている間は一定の間隔で（ほかの端末の書き換えを拾う）。

   サーバーに届かない間も、記録はふだんどおり localStorage に入る。
   届くようになったら、上の手順で合わせる（控えを別に持つ必要が無い）。

   ■ 住所と合言葉
   localStorage の 'bubble_todo_sync' に入れる。記録（bubble_todo_v1）とは別の箱で、
   サーバーへは送らない（端末ごとの設定なので）。合言葉は Authorization ヘッダで送る。

   ■ 個人と共有（2026-10-23）
   合言葉は2つ持てる。token は個人の記録、shareToken は共有の記録を開く鍵。
   いま開いている持ち主（store.space()）の合言葉だけを使う。
   サーバーは、その合言葉がどちらの置き場かを返す（space）。開いている持ち主と違えば送らない
   ——共有の合言葉を個人の欄に入れたとき、個人の記録を共有へ送らないため。
   共有は、合わせられた間だけ書ける。届かない・合言葉が無い間は store を読むだけにする。 */

import { store } from './store.js';
import { mergeState, sameStamps } from './merge.js';

const CONF_KEY = 'bubble_todo_sync';
const PUSH_DELAY = 1500;      /* 保存してから送るまで。続けて打っている間はまとめる */
const POLL_MS = 20000;        /* 開いている間、ほかの端末の書き換えを見に行く間隔 */
const RETRY_MAX = 60000;      /* 届かないとき、見に行く間隔をここまで延ばす */

const SPACE = store.space();
const SEEN_KEY = 'bubble_todo_sync_seen_' + SPACE;   /* 最後に合わせた時刻（「15:30 に見たもの」） */
let conf = readConf();
let status = { state: ready() ? 'idle' : 'off', at: null, message: '' };
const listeners = new Set();
let running = false;
let again = false;
let timer = null;
let failures = 0;

function readConf() {
  try {
    const o = JSON.parse(localStorage.getItem(CONF_KEY) || 'null');
    if (o && typeof o.url === 'string') {
      return { url: o.url, token: String(o.token || ''), shareToken: String(o.shareToken || '') };
    }
  } catch (e) { /* 読めなければ繋がない */ }
  return { url: '', token: '', shareToken: '' };
}

/* いま開いている持ち主の合言葉 */
function key() { return SPACE === 'share' ? conf.shareToken : conf.token; }
/* 繋ぐ先と合言葉がそろっているか */
function ready() { return !!(conf.url && key()); }

function readSeen() {
  try { const n = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(n) && n > 0 ? n : null; } catch (e) { return null; }
}
function writeSeen(ms) {
  try { localStorage.setItem(SEEN_KEY, String(ms)); } catch (e) { /* 覚えられなくても動く */ }
}

/* 住所を整える。末尾の / を落とし、http(s) 以外は受け付けない。
   「100.64.1.2:8931」のように頭を省いたら http:// を補う */
export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'http://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

function setStatus(state, message) {
  status = { state, at: Date.now(), message: message || '' };
  /* 共有は、合わせられた直後だけ書ける。合わせている最中は前のまま */
  if (SPACE === 'share' && state !== 'syncing') store.setReadOnly(state !== 'ok');
  listeners.forEach(fn => { try { fn(status); } catch (e) { /* 通知で落とさない */ } });
}

async function call(method, body) {
  const res = await fetch(conf.url + '/api/data', {
    method,
    headers: Object.assign(
      { Authorization: 'Bearer ' + key() },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 中身が無い応答 */ }
  return { status: res.status, json };
}

/* 1回合わせる。食い違い（409）なら3回までやり直す */
async function syncOnce() {
  for (let tries = 0; tries < 3; tries++) {
    const got = await call('GET');
    if (got.status === 401) throw new Error('合言葉が違う');
    if (got.status !== 200 || !got.json) throw new Error('サーバーの応答が読めない（' + got.status + '）');
    /* 取り違えの見張り。前の版のサーバーは space を返さないので、そのときは個人だけ通す */
    const space = got.json.space || 'me';
    if (space !== SPACE) {
      throw new Error(SPACE === 'share' ? 'これは共有の合言葉ではない' : 'これは共有の合言葉（自分の合言葉の欄に入っている）');
    }
    const version = Number(got.json.version) || 0;
    const remote = got.json.data && got.json.data.doc ? got.json.data : null;

    /* ここから PUT まで、手元の状態は await を挟まずに読む
       （取りに行っている間に打った分も、合わせる相手に入る） */
    const local = store.exportState();
    const merged = remote ? mergeState(local, remote) : local;
    if (!sameStamps(merged.stamps, local.stamps)) store.applyState(merged);
    const mine = store.exportState();
    if (remote && sameStamps(mine.stamps, remote.stamps)) return;   /* もう同じ */

    const put = await call('PUT', { base: version, data: mine });
    if (put.status === 200) return;
    if (put.status === 409) continue;          /* 間に別の端末が書いた。取り直す */
    if (put.status === 401) throw new Error('合言葉が違う');
    throw new Error('サーバーに書けなかった（' + put.status + '）');
  }
  throw new Error('ほかの端末と書き込みが重なり続けた');
}

/* 合わせる。走っている最中に呼ばれたら、終わってからもう1回だけ走る */
export async function syncNow() {
  if (!ready()) return false;
  if (running) { again = true; return false; }
  running = true;
  setStatus('syncing');
  let ok = false;
  try {
    await syncOnce();
    failures = 0;
    ok = true;
    writeSeen(Date.now());
    setStatus('ok');
  } catch (e) {
    failures++;
    /* fetch が投げる TypeError は「網に出られなかった」（文言はブラウザの英語）。字は揃える */
    setStatus('error', (e instanceof TypeError || !e || !e.message) ? 'サーバーに届かない' : e.message);
  } finally {
    running = false;
  }
  if (again) { again = false; return syncNow(); }
  schedule(ok ? POLL_MS : Math.min(RETRY_MAX, 3000 * 2 ** Math.min(failures, 5)));
  return ok;
}

function schedule(ms) {
  clearTimeout(timer);
  if (!ready()) return;
  timer = setTimeout(() => {
    /* 見えていない間は見に行かない（画面に戻ったときに走る） */
    if (typeof document !== 'undefined' && document.hidden) return;
    syncNow();
  }, ms);
}

export const sync = {
  config() { return { url: conf.url, token: conf.token, shareToken: conf.shareToken }; },
  status() { return status; },
  /* いま開いている持ち主と、その合言葉がそろっているか（共有の「入る」札を出すかに使う） */
  space() { return SPACE; },
  ready,
  /* 最後に合わせた時刻（epoch ms）。まだなら null。開き直しても残る */
  seenAt() { return readSeen(); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* 繋ぐ先を決める。url を空にすると繋がない（記録は手元に残る）。
     shareToken を省くと、今の共有の合言葉をそのまま残す */
  configure(url, token, shareToken) {
    const u = normalizeUrl(url);
    if (u === null) return false;
    conf = {
      url: u, token: String(token || '').trim(),
      shareToken: shareToken === undefined ? conf.shareToken : String(shareToken || '').trim(),
    };
    if (!u) conf = { url: '', token: '', shareToken: '' };
    try {
      if (u) localStorage.setItem(CONF_KEY, JSON.stringify(conf));
      else localStorage.removeItem(CONF_KEY);
    } catch (e) { /* 保存できなくても、開いている間は繋がる */ }
    clearTimeout(timer);
    failures = 0;
    if (!ready()) { setStatus('off'); return true; }
    setStatus('idle');
    syncNow();
    return true;
  },

  syncNow,
};

/* 起動。保存のたびに少し待って送る。画面に戻ったとき・網が戻ったときにも合わせる */
store.onPersist(() => { if (ready() && !running) schedule(PUSH_DELAY); else if (running) again = true; });
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
}
if (ready()) syncNow();
