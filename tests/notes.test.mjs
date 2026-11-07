/* 泡ごとのひとこと（Issue #25）。node --test tests/notes.test.mjs
   計算（js/notes.js）と、店（store.js の addNote・removeNote）と、2つの端末で合わせたとき（merge.js）・CSV を見る */
import test from 'node:test';
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

const N = await import('../js/notes.js');
const { mergeState } = await import('../js/merge.js');
const { toCsv, readCsv, importInto } = await import('../js/csvio.js');
const STORE_URL = new URL('../js/store.js', import.meta.url).href;
let seq = 0;
async function openStore(saved) {
  mem.clear();
  mem.set('bubble_todo_space', 'share');
  if (saved) mem.set('bubble_todo_share_v1', JSON.stringify(saved));
  return (await import(`${STORE_URL}?notes=${++seq}`)).store;
}

test('文は前後の空白を落とし、280字で切る。空は作らない', () => {
  assert.equal(N.cleanNote('  ここまで\n\n\n\nやった '), 'ここまで\n\nやった');
  assert.equal(Array.from(N.cleanNote('あ'.repeat(400))).length, N.NOTE_MAX);
  assert.equal(N.makeNote('b1', '   ', '', 'd1', 1000), null);
  const n = N.makeNote('b1', '詰まっている', '  たろう  ', 'd1', 1000, 0.5);
  assert.deepEqual({ ...n, id: undefined }, { id: undefined, todo: 'b1', at: 1000, by: 'たろう', dev: 'd1', text: '詰まっている' });
  assert.match(n.id, /^n[a-z0-9]+$/);
});

test('読めない記録は落とし、消したものは文を持たない。並びは時刻順', () => {
  const got = N.normalizeNotes([
    { id: 'n2', todo: 'b1', at: 20, text: 'b', dev: 'x' },
    { id: 'n1', todo: 'b1', at: 10, text: 'a', dev: 'x' },
    { id: 'n3', todo: 'b1', at: 30, text: '残っていた文', gone: 1 },
    { id: 'n4', todo: '', at: 40, text: 'x' },
    { id: 'n5', todo: 'b1', at: 50, text: '  ' },
    { id: 'n1', todo: 'b1', at: 60, text: '同じ id' },
    null,
  ]);
  assert.deepEqual(got.map(n => n.id), ['n1', 'n2', 'n3']);
  assert.equal(got[2].text, '');
  assert.equal(got[2].gone, 1);
});

test('消せるのは自分の端末で書いた、まだ消していないものだけ', () => {
  assert.equal(N.canRemove({ dev: 'd1' }, 'd1'), true);
  assert.equal(N.canRemove({ dev: 'd1' }, 'd2'), false);
  assert.equal(N.canRemove({ dev: 'd1', gone: 1 }, 'd1'), false);
  assert.equal(N.canRemove({ dev: '' }, ''), false);
});

test('点は、開いた時刻より新しい、ほかの端末の、消していないひとことがあるときだけ', () => {
  const rows = [{ at: 10, dev: 'me' }, { at: 20, dev: 'you' }, { at: 30, dev: 'you', gone: 1 }];
  assert.equal(N.hasUnseen(rows, 5, 'me'), true);
  assert.equal(N.hasUnseen(rows, 20, 'me'), false);     /* 開いたあと */
  assert.equal(N.hasUnseen([{ at: 99, dev: 'me' }], 0, 'me'), false);   /* 自分の書いたもの */
  assert.equal(N.latestAt(rows), 30);
});

test('開いた時刻の覚えは海ごと。覚えの無い端末は、初めて見た時刻から数える', () => {
  mem.clear();
  const t0 = N.seenAt('s1', 'b1');
  assert.ok(t0 > 0);                                     /* 前からあるものに点を付けない */
  N.markSeen('s1', 'b1', t0 + 500);
  assert.equal(N.seenAt('s1', 'b1'), t0 + 500);
  N.markSeen('s1', 'b1', 1);                             /* 戻さない */
  assert.equal(N.seenAt('s1', 'b1'), t0 + 500);
  assert.ok(N.seenAt('s2', 'b1') < t0 + 500);
});

test('端末の印は1度作ったら同じ。名前は設定が無ければパスキーの名前', () => {
  mem.clear();
  const d = N.deviceId();
  assert.match(d, /^d[a-z0-9]+$/);
  assert.equal(N.deviceId(), d);
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://x', sessionName: 'はなこ' }));
  assert.equal(N.noteName(), 'はなこ');
  N.setNoteName('  たろう ');
  assert.equal(N.noteName(), 'たろう');
  N.setNoteName('');
  assert.equal(N.noteName(), '');                        /* 空にしたら空のまま（パスキーの名前に戻さない） */
});

test('店: 足す・自分のものだけ消す。消した印は残る', async () => {
  const store = await openStore(null);
  const id = store.add('資料を集める').id;
  assert.equal(store.addNote('nope', 'x', 'a', 'd1'), null);   /* 無い泡 */
  assert.equal(store.addNote(id, '  ', 'a', 'd1'), null);
  const n = store.addNote(id, '半分まで', 'たろう', 'd1');
  assert.equal(n.text, '半分まで');
  assert.equal(store.notesOf(id).length, 1);
  assert.equal(store.removeNote(n.id, 'd2'), false);           /* ほかの端末のもの */
  assert.equal(store.removeNote(n.id, 'd1'), true);
  const after = store.notesOf(id);
  assert.equal(after.length, 1);
  assert.equal(after[0].gone, 1);
  assert.equal(after[0].text, '');
  /* 保存にも入る（読み直しても残る） */
  const saved = JSON.parse(mem.get('bubble_todo_share_v1'));
  assert.equal(saved.notes.length, 1);
  assert.ok(saved.stamps['note:' + n.id]);
});

test('店: 読むだけの間は書けない', async () => {
  const store = await openStore(null);
  const id = store.add('x').id;
  store.setReadOnly(true);
  assert.ok(!store.addNote(id, 'だめ', 'a', 'd1'));
  assert.equal(store.notesOf(id).length, 0);
});

test('2つの端末のひとことは、合わせると両方残る。消した印は消した側が勝つ', () => {
  const a = { doc: { notes: [{ id: 'n1', todo: 'b1', at: 10, by: 'A', dev: 'da', text: 'Aの1' }] },
    stamps: { 'note:n1': [10, 1] } };
  const b = { doc: { notes: [
    { id: 'n1', todo: 'b1', at: 10, by: 'A', dev: 'da', text: '', gone: 1 },
    { id: 'n2', todo: 'b1', at: 15, by: 'B', dev: 'db', text: 'Bの1' },
  ] }, stamps: { 'note:n1': [20, 1], 'note:n2': [15, 1] } };
  const m1 = mergeState(a, b), m2 = mergeState(b, a);
  assert.deepEqual(m1.doc.notes, m2.doc.notes);
  assert.deepEqual(m1.doc.notes.map(n => n.id), ['n1', 'n2']);
  assert.equal(m1.doc.notes[0].gone, 1);
});

test('CSV の書き出し・読み込みにも入る', () => {
  const state = { doc: { notes: [{ id: 'n1', todo: 'b1', at: 10, by: 'A', dev: 'da', text: '進んだ' }] },
    stamps: { 'note:n1': [10, 1] } };
  const csv = toCsv(state, 'share', 1000, '共有');
  const read = readCsv(csv);
  assert.equal(read.bad, 0);
  assert.equal(read.recs.get('note:n1').text, '進んだ');
  const out = importInto({ doc: {}, stamps: {} }, read, 'add', 2000);
  assert.equal(out.state.doc.notes.length, 1);
});
