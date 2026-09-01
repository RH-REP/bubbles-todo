/* 集中オーバーレイ「5分だけはじめる」

   目の前の1件だけを残して、他を全部消すための画面。
   件数も進捗も他のタスクも出さない。中断させないことがこの部品の仕事。

   決めごと（変えないこと）:
   - 5分が過ぎても「あと5分？」と聞かない。聞いた瞬間に5分の約束が嘘になる。
   - 命令形にしない。淡々と。
   - 件数・回数・「何回目」を出さない。

   **時計は出さない**（利用者の指示）。前はカウントダウンの数字と輪を出し、
   5分に届いたかどうかを**時計が判定して**「はじめた」を立てていた。
   これだと4分でやめた人には何も残らない——分母を書かないだけの達成条件だった。
   いまは**押したボタンが判定**する。時間は数え続けているが、出るのは
   記録するボタンの**呼び名が変わる**ことだけ（5分まで「早く終わった」→
   5分から「今日は終わり」）。数字も輪も無い。

   抜ける道は3つ。どれも onClose(info) の中身だけで伝える:
   - [早く終わった] / [今日は終わり] … 同じ1つのボタン。呼び名だけが5分で変わる。
     どちらでも「はじめた」を立てる。{ reachedGoal: true, reason: 'enough' }
   - [やめる] … 閉じるだけ。**何も記録しない**（経過時間に関係なく）。{ reason: 'stop' }
   - [完了] … もうこれに着手する必要が無くなった。完了の海へ移る。
     { reachedGoal: false, completed: true, reason: 'done' }
     完了と「はじめた」は別のこと。両方は立てない（closeFocus が reachedGoal を落とす）。
     音も store も呼び出し側の仕事。ここでは鳴らさないし触らない。取り消しも呼び出し側。
   どの道でも、書きかけがあれば「記録するか」を画面の中で聞く（confirm() は使わない）。

   store は一切触らない。着手の記録は呼び出し側が済ませてから開く。
   「書く」も作業ログも同じで、預け先は setCaptureHandler() /
   setWorklogHandler() で外から差してもらう。 */

import { el, escapeHtml } from './ui.js';
/* 一手の記録の一覧は盤と共通のものを使う（bubble.js）。
   bubble.js は ui.js しか読まないので、ここから読んでも循環しない。 */
import { stepList } from './bubble.js';

/* ---------- 状態（同時に1つしか開かない） ---------- */
let state = null;

/* 集中中に割り込んできた考えの預け先。app.js が起動時に1回差す。
   差されていなければ入力欄ごと出さない（行き先の無い入力欄を出さないため）。 */
let captureHandler = null;
export function setCaptureHandler(fn) {
  captureHandler = typeof fn === 'function' ? fn : null;
}

/* 作業ログ（一手の記録）の預け先。これも外から差してもらう。
   a = {
     lastStep(id),                 // { at, did, next } または null
     firstStep(id),                // 文字列
     url(id),                      // 文字列
     draft(id),                    // { did, next }
     saveDraft(id, {did, next}),   // 下書きの自動保存（記録ではない）
     commit(id, {did, next}),      // 「記録する」。戻り値は積んだ記録
     amendLast(id, {did}),         // 書き損じ直し。新しい記録は増やさない
   }
   差されていなければ作業ログの欄は一切出さない（従来どおりの集中画面になる）。 */
let worklogAdapter = null;
export function setWorklogHandler(a) {
  worklogAdapter = (a && typeof a === 'object') ? a : null;
}

/* 開始時刻からの実時間で数える。setInterval の回数では数えない。
   タブが裏に回ると setInterval は1秒単位に間引かれ、回数で数えると狂うため。 */
const TICK_MS = 250;

/* 下書き（と書き損じ直し）の自動保存の間合い。打つたびには書かない。
   plan.js の SAVE_MS と同じ値にしてある。 */
const SAVE_MS = 400;

