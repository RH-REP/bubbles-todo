/* 画面4「すきま」— すきま時間にできることを、条件ごとに1個ずつ置いておく画面。

   軸は「通信（あり／なし）× 使えるもの（耳だけ／画面）」の2×2。
   ただし人が見るのは縦の一列なので、4枠は縦に並べる。

   ■ 追補5 §3 でこの画面は「DOM に流し込む枠」から「漂う面」に変わった。
   バブルは drift の面（createField）を自由に漂い、重力で下へ落ちる。
   枠は「引力の井戸」（field.setWells）で、セルの中に入ったバブルだけが吸い込まれて止まる。
   「未分類」は面のいちばん下。重力があるので、放したものは自然にそこへ溜まる。

   ■ 座標はすべてこの画面が持つ（layout()）。
   同じ矩形を「井戸（物理）」と「枠の見た目（DOM）」の両方に使うので、
   物理と絵がずれない。1マス（＝井戸1つ）はバブル1個ぶん、つまり直径 D=96 の正方形。

   ■ マスの間には GUT=8 の溝を空ける。中心から中心までは PITCH=104。
   理由: drift の当たり判定は、直径 96 どうしが (96+96)/2 + HIT_GAP(4) = 100px まで
   近づくと押し合う。マスを隙間なく敷く（中心間 96px）と、井戸に収まったバブルどうしが
   100px の間合いに割り込むので、いつまでも 0.2px/s ほど押し合って止まらない（実測）。
   中心間を 100px 以上にすると押し合いが消える。

   ■ 「セルの幅はバブル直径の整数倍」（追補5 §2・§3）は保つ。
   1マスの幅は 96px ＝ 直径のちょうど 1 倍で、バブルはその中心にぴたりと乗る。
   間隔だけを溝で広げた。マスの幅そのものを広げて間隔を稼ぐ道は無い:
   間合い 100px は直径 96px より必ず大きいので 1 倍では届かず、2 倍（192px）にすると
   375px 幅に1列しか入らないため。だから「マスは1倍のまま、あいだに余白を足す」を選んだ。

   決めごと（変えないこと）:
   - 1枠に置けるのは1個だけ。2個目を落としたら、古いほうは黙って未分類へ移る。
     **断らない。**断るのは罰の操作で、このアプリが避けているもの（契約 §0）。
   - 押し出したことは必ず言う（トースト＋取り消し）。
   - 枠に入っていたものを枠でないところへ置いたら、未分類へもどす（利用者の指示）。
     ここも断らない・叱らない。行き先を言うだけ（トースト＋取り消し）。
   - 埋まっている枠は、掴んだ時点で分かること（body.is-dragging を手がかりに CSS 側で）。
   - 枠の中のバブルは一定 96px。文字量では変えない（契約 §4）。
   - drift のノードには attachGestures を張らない。handlers は createField の opts で渡す。

   ■ 落ちても壊れない道:
   - field.setWells が無い版の drift でも動く。そのときは枠のバブルだけ DOM 側に置く
     （井戸が無いと重力で落ちてしまい、枠が空に見えるため）。
   - prefers-reduced-motion: reduce のときは面を作らず、静かな DOM 配置にする。 */

import { store } from '../store.js';
import { makeBubble, updateBubble, attachGestures, openMenu } from '../bubble.js';
import { createField } from '../drift.js';
import { el, toast } from '../ui.js';
import { playComplete } from '../sound.js';

/* タグの名前。色と同じ並びで渡す。
   タグを色だけで表すと、色を見分けられない人に所属が伝わらない（WCAG 1.4.1）。
   バブルには文字を足さず、読み上げ文にだけ載せる。 */
