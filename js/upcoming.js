/* 先の予定（AI）の板（2026-11-04。利用者の指示 Issue #13）。

   設定の「先の予定（AI）」から開く（2026-11-05 の見直し。利用者の指示 Issue #13）:
     1. 調べ方の主は、下に留まる欄に「調べたいこと」を書いて送る（ヘルプと同じ形）。送ったときだけ AI
        （Anthropic の Web 検索）に訊く。起動時・定期には訊かない。例の文を押すとそのまま調べる
     2. 「まとめて調べる」（畳んである）……見るもののカード（既定はすべて外す）・すべて選ぶ／外す・銘柄の欄・
        「選んだ N 件を調べる」。押したときだけ調べる（前は「調べ直す」が選び直す前に始まってしまった）
     3. 見つかった予定の一覧……送るたびに足していく。日付・題名・説明・確定/予定/噂・何日前に今日へ・出典。
        既定ではどれも選ばない
     4. 「N 件を入れる」……長期保留のバブルにする（その日になると今日へ出る。js/events.js addEvents）。
        本文に説明（指標の意味・予想を上回った／下回ったときの一般的な傾向、キャンペーンの概要・上限・注意）を書く

   決めごと:
   - 予測はしない。日付と出来事だけ（js/events.js の頭）
   - 送るのは選んだトピックと、書いた銘柄・商品だけ。バブルの本文は送らない（#9 と同じ）
   - 端末にだけ置くもの（localStorage 'bubble_todo_upcoming'）: 選んだトピック・銘柄・最後に調べた日と結果。
     同期・CSV には乗らない（記録ではなく、この端末の設定）。結果を残すのは、開き直すたびに料金を掛けないため */

import { el, toast, fromFeedback } from './ui.js';
import { store } from './store.js';
import { askWithSearchFull, hasKey, SEARCH_MAX_USES, SEARCH_USES_CAP } from './ai.js';
import {
  TOPICS, TOPICS_VER, migrateTopics, MSG_MAX, KEEP_MAX, cleanMessage, STATUS, buildPrompt, extractJsonArray, normalizeEvents,
  mergeEvents, defaultLead, leadOptions, triggerDay, isRunning, md, addedKeys, addEvents,
  buildRoutePrompt, normalizeRoutes, routeLine, isFixedRoute, DEFAULT_SITES,
} from './events.js';

