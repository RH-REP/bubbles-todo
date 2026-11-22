/* サーバーは1つ（2026-11-16 利用者の指示）。DOM は触らない。テストは tests/oneserver.test.mjs。

   > サーバーを一つにする代わりに、パスキーログイン方式にして（ログイン後にアクセスできる海が表示される）
   > 2026-11-12 の「複数の場所からつなげるように」は「やめます」。今あるほかのサーバーの海は「この端末の海」にする（答え b）

   中の仕組み（js/regions.js の「海域」＝繋ぎ先）はそのまま使い、サーバーの繋ぎ先を1つに限る。
     この端末の海 … 繋ぎ先 'local'
     サーバーの海 … 繋ぎ先が、ただ1つのサーバーの繋ぎ先
   海は作った時点ではこの端末の海。サーバーに置くかは海ごとに選ぶ（setSeaRegion）。

   ■ 引き継ぎ（consolidate。開いたときに1回。何も送らず、記録の箱は消さない）
   サーバーの繋ぎ先が2つ以上あれば、前の版の住所の箱（bubble_todo_sync）を持つものを残し、ほかは次のようにして外す。
     作った海        … 繋ぎ先を 'local' にする（記録の箱はそのまま）
     その繋ぎ先の個人 … 泡が1つでもあれば、新しいこの端末の海「個人（前の名前）」を作り、箱を写す（元の箱は残す）
   外した繋ぎ先の住所と鍵の箱（bubble_todo_sync_<ID>）も消さない（戻すときのため）。 */

import { serverRegions, personalId, addServerRegion, removeRegion, regionConf, PERSONAL_RE, allRegions, REGIONS_KEY, confKeyOf } from './regions.js';
import { seaList, allEntries, setSeaRegion, addSea, boxKey, mergeSeas } from './spacelist.js';
import { mergeState, initialStamps } from './merge.js';

export const DONE_KEY = 'bubble_todo_oneserver_v1';
const SPACE_KEY = 'bubble_todo_space';   /* store.js の SPACE_KEY（store.js は読まない。開く前に呼ぶため） */

function ls() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

/* ただ1つのサーバーの繋ぎ先。無ければ null */
export function theServer(st = ls()) {
  const rows = serverRegions(st);
  return rows.find(r => r.legacyConf) || rows[0] || null;
}

/* その個人の箱に、消していない泡があるか */
function personalHasTodos(id, st) {
  const m = PERSONAL_RE.exec(id);
  const key = m ? 'bubble_todo_me_' + m[1] + '_v1' : boxKey('me');
  try {
    const raw = JSON.parse(st.getItem(key) || 'null');
    return !!(raw && Array.isArray(raw.todos) && raw.todos.some(t => t && !t.trashed));
  } catch (e) { return false; }
}

/* 引き継ぎ → { changed, moved: [海の ID], copied: [{ from, to, name }], reopen: 開き直す海の ID か null } */
export function consolidate(now = Date.now(), st = ls()) {
  const out = { changed: false, moved: [], copied: [], reopen: null };
  if (!st) return out;
  const keep = theServer(st);
  const drop = serverRegions(st).filter(r => !keep || r.id !== keep.id);
  if (!drop.length) return out;
  const open = st.getItem(SPACE_KEY) || 'me';
  drop.forEach((r, i) => {
    /* 作った海はこの端末の海へ */
    seaList().forEach(e => {
      if (e.region !== r.id) return;
      if (setSeaRegion(e.id, 'local')) { out.moved.push(e.id); out.changed = true; }
    });
    /* その繋ぎ先の個人。前の版からの個人（'me'）の繋ぎ先は外さない（theServer が legacyConf を残すので、ふつうは来ない） */
    if (r.legacyMe) return;
    const pid = personalId(r.id, st);
    if (personalHasTodos(pid, st)) {
      const raw = st.getItem('bubble_todo_me_' + r.id + '_v1');
      const sea = addSea('個人（' + r.name + '）', 'ink', now + i, 'local');
      if (sea && raw) {
        try { st.setItem(boxKey(sea.id), raw); } catch (e) { /* 写せなければ元の箱が残る */ }
        out.copied.push({ from: pid, to: sea.id, name: sea.name });
        if (open === pid) out.reopen = sea.id;
      }
    } else if (open === pid) {
      out.reopen = 'me';
    }
    removeRegion(r.id, now + i, st);
    out.changed = true;
  });
  if (out.reopen) { try { st.setItem(SPACE_KEY, out.reopen); } catch (e) { /* 次に開いたときに個人へ */ } }
  try { st.setItem(DONE_KEY, String(now)); } catch (e) { /* 毎回同じ結果になる */ }
  return out;
}

