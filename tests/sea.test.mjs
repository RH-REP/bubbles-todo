/* 持ち主の端末で、作った海を開いたときのテスト（2026-11-02 Issue #4）。素の Node と assert だけで走る。

     node tests/sea.test.mjs

   作った海は初めはこの端末だけのもの（届かなくても書ける）。繋いでいれば、自分の合言葉で
   X-Bubbles-Space にその海を言って、サーバーのその海の置き場と合わせる。海の一覧も合わせる。 */

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
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

const SEA = 'sabc1234';
mem.set('bubble_todo_v1', JSON.stringify({ v: 2, todos: [{ id: 'p1', text: '個人のもの', createdAt: 1, fx: .5, fy: .5 }] }));
mem.set('bubble_todo_spaces', JSON.stringify([{ id: SEA, name: '仕事', color: 'sand', at: 100, alive: 1 }]));
mem.set('bubble_todo_space', SEA);
/* 海域（2026-11-12）: 「この端末だけ」と、前の版からの個人と海を持つサーバーの海域（住所はまだ無い）。
   前の版の「住所を入れて繋ぐ」は、サーバーの海域で住所と合言葉を入れることになった */
mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', name: 'この端末だけ' }, { id: 'r0', name: 'サーバー', legacyMe: true, legacyConf: true }]));

/* 偽のサーバー。自分の合言葉は、X-Bubbles-Space の海の置き場に入る */
const boxes = {};
let seaList = [{ id: SEA, name: '仕事（サーバーで直した）', color: 'sand', at: 200, alive: 1 }];
const posted = [];
let down = true;
globalThis.fetch = async (url, init) => {
  if (down) throw new TypeError('Failed to fetch');
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (init.headers.Authorization !== 'Bearer me-tk') return reply(401, {});
  if (url.endsWith('/api/spaces')) {
    posted.push(JSON.parse(init.body).spaces);
    return reply(200, { spaces: seaList });
  }
  const want = init.headers['X-Bubbles-Space'];
  const b = boxes[want] || (boxes[want] = { version: 0, data: null });
  if (init.method === 'GET') return reply(200, { space: want, version: b.version, data: b.data });
  const body = JSON.parse(init.body);
  if (body.base !== b.version) return reply(409, { space: want, version: b.version, data: b.data });
  b.version++; b.data = body.data;
  return reply(200, { version: b.version });
};

const { store } = await import(new URL('../js/store.js', import.meta.url).href);
const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);

await test('作った海は、その海の箱で開き、個人の記録は見えない', async () => {
  assert.equal(store.space(), SEA);
  assert.equal(store.all().length, 0);
  assert.ok(mem.has('bubble_todo_sea_' + SEA + '_v1'));
});

await test('繋いでいなくても書ける（初めはこの端末だけの海）', async () => {
  assert.equal(store.readOnly(), false);
  assert.ok(store.add('資料をまとめる'));
  store.flush();
  assert.match(mem.get('bubble_todo_sea_' + SEA + '_v1'), /資料をまとめる/);
  assert.doesNotMatch(mem.get('bubble_todo_v1'), /資料をまとめる/);
});

await test('自分の合言葉で繋ぐと、その海の置き場と合わせ、個人の置き場には送らない', async () => {
  down = false;
  sync.configure('https://srv.test', 'me-tk', '');
  for (let i = 0; i < 100 && !(boxes[SEA] && boxes[SEA].data); i++) await tick();
  assert.match(JSON.stringify(boxes[SEA].data), /資料をまとめる/);
  assert.equal(boxes.me, undefined);
  assert.equal(sync.status().state, 'ok');
});

await test('海の一覧をサーバーへ送り、サーバーの新しい名前を受け取る', async () => {
  for (let i = 0; i < 50 && !posted.length; i++) await tick();
  assert.ok(posted.some(list => list.some(e => e.id === SEA)));
  const list = JSON.parse(mem.get('bubble_todo_spaces'));
  assert.equal(list.find(e => e.id === SEA).name, '仕事（サーバーで直した）');
});

await test('届かなくなっても、持ち主の海は書ける', async () => {
  down = true;
  await sync.syncNow();
  assert.equal(sync.status().state, 'error');
  assert.equal(store.readOnly(), false);
  assert.ok(store.add('届かない間に書いた'));
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
process.exit(0);
