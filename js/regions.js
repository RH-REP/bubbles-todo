/* 海域の一覧（2026-11-12 利用者の指示：「海域の設定をしやすくして」「複数の場所からつなげるように」）。
   DOM も通信も触らない。store.js（どの箱を開くか）・sync.js（どのサーバーに繋ぐか）・
   space.js（帯・引き出し）・settings.js（海域の一覧と歯車）が使う。テストは tests/regions.test.mjs。

   ■ 海域
   1つの海域は、海のまとまり（個人・作った海）と、その置き場。
     kind 'local'  … この端末だけ。サーバーに送らない
     kind 'server' … 1台のサーバー（住所と入る鍵）。海域ごとに別のサーバーに繋げる
   一覧 bubble_todo_regions = [{ id, name, kind, legacyMe, legacyConf, at, alive }]。id は 'local' か 'r' ＋英小文字・数字。
   海域の ID はこの端末だけのもの（サーバーへは送らない。ほかの端末では別の ID になる）。

   ■ 同時に使う
   一度に開いている海はいつも1つ（海を替えると読み直す。space.js）。同期は、開いている海の海域の住所と鍵で行う
   （sync.js）。だから海域2 の海と海域3 の海を行き来しても、それぞれのサーバーと合う。

   ■ 個人の海は海域ごと
   サーバーA の個人とサーバーB の個人を1つの箱で合わせると混ざるので、海域ごとに別の個人を持つ。
     legacyMe の海域（前の版からの個人。1つだけ） … 海の ID 'me'、箱 bubble_todo_v1（今までどおり）
     ほかの海域                                   … 海の ID 'me.<海域>'、箱 bubble_todo_me_<海域>_v1
   サーバーへは、どちらも 'me'（X-Bubbles-Space）として送る。

   ■ 住所と鍵
   legacyConf の海域（サーバーの海域の1つだけ） … bubble_todo_sync（前の版の箱。boot-edition.js・notes.js も読む）
   ほかのサーバーの海域                          … bubble_todo_sync_<海域>
   中身は前の版の bubble_todo_sync と同じ形（url・token・shareToken・パスキーの通行証）。

   ■ 引き継ぎ（初めて開いたとき。足すだけで、記録の箱は書き換えない）
     サーバーに繋いでいた端末 … 「この端末だけ」（local）と、前のサーバー（r0。legacyMe・legacyConf）の2つ
     繋いでいなかった端末     … 「この端末だけ」（local。legacyMe）の1つ
   海の一覧の海（bubble_todo_spaces）で region の無いものは、legacyMe の海域のもの。 */

import { allEntries, seaList } from './spacelist.js';

export const REGIONS_KEY = 'bubble_todo_regions';
export const LEGACY_CONF_KEY = 'bubble_todo_sync';
export const REGION_RE = /^(local|r[0-9a-z]{1,23})$/;
export const PERSONAL_RE = /^me\.(local|r[0-9a-z]{1,23})$/;
export const REGION_NAME_MAX = 16;

function ls() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export function cleanRegionName(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, REGION_NAME_MAX);
}

function cleanRegion(r) {
  if (!r || typeof r !== 'object' || !REGION_RE.test(String(r.id || ''))) return null;
  const kind = r.id === 'local' ? 'local' : 'server';
  const at = Number(r.at);
  return {
    id: String(r.id), kind,
    name: cleanRegionName(r.name) || (kind === 'local' ? 'この端末だけ' : 'サーバー'),
    legacyMe: !!r.legacyMe, legacyConf: kind === 'server' && !!r.legacyConf,
    at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0, alive: r.alive === 0 ? 0 : 1,
  };
}

/* 住所から名前の案（「サーバー（example.org）」） */
export function nameFromUrl(url) {
  try { return cleanRegionName('サーバー（' + new URL(String(url)).hostname + '）'); } catch (e) { return 'サーバー'; }
}

