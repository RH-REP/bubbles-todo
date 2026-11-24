/* プロジェクトの記録と記録の形の版 2（2026-11-24 ユーザーの決定）のテスト。素の Node と assert だけで走る。データはすべて架空。

     node tests/projects.test.mjs

   1. 合わせ方（js/merge.js）: 記録ごとに新しいほうが残る・古い写しで戻らない・無い海には欄を作らない
   2. 読み書き（js/store.js）: todo の project の p_ が残る・doc.projects と知らない欄が残る・盤に出す名前
   3. 版 1 の端末・版 1 のサーバーと混ぜる（tests/fixtures/merge-v1.mjs ＝ 版 1 の合わせ方を写したもの） */

import assert from 'node:assert/strict';
import { mergeState, recordsOf, stampChanges } from '../js/merge.js';
import { mergeState as mergeV1 } from './fixtures/merge-v1.mjs';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
const KEY = 'bubble_todo_v1';
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
const clone = (x) => JSON.parse(JSON.stringify(x));

/* 架空のプロジェクト（gantt が作る形。知らない欄 future も持たせる） */
const P1 = { id: 'p_k3x9', name: '論文A（架空）', color: '#e9a23b', start: '2026-11-20', due: '2026-12-12', goal: '投稿まで',
  lead: 'u_2af17f2c', status: 'active', createdAt: 1763900000000, ext: { gantt: { fold: false } }, future: { x: 1 } };
const P2 = { id: 'p_m7q2', name: '発表B（架空）', color: '#5b8def', status: 'active', createdAt: 1763900000100 };
function stateWith(projects, stamps, todos = []) {
  return { doc: { todos, tags: [], projects }, stamps };
}

/* ============================================================ */
/* 1. 合わせ方 */

await test('2 つの端末が別々のプロジェクトを直しても、両方残る（どちら向きに合わせても同じ）', async () => {
  const base = { 'project:p_k3x9': [10, 1], 'project:p_m7q2': [10, 1], 'order:project': [10, 1] };
  const A = stateWith([Object.assign({}, P1, { name: '論文A（端末 A で直した）' }), P2],
    Object.assign({}, base, { 'project:p_k3x9': [20, 1] }));
  const B = stateWith([P1, Object.assign({}, P2, { status: 'paused' })],
    Object.assign({}, base, { 'project:p_m7q2': [30, 1] }));
  for (const m of [mergeState(A, B), mergeState(B, A)]) {
    const by = Object.fromEntries(m.doc.projects.map(p => [p.id, p]));
    assert.equal(by.p_k3x9.name, '論文A（端末 A で直した）');
    assert.equal(by.p_m7q2.status, 'paused');
    assert.deepEqual(by.p_k3x9.future, { x: 1 }, 'プロジェクトの知らない欄を落とした');
    assert.deepEqual([m.stamps['project:p_k3x9'], m.stamps['project:p_m7q2']], [[20, 1], [30, 1]]);
  }
});

await test('古い写しで合わせても、プロジェクトが戻らない（手元の古い doc が勝つ道を通らない）', async () => {
  const fresh = stateWith([Object.assign({}, P1, { name: '新しい名前' })], { 'project:p_k3x9': [50, 1], 'order:project': [50, 1] });
  const stale = stateWith([Object.assign({}, P1, { name: '古い名前' })], { 'project:p_k3x9': [5, 1], 'order:project': [5, 1] });
  assert.equal(mergeState(stale, fresh).doc.projects[0].name, '新しい名前', '手元（a）の古い写しが勝った');
  assert.equal(mergeState(fresh, stale).doc.projects[0].name, '新しい名前');
  /* 消した印のほうが新しければ、古い写しから戻ってこない */
  const gone = stateWith([], { 'project:p_k3x9': [60, 0], 'order:project': [60, 1] });
  for (const m of [mergeState(stale, gone), mergeState(gone, stale)]) {
    assert.deepEqual(m.doc.projects, []);
    assert.deepEqual(m.stamps['project:p_k3x9'], [60, 0]);
  }
});

