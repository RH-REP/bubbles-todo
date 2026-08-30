/* 画面3「きっかけ」— きっかけ（アンカー）の枠に、バブルを入れる

   時計を持ち込まない画面。朝/昼/夜 という固定の枠はやめて、
   ユーザー自身が決めた「きっかけ」（歯を磨いたら、風呂から出たら…）の
   枠に、やることを入れる。狙いは実装意図——「もし〈状況〉なら〈行動〉」——で、
   〈状況〉を時刻ではなく、すでに毎日必ず起きている行動に置く。
   時刻は自分では起こらないが、歯磨きは自分で起きるため。

   だからこの画面には時刻表示も「いま」の強調も無い。並び順はユーザーが決める。

   ・アンカーは見出しであって、記録の対象ではない。押しても何も起きない（▶ を付けない）
   ・枠の中のバブルは一定サイズ。文字量で大きさが変わるのは「海」と「今日」だけ（契約 §4）
   ・「先頭が主役。大きく出る」は廃止した。同じ枠の中に上下関係を作らない
   ・入れたものは日をまたいでも消えない（立てっぱなしの計画）
   ・いちばん下が「未分類」。この画面に来たが、まだどの枠にも入っていないもの。
     面には重力があるので、どこにも掴まれていないものが下に溜まるのが自然（追補5 §2）
   ・セルの幅はバブルの直径の整数倍。バブルはその格子に乗る（端数を出さない）

   操作:
     ・タップ → 中央へ寄る → 1秒以内にもう一度 … 5分だけの集中（bubble.js が見る）
     ・長押し … 詳細 / 5分だけ集中 / はじめた / 完了 / 消す
     ・見出しの左の取っ手をドラッグ … きっかけの並べ替え（⋮ の「上へ／下へ」も残す）
     ・枠から枠へドラッグ … きっかけの付け替え。未分類の枠へ戻すと、きっかけから外れる
     ・どの枠でもないところで離す … きっかけから外れて、未分類へもどる（トースト＋取り消し）
     ・タブへドラッグ … 海=全解除 / 今日=today を足す / すきま=gap を足す（契約 §2） */

import { store } from '../store.js';
import { el, escapeHtml, toast } from '../ui.js';
import {
  makeBubble,
  attachGestures,
  openMenu as openBubbleMenu,
} from '../bubble.js';
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

/* 付いているタグの色。バブルはこの色になる（タグが無ければ空＝いまの青）。
   点（marks）でタグを表すのはやめたので、色だけを渡す（追補4 §1）。 */
function tagColors(id) {
  if (typeof store.tagsOf !== 'function' || typeof store.tags !== 'function') return [];
  let ids, all;
  try { ids = store.tagsOf(id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(t => [t.id, t.color]));
  return ids.map(t => by.get(t)).filter(c => typeof c === 'string' && c);
}

/* 枠の中は一定サイズ（契約 §4）。文字量では変えない。
   カードの幅はかならずこの整数倍にする（利用者の指示）。端数を出さないための約束。 */
const BUB_SIZE = 96;
const MAX_COLS = 4;    /* 375px 幅ではカード幅 3×96=288px。広い画面でも横に散らしすぎない */

/* --- 升目の間合い ---

   井戸（引力のセル）は「バブル1個ぶんの升目」に置く。カード1枚を丸ごと1つの
   井戸にしてはいけない：
     ・250px 角より大きい井戸は、いちばん遠い角で加速度が重力と同じくらいまで
       落ちるので、隅のものが中心まで集まりきらない
     ・1つの井戸に複数のバブルが入ると、互いに押し合って中心に収まらない

   升目どうしの中心間距離は 100px 以上でなければならない。
   バブルがぶつかる間合いが (96+96)/2 + 4 = 100px なので、これより近い升目に
   隣り合って収まったバブルは押し合い、いつまでも微妙に動き続ける。 */
const HIT_PITCH = BUB_SIZE + 4;   /* = 100。収まったバブルどうしが触れ合う距離 */
/* 升目の中心間距離（縦横とも）。HIT_PITCH を下回らせない。
   112 は 100 に 12px の余裕を足した値——ちょうど 100 だと、収まったバブルの縁が
   接したまま数値誤差で押し合う可能性が残る。 */
const CELL_PITCH = Math.max(112, HIT_PITCH);
const SAVE_MS = 400;   /* 最初の一手の自動保存。打っている途中で毎回は書かない */

/* 並べ替えのドラッグを始めたと見なす距離。
   これ未満は「押した」として扱う（押しただけで並びが動くと事故になる） */
const REORDER_SLOP = 6;

/* 動きを減らす設定のときは、掴んだカードを指に追わせない（追補5「守ること」）。
   毎回聞くのは無駄なので、一度だけ作って使い回す */
const reduceMotion = (typeof matchMedia === 'function')
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

/* 未分類の枠を指す where の値。アンカーの id とは衝突しない形にしておく */
const UNSORTED = '\u0000unsorted';   /* 生の NUL を直接書くと、ファイルが grep 等にバイナリ扱いされる。値は同じままエスケープで書く */

/* 色はアンカー個体に付く（順位ではない）ので、並べ替えても変わらない。
   hue は 0|1|2|null。null は色を持たない＝無彩色で扱う。新しい色は足さない。
   先頭3つだけ色が付き、4つ目以降が無彩色になるのは store が hue を配るときの決まりで、
   この画面は配られた hue をそのまま読むだけ（並べ替えても色が動かないのはそのため）。 */
const HUES = ['var(--slot-morning)', 'var(--slot-noon)', 'var(--slot-night)'];
const NO_HUE = 'var(--text-2)';
function colorOf(a) {
  if (!a || a.hue == null) return NO_HUE;
  return HUES[a.hue] || NO_HUE;
}
function nameOf(id) {
  const a = store.anchor(id);
  return a ? a.name : '';
}

/* --- plan 系の窓口（setPlan / isPlan / planUnsorted）---
   「この画面に属する」を持つのは store で、未分類の中身は store.planUnsorted()。
   typeof を見ているのは、この画面だけ先に配られたときに落とさないため。
   黙って空にはせず、一度だけコンソールに出す（空の未分類は正常な状態と
   見分けがつかないので、無言で握り潰さない）。 */
let warnedPlan = false;
function warnPlan(name) {
  if (warnedPlan) return;
  warnedPlan = true;
  console.warn('[plan] store.' + name + ' がまだ無い。未分類の枠は空のまま出る');
}
function planUnsorted() {
  if (typeof store.planUnsorted === 'function') return store.planUnsorted();
  warnPlan('planUnsorted');
  return [];
}
function setPlan(id, on) {
  if (typeof store.setPlan === 'function') return store.setPlan(id, on);
  warnPlan('setPlan');
  return false;
}
function isPlan(id) {
  if (typeof store.isPlan === 'function') return !!store.isPlan(id);
  return false;
}

/* 着手は「どのきっかけで」まで含めて記録する。未分類ではアンカー無し（null）として付く */
function isStarted(id, anchorId) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, anchorId || null);
}

/* scrollEl … 縦にスクロールする入れ物
   surfaceEl … その中の「面」。幅はバブルの直径の整数倍で、ここが drift の面になる。
                セルもバブルもこの面の座標系に乗る（スクロールしても両者がずれない） */
let pane, scrollEl, surfaceEl, cellsEl, tabbarEl;
let addBox, addBtn, addInput, hintEl;
let noneEl;      /* 今日の日のきっかけが1つも無いときの1行 */
let composerBox = null;
let anchorRef = {};            /* where -> { box, grid, count } … 未分類も含む落とし先 */
let unsubscribe = null;
let cols = 3;                  /* カード幅を決める倍数。カード幅 = cols * BUB_SIZE */
let slotCols = 2;              /* 1行に並ぶ升目の数。cols とは別物（間合いが違う） */
let resizeObs = null;

let composerAnchor = null;     /* いま「ここにぶら下げる」を開いているアンカー */
let renaming = null;           /* いま名前を書き換えているアンカー */
let menuPop = null, menuOwner = null;
let wantFocus = null;          /* 次の描画でここへフォーカスを置く（fk） */

/* 開いている詳細。画面を離れたら閉じてよいので保存はしない。
   ただし store.on(render) の再描画で勝手に閉じてはいけないので、
   開いている行のキーと、作った DOM そのものを持ち回る。
   DOM を作り直さないのは、入力中の値とカーソル位置を落とさないため。 */
const openKeys = new Set();
const details = new Map();     /* key -> { node, flush, sync } */
let renderedKeys = new Set();
let detailSeq = 0;
let inRender = false;

/* 描画のたびにバブルの DOM は作り直す。ジェスチャ層が window に付けたものを
   置き去りにしないよう、前の描画ぶんの detach をまとめて呼んでから作り直す */
let detachers = [];

/* 同じ todo が複数のアンカーへ同時に出るので、
   詳細の同一性は id だけでなく「どの枠に出ているか」まで含めて決める */
const keyOf = (id, where) => id + '::' + (where || 'none');

/* key -> { todo, where, anchor }。
   面（drift）の側は key しか持たない。1つの todo が複数の枠に出るので、
   drift へ渡す id は todo の id ではなく key にする（id では区別が付かない）。 */
const entries = new Map();

/* ---------------- 面（drift の引力の井戸） ----------------

   追補5 §1 で drift.js に `setWells` が入る。入ると枠は「引力の井戸」になり、
   バブルは面を漂って、セルに近づくと吸い込まれて止まる。

   面に載せ替えるには、井戸のほかにもう1つ要る——**どのバブルがどのセルの持ち物か**。
   この画面のバブルは「どのきっかけにぶら下がっているか」そのものなので、
   置き場所が物理まかせだと、意味が消える。だから setItems へ渡す1件に
   `well`（落ち着き先のセルの id）を載せている。

   drift が `setWells` を持たない／`well` を見ないうちに面へ載せると、
   バブルは重力でいちばん下まで落ちて全部が未分類の井戸に溜まる。
   例外は出ないが、画面としては壊れている（どのきっかけに何があるか読めない）。
   なので「壊れない」を「例外を出さない」ではなく「画面として読める」で取り、
   その2つが揃うまでは、これまでどおり枠の中へ流し込む（格子には乗せる）。
   揃ったかどうかは最初の setItems の結果で確かめる（下の checkPlacement）。 */
