/* 共有の海（サーバーなし版。2026-11-11 Issue #37。#31 の2段目。利用者の返事「おすすめで」= 段1→段2、誰でもの掲示板は今は作らない）。
   DOM は触らない（設定の画面 settings.js が使う。テストは tests/board.test.mjs）。通信は chain.js の窓口だけ。

   ■ 掲示板
   掲示板 = チェーンの上のアドレス 1 つ。書くときは、取引にこのアドレスを「載せるだけの口座」として入れる
   （chain.js の memoMessage の extra）。読むときは、このアドレスの取引を新しい順に集める。
   書くのは止められない（手数料を払えば誰でも書ける）ので、「読み書きできる人を限る」は次の 2 つで作る:
     読む人を限る … 海の鍵で暗号化する（鍵を持つ人しか読めない）
     書く人を限る … 書き込みの中にウォレットの署名を入れ、名簿にあるアドレスの書き込みだけを使う

   ■ 海の鍵（32 バイト・海ごと・作り替えるたびに別のもの）
     ├ 掲示板のアドレス = Ed25519 の公開鍵（HKDF(海の鍵, "board") を種にする。秘密鍵は使わない）
     └ 掲示板のカギ（AES-256-GCM）= HKDF(海の鍵, "record")
   端末には、自分の記録のカギ（chain.js の recordKey）で包んで置く（そのままは置かない）。使うたびにパスキーか合言葉で開く。

   ■ 共有用のアドレス（BTA1-…。人に見られてよい）
   [版][ネット][X25519 の公開鍵 32][ウォレットの公開鍵 32][sha256 の頭 4] を base58。
   X25519 の鍵は、元から HKDF(元, "share") で毎回同じものを作る（chain.js の keysFromRoot の shareSeed）。

   ■ 招待（封筒）
   海の鍵を、招かれる人だけが開ける形にして、チェーンに書く。宛先はその人のウォレットのアドレス（載せるだけの口座）。
   使い捨ての X25519 の鍵と相手の X25519 の公開鍵で鍵を合わせ（ECDH → HKDF）、AES-GCM で包む。
   中に招いた人（海の持ち主）のウォレットの署名を入れる（ほかの人が持ち主の名をかたって封筒を書いても、署名が合わない）。
   メモの形 = "bt2e <base64>"、中身 = [版][使い捨ての公開鍵 32][IV 12][暗号文]。

   ■ 掲示板の書き込み（bt2。chain.js の sealToMemos と同じ切れ端の形）
   中身 = { v, p: 文字列, s: p への署名 }。p = { kind: 'snap' | 'roster', sea, g, by, at, … }
     snap   … その海の記録の写し（entry = 海の一覧の 1 件、box = { doc, stamps }）。読むと merge.js で重ねる
     roster … 名簿（持ち主だけが書く。members = [{ a: ウォレット, x: 共有用のアドレス, n: 呼び名 }]）
   g は海の鍵の代（作り替えるたびに 1 増える）。

   ■ 見えるもの（暗号の外）
   どのアドレスが・いつ・どの掲示板に・どれくらいの大きさで書いたか。招待は「持ち主のウォレット → 招かれる人のウォレット」
   なので、誰と誰が同じ海にいるかは見える（中身は読めない）。 */

import { NETWORKS, BOARD_TAG, b58encode, b58decode, toB64, fromB64, fromB64u, walletFromSeed,
  sealToMemos, parseMemo, openMemos, readMemos, writeMemos } from './chain.js';

export const ENV_TAG = 'bt2e';
export const STORE_KEY = 'bubble_todo_board_v1';
const SALT = 'bubbles-board-v1';
const VER = 1;
const PKCS8_X25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];
const NO_X25519 = 'このブラウザは共有の鍵（X25519）に対応していない（ブラウザを新しくする）';

const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('この環境では暗号を使えない（https:// の住所で開く）');
  return c.subtle;
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function concat(parts) {
  let len = 0;
  parts.forEach(p => { len += p.length; });
  const out = new Uint8Array(len);
  let o = 0;
  parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
async function hkdf(ikm, info) {
  const s = subtle();
  const k = await s.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc(SALT), info: enc(info) }, k, 256));
}
async function sha256(bytes) { return new Uint8Array(await subtle().digest('SHA-256', bytes)); }
async function aesKey(raw, use) { return subtle().importKey('raw', raw, 'AES-GCM', false, [use]); }

/* ---- 共有用のアドレス ---- */

/* 種（32 バイト）→ { privateKey（CryptoKey）, publicKey（32 バイト） } */
export async function shareKeyFromSeed(seed) {
  const s = subtle();
  let priv;
  try {
    priv = await s.importKey('pkcs8', concat([Uint8Array.from(PKCS8_X25519), seed]), { name: 'X25519' }, true, ['deriveBits']);
  } catch (e) { throw new Error(NO_X25519); }
  const jwk = await s.exportKey('jwk', priv);
  return { privateKey: priv, publicKey: fromB64u(jwk.x) };
}

