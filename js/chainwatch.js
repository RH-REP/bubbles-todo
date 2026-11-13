/* ほかの端末の新しい控えを知らせる（サーバーなし版。2026-11-13 Issue #52 の返事「おすすめで」= R1）。

   ブロックチェーンのバックアップを始めた端末（設定 bubble_todo_chain_v1 に address がある）で、
   開いたとき・画面に戻ったとき・開いている間 5 分ごとに、鍵なしで「いちばん新しく全部そろった控えの ID」だけを見る
   （Solana の窓口に取引の一覧を 1 回尋ねる。手数料は無い。窓口にはウォレットのアドレスと IP アドレスが見える。中身は暗号のまま）。
   その ID が、この端末で書いたもの（lastId）でも、最後に読み込んだもの（seenId）でもなければ、画面の下に知らせを出す:
     「ほかの端末の新しい記録がある」 ［読み込む］ ［×］
   ［読み込む］は押した手の続きでパスキーか合言葉で鍵を出してもらい（鍵は置かない。今までどおり）、重ねる（消さない）。
   ［×］はその控えの間だけ隠す（次に新しい控えが出たらまた出す）。書き出す（手数料が掛かる）は今までどおり押したときだけ。

   DOM と通信は渡されたものを使えるようにしてある（opts.document・opts.latest・opts.storage） */

import { loadConfig, saveConfig, latestBackupId } from './chain.js';

export const NEW_TEXT = 'ほかの端末の新しい記録がある（ブロックチェーン）';
export const EVERY_MS = 5 * 60000;
export const BOARD_GAP_MS = 60000;   /* 泡の盤を開いたときに見に行く間隔の下限 */

/* この端末で最後に読み込んだ控えの ID を覚える（読み込んだものは知らせない） */
export function markChainSeen(id, storage = globalThis.localStorage) {
  if (!id) return;
  try { saveConfig(Object.assign(loadConfig(storage), { seenId: String(id) }), storage); } catch (e) { /* 覚えられなくても進む */ }
}

/* 知らせを出すべき控えの ID か（この端末で書いた・読み込んだ・隠したものは出さない） */
export function isNews(id, cfg, dismissed) {
  return !!id && id !== cfg.lastId && id !== cfg.seenId && id !== dismissed;
}

/* 見張りを始める。opts.open(id) は［読み込む］で呼ぶ（鍵を出して重ねる。成功したら真）。戻り値 { check, bar } */
export function startChainWatch(opts = {}) {
  const doc = opts.document || globalThis.document;
  const storage = opts.storage || globalThis.localStorage;
  const latest = opts.latest || latestBackupId;
  if (!doc || !doc.body) return null;

  const bar = doc.createElement('div');
  bar.setAttribute('role', 'status');
  bar.className = 'chain-news';
  bar.hidden = true;
  bar.style.cssText = 'position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom, 0px) + 76px);z-index:80;'
    + 'display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:12px;'
    + 'background:#2f4a5c;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  const msg = doc.createElement('span');
  msg.style.cssText = 'flex:1 1 12em';
  msg.textContent = NEW_TEXT;
  const read = doc.createElement('button');
  read.type = 'button';
  read.textContent = '読み込む';
  read.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #fff;background:#fff;color:#2f4a5c';
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '知らせを閉じる');
  close.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #fff;background:transparent;color:#fff';
  bar.appendChild(msg);
  bar.appendChild(read);
  bar.appendChild(close);
  doc.body.appendChild(bar);

  let shown = null;      /* 知らせている控えの ID */
  let dismissed = null;  /* ×で隠した控えの ID（この窓の間だけ） */
  let busy = false;
  let lastAsk = 0;       /* 最後に窓口へ尋ねた時刻 */
  function show(id) {
    shown = id;
    msg.textContent = NEW_TEXT;
    read.disabled = false;
    bar.hidden = !id;
    bar.style.display = id ? 'flex' : 'none';
  }

  /* 押した手の続きで鍵を出すので、ここより前で await しない */
  read.addEventListener('click', async () => {
    if (!shown || !opts.open) return;
    const id = shown;
    read.disabled = true;
    msg.textContent = '読み込んでいる…';
    try {
      const ok = await opts.open(id);
      if (ok) { markChainSeen(id, storage); show(null); return; }
      msg.textContent = NEW_TEXT;
    } catch (e) {
      msg.textContent = '読み込めなかった: ' + ((e && e.message) || '不明') + '（設定の「記録を保存する・読み込む」からも読める）';
    }
    read.disabled = false;
  });
  close.addEventListener('click', () => { dismissed = shown; show(null); });

  async function check() {
    if (busy) return;
    if (doc.hidden) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const cfg = loadConfig(storage);
    if (!cfg.address) return;   /* ブロックチェーンを始めていない端末では尋ねない */
    busy = true;
    lastAsk = Date.now();
    try {
      const id = await latest(cfg.network, cfg.address);
      const now = loadConfig(storage);   /* 尋ねている間に書いた・読み込んだかもしれない */
      if (now.address !== cfg.address) return;
      if (isNews(id, now, dismissed)) { if (id !== shown) show(id); }
      else if (shown && !isNews(shown, now, dismissed)) show(null);
    } catch (e) { /* 届かなければ黙って次を待つ */ }
    finally { busy = false; }
  }

  if (!opts.manual) {
    setTimeout(check, 4000);   /* 開いてすぐの読み込みと重ねない */
    setInterval(check, EVERY_MS);   /* 隠れている間は check の中で飛ばす */
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) check(); });
    /* 泡の盤を開いたときも見る（Issue #52 の返事）。続けて開いても尋ねすぎないよう、前に尋ねてから 1 分は見ない */
    if (typeof addEventListener === 'function') addEventListener('bubbles:boardopen', () => {
      if (Date.now() - lastAsk >= BOARD_GAP_MS) check();
    });
  }
  return { check, bar, show };
}