function tagNames(id) {
  if (typeof store.tagsOf !== 'function' || typeof store.tags !== 'function') return [];
  let ids, all;
  try { ids = store.tagsOf(id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(t => [t.id, t.name]));
  return ids.map(t => by.get(t)).filter(n => typeof n === 'string' && n);
}

/* 付いているタグの色。バブルはこの色になる（タグが無ければ空＝いまの青）。 */
function tagColors(id) {
  if (typeof store.tagsOf !== 'function' || typeof store.tags !== 'function') return [];
  let ids, all;
  try { ids = store.tagsOf(id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(t => [t.id, t.color]));
  return ids.map(t => by.get(t)).filter(c => typeof c === 'string' && c);
}

/* ---------------- 定数 ---------------- */

/* バブルの直径。文字量では変えない（契約 §4）。格子の1マスでもある。 */
const D = 96;

/* マスとマスのあいだの溝。中心から中心までを PITCH にする。
   drift の当たり判定の間合いは (D+D)/2 + HIT_GAP(4) = 100px なので、
   PITCH はそれ以上でなければ、井戸に収まったバブルどうしが押し合って止まらない。
   8 にして 4px の余裕を持たせた（ちょうど 100 だと間合いの境目に乗る）。 */
const GUT = 8;
const PITCH = D + GUT;   /* 104 */

/* 面の左右に最低限あける余白。ここから入る列数を決める */
const MINPAD = 8;

const TOP = 10;   /* 面の上端から1枠目まで */
const MID = 6;    /* 4枠と「未分類」のあいだ */
const HEAD = 30;  /* 「未分類」の見出し帯 */
const BOT = 8;    /* 面の下端に残す余白 */
const MAX_ROWS = 4;

const SLOT_FALLBACK = ['ears', 'ears_off', 'screen', 'screen_off'];

const LABEL = {
  ears:       '耳だけ',
  ears_off:   '耳だけ・保存済み',
  screen:     '画面',
  screen_off: '画面・保存済み',
};

/* 説明は「そのものが手元にあるか」を言うだけ。命令形にしない。 */
const NOTE = {
  ears:       '聴けば進むもの',
  ears_off:   '手元に落としてあるので、電波が無くても聴ける',
  screen:     '画面を見るもの',
  screen_off: '手元にあるので、電波が無くても読める',
};

function reduced() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------------- store の薄い包み ----------------
   データ層を入れ替えている最中でも画面が落ちないよう、
   関数が無ければ「何も無い」として扱う。 */

function slotList() {
  return (Array.isArray(store.GAP_SLOTS) && store.GAP_SLOTS.length)
    ? store.GAP_SLOTS : SLOT_FALLBACK;
}
function unsorted() {
  return (typeof store.gapUnsorted === 'function' && store.gapUnsorted()) || [];
}
function inSlot(slot) {
  return (typeof store.inGapSlot === 'function' && store.inGapSlot(slot)) || null;
}
function slotOf(id) {
  return (typeof store.gapSlotOf === 'function' && store.gapSlotOf(id)) || null;
}
/* 戻り値は必ず { pushedOut } の形にそろえる */
function putIn(id, slot) {
  if (typeof store.setGapSlot !== 'function') return { pushedOut: null };
  const r = store.setGapSlot(id, slot);
  return (r && typeof r === 'object') ? r : { pushedOut: null };
}
function itemOf(id) {
  return (typeof store.get === 'function' && store.get(id)) || null;
}
function detailOf(fn, id) {
  return (typeof store[fn] === 'function' && store[fn](id)) || '';
}
function isStarted(id) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, null);
}

/* 表示用に短く切る（トーストの中で使う） */
function trim(s, n = 14) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ---------------- 画面の状態 ---------------- */

let root = null;          /* .gap */
let paneEl = null;        /* app.js が渡してくる .pane */
let back = null;          /* カード・見出しを敷く層 */
let fieldHost = null;     /* drift の面 */
let field = null;
let unsortedBox = null;
let tray = null;          /* 面を作らないときの未分類の受け皿 */
let trayEmpty = null;
let cardBox = {};         /* slot -> .gap-cell（帯） */
let wellBox = {};         /* slot -> .gap-well（丸） */
let geo = null;           /* layout() の結果 */
let unsubscribe = null;
let listening = false;
let resizing = false;

/* id -> { node, detach }  … DOM 側に置いたバブルだけ */
const bubbles = new Map();

/* ドラッグ中は再描画しない（掴んでいるノードを土台ごと取り替えてしまうため）。 */
let dragging = false;
let deferred = false;
let overNode = null;
let dragId = null;
let lastPt = null;        /* { x, y, inside } 面の座標系 */
let pendingDrop = false;  /* このドラッグの落下をまだ適用していない */
/* このドラッグがタブで受け止められたか。
   タブへのドロップは「所属を足す」という別の意味なので（契約 §2）、
   そちらが成立したときに「枠の外＝未分類へもどす」を重ねて発動させない。
   指先が面の外かどうか（p.inside）でもタブは弾けるが、面の下端とタブバーの上端は
   接しているので、境目の1pxで取り違えないよう、受け取った事実そのものも持っておく。 */
let tabDropped = false;

/* 枠のバブルを面に載せるか。井戸が無い drift では載せられない
   （重力で落ちて、枠が空に見えてしまう）。 */
function slotsInField() {
  return !!(field && typeof field.setWells === 'function');
}

/* ---------------- 組み立て ---------------- */