/* 記録には「次の一手」が要る（git のように、記録は必ず「次はここから」を持つ）。
   押せない理由を出すときの言い方。命令形にしない＝「入れてください」とは言わない。 */
const NEXT_REQUIRED = '記録には次の一手が要る';

/* ---------- 公開API ---------- */

/* opts = {
     id, title, firstStep, url, slotName, slotColor, minutes, onClose }
   id が無ければ作業ログの欄は出さない。
   作業ログを出すときの「開始の１手」「リンク」はアダプタ側を正とする
   （記録した直後に開始の１手が変わるので、opts の値は古くなる）。 */
export function openFocus(opts) {
  if (state) return;                        // 既に開いていたら何もしない
  const o = opts || {};

  const id = (o.id == null || o.id === '') ? null : o.id;
  const title = String(o.title == null ? '' : o.title);
  const firstStep = String(o.firstStep == null ? '' : o.firstStep).trim();
  const slotName = String(o.slotName == null ? '' : o.slotName).trim();
  const minutes = Number.isFinite(Number(o.minutes)) && Number(o.minutes) > 0
    ? Number(o.minutes) : 5;
  const totalMs = Math.round(minutes * 60 * 1000);
  const onClose = typeof o.onClose === 'function' ? o.onClose : null;
  const href = safeUrl(o.url);

  /* 作業ログ。id とアダプタが両方そろっているときだけ出す */
  const log = buildWorklog(id, (o.worklog && typeof o.worklog === 'object')
    ? o.worklog : worklogAdapter);

  /* ---- 骨組み ---- */
  const root = el('div', 'focus');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '集中');
  root.tabIndex = -1;
  if (typeof o.slotColor === 'string' && o.slotColor.trim()) {
    // 不正な値なら CSS 側で無効になり、focus.css の既定色がそのまま残る
    root.style.setProperty('--focus-accent', o.slotColor.trim());
  }
  if (prefersReducedMotion()) root.classList.add('is-still');
  if (log) root.classList.add('is-log');

  const card = el('div', 'focus-card');

  /* 縦に長くなるのは作業ログの欄。スクロールするのはここだけにして、
     タイマーは上に貼り付け、「やめる」と入力欄は下に置いたままにする。 */
  const scroll = el('div', 'focus-scroll');
  const head = el('div', 'focus-head');

  /* 枠の名前（朝/昼/夜）。表示用なので無くてよい */
  if (slotName) {
    const tag = el('div', 'focus-slot');
    tag.appendChild(el('span', 'dot'));
    tag.appendChild(el('span', null, escapeHtml(slotName)));
    head.appendChild(tag);
  }

  /* 本文。いちばん大きく */
  head.appendChild(el('h1', 'focus-title', escapeHtml(title)));

  /* 作業ログを出すときは、最初の一手とリンクは下（ログの欄）で出す。
     出さないときだけ、従来どおり本文の下に置く。 */
  if (!log) {
    if (firstStep) head.appendChild(el('p', 'focus-step', escapeHtml(firstStep)));
    if (href) {
      const a = el('a', 'btn focus-link', '開く');
      a.href = href;                        // 属性ではなくプロパティで入れる
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      head.appendChild(a);
    }
  }
  scroll.appendChild(head);

  /* 約束の一言。数字も輪も出さない（利用者の指示で時計を削除した）。
     ここは静かに置いたままにする——「5分だけ」という枠そのものは残っているので。 */
  const timer = el('div', 'focus-timer');
  const noteNode = el('div', 'focus-note');
  noteNode.setAttribute('role', 'status');
  noteNode.textContent = promiseLabel(minutes);
  timer.appendChild(noteNode);
  scroll.appendChild(timer);

  /* 前回からの続き。記録するまで時計は関係なく進む */
  if (log) scroll.appendChild(log.node);

  card.appendChild(scroll);

  /* 下に貼り付けるぶん。スクロールしても手が届く */
  const foot = el('div', 'focus-foot');

  /* 割り込んできた考えを、頭から出して預ける場所。
     ここで書いても時計は止まらない。止められる作りにすると停止ボタンが要り、
     5分の約束の性質が変わる。 */
  const capture = buildCapture(o.onCapture || captureHandler);
  if (capture) foot.appendChild(capture.node);

  /* 抜ける道は3つ。閉じ込めない。
     置き方: [完了] は左に単独で1行、その下に [十分すすんだ][やめる] の2つ。
     ・375px で3つ横に並べると1本 104px しか無く、「十分すすんだ」が収まらない
     ・[完了] と [やめる] を隣り合わせにしない（取り返しの差が大きい）。
       左上と右下＝いちばん遠い対角に置く
     ・[完了] は幅を文字ぶんに絞る（誤って触れる面積を小さくする）。
       塗りも持たせない。完了は静かに済ませる（祝祭にしない） */
  const done = el('button', 'btn focus-done', '完了');
  done.type = 'button';
  foot.appendChild(done);

  const exits = el('div', 'focus-exits');
  /* 記録するボタン。**呼び名だけが5分で変わる**（tick が入れ替える）。
     5分まで「早く終わった」／5分から「今日は終わり」。どちらでも記録は同じ。
     数字を出さずに「5分を越えた」を伝える唯一の合図でもある。 */
  const enough = el('button', 'btn focus-enough', EARLY_LB);
  enough.type = 'button';
  const stop = el('button', 'btn focus-stop', 'やめる');
  stop.type = 'button';
  exits.appendChild(enough);
  exits.appendChild(stop);
  foot.appendChild(exits);

  card.appendChild(foot);
  root.appendChild(card);

  state = {
    root, noteNode, enough, stop,
    startedAt: Date.now(),
    totalMs, minutes,
    onClose,
    capture, log,
    ask: null,                              // 「記録するか」を聞いている間だけ入る
    timer: 0,
    over: false,
    prevFocus: document.activeElement,
    onKeydown: null,
    onFocusin: null,
    onVisibility: null,
  };

  /* 5分に届いていなくても「はじめた」を立てる。完了ではない */
  enough.addEventListener('click', () =>
    requestClose({ reachedGoal: true, reason: 'enough' }));
  /* 閉じるだけ。**経過時間に関係なく記録しない**（利用者の指示）。
     判定を時計から本人へ移したので、ここが「なかったことにする」道になる */
  stop.addEventListener('click', () => requestClose({ reason: 'stop' }));
  /* もう着手する必要が無くなった。「はじめた」は立てない（closeFocus が落とす） */
  done.addEventListener('click', () =>
    requestClose({ completed: true, reason: 'done' }));

  /* Escape で閉じる／Tab をオーバーレイの中で完結させる。
     ただし入力欄にいる間の Escape は、まず入力欄から抜けるだけにする
     （書きかけのまま集中画面ごと閉じると、打った文字が消える）。値は消さない。 */
  state.onKeydown = (ev) => {
    if (!state) return;
    if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      /* 聞いている最中の Escape は「記録しない」にあたる。
         Escape を二度手間にしないため。打った文字は下書きとして残るので何も捨てない。 */
      if (state.ask) { closeFocus(state.ask.info); return; }
      const active = document.activeElement;
      if (active && state.root.contains(active) && isTextField(active)) {
        active.blur();                      // 値はそのまま。blur で保存も走る
        return;
      }
      requestClose({ reason: 'escape' });
      return;
    }
    if (ev.key === 'Tab') trapTab(ev);
  };
  document.addEventListener('keydown', state.onKeydown, true);

  /* 背後の要素にフォーカスが抜けたら引き戻す。
     聞いている間は、その囲みの中だけに閉じる */
  state.onFocusin = (ev) => {
    if (!state) return;
    const scope = state.ask ? state.ask.node : state.root;
    if (!scope.contains(ev.target)) {
      const list = focusables();
      (list[0] || scope).focus();
    }
  };
  document.addEventListener('focusin', state.onFocusin, true);

  /* 裏から戻ってきた瞬間にも合わせ直す（間引きの取り残しを消す）。
     裏に回るときは書きかけを書き出しておく（そのまま捨てられることがある） */
  state.onVisibility = () => {
    if (document.visibilityState === 'hidden') flushDrafts();
    tick();
  };
  document.addEventListener('visibilitychange', state.onVisibility);

  document.body.appendChild(root);
  stop.focus();

  tick();
  state.timer = setInterval(tick, TICK_MS);
}

