/* 個人は人ごと（2026-11-03）。パスキーをほかの人の個人へ移したとき、端末の個人の箱を入れ替えるテスト（sync.js）。

     node tests/person-sync.test.mjs

   前の版では、個人に入れるパスキーはみな同じ1つの個人（持ち主のもの）を合わせていた。
   サーバーでパスキーを移すと、GET /api/data の person が変わる。端末は前の人の記録を
   新しい人の個人へ送らずに、サーバーのものへ入れ替え、前の中身を控えに残す。 */

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
const later = Math.floor(Date.now() / 1000) + 3600;

/* 前の版で、持ち主の個人を合わせていた母のスマホ（番号を覚えていない。最後に合わせた時刻はある） */
mem.set('bubble_todo_space', 'me');
mem.set('bubble_todo_sync_seen_me', String(Date.now() - 60000));
mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://bubbles.example.org', token: '', shareToken: '',
  session: 'SESSION-M', sessionSpaces: ['me', 'share'], sessionExpires: later, sessionName: '母のスマホ' }));

let server = { person: 2, owner: false, version: 0, data: null };
const puts = [];
/* 起動時に sync.js が自分で合わせに行くので、手元に持ち主の todo を入れ終わるまで応答を止めておく */
let open;
const gate = new Promise(r => { open = r; });
globalThis.fetch = async (url, init) => {
  await gate;
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (url.endsWith('/api/spaces')) return reply(200, { spaces: [] });
  if (init.method === 'GET') {
    return reply(200, { space: 'me', version: server.version, data: server.data, person: server.person, owner: server.owner });
  }
  const body = JSON.parse(init.body);
  puts.push(body.data);
  server = Object.assign({}, server, { version: server.version + 1, data: body.data });
  return reply(200, { version: server.version });
};

const { store } = await import(new URL('../js/store.js', import.meta.url).href);
const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);
const texts = () => store.exportState().doc.todos.map(t => t.text);

await test('ほかの人の個人へ移ったら、手元の（持ち主の）記録を送らずに入れ替え、控えを残す', async () => {
  store.add('持ち主の todo');
  assert.ok(texts().includes('持ち主の todo'));
  open();
  for (let i = 0; i < 100 && sync.status().state !== 'ok'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(sync.status().state, 'ok');
  assert.ok(!texts().includes('持ち主の todo'), '手元の個人から消える');
  assert.ok(puts.every(d => !JSON.stringify(d).includes('持ち主の todo')), '新しい人の個人へ送らない');
  const backups = Array.from(mem.keys()).filter(k => k.startsWith('bubble_todo_v1_before_person_'));
  assert.equal(backups.length, 1);
  assert.ok(mem.get(backups[0]).includes('持ち主の todo'), '前の中身は控えに残る');
  assert.equal(mem.get('bubble_todo_sync_person'), '2');
  assert.equal(sync.owner(), false, 'サーバーが owner: false と言ったので持ち主ではない');
  assert.equal(sync.config().passkey.owner, false);
});

await test('同じ人のままなら、ふだんどおり合わせる（入れ替えない）', async () => {
  store.add('母の todo');
  assert.equal(await sync.syncNow(), true);
  assert.ok(texts().includes('母の todo'));
  assert.ok(JSON.stringify(server.data).includes('母の todo'));
  assert.equal(Array.from(mem.keys()).filter(k => k.startsWith('bubble_todo_v1_before_person_')).length, 1);
});

await test('前の版で合わせていた持ち主の端末（1 番）は、入れ替えない', async () => {
  mem.delete('bubble_todo_sync_person');
  server = Object.assign({}, server, { person: 1, owner: true });
  assert.equal(await sync.syncNow(), true);
  assert.ok(texts().includes('母の todo'), '手元はそのまま');
  assert.equal(mem.get('bubble_todo_sync_person'), '1');
  assert.equal(sync.owner(), true);
});

await test('まだ一度も合わせていない新しい端末は、番号が 1 でなくても手元の記録を残す', async () => {
  mem.delete('bubble_todo_sync_person');
  mem.delete('bubble_todo_sync_seen_me');
  server = { person: 3, owner: false, version: 0, data: null };
  assert.equal(await sync.syncNow(), true);
  assert.ok(texts().includes('母の todo'), '登録する前に書いた記録を捨てない');
  assert.equal(mem.get('bubble_todo_sync_person'), '3');
});

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
