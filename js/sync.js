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
   共有は、合わせられた間だけ書ける。届かない・合言葉が無い間は store を読むだけにする。

   ■ 名前を付けた海（2026-11-02 Issue #4）
   「共有」は、名前を付けて複数作れる海の1つになった（js/spacelist.js）。
   どの海の記録かは X-Bubbles-Space で言う（合言葉でも）。鍵は次のとおり。
     持ち主の鍵 … 自分の合言葉（token）か、個人（me）に入れるパスキー。どの海にも入れる
     招かれた鍵 … 「共有」の合言葉（shareToken。前の版のまま）か、その海だけに入れるパスキー
   招かれた鍵で開いている海だけ、合わせられた間だけ書ける（前の版の共有と同じ）。
   作った海は、初めはこの端末だけのもの。繋いでいれば、持ち主の鍵でサーバーとも合わせる。
   海の一覧（名前・色）も POST /api/spaces でサーバーと合わせる（ほかの端末・招いた人に名前が届く）。

   ■ 個人は人ごと（2026-11-03 利用者の指示）
   パスキーの形では、個人（me）は「その鍵の人の個人」。人はサーバーに登録した順の番号（person）で、
   持ち主（どの海にも入れる鍵）は 1 番の人だけ。サーバーは GET /api/data で person と owner を返す。
   この端末が前に合わせた個人と番号が変わったら（サーバーでパスキーを移したとき）、
   手元の個人の箱をサーバーのものに入れ替える。前の中身は 'bubble_todo_v1_before_person_<時刻>' に残す。
   番号を覚える前の版で個人を合わせていた端末は、1 番（持ち主）の個人を合わせていたとみなす。 */

import { store } from './store.js';
import { mergeState, sameStamps } from './merge.js';
import { allEntries, mergeSeas, seaName } from './spacelist.js';

const CONF_KEY = 'bubble_todo_sync';
const PUSH_DELAY = 1500;      /* 保存してから送るまで。続けて打っている間はまとめる */
const POLL_MS = 20000;        /* 開いている間、ほかの端末の書き換えを見に行く間隔 */
const RETRY_MAX = 60000;      /* 届かないとき、見に行く間隔をここまで延ばす */

/* 自分の機械の中の住所。http でも通す（checkUrl）。**readConf() より前に置く**——
   保存してある住所を読み込みの時点で確かめるので、後ろに置くと const の手前で読んで落ち、
   設定ごと捨てていた（2026-10-23。http://127.0.0.1 の住所が、読み直すたびに消えた） */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const SPACE = store.space();
const SEEN_KEY = 'bubble_todo_sync_seen_' + SPACE;   /* 最後に合わせた時刻（「15:30 に見たもの」） */
const PERSON_KEY = 'bubble_todo_sync_person';       /* 個人を最後に合わせた人の番号（パスキーの形） */
const OWNER_PERSON = 1;
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
      /* 前の版で保存した外への http の住所は、読み込みで捨てる（送らない） */
      const url = normalizeUrl(o.url) || '';
      return Object.assign(blankConf(), {
        url, token: String(o.token || ''), shareToken: String(o.shareToken || ''),
        session: String(o.session || ''), sessionSpaces: Array.isArray(o.sessionSpaces) ? o.sessionSpaces : [],
        sessionExpires: Number(o.sessionExpires) || 0, sessionName: String(o.sessionName || ''),
        sessionOwner: typeof o.sessionOwner === 'boolean' ? o.sessionOwner : null,
      });
    }
  } catch (e) { /* 読めなければ繋がない */ }
  return blankConf();
}
function blankConf() {
  return { url: '', token: '', shareToken: '', session: '', sessionSpaces: [], sessionExpires: 0, sessionName: '',
    sessionOwner: null };
}
function saveConf() {
  try {
    if (conf.url) localStorage.setItem(CONF_KEY, JSON.stringify(conf));
    else localStorage.removeItem(CONF_KEY);
  } catch (e) { /* 保存できなくても、開いている間は繋がる */ }
}

/* パスキーの通行証（2026-10-24。公開の形）。持っていて、期限内か */
function sessionLive() { return !!(conf.session && conf.sessionExpires * 1000 > Date.now()); }
/* 持ち主の鍵。どの海にも入れる（2026-11-02 Issue #4）。
   パスキーの形では、サーバーが言う owner（1 番の人）。まだ聞いていなければ、前の版どおり個人に入れる鍵 */