let field = null;              /* drift の面。井戸と置き場所が使えるときだけ持つ */
let fieldTried = false;
let fieldChecked = false;      /* 置き場所の確認を済ませたか */
let fieldItems = [];           /* 面へ渡す並び。流し込みのときは使わない */

function fieldOn() { return !!field; }

/* 面から返ってくる id を、この画面の1件に結び直す。

   ★ ここは素直に entries.get(id) では足りない。
     この画面は同じ todo を複数の枠に出すので、面へ渡す id は todo の id ではなく
     key（todo.id + '::' + where）にしている。ところが drift は、コールバックで
     **todo の id をそのまま返してくることがある**（実測: item.id に
     'bmtf9xn0qpgvz3::amtf9xn10ioaf6' を渡したのに onDragStart は
     'bmtf9xn0qpgvz3' で来た）。key でしか引かないと、掴めるのに離しても
     何も起きない——枠から枠への移動も、タブへのドロップも、全部黙って落ちる。

   引き直す順番（上ほど確か）:
     1. key そのもの
     2. いま掴まれているノードの data-key（stampNodes が書いてある）。
        同じ todo が複数の枠に出ていても、これならどの枠のバブルか一つに決まる
     3. todo.id での照合。複数の枠に出ていると、どれか一つには決められない */
function resolveEntry(id) {
  if (id == null) return null;
  const hit = entries.get(id);
  if (hit) return hit;

  /* 掴まれているノードはドラッグ層へ移されるので、そこも見る */
  const held = document.querySelector(
    '#drag-layer .bub[data-key], .plan-surface .bub[data-key].is-dragging, .plan-surface .bub[data-key].is-held');
  if (held && held.dataset.key) {
    const e = entries.get(held.dataset.key);
    if (e && (e.todo.id === id || held.dataset.key === id)) return e;
  }

  const hits = [];
  entries.forEach(e => { if (e.todo && e.todo.id === id) hits.push(e); });
  return hits.length ? hits[0] : null;
}

/* drift へ渡すハンドラ。
   ★ drift のノードには attachGestures を張らない（二重に張ると、離したときに
     バブルがドラッグ層へ残って画面の外へ出る。実際に起きた不具合） */
function fieldHandlers() {
  return {
    size: BUB_SIZE,
    onFocusRequest(key) {
      const e = resolveEntry(key);
      if (e) startFive(e.todo, e.anchor);
    },
    onMenu(key, node) {
      const e = resolveEntry(key);
      if (!e) return;
      openItemMenu(e.todo, e.anchor, e.key, node || nodeForKey(e.key));
    },
    onDropToTab(key, tabId) {
      const e = resolveEntry(key);
      tabDropped = true;
      if (e) dropToTab(e.todo, tabId);
    },
    onDragStart(key) {
      const e = resolveEntry(key);
      if (e) { beginDrag(e.todo.id, e.where); return; }
      /* 面が知っている id を、こちらが引けない。黙って落とすと
         「掴めるのに、離しても何も起きない」になる（実際に踏んだ） */
      console.warn('[plan] onDragStart の id を引けない', key);
    },
    onDragEnd() { endDrag(); },
    getHost() { return surfaceEl; },
  };
}

/* 面を1度だけ作る。drift.js は動的に読む——
   静的 import にすると、drift.js が無い／壊れている間はこの画面ごと読めなくなる */
function ensureField() {
  if (fieldTried) return Promise.resolve();
  fieldTried = true;
  return import('../drift.js').then(m => {
    if (typeof m.createField !== 'function') return;
    let f = null;
    try { f = m.createField(surfaceEl, fieldHandlers()); }
    catch (err) { console.warn('[plan] createField が失敗した。枠へ流し込む', err); return; }
    if (!f || typeof f.setWells !== 'function' || typeof f.wellOf !== 'function') {
      /* まだ井戸が無い。重力だけの面にはしない（上のコメント参照） */
      console.info('[plan] drift.setWells / wellOf がまだ無いので、枠へ流し込む形で出す');
      try { if (f && typeof f.destroy === 'function') f.destroy(); } catch (err) { /* 片付けで転ばない */ }
      return;
    }
    field = f;
    fieldChecked = false;
    if (typeof f.start === 'function') f.start();
    render();
    layout();
  }).catch(err => {
    console.warn('[plan] drift.js を読み込めなかった。枠へ流し込む', err);
  });
}

/* 面を畳んで、枠へ流し込む形に戻す */
function dropField() {
  const f = field;
  field = null;
  try { if (f && typeof f.destroy === 'function') f.destroy(); }
  catch (err) { /* 片付けで転ばない */ }
}

/* 面へ並びを渡す。
   最初の1回だけ「置き場所を守れたか」を確かめる——このときは面にノードが1つも
   無いので、渡した全件が新しく置かれる。頼んだセル（it.well）に入っていなければ、
   drift はまだ置き場所を見ていない。物理まかせの位置は、この画面では
   「どのきっかけにぶら下がっているか」を壊すので、その場合は面を畳む。 */
function pushItems() {
  if (!field) return;
  /* 升目を先に渡すこと。drift は「バブルを作るその場」で置き場所を決めるので、
     setItems が先だと、そのとき升目がまだ空＝置き場所の指定が無いことになり、
     全部が物理まかせの位置に出てしまう（実際にそうなっていた）。 */
  applyWells();
  try { field.setItems(fieldItems); }
  catch (err) { console.warn('[plan] setItems が失敗した', err); return; }
  stampNodes();
  if (fieldChecked || !fieldItems.length) return;
  fieldChecked = true;
  const stray = fieldItems.filter(it => {
    try { return field.wellOf(it.id) !== it.well; }
    catch (err) { return true; }
  });
  if (!stray.length) return;
  console.info('[plan] drift の setItems が item.well を見ていない（' + stray.length + '/'
    + fieldItems.length + '件が頼んだセルの外に置かれた）。'
    + '新しいバブルを item.well の矩形の中に置いてくれれば、面へ載せ替わる。'
    + 'それまでは枠へ流し込む形で出す');
  dropField();
  /* いまは render の内側。ここから呼び直しても inRender で弾かれるので、1手ずらす */
  Promise.resolve().then(() => render());
}

/* 面のバブルに、どれが何なのかを書いておく。

   ★ このノードを作るのは drift なので、makeItemBubble（枠へ流し込む道）で付けている
     data-key / data-id が付かない。無いと困るのは2つ:
       ・restoreFocus の最後の逃げ道（同じ todo のバブルへフォーカスを戻す）が
         `[data-key]` を探すので、面の道では一度も当たらない
       ・外から「この項目のバブル」を掴めない（検証や支援技術からの経路が消える）
     どちらの道で描いても同じ手がかりが読めるように、ここで書き足す。

   付けるのは data-key / data-id だけにする。data-fk は付けない——
   restoreFocus の byFk は当たったノードに focus() を試みるが、drift のノードは
   tabIndex を持たないので、当たっただけで戻せず、後ろの逃げ道まで塞いでしまう。
   role / tabIndex も足さない（ジェスチャは drift が持っている。契約どおり触らない）。 */
/* その key のバブルのノード。面の側で引けなければ、stampNodes が書いた
   data-key から探す（面が id をどちらの形で持っていても届くように） */
function nodeForKey(key) {
  if (field && typeof field.nodeOf === 'function') {
    try { const n = field.nodeOf(key); if (n) return n; } catch (err) { /* 下で探す */ }
  }
  if (!pane) return null;
  return Array.from(pane.querySelectorAll('.bub[data-key]'))
    .find(n => n.dataset.key === key) || null;
}

function stampNodes() {
  if (!field || typeof field.nodeOf !== 'function') return;
  fieldItems.forEach(it => {
    let node;
    try { node = field.nodeOf(it.id); }
    catch (err) { return; }
    if (!node || !node.dataset) return;
    const e = entries.get(it.id);
    node.dataset.key = it.id;                 /* it.id は keyOf(todo.id, where) */
    if (e && e.todo) node.dataset.id = e.todo.id;
    /* 詳細が開いていれば、どのパネルの開閉なのかを読み上げに繋ぐ */
    const d = details.get(it.id);
    if (d && d.node && d.node.id) node.setAttribute('aria-controls', d.node.id);
    else node.removeAttribute('aria-controls');
    node.setAttribute('aria-expanded', openKeys.has(it.id) ? 'true' : 'false');
  });
}

/* 井戸の id。カード（where）と、その中の何番目かで決まる。
   where はカードごとに一意なので、これで面ぜんぶを通して一意になる。 */
function wellIdOf(where, i) { return 'w' + i + ':' + where; }

/* 升目の中心（.grid の左上からの相対座標）。
   横は slotCols 列ぶんを .grid の幅の中で中央に寄せる（CSS の justify-content:center と同じ）。
   縦は上から順に CELL_PITCH ずつ。 */
function cellCenter(i, gridW) {
  const run = slotCols * CELL_PITCH;
  const x0 = (gridW - run) / 2;
  return {
    x: x0 + (i % slotCols) * CELL_PITCH + CELL_PITCH / 2,
    y: Math.floor(i / slotCols) * CELL_PITCH + CELL_PITCH / 2,
  };
}

/* 井戸 = バブル1個ぶんの升目。面の座標系での矩形。
   ★カードの .grid を丸ごと1つの井戸にしてはいけない（上の CELL_PITCH の注を参照）。
     ぶら下がっている数だけ升目を作り、1つの井戸には1個だけが収まるようにする。
   矩形はバブルの外形ちょうど（96×96）。升目の間合いは 112px なので矩形どうしは
   重ならず、バブルの中心はどの瞬間もたかだか1つの井戸の中にいる。
   setWells が無い作りとも同居できるよう typeof で包む */
function applyWells() {
  if (!field || typeof field.setWells !== 'function' || !surfaceEl) return;
  const sr = surfaceEl.getBoundingClientRect();
  const half = BUB_SIZE / 2;
  const wells = [];
  Object.keys(anchorRef).forEach(where => {
    const ref = anchorRef[where];
    const g = ref.grid;
    if (!g) return;
    const r = g.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const gx = r.left - sr.left;
    const gy = r.top - sr.top;
    for (let i = 0; i < ref.count; i++) {
      const c = cellCenter(i, r.width);
      wells.push({
        id: wellIdOf(where, i),
        x: gx + c.x - half,
        y: gy + c.y - half,
        w: BUB_SIZE,
        h: BUB_SIZE,
      });
    }
  });
  try { field.setWells(wells); }
  catch (err) { console.warn('[plan] setWells が失敗した', err); }
}

