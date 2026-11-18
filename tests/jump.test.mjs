/* jump の住所（2026-11-18 取り決め §7.2）と 3 つの app の住所の根のテスト。素の Node と assert だけ。

     node tests/jump.test.mjs */
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { return mem.has(String(k)) ? mem.get(String(k)) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { return Array.from(mem.keys())[i] ?? null; },
  get length() { return mem.size; },
};

const { deriveAppUrls, appUrls, parseJump } = await import('../js/apps.js');
let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('ok   - ' + name); };

test('#sea=<海>&todo=<id> を読む。形の違うものは読まない', () => {
  assert.deepEqual(parseJump('#sea=sfam01&todo=t1abc'), { sea: 'sfam01', todo: 't1abc' });
  assert.deepEqual(parseJump('#sea=me'), { sea: 'me', todo: null });
  assert.equal(parseJump('#avatar'), null);
  assert.equal(parseJump(''), null);
  assert.deepEqual(parseJump('#sea=sfam01&todo=<script>'), { sea: 'sfam01', todo: null });
  assert.equal(parseJump('#sea=a%20b'), null);
});

test('住所の根を住所から決める（bubbles.<名前> と手元の試し）', () => {
  assert.deepEqual(deriveAppUrls('https://bubbles.app-laboratory.duckdns.org'),
    { bubble: 'https://bubbles.app-laboratory.duckdns.org', gantt: 'https://gantt.app-laboratory.duckdns.org', diary: 'https://diary.app-laboratory.duckdns.org' });
  assert.deepEqual(deriveAppUrls('http://localhost:8931'), { bubble: 'http://localhost:8931', gantt: 'http://127.0.0.1:8766', diary: 'http://127.0.0.1:8780' });
  assert.deepEqual(deriveAppUrls('https://bubbles-todo.duckdns.org'), { bubble: 'https://bubbles-todo.duckdns.org', gantt: '', diary: '' }, '決められなければ空');
});

test('サーバーの決めた住所（/api/apps の控え）が先。根だけを使う', () => {
  localStorage.setItem('bubble_todo_app_urls_v1', JSON.stringify({ gantt: 'https://g.example.org/path?x', diary: 'javascript:alert(1)' }));
  assert.deepEqual(appUrls('https://bubbles.example.org'),
    { bubble: 'https://bubbles.example.org', gantt: 'https://g.example.org', diary: 'https://diary.example.org' });
});

console.log(`\njump: ${pass} passed`);
