/* 画面の高さに、アプリの枠（.app）を合わせる。index.html の head で、CSS より前に読む。
   （ページの中に直書きしない。配るときの CSP が script-src 'self' のため）

   ■ 1. dvh を知らないブラウザ（Android の Chrome 107 まで・WebView 103）
   100vh はアドレスバーを隠したときの高さなので、そのままだと下のタブが画面の外に出る。
   だから最初から実際の画面の高さ（innerHeight）を --app-h に入れる（html.no-dvh。css/base.css）。

   ■ 2. dvh を知っているブラウザでも、はみ出したら合わせる（2026-10-25）
   ホーム画面のアイコンから立ち上げた直後に、下のタブが隠れ、開き直すと直った（利用者の Android）。
   立ち上げの途中で画面の高さが変わり、それを拾えていないとみる（推定。実機の値は下の記録で見る）。
   そこで、立ち上げ後に何度か（すぐ・少し後・画面に戻ったとき・大きさが変わったとき）測り、
   ページが画面より高ければ（はみ出していれば）、そこからは実際の高さを使う（html.fit-js）。

   ■ 記録
   測った値を window.__bubblesSize に残す（設定の画面の下の「画面の大きさの記録」で見て、写せる）。
   値は大きさだけで、記録の中身は入らない。 */
(function () {
  var root = document.documentElement;
  var t0 = Date.now();
  var log = [];
  window.__bubblesSize = log;
  var noDvh = !(window.CSS && CSS.supports && CSS.supports('height', '100dvh'));
  if (noDvh) root.classList.add('no-dvh');

  function setH() { root.style.setProperty('--app-h', window.innerHeight + 'px'); }

  function sample(why) {
    var vv = window.visualViewport;
    log.push({
      t: Date.now() - t0, why: why,
      inner: window.innerHeight, vv: vv ? Math.round(vv.height) : null,
      client: root.clientHeight, page: root.scrollHeight, screen: window.screen ? window.screen.height : null,
      mode: root.classList.contains('fit-js') ? 'fit-js' : (noDvh ? 'no-dvh' : 'dvh'),
      standalone: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    });
    if (log.length > 40) log.shift();
  }

  function check(why) {
    if (noDvh || root.classList.contains('fit-js')) setH();
    else if (document.body && root.scrollHeight > window.innerHeight + 1) {
      /* はみ出している。ここからは実際の高さに合わせ続ける */
      root.classList.add('fit-js');
      setH();
    }
    sample(why);
  }

  if (noDvh) setH();
  sample('start');
  window.addEventListener('resize', function () { check('resize'); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { check('vv-resize'); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { check('orientation'); }, 300); });
  window.addEventListener('pageshow', function () { check('pageshow'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check('visible'); });
  window.addEventListener('load', function () {
    check('load');
    /* 立ち上げの途中で高さが落ち着くのを待って、何度か見直す */
    [100, 400, 1000, 2500].forEach(function (ms) { setTimeout(function () { check('+' + ms + 'ms'); }, ms); });
  });
})();
