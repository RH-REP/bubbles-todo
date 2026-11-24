/* 最初の期間（todo の firstSpan。2026-11-24 ユーザーの決定。gantt の minutes/261124_目安と週の組み立て.md の 1）のテスト。
   素の Node と assert だけで走る。データはすべて架空。

     node tests/firstspan.test.mjs

   1. 書くとき（js/store.js の setSpan）: 期間が空から値になった最初の 1 回だけ。直しても・外しても・付け直しても変えない。
      期限だけなら start:null。先の予定（js/events.js）も setSpan を通るので同じ
   2. くりかえしの写し: 元の firstSpan を写さず、写しの期間で新しく書く
   3. 読み書き: 保存・読み込みで落ちない。形の合わないものは欄を置かない
   4. 合わせ方（js/merge.js）: firstSpan を知らない古い写しが後から書いても消えない。違う値なら早く書いたほう */

import assert from 'node:assert/strict';
import { mergeState } from '../js/merge.js';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
const KEY = 'bubble_todo_v1';
const STORE_URL = new URL('../js/store.js', import.meta.url).href;
const REAL_NOW = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
const ms = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();

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
let seq = 0;
async function open(raw, now) {
  mem.clear();
  if (raw) mem.set(KEY, JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?fs=${++seq}`)).store;
}
const saved = () => JSON.parse(mem.get(KEY));
const savedTodo = (id) => saved().todos.find(t => t.id === id);

await test('期間を初めて書いたときに 1 回だけ書く。直しても・外しても・付け直しても変えない', async () => {
  const T0 = ms(2026, 11, 24);
  const store = await open(null, T0);
  const t = store.add('架空の資料づくり');
  assert.equal(savedTodo(t.id).firstSpan, undefined, '期間が無いうちは書かない');
  store.setSpan(t.id, '2026-11-25', '2026-11-28');
  const fs = { start: '2026-11-25', due: '2026-11-28', at: T0 };
  assert.deepEqual(savedTodo(t.id).firstSpan, fs);
  fakeNow = T0 + 1000;
  store.setSpan(t.id, '2026-11-26', '2026-12-05');
  assert.deepEqual(savedTodo(t.id).firstSpan, fs, '直しても変えない');
  store.setSpan(t.id, '', '');
  assert.equal(savedTodo(t.id).start, undefined);
  assert.deepEqual(savedTodo(t.id).firstSpan, fs, '外しても消さない');
  store.setSpan(t.id, '2026-12-10', '2026-12-11');
  assert.deepEqual(savedTodo(t.id).firstSpan, fs, '付け直しても変えない');
});

await test('期限だけ入れたときは start:null（setSpan が start＝due にする前の入力のまま）', async () => {
  const T0 = ms(2026, 11, 24);
  const store = await open(null, T0);
  const t = store.add('架空の提出');
  store.setSpan(t.id, '', '2026-12-01');
  assert.equal(savedTodo(t.id).start, '2026-12-01', '期間は今までどおり start＝due');
  assert.deepEqual(savedTodo(t.id).firstSpan, { start: null, due: '2026-12-01', at: T0 });
  const u = store.add('架空の開始だけ');
  store.setSpan(u.id, '2026-12-03', '');
  assert.deepEqual(savedTodo(u.id).firstSpan, { start: '2026-12-03', due: '2026-12-03', at: T0 }, '開始だけはその日 1 日');
});

await test('前の版で期間を持っていた泡には、あとから書かない（初めて書いた時が分からない）', async () => {
  const raw = { v: 2, tags: [], todos: [{ id: 'old1', text: '架空の前の泡', createdAt: 1, days: [], tags: [], start: '2026-11-01', due: '2026-11-03' }] };
  const store = await open(raw, ms(2026, 11, 24));
  store.setSpan('old1', '2026-11-02', '2026-11-09');
  assert.equal(savedTodo('old1').firstSpan, undefined);
});

await test('先の予定（js/events.js の addEvents）で入れた泡も、予定の期間で 1 回だけ書く', async () => {
  const E = await import('../js/events.js');
  const T0 = ms(2026, 11, 4);
  const store = await open(null, T0);
  const [cp, fomc] = E.normalizeEvents([
    { date: '2026-11-01', end: '2026-11-30', title: '架空の還元', topic: 'pay', status: 'confirmed' },
    { date: '2026-12-10', title: '架空の会合', topic: 'fomc', status: 'confirmed' },
  ], '2026-11-04');
  const got = E.addEvents(store, [{ ev: cp, lead: 'e3' }, { ev: fomc, lead: 3 }], '2026-11-04').added;
  assert.deepEqual(savedTodo(got[0].id).firstSpan, { start: '2026-11-01', due: '2026-11-30', at: T0 });
  assert.deepEqual(savedTodo(got[1].id).firstSpan, { start: '2026-12-10', due: '2026-12-10', at: T0 });
});

await test('くりかえしの写しは、元の firstSpan を写さず写しの期間で新しく書く', async () => {
  const T0 = ms(2026, 8, 20), T1 = ms(2026, 8, 30);
  const store = await open(null, T0);
  const t = store.add('架空の月の作業');
  store.setSpan(t.id, '2026-08-25', '2026-09-03');
  store.setRepeat(t.id, true);
  fakeNow = T1;
  store.complete(t.id);
  const c = saved().todos.find(x => x.id !== t.id && x.text === '架空の月の作業');
  assert.deepEqual(savedTodo(t.id).firstSpan, { start: '2026-08-25', due: '2026-09-03', at: T0 });
  assert.deepEqual(c.firstSpan, { start: c.start, due: c.due, at: T1 });
  assert.equal(c.start, '2026-09-25');
});

await test('保存・読み込みで落ちない。形の合わないものは欄を置かない', async () => {
  const good = { start: null, due: '2026-12-01', at: 1764000000000 };
  const raw = { v: 2, tags: [], todos: [
    { id: 'a', text: '架空A', createdAt: 1, days: [], tags: [], start: '2026-12-01', due: '2026-12-01', firstSpan: good },
    { id: 'b', text: '架空B', createdAt: 2, days: [], tags: [], firstSpan: { start: 'きのう', due: '2026-12-01', at: 5 } },
    { id: 'c', text: '架空C', createdAt: 3, days: [], tags: [], firstSpan: { due: '2026-12-01' } },
  ] };
  const store = await open(raw, ms(2026, 11, 24));
  store.setText('a', '架空A（直した）');
  assert.deepEqual(savedTodo('a').firstSpan, good);
  assert.equal(savedTodo('b').firstSpan, undefined);
  assert.equal(savedTodo('c').firstSpan, undefined);
  /* 形の合わないものは無いのと同じ。初めて期間を書けば書く */
  store.setSpan('c', '2026-12-02', '2026-12-04');
  assert.equal(savedTodo('c').firstSpan.due, '2026-12-04');
});

await test('合わせ方：firstSpan を知らない古い写しが後から書いても消えない。違う値なら早く書いたほう', async () => {
  const fs = { start: null, due: '2026-12-01', at: 100 };
  const A = { doc: { todos: [{ id: 'x', text: '架空', createdAt: 1, firstSpan: fs }] }, stamps: { 'todo:x': [10, 1] } };
  const B = { doc: { todos: [{ id: 'x', text: '架空（古い写しで直した）', createdAt: 1 }] }, stamps: { 'todo:x': [20, 1] } };
  for (const m of [mergeState(A, B), mergeState(B, A)]) {
    const t = m.doc.todos[0];
    assert.equal(t.text, '架空（古い写しで直した）', 'ほかの欄は新しいほう');
    assert.deepEqual(t.firstSpan, fs);
  }
  const C = { doc: { todos: [{ id: 'x', text: '架空', createdAt: 1, firstSpan: { start: '2026-11-30', due: '2026-12-09', at: 300 } }] }, stamps: { 'todo:x': [30, 1] } };
  assert.deepEqual(mergeState(A, C).doc.todos[0].firstSpan, fs);
  assert.deepEqual(mergeState(C, A).doc.todos[0].firstSpan, fs);
  assert.equal(B.doc.todos[0].firstSpan, undefined, '受け取った記録は書き換えない');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
