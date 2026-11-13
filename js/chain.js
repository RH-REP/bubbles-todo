/* ブロックチェーン（Solana）への控え（2026-11-08 Issue #31。利用者の返事「おすすめで」）。
   DOM は触らない（設定の画面 settings.js が使う。テストは tests/chain.test.mjs）。

   ■ 何をするか
   自分の記録（引っ越しのファイルと同じ中身。ただしサーバーの住所と鍵は入れない）を暗号化して、
   Solana の取引のメモ（Memo プログラム）に分けて書く。新しい端末では、同じ鍵から同じお財布の住所が
   できるので、その住所のいちばん新しい控えを読んで戻す。サーバーは要らない。

   ■ 鍵（すべて 1 つの「元」から作る。元はどこにも保存しない）
   元（32 バイト）… パスキーの PRF（端末の金庫が返す値）か、app が作って見せる合言葉（PBKDF2 60 万回）
     ├ 記録のカギ（AES-256-GCM）  = HKDF(元, "record")
     └ お財布の種（Ed25519）       = HKDF(元, "wallet") → 住所（公開鍵）
   お財布は手数料を払うためだけのもの。小銭（手数料ぶん）だけを入れる。
   復元コード … 記録のカギ＋住所＋ネット（お財布の種は入れない。お金は動かせない）。
   パスキーはページのドメイン（ホスト名）に結び付くので、ドメインが変わったときや OS を替えたときは、復元コードで戻す。

   ■ チェーンの上の形
   メモ 1 つ = "bt1 <控えの ID 8 字> <番号>/<全部の数> <base64 の切れ端>"（UTF-8。Memo は UTF-8 しか受けない）
   全部の切れ端をつなぐと [版 1][印 1][IV 12][暗号文]。印の 1 ビット目 = gzip で縮めた。
   暗号の AAD = "bubbles-chain-v1|<控えの ID>"（ほかの控えの切れ端を混ぜても開かない）。
   切れ端が 1 つでも欠けると戻せない。読むときは、いちばん新しく全部そろった控えを使う。

   ■ 窓口（RPC）
   公式の公開 RPC だけ（テスト用 = devnet、本番 = mainnet）。送り先はこの 2 つに決め打ちで、
   サーバーなし版（noserver.html）の CSP の connect-src にも同じものだけを書く。
   混んで断られたら（429）少し待ってやり直す。

   ■ 署名
   ブラウザの WebCrypto の Ed25519 だけで書く（外の部品を読み込まない）。古いブラウザで使えなければ、
   そう言って止まる。取引は「手数料を払う 1 人＋計算の上限＋ Memo 1 つ」の古い形（legacy）を自分で組む。 */

export const NETWORKS = {
  devnet: { label: 'テスト用（devnet・無料・消えることがある）', rpc: 'https://api.devnet.solana.com', code: 0 },
  mainnet: { label: '本番（mainnet・公式 RPC・手数料が要る）', rpc: 'https://api.mainnet-beta.solana.com', code: 1 },
};
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const TAG = 'bt1';
/* 共有の海の掲示板に書く記録の写し・名簿（js/board.js。2026-11-11 Issue #37）。形は bt1 と同じで、頭と暗号の AAD だけが違う */
export const BOARD_TAG = 'bt2';
const BOARD_SALT = 'bubbles-board-v1';
export const CHUNK = 500;          /* 1 つのメモに入れる base64 の字数（取引 1 件 1232 バイトの内に余裕を持って収め、計算も軽くする） */
export const MAX_TX = 60;          /* これより多くの取引に分かれるなら書かない（ファイルの引っ越しを使ってもらう） */
export const FEE_LAMPORTS = 5000;  /* 署名 1 つの手数料（目安） */
export const LAMPORTS = 1e9;       /* 1 SOL */
export const PBKDF_ITER = 600000;
const VER = 1;
const SALT = 'bubbles-chain-v1';
/* パスキーの PRF に渡す値。押した手の続きで create/get を呼ぶ必要がある（iPhone）ので、await せずに作れる定数にする */
export const PRF_SALT = new TextEncoder().encode('bubbles-chain-v1-prf-salt-000000');
const PKCS8_ED25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

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
const enc = s => new TextEncoder().encode(s);

