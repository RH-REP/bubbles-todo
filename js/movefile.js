/* 引っ越しのファイル（2026-11-07 Issue #19。利用者の指示：管理者がいなくても、端末を変えて共同 TODO まで戻せるように）。
   DOM は触らない（設定の画面 settings.js が使う。テストは tests/movefile.test.mjs）。

   ■ 中に入れるもの（1つのファイル）
     - すべての海の記録（個人と、一覧にある海。この端末に箱があるものだけ）
     - 海の一覧（名前・色・消した印）
     - サーバーの住所と、入る鍵
         公開の形（パスキー）… 引っ越しの鍵（サーバーが出す。入れる範囲はこの端末のパスキーと同じ。使い切り）
         手元の形（合言葉）  … 自分の合言葉・「共有」の合言葉
   入れないもの: AI のキー・パスキーの通行証・端末だけの設定（効果音・先の予定など）。

   ■ 暗号
   合言葉（app が作って見せる 24 字。32 種の字なので 120 ビット）から PBKDF2-SHA256（60 万回）で鍵を作り、
   AES-256-GCM で中身を包む。塩（16 バイト）と IV（12 バイト）は毎回新しく作り、ファイルの頭に平文で置く。
   鍵そのものはどこにも置かない。合言葉を忘れたら開けない。
   ブラウザの WebCrypto（crypto.subtle）だけで書く（Node 20 にもあるのでテストできる）。

   ■ 読み込み
   記録は消さずに重ねる（merge.js。記録ごとに新しいほうが残る）。同じファイルを2回読んでも増えない。
   開いている海は store.applyState で、ほかの海は箱（localStorage）へ直に書く。 */

import { mergeState } from './merge.js';

export const FORMAT = 'bubbles-move';
export const VERSION = 1;
export const ITER = 600000;
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* 読み違えやすい I・O・0・1 を外す（招待コードと同じ字） */
export const PASS_LEN = 24;

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

function toB64(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* 合言葉を作る（XXXX-XXXX-…、24 字）。字の偏りが出ないよう、32 で割り切れる 256 の範囲を使う */
export function makePassphrase(bytes = randomBytes(PASS_LEN)) {
  let s = '';
  for (let i = 0; i < PASS_LEN; i++) s += ABC[bytes[i] % 32];
  return s.match(/.{4}/g).join('-');
}

/* 打った合言葉を整える。小文字・空白・- は無視する */
export function normalizePassphrase(raw) {
  return String(raw || '').toUpperCase().split('').filter(c => ABC.indexOf(c) >= 0).join('');
}

async function deriveKey(pass, salt, iter) {
  const s = subtle();
  const base = await s.importKey('raw', new TextEncoder().encode(normalizePassphrase(pass)), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* 中身（オブジェクト）を合言葉で包む → ファイルの文字列（JSON） */
export async function encryptMove(payload, pass, iter = ITER) {
  if (normalizePassphrase(pass).length < 16) throw new Error('合言葉が短い');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(pass, salt, iter);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain);
  return JSON.stringify({
    format: FORMAT, version: VERSION, at: payload && payload.at, device: (payload && payload.device) || '',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: iter, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(ct),
  });
}

/* ファイルの頭（暗号の外）だけを読む。形が違えば Error */
export function readMoveHead(text) {
  let o;
  try { o = JSON.parse(String(text || '')); } catch (e) { throw new Error('引っ越しのファイルではない'); }
  if (!o || o.format !== FORMAT || !o.kdf || !o.cipher || !o.data) throw new Error('引っ越しのファイルではない');
  if (Number(o.version) > VERSION) throw new Error('この app より新しい版のファイル（app を更新してから読み込む）');
  return o;
}

/* ファイルの文字列を合言葉で開く → 中身。合言葉が違えば Error */
export async function decryptMove(text, pass) {
  const o = readMoveHead(text);
  const iter = Number(o.kdf.iterations);
  if (!(iter >= 100000 && iter <= 10000000)) throw new Error('引っ越しのファイルが壊れている');
  const key = await deriveKey(pass, fromB64(o.kdf.salt), iter);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(o.cipher.iv) }, key, fromB64(o.data));
  } catch (e) { throw new Error('合言葉が違う（またはファイルが壊れている）'); }
  const p = JSON.parse(new TextDecoder().decode(plain));
  if (!p || p.format !== FORMAT) throw new Error('引っ越しのファイルが壊れている');
  return p;
}

/* 箱に入っている形（doc の欄 + stamps）→ { doc, stamps }。読めなければ null */
export function boxToState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = Object.assign({}, raw);
  const stamps = doc.stamps && typeof doc.stamps === 'object' && !Array.isArray(doc.stamps) ? doc.stamps : null;
  delete doc.stamps;
  return stamps ? { doc, stamps } : null;
}
export function stateToBox(state) {
  return Object.assign({}, state.doc, { stamps: state.stamps });
}

/* 中身を組む。boxes = { 海の ID: { doc, stamps } }、seas = 海の一覧、server = { url, move, token, shareToken }。
   海域（2026-11-12 段2。js/regions.js）: regions = 入れた海域の一覧、servers = { 海域の ID: { url, move | token, shareToken } }。
   regions のあるファイルは、戻すときに海域ごとに付け替える（settings.js の mergeIntoDevice）。
   server は前の版の app のために残す（前の版は servers を読まず、server の1つだけで入り直す） */
export function buildPayload({ boxes, seas, server, at = Date.now(), device = '', regions, servers }) {
  const out = { format: FORMAT, version: VERSION, at, device, seas: Array.isArray(seas) ? seas : [], boxes: {} };
  if (Array.isArray(regions)) out.regions = regions;
  if (servers && typeof servers === 'object') {
    out.servers = {};
    Object.keys(servers).forEach(rid => {
      const v = servers[rid] || {};
      if (!v.url) return;
      const o = { url: String(v.url) };
      if (v.move) o.move = String(v.move);
      if (v.token) o.token = String(v.token);
      if (v.shareToken) o.shareToken = String(v.shareToken);
      out.servers[rid] = o;
    });
  }
  Object.keys(boxes || {}).forEach(id => {
    const st = boxes[id];
    if (st && st.doc && st.stamps) out.boxes[id] = { doc: st.doc, stamps: st.stamps };
  });
  const s = server || {};
  if (s.url) {
    out.server = { url: String(s.url) };
    if (s.move) out.server.move = String(s.move);
    if (s.token) out.server.token = String(s.token);
    if (s.shareToken) out.server.shareToken = String(s.shareToken);
  }
  return out;
}

/* 海ごとの記録を重ねる。local が無ければファイルのものをそのまま。戻り値 { doc, stamps } */
export function mergeBox(local, fromFile) {
  if (!fromFile) return local;
  if (!local) return fromFile;
  return mergeState(local, fromFile);
}

/* 読む前に見せる要約 */
export function moveSummary(p) {
  let todos = 0;
  const ids = Object.keys((p && p.boxes) || {});
  ids.forEach(id => {
    const list = ((p.boxes[id] || {}).doc || {}).todos;
    if (Array.isArray(list)) todos += list.filter(t => t && !t.trashed).length;
  });
  const regions = Array.isArray(p && p.regions) ? p.regions.map(r => String((r && r.name) || '')).filter(Boolean) : [];
  return { at: Number(p && p.at) || 0, device: (p && p.device) || '', seas: ids.length, todos, regions,
    server: !!(p && p.server && p.server.url), move: !!(p && p.server && p.server.move) };
}

export function moveFileName(now = Date.now()) {
  const d = new Date(now), z = x => String(x).padStart(2, '0');
  return `bubbles-move-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.json`;
}
