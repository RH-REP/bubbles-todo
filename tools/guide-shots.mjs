/* 使い方の記事（docs/guide/）のスクリーンショットを撮り直す（2026-10-24）。開発補助。
   画面を直したら、これで全部を同じ条件で撮り直す（手で撮ると、状態と大きさがずれる）。

     node tools/guide-shots.mjs                 # docs/guide/img/*.jpg を上書きする
     CHROME=/path/to/chrome node tools/guide-shots.mjs

   することは:
     1. 試し用の置き場（一時フォルダ）で server.py を公開の形（--auth passkey）で起動し、招待コードを2つ作る
        （住所は http://localhost:<port>。パスキーは localhost なら http でも使える）
     2. headless の Chrome を DevTools の口つきで起動し、画面を 375×812 にする（スマホの大きさ）
     3. 試し用の記録を入れ、画面を順に開いて撮る（480px 幅の JPEG）
   本物の記録は使わない（repo は公開）。Node 22 の WebSocket と、標準の child_process だけで動く。 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'guide', 'img');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-guide-'));
const port = await freePort();
const dbg = await freePort();
const origin = `http://localhost:${port}`;
const data = join(tmp, 'data');
const invite = (name, space) => execFileSync('python3', [join(ROOT, 'server.py'), '--data-dir', data, 'invite-add', name, '--space', space])
  .toString().match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
const INV_ME = invite('自分のスマホ', 'me,share');
const INV_MOM = invite('母のスマホ', 'share');
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', data,
  '--auth', 'passkey', '--origin', origin], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--hide-scrollbars', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

/* --- DevTools の口 --- */
let ws, seq = 0;
const waiting = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json();
      const page = list.find(p => p.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* まだ起きていない */ }
    await sleep(200);
  }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const d = JSON.parse(e.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
}
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
  return r.result && r.result.result && r.result.result.value;
}
async function go(path) {
  await send('Page.navigate', { url: origin + path });
  for (let i = 0; i < 50; i++) { await sleep(200); if (await js('return document.readyState === "complete" && !!document.querySelector(".tabbar button")')) break; }
  await sleep(1500);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  writeFileSync(join(OUT, name + '.jpg'), Buffer.from(r.result.data, 'base64'));
  console.log('撮った', name);
}
/* 泡などは click ではなくポインタの出来事で動くので、本物の指のタップ（タッチの出来事）を送る */
async function tap(sel) {
  const pt = await js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('無い: ' + ${JSON.stringify(sel)});
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  const p = [{ x: pt.x, y: pt.y }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const click = sel => js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('無い: ' + ${JSON.stringify(sel)}); e.click();`);
const clickText = text => js(`const e = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error('無い: ' + ${JSON.stringify(text)}); e.click();`);
const setInput = (sel, v) => js(`const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));`);
const toServer = () => js(`const h = [...document.querySelectorAll('#pane-settings h3')].find(e => e.textContent === 'サーバー');
  let s = h.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
  (s || document.scrollingElement).scrollBy(0, h.getBoundingClientRect().top - 100);   /* 見出しを ≡ の段の下に */`);

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch (e) { await sleep(200); } }
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  /* 375×812 を 480px 幅で撮る（1.28 倍） */
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1.28, mobile: true });
  /* 仮のパスキーの置き場（Face ID 済みの端末のつもり） */
  await send('WebAuthn.enable');
  await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* --- 個人（試し用の記録） --- */
  await go('/');
  await js(`localStorage.clear(); localStorage.setItem('bubble_todo_space', 'me');
    const { store } = await import('/js/store.js');
    const P = [[.25,.30],[.70,.38],[.40,.52],[.75,.62],[.28,.70]];
    const add = (n, i, o) => store.add(n, Object.assign({ fx: P[i % 5][0], fy: P[i % 5][1] }, o || {}));
    const a1 = add('歯医者を予約', 0); store.setFirstStep(a1.id, '診察券を出しておく'); store.commitStep(a1.id, { did: '電話番号を調べた', next: '午前中に電話する' });
    const r1 = add('あの論文を読む', 1); const r2 = add('傘を修理に出す', 2); add('写真のバックアップ', 3); const r3 = add('灯油を買う', 4);
    store.setQuadrant(a1.id, 'now'); store.setQuadrant(r1.id, 'grow'); store.setQuadrant(r3.id, 'quick'); store.setQuadrant(r2.id, 'drift');
    const w = add('会議の資料をまとめる', 1); store.setTag(w.id, 'work', true);
    add('洗濯物をたたむ', 0, { today: true }); const m = add('メールの返事', 1, { today: true }); store.start(m.id, null);
    const an = store.addAnchor('歯を磨いたら'); const s = add('ストレッチ', 2); store.setAnchor(s.id, an.id, true);
    const gs = store.gapSlots ? store.gapSlots() : []; const g = add('ポッドキャストを聴く', 3); store.setGap(g.id, true); if (gs[0]) store.setGapSlot(g.id, gs[0].id, true);
    const d = add('牛乳を買う', 4); store.complete(d.id); store.flush();`);
  await go('/');
  await shot('01_sea');
  await setInput('input[aria-label="思いついたことを書く"]', 'カーテンを洗う');
  await sleep(300);
  await shot('02_write');
  await js(`const i = document.querySelector('input[aria-label="思いついたことを書く"]'); i.form ? i.form.requestSubmit() : null;`);
  await sleep(600);
  await tap('[aria-label^="歯医者を予約（タップで真ん中へ）"]');
  await sleep(1500);
  await shot('03_board');
  await clickText('タスク開始');
  await sleep(2500);
  await shot('04_focus');
  await clickText('やめる');
  await sleep(800);
  for (const [scr, name] of [['today', '05_today'], ['plan', '06_plan'], ['gap', '07_gap']]) {
    await click(`.tabbar button[data-screen="${scr}"]`);
    await sleep(1200);
    await shot(name);
  }
  await click('.tabbar button[data-screen="sea"]');
  await sleep(800);
  /* 四つに分けて見る（フィルターの中） */
  await click('.sea-narrow');
  await sleep(300);
  await click('.sea-narrow-row.is-quad');
  await sleep(900);
  await shot('20_quad');
  await click('.sea-gather');
  await sleep(900);
  await click('.menubtn');
  await sleep(900);
  await shot('08_drawer');
  await click('.drawer-close');
  await sleep(600);
  await click('.gearbtn');
  await sleep(900);
  await shot('09_settings');
  await toServer();
  await sleep(300);
  await shot('10_server_empty');
  await setInput('input[aria-label="サーバーの住所"]', 'http://100.64.0.5:8931');
  await clickText('繋ぐ');
  await sleep(500);
  await toServer();
  await shot('11_http_refused');
  await sleep(4500);   /* 知らせが消えるのを待つ */
  /* 住所の欄を空に戻すと、このページのサーバーに形を聞き直して、パスキーの欄が出る */
  await setInput('input[aria-label="サーバーの住所"]', '');
  await sleep(1200);
  await setInput('input[aria-label="招待コード"]', INV_ME);
  await clickText('この端末を登録');
  await sleep(3000);
  await toServer();
  await shot('12_server_connected');
  /* 書き出し・読み込み（CSV）。読み込み方を選ぶ窓は、書き出した CSV をそのまま読ませて出す */
  await js(`const h = [...document.querySelectorAll('#pane-settings h3')].find(e => e.textContent.startsWith('書き出し'));
    let s = h.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    (s || document.scrollingElement).scrollBy(0, h.getBoundingClientRect().top - 100);`);
  await sleep(300);
  await shot('18_csv');
  await js(`const { store } = await import('/js/store.js'); const { toCsv, csvFileName } = await import('/js/csvio.js');
    const h = [...document.querySelectorAll('#pane-settings h3')].find(e => e.textContent.startsWith('書き出し'));
    const inp = h.parentElement.querySelector('input[type=file]'); const dt = new DataTransfer();
    dt.items.add(new File([toCsv(store.exportState(), 'me')], csvFileName('me'), { type: 'text/csv' }));
    inp.files = dt.files; inp.dispatchEvent(new Event('change'));`);
  await sleep(600);
  await shot('19_csv_ask');
  await clickText('やめる');
  await sleep(300);

  /* --- 共有 --- */
  await js(`localStorage.setItem('bubble_todo_space', 'share');`);
  await go('/');
  await js(`const { store } = await import('/js/store.js'); const { sync } = await import('/js/sync.js');
    for (let i = 0; i < 40 && sync.status().state !== 'ok'; i++) await new Promise(r => setTimeout(r, 100));
    const P = [[.3,.32],[.68,.45],[.35,.62]];
    ['週末の買い出し', '旅行の宿を決める', '網戸を直す'].forEach((t, i) => store.add(t, { fx: P[i][0], fy: P[i][1] }));
    await new Promise(r => setTimeout(r, 2500));`);
  await shot('13_share');
  /* 繋がっていないとき: サーバーは止めず、この画面の fetch だけを届かないようにする */
  await js(`window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const { sync } = await import('/js/sync.js'); await sync.syncNow();`);
  await sleep(800);
  await shot('14_share_offline');
  await js(`const { store } = await import('/js/store.js'); store.add('洗剤を買う');`);
  await sleep(500);
  await shot('15_share_blocked');

  /* --- 招かれた人（共有の合言葉だけ） --- */
  await js(`localStorage.clear(); localStorage.setItem('bubble_todo_space', 'share');`);
  await go('/');
  await shot('16_share_join');
  await clickText('設定を開く');
  await sleep(900);
  await toServer();
  await sleep(1200);
  await setInput('input[aria-label="招待コード"]', INV_MOM);
  await clickText('この端末を登録');
  await sleep(3000);
  await toServer();
  await shot('17_invitee_settings');
  console.log('できた:', OUT);
} finally {
  cleanup();
}
process.exit(0);
