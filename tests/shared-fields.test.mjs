/* 共有の記録 v1 の4つの欄（start・due・project・ext）が bubble を通っても残るかのテスト。
   仕様: AI_note/アプリのデザイン/261110_todo共有データ_3つのapp/共通の記録の形.md §4
   素の Node と assert だけで走る。データはすべて架空。

     node tests/shared-fields.test.mjs

   通り道は3つ：
     ・保存 → 読み込み（localStorage に入れて開き直す。load() → fromDoc()）
     ・サーバーから来た記録を入れる（applyState() → fromDoc()）
     ・2つの端末の合わせ（js/merge.js の mergeState） */

import assert from 'node:assert/strict';
import { mergeState } from '../js/merge.js';

const KEY = 'bubble_todo_v1';
const STORE_URL = new URL('../js/store.js', import.meta.url).href;

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

const REAL_NOW = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
function ms(y, m, d, h = 0, mi = 0) { return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); }
const NOW = ms(2026, 11, 10, 10, 0);

let seq = 0;
async function open(raw, now = NOW) {
  mem.clear();
  if (raw !== null && raw !== undefined) mem.set(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
/* 開き直す（今の保存のまま） */
async function reopen(now = NOW) {
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
function saved() { return JSON.parse(mem.get(KEY)); }
/* store の中の todo（写し） */
function todosOf(store) { return store.exportState().doc.todos; }

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); }
  catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* --- 架空のデータ --- */

const TAG = { id: 'tproj1', name: '架空の案件', color: '#a0c4ff' };

/* gantt が作る形を真似た todo（id は g + 時刻36進 + 乱数） */
const GANTT_EXT = {
  gantt: {
    goal: '架空の目標', notes: 'メモ', acceptance_criteria: ['a', 'b'], implementation_notes: '',
    relative: { anchor_id: 'gabc123x', anchor_field: 'due', offset_days: 2, duration_days: 3 },
  },
  diary: { future: 'app の欄。bubble は中を見ない' },
};
function ganttTodo(over = {}) {
  return Object.assign({
    id: 'g' + (1762736400000).toString(36) + 'q7r2',
    text: '架空の作業（gantt で書いた）',
    createdAt: ms(2026, 11, 9, 9, 0),
    done: false, doneAt: null, trashed: false, trashedAt: null, hold: false,
    tags: ['tproj1'],
    start: '2026-11-12', due: '2026-11-20', project: 'tproj1',
    ext: JSON.parse(JSON.stringify(GANTT_EXT)),
  }, over);
}
function docWith(todos) {
  return { v: 2, tags: [TAG], todos, lastDay: '2026-11-10' };
}
function pickShared(t) {
  return { start: t.start, due: t.due, project: t.project, ext: t.ext };
}
const WANT = { start: '2026-11-12', due: '2026-11-20', project: 'tproj1', ext: GANTT_EXT };

/* ============================================================ */

await test('保存 → 読み込みで start・due・project・ext が残る', async () => {
  let store = await open(docWith([ganttTodo()]));
  const t0 = todosOf(store).find(t => t.id.startsWith('g'));
  assert.ok(t0, 'gantt の todo が読み込めていない');
  assert.deepEqual(pickShared(t0), WANT);
  /* bubble 側で別の欄を書き換えて保存しても残る */
  store.setText(t0.id, '架空の作業（bubble で直した）');
  assert.deepEqual(pickShared(saved().todos.find(t => t.id === t0.id)), WANT);
  store = await reopen();
  assert.deepEqual(pickShared(todosOf(store).find(t => t.id === t0.id)), WANT);
});

await test('開いただけでは gantt の todo に新しい印を付けない', async () => {
  const id = ganttTodo().id;
  const stamps = { ['todo:' + id]: [ms(2026, 11, 9, 9, 0), 1], 'order:todo': [ms(2026, 11, 9, 9, 0), 1] };
  const store = await open(Object.assign(docWith([ganttTodo()]), { stamps }));
  store.flush && store.flush();
  const st = store.exportState().stamps;
  assert.deepEqual(st['todo:' + id], [ms(2026, 11, 9, 9, 0), 1]);
});

await test('applyState（fromDoc）に gantt の形を通しても欄が変わらない', async () => {
  const store = await open(null);
  const g = ganttTodo();
  assert.equal(store.applyState({ doc: docWith([g]), stamps: { ['todo:' + g.id]: [NOW, 1] } }), true);
  const out = store.exportState().doc.todos.find(t => t.id === g.id);
  assert.ok(out, 'applyState で gantt の todo が落ちた');
  assert.deepEqual(pickShared(out), WANT);
  assert.equal(out.text, g.text);
  assert.equal(out.createdAt, g.createdAt);
  assert.deepEqual(out.tags, ['tproj1']);
});

await test('mergeState を通っても欄が残る（gantt が新しければ gantt の値）', async () => {
  const g = ganttTodo();
  const old = { id: g.id, text: g.text, createdAt: g.createdAt, tags: ['tproj1'] };   /* 欄を知らない古い控え */
  const A = { doc: docWith([old]), stamps: { ['todo:' + g.id]: [NOW - 1000, 1] } };
  const B = { doc: docWith([g]), stamps: { ['todo:' + g.id]: [NOW, 1] } };
  for (const m of [mergeState(A, B), mergeState(B, A)]) {
    assert.deepEqual(pickShared(m.doc.todos.find(t => t.id === g.id)), WANT);
  }
  /* 合わせた結果を store に入れて、保存・読み込みまで通す */
  const store = await open(null);
  store.applyState(mergeState(A, B));
  const back = todosOf(await reopen()).find(t => t.id === g.id);
  assert.deepEqual(pickShared(back), WANT);
});

await test('形の違う値は落とす（日付・project・ext）', async () => {
  const bad = ganttTodo({
    start: '2026/11/12', due: 20261120, project: 'tag-that-does-not-exist', ext: ['not', 'object'],
  });
  const store = await open(docWith([bad]));
  const t = todosOf(store).find(x => x.id === bad.id);
  assert.equal(t.start, undefined);
  assert.equal(t.due, undefined);
  assert.equal(t.project, undefined);
  assert.equal(t.ext, undefined);
  /* null も省く（読む側は省いた欄を null / {} として読む） */
  const store2 = await open(docWith([ganttTodo({ start: null, due: null, project: null, ext: {} })]));
  const t2 = todosOf(store2)[0];
  assert.ok(!('start' in t2) && !('due' in t2) && !('project' in t2) && !('ext' in t2));
});

await test('欄を持たない bubble の todo は形が変わらない', async () => {
  const store = await open(null);
  const t = store.add('架空の泡');
  const rec = saved().todos.find(x => x.id === t.id);
  assert.ok(!('start' in rec) && !('due' in rec) && !('project' in rec) && !('ext' in rec));
});

await test('project のタグを消すと project も外れる', async () => {
  const store = await open(docWith([ganttTodo()]));
  const id = ganttTodo().id;
  assert.equal(store.removeTag('tproj1'), true);
  const rec = saved().todos.find(x => x.id === id);
  assert.equal(rec.project, undefined);
  assert.deepEqual(rec.ext, GANTT_EXT);
  assert.equal(rec.due, '2026-11-20');
});

/* ============================================================ */

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
