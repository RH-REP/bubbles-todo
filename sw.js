/* オフラインで開くための service worker。

   ■ なにをするか

   起動に要るファイルを**まるごと1つの箱（キャッシュ）に入れて**、
   次からはそこから出す。電波が無くても開く。

   ■ なぜ「その場で取ってきて、あれば古いのを出す」ではないのか

   このアプリは素の ES module が16本、互いを import し合っている。
   1本だけ新しく、ほかが古い、という混ざり方をすると、
   「ある関数が無い」で落ちる。**箱ごと入れ替える**なら、その混ざりが起きない。

   だから：
     入れるとき（install）… VERSION の箱を作り、全部を**取り直して**入れる
     切り替え（activate）… 古い箱を消す。以後どの取得もこの箱から出る
     取り出し（fetch）  … 箱にあればそれ。無ければ網へ（同一オリジンの GET だけ）

   ■ 新しい版はいつ効くか

   **次に開いたとき。**開いている間は入れ替えない（走っている module を
   足元から差し替えないため）。skipWaiting() は呼んでいない。
   ホーム画面のアプリを閉じて開き直せば新しくなる。

   ■ 直したら VERSION を上げること

   ここを上げないと、箱が作り直されない＝**利用者にはいつまでも古い版が出る**。
   ファイルを足したときは ASSETS にも足す（足し忘れたものは、
   網が無いときだけ取れない——ふだんは動いてしまうので気づきにくい）。 */

const VERSION = '2026-09-03a';
const CACHE = 'bubbles-' + VERSION;

const ASSETS = [
  /* 入口。'./' と index.html は別の URL として引かれるので、両方入れる */
  './',
  './index.html',
  './manifest.json',
  /* 見た目 */
  './css/base.css',
  './css/bubble.css',
  './css/focus.css',
  './css/screens/sea.css',
  './css/screens/today.css',
  './css/screens/plan.css',
  './css/screens/gap.css',
  './css/screens/review.css',
  './css/screens/stub.css',
  /* 本体（実際に import されている16本。todo.js / stub.js は誰も読まない） */
  './js/app.js',
  './js/bubble.js',
  './js/calendar.js',
  './js/drift.js',
  './js/focus.js',
  './js/screens/cardlist.js',
  './js/screens/gap.js',
  './js/screens/plan.js',
  './js/screens/review.js',
  './js/screens/sea.js',
  './js/screens/settings.js',
  './js/screens/today.js',
  './js/seamap.js',
  './js/sound.js',
  './js/store.js',
  './js/ui.js',
  /* アイコン */
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const box = await caches.open(CACHE);
    /* cache: 'reload' で HTTP キャッシュを飛ばす。
       ここで古いものを掴むと、箱ごと古いまま固まる */
    await box.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n.startsWith('bubbles-') && n !== CACHE) ? caches.delete(n) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  ev.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      /* 網が無くて箱にも無い。画面遷移なら入口を返す（真っ白にしない） */
      if (req.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      throw err;
    }
  })());
});
