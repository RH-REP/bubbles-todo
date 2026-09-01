/* 海の引き（利用者の指示）

   > androidのデスクトップの様に、海の長押しで海の引きを見える様にし、
   > ＋ボタンで海の種類の追加ができる様に

   海の背景を長押しすると開く、**全部の海の一覧**。Android のホームで
   ページを長押ししたときと同じ役目——ふだんは1枚ずつしか見えないものを、
   いっぺんに見て、並べ替えて、増やすところ。

   ここでできること（利用者が選んだ4つ）：
     ・押してその海へ入る
     ・**並べ替える**（掴んで動かす。左右のボタンでも動く＝鍵盤だけでも届く）
     ・**海をやめる**（列から降ろす。タグも中身も消えない）
     ・**名前と色を変える**
     ・**＋で新しい海を作る**（その場で名前を書く。色は自動で配る）

   動かせないもの（固有枠）も**出す**。出さないと「上と下はどこへ行った」になる。
   ただし掴めず、×も出さない——押せない的を置かないため、姿を分けて字で言う。

   この画面は sea.js を知らない。入る先は onGo() で返すだけ。 */

import { el, toast } from './ui.js';
import { store } from './store.js';

const CENTER_NAME = 'ぜんぶ';
const CENTER_NOTE = 'タグの付いていないもの';

let root = null;        /* 開いているときの { back, box, ... } */

function has(name) { return typeof store[name] === 'function'; }

function seasSafe() {
  if (!has('seas')) return [];
  try { return store.seas() || []; } catch (err) { return []; }
}

function fixedTag(dir) {
  if (!has('tagDir')) return null;
  try { return store.tagDir(dir) || null; } catch (err) { return null; }
}

function maxSeas() { return Number(store.MAX_SEAS) || 10; }

/* 海にできる（＝まだ海になっていない）タグ。＋の一覧に出す…のではなく、
   いまは「その場で作る」だけなので、名前の重なりを見るためだけに使う */
function tagNames() {
  if (!has('tags')) return [];
  try { return (store.tags() || []).map(t => t.name); } catch (err) { return []; }
}

/* ---------------- 開く／閉じる ---------------- */

export function isOpen() { return !!root; }

export function closeSeaMap(restoreFocus) {
  if (!root) return false;
  const r = root;
  root = null;
  window.removeEventListener('keydown', r.onKey, true);
  if (r.unsub) { try { r.unsub(); } catch (err) { /* 外すだけ */ } }
  r.back.remove();
  if (restoreFocus && r.was && r.was.isConnected) {
    try { r.was.focus({ preventScroll: true }); } catch (err) { /* 焦点は戻せなくてもよい */ }
  }
  return true;
}

/* opts = { current, onGo(face), was } */
export function openSeaMap(opts) {
  const o = opts || {};
  if (root) { closeSeaMap(false); }

  const back = el('div', 'seamap-back');
  const box = el('div', 'seamap');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '海の引き');

  const head = el('div', 'seamap-head');
  head.appendChild(el('span', 'tt', '海'));
  const count = el('span', 'ct');
  head.appendChild(count);
  const closeBtn = el('button', 'cl', '閉じる');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeSeaMap(true));
  head.appendChild(closeBtn);
  box.appendChild(head);

  const grid = el('div', 'seamap-grid');
  box.appendChild(grid);

  const fixedRow = el('div', 'seamap-fixed');
  box.appendChild(fixedRow);

  const note = el('p', 'seamap-note',
    '押すとその海へ。掴むと並べ替えられる。<br>上（長期保留）と下（完了）は動かせない。');
  box.appendChild(note);

  back.appendChild(box);
  /* 背景を押したら閉じる。盤の外＝取り消し、はこのアプリの他の面と同じ */
  back.addEventListener('pointerdown', ev => { if (ev.target === back) closeSeaMap(true); });

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    closeSeaMap(true);
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  root = { back, box, grid, fixedRow, count, onGo: o.onGo, current: o.current, was: o.was, unsub: null };

  /* 外で海が変わったら描き直す（設定から降ろした、など） */
  if (has('on')) { try { root.unsub = store.on(() => render()); } catch (err) { /* 無くても動く */ } }

  render();
  const first = box.querySelector('.seamap-tile');
  if (first) first.focus({ preventScroll: true });
  return true;
}

/* ---------------- 描く ---------------- */

function render() {
  if (!root) return;
  const seas = seasSafe();
  root.count.textContent = seas.length + ' / ' + maxSeas();
  root.grid.replaceChildren();

  /* 中央（タグ無し）。列の左端で、動かせない・やめられない */
  root.grid.appendChild(makeTile({
    face: 'center', name: CENTER_NAME, sub: CENTER_NOTE, color: 'var(--bub-edge)', fixed: true,
  }));

  seas.forEach((t, i) => {
    root.grid.appendChild(makeTile({
      face: 'sea:' + t.id, tag: t, name: t.name, color: t.color,
      index: i, total: seas.length,
    }));
  });

  /* ＋。上限まで来たら、押せない的は置かず「いっぱい」とだけ言う */
  if (seas.length < maxSeas()) root.grid.appendChild(makeAdd());
  else root.grid.appendChild(el('p', 'seamap-full', '海は ' + maxSeas() + ' 個まで。'));

  /* 固有枠。並びとは別の軸なので、線を引いて分けて置く */
  root.fixedRow.replaceChildren();
  [['up', '上'], ['down', '下']].forEach(([dir, where]) => {
    const t = fixedTag(dir);
    if (!t) return;
    root.fixedRow.appendChild(makeTile({
      face: dir, tag: t, name: t.name, sub: where + '（動かせない）', color: t.color, fixed: true,
    }));
  });
}

