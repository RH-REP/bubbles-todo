/* ブロックチェーンへの控え（js/chain.js。Issue #31）のテスト。素の Node と assert だけで走る。

     node tests/chain.test.mjs

   暗号は Node の WebCrypto（Ed25519・AES-GCM・HKDF・PBKDF2）。窓口（RPC）は偽の fetch で置き換え、網には出ない。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  b58encode, b58decode, shortvec, walletFromSeed, keysFromRoot, rootFromPassphrase,
  makeRecoveryCode, readRecoveryCode, sealToMemos, parseMemo, openMemos, pickLatest,
  memoMessage, memoTransaction, readLatestMemos, writeMemos, rpc, MEMO_PROGRAM, CHUNK, NETWORKS, toB64, fromB64,
  requestAirdrop, AIRDROP_LAMPORTS, FAUCET_URL, COMPUTE_BUDGET_PROGRAM, COMPUTE_UNITS, memoFromMessage,
  isAddress, transferMessage, planSweep, SYSTEM_PROGRAM, passkeyLabel,
  MOVE_KEY, loadMove, saveMove, clearMove, moveStep, moveSteps, inNativeApp,
} from '../js/chain.js';
import { PROVIDERS } from '../js/ai.js';

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok -', name); }
const hex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

await test('base58: 行き来・先頭のゼロ・Memo の ID は 32 バイト', () => {
  assert.equal(b58encode(new Uint8Array(32)), '1'.repeat(32));
  assert.equal(b58encode(Uint8Array.of(0, 0, 1)), '112');
  assert.equal(b58decode(MEMO_PROGRAM).length, 32);
  assert.equal(b58encode(b58decode(MEMO_PROGRAM)), MEMO_PROGRAM);
  assert.equal(b58encode(new TextEncoder().encode('hello world')), 'StV1DL6CwTryKyV');
  for (let k = 0; k < 50; k++) {
    const b = new Uint8Array(k % 40);
    globalThis.crypto.getRandomValues(b);
    if (k % 3 === 0 && b.length) b[0] = 0;
    assert.deepEqual(b58decode(b58encode(b)), b);
  }
  assert.throws(() => b58decode('0OIl'), /base58/);
});

await test('shortvec（compact-u16）', () => {
  assert.deepEqual(Array.from(shortvec(0)), [0]);
  assert.deepEqual(Array.from(shortvec(127)), [0x7f]);
  assert.deepEqual(Array.from(shortvec(128)), [0x80, 0x01]);
  assert.deepEqual(Array.from(shortvec(1000)), [0xe8, 0x07]);
});

await test('Ed25519: RFC 8032 の例 1 と同じ公開鍵・署名', async () => {
  const w = await walletFromSeed(hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'));
  assert.equal(toHex(w.publicKey), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const sig = await w.sign(new Uint8Array(0));
  assert.equal(toHex(sig), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
});

await test('同じ元からは同じ鍵・住所。合言葉からも同じ', async () => {
  const root = new Uint8Array(32).fill(7);
  const a = await keysFromRoot(root), b = await keysFromRoot(root);
  assert.equal(a.wallet.address, b.wallet.address);
  assert.deepEqual(a.recordKey, b.recordKey);
  assert.notDeepEqual(a.recordKey, a.wallet.publicKey);
  const r1 = await rootFromPassphrase('abcd-efgh-jkmn-pqrs', 1000);
  const r2 = await rootFromPassphrase('ABCDEFGHJKMNPQRS', 1000);
  assert.deepEqual(r1, r2);
  await assert.rejects(rootFromPassphrase('short', 1000), /短い/);
});

await test('復元コード: 行き来・打ち間違いを見つける・お財布の種は入らない', async () => {
  const { recordKey, wallet } = await keysFromRoot(new Uint8Array(32).fill(3));
  const code = await makeRecoveryCode(recordKey, wallet.publicKey, 'mainnet');
  assert.match(code, /^BT1-/);
  const r = await readRecoveryCode(' ' + code + ' ');
  assert.equal(r.network, 'mainnet');
  assert.equal(r.address, wallet.address);
  assert.deepEqual(r.recordKey, recordKey);
  const bad = code.slice(0, 12) + (code[12] === 'A' ? 'B' : 'A') + code.slice(13);
  await assert.rejects(readRecoveryCode(bad), /復元コード/);
});

await test('暗号化して切れ端に分け、戻す。順が乱れても・ほかの控えが混じっても', async () => {
  const { recordKey } = await keysFromRoot(new Uint8Array(32).fill(9));
  const payload = { format: 'bubbles-move', version: 1, at: 1, boxes: { me: { doc: { todos: [] }, stamps: {} } },
    pad: Array.from({ length: 400 }, (_, i) => 'x' + i + Math.random()) };
  const memos = await sealToMemos(payload, recordKey, 'a1b2c3d4');
  assert.ok(memos.length >= 2, '切れ端が複数になる大きさで試す');
  memos.forEach(m => assert.ok(m.length <= CHUNK + 30));
  const parts = memos.map(parseMemo).reverse();
  assert.deepEqual(await openMemos(parts, recordKey), payload);
  const other = await sealToMemos({ x: 1 }, recordKey, 'ffffffff');
  const latest = pickLatest(['[12] ' + other[0]].concat(memos.slice().reverse()));
  assert.equal(latest[0].id, 'ffffffff', 'いちばん新しく全部そろったもの');
  /* 違うカギでは開かない */
  const { recordKey: k2 } = await keysFromRoot(new Uint8Array(32).fill(8));
  await assert.rejects(openMemos(parts, k2), /開けない/);
  /* 欠けていれば戻さない */
  await assert.rejects(openMemos(parts.slice(1), recordKey), /欠けている/);
  /* ほかの控えの切れ端に ID を付け替えても開かない（AAD） */
  const swapped = parts.map(p => Object.assign({}, p, { id: 'deadbeef' }));
  await assert.rejects(openMemos(swapped, recordKey), /開けない/);
});

