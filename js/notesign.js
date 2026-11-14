/* ひとこと 1 件ずつのウォレットの署名（2026-11-14 Issue #61 の N-A。返事「それでいい」）。
   サーバーなし版の共有の海（ブロックチェーンの掲示板で共有している海）だけで使う。

   ■ 何のためか
   ひとことは海の記録の写しと一緒に運ばれる（掲示板に保存・読み込み、直の通信）。写しはメンバーごとに署名されるが、
   中の 1 件ずつには署名が無く、書いた人の名前は端末で決めた名前なので、ほかの人の名前を名乗れた。
   書いた人のウォレットで 1 件ずつ署名し、読むときに名簿のアドレスの署名だけを「✓ 呼び名」で出す。

   ■ 記録の形（js/notes.js の 1 件に足す欄）
     sa … 書いた人のウォレットのアドレス（base58）
     sg … 署名（base64）。署名する文は signText（id・泡・時刻・名前・文）
   手数料は増えない（写しと一緒に運ぶため）。サーバーあり版の海では署名しない（欄も付かない）。

   ■ 鍵の置き方（返事「それでいい」= 開いている間だけメモリに置く）
   はじめて書くときにパスキーか合言葉で鍵を開け、メモリにだけ置く（端末には置かない）。
   海のチャットと同じく 10 分たつと捨てる。ページを閉じても消える。 */

import { loadConfig, passkeyRoot, keysFromRoot, rootFromPassphrase, b58decode, toB64, fromB64 } from './chain.js';
import { loadShared, shortAddr } from './board.js';
import { askText } from './asktext.js';

export const HOLD_MS = 10 * 60 * 1000;
const enc = (s) => new TextEncoder().encode(s);

/* 署名する文。欄の順は決めたまま変えない（変えると前のひとことが確かめられなくなる） */
export function signText(n) {
  return JSON.stringify(['bt-note1', String(n.id), String(n.todo), Number(n.at), String(n.by || ''), String(n.text || '')]);
}

let held = null;   /* { wallet, until } */
export function heldWallet(now = Date.now()) {
  if (held && now < held.until) return held.wallet;
  held = null;
  return null;
}
export function dropWallet() { held = null; }

/* その海がブロックチェーンで共有している海なら、その記録（{ owner, members, me, … }）。でなければ null */
export function sharedSeaOf(space) {
  try {
    const r = loadShared()[space];
    const me = loadConfig().address;
    return r && typeof r.owner === 'string' && r.owner && (!r.me || r.me === me) ? r : null;
  } catch (e) { return null; }
}

/* 書くときに署名するか（共有の海で、この端末がブロックチェーンを始めている） */
export function signingOn(space) {
  const c = loadConfig();
  return !!(sharedSeaOf(space) && (c.mode === 'passkey' || c.mode === 'pass') && c.address);
}

/* 鍵を開ける（持っていればそれを使う）。パスキーは押した手の続きで呼ぶので、ここより前で await しない */
export async function unlockWallet() {
  const w = heldWallet();
  if (w) return w;
  const cfg = loadConfig();
  let root;
  if (cfg.mode === 'passkey') root = (await passkeyRoot(cfg.credId)).root;
  else if (cfg.mode === 'pass') {
    const pass = await askText('合言葉（始めたときに書き留めた 24 字）。ひとことに署名するため。開いた鍵は 10 分だけメモリに置く');
    if (!pass) throw new Error('やめた');
    root = await rootFromPassphrase(pass);
  } else throw new Error('ブロックチェーンをまだ始めていない');
  const keys = await keysFromRoot(root);
  if (cfg.address && keys.wallet.address !== cfg.address) throw new Error('鍵が違う（このウォレットのアドレスと合わない）');
  held = { wallet: keys.wallet, until: Date.now() + HOLD_MS };
  return keys.wallet;
}

/* 1 件に署名を足した写し */
export async function signNote(n, wallet) {
  return Object.assign({}, n, { sa: wallet.address, sg: toB64(await wallet.sign(enc(signText(n)))) });
}

async function verifySig(address, text, sigB64) {
  try {
    const s = globalThis.crypto.subtle;
    const key = await s.importKey('raw', b58decode(address), { name: 'Ed25519' }, false, ['verify']);
    return await s.verify({ name: 'Ed25519' }, key, fromB64(sigB64), enc(text));
  } catch (e) { return false; }
}

/* 確かめる → { ok, name }。ok は、署名が合い、書いたアドレスが名簿（持ち主かメンバー）にあるとき。
   name は呼び名（自分なら「自分」、呼び名が無ければ短いアドレス）。同じ 1 件は覚えておく */
const cache = new Map();
export async function checkNote(n, rec) {
  if (!n || n.gone || !rec || typeof n.sa !== 'string' || typeof n.sg !== 'string') return { ok: false, name: '' };
  const ck = n.id + '|' + n.sg + '|' + (rec.gen || 0) + '|' + ((rec.members || []).length);
  if (cache.has(ck)) return cache.get(ck);
  const members = Array.isArray(rec.members) ? rec.members : [];
  const allowed = [rec.owner].concat(members.map(m => m && m.a)).filter(Boolean);
  let out = { ok: false, name: '' };
  if (allowed.includes(n.sa) && await verifySig(n.sa, signText(n), n.sg)) {
    const me = loadConfig().address;
    const m = members.find(x => x && x.a === n.sa);
    out = { ok: true, name: n.sa === me ? '自分' : ((m && m.n) || shortAddr(n.sa)) };
  }
  cache.set(ck, out);
  return out;
}