export function toB64(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function toB64u(bytes) { return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function fromB64u(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(s + '='.repeat((4 - s.length % 4) % 4));
}

/* ---- base58（Solana の住所・取引の ID・ブロックハッシュ） ---- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58encode(bytes) {
  const b = new Uint8Array(bytes);
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < b.length; i++) {
    let carry = b[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let s = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
  return s;
}
export function b58decode(str) {
  const s = String(str || '');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes = [];
  for (let i = zeros; i < s.length; i++) {
    const v = B58.indexOf(s[i]);
    if (v < 0) throw new Error('base58 の字ではない');
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
  return out;
}

/* ---- 鍵 ---- */

/* 合言葉 → 元（32 バイト）。合言葉は movefile.js の makePassphrase で app が作る（120 ビット） */
export async function rootFromPassphrase(pass, iter = PBKDF_ITER) {
  const norm = String(pass || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (norm.length < 16) throw new Error('合言葉が短い');
  const s = subtle();
  const base = await s.importKey('raw', enc(norm), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc(SALT), iterations: iter }, base, 256));
}

async function hkdf(root, info) {
  const s = subtle();
  const k = await s.importKey('raw', root, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc(SALT), info: enc(info) }, k, 256));
}

/* 種（32 バイト）→ { address, publicKey, sign(bytes) }。Ed25519 が使えないブラウザでは Error */
export async function walletFromSeed(seed) {
  const s = subtle();
  let key;
  try {
    key = await s.importKey('pkcs8', concat([Uint8Array.from(PKCS8_ED25519), seed]), { name: 'Ed25519' }, true, ['sign']);
  } catch (e) {
    throw new Error('このブラウザは Ed25519 の署名に対応していない（ブラウザを新しくする）');
  }
  const jwk = await s.exportKey('jwk', key);
  const publicKey = fromB64u(jwk.x);
  return {
    publicKey,
    address: b58encode(publicKey),
    sign: async (msg) => new Uint8Array(await s.sign({ name: 'Ed25519' }, key, msg)),
  };
}

/* 元 → { recordKey（32 バイト）, wallet, shareSeed }。
   shareSeed は共有用のアドレス（X25519。js/board.js）の種。ウォレットと同じく元から毎回同じものができる */
export async function keysFromRoot(root) {
  if (!root || root.length !== 32) throw new Error('鍵の元が正しくない');
  const recordKey = await hkdf(root, 'record');
  const wallet = await walletFromSeed(await hkdf(root, 'wallet'));
  const shareSeed = await hkdf(root, 'share');
  return { recordKey, wallet, shareSeed };
}

/* ---- 復元コード（記録のカギ＋住所＋ネット。お金は動かせない） ---- */
async function sha256(bytes) { return new Uint8Array(await subtle().digest('SHA-256', bytes)); }

export async function makeRecoveryCode(recordKey, publicKey, network) {
  const net = NETWORKS[network];
  if (!net) throw new Error('ネットが正しくない');
  const body = concat([Uint8Array.of(VER, net.code), recordKey, publicKey]);
  const sum = (await sha256(body)).subarray(0, 4);
  const s = b58encode(concat([body, sum]));
  return 'BT1-' + s.match(/.{1,6}/g).join('-');
}

export async function readRecoveryCode(code) {
  const raw = String(code || '').replace(/\s/g, '').replace(/^BT1-?/i, '').replace(/-/g, '');
  let b;
  try { b = b58decode(raw); } catch (e) { throw new Error('復元コードの字が違う'); }
  if (b.length !== 2 + 32 + 32 + 4) throw new Error('復元コードの長さが違う（打ち間違い？）');
  const body = b.subarray(0, 66), sum = b.subarray(66);
  const want = (await sha256(body)).subarray(0, 4);
  if (want.some((x, i) => x !== sum[i])) throw new Error('復元コードが違う（打ち間違い？）');
  if (body[0] !== VER) throw new Error('この app より新しい版の復元コード');
  const network = Object.keys(NETWORKS).find(k => NETWORKS[k].code === body[1]);
  if (!network) throw new Error('復元コードのネットが分からない');
  const publicKey = body.slice(34, 66);
  return { network, recordKey: body.slice(2, 34), publicKey, address: b58encode(publicKey) };
}

/* ---- 暗号と切れ端 ---- */
async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const cs = new CompressionStream('gzip');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}
async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('このブラウザは縮めたバックアップを開けない');
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

export function newBackupId() {
  return Array.from(randomBytes(4), x => x.toString(16).padStart(2, '0')).join('');
}

