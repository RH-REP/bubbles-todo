/* 効果音（Issue #18）のテスト。音そのものは聞かない。
   偽の AudioContext で「鳴らす／鳴らさない」の門番と、例外を投げないことだけを見る。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
let reduce = false;
globalThis.matchMedia = () => ({ matches: reduce });

let started = 0;
const param = () => ({
  value: 0,
  setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
});
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  createOscillator() {
    return {
      type: 'sine', frequency: param(), connect() {}, disconnect() {},
      start() { started++; }, stop() {},
    };
  }
}
globalThis.AudioContext = FakeCtx;

const s = await import('../js/sound.js');

test('効果音は既定でオン、完了音とは別のスイッチ', () => {
  assert.equal(s.isSfxOn(), true);
  assert.equal(s.isOn(), true);
  s.setOn(false);
  assert.equal(s.isSfxOn(), true);
  s.setOn(true);
});

test('4つの効果音が鳴る（発振器が動く。lit は 2026-11-24 の輝く泡）', () => {
  assert.deepEqual([...s._sfxNames].sort(), ['add', 'lit', 'place', 'start']);
  for (const n of s._sfxNames) {
    const before = started;
    s.playSfx(n);
    assert.ok(started > before, n);
  }
});

test('オフなら鳴らない。localStorage に残る', () => {
  s.setSfxOn(false);
  assert.equal(mem.get('bubble_todo_sfx_v1'), '0');
  const before = started;
  s.playSfx('add');
  assert.equal(started, before);
  s.setSfxOn(true);
});

test('知らない名前・reduced-motion では鳴らず、投げない', () => {
  const before = started;
  s.playSfx('nope');
  reduce = true;
  s.playSfx('add');
  s.playComplete();
  reduce = false;
  assert.equal(started, before);
});

test('完了音は効果音のスイッチに左右されない', () => {
  s.setSfxOn(false);
  const before = started;
  s.playComplete();
  assert.ok(started > before);
  s.setSfxOn(true);
});

test('輝く泡の lit は非常に弱い：最大は完了音の 1/5 以下、和も小さく、全長 0.3 秒未満', () => {
  const src = readFileSync(new URL('../js/sound.js', import.meta.url), 'utf8');
  const peaks = name => {
    const m = new RegExp(name + ':\\s*(\\[\\[[^\\n]*\\]\\]),').exec(src);
    return JSON.parse(m[1]);
  };
  const lit = peaks('lit');
  const done = [0.80, 0.18, 0.68, 0.13];
  const p = lit.map(v => v[4]);
  assert.ok(Math.max(...p) <= Math.max(...done) / 5, '最大');
  assert.ok(p.reduce((a, b) => a + b, 0) < done.reduce((a, b) => a + b, 0) / 4, '和');
  assert.ok(Math.max(...lit.map(v => v[1] + v[2] + v[3])) < 0.3, '全長');
});