const PREF_KEY = 'bubble_todo_upcoming';
const STALE_DAYS = 30;
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function loadPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { p = null; }
  p = (p && typeof p === 'object') ? p : {};
  /* 既定はどれも選ばない。前の版（全部に印が付いていた）で保存した選びは 1 回だけ空にする（js/events.js migrateTopics） */
  const topics = migrateTopics(p);
  return {
    topics,
    words: typeof p.words === 'string' ? p.words : '',
    cards: typeof p.cards === 'string' ? p.cards : '',
    sites: typeof p.sites === 'string' ? p.sites : DEFAULT_SITES,
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
  scroller.appendChild(el('p', 'up-lead', '調べたい予定やキャンペーンを下の欄に書いて送る。AI が日付と説明を調べ、選んだものをその少し前に今日へ出す。'));
  const how = document.createElement('details');
  how.className = 'up-how';
  const howSum = document.createElement('summary');
  howSum.textContent = 'しくみ';
  how.appendChild(howSum);
  [
    '入れたものは長期保留に入り、選んだ日に今日の水面へ出てくる。本文に説明（指標の意味と、予想を上回った／下回ったときの一般的な値動き。キャンペーンの概要・上限・注意）が入る。',
    '今日へ出す日の既定: 予定は見るものごとの日数前、キャンペーンは終わる3日前、エントリーが要るものは始まる日。',
    '調べるのは送ったとき・「選んだものを調べる」を押したときだけ（Web 検索は 1 回に ' + SEARCH_MAX_USES + ' 回まで。料金はこのキーの持ち主に掛かる）。',
    '値動きの説明は一般的な傾向で、今回どうなるかの予想ではない。日付は AI が読み取ったものなので、出典で確かめる。',
    '送るのは書いた文・選んだ見るもの・銘柄の欄の文字だけ。バブルの本文は送らない。',
  ].forEach(s => how.appendChild(el('p', 'up-note', s)));
  scroller.appendChild(how);

  /* 例の文（押すとそのまま調べる。ヘルプの例と同じ） */
  const examples = el('div', 'up-examples');
  examples.appendChild(el('p', 'up-group', '例（押すとそのまま調べる）'));
  const exRow = el('div', 'up-exrow');
  [
    '楽天 お買い物マラソンの次の期間',
    'SBI証券 投資信託のキャンペーン',
    '次の米国 CPI と雇用統計',
    'FOMC と日銀の次の会合',
    'PayPay・d払いの今月のキャンペーン',
  ].forEach(q => {
    const b = el('button', 'help-ex up-ex', q);
    b.type = 'button';
    b.addEventListener('click', () => { if (busy || !hasKey()) return; msgIn.value = q; runSearch({ message: q }); });
    exRow.appendChild(b);
  });
  const exRoute = el('button', 'help-ex up-ex', '今お得な支払いルート');
  exRoute.type = 'button';
  exRoute.addEventListener('click', () => { if (busy || !hasKey()) return; remember(); runSearch({ route: true }); });
  exRow.appendChild(exRoute);
  examples.appendChild(exRow);
  scroller.appendChild(examples);

  /* ---- まとめて調べる（畳んである。見るもののカードは既定ですべて外す） ---- */
  const cond = document.createElement('details');
  cond.className = 'up-cond';
  const condSum = document.createElement('summary');
  cond.appendChild(condSum);
  const pick = el('fieldset', 'up-topics');
  pick.appendChild(el('legend', null, '見るもの'));
  const chosen = new Set(prefs.topics);
  const topicBar = el('div', 'up-listbar');
  topicBar.appendChild(el('p', 'up-group', '見るものを選んで、まとめて調べる'));
  const topicAll = el('button', 'help-link up-tall', 'すべて選ぶ');
  topicAll.type = 'button';
  topicBar.appendChild(topicAll);
  pick.appendChild(topicBar);
  const boxes = [];
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
      cb.dataset.topic = t.id;
      cb.addEventListener('change', () => {
        if (cb.checked) chosen.add(t.id); else chosen.delete(t.id);
        remember();
        syncTopics();
      });
      boxes.push(cb);
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
  wordsIn.addEventListener('change', () => { remember(); syncTopics(); });
  wordsLb.appendChild(wordsTx); wordsLb.appendChild(wordsIn);
  cond.appendChild(wordsLb);

  /* 押したときだけ調べる（前の「調べ直す」は選び直す前に始まってしまった。Issue #13 2026-11-04 のコメント） */
  const topicRun = el('div', 'up-trun');
  const topicAsk = el('button', 'btn up-task', '選んだものを調べる');
  topicAsk.type = 'button';
  topicRun.appendChild(topicAsk);
  cond.appendChild(topicRun);
  scroller.appendChild(cond);

  /* ---- 支払いルート（畳んである。2026-11-05 利用者の指示「今どの支払いがお得か調べる機能」） ----
     持っているカードと参考にするサイトを書いて「お得なルートを調べる」。結果は同じ一覧に入る */
  const route = document.createElement('details');
  route.className = 'up-cond up-route';
  const routeSum = document.createElement('summary');
  routeSum.textContent = '今お得な支払いルートを調べる';
  route.appendChild(routeSum);
  route.appendChild(el('p', 'up-note', 'カード → チャージ → 支払い の流れを、還元率・条件・上限・期間と一緒にまとめる。'));
  const cardsLb = el('label', 'up-words');
  const cardsTx = el('span');
  cardsTx.textContent = '持っているカード・支払い（任意。これを起点にするルートを優先）';
  const cardsIn = document.createElement('input');
  cardsIn.type = 'text';
  cardsIn.autocomplete = 'off';
  cardsIn.placeholder = '例: 三井住友ゴールドNL, マネックスカード, 楽天みずほ';
  cardsIn.value = prefs.cards;
  cardsIn.addEventListener('change', () => remember());
  cardsLb.appendChild(cardsTx); cardsLb.appendChild(cardsIn);
  route.appendChild(cardsLb);
  const sitesLb = el('label', 'up-words');
  const sitesTx = el('span');
  sitesTx.textContent = '参考にするサイト（1 行に 1 つ。5 つまで）';
  const sitesIn = document.createElement('textarea');
  sitesIn.rows = 2;
  sitesIn.autocomplete = 'off';
  sitesIn.value = prefs.sites;
  sitesIn.addEventListener('change', () => remember());
  sitesLb.appendChild(sitesTx); sitesLb.appendChild(sitesIn);
  route.appendChild(sitesLb);
  const routeRun = el('div', 'up-trun');
  const routeAsk = el('button', 'btn up-rask', 'お得なルートを調べる');
  routeAsk.type = 'button';
  routeRun.appendChild(routeAsk);
  route.appendChild(routeRun);
  scroller.appendChild(route);

  /* ---- 状態の1行（待っている・失敗・キーが無い・見つかった件数 など） ---- */
  const askNote = el('p', 'up-status');
  askNote.setAttribute('role', 'status');
  scroller.appendChild(askNote);

  /* ---- 一覧（送るたびに足していく） ---- */
  const listBar = el('div', 'up-listbar');
  const listHead = el('p', 'up-listhead');
  const listBtns = el('span', 'up-listbtns');
  const allBtn = el('button', 'help-link up-all', 'すべて選ぶ');
  allBtn.type = 'button';
  const clearBtn = el('button', 'help-link up-clear', '一覧を消す');
  clearBtn.type = 'button';
  listBtns.appendChild(allBtn); listBtns.appendChild(clearBtn);
  listBar.appendChild(listHead); listBar.appendChild(listBtns);
  const list = el('div', 'up-list');
  scroller.appendChild(listBar);
  scroller.appendChild(list);

  /* ---- 下に留まる欄。「N 件を入れる」（一覧があるとき）と、調べたいことを書いて送る欄 ---- */
  const foot = el('div', 'help-foot up-foot');
  const addRow = el('div', 'up-addrow');
  const addBtn = el('button', 'btn up-add is-primary', '入れる');
  addBtn.type = 'button';
  addRow.appendChild(addBtn);
  foot.appendChild(addRow);
  const form = el('form', 'help-form up-form');
  const msgIn = document.createElement('input');
  msgIn.type = 'text';
  msgIn.autocomplete = 'off';
  msgIn.maxLength = MSG_MAX;
  msgIn.setAttribute('enterkeyhint', 'search');
  msgIn.setAttribute('aria-label', '調べたいこと');
  msgIn.placeholder = hasKey() ? '調べたいことを書く' : 'キーを入れると調べられる';
  const sendBtn = el('button', 'btn help-send up-send', '調べる');
  sendBtn.type = 'submit';
  form.appendChild(msgIn); form.appendChild(sendBtn);
  foot.appendChild(form);
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
  let events = normalizeEvents(prefs.events, today, KEEP_MAX);
  const rowState = new Map();
  let freshKeys = new Set();   /* いちばん新しく送った分で増えたもの（一覧で印を付ける） */

  function remember() {
    savePrefs({ ver: TOPICS_VER, topics: Array.from(chosen), words: wordsIn.value.trim(),
      cards: cardsIn.value.trim(), sites: sitesIn.value.trim(), lastDay: prefs.lastDay, events });
  }

  /* 畳んだときの見出しと、まとめて調べるボタン */
  let busy = false;
  function syncTopics() {
    const w = wordsIn.value.trim();
    condSum.textContent = 'まとめて調べる' + (chosen.size
      ? '（見るもの ' + chosen.size + '件' + (w ? '・' + (w.length > 16 ? w.slice(0, 16) + '…' : w) : '') + '）'
      : '（見るものから選ぶ）');
    topicAll.textContent = chosen.size === TOPICS.length ? 'すべて外す' : 'すべて選ぶ';
    topicAsk.textContent = busy ? '調べている…' : (chosen.size ? '選んだ ' + chosen.size + ' 件を調べる' : '選んだものを調べる');
    topicAsk.disabled = busy || !chosen.size || !hasKey();
    routeAsk.textContent = busy ? '調べている…' : 'お得なルートを調べる';
    routeAsk.disabled = busy || !hasKey();
  }

  topicAll.addEventListener('click', () => {
    const on = chosen.size !== TOPICS.length;
    chosen.clear();
    if (on) TOPICS.forEach(t => chosen.add(t.id));
    boxes.forEach(cb => { cb.checked = chosen.has(cb.dataset.topic); });
    remember();
    syncTopics();
  });

  /* 送る欄。書いてあるときだけ「調べる」が主（塗り） */
  function syncSend() {
    const has = !!cleanMessage(msgIn.value);
    msgIn.disabled = !hasKey();
    sendBtn.disabled = busy || !hasKey() || !has;
    sendBtn.textContent = busy ? '調べている…' : '調べる';
    sendBtn.classList.toggle('is-primary', has);
  }
  msgIn.addEventListener('input', syncSend);

  /* 状態の1行 */
  function syncAsk() {
    syncSend();
    syncTopics();
    examples.classList.toggle('is-off', busy || !hasKey());
    exRow.querySelectorAll('button').forEach(b => { b.disabled = busy || !hasKey(); });
    if (busy) return;
    askNote.classList.remove('is-error');
    askNote.textContent = !hasKey()
      ? 'API キーを設定の「ヘルプと AI」に入れると調べられる。'
      : !events.length && !prefs.lastDay ? '1 回調べるのに 10〜60 秒ほどかかる。'
      : '';
  }

  function pickable() {
    const have = addedKeys(store.all());
    return events.filter(e => !have.has(e.key));
  }

  function syncAdd() {
    const left = pickable();
    const n = left.filter(e => rowState.get(e.key) && rowState.get(e.key).on).length;
    addBtn.textContent = n ? n + ' 件を入れる' : '入れるものを一覧で選ぶ';
    addBtn.disabled = !n;
    addRow.hidden = !left.length;
    allBtn.hidden = !left.length;
    allBtn.textContent = left.length && n === left.length ? '選ぶのをやめる' : 'すべて選ぶ';
    clearBtn.hidden = !events.length;
  }

  allBtn.addEventListener('click', () => {
    const left = pickable();
    const all = left.every(e => rowState.get(e.key) && rowState.get(e.key).on);
    left.forEach(e => { const st = rowState.get(e.key); if (st) st.on = !all; });
    renderList();
  });

  /* 送るたびに足していくので、要らなくなったら消せる（入れたバブルは消えない） */
  clearBtn.addEventListener('click', () => {
    events = [];
    freshKeys = new Set();
    rowState.clear();
    remember();
    renderList();
    syncAsk();
  });

  /* 一覧にできなかったときの理由（2026-11-04 Issue #13。前は理由が分からず、同じ文だけが出ていた） */
  function failReason(r) {
    const head = '返事を一覧にできなかった。';
    if (r.stop === 'max_tokens') return head + '返事が長すぎて途中で切れた。調べることを絞ってもう一度送る。';
    if (r.stop === 'refusal') return head + 'AI が答えなかった。書き方を変えてもう一度送る。';
    if (r.searchError) return head + 'Web 検索が使えなかった（' + r.searchError + '）。Anthropic Console の組織の設定で Web 検索が許されているかを見る。';
    if (!String(r.text || '').trim()) return head + 'AI の返事が空だった。もう一度送る。';
    return head + 'AI の返事に一覧の形が無かった。もう一度送る。';
  }

  /* 'YYYY-MM-DD' -> 'YYYY年M月'（一覧の見出し） */
  function monthOf(key) { const m = /^(\d{4})-(\d{2})/.exec(key); return m ? (+m[1]) + '年' + (+m[2]) + '月' : ''; }

  /* 調べる。what = { message } か { topics: true } か { route: true }。結果は一覧に足す（前の結果は残す） */
  async function runSearch(what) {
    if (busy || !hasKey()) return;
    const message = what.message ? cleanMessage(what.message) : '';
    const ids = what.topics ? Array.from(chosen) : [];
    if (!message && !ids.length && !what.route) return;
    busy = true;
    syncAsk();
    askNote.classList.remove('is-error');
    askNote.textContent = '';
    askNote.appendChild(el('span', 'up-spin'));
    askNote.appendChild(document.createTextNode(' ' + (message ? '「' + message + '」を' : what.route ? 'お得な支払いルートを' : '選んだ見るものを')
      + ' Web で調べている（10〜60 秒ほど）。閉じると結果は受け取れない。'));
    scroller.scrollTop = Math.max(0, askNote.offsetTop - 8);
    try {
      const p = what.route ? buildRoutePrompt(cardsIn.value, sitesIn.value, today)
        : buildPrompt(ids, what.topics ? wordsIn.value : '', today, [], message);
      const r = await askWithSearchFull(p.system, p.user, { maxUses: Math.min(SEARCH_USES_CAP, SEARCH_MAX_USES) });
      const arr = extractJsonArray(r.text);
      if (!arr) throw new Error(failReason(r));
      const got = what.route ? normalizeRoutes(arr, today) : normalizeEvents(arr, today);
      const m = mergeEvents(got, events, today);
      events = m.events;
      freshKeys = m.fresh;
      prefs.lastDay = today;
      remember();
      busy = false;
      if (!root) return;
      if (message && cleanMessage(msgIn.value) === message) msgIn.value = '';
      if (what.topics) cond.open = false;
      if (what.route) route.open = false;
      renderList();
      syncAsk();
      const n = got.length;
      const old = n - got.filter(e => m.fresh.has(e.key)).length;
      askNote.textContent = (message ? '「' + message + '」: ' : what.route ? '支払いルート: ' : '') + (n
        ? n + '件見つかった' + (old ? '（うち ' + old + ' 件は前から一覧にある）' : '') + '。入れるものを選ぶ。'
        : '予定は見つからなかった。書き方を変えて送る。');
      const first = list.querySelector('.up-row.is-fresh');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      busy = false;
      if (root) {
        syncAsk();
        askNote.textContent = (err && err.message) || '調べられなかった';
        askNote.classList.add('is-error');
      }
    }
  }

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (sendBtn.disabled) return;
    runSearch({ message: msgIn.value });
  });
  topicAsk.addEventListener('click', () => { if (!topicAsk.disabled) runSearch({ topics: true }); });
  routeAsk.addEventListener('click', () => { if (!routeAsk.disabled) { remember(); runSearch({ route: true }); } });

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
    listBar.hidden = !n;
    listHead.textContent = n ? '一覧 ' + n + '件' + (prefs.lastDay ? '（' + md(prefs.lastDay) + ' に調べた）' : '') : '';
    let section = '';
    /* 常設の支払いルートは日付が無いので、いちばん上に「支払いルート」としてまとめる */
    events.filter(isFixedRoute).concat(events.filter(e => !isFixedRoute(e))).forEach(ev => {
      /* 既定ではどれも選ばない（2026-11-05 利用者の指示「デフォルトで全部チェック外して」） */
      if (!rowState.has(ev.key)) rowState.set(ev.key, { on: false, lead: defaultLead(ev, today) });
      const st = rowState.get(ev.key);
      const done = have.has(ev.key);
      const sec = isFixedRoute(ev) ? '支払いルート' : isRunning(ev, today) ? '開催中' : monthOf(ev.date);
      if (sec !== section) { section = sec; list.appendChild(el('p', 'up-sec', sec)); }

      const row = el('label', 'up-row' + (done ? ' is-added' : '') + ' is-' + ev.status + (st.on && !done ? ' is-on' : '')
        + (freshKeys.has(ev.key) ? ' is-fresh' : ''));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'up-cb';
      cb.checked = !done && st.on;
      cb.disabled = done;
      cb.addEventListener('change', () => { st.on = cb.checked; row.classList.toggle('is-on', cb.checked); syncAdd(); });

      const date = el('span', 'up-date');
      const b = el('b');
      const w = el('span');
      if (isFixedRoute(ev)) { b.textContent = ev.rate || '常設'; w.textContent = ev.rate ? '還元' : ''; date.appendChild(b); date.appendChild(w); }
      else if (ev.end) { w.textContent = md(ev.date) + '〜'; b.textContent = md(ev.end) + '（' + wd(ev.end) + '）'; date.appendChild(w); date.appendChild(b); }
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
      if (routeLine(ev)) {
        const rt = el('span', 'up-routeline');
        rt.textContent = routeLine(ev) + (ev.rate && !isFixedRoute(ev) ? '（' + ev.rate + '）' : '') + (ev.cap ? '・上限 ' + ev.cap : '');
        body.appendChild(rt);
      }
      if (ev.about) {
        const ab = el('span', 'up-about');
        ab.textContent = ev.about;            /* AI の返事。innerHTML には入れない */
        body.appendChild(ab);
      }
      if (freshKeys.has(ev.key)) meta.insertBefore(el('span', 'up-st is-new', '新しく見つかった'), meta.firstChild.nextSibling);
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

  cond.open = false;
  renderList();
  syncAsk();
  setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* そのまま */ } }, 0);
  return true;
}