function makeTile(spec) {
  const b = el('button', 'seamap-tile');
  b.type = 'button';
  b.dataset.face = spec.face;
  if (spec.tag) b.dataset.tag = spec.tag.id;
  if (spec.fixed) b.classList.add('is-fixed');
  if (root && root.current === spec.face) b.classList.add('is-here');

  const sw = el('span', 'sw');
  sw.setAttribute('aria-hidden', 'true');
  if (spec.color) sw.style.setProperty('--tc', spec.color);
  b.appendChild(sw);

  const nm = el('span', 'nm');
  nm.textContent = spec.name;                 /* ユーザーの文字。textContent で入れる */
  b.appendChild(nm);

  if (spec.sub) b.appendChild(el('span', 'sub', spec.sub));
  b.setAttribute('aria-label', spec.name + 'の海へ'
    + (root && root.current === spec.face ? '（いまここ）' : ''));

  b.addEventListener('click', ev => {
    ev.preventDefault();
    if (b.dataset.moved === '1') { b.dataset.moved = ''; return; }   /* 掴んで動かしただけ */
    const face = spec.face;
    const go = root && root.onGo;
    closeSeaMap(false);
    if (typeof go === 'function') go(face);
  });

  if (spec.fixed) return b;

  /* 並べ替え（掴んで動かす）と、鍵盤でも動く ‹ › */
  attachDrag(b, spec);

  const tools = el('span', 'tools');
  const mk = (cls, label, aria, on, off) => {
    const x = el('button', cls, label);
    x.type = 'button';
    x.setAttribute('aria-label', aria);
    x.disabled = !!off;
    x.addEventListener('pointerdown', ev => ev.stopPropagation());
    x.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); on(); });
    tools.appendChild(x);
    return x;
  };
  mk('mv', '‹', spec.name + ' を左へ', () => { store.moveSea(spec.tag.id, -1); render(); }, spec.index === 0);
  mk('mv', '›', spec.name + ' を右へ', () => { store.moveSea(spec.tag.id, +1); render(); }, spec.index === spec.total - 1);
  mk('ed', '⋮', spec.name + ' の名前と色', () => openEdit(spec.tag, b));
  b.appendChild(tools);
  return b;
}

function makeAdd() {
  const b = el('button', 'seamap-add');
  b.type = 'button';
  b.appendChild(el('span', 'pl', '＋'));
  b.appendChild(el('span', 'nm', '海をふやす'));
  b.setAttribute('aria-label', '海をふやす');
  b.addEventListener('click', ev => { ev.preventDefault(); openAdd(b); });
  return b;
}

/* ---------------- ＋（その場で作る） ---------------- */

function openAdd(anchor) {
  openSheet({
    title: '新しい海',
    value: '',
    placeholder: '海の名前',
    okLabel: '作る',
    anchor,
    onOk: (name) => {
      const v = String(name || '').trim();
      if (!v) return false;
      if (tagNames().indexOf(v) >= 0) { toast('「' + v + '」はもうある'); return false; }
      const t = store.addTag(v);
      if (!t) { toast('その名前では作れない'); return false; }
      if (!store.addSea(t.id)) {
        /* 上限に当たった。作ったタグは残す——消すと「書いたのに何も無い」になる */
        toast('「' + v + '」を作った（海は ' + maxSeas() + ' 個までなので、列には並べていない）');
      }
      render();
      return true;
    },
  });
}

/* ---------------- ⋮（名前と色・海をやめる） ---------------- */

function openEdit(tag, anchor) {
  openSheet({
    title: '海の名前と色',
    value: tag.name,
    placeholder: '海の名前',
    okLabel: '直す',
    anchor,
    tag,
    onOk: (name) => {
      const v = String(name || '').trim();
      if (v && v !== tag.name) {
        if (tagNames().indexOf(v) >= 0) { toast('「' + v + '」はもうある'); return false; }
        store.renameTag(tag.id, v);
      }
      render();
      return true;
    },
    onDrop: () => {
      /* 元に戻すときは**元の位置へ**返す。末尾に足すだけだと、
         「戻した」のに並びが変わっていて、戻ったことにならない */
      const at = has('seaIndex') ? store.seaIndex(tag.id) : -1;
      store.removeSea(tag.id);
      toast('「' + tag.name + '」を海から降ろした（タグは残る）', {
        label: '元に戻す',
        on: () => {
          if (!store.addSea(tag.id)) return;
          if (at >= 0) {
            const now = store.seaIndex(tag.id);
            if (now >= 0 && now !== at) store.moveSea(tag.id, at - now);
          }
          render();
        },
      });
      render();
    },
  });
}

