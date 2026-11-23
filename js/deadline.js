/* 日付で見る（終了日の近い順。2026-11-07 Issue #24）。計算だけ（DOM・保存・通信を触らない）。

   終了日は次のうち遠いほう:
     ・泡の欄 due（期間の正本。start があれば期間の帯。盤の「期間」・先の予定・gantt_todo が書く。共有の記録 v1.1）
       欄が無い古い記録だけ、本文の「期間: A 〜 B」の B、「日付: A」の A を読む（Issue #34 までの書き方）
     ・盤の「いつの日」で置いた日（days）のうち、今日から先の最後の日
   今日から先のものだけを使う。**過ぎた日は数えない**（「期限切れ」「◯日過ぎ」を出さない。README の禁止事項）。
   完了したものは並べない。 */

import { holidayName } from './holiday.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SPAN_RE = /^期間: (\d{4}-\d{2}-\d{2}) 〜 (\d{4}-\d{2}-\d{2})/m;
const DATE_RE = /^日付: (\d{4}-\d{2}-\d{2})/m;

export const COLS_MIN = 14;    /* 表の列（日）の最少。2週間 */
export const COLS_MAX = 60;    /* 最多。これより先の日は右端に「→」 */

function z(x) { return String(x).padStart(2, '0'); }
export function keyOf(d) { return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }

