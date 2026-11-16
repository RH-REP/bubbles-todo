/* サーバーは1つ（js/oneserver.js）。素の Node と assert だけで走る。

     node tests/oneserver.test.mjs

   2026-11-16 利用者の答え: ほかのサーバーの海は「この端末の海」にする（b）。何も送らず、記録の箱は消さない。 */

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

let pass = 0;
const failed = [];
function test(name, fn) {
  try { mem.clear(); fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const { consolidate, theServer, serverUrl, ensureServer, canUnify, unifyPersonal } = await import(new URL('../js/oneserver.js', import.meta.url).href);
const { regionList, regionOfSpace } = await import(new URL('../js/regions.js', import.meta.url).href);
const { seaList } = await import(new URL('../js/spacelist.js', import.meta.url).href);

const box = (texts) => JSON.stringify({ todos: texts.map((t, i) => ({ id: 't' + i, text: t })) });
function twoServers() {
  mem.set('bubble_todo_regions', JSON.stringify([
    { id: 'local', name: 'この端末だけ' },
    { id: 'r0', name: 'サーバーA', legacyMe: true, legacyConf: true },
    { id: 'rb', name: 'サーバーB' },
  ]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S' }));
  mem.set('bubble_todo_sync_rb', JSON.stringify({ url: 'https://b.example', session: 'T' }));
  mem.set('bubble_todo_spaces', JSON.stringify([
    { id: 'saaa111', name: 'A の海', color: 'moss', at: 1, alive: 1, region: 'r0' },
    { id: 'sbbb111', name: 'B の海', color: 'dusk', at: 1, alive: 1, region: 'rb' },
  ]));
  mem.set('bubble_todo_me_rb_v1', box(['B の個人の泡']));
  mem.set('bubble_todo_sea_sbbb111_v1', box(['B の海の泡']));
}

test('サーバーが1つなら何もしない', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local' }, { id: 'r0', name: 'A', legacyMe: true, legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example' }));
  assert.equal(consolidate().changed, false);
  assert.equal(theServer().id, 'r0');
});

test('2つ目のサーバーの海と個人は、この端末の海になる。箱は消さず、何も送らない', () => {
  twoServers();
  const before = new Map(mem);
  const out = consolidate(1000);
  assert.equal(out.changed, true);
  assert.deepEqual(regionList().filter(r => r.kind === 'server').map(r => r.id), ['r0'], 'サーバーは前の版の住所のもの1つ');
  assert.equal(regionOfSpace('sbbb111'), 'local', 'B の海はこの端末の海');
  assert.equal(regionOfSpace('saaa111'), 'r0', 'A の海はそのまま');
  const copy = seaList().find(e => e.name === '個人（サーバーB）');
  assert.ok(copy, 'B の個人は「個人（サーバーB）」のこの端末の海として残る');
  assert.equal(regionOfSpace(copy.id), 'local');
  assert.equal(mem.get('bubble_todo_sea_' + copy.id + '_v1'), before.get('bubble_todo_me_rb_v1'), '中身を写した');
  for (const [k, v] of before) {
    if (k === 'bubble_todo_regions' || k === 'bubble_todo_spaces') continue;
    assert.equal(mem.get(k), v, k + ' は消さず、書き換えない');
  }
});

test('開いていた海が外した個人なら、写した海を開く', () => {
  twoServers();
  mem.set('bubble_todo_space', 'me.rb');
  const out = consolidate(1000);
  const copy = seaList().find(e => e.name === '個人（サーバーB）');
  assert.equal(out.reopen, copy.id);
  assert.equal(mem.get('bubble_todo_space'), copy.id);
});

test('空の個人は写さない。2回目は何もしない', () => {
  twoServers();
  mem.delete('bubble_todo_me_rb_v1');
  consolidate(1000);
  assert.equal(seaList().some(e => e.name === '個人（サーバーB）'), false);
  assert.equal(consolidate(2000).changed, false);
});

test('住所: 繋ぎ先があればそれ、無ければパスキーのサーバーが配るページ', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }]));
  assert.equal(serverUrl('https://page.example', 'passkey'), 'https://page.example');
  assert.equal(serverUrl('https://page.example', null), '', 'サーバーが配っていないページでは決めない');
  const r = ensureServer('https://page.example', 1000);
  assert.equal(r.kind, 'server');
  assert.equal(ensureServer('https://other.example', 2000).id, r.id, '2つ目は作らない');
  assert.equal(serverUrl('https://x.example', 'passkey'), 'https://page.example');
  assert.equal(regionOfSpace('me'), 'local', 'この端末の個人は動かさない');
});

test('個人をまとめる: 2つの箱を重ねて1つの個人にし、サーバーと合わせる。作った海は動かさない', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }, { id: 'rs1', name: 'サーバー', legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S' }));
  mem.set('bubble_todo_spaces', JSON.stringify([{ id: 'shome11', name: '家', color: 'moss', at: 1, alive: 1 }]));
  const todo = (id, text, at) => ({ id, text, createdAt: at });
  mem.set('bubble_todo_v1', JSON.stringify({ todos: [todo('a1', '端末の泡', 1)], stamps: { 'todo:a1': [10, 1] } }));
  mem.set('bubble_todo_me_rs1_v1', JSON.stringify({ todos: [todo('b1', 'サーバーの泡', 1)], stamps: { 'todo:b1': [20, 1] } }));
  mem.set('bubble_todo_space', 'me.rs1');
  assert.equal(regionOfSpace('shome11'), 'local');
  assert.equal(canUnify(), true);
  assert.equal(unifyPersonal(5000), 'me');
  const box = JSON.parse(mem.get('bubble_todo_v1'));
  const texts = (box.todos || []).map(t => t.text).sort();
  assert.deepEqual(texts, ['サーバーの泡', '端末の泡'], '両方残る');
  assert.equal(regionOfSpace('me'), 'rs1', '個人はサーバーと合わせる');
  assert.equal(regionOfSpace('shome11'), 'local', '作った海は動かさない');
  assert.equal(mem.get('bubble_todo_space'), 'me');
  assert.ok(mem.get('bubble_todo_v1_before_unify_5000'), '前の中身の控え');
  assert.ok(mem.get('bubble_todo_me_rs1_v1'), 'サーバーの個人の箱も消さない');
  assert.equal(canUnify(), false, '2度目はしない');
});

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