/* 小さな入力の板。＋も⋮も同じ形にしてある（覚えることを増やさない） */
function openSheet(cfg) {
  const back = el('div', 'seamap-sheet-back');
  const box = el('div', 'seamap-sheet');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', cfg.title);
  box.appendChild(el('p', 'tt', cfg.title));

  const inp = el('input', 'in');
  inp.type = 'text';
  inp.value = cfg.value || '';
  inp.placeholder = cfg.placeholder || '';
  inp.autocomplete = 'off';
  inp.setAttribute('aria-label', cfg.title);
  box.appendChild(inp);

  /* 色。store が配っている色から選ぶ（ここに別のパレットを持たない） */
  let picked = cfg.tag ? cfg.tag.color : '';
  if (cfg.tag && has('tagPalette') && has('setTagColor')) {
    const row = el('div', 'cols');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '色');
    let list = [];
    try { list = store.tagPalette() || []; } catch (err) { list = []; }
    list.forEach(c => {
      const s = el('button', 'col');
      s.type = 'button';
      s.style.setProperty('--tc', c);
      s.setAttribute('aria-label', '色を変える');
      s.setAttribute('aria-pressed', c === picked ? 'true' : 'false');
      s.classList.toggle('is-on', c === picked);
      s.addEventListener('click', ev => {
        ev.preventDefault();
        picked = c;
        store.setTagColor(cfg.tag.id, c);
        [...row.children].forEach(x => {
          const on = x === s;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
      row.appendChild(s);
    });
    box.appendChild(row);
  }

  const row = el('div', 'row');
  if (typeof cfg.onDrop === 'function') {
    const d = el('button', 'drop', '海をやめる');
    d.type = 'button';
    d.setAttribute('aria-label', '海から降ろす（タグは残る）');
    d.addEventListener('click', ev => { ev.preventDefault(); close(); cfg.onDrop(); });
    row.appendChild(d);
  }
  const cancel = el('button', 'ca', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', ev => { ev.preventDefault(); close(); });
  row.appendChild(cancel);
  const ok = el('button', 'ok', cfg.okLabel || 'OK');
  ok.type = 'button';
  ok.addEventListener('click', ev => { ev.preventDefault(); if (cfg.onOk(inp.value) !== false) close(); });
  row.appendChild(ok);
  box.appendChild(row);

  const onKey = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key === 'Enter' && ev.target === inp) {
      ev.preventDefault();
      if (cfg.onOk(inp.value) !== false) close();
    }
  };
  box.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', ev => { if (ev.target === back) close(); });

  function close() {
    back.remove();
    if (cfg.anchor && cfg.anchor.isConnected) {
      try { cfg.anchor.focus({ preventScroll: true }); } catch (err) { /* 戻せなくてもよい */ }
    }
  }

  back.appendChild(box);
  document.body.appendChild(back);
  inp.focus({ preventScroll: true });
  inp.select();
}

/* ---------------- 並べ替え（掴んで動かす） ----------------
   cardlist.js の並べ替えと同じ考え方：掴んだ札は指に付いてきて、
   下に居る札との入れ替わりは**離したときに1回だけ**store へ伝える。 */

function attachDrag(node, spec) {
  let st = null;
  node.addEventListener('pointerdown', ev => {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target !== node && ev.target.closest('.tools')) return;
    st = { id: spec.tag.id, x0: ev.clientX, y0: ev.clientY, moved: false, to: spec.index };
    node.dataset.moved = '';
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  });

  function onMove(ev) {
    if (!st) return;
    const dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
    if (!st.moved && Math.hypot(dx, dy) < 8) return;
    if (!st.moved) { st.moved = true; node.classList.add('is-grab'); }
    node.style.translate = Math.round(dx) + 'px ' + Math.round(dy) + 'px';
    st.to = indexAt(ev.clientX, ev.clientY, st.id);
    markGap(st.to, st.id);
  }

  function onUp(ev) {
    if (!st) return;
    const s = st;
    st = null;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    node.style.translate = '';
    node.classList.remove('is-grab');
    markGap(-1, null);
    if (!s.moved) return;
    node.dataset.moved = '1';               /* このあと来る click は捨てる */
    const from = store.seaIndex(s.id);
    if (s.to >= 0 && s.to !== from) store.moveSea(s.id, s.to - from);
    render();
  }
}

/* 指の下にある札の位置。自分は数に入れない */
function indexAt(x, y, selfId) {
  if (!root) return -1;
  const tiles = [...root.grid.querySelectorAll('.seamap-tile[data-tag]')];
  let best = -1, bestD = Infinity;
  tiles.forEach(t => {
    const r = t.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d >= bestD) return;
    bestD = d;
    best = store.seaIndex(t.dataset.tag);
  });
  return best;
}

function markGap(index, selfId) {
  if (!root) return;
  root.grid.querySelectorAll('.seamap-tile[data-tag]').forEach(t => {
    const on = index >= 0 && t.dataset.tag !== selfId && store.seaIndex(t.dataset.tag) === index;
    t.classList.toggle('is-gap', on);
  });
}
