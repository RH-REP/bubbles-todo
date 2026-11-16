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
