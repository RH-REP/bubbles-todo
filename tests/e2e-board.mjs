/* 泡の盤（取りかかる画面）の通しのテスト（2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」。モック docs/spec/mock/task-start.html）。

     node tests/e2e-board.mjs

   本物の Chrome（headless。前に出して、動きの描画を止めない）と、試し用の置き場の server.py で確かめる:
   1. 開いた時点で、次にやること・始める・今日はここまで・完了にする・メモ・日付・タグが見え、［書き留める］は無い
   2. 個人の海ではコメント（前のひとこと）を出さない
   3. まれなもの（お気に入り・優先度・リンク・作業の記録・削除）は「その他」の中。開くと出る
   4. 打ち終えた欄から離れると保存し、「保存した」と出す（次にやること・メモ）
   5. 前の版で置いた「名前だけ」の設定は、新しい既定に替わる
   6. 優先度は、押した札をもう一度押すと印が外れる（［印を外す］は無い） */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-board-'));
const port = await freePort(), dbg = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', join(tmp, 'data'),
  '--auth', 'passkey', '--origin', origin], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

let ws, seq = 0;
const waiting = new Map();
const problems = [];
for (let i = 0; i < 50 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(p => p.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {}
  if (!ws) await sleep(200);
}
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const d = JSON.parse(e.data);
  if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (m, p = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
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

await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 1500, deviceScaleFactor: 1, mobile: true });
for (let i = 0; i < 50; i++) { try { await fetch(origin + '/'); break; } catch (e) { await sleep(200); } }

/* 見えているか（親が畳まれていても false） */
const VIS = `const vis = n => !!n && !!(n.offsetParent || n.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden';`;
async function openApp(prefs) {
  await send('Page.navigate', { url: origin + '/' });
  await until(`return !!document.querySelector('.userbtn')`, 15000);
  if (prefs !== undefined) {
    await js(`localStorage.setItem('bubble_todo_prefs_v1', ${JSON.stringify(JSON.stringify(prefs))}); location.reload();`);
    await sleep(500);
    await until(`return !!document.querySelector('.userbtn')`, 15000);
  }
}
async function openBoard(text) {
  await until(`return [...document.querySelectorAll('.bub')].some(b => b.textContent.includes(${JSON.stringify(text)}))`);
  await js(`const n = [...document.querySelectorAll('.bub')].find(b => b.textContent.includes(${JSON.stringify(text)}));
    (await import('/js/bubble.js')).centerBubble(n);`);
  await until(`return !!document.querySelector('.bc-fields .bc-act-start')`);
  await sleep(600);
}

