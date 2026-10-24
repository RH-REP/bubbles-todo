/* dvh を知らないブラウザ（Android の Chrome 107 まで・WebView 103）だけ、実際の画面の高さを --app-h に入れる。
   100vh はアドレスバーを隠したときの高さなので、そのままだと下のタブが画面の外に出る（css/base.css .app）。
   index.html の head で、CSS より前に読む（2026-10-24 にページの中から移した。CSP の script-src 'self' のため） */
(function () {
  if (window.CSS && CSS.supports && CSS.supports('height', '100dvh')) return;
  var root = document.documentElement;
  function fit() { root.style.setProperty('--app-h', window.innerHeight + 'px'); }
  root.classList.add('no-dvh');
  fit();
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
})();
