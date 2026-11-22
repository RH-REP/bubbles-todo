/* 画面「週・月」— 1週間・1か月の TODO を、日ごとにまとめて見る画面（2026-11-22 Issue #80 の返事）。

   > 1週間と1ヶ月のTODOをまとめて確認したい。オプション表示で
   > 今日のタブと同じく感じ、今週の今月のタブと、1月から12月までの1か月毎(過去分)ものTODOを確認できるような機能とUIを検討して実施して。

   前の版（2026-11-21）は今日の画面の小さな板だった。返事で、今日と同じ下のタブの画面にした。
   - 上に［今週］［今月］の切り替え。‹ › で前後の週・月へ（過去へも先へも）。見出しを押すと今週・今月へ戻る
   - 月のときは、その下に年（‹ 2026年 ›）と 1月〜12月 の札。押すとその月へ（過去の月も見られる）
   - 中身は日ごとの見出しと名前。日に出るのは、その日に置いたもの・期間の始まる日・終わる日・完了した日
     （計算は js/deadline.js の periodDays）。何も無い日は並べない
   - 件数・割合・「期限切れ」は出さない（README の「このアプリが引き受けないこと」）。読むだけの画面
   - 日の見出しか名前を押すと、今日の画面のその日へ移る（泡はそこで今までどおり触れる）
   - 下のタブは、設定の「あまり使わない機能も出す」をオンにしたときだけ出る（オプション表示。js/app.js の EXTRA_TABS）
   - バブルを落とす先ではない（タブの data-drop は no）

   見ている週・月は、この画面を開いている間だけ覚える（ほかの画面へ行って戻っても続き。アプリを開き直すと今週）。 */

import { store } from '../store.js';
import { el } from '../ui.js';
import { periodDays, weekStart, monthRange, addDays } from '../deadline.js';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

let pane = null;
let body = null;
let headEl = null;
let unsubscribe = null;
let mode = 'week';        /* 'week' | 'month' */
let weekFrom = null;      /* 見ている週の月曜。null なら今週 */
let ym = null;            /* 見ている月 { y, m }。null なら今月 */

const todayKey = () => (typeof store.todayKey === 'function' ? store.todayKey() : keyOfDate(new Date()));

function keyOfDate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dateOf(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date();
}
function md(key) { const d = dateOf(key); return (d.getMonth() + 1) + '/' + d.getDate(); }
function mdw(key) { const d = dateOf(key); return md(key) + '（' + DOW[d.getDay()] + '）'; }

function thisMonth() { const d = dateOf(todayKey()); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
function curWeek() { return weekFrom || weekStart(todayKey()); }
function curMonth() { return ym || thisMonth(); }
function shiftMonth(o, n) {
  const i = o.y * 12 + (o.m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

/* 見ている範囲 { from, n, label, isNow } */
function range() {
  if (mode === 'month') {
    const c = curMonth(), t = thisMonth();
    const r = monthRange(c.y, c.m);
    const isNow = c.y === t.y && c.m === t.m;
    return { from: r.from, n: r.n, label: (isNow ? '今月 ' : '') + c.y + '年' + c.m + '月', isNow };
  }
  const from = curWeek();
  const to = addDays(from, 6);
  const now = weekStart(todayKey());
  const isNow = from === now;
  const word = isNow ? '今週 ' : from === addDays(now, -7) ? '先週 ' : from === addDays(now, 7) ? '来週 ' : '';
  return { from, n: 7, label: word + md(from) + ' 〜 ' + md(to), isNow };
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  render();
}

function step(n) {
  if (mode === 'month') ym = shiftMonth(curMonth(), n);
  else weekFrom = addDays(curWeek(), 7 * n);
  render();
}

function goNow() {
  if (mode === 'month') ym = null; else weekFrom = null;
  render();
}

/* 今日の画面のその日へ。先に画面を移す（今日の画面は開いたときに過ぎた日を今日へ戻すため、日はそのあとで渡す） */
function openDay(key) {
  window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'today' } }));
  window.dispatchEvent(new CustomEvent('bubbles:showday', { detail: { key } }));
}

function button(cls, text, label, on) {
  const b = el('button', cls);
  b.type = 'button';
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', ev => { ev.preventDefault(); on(); });
  return b;
}

