/* 前の版に戻す（2026-11-07。Issue #21）。

   ■ なにをするか
   新しい版に不具合があったとき、**1つ前の版**へその端末だけ戻して使い続けられるようにする。
   sw.js は新しい版が入るとき、それまでの版の箱（キャッシュ）を1つだけ消さずに残す。
   設定の「前の版に戻す」を押すと、sw.js がその箱から画面を出すようになる（「戻している」印＝pin）。
   戻している間は、画面の上に帯が出る（「最新に戻る」で戻る）。

   ■ 記録を守るための決めごと（前の版は、新しい版で足した欄を知らない）
   前の版のコードは、読み込むときに知らない欄を落とし、そのまま保存する（js/store.js の normalizeTodo など）。
   そこで次の3つをする：
     1. 戻す前に、端末の記録（localStorage の bubble_todo…）の写しを取る（SNAP_KEY）
     2. 戻している間は、サーバーへ書き込まない（sw.js が /api/ への GET 以外を 503 で止める）。
        欄を落とした記録がサーバー経由でほかの端末へ広がらないように
     3. 最新に戻ったら（この file を head で読む新しい版が立ち上がったら）、写しにあって今の記録に無い欄だけを
        埋め戻す（fillMissing）。戻している間に書いた変更は消さない。写しは埋め戻したら消す
   新しい版が届いたら（sw.js の activate）、戻している印は外れる（直した版が届いたとみる）。

   ■ 読まれ方
   ・新しい版の index.html の head（普通の script）。写しがあれば埋め戻す。settings.js は BubblesRollback を使う
   ・戻している間は、sw.js が前の版の index.html の <head> の直後に data-pinned 付きで差し込む。帯を出す
   ・sw.js が importScripts で読む（previousVersion・injectScript・PIN_PATH を使う）。document が無いので画面のことはしない
   ・node のテスト（tests/rollback.test.mjs）が globalThis.BubblesRollback を読む */
