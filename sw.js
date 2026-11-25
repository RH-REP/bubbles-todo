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
const VERSION = '2026-11-25i';
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
  './css/screens/period.css',   /* 週・月で見る（リスト表示の形。2026-11-23 Issue #80 の返事） */
  './css/screens/stub.css',
  './css/help.css',       /* ヘルプ画面（2026-11-04 Issue #9） */
  './css/space.css',
  /* 本体（実際に import されている20本＋ feedback.js。todo.js / stub.js は誰も読まない） */
  './js/app.js',
  './js/boot-dvh.js',   /* head で読む（画面の高さに枠を合わせる） */
  './js/boot-sea.js',   /* head で読む（開く海の水の色を先に塗る。Issue #94） */
  './js/boot-edition.js',   /* head で読む（サーバーの有無で index.html と noserver.html の合うほうへ移す。Issue #38） */
  './js/bubble.js',
  './js/calendar.js',
  './js/device.js',     /* この端末の呼び名（Issue #50 で csvio.js から移した） */
  './js/drift.js',
  './js/feedback.js',   /* 画面の !（改善のコメント）。module ではなく普通の script */
  './js/focus.js',
  './js/ai.js',          /* Anthropic を呼ぶ薄い層（2026-11-04 Issue #9） */
  './js/edition.js',     /* どちらの版か・AI を出すか（2026-11-17 Issue #78） */
  './js/aikey.js',       /* AI のキーに鍵をかけて置く（2026-11-13 Issue #14） */
  './js/help.js',        /* ヘルプ画面（同上） */
  './js/events.js',      /* 先の予定の計算（2026-11-04 Issue #13） */
  './js/upcoming.js',    /* 先の予定の板（同上） */
  './js/research.js',    /* 本文の面の AI で調べる・整理（2026-11-05 Issue #17） */
  './js/screens/cardlist.js',
  './js/screens/gap.js',
  './js/screens/plan.js',
  './js/screens/review.js',
  './js/periodview.js',         /* 週・月で見る（リスト表示の形。2026-11-23 Issue #80 の返事） */
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
  './js/glow.js',     /* 輝く泡（2026-11-24） */
  './js/swim.js',     /* 泳ぐ生き物（クラゲ・カメ。2026-11-25 Issue #96） */
  './js/priority.js',
  './js/quadview.js',
  './js/deadline.js',      /* 日付で見る（2026-11-07 Issue #24） */
  './js/deadlineview.js',
  './js/holiday.js',       /* 日本の祝日（日付で見るの色分け） */
  './js/weather.js',       /* 天気（日付で見るの列の見出し。2026-11-08 Issue #30） */
  './js/notes.js',         /* 泡ごとのひとこと（2026-11-07 Issue #25） */
  './js/notesign.js',      /* ひとこと 1 件ずつの署名（2026-11-14 Issue #61） */
  './js/suggest.js',       /* 今日のおすすめ（2026-11-07 Issue #12） */
  './js/movefile.js',      /* 引っ越しのファイル（2026-11-07 Issue #19） */
  './js/chain.js',         /* ブロックチェーンへの控え（2026-11-08 Issue #31） */
  './js/asktext.js',       /* 合言葉・復元コードを打つ欄（2026-11-13 Issue #53） */
  './js/chainwatch.js',    /* ほかの端末の新しい控えの知らせ（2026-11-13 Issue #52） */
  './js/board.js',         /* 共有の海（ブロックチェーンの掲示板。2026-11-11 Issue #37） */
  './js/p2p.js',           /* 端末どうしの直の通信（2026-11-11 Issue #37） */
  './js/prefs.js',         /* この端末の表示（2026-11-10 Issue #36） */
  './js/repeat.js',        /* くりかえしの日付の計算（2026-11-19） */
  './js/monthcal.js',      /* 盤の暦（2026-11-19） */
  './js/serverbackup.js',  /* サーバーのバックアップ（2026-11-19） */
  './js/localmod.js',      /* 見た目と言葉を AI に頼んで変える（2026-11-21 Issue #91） */
  './js/version.js',
  './js/sync.js',
  './js/me.js',          /* ログインしている利用者と海の仲間（2026-11-18） */
  './js/seaadmin.js',    /* 海の管理（持ち主）・わたしの端末（2026-11-18） */
  './js/movesea.js',     /* 泡を別の海へ移す（2026-11-18） */
  './js/userchip.js',    /* 左上の利用者のアイコンと利用者の札（2026-11-18） */
  './js/apps.js',        /* 3 つの app の住所の根（2026-11-18） */
  './js/jump.js',        /* jump（#sea=&todo=・盤の飛び先。2026-11-18） */
  './js/loginflow.js',   /* ログインの仕上げ・ログアウト（個人の海は 1 つ。2026-11-18） */
  './js/appbundles.js',  /* 引っ越しのファイルで日記の束を運ぶ（取り決め §8.3。2026-11-18） */
  './js/schemaguard.js',   /* 古い版の帯（2026-11-10 共有の記録 v1.1） */
  './js/folderbackup.js', /* 決めたフォルダに自動で控える（2026-11-12） */
  './js/localbackup.js',  /* この端末の中に自動でバックアップを残す（2026-11-21 Issue #83） */
  './js/regions.js',      /* 海域の一覧（2026-11-12） */
  './js/oneserver.js',     /* サーバーは1つ（2026-11-16） */
  './js/oneserver-boot.js',
  './js/screens/seapanel.js',
  './js/ui.js',
  './js/undo.js',     /* 取り消しの積み重ね（2026-11-07 Issue #22） */
  './js/related.js',  /* 似ている泡を近くへ寄せる（2026-11-07 Issue #23） */
  './js/update.js',   /* 設定の「最新の版を確認する」（2026-11-02） */
  './js/rollback.js', /* 前の版に戻す（2026-11-07 Issue #21）。head でも読む */
  './js/reset.js',    /* 設定の「すべて初期化」（2026-11-08 Issue #32） */
  /* アイコン */
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* 取れなくてもよいもの（2026-11-12）。サーバーなし版（noserver.html。前の名前は solo.html）の入口は、server.py が配らない
   （PUBLIC_FILES に無い。サーバーのページはサーバーなし版へ移さないため）。
   前はこれも ASSETS に入れていて、server.py から開いたページでは addAll ごと失敗し、
   service worker が入らなかった（2026-11-08 の 3f060cd から。「最新の版を確認する」が「確認できない」になった）。
   ここに置いたものは1つずつ取り、取れたものだけ箱に入れる。ASSETS は全部が server.py から取れること
   （tests/test_server.py の test_sw_assets_are_all_served が見る） */
