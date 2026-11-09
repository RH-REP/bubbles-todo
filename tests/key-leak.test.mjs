/* AI の API キーが、うっかり外へ出る道に混ざらないことを見るテスト（Issue #14）。
   tests/ai.test.mjs は保存の箱と CSV を見る。こちらは残りの道を見る。素の Node と assert だけで走る。

     node tests/key-leak.test.mjs

   見るもの:
     1. サーバーとの同期（js/sync.js）: 送る住所・ヘッダー・本文（state）にキーが出てこない。設定の箱にも入らない
     2. 改善のコメント（js/feedback.js）: Issue の本文・GitHub を開く URL・クリップボードの文・エラーの記録に出てこない
     3. js/feedback.js はキーの箱を読まない（触る localStorage は feedback.errors だけ）
     4. 引っ越しのファイル（js/movefile.js）の中身に出てこない */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SECRET = 'sk-ant-api03-LEAK-CHECK-0123456789';

const mem = new Map();
const storage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
globalThis.localStorage = storage;

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* ---- 1. 同期 ---- */
mem.set('bubble_todo_ai_key', SECRET);
mem.set('bubble_todo_space', 'me');
mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://bubbles.example.org', token: 'TOKEN-ME', shareToken: '' }));

const sent = [];
let version = 0;
globalThis.fetch = async (url, init = {}) => {
  sent.push(JSON.stringify({ url: String(url), method: init.method, headers: init.headers || {}, body: init.body || '' }));
  const reply = (status, obj) => ({ status, ok: status === 200, json: async () => obj });
  if (String(url).endsWith('/api/spaces')) return reply(200, { spaces: [] });
  if ((init.method || 'GET') === 'GET') return reply(200, { space: 'me', version, data: null });
  version++;
  return reply(200, { version });
};

const { store } = await import(new URL('../js/store.js', import.meta.url).href);
const { sync, syncNow } = await import(new URL('../js/sync.js', import.meta.url).href);

async function settle() {
  for (let i = 0; i < 200 && sync.status().state === 'syncing'; i++) await new Promise(r => setTimeout(r, 5));
}

await test('同期で送る住所・ヘッダー・本文に AI キーが出てこない', async () => {
  await settle();                      /* 読み込んだときに sync.js が自分で走らせた分を待つ */
  store.add('牛乳を買う');
  await syncNow();
  await settle();
  assert.ok(sent.some(s => s.includes("牛乳を買う")), '同期が記録を送っていない（テストの前提が崩れている）');
  for (const s of sent) assert.ok(!s.includes(SECRET), '同期の通信に AI キーが混ざっている: ' + s.slice(0, 200));
});

await test('同期の設定の箱（bubble_todo_sync）と記録（bubble_todo_v1）に AI キーが入らない', async () => {
  sync.configure('https://bubbles.example.org', 'TOKEN-ME', '');
  for (const k of ['bubble_todo_sync', 'bubble_todo_v1']) {
    assert.ok(!String(mem.get(k) || '').includes(SECRET), k + ' に AI キーが混ざっている');
  }
});

/* ---- 2・3. 改善のコメント ---- */
const src = readFileSync(new URL('../js/feedback.js', import.meta.url), 'utf8');

await test('js/feedback.js はキーの箱を読まず、localStorage は feedback.errors と feedback.dest（送り先の選択）だけを触る', async () => {
  assert.ok(!src.includes('bubble_todo_ai_key'), 'feedback.js がキーの箱の名前を持っている');
  const uses = src.match(/localStorage\.\w+\(([^)]*)\)/g) || [];
  assert.ok(uses.length > 0);
  // feedback.dest は「!」の送り先（GitHub の Issue か対話か）を覚えるだけの値（2026-11-09。issue_hub の正本に合わせた）
  for (const u of uses) assert.match(u, /\((ERR_KEY|"feedback\.dest")[,)]/, 'feedback.errors・feedback.dest 以外を触っている: ' + u);
  assert.ok(!/localStorage\s*\[|Object\.keys\(localStorage\)|localStorage\.key\(/.test(src), 'localStorage を丸ごと読んでいる');
});

await test('Issue の本文・開く URL・クリップボードの文・エラーの記録に AI キーが出てこない', async () => {
  mem.set('feedback.errors', JSON.stringify(['2026-11-04T00:00:00Z TypeError: x is undefined']));
  const ctx = { window: {}, localStorage: storage, location: { pathname: '/index.html' } };
  vm.runInNewContext(src, ctx);
  const F = ctx.window.AppFeedback;
  const r = { screen: 'settings', app: 'bubble_todo', version: '0.1.0', at: '2026-11-04T00:00:00Z',
    comment: 'キーを入れたら止まった', context: { device: 'Mac', summary: '画面 settings ・ 海 1' } };
  const outs = { issueBody: F.issueBody(r), newIssueUrl: decodeURIComponent(F.newIssueUrl('RH-REP/bubbles-todo', r)),
    clipText: F.clipText(r), errorLog: F.errorLog() };
  assert.ok(outs.errorLog.includes('TypeError'), 'エラーの記録が読めていない（テストの前提が崩れている）');
  for (const [k, v] of Object.entries(outs)) assert.ok(!String(v).includes(SECRET), k + ' に AI キーが混ざっている');
});

/* ---- 4. 引っ越しのファイル（Issue #19） ---- */
await test('引っ越しのファイルの中身（暗号化の前）に AI キーが出てこない。js/movefile.js はキーの箱を読まない', async () => {
  const mvSrc = readFileSync(new URL('../js/movefile.js', import.meta.url), 'utf8');
  assert.ok(!mvSrc.includes('bubble_todo_ai_key'), 'movefile.js がキーの箱の名前を持っている');
  assert.ok(!/localStorage/.test(mvSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'movefile.js が localStorage を直に読んでいる');
  const { buildPayload } = await import(new URL('../js/movefile.js', import.meta.url).href);
  const p = buildPayload({ boxes: { me: store.exportState() }, seas: [{ id: 'me', name: '自分' }],
    server: { url: 'https://bubbles.example.org', token: 'TOKEN-ME', move: 'MOVE-1' }, at: 0, device: 'Mac' });
  const s = JSON.stringify(p);
  assert.ok(s.includes('牛乳を買う'), '記録が入っていない（テストの前提が崩れている）');
  assert.ok(!s.includes(SECRET), '引っ越しのファイルに AI キーが混ざっている');
});

console.log(`\n${pass} ok, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
