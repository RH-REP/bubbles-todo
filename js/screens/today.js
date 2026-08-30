/* 画面2「今日」— 今日やると決めたものが、一面に浮かぶだけの画面。

   決めごと（契約 §1 §3 §5）:
   - 枠で分割しない。朝／昼／夜は UI から撤去した。store の slot 系 API はここから呼ばない。
   - 漂う物理は海と同じ（drift.createField）。大きさは文字量で決まる。
   - 着手済みの見た目（文字を消して薄い円だけ）は bubble.js の仕事。
     ここは makeBubble/setItems に started を正しく渡すだけ。
   - 5時に rollover() が today を落として空になるが、そのことは画面に書かない。
     「昨日の◯件が消えました」は未達の名指しになるため（契約 §0）。 */

import { store } from '../store.js';
import { createField } from '../drift.js';
import { openMenu } from '../bubble.js';
import { el, toast } from '../ui.js';
import { playComplete } from '../sound.js';

/* 詳細の入力を書き終わりまで待たずに保存する間隔（plan.js と同じ） */
const SAVE_MS = 400;

/* --- ランダムスタートのシャッフル（追補5 §4） ---
   海（sea.js）と同じ作り・同じ時間。値も見せ方もそろえてある。
   ホップ = 光が次の玉へ移るまでの時間。だんだん遅くなる（＝止まりかけに見える）。
   合計 552ms + 最後の玉が大きくなる 200ms ≒ 0.63秒。始めたい人を待たせる長さにしない。
   ※ 海と2か所に同じものを書いている。共通の置き場を作るには js/ 直下に新しい
      ファイルが要るが、いまは担当の外なので写している。まとめるときは両方を直すこと。 */
const SHUF_HOPS = [56, 58, 62, 70, 82, 100, 124];
const SHUF_WIN = 200;   /* 選ばれた玉が大きくなるまで */
const SHUF_MAX = 10;    /* 盤に出す玉の数の上限。これ以上は重なって粒に見える */
const SHUF_D = 46;      /* 玉の直径 px。CSS の .today-shuffle .rnd-b と同じ値。片方だけ変えないこと */

/* ---- 契約に書かれていないことの申し送り ----------------------------------
   契約 §12 は「attachGestures を誰が呼ぶか」を書いていない。
   実装された drift.createField は、自分でノードを作って attachGestures まで張り、
   handlers は opts の直下（opts.onMenu など）から読む。だからこの画面は
   createField の opts に handlers を平らに渡すだけで、自分では張らない。
   両方が張ると長押しでメニューが2枚開くので、必ずどちらか一方だけにすること。 */

let pane = null;
let stage = null;         /* バブルが漂う面。field の host */
let emptyNote = null;     /* 何も無いときのことば */
let field = null;         /* drift.createField の戻り */
let unsubscribe = null;
let ro = null;
let shown = false;
let menuHandle = null;
let detail = null;        /* { node, flush, sync, id } 再描画をまたいで使い回す */
let randomBtn = null;     /* ランダムスタート（追補5 §4） */
let shuffle = null;       /* 混ぜている最中だけ { node, timer } が入る */

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

/* ---------------- 小物 ---------------- */

function trim(s, n = 18) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* 着手はこの画面ではアンカーに属さない。だからアンカーは常に null（契約 §11） */
function isStarted(id) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, null);
}
function markStarted(id) {
  if (typeof store.start !== 'function') return;
  if (isStarted(id)) return;
  store.start(id, null);
  const t = store.get(id);
  toast('「' + trim(t ? t.text : '') + '」を はじめた にした', {
    label: '取り消す',
    on: () => { if (typeof store.unstart === 'function') store.unstart(id, null); },
  });
}

function detailOf(fn, id) {
  return (typeof store[fn] === 'function' && store[fn](id)) || '';
}

/* 完了音。読み込みは静的（sea.js / plan.js / settings.js と同じ）。

   前は「sound.js が無い／壊れている間この画面ごと読めなくなる」を避けるため
   動的 import にしてあった。その守りはもう効いていない——
   sea.js・plan.js・settings.js が静的に読んでいるので、sound.js が壊れれば
   どのみちアプリは立ち上がらない。残っていたのは不揃いと、
   **最初の1回だけ音が遅れる**という副作用だけ（モジュールの解決を待つため。
   音は操作に添うものなので、ここが遅れるのはいちばん困る）。
   （オン/オフ判定と prefers-reduced-motion の尊重は sound.js 側の責任） */
