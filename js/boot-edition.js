/* 入口を1つにする（2026-11-11 Issue #38。「solo.html をまとめられる？」）。
   index.html と solo.html の head の先頭で読む（module ではない普通の script。CSP が script-src 'self' のため直書きしない）。

   中身は1つの app で、違いは通信してよい先の決め打ち（solo.html の <meta> の CSP）だけ。
   <meta> の CSP は読み込みの時点で決まるので、1つのページの中では切り替えない。代わりに、開いたときに合うほうへ移す:
     ・index.html … サーバーに繋いでいない、かつ、このページを配っているのがサーバーではない
                     （GitHub Pages・Android の app）なら、solo.html へ移す
     ・solo.html  … サーバーに繋いでいれば index.html へ移す（solo.html はサーバーに繋がらない）
   サーバー（server.py）が配っているページは、そのサーバーに繋ぐ欄を出すので、移さない。
   solo.html の設定の「サーバーに繋ぐ」で index.html を開いたときは、その窓の間だけ移さない（STAY）。
   ホーム画面に置いたものも、どちらから開いても同じ記録（同じオリジンの localStorage）を見る。 */
(function () {
  var SYNC_KEY = 'bubble_todo_sync';            /* js/sync.js の CONF_KEY */
  var STAY_KEY = 'bubble_todo_edition_stay';    /* js/screens/settings.js の soloServerBox が書く */
  try {
    var solo = !!document.querySelector('meta[name="bubbles-edition"][content="solo"]');
    /* どれかのサーバーの海域に住所があれば「サーバーあり」（2026-11-12 海域。js/regions.js の anyServerUrl と同じ見方） */
    var hasUrl = function (key) {
      var c = null;
      try { c = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { c = null; }
      return !!(c && typeof c.url === 'string' && c.url);
    };
    var hasServer = hasUrl(SYNC_KEY);
    var regions = null;
    try { regions = JSON.parse(localStorage.getItem('bubble_todo_regions') || 'null'); } catch (e) { regions = null; }
    if (!hasServer && regions && regions.length) {
      for (var i = 0; i < regions.length; i++) {
        var r = regions[i];
        if (!r || r.alive === 0 || r.id === 'local' || !/^r[0-9a-z]{1,23}$/.test(String(r.id))) continue;
        if (hasUrl(r.legacyConf ? SYNC_KEY : SYNC_KEY + '_' + r.id)) { hasServer = true; break; }
      }
    }
    var noOwnServer = !!window.Capacitor || /github\.io$/.test(location.hostname);
    var stay = false;
    try { stay = sessionStorage.getItem(STAY_KEY) === 'server'; } catch (e) { stay = false; }
    var to = null;
    if (solo && hasServer) to = 'index.html';
    else if (!solo && !hasServer && noOwnServer && !stay) to = 'solo.html';
    if (to) location.replace(to + location.search + location.hash);
  } catch (e) { /* 移せなくても、開いたページのまま動く */ }
})();
