/* バブル部品 — 4つの画面が共通で使う。

   ここに入っているもの：
     ・大きさの決め方（文字量 / 一定サイズ）
     ・バブルの DOM（膜・文字・タグの色・着手済みの見た目）
     ・ジェスチャ（タップ→中央／タブへのドラッグ。長押しではメニューを開かない）
     ・中央に寄せたときに出る盤
       （タスク開始／次の一手／リンク／履歴／今日は終わり・完了・消す）
     ・鍵盤から開くメニュー（openMenu。ContextMenu / Shift+F10 / m）

   物理（漂う・投げる・跳ね返る）は js/drift.js。
   このファイルは「指の動きを読む」ところまでを持ち、投げの初速だけ drift へ渡す。

   store は一切触らない。次の一手・リンクの読み書きは setCenterHandler() で
   外から差してもらう（focus.js の setWorklogHandler() と同じやり方）。

   中身のほとんどは js/screens/todo.js から持ち上げたもの。新しく発明していない。 */

import { el, clamp } from './ui.js';

export const MIN_D = 78;      /* バブルの最小直径 px（文字量で決まるとき） */
export const MAX_D = 200;     /* 同 最大 */
export const FIXED_D = 96;    /* 枠の中の一定サイズ */

const DRAG_PX = 6;            /* これ以上動いたらドラッグ扱い（未満はタップ） */
const FLICK_WINDOW = 90;      /* 手を離す直前の何ミリ秒ぶんの動きを「勢い」とみなすか */
const FLICK_MAX = 900;        /* 投げの初速の上限 px/秒 */

export const CENTER_MS = 260;  /* 中央へ寄るのにかかる時間 */

/* 中央から戻すのに「時間」は使わない。
   1秒の窓（旧 FOCUS_WINDOW_MS）は廃止した。戻るのは、無関係なところを触ったとき
   （面の背景・ほかのバブル・Escape）だけ。中央の盤を触っている間は戻らない。 */

/* 次の一手・リンクの自動保存の間合い。打つたびには書かない。
   focus.js / plan.js の SAVE_MS と同じ値にしてある。 */
const SAVE_MS = 400;

/* 着手（store.start）の印を、画面で何と呼ぶか（利用者の指示）。
   「はじめた」「開始した」と別々に呼んでいたが、同じ印を指している。
   実際にしていることは「今日ぶんはここまで」——押すとバブルが薄くなり、
   5時に戻る（契約 §5）。だから名前もそう呼ぶ。
   **記録している中身は変えていない。**ふりかえりの内訳は「はじめた」のまま
   （あちらは操作の名前ではなく、記録の名前。README の憲章がその言葉を使っている）。 */
const DONE_LB = '今日は終わり';

const CENTER_GAP = 12;   /* バブルと盤のすきま px */
const CENTER_M = 8;      /* 画面の縁との余白 px */
/* 中央へ寄せたバブルを置く高さ（利用者の指示）。
   **真ん中ではなく上部。**盤の行が増えて（作業メモ・長期保留の日）、
   真ん中に置くと盤が下タブに突き当たり、押し上げられてバブルに重なっていた。

   前は [まずは開始] のぶん（44+12）を上に空けていたが、そのボタンは
   盤の中へ移った（利用者の指示）。空ける理由が無くなったので 0 にする
   ——そのぶん盤に使える高さが 56px 増える。 */
const CENTER_TOP_BAND = 0;

/* --- タップで開いたときの click を1つだけ捨てる（利用者の報告）---

   「時々バブルのタップで完了になる」の正体。

   タップは pointerup で中央を開く。**盤はその場で作られるので、
   ブラウザが pointerup のあとに出す click は、盤が並んだあとの座標で当たりを取る**。
   離した点にちょうど [タスク完了] が来ていれば、その click がボタンに入る。
   実測：(90,500) で離すと、pointerdown の時点では .skin、20ms 後には .bc-act-done。

   バブルを上部へ移してから（利用者の指示）盤が 180〜719px を占めるようになり、
   当たる面積がそれまでの倍以上になっている。**起きやすさを上げたのはこちらの変更。**

   捨てるのは「開いたタップが生む1つ」だけに絞る：
     ・時間 … 開いてから CLICK_EAT_MS 以内（compat click は数ms で来る）
     ・場所 … 離した点から CLICK_EAT_R px 以内
   どちらかを外れたら、それは人が狙って押した click なので通す。
   キーボード（Enter / Space）で開いたときは click が生まれないので、そもそも張らない。 */
const CLICK_EAT_MS = 400;   /* 看板の押し分け（signSuppress）と同じ間合いにそろえた */
const CLICK_EAT_R = 12;     /* 離した点からの許容。指のぶれ（AXIS_LOCK 10）より少し広い */

/* その日付キーの曜日（0=日）。カレンダーの列をそろえるのに使う */
function todayDow(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getDay();
}

/* 長い文を札に出すときの丸め。文字数は書記素ではなくコード点で数える
   （絵文字を割らないための Array.from。既存の trim と同じやり方） */
function trimTx(t, n) {
  const a = Array.from(String(t == null ? '' : t));
  return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
}

function eatOpeningClick(pt) {
  if (!pt || !(pt.x >= 0)) return;
  const t0 = Date.now();
  const off = () => window.removeEventListener('click', eat, true);
  function eat(ev) {
    if (Date.now() - t0 > CLICK_EAT_MS) { off(); return; }
    if (Math.abs(ev.clientX - pt.x) > CLICK_EAT_R) return;
    if (Math.abs(ev.clientY - pt.y) > CLICK_EAT_R) return;
    ev.preventDefault();
    ev.stopPropagation();
    off();
  }
  window.addEventListener('click', eat, true);
  setTimeout(off, CLICK_EAT_MS);
}

/* タブへ落とせるのはこの4つだけ。ふりかえり・設定は不可 */
export const DROPPABLE = ['sea', 'today', 'plan', 'gap'];

/* タグは「点」ではなく、バブルそのものの色で表す（追補4 §1）。
   opts.marks / opts.anchorHue は受け取っても点は描かない。呼び出し側が
   まだ渡してくることがあるので、読み上げ文の材料としてだけ残してある。 */
const MARK_LABEL = { today: '今日', anchor: 'きっかけ', gap: 'すきま' };

/* 膜に載せる色は最大3つ。4つ以上付いていても見分けが付かない。 */
const TINT_MAX = 3;

/* 「演出を減らす」設定 */
export const RM = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener: null };

/* ---------------- 中央の盤の預け先 ----------------

   bubble.js は store を知らない。次の一手（firstStep）とリンク（url）の
   読み書きは、app.js が起動時に1回だけ差す。
   focus.js の setWorklogHandler() と同じ形にしてある。

   a = {
     firstStep(id),          // 文字列。無ければ '' を返すこと
     setFirstStep(id, text),
     url(id),                // 文字列
     setUrl(id, text),       // http / https 以外は store 側が弾く前提
     steps(id),              // 任意。[{ at, did, next }] を古い順で。無ければ []
   }
   差されていなければ、次の一手・リンクの欄は出さない（[タスク開始] だけ出す）。
   行き先の無い入力欄を出さないため。
   steps が無ければ「履歴」のボタンを出さない（＝押しても何も無いボタンを作らない）。 */
let centerAdapter = null;
export function setCenterHandler(a) {
  centerAdapter = (a && typeof a === 'object') ? a : null;
}

/* 預け先が壊れていても中央は閉じない（focus.js の ask() と同じ） */
function ask(a, name, ...args) {
  try {
    if (a && typeof a[name] === 'function') return a[name](...args);
  } catch (_) { /* 握りつぶす */ }
  return undefined;
}

/* 保存してよい URL か。§15「URL は http / https だけ」 */
function isSafeUrl(raw) {
  return /^https?:\/\//i.test(String(raw || '').trim());
}

/* 記録の日時。「◯日連続」「◯件目」のような数え方はしない（§0）。
   出すのは、その一手を打ったときの日付と時刻だけ。
   月日の書き方は ふりかえり（review.js）に合わせてある。 */
function fmtAt(at) {
  const n = Number(at);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (isNaN(d.getTime())) return '';
  const p2 = v => (v < 10 ? '0' : '') + v;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 '
    + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/* ---------------- 大きさ ---------------- */

/* 文字数から直径を決める。面積が文字数に比例するよう sqrt を使う。
   w / h はバブルが置かれる面の寸法。0 のときは既定値で代用する
   （mount 直後はペインが display:none で寸法が取れないため）。 */
export function diameterFor(text, w, h) {
  const len = Array.from(text || '').length;
  const raw = 46 + 26 * Math.sqrt(len);
  const W = w || 320;
  const H = h || 420;
  return clamp(raw, MIN_D, Math.min(MAX_D, W * 0.58, H * 0.7));
}

/* 直径は width/height と CSS 変数 --d の両方に入れる。
   --d は内側のテキスト枠の大きさを決めるために使う
   （% の padding は親の幅に対して解決されてしまうので使えない）。 */
export function setDiameter(node, d) {
  /* サブピクセルの端数は落とす。width と --d がずれると内側のテキスト枠もずれる */
  const px = (Math.round(d * 10) / 10) + 'px';
  node.style.width = px;
  node.style.height = px;
  node.style.setProperty('--d', px);
}

/* ---------------- DOM ---------------- */

/* started は store 上では {[anchorKey]: 時刻} の形。空のオブジェクトは「まだ」なので
   真偽値としてそのまま見ない。真偽値・数値で渡されたときも通す。 */
function startedFlag(v) {
  if (!v) return false;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/* ---------------- タグの色 ----------------

   #rgb / #rrggbb だけを受ける。読めない値は捨てる（＝タグ無し扱い＝いまの青）。
   CSS 変数へ入れる値なので、ここを通っていないものを流し込まない
   （var() の中身はそのままスタイルとして解釈されるため）。 */
function normHex(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (m) return '#' + m[1].toLowerCase().replace(/./g, ch => ch + ch);
  m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m) return '#' + m[1].toLowerCase();
  return null;
}

/* 使う色を最大3つまで。同じ色は1つに畳む
   （畳まないと「2色ある」ことになり、同じ色から同じ色へ巡る空の移り変わりが走る） */
function tintColors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    const c = normHex(v);
    if (c && out.indexOf(c) < 0) out.push(c);
    if (out.length >= TINT_MAX) break;
  }
  return out;
}

/* タグの名前。色と対で渡してもらう（WCAG 1.4.1「色だけを手がかりにしない」）。
   バブルに文字を足すと本文が読めなくなるので、名前は読み上げ文と中央の盤に載せる。
   ・文字列だけを通す。前後の空白は落とし、同じ名前は畳む
   ・上限 TAG_NAME_MAX。色は3つまでしか載らないが、名前はそれより多く持てる
     （少ないほうへ合わせると、目で見えない人だけが情報を失う） */
const TAG_NAME_MAX = 6;

function tagNames(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || out.indexOf(s) >= 0) continue;
    out.push(s);
    if (out.length >= TAG_NAME_MAX) break;
  }
  return out;
}

/* 名前が渡されていればそれを読む。渡されていない画面では、
   旧 marks（today / anchor / gap）のラベルで代用する（配線が済むまでの後ろ盾）。 */
function ariaFor(item, names, marks, started) {
  const tags = names.length ? names : marks.map(m => MARK_LABEL[m]).filter(Boolean);
  return String(item.text || '')
    + (tags.length ? '・' + tags.join('・') : '')
    + (started ? '・' + DONE_LB : '')
    + '（タップで真ん中へ）';
}