/* ---------------- 5分だけはじめる ---------------- */

/* focus.js は動的に読む。静的 import にすると、focus.js が無い／壊れている間は
   この画面ごと（app.js 経由で他の画面まで）読み込めなくなるため。

   押した時点では何も記録しない。5分にたどりついて初めて「はじめた」を立てる。
   途中でやめたときは何も残らない（押しただけを「はじめた」とは数えない） */
function startFive(todo, anchor) {
  import('../focus.js').then(m => {
    m.openFocus({
      id:        todo.id,
      title:     todo.text,
      firstStep: store.firstStepOf(todo.id),
      url:       store.urlOf(todo.id),
      slotName:  anchor ? anchor.name : '',
      slotColor: colorOf(anchor),
      minutes:   5,
      /* 5分にたどりついたら「はじめた」として記録する。
         「終わった？」と聞くのではなく、5分座っていたという観測できた事実を残すだけ */
      onClose(info) {
        /* 集中画面の [完了]。completed:true のとき reachedGoal は false（両方立てない） */
        if (info && info.completed) { completeItem(todo); render(); return; }
        if (info && info.reachedGoal) store.start(todo.id, anchor ? anchor.id : null);
        render();
      },
    });
  }).catch(err => {
    console.error('[plan] focus.js を読み込めなかった', err);
    toast('集中の画面をいま開けない。');
  });
}

/* ---------------- 行の詳細 ---------------- */

/* バブルは枠の中に並ぶので、詳細は「その下」には開けない。
   枠のいちばん下にまとめて開く。どれの詳細か分からなくならないよう、
   見出しに本文を出して、閉じるボタンを付ける。 */
function makeDetail(todo, anchorId, key) {
  const node = el('div', 'pdetail');
  node.id = 'pd-' + (++detailSeq);
  /* 詳細の中で押した pointerdown を、外のジェスチャに渡さない */
  node.addEventListener('pointerdown', ev => ev.stopPropagation());

  /* --- どれの詳細か --- */
  const head = el('div', 'pdhead');
  head.appendChild(el('span', 'ttl', escapeHtml(todo.text)));
  const close = el('button', 'pdclose');
  close.type = 'button';
  close.dataset.f = 'close';
  close.dataset.fk = 'close:' + key;
  close.appendChild(el('span', 'gl', '✕'));
  close.setAttribute('aria-label', todo.text + ' の詳細を閉じる');
  close.addEventListener('click', ev => {
    ev.stopPropagation();
    closeDetail(key);
    render();
  });
  head.appendChild(close);
  node.appendChild(head);

  /* --- 最初の一手。この詳細の主役なので上に、大きく --- */
  const fs = el('label', 'fs');
  fs.appendChild(el('span', 'lb', '最初の一手'));
  const fin = el('input', 'in');
  fin.type = 'text';
  fin.placeholder = 'まず何をする？';
  fin.autocomplete = 'off';
  fin.dataset.f = 'first';
  fin.dataset.fk = 'first:' + key;
  fin.value = store.firstStepOf(todo.id);
  fs.appendChild(fin);
  node.appendChild(fs);

  let ftimer = 0, pending = null;
  function saveFirst() {
    clearTimeout(ftimer); ftimer = 0;
    if (pending === null) return;
    const v = pending; pending = null;
    store.setFirstStep(todo.id, v);
  }
  fin.addEventListener('input', () => {
    pending = fin.value;
    clearTimeout(ftimer);
    ftimer = setTimeout(saveFirst, SAVE_MS);
  });
  fin.addEventListener('blur', saveFirst);
  fin.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    saveFirst();
  });

  /* --- URL --- */
  const ur = el('div', 'ur');
  ur.appendChild(el('span', 'lb', 'URL'));
  const rw = el('div', 'rw');
  const uin = el('input', 'in');
  uin.type = 'url';
  uin.placeholder = 'https://…';
  uin.autocomplete = 'off';
  uin.dataset.f = 'url';
  uin.dataset.fk = 'url:' + key;
  uin.value = store.urlOf(todo.id);
  rw.appendChild(uin);
  const open = el('a', 'open', '開く');
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.hidden = true;
  rw.appendChild(open);
  ur.appendChild(rw);
  /* 弾かれたことは伝えるが、手を止めさせない。だからアラートは出さない */
  const err = el('p', 'err', '開けないリンク');
  err.hidden = true;
  err.setAttribute('aria-live', 'polite');
  ur.appendChild(err);
  node.appendChild(ur);

  /* 「開く」は store が受け取った URL だけを出す。入力中の生の文字列は出さない */
  function syncLink() {
    const u = store.urlOf(todo.id);
    const show = !!u && /^https?:\/\//i.test(u) && err.hidden;
    if (show) open.href = u;
    else open.removeAttribute('href');
    open.hidden = !show;
  }
  let utimer = 0;
  function saveUrl() {
    clearTimeout(utimer); utimer = 0;
    const raw = uin.value.trim();
    if (!raw) {
      /* 空はエラーではない。消したいだけ */
      store.setUrl(todo.id, '');
      err.hidden = true;
      syncLink();
      return;
    }
    const r = store.setUrl(todo.id, raw);
    err.hidden = !!(r && r.ok);
    syncLink();
  }
  uin.addEventListener('input', () => {
    clearTimeout(utimer);
    utimer = setTimeout(saveUrl, SAVE_MS);
  });
  uin.addEventListener('blur', saveUrl);
  uin.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    saveUrl();
  });
  syncLink();

  /* --- あとから「はじめた」を記録する --- */
  /* 5分の集中を使わずに始めた場合の別ルート。記録先は5分経過と同じ。
     未分類の枠ではアンカー無し（null）として付く（画面2の「今日」と同じ扱い） */
  const doneBtn = el('button', 'pdone');
  doneBtn.type = 'button';
  doneBtn.dataset.f = 'done';
  doneBtn.dataset.fk = 'done:' + key;
  function syncDone() {
    const on = isStarted(todo.id, anchorId);
    doneBtn.classList.toggle('on', on);
    doneBtn.textContent = on ? '開始した ✓' : '開始した';
    doneBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    doneBtn.setAttribute('aria-label',
      todo.text + (anchorId ? ' を「' + nameOf(anchorId) + '」で' : ' を')
      + '開始したと' + (on ? '記録しない' : '記録する'));
  }
  syncDone();
  doneBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    if (isStarted(todo.id, anchorId)) store.unstart(todo.id, anchorId || null);
    else store.start(todo.id, anchorId || null);
    syncDone();
  });
  node.appendChild(doneBtn);

  function flush() {
    saveFirst();
    if (utimer) saveUrl();
  }

  /* 詳細のノードは再描画をまたいで使い回す。
     5分にたどりついて自動で「はじめた」が立った場合など、外で状態が変わったときに
     呼び直さないと、ボタンの見た目が古いまま残る */
  function sync() {
    syncDone();
    syncLink();
  }

  return { node, flush, sync };
}

function detailFor(key, todo, anchorId) {
  let d = details.get(key);
  if (!d) { d = makeDetail(todo, anchorId, key); details.set(key, d); }
  return d;
}

/* 閉じるときは、書きかけを取りこぼさないよう先に保存してから捨てる */
function closeDetail(key) {
  openKeys.delete(key);
  const d = details.get(key);
  if (!d) return;
  details.delete(key);
  d.flush();
}

function toggleDetail(key) {
  if (openKeys.has(key)) closeDetail(key);
  else openKeys.add(key);
  render();
}

/* ---------------- バブル ---------------- */

/* 面（drift）へ渡す1件。作るのは drift の側なので、ここでは中身だけを揃える。
   ★ colors と tagNames を落とさないこと（タグの色と、読み上げ用のタグ名）。
     色を見分けられない人に所属が伝わらなくなる（WCAG 1.4.1） */
function fieldItemFor(todo, where, index) {
  const anchorId = where === UNSORTED ? null : where;
  const anchor = anchorId ? store.anchor(anchorId) : null;
  const key = keyOf(todo.id, where);
  renderedKeys.add(key);
  entries.set(key, { todo, where, anchor, anchorId, key });
  return {
    id: key,                 /* 同じ todo が複数の枠に出るので、id ではなく key で持つ */
    text: todo.text,
    started: isStarted(todo.id, anchorId),
    size: BUB_SIZE,
    marks: [],
    colors: tagColors(todo.id),
    tagNames: tagNames(todo.id),
    startedLook: 'mark',     /* この画面では着手済みを強調する（利用者の決定） */
    anchorHue: anchor ? (anchor.hue == null ? null : anchor.hue) : null,
    /* 落ち着き先の升目。setWells の id と揃える。
       升目はバブル1個ぶんなので、1件につき1つ（カード単位ではない） */
    well: wellIdOf(where, index),
  };
}

/* where … アンカーの id / UNSORTED */
function makeItemBubble(todo, where) {
  const anchorId = where === UNSORTED ? null : where;
  const anchor = anchorId ? store.anchor(anchorId) : null;
  const key = keyOf(todo.id, where);
  const isOpen = openKeys.has(key);
  renderedKeys.add(key);
  entries.set(key, { todo, where, anchor, anchorId, key });

  const node = makeBubble(
    { id: todo.id, text: todo.text, started: isStarted(todo.id, anchorId) },
    {
      /* 枠の中は一定サイズ（契約 §4）。文字量では変えない */
      size: BUB_SIZE,
      /* 行き先の点は「海」の整列で使う印（契約 §7）。
         枠の中では、その枠にいること自体が行き先なので付けない */
      marks: [],
      colors: tagColors(todo.id),
      tagNames: tagNames(todo.id),
      /* きっかけは習慣化の画面。済んだものは引っ込めるのではなく、
         むしろ目に入るようにする（利用者の指示）。海・今日は既定の 'dim' のまま */
      startedLook: 'mark',
      /* 色はアンカー個体に付く。並べ替えても動かない */
      anchorHue: anchor ? (anchor.hue == null ? null : anchor.hue) : null,
    },
  );
  node.dataset.key = key;
  node.dataset.id = todo.id;
  node.dataset.from = anchorId || '';
  node.dataset.fk = 'bub:' + key;
  if (anchor) node.style.setProperty('--c', colorOf(anchor));
  if (isOpen) node.classList.add('is-open');

  /* キーボードでも詳細とメニューへ行けるようにする。
     ジェスチャ層はポインタしか見ないので、ここは画面側の仕事。
     すでに role が付いていれば、そちらを壊さない */
  if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
  if (!(node.tabIndex >= 0)) node.tabIndex = 0;
  node.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  node.addEventListener('keydown', ev => {
    if (ev.target !== node) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleDetail(key);
      return;
    }
    /* 長押しの代わり。ContextMenu キーと Shift+F10 の両方を受ける */
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      openItemMenu(todo, anchor, key, node);
    }
  });

  const detach = attachGestures(node, {
    onFocusRequest() { startFive(todo, anchor); },
    onMenu(id, target) { openItemMenu(todo, anchor, key, target || node); },
    onDropToTab(id, tabId) {
      /* タブで受けたことを控えておく。onDragEnd 側の枠判定と二重にしないため */
      tabDropped = true;
      dropToTab(todo, tabId);
    },
    /* 掴んだ場所は where で覚える（未分類も1つの枠として扱う）。
       null で持つと「未分類から未分類へ」が同じ枠だと判定できない */
    onDragStart() { beginDrag(todo.id, where); },
    onDragEnd() { endDrag(); },
    getHost() { return surfaceEl; },
  });
  if (typeof detach === 'function') detachers.push(detach);

  return node;
}

