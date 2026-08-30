/* 画面1「Todo」
   ・気づいたら書く（下の入力セルと送信だけ）
   ・書かれた todo はバブルになって漂う
   ・「今日する」と決めたものを、タップかドラッグで枠に移す
   ・枠の中では漂うのをやめて整列する

   バブルの大きさは文字量だけで決まる（意味は持たせない）。 */

import { store } from '../store.js';
import { el, toast, clamp, escapeHtml } from '../ui.js';

const MIN_D = 78;            /* バブルの最小直径 px */
const MAX_D = 200;           /* 同 最大 */
const DRAG_PX = 6;           /* これ以上動いたらドラッグ扱い（未満はタップ） */
const LONGPRESS_MS = 600;    /* 長押しで小さなメニューを出す */
const FLICK_WINDOW = 90;     /* 手を離す直前の何ミリ秒ぶんの動きを「勢い」とみなすか */
const FLICK_MAX = 900;       /* 投げの初速の上限 px/秒。速すぎると画面を横切ってしまう */
const SPEED = 16;            /* 漂う速さ px/秒 のおおよそ */

/* 時間帯の目印。朝／昼／夜の固定3つ。表示名は1文字（行の中で幅を取らない）。
   これは今日限りの目印で、記録は付かない（データ層が日付で落とす）。 */
const SLOT_LABEL = { morning: '朝', noon: '昼', night: '夜' };
const SLOT_FALLBACK = ['morning', 'noon', 'night'];

let root, stage, hint, todayBox, todayList, todayCount, todayEmpty, todayInput, input, sendBtn, dragLayer;
let gapBox, gapList, gapCount, gapToggle;   /* すきま時間の登録枠。既定は畳んである */
let gatherBtn, gatherCap;
let gathering = false;   /* 「ならべる」を押している間だけ true */
let bubbles = new Map();     /* id -> {id, el, d, cx, cy, vx, vy, held} */
let raf = 0, lastT = 0, running = false;
let lastW = 0, lastH = 0;      /* 直前のステージ寸法。0 のときに作られたバブルを救うために持つ */
let unsubscribe = null;
let ro = null;
let shown = false;             /* このタブが表示中か（reduced motion 切り替えで使う） */
let booted = false;            /* 初回描画が済んだか。開いた瞬間の演出と、書いた直後の演出を分ける */
let knownTodayIds = new Set(); /* 「今日する」枠の既知の行。着地アニメを新入りだけに付ける */
let menu = null;               /* いま開いている小さなメニュー。同時にひとつだけ */

/* 「演出を減らす」設定。真なら漂わせず、飛沫・残像も出さない */
const RM = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener: null };

/* ---------------- 見た目の計算 ---------------- */

/* 文字数から直径を決める。面積が文字数に比例するよう sqrt を使う。 */
function diameterFor(text) {
  const len = Array.from(text).length;
  const raw = 46 + 26 * Math.sqrt(len);
  const w = stage.clientWidth || 320;
  const h = stage.clientHeight || 420;
  return clamp(raw, MIN_D, Math.min(MAX_D, w * 0.58, h * 0.7));
}

/* 直径は width/height と CSS 変数 --d の両方に入れる。
   --d は内側のテキスト枠の大きさを決めるために使う（% の padding は親幅基準になるので使えない）。 */
function setDiameter(node, d) {
  node.style.width = d + 'px';
  node.style.height = d + 'px';
  node.style.setProperty('--d', d + 'px');
}

function makeBubbleEl(todo, d) {
  const node = el('div', 'bub');
  node.dataset.id = todo.id;
  setDiameter(node, d);
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-haspopup', 'menu');
  applyGapMark(node, todo);

  /* wob＝呼吸のゆらぎ層、skin＝膜の見た目。位相と色味に個体差を付ける */
  const wob = el('span', 'wob');
  wob.style.setProperty('--ph', (Math.random() * 6).toFixed(2) + 's');
  const skin = el('span', 'skin');
  skin.style.setProperty('--hue', Math.round(Math.random() * 44 - 22) + 'deg');

  const tx = el('span', 'tx', escapeHtml(todo.text));
  if (Array.from(todo.text).length > 28) tx.style.fontSize = '12px';
  skin.appendChild(tx);
  wob.appendChild(skin);
  node.appendChild(wob);
  return node;
}

/* ---------------- バブルの同期 ---------------- */

function syncBubbles(newIds, initial) {
  const floating = store.floating();
  const want = new Set(floating.map(t => t.id));

  /* 消えたものを取り除く */
  bubbles.forEach((b, id) => {
    if (!want.has(id)) { b.el.remove(); bubbles.delete(id); }
  });

  const w = stage.clientWidth, h = stage.clientHeight;
  let bornIdx = 0;             /* 開いた瞬間の「順にぽこぽこ」用 */

  floating.forEach(t => {
    let b = bubbles.get(t.id);
    if (b) return;
    const d = diameterFor(t.text);
    const node = makeBubbleEl(t, d);
    const r = d / 2;
    b = {
      id: t.id, el: node, d,
      cx: clamp(t.fx * w, r, Math.max(r, w - r)),
      cy: clamp(t.fy * h, r, Math.max(r, h - r)),
      vx: (Math.random() * 2 - 1) * SPEED,
      vy: (Math.random() * 2 - 1) * SPEED,
      held: false,
      /* mount 時点ではペインがまだ display:none で寸法が 0 になる。
         そのとき置いた座標は当てにならないので、後で置き直す目印を残す */
      placed: !!(w && h),
    };
    if (newIds && newIds.has(t.id)) {
      node.classList.add('is-new');
      let delay = 0;
      if (initial) {
        /* 開いた瞬間は順番にぷるんと現れる */
        delay = Math.min(bornIdx * 55, 600); bornIdx++;
        node.querySelector('.skin').style.setProperty('--bd', delay + 'ms');
      } else if (!RM.matches) {
        /* 書いた直後は下からふわっと浮かび上がる（余分な速さは tick が減衰させる） */
        b.vy = -(SPEED * 2.2 + Math.random() * SPEED);
        b.vx = (Math.random() * 2 - 1) * SPEED * 0.5;
      }
      setTimeout(() => node.classList.remove('is-new'), 550 + delay);
    }
    attachPointer(b);
    node.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flyToToday(b); }
    });
    attachMenuTriggers(node, t.id);
    stage.appendChild(node);
    bubbles.set(t.id, b);
    place(b);
  });

  /* すきま時間の印は毎回付け直す（トグルで切り替わるため） */
  floating.forEach(t => {
    const b = bubbles.get(t.id);
    if (b) applyGapMark(b.el, t);
  });

  /* 海が空かどうかで判断する。todo の総数ではない
     （今日する・すきま時間へ移すと、総数はあっても海は空になる） */
  hint.hidden = floating.length > 0;
}

