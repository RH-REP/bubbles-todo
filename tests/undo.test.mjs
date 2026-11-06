/* 取り消しの積み重ね（Issue #22。js/undo.js）のテスト。
     node --test tests/undo.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoStack, MAX, TTL } from '../js/undo.js';

test('新しいほうから順に戻す', () => {
  const s = createUndoStack();
  const seen = [];
  s.push('A', () => seen.push('A'));
  s.push('B', () => seen.push('B'));
  s.pop().on();
  s.pop().on();
  assert.deepEqual(seen, ['B', 'A']);
  assert.equal(s.pop(), null, '空なら null');
});

test('トーストのボタンで戻したものは外れる（二重に戻さない）', () => {
  const s = createUndoStack();
  s.push('A', () => {});
  const b = s.push('B', () => {});
  s.remove(b);
  assert.equal(s.pop().message, 'A');
});

test('MAX 個を超えたら古いものから落ちる', () => {
  const s = createUndoStack();
  for (let i = 0; i < MAX + 5; i++) s.push('m' + i, () => {});
  assert.equal(s.size(), MAX);
  let last = null;
  for (let e = s.pop(); e; e = s.pop()) last = e;
  assert.equal(last.message, 'm5');
});

test('TTL より古いものは戻さない', () => {
  let t = 0;
  const s = createUndoStack({ now: () => t });
  s.push('old', () => {});
  t = TTL / 2;
  s.push('new', () => {});
  t = TTL + 1;
  assert.equal(s.size(), 1);
  assert.equal(s.pop().message, 'new');
  assert.equal(s.pop(), null);
});

test('関数でないものは控えない', () => {
  const s = createUndoStack();
  assert.equal(s.push('x', null), null);
  assert.equal(s.size(), 0);
});
