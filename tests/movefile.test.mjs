/* 引っ越しのファイル（js/movefile.js。Issue #19）のテスト。素の Node と assert だけで走る。

     node tests/movefile.test.mjs

   暗号は Node の WebCrypto（globalThis.crypto.subtle）。テストでは回数を減らして速くする（形は同じ）。 */

import assert from 'node:assert/strict';
import {
  makePassphrase, normalizePassphrase, encryptMove, decryptMove, readMoveHead, buildPayload,
  boxToState, stateToBox, mergeBox, moveSummary, moveFileName, ITER, PASS_LEN,
} from '../js/movefile.js';

const FAST = 100000;
let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok -', name); }

const todo = (id, text, at) => ({ id, text, createdAt: at });
const stateOf = (todos, at) => ({
  doc: { todos, logs: [], todayLogs: [], focusLogs: [], notes: [], order: todos.map(t => t.id) },
  stamps: Object.fromEntries(todos.map(t => ['todo:' + t.id, [at, 1]])),
});

await test('合言葉は 24 字・4 字ずつ・読み違えやすい字を使わない', () => {
  const p = makePassphrase();
  assert.match(p, /^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizePassphrase(p).length, PASS_LEN);
  assert.equal(normalizePassphrase(' abcd-efgh '), 'ABCDEFGH');
  assert.notEqual(makePassphrase(), makePassphrase());
  assert.equal(ITER, 600000, '本番の回数は 60 万回');
});

await test('包んで開くと同じ中身。小文字・区切りなしの合言葉でも開ける', async () => {
  const pass = makePassphrase();
  const payload = buildPayload({
    boxes: { me: stateOf([todo('b1', '歯医者', 1)], 10), sabcd: stateOf([todo('b2', '買い物', 2)], 20) },
    seas: [{ id: 'sabcd', name: '家', color: 'moss', at: 5, alive: 1 }],
    server: { url: 'https://bubbles.example.org', move: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF' },
    at: 123, device: 'iPhone',
  });
  const text = await encryptMove(payload, pass, FAST);
  assert.equal(readMoveHead(text).device, 'iPhone');
  const got = await decryptMove(text, pass.toLowerCase().replace(/-/g, ''));
  assert.deepEqual(got, payload);
  assert.deepEqual(moveSummary(got), { at: 123, device: 'iPhone', seas: 2, todos: 2, server: true, move: true });
});

await test('ファイルの中に、記録・鍵・住所の平文は無い', async () => {
  const payload = buildPayload({ boxes: { me: stateOf([todo('b1', '秘密の予定', 1)], 10) },
    server: { url: 'https://bubbles.example.org', move: 'QQQQ-RRRR-SSSS-TTTT-UUUU-VVVV' } });
  const text = await encryptMove(payload, makePassphrase(), FAST);
  for (const s of ['秘密の予定', 'QQQQ', 'bubbles.example.org', 'b1']) assert.equal(text.indexOf(s), -1, s);
});

await test('合言葉が違えば開けない。ファイルでないものは断る', async () => {
  const text = await encryptMove(buildPayload({ boxes: {} }), makePassphrase(), FAST);
  await assert.rejects(decryptMove(text, makePassphrase()), /合言葉が違う/);
  await assert.rejects(decryptMove('kind,id', 'x'), /引っ越しのファイルではない/);
  const o = JSON.parse(text);
  o.version = 99;
  assert.throws(() => readMoveHead(JSON.stringify(o)), /新しい版/);
  await assert.rejects(encryptMove({}, 'short'), /短い/);
});

await test('同じ合言葉でも、包むたびに塩と IV が変わる', async () => {
  const pass = makePassphrase();
  const a = JSON.parse(await encryptMove(buildPayload({ boxes: {} }), pass, FAST));
  const b = JSON.parse(await encryptMove(buildPayload({ boxes: {} }), pass, FAST));
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

await test('箱の形と行き来でき、重ねると新しいほうが残り、手元にしかないものも残る', () => {
  const box = stateToBox(stateOf([todo('b1', 'x', 1)], 10));
  assert.deepEqual(boxToState(box), stateOf([todo('b1', 'x', 1)], 10));
  assert.equal(boxToState({ todos: [] }), null, '印の無い古い箱は重ねない');
  const local = stateOf([todo('b1', '古い名前', 1), todo('b3', '手元だけ', 3)], 10);
  const file = stateOf([todo('b1', '新しい名前', 1), todo('b2', 'ファイルだけ', 2)], 20);
  const m = mergeBox(local, file);
  const texts = Object.fromEntries(m.doc.todos.map(t => [t.id, t.text]));
  assert.deepEqual(texts, { b1: '新しい名前', b2: 'ファイルだけ', b3: '手元だけ' });
  assert.deepEqual(mergeBox(null, file), file, '新しい端末はファイルのまま');
  const again = mergeBox(m, file);
  assert.equal(again.doc.todos.length, 3, '同じファイルを2回読んでも増えない');
});

await test('鍵の無いサーバーは住所だけ。合言葉の形は合言葉を入れる', () => {
  assert.deepEqual(buildPayload({ boxes: {}, server: { url: 'https://a.example' } }).server, { url: 'https://a.example' });
  assert.deepEqual(buildPayload({ boxes: {}, server: { url: 'http://localhost:8931', token: 't', shareToken: '' } }).server,
    { url: 'http://localhost:8931', token: 't' });
  assert.equal(buildPayload({ boxes: {} }).server, undefined);
  assert.match(moveFileName(new Date(2026, 10, 7, 9, 5, 3).getTime()), /^bubbles-move-20261107-090503\.json$/);
});

console.log(`\n${n} 件通った`);