function place(b) {
  if (b.held) return;
  const t = `translate(${(b.cx - b.d / 2).toFixed(1)}px, ${(b.cy - b.d / 2).toFixed(1)}px)`;
  /* 集めているときは全体を縮めて画面に収める。scale は中心基準なので位置はずれない */
  b.el.style.transform = (b.gs && b.gs !== 1) ? `${t} scale(${b.gs.toFixed(3)})` : t;
}

/* 保存されている割合から実座標を引き直す。
   ステージが 0 幅のときに作られたバブルは (0,0) に潰れているので、
   寸法が取れるようになった時点でここから復帰させる。 */
function placeFromStore(b, w, h) {
  const t = store.get(b.id);
  if (!t) return;
  const r = b.d / 2;
  b.cx = clamp(t.fx * w, r, Math.max(r, w - r));
  b.cy = clamp(t.fy * h, r, Math.max(r, h - r));
  place(b);
}

/* 寸法が取れるようになった時点で、未配置のバブルを保存位置から置き直す。
   ResizeObserver の発火順に依存せず、onShow から必ず呼ぶ。 */
function relayout() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return false;
  let fixed = false;
  bubbles.forEach(b => {
    if (b.placed) return;
    const t = store.get(b.id);
    if (t) {
      b.d = diameterFor(t.text);
      setDiameter(b.el, b.d);
    }
    placeFromStore(b, w, h);
    b.placed = true;
    fixed = true;
  });
  lastW = w; lastH = h;
  return fixed;
}

/* 「ならべる」の配置を決める。古い順（放置しているものが先頭）に、
   左上から右下へ棚積みで並べる。バブルの大きさ（＝文字量）は保ったまま、
   全体を縮めて画面に収める。 */
function gatherLayout() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;

  const list = [...bubbles.values()]
    .filter(b => !b.held)
    .sort((a, b) => {
      const ta = store.get(a.id), tb = store.get(b.id);
      return ((ta && ta.createdAt) || 0) - ((tb && tb.createdAt) || 0);
    });
  if (!list.length) return;

  const GAP = 6, PAD = 14;
  const TOP = 44;   /* 上の見出しと「ならべる」ボタンのぶんを空ける */
  /* 先に面積からおおよその縮尺を見積もり、その分だけ横に広く積む。
     こうすると行が埋まり、結果の縮尺が大きく（＝文字が読みやすく）なる */
  const area = list.reduce((t, b) => t + b.d * b.d, 0);
  const k0 = Math.min(1, Math.sqrt(((w - PAD * 2) * (h - TOP - PAD) * 0.72) / Math.max(area, 1)));
  const rowW = (w - PAD * 2) / Math.max(k0, 0.18);

  /* まず行に振り分ける。行の高さが確定してから縦中央に置く
     （上端揃えだと大きさが違うぶん中心の高さがずれ、行として読めなくなる） */
  const rows = [];
  let row = [], x = 0, natW = 0;
  list.forEach(b => {
    if (row.length && x + b.d > rowW) { rows.push({ items: row, w: x - GAP }); row = []; x = 0; }
    row.push(b);
    x += b.d + GAP;
  });
  if (row.length) rows.push({ items: row, w: x - GAP });

  let y = 0;
  rows.forEach((r, ri) => {
    r.h = r.items.reduce((m, b) => Math.max(m, b.d), 0);
    natW = Math.max(natW, r.w);
    let rx = 0;
    r.items.forEach(b => {
      b.gnx = rx + b.d / 2;
      b.gny = y + r.h / 2;      /* 行の中で縦中央に揃える */
      b.grow = ri;              /* 検証用。何行目か */
      rx += b.d + GAP;
    });
    y += r.h + GAP;
  });
  const natH = y - GAP;

  const k = Math.min(1, (w - PAD * 2) / Math.max(natW, 1), (h - TOP - PAD) / Math.max(natH, 1));
  const ox = (w - natW * k) / 2;
  const oy = TOP + (h - TOP - PAD - natH * k) / 2;
  list.forEach(b => { b.gx = ox + b.gnx * k; b.gy = oy + b.gny * k; b.gk = k; });
}

function setGathering(on) {
  if (gathering === on) return;
  if (on) closeMenu();      /* 並べ替えの最中にメニューを残さない */
  gathering = on;
  gatherBtn.classList.toggle('is-on', on);
  gatherBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  gatherCap.classList.toggle('is-on', on);
  if (on) {
    gatherLayout();
    /* 演出を減らす設定では tick が回っていないので、その場で並べる */
    if (RM.matches) {
      bubbles.forEach(b => {
        if (b.held || b.gx == null) return;
        b.cx = b.gx; b.cy = b.gy; b.gs = b.gk; place(b);
      });
    }
  } else {
    bubbles.forEach(b => { b.gs = 1; b.gx = null; b.gy = null; place(b); });
    if (RM.matches) settle();          /* 重なったままにしない */
  }
}

