/* 記録の CSV の書き出し・読み込み（js/csvio.js）のテスト。素の Node と assert だけで走る。

     node tests/csvio.test.mjs

   「端末」は store.js を読み直した別のモジュールで表す（sync.test.mjs と同じやり方）。 */

import assert from 'node:assert/strict';
import { toCsv, parseCsv, readCsv, importInto, csvFileName } from '../js/csvio.js';
import { recordsOf } from '../js/merge.js';

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
const D = new Date(2026, 9, 24, 10, 0).getTime();
let seq = 0;
async function device(now = D) {
  mem.clear();
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}
const texts = s => s.doc.todos.filter(t => !t.trashed).map(t => t.text).sort();

/* 引っ越し元の端末: todo・きっかけ・すきま・タグ・着手の記録・作業メモ・完了・消したもの */
async function richDevice() {
  const s = await device();
  const a = s.add('歯医者を予約, 午前中に "電話"\n2行目');
  s.setFirstStep(a.id, '診察券を出す');
  s.commitStep(a.id, { did: '番号を調べた', next: '電話する' });
  s.start(a.id, null);
  const an = s.addAnchor('歯を磨いたら');
  const b = s.add('ストレッチ'); s.setAnchor(b.id, an.id, true);
  s.setQuadrant(a.id, 'now'); s.setQuadrant(b.id, 'drift');   /* 優先度の印（急ぐ・大事）も移る */
  const tg = s.addTag('買い物');
  const c = s.add('牛乳'); s.setTag(c.id, tg.id, true); s.complete(c.id);
  const d = s.add('消したもの'); s.remove(d.id);
  s.flush();
  return s;
}

await test('CSV の形: BOM・1行目・meta・\\r\\n。カンマ・引用符・改行を含む本文も壊れない', async () => {
  const s = await richDevice();
  const csv = toCsv(s.exportState(), 'me', D);
  assert.ok(csv.startsWith('﻿kind,id,text,date,data,stamp\r\n'));
  const rows = parseCsv(csv);
  assert.equal(rows[1][0], 'meta');
  assert.equal(rows[1][2], '個人');
  const todo = rows.find(r => r[0] === 'todo' && r[2].startsWith('歯医者'));
  assert.equal(todo[2], '歯医者を予約, 午前中に "電話"\n2行目');
  assert.match(todo[3], /^2026-10-24T10:00/);
  assert.equal(csvFileName('share', D), 'bubbles-共有-20261024.csv');
});

await test('空の端末へ引っ越し（足す）: 記録がすべて同じになる', async () => {
  const from = await richDevice();
  const A = from.exportState();
  const csv = toCsv(A, 'me', D);
  const to = await device(D + 1000);
  const r = importInto(to.exportState(), readCsv(csv), 'add', D + 1000);
  to.applyState(r.state);
  const B = to.exportState();
  /* 既定のタグ・すきまの枠は両方にあるので、その分を除いて同じ記録の集まり */
  const ra = recordsOf(A.doc), rb = recordsOf(B.doc);
  for (const [k, v] of ra) {
    if (k.startsWith('order:')) continue;
    assert.deepEqual(rb.get(k), v, k);
  }
  assert.deepEqual(texts(B), texts(A));
  assert.equal(B.doc.todos.find(t => t.text === '消したもの').trashed, true, '消したものは消したまま');
  assert.equal(B.doc.log.length, A.doc.log.length, '着手の記録も移る');
  const st = B.doc.todos.find(t => t.text === 'ストレッチ');
  assert.deepEqual([st.urgent, st.important], [false, false], '優先度の印（いいえ）も移る');
  assert.equal(B.doc.todos.find(t => t.text.startsWith('歯医者')).urgent, true);
  assert.ok(r.added >= 4);
});

await test('足す: 同じ CSV を2回読んでも増えず、今の端末の書き換えは消えない', async () => {
  const from = await richDevice();
  const csv = toCsv(from.exportState(), 'me', D);
  const to = await device(D + 1000);
  to.applyState(importInto(to.exportState(), readCsv(csv), 'add').state);
  const id = to.all().find(t => t.text === 'ストレッチ').id;
  to.setText(id, 'ストレッチ（10分）');
  const before = to.exportState();
  const r = importInto(before, readCsv(csv), 'add');
  assert.equal(r.added, 0);
  assert.deepEqual(texts(r.state), texts(before));
  assert.ok(texts(r.state).includes('ストレッチ（10分）'), '今の端末の書き換えが残る');
});

await test('同じものは上書き: CSV の中身で書き換え、この端末にしかない記録は残す', async () => {
  const from = await richDevice();
  const csv = toCsv(from.exportState(), 'me', D);
  const to = await device(D + 1000);
  to.applyState(importInto(to.exportState(), readCsv(csv), 'add').state);
  const id = to.all().find(t => t.text === 'ストレッチ').id;
  to.setText(id, 'ストレッチ（10分）');
  to.add('この端末だけ');
  const r = importInto(to.exportState(), readCsv(csv), 'overwrite', D + 5000);
  assert.ok(texts(r.state).includes('ストレッチ'), 'CSV の中身に戻る');
  assert.ok(!texts(r.state).includes('ストレッチ（10分）'));
  assert.ok(texts(r.state).includes('この端末だけ'));
  assert.ok(r.replaced >= 1);
  assert.equal(r.state.stamps['todo:' + id][0], D + 5000, '読み込んだ記録には今の印（ほかの端末へ届く）');
});

await test('足すでは、この端末で消した記録を戻さない。上書きでは戻す', async () => {
  const from = await richDevice();
  const csv = toCsv(from.exportState(), 'me', D);
  const to = await device(D + 1000);
  to.applyState(importInto(to.exportState(), readCsv(csv), 'add').state);
  const an = to.anchors().find(a => a.name === '歯を磨いたら');
  to.removeAnchor(an.id);
  const add = importInto(to.exportState(), readCsv(csv), 'add');
  assert.ok(!add.state.doc.anchors.some(a => a.id === an.id));
  const ow = importInto(to.exportState(), readCsv(csv), 'overwrite');
  assert.ok(ow.state.doc.anchors.some(a => a.id === an.id));
});

await test('Bubbles の CSV でないファイルは、わけを付けて断る', async () => {
  assert.throws(() => readCsv(''), /空のファイル/);
  assert.throws(() => readCsv('name,price\r\nりんご,100\r\n'), /Bubbles の CSV ではない/);
  assert.throws(() => readCsv('﻿kind,id,text,date,data,stamp\r\ntodo,x,a,,{},1\r\n'), /meta の行が無い/);
  assert.throws(() => readCsv('kind,id,text,date,data,stamp\r\nmeta,bubbles,個人,,"{""format"":""bubbles-csv"",""version"":9}",\r\n'), /新しい版/);
});

await test('Excel などで保存し直した CSV（BOM 無し・\\n・空行）も読める', async () => {
  const from = await richDevice();
  const csv = toCsv(from.exportState(), 'me', D).replace(/^﻿/, '').replace(/\r\n/g, '\n') + '\n\n';
  const got = readCsv(csv);
  assert.ok(got.recs.size > 5);
  assert.equal(got.bad, 0);
});

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