/* 中央の盤にタグ名を出すために、ノードごとに名前と色を控えておく。
   dataset に入れると利用者の文字列が属性へ出ていくので、WeakMap に持つ
   （ノードが捨てられれば一緒に消える）。 */
const tagMeta = new WeakMap();
function tagInfoOf(node) {
  return (node && tagMeta.get(node)) || { names: [], colors: [] };
}

/* バブルの DOM を作る。
     item = { id, text, started, colors? }
     opts = {
       size: number|'text',      // 'text' なら文字量で決まる
       colors: string[],         // 付いているタグの色。空ならタグ無し＝いまの青
       tagNames: string[],       // 同じ並びのタグ名。色だけを手がかりにしないため
       startedLook: 'dim'|'mark',// 着手済みの見せ方。既定 'dim'（薄くする）
       w, h,                     // size:'text' のときの寸法の手がかり（任意）
       marks, anchorHue,         // 旧。点はもう描かない。名前が無いときの後ろ盾
     }
   colors / tagNames は opts に無ければ item を見る
   （js/drift.js は item だけを持ち回す経路が残っているため。両方あるほうが安全）。
   返り値 = HTMLElement（class="bub"、--d に直径が入っている） */
export function makeBubble(item, opts = {}) {
  const node = el('div', 'bub');
  node.dataset.id = item.id;
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-haspopup', 'menu');

  /* wob＝呼吸のゆらぎ層、skin＝膜の見た目。位相と色味に個体差を付ける */
  const wob = el('span', 'wob');
  wob.style.setProperty('--ph', (Math.random() * 6).toFixed(2) + 's');
  const skin = el('span', 'skin');
  skin.style.setProperty('--hue', Math.round(Math.random() * 44 - 22) + 'deg');

  /* tint＝タグの色の膜。文字のすぐ下（＝いちばん上）に1枚だけ置く。
     下に敷くと、膜より上に残る白い照りで暗テーマの文字が沈む。 */
  const tint = el('span', 'tint');
  tint.setAttribute('aria-hidden', 'true');
  /* 膜の動き（境目の向きと割合）を個体ごとに散らす種。
     0〜1 の無次元の数で、1周の長さと開始位置は CSS 側が calc で作る。
     **作るときに1回だけ**振る（updateBubble では振り直さない——
     同期のたびに変わると、色を付け替えただけで動きが飛ぶ）。 */
  tint.style.setProperty('--ts1', Math.random().toFixed(3));
  tint.style.setProperty('--ts2', Math.random().toFixed(3));
  const tx = el('span', 'tx');

  skin.appendChild(tint);
  skin.appendChild(tx);
  wob.appendChild(skin);
  node.appendChild(wob);

  updateBubble(node, item, opts);
  return node;
}

/* 作り直さずに中身だけ合わせる。再描画のたびに DOM を捨てないため */
export function updateBubble(node, item, opts = {}) {
  if (!node) return node;
  const tx = node.querySelector('.tx');
  const size = (opts.size == null) ? 'text' : opts.size;
  const fixed = (size !== 'text');

  const d = fixed
    ? (Number(size) || FIXED_D)
    : diameterFor(item.text, opts.w, opts.h);
  setDiameter(node, d);
  node.classList.toggle('is-fixed', fixed);

  if (tx) {
    tx.textContent = String(item.text || '');   /* innerHTML には入れない */
    /* 文字量で決まるときだけ、長文を一段小さくする（枠の中は CSS が 12px に固定する） */
    tx.style.fontSize = (!fixed && Array.from(item.text || '').length > 28) ? '12px' : '';
  }

  /* ---- タグの色（追補4 §1）----
     点はもう描かない。付いているタグの色で、バブルそのものを染める。
     色は最大3つ。**2つ以上あるときは、1つのバブルを色の数で分ける**
     （2色なら半分ずつ、3色なら3等分。境目は硬いので混ざらない。
      塗り分けは CSS の .is-multi-2 / .is-multi-3）。
     前は時間で入れ替えていたが、止まっている間は1タグと見分けが付かなかった。
     opts.colors が無ければ item.colors を見る（drift.js は item だけを持ち回すため）。 */
  const colors = tintColors(
    Array.isArray(opts.colors) ? opts.colors : (item && item.colors));
  node.classList.toggle('is-tinted', colors.length > 0);
  /* 色の数で塗り分けが違う（2等分 / 3等分）ので、付け分ける */
  node.classList.toggle('is-multi-2', colors.length === 2);
  node.classList.toggle('is-multi-3', colors.length >= 3);
  if (colors.length) {
    /* 1色なら3つとも同じ ＝ 分けるクラスが付かず、--tf1 の平らな塗りになる */
    node.style.setProperty('--tc1', colors[0]);
    node.style.setProperty('--tc2', colors[1] || colors[0]);
    node.style.setProperty('--tc3', colors[2] || colors[1] || colors[0]);
  } else {
    node.style.removeProperty('--tc1');
    node.style.removeProperty('--tc2');
    node.style.removeProperty('--tc3');
  }

  /* ---- 着手済み ----
     'dim'（既定）＝ 膜と縁を薄くする。済んだからもう見なくていい（海・今日）。
     'mark'        ＝ 引っ込めず、輪をはっきりさせる（きっかけ）。
                      常設の面では「今日それに触ったか」がひと目で要るため。
     どちらも文字は消さない。見た目は css/bubble.css が持つ。 */
  const started = startedFlag(item.started);
  const mark = opts.startedLook === 'mark';
  node.classList.toggle('is-started', started);
  node.classList.toggle('is-mark', started && mark);

  /* ---- タグの名前 ----
     色だけでは、色を見分けられない人にタグが伝わらない（WCAG 1.4.1）。
     バブルは小さく、文字を足すと本文が読めなくなるので、名前は
     読み上げ文（ここ）と中央の盤（buildCenterPanel）に載せる。
     渡されていない画面では、旧 marks のラベルで代用する。 */
  const names = tagNames(
    Array.isArray(opts.tagNames) ? opts.tagNames : (item && item.tagNames));
  tagMeta.set(node, { names, colors });

  const marks = Array.isArray(opts.marks) ? opts.marks.slice(0, 3) : [];
  node.setAttribute('aria-label', ariaFor(item, names, marks, started));
  node.dataset.id = item.id;
  return node;
}

/* ---------------- ジェスチャ ---------------- */

function layerEl() {
  return document.getElementById('drag-layer') || document.body;
}

/* タブは app.js が #tabbar の中に button[data-screen] で並べる。
   古い形（data-id）でも引けるようにしておく（切り替え中に落ちないため）。 */
function tabButtons() {
  const bar = document.getElementById('tabbar');
  if (!bar) return [];
  return [...bar.querySelectorAll('button[data-screen], button[data-id]')];
}
function tabIdOf(btn) {
  return btn.dataset.screen || btn.dataset.id || '';
}

/* ドラッグの当たり判定は「指先の座標」で行う。
   バブルの外形はタブ6本ぶんを覆ってしまうので、要素の重なりでは決められない。 */
function tabAt(list, x, y) {
  for (const t of list) {
    const r = t.rect;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t;
  }
  return null;
}

/* ---------------- 盤に置く操作（はじめた / 完了 / 消す） ----------------

   画面（sea / today / plan / gap）は、いままでどおり handlers.onMenu(id, node) を渡す。
   その中身は「openMenu(node, {onDetail, onFocus, onStarted, onComplete, onDelete, isDone})
   を呼ぶ」だけなので、盤を組み立てるあいだだけ openMenu を横取りして、
   渡された handlers をそのまま受け取る。画面側は1行も書き換えなくてよい。

   横取りしている間、openMenu は浮くメニューを作らず、handlers を控えて何もしない関数を返す。 */
let harvest = null;

/* 画面側が投げても中央は開く。返り値がオブジェクトのときだけ通す */
function harvestSafe(run) {
  try {
    const v = run();
    return (v && typeof v === 'object') ? v : null;
  } catch (_) { return null; }
}

function harvestActions(run) {
  const prev = harvest;
  const box = { got: null };
  harvest = box;
  /* 画面側が投げても中央は開く（openMenu まで届かなければ操作は出ないだけ） */
  try { run(); } catch (_) { /* 握りつぶす */ }
  harvest = prev;
  return box.got;
}

/* 盤の下半分の並び（利用者の指示で組み替えた）。

       [ はじめた ][ OK ]      ← OK は「次の一手」を書き留めるだけ。盤は閉じない
       [ タスク完了 ]
       ──────────
       [ 消す ]

   ■ なぜ組み替えたか
   前は [はじめた][完了] が横並びで、そのすぐ上に「次の一手」の入力欄があった。
   **入力欄の直下の「完了」が、一手を書き終えた合図（OK）に読めていた**
   ——利用者の指摘。押すと項目そのものが完了になるので、取り違えると重い。

   そこで直したのは2つ：
     ・その位置は **OK**（次の一手を書き留める）にした。押しても盤は閉じない
     ・完了は **「タスク完了」** と名乗り直し、**消すのすぐ上**へ移した。
       ＝ 取り返しの重いものが下にまとまり、入力欄からは離れる

   「消す」は取り返しがつきにくいので、いちばん下に1つだけ、色も弱く。
   押したあとは askDelete が一度だけ聞く（run に key を渡しているのはそのため）。 */
function actionRow(actions, run, onOk, onStart) {
  const a = actions || {};
  const has = k => typeof a[k] === 'function';
  const canOk = typeof onOk === 'function';
  const canStart = typeof onStart === 'function';
  if (!canStart && !has('onStarted') && !has('onComplete') && !has('onDelete') && !canOk) return null;

  const box = el('div', 'bc-acts');

  /* --- [タスク開始]（利用者の指示）---

     もとは盤の外、バブルの**上**に浮かせていた（追補3 §5 の「いちばん上」）。
     バブルを画面の上部へ移してから、そこが画面の縁ぎりぎりの細い帯になり、
     いちばん強いはずの導線がいちばん見つけにくくなっていた（利用者の指摘）。

     **「今日は終わり」の上へ移した**（利用者の指示）。目が行く場所は盤の中で、
     しかも「状態を変える3つ」の先頭。並びの意味は変わらない——
     進む → 今日ぶんを終える → タスクごと終える → 消す、と下るほど重くなる。 */
  if (canStart) {
    const st = el('button', 'bc-act bc-act-start', 'タスク開始');
    st.type = 'button';
    st.addEventListener('click', ev => { ev.preventDefault(); onStart(); });
    box.appendChild(st);
  }
  const mk = (cls, label, key) => {
    const b = el('button', 'bc-act ' + cls);
    b.type = 'button';
    b.textContent = label;                   /* innerHTML には入れない */
    b.addEventListener('click', ev => { ev.preventDefault(); run(a[key], key); });
    return b;
  };

  const top = el('div', 'bc-act-row');
  /* 「はじめた」から「今日は終わり」へ（利用者の指示）。
     **記録している中身は変えていない**（store.start の着手印のまま）。
     名前を変えたのは、この印が実際にしていることが「今日ぶんはここまで」だから——
     押すとバブルが薄くなって「もう見なくていい」を伝え、5時に戻る（契約 §5）。
     「はじめた」ではその意味が読めなかった、という指摘。 */
  if (has('onStarted')) top.appendChild(mk('bc-act-started', '今日は終わり', 'onStarted'));
  if (canOk) {
    /* OK は他のボタンと性質が違う。**盤を閉じない**（書き留めるだけ）。
       押したことが分かるよう、少しのあいだ文字を変える——
       閉じないぶん、何も起きなかったように見えてしまうため。

       出す文字は onOk() が決める。積めたときは「書き留めた」、
       積まなかったときはその理由（「次の一手が要る」など）。
       **積めなかったことを黙って同じ顔で返さない**——
       押したのに何も起きていない、が分からないため。 */
    const ok = el('button', 'bc-act bc-act-ok');
    ok.type = 'button';
    ok.textContent = 'OK';
    let back = 0;
    ok.addEventListener('click', ev => {
      ev.preventDefault();
      const said = onOk();
      const label = typeof said === 'string' && said ? said : '書き留めた';
      const done = label === '書き留めた';
      clearTimeout(back);
      ok.textContent = label;
      ok.classList.toggle('is-done', done);
      ok.classList.toggle('is-nope', !done);
      back = setTimeout(() => {
        ok.textContent = 'OK';
        ok.classList.remove('is-done');
        ok.classList.remove('is-nope');
      }, 1200);
    });
    top.appendChild(ok);
  }
  if (top.childNodes.length) box.appendChild(top);

  /* 完了したものの上では「タスク完了」ではなく「海にもどす」。openMenu と同じ入れ替え */
  if (has('onComplete')) {
    box.appendChild(mk('bc-act-done',
      a.isDone === true ? '海にもどす' : 'タスク完了', 'onComplete'));
  }
  if (has('onDelete')) box.appendChild(mk('bc-act-del', '消す', 'onDelete'));
  return box;
}

