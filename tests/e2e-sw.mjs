/* server.py から開いたページに service worker が入るかの通しのテスト（2026-11-12）。本物の Chrome（headless）で確かめる。

     node tests/e2e-sw.mjs

   前は sw.js の ASSETS に server.py が配らない solo.html・manifest-solo.json が入っていて、
   addAll ごと失敗し、service worker が入らなかった（2026-11-08 の 3f060cd から）。
   「最新の版を確認する」は「この端末では確認できない」になっていた。
   ここでは 架空のデータの一時フォルダで server.py を立て、
     1. 開くと service worker が activated になり、版の箱に入口・画面のファイルが入る
     2. 取れなくてよいもの（noserver.html・solo.html）は箱に入らない（server.py が配らない）
     3. 「最新の版を確認する」を押すと「今のが最新の版」と出る（強制更新にならない）
   を見る。Node 22 の WebSocket と child_process だけで動く（tests/e2e-passkey.mjs と同じ作り）。 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const VERSION = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-sw-'));
const port = await freePort(), dbg = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', join(tmp, 'data')], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

let ws, seq = 0;
const waiting = new Map();
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
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result?.result?.value;
}
async function until(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await js('return ' + expr)) return true; await sleep(200); }
  throw new Error('待っても来なかった: ' + expr);
}

let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

try {
  for (let i = 0; i < 50; i++) { try { await fetch(origin + '/api/health'); break; } catch (e) { await sleep(200); } }
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin + '/' });

  await step('server.py から開くと service worker が activated になる', async () => {
    await until(`navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r => !!(r && r.active && r.active.state === 'activated'))`);
  });

  await step('版の箱に入口と画面のファイルが入り、取れなくてよい noserver.html・solo.html は入らない', async () => {
    const got = await js(`
      const box = await caches.open('bubbles-${VERSION}');
      const keys = (await box.keys()).map(r => new URL(r.url).pathname);
      return { n: keys.length, index: keys.includes('/index.html'), root: keys.includes('/'), store: keys.includes('/js/store.js'),
        noserver: keys.includes('/noserver.html'), solo: keys.includes('/solo.html') };`);
    assert.ok(got.n > 50, '箱の中が少ない: ' + got.n);
    assert.deepEqual([got.index, got.root, got.store, got.noserver, got.solo], [true, true, true, false, false]);
  });

  await step('「最新の版を確認する」は「確認できない」でなく「今のが最新の版」になる', async () => {
    const found = await js(`const m = await import('/js/update.js'); return await m.checkForUpdate();`);
    assert.equal(found, false, 'checkForUpdate が ' + found + '（null は登録が無い）');
  });

  console.log(`\n${pass} passed, 0 failed`);
} catch (e) {
  console.log('FAIL - ' + ((e && e.stack) || e));
  console.log(`\n${pass} passed, 1 failed`);
  process.exitCode = 1;
} finally {
  cleanup();
  process.exit();
}
