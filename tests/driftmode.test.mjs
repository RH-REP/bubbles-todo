/* 漂い方（2026-11-27。js/driftmode.js）のテスト。データはすべて架空。

     node --test tests/driftmode.test.mjs

   1. 海ごとの設定：決めていなければ C（breath）。海ごとに別。知らない値は既定。既定に戻すと欄を消す
   2. 開いている海の漂い方（bubble_todo_space の海）。変えたら覚え直す
   3. B 潮の流れ：壁に沿って流れ（壁を突き抜けない）、真ん中のまわりを回る
   4. C 浮かび直す先・休む長さ、A の寄せる速さ、D かき混ぜの届く範囲と上限 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT_KEY, DRIFT_DEFAULT, DRIFT_MODES, driftModeOf, setDriftMode, currentDriftMode, forgetDriftCache,
  tideVel, riseTarget, restFor, neutralVy, stirImpulse, BREATH, NEUTRAL, STIR } from '../js/driftmode.js';

function fakeLS() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}

test('既定は C（沈んで、また浮かぶ）。選べるのは A〜C の 3 つ', () => {
  assert.equal(DRIFT_DEFAULT, 'breath');
  assert.deepEqual(DRIFT_MODES.map(m => m.id), ['breath', 'neutral', 'tide']);
  assert.equal(driftModeOf('me', fakeLS()), 'breath');
});

test('海ごとに覚える。知らない値は既定。既定に戻すと欄を消す', () => {
  const ls = fakeLS();
  assert.equal(setDriftMode('s_work', 'tide', ls), true);
  assert.equal(setDriftMode('s_work', 'tide', ls), false, '同じ値なら変わらない');
  assert.equal(driftModeOf('s_work', ls), 'tide');
  assert.equal(driftModeOf('me', ls), 'breath', 'ほかの海は既定のまま');
  assert.equal(setDriftMode('me', 'sideways', ls), false, '知らない値は入れない');
  ls.setItem(DRIFT_KEY, JSON.stringify({ me: 'sideways' }));
  assert.equal(driftModeOf('me', ls), 'breath', '壊れた値は既定として読む');
  setDriftMode('s_work', 'breath', ls);
  assert.equal('s_work' in JSON.parse(ls.getItem(DRIFT_KEY)), false);
  ls.setItem(DRIFT_KEY, '{oops');
  assert.equal(driftModeOf('s_work', ls), 'breath', '読めない箱でも落ちない');
});

test('開いている海（bubble_todo_space）の漂い方を読む', () => {
  const ls = fakeLS();
  ls.setItem('bubble_todo_space', 's_home');
  setDriftMode('s_home', 'neutral', ls);
  assert.equal(currentDriftMode(ls), 'neutral');
  ls.setItem('bubble_todo_space', 'me');
  assert.equal(currentDriftMode(ls), 'breath');
  forgetDriftCache();
});

test('B 潮の流れ：左右の壁では横に、上下の壁では縦に流れない（壁を突き抜けない）。回る向きは 1 つ', () => {
  const w = 340, h = 620;
  for (const y of [50, 300, 600]) {
    assert.ok(Math.abs(tideVel(0, y, w, h)[0]) < 1e-9, '左の壁で横の速さ 0');
    assert.ok(Math.abs(tideVel(w, y, w, h)[0]) < 1e-9, '右の壁で横の速さ 0');
  }
  for (const x of [30, 170, 320]) {
    assert.ok(Math.abs(tideVel(x, 0, w, h)[1]) < 1e-9, '上で縦の速さ 0');
    assert.ok(Math.abs(tideVel(x, h, w, h)[1]) < 1e-9, '底で縦の速さ 0');
  }
  const top = tideVel(w / 2, h * 0.1, w, h), bottom = tideVel(w / 2, h * 0.9, w, h);
  assert.ok(top[0] > 0 && bottom[0] < 0, '上で右へ、下で左へ（1 つの渦）');
  assert.ok(Math.hypot(...tideVel(w / 2, h * 0.1, w, h)) < 8, 'ゆっくり（漂う速さ 16 px/秒より遅い）');
  assert.deepEqual(tideVel(10, 10, 0, 0), [0, 0]);
});

test('C 浮かび直す先は海の上から 15〜70 %、休むのは 20〜60 秒', () => {
  const h = 620, r = 40, span = h - 2 * r;
  assert.equal(riseTarget(h, r, 0), r + BREATH.from * span);
  assert.equal(riseTarget(h, r, 1), r + BREATH.to * span);
  assert.equal(restFor(0), 20);
  assert.equal(restFor(1), 60);
});

test('A 好きな深さへ寄せる上下の速さは ±4 px/秒まで', () => {
  assert.equal(neutralVy(100, 500), NEUTRAL.maxV);
  assert.equal(neutralVy(500, 100), -NEUTRAL.maxV);
  assert.equal(neutralVy(300, 300), 0);
});

test('D かき混ぜ：半径 90px の中だけ、近いほど強く、1 回に足すのは 60 px/秒まで', () => {
  assert.equal(stirImpulse(STIR.radius, 500, 0), null);
  assert.equal(stirImpulse(NaN, 500, 0), null);
  const near = stirImpulse(0, 100, -40), mid = stirImpulse(45, 100, -40);
  assert.deepEqual(near, [25, -10]);
  assert.ok(Math.abs(mid[0]) < Math.abs(near[0]));
  assert.deepEqual(stirImpulse(0, 5000, -5000), [STIR.maxDv, -STIR.maxDv]);
});
