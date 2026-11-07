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

   ■ 前の版に戻す（2026-11-07。Issue #21。js/rollback.js を見よ）

   activate で消すのは「今の版と、その1つ前の版」より古い箱だけ。1つ前の箱は、
   設定の「前の版に戻す」で使う。戻している印（bubbles-meta の __rollback_pin）があれば、
   その版の箱から出し、index.html の head の先頭に帯（js/rollback.js）を差し込み、
   サーバーへの書き込み（/api/ への GET 以外）を 503 で止める。
   新しい版が activate したら印は外す。
   箱を残すので、取り出しは**今の版の箱だけ**から引く（caches.match だと古い箱のものが混ざる）。

   ■ 直したら VERSION を上げること

   ここを上げないと、箱が作り直されない＝**利用者にはいつまでも古い版が出る**。
   ファイルを足したときは ASSETS にも足す（足し忘れたものは、
   網が無いときだけ取れない——ふだんは動いてしまうので気づきにくい）。 */

/* 直したら上げる。上げないと利用者には古い版が出続ける。
   画面の左上にも出すので、js/version.js も同じ値にする（tests/version.test.mjs が見る） */
const VERSION = '2026-11-07g';
const CACHE = 'bubbles-' + VERSION;

/* previousVersion・injectScript・META_CACHE・PIN_PATH（前の版に戻す。Issue #21） */
importScripts('./js/rollback.js');
const RB = self.BubblesRollback;

const ASSETS = [
  /* 入口。'./' と index.html は別の URL として引かれるので、両方入れる */
  './',
  './index.html',
  './manifest.json',
  /* 見た目 */
  './css/base.css',
  './css/bubble.css',
  './css/focus.css',
  './css/quad.css',
  './css/deadline.css',  /* 日付で見る（2026-11-07 Issue #24） */
  './css/screens/sea.css',
  './css/screens/today.css',
  './css/screens/plan.css',
  './css/screens/gap.css',
  './css/screens/review.css',
  './css/screens/stub.css',
  './css/help.css',       /* ヘルプ画面（2026-11-04 Issue #9） */
  './css/space.css',
  /* 本体（実際に import されている20本＋ feedback.js。todo.js / stub.js は誰も読まない） */
  './js/app.js',
  './js/boot-dvh.js',   /* head で読む（画面の高さに枠を合わせる） */
  './js/bubble.js',
  './js/calendar.js',
  './js/csvio.js',
  './js/drift.js',
  './js/feedback.js',   /* 画面の !（改善のコメント）。module ではなく普通の script */
  './js/focus.js',
  './js/ai.js',          /* Anthropic を呼ぶ薄い層（2026-11-04 Issue #9） */
  './js/help.js',        /* ヘルプ画面（同上） */
  './js/events.js',      /* 先の予定の計算（2026-11-04 Issue #13） */
  './js/upcoming.js',    /* 先の予定の板（同上） */
  './js/research.js',    /* 本文の面の AI で調べる・整理（2026-11-05 Issue #17） */
  './js/screens/cardlist.js',
  './js/screens/gap.js',
  './js/screens/plan.js',
  './js/screens/review.js',
  './js/screens/sea.js',
  './js/screens/settings.js',
  './js/screens/today.js',
  './js/seamap.js',
  './js/merge.js',
  './js/passkey.js',
  './js/sw-register.js',
  './js/sound.js',
  './js/space.js',
  './js/spacelist.js',
  './js/store.js',
  './js/priority.js',
  './js/quadview.js',
  './js/deadline.js',      /* 日付で見る（2026-11-07 Issue #24） */
  './js/deadlineview.js',
  './js/notes.js',         /* 泡ごとのひとこと（2026-11-07 Issue #25） */
  './js/movefile.js',      /* 引っ越しのファイル（2026-11-07 Issue #19） */
  './js/version.js',
  './js/sync.js',
  './js/ui.js',
  './js/undo.js',     /* 取り消しの積み重ね（2026-11-07 Issue #22） */
  './js/related.js',  /* 似ている泡を近くへ寄せる（2026-11-07 Issue #23） */
  './js/update.js',   /* 設定の「最新の版を確認する」（2026-11-02） */
  './js/rollback.js', /* 前の版に戻す（2026-11-07 Issue #21）。head でも読む */
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
    /* 今の版と、1つ前の版（前の版に戻す用）だけ残す */
    const prev = RB.previousVersion(names.filter((n) => n !== CACHE), VERSION);
    const keep = [CACHE, RB.META_CACHE].concat(prev ? ['bubbles-' + prev] : []);
    await Promise.all(names.map((n) => (n.startsWith('bubbles-') && keep.indexOf(n) < 0) ? caches.delete(n) : null));
    /* 新しい版が届いたら、戻している印は外す（直した版が届いたとみる） */
    try { await (await caches.open(RB.META_CACHE)).delete(pinUrl()); } catch (e) { /* 無ければよい */ }
    pinMemo = undefined;
    await self.clients.claim();
  })());
});

