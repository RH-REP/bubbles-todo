/* 輝く泡（2026-11-24 ユーザーの決定「OK,推奨で実施」。app_spec の minutes/261124_輝く泡.md、モック mock/glow-1124.html）。

   日の切り替え（store.rollover）のたびに、海の泡のうち **最後に触れた時刻がいちばん古い 1 つ** を選び、
   todo に litAt（輝いた時刻 ms）を書く。その泡は泡の数の上限にかかわらず海に出し（輝きの席）、
   開くと光がほどける（輪・粒・効果音 lit・盤の「思い出してくれて、ありがとう」）。

   - 触れた ＝「最近つかった」と同じ数え方（作った・はじめた・作業記録を積んだ・完了した・今日に置いた・集中の画面を開いた）
     ＋ 輝いたこと（litAt）。輝いた時点で触れたとみなすので、開かなくても次の日はちがう泡に回る（催促にしない）。
   - 記録の印 stamps は使わない（日の切り替え・同期・gantt の書き換えでも新しくなり、本人が触れたかと合わない）。
   - 数・連続・達成は出さない。輝きは完了でなく、開いたことに付く（README「このアプリが引き受けないこと」）。

   この file の上半分は DOM を知らない（tests/glow.test.mjs が確かめる）。下半分の光の演出だけが document を使う。 */

/* 今日の輝きを開いたかの覚え（この端末だけ。{day, id}）。開いたら、その日の輝きはそこで終わる */
export const OPENED_KEY = 'bubble_todo_glow_opened_v1';
export const THANKS = '思い出してくれて、ありがとう';

/* 泡ごとの「使った」時刻（最近つかった F7 と同じ数え方）→ Map(id → ms)。
   logs は { todayLogs:[{id,at}], focusLogs:[{id,at}] }。startedOf は started の形を読む関数 */
export function usedTimes(items, logs = {}, startedOf = t => (t && t.started) || {}) {
  const last = new Map();
  const touch = (id, at) => {
    const v = Number(at);
    if (!id || !Number.isFinite(v)) return;
    if (!last.has(id) || last.get(id) < v) last.set(id, v);
  };
  (logs.todayLogs || []).forEach(e => e && touch(e.id, e.at));
  (logs.focusLogs || []).forEach(e => e && touch(e.id, e.at));
  const out = new Map();
  (items || []).forEach(t => {
    if (!t || !t.id) return;
    let m = Number(t.createdAt) || 0;
    const st = startedOf(t) || {};
    Object.keys(st).forEach(k => { const v = Number(st[k]); if (v > m) m = v; });
    (Array.isArray(t.steps) ? t.steps : []).forEach(e => { const v = Number(e && e.at); if (v > m) m = v; });
    if (Number(t.doneAt) > m) m = Number(t.doneAt);
    const l = last.get(t.id);
    if (l > m) m = l;
    out.set(t.id, m);
  });
  return out;
}

/* 輝いた時刻（無い・形が違えば 0） */
export function litAtOf(t) {
  const v = Number(t && t.litAt);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/* 最後に触れた時刻 ＝ max(使った, 輝いた) */
export function lastTouched(t, used) {
  const u = (used && used.get(t.id)) || 0;
  return Math.max(u, litAtOf(t));
}

/* 候補 cands から 1 つ選ぶ。最後に触れた時刻が古い順、同じなら作った日が古いほう、その次は id。無ければ null */
export function pickGlow(cands, used) {
  let best = null, bt = 0;
  (cands || []).forEach(t => {
    const lt = lastTouched(t, used);
    if (!best) { best = t; bt = lt; return; }
    const c = (lt - bt) || ((Number(t.createdAt) || 0) - (Number(best.createdAt) || 0)) || (t.id < best.id ? -1 : t.id > best.id ? 1 : 0);
    if (c < 0) { best = t; bt = lt; }
  });
  return best;
}

/* その日（[from, to) の ms）に輝いた泡。2 つあれば（ほかの端末が別のを選んで合わさった）litAt の早いほう、同じなら id。無ければ null */
export function litOfDay(items, from, to) {
  let best = null;
  (items || []).forEach(t => {
    const v = litAtOf(t);
    if (!v || v < from || v >= to) return;
    if (!best || v < litAtOf(best) || (v === litAtOf(best) && t.id < best.id)) best = t;
  });
  return best;
}

/* 上限の席を 1 つ譲る（輝きの席）。keep は出すと決めた id の Set、byNew は新しい順の泡、glowId は輝く泡。
   輝く泡が list にあって keep に無ければ、keep のうち byNew でいちばん後ろ（古い）の 1 つと入れ替える。数は変えない */
export function giveSeat(keep, byNew, glowId) {
  if (!glowId || keep.has(glowId) || !byNew.some(t => t.id === glowId)) return keep;
  const out = new Set(keep);
  for (let i = byNew.length - 1; i >= 0; i--) {
    const id = byNew[i].id;
    if (id !== glowId && out.has(id)) { out.delete(id); break; }
  }
  out.add(glowId);
  return out;
}

/* ---- 開いたかの覚え（この端末だけ） ---- */
export function openedOf(ls, day) {
  try {
    const v = JSON.parse((ls && ls.getItem(OPENED_KEY)) || 'null');
    return (v && v.day === day && typeof v.id === 'string') ? v.id : null;
  } catch (e) { return null; }
}
export function markOpened(ls, day, id) {
  try { if (ls) ls.setItem(OPENED_KEY, JSON.stringify({ day, id })); } catch (e) { /* 覚えられなくても光はほどける */ }
}

/* ---------------- 光がほどける（DOM） ----------------
   輪が広がり、粒が 8 つ散る。node は開いた泡。動きを減らす設定では何もしない（音も sound.js が止める）。
   描く場所は document.body の上の固定の層（泡は盤の層へ移るので、泡の中には描かない）。 */
export function unravel(node) {
  try {
    if (!node || typeof document === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = node.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2;
    const layer = document.createElement('div');
    layer.className = 'glow-fx';
    layer.setAttribute('aria-hidden', 'true');
    const ring = document.createElement('span');
    ring.className = 'glow-burst';
    Object.assign(ring.style, { left: (cx - rad) + 'px', top: (cy - rad) + 'px', width: 2 * rad + 'px', height: 2 * rad + 'px' });
    layer.appendChild(ring);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.random() * 0.4;
      const dist = rad + 30 + Math.random() * 26;
      const s = document.createElement('span');
      s.className = 'glow-spark';
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.setProperty('--sx', (Math.cos(a) * dist).toFixed(1) + 'px');
      s.style.setProperty('--sy', (Math.sin(a) * dist - 18).toFixed(1) + 'px');
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1300);
  } catch (e) { /* 光のために画面を壊さない */ }
}