/* keys（chain.js の keysFromRoot）→ 'BTA1-…' */
export async function makeShareAddress(keys, network) {
  const net = NETWORKS[network];
  if (!net) throw new Error('ネットが正しくない');
  if (!keys || !keys.shareSeed) throw new Error('鍵が正しくない');
  const sk = await shareKeyFromSeed(keys.shareSeed);
  const body = concat([Uint8Array.of(VER, net.code), sk.publicKey, keys.wallet.publicKey]);
  const sum = (await sha256(body)).subarray(0, 4);
  return 'BTA1-' + b58encode(concat([body, sum])).match(/.{1,6}/g).join('-');
}

/* 'BTA1-…' → { network, x（X25519 の公開鍵）, wallet（ウォレットのアドレス）, text（整えた形） } */
export async function readShareAddress(str) {
  const raw = String(str || '').replace(/\s/g, '').replace(/^BTA1-?/i, '').replace(/-/g, '');
  let b;
  try { b = b58decode(raw); } catch (e) { throw new Error('共有用のアドレスの字が違う'); }
  if (b.length !== 2 + 32 + 32 + 4) throw new Error('共有用のアドレスの長さが違う（写し間違い？）');
  const body = b.subarray(0, 66), sum = b.subarray(66);
  const want = (await sha256(body)).subarray(0, 4);
  if (want.some((x, i) => x !== sum[i])) throw new Error('共有用のアドレスが違う（写し間違い？）');
  if (body[0] !== VER) throw new Error('この app より新しい版の共有用のアドレス');
  const network = Object.keys(NETWORKS).find(k => NETWORKS[k].code === body[1]);
  if (!network) throw new Error('共有用のアドレスのネットが分からない');
  const x = body.slice(2, 34);
  const wallet = b58encode(body.slice(34, 66));
  return { network, x, wallet, text: 'BTA1-' + b58encode(b).match(/.{1,6}/g).join('-') };
}

/* ---- 海の鍵と掲示板 ---- */

export function newSeaKey() { return randomBytes(32); }

/* 海の鍵 → { address（掲示板のアドレス）, recordKey（掲示板のカギ） } */
export async function boardOf(seaKey) {
  if (!seaKey || seaKey.length !== 32) throw new Error('海の鍵が正しくない');
  const w = await walletFromSeed(await hkdf(seaKey, 'board'));
  return { address: w.address, recordKey: await hkdf(seaKey, 'record') };
}

/* 海の鍵を自分の記録のカギで包む（端末に置く形）。AAD に海の ID・代・自分のアドレスを入れる */
const wrapAad = (id, gen, me) => enc(SALT + '|seakey|' + id + '|' + gen + '|' + me);
export async function wrapSeaKey(seaKey, recordKey, id, gen, me) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: wrapAad(id, gen, me) },
    await aesKey(recordKey, 'encrypt'), seaKey));
  return toB64(concat([iv, ct]));
}
export async function unwrapSeaKey(rec, recordKey) {
  const all = fromB64(rec.wrapped);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: wrapAad(rec.id, rec.gen, rec.me) },
      await aesKey(recordKey, 'decrypt'), all.subarray(12)));
  } catch (e) {
    throw new Error('この海の鍵を開けない（共有を始めたときと別のパスキー・合言葉で開いている）。「招待を探す」で受け取り直す');
  }
}

/* ---- 署名 ---- */

/* 署名するときの文。封筒は中の欄を決まった順に並べる */
const envSigText = (o, to) => ['bubbles-env-v1', o.net, to, o.sea.id, o.g, o.kh].join('|');

async function verifyBy(address, text, sigB64) {
  try {
    const s = subtle();
    const key = await s.importKey('raw', b58decode(address), { name: 'Ed25519' }, false, ['verify']);
    return await s.verify({ name: 'Ed25519' }, key, fromB64(sigB64), enc(text));
  } catch (e) { return false; }
}

/* 掲示板の書き込みを署名して包む → { v, p, s } */
export async function signedPost(wallet, inner) {
  const p = JSON.stringify(Object.assign({}, inner, { by: wallet.address }));
  return { v: VER, p, s: toB64(await wallet.sign(enc(p))) };
}
/* → 中身（署名が合わなければ null） */
export async function verifyPost(post) {
  if (!post || post.v !== VER || typeof post.p !== 'string' || typeof post.s !== 'string') return null;
  let inner;
  try { inner = JSON.parse(post.p); } catch (e) { return null; }
  if (!inner || typeof inner !== 'object' || typeof inner.by !== 'string') return null;
  return (await verifyBy(inner.by, post.p, post.s)) ? inner : null;
}

