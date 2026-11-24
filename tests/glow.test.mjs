/* 輝く泡（2026-11-24 ユーザーの決定。app_spec の minutes/261124_輝く泡.md）のテスト。データはすべて架空。

     node --test tests/glow.test.mjs

   1. 選び方（js/glow.js）: 最後に触れた時刻が古い順、同じなら作った日、その次は id
   2. 同じ日の litAt の揃え: 2 つあれば litAt の早いほう。すでにあれば日の切り替えで選び直さない
   3. 上限での席（giveSeat）: 隠れていた輝く泡が、出す泡のいちばん古い 1 つと入れ替わる。数は変えない
   4. 除く条件（js/store.js）: 終えた・消した・長期保留・期間の外・先の日・きっかけ・すきま
   5. 輝いた時点で「触れた」: 次の日はちがう泡に回る
   6. litAt は保存・読み込みで残り、形の違うものは落ちる。知らない欄として落とさない側（ほかの app）は tests/shared-fields で別に見る */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedTimes, pickGlow, litOfDay, giveSeat, lastTouched, openedOf, markOpened } from '../js/glow.js';

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
const DAY = 86400000;

let seq = 0;
async function open(raw, now) {
  mem.clear();
  if (raw) mem.set(KEY, JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?glow=${++seq}`)).store;
}
/* 開き直し（今の保存のまま、日だけ進める） */
async function reopen(now) {
  fakeNow = now;
  return (await import(`${STORE_URL}?glow=${++seq}`)).store;
}
const saved = () => JSON.parse(mem.get(KEY));
const savedTodo = id => saved().todos.find(t => t.id === id);
const T24 = ms(2026, 11, 24, 9);
/* 昨日まで使っていた記録（lastDay が昨日 → 開くと日の切り替えが走る） */
const doc = (todos, extra = {}) => Object.assign({ v: 2, todos, lastDay: '2026-11-23' }, extra);
const td = (id, daysAgo, more = {}) => Object.assign({ id, text: '架空の ' + id, createdAt: T24 - daysAgo * DAY, days: [] }, more);

/* ---- 1. 選び方 ---- */
test('選び方: 最後に触れた時刻が古い順。同じなら作った日が古いほう、その次は id', () => {
  const a = td('a', 10), b = td('b', 30, { steps: [{ at: T24 - 1 * DAY, did: 'x' }] }), c = td('c', 20);
  const used = usedTimes([a, b, c], {});
  assert.equal(pickGlow([a, b, c], used).id, 'c', 'b は作ったのは古いが、作業記録で最近触れている');
  const x = td('x', 5), y = td('y', 5), z = td('z', 5, { createdAt: T24 - 5 * DAY - 1 });
  assert.equal(pickGlow([y, x], usedTimes([x, y], {})).id, 'x', '同じなら id');
  assert.equal(pickGlow([x, y, z], usedTimes([x, y, z], {})).id, 'z', '同じ使った時刻でも作った日が古いほう');
  assert.equal(pickGlow([], new Map()), null);
});

test('触れた: はじめた・作業記録・完了・今日に置いた・集中の画面・輝いた、を数える', () => {
  const t = td('t', 40, { started: { _: T24 - 3 * DAY } });
  assert.equal(usedTimes([t], {}).get('t'), T24 - 3 * DAY);
  assert.equal(usedTimes([t], { todayLogs: [{ id: 't', at: T24 - 2 * DAY }] }).get('t'), T24 - 2 * DAY);
  assert.equal(usedTimes([t], { focusLogs: [{ id: 't', at: T24 - DAY }] }).get('t'), T24 - DAY);
  const lit = Object.assign({}, t, { litAt: T24 });
  assert.equal(lastTouched(lit, usedTimes([lit], {})), T24, '輝いた時刻も触れたに入る');
});

/* ---- 2. 同じ日の litAt ---- */
test('同じ日の litAt が 2 つあれば早いほう。ほかの日のは数えない', () => {
  const from = ms(2026, 11, 24, 0), to = ms(2026, 11, 25, 0);
  const p = td('p', 9, { litAt: from + 5000 }), q = td('q', 9, { litAt: from + 1000 }), r = td('r', 9, { litAt: from - 1 });
  assert.equal(litOfDay([p, q, r], from, to).id, 'q');
  assert.equal(litOfDay([r], from, to), null);
});

/* ---- 3. 上限での席 ---- */
test('上限での席: 輝く泡が隠れていれば、出す泡のいちばん古い 1 つと入れ替わる。数は変えない', () => {
  const byNew = ['n1', 'n2', 'n3', 'n4', 'old'].map(id => ({ id }));
  const keep = new Set(['n1', 'n2', 'n3']);
  const got = giveSeat(keep, byNew, 'old');
  assert.deepEqual([...got].sort(), ['n1', 'n2', 'old']);
  assert.equal(got.size, keep.size);
  assert.equal(giveSeat(keep, byNew, 'n2'), keep, 'すでに出ていれば何もしない');
  assert.equal(giveSeat(keep, byNew, 'gone'), keep, '海にいない泡は呼ばない');
  assert.equal(giveSeat(keep, byNew, null), keep);
});

/* ---- 4・5. store の日の切り替え ---- */
test('日の切り替えで、候補のうち最後に触れた時刻がいちばん古い泡に litAt を書く', async () => {
  const store = await open(doc([td('new', 1), td('old', 50), td('mid', 20)]), T24);
  assert.equal(store.glowItem().id, 'old');
  assert.ok(savedTodo('old').litAt >= ms(2026, 11, 24, 0), 'litAt は今日の時刻');
  assert.equal(savedTodo('mid').litAt, undefined);
});

test('除く: 終えた・消した・長期保留・期間の外・先の日・きっかけ・すきま', async () => {
  const store = await open(doc([
    td('done', 90, { done: true, doneAt: T24 - 89 * DAY }),
    td('trash', 89, { trashed: true, trashedAt: T24 - 88 * DAY }),
    td('hold', 88, { hold: true }),
    td('span', 87, { start: '2026-12-10', due: '2026-12-12' }),
    td('future', 86, { days: ['2026-11-30'] }),
    td('plan', 85, { plan: true }),
    td('gap', 84, { gap: true }),
    td('ok', 3),
  ]), T24);
  assert.equal(store.glowItem().id, 'ok');
});

test('候補が無ければ何も輝かせない', async () => {
  const store = await open(doc([td('h', 9, { hold: true })]), T24);
  assert.equal(store.glowItem(), null);
  assert.equal(savedTodo('h').litAt, undefined);
});

test('今日の litAt がすでにあれば（ほかの端末が選んだ）、選び直さずそれを輝かせる', async () => {
  const other = ms(2026, 11, 24, 0) + 1000;
  const store = await open(doc([td('oldest', 60), td('chosen', 2, { litAt: other })]), T24);
  assert.equal(store.glowItem().id, 'chosen');
  assert.equal(savedTodo('oldest').litAt, undefined);
});

test('輝いた時点で触れたとみなす: 開かなくても次の日はちがう泡に回る', async () => {
  let store = await open(doc([td('a', 60), td('b', 40), td('c', 1)]), T24);
  assert.equal(store.glowItem().id, 'a');
  store = await reopen(T24 + DAY);
  assert.equal(store.glowItem().id, 'b');
  store = await reopen(T24 + 2 * DAY);
  assert.equal(store.glowItem().id, 'c');
  store = await reopen(T24 + 3 * DAY);
  assert.equal(store.glowItem().id, 'a', 'ひと回りしたら、いちばん前に輝いたものへ戻る');
});

test('はじめて開いた（lastDay が無い）・同じ日にもう一度開いた、では選ばない', async () => {
  let store = await open({ v: 2, todos: [td('a', 9)] }, T24);
  assert.equal(store.glowItem(), null);
  store = await open(doc([td('a', 9)], { lastDay: '2026-11-24' }), T24);
  assert.equal(store.glowItem(), null);
});

test('litAt は保存・読み込みで残る。形の違うものは落ちる。終えた泡は輝く泡として返さない', async () => {
  const lit = ms(2026, 11, 24, 0) + 10;
  let store = await open(doc([td('a', 9, { litAt: lit }), td('bad', 9, { litAt: 'x' })], { lastDay: '2026-11-24' }), T24);
  assert.equal(store.glowItem().id, 'a');
  store.add('架空の書き足し');                 /* 保存を 1 回起こす */
  assert.equal(savedTodo('a').litAt, lit);
  assert.equal(savedTodo('bad').litAt, undefined);
  store.complete('a');
  assert.equal(store.glowItem(), null);
});

/* ---- 開いたかの覚え（この端末だけ） ---- */
test('開いたかの覚え: その日の id だけ。日が違えば覚えていない', () => {
  markOpened(localStorage, '2026-11-24', 'a');
  assert.equal(openedOf(localStorage, '2026-11-24'), 'a');
  assert.equal(openedOf(localStorage, '2026-11-25'), null);
  assert.equal(openedOf(null, '2026-11-24'), null);
});
