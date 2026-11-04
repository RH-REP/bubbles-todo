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
import { askWithSearchFull, hasKey, SEARCH_MAX_USES, SEARCH_USES_CAP } from './ai.js';
import {
  TOPICS, DEFAULT_TOPICS, KW_MAX, parseKeywords, TOPICS_VER, TOPICS_ADDED, STATUS, buildPrompt, extractJsonArray, normalizeEvents,
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
    keywords: typeof p.keywords === 'string' ? p.keywords : '',
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

  /* 中身だけが流れ、見出しと下のボタン（調べる／入れる）は留まる（ヘルプと同じ3段） */
  box.classList.add('has-chat');
  const scroller = el('div', 'help-scroll');
  box.appendChild(scroller);

  /* 説明は 1 行だけ。決まりごとは「しくみ」に畳む（前は 4 行の説明が毎回いちばん上に出ていた） */
  scroller.appendChild(el('p', 'up-lead', '日付の決まった予定やキャンペーンを AI が調べ、その少し前に今日へ出す。'));
  const how = document.createElement('details');
  how.className = 'up-how';
  const howSum = document.createElement('summary');
  howSum.textContent = 'しくみ';
  how.appendChild(howSum);
  [
    '入れたものは長期保留に入り、選んだ日に今日の水面へ出てくる。',
    '今日へ出す日の既定: 予定は見るものごとの日数前、キャンペーンは終わる3日前、エントリーが要るものは始まる日。',
    '調べるのは「調べる」を押したときだけ（Web 検索は 1 回に ' + SEARCH_MAX_USES + ' 回まで。キーワード 1 つごとに 1 回足す。料金はこのキーの持ち主に掛かる）。',
    '値動きの予想はしない。日付は AI が読み取ったものなので、出典で確かめる。',
    '送るのは見るものと下の欄の文字だけ。バブルの本文は送らない。',
  ].forEach(s => how.appendChild(el('p', 'up-note', s)));
  scroller.appendChild(how);

  /* ---- 1. 見るもの（畳める。結果があるときは畳んで、一覧を上に出す） ---- */
  const cond = document.createElement('details');
  cond.className = 'up-cond';
  const condSum = document.createElement('summary');
  cond.appendChild(condSum);
  const pick = el('fieldset', 'up-topics');
  pick.appendChild(el('legend', null, '見るもの'));
  const chosen = new Set(prefs.topics);
  const groups = [];
  TOPICS.forEach(t => { if (!groups.includes(t.group)) groups.push(t.group); });
  groups.forEach(g => {
    pick.appendChild(el('p', 'up-group', g));
    const grid = el('div', 'up-chips');
    TOPICS.filter(t => t.group === g).forEach(t => {
      const lb = el('label', 'up-chip');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = chosen.has(t.id);
      cb.addEventListener('change', () => {
        if (cb.checked) chosen.add(t.id); else chosen.delete(t.id);
        remember();
        syncAsk();
        syncSummary();
      });
      const tx = el('span', 'up-chip-tx');
      const nm = el('b');
      nm.textContent = t.label;
      tx.appendChild(nm);
      if (t.sub) { const sb = el('small'); sb.textContent = t.sub; tx.appendChild(sb); }
      const ld = el('small', 'up-chip-ld');
      ld.textContent = t.group === 'お得' ? '終わる' + t.lead + '日前' : t.lead + '日前';
      tx.appendChild(ld);
      lb.appendChild(cb); lb.appendChild(tx);
      grid.appendChild(lb);
    });
    pick.appendChild(grid);
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

  /* キーワード（2026-11-04 追加。Issue #13）。見るものに無いものを、言葉で 1 つずつ調べる */
  const kwLb = el('label', 'up-words');
  const kwTx = el('span');
  kwTx.textContent = 'キーワードで調べる（任意。「、」で区切って ' + KW_MAX + ' つまで。見るものを選ばなくても調べられる）';
  const kwIn = document.createElement('input');
  kwIn.type = 'text';
  kwIn.autocomplete = 'off';
  kwIn.placeholder = '例: SBI 投資信託 キャンペーン、楽天 お買い物マラソン';
  kwIn.value = prefs.keywords;
  kwIn.addEventListener('input', () => { syncAsk(); });
  kwIn.addEventListener('change', () => { remember(); syncSummary(); syncAsk(); });
  kwLb.appendChild(kwTx); kwLb.appendChild(kwIn);
  cond.appendChild(kwLb);
  scroller.appendChild(cond);

  /* ---- 2. 状態の1行（待っている・失敗・キーが無い など） ---- */
  const askNote = el('p', 'up-status');
  askNote.setAttribute('role', 'status');
  scroller.appendChild(askNote);

  /* ---- 3. 一覧 ---- */
  const listBar = el('div', 'up-listbar');
  const listHead = el('p', 'up-listhead');
  const allBtn = el('button', 'help-link up-all', 'すべて選ぶ');
  allBtn.type = 'button';
  listBar.appendChild(listHead); listBar.appendChild(allBtn);
  const list = el('div', 'up-list');
  scroller.appendChild(listBar);
  scroller.appendChild(list);

  /* ---- 4. 下に留まるボタン。結果が無いうちは「調べる」が主、あるときは「入れる」が主 ---- */
  const foot = el('div', 'help-foot up-foot');
  const askBtn = el('button', 'btn up-ask', '調べる');
  askBtn.type = 'button';
  const addBtn = el('button', 'btn up-add', '入れる');
  addBtn.type = 'button';
  const addRow = addBtn;   /* 前の名前（hidden を付け外しする相手） */
  foot.appendChild(askBtn); foot.appendChild(addBtn);
  box.appendChild(foot);

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
    savePrefs({ ver: TOPICS_VER, topics: Array.from(chosen), words: wordsIn.value.trim(), keywords: kwIn.value.trim(), lastDay: prefs.lastDay, events });
  }

  /* 畳んだときの見出し: 見るもの N 件・銘柄（あれば） */
  function syncSummary() {
    const w = wordsIn.value.trim();
    const k = parseKeywords(kwIn.value).length;
    condSum.textContent = '見るもの ' + chosen.size + '件' + (k ? '・キーワード ' + k + 'つ' : '') + (w ? '・' + (w.length > 24 ? w.slice(0, 24) + '…' : w) : '');
  }

  /* 状態の1行と、下のボタンの主従。
     結果が無い → 「調べる」が主（塗り）。結果がある → 「入れる」が主、「調べ直す」は従 */
  let busy = false;
  function syncAsk() {
    const any = chosen.size || parseKeywords(kwIn.value).length;
    const ok = any && hasKey();
    askBtn.disabled = !ok || busy;
    askBtn.textContent = busy ? '調べている…' : (events.length || prefs.lastDay ? '調べ直す' : '調べる');
    askBtn.classList.toggle('is-primary', !events.length);
    if (busy) return;
    askNote.classList.remove('is-error');
    askNote.textContent = !hasKey()
      ? 'API キーを設定の「ヘルプと AI」に入れると調べられる。'
      : !any ? '見るものを 1 つ以上選ぶか、キーワードを書く。'
      : !prefs.lastDay ? '見るものを選んで「調べる」。10〜60 秒ほどかかる。'
      : '';
  }

  function pickable() {
    const have = addedKeys(store.all());
    return events.filter(e => !have.has(e.key));
  }

  function syncAdd() {
    const left = pickable();
    const n = left.filter(e => rowState.get(e.key) && rowState.get(e.key).on).length;
    addBtn.textContent = n ? n + ' 件を入れる' : '入れる';
    addBtn.disabled = !n;
    addRow.hidden = !events.length;
    addBtn.classList.toggle('is-primary', !!events.length);
    allBtn.hidden = !left.length;
    allBtn.textContent = left.length && n === left.length ? '選ぶのをやめる' : 'すべて選ぶ';
  }

  allBtn.addEventListener('click', () => {
    const left = pickable();
    const all = left.every(e => rowState.get(e.key) && rowState.get(e.key).on);
    left.forEach(e => { const st = rowState.get(e.key); if (st) st.on = !all; });
    renderList();
  });

  /* 一覧にできなかったときの理由（2026-11-04 Issue #13。前は理由が分からず、同じ文だけが出ていた） */
  function failReason(r) {
    const head = '返事を一覧にできなかった。';
    if (r.stop === 'max_tokens') return head + '返事が長すぎて途中で切れた。見るものを減らして調べ直す。';
    if (r.stop === 'refusal') return head + 'AI が答えなかった。見るものかキーワードを変えて調べ直す。';
    if (r.searchError) return head + 'Web 検索が使えなかった（' + r.searchError + '）。Anthropic Console の組織の設定で Web 検索が許されているかを見る。';
    if (!String(r.text || '').trim()) return head + 'AI の返事が空だった。もう一度「調べ直す」を押す。';
    return head + 'AI の返事に一覧の形が無かった。もう一度「調べ直す」を押す。';
  }

  /* 'YYYY-MM-DD' -> 'YYYY年M月'（一覧の見出し） */
  function monthOf(key) { const m = /^(\d{4})-(\d{2})/.exec(key); return m ? (+m[1]) + '年' + (+m[2]) + '月' : ''; }

  askBtn.addEventListener('click', async () => {
    if (askBtn.disabled) return;
    busy = true;
    syncAsk();
    askNote.classList.remove('is-error');
    askNote.textContent = '';
    askNote.appendChild(el('span', 'up-spin'));
    askNote.appendChild(document.createTextNode(' Web を調べている（10〜60 秒ほど）。閉じると結果は受け取れない。'));
    scroller.scrollTop = 0;
    try {
      const kws = parseKeywords(kwIn.value);
      const p = buildPrompt(Array.from(chosen), wordsIn.value, today, kws);
      const r = await askWithSearchFull(p.system, p.user, { maxUses: Math.min(SEARCH_USES_CAP, SEARCH_MAX_USES + kws.length) });
      const arr = extractJsonArray(r.text);
      if (!arr) throw new Error(failReason(r));
      events = normalizeEvents(arr, today);
      prefs.lastDay = today;
      remember();
      busy = false;
      if (root) { if (events.length) cond.open = false; renderList(); syncAsk(); }
      toast(events.length ? events.length + '件見つかった' : '予定は見つからなかった');
    } catch (err) {
      busy = false;
      if (root) {
        syncAsk();
        askNote.textContent = (err && err.message) || '調べられなかった';
        askNote.classList.add('is-error');
      }
    }
  });

  addBtn.addEventListener('click', () => {
    const picks = pickable().filter(e => rowState.get(e.key) && rowState.get(e.key).on)
      .map(e => ({ ev: e, lead: rowState.get(e.key).lead }));
    if (!picks.length) return;
    if (store.readOnly && store.readOnly()) { toast('繋がると入れられる（いまは読むだけの間）'); return; }
    const r = addEvents(store, picks, today);
    renderList();
    toast(r.added.length
      ? r.added.length + '件を長期保留に入れた（その日になると今日へ出る）'
      : '入れられなかった');
  });

  /* 一覧。開催中のものを先頭の「開催中」にまとめ、ほかは始まる月ごとに見出しを付ける。
     行全体が選ぶ印の label（どこを押しても選べる）。出典と日の選び欄は、押しても選び直しにならない */
  function renderList() {
    list.textContent = '';
    const have = addedKeys(store.all());
    const n = events.length;
    listBar.hidden = !n && !prefs.lastDay;
    listHead.textContent = n
      ? n + '件見つかった' + (prefs.lastDay ? '（' + md(prefs.lastDay) + ' に調べた）' : '')
      : (prefs.lastDay ? '見つかった予定は無い。見るものを変えて調べ直す。' : '');
    let section = '';
    events.forEach(ev => {
      if (!rowState.has(ev.key)) rowState.set(ev.key, { on: ev.status !== 'rumor', lead: defaultLead(ev, today) });
      const st = rowState.get(ev.key);
      const done = have.has(ev.key);
      const sec = isRunning(ev, today) ? '開催中' : monthOf(ev.date);
      if (sec !== section) { section = sec; list.appendChild(el('p', 'up-sec', sec)); }

      const row = el('label', 'up-row' + (done ? ' is-added' : '') + ' is-' + ev.status + (st.on && !done ? ' is-on' : ''));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'up-cb';
      cb.checked = !done && st.on;
      cb.disabled = done;
      cb.addEventListener('change', () => { st.on = cb.checked; row.classList.toggle('is-on', cb.checked); syncAdd(); });

      const date = el('span', 'up-date');
      const b = el('b');
      const w = el('span');
      if (ev.end) { w.textContent = md(ev.date) + '〜'; b.textContent = md(ev.end) + '（' + wd(ev.end) + '）'; date.appendChild(w); date.appendChild(b); }
      else { b.textContent = md(ev.date); w.textContent = '（' + wd(ev.date) + '）'; date.appendChild(b); date.appendChild(w); }

      const body = el('span', 'up-body');
      const ttl = el('span', 'up-title');
      ttl.textContent = ev.title;             /* AI の返事。innerHTML には入れない */
      const meta = el('span', 'up-meta');
      const badge = el('span', 'up-st');
      badge.textContent = STATUS[ev.status];
      meta.appendChild(badge);
      if (ev.entry) meta.appendChild(el('span', 'up-st is-entry', 'エントリー要'));
      if (ev.source) {
        const a = el('a', 'up-src');
        a.textContent = '出典';
        a.href = ev.source;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', ev.title + ' の出典を開く');
        meta.appendChild(a);
      }
      body.appendChild(ttl); body.appendChild(meta);
      if (ev.note) {
        const nt = el('span', 'up-cond-tx');
        nt.textContent = ev.note;             /* AI の返事。innerHTML には入れない */
        body.appendChild(nt);
      }

      const tail = el('span', 'up-tail');
      if (done) {
        tail.appendChild(el('span', 'up-done', '✓ 入れてある'));
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
          when.textContent = d === today ? 'すぐ今日へ' : md(d) + ' に今日へ';
        };
        sel.addEventListener('change', () => { st.lead = sel.value; upd(); });
        upd();
        tail.appendChild(sel); tail.appendChild(when);
      }

      row.appendChild(cb); row.appendChild(date); row.appendChild(body); row.appendChild(tail);
      /* 行（label）のどこを押しても選べる。選び欄・出典は「操作できる中身」なので、
         押しても label は印を切り替えない（HTML の決まり。tests の画面確認で見ている） */
      list.appendChild(row);
    });
    syncAdd();
  }

  cond.open = !events.length;
  syncSummary();
  renderList();
  syncAsk();
  setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* そのまま */ } }, 0);
  return true;
}
