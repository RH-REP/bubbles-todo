/* 先の予定（AI）の板（2026-11-04。利用者の指示 Issue #13）。

   設定の「先の予定（AI）」から開く。上から順に:
     1. 見るもの（投資・せどり・休日のトピック）と、銘柄・商品の欄
     2. 「調べる」……押したときだけ AI（Anthropic の Web 検索）に訊く。起動時・定期には訊かない
     3. 見つかった予定の一覧……日付・題名・確定/予定/噂・何日前に今日へ・出典
     4. 「選んだ N 件を入れる」……長期保留のバブルにする（その日になると今日へ出る。js/events.js addEvents）

   決めごと:
   - 予測はしない。日付と出来事だけ（js/events.js の頭）
   - 送るのは選んだトピックと、書いた銘柄・商品だけ。バブルの本文は送らない（#9 と同じ）
   - 端末にだけ置くもの（localStorage 'bubble_todo_upcoming'）: 選んだトピック・銘柄・最後に調べた日と結果。
     同期・CSV には乗らない（記録ではなく、この端末の設定）。結果を残すのは、開き直すたびに料金を掛けないため */

import { el, toast, fromFeedback } from './ui.js';
import { store } from './store.js';
import { askWithSearch, hasKey, SEARCH_MAX_USES } from './ai.js';
import {
  TOPICS, DEFAULT_TOPICS, TOPICS_VER, TOPICS_ADDED, STATUS, buildPrompt, extractJsonArray, normalizeEvents,
  defaultLead, leadOptions, triggerDay, isRunning, md, addedKeys, addEvents,
} from './events.js';

const PREF_KEY = 'bubble_todo_upcoming';
const STALE_DAYS = 30;
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function loadPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { p = null; }
  p = (p && typeof p === 'object') ? p : {};
  let topics = Array.isArray(p.topics) ? p.topics.filter(id => TOPICS.some(t => t.id === id)) : DEFAULT_TOPICS.slice();
  /* 前の版で保存した端末には、あとから足したトピック（お得など）を既定で付ける。
     付けるのは版を上げたときの1回だけ（自分で外したものは、次からは外れたまま） */
  const ver = Number(p.ver) || 1;
  if (Array.isArray(p.topics) && ver < TOPICS_VER) {
    for (let v = ver + 1; v <= TOPICS_VER; v++) {
      (TOPICS_ADDED[v] || []).forEach(id => { if (!topics.includes(id)) topics.push(id); });
    }
  }
  return {
    topics,
    words: typeof p.words === 'string' ? p.words : '',
    lastDay: typeof p.lastDay === 'string' ? p.lastDay : '',
    events: Array.isArray(p.events) ? p.events : [],
  };
}

function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* 入らなくても続ける */ }
}

function wd(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? WD[new Date(+m[1], +m[2] - 1, +m[3], 12).getDay()] : '';
}

function daysBetween(a, b) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : NaN; };
  return Math.round((p(b) - p(a)) / 86400000);
}

/* 設定の節に出す1行（最後に調べた日）。調べていなければ空 */
export function lastLine(today) {
  const p = loadPrefs();
  if (!p.lastDay) return 'まだ調べていない。';
  const n = daysBetween(p.lastDay, today);
  return '前に調べた日: ' + md(p.lastDay) + (n >= STALE_DAYS ? '（' + n + '日たった。調べ直すと新しい予定が見つかるかもしれない）' : '');
}

let root = null;

export function closeUpcoming(restoreFocus) {
  if (!root) return false;
  const r = root;
  root = null;
  window.removeEventListener('keydown', r.onKey, true);
  r.back.remove();
  if (restoreFocus && r.was && r.was.isConnected) {
    try { r.was.focus({ preventScroll: true }); } catch (e) { /* 戻せなくてもよい */ }
  }
  if (typeof r.onClose === 'function') r.onClose();
  return true;
}

export function isUpcomingOpen() { return !!root; }