/* 長押しメニュー（契約 §6。全画面共通の5項目） */
function openItemMenu(todo, anchor, key, node) {
  closeAnchorMenu();
  openBubbleMenu(node, {
    onDetail() { toggleDetail(key); },
    onFocus()  { startFive(todo, anchor); },
    onStarted() { store.start(todo.id, anchor ? anchor.id : null); },
    onComplete() { completeItem(todo); },
    onDelete()  { deleteItem(todo); },
  });
}

/* 完了 = その項目を消す。ログには何も積まない（契約 §6）。
   音は鳴らす。取り消せるようにトーストを添える */
function completeItem(todo) {
  const snap = store.complete(todo.id);
  if (!snap) return;
  playComplete();
  toast('「' + todo.text + '」を完了にした', {
    label: '元に戻す',
    on: () => { store.restore(snap); },
  });
}

/* 消す = 従来どおり。音は鳴らさない */
function deleteItem(todo) {
  const snap = store.remove(todo.id);
  if (!snap) return;
  toast('「' + todo.text + '」を消した', {
    label: '元に戻す',
    on: () => { store.restore(snap); },
  });
}

/* ---------------- タブへのドロップ ---------------- */

/* 所属は「追加」であって「移動」ではない（契約 §2）。
   海だけが例外で、全部の所属を外す。 */
function dropToTab(todo, tabId) {
  const id = todo.id;
  if (tabId === 'sea') {
    const t = store.get(id) || {};
    const before = {
      today:   !!t.today,
      gap:     typeof store.isGap === 'function' ? !!store.isGap(id) : !!t.gap,
      plan:    isPlan(id),
      anchors: (typeof store.anchorsOf === 'function' ? store.anchorsOf(id) : []).slice(),
    };
    store.setToday(id, false);
    store.setGap(id, false);
    store.clearAnchors(id);
    setPlan(id, false);
    /* この画面から消える操作なので、消えた先を言って取り消せるようにする */
    toast('「' + todo.text + '」を海へ戻した', {
      label: '元に戻す',
      on: () => {
        if (before.today) store.setToday(id, true);
        if (before.gap) store.setGap(id, true);
        if (before.plan) setPlan(id, true);
        before.anchors.forEach(aid => store.setAnchor(id, aid, true));
      },
    });
    return;
  }
  if (tabId === 'today') {
    store.setToday(id, true);
    toast('「' + todo.text + '」を今日にも入れた', {
      label: '元に戻す', on: () => { store.setToday(id, false); },
    });
    return;
  }
  if (tabId === 'gap') {
    store.setGap(id, true);
    toast('「' + todo.text + '」をすきま時間にも入れた', {
      label: '元に戻す', on: () => { store.setGap(id, false); },
    });
    return;
  }
  /* 'plan' … すでにこの画面にいる。何も足さない */
}

/* ---------------- 枠から枠へのドラッグ ---------------- */

/* ジェスチャ層が渡してくれるのは onDragStart / onDragEnd / onDropToTab の3つで、
   「画面の中のどこで離したか」は渡ってこない。だから指先の座標は自分で見る。
   ドラッグの間だけ window を捕まえる（capture で拾うので、
   途中で stopPropagation されても取りこぼさない）。 */
let drag = null;                 /* { id, from } */
let lastPt = { x: -1, y: -1 };
/* このドラッグが onDropToTab で受け止められたか。
   drag を null にしたあとで onDropToTab が来ることもあるので、別に持つ */
let tabDropped = false;

function onWinPointer(ev) {
  lastPt = { x: ev.clientX, y: ev.clientY };
  if (drag) markOver(lastPt);
}

function beginDrag(id, from) {
  drag = { id, from };
  tabDropped = false;
  /* 前のドラッグの座標を持ち越さない。1度も動かなかったら判定しない */
  lastPt = { x: -1, y: -1 };
  window.addEventListener('pointermove', onWinPointer, true);
  window.addEventListener('pointerup', onWinPointer, true);
  closeAnchorMenu();
  surfaceEl.classList.add('is-dragging');
}

function endDrag() {
  const d = drag;
  drag = null;
  window.removeEventListener('pointermove', onWinPointer, true);
  window.removeEventListener('pointerup', onWinPointer, true);
  surfaceEl.classList.remove('is-dragging');
  clearOver();
  if (!d) return;
  const pt = lastPt;

  /* onDropToTab と onDragEnd のどちらが先に来るかは決まっていないので、
     マイクロタスク1つぶん待ってから見る。それでも取りこぼしうるので、
     指先がタブバーの上なら、そもそも枠の判定をしない（二重処理の保険） */
  Promise.resolve().then(() => {
    if (tabDropped) return;
    if (overTabbar(pt)) return;
    /* 一度も動かなかった（座標が入っていない）。掴んだだけなので判定しない */
    if (!(pt.x >= 0) || !(pt.y >= 0)) return;
    const t = hitTest(pt.x, pt.y);
    if (!t) { strayDrop(d.id, d.from); return; }     /* 枠の外で離した（下を参照） */
    if (t.where === d.from) return;                 /* 掴んだ枠へ戻した */
    if (t.where === UNSORTED) { toUnsorted(d.id, d.from); return; }
    if (d.from === UNSORTED) { store.setAnchor(d.id, t.where, true); return; }
    store.moveItemAnchor(d.id, d.from, t.where);
  });
}

/* 枠の外（枠と枠のすきま、スクロールの余白、「きっかけを足す」のあたり）で離した。

   ■ 規定の場所の外に置いたら、未分類へもどす（利用者の指示）
   きっかけにぶら下がっていたものを、どの枠でもないところで離したら
   きっかけから外して、この画面の未分類へ落とす。

   以前ここは「何もしない」だった。理由は、バブルが行より大きく枠のあいだの余白も
   広いので、置き損ねが「消えた」に見える事故になりやすいこと。
   その心配は残るので、次の3つで受け止める:
     ・**行き先を必ず言う**（トースト）。黙って動かさない
     ・**取り消せる**。掴む前のきっかけへ戻せる
     ・**消えない。**行き先は同じ画面のいちばん下の「未分類」で、画面の中に見えている
   断り書き（「そこには置けません」）は出さない。断るのは罰の操作（契約 §0）。

   もともと未分類のものには何も起きない——戻す先が無い。 */
function strayDrop(id, from) {
  if (!from || from === UNSORTED) return;   /* もともと未分類。動かす先が無い */
  const t = store.get(id);
  if (!t) return;                           /* 離すまでのあいだに消えた */
  const before = (typeof store.anchorsOf === 'function' ? store.anchorsOf(id) : []).slice();
  if (!before.length) return;               /* すでにどのきっかけにも付いていない */

  /* 未分類はこの画面の中なので、plan は立てたままにする。
     落ちていると clearAnchors の瞬間に海へ帰ってしまう */
  setPlan(id, true);
  store.clearAnchors(id);

  toast('「' + t.text + '」を未分類へもどした', {
    label: '元に戻す',
    on: () => { before.forEach(aid => store.setAnchor(id, aid, true)); },
  });
}

function toUnsorted(id, from) {
  const before = (typeof store.anchorsOf === 'function' ? store.anchorsOf(id) : []).slice();
  /* 未分類の枠へ落としたのだから、この画面には残す。
     plan が落ちていると clearAnchors の瞬間に海へ帰ってしまう */
  setPlan(id, true);
  store.clearAnchors(id);
  const label = from ? nameOf(from) : '';
  toast(label ? '「' + label + '」から外した' : 'きっかけから外した', {
    label: '元に戻す',
    on: () => { before.forEach(aid => store.setAnchor(id, aid, true)); },
  });
}

function dropTargets() {
  return Object.keys(anchorRef).map(where => ({ where, box: anchorRef[where].box }));
}

function hitTest(x, y) {
  if (!(x >= 0) || !(y >= 0)) return null;
  return dropTargets().find(t => {
    const r = t.box.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }) || null;
}

/* ドロップ判定は指先の座標で（契約 §14）。バブルの外形はタブ6本ぶんを覆うため */
function overTabbar(pt) {
  if (!tabbarEl || !(pt.x >= 0)) return false;
  const r = tabbarEl.getBoundingClientRect();
  return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
}

function markOver(pt) {
  clearOver();
  if (overTabbar(pt)) return;
  const t = hitTest(pt.x, pt.y);
  if (t) t.box.classList.add('is-over');
}

function clearOver() {
  dropTargets().forEach(t => t.box.classList.remove('is-over'));
}

function detachAll() {
  detachers.forEach(fn => { try { fn(); } catch (e) { /* 片付けで転ばない */ } });
  detachers = [];
}

/* ---------------- アンカーのメニュー ---------------- */

/* 再描画で消えると押した先が無くなるので、メニューは描画の産物にしない。
   開閉は DOM の付け外しだけで済ませる。 */
function closeAnchorMenu() {
  if (!menuPop) return;
  menuPop.remove();
  if (menuOwner && menuOwner.isConnected) menuOwner.setAttribute('aria-expanded', 'false');
  menuPop = null; menuOwner = null;
}