/* ---------------- 物理 ---------------- */

function tick(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0);
  lastT = now;

  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) { raf = requestAnimationFrame(tick); return; }   /* 非表示中などは動かさない */
  const list = [...bubbles.values()];

  /* 押している間は漂わせず、並べた位置へなめらかに寄せる */
  if (gathering) {
    const e = Math.min(1, dt * 9);
    list.forEach(b => {
      if (b.held || b.gx == null) return;
      b.cx += (b.gx - b.cx) * e;
      b.cy += (b.gy - b.cy) * e;
      b.gs = (b.gs || 1) + (b.gk - (b.gs || 1)) * e;
      place(b);
    });
    raf = requestAnimationFrame(tick);
    return;
  }

  list.forEach(b => {
    if (b.held) return;
    /* 手を離した直後、縮尺が残っていれば 1 に戻す */
    if (b.gs && b.gs !== 1) {
      b.gs += (1 - b.gs) * Math.min(1, dt * 9);
      if (Math.abs(1 - b.gs) < 0.005) b.gs = 1;
    }
    b.cx += b.vx * dt;
    b.cy += b.vy * dt;

    /* たまに向きをわずかに変える。一定方向に流れ続けないように */
    if (Math.random() < dt * 0.35) {
      b.vx += (Math.random() * 2 - 1) * 4;
      b.vy += (Math.random() * 2 - 1) * 4;
    }

    /* 生まれた直後の浮上や、投げた勢い。速すぎるぶんを減衰させて漂う速さへ戻す。
       速いほど強く効かせて、シャボン玉らしく空気に受け止められる感じにする */
    const sp = Math.hypot(b.vx, b.vy);
    const vmax = SPEED * 1.8;
    if (sp > vmax) {
      const f = Math.max(vmax / sp, 1 - dt * (1.1 + sp / 420));
      b.vx *= f; b.vy *= f;
    }

    /* 壁で跳ね返る。投げられて速くなっているときだけ、ぶつかった分だけ勢いを失う */
    const bounce = sp > vmax ? 0.72 : 1;
    const r = b.d / 2;
    if (b.cx < r)     { b.cx = r;     b.vx = Math.abs(b.vx) * bounce;  b.vy *= bounce; }
    if (b.cx > w - r) { b.cx = w - r; b.vx = -Math.abs(b.vx) * bounce; b.vy *= bounce; }
    if (b.cy < r)     { b.cy = r;     b.vy = Math.abs(b.vy) * bounce;  b.vx *= bounce; }
    if (b.cy > h - r) { b.cy = h - r; b.vy = -Math.abs(b.vy) * bounce; b.vx *= bounce; }
  });

  /* 重なりをやわらかく押し離す。数が少ない前提の総当たり。
     つかんでいるバブル（held）は動かさず、相手だけ強めに押しのける
     （＝ドラッグで海をかき分けられる）。 */
  if (list.length > 1 && list.length <= 60) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        if (a.held && c.held) continue;
        const dx = c.cx - a.cx, dy = c.cy - a.cy;
        const min = (a.d + c.d) / 2 + 4;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist >= min) continue;
        const push = (min - dist) / dist * 0.16;
        if (a.held) {
          c.cx += dx * push * 2; c.cy += dy * push * 2;
        } else if (c.held) {
          a.cx -= dx * push * 2; a.cy -= dy * push * 2;
        } else {
          a.cx -= dx * push; a.cy -= dy * push;
          c.cx += dx * push; c.cy += dy * push;
        }
      }
    }
  }

  list.forEach(place);
  raf = requestAnimationFrame(tick);
}

/* ---------------- すきま時間の印 ---------------- */

/* store 側は setGap / isGap の2つだけ使う。
   データ層を入れ替えている最中でも画面が落ちないよう、関数が無ければ「印なし」として扱う。 */
function isGap(id) {
  return typeof store.isGap === 'function' && !!store.isGap(id);
}
function toggleGap(id) {
  if (typeof store.setGap === 'function') store.setGap(id);
}

/* 印は見た目を変えず、クラスと読み上げ文だけを付け替える（大きさは文字量だけで決まる） */
function applyGapMark(node, t) {
  const on = isGap(t.id);
  node.classList.toggle('is-gap', on);
  node.setAttribute('aria-label',
    t.text + (on ? '・すきま時間にできる' : '') + '（押すと今日する枠へ、長押しでメニュー）');
}

/* ---------------- 時間帯の目印と「はじめた」 ----------------
   すきま時間の印と同じ方針で、store 側の関数が無ければ「何も無い」として扱う。
   データ層を入れ替えている最中でも、画面1が落ちないようにするため。 */

function slotList() {
  return (Array.isArray(store.SLOTS) && store.SLOTS.length) ? store.SLOTS : SLOT_FALLBACK;
}
function slotsOf(id) {
  return (typeof store.slotsOf === 'function' && store.slotsOf(id)) || [];
}
/* 目印を付ける／外すだけ。押しても「はじめた」にはならない */
function toggleSlot(id, slot) {
  if (typeof store.setSlot === 'function') store.setSlot(id, slot);
}
/* 画面1の todo は画面2のアンカーに属さないので、アンカーは常に null */
function isStarted(id) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, null);
}
function markStarted(id) {
  if (typeof store.start === 'function') store.start(id, null);
}
function detailOf(fn, id) {
  return (typeof store[fn] === 'function' && store[fn](id)) || '';
}

