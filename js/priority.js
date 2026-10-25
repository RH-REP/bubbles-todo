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
