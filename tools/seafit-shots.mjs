import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
const ROOT = process.argv[2], OUT = process.argv[3];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const tmp = mkdtempSync(join(tmpdir(), 'seafit-'));
const port = await freePort(), dbg = await freePort();
const origin = `http://localhost:${port}`;
const server = spawn('python3', [join(ROOT, 'serve.py'), String(port)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'c')}`, '--no-first-run', '--hide-scrollbars', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);
let ws, seq = 0; const waiting = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); const p = l.find(p => p.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch (e) {} await sleep(200); }
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const d = JSON.parse(e.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; }
async function go() { await send('Page.navigate', { url: origin + '/' }); for (let i = 0; i < 50; i++) { await sleep(200); if (await js('return document.readyState === "complete" && !!document.querySelector(".tabbar button")')) break; } await sleep(2500); }
const T = ['歯医者を予約','あの論文を読む','傘を修理に出す','写真のバックアップ','灯油を買う','会議の資料をまとめる','洗濯物をたたむ','メールの返事','ストレッチ','ポッドキャストを聴く','カーテンを洗う','電球を替える','図書館に本を返す','引っ越しの見積もりを三社から取る','自転車の空気','年賀状の住所録を整理する','植木に水','確定申告の書類を集めておく'];
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (const [w, h] of [[485, 963], [360, 640]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    for (const mode of ['', 'A', 'B', 'C']) {
      await send('Page.navigate', { url: 'about:blank' }); await sleep(500);
      await send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await go();
      await js(`localStorage.setItem('bubble_todo_space', 'me'); localStorage.setItem('bubble_todo_seafit', ${JSON.stringify(mode)});`);
      await go();
      await js(`const { store } = await import('/js/store.js');
        if (store.all().length) throw new Error('not empty');
        ${JSON.stringify(T)}.forEach((t, i) => store.add(t, { fx: 0.15 + 0.7 * ((i * 37) % 18) / 17, fy: 0.15 + 0.7 * ((i * 53) % 18) / 17 }));
        store.flush();`);
      await go(); await sleep(4000);
      const n = await js('const b=[...document.querySelectorAll(".sea-stage .bub")]; return b.length + " d=" + b.map(e=>Math.round(e.getBoundingClientRect().width)).join(",")');
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
      const name = `${w}x${h}_${mode || 'now'}.jpg`;
      writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
      console.log(name, 'bubbles', n);
    }
  }
} finally { cleanup(); }
process.exit(0);