await test('プロジェクトの無い海には、欄も並びの印も作らない（版を上げただけで書き込みが起きない）', async () => {
  const a = { doc: { todos: [{ id: 't1', text: 'x' }] }, stamps: { 'todo:t1': [1, 1], 'order:todo': [1, 1] } };
  const m = mergeState(a, { doc: { todos: [] }, stamps: {} });
  assert.ok(!('projects' in m.doc));
  assert.ok(!('order:project' in m.stamps));
  assert.ok(![...recordsOf(m.doc).keys()].some(k => k.includes('project')));
  /* 保存のたびの印付けでも増えない */
  const prev = new Map();
  recordsOf(a.doc).forEach((v, k) => prev.set(k, JSON.stringify(v)));
  const st = clone(a.stamps);
  stampChanges(prev, a.doc, st, 99);
  assert.deepEqual(st, a.stamps);
});

/* ============================================================ */
/* 2. 読み書き（store） */

let seq = 0;
async function open(raw) {
  mem.clear();
  if (raw) mem.set(KEY, JSON.stringify(raw));
  return (await import(`${STORE_URL}?p=${++seq}`)).store;
}

await test('todo の project の p_ は、指す先が無くても読み込み・保存で残る。タグの id は今までどおり', async () => {
  const doc = { v: 2, tags: [{ id: 'tproj1', name: '架空の案件' }], projects: [P1],
    todos: [
      { id: 'a', text: 'p_ を指す', createdAt: 1, project: 'p_k3x9' },
      { id: 'b', text: 'まだ届いていないプロジェクト', createdAt: 2, project: 'p_zzzz' },
      { id: 'c', text: 'タグを指す', createdAt: 3, project: 'tproj1' },
      { id: 'd', text: '形の違う値', createdAt: 4, project: 'nothing-here' },
      { id: 'e', text: '特別なタグ', createdAt: 5, project: 'hold' },
    ] };
  let store = await open(doc);
  const pj = Object.fromEntries(store.exportState().doc.todos.map(t => [t.id, t.project]));
  assert.deepEqual(pj, { a: 'p_k3x9', b: 'p_zzzz', c: 'tproj1', d: undefined, e: undefined });
  store.setText('a', '直した');
  store.flush();
  const saved = JSON.parse(mem.get(KEY));
  assert.equal(saved.todos.find(t => t.id === 'a').project, 'p_k3x9');
  assert.equal(saved.todos.find(t => t.id === 'b').project, 'p_zzzz');
  assert.deepEqual(saved.projects, [P1], 'doc.projects（知らない欄も）を落とした');
  /* タグを消しても、プロジェクトの id は外れない */
  store.removeTag('tproj1');
  const after = Object.fromEntries(store.exportState().doc.todos.map(t => [t.id, t.project]));
  assert.deepEqual([after.a, after.b, after.c], ['p_k3x9', 'p_zzzz', undefined]);
});

await test('盤に出すプロジェクトの名前（読むだけ）。指す先が無い・消えたなら出さない', async () => {
  const store = await open({ v: 2, tags: [], projects: [P1, { id: 'p_bad1', name: '' }],
    todos: [{ id: 'a', text: 'x', createdAt: 1, project: 'p_k3x9' }, { id: 'b', text: 'y', createdAt: 2, project: 'p_none' },
      { id: 'c', text: 'z', createdAt: 3, project: 'p_bad1' }, { id: 'd', text: 'w', createdAt: 4 }] });
  assert.equal(store.projectOf('a').name, '論文A（架空）');
  assert.equal(store.projectOf('b'), null);
  assert.equal(store.projectOf('c'), null, '名前の無い記録は出さない');
  assert.equal(store.projectOf('d'), null);
  assert.deepEqual(store.projects().map(p => p.id), ['p_k3x9', 'p_bad1']);
});

await test('サーバーから届いたプロジェクトの記録が、合わせて保存しても残る（印ごと）', async () => {
  const store = await open({ v: 2, tags: [], todos: [] });
  const remote = stateWith([P1, P2], { 'project:p_k3x9': [40, 1], 'project:p_m7q2': [40, 1], 'order:project': [40, 1] });
  store.applyState(mergeState(store.exportState(), remote));
  store.add('手元の泡');
  store.flush();
  const saved = JSON.parse(mem.get(KEY));
  assert.deepEqual(saved.projects.map(p => p.id), ['p_k3x9', 'p_m7q2']);
  assert.deepEqual(saved.stamps['project:p_k3x9'], [40, 1]);
  const back = (await import(`${STORE_URL}?p=${++seq}`)).store;
  assert.deepEqual(back.projects().map(p => p.name), ['論文A（架空）', '発表B（架空）']);
});

