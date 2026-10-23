/* 複数の端末の記録を合わせるテスト（js/merge.js と store の印）。
   素の Node と assert だけで走る。

     node tests/sync.test.mjs

   「端末」は store.js を読み直した別のモジュールで表す。端末を替えるときは
   localStorage の中身をその端末のものに入れ替えてから開く（open）。 */

import assert from 'node:assert/strict';
import { mergeState, sameStamps, recordsOf } from '../js/merge.js';

const KEY = 'bubble_todo_v1';
const STORE_URL = new URL('../js/store.js', import.meta.url).href;

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
function setNow(ms) { fakeNow = ms; }
function ms(y, m, d, h = 0, mi = 0) { return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); }

/* 端末を開く。saved は localStorage に入れておく中身（null なら空の端末） */
let seq = 0;
async function open(saved, now) {
  mem.clear();
  if (saved) mem.set(KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  setNow(now);
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}
/* その端末の今の保存（印つき） */
function savedOf() { return mem.get(KEY); }

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const D1 = ms(2026, 10, 23, 9, 0);
const texts = st => st.doc.todos.filter(t => !t.trashed).map(t => t.text).sort();

await test('新しい空の端末と合わせても、前からの記録（印の無い版）が既定値に負けない', async () => {
  /* 印を持たない前の版の保存データ。「仕事」タグを改名してある */
  const legacy = {
    v: 2, todos: [{ id: 'x1', text: '灯油', createdAt: D1 - 1e6, fx: .5, fy: .5 }],
    tags: [{ id: 'work', name: '本業', color: '#ffd1dc', dir: 'left' }], lastDay: '2026-10-23',
  };
  const a = await open(legacy, D1);
  const A = a.exportState();
  assert.deepEqual(A.stamps['todo:x1'], [1, 1], '前の版の記録には 1 が付く');
  const b = await open(null, D1 + 1000);
  const B = b.exportState();
  assert.equal(B.stamps['tag:work'][0], 0, '空の端末の既定値は 0');
  const m = mergeState(B, A);
  assert.deepEqual(texts(m), ['灯油']);
  assert.equal(m.doc.tags.find(t => t.id === 'work').name, '本業', '改名したほうが残る');
});

await test('別々の端末で足した項目は両方残る。同じ項目は新しく書き換えたほうが残る', async () => {
  const a = await open(null, D1);
  const id = a.add('牛乳').id;
  a.add('Aだけ');
  const base = a.exportState();
  /* B は A の記録を受け取ってから書き換える */
  const b = await open(null, D1 + 10);
  b.applyState(base);
  setNow(D1 + 60000);
  b.setText(id, '豆乳');
  b.add('Bだけ');
  const B = b.exportState();
  /* A はそのあと（古い時刻のまま）別のことだけする */
  const a2 = await open(JSON.stringify(Object.assign({}, base.doc, { stamps: base.stamps })), D1 + 30000);
  a2.add('Aあとから');
  const A = a2.exportState();
  const m = mergeState(A, B);
  assert.deepEqual(texts(m), ['Aあとから', 'Aだけ', 'Bだけ', '豆乳']);
  /* 同じ項目を A がもっと後に書き換えたら A が勝つ */
  setNow(D1 + 120000);
  a2.setText(id, 'オーツ');
  const m2 = mergeState(a2.exportState(), B);
  assert.ok(texts(m2).includes('オーツ') && !texts(m2).includes('豆乳'));
});

await test('片方で消したアンカーは、合わせても戻ってこない', async () => {
  const a = await open(null, D1);
  const an = a.addAnchor('歯を磨いたら');
  const base = a.exportState();
  setNow(D1 + 5000);
  a.removeAnchor(an.id);
  const A = a.exportState();
  assert.equal(A.stamps['anchor:' + an.id][1], 0, '消した印（墓石）が付く');
  const m = mergeState(base, A);
  assert.equal(m.doc.anchors.length, 0);
});

await test('あとから開いた端末の日の切り替えが、今日ほかの端末で付けた「はじめた」を消さない', async () => {
  /* 昨日の記録を両方が持っている */
  const y = ms(2026, 10, 22, 20, 0);
  const a0 = await open(null, y);
  const id = a0.add('ヨガ').id;
  a0.start(id, null);                 /* 昨日もはじめていた（日が変わると消える） */
  const yesterday = a0.exportState();
  /* A は今日 8:05 に開いて、はじめた */
  const a = await open(JSON.stringify(Object.assign({}, yesterday.doc, { stamps: yesterday.stamps })), ms(2026, 10, 23, 8, 0));
  setNow(ms(2026, 10, 23, 8, 5));
  assert.ok(a.start(id, null));
  const A = a.exportState();
  /* B は 9:00 に昨日の記録のまま開く（読み込みで日が切り替わる） */
  const b = await open(JSON.stringify(Object.assign({}, yesterday.doc, { stamps: yesterday.stamps })), ms(2026, 10, 23, 9, 0));
  const B = b.exportState();
  const m = mergeState(B, A);
  const t = m.doc.todos.find(x => x.id === id);
  assert.ok(Number.isFinite(t.started['']), '今日のはじめたが残る');
  assert.equal(t.started[''], ms(2026, 10, 23, 8, 5));
  assert.equal(m.doc.log.length, 2, '昨日と今日の着手ログ');
});

await test('合わせる向きを入れ替えても同じ答え。もう一度合わせても変わらない', async () => {
  const a = await open(null, D1);
  a.add('a1'); a.addTag('しごと');
  const A = a.exportState();
  const b = await open(null, D1 + 7);
  b.add('b1'); b.addAnchor('朝');
  const B = b.exportState();
  const ab = mergeState(A, B), ba = mergeState(B, A);
  assert.ok(sameStamps(ab.stamps, ba.stamps));
  assert.deepEqual(recordsOf(ab.doc), recordsOf(ba.doc));
  assert.ok(sameStamps(mergeState(ab, B).stamps, ab.stamps), '同じ相手ともう一度合わせても変わらない');
});

await test('受け取った記録は「今書き換えた」ことにならない。次の保存で触った項目だけに印が付く', async () => {
  const a = await open(null, D1);
  const i1 = a.add('一').id, i2 = a.add('二').id;
  const A = a.exportState();
  const b = await open(null, D1 + 50000);
  b.applyState(A);
  assert.ok(sameStamps(b.exportState().stamps, A.stamps), '受け取っただけでは印が変わらない');
  assert.ok(JSON.parse(savedOf()).stamps, '印も保存される');
  setNow(D1 + 90000);
  b.setText(i2, 'に');
  const S = b.exportState().stamps;
  assert.equal(S['todo:' + i1][0], A.stamps['todo:' + i1][0]);
  assert.equal(S['todo:' + i2][0], D1 + 90000);
});

await test('sync.js: 送る間に別の端末が書いたら（409）、取り直して両方を残す', async () => {
  /* 別の端末が先に置いた記録 */
  const o = await open(null, D1);
  o.add('ほかの端末');
  const other = o.exportState();
  /* 手元の端末。住所を入れてから sync.js を読む */
  mem.clear();
  setNow(D1 + 1000);
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'http://srv.test', token: 'tk' }));
  let server = { version: 0, data: null };
  let raced = false;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(init.method);
    assert.equal(init.headers.Authorization, 'Bearer tk');
    const reply = (status, obj) => ({ status, json: async () => obj });
    if (init.method === 'GET') return reply(200, server);
    const body = JSON.parse(init.body);
    if (!raced) {                      /* 1回目の PUT の直前に、ほかの端末が書く */
      raced = true;
      server = { version: server.version + 1, data: other };
    }
    if (body.base !== server.version) return reply(409, server);
    server = { version: server.version + 1, data: body.data };
    return reply(200, { version: server.version });
  };
  const { store } = await import(new URL('../js/store.js', import.meta.url).href);
  const { sync } = await import(new URL('../js/sync.js', import.meta.url).href);
  /* 読み込んだ時点で1回目が走っている。手元で書くと、それが終わったあとにもう1回走る */
  store.add('手元');
  for (let i = 0; i < 50 && !(sync.status().state === 'ok' && calls.length >= 4); i++) {
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => setTimeout(r, 50));
  assert.ok(raced, '食い違いが起きた');
  assert.deepEqual(calls.slice(0, 4), ['GET', 'PUT', 'GET', 'PUT'], '409 のあと取り直して書く');
  assert.deepEqual(texts(server.data), ['ほかの端末', '手元']);
  assert.deepEqual(store.all().map(t => t.text).sort(), ['ほかの端末', '手元'], '手元にも届く');
  assert.equal(sync.status().state, 'ok');
  sync.configure('', '');              /* 次の合図（タイマー）を止める */
});

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