/* サーバーの住所。繋ぎ先があればその住所、無ければこのページ（server.py がパスキーの形で配っているとき）。
   pageMode はこのページの /api/auth の答え（'passkey' | 'token' | null）。分からなければ '' */
export function serverUrl(pageOrigin, pageMode, st = ls()) {
  const r = theServer(st);
  const c = r ? regionConf(r.id, st) : null;
  if (c && c.url) return String(c.url);
  return pageMode === 'passkey' && pageOrigin ? String(pageOrigin) : '';
}

/* サーバーの繋ぎ先を用意する（ログインの前）。あればそれ、無ければ足す（この端末の海は動かさない）→ 繋ぎ先 */
export function ensureServer(url, now = Date.now(), st = ls()) {
  const r = theServer(st);
  if (r) return r;
  return addServerRegion('サーバー', { url }, now, st);
}

/* ---- 個人を1つにまとめる（2026-11-16 利用者の指示「端末個人とサーバー個人に分かれるのは？ 統合…」）----
   ログインすると、この端末の個人（箱 bubble_todo_v1）と、サーバーの個人（箱 bubble_todo_me_<ID>_v1）の2つが並ぶ。
   まとめると、2つの箱を記録ごとに重ね（merge.js。消さない。同じ記録は新しいほう）、この端末の個人をサーバーの個人にする
   （前の版で住所を入れた端末と同じ形 = 前の版からの個人の印 legacyMe をサーバーの繋ぎ先へ移す）。以後、個人は1つで、サーバーと合わせる。
   作った海のうち繋ぎ先の印の無いもの（前の版からの個人と同じ繋ぎ先の海）は、先に 'local' を付けて動かさない。
   前の中身は 'bubble_todo_v1_before_unify_<時刻>' に残す。サーバーの個人の箱も消さない */