const OPTIONAL = [
  './noserver.html',      /* サーバーなし版の入口（2026-11-08 Issue #31。2026-11-13 Issue #51 で solo.html から名前を変えた） */  './manifest-solo.json',
];

/* ---- 更新を止める（2026-11-21 Issue #91。js/update.js の holdUpdates）----
   設定の「新しい版に自動で入れ替えない」をオンにすると、印 __update_hold が箱 bubbles-meta に置かれる。
   そのとき新しい sw.js（この版より後の版）は、入るのをやめる（install を失敗させる。ブラウザは次の確認でまた試す）。
   やめる前に、届いた版の名前を __update_held に残す（設定に「新しい版 v… がある」と出すため）。
   ・はじめての登録（今動いている版が無い）は止めない
   ・設定の「最新の版を確認する」を押したときは、印 __update_allow（10 分だけ効く）を置いてから確かめるので、その1回は入る
   ローカルの変更（js/localmod.js）を、新しい版に知らないうちに替えられないようにするため */
const HOLD_PATH = '__update_hold';
const HELD_PATH = '__update_held';
const ALLOW_PATH = '__update_allow';
const ALLOW_MS = 10 * 60 * 1000;
function metaUrl(p) { return new URL(p, self.registration.scope).href; }
async function holdingNow() {
  if (!self.registration || !self.registration.active) return false;
  try {
    const meta = await caches.open(RB.META_CACHE);
    if (!(await meta.match(metaUrl(HOLD_PATH)))) return false;
    const allow = await meta.match(metaUrl(ALLOW_PATH));
    if (allow) {
      const a = await allow.json().catch(() => null);
      await meta.delete(metaUrl(ALLOW_PATH));   /* 1回だけ効く */
      if (a && Date.now() - Number(a.at || 0) < ALLOW_MS) return false;
    }
    await meta.put(metaUrl(HELD_PATH), new Response(JSON.stringify({ v: VERSION, at: Date.now() }),
      { headers: { 'Content-Type': 'application/json' } }));
    return true;
  } catch (e) { return false; }   /* 印を読めないときは止めない（いつもどおり入る） */
}

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    if (await holdingNow()) throw new Error('更新を止めている（設定の「新しい版に自動で入れ替えない」）');
    const box = await caches.open(CACHE);
    /* cache: 'reload' で端末の HTTP キャッシュを飛ばす。ここで古いものを掴むと、箱ごと古いまま固まる。
       2026-11-24（Issue #96。2 度、新しい CSS と古い JS が混ざって届いた）：配信の途中の写し（GitHub Pages の CDN など。
       ファイルごとに数分古いことがある）は cache: 'reload' では飛ばせないので、住所に ?v=版 を付けて取る
       （写しは住所ごとに持つので、新しい住所は元から取り直される）。箱には ?v= の無い住所で入れる
       （取り出しは ignoreSearch で引き、入口の './index.html' もそのまま引ける）。1 つでも取れなければ入れ替えない（addAll と同じ） */
    const bust = (u) => u + (u.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(VERSION);
    /* 2026-11-25（利用者の指示「最新の版を確認しても、11-24 version になる。サーバーは 0dbdc7a」）：
       公開のサーバー（Caddy の後ろ）へ約 100 本を一度に取りに行くと、ときどき何本かが返事のないまま止まり、
       install が終わらず（installing のまま）古い版に残っていた（headless の Chrome で、一度に取ると 15 秒待っても来ないものが 2〜30 本。
       curl で同じ数を取ると全部 200 なので、止まるのは一度に多く取ったときだけ）。
       そこで、一度に取るのを TAKE_LIMIT 本までにし、1 本ごとに TAKE_MS で打ち切って、TAKE_TRIES 回まで取り直す。
       打ち切りは中身を読み切るまで効かせる（返事の頭だけ来て中身が止まることもあるため）。 */
    const TAKE_LIMIT = 6, TAKE_MS = 20000, TAKE_TRIES = 3;
    const take = async (u) => {
      let last = null;
      for (let i = 0; i < TAKE_TRIES; i++) {
        if (i) await new Promise((r) => setTimeout(r, 800 * i));
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), TAKE_MS);
        try {
          const res = await fetch(new Request(bust(u), { cache: 'reload', signal: ctl.signal }));
          if (!res.ok) {
            last = new Error('取れなかった: ' + u + ' ' + res.status);
            /* 読まない中身は捨てる。捨てないと Chrome は接続を返さず、HTTP/1 の 1 つの宛先に 6 本の枠が埋まると、
               あとの取り込みが送られずに止まる（server.py を直に開いたとき、OPTIONAL の 404 のあとで install が止まった） */
            try { if (res.body) await res.body.cancel(); } catch (e) { /* 捨てられなくても進む */ }
            if (res.status === 404) break;   /* 無いものは取り直しても無い */
            continue;
          }
          const body = await res.blob();
          return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
        } catch (e) {
          last = e;
        } finally {
          clearTimeout(tm);
        }
      }
      throw last || new Error('取れなかった: ' + u);
    };
    /* list を TAKE_LIMIT 本ずつ並べて fn に通す。並びは list のまま返す */
    const pool = async (list, fn) => {
      const out = new Array(list.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(TAKE_LIMIT, list.length) }, async () => {
        while (next < list.length) { const k = next++; out[k] = await fn(list[k]); }
      }));
      return out;
    };
    try {
      const got = await pool(ASSETS, async (u) => [u, await take(u)]);
      await Promise.all(got.map(([u, res]) => box.put(new Request(u), res)));
    } catch (e) {
      await caches.delete(CACHE);   /* 半端な箱を残さない（次の install でまた全部取る） */
      throw e;
    }
    await pool(OPTIONAL, async (u) => {
      try {
        const res = await take(u);
        await box.put(new Request(u), res);
      } catch (e) { /* 取れなければ箱に入れないだけ（網から開く） */ }
    });
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
    /* 入ったので「新しい版がある」の印は外す（Issue #91） */
    try { await (await caches.open(RB.META_CACHE)).delete(metaUrl(HELD_PATH)); } catch (e) { /* 無ければよい */ }
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