/* 閉じる。overrides = { reachedGoal?:true, completed?:true, reason?:string }
   呼び出し側へ渡る info は次の形:
     { elapsedMs, reachedGoal, reason?, completed? }
   ・reachedGoal は既定で実時間の判定（elapsedMs >= totalMs）
   ・reachedGoal:true は上げる方向だけ受ける（[十分すすんだ]）
   ・completed:true のときは reachedGoal を必ず false に落とす。
     完了と「はじめた」は別のことなので、両方は立てない。
     この不変条件は呼び出し元に任せず、ここ1か所で守る
   ・completed は true のときだけ付ける（既定では生えない） */
export function closeFocus(overrides) {
  if (!state) return;
  flushDrafts();                             // 書きかけを落とさない
  const s = state;
  state = null;                              // 先に落として二重呼び出しを防ぐ

  clearInterval(s.timer);
  s.timer = 0;
  document.removeEventListener('keydown', s.onKeydown, true);
  document.removeEventListener('focusin', s.onFocusin, true);
  document.removeEventListener('visibilitychange', s.onVisibility);
  s.root.remove();                           // 聞いている囲みも一緒に消える

  const elapsedMs = Date.now() - s.startedAt;
  /* **既定は false。**前は `elapsedMs >= totalMs` で時計が決めていたが、
     判定は押したボタンへ移した（利用者の指示）。時計は呼び名を変えるだけで、
     記録するかどうかには触らない。ここを時計に戻すと、また
     「4分でやめた人には何も残らない」が生える。 */
  const info = { elapsedMs, reachedGoal: false };
  const o = (overrides && typeof overrides === 'object') ? overrides : null;
  if (o) {
    if (o.reachedGoal === true) info.reachedGoal = true;
    if (o.completed === true) {
      info.completed = true;
      info.reachedGoal = false;              // 完了で「はじめた」を立てない
    }
    if (typeof o.reason === 'string' && o.reason) info.reason = o.reason;
  }

  if (s.prevFocus && typeof s.prevFocus.focus === 'function' &&
      document.contains(s.prevFocus)) {
    try { s.prevFocus.focus(); } catch (_) { /* 消えていたら何もしない */ }
  }
  if (s.onClose) s.onClose(info);
}

