/* 設定の「最新の版を確認する」から呼ぶ、手で更新する仕組み（2026-11-02。利用者の指示）。

   ■ なぜ要るか
   sw.js は「次に開いたときに新しい版へ入れ替える」形（skipWaiting() を呼ばない）。
   iOS のホーム画面アプリは、閉じて開き直しても service worker の確認そのものが
   走らないことがある（WebKit の既知の挙動。裏で凍結されたまま戻る）。
   そのときの逃げ道として、**押した人だけ**その場で確認・入れ替えができるようにする。

   ■ やること
     1. 登録済みの service worker に update() を呼び、新しい sw.js を取りに行かせる
     2. 新しい版が「待機中（installed）」になったら、postMessage で skipWaiting を頼む
        （sw.js 側は、ふだんは呼ばない skipWaiting() を、この頼みが来たときだけ呼ぶ）
     3. controllerchange（入れ替わった合図）を受けたら、画面を読み直す

   ■ やらないこと
   勝手には呼ばない。**押した人の操作のときだけ**。走っている module を足元から
   差し替える副作用（sw.js の元のコメントが避けていたもの）は、ここでは
   「押した人が納得のうえでページを読み直す」ことで引き受ける。 */

/* ---- 更新を止める（2026-11-21 Issue #91。仕組みは sw.js の holdingNow）----
   印は Cache Storage の箱 bubbles-meta に置く（service worker が読めるのはここ。localStorage は読めない）。
   service worker の無い端末では止められない（null を返す） */
const META = 'bubbles-meta';
const HOLD_PATH = '__update_hold';
const HELD_PATH = '__update_held';
const ALLOW_PATH = '__update_allow';
async function metaUrl(p) {
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? new URL(p, reg.scope).href : null;
}
const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });

/* 止めているか。-> true / false。止められない端末では null */
export async function isHolding() {
  const u = await metaUrl(HOLD_PATH);
  if (!u) return null;
  return !!(await (await caches.open(META)).match(u));
}

/* 止める・止めない。-> できたら true */
export async function holdUpdates(on) {
  const u = await metaUrl(HOLD_PATH);
  if (!u) return false;
  const box = await caches.open(META);
  if (on) await box.put(u, json({ at: Date.now() }));
  else {
    await box.delete(u);
    const h = await metaUrl(HELD_PATH);
    if (h) await box.delete(h);
  }
  return true;
}

/* 止めている間に届いた版の名前。無ければ '' */
export async function heldVersion() {
  const u = await metaUrl(HELD_PATH);
  if (!u) return '';
  const hit = await (await caches.open(META)).match(u);
  const o = hit ? await hit.json().catch(() => null) : null;
  return o && typeof o.v === 'string' && o.v !== (globalThis.BUBBLES_VERSION || '') ? o.v : '';
}

/* 止めていても、次の1回（10 分のうち）は入れる。設定の「最新の版を確認する」を押したとき */
export async function allowOnce() {
  const u = await metaUrl(ALLOW_PATH);
  if (!u) return false;
  await (await caches.open(META)).put(u, json({ at: Date.now() }));
  return true;
}

/* 新しい版を確認する。見つかれば true（呼び出し側が applyUpdate を呼べる）、
   無ければ false。service worker が無い・登録できていない環境では null */
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  try { await reg.update(); } catch (e) { throw new Error('サーバーに届かない（網を確かめてください）'); }
  /* すでに待機中があれば、取りに行った結果それが育ったとみてよい */
  if (reg.waiting) return true;
  /* いま取りに行った分がインストールを終えるまで少し待つ（installing → installed） */
  if (reg.installing) {
    await new Promise((resolve) => {
      const sw = reg.installing;
      const onChange = () => {
        if (sw.state === 'installed' || sw.state === 'redundant') { sw.removeEventListener('statechange', onChange); resolve(); }
      };
      sw.addEventListener('statechange', onChange);
      setTimeout(resolve, 8000);   /* 固まらないための上限 */
    });
  }
  return !!reg.waiting;
}

/* 見つかった新しい版をいま適用する。終わるとページが読み直る（戻ってこない） */
export function applyUpdate() {
  return new Promise(async (resolve, reject) => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.waiting) { reject(new Error('新しい版が見当たらない')); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting.postMessage({ type: 'skipWaiting' });
    setTimeout(() => resolve(), 4000);   /* controllerchange が来なくても固まらない */
  });
}

/* service worker の登録が無いときの強制更新（2026-11-12 利用者の指示「ない場合は、強制更新をする様に」）。
   登録が無い端末（server.py から開いたページなど）では「確認できない」で止めず、
   この端末に残っている画面のキャッシュ（Cache Storage）を消してから、ページを読み直す。
   登録が無い＝画面を箱から出していないので、読み直せば網から最新の版を取る（server.py は no-store で返す）。
   記録（localStorage）・IndexedDB は消さない。呼ぶ側は先に store.flush() で記録を書き切っておく。 */
export async function forceReload({ cachesApi = globalThis.caches, reload = () => location.reload() } = {}) {
  try {
    if (cachesApi && typeof cachesApi.keys === 'function') {
      const names = await cachesApi.keys();
      await Promise.all(names.map((n) => cachesApi.delete(n)));
    }
  } catch (e) { /* 消せなくても読み直しは進める */ }
  reload();
}
