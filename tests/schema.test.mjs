/* 共有の記録 v1.1 のテスト（2026-11-10）。素の Node と assert だけで走る。データはすべて架空。

     node tests/schema.test.mjs

   1. 知らない欄を丸ごと残す（todo の欄・保存データの頂上・サーバーの data の頂上）
   2. 記録の形の版（X-Bubbles-Schema・minSchema・426）と、古い版の帯（js/schemaguard.js）
   3. 期間の正本は start・due（store.setSpan）。project に特別なタグを入れない

   サーバーの側（426 で弾いて記録を残す）は tests/test_server.py。 */

import assert from 'node:assert/strict';
import { mergeState } from '../js/merge.js';

const KEY = 'bubble_todo_v1';
const STORE_URL = new URL('../js/store.js', import.meta.url).href;
const SYNC_URL = new URL('../js/sync.js', import.meta.url).href;
const GUARD_URL = new URL('../js/schemaguard.js', import.meta.url).href;

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
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
function ms(y, m, d, h = 0, mi = 0) { return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); }
const NOW = ms(2026, 11, 10, 10, 0);

let seq = 0;
async function open(raw, now = NOW) {
  mem.clear();
  if (raw !== null && raw !== undefined) mem.set(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
async function reopen(now = NOW) {
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
function saved() { return JSON.parse(mem.get(KEY)); }
function todosOf(store) { return store.exportState().doc.todos; }
const wait = (n = 10) => new Promise(r => setTimeout(r, n));

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

const TAG = { id: 'tproj1', name: '架空の案件', color: '#a0c4ff' };
function gTodo(over = {}) {
  return Object.assign({
    id: 'gmhabc12q7r2', text: '架空の作業', createdAt: ms(2026, 11, 9, 9, 0),
    tags: ['tproj1'], start: '2026-11-12', due: '2026-11-20', project: 'tproj1',
    ext: { gantt: { goal: '架空の目標' } },
    /* この版の知らない欄（この先の版や、ほかの app が足したもの） */
    estimate: { hours: 3, by: 'gantt' }, priorityV2: 'high', nullish: null,
  }, over);
}
const UNKNOWN = { estimate: { hours: 3, by: 'gantt' }, priorityV2: 'high', nullish: null };
function pickUnknown(t) { return { estimate: t.estimate, priorityV2: t.priorityV2, nullish: t.nullish }; }
function docWith(todos, extra = {}) { return Object.assign({ v: 2, tags: [TAG], todos, lastDay: '2026-11-10' }, extra); }

/* ============================================================ */
/* 1. 知らない欄 */

await test('知らない todo の欄が、保存→読み込み・書き換え・applyState・mergeState を通って残る', async () => {
  let store = await open(docWith([gTodo()]));
  assert.deepEqual(pickUnknown(todosOf(store)[0]), UNKNOWN);
  store.setText('gmhabc12q7r2', '架空の作業（直した）');
  assert.deepEqual(pickUnknown(saved().todos[0]), UNKNOWN, '書き換えて保存しても残る');
  store = await reopen();
  assert.deepEqual(pickUnknown(todosOf(store)[0]), UNKNOWN, '読み直しても残る');

  const s2 = await open(null);
  s2.applyState({ doc: docWith([gTodo()]), stamps: { 'todo:gmhabc12q7r2': [NOW, 1] } });
  assert.deepEqual(pickUnknown(todosOf(s2)[0]), UNKNOWN, 'applyState（fromDoc）で残る');

  const old = { id: 'gmhabc12q7r2', text: '架空の作業', createdAt: ms(2026, 11, 9, 9, 0) };
  const m = mergeState({ doc: docWith([old]), stamps: { 'todo:gmhabc12q7r2': [NOW - 5, 1] } },
    { doc: docWith([gTodo()]), stamps: { 'todo:gmhabc12q7r2': [NOW, 1] } });
  assert.deepEqual(pickUnknown(m.doc.todos[0]), UNKNOWN, 'mergeState で残る');
});

await test('知っている欄の形の検査はそのまま（壊れた値は直り、知らない欄だけ素通し）', async () => {
  const store = await open(docWith([gTodo({ fx: 9, done: 'yes', start: '11/12', project: 'today' })]));
  const t = todosOf(store)[0];
  assert.equal(t.fx, 1);
  assert.equal(t.done, true);
  assert.equal(t.start, undefined, '日付の形でない start は落とす');
  assert.equal(t.project, undefined, '特別なタグは project に入れない');
  assert.equal(t.priorityV2, 'high');
  assert.equal(t.gapSlot, undefined, '前の版の単数の枠は gapSlots へ移すので残さない');
});

await test('保存データの頂上の知らない欄が、保存・読み込み・applyState で残る', async () => {
  const top = { futureIndex: { a: [1, 2] }, schemaNote: 'x' };
  let store = await open(docWith([gTodo()], top));
  store.setText('gmhabc12q7r2', '直した');
  assert.deepEqual(saved().futureIndex, top.futureIndex);
  assert.equal(saved().schemaNote, 'x');
  store = await reopen();
  assert.deepEqual(store.exportState().doc.futureIndex, top.futureIndex);
  const s2 = await open(null);
  s2.applyState({ doc: docWith([], top), stamps: {} });
  assert.deepEqual(s2.exportState().doc.futureIndex, top.futureIndex);
  assert.equal(s2.exportState().doc.stamps, undefined, '印は doc の中に入れない');
});

/* ============================================================ */
/* 2. 記録の形の版 */

/* sync.js を、作り物のサーバーで開く。server.get / server.put が応答を作る */
async function openSync(server, local) {
  mem.clear();
  if (local) mem.set(KEY, JSON.stringify(local));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://srv.test', token: 'tk' }));
  fakeNow = NOW;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status, obj) => ({ status, json: async () => obj });
    if (String(url).endsWith('/api/spaces')) return reply(404, { error: 'not found' });
    if (init.method === 'GET') return reply(...server.get());
    return reply(...server.put(JSON.parse(init.body)));
  };
  const { store } = await import(STORE_URL);
  /* store は1つを使い回す。手元の記録を入れ直す */
  store.applyState(local ? { doc: local, stamps: local.stamps || {} } : { doc: {}, stamps: {} });
  const mod = await import(`${SYNC_URL}?case=${++seq}`);
  return { store, sync: mod.sync, SCHEMA: mod.SCHEMA, calls };
}
async function settle(sync, want) {
  for (let i = 0; i < 100 && sync.status().state !== want; i++) await wait();
  await wait(30);
}

await test('すべての /api/data の要求に X-Bubbles-Schema: 1 を付け、data の頂上の知らない欄を残して PUT する', async () => {
  const remote = { doc: docWith([gTodo()]), stamps: { 'todo:gmhabc12q7r2': [NOW - 100, 1] }, futureTop: { k: 1 } };
  let stored = null;
  const { store, sync, SCHEMA, calls } = await openSync({
    get: () => [200, { space: 'me', version: 3, data: remote, minSchema: 1 }],
    put: (b) => { stored = b; return [200, { version: 4 }]; },
  });
  store.add('手元の泡');
  await settle(sync, 'ok');
  for (let i = 0; i < 100 && !stored; i++) await wait();
  assert.equal(SCHEMA, 1);
  const data = calls.filter(c => String(c.url).endsWith('/api/data'));
  assert.ok(data.length >= 2);
  data.forEach(c => assert.equal(c.headers['X-Bubbles-Schema'], '1', c.method + ' に頭書きが無い'));
  assert.ok(stored, 'PUT していない');
  assert.deepEqual(stored.data.futureTop, { k: 1 }, 'data の頂上の知らない欄を落とした');
  assert.deepEqual(pickUnknown(stored.data.doc.todos.find(t => t.id === 'gmhabc12q7r2')), UNKNOWN);
  sync.configure('', '');
});

await test('GET の minSchema が SCHEMA より大きいサーバーでは、合わせず書かず、状態 outdated で帯が出る', async () => {
  const remote = { doc: docWith([gTodo({ id: 'gremote1', text: 'サーバーだけにある' })]), stamps: { 'todo:gremote1': [NOW, 1] } };
  const { store, sync, calls } = await openSync({
    get: () => [200, { space: 'me', version: 7, data: remote, minSchema: 2 }],
    put: () => { throw new Error('PUT してはいけない'); },
  });
  const mine = store.add('止めている間に書いた泡');
  await settle(sync, 'outdated');
  assert.equal(sync.status().state, 'outdated');
  assert.equal(sync.status().message, 'この版は古いので同期を止めた。更新すると続きから合わさる');
  assert.deepEqual(sync.outdated(), { minSchema: 2 });
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0, '書いてはいけない');
  assert.ok(!todosOf(store).some(t => t.id === 'gremote1'), 'サーバーの記録を古い読み方で取り込まない');
  /* 手元の変更は印つきで残る（更新したあとの同期で入る） */
  const st = JSON.parse(mem.get(KEY));
  assert.ok(st.todos.some(t => t.id === mine.id));
  assert.ok(Array.isArray(st.stamps['todo:' + mine.id]), '手元の変更に印が付いている');
  /* 止めている間は、保存しても送りに行かない */
  const before = calls.length;
  store.add('もう1つ');
  await wait(1700);
  assert.equal(calls.length, before, '保存のたびに見に行った');

  /* 帯（作り物の document で） */
  const { mountSchemaGuard, OUTDATED_TEXT, NOT_FOUND_TEXT } = await import(GUARD_URL);
  const doc = fakeDocument();
  let found = false, applied = 0;
  const g = mountSchemaGuard({ document: doc, sync, checkForUpdate: async () => found, applyUpdate: async () => { applied++; } });
  assert.equal(g.bar.hidden, false, '帯が出ていない');
  assert.equal(g.bar.children[0].textContent, OUTDATED_TEXT);
  assert.equal(g.bar.children[1].textContent, '今すぐ更新');
  await g.bar.children[1].listeners.click();
  assert.equal(g.bar.children[0].textContent, NOT_FOUND_TEXT, '新しい版が無ければそう出す');
  assert.equal(applied, 0);
  found = true;
  await g.bar.children[1].listeners.click();
  assert.equal(applied, 1, '見つかれば入れ替える');
  sync.configure('', '');
  g.paint();
  assert.equal(g.bar.hidden, true, '止めていなければ帯は出ない');
});

