/* くりかえし（2026-11-19 ユーザーの決定「7 つとも案どおり」。モック docs/spec/mock/dates.html）。
   store も盤も使う、日付だけの計算（記録には触らない）。node でも動く（DOM を使わない）。

   形（ext.bubble.repeat。bubble だけが読む欄）:
     { every: 'week'|'month', step: 1|2, of: 'span'|'day', from: 'YYYY-MM-DD', to?, n, at?, next?,
       dows?: [0..6], mdays?: [1..31], nth?: 1..5, dow?: 0..6, until?: 'YYYY-MM-DD' }
     of: 'span' … 期間（start・due）を、間隔ぶんずらす。from・to は元の期間、n は元から何回目か
                  （毎回「元 + n 回」で出すので、月末でつぶれた日がずれていかない）。前の「毎月くりかえす」はこれ
     of: 'day'  … やる日（days）を次の回へ送る。from は数え始めの日（2 週ごとの「どの週か」を決める）、
                  at はいまの回の日
       every 'week'  … dows の曜日（いくつでも）。step 2 なら from の週から 1 週おき
       every 'month' … mdays の日（いくつでも。2026-11-19「毎月の繰り返しを複数日付を選べる様にして」。月の長さでつぶす）か、
                       nth 回目の dow 曜日（5 は最終。きっかけの日にちと同じ数え方）。前の形の mday（1 つ）は mdays として読む
     until … この日より後の回は作らない（任意）
   前の形 { every: 'month', from, to, n } は of: 'span', step: 1 として読む（書き替えない）。 */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DOW_NAMES = '日月火水木金土';
const LAST = 5;

export function isKey(v) { return typeof v === 'string' && KEY.test(v); }

function toDate(key) {
  const m = KEY.exec(String(key || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0) : null;
}
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* 正午に寄せて動かす（夏時間の切り替え日でも日が飛ばない） */
export function addDays(key, n) {
  const d = toDate(key);
  if (!d) return null;
  d.setDate(d.getDate() + (Math.floor(Number(n)) || 0));
  return ymd(d);
}
/* 月末は月の長さでつぶす（1/31 の 1 か月後は 2/28） */
export function addMonths(key, n) {
  const m = KEY.exec(String(key || ''));
  if (!m) return null;
  const dd = Number(m[3]);
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + (Math.floor(Number(n)) || 0), 1, 12, 0, 0, 0);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0).getDate();
  d.setDate(Math.min(dd, last));
  return ymd(d);
}
export function dowOf(key) { const d = toDate(key); return d ? d.getDay() : null; }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function lastDayOfMonth(key) { const d = toDate(key); return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate(); }

/* 保存されうる値だけを通す。読めなければ null */
export function normalizeRepeat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const every = raw.every === 'week' ? 'week' : (raw.every === 'month' ? 'month' : null);
  if (!every) return null;
  const of = raw.of === 'day' ? 'day' : 'span';
  const step = (every === 'week' && Number(raw.step) === 2) ? 2 : 1;
  const from = isKey(raw.from) ? raw.from : null;
  if (!from) return null;
  const out = { every, step, of, from, n: Math.max(0, Math.floor(Number(raw.n)) || 0) };
  if (of === 'span') {
    const to = isKey(raw.to) ? raw.to : null;
    if (!to || to < from) return null;
    out.to = to;
  } else {
    if (every === 'week') {
      const dows = [...new Set((Array.isArray(raw.dows) ? raw.dows : []).map(Number).filter(x => x >= 0 && x <= 6 && Number.isInteger(x)))].sort((a, b) => a - b);
      if (!dows.length) return null;
      out.dows = dows;
    } else {
      const src = Array.isArray(raw.mdays) ? raw.mdays : (raw.mday != null ? [raw.mday] : []);
      const mdays = [...new Set(src.map(x => Math.floor(Number(x))).filter(x => x >= 1 && x <= 31))].sort((a, b) => a - b);
      const nth = Math.floor(Number(raw.nth)), dow = Math.floor(Number(raw.dow));
      if (mdays.length) out.mdays = mdays;
      else if (nth >= 1 && nth <= LAST && dow >= 0 && dow <= 6) { out.nth = nth; out.dow = dow; }
      else return null;
    }
    if (isKey(raw.at)) out.at = raw.at;
  }
  if (isKey(raw.until)) out.until = raw.until;
  if (typeof raw.next === 'string' && raw.next) out.next = raw.next;
  return out;
}

