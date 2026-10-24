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
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
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

  await send('Page.navigate', { url: origin + '/' });
  await sleep(1500);

  await step('設定を開くと、サーバーの形を聞いてパスキーの欄が出る', async () => {
    await js(`document.querySelector('.gearbtn').click();`);
    await until(`!document.querySelector('.pkbox').hidden`);
    assert.equal(await js(`return document.querySelector('input[aria-label="サーバーの合言葉"]').hidden`), true, '合言葉の欄は隠す');
  });

  await step('招待コードで登録すると、通行証を受け取って合わせ始める', async () => {
    await js(`const i = document.querySelector('input[aria-label="招待コード"]'); i.value = ${JSON.stringify(invite)};
      i.closest('form').requestSubmit();`);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
    const c = await js(`return (await import('/js/sync.js')).sync.config().passkey`);
    assert.equal(c.name, '自分のスマホ');
    assert.deepEqual(c.spaces, ['me', 'share']);
    const creds = (await send('WebAuthn.getCredentials', { authenticatorId })).result.credentials;
    assert.equal(creds.length, 1, '仮のパスキーの置き場に1つ入った');
  });

  if (SHOT) {
    await js(`document.querySelector('.pkbox').scrollIntoView({ block: 'center' });`);
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

  await step('CSV の書き出しが公開の形（CSP の下）でも動き、書いた記録が入っている', async () => {
    const dl = join(tmp, 'dl');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'CSV で書き出す').click();`);
    let file = null;
    for (let i = 0; i < 50 && !file; i++) {
      try { file = (await import('node:fs')).readdirSync(dl).find(f => f.endsWith('.csv')); } catch (e) { /* まだ無い */ }
      if (!file) await sleep(100);
    }
    assert.ok(file, 'CSV が保存された');
    assert.match(readFileSync(join(dl, file), 'utf8'), /パスキーで書いた/);
  });

  await step('出たあと、パスキーで入り直せる（Face ID のつもりの確かめつき）', async () => {
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'この端末から出る').click();`);
    await until(`return !(await import('/js/sync.js')).sync.config().passkey`);
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'パスキーで入る').click();`);
    await until(`return (await import('/js/sync.js')).sync.config().passkey?.name === '自分のスマホ'`);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
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