function readConfRaw(key, st = ls()) {
  try { const o = JSON.parse((st && st.getItem(key)) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}

/* 初めて開いたときの一覧（引き継ぎ）。記録の箱は触らない */
function initialRegions(st) {
  const legacy = readConfRaw(LEGACY_CONF_KEY, st);
  const url = legacy && typeof legacy.url === 'string' ? legacy.url : '';
  if (url) {
    return [
      { id: 'local', kind: 'local', name: 'この端末だけ', legacyMe: false, legacyConf: false, at: 0, alive: 1 },
      { id: 'r0', kind: 'server', name: nameFromUrl(url), legacyMe: true, legacyConf: true, at: 0, alive: 1 },
    ];
  }
  return [{ id: 'local', kind: 'local', name: 'この端末だけ', legacyMe: true, legacyConf: false, at: 0, alive: 1 }];
}

/* 一覧（消した印も含む）。無ければ引き継いで作る */
export function allRegions(st = ls()) {
  let rows = null;
  try { rows = JSON.parse((st && st.getItem(REGIONS_KEY)) || 'null'); } catch (e) { rows = null; }
  if (!Array.isArray(rows)) {
    rows = initialRegions(st);
    try { if (st) st.setItem(REGIONS_KEY, JSON.stringify(rows)); } catch (e) { /* 書けなくても、毎回同じ引き継ぎになる */ }
  }
  const out = [];
  const seen = new Set();
  rows.forEach(r => { const c = cleanRegion(r); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } });
  /* 「この端末だけ」はいつもある */
  if (!seen.has('local')) out.unshift(cleanRegion({ id: 'local', name: 'この端末だけ' }));
  /* legacyMe はちょうど1つ（無ければ local） */
  if (!out.some(r => r.legacyMe && r.alive)) { const l = out.find(r => r.id === 'local'); l.legacyMe = true; l.alive = 1; }
  return out;
}

function saveRegions(rows, st = ls()) {
  try { if (st) st.setItem(REGIONS_KEY, JSON.stringify(rows)); return true; } catch (e) { return false; }
}

/* 今ある海域。並びは一覧のまま（この端末だけ → 足した順） */
export function regionList(st) { return allRegions(st).filter(r => r.alive); }
export function findRegion(id, st) { return regionList(st).find(r => r.id === id) || null; }
export function defaultRegionId(st) { const r = regionList(st).find(x => x.legacyMe); return r ? r.id : 'local'; }

/* ---- 海と海域 ---- */
export function personalId(rid, st) {
  const r = findRegion(rid, st);
  return (!r || r.legacyMe) ? 'me' : 'me.' + rid;
}
export function isPersonal(id) { return id === 'me' || PERSONAL_RE.test(String(id || '')); }
/* 海の ID → 海域の ID。どの海域にも出さない海は null。
     個人 'me'              … legacyMe の海域
     個人 'me.<海域>'        … その海域（外した海域なら null）
     作った海で region 無し … legacyMe の海域（前の版の海）
     作った海で region あり … その海域。外した海域・この端末の知らない海域（ほかの端末の引っ越しのファイルなど）なら null
   null の海を最初の海域のものにすると、別のサーバーへ送ってしまうので、出さない */
export function regionOfSpace(id, st) {
  if (id === 'me') return defaultRegionId(st);
  const m = PERSONAL_RE.exec(String(id || ''));
  if (m) return findRegion(m[1], st) ? m[1] : null;
  const e = allEntries().find(x => x.id === id);
  if (!e) return null;
  if (!e.region) return defaultRegionId(st);
  return findRegion(e.region, st) ? e.region : null;
}
/* サーバーに言う海の ID（個人はどれも 'me'） */
export function serverSpace(id) { return isPersonal(id) ? 'me' : id; }
/* その海域の作った海（今あるもの） */
export function seasOf(rid, st) { return seaList().filter(e => regionOfSpace(e.id, st) === rid); }
/* その海域の海（消した印も）。サーバーと一覧を合わせるとき */
export function entriesOf(rid, st) { return allEntries().filter(e => regionOfSpace(e.id, st) === rid); }
/* その海域の、個人を含む海の ID（個人が先頭） */
export function spacesOf(rid, st) { return [personalId(rid, st)].concat(seasOf(rid, st).map(e => e.id)); }
/* すべての海域の、個人を含む海の ID */
export function allSpaceIds(st) {
  const out = [];
  regionList(st).forEach(r => spacesOf(r.id, st).forEach(id => { if (out.indexOf(id) < 0) out.push(id); }));
  return out;
}

/* ---- 住所と鍵 ---- */
export function confKeyOf(rid, st) {
  const r = findRegion(rid, st);
  if (!r || r.kind !== 'server') return '';
  return r.legacyConf ? LEGACY_CONF_KEY : LEGACY_CONF_KEY + '_' + rid;
}
export function regionConf(rid, st = ls()) {
  const k = confKeyOf(rid, st);
  return k ? readConfRaw(k, st) : null;
}
/* 住所の入っている箱の名前（boot-edition.js と同じ見方。サーバーなし版から移すかを決める） */
export function anyServerUrl(st = ls()) {
  return regionList(st).some(r => { const c = regionConf(r.id, st); return !!(c && c.url); });
}

/* 「この端末だけ」の海域が前の版からの個人を持っているか（サーバーへ移す選択を出すか） */
export function localHasLegacy(st) { return defaultRegionId(st) === 'local'; }

/* ---- 海を1つずつ並べる（2026-11-12 Issue #47 の返事）----
   > 海域の言葉は廃止。１画面（うみ）を１同期単位を海にしましょう。今もし中にある場合はバラバラの海にして、それぞれにサーバー同期設定をつける
   画面では「海域」を見せず、海を1つずつ並べ、海ごとに「同期：この端末だけ／サーバー（名前）」を出す。
   中の仕組み（このファイルの「海域」）は、そのまま**繋ぎ先**（サーバー1台の住所と鍵、または この端末だけ）として使う。
   同じサーバーの海は、住所と鍵を1つの繋ぎ先で共有する（入り直し・パスキーの登録はサーバーごとに1回。返事の 1A）。
   海の印 region が、その海の同期の設定になる（記録の箱は動かさない。返事の 2A）。 */

/* 個人の海の名前。前の版からの個人は「個人」、ほかの繋ぎ先の個人は「個人（サーバーの名前）」 */
export function personalLabel(rid, st) {
  const r = findRegion(rid, st);
  if (!r || r.legacyMe) return '個人';
  return '個人（' + (r.kind === 'local' ? 'この端末だけ' : r.name) + '）';
}
/* すべての海を1列に。前の版からの個人がいちばん前、次に繋ぎ先の順（個人 → 作った海）。
   1件 = { id, name, color, rid, personal }（作った海は spacelist の欄も持つ） */
export function allSeas(st = ls()) {
  const out = [];
  regionList(st).forEach(r => {
    /* 「この端末だけ」の個人（前の版からの個人でないもの）は、中身が空で開いてもいなければ出さない
       （2026-11-13 Issue #50 の返事「おすすめで」= A 案。サーバーにつないだあと、空の「個人（この端末だけ）」が残って海が増えて見えたため） */
    if (r.kind === 'local' && !r.legacyMe && personalEmpty(personalId(r.id, st), st)) return;
    out.push({ id: personalId(r.id, st), name: personalLabel(r.id, st), color: null, rid: r.id, personal: true });
    seasOf(r.id, st).forEach(e => out.push(Object.assign({}, e, { rid: r.id, personal: false })));
  });
  const i = out.findIndex(e => e.id === 'me');
  if (i > 0) out.unshift(out.splice(i, 1)[0]);
  return out;
}
/* 個人の箱に todo が1つも無く、開いている海でもないか（開いている海は、いつも出す） */
function personalEmpty(id, st) {
  if (!st) return false;
  try {
    if (st.getItem('bubble_todo_space') === id) return false;
    const m = PERSONAL_RE.exec(id);
    if (!m) return false;
    const raw = JSON.parse(st.getItem('bubble_todo_me_' + m[1] + '_v1') || 'null');
    const todos = raw && Array.isArray(raw.todos) ? raw.todos.filter(t => t && !t.trashed) : [];
    return todos.length === 0;
  } catch (e) { return false; }
}
/* サーバーの繋ぎ先だけ */
export function serverRegions(st) { return regionList(st).filter(r => r.kind === 'server'); }
/* 同じ住所の繋ぎ先（海を足すとき、同じサーバーなら新しく作らずに使う） */
export function serverByUrl(url, st = ls()) {
  const u = String(url || '');
  if (!u) return null;
  return serverRegions(st).find(r => String((regionConf(r.id, st) || {}).url || '') === u) || null;
}

/* ---- 足す・直す・外す ---- */
export function newRegionId(now = Date.now()) {
  return 'r' + now.toString(36) + Math.random().toString(36).slice(2, 5);
}

/* サーバーの海域を足す → 足した1件。url は呼ぶ側で整えたもの（sync.js の normalizeUrl）。
   conf は { url, token?, shareToken? }（無ければ住所だけ）。
   opts.takeLocal … 「この端末だけ」の海域が前の版からの個人と海を持っているなら、それをこの海域へ移す
     （サーバーに繋いでいなかった端末が、初めてサーバーを足すとき。前の版で住所を入れたのと同じになる）。
     移すのは印（legacyMe）だけで、記録の箱は動かさない。region の無い海も一緒に移る。
     「この端末だけ」には、空の個人（me.local）が残る */
export function addServerRegion(name, conf, now = Date.now(), st = ls(), opts = {}) {
  const rows = allRegions(st);
  const url = conf && conf.url ? String(conf.url) : '';
  if (!url) return null;
  const legacyConf = !rows.some(r => r.alive && r.kind === 'server' && r.legacyConf);
  const r = cleanRegion({ id: newRegionId(now), name: cleanRegionName(name) || nameFromUrl(url), legacyMe: false, legacyConf, at: now, alive: 1 });
  if (opts.takeLocal) {
    const loc = rows.find(x => x.id === 'local');
    if (loc && loc.legacyMe) { loc.legacyMe = false; r.legacyMe = true; }
  }
  rows.push(r);
  if (!saveRegions(rows, st)) return null;
  const key = legacyConf ? LEGACY_CONF_KEY : LEGACY_CONF_KEY + '_' + r.id;
  const prev = readConfRaw(key, st);
  /* 前の版の箱にほかの住所が残っていれば、それは上書きしない（legacyConf の海域が無いのに箱がある＝読み違い） */
  if (!(prev && prev.url && prev.url !== url)) {
    try { st.setItem(key, JSON.stringify({ url, token: String((conf && conf.token) || ''), shareToken: String((conf && conf.shareToken) || '') })); }
    catch (e) { /* 鍵は歯車からもう一度入れられる */ }
  }
  return r;
}

export function renameRegion(id, name, now = Date.now(), st = ls()) {
  const nm = cleanRegionName(name);
  if (!nm) return false;
  const rows = allRegions(st);
  const r = rows.find(x => x.id === id && x.alive);
  if (!r) return false;
  r.name = nm;
  r.at = Math.max(now, r.at + 1);
  return saveRegions(rows, st);
}

/* 海域を外す。この端末だけ・前の版からの個人を持つ海域は外せない。
   記録の箱・住所の箱は消さない（間違えて外しても、同じ住所で足し直せば海は戻る）。外したら true */
export function removeRegion(id, now = Date.now(), st = ls()) {
  const rows = allRegions(st);
  const r = rows.find(x => x.id === id && x.alive);
  if (!r || r.id === 'local' || r.legacyMe) return false;
  r.alive = 0;
  r.at = Math.max(now, r.at + 1);
  return saveRegions(rows, st);
}

/* ---- 引っ越しのファイル・控えに入れる・戻す（2026-11-12 段2。利用者の指示「海域ごとに引越しとすべてを選べる様に」）----
   ファイル（js/movefile.js の形）に足す欄:
     regions … [{ id, name, kind, url, legacyMe }]（入れた海域だけ。id は作った端末の ID）
     servers … { 海域の ID: { url, move? | token?, shareToken? } }（引っ越しのファイルだけ。控えには入れない）
   海の一覧の海には、作った端末の海域の ID を region として入れる（region の無い海も、その端末の legacyMe の海域を書く）。
   戻す端末では、同じ住所のサーバーの海域があればそれに、無ければ海域を足して、ファイルの海域の ID をこの端末の ID に付け替える。 */

/* 入れる海域の一覧（鍵は入れない） */
export function regionsPayload(rids, st = ls()) {
  return regionList(st).filter(r => rids.indexOf(r.id) >= 0).map(r => {
    const c = regionConf(r.id, st);
    return { id: r.id, name: r.name, kind: r.kind, url: r.kind === 'server' ? String((c && c.url) || '') : '', legacyMe: !!r.legacyMe };
  });
}

/* 選んだ海域の記録と海の一覧だけにする。boxes = { 海の ID: 記録 }、entries = 海の一覧（消した印も）。
   海の region は、無ければこの端末の legacyMe の海域を書いておく（戻す端末で付け替えるため） */
export function pickForPayload(rids, boxes, entries, st = ls()) {
  const def = defaultRegionId(st);
  const keep = new Set();
  rids.forEach(rid => { if (findRegion(rid, st)) keep.add(personalId(rid, st)); });
  const seas = [];
  (entries || []).forEach(e => {
    const rid = regionOfSpace(e.id, st);
    if (!rid || rids.indexOf(rid) < 0) return;
    seas.push(Object.assign({}, e, { region: e.region || def }));
    keep.add(e.id);
  });
  const out = {};
  Object.keys(boxes || {}).forEach(id => { if (keep.has(id)) out[id] = boxes[id]; });
  return { boxes: out, seas };
}

/* ファイルの海域を、この端末の海域に付け替える → { map: { ファイルの ID: この端末の ID }, added: [足した海域] }。
   「この端末だけ」は「この端末だけ」へ。サーバーは同じ住所の海域へ、無ければ足す（鍵はここでは入れない） */
export function importRegions(fileRegions, now = Date.now(), st = ls()) {
  const map = {};
  const added = [];
  (Array.isArray(fileRegions) ? fileRegions : []).forEach(fr => {
    if (!fr || !REGION_RE.test(String(fr.id || ''))) return;
    if (fr.id === 'local' || fr.kind === 'local') { map[fr.id] = 'local'; return; }
    const url = String(fr.url || '');
    const same = url && regionList(st).find(r => r.kind === 'server' && (regionConf(r.id, st) || {}).url === url);
    if (same) { map[fr.id] = same.id; return; }
    if (!url) return;   /* 住所の無いサーバーの海域は、どこへも付け替えられない */
    const r = addServerRegion(fr.name, { url }, now + added.length, st);
    if (r) { map[fr.id] = r.id; added.push(r); }
  });
  return { map, added };
}

/* ファイルの中身（boxes・seas）を、この端末の海の ID と海域へ付け替える。
   ファイルの個人 'me' はファイルの legacyMe の海域の個人、'me.<ID>' はその海域の個人。付け替えられないものは落とす */
export function remapPayload(p, map, st = ls()) {
  const fileRegions = Array.isArray(p && p.regions) ? p.regions : [];
  const fileDef = (fileRegions.find(r => r && r.legacyMe) || {}).id || null;
  const toLocal = (fid) => (fid && map[fid]) || null;
  const boxes = {};
  Object.keys((p && p.boxes) || {}).forEach(id => {
    let target = id;
    if (id === 'me') {
      const rid = toLocal(fileDef);
      if (!rid) return;
      target = personalId(rid, st);
    } else {
      const m = PERSONAL_RE.exec(id);
      if (m) {
        const rid = toLocal(m[1]);
        if (!rid) return;
        target = personalId(rid, st);
      }
    }
    boxes[target] = p.boxes[id];
  });
  const seas = [];
  ((p && p.seas) || []).forEach(e => {
    if (!e || typeof e !== 'object') return;
    const rid = toLocal(e.region || fileDef);
    if (!rid) return;
    seas.push(Object.assign({}, e, { region: rid }));
  });
  /* 付け替えたあと、その海の箱を持つか（海の一覧に無い海の箱は落とす。personal は残す） */
  const known = new Set(seas.map(e => e.id));
  Object.keys(boxes).forEach(id => { if (!isPersonal(id) && !known.has(id)) delete boxes[id]; });
  return { boxes, seas };
}