/* 暗号の AAD。bt1（自分のバックアップ）と bt2（共有の海の掲示板）で分ける（片方の切れ端をもう片方として開かせない） */
const aadOf = (tag, id) => enc((tag === BOARD_TAG ? BOARD_SALT : SALT) + '|' + id);
const MEMO_RE = {};
function memoRe(tag) {
  if (!MEMO_RE[tag]) MEMO_RE[tag] = new RegExp('(?:^|\\s|\\])' + tag + ' ([0-9a-f]{8}) (\\d+)\\/(\\d+) ([A-Za-z0-9+/=]+)');
  return MEMO_RE[tag];
}

/* 中身（オブジェクト）→ メモの文の並び。tag は bt1（バックアップ）か bt2（掲示板） */
export async function sealToMemos(payload, recordKey, id = newBackupId(), tag = TAG) {
  const plain = enc(JSON.stringify(payload));
  const z = await gzip(plain);
  const flags = z ? 1 : 0;
  const s = subtle();
  const key = await s.importKey('raw', recordKey, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(tag, id) }, key, z || plain));
  const b64 = toB64(concat([Uint8Array.of(VER, flags), iv, ct]));
  const parts = b64.match(new RegExp('.{1,' + CHUNK + '}', 'g')) || [''];
  return parts.map((p, i) => `${tag} ${id} ${i + 1}/${parts.length} ${p}`);
}

/* メモの文 → { id, i, n, part }。この app の控え（tag の形）でなければ null */
export function parseMemo(text, tag = TAG) {
  const m = memoRe(tag).exec(String(text || ''));
  if (!m) return null;
  const i = Number(m[2]), n = Number(m[3]);
  if (!(i >= 1 && n >= 1 && i <= n && n <= 1000)) return null;
  return { id: m[1], i, n, part: m[4] };
}

/* 切れ端のまとまり（同じ ID・全部そろった）→ 中身 */
export async function openMemos(parts, recordKey, tag = TAG) {
  if (!parts.length) throw new Error('バックアップが無い');
  const id = parts[0].id, n = parts[0].n;
  const byI = new Map();
  parts.forEach(p => { if (p.id === id) byI.set(p.i, p.part); });
  for (let i = 1; i <= n; i++) if (!byI.has(i)) throw new Error('バックアップの切れ端が欠けている（' + i + '/' + n + '）');
  let b64 = '';
  for (let i = 1; i <= n; i++) b64 += byI.get(i);
  const all = fromB64(b64);
  if (all[0] !== VER) throw new Error('この app より新しい版のバックアップ');
  const flags = all[1], iv = all.subarray(2, 14), ct = all.subarray(14);
  const s = subtle();
  const key = await s.importKey('raw', recordKey, 'AES-GCM', false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv, additionalData: aadOf(tag, id) }, key, ct));
  } catch (e) { throw new Error('バックアップを開けない（鍵が違うか、バックアップが壊れている）'); }
  if (flags & 1) plain = await gunzip(plain);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* 新しい順に並んだメモの文 → いちばん新しく全部そろった控えの切れ端（無ければ null） */
export function pickLatest(memosNewestFirst) {
  const groups = new Map();   /* 出てきた順 = 新しい順 */
  memosNewestFirst.forEach(t => {
    const p = typeof t === 'string' ? parseMemo(t) : t;
    if (!p) return;
    if (!groups.has(p.id)) groups.set(p.id, { n: p.n, parts: new Map() });
    const g = groups.get(p.id);
    if (g.n === p.n) g.parts.set(p.i, p);
  });
  for (const g of groups.values()) {
    if (g.parts.size === g.n) return Array.from(g.parts.values()).sort((a, b) => a.i - b.i);
  }
  return null;
}

/* ---- 取引を組む（legacy。手数料を払う 1 人＋計算の上限＋ Memo 1 つ。どちらの命令にも口座は渡さない） ---- */
export function shortvec(n) {
  const out = [];
  let v = n;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if (v === 0) { out.push(b); break; }
    out.push(b | 0x80);
  }
  return Uint8Array.from(out);
}

/* 計算の上限（Issue #31 の返事: 600 字のメモで「Program failed to complete」）。
   Memo プログラムはメモの字数に比例して計算を使い、命令 1 つに既定で付く上限（20 万）を数百字で超える。
   先頭に ComputeBudget の SetComputeUnitLimit（判別子 2・u32 LE）を置いて上限を上げる。
   計算の単価（SetComputeUnitPrice）は付けないので、手数料は署名ぶん（5,000 lamports）のまま */
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const COMPUTE_UNITS = 1000000;