function playCompleteSound() {
  try { playComplete(); } catch (err) { console.error(err); }
}

/* ---------------- store へ流す ---------------- */

/* field に渡す形（契約 §12）。marks は海の「ならべる」用なので、この画面では付けない */
function itemsForField() {
  return store.todays().map(t => ({
    id: t.id,
    text: t.text,
    started: isStarted(t.id),
    marks: [],
    colors: tagColors(t.id),
    tagNames: tagNames(t.id),
    anchorHue: null,
  }));
}

function render() {
  if (!field) return;
  const items = itemsForField();
  field.setItems(items);
  if (emptyNote) emptyNote.hidden = items.length > 0;
  syncRandomBtn();

  /* 外で状態が変わったら、開いている詳細を同期し直す（契約 §14） */
  if (detail) {
    if (!store.get(detail.id)) closeDetail();
    else detail.sync();
  }
}

/* ---------------- ランダムスタート（追補5 §4） ----------------
   選べないときに、選ばずに始めるためのもの。おすすめではない。
   だから重み付けはしない（古い順・放置順にすると「催促」になる／契約 §0）。
   この画面は面が1つしか無いので、候補は「いま浮かんでいるもの」＝ store.todays()。
   完了したものは store 側で既に外れている。

   見せ方は海と同じ：玉が輪になって churn し、光が次々に移り、最後の1つが大きくなる。
   玉は候補そのものではなく「候補が混ざっている」ことの絵にしている
   （漂うバブルそのものを混ぜるには drift のノードを毎フレーム奪うことになるため）。
   **選ぶのは混ぜる前。**Math.random() を1回引いて決め、そのあとで絵を作るので、
   無作為さは見せ方に一切左右されない。 */

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function pickList() {
  try { return store.todays() || []; } catch (e) { return []; }
}

/* 光が渡り歩く順。うしろから組み立てるので、最後は必ず勝ち玉、
   かつ隣り合う2つが同じ玉にならない（同じだと光が止まって見える）。 */
function hopOrder(n, winner) {
  const seq = new Array(SHUF_HOPS.length);
  seq[seq.length - 1] = winner;
  for (let i = seq.length - 2; i >= 0; i--) {
    let k = Math.floor(Math.random() * n);
    if (n > 1 && k === seq[i + 1]) k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n;
    seq[i] = k;
  }
  return seq;
}

/* 盤を組み立てる。戻り値の total は「絵が終わるまで」の ms */
function buildShuffle(n, winner) {
  const wrap = el('div', 'today-shuffle');
  wrap.setAttribute('role', 'status');
  wrap.appendChild(el('span', 'sr', '今日から1つ選んでいます'));

  const ring = el('div', 'rnd-ring');
  ring.setAttribute('aria-hidden', 'true');
  /* 玉が重ならない半径。直径の 1.15 倍を等間隔に置ける円周から逆算する。
     1.0 だと隣どうしが触れて、玉が9個10個のとき輪ではなく「1つの塊」に見える */
  const r = Math.max(52, Math.round(SHUF_D * 1.15 * n / (2 * Math.PI)));
  ring.style.setProperty('--r', r + 'px');
  ring.style.width = (r * 2 + SHUF_D + 8) + 'px';
  ring.style.height = ring.style.width;

  const seq = hopOrder(n, winner);
  const at = [];
  let t = 0;
  SHUF_HOPS.forEach(d => { at.push(t); t += d; });
  const end = at[at.length - 1];        /* 光が勝ち玉に着いた時刻 */
  const total = end + SHUF_WIN;
  ring.style.animationDuration = total + 'ms';

  for (let i = 0; i < n; i++) {
    const b = el('div', 'rnd-b');
    b.style.setProperty('--a', (360 * i / n) + 'deg');
    /* 玉ごとに息の位相をずらす。そろえると「輪が回っているだけ」に見えて混ざらない */
    b.style.animationDelay = (-i * 47) + 'ms';
    const face = el('i', 'rnd-face');
    /* 数字だけから組み立てる文字列。ユーザーの入力は混ぜない */
    const parts = [];
    seq.forEach((k, h) => {
      if (k !== i || h === seq.length - 1) return;
      parts.push('tdy-rnd-lit ' + SHUF_HOPS[h] + 'ms linear ' + at[h] + 'ms');
    });
    parts.push(i === winner
      ? 'tdy-rnd-win ' + SHUF_WIN + 'ms cubic-bezier(.2,.8,.3,1) ' + end + 'ms both'
      : 'tdy-rnd-dim ' + SHUF_WIN + 'ms ease-out ' + end + 'ms both');
    face.style.animation = parts.join(', ');
    b.appendChild(face);
    ring.appendChild(b);
  }
  wrap.appendChild(ring);
  return { node: wrap, total: total };
}

