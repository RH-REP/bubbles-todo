/* 泳ぐ生き物の着せ替え（2026-11-25 Issue #96 の 7・8 回目の返事）。今日の画面と海の画面で同じものを使う。
   > タグの選択ボタンとリストボタンもイメージにあう海の生き物に置き換えて、1番前のレイヤーで上の方でゆっくり動かすことできる？
   > クラゲとカメの位置を離して、海のタブも同じUIにして。スクリーン画面が大きい場合はいままでのUIにして。
   ・タグのフィルター … クラゲ（dressJelly）。絵（.sw-ic）を前に差し込み、もとの中身（名前・▽）は傘の下の札（.sw-lb）に包む
   ・一覧の切り替え … カメ（dressTurtle）。絵は .sw-face に入れる（右へ泳ぐ間は CSS がこの中だけ裏返す）。⇅ / ✕ は甲羅の上に重ねる
   ボタンそのもの（働き・aria-label・title・中の字）は画面の側がそのまま持つ。ここは絵と包みを足すだけ。
   泳がせる・止める・大きい画面で前のボタンに戻すのは CSS（css/screens/today.css・css/screens/sea.css の .sw 系）。
   絵は形だけで、色は CSS が塗る。赤は使わない。innerHTML は使わない（SVG は createElementNS で組む） */

const NS = 'http://www.w3.org/2000/svg';

function swimSvg(viewBox, w, h, parts) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', String(w));        /* CSS が古いまま届いても、絵が広がらない */
  svg.setAttribute('height', String(h));
  svg.setAttribute('class', 'sw-ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  parts.forEach(([tag, attrs]) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    svg.appendChild(n);
  });
  return svg;
}

export function jellySvg() {
  return swimSvg('0 0 48 44', 40, 37, [
    ['path', { class: 'tent', d: 'M12 22 Q9 31 13 40 M20 23 Q18 33 21 43 M28 23 Q30 33 27 43 M36 22 Q39 31 35 40' }],
    ['path', { class: 'bell', d: 'M4 23 Q4 3 24 3 Q44 3 44 23 Q38 26 34 22 Q29 26 24 22 Q19 26 14 22 Q10 26 4 23 Z' }],
    ['path', { class: 'shine', d: 'M12 13 Q15 7 22 6' }],
  ]);
}

/* カメは左向き */
export function turtleSvg() {
  return swimSvg('0 0 60 40', 52, 35, [
    ['path', { class: 'flip', d: 'M14 10 L6 3 Q4 9 11 15 Z M14 30 L6 37 Q4 31 11 25 Z M44 11 L50 5 Q53 10 47 15 Z M44 29 L50 35 Q53 30 47 25 Z' }],
    ['path', { class: 'flip', d: 'M50 20 L58 17 L58 23 Z' }],
    ['circle', { class: 'head', cx: '8', cy: '20', r: '6' }],
    ['ellipse', { class: 'shell', cx: '30', cy: '20', rx: '19', ry: '14' }],
    ['path', { class: 'plate', d: 'M30 9 L38 14 L38 26 L30 31 L22 26 L22 14 Z' }],
    ['circle', { class: 'eye', cx: '6', cy: '18', r: '1.4' }],
  ]);
}

/* 貝（ホタテ。左上の ≡＝引き出しのボタン。2026-11-25 Issue #96 の返事「左から2番目にあるボタンもイメージに合う海の生き物にして。
   スキンの切り替えに追加して」）。開くと中身が出る＝引き出し、と読めるもの */
export function shellSvg() {
  return swimSvg('0 0 40 36', 30, 27, [
    ['path', { class: 'hinge', d: 'M14 29 L26 29 L24 34 L16 34 Z' }],
    ['path', { class: 'fan', d: 'M20 30 L4 14 Q6 3 20 2 Q34 3 36 14 Z' }],
    ['path', { class: 'rib', d: 'M20 30 L10 6 M20 30 L15 3.5 M20 30 L20 2.5 M20 30 L25 3.5 M20 30 L30 6' }],
  ]);
}

/* 引き出しのボタンを貝にする（1 度だけ）。≡ の字（.ic）は残し、スキンが海の生き物のときだけ CSS が入れ替える */
export function dressShell(btn) {
  if (!btn || btn.classList.contains('sw-shell')) return btn;
  btn.classList.add('sw-shell');
  btn.appendChild(shellSvg());
  return btn;
}

/* タグのフィルターのボタンをクラゲにする（1 度だけ） */
export function dressJelly(btn) {
  if (!btn || btn.classList.contains('sw-jelly')) return btn;
  btn.classList.add('sw', 'sw-jelly');
  const wrap = document.createElement('span');
  wrap.className = 'sw-lb';
  while (btn.firstChild) wrap.appendChild(btn.firstChild);
  btn.appendChild(jellySvg());
  btn.appendChild(wrap);
  return btn;
}

/* 一覧の切り替えのボタンをカメにする（1 度だけ） */
export function dressTurtle(btn) {
  if (!btn || btn.classList.contains('sw-turtle')) return btn;
  btn.classList.add('sw', 'sw-turtle');
  const face = document.createElement('span');
  face.className = 'sw-face';
  face.appendChild(turtleSvg());
  btn.insertBefore(face, btn.firstChild);
  return btn;
}
