/* すべて初期化（2026-11-08 Issue #32）。
   この端末に app が置いたものを、設定も含めて全部消す。

   app が端末（localStorage）に置くものは、どれも名前が 'bubble_todo' で始まる：
   海ごとの記録の箱・海の一覧・開いている海・サーバーの住所と合言葉・パスキーの入場・
   登録の頼み・音・似ている泡・AI のキーと型・先の予定・天気・チェーンの控えの設定・
   前の版に戻すときの写し・人を切り替える前の控え・端末の呼び名。
   だから「頭が 'bubble_todo' のもの」を消せば、初めて開いたときと同じになる。

   消さないもの：
   - 画面の「!」が覚えているエラーの記録（'feedback.errors'。改善の報告に添える記録で、設定ではない）
   - app 本体の写し（service worker の箱）。これは記録ではなく app そのもの
   - サーバーに置いた記録・ブロックチェーンに書いた控え（この端末の外にある。ここからは消さない）

   この file は DOM を知らない（tests/reset.test.mjs が偽の localStorage で確かめる）。 */

export const PREFIX = 'bubble_todo';

/* app が置いたキーの一覧 */
export function appKeys(ls) {
  const out = [];
  if (!ls) return out;
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (typeof k === 'string' && k.indexOf(PREFIX) === 0) out.push(k);
  }
  return out;
}

/* app が置いたキーを全部消す。戻り値 消した数。
   消しながら数え直すと番号がずれるので、先に一覧を取ってから消す */
export function clearAppStorage(ls) {
  const keys = appKeys(ls);
  keys.forEach(k => { try { ls.removeItem(k); } catch (e) { /* 消せなくても残りは進める */ } });
  return keys.length;
}

/* 押してよい合図の字。打ち間違いで通らないよう、前後の空白だけ許す */
export const CONFIRM_WORD = '初期化';
export function confirmed(text) {
  return String(text == null ? '' : text).trim() === CONFIRM_WORD;
}
