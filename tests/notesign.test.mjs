/* ひとこと 1 件ずつの署名（2026-11-14 Issue #61 の N-A）。node --test tests/notesign.test.mjs
   署名して確かめる・名簿に無いアドレスや書き換えた文は確かめられない・記録の形が署名を残す・店の putNote を見る */
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

const { keysFromRoot } = await import('../js/chain.js');
const S = await import('../js/notesign.js');
const N = await import('../js/notes.js');

async function wallet(b) { return (await keysFromRoot(new Uint8Array(32).fill(b))).wallet; }

test('署名した 1 件は、名簿にあれば確かめられる。文を変える・名簿に無いと確かめられない', async () => {
  const me = await wallet(1);
  const other = await wallet(2);
  const n = N.makeNote('b1', 'ここまでやった', 'たろう', 'd1', 1700000000000, 0.5);
  const signed = await S.signNote(n, me);
  assert.equal(signed.sa, me.address);
  const rec = { owner: me.address, members: [{ a: me.address, n: '' }, { a: other.address, n: 'はなこ' }], gen: 1 };
  assert.equal((await S.checkNote(signed, rec)).ok, true);
  assert.equal((await S.checkNote({ ...signed, text: '別の文' }, rec)).ok, false);
  assert.equal((await S.checkNote({ ...signed, by: 'はなこ' }, rec)).ok, false);
  assert.equal((await S.checkNote(signed, { owner: other.address, members: [{ a: other.address }], gen: 2 })).ok, false);
  assert.equal((await S.checkNote(n, rec)).ok, false);           /* 署名なし */
  const byOther = await S.signNote(N.makeNote('b1', 'みた', 'はなこ', 'd2', 1700000001000, 0.1), other);
  const r = await S.checkNote(byOther, rec);
  assert.equal(r.ok, true);
  assert.equal(r.name, 'はなこ');
});

test('記録の形は署名を残す（形の合わないものは落とす）。消したものには付けない', async () => {
  const me = await wallet(3);
  const signed = await S.signNote(N.makeNote('b1', 'x', '', 'd1', 1000, 0.2), me);
  const back = N.normalizeNote(JSON.parse(JSON.stringify(signed)));
  assert.equal(back.sa, signed.sa);
  assert.equal(back.sg, signed.sg);
  assert.equal(N.normalizeNote({ ...signed, sa: 'not base58 0OIl' }).sa, undefined);
  assert.equal(N.normalizeNote({ ...signed, gone: 1 }).sg, undefined);
});

test('店: putNote は署名つきの 1 件をそのまま足す。無い泡・同じ id は足さない', async () => {
  mem.clear();
  mem.set('bubble_todo_space', 'share');
  const { store } = await import(new URL('../js/store.js', import.meta.url).href + '?sign=1');
  const id = store.add('資料を集める').id;
  const me = await wallet(4);
  const signed = await S.signNote(N.makeNote(id, '半分まで', 'たろう', 'd1', Date.now(), 0.3), me);
  const got = store.putNote(signed);
  assert.equal(got.sg, signed.sg);
  assert.equal(store.putNote(signed), null);                      /* 同じ id */
  assert.equal(store.putNote({ ...signed, id: 'nzz', todo: 'nope' }), null);
  assert.equal(store.notesOf(id)[0].sa, me.address);
});

test('開いた鍵は 10 分で捨てる', () => {
  S.dropWallet();
  assert.equal(S.heldWallet(), null);
  assert.equal(S.HOLD_MS, 10 * 60 * 1000);
});
