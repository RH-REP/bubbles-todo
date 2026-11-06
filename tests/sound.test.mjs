/* 効果音（Issue #18）のテスト。音そのものは聞かない。
   偽の AudioContext で「鳴らす／鳴らさない」の門番と、例外を投げないことだけを見る。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('3つの効果音が鳴る（発振器が動く）', () => {
  assert.deepEqual([...s._sfxNames].sort(), ['add', 'place', 'start']);
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
