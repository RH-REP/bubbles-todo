/* 海の切り替え（2026-10-23「個人と共有」。2026-11-02 Issue #4 で、名前を付けて複数作れる海にした）。

   2026-10-24 に置き場を考え直した（利用者の指示：B を切り替えの入口にし、D のように表示）。
     ・切り替え … 引き出し（左上の ≡）のいちばん上に、海の名前を並べる（spaceSwitcher()。app.js が置く）。
                  押すと持ち主を書き換えて画面を読み直す
                  （app 全体＝海・今日・きっかけ・すきま・ふりかえりが、その海の記録になる）
     ・表示     … いちばん上の薄い帯（30px）に海の名前を並べ、今の海を白く浮かせる。押しても替わる
                  （2026-10-25 Issue #3）。海が多いときは横に流す
   2026-11-02（Issue #4。利用者の指示：1A・2 引き継ぐ・3 色を選ぶ）:
     ・海は引き出しの「＋ 海をつくる」で、名前と水の色を決めて作る。初めはこの端末だけの海で、
       繋いでいれば自分のサーバーとも合わせる（sync.js）。人を招く海は、サーバーで招待コードを作る
     ・「個人」は名前を変えられず、消せない。前の版の「共有」は記録をそのまま引き継ぎ、
       名前と色を変えられる海の1つになった（既定の色はマグマの赤）
     ・今の海の名前・色・消すは、引き出しの「この海の名前・色」から
     ・個人は空色のまま。ほかの海は選んだ色の水になる（css/space.css。html.is-sea[data-sea=…]）

   個人でない海のときだけ出るもの:
     ・状態の字   薄い帯の右に2行。「合わせた／15:30」・「繋がっていない／15:30 に見たもの」
                  件数・人数は出さない（数を出さない決まりと同じ）
     ・読むだけ   招かれて入った海で、合わせられていない間は、入力欄を点線にして「繋がると書ける」。
                  書き込み口は store が断り、ここが知らせを出す */

import { store, SPACE_KEY } from './store.js';
import { sync } from './sync.js';
import { toast } from './ui.js';
import { seaList, findSea, addSea, updateSea, removeSea, boxKey, COLORS, colorMark, NAME_MAX } from './spacelist.js';

const SPACE = store.space();
const root = document.documentElement;
root.classList.add('has-strip');
root.classList.toggle('is-sea', SPACE !== 'me');
function paintColor() {
  const e = findSea(SPACE);
  if (e) root.dataset.sea = e.color; else delete root.dataset.sea;
}
paintColor();

function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* 並べる海。個人がいちばん前 */
function entries() {
  return [{ id: 'me', name: '個人', color: null }].concat(seaList());
}

/* 海を替える。今の書きかけ（位置など）を残してから読み直す */
function switchTo(id) {
  if (id === SPACE) return;
  try { store.flush(); } catch (e) { /* 替えるのは止めない */ }
  try { localStorage.setItem(SPACE_KEY, id); } catch (e) { toast('切り替えを覚えられなかった'); return; }
  location.reload();
}

function seaButton(e) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.space = e.id;
  b.className = (e.color ? 'is-sea-btn ' : '') + (e.id === SPACE ? 'is-on' : '');
  if (e.color) b.style.setProperty('--dot', colorMark(e.color));
  b.textContent = e.name;
  b.title = e.name;
  b.setAttribute('aria-pressed', e.id === SPACE ? 'true' : 'false');
  b.addEventListener('click', () => switchTo(e.id));
  return b;
}

/* ---- 薄い帯（今の海を浮かせる。押すと切り替わる。多いときは横に流す） ---- */
const strip = document.createElement('div');
strip.className = 'space-strip';
const seg = document.createElement('div');
seg.className = 'space-seg';
seg.setAttribute('role', 'group');
seg.setAttribute('aria-label', '海の切り替え');
function renderSeg() {
  seg.textContent = '';
  entries().forEach(e => seg.appendChild(seaButton(e)));
  const on = seg.querySelector('.is-on');
  if (on && typeof on.scrollIntoView === 'function') {
    requestAnimationFrame(() => { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* 古いブラウザ */ } });
  }
}
renderSeg();
strip.appendChild(seg);
/* 版（2026-10-25 利用者の指示）。帯の左端に小さく。update のあと新しい版に入れ替わったかを見るため。
   正本は sw.js の VERSION（js/version.js が写しを持つ） */
