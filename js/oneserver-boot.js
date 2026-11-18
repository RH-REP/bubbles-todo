/* 開いたときに1回、サーバーを1つにまとめる（js/oneserver.js の consolidate）。
   app.js の最初の import に置く。store.js・sync.js が開く海と繋ぎ先を読む前に済ませるため（2026-11-16）。
   続けて、前の版のうちにログインしていた端末の個人を 1 つにする（bootUnify。2026-11-18「個人と個人（サーバー）が混在している」）。
   ここでは store.js を読まない（読むと、まとめる前の海を開いてしまう）。知らせは js/loginflow.js の AFTER_KEY と同じ箱に置き、app.js が出す */
import { consolidate, bootUnify } from './oneserver.js';

try { consolidate(); } catch (e) { /* まとめられなくても、今までどおり開く */ }
try {
  const n = bootUnify();
  if (n !== 0) {
    sessionStorage.setItem('bubble_todo_after_login', n > 0
      ? 'この端末の個人の泡 ' + n + ' 件を、サーバーの個人に合わせた（個人は 1 つ。前の中身は設定の「記録」の控えに残した）'
      : '個人を 1 つにまとめた（前の中身は設定の「記録」の控えに残した）');
  }
} catch (e) { /* 合わせられなくても開く。次に開いたときにまた試す */ }