function openAnchorMenu(a, index, total, btn, host) {
  closeAnchorMenu();
  const pop = el('div', 'amenu-pop');
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', a.name + ' のメニュー');

  const rows = [
    { label: '名前を変える', on: () => { renaming = a.id; wantFocus = 'aname:' + a.id; render(); }, off: false },
    { label: '日にちを決める', on: () => openSchedule(a), off: typeof store.setAnchorSchedule !== 'function' },
    { label: '上へ',        on: () => { wantFocus = 'amenu:' + a.id; store.moveAnchor(a.id, -1); render(); }, off: index <= 0 },
    { label: '下へ',        on: () => { wantFocus = 'amenu:' + a.id; store.moveAnchor(a.id, +1); render(); }, off: index >= total - 1 },
    { label: '消す',        on: () => removeAnchor(a, index), off: false, danger: true },
  ];

  rows.forEach(r => {
    const b = el('button', r.danger ? 'danger' : null, escapeHtml(r.label));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (r.off) b.disabled = true;
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      closeAnchorMenu();
      r.on();
    });
    pop.appendChild(b);
  });

  pop.addEventListener('keydown', ev => {
    const items = Array.from(pop.querySelectorAll('button:not([disabled])'));
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); closeAnchorMenu(); btn.focus(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1 + items.length) % items.length].focus(); return; }
    if (ev.key === 'ArrowUp')   { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); return; }
    if (ev.key === 'Tab') { closeAnchorMenu(); }
  });

  host.appendChild(pop);
  /* 下のほうのアンカーでは、はみ出さないよう上に開く */
  const scroller = scrollEl.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  if (r.bottom + 150 > scroller.bottom) pop.classList.add('up');

  menuPop = pop; menuOwner = btn;
  btn.setAttribute('aria-expanded', 'true');
  const first = pop.querySelector('button:not([disabled])');
  if (first) first.focus();
}

/* ぶら下がっているものがあるときだけ件数を言う。
   専用のダイアログは作らず、消してからトーストで取り消せるようにする。 */
function removeAnchor(a, index) {
  const items = store.inAnchor(a.id);
  const ids = items.map(t => t.id);
  const name = a.name;
  const total = store.anchors().length;
  if (!store.removeAnchor(a.id)) return;

  if (!ids.length) { toast('「' + name + '」を消した'); render(); return; }

  toast('「' + name + '」を消した（' + ids.length + '件が入っていた）', {
    label: '元に戻す',
    on: () => {
      const na = store.addAnchor(name);
      if (!na) { toast('戻せなかった'); return; }
      ids.forEach(tid => store.setAnchor(tid, na.id, true));
      /* 追加は末尾に付くので、元の位置まで押し上げる */
      for (let i = total - 1; i > index; i--) store.moveAnchor(na.id, -1);
    },
  }, 6000);
  render();
}

/* ---------------- カードの並べ替え（ドラッグ） ----------------

   これまでは ⋮ の「上へ／下へ」だけだった。メニューは残す——
   キーボードだけで使う人の経路であり、遠くへ動かすときも押した回数ぶん確実に動く。

   掴む場所は見出しの左の取っ手だけにした。カード全体を掴めるようにすると、
   縦スクロールと、枠の中のバブルのドラッグと、3つが同じ指の動きを取り合う。
   取っ手は 44×44 で、そこだけ touch-action:none にしてある（他の場所は今までどおり
   縦スクロールできる）。取っ手には上下の矢印キーも効く。

   落とす場所の判定は「指より上にあるカードの数」。掴んでいるカードは数えない。
   その数がそのまま行き先の番号になる（＝ store.moveAnchor に渡す先の位置）。 */

let reorder = null;      /* { id, from, ids, startY, startScroll, y, moved, target } */
let dropLine = null;

/* きっかけは最大12個まで作れる（store.MAX_ANCHORS）ので、画面に入りきらない。
   端まで運んだら送るようにしないと、見えている範囲の中でしか並べ替えられない。 */
const EDGE_ZONE = 48;    /* 上下この幅に入ったら送る */
const EDGE_STEP = 12;    /* 1回に送る量 */
let edgeTimer = 0, edgeDir = 0;

function boxOf(id) {
  const r = anchorRef[id];
  return r && r.box ? r.box.getBoundingClientRect() : null;
}

/* ---------------- きっかけの日にち（利用者の指示） ----------------

   きっかけ本体（カード）に「いつの日のものか」を持たせる。
   数え方は「その月の n 回目のその曜日」＝ 第2火曜。最終は4回目とは別物
   （その曜日が5回ある月だけ違う日を指す）。判定は store が持つ。

   ■ 予定の日でないきっかけは隠す（利用者の判断）
   きっかけの画面が「今日の段取り」になる。ぜんぶ見るための切り替えを置く。
   **未分類はいつでも出す**——あそこは受け皿なので、隠すと落とし先が消える。

   ■ 過ぎた日のことは何も出さない
   「予定の日だったのに着手しなかった」は、どこにも出さない。数えない。
   遡って印も付けない。出せば未処理の山になる（§0）。 */

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const WEEK_NAMES = { 1: '第1', 2: '第2', 3: '第3', 4: '第4', 5: '最終' };

/* 予定外のきっかけを隠しているか。画面を開き直すと隠す側に戻る（既定＝今日の段取り） */
let showAllAnchors = false;
let allBtn = null;

/* いま画面に出すきっかけ。store 側の API が無い版では全部出す */
function visibleAnchors() {
  if (showAllAnchors || typeof store.dueAnchors !== 'function') return store.anchors();
  try { return store.dueAnchors(); } catch (e) { return store.anchors(); }
}

/* カードに出す札の文字。毎日なら空（札を出さない——
   「毎日」と書いた札が全部のカードに並ぶと、それ自体が濃さになる） */
function scheduleLabel(a) {
  const days = Array.isArray(a.days) ? a.days : [];
  const weeks = Array.isArray(a.weeks) ? a.weeks : [];
  if (!days.length) return '';
  const d = days.map(x => DAY_NAMES[x]).join('・');
  /* 曜日が1つなら詰めて「第2火曜」。2つ以上のときだけ空ける——
     「第2月・水曜」は "第2月" とも読めてしまうため */
  const sp = days.length > 1 ? ' ' : '';
  if (!weeks.length) return '毎週' + sp + d + '曜';
  return weeks.map(x => WEEK_NAMES[x] || '').join('・') + sp + d + '曜';
}

/* 日にちを決める盤。面の外（document.body）に置くので、
   store が動いて画面が組み直されても、この盤は消えない。

   押した内容はその場で書く（閉じるまで溜めない）。盤は覆いで塞がれていて
   後ろのカードは触れないので、途中の状態が中途半端に見える心配が無いため。 */
let schedPop = null;

function closeSchedule(restoreFocus) {
  if (!schedPop) return;
  const p = schedPop;
  schedPop = null;
  window.removeEventListener('keydown', p.onKey, true);
  p.back.remove();
  p.box.remove();
  if (restoreFocus && p.was && p.was.isConnected && typeof p.was.focus === 'function') {
    p.was.focus({ preventScroll: true });
  }
}

function openSchedule(a) {
  if (typeof store.setAnchorSchedule !== 'function') return;
  closeSchedule();
  const was = document.activeElement;

  const back = el('div', 'psch-back');
  const box = el('div', 'psch');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const ttl = el('p', 'psch-title');
  ttl.textContent = '「' + a.name + '」の日にち';   /* ユーザーの文字。innerHTML には入れない */
  box.setAttribute('aria-label', ttl.textContent);
  box.appendChild(ttl);

  /* いまの内容を1行で言う。押すたびにここが変わる＝結果が先に見える */
  const now = el('p', 'psch-now');
  box.appendChild(now);

  const cur = () => store.anchorSchedule(a.id);
  const weekBtns = [];
  const paint = () => {
    const c = cur();
    now.textContent = scheduleLabel({ days: c.days, weeks: c.weeks }) || '毎日';
    /* 曜日を選んでいないと、週は意味を持たない（第n週＝n回目のその曜日のため） */
    weekBtns.forEach(b => { b.disabled = !c.days.length; });
    render();                                     /* 後ろのカードの札も合わせる */
  };

  const group = (label, note) => {
    const g = el('div', 'psch-g');
    const lb = el('span', 'psch-lb');
    lb.textContent = label;
    g.appendChild(lb);
    if (note) { const nt = el('span', 'psch-note'); nt.textContent = note; g.appendChild(nt); }
    const row = el('div', 'psch-row');
    g.appendChild(row);
    box.appendChild(g);
    return row;
  };

  /* --- 曜日 --- */
  const dayRow = group('曜日', '選ばなければ毎日');
  (typeof store.dayValues === 'function' ? store.dayValues() : [0, 1, 2, 3, 4, 5, 6]).forEach(d => {
    const b = el('button', 'psch-chip');
    b.type = 'button';
    b.textContent = DAY_NAMES[d];
    const sync = () => b.setAttribute('aria-pressed', cur().days.indexOf(d) >= 0 ? 'true' : 'false');
    sync();
    b.addEventListener('click', ev => {
      ev.preventDefault();
      const c = cur();
      const on = c.days.indexOf(d) < 0;
      const days = on ? c.days.concat(d) : c.days.filter(x => x !== d);
      store.setAnchorSchedule(a.id, { days, weeks: c.weeks });
      sync();
      /* 曜日を全部外すと週も落ちるので、週の押し具合も引き直す */
      weekBtns.forEach(w => w.sync());
      paint();
    });
    dayRow.appendChild(b);
  });

  /* --- 週 --- */
  const weekRow = group('週', '第2火曜 ＝ その月の2回目の火曜日');
  (typeof store.weekValues === 'function' ? store.weekValues() : [1, 2, 3, 4, 5]).forEach(w => {
    const b = el('button', 'psch-chip');
    b.type = 'button';
    b.textContent = WEEK_NAMES[w] || String(w);
    b.sync = () => b.setAttribute('aria-pressed', cur().weeks.indexOf(w) >= 0 ? 'true' : 'false');
    b.sync();
    b.addEventListener('click', ev => {
      ev.preventDefault();
      const c = cur();
      const on = c.weeks.indexOf(w) < 0;
      const weeks = on ? c.weeks.concat(w) : c.weeks.filter(x => x !== w);
      store.setAnchorSchedule(a.id, { days: c.days, weeks });
      b.sync();
      paint();
    });
    weekBtns.push(b);
    weekRow.appendChild(b);
  });

  const done = el('button', 'psch-done');
  done.type = 'button';
  done.textContent = '閉じる';
  done.addEventListener('click', ev => { ev.preventDefault(); finish(); });
  box.appendChild(done);

  /* 閉じたときに、そのきっかけが今日の分でなくなっていたら黙って消さずに伝える。
     何も言わずに消えると「無くなった」に見える */
  function finish() {
    closeSchedule(true);
    if (showAllAnchors) return;
    if (typeof store.anchorDue !== 'function' || store.anchorDue(a.id)) return;
    const lb = scheduleLabel(store.anchor(a.id) || a) || '毎日';
    toast('「' + a.name + '」は ' + lb + '。今日は出ない', {
      label: 'ぜんぶ見る',
      on: () => setShowAll(true),
    });
  }

  const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
  back.addEventListener('pointerdown', eat);
  back.addEventListener('click', eat);
  back.addEventListener('pointerup', ev => { eat(ev); finish(); });

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault(); ev.stopPropagation();
    finish();
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  document.body.appendChild(box);
  schedPop = { back, box, onKey, was };
  paint();
  const first = box.querySelector('.psch-chip');
  if (first) first.focus({ preventScroll: true });
}