/* 途中でタブを離れた／もう一度押された、のときに絵ごと畳む。
   畳んだときは開かない（開くのは時間切れの1本道だけ） */
function cancelShuffle() {
  if (!shuffle) return;
  clearTimeout(shuffle.timer);
  if (shuffle.node) shuffle.node.remove();
  shuffle = null;
  syncRandomBtn();
}

function randomStart() {
  if (shuffle) return;                  /* 混ぜている最中は受け付けない */
  const list = pickList();
  if (!list.length) return;
  /* ここが唯一の抽選。重み付けはしない */
  const t = list[Math.floor(Math.random() * list.length)];
  if (!t) return;

  /* 混ぜないで開く場合：
     ・prefers-reduced-motion: reduce（追補5 §4）
     ・候補が1つしか無いとき——混ざりようがないのに混ぜて見せるのは嘘になる
     ・盤を置く先がまだ無いとき */
  if (reduceMotion() || list.length < 2 || !stage) { openFive(t.id); return; }

  const n = Math.min(list.length, SHUF_MAX);
  const winner = Math.floor(Math.random() * n);   /* 玉と項目は結び付いていない。位置も無作為 */
  const built = buildShuffle(n, winner);
  stage.appendChild(built.node);
  /* ペインが裏に回っていると setTimeout は1秒単位に間引かれる（契約 §14）。
     そのときは絵が少し長く出るだけで、開く経路は変わらない */
  const timer = setTimeout(() => {
    const cur = shuffle;
    shuffle = null;
    if (cur && cur.node) cur.node.remove();
    syncRandomBtn();
    openFive(t.id);                     /* 選んだあとの経路はいままでと同じ */
  }, built.total + 60);
  shuffle = { node: built.node, timer: timer };
  syncRandomBtn();
}

function syncRandomBtn() {
  if (!randomBtn) return;
  const n = pickList().length;
  randomBtn.disabled = n === 0 || !!shuffle;
  randomBtn.title = n ? '今日から1つ選んで、5分だけ集中' : 'ここにはまだ何も無い';
  randomBtn.setAttribute('aria-label', '今日から1つ選んで、5分だけ集中');
}

/* さいころの印。「無作為に1つ」を絵で言う。
   絵文字も外部画像も使わない（契約 §15）。色は currentColor に任せる。
   海の diceIcon() と同じ形にそろえてある（同じ操作は同じ印） */
const SVGNS = 'http://www.w3.org/2000/svg';

function diceIcon() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const box = document.createElementNS(SVGNS, 'rect');
  box.setAttribute('x', '4'); box.setAttribute('y', '4');
  box.setAttribute('width', '16'); box.setAttribute('height', '16');
  box.setAttribute('rx', '4.4');
  svg.appendChild(box);

  [[8.6, 8.6], [12, 12], [15.4, 15.4]].forEach(p => {
    const pip = document.createElementNS(SVGNS, 'circle');
    pip.setAttribute('cx', String(p[0]));
    pip.setAttribute('cy', String(p[1]));
    pip.setAttribute('r', '1.35');
    pip.setAttribute('fill', 'currentColor');
    pip.setAttribute('stroke', 'none');
    svg.appendChild(pip);
  });

  return svg;
}

/* ---------------- 5分だけ集中 ---------------- */

/* 押した時点では何も記録しない。5分にたどりついたときだけ「はじめた」を立てる。
   focus.js は動的に読み込む（todo.js と同じ理由：壊れていてもこの画面は開ける） */
