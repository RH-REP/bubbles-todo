/* 完了音。契約 §10。

   - 外部依存ゼロ。音声ファイルを持たず WebAudio で合成する
   - 鳴るのは完了のときだけ（着手では呼ばない）
   - 設定でオフにできる。既定はオン。localStorage に保存する
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
     （exponentialRamp は 0 に落とせないので 0.0001 まで落としてから 0 を置いている） */

const STORE_KEY = 'bubble_todo_sound_v1';

/* マスターのピーク。ここより大きい音は出ない。 */
const MASTER_PEAK = 0.15;

/* [周波数, 開始オフセット(s), attack(s), decay(s), 相対ピーク] */
const VOICES = [
  [659.25, 0.000, 0.008, 0.340, 0.80],
  [1318.50, 0.000, 0.006, 0.200, 0.18],
  [987.77, 0.085, 0.008, 0.420, 0.68],
  [1975.53, 0.085, 0.006, 0.240, 0.13],
];

let cachedOn = null;   // 真偽 or null（未読）
let ctx = null;        // AudioContext（使い回す）
let master = null;     // ctx ごとに1つだけ作る GainNode
let ctxDead = false;   // 一度作れなかったら二度と試さない

/* --- 設定 ------------------------------------------------------------ */

export function isOn() {
  if (cachedOn !== null) return cachedOn;
  let v = null;
  try {
    v = globalThis.localStorage ? globalThis.localStorage.getItem(STORE_KEY) : null;
  } catch (_) {
    /* プライベートモード等で localStorage が投げることがある。既定に倒す */
  }
  cachedOn = (v === null || v === undefined) ? true : v !== '0';
  return cachedOn;
}

export function setOn(on) {
  cachedOn = !!on;
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(STORE_KEY, cachedOn ? '1' : '0');
    }
  } catch (_) { /* 保存できなくても今回のセッションでは効かせる */ }

  /* オンにしたのはユーザーの操作の中のはず。
     ここで AudioContext を起こしておくと、最初の完了音が確実に鳴る。 */
  if (cachedOn) {
    try {
      const c = ensureCtx();
      if (c && c.state === 'suspended') {
        const p = c.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (_) { /* 起こせなくても黙って諦める */ }
  }
  return cachedOn;
}

/* --- 再生 ------------------------------------------------------------ */

export function playComplete() {
  try {
    if (!isOn()) return;
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
          .then(() => { if (c.state === 'running') schedule(c); })
          .catch(() => {});
        return;
      }
    }

    schedule(c);
  } catch (_) {
    /* 音のために UI を壊さない */
  }
}

/* --- 中身 ------------------------------------------------------------ */

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

function schedule(c) {
  const t0 = c.currentTime + 0.001;   // 現在時刻ちょうどに置かない
  for (let i = 0; i < VOICES.length; i++) {
    const [freq, at, attack, decay, peak] = VOICES[i];
    const start = t0 + at;
    const top = start + attack;
    const end = top + decay;

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

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