/* ============================================================ */
/* 3. 版 1 の端末・版 1 のサーバーと混ぜる */

/* 端末が合わせる: サーバーの記録と手元を合わせ、手元とサーバーの両方をその結果にする（sync.js と同じ筋） */
function syncWith(merge, dev, server) {
  const m = merge(dev.state, server.state);
  dev.state = clone(m);
  server.state = clone(m);
}
function edit(dev, id, text, at) {
  const t = dev.state.doc.todos.find(x => x.id === id);
  t.text = text;
  dev.state.stamps['todo:' + id] = [at, 1];
}

await test('プロジェクトがまだ無い今の記録で、版 2 と版 1 の端末が交互に書いても、どちらの書き換えも消えない', async () => {
  const start = { doc: { tags: [{ id: 'tproj1', name: '架空の案件' }],
    todos: [{ id: 'a', text: 'A', createdAt: 1, project: 'tproj1' }, { id: 'b', text: 'B', createdAt: 2 }] },
    stamps: { 'todo:a': [1, 1], 'todo:b': [1, 1], 'order:todo': [1, 1], 'tag:tproj1': [1, 1], 'order:tag': [1, 1] } };
  const server = { state: clone(start) };
  const v2 = { state: clone(start) }, v1 = { state: clone(start) };
  edit(v2, 'a', 'A（版 2 で直した）', 10); syncWith(mergeState, v2, server);
  edit(v1, 'b', 'B（版 1 で直した）', 20); syncWith(mergeV1, v1, server);
  syncWith(mergeState, v2, server);
  edit(v1, 'a', 'A（版 1 でもう一度）', 30); syncWith(mergeV1, v1, server);
  syncWith(mergeState, v2, server);
  const by = Object.fromEntries(server.state.doc.todos.map(t => [t.id, t]));
  assert.equal(by.a.text, 'A（版 1 でもう一度）');
  assert.equal(by.b.text, 'B（版 1 で直した）');
  assert.equal(by.a.project, 'tproj1');
  assert.ok(!('projects' in server.state.doc), '版 2 がプロジェクトの欄を作った');
  assert.ok(!Object.keys(server.state.stamps).some(k => k.includes('project')));
  assert.deepEqual(v1.state.doc, v2.state.doc);
});

await test('プロジェクトがある記録でも、版 1 の端末が合わせたあとに版 2 が合わせれば、プロジェクトと印は残る', async () => {
  const start = { doc: { tags: [], projects: [P1], todos: [{ id: 'a', text: 'A', createdAt: 1, project: 'p_k3x9' }] },
    stamps: { 'todo:a': [1, 1], 'order:todo': [1, 1], 'project:p_k3x9': [5, 1], 'order:project': [5, 1] } };
  const server = { state: clone(start) };
  const v2 = { state: clone(start) };
  const v1 = { state: clone(start) };
  edit(v1, 'a', 'A（版 1 で直した）', 10);
  syncWith(mergeV1, v1, server);
  /* 版 1 の合わせ方は、プロジェクトの記録を知らない欄としてそのまま残す（消さない）。ただし印は落とす */
  assert.deepEqual(server.state.doc.projects, [P1], '版 1 の端末がプロジェクトを消した');
  const v1DroppedStamps = !('project:p_k3x9' in server.state.stamps);
  syncWith(mergeState, v2, server);
  assert.deepEqual(server.state.doc.projects, [P1]);
  assert.deepEqual(server.state.stamps['project:p_k3x9'], [5, 1], '版 2 が印を戻していない');
  assert.equal(server.state.doc.todos[0].text, 'A（版 1 で直した）');
  assert.equal(server.state.doc.todos[0].project, 'p_k3x9');
  /* 版 1 が印を落とすことは、試験の中で事実として確かめておく（gantt が minSchema 2 まで書かない理由の 1 つ） */
  assert.equal(v1DroppedStamps, true);
});

/* ============================================================ */

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
