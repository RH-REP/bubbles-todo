/* 古い版の帯（2026-11-10。共有の記録 v1.1 §6。利用者の指示「非互換性 update を通知するための機能」）。

   サーバーが「この版の記録の形は古い」と断ったとき（GET の minSchema が SCHEMA より大きい、
   か PUT が 426）、js/sync.js は同期の書き込みを止めて状態を 'outdated' にする。
   ここはそれを見て、画面の上に帯を出す：
     「この版は古いので同期を止めた。更新すると続きから合わさる」 [今すぐ更新]
   [今すぐ更新] は設定の「最新の版を確認する」と同じ（js/update.js の checkForUpdate → applyUpdate）。
   新しい版が見つからなければ、帯の字でそう言う。
   手元の記録はそのまま印つきで残っていて、入れ替わったあとの同期で入る。

   DOM は渡されたものだけを触る（テストは小さな作り物の document で走らせる。tests/schema.test.mjs）。 */

import { sync } from './sync.js';
import { checkForUpdate, applyUpdate } from './update.js';

export const OUTDATED_TEXT = 'この版は古いので同期を止めた。更新すると続きから合わさる';
export const NOT_FOUND_TEXT = '新しい版がまだ見つからない（少し待ってもう一度押す）';
export const NO_SW_TEXT = 'この端末では自動で入れ替えられない（Android の app は作り直して入れ直す）';

/* 帯を付ける。戻り値は { bar, paint }（paint は状態が変わったときに呼ぶ。sync.on で呼ばれる） */
export function mountSchemaGuard(opts = {}) {
  const doc = opts.document || globalThis.document;
  const api = opts.sync || sync;
  const check = opts.checkForUpdate || checkForUpdate;
  const apply = opts.applyUpdate || applyUpdate;
  if (!doc || !doc.body) return null;

  const bar = doc.createElement('div');
  bar.setAttribute('role', 'alert');
  bar.className = 'schema-guard';
  bar.hidden = true;
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147482900;display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
    + 'padding:calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px;background:#3a3f5b;color:#fff;font:13px/1.4 system-ui,sans-serif;'
    + 'box-shadow:0 2px 6px rgba(0,0,0,.3)';
  const msg = doc.createElement('span');
  msg.style.cssText = 'flex:1 1 12em';
  msg.textContent = OUTDATED_TEXT;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.textContent = '今すぐ更新';
  btn.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #fff;background:#fff;color:#3a3f5b';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const found = await check();
      if (found === null) { msg.textContent = NO_SW_TEXT; btn.disabled = false; return; }
      if (!found) { msg.textContent = NOT_FOUND_TEXT; btn.disabled = false; return; }
      msg.textContent = '新しい版に入れ替えて読み直す…';
      await apply();
    } catch (e) {
      msg.textContent = (e && e.message) || '確かめられなかった';
      btn.disabled = false;
    }
  });
  bar.appendChild(msg);
  bar.appendChild(btn);
  doc.body.appendChild(bar);

  function paint() {
    const on = !!api.outdated();
    if (on && bar.hidden) { msg.textContent = OUTDATED_TEXT; btn.disabled = false; }
    bar.hidden = !on;
    bar.style.display = on ? 'flex' : 'none';
  }
  api.on(paint);
  paint();
  return { bar, paint };
}

/* 画面で読まれたら、すぐ付ける */
if (typeof document !== 'undefined' && document.body && !globalThis.__BUBBLES_NO_AUTO_MOUNT__) mountSchemaGuard();
