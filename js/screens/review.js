/* 画面3「ふりかえり」— 記録を眺めるだけの画面。

   このアプリは「開くたびに未完了の山という罰が返る」ことを避けるために作られている。
   だからこの画面には、次のものを絶対に出さない：

     ・達成率・パーセント・「30日中18日」のような分母つきの数字
     ・数を長さに変えて、複数の行に同じ目盛りを共有させること。
       これは数字を書かないだけの達成率で、禁止の対象は同じ。
       以前ここには最大値で正規化した帯（makeTrack）があったが、
       flex に n : (max - n) を渡すのは割り算をブラウザにやらせているのと同じで、
       「書いた16 / はじめた2」は 2/16 の漏斗として描かれていた。帯は廃止した
     ・「連続が途切れた」という言い方
     ・やらなかった日を名指しする色（赤など）。0件の日は無彩色のまま
     ・「達成」「未達」という語

   出すのは件数だけ。数は数字でだけ出し、大きさ・長さには載せない。
   （「完了」は追補3 §4 で内訳に加わった。ユーザーが自分で押したものを数えるだけで、
     ほかの行との比較には使わない） */

import { store } from '../store.js';
import { el, escapeHtml } from '../ui.js';

const DAYS = 7;    /* 帯に出す日数 */
const SPAN = 30;   /* 内訳を数える日数 */

/* きっかけ（アンカー）の色。3色は base.css の :root にあるものをそのまま使う。
   割り当ては並び順ではなく store.anchors() の hue（0|1|2|null）で決める。
   並べ替えても色が付け替わらないようにするため。
   hue を持たないもの（4つ目以降）と「アンカー無し」は無彩色。色は巡回させない。 */
const HUE_CSS = ['var(--slot-morning)', 'var(--slot-noon)', 'var(--slot-night)'];

function hueCss(hue) {
  return (hue === 0 || hue === 1 || hue === 2) ? HUE_CSS[hue] : null;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

let pane = null, body = null;
let unsubscribe = null;

/* ---------------- 小物 ---------------- */

/* 'YYYY-MM-DD' を数値に割ってから Date を作る。
   文字列のまま渡すと UTC 扱いになって、日付が1日ずれることがある */
function parseDay(day) {
  const p = String(day || '').split('-').map(Number);
  if (p.length !== 3 || p.some(n => !n && n !== 0) || Number.isNaN(p[0])) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}

function weekdayOf(day) {
  const d = parseDay(day);
  return d ? WD[d.getDay()] : '';
}

function labelOf(day) {
  const d = parseDay(day);
  return d ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : String(day || '');
}

/* 濃淡は段階で決める。割合ではないので、分母は出てこない */
function heatLevel(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n <= 4) return 3;
  return 4;
}

/* 件数の読み取り。store 側がまだその API を持っていない／落ちる場合は null を返す。
   画面はその行を出さないだけで、壊れない。 */
function countOf(name, days) {
  const fn = store ? store[name] : null;
  if (typeof fn !== 'function') return null;
  try {
    /* store 側が this を使っていても壊れないように call で呼ぶ */
    const n = fn.call(store, days);
    return (typeof n === 'number' && Number.isFinite(n)) ? Math.max(0, n) : null;
  } catch (_) {
    return null;
  }
}

function makeBlock(title) {
  const sec = el('section', 'rv-block');
  sec.appendChild(el('h2', null, escapeHtml(title)));
  return sec;
}

/* ---------------- 1. 主役の数 ---------------- */

function makeHero(total) {
  const box = el('section', 'rv-hero');
  box.appendChild(el('div', 'n', String(total)));
  box.appendChild(el('div', 'lb', 'はじめた'));
  box.appendChild(el('p', 'sub', total > 0
    ? 'これまでに、はじめたと記録したぶん。'
    : 'はじめたの記録は、まだここに無い。'));
  return box;
}

/* ---------------- 2. 直近7日の帯 ---------------- */

function makeDays() {
  const sec = makeBlock('この' + DAYS + '日');
  const row = el('div', 'rv-days');
  row.setAttribute('role', 'list');

  const days = store.startedByDay(DAYS);
  days.forEach((d, i) => {
    const n = d.n;
    const cell = el('div', 'rv-day');
    cell.setAttribute('role', 'listitem');
    cell.dataset.lv = String(heatLevel(n));
    if (i === days.length - 1) cell.classList.add('is-today');
    cell.setAttribute('aria-label', labelOf(d.day) + ' はじめた ' + n + '件');
    cell.title = labelOf(d.day) + '　' + n + '件';

    cell.appendChild(el('span', 'wd', escapeHtml(weekdayOf(d.day))));
    cell.appendChild(el('span', 'sq'));
    /* 0件の日は数字も置かない。空白のまま、無色のまま */
    cell.appendChild(el('span', 'n', n > 0 ? String(n) : ''));
    row.appendChild(cell);
  });

  sec.appendChild(row);
  sec.appendChild(el('p', 'rv-note', '濃いほど、その日にはじめたものが多い。'));
  return sec;
}

/* ---------------- 3. きっかけごと ---------------- */

