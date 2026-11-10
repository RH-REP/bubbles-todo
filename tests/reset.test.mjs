/* すべて初期化（js/reset.js。Issue #32）。偽の localStorage の上で、
   app が置いたものだけを全部消し、ほかは残すかを見る。

     node --test tests/reset.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appKeys, clearAppStorage, confirmed, PREFIX } from '../js/reset.js';

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _keys() { return Array.from(m.keys()).sort(); },
  };
}

test('app のキー（bubble_todo で始まるもの）を全部消し、ほかは残す', () => {
  const ls = fakeStorage({
    bubble_todo_v1: '{}',
    bubble_todo_share_v1: '{}',
    bubble_todo_sea_s1abc_v1: '{}',
    bubble_todo_spaces: '[]',
    bubble_todo_space: 's1abc',
    bubble_todo_sync: '{"url":"https://example.org"}',
    bubble_todo_sound_v1: '1',
    bubble_todo_ai_key: 'x',
    bubble_todo_chain_v1: '{}',
    'feedback.errors': '[]',
    other_app: 'keep',
  });
  assert.equal(clearAppStorage(ls), 9);
  assert.deepEqual(ls._keys(), ['feedback.errors', 'other_app']);
  assert.deepEqual(appKeys(ls), []);
});

test('空の端末や localStorage が無いときも落ちない', () => {
  assert.equal(clearAppStorage(fakeStorage()), 0);
  assert.deepEqual(appKeys(null), []);
});

test('合図の字は「初期化」ちょうど（前後の空白だけ許す）', () => {
  assert.equal(confirmed('初期化'), true);
  assert.equal(confirmed(' 初期化 '), true);
  assert.equal(confirmed('初期'), false);
  assert.equal(confirmed('初期化する'), false);
  assert.equal(confirmed(''), false);
  assert.equal(confirmed(null), false);
});

test('app が使う localStorage のキーは、どれも頭が bubble_todo（消し漏れを作らない）', () => {
  /* キーの名前を直書きしている所を拾い、頭を確かめる。'feedback.errors' は ! の部品のもので、消さない側 */
  const files = ['js/store.js', 'js/sync.js', 'js/sound.js', 'js/related.js', 'js/ai.js', 'js/chain.js',
    'js/notes.js', 'js/upcoming.js', 'js/weather.js', 'js/rollback.js', 'js/spacelist.js', 'js/prefs.js', 'js/screens/settings.js'];
  const re = /(?:_KEY|_STORE)\s*=\s*'([^']+)'/g;
  files.forEach(f => {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of src.matchAll(re)) {
      if (m[1] === '') continue;   /* store.js の NO_ANCHOR_KEY（キーの名前ではない） */
      assert.ok(m[1].startsWith(PREFIX), f + ' の ' + m[1] + ' が bubble_todo で始まらない（すべて初期化で消えない）');
    }
  });
});

test('store に halt() があり、立てたあとは書かない作り', () => {
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  assert.ok(/halt\(\)\s*\{\s*halted = true;/.test(src), 'store.halt() が無い');
  assert.ok(/function persist\(at\) \{\s*if \(halted\) return;/.test(src), 'persist() が halted を見ていない');
});

test('sw.js の ASSETS に js/reset.js がある', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/reset.js'"), 'sw.js の ASSETS に js/reset.js が無い');
});
