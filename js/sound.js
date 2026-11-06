/* 完了音と操作の効果音。契約 §10（効果音は 2026-11-07 利用者の指示 Issue #18 で足した）。

   - 外部依存ゼロ。音声ファイルを持たず WebAudio で合成する
   - 完了音は完了のときだけ。効果音は「泡を足す」「はじめた」「タブに置く」の3つだけ
     （消す・戻す・取り消すでは鳴らさない。契約 §6 の「消すときは音を鳴らさない」はそのまま）
   - 完了音と効果音は別のスイッチ。どちらも既定はオン。localStorage に保存する
   - prefers-reduced-motion: reduce のときは鳴らさない
   - AudioContext は使い回す。suspended なら resume() を試み、
     駄目なら黙って諦める（例外を投げない。UI を壊さない）

   音の設計（聞かなくても分かるように書いておく）:

     やわらかい二音。上がって収まる完全五度。ファンファーレにしない。

     声部        波形   周波数      開始     attack   decay(exp)  相対ピーク
     A 基音      sine    659.25Hz  (E5)  0.000s   0.008s   0.340s      0.80
     A 倍音      sine   1318.50Hz  (E6)  0.000s   0.006s   0.200s      0.18
     B 基音      sine    987.77Hz  (B5)  0.085s   0.008s   0.420s      0.68
     B 倍音      sine   1975.53Hz  (B6)  0.085s   0.006s   0.240s      0.13

     全長 = 0.085 + 0.008 + 0.420 ≒ 0.513s（契約の 300〜600ms に収まる）
     倍音は基音より短く切ってあるので、鳴り出しだけ澄んで、尾は基音の丸い音になる。
     相対ピークの総和は 1.0 を超えないので、マスターの 0.15 がそのまま上限になる。

     エンベロープは全声部で
       setValueAtTime(0.0001) → linearRamp(peak) → exponentialRamp(0.0001) → setValueAtTime(0)
     の順。立ち上がり・切れ際の両方に傾きがあるのでクリックノイズが出ない。
     （exponentialRamp は 0 に落とせないので 0.0001 まで落としてから 0 を置いている）

   効果音（Issue #18）。どれも完了音より短く、1音だけ。ご褒美に聞こえないよう上がりきらない。

     名前    聞こえ方   周波数（始→終）   attack   decay    相対ピーク  全長
     add     ぽこっ     420→840Hz 上がる   0.004s   0.110s   0.55        ≒0.12s
     start   とん       523.25Hz (C5)      0.006s   0.200s   0.50        ≒0.21s
     place   すとん     587→440Hz 下がる   0.004s   0.120s   0.45        ≒0.13s

     泡が水から浮かぶ（上がる）、置いて収まる（下がる）、手をつけた（平らな1音）。
     マスターは完了音と同じ 0.15。相対ピークを下げてあるので完了音より小さい。 */

const STORE_KEY = 'bubble_todo_sound_v1';
const SFX_KEY = 'bubble_todo_sfx_v1';

/* マスターのピーク。ここより大きい音は出ない。 */
const MASTER_PEAK = 0.15;

/* [周波数, 開始オフセット(s), attack(s), decay(s), 相対ピーク, 終わりの周波数(省略可)] */
const VOICES = [
  [659.25, 0.000, 0.008, 0.340, 0.80],
  [1318.50, 0.000, 0.006, 0.200, 0.18],
  [987.77, 0.085, 0.008, 0.420, 0.68],
  [1975.53, 0.085, 0.006, 0.240, 0.13],
];

const SFX = {
  add:   [[420, 0, 0.004, 0.110, 0.55, 840]],
  start: [[523.25, 0, 0.006, 0.200, 0.50], [1046.5, 0, 0.004, 0.090, 0.08]],
  place: [[587.33, 0, 0.004, 0.120, 0.45, 440]],
};