export default {
  id: 'gap',
  label: 'すきま',
  icon: '△',

  mount(pane) {
    paneEl = pane;
    root = el('div', 'gap');

    /* 敷く層。ここに z-index を置かない（子の重なりを面より上下に振り分けるため） */
    back = el('div', 'gap-back');
    root.appendChild(back);

    cardBox = {};
    wellBox = {};
    slotList().forEach(slot => {
      const card = el('div', 'gap-cell');

      const txt = el('div', 'gap-cell-text');
      const nm = el('span', 'nm');
      nm.textContent = LABEL[slot] || slot;
      txt.appendChild(nm);
      if (NOTE[slot]) {
        const ds = el('span', 'ds');
        ds.textContent = NOTE[slot];
        txt.appendChild(ds);
      }
      card.appendChild(txt);

      /* 丸はカードと兄弟にする。カードの中に入れると、
         カードの重なり順に閉じ込められて面より上に出せない。 */
      const well = el('div', 'gap-well');
      well.setAttribute('role', 'group');
      well.setAttribute('aria-label', (LABEL[slot] || slot) + 'の枠（空）');

      /* 掴んでいる間だけ出る。埋まっている枠に落とすと何が起きるかを先に言う */
      const hint = el('span', 'gap-swap');
      hint.textContent = '入れ替わる';
      hint.setAttribute('aria-hidden', 'true');
      well.appendChild(hint);

      back.appendChild(card);
      back.appendChild(well);
      cardBox[slot] = card;
      wellBox[slot] = well;
    });

    /* ---- 未分類（面のいちばん下） ---- */
    unsortedBox = el('section', 'gap-unsorted');
    const unHd = el('h2', 'gap-hd');
    unHd.textContent = '未分類';
    unsortedBox.appendChild(unHd);

    tray = el('div', 'gap-tray');
    trayEmpty = el('p', 'gap-empty');
    trayEmpty.textContent = 'すきま時間にできるものが、ここに溜まる';
    unsortedBox.appendChild(tray);
    unsortedBox.appendChild(trayEmpty);
    back.appendChild(unsortedBox);

    /* ---- 漂う面 ---- */
    fieldHost = el('div', 'gap-field');
    root.appendChild(fieldHost);
    pane.appendChild(root);

    /* reduce のときは面を作らない。漂わせないだけでなく、
       井戸に吸い込む動きも出ないので、静かな DOM 配置にする。 */
    if (!reduced()) {
      try {
        field = createField(fieldHost, {
          size: D,                                   /* 枠の中は一定 96px（契約 §4） */
          persist: true,                             /* store の fx/fy から出る位置を決める */
          onMenu:         (id, node) => openItemMenu(id, node),
          onFocusRequest: (id) => openFive(id),
          onActions:      (id) => actionsFor(id),
          onDropToTab:    (id, tabId) => dropToTab(id, tabId),
          onDragStart:    (id) => onGrab(id),
          onDragEnd:      () => finishDrop(),
        });
      } catch (e) {
        console.error(e);
        field = null;                                /* 面が作れなくても画面は出る */
      }
    }
    root.classList.toggle('is-field', !!field);
    root.classList.toggle('is-wells', slotsInField());

    /* 落とし先の判定は自分で持つ。枠の丸は pointer-events:none なので
       elementsFromPoint では拾えない。矩形との当たりで見る。 */
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('resize', onResize);
    listening = true;

    if (typeof store.on === 'function') unsubscribe = store.on(render);
    render();
  },

  onShow() {
    /* mount の時点ではペインが display:none でサイズ 0。
       座標はここで測る（契約 §14）。 */
    relayout();
    render();
    if (field) { try { field.start(); } catch (e) { console.error(e); } }
    /* 反映が1拍遅れることがあるので、もう一度だけ測り直して描き直す。
       requestAnimationFrame は使わない。ペインが visibilityState:hidden の環境では
       一度も発火しないので、ここに置くと二度と走らない（契約 §14）。 */
    setTimeout(() => { if (root) { relayout(); render(); } }, 0);
  },

  onHide() {
    closeDetail();
    if (field) { try { field.stop(); } catch (e) { console.error(e); } }
  },

  destroy() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    if (listening) {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('resize', onResize);
      listening = false;
    }
    bubbles.forEach(b => { try { b.detach && b.detach(); } catch (e) { /* 無視 */ } });
    bubbles.clear();
    if (field) { try { field.destroy(); } catch (e) { /* 無視 */ } field = null; }
    if (root) root.remove();
    root = null;
  },
};

/* ---------------- 座標 ----------------
   面いっぱいに格子を敷く。1マスは D×D（＝バブル1個ぶん）、中心から中心までは PITCH。
   ・列数 cols は、左右に MINPAD を残して入るだけ。375px なら 3 列。
   ・1マスの幅 = D = バブルの直径のちょうど1倍（追補5 §2「整数倍」）。
     広げたのはマスの幅ではなく、マスとマスのあいだの溝 GUT。
   ・枠の丸は、その格子のいちばん右の列に置く。だから枠のバブルも
     未分類のバブルも同じ格子の上に乗る。
   ・4つの枠も縦に PITCH で並ぶ。隣り合う枠のバブルどうしも 100px 以上離す必要がある。
   ・未分類の格子は「下から」置く。重力と同じ向きなので、少ないときは下に溜まって見える。 */

function layout() {
  if (!fieldHost) return null;
  const W = fieldHost.clientWidth;
  const H = fieldHost.clientHeight;
  if (!W || !H) return null;                 /* 隠れている間は測らない */

  const slots = slotList();
  /* n 列に要る幅は n*D + (n-1)*GUT = n*PITCH - GUT */
  const cols = Math.max(1, Math.floor((W - MINPAD * 2 + GUT) / PITCH));
  const gridW = cols * PITCH - GUT;
  const x0 = Math.round((W - gridW) / 2);

  const slotY = TOP;
  const headY = slotY + (slots.length - 1) * PITCH + D + MID;
  const topY = headY + HEAD;                 /* 格子を置ける、いちばん上 */
  const rows = Math.max(1, Math.min(MAX_ROWS,
    Math.floor((H - BOT - topY + GUT) / PITCH)));
  /* 下端にそろえる。行数が減っても、バブルは面の下に溜まったままになる */
  const gridY = Math.max(topY, Math.round(H - BOT - (rows * PITCH - GUT)));

  const slotRect = {};
  const cardRect = {};
  slots.forEach((s, i) => {
    slotRect[s] = { x: x0 + (cols - 1) * PITCH, y: slotY + i * PITCH, w: D, h: D };
    cardRect[s] = { x: x0 - 8, y: slotY + i * PITCH + 2, w: gridW + 16, h: D - 4 };
  });
  /* 未分類の帯は面の下端まで伸ばす。格子が下にそろっているので、
     途中で切ると「格子より上で帯が終わる」ことになり、バブルが帯の外に落ちて見える。 */
  const unRect = {
    x: x0 - 8, y: headY, w: gridW + 16,
    h: Math.max(HEAD + D + 8, H - BOT - headY),
  };

  return { W, H, cols, rows, x0, gridW, gridY, slots, slotRect, cardRect, unRect };
}

