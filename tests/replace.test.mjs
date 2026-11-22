/* 上書き（js/merge.js の replaceState。2026-11-19「読み出したものは上書きするか追加するかきいて」「新しいデータを完全に差し替える」）。
   node --test tests/replace.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceState, mergeState, initialStamps } from '../js/merge.js';

const st = (todos, at, lastDay = '2026-11-19') => { const doc = { todos, lastDay }; return { doc, stamps: initialStamps(doc, at) }; };

test('上書きすると、控えの泡だけになる。今にしか無い泡は消える（墓石）', () => {
  const now = st([{ id: 'a', text: '今の A' }, { id: 'c', text: '今だけの C' }], 5000);
  const backup = st([{ id: 'a', text: '控えの A' }, { id: 'b', text: '控えの B' }], 1000, '2026-11-10');
  const r = replaceState(now, backup, 9000);
  assert.deepEqual(r.doc.todos.map(t => t.id + ':' + t.text), ['a:控えの A', 'b:控えの B']);
  assert.deepEqual(r.stamps['todo:c'], [9000, 0]);
  assert.deepEqual(r.stamps['todo:a'], [9000, 1]);
  assert.equal(r.doc.lastDay, '2026-11-19', '日付は進むだけ');
});

test('上書きした後にサーバー（今と同じ・新しい印）と合わせても、控えの中身が残る', () => {
  const server = st([{ id: 'a', text: '今の A' }, { id: 'c', text: '今だけの C' }], 8000);
  const backup = st([{ id: 'a', text: '控えの A' }], 1000);
  const r = replaceState(server, backup, 9000);
  const merged = mergeState(server, r);
  assert.deepEqual(merged.doc.todos.map(t => t.id + ':' + t.text), ['a:控えの A']);
});

test('今の印が時刻より新しくても（時計のずれ）、それより新しい印を付ける', () => {
  const now = st([{ id: 'a', text: '今' }], 20000);
  const r = replaceState(now, st([{ id: 'a', text: '控え' }], 1), 9000);
  assert.deepEqual(r.stamps['todo:a'], [20001, 1]);
  assert.equal(mergeState(now, r).doc.todos[0].text, '控え');
});

import { addState } from '../js/merge.js';
test('追加: 重ねたうえで、控えにあって今は消えている泡も戻る。今の泡は残る', () => {
  const backup = st([{ id: 'a', text: '控えの A' }, { id: 'b', text: '控えの B' }], 1000);
  const now = replaceState(backup, st([{ id: 'a', text: '今の A' }, { id: 'c', text: '今の C' }], 2000), 5000);   /* b は消した（5000 の墓石） */
  const r = addState(now, backup, 9000);
  assert.deepEqual(r.doc.todos.map(t => t.id + ':' + t.text).sort(), ['a:今の A', 'b:控えの B', 'c:今の C']);
  assert.deepEqual(r.stamps['todo:b'], [9000, 1]);
  assert.equal(mergeState(now, r).doc.todos.length, 3, 'サーバー（消した側）と合わせても戻ったまま');
});
