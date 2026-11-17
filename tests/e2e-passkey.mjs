/* パスキーの通しのテスト（公開の形。2026-10-24）。本物の Chrome と、Chrome の仮のパスキーで確かめる。

     node tests/e2e-passkey.mjs
     CHROME=/path/to/chrome node tests/e2e-passkey.mjs

   1. 試し用の置き場で server.py を --auth passkey で起動する（住所は http://localhost:<port>。
      パスキーは localhost なら http でも使える）
   2. server.py invite-add で招待コードを作る
   3. headless の Chrome を DevTools の口つきで起動し、WebAuthn.addVirtualAuthenticator で仮のパスキーの
      置き場（Face ID 済みの端末のつもり）を付ける
   4. 設定の画面で招待コードを入れて「この端末を登録」→ 記録を1つ書く → サーバーの state.json に届くか
   5. 「この端末から出る」→「パスキーで入る」→ また合わせられるか
   6. その間に、CSP に止められた読み込みや、画面のエラーが無いか
   Node 22 の WebSocket と child_process だけで動く。本物の端末（Face ID）ではない。 */

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT = process.env.SHOT || '';   /* 置けば、登録したあとの設定の画面を撮る */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-'));
const data = join(tmp, 'data');
const port = await freePort();
const dbg = await freePort();
const origin = `http://localhost:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', data,
  '--auth', 'passkey', '--origin', origin], { stdio: ['ignore', 'ignore', 'pipe'] });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
/* サーバーが配っていないページのつもり（GitHub Pages から入れた Chrome の app など）。ただの静的な配り（2026-11-16） */
const plainPort = await freePort();
const plain = spawn('python3', ['-m', 'http.server', String(plainPort), '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
const cleanup = () => { try { plain.kill(); } catch (e) {} try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

const invite = execFileSync('python3', [join(ROOT, 'server.py'), '--data-dir', data, 'invite-add', '自分のスマホ', '--space', 'me,share'])
  .toString().match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];

let ws, seq = 0;
const waiting = new Map();
const problems = [];
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(p => p.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (e) { /* まだ起きていない */ }
  if (!ws) await sleep(200);
}
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const d = JSON.parse(e.data);
  if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Log.entryAdded' && /Content Security Policy|Refused to/.test(d.params.entry.text)) problems.push(d.params.entry.text);
  if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result?.result?.value;
}
async function until(expr, ms = 8000) {
  const t0 = Date.now();
  const body = /^\s*return\b/.test(expr) ? expr : 'return ' + expr;
  while (Date.now() - t0 < ms) { if (await js(body)) return true; await sleep(100); }
  throw new Error('待っても来なかった: ' + expr);
}

let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

try {
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1.28, mobile: true });
  await send('WebAuthn.enable');
  const { result: { authenticatorId } } = await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });

  /* 2026-11-16「chromeのapp版から登録できない」: サーバーが配っていないページでは、行き止まりにせず、サーバーのページを開く道を出す */
  await send('Page.navigate', { url: `http://127.0.0.1:${plainPort}/index.html` });
  await sleep(1500);
  await step('サーバーが配っていないページでは、サーバーの住所の欄と［サーバーのページを開く］が出る', async () => {
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`document.querySelector('.gearbtn').click();`);
    await until(`return !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーにログイン')`);
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーにログイン').click();`);
    await until(`return !!document.querySelector('input[aria-label="サーバーの住所"]')`);
    assert.equal(await js(`return !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーのページを開く')`), true);
  });

  await send('Page.navigate', { url: origin + '/' });
  await sleep(1500);

  const button = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)}))`;
  /* 読み直したあとも使う。設定がもう開いていれば押さない（押すと閉じる） */
  const openSettings = async () => {
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`const g = document.querySelector('.gearbtn'); if (!g.classList.contains('is-open')) g.click();`);
    await until(`return !!${button('サーバーにログイン')} || !!${button('ログアウト')}`);
  };

  /* 2026-11-16 海と同期の作り直し（js/screens/seapanel.js）: サーバーの話は海の欄のいちばん下の1行だけ。
     ［サーバーにログイン］で欄を開き、招待コードで登録する。サーバーの個人は、ログインすると並ぶ */
  await step('設定の海の欄は、初めはサーバーの欄を出さず、［サーバーにログイン］で開く', async () => {
    /* ログインする前に、この端末の個人に1つ書いておく（あとで個人をまとめたとき、サーバーへ届くか見る） */
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`(await import('/js/store.js')).store.add('端末で書いた');`);
    await openSettings();
    assert.equal(await js(`return !!document.querySelector('.sea-panel input[aria-label="招待コード"]')`), false, '初めは招待コードの欄を出さない');
    await js(`${button('サーバーにログイン')}.click();`);
    await until(`return !!document.querySelector('.sea-panel input[aria-label="招待コード"]')`);
  });

  await step('招待コードで登録すると個人が2つ並び、1つにまとめるとこの端末の個人の泡もサーバーへ届く', async () => {
    await js(`const i = document.querySelector('.sea-panel input[aria-label="招待コード"]'); i.value = ${JSON.stringify(invite)};
      i.closest('form').requestSubmit();`);
    await until(`return !!${button('ログアウト')}`);
    const creds = (await send('WebAuthn.getCredentials', { authenticatorId })).result.credentials;
    assert.equal(creds.length, 1, '仮のパスキーの置き場に1つ入った');
    /* 個人が2つ並ぶので、1つにまとめる（2度押す）。まとめると読み直し、個人がサーバーと合わせ始める */
    /* ［サーバーに統合］は、この端末の個人の行の横に出る */
    await until(`return !!document.querySelector('.sp-unify')`);
    assert.match(await js(`return document.querySelector('.sp-unify').closest('.sp-sea').textContent`), /個人/);
    await js(`document.querySelector('.sp-unify').click();`);
    await js(`document.querySelector('.sp-unify').click();`);
    await sleep(1500);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
    assert.equal(await js(`return (await import('/js/store.js')).store.space()`), 'me');
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !(existsSync(f) && readFileSync(f, 'utf8').includes('端末で書いた')); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /端末で書いた/, 'この端末の個人の泡がサーバーの個人へ届いた');
    const c = await js(`return (await import('/js/sync.js')).sync.config().passkey`);
    assert.equal(c.name, '自分のスマホ');
    assert.deepEqual(c.spaces, ['me', 'share']);
  });

  if (SHOT) {
    await openSettings();
    await js(`document.querySelector('.sea-panel').scrollIntoView({ block: 'start' });`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
    writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  }

  await step('書いた記録がサーバーに届く', async () => {
    await js(`(await import('/js/store.js')).store.add('パスキーで書いた');`);
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !(existsSync(f) && readFileSync(f, 'utf8').includes('パスキーで書いた')); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /パスキーで書いた/);
  });

  await step('オフラインでも個人に書け、繋がったらサーバーへ届く', async () => {
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    assert.equal(await js(`return (await import('/js/store.js')).store.readOnly()`), false, '読むだけにならない');
    await js(`(await import('/js/store.js')).store.add('オフラインで書いた');`);
    await js(`await (await import('/js/sync.js')).sync.syncNow();`);
    const f = join(data, 'state.json');
    assert.doesNotMatch(readFileSync(f, 'utf8'), /オフラインで書いた/, 'オフラインの間は届かない');
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await js(`window.dispatchEvent(new Event('online'));`);
    for (let i = 0; i < 80 && !readFileSync(f, 'utf8').includes('オフラインで書いた'); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /オフラインで書いた/);
  });

  await step('ログアウトしたあと、パスキーでログインし直せる（Face ID のつもりの確かめつき）', async () => {
    await openSettings();
    await js(`${button('ログアウト')}.click();`);
    await until(`return !!${button('サーバーにログイン')}`);
    await js(`${button('サーバーにログイン')}.click();`);
    await until(`return !!${button('パスキーでログイン')}`);
    await js(`${button('パスキーでログイン')}.click();`);
    await sleep(1500);
    await until(`return (await import('/js/sync.js')).sync.config().passkey?.name === '自分のスマホ'`);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
  });

  await step('海の ⚙ から人を招く: 招待コードが出て、サーバーに招いた人の名前が残る', async () => {
    await openSettings();
    await js(`[...document.querySelectorAll('.sp-gear')][0].click();`);
    await until(`return !!document.querySelector('input[aria-label="招く端末の呼び名"]')`);
    await js(`const i = document.querySelector('input[aria-label="招く端末の呼び名"]'); i.value = '自分のタブレット'; i.closest('form').requestSubmit();`);
    await until(`return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(document.querySelector('.sp-invite p[style]')?.textContent || '')`);
    const inv = JSON.parse(readFileSync(join(data, 'invites.json'), 'utf8'));
    const row = inv.find(r => r.name === '自分のタブレット');
    assert.ok(row, '招待コードの行ができた');
    assert.equal(row.by, '自分のスマホ');
    assert.deepEqual(row.spaces, ['me']);
  });

  await step('同じ招待コードは2度使えない', async () => {
    const st = await js(`const r = await fetch('/api/passkey/register/options', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite: ${JSON.stringify(invite)} }) }); return r.status;`);
    assert.equal(st, 401);
  });

  await step('CSP に止められた読み込みや、画面のエラーが無い', async () => {
    await sleep(300);
    assert.deepEqual(problems, []);
  });

  assert.doesNotMatch(serverLog, new RegExp(invite), 'サーバーの記録に招待コードの値を出さない');
  console.log(`\n${pass} passed (headless Chrome + 仮のパスキー)`);
  process.exit(0);
} catch (e) {
  console.log('FAIL - ' + (e?.message || e));
  console.log('problems:', problems);
  console.log('server:', serverLog.slice(-800));
  process.exit(1);
}
