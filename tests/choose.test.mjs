/* 選ぶときの基準（2026-11-24 ユーザーの決定「OK、推奨で実施」。app_spec の minutes/261124_選ぶときの基準.md）の記録のテスト。
   見当（size）・急ぐの分け方（dueKind）・今日大事なこと（key）・先に済ませる（first）が、
     ・保存 → 読み込み・サーバーから来た記録（applyState）・2 つの端末の合わせ（mergeState）を通って残るか
     ・今日大事なことが 1 日に 1 つか、先に済ませるがさっとの泡だけ・3 つまでか
     ・区切りの時間（priority.js の firstState）と、端末に覚える始めた時刻（prefs.js）
   を見る。素の Node と assert だけ。データはすべて架空。

     node tests/choose.test.mjs */

import assert from 'node:assert/strict';
import { mergeState } from '../js/merge.js';
import { firstState, FIRST_MAX, effectiveSize, quadrantFor, showFirstRow } from '../js/priority.js';
import { firstStartedAt, markFirstStarted, firstMinutes, PREFS_KEY, FIRST_AT_KEY } from '../js/prefs.js';

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
const NOW = ms(2026, 11, 25, 9, 0);
const DAY = '2026-11-25';

let seq = 0;
async function open(raw, now = NOW) {
  mem.clear();
  if (raw !== null && raw !== undefined) mem.set(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
async function reopen(now = NOW) {
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
function saved() { return JSON.parse(mem.get(KEY)); }
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

function todo(id, over = {}) {
  return Object.assign({ id, text: '架空の泡 ' + id, createdAt: ms(2026, 11, 20), days: [], done: false, trashed: false }, over);
}
function docWith(todos) { return { v: 2, tags: [], todos, lastDay: DAY }; }
const pick = t => ({ size: t.size, dueKind: t.dueKind, key: t.key, first: t.first });

/* ============================================================ */

await test('読み込み: 4 つの欄の形を確かめる。値の無い・形の合わない欄は置かない（前の記録の形のまま）', async () => {
  const store = await open(docWith([
    todo('b1', { size: 's', urgent: true, dueKind: 'ext', key: ['2026-11-25', 'x', '2026-11-25'], first: ['2026-11-25'] }),
    todo('b2', { size: 'xl', dueKind: 'later', key: [], first: 'no' }),
    todo('b3'),
  ]));
  const [a, b, c] = ['b1', 'b2', 'b3'].map(id => todosOf(store).find(t => t.id === id));
  assert.deepEqual(pick(a), { size: 's', dueKind: 'ext', key: ['2026-11-25'], first: ['2026-11-25'] });
  for (const t of [b, c]) for (const k of ['size', 'dueKind', 'key', 'first']) assert.equal(k in t, false, t.id + ' に ' + k);
});

await test('保存 → 読み込み・applyState・mergeState を通って残る（記録ごとに新しいほう）', async () => {
  let store = await open(docWith([todo('b1', { days: [DAY] })]));
  assert.equal(store.setPriority('b1', { urgent: true, important: true, dueKind: 'ext', size: 'l' }), true);
  assert.equal(store.setKey('b1', DAY, true), true);
  assert.deepEqual(pick(saved().todos.find(t => t.id === 'b1')), { size: 'l', dueKind: 'ext', key: [DAY], first: undefined });
  store = await reopen();
  const back = todosOf(store).find(t => t.id === 'b1');
  assert.deepEqual(pick(back), { size: 'l', dueKind: 'ext', key: [DAY], first: undefined });
  /* サーバーから来た記録 */
  const st2 = await open(null);
  assert.equal(st2.applyState(store.exportState()), true);
  assert.deepEqual(pick(todosOf(st2).find(t => t.id === 'b1')), pick(back));
  /* 2 つの端末の合わせ: 欄を知らない古い控え（古い時刻）と、新しい記録 */
  const old = todo('b1', { days: [DAY] });
  const A = { doc: docWith([old]), stamps: { 'todo:b1': [NOW - 1000, 1] } };
  const B = { doc: docWith([back]), stamps: { 'todo:b1': [NOW, 1] } };
  for (const m of [mergeState(A, B), mergeState(B, A)]) assert.deepEqual(pick(m.doc.todos.find(t => t.id === 'b1')), pick(back));
  /* 新しい端末が欄を外したら、外したほうが残る（記録ごとに新しいほう） */
  const C = { doc: docWith([todo('b1', { days: [DAY] })]), stamps: { 'todo:b1': [NOW + 1000, 1] } };
  assert.equal('size' in mergeState(B, C).doc.todos.find(t => t.id === 'b1'), false);
});

await test('急ぐの分け方: urgent:true のときだけ。急ぐを外すと dueKind も消える。区分は urgent・important だけから', async () => {
  const store = await open(docWith([todo('b1'), todo('b2', { urgent: true, important: false })]));
  assert.deepEqual(store.choiceOf('b2'), { urgent: true, important: false, dueKind: 'self', size: null }, '無ければ自分の目安');
  store.setPriority('b1', { urgent: false, important: true, dueKind: 'ext' });
  assert.equal('dueKind' in store.get('b1'), false, '急がない泡には付けない');
  store.setPriority('b1', { urgent: true, dueKind: 'ext' });
  assert.equal(store.get('b1').dueKind, 'ext');
  assert.equal(store.quadrantOf('b1'), quadrantFor(true, true));
  store.setPriority('b1', { urgent: false });
  assert.equal('dueKind' in store.get('b1'), false);
  store.setQuadrant('b2', 'now');
  assert.equal(store.quadrantOf('b2'), 'now');
});

await test('今日大事なこと: 1 日に 1 つ。付けるとほかの泡から同じ日を外し、その日に置く。別の日はそのまま', async () => {
  const store = await open(docWith([todo('a', { days: [DAY], key: [DAY, '2026-11-24'] }), todo('b'), todo('c', { done: true, key: [DAY] })]));
  assert.equal(store.setKey('b', DAY, true), true);
  assert.deepEqual(store.get('a').key, ['2026-11-24'], 'ほかの日の印は残る');
  assert.equal('key' in store.get('c'), false, '完了した泡からも外す');
  assert.deepEqual(store.get('b').key, [DAY]);
  assert.ok(store.daysOf('b').includes(DAY), '付けるとその日に置く');
  assert.equal(store.keyItem(DAY).id, 'b');
  const live = todosOf(store).filter(t => Array.isArray(t.key) && t.key.includes(DAY));
  assert.deepEqual(live.map(t => t.id), ['b']);
  /* 外す */
  assert.equal(store.setKey('b', DAY, false), true);
  assert.equal(store.keyItem(DAY), null);
  assert.equal('key' in store.get('b'), false, '空になったら欄ごと消す');
  /* その日から外したら印も外す */
  store.setKey('a', DAY, true);
  store.setDay('a', DAY, false);
  assert.equal(store.keyItem(DAY), null);
  assert.deepEqual(store.get('a').key, ['2026-11-24']);
});

await test('今日大事なこと: 2 つの端末で別々に決めて合わさったら、書いた時刻の新しいほうを出す', async () => {
  const doc = docWith([todo('a', { days: [DAY], key: [DAY] }), todo('b', { days: [DAY], key: [DAY] })]);
  const store = await open(Object.assign(doc, { stamps: { 'todo:a': [NOW - 5000, 1], 'todo:b': [NOW - 100, 1] } }));
  assert.equal(store.keyItem(DAY).id, 'b');
});

await test('先に済ませる: さっとの泡だけ・1 日に 3 つまで。入れるとその日に置く。さっとでなくなると外れる', async () => {
  const store = await open(docWith(['a', 'b', 'c', 'd', 'e'].map(id => todo(id, { size: 's' })).concat([todo('m', { size: 'm' })])));
  assert.equal(store.setFirst('m', DAY, true), 'size');
  assert.equal(store.setFirst('a', DAY, true), 'ok');
  assert.ok(store.daysOf('a').includes(DAY));
  assert.equal(store.setFirst('a', DAY, true), 'same');
  assert.equal(store.setFirst('b', DAY, true), 'ok');
  assert.equal(store.setFirst('c', DAY, true), 'ok');
  assert.equal(FIRST_MAX, 3);
  assert.equal(store.setFirst('d', DAY, true), 'full');
  assert.deepEqual(store.firstItems(DAY).map(t => t.id), ['a', 'b', 'c']);
  /* 別の日は別の席 */
  assert.equal(store.setFirst('d', '2026-11-26', true), 'ok');
  /* 外すと席が空く。泡はその日に残る（今日の水面に戻る） */
  assert.equal(store.setFirst('a', DAY, false), 'ok');
  assert.ok(store.daysOf('a').includes(DAY));
  assert.equal(store.setFirst('e', DAY, true), 'ok');
  /* 見当をさっとから変えたら、先に済ませるから外れる */
  store.setPriority('b', { size: 'l' });
  assert.equal(store.isFirst('b', DAY), false);
  assert.deepEqual(store.firstItems(DAY).map(t => t.id), ['c', 'e']);
});

await test('区切りの時間: 始めた時刻＋分。過ぎるか、入れた泡が全部済むと畳む。過ぎたら入れない', () => {
  const t0 = ms(2026, 11, 25, 9, 0);
  const rows = [{ done: false }, { done: true }];
  let s = firstState(rows, t0, 30, t0 + 10 * 60000);
  assert.deepEqual(s, { open: true, endAt: t0 + 30 * 60000, canAdd: true, passed: false });
  s = firstState(rows, t0, 30, t0 + 30 * 60000);
  assert.equal(s.open, false); assert.equal(s.passed, true); assert.equal(s.canAdd, false);
  s = firstState([{ done: true }], t0, 30, t0 + 60000);
  assert.equal(s.open, false, '全部済んだら畳む'); assert.equal(s.canAdd, true, '区切りの時間の前なら、まだ入れられる');
  s = firstState([{}, {}, {}], t0, 30, t0 + 60000);
  assert.equal(s.canAdd, false, '3 つまで');
  s = firstState([], null, 30, t0);
  assert.deepEqual(s, { open: false, endAt: null, canAdd: true, passed: false });
});

await test('始めた時刻は端末に覚える（1 回目だけ）。区切りの分は設定の firstMin（既定 30）', () => {
  mem.clear();
  assert.equal(firstStartedAt(DAY), null);
  assert.equal(markFirstStarted(DAY, 1000), 1000);
  assert.equal(markFirstStarted(DAY, 2000), 1000, '2 回目は上書きしない');
  assert.equal(firstStartedAt(DAY), 1000);
  assert.ok(FIRST_AT_KEY.startsWith('bubble_todo'), '「すべて初期化」で消える名前');
  for (let i = 1; i <= 9; i++) markFirstStarted('2026-11-0' + i, i);
  assert.equal(Object.keys(JSON.parse(mem.get(FIRST_AT_KEY))).length, 7, '7 日ぶんだけ残す');
  assert.equal(firstMinutes(), 30);
  mem.set(PREFS_KEY, JSON.stringify({ firstMin: '45' }));
  assert.equal(firstMinutes(), 45);
});

await test('1 回分: 何回もで次にやることがあれば半日まで', () => {
  assert.equal(effectiveSize('l', true), 'm');
  assert.equal(effectiveSize('l', false), 'l');
  assert.equal(effectiveSize('s', true), 's');
  assert.equal(effectiveSize(undefined, true), null);
});

await test('くりかえしの写しは見当・急ぐの分け方を写し、今日大事なこと・先に済ませるは写さない', async () => {
  const store = await open(docWith([todo('r', { size: 's', urgent: true, important: false, dueKind: 'ext', days: [DAY],
    key: [DAY], first: [DAY], ext: { bubble: { repeat: { every: 'week', of: 'day', step: 1, from: DAY, dows: [3], at: DAY } } } })]));
  const before = todosOf(store).length;
  store.complete('r');
  const all = todosOf(store);
  assert.equal(all.length, before + 1, '次の回の写しができる');
  const c = all.find(t => t.id !== 'r');
  assert.equal(c.size, 's');
  assert.equal(c.dueKind, 'ext');
  assert.equal('key' in c || 'first' in c, false);
});

await test('先に済ませるの段を出すとき（2026-11-24「先にやるの枠がない」）: 1 つも入れていない朝も出す。全部済む・区切りの時間が過ぎたら畳む', () => {
  const t0 = ms(2026, 11, 25, 9, 0);
  assert.equal(showFirstRow(firstState([], null, 30, t0), 0), true, 'まだ入れていない＝空いた席を見せる');
  assert.equal(showFirstRow(firstState([{ done: false }], t0, 30, t0 + 60000), 1), true);
  assert.equal(showFirstRow(firstState([{ done: true }], t0, 30, t0 + 60000), 1), false, '全部済んだら畳む');
  assert.equal(showFirstRow(firstState([{ done: false }], t0, 30, t0 + 31 * 60000), 1), false, '区切りの時間が過ぎたら畳む');
  assert.equal(showFirstRow(null, 0), false);
});

console.log('\n' + pass + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