await test('PUT が 426 なら書くのを止めて outdated にする（やり直さない）', async () => {
  let puts = 0;
  const { store, sync } = await openSync({
    get: () => [200, { space: 'me', version: 1, data: null }],
    put: () => { puts++; return [426, { error: 'upgrade', minSchema: 3 }]; },
  });
  store.add('手元');
  await settle(sync, 'outdated');
  assert.equal(sync.status().state, 'outdated');
  assert.deepEqual(sync.outdated(), { minSchema: 3 });
  assert.equal(puts, 1);
  sync.configure('', '');
});

await test('minSchema を返さない前の版のサーバーとは、今までどおり合わせる', async () => {
  let stored = null;
  const { store, sync } = await openSync({
    get: () => [200, { space: 'me', version: 0, data: null }],
    put: (b) => { stored = b; return [200, { version: 1 }]; },
  });
  store.add('手元');
  await settle(sync, 'ok');
  assert.equal(sync.status().state, 'ok');
  assert.equal(sync.outdated(), null);
  assert.ok(stored);
  sync.configure('', '');
});

function fakeDocument() {
  const mk = (tag) => ({
    tag, children: [], style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    attrs: {}, hidden: false, textContent: '', listeners: {}, disabled: false,
    offsetHeight: 0,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; },
  });
  const cls = new Set();
  const root = mk('html');
  root.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) };
  return { createElement: mk, body: mk('body'), head: mk('head'), documentElement: root };
}
/* 止まっている sync の代わり（帯の出し分けだけを見る） */
function stuckSync(on = { minSchema: 2 }) {
  const fns = [];
  return { state: on, outdated() { return this.state; }, on(f) { fns.push(f); }, fire() { fns.forEach(f => f()); } };
}

