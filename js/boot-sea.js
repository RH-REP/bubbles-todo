/* 開く海の水の色を、CSS より前に塗る（2026-11-23 Issue #94「海切り替えの高速化」）。index.html・noserver.html の head で読む。
   （ページの中に直書きしない。配るときの CSP が script-src 'self' のため）

   海の色は js/space.js が塗るが、space.js は module（app.js から読む）なので、その前に一度
   空色（個人の色）の画面が描かれていた。海を切り替えると「前の海 → 空色 → 新しい海」と色が挟まり、遅く見えた。
   そこで space.js が残した「どの海を・何色で塗ったか」（bubble_todo_sea_paint）を読み、
   開く海（bubble_todo_space）と同じなら、その色をここで先に付ける。違えば何もしない（space.js があとで塗る）。
   付けるのは html の印（has-strip・is-sea・data-sea）だけ。正しい値は space.js が付け直す。 */
(function () {
  try {
    var raw = localStorage.getItem('bubble_todo_sea_paint');
    if (!raw) return;
    var got = JSON.parse(raw);
    var open = localStorage.getItem('bubble_todo_space') || 'me';
    if (!got || got.id !== open || typeof got.paint !== 'string') return;
    var root = document.documentElement;
    root.classList.add('has-strip');
    if (got.paint === 'me') return;
    if (got.paint.indexOf('sea:') !== 0) return;
    root.classList.add('is-sea');
    var color = got.paint.slice(4);
    if (/^[a-z]{1,16}$/.test(color)) root.setAttribute('data-sea', color);
  } catch (e) { /* 塗れなくても space.js が塗る */ }
})();
