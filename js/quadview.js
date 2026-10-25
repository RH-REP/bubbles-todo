/* 四つに分けて見る（優先度・利用者の指示 2026-10-25）。海と今日の画面が使う。

   急ぐ・大事の2つの印で、泡を4つの区分に分けて並べる。泡を区分へドラッグすると、その印が付く。
   決まり（デザイン案のとおり）:
     ・区分ごとの数・割合は出さない。赤は使わない。名前は命令形にしない
     ・割り振りは任意。印の無い泡は下の「まだ分けていない」に並ぶ
     ・泡は一定の大きさで並べる（漂わせない）。押すと、ふだんと同じ盤が開く
   何を並べるか（フィルター・日付）と、泡のジェスチャは画面が渡す。
   ここが持つのは、箱の形・泡の出し入れ・指先の下の区分・落としたときの書き込みだけ。 */

import { store } from './store.js';
import { el, toast } from './ui.js';
import { makeBubble, updateBubble } from './bubble.js';
import { QUADRANTS, QUAD_ORDER } from './priority.js';

export const QUAD_BUB = 66;   /* 3行の名前が欠けない大きさ。区分の幅に2つ並ぶ */

/* host の中に箱を作る。
     opts.bind(node, id) → 外す関数   泡にジェスチャを張る（画面の handlers を使う）
     opts.className                  箱に足すクラス（画面ごとの余白）
   返り値 = { el, render(rows), hitAt(x, y), clear() }
     rows = [{ id, item, opts }]   item / opts は makeBubble に渡すもの（item に urgent / important） */
export function createQuadView(host, opts = {}) {
  const root = el('div', 'quad-view' + (opts.className ? ' ' + opts.className : ''));
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', '四つに分けた眺め');
  const nodes = new Map();      /* id -> { node, detach }。描き直しをまたいで使い回す */
  const bodies = {};            /* 区分の鍵（まだ は ''）-> 泡を入れる箱 */

  const axis = el('div', 'quad-axis');
  axis.setAttribute('aria-hidden', 'true');
  axis.appendChild(el('span', '', '← 急ぐ'));
  axis.appendChild(el('span', '', '急がない →'));
  root.appendChild(axis);
  const grid = el('div', 'quad-grid');
  QUAD_ORDER.forEach(k => {
    const cell = el('section', 'quad-cell');
    cell.dataset.q = k;
    cell.setAttribute('aria-label', QUADRANTS[k].name + '（' + QUADRANTS[k].sub + '）');
    const hd = el('div', 'quad-hd');
    hd.appendChild(el('b', '', QUADRANTS[k].name));
    hd.appendChild(el('small', '', QUADRANTS[k].sub));
    cell.appendChild(hd);
    bodies[k] = el('div', 'quad-body');
    cell.appendChild(bodies[k]);
    grid.appendChild(cell);
  });
  const yax = el('div', 'quad-yaxis');
  yax.setAttribute('aria-hidden', 'true');
  yax.appendChild(el('span', '', '大事'));
  yax.appendChild(el('span', '', '大事でない'));
  grid.appendChild(yax);
  root.appendChild(grid);
  const un = el('section', 'quad-un');
  un.dataset.q = '';
  un.setAttribute('aria-label', 'まだ分けていない');
  un.appendChild(el('span', 'quad-un-lb', 'まだ分けていない'));
  bodies[''] = el('div', 'quad-body');
  un.appendChild(bodies['']);
  root.appendChild(un);
  /* 当たりを見る箱。泡も data-q を持つ（右上の点）ので、属性ではなくここで持つ */
  const cells = [...grid.querySelectorAll('.quad-cell'), un];
  host.appendChild(root);

  function render(rows) {
    const want = new Set(rows.map(r => r.id));
    nodes.forEach((g, id) => {
      if (want.has(id)) return;
      if (typeof g.detach === 'function') g.detach();
      g.node.remove();
      nodes.delete(id);
    });
    rows.forEach(r => {
      let g = nodes.get(r.id);
      if (g) updateBubble(g.node, r.item, r.opts);
      else {
        const node = makeBubble(r.item, r.opts);
        g = { node, detach: opts.bind ? opts.bind(node, r.id) : null };
        nodes.set(r.id, g);
      }
      const k = store.quadrantOf ? store.quadrantOf(r.id) : null;
      const body = bodies[k || ''];
      /* 掴んでいる・盤に寄せている間はドラッグ層に居る。そこから引きはがさない */
      if (body && (g.node.parentNode === null || root.contains(g.node))) body.appendChild(g.node);
    });
  }

  /* 指先の下の区分。区分の中なら鍵、帯の中なら null（印を外す）、どちらでもなければ undefined */
  function hitAt(x, y) {
    if (root.hidden || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c.dataset.q || null;
    }
    return undefined;
  }

  function clear() {
    nodes.forEach(g => { if (typeof g.detach === 'function') g.detach(); g.node.remove(); });
    nodes.clear();
  }

  return { el: root, render, hitAt, clear };
}

/* 区分へ落とした。印を書き、取り消せるトーストを出す。null は「まだ分けていない」へ戻す。
   書けなかったとき（同じ区分・読むだけの海）は false */
export function dropToQuad(id, k) {
  const t = store.get(id);
  if (!t) return false;
  const before = { urgent: t.urgent, important: t.important };
  if (!store.setQuadrant(id, k)) return false;
  const a = Array.from(String(t.text));
  const nm = a.length > 14 ? a.slice(0, 14).join('') + '…' : String(t.text);
  toast(k ? '『' + nm + '』を「' + QUADRANTS[k].name + '」に置いた' : '『' + nm + '』の印を外した',
    { label: '取り消す', on: () => { store.setPriority(id, before); } });
  return true;
}

/* 四つに分ける切り替えのボタン。押した状態は aria-pressed で持つ（見た目は css の .quad-btn） */
export function quadButton(onClick) {
  const b = el('button', 'quad-btn');
  b.type = 'button';
  const ic = el('span', 'ic', '⊞');
  ic.setAttribute('aria-hidden', 'true');
  b.appendChild(ic);
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', '四つに分けて見る');
  b.title = '四つに分けて見る';
  b.addEventListener('click', ev => { ev.preventDefault(); onClick(); });
  return b;
}
export function syncQuadButton(b, on) {
  if (!b) return;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', on ? '四つに分けるのをやめる' : '四つに分けて見る');
  b.title = on ? '押すと元の眺めにもどる' : '四つに分けて見る';
  b.classList.toggle('is-on', on);
}