if (window.BUBBLES_VERSION) {
  const ver = document.createElement('span');
  ver.className = 'space-ver';
  ver.textContent = 'v' + window.BUBBLES_VERSION;
  strip.appendChild(ver);
}

/* ---- 引き出しの頭の切り替え（app.js の openDrawer が、引き出しを開くたびに置く） ---- */
export function spaceSwitcher() {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-space-wrap';
  const box = document.createElement('div');
  box.className = 'drawer-space';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '海の切り替え');
  entries().forEach(e => box.appendChild(seaButton(e)));
  wrap.appendChild(box);
  const tools = document.createElement('div');
  tools.className = 'drawer-space-tools';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '＋ 海をつくる';
  add.addEventListener('click', () => openSheet(null));
  tools.appendChild(add);
  const cur = findSea(SPACE);
  if (cur) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'この海の名前・色';
    edit.addEventListener('click', () => openSheet(findSea(SPACE)));
    tools.appendChild(edit);
  }
  wrap.appendChild(tools);
  return wrap;
}

/* ---- 海を作る・直す板 ----
   sea = null なら作る。名前（空にはできない）と水の色を選ぶ。直すときは、人を招くやり方と「この海を消す」も出す */
function openSheet(sea) {
  /* 引き出しは閉じる（引き出しの焦点の囲い込み・Escape と取り合わないように） */
  const closeBtn = document.querySelector('.drawer-close');
  if (closeBtn) closeBtn.click();
  const back = document.createElement('div');
  back.className = 'space-sheet-back';
  const box = document.createElement('form');
  box.className = 'space-sheet';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', sea ? 'この海の名前と色' : '海をつくる');
  box.dataset.screen = 'space-sheet'; box.dataset.screenLayer = '5';
  const h = document.createElement('h4');
  h.textContent = sea ? 'この海' : '海をつくる';
  box.appendChild(h);

  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.maxLength = NAME_MAX;
  nameIn.autocomplete = 'off';
  nameIn.placeholder = '海の名前（例 家族・仕事）';
  nameIn.setAttribute('aria-label', '海の名前');
  nameIn.value = sea ? sea.name : '';
  box.appendChild(nameIn);

  const colorBox = document.createElement('div');
  colorBox.className = 'space-colors';
  colorBox.setAttribute('role', 'radiogroup');
  colorBox.setAttribute('aria-label', '水の色');
  let color = sea ? sea.color : COLORS[0][0];
  const chips = COLORS.map(([id, label, mark]) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.setAttribute('role', 'radio');
    c.style.setProperty('--dot', mark);
    c.textContent = label;
    c.addEventListener('click', () => { color = id; paintChips(); });
    colorBox.appendChild(c);
    return [id, c];
  });
  function paintChips() {
    chips.forEach(([id, c]) => {
      c.classList.toggle('is-on', id === color);
      c.setAttribute('aria-checked', id === color ? 'true' : 'false');
    });
  }
  paintChips();
  box.appendChild(colorBox);

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = sea
    ? '人を招くときは、サーバーで「invite-add <名前> --space ' + sea.id + '」として招待コードを作り、'
      + '住所とコードを渡す（公開したサーバーのとき）。招いた人はその海にだけ入れる。'
      + (sea.id === 'share' ? '前の版の「共有の合言葉」でも、この海に入れる。' : '')
    : '初めはこの端末だけの海。サーバーに繋いでいれば、ほかの端末とも同じ海になる。'
      + '人を招くのは、作ったあとに「この海の名前・色」から。';
  box.appendChild(note);

  const row = document.createElement('div');
  row.className = 'space-sheet-row';
  const done = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); done(); } };
  if (sea) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'space-del';
    del.textContent = 'この海を消す';
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        del.textContent = 'もう一度押すと消す';
        return;
      }
      removeSea(sea.id);
      try {
        localStorage.removeItem(boxKey(sea.id));
        localStorage.removeItem('bubble_todo_sync_seen_' + sea.id);
        localStorage.setItem(SPACE_KEY, 'me');
      } catch (e) { /* 消せなくても一覧からは外れている */ }
      sync.syncSeas().finally(() => location.reload());
    });
    row.appendChild(del);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'やめる';
  cancel.addEventListener('click', done);
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'btn is-primary';
  ok.textContent = sea ? '直す' : 'つくる';
  row.appendChild(cancel);
  row.appendChild(ok);
  box.appendChild(row);

  box.addEventListener('submit', ev => {
    ev.preventDefault();
    if (!nameIn.value.trim()) { toast('海の名前を入れる'); nameIn.focus(); return; }
    if (sea) {
      if (!updateSea(sea.id, { name: nameIn.value, color })) { toast('直せなかった'); return; }
      done();
      paintColor();
      renderSeg();
      window.dispatchEvent(new CustomEvent('bubbles:seas'));
      sync.syncSeas();
      toast('海を直した');
      return;
    }
    const e = addSea(nameIn.value, color);
    if (!e) { toast('海をつくれなかった'); return; }
    done();
    switchTo(e.id);
  });
  back.addEventListener('click', ev => { if (ev.target === back) done(); });
  document.addEventListener('keydown', onKey, true);
  back.appendChild(box);
  document.body.appendChild(back);
  nameIn.focus();
}

