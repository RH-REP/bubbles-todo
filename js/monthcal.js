/* 泡の盤の暦（2026-11-19 ユーザーの決定「7 つとも案どおり」の 7。モック docs/spec/mock/dates.html）。
   やる日・期間を、月の名前つきの同じ形の暦で選ぶ。前の 6 週の枡（やる日）と OS の日付の欄（期間）の代わり。
   描くだけで、記録には触らない。どの日が何か（やる日・期間の帯・くりかえしの次の回）は state(key) が答える。

     monthCal({ today, month, minMonth?, maxMonth?, state(key), onPick(key), label })
       state(key) -> { on, band, bs, be, rep, off }
     -> { root, paint(), show(month) }   month は 'YYYY-MM' */
import { el } from './ui.js';
import { addDays, addMonths, dowOf, DOW_NAMES } from './repeat.js';

export function monthOf(key) { return String(key || '').slice(0, 7); }

export function monthCal(o) {
  const root = el('div', 'bc-mcal');
  root.dataset.name = '暦';
  if (o.label) root.setAttribute('aria-label', o.label);
  const head = el('div', 'bc-mcal-hd');
  const prev = el('button', 'bc-mcal-nav', '‹');
  prev.type = 'button';
  prev.setAttribute('aria-label', '前の月');
  const ttl = el('span', 'bc-mcal-ttl');
  const next = el('button', 'bc-mcal-nav', '›');
  next.type = 'button';
  next.setAttribute('aria-label', '次の月');
  head.appendChild(prev); head.appendChild(ttl); head.appendChild(next);
  root.appendChild(head);
  const grid = el('div', 'bc-mcal-grid');
  root.appendChild(grid);

  let month = o.month || monthOf(o.today);
  let cells = [];

  function build() {
    grid.textContent = '';
    cells = [];
    for (let i = 0; i < 7; i++) {
      const h = el('span', 'bc-cal-h', DOW_NAMES[i]);
      h.setAttribute('aria-hidden', 'true');
      grid.appendChild(h);
    }
    const first = month + '-01';
    let k = addDays(first, -dowOf(first));
    const end = addMonths(first, 1);
    /* 月の初めの週から、月の終わりの週まで（4〜6 段） */
    while (k < end || dowOf(k) !== 0) {
      const key = k;
      const b = el('button', 'bc-cal-d');
      b.type = 'button';
      b.textContent = String(Number(key.slice(8, 10)));
      b.dataset.key = key;
      if (monthOf(key) !== month) b.classList.add('is-out');
      if (key === o.today) b.classList.add('is-today');
      if (key < o.today) b.classList.add('is-past');
      b.addEventListener('click', ev => { ev.preventDefault(); if (!b.disabled) o.onPick(key); });
      grid.appendChild(b);
      cells.push({ key, b });
      k = addDays(k, 1);
    }
    ttl.textContent = Number(month.slice(0, 4)) + '年' + Number(month.slice(5, 7)) + '月';
    prev.disabled = !!(o.minMonth && month <= o.minMonth);
    next.disabled = !!(o.maxMonth && month >= o.maxMonth);
    paint();
  }

  function paint() {
    cells.forEach(({ key, b }) => {
      const s = o.state(key) || {};
      b.classList.toggle('is-on', !!s.on);
      b.classList.toggle('is-band', !!s.band);
      b.classList.toggle('is-bs', !!s.bs);
      b.classList.toggle('is-be', !!s.be);
      b.classList.toggle('is-rep', !!s.rep);
      b.disabled = !!s.off;
      b.setAttribute('aria-pressed', s.on || s.bs || s.be ? 'true' : 'false');
      b.setAttribute('aria-label', Number(key.slice(5, 7)) + '月' + Number(key.slice(8, 10)) + '日（' + DOW_NAMES[dowOf(key)] + '）'
        + (key === o.today ? '・今日' : '') + (s.on ? '・やる日' : '') + (s.band ? '・期間' : '')
        + (s.rep ? '・くりかえしの次の回' : '') + (s.off ? '・過ぎた日は変えられない' : ''));
    });
  }

  function show(m) { month = m; build(); }
  prev.addEventListener('click', ev => { ev.preventDefault(); show(monthOf(addMonths(month + '-01', -1))); });
  next.addEventListener('click', ev => { ev.preventDefault(); show(monthOf(addMonths(month + '-01', 1))); });
  build();
  return { root, paint, show, month: () => month };
}
