/* パスキーで入る（2026-10-24。公開したサーバー（server.py --auth passkey）に使う。開発版）。

   登録: 持ち主がサーバーで作った招待コードを入れて「この端末を登録」。端末が鍵の組を作り、
         公開鍵だけをサーバーへ送る（秘密の鍵は端末の安全な領域から出ない。Face ID・指紋・PIN で守られる）。
   入場: 「パスキーで入る」。サーバーの出す問題に端末が署名し、サーバーが公開鍵で確かめる。
   どちらも通ると、サーバーが通行証（期限 30 日）を返す。sync.js がそれで記録を合わせる。

   使えるのは https:// の名前の住所（と開発用の localhost）だけ。パスキーは名前に結び付くので、
   住所の名前が変わると登録し直しになる。 */

export function passkeySupported() {
  return !!(typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials
    && typeof navigator.credentials.create === 'function');
}

function toB64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/* 画面に出す字。サーバーは理由を言わない（401・429 だけ）ので、ここで言い分ける */
const WHY = {
  401: { register: '招待コードが違うか、もう使われているか、期限が切れている', login: 'この端末のパスキーは登録されていないか、取り消されている' },
  429: { register: '失敗が続いたので、しばらく待ってからにする', login: '失敗が続いたので、しばらく待ってからにする' },
};

async function post(base, path, body, kind) {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), cache: 'no-store',
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 中身が無い */ }
  if (res.status !== 200 || !json) {
    const why = (WHY[res.status] || {})[kind];
    throw new Error(why || ('サーバーが断った（' + res.status + '）。公開の形（--auth passkey）で動いているか'));
  }
  return json;
}

/* 端末の操作をやめた・時間切れのときの字（ブラウザの英語の字を出さない） */
function friendly(e, kind) {
  if (e && e.name === 'NotAllowedError') return new Error(kind === 'register' ? '登録をやめた（または時間切れ）' : '入るのをやめた（または時間切れ）');
  if (e && e.name === 'InvalidStateError') return new Error('この端末は、もう登録してある');
  if (e && e.name === 'SecurityError') return new Error('この住所ではパスキーを使えない（https:// の名前の住所で開く）');
  return e instanceof Error ? e : new Error(String(e));
}

/* 招待コードで、この端末のパスキーを登録する → {session, expires, spaces, name} */
export async function registerPasskey(base, invite) {
  if (!passkeySupported()) throw new Error('このブラウザはパスキーを使えない');
  const { publicKey: o } = await post(base, '/api/passkey/register/options', { invite }, 'register');
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: Object.assign({}, o, {
      challenge: fromB64u(o.challenge),
      user: Object.assign({}, o.user, { id: fromB64u(o.user.id) }),
      excludeCredentials: [],
    }) });
  } catch (e) { throw friendly(e, 'register'); }
  return post(base, '/api/passkey/register', { credential: {
    id: cred.id, type: cred.type,
    response: { clientDataJSON: toB64u(cred.response.clientDataJSON), attestationObject: toB64u(cred.response.attestationObject) },
  } }, 'register');
}

/* 登録してあるパスキーで入る → {session, expires, spaces, name} */
export async function loginPasskey(base) {
  if (!passkeySupported()) throw new Error('このブラウザはパスキーを使えない');
  const { publicKey: o } = await post(base, '/api/passkey/login/options', {}, 'login');
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: Object.assign({}, o, { challenge: fromB64u(o.challenge) }) });
  } catch (e) { throw friendly(e, 'login'); }
  return post(base, '/api/passkey/login', { credential: {
    id: cred.id, type: cred.type,
    response: {
      clientDataJSON: toB64u(cred.response.clientDataJSON), authenticatorData: toB64u(cred.response.authenticatorData),
      signature: toB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? toB64u(cred.response.userHandle) : null,
    },
  } }, 'login');
}

/* サーバーの入場の形（'token' | 'passkey'）。分からなければ null */
export async function authMode(base) {
  try {
    const res = await fetch(base + '/api/auth', { cache: 'no-store' });
    const j = await res.json();
    return j && (j.mode === 'passkey' || j.mode === 'token') ? j.mode : null;
  } catch (e) { return null; }
}

export async function logoutPasskey(base, session) {
  try {
    await fetch(base + '/api/passkey/logout', {
      method: 'POST', headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' }, body: '{}',
    });
  } catch (e) { /* 届かなくても、端末の側は通行証を捨てる */ }
}
