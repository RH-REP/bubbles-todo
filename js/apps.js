/* 3 つの app の住所の根（2026-11-18 取り決め §7.2「各 app の設定 app_urls」）。
   サーバーの GET /api/apps（server.py の --app-url）を正とし、届くまでは住所から決める:
     bubbles.<名前>  → gantt.<名前>・diary.<名前>（https。例 bubbles.app-laboratory.duckdns.org）
     手元の試し（localhost・127.0.0.1）→ gantt http://127.0.0.1:8766・diary http://127.0.0.1:8780
   決められなければ、その app は空（利用者の札のボタンを押せなくする） */
export const APPS = [['bubble', 'bubble', '🫧'], ['gantt', 'gantt', '📊'], ['diary', 'diary', '📔']];
const KEY = 'bubble_todo_app_urls_v1';

function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }

function clean(u) {
  try { const x = new URL(String(u)); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.origin : ''; } catch (e) { return ''; }
}

/* 住所から決める */
export function deriveAppUrls(origin) {
  const out = { bubble: clean(origin), gantt: '', diary: '' };
  let u;
  try { u = new URL(origin); } catch (e) { return out; }
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
    out.gantt = 'http://127.0.0.1:8766';
    out.diary = 'http://127.0.0.1:8780';
  } else if (/^bubbles\./.test(u.hostname)) {
    const rest = u.hostname.replace(/^bubbles\./, '');
    out.gantt = 'https://gantt.' + rest;
    out.diary = 'https://diary.' + rest;
  }
  return out;
}

/* 今わかっている住所の根 {bubble, gantt, diary} */
export function appUrls(origin = (typeof location !== 'undefined' ? location.origin : '')) {
  const base = deriveAppUrls(origin);
  const st = ls();
  try {
    const got = st ? JSON.parse(st.getItem(KEY) || 'null') : null;
    if (got && typeof got === 'object') ['bubble', 'gantt', 'diary'].forEach(k => { const v = clean(got[k]); if (v) base[k] = v; });
  } catch (e) { /* 読めなければ住所から */ }
  return base;
}

/* サーバーの決めた住所を取りに行って控える（無い・届かないなら控えはそのまま） */
export async function loadAppUrls(base = (typeof location !== 'undefined' ? location.origin : '')) {
  try {
    const res = await fetch(String(base).replace(/\/$/, '') + '/api/apps', { cache: 'no-store' });
    if (res.status !== 200) return appUrls();
    const j = await res.json();
    const st = ls();
    if (st && j && typeof j === 'object') st.setItem(KEY, JSON.stringify(j));
  } catch (e) { /* そのまま */ }
  return appUrls();
}

/* '#sea=<海>&todo=<id>' → {sea, todo} か null */
export function parseJump(hash) {
  const m = /^#(.*)$/.exec(String(hash || ''));
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const sea = q.get('sea');
  if (!sea || !/^[0-9a-z._-]{1,40}$/i.test(sea)) return null;
  const todo = q.get('todo');
  return { sea, todo: todo && /^[0-9a-zA-Z_-]{1,64}$/.test(todo) ? todo : null };
}