/* ---- 招待（封筒） ---- */

/* info = { network, sea: { id, name, color, at }, key（海の鍵）, gen, owner（持ち主の wallet。署名する） }、to = readShareAddress の戻り値
   → メモの文 */
export async function sealEnvelope(info, to) {
  const s = subtle();
  let eph;
  try { eph = await s.generateKey({ name: 'X25519' }, true, ['deriveBits']); } catch (e) { throw new Error(NO_X25519); }
  const ephPub = new Uint8Array(await s.exportKey('raw', eph.publicKey));
  const peer = await s.importKey('raw', to.x, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await s.deriveBits({ name: 'X25519', public: peer }, eph.privateKey, 256));
  const k = await aesKey(await hkdf(shared, 'envelope'), 'encrypt');
  const sea = { id: info.sea.id, name: info.sea.name, color: info.sea.color, at: info.sea.at || 0 };
  const o = { v: VER, net: info.network, sea, k: toB64(info.key), g: info.gen, o: info.owner.address,
    kh: toB64((await sha256(info.key)).subarray(0, 16)), at: Date.now() };
  o.s = toB64(await info.owner.sign(enc(envSigText(o, to.wallet))));
  const iv = randomBytes(12);
  const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: enc(SALT + '|env|' + to.wallet + '|' + toB64(ephPub)) },
    k, enc(JSON.stringify(o))));
  return ENV_TAG + ' ' + toB64(concat([Uint8Array.of(VER), ephPub, iv, ct]));
}

/* メモの文 → 封筒の base64（封筒でなければ null） */
export function parseEnvelope(text) {
  const m = /(?:^|\s|\])bt2e ([A-Za-z0-9+/=]+)/.exec(String(text || ''));
  return m ? m[1] : null;
}

/* 封筒を開ける → { network, sea, key, gen, owner, at }。自分宛てでない・壊れている・署名が合わないなら null */
export async function openEnvelope(b64, keys) {
  let all;
  try { all = fromB64(b64); } catch (e) { return null; }
  if (all.length < 1 + 32 + 12 + 16 || all[0] !== VER) return null;
  const ephPub = all.slice(1, 33), iv = all.subarray(33, 45), ct = all.subarray(45);
  const s = subtle();
  const me = keys.wallet.address;
  let o;
  try {
    const sk = await shareKeyFromSeed(keys.shareSeed);
    const peer = await s.importKey('raw', ephPub, { name: 'X25519' }, false, []);
    const shared = new Uint8Array(await s.deriveBits({ name: 'X25519', public: peer }, sk.privateKey, 256));
    const k = await aesKey(await hkdf(shared, 'envelope'), 'decrypt');
    const plain = await s.decrypt({ name: 'AES-GCM', iv, additionalData: enc(SALT + '|env|' + me + '|' + toB64(ephPub)) }, k, ct);
    o = JSON.parse(dec(new Uint8Array(plain)));
  } catch (e) {
    if (e && e.message === NO_X25519) throw e;
    return null;
  }
  if (!o || o.v !== VER || !NETWORKS[o.net] || !o.sea || typeof o.sea.id !== 'string' || typeof o.o !== 'string') return null;
  const key = fromB64(String(o.k || ''));
  if (key.length !== 32 || !(Number(o.g) >= 1)) return null;
  const kh = toB64((await sha256(key)).subarray(0, 16));
  if (kh !== o.kh) return null;
  if (!(await verifyBy(o.o, envSigText(o, me), String(o.s || '')))) return null;
  return { network: o.net, sea: { id: o.sea.id, name: String(o.sea.name || ''), color: o.sea.color, at: Number(o.sea.at) || 0, alive: 1 },
    key, gen: Number(o.g), owner: o.o, at: Number(o.at) || 0 };
}

/* 自分のウォレットに届いた封筒を開ける → 海ごとにいちばん新しい代のもの（同じ代なら新しい取引）。新しい順 */
export async function findInvites(network, keys, { limit = 200, opt } = {}) {
  const list = await readMemos(network, keys.wallet.address, { limit, opt });
  const best = new Map();
  for (const it of list) {
    const b = parseEnvelope(it.text);
    if (!b) continue;
    const info = await openEnvelope(b, keys);
    if (!info || info.network !== network) continue;
    const cur = best.get(info.sea.id);
    if (!cur || info.gen > cur.gen) best.set(info.sea.id, info);   /* 一覧は新しい順なので、同じ代は先に出たほうを残す */
  }
  return Array.from(best.values());
}

/* ---- 書く ---- */

