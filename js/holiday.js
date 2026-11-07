/* 日本の祝日（日付で見るの色分け。2026-11-07 Issue #24 の返事）。計算だけ（通信しない）。

   「国民の祝日に関する法律」の今の決まり（2020 年以降の形）で、年ごとに出す:
     ・決まった日（元日・建国記念の日・天皇誕生日・昭和の日・憲法記念日・みどりの日・こどもの日・
       山の日・文化の日・勤労感謝の日）
     ・月曜に寄せる日（成人の日・海の日・敬老の日・スポーツの日。ハッピーマンデー）
     ・春分の日・秋分の日（天文の計算の近似式。1980〜2099 年で合う。正式には前の年の2月に官報で決まる）
     ・振替休日（祝日が日曜なら、その後のいちばん近い祝日でない日）
     ・国民の休日（祝日と祝日に挟まれた平日）
   2019〜2021 年の特例（即位の日・五輪の移動）は入れていない（日付で見るは今日から先しか出さないため）。
   法律が変わったら、ここを直す。 */

const z = x => String(x).padStart(2, '0');
const key = (y, m, d) => y + '-' + z(m) + '-' + z(d);

/* その月の n 番目の月曜 */
function nthMonday(y, m, n) {
  const first = new Date(y, m - 1, 1, 12).getDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

export function springEquinox(y) {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}
export function autumnEquinox(y) {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

const cache = new Map();

/* その年の祝日。Map<'YYYY-MM-DD', 名前> */
export function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const h = new Map();
  if (y < 1980 || y > 2099) { cache.set(y, h); return h; }
  const add = (m, d, name) => h.set(key(y, m, d), name);
  add(1, 1, '元日');
  add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, springEquinox(y), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthMonday(y, 7, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthMonday(y, 9, 3), '敬老の日');
  add(9, autumnEquinox(y), '秋分の日');
  add(10, nthMonday(y, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  const base = [...h.keys()].sort();
  /* 国民の休日: 前の日と次の日が祝日で、自分は祝日でも日曜でもない日 */
  base.forEach(k => {
    const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12);
    d.setDate(d.getDate() + 2);
    const k2 = key(d.getFullYear(), d.getMonth() + 1, d.getDate());
    d.setDate(d.getDate() - 1);
    const mid = key(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (h.has(k2) && !h.has(mid) && d.getDay() !== 0) h.set(mid, '国民の休日');
  });
  /* 振替休日: 日曜の祝日のあと、祝日でない最初の日 */
  [...h.keys()].sort().forEach(k => {
    const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12);
    if (d.getDay() !== 0) return;
    do { d.setDate(d.getDate() + 1); } while (h.has(key(d.getFullYear(), d.getMonth() + 1, d.getDate())));
    h.set(key(d.getFullYear(), d.getMonth() + 1, d.getDate()), '振替休日');
  });
  cache.set(y, h);
  return h;
}

/* 'YYYY-MM-DD' の祝日の名前。祝日でなければ '' */
export function holidayName(k) {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(k || ''));
  if (!m) return '';
  return holidaysOf(+m[1]).get(k) || '';
}