/* 「ぜんぶ見る」の切り替え。戻し方が画面に見えていること（海の「しぼる」と同じ言い方） */
function setShowAll(on) {
  const next = !!on;
  if (showAllAnchors === next) return;
  showAllAnchors = next;
  syncAllBtn();
  render();
}

function syncAllBtn() {
  if (!allBtn) return;
  /* 日にちを決めたきっかけが1つも無ければ、切り替える意味が無いので出さない */
  let any = false;
  try { any = store.anchors().some(a => (a.days || []).length); } catch (e) { any = false; }
  allBtn.hidden = !any;
  allBtn.textContent = showAllAnchors ? '今日のぶんだけ' : 'ぜんぶ見る';
  allBtn.setAttribute('aria-pressed', showAllAnchors ? 'true' : 'false');
  allBtn.setAttribute('aria-label', showAllAnchors
    ? '今日の日のきっかけだけを出す' : '日にちに関わらず、ぜんぶのきっかけを出す');
}

function makeGrip(a, index, total) {
  /* きっかけが1つしかないときは、動かしようがない。
     押せないボタンを置くより、印（丸）だけを出す——できない操作を見せない */
  if (total < 2) return el('span', 'dot');

  const g = el('button', 'ghandle');
  g.type = 'button';
  g.dataset.fk = 'grip:' + a.id;
  /* 色はアンカー個体の印。文字ではなく丸が持つ（色つきの文字は 4.5:1 を割るため） */
  g.appendChild(el('span', 'dot'));
  const gr = el('span', 'gr', '⠿');
  gr.setAttribute('aria-hidden', 'true');
  g.appendChild(gr);
  g.setAttribute('aria-label',
    a.name + ' を掴んで並べ替える（' + (index + 1) + ' / ' + total + '）。上下の矢印キーでも動かせる');

  g.addEventListener('pointerdown', ev => {
    ev.stopPropagation();          /* バブルのジェスチャ層へ渡さない */
    if (ev.button != null && ev.button !== 0) return;
    beginReorder(a, ev);
  });
  g.addEventListener('keydown', ev => {
    let d = 0;
    if (ev.key === 'ArrowUp') d = -1;
    else if (ev.key === 'ArrowDown') d = +1;
    else return;
    ev.preventDefault();
    wantFocus = 'grip:' + a.id;
    if (!store.moveAnchor(a.id, d)) wantFocus = null;   /* 端では動かない */
  });
  /* 取っ手を押しただけでは何もしない（押した瞬間に並びが動くと事故になる） */
  g.addEventListener('click', ev => ev.preventDefault());
  return g;
}

/* そのきっかけにぶら下がっているバブルのノード。
   entries は key（todo id ＋ どの枠か）で引くので、anchorId で絞る。 */
function bubblesOfAnchor(anchorId) {
  const out = [];
  if (!field || typeof field.nodeOf !== 'function') return out;
  entries.forEach((e, key) => {
    if (!e || e.anchorId !== anchorId) return;
    let node = null;
    try { node = field.nodeOf(key) || field.nodeOf(e.todo && e.todo.id); }
    catch (err) { node = null; }
    if (node) out.push(node);
  });
  return out;
}

function beginReorder(a, ev) {
  endReorder();
  const ids = store.anchors().map(x => x.id);
  const from = ids.indexOf(a.id);
  if (from < 0 || ids.length < 2) return;
  closeAnchorMenu();
  reorder = {
    id: a.id, from, ids,
    /* 掴んだカードにぶら下がっているバブルのノード。
       カードだけを動かすと、中のバブルが元の位置に取り残される（利用者の指摘）。
       ここで控えておいて、followFinger で一緒に動かす */
    bubs: bubblesOfAnchor(a.id),
    startY: ev.clientY, y: ev.clientY,
    /* 送っている間もカードが指の下に留まるよう、掴んだときのスクロール位置を覚える */
    startScroll: scrollEl ? scrollEl.scrollTop : 0,
    moved: false, target: from,
  };
  window.addEventListener('pointermove', onReorderMove, true);
  window.addEventListener('pointerup', onReorderUp, true);
  window.addEventListener('pointercancel', onReorderCancel, true);
  window.addEventListener('keydown', onReorderKey, true);
}

function onReorderMove(ev) {
  if (!reorder) return;
  reorder.y = ev.clientY;
  if (!reorder.moved) {
    if (Math.abs(ev.clientY - reorder.startY) < REORDER_SLOP) return;
    reorder.moved = true;
    surfaceEl.classList.add('is-reordering');
    const r = anchorRef[reorder.id];
    if (r && r.box) r.box.classList.add('is-lifted');
  }
  if (ev.cancelable) ev.preventDefault();
  reorder.target = targetIndexAt(ev.clientY);
  paintDropLine();
  followFinger();
  updateEdgeScroll();
}

/* 掴んだカードを指の下に留める。スクロールした分も足す（送っている間もずれない）。
   動きを減らす設定のときは追わせない——行き先は落とし先の線だけで伝える */
function followFinger() {
  if (!reorder || !reorder.moved || reduceMotion.matches) return;
  const r = anchorRef[reorder.id];
  if (!r || !r.box) return;
  const scrolled = (scrollEl ? scrollEl.scrollTop : 0) - reorder.startScroll;
  const dy = (reorder.y - reorder.startY) + scrolled;
  r.box.style.transform = 'translateY(' + dy + 'px)';
  /* バブルも一緒に動かす。**transform は使えない**——drift が毎コマ
     自分の位置を transform に書き込むので、上書き合戦になる。
     CSS の translate プロパティは transform とは別枠で、掛け合わされる
     （translate → rotate → scale → transform の順）。ここだけを借りる。 */
  reorder.bubs.forEach(n => { n.style.translate = '0px ' + dy + 'px'; });
}

/* 上端／下端まで運んだら、一覧を送る */
function updateEdgeScroll() {
  if (!reorder || !reorder.moved || !scrollEl) { stopEdgeScroll(); return; }
  const r = scrollEl.getBoundingClientRect();
  let dir = 0;
  if (reorder.y < r.top + EDGE_ZONE) dir = -1;
  else if (reorder.y > r.bottom - EDGE_ZONE) dir = 1;
  if (!dir) { stopEdgeScroll(); return; }
  if (edgeTimer && edgeDir === dir) return;
  stopEdgeScroll();
  edgeDir = dir;
  edgeTimer = setInterval(() => {
    if (!reorder) { stopEdgeScroll(); return; }
    const was = scrollEl.scrollTop;
    scrollEl.scrollTop = was + edgeDir * EDGE_STEP;
    if (scrollEl.scrollTop === was) { stopEdgeScroll(); return; }   /* 端まで来た */
    reorder.target = targetIndexAt(reorder.y);
    paintDropLine();
    followFinger();
  }, 16);
}

function stopEdgeScroll() {
  if (edgeTimer) clearInterval(edgeTimer);
  edgeTimer = 0; edgeDir = 0;
}

/* 指より上にあるカードの数。掴んでいるカードは数えない。
   これがそのまま「掴んでいるカードを抜いた並び」での行き先の番号になる */
function targetIndexAt(y) {
  let t = 0;
  reorder.ids.forEach(id => {
    if (id === reorder.id) return;
    const b = boxOf(id);
    if (b && y > b.top + b.height / 2) t++;
  });
  return t;
}

function paintDropLine() {
  const others = reorder.ids.filter(id => id !== reorder.id);
  if (!others.length) return;
  if (!dropLine) {
    dropLine = el('div', 'plan-dropline');
    dropLine.setAttribute('aria-hidden', 'true');
  }
  if (dropLine.parentNode !== surfaceEl) surfaceEl.appendChild(dropLine);
  const sr = surfaceEl.getBoundingClientRect();
  const t = Math.max(0, Math.min(others.length, reorder.target));
  const b = t <= 0 ? boxOf(others[0]) : boxOf(others[t - 1]);
  if (!b) return;
  const y = (t <= 0 ? b.top - 6 : b.bottom + 4) - sr.top;
  dropLine.style.transform = 'translateY(' + Math.round(y) + 'px)';
}

function onReorderUp() {
  const st = reorder;
  endReorder();
  if (!st || !st.moved) return;
  const delta = st.target - st.from;
  if (!delta) { render(); return; }     /* 位置が変わらないなら、見た目だけ戻す */
  wantFocus = 'grip:' + st.id;
  /* store が動けば emit → render が走る。走らなかったときのために念のため戻す */
  if (!store.moveAnchor(st.id, delta)) { wantFocus = null; render(); }
}

function onReorderCancel() { endReorder(); render(); }

function onReorderKey(ev) {
  if (ev.key !== 'Escape' || !reorder) return;
  ev.preventDefault();
  endReorder();
  render();
}

function endReorder() {
  stopEdgeScroll();
  window.removeEventListener('pointermove', onReorderMove, true);
  window.removeEventListener('pointerup', onReorderUp, true);
  window.removeEventListener('pointercancel', onReorderCancel, true);
  window.removeEventListener('keydown', onReorderKey, true);
  if (reorder) {
    const r = anchorRef[reorder.id];
    if (r && r.box) { r.box.classList.remove('is-lifted'); r.box.style.transform = ''; }
    /* 借りていた translate を返す。返さないと、次に drift が置いた位置から
       ずっとずれたままになる（transform とは別枠なので、drift 側では消えない） */
    (reorder.bubs || []).forEach(n => { if (n && n.style) n.style.translate = ''; });
  }
  if (surfaceEl) surfaceEl.classList.remove('is-reordering');
  if (dropLine && dropLine.parentNode) dropLine.remove();
  reorder = null;
}