function place(node, r) {
  if (!node || !r) return;
  node.style.left = r.x + 'px';
  node.style.top = r.y + 'px';
  node.style.width = r.w + 'px';
  node.style.height = r.h + 'px';
}

function relayout() {
  const g = layout();
  if (!g) return;
  geo = g;
  g.slots.forEach(s => {
    place(cardBox[s], g.cardRect[s]);
    place(wellBox[s], g.slotRect[s]);
  });
  place(unsortedBox, g.unRect);
  unsortedBox.style.setProperty('--cols', String(g.cols));
  unsortedBox.style.setProperty('--cell-size', D + 'px');
  unsortedBox.style.setProperty('--gut', GUT + 'px');
  if (field) {
    try { field.relayout(); } catch (e) { console.error(e); }
    applyWells();
  }
}

function onResize() {
  if (resizing) return;
  resizing = true;
  /* rAF は発火しないことがある（契約 §14）。setTimeout で束ねる */
  setTimeout(() => { resizing = false; if (root) { relayout(); render(); } }, 0);
}

/* 井戸を渡す。
   ・未分類は格子のマスをそのまま井戸にする（吸い込まれて格子に乗る）。
   ・枠の井戸は「埋まっているときだけ」置く。空の枠に井戸を置くと、
     落ちてきただけのバブルが勝手に吸い込まれて、ユーザーが選んでいない
     分類が付いたように見える。枠に入れるのは、人が手を離したときだけ。 */
function wellsFor(g) {
  const out = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      out.push({ id: 'u:' + r + ':' + c, x: g.x0 + c * PITCH, y: g.gridY + r * PITCH, w: D, h: D });
    }
  }
  g.slots.forEach(s => {
    if (!inSlot(s)) return;
    const r = g.slotRect[s];
    out.push({ id: 's:' + s, x: r.x, y: r.y, w: r.w, h: r.h });
  });
  return out;
}

function applyWells() {
  if (!field || !geo) return;
  if (typeof field.setWells !== 'function') return;   /* まだ無い版でも落ちない */
  try { field.setWells(wellsFor(geo)); } catch (e) { console.error(e); }
}

/* ---------------- 描画 ---------------- */

function render() {
  if (!root) return;
  if (dragging) { deferred = true; return; }   /* 掴んでいる間は触らない */
  if (!geo) relayout();
  /* ペインがまだ隠れていて座標が取れない。onShow がもう一度呼ぶ（契約 §14） */
  if (!geo) return;

  const list = unsorted();
  const filled = {};
  slotList().forEach(s => { filled[s] = inSlot(s); });

  /* 面に載せるもの */
  if (field) {
    const items = list.map(itemFor);
    if (slotsInField()) {
      slotList().forEach(s => { if (filled[s]) items.push(itemFor(filled[s])); });
    }

    /* 面にまだ出ていないものは、出る前に置き場所を決めておく。
       drift は最初の位置を store の fx/fy から読む（persist:true）ので、
       ノードができる前に setPos で決めれば、そこに出る。
       ・枠のものは井戸の真ん中へ。散らばって出ると重力で落ち、枠が空に見える
       ・未分類のものは格子の空いているマスへ（下の行から埋める。重力と同じ向き） */
    const taken = occupiedCells();
    if (slotsInField()) {
      slotList().forEach(s => {
        const t = filled[s];
        if (t && !hasNode(t.id)) prePlace(t.id, geo.slotRect[s]);
      });
    }
    list.forEach(t => {
      if (hasNode(t.id)) return;
      const r = takeCell(taken, t.id);
      if (r) prePlace(t.id, r);
    });

    try { field.setItems(items); } catch (e) { console.error(e); }
    evictStrays(list, items);
  }

  /* DOM に置くもの（面が無いとき／井戸が無いとき） */
  const kept = new Set();
  if (!field) {
    list.forEach(t => { kept.add(t.id); tray.appendChild(bubbleFor(t)); });
  }
  slotList().forEach(slot => {
    const t = filled[slot];
    const card = cardBox[slot];
    const well = wellBox[slot];
    if (!card || !well) return;
    card.classList.toggle('is-filled', !!t);
    well.classList.toggle('is-filled', !!t);
    const name = LABEL[slot] || slot;
    if (t) {
      well.setAttribute('aria-label', name + 'の枠（' + t.text + '）');
      if (!slotsInField()) {
        kept.add(t.id);
        well.classList.add('is-dom');
        well.appendChild(bubbleFor(t));
      }
    } else {
      well.classList.remove('is-dom');
      well.setAttribute('aria-label', name + 'の枠（空）');
    }
  });

  /* DOM 側から居なくなったものを片づける */
  [...bubbles.keys()].forEach(id => {
    if (kept.has(id)) return;
    const b = bubbles.get(id);
    try { b.detach && b.detach(); } catch (e) { /* 無視 */ }
    b.node.remove();
    bubbles.delete(id);
  });

  trayEmpty.hidden = list.length > 0;
  applyWells();
  syncDetail();
}

