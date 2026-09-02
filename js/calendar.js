/* 実施頻度のカレンダー（利用者の指示）

   > 積み上がったもの → ホームの海にカレンダーアイコンを設置。
   > 実施頻度のカレンダー（濃淡）を表示（githubのような）

   レビューがいちばん弱いと言った「習慣化」への答え。
   日々使う面（海）には積み上がったものが一切映らず、当日の手応え（薄化・輪）は
   朝5時に消え、唯一の累積はふりかえりの中で3タップ奥だった。
   **累計を出すことは憲章が禁じていない**（禁じているのは達成率・パーセント・
   分母のある数字・ストリーク・ご褒美・やらなかった日を赤くすること・命令形）。
   だからこれは憲章の代償ではなく、置き場所の問題だった。ここに置く。

   憲章の守り方：
     ・**分母を作らない。**出すのは「その日に何件はじめたか」だけで、
       目標も割合も出さない。濃さは件数そのものに対応する（4段）
     ・**やらなかった日を赤くしない。**0件の日は無彩色（--rv-zero）。
       ふりかえりの直近7日と同じ約束で、色は1色の濃さだけで作る
     ・**連続日数を数えない。**「◯日連続」も「最長」も出さない。
       並んでいる絵はそのまま出るが、**数えて名前を付けることはしない**
     ・命令形にしない。空のときも「まだここに無い」と言うだけ

   数はふりかえり（review.js）と同じ store.startedByDay() から引く。
   同じ事実が2か所で違って見えることが無いように、集計は1本にしてある。 */

import { el } from './ui.js';
import { store } from './store.js';

const WEEKS = 26;                 /* 出す週の数。26週＝およそ半年 */
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

let root = null;

function has(name) { return typeof store[name] === 'function'; }

export function isOpen() { return !!root; }

export function closeCalendar(restoreFocus) {
  if (!root) return false;
  const r = root;
  root = null;
  window.removeEventListener('keydown', r.onKey, true);
  if (r.unsub) { try { r.unsub(); } catch (err) { /* 外すだけ */ } }
  r.back.remove();
  if (restoreFocus && r.was && r.was.isConnected) {
    try { r.was.focus({ preventScroll: true }); } catch (err) { /* 戻せなくてもよい */ }
  }
  return true;
}

export function openCalendar(opts) {
  const o = opts || {};
  if (root) closeCalendar(false);

  const back = el('div', 'cal-back');
  const box = el('div', 'cal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'はじめた日のカレンダー');

  const head = el('div', 'cal-head');
  head.appendChild(el('span', 'tt', 'はじめた日'));
  const closeBtn = el('button', 'cl', '閉じる');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeCalendar(true));
  head.appendChild(closeBtn);
  box.appendChild(head);

  const scroll = el('div', 'cal-scroll');
  box.appendChild(scroll);

  const foot = el('p', 'cal-foot', '');
  box.appendChild(foot);

  back.appendChild(box);
  back.addEventListener('pointerdown', ev => { if (ev.target === back) closeCalendar(true); });

  const onKey = ev => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    closeCalendar(true);
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  root = { back, box, scroll, foot, onKey, was: o.was, unsub: null };

  if (has('on')) { try { root.unsub = store.on(() => render()); } catch (err) { /* 無くても動く */ } }

  render();
  /* いちばん右（きょう）が見えているところから始める */
  scroll.scrollLeft = scroll.scrollWidth;
  closeBtn.focus({ preventScroll: true });
  return true;
}

/* 件数 → 濃さの段。**割合ではない**（分母を作らない）。
   1件と2件を分けるのは、1件でも色が付くことを見せるため。 */
function level(n) {
  if (!n) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

function dayToDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

function render() {
  if (!root) return;
  const scroll = root.scroll;
  scroll.replaceChildren();

  /* 週の頭（日曜）に揃える。きょうを含む週が右端に来るよう、
     前へ WEEKS 週ぶんさかのぼる */
  let rows = [];
  if (has('startedByDay')) {
    try { rows = store.startedByDay(WEEKS * 7) || []; } catch (err) { rows = []; }
  }
  if (!rows.length) {
    scroll.appendChild(el('p', 'cal-empty',
      'はじめたの記録は、まだここに無い。<br>バブルの [タスク開始] から。'));
    root.foot.textContent = '';
    return;
  }

  /* いちばん古い日の曜日ぶん、頭に空きを入れる（列が曜日でそろう） */
  const first = dayToDate(rows[0].day);
  const pad = first ? first.getDay() : 0;
  const cells = new Array(pad).fill(null).concat(rows);

  const grid = el('div', 'cal-grid');
  /* 曜日の見出し。月・水・金だけ（全部出すと細くなって読めない） */
  const dows = el('div', 'cal-dows');
  DOW.forEach((d, i) => {
    const c = el('span', 'cal-dow');
    if (i === 1 || i === 3 || i === 5) c.textContent = d;
    c.setAttribute('aria-hidden', 'true');
    dows.appendChild(c);
  });
  grid.appendChild(dows);

  const cols = el('div', 'cal-cols');
  let curMon = -1;
  for (let w = 0; w * 7 < cells.length; w++) {
    const col = el('div', 'cal-col');
    /* 月が変わる週にだけ月名を置く */
    const head = el('span', 'cal-mon');
    head.setAttribute('aria-hidden', 'true');
    const topCell = cells[w * 7] || cells[w * 7 + 1];
    const d = topCell ? dayToDate(topCell.day) : null;
    if (d && d.getMonth() !== curMon) { curMon = d.getMonth(); head.textContent = MONTH[curMon]; }
    col.appendChild(head);

    for (let i = 0; i < 7; i++) {
      const cell = cells[w * 7 + i];
      const box = el('span', 'cal-cell');
      if (!cell) { box.classList.add('is-pad'); box.setAttribute('aria-hidden', 'true'); col.appendChild(box); continue; }
      const lv = level(cell.n);
      box.dataset.lv = String(lv);
      const dt = dayToDate(cell.day);
      const label = dt ? ((dt.getMonth() + 1) + '月' + dt.getDate() + '日') : cell.day;
      /* 数はここにだけ置く（分母は無い）。0件の日は「まだ」とだけ言う——
         「0件」と書くのは、やらなかったことを名指しするのに近い */
      box.title = label + '　' + (cell.n ? cell.n + '件' : 'まだ');
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', box.title);
      col.appendChild(box);
    }
    cols.appendChild(col);
  }
  grid.appendChild(cols);
  scroll.appendChild(grid);

  /* 下の一言。累計だけ出す（分母は作らない）。ふりかえりのヒーロー数字と同じ数 */
  let total = 0;
  if (has('totalStarted')) { try { total = store.totalStarted() || 0; } catch (err) { total = 0; } }
  root.foot.textContent = total
    ? 'これまでに、はじめたと記録したぶん ' + total + '件。'
    : 'はじめたの記録は、まだここに無い。';
}
