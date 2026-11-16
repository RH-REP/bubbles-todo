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

import { serverRegions, personalId, addServerRegion, removeRegion, regionConf, PERSONAL_RE } from './regions.js';
import { seaList, setSeaRegion, addSea, boxKey } from './spacelist.js';

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