/* ---------------- 面の寸法 ----------------

   ★2つの格子があり、間隔が違う。混ぜないこと。
     ・カードの幅 … バブルの直径の整数倍（cols * 96px）。利用者の指示。
     ・升目の格子 … 中心間 CELL_PITCH（112px）。井戸をここに置く。
       96px 刻みにすると隣どうしの中心が 96px しか離れず、収まったバブルが
       押し合って止まらない（ぶつかる間合いが 100px あるため）。

   カードの幅は変えずに、その中で升目の列数を減らす形で両立させている:
     288px（=3×96）の中に 112px の升目は 2 列。使う幅は 224px で、残り 64px は
     左右 32px ずつの余白になる（CSS 側の justify-content:center と揃えてある）。

   セルの横方向の padding は 0（padding を入れるとカード幅が直径の整数倍でなくなる）。
   枠線は border ではなく outline + outline-offset:-1px で描く——
   border は box-sizing:border-box のもとで中身の幅を 2px 削るため。 */
function layout() {
  if (!scrollEl || !surfaceEl) return false;
  const avail = scrollEl.clientWidth;
  if (!avail) return false;   /* mount の時点では 0（契約 §14）。onShow から呼び直す */
  const next = Math.max(1, Math.min(MAX_COLS, Math.floor(avail / BUB_SIZE)));
  const cardW = next * BUB_SIZE;
  /* 升目は必ず 1 列は取る。狭い画面ではカード幅より升目のほうが広くなるが、
     そのときも升目は1つだけなので、押し合う相手がいない */
  const nextSlots = Math.max(1, Math.floor(cardW / CELL_PITCH));
  const changed = next !== cols || nextSlots !== slotCols;
  cols = next;
  slotCols = nextSlots;
  surfaceEl.style.setProperty('--cols', String(cols));
  surfaceEl.style.setProperty('--bd', BUB_SIZE + 'px');
  surfaceEl.style.setProperty('--gcols', String(slotCols));
  surfaceEl.style.setProperty('--pitch', CELL_PITCH + 'px');
  surfaceEl.style.width = cardW + 'px';
  /* 列数が変われば行数も変わる。井戸を並べる範囲でもあるので取り直す */
  Object.keys(anchorRef).forEach(w => {
    const r = anchorRef[w];
    if (r.grid) r.grid.style.height = rowsFor(r.count) * CELL_PITCH + 'px';
  });
  if (field) {
    try { field.relayout(); }
    catch (err) { console.warn('[plan] relayout が失敗した', err); }
    applyWells();
  }
  return changed;
}

/* ---------------- 枠 ---------------- */

function commitRename(id, value) {
  const v = String(value == null ? '' : value).trim();
  renaming = null;
  wantFocus = 'amenu:' + id;
  if (v && v !== nameOf(id)) {
    if (!store.renameAnchor(id, v)) { toast('その名前にはできない'); }
  }
  render();
}

/* 枠の中身（バブルの並び）と、その下に開く詳細。
   詳細はバブルの真下には置けないので、枠のいちばん下にまとめる */
function fillFrame(box, items, where) {
  const anchorId = where === UNSORTED ? null : where;

  /* バブルの置き場。この中に升目（＝引力の井戸）が並ぶ。
     幅は必ず cols * BUB_SIZE（＝直径の整数倍）。横の余白はここには置かない——
     置くとカード幅が直径の整数倍でなくなる。
     升目の列は、この幅の中で中央に寄せる（CELL_PITCH ずつの格子） */
  const grid = el('div', 'grid');
  grid.style.height = rowsFor(items.length) * CELL_PITCH + 'px';

  if (fieldOn()) {
    /* 面に置く。DOM はここには入れない（drift が面の上に絶対配置する） */
    items.forEach((t, i) => fieldItems.push(fieldItemFor(t, where, i)));
  } else {
    items.forEach(t => grid.appendChild(makeItemBubble(t, where)));
  }
  box.appendChild(grid);

  const opened = items.filter(t => openKeys.has(keyOf(t.id, where)));
  if (!opened.length) return grid;
  const dwrap = el('div', 'dwrap');
  opened.forEach(t => {
    const key = keyOf(t.id, where);
    const d = detailFor(key, t, anchorId);
    d.sync();
    const bub = grid.querySelector('[data-key="' + cssEscape(key) + '"]');
    if (bub) bub.setAttribute('aria-controls', d.node.id);
    dwrap.appendChild(d.node);
  });
  box.appendChild(dwrap);
  return grid;
}

/* 何行いるか。空でも1行ぶんは開けておく——落とし先として見えている必要がある。
   割るのは cols（カード幅の倍数）ではなく slotCols（升目の列数） */
function rowsFor(n) {
  return Math.max(1, Math.ceil(n / Math.max(1, slotCols)));
}

/* querySelector に入れる前に、属性値の " と \ だけ逃がす。
   key は id とアンカー id からできているが、外から来た文字が混ざらないとは限らない */
function cssEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* 未分類 = この画面に来たが、まだどのきっかけにも入っていないもの（store.planUnsorted）。
   いちばん下に置く（追補5 §2）。面には重力があるので、どこにも掴まれていないものが
   下に溜まるのが自然に見える。ここは「まだ決めていない」を責めない場所なので、
   件数以外の数字（割合・残り）は出さない。 */
function makeUnsortedFrame() {
  const box = el('section', 'anchor is-unsorted');
  box.dataset.where = 'unsorted';
  box.setAttribute('aria-label', '未分類');

  const hd = el('div', 'hd');
  hd.appendChild(el('span', 'nm', '未分類'));
  const items = planUnsorted();
  const n = el('span', 'n');
  n.textContent = items.length ? items.length + '件' : '';
  hd.appendChild(n);
  box.appendChild(hd);

  const grid = fillFrame(box, items, UNSORTED);

  if (!items.length) {
    box.appendChild(el('p', 'empty',
      'きっかけを決めていないものが、ここに溜まる。'
      + '上の枠へドラッグすると、そのきっかけに繋がる。'));
  }

  anchorRef[UNSORTED] = { box, grid, count: items.length };
  return box;
}

function makeAnchorFrame(a, index, total) {
  const box = el('section', 'anchor');
  box.dataset.anchor = a.id;
  box.dataset.where = a.id;
  box.style.setProperty('--c', colorOf(a));
  if (a.hue == null) box.classList.add('no-hue');
  box.setAttribute('aria-label', a.name);

  /* 見出し。アンカーそのものは記録の対象ではないので、押せる面にはしない。
     ▶ も置かない（見出しは行動ではない） */
  const hd = el('div', 'hd');

  if (renaming === a.id) {
    const inp = el('input', 'nmin');
    inp.type = 'text';
    inp.value = a.name;                 /* value は属性ではないので HTML として解釈されない */
    inp.autocomplete = 'off';
    inp.dataset.fk = 'aname:' + a.id;
    inp.setAttribute('aria-label', 'きっかけの名前');
    inp.addEventListener('pointerdown', ev => ev.stopPropagation());
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commitRename(a.id, inp.value); }
      else if (ev.key === 'Escape') { ev.preventDefault(); renaming = null; wantFocus = 'amenu:' + a.id; render(); }
    });
    inp.addEventListener('blur', () => {
      if (inRender || renaming !== a.id) return;
      commitRename(a.id, inp.value);
    });
    hd.appendChild(inp);
  } else {
    hd.appendChild(makeGrip(a, index, total));
    hd.appendChild(el('span', 'nm', escapeHtml(a.name)));
  }

  /* 日にちの札。名前のすぐ後ろ。毎日なら出さない */
  const sl = scheduleLabel(a);
  if (sl) {
    const chip = el('span', 'asched');
    chip.textContent = sl;                       /* 組み立てた文字。innerHTML には入れない */
    hd.appendChild(chip);
  }

  const items = store.inAnchor(a.id);
  const n = el('span', 'n');
  const started = items.filter(t => isStarted(t.id, a.id)).length;
  n.textContent = items.length
    ? items.length + '件' + (started ? ' ・ はじめた ' + started : '')
    : '';
  hd.appendChild(n);

  const menuBtn = el('button', 'amenu');
  menuBtn.type = 'button';
  menuBtn.dataset.fk = 'amenu:' + a.id;
  menuBtn.appendChild(el('span', 'gl', '⋮'));
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', a.name + ' のメニュー');
  menuBtn.addEventListener('pointerdown', ev => ev.stopPropagation());
  menuBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    if (menuOwner === menuBtn) { closeAnchorMenu(); return; }
    openAnchorMenu(a, index, total, menuBtn, hd);
  });
  hd.appendChild(menuBtn);
  box.appendChild(hd);

  const grid = fillFrame(box, items, a.id);

  /* ＋ ここにぶら下げる。プールを経由せず、その場で書いて登録する */
  if (composerAnchor === a.id) {
    box.appendChild(composerBox);
  } else {
    const hang = el('button', 'phang');
    hang.type = 'button';
    hang.dataset.fk = 'hang:' + a.id;
    hang.appendChild(el('span', 'pl', '＋'));
    hang.appendChild(el('span', null, 'ここにぶら下げる'));
    hang.setAttribute('aria-label', '「' + a.name + '」の下に足す');
    hang.addEventListener('pointerdown', ev => ev.stopPropagation());
    hang.addEventListener('click', ev => {
      ev.stopPropagation();
      composerAnchor = a.id;
      wantFocus = 'compose';
      render();
    });
    box.appendChild(hang);
  }

  anchorRef[a.id] = { box, grid, count: items.length, index };
  return box;
}

/* ---------------- 入力（ぶら下げ／きっかけの追加） ---------------- */

/* 入力欄は再描画のたびに作り直すと、打ちかけが消えてカーソルも飛ぶ。
   だからノードは1つだけ作って、開いているアンカーの下へ付け替える。 */
