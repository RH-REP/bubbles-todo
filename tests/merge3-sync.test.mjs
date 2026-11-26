/* 3 方向の合わせを、サーバーとの合わせ（js/sync.js の syncOnce）の上で確かめるテスト（2026-11-26）。

     node tests/merge3-sync.test.mjs

   盤（この端末）と秘書（GET して todo を 1 つ直し、印を今にして PUT する書き手）が 1 つの記録を使う。
   盤が古い写しのまま泡を日に置いても、次の合わせで秘書の書き換えが残ることを見る。
   サーバーは架空（fetch を差し替える）。どこにも繋がない。データはすべて架空。 */

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

const REAL_NOW = Date.now;
let fakeNow = new Date(2026, 10, 25, 9, 0, 0, 0).getTime();
Date.now = () => fakeNow;
const tick = (ms = 60000) => { fakeNow += ms; };

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

mem.set('bubble_todo_space', 'me');
mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://bubbles.example.org', token: 'TOKEN', shareToken: '' }));

let server = { version: 0, data: null };
let puts = 0;
let open;
const gate = new Promise(r => { open = r; });
globalThis.fetch = async (url, init) => {
  await gate;
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (url.endsWith('/api/spaces')) return reply(200, { spaces: [] });
  if (init.method === 'GET') return reply(200, { space: 'me', version: server.version, data: server.data && JSON.parse(JSON.stringify(server.data)) });
  const body = JSON.parse(init.body);
  if (body.base !== server.version) return reply(409, {});
  puts++;
  server = { version: server.version + 1, data: body.data };
  return reply(200, { version: server.version });
};

const { store } = await import(new URL('../js/store.js', import.meta.url).href);
const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);

/* 秘書: 取り直して todo を 1 つ直し、その todo の印を今にして置く */
function secretaryEdits(id, fn) {
  const data = JSON.parse(JSON.stringify(server.data));
  const t = data.doc.todos.find(x => x.id === id);
  fn(t);
  data.stamps['todo:' + id] = [Date.now(), 1];
  server = { version: server.version + 1, data };
}

let id;
await test('盤が古い写しのまま日に置いても、秘書の本文・最初の一手・足した日が残る', async () => {
  id = store.add('架空の泡').id;
  open();
  for (let i = 0; i < 200 && sync.status().state !== 'ok'; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(await sync.syncNow(), true);
  assert.ok(mem.get('bubble_todo_sync_base_me'), '一致した todo を端末に覚える');
  assert.ok(!JSON.stringify(server.data).includes('sync_base'), '覚えたものはサーバーへ送らない');

  tick();
  secretaryEdits(id, t => { t.detail = '秘書が書いた本文'; t.firstStep = '紙を出す'; t.days = [...t.days, '2026-11-28'].sort(); });

  tick();   /* 盤はまだ取り直していない（古い写し）。泡を 11-26 に置く */
  assert.equal(store.setDay(id, '2026-11-26', true), true);

  assert.equal(await sync.syncNow(), true);
  for (const t of [store.get(id), server.data.doc.todos.find(x => x.id === id)]) {
    assert.equal(t.detail, '秘書が書いた本文');
    assert.equal(t.firstStep, '紙を出す');
    assert.ok(t.days.includes('2026-11-26') && t.days.includes('2026-11-28'), JSON.stringify(t.days));
  }
});

await test('合わせたあとは、もう一度合わせても送らない（行ったり来たりしない）', async () => {
  const before = puts;
  assert.equal(await sync.syncNow(), true);
  assert.equal(await sync.syncNow(), true);
  assert.equal(puts, before);
});

await test('覚えた todo（base）が読めなくても、今までどおり合わせる', async () => {
  mem.set('bubble_todo_sync_base_me', '{壊れた');
  tick();
  secretaryEdits(id, t => { t.detail = 'もう一度'; });
  assert.equal(await sync.syncNow(), true);
  assert.equal(store.get(id).detail, 'もう一度');
  assert.ok(JSON.parse(mem.get('bubble_todo_sync_base_me')).todos.length >= 1, '合わせたら覚え直す');
});

Date.now = REAL_NOW;
console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