/* 5分だけはじめる。
   押した時点では何も記録しない。5分にたどりついたときだけ「はじめた」を立てる。
   focus.js は動的に読み込む。静的 import にすると、focus.js が壊れている間
   画面1そのものが読めなくなるため。 */
function openFive(id, text) {
  import('../focus.js').then(m => {
    m.openFocus({
      title:     text,
      firstStep: detailOf('firstStepOf', id),   /* 空文字なら向こうで出さない */
      url:       detailOf('urlOf', id),         /* 同上 */
      minutes:   5,
      onClose(info) {
        if (info && info.reachedGoal) {
          markStarted(id);
          render();   /* store 側が通知しなかったときのために、行を引き直す */
        }
      },
    });
  }).catch(err => { console.error(err); });
}

/* 行の中のボタン（時間帯トグル・▶）の上か。
   ここでは行そのものの操作（海へ戻す・長押しメニュー）を起こさない */
function inRowControl(node) {
  return !!(node && node.closest && node.closest('.tslot, .tplay'));
}

/* 朝／昼／夜。複数選べる。押しても記録は付かない */
function makeSlotBar(t) {
  const on = slotsOf(t.id);
  const bar = el('span', 'tslots');
  slotList().forEach(s => {
    const name = SLOT_LABEL[s] || s;
    const btn = el('button', 'tslot');
    btn.type = 'button';
    btn.dataset.slot = s;
    btn.textContent = name;              /* 固定の文字。innerHTML は使わない */
    btn.setAttribute('aria-pressed', on.indexOf(s) >= 0 ? 'true' : 'false');
    btn.setAttribute('aria-label', name + 'の目印（' + trim(t.text) + '）');
    btn.title = name + 'の目印';
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleSlot(t.id, s);
    });
    bar.appendChild(btn);
  });
  return bar;
}

function makePlayBtn(t) {
  const btn = el('button', 'tplay');
  btn.type = 'button';
  btn.setAttribute('aria-label', '5分だけはじめる（' + trim(t.text) + '）');
  btn.title = '5分だけはじめる';
  const tri = el('span', 'tri', '▶');
  tri.setAttribute('aria-hidden', 'true');
  btn.appendChild(tri);
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    openFive(t.id, t.text);
  });
  return btn;
}

/* ---------------- 小さなメニュー（長押し） ---------------- */

/* バブルと「今日する」枠の行から開く。項目は2つだけ。
   ・すきま時間にできる … store.setGap のトグル
   ・消す              … これまでと同じ削除（海のバブルは、はじけてから消える） */
function openMenu(id, anchor) {
  /* ContextMenu キーと contextmenu イベントの両方が来ることがあるので、二重に開かない */
  if (menu && menu.id === id) return;
  closeMenu();
  const t = store.get(id);
  if (!t || !dragLayer) return;

  const node = el('div', 'bub-menu');
  node.setAttribute('role', 'menu');
  node.setAttribute('aria-label', trim(t.text) + ' の操作');

  const gapBtn = el('button', 'mi mi-gap');
  gapBtn.type = 'button';
  gapBtn.setAttribute('role', 'menuitemcheckbox');
  const on = isGap(id);
  gapBtn.setAttribute('aria-checked', on ? 'true' : 'false');
  gapBtn.classList.toggle('is-on', on);
  gapBtn.appendChild(el('span', 'mi-tx', 'すきま時間にできる'));
  const knob = el('span', 'mi-knob');
  knob.setAttribute('aria-hidden', 'true');
  gapBtn.appendChild(knob);
  /* 先に閉じてから切り替える。切り替えで描画が走り、行が作り直されるため */
  gapBtn.addEventListener('click', () => { closeMenu(true); toggleGap(id); });

  const delBtn = el('button', 'mi mi-del');
  delBtn.type = 'button';
  delBtn.setAttribute('role', 'menuitem');
  delBtn.appendChild(el('span', 'mi-tx', '消す'));
  delBtn.addEventListener('click', () => {
    closeMenu();
    const b = bubbles.get(id);
    if (b) popAndDelete(b);       /* 海のバブル：はじける演出つき */
    else removeWithUndo(id);      /* 枠の中の行：これまでどおり */
  });

  node.appendChild(gapBtn);

  /* 「今日する」の行から開いたときだけ、明示的な戻し口を足す。
     行の右端の「戻す」の文字を消した（トグルと ▶ が入って窮屈になった）ぶん、
     海に戻す手段を行のタップだけに細らせないため。
     海のバブルには要らない（そもそも海にいる）ので、bubbles に無い id のときだけ。 */
  if (!bubbles.has(id)) {
    const backBtn = el('button', 'mi mi-back');
    backBtn.type = 'button';
    backBtn.setAttribute('role', 'menuitem');
    backBtn.appendChild(el('span', 'mi-tx', '漂うほうへ戻す'));
    backBtn.addEventListener('click', () => {
      const rect = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
      closeMenu();
      backToSea(id, rect);
    });
    node.appendChild(backBtn);
  }

  node.appendChild(delBtn);

  /* メニュー内はキーボードで上下に動ける。閉じるのは Escape（下の onKey が拾う） */
  node.addEventListener('keydown', ev => {
    const items = [...node.querySelectorAll('.mi')];
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = (i + (ev.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length;
      items[next].focus();
    }
  });

  /* メニューの外を触ったら閉じる。バブルや枠の行の上なら、その操作は起こさせない
     （＝閉じるだけ。削除もトグルも「今日する」への移動も起きない）。
     入力欄などはそのまま触れるようにして、書くまでの手数を増やさない */
  const onOutside = ev => {
    if (node.contains(ev.target)) return;
    const t2 = ev.target;
    if (t2 && t2.closest && t2.closest('.bub, .today-list li')) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    closeMenu();
  };
  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMenu(true);
  };
  const onAway = () => closeMenu();

  window.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onAway);
  window.addEventListener('scroll', onAway, true);

  menu = { id, node, anchor, onOutside, onKey, onAway };
  dragLayer.appendChild(node);
  placeMenu(node, anchor.getBoundingClientRect());
  gapBtn.focus({ preventScroll: true });
}

