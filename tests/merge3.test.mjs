/* 3 方向の合わせ（js/merge.js の mergeState3・mergeTodo3。2026-11-26）のテスト。
   素の Node と assert だけで走る。データはすべて架空。

     node tests/merge3.test.mjs

   起きたこと: 古い写しを持った盤が、泡を日に置いた（days に足し first を付けた）だけで、
   その間に秘書が直した本文・足した日を、todo の記録ごと古い値で戻した。
   盤は最後にサーバーと一致していたときの todo（base）と比べ、両方が変えた todo だけ欄ごとに合わせる。 */

import assert from 'node:assert/strict';
import { mergeState, mergeState3, mergeTodo3, sameStamps } from '../js/merge.js';

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

const T0 = 1764000000000, T1 = T0 + 60000, T2 = T0 + 120000;
const todo = o => Object.assign({ id: 'q1', text: '架空の泡', detail: 'A', days: ['2026-11-25'] }, o);
const state = (t, at, extra = {}) => ({
  doc: Object.assign({ todos: [t], log: [] }, extra.doc || {}),
  stamps: Object.assign({ 'todo:q1': [at, 1], 'order:todo': [T0, 1] }, extra.stamps || {}),
});

/* 起きたことそのもの */
const base = { todos: [todo({})] };
const remote = state(todo({ detail: 'B', days: ['2026-11-25', '2026-11-28'], firstStep: '紙を出す' }), T1);
const local = state(todo({ days: ['2026-11-25', '2026-11-26'], first: ['2026-11-26'] }), T2);

await test('秘書の本文・足した日が、古い写しの盤の日に置いた書き換えで戻らない', async () => {
  const m = mergeState3(base, local, remote);
  const t = m.doc.todos[0];
  assert.equal(t.detail, 'B', '秘書の本文');
  assert.equal(t.firstStep, '紙を出す', '秘書が足した欄');
  assert.deepEqual(t.days, ['2026-11-25', '2026-11-26', '2026-11-28'], '両方の足した日');
  assert.deepEqual(t.first, ['2026-11-26'], '盤の先に済ませる');
  assert.ok(m.stamps['todo:q1'][0] > T2, '両方より新しい印（どちらにも届く）');
  assert.equal(m.stamps['todo:q1'][1], 1);
});

await test('前の合わせ方（mergeState）では盤の古い写しが丸ごと勝つ（直す前の不具合の再現）', async () => {
  const t = mergeState(local, remote).doc.todos[0];
  assert.equal(t.detail, 'A');
  assert.deepEqual(t.days, ['2026-11-25', '2026-11-26']);
});

await test('手元と相手を入れ替えても同じ答え', async () => {
  const x = mergeState3(base, local, remote), y = mergeState3(base, remote, local);
  assert.deepEqual(x.doc.todos, y.doc.todos);
  assert.ok(sameStamps(x.stamps, y.stamps));
});

await test('合わせた結果をサーバーに送ると、次は止まる（行ったり来たりしない）', async () => {
  const m = mergeState3(base, local, remote);
  /* 盤は m を送り、base を m にする。サーバーも m。次の合わせ */
  const again = mergeState3({ todos: m.doc.todos }, m, m);
  assert.ok(sameStamps(again.stamps, m.stamps));
  assert.deepEqual(again.doc.todos, m.doc.todos);
  /* base がまだ古いまま（PUT の答えを受け取る前に落ちた）でも、同じものどうしなら動かない */
  const stale = mergeState3(base, m, m);
  assert.ok(sameStamps(stale.stamps, m.stamps));
  /* 秘書が m を取り直して何も変えずに置いても、盤は動かない */
  assert.ok(sameStamps(mergeState3({ todos: m.doc.todos }, m, JSON.parse(JSON.stringify(m))).stamps, m.stamps));
});

