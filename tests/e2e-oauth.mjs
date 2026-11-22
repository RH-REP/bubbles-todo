/* claude.ai の接続の許可の画面の通しのテスト（2026-11-17）。本物の Chrome と、Chrome の仮のパスキーで確かめる。

     node tests/e2e-oauth.mjs
     CHROME=/path/to/chrome node tests/e2e-oauth.mjs

   1. tests/e2e_oauth_harness.py で server.py（--auth passkey）を立てる。相手の名乗りは偽物で、戻る先は
      手元の http://127.0.0.1:<port>/cb（網には出ない）
   2. headless の Chrome に仮のパスキーの置き場を付け、/oauth/authorize の画面を開く
   3. その画面から持ち主のパスキーを登録しておき（招待コードで。画面の操作ではなく JS で）、
      「パスキーでログインして許可」を押す → 戻る先に code・state・iss が付いて来るか
   4. その code と verifier で /oauth/token が通行証を出し、/mcp が通るか
   5. 「断る」も押してみる → error=access_denied で戻るか
   6. その間に、CSP に止められた読み込みや、画面のエラーが無いか
   Node 22 の WebSocket と child_process だけで動く。 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-oauth-'));
const harness = spawn('python3', [join(ROOT, 'tests', 'e2e_oauth_harness.py'), join(tmp, 'data')], { stdio: ['pipe', 'pipe', 'pipe'] });
let serverLog = '';
harness.stderr.on('data', d => { serverLog += d; });
const callbacks = [];
let info = null;
createInterface({ input: harness.stdout }).on('line', line => {
  const j = JSON.parse(line);
  if (j.hit !== undefined) callbacks.push(j.hit); else info = j;
});
const dbg = await freePort();
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { harness.stdin.end(); harness.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);
for (let i = 0; i < 100 && !info; i++) await sleep(100);
if (!info) { console.log('FAIL - 試しのサーバーが起きない\n' + serverLog); process.exit(1); }

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
  while (Date.now() - t0 < ms) { try { if (await js(body)) return true; } catch (e) { /* 移っている途中 */ } await sleep(100); }
  throw new Error('待っても来なかった: ' + expr);
}

function authorizeUrl(state) {
  const verifier = b64u(randomBytes(48));
  const challenge = b64u(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: info.client_id, redirect_uri: info.callback,
    code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'todo', resource: info.origin + '/mcp' });
  return { url: info.origin + '/oauth/authorize?' + q, verifier };
}

let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }
const secrets = [info.invite];

try {
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1.28, mobile: true });
  await send('WebAuthn.enable');
  await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });

  let flow = authorizeUrl('st-ok');
  await step('許可の画面が出る（相手の名前・戻る先の名前・ボタン）', async () => {
    await send('Page.navigate', { url: flow.url });
    await until(`return !!document.getElementById('ok')`);
    const text = await js(`return document.body.innerText`);
    assert.match(text, /秘書（試し）/);
    assert.match(text, /127\.0\.0\.1/);
    assert.match(text, /パスキーでログインして許可/);
    assert.match(text, /断る/);
  });

  await step('（準備）この画面から持ち主のパスキーを登録する', async () => {
    const ok = await js(`
      const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const unb = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
      const post = async (p, b) => (await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const { publicKey: o } = await post('/api/passkey/register/options', { invite: ${JSON.stringify(info.invite)} });
      const c = await navigator.credentials.create({ publicKey: Object.assign({}, o, { challenge: unb(o.challenge),
        user: Object.assign({}, o.user, { id: unb(o.user.id) }), excludeCredentials: [] }) });
      const r = await post('/api/passkey/register', { credential: { id: c.id, type: c.type, response: {
        clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject) } } });
      return r.person === 1 && !!r.session;`);
    assert.equal(ok, true);
  });

  let code;
  await step('「パスキーでログインして許可」→ 戻る先に code・state・iss が付いて来る', async () => {
    await js(`document.getElementById('ok').click();`);
    for (let i = 0; i < 80 && !callbacks.length; i++) await sleep(100);
    assert.equal(callbacks.length, 1, '戻る先に来た');
    await until(`return location.href.startsWith(${JSON.stringify(info.callback)})`);
    const q = new URLSearchParams(callbacks[0]);
    code = q.get('code');
    assert.match(code || '', /^bc_/);
    assert.equal(q.get('state'), 'st-ok');
    assert.equal(q.get('iss'), info.origin);
    secrets.push(code);
  });

  await step('その code と verifier で通行証をもらい、/mcp が通る', async () => {
    const res = await fetch(info.origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: info.callback, client_id: info.client_id,
        code_verifier: flow.verifier }) });
    const tok = await res.json();
    assert.equal(res.status, 200, JSON.stringify(tok.error));
    secrets.push(tok.access_token, tok.refresh_token);
    const m = await fetch(info.origin + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tok.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(m.status, 200);
    assert.equal((await m.json()).error.code, -32601);
  });

  await step('「断る」→ error=access_denied で戻る', async () => {
    flow = authorizeUrl('st-no');
    await send('Page.navigate', { url: flow.url });
    await until(`return !!document.getElementById('no')`);
    await js(`document.getElementById('no').click();`);
    for (let i = 0; i < 80 && callbacks.length < 2; i++) await sleep(100);
    const q = new URLSearchParams(callbacks[1]);
    assert.equal(q.get('error'), 'access_denied');
    assert.equal(q.get('state'), 'st-no');
    assert.equal(q.get('iss'), info.origin);
  });

  await step('CSP に止められた読み込みや、画面のエラーが無い', async () => {
    await sleep(300);
    assert.deepEqual(problems, []);
  });

  for (const s of secrets) assert.ok(!serverLog.includes(s), 'サーバーの記録に値を出さない');
  console.log(`\n${pass} passed (headless Chrome + 仮のパスキー)`);
  process.exit(0);
} catch (e) {
  console.log('FAIL - ' + (e?.message || e));
  console.log('problems:', problems);
  console.log('server:', serverLog.slice(-800));
  process.exit(1);
}
