/* 漂い方（2026-11-27 利用者の指示「A~Cは海の設定で選べる様に、デフォルトはC」「DEは実装」。
   app_spec の mock/drift-1127.html・minutes/261127_漂いを楽しむ海.md）。

   前は弱い重力で沈み、底に着くとそこで止まり続けたので、時間がたつほど泡が底に溜まった
   （30 分ぶん進めると 93 % が底の 2 割。やり残しの山に見える）。海ごとに漂い方を選べる：

     breath  C 沈んで、また浮かぶ（既定）… 今の沈み方のまま。底（か底の泡の上）で 20〜60 秒休むと、
             6 px/秒でふわっと浮かび直し、海の上から 15〜70 % のどこかまで上がって、また沈む
     neutral A 浮きも沈みもしない … 重力をやめ、泡ごとに好きな深さを持つ（20〜40 秒ごとに替える）
     tide    B ゆるい潮の流れ … 海の中をゆっくり大きく回る流れ（1 周 2〜3 分）

   どれも今日の画面の「先に」「大事」の比重（js/drift.js の buoyBand）はそのまま効く。
   添えるもの（どの漂い方でも）：D かき混ぜる（泡の無い水をなぞると近くの泡が流れる）、E 水面の光（CSS だけ）。
   **何も記録しない・数えない。**眺めるだけのもの。

   選んだ漂い方は、この端末に海ごとに覚える（localStorage。サーバーへは送らない）。
   この file は DOM を知らない（tests/driftmode.test.mjs が確かめる）。 */

export const DRIFT_KEY = 'bubble_todo_drift_v1';
export const DRIFT_DEFAULT = 'breath';
export const DRIFT_MODES = [
  { id: 'breath', name: '沈んで、また浮かぶ' },
  { id: 'neutral', name: '浮きも沈みもしない' },
  { id: 'tide', name: 'ゆるい潮の流れ' },
];
const IDS = new Set(DRIFT_MODES.map(m => m.id));
const SPACE_KEY = 'bubble_todo_space';   /* js/store.js の SPACE_KEY と同じ箱（store を読み込まずに済ませる） */

/* C の値 */
export const BREATH = { restMin: 20, restMax: 60, riseV: 6, from: 0.15, to: 0.7 };
/* A の値 */
export const NEUTRAL = { every: [20, 40], depth: [0.08, 0.88], maxV: 4, gain: 0.05, rate: 0.6 };
/* B の値（流れの速さ px/秒） */
export const TIDE = { u: 7, rate: 0.5 };
/* D の値 */
export const STIR = { radius: 90, gain: 0.25, maxDv: 60, rippleV: 150, rippleEvery: 500 };

function ls(st) {
  if (st) return st;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}
function readMap(st) {
  try {
    const v = JSON.parse((ls(st) && ls(st).getItem(DRIFT_KEY)) || 'null');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}

/* その海の漂い方。決めていなければ既定（C） */
export function driftModeOf(seaId, st) {
  const v = readMap(st)[String(seaId || 'me')];
  return IDS.has(v) ? v : DRIFT_DEFAULT;
}
/* 決める → 変わったか。既定に戻すときは欄を消す */
export function setDriftMode(seaId, mode, st) {
  const s = ls(st);
  if (!s || !IDS.has(mode)) return false;
  const id = String(seaId || 'me');
  const m = readMap(s);
  const before = IDS.has(m[id]) ? m[id] : DRIFT_DEFAULT;
  if (before === mode) return false;
  if (mode === DRIFT_DEFAULT) delete m[id]; else m[id] = mode;
  try { s.setItem(DRIFT_KEY, JSON.stringify(m)); } catch (e) { return false; }
  cache = null;
  return true;
}
/* 開いている海の漂い方。物理が毎コマ読むので、変えるまで覚えておく */
let cache = null;
export function currentDriftMode(st) {
  if (cache && !st) return cache;
  let id = 'me';
  try { id = (ls(st) && ls(st).getItem(SPACE_KEY)) || 'me'; } catch (e) { id = 'me'; }
  const m = driftModeOf(id, st);
  if (!st) cache = m;
  return m;
}
export function forgetDriftCache() { cache = null; }

/* B：1 つの大きな渦。流れの関数 ψ = U·w/π·sin(πx/w)·sin(πy/h) から速さ [vx, vy] を出す。
   左右の壁と上下で流れが壁に沿い、真ん中のまわりを回る */
export function tideVel(x, y, w, h, u = TIDE.u) {
  if (!(w > 0) || !(h > 0)) return [0, 0];
  const sx = Math.PI * x / w, sy = Math.PI * y / h;
  return [u * Math.sin(sx) * Math.cos(sy), -u * (w / h) * Math.cos(sx) * Math.sin(sy)];
}

/* C：浮かび直す先の高さ（泡の中心の y）。rnd は 0〜1 */
export function riseTarget(h, r, rnd) {
  const span = Math.max(0, h - 2 * r);
  return r + (BREATH.from + rnd * (BREATH.to - BREATH.from)) * span;
}
/* C：底で休む長さ（秒）。rnd は 0〜1 */
export function restFor(rnd) { return BREATH.restMin + rnd * (BREATH.restMax - BREATH.restMin); }

/* A：好きな深さ（0〜1）の泡の中心の y へ寄せたい上下の速さ */
export function neutralVy(cy, ty) {
  const v = (ty - cy) * NEUTRAL.gain;
  return Math.max(-NEUTRAL.maxV, Math.min(NEUTRAL.maxV, v));
}

/* D：なぞった点から dist の泡に足す速さ [dvx, dvy]。届かなければ null */
export function stirImpulse(dist, vx, vy) {
  if (!(dist >= 0) || dist >= STIR.radius) return null;
  const f = (1 - dist / STIR.radius) * STIR.gain;
  const c = v => Math.max(-STIR.maxDv, Math.min(STIR.maxDv, v * f));
  return [c(vx), c(vy)];
}
