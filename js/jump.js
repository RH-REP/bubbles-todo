/* jump（2026-11-18 ユーザーの決定。取り決め 実装の取り決め.md §7.2・§7.3）。
   受ける: <bubble>/#sea=<海>&todo=<id>
     ・その海に切り替え（読み直す）、その泡の盤を開く。#sea= だけなら海だけ
     ・<海> はサーバーの海の ID（/api/me の seas[].id）。'me' はサーバーの個人の海（この端末ではサーバーの繋ぎ先の個人）
     ・入れない海なら「入れない海です」と出す。見るだけの海へも飛べる
   出す: 泡の盤の「📊 gantt でこの期間を見る」（期間のある泡）・「📔 diary で終えた日を見る」（終えた泡）。jumpLinks
   #avatar・#devices は js/userchip.js が受ける */
import { store, SPACE_KEY } from './store.js';
import { allSeas } from './regions.js';
import { serverLogin, meInfo, fetchMe } from './me.js';
import { toast } from './ui.js';
import { appUrls, parseJump } from './apps.js';
export { parseJump };

const PENDING = 'bubble_todo_jump_todo';   /* 読み直したあとに開く泡（sessionStorage） */

/* サーバーの海の ID → この端末の海の ID（'me' はサーバーの繋ぎ先の個人）。入れなければ null */
export function localSeaOf(sea) {
  const L = serverLogin();
  const seas = allSeas();
  if (sea === 'me') {
    const p = L ? seas.find(s => s.personal && s.rid === L.rid) : null;
    return p ? p.id : null;
  }
  const s = seas.find(x => x.id === sea);
  if (!s) return null;
  if (L && s.rid === L.rid) {
    const me = meInfo();
    if (me && !me.seas.some(x => x && x.id === sea)) return null;   /* サーバーの海で、仲間でない */
  }
  return s.id;
}

function dropHash() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 残っても害は無い */ }
}

/* 泡の盤を開く（泡が今の面に出るまで少し待つ） */
function openTodo(id, tries = 30) {
  const node = document.querySelector('.bub[data-id="' + CSS.escape(id) + '"]');
  if (node) {
    import('./bubble.js').then(b => { if (!b.centerBubble(node)) toast('泡を開けなかった'); });
    return;
  }
  if (tries > 0) { setTimeout(() => openTodo(id, tries - 1), 100); return; }
  const t = store.get(id);
  toast(t ? '「' + t.text + '」は今の面に出ていない（完了・長期保留・今日などにある）' : 'その泡はこの海に無い（消した・移したかもしれない）');
}

async function handle() {
  const j = parseJump(location.hash);
  if (!j) return;
  dropHash();
  if (serverLogin() && !meInfo()) await fetchMe();
  const local = localSeaOf(j.sea);
  if (!local) { toast('入れない海です'); return; }
  if (local !== store.space()) {
    try {
      localStorage.setItem(SPACE_KEY, local);
      if (j.todo) sessionStorage.setItem(PENDING, j.todo);
    } catch (e) { toast('海を切り替えられなかった'); return; }
    location.reload();
    return;
  }
  if (j.todo) openTodo(j.todo);
}

/* 置く（app.js）。読み直しの前に預けた泡も開く */
export function mountJump() {
  let pending = null;
  try { pending = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch (e) { /* 無くてよい */ }
  if (pending) setTimeout(() => openTodo(pending), 300);
  handle();
  window.addEventListener('hashchange', handle);
}

/* 'YYYY-MM-DD'（その端末の日付） */
function ymd(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* 泡の盤に出す飛び先のリンク（§7.3）→ [{label, href, name}] */
export function jumpLinks(id) {
  const t = store.get(id);
  if (!t) return [];
  const urls = appUrls();
  const out = [];
  const start = t.start || t.due || null;
  if (start && urls.gantt) {
    out.push({ label: '📊 gantt でこの期間を見る', name: 'gantt でこの期間を見る',
      href: urls.gantt + '/?date=' + encodeURIComponent(start) + '&todo=' + encodeURIComponent(t.id) });
  }
  if (t.done && t.doneAt && urls.diary) {
    out.push({ label: '📔 diary で終えた日を見る', name: 'diary で終えた日を見る', href: urls.diary + '/#' + ymd(t.doneAt) });
  }
  return out;
}