/* ---- 期間をずらす（of: 'span'） ---- */

/* 元の期間 + k 回 */
export function spanAt(r, k) {
  if (r.every === 'month') {
    const s = addMonths(r.from, k);
    let d = addMonths(r.to, k);
    if (s && d && d < s) d = s;
    return { start: s, due: d };
  }
  const w = 7 * r.step * k;
  return { start: addDays(r.from, w), due: addDays(r.to, w) };
}

/* 次の回の期間。n+1, n+2 … と進めて、終わる日が today より前でない最初の回。終わりの日を過ぎれば null */
export function nextSpan(r, today) {
  for (let k = r.n + 1; k <= r.n + 2000; k++) {
    const sp = spanAt(r, k);
    if (!sp.start || !sp.due) return null;
    if (r.until && sp.start > r.until) return null;
    if (sp.due >= today) return Object.assign(sp, { n: k });
  }
  return null;
}

/* ---- やる日を送る（of: 'day'） ---- */

/* その日が回の日か */
export function occursOn(r, key) {
  const dw = dowOf(key);
  if (dw === null || key < r.from) return false;
  if (r.until && key > r.until) return false;
  if (r.every === 'week') {
    if (r.dows.indexOf(dw) < 0) return false;
    if (r.step === 1) return true;
    const w = Math.floor(daysBetween(addDays(r.from, -dowOf(r.from)), addDays(key, -dw)) / 7);
    return w % r.step === 0;
  }
  const day = Number(key.slice(8, 10));
  if (r.mdays) { const last = lastDayOfMonth(key); return r.mdays.some(m => day === Math.min(m, last)); }
  if (dw !== r.dow) return false;
  if (r.nth === LAST) return day + 7 > lastDayOfMonth(key);
  return Math.ceil(day / 7) === r.nth;
}

/* after より後で、min 以上の最初の回の日（無ければ null）。min を省けば after の次の日から */
export function nextDay(r, after, min) {
  let k = addDays(after, 1);
  if (min && k < min) k = min;
  if (k < r.from) k = r.from;
  for (let i = 0; i < 800 && k; i++) {
    if (r.until && k > r.until) return null;
    if (occursOn(r, k)) return k;
    k = addDays(k, 1);
  }
  return null;
}

/* 先の count 回。of 'day' は日のキー、of 'span' は { start, due }。
   from より前は数えない。today 以上（span は終わる日が today 以上）だけ */
export function upcoming(r, today, count) {
  const out = [];
  if (!r) return out;
  if (r.of === 'span') {
    for (let k = r.n; k <= r.n + 2000 && out.length < count; k++) {
      const sp = spanAt(r, k);
      if (r.until && sp.start > r.until) break;
      if (sp.due >= today) out.push(sp);
    }
    return out;
  }
  let k = addDays(today, -1);
  while (out.length < count) {
    k = nextDay(r, k);
    if (!k) break;
    out.push(k);
  }
  return out;
}

/* ---- 言葉（盤の札の要約・言葉の表） ---- */
export function nthLabel(nth) { return nth === LAST ? '最終' : '第 ' + nth; }

export function repeatLabel(r) {
  if (!r) return 'なし';
  const iv = r.every === 'month' ? '毎月' : (r.step === 2 ? '2 週ごと' : '毎週');
  if (r.of === 'span') return iv + '（期間）';
  if (r.every === 'week') return iv + ' ' + r.dows.map(d => DOW_NAMES[d]).join('・');
  return iv + ' ' + (r.mdays ? r.mdays.join('・') + ' 日' : nthLabel(r.nth) + ' ' + DOW_NAMES[r.dow] + '曜');
}

/* 'M/D（曜）' */
export function mdw(key) {
  return Number(key.slice(5, 7)) + '/' + Number(key.slice(8, 10)) + '（' + DOW_NAMES[dowOf(key)] + '）';
}

/* その日が、その月の何回目のその曜日か（5 回目だけ最終。4 回目は 4 のまま） */
export function nthOf(key) {
  const day = Number(key.slice(8, 10));
  return day > 28 ? LAST : Math.ceil(day / 7);
}
