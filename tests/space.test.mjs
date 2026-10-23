/* 個人と共有（store の持ち主・読むだけ、sync.js の合言葉と取り違えの見張り）のテスト。
   素の Node と assert だけで走る。

     node tests/space.test.mjs

   sync.js は './store.js' をそのまま import する（モジュールは1つ）ので、
   このファイルは共有で開いた store 1つだけを使う（個人の確かめは sync.test.mjs）。 */

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

/* 個人の記録を先に置いておく（共有で開いても触られないことを見る） */
mem.set('bubble_todo_v1', JSON.stringify({ v: 2, todos: [{ id: 'p1', text: '個人のもの', createdAt: 1, fx: .5, fy: .5 }] }));
mem.set('bubble_todo_space', 'share');
/* 住所は自分の機械の中の http（start.command の形）。読み込みの時点で住所を確かめる道を通す */
mem.set('bubble_todo_sync', JSON.stringify({ url: 'http://127.0.0.1:8931', token: 'me-tk', shareToken: 'share-tk' }));

/* 偽のサーバー。合言葉で置き場を分ける */
const spaces = { 'me-tk': { space: 'me', version: 0, data: null }, 'share-tk': { space: 'share', version: 0, data: null } };
let down = false;
const calls = [];
globalThis.fetch = async (url, init) => {
  if (down) throw new TypeError('Failed to fetch');
  const tk = init.headers.Authorization.replace('Bearer ', '');
  calls.push(init.method + ' ' + tk);
  const sp = spaces[tk];
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (!sp) return reply(401, { error: 'unauthorized' });
  if (init.method === 'GET') return reply(200, { space: sp.space, version: sp.version, data: sp.data });
  const body = JSON.parse(init.body);
  if (body.base !== sp.version) return reply(409, { space: sp.space, version: sp.version, data: sp.data });
  sp.version++; sp.data = body.data;
  return reply(200, { version: sp.version });
};

const mod = await import(new URL('../js/store.js', import.meta.url).href);
const { store, WRITE_METHODS } = mod;
const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);

await test('書き込み口の一覧に、persist() を呼ぶ口がすべて入っている', async () => {
  const writes = Object.keys(store).filter(k => typeof store[k] === 'function');
  /* 包んだあとの口は元の本体を見られないので、一覧に無い口だけを調べる */
  const missing = writes.filter(k => !WRITE_METHODS.includes(k) && /persist\(/.test(store[k].toString())
    && !['rollover', 'sweepHolds'].includes(k));
  assert.deepEqual(missing, []);
});

await test('共有で開くと、共有の箱を使い、個人の記録には触らない', async () => {
  assert.equal(store.space(), 'share');
  assert.equal(store.all().length, 0, '個人の記録は見えない');
  assert.ok(mem.has('bubble_todo_share_v1'), '共有の控えの箱');
  assert.match(mem.get('bubble_todo_v1'), /個人のもの/);
});

await test('合わせられたら書ける。共有の合言葉だけを使い、個人の置き場には送らない', async () => {
  for (let i = 0; i < 50 && sync.status().state !== 'ok'; i++) await tick();
  assert.equal(sync.status().state, 'ok');
  assert.equal(store.readOnly(), false);
  assert.ok(store.add('みんなで買う'));
  for (let i = 0; i < 200 && !(spaces['share-tk'].data && JSON.stringify(spaces['share-tk'].data).includes('みんなで買う')); i++) await tick();
  assert.match(JSON.stringify(spaces['share-tk'].data), /みんなで買う/);
  assert.equal(spaces['me-tk'].data, null, '個人の置き場には何も行かない');
  assert.ok(calls.every(c => c.endsWith('share-tk')));
  assert.ok(sync.seenAt() > 0, '見た時刻を覚える');
});

await test('届かなくなったら読むだけ。書こうとすると知らされ、記録は変わらない', async () => {
  down = true;
  await sync.syncNow();
  assert.equal(sync.status().state, 'error');
  assert.equal(store.readOnly(), true);
  let told = 0;
  const off = store.onBlocked(() => told++);
  const n = store.count();
  assert.equal(store.add('書けないはず'), null);
  assert.equal(store.setText(store.all()[0].id, '書き換え'), false);
  assert.equal(store.count(), n);
  assert.equal(store.all()[0].text, 'みんなで買う');
  assert.equal(told, 2);
  off();
  assert.ok(sync.seenAt() > 0, '最後に見た時刻は残る');
});

await test('繋がり直したら、また書ける', async () => {
  down = false;
  await sync.syncNow();
  assert.equal(sync.status().state, 'ok');
  assert.equal(store.readOnly(), false);
});

await test('個人の合言葉を共有の欄に入れたら、送らずに知らせる', async () => {
  const before = JSON.stringify(spaces['me-tk']);
  sync.configure('https://srv.test', 'me-tk', 'me-tk');
  for (let i = 0; i < 50 && sync.status().state !== 'error'; i++) await tick();
  assert.equal(sync.status().state, 'error');
  assert.match(sync.status().message, /共有の合言葉ではない/);
  assert.equal(JSON.stringify(spaces['me-tk']), before, '個人の置き場は変わらない');
  assert.equal(store.readOnly(), true);
  sync.configure('', '', '');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
process.exit(0);
