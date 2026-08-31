/* 起動と画面の切り替え。
   画面モジュールの約束：
     { id, label, icon, mount(pane), onShow?(), onHide?() }
   mount は最初にそのタブを開いたときに1回だけ呼ぶ。

   下タブはナビゲーションであると同時に、バブルの落下先でもある。
   落下先になれるのは sea / today / plan / gap の4つだけで、
   review / settings は受けない（data-drop="no"）。
   判定に使うのは指先の座標で、バブルの外形ではない（外形はタブ6本ぶんを覆うため）。 */

import { store } from './store.js';
import { toast } from './ui.js';

import { setCaptureHandler, setWorklogHandler } from './focus.js';
import { setCenterHandler } from './bubble.js';
import sea from './screens/sea.js';
import today, { openDayPicker, dayBadge } from './screens/today.js';
import plan from './screens/plan.js';
import gap from './screens/gap.js';
import review from './screens/review.js';
import settings from './screens/settings.js';

const SCREENS = [sea, today, plan, gap, review, settings];

/* バブルを受けられるタブ。bubble.js のドロップ判定もこの並びを見る */
const DROPPABLE = new Set(['sea', 'today', 'plan', 'gap']);

const panesRoot = document.getElementById('panes');
const tabbar = document.getElementById('tabbar');
const mounted = new Set();
let current = null;

function paneOf(screen) {
  let pane = document.getElementById('pane-' + screen.id);
  if (!pane) {
    pane = document.createElement('section');
    pane.className = 'pane';
    pane.id = 'pane-' + screen.id;
    panesRoot.appendChild(pane);
  }
  return pane;
}

/* --- 戻ってくる日の来た長期保留を、海へ戻す（利用者の指示） ---

   走らせる場所は3つ。**どれも「見る直前」**で、時計では起こさない。
     ・起動したとき（最初の描画より前）
     ・画面を切り替えたとき
     ・アプリが表に戻ったとき（開いたまま朝を跨いだ場合）
   タイマーで起こさないのは、見ていない画面のバブルが独りでに増えても
   誰も得をしないうえ、裏に回っていると setTimeout は間引かれて当てにならないため。

   知らせ方の決めごと：
     ・**責めない。**「期限切れ」「◯日放置」は出さない（README の禁止事項）
     ・戻ってきた事実だけを言う。取り消しボタンは付けない
       （自分で決めた日が来ただけなので、取り消す対象の操作が無い） */
function sweepHolds() {
  if (typeof store.sweepHolds !== 'function') return;
  let back;
  try { back = store.sweepHolds(); } catch (err) { return; }
  if (!Array.isArray(back) || !back.length) return;
  const first = String((back[0] && back[0].text) || '').trim();
  const head = first.length > 18 ? first.slice(0, 18) + '…' : first;
  toast(back.length === 1
    ? '「' + head + '」が海にもどった'
    : '「' + head + '」ほか' + (back.length - 1) + '件が海にもどった');
}

function show(id) {
  sweepHolds();
  if (current && current.id === id) return;

  if (current && typeof current.onHide === 'function') current.onHide();

  const next = SCREENS.find(s => s.id === id) || SCREENS[0];
  const pane = paneOf(next);

  if (!mounted.has(next.id)) { next.mount(pane); mounted.add(next.id); }

  SCREENS.forEach(s => {
    const p = document.getElementById('pane-' + s.id);
    if (p) p.classList.toggle('is-active', s.id === next.id);
  });
  [...tabbar.children].forEach(btn => {
    const on = btn.dataset.screen === next.id;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-current', on ? 'page' : 'false');
  });

  current = next;
  if (typeof next.onShow === 'function') next.onShow();
}

/* 日付キーを n 日ずらす。正午に寄せてから動かす（夏時間の日でも飛ばない）。
   today.js が同じものを持っているが、あちらは画面の内側なので、
   ここから呼べる形で1つ置く（store には日をずらす口が dayAfter しか無い＝今日起点のみ） */