/* ---- 前の版に戻している印（Issue #21） ---- */
function pinUrl() { return new URL(RB.PIN_PATH, self.registration.scope).href; }
let pinMemo;   /* undefined = まだ読んでいない。画面遷移のたびに読み直す */
async function readPin(fresh) {
  if (pinMemo !== undefined && !fresh) return pinMemo;
  let pin = null;
  try {
    const hit = await (await caches.open(RB.META_CACHE)).match(pinUrl());
    const got = hit ? await hit.json() : null;
    if (got && typeof got.to === 'string' && got.to !== VERSION && await caches.has('bubbles-' + got.to)) pin = got.to;
  } catch (e) { pin = null; }
  pinMemo = pin;
  return pin;
}

/* 設定の「最新の版を確認する」（js/update.js）から、押した人だけが頼める入れ替え。
   ふだんは呼ばない skipWaiting() を、この頼みが来たときだけ呼ぶ（2026-11-02）。
   走っている module を足元から差し替えないという元の決めごとは、
   「押した人が納得のうえでページを読み直す」ことで引き受ける。 */
self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  const isApi = url.pathname.includes('/api/');
  /* 前の版を使っている間は、サーバーへ書き込まない（よそのオリジンのサーバーも）。
     前の版は新しい版で足した欄を落として保存するので、それをほかの端末へ広げない */
  if (req.method !== 'GET' && isApi && pinMemo !== null) {
    /* pinMemo が undefined なのは、service worker が起こし直されてまだ印を読んでいないとき。読んでから決める */
    ev.respondWith((async () => {
      if (await readPin()) {
        return new Response(JSON.stringify({ error: '前の版を使っている間はサーバーへ送らない（上の帯の「最新に戻る」で戻す）' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return fetch(req);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  /* 記録の出し入れ（server.py の /api/）は箱に入れない。いつも網へ */
  if (isApi) return;

  ev.respondWith((async () => {
    const pin = await readPin(req.mode === 'navigate');
    if (pin) {
      const old = await (await caches.open('bubbles-' + pin)).match(req, { ignoreSearch: true });
      if (old) {
        if (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname)) {
          const html = RB.injectScript(await old.text(), pin, VERSION);
          const h = new Headers(old.headers);
          h.delete('Content-Length');
          return new Response(html, { status: old.status, statusText: old.statusText, headers: h });
        }
        return old;
      }
      /* 前の版の箱に無いもの（js/rollback.js など）は、今の版の箱から */
    }
    const box = await caches.open(CACHE);
    const hit = await box.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      /* 網が無くて箱にも無い。画面遷移なら入口を返す（真っ白にしない） */
      if (req.mode === 'navigate') {
        const home = await box.match('./index.html');
        if (home) return home;
      }
      throw err;
    }
  })());
});
