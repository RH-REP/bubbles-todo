/* パスキーの通行証で合わせるテスト（sync.js。公開の形）。素の Node と assert だけで走る。

     node tests/passkey-sync.test.mjs

   sync.js は './store.js' を1つだけ使うので、このファイルは共有で開いた store 1つで確かめる。 */

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
const later = Math.floor(Date.now() / 1000) + 3600;

mem.set('bubble_todo_space', 'share');
mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://bubbles.example.org', token: '', shareToken: '',
  session: 'SESSION-1', sessionSpaces: ['share'], sessionExpires: later, sessionName: '母のスマホ' }));

let server = { version: 0, data: null };
let refuse = false;
const seen = [];
globalThis.fetch = async (url, init) => {
  seen.push({ url, auth: init.headers.Authorization, space: init.headers['X-Bubbles-Space'], method: init.method });
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (refuse) return reply(401, { error: 'unauthorized' });
  if (init.method === 'GET') return reply(200, { space: 'share', version: server.version, data: server.data });
  const body = JSON.parse(init.body);
  server = { version: server.version + 1, data: body.data };
  return reply(200, { version: server.version });
};

const { store } = await import(new URL('../js/store.js', import.meta.url).href);
const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);

await test('通行証で、今の持ち主（共有）を名乗って合わせる', async () => {
  for (let i = 0; i < 50 && sync.status().state !== 'ok'; i++) await tick();
  assert.equal(sync.status().state, 'ok');
  assert.ok(seen.length > 0);
  assert.ok(seen.every(r => r.auth === 'Bearer SESSION-1' && r.space === 'share'));
  assert.equal(store.readOnly(), false, '合わせられたので書ける');
  assert.deepEqual(sync.config().passkey.spaces, ['share']);
  assert.equal(sync.config().passkey.name, '母のスマホ');
});

await test('通行証が取り消されたら「パスキーで入り直す」と出て、読むだけになる', async () => {
  refuse = true;
  await sync.syncNow();
  assert.equal(sync.status().state, 'error');
  assert.match(sync.status().message, /パスキーで入り直す/);
  assert.equal(store.readOnly(), true);
  refuse = false;
});

await test('通行証を捨てたら、もう送らない', async () => {
  sync.dropPasskeySession();
  assert.equal(sync.ready(), false);
  const n = seen.length;
  assert.equal(await sync.syncNow(), false);
  assert.equal(seen.length, n);
  assert.equal(JSON.parse(mem.get('bubble_todo_sync')).session, '', '保存からも消える');
});

await test('共有に入れない通行証では、共有の記録を取りに行かない', async () => {
  sync.usePasskeySession('https://bubbles.example.org', { session: 'S2', spaces: ['me'], expires: later, name: '自分' });
  assert.equal(sync.ready(), false, '共有で開いているのに、通行証は個人だけ');
  sync.usePasskeySession('https://bubbles.example.org', { session: 'S3', spaces: ['me', 'share'], expires: later - 7200, name: '自分' });
  assert.equal(sync.ready(), false, '期限切れ');
  assert.equal(sync.usePasskeySession('http://bubbles.example.org', { session: 'S4', spaces: ['share'], expires: later }), false,
    '外への http には繋がない');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
process.exit(0);