/* バブルの近くに出す。画面からはみ出しそうなら、上に返してから端に寄せる */
function placeMenu(node, rect) {
  const M = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = node.offsetWidth, mh = node.offsetHeight;
  let y = rect.bottom + 6;
  if (y + mh > vh - M) y = rect.top - 6 - mh;
  node.style.left = clamp(rect.left + rect.width / 2 - mw / 2, M, Math.max(M, vw - mw - M)) + 'px';
  node.style.top = clamp(y, M, Math.max(M, vh - mh - M)) + 'px';
}

function closeMenu(restoreFocus) {
  if (!menu) return;
  const m = menu;
  menu = null;
  window.removeEventListener('pointerdown', m.onOutside, true);
  window.removeEventListener('keydown', m.onKey, true);
  window.removeEventListener('resize', m.onAway);
  window.removeEventListener('scroll', m.onAway, true);
  m.node.remove();
  if (restoreFocus && m.anchor && m.anchor.isConnected) m.anchor.focus({ preventScroll: true });
}

/* 右クリックと、キーボードの「メニュー」キー／Shift+F10 でも開く。
   Enter / Space はこれまでどおり（バブル＝今日するへ、枠の行＝海へ戻す）。 */
function attachMenuTriggers(node, id) {
  node.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    openMenu(id, node);
  });
  node.addEventListener('keydown', ev => {
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10') || ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault();
      openMenu(id, node);
    }
  });
}

function removeWithUndo(id) {
  const snap = store.remove(id);
  if (snap) toast('「' + trim(snap.item.text) + '」を消した', {
    label: '元に戻す', on: () => store.restore(snap),
  });
}

/* ---------------- 操作 ---------------- */