function makeAnchors() {
  const sec = makeBlock('きっかけ別　この' + SPAN + '日');
  const anchors = store.anchors() || [];

  /* きっかけをまだ1つも決めていないとき。並べるものが無いだけなので、
     そう書くだけにする（数を出さない・急かさない） */
  if (anchors.length === 0) {
    sec.appendChild(el('p', 'rv-note is-only',
      'きっかけは、まだ決めていない。「いつやる」で決めると、ここに並ぶ。'));
    return sec;
  }

  /* id → hue。色は hue でしか決めない（並び順では決めない） */
  const hueOf = new Map();
  anchors.forEach(a => { if (a && a.id != null) hueOf.set(a.id, a.hue); });

  /* 帯は置かない。内訳と同じ理由で、行どうしが同じ目盛りを共有してしまうため。

     0件のきっかけも行ごと置かない。名前の横に空の帯や「0件」を並べるのは
     「そこは手がつかなかった」の名指しに近い。直近7日の帯で 0件の日を
     無色・無記入のままにしているのと同じ扱いにする。
     並びは store が返した順のまま。件数で並べ替えない（順位にしないため）。 */
  const rows = (store.startedByAnchor(SPAN) || [])
    .filter(r => r && Math.max(0, Number(r.n) || 0) > 0);

  if (rows.length === 0) {
    sec.appendChild(el('p', 'rv-note is-only', 'このきっかけからの記録は、まだここに無い。'));
    return sec;
  }

  const list = el('div', 'rv-anchors');
  rows.forEach(r => {
    const n = Math.max(0, Number(r.n) || 0);
    /* id が null の行（アンカー無し）は無彩色。hue を引かない */
    const color = r.id == null ? null : hueCss(hueOf.get(r.id));

    const item = el('div', 'rv-anchor');
    if (color) item.style.setProperty('--c', color);
    else item.classList.add('is-plain');   /* --c を無彩色に差し替える */

    item.appendChild(el('span', 'dot'));
    const nm = el('span', 'nm');
    /* アンカー名はユーザーの入力。innerHTML には入れない */
    nm.textContent = String(r.name == null ? '' : r.name);
    item.appendChild(nm);
    item.appendChild(el('span', 'n', n + '件'));

    list.appendChild(item);
  });

  sec.appendChild(list);
  sec.appendChild(el('p', 'rv-note', '記録のあるきっかけだけ並べている。'));
  return sec;
}

/* ---------------- 4. 直近30日の内訳 ---------------- */

function makeCounts() {
  const sec = makeBlock('内訳　この' + SPAN + '日');

  /* どれも同じ期間で数える。todays() は現在値なので使わない
     （todayedCount は「入れた」という出来事を数える）。

     帯は置かない。数を長さに変えると、4つの行が同じ目盛りを共有することになり、
     「書いた16 → 完了1」がそのまま漏斗＝達成率の絵になる。
     代わりに、大きさの等しい4つの枠に数字だけを置く。
     枠の大きさは件数に依らないので、見比べても比率が現れる形がどこにも無い。 */
  const rows = [
    { label: '書いた',           n: countOf('writtenCount', SPAN) },
    { label: '今日するに入れた', n: countOf('todayedCount', SPAN) },
    { label: 'はじめた',         n: countOf('startedCount', SPAN) },
    /* 完了は追補3 §4。store.doneCount がまだ無い間は、この枠を出さない */
    { label: '完了',             n: countOf('doneCount', SPAN) },
  ].filter(r => r.n != null);

  const list = el('div', 'rv-counts');
  rows.forEach(r => {
    const item = el('div', 'rv-count');
    const q = el('div', 'q');
    q.appendChild(el('span', 'n', String(r.n)));
    q.appendChild(el('span', 'u', '件'));
    item.appendChild(q);
    item.appendChild(el('div', 'lb', escapeHtml(r.label)));
    list.appendChild(item);
  });

  sec.appendChild(list);
  sec.appendChild(el('p', 'rv-note', 'それぞれ別に数えたもの。'));

  /* 完了の海への道。数だけ見て終わらせず、中身を見に行けるようにする。
     完了の海は「タグの向き」に割り当てられていないと開けないので、
     割り当てが無いときはボタンを出さず、どうすれば開くかだけを短く言う。
     （勝手に向きを割り当てると、ユーザーが置いた別のタグを押し出してしまう） */
  const doneDir = (typeof store.tag === 'function' && store.tag('done'))
    ? store.tag('done').dir : null;
  if (doneDir) {
    const go = el('button', 'btn rv-go', '完了の海を見る');
    go.type = 'button';
    go.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('bubbles:goto', {
        detail: { screen: 'sea', face: 'done' },
      }));
    });
    sec.appendChild(go);
  } else if (typeof store.doneItems === 'function' && store.doneItems().length) {
    sec.appendChild(el('p', 'rv-note',
      '完了の海は、設定で「完了」を上・左・右のどれかに置くと開く。'));
  }
  return sec;
}

/* ---------------- 5. 空のとき ---------------- */

function makeEmpty() {
  const box = el('section', 'rv-empty');
  box.appendChild(el('div', 'mk', '◔'));
  box.appendChild(el('p', 'lead', 'まだ数えるものが無い。'));
  box.appendChild(el('p', null,
    '気づいたことを書いて、今日するに入れて、はじめたら、ここに数が増えていく。'));
  return box;
}

/* ---------------- 描画 ---------------- */

function render() {
  if (!body) return;
  const total = store.totalStarted();
  const nothing = total === 0 && store.count() === 0;

  body.replaceChildren();
  if (nothing) { body.appendChild(makeEmpty()); return; }

  body.appendChild(makeHero(total));
  body.appendChild(makeDays());
  body.appendChild(makeAnchors());
  body.appendChild(makeCounts());
}

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'review',
  label: 'ふりかえり',
  icon: '◔',

  mount(node) {
    pane = node;
    body = el('div', 'review');
    pane.appendChild(body);
    unsubscribe = store.on(render);
    render();
  },

  onShow() {
    store.rollover();   /* 日が変わっていれば、今日するを空にしてから数え直す */
    render();
  },

  onHide() {
    /* 動くものが無いので、止めるものも無い */
  },
};