await test('取引の形: 1232 バイトの内・署名がメッセージに合う', async () => {
  const { wallet } = await keysFromRoot(new Uint8Array(32).fill(1));
  const memo = 'bt1 a1b2c3d4 1/1 ' + 'A'.repeat(CHUNK);
  const bh = new Uint8Array(32).fill(2);
  const { tx, signature } = await memoTransaction(wallet, bh, memo);
  assert.ok(tx.length <= 1232, tx.length + ' バイト');
  const msg = memoMessage(wallet.publicKey, bh, memo);
  assert.deepEqual(tx.subarray(65), msg);
  assert.equal(tx[0], 1);
  assert.deepEqual(Array.from(msg.subarray(0, 4)), [1, 0, 2, 3]);
  /* 2 番目の口座は ComputeBudget、命令の 1 つ目は SetComputeUnitLimit（判別子 2・u32 LE） */
  assert.equal(b58encode(msg.subarray(4 + 32, 4 + 64)), COMPUTE_BUDGET_PROGRAM);
  assert.equal(b58decode(COMPUTE_BUDGET_PROGRAM).length, 32);
  const ins0 = 4 + 96 + 32 + 1;
  assert.deepEqual(Array.from(msg.subarray(ins0, ins0 + 3)), [1, 0, 5]);
  const units = msg[ins0 + 4] | (msg[ins0 + 5] << 8) | (msg[ins0 + 6] << 16) | (msg[ins0 + 7] << 24);
  assert.equal(msg[ins0 + 3], 2);
  assert.equal(units, COMPUTE_UNITS);
  assert.ok(COMPUTE_UNITS <= 1400000, '取引 1 件の上限（140 万）を超えない');
  assert.equal(memoFromMessage(msg), memo);
  const pub = await crypto.subtle.importKey('raw', wallet.publicKey, { name: 'Ed25519' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pub, tx.subarray(1, 65), msg));
  assert.equal(b58decode(signature).length, 64);
});