/* extra … 取引に載せるだけの口座（読むだけ・署名しない。どの命令にも渡さない）。
   共有の海の掲示板のアドレスや、招待の宛先のウォレットを載せ、その口座の取引の一覧（getSignaturesForAddress）に出す。
   Memo プログラムに渡す口座は署名者でなければならないので、命令には渡さず、口座の並びに置くだけにする */
export function memoMessage(payer, blockhash, memoText, units = COMPUTE_UNITS, extra = []) {
  const data = enc(memoText);
  const limit = Uint8Array.of(2, units & 0xff, (units >> 8) & 0xff, (units >> 16) & 0xff, (units >>> 24) & 0xff);
  const ex = (extra || []).map(k => (typeof k === 'string' ? b58decode(k) : k));
  ex.forEach(k => { if (k.length !== 32) throw new Error('載せる口座の形が違う'); });
  const cb = 1 + ex.length, memo = 2 + ex.length;
  return concat([
    Uint8Array.of(1, 0, 2 + ex.length),  /* 署名 1・読むだけの署名者 0・読むだけの署名しない口座（載せるだけの口座・ComputeBudget・Memo） */
    shortvec(3 + ex.length), payer, ...ex, b58decode(COMPUTE_BUDGET_PROGRAM), b58decode(MEMO_PROGRAM),
    blockhash,
    shortvec(2),                      /* 命令 2 つ */
    Uint8Array.of(cb), shortvec(0),   /* ComputeBudget・口座なし */
    shortvec(limit.length), limit,
    Uint8Array.of(memo), shortvec(0), /* Memo・口座なし */
    shortvec(data.length), data,
  ]);
}