export function isFocusOpen() {
  return state !== null;
}

/* ---------- 抜けるとき ---------- */

/* 抜ける前に一度だけ「記録するか」を聞く。
   書きかけが何も無ければ聞かずにそのまま閉じる（毎回止めない）。 */
function requestClose(info) {
  if (!state) return;
  if (state.ask) return;                     // もう聞いている
  if (state.log && state.log.hasText()) { openAsk(info); return; }
  closeFocus(info);
}

/* 画面の中で聞く。confirm() は使わない（集中画面の外に飛ばさないため）。
   「記録する」「記録しない」の2択で、どちらを選んでも閉じる。
   記録しないほうを選んでも、打った文字は下書きとして残る（closeFocus の flushDrafts）。 */
function openAsk(info) {
  const canCommit = !!(state.log && state.log.canCommit());

  const node = el('div', 'focus-ask');
  node.tabIndex = -1;                        // 行き場が無いときの受け皿
  const panel = el('div', 'focus-ask-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'focus-ask-q');

  /* 淡々と。命令形にしない。件数も「何回目」も出さない */
  const q = el('p', 'focus-ask-q', escapeHtml('書いたものを記録しますか'));
  q.id = 'focus-ask-q';
  panel.appendChild(q);

  /* 押せない理由が分かること。叱らない言い方で */
  if (!canCommit) {
    const why = el('p', 'focus-ask-why', escapeHtml(NEXT_REQUIRED));
    why.id = 'focus-ask-why';
    panel.appendChild(why);
  }
  /* 捨てさせない、が伝わること */
  panel.appendChild(el('p', 'focus-ask-why',
    escapeHtml('記録しないときも、書いたものは下書きとして残ります')));

  const row = el('div', 'focus-ask-row');
  const no = el('button', 'btn focus-ask-no', '記録しない');
  no.type = 'button';
  const yes = el('button', 'focus-ask-yes', '記録する');
  yes.type = 'button';
  yes.disabled = !canCommit;
  if (!canCommit) yes.setAttribute('aria-describedby', 'focus-ask-why');
  row.appendChild(no);
  row.appendChild(yes);
  panel.appendChild(row);

  node.appendChild(panel);

  no.addEventListener('click', () => closeFocus(info));
  yes.addEventListener('click', () => {
    if (yes.disabled) return;
    if (state && state.log) state.log.commit();   // 積めなくても下書きは残る
    closeFocus(info);
  });

  state.ask = { node, info };
  state.root.appendChild(node);
  (canCommit ? yes : no).focus();
}

/* ---------- 中身 ---------- */

/* 1回分の更新。時刻は必ず Date.now() の差分から出す。
   出すのは**記録するボタンの呼び名**だけ（数字も輪も無い）。 */
function tick() {
  if (!state) return;
  const elapsed = Date.now() - state.startedAt;
  if (elapsed < state.totalMs || state.over) return;
  /* 5分を越えた。呼び名が「早く終わった」から「今日は終わり」へ変わる——
     これが、数字を出さずに越えたことを伝える唯一の合図 */
  state.over = true;
  state.root.classList.add('is-over');
  if (state.enough) state.enough.textContent = OVER_LB;
}

/* 待っている自動保存を、待たずに書き出す */
function flushDrafts() {
  if (state && state.log && typeof state.log.flush === 'function') {
    try { state.log.flush(); } catch (_) { /* 預け先が壊れていても閉じる */ }
  }
}

function isTextField(node) {
  const tag = node && node.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT';
}

/* 「5分だけ」。分が整数でなければ秒で言い換える */
function durationLabel(minutes) {
  if (Number.isInteger(minutes)) return minutes + '分';
  return Math.max(1, Math.round(minutes * 60)) + '秒';
}
const promiseLabel = (m) => durationLabel(m) + 'だけ';

/* 記録するボタンの呼び名。5分で入れ替わる（利用者の指示）。
   どちらを押しても記録は同じ——違うのは、そのとき自分がどこに居たかの言い方だけ。 */
const EARLY_LB = '早く終わった';
const OVER_LB = '今日は終わり';

/* http/https で始まらないものはリンクにしない（呼び出し側でも見ているが、ここでも守る） */
function safeUrl(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- 作業ログ（前回からの続き） ---------- */

/* アダプタの呼び出し。欠けていても壊れていても、集中画面は続ける */
function ask(a, name, ...args) {
  try {
    if (a && typeof a[name] === 'function') return a[name](...args);
  } catch (_) { /* 預け先が壊れていても集中は続ける */ }
  return undefined;
}

function fieldLabel(text) {
  return el('span', 'focus-label', escapeHtml(text));
}

/* 一手の記録。id とアダプタが無ければ何も作らない（従来どおりの集中画面になる） */
function buildWorklog(id, a) {
  if (id == null || id === '') return null;
  if (!a || typeof a !== 'object') return null;

  const node = el('section', 'focus-log');
  node.setAttribute('aria-label', '一手の記録');
  node.tabIndex = -1;                       // 記録したあとの行き先。Tab の順には入らない

  /* --- 最後になにをしてたか。書き損じだけ直せる（新しい記録は増やさない） --- */
  const lastWrap = el('div', 'focus-field');
  lastWrap.appendChild(fieldLabel('最後になにをしてたか'));
  const lastArea = document.createElement('textarea');
  lastArea.className = 'focus-input';
  lastArea.rows = 2;
  lastArea.setAttribute('aria-label', '最後になにをしてたか');
  lastWrap.appendChild(lastArea);
  node.appendChild(lastWrap);

  /* --- 開始の１手。表示だけ（編集経路は「次の一手」の1本だけにする） --- */
  const stepWrap = el('div', 'focus-field');
  stepWrap.appendChild(fieldLabel('開始の１手'));
  const stepText = el('p', 'focus-read is-step');
  stepWrap.appendChild(stepText);
  node.appendChild(stepWrap);

  /* --- リンク。表示だけ＋「開く」。http/https 以外は「開く」を出さない --- */
  const urlWrap = el('div', 'focus-field');
  urlWrap.appendChild(fieldLabel('リンク'));
  const urlRow = el('div', 'focus-read-row');
  const urlText = el('p', 'focus-read is-url');
  const urlOpen = el('a', 'btn focus-open', '開く');
  urlOpen.target = '_blank';
  urlOpen.rel = 'noopener noreferrer';
  urlRow.appendChild(urlText);
  urlRow.appendChild(urlOpen);
  urlWrap.appendChild(urlRow);
  node.appendChild(urlWrap);

  /* --- 作業メモ（今回なにをしてたか）。初期は空白 --- */
  const didWrap = el('div', 'focus-field');
  didWrap.appendChild(fieldLabel('作業メモ'));
  const didArea = document.createElement('textarea');
  didArea.className = 'focus-input';
  didArea.rows = 2;
  didArea.setAttribute('aria-label', '作業メモ');
  didWrap.appendChild(didArea);
  node.appendChild(didWrap);

  /* --- 次の一手。記録すると「開始の１手」になる --- */
  const nextWrap = el('div', 'focus-field');
  nextWrap.appendChild(fieldLabel('次の一手'));
  const nextInput = document.createElement('input');
  nextInput.type = 'text';
  nextInput.className = 'focus-input is-one';
  nextInput.autocomplete = 'off';
  nextInput.setAttribute('aria-label', '次の一手');
  nextWrap.appendChild(nextInput);

  /* なぜ「記録する」が押せないかが、欄の近くで分かること。
     叱らないよう、規則をそのまま置くだけにする（常に出す＝反応として出さない）。 */
  const nextHint = el('p', 'focus-hint', escapeHtml(NEXT_REQUIRED));
  nextHint.id = 'focus-next-hint';
  nextWrap.appendChild(nextHint);
  node.appendChild(nextWrap);

  /* --- 記録する。押したときにだけ1件積む --- */
  const commit = el('button', 'focus-commit', '記録する');
  commit.type = 'button';
  commit.setAttribute('aria-describedby', 'focus-next-hint');
  node.appendChild(commit);

  /* 積んだことだけを短く返す。件数も「何回目」も出さない */
  const said = el('p', 'focus-said');
  said.setAttribute('role', 'status');
  node.appendChild(said);

  /* --- 履歴（利用者の指示）---

     **入れ替えではなく、その場で開く**（盤は狭いので面ごと差し替えているが、
     こちらは縦にスクロールする囲みなので、開いて押しのけるほうが素直）。
     タイマーには触らない（追補2 §A）。

     置き場所は**「記録する」の下**。最初は「最後になにをしてたか」の隣に置いたが、
     開いた瞬間に 次の一手 と 記録する が画面の外へ出た（実測。240px でも足りない）。
     **この画面の仕事は書くほうで、履歴は読むための添えもの**なので、
     添えもののほうが下がる。ここなら開いても上の欄は動かない。

     記録が1件も無ければボタンごと出さない（押しても何も無い的を作らない）。
     記録したら、その場で組み直す（開いたまま増える）。 */
  const histBtn = el('button', 'focus-histbtn', '履歴');
  histBtn.type = 'button';
  histBtn.setAttribute('aria-expanded', 'false');
  histBtn.hidden = true;
  node.appendChild(histBtn);

  const histBox = el('div', 'focus-hist');
  histBox.setAttribute('role', 'group');
  histBox.setAttribute('aria-label', '履歴');
  histBox.hidden = true;
  node.appendChild(histBox);

  function stepsNow() {
    const rows = ask(a, 'steps', id);
    return Array.isArray(rows) ? rows : [];
  }

  /* 開いていれば中身を組み直す。ボタンの出し入れもここでやる */
  function syncHist() {
    const rows = stepsNow();
    histBtn.hidden = rows.length === 0;
    if (histBtn.hidden) { histBox.hidden = true; histBtn.setAttribute('aria-expanded', 'false'); }
    if (histBox.hidden) return;
    histBox.replaceChildren(stepList(rows));
  }

  histBtn.addEventListener('click', ev => {
    ev.preventDefault();
    const open = histBox.hidden;
    histBox.hidden = !open;
    histBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) histBox.replaceChildren(stepList(stepsNow()));
  });


  /* ---- 初期値 ---- */
  function loadLast() {
    const last = ask(a, 'lastStep', id);
    const has = !!(last && typeof last === 'object');
    lastWrap.hidden = !has;                 // 記録が1件も無ければ欄ごと出さない
    lastArea.value = has ? String(last.did == null ? '' : last.did) : '';
  }

  /* 「開始の１手」「リンク」はアダプタ側が正。記録した直後に変わるため */
  function loadRead() {
    const fs = String(ask(a, 'firstStep', id) || '').trim();
    stepText.textContent = fs;
    stepWrap.hidden = !fs;

    const raw = String(ask(a, 'url', id) || '').trim();
    urlText.textContent = raw;
    urlWrap.hidden = !raw;
    const href = safeUrl(raw);
    if (href) { urlOpen.href = href; urlOpen.hidden = false; }
    else { urlOpen.removeAttribute('href'); urlOpen.hidden = true; }
  }

  const draft = ask(a, 'draft', id) || {};
  didArea.value = String(draft.did == null ? '' : draft.did);
  nextInput.value = String(draft.next == null ? '' : draft.next);

  loadLast();
  loadRead();
  syncHist();

  /* ---- 下書きの自動保存（記録ではない） ---- */
  let draftTimer = 0;
  function saveDraft() {
    clearTimeout(draftTimer); draftTimer = 0;
    ask(a, 'saveDraft', id, { did: didArea.value, next: nextInput.value });
  }
  function queueDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, SAVE_MS);
  }

  /* 「次の一手」が空のときは記録できない。
     記録は必ず「次はここから」を持つ（git のように）。
     「作業メモ」は空でも押せる。 */
  function syncCommit() {
    commit.disabled = !nextInput.value.trim();
    nextHint.classList.toggle('is-blocking', commit.disabled);
  }
  syncCommit();

  [didArea, nextInput].forEach(nd => {
    nd.addEventListener('input', () => {
      said.textContent = '';
      syncCommit();
      queueDraft();
    });
    nd.addEventListener('blur', saveDraft);
  });

  /* ---- 書き損じ直し。打つたびには呼ばない ---- */
  let amendTimer = 0;
  function saveAmend() {
    clearTimeout(amendTimer); amendTimer = 0;
    if (lastWrap.hidden) return;            // 記録が無ければ直すものも無い
    ask(a, 'amendLast', id, { did: lastArea.value });
  }
  lastArea.addEventListener('input', () => {
    clearTimeout(amendTimer);
    amendTimer = setTimeout(saveAmend, SAVE_MS);
  });
  lastArea.addEventListener('blur', saveAmend);

  /* ---- 記録する ---- */
  /* 抜けるときの「記録する」からも同じ道を通る。戻り値は積めたかどうか */
  function doCommit() {
    const did = didArea.value.trim();
    const next = nextInput.value.trim();
    if (!next) return false;                // 押せないはずだが、ここでも守る

    /* 遅れて走る下書き保存が、記録したあとに書き戻さないように先に止める */
    clearTimeout(draftTimer); draftTimer = 0;
    clearTimeout(amendTimer); amendTimer = 0;

    /* 店側は next が空なら null を返す。ここでも受け止める */
    const rec = ask(a, 'commit', id, { did, next });
    if (!rec || typeof rec !== 'object') {
      saveDraft();                          // 積めなかった。打った文字は残す
      return false;
    }

    didArea.value = '';
    nextInput.value = '';
    lastWrap.hidden = false;
    lastArea.value = String(rec.did == null ? '' : rec.did);
    loadRead();                             // 「開始の１手」が新しい値になる
    syncHist();                             // 履歴も1件増える（開いていれば、その場で）
    syncCommit();
    said.textContent = '記録した';
    return true;
  }

  commit.addEventListener('click', () => {
    if (commit.disabled) return;
    doCommit();

    /* 押したボタンが押せなくなるので、フォーカスがページの外へ落ちないようにする。
       入力欄に移すとキーボードが上がってしまうので、ログの囲みで受ける */
    if (document.activeElement === commit || !node.contains(document.activeElement)) {
      node.focus();
    }
  });

  return {
    node,
    /* 抜けるときに聞くかどうかの判断。何か書いてあれば聞く */
    hasText() {
      return !!(didArea.value.trim() || nextInput.value.trim());
    },
    /* 記録できるか。次の一手が空なら記録できない */
    canCommit() {
      return !!nextInput.value.trim();
    },
    commit: doCommit,
    flush() {
      if (draftTimer) saveDraft();
      if (amendTimer) saveAmend();
    },
  };
}

