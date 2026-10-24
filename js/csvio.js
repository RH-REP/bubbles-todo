/* 記録の CSV の書き出し・読み込み（2026-10-24。利用者の指示：引っ越しに使う）。
   DOM は触らない（設定の画面 settings.js が使う。テストは tests/csvio.test.mjs）。

   ■ 形（1つのファイル、1行1件）
     kind,id,text,date,data,stamp
     meta,bubbles,個人,2026-10-24T10:00:00,"{""format"":""bubbles-csv"",""version"":1,…}",
     todo,b123,歯医者を予約,2026-10-20T09:12:00,"{…todo の中身…}",1792…
     anchor,a456,歯を磨いたら,,"{…}",…
     log,b123|null|1792…,歯医者を予約,2026-10-20T09:30:00,"{…}",…
     order,todo,,,"[""b123"",…]",…
   kind と id は merge.js の記録の鍵（todo:b123 など）を2つに分けたもの。text と date は人が見るための欄で、
   読み込みでは使わない（data の JSON が正本）。stamp は書き換えた時刻（merge.js の印）。
   先頭に BOM、行の区切りは \r\n（Excel で開いても化けない）。

   ■ 読み込みの2つのやり方（読み込むときに選ぶ）
     add       … 足す。今の記録はそのまま、CSV にしかない記録だけを足す。同じ CSV を2回読んでも増えない。
                  この端末で消した記録（墓石）は戻さない
     overwrite … 同じものは上書き。CSV と同じ id の記録を CSV の中身で書き換え、無いものは足す。
                  この端末にしかない記録は残す
   どちらも、読み込んだ記録には「今」の印を付ける（サーバーに繋いでいれば、ほかの端末へも届く）。
   並び順は今の端末のものを使い、足した記録は後ろに並ぶ。 */

import { recordsOf, buildDoc } from './merge.js';

export const FORMAT = 'bubbles-csv';
const HEADER = ['kind', 'id', 'text', 'date', 'data', 'stamp'];
const KINDS = new Set(['todo', 'anchor', 'gap', 'tag', 'log', 'tlog', 'flog', 'order', 'whole']);

/* ---------- CSV の1セル・1表 ---------- */
function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* 1文字ずつ読む。引用符の中の区切り・改行と "" に対応する */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function iso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n), p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 人が見る欄 */
function readable(kind, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['', ''];
  const text = typeof v.text === 'string' ? v.text : (typeof v.name === 'string' ? v.name : '');
  const date = iso(kind === 'todo' ? v.createdAt : v.at);
  return [text, date];
}

/* ---------- 書き出し ---------- */
/* state = { doc, stamps }（store.exportState()）。space = 'me' | 'share' */
export function toCsv(state, space, now = Date.now()) {
  const doc = (state && state.doc) || {};
  const stamps = (state && state.stamps) || {};
  const lines = [HEADER.join(',')];
  const meta = { format: FORMAT, version: 1, space, lastDay: doc.lastDay || null };
  lines.push(['meta', 'bubbles', space === 'share' ? '共有' : '個人', iso(now), JSON.stringify(meta), ''].map(cell).join(','));
  recordsOf(doc).forEach((v, key) => {
    const at = key.indexOf(':');
    const kind = key.slice(0, at), id = key.slice(at + 1);
    const [text, date] = readable(kind, v);
    const st = Array.isArray(stamps[key]) ? stamps[key][0] : '';
    lines.push([kind, id, text, date, JSON.stringify(v), st].map(cell).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function csvFileName(space, now = Date.now()) {
  const d = iso(now).slice(0, 10).replace(/-/g, '');
  return `bubbles-${space === 'share' ? '共有' : '個人'}-${d}.csv`;
}

/* ---------- 読み込み ---------- */
/* CSV の文字列 → { meta, recs: Map(鍵 → 値) }。形が違えば、わけを書いた Error を投げる */
export function readCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('空のファイル');
  const head = rows[0].map(x => x.trim());
  if (HEADER.some((h, i) => head[i] !== h)) throw new Error('Bubbles の CSV ではない（1行目が kind,id,text,date,data,stamp でない）');
  let meta = null;
  const recs = new Map();
  let bad = 0;
  for (const r of rows.slice(1)) {
    const [kind, id, , , data] = r;
    if (kind === 'meta') {
      try { meta = JSON.parse(data); } catch (e) { /* 下で断る */ }
      continue;
    }
    if (!KINDS.has(kind) || !id) { bad++; continue; }
    try { recs.set(kind + ':' + id, JSON.parse(data)); } catch (e) { bad++; }
  }
  if (!meta || meta.format !== FORMAT) throw new Error('Bubbles の CSV ではない（meta の行が無い）');
  if (Number(meta.version) > 1) throw new Error('この app より新しい版の CSV（app を更新してから読み込む）');
  return { meta, recs, bad };
}

/* 今の状態 local（{ doc, stamps }）に、読んだ記録 imported（readCsv の戻り値）を mode で入れる。
   戻り値は { state: { doc, stamps }, added, replaced }（added・replaced は todo の数） */
export function importInto(local, imported, mode, now = Date.now()) {
  if (mode !== 'add' && mode !== 'overwrite') throw new Error('mode は add か overwrite');
  const doc = (local && local.doc) || {};
  const stamps = JSON.parse(JSON.stringify((local && local.stamps) || {}));
  const recs = recordsOf(doc);
  let added = 0, replaced = 0;
  imported.recs.forEach((v, key) => {
    if (key.startsWith('order:')) return;              /* 並び順は今の端末のもの */
    if (key.startsWith('whole:')) {                     /* 海の並び・消したはじめのタグ */
      if (mode === 'overwrite' || !recs.has(key)) { recs.set(key, v); stamps[key] = [now, 1]; }
      return;
    }
    const isTodo = key.startsWith('todo:');
    const has = recs.has(key);
    const dead = Array.isArray(stamps[key]) && stamps[key][1] === 0;
    if (mode === 'add' && (has || dead)) return;
    if (has) { if (isTodo) replaced++; } else if (isTodo) added++;
    recs.set(key, v);
    stamps[key] = [now, 1];
  });
  return { state: { doc: buildDoc(recs, doc), stamps }, added, replaced };
}