await test('同じ欄を両方が変えたら、新しいほうの値', async () => {
  const r = state(todo({ detail: '秘書' }), T1);
  const l = state(todo({ detail: '盤', fav: true }), T2);
  const t = mergeState3(base, l, r).doc.todos[0];
  assert.equal(t.detail, '盤');
  assert.equal(t.fav, true);
  const r2 = state(todo({ detail: '秘書', fav: false }), T2 + 5);
  const t2 = mergeState3(base, l, r2).doc.todos[0];
  assert.equal(t2.detail, '秘書', '相手のほうが新しければ相手');
  assert.equal(t2.fav, false);
});

await test('片方が外した日・消した欄は、もう片方の別の書き換えがあっても戻らない', async () => {
  const b = { todos: [todo({ days: ['2026-11-25', '2026-11-26'], url: 'https://example.org/a', first: ['2026-11-26'] })] };
  /* 秘書（古い）: 11-26 を外し、url を消す */
  const r = state(todo({ days: ['2026-11-25'], first: ['2026-11-26'] }), T1);
  /* 盤（新しい）: 11-27 を足し、first を外し、本文を直す */
  const l = state(todo({ days: ['2026-11-25', '2026-11-26', '2026-11-27'], url: 'https://example.org/a', detail: 'C' }), T2);
  const t = mergeState3(b, l, r).doc.todos[0];
  assert.deepEqual(t.days, ['2026-11-25', '2026-11-27']);
  assert.ok(!('url' in t), '秘書が消した欄は無いまま');
  assert.ok(!('first' in t), '盤が外した first は無いまま（空の欄も置かない）');
  assert.equal(t.detail, 'C');
});

await test('base が無い・その todo が base に無いときは、今までどおり新しいほう', async () => {
  for (const b of [null, undefined, {}, { todos: 'x' }, { todos: [todo({ id: 'other' })] }]) {
    const m = mergeState3(b, local, remote), old = mergeState(local, remote);
    assert.deepEqual(m.doc.todos, old.doc.todos);
    assert.ok(sameStamps(m.stamps, old.stamps));
  }
});

await test('片方しか base から変えていなければ、今までどおり（印も変えない）', async () => {
  const same = state(todo({}), T1);
  const m = mergeState3(base, local, same), old = mergeState(local, same);
  assert.deepEqual(m.doc.todos, old.doc.todos);
  assert.ok(sameStamps(m.stamps, old.stamps));
});

await test('片方が消した（墓石）todo は合わせない', async () => {
  const gone = { doc: { todos: [], log: [] }, stamps: { 'todo:q1': [T1, 0], 'order:todo': [T1, 1] } };
  const m = mergeState3(base, local, gone);
  assert.deepEqual(m.doc.todos.map(t => t.detail), ['A']);
  assert.deepEqual(m.stamps['todo:q1'], [T2, 1]);
});

await test('firstSpan は合わせたあとも早く書いたほうが残る', async () => {
  const early = { start: null, due: '2026-12-01', at: T0 + 1 };
  const late = { start: '2026-11-30', due: '2026-12-02', at: T0 + 2 };
  const r = state(todo({ detail: 'B', firstSpan: early }), T1);
  const l = state(todo({ days: ['2026-11-25', '2026-11-26'], firstSpan: late }), T2);
  const t = mergeState3(base, l, r).doc.todos[0];
  assert.deepEqual(t.firstSpan, early);
  assert.equal(t.detail, 'B');
});

await test('入力を書き換えない', async () => {
  const snap = JSON.stringify([base, local, remote]);
  mergeState3(base, local, remote);
  assert.equal(JSON.stringify([base, local, remote]), snap);
});

await test('mergeTodo3: 欄ごとの決まり', async () => {
  const b = { id: 'z', a: 1, b: 1, c: 1, days: ['2026-01-01'] };
  const w = { id: 'z', a: 2, b: 1, c: 3, days: ['2026-01-01', '2026-01-02'], n: 'w' };
  const l = { id: 'z', a: 1, b: 4, c: 5, days: [], m: 'l' };
  assert.deepEqual(mergeTodo3(b, w, l), { id: 'z', a: 2, b: 4, c: 3, days: ['2026-01-02'], n: 'w', m: 'l' });
});

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