function ownerKey() {
  if (!conf.session) return !!conf.token;
  if (!sessionLive()) return false;
  return conf.sessionOwner === null ? conf.sessionSpaces.indexOf('me') >= 0 : conf.sessionOwner;
}
/* いま開いている海の鍵。パスキーの通行証があればそれ、無ければ合言葉 */
function key() {
  if (conf.session) {
    if (!sessionLive()) return '';
    if (SPACE === 'me') return conf.sessionSpaces.indexOf('me') >= 0 ? conf.session : '';
    return (conf.sessionSpaces.indexOf(SPACE) >= 0 || ownerKey()) ? conf.session : '';
  }
  if (SPACE === 'share') return conf.token || conf.shareToken;
  return conf.token;
}
/* 繋ぐ先と鍵がそろっているか */
function ready() { return !!(conf.url && key()); }
/* 招かれた鍵で開いている海か（合わせられた間だけ書ける） */
function guest() { return SPACE !== 'me' && ready() && !ownerKey(); }

/* 個人の番号が、この端末で前に合わせたものから変わったか。
   番号を覚える前の版で個人を合わせていた端末（SEEN はあるが PERSON が無い）は、1 番を合わせていた */
function personMoved(person) {
  let prev = null;
  try { prev = localStorage.getItem(PERSON_KEY); } catch (e) { /* 読めなければ覚えていない */ }
  if (prev !== null && prev !== '') return Number(prev) !== person;
  return person !== OWNER_PERSON && readSeen() !== null;
}
function rememberPerson(person) {
  try { localStorage.setItem(PERSON_KEY, String(person)); } catch (e) { /* 覚えられなくても動く */ }
}

function readSeen() {
  try { const n = Number(localStorage.getItem(SEEN_KEY)); return Number.isFinite(n) && n > 0 ? n : null; } catch (e) { return null; }
}
function writeSeen(ms) {
  try { localStorage.setItem(SEEN_KEY, String(ms)); } catch (e) { /* 覚えられなくても動く */ }
}

/* 住所を整える。末尾の / を落とす。頭を省いたら https:// を補う。
   **外への http:// は受け付けない**（2026-10-23。合言葉と記録が暗号化されずに流れるため）。
   通すのは自分の機械の中（localhost・127.0.0.1・[::1]）だけ——開発と、エミュレーターの adb reverse 用。
   受け付けないときは null、http だから断ったときは 'http' を返す（画面が言い分けるため） */
export function checkUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol === 'http:' && LOOPBACK.indexOf(u.hostname) < 0) return 'http';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}
export function normalizeUrl(raw) {
  const u = checkUrl(raw);
  return u === 'http' ? null : u;
}

function setStatus(state, message) {
  status = { state, at: Date.now(), message: message || '' };
  /* 招かれて入った海は、合わせられた直後だけ書ける。合わせている最中は前のまま */
  if (state !== 'syncing') store.setReadOnly(guest() && state !== 'ok');
  listeners.forEach(fn => { try { fn(status); } catch (e) { /* 通知で落とさない */ } });
}

