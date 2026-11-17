/* ログインしている利用者と、入れる海の仲間（2026-11-18 ユーザーの決定。取り決め v1.2）。

   サーバーの GET /api/me の答え {user:{id,name}, seas:[{id,name,kind,role,color,members?}]} を、
   この端末の localStorage（ME_KEY）に控える。開くたびに取り直す（app.js と、設定の「海」でログインしたとき）。
   控えは「誰がログインしているか」と「共有の海の仲間の名前」を出すためだけ。入れるかどうかはサーバーが決める。

   記録の 3 つの欄（共有の記録 v1.2 §3。どれも利用者の番号か null）:
     assignee（担当）・added_by（足した人）・done_by（終えた人）
   書くのは、サーバーの海を開いていて、ログインしているときだけ（actorFor）。この端末の海では入れない。 */
import { theServer } from './oneserver.js';
import { regionConf, allSeas } from './regions.js';

export const ME_KEY = 'bubble_todo_me_v1';
const USER_RE = /^u_[0-9a-f]{8}$/;

function ls() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export function validUser(v) { return typeof v === 'string' && USER_RE.test(v); }

/* 控え → {user, seas} か null */
export function meInfo(st = ls()) {
  if (!st) return null;
  try {
    const j = JSON.parse(st.getItem(ME_KEY) || 'null');
    if (!j || !j.user || !validUser(j.user.id) || !Array.isArray(j.seas)) return null;
    return j;
  } catch (e) { return null; }
}

export function saveMe(json, st = ls()) {
  if (!st) return false;
  try {
    if (!json) { st.removeItem(ME_KEY); return true; }
    if (!json.user || !validUser(json.user.id) || !Array.isArray(json.seas)) return false;
    st.setItem(ME_KEY, JSON.stringify({ at: Date.now(), user: json.user, seas: json.seas }));
    return true;
  } catch (e) { return false; }
}

/* サーバーの繋ぎ先のログイン（住所と通行証）。ログインしていなければ null */
export function serverLogin(st = ls()) {
  const r = theServer(st);
  const c = r ? regionConf(r.id, st) : null;
  if (!c || !c.session || !(Number(c.sessionExpires) * 1000 > Date.now())) return null;
  return { rid: r.id, url: String(c.url || ''), session: String(c.session) };
}

/* /api/me を取り直して控える → 答え か null（届かない・ログインしていない） */
export async function fetchMe(st = ls()) {
  const L = serverLogin(st);
  if (!L || !L.url) return null;
  try {
    const res = await fetch(L.url.replace(/\/$/, '') + '/api/me', {
      cache: 'no-store', headers: { Authorization: 'Bearer ' + L.session },
    });
    if (res.status === 401) { saveMe(null, st); return null; }
    if (res.status !== 200) return null;
    const j = await res.json();
    return saveMe(j, st) ? j : null;
  } catch (e) { return null; }
}

/* その海がサーバーの海で、ログインしているか → サーバーの海の id（'me' はサーバーの個人）か null */
function serverSeaOf(spaceId, st) {
  const L = serverLogin(st);
  if (!L) return null;
  const s = allSeas(st).find(e => e.id === spaceId);
  if (!s || s.rid !== L.rid) return null;
  return s.personal ? 'me' : s.id;
}

/* 記録の欄に入れる「わたし」（利用者の番号）。サーバーの海でログインしているときだけ。ほかは null */
export function actorFor(spaceId, st = ls()) {
  const me = meInfo(st);
  if (!me || !serverSeaOf(spaceId, st)) return null;
  return me.user.id;
}

/* 共有の海の仲間 [{id, name, role}]。共有の海でなければ（個人・この端末の海・まだ知らない）null */
export function seaMembers(spaceId, st = ls()) {
  const me = meInfo(st);
  const sid = serverSeaOf(spaceId, st);
  if (!me || !sid || sid === 'me') return null;
  const s = me.seas.find(x => x && x.id === sid && x.kind === 'shared');
  return s && Array.isArray(s.members) ? s.members.filter(m => m && validUser(m.id)) : null;
}

/* この海での自分の役割（owner / editor / viewer）。わからなければ null */
export function myRole(spaceId, st = ls()) {
  const me = meInfo(st);
  const sid = serverSeaOf(spaceId, st);
  if (!me || !sid) return null;
  const s = me.seas.find(x => x && x.id === sid);
  return s ? s.role || null : null;
}

/* 利用者の番号 → 名前（知らなければ ''） */
export function userName(uid, st = ls()) {
  const me = meInfo(st);
  if (!me || !validUser(uid)) return '';
  if (me.user.id === uid) return String(me.user.name || '');
  for (const s of me.seas) {
    const m = (s && Array.isArray(s.members) ? s.members : []).find(x => x && x.id === uid);
    if (m) return String(m.name || '');
  }
  return '';
}

/* 泡に出す 1 字（名前の頭。知らない人は「?」） */
export function initialOf(uid, st = ls()) {
  const n = userName(uid, st);
  return n ? Array.from(n)[0] : '?';
}
