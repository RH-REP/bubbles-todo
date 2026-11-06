/* 似ている泡を近くへ寄せる（Issue #23。2026-11-07）。

   漂う面（海・今日）で、似ている泡どうしが、ゆっくり互いに近づく。
   「まとめる」「束ねる」はしない。記録には何も書かない（紐付けの欄は持たない）。
   見た目の位置だけが、同じようなものの近くへ流れていく。

   ■ 何を「似ている」とするか（端末の中だけで計算する。どこへも送らない）
     ・名前の文字の重なり。2文字ずつの組（bigram）の Dice 係数。
       日本語は単語の区切りが無いので、2文字の組で比べる。
       ひらがなだけの組（「する」「して」「を」）は数えない。
       「〜を買う」「〜を送る」の送りがなだけで似ていることにしないため
     ・同じタグ。ただし、その面の泡**すべて**に付いているタグは数えない
       （タグの海は全部が同じタグなので、数えると全部が1つに固まる）
   ■ 寄せ方
     ・1つの泡が引かれる相手は、似ているほうから PULL_MAX 個まで。
       多く引くと、海の真ん中に1つの塊ができる
     ・近づく速さに上限（PULL_V）を置く。漂う速さ（16px/s）より遅い。
       速さが上限に届いていなければ、弱い加速（PULL_A）を足すだけ。
       ぶつかり・重力・漂いのゆらぎはそのまま効くので、くっつかず、近くに居るだけになる
     ・隙間が PULL_NEAR より狭くなったら引かない（押し合いで震えないため）
   ■ 消し方
     設定の「似ている泡を近くに寄せる」（端末にだけ置く。既定オン。bubble_todo_affinity_v1）。
     「視差効果を減らす」のときは漂いそのものが止まるので、寄せもしない

   DOM・store・保存を触らない（drift.js が呼ぶ）。テストは tests/related.test.mjs */

export const AFFINITY_KEY = 'bubble_todo_affinity_v1';

export const PULL_MIN = 0.3;    /* これより似ていない組は引かない */
export const PULL_MAX = 2;      /* 1つの泡が引かれる相手の数の上限 */
export const PULL_A = 6;        /* 加速 px/s²（似ている度合い 1 のとき）。重力 GRAV=2 の3倍 */
export const PULL_V = 8;        /* 近づく速さの上限 px/s（同上）。漂う速さ SPEED=16 の半分 */
export const PULL_NEAR = 18;    /* 隙間がこれより狭ければ引かない px */
const TAG_W = 0.5;              /* 同じタグ1つぶんの重み */

/* ---------------- 似ている度合い ---------------- */

const HIRA = /^[ぁ-ゟー]+$/;   /* ひらがなと長音だけ */

export function normalize(text) {
  let s = String(text == null ? '' : text);
  try { s = s.normalize('NFKC'); } catch (_) { /* 古い環境はそのまま */ }
  /* 字と数字だけを残す（空白・記号・絵文字を落とす） */
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function grams(text) {
  const s = [...normalize(text)];
  const out = new Set();
  if (s.length === 1) { if (!HIRA.test(s[0])) out.add(s[0]); return out; }
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s[i] + s[i + 1];
    if (!HIRA.test(g)) out.add(g);
  }
  return out;
}

export function textSimilarity(a, b) {
  const A = (a instanceof Set) ? a : grams(a);
  const B = (b instanceof Set) ? b : grams(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  A.forEach(g => { if (B.has(g)) both++; });
  return (2 * both) / (A.size + B.size);
}

/* items = [{id, text, tagNames}]。返すのは [{a, b, w}]（a・b は items の添字、w は 0〜1）。
   1つの泡が出てくる組は PULL_MAX 個まで（似ているほうから取る） */
export function relatedPairs(items) {
  const list = Array.isArray(items) ? items : [];
  const n = list.length;
  if (n < 2) return [];

  const gs = list.map(it => grams(it && it.text));
  const tags = list.map(it => new Set(Array.isArray(it && it.tagNames) ? it.tagNames : []));
  /* 全員に付いているタグは、見分けの手がかりにならない */
  const common = new Set([...tags[0]].filter(t => tags.every(s => s.has(t))));

  const all = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let shared = 0;
      tags[i].forEach(t => { if (!common.has(t) && tags[j].has(t)) shared++; });
      const w = Math.min(1, textSimilarity(gs[i], gs[j]) + TAG_W * shared);
      if (w >= PULL_MIN) all.push({ a: i, b: j, w });
    }
  }
  /* 似ているほうから、両方の枠が空いている組だけを取る。並びが同じなら結果も同じ */
  all.sort((x, y) => (y.w - x.w) || (x.a - y.a) || (x.b - y.b));
  const used = new Array(n).fill(0);
  const out = [];
  all.forEach(p => {
    if (used[p.a] >= PULL_MAX || used[p.b] >= PULL_MAX) return;
    used[p.a]++; used[p.b]++;
    out.push(p);
  });
  return out;
}

/* ---------------- 寄せる力 ----------------
   bodies = [{cx, cy, vx, vy, d, free}]（free が false のもの＝掴んでいる・はまっている、は動かさない）。
   速度だけを書き換える。位置は drift の積分に任せる */
export function pullStep(pairs, bodies, dt) {
  if (!pairs || !pairs.length || !(dt > 0)) return;
  pairs.forEach(p => {
    const a = bodies[p.a], c = bodies[p.b];
    if (!a || !c || (!a.free && !c.free)) return;
    const dx = c.cx - a.cx, dy = c.cy - a.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    const gap = dist - (a.d + c.d) / 2;
    if (gap <= PULL_NEAR) return;
    const nx = dx / dist, ny = dy / dist;
    /* いま近づいている速さ（正なら近づいている） */
    const closing = ((a.free ? a.vx : 0) - (c.free ? c.vx : 0)) * nx
                  + ((a.free ? a.vy : 0) - (c.free ? c.vy : 0)) * ny;
    const vmax = PULL_V * p.w;
    if (closing >= vmax) return;
    /* 上限を越えないぶんだけ足す。片方しか動けないときは、動けるほうが全部を受け持つ */
    const dv = Math.min(PULL_A * p.w * dt * 2, vmax - closing);
    const share = (a.free && c.free) ? 0.5 : 1;
    if (a.free) { a.vx += nx * dv * share; a.vy += ny * dv * share; }
    if (c.free) { c.vx -= nx * dv * share; c.vy -= ny * dv * share; }
  });
}

/* ---------------- 設定（端末にだけ置く） ---------------- */

let cached = null;

export function isAffinityOn() {
  if (cached !== null) return cached;
  let v = null;
  try { v = globalThis.localStorage ? globalThis.localStorage.getItem(AFFINITY_KEY) : null; }
  catch (_) { /* プライベートモードなど。既定に倒す */ }
  cached = (v === null || v === undefined) ? true : v !== '0';
  return cached;
}

export function setAffinityOn(on) {
  cached = !!on;
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(AFFINITY_KEY, cached ? '1' : '0'); }
  catch (_) { /* 保存できなくても今回は効かせる */ }
  return cached;
}