function makeComposer() {
  const boxEl = el('div', 'pcompose');
  const inp = el('input', 'in');
  inp.type = 'text';
  inp.placeholder = 'ここにぶら下げる';
  inp.autocomplete = 'off';
  inp.dataset.fk = 'compose';
  inp.setAttribute('aria-label', 'ぶら下げるものを書く');
  inp.addEventListener('pointerdown', ev => ev.stopPropagation());
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      const back = composerAnchor;
      composerAnchor = null;
      wantFocus = back ? 'hang:' + back : null;
      render();
      return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const text = inp.value.trim();
    const target = composerAnchor;
    if (!text || !target) {
      composerAnchor = null;
      wantFocus = target ? 'hang:' + target : null;
      render();
      return;
    }
    /* 習慣の計画は「今日の選択」ではないので today は立てない。
       この画面で生まれたものなので plan は立てる（外したとき未分類に残る） */
    const t = store.add(text);
    if (t && t.id) {
      setPlan(t.id, true);
      store.setAnchor(t.id, target, true);
    }
    inp.value = '';
    wantFocus = 'compose';       /* 続けて書けるように開けたままにする */
    render();
  });
  boxEl.appendChild(inp);
  return boxEl;
}

function syncAddBox() {
  const open = addBox.classList.contains('is-open');
  addBtn.hidden = open;
  addInput.hidden = !open;
}

/* ---------------- フォーカスの持ち回り ---------------- */

/* 再描画でバブルやボタンは作り直される。キーボードで操作している人の居場所が
   毎回消えてしまわないよう、どこにいたかを覚えて戻す。 */
function snapshotFocus() {
  const a = document.activeElement;
  if (!a || !a.closest || !pane || !pane.contains(a)) return null;
  const s = { fk: (a.dataset && a.dataset.fk) || '', id: '' };
  const holder = a.closest('[data-id]');
  if (holder) s.id = holder.dataset.id || '';
  if (!s.fk && !s.id) return null;
  if (a.tagName === 'INPUT') { s.selStart = a.selectionStart; s.selEnd = a.selectionEnd; }
  return s;
}

function byFk(fk) {
  if (!fk) return null;
  return Array.from(pane.querySelectorAll('[data-fk]')).find(n => n.dataset.fk === fk) || null;
}

function place(node, s) {
  if (!node) return false;
  node.focus();
  if (s && s.selStart != null && node.setSelectionRange) {
    try { node.setSelectionRange(s.selStart, s.selEnd); } catch (e) { /* type によっては使えない */ }
  }
  return true;
}

function restoreFocus(s) {
  if (wantFocus) {
    const w = wantFocus; wantFocus = null;
    if (place(byFk(w), null)) return;
  }
  if (!s) return;
  if (place(byFk(s.fk), s)) return;
  /* 別の枠へ移ったなどでキーが変わったときは、同じ todo のバブルへ */
  if (!s.id) return;
  const bub = Array.from(pane.querySelectorAll('[data-key]')).find(n => n.dataset.id === s.id);
  if (bub && bub.tabIndex >= 0) bub.focus();
}

/* ---------------- 描画 ---------------- */

function render() {
  /* 描画中に store が動くことがある（閉じるときの保存など）。
     内側は捨ててよい。外側の描画がそのまま続きを引き受ける */
  if (inRender) return;
  inRender = true;
  try {
    closeAnchorMenu();
    const keep = snapshotFocus();
    renderedKeys = new Set();
    anchorRef = {};
    entries.clear();
    fieldItems = [];
    detachAll();

    const list = visibleAnchors();
    if (renaming && !store.anchor(renaming)) renaming = null;
    if (composerAnchor && !store.anchor(composerAnchor)) composerAnchor = null;

    /* ★消してよいのはセルだけ。面（surfaceEl）を replaceChildren すると、
       drift が面に置いたバブルのノードまで消える。drift は自分の側では
       「まだ在る」と思っているので、次の setItems でも作り直されず、
       バブルが1つも出なくなる（実際に踏んだ）。だから入れ物を分けてある */
    cellsEl.replaceChildren();
    list.forEach((a, i) => cellsEl.appendChild(makeAnchorFrame(a, i, list.length)));

    /* ヒントは「きっかけがまだ1つも無い」ときだけ。
       絞り込みで0件になっただけのときに出すと、作ったものが消えたように読める */
    const total = store.anchors().length;
    hintEl.hidden = total > 0;
    /* 今日の日のものが無いだけ、のときはそう言う。責めない書き方にする
       （「予定がありません」ではなく「今日の日のきっかけは無い」） */
    if (noneEl) {
      noneEl.hidden = !(total > 0 && list.length === 0 && !showAllAnchors);
      if (!noneEl.hidden) cellsEl.appendChild(noneEl);
    }
    syncAllBtn();
    cellsEl.appendChild(addBox);
    syncAddBox();

    /* 未分類はいちばん下（追補5 §2）。面には重力があるので、
       どこにも掴まれていないものが下に溜まって見えるのが自然。
       面のいちばん下＝未分類の底、になるよう、これより下には何も置かない */
    cellsEl.appendChild(makeUnsortedFrame());

    /* 画面から消えた詳細は、書きかけを保存してから捨てる */
    Array.from(details.keys()).forEach(k => {
      if (!renderedKeys.has(k)) closeDetail(k);
    });

    /* 先に寸法（＝井戸の矩形）を決めてから、面へ並びを渡す。
       順番が逆だと、drift は置き場所の分からないまま置くことになる */
    layout();
    pushItems();

    restoreFocus(keep);
  } finally {
    inRender = false;
  }
}

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'plan',
  label: 'きっかけ',
  icon: '◇',

  mount(node) {
    pane = node;
    tabbarEl = document.getElementById('tabbar');

    const wrap = el('div', 'plan');

    /* 枠の一覧。数はユーザー次第なので、ここが縦にスクロールする。
       スクロールするのは外側（.plan-scroll）で、中の「面」（.plan-surface）は
       スクロールしない1枚の座標系。セルもバブルも同じ面に乗るので、
       スクロールしても両者がずれない */
    scrollEl = el('div', 'plan-scroll');
    surfaceEl = el('div', 'plan-surface');
    /* セルはこの中に組む。面そのものは drift のバブルの置き場なので、
       描画のたびに空にしてはいけない（消すとバブルが消える） */
    cellsEl = el('div', 'plan-cells');
    surfaceEl.appendChild(cellsEl);
    scrollEl.appendChild(surfaceEl);
    /* 「ぜんぶ見る」。日にちを決めたきっかけが1つも無ければ出さない
       （切り替える意味が無いものを画面に置かない）。
       戻し方が見えていること＝押すと文字が「今日のぶんだけ」に変わる
       （海の「しぼる」⇄「もどす」と同じ言い方） */
    allBtn = el('button', 'plan-all');
    allBtn.type = 'button';
    allBtn.hidden = true;
    allBtn.addEventListener('click', ev => { ev.preventDefault(); setShowAll(!showAllAnchors); });
    wrap.appendChild(allBtn);

    wrap.appendChild(scrollEl);

    /* きっかけが1つも無いときだけ出す案内。
       最初はここが画面のほぼ全部になる。何もできていない、とは言わない。
       「まだ空です」ではなく、次の一手だけを書く。 */
    hintEl = el('p', 'plan-hint',
      'きっかけは、すでに毎日かならず起きている行動のこと。'
      + '<br>歯を磨いたら / 風呂から出たら / コーヒーを淹れたら——'
      + 'そのあとに繋ぐと、思い出さなくても始まる。'
      + '<br>まずは1つ、書いてみる。');
    hintEl.hidden = true;

    /* 今日の日のきっかけが無いときの1行。未達を名指ししない書き方（§0） */
    noneEl = el('p', 'plan-none',
      '今日の日のきっかけは無い。<br>「ぜんぶ見る」で、日にちに関わらず出せる。');
    noneEl.hidden = true;

    /* ＋ きっかけを足す */
    addBox = el('div', 'plan-addanchor');
    addBox.appendChild(hintEl);
    addBtn = el('button', 'addbtn');
    addBtn.type = 'button';
    addBtn.dataset.fk = 'addanchor';
    addBtn.appendChild(el('span', 'pl', '＋'));
    addBtn.appendChild(el('span', null, 'きっかけを足す'));
    addBtn.addEventListener('click', () => {
      addBox.classList.add('is-open');
      wantFocus = 'newanchor';
      addInput.value = '';
      render();
    });
    addBox.appendChild(addBtn);

    addInput = el('input', 'in');
    addInput.type = 'text';
    addInput.placeholder = '歯を磨いたら / 風呂から出たら …';
    addInput.autocomplete = 'off';
    addInput.dataset.fk = 'newanchor';
    addInput.hidden = true;
    addInput.setAttribute('aria-label', 'きっかけの名前');
    addInput.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        addBox.classList.remove('is-open');
        wantFocus = 'addanchor';
        render();
        return;
      }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const v = addInput.value.trim();
      if (!v) {
        addBox.classList.remove('is-open');
        wantFocus = 'addanchor';
        render();
        return;
      }
      const a = store.addAnchor(v);
      if (!a) { toast('きっかけはこれ以上ふやせない'); return; }
      addInput.value = '';
      /* 足したら、すぐその下に書けるところまで連れて行く */
      composerAnchor = a.id;
      addBox.classList.remove('is-open');
      wantFocus = 'compose';
      render();
    });
    addBox.appendChild(addInput);

    composerBox = makeComposer();

    pane.appendChild(wrap);

    /* メニューの外を押したら閉じる。閉じるのは DOM の付け外しだけなので、
       押した先のボタンが作り直されて click を取りこぼす、ということが起きない */
    document.addEventListener('pointerdown', ev => {
      if (!menuPop) return;
      if (ev.target && ev.target.closest && ev.target.closest('.amenu-pop, .amenu')) return;
      closeAnchorMenu();
    }, true);
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && menuPop) { closeAnchorMenu(); }
    });

    /* 幅が変われば列数が変わり、格子も井戸も変わる。
       mount の時点ではペインが display:none で幅 0 なので、ここでは寸法を決めない */
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(() => { layout(); });
      resizeObs.observe(scrollEl);
    } else {
      window.addEventListener('resize', () => { layout(); });
    }

    unsubscribe = store.on(render);
    render();
  },

  onShow() {
    store.rollover();   /* 日をまたいでいたら、今日する枠は残さない（きっかけの下は残る） */
    render();
    layout();           /* ここで初めてペインに幅が入る（契約 §14） */
    ensureField();
    if (field && typeof field.start === 'function') field.start();
  },

  onHide() {
    closeAnchorMenu();
    endReorder();
    if (field && typeof field.stop === 'function') field.stop();
    /* 書きかけを持ったまま画面を離れさせない */
    details.forEach(d => d.flush());
  },
};