/* 組んだメッセージ（memoMessage の形）からメモの文を読む（テストと、取引を読み直すときの確かめ用） */
export function memoFromMessage(msg) {
  let o = 0;
  const vec = () => { let v = 0, s = 0, b; do { b = msg[o++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
  o = 3;
  const nKeys = vec();
  const keys = [];
  for (let i = 0; i < nKeys; i++) { keys.push(b58encode(msg.subarray(o, o + 32))); o += 32; }
  o += 32;   /* ブロックハッシュ */
  const nIns = vec();
  for (let k = 0; k < nIns; k++) {
    const prog = msg[o++];
    const nAcc = vec();
    o += nAcc;
    const len = vec();
    const data = msg.subarray(o, o + len);
    o += len;
    if (keys[prog] === MEMO_PROGRAM) return new TextDecoder().decode(data);
  }
  return null;
}

export async function memoTransaction(wallet, blockhash, memoText, extra = []) {
  const msg = memoMessage(wallet.publicKey, blockhash, memoText, COMPUTE_UNITS, extra);
  const sig = await wallet.sign(msg);
  const tx = concat([shortvec(1), sig, msg]);
  if (tx.length > 1232) throw new Error('取引が大きすぎる（' + tx.length + ' バイト）');
  return { tx, signature: b58encode(sig) };
}

/* ---- 残高をほかの住所へ移す（2026-11-09 Issue #31 の返事） ----
   このお財布は鍵の元（パスキー・合言葉）からしか作れず、ほかのウォレットに読み込めない。
   パスキーを替える・合言葉に替える・やめるときに、残った SOL を新しいお財布や自分のウォレットへ全部移す。
   取引は System プログラムの Transfer（判別子 2・u32 LE ＋ 額 u64 LE）1 つ。全部移すとお財布は 0 になり閉じる（最低の額は要らない）。 */
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/* Solana の住所の形か（base58 で 32 バイト）。曲線の上にあるかまでは見ない */
export function isAddress(s) {
  const t = String(s || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return false;
  try { return b58decode(t).length === 32; } catch (e) { return false; }
}

export function transferMessage(from, to, blockhash, lamports) {
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true);
  dv.setBigUint64(4, BigInt(lamports), true);
  return concat([
    Uint8Array.of(1, 0, 1),           /* 署名 1・読むだけの署名者 0・読むだけの署名しない口座 1（System） */
    shortvec(3), from, to, b58decode(SYSTEM_PROGRAM),
    blockhash,
    shortvec(1),
    Uint8Array.of(2), shortvec(2), Uint8Array.of(0, 1),   /* System（口座の 2 番目）・口座 [送る側, 受ける側] */
    shortvec(data.length), data,
  ]);
}

/* 移す前の見積もり → { balance, fee, amount, destBalance, rent }。移せないときは Error */
export async function planSweep(network, fromAddress, toAddress, opt) {
  if (!isAddress(toAddress)) throw new Error('送り先のアドレスの形が違う（Solana のアドレスを貼る）');
  if (String(toAddress).trim() === fromAddress) throw new Error('送り先がこのウォレットと同じ');
  const [balance, destBalance, rentRaw] = await Promise.all([
    getBalance(network, fromAddress, opt),
    getBalance(network, String(toAddress).trim(), opt),
    rpc(network, 'getMinimumBalanceForRentExemption', [0], opt),
  ]);
  const rent = Number(rentRaw) || 890880;
  const fee = FEE_LAMPORTS;
  const amount = balance - fee;
  if (amount <= 0) throw new Error('移せる残高が無い（残高 ' + solText(balance) + '）');
  /* 空の住所へは、最低の額より少なく送れない（チェーンが断る） */
  if (destBalance === 0 && amount < rent) {
    throw new Error('送り先がまだ空で、送れる額（' + solText(amount) + '）が最低の額（' + solText(rent) + '）より少ない');
  }
  return { balance, fee, amount, destBalance, rent };
}

/* 全部移す。戻り値 取引の ID */
export async function sweep(network, wallet, toAddress, amount, opt) {
  const r = await rpc(network, 'getLatestBlockhash', [{ commitment: 'confirmed' }], opt);
  const msg = transferMessage(wallet.publicKey, b58decode(String(toAddress).trim()), b58decode(r.value.blockhash), amount);
  const sig = await wallet.sign(msg);
  const tx = concat([shortvec(1), sig, msg]);
  const id = await rpc(network, 'sendTransaction', [toB64(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }], opt);
  await waitConfirmed(network, [id], opt);
  return id;
}

/* ---- 窓口（RPC） ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function rpc(network, method, params, { fetchFn = globalThis.fetch, tries = 4, wait = 1500 } = {}) {
  const net = NETWORKS[network];
  if (!net) throw new Error('ネットが正しくない');
  let last = null;
  for (let k = 0; k < tries; k++) {
    if (k) await sleep(wait * k);
    let res;
    try {
      res = await fetchFn(net.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (e) { last = new Error('窓口に繋がらない'); continue; }
    if (res.status === 429 || res.status >= 500) { last = new Error('窓口が混んでいる（少し待ってやり直す）'); continue; }
    if (!res.ok) {
      const err = new Error('窓口の返事が ' + res.status);
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    if (j && j.error) {
      const m = String(j.error.message || '');
      if (/rate|too many/i.test(m)) { last = new Error('窓口が混んでいる（少し待ってやり直す）'); continue; }
      if (/simulation failed/i.test(m)) {
        /* 送る前の試し（preflight）で断られた。取引はチェーンに載っていないので、手数料は掛かっていない */
        throw new Error('書く前の試しで断られた（手数料は掛かっていない）: ' + m);
      }
      throw new Error('窓口が断った: ' + m);
    }
    return j.result;
  }
  throw last || new Error('窓口に繋がらない');
}

export async function getBalance(network, address, opt) {
  const r = await rpc(network, 'getBalance', [address, { commitment: 'confirmed' }], opt);
  return Number(r && r.value) || 0;
}

/* テスト用の SOL を窓口に頼む（Issue #31 の返事: 410 が出る）。
   公式の公開 RPC の配りは、混み具合や悪用の対策で止められていることがある（410 Gone・429 など）。
   そのときは、公式の配り場（Web のページ）で住所に送ってもらう。app からそのページへは通信しない（人が開く）。
   頼む額は小さくする（0.1 SOL でも、控えの取引 1 万件ぶん以上の手数料と残しておく額に足りる）。 */
export const FAUCET_URL = 'https://faucet.solana.com/';
export const AIRDROP_LAMPORTS = LAMPORTS / 10;
export async function requestAirdrop(network, address, opt) {
  if (network !== 'devnet') throw new Error('テスト用の SOL はテスト用のネットでだけもらえる');
  try {
    return await rpc(network, 'requestAirdrop', [address, AIRDROP_LAMPORTS], opt);
  } catch (e) {
    if (e && (e.status === 410 || e.status === 403)) {
      throw new Error('この窓口はいまテスト用の SOL を配っていない（' + e.status + '）');
    }
    if (e && /混んでいる|airdrop|limit|faucet/i.test(String(e.message))) {
      throw new Error('テスト用の SOL を配る回数の上限に当たった');
    }
    throw e;
  }
}

