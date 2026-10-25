/* service worker を登録する（sw.js を見よ）。index.html の末尾で読む。
   2026-10-24 にページの中から移した（配るときの CSP が script-src 'self' で、直書きのスクリプトを止めるため） */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .catch(() => { /* 登録できなくても、アプリは網から動く */ });
  });
}