function openFive(id) {
  const t = store.get(id);
  if (!t) return;
  import('../focus.js').then(m => {
    m.openFocus({
      id: id,
      title: t.text,
      firstStep: detailOf('firstStepOf', id),
      url: detailOf('urlOf', id),
      minutes: 5,
      onClose(info) {
        /* 集中画面の [完了]。completed:true のとき reachedGoal は false（両方立てない） */
        if (info && info.completed) { completeWithUndo(id); render(); return; }
        if (info && info.reachedGoal) {
          if (typeof store.start === 'function' && !isStarted(id)) store.start(id, null);
          render();   /* store が通知しなかったときのために引き直す */
        }
      },
    });
  }).catch(() => { toast('集中の画面をいま開けない。'); });
}

/* ---------------- 完了・消す ---------------- */

function completeWithUndo(id) {
  if (typeof store.complete !== 'function') return;
  /* complete() は項目を消さなくなり、戻り値も「項目そのもの」に変わった
     （前は remove() と同じ {item, index}）。名前は呼ぶ前に取っておくのが確実。 */
  const t = store.get(id);
  const name = trim(t ? t.text : '');
  const snap = store.complete(id);
  if (!snap) return;
  playCompleteSound();
  toast('「' + name + '」を完了にした', {
    label: '取り消す',
    on: () => {
      /* restore() は項目そのものも受けるよう広げられているが、
         完了を戻すのは uncomplete() が本来の口 */
      if (typeof store.uncomplete === 'function') store.uncomplete(id);
      else store.restore(snap);
    },
  });
}

function removeWithUndo(id) {
  const snap = store.remove(id);          /* 消すときは音を鳴らさない（契約 §6） */
  if (!snap) return;
  toast('「' + trim(snap.item ? snap.item.text : '') + '」を消した', {
    label: '元に戻す',
    on: () => store.restore(snap),
  });
}

/* ---------------- タブへのドロップ ---------------- */

/* 海へ = 全解除（契約 §2）。取り消せるように、外す前の所属を控えておく */
function dropToSea(id) {
  const t = store.get(id);
  if (!t) return;
  const before = {
    today: !!t.today,
    gap: typeof store.isGap === 'function' ? !!store.isGap(id) : false,
    anchors: (typeof store.anchorsOf === 'function' && store.anchorsOf(id)) || [],
  };

  store.setToday(id, false);
  if (typeof store.setGap === 'function') store.setGap(id, false);
  if (typeof store.clearAnchors === 'function') store.clearAnchors(id);

  toast('「' + trim(t.text) + '」を海へ戻した', {
    label: '元に戻す',
    on: () => {
      if (before.today) store.setToday(id, true);
      if (before.gap && typeof store.setGap === 'function') store.setGap(id, true);
      if (typeof store.setAnchor === 'function') {
        before.anchors.forEach(a => store.setAnchor(id, typeof a === 'string' ? a : a && a.id, true));
      }
    },
  });
}

function dropToGap(id) {
  const t = store.get(id);
  if (!t || typeof store.setGap !== 'function') return;
  const was = typeof store.isGap === 'function' ? !!store.isGap(id) : false;
  if (was) { toast('「' + trim(t.text) + '」はもう すきま時間 にある'); return; }
  store.setGap(id, true);                 /* 追加であって移動ではない。today は残る */
  toast('「' + trim(t.text) + '」を すきま時間 にも入れた', {
    label: '元に戻す',
    on: () => store.setGap(id, false),
  });
}

function onDropToTab(id, tabId) {
  if (tabId === 'sea') { dropToSea(id); return; }
  if (tabId === 'gap') { dropToGap(id); return; }
  if (tabId === 'plan') {
    /* どのアンカーに付けるかは契約 §11 に無い。勝手にアンカーを選ばない。
       app.js の applyDrop が使う store.setPlan（＝きっかけの未分類）が実在すればそれに乗る。
       無ければ、行き先が分かることだけ伝える。どちらも命令形にはしない。
       ※ app.js を import すると循環参照になるので、ここでは store だけを見ている。 */
    const t = store.get(id);
    if (typeof store.setPlan === 'function') {
      store.setPlan(id, true);
      toast('「' + trim(t ? t.text : '') + '」を きっかけの未分類 へ入れた', {
        label: '元に戻す',
        on: () => store.setPlan(id, false),
      });
    } else {
      toast('きっかけは「きっかけ」の画面で選べる');
    }
    return;
  }
  /* 'today' はこの画面そのもの。何もしない */
}