/* ---------------- 「本当に消す？」 ----------------

   「消す」は内部では墓石で、データは失われない（store.remove は配列から抜かず
   trashed を立てるだけ）。それでも **いまの画面のどこからも戻せない**。
   戻す口は取り消しのトースト1枚だけで、数秒で消える。見送ったらそれきり。

   だから押した瞬間には消さず、一度だけ聞く（利用者の指示）。
   戻す道が画面に付いたら、この確認は外してよい。

   聞き方の決めごと：
     ・既定は「やめる」。鍵盤の焦点も最初はそちらに乗る
     ・Escape・背景・「やめる」は、すべて同じ＝消さない
     ・Tab は2つのボタンの間だけを回る（後ろの画面へ抜けない）
     ・命令形にしない。責めない。「消しますか？」ではなく「消す？」 */

/* 確認に出す名前。読み上げ文（aria-label）には
   「牛乳を買う・今日・はじめた（タップで真ん中へ）」のようにタグや状態が続くので、
   そのまま出すと「『牛乳を買う・今日』を消す？」になる。
   本文は .tx にそのまま入っているので、まずそれを読む。
   （着手済みの見た目では文字を伏せるが、DOM からは消していないので読める） */
function nameOfNode(node) {
  const tx = node && node.querySelector ? node.querySelector('.tx') : null;
  const body = tx ? (tx.textContent || '').trim() : '';
  if (body) return body;
  return ((node && node.getAttribute('aria-label')) || '').split('（')[0];
}

let askSeq = 0;
let askState = null;      /* 同時にひとつだけ */

function askDelete(name, onYes) {
  closeAsk();
  const seq = ++askSeq;
  const was = document.activeElement;

  const back = el('div', 'ask-back');
  const box = el('div', 'ask');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');

  const ttl = el('p', 'ask-title');
  ttl.id = 'ask-t' + seq;
  /* 名前はユーザーが打った文字。innerHTML には入れない */
  ttl.textContent = name ? '「' + name + '」を消す？' : 'これを消す？';
  box.setAttribute('aria-labelledby', ttl.id);
  box.appendChild(ttl);

  const body = el('p', 'ask-body');
  body.id = 'ask-b' + seq;
  body.textContent = '画面から見えなくなる。記録としては残るけれど、'
    + 'いまのこのアプリからは戻す道が無い。';
  box.setAttribute('aria-describedby', body.id);
  box.appendChild(body);

  const row = el('div', 'ask-row');
  const no = el('button', 'ask-btn ask-no');
  no.type = 'button';
  no.textContent = 'やめる';
  const yes = el('button', 'ask-btn ask-yes');
  yes.type = 'button';
  yes.textContent = '消す';
  row.appendChild(no);
  row.appendChild(yes);
  box.appendChild(row);

  const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
  back.addEventListener('pointerdown', eat);
  back.addEventListener('click', eat);
  back.addEventListener('contextmenu', eat);
  back.addEventListener('pointerup', ev => { eat(ev); closeAsk(true); });
  back.addEventListener('pointercancel', ev => { eat(ev); closeAsk(true); });

  no.addEventListener('click', ev => { ev.preventDefault(); closeAsk(true); });
  yes.addEventListener('click', ev => {
    ev.preventDefault();
    closeAsk(true);
    if (typeof onYes === 'function') onYes();
  });

  /* Escape は消さない。Tab はこの2つの間だけを回す */
  const onKey = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeAsk(true); return; }
    if (ev.key !== 'Tab') return;
    ev.preventDefault();
    (document.activeElement === no ? yes : no).focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  document.body.appendChild(box);
  askState = { back, box, onKey, was };
  /* 既定の行き先へ焦点を置く。rAF は隠れている面では発火しないので待たない（§14） */
  no.focus({ preventScroll: true });
}

function closeAsk(restoreFocus) {
  if (!askState) return;
  const a = askState;
  askState = null;
  window.removeEventListener('keydown', a.onKey, true);
  a.back.remove();
  a.box.remove();
  if (restoreFocus && a.was && a.was.isConnected && typeof a.was.focus === 'function') {
    a.was.focus({ preventScroll: true });
  }
}

/* ---------------- 中央の盤 ----------------

       （バブル本体）              ← 画面の上部
       ● タグ名  ● タグ名        ← 色だけを手がかりにしない（1.4.1）
       作業メモ  [編集できる]
       次の一手  [編集できる]
       リンク    [押せる] [編集]
       [ 履歴 ]                   ← 記録があるときだけ
       [ タスク開始 ]             ← いちばん強い。5分の集中画面へ
       [ 今日は終わり ] [ OK ]
       [ タスク完了 ]
       ────────────
       [ 消す ]

   ・[タスク開始] だけは預け先が無くても出す（5分の集中画面はここが唯一の入口）
   ・次の一手 / リンクは setCenterHandler() が差されているときだけ出す
     （行き先の無い入力欄を出さないため）
   ・はじめた / 完了 / 消す は、長押しメニューから移してきたもの。
     操作の入口を中央の盤ひとつにまとめた（長押しではメニューを開かない）。
     「詳細」は盤そのものが詳細なので置かない。「5分だけ集中」は [まずは開始] と同じ。
   ・盤そのものは pointer-events:none。押せるのはボタンと入力欄だけ。
     盤の余白を押したら「無関係なところを触った」＝中央から戻る

   ■ 並びの理由
     次の一手 / リンク / 履歴 … その項目の中身。読む・直す
     タスク開始 … 進む。状態を変える列の先頭で、いちばん強い
     今日は終わり / タスク完了 … 状態を変える。下るほど重い
     消す … 取り返しがつかない。線で切って、いちばん下、いちばん弱く

   [タスク開始] は前はバブルの**上**に浮いていた（追補3 §5 の「いちばん上」）。
   バブルが画面の上部へ移ってから、そこが縁ぎりぎりの細い帯になり、
   いちばん強いはずの導線がいちばん見つけにくくなっていた（利用者の指摘）。
   「履歴」は**読むだけ**で何も変えない。状態を変える2つと同じ列に並べると、
   押し間違いの代償が釣り合わない（隣は「完了」＝項目が消える）。
   だから、それが要約している「次の一手」のすぐ下に置き、面も持たせない。

   戻り値 = { root, place(cx,cy,d), flush(), focusFirst(), isTyping(), handleEscape() } */