/* opts = { was, onClose } */
export function openUpcoming(opts) {
  const o = opts || {};
  if (root) closeUpcoming(false);
  const prefs = loadPrefs();
  const today = store.todayKey();

  const back = el('div', 'help-back');
  const box = el('div', 'help up');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '先の予定');
  box.dataset.screen = 'upcoming'; box.dataset.screenLayer = '7';

  const head = el('div', 'help-head');
  head.appendChild(el('span', 'tt', '先の予定'));
  const closeBtn = el('button', 'cl', '閉じる');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeUpcoming(true));
  head.appendChild(closeBtn);
  box.appendChild(head);

  box.appendChild(el('p', 'up-note',
    '日付が先に分かっている予定や、期間の決まったキャンペーンを AI が Web で調べる。入れたものは長期保留に入り、'
    + '選んだ日（キャンペーンは既定で終わる3日前、エントリーが要るものは始まる日）に今日へ出てくる。'
    + '値動きの予想はしない。'));

  /* ---- 1. 見るもの（畳める。結果があるときは畳んで、一覧を上に出す） ---- */
  const cond = document.createElement('details');
  cond.className = 'up-cond';
  const condSum = document.createElement('summary');
  cond.appendChild(condSum);
  const pick = el('fieldset', 'up-topics');
  pick.appendChild(el('legend', null, '見るもの'));
  const chosen = new Set(prefs.topics);
  let group = '';
  TOPICS.forEach(t => {
    if (t.group !== group) { group = t.group; pick.appendChild(el('p', 'up-group', group)); }
    const lb = el('label', 'up-topic');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chosen.has(t.id);
    cb.addEventListener('change', () => {
      if (cb.checked) chosen.add(t.id); else chosen.delete(t.id);
      remember();
      syncAsk();
      syncSummary();
    });
    const tx = el('span');
    tx.textContent = t.label;
    const ld = el('small');
    ld.textContent = t.group === 'お得' ? '終わる' + t.lead + '日前' : t.lead + '日前';
    lb.appendChild(cb); lb.appendChild(tx); lb.appendChild(ld);
    pick.appendChild(lb);
  });
  cond.appendChild(pick);

  const wordsLb = el('label', 'up-words');
  const wordsTx = el('span');
  wordsTx.textContent = '銘柄・商品・使っている支払い（任意。決算日・新型・キャンペーンを絞るときに使う）';
  const wordsIn = document.createElement('input');
  wordsIn.type = 'text';
  wordsIn.autocomplete = 'off';
  wordsIn.placeholder = '例: GOOG, NVDA, PS5, d払い, エアウォレット';
  wordsIn.value = prefs.words;
  wordsIn.addEventListener('change', () => { remember(); syncSummary(); });
  wordsLb.appendChild(wordsTx); wordsLb.appendChild(wordsIn);
  cond.appendChild(wordsLb);
  box.appendChild(cond);

  /* ---- 2. 調べる ---- */
  const askRow = el('div', 'up-askrow');
  const askBtn = el('button', 'btn up-ask', '調べる');
  askBtn.type = 'button';
  const askNote = el('p', 'up-note');
  askRow.appendChild(askBtn);
  box.appendChild(askRow);
  box.appendChild(askNote);

  /* ---- 3. 一覧 ---- */
  const listHead = el('p', 'up-listhead');
  const list = el('ul', 'up-list');
  box.appendChild(listHead);
  box.appendChild(list);

  /* ---- 4. 入れる ---- */
  const addRow = el('div', 'up-addrow');
  const addBtn = el('button', 'btn up-add', '入れる');
  addBtn.type = 'button';
  addRow.appendChild(addBtn);
  box.appendChild(addRow);

  back.appendChild(box);
  back.addEventListener('pointerdown', ev => { if (ev.target === back) closeUpcoming(true); });
  const onKey = ev => {
    if (ev.key !== 'Escape' || fromFeedback(ev)) return;
    ev.preventDefault(); ev.stopPropagation();
    closeUpcoming(true);
  };
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  root = { back, onKey, was: o.was, onClose: o.onClose };

  /* 行ごとの状態。key -> { on, lead } */
  let events = normalizeEvents(prefs.events, today);
  const rowState = new Map();

  function remember() {
    savePrefs({ ver: TOPICS_VER, topics: Array.from(chosen), words: wordsIn.value.trim(), lastDay: prefs.lastDay, events });
  }

  /* 畳んだときの見出し: 見るもの N 件・銘柄（あれば） */
  function syncSummary() {
    const w = wordsIn.value.trim();
    condSum.textContent = '見るもの ' + chosen.size + '件' + (w ? '・' + (w.length > 24 ? w.slice(0, 24) + '…' : w) : '');
  }

  function syncAsk() {
    askBtn.disabled = !chosen.size || !hasKey();
    askNote.textContent = !hasKey()
      ? 'API キーを設定の「ヘルプ」に入れると調べられる。'
      : !chosen.size ? '見るものを 1 つ以上選ぶ。'
      : '押したときだけ調べる（Web 検索は 1 回に ' + SEARCH_MAX_USES + ' 回まで。料金はこのキーの持ち主に掛かる）。'
        + (prefs.lastDay ? ' 前に調べた日: ' + md(prefs.lastDay) : '');
  }

  function syncAdd() {
    const have = addedKeys(store.all());
    const n = events.filter(e => !have.has(e.key) && rowState.get(e.key) && rowState.get(e.key).on).length;
    addBtn.textContent = n ? '選んだ ' + n + ' 件を入れる' : '入れる';
    addBtn.disabled = !n;
    addRow.hidden = !events.length;
  }

  function renderList() {
    list.textContent = '';
    const have = addedKeys(store.all());
    listHead.textContent = events.length
      ? '見つかった予定（' + (prefs.lastDay ? md(prefs.lastDay) + ' に調べた。' : '') + '日付は出典で確かめる）'
      : (prefs.lastDay ? '見つかった予定は無い。' : '');
    events.forEach(ev => {
      if (!rowState.has(ev.key)) rowState.set(ev.key, { on: ev.status !== 'rumor', lead: defaultLead(ev, today) });
      const st = rowState.get(ev.key);
      const done = have.has(ev.key);
      const li = el('li', 'up-row' + (done ? ' is-added' : '') + ' is-' + ev.status);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !done && st.on;
      cb.disabled = done;
      cb.setAttribute('aria-label', ev.title + ' を入れる');
      cb.addEventListener('change', () => { st.on = cb.checked; syncAdd(); });

      const date = el('span', 'up-date');
      /* 期間ものは「M/D〜M/D」。開催中なら頭に「開催中」（終わりの日だけ太く見せる） */
      if (ev.end) {
        if (isRunning(ev, today)) date.appendChild(el('span', 'up-run', '開催中'));
        const s = el('span');
        s.textContent = md(ev.date) + '〜';
        const e = el('b');
        e.textContent = md(ev.end) + '（' + wd(ev.end) + '）';
        date.appendChild(s); date.appendChild(e);
      } else {
        date.textContent = md(ev.date) + '（' + wd(ev.date) + '）';
      }
      const body = el('span', 'up-body');
      const ttl = el('span', 'up-title');
      ttl.textContent = ev.title;             /* AI の返事。innerHTML には入れない */
      const meta = el('span', 'up-meta');
      const badge = el('span', 'up-st');
      badge.textContent = STATUS[ev.status];
      meta.appendChild(badge);
      if (ev.entry) meta.appendChild(el('span', 'up-st is-entry', 'エントリー要'));
      if (ev.note) {
        const nt = el('span', 'up-cond-tx');
        nt.textContent = ev.note;             /* AI の返事。innerHTML には入れない */
        meta.appendChild(nt);
      }
      if (ev.source) {
        const a = el('a', 'up-src');
        a.textContent = '出典';
        a.href = ev.source;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        meta.appendChild(a);
      }
      body.appendChild(ttl); body.appendChild(meta);

      const tail = el('span', 'up-tail');
      if (done) {
        tail.textContent = '入れてある';
      } else {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', ev.title + ' を今日へ出す日');
        const opts = leadOptions(ev, today);
        opts.forEach(x => {
          const op = document.createElement('option');
          op.value = x.id;
          op.textContent = x.label;
          sel.appendChild(op);
        });
        if (!opts.some(x => x.id === st.lead)) st.lead = defaultLead(ev, today);
        sel.value = st.lead;
        const when = el('small', 'up-when');
        const upd = () => {
          const d = triggerDay(ev, st.lead, today);
          when.textContent = d === today ? '→ すぐ今日に置く' : '→ ' + md(d) + ' に今日へ';
        };
        sel.addEventListener('change', () => { st.lead = sel.value; upd(); });
        upd();
        tail.appendChild(sel); tail.appendChild(when);
      }

      li.appendChild(cb); li.appendChild(date); li.appendChild(body); li.appendChild(tail);
      list.appendChild(li);
    });
    syncAdd();
  }

  askBtn.addEventListener('click', async () => {
    if (askBtn.disabled) return;
    askBtn.disabled = true;
    const was = askBtn.textContent;
    askBtn.textContent = '調べている…';
    askNote.textContent = 'Web を調べている（10〜60 秒ほど）。閉じてもよいが、結果はこの板でしか受け取れない。';
    try {
      const p = buildPrompt(Array.from(chosen), wordsIn.value, today);
      const text = await askWithSearch(p.system, p.user);
      const arr = extractJsonArray(text);
      if (!arr) throw new Error('返事を一覧にできなかった。もう一度調べる');
      events = normalizeEvents(arr, today);
      prefs.lastDay = today;
      remember();
      if (root) { if (events.length) cond.open = false; renderList(); syncAsk(); }
      toast(events.length ? events.length + '件の予定が見つかった' : '予定は見つからなかった');
    } catch (err) {
      if (root) askNote.textContent = (err && err.message) || '調べられなかった';
    } finally {
      askBtn.textContent = was;
      if (root) syncAsk();
    }
  });

  addBtn.addEventListener('click', () => {
    const have = addedKeys(store.all());
    const picks = events.filter(e => !have.has(e.key) && rowState.get(e.key) && rowState.get(e.key).on)
      .map(e => ({ ev: e, lead: rowState.get(e.key).lead }));
    if (!picks.length) return;
    if (store.readOnly && store.readOnly()) { toast('繋がると入れられる（いまは読むだけの間）'); return; }
    const r = addEvents(store, picks, today);
    renderList();
    toast(r.added.length
      ? r.added.length + '件を長期保留に入れた（その日になると今日へ出る）'
      : '入れられなかった');
  });

  cond.open = !events.length;
  syncSummary();
  renderList();
  syncAsk();
  setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* そのまま */ } }, 0);
  return true;
}