/* 中央の盤に出す操作。副作用を持たせない（返すだけ） */
function actionsFor(id) {
  return {
    isDone: typeof store.isDone === 'function' ? !!store.isDone(id) : false,
    onStarted: () => markStarted(id),
    onComplete: () => completeWithUndo(id),
    onDelete: () => removeWithUndo(id),
  };
}

/* ---------------- 長押しメニュー ---------------- */

function closeMenu() {
  if (!menuHandle) return;
  const h = menuHandle;
  menuHandle = null;
  if (typeof h === 'function') h();
  else if (h && typeof h.close === 'function') h.close();
}

function onMenu(id, node) {
  if (!store.get(id)) return;
  closeMenu();
  menuHandle = openMenu(node, {
    onDetail: () => openDetail(id),
    onFocus: () => openFive(id),
    onStarted: () => markStarted(id),
    onComplete: () => completeWithUndo(id),
    onDelete: () => removeWithUndo(id),
  });
}

/* ---------------- 詳細（最初の一手 / URL / 開始した） ---------------- */

/* ノードは1枚だけ作って使い回す。入力中の値を消さないため（契約 §14）。
   対象が変わるときは、書きかけを保存してから値を入れ替える。 */
function makeDetail() {
  const node = el('div', 'today-detail');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', '詳細');
  node.hidden = true;
  node.addEventListener('pointerdown', ev => ev.stopPropagation());

  const head = el('div', 'td-head');
  const title = el('p', 'td-title');
  head.appendChild(title);
  const close = el('button', 'td-close');
  close.type = 'button';
  close.textContent = '閉じる';
  close.addEventListener('click', () => closeDetail());
  head.appendChild(close);
  node.appendChild(head);

  /* --- 最初の一手 --- */
  const fs = el('label', 'td-field');
  fs.appendChild(el('span', 'td-lb', '最初の一手'));
  const fin = el('input', 'td-in');
  fin.type = 'text';
  fin.placeholder = 'まず何をする？';
  fin.autocomplete = 'off';
  fs.appendChild(fin);
  node.appendChild(fs);

  let ftimer = 0, pending = null;
  function saveFirst() {
    clearTimeout(ftimer); ftimer = 0;
    if (pending === null || !current()) return;
    const v = pending; pending = null;
    if (typeof store.setFirstStep === 'function') store.setFirstStep(current(), v);
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
  const ur = el('div', 'td-field');
  ur.appendChild(el('span', 'td-lb', 'URL'));
  const rw = el('div', 'td-row');
  const uin = el('input', 'td-in');
  uin.type = 'url';
  uin.placeholder = 'https://…';
  uin.autocomplete = 'off';
  rw.appendChild(uin);
  const open = el('a', 'td-open');
  open.textContent = '開く';
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.hidden = true;
  rw.appendChild(open);
  ur.appendChild(rw);
  const err = el('p', 'td-err');
  err.textContent = '開けないリンク';
  err.hidden = true;
  err.setAttribute('aria-live', 'polite');
  ur.appendChild(err);
  node.appendChild(ur);

  /* 「開く」は store が受け取った URL だけを出す。入力中の生の文字列は出さない */
  function syncLink() {
    const id = current();
    const u = id ? detailOf('urlOf', id) : '';
    const show = !!u && /^https?:\/\//i.test(u) && err.hidden;
    if (show) open.href = u; else open.removeAttribute('href');
    open.hidden = !show;
  }
  let utimer = 0;
  function saveUrl() {
    clearTimeout(utimer); utimer = 0;
    const id = current();
    if (!id || typeof store.setUrl !== 'function') return;
    const raw = uin.value.trim();
    if (!raw) { store.setUrl(id, ''); err.hidden = true; syncLink(); return; }
    const r = store.setUrl(id, raw);
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

  /* --- 開始した。5分を使わずに始めたときの別ルート。記録先は5分経過と同じ --- */
  const doneBtn = el('button', 'td-done');
  doneBtn.type = 'button';
  function syncDone() {
    const id = current();
    const on = !!id && isStarted(id);
    doneBtn.classList.toggle('on', on);
    doneBtn.textContent = on ? '開始した ✓' : '開始した';
    doneBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  doneBtn.addEventListener('click', () => {
    const id = current();
    if (!id) return;
    if (isStarted(id)) { if (typeof store.unstart === 'function') store.unstart(id, null); }
    else if (typeof store.start === 'function') store.start(id, null);
    syncDone();
    render();
  });
  node.appendChild(doneBtn);

  function current() { return detail ? detail.id : null; }

  function fill() {
    const id = current();
    const t = id ? store.get(id) : null;
    title.textContent = t ? t.text : '';        /* 生の文字列は textContent で入れる */
    pending = null;
    clearTimeout(ftimer); ftimer = 0;
    clearTimeout(utimer); utimer = 0;
    fin.value = id ? detailOf('firstStepOf', id) : '';
    uin.value = id ? detailOf('urlOf', id) : '';
    err.hidden = true;
    syncDone();
    syncLink();
  }

  function flush() { saveFirst(); if (utimer) saveUrl(); }

  function sync() {
    const id = current();
    const t = id ? store.get(id) : null;
    if (t) title.textContent = t.text;
    syncDone();
    syncLink();
  }

  return { node, fill, flush, sync, id: null };
}

function openDetail(id) {
  if (!store.get(id)) return;
  if (!detail) { detail = makeDetail(); pane.appendChild(detail.node); }
  else detail.flush();                    /* 別の項目に切り替える前に書きかけを保存 */
  detail.id = id;
  detail.fill();
  detail.node.hidden = false;
}

function closeDetail() {
  if (!detail) return;
  detail.flush();
  detail.id = null;
  detail.node.hidden = true;
}

/* ---------------- ジェスチャの配線（契約 §12） ---------------- */

const handlers = {
  onFocusRequest: id => openFive(id),
  onMenu: (id, node) => onMenu(id, node),
  /* 中央の盤に出す操作。これを渡すと bubble.js は onMenu を横取りしない */
  onActions: (id) => actionsFor(id),
  onDropToTab: (id, tabId) => onDropToTab(id, tabId),
  onDragStart: () => { closeMenu(); },
  onDragEnd: () => {},
  getHost: () => stage,
};

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'today',
  label: '今日',
  icon: '◎',

  mount(node) {
    pane = node;

    stage = el('div', 'today-stage');
    pane.appendChild(stage);

    /* 何も無いときのことば。
       未達を名指ししない・件数を出さない・命令形にしない（契約 §0）。
       5時に空になることも書かない。ここが何の面で、どうすれば浮かぶかだけ言う。 */
    emptyNote = el('p', 'today-empty');
    emptyNote.appendChild(el('span', 'l1', '今日ぶんの水面。'));
    emptyNote.appendChild(el('span', 'l2', '海のバブルをこのタブに落とすと、ここに浮かぶ。'));
    stage.appendChild(emptyNote);

    /* --- ランダムスタート（追補5 §4）---
       海と同じ形・同じ印・同じ言い方。海では「ならべる」の下に置いているが、
       この画面には他のボタンが無いので右上に置く（親指の届く角は同じ側）。 */
    randomBtn = el('button', 'today-random');
    randomBtn.type = 'button';
    randomBtn.appendChild(diceIcon());
    randomBtn.addEventListener('click', ev => {
      ev.preventDefault();
      randomStart();
    });
    stage.appendChild(randomBtn);

    /* drift は opts の直下から handlers を読む。将来 opts.handlers を見る作りに
       変わっても落ちないよう、まとめたものも一緒に渡しておく（余分なキーは無視される） */
    field = createField(stage, Object.assign({ size: 'text', handlers }, handlers));

    unsubscribe = store.on(render);

    /* ペインの寸法が変わったら並べ直す。mount 時点では 0 なので、
       ここでは寸法を使う計算をしない（契約 §14） */
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (!shown || !field) return;
        if (!stage.clientWidth || !stage.clientHeight) return;
        field.relayout();
      });
      ro.observe(stage);
    }

    render();
  },

  onShow() {
    shown = true;
    /* ここで初めてペインが display:flex になる。寸法が取れるのはこの時点から */
    if (field) { field.relayout(); field.start(); }
    render();
  },

  onHide() {
    shown = false;
    closeMenu();
    closeDetail();
    cancelShuffle();          /* 混ぜかけのまま裏に回ったら畳む。開かない */
    if (field) field.stop();
    if (typeof store.flush === 'function') store.flush();
  },

  /* テスト・後片付け用。app.js は今のところ呼ばない */
  destroy() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (ro) { ro.disconnect(); ro = null; }
    if (field) { field.destroy(); field = null; }
  },
};
