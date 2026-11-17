/* 海の一覧（2026-11-02 Issue #4。利用者の指示：「共有」ではなく、海に名前を付けて複数作れるように）。
   DOM も通信も触らない。store.js（どの箱を開くか）・sync.js（サーバーと一覧を合わせる）・
   space.js（帯・引き出し・作る板）・settings.js が使う。

   ■ 海
     'me'    … 個人。最初からあり、名前を変えられず、消せない。一覧には入れない
     'share' … 前の版の「共有」。記録（bubble_todo_share_v1・サーバーの share/）をそのまま引き継ぎ、
               名前と色を変えられる海の1つになった（既定の名前は「共有」、色はマグマ）
     ほか    … アプリの中で名前を付けて作る海。ID は 's' と英小文字・数字（サーバーのフォルダ名にもなる）
   一覧の1件 = { id, name, color, at, alive, region? }。at は書き換えた時刻、alive 0 は消した印（墓石）。
   region はその海の海域（js/regions.js。2026-11-12）。この端末だけの ID なのでサーバーへは送らない（sync.js が外す）。
   region の無い海は、前の版からの個人と同じ海域のもの。
   サーバーの一覧と合わせるときは、海ごとに新しいほうを残す（merge.js の記録と同じ考え）。

   ■ 箱
     一覧          bubble_todo_spaces
     海ごとの記録  個人 bubble_todo_v1、共有 bubble_todo_share_v1、ほか bubble_todo_sea_<ID>_v1、
                   ほかの海域の個人 'me.<海域>' は bubble_todo_me_<海域>_v1（js/regions.js） */

export const LIST_KEY = 'bubble_todo_spaces';
export const ID_RE = /^s[0-9a-z]{3,23}$/;
export const NAME_MAX = 16;
const REGION_ID_RE = /^(local|r[0-9a-z]{1,23})$/;   /* js/regions.js の REGION_RE（ここから regions.js は読まない。循環を避ける） */

/* 水の色。個人は空色のまま（ここには無い）。[ID, 名前, 印の色] */
export const COLORS = [
  ['magma', 'マグマ', '#c2412d'],
  ['moss', '苔', '#3f8a4a'],
  ['dusk', '夕暮れ', '#7a52b8'],
  ['sand', '砂', '#b07a1c'],
  ['ink', '墨', '#6b6b6b'],
];
const COLOR_IDS = COLORS.map(c => c[0]);

const DEFAULTS = [{ id: 'share', name: '共有', color: 'magma', at: 0, alive: 1 }];

function ls() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

/* 1件を整える。読めないものは null */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const id = String(e.id || '');
  if (!ID_RE.test(id)) return null;
  const name = cleanName(e.name) || '名前のない海';
  const color = COLOR_IDS.indexOf(e.color) >= 0 ? e.color : 'magma';
  const at = Number(e.at);
  const out = { id, name, color, at: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0, alive: e.alive === 0 ? 0 : 1 };
  if (REGION_ID_RE.test(String(e.region || ''))) out.region = String(e.region);
  return out;
}

export function cleanName(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/* 一覧（消した印も含む）。既定の「共有」は、一覧に無ければ足す */
export function allEntries() {
  let rows = [];
  const st = ls();
  try { rows = JSON.parse((st && st.getItem(LIST_KEY)) || '[]'); } catch (e) { rows = []; }
  const out = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const e = cleanEntry(r);
    if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  });
  DEFAULTS.forEach(d => { if (!seen.has(d.id)) out.unshift(Object.assign({}, d)); });
  return out;
}

function save(rows) {
  const st = ls();
  if (!st) return false;
  try { st.setItem(LIST_KEY, JSON.stringify(rows)); return true; } catch (e) { return false; }
}

/* 今ある海（個人は入れない） */
export function seaList() { return allEntries().filter(e => e.alive); }

export function findSea(id) {
  return seaList().find(e => e.id === id) || null;
}

/* 画面に出す名前。個人は「個人」 */
export function seaName(id) {
  if (id === 'me') return '個人';
  const e = allEntries().find(x => x.id === id);
  return e ? e.name : String(id || '');
}

export function seaColor(id) {
  const e = findSea(id);
  return e ? e.color : null;
}
export function colorMark(color) {
  const c = COLORS.find(x => x[0] === color);
  return c ? c[2] : COLORS[0][2];
}

/* 海ごとの記録の箱 */
export function boxKey(id) {
  if (id === 'me') return 'bubble_todo_v1';
  const pm = /^me\.(local|r[0-9a-z]{1,23})$/.exec(String(id || ''));
  if (pm) return 'bubble_todo_me_' + pm[1] + '_v1';   /* ほかの海域の個人（2026-11-12） */
  if (id === 'share') return 'bubble_todo_share_v1';
  return 'bubble_todo_sea_' + id + '_v1';
}