function buildCenterPanel(id, ariaLabel, onStart, actions, runAction, info) {
  let saveTags = null;          /* タグの付け外しは閉じるときにまとめて書く */
  let saveHoldUntil = null;     /* 長期保留の「戻ってくる日」も同じく閉じるとき */
  /* 「今日」の札と、カレンダーの今日の枡は同じものを指す。
     二重に書かないよう、書き込みはカレンダー側が持ち、札は見た目だけ合わせる */
  let todayCell = null;
  let saveDays = null;          /* 日の入り切りも閉じるときにまとめて書く */
  let syncTodayChip = null;     /* カレンダーが「今日」の札の見た目を合わせる */
  const root = el('div', 'bub-center');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', (ariaLabel.split('（')[0] || '') + ' の操作');


  const a = centerAdapter;
  let fields = null, stepIn = null, urlIn = null;
  /* 作業メモは盤に入力欄を持たない。入口のボタンと、別の面と、その中身 */
  let memoBtn = null, memoPane = null, memoArea = null, memoSaid = null;
  let memoDraft = '';
  let draft0 = null;            /* 開いた時点の入力欄の中身（触ったかを見るため） */
  let urlLink = null, urlLinkTx = null, urlEdit = null;
  let histBtn = null, hist = null, histList = null, histClose = null;
  let lastPlace = null;

  /* 盤の箱は、入力欄が無くても（預け先が差されていなくても）作る。
     はじめた / 完了 / 消す はいつでも要るため。 */
  /* OK は「次の一手」を書き留めるだけ。saveStep は下で宣言されるが、
     関数宣言は巻き上がるうえ、呼ばれるのは押されたときなので参照できる。
     ついでに入力欄の焦点を外す（端末のキーボードが引っ込む） */
  const acts = actionRow(actions, runAction, () => {
    const label = applyEdits();
    if (stepIn) stepIn.blur();
    return label;
  }, onStart);
  if (a || acts) fields = el('div', 'bc-fields');

  /* ---- タグの名前 ----
     バブルは色でしかタグを表せない（小さくて文字が入らない）。盤には余白があるので、
     ここで名前を文字にする。点は色の目印にすぎないので aria-hidden。
     文字は --text（--surface に対し 明14.5 / 暗14.3）で、色の上に載せない。 */
  const names = (info && Array.isArray(info.names)) ? info.names : [];
  const cols = (info && Array.isArray(info.colors)) ? info.colors : [];
  /* 点を名前の横に置けるのは、名前と色が1対1で残っているときだけ。
     色は3つまでに畳まれ、名前は読めない値を落として詰めるので、
     数が食い違ったら並びの対応はもう保証できない。
     そのときは点を出さない（違う色を指した点は、無い点より悪い）。
     名前は文字で出るので、これで情報は落ちない。 */
  const paired = names.length > 0 && names.length === cols.length;

  /* ---- タグ（利用者の指示。A-10）----

     前はここに「いま付いているタグ」を読むだけで並べていた。
     いまは **付け外しもここでできる**。タグを付ける道が
     「海の端までバブルを運ぶ」しか無かったので、選んだ状態から直に触れるようにした。

     ■ 書くのは閉じるとき（flush）
     タグを変えると店が emit し、画面が組み直されて、いま中央に居るこのノードごと
     作り直される。＝ 押した瞬間に書くと、1つ付けたところで盤が閉じる。
     次の一手・リンクと同じで、押した内容はここに溜めて、閉じるときにまとめて書く。

     ■ 「完了」は出さない
     専用のボタンが下にあり、音と取り消しのトーストが付いている。
     ここから同じことを別の顔で二度できるようにすると、どちらが本筋か分からなくなる。

     ■ 古い預け先（tags を返さない版）では、いままでどおり読むだけ */
  const allTags = ask(a, 'tags');
  const canEdit = Array.isArray(allTags) && allTags.length
    && typeof (a || {}).setTag === 'function';

  if (fields && canEdit) {
    const has0 = new Set(ask(a, 'tagsOf', id) || []);
    const want = new Set(has0);
    const list = allTags.filter(t => t && t.id && t.id !== 'done');

    const tags = el('div', 'bc-tags');
    list.forEach(t => {
      const chip = el('button', 'bc-tag bc-tag-btn');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', want.has(t.id) ? 'true' : 'false');
      const dot = el('span', 'bc-tag-dot');
      dot.setAttribute('aria-hidden', 'true');
      if (t.color) dot.style.setProperty('--tcd', t.color);
      const tx = el('span', 'bc-tag-tx');
      tx.textContent = String(t.name || '');   /* ユーザーの文字。innerHTML には入れない */
      chip.appendChild(dot);
      chip.appendChild(tx);
      chip.addEventListener('click', ev => {
        ev.preventDefault();
        /* 「今日」はカレンダーの今日の枡と同じもの。書き込みはあちらが持つ */
        if (t.id === 'today' && todayCell) { todayCell.toggle(); return; }
        const on = !want.has(t.id);
        if (on) want.add(t.id); else want.delete(t.id);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (t.id === 'hold' && syncHoldRow) syncHoldRow(true);
      });
      if (t.id === 'today') syncTodayChip = on => chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      tags.appendChild(chip);
    });
    fields.appendChild(tags);

    /* ---- いつの日（カレンダー。利用者の指示）----

       > todayタグのもののdaysをカレンダーでタップしてON/OFF出来るようにしたい
       > （今日はできなそうなので、9/3,4に移す、みたいな）

       1件は**複数の日に置ける**（days は配列）。ここはそれをそのまま入り切りする。
       前は「この日から [前の日へ][次の日へ]」だったが、
       **どの日の話かを画面の文脈に頼っていた**（今日の画面でしか出せなかった）。
       カレンダーは日そのものを見せるので、どの画面の盤からでも使える。

       ■ 出す範囲は3週間（今週の日曜から）
         過去は1週間ぶんだけ見える。遠い過去を一覧にすると、それ自体が
         「やらなかった日」を数える装置になる（§0。日を選ぶ札と同じ考え）。

       ■ 過去の日は押せない
         過去はその日の記録なので、あとから足させない・消させない
         （入力欄を過去の日に出さないのと同じ規則）。**印は出す**——
         そこに置いた事実は読めたほうがいい。

       ■ 書くのは閉じるとき
         タグの札と同じ。押した瞬間に書くと店が emit して盤が組み直され、
         1日入れたところで盤が閉じる。 */
    const canDays = typeof (a || {}).setDay === 'function' && typeof (a || {}).shiftDay === 'function';
    if (canDays) {
      const today = ask(a, 'todayKey') || '';
      const days0 = new Set(ask(a, 'days', id) || []);
      const want = new Set(days0);

      const box = el('div', 'bc-cal');
      const lb = el('span', 'bc-cal-lb', 'いつの日');
      box.appendChild(lb);

      const grid = el('div', 'bc-cal-grid');
      ['日', '月', '火', '水', '木', '金', '土'].forEach(d => {
        const h = el('span', 'bc-cal-h', d);
        h.setAttribute('aria-hidden', 'true');
        grid.appendChild(h);
      });

      /* 今週の日曜から3週間ぶん。曜日の列がそろうので、数えなくても位置で読める */
      const dow = todayDow(today);
      const first = ask(a, 'shiftDay', today, -dow);
      const cells = [];
      for (let i = 0; i < 21; i++) {
        const key = ask(a, 'shiftDay', first, i);
        if (!key) continue;
        const past = key < today;
        const b = el('button', 'bc-cal-d');
        b.type = 'button';
        b.textContent = String(Number(key.slice(8, 10)));
        b.dataset.key = key;
        if (key === today) b.classList.add('is-today');
        if (past) { b.classList.add('is-past'); b.disabled = true; }
        b.setAttribute('aria-label', key.slice(5).replace('-', '月') + '日'
          + (key === today ? '（今日）' : '') + (past ? '。過ぎた日は変えられない' : ''));
        b.addEventListener('click', ev => {
          ev.preventDefault();
          if (want.has(key)) want.delete(key); else want.add(key);
          paint();
        });
        grid.appendChild(b);
        cells.push({ key, b });
      }
      box.appendChild(grid);
      fields.appendChild(box);

      function paint() {
        cells.forEach(c => {
          const on = want.has(c.key);
          c.b.classList.toggle('is-on', on);
          c.b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (syncTodayChip) syncTodayChip(want.has(today));
      }
      paint();

      /* 「今日」の札は、このカレンダーの今日の枡と同じものを指す。
         二重に書かないよう、札のほうは見た目だけ合わせて、書き込みはここが持つ */
      todayCell = {
        has: () => want.has(today),
        toggle: () => { if (want.has(today)) want.delete(today); else want.add(today); paint(); },
      };

      saveDays = () => {
        cells.forEach(c => {
          const now = want.has(c.key);
          if (now === days0.has(c.key)) return;
          ask(a, 'setDay', id, c.key, now);
        });
        days0.clear();
        want.forEach(v => days0.add(v));      /* 二重に書かない */
      };
    }

    /* ---- 長期保留の「戻ってくる日」（利用者の指示）----

       長期保留は「いつかやるが、いまは見ない」。
       **いつかを決めておけば、その日に自分で思い出さなくても海へ戻ってくる。**
       決めなくてもよい（そのときは自分で外すまで上の海に居る）。

       置き場所をタグのすぐ下にしたのは、**札を押した直後に目に入る**から。
       別のダイアログにすると、押した流れが切れる。
       長期保留を選んでいないあいだは丸ごと隠す——関係の無い欄が常に見えていると、
       いま何を決めているのかが読めなくなる。

       言い方は「戻ってくる日」。「期限」「締切」とは書かない。
       **過ぎても責めるものが無い**——過ぎた日は、開いた時点で静かに戻すだけ。 */
    const holdTag = list.find(t => t.id === 'hold');
    const canHoldDay = holdTag && typeof (a || {}).setHoldUntil === 'function';
    let syncHoldRow = null;

    if (canHoldDay) {
      const until0 = ask(a, 'holdUntil', id) || null;
      let until = until0;

      const box = el('div', 'bc-hold');
      const lb = el('label', 'bc-hold-lb', 'もどってくる日');
      const picks = el('div', 'bc-hold-picks');
      const dayIn = el('input', 'bc-hold-day');
      dayIn.type = 'date';
      const today = ask(a, 'todayKey') || '';
      if (today) dayIn.min = today;                /* 過ぎた日は選ばせない */
      dayIn.setAttribute('aria-label', 'もどってくる日をえらぶ');
      lb.htmlFor = dayIn.id = 'bc-hold-day-' + String(id);

      /* 早い順。いちばん近いものを左に置く（押す回数が多いほうを親指側へ） */
      const PRESETS = [
        { tx: '1週間', get: () => ask(a, 'dayAfter', 7) },
        { tx: '1か月', get: () => ask(a, 'monthAfter', 1) },
        { tx: '3か月', get: () => ask(a, 'monthAfter', 3) },
        { tx: '決めない', get: () => null },
      ];
      const btns = PRESETS.map(p => {
        const b = el('button', 'bc-hold-pick');
        b.type = 'button';
        b.textContent = p.tx;
        b.addEventListener('click', ev => {
          ev.preventDefault();
          until = p.get() || null;
          dayIn.value = until || '';
          syncPicks();
        });
        picks.appendChild(b);
        return { b, p };
      });

      dayIn.addEventListener('change', () => {
        until = dayIn.value || null;
        syncPicks();
      });

      /* いま選ばれている札を起こす。**付いていないほうを薄くするのではなく、
         付いているほうを起こす**（§0）。「決めない」は日が無いときに起きる */
      function syncPicks() {
        btns.forEach(({ b, p }) => {
          const v = p.get() || null;
          b.setAttribute('aria-pressed', v === until ? 'true' : 'false');
        });
      }

      box.appendChild(lb);
      box.appendChild(dayIn);
      box.appendChild(picks);
      dayIn.value = until || '';
      syncPicks();
      fields.appendChild(box);

      /* 長期保留の札の状態に合わせて出し入れする。
         **出し入れすると盤の高さが 115px 変わる**ので、置き直しまでやる。
         やらないと、下タブぎりぎりに出ていた盤が札を押した拍子に潜り込む
         （リンク欄が伸び縮みするときに relayout() を呼ぶのと同じ理由）。 */
      syncHoldRow = (fit) => {
        const was = box.hidden;
        box.hidden = !want.has('hold');
        if (fit && was !== box.hidden) relayout();
      };
      syncHoldRow(false);   /* 組み立て中。まだ place() が走っていないので測れない */

      saveHoldUntil = () => {
        if (!want.has('hold')) return;             /* 長期保留でなければ日も持たない */
        if (until === until0) return;
        ask(a, 'setHoldUntil', id, until);
      };
    }

    saveTags = () => {
      list.forEach(t => {
        if (t.id === 'today' && todayCell) return;   /* カレンダーが書く */
        const now = want.has(t.id);
        if (now !== has0.has(t.id)) ask(a, 'setTag', id, t.id, now);
      });
      has0.clear();
      want.forEach(v => has0.add(v));          /* 二重に書かない */
    };
  } else if (fields && names.length) {
    /* 読むだけの版（預け先が古い） */
    const tags = el('div', 'bc-tags');
    tags.setAttribute('role', 'list');
    names.forEach((nm, i) => {
      const chip = el('span', 'bc-tag');
      chip.setAttribute('role', 'listitem');
      const dot = el('span', 'bc-tag-dot');
      dot.setAttribute('aria-hidden', 'true');
      /* normHex を通った値だけが入っている（tintColors 済み）。無ければ点は出さない */
      if (paired && cols[i]) dot.style.setProperty('--tcd', cols[i]);
      else dot.hidden = true;
      const tx = el('span', 'bc-tag-tx');
      tx.textContent = nm;                     /* innerHTML には入れない */
      chip.appendChild(dot);
      chip.appendChild(tx);
      tags.appendChild(chip);
    });
    fields.appendChild(tags);
  }

  /* ---- 次の一手 と 作業メモ（利用者の指示）----

     並びは **次の一手 → 作業メモ**。次の一手は1行で、いつでも書き替える短いもの。
     作業メモは長くなるので、盤には**入口だけ**を置いて、押したら別の面で書く。

     ■ 打っている途中では記録しない
       打った文字は「書きかけ」（draft）へ控えるだけ。記録に触るのは
       [OK]（次の一手・いつの日・リンク）と [作業メモを保存] だけ。
       書きかけは記録ではないので、履歴にもふりかえりにも出ない
       ——それでも控えるのは、打った文字が消えるのが事故だから。

     ■ 次の一手が空だと積まない
       git のコミットが必ず次を指すのと同じ（store.commitStep も空を弾く）。
       **その代わり、次の一手を空にして消すことはできない。**置き換えはできる。 */
  const canCommit = !!(a && typeof a.commitStep === 'function');
  if (a && fields) {
    const draft = (canCommit && ask(a, 'draft', id)) || null;

    const wrap = el('label', 'bc-row');
    const lb = el('span', 'bc-lb');
    lb.textContent = '次の一手';               /* innerHTML には入れない */
    stepIn = el('input', 'bc-in');
    stepIn.type = 'text';
    stepIn.placeholder = 'ひとつめだけ';
    stepIn.autocomplete = 'off';
    stepIn.enterKeyHint = 'done';
    wrap.appendChild(lb);
    wrap.appendChild(stepIn);
    fields.appendChild(wrap);
    /* 書きかけがあればそちら、無ければいまの「次の一手」 */
    stepIn.value = String((draft && draft.next) || ask(a, 'firstStep', id) || '');

    if (canCommit) {
      /* 作業メモは入口だけ。中身は別の面で書く（利用者の指示）。
         入口には**いま何か書いてあるか**を出す——押さないと分からない、にしない */
      memoDraft = String((draft && draft.did) || '');
      const mrow = el('div', 'bc-row');
      const mlb = el('span', 'bc-lb', '作業メモ');
      memoBtn = el('button', 'bc-memo-open');
      memoBtn.type = 'button';
      memoBtn.addEventListener('click', ev => { ev.preventDefault(); openMemo(); });
      mrow.appendChild(mlb);
      mrow.appendChild(memoBtn);
      fields.appendChild(mrow);
      syncMemoBtn();
    }

    /* 開いた時点の中身。**触っていないなら書きかけも書かない**
       ——開いて閉じただけで書きかけが生まれると、集中画面が
       「前回の続きがある」と読んでしまう */
    draft0 = { did: memoDraft, next: stepIn.value };
  }

  /* ---- リンク ----
     既定は「押せる」。入っていれば、そのまま開ける（http / https だけ、別のタブへ）。
     編集は隣の [編集] を押したときだけ。打ち終わったら（blur / Enter）押せる形へ戻る。

     空のときは「押せるもの」が無いので、最初から入力欄を出す。
     「リンクを足す」ボタンを挟むと、空 → ボタン → 入力欄 と一手増えるだけで、
     出てくるものは同じ（入力欄）。増やす理由がない。

     行を <label> にしないのは、label の中のリンクを押すと入力欄へ焦点が移って
     しまうため（＝押せるはずのリンクが押せなくなる）。名前は aria-label で渡す。 */
  if (a && fields) {
    const wrap = el('div', 'bc-row');
    const lb = el('span', 'bc-lb');
    lb.textContent = 'リンク';
    const box = el('span', 'bc-url');

    urlLink = el('a', 'bc-link');
    urlLink.target = '_blank';
    urlLink.rel = 'noopener noreferrer';
    urlLinkTx = el('span', 'bc-link-tx');
    urlLink.appendChild(urlLinkTx);            /* 文字は textContent で入れる */

    urlEdit = el('button', 'bc-edit');
    urlEdit.type = 'button';
    urlEdit.textContent = '編集';
    urlEdit.setAttribute('aria-label', 'リンクを編集');

    urlIn = el('input', 'bc-in');
    urlIn.type = 'url';
    urlIn.value = String(ask(a, 'url', id) || '');
    urlIn.placeholder = 'https://';
    urlIn.autocomplete = 'off';
    urlIn.enterKeyHint = 'done';
    urlIn.setAttribute('aria-label', 'リンク');

    box.appendChild(urlLink);
    box.appendChild(urlEdit);
    box.appendChild(urlIn);
    wrap.appendChild(lb);
    wrap.appendChild(box);
    fields.appendChild(wrap);
  }

  /* ---- 履歴のボタン ----
     アダプタに steps が無ければ出さない。記録が1件も無くても出さない。
     押しても何も無いボタンを作らないため。 */
  const hasSteps = !!(a && typeof a.steps === 'function');
  if (fields && hasSteps) {
    histBtn = el('button', 'bc-act bc-hist-open');
    histBtn.type = 'button';
    histBtn.textContent = '履歴';
    histBtn.setAttribute('aria-expanded', 'false');
    histBtn.addEventListener('click', ev => { ev.preventDefault(); openHistory(); });
    fields.appendChild(histBtn);
    /* **箱は先に作っておく。**[OK] で1件目が積まれた瞬間に出せるようにするため
       （前は組み立て時に1件も無ければボタンごと作らず、
         積んでも盤を開き直すまで出てこなかった）。
       押しても何も無いボタンは作らない、という決めは守る＝中身が無い間は隠す。 */
    syncHistBtn();
  }

  if (fields) {
    if (acts) fields.appendChild(acts);
    root.appendChild(fields);
  }

  /* ---- 打ち終わりを待って保存する（打つたびには書かない） ---- */
  let stepTimer = 0, urlTimer = 0;

  /* 打った文字を「書きかけ」へ控える。**記録には触らない。**
     預け先が古い（commitStep が無い）版では、いままでどおり次の一手を直に書く
     ——そちらには積む先が無いので、控えても行き場が無い */
  function saveStep() {
    clearTimeout(stepTimer); stepTimer = 0;
    if (!stepIn) return;
    if (!canCommit) { ask(a, 'setFirstStep', id, stepIn.value.trim()); return; }
    const did = memoDraft;
    const next = stepIn.value;
    if (draft0 && did === draft0.did && next === draft0.next) return;   /* 触っていない */
    ask(a, 'setDraft', id, { did: did.trim(), next: next.trim() });
  }

  /* [OK]（利用者の指示で役目を替えた）。

     **いつの日 ／ 次の一手 ／ リンク を、その場で書き留める。**
     押しても盤は閉じない。閉じたときにも同じものが書かれる（＝取りこぼさない）——
     OK は「閉じずに、いま反映する」ための道。

     作業メモはここでは触らない。あちらは別の面の [作業メモを保存] が持つ。

     -> ボタンに出す言葉。何も起きなかったときは、その理由を言う */
  function applyEdits() {
    let did = false;
    if (saveDays) { saveDays(); did = true; }        /* いつの日 */
    saveUrl();                                       /* リンク */

    if (!stepIn) return did ? '書き留めた' : null;
    const next = stepIn.value.trim();
    if (!canCommit) { ask(a, 'setFirstStep', id, next); return '書き留めた'; }

    const cur = String(ask(a, 'firstStep', id) || '');
    if (!next) { saveStep(); return next === cur ? '書き留めた' : '次の一手が要る'; }
    if (next === cur) { saveStep(); return '書き留めた'; }

    /* 次の一手が変わったなら、記録として1件積む（git のコミットと同じ形）。
       作業メモは空——あちらは [作業メモを保存] が積む */
    if (!ask(a, 'commitStep', id, { did: '', next: next })) return null;
    draft0 = { did: memoDraft, next: stepIn.value };
    syncHistBtn();
    return '書き留めた';
  }

  function saveUrl() {
    clearTimeout(urlTimer); urlTimer = 0;
    if (!urlIn) return;
    const v = urlIn.value.trim();
    /* 空は「消す」なので通す。中身があるときは http / https だけ（§15）。
       それ以外は保存せず、縁だけで知らせる（文字で叱らない） */
    if (!v || isSafeUrl(v)) ask(a, 'setUrl', id, v);
  }
  function markUrl() {
    if (!urlIn) return;
    const v = urlIn.value.trim();
    const bad = !!v && !isSafeUrl(v);
    urlIn.classList.toggle('is-bad', bad);
    urlIn.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }

  /* 押せる形／入力欄 の切り替え。
     force が真なら、中身にかかわらず入力欄にする（[編集] を押したとき）。
     そうでなければ、http / https の URL が入っているときだけ押せる形にする
     （空・不正なままリンクにすると、押せない／どこへ行くか分からないものが残る）。 */
  function syncUrl(force) {
    if (!urlIn) return;
    const v = urlIn.value.trim();
    const view = !force && isSafeUrl(v);
    if (view) {
      urlLink.href = v;                        /* href はプロパティで入れる */
      urlLinkTx.textContent = v;               /* 文字は textContent で入れる */
    } else {
      urlLink.removeAttribute('href');
      urlLinkTx.textContent = '';
    }
    urlLink.hidden = !view;
    urlEdit.hidden = !view;
    urlIn.hidden = view;
    markUrl();
  }

  /* 打っている途中も blur も、**書きかけへ控えるだけ**（記録は [OK] だけ） */
  [stepIn].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', () => {
      clearTimeout(stepTimer);
      stepTimer = setTimeout(saveStep, SAVE_MS);
    });
    inp.addEventListener('blur', saveStep);
  });
  if (urlIn) {
    urlIn.addEventListener('input', () => {
      markUrl();
      clearTimeout(urlTimer);
      urlTimer = setTimeout(saveUrl, SAVE_MS);
    });
    /* 打ち終わり＝保存して、押せる形へ戻す（戻せないときは入力欄のまま） */
    urlIn.addEventListener('blur', () => { saveUrl(); syncUrl(false); relayout(); });
    urlEdit.addEventListener('click', ev => {
      ev.preventDefault();
      syncUrl(true);
      relayout();
      urlIn.focus({ preventScroll: true });
      urlIn.select();
    });
    syncUrl(false);
  }

  /* 入力欄で Enter を押しても中央は閉じない（保存して焦点を外すだけ）。
     フォームが無いので送信は起きないが、意図をはっきりさせておく */
  [stepIn, urlIn].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;          /* Escape は window 側が拾って閉じる */
      ev.preventDefault();
      inp.blur();
    });
  });

  /* ---- 履歴 ----
     読むだけ。ここからは直せない（書き損じ直しは集中画面の「最後になにをしてたか」）。

     盤はもう縦に長い。履歴を下へ足すと下タブへもぐるので、**足さずに入れ替える**。
     開いている間は盤の中身を伏せ、同じ場所に履歴の面だけを出す。
     高さは「画面の上の余白から下タブの手前まで」を超えないところで頭打ちにして、
     あふれるぶんは面の中だけでスクロールさせる（外はスクロールしない）。
     中央から抜けないのは、この面が盤（.bub-center）の中にあるから
     ＝ 触っても「外を触った」にならない。 */
  function stepsNow() {
    const rows = ask(a, 'steps', id);
    return Array.isArray(rows) ? rows : [];
  }

  /* 記録が1件でもあれば出す。無ければ隠す。高さが変わるので置き直しまで */
  function syncHistBtn() {
    if (!histBtn) return;
    const want = !stepsNow().length;
    if (histBtn.hidden === want) return;
    histBtn.hidden = want;
    relayout();
  }

  function buildHist() {
    hist = el('div', 'bc-hist');
    hist.setAttribute('role', 'group');
    hist.setAttribute('aria-label', '履歴');
    hist.hidden = true;

    const head = el('div', 'bh-head');
    const ttl = el('span', 'bh-title');
    ttl.textContent = '履歴';
    histClose = el('button', 'bh-close');
    histClose.type = 'button';
    histClose.textContent = '閉じる';
    histClose.addEventListener('click', ev => { ev.preventDefault(); closeHistory(true); });
    head.appendChild(ttl);
    head.appendChild(histClose);

    /* ul にして印は出さない。番号を振ると「◯件目」を数えることになる（§0） */
    histList = el('ul', 'bh-list');
    hist.appendChild(head);
    hist.appendChild(histList);
    root.appendChild(hist);
  }

  function renderHist(rows) {
    fillStepList(histList, rows);
  }

  /* ---- 作業メモの面（利用者の指示）----

     > 作業メモは別画面を開いて詳細な入力が出来るように
     > 作業メモは[作業メモを保存]ボタンを用意

     履歴と同じ入れ替え方（盤と場所を分け合う。足すと下タブへもぐる）。
     長い文が書けるよう、残りの高さをぜんぶ使う。

     **[作業メモを保存] が記録を1件積む。**組むのは
     {作業メモ, いまの次の一手} で、git のコミットと同じ形。
     次の一手が空だと積めない（store の決まり）ので、そのときは理由を言う。 */
  function syncMemoBtn() {
    if (!memoBtn) return;
    const t = memoDraft.trim();
    memoBtn.textContent = t ? trimTx(t, 16) : '書く';
    memoBtn.classList.toggle('is-empty', !t);
    memoBtn.setAttribute('aria-label', t ? '作業メモを書き替える' : '作業メモを書く');
  }

  function buildMemo() {
    memoPane = el('div', 'bc-memo');
    memoPane.setAttribute('role', 'group');
    memoPane.setAttribute('aria-label', '作業メモ');
    memoPane.hidden = true;

    const head = el('div', 'bm-head');
    head.appendChild(el('span', 'bm-title', '作業メモ'));
    const close = el('button', 'bm-close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', ev => { ev.preventDefault(); closeMemo(true); });
    head.appendChild(close);
    memoPane.appendChild(head);

    /* いまの「次の一手」を読むだけで添える。何に続く記録なのかが要る */
    const ctx = el('p', 'bm-ctx');
    ctx.textContent = '';
    memoPane.appendChild(ctx);
    memoPane._ctx = ctx;

    memoArea = document.createElement('textarea');
    memoArea.className = 'bm-in';
    memoArea.rows = 6;
    memoArea.placeholder = 'ここまでやったこと';
    memoArea.setAttribute('aria-label', '作業メモ');
    memoArea.addEventListener('input', () => {
      memoDraft = memoArea.value;
      clearTimeout(stepTimer);
      stepTimer = setTimeout(saveStep, SAVE_MS);   /* 書きかけへ控えるだけ */
    });
    memoPane.appendChild(memoArea);

    const save = el('button', 'bm-save', '作業メモを保存');
    save.type = 'button';
    let back = 0;
    save.addEventListener('click', ev => {
      ev.preventDefault();
      const said = saveMemo();
      clearTimeout(back);
      save.textContent = said;
      save.classList.toggle('is-nope', said !== '記録した');
      back = setTimeout(() => {
        save.textContent = '作業メモを保存';
        save.classList.remove('is-nope');
      }, 1400);
    });
    memoPane.appendChild(save);

    memoSaid = el('p', 'bm-said');
    memoSaid.setAttribute('role', 'status');
    memoPane.appendChild(memoSaid);

    root.appendChild(memoPane);
  }

  /* -> ボタンに出す言葉 */
  function saveMemo() {
    const did = memoArea ? memoArea.value.trim() : '';
    const next = stepIn ? stepIn.value.trim() : '';
    if (!did) return '書いてから';
    if (!next) return '次の一手が要る';
    if (!ask(a, 'commitStep', id, { did: did, next: next })) return '記録できない';
    memoArea.value = '';
    memoDraft = '';
    draft0 = { did: '', next: stepIn ? stepIn.value : '' };
    syncMemoBtn();
    syncHistBtn();
    if (memoSaid) memoSaid.textContent = '履歴に積んだ';
    return '記録した';
  }

  function openMemo() {
    if (!memoPane) buildMemo();
    memoPane._ctx.textContent = stepIn && stepIn.value.trim()
      ? '次の一手：' + stepIn.value.trim()
      : '次の一手がまだ無い。書いてからでないと記録できない';
    memoArea.value = memoDraft;
    if (memoSaid) memoSaid.textContent = '';
    memoPane.hidden = false;
    if (fields) fields.hidden = true;
    relayout();
    memoArea.focus({ preventScroll: true });
  }

  /* 戻り値：閉じたかどうか（Escape の受け手が「自分で処理した」を知るため） */
  function closeMemo(restoreFocus) {
    if (!memoPane || memoPane.hidden) return false;
    memoDraft = memoArea ? memoArea.value : memoDraft;
    saveStep();                                   /* 書きかけを控える */
    memoPane.hidden = true;
    if (fields) fields.hidden = false;
    syncMemoBtn();
    relayout();
    if (restoreFocus && memoBtn && memoBtn.isConnected) memoBtn.focus({ preventScroll: true });
    return true;
  }

  function openHistory() {
    const rows = stepsNow();                   /* 開くたびに読み直す（古い順のまま） */
    if (!rows.length) {                        /* 外で消えていたら、ボタンごと引っ込める */
      if (histBtn) histBtn.hidden = true;
      relayout();
      return;
    }
    if (!hist) buildHist();
    renderHist(rows);
    hist.hidden = false;
    if (fields) fields.hidden = true;
    if (histBtn) histBtn.setAttribute('aria-expanded', 'true');
    relayout();
    histList.scrollTop = 0;                    /* 古いほうから読む */
    histClose.focus({ preventScroll: true });
  }

  /* 戻り値：閉じたかどうか（Escape の受け手が「自分で処理した」を知るため） */
  function closeHistory(restoreFocus) {
    if (!hist || hist.hidden) return false;
    hist.hidden = true;
    if (fields) fields.hidden = false;
    if (histBtn) histBtn.setAttribute('aria-expanded', 'false');
    relayout();
    if (restoreFocus && histBtn && !histBtn.hidden && histBtn.isConnected) {
      histBtn.focus({ preventScroll: true });
    }
    return true;
  }

  /* ---- 置き場所 ---- */
  /* バブルの上下に置く。画面の外へ出さない。
     下タブ（z-index 70）はドラッグ層（60）より手前に描かれるので、
     その下にもぐり込ませない（もぐると触れなくなる）。 */
  function place(cx, cy, d) {
    lastPlace = { cx, cy, d };
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const bar = document.getElementById('tabbar');
    const barTop = (bar && bar.getBoundingClientRect().height)
      ? bar.getBoundingClientRect().top : vh;

    /* バブルの下に置く箱は、いま出ているほう（盤 か 履歴）ひとつだけ */
    const lower = (hist && !hist.hidden) ? hist
      : ((memoPane && !memoPane.hidden) ? memoPane : fields);

    if (lower) {
      lower.style.left = cx + 'px';
      lower.style.top = (cy + d / 2 + CENTER_GAP) + 'px';
    }
    /* 高さの上限：画面の上の余白から下タブの手前まで。
       これを入れておくと、下の縦の寄せで必ず画面の中へ収まる。

       **盤にも同じ上限を掛ける。**行が増えて（作業メモ・長期保留の日）、
       いちばん背が高い形は 592px ある。375×667 では余りが 8px しかなく、
       これより低い画面では下タブへもぐる（もぐると触れない）。
       あふれるぶんは盤の中だけでスクロールさせる——履歴と同じ扱い。 */
    if (vh) {
      /* **バブルの下に残っている高さ**で頭打ちにする。
         画面いっぱいを許すと、下の縦の寄せが盤を押し上げて
         バブルの上に重なる（利用者の指摘はこれ）。
         下に入りきらないぶんは、盤の中だけでスクロールさせる。 */
      const lowerTop = cy + d / 2 + CENTER_GAP;
      const cap = Math.max(160, barTop - CENTER_M - lowerTop) + 'px';
      if (hist) hist.style.maxHeight = cap;
      if (memoPane) memoPane.style.maxHeight = cap;
      if (fields) fields.style.maxHeight = cap;
    }
    if (!vw || !vh) return;                    /* 寸法が取れないときは置いたまま */

    /* 横：画面からはみ出さないところまで寄せる（transform: translate(-50%) 前提） */
    const fitX = nd => {
      const w = nd.getBoundingClientRect().width;
      if (!w) return;
      nd.style.left = clamp(cx, CENTER_M + w / 2,
        Math.max(CENTER_M + w / 2, vw - CENTER_M - w / 2)) + 'px';
    };
    if (lower) fitX(lower);

    /* 縦：下タブの手前まで */
    if (lower) {
      const rf = lower.getBoundingClientRect();
      const limit = barTop - CENTER_M;
      if (rf.height && rf.bottom > limit) {
        lower.style.top = Math.max(CENTER_M, limit - rf.height) + 'px';
      }
    }
  }

  /* 中身の高さが変わったとき（履歴の開閉・リンクの形の切り替え）に置き直す。
     まだ一度も置いていなければ何もしない（place が来るのを待つ）。 */
  function relayout() {
    if (lastPlace) place(lastPlace.cx, lastPlace.cy, lastPlace.d);
  }

  return {
    root, place,
    /* タグは最後に書く。書いた瞬間に画面が組み直されるので、
       先に書くと 次の一手・リンクの保存先が消えることがある */
    /* 順番に意味がある。長期保留の札を先に書いてから日を足す
       （外れているものに日は付かない＝ store が弾く） */
    flush() {
      if (memoPane && !memoPane.hidden && memoArea) memoDraft = memoArea.value;
      saveStep(); saveUrl();
      if (saveDays) saveDays();               /* 日はタグより先（today を二重に書かない） */
      if (saveTags) saveTags();
      if (saveHoldUntil) saveHoldUntil();
    },
    /* 盤の先頭の的。[タスク開始] は盤の中へ移ったので、そこを探す
       （無い版もある——操作が1つも渡っていないとき） */
    focusFirst() {
      const first = root.querySelector('.bc-act-start')
        || root.querySelector('button:not([hidden])');
      if (first) first.focus({ preventScroll: true });
    },
    isTyping() {
      const el2 = document.activeElement;
      return !!(el2 && root.contains(el2) && el2.classList.contains('bc-in'));
    },
    /* Escape をここで先に受ける。履歴が開いていれば、閉じるのは履歴だけ
       （中央から抜けない）。開いていなければ false を返し、中央が閉じる。 */
    handleEscape() { return closeMemo(true) || closeHistory(true); },
  };
}

