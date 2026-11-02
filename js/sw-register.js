/* service worker を登録する（sw.js を見よ）。index.html の末尾で読む。
   2026-10-24 にページの中から移した（配るときの CSP が script-src 'self' で、直書きのスクリプトを止めるため）

   ■ 前面に戻ったときに新しい版を取りに行く（2026-11-02。Issue #6）
   iOS のホーム画面アプリは、閉じて開き直しても裏で凍結されたまま戻ることがあり、
   そのとき service worker の更新確認そのものが走らない（WebKit の既知の挙動）。
   そこで、画面が前面に戻るたび（visibilitychange → visible）に reg.update() を呼び、
   新しい sw.js があれば**取ってきて待機させておく**。
   ・入れ替え（skipWaiting）はしない。走っている module を足元から差し替えない決めごとはそのまま。
     待機中の版は次に本当に開いたとき、または設定の「最新の版を確認する」で効く
   ・網を叩きすぎないよう、10分に1回まで（UPDATE_GAP_MS）
   ・失敗（網が無いなど）は黙って捨てる */
const UPDATE_GAP_MS = 10 * 60 * 1000;

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        let last = Date.now();   /* register 自身が今いちど確認している */
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          if (Date.now() - last < UPDATE_GAP_MS) return;
          last = Date.now();
          reg.update().catch(() => { /* 網が無ければ次の機会に */ });
        });
      })
      .catch(() => { /* 登録できなくても、アプリは網から動く */ });
  });
}
