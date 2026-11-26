/* 週・月で見る（リスト表示の形。2026-11-23 Issue #80 の返事「下のタブではなく、リスト表示の一覧、日付、4つに、週と月を増やして」）。

   前は下のタブの画面（js/screens/period.js。2026-11-22）だった。返事で、海のリスト表示の形
   「一覧・日付・四つ・週・月」の 2 つに移した（日付で見る js/deadlineview.js と同じ作り）。
   - 週は月曜〜日曜、月はその月の 1 日〜末日。‹ › で前後へ、真ん中の見出しで今週・今月へ戻る
   - 月のときは年（‹ 2026年 ›）と 1月〜12月 の札（過去の月も）。既定は隠し、［月を選ぶ ▾］で出し入れ（2026-11-23）
   - 表示［すべて］［まだ］［済んだ］と並び［書いた順］［新しい順］［名前順］（この端末に残る）
   - 日に出るのは、置いた日・期間の始まる日・終わる日・完了した日（js/deadline.js の periodDays）。何も無い日は出さない
   - 名前を押すと、一覧と同じく泡を押したときの詳細（opts.open(id, node)。海の openBoardFor）
   - 日の見出しを押すと、今日の画面のその日（opts.onDay(key)）
   - 件数・割合・「期限切れ」は出さない
   返り値 = { el, setMode('week'|'month'), mode(), goNow(), away(), render(items), clear() } */

import { el } from './ui.js';
import { periodDays, weekStart, monthRange, addDays, arrangeRows, PERIOD_SHOW, PERIOD_ORDER, keyOf } from './deadline.js';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const VIEW_KEY = 'bubble_todo_period_view';
const SHOW_LB = [['all', 'すべて'], ['todo', 'まだ'], ['done', '済んだ']];
const ORDER_LB = [['old', '書いた順'], ['new', '新しい順'], ['name', '名前順']];
const KIND = { start: '始まる日', end: '終わる日', done: '完了' };
const EMPTY = {
  all: 'この間に置いたもの・期間のあるもの・完了したものは見当たらない',
  todo: 'この間に、まだのものは見当たらない',
  done: 'この間に、済んだものは見当たらない',
};

function loadView() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch (e) { v = null; }
  v = v && typeof v === 'object' ? v : {};
  return {
    show: PERIOD_SHOW.indexOf(v.show) >= 0 ? v.show : 'all',
    order: PERIOD_ORDER.indexOf(v.order) >= 0 ? v.order : 'old',
  };
}

function dateOf(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date();
}
function md(key) { const d = dateOf(key); return (d.getMonth() + 1) + '/' + d.getDate(); }
function mdw(key) { const d = dateOf(key); return md(key) + '（' + DOW[d.getDay()] + '）'; }
function button(cls, text, label, on) {
  const b = el('button', cls);
  b.type = 'button';
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', ev => { ev.preventDefault(); on(); });
  return b;
}