try {
  await openApp();
  await js(`const { store } = await import('/js/store.js'); store.add('歯医者の予約をする');`);

  await step('開いた時点で、次にやること・始める・今日はここまで・完了にする・メモ・日付・タグが見え、［書き留める］は無い', async () => {
    await openBoard('歯医者');
    const got = await js(`${VIS} const f = document.querySelector('.bc-fields');
      const txt = s => [...f.querySelectorAll(s)].filter(vis).map(n => n.textContent.trim());
      return { lbs: txt('.bc-lb'), acts: txt('.bc-act'), more: txt('.bc-more'), name: vis(f.querySelector('.bc-name-in')),
        ok: !!f.querySelector('.bc-act-ok') || /書き留め/.test(f.textContent), start: vis(f.querySelector('.bc-act-start')) }`);
    assert.equal(got.name, true, '名前（題）');
    for (const l of ['次にやること', 'メモ', '日付', 'タグ']) assert.ok(got.lbs.includes(l), l + ' が見える: ' + got.lbs);
    assert.deepEqual(got.acts, ['始める5 分のタイマー', '今日はここまで', '✓ 完了にする']);
    assert.equal(got.ok, false, '［書き留める］は無い');
    assert.deepEqual(got.more, ['その他 ▾']);
    const heads = await js(`return [...document.querySelectorAll('.bc-dates .bc-cal-head')].filter(n => n.offsetParent).map(n => n.textContent.replace(/\\s+/g, ''))`);
    assert.deepEqual(heads, ['やる日未定', '期間未定']);
  });

  await step('個人の海ではコメントを出さない。まれなものは「その他」の中で、開くと出る', async () => {
    const got = await js(`${VIS} const f = document.querySelector('.bc-fields');
      return { chat: vis(f.querySelector('.bc-chat')), fav: vis(f.querySelector('[data-part="fav"]')), del: vis(f.querySelector('[data-part="del"]')) }`);
    assert.deepEqual(got, { chat: false, fav: false, del: false });
    await js(`document.querySelector('.bc-more').click();`);
    await sleep(300);
    const open = await js(`${VIS} const f = document.querySelector('.bc-fields');
      const after = [...f.children].slice([...f.children].indexOf(f.querySelector('.bc-more')) + 1).filter(vis).map(n => n.dataset.part).filter(Boolean);
      return { after, chat: vis(f.querySelector('.bc-chat')), del: f.querySelector('[data-part="del"]')?.textContent }`);
    assert.deepEqual(open.after, ['fav', 'prio', 'url', 'memo', 'del'], '「その他」の中の並び');
    assert.equal(open.chat, false, '「その他」を開いてもコメントは出ない（個人の海）');
    assert.equal(open.del, '削除');
  });

  await step('優先度: 押した札をもう一度押すと印が外れる（［印を外す］は無い）', async () => {
    const got = await js(`${VIS} const box = document.querySelector('.bc-fields [data-part="prio"]');
      const u = [...box.querySelectorAll('.bc-prio-b')].find(b => b.dataset.key === 'urgent');
      u.click(); const on = u.getAttribute('aria-pressed'); u.click(); const off = u.getAttribute('aria-pressed');
      return { on, off, clear: vis(box.querySelector('.bc-prio-clear')), note: /まだ分けていない/.test(box.textContent) }`);
    assert.deepEqual(got, { on: 'true', off: 'false', clear: false, note: false });
  });

  await step('打ち終えた欄から離れると保存し、「保存した」と出す（次にやること・メモ）。盤は閉じない', async () => {
    await js(`const f = document.querySelector('.bc-fields');
      const step = [...f.querySelectorAll('.bc-stack')].find(r => /次にやること/.test(r.textContent)).querySelector('input');
      step.focus(); step.value = '予約の電話をかける'; step.dispatchEvent(new Event('input', { bubbles: true })); step.blur();`);
    await until(`return document.querySelector('.bc-saved')?.textContent === '保存した'`);
    assert.equal(await js(`const { store } = await import('/js/store.js'); return store.firstStepOf(store.all().find(t => t.text === '歯医者の予約をする').id)`), '予約の電話をかける');
    await js(`const m = document.querySelector('.bc-fields .bc-memo-in'); m.focus(); m.value = '保険証を持っていく';
      m.dispatchEvent(new Event('input', { bubbles: true })); m.blur();`);
    await until(`return (async () => { const { store } = await import('/js/store.js'); return store.detailOf(store.all().find(t => t.text === '歯医者の予約をする').id) === '保険証を持っていく'; })()`);
    assert.ok(await js(`return !!document.querySelector('.bc-fields .bc-act-start')`), '盤は開いたまま');
  });

  await step('前の版で置いた「名前だけ」の設定は、新しい既定に替わる（始めるが見える）', async () => {
    await openApp({ boardShow: ['name'], boardShowV: 2 });
    await openBoard('歯医者');
    assert.equal(await js(`${VIS} return vis(document.querySelector('.bc-fields .bc-act-start'))`), true);
    assert.deepEqual((await js(`return JSON.parse(localStorage.getItem('bubble_todo_prefs_v1') || 'null')`)), { boardShow: ['name'], boardShowV: 2 },
      '置いた値はそのまま（読むときに替える）');
  });

  await step('画面のエラーが無い', async () => { assert.deepEqual(problems, []); });
} catch (e) {
  console.log('FAIL - ' + (e && e.message || e));
  console.log('problems:', problems);
  process.exit(1);
}
console.log(`\n${pass} passed (headless Chrome)`);
process.exit(0);
