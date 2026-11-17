/* claude.ai の接続の許可の画面（2026-11-17。server.py の GET /oauth/authorize が出す画面の動き）。
   「パスキーでログインして許可」: 持ち主のパスキーで署名し、/oauth/approve へ送る。通れば戻る先（claude.ai）へ移る。
   「断る」: /oauth/deny へ送り、戻る先へ「断った」を持って移る。
   画面の中の文（相手の名前・戻る先）はサーバーが書く。ここは押したときの動きだけ（CSP で中に書いたスクリプトは動かないため）。
   js/passkey.js を読み込まない: service worker は passkey.js を箱に入れており、前の版に戻している間（rollback）は
   古い passkey.js が来る。この画面はそれに左右されないよう、要る分（署名と base64url）だけをここに持つ。 */

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

/* サーバーの問題（/api/passkey/login/options）に、登録してあるパスキーで署名する → 送る形の credential */
async function signPasskey() {
  if (!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get)) {
    throw new Error('このブラウザはパスキーを使えない');
  }
  const res = await fetch('/api/passkey/login/options', {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (res.status !== 200) throw new Error(WHY[res.status] || ('サーバーが断った（' + res.status + '）'));
  const { publicKey: o } = await res.json();
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: Object.assign({}, o, { challenge: fromB64u(o.challenge) }) });
  } catch (e) {
    if (e && e.name === 'NotAllowedError') throw new Error('ログインをやめた（または時間切れ）');
    if (e && e.name === 'SecurityError') throw new Error('この住所ではパスキーを使えない（https:// の名前の住所で開く）');
    throw e;
  }
  return {
    id: cred.id, type: cred.type,
    response: {
      clientDataJSON: toB64u(cred.response.clientDataJSON), authenticatorData: toB64u(cred.response.authenticatorData),
      signature: toB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? toB64u(cred.response.userHandle) : null,
    },
  };
}

const box = document.getElementById('oauth');
const ok = document.getElementById('ok');
const no = document.getElementById('no');
const msg = document.getElementById('msg');

const WHY = {
  400: '許可の画面の期限（10 分）が切れた。接続を始めたところ（claude.ai）からやり直す',
  401: 'このパスキーは登録されていないか、取り消されている',
  403: 'このパスキーでは許可できない（許可できるのは持ち主の個人に入れるパスキーだけ）',
  429: '失敗が続いたので、しばらく待ってからにする',
};

async function send(path, body) {
  const res = await fetch(path, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 中身が無い */ }
  if (res.status !== 200 || !json || typeof json.redirect !== 'string') {
    throw new Error(WHY[res.status] || ('サーバーが断った（' + res.status + '）'));
  }
  return json.redirect;
}

function busy(on, text) {
  ok.disabled = on;
  no.disabled = on;
  msg.textContent = text || '';
}

if (box && ok && no) {
  const request = box.dataset.request;
  ok.addEventListener('click', async () => {
    busy(true, '');
    try {
      const credential = await signPasskey();
      location.assign(await send('/oauth/approve', { request, credential }));
    } catch (e) {
      busy(false, (e && e.message) || String(e));
    }
  });
  no.addEventListener('click', async () => {
    busy(true, '');
    try {
      location.assign(await send('/oauth/deny', { request }));
    } catch (e) {
      busy(false, (e && e.message) || String(e));
    }
  });
}