/* ---- 海の状態の字 ---- */
const stateEl = document.createElement('div');
stateEl.className = 'space-state';
stateEl.setAttribute('aria-live', 'polite');
const stateA = document.createElement('span');
const stateB = document.createElement('span');
stateEl.appendChild(stateA);
stateEl.appendChild(stateB);
function stateText(a, b) { stateA.textContent = a; stateB.textContent = b || ''; }

const app = document.querySelector('.app') || document.body;
app.appendChild(strip);
if (SPACE !== 'me') app.appendChild(stateEl);

/* サーバーから海の一覧が届いて変わったとき（名前・色・ほかの端末で消した海） */
sync.onSeas(() => {
  if (SPACE !== 'me' && !findSea(SPACE)) {
    try { localStorage.setItem(SPACE_KEY, 'me'); } catch (e) { /* 次に開いたときに個人へ戻る */ }
    toast('この海はほかの端末で消された。個人に戻る');
    setTimeout(() => location.reload(), 1500);
    return;
  }
  paintColor();
  renderSeg();
});

/* ---- 入力欄（思いついたことを書く）を、読むだけのときに閉じる ---- */
const LOCKED = new WeakMap();   /* input → 元の placeholder */
function lockInputs() {
  const ro = store.readOnly();
  document.querySelectorAll('input[aria-label="思いついたことを書く"], input[placeholder="思いついたことを書く"], input.is-space-locked')
    .forEach(inp => {
      if (ro) {
        if (!LOCKED.has(inp)) LOCKED.set(inp, inp.placeholder);
        inp.placeholder = '繋がると書ける';
        inp.disabled = true;
        inp.classList.add('is-space-locked');
      } else if (LOCKED.has(inp)) {
        inp.placeholder = LOCKED.get(inp);
        inp.disabled = false;
        inp.classList.remove('is-space-locked');
        LOCKED.delete(inp);
      }
    });
}

function settingsOpen() {
  const p = document.getElementById('pane-settings');
  return !!(p && p.classList.contains('is-active'));
}

function paint() {
  /* 色を抜くのは、招かれた海で読むだけの間だけ（書ける海は、届かなくてもふだんの色） */
  root.classList.toggle('is-off', store.readOnly());
  lockInputs();
  if (SPACE === 'me') return;
  const st = sync.status();
  const seen = sync.seenAt();
  stateEl.hidden = !sync.ready() || settingsOpen();
  stateEl.classList.toggle('is-off', st.state === 'error');
  if (st.state === 'ok') stateText('合わせた', hhmm(st.at));
  else if (st.state === 'error') stateText('繋がっていない', seen ? hhmm(seen) + ' に見たもの' : 'まだ見ていない');
  else stateText('合わせている…');
}

sync.on(paint);
store.on(paint);
/* 画面は後から組み立てられる（入力欄も、設定の開け閉めも）。そのたびに合わせる */
const panes = document.getElementById('panes');
if (panes && typeof MutationObserver === 'function') {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  }).observe(panes, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
paint();

/* 読むだけのときに書こうとしたら、短く知らせる（続けて押しても何度も出さない） */
let lastBlocked = 0;
store.onBlocked(() => {
  const now = Date.now();
  if (now - lastBlocked < 2500) return;
  lastBlocked = now;
  toast('繋がると書ける（いまは最後に見たものを出している）');
});
