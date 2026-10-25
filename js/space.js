/* 個人と共有の切り替え（2026-10-23。利用者の指示）。

   2026-10-24 に置き場を考え直した（利用者の指示：B を切り替えの入口にし、D のように表示）。
     ・切り替え … 引き出し（左上の ≡）のいちばん上の「個人／共有」（spaceSwitcher()。app.js が置く）。
                  押すと持ち主を書き換えて画面を読み直す
                  （app 全体＝海・今日・きっかけ・すきま・ふりかえりが、その持ち主の記録になる）
     ・表示     … いちばん上の薄い帯（30px）に「個人 共有」を並べ、今の側を白く浮かせる。**押せない**
                  （表示だけ。前は 54px の帯が切り替えのボタンで、Android の小さい画面で海を削っていた）
   共有のときは水が夕方の色になる（css/space.css。html.is-share）。

   共有のときだけ出るもの:
     ・状態の字   薄い帯の右に2行。「合わせた／15:30」・「繋がっていない／15:30 に見たもの」
                  件数・人数は出さない（数を出さない決まりと同じ）
     ・入る札     共有の合言葉がまだ無いとき、海の上に「共有の海に入る」→ 設定へ
     ・読むだけ   合わせられていない間は、入力欄を点線にして「繋がると書ける」。
                  書き込み口は store が断り、ここが知らせを出す
   個人のときは薄い帯が足されるだけで、ほかは今までどおり。 */

import { store, SPACE_KEY } from './store.js';
import { sync } from './sync.js';
import { toast } from './ui.js';

const SPACE = store.space();
const root = document.documentElement;
root.classList.add('has-strip');
root.classList.toggle('is-share', SPACE === 'share');

function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

const LABELS = [['me', '個人'], ['share', '共有']];

/* 持ち主を替える。個人の書きかけ（位置など）を残してから読み直す。共有で読むだけなら store が断る */
function switchTo(id) {
  if (id === SPACE) return;
  try { store.flush(); } catch (e) { /* 替えるのは止めない */ }
  try { localStorage.setItem(SPACE_KEY, id); } catch (e) { toast('切り替えを覚えられなかった'); return; }
  location.reload();
}

/* ---- 薄い帯（表示だけ。押せない） ---- */
const strip = document.createElement('div');
strip.className = 'space-strip';
strip.setAttribute('role', 'status');
strip.setAttribute('aria-label', '今の持ち主: ' + (SPACE === 'share' ? '共有' : '個人') + '（切り替えは左上の ≡ から）');
const seg = document.createElement('div');
seg.className = 'space-seg';
seg.setAttribute('aria-hidden', 'true');
LABELS.forEach(([id, label]) => {
  const span = document.createElement('span');
  span.className = (id === 'share' ? 'is-share-btn ' : '') + (id === SPACE ? 'is-on' : '');
  span.textContent = label;
  seg.appendChild(span);
});
strip.appendChild(seg);

/* ---- 引き出しの頭の切り替え（app.js の openDrawer が、引き出しを開くたびに置く） ---- */
export function spaceSwitcher() {
  const box = document.createElement('div');
  box.className = 'drawer-space';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '持ち主の切り替え');
  LABELS.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.space = id;
    b.className = (id === 'share' ? 'is-share-btn ' : '') + (id === SPACE ? 'is-on' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', id === SPACE ? 'true' : 'false');
    b.addEventListener('click', () => switchTo(id));
    box.appendChild(b);
  });
  return box;
}

/* ---- 共有の状態の字 ---- */
const stateEl = document.createElement('div');
stateEl.className = 'space-state';
stateEl.setAttribute('aria-live', 'polite');
const stateA = document.createElement('span');
const stateB = document.createElement('span');
stateEl.appendChild(stateA);
stateEl.appendChild(stateB);
function stateText(a, b) { stateA.textContent = a; stateB.textContent = b || ''; }

/* ---- 共有に入る札 ---- */
const join = document.createElement('div');
join.className = 'space-join';
join.innerHTML = '<h4>共有の海に入る</h4>'
  + '<p>招かれた人どうしで使う海。設定の「サーバー」で、共有に入れるパスキーを登録する（手元のサーバーなら共有の合言葉を入れる）と、ここに出る。</p>';
const joinBtn = document.createElement('button');
joinBtn.type = 'button';
joinBtn.className = 'btn';
joinBtn.textContent = '設定を開く';
joinBtn.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'settings' } }));
});
join.appendChild(joinBtn);

const app = document.querySelector('.app') || document.body;
app.appendChild(strip);
if (SPACE === 'share') { app.appendChild(stateEl); app.appendChild(join); }

/* ---- 入力欄（思いついたことを書く）を、読むだけのときに閉じる ---- */
const LOCKED = new WeakMap();   /* input → 元の placeholder */
/* 入力欄に収まる長さにする（375px 幅で「共有の合言葉を入れると書ける」は末尾が切れた） */
function lockText() { return sync.ready() ? '繋がると書ける' : '共有に入ると書ける'; }
function lockInputs() {
  const ro = SPACE === 'share' && store.readOnly();
  document.querySelectorAll('input[aria-label="思いついたことを書く"], input[placeholder="思いついたことを書く"], input.is-space-locked')
    .forEach(inp => {
      if (ro) {
        if (!LOCKED.has(inp)) LOCKED.set(inp, inp.placeholder);
        inp.placeholder = lockText();
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
  if (SPACE !== 'share') return;
  const st = sync.status();
  const ready = sync.ready();
  const seen = sync.seenAt();
  /* 色を抜くのは「届かなかった」ときだけ（合わせている最中に色がちらつかないように） */
  root.classList.toggle('is-off', ready && st.state === 'error');
  join.hidden = ready || settingsOpen();
  stateEl.hidden = !ready || settingsOpen();
  stateEl.classList.toggle('is-off', st.state === 'error');
  if (st.state === 'ok') stateText('合わせた', hhmm(st.at));
  else if (st.state === 'error') stateText('繋がっていない', seen ? hhmm(seen) + ' に見たもの' : 'まだ見ていない');
  else stateText('合わせている…');
  lockInputs();
}

sync.on(paint);
store.on(() => { paint(); lockInputs(); });
/* 画面は後から組み立てられる（入力欄も、設定の開け閉めも）。そのたびに合わせる */
const panes = document.getElementById('panes');
if (panes && typeof MutationObserver === 'function') {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); lockInputs(); });
  }).observe(panes, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
paint();

/* 読むだけのときに書こうとしたら、短く知らせる（続けて押しても何度も出さない） */
let lastBlocked = 0;
store.onBlocked(() => {
  const now = Date.now();
  if (now - lastBlocked < 2500) return;
  lastBlocked = now;
  toast(sync.ready() ? '繋がると書ける（いまは最後に見たものを出している）' : '共有に入ると書ける（設定の「サーバー」から）');
});
