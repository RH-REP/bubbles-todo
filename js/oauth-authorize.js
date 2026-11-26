/* claude.ai の接続の許可の画面（2026-11-17。server.py の GET /oauth/authorize が出す画面の動き）。
   「パスキーでログインして許可」: 持ち主のパスキーで署名し、/oauth/approve へ送る。通れば戻る先（claude.ai）へ移る。
   前もって登録した相手（gantt・diary。data-pre）は、この端末で bubble にログイン済みなら、開いてすぐ通行証で許して戻る（2026-11-18）。
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
    if (e && e.name === 'SecurityError') throw new Error('この URL ではパスキーを使えない（https:// で始まる名前の URL で開く）');
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

async function send(path, body, session) {
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = 'Bearer ' + session;
  const res = await fetch(path, { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body) });
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

/* この端末の bubble のログイン（端末の通行証）。同じ住所のサーバーに向けた、期限内のものだけ（js/sync.js の
   bubble_todo_sync・bubble_todo_sync_<繋ぎ先> の箱。sessionExpires は秒）。無ければ '' */
function deviceSession() {
  const now = Date.now();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^bubble_todo_sync(_[\w.-]+)?$/.test(k)) continue;
      let o = null;
      try { o = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { o = null; }
      if (!o || typeof o !== 'object' || typeof o.session !== 'string' || !o.session) continue;
      if (!(Number(o.sessionExpires) * 1000 > now)) continue;
      let origin = '';
      try { origin = new URL(String(o.url || '')).origin; } catch (e) { origin = ''; }
      if (origin === location.origin) return o.session;
    }
  } catch (e) { /* 読めなければパスキーで */ }
  return '';
}

if (box && ok && no) {
  const request = box.dataset.request;
  /* 前もって登録した相手（gantt・diary）で、この端末が bubble にログイン済みなら、パスキーの操作なしで戻る
     （2026-11-18 取り決め §7.2）。通らなければ（切れた・取り消した）今までどおりパスキーのボタンで */
  const session = box.dataset.pre === '1' ? deviceSession() : '';
  if (session) {
    busy(true, 'bubble のログインで戻る…');
    send('/oauth/approve', { request, session: true }, session)
      .then(url => location.assign(url))
      .catch(() => busy(false, 'この端末のログインが切れていた。パスキーでログインする'));
  }
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