export function createPeriodView(host, opts = {}) {
  const root = el('div', 'period pd-view-root' + (opts.className ? ' ' + opts.className : ''));
  root.hidden = true;
  root.setAttribute('role', 'group');
  const headEl = el('div', 'pd-head');
  const body = el('div', 'pd-body');
  root.appendChild(headEl);
  root.appendChild(body);
  host.appendChild(root);

  const todayKey = () => (typeof opts.today === 'function' ? opts.today() : keyOf(new Date()));
  let mode = 'week';
  let weekFrom = null;     /* 見ている週の月曜。null なら今週 */
  let ym = null;           /* 見ている月 { y, m }。null なら今月 */
  let view = loadView();
  let lastItems = [];
  let pickOpen = false;    /* 月のときの年・月の札を出しているか（既定は隠す） */

  const thisMonth = () => { const d = dateOf(todayKey()); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };
  const curWeek = () => weekFrom || weekStart(todayKey());
  const curMonth = () => ym || thisMonth();
  const shiftMonth = (o, n) => { const i = o.y * 12 + (o.m - 1) + n; return { y: Math.floor(i / 12), m: (i % 12) + 1 }; };

  function range() {
    if (mode === 'month') {
      const c = curMonth(), t = thisMonth();
      const r = monthRange(c.y, c.m);
      const isNow = c.y === t.y && c.m === t.m;
      return { from: r.from, n: r.n, label: (isNow ? '今月 ' : '') + c.y + '年' + c.m + '月', isNow };
    }
    const from = curWeek();
    const now = weekStart(todayKey());
    const isNow = from === now;
    const word = isNow ? '今週 ' : from === addDays(now, -7) ? '先週 ' : from === addDays(now, 7) ? '来週 ' : '';
    return { from, n: 7, label: word + md(from) + ' 〜 ' + md(addDays(from, 6)), isNow };
  }

  const rerender = () => render(lastItems);
  function step(n) {
    if (mode === 'month') ym = shiftMonth(curMonth(), n);
    else weekFrom = addDays(curWeek(), 7 * n);
    rerender();
  }
  function goNow() {
    if (mode === 'month') ym = null; else weekFrom = null;
    rerender();
  }

  function renderHead(r) {
    headEl.textContent = '';
    const row = el('div', 'pd-steprow');
    const unit = mode === 'month' ? '月' : '週';
    row.appendChild(button('pd-step', '‹', '前の' + unit + 'へ', () => step(-1)));
    const lb = button('pd-label', r.label, r.label + (r.isNow ? '' : '。押すと今' + unit + 'へ戻る'), goNow);
    if (!r.isNow) lb.classList.add('is-away');
    row.appendChild(lb);
    row.appendChild(button('pd-step', '›', '次の' + unit + 'へ', () => step(1)));
    /* 年と 1月〜12月 の札は初めは隠し、この札で出し入れする（2026-11-23 Issue #80 の返事
       「月の年選択ボタンと月選択ボタンのUIをデフォルト非表示で、タップで表示非表示を切り替えられるようにできる？」）。
       開いたかどうかは、アプリを開いている間だけ覚える */
    if (mode === 'month') {
      const tg = button('pd-pick', pickOpen ? '月を選ぶ ▴' : '月を選ぶ ▾', null, () => { pickOpen = !pickOpen; rerender(); });
      tg.setAttribute('aria-expanded', pickOpen ? 'true' : 'false');
      tg.setAttribute('aria-label', pickOpen ? '年と月の見出しを隠す' : '年と月の見出しを出す');
      row.appendChild(tg);
    }
    headEl.appendChild(row);

    if (mode === 'month' && pickOpen) {
      const c = curMonth(), t = thisMonth();
      const yr = el('div', 'pd-yearrow');
      yr.appendChild(button('pd-ystep', '‹', (c.y - 1) + '年へ', () => { ym = { y: c.y - 1, m: c.m }; rerender(); }));
      const yl = el('span', 'pd-year');
      yl.textContent = c.y + '年';
      yr.appendChild(yl);
      yr.appendChild(button('pd-ystep', '›', (c.y + 1) + '年へ', () => { ym = { y: c.y + 1, m: c.m }; rerender(); }));
      headEl.appendChild(yr);
      const grid = el('div', 'pd-months');
      for (let m = 1; m <= 12; m++) {
        const b = button('pd-month', m + '月', c.y + '年' + m + '月', () => { ym = { y: c.y, m }; rerender(); });
        b.setAttribute('aria-pressed', m === c.m ? 'true' : 'false');
        if (c.y === t.y && m === t.m) b.classList.add('is-now');
        grid.appendChild(b);
      }
      headEl.appendChild(grid);
    }

    const wrap = el('div', 'pd-view');
    [['表示', SHOW_LB, 'show'], ['並び', ORDER_LB, 'order']].forEach(([title, list, key]) => {
      const g = el('div', 'pd-viewgrp');
      g.setAttribute('role', 'radiogroup');
      g.setAttribute('aria-label', title);
      const tl = el('span', 'pd-viewlb');
      tl.textContent = title;
      g.appendChild(tl);
      list.forEach(([val, name]) => {
        const b = button('pd-viewbtn', name, null, () => {
          if (view[key] === val) return;
          view = Object.assign({}, view, { [key]: val });
          try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* 置けなくても今は効く */ }
          rerender();
        });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', view[key] === val ? 'true' : 'false');
        g.appendChild(b);
      });
      wrap.appendChild(g);
    });
    headEl.appendChild(wrap);
  }

  function render(items) {
    lastItems = items || [];
    const r = range();
    root.setAttribute('aria-label', mode === 'month' ? '月で見る' : '週で見る');
    renderHead(r);
    body.textContent = '';
    const today = todayKey();
    const days = periodDays(lastItems, r.from, r.n)
      .map(d => Object.assign({}, d, { rows: arrangeRows(d.rows, view) }))
      .filter(d => d.rows.length);
    if (!days.length) {
      const p = el('p', 'pd-empty');
      p.textContent = EMPTY[view.show] || EMPTY.all;
      body.appendChild(p);
      return;
    }
    days.forEach(d => {
      const sec = el('section', 'pd-day');
      if (d.off) sec.classList.add('is-off');
      else if (d.sat) sec.classList.add('is-sat');
      if (d.key === today) sec.classList.add('is-today');
      const off = Math.round((dateOf(d.key) - dateOf(today)) / 86400000);
      const word = off === 0 ? '今日' : off === 1 ? '明日' : off === -1 ? '昨日' : '';
      const head = mdw(d.key) + (word ? ' ' + word : '') + (d.hol ? ' ' + d.hol : '');
      sec.appendChild(button('pd-dhead', head, mdw(d.key) + 'の今日の画面へ', () => { if (opts.onDay) opts.onDay(d.key); }));
      const ul = el('ul', 'pd-rows');
      const hasTodo = d.rows.some(x => !x.done);
      d.rows.forEach((row, i) => {
        if (view.show === 'all' && row.done && hasTodo && !d.rows[i - 1].done) {
          const sub = el('li', 'pd-sub');
          sub.textContent = '済んだ';
          sub.setAttribute('role', 'presentation');
          ul.appendChild(sub);
        }
        const li = el('li', 'pd-row');
        if (row.done) li.classList.add('is-done');
        const b = el('button', 'pd-item');
        b.type = 'button';
        b.dataset.id = row.id;
        const nm = el('span', 'pd-nm');
        nm.textContent = (row.done ? '✓ ' : '') + row.text;      /* ユーザーの文字 */
        b.appendChild(nm);
        const kinds = row.kinds.filter(k => KIND[k]).map(k => KIND[k]);
        if (kinds.length) {
          const k = el('span', 'pd-kind');
          k.textContent = kinds.join('・');
          b.appendChild(k);
        }
        const short = row.text.length > 18 ? row.text.slice(0, 18) + '…' : row.text;
        b.setAttribute('aria-label', '「' + short + '」の詳細を開く');
        /* 一覧の行と同じく、泡を押したときと同じ詳細を開く（返事「タップ時の操作は一覧の時と同じに」） */
        b.addEventListener('click', ev => { ev.preventDefault(); if (opts.open) opts.open(row.id, b); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    });
  }

  return {
    el: root,
    setMode(m) { if (m === 'week' || m === 'month') mode = m; },
    mode: () => mode,
    goNow() { weekFrom = null; ym = null; },
    away: () => (mode === 'month' ? !!ym : !!weekFrom),
    render,
    clear() { headEl.textContent = ''; body.textContent = ''; },
  };
}