/* 封筒を 1 件書く。宛先が自分なら載せるだけの口座は要らない（払う人と同じ口座を 2 度並べると取引が断られる） */
export async function writeEnvelope(network, wallet, text, toWallet, opt) {
  const extra = toWallet === wallet.address ? [] : [toWallet];
  return writeMemos(network, wallet, [text], { extra, opt });
}

/* 掲示板へ書く書き込みのメモの並び */
export async function postMemos(wallet, inner, board) {
  return sealToMemos(await signedPost(wallet, inner), board.recordKey, undefined, BOARD_TAG);
}
export async function writePost(network, wallet, memos, board, { onStep, opt } = {}) {
  return writeMemos(network, wallet, memos, { extra: [board.address], onStep, opt });
}

/* ---- 読む ---- */

/* 新しい順のメモの文 → 署名の合った書き込みの中身（新しい順）。開けない・壊れた・切れ端の欠けたものは捨てる */
export async function collectPosts(texts, recordKey, { maxGroups = 60 } = {}) {
  const groups = new Map();
  texts.forEach(t => {
    const p = parseMemo(t, BOARD_TAG);
    if (!p) return;
    if (!groups.has(p.id)) groups.set(p.id, { n: p.n, parts: new Map() });
    const g = groups.get(p.id);
    if (g.n === p.n) g.parts.set(p.i, p);
  });
  const out = [];
  let tried = 0;
  for (const g of groups.values()) {
    if (g.parts.size !== g.n) continue;
    if (++tried > maxGroups) break;
    let post;
    try { post = await openMemos(Array.from(g.parts.values()).sort((a, b) => a.i - b.i), recordKey, BOARD_TAG); } catch (e) { continue; }
    const inner = await verifyPost(post);
    if (inner) out.push(inner);
  }
  return out;
}

/* 持ち主のいちばん新しい名簿 → members（無ければ null） */
export function rosterOf(posts, { owner, sea, gen }) {
  const r = posts.find(p => p.kind === 'roster' && p.by === owner && p.sea === sea && Number(p.g) === gen && Array.isArray(p.members));
  return r ? cleanMembers(r.members) : null;
}

export function cleanMembers(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(m => {
    if (!m || typeof m.a !== 'string' || seen.has(m.a)) return;
    seen.add(m.a);
    out.push({ a: m.a, x: typeof m.x === 'string' ? m.x : '', n: typeof m.n === 'string' ? m.n.slice(0, 24) : '' });
  });
  return out;
}

/* 使ってよい記録の写し → 書いた人ごとにいちばん新しいもの（新しい順）。名簿（と持ち主）のアドレスが書いたものだけ */
export function acceptedSnaps(posts, { owner, members, sea, gen }) {
  const allowed = new Set([owner].concat((members || []).map(m => m.a)));
  const seen = new Set();
  const out = [];
  posts.forEach(p => {
    if (p.kind !== 'snap' || p.sea !== sea || Number(p.g) !== gen || !allowed.has(p.by) || seen.has(p.by)) return;
    if (!p.box || typeof p.box !== 'object' || !p.box.doc || !p.box.stamps) return;
    seen.add(p.by);
    out.push(p);
  });
  return out;
}

/* 掲示板を読む → { posts, members（名簿が見つかれば）, snaps } */
export async function readBoard(network, rec, seaKey, { limit = 300, opt } = {}) {
  const board = await boardOf(seaKey);
  const list = await readMemos(network, board.address, { limit, opt });
  const posts = await collectPosts(list.map(x => x.text), board.recordKey);
  const members = rosterOf(posts, { owner: rec.owner, sea: rec.id, gen: rec.gen });
  const snaps = acceptedSnaps(posts, { owner: rec.owner, members: members || rec.members, sea: rec.id, gen: rec.gen });
  return { posts, members, snaps };
}

/* ---- この端末に置く共有の海の一覧（秘密は包んだ海の鍵だけ。包むのは自分の記録のカギ） ----
   { [海の ID]: { id, net, gen, owner, me, wrapped, board, members: [{ a, x, n }], savedAt, readAt } } */
export function loadShared(storage = globalThis.localStorage) {
  try {
    const all = JSON.parse(storage.getItem(STORE_KEY) || 'null');
    if (all && typeof all === 'object' && !Array.isArray(all)) return all;
  } catch (e) { /* 壊れていれば無いことにする */ }
  return {};
}
export function saveShared(all, storage = globalThis.localStorage) {
  storage.setItem(STORE_KEY, JSON.stringify(all || {}));
}
/* いま開いているウォレット・ネットの共有の海 */
export function sharedFor(all, me, network) {
  return Object.keys(all || {}).map(k => all[k]).filter(r => r && r.me === me && r.net === network);
}

export function shortAddr(a) {
  const s = String(a || '');
  return s.length > 12 ? s.slice(0, 4) + '…' + s.slice(-4) : s;
}
