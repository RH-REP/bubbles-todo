/* AI の API キーに鍵をかけて置く（2026-11-13 Issue #14。利用者の指示「平文で置くのは危ないので、暗号化して、使う時だけ復号」
   「パスキーが使えない時は合言葉でいい」）。DOM は触らない（js/ai.js と設定の画面が使う。テストは tests/aikey.test.mjs）。

   ■ 置くもの（どれも 'bubble_todo_ai_key' で始まる名前。rollback.js の写し・同期・CSV に入らない。「すべて初期化」で消える）
     錠   'bubble_todo_ai_key_lock' = { v, mode: 'passkey'|'pass', credId?, salt }   … 秘密は入らない
     キー  <会社のキーの箱> + '_enc'  = { v, iv, data, tail }                          … 暗号文と末尾 4 字（見分け用）
   開ける鍵（AES-256-GCM）は置かない。使う時に、パスキーの PRF か合言葉（PBKDF2 60 万回）から作る:
     元（32 バイト）→ HKDF(元, salt, "bubbles-aikey-v1") → AES 鍵（取り出せない CryptoKey）
   パスキーの PRF の入力は、ブロックチェーンの控え（js/chain.js）とは別の値にする。同じパスキーを選んでも、
   AI のキーを開けたときに財布の元は出てこない。

   ■ 開いている間
   開けた AES 鍵だけを OPEN_MS（10 分）メモリに置く（何度も指の確認をしなくてよいように）。キーの平文は呼ぶたびに
   復号して、その呼び出しが終われば捨てる。forget() でいつでも閉じる。
   使う時は守れない（ページで悪いコードが動いていれば読める。docs/api-key-security.md の 3.3）。守れるのは、
   使っていない間と、保存場所を丸ごと持ち出されたとき。 */

export const LOCK_STORE = 'bubble_todo_ai_key_lock';
export const ENC_SUFFIX = '_enc';
export const OPEN_MS = 10 * 60 * 1000;
export const PASS_MIN = 12;
export const PBKDF_ITER = 600000;
const VER = 1;
const PRF_SALT = new TextEncoder().encode('bubbles-aikey-v1-prf-salt-000000');   /* 32 バイト。chain.js とは別 */
const HKDF_INFO = 'bubbles-aikey-v1';

const enc = s => new TextEncoder().encode(s);
function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('このブラウザは暗号の機能が使えない（https で開く）');
  return c.subtle;
}
function randomBytes(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }
export function toB64(bytes) { let s = ''; bytes.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); }
export function fromB64(str) { const s = atob(String(str || '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
const toB64u = b => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => fromB64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));

function ls(storage) { return storage || globalThis.localStorage; }

/* ---- 錠 ---- */
export function loadLock(storage) {
  try {
    const o = JSON.parse(ls(storage).getItem(LOCK_STORE) || 'null');
    if (o && (o.mode === 'passkey' || o.mode === 'pass') && typeof o.salt === 'string') return o;
  } catch (e) { /* 壊れていれば無いことにする */ }
  return null;
}
export function saveLock(lock, storage) {
  const keep = { v: VER, mode: lock.mode, salt: lock.salt };
  if (lock.mode === 'passkey') keep.credId = lock.credId;
  ls(storage).setItem(LOCK_STORE, JSON.stringify(keep));
}
export function clearLock(storage) { try { ls(storage).removeItem(LOCK_STORE); } catch (e) { /* 消せなくてもよい */ } forget(); }

/* ---- 暗号文 ---- */
export function encName(keyStore) { return keyStore + ENC_SUFFIX; }
export function loadSealed(keyStore, storage) {
  try {
    const o = JSON.parse(ls(storage).getItem(encName(keyStore)) || 'null');
    if (o && typeof o.iv === 'string' && typeof o.data === 'string') return o;
  } catch (e) { /* 壊れていれば無いことにする */ }
  return null;
}

/* 元 → AES 鍵 */
export async function aesFromRoot(root, saltB64) {
  if (!root || root.length !== 32) throw new Error('鍵の元が正しくない');
  const s = subtle();
  const k = await s.importKey('raw', root, 'HKDF', false, ['deriveKey']);
  return s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: fromB64(saltB64), info: enc(HKDF_INFO) },
    k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/* 合言葉 → 元 */
export async function rootFromPass(pass, saltB64, iter = PBKDF_ITER) {
  const p = String(pass || '');
  if (p.length < PASS_MIN) throw new Error('合言葉は ' + PASS_MIN + ' 字以上にする');
  const s = subtle();
  const base = await s.importKey('raw', enc(p.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter }, base, 256));
}

