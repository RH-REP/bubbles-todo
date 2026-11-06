/* 似ている泡を近くへ寄せる（Issue #23）。node --test tests/related.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  grams, textSimilarity, relatedPairs, pullStep, isAffinityOn, setAffinityOn,
  PULL_MAX, PULL_NEAR, PULL_V,
} from '../js/related.js';

test('ひらがなだけの組は数えない（送りがなで似ているとしない）', () => {
  assert.ok(!grams('メールをする').has('する'));
  assert.ok(grams('牛乳を買う').has('牛乳'));
  assert.equal(textSimilarity('資料をする', '散歩をする'), 0);
});

test('名前が似ているものは似ている、違うものは似ていない', () => {
  assert.ok(textSimilarity('牛乳を買う', '牛乳と卵を買う') >= 0.3);
  assert.ok(textSimilarity('歯医者の予約', '歯医者に電話') >= 0.3);
  assert.ok(textSimilarity('牛乳を買う', '請求書を送る') < 0.3);
  assert.equal(textSimilarity('', 'abc'), 0);
  assert.equal(textSimilarity('ＡＢＣ 資料', 'abc資料'), 1);   /* 全角・空白は揃える */
});

test('同じタグは寄せる。全員に付いているタグは数えない', () => {
  const items = [
    { id: 1, text: '請求書', tagNames: ['仕事', '経理'] },
    { id: 2, text: '打ち合わせ', tagNames: ['仕事', '経理'] },
    { id: 3, text: '散歩', tagNames: ['仕事'] },
  ];
  const ps = relatedPairs(items);
  assert.deepEqual(ps.map(p => [p.a, p.b]), [[0, 1]]);   /* 「仕事」は全員にあるので数えない */
  /* タグの海（全員が同じタグ）では、タグだけでは何も寄らない */
  assert.equal(relatedPairs([
    { text: 'あ漢', tagNames: ['買い物'] }, { text: '別物', tagNames: ['買い物'] },
  ]).length, 0);
});

test('1つの泡が引かれる相手は PULL_MAX 個まで', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: i, text: '牛乳を買う' + i }));
  const ps = relatedPairs(items);
  const count = new Array(6).fill(0);
  ps.forEach(p => { count[p.a]++; count[p.b]++; });
  assert.ok(count.every(c => c <= PULL_MAX));
  assert.ok(ps.length >= 3);
});

/* 2つだけを、ほかの力なしで 60 秒動かす */
function run(pair, a, c, sec) {
  const dt = 1 / 60;
  let maxClosing = 0;
  for (let t = 0; t < sec; t += dt) {
    pullStep([pair], [a, c], dt);
    [a, c].forEach(b => { if (b.free) { b.cx += b.vx * dt; b.cy += b.vy * dt; } });
    maxClosing = Math.max(maxClosing, a.vx - c.vx);
    const gap = (c.cx - a.cx) - (a.d + c.d) / 2;
    if (gap < 0) { a.vx = c.vx = 0; }   /* ぶつかりの代わり */
  }
  return maxClosing;
}

test('似ている2つは近づき、近づく速さは上限を越えない', () => {
  const a = { cx: 0, cy: 0, vx: 0, vy: 0, d: 80, free: true };
  const c = { cx: 400, cy: 0, vx: 0, vy: 0, d: 80, free: true };
  const maxClosing = run({ a: 0, b: 1, w: 1 }, a, c, 60);
  const gap = (c.cx - a.cx) - 80;
  assert.ok(gap <= PULL_NEAR + 1, 'gap ' + gap);
  assert.ok(maxClosing <= PULL_V + 1e-9, 'closing ' + maxClosing);
});

test('掴んでいる側は動かさない。両方動かせなければ何もしない', () => {
  const a = { cx: 0, cy: 0, vx: 0, vy: 0, d: 80, free: false };
  const c = { cx: 400, cy: 0, vx: 0, vy: 0, d: 80, free: true };
  pullStep([{ a: 0, b: 1, w: 1 }], [a, c], 0.1);
  assert.equal(a.vx, 0);
  assert.ok(c.vx < 0);
  const c2 = { ...c, vx: 0, free: false };
  pullStep([{ a: 0, b: 1, w: 1 }], [a, c2], 0.1);
  assert.equal(c2.vx, 0);
});

test('すでに近いものは引かない', () => {
  const a = { cx: 0, cy: 0, vx: 0, vy: 0, d: 80, free: true };
  const c = { cx: 80 + PULL_NEAR - 1, cy: 0, vx: 0, vy: 0, d: 80, free: true };
  pullStep([{ a: 0, b: 1, w: 1 }], [a, c], 0.1);
  assert.equal(a.vx, 0); assert.equal(c.vx, 0);
});

test('設定は既定オンで、切れる', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(isAffinityOn(), true);
  setAffinityOn(false);
  assert.equal(isAffinityOn(), false);
  assert.equal(mem.get('bubble_todo_affinity_v1'), '0');
});