await test('[今すぐ更新]：Android の app なら確かめに行かず「作り直して入れ直す」', async () => {
  const { mountSchemaGuard, NATIVE_TEXT, isNativeApp } = await import(GUARD_URL);
  let checked = 0;
  const g = mountSchemaGuard({ document: fakeDocument(), sync: stuckSync(), native: true,
    checkForUpdate: async () => { checked++; return false; }, applyUpdate: async () => {} });
  await g.bar.children[1].listeners.click();
  assert.equal(g.bar.children[0].textContent, NATIVE_TEXT);
  assert.equal(checked, 0, 'service worker を見に行っても新しくならない');
  /* 判定 */
  assert.equal(isNativeApp({}), false);
  assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => false } }), false);
  assert.equal(isNativeApp({ Capacitor: {} }), true);
});

await test('[今すぐ更新]：service worker の登録が無いブラウザなら、押したらすぐ強制更新する（2026-11-12）', async () => {
  const { mountSchemaGuard, RELOAD_TEXT, NATIVE_TEXT, OUTDATED_TEXT } = await import(GUARD_URL);
  let forced = 0;
  const api = stuckSync();
  const g = mountSchemaGuard({ document: fakeDocument(), sync: api, native: false,
    checkForUpdate: async () => null, applyUpdate: async () => { throw new Error('入れ替えに行かない'); },
    forceReload: async () => { forced++; } });
  const [msg, btn] = g.bar.children;
  await btn.listeners.click();
  assert.equal(forced, 1, '1回押しただけで強制更新していない');
  assert.equal(msg.textContent, RELOAD_TEXT);
  assert.notEqual(msg.textContent, NATIVE_TEXT, 'Android の文を出さない');
  /* いちど消えてまた出たら、初めの字とボタンに戻る */
  api.state = null; api.fire();
  api.state = { minSchema: 2 }; api.fire();
  assert.equal(msg.textContent, OUTDATED_TEXT);
  assert.equal(btn.textContent, '今すぐ更新');
});