/* もう面にノードがあるか */
function hasNode(id) {
  if (!field || typeof field.nodeOf !== 'function') return false;
  try { return !!field.nodeOf(id); } catch (e) { return false; }
}

/* 井戸の中心にバブルの中心が来るよう、store の位置を決めておく。
   drift は fx/fy を「バブルの中心の、面の幅・高さに対する割合」として読む
   （実測: 面 375×756 で fy=0.797 → 中心 y=602.5 = 0.797×756）。
   端では中心が動ける範囲（直径の半分〜幅−半分）に丸められるので、
   こちらでも同じ範囲に収めてから渡す。
   setPos は既定で silent（通知を出さない）ので、ここから再描画は起きない。 */
function prePlace(id, r) {
  if (!geo || !r || typeof store.setPos !== 'function') return;
  const W = geo.W, H = geo.H;
  if (W <= D || H <= D) return;
  const cx = Math.min(W - D / 2, Math.max(D / 2, r.x + r.w / 2));
  const cy = Math.min(H - D / 2, Math.max(D / 2, r.y + r.h / 2));
  store.setPos(id, cx / W, cy / H);
}

/* この画面が置いたマス（'r:c' -> id）。
   requestAnimationFrame が発火しない環境では field.wellOf が何も返さないので、
   これが無いと、あとから足した項目に同じマスを何度も渡してしまう。 */
const placed = new Map();

/* いま誰かが収まっている未分類のマス（'r:c'）。
   field.wellOf（物理が見ている実際の居場所）と、自分が置いたぶんを合わせる。
   wellOf が無い版でも、自分の記録だけで重なりは避けられる。 */
function occupiedCells() {
  const used = new Set();
  const ids = unsorted().map(t => t.id);
  slotList().forEach(s => { const t = inSlot(s); if (t) ids.push(t.id); });
  const alive = new Set(ids);

  /* 居なくなったものの席は空ける */
  [...placed.keys()].forEach(k => { if (!alive.has(placed.get(k))) placed.delete(k); });
  placed.forEach((id, key) => used.add(key));

  if (field && typeof field.wellOf === 'function') {
    ids.forEach(id => {
      let w;
      try { w = field.wellOf(id); } catch (e) { return; }
      if (typeof w === 'string' && w.slice(0, 2) === 'u:') used.add(w.slice(2));
    });
  }
  return used;
}

/* 空いているマスを1つ取る。下の行から、左から。重力と同じ向きに埋まっていく。 */
function takeCell(used, id) {
  if (!geo) return null;
  for (let r = geo.rows - 1; r >= 0; r--) {
    for (let c = 0; c < geo.cols; c++) {
      const key = r + ':' + c;
      if (used.has(key)) continue;
      used.add(key);
      if (id) placed.set(key, id);
      return { x: geo.x0 + c * PITCH, y: geo.gridY + r * PITCH, w: D, h: D };
    }
  }
  return null;   /* 格子が埋まった。あとは物理に任せて積もらせる */
}

/* 押し出されたバブルは、井戸の真ん中で止まったまま残る。
   そこへ新しいバブルが入ると、ぶつかって新しいほうが弾き出されてしまう。
   枠の持ち主でないのに枠の井戸に居るものは、未分類のマスへ移す。
   （面から外して置き場所を決めて戻す。同じ処理の中なので画面はちらつかない） */
function evictStrays(list, items) {
  if (!field || !geo || typeof field.wellOf !== 'function') return;
  const strays = [];
  list.forEach(t => {
    let w;
    try { w = field.wellOf(t.id); } catch (e) { return; }
    if (typeof w === 'string' && w.slice(0, 2) === 's:') strays.push(t.id);
  });
  if (!strays.length) return;

  const out = new Set(strays);
  try {
    field.setItems(items.filter(i => !out.has(i.id)));
    const used = occupiedCells();
    strays.forEach(id => { const r = takeCell(used, id); if (r) prePlace(id, r); });
    field.setItems(items);
  } catch (e) { console.error(e); }
}

/* 面へ渡す形。size を添えて、枠の中でも海でも一定 96px にする。 */
function itemFor(t) {
  return {
    id: t.id,
    text: t.text,
    started: isStarted(t.id),
    marks: [],
    anchorHue: null,
    colors: tagColors(t.id),
    tagNames: tagNames(t.id),
    size: D,
  };
}

