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

/* 海のチャット（サーバーあり版。Issue #42）。ひとことと同じ notes 欄に、泡でない宛先で積む */
test('チャット: 泡が無くても足せる。泡のひとことと混ざらない。保存と印に入る', async () => {
  const store = await openStore(null);
  const id = store.add('資料を集める').id;
  store.addNote(id, '泡のひとこと', 'たろう', 'd1');
  assert.equal(store.addChat('   ', 'たろう', 'd1'), null);
  const m = store.addChat('明日の打ち合わせは 10 時', 'たろう', 'd1');
  assert.equal(m.todo, N.CHAT_TODO);
  assert.deepEqual(store.chatOf().map(x => x.text), ['明日の打ち合わせは 10 時']);
  assert.deepEqual(store.notesOf(id).map(x => x.text), ['泡のひとこと']);
  assert.ok(!id.startsWith(N.CHAT_TODO));                      /* 泡の id と重ならない */
  const saved = JSON.parse(mem.get('bubble_todo_share_v1'));
  assert.equal(saved.notes.length, 2);
  assert.ok(saved.stamps['note:' + m.id]);                     /* サーバーへ写す印 */
  /* 消すのはひとことと同じ口。自分の端末のものだけ */
  assert.equal(store.removeNote(m.id, 'd2'), false);
  assert.equal(store.removeNote(m.id, 'd1'), true);
  assert.equal(store.chatOf()[0].gone, 1);
});

test('チャット: 読むだけの間は書けない', async () => {
  const store = await openStore(null);
  store.setReadOnly(true);
  assert.ok(!store.addChat('だめ', 'a', 'd1'));
  assert.equal(store.chatOf().length, 0);
});

test('チャット: 2つの端末（サーバーを通した写し）を合わせると両方残る。前の版の読み方でも落ちない', () => {
  const a = { doc: { notes: [{ id: 'n1', todo: N.CHAT_TODO, at: 10, by: 'A', dev: 'da', text: 'Aから' }] },
    stamps: { 'note:n1': [10, 1] } };
  const b = { doc: { notes: [{ id: 'n2', todo: N.CHAT_TODO, at: 15, by: 'B', dev: 'db', text: 'Bから' }] },
    stamps: { 'note:n2': [15, 1] } };
  const m = mergeState(a, b);
  assert.deepEqual(N.chatFor(m.doc.notes).map(x => x.text), ['Aから', 'Bから']);
  assert.deepEqual(mergeState(b, a).doc.notes, m.doc.notes);
  /* 前の版の端末の読み込み（normalizeNotes）でも、そのまま残る */
  assert.equal(N.normalizeNotes(m.doc.notes).length, 2);
});

test('チャット: チェーン・直の通信の履歴をサーバーへ写す形にする。何度写しても増えない', () => {
  const msgs = [
    { id: 'ab12cd34', by: 'ADDR1', at: 20, text: '届いた？' },
    { id: 'cADDR1x10', by: 'ADDR1', at: 10, text: '前の版の 1 通' },
    { id: 'ab12cd34', by: 'ADDR1', at: 20, text: '届いた？' },     /* 同じもの */
    { id: 'e1', by: 'ADDR2', at: 0, text: '時刻なし' },
    { id: 'e2', by: 'ADDR2', at: 30, text: '   ' },
    null,
  ];
  const nameOf = a => (a === 'ADDR1' ? 'はなこ' : '');
  const c = N.chatCopies(msgs, nameOf);
  assert.deepEqual(c.doc.notes.map(n => [n.id, n.by, n.text]), [['xcaddr1x10', 'はなこ', '前の版の 1 通'], ['xab12cd34', 'はなこ', '届いた？']]);
  assert.ok(c.doc.notes.every(n => n.todo === N.CHAT_TODO && n.dev === ''));
  assert.deepEqual(c.stamps['note:xab12cd34'], [20, 1]);
  /* 端末の記録に 2 回重ねても、件数は同じ。泡や他の記録は残る */
  const local = { doc: { todos: [{ id: 'b1', text: 'x' }], notes: [] }, stamps: { 'todo:b1': [5, 1] } };
  const once = mergeState(local, c);
  const twice = mergeState(once, N.chatCopies(msgs, nameOf));
  assert.equal(N.chatFor(twice.doc.notes).length, 2);
  assert.equal(twice.doc.todos.length, 1);
  assert.equal(N.normalizeNotes(twice.doc.notes).length, 2);
});