function dateOf(key) {
  const m = DAY_RE.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  return (d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
}

export function addDays(key, n) {
  const d = dateOf(key);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

/* a から b まで何日か（正午どうしで数えるので夏時間でもずれない） */
export function daysBetween(a, b) {
  const x = dateOf(a), y = dateOf(b);
  if (!x || !y) return NaN;
  return Math.round((y - x) / 86400000);
}

/* 本文から読む期間。{ start, end } か null */
export function spanFromDetail(detail) {
  const s = String(detail || '');
  let m = SPAN_RE.exec(s);
  if (m && dateOf(m[1]) && dateOf(m[2]) && m[1] <= m[2]) return { start: m[1], end: m[2] };
  m = DATE_RE.exec(s);
  if (m && dateOf(m[1])) return { start: m[1], end: m[1] };
  return null;
}

/* 本文の期間の行を書き替える（2026-11-10 Issue #34）。
   v1.1（同じ日）から盤の「期間」は start・due に書くので、新しくは書かない。
   盤が古い行を外すとき（withSpan(本文, '', '')）にだけ使う。
   泡に開始日・終了日の欄を足さず、上の spanFromDetail が読む行を本文に置く
   ——同期・CSV・先の予定・日付で見る は今のまま読める。
     ・開始日と終了日 → `期間: A 〜 B`（同じ日なら `日付: A`）
     ・片方だけ      → その日1日（`日付: A`）
     ・逆に入れた    → 入れ替える
     ・両方空        → 行を消す
   行の頭にある期間・日付の行（最初の1つ）を置き換え、日付のあとの文（「（予定）」など）は残す。
   無ければ本文の終わりに1行足す。日付が読めないものは無いものとして扱う。 */
const SPAN_LINE_RE = /^期間: \d{4}-\d{2}-\d{2} 〜 \d{4}-\d{2}-\d{2}(.*)$/m;
const DATE_LINE_RE = /^日付: \d{4}-\d{2}-\d{2}(.*)$/m;

export function withSpan(detail, start, end) {
  const s = String(detail || '');
  let a = dateOf(start) ? start : null;
  let b = dateOf(end) ? end : null;
  if (!a) a = b;
  if (!b) b = a;
  if (a && b && b < a) { const x = a; a = b; b = x; }
  const line = !a ? '' : (a === b ? '日付: ' + a : '期間: ' + a + ' 〜 ' + b);

  const m = SPAN_LINE_RE.exec(s) || DATE_LINE_RE.exec(s);
  if (m) {
    const head = s.slice(0, m.index), tail = s.slice(m.index + m[0].length);
    if (line) return head + line + m[1] + tail;
    /* 消すときは改行も1つ連れていく（空の行を残さない） */
    if (tail.startsWith('\n')) return head + tail.slice(1);
    return head.endsWith('\n') ? head.slice(0, -1) : head;
  }
  if (!line) return s;
  if (!s) return line;
  return s + (s.endsWith('\n') ? '' : '\n') + line;
}

/* 1つの泡の終了日と、表に印を付ける日。終了日が無い（今日から先の日が無い）なら null
   返り値 = { end, days: [今日から先の置いた日], span: {start,end}|null, from: 'days'|'detail' } */
export function deadlineOf(t, today) {
  if (!t || t.done || t.trashed) return null;
  const days = (Array.isArray(t.days) ? t.days : []).filter(k => dateOf(k) && k >= today).sort();
  /* 期間の正本は start・due（共有の記録 v1.1。2026-11-10 利用者の決定）。
     本文の「期間:」「日付:」の行は、欄の無い古い記録を読むときだけ使う */
  const sd = spanFromFields(t);
  const src = sd || spanFromDetail(t.detail);
  const span = src && src.end >= today ? src : null;
  const a = days.length ? days[days.length - 1] : null;
  const b = span ? span.end : null;
  if (!a && !b) return null;
  const end = (a && b) ? (a > b ? a : b) : (a || b);
  return { end, days, span, from: end === b ? (sd ? 'due' : 'detail') : 'days' };
}

/* 欄から読む期間。due が無ければ null。start が無いか due より後なら due の1日 */
function spanFromFields(t) {
  const end = dateOf(t.due) ? t.due : null;
  if (!end) return null;
  const start = dateOf(t.start) && t.start <= end ? t.start : end;
  return { start, end };
}

/* 並べる行。終了日の近い順、同じ日なら書いた順（古いほうが上） */
export function deadlineRows(items, today) {
  const rows = [];
  (items || []).forEach(t => {
    const d = deadlineOf(t, today);
    if (d) rows.push({ id: t.id, text: t.text, createdAt: t.createdAt || 0, left: daysBetween(today, d.end), ...d });
  });
  rows.sort((p, q) => (p.end < q.end ? -1 : p.end > q.end ? 1 : p.createdAt - q.createdAt));
  return rows;
}

/* 完了の海の行（2026-11-13 Issue #57）。完了した日の新しい順、同じ日なら完了した時刻の新しい順。
   end＝完了した日、left＝何日前か。完了した時刻を持たないもの（古いデータ）は並べない。
   印は cellMark の 'end'（完了した日の ●）だけ。置いた日・期間は出さない */
export function doneRows(items, today) {
  const rows = [];
  (items || []).forEach(t => {
    if (!t || !t.done || t.trashed) return;
    const at = Number(t.doneAt);
    if (!Number.isFinite(at) || at <= 0) return;
    const end = keyOf(new Date(at));
    const left = daysBetween(end, today);
    if (!(left >= 0)) return;                  /* 端末の時計が戻ったなどで未来の日なら出さない */
    rows.push({ id: t.id, text: t.text, doneAt: at, end, left, days: [], span: null });
  });
  rows.sort((p, q) => q.doneAt - p.doneAt);
  return rows;
}

/* 何日前の札。0 は「今日」、1 は「昨日」 */
export function agoLabel(n) {
  if (n === 0) return '今日';
  if (n === 1) return '昨日';
  return n + '日前';
}

/* 何列（日）出すか。いちばん遠い終了日まで。少なくとも2週間、多くても60日 */
export function columnCount(rows) {
  const far = rows.reduce((m, r) => Math.max(m, r.left), 0);
  return Math.max(COLS_MIN, Math.min(COLS_MAX, far + 1));
}

/* あと何日の札。0 は「今日」、1 は「あした」。命令形にしない・色で急かさない */
export function leftLabel(n) {
  if (n === 0) return '今日';
  if (n === 1) return 'あした';
  return 'あと' + n + '日';
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
/* 列の見出し。{ key, d: 日, m: 月（月の頭か最初の列だけ）, wd: 曜日, sun, sat, hol: 祝日の名前か '', off: 日曜か祝日 } */
/* dir = -1 なら今日から過去へ（完了の海。2026-11-13 Issue #57）。月の名前は、最初の列と月が変わった列に出す */
export function columns(today, n, dir = 1) {
  const out = [];
  let prevMonth = -1;
  for (let i = 0; i < n; i++) {
    const key = addDays(today, dir < 0 ? -i : i);
    const dt = dateOf(key);
    const day = dt.getDate();
    const mon = dt.getMonth();
    const newMonth = i === 0 || mon !== prevMonth;
    prevMonth = mon;
    out.push({
      key, d: day, m: newMonth ? (mon + 1) + '月' : '',
      wd: WD[dt.getDay()], sun: dt.getDay() === 0, sat: dt.getDay() === 6,
      hol: holidayName(key),
    });
    out[i].off = out[i].sun || !!out[i].hol;
  }
  return out;
}

/* ---- まとめて見る（1週間・1か月。2026-11-21 Issue #80） ----
   海のリスト表示の形「週」「月」（js/periodview.js。2026-11-22 は下のタブの画面、2026-11-23 Issue #80 の返事でリスト表示へ）の中身。
   from の日から n 日ぶんを日ごとに並べる。
   日に出すのは、その日に置いたもの（days）と、期間（start・due。欄の無い古い記録は本文の行）の
   始まる日・終わる日と、完了した日（doneAt）。完了したものも出す（今日の水面と同じく、その日に何をしたかが残るように）。
   過ぎた日を数えたり、「期限切れ」と出したりはしない。 */

/* from の日から、翌月の同じ日の前日までの日数（月末はその月の末日につぶす。1/31 → 2/28 まで） */
export function monthSpanDays(from) {
  const d = dateOf(from);
  if (!d) return 30;
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const last = new Date(y, m + 1, 0, 12).getDate();
  const to = new Date(y, m, Math.min(day, last), 12);
  return Math.round((to - d) / 86400000);
}

/* 週・月の画面の、1 日ぶんの行の絞り込みと並び（2026-11-22 Issue #80 の返事「完了と未完了を分けて表示とソートできるようにできる？」）。
   show: 'all'（まだ → 済んだ の順に分けて全部）・'todo'（まだだけ）・'done'（済んだだけ）
   order: 'old'（書いた順）・'new'（新しい順）・'name'（名前の順） */
export const PERIOD_SHOW = ['all', 'todo', 'done'];
export const PERIOD_ORDER = ['old', 'new', 'name'];
export function arrangeRows(rows, opt = {}) {
  const show = PERIOD_SHOW.indexOf(opt.show) >= 0 ? opt.show : 'all';
  const order = PERIOD_ORDER.indexOf(opt.order) >= 0 ? opt.order : 'old';
  let a = (rows || []).filter(r => show === 'all' || (show === 'done' ? r.done : !r.done));
  const cmp = order === 'name'
    ? (p, q) => String(p.text || '').localeCompare(String(q.text || ''), 'ja')
    : order === 'new' ? (p, q) => (q.createdAt || 0) - (p.createdAt || 0)
      : (p, q) => (p.createdAt || 0) - (q.createdAt || 0);
  a = a.slice().sort((p, q) => (show === 'all' && !!p.done !== !!q.done) ? (p.done ? 1 : -1) : cmp(p, q));
  return a;
}

/* その日を含む週の月曜（2026-11-22 Issue #80 の返事。週・月の画面の「今週」は月曜から日曜） */
export function weekStart(key) {
  const d = dateOf(key);
  if (!d) return null;
  return addDays(key, -((d.getDay() + 6) % 7));
}

/* その月の 1 日と日数。y は西暦、m は 1〜12 */
export function monthRange(y, m) {
  const yy = Math.floor(Number(y)), mm = Math.floor(Number(m));
  if (!(yy >= 1970 && yy <= 9999 && mm >= 1 && mm <= 12)) return null;
  return { from: yy + '-' + z(mm) + '-01', n: new Date(yy, mm, 0, 12).getDate() };
}

/* -> [{ key, m, d, wd, sat, sun, hol, off, rows: [{ id, text, done, kinds: ['day'|'start'|'end'|'done'] }] }]
   rows は書いた順（古いほうが上）。何も無い日も返す（板が畳む） */
export function periodDays(items, from, n) {
  const cols = dateOf(from) && n > 0 ? columns(from, n) : [];
  if (!cols.length) return [];
  const last = cols[cols.length - 1].key;
  const at = new Map(cols.map(c => [c.key, new Map()]));
  const mark = (t, key, kind) => {
    const box = at.get(key);
    if (!box) return;
    let r = box.get(t.id);
    if (!r) { r = { id: t.id, text: t.text, done: !!t.done, createdAt: t.createdAt || 0, kinds: [] }; box.set(t.id, r); }
    if (r.kinds.indexOf(kind) < 0) r.kinds.push(kind);
  };
  (items || []).forEach(t => {
    if (!t || t.trashed) return;
    (Array.isArray(t.days) ? t.days : []).forEach(k => { if (k >= from && k <= last) mark(t, k, 'day'); });
    const sp = spanFromFields(t) || spanFromDetail(t.detail);
    if (sp) {
      if (sp.start !== sp.end) mark(t, sp.start, 'start');
      mark(t, sp.end, 'end');
    }
    /* 完了した日（2026-11-22 Issue #80 の返事「過去分も確認できる」）。完了の時刻を持つものだけ */
    const at2 = Number(t.doneAt);
    if (t.done && Number.isFinite(at2) && at2 > 0) mark(t, keyOf(new Date(at2)), 'done');
  });
  return cols.map(c => {
    const rows = [...at.get(c.key).values()].sort((p, q) => p.createdAt - q.createdAt);
    return Object.assign({}, c, { rows });
  });
}

/* 1つの行の、1つの列の印。'end'＝終了日、'day'＝置いた日、'span'＝期間の中、''＝何も無い */
export function cellMark(row, key) {
  if (key === row.end) return 'end';
  if (row.days.indexOf(key) >= 0) return 'day';
  if (row.span && row.span.start <= key && key <= row.span.end) return 'span';
  return '';
}

/* 期間の中か（印の下に帯を敷く。終了日・置いた日の上でも帯は切らない） */
export function inSpan(row, key) {
  return !!(row.span && row.span.start <= key && key <= row.span.end);
}
