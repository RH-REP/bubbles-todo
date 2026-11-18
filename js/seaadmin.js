/* 海の管理と、わたしの端末（2026-11-18 ユーザーの決定「海の管理は作成者が行う」。前は VM だけ。2026-11-16）。
   サーバーの口（server.py の sea_admin・/api/passkey/devices）を、ログインしている端末の通行証で呼ぶ。
   海の口の答えは GET /api/me と同じ形なので、js/me.js の控えに入れる（仲間の名前・役割がすぐ新しくなる）。 */
import { serverLogin, saveMe } from './me.js';

async function call(path, body) {
  const L = serverLogin();
  if (!L || !L.url) throw new Error('サーバーにログインしていない');
  let res;
  try {
    res = await fetch(L.url.replace(/\/$/, '') + path, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + L.session, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (e) { throw new Error('サーバーに届かない'); }
  let json = null;
  try { json = await res.json(); } catch (e) { /* 中身が無い */ }
  if (res.status === 200 && json) return json;
  if (res.status === 401) throw new Error('ログインし直す（通行証の期限切れか、取り消された）');
  if (res.status === 404 && json && json.error === 'sea') throw new Error('この海はもうサーバーに無いか、あなたは仲間でない');
  if (res.status === 404) throw new Error('サーバーがこの操作を知らない（サーバーを新しくする）');
  const err = new Error((json && json.message) || ('できなかった（' + res.status + '）'));
  err.code = json && json.error;
  throw err;
}

/* 海の操作 → /api/me の形（控えも新しくする）。op: create・update・remove・role・kick・transfer・leave */
export async function seaOp(op, body) {
  const me = await call('/api/sea/' + op, body);
  saveMe(me);
  return me;
}

/* わたしの端末 → [{name, created, last_used, current}] */
export async function myDevices() {
  return (await call('/api/passkey/devices', {})).devices || [];
}

/* 端末を外す（今の端末は confirm: true が要る）→ 残りの一覧 */
export async function removeDevice(name, confirm = false) {
  return (await call('/api/passkey/devices/remove', { name, confirm })).devices || [];
}
