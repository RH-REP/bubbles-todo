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
/* 着手（store.start）の印を、画面で何と呼ぶか（利用者の指示）。
   「はじめた」「開始した」と別々に呼んでいたが、同じ印を指している。
   実際にしていることは「今日ぶんはここまで」——押すとバブルが薄くなり、
   5時に戻る（契約 §5）。だから名前もそう呼ぶ。
   **記録している中身は変えていない。**ふりかえりの内訳は「はじめた」のまま
   （あちらは操作の名前ではなく、記録の名前。README の憲章がその言葉を使っている）。 */
const DONE_LB = '今日は終わり';

function isStarted(id) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, null);
}
function markStarted(id) {
  if (typeof store.start !== 'function') return;
  if (isStarted(id)) return;
  store.start(id, null);
  const t = store.get(id);
  toast('「' + trim(t ? t.text : '') + '」を ' + DONE_LB + ' にした', {
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
/* ---------------- 見ている日（利用者の指示） ----------------

   前はこの画面が「今日」だけを映していた。いまは **日付ごとの海**で、
   左右になぞる／見出しの日付から選ぶ、の2つで日を移る。

   ・過去 … その日に置いたものを**全部**出す。着手したものを強調もしないし、
     しなかったものを沈めもしない。件数も出さない（利用者の判断）。
     並べ替えもしない——順番が違うこと自体が「こちらはやっていない」の印になる
   ・未来 … あらかじめ置いておける。その日が来たら、そのまま今日の海になる
   ・**書き換えられるのは今日と未来だけ。**過去は記録なので触らせない
     （うっかり足すと、その日の記録が後から変わる）

   「持ち越さない」は保たれている。明日の海が空なのは、
   明日のキーを持つものがまだ無いからで、勝手に運ばれることはない。 */

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/* いま見ている日。海がタブへのドロップ先を決めるのに読む。
   ＝ 「今日タブは、いま今日の画面が映している日の水面」。
   過去を映している間は null を返す（過去は記録なので書き換えさせない）。 */
/* 下タブの「今日」から日を選ぶ。長押しで呼ばれる（利用者の指示） */
export function openDayPicker(anchor) { openDayPop(anchor); }

/* タブに出す札。今日を映しているときは null（＝「今日」のまま） */
export function dayBadge() {
  const k = curDay();
  if (k === todayKey()) return null;
  const d = dayToDate(k);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

/* 映している日が変わったことを外へ知らせる。下タブの札がこれを見る。
   画面どうしを直接つながないため、window のイベントで渡す（app.js と同じやり方） */
function announceDay() {
  try {
    window.dispatchEvent(new CustomEvent('bubbles:dayview', {
      detail: { day: curDay(), badge: dayBadge() },
    }));
  } catch (_) { /* 古い環境。札が出ないだけ */ }
}

export function dropDay() {
  const k = curDay();
  return (k < todayKey()) ? null : k;
}

let viewDay = null;          /* 'YYYY-MM-DD'。null なら今日 */
let dayBtn = null, dayPrev = null, dayNext = null;
let dayPop = null;

const todayKey = () => (typeof store.todayKey === 'function' ? store.todayKey() : '');
const curDay = () => viewDay || todayKey();
const isToday = () => curDay() === todayKey();
const isPast = () => curDay() < todayKey();

/* 日付キーを Date に。ローカル時刻の正午に寄せる（夏時間で日が飛ばないように） */
function dayToDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return new Date();
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
}
function dateToDay(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function shiftDay(key, n) {
  const d = dayToDate(key);
  d.setDate(d.getDate() + n);
  return dateToDay(d);
}
/* 今日から何日ずれているか（負なら過去） */
function offsetOf(key) {
  return Math.round((dayToDate(key) - dayToDate(todayKey())) / 86400000);
}
/* 見出しの文字。近い日は言葉で、遠い日は日付で */
function dayLabel(key) {
  const n = offsetOf(key);
  const d = dayToDate(key);
  const md = (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）';
  if (n === 0) return '今日 ' + md;
  if (n === 1) return '明日 ' + md;
  if (n === 2) return '明後日 ' + md;
  if (n === -1) return '昨日 ' + md;
  if (n === -2) return '一昨日 ' + md;
  return md;
}

/* --- この画面の中身（利用者の指摘）---

   > 今日の海は、実質すべての海のフィルター版である

   そのとおりなので、**水面とランダムで別々に集めていたのをここ1か所にまとめた**。
   前は規則がずれていて、ここは「いま映している日」、ランダムは常に
   store.todays()（＝今日）を見ていた——明日を映していても、さいころは今日から引いていた。

   今日は完了したものを出さない。過去と未来は**その日の記録として残す**
   （済ませたぶんを抜くと、あとから見たときに顔ぶれが欠ける）。

   ■ **長期保留はここでは外さない**（利用者の指示）

   一度これを外していたが、間違いだった。長期保留は**一種のタグ**で、
   「既定では出さない」は**海の側の決まり**（すべての海＝中央と、タグの海）。
   日付の水面は**その日に置いたという記録**なので、タグの表示規則で消してよいものではない
   ——置いたのに消えると、置いた事実のほうが失われる。

   だから、日付の水面と、そこから引くさいころには、長期保留もそのまま出る。 */
function dayItems(key) {
  const base = (key === todayKey() || typeof store.itemsOnDay !== 'function')
    ? store.todays()
    : store.itemsOnDay(key);
  return base || [];
}

function itemsForField() {
  const list = dayItems(curDay());
  return list.map(t => ({
    id: t.id,
    text: t.text,
    started: isStarted(t.id),
    marks: [],
    colors: tagColors(t.id),
    tagNames: tagNames(t.id),
    anchorHue: null,
  }));
}

/* ---------------- その日の海に直に書く（利用者の指示） ----------------

   前はこの画面に入力欄が無く、**海に書いてからタブへ運ぶ**しか道が無かった。
   「今日ぶんを今から書く」ときに、いったん海を経由するのは遠回り。

   ・書いたものは **いま映している日**に入る（今日でも、明日でも）
   ・**タグもその場で付けられる。**入力欄に触ると札が開く（ふだんは畳んでおく——
     常に出しておくと、書く前から選択肢が並んで水面が狭くなる）
   ・**過ぎた日には出さない。**過去はその日の記録なので、あとから足させない

   札に出さないタグが2つある：
     今日 … いま映している日に入るので、重ねて持つ意味が無い
     完了 … これから書くものに付ける意味が無い */

let composer = null, cInput = null, cSend = null, cTags = null;
/* 選んだタグは送ったあとも残す。同じタグのものを続けて書くのが楽になる。
   隠し持たない——札は出たままなので、何が付くかは目で見える */
const picked = new Set();

function composerTags() {
  if (typeof store.tags !== 'function') return [];
  try { return store.tags().filter(t => t && t.id !== 'today' && t.id !== 'done'); }
  catch (e) { return []; }
}

function renderComposerTags() {
  if (!cTags) return;
  const list = composerTags();
  cTags.replaceChildren();
  list.forEach(t => {
    const b = el('button', 'tc-tag');
    b.type = 'button';
    b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
    const dot = el('span', 'tc-dot');
    dot.setAttribute('aria-hidden', 'true');
    if (t.color) dot.style.setProperty('--tcd', t.color);
    const nm = el('span', 'tc-nm');
    nm.textContent = t.name;                          /* ユーザーの文字 */
    b.appendChild(dot);
    b.appendChild(nm);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      if (picked.has(t.id)) picked.delete(t.id); else picked.add(t.id);
      b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
      /* 札を触ると入力欄から焦点が外れる。開いたままにしておく */
      if (composer) composer.classList.add('is-open');
    });
    cTags.appendChild(b);
  });
  /* 消えたタグを選んだままにしない */
  [...picked].forEach(id => { if (!list.some(t => t.id === id)) picked.delete(id); });
}

function syncComposer() {
  if (!composer) return;
  composer.hidden = isPast();          /* 過ぎた日には出さない */
  if (composer.hidden) return;
  const v = cInput ? cInput.value.trim() : '';
  if (cSend) cSend.disabled = !v;
  if (cInput) {
    cInput.placeholder = isToday() ? '今日ぶんを書く' : dayLabel(curDay()) + 'ぶんを書く';
    cInput.setAttribute('aria-label', cInput.placeholder);
  }
}

function addFromComposer() {
  if (!cInput) return;
  const body = cInput.value.trim();
  if (!body) return;
  const t = store.add(body);
  if (!t) return;
  /* まず日に置く（日が本体）。そのあとタグを付ける */
  if (typeof store.setDay === 'function') store.setDay(t.id, curDay(), true);
  else store.setToday(t.id, true);
  if (typeof store.setTag === 'function') {
    picked.forEach(id => { try { store.setTag(t.id, id, true); } catch (e) { /* 無いタグ */ } });
  }
  cInput.value = '';
  syncComposer();
  cInput.focus({ preventScroll: true });
  render();
}

/* 見出しの日付。押すと近い日が選べる。遠い日は左右になぞる */
/* 空のときのことば。日によって言うことが違う。
   **どれも未達を名指ししない・件数を出さない・命令形にしない**（§0）。
   過去について「なにもしなかった」とは言わない——置かなかっただけなので */
function syncEmptyNote() {
  if (!emptyNote) return;
  const l1 = emptyNote.querySelector('.l1');
  const l2 = emptyNote.querySelector('.l2');
  if (!l1 || !l2) return;
  const n = offsetOf(curDay());
  if (n === 0) {
    l1.textContent = '今日ぶんの水面。';
    l2.textContent = '海のバブルを、このタブに落とすと浮かぶ。';
  } else if (n < 0) {
    l1.textContent = dayLabel(curDay()) + 'の水面。';
    l2.textContent = 'この日には、まだ何も置いていなかった。';
  } else {
    l1.textContent = dayLabel(curDay()) + 'の水面。';
    l2.textContent = '先に置いておくと、その日にここへ浮かぶ。';
  }
}

function syncDayBtn() {
  if (!dayBtn) return;
  dayBtn.textContent = dayLabel(curDay());
  dayBtn.classList.toggle('is-past', isPast());
  dayBtn.classList.toggle('is-future', offsetOf(curDay()) > 0);
  dayBtn.setAttribute('aria-label', dayLabel(curDay()) + 'の水面。押すと日を選べる');
}

function goDay(key) {
  const next = (key === todayKey()) ? null : key;
  if (viewDay === next) return;
  viewDay = next;
  syncDayBtn();
  announceDay();
  render();
}

function closeDayPop() {
  if (!dayPop) return;
  dayPop.back.remove();
  dayPop.box.remove();
  window.removeEventListener('keydown', dayPop.onKey, true);
  dayPop = null;
}

/* 選べる日。過去は「昨日」まで（それより前はなぞって行く——
   遠い過去を一覧にすると、それ自体が振り返りの装置になる）。
   未来は1週間ぶん。**「週末」は次の土曜**を指す */
function dayChoices() {
  const t = todayKey();
  const out = [
    { key: shiftDay(t, -1), label: '昨日' },
    { key: t, label: '今日' },
    { key: shiftDay(t, 1), label: '明日' },
    { key: shiftDay(t, 2), label: '明後日' },
  ];
  for (let i = 3; i <= 7; i++) {
    const k = shiftDay(t, i);
    const d = dayToDate(k);
    out.push({ key: k, label: (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）' });
  }
  /* 次の土曜。すでに候補に入っていれば足さない */
  const sat = (() => { let k = t; for (let i = 1; i <= 7; i++) { k = shiftDay(t, i); if (dayToDate(k).getDay() === 6) return k; } return null; })();
  const row = out.find(o => o.key === sat);
  if (row) row.label = '週末 ' + row.label;
  return out;
}

/* anchor を省くと見出しのボタンの下。下タブから呼ぶときは、その的の上に出す */
function openDayPop(anchor) {
  if (dayPop) { closeDayPop(); return; }
  const back = el('div', 'today-daypop-back');
  const box = el('div', 'today-daypop');
  box.setAttribute('role', 'menu');
  box.setAttribute('aria-label', '日を選ぶ');

  dayChoices().forEach(c => {
    const b = el('button', 'today-daych');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const nm = el('span', 'nm');
    nm.textContent = c.label;
    const dt = el('span', 'dt');
    const d = dayToDate(c.key);
    dt.textContent = (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）';
    b.appendChild(nm);
    if (!/\d\/\d/.test(c.label)) b.appendChild(dt);   /* 言葉の候補にだけ日付を添える */
    if (c.key === curDay()) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', ev => { ev.preventDefault(); closeDayPop(); goDay(c.key); });
    box.appendChild(b);
  });

  const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
  back.addEventListener('pointerdown', eat);
  back.addEventListener('click', eat);
  back.addEventListener('pointerup', ev => { eat(ev); closeDayPop(); });
  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    const back2 = dayPop && dayPop.was;
    closeDayPop();
    if (back2 && back2.isConnected) back2.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  document.body.appendChild(box);
  dayPop = { back, box, onKey, was: anchor || dayBtn };
  /* 的の下に出す。入り切らないなら上へ返す（下タブから呼ぶとこちらになる）。
     画面の端からもはみ出させない */
  const a = anchor || dayBtn;
  const r = a.getBoundingClientRect();
  const M = 8;
  const w = box.offsetWidth, h = box.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - M) top = r.top - 6 - h;
  box.style.left = Math.round(Math.max(M, Math.min(r.left, window.innerWidth - w - M))) + 'px';
  box.style.top = Math.round(Math.max(M, top)) + 'px';
  const first = box.querySelector('.today-daych');
  if (first) first.focus({ preventScroll: true });
}

/* 左右になぞって隣の日へ。海の面送りと同じ間合い（44px か幅の 22%）。
   バブル・ボタンの上から始めた指は拾わない */
let swipe = null;
function onDayDown(ev) {
  if (swipe || dayPop) return;
  if (ev.button != null && ev.button !== 0) return;
  const t = ev.target;
  if (!t || !t.closest || t.closest('.bub, button, a, input, textarea, select')) return;
  swipe = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, axis: null };
  window.addEventListener('pointermove', onDayMove, true);
  window.addEventListener('pointerup', onDayUp, true);
  window.addEventListener('pointercancel', onDayUp, true);
}
function onDayMove(ev) {
  if (!swipe || ev.pointerId !== swipe.pid) return;
  const dx = ev.clientX - swipe.x0, dy = ev.clientY - swipe.y0;
  if (!swipe.axis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swipe.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  }
  swipe.dx = dx;
  if (swipe.axis === 'x') stage.classList.add('is-daymove');
}
function onDayUp(ev) {
  if (!swipe || (ev && ev.pointerId !== swipe.pid)) return;
  const s = swipe;
  swipe = null;
  window.removeEventListener('pointermove', onDayMove, true);
  window.removeEventListener('pointerup', onDayUp, true);
  window.removeEventListener('pointercancel', onDayUp, true);
  stage.classList.remove('is-daymove');
  if (s.axis !== 'x') return;
  const need = Math.max(44, (stage.clientWidth || 320) * 0.22);
  if (Math.abs(s.dx) < need) return;
  /* 右へなぞる＝過去へ（紙をめくる向き）。左へなぞる＝先へ */
  goDay(shiftDay(curDay(), s.dx > 0 ? -1 : 1));
}

function render() {
  if (!field) return;
  const items = itemsForField();
  field.setItems(items);
  if (emptyNote) {
    emptyNote.hidden = items.length > 0;
    syncEmptyNote();
  }
  syncDayBtn();
  syncComposer();
  renderComposerTags();          /* 設定でタグが増減していることがある */
  syncRandomBtn();
  /* 過去は記録なので触らせない（足すと、その日の記録が後から変わる） */
  if (stage) stage.classList.toggle('is-readonly', isPast());

  /* 外で状態が変わったら、開いている詳細を同期し直す（契約 §14） */
  if (detail) {
    if (!store.get(detail.id)) closeDetail();
    else detail.sync();
  }
}

/* ---------------- ランダムスタート（追補5 §4） ----------------
   選べないときに、選ばずに始めるためのもの。おすすめではない。
   だから重み付けはしない（古い順・放置順にすると「催促」になる／契約 §0）。
   候補は**いま画面に浮かんでいるもの**（dayItems）から、完了したものを除いたぶん。
   海の pickFace() と同じ規則：見えている面から選び、終わったものは選ばない
   （終わったものを「はじめる」のは筋が通らない）。
   過去の日を映しているときは、その日に置いたもののうち、まだ終わっていないものが候補。

   見せ方は海と同じ：玉が輪になって churn し、光が次々に移り、最後の1つが大きくなる。
   玉は候補そのものではなく「候補が混ざっている」ことの絵にしている
   （漂うバブルそのものを混ぜるには drift のノードを毎フレーム奪うことになるため）。
   **選ぶのは混ぜる前。**Math.random() を1回引いて決め、そのあとで絵を作るので、
   無作為さは見せ方に一切左右されない。 */

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function isDoneItem(t) {
  if (!t) return false;
  if (typeof store.isDone === 'function') {
    try { return !!store.isDone(t.id); } catch (e) { /* 落ちない */ }
  }
  return !!t.done;
}

function pickList() {
  try { return dayItems(curDay()).filter(t => !isDoneItem(t)); } catch (e) { return []; }
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
  wrap.appendChild(el('span', 'sr', (isToday() ? '今日' : dayLabel(curDay())) + 'から1つ選んでいます'));

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
  /* 映している日の名前で言う。「今日」と決め打つと、明日を映しているときに
     さいころだけ別の日の話をしているように読める（実際、前は本当にそうだった） */
  const word = isToday() ? '今日' : dayLabel(curDay());
  const say = word + 'から1つ選んで、5分だけ集中';
  randomBtn.title = n ? say : 'ここには選べるものが無い';
  randomBtn.setAttribute('aria-label', say);
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
    doneBtn.textContent = on ? DONE_LB + ' ✓' : DONE_LB;
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

/* ---------------- バブルを左右の端へ運ぶと、日が変わる（利用者の指示） ----------------

   > 今日の海でバブルを左右にしたら、日付をその日に変更する機能

   掴んでいる間だけ、左右に帯を出す。そこで離すと、**いま映している日から外して
   隣の日に置き直す**（足すのではなく、動かす＝「変更」）。

   向きは画面に出ている ‹ › とそろえた。**左＝前の日／右＝次の日**。
   背景を右へなぞると前の日へ行く（紙をめくる向き）のと矛盾しないのは、
   なぞりは「面を動かす」、こちらは「バブルを置く」で、動かす対象が違うため
   ——‹ › が同じところに出ているので、目で見える手がかりのほうに合わせた。

   出さない場面が2つある：
     ・過去を映しているとき … 過去はその日の記録。あとから書き換えない（is-readonly と同じ理由）
     ・行き先が今日より前になるとき … カレンダーで過去の枡を押させないのと同じ規則

   海の端の帯（.sea-edge）と同じ作り方にしてある：帯は指を透かし、
   判定は指先の座標でやる（バブルの外形は広すぎる。契約 §14）。 */
let dayEdges = null;        /* { left: {el, lb}, right: {...} } */
let bubDrag = null;
let bubPt = { x: -1, y: -1 };
let overEdge = null;
let tabDropped = false;

/* その向きの行き先。動かしてよくなければ null */
function edgeDayFor(dir) {
  if (isPast()) return null;
  const k = shiftDay(curDay(), dir === 'left' ? -1 : 1);
  if (!k || k < todayKey()) return null;
  return k;
}

function renderDayEdges() {
  if (!dayEdges) return;
  const on = !!bubDrag;
  ['left', 'right'].forEach(dir => {
    const e = dayEdges[dir];
    const k = on ? edgeDayFor(dir) : null;
    e.el.hidden = !k;
    e.el.classList.toggle('is-over', overEdge === dir);
    if (!k) return;
    const d = dayToDate(k);
    /* 帯は細いので、日と曜日を2行に分ける（横書きのまま読める）。
       縦書きにすると、掴んでいるバブルが真ん中を隠したときに読めなくなる */
    e.md.textContent = (d.getMonth() + 1) + '/' + d.getDate();
    e.dw.textContent = DOW[d.getDay()];
  });
}

function dayEdgeAt(x, y) {
  if (!dayEdges || !bubDrag) return null;
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) return null;
  for (const dir of ['left', 'right']) {
    const e = dayEdges[dir];
    if (e.el.hidden) continue;
    const r = e.el.getBoundingClientRect();
    if (!r.width) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return dir;
  }
  return null;
}

function markDayEdge(dir) {
  if (overEdge === dir) return;
  overEdge = dir;
  renderDayEdges();
}

function onBubPointer(ev) {
  bubPt = { x: ev.clientX, y: ev.clientY };
  markDayEdge(dayEdgeAt(bubPt.x, bubPt.y));
}

function beginBubDrag(id) {
  closeMenu();
  bubDrag = { id };
  tabDropped = false;
  bubPt = { x: -1, y: -1 };
  overEdge = null;
  window.addEventListener('pointermove', onBubPointer, true);
  window.addEventListener('pointerup', onBubPointer, true);
  if (stage) stage.classList.add('is-bubdrag');
  renderDayEdges();
}

function endBubDrag() {
  const d = bubDrag;
  const pt = bubPt;
  const dir = (d && !tabDropped) ? dayEdgeAt(pt.x, pt.y) : null;
  const to = dir ? edgeDayFor(dir) : null;
  bubDrag = null;
  overEdge = null;
  window.removeEventListener('pointermove', onBubPointer, true);
  window.removeEventListener('pointerup', onBubPointer, true);
  if (stage) stage.classList.remove('is-bubdrag');
  renderDayEdges();
  if (!d || !to) return;
  /* onDropToTab と onDragEnd のどちらが先に来るかは決まっていないので、
     マイクロタスク1つぶん待ってから見る（海・きっかけと同じ間合い） */
  Promise.resolve().then(() => {
    if (tabDropped) return;
    moveDay(d.id, curDay(), to);
  });
}

/* いま映している日から外して、行き先の日に置く。取り消せる */
function moveDay(id, from, to) {
  const t = store.get(id);
  if (!t || typeof store.setDay !== 'function') return;
  const had = (typeof store.daysOf === 'function' ? store.daysOf(id) : []) || [];
  const added = store.setDay(id, to, true);
  const removed = (from && from !== to) ? store.setDay(id, from, false) : false;
  if (!added && !removed) return;
  const d = dayToDate(to);
  const md = (d.getMonth() + 1) + '/' + d.getDate();
  toast('「' + trim(t.text) + '」を ' + md + ' へ', {
    label: '元に戻す',
    on: () => {
      /* 掴む前の日をそのまま書き戻す。足し引きを逆にたどるより確か */
      const now = (typeof store.daysOf === 'function' ? store.daysOf(id) : []) || [];
      now.forEach(k => { if (had.indexOf(k) < 0) store.setDay(id, k, false); });
      had.forEach(k => { if (now.indexOf(k) < 0) store.setDay(id, k, true); });
    },
  });
}

const handlers = {
  onFocusRequest: id => openFive(id),
  onMenu: (id, node) => onMenu(id, node),
  /* 中央の盤に出す操作。これを渡すと bubble.js は onMenu を横取りしない */
  onActions: (id) => actionsFor(id),
  onDropToTab: (id, tabId) => { tabDropped = true; onDropToTab(id, tabId); },
  onDragStart: (id) => beginBubDrag(id),
  onDragEnd: () => endBubDrag(),
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
    /* --- 左右の帯（掴んでいる間だけ出る。離すと日が変わる）---
       面の子。指は透かす（判定は指先の座標でやるので当たり判定は要らず、
       持たせると帯の下のバブルを掴めなくなる） */
    dayEdges = {};
    ['left', 'right'].forEach(dir => {
      const box = el('div', 'today-edge');
      box.dataset.dir = dir;
      box.hidden = true;
      box.setAttribute('aria-hidden', 'true');
      const ar = el('span', 'ar', dir === 'left' ? '‹' : '›');
      const lb = el('span', 'lb');
      const md = el('span', 'md');
      const dw = el('span', 'dw');
      lb.appendChild(md);
      lb.appendChild(dw);
      box.appendChild(ar);
      box.appendChild(lb);
      stage.appendChild(box);
      dayEdges[dir] = { el: box, md, dw };
    });

    emptyNote = el('p', 'today-empty');
    emptyNote.appendChild(el('span', 'l1', ''));
    emptyNote.appendChild(el('span', 'l2', ''));
    syncEmptyNote();
    stage.appendChild(emptyNote);

    /* --- ランダムスタート（追補5 §4）---
       海と同じ形・同じ印・同じ言い方。海では「ならべる」の下に置いているが、
       この画面には他のボタンが無いので右上に置く（親指の届く角は同じ側）。 */
    /* 見出しの日付。押すと近い日が選べる（利用者の判断）。
       遠い日は左右になぞって行く。

       **両脇に ‹ › を置く**（利用者の指摘）。左右になぞれば日が移ることは
       前から動いていたが、画面のどこにもそう書いていなかった——
       海には矢印の看板があるのに、ここには手がかりが無かった。
       札としてだけでなく**押しても移れる**ようにする（指だけの経路にしない／A-9 と同じ）。 */
    const dayRow = el('div', 'today-dayrow');

    dayPrev = el('button', 'today-daystep');
    dayPrev.type = 'button';
    dayPrev.textContent = '‹';
    dayPrev.setAttribute('aria-label', '前の日へ');
    dayPrev.addEventListener('click', ev => { ev.preventDefault(); goDay(shiftDay(curDay(), -1)); });
    dayRow.appendChild(dayPrev);

    dayBtn = el('button', 'today-day');
    dayBtn.type = 'button';
    dayBtn.addEventListener('click', ev => { ev.preventDefault(); openDayPop(dayBtn); });
    dayRow.appendChild(dayBtn);

    dayNext = el('button', 'today-daystep');
    dayNext.type = 'button';
    dayNext.textContent = '›';
    dayNext.setAttribute('aria-label', '次の日へ');
    dayNext.addEventListener('click', ev => { ev.preventDefault(); goDay(shiftDay(curDay(), 1)); });
    dayRow.appendChild(dayNext);

    stage.appendChild(dayRow);
    syncDayBtn();
    stage.addEventListener('pointerdown', onDayDown);

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

    /* --- その日の海に直に書く（利用者の指示）---
       面（.today-stage）の**兄弟**として下に置く。面は flex:1 なので自然に縮み、
       drift が測る clientHeight もそのまま正しくなる
       ——海のように重ねると、床の高さを CSS 変数で渡す配管が要る。 */
    composer = el('form', 'today-composer');
    cTags = el('div', 'tc-tags');
    composer.appendChild(cTags);

    const row = el('div', 'tc-row');
    cInput = el('input');
    cInput.type = 'text';
    cInput.autocomplete = 'off';
    cSend = el('button', null, '送信');
    cSend.type = 'submit';
    cSend.disabled = true;
    row.appendChild(cInput);
    row.appendChild(cSend);
    composer.appendChild(row);

    cInput.addEventListener('input', syncComposer);
    /* 入力欄に触っている間だけ札を開く。ふだん畳んでおくのは、
       書く前から選択肢が並ぶと水面が狭くなるため */
    cInput.addEventListener('focus', () => composer.classList.add('is-open'));
    composer.addEventListener('focusout', () => {
      /* 札を押したときは焦点が札へ移るだけ。畳まない */
      setTimeout(() => {
        if (!composer) return;
        if (composer.contains(document.activeElement)) return;
        if (cInput && cInput.value.trim()) return;    /* 打ちかけは開いたまま */
        composer.classList.remove('is-open');
      }, 0);
    });
    composer.addEventListener('submit', ev => { ev.preventDefault(); addFromComposer(); });
    pane.appendChild(composer);
    renderComposerTags();
    syncComposer();

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
    /* 見ている日が過ぎていたら、今日に戻す。
       「明日」を映したまま2日放っておくと、開き直したときに過去を映していて、
       しかもタブの落とし先がそこになる——という置き去りを防ぐ。
       自分で過去へなぞって見に行くぶんは、この後いつでもできる */
    if (viewDay && viewDay < todayKey()) { viewDay = null; announceDay(); }
    /* ここで初めてペインが display:flex になる。寸法が取れるのはこの時点から */
    if (field) { field.relayout(); field.start(); }
    render();
  },

  /* 戻る（Android の戻るボタン）。開いているものを畳む。
     日を移していたら今日へ戻す——「最終的にホームへ」の途中の1段。 */
  onBack() {
    if (dayPop) { closeDayPop(); return true; }
    if (detail) { closeDetail(); return true; }
    if (viewDay) { goDay(todayKey()); return true; }
    return false;
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
