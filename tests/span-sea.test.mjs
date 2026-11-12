/* 期間（start・due）で基本の海と長期保留を分ける（共有の記録 v1.5 §11。2026-11-12 利用者の決定）のテスト。
   素の Node と assert だけで走る。データはすべて架空。

     node tests/span-sea.test.mjs

   見るのは store の判定（store.spanHeld / spanHeldItems）と、**記録を書き換えないこと**。
   海の振り分け（js/screens/sea.js）は画面が要るので、ブラウザで確かめる。 */

import assert from 'node:assert/strict';

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
const NOW = ms(2026, 11, 12, 10, 0);          /* 今日 = 2026-11-12 */

let seq = 0;
async function open(raw, now = NOW) {
  mem.clear();
  if (raw) mem.set(KEY, JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}

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

function todo(id, over = {}) {
  return Object.assign({ id, text: '架空の ' + id, createdAt: ms(2026, 11, 1), days: [], hold: false, tags: [] }, over);
}
const STAMP = [ms(2026, 11, 1), 1];
function docOf(todos) {
  const stamps = { 'order:todo': STAMP };
  todos.forEach(t => { stamps['todo:' + t.id] = STAMP; });
  return { v: 2, todos, tags: [], lastDay: '2026-11-12', stamps };
}

/* ============================================================ */

await test('期間の中・外の判定（両方・start だけ・due だけ。境目の日は中）', async () => {
  const store = await open(docOf([
    todo('both_in', { start: '2026-11-10', due: '2026-11-20' }),
    todo('both_first', { start: '2026-11-12', due: '2026-11-20' }),   /* 今日が始まりの日 */
    todo('both_last', { start: '2026-11-01', due: '2026-11-12' }),    /* 今日が終わりの日 */
    todo('both_before', { start: '2026-11-13', due: '2026-11-20' }),
    todo('both_after', { start: '2026-11-01', due: '2026-11-11' }),
    todo('start_in', { start: '2026-11-12' }),
    todo('start_before', { start: '2026-12-01' }),
    todo('due_in', { due: '2026-11-12' }),
    todo('due_after', { due: '2026-11-11' }),
    todo('none'),
  ]));
  const got = Object.fromEntries(store.all().map(t => [t.id, store.spanHeld(t.id)]));
  assert.deepEqual(got, {
    both_in: null, both_first: null, both_last: null, both_before: 'before', both_after: 'after',
    start_in: null, start_before: 'before', due_in: null, due_after: 'after', none: null,
  });
  assert.deepEqual(store.spanHeldItems().map(t => t.id).sort(), ['both_after', 'both_before', 'due_after', 'start_before']);
});

await test('手で長期保留・今日に置いた・完了・消したものは回さない。本文の古い「期間:」行は見ない', async () => {
  const store = await open(docOf([
    todo('hold_out', { hold: true, start: '2026-12-01' }),
    todo('hold_in', { hold: true, start: '2026-11-01', due: '2026-11-30' }),
    todo('today_out', { days: ['2026-11-12'], start: '2026-12-01' }),
    todo('done_out', { done: true, doneAt: ms(2026, 11, 2), due: '2026-11-01' }),
    todo('legacy', { detail: '期間: 2026-12-01 〜 2026-12-05' }),
  ]));
  ['hold_out', 'hold_in', 'today_out', 'done_out', 'legacy'].forEach(id => assert.equal(store.spanHeld(id), null, id));
  assert.equal(store.isHold('hold_in'), true, '手の長期保留は期間の中でも長期保留のまま');
  assert.equal(store.isHold('legacy'), false);
  assert.deepEqual(store.spanHeldItems(), []);
});

await test('記録は書き換えない（hold は false のまま、印も変わらない、保存もしない）', async () => {
  const raw = docOf([todo('g1', { start: '2026-12-01', due: '2026-12-05' }), todo('g2', { due: '2026-11-01' })]);
  const store = await open(raw);
  const before = mem.get(KEY);
  assert.equal(store.spanHeld('g1'), 'before');
  assert.equal(store.spanHeld('g2'), 'after');
  store.spanHeldItems();
  assert.equal(store.isHold('g1'), false);
  assert.equal(store.isHold('g2'), false);
  assert.deepEqual(store.holds(), [], '記録の長期保留の一覧には入らない');
  assert.ok(!store.tagsOf('g1').includes('hold'), 'タグ（記録）としての長期保留は付かない');
  assert.equal(mem.get(KEY), before, '判定だけで保存し直さない');
  const st = store.exportState().stamps;
  assert.deepEqual([st['todo:g1'], st['todo:g2']], [STAMP, STAMP]);
});

await test('日が変われば決め直す（同じ記録で、始まりの日に基本の海へ、終わった次の日に長期保留へ）', async () => {
  const raw = docOf([todo('g1', { start: '2026-11-15', due: '2026-11-16' })]);
  assert.equal((await open(raw, ms(2026, 11, 14, 23, 59))).spanHeld('g1'), 'before');
  assert.equal((await open(raw, ms(2026, 11, 15, 0, 0))).spanHeld('g1'), null);
  assert.equal((await open(raw, ms(2026, 11, 16, 23, 59))).spanHeld('g1'), null);
  assert.equal((await open(raw, ms(2026, 11, 17, 0, 0))).spanHeld('g1'), 'after');
  /* 開いたまま日をまたいでも（Date.now だけが進む）判定は今日で決め直る */
  const store = await open(raw, ms(2026, 11, 14, 12, 0));
  assert.equal(store.spanHeld('g1'), 'before');
  fakeNow = ms(2026, 11, 15, 9, 0);
  assert.equal(store.spanHeld('g1'), null);
  /* 日付キーを渡せばその日で見る */
  assert.equal(store.spanHeld('g1', '2026-11-20'), 'after');
});

await test('盤で期間を変える・消すと、その場で基本の海の側に戻る。今日に置いても戻る', async () => {
  const store = await open(docOf([todo('g1', { start: '2026-12-01', due: '2026-12-05' }), todo('g2', { due: '2026-11-01' })]));
  assert.equal(store.spanHeld('g1'), 'before');
  store.setSpan('g1', '2026-11-10', '2026-12-05');
  assert.equal(store.spanHeld('g1'), null);
  store.setSpan('g1', '', '');
  assert.equal(store.spanHeld('g1'), null);
  assert.equal(store.spanHeld('g2'), 'after');
  store.setDay('g2', store.todayKey(), true);
  assert.equal(store.spanHeld('g2'), null, '今日に置いたものは今日に出す');
  assert.equal(store.isHold('g2'), false);
});

await test('期間の外のものを手で長期保留にすると、記録の長期保留になる（期間が始まっても残る）', async () => {
  const store = await open(docOf([todo('g1', { start: '2026-12-01' })]));
  assert.equal(store.setTag('g1', 'hold'), true, '札を押すと手の長期保留になる');
  assert.equal(store.isHold('g1'), true);
  assert.equal(store.spanHeld('g1'), null, '手の長期保留は期間の判定より先');
  assert.equal(store.spanHeld('g1', '2026-12-02'), null);
});

/* ============================================================ */

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
