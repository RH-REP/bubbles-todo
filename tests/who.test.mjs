/* 記録の形 v1.2 の 3 つの欄（assignee・added_by・done_by。2026-11-18）のテスト。
   仕様: AI_note/アプリのデザイン/261118_利用者登録と個人・共有の海/実装の取り決め.md §3
   素の Node と assert だけで走る。データはすべて架空。

     node tests/who.test.mjs

   ・書く人（setActor）がいるときだけ added_by・done_by を入れる。完了を外したら done_by は null
   ・担当（setAssignee）は利用者の番号か null。形の合わない値は落とす
   ・保存 → 読み込み、2 つの端末の合わせ（merge.js）を通っても残る。欄の無い泡は欄を置かない */

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

let seq = 0;
async function open(raw) {
  mem.clear();
  if (raw) mem.set(KEY, JSON.stringify(raw));
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
function saved() { return JSON.parse(mem.get(KEY)); }
function todoOf(raw, id) { return (raw.doc ? raw.doc.todos : raw.todos).find(t => t.id === id); }

let pass = 0;
async function test(name, fn) {
  await fn();
  pass += 1;
  console.log('ok   - ' + name);
}

const ME = 'u_7f3a01bc';
const YUKI = 'u_2c90aa11';

await test('書く人がいなければ欄を置かない（この端末の海・前の記録の形のまま）', async () => {
  const store = await open(null);
  const t = store.add('牛乳');
  store.complete(t.id);
  const row = todoOf(saved(), t.id);
  for (const k of ['assignee', 'added_by', 'done_by']) assert.equal(Object.prototype.hasOwnProperty.call(row, k), false, k);
});

await test('書く人がいれば added_by・done_by を入れ、完了を外したら done_by は null', async () => {
  const store = await open(null);
  store.setActor(() => ME);
  const t = store.add('粗大ごみの申込');
  assert.equal(todoOf(saved(), t.id).added_by, ME);
  store.complete(t.id);
  assert.equal(todoOf(saved(), t.id).done_by, ME);
  store.uncomplete(t.id);
  assert.equal(todoOf(saved(), t.id).done_by, null);
  assert.deepEqual(store.whoOf(t.id), { assignee: null, added_by: ME, done_by: null });
  store.setActor(() => 'わたし');          /* 形の合わない番号は入れない */
  const t2 = store.add('電池');
  assert.equal(Object.prototype.hasOwnProperty.call(todoOf(saved(), t2.id), 'added_by'), false);
});

await test('担当は利用者の番号か null', async () => {
  const store = await open(null);
  const t = store.add('洗剤');
  assert.equal(store.setAssignee(t.id, null), false, '欄が無いのに null は書かない');
  assert.equal(store.setAssignee(t.id, YUKI), true);
  assert.equal(todoOf(saved(), t.id).assignee, YUKI);
  assert.equal(store.setAssignee(t.id, YUKI), false, '同じなら書かない');
  assert.equal(store.setAssignee(t.id, 'nope'), true, '形の合わない値は外す（null）');
  assert.equal(todoOf(saved(), t.id).assignee, null);
});

await test('読み込みと 2 つの端末の合わせを通っても残る。形の合わない値は落とす', async () => {
  const raw = { todos: [
    { id: 'a', text: '牛乳', createdAt: 1, assignee: YUKI, added_by: ME, done: true, doneAt: 2, done_by: YUKI },
    { id: 'b', text: '電池', createdAt: 1, assignee: 'だれか', added_by: null },
  ] };
  const store = await open(raw);
  store.setText('a', '牛乳 2 本');           /* 書いて保存させる */
  const a = todoOf(saved(), 'a');
  assert.deepEqual([a.assignee, a.added_by, a.done_by], [YUKI, ME, YUKI]);
  const b = todoOf(saved(), 'b');
  assert.equal(Object.prototype.hasOwnProperty.call(b, 'assignee'), false, '形の合わない担当は落とす');
  assert.equal(b.added_by, null, 'null はそのまま');
  /* 合わせ（js/merge.js）: 新しい印の側の担当が残り、ほかの欄も落ちない */
  const base = { id: 'a', text: '牛乳', createdAt: 1, assignee: YUKI, added_by: ME, done: true, doneAt: 2, done_by: YUKI };
  const A = { doc: { todos: [base] }, stamps: { 'todo:a': [100, 1] } };
  const B = { doc: { todos: [Object.assign({}, base, { assignee: ME })] }, stamps: { 'todo:a': [200, 1] } };
  for (const m of [mergeState(A, B), mergeState(B, A)]) {
    const x = m.doc.todos.find(t => t.id === 'a');
    assert.deepEqual([x.assignee, x.added_by, x.done_by], [ME, ME, YUKI]);
  }
  const s2 = await open(null);
  s2.applyState(mergeState(A, B));
  assert.deepEqual(s2.whoOf('a'), { assignee: ME, added_by: ME, done_by: YUKI });
});

console.log(`\nwho: ${pass} passed`);