/* 書くのに要る額の目安（lamports）。手数料＋お財布に残す最低の額 */
export async function needLamports(network, count, opt) {
  const rent = Number(await rpc(network, 'getMinimumBalanceForRentExemption', [0], opt)) || 890880;
  return { fee: count * FEE_LAMPORTS, rent };
}

/* メモの並びを書く。onStep(済んだ数, 全部) で進み具合を返す。戻り値 取引の ID の並び */
export async function writeMemos(network, wallet, memos, { onStep = () => {}, gap = 400, opt, extra = [] } = {}) {
  const sigs = [];
  let bh = null, bhAt = 0;
  for (let i = 0; i < memos.length; i++) {
    if (!bh || Date.now() - bhAt > 30000) {
      const r = await rpc(network, 'getLatestBlockhash', [{ commitment: 'confirmed' }], opt);
      bh = b58decode(r.value.blockhash);
      bhAt = Date.now();
    }
    const { tx } = await memoTransaction(wallet, bh, memos[i], extra);
    const sig = await rpc(network, 'sendTransaction', [toB64(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }], opt);
    sigs.push(sig);
    onStep(i + 1, memos.length);
    if (gap && i + 1 < memos.length) await sleep(gap);
  }
  await waitConfirmed(network, sigs, opt);
  return sigs;
}

export async function waitConfirmed(network, sigs, opt, { limitMs = 90000, every = 2000 } = {}) {
  const until = Date.now() + limitMs;
  for (;;) {
    const r = await rpc(network, 'getSignatureStatuses', [sigs], opt);
    const vals = (r && r.value) || [];
    const bad = vals.find(v => v && v.err);
    if (bad) throw new Error('書けなかった取引がある（もう一度書く）');
    const ok = vals.filter(v => v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')).length;
    if (ok === sigs.length) return;
    if (Date.now() > until) throw new Error('書いた取引の確認が終わらない（あとで「バックアップから復元」で確かめる）');
    await sleep(every);
  }
}

/* 取引 1 件のメモの文を読む（getSignaturesForAddress の memo が読めないときの予備） */
async function memoOfTx(network, sig, opt) {
  const r = await rpc(network, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }], opt);
  const m = r && r.transaction && r.transaction.message;
  if (!m) return null;
  const keys = m.accountKeys || [];
  for (const ins of m.instructions || []) {
    if (keys[ins.programIdIndex] === MEMO_PROGRAM) {
      try { return new TextDecoder().decode(b58decode(ins.data)); } catch (e) { return null; }
    }
  }
  return null;
}

/* 住所のいちばん新しく全部そろった控えの切れ端。無ければ null */
export async function readLatestMemos(network, address, { limit = 200, opt } = {}) {
  const list = await rpc(network, 'getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }], opt) || [];
  const memos = [];
  for (const it of list) {
    if (!it || it.err) continue;
    let p = parseMemo(it.memo);
    if (!p && it.memo == null) continue;   /* メモの無い取引（お金を受け取った、など） */
    /* 共有の海の掲示板へ書いた取引・届いた招待（Issue #37）。このウォレットの一覧にも出るが、バックアップではない */
    if (!p && /(?:^|\s|\])bt2e? /.test(String(it.memo))) continue;
    if (!p) p = parseMemo(await memoOfTx(network, it.signature, opt));
    if (p) memos.push(p);
    const got = pickLatest(memos);
    if (got && got[0].id === memos[0].id) return got;   /* いちばん新しい控えがそろった */
  }
  return pickLatest(memos);
}

/* いちばん新しく全部そろった控えの ID だけ（鍵は要らない。取引の一覧を 1 回尋ねるだけで、1 件ずつの取引は読まない）。
   無ければ null。ほかの端末が新しく書いたかを見るため（2026-11-13 Issue #52 の R1。js/chainwatch.js） */