(function (root) {
  'use strict';

  const SNAP_KEY = 'bubble_todo_rollback_snapshot_v1';
  const PREFIX = 'bubble_todo';
  /* 写さないもの: API キー（端末にだけ置く秘密。写しを増やさない）と、写しそのもの */
  const SKIP = [SNAP_KEY, 'bubble_todo_ai_key'];
  /* 2026-11-12 Issue #46: 会社ごとのキー（bubble_todo_ai_key_openai など）も写さない */
  const SKIP_PREFIX = 'bubble_todo_ai_key';
  function skipped(k) { return SKIP.indexOf(k) >= 0 || String(k).indexOf(SKIP_PREFIX) === 0; }
  const META_CACHE = 'bubbles-meta';
  const PIN_PATH = '__rollback_pin';
  const VER_RE = /^[0-9A-Za-z-]{1,40}$/;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* 写し（snap）にあって今（cur）に無い欄だけを足した、新しい値を返す。
     ・今にある欄は今のまま（戻している間に書いた変更を消さない）
     ・どちらも物なら中へ降りる。配列は、id を持つ物どうしを id で突き合わせて中へ降りる
     ・今に無い配列の要素（戻している間に消したもの）は足さない */
  function fillMissing(cur, snap) {
    if (Array.isArray(cur) && Array.isArray(snap)) {
      const byId = new Map();
      snap.forEach((s) => { if (isObj(s) && typeof s.id === 'string') byId.set(s.id, s); });
      if (!byId.size) return cur;
      return cur.map((c) => (isObj(c) && typeof c.id === 'string' && byId.has(c.id)) ? fillMissing(c, byId.get(c.id)) : c);
    }
    if (isObj(cur) && isObj(snap)) {
      const out = {};
      Object.keys(cur).forEach((k) => { out[k] = (k in snap) ? fillMissing(cur[k], snap[k]) : cur[k]; });
      Object.keys(snap).forEach((k) => { if (!(k in cur)) out[k] = snap[k]; });
      return out;
    }
    return cur;
  }

  /* 端末の記録の写し（キー → 生の文字列） */
  function snapshotStorage(ls) {
    const data = {};
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.indexOf(PREFIX) === 0 && !skipped(k)) data[k] = ls.getItem(k);
    }
    return data;
  }

  /* 写しから欄を埋め戻す。今に無いキー（戻している間に消したもの。ログアウトなど）は戻さない。
     JSON でないものは触らない。書き換えたキーの数を返す */
  function restoreMissing(ls, data) {
    let n = 0;
    Object.keys(data || {}).forEach((k) => {
      if (skipped(k)) return;
      const raw = ls.getItem(k);
      if (raw === null || raw === data[k]) return;
      let cur, snap;
      try { cur = JSON.parse(raw); snap = JSON.parse(data[k]); } catch (e) { return; }
      const next = JSON.stringify(fillMissing(cur, snap));
      if (next !== JSON.stringify(cur)) { ls.setItem(k, next); n++; }
    });
    return n;
  }

  /* 箱の名前の一覧から、今（current）より前で最も新しい版を返す。無ければ null。
     版は '2026-11-07a' の形で、文字の順がそのまま新しさの順 */
  function previousVersion(names, current) {
    let best = null;
    (names || []).forEach((n) => {
      if (typeof n !== 'string' || n.indexOf('bubbles-') !== 0 || n === META_CACHE) return;
      const v = n.slice('bubbles-'.length);
      if (!VER_RE.test(v) || !(v < current)) return;
      if (best === null || v > best) best = v;
    });
    return best;
  }

  /* 前の版の index.html の <head> の直後に、帯を出すこの file を差し込む（sw.js が呼ぶ）。
     head のいちばん先に置くのは、前の版がこの file を head で読む版（2026-11-07b より後）のとき、
     そちらが「戻している」と知って写しに触らないようにするため。<head> が無ければ </body> の前 */
  function injectScript(html, pinned, latest) {
    if (!VER_RE.test(pinned) || !VER_RE.test(latest)) return html;
    const tag = '<script src="js/rollback.js" data-pinned="' + pinned + '" data-latest="' + latest + '"></script>';
    const h = html.search(/<head[^>]*>/i);
    if (h >= 0) { const end = html.indexOf('>', h) + 1; return html.slice(0, end) + tag + html.slice(end); }
    const i = html.lastIndexOf('</body>');
    return i < 0 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }

  /* ---- ここから画面の側（ブラウザだけ） ---- */

  async function scopeUrl() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return new URL(PIN_PATH, reg.scope).href;
  }

  /* 戻せる前の版。service worker が効いていて、前の版の箱が残っているときだけ。無ければ null */
  async function available() {
    if (root.BUBBLES_PINNED) return null;   /* 戻している間は、さらに前へは戻さない */
    if (typeof caches === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return null;
    const cur = root.BUBBLES_VERSION;
    if (!cur) return null;
    return previousVersion(await caches.keys(), cur);
  }

  /* 前の版（ver）に戻す。写しを取り、印を置いて、読み直す */
  async function rollbackTo(ver) {
    if (!VER_RE.test(ver)) throw new Error('版の名前が読めない');
    const url = await scopeUrl();
    if (!url) throw new Error('この端末では戻せない');
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ at: Date.now(), from: root.BUBBLES_VERSION || '', to: ver, data: snapshotStorage(localStorage) }));
    } catch (e) {
      throw new Error('記録の写しを取れなかったので戻さない（端末の空きが足りない）');
    }
    const box = await caches.open(META_CACHE);
    await box.put(url, new Response(JSON.stringify({ to: ver, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
    location.reload();
  }

  /* 最新に戻る。印を外して読み直す（埋め戻しは、新しい版の head でこの file が走るときにする） */
  async function backToLatest() {
    const url = await scopeUrl();
    if (url && typeof caches !== 'undefined') {
      const box = await caches.open(META_CACHE);
      await box.delete(url);
    }
    location.reload();
  }

  function showBar(pinned) {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
      + 'padding:calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px;background:#5b3a00;color:#fff;font:13px/1.4 system-ui,sans-serif;'
      + 'box-shadow:0 2px 6px rgba(0,0,0,.3)';
    const msg = document.createElement('span');
    msg.style.cssText = 'flex:1 1 12em';
    msg.textContent = '前の版 v' + pinned + ' を使っている（サーバーへは送らない）';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '最新に戻る';
    btn.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #fff;background:#fff;color:#5b3a00';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      backToLatest().catch(() => { btn.disabled = false; });
    });
    bar.appendChild(msg);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function boot() {
    const me = document.currentScript;
    const pinned = me && me.dataset ? me.dataset.pinned : '';
    if (pinned) {
      root.BUBBLES_PINNED = pinned;
      if (document.body) showBar(pinned);
      else document.addEventListener('DOMContentLoaded', () => showBar(pinned));
      return;
    }
    /* 戻している（前の版がこの file を head でも読む版のとき）。写しは最新に戻るまで取っておく */
    if (root.BUBBLES_PINNED) return;
    /* 新しい版の head。写しがあれば、store.js が読む前に埋め戻して消す */
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { snap = null; }
    if (!snap) return;
    try { restoreMissing(localStorage, snap.data); } catch (e) { return; /* 次に開いたときにもう一度 */ }
    localStorage.removeItem(SNAP_KEY);
  }

  root.BubblesRollback = {
    SNAP_KEY, META_CACHE, PIN_PATH,
    fillMissing, snapshotStorage, restoreMissing, previousVersion, injectScript,
    available, rollbackTo, backToLatest,
  };

  if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') boot();
})(typeof self !== 'undefined' ? self : globalThis);