/* DOM 側のバブル。ノードは作り直さずに使い回す。
   （面のノードには attachGestures を張らない。ここは面の外のノードだけ） */
function bubbleFor(t) {
  /* t.started は store 上では {[anchorKey]: 時刻} の形で、
     まだ何も無くても「空オブジェクト」＝ JS では真になる。
     そのまま `||` に通すと全部が着手済みに化けるので、必ず isStarted() で見る。 */
  const item = { id: t.id, text: t.text, started: isStarted(t.id) };
  const opts = { size: D, marks: [], anchorHue: null, colors: tagColors(t.id), tagNames: tagNames(t.id) };

  let b = bubbles.get(t.id);
  if (!b) {
    const node = makeBubble(item, opts);
    const detach = attachGestures(node, {
      onFocusRequest: () => openFive(t.id),
      onMenu: (mid, node2) => openItemMenu(t.id, node2),
      onActions: () => actionsFor(t.id),
      onDropToTab: (mid, tabId) => dropToTab(t.id, tabId),
      onDragStart: () => onGrab(t.id),
      onDragEnd: () => finishDrop(),
      getHost: () => root,
    });
    b = { node, detach };
    bubbles.set(t.id, b);
  } else if (typeof updateBubble === 'function') {
    updateBubble(b.node, item, opts);
  }
  return b.node;
}

/* ---------------- 掴む・落とす ---------------- */

function onGrab(id) {
  dragging = true;
  dragId = id;
  pendingDrop = true;
  tabDropped = false;
  lastPt = null;
}

function nodeFor(id) {
  if (!id) return null;
  if (field && typeof field.nodeOf === 'function') {
    try { const n = field.nodeOf(id); if (n) return n; } catch (e) { /* 無視 */ }
  }
  const b = bubbles.get(id);
  return b ? b.node : null;
}

/* 落とし先は「バブルの中心」で見る。物理の井戸が見るのも中心なので、
   指先で見ると「枠に入れたのに吸い込まれない」がおきる。
   ただし面の中か外か（＝タブへ落としたのか）は指先で見る。
   バブルの外形はタブ6本ぶんを覆うため（契約 §14）。 */
function pointOf(ev) {
  if (!fieldHost) return null;
  const hr = fieldHost.getBoundingClientRect();
  if (!hr.width || !hr.height) return null;
  const fx = ev.clientX, fy = ev.clientY;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  let cx = fx, cy = fy;
  const n = nodeFor(dragId);
  if (n && typeof n.getBoundingClientRect === 'function') {
    const r = n.getBoundingClientRect();
    if (r.width) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  }
  return {
    x: cx - hr.left,
    y: cy - hr.top,
    inside: fx >= hr.left && fx <= hr.right && fy >= hr.top && fy <= hr.bottom,
  };
}