export function newId(now = Date.now()) {
  return 's' + now.toString(36) + Math.random().toString(36).slice(2, 6);
}

/* 人が入れた海の ID を整える（2026-11-12 Issue #47 の返事:「名前そのものが ID ではなく、裏側で管理の ID を作る。
   登録時に指定した ID が一致すれば共有、ID が空欄ならランダムな ID で登録」）。
   空なら ''（ランダムに作る）。英小文字・数字 3〜23 字。頭に s が無ければ足す（サーバーのフォルダ名の形 ID_RE。
   「family」と「sfamily」は同じ海になる。どの端末でも同じ規則なので、同じ字を入れれば同じ ID になる）。読めなければ null */
export function cleanId(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return '';
  if (ID_RE.test(s)) return s;
  const t = 's' + s;
  return ID_RE.test(t) ? t : null;
}

/* 海を作る → 作った1件。名前が空なら null。region を渡せばその繋ぎ先の海（省けば前の版からの個人と同じ繋ぎ先）。
   id を渡すとその ID で作る（cleanId で整えたもの。この端末に同じ ID の海が今あれば null。消した印だけなら作り直す） */
export function addSea(name, color, now = Date.now(), region, id) {
  const nm = cleanName(name);
  if (!nm) return null;
  const rows = allEntries();
  const want = id ? String(id) : newId(now);
  const i = rows.findIndex(x => x.id === want);
  if (i >= 0 && rows[i].alive) return null;
  const e = cleanEntry({ id: want, name: nm, color, at: i >= 0 ? Math.max(now, rows[i].at + 1) : now, alive: 1, region });
  if (!e) return null;
  if (i >= 0) rows[i] = e; else rows.push(e);
  return save(rows) ? e : null;
}

/* 海の同期の設定（どの繋ぎ先と合わせるか）を替える（Issue #47 の返事）。記録の箱は動かさない。
   region はこの端末だけの印でサーバーへは送らないので、書き換えた時刻 at は進めない */
export function setSeaRegion(id, region) {
  if (!REGION_ID_RE.test(String(region || ''))) return false;
  const rows = allEntries();
  const e = rows.find(x => x.id === id && x.alive);
  if (!e) return false;
  e.region = String(region);
  return save(rows);
}

/* 名前・色を変える。変えられなければ false */
export function updateSea(id, patch, now = Date.now()) {
  const rows = allEntries();
  const e = rows.find(x => x.id === id && x.alive);
  if (!e) return false;
  if (patch && patch.name !== undefined) {
    const nm = cleanName(patch.name);
    if (!nm) return false;
    e.name = nm;
  }
  if (patch && patch.color !== undefined && COLOR_IDS.indexOf(patch.color) >= 0) e.color = patch.color;
  e.at = Math.max(now, e.at + 1);
  return save(rows);
}

/* 海を消す（一覧に消した印を残す。ほかの端末の一覧からも外れる） */
export function removeSea(id, now = Date.now()) {
  const rows = allEntries();
  const e = rows.find(x => x.id === id && x.alive);
  if (!e) return false;
  e.alive = 0;
  e.at = Math.max(now, e.at + 1);
  return save(rows);
}

/* サーバーの一覧と合わせる。海ごとに新しいほう（同じ時刻なら手元）。変わったら true。
   region を渡すと（その海域のサーバーから来た一覧）、新しく来た海をその海域の海にする。手元にある海の region は替えない。
   渡さないとき（控え・引っ越しのファイル）は、ファイルの region をそのまま使う（この端末の知らない海域なら、その海は出ない） */
export function mergeSeas(remote, region) {
  const rows = allEntries();
  let changed = false;
  (Array.isArray(remote) ? remote : []).forEach(r => {
    /* サーバーから来た一覧（region を渡したとき）の region は信じない。控え・引っ越しのファイル（渡さないとき）は残す */
    const e = cleanEntry(region !== undefined ? Object.assign({}, r, { region: undefined }) : r);
    if (!e) return;
    const i = rows.findIndex(x => x.id === e.id);
    if (i < 0) {
      if (REGION_ID_RE.test(String(region || ''))) e.region = String(region);
      rows.push(e); changed = true; return;
    }
    if (e.at > rows[i].at) {
      if (rows[i].region) e.region = rows[i].region;
      if (JSON.stringify(rows[i]) !== JSON.stringify(e)) changed = true;
      rows[i] = e;
    }
  });
  if (changed) save(rows);
  return changed;
}