/* --- 一手の記録の一覧（盤と集中画面で共通） ---

   盤（この中）と集中画面（focus.js）が**同じものを使う**。
   別々に組むと、片方だけ直したときに同じ記録が2つの顔で出ることになる
   （詳細パネルが4実装ある件と同じ轍。DEV_NOTES B-2）。

   スタイルは css/bubble.css の .bh-* が持つ。あれは全画面で読み込まれるので、
   集中画面から使っても CSS を足す必要は無い。
   数え方（「◯件目」「◯回目」）は出さない——§0。 */
export function fillStepList(ul, rows) {
  ul.textContent = '';                       /* innerHTML には入れない */
  (Array.isArray(rows) ? rows : []).forEach(s => {
    const li = el('li', 'bh-item');
    const at = fmtAt(s && s.at);
    if (at) {
      const p = el('p', 'bh-at');
      p.textContent = at;
      li.appendChild(p);
    }
    const line = (label, raw) => {
      const t = String(raw == null ? '' : raw).trim();
      if (!t) return;
      const w = el('div', 'bh-line');
      const k = el('span', 'bh-k');
      k.textContent = label;
      const v = el('p', 'bh-v');
      v.textContent = t;                     /* innerHTML には入れない */
      w.appendChild(k);
      w.appendChild(v);
      li.appendChild(w);
    };
    line('作業メモ', s && s.did);
    line('次の一手', s && s.next);
    ul.appendChild(li);
  });
  return ul;
}