await test('forceReload は画面のキャッシュを全部消してから読み直す（消せなくても読み直す）', async () => {
  const { forceReload } = await import(new URL('../js/update.js', import.meta.url).href);
  const names = new Set(['bubbles-2026-11-12b', 'bubbles-2026-11-12a', 'bubbles-meta']);
  const order = [];
  await forceReload({
    cachesApi: { keys: async () => [...names], delete: async (n) => { order.push('del:' + n); return names.delete(n); } },
    reload: () => order.push('reload'),
  });
  assert.equal(names.size, 0);
  assert.equal(order[order.length - 1], 'reload', '消す前に読み直した');
  let reloaded = 0;
  await forceReload({ cachesApi: { keys: async () => { throw new Error('使えない'); } }, reload: () => { reloaded++; } });
  assert.equal(reloaded, 1);
  await forceReload({ cachesApi: undefined, reload: () => { reloaded++; } });
  assert.equal(reloaded, 2);
});

await test('帯が出ている間は、帯の高さだけ上の段を下げる（has-guard と --guard-h）。消えたら戻す', async () => {
  const { mountSchemaGuard } = await import(GUARD_URL);
  const doc = fakeDocument();
  const api = stuckSync(null);
  const g = mountSchemaGuard({ document: doc, sync: api, native: false, checkForUpdate: async () => false, applyUpdate: async () => {} });
  const root = doc.documentElement;
  const css = doc.head.children.map(c => c.textContent).join('');
  assert.match(css, /html\.has-guard\s*\{\s*--safe-t:\s*calc\(var\(--guard-h/, '--safe-t に帯の高さを足す');
  assert.match(css, /\.space-strip\s*\{\s*top:\s*var\(--guard-h/, '海の帯は帯の下に置く');
  assert.equal(root.classList.contains('has-guard'), false, '出ていなければ下げない');
  g.bar.offsetHeight = 44;
  api.state = { minSchema: 2 }; api.fire();
  assert.equal(root.classList.contains('has-guard'), true);
  assert.equal(root.style.props['--guard-h'], '44px');
  /* 折り返して高くなったら付け直す */
  g.bar.offsetHeight = 62; g.place();
  assert.equal(root.style.props['--guard-h'], '62px');
  api.state = null; api.fire();
  assert.equal(root.classList.contains('has-guard'), false);
  assert.equal(root.style.props['--guard-h'], undefined);
});

/* ============================================================ */
/* 3. 期間の正本は start・due */

await test('setSpan は start・due に書く（片方なら1日、逆なら入れ替え、空なら外す）。本文は変えない', async () => {
  const store = await open(null);
  const t = store.add('架空の泡');
  store.setDetail(t.id, 'メモ');
  assert.equal(store.setSpan(t.id, '2026-11-12', '2026-11-20'), true);
  let rec = saved().todos.find(x => x.id === t.id);
  assert.deepEqual([rec.start, rec.due, rec.detail], ['2026-11-12', '2026-11-20', 'メモ']);
  assert.ok(saved().stamps['todo:' + t.id], '印が付く');
  store.setSpan(t.id, '2026-11-25', '2026-11-21');
  rec = saved().todos.find(x => x.id === t.id);
  assert.deepEqual([rec.start, rec.due], ['2026-11-21', '2026-11-25']);
  store.setSpan(t.id, '', '2026-11-30');
  assert.deepEqual(store.spanOf(t.id), { start: '2026-11-30', due: '2026-11-30' });
  assert.equal(store.setSpan(t.id, '', '2026-11-30'), false, '同じなら書かない');
  store.setSpan(t.id, '', '');
  rec = saved().todos.find(x => x.id === t.id);
  assert.ok(!('start' in rec) && !('due' in rec));
  assert.deepEqual(store.spanOf(t.id), { start: null, due: null });
  assert.equal(rec.detail, 'メモ');
});

await test('先の予定（events.js）で入れた泡は、start・due にも期間が入る', async () => {
  const store = await open(null);
  const { addEvents } = await import(new URL('../js/events.js', import.meta.url).href);
  const ev = { key: 'k1', title: '架空の催し', date: '2026-11-15', end: '2026-11-18', topic: 'campaign', status: 'scheduled' };
  const { added } = addEvents(store, [{ ev, lead: 0 }], '2026-11-10');
  assert.equal(added.length, 1);
  assert.deepEqual(store.spanOf(added[0].id), { start: '2026-11-15', due: '2026-11-18' });
});

/* ============================================================ */

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
process.exit(0);
