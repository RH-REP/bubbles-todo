/* 日付で見る（終了日の近い順。2026-11-07 Issue #24）。海のリスト表示のもう1つの形。

   縦に泡（終了日の近い順）、横に日付（今日から）。左の列に名前と「あと N 日」。
   表の印: ● 終了日 ／ ・ 置いた日（いつの日） ／ 帯 先の予定の期間。
   決まり（README「このアプリが引き受けないこと」）:
     ・過ぎた日は出さない（期限切れ・◯日過ぎの札を作らない）。赤は使わない。数・割合を出さない
     ・名前は命令形にしない
   計算は js/deadline.js。名前を押すと、ふだんと同じ盤（menu）が開く（opts.open）。
   泡の名前は textContent で入れる（ui.js の el の第3引数は innerHTML なので、決まった文字だけに使う）。 */

import { el } from './ui.js';
import { deadlineRows, columnCount, columns, cellMark, inSpan, leftLabel, keyOf } from './deadline.js';

/* opts.open(id, node)   名前を押したとき
   opts.className        箱に足すクラス
   返り値 = { el, render(items), clear() } */
export function createDeadlineView(host, opts = {}) {
  const root = el('div', 'dl-view' + (opts.className ? ' ' + opts.className : ''));
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', '日付で見る（終了日の近い順）');
  const cap = el('p', 'dl-cap', '終了日の近い順');
  const empty = el('p', 'dl-empty', '先の日付のあるものは、まだ無い。盤の「いつの日」で日を置くと、ここに並ぶ。');
  empty.hidden = true;
  const scroller = el('div', 'dl-scroll');
  const table = el('div', 'dl-table');
  scroller.appendChild(table);
  const legend = el('p', 'dl-legend');
  legend.setAttribute('aria-hidden', 'true');
  [['end', '終了日'], ['day', '置いた日'], ['span', '期間']].forEach(([k, lb]) => {
    const it = el('span', 'dl-lg');
    it.appendChild(el('span', 'dl-mk is-' + k));
    it.appendChild(document.createTextNode(lb));
    legend.appendChild(it);
  });
  /* 休みの色（2026-11-07 Issue #24 の返事）。日曜・祝日は杏、土曜は空。赤は使わない */
  [['off', '日曜・祝日'], ['sat', '土曜']].forEach(([k, lb]) => {
    const it = el('span', 'dl-lg');
    it.appendChild(el('span', 'dl-sw is-' + k));
    it.appendChild(document.createTextNode(lb));
    legend.appendChild(it);
  });
  /* 表に映る祝日の名前（見出しの「祝」だけでは何の日か分からないため） */
  const hols = el('p', 'dl-hols');
  root.appendChild(cap);
  root.appendChild(legend);
  root.appendChild(hols);
  root.appendChild(empty);
  root.appendChild(scroller);
  host.appendChild(root);

  function render(items) {
    const today = keyOf(new Date());
    const rows = deadlineRows(items, today);
    table.replaceChildren();
    empty.hidden = rows.length > 0;
    scroller.hidden = rows.length === 0;
    if (!rows.length) return;
    const n = columnCount(rows);
    const cols = columns(today, n);
    const last = cols[cols.length - 1].key;
    table.style.setProperty('--dl-cols', String(n));
    const hl = cols.filter(c => c.hol);
    hols.hidden = hl.length === 0;
    hols.textContent = hl.length ? '祝日: ' + hl.map(c => (+c.key.slice(5, 7)) + '/' + c.d + ' ' + c.hol).join('・') : '';

    const head = el('div', 'dl-row dl-head');
    head.appendChild(el('div', 'dl-name dl-corner', ''));
    cols.forEach((c, i) => {
      const h = el('div', 'dl-col' + dayClass(c, i));
      h.appendChild(el('span', 'dl-m', c.m));
      h.appendChild(el('b', 'dl-d', String(c.d)));
      const wd = el('span', 'dl-wd');
      wd.textContent = i === 0 ? '今日' : (c.hol ? '祝' : c.wd);
      h.appendChild(wd);
      if (c.hol) h.title = c.hol + '（' + c.wd + '）';
      head.appendChild(h);
    });
    table.appendChild(head);

    rows.forEach(r => {
      const row = el('div', 'dl-row');
      row.dataset.id = r.id;
      const nm = el('button', 'dl-name');
      nm.type = 'button';
      const tx = el('span', 'dl-tx');
      tx.textContent = r.text;                          /* ユーザーの文字。el の第3引数は innerHTML なので使わない */
      nm.appendChild(tx);
      nm.appendChild(el('span', 'dl-left' + (r.left === 0 ? ' is-today' : ''), leftLabel(r.left)));
      nm.setAttribute('aria-label', r.text + '、' + leftLabel(r.left) + '（' + r.end + '）');
      nm.addEventListener('click', ev => { ev.preventDefault(); if (opts.open) opts.open(r.id, nm); });
      row.appendChild(nm);
      cols.forEach((c, i) => {
        const mk = cellMark(r, c.key);
        const cell = el('div', 'dl-cell' + dayClass(c, i));
        cell.setAttribute('aria-hidden', 'true');
        if (inSpan(r, c.key)) cell.appendChild(el('span', 'dl-bar'));
        if (mk && mk !== 'span') cell.appendChild(el('span', 'dl-mk is-' + mk));
        if (i === cols.length - 1 && r.end > last) cell.appendChild(el('span', 'dl-more', '→'));
        row.appendChild(cell);
      });
      table.appendChild(row);
    });
  }

  function clear() { table.replaceChildren(); }

  /* 列の印。休み（日曜・祝日）と土曜で地の色を変える */
  function dayClass(c, i) {
    return (i === 0 ? ' is-today' : '') + (c.off ? ' is-off' : '') + (c.hol ? ' is-hol' : '')
      + (c.sat && !c.off ? ' is-sat' : '') + (c.m && i ? ' is-month' : '');
  }

  return { el: root, render, clear };
}

/* 切り替えのボタン（四つに分けるのボタンと同じ形。見た目は css の .quad-btn を使う） */
export function deadlineButton(onClick) {
  const b = el('button', 'quad-btn dl-btn');
  b.type = 'button';
  const ic = el('span', 'ic', '▤');
  ic.setAttribute('aria-hidden', 'true');
  b.appendChild(ic);
  b.addEventListener('click', ev => { ev.preventDefault(); onClick(); });
  syncDeadlineButton(b, false);
  return b;
}
export function syncDeadlineButton(b, on) {
  if (!b) return;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', on ? '日付で見るのをやめる' : '日付で見る（終了日の近い順）');
  b.title = on ? '押すと元の眺めにもどる' : '日付で見る（終了日の近い順）';
  b.classList.toggle('is-on', on);
}
