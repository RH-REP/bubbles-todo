/* 海の一覧（js/spacelist.js。2026-11-02 Issue #4）のテスト。素の Node と assert だけで走る。

     node tests/spacelist.test.mjs */

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
};

const L = await import(new URL('../js/spacelist.js', import.meta.url).href);

let pass = 0;
const failed = [];
function test(name, fn) {
  try { fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

test('初めから「共有」の海がある（前の版の記録を引き継ぐ）。個人は一覧に入らない', () => {
  assert.deepEqual(L.seaList().map(e => [e.id, e.name, e.color]), [['share', '共有', 'magma']]);
  assert.equal(L.seaName('me'), '個人');
  assert.equal(L.boxKey('me'), 'bubble_todo_v1');
  assert.equal(L.boxKey('share'), 'bubble_todo_share_v1');
});

test('名前と色を決めて海を作る。ID はサーバーのフォルダ名に使える形', () => {
  const e = L.addSea('  家族の  買い物  ', 'moss', 1000);
  assert.match(e.id, L.ID_RE);
  assert.equal(e.name, '家族の 買い物');
  assert.equal(e.color, 'moss');
  assert.equal(L.boxKey(e.id), 'bubble_todo_sea_' + e.id + '_v1');
  assert.equal(L.findSea(e.id).name, '家族の 買い物');
  assert.equal(L.addSea('   ', 'moss'), null, '名前が空なら作らない');
  assert.equal(L.addSea('あ'.repeat(40), 'nope').name.length, L.NAME_MAX, '長い名前は切る');
  assert.equal(L.findSea(L.seaList()[2].id).color, 'magma', '知らない色はマグマ');
});

test('「共有」も名前と色を変えられる。空の名前にはできない', () => {
  assert.ok(L.updateSea('share', { name: '家族', color: 'dusk' }, 2000));
  assert.deepEqual([L.seaName('share'), L.seaColor('share')], ['家族', 'dusk']);
  assert.equal(L.updateSea('share', { name: ' ' }), false);
  assert.equal(L.updateSea('me', { name: '自分' }), false, '個人は変えられない');
});

test('消すと一覧から外れ、消した印が残る（ほかの端末へ届けるため）', () => {
  const id = L.seaList()[1].id;
  assert.ok(L.removeSea(id, 3000));
  assert.equal(L.findSea(id), null);
  const t = L.allEntries().find(e => e.id === id);
  assert.equal(t.alive, 0);
});

test('サーバーの一覧と、海ごとに新しいほうで合わせる', () => {
  const before = L.allEntries();
  const gone = before.find(e => !e.alive);
  const changed = L.mergeSeas([
    { id: 'share', name: '古い名前', color: 'magma', at: 1500, alive: 1 },   /* 手元（2000）のほうが新しい */
    { id: gone.id, name: '戻らない', color: 'sand', at: 2500, alive: 1 },    /* 消した印（3000）のほうが新しい */
    { id: 'sxyz123', name: '仕事', color: 'ink', at: 10, alive: 1 },          /* 知らない海は足す */
    { id: '../etc', name: 'だめ', color: 'ink', at: 99, alive: 1 },           /* 形の違う ID は捨てる */
  ]);
  assert.equal(changed, true);
  assert.equal(L.seaName('share'), '家族');
  assert.equal(L.findSea(gone.id), null);
  assert.equal(L.seaName('sxyz123'), '仕事');
  assert.equal(L.allEntries().some(e => e.id === '../etc'), false);
  assert.equal(L.mergeSeas([{ id: 'sxyz123', name: '仕事', color: 'ink', at: 10, alive: 1 }]), false, '同じなら変わらない');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