export async function latestBackupId(network, address, { limit = 60, opt } = {}) {
  const list = await rpc(network, 'getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }], opt) || [];
  const memos = [];
  list.forEach(it => {
    if (!it || it.err || it.memo == null) return;
    const p = parseMemo(it.memo);
    if (p) memos.push(p);
  });
  const got = pickLatest(memos);
  return got ? got[0].id : null;
}

/* アドレスの新しい取引のメモの文 → [{ signature, text }]（新しい順。メモの無い取引・失敗した取引は除く）。
   共有の海の掲示板と招待（js/board.js）が使う。text は窓口の memo 欄のまま（"[長さ] 文" の形） */
export async function readMemos(network, address, { limit = 200, opt } = {}) {
  const list = await rpc(network, 'getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }], opt) || [];
  const out = [];
  list.forEach(it => {
    if (!it || it.err || it.memo == null) return;
    out.push({ signature: it.signature, text: String(it.memo) });
  });
  return out;
}

/* ---- パスキーの PRF で元を作る（押した手の続きで呼ぶ） ---- */
/* Android の app（Capacitor）では使わない（2026-11-11 Issue #38 の A 案）。ページが https://localhost なので、
   パスキーを作れてもブラウザの版（github.io）とは別物になり、WebView は既定でパスキーを扱わない。
   ネイティブの部品（Credential Manager）と、ドメインに置く assetlinks.json が要るので、今は合言葉だけにする */
export function inNativeApp(g = typeof window !== 'undefined' ? window : null) {
  const C = g && g.Capacitor;
  if (!C) return false;
  return typeof C.isNativePlatform === 'function' ? !!C.isNativePlatform() : true;
}
export function prfSupported() {
  if (inNativeApp()) return false;
  return !!(typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials);
}

function prfFirst(cred) {
  const ext = cred && typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {};
  const r = ext && ext.prf && ext.prf.results && ext.prf.results.first;
  return r ? new Uint8Array(r) : null;
}

/* パスキーの名前（Issue #31 の返事: 複数作ると、選ぶ画面で同じ名前が並んで見分けられない）。作った日時を入れる */
export function passkeyLabel(now = new Date()) {
  const z = x => String(x).padStart(2, '0');
  const d = `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())} ${z(now.getHours())}:${z(now.getMinutes())}`;
  return { name: 'bubbles-backup-' + d.replace(/[-: ]/g, ''), displayName: 'Bubbles の控え（' + d + ' 作成）' };
}

/* 新しいパスキーを作る → { credId, root }（root は作ったときに返らない端末では null。続けて passkeyRoot を呼ぶ） */
export async function createPasskey() {
  const label = passkeyLabel();
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Bubbles の控え' },
    user: { id: randomBytes(16), name: label.name, displayName: label.displayName },
    challenge: randomBytes(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  if (!cred) throw new Error('パスキーを作れなかった');
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || ext.prf.enabled === false) {
    throw new Error('この端末のパスキーは鍵を作る機能（PRF）に対応していない（合言葉で始める）');
  }
  return { credId: toB64u(cred.rawId), root: prfFirst(cred) };
}

/* パスキーで元を作る。credId を渡さなければ、端末にあるこの app のパスキーから選ばせる → { credId, root } */
export async function passkeyRoot(credId) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: randomBytes(32),
    allowCredentials: credId ? [{ type: 'public-key', id: fromB64u(credId) }] : [],
    userVerification: 'required',
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  const root = prfFirst(cred);
  if (!root) throw new Error('この端末のパスキーは鍵を作る機能（PRF）に対応していない（合言葉か復元コードを使う）');
  return { credId: toB64u(cred.rawId), root };
}

/* ---- この端末に置く設定（秘密は置かない: ネット・やり方・パスキーの ID・住所・最後に書いた時） ---- */
export const CONFIG_KEY = 'bubble_todo_chain_v1';
export function loadConfig(storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage.getItem(CONFIG_KEY) || 'null');
    if (c && typeof c === 'object') return Object.assign({ network: 'devnet' }, c);
  } catch (e) { /* 壊れていれば無いことにする */ }
  return { network: 'devnet' };
}
export function saveConfig(c, storage = globalThis.localStorage) {
  const keep = {};
  /* seenId: この端末で最後に読み込んだ控えの ID（Issue #52。秘密ではない） */
  ['network', 'mode', 'credId', 'address', 'lastAt', 'lastId', 'lastCount', 'share', 'seenId'].forEach(k => { if (c[k] != null) keep[k] = c[k]; });
  storage.setItem(CONFIG_KEY, JSON.stringify(keep));
}

