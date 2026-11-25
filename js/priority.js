/* 優先度（Eisenhower・2026-10-25）の区分。急ぐ・大事の2つの印から、4つの区分を出す。
   store も画面も読む（画面は store を直に読まず、盤は預け先を通すので、ここを分けた）。
   名前は命令形にしない。色は css の --q-<鍵> が持つ（赤は使わない）。 */

export const QUADRANTS = {
  now: { name: 'いま', sub: '急ぐ・大事' },
  grow: { name: '育てる', sub: '急がない・大事' },
  quick: { name: 'さっと', sub: '急ぐ・大事でない' },
  drift: { name: '漂わせる', sub: 'どちらでもない' },
};
/* どちらかが null（まだ）なら区分は無い */
export function quadrantFor(urgent, important) {
  if (urgent === null || urgent === undefined || important === null || important === undefined) return null;
  if (important) return urgent ? 'now' : 'grow';
  return urgent ? 'quick' : 'drift';
}

/* 区分の並び（2×2 の左上・右上・左下・右下） */
export const QUAD_ORDER = ['now', 'grow', 'quick', 'drift'];

/* ---------------- 選ぶときの基準（2026-11-24 ユーザーの決定「OK、推奨で実施」。app_spec の minutes/261124_選ぶときの基準.md）----------------
   見当・急ぐの分け方・先に済ませるの決まり。store も画面も読む（計算だけ。DOM・保存は触らない）。
   4 つの区分（quadrantFor）は今までどおり urgent と important だけから出す。ここの印は区分を変えない。 */

/* 見当（記録の鍵 size）。's'・'m'・'l'。無い＝まだ。分では入れない */
export const SIZES = { s: 'さっと', m: '半日まで', l: '何回も' };
/* 盤の札の字（さっとだけ目安の分を添える） */
export const SIZE_CHIP = { s: 'さっと（30 分まで）', m: '半日まで', l: '何回も' };
export function sizeOf(v) { return (v === 's' || v === 'm' || v === 'l') ? v : null; }

/* 急ぐの分け方（記録の鍵 dueKind）。urgent:true のときだけ意味を持つ。無ければ自分の目安 */
export const DUE_KINDS = { ext: '外の約束', self: '自分の目安' };
export function dueKindOf(urgent, kind) {
  if (urgent !== true) return null;
  return kind === 'ext' ? 'ext' : 'self';
}

/* 1 回分: 何回もの泡で、作業記録の 1 行目（次にやること）が書いてあれば、次の 1 回を半日までとして数える */
export function effectiveSize(size, hasNext) {
  const s = sizeOf(size);
  return (s === 'l' && hasNext) ? 'm' : s;
}

/* 先に済ませる（記録の鍵 first）。さっとの泡だけ。
   2026-11-25 利用者の指示「区切り時間の機能はいらない」「ただ先にのプロパティが着くだけでよい（数にも制限はない）」：
   前の区切りの時間（入れてから 30 分で畳む）と席の数（1 日 3 つまで）はやめた。FIRST_MAX は数の上限が無いことを表す */
export const FIRST_MAX = Infinity;

/* 先に済ませるの段の様子。rows … その日の先に済ませるの泡 [{ done }]。
   -> { open, endAt, canAdd, passed }
     open   … 済んでいない泡がある（その泡に色を付ける）
     endAt・passed … 区切りの時間をやめたので、いつも null・false（呼び手の形を変えないため残す）
     canAdd … いつも true（数の上限は無い）
   第 2 引数より後（前の版の始めた時刻・分・今の時刻）は読まない */
export function firstState(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { open: list.some(r => r && !r.done), endAt: null, canAdd: true, passed: false };
}

/* 先に済ませるの段を出すか（2026-11-24 ユーザーの指示「先にやるの枠がない」）。
   st は firstState の答え、n は入れた泡の数。入れた泡がまだ済んでいない（open）か、1 つも入れていない（空いた席を見せて、押す・落とすで入れられる）とき */
export function showFirstRow(st, n) {
  return !!st && (!!st.open || !(n > 0));
}
