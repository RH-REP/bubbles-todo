/* サーバーのバックアップ（2026-11-19 ユーザーの指示「能動的なバックアップを追加して」「今の控えにある場所に、サーバーバックアップをリストして、復元機能をつけて」）。
   ログインしている利用者の個人の置き場に、押したときの端末の控え（js/folderbackup.js の buildBackup の形）を預ける。server.py の Snapshots。
     POST <サーバー>/api/snapshots {payload, label, device} → {id, at, label, device, seas, todos}
     GET  <サーバー>/api/snapshots → {snapshots: [...新しい順], keep}
     GET  <サーバー>/api/snapshots/<id> → {…, payload}
   ログインしていなければ使えない（canServerBackup() が false）。fetchFn・login を差し替えて試せる */
import { serverLogin } from './me.js';

export function canServerBackup(login = serverLogin()) { return !!(login && login.url && login.session); }

async function call(method, path, body, { login = serverLogin(), fetchFn = globalThis.fetch } = {}) {
  if (!canServerBackup(login)) throw new Error('サーバーにログインしていない');
  const res = await fetchFn(login.url.replace(/\/$/, '') + path, {
    method,
    cache: 'no-store',
    headers: Object.assign({ Authorization: 'Bearer ' + login.session, 'X-Bubbles-Space': 'me' },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (res.status === 401) throw new Error('ログインが切れている（設定の「海」からログインし直す）');
  if (res.status === 413) throw new Error('大きすぎて保存できない（4MB まで）');
  if (res.status !== 200 || !json) throw new Error('サーバーが断った（' + res.status + '）');
  return json;
}

/* 預ける → 一覧の 1 行の形 */
export function saveServerBackup(payload, label = '', device = '', opts) {
  return call('POST', '/api/snapshots', { payload, label, device }, opts);
}
/* 一覧（新しい順） */
export async function listServerBackups(opts) {
  const j = await call('GET', '/api/snapshots', null, opts);
  return Array.isArray(j.snapshots) ? j.snapshots : [];
}
/* 1 つ（payload つき） */
export async function getServerBackup(id, opts) {
  const j = await call('GET', '/api/snapshots/' + encodeURIComponent(id), null, opts);
  if (!j || !j.payload || typeof j.payload.boxes !== 'object') throw new Error('バックアップが壊れている');
  return j;
}
