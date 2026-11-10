/* 古い版の帯（2026-11-10。共有の記録 v1.1 §6。利用者の指示「非互換性 update を通知するための機能」）。

   サーバーが「この版の記録の形は古い」と断ったとき（GET の minSchema が SCHEMA より大きい、
   か PUT が 426）、js/sync.js は同期の書き込みを止めて状態を 'outdated' にする。
   ここはそれを見て、画面の上に帯を出す：
     「この版は古いので同期を止めた。更新すると続きから合わさる」 [今すぐ更新]
   [今すぐ更新] は設定の「最新の版を確認する」と同じ（js/update.js の checkForUpdate → applyUpdate）。
   押したあとの字は、その端末でできることを出す（2026-11-10 統合テスト Findings 3）：
     ・Android の app（Capacitor。www/ を中に持つので、service worker を入れ替えても新しくならない）
       → 確かめに行かず「app を作り直して入れ直す」
     ・service worker の登録が無いブラウザ → 「ページを読み直す」。ボタンは［読み直す］に変わる
     ・登録はあるが新しい版がまだ無い → 「まだ見つからない」
   ■ 重ならない（同 Findings 4）
   帯は画面の上端に固定し、出ている間は帯の高さを --guard-h に入れて html に has-guard を付ける。
   上の段（海の帯・≡・歯車・!）は --safe-t から測っているので（css/space.css の頭）、
   --safe-t に帯の高さを足すと全部がそろって帯の下へ下がり、海の切り替えも押せる。
   安全領域（env）は帯が受け持つので、海の帯は安全領域のぶんを持たない。
   手元の記録はそのまま印つきで残っていて、入れ替わったあとの同期で入る。

   DOM は渡されたものだけを触る（テストは小さな作り物の document で走らせる。tests/schema.test.mjs）。 */

import { sync } from './sync.js';
import { checkForUpdate, applyUpdate } from './update.js';

export const OUTDATED_TEXT = 'この版は古いので同期を止めた。更新すると続きから合わさる';
export const NOT_FOUND_TEXT = '新しい版がまだ見つからない（少し待ってもう一度押す）';
export const RELOAD_TEXT = 'ここでは自動で入れ替えられない。ページを読み直す（ホーム画面の app は閉じて開き直す）';
export const NATIVE_TEXT = 'Android の app は中の版を自分では入れ替えられない。app を作り直して入れ直す';

/* Android の app（Capacitor の中）か。設定の画面（js/screens/settings.js）と同じく window.Capacitor で見る */
export function isNativeApp(g = globalThis) {
  const C = g && g.Capacitor;
  if (!C) return false;
  return typeof C.isNativePlatform === 'function' ? !!C.isNativePlatform() : true;
}

/* 帯が出ている間だけ効く。後から head に足すので、同じ強さの css/space.css より後に効く */
const GUARD_CSS = `
html.has-guard { --safe-t: calc(var(--guard-h, 0px) + var(--strip-h, 0px)); }
html.has-guard .space-strip { top: var(--guard-h, 0px); height: var(--strip-h, 30px); padding-top: 0; }
`;

/* 帯を付ける。戻り値は { bar, paint, place }（paint は状態が変わったときに呼ぶ。sync.on で呼ばれる） */
export function mountSchemaGuard(opts = {}) {
  const doc = opts.document || globalThis.document;
  const api = opts.sync || sync;
  const check = opts.checkForUpdate || checkForUpdate;
  const apply = opts.applyUpdate || applyUpdate;
  const native = 'native' in opts ? !!opts.native : isNativeApp();
  const reload = opts.reload || (() => globalThis.location && globalThis.location.reload());
  if (!doc || !doc.body) return null;
  const root = doc.documentElement;
  if (doc.head) {
    const st = doc.createElement('style');
    st.textContent = GUARD_CSS;
    doc.head.appendChild(st);
  }

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
  let reloadMode = false;
  function resetButton() { reloadMode = false; btn.textContent = '今すぐ更新'; btn.disabled = false; }
  btn.addEventListener('click', async () => {
    if (reloadMode) { reload(); return; }
    if (native) { msg.textContent = NATIVE_TEXT; return; }
    btn.disabled = true;
    try {
      const found = await check();
      if (found === null) {
        msg.textContent = RELOAD_TEXT;
        reloadMode = true; btn.textContent = '読み直す'; btn.disabled = false;
        return;
      }
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

  /* 帯の高さだけ上の段を下げる（出ていなければ戻す） */
  function place() {
    if (!root || !root.classList) return;
    const h = bar.hidden ? 0 : Math.ceil((bar.getBoundingClientRect ? bar.getBoundingClientRect().height : 0) || bar.offsetHeight || 0);
    if (h > 0) { root.style.setProperty('--guard-h', h + 'px'); root.classList.add('has-guard'); }
    else { root.classList.remove('has-guard'); root.style.removeProperty('--guard-h'); }
  }
  /* 幅が変わって字が折り返すと帯の高さが変わる */
  if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(bar);
  else if (typeof addEventListener === 'function' && doc === globalThis.document) addEventListener('resize', place);

  function paint() {
    const on = !!api.outdated();
    if (on && bar.hidden) { msg.textContent = OUTDATED_TEXT; resetButton(); }
    bar.hidden = !on;
    bar.style.display = on ? 'flex' : 'none';
    place();
  }
  api.on(paint);
  paint();
  return { bar, paint, place };
}

/* 画面で読まれたら、すぐ付ける */
if (typeof document !== 'undefined' && document.body && !globalThis.__BUBBLES_NO_AUTO_MOUNT__) mountSchemaGuard();