/* 偽の窓口。書いた取引を覚え、住所の履歴として新しい順に返す */
function fakeChain() {
  const sent = [];
  let busy = 1;   /* 最初の 1 回は混んでいる（429）ことにして、やり直しを試す */
  const fetchFn = async (url, init) => {
    assert.ok(Object.values(NETWORKS).some(x => x.rpc === url), '公式の窓口だけに送る');
    if (busy-- > 0) return { status: 429, ok: false, json: async () => ({}) };
    const { method, params } = JSON.parse(init.body);
    const ok = result => ({ status: 200, ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
    if (method === 'getLatestBlockhash') return ok({ value: { blockhash: b58encode(new Uint8Array(32).fill(5)) } });
    if (method === 'sendTransaction') {
      const tx = fromB64(params[0]);
      const memo = memoFromMessage(tx.subarray(65));
      const sig = b58encode(tx.subarray(1, 65));
      sent.push({ sig, memo });
      return ok(sig);
    }
    if (method === 'getSignatureStatuses') return ok({ value: params[0].map(() => ({ confirmationStatus: 'confirmed', err: null })) });
    if (method === 'getSignaturesForAddress') {
      return ok(sent.slice().reverse().map(x => ({ signature: x.sig, err: null, memo: '[' + x.memo.length + '] ' + x.memo })));
    }
    throw new Error('知らない呼び出し ' + method);
  };
  return { fetchFn, sent };
}

await test('偽の窓口で、書いて読む（混んでいたらやり直す）', async () => {
  const { recordKey, wallet } = await keysFromRoot(new Uint8Array(32).fill(4));
  const chain = fakeChain();
  const opt = { fetchFn: chain.fetchFn, wait: 1 };
  const payload = { format: 'bubbles-move', version: 1, at: 2, note: 'y'.repeat(3000) + Math.random() };
  const memos = await sealToMemos(payload, recordKey);
  const sigs = await writeMemos('devnet', wallet, memos, { gap: 0, opt });
  assert.equal(sigs.length, memos.length);
  assert.deepEqual(chain.sent.map(x => x.memo), memos);
  const parts = await readLatestMemos('devnet', wallet.address, { opt });
  assert.deepEqual(await openMemos(parts, recordKey), payload);
});

await test('窓口の失敗は分かる言葉にする', async () => {
  const fetchFn = async () => ({ status: 200, ok: true, json: async () => ({ error: { message: 'bad' } }) });
  await assert.rejects(rpc('devnet', 'getBalance', [], { fetchFn, wait: 1 }), /断った/);
  const sim = async () => ({ status: 200, ok: true, json: async () => ({ error: { message:
    'Transaction simulation failed: Error processing Instruction 0: Program failed to complete' } }) });
  await assert.rejects(rpc('devnet', 'sendTransaction', [], { fetchFn: sim, wait: 1 }), /手数料は掛かっていない/);
  await assert.rejects(rpc('nope', 'getBalance', [], { fetchFn }), /ネット/);
});

await test('テスト用の SOL: 窓口が配っていない（410）ときは分かる言葉にし、頼む額は 0.1 SOL', async () => {
  let asked = null;
  const gone = async (url, init) => { asked = JSON.parse(init.body).params[1]; return { status: 410, ok: false, json: async () => ({}) }; };
  await assert.rejects(requestAirdrop('devnet', '1'.repeat(32), { fetchFn: gone, wait: 1 }), /配っていない（410）/);
  assert.equal(asked, AIRDROP_LAMPORTS);
  assert.equal(AIRDROP_LAMPORTS, 1e8);
  await assert.rejects(requestAirdrop('mainnet', '1'.repeat(32), { fetchFn: gone }), /テスト用のネット/);
  assert.match(FAUCET_URL, /^https:\/\/faucet\.solana\.com\//);
});

await test('残高を移す: 住所の形・取引の形・見積もり', async () => {
  const { wallet } = await keysFromRoot(new Uint8Array(32).fill(6));
  const { wallet: other } = await keysFromRoot(new Uint8Array(32).fill(7));
  assert.ok(isAddress(other.address));
  assert.ok(!isAddress('abc'));
  assert.ok(!isAddress('0'.repeat(44)));
  assert.equal(b58decode(SYSTEM_PROGRAM).length, 32);
  const bh = new Uint8Array(32).fill(2);
  const msg = transferMessage(wallet.publicKey, other.publicKey, bh, 123456789);
  assert.deepEqual(Array.from(msg.subarray(0, 4)), [1, 0, 1, 3]);
  const ins = 4 + 96 + 32;
  assert.deepEqual(Array.from(msg.subarray(ins, ins + 6)), [1, 2, 2, 0, 1, 12]);
  const dv = new DataView(msg.buffer, msg.byteOffset + ins + 6, 12);
  assert.equal(dv.getUint32(0, true), 2);
  assert.equal(Number(dv.getBigUint64(4, true)), 123456789);
  assert.equal(msg.length, ins + 6 + 12);
  /* 見積もり（偽の窓口） */
  const bal = { [wallet.address]: 1000000, [other.address]: 0 };
  const fetchFn = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    const result = method === 'getBalance' ? { value: bal[params[0]] } : 890880;
    return { status: 200, ok: true, json: async () => ({ result }) };
  };
  const plan = await planSweep('devnet', wallet.address, ' ' + other.address + ' ', { fetchFn });
  assert.equal(plan.amount, 1000000 - 5000);
  bal[wallet.address] = 600000;   /* 空の住所へ最低の額より少なくは送れない */
  await assert.rejects(planSweep('devnet', wallet.address, other.address, { fetchFn }), /最低の額/);
  bal[other.address] = 1;          /* 空でなければ少なくても送れる */
  assert.equal((await planSweep('devnet', wallet.address, other.address, { fetchFn })).amount, 595000);
  await assert.rejects(planSweep('devnet', wallet.address, wallet.address, { fetchFn }), /同じ/);
  await assert.rejects(planSweep('devnet', wallet.address, 'nope', { fetchFn }), /形が違う/);
});

await test('パスキーの名前に作った日時を入れる（複数あっても見分けられる）', () => {
  const l = passkeyLabel(new Date(2026, 10, 9, 8, 5));
  assert.equal(l.displayName, 'Bubbles の控え（2026-11-09 08:05 作成）');
  assert.equal(l.name, 'bubbles-backup-202611090805');
});

await test('鍵の移し替え（Issue #39）: 段の進み・秘密を置かない・やめたら消える', () => {
  const mem = new Map();
  const st = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  assert.equal(loadMove(st), null);
  assert.equal(moveStep(null), null);
  const m = { network: 'devnet', from: { mode: 'passkey', credId: 'c1', address: 'A1' }, startedAt: 1 };
  saveMove(m, st);
  assert.ok(MOVE_KEY.startsWith('bubble_todo_'), '初期化で一緒に消える名前');
  let got = loadMove(st);
  assert.equal(moveStep(got), 'key');
  assert.deepEqual(moveSteps(got).map(s => s.state), ['next', 'todo', 'todo']);
  /* パスキーは作れたが鍵がまだ出ていない → まだ 1 */
  got.to = { mode: 'passkey', credId: 'c2', address: null };
  saveMove(got, st);
  assert.equal(moveStep(loadMove(st)), 'key');
  /* 合言葉・元・鍵などの余計な欄は置かない */
  got.to = { mode: 'pass', address: 'B1', pass: 'SECRET', root: [1, 2] };
  got.seed = 'SECRET';
  saveMove(got, st);
  assert.ok(!mem.get(MOVE_KEY).includes('SECRET'));
  assert.ok(!mem.get(MOVE_KEY).includes('root'));
  got = loadMove(st);
  assert.equal(moveStep(got), 'send');
  assert.match(moveSteps(got)[0].detail, /合言葉・アドレス B1/);
  got.sent = { amount: 1500000000, tx: 'T', at: 2 };
  saveMove(got, st);
  got = loadMove(st);
  assert.equal(moveStep(got), 'backup');
  const steps = moveSteps(got, () => 'いつか');
  assert.deepEqual(steps.map(s => s.state), ['done', 'done', 'next']);
  assert.equal(steps[1].detail, '1.5 SOL を送った（いつか）');
  got.sent = { skipped: true };
  assert.equal(moveSteps(got)[1].detail, '送らずに進めた');
  got.backup = { id: 'X', count: 3, at: 3 };
  assert.equal(moveStep(got), 'done');
  assert.deepEqual(moveSteps(got).map(s => s.state), ['done', 'done', 'done']);
  clearMove(st);
  assert.equal(loadMove(st), null);
  mem.set(MOVE_KEY, '{壊れた');
  assert.equal(loadMove(st), null);
});

await test('solo.html は index.html と CSP・印・manifest・title だけが違い、送り先は決め打ち', () => {
  const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const solo = readFileSync(new URL('../solo.html', import.meta.url), 'utf8');
  const strip = s => s
    .replace(/<!-- サーバーなし版[\s\S]*?-->\n/, '')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '')
    .replace(/<meta name="bubbles-edition"[^>]*>\n/, '')
    .replace(/manifest-solo\.json/, 'manifest.json')
    .replace(/<title>[^<]*<\/title>/, '<title></title>');
  assert.equal(strip(solo), strip(idx));
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(solo)[1];
  const connect = /connect-src ([^;]+)/.exec(csp)[1].trim().split(/\s+/);
  assert.deepEqual(connect.sort(), ["'self'", 'https://api.anthropic.com', 'https://api.openai.com',
    'https://generativelanguage.googleapis.com', 'https://api.devnet.solana.com',
    'https://api.mainnet-beta.solana.com', 'https://api.open-meteo.com'].sort());
  /* AI の会社の窓口（js/ai.js の PROVIDERS。Issue #46）が全部 CSP にある */
  Object.values(PROVIDERS).forEach(p => assert.ok(connect.includes(p.origin), p.origin + ' が solo.html の CSP に無い'));
  assert.match(csp, /script-src 'self';/);
  /* index.html にも <meta> の CSP。送り先は開けたまま（同期の住所）、スクリプトは自分のものだけ（Issue #14 の見直し） */
  const idxCsp = (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(idx) || [])[1] || '';
  assert.match(idxCsp, /script-src 'self';/, 'index.html に script-src \'self\' の CSP が無い');
  assert.match(idxCsp, /object-src 'none';/);
  assert.match(idxCsp, /base-uri 'self';/);
  Object.values(NETWORKS).forEach(x => assert.ok(connect.includes(x.rpc), x.rpc + ' が CSP に無い'));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ["'./js/chain.js'", "'./solo.html'", "'./manifest-solo.json'"].forEach(a => assert.ok(sw.includes(a), 'sw.js の ASSETS に ' + a + ' が無い'));
});

await test('サーバーが配るページ（server.py の CSP）でも Solana の公式 RPC だけを足して使える（Issue #42 の A 案）', () => {
  const py = readFileSync(new URL('../server.py', import.meta.url), 'utf8');
  const m = /^CSP = \(([\s\S]*?)\)\n/m.exec(py);
  assert.ok(m, 'server.py に CSP が無い');
  const csp = m[1].split('\n').map(l => (/"([^"]*)"/.exec(l) || [])[1] || '').join('');
  const connect = /connect-src ([^;]+)/.exec(csp)[1].trim().split(/\s+/);
  assert.deepEqual(connect.sort(), ["'self'", 'https://api.anthropic.com', 'https://api.openai.com',
    'https://generativelanguage.googleapis.com', 'https://api.devnet.solana.com',
    'https://api.mainnet-beta.solana.com', 'https://api.open-meteo.com'].sort());
  Object.values(NETWORKS).forEach(x => assert.ok(connect.includes(x.rpc), x.rpc + ' が server.py の CSP に無い'));
  Object.values(PROVIDERS).forEach(p => assert.ok(connect.includes(p.origin), p.origin + ' が server.py の CSP に無い'));
});

await test('Android の app（Capacitor）ではパスキーを使わない・入口を1つにする script を両方の head で読む（Issue #38）', () => {
  assert.equal(inNativeApp(null), false);
  assert.equal(inNativeApp({}), false);
  assert.equal(inNativeApp({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(inNativeApp({ Capacitor: { isNativePlatform: () => false } }), false);
  assert.equal(inNativeApp({ Capacitor: {} }), true);
  const tag = '<script src="js/boot-edition.js"></script>';
  ['../index.html', '../solo.html'].forEach(f => {
    const html = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(html.includes(tag), f + ' に ' + tag + ' が無い');
    /* 移す前に画面の部品を読まないよう、ほかの script より前に置く */
    assert.ok(html.indexOf(tag) < html.indexOf('<script src="js/boot-dvh.js">'), f + ' で boot-edition.js が後ろにある');
  });
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/boot-edition.js'"), 'sw.js の ASSETS に boot-edition.js が無い');
  /* 置く印の名前は、読む側（boot-edition.js）と書く側（settings.js）・sync.js でそろえる */
  const boot = readFileSync(new URL('../js/boot-edition.js', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../js/screens/settings.js', import.meta.url), 'utf8');
  const syncSrc = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
  assert.ok(boot.includes("'bubble_todo_edition_stay'") && settings.includes("'bubble_todo_edition_stay'"));
  assert.ok(boot.includes("'bubble_todo_sync'") && syncSrc.includes("CONF_KEY = 'bubble_todo_sync'"));
});

void toB64;
console.log(`\n${n} 件 ok`);
