/* この端末の中に自動でバックアップを残す（js/localbackup.js。2026-11-21 Issue #83）のテスト。
   素の Node と assert だけで走る。データはすべて架空。置き場（IndexedDB）・時計は作り物。

     node tests/localbackup.test.mjs */

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

let fakeNow = new Date(2026, 10, 21, 9, 0).getTime();
Date.now = () => fakeNow;

const LB_URL = new URL('../js/localbackup.js', import.meta.url).href;
const STORE_URL = new URL('../js/store.js', import.meta.url).href;

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); }
  catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* IndexedDB の代わり */
function fakeSnaps() {
  const m = new Map();
  return {
    m, fail: null,
    async list() { return [...m.values()].map(x => Object.assign({}, x)); },
    async put(s) { if (this.fail) throw new Error(this.fail); m.set(s.id, Object.assign({}, s)); },
    async remove(id) { m.delete(id); },
    async clear() { m.clear(); },
  };
}
function fakeTimers() {
  const q = new Map(); let n = 0;
  return {
    setTimeout(f) { q.set(++n, f); return n; }, clearTimeout(id) { q.delete(id); },
    setInterval(f) { q.set(++n, f); return n; }, clearInterval(id) { q.delete(id); },
    fire() { [...q.values()].forEach(f => f()); },
    get size() { return q.size; },
  };
}

let seq = 0;
async function setup(over = {}) {
  mem.clear();
  fakeNow = new Date(2026, 10, 21, 9, 0).getTime();
  mem.set('bubble_todo_v1', JSON.stringify({ v: 2, todos: [{ id: 'm1', text: '架空の個人の泡', createdAt: 1, days: [] }], tags: [],
    stamps: { 'todo:m1': [1, 1], 'order:todo': [1, 1] } }));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'http://127.0.0.1:1', token: 'FAKE-TOKEN-must-not-leak' }));
  const { store } = await import(`${STORE_URL}?lb=${++seq}`);
  const lb = await import(`${LB_URL}?lb=${seq}`);
  const timers = fakeTimers();
  const snaps = fakeSnaps();
  const persisted = { n: 0 };
  const b = lb.createLocalBackup(Object.assign({ store, snaps, timers, supported: true, device: 'Mac',
    storageManager: { persist: async () => { persisted.n++; return true; } } }, over));
  return { store, lb, b, timers, snaps, persisted };
}
const tick = () => new Promise(r => setTimeout(r, 5));

/* ============================================================ */

await test('既定は切ってある。開いても何も残さない', async () => {
  const { lb, b, snaps } = await setup();
  assert.equal(lb.loadConf().on, false);
  b.start();
  await tick();
  assert.equal(snaps.m.size, 0);
  assert.equal(b.status().state, 'off');
  b.stop();
});

await test('入れると、すぐ1つ残す（合言葉は入れない）。消さないでとブラウザに頼む', async () => {
  const { lb, b, snaps, persisted } = await setup();
  const r = await b.turnOn();
  assert.deepEqual([r.state, r.saved], ['ok', true]);
  assert.equal(snaps.m.size, 1);
  assert.equal(persisted.n, 1);
  const s = [...snaps.m.values()][0];
  assert.equal(s.device, 'Mac');
  assert.equal(s.todos, 1);
  assert.ok(!s.text.includes('FAKE-TOKEN'), '合言葉が入っている');
  const p = await b.read(s.id);
  assert.equal(p.format, 'bubbles-backup');
  assert.equal(p.boxes.me.doc.todos[0].text, '架空の個人の泡');
  assert.equal(lb.loadConf().on, true);
});

await test('中身が同じなら残さない。変わったら新しく足す（上書きしない）', async () => {
  const { store, b, snaps } = await setup();
  await b.turnOn();
  fakeNow += 60 * 1000;
  assert.equal((await b.runNow()).saved, false);
  assert.equal(snaps.m.size, 1);
  store.add('架空の新しい泡');
  fakeNow += 60 * 1000;
  assert.equal((await b.runNow()).saved, true);
  assert.equal(snaps.m.size, 2);
  const all = await b.list();
  assert.ok(all[0].at > all[1].at, '新しい順でない');
  assert.equal(all[0].todos, 2);
  assert.equal(all[1].todos, 1, '前のものが書き換わった');
});

await test('新しいほうから 7 つだけ残す', async () => {
  const { store, lb, b, snaps } = await setup();
  await b.turnOn();
  for (let i = 0; i < 9; i++) { store.add('架空の泡 ' + i); fakeNow += 60 * 1000; await b.runNow(); }
  assert.equal(snaps.m.size, lb.KEEP);
  const all = await b.list();
  assert.equal(all[0].todos, 10);
  assert.equal(all[all.length - 1].todos, 10 - lb.KEEP + 1);
});

await test('記録が消えた状態で何度開いても、消える前のものは押し出されない', async () => {
  const { store, b } = await setup();
  await b.turnOn();
  const before = (await b.list())[0];
  /* サーバーの更新などで記録が空になった、という作り（sync.js と同じ入口で置き換える） */
  store.applyState({ doc: { v: 2, todos: [], tags: [] }, stamps: {} });
  for (let i = 0; i < 10; i++) { fakeNow += 60 * 60 * 1000; await b.runNow(); }
  const all = await b.list();
  assert.equal(all.length, 2);
  assert.equal(all[1].id, before.id);
  assert.equal((await b.read(before.id)).boxes.me.doc.todos.length, 1);
});

await test('1日1回: 同じ日は見るだけ、日が変わると残す', async () => {
  const { store, b, snaps, timers } = await setup();
  b.start();
  await b.turnOn();
  store.add('架空の昼の泡');
  fakeNow += 2 * 60 * 60 * 1000;
  timers.fire();
  await tick();
  assert.equal(snaps.m.size, 1, '同じ日に残した');
  fakeNow = new Date(2026, 10, 22, 8, 0).getTime();
  timers.fire();
  await tick();
  assert.equal(snaps.m.size, 2, '日が変わっても残していない');
  b.stop();
});

await test('切るときに消すを選ぶと残したものを消す。選ばなければ残す', async () => {
  const { lb, b, snaps } = await setup();
  await b.turnOn();
  await b.turnOff(false);
  assert.equal(lb.loadConf().on, false);
  assert.equal(snaps.m.size, 1);
  await b.turnOff(true);
  assert.equal(snaps.m.size, 0);
});

await test('置き場に書けないときは状態に出す', async () => {
  const { b, snaps } = await setup();
  snaps.fail = '入りきらない';
  const r = await b.turnOn();
  assert.equal(r.state, 'error');
  assert.equal(b.status().message, '入りきらない');
});

console.log(`\n${pass} ok, ${failed.length} failed`);
if (failed.length) process.exit(1);
