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

import { el, clamp, fromFeedback, toast } from './ui.js';
import { playSfx } from './sound.js';
import { QUADRANTS, quadrantFor, SIZES, DUE_KINDS } from './priority.js';
import { askFull, askWithSearchFull, hasKey } from './ai.js';
import { aiOn } from './edition.js';
import { buildResearchPrompt, buildTidyPrompt, buildNamePrompt, cleanName, applyName, cleanText, appendSection, lostUrls, failLine,
  buildAskPrompt, parseAskReply, askSectionText, leadDay, relatedDetail, ASK_MAX, DEADLINE_LEAD } from './research.js';
import { spanFromDetail, withSpan } from './deadline.js';
import { loadPrefs, BOARD_PART_LABEL } from './prefs.js';
import { monthCal, monthOf } from './monthcal.js';
import { normalizeRepeat, upcoming, nextDay, addDays, repeatLabel, mdw, dowOf, nthOf, nthLabel, DOW_NAMES } from './repeat.js';

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
   日が変わると戻る（契約 §5）。だから名前もそう呼ぶ。
   **記録している中身は変えていない。**ふりかえりの内訳は「はじめた」のまま
   （あちらは操作の名前ではなく、記録の名前。README の憲章がその言葉を使っている）。 */
const DONE_LB = '今日は終わり';
/* 完了（store の done）。着手の「今日は終わり」とは別のこと。
   読み上げで両者が同じ言葉になると、達成したのか手を付けただけなのか分からなくなる。
   **文字列は store の done タグの名前とそろえてある**（あの名前は変えられない）。
   そろえておくと、タグ名が渡ってきている画面では二重に読まずに済む。 */
const COMPLETED_LB = '完了';

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

/* 長い文を札に出すときの丸め。文字数は書記素ではなくコード点で数える
   （絵文字を割らないための Array.from。既存の trim と同じやり方） */
/* 作業記録の 1 行目（2026-11-19）。記録の next（次にやること）に入れる。空なら '' */
function firstLineOf(t) {
  return String(t == null ? '' : t).split('\n').map(x => x.trim()).find(Boolean) || '';
}
/* 作業記録の欄から積んだ記録か（did の 1 行目が next と同じ）。それなら 1 つの文として出す */
function isRecordStep(s) {
  return !!s && !!String(s.did || '').trim() && firstLineOf(s.did) === String(s.next || '').trim();
}

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
/* ひとこと（Issue #25）の書きかけ。泡の id → 文。盤を閉じても残す（記録には入れない） */
const noteDrafts = new Map();
export function setCenterHandler(a) {
  centerAdapter = (a && typeof a === 'object') ? a : null;
}

/* 端末の今日（YYYY-MM-DD）。預け先が todayKey を返さない版の控え */
function localDay() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 長い知らせ（2026-11-16 Issue #68 の返事「TODOの同期失敗時のメッセージが長すぎて表示しきれてない」）。
   画面の下には最初の 1 文（括弧の前まで・長くても 40 字）だけを出し、残りは［詳しく］で全文を出す。長いときは少し長く出しておく */
