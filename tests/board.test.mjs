/* 共有の海（js/board.js。Issue #37）のテスト。素の Node と assert だけで走る。

     node tests/board.test.mjs

   暗号は Node の WebCrypto（X25519・Ed25519・AES-GCM・HKDF）。窓口（RPC）は偽の fetch で置き換え、網には出ない。
   偽の窓口は、取引に載った口座（払う人と、載せるだけの口座）ごとに履歴を持つ（本物の getSignaturesForAddress と同じ見え方）。 */

import assert from 'node:assert/strict';
import {
  keysFromRoot, b58encode, b58decode, fromB64, NETWORKS, BOARD_TAG, TAG, memoMessage, memoFromMessage,
  memoTransaction, sealToMemos, openMemos, parseMemo, readLatestMemos, writeMemos, COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM,
} from '../js/chain.js';
import {
  makeShareAddress, readShareAddress, newSeaKey, boardOf, wrapSeaKey, unwrapSeaKey, sealEnvelope, parseEnvelope,
  openEnvelope, findInvites, writeEnvelope, postMemos, writePost, readBoard, collectPosts, signedPost, verifyPost,
  acceptedSnaps, rosterOf, cleanMembers, loadShared, saveShared, sharedFor, STORE_KEY, ENV_TAG,
  chatBoardOf, chatMessages, readChat, MSG_MAX, SELF_SEA, GIFT_LAMPORTS, giftPlan,
} from '../js/board.js';

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok -', name); }
const keysOf = k => keysFromRoot(new Uint8Array(32).fill(k));

