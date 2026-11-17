/* どちらの版か（2026-11-17 Issue #78「サーバーあり版の機能を減らす」）。
   サーバーなし版（noserver.html）は head に <meta name="bubbles-edition" content="solo"> を持つ。
   サーバーあり版（index.html）では、ブロックチェーン・直の通信（WebRTC）・AI の機能と、その設定を出さない。
   DOM の無い所（テストの Node）では、サーバーなし版として扱う（前からの働きをそのまま試せるように） */
export function isSolo() {
  try {
    if (typeof document === 'undefined') return true;
    return !!document.querySelector('meta[name="bubbles-edition"][content="solo"]');
  } catch (e) { return false; }
}

/* AI の機能（ヘルプの AI に訊く・盤の AI で調べる／整理／名前・今日の AI で選び直す・表示を AI に頼む・先の予定・
   改善のコメントの AI で題名）を出すか。サーバーなし版だけ（Issue #78 の返事「AI機能と設定の関連を削除して」） */
export function aiOn() { return isSolo(); }