function isOverGap(x, y) {
  if (!gapBox) return false;
  const r = gapBox.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function isOverToday(x, y) {
  const r = todayBox.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function attachPointer(b) {
  b.el.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();

    const startX = ev.clientX, startY = ev.clientY;
    const rect = b.el.getBoundingClientRect();
    const grabDX = startX - rect.left, grabDY = startY - rect.top;
    let moved = false, dragging = false, done = false;
    let stageRect = null;
    /* 手を離したときに勢いを載せるため、直近の指の軌跡を覚えておく */
    let track = [{ x: startX, y: startY, t: ev.timeStamp || performance.now() }];

    b.el.classList.add('is-held');   /* 押している間、膜がたわむ */

    /* 長押しで小さなメニュー。動かしたら（＝ドラッグに変わったら）取り消される */
    const lp = setTimeout(() => {
      if (moved || done) return;
      done = true; cleanup();
      openMenu(b.id, b.el);
    }, LONGPRESS_MS);

    function beginDrag() {
      dragging = true; b.held = true;
      stageRect = stage.getBoundingClientRect();
      b.el.classList.remove('is-held');
      b.el.classList.add('is-dragging');
      dragLayer.appendChild(b.el);
      b.el.style.left = rect.left + 'px';
      b.el.style.top = rect.top + 'px';
      b.el.style.transform = 'translate(0px, 0px)';
    }

    function onMove(e) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const now = e.timeStamp || performance.now();
      track.push({ x: e.clientX, y: e.clientY, t: now });
      while (track.length > 2 && now - track[0].t > FLICK_WINDOW) track.shift();
      if (!moved && Math.hypot(dx, dy) > DRAG_PX) { moved = true; clearTimeout(lp); beginDrag(); }
      if (!dragging) return;
      b.el.style.transform = `translate(${dx}px, ${dy}px)`;
      /* 物理には「いまの中心」を伝えておく。漂う仲間をかき分けるため */
      b.cx = rect.left + dx + b.d / 2 - stageRect.left;
      b.cy = rect.top + dy + b.d / 2 - stageRect.top;
      todayBox.classList.toggle('is-over', isOverToday(e.clientX, e.clientY));
      if (gapBox) gapBox.classList.toggle('is-over', isOverGap(e.clientX, e.clientY));
    }

    function onUp(e) {
      if (done) return;
      done = true; cleanup();
      todayBox.classList.remove('is-over');
      if (gapBox) gapBox.classList.remove('is-over');

      if (!moved) { flyToToday(b); return; }                      /* タップ */
      /* すきま枠に落とした：今日するには入れず、海からも消して「すきま時間に」へ移す。
         必要になったらユーザーがまた書けばいいので、海に残しておかない */
      if (isOverGap(e.clientX, e.clientY)) {
        if (typeof store.setGap === 'function') store.setGap(b.id, true);
        return;   /* 描画の同期でバブルの要素は取り除かれる */
      }
      if (isOverToday(e.clientX, e.clientY)) { flyToToday(b); return; }

      /* 直前 FLICK_WINDOW ミリ秒の平均速度を、そのまま初速にする（＝投げた勢いが乗る） */
      const now = e.timeStamp || performance.now();
      const head = { x: e.clientX, y: e.clientY, t: now };
      const tail = track[0];
      const ms = head.t - tail.t;
      let vx = 0, vy = 0;
      if (ms > 8) {
        vx = (head.x - tail.x) / ms * 1000;
        vy = (head.y - tail.y) / ms * 1000;
        const sp = Math.hypot(vx, vy);
        if (sp > FLICK_MAX) { vx *= FLICK_MAX / sp; vy *= FLICK_MAX / sp; }
      }
      returnToStage(b, e.clientX - grabDX, e.clientY - grabDY, vx, vy);
    }

    function cleanup() {
      clearTimeout(lp);
      b.el.classList.remove('is-held');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function returnToStage(b, clientLeft, clientTop, vx, vy) {
  const sr = stage.getBoundingClientRect();
  const r = b.d / 2;
  b.cx = clamp(clientLeft - sr.left + r, r, Math.max(r, stage.clientWidth - r));
  b.cy = clamp(clientTop - sr.top + r, r, Math.max(r, stage.clientHeight - r));
  /* 投げた勢いを載せる。速すぎるぶんは tick 側で空気抵抗のように減衰する。
     RM（演出を減らす設定）のときは勢いを付けない */
  if (!RM.matches && Number.isFinite(vx) && Number.isFinite(vy)) { b.vx = vx; b.vy = vy; }
  b.el.classList.remove('is-dragging');
  b.el.style.left = ''; b.el.style.top = '';
  stage.appendChild(b.el);
  b.held = false;
  place(b);
  savePos(b);
}

function popAndDelete(b) {
  b.held = true;
  popBits(b.el.getBoundingClientRect());
  b.el.classList.add('is-popping');
  const id = b.id;
  setTimeout(() => removeWithUndo(id), 200);
}

/* ---------------- 演出（データ更新は一切待たせない） ---------------- */

/* はじけたときの飛沫とリング。drag-layer に置いてすぐ消す */
function popBits(rect) {
  if (RM.matches) return;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const ring = el('div', 'pop-ring');
  ring.style.left = rect.left + 'px';
  ring.style.top = rect.top + 'px';
  ring.style.width = rect.width + 'px';
  ring.style.height = rect.height + 'px';
  dragLayer.appendChild(ring);
  setTimeout(() => ring.remove(), 440);
  for (let i = 0; i < 7; i++) {
    const bit = el('span', 'pop-bit');
    const ang = (i / 7) * Math.PI * 2 + Math.random() * 0.6;
    const dist = rect.width * 0.4 + 16 + Math.random() * 26;
    bit.style.setProperty('--x0', (cx - 3) + 'px');
    bit.style.setProperty('--y0', (cy - 3) + 'px');
    bit.style.setProperty('--x1', (cx - 3 + Math.cos(ang) * dist) + 'px');
    bit.style.setProperty('--y1', (cy - 3 + Math.sin(ang) * dist) + 'px');
    dragLayer.appendChild(bit);
    setTimeout(() => bit.remove(), 520);
  }
}

/* バブルが「今日する」枠へ吸い込まれる。残像だけ飛ばし、データは即時に更新する */
function flyToToday(b) {
  if (!RM.matches) {
    const from = b.el.getBoundingClientRect();
    const to = todayBox.getBoundingClientRect();
    spawnFly(from, to.left + 30, to.bottom - 30);
  }
  catchPulse();
  store.setToday(b.id, true);
}

/* 枠がひとつ波紋を出す */
function catchPulse() {
  todayBox.classList.remove('is-catch');
  void todayBox.offsetWidth;   /* アニメーションを鳴らし直すための reflow */
  todayBox.classList.add('is-catch');
  setTimeout(() => todayBox.classList.remove('is-catch'), 560);
}

/* 小さなバブルの残像を from から (tx,ty) へ飛ばす */
function spawnFly(from, tx, ty) {
  const g = el('div', 'fly');
  const d = Math.min(from.width, 76);
  g.style.width = d + 'px';
  g.style.height = d + 'px';
  g.style.transform =
    `translate(${from.left + (from.width - d) / 2}px, ${from.top + (from.height - d) / 2}px)`;
  dragLayer.appendChild(g);
  g.getBoundingClientRect();   /* 開始位置を確定させてから動かす */
  g.style.transform = `translate(${tx - d / 2}px, ${ty - d / 2}px) scale(.18)`;
  g.style.opacity = '0';
  setTimeout(() => g.remove(), 480);
}

/* reduced motion のとき用：漂わせず、重なりだけほどいて静止させる */
function settle() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const list = [...bubbles.values()].filter(b => !b.held);
  for (let k = 0; k < 24; k++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        const dx = c.cx - a.cx, dy = c.cy - a.cy;
        const min = (a.d + c.d) / 2 + 4;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist >= min) continue;
        const push = (min - dist) / dist * 0.25;
        a.cx -= dx * push; a.cy -= dy * push;
        c.cx += dx * push; c.cy += dy * push;
      }
    }
  }
  list.forEach(b => {
    const r = b.d / 2;
    b.cx = clamp(b.cx, r, Math.max(r, w - r));
    b.cy = clamp(b.cy, r, Math.max(r, h - r));
    place(b);
  });
}

function trim(s) {
  const a = Array.from(s);
  return a.length > 14 ? a.slice(0, 14).join('') + '…' : s;
}

function savePos(b) {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h || !b.placed) return;   /* 寸法が取れないときに 0 を書き込まない */
  store.setPos(b.id, b.cx / w, b.cy / h);
}

function saveAllPos() {
  bubbles.forEach(savePos);
  store.flush();
}

/* ---------------- すきま時間の枠 ---------------- */