/* 偽の窓口。取引の口座の並び（署名の数 1・載せた口座）から、どのアドレスの履歴に出すかを決める */
function fakeChain() {
  const sent = [];
  const fetchFn = async (url, init) => {
    assert.ok(Object.values(NETWORKS).some(x => x.rpc === url), '公式の窓口だけに送る');
    const { method, params } = JSON.parse(init.body);
    const ok = result => ({ status: 200, ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
    if (method === 'getLatestBlockhash') return ok({ value: { blockhash: b58encode(new Uint8Array(32).fill(5)) } });
    if (method === 'sendTransaction') {
      const tx = fromB64(params[0]);
      assert.ok(tx.length <= 1232, '取引は 1232 バイトの内（' + tx.length + '）');
      const msg = tx.subarray(65);
      const nKeys = msg[3];
      const keys = [];
      for (let i = 0; i < nKeys; i++) keys.push(b58encode(msg.subarray(4 + 32 * i, 4 + 32 * (i + 1))));
      assert.equal(new Set(keys).size, keys.length, '同じ口座を 2 度並べない');
      const sig = b58encode(tx.subarray(1, 65));
      sent.push({ sig, memo: memoFromMessage(msg), keys });
      return ok(sig);
    }
    if (method === 'getSignatureStatuses') return ok({ value: params[0].map(() => ({ confirmationStatus: 'confirmed', err: null })) });
    if (method === 'getSignaturesForAddress') {
      return ok(sent.filter(x => x.keys.includes(params[0])).reverse()
        .map(x => ({ signature: x.sig, err: null, memo: '[' + x.memo.length + '] ' + x.memo })));
    }
    if (method === 'getTransaction') return ok(null);
    throw new Error('知らない呼び出し ' + method);
  };
  return { fetchFn, sent, opt: { fetchFn, wait: 1 } };
}

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

await test('載せるだけの口座: 署名しない・読むだけに数え、命令の番号がずれる', async () => {
  const { wallet } = await keysOf(1);
  const { wallet: other } = await keysOf(2);
  const bh = new Uint8Array(32).fill(2);
  const memo = BOARD_TAG + ' a1b2c3d4 1/1 ' + 'A'.repeat(500);
  const msg = memoMessage(wallet.publicKey, bh, memo, undefined, [other.address]);
  assert.deepEqual(Array.from(msg.subarray(0, 4)), [1, 0, 3, 4]);
  assert.equal(b58encode(msg.subarray(4 + 32, 4 + 64)), other.address);
  assert.equal(b58encode(msg.subarray(4 + 64, 4 + 96)), COMPUTE_BUDGET_PROGRAM);
  assert.equal(b58encode(msg.subarray(4 + 96, 4 + 128)), MEMO_PROGRAM);
  assert.equal(memoFromMessage(msg), memo);
  const { tx } = await memoTransaction(wallet, bh, memo, [other.address]);
  assert.ok(tx.length <= 1232, tx.length + ' バイト');
  /* 渡さなければ前と同じ形 */
  assert.deepEqual(Array.from(memoMessage(wallet.publicKey, bh, 'x').subarray(0, 4)), [1, 0, 2, 3]);
});

await test('bt1 と bt2 は互いの切れ端として開かない', async () => {
  const { recordKey } = await keysOf(3);
  const m1 = await sealToMemos({ a: 1 }, recordKey, 'a1b2c3d4');
  const m2 = await sealToMemos({ a: 1 }, recordKey, 'a1b2c3d4', BOARD_TAG);
  assert.ok(m2[0].startsWith('bt2 '));
  assert.equal(parseMemo(m2[0]), null);
  assert.equal(parseMemo(m1[0], BOARD_TAG), null);
  const p2 = m2.map(t => parseMemo(t, BOARD_TAG));
  assert.deepEqual(await openMemos(p2, recordKey, BOARD_TAG), { a: 1 });
  await assert.rejects(openMemos(p2, recordKey, TAG), /開けない/);
  assert.equal(parseMemo('bt2e AAAA', BOARD_TAG), null);
});

await test('共有用のアドレス: 同じ元から同じもの・行き来・写し間違いを見つける', async () => {
  const k = await keysOf(4);
  const a = await makeShareAddress(k, 'devnet');
  assert.equal(a, await makeShareAddress(await keysOf(4), 'devnet'));
  assert.notEqual(a, await makeShareAddress(await keysOf(5), 'devnet'));
  assert.match(a, /^BTA1-/);
  const r = await readShareAddress(a);
  assert.equal(r.network, 'devnet');
  assert.equal(r.wallet, k.wallet.address);
  assert.equal(r.text, a);
  assert.equal(r.x.length, 32);
  assert.equal((await readShareAddress(' ' + a.replace(/-/g, ' - ') + ' ')).wallet, k.wallet.address);
  const bad = a.slice(0, -2) + (a.slice(-2) === 'zz' ? 'yy' : 'zz');
  await assert.rejects(readShareAddress(bad), /違う/);
  assert.equal((await readShareAddress(await makeShareAddress(k, 'mainnet'))).network, 'mainnet');
});

await test('海の鍵: 掲示板は鍵ごとに別・包んだ鍵は自分のカギでだけ開く', async () => {
  const k = await keysOf(6);
  const s1 = newSeaKey(), s2 = newSeaKey();
  const b1 = await boardOf(s1), b1b = await boardOf(s1), b2 = await boardOf(s2);
  assert.equal(b1.address, b1b.address);
  assert.notEqual(b1.address, b2.address);
  assert.equal(b58decode(b1.address).length, 32);
  const w = await wrapSeaKey(s1, k.recordKey, 'sabc1', 1, k.wallet.address);
  const rec = { id: 'sabc1', gen: 1, me: k.wallet.address, wrapped: w };
  assert.deepEqual(await unwrapSeaKey(rec, k.recordKey), s1);
  await assert.rejects(unwrapSeaKey(rec, (await keysOf(7)).recordKey), /開けない/);
  await assert.rejects(unwrapSeaKey(Object.assign({}, rec, { gen: 2 }), k.recordKey), /開けない/);
});

await test('封筒: 宛先だけが開け、持ち主の署名を確かめる', async () => {
  const owner = await keysOf(10), bob = await keysOf(11), eve = await keysOf(12);
  const to = await readShareAddress(await makeShareAddress(bob, 'devnet'));
  const seaKey = newSeaKey();
  const sea = { id: 'sabc1', name: '<b>旅</b>', color: 'moss', at: 5 };
  const text = await sealEnvelope({ network: 'devnet', sea, key: seaKey, gen: 1, owner: owner.wallet }, to);
  assert.ok(text.startsWith(ENV_TAG + ' '));
  assert.ok(new TextEncoder().encode(text).length < 900, '取引 1 件に収まる');
  const b = parseEnvelope('[10] ' + text);
  const got = await openEnvelope(b, bob);
  assert.equal(got.sea.id, 'sabc1');
  assert.equal(got.sea.name, '<b>旅</b>');
  assert.deepEqual(got.key, seaKey);
  assert.equal(got.gen, 1);
  assert.equal(got.owner, owner.wallet.address);
  assert.equal(await openEnvelope(b, eve), null, 'ほかの人には開けない');
  /* 持ち主の名をかたる: eve が自分の鍵で署名し、owner の住所を名乗る */
  const fake = await sealEnvelope({ network: 'devnet', sea, key: seaKey, gen: 1,
    owner: { address: owner.wallet.address, sign: eve.wallet.sign } }, to);
  assert.equal(await openEnvelope(parseEnvelope(fake), bob), null, '署名が合わない封筒は捨てる');
  assert.equal(parseEnvelope('bt1 a1b2c3d4 1/1 AAAA'), null);
});

await test('書き込みの署名: 中身を変えると通らない', async () => {
  const k = await keysOf(13);
  const post = await signedPost(k.wallet, { kind: 'snap', sea: 's1x', g: 1, at: 1 });
  const inner = await verifyPost(post);
  assert.equal(inner.by, k.wallet.address);
  const forged = Object.assign({}, post, { p: post.p.replace('"g":1', '"g":2') });
  assert.equal(await verifyPost(forged), null);
  const other = await keysOf(14);
  const claim = Object.assign({}, post, { p: post.p.replace(k.wallet.address, other.wallet.address) });
  assert.equal(await verifyPost(claim), null);
});

await test('名簿と写しのふるい分け: 名簿の人の、同じ海・同じ代の、人ごとに新しいもの', () => {
  const box = { doc: { todos: [] }, stamps: {} };
  const posts = [
    { kind: 'snap', sea: 's1x', g: 2, by: 'A', at: 9, box },
    { kind: 'snap', sea: 's1x', g: 2, by: 'B', at: 8, box },
    { kind: 'snap', sea: 's1x', g: 2, by: 'A', at: 7, box },
    { kind: 'snap', sea: 's1x', g: 2, by: 'X', at: 6, box },          /* 名簿に無い */
    { kind: 'snap', sea: 's2y', g: 2, by: 'B', at: 5, box },          /* ほかの海 */
    { kind: 'snap', sea: 's1x', g: 1, by: 'B', at: 4, box },          /* 前の代 */
    { kind: 'roster', sea: 's1x', g: 2, by: 'X', at: 3, members: [{ a: 'X' }] },   /* 持ち主でない名簿 */
    { kind: 'roster', sea: 's1x', g: 2, by: 'A', at: 2, members: [{ a: 'A' }, { a: 'B', n: 'b' }, { a: 'B' }] },
  ];
  const members = rosterOf(posts, { owner: 'A', sea: 's1x', gen: 2 });
  assert.deepEqual(members.map(m => m.a), ['A', 'B']);
  const snaps = acceptedSnaps(posts, { owner: 'A', members, sea: 's1x', gen: 2 });
  assert.deepEqual(snaps.map(s => s.by + s.at), ['A9', 'B8']);
  assert.deepEqual(cleanMembers([{ a: 'Q', n: 'x'.repeat(50) }, null, { a: 1 }])[0].n.length, 24);
});

await test('偽の窓口で: 共有を始める → 招く → 受け取る → 両方が書き → 重ねて読む → 外す', async () => {
  const chain = fakeChain();
  const { opt } = chain;
  const ann = await keysOf(20), bob = await keysOf(21), cat = await keysOf(22);
  const net = 'devnet';
  const sea = { id: 'sabc1', name: '旅', color: 'moss', at: 5 };
  /* 持ち主（ann）が始める: 自分宛ての封筒と名簿 */
  const annShare = await makeShareAddress(ann, net);
  const seaKey = newSeaKey();
  const board = await boardOf(seaKey);
  const rec = { id: sea.id, net, gen: 1, owner: ann.wallet.address, me: ann.wallet.address,
    members: [{ a: ann.wallet.address, x: annShare, n: '' }] };
  await writeEnvelope(net, ann.wallet, await sealEnvelope({ network: net, sea, key: seaKey, gen: 1, owner: ann.wallet },
    await readShareAddress(annShare)), ann.wallet.address, opt);
  /* bob と cat を招く */
  for (const k of [bob, cat]) {
    const to = await readShareAddress(await makeShareAddress(k, net));
    await writeEnvelope(net, ann.wallet, await sealEnvelope({ network: net, sea, key: seaKey, gen: 1, owner: ann.wallet }, to), to.wallet, opt);
    rec.members.push({ a: to.wallet, x: to.text, n: '' });
  }
  await writePost(net, ann.wallet, await postMemos(ann.wallet, { kind: 'roster', sea: sea.id, g: 1, at: 1, members: rec.members }, board), board, { opt });
  /* bob が受け取る（ann の自分のバックアップには混ざらない） */
  const inv = await findInvites(net, bob, { opt });
  assert.equal(inv.length, 1);
  assert.deepEqual(inv[0].key, seaKey);
  assert.equal((await findInvites(net, ann, { opt }))[0].owner, ann.wallet.address, '自分宛ての封筒（ほかの端末用）');
  /* ann と bob が書く。名簿に無い dan も鍵を手に入れて書く */
  const box = who => ({ doc: { todos: [{ id: who, text: who }] }, stamps: { ['todo:' + who]: [1, 1] } });
  await writePost(net, ann.wallet, await postMemos(ann.wallet, { kind: 'snap', sea: sea.id, g: 1, at: 2, box: box('a') }, board), board, { opt });
  await writePost(net, bob.wallet, await postMemos(bob.wallet, { kind: 'snap', sea: sea.id, g: 1, at: 3, box: box('b') }, board), board, { opt });
  const dan = await keysOf(23);
  await writePost(net, dan.wallet, await postMemos(dan.wallet, { kind: 'snap', sea: sea.id, g: 1, at: 4, box: box('d') }, board), board, { opt });
  /* 読む: 名簿は ann・bob・cat。dan の書き込みは出ない */
  const got = await readBoard(net, Object.assign({}, rec, { members: [] }), seaKey, { opt });
  assert.deepEqual(got.members.map(m => m.a), [ann.wallet.address, bob.wallet.address, cat.wallet.address]);
  assert.deepEqual(got.snaps.map(s => s.box.doc.todos[0].id).sort(), ['a', 'b']);
  /* 掲示板に書いても、ann の自分のバックアップ（bt1）の読み出しは変わらない */
  const own = await sealToMemos({ me: 1 }, ann.recordKey);
  await writeMemos(net, ann.wallet, own, { gap: 0, opt });
  await writePost(net, ann.wallet, await postMemos(ann.wallet, { kind: 'snap', sea: sea.id, g: 1, at: 9, box: box('a') }, board), board, { opt });
  assert.deepEqual(await openMemos(await readLatestMemos(net, ann.wallet.address, { opt }), ann.recordKey), { me: 1 });
  /* cat を外す: 新しい鍵（代 2）を ann と bob にだけ送る */
  const seaKey2 = newSeaKey();
  for (const m of rec.members.filter(m => m.a !== cat.wallet.address)) {
    const to = await readShareAddress(m.x);
    await writeEnvelope(net, ann.wallet, await sealEnvelope({ network: net, sea, key: seaKey2, gen: 2, owner: ann.wallet }, to), to.wallet, opt);
  }
  const bobInv = await findInvites(net, bob, { opt });
  assert.equal(bobInv[0].gen, 2);
  assert.deepEqual(bobInv[0].key, seaKey2);
  const catInv = await findInvites(net, cat, { opt });
  assert.equal(catInv[0].gen, 1, '外した人には新しい鍵が届かない');
  /* 新しい掲示板は、前の鍵では開けない */
  const board2 = await boardOf(seaKey2);
  await writePost(net, ann.wallet, await postMemos(ann.wallet, { kind: 'snap', sea: sea.id, g: 2, at: 10, box: box('a') }, board2), board2, { opt });
  const texts = chain.sent.filter(x => x.keys.includes(board2.address)).map(x => x.memo);
  assert.equal((await collectPosts(texts, board.recordKey)).length, 0);
  assert.equal((await collectPosts(texts, board2.recordKey)).length, 1);
});

await test('この端末に置く一覧: 秘密は包んだ鍵だけ・ウォレットとネットで分ける', () => {
  const st = memStorage();
  assert.deepEqual(loadShared(st), {});
  saveShared({ s1x: { id: 's1x', me: 'A', net: 'devnet', wrapped: 'W' }, s2y: { id: 's2y', me: 'B', net: 'devnet' } }, st);
  assert.deepEqual(sharedFor(loadShared(st), 'A', 'devnet').map(r => r.id), ['s1x']);
  assert.deepEqual(sharedFor(loadShared(st), 'A', 'mainnet'), []);
  st.setItem(STORE_KEY, '{broken');
  assert.deepEqual(loadShared(st), {});
  assert.ok(STORE_KEY.startsWith('bubble_todo'), '「すべて初期化」で消える名前');
});

await test('チャット: 写しと別の掲示板・メンバーのメッセージだけ・古い順', async () => {
  const chain = fakeChain();
  const { opt } = chain;
  const ann = await keysOf(30), bob = await keysOf(31), eve = await keysOf(32);
  const seaKey = newSeaKey();
  const board = await boardOf(seaKey);
  const chatB = await chatBoardOf(seaKey);
  assert.notEqual(chatB.address, board.address, '記録の写しと別の掲示板');
  assert.equal(chatB.address, (await chatBoardOf(seaKey)).address);
  const say = async (k, text, at, extra = {}) => writePost('devnet', k.wallet,
    await postMemos(k.wallet, Object.assign({ kind: 'msg', sea: 's1x', g: 1, at, text }, extra), chatB), chatB, { opt });
  await say(bob, 'b1', 2);
  await say(ann, 'a1', 1);
  await say(eve, 'spam', 3);                       /* メンバーでない */
  await say(ann, 'old', 0, { g: 0 });              /* 前の代 */
  await say(ann, '日本語'.repeat(90), 4);           /* 長いものは切れ端が 2 つ以上になる */
  const allowed = [ann.wallet.address, bob.wallet.address];
  const msgs = await readChat('devnet', chatB, { sea: 's1x', gen: 1, allowed, opt });
  assert.deepEqual(msgs.map(m => m.text.slice(0, 3)), ['a1', 'b1', '日本語']);
  assert.equal(msgs[0].by, ann.wallet.address);
  /* 写しの掲示板には出ない */
  assert.equal(chain.sent.filter(x => x.keys.includes(board.address)).length, 0);
  /* 自分あてのメモ: 自分の記録のカギから。ほかの人のカギでは開かない */
  const mine = await chatBoardOf(ann.recordKey);
  await writePost('devnet', ann.wallet, await postMemos(ann.wallet, { kind: 'msg', sea: SELF_SEA, g: 0, at: 5, text: 'memo' }, mine), mine, { opt });
  assert.deepEqual((await readChat('devnet', mine, { sea: SELF_SEA, gen: 0, allowed: [ann.wallet.address], opt })).map(m => m.text), ['memo']);
  const other = await chatBoardOf(bob.recordKey);
  assert.notEqual(other.address, mine.address);
  assert.equal(chatMessages([{ kind: 'msg', sea: 'x', g: 1, by: 'A', at: 1, text: 'y'.repeat(MSG_MAX + 9) }],
    { sea: 'x', gen: 1, allowed: ['A'] })[0].text.length, MSG_MAX);
});

await test('手数料を送る: 100 通ぶん・空の相手には最低の額を足す・自分にも残す', () => {
  assert.equal(GIFT_LAMPORTS, 1000000);
  const empty = giftPlan({ myBalance: 5000000, destBalance: 0, rent: 890880 });
  assert.equal(empty.amount, 1000000 + 890880);
  assert.ok(empty.withRent && empty.ok);
  assert.equal(empty.need, empty.amount + 5000 + 890880);
  const funded = giftPlan({ myBalance: 1000000, destBalance: 2000000, rent: 890880 });
  assert.equal(funded.amount, 1000000);
  assert.ok(!funded.ok, '自分の手数料と最低の額が残らないなら送らない');
});

console.log(n + ' tests passed');