function shiftDayKey(key, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  d.setDate(d.getDate() + (Math.floor(Number(n)) || 0));
  const p = x => (x < 10 ? '0' + x : String(x));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---- 「今日」タブの長押しと、日付の札（利用者の指示） ----

   映している日が今日でないとき、タブの文字を「今日」から「8/31」に変える。
   ＝ **落とし先が今日でないことが、タブ自身に書いてある。**
   前は今日の画面の見出しにしか出ておらず、海に居るあいだは分からなかった。 */
let todayTabLabel = null;

SCREENS.forEach(s => {
  paneOf(s);
  const btn = document.createElement('button');
  btn.type = 'button';
  /* bubble.js のドロップ判定はこの2つの属性だけを見る。
     dataset.id も残してあるのは、既存コードからの参照を切らないため */
  btn.dataset.screen = s.id;
  btn.dataset.id = s.id;
  btn.dataset.drop = DROPPABLE.has(s.id) ? 'yes' : 'no';
  const ic = document.createElement('span');
  ic.className = 'ic';
  ic.textContent = s.icon;
  ic.setAttribute('aria-hidden', 'true');
  const lb = document.createElement('span');
  lb.textContent = s.label;
  btn.appendChild(ic);
  /* 「今日」だけは、長押しで日を選べることを ▽ で示す（利用者の指示）。
     ▽ は海の「▽しぼる」と同じ意味で使っている記号——**押すと何か出る**。
     この画面で新しい記号を増やさないよう、そちらに合わせた。

     ・aria-hidden。読み上げには乗せない（名前は「今日」のままでよい）。
       長押しでできることは title で添える
     ・ラベルとは別の span にしてある。日付に変わるとき差し替えるのは
       ラベルのほうだけなので、同じ span に入れると ▽ ごと消える */
  if (s.id === 'today') {
    const row = document.createElement('span');
    row.className = 'lbrow';
    const hint = document.createElement('span');
    hint.className = 'hold';
    hint.textContent = '▽';
    hint.setAttribute('aria-hidden', 'true');
    row.appendChild(lb);
    row.appendChild(hint);
    btn.appendChild(row);
    btn.title = '長押しで日を選ぶ';
  } else {
    btn.appendChild(lb);
  }
  btn.addEventListener('click', () => show(s.id));
  /* 「今日」だけ、長押しで日を選べる（利用者の指示）。
     いま映している日がタブの落とし先でもあるので、
     **移る前に、ここから直に決められる**のがいちばん短い道になる */
  if (s.id === 'today') {
    todayTabLabel = lb;
    attachDayHold(btn);
  }
  tabbar.appendChild(btn);
});

/* ---------------- タブの色（利用者の指示） ----------------

   「下のタブの色を、現在の対応色にして（文字の見やすさに注意して）」

   タブが指している場所の色を、そのままタブに出す。**いまの色**を出すので、
   ここでは決め打ちせず store から読む（タグの色は配り直しが起きうる。PAL_VER）。

     海       … --bub-edge（海そのものの色。タグではない）
     今日     … タグ「今日」の色
     きっかけ … タグ「きっかけ」の色
     すきま   … タグ「すきま」の色
     ふりかえり / 設定 … 対応する色が無いので、色を持たせない

   ふりかえりと設定に色を付けなかったのは、**対応する色が無いから**。
   揃えるために適当な色を割り当てると「この色は何を指しているのか」に答えが無くなる。

   **文字には載せない。**タグの色は 12色すべて OKLCH の L .855〜.935 の淡色で、
   白地の文字に使うと 4.5:1 どころか 2:1 も出ない。色を出すのはアイコンと、
   選んでいるときの上の線・地の色だけ。ラベルは今までどおり --text-2 / --text。
   アイコンも生の色ではなく、**文字色と混ぜて**沈める（明るい地では暗く、
   暗い地では明るくなる＝1つの式で両方のテーマに効く）。 */
const TAB_TAG = { today: 'today', plan: 'plan', gap: 'gap' };
const HEX_OK = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

function tabColorOf(id, byId) {
  if (id === 'sea') return 'var(--bub-edge)';
  const key = TAB_TAG[id];
  if (!key) return '';
  const t = byId.get(key);
  const c = t && typeof t.color === 'string' ? t.color.trim() : '';
  return HEX_OK.test(c) ? c : '';
}

function syncTabColors() {
  let list = [];
  try { list = (typeof store.tags === 'function' ? store.tags() : []) || []; }
  catch (err) { list = []; }
  const byId = new Map();
  list.forEach(t => { if (t && typeof t.id === 'string') byId.set(t.id, t); });
  [...tabbar.children].forEach(btn => {
    const c = tabColorOf(btn.dataset.id, byId);
    if (c) btn.style.setProperty('--tab-c', c);
    else btn.style.removeProperty('--tab-c');
    btn.classList.toggle('has-c', !!c);
  });
}

syncTabColors();
/* 色が配り直されたら追いかける（設定でタグを触ったときもここを通る） */
if (typeof store.on === 'function') store.on(syncTabColors);

window.addEventListener('bubbles:dayview', ev => {
  if (!todayTabLabel) return;
  const b = (ev && ev.detail && ev.detail.badge) || null;
  todayTabLabel.textContent = b || '今日';
  todayTabLabel.classList.toggle('is-otherday', !!b);
});

/* 長押し。指が 8px 以上動いたら取り消す（なぞりと取り合わない）。
   開いたあとの click は捨てる——長押しで画面まで移ってしまうと、
   「選ぼうとしただけ」なのに面が変わる */
function attachDayHold(btn) {
  const HOLD = 450;
  let timer = 0, x0 = 0, y0 = 0, fired = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  btn.addEventListener('pointerdown', ev => {
    if (ev.button != null && ev.button !== 0) return;
    fired = false; x0 = ev.clientX; y0 = ev.clientY;
    clear();
    timer = setTimeout(() => {
      timer = 0; fired = true;
      try { openDayPicker(btn); } catch (_) { /* 開けないだけ */ }
    }, HOLD);
  });
  btn.addEventListener('pointermove', ev => {
    if (!timer) return;
    if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) clear();
  });
  btn.addEventListener('pointerup', clear);
  btn.addEventListener('pointercancel', clear);
  btn.addEventListener('contextmenu', ev => ev.preventDefault());   /* 長押しの選択メニューを出さない */
  btn.addEventListener('click', ev => {
    if (!fired) return;
    fired = false;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
}

/* 立ち上げ時に、いま映している日を札へ反映する（開き直したときの取りこぼしを塞ぐ） */
try {
  const b0 = dayBadge();
  if (todayTabLabel && b0) {
    todayTabLabel.textContent = b0;
    todayTabLabel.classList.add('is-otherday');
  }
} catch (_) { /* 出ないだけ */ }

/* 集中画面で割り込んできた考えの預け先。海（未分類）に入れる。
   focus.js が store を触らずに済むよう、ここで1回だけ差す。 */
setCaptureHandler((text) => {
  store.add(text, { fx: 0.2 + Math.random() * 0.6, fy: 0.2 + Math.random() * 0.6 });
});

/* 集中画面の作業ログ（最後になにをしてたか／次の一手）の出し入れ。
   これも focus.js を store から切り離すための差し込み口。
   店側の API がまだ無い版でも落ちないよう、1つずつ有無を見る。 */
const has = (name) => typeof store[name] === 'function';
setWorklogHandler({
  lastStep:  (id) => (has('lastStep') ? store.lastStep(id) : null),
  firstStep: (id) => (has('firstStepOf') ? store.firstStepOf(id) : ''),
  url:       (id) => (has('urlOf') ? store.urlOf(id) : ''),
  draft:     (id) => (has('draftOf') ? store.draftOf(id) : { did: '', next: '' }),
  saveDraft: (id, v) => { if (has('setDraft')) store.setDraft(id, v); },
  /* 「記録する」を押したときだけ呼ばれる。next が入っていれば
     store 側が firstStep も更新する（追補 D） */
  commit:    (id, v) => (has('commitStep') ? store.commitStep(id, v) : null),
  /* 書き損じ直し。新しい記録は増やさない */
  amendLast: (id, v) => (has('amendLastStep') ? store.amendLastStep(id, v) : false),
  /* 一手の記録（古い順）。集中画面の [履歴] が読む。無ければボタンを出さない */
  steps:     (id) => (has('stepsOf') ? store.stepsOf(id) : []),
});

/* 中央に寄せたバブルに出る「次の一手」と「リンク」の出し入れ。
   bubble.js を store から切り離すための差し込み口（focus.js と同じ形）。 */
setCenterHandler({
  firstStep:    (id) => (has('firstStepOf') ? store.firstStepOf(id) : ''),
  setFirstStep: (id, v) => { if (has('setFirstStep')) store.setFirstStep(id, v); },
  url:          (id) => (has('urlOf') ? store.urlOf(id) : ''),
  /* http / https 以外は store が弾く。ここでは素通し */
  setUrl:       (id, v) => { if (has('setUrl')) store.setUrl(id, v); },
  /* 一手の記録（古い順）。無ければ盤に「履歴」のボタンを出さない */
  steps:        (id) => (has('stepsOf') ? store.stepsOf(id) : []),

  /* --- 日を移す（利用者の指示）---

     カレンダーで日を入り切りする（利用者の指示）。
     **どの画面の盤からでも使える**——カレンダーは日そのものを見せるので、
     「この日」がどの日かを画面の文脈に頼らない（前の [次の日へ] はそこが弱かった）。

     1件は複数の日に置ける（days は配列）。カレンダーはそれをそのまま入り切りする。 */
  /* その項目が置かれている日（古い順）。盤のカレンダーが読む */
  days:         (id) => (has('daysOf') ? store.daysOf(id) : []),
  setDay:       (id, key, on) => { if (has('setDay')) store.setDay(id, key, on); },
  shiftDay:     (key, n) => shiftDayKey(key, n),

  /* 盤の [OK] が積む1件（利用者の指示）。
     集中画面と**同じ store の口**を使う（記録の入口を2つにしない）。
     draft は「書きかけ」で記録ではない。打った文字が消えないためだけのもの。 */
  commitStep:   (id, entry) => (has('commitStep') ? store.commitStep(id, entry) : null),
  draft:        (id) => (has('draftOf') ? store.draftOf(id) : null),
  setDraft:     (id, d) => { if (has('setDraft')) store.setDraft(id, d); },

  /* 盤でタグを付け外しするための3つ（A-10）。
     「完了」は盤が自分で外す（専用のボタンがあり、音と取り消しが付いているため）。 */
  tags:         () => (has('tags') ? store.tags() : []),
  tagsOf:       (id) => (has('tagsOf') ? store.tagsOf(id) : []),
  setTag:       (id, tagId, on) => (has('setTag') ? store.setTag(id, tagId, on) : false),

  /* 長期保留の「戻ってくる日」（利用者の指示）。
     盤は日付キーの文字列しか触らない。5時の境目も月末のつぶし方も store 側にある */
  holdUntil:    (id) => (has('holdUntil') ? store.holdUntil(id) : null),
  setHoldUntil: (id, key) => (has('setHoldUntil') ? store.setHoldUntil(id, key) : false),
  todayKey:     () => (has('todayKey') ? store.todayKey() : null),
  dayAfter:     (n) => (has('dayAfter') ? store.dayAfter(n) : null),
  monthAfter:   (n) => (has('monthAfter') ? store.monthAfter(n) : null),
});

/* 保存できなかったときに、それを画面へ出す（B-4）。

   store は UI を知らないので、文言はここで決める。
   出し方の決めごと：
     ・**責めない。**容量が足りないのは使い方のせいではない
     ・**同じことを何度も言わない。**保存はほとんどの操作で走るので、
       出しっぱなしにすると操作のたびにトーストが出る。一度出したら、
       次に保存が通るまで黙る
     ・取り消しボタンは付けない（取り消せる操作ではない）

   直し方（設定の「記録ごと初期化」）まで案内はしない。
   それは記録を全部捨てる操作なので、こちらから勧める筋ではない。 */
let saveErrorShown = false;
store.onSaveError(() => {
  if (saveErrorShown) return;
  saveErrorShown = true;
  toast('いま書いたものを保存できなかった。端末の空きが足りないかもしれない', null, 8000);
});
/* 保存が通ったら、また言えるようにする。store 側は成功で saveError() を null に戻す */
store.on(() => { if (saveErrorShown && !store.saveError()) saveErrorShown = false; });

/* 画面から画面へ渡る道。いまは「ふりかえり → 完了の海」だけが使う。
   画面どうしを直接 import すると循環参照になるので、window のイベントで受ける。
   detail = { screen: 'sea', face: 'done' } のような形。face は受け取れる画面だけが使う。 */
window.addEventListener('bubbles:goto', (ev) => {
  const d = (ev && ev.detail) || {};
  if (!d.screen) return;
  const target = SCREENS.find(s => s.id === d.screen);
  if (!target) return;
  show(target.id);
  if (d.face && typeof target.openFace === 'function') target.openFace(d.face);
});

show(SCREENS[0].id);

/* 開いたまま朝を跨いだとき用。裏から表に戻った一度だけ見る */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sweepHolds();
});

/* 「タブへ落とした」の処理は各画面が持つ（取り消し付きのトーストを出したいため）。
   ここに共通版を置くと、画面ごとの取り消しと二重になって
   同じ操作に2枚のトーストが出る。だからここでは持たない。
   落下先の対応表は契約 §2 にあり、実装は各 screens/*.js の onDropToTab にある。 */