function renderGap() {
  if (!gapBox) return;
  const list = (typeof store.gapItems === 'function') ? store.gapItems() : [];
  gapCount.textContent = list.length ? list.length + '件' : '';
  gapBox.classList.toggle('is-empty', list.length === 0);
  gapList.replaceChildren();

  if (!list.length) {
    const li = el('li', 'gapbox-empty', 'バブルをここへドラッグすると、移動中にできることとして覚えておける。');
    gapList.appendChild(li);
    return;
  }

  list.forEach(t => {
    const li = el('li');
    li.dataset.id = t.id;
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', t.text + '（押すと、すきま時間から外す）');
    li.appendChild(el('span', 'mk'));
    li.appendChild(el('span', 'tx', escapeHtml(t.text)));
    li.appendChild(el('span', 'hint', '外す'));
    const off = () => { if (typeof store.setGap === 'function') store.setGap(t.id, false); };
    li.addEventListener('click', off);
    li.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); off(); }
    });
    gapList.appendChild(li);
  });
}

/* ---------------- 今日する枠 ---------------- */

function renderToday() {
  const list = store.todays();
  todayCount.textContent = list.length ? list.length + '件' : '';
  todayEmpty.hidden = list.length > 0;
  todayList.replaceChildren();

  list.forEach(t => {
    const li = el('li');
    li.dataset.id = t.id;
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-haspopup', 'menu');
    const gap = isGap(t.id);
    const started = isStarted(t.id);
    const slots = slotsOf(t.id).map(s => SLOT_LABEL[s]).filter(Boolean).join('・');
    li.classList.toggle('is-gap', gap);
    li.classList.toggle('is-started', started);
    li.setAttribute('aria-label',
      t.text
      + (slots ? '・' + slots : '')
      + (gap ? '・すきま時間にできる' : '')
      + (started ? '・はじめた' : '')
      + '（押すと戻す、長押しでメニュー）');
    /* 右端の「戻す」の文字は消した（トグルと ▶ が入るため）。
       押せば戻ることは、行そのものの見た目と読み上げ文で伝える */
    li.title = '押すと漂うほうへ戻す';
    if (!knownTodayIds.has(t.id)) li.classList.add('is-new');   /* 新入りだけ着地アニメ */
    li.appendChild(el('span', 'mk'));
    li.appendChild(el('span', 'tx', escapeHtml(t.text)));
    if (gap) {
      /* 海のバブルと同じ、すきま時間の印（同じ todo なので同じ見え方にする） */
      const gm = el('span', 'gapmk');
      gm.setAttribute('aria-hidden', 'true');
      li.appendChild(gm);
    }
    li.appendChild(makeSlotBar(t));      /* 朝／昼／夜 */
    li.appendChild(makePlayBtn(t));      /* 5分だけはじめる */
    attachChipPointer(li, t.id);
    li.addEventListener('keydown', ev => {
      /* 行の中のボタンで押した Enter / Space は、そのボタンのもの。行は戻さない */
      if (ev.target !== li) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault(); backToSea(t.id, li.getBoundingClientRect());
      }
    });
    attachMenuTriggers(li, t.id);
    todayList.appendChild(li);
  });

  knownTodayIds = new Set(list.map(t => t.id));
}