function inRect(p, r) {
  return !!(p && r) && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/* 中心が枠の矩形に入っていれば、その枠。入っていなければ null（＝未分類） */
function hitSlot(p) {
  if (!geo || !p) return null;
  for (const s of geo.slots) {
    if (inRect(p, geo.slotRect[s])) return s;
  }
  return null;
}

function onPointerMove(ev) {
  if (!dragging || !isActive()) return;
  const p = pointOf(ev);
  if (!p) return;
  lastPt = p;
  const s = hitSlot(p);
  markOver(s ? cardBox[s] : (inRect(p, geo && geo.unRect) ? unsortedBox : null));
}

function onPointerUp(ev) {
  if (!dragging || !isActive()) return;
  const p = pointOf(ev);
  if (p) lastPt = p;
  finishDrop();
  /* onDragEnd が来なかったときの保険。setTimeout は裏に回ると
     1秒単位に間引かれるが、止まったままにはならない */
  setTimeout(flush, 0);
}

function onPointerCancel() {
  if (!dragging) return;
  pendingDrop = false;
  clearOver();
  setTimeout(flush, 0);
}

/* 落下の適用。pointerup と onDragEnd のどちらが先でも1回だけ通る。 */
function finishDrop() {
  clearOver();
  if (!pendingDrop) { setTimeout(flush, 0); return; }
  pendingDrop = false;
  applyDrop();
  setTimeout(flush, 0);
}

function flush() {
  dragging = false;
  dragId = null;
  lastPt = null;
  if (!deferred) return;
  deferred = false;
  render();
}

function isActive() {
  return !!(paneEl && paneEl.classList.contains('is-active'));
}

function markOver(node) {
  if (overNode === node) return;
  if (overNode) overNode.classList.remove('is-over');
  overNode = node || null;
  if (overNode) overNode.classList.add('is-over');
}
function clearOver() { markOver(null); }

/* 面の中で手を離した。枠の矩形に入っていればその枠、そうでなければ未分類。
   未分類に戻したものは、そのまま面を漂って下へ落ちる。

   ■ 規定の場所の外に置いたら、未分類へもどす（利用者の指示）
   枠に入っていたバブルを、枠でないところで離したら gapSlot を null にする。
   判定は「手を離した位置」だけで行う——掴んでいる途中に枠の外を通っただけで
   分類が外れると、運んでいる最中に持ち物が変わることになる。

   ここで気をつけること:
   - **黙って外さない。**外れたことをトーストで言い、取り消せるようにする。
     言わずに外すと「置いたものが消えた」に見える（押し出しと同じ事故）。
   - **叱らない。**「そこには置けません」と断るのは罰の操作（契約 §0）。
     置きたい所には置ける。そのうえで、どこへ行ったかだけを伝える。
   - **もともと未分類のものには何も起きない。**戻す先が無い（from === slot で弾かれる）。
   - **タブへのドロップとは喧嘩させない**（tabDropped / p.inside）。 */
function applyDrop() {
  const id = dragId;
  const p = lastPt;
  if (!id || !p) return;
  if (tabDropped) return;         /* タブが受け止めた＝所属を足す操作だった */
  if (!p.inside) return;          /* 指先が面の外（タブバーなど）。ここでは何もしない */

  const slot = hitSlot(p);
  const from = slotOf(id);
  if (from === slot) return;      /* 同じ枠の中／未分類の中で動かしただけ */

  const res = putIn(id, slot);

  if (!slot) {
    /* 枠の外へ置いた。from は必ず枠（上の from === slot で未分類どうしは弾いてある）。
       押し出しは起きない（入れる枠が無いので setGapSlot は誰も追い出さない）。 */
    const name = trim((itemOf(id) || {}).text);
    toast(name + ' を未分類へもどした', {
      label: '取り消す',
      on: () => { putIn(id, from); },
    });
    return;
  }

  const out = res.pushedOut;
  if (!out) return;

  /* 押し出したことは必ず言う。取り消しは押し出された側を元の枠へ戻す。
     戻すだけだと今度は新しいほうが押し出されるので、
     先に新しいほうを元の場所へ返してから戻す（掴む前の並びに近づける）。 */
  const outName = trim((itemOf(out) || {}).text);
  toast(outName + ' を未分類へ', {
    label: '取り消す',
    on: () => {
      putIn(id, from);
      putIn(out, slot);
    },
  });
}

/* ---------------- タブへ落とした ---------------- */

function dropToTab(id, tabId) {
  /* タブが受け止めた。applyDrop の「枠の外＝未分類へもどす」を発動させない。
     どのタブでも（自分のタブ 'gap' でも）立てる——タブへ運ぶ動きは
     「所属を足す」であって「枠から出す」ではないため。 */
  tabDropped = true;

  const t = itemOf(id);
  const name = trim(t ? t.text : '');

  if (tabId === 'sea') {
    /* 全解除。今日・きっかけ・すきま時間の3つとも外す（契約 §2） */
    const before = {
      today: !!(t && t.today),
      anchors: (typeof store.anchorsOf === 'function' && store.anchorsOf(id)) || [],
      gapSlot: slotOf(id),
    };
    if (typeof store.setToday === 'function') store.setToday(id, false);
    if (typeof store.clearAnchors === 'function') store.clearAnchors(id);
    if (typeof store.setGap === 'function') store.setGap(id, false);

    toast(name + ' を海へ戻した', {
      label: '取り消す',
      on: () => {
        if (before.today && typeof store.setToday === 'function') store.setToday(id, true);
        if (typeof store.setAnchor === 'function') {
          before.anchors.forEach(a => store.setAnchor(id, a, true));
        }
        if (typeof store.setGap === 'function') store.setGap(id, true);
        if (before.gapSlot) putIn(id, before.gapSlot);
      },
    });
    return;
  }

  if (tabId === 'today') {
    /* 追加であって移動ではない。すきま時間の印はそのまま残る */
    if (typeof store.setToday === 'function') store.setToday(id, true);
    toast(name + ' を今日へ', {
      label: '取り消す',
      on: () => { if (typeof store.setToday === 'function') store.setToday(id, false); },
    });
    return;
  }

  if (tabId === 'plan') {
    /* どのきっかけにぶら下げるかは決まっていない。勝手に決めない。 */
    toast('どのきっかけに付けるかは、ここでは決まっていない');
    return;
  }

  /* 'gap' は自分のタブ。すでにすきま時間なので何も変わらない */
}

/* 中央の盤に出す操作。副作用を持たせない（返すだけ） */
function actionsFor(id) {
  return {
    isDone: typeof store.isDone === 'function' ? !!store.isDone(id) : false,
    onStarted: () => markStarted(id),
    onComplete: () => completeItem(id),
    onDelete: () => deleteItem(id),
  };
}

/* ---------------- 盤・メニュー ---------------- */

function openItemMenu(id, node) {
  openMenu(node, {
    onDetail:  () => openDetail(id),
    onFocus:   () => openFive(id),
    onStarted: () => markStarted(id),
    onComplete: () => completeItem(id),
    onDelete:  () => deleteItem(id),
  });
}

/* 「はじめた」。store の制限は追補3 §6 で外れている。
   ここで勝手に today を立てて記録を通すことはしない。 */
function markStarted(id) {
  const ok = (typeof store.start === 'function') && store.start(id, null) === true;
  if (ok) {
    toast('はじめた', {
      label: '取り消す',
      on: () => { if (typeof store.unstart === 'function') store.unstart(id, null); },
    });
    render();
    return;
  }
  toast('いまは記録できなかった');   /* いまは到達しない。store が断ったときの保険 */
}

function completeItem(id) {
  if (typeof store.complete !== 'function') return;
  const t = itemOf(id);
  const name = trim(t ? t.text : '');
  const snap = store.complete(id);
  if (!snap) return;

  /* 音は sound.js に任せる（設定のオフと prefers-reduced-motion も向こうが見る）。
     読み込みは静的（他の4ファイルと揃えた。理由は today.js の同じ箇所に書いた）。 */
  try { playComplete(); } catch (err) { console.error(err); }

  toast(name + ' を完了', {
    label: '取り消す',
    on: () => { if (typeof store.restore === 'function') store.restore(snap); },
  });
}

function deleteItem(id) {
  if (typeof store.remove !== 'function') return;
  const t = itemOf(id);
  const name = trim(t ? t.text : '');
  const snap = store.remove(id);
  if (!snap) return;
  toast(name + ' を消した', {
    label: '取り消す',
    on: () => { if (typeof store.restore === 'function') store.restore(snap); },
  });
}

/* 5分だけ集中。押した時点では何も記録しない。 */
function openFive(id) {
  const t = itemOf(id);
  if (!t) return;
  const slot = slotOf(id);
  import('../focus.js').then(m => {
    m.openFocus({
      id:        id,
      title:     t.text,
      firstStep: detailOf('firstStepOf', id),
      url:       detailOf('urlOf', id),
      slotName:  slot ? (LABEL[slot] || '') : '',
      minutes:   5,
      onClose(info) {
        /* 集中画面の [完了]。completed:true のとき reachedGoal は false（両方立てない） */
        if (info && info.completed) { completeItem(id); render(); return; }
        /* 5分にたどりついたときだけ記録を試みる */
        if (info && info.reachedGoal && typeof store.start === 'function') {
          store.start(id, null);
          render();
        }
      },
    });
  }).catch(err => { console.error(err); });
}

/* ---------------- 詳細パネル ----------------
   再描画をまたいでノードを使い回す（入力中の値を消さないため）。 */

let detail = null;      /* { box, id, title, step, url, startBtn } */

function openDetail(id) {
  const t = itemOf(id);
  if (!t) return;
  if (!detail) detail = buildDetail();
  detail.id = id;
  root.appendChild(detail.box);
  detail.box.hidden = false;
  syncDetail();
  detail.step.focus({ preventScroll: true });
}

function closeDetail() {
  if (!detail) return;
  detail.id = null;
  detail.box.hidden = true;
}

function syncDetail() {
  if (!detail || !detail.id) return;
  const t = itemOf(detail.id);
  if (!t) { closeDetail(); return; }        /* 外で消えたら閉じる */
  detail.title.textContent = t.text;
  if (document.activeElement !== detail.step) detail.step.value = detailOf('firstStepOf', t.id);
  if (document.activeElement !== detail.url) detail.url.value = detailOf('urlOf', t.id);
  detail.startBtn.textContent = isStarted(t.id) ? 'はじめた' : '開始した';
  detail.startBtn.disabled = isStarted(t.id);
}

function buildDetail() {
  const box = el('div', 'gap-detail');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '詳細');
  box.hidden = true;

  const hd = el('div', 'gap-detail-hd');
  const title = el('h3', 'nm');
  const close = el('button', 'gap-x');
  close.type = 'button';
  close.textContent = '閉じる';
  close.addEventListener('click', closeDetail);
  hd.appendChild(title);
  hd.appendChild(close);

  const stepLb = el('label', 'gap-lb');
  stepLb.textContent = '最初の一手';
  const step = document.createElement('input');
  step.type = 'text';
  step.className = 'gap-in';
  step.placeholder = '手をつける最初のひと動き';
  stepLb.appendChild(step);

  const urlLb = el('label', 'gap-lb');
  urlLb.textContent = 'URL';
  const url = document.createElement('input');
  url.type = 'url';
  url.className = 'gap-in';
  url.placeholder = 'https://';
  urlLb.appendChild(url);

  const startBtn = el('button', 'btn gap-start');
  startBtn.type = 'button';
  startBtn.textContent = '開始した';

  /* 2つとも先に読んでから書く。
     1つ目を書いた時点で store が通知し、その再描画（syncDetail）が
     まだ保存していない2つ目の欄を store の値で上書きしてしまうため。 */
  const save = () => {
    if (!detail || !detail.id) return;
    const id = detail.id;
    const s = step.value;
    const u = url.value;
    if (typeof store.setFirstStep === 'function') store.setFirstStep(id, s);
    if (typeof store.setUrl === 'function') store.setUrl(id, u);
  };
  step.addEventListener('change', save);
  url.addEventListener('change', save);
  step.addEventListener('blur', save);
  url.addEventListener('blur', save);

  startBtn.addEventListener('click', () => {
    if (!detail || !detail.id) return;
    markStarted(detail.id);
    syncDetail();
  });

  box.appendChild(hd);
  box.appendChild(stepLb);
  box.appendChild(urlLb);
  box.appendChild(startBtn);
  return { box, id: null, title, step, url, startBtn };
}