/* ---- 鍵の移し替え（2026-11-11 Issue #39。#31 の2段目） ----
   パスキー ↔ 合言葉（またはパスキー → 別のパスキー）を替えると別のウォレットになる。これを3段で案内する:
     1. 新しい鍵を作る  2. 前のウォレットの残高を新しいアドレスへ送る  3. 記録を新しいウォレットにバックアップする
   途中でやめても、どこまで済んだかをこの端末に残して見せる。置くのは設定と同じく秘密でないものだけ
   （ネット・前と新しいやり方・パスキーの ID・アドレス・送った額と取引の ID・保存した控えの ID と件数・時刻）。
   合言葉・元・鍵は置かない（段ごとに、その段で要る鍵をもう一度出してもらう）。 */
export const MOVE_KEY = 'bubble_todo_chain_move_v1';
const keepSide = s => (s && typeof s === 'object')
  ? { mode: s.mode === 'passkey' ? 'passkey' : 'pass', credId: s.credId || null, address: s.address || null } : null;
export function loadMove(storage = globalThis.localStorage) {
  try {
    const m = JSON.parse(storage.getItem(MOVE_KEY) || 'null');
    if (m && typeof m === 'object' && m.from && m.from.address) return cleanMove(m);
  } catch (e) { /* 壊れていれば無いことにする */ }
  return null;
}
function cleanMove(m) {
  const out = { network: m.network in NETWORKS ? m.network : 'devnet', from: keepSide(m.from), to: keepSide(m.to),
    sent: null, backup: null, startedAt: Number(m.startedAt) || null };
  if (m.sent && typeof m.sent === 'object') {
    out.sent = { amount: Number(m.sent.amount) || 0, tx: m.sent.tx ? String(m.sent.tx) : null,
      skipped: !!m.sent.skipped, at: Number(m.sent.at) || null };
  }
  if (m.backup && typeof m.backup === 'object') {
    out.backup = { id: m.backup.id ? String(m.backup.id) : null, count: Number(m.backup.count) || 0,
      skipped: !!m.backup.skipped, at: Number(m.backup.at) || null };
  }
  return out;
}
export function saveMove(m, storage = globalThis.localStorage) {
  storage.setItem(MOVE_KEY, JSON.stringify(cleanMove(m)));
}
export function clearMove(storage = globalThis.localStorage) {
  try { storage.removeItem(MOVE_KEY); } catch (e) { /* 消せなくても進む */ }
}
/* いまの段 → 'key' | 'send' | 'backup' | 'done' */
export function moveStep(m) {
  if (!m) return null;
  if (!m.to || !m.to.address) return 'key';
  if (!m.sent) return 'send';
  if (!m.backup) return 'backup';
  return 'done';
}
/* 段の一覧（画面に出す） → [{ n, label, state: 'done' | 'next' | 'todo', detail }] */
export function moveSteps(m, fmtTime = t => new Date(t).toLocaleString()) {
  const cur = moveStep(m);
  const order = ['key', 'send', 'backup'];
  const at = order.indexOf(cur);
  const state = i => (cur === 'done' || i < at) ? 'done' : (i === at ? 'next' : 'todo');
  const kind = s => (s && s.mode === 'passkey') ? 'パスキー' : '合言葉';
  const steps = [
    { n: 1, label: '新しい鍵を作る', detail: '' },
    { n: 2, label: '前のウォレットの残高を新しいアドレスへ送る', detail: '' },
    { n: 3, label: '記録を新しいウォレットにバックアップする', detail: '' },
  ];
  if (m && m.to && m.to.address) steps[0].detail = kind(m.to) + '・アドレス ' + m.to.address;
  else if (m && m.to && m.to.credId) steps[0].detail = 'パスキーは作れた。鍵を出すところが残っている';
  if (m && m.sent) {
    steps[1].detail = m.sent.skipped ? '送らずに進めた'
      : solText(m.sent.amount) + ' を送った' + (m.sent.at ? '（' + fmtTime(m.sent.at) + '）' : '');
  }
  if (m && m.backup) {
    steps[2].detail = m.backup.skipped ? '保存せずに切り替えた'
      : '取引 ' + m.backup.count + ' 件で保存した' + (m.backup.at ? '（' + fmtTime(m.backup.at) + '）' : '');
  }
  return steps.map((s, i) => Object.assign(s, { state: state(i) }));
}

export function solText(lamports) {
  return (Number(lamports) / LAMPORTS).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') + ' SOL';
}