function attachChipPointer(li, id) {
  li.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    /* トグルと ▶ の上。行の操作（海へ戻す・長押しメニュー）は起こさない */
    if (inRowControl(ev.target)) return;
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false, done = false;

    /* バブルと同じく、長押しは小さなメニュー */
    const lp = setTimeout(() => {
      if (moved || done) return;
      done = true; cleanup();
      openMenu(id, li);
    }, LONGPRESS_MS);

    function onMove(e) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > DRAG_PX) { moved = true; clearTimeout(lp); }
    }
    function onUp() {
      if (done) return;
      done = true; cleanup();
      if (!moved) backToSea(id, li.getBoundingClientRect());
    }
    function cleanup() {
      clearTimeout(lp);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/* 枠から出したものは、枠のすぐ上から浮かび上がるように置く。
   fromRect があれば、行から海へ飛んでいく残像を出す */
function backToSea(id, fromRect) {
  const fx = 0.25 + Math.random() * 0.5;
  const fy = 0.82 + Math.random() * 0.12;
  if (fromRect && !RM.matches) {
    const sr = stage.getBoundingClientRect();
    spawnFly(fromRect, sr.left + fx * sr.width, sr.top + fy * sr.height);
  }
  store.setPos(id, fx, fy);
  store.setToday(id, false);
}

/* ---------------- 描画 ---------------- */

let knownIds = new Set();   /* 直前まで海に漂っていた id。枠から戻ったものも「新入り」として扱う */

function render() {
  /* 開いていたメニューの相手が消えた／行が作り直されるなら、メニューも閉じる */
  if (menu && (!store.get(menu.id) || !menu.anchor.isConnected)) closeMenu();
  const ids = new Set(store.floating().map(t => t.id));
  const fresh = new Set([...ids].filter(id => !knownIds.has(id)));
  knownIds = ids;
  const initial = !booted;
  booted = true;
  syncBubbles(fresh, initial);
  renderToday();
  renderGap();
  if (RM.matches && shown) settle();   /* 漂わないぶん、重なりだけはほどいておく */
}

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'todo',
  label: 'Todo',
  icon: '○',

  mount(pane) {
    root = pane;
    dragLayer = document.getElementById('drag-layer');

    stage = el('div', 'stage');
    stage.id = 'stage';
    gatherBtn = el('button', 'gather');
    gatherBtn.type = 'button';
    gatherBtn.innerHTML = '<span class="ic" aria-hidden="true">⇅</span>ならべる';
    gatherBtn.setAttribute('aria-pressed', 'false');
    gatherBtn.title = '押している間だけ、古い順に並びます';
    gatherCap = el('p', 'gather-cap', '古い順 — 放置しているものが先頭');

    hint = el('p', 'stage-hint',
      '気づいたことを、下に書く。<br>書いたものはここを漂う。<br><br>' +
      'タップかドラッグで「今日する」へ。<br>長押しでメニュー。');
    stage.appendChild(hint);
    stage.appendChild(gatherCap);
    stage.appendChild(gatherBtn);

    /* 押している間だけ集める。指でもキーボードでも同じ挙動にする */
    const hold = ev => { ev.preventDefault(); setGathering(true); };
    const release = () => setGathering(false);
    gatherBtn.addEventListener('pointerdown', hold);
    gatherBtn.addEventListener('pointerup', release);
    gatherBtn.addEventListener('pointercancel', release);
    gatherBtn.addEventListener('pointerleave', release);
    gatherBtn.addEventListener('keydown', ev => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); setGathering(true); }
    });
    gatherBtn.addEventListener('keyup', ev => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); setGathering(false); }
    });
    gatherBtn.addEventListener('blur', release);

    todayBox = el('section', 'today');
    const head = el('div', 'today-head');
    head.appendChild(el('span', null, '今日する'));
    todayCount = el('span', 'count');
    head.appendChild(todayCount);
    todayBox.appendChild(head);
    todayEmpty = el('p', 'today-empty', 'バブルを落とすか、下に直接書く。');
    todayBox.appendChild(todayEmpty);
    todayList = el('ul', 'today-list');
    todayBox.appendChild(todayList);

    /* 枠の中に直接書く行。漂わせずに、そのまま「今日する」へ入る */
    const addRow = el('form', 'today-add');
    const plus = el('span', 'plus', '＋');
    plus.setAttribute('aria-hidden', 'true');
    todayInput = el('input');
    todayInput.type = 'text';
    todayInput.placeholder = '今日やることを直接書く';
    todayInput.autocomplete = 'off';
    todayInput.setAttribute('aria-label', '今日やることを直接書く');
    addRow.appendChild(plus);
    addRow.appendChild(todayInput);
    addRow.addEventListener('submit', ev => {
      ev.preventDefault();
      const text = todayInput.value.trim();
      if (!text) return;
      store.add(text, { today: true });
      todayInput.value = '';
      todayInput.focus();
      todayList.scrollTop = todayList.scrollHeight;
    });
    todayBox.appendChild(addRow);

    /* すきま時間の登録枠。既定は畳んである（リストは出さない）。
       畳んでいてもドロップ先としては生きているので、ドラッグで入れられる */
    gapBox = el('section', 'gapbox');
    gapToggle = el('button', 'gapbox-head');
    gapToggle.type = 'button';
    gapToggle.appendChild(el('span', 'lb', 'すきま時間に'));
    gapCount = el('span', 'n');
    gapToggle.appendChild(gapCount);
    gapToggle.appendChild(el('span', 'cv', '⌄'));
    gapToggle.setAttribute('aria-expanded', 'false');
    gapToggle.addEventListener('click', () => {
      const open = gapBox.classList.toggle('is-open');
      gapToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    gapBox.appendChild(gapToggle);
    gapList = el('ul', 'gapbox-list');
    gapBox.appendChild(gapList);
    pane.appendChild(gapBox);

    const form = el('form', 'composer');
    input = el('input');
    input.type = 'text';
    input.placeholder = '思いついたことを書く';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'todo を書く');
    sendBtn = el('button', null, '送信');
    sendBtn.type = 'submit';
    sendBtn.disabled = true;
    form.appendChild(input);
    form.appendChild(sendBtn);

    input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      /* 入力欄のあたりから生まれて浮かび上がる見え方にする */
      store.add(text, { fx: 0.35 + Math.random() * 0.3, fy: 0.86 + Math.random() * 0.1 });
      input.value = '';
      sendBtn.disabled = true;
      input.focus();
    });

    pane.appendChild(stage);
    pane.appendChild(todayBox);
    pane.appendChild(gapBox);
    pane.appendChild(form);

    unsubscribe = store.on(render);

    /* 画面サイズが変わったら、はみ出したバブルを引き戻す */
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;             /* 非表示。寸法は覚えない */

        relayout();                        /* 未配置のものがあれば先に救う */

        if (lastW && lastH && (w !== lastW || h !== lastH)) {
          /* 相対位置を保ったまま伸縮させる（回転・分割表示でも散らばらない） */
          const sx = w / lastW, sy = h / lastH;
          bubbles.forEach(b => {
            const r = b.d / 2;
            b.cx = clamp(b.cx * sx, r, Math.max(r, w - r));
            b.cy = clamp(b.cy * sy, r, Math.max(r, h - r));
            place(b);
          });
        }
        lastW = w; lastH = h;
      });
      ro.observe(stage);
    }

    window.addEventListener('pagehide', saveAllPos);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveAllPos();
    });

    /* 「演出を減らす」設定がその場で切り替わったら、漂いを止める／再開する */
    if (typeof RM.addEventListener === 'function') {
      RM.addEventListener('change', () => {
        if (!shown) return;
        if (RM.matches) {
          running = false; cancelAnimationFrame(raf);
          settle();
        } else if (!running) {
          running = true; lastT = performance.now();
          raf = requestAnimationFrame(tick);
        }
      });
    }

    render();
  },

  onShow() {
    /* ここで初めてペインが display:flex になる。寸法が取れるのはこの時点から */
    shown = true;
    relayout();
    if (RM.matches) { settle(); return; }   /* 演出を減らす：漂わせない */
    if (running) return;
    running = true; lastT = performance.now();
    raf = requestAnimationFrame(tick);
  },

  onHide() {
    closeMenu();
    setGathering(false);
    shown = false;
    running = false;
    cancelAnimationFrame(raf);
    saveAllPos();
  },
};
