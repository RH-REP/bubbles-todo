/* 引っ越しのファイルで日記の束を運ぶ通しのテスト（2026-11-18 取り決め §8.3）。本物の Chrome・本物の server.py と、仮の diary。

     node tests/e2e-apps.mjs

   ・server.py を --origin http://127.0.0.1:<p1> --app-url diary=http://127.0.0.1:<p2> で起動する
     （手元の本物の diary は 127.0.0.1:8780 で動いていて中身は本物の日記なので、必ず別の住所の仮の diary を使う）
   ・仮の diary（この中の小さな http サーバー）は diary の口（§8.2）と同じ形: クッキーで本人、CORS は bubble の住所だけ、OPTIONS にも答える
   ・bubble と仮の diary は同じ 127.0.0.1 なので同じサイト。Lax のクッキーが fetch に付く（本番の *.app-laboratory.duckdns.org と同じ形）
   確かめること: CSP の connect-src に diary・設定の「書き出す」で日記が入る・ファイルから読み込むと diary の /api/import に届く・
   diary にログインしていなければ入れずに知らせる・bubble の記録（localStorage）に日記の字が入らない */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-apps-'));
const port = await freePort();
const dport = await freePort();
const dbg = await freePort();
const origin = `http://127.0.0.1:${port}`;
const diary = `http://127.0.0.1:${dport}`;
assert.notEqual(dport, 8780, '本物の diary の住所を使わない');

/* --- 仮の diary --- */
const SECRET_TEXT = '仮の日記のきょうの文';
const bundle = { app: 'diary', schema: 1, version: 5,
  data: { entries: { '2026-11-17': { text: '仮の日記のきのう', mtime: 1 }, '2026-11-18': { text: SECRET_TEXT, mtime: 2 } } } };
const imported = [];
const fake = httpServer((req, res) => {
  const o = req.headers.origin || '';
  const cors = o === origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {};
  const send = (st, body) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') {
    res.writeHead(o === origin ? 204 : 403, Object.assign({ 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }, cors));
    return res.end();
  }
  const login = /(?:^|;\s*)diary_sid=ok(?:;|$)/.test(req.headers.cookie || '');
  if (!login) return send(401, { error: 'login' });
  if (req.method === 'GET' && req.url === '/api/export') return send(200, bundle);
  if (req.method === 'POST' && req.url === '/api/import') {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => { imported.push(JSON.parse(b)); send(200, { ok: true, added: 0, updated: 1, kept: 1 }); });
    return;
  }
  send(404, { error: 'not found' });
});
await new Promise(r => fake.listen(dport, '127.0.0.1', r));