let cachedOn = null;   // 真偽 or null（未読）
let cachedSfx = null;  // 効果音のスイッチ。同じく
let ctx = null;        // AudioContext（使い回す）
let master = null;     // ctx ごとに1つだけ作る GainNode
let ctxDead = false;   // 一度作れなかったら二度と試さない

/* --- 設定 ------------------------------------------------------------ */

function readFlag(key) {
  let v = null;
  try {
    v = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch (_) {
    /* プライベートモード等で localStorage が投げることがある。既定に倒す */
  }
  return (v === null || v === undefined) ? true : v !== '0';
}

function writeFlag(key, on) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(key, on ? '1' : '0');
  } catch (_) { /* 保存できなくても今回のセッションでは効かせる */ }
  /* オンにしたのはユーザーの操作の中のはず。
     ここで AudioContext を起こしておくと、最初の音が確実に鳴る。 */
  if (on) wake();
}

export function isOn() {
  if (cachedOn === null) cachedOn = readFlag(STORE_KEY);
  return cachedOn;
}

export function setOn(on) {
  cachedOn = !!on;
  writeFlag(STORE_KEY, cachedOn);
  return cachedOn;
}

export function isSfxOn() {
  if (cachedSfx === null) cachedSfx = readFlag(SFX_KEY);
  return cachedSfx;
}

export function setSfxOn(on) {
  cachedSfx = !!on;
  writeFlag(SFX_KEY, cachedSfx);
  return cachedSfx;
}

/* --- 再生 ------------------------------------------------------------ */

export function playComplete() {
  if (!isOn()) return;
  play(VOICES);
}

/* 効果音。name は 'add'（泡を足す）・'start'（はじめた）・'place'（タブに置く） */
export function playSfx(name) {
  try {
    if (!isSfxOn()) return;
    const v = SFX[name];
    if (!v) return;
    play(v);
  } catch (_) { /* 音のために UI を壊さない */ }
}

/* テスト用に中身を見せる（値の取り違えを見る） */
export const _sfxNames = Object.keys(SFX);

function play(voices) {
  try {
    if (prefersReducedMotion()) return;

    const c = ensureCtx();
    if (!c) return;

    if (c.state === 'suspended') {
      /* ユーザー操作の中でしか解けない。resume() は非同期なので、
         その場で解けたなら鳴らす。解けなければ待って鳴らす。
         どちらも駄目なら黙って諦める。 */
      let p = null;
      try { p = c.resume(); } catch (_) { return; }
      if (c.state === 'suspended') {
        Promise.resolve(p)
          .then(() => { if (c.state === 'running') schedule(c, voices); })
          .catch(() => {});
        return;
      }
    }

    schedule(c, voices);
  } catch (_) {
    /* 音のために UI を壊さない */
  }
}

/* --- 中身 ------------------------------------------------------------ */

function wake() {
  try {
    const c = ensureCtx();
    if (c && c.state === 'suspended') {
      const p = c.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) { /* 起こせなくても黙って諦める */ }
}

function prefersReducedMotion() {
  try {
    return !!(globalThis.matchMedia &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

function ensureCtx() {
  if (ctx) return ctx;
  if (ctxDead) return null;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) { ctxDead = true; return null; }
  try {
    ctx = new AC();
  } catch (_) {
    ctxDead = true;
    return null;
  }
  try {
    master = ctx.createGain();
    master.gain.value = MASTER_PEAK;
    master.connect(ctx.destination);
  } catch (_) {
    ctx = null;
    ctxDead = true;
    return null;
  }
  return ctx;
}

function schedule(c, voices) {
  const t0 = c.currentTime + 0.001;   // 現在時刻ちょうどに置かない
  for (let i = 0; i < voices.length; i++) {
    const [freq, at, attack, decay, peak, freqEnd] = voices[i];
    const start = t0 + at;
    const top = start + attack;
    const end = top + decay;

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, top + decay * 0.6);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, top);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.gain.setValueAtTime(0, end);

    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(end + 0.01);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (_) {} };
  }
}