function renderHead(r) {
  headEl.textContent = '';
  const tabs = el('div', 'pd-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '見る長さ');
  [['week', '今週'], ['month', '今月']].forEach(([k, lb]) => {
    const b = button('pd-tab', lb, null, () => { if (mode === k) goNow(); else setMode(k); });
    b.setAttribute('aria-pressed', mode === k ? 'true' : 'false');
    tabs.appendChild(b);
  });
  headEl.appendChild(tabs);

  const row = el('div', 'pd-steprow');
  const unit = mode === 'month' ? '月' : '週';
  row.appendChild(button('pd-step', '‹', '前の' + unit + 'へ', () => step(-1)));
  const lb = button('pd-label', r.label, r.label + (r.isNow ? '' : '。押すと今' + unit + 'へ戻る'), goNow);
  if (!r.isNow) lb.classList.add('is-away');
  row.appendChild(lb);
  row.appendChild(button('pd-step', '›', '次の' + unit + 'へ', () => step(1)));
  headEl.appendChild(row);

  if (mode !== 'month') return;
  /* 1月〜12月（過去の月もここから）。年は ‹ › で移る */
  const c = curMonth(), t = thisMonth();
  const yr = el('div', 'pd-yearrow');
  yr.appendChild(button('pd-ystep', '‹', (c.y - 1) + '年へ', () => { ym = { y: c.y - 1, m: c.m }; render(); }));
  const yl = el('span', 'pd-year');
  yl.textContent = c.y + '年';
  yr.appendChild(yl);
  yr.appendChild(button('pd-ystep', '›', (c.y + 1) + '年へ', () => { ym = { y: c.y + 1, m: c.m }; render(); }));
  headEl.appendChild(yr);
  const grid = el('div', 'pd-months');
  for (let m = 1; m <= 12; m++) {
    const b = button('pd-month', m + '月', c.y + '年' + m + '月', () => { ym = { y: c.y, m }; render(); });
    b.setAttribute('aria-pressed', m === c.m ? 'true' : 'false');
    if (c.y === t.y && m === t.m) b.classList.add('is-now');
    grid.appendChild(b);
  }
  headEl.appendChild(grid);
}

const KIND = { start: '始まる日', end: '終わる日', done: '完了' };

function render() {
  if (!body) return;
  const r = range();
  renderHead(r);
  body.textContent = '';
  const all = (typeof store.all === 'function') ? store.all() : [];
  const today = todayKey();
  const days = periodDays(all, r.from, r.n).filter(d => d.rows.length);
  if (!days.length) {
    body.appendChild(el('p', 'pd-empty', 'この間に置いたもの・期間のあるもの・完了したものは見当たらない'));
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
    sec.appendChild(button('pd-dhead', head, mdw(d.key) + 'の今日の画面へ', () => openDay(d.key)));
    const ul = el('ul', 'pd-rows');
    d.rows.forEach(row => {
      const li = el('li', 'pd-row');
      if (row.done) li.classList.add('is-done');
      const b = el('button', 'pd-item');
      b.type = 'button';
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
      b.setAttribute('aria-label', '「' + short + '」。' + mdw(d.key) + 'の今日の画面へ');
      b.addEventListener('click', ev => { ev.preventDefault(); openDay(d.key); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    body.appendChild(sec);
  });
}

export default {
  id: 'period',
  label: '週・月',
  icon: '▦',

  mount(node) {
    pane = node;
    const wrap = el('div', 'period');
    headEl = el('div', 'pd-head');
    body = el('div', 'pd-body');
    wrap.appendChild(headEl);
    wrap.appendChild(body);
    pane.appendChild(wrap);
    unsubscribe = store.on(render);
    render();
  },

  onShow() {
    if (typeof store.rollover === 'function') store.rollover();
    render();
  },

  /* 戻る（Android）。今週・今月から離れていたら戻す */
  onBack() {
    if (mode === 'month' ? ym : weekFrom) { goNow(); return true; }
    return false;
  },

  onHide() { /* 動くものが無い */ },

  destroy() { if (unsubscribe) { unsubscribe(); unsubscribe = null; } },
};