function stateOf(raw) {
  let o = null;
  try { o = JSON.parse(raw || 'null'); } catch (e) { o = null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { doc: {}, stamps: {} };
  const doc = Object.assign({}, o);
  delete doc.stamps;
  const stamps = (o.stamps && typeof o.stamps === 'object' && !Array.isArray(o.stamps)) ? o.stamps : initialStamps(doc, 1);
  return { doc, stamps };
}

/* まとめられるか → 'toServer'（この端末の個人が前の版からの個人。サーバーの個人は別の箱）、
   'intoServer'（サーバーの個人が前の版からの個人。この端末の個人 'me.local' に泡が残っている。
   前からサーバーにつないでいた端末で、あとから「この端末だけ」の個人に書いたとき）、どちらでもなければ null */
export function canUnify(st = ls()) {
  const r = theServer(st);
  if (!r) return null;
  const loc = allRegions(st).find(x => x.id === 'local');
  if (loc && loc.legacyMe && !r.legacyMe) return 'toServer';
  if (r.legacyMe && hasTodos(st.getItem('bubble_todo_me_local_v1'))) return 'intoServer';
  return null;
}
function hasTodos(raw) {
  const o = stateOf(raw).doc;
  return Array.isArray(o.todos) && o.todos.some(t => t && !t.trashed);
}

/* まとめる → まとめた個人の海の ID（'me'）か null */
export function unifyPersonal(now = Date.now(), st = ls()) {
  const kind = st ? canUnify(st) : null;
  if (!kind) return null;
  const r = theServer(st);
  const open = st.getItem(SPACE_KEY);
  if (kind === 'intoServer') {
    /* サーバーの個人（箱 bubble_todo_v1）へ、この端末の個人（me.local）を重ねる。me.local の箱は控えへ移す（空になり一覧から消える） */
    const mine = st.getItem('bubble_todo_me_local_v1');
    const merged = mergeState(stateOf(st.getItem(boxKey('me'))), stateOf(mine));
    try {
      st.setItem(boxKey('me'), JSON.stringify(Object.assign({}, merged.doc, { stamps: merged.stamps })));
      st.setItem('bubble_todo_me_local_v1_before_unify_' + now, mine);
      st.removeItem('bubble_todo_me_local_v1');
    } catch (e) { return null; }
    if (open === 'me.local') { try { st.setItem(SPACE_KEY, 'me'); } catch (e) { /* 次に開いたとき */ } }
    return 'me';
  }
  const localRaw = st.getItem(boxKey('me'));
  const serverRaw = st.getItem('bubble_todo_me_' + r.id + '_v1');
  const merged = mergeState(stateOf(localRaw), stateOf(serverRaw));
  try {
    if (localRaw) st.setItem('bubble_todo_v1_before_unify_' + now, localRaw);
    st.setItem(boxKey('me'), JSON.stringify(Object.assign({}, merged.doc, { stamps: merged.stamps })));
  } catch (e) { return null; }
  /* 印の無い海は、いまの「前の版からの個人」の繋ぎ先（この端末）のもの。動かさないよう先に印を付ける */
  allEntries().forEach(e => { if (e.alive && !e.region) setSeaRegion(e.id, 'local'); });
  const rows = allRegions(st).map(x => Object.assign({}, x, { legacyMe: x.id === r.id }));
  try { st.setItem(REGIONS_KEY, JSON.stringify(rows)); } catch (e) { return null; }
  if (open === 'me.' + r.id || open === 'me.local') { try { st.setItem(SPACE_KEY, 'me'); } catch (e) { /* 次に開いたとき */ } }
  return 'me';
}

/* ---- サーバーの海の一覧を受け取る（2026-11-16 利用者の指示「海の管理はVMから直接行う。appからそのようなことはできない」）----
   POST /api/spaces の答え { spaces: [入れる海], access: [この鍵の入れる置き場] }。
   ・入れる海を一覧に足す（サーバーの海にする）
   ・この端末の海と同じ ID の海があれば、その海をサーバーの海にする（管理者が VM で sea-add <名前> <その ID> を打ったとき）
   ・鍵の入れる置き場（access）を、繋ぎ先の箱の通行証の欄に入れ直す（VM の passkey-space がログインし直さずに効く）
   変わったら true */
export function applyServerSeas(rid, json, st = ls()) {
  if (!json || !Array.isArray(json.spaces)) return false;
  let changed = mergeSeas(json.spaces, rid);
  const ids = new Set(json.spaces.map(r => r && r.id));
  allEntries().forEach(e => {
    if (e.alive && ids.has(e.id) && (!e.region || e.region === 'local') && e.region !== rid) {
      if (setSeaRegion(e.id, rid)) changed = true;
    }
  });
  if (Array.isArray(json.access) && st) {
    const key = confKeyOf(rid, st);
    const c = key ? regionConf(rid, st) : null;
    if (c && c.session && JSON.stringify(c.sessionSpaces || []) !== JSON.stringify(json.access)) {
      try { st.setItem(key, JSON.stringify(Object.assign({}, c, { sessionSpaces: json.access.slice() }))); changed = true; } catch (e) { /* 次に取りに来たとき */ }
    }
  }
  return changed;
}

/* ---- 個人の海は利用者 1 人に 1 つ（2026-11-18 ユーザーの指示「個人と個人サーバーが分かれている」「個人は全てのユーザーが１つもつ」）----
   ログインしていない … この端末の個人。ログインしている … その利用者のサーバーの個人（端末にも写し）。「個人（サーバー）」は出さない。
   ・はじめてログインした端末に、この端末の個人の泡があれば、サーバーの個人へ合わせる（unifyPersonal。記録ごとに新しいほう・
     片方にしか無いものは両方残す。前の中身は控えの箱へ）
   ・前に別の利用者がこの端末でログインしていて、その人の個人の写しが残っていれば、合わせずに聞く（replacePersonal で控えへ移す）
   ・ログアウトのとき、写しを残す（既定）か消す（logoutPersonal）
   だれの写しかは OWNER_KEY（利用者の番号）で覚える。 */
export const OWNER_KEY = 'bubble_todo_personal_owner_v1';

function liveCount(raw) {
  const o = stateOf(raw).doc;
  return Array.isArray(o.todos) ? o.todos.filter(t => t && !t.trashed).length : 0;
}

/* サーバーの個人の箱の名前（サーバーの繋ぎ先が無ければ null） */
export function serverPersonalBox(st = ls()) {
  const r = theServer(st);
  return r ? boxKey(personalId(r.id, st)) : null;
}

/* ログインしたあと、どうするか → {kind: 'other', prev} | {kind: 'merge', n} | {kind: 'none'} */
export function loginPlan(userId, st = ls()) {
  if (!st) return { kind: 'none' };
  const prev = st.getItem(OWNER_KEY);
  const box = serverPersonalBox(st);
  if (prev && userId && prev !== userId && box && liveCount(st.getItem(box)) > 0) return { kind: 'other', prev };
  const kind = canUnify(st);
  if (!kind) return { kind: 'none' };
  /* 合わせる側（この端末の個人）の泡の数 */
  const r = theServer(st);
  const from = kind === 'intoServer' ? 'bubble_todo_me_local_v1' : boxKey('me');
  const n = (kind === 'toServer' && r && r.legacyMe) ? 0 : liveCount(st.getItem(from));
  return { kind: 'merge', n };
}

/* ログインを仕上げる（plan が merge なら合わせる）。だれの写しかを覚える → 合わせた泡の数 */
export function applyLogin(userId, plan, now = Date.now(), st = ls()) {
  let n = 0;
  if (plan && plan.kind === 'merge') { if (unifyPersonal(now, st)) n = plan.n || 0; }
  try { if (userId) st.setItem(OWNER_KEY, userId); } catch (e) { /* 次に覚える */ }
  return n;
}

/* 別の利用者でログインした: 前の人の写しを控えへ移し、空の個人から始める（合わせない）→ 控えの箱の名前 */
export function replacePersonal(userId, now = Date.now(), st = ls()) {
  const box = serverPersonalBox(st);
  if (!box) return null;
  const pid = personalId(theServer(st).id, st);
  const keep = box + '_before_user_' + now;
  try {
    const raw = st.getItem(box);
    if (raw) st.setItem(keep, raw);
    st.removeItem(box);
    st.removeItem('bubble_todo_sync_seen_' + pid);
    /* 同期が覚えている「前に合わせた個人の番号」も消す（js/sync.js の PERSON_KEY。新しい人の個人を最初から読む） */
    st.removeItem('bubble_todo_sync_person');
    st.removeItem('bubble_todo_sync_person_' + theServer(st).id);
    if (userId) st.setItem(OWNER_KEY, userId);
  } catch (e) { return null; }
  return keep;
}

/* ログアウト: keep なら写しを残す（だれの写しかも覚えたまま）。消すなら個人の写しを消す（サーバーには残る） */
export function logoutPersonal(keep, st = ls()) {
  if (keep || !st) return;
  const box = serverPersonalBox(st);
  const r = theServer(st);
  try {
    if (box) st.removeItem(box);
    if (r) st.removeItem('bubble_todo_sync_seen_' + personalId(r.id, st));
    st.removeItem(OWNER_KEY);
  } catch (e) { /* 消せなくても、ログアウトはする */ }
}

/* 個人の控え（設定の「記録」から戻す。2026-11-18 決定「合わせる前に控えを取り、設定の『記録』で戻せる」）。
   合わせる（unify）・前の版の人の入れ替え（person。js/sync.js）・別の利用者（user）の前に取った箱 → 新しい順
   [{key, kind: 'unify'|'person'|'user', at, n, other}] */
const BACKUP_RE = /^bubble_todo_(?:v1|me_.+)_before_(unify|person|user)_(\d+)$/;
export function personalBackups(st = ls()) {
  const out = [];
  if (!st) return out;
  for (let i = 0; i < st.length; i++) {
    const key = st.key(i);
    const m = key && BACKUP_RE.exec(key);
    if (m) out.push({ key, kind: m[1], at: Number(m[2]), n: liveCount(st.getItem(key)) });
  }
  /* 別の利用者に替わった（user の控え）ときより前の控えは、前の人のもの（other） */
  const cut = Math.max(0, ...out.filter(b => b.kind === 'user').map(b => b.at));
  out.forEach(b => { b.other = b.kind === 'user' || b.at <= cut; });
  return out.sort((a, b) => b.at - a.at);
}

/* 控えを今の個人に重ねた状態 → {doc, stamps}（消さない・置き換えない。記録ごとに新しいほうが残る）。
   前の人の控え（other。別の利用者に替わった時より前のもの）は、ログイン中は重ねない（ほかの人の泡を今の人のサーバーの個人へ送らないため）→ null */
export function mergeBackup(key, current, loggedIn, st = ls()) {
  const m = key && BACKUP_RE.exec(key);
  if (!m || !st) return null;
  if (loggedIn) {
    const b = personalBackups(st).find(x => x.key === key);
    if (!b || b.other) return null;
  }
  const raw = st.getItem(key);
  if (!raw) return null;
  return mergeState(current || { doc: {}, stamps: {} }, stateOf(raw));
}

/* 控えの中身そのもの → {doc, stamps}（上書きで戻すとき。2026-11-19）。重ねてよいかの決まりは mergeBackup と同じ → null */
export function backupState(key, loggedIn, st = ls()) {
  const m = key && BACKUP_RE.exec(key);
  if (!m || !st) return null;
  if (loggedIn) {
    const b = personalBackups(st).find(x => x.key === key);
    if (!b || b.other) return null;
  }
  const raw = st.getItem(key);
  return raw ? stateOf(raw) : null;
}

/* 開いたとき（js/oneserver-boot.js）: 前の版のうちにログインしていた端末も、個人を 1 つにする（2026-11-18）。
   ログインのとき（js/loginflow.js の finishLogin）にしか合わせていなかったので、版を上げる前からログインしていた端末では
   「個人」と「個人（サーバー）」が並んだままだった。通行証が生きていて、合わせる先がこの端末で前にログインした人と同じ（か、まだ覚えていない）ときだけ合わせる。
   別の人の写しなら合わせない（次にログインし直したとき、loginflow が聞く）→ 合わせた泡の数（合わせなければ 0。合わせて泡が 0 なら -1） */
export function bootUnify(now = Date.now(), st = ls()) {
  if (!st) return 0;
  const r = theServer(st);
  if (!r) return 0;
  const c = regionConf(r.id, st);
  if (!c || !c.session || !(Number(c.sessionExpires) * 1000 > Date.now())) return 0;
  let uid = '';
  try { const me = JSON.parse(st.getItem('bubble_todo_me_v1') || 'null'); uid = (me && me.user && me.user.id) || ''; } catch (e) { uid = ''; }
  const plan = loginPlan(uid || undefined, st);
  if (plan.kind !== 'merge') return 0;
  const before = canUnify(st);
  const n = applyLogin(uid || undefined, plan, now, st);
  return n > 0 ? n : (before && !canUnify(st) ? -1 : 0);
}