async function call(method, body, path = '/api/data', auth = key()) {
  const res = await fetch(conf.url + path, {
    method,
    headers: Object.assign(
      { Authorization: 'Bearer ' + auth },
      /* 持ち主の鍵はどの海にも効くので、どの海の記録かを言う */
      { 'X-Bubbles-Space': SPACE },
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
    if (got.status === 401) throw new Error(conf.session ? 'パスキーで入り直す（通行証の期限切れか、取り消された）' : '合言葉が違う');
    if (got.status === 429) {
      throw new Error(got.json && got.json.error === 'devices'
        ? '使っている端末が多い（' + (got.json.max || 3) + '台まで）。ほかの端末が30分使わなければ入れる'
        : '失敗が続いたので、しばらく断られている');
    }
    if (got.status !== 200 || !got.json) throw new Error('サーバーの応答が読めない（' + got.status + '）');
    /* 取り違えの見張り。前の版のサーバーは space を返さないので、そのときは個人だけ通す */
    const space = got.json.space || 'me';
    if (space !== SPACE) {
      if (SPACE === 'me') throw new Error('これは「' + seaName(space) + '」の合言葉（自分の合言葉の欄に入っている）');
      if (space === 'me') throw new Error('サーバーがこの海を知らない（サーバーを新しくする）');
      throw new Error('これは「' + seaName(SPACE) + '」の合言葉ではない');
    }
    const version = Number(got.json.version) || 0;
    const remote = got.json.data && got.json.data.doc ? got.json.data : null;

    /* 持ち主か（サーバーが言う。パスキーを移すと変わる） */
    if (conf.session && typeof got.json.owner === 'boolean' && got.json.owner !== conf.sessionOwner) {
      conf.sessionOwner = got.json.owner;
      saveConf();
    }
    /* 個人の番号が変わった（サーバーでパスキーをほかの人の個人へ移した）。
       手元の個人は前の人のものなので、合わせずにサーバーのものへ入れ替える（前の中身は控えに残す） */
    if (SPACE === 'me' && conf.session && Number.isInteger(got.json.person)) {
      if (personMoved(got.json.person)) {
        try {
          localStorage.setItem('bubble_todo_v1_before_person_' + Date.now(), JSON.stringify(store.exportState()));
        } catch (e) { /* 控えが入らなくても、前の人の記録をこの人の個人へ送らないほうを取る */ }
        store.applyState(remote || { doc: {}, stamps: {} });
      }
      rememberPerson(got.json.person);
    }

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

/* 海の一覧（名前・色）をサーバーと合わせる（2026-11-02 Issue #4）。
   鍵は持ち主の鍵か、招かれた鍵のどちらか。持ち主の鍵なら手元の書き換えもサーバーへ届き、
   招かれた鍵ならサーバーは自分の入れる海だけを返す（書き換えは届かない）。
   前の版のサーバー（404）や届かないときは黙って見送る（記録を合わせるのは止めない） */
const seaListeners = new Set();
function anyKey() {
  if (conf.session) return sessionLive() ? conf.session : '';
  return conf.token || conf.shareToken;
}
export async function syncSeas() {
  const k = anyKey();
  if (!conf.url || !k) return false;
  try {
    const got = await call('POST', { spaces: allEntries() }, '/api/spaces', k);
    if (got.status !== 200 || !got.json || !Array.isArray(got.json.spaces)) return false;
    if (mergeSeas(got.json.spaces)) seaListeners.forEach(fn => { try { fn(); } catch (e) { /* 通知で落とさない */ } });
    return true;
  } catch (e) { return false; }
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
    await syncSeas();
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
  config() {
    return { url: conf.url, token: conf.token, shareToken: conf.shareToken,
      passkey: conf.session ? { name: conf.sessionName, spaces: conf.sessionSpaces.slice(), expires: conf.sessionExpires,
        valid: conf.sessionExpires * 1000 > Date.now(), owner: ownerKey() } : null };
  },

  /* パスキーで入ったあと（passkey.js の結果 {session, expires, spaces, name}）。合言葉は捨てる */
  usePasskeySession(url, out) {
    const u = normalizeUrl(url);
    if (!u || !out || !out.session) return false;
    conf = Object.assign(blankConf(), { url: u, session: String(out.session), sessionSpaces: out.spaces || [],
      sessionExpires: Number(out.expires) || 0, sessionName: String(out.name || ''),
      sessionOwner: typeof out.owner === 'boolean' ? out.owner : null });
    saveConf();
    clearTimeout(timer);
    failures = 0;
    syncSeas();
    if (!ready()) { setStatus('off'); return true; }
    setStatus('idle');
    syncNow();
    return true;
  },

  /* パスキーの通行証を捨てる（住所は残す）。サーバーへの取り消しは passkey.js の logoutPasskey */
  dropPasskeySession() {
    const old = conf.session;
    conf = Object.assign(conf, { session: '', sessionSpaces: [], sessionExpires: 0, sessionName: '', sessionOwner: null });
    saveConf();
    clearTimeout(timer);
    setStatus('off');
    return old;
  },
  /* 引っ越しのファイルに入れる鍵（Issue #19）。パスキーの形は通行証（引っ越しの鍵を作るためだけに使い、
     ファイルには入れない）、合言葉の形は合言葉。繋いでいなければ null */
  moveSecrets() {
    if (!conf.url) return null;
    if (conf.session) return { url: conf.url, session: sessionLive() ? conf.session : '' };
    return { url: conf.url, token: conf.token, shareToken: conf.shareToken };
  },
  status() { return status; },
  /* いま開いている海 */
  space() { return SPACE; },
  ready,
  /* 持ち主の鍵（どの海にも入れる）を持っているか */
  owner: ownerKey,
  /* 海の一覧をサーバーと合わせる。一覧が変わったら onSeas の相手に知らせる */
  syncSeas,
  onSeas(fn) { seaListeners.add(fn); return () => seaListeners.delete(fn); },
  /* 最後に合わせた時刻（epoch ms）。まだなら null。開き直しても残る */
  seenAt() { return readSeen(); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* 繋ぐ先を決める。url を空にすると繋がない（記録は手元に残る）。
     shareToken を省くと、今の共有の合言葉をそのまま残す */
  configure(url, token, shareToken) {
    const u = normalizeUrl(url);
    if (u === null) return false;
    conf = Object.assign(blankConf(), {
      url: u, token: String(token || '').trim(),
      shareToken: shareToken === undefined ? conf.shareToken : String(shareToken || '').trim(),
    });
    saveConf();
    clearTimeout(timer);
    failures = 0;
    if (!ready()) { syncSeas(); setStatus('off'); return true; }
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
/* 招かれて入った海は、合わせるまでは読むだけ */
if (guest()) store.setReadOnly(true);
if (ready()) syncNow();
else syncSeas();   /* この海の鍵が無くても、入れる海の一覧は取りに行く（招かれた人が海を知るため） */