/* aad = 会社の ID（ほかの会社の箱に写しても開かない） */
export async function sealKey(aes, plain, aad) {
  const iv = randomBytes(12);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc('bubbles-aikey|' + aad) }, aes, enc(String(plain))));
  const p = String(plain);
  return { v: VER, iv: toB64(iv), data: toB64(data), tail: p.slice(-4) };
}
export async function openSealed(aes, sealed, aad) {
  let out;
  try {
    out = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: enc('bubbles-aikey|' + aad) }, aes, fromB64(sealed.data));
  } catch (e) { throw new Error('キーを開けなかった（合言葉が違う・別のパスキーを選んだ）'); }
  return new TextDecoder().decode(out);
}

/* ---- パスキー（押した手の続きで呼ぶ） ---- */
function prfFirst(cred) {
  const ext = cred && typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {};
  const r = ext && ext.prf && ext.prf.results && ext.prf.results.first;
  return r ? new Uint8Array(r) : null;
}
function passkeyError(e) {
  if (e && e.name === 'NotAllowedError') return new Error('パスキーの確認ができなかった（やめた・時間切れ。もう一度押す）');
  return e instanceof Error ? e : new Error(String(e));
}
export async function createLockPasskey(now = new Date()) {
  const z = x => String(x).padStart(2, '0');
  const d = `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())} ${z(now.getHours())}:${z(now.getMinutes())}`;
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Bubbles の AI キー' },
      user: { id: randomBytes(16), name: 'bubbles-aikey-' + d.replace(/[-: ]/g, ''), displayName: 'Bubbles の AI キー（' + d + ' 作成）' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    } });
  } catch (e) { throw passkeyError(e); }
  if (!cred) throw new Error('パスキーを作れなかった');
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || ext.prf.enabled === false) throw new Error('この端末のパスキーは鍵を作る機能（PRF）に対応していない（合言葉で鍵をかける）');
  return { credId: toB64u(new Uint8Array(cred.rawId)), root: prfFirst(cred) };
}
export async function passkeyRootFor(credId) {
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: randomBytes(32),
      allowCredentials: credId ? [{ type: 'public-key', id: fromB64u(credId) }] : [],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_SALT } } },
    } });
  } catch (e) { throw passkeyError(e); }
  const root = prfFirst(cred);
  if (!root) throw new Error('この端末のパスキーは鍵を作る機能（PRF）に対応していない（合言葉で鍵をかけ直す）');
  return root;
}

/* ---- 開いている間の AES 鍵 ---- */
let opened = null;
let openedAt = 0;
export function forget() { opened = null; openedAt = 0; }
export function isOpen(now = Date.now()) { return !!opened && now - openedAt < OPEN_MS; }
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', forget);

/* 錠を開けて AES 鍵を返す。askPass = 合言葉を訊く関数（合言葉の錠のとき）。
   deps は テストで差し替える: { passkeyRoot, now } */
export async function openLock(lock, askPass, deps = {}) {
  const now = (deps.now || Date.now)();
  if (opened && now - openedAt < OPEN_MS) return opened;
  forget();
  if (!lock) throw new Error('キーに鍵がかかっていない');
  let root;
  if (lock.mode === 'passkey') {
    root = await (deps.passkeyRoot || passkeyRootFor)(lock.credId);
  } else {
    const pass = await askPass();
    if (!pass) throw new Error('やめた');
    root = await rootFromPass(pass, lock.salt, deps.iter);
  }
  const aes = await aesFromRoot(root, lock.salt);
  root.fill(0);
  opened = aes; openedAt = now;
  return aes;
}

/* 新しい錠を作り、開いた状態にする。mode = 'passkey' | 'pass' → { lock, aes } */
export async function makeLock(mode, askNewPass, deps = {}) {
  const salt = toB64(randomBytes(16));
  let root, credId;
  if (mode === 'passkey') {
    const made = await (deps.createPasskey || createLockPasskey)();
    credId = made.credId;
    root = made.root || await (deps.passkeyRoot || passkeyRootFor)(credId);
  } else {
    const pass = await askNewPass();
    if (!pass) throw new Error('やめた');
    root = await rootFromPass(pass, salt, deps.iter);
  }
  const lock = mode === 'passkey' ? { v: VER, mode, credId, salt } : { v: VER, mode, salt };
  const aes = await aesFromRoot(root, salt);
  root.fill(0);
  opened = aes; openedAt = (deps.now || Date.now)();
  return { lock, aes };
}