/* 印は出さない ul（番号を振ると「◯件目」を数えることになる／§0） */
export function stepList(rows) {
  return fillStepList(el('ul', 'bh-list'), rows);
}

/* いまドラッグ中のノード。body の is-dragging を、別のバブルの detach で
   消してしまわないための目印（同時にドラッグできるのは1つ） */
let activeDrag = null;

/* ジェスチャ層。
     handlers = {
       onFocusRequest(id), onMenu(id, node), onDropToTab(id, tabId),
       onDragStart(id), onDragEnd(id, info), getHost(),
       onActions(id, node),   ← 追加：中央の盤に出す操作を返す（副作用は持たせない）
                                {onStarted, onComplete, onDelete, isDone} を返すこと。
                                渡さなければ onMenu を横取りする旧経路になる。
       onHold(id, bool),      ← 追加：位置の主導権を取った／返した
       onDragMove(id, info),  ← 追加：ドラッグ中の現在位置
       releaseInPlace: bool,  ← 追加：中央から戻すとき、元の場所へ戻さず
                                その場（＝中央）で解放してよいか。
                                位置を自分で持てる面＝漂う面（js/drift.js）だけが真にする。
                                枠に並べる画面（きっかけ・すきま・整列グリッド）は
                                DOM の並び順が位置なので、偽のまま＝元の枠へ返す。
     }
   返り値 = detach 関数 */