/* ---------- 割り込んだ考えを海へ ---------- */

/* handler が無ければ何も作らない（行き先の無い入力欄を出さないため）。
   海の composer と同じ [入力欄][送信]。「やめる」の少し上に常設する。 */
function buildCapture(handler) {
  if (typeof handler !== 'function') return null;

  const node = el('div', 'focus-capture');

  const form = el('form', 'focus-composer');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'うかんだアイデア';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', '思いついたことを預ける');
  const send = el('button', 'focus-send', '送信');
  send.type = 'submit';
  send.disabled = true;                     // 空のときは送らない
  form.appendChild(input);
  form.appendChild(send);

  /* 預けたことだけを短く返す。件数も「あと何件」も出さない */
  const said = el('p', 'focus-said');
  said.setAttribute('role', 'status');

  node.appendChild(form);
  node.appendChild(said);

  input.addEventListener('input', () => {
    said.textContent = '';
    send.disabled = !input.value.trim();
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try { handler(text); } catch (_) { /* 預け先が壊れていても集中は続ける */ }
    input.value = '';
    send.disabled = true;
    said.textContent = '海にあずけた';
  });

  return { node };
}

/* ---------- フォーカスの閉じ込め ---------- */

/* 聞いている間は、その囲みの中だけを回す（後ろのボタンへ Tab で抜けさせない） */
function focusScope() {
  if (!state) return null;
  return state.ask ? state.ask.node : state.root;
}

function focusables() {
  const scope = focusScope();
  if (!scope) return [];
  const sel = 'a[href], button:not([disabled]), input:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(scope.querySelectorAll(sel))
    .filter(n => n.offsetParent !== null || n === document.activeElement);
}

function trapTab(ev) {
  const scope = focusScope();
  if (!scope) return;
  const list = focusables();
  if (!list.length) { ev.preventDefault(); scope.focus(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;

  if (ev.shiftKey) {
    if (active === first || !scope.contains(active)) { ev.preventDefault(); last.focus(); }
  } else {
    if (active === last || !scope.contains(active)) { ev.preventDefault(); first.focus(); }
  }
}
