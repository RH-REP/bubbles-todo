/* 日付で見る（終了日の近い順。2026-11-07 Issue #24）。海のリスト表示のもう1つの形。

   縦に泡（終了日の近い順）、横に日付（今日から）。左の列に名前と「あと N 日」。
   表の印: ● 終了日 ／ ・ 置いた日（いつの日） ／ 帯 先の予定の期間。
   決まり（README「このアプリが引き受けないこと」）:
     ・過ぎた日は出さない（期限切れ・◯日過ぎの札を作らない）。赤は使わない。数・割合を出さない
     ・名前は命令形にしない
   列の見出しには、選んだ地域の天気（印と 最高/最低）を出す（2026-11-08 Issue #30。js/weather.js）。
   計算は js/deadline.js。名前を押すと、ふだんと同じ盤（menu）が開く（opts.open）。
   泡の名前は textContent で入れる（ui.js の el の第3引数は innerHTML なので、決まった文字だけに使う）。 */

import { el } from './ui.js';
import { deadlineRows, columnCount, columns, cellMark, inSpan, leftLabel, keyOf } from './deadline.js';
import { POINTS, pointId, CREDIT_URL, DAYS, loadData, loadArea, saveArea, fetchForecast, forecastFor, sizeLabel } from './weather.js';

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
  /* 天気（2026-11-08 Issue #30）。全国の約140地点をまとめて取り、地域はここで選ぶ（js/weather.js）。
     押したときだけ取る。地域を選んでいないうちは、列に何も出さない */
  let wx = loadData();
  let area = loadArea();
  let lastItems = [];
  const wxBar = el('div', 'dl-wxbar');
  const pick = el('select', 'dl-wxarea');
  pick.setAttribute('aria-label', '天気を見る地域');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '天気の地域を選ぶ';
  pick.appendChild(none);
  let group = null;
  POINTS.forEach((p, i) => {
    if (!group || group.label !== p[0]) {
      group = document.createElement('optgroup');
      group.label = p[0];
      pick.appendChild(group);
    }
    const op = document.createElement('option');
    op.value = String(i);
    op.textContent = p[1] + '（' + p[2] + '）';
    op.dataset.id = pointId(p);
    group.appendChild(op);
  });
  pick.value = area >= 0 ? String(area) : '';
  pick.addEventListener('change', () => {
    area = pick.value === '' ? -1 : Number(pick.value);
    saveArea(area);
    syncWx();
    render(lastItems);
  });
  const getBtn = el('button', 'dl-wxget');
  getBtn.type = 'button';
  getBtn.textContent = '天気を取得';
  getBtn.title = '全国の約' + POINTS.length + '地点の' + DAYS + '日分をまとめて取る（選んだ地域は送らない）';
  const wxMsg = el('span', 'dl-wxmsg');
  wxMsg.setAttribute('role', 'status');
  const credit = el('a', 'dl-wxcredit');
  credit.href = CREDIT_URL;
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  credit.textContent = '天気: Open-Meteo.com';
  wxBar.appendChild(pick);
  wxBar.appendChild(getBtn);
  wxBar.appendChild(wxMsg);
  wxBar.appendChild(credit);
  let busy = false;
  let wxErr = '';
  getBtn.addEventListener('click', async ev => {
    ev.preventDefault();
    if (busy) return;
    busy = true; wxErr = '';
    getBtn.disabled = true;
    wxMsg.textContent = '取得しています…';
    try { wx = await fetchForecast(); } catch (e) { wxErr = (e && e.message) || '取れなかった'; }
    busy = false;
    getBtn.disabled = false;
    syncWx();
    render(lastItems);
  });
  function syncWx() {
    credit.hidden = !wx;
    if (busy) return;
    if (wxErr) { wxMsg.textContent = wxErr + (wx ? '。前に取ったものを出している' : ''); return; }
    if (!wx) { wxMsg.textContent = area >= 0 ? 'まだ取っていない' : ''; return; }
    const d = new Date(wx.at);
    const z = x => String(x).padStart(2, '0');
    wxMsg.textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
      + ' に取得・' + sizeLabel(wx.bytes) + (area < 0 ? '（地域を選ぶと列に出る）' : '');
  }
  syncWx();

  root.appendChild(cap);
  root.appendChild(wxBar);
  root.appendChild(legend);
  root.appendChild(hols);
  root.appendChild(empty);
  root.appendChild(scroller);
  host.appendChild(root);

  function render(items) {
    lastItems = items || [];
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
      const f = area >= 0 ? forecastFor(wx, area, c.key) : null;
      if (f) {
        const ic = el('span', 'dl-wx');
        ic.textContent = f.icon;
        h.appendChild(ic);
        const tp = el('span', 'dl-tp');
        tp.textContent = (f.hi === null ? '-' : f.hi) + '/' + (f.lo === null ? '-' : f.lo);
        h.appendChild(tp);
        const say = f.name + (f.hi === null ? '' : ' 最高' + f.hi + '℃') + (f.lo === null ? '' : ' 最低' + f.lo + '℃');
        h.title = (h.title ? h.title + '　' : '') + say;
        h.setAttribute('aria-label', (+c.key.slice(5, 7)) + '月' + c.d + '日　' + say);
        h.classList.add('has-wx');
      }
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
