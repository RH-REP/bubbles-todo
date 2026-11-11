/* 端末どうしの直の通信（js/p2p.js。Issue #37）のテスト。素の Node と assert だけで走る。

     node tests/p2p.test.mjs

   WebRTC は偽物（FakeRTC）。offer の sdp を答えた側と、answer を受け取った側を組にして、データの通り道を開ける。
   顔合わせの掲示板も偽物（配列）。網には出ない。 */

import assert from 'node:assert/strict';
import { keysFromRoot } from '../js/chain.js';
import { signedPost, MSG_MAX } from '../js/board.js';
import {
  Mesh, loadP2pPrefs, saveP2pPrefs, iceServers, STUN_URL, deviceId, loadHistory, saveHistory, mergeHistory, markState,
  signMsg, openMsg, messagesFromPosts, HIST_MAX, histKey, signSnap, openSnap, splitParts, PART_CHARS,
} from '../js/p2p.js';

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok -', name); }
const keysOf = k => keysFromRoot(new Uint8Array(32).fill(k));
function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
/* 署名の確かめは非同期なので、条件がそろうまで少し待つ（最大 2 秒） */
async function until(fn) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('待っても条件がそろわなかった');
}

/* ---- 偽の WebRTC ---- */
const offers = new Map();   /* offer の sdp → 出した側の pc */
let seq = 0;
class FakeChannel {
  constructor() { this.readyState = 'connecting'; this.other = null; this.sent = []; }
  send(s) { this.sent.push(s); if (this.other) this.other.onmessage && this.other.onmessage({ data: s }); }
  close() { this.readyState = 'closed'; }
  open() { this.readyState = 'open'; if (this.onopen) this.onopen(); }
}
class FakeRTC {
  constructor(cfg) { this.cfg = cfg; this.iceGatheringState = 'complete'; this.signalingState = 'stable'; this.connectionState = 'new'; this.ch = null; }
  createDataChannel() { this.ch = new FakeChannel(); return this.ch; }
  async createOffer() { return { type: 'offer', sdp: 'offer-' + (++seq) }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-' + (++seq) }; }
  async setLocalDescription(d) {
    this.localDescription = d;
    if (d.type === 'offer') { this.signalingState = 'have-local-offer'; offers.set(d.sdp, this); }
  }
  async setRemoteDescription(d) {
    if (d.type === 'offer') { this.remoteOffer = offers.get(d.sdp); this.signalingState = 'have-remote-offer'; return; }
    /* answer を受け取った = 組になった。answer を出した側を探して、通り道を開ける */
    const peer = answered.get(d.sdp);
    this.signalingState = 'stable';
    const mine = this.ch, theirs = new FakeChannel();
    mine.other = theirs; theirs.other = mine;
    peer.ondatachannel({ channel: theirs });
    mine.open(); theirs.open();
  }
  close() { this.connectionState = 'closed'; }
}
const answered = new Map();   /* answer の sdp → 答えた側の pc */
const origAnswer = FakeRTC.prototype.createAnswer;
FakeRTC.prototype.createAnswer = async function () { const d = await origAnswer.call(this); answered.set(d.sdp, this); return d; };

await test('設定: 初めは両方入り・STUN は Cloudflare だけ・切ると同じ Wi‑Fi だけ', () => {
  const st = memStorage();
  assert.deepEqual(loadP2pPrefs(st), { on: true, stun: true });
  saveP2pPrefs({ on: true, stun: false }, st);
  assert.deepEqual(loadP2pPrefs(st), { on: true, stun: false });
  assert.deepEqual(iceServers({ stun: true }), [{ urls: STUN_URL }]);
  assert.match(STUN_URL, /^stun:stun\.cloudflare\.com:3478$/);
  assert.deepEqual(iceServers({ stun: false }), []);
  const d = deviceId(st);
  assert.match(d, /^[0-9a-f]{16}$/);
  assert.equal(deviceId(st), d, '同じ端末では同じ印');
});

await test('メッセージの包み: 署名・名簿・海・代を確かめる', async () => {
  const a = await keysOf(40), x = await keysOf(41);
  const m = await signMsg(a.wallet, { sea: 's1x', g: 1, text: 'やあ' });
  assert.equal(m.by, a.wallet.address);
  const opt = { sea: 's1x', g: 1, allowed: [a.wallet.address] };
  assert.equal((await openMsg(m.env, opt)).text, 'やあ');
  assert.equal(await openMsg(m.env, Object.assign({}, opt, { allowed: [x.wallet.address] })), null, '名簿に無い');
  assert.equal(await openMsg(m.env, Object.assign({}, opt, { g: 2 })), null, '前の代');
  const forged = Object.assign({}, m.env, { p: m.env.p.replace('やあ', 'ばか') });
  assert.equal(await openMsg(forged, opt), null, '書き換え');
  const long = await signMsg(a.wallet, { sea: 's1x', g: 1, text: 'z'.repeat(MSG_MAX + 5) });
  assert.equal(long.text.length, MSG_MAX);
});

await test('履歴: id で重ね、届いた度合いの高いほうを残す・端末にだけ置く', async () => {
  const st = memStorage();
  const a = { id: 'a'.repeat(16), by: 'A', at: 2, text: 'x', env: {} };
  const b = { id: 'b'.repeat(16), by: 'B', at: 1, text: 'y', env: {} };
  let r = mergeHistory([], [a], 'unsent');
  assert.equal(r.added, 1);
  r = mergeHistory(r.list, [a, b], 'p2p');
  assert.equal(r.added, 1);
  assert.deepEqual(r.list.map(m => m.id[0] + m.state), ['bp2p', 'ap2p'], '古い順・未送が届いた扱いに上がる');
  r = mergeHistory(r.list, [Object.assign({}, a, { state: 'unsent' })]);
  assert.equal(r.list[1].state, 'p2p', '下がらない');
  markState(r.list, [a.id], 'chain');
  saveHistory('sea:s1x:1', r.list, st);
  assert.equal(loadHistory('sea:s1x:1', st)[1].state, 'chain');
  assert.ok(histKey('sea:s1x:1').startsWith('bubble_todo_'), '「すべて初期化」で消える名前');
  const many = Array.from({ length: HIST_MAX + 5 }, (_, i) => ({ id: String(i).padStart(16, '0'), by: 'A', at: i, text: '' }));
  assert.equal(saveHistory('r', many, st).length, HIST_MAX);
});

await test('チェーンの書き込み → メッセージ: 前の版の 1 通の形とまとめた形', async () => {
  const a = await keysOf(42), b = await keysOf(43), x = await keysOf(44);
  const allowed = [a.wallet.address, b.wallet.address];
  const mb = await signMsg(b.wallet, { sea: 's1x', g: 1, text: 'b' });
  const mx = await signMsg(x.wallet, { sea: 's1x', g: 1, text: 'x' });
  const posts = [
    { kind: 'msgs', sea: 's1x', g: 1, by: a.wallet.address, at: 5, msgs: [mb.env, mx.env] },   /* a が b のぶんも書いた（x は名簿に無い） */
    { kind: 'msg', sea: 's1x', g: 1, by: a.wallet.address, at: 3, text: 'old' },
    { kind: 'msg', sea: 's1x', g: 1, by: x.wallet.address, at: 4, text: 'spam' },
    { kind: 'hello', sea: 's1x', g: 1, by: a.wallet.address, at: 6, dev: 'f'.repeat(16) },
  ];
  const got = await messagesFromPosts(posts, { sea: 's1x', g: 1, allowed });
  assert.deepEqual(got.map(m => m.text).sort(), ['b', 'old']);
  assert.ok(got.every(m => m.state === 'chain'));
});

await test('顔合わせ: チェーンに書いた 1 通（msgs）を見た側が offer、書いた側が answer してつながる', async () => {
  const a = await keysOf(49), b = await keysOf(50);
  const board = [];
  const allowed = () => [a.wallet.address, b.wallet.address];
  const make = (k, dev) => {
    const got = [];
    const mesh = new Mesh({ sea: 's1x', g: 1, dev, allowed, ice: [], RTC: FakeRTC, history: () => [],
      post: async (inner) => { const env = await signedPost(k.wallet, inner); board.push(JSON.parse(env.p)); },
      onMessages: (list) => got.push(...list) });
    return { mesh, got };
  };
  /* 印の大きい b が 1 通書いただけ（a は何も書いていない）。a が見て offer を書く */
  const A = make(a, 'a'.repeat(16)), B = make(b, 'b'.repeat(16));
  const mb = await signMsg(b.wallet, { sea: 's1x', g: 1, text: 'hi' });
  board.push(JSON.parse((await signedPost(b.wallet, { kind: 'msgs', sea: 's1x', g: 1, at: Date.now(), dev: 'b'.repeat(16), msgs: [mb.env] })).p));
  const view = () => board.slice().reverse();
  await A.mesh.onPosts(view());
  assert.equal(board.filter(p => p.kind === 'offer').length, 1, '印が小さくても、知らせを見た側が offer');
  await B.mesh.onPosts(view());
  await A.mesh.onPosts(view());
  assert.equal(A.mesh.openCount(), 1);
  assert.equal(B.mesh.openCount(), 1);
  /* 印の無い前の版の msgs では、つなごうとしない */
  const C = make(a, 'c'.repeat(16));
  await C.mesh.onPosts([{ kind: 'msgs', sea: 's1x', g: 1, by: b.wallet.address, at: Date.now(), msgs: [] }]);
  assert.equal(C.mesh.peers.size, 0);
  A.mesh.close(); B.mesh.close();
});

await test('顔合わせ: 両方が知らせを出して offer が行き違っても、印の大きいほうの offer でつながる', async () => {
  const a = await keysOf(45), b = await keysOf(46);
  const board = [];   /* 掲示板（新しい順に返す） */
  const allowed = () => [a.wallet.address, b.wallet.address];
  const make = (k, dev, hist) => {
    const got = [];
    const mesh = new Mesh({
      sea: 's1x', g: 1, dev, allowed, ice: [], RTC: FakeRTC, history: () => hist,
      post: async (inner) => { const env = await signedPost(k.wallet, inner); board.push(JSON.parse(env.p)); },
      onMessages: (list) => got.push(...list),
    });
    return { mesh, got };
  };
  const ma = await signMsg(a.wallet, { sea: 's1x', g: 1, text: 'from a (unsent)' });
  const A = make(a, 'a'.repeat(16), [Object.assign({ state: 'unsent' }, ma)]);
  const B = make(b, 'b'.repeat(16), []);
  await A.mesh.hello();
  await B.mesh.hello();
  const view = () => board.slice().reverse();
  await A.mesh.onPosts(view());   /* a が b の hello を見て offer */
  await B.mesh.onPosts(view());   /* b も a の hello を見て offer。a からの offer は、b の印が大きいので答えない */
  assert.equal(board.filter(p => p.kind === 'offer').length, 2);
  assert.equal(board.filter(p => p.kind === 'answer').length, 0);
  await A.mesh.onPosts(view());   /* a は自分の offer を捨てて、b の offer に answer */
  assert.equal(board.filter(p => p.kind === 'answer').length, 1);
  await B.mesh.onPosts(view());   /* b が受け取って、つながる */
  assert.equal(A.mesh.openCount(), 1);
  assert.equal(B.mesh.openCount(), 1);
  await until(() => B.got.length > 0);
  assert.deepEqual(B.got.map(m => m.text), ['from a (unsent)'], 'つながったら未送が届く');
  /* 直に送る */
  const mb = await signMsg(b.wallet, { sea: 's1x', g: 1, text: 'hi' });
  assert.equal(B.mesh.broadcast([mb.env]), 1);
  await until(() => A.got.some(m => m.text === 'hi'));
  /* 同じ書き込みを何度読んでも、もう一度 offer しない */
  await B.mesh.onPosts(view());
  await A.mesh.onPosts(view());
  assert.equal(board.filter(p => p.kind === 'offer').length, 2);
  A.mesh.close(); B.mesh.close();
  assert.equal(A.mesh.openCount(), 0);
});

await test('顔合わせ: 名簿に無い人・古い offer は相手にしない', async () => {
  const a = await keysOf(47), x = await keysOf(48);
  const posted = [];
  const mesh = new Mesh({ sea: 's1x', g: 1, dev: 'a'.repeat(16), allowed: () => [a.wallet.address], ice: [], RTC: FakeRTC,
    history: () => [], post: async (i) => posted.push(i) });
  await mesh.onPosts([
    { kind: 'hello', sea: 's1x', g: 1, by: x.wallet.address, dev: '0'.repeat(16), at: Date.now() },
    { kind: 'offer', sea: 's1x', g: 1, by: a.wallet.address, dev: 'c'.repeat(16), to: 'a'.repeat(16), sid: 's', sdp: 'offer-x', at: Date.now() - 10 * 60 * 1000 },
  ]);
  assert.equal(posted.length, 0);
});

await test('記録の写し（Issue #41）: 署名・名簿・海・代・形を確かめる', async () => {
  const a = await keysOf(51), x = await keysOf(52);
  const box = { doc: { todos: [{ id: 't1', text: 'x' }] }, stamps: { t1: 1 } };
  const env = await signSnap(a.wallet, { sea: 's1x', g: 1, entry: { id: 's1x', name: 'n' }, box });
  const opt = { sea: 's1x', g: 1, allowed: [a.wallet.address] };
  const got = await openSnap(env, opt);
  assert.equal(got.by, a.wallet.address);
  assert.deepEqual(got.box, box);
  assert.equal(await openSnap(env, Object.assign({}, opt, { allowed: [x.wallet.address] })), null, '名簿に無い');
  assert.equal(await openSnap(env, Object.assign({}, opt, { sea: 'other' })), null, 'ほかの海');
  assert.equal(await openSnap(env, Object.assign({}, opt, { g: 2 })), null, '前の代');
  assert.equal(await openSnap(Object.assign({}, env, { p: env.p.replace('"x"', '"y"') }), opt), null, '書き換え');
  const bad = await signSnap(a.wallet, { sea: 's1x', g: 1, box: { doc: {} } });
  assert.equal(await openSnap(bad, opt), null, 'stamps が無い');
  const m = await signMsg(a.wallet, { sea: 's1x', g: 1, text: 'hi' });
  assert.equal(await openSnap(m.env, opt), null, 'メッセージは写しでない');
});

await test('切れ端: 分けて元に戻る', () => {
  const s = 'あ'.repeat(PART_CHARS * 2 + 5);
  const parts = splitParts(s);
  assert.equal(parts.length, 3);
  assert.ok(parts.every(p => p.t === 'part' && p.n === 3 && p.d.length <= PART_CHARS && p.id === parts[0].id));
  assert.equal(parts.map(p => p.d).join(''), s);
  assert.equal(splitParts('').length, 1);
});

await test('記録の写し: つながったら互いに送り合い、大きい写しも切れ端で届く。名簿に無い人の写しは捨てる', async () => {
  const a = await keysOf(53), b = await keysOf(54), x = await keysOf(55);
  const board = [];
  const allowed = () => [a.wallet.address, b.wallet.address];
  const big = 'z'.repeat(PART_CHARS * 3);   /* 切れ端 4 つ以上になる大きさ */
  const make = (k, dev, text) => {
    const got = [];
    const mesh = new Mesh({ sea: 's1x', g: 1, dev, allowed, ice: [], RTC: FakeRTC, history: () => [],
      post: async (inner) => { const env = await signedPost(k.wallet, inner); board.push(JSON.parse(env.p)); },
      snapshot: async () => signSnap(k.wallet, { sea: 's1x', g: 1, entry: null, box: { doc: { todos: [{ id: dev, text }] }, stamps: { [dev]: 1 } } }),
      onSnap: (inner) => got.push(inner) });
    return { mesh, got };
  };
  const A = make(a, 'a'.repeat(16), 'small'), B = make(b, 'b'.repeat(16), big);
  await A.mesh.hello();
  const view = () => board.slice().reverse();
  await B.mesh.onPosts(view());
  await A.mesh.onPosts(view());
  await B.mesh.onPosts(view());
  assert.equal(A.mesh.openCount(), 1);
  await until(() => A.got.length === 1 && B.got.length === 1);
  assert.equal(B.got[0].by, a.wallet.address);
  assert.equal(B.got[0].box.doc.todos[0].text, 'small');
  assert.equal(A.got[0].box.doc.todos[0].text, big, '大きい写しが切れ端から戻る');
  assert.equal(A.mesh.parts.size, 0, '集めかけが残らない');
  /* 「自分の変更を送る」= broadcastSnap */
  const again = await signSnap(b.wallet, { sea: 's1x', g: 1, box: { doc: { todos: [] }, stamps: {} } });
  assert.equal(B.mesh.broadcastSnap(again), 1);
  await until(() => A.got.length === 2);
  /* 名簿に無い人が署名した写しは捨てる */
  const forged = await signSnap(x.wallet, { sea: 's1x', g: 1, box: { doc: { todos: [] }, stamps: {} } });
  B.mesh.broadcastSnap(forged);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(A.got.length, 2);
  A.mesh.close(); B.mesh.close();
});

await test('記録の写し: snapshot を渡さない（自分あてのメモ）なら送らない', async () => {
  const a = await keysOf(56), b = await keysOf(57);
  const board = [];
  const allowed = () => [a.wallet.address, b.wallet.address];
  const got = [];
  const make = (k, dev, withSnap) => new Mesh({ sea: 'self', g: 0, dev, allowed, ice: [], RTC: FakeRTC, history: () => [],
    post: async (inner) => { const env = await signedPost(k.wallet, inner); board.push(JSON.parse(env.p)); },
    snapshot: null, onSnap: withSnap ? (i) => got.push(i) : null });
  const A = make(a, 'a'.repeat(16), true), B = make(b, 'b'.repeat(16), false);
  await A.hello();
  const view = () => board.slice().reverse();
  await B.onPosts(view()); await A.onPosts(view()); await B.onPosts(view());
  assert.equal(A.openCount(), 1);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(got.length, 0);
  A.close(); B.close();
});

console.log(n + ' tests passed');