export function attachGestures(node, handlers = {}) {
  const h = handlers;
  const idOf = () => node.dataset.id;
  /* 明示的に受け取る。クラス名では判定しない（他人の都合に依存させない） */
  const releaseInPlace = h.releaseInPlace === true;

  let homeParent = null, homeNext = null, homeTransform = '';
  let taken = false;                 /* いま位置の主導権をこちらが持っているか */
  let center = null;                 /* 中央に寄せている間の状態 */

  function call(name, ...args) {
    if (typeof h[name] === 'function') return h[name](...args);
    return undefined;
  }

  /* 層へ持ち出す／元の場所へ返す */
  function takeNode(rect) {
    if (taken) return;
    taken = true;
    homeParent = node.parentNode;
    homeNext = node.nextSibling;
    homeTransform = node.style.transform;
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    node.style.transform = 'translate(0px, 0px)';
    layerEl().appendChild(node);
    call('onHold', idOf(), true);
  }
  function giveBack() {
    if (!taken) return;
    taken = false;
    node.style.left = '';
    node.style.top = '';
    node.style.transition = '';
    node.style.transform = homeTransform || '';
    if (homeParent && homeParent.isConnected) {
      const before = (homeNext && homeNext.parentNode === homeParent) ? homeNext : null;
      homeParent.insertBefore(node, before);
    }
    homeParent = null; homeNext = null;
  }

  /* ---- タップ → 中央 ---- */

  /* toHome を真にすると、漂う面でも必ず元の場所へ返す。
     集中画面へ渡すとき（accept）と、ノードを畳むとき（detach）に使う。 */
  function cancelCenter(silent, toHome) {
    if (!center) return;
    const c = center;
    center = null;
    window.removeEventListener('pointerdown', c.onOutside, true);
    window.removeEventListener('keydown', c.onEsc, true);
    window.removeEventListener('resize', c.onAway);
    window.removeEventListener('scroll', c.onScroll, true);
    if (c.panel) c.panel.root.remove();
    if (c.hit) c.hit.remove();
    if (c.veil) c.veil.remove();
    node.classList.remove('is-centered');
    if (c.host) c.host.classList.remove('is-focusing');
    document.body.classList.remove('is-focusing');

    /* 漂う面では、元の位置へ瞬間移動して戻すのをやめ、いまいる場所（＝中央）で解放する。
       ドラッグ層からの出し入れは takeNode / giveBack の対をそのまま通す（対称性を崩さない）。
       戻した直後に、ドラッグを離したときと同じ口（onDragEnd）で座標を置き直させる。
       位置は「寄せ先」として計算した中央をそのまま使う。
       画面が隠れていると transition が進まず矩形が起点のままになることがあるので、
       getBoundingClientRect には頼らない。 */
    const inPlace = releaseInPlace && !toHome && taken;
    const id = idOf();
    giveBack();
    if (inPlace) {
      call('onDragEnd', id, {
        reason: 'center', droppedTo: null,
        x: c.cx, y: c.cy,
        left: c.cx - c.d / 2, top: c.cy - c.d / 2,
        vx: 0, vy: 0,          /* 投げていないので勢いは乗せない */
      });
    }
    call('onHold', id, false);
    if (!silent && c.wasFocused && node.isConnected) node.focus({ preventScroll: true });

    /* 打ちかけを書き切るのは いちばん最後。
       保存は store を動かし、画面の作り直し（＝この node の detach）を呼ぶことがある。
       DOM を戻し切る前に書くと、戻し先がもう無い／二重になる。
       入力欄は外したあとでも .value が読めるので、順番を後ろにしても文字は落ちない。 */
    if (c.panel) c.panel.flush();
  }

  function accept() {
    const id = idOf();
    /* 集中画面へ行く経路は変えない。元の場所へ返してから渡す
       （cancelCenter の最後で次の一手・リンクが保存されるので、集中画面は新しい値を読む） */
    cancelCenter(true, true);
    call('onFocusRequest', id);
  }

  /* pt を渡すと、そのタップが生む click を1つだけ捨てる（上の eatOpeningClick）。
     指で開いたときだけ渡す。キーボードから開くときは渡さない */
  function startCenter(pt) {
    if (center) return;          /* 既に中央。二度目のタップで開く経路はもう無い */
    const host = call('getHost') || node.parentNode;
    const from = node.getBoundingClientRect();
    if (!from.width) return;               /* 寸法が取れないときは何もしない */

    const hr = (host && host.getBoundingClientRect) ? host.getBoundingClientRect() : from;
    const cx = hr.left + hr.width / 2;
    /* 上部へ。[まずは開始] のぶんだけ空けた、いちばん上に置ける位置。
       面がとても低いときだけ真ん中に留める（上に寄せると下がもっと狭くなるため） */
    const cyTop = hr.top + CENTER_M + CENTER_TOP_BAND + from.height / 2;
    const cy = Math.min(hr.top + hr.height / 2, cyTop);

    /* ---- 覆い（取り消しの口） ----
       いちばん先に置く＝この層の最初の子。あとから足す中央のバブル・当たり判定・盤は
       すべてこの上に来るので、z-index も :not() も要らずに外れる（ぼかしも同じ理屈）。

       前は drag-layer の ::before で、pointer-events を持てなかった。
       そのため「外を触った」pointerdown がそのまま下のバブルへ届き、
       中央を解除しながら別のバブルが中央へ行っていた。実体のある要素にして塞ぐ。

       解除は pointerup で行う。pointerdown で消してしまうと、続く pointerup / click の
       当たり判定が下の要素に落ちる。down / up / click のすべてをここで止め切る。 */
    const veil = el('div', 'bub-veil');
    veil.setAttribute('role', 'button');
    veil.setAttribute('tabindex', '-1');
    veil.setAttribute('aria-label', '閉じる');
    const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
    veil.addEventListener('pointerdown', eat);
    veil.addEventListener('click', eat);
    veil.addEventListener('contextmenu', eat);
    veil.addEventListener('pointerup', ev => { eat(ev); cancelCenter(); });
    veil.addEventListener('pointercancel', ev => { eat(ev); cancelCenter(); });
    layerEl().appendChild(veil);

    /* 当たり判定は押した瞬間から中央に置く。動いている的を押させない。
       44×44 を下回らせない。 */
    const hd = Math.max(from.width, 44);
    const hit = el('div', 'bub-hit');
    hit.style.left = (cx - hd / 2) + 'px';
    hit.style.top = (cy - hd / 2) + 'px';
    hit.style.width = hd + 'px';
    hit.style.height = hd + 'px';
    hit.setAttribute('aria-hidden', 'true');
    layerEl().appendChild(hit);
    /* もう「もう一度タップ」では開かない。入口は盤の [まずは開始] だけ。
       ここは触られたことを吸うだけ（＝中央のバブルを触っても戻らない）。 */
    hit.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    const wasFocused = document.activeElement === node;
    takeNode(from);
    node.classList.add('is-centered');
    if (host && host.classList) host.classList.add('is-focusing');
    document.body.classList.add('is-focusing');

    /* 盤に出す「はじめた / 完了 / 消す」をどこから取るか。

       本筋は handlers.onActions(id, node) —— 盤のための専用の口。
       {onStarted, onComplete, onDelete, isDone} を返してもらうだけで、
       副作用は無い。画面側がこれを渡してくれれば、下の横取りは通らない。

       渡されていない画面のための後ろ盾が harvestActions。
       onMenu を呼んで openMenu を横取りし、handlers だけ抜く。
       これは中央へ寄せるたびに画面側の onMenu の中身を走らせてしまう
       （いまの4画面では closeMenu 相当で無害だが、脆い）。
       画面側が onActions を配線したら、この経路は使われなくなる。 */
    const actions = (typeof h.onActions === 'function')
      ? (harvestSafe(() => h.onActions(idOf(), node)) || null)
      : harvestActions(() => call('onMenu', idOf(), node));

    /* 押したら、中央を畳んでから走らせる（openMenu の closeMenu(); fn(); と同じ順）。
       完了・消すは画面の作り直しを呼ぶので、DOM を戻し切ってからでないと戻し先が消える。 */
    const runAction = (fn, key) => {
      /* 名前は畳む前に読む。畳むと node は元の場所へ返る（読めなくはならないが、
         画面の作り直しに巻き込まれることがある） */
      const nm = nameOfNode(node);
      cancelCenter(true, true);
      if (typeof fn !== 'function') return;
      /* 「消す」だけは一度聞く。中央を畳んでから聞くので、盤は残らない */
      if (key === 'onDelete') askDelete(nm, fn);
      else fn();
    };

    /* 中央の盤。バブルより後ろに足すので、覆い（.bub-veil）より上＝ぼけないし、触れる。
       盤そのものは pointer-events:none で、押せるのは中のボタンと入力欄だけ
       （盤の余白を押したら「外を触った」＝戻る、のままにするため）。 */
    const panel = buildCenterPanel(
      idOf(), node.getAttribute('aria-label') || '', accept, actions, runAction,
      tagInfoOf(node));
    layerEl().appendChild(panel.root);
    panel.place(cx, cy, from.width);

    /* 指で開いたなら、このタップが生む click を1つだけ捨てる。
       盤を組んだあとに張る（張る前に return する枝は無いが、順番を読みやすくするため） */
    eatOpeningClick(pt);

    /* 中央へ寄せる。rAF は隠れている間 発火しないので、reflow で開始位置を確定させる */
    const dx = cx - (from.left + from.width / 2);
    const dy = cy - (from.top + from.height / 2);
    void node.offsetWidth;
    const ms = RM.matches ? 0 : CENTER_MS;
    node.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.9,.3,1)` : '';
    node.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    /* 戻る条件はこれだけ。時間では戻さない。
       中央のバブル（当たり判定）と盤の中を触っている間は戻らない。
       覆いは自分で pointerup のときに解除するので、ここでは見送る（二重に呼ばない）。
       いまや覆いが面をすべて塞ぐので、ここへ来るのは覆いより上にあるもの
       ＝下タブ（z-index 70）だけ。タブで画面を移るときは解除してよい。
       ev.target は window のこともある（Node.contains に渡すと投げる）ので節を分ける */
    const onOutside = ev => {
      const t = ev.target;
      if (!center || !t || !t.nodeType) { cancelCenter(); return; }
      if (center.veil && center.veil.contains(t)) return;
      if (center.hit && center.hit.contains(t)) return;
      if (center.panel && center.panel.root.contains(t)) return;
      if (node.contains(t)) return;
      cancelCenter();
    };
    /* Escape は、まず盤に渡す。履歴が開いていれば履歴だけが閉じ、中央は残る
       （盤の中の一段を閉じただけで面から放り出されたら、居場所を見失う）。
       盤が「自分で処理した」と言わなければ、いままでどおり中央を閉じる。 */
    const onEsc = ev => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      if (center && center.panel && center.panel.handleEscape()) return;
      cancelCenter();
    };
    /* 画面が動いたら座標が狂うので戻す。ただし入力欄に文字を打っている最中は戻さない
       （端末のキーボードが出るときに resize が飛ぶ。打っている途中で閉じたら事故） */
    const onAway = () => {
      if (center && center.panel && center.panel.isTyping()) return;
      cancelCenter();
    };
    /* スクロールも同じ扱い。ただし盤の中のスクロール（履歴の面）は別物で、
       これで閉じてはいけない。scroll は overflow を持つ要素から window へ
       捕捉フェーズで上がってくるので、出どころが盤の中なら見送る。 */
    const onScroll = ev => {
      const t = ev && ev.target;
      if (t && t.nodeType && center && center.panel
        && center.panel.root.contains(t)) return;
      onAway();
    };
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onEsc, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('scroll', onScroll, true);

    /* cx / cy / d は、閉じたときに「その場で解放する」ための座標として持ち回す */
    center = {
      hit, veil, panel, host, wasFocused,
      onOutside, onEsc, onAway, onScroll, cx, cy, d: from.width,
    };

    /* キーボードで来たときだけ、盤の先頭へ移す（指のときは焦点を横取りしない）。
       時間で開く窓が無くなったので、鍵盤の経路はこのボタン1つに集約する。 */
    if (wasFocused) panel.focusFirst();
  }

  /* ---- 指 ---- */

  function onDown(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (center) return;                    /* 中央にいる間は hit 要素が受ける */
    ev.preventDefault();

    const startX = ev.clientX, startY = ev.clientY;
    const rect = node.getBoundingClientRect();
    const grabDX = startX - rect.left, grabDY = startY - rect.top;
    let moved = false, dragging = false, done = false;
    let tabs = null, hot = null;
    /* 手を離したときに勢いを載せるため、直近の指の軌跡を覚えておく */
    let track = [{ x: startX, y: startY, t: ev.timeStamp || performance.now() }];

    node.classList.add('is-held');          /* 押している間、膜がたわむ */

    /* 長押しではメニューを開かない。操作の入口は中央の盤ひとつ（追補：統合）。
       長く押してから動かせば、いままでどおりドラッグになる。 */

    function beginDrag() {
      dragging = true;
      node.classList.remove('is-held');
      node.classList.add('is-dragging');
      takeNode(rect);
      /* .drag-layer は z-index 60。タブバーはその下なので、ドラッグ中だけ持ち上げる
         （css/bubble.css の body.is-dragging .tabbar） */
      activeDrag = node;
      document.body.classList.add('is-dragging');
      tabs = tabButtons().map(btn => {
        const id = tabIdOf(btn);
        const ok = DROPPABLE.indexOf(id) >= 0;
        btn.classList.toggle('is-nodrop', !ok);
        return { btn, id, ok, rect: btn.getBoundingClientRect() };
      });
      call('onDragStart', idOf());
    }

    function hilite(x, y) {
      const t = tabAt(tabs, x, y);
      const next = (t && t.ok) ? t : null;
      if (next === hot) return;
      if (hot) hot.btn.classList.remove('is-drop');
      hot = next;
      if (hot) hot.btn.classList.add('is-drop');
    }

    function onMove(e) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const now = e.timeStamp || performance.now();
      track.push({ x: e.clientX, y: e.clientY, t: now });
      while (track.length > 2 && now - track[0].t > FLICK_WINDOW) track.shift();
      if (!moved && Math.hypot(dx, dy) > DRAG_PX) { moved = true; beginDrag(); }
      if (!dragging) return;
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      hilite(e.clientX, e.clientY);
      call('onDragMove', idOf(), {
        x: e.clientX, y: e.clientY,
        left: rect.left + dx, top: rect.top + dy,
      });
    }

    function onUp(e) {
      if (done) return;
      done = true; cleanup();

      if (!moved) {                                  /* タップ */
        startCenter({ x: e.clientX, y: e.clientY });
        return;
      }

      const x = e.clientX, y = e.clientY;
      const t = tabAt(tabs || [], x, y);
      const droppedTo = (t && t.ok) ? t.id : null;

      /* 直前 FLICK_WINDOW ミリ秒の平均速度を、そのまま初速にする（＝投げた勢いが乗る） */
      const now = e.timeStamp || performance.now();
      const tail = track[0];
      const ms = now - tail.t;
      let vx = 0, vy = 0;
      if (ms > 8) {
        vx = (x - tail.x) / ms * 1000;
        vy = (y - tail.y) / ms * 1000;
        const sp = Math.hypot(vx, vy);
        if (sp > FLICK_MAX) { vx *= FLICK_MAX / sp; vy *= FLICK_MAX / sp; }
      }

      endDrag();
      const id = idOf();
      giveBack();
      call('onDragEnd', id, {
        reason: 'drag', droppedTo,
        x, y, left: x - grabDX, top: y - grabDY, vx, vy,
      });
      call('onHold', id, false);
      if (droppedTo) call('onDropToTab', id, droppedTo);
    }

    function endDrag() {
      node.classList.remove('is-dragging');
      if (activeDrag === node) { activeDrag = null; document.body.classList.remove('is-dragging'); }
      if (tabs) tabs.forEach(t => { t.btn.classList.remove('is-drop'); t.btn.classList.remove('is-nodrop'); });
      hot = null;
    }

    function cleanup() {
      node.classList.remove('is-held');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragging && !done) endDrag();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /* キーボードでも同じ経路を通す。Enter/Space が指のタップにあたる */
  function onKey(ev) {
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10') || ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault();
      call('onMenu', idOf(), node);
      return;
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      /* 既に中央にいるなら、盤の先頭（[まずは開始]）へ移すだけ。
         ここで開いてしまうと入口が2つになる（入口はボタン1つ） */
      if (center) { if (center.panel) center.panel.focusFirst(); }
      else startCenter();
    }
  }

  function onCtx(ev) {
    ev.preventDefault();
    call('onMenu', idOf(), node);
  }

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('keydown', onKey);
  node.addEventListener('contextmenu', onCtx);

  return function detach() {
    /* 畳むときは必ず元の場所へ返す。物理側へ座標を投げ返しても受け手が居ない */
    cancelCenter(true, true);
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('keydown', onKey);
    node.removeEventListener('contextmenu', onCtx);
    if (activeDrag === node) { activeDrag = null; document.body.classList.remove('is-dragging'); }
  };
}

/* ---------------- メニュー ----------------

   長押しからは開かなくなった。いま開くのは鍵盤の経路だけ
   （ContextMenu / Shift+F10 / m、右クリックの contextmenu）。
   画面側の呼び方は変わらないので、そのまま残してある。 */

/* 全画面共通の5項目。順番は契約どおり固定。 */
const MENU_ITEMS = [
  { key: 'onDetail',   label: '詳細' },
  { key: 'onFocus',    label: '5分だけ集中' },
  /* 盤の [今日は終わり] と同じ操作なので、同じ言葉にする */
  { key: 'onStarted',  label: '今日は終わり' },
  /* 盤と同じ「タスク完了」に。となりに「今日は終わり」が並ぶので、
     どちらが重いほうかが名前で読めないと取り違える */
  { key: 'onComplete', label: 'タスク完了' },
  { key: 'onDelete',   label: '消す', sep: true },
];

let openState = null;   /* 同時にひとつだけ */

export function openMenu(node, handlers = {}) {
  /* 中央の盤を組み立てている最中は、メニューを出さずに handlers だけ受け取る。
     画面側は「onMenu で openMenu を呼ぶ」ままでよい（harvestActions を見よ）。 */
  if (harvest) {
    harvest.got = handlers || {};
    return function noop() {};
  }
  /* ContextMenu キーと contextmenu イベントの両方が来ることがあるので、二重に開かない */
  if (openState && openState.anchor === node) return closeMenu;
  closeMenu();

  const box = el('div', 'bub-menu bmenu');
  box.setAttribute('role', 'menu');
  const label = (node.getAttribute('aria-label') || '').split('（')[0];
  box.setAttribute('aria-label', label + ' の操作');

  MENU_ITEMS.forEach(spec => {
    const btn = el('button', 'mi mi-' + spec.key.slice(2).toLowerCase() + (spec.sep ? ' mi-sep' : ''));
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    const tx = el('span', 'mi-tx');
    /* 完了したものの上では「タスク完了」ではなく「海にもどす」。
       完了の海から戻す道が、ここにしか無いため。
       画面側が handlers.isDone を渡してくれたときだけ入れ替える。 */
    const done = (spec.key === 'onComplete') && handlers.isDone === true;
    tx.textContent = done ? '海にもどす' : spec.label;
    btn.appendChild(tx);
    btn.addEventListener('click', () => {
      const fn = handlers[spec.key];
      closeMenu();
      if (typeof fn !== 'function') return;
      /* 盤と同じで、「消す」だけは一度聞く */
      if (spec.key === 'onDelete') askDelete(nameOfNode(node), fn);
      else fn();
    });
    box.appendChild(btn);
  });

  /* 上下で動ける。閉じるのは Escape */
  box.addEventListener('keydown', ev => {
    const items = [...box.querySelectorAll('.mi')];
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = (i + (ev.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length;
      items[next].focus();
    }
  });

  /* メニューの外を触ったら閉じる。バブルの上なら、その操作は起こさせない（＝閉じるだけ） */
  const onOutside = ev => {
    const t = ev.target;
    if (t && t.nodeType && box.contains(t)) return;
    if (t && t.closest && t.closest('.bub')) { ev.preventDefault(); ev.stopPropagation(); }
    closeMenu();
  };
  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault(); ev.stopPropagation();
    closeMenu(true);
  };
  const onAway = () => closeMenu();

  window.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onAway);
  window.addEventListener('scroll', onAway, true);

  openState = { anchor: node, box, onOutside, onKey, onAway };
  layerEl().appendChild(box);
  placeMenu(box, node.getBoundingClientRect());
  const first = box.querySelector('.mi');
  if (first) first.focus({ preventScroll: true });
  return closeMenu;
}

/* バブルの近くに出す。画面からはみ出しそうなら、上に返してから端に寄せる */
function placeMenu(box, rect) {
  const M = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = box.offsetWidth, mh = box.offsetHeight;
  let y = rect.bottom + 6;
  if (y + mh > vh - M) y = rect.top - 6 - mh;
  box.style.left = clamp(rect.left + rect.width / 2 - mw / 2, M, Math.max(M, vw - mw - M)) + 'px';
  box.style.top = clamp(y, M, Math.max(M, vh - mh - M)) + 'px';
}

export function closeMenu(restoreFocus) {
  if (!openState) return;
  const m = openState;
  openState = null;
  window.removeEventListener('pointerdown', m.onOutside, true);
  window.removeEventListener('keydown', m.onKey, true);
  window.removeEventListener('resize', m.onAway);
  window.removeEventListener('scroll', m.onAway, true);
  m.box.remove();
  if (restoreFocus && m.anchor && m.anchor.isConnected) m.anchor.focus({ preventScroll: true });
}

export function isMenuOpen() { return !!openState; }
