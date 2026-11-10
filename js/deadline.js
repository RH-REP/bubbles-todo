/* 日付で見る（終了日の近い順。2026-11-07 Issue #24）。計算だけ（DOM・保存・通信を触らない）。

   泡に「終了日」という欄は無い。今ある日付から読む:
     ・盤の「いつの日」で置いた日（days）のうち、今日から先の最後の日
     ・先の予定（AI）で入れた泡の本文の「期間: A 〜 B」の B、「日付: A」の A
     ・共有の記録 v1 の due（gantt が書く欄。start があれば期間の帯にも使う。本文の期間が先）
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

/* 本文の期間の行を書き替える（盤の「期間」。2026-11-10 Issue #34）。
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
  const sp = spanFromDetail(t.detail);
  /* 共有の記録 v1 の start・due（gantt が書く欄。2026-11-10）。本文の期間が無いときの期間にもする */
  const sd = spanFromFields(t);
  const span = sp && sp.end >= today ? sp : (sd && sd.end >= today ? sd : null);
  const a = days.length ? days[days.length - 1] : null;
  const b = span ? span.end : null;
  const c = sd && sd.end >= today ? sd.end : null;
  if (!a && !b && !c) return null;
  const end = [a, b, c].filter(Boolean).sort().pop();
  return { end, days, span, from: end === b ? (span === sd ? 'due' : 'detail') : end === c ? 'due' : 'days' };
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
export function columns(today, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const key = addDays(today, i);
    const dt = dateOf(key);
    const day = dt.getDate();
    out.push({
      key, d: day, m: (i === 0 || day === 1) ? (dt.getMonth() + 1) + '月' : '',
      wd: WD[dt.getDay()], sun: dt.getDay() === 0, sat: dt.getDay() === 6,
      hol: holidayName(key),
    });
    out[i].off = out[i].sun || !!out[i].hol;
  }
  return out;
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