const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', join(tmp, 'data'),
  '--auth', 'passkey', '--origin', origin, '--app-url', 'diary=' + diary], { stdio: ['ignore', 'ignore', 'pipe'] });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { fake.close(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

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
  if (d.method === 'Log.entryAdded' && /Content Security Policy|Refused to|CORS/.test(d.params.entry.text)) problems.push(d.params.entry.text);
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
  while (Date.now() - t0 < ms) { if (await js(body).catch(() => false)) return true; await sleep(100); }
  throw new Error('待っても来なかった: ' + expr);
}
let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

/* 設定の「記録」→［書き出す|読み込む］→［ファイル］の欄を出す。→ その欄（wrap）を探す式 */
async function openFilePane(mode) {
  await js(`document.querySelector('.userbtn').click(); [...document.querySelectorAll('.uc-row')].find(b => /設定/.test(b.textContent)).click();`);
  await until(`return document.getElementById('pane-settings')?.classList.contains('is-active')`);
  await js(`const g = [...document.querySelectorAll('#pane-settings details')].find(d => (d.querySelector('summary .nm') || {}).textContent === '記録'); g.open = true;
    const btn = (t) => [...g.querySelectorAll('button')].find(b => b.textContent.trim() === t && b.offsetParent);
    btn(${JSON.stringify(mode === 'out' ? '書き出す（バックアップ）' : '読み込む（バックアップから）')}).click(); await new Promise(r => setTimeout(r, 100));
    const bar = g.querySelector(${JSON.stringify(mode === 'out' ? '[aria-label="書き出す先"]' : '[aria-label="読み込む元"]')});
    [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === 'ファイル').click();`);
}

try {
  await step('配るページの CSP の connect-src に diary の住所が入る（ほかの外は足さない）', async () => {
    const res = await (async () => { for (let i = 0; i < 50; i++) { try { return await fetch(origin + '/'); } catch (e) { await sleep(200); } } })();
    const csp = res.headers.get('content-security-policy') || '';
    const connect = csp.split(';').map(x => x.trim()).find(x => x.startsWith('connect-src'));
    assert.equal(connect, `connect-src 'self' https://api.open-meteo.com ${diary}`);
  });

  await send('Page.enable');
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCookie', { name: 'diary_sid', value: 'ok', domain: '127.0.0.1', path: '/', sameSite: 'Lax' });
  await send('Page.navigate', { url: origin + '/' });
  await until(`return !!document.querySelector('.userbtn')`, 15000);
  await until(`return (await import('/js/apps.js')).appUrls().diary === ${JSON.stringify(diary)}`);
  await js(`(await import('/js/store.js')).store.add('ふつうの泡');`);

  await step('設定の「書き出す」→「ファイル」: diary にログインしていれば、日記の束を入れて作り、何日分かを出す', async () => {
    await openFilePane('out');
    await js(`const g = [...document.querySelectorAll('#pane-settings details')].find(d => (d.querySelector('summary .nm') || {}).textContent === '記録');
      [...g.querySelectorAll('button')].find(b => b.textContent.trim() === '書き出す' && b.offsetParent && b.closest('.choice-pane')).click();`);
    await until(`return [...document.querySelectorAll('#pane-settings p')].some(p => /日記 2 日分/.test(p.textContent))`);
    const got = await js(`return await (await import('/js/appbundles.js')).collectApps()`);
    assert.deepEqual(got.apps.diary, bundle, '束はそのまま');
  });

  await step('ファイルから読み込む: apps.diary を diary の /api/import へ渡し、結果を出す。bubble の記録に日記の字は入らない', async () => {
    await send('Page.navigate', { url: origin + '/' });
    await until(`return !!document.querySelector('.userbtn')`, 15000);
    const file = join(tmp, 'bubbles-backup-test.json');
    const p = await js(`const m = await import('/js/folderbackup.js'); return m.buildBackup({ boxes: {}, seas: [], at: 123, device: 'test',
      apps: ${JSON.stringify({ diary: bundle, notebook: { app: 'notebook', x: 1 } })} })`);
    writeFileSync(file, JSON.stringify(p));
    await openFilePane('in');
    await js(`window.confirm = () => true;`);
    const doc = await send('DOM.getDocument', { depth: -1 });
    const q = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file][accept=".json,application/json"]' });
    for (const nodeId of q.result.nodeIds) await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    await until(`return [...document.querySelectorAll('#pane-settings p')].some(p => /日記: 足した 0・新しくした 1・そのまま 1/.test(p.textContent))`);
    assert.ok(imported.length >= 1, 'diary に届いた');
    assert.deepEqual(imported[0], bundle, '束はそのまま渡す（知らない app は渡さない）');
    assert.ok(await js(`return [...document.querySelectorAll('#pane-settings p')].some(p => /知らない app（notebook）/.test(p.textContent))`));
    const leaked = await js(`return Object.keys(localStorage).filter(k => (localStorage.getItem(k) || '').includes(${JSON.stringify(SECRET_TEXT)}))`);
    assert.deepEqual(leaked, [], 'bubble の記録・設定に日記の字が入らない');
  });

  await step('diary にログインしていなければ、日記を入れずに作り、そう出す', async () => {
    await send('Network.deleteCookies', { name: 'diary_sid', domain: '127.0.0.1' });
    const got = await js(`return await (await import('/js/appbundles.js')).collectApps()`);
    assert.deepEqual(got, { apps: {}, notes: ['日記は入れていない（diary にログインしてから作り直すと入る）'] });
  });

  await step('CSP・CORS に止められた読み込みや、画面のエラーが無い', async () => {
    assert.deepEqual(problems, []);
  });
} catch (e) {
  console.log('FAIL - ' + (e && e.message || e));
  console.log('problems:', problems);
  console.log('server:', serverLog.slice(-800));
  process.exit(1);
}
console.log(`\n${pass} passed (headless Chrome + 仮の diary)`);
process.exit(0);