const TOAST_SHORT = 40;
function shortLine(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const cut = t.search(/[（(。]/);
  const head = cut > 0 ? t.slice(0, cut) : t;
  return head.length > TOAST_SHORT ? head.slice(0, TOAST_SHORT - 1) + '…' : head;
}
function longToast(prefix, msg) {
  const full = String(msg || '');
  const head = shortLine(full);
  if (head === full.replace(/\s+/g, ' ').trim()) { toast(prefix + full); return; }
  toast(prefix + head, { label: '詳しく', undo: false, on: () => { window.alert(prefix + full); } }, 9000);
}

/* 同期・読み込みが走っている数。0 より大きい間は、外を押した・画面の大きさが変わった、で盤を閉じない（Issue #68） */
let holdOpen = 0;
function holdWhile(p) {
  if (!p || typeof p.then !== 'function') return p;
  holdOpen++;
  const done = () => { setTimeout(() => { holdOpen = Math.max(0, holdOpen - 1); }, 600); };
  p.then(done, done);
  return p;
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

/* 盤の本文の下に並べる、ひとことの新しい件数（Issue #61）。
   buildCenterPanel の中の const にすると、盤を組む途中（syncNotesBtn）で宣言より先に読まれて
   ReferenceError になり、盤が組めずに画面が固まった（Issue #63）。だから外に置く */
const CHAT_SHOW = 3;

/* 字を打つ欄か（Issue #70。js/boot-dvh.js の isEditable と同じ線引き）。盤の isTyping が使う */
function isEditableEl(t) {
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  if (t.tagName !== 'INPUT') return false;
  return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(t.type || '');
}
/* 欄から焦点が外れたあと、画面の揺れで盤を閉じない間（キーボードが引っ込み、ページが戻るまで） */
const TYPED_GRACE_MS = 1500;

/* 盤の外の欄で字を打っている最中に泡を開くとき（2026-11-21 Issue #85「文字入力中にTODOをタップすると画面表示がおかしくなる」）。
   iPhone では、海の下の入力欄に焦点があるまま泡を触っても、焦点は外れずキーボードは出たまま。
   そのまま盤を開くと、盤と中央の泡は「キーボードで縮んだ見えている所」（html.kb-open。js/boot-dvh.js）の座標で置かれ、
   あとでキーボードが引っ込むと枠だけが元の高さへ戻り、盤と泡がずれて残っていた
   （盤は「打っている最中」とみなして、画面の揺れでは閉じないため）。
   そこで、先に欄の焦点を外してキーボードを引っ込め、枠が戻り切ってから開く。 */
const KB_SETTLE_MAX_MS = 900;   /* キーボードが引っ込むのを待つ上限。来なくてもこれで開く */
function blurOutsideField(node) {
  const ae = document.activeElement;
  if (!ae || !isEditableEl(ae) || (node && node.contains(ae))) return false;
  try { ae.blur(); } catch (e) { /* 外せなくても開く */ }
  return true;
}
function whenKeyboardGone(fn) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const t0 = Date.now();
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    if (vv) vv.removeEventListener('resize', check);
    clearInterval(tm);
    /* 枠が元の高さに組み直されてから測る */
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };
  function check() {
    if (!root.classList.contains('kb-open') || Date.now() - t0 > KB_SETTLE_MAX_MS) go();
  }
  if (vv) vv.addEventListener('resize', check);
  const tm = setInterval(check, 50);
  check();
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
function ariaFor(item, names, marks, started, done) {
  const tags = names.length ? names : marks.map(m => MARK_LABEL[m]).filter(Boolean);
  return String(item.text || '')
    + (tags.length ? '・' + tags.join('・') : '')
    /* 完了を読むのは、タグ名として**まだ読んでいないときだけ**。
       今日の画面はタグ名を渡してくるので、そこには既に「完了」が入っている
       ——足すと「完了・完了」になる。渡してこない画面のための後ろ盾。 */
    + (done && tags.indexOf(COMPLETED_LB) < 0 ? '・' + COMPLETED_LB : '')
    /* 完了しているなら着手の印は読まない。完了のほうが後の出来事なので、
       両方読むと「完了・今日は終わり」と、順番まで逆に聞こえる */
    + (started && !done ? '・' + DONE_LB : '')
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

  /* ---- 完了（利用者の指示 2026-09-18）----
     完了しても日付の水面からは消さなくなった。消すと「今日なにを達成したか」が
     残らないため。代わりに**達成したと読める見た目**を付ける。
     祝祭にはしない（§0）——印を1つ足して、静かに落ち着かせるだけ。
     見た目は css/bubble.css の .bub.is-done が持つ。
     item.done を渡さない画面（海・きっかけ・すきま）では false のまま
     ＝ 何も変わらない。 */
  const done = !!(item && item.done);
  node.classList.toggle('is-done', done);

  /* ---- タグの名前 ----
     色だけでは、色を見分けられない人にタグが伝わらない（WCAG 1.4.1）。
     バブルは小さく、文字を足すと本文が読めなくなるので、名前は
     読み上げ文（ここ）と中央の盤（buildCenterPanel）に載せる。
     渡されていない画面では、旧 marks のラベルで代用する。 */
  const names = tagNames(
    Array.isArray(opts.tagNames) ? opts.tagNames : (item && item.tagNames));
  tagMeta.set(node, { names, colors });

  const marks = Array.isArray(opts.marks) ? opts.marks.slice(0, 3) : [];
  /* ---- 優先度の区分（利用者の指示 2026-10-25）----
     割り振った泡だけ、右上に区分の色の小さな点。大きさも漂い方も変えない（海を乱さない）。
     色は css の --q-<鍵>。色だけに頼らないよう、読み上げ文にも区分の名前を足す。
     item に urgent / important が無い画面（渡さない版）では点を出さない。 */
  const q = item ? quadrantFor(item.urgent, item.important) : null;
  let qdot = node.querySelector(':scope > .wob > .qdot');
  if (q && !qdot) {
    qdot = el('span', 'qdot');
    qdot.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(qdot);
  }
  if (q) node.dataset.q = q; else delete node.dataset.q;
  if (qdot) qdot.hidden = !q;
  /* ---- 新しいひとこと（Issue #25）----
     ほかの端末が書いた、まだこの端末で開いていないひとことがある泡に、左上の小さな点。
     数は出さない。預け先に hasNewNote が無い版では出ない（Issue #61 から個人の海でも出す。自分のほかの端末が書いたもの） */
  const fresh = !!(item && ask(centerAdapter, 'hasNewNote', item.id) === true);
  let ndot = node.querySelector(':scope > .wob > .ndot');
  if (fresh && !ndot) {
    ndot = el('span', 'ndot');
    ndot.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(ndot);
  }
  if (ndot) ndot.hidden = !fresh;
  /* ---- 期間の外の添え字（共有の記録 v1.5 §11）----
     期間の外なので長期保留の海にいる泡の下端に「11/20 から」「期間を過ぎた」と小さく。
     赤にも「期限切れ」にもしない。item.spanNote が無い画面では出ない */
  const spanNote = (item && typeof item.spanNote === 'string') ? item.spanNote : '';
  let snote = node.querySelector(':scope > .wob > .snote');
  if (spanNote && !snote) {
    snote = el('span', 'snote');
    snote.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(snote);
  }
  if (snote) { snote.textContent = spanNote; snote.hidden = !spanNote; }
  /* ---- 見当と外の約束の添え字・大事な泡の太い縁（2026-11-24。今日の水面だけ。モック mock/choose-1124.html の 2）----
     item.knote（「さっと・外の約束」など）を泡の下端に小さく。item.heavy なら縁を太く（is-heavy）。
     渡さない画面（海など）では何も変わらない（海は今までどおり区分の色の点だけ） */
  const kNote = (item && typeof item.knote === 'string') ? item.knote : '';
  let knote = node.querySelector(':scope > .wob > .knote');
  if (kNote && !knote) {
    knote = el('span', 'knote');
    knote.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(knote);
  }
  if (knote) { knote.textContent = kNote; knote.hidden = !kNote; }
  node.classList.toggle('is-heavy', !!(item && item.heavy));
  /* 今日大事なこと・先に済ませるの泡（Issue #96。2026-11-24）。形はそのまま、色で見分ける。今日の水面だけが渡す */
  const pin = item && (item.pin === 'key' || item.pin === 'first') ? item.pin : '';
  node.classList.toggle('is-pin-key', pin === 'key');
  node.classList.toggle('is-pin-first', pin === 'first');
  /* 上の端に小さく「★ 大事」「↑ 先に」（Issue #96 の 3 回目の返事「大事文字表示の追加と…色に変わる」。色は今日の画面の魚と同じ）。
     読み上げは aria-label のほうに足す（下の ariaFor のあと） */
  const pinText = pin === 'key' ? '★ 大事' : pin === 'first' ? '↑ 先に' : '';
  let pinlb = node.querySelector(':scope > .wob > .pinlb');
  if (pinText && !pinlb) {
    pinlb = el('span', 'pinlb');
    pinlb.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(pinlb);
  }
  if (pinlb) { pinlb.textContent = pinText; pinlb.hidden = !pinText; }
  /* ---- 輝く泡（2026-11-24。js/glow.js）----
     item.lit なら光の輪と光の粒（.glow。泡の後ろ）。渡さない画面では何も変わらない */
  const lit = !!(item && item.lit);
  let glow = node.querySelector(':scope > .glow');
  if (lit && !glow) {
    glow = el('span', 'glow');
    glow.setAttribute('aria-hidden', 'true');
    glow.appendChild(el('span', 'glow-mote'));   /* 粒は 1 つだけ（非常に弱い報酬） */
    node.insertBefore(glow, node.firstChild);
  }
  if (glow) glow.hidden = !lit;
  node.classList.toggle('is-lit', lit);
  /* ---- 担当（共有の記録 v1.2。2026-11-18）----
     共有の海の泡に、担当の人の名前の頭 1 字を右下の小さな丸に。自分が担当なら縁を太くする（is-mine）。
     終えた泡には、終えた人の頭 1 字に ✓。預け先に whoMark が無い版・共有でない海では出ない */
  const who = item ? ask(centerAdapter, 'whoMark', item) : null;
  const whoText = (who && typeof who.text === 'string') ? who.text : '';
  let wdot = node.querySelector(':scope > .wob > .who');
  if (whoText && !wdot) {
    wdot = el('span', 'who');
    wdot.setAttribute('aria-hidden', 'true');
    const wob = node.querySelector(':scope > .wob');
    if (wob) wob.appendChild(wdot);
  }
  if (wdot) { wdot.textContent = whoText; wdot.hidden = !whoText; }
  node.classList.toggle('is-mine', !!(who && who.mine));
  let label = ariaFor(item, names, marks, started, done);
  if (who && who.label) label += '、' + who.label;
  if (spanNote) label += '、' + spanNote;
  if (kNote) label += '、' + kNote;
  if (fresh) label += '、新しいひとことあり';
  if (lit) label += '、輝いている';
  if (pin) label += pin === 'key' ? '、今日大事なこと' : '、先に済ませる';
  node.setAttribute('aria-label', q ? label + '、区分: ' + QUADRANTS[q].name : label);
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
  /* 2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」（モック docs/spec/mock/task-start.html）:
       [ 始める（5 分のタイマー） ]
       [ 今日はここまで ][ ✓ 完了にする ]
       （削除は「その他」の最後。arrangeBoard が移す）
     ［書き留める］は外した。打ち終えた欄から自動で保存し、盤の右下に「保存した」と出す（buildCenterPanel の autosave）。
     言葉: タスク開始 → 始める、今日は終わり → 今日はここまで、タスク完了 → 完了にする、消す → 削除 */
  if (canStart) {
    const st = el('button', 'bc-act bc-act-start');
    st.type = 'button';
    st.dataset.part = 'start';
    st.appendChild(el('span', 'bc-act-main', '始める'));
    st.appendChild(el('span', 'bc-act-sub', '5 分のタイマー'));
    st.setAttribute('aria-label', '始める（5 分のタイマーを開く）');
    st.addEventListener('click', ev => { ev.preventDefault(); onStart(); });
    box.appendChild(st);
  }
  /* part: 設定の「盤にはじめから出す欄」で選ぶときの名前（Issue #49 の返事。js/prefs.js の BOARD_PARTS） */
  const mk = (cls, label, key, part) => {
    const b = el('button', 'bc-act ' + cls);
    b.type = 'button';
    b.dataset.part = part;
    b.textContent = label;                   /* innerHTML には入れない */
    b.addEventListener('click', ev => { ev.preventDefault(); run(a[key], key); });
    return b;
  };

  /* 「今日はここまで」は、着手の印（store.start）。押すと泡が薄くなり、日が変わると戻る（契約 §5）。中身は前と同じ */
  const top = el('div', 'bc-act-row');
  if (has('onStarted')) top.appendChild(mk('bc-act-started', '今日はここまで', 'onStarted', 'ended'));
  /* 完了したものの上では「完了にする」ではなく「海にもどす」。openMenu と同じ入れ替え。
     戻した先が海でない画面（今日の水面）は a.reopenLabel で名前を渡す（Issue #29） */
  if (has('onComplete')) {
    top.appendChild(mk('bc-act-done',
      a.isDone === true ? (a.reopenLabel || '海にもどす') : '✓ 完了にする', 'onComplete', 'done'));
  }
  if (top.childNodes.length) box.appendChild(top);
  if (has('onDelete')) box.appendChild(mk('bc-act-del', '削除', 'onDelete', 'del'));
  void canOk;   /* onOk（前の［書き留める］）は受けるが、ボタンは作らない */
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

/* 盤の「その他」を開いているか（Issue #40）。盤の外で持つ。
   2026-11-13 Issue #49 の返事で、盤を閉じたら（cancelCenter）畳んだ姿へ戻すようにした。開いたままにするのは、その盤を開いている間だけ */
let boardExtraOpen = false;

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
  box.dataset.screen = 'board.delete'; box.dataset.screenLayer = '7';

  const ttl = el('p', 'ask-title');
  ttl.id = 'ask-t' + seq;
  /* 名前はユーザーが打った文字。innerHTML には入れない */
  ttl.textContent = name ? '「' + name + '」を削除する？' : 'これを削除する？';   /* 2026-11-18 消す → 削除 */
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
  yes.textContent = '削除';
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
    if (fromFeedback(ev)) return;          /* 右上の ! の欄を打っている */
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
       名前      [編集できる]
       本文      [入口]          ← 押すと別の面で書く（Issue #8）
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
  let saveFav = null;           /* お気に入りの印（F7）も同じく閉じるとき */
  let saveWho = null;           /* 担当（共有の記録 v1.2）も同じく閉じるとき */
  let savePrio = null;          /* 優先度（急ぐ・大事）も同じく閉じるとき */
  let saveHoldUntil = null;     /* 長期保留の「戻ってくる日」も同じく閉じるとき */
  /* 「今日」の札と、カレンダーの今日の枡は同じものを指す。
     二重に書かないよう、書き込みはカレンダー側が持ち、札は見た目だけ合わせる */
  let todayCell = null;
  let saveDays = null;
  let moveRepDay = null;        /* くりかえしの下書きで、やる日の回の日を入れ替える（2026-11-19） */
  let saveRepeat = null;        /* くりかえしも閉じるときに書く（2026-11-19） */
  let clearSpan = null;         /* 期間を未定にする（期間の外の案内の［期間を未定にする］から。2026-11-23） */
  let saveSpan = null;          /* 期間も閉じるときに書く（2026-11-19。暦で開始日・終了日を続けて選ぶため） */          /* 日の入り切りも閉じるときにまとめて書く */
  let syncTodayChip = null;     /* カレンダーが「今日」の札の見た目を合わせる */
  const root = el('div', 'bub-center');
  root.setAttribute('role', 'group');
  root.dataset.screen = 'board'; root.dataset.screenLayer = '4';   /* 中央の盤 */
  root.setAttribute('aria-label', (ariaLabel.split('（')[0] || '') + ' の操作');
  /* 盤の中の字を打つ欄から焦点が外れた時刻（Issue #70）。
     キーボードが引っ込むときも、見えている所の大きさが変わり、ページが元の位置へ戻る（scroll が飛ぶ）。
     焦点が外れた直後のそれで盤を閉じないよう、少しの間は「打っている最中」とみなす */
  let typedAt = 0;
  root.addEventListener('focusout', ev => { if (isEditableEl(ev.target)) typedAt = Date.now(); });


  const a = centerAdapter;
  let fields = null, stepIn = null, urlIn = null;
  let nameIn = null;            /* 名前（本文）。閉じるとき／[書き留める] のときに書く */
  /* 作業メモは盤に入力欄を持たない。入口のボタンと、別の面と、その中身 */
  let memoBtn = null, memoPane = null, memoArea = null, memoSaid = null;
  let memoDraft = '';
  /* 本文（Issue #8）も入口と別の面。作業メモと違い、記録には積まず、閉じるときに書き替える */
  let detailBtn = null, detailPane = null, detailArea = null;
  let detailView = null, detailEdit = null, detailNote = null;   /* 読む面と [編集]（Issue #16） */
  let detailClose = null, detailSave = null, detailCancel = null; /* 書く面の [保存]／[キャンセル]（Issue #35） */
  let detailDraft = '';
  let detailInline = null;      /* 盤のその場の作業記録の欄（2026-11-18。11-19 にメモ → 作業記録） */
  let dhead = null;             /* 作業記録の見出しの行（［履歴を見る ›］［全体を開く ›］を置く） */
  let rec0 = '';                /* 最後に書いた作業記録（変わったときだけ書き、記録に積む） */
  /* 2026-11-19: 次の一手・作業の記録（作業メモ）の欄は盤に出さない（作業記録 1 つにまとめた）。
     欄は組むが置かない。置かない間は、次の一手・書きかけを盤から書かない（作業記録の側が書く） */
  const stepOnBoard = false;
  let detailBase = '';          /* 書く面に入った時点の本文。[キャンセル] でここへ戻す */
  let syncSpanRow = null;       /* 盤の「期間」（Issue #34）。本文が変わったら読み直す */
  /* ひとこと（Issue #25）。入口と別の面。[書く] で1件ずつ積む（書き換えない） */
  let notesBtn = null, notesPane = null, notesList = null;   /* 面は前のものを読むだけ（Issue #70 の返事） */
  let chatList = null, chatIn = null;   /* 本文の下のチャットの形（Issue #61） */
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

  /* ---- はじめから出す欄（Issue #49）----
     設定の「この端末の表示」で選んだ欄だけを出し、ほかは下の「その他」に畳む（.is-extra）。
     選んでいなくても、中身が入っている欄（has）は畳まない——書いてあることが見えなくなるため。
     盤を開くたびに読む（盤は書くたびに組み直されるので、設定を変えれば次に開いたときから効く） */
  const boardShow = new Set(loadPrefs().boardShow || []);
  const foldPart = (node, part, has) => {
    if (!node) return;
    node.dataset.part = part;
    if (!has && !boardShow.has(part)) node.classList.add('is-extra');
  };
  /* 下のボタン（タスク開始・今日は終わり・書き留める・タスク完了・消す）も選べる（Issue #49 の返事）。
     ボタンは actionRow が data-part を付けて作る。完了した泡の「海にもどす」も done として扱う */
  if (acts) acts.querySelectorAll('[data-part]').forEach(b => foldPart(b, b.dataset.part, false));

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
  /* ---- 名前（本文）を変える（利用者の指示 2026-10-12）----
     盤の先頭に1行。打っている途中では書かない——書くと店が emit して泡の直径が
     測り直され、中央の泡が揺れる。閉じるとき（flush）と [書き留める]（applyEdits）で書く。
     空にして閉じても消えない（store.setText が空を弾く＝元の名前のまま）。
     預け先に setText が無い版では出さない。 */
  if (fields && typeof (a || {}).setText === 'function') {
    /* 2026-11-18（モック task-start.html）: 見出しの字は出さず、盤の題としてそのまま直せる形に。
       お気に入り・優先度は「その他」へ移したので、付いていれば名前の横に ☆・◷・◆ を出す（arrangeBoard） */
    const wrap = el('label', 'bc-row bc-name-row');
    const lb = el('span', 'bc-lb bc-vh');
    lb.textContent = '名前';
    nameIn = el('input', 'bc-in bc-name-in');
    nameIn.type = 'text';
    nameIn.autocomplete = 'off';
    nameIn.enterKeyHint = 'done';
    nameIn.value = String(ask(a, 'text', id) || '');
    nameIn.setAttribute('aria-label', '名前');
    wrap.appendChild(lb);
    wrap.appendChild(nameIn);
    foldPart(wrap, 'name', false);      /* 名前は泡そのものに出ている */
    fields.appendChild(wrap);
  }

  /* ---- 本文（Issue #8）----
     名前は泡に出る短い呼び名（泡では18字で切れる）。何を・どこで・条件のような
     **変わらない説明**を書く場所が無く、名前に詰めるか、作業メモ（積む記録）に
     書くしかなかった。そのための欄。
     ・書くのは任意。思いつきを吐き出す入口（海の入力欄）には足さない
     ・盤には入口だけ（作業メモと同じ。長くなるものは盤を押し広げない）
     ・記録には積まない。閉じるとき（面の [閉じる]・盤を閉じる・[OK]）に書き替える
     預け先に setDetail が無い版では出さない。 */
  if (fields && typeof (a || {}).setDetail === 'function') {
    /* 2026-11-19 ユーザーの指示「次の一手、メモ、作業記録を作業記録（ただし今のメモの位置）に一つにして、履歴が確認できる様にして」:
       欄は 1 つ（作業記録）。中身は本文（detail）に持ち、書き替えるたびに記録（steps）へ 1 件積む（saveDetail）。
       本文が空で次の一手だけある前の泡は、次の一手を初めの中身として出す（触らなければ書かない） */
    detailDraft = String(ask(a, 'detail', id) || '') || String(ask(a, 'firstStep', id) || '');
    rec0 = detailDraft;
    /* 2026-11-18（モック task-start.html）: 別の面を開かず、その場の欄で書く。
       長い中身・リンクの読み・AI は、今までの面（［全体を開く ›］）で */
    const drow = el('div', 'bc-row bc-stack');
    dhead = el('div', 'bc-lb-row');
    dhead.appendChild(el('span', 'bc-lb', '作業記録'));
    detailBtn = el('button', 'bc-detail-open bc-link-btn');
    detailBtn.type = 'button';
    detailBtn.addEventListener('click', ev => { ev.preventDefault(); openDetail(); });
    dhead.appendChild(detailBtn);
    drow.appendChild(dhead);
    detailInline = el('textarea', 'bc-in bc-memo-in');
    detailInline.rows = 3;
    detailInline.placeholder = '例 予約の電話をかける。保険証を持っていく';
    detailInline.setAttribute('aria-label', '作業記録');
    detailInline.value = detailDraft;
    detailInline.addEventListener('input', () => { detailDraft = detailInline.value; if (syncSpanRow) syncSpanRow(); });
    drow.appendChild(detailInline);
    foldPart(drow, 'detail', !!detailDraft.trim());
    fields.appendChild(drow);
    syncDetailBtn();
  }

  /* ---- ひとこと（Issue #25）----
     共同 TODO で「ここまでやった」「詰まっている」を、本文を書き換えずに残す短い書き込み。
     誰が・いつ書いたかが残り、ほかの人の書いたものを上書きしない。
     2026-11-14 Issue #61 の返事（おすすめ・消さない・個人の海でも出す）: 本文のすぐ下に、
     チャットの形で新しい 3 件を並べ（自分の端末で書いたものは右、ほかは左）、その下の 1 行の欄と [送る] で積む。
     消すボタンは置かない（書いたものは変えられないし消せない）。個人の海でも出す（UI をそろえる）。
     全部の履歴と名前の欄は、行の右のボタン（前のものも見る）で開く面（今までの面）。預け先に addNote が無い版では出さない */
  if (fields && typeof (a || {}).addNote === 'function' && ask(a, 'notesOn') === true) {
    const nwrap = el('div', 'bc-chat');
    const nrow = el('div', 'bc-row');
    nrow.appendChild(el('span', 'bc-lb', 'コメント'));   /* 2026-11-18 ひとこと → コメント（仲間と泡ごとに話す欄） */
    notesBtn = el('button', 'bc-memo-open bc-notes-open');
    notesBtn.type = 'button';
    notesBtn.addEventListener('click', ev => { ev.preventDefault(); openNotes(); });
    nrow.appendChild(notesBtn);
    nwrap.appendChild(nrow);
    chatList = el('ul', 'bn-chat');
    chatList.setAttribute('aria-label', 'コメント（新しい 3 件。古い順）');
    nwrap.appendChild(chatList);
    const qrow = el('div', 'bn-quick');
    chatIn = el('input', 'bn-quick-in');
    chatIn.type = 'text';
    chatIn.autocomplete = 'off';
    chatIn.maxLength = 280;
    chatIn.placeholder = 'コメントを書く';   /* 2026-11-18。「あとから直せない」は欄の下に小さく出す（430px で切れていた） */
    chatIn.setAttribute('aria-label', 'コメントを書く（あとから直せない・消せない）');
    chatIn.value = noteDrafts.get(id) || '';
    chatIn.addEventListener('input', () => { noteDrafts.set(id, chatIn.value); });
    const qsend = el('button', 'bn-quick-send', '投稿');   /* 2026-11-18 送る → 投稿 */
    qsend.type = 'button';
    let qback = 0;
    const showSaid = (said) => {
      clearTimeout(qback);
      qsend.textContent = said;
      qsend.classList.toggle('is-nope', said !== '投稿した' && said !== '署名中…');
      if (said !== '署名中…') qback = setTimeout(() => { qsend.textContent = '投稿'; qsend.classList.remove('is-nope'); }, 1400);
    };
    const quickSend = () => { showSaid(sendQuick(showSaid)); };
    qsend.addEventListener('click', ev => { ev.preventDefault(); quickSend(); });
    chatIn.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.isComposing && !ev.shiftKey) { ev.preventDefault(); quickSend(); }
    });
    qrow.appendChild(chatIn);
    qrow.appendChild(qsend);
    /* 同期（2026-11-15 Issue #68 の返事「同期ボタンは、盤（TODO）のひとことの『送る』の横にも」→「こっちにも」）。
       ブロックチェーンで共有している海だけ。設定の「同期する」と同じ（取り込み・新しい書き込みがあれば送る）。
       押した手の続きで鍵を開ける（パスキー）ので、呼ぶ前に await しない */
    if (ask(a, 'shareSyncOn') === true) {
      /* 直につながっていれば、ボタンに印（⇄）を付ける（Issue #68 の返事「動いてないように見える」） */
      const dc = Number(ask(a, 'directCount')) || 0;
      const qsync = el('button', 'bn-quick-send bn-quick-sync', dc ? '同期 ⇄' + dc : '同期');
      qsync.type = 'button';
      qsync.title = 'みんなの変更を取り込み、この端末に新しい書き込みがあれば送る（送るときは手数料が掛かる）'
        + (dc ? '。いま ' + dc + ' 台と直につながっていて、ひとことは送るとすぐ届く' : '。直につながっている相手はいない');
      let syncBack = 0;
      qsync.addEventListener('click', ev => {
        ev.preventDefault();
        if (qsync.disabled) return;
        clearTimeout(syncBack);
        /* 途中の知らせのいちばん後ろを覚え、終わったら画面の下に出す（2026-11-16 Issue #68 の返事「TODOの同期が失敗した時にエラーメッセでる？」:
           前は失敗（例外）のときだけ知らせ、やめた・届かなかった・送らなかったなどは、ボタンの説明にしか出なかった） */
        let lastMsg = '';
        const p = holdWhile(ask(a, 'syncShared', (msg) => { if (msg) { lastMsg = String(msg); qsync.title = lastMsg; } }));
        if (!p || typeof p.then !== 'function') { qsync.textContent = 'できない'; toast('同期できなかった（この海はブロックチェーンで共有していないか、まだ始めていない）'); syncBack = setTimeout(() => { qsync.textContent = '同期'; }, 1400); return; }
        qsync.disabled = true;
        qsync.textContent = '同期中…';
        p.then(() => {
          const stopped = /やめた/.test(lastMsg);
          qsync.textContent = stopped ? 'やめた' : '同期した';
          if (lastMsg && !stopped) longToast('同期: ', lastMsg);
          syncNotesBtn();
          if (notesPane && !notesPane.hidden) renderNotes();
        }, e => {
          qsync.textContent = /やめた/.test(String((e && e.message) || e)) ? 'やめた' : 'できない';
          qsync.title = String((e && e.message) || e);
          /* 何で止まったか（残高が足りない・まだメンバーでない など）を見えるように出す（Issue #68 の返事「反映されない」）。ボタンの説明だけでは気づけなかった */
          if (!/やめた/.test(qsync.title)) longToast('同期できなかった: ', qsync.title);
        }).finally(() => {
          qsync.disabled = false;
          syncBack = setTimeout(() => { const n = Number(ask(a, 'directCount')) || 0; qsync.textContent = n ? '同期 ⇄' + n : '同期'; }, 1800);
        });
      });
      qrow.appendChild(qsync);
    }
    nwrap.appendChild(qrow);
    nwrap.appendChild(el('p', 'bc-hint', 'あとから直せない・消せない'));
    fields.appendChild(nwrap);
    syncNotesBtn();
    foldPart(nwrap, 'notes', !notesBtn.classList.contains('is-empty'));
    /* 2026-11-18 ユーザーの決定（モック task-start.html の決めてほしいこと 3）: コメントは共有の海でだけ出す。
       個人の海には相手がいないため。前に書いたものがあれば、個人の海でも出す（Issue #61 の「個人の海でも出す」を置き換える） */
    const members0 = ask(a, 'seaMembers');
    const sharedSea = (Array.isArray(members0) && members0.length > 0) || ask(a, 'shareSyncOn') === true;
    if (!sharedSea && notesBtn.classList.contains('is-empty')) nwrap.hidden = true;
    /* 新しい 3 件は盤を開いた時点で見えているので、ここまで読んだとする（泡の点を消す）。
       畳んで「その他」に入っているときは見えていないので覚えない */
    if (!nwrap.classList.contains('is-extra') && notesNow().length) {
      ask(a, 'markNotesSeen', id);
      document.querySelectorAll('.bub[data-id="' + String(id).replace(/["\\]/g, '') + '"] .ndot')
        .forEach(d => { d.hidden = true; });
    }
  }

  /* ---- お気に入りの印（F7・利用者の指示 2026-09-24）----
     左のメニューの「お気に入り」に出るための印。タグではないので札の列には並べず、
     その上に1つだけ置く。書くのは閉じるとき（タグと同じ理由：押した瞬間に書くと
     店が emit して盤ごと作り直される）。預け先に isFav / setFav が無い版では出さない。 */
  /* ---- 担当（2026-11-18。共有の記録 v1.2。モック 4）----
     共有の海（サーバーの海で仲間がいる）でだけ出す。だれでも／仲間の名前から選ぶ。見るだけの人は変えられない。
     足した人・終えた人も小さく出す。書くのは閉じるとき（お気に入りと同じ） */
  if (fields && typeof (a || {}).setAssignee === 'function') {
    const members = ask(a, 'seaMembers');
    if (Array.isArray(members) && members.length) {
      const w0 = ask(a, 'whoOf', id) || {};
      const box = el('div', 'bc-who');
      box.dataset.name = '担当';
      const lb = el('label', 'bc-who-lb');
      lb.appendChild(el('span', 'bc-who-tx', '担当'));
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', '担当');
      const any = document.createElement('option');
      any.value = ''; any.textContent = 'だれでも';
      sel.appendChild(any);
      members.forEach(m => {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.name || m.id;
        if (m.id === w0.assignee) o.selected = true;
        sel.appendChild(o);
      });
      if (w0.assignee && !members.some(m => m.id === w0.assignee)) {
        const o = document.createElement('option');      /* 仲間から外れた人が担当のまま */
        o.value = w0.assignee; o.textContent = ask(a, 'userName', w0.assignee) || '前の仲間'; o.selected = true;
        sel.appendChild(o);
      }
      sel.disabled = ask(a, 'myRole') === 'viewer';
      lb.appendChild(sel);
      box.appendChild(lb);
      const by = [];
      if (w0.added_by) by.push('足した: ' + (ask(a, 'userName', w0.added_by) || '?'));
      if (w0.done_by) by.push('終えた: ' + (ask(a, 'userName', w0.done_by) || '?'));
      if (by.length) box.appendChild(el('span', 'bc-who-by', by.join('・')));
      fields.appendChild(box);
      saveWho = () => {
        if (!sel.disabled && sel.value !== (w0.assignee || '')) ask(a, 'setAssignee', id, sel.value || null);
      };
    }
  }

  if (fields && typeof (a || {}).setFav === 'function') {
    const fav0 = ask(a, 'isFav', id) === true;
    let favWant = fav0;
    const favBtn = el('button', 'bc-fav');
    favBtn.type = 'button';
    const favIc = el('span', 'bc-fav-ic');
    favIc.setAttribute('aria-hidden', 'true');
    const favTx = el('span', 'bc-fav-tx', 'お気に入り');
    favBtn.appendChild(favIc);
    favBtn.appendChild(favTx);
    const syncFav = () => {
      favBtn.setAttribute('aria-pressed', favWant ? 'true' : 'false');
      favIc.textContent = favWant ? '★' : '☆';
    };
    syncFav();
    favBtn.addEventListener('click', ev => { ev.preventDefault(); favWant = !favWant; syncFav(); });
    /* 印の無い泡では「その他」に畳む（Issue #40。Issue #49 で設定から出せる）。付いていれば、いつも出す */
    foldPart(favBtn, 'fav', fav0);
    fields.appendChild(favBtn);
    saveFav = () => {
      if (favWant !== fav0) ask(a, 'setFav', id, favWant);
    };
  }

  /* ---- 印の段（大事・見当・急ぐ）と、今日大事なこと・先に済ませる ----
     2026-10-25 の優先度（急ぐ・大事の 2 つの切り替え）を、2026-11-24 ユーザーの決定（app_spec の minutes/261124_選ぶときの基準.md、
     モック mock/choose-1124.html の 3）で 3 つの段にした。「その他」から出し、名前のすぐ下に置く（選ぶ瞬間に見えることが基準）。
       大事 … ◆ 大事・大事でない・まだ
       見当 … さっと（30 分まで）・半日まで・何回も・まだ（何回もなら 1 回分の案内）
       急ぐ … 外の約束・自分の目安・急がない・まだ
     どれも「まだ」のままでよい。大事か急ぐの片方を決めたとき、もう片方が「まだ」なら「いいえ」として書く
     （片方だけ「まだ」で残すと区分が出ず、押したのに何も起きないように見えるため。前の版と同じ）。
     書くのは閉じるとき（お気に入りと同じ理由）。区分の名前は命令形にしない。数は出さない。
     ◆ は文字（絵文字にしない。契約 §15）。預け先に setPriority が無い版では出さない。 */
  let prioNow = null;           /* 先に済ませるへ入れる前に、見当をその場で書く（↑ はさっとの泡だけ） */
  let syncPick = null;          /* 見当を変えたら ↑ の出し入れを合わせる */
  let wantSize = () => null;
  if (fields && typeof (a || {}).setPriority === 'function') {
    const c0 = ask(a, 'choiceOf', id) || ask(a, 'priorityOf', id) || {};
    const tri = v => (v === true ? true : v === false ? false : null);
    let p0 = { urgent: tri(c0.urgent), important: tri(c0.important),
      dueKind: c0.urgent === true ? (c0.dueKind === 'ext' ? 'ext' : 'self') : null,
      size: (c0.size === 's' || c0.size === 'm' || c0.size === 'l') ? c0.size : null };
    const want = Object.assign({}, p0);
    wantSize = () => want.size;
    const box = el('div', 'bc-prio');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '大事・見当・急ぐ');
    const segs = [];
    /* 2026-11-24 利用者の指示「大事・検討・急ぐあたりのUIが綺麗になっていない 幅や必要な機能を洗練して タグより下でいいと思う」:
       どの段も 1 行に収める。「まだ」「大事でない」「急がない」の札は外し、押してある札をもう一度押すと外れる（＝まだ）。
       片方を外したとき、もう片方が「はい」なら「いいえ」として残し、そうでなければ両方「まだ」に戻す（区分が中途半端に残らない）。
       段の並びは タグの下（ORDER）。区分の一言（いまの区分）は四つに分けた見え方が受け持つので出さない */
    const seg = (name, part, opts, get, set) => {
      const row = el('div', 'bc-mk');
      row.dataset.name = name;
      row.dataset.seg = part;
      const h = el('span', 'bc-mk-h', name);
      h.id = 'bc-mk-' + part + '-' + Math.random().toString(36).slice(2, 7);
      row.appendChild(h);
      const chips = el('div', 'bc-mk-chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-labelledby', h.id);
      const btns = opts.map(([val, text, title]) => {
        const b = el('button', 'bc-chip', text);
        b.type = 'button';
        if (title) b.title = title;
        b.addEventListener('click', ev => { ev.preventDefault(); set(get() === val ? null : val); sync(); });
        chips.appendChild(b);
        return [val, b];
      });
      row.appendChild(chips);
      box.appendChild(row);
      segs.push(() => btns.forEach(([val, b]) => b.setAttribute('aria-pressed', get() === val ? 'true' : 'false')));
      return row;
    };
    /* 片方を「はい」にしたら、もう片方の「まだ」を「いいえ」に。外したら、もう片方が「はい」のときだけ「いいえ」で残す */
    const setImp = v => {
      if (v === true) { want.important = true; if (want.urgent === null) want.urgent = false; return; }
      if (want.urgent === true) want.important = false;
      else { want.important = null; want.urgent = null; want.dueKind = null; }
    };
    const setDue = v => {
      if (v === 'ext' || v === 'self') { want.urgent = true; want.dueKind = v; if (want.important === null) want.important = false; return; }
      want.dueKind = null;
      if (want.important === true) want.urgent = false;
      else { want.urgent = null; want.important = null; }
    };
    seg('大事', 'imp', [[true, '◆ 大事']], () => (want.important === true ? true : null), setImp);
    const sizeRow = seg('見当', 'size', [['s', SIZES.s, '30 分まで'], ['m', SIZES.m], ['l', SIZES.l, '何回かに分けてやる']],
      () => want.size,
      v => { want.size = v; });
    const hint = el('p', 'bc-mk-hint', '次にやることがあれば、1 回分（半日まで）として選ばれる');
    hint.dataset.name = '1 回分の案内';
    sizeRow.appendChild(hint);
    seg('急ぐ', 'due', [['ext', DUE_KINDS.ext], ['self', DUE_KINDS.self]],
      () => (want.urgent === true ? (want.dueKind === 'ext' ? 'ext' : 'self') : null), setDue);
    function sync() {
      segs.forEach(f => f());
      hint.hidden = want.size !== 'l';
      const q = quadrantFor(want.urgent, want.important);
      if (q) box.dataset.q = q; else delete box.dataset.q;
      if (syncPick) syncPick();
    }
    sync();
    box.dataset.name = '大事・見当・急ぐ';
    foldPart(box, 'prio', false);          /* 2026-11-24「作業記録より下はその他で畳んでみて」: 既定で畳む（決めた印は泡の縁・添え字に出ている） */
    fields.appendChild(box);
    const differs = () => want.urgent !== p0.urgent || want.important !== p0.important
      || want.dueKind !== p0.dueKind || want.size !== p0.size;
    savePrio = () => {
      if (differs()) ask(a, 'setPriority', id, Object.assign({}, want));
    };
    prioNow = () => { if (differs()) { ask(a, 'setPriority', id, Object.assign({}, want)); p0 = Object.assign({}, want); } };
  }

  /* ---- ［★ 今日大事なことにする］と［↑ 先に済ませるに入れる］（2026-11-24。モック mock/choose-1124.html の 3）----
     どちらも押したその場で書く（ほかの泡から今日大事なことを外す・席の数を見るので、閉じるまで待たない）。
     今日大事なことは今日（この端末の今日）に 1 つ。先に済ませるはさっとの泡だけ・3 つまで・区切りの時間の前だけ。
     言い方は命令形にしない。預け先に setKey が無い版では出さない */
  if (fields && typeof (a || {}).setKey === 'function') {
    /* 2026-11-24（タグの下へ移したとき）: 大事・見当・急ぐと同じ形の 1 行「今日」に、入っているかどうかの札 2 つ。押すと入れる・外す */
    const pick = el('div', 'bc-mk bc-pick');
    pick.dataset.part = 'pick';
    pick.dataset.name = '今日大事なこと・先に済ませる';
    const ph = el('span', 'bc-mk-h', '今日');
    ph.id = 'bc-mk-pick-' + Math.random().toString(36).slice(2, 7);
    pick.appendChild(ph);
    const pchips = el('div', 'bc-mk-chips');
    pchips.setAttribute('role', 'group');
    pchips.setAttribute('aria-labelledby', ph.id);
    const keyBtn = el('button', 'bc-chip bc-key', '★ 今日大事なこと');
    keyBtn.type = 'button';
    keyBtn.dataset.name = '今日大事なことにする';
    const firstBtn = el('button', 'bc-chip bc-first', '↑ 先に済ませる');
    firstBtn.type = 'button';
    firstBtn.dataset.name = '先に済ませるに入れる';
    pchips.appendChild(keyBtn);
    pchips.appendChild(firstBtn);
    pick.appendChild(pchips);
    const said = el('p', 'bc-pick-note');
    said.setAttribute('aria-live', 'polite');
    pick.appendChild(said);
    syncPick = () => {
      const isKey = ask(a, 'isKey', id) === true;
      keyBtn.setAttribute('aria-pressed', isKey ? 'true' : 'false');
      keyBtn.setAttribute('aria-label', isKey ? '今日大事なことから外す' : '今日大事なことにする');
      const fi = ask(a, 'firstInfo', id) || { has: false, canAdd: false, why: '' };
      /* 先に済ませるは、さっとの泡だけ。さっとでなければ札を出さない（入っているものは外せるよう出す） */
      firstBtn.hidden = !fi.has && wantSize() !== 's';
      firstBtn.setAttribute('aria-pressed', fi.has ? 'true' : 'false');
      firstBtn.setAttribute('aria-label', fi.has ? '先に済ませるから外す' : '先に済ませるに入れる');
      firstBtn.disabled = !fi.has && !fi.canAdd;
      firstBtn.title = firstBtn.disabled ? (fi.why || '') : '';
    };
    keyBtn.addEventListener('click', ev => {
      ev.preventDefault();
      const on = ask(a, 'isKey', id) !== true;
      if (ask(a, 'setKey', id, on)) said.textContent = on ? '今日大事なことにした' : '今日大事なことから外した';
      syncPick();
    });
    firstBtn.addEventListener('click', ev => {
      ev.preventDefault();
      const fi = ask(a, 'firstInfo', id) || {};
      if (!fi.has && prioNow) prioNow();     /* 見当をさっとにしたばかりなら、先に書く */
      const r = ask(a, 'setFirst', id, !fi.has);
      said.textContent = r === 'ok' ? (fi.has ? '先に済ませるから外した（今日の水面に残る）' : '先に済ませるに入れた')
        : r === 'full' ? '先に済ませるの席は 3 つまで' : r === 'closed' ? '先に済ませるは、今日はもう畳んだ'
        : r === 'size' ? '先に済ませるは、さっとの泡だけ' : '';
      syncPick();
    });
    syncPick();
    /* 今日大事なこと・先に済ませるに入っていれば畳まない（外す道が見えるように） */
    foldPart(pick, 'pick', ask(a, 'isKey', id) === true || !!(ask(a, 'firstInfo', id) || {}).has);
    fields.appendChild(pick);
  }

  /* 期間の外なので長期保留の海にいるか（共有の記録 v1.5 §11。'before'|'after'|null）。
     記録の hold は無いので、タグの［長期保留］は点線の「長期保留（期間で）」、日付の段に期間の外の案内を出す（2026-11-23 点検の直し） */
  const spanWhy = ask(a, 'spanHeld', id) || null;
  const allTags = ask(a, 'tags');
  const canEdit = Array.isArray(allTags) && allTags.length
    && typeof (a || {}).setTag === 'function';

  if (fields && canEdit) {
    const has0 = new Set(ask(a, 'tagsOf', id) || []);
    const want = new Set(has0);
    /* 設定で隠したタグ（Issue #90）は出さない。この泡に付いているものだけは、外せるように残す */
    const list = allTags.filter(t => t && t.id && t.id !== 'done' && (!t.hidden || has0.has(t.id)));

    const tags = el('div', 'bc-tags');
    list.forEach(t => {
      const chip = el('button', 'bc-tag bc-tag-btn');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', want.has(t.id) ? 'true' : 'false');
      /* 特別なタグ（今日・きっかけ・すきま・長期保留）の印。この端末の表示の「タグ類を隠す」でも残す（Issue #36） */
      if (t.special) chip.dataset.special = '1';
      const dot = el('span', 'bc-tag-dot');
      dot.setAttribute('aria-hidden', 'true');
      if (t.color) dot.style.setProperty('--tcd', t.color);
      const tx = el('span', 'bc-tag-tx');
      tx.textContent = String(t.name || '');   /* ユーザーの文字。innerHTML には入れない */
      chip.appendChild(dot);
      chip.appendChild(tx);
      /* 期間の外で長期保留の海にいる泡は、点線の「長期保留（期間で）」。押すと手で付ける長期保留になる */
      const spanLook = () => {
        const sp = t.id === 'hold' && !!spanWhy && !want.has('hold');
        chip.classList.toggle('is-span', sp);
        tx.textContent = String(t.name || '') + (sp ? '（期間で）' : '');
      };
      if (t.id === 'hold') spanLook();
      chip.addEventListener('click', ev => {
        ev.preventDefault();
        /* 「今日」はカレンダーの今日の枡と同じもの。書き込みはあちらが持つ */
        if (t.id === 'today' && todayCell) { todayCell.toggle(); return; }
        const on = !want.has(t.id);
        if (on) want.add(t.id); else want.delete(t.id);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (t.id === 'hold') spanLook();
        if (t.id === 'hold' && syncHoldRow) syncHoldRow(true);
      });
      if (t.id === 'today') syncTodayChip = on => chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      tags.appendChild(chip);
    });
    foldPart(tags, 'tags', false);      /* 付いているタグは泡の色に出ている */
    fields.appendChild(tags);

    /* ---- いつの日（カレンダー。利用者の指示）----

       > todayタグのもののdaysをカレンダーでタップしてON/OFF出来るようにしたい
       > （今日はできなそうなので、9/3,4に移す、みたいな）

       1件は**複数の日に置ける**（days は配列）。ここはそれをそのまま入り切りする。
       前は「この日から [前の日へ][次の日へ]」だったが、
       **どの日の話かを画面の文脈に頼っていた**（今日の画面でしか出せなかった）。
       カレンダーは日そのものを見せるので、どの画面の盤からでも使える。

       ■ 出す範囲は6週間（今週の日曜から）

         利用者の指示：「日付の項目が3行しかなく、1ヶ月分に満たない。1ヶ月分は表示したい」。
         前は3週間（21日）で、そのうち過去が最大6日ぶん——**先は2週間ほどしか無かった**。

         6週間にすると、今日が週のどこであっても**先は最低36日**ある（土曜でも 42-6）。
         5週間だと土曜の日に28日ぶんしか無く、月をまたぐ用（「来月の頭に」）に届かない。
         行が増えたぶんは `.bc-fields` の中でスクロールする（高さの上限は place() が入れる）。

         **過去は1週間ぶんのまま**。遠い過去を一覧にすると、それ自体が
         「やらなかった日」を数える装置になる（§0。日を選ぶ札と同じ考え）。
         増やしたのは**先だけ**で、この理由には触っていない。

       ■ 過去の日は押せない
         過去はその日の記録なので、あとから足させない・消させない
         （入力欄を過去の日に出さないのと同じ規則）。**印は出す**——
         そこに置いた事実は読めたほうがいい。

       ■ 書くのは閉じるとき
         タグの札と同じ。押した瞬間に書くと店が emit して盤が組み直され、
         1日入れたところで盤が閉じる。 */
    /* 2026-11-19 ユーザーの決定「7 つとも案どおり」（モック docs/spec/mock/dates.html）:
       やる日・期間は、月の名前つきの同じ形の暦（js/monthcal.js）で選ぶ。やる日の暦には期間の帯とくりかえしの次の回の点も出す。
       くりかえしは期間の中から出して、日付の段の 3 つ目の札にする（毎週・2 週ごと・毎月。やる日も期間もくりかえせる。終わりの日）。
       3 つの札は 1 つを開くとほかを閉じる（arrangeBoard の日付の段） */
    const dsync = {};                                 /* 札どうしで描き直しを知らせ合う（やる日・期間・くりかえし） */
    const syncDates = (but) => Object.keys(dsync).forEach(k => { if (k !== but && dsync[k]) dsync[k](); });
    const todayK = ask(a, 'todayKey') || '';
    const storedRepeat = () => (typeof (a || {}).repeat === 'function' ? ask(a, 'repeat', id) : null);
    /* くりかえしの札で選んでいる決まり（閉じるときに書く。書くまでは下書き）。undefined＝まだ触っていない */
    let repDraft;
    /* いまの決まり（下書きがあればそちら）を、回の日を数えられる形で。of 'day' は今日から数え、いまの回（at）を入れる */
    const curRepeat = () => {
      const d = repDraft === undefined ? storedRepeat() : repDraft;
      if (!d) return null;
      if (repDraft === undefined) return d;
      const sp = spanFields();
      const r = normalizeRepeat(Object.assign({}, d, d.of === 'span'
        ? { from: sp ? sp.start : null, to: sp ? sp.end : null, n: 0 } : { from: todayK, n: 0, at: undefined }));
      if (r && r.of === 'day') r.at = nextDay(r, addDays(todayK, -1)) || undefined;
      return r;
    };
    /* 期間の下書き（閉じるときに書く。undefined＝まだ触っていない）。先の期間をいま書くと泡が長期保留の海へ移り、
       終了日を選ぶ前に盤が閉じる（やる日を閉じるときに書くのと同じ理由） */
    let spanDraft;
    const spanFields = () => {
      if (spanDraft !== undefined) return spanDraft;
      const f = ask(a, 'span', id) || {};
      return (f.start && f.due) ? { start: f.start, end: f.due } : null;
    };
    /* 先の回（暦の点・次の回の 1 行）。of 'day' は日、of 'span' は期間 */
    const repUpcoming = (n) => { const r = curRepeat(); return r ? upcoming(normalizeRepeat(Object.assign({ n: 0 }, r)), todayK, n) : []; };
    const mdK = k => Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10));
    const spanTx = sp => sp.start === sp.end ? mdK(sp.start) : mdK(sp.start) + '–' + mdK(sp.end);

    const canDays = typeof (a || {}).setDay === 'function' && typeof (a || {}).shiftDay === 'function';
    if (canDays) {
      const today = todayK;
      const days0 = new Set(ask(a, 'days', id) || []);
      const want = new Set(days0);
      /* 過ぎた日は記録なので押せない。印は 1 週間ぶんだけ出す（遠い過去を「やらなかった日」の一覧にしない。§0） */
      const weekAgo = ask(a, 'shiftDay', today, -7) || today;

      const box = el('div', 'bc-cal');
      const head = el('button', 'bc-cal-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      const lb = el('span', 'bc-cal-lb', 'やる日');
      const sum = el('span', 'bc-cal-sum');
      head.appendChild(lb);
      head.appendChild(sum);
      box.appendChild(head);

      const grid = el('div', 'bc-cal-body');   /* 開いた中身（暦・凡例・早く選ぶ札・どこに出るか） */
      grid.hidden = true;
      head.addEventListener('click', ev => {
        ev.preventDefault();
        const open = grid.hidden;
        grid.hidden = !open;
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        relayout();
      });
      let repKeys = new Set(), band = null;
      const cal = monthCal({
        today, month: monthOf(today), minMonth: monthOf(today), label: 'やる日の暦',
        state: key => ({
          on: want.has(key) && key >= weekAgo,
          off: key < today,
          rep: repKeys.has(key) && !want.has(key),
          band: !!band && key >= band.start && key <= band.end,
          bs: !!band && key === band.start, be: !!band && key === band.end,
        }),
        onPick: key => { if (want.has(key)) want.delete(key); else want.add(key); paint(); },
      });
      grid.appendChild(cal.root);
      const legend = el('p', 'bc-cal-legend');
      legend.innerHTML = '<span class="lg lg-on"></span>やる日 <span class="lg lg-rep"></span>くりかえしの次の回 <span class="lg lg-band"></span>期間';
      grid.appendChild(legend);
      /* よく使う日は札で（今日・明日・今度の土曜）。未定にするは、今日から先のやる日を外す */
      const quick = el('div', 'bc-hold-picks bc-cal-quick');
      const tomorrow = ask(a, 'shiftDay', today, 1);
      const sat = ask(a, 'shiftDay', today, 6 - dowOf(today) || 7);
      const qbtn = (tx, key) => {
        const b = el('button', 'bc-hold-pick');
        b.type = 'button';
        b.textContent = tx;
        b.dataset.name = '早く選ぶ札';
        b.addEventListener('click', ev => {
          ev.preventDefault();
          if (key) { if (want.has(key)) want.delete(key); else want.add(key); }
          else [...want].forEach(k => { if (k >= today) want.delete(k); });
          if (key) cal.show(monthOf(key));
          paint();
        });
        quick.appendChild(b);
        return { b, key };
      };
      const qs = [qbtn('今日', today), qbtn('明日', tomorrow), qbtn('今度の土曜', sat), qbtn('未定にする', null)];
      grid.appendChild(quick);
      /* 日を選ぶと海の一覧（タグ無し）から外れる、と書いておく（2026-11-16 Issue #76 の返事。js/screens/sea.js の centerItems） */
      const where = el('p', 'bc-span-note bc-cal-where', '');
      grid.appendChild(where);
      box.appendChild(grid);
      foldPart(box, 'days', false);
      fields.appendChild(box);

      function paint() {
        const r = curRepeat();
        repKeys = new Set(r && r.of === 'day' ? repUpcoming(40) : []);
        band = spanFields();
        cal.paint();
        qs.forEach(q => q.b.setAttribute('aria-pressed', q.key ? (want.has(q.key) ? 'true' : 'false') : ([...want].some(k => k >= today) ? 'false' : 'true')));
        if (syncTodayChip) syncTodayChip(want.has(today));
        /* 畳んだ姿の要約。今日から先の日だけ、近いものから 1 つ（数は出さない——「あと◯日」はやり残しの数え上げに近い） */
        const on = [...want].filter(k => k >= today).sort();
        sum.textContent = on.length === 0 ? '未定' : (on[0] === today ? '今日' : mdK(on[0])) + (on.length > 1 ? ' ほか' : '');
        head.setAttribute('aria-label', 'やる日：' + sum.textContent + '。押すと暦');
        const later = on.filter(k => k > today);
        where.textContent = want.has(today)
          ? '閉じると、今日の画面に出る（海の一覧の「タグ無し」からは外れる）'
          : (later.length ? mdK(later[0]) + ' になるまで海の一覧から外れる。フィルターの「今日より後」か、日付で見る（▤）で見える' : '');
        where.hidden = !where.textContent;
      }
      paint();
      dsync.days = paint;

      /* 「今日」の札は、この暦の今日の枡と同じものを指す。書き込みはここが持つ */
      todayCell = {
        has: () => want.has(today),
        toggle: () => { if (want.has(today)) want.delete(today); else want.add(today); paint(); },
      };

      saveDays = () => {
        new Set([...want, ...days0]).forEach(k => {
          const now = want.has(k);
          if (now === days0.has(k)) return;
          ask(a, 'setDay', id, k, now);
        });
        days0.clear();
        want.forEach(v => days0.add(v));      /* 二重に書かない */
      };
      /* くりかえしを書いた後（店がやる日を足し引きする）。書きかけの入り切りは saveDays で先に書いてある */
      /* くりかえしの下書きが変わったら、前の回の日（先の日だけ）を外して、新しい回の日をやる日に入れる。
         書くのは閉じるとき（いま書くと泡が今日の海へ移って盤が閉じる）。店の setRepeat も同じことをする */
      moveRepDay = (oldKey, newKey) => {
        if (oldKey && oldKey !== newKey && oldKey >= today) want.delete(oldKey);
        if (newKey) want.add(newKey);
        paint();
      };
    }

    /* ---- 期間（開始日・終了日。2026-11-10 Issue #34）----
       **書く先は泡の欄 start・due**（2026-11-10 利用者の決定。共有の記録 v1.1。gantt_todo も同じ欄を読み書きする）。
       Issue #34 の版は本文の「期間:」の行に書いていた。その行は、start・due が空の古い記録を読むときだけ使う。
       2026-11-19: OS の日付の欄をやめ、やる日と同じ形の暦で選ぶ。［開始日］［終了日］を押してから暦の日を押す。
       ・片方だけなら、その日 1 日。逆に選んだら入れ替える（store.setSpan）
       ・開始日は過ぎた日も選べる（もう始めているものもある）
       ・選んだらすぐ書く。本文に古い「期間:」「日付:」の行があれば、本文の控えからその行を外す */
    if (typeof (a || {}).setSpan === 'function') {
      const box = el('div', 'bc-hold bc-span');
      const head = el('button', 'bc-cal-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      const ssum = el('span', 'bc-cal-sum');
      head.appendChild(el('span', 'bc-hold-lb', '期間'));
      head.appendChild(ssum);
      const body = el('div', 'bc-hold-body');
      body.hidden = true;
      head.addEventListener('click', ev => {
        ev.preventDefault();
        const open = body.hidden;
        body.hidden = !open;
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        relayout();
      });

      /* いまの本文（書く面が開いていればそちら） */
      const curDetail = () => ((detailArea && detailPane && !detailPane.hidden) ? detailArea.value : detailDraft);
      /* いまの期間。欄（start・due）が先。どちらも空の古い記録だけ、本文の行から読む */
      const curSpan = () => {
        if (spanDraft !== undefined) return spanDraft;
        const f = ask(a, 'span', id) || {};
        if (f.start || f.due) return { start: f.start || f.due, end: f.due || f.start };
        return spanFromDetail(curDetail());
      };
      function write(s, e) {
        if (s && e && e < s) { const x = s; s = e; e = x; }
        spanDraft = s ? { start: s, end: e || s } : null;
        if (spanFromDetail(curDetail())) {
          detailDraft = withSpan(curDetail(), '', '');
          if (detailArea) detailArea.value = detailDraft;
          if (detailView && !detailView.hidden) detailView.textContent = detailDraft;
        }
        syncDetailBtn();
        syncSpanRow();
        syncDates('span');
      }

      let mode = 'start';
      const seg = el('div', 'bc-seg bc-span-seg');
      seg.dataset.name = '開始日・終了日（押してから暦で選ぶ）';
      const sBtn = el('button', 'bc-seg-b');
      const eBtn = el('button', 'bc-seg-b');
      [sBtn, eBtn].forEach((b, i) => {
        b.type = 'button';
        b.addEventListener('click', ev => { ev.preventDefault(); mode = i ? 'end' : 'start'; syncSpanRow(); });
        seg.appendChild(b);
      });
      body.appendChild(seg);
      const sp0 = curSpan();
      const cal = monthCal({
        today: todayK, month: monthOf(sp0 ? sp0.start : todayK), label: '期間の暦',
        state: key => {
          const sp = curSpan();
          return sp ? { band: key >= sp.start && key <= sp.end, bs: key === sp.start, be: key === sp.end } : {};
        },
        onPick: key => {
          const sp = curSpan();
          if (mode === 'start' || !sp) {
            write(key, sp && sp.end >= key ? sp.end : key);
            mode = 'end';
          } else {
            write(sp.start, key);                 /* 開始日より前を押したら、店が入れ替える */
          }
          syncSpanRow();
        },
      });
      body.appendChild(cal.root);
      const picks = el('div', 'bc-hold-picks');
      const clear = el('button', 'bc-hold-pick', '未定にする');
      clear.type = 'button';
      clear.dataset.name = '未定にする';
      clear.addEventListener('click', ev => { ev.preventDefault(); mode = 'start'; write('', ''); });
      clearSpan = () => { mode = 'start'; write('', ''); };
      picks.appendChild(clear);
      body.appendChild(picks);
      body.appendChild(el('p', 'bc-span-note', '開始日か終了日を押してから、暦の日を押す。1 日だけなら同じ日を 2 回'));

      saveSpan = () => {
        if (spanDraft === undefined) return;
        a.setSpan(id, spanDraft ? spanDraft.start : '', spanDraft ? spanDraft.end : '');
        spanDraft = undefined;
      };
      syncSpanRow = () => {
        const sp = curSpan();
        ssum.textContent = sp ? spanTx(sp) : '未定';
        sBtn.textContent = '開始日 ' + (sp ? mdw(sp.start) : '未定');
        eBtn.textContent = '終了日 ' + (sp ? mdw(sp.end) : '未定');
        sBtn.setAttribute('aria-pressed', mode === 'start' ? 'true' : 'false');
        eBtn.setAttribute('aria-pressed', mode === 'end' ? 'true' : 'false');
        clear.setAttribute('aria-pressed', sp ? 'false' : 'true');
        cal.paint();
        head.setAttribute('aria-label', '期間：' + ssum.textContent + '。押すと暦で開始日と終了日を選べる');
      };
      box.appendChild(head);
      box.appendChild(body);
      fields.appendChild(box);
      syncSpanRow();
      dsync.span = syncSpanRow;
      /* 決めてあれば、いつも出す。決めていない泡で畳むのは「この端末の表示」で期間を外したときだけ */
      foldPart(box, 'span', !!curSpan());
    }

    /* ---- くりかえし（Issue #60 の毎月くりかえすを、2026-11-19 に日付の段の 3 つ目の札へ）----
       何を（やる日・期間）→ 間隔（なし・毎週・2 週ごと・毎月）→ 曜日（毎週・2 週ごとのやる日）か 毎月の日 → 終わりの日。
       押したらすぐ書く（store.setRepeat）。下に先の 3 回を出して、選んだものが合っているかをその場で確かめられる。
       完了すると次の回の泡ができ、やらずに過ぎた回はたまらず、この泡が次の回へ進む（store の spawnRepeat・rollRepeat） */
    if (typeof (a || {}).setRepeat === 'function') {
      const box = el('div', 'bc-hold bc-rep');
      const head = el('button', 'bc-cal-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      const rsum = el('span', 'bc-cal-sum');
      head.appendChild(el('span', 'bc-hold-lb', 'くりかえし'));
      head.appendChild(rsum);
      const body = el('div', 'bc-hold-body');
      body.hidden = true;
      head.addEventListener('click', ev => {
        ev.preventDefault();
        const open = body.hidden;
        body.hidden = !open;
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        relayout();
      });
      /* 閉じた姿でも、くりかえしがあれば「次の回」を 1 行（札の下、段の幅いっぱい） */
      const note = el('p', 'bc-date-note');
      note.dataset.name = '次の回';

      const sl = tx => body.appendChild(el('p', 'bc-rep-sl', tx));
      const segOf = (name, opts, on) => {
        const s = el('div', 'bc-seg');
        s.dataset.name = name;
        const bs = opts.map(([v, tx]) => {
          const b = el('button', 'bc-seg-b');
          b.type = 'button';
          b.textContent = tx;
          b.dataset.v = v;
          b.addEventListener('click', ev => { ev.preventDefault(); if (!b.disabled) on(v); });
          s.appendChild(b);
          return b;
        });
        body.appendChild(s);
        return { s, bs, set: (v) => bs.forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(v) ? 'true' : 'false')) };
      };

      /* 下書き（いまの決まり。無ければ既定）。押すたびに作り直して書く */
      const anchor = () => {
        const r = curRepeat();
        if (r && r.at) return r.at;
        const fut = (ask(a, 'days', id) || []).filter(k => k >= todayK).sort();
        return fut[0] || todayK;
      };
      const r0 = storedRepeat();
      let draft = r0 ? Object.assign({}, r0) : null;

      const why = el('p', 'bc-span-note', '');
      sl('何を');
      const ofSeg = segOf('くりかえすもの', [['day', 'やる日'], ['span', '期間']], v => { draft = Object.assign(base(), { of: v }); apply(); });
      sl('間隔');
      const ivSeg = segOf('間隔', [['none', 'なし'], ['w1', '毎週'], ['w2', '2 週ごと'], ['m', '毎月']], v => {
        if (v === 'none') { draft = null; apply(); return; }
        draft = Object.assign(base(), { every: v === 'm' ? 'month' : 'week', step: v === 'w2' ? 2 : 1 });
        apply();
      });
      const dowLb = el('p', 'bc-rep-sl', '曜日');
      body.appendChild(dowLb);
      const dowBox = el('div', 'bc-dows');
      dowBox.dataset.name = '曜日（いくつでも）';
      const dowBtns = [...DOW_NAMES].map((tx, i) => {
        const b = el('button', 'bc-dow');
        b.type = 'button';
        b.textContent = tx;
        b.addEventListener('click', ev => {
          ev.preventDefault();
          /* 2026-11-19「毎週は曜日で指定できるように」: 期間をくりかえしているときに曜日を押すと、やる日を曜日でくりかえす形に替える */
          const cur = new Set(draft.of === 'day' ? (draft.dows || []) : []);
          if (cur.has(i)) { if (cur.size > 1) cur.delete(i); } else cur.add(i);   /* 1 つは残す */
          draft = Object.assign({}, draft, { of: 'day', dows: [...cur] });
          apply();
        });
        dowBox.appendChild(b);
        return b;
      });
      body.appendChild(dowBox);
      const mdLb = el('p', 'bc-rep-sl', '毎月の日');
      body.appendChild(mdLb);
      const mdSeg = segOf('毎月の日', [['mdays', '日にち'], ['nth', '']], v => {
        const k = anchor();
        draft = Object.assign({}, draft, { of: 'day' }, v === 'mdays'
          ? { mdays: (draft.of === 'day' && draft.mdays && draft.mdays.length) ? draft.mdays : [Number(k.slice(8, 10))], nth: undefined, dow: undefined }
          : { mdays: undefined, nth: nthOf(k), dow: dowOf(k) });
        apply();
      });
      /* 2026-11-19「毎月の繰り返しを複数日付を選べる様にして」: 日にち（1〜31）をいくつでも。月に無い日（31 日など）はその月の終わりの日 */
      const mdBox = el('div', 'bc-mdays');
      mdBox.dataset.name = '毎月の日にち（いくつでも）';
      const mdBtns = Array.from({ length: 31 }, (_, j) => {
        const n = j + 1;
        const b = el('button', 'bc-mday');
        b.type = 'button';
        b.textContent = String(n);
        b.setAttribute('aria-label', '毎月 ' + n + ' 日');
        b.addEventListener('click', ev => {
          ev.preventDefault();
          const cur = new Set(draft.of === 'day' ? (draft.mdays || []) : []);
          if (cur.has(n)) { if (cur.size > 1) cur.delete(n); } else cur.add(n);   /* 1 つは残す */
          draft = Object.assign({}, draft, { of: 'day', mdays: [...cur].sort((x, y) => x - y), nth: undefined, dow: undefined });
          apply();
        });
        mdBox.appendChild(b);
        return b;
      });
      body.appendChild(mdBox);
      const mdNote = el('p', 'bc-span-note', '');
      body.appendChild(mdNote);
      sl('終わりの日');
      const untilSeg = segOf('終わりの日', [['none', '決めない'], ['pick', '日を選ぶ…']], v => {
        if (v === 'none') { draft = Object.assign({}, draft, { until: undefined }); untilIn.hidden = true; apply(); return; }
        untilIn.hidden = false;
        untilSeg.set('pick');
        try { untilIn.showPicker(); } catch (e) { untilIn.focus(); }
      });
      const untilIn = el('input', 'bc-hold-day bc-rep-until');
      untilIn.type = 'date';
      untilIn.min = todayK;
      untilIn.setAttribute('aria-label', '終わりの日をえらぶ');
      untilIn.hidden = true;
      untilIn.addEventListener('change', () => {
        draft = Object.assign({}, draft, { until: untilIn.value || undefined });
        apply();
      });
      body.appendChild(untilIn);
      const nextLn = el('p', 'bc-rep-next');
      nextLn.dataset.name = '次の回（先の 3 回）';
      body.appendChild(nextLn);
      body.appendChild(why);

      /* 間隔を選んだときの既定。期間があってやる日が無ければ期間、ほかはやる日。曜日・日は、いまの回か今日から */
      function base() {
        if (draft) return Object.assign({}, draft);
        const k = anchor();
        const fut = (ask(a, 'days', id) || []).some(d => d >= todayK);
        const of = (spanFields() && !fut) ? 'span' : 'day';
        return { every: 'week', step: 1, of, dows: [dowOf(k)], mdays: [Number(k.slice(8, 10))] };
      }
      /* 選んだら下書きに入れて描き直す。書くのは閉じるとき（saveRepeat） */
      function apply() {
        let cfg = draft;
        if (cfg) {
          cfg = Object.assign({}, cfg);
          if (cfg.of === 'day' && cfg.every === 'week' && !(cfg.dows || []).length) cfg.dows = [dowOf(anchor())];
          if (cfg.of === 'day' && cfg.every === 'month' && !(cfg.mdays || []).length && !cfg.nth) cfg.mdays = [Number(anchor().slice(8, 10))];
          if (cfg.every === 'month') cfg.step = 1;
          if (cfg.of === 'span' && !spanFields()) cfg.of = 'day';
        }
        const before = curRepeat();
        draft = cfg;
        repDraft = cfg;
        const after = curRepeat();
        if (moveRepDay) moveRepDay(before && before.of === 'day' ? before.at : null, after && after.of === 'day' ? after.at : null);
        syncRep();
        syncDates('rep');
      }
      saveRepeat = () => {
        if (repDraft === undefined) return;
        const cfg = repDraft ? Object.assign({}, repDraft) : null;
        if (cfg) ['from', 'to', 'n', 'at', 'next'].forEach(k => delete cfg[k]);
        a.setRepeat(id, cfg);
        repDraft = undefined;
      };

      function syncRep() {
        const r = curRepeat();
        const d = draft || {};
        const hasSpan = !!spanFields();
        ofSeg.set(d.of || (r ? r.of : 'day'));
        ofSeg.bs[1].disabled = !hasSpan;
        ofSeg.bs[1].title = hasSpan ? '' : '期間を決めると選べる';
        ivSeg.set(!draft ? 'none' : (d.every === 'month' ? 'm' : (d.step === 2 ? 'w2' : 'w1')));
        /* 曜日・毎月の日は、毎週・2 週ごと・毎月を選んだらいつも出す（期間をくりかえしている間は印を付けず、押すとやる日のくりかえしになる） */
        const showDow = !!draft && d.every === 'week';
        dowLb.hidden = dowBox.hidden = !showDow;
        dowBtns.forEach((b, i) => b.setAttribute('aria-pressed', d.of === 'day' && (d.dows || []).indexOf(i) >= 0 ? 'true' : 'false'));
        const showMd = !!draft && d.every === 'month';
        mdLb.hidden = mdSeg.s.hidden = !showMd;
        const k = anchor();
        mdSeg.bs[1].textContent = nthLabel(d.nth || nthOf(k)) + ' ' + DOW_NAMES[d.dow != null ? d.dow : dowOf(k)] + '曜';
        mdSeg.set(d.of !== 'day' ? '' : (d.nth ? 'nth' : 'mdays'));
        mdBox.hidden = !(showMd && d.of === 'day' && !d.nth);
        mdBtns.forEach((b, j) => b.setAttribute('aria-pressed', (d.mdays || []).indexOf(j + 1) >= 0 ? 'true' : 'false'));
        mdNote.textContent = (showDow || showMd) && d.of === 'span'
          ? (showDow ? '曜日を押すと、期間ではなくやる日を曜日でくりかえす。' : '日にちを押すと、期間ではなくやる日を日にちでくりかえす。')
          : (!mdBox.hidden && (d.mdays || []).some(n => n > 28) ? '29〜31 日が無い月は、その月の終わりの日。' : '');
        mdNote.hidden = !mdNote.textContent;
        ofSeg.s.hidden = !draft;
        ofSeg.s.previousSibling.hidden = !draft;
        untilSeg.s.hidden = untilSeg.s.previousSibling.hidden = !draft;
        untilSeg.set(d.until ? 'pick' : (untilIn.hidden ? 'none' : 'pick'));
        untilIn.value = d.until || '';
        if (d.until) untilIn.hidden = false;
        if (d.until) untilSeg.bs[1].textContent = mdw(d.until) + ' まで';
        else untilSeg.bs[1].textContent = '日を選ぶ…';
        /* 先の 3 回 */
        const up = r ? repUpcoming(4) : [];
        const fmt = x => (typeof x === 'string' ? mdw(x) : spanTx({ start: x.start, end: x.due }));
        const later = r && r.of === 'day' ? up.filter(x => x > (r.at || todayK)) : up.slice(1);
        nextLn.textContent = r ? '次の回　' + (later.length ? later.slice(0, 3).map(fmt).join('・') : 'もう無い（終わりの日を過ぎた）') : '';
        nextLn.hidden = !r;
        rsum.textContent = r ? repeatLabel(normalizeRepeat(Object.assign({ n: 0 }, r))) : 'なし';
        head.setAttribute('aria-label', 'くりかえし：' + rsum.textContent + '。押すと選べる');
        note.textContent = r && later.length ? '次の回 ' + fmt(later[0]) : '';
        note.hidden = !note.textContent;
        let hint = body.querySelector('.bc-rep-hint');
        if (!hint) { hint = el('p', 'bc-span-note bc-rep-hint'); body.appendChild(hint); }
        hint.textContent = r ? '完了すると、次の回の泡ができる。やらずに過ぎた回はたまらず、この泡が次の回へ進む' : '';
        hint.hidden = !r;
      }

      box.appendChild(head);
      box.appendChild(note);
      box.appendChild(body);
      box.dataset.part = 'repeat';
      fields.appendChild(box);
      syncRep();
      dsync.rep = () => syncRep();   /* 期間が変わったら（期間をくりかえすときの次の回） */
      foldPart(box, 'repeat', !!curRepeat());
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

      /* いつの日と同じく畳む（レビューの指摘）。長期保留の項目では、
         この欄が出るだけで盤が 45px はみ出して [消す] が下タブの裏に隠れていた（実測）。
         畳んだ姿でも**いつ戻るか**は読める */
      const head = el('button', 'bc-cal-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      const hsum = el('span', 'bc-cal-sum');
      const lb = el('label', 'bc-hold-lb', '海に戻す日');   /* 2026-11-18 もどってくる日 → 海に戻す日 */
      const picks = el('div', 'bc-hold-picks');
      const body = el('div', 'bc-hold-body');
      body.hidden = true;
      head.appendChild(lb);
      head.appendChild(hsum);
      head.addEventListener('click', ev => {
        ev.preventDefault();
        const open = body.hidden;
        body.hidden = !open;
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        relayout();
      });
      const dayIn = el('input', 'bc-hold-day');
      dayIn.type = 'date';
      const today = ask(a, 'todayKey') || '';
      if (today) dayIn.min = today;                /* 過ぎた日は選ばせない */
      dayIn.setAttribute('aria-label', '海に戻す日をえらぶ');
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
        /* 畳んだ姿の要約。日は出すが、あと何日かは出さない（数え上げにしない） */
        hsum.textContent = until
          ? Number(until.slice(5, 7)) + '/' + Number(until.slice(8, 10))
          : '未定';
        head.setAttribute('aria-label', '海に戻す日：' + hsum.textContent + '。押すと選べる');
      }

      box.appendChild(head);
      body.appendChild(dayIn);
      body.appendChild(picks);
      box.appendChild(body);
      dayIn.value = until || '';
      syncPicks();
      box.dataset.part = 'hold';   /* 日付の段に入れる（arrangeBoard）。設定の選ぶものには入れない（長期保留の札のときだけ出る） */
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
    foldPart(tags, 'tags', false);
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

    /* 2026-11-18: 「次の一手」→「次にやること」。欄の字は例を出す（「ひとつめだけ」では何を書くか分からなかった） */
    const wrap = el('label', 'bc-row bc-stack');
    const lb = el('span', 'bc-lb');
    lb.textContent = '次にやること';               /* innerHTML には入れない */
    stepIn = el('input', 'bc-in');
    stepIn.type = 'text';
    stepIn.placeholder = '例 予約の電話をかける';
    stepIn.autocomplete = 'off';
    stepIn.enterKeyHint = 'done';
    wrap.appendChild(lb);
    wrap.appendChild(stepIn);
    foldPart(wrap, 'step', false);
    if (stepOnBoard) fields.appendChild(wrap);
    /* 書きかけがあればそちら、無ければいまの「次の一手」 */
    stepIn.value = String((draft && draft.next) || ask(a, 'firstStep', id) || '');

    if (canCommit) {
      /* 作業メモは入口だけ。中身は別の面で書く（利用者の指示）。
         入口には**いま何か書いてあるか**を出す——押さないと分からない、にしない */
      memoDraft = String((draft && draft.did) || '');
      const mrow = el('div', 'bc-row');
      const mlb = el('span', 'bc-lb', '作業の記録');   /* 2026-11-18 作業メモ → 作業の記録 */
      memoBtn = el('button', 'bc-memo-open');
      memoBtn.type = 'button';
      memoBtn.addEventListener('click', ev => { ev.preventDefault(); openMemo(); });
      mrow.appendChild(mlb);
      mrow.appendChild(memoBtn);
      foldPart(mrow, 'memo', !!memoDraft.trim());   /* 書きかけがあれば畳まない */
      if (stepOnBoard) fields.appendChild(mrow);
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
    /* リンクが空の泡では「その他」に畳む（Issue #40。Issue #49 で設定から出せる）。入っていれば、いつも出す */
    foldPart(wrap, 'url', !!urlIn.value.trim());
    fields.appendChild(wrap);
  }

  /* ---- 履歴のボタン ----
     アダプタに steps が無ければ出さない。記録が1件も無くても出さない。
     押しても何も無いボタンを作らないため。 */
  const hasSteps = !!(a && typeof a.steps === 'function');
  if (fields && hasSteps) {
    /* 読むだけの入口なので、状態を変えるボタンと同じ強さにしない（レビューの指摘）。
       全幅・同じ角丸・中央揃えだと6個目のアクションに見えていた。
       左寄せの文字だけにして、要約している「作業メモ」のすぐ下へ置く */
    histBtn = el('button', 'bc-hist-open');
    histBtn.type = 'button';
    histBtn.textContent = '履歴を見る ›';   /* 2026-11-19 作業記録の見出しの行に置く */
    histBtn.setAttribute('aria-expanded', 'false');
    histBtn.addEventListener('click', ev => { ev.preventDefault(); openHistory(); });
    histBtn.classList.add('bc-link-btn');
    /* 2026-11-19: 作業記録の見出しの行、［全体を開く ›］の前へ */
    if (dhead) {
      dhead.insertBefore(histBtn, detailBtn || null);
    } else if (memoBtn && memoBtn.parentElement && memoBtn.parentElement.parentElement === fields) {
      fields.insertBefore(histBtn, memoBtn.parentElement.nextSibling);
    } else {
      fields.appendChild(histBtn);
    }
    /* **箱は先に作っておく。**[OK] で1件目が積まれた瞬間に出せるようにするため
       （前は組み立て時に1件も無ければボタンごと作らず、
         積んでも盤を開き直すまで出てこなかった）。
       押しても何も無いボタンは作らない、という決めは守る＝中身が無い間は隠す。 */
    syncHistBtn();
  }

  /* ---- 並べ直す（2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」。モック docs/spec/mock/task-start.html）----
     2026-11-19: 次にやること・作業の記録はメモの位置の「作業記録」1 つにまとめた（step・memo・hist の欄は置かない。履歴は作業記録の見出しの行）。
     上から: 名前 → 次にやること → ［始める］［今日はここまで］［完了にする］ → 担当・コメント（共有の海） → メモ → 日付（やる日・期間・海に戻す日） → タグ
     → 中身のあるリンク・書きかけの作業の記録 → 「その他」 → まれなもの（お気に入り・優先度・リンク・作業の記録・飛び先・削除）。
     欄そのものは上で組んだまま。ここでは置く順と、畳むかどうかだけを決める */
  /* 2026-11-24: 今日大事なこと・先に済ませる（pick）と印の段（prio）は名前のすぐ下（モック mock/choose-1124.html の 3）。畳まない */
  const ORDER = ['name', 'step', 'acts', 'who', 'notes', 'detail', 'dates', 'tags', 'prio', 'pick', 'fav', 'url', 'memo', 'hist', 'jump', 'del'];
  if (fields) {
    /* お気に入りは、印が付いていても「その他」へ（付いていれば名前の横に印を出す）。設定で選んだときは外に */
    ['fav'].forEach(p => fields.querySelectorAll(':scope > [data-part="' + p + '"]')
      .forEach(n => { if (!boardShow.has(p)) n.classList.add('is-extra'); }));
    if (nameIn) {
      /* 2026-11-24: 急ぐ・大事は名前のすぐ下の印の段に見えるので、ここはお気に入りの ☆ だけ */
      const marks = [];
      if (ask(a, 'isFav', id) === true) marks.push('☆');
      if (marks.length) {
        const mk = el('span', 'bc-marks', marks.join(' '));
        mk.setAttribute('aria-label', 'お気に入り');
        mk.dataset.name = 'お気に入りの印';
        nameIn.parentElement.appendChild(mk);
      }
      /* プロジェクトの名前（記録の形の版 2。2026-11-24 ユーザーの決定）。読むだけ。作る・直すのは gantt。
         指す先が無い・消えたプロジェクトなら出さない（「プロジェクトなし」として読む。値は残す） */
      const proj = ask(a, 'projectOf', id);
      if (proj && typeof proj.name === 'string' && proj.name.trim()) {
        const pj = el('span', 'bc-proj');
        pj.dataset.name = 'プロジェクトの名前';
        const dot = el('span', 'bc-proj-dot');
        dot.setAttribute('aria-hidden', 'true');
        if (typeof proj.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(proj.color)) dot.style.background = proj.color;
        pj.appendChild(dot);
        const nm = el('span', 'bc-proj-nm');
        nm.textContent = 'プロジェクト：' + proj.name.trim().slice(0, 60);   /* ほかの app が書いた字。innerHTML には入れない */
        pj.appendChild(nm);
        if (proj.status === 'paused' || proj.status === 'done') {
          const st = el('span', 'bc-proj-st');
          st.textContent = proj.status === 'done' ? '（終えた）' : '（止めている）';
          pj.appendChild(st);
        }
        nameIn.parentElement.appendChild(pj);
      }
    }
    /* 日付の段（決めてほしいこと 4）: やる日・期間（・長期保留なら海に戻す日）の札を 2 列に並べ、開いた暦はその下に広げる */
    /* 2026-11-19: くりかえしを 3 つ目の札に（3 列）。1 つを開くと、ほかの開いている札を閉じる（盤を長くしない） */
    const dboxes = ['days', 'span', 'repeat', 'hold'].map(p => fields.querySelector(':scope > [data-part="' + p + '"]')).filter(Boolean);
    if (dboxes.length) {
      const dates = el('div', 'bc-dates');
      dates.dataset.part = 'dates';
      dates.dataset.name = '日付';
      dates.appendChild(el('span', 'bc-lb', '日付'));
      const grid = el('div', 'bc-dates-grid');
      dboxes.forEach(n => { n.classList.add('bc-date-box'); grid.appendChild(n); });
      grid.addEventListener('click', ev => {
        const h = ev.target.closest('.bc-cal-head');
        if (!h || h.getAttribute('aria-expanded') !== 'true') return;
        grid.querySelectorAll('.bc-cal-head[aria-expanded="true"]').forEach(o => { if (o !== h) o.click(); });
      });
      dates.appendChild(grid);
      /* 期間の外の案内（2026-11-23 点検の直し。利用者の指示「残りの3つも直して」）。
         期間の外なので長期保留の海にいる泡に、理由と、海へ出す道（今日に置く・期間を未定にする）を出す。
         どちらも盤の中の札と同じ処理（閉じたときにまとめて書く） */
      if (spanWhy) {
        const sp = ask(a, 'span', id) || {};
        const md = v => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; };
        const range = [md(sp.start), md(sp.due)].filter(Boolean).join('–');
        const why = el('div', 'bc-span-why');
        why.dataset.name = '期間の外の案内';
        const msg = el('p', 'bc-span-why-tx');
        msg.textContent = spanWhy === 'before'
          ? '期間（' + range + '）の外なので、長期保留の海にいる。' + md(sp.start || sp.due) + ' に海へ出る。'
          : '期間（' + range + '）を過ぎたので、長期保留の海にいる。';
        const wacts = el('div', 'bc-span-why-acts');
        const done = text => { msg.textContent = text; wacts.hidden = true; };
        if (todayCell) {
          const b1 = el('button', 'bc-hold-pick', '今日に置く');
          b1.type = 'button';
          b1.dataset.name = '今日に置く';
          b1.addEventListener('click', ev => {
            ev.preventDefault();
            if (!todayCell.has()) todayCell.toggle();
            if (syncTodayChip) syncTodayChip(true);
            done('今日に置いた。盤を閉じると今日の海に出る。');
          });
          wacts.appendChild(b1);
        }
        if (clearSpan) {
          const b2 = el('button', 'bc-hold-pick', '期間を未定にする');
          b2.type = 'button';
          b2.dataset.name = '期間を未定にする';
          b2.addEventListener('click', ev => { ev.preventDefault(); clearSpan(); done('期間を未定にした。盤を閉じると海に出る。'); });
          wacts.appendChild(b2);
        }
        why.appendChild(msg);
        if (wacts.children.length) why.appendChild(wacts);
        dates.appendChild(why);
      }
      /* 長期保留の日の箱は、長期保留でない間は隠れている（hidden）。隠れた箱は数えない（全部畳んだのに「日付」の見出しだけ残らないように。2026-11-24） */
      if (dboxes.every(n => n.classList.contains('is-extra') || n.hidden)) dates.classList.add('is-extra');
      fields.appendChild(dates);
    }
    const tagsBox = fields.querySelector(':scope > [data-part="tags"]');
    if (tagsBox && !tagsBox.querySelector('.bc-tags-lb')) tagsBox.insertBefore(el('span', 'bc-lb bc-tags-lb', 'タグ'), tagsBox.firstChild);
    const whoBox = fields.querySelector(':scope > .bc-who');
    if (whoBox) whoBox.dataset.part = 'who';
    const del = acts ? acts.querySelector('[data-part="del"]') : null;
    if (del) { del.remove(); fields.appendChild(del); }
    if (acts) { acts.dataset.part = 'acts'; fields.appendChild(acts); }
    const rank = n => { const k = ORDER.indexOf(n.dataset.part || ''); return k < 0 ? ORDER.length : k; };
    const kids = [...fields.children].sort((x, y) => rank(x) - rank(y));
    kids.forEach(n => fields.appendChild(n));
  }

  /* ---- 「その他」（Issue #40。2026-11-18 から、まれなものだけをここに 1 か所にまとめる）----
     盤を閉じると畳んだ姿に戻る（Issue #49 の返事）。
     設定の「この端末の表示」で「あまり使わない機能も出す」にしていれば、畳まずに出す（CSS の body.pref-all-tools） */
  /* 中身が無くて隠れている欄（記録の無い履歴など）は数えない。押しても何も出ない「その他」を作らないため */
  const foldedNodes = fields
    ? [...fields.querySelectorAll('.is-extra')].filter(n => !n.hidden && !n.closest('[hidden]'))
    : [];
  if (fields && foldedNodes.length) {
    const more = el('button', 'bc-more');
    more.type = 'button';
    more.dataset.name = 'その他';
    const foldedNames = foldedNodes
      .map(n => BOARD_PART_LABEL[n.dataset.part]).filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    const syncMore = () => {
      fields.classList.toggle('show-extra', boardExtraOpen);
      more.setAttribute('aria-expanded', boardExtraOpen ? 'true' : 'false');
      more.textContent = boardExtraOpen ? 'その他 ▴' : 'その他 ▾';   /* 2026-11-18 中身の並びは開けば見える */
      more.setAttribute('aria-label', (boardExtraOpen ? 'その他を畳む：' : 'その他を開く：') + foldedNames.join('・'));
    };
    more.addEventListener('click', ev => {
      ev.preventDefault();
      boardExtraOpen = !boardExtraOpen;
      syncMore();
      relayout();
    });
    syncMore();
    /* 外に出ている欄のあと、畳んだ欄（.is-extra）の前に置く。畳んだ欄は開いたとき、この下にまとまって出る */
    const extras = [...fields.children].filter(n => n.classList.contains('is-extra'));
    fields.appendChild(more);
    extras.forEach(n => fields.appendChild(n));
  }

  /* 自動で保存した印（2026-11-18。［書き留める］の代わり）。盤の右下に少しの間だけ */
  const savedTag = fields ? el('p', 'bc-saved') : null;
  if (savedTag) {
    savedTag.setAttribute('aria-live', 'polite');
    savedTag.dataset.name = '保存の印';
    fields.appendChild(savedTag);
  }

  if (fields) {
    root.appendChild(fields);
    /* 打ち終えた欄（名前・次にやること・リンク・メモ）から離れたら保存する（2026-11-18 決めてほしいこと 2。［書き留める］の代わり）。
       書くものは前の［書き留める］と同じ applyEdits（盤は閉じない）。変わっていなければ何もしない。閉じるときにも今までどおり書く */
    let savedTimer = 0;
    const snap = () => [nameIn && nameIn.value, stepIn && stepIn.value, urlIn && urlIn.value, detailDraft].join('\u0000');
    let lastSnap = snap();
    fields.addEventListener('focusout', ev => {
      const t = ev.target;
      if (!(t === nameIn || t === stepIn || t === urlIn || t === detailInline)) return;
      if (snap() === lastSnap) return;
      const said = applyEdits();
      lastSnap = snap();
      if (savedTag && said === '書き留めた') {
        savedTag.textContent = '保存した';
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => { savedTag.textContent = ''; }, 1600);
      }
    });
  }

  /* ---- 打ち終わりを待って保存する（打つたびには書かない） ---- */
  let stepTimer = 0, urlTimer = 0;

  /* 打った文字を「書きかけ」へ控える。**記録には触らない。**
     預け先が古い（commitStep が無い）版では、いままでどおり次の一手を直に書く
     ——そちらには積む先が無いので、控えても行き場が無い */
  function saveStep() {
    clearTimeout(stepTimer); stepTimer = 0;
    if (!stepIn || !stepOnBoard) return;
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
    if (saveName()) did = true;                      /* 名前 */
    if (saveDetail()) did = true;                    /* 本文 */

    if (!stepIn || !stepOnBoard) { if (did) syncHistBtn(); return did ? '書き留めた' : null; }
    const next = stepIn.value.trim();
    if (!canCommit) { ask(a, 'setFirstStep', id, next); return '書き留めた'; }

    const cur = String(ask(a, 'firstStep', id) || '');
    if (!next) { saveStep(); return next === cur ? '書き留めた' : '次にやることが要る'; }
    if (next === cur) { saveStep(); return '書き留めた'; }

    /* 次の一手が変わったなら、記録として1件積む（git のコミットと同じ形）。
       作業メモは空——あちらは [作業メモを保存] が積む */
    if (!ask(a, 'commitStep', id, { did: '', next: next })) return null;
    draft0 = { did: memoDraft, next: stepIn.value };
    syncHistBtn();
    return '書き留めた';
  }

  /* 名前。空や同じ名前なら何もしない（store が弾く）-> 変わったか */
  function saveName() {
    if (!nameIn) return false;
    const v = nameIn.value.trim();
    if (!v) { nameIn.value = String(ask(a, 'text', id) || ''); return false; }   /* 空は戻す */
    return ask(a, 'setText', id, v) === true;
  }

  /* 本文。空は「本文なし」として通す（名前と違う）。同じなら store が弾く -> 変わったか */
  function saveDetail() {
    if (!detailBtn) return false;
    if (detailPane && !detailPane.hidden && detailArea) detailDraft = detailArea.value;
    /* 2026-11-19 作業記録: 変わったときだけ書き、記録（steps）へ 1 件積む＝履歴になる。
       記録の next には 1 行目を入れる（集中画面・一覧の「次にやること」に出る）。空にしたときは積まない */
    const v = detailDraft.trim();
    if (v === rec0.trim()) return false;
    ask(a, 'setDetail', id, v);
    if (v && canCommit) ask(a, 'commitStep', id, { did: v, next: firstLineOf(v) });
    rec0 = detailDraft;
    syncDetailBtn();                              /* ［全体を開く ›］は中身があるときだけ */
    syncHistBtn();
    return true;
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
    ttl.textContent = '作業記録の履歴';   /* 2026-11-19 */
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
    /* 直せる版のときだけ「直す」を出す（口が無ければボタンも出さない） */
    const can = !!(a && typeof a.editStep === 'function');
    /* 直したら、その場で引き直す。いちばん新しい記録を直すと
       「次の一手」も付いていくので、盤の欄も入れ直す */
    const onEdit = (at, entry) => {
      if (ask(a, 'editStep', id, at, entry) === false) return false;
      renderHist(ask(a, 'steps', id) || []);
      if (stepIn) {
        const v = ask(a, 'firstStep', id);
        if (typeof v === 'string') stepIn.value = v;
      }
      return true;
    };
    fillStepList(histList, rows, can ? onEdit : null);
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
    memoPane.setAttribute('aria-label', '作業の記録');
    memoPane.hidden = true;

    const head = el('div', 'bm-head');
    head.appendChild(el('span', 'bm-title', '作業の記録'));
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
    memoArea.setAttribute('aria-label', '作業の記録');
    memoArea.addEventListener('input', () => {
      memoDraft = memoArea.value;
      clearTimeout(stepTimer);
      stepTimer = setTimeout(saveStep, SAVE_MS);   /* 書きかけへ控えるだけ */
    });
    memoPane.appendChild(memoArea);

    const save = el('button', 'bm-save', '作業の記録に足す');
    save.type = 'button';
    let back = 0;
    save.addEventListener('click', ev => {
      ev.preventDefault();
      const said = saveMemo();
      clearTimeout(back);
      save.textContent = said;
      save.classList.toggle('is-nope', said !== '記録した');
      back = setTimeout(() => {
        save.textContent = '作業の記録に足す';
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
    if (!next) return '次にやることが要る';
    if (!ask(a, 'commitStep', id, { did: did, next: next })) return 'まだ積めない';
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
      ? '次にやること：' + stepIn.value.trim()
      : '次にやることを書くと、ここから記録が積める';
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

  /* ---- 本文の面（Issue #8）----
     作業メモの面と同じ入れ替え方・同じ形（.bc-memo / .bm-*）。
     違うのは [作業メモを保存] が無いこと。本文は積む記録ではないので、
     [閉じる] で書き替える（盤を閉じたとき・[OK] のときも同じ）。

     ■ 読む面と書く面（Issue #16）
     前は入口を押すとすぐ入力欄に焦点が入り、スマホではキーボードが立ち上がって
     本文の半分が隠れた。本文は「書き替える」より「読み返す」ほうが多い。
     だから本文があるときは、まず**読む面**で開く（焦点は入力欄に入れない＝キーボードは出ない）。
     読む面は画面の上から下タブの手前まで広げ（泡の上にも重ねる）、横幅も広げる。
     書き替えるときは見出しの [編集] を押す。そこで初めて入力欄が出て焦点が入る。
     本文がまだ無いときは読むものが無いので、いままでどおり書く面で開く。 */
  function syncDetailBtn() {
    if (!detailBtn) return;
    const t = detailDraft.trim();
    detailBtn.textContent = '全体を開く ›';
    detailBtn.hidden = !t;
    detailBtn.classList.toggle('is-empty', !t);
    detailBtn.setAttribute('aria-label', '作業記録の全体を開く（読む・書く）');
    if (detailInline && document.activeElement !== detailInline && detailInline.value !== detailDraft) detailInline.value = detailDraft;
    if (syncSpanRow) syncSpanRow();
  }

  /* 読む面か書く面かを切り替える。editing=true で入力欄を出す。

     書く面の見出しは [キャンセル] [保存]（Issue #35）。
     前は [閉じる] だけで、書き替えを確かめる道も、やめる道も無かった
     （外を触っても閉じても、そのまま上書きされた）。
     ・[保存]     … 書いた本文を残して盤へ戻る
     ・[キャンセル] … 書く面に入ったときの本文へ戻して盤へ戻る（何も書き替えない）
     ・Esc       … 残して本文の面を閉じ、盤へ戻る（打った文字を黙って捨てない）
     ・外を触る   … 書く面の間は何も起きない（Issue #55。前は残して盤ごと閉じ、海へ戻った） */
  function setDetailMode(editing) {
    if (!detailPane) return;
    detailPane.classList.toggle('is-reading', !editing);
    detailView.hidden = editing;
    detailArea.hidden = !editing;
    detailEdit.hidden = editing;
    detailClose.hidden = editing;
    detailSave.hidden = !editing;
    detailCancel.hidden = !editing;
    if (editing) detailBase = detailDraft;
    detailNote.textContent = editing ? '[保存] で残る。[キャンセル] で書く前に戻す。書いている間は外を触っても閉じない。履歴には積まない' : '';
    detailNote.hidden = !editing;
    if (!editing) detailView.textContent = detailDraft;   /* 改行は CSS の pre-wrap で出す */
  }

  function isDetailReading() {
    return !!(detailPane && !detailPane.hidden && detailPane.classList.contains('is-reading'));
  }

  function buildDetail() {
    detailPane = el('div', 'bc-memo bc-detail');
    detailPane.setAttribute('role', 'group');
    detailPane.setAttribute('aria-label', '作業記録');
    detailPane.hidden = true;

    const head = el('div', 'bm-head');
    head.appendChild(el('span', 'bm-title', '作業記録'));
    const btns = el('div', 'bm-btns');
    detailEdit = el('button', 'bm-close bm-edit', '編集');
    detailEdit.type = 'button';
    detailEdit.setAttribute('aria-label', '本文を編集');
    detailEdit.addEventListener('click', ev => {
      ev.preventDefault();
      setDetailMode(true);
      relayout();
      detailArea.focus({ preventScroll: true });
    });
    btns.appendChild(detailEdit);
    const close = el('button', 'bm-close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', ev => { ev.preventDefault(); closeDetail(true); });
    btns.appendChild(close);
    detailClose = close;
    /* 書く面だけに出す2つ（Issue #35）。見出しに置くのは、スマホでキーボードが
       下半分を隠しても押せるように。強いほう（保存）を右＝いつもの [閉じる] の場所に */
    detailCancel = el('button', 'bm-close bm-cancel', 'キャンセル');
    detailCancel.type = 'button';
    detailCancel.setAttribute('aria-label', '本文の書き替えをやめる');
    detailCancel.addEventListener('click', ev => { ev.preventDefault(); cancelDetail(); });
    btns.appendChild(detailCancel);
    detailSave = el('button', 'bm-close bm-ok', '保存');
    detailSave.type = 'button';
    detailSave.setAttribute('aria-label', '本文を保存して閉じる');
    detailSave.addEventListener('click', ev => { ev.preventDefault(); closeDetail(true); });
    btns.appendChild(detailSave);
    head.appendChild(btns);
    detailPane.appendChild(head);
    detailPane._close = close;

    /* 何の本文なのかを、書く前に読めるようにする（いまの名前） */
    const ctx = el('p', 'bm-ctx');
    detailPane.appendChild(ctx);
    detailPane._ctx = ctx;

    /* 読む面。入力欄ではないのでキーボードは出ない。長いときはこの中だけでスクロール */
    detailView = el('div', 'bm-view');
    detailView.tabIndex = 0;                      /* キーボードでもスクロールできるように */
    detailView.setAttribute('role', 'document');
    detailView.setAttribute('aria-label', '本文');
    detailPane.appendChild(detailView);

    detailArea = document.createElement('textarea');
    detailArea.className = 'bm-in';
    detailArea.rows = 6;
    detailArea.placeholder = '何を・どこで・気をつけること など';
    detailArea.setAttribute('aria-label', '本文');
    detailArea.addEventListener('input', () => { detailDraft = detailArea.value; });
    detailPane.appendChild(detailArea);

    detailNote = el('p', 'bm-said', '');
    detailPane.appendChild(detailNote);

    /* サーバーあり版では AI の欄を出さない（2026-11-17 Issue #78。js/edition.js） */
    if (aiOn()) buildAi();
    root.appendChild(detailPane);
  }

  /* ---- 本文の面の AI（Issue #17）----
     「AI で調べる」… 名前と本文を読み、Web で調べてまとめたものを、本文の末尾に足す案として見せる。
     「AI で整理」 … 本文を見出しと箇条書きに整えた案を見せる（置き換えるので、押したときだけ入れる）。
     どちらも案を見せてから [本文に足す]／[置き換える] で入れる。入れたあとは [元に戻す] が出る。
     書き込みは本文のほかの書き方と同じく、面を閉じるとき（saveDetail）。
     キーが無いときもボタンは押せて、押すと「どこで入れるか」を出す（押して何も起きない、にしない）。 */
  function buildAi() {
    const box = el('div', 'bm-ai');
    const row = el('div', 'bm-ai-row');
    const research = el('button', 'bm-ai-btn', 'AI で調べる');
    research.type = 'button';
    const tidy = el('button', 'bm-ai-btn', 'AI で整理');
    tidy.type = 'button';
    /* 「AI で名前」（Issue #11）… 名前と本文から、泡に収まる（18 字以内の）名前の案を作る。
       [名前にする] で盤の名前の欄に入れる（書くのはほかと同じく盤を閉じるとき）。
       本文が空で名前が長ければ、元の名前を本文へ移す（打った全文を失わない） */
    const naming = nameIn ? el('button', 'bm-ai-btn', 'AI で名前') : null;
    if (naming) naming.type = 'button';
    row.appendChild(research);
    row.appendChild(tidy);
    if (naming) row.appendChild(naming);
    /* 「書いて頼む」（Issue #15 案 A）… 欄に調べてほしいことを書いて送る。
       送るのは名前と書いた文だけ（本文は送らない）。まとめは本文に足し、
       期限が分かれば「期限の数日前の日に置く」、関連 TODO は候補から選んだものだけ作る（既定はどれも選ばない） */
    const askRow = el('form', 'bm-ai-row bm-ai-ask');
    const askIn = document.createElement('input');
    askIn.type = 'text';
    askIn.className = 'bm-ai-askin';
    askIn.maxLength = ASK_MAX;
    askIn.placeholder = '調べてほしいことを書く（例: 期限とお得な方法）';
    askIn.setAttribute('aria-label', 'AI に調べてほしいこと');
    askIn.setAttribute('enterkeyhint', 'send');
    const askBtn = el('button', 'bm-ai-btn', '送る');
    askBtn.type = 'submit';
    askRow.appendChild(askIn);
    askRow.appendChild(askBtn);
    box.appendChild(askRow);
    box.appendChild(row);
    const said = el('p', 'bm-ai-said');
    said.setAttribute('role', 'status');
    said.setAttribute('aria-live', 'polite');
    box.appendChild(said);

    const pre = el('div', 'bm-ai-pre');
    pre.hidden = true;
    const preTx = el('div', 'bm-ai-tx');
    preTx.tabIndex = 0;
    preTx.setAttribute('aria-label', 'AI の案');
    const preWarn = el('p', 'bm-ai-warn');
    preWarn.hidden = true;
    const preBtns = el('div', 'bm-ai-row');
    const apply = el('button', 'bm-ai-btn is-main');
    apply.type = 'button';
    const cancel = el('button', 'bm-ai-btn', 'やめる');
    cancel.type = 'button';
    preBtns.appendChild(apply);
    preBtns.appendChild(cancel);
    /* 書いて頼んだときだけ: 期限の日に置くか・関連 TODO の候補（どれも既定で外す） */
    const preOpts = el('div', 'bm-ai-opts');
    preOpts.hidden = true;
    pre.appendChild(preTx);
    pre.appendChild(preWarn);
    pre.appendChild(preOpts);
    pre.appendChild(preBtns);
    box.appendChild(pre);

    const undo = el('button', 'bm-ai-btn bm-ai-undo', '元に戻す');
    undo.type = 'button';
    undo.hidden = true;
    box.appendChild(undo);

    const note = el('p', 'bm-ai-note',
      '「送る」は、この泡の名前と書いた文だけを設定で選んだ AI の会社へ送る（本文は送らない）。下のボタンは名前と本文を送る。料金はキーの持ち主に掛かる。');
    box.appendChild(note);
    detailPane.appendChild(box);

    let busy = false;
    let proposal = null;     /* { kind, text } 入れる前の案 */
    let before = null;       /* 入れる前の本文（元に戻す用） */
    let beforeName = null;   /* 入れる前の名前（AI で名前のとき） */
    let madeIds = [];        /* 書いて頼んだときに作った関連 TODO（元に戻す用） */
    let placedDay = null;    /* 書いて頼んだときに置いた日（元に戻す用。もとから置いてあった日は入れない） */

    const curText = () => ((detailArea && !detailArea.hidden) ? detailArea.value : detailDraft);
    const curName = () => (nameIn ? nameIn.value.trim() : String(ask(a, 'text', id) || ''));
    const setBusy = b => {
      busy = b;
      research.disabled = b; tidy.disabled = b; askBtn.disabled = b;
      if (naming) naming.disabled = b;
      box.classList.toggle('is-busy', b);
    };
    const putText = t => {
      detailDraft = t;
      if (detailArea) detailArea.value = t;
      if (detailView && !detailView.hidden) detailView.textContent = t;
      syncDetailBtn();
    };
    const hidePre = () => { proposal = null; pre.hidden = true; preOpts.hidden = true; preOpts.textContent = ''; relayout(); };
    const checkRow = (label, data) => {
      const lab = el('label', 'bm-ai-check');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = false;
      Object.keys(data).forEach(k => { cb.dataset[k] = data[k]; });
      lab.appendChild(cb);
      const sp = el('span');
      sp.textContent = label;                   /* el の第3引数は innerHTML。AI の文は HTML にしない（Issue #14） */
      lab.appendChild(sp);
      preOpts.appendChild(lab);
      return cb;
    };
    const mdOf = k => (+k.slice(5, 7)) + '/' + (+k.slice(8, 10));

    async function run(kind) {
      if (busy) return;
      undo.hidden = true;
      hidePre();
      if (!hasKey()) {
        said.textContent = 'API キーがまだ入っていない。設定の「AI を使う設定をする」で AI の会社を選び、その API キーを入れると使える。';
        relayout();
        return;
      }
      const text = curText();
      const name = curName();
      if (kind === 'name' && !text.trim() && !name) {
        said.textContent = '名前も本文もまだ無い。';
        relayout();
        return;
      }
      const request = kind === 'ask' ? askIn.value.trim() : '';
      if (kind === 'ask' && !request) {
        said.textContent = '調べてほしいことを欄に書いてから送る。';
        relayout();
        return;
      }
      if (kind === 'tidy' && !text.trim()) {
        said.textContent = '整える本文がまだ無い。先に本文を書くか、「AI で調べる」を押す。';
        relayout();
        return;
      }
      setBusy(true);
      said.textContent = kind === 'tidy' ? '整えている…' : kind === 'name' ? '名前を考えている…' : '調べている…（数十秒かかることがある）';
      relayout();
      try {
        const today = String(ask(a, 'todayKey') || '') || localDay();
        let r;
        if (kind === 'name') {
          const p = buildNamePrompt(name, text);
          r = await askFull(p.system, p.user, { maxTokens: 2000 });
        } else if (kind === 'tidy') {
          const p = buildTidyPrompt(name, text);
          r = await askFull(p.system, p.user, { maxTokens: 8000 });
        } else if (kind === 'ask') {
          const p = buildAskPrompt(name, request, today);      /* 名前と書いた文だけ（案 A） */
          r = await askWithSearchFull(p.system, p.user, { maxUses: 5 });
        } else {
          const p = buildResearchPrompt(name, text, today);
          r = await askWithSearchFull(p.system, p.user, { maxUses: 3 });
        }
        if (!box.isConnected) return;               /* 盤が閉じていたら捨てる */
        const parsed = kind === 'ask' ? parseAskReply(r.text, today) : null;
        const out = kind === 'name' ? cleanName(r.text) : kind === 'ask' ? parsed.summary : cleanText(r.text);
        if (!out || r.stop === 'max_tokens' || r.stop === 'refusal') {
          said.textContent = failLine(kind, r.stop, r.searchError);
          return;
        }
        if (kind === 'name') {
          const nx = applyName(curName(), curText(), out);
          proposal = { kind, text: nx.detail, name: nx.name };
          preTx.textContent = out;
          preWarn.textContent = nx.detail !== curText() ? '本文が空なので、いまの名前は本文へ移す。' : '';
          preWarn.hidden = !preWarn.textContent;
          apply.textContent = '名前にする';
          said.textContent = '名前の案。名前にするまで変わらない。';
          pre.hidden = false;
          return;
        }
        if (kind === 'ask') {
          proposal = { kind, text: appendSection(curText(), askSectionText(request, out, parsed.deadline), today), name, today, day: null, todos: [] };
          preTx.textContent = out;
          preWarn.hidden = true;
          preOpts.textContent = '';
          const day = parsed.deadline ? leadDay(parsed.deadline, today) : null;
          if (day) {
            const dn = day === parsed.deadline ? '期限の日' : '期限の' + DEADLINE_LEAD + '日前';
            checkRow('期限 ' + mdOf(parsed.deadline) + '。' + (day === today ? '今日' : mdOf(day) + '（' + dn + '）') + 'に置く', { day });
          }
          if (parsed.todos.length) preOpts.appendChild(el('p', 'bm-ai-note', '関連 TODO の案（選んだものだけ作る）'));
          parsed.todos.forEach(t => checkRow(t, { todo: t }));
          preOpts.hidden = !preOpts.childNodes.length;
          apply.textContent = '本文に足す';
          said.textContent = '調べた結果。足すまで本文は変わらない。期限の日・関連 TODO は印を付けたものだけ入れる。';
          pre.hidden = false;
          preTx.scrollTop = 0;
          return;
        }
        proposal = { kind, text: kind === 'tidy' ? out : appendSection(curText(), out, today) };
        preTx.textContent = out;
        const lost = kind === 'tidy' ? lostUrls(text, out) : [];
        preWarn.textContent = lost.length ? '元の本文にあった URL が案に無い: ' + lost.join(' ') : '';
        preWarn.hidden = !lost.length;
        apply.textContent = kind === 'tidy' ? '置き換える' : '本文に足す';
        said.textContent = kind === 'tidy' ? '整えた案。置き換えるまで本文は変わらない。' : '調べた結果。足すまで本文は変わらない。';
        pre.hidden = false;
        preTx.scrollTop = 0;
      } catch (e) {
        if (box.isConnected) said.textContent = 'うまくいかなかった: ' + ((e && e.message) || e);
      } finally {
        setBusy(false);
        if (box.isConnected) relayout();
      }
    }

    research.addEventListener('click', ev => { ev.preventDefault(); run('research'); });
    askRow.addEventListener('submit', ev => { ev.preventDefault(); run('ask'); });
    if (naming) naming.addEventListener('click', ev => { ev.preventDefault(); run('name'); });
    tidy.addEventListener('click', ev => { ev.preventDefault(); run('tidy'); });
    apply.addEventListener('click', ev => {
      ev.preventDefault();
      if (!proposal) return;
      const kind = proposal.kind;
      before = curText();
      beforeName = null;
      madeIds = [];
      placedDay = null;
      if (kind === 'ask') {
        let made = 0;
        let placed = '';
        preOpts.querySelectorAll('input[type=checkbox]').forEach(cb => {
          if (!cb.checked) return;
          if (cb.dataset.day) {
            const had = (ask(a, 'days', id) || []).indexOf(cb.dataset.day) >= 0;
            ask(a, 'setDay', id, cb.dataset.day, true);
            if (!had) placedDay = cb.dataset.day;
            placed = cb.dataset.day;
          } else if (cb.dataset.todo) {
            const nid = ask(a, 'addRelated', id, cb.dataset.todo, relatedDetail(proposal.name, proposal.today));
            if (nid) { madeIds.push(nid); made++; }
          }
        });
        putText(proposal.text);
        said.textContent = '本文の終わりに足した' + (placed ? '。' + mdOf(placed) + 'に置いた' : '')
          + (made ? '。関連 TODO を ' + made + ' 件作った' : '') + '。閉じると残る。';
        askIn.value = '';
        undo.hidden = false;
        hidePre();
        const v = (detailView && !detailView.hidden) ? detailView : detailArea;
        if (v) v.scrollTop = v.scrollHeight;
        return;
      }
      if (kind === 'name') {
        beforeName = nameIn.value;
        nameIn.value = proposal.name;
        if (proposal.text !== before) putText(proposal.text);
        if (detailPane._ctx) detailPane._ctx.textContent = '名前：' + proposal.name;
        said.textContent = '名前を替えた。閉じると残る。';
        undo.hidden = false;
        hidePre();
        return;
      }
      putText(proposal.text);
      said.textContent = kind === 'tidy' ? '置き換えた。閉じると残る。' : '本文の終わりに足した。閉じると残る。';
      undo.hidden = false;
      hidePre();
      const v = (detailView && !detailView.hidden) ? detailView : detailArea;
      if (v) v.scrollTop = kind === 'tidy' ? 0 : v.scrollHeight;   /* 足したところを見せる */
    });
    cancel.addEventListener('click', ev => { ev.preventDefault(); said.textContent = ''; hidePre(); });
    undo.addEventListener('click', ev => {
      ev.preventDefault();
      if (before == null) return;
      putText(before);
      madeIds.forEach(nid => ask(a, 'removeTodo', nid));
      madeIds = [];
      if (placedDay) { ask(a, 'setDay', id, placedDay, false); placedDay = null; }
      if (beforeName != null && nameIn) {
        nameIn.value = beforeName;
        if (detailPane._ctx) detailPane._ctx.textContent = beforeName.trim() ? '名前：' + beforeName.trim() : '';
        beforeName = null;
      }
      before = null;
      undo.hidden = true;
      said.textContent = '元に戻した。';
      relayout();
    });
  }

  function openDetail() {
    if (!detailPane) buildDetail();
    const nm = nameIn ? nameIn.value.trim() : String(ask(a, 'text', id) || '');
    detailPane._ctx.textContent = nm ? '名前：' + nm : '';
    detailArea.value = detailDraft;
    const editing = !detailDraft.trim();          /* 本文が無いときだけ、すぐ書く面 */
    setDetailMode(editing);
    detailPane.hidden = false;
    if (fields) fields.hidden = true;
    relayout();
    if (editing) detailArea.focus({ preventScroll: true });
    else {
      detailView.scrollTop = 0;
      detailPane._close.focus({ preventScroll: true });   /* 入力欄に入れない＝キーボードを出さない */
    }
  }

  /* 戻り値：閉じたかどうか（Escape の受け手が「自分で処理した」を知るため） */
  function closeDetail(restoreFocus) {
    if (!detailPane || detailPane.hidden) return false;
    saveDetail();                                 /* 閉じたら書き替える */
    detailPane.hidden = true;
    if (fields) fields.hidden = false;
    syncDetailBtn();
    relayout();
    if (restoreFocus && detailBtn && detailBtn.isConnected) detailBtn.focus({ preventScroll: true });
    return true;
  }

  /* [キャンセル]（Issue #35）。書く面に入ったときの本文へ戻してから閉じる。
     閉じるときの保存（saveDetail）は戻した本文を書くので、店から見れば何も変わらない */
  function cancelDetail() {
    if (!detailPane || detailPane.hidden) return;
    detailDraft = detailBase;
    if (detailArea) detailArea.value = detailBase;
    closeDetail(true);
  }

  /* ---- ひとことの面（Issue #25）----
     作業メモの面と同じ入れ替え方・同じ形（.bc-memo / .bm-*）。
     上に古い順の一覧（書いた人・時刻・文。消すボタンは無い。Issue #61）、
     下に名前と入力欄と [書く]。[書く] でその場で1件積む（作業メモの [作業メモを保存] と同じ）。
     書きかけは、盤を閉じても泡ごとに残す（noteDrafts。記録には入れない） */
  function notesNow() {
    const rows = ask(a, 'notes', id);
    return Array.isArray(rows) ? rows : [];
  }

  /* 行の右のボタン（全部の履歴と名前の面を開く）と、本文の下のチャットの形（新しい 3 件）を今の記録にそろえる */
  function syncNotesBtn() {   /* CHAT_SHOW はファイルの上（盤を組む途中で呼ぶので、ここで const にしない。Issue #63） */
    if (!notesBtn) return;
    const rows = notesNow();
    const live = rows.filter(n => !n.gone);
    const fresh = ask(a, 'hasNewNote', id) === true;
    /* 面は前のものを読むだけになった（Issue #70 の返事）。盤に出ていない古いもの（3 件より前）があるときだけ出す */
    notesBtn.textContent = 'すべて見る ›';   /* 2026-11-18 前のものも見る → すべて見る */
    notesBtn.hidden = rows.length <= CHAT_SHOW;
    notesBtn.classList.toggle('is-empty', !live.length);
    notesBtn.classList.toggle('is-fresh', fresh);
    notesBtn.setAttribute('aria-label', fresh ? 'コメントをすべて見る（新しいものあり）' : 'コメントをすべて見る');
    renderChat(rows);
  }

  /* 本文の下のチャットの形（Issue #61）。新しい 3 件を古い順に。自分の端末で書いたものは右（is-mine） */
  function renderChat(rows) {
    if (!chatList) return;
    chatList.textContent = '';
    const show = rows.slice(-CHAT_SHOW);
    chatList.hidden = !show.length;
    show.forEach(n => {
      const li = el('li', 'bn-msg' + (ask(a, 'isMyNote', n) === true ? ' is-mine' : '') + (n.gone ? ' is-gone' : ''));
      const meta = el('div', 'bn-meta');
      /* 書いた人と文は、ほかの端末の人が書いた文字。el の第3引数は innerHTML なので使わない（Issue #14） */
      const by = el('span', 'bn-by'); by.textContent = n.by || '名前なし'; meta.appendChild(by);
      meta.appendChild(el('span', 'bn-at', fmtAt(n.at)));
      sigMark(meta, n);
      li.appendChild(meta);
      const tx = el('p', 'bn-tx'); tx.textContent = n.gone ? '（消した）' : String(n.text || ''); li.appendChild(tx);
      chatList.appendChild(li);
    });
    chatList.scrollTop = chatList.scrollHeight;
  }

  /* 書いた人の印（Issue #61 の N-A）。ブロックチェーンで共有している海だけ、名前の横に
     「✓ 呼び名」（名簿のアドレスの署名が合った）か「（確かめられない）」を出す。確かめは非同期なので、あとから埋める */
  function sigMark(meta, n) {
    if (n.gone || ask(a, 'noteSigned') !== true) return;
    const mk = el('span', 'bn-sig');
    meta.appendChild(mk);
    const p = ask(a, 'checkNote', n);
    if (!p || typeof p.then !== 'function') return;
    p.then(r => {
      if (r && r.ok) { mk.textContent = '✓ ' + r.name; mk.classList.add('is-ok'); mk.title = 'ウォレットの署名で確かめた書き手'; }
      /* この端末で書いて、まだ署名していないもの（書くときは鍵を求めず、「同期」で送るときに署名する。Issue #68） */
      else if (!n.sg && ask(a, 'isMyNote', n) === true) { mk.textContent = '（同期で送るときに署名する）'; mk.title = '「同期」を押すと、ウォレットで署名して届ける'; }
      else { mk.textContent = '（確かめられない）'; mk.title = '書き手の署名が無いか、名簿に無い'; }
    }, () => { mk.textContent = '（確かめられない）'; });
  }

  /* 1 件積む。ブロックチェーンで共有している海では署名してから（パスキーを求めることがある）。
     done(言葉) で結果を返す。署名のときは非同期なので、先に '署名中…' を返す。
     押した手の続きでパスキーを呼ぶため、ここより前で await しない */
  function postNote(t, after, done) {
    /* 送るときに読み込みだけもする（2026-11-15 Issue #68 の返事「TODOのメッセージを送る時に読み込みだけは行った方がいいのでは？」）。
       ブロックチェーンで共有している海だけ。書き込み（手数料）はしない（それは「同期」）。鍵は 10 分だけメモリに置くので、続けて送るときは求めない。
       押した手の続きでパスキーを呼ぶため、ひとことを積むより先に、await せずに始める */
    if (ask(a, 'shareSyncOn') === true) {
      const r = holdWhile(ask(a, 'readShared', null));
      if (r && typeof r.then === 'function') {
        r.then(() => { syncNotesBtn(); if (notesPane && !notesPane.hidden) renderNotes(); }, e => {
          /* 読めなくても、ひとことは積んである。止まった理由だけ出す（やめたときは出さない） */
          const m = String((e && e.message) || e || '');
          if (m && !/やめた/.test(m)) longToast('読み込めなかった: ', m);
        });
      }
    }
    if (ask(a, 'noteSigning') === true) {
      const p = ask(a, 'addNoteSigned', id, t);
      if (!p || typeof p.then !== 'function') return done('まだ書けない');
      p.then(n => { if (!n) return done('まだ書けない'); after(); pushDirect(); done('投稿した'); },
        e => done(e && /やめた/.test(String(e.message || e)) ? 'やめた' : '署名できない'));
      return '署名中…';
    }
    if (!ask(a, 'addNote', id, t)) return 'まだ書けない';
    after();
    pushDirect();
    return '投稿した';
  }
  /* 直につながっている相手がいれば、積んだひとことを含む記録をすぐ送る（手数料なし。2026-11-16 Issue #68 の C1）。
     つながっていなければ何もしない（ひとことは「同期」で届く） */
  function pushDirect() {
    const p = ask(a, 'pushShared');
    if (p && typeof p.then === 'function') {
      /* 直につながっていないときも、そう知らせる（Issue #68 の返事「動いてないように見える」: 送れたかどうかが盤で分からなかった） */
      p.then(n => {
        if (n > 0) toast('直につながっている ' + n + ' 台に送った（手数料なし）');
        else if (ask(a, 'shareSyncOn') === true) toast('直につながっている相手がいないので、ひとことは「同期」で届ける');
      }, () => { /* 届かなくても同期で届く */ });
    }
  }

  /* 本文の下の 1 行の欄から積む -> ボタンに出す言葉（done は署名のときの後の言葉） */
  function sendQuick(done) {
    const t = chatIn ? chatIn.value.trim() : '';
    if (!t) return '書いてから';
    return postNote(t, () => {
      if (chatIn && chatIn.value.trim() === t) chatIn.value = '';
      noteDrafts.delete(id);
      ask(a, 'markNotesSeen', id);
      document.querySelectorAll('.bub[data-id="' + String(id).replace(/["\\]/g, '') + '"] .ndot')
        .forEach(d => { d.hidden = true; });
      syncNotesBtn();
      if (notesPane && !notesPane.hidden) renderNotes();
    }, done || (() => {}));
  }

  function renderNotes() {
    if (!notesList) return;
    const rows = notesNow();
    notesList.textContent = '';
    if (!rows.length) {
      notesList.appendChild(el('li', 'bn-empty', 'まだ無い。ここまでやったこと・詰まっていることを短く'));
      return;
    }
    rows.forEach(n => {
      const li = el('li', 'bn-item' + (n.gone ? ' is-gone' : ''));
      const meta = el('div', 'bn-meta');
      /* 書いた人とひとことは、ほかの端末の人が書いた文字。el の第3引数は innerHTML なので使わない（Issue #14） */
      const by = el('span', 'bn-by'); by.textContent = n.by || '名前なし'; meta.appendChild(by);
      meta.appendChild(el('span', 'bn-at', fmtAt(n.at)));
      sigMark(meta, n);
      /* 消すボタンは置かない（2026-11-14 Issue #61 の返事「消さない」）。前の版で消したものは「（消した）」のまま出す */
      li.appendChild(meta);
      const tx = el('p', 'bn-tx'); tx.textContent = n.gone ? '（消した）' : String(n.text || ''); li.appendChild(tx);
      notesList.appendChild(li);
    });
  }

  function buildNotes() {
    notesPane = el('div', 'bc-memo bc-notes');
    notesPane.setAttribute('role', 'group');
    notesPane.setAttribute('aria-label', 'コメント');
    notesPane.hidden = true;

    const head = el('div', 'bm-head');
    head.appendChild(el('span', 'bm-title', 'コメント'));
    const close = el('button', 'bm-close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', ev => { ev.preventDefault(); closeNotes(true); });
    head.appendChild(close);
    notesPane.appendChild(head);
    notesPane._close = close;

    const ctx = el('p', 'bm-ctx');
    notesPane.appendChild(ctx);
    notesPane._ctx = ctx;

    /* 番号は振らない（「◯件目」を数えない。§0） */
    notesList = el('ul', 'bn-list');
    notesList.tabIndex = 0;
    notesList.setAttribute('aria-label', 'コメントの一覧（古い順）');
    notesPane.appendChild(notesList);

    /* 2026-11-15 Issue #70 の返事「メッセージを残すがあるからひとこといらないのでは？」:
       前はこの面にも名前の欄・書く欄・[書く] があり、盤の 1 行の欄（ひとことを残す）と書く所が 2 つあった。
       書くのは盤の 1 行の欄だけにし、この面は前のものを読むだけにする。
       続く返事「ひとことの名前を入れる場所はいらないのでは？」で名前の欄も外した。書き手の名前は、
       前に決めた名前か、パスキー・招待で付いた名前のまま（js/notes.js の noteName）。サーバーあり版は設定の海のチャットの欄でも変えられる */
    notesPane.appendChild(el('p', 'bm-ctx', '書くのは詳細の「コメントを書く」の欄から'));

    root.appendChild(notesPane);
  }

  function openNotes() {
    if (!notesPane) buildNotes();
    const nm = nameIn ? nameIn.value.trim() : String(ask(a, 'text', id) || '');
    notesPane._ctx.textContent = nm ? '泡：' + nm : '';
    renderNotes();
    ask(a, 'markNotesSeen', id);                  /* 開いた＝ここまで読んだ */
    document.querySelectorAll('.bub[data-id="' + String(id).replace(/["\\]/g, '') + '"] .ndot')
      .forEach(d => { d.hidden = true; });
    notesPane.hidden = false;
    if (fields) fields.hidden = true;
    relayout();
    notesList.scrollTop = notesList.scrollHeight; /* 新しいほう（下）から読む */
    notesPane._close.focus({ preventScroll: true });   /* 入力欄に入れない＝キーボードを出さない */
  }

  /* 戻り値：閉じたかどうか（Escape の受け手が「自分で処理した」を知るため） */
  function closeNotes(restoreFocus) {
    if (!notesPane || notesPane.hidden) return false;
    notesPane.hidden = true;
    if (fields) fields.hidden = false;
    syncNotesBtn();
    relayout();
    if (restoreFocus && notesBtn && notesBtn.isConnected) notesBtn.focus({ preventScroll: true });
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
      : ((memoPane && !memoPane.hidden) ? memoPane
        : ((detailPane && !detailPane.hidden) ? detailPane
          : ((notesPane && !notesPane.hidden) ? notesPane : fields)));

    /* 本文の読む面（Issue #16）は大きく読む面。泡の下に収めず、
       画面の上の縁から下タブの手前まで、横は画面の真ん中に置く */
    if (isDetailReading() && vh) {
      detailPane.style.left = (vw ? vw / 2 : cx) + 'px';
      detailPane.style.top = CENTER_M + 'px';
      detailPane.style.maxHeight = Math.max(160, barTop - 2 * CENTER_M) + 'px';
      return;
    }

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
      if (detailPane) detailPane.style.maxHeight = cap;
      if (notesPane) notesPane.style.maxHeight = cap;
      if (fields) {
        fields.style.maxHeight = cap;
        /* 入りきらないときだけ、下端をぼかして「続きがある」を出す。
           モバイルではスクロールバーが出ないので、これが唯一の手がかりになる */
        fields.classList.toggle('is-cut', fields.scrollHeight > fields.clientHeight + 1);
      }
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

  /* 飛び先のリンク（2026-11-18 取り決め §7.3）。期間のある泡は gantt、終えた泡は diary。同じタブで移る。
     見るだけの海でも押せる（a は下の disabled の対象でない） */
  const jl = ask(a, 'jumpLinks', id);
  if (Array.isArray(jl) && jl.length) {
    const box = el('div', 'bc-jump');
    box.dataset.name = '飛び先のリンク';
    jl.forEach(j => {
      const link = document.createElement('a');
      link.className = 'bc-jump-a';
      link.href = j.href;
      link.textContent = j.label;
      link.dataset.name = j.name || j.label;
      box.appendChild(link);
    });
    /* 2026-11-18（モック task-start.html）: 「その他」の中、削除の前へ */
    box.dataset.part = 'jump';
    const delNode = fields ? fields.querySelector(':scope > [data-part="del"]') : null;
    if (fields && fields.querySelector(':scope > .bc-more')) { box.classList.add('is-extra'); fields.insertBefore(box, delNode && delNode.classList.contains('is-extra') ? delNode : fields.querySelector(':scope > .bc-saved')); }
    else (fields || root).appendChild(box);
  }

  /* 見るだけ（viewer）の海（2026-11-18）。盤のボタンと欄を押せなくし、そう書く（押しても仲間に届かないため） */
  if (ask(a, 'readOnly') === true) {
    root.classList.add('is-readonly');
    root.querySelectorAll('button, input, textarea, select').forEach(n => { n.disabled = true; });
    const ro = el('p', 'bc-readonly', ask(a, 'readOnlyWhy') || '見るだけの海なので、変えられない');
    ro.dataset.name = '見るだけの印';
    root.insertBefore(ro, root.firstChild);
  }

  /* 輝く泡を開いたときの一行（2026-11-24。js/glow.js）。盤のいちばん上 */
  if (actions && typeof actions.thanks === 'string' && actions.thanks) {
    const th = el('p', 'bc-thanks');
    th.textContent = actions.thanks;
    th.setAttribute('role', 'status');
    th.dataset.name = 'ありがとうの一行';
    /* 盤の札（fields）の中のいちばん上。root の直下に置くと札の外（画面の左上）に出る */
    const box = fields || root;
    box.insertBefore(th, box.firstChild);
    /* 小さな字で、すぐ消える（非常に弱い報酬。2.4 秒。動きを減らす設定でも同じ時刻に外す） */
    setTimeout(() => { if (th.isConnected) th.remove(); }, 2400);
  }

  return {
    root, place,
    /* タグは最後に書く。書いた瞬間に画面が組み直されるので、
       先に書くと 次の一手・リンクの保存先が消えることがある */
    /* 順番に意味がある。長期保留の札を先に書いてから日を足す
       （外れているものに日は付かない＝ store が弾く） */
    flush() {
      if (memoPane && !memoPane.hidden && memoArea) memoDraft = memoArea.value;
      saveStep(); saveUrl(); saveName(); saveDetail();
      if (saveSpan) saveSpan();               /* 期間はくりかえしより先（期間をくりかえすときの元） */
      if (saveRepeat) saveRepeat();           /* くりかえしはやる日より先（回の日を店が入れ替える） */
      if (saveDays) saveDays();               /* 日はタグより先（today を二重に書かない） */
      if (saveTags) saveTags();
      if (saveFav) saveFav();                 /* 印はタグの後ろ。順に意味は無い */
      if (saveWho) saveWho();
      if (savePrio) savePrio();
      if (saveHoldUntil) saveHoldUntil();
    },
    /* 盤の先頭の的。[タスク開始] は盤の中へ移ったので、そこを探す
       （無い版もある——操作が1つも渡っていないとき） */
    focusFirst() {
      const first = root.querySelector('.bc-act-start')
        || root.querySelector('button:not([hidden])');
      if (first) first.focus({ preventScroll: true });
    },
    /* 画面の揺れ（resize・ページの scroll）で盤を閉じてはいけない間か。
       2026-11-15 Issue #70: 前は焦点のある欄が .bc-in（名前・次の一手・リンク）のときだけ真で、
       ひとことの欄（本文の下の 1 行 .bn-quick-in。当時はひとことの面の書く欄・名前の欄も）や日の欄が入っていなかった。
       画面の小さい端末（iPhone SE など）では、下のほうの欄に触るとキーボードの分だけページが動き（scroll）、
       盤が閉じて、書けなかった（大きい画面では欄がキーボードより上にあり、ページが動かないので起きない）。
       盤の中のどの「字を打つ欄」に焦点があっても真にし、焦点が外れた直後も真にする */
    isTyping() {
      if (this.isWriting()) return true;
      if (Date.now() - typedAt < TYPED_GRACE_MS) return true;
      if (document.documentElement.classList.contains('kb-open')) return true;   /* js/boot-dvh.js */
      const el2 = document.activeElement;
      return !!(el2 && root.contains(el2) && isEditableEl(el2));
    },
    /* 書く面（本文の [編集] のあと・作業メモ）が開いているか（Issue #55）。
       開いている間は、覆い・下タブ・画面の揺れ（キーボードの出入り）で盤を閉じない。
       抜けるのは [保存]・[キャンセル]・[閉じる]・Esc だけ。
       前は覆いを触ると盤ごと閉じて海へ戻った（書いた文は残るが、書いている途中で放り出された）。
       また本文の入力欄は .bm-in で、上の .bc-in の判定に入らず、キーボードの出入りでも閉じていた */
    isWriting() {
      if (detailPane && !detailPane.hidden && !detailPane.classList.contains('is-reading')) return true;
      if (memoPane && !memoPane.hidden) return true;
      return false;
    },
    /* Escape をここで先に受ける。履歴が開いていれば、閉じるのは履歴だけ
       （中央から抜けない）。開いていなければ false を返し、中央が閉じる。 */
    handleEscape() { return closeMemo(true) || closeDetail(true) || closeNotes(true) || closeHistory(true); },
  };
}

/* --- 一手の記録の一覧（盤と集中画面で共通） ---

   盤（この中）と集中画面（focus.js）が**同じものを使う**。
   別々に組むと、片方だけ直したときに同じ記録が2つの顔で出ることになる
   （詳細パネルが4実装ある件と同じ轍。DEV_NOTES B-2）。

   スタイルは css/bubble.css の .bh-* が持つ。あれは全画面で読み込まれるので、
   集中画面から使っても CSS を足す必要は無い。
   数え方（「◯件目」「◯回目」）は出さない——§0。 */
/* 記録を直す口（利用者の指示：記録の履歴に編集ボタンを用意して、修正を許可して）。
   差してもらう形にしてあるのは、bubble.js が store を知らないため。
     onEdit(at, { did, next }) -> 直せたか */
export function fillStepList(ul, rows, onEdit) {
  ul.textContent = '';                       /* innerHTML には入れない */
  (Array.isArray(rows) ? rows : []).forEach(s => {
    const li = el('li', 'bh-item');
    const at = fmtAt(s && s.at);
    if (at) {
      const p = el('p', 'bh-at');
      p.textContent = at;
      li.appendChild(p);
    }
    /* 直す。**時刻は直せない**——「いつ手をつけたか」は起きた事実で、
       書き直せるのは書いた文だけ（store.editStep も at を変えない） */
    if (typeof onEdit === 'function' && s && Number.isFinite(Number(s.at))) {
      const ed = el('button', 'bh-edit', '直す');
      ed.type = 'button';
      ed.setAttribute('aria-label', (at ? at + ' の' : '') + '記録を直す');
      ed.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        openStepEdit(s, onEdit);
      });
      li.appendChild(ed);
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
    /* 2026-11-19: 作業記録の欄から積んだもの（1 行目＝次にやること）は 1 つの文として出す。前の形の記録は両方 */
    if (isRecordStep(s)) {
      line('作業記録', s.did);
    } else {
      line('作業記録', s && s.did);
      line('次にやること', s && s.next);
    }
    ul.appendChild(li);
  });
  return ul;
}

/* 印は出さない ul（番号を振ると「◯件目」を数えることになる／§0） */
export function stepList(rows, onEdit) {
  return fillStepList(el('ul', 'bh-list'), rows, onEdit);
}

/* 記録を1件直す小さな板。作業メモと次の一手を出して、書き直して閉じる。
   **次の一手は空にできない**（記録は必ず「次はここから」を持つ／store と同じ決まり）。
   板の形は海の引き（seamap）の入力板とそろえてある——覚えることを増やさない。 */
function openStepEdit(step, onEdit) {
  const back = el('div', 'bh-edit-back');
  const box = el('div', 'bh-edit-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '記録を直す');
  box.dataset.screen = 'board.step'; box.dataset.screenLayer = '7';

  const at = fmtAt(step && step.at);
  /* 時刻はこちらが作った文字だが、el の第3引数は innerHTML なので、
     文字を入れるときは textContent を使う（ユーザーの文字が混ざる道を作らない） */
  const tt = el('p', 'tt');
  tt.textContent = at ? '記録を直す（' + at + '）' : '記録を直す';
  box.appendChild(tt);

  const mk = (label, value, ph) => {
    const w = el('label', 'fld');
    w.appendChild(el('span', 'k', label));
    const ta = el('textarea', 'v');
    ta.rows = label === '作業記録' ? 4 : 2;
    ta.value = String(value == null ? '' : value);
    ta.placeholder = ph;
    w.appendChild(ta);
    box.appendChild(w);
    return ta;
  };
  /* 2026-11-19: 作業記録の欄から積んだものは、1 つの欄で直す（1 行目が次にやることになる） */
  const merged = isRecordStep(step);
  const didIn = mk('作業記録', step && step.did, merged ? '' : '書いていなくてもよい');
  const nextIn = merged ? null : mk('次にやること', step && step.next, '次にどこから始めるか');

  const why = el('p', 'why', '');
  why.hidden = true;
  box.appendChild(why);

  const row = el('div', 'row');
  const cancel = el('button', 'ca', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', ev => { ev.preventDefault(); close(); });
  const ok = el('button', 'ok', '直す');
  ok.type = 'button';
  ok.addEventListener('click', ev => {
    ev.preventDefault();
    const next = merged ? firstLineOf(didIn.value) : nextIn.value.trim();
    if (!next) {
      /* 断らずに理由を出す。命令形にはしない（§0） */
      why.textContent = merged ? '空の記録にはできない' : '記録には次にやることが要る';
      why.hidden = false;
      (nextIn || didIn).focus({ preventScroll: true });
      return;
    }
    if (onEdit(step.at, { did: didIn.value, next }) === false) {
      why.textContent = 'いまは直せない';
      why.hidden = false;
      return;
    }
    close();
  });
  row.appendChild(cancel);
  row.appendChild(ok);
  box.appendChild(row);

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  };
  box.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', ev => { if (ev.target === back) close(); });
  function close() { back.remove(); }

  back.appendChild(box);
  (document.getElementById('drag-layer') || document.body).appendChild(back);
  didIn.focus({ preventScroll: true });
}

/* いまドラッグ中のノード。body の is-dragging を、別のバブルの detach で
   消してしまわないための目印（同時にドラッグできるのは1つ） */
let activeDrag = null;
/* 外から「タップしたのと同じ道」で中央へ寄せるための口（引き出しの名前タップ）。
   attachGestures がノードごとに startCenter を預け、detach で外す。
   合成イベントを投げるのではなく、同じ関数を呼ぶ——タップと寸分違わぬ結果にするため。

   戻り値は**本当に中央へ寄せたか**。startCenter は寸法が取れないとき（生まれる途中で
   幅が 0 のときなど）黙って抜けるので、「関数があった」だけを true にすると、
   呼び出し側が成功したと思って探索をやめてしまう（2026-09-25 に実際に起きた）。 */
const centerFns = new WeakMap();
export function centerBubble(node) {
  const f = node ? centerFns.get(node) : null;
  if (typeof f !== 'function') return false;
  return f() === true;
}

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
  let heldScale = 1;                 /* 掴んだ時点で面に掛かっていた倍率 */
  let center = null;                 /* 中央に寄せている間の状態 */

  function call(name, ...args) {
    if (typeof h[name] === 'function') return h[name](...args);
    return undefined;
  }

  /* 層へ持ち出す／元の場所へ返す */
  /* 掴んでいる間の倍率。面がズームされていると、ノードは倍率つきの面から
     倍率の掛かっていないドラッグ層へ移る＝そのままだと大きさが跳ねる。
     画面での見え方（rect.width）と組版上の幅（offsetWidth）の比を、
     移したあとのノードに掛け直して、跳ねを消す。 */
  function takeNode(rect) {
    if (taken) return;
    taken = true;
    homeParent = node.parentNode;
    homeNext = node.nextSibling;
    homeTransform = node.style.transform;
    const w = node.offsetWidth || rect.width || 1;
    heldScale = rect.width ? rect.width / w : 1;
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    /* 動かすのは translate（scale の**外**の口）。transform を使うと
       下の scale に飲まれて、指の動きが倍率ぶん縮む。
       原点を左上に置くのは、left/top で置いた位置がそのまま左上になるようにするため */
    node.style.transformOrigin = '0 0';
    node.style.transform = '';
    node.style.translate = '0px 0px';
    if (Math.abs(heldScale - 1) > 0.005) node.style.scale = String(Math.round(heldScale * 1000) / 1000);
    layerEl().appendChild(node);
    call('onHold', idOf(), true);
  }
  function giveBack() {
    if (!taken) return;
    taken = false;
    heldScale = 1;
    node.style.left = '';
    node.style.top = '';
    node.style.transition = '';
    node.style.translate = '';
    node.style.scale = '';
    node.style.transformOrigin = '';
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
    /* 盤を閉じたら「その他」も畳んだ姿へ戻す（Issue #49 の返事「それ以外を開くと、再度泡を開いても全部開いたままになる」）。
       次に泡を開いたときは、設定の「盤にはじめから出す欄」の姿から始まる */
    boardExtraOpen = false;
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
        x: c.cx, y: c.cy, cx: c.cx, cy: c.cy,
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
  let kbWait = false;            /* キーボードが引っ込むのを待っている間（Issue #85）。二度開かない */
  function startCenter(pt, afterKb) {
    if (center) return;          /* 既に中央。二度目のタップで開く経路はもう無い */
    if (kbWait && !afterKb) return;
    /* 盤の外の欄（海の下の入力欄など）で打っている最中なら、先に焦点を外してキーボードを引っ込める。
       キーボードが出ていた（kb-open）なら、枠が戻ってから開き直す（Issue #85） */
    if (blurOutsideField(node) && document.documentElement.classList.contains('kb-open')) {
      kbWait = true;
      whenKeyboardGone(() => { kbWait = false; if (node.isConnected) startCenter(null, true); });   /* 触った click はもう過ぎたので捨てない */
      return;
    }
    const host = call('getHost') || node.parentNode;
    const from = node.getBoundingClientRect();
    if (!from.width) return;               /* 寸法が取れないときは何もしない */

    /* 中央へ置いたバブルは、倍率の掛かっていないドラッグ層に立つので**実寸**になる。
       from は面の上での見え方（＝倍率つき）なので、寄せ先の計算には使わない。
       1.00 のときは W/H = from.width/height なので、前と1ピクセルも変わらない。 */
    const W = node.offsetWidth || from.width;
    const H = node.offsetHeight || from.height;

    const hr = (host && host.getBoundingClientRect) ? host.getBoundingClientRect() : from;
    /* 近づいている（倍率 1 超）と、面は画面からはみ出す。はみ出した側まで含めて
       中心を取ると、盤が画面の外へ寄ってしまう。**見えている範囲**の真ん中に置く。
       1.00 では面は画面の中に収まっているので、これは hr そのものになる。 */
    const vw = window.innerWidth || hr.right, vh = window.innerHeight || hr.bottom;
    let vl = Math.max(hr.left, 0), vr = Math.min(hr.right, vw);
    let vt = Math.max(hr.top, 0), vb = Math.min(hr.bottom, vh);
    if (vr - vl < W || vb - vt < H) { vl = hr.left; vr = hr.right; vt = hr.top; vb = hr.bottom; }

    const cx = (vl + vr) / 2;
    /* 上部へ。[まずは開始] のぶんだけ空けた、いちばん上に置ける位置。
       面がとても低いときだけ真ん中に留める（上に寄せると下がもっと狭くなるため） */
    const cyTop = vt + CENTER_M + CENTER_TOP_BAND + H / 2;
    const cy = Math.min((vt + vb) / 2, cyTop);

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
    /* 書く面が開いている間は、覆いを触っても閉じない（Issue #55）。触りは吸うだけ */
    const writing = () => !!(center && center.panel && center.panel.isWriting());
    veil.addEventListener('pointerup', ev => { eat(ev); if (!writing()) cancelCenter(); });
    veil.addEventListener('pointercancel', ev => { eat(ev); if (!writing()) cancelCenter(); });
    layerEl().appendChild(veil);

    /* 当たり判定は押した瞬間から中央に置く。動いている的を押させない。
       44×44 を下回らせない。 */
    const hd = Math.max(W, 44);
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
    panel.place(cx, cy, W);
    /* 輝く泡なら光がほどける（2026-11-24。画面側の onOpened が輪・粒・音を出す）。1 回だけ */
    if (actions && typeof actions.onOpened === 'function') {
      try { actions.onOpened(node); } catch (err) { /* 光のために盤を壊さない */ }
    }

    /* 指で開いたなら、このタップが生む click を1つだけ捨てる。
       盤を組んだあとに張る（張る前に return する枝は無いが、順番を読みやすくするため） */
    eatOpeningClick(pt);

    /* 中央へ寄せる。rAF は隠れている間 発火しないので、reflow で開始位置を確定させる。
       takeNode が左上を from.left/top に置き、原点も左上にしてあるので、
       寄せ先の左上との差がそのまま translate になる。
       あわせて scale を 1 へ戻す＝引いて見ているときは「近づきながら開く」。
       小さいまま開くと、盤は実寸なのにバブルだけ小さく、読めないため。 */
    const dx = cx - W / 2 - from.left;
    const dy = cy - H / 2 - from.top;
    void node.offsetWidth;
    const ms = RM.matches ? 0 : CENTER_MS;
    node.style.transition = ms
      ? `translate ${ms}ms cubic-bezier(.2,.9,.3,1), scale ${ms}ms cubic-bezier(.2,.9,.3,1)` : '';
    node.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    node.style.scale = '1';

    /* 戻る条件はこれだけ。時間では戻さない。
       中央のバブル（当たり判定）と盤の中を触っている間は戻らない。
       覆いは自分で pointerup のときに解除するので、ここでは見送る（二重に呼ばない）。
       いまや覆いが面をすべて塞ぐので、ここへ来るのは覆いより上にあるもの
       ＝下タブ（z-index 70）だけ。タブで画面を移るときは解除してよい。
       ev.target は window のこともある（Node.contains に渡すと投げる）ので節を分ける */
    const onOutside = ev => {
      const t = ev.target;
      if (fromFeedback(ev)) return;        /* 右上の !。盤を開いたままコメントを書ける */
      /* 同期・読み込みの途中（パスキー・合言葉の欄や確かめの窓を触る）は閉じない（2026-11-16 Issue #68 の返事
         「TODO画面で同期ボタンを押すと画面が小さいからかTODO画面が閉じる」） */
      if (holdOpen > 0) return;
      if (!center || !t || !t.nodeType) { cancelCenter(); return; }
      if (center.veil && center.veil.contains(t)) return;
      if (center.hit && center.hit.contains(t)) return;
      if (center.panel && center.panel.root.contains(t)) return;
      if (node.contains(t)) return;
      /* 書く面が開いている間は、下タブに指が当たっても画面を移らない（Issue #55） */
      if (center.panel && center.panel.isWriting()) {
        ev.preventDefault(); ev.stopPropagation();
        /* タブは click で移るので、この触りが生む click も1つだけ捨てる（来なければ少しで外す） */
        const eatClick = e => { e.preventDefault(); e.stopPropagation(); drop(); };
        const drop = () => { clearTimeout(tm); window.removeEventListener('click', eatClick, true); };
        const tm = setTimeout(drop, 800);
        window.addEventListener('click', eatClick, true);
        return;
      }
      cancelCenter();
    };
    /* Escape は、まず盤に渡す。履歴が開いていれば履歴だけが閉じ、中央は残る
       （盤の中の一段を閉じただけで面から放り出されたら、居場所を見失う）。
       盤が「自分で処理した」と言わなければ、いままでどおり中央を閉じる。 */
    const onEsc = ev => {
      if (ev.key !== 'Escape' || fromFeedback(ev)) return;
      ev.preventDefault();
      if (center && center.panel && center.panel.handleEscape()) return;
      cancelCenter();
    };
    /* 画面が動いたら座標が狂うので戻す。ただし入力欄に文字を打っている最中は戻さない
       （端末のキーボードが出るときに resize が飛ぶ。打っている途中で閉じたら事故） */
    const onAway = () => {
      if (center && center.panel && center.panel.isTyping()) return;
      /* 同期・読み込みの途中は閉じない（パスキーの画面・合言葉の欄・確かめの窓で、スマホは画面の大きさが変わる。Issue #68） */
      if (holdOpen > 0) return;
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
      onOutside, onEsc, onAway, onScroll, cx, cy, d: W,
    };
    /* 盤を開いたことを知らせる（2026-11-13 Issue #52。サーバーなし版はほかの端末の新しい控えを見に行く。js/chainwatch.js が1分に1回までに間引く） */
    try { window.dispatchEvent(new CustomEvent('bubbles:boardopen')); } catch (e) { /* 知らせられなくても盤は開く */ }

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
      /* translate は scale の外の口なので、指の px がそのまま画面の px になる
         （transform に書くと、掴んだときに掛けた scale に飲まれて動きが縮む） */
      node.style.translate = `${dx}px ${dy}px`;
      hilite(e.clientX, e.clientY);
      call('onDragMove', idOf(), {
        x: e.clientX, y: e.clientY,
        left: rect.left + dx, top: rect.top + dy,
        /* 面の側で「世界のどこか」へ直すのは中心のほうが確か。
           左上＋半径だと、画面での大きさと世界での大きさが倍率ぶん食い違う */
        cx: rect.left + dx + rect.width / 2,
        cy: rect.top + dy + rect.height / 2,
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
        cx: x - grabDX + rect.width / 2,
        cy: y - grabDY + rect.height / 2,
      });
      call('onHold', id, false);
      if (droppedTo) { playSfx('place'); call('onDropToTab', id, droppedTo); }
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

  /* pt 無し＝指で開いたのではない（click は捨てない）。寄せられたかを返す */
  centerFns.set(node, () => { startCenter(null); return !!center; });

  return function detach() {
    centerFns.delete(node);
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
    tx.textContent = done ? (handlers.reopenLabel || '海にもどす') : spec.label;
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

  /* 海を移す（2026-11-18。モック 6）。預け先に moveTargets があり、移せる海があるときだけ。
     どの海へ移すか・新しく見える人を聞く画面は預け先（js/movesea.js）が出す */
  const mid = node.dataset.id;
  const targets = mid ? ask(centerAdapter, 'moveTargets', mid) : null;
  if (Array.isArray(targets) && targets.length) {
    const mv = el('button', 'mi mi-movesea');
    mv.type = 'button';
    mv.setAttribute('role', 'menuitem');
    mv.appendChild(el('span', 'mi-tx', '海を移す…'));
    mv.addEventListener('click', () => { closeMenu(); ask(centerAdapter, 'openMoveSea', mid); });
    box.insertBefore(mv, box.querySelector('.mi-delete') || null);
  }
  /* 見るだけの海では、どの操作も押せない（詳細は開ける） */
  if (ask(centerAdapter, 'readOnly') === true) {
    box.querySelectorAll('.mi').forEach(b => { if (!b.classList.contains('mi-detail')) b.disabled = true; });
  }

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
    if (fromFeedback(ev)) return;
    if (t && t.nodeType && box.contains(t)) return;
    if (t && t.closest && t.closest('.bub')) { ev.preventDefault(); ev.stopPropagation(); }
    closeMenu();
  };
  const onKey = ev => {
    if (ev.key !== 'Escape' || fromFeedback(ev)) return;
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
