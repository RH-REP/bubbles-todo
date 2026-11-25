/* 集中オーバーレイ「5分だけはじめる」

   目の前の1件だけを残して、他を全部消すための画面。
   件数も進捗も他のタスクも出さない。中断させないことがこの部品の仕事。

   決めごと（変えないこと）:
   - 5分が過ぎても「あと5分？」と聞かない。聞いた瞬間に5分の約束が嘘になる。
   - 過ぎたらカウントダウンをやめ、経過時間のカウントアップに切り替える。
     続けるなら手を止めなければいいだけ、という態度にする。
   - タイマーは止まらない。記録しても、書いても、止まらない。停止ボタンは作らない。
   - 命令形にしない。淡々と。
   - 件数・回数・「何回目」を出さない。

   **時計は出す**（利用者の指示 2026-09-11）。01dd00f で外した数字と輪を戻した。
   ポモドーロとして使う以上、残りが見えないと時間を区切る道具にならない、という判断。

   **ただし判定は時計に戻さない。**01dd00f が時計と記録を切り離したのは、
   `reachedGoal = elapsedMs >= totalMs` だと4分でやめた人に何も残らない
   ——分母を書かないだけの達成条件になるためで、その理屈はいまも生きている。
   時計は**見せるだけ**。「はじめた」を立てるのは押したボタンで、
   closeFocus の reachedGoal の既定は false のまま。ここを時計に戻すと同じ穴が開く。

   ポモドーロの回数は**内部にだけ残す**（利用者の指示：方向転換に備える）。
   預け先は setSessionHandler() で外から差してもらい、ここでも store は触らない。
   画面には出さない——出す口を作るときは、上の「件数・回数・何回目を出さない」と
   突き合わせること。

   抜ける道は3つ。どれも onClose(info) の中身だけで伝える:
   - [早く終わった] / [今日は終わり] … 同じ1つのボタン。呼び名だけが5分で変わる。
     どちらでも「はじめた」を立てる。{ reachedGoal: true, reason: 'enough' }
   - [やめる] … 閉じるだけ。**何も記録しない**（経過時間に関係なく）。{ reason: 'stop' }
   - [完了] … もうこれに着手する必要が無くなった。完了の海へ移る。
     { reachedGoal: false, completed: true, reason: 'done' }
     完了と「はじめた」は別のこと。両方は立てない（closeFocus が reachedGoal を落とす）。
     音も store も呼び出し側の仕事。ここでは鳴らさないし触らない。取り消しも呼び出し側。
   2026-11-24 利用者の指示「始めるの中が洗練されていない 不要なものを減らして洗練して」:
   作業記録の欄は盤と同じ 1 つ（作業記録）にした。前の 最後になにをしてたか・開始の１手・
   リンクの字・作業メモ・次の一手・［記録する］と、抜けるときの「記録するか」の問いは外した。
   作業記録は盤と同じく、欄から離れたとき・閉じたときに書き、変わっていれば履歴に 1 件積む。

   store は一切触らない。着手の記録は呼び出し側が済ませてから開く。
   「書く」も作業ログも同じで、預け先は setCaptureHandler() /
   setWorklogHandler() で外から差してもらう。 */

import { el, escapeHtml, fromFeedback } from './ui.js';
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
     detail(id),                   // 作業記録（盤の欄と同じ中身）
     setDetail(id, text),          // 作業記録を書く（履歴には積まない）
     firstStep(id),                // 作業記録が空の前の泡で、初めの中身にする
     url(id),                      // 文字列。題の下の［開く ›］
     commit(id, {did, next}),      // 履歴に 1 件積む（next＝1 行目＝次にやること）
     steps(id), editStep(id, at, v) // 作業記録の履歴（盤と共通の一覧）
   }
   差されていなければ作業記録の欄は一切出さない（従来どおりの集中画面になる）。 */
let worklogAdapter = null;
export function setWorklogHandler(a) {
  worklogAdapter = (a && typeof a === 'object') ? a : null;
}

/* 1回ぶんの集中の控え（＝ポモドーロの回数）の預け先。app.js が起動時に1回差す。
   closeFocus が閉じぎわに1回だけ呼ぶ。**画面には出さない**（利用者の指示：
   内部にだけ残して方向転換に備える）。差されていなければ何も起きない——
   控えが取れないことで集中画面の動きが変わってはいけない。 */
let sessionHandler = null;
export function setSessionHandler(fn) {
  sessionHandler = typeof fn === 'function' ? fn : null;
}

/* 開始時刻からの実時間で数える。setInterval の回数では数えない。
   タブが裏に回ると setInterval は1秒単位に間引かれ、回数で数えると狂うため。 */
const TICK_MS = 250;

/* 下書き（と書き損じ直し）の自動保存の間合い。打つたびには書かない。
   plan.js の SAVE_MS と同じ値にしてある。 */
const SAVE_MS = 400;

const RING_R = 54;                          // css/focus.css の viewBox に合わせてある
const RING_C = 2 * Math.PI * RING_R;

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
  root.dataset.screen = 'focus'; root.dataset.screenLayer = '7';
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

  /* 次にやることは、作業記録の欄があるときはその 1 行目が受け持つ（同じ字を 2 度出さない）。
     リンクは字を出さず［開く ›］だけ（2026-11-24。URL の字は読まない） */
  if (!log && firstStep) head.appendChild(el('p', 'focus-step', escapeHtml(firstStep)));
  if (href) {
    const a = el('a', 'focus-link', '開く ›');
    a.href = href;                          // 属性ではなくプロパティで入れる
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'リンクを開く');
    head.appendChild(a);
  }
  scroll.appendChild(head);

  /* 残り時間とリング。作業ログがあるときは上に貼り付く（下までスクロールしても見える） */
  const timer = el('div', 'focus-timer');
  const dial = el('div', 'focus-dial');
  const { svg, arc } = buildRing();
  dial.appendChild(svg);

  const timeNode = el('div', 'focus-time');
  timeNode.setAttribute('aria-hidden', 'true');   // 毎秒の読み上げを避ける
  dial.appendChild(timeNode);
  timer.appendChild(dial);

  /* 状態の一言。読み上げはここだけ（切り替わりは2回しか起きない） */
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
    root, timeNode, noteNode, arc, enough, stop,
    id,                                     // 控え（ポモドーロの回数）の宛先。表示には使わない
    startedAt: Date.now(),
    totalMs, minutes,
    onClose,
    capture, log,
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
    if (!state || fromFeedback(ev)) return;   /* 右上の ! の欄。Escape で集中を閉じない・Tab を奪わない */
    if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
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

  /* 背後の要素にフォーカスが抜けたら引き戻す */
  state.onFocusin = (ev) => {
    if (!state || fromFeedback(ev)) return;   /* ! の欄へ移った焦点は引き戻さない（引き戻すと打てない） */
    const scope = state.root;
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
  s.root.remove();

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

  /* 1回ぶんの控え。**onClose より先に、閉じぎわに1回だけ。**
     `full` は時計が見た事実（約束の長さに届いたか）で、`reachedGoal`（押したボタンが
     立てた記録）とは別物。ここで両者を混ぜないのが 01dd00f の要点なので、
     控えのほうにも両方そのまま入れて、読む側が選べるようにしてある。 */
  reportSession(s, info);

  if (s.prevFocus && typeof s.prevFocus.focus === 'function' &&
      document.contains(s.prevFocus)) {
    try { s.prevFocus.focus(); } catch (_) { /* 消えていたら何もしない */ }
  }
  if (s.onClose) s.onClose(info);
}

export function isFocusOpen() {
  return state !== null;
}

/* 控えを預ける。**画面には出さない**（利用者の指示：内部にだけ残す）。
   預け先が無くても、投げた先が壊れても、集中画面の閉じ方は変わらない。 */
function reportSession(s, info) {
  if (!sessionHandler) return;
  try {
    sessionHandler({
      id: s.id,                              // 無いこともある（todo.js は id を渡さない）
      at: s.startedAt,
      ms: info.elapsedMs,
      minutes: s.minutes,
      full: info.elapsedMs >= s.totalMs,     // 時計が見た事実。記録の判定ではない
      reachedGoal: info.reachedGoal === true,
      completed: info.completed === true,
      reason: typeof info.reason === 'string' ? info.reason : '',
    });
  } catch (err) {
    console.error(err);                      // 控えが取れないだけ。閉じるのは続ける
  }
}

/* ---------- 抜けるとき ---------- */

/* 抜ける。作業記録は閉じぎわに書く（closeFocus の flushDrafts）ので、聞かずに閉じる */
function requestClose(info) {
  if (!state) return;
  closeFocus(info);
}

/* ---------- 中身 ---------- */

/* 1回分の更新。時刻は必ず Date.now() の差分から出す。
   出すのは**残り時間・輪・状態の一言・記録するボタンの呼び名**。
   どれも見せるだけで、記録が増えるかどうかには触らない（判定は押したボタン）。 */
function tick() {
  if (!state) return;
  const elapsed = Date.now() - state.startedAt;
  const remain = state.totalMs - elapsed;

  if (remain > 0) {
    state.timeNode.textContent = mmss(Math.ceil(remain / 1000));
    if (state.arc) {
      state.arc.setAttribute('stroke-dashoffset',
        String(RING_C * (1 - remain / state.totalMs)));
    }
    return;
  }

  // 5分を過ぎたら経過時間のカウントアップへ。選択肢は出さない
  state.timeNode.textContent = '+' + mmss(Math.floor(elapsed / 1000));
  if (state.arc) state.arc.setAttribute('stroke-dashoffset', '0');
  if (state.over) return;

  /* 越えたときだけ1回。見た目と呼び名が変わる。
     呼び名の入れ替えは 01dd00f が入れたもので、時計を戻しても残す——
     押す前に**そのボタンが何を意味するか**が変わるのは、数字とは別の情報なので。 */
  state.over = true;
  state.root.classList.add('is-over');
  state.noteNode.textContent = passedLabel(state.minutes);
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

function mmss(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

/* 「5分だけ」。分が整数でなければ秒で言い換える */
function durationLabel(minutes) {
  if (Number.isInteger(minutes)) return minutes + '分';
  return Math.max(1, Math.round(minutes * 60)) + '秒';
}
const promiseLabel = (m) => durationLabel(m) + 'だけ';
const passedLabel = (m) => durationLabel(m) + 'は過ぎました';

/* 記録するボタンの呼び名。5分で入れ替わる（利用者の指示）。
   どちらを押しても記録は同じ——違うのは、そのとき自分がどこに居たかの言い方だけ。 */
const EARLY_LB = '終わった';
const OVER_LB = '今日はここまで';

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

/* 進捗のリング。装飾なので、作れなくても本体は動く */
function buildRing() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'focus-ring');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('class', 'track');
  track.setAttribute('cx', '60'); track.setAttribute('cy', '60');
  track.setAttribute('r', String(RING_R));

  const arc = document.createElementNS(NS, 'circle');
  arc.setAttribute('class', 'arc');
  arc.setAttribute('cx', '60'); arc.setAttribute('cy', '60');
  arc.setAttribute('r', String(RING_R));
  arc.setAttribute('stroke-dasharray', String(RING_C));
  arc.setAttribute('stroke-dashoffset', '0');

  svg.appendChild(track);
  svg.appendChild(arc);
  return { svg, arc };
}

/* ---------- 作業ログ（前回からの続き） ---------- */

/* アダプタの呼び出し。欠けていても壊れていても、集中画面は続ける */
function ask(a, name, ...args) {
  try {
    if (a && typeof a[name] === 'function') return a[name](...args);
  } catch (_) { /* 預け先が壊れていても集中は続ける */ }
  return undefined;
}

/* 作業記録の 1 行目（＝次にやること）。bubble.js の firstLineOf と同じ */
function firstLineOf(t) {
  return String(t == null ? '' : t).split('\n').map(x => x.trim()).find(Boolean) || '';
}

/* 作業記録（2026-11-24。盤の作業記録と同じ 1 つの欄）。
   id とアダプタが無ければ何も作らない（従来どおりの集中画面になる）。
   ・中身は盤と同じ本文（detail）。作業記録が空で次にやることだけある前の泡は、それを初めの中身にする
   ・打っている間は本文だけ書く（SAVE_MS おき。履歴は増やさない）
   ・欄から離れたとき・閉じたとき・裏に回ったときは本文と次にやること（1 行目）だけ書く。履歴には積まない
   ・履歴に積むのは欄の下の［記録する］を押したときだけ（2026-11-26 ユーザーの指示。盤と同じ）。
     最後に積んだ中身と違うときだけ押せる。空にしたときは積まない
   ・見出しの行に［履歴を見る ›］（記録があるときだけ）。開くと欄の下に盤と共通の一覧 */
function buildWorklog(id, a) {
  if (id == null || id === '') return null;
  if (!a || typeof a !== 'object') return null;
  if (typeof a.setDetail !== 'function') return null;   /* 書く口の無い版では出さない */

  const node = el('section', 'focus-log');
  node.setAttribute('aria-label', '作業記録');

  const headRow = el('div', 'focus-lb-row');
  headRow.appendChild(el('span', 'focus-label', '作業記録'));
  const histBtn = el('button', 'focus-histbtn', '履歴を見る ›');
  histBtn.type = 'button';
  histBtn.setAttribute('aria-expanded', 'false');
  histBtn.hidden = true;
  headRow.appendChild(histBtn);
  node.appendChild(headRow);

  const area = document.createElement('textarea');
  area.className = 'focus-input';
  area.rows = 4;
  area.placeholder = '1 行目が次にやること';
  area.setAttribute('aria-label', '作業記録（1 行目が次にやること）');
  node.appendChild(area);

  const recRow = el('div', 'focus-rec-row');
  const recNote = el('span', 'focus-rec-note');
  recNote.setAttribute('aria-live', 'polite');
  const recBtn = el('button', 'focus-recbtn', '記録する');
  recBtn.type = 'button';
  recBtn.setAttribute('aria-label', '作業記録を履歴に残す');
  recRow.appendChild(recNote);
  recRow.appendChild(recBtn);
  const canCommit = typeof a.commit === 'function';
  if (canCommit) node.appendChild(recRow);

  const histBox = el('div', 'focus-hist');
  histBox.setAttribute('role', 'group');
  histBox.setAttribute('aria-label', '作業記録の履歴');
  histBox.hidden = true;
  node.appendChild(histBox);

  function stepsNow() {
    const rows = ask(a, 'steps', id);
    return Array.isArray(rows) ? rows : [];
  }
  const onEditStep = (typeof a.editStep === 'function')
    ? ((at, entry) => {
      if (ask(a, 'editStep', id, at, entry) === false) return false;
      syncHist();
      return true;
    })
    : null;
  function syncHist() {
    const rows = stepsNow();
    histBtn.hidden = rows.length === 0;
    if (histBtn.hidden) { histBox.hidden = true; histBtn.setAttribute('aria-expanded', 'false'); }
    histBtn.textContent = histBox.hidden ? '履歴を見る ›' : '履歴を閉じる';
    if (histBox.hidden) return;
    histBox.replaceChildren(stepList(rows, onEditStep));
  }
  histBtn.addEventListener('click', ev => {
    ev.preventDefault();
    histBox.hidden = !histBox.hidden;
    histBtn.setAttribute('aria-expanded', histBox.hidden ? 'false' : 'true');
    syncHist();
  });

  /* 初めの中身。wrote0 は最後に本文へ書いた中身、rec0 は最後に履歴へ積んだ中身（［記録する］が比べる） */
  let wrote0 = String(ask(a, 'detail', id) || '') || String(ask(a, 'firstStep', id) || '');
  area.value = wrote0;
  const lastRow = stepsNow().slice(-1)[0];
  let rec0 = lastRow ? String(lastRow.did || '') : '';
  syncHist();

  let timer = 0, noteTimer = 0;
  function writeDetail() {
    clearTimeout(timer); timer = 0;
    ask(a, 'setDetail', id, area.value);
  }
  function syncRec() {
    const v = area.value.trim();
    const can = !!v && v !== rec0.trim();
    recBtn.disabled = !can;
    recBtn.title = can ? '今の作業記録を履歴に残す' : (v ? '最後に記録したときから変わっていない' : '作業記録が空');
  }
  /* 離れる・閉じる: 本文と次にやること（1 行目）だけ。履歴には積まない */
  function save() {
    writeDetail();
    const v = area.value.trim();
    if (v === wrote0.trim()) return;
    if (v) ask(a, 'setFirstStep', id, firstLineOf(v));
    wrote0 = area.value;
  }
  function record() {
    save();
    const v = area.value.trim();
    if (!v || v === rec0.trim()) { syncRec(); return; }
    if (!ask(a, 'commit', id, { did: v, next: firstLineOf(v) })) return;
    rec0 = area.value;
    syncHist();
    syncRec();
    recNote.textContent = '記録した';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { recNote.textContent = ''; }, 1600);
  }
  recBtn.addEventListener('pointerdown', ev => ev.preventDefault());   /* 押しても欄の焦点を外さない */
  recBtn.addEventListener('click', ev => { ev.preventDefault(); record(); });
  syncRec();
  area.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(writeDetail, SAVE_MS);
    syncRec();
  });
  area.addEventListener('blur', save);

  return { node, flush: save };
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
  input.placeholder = '思いついたこと';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', '思いついたことを預ける');
  const send = el('button', 'focus-send', '海に入れる');
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
    said.textContent = '海に入れた';
  });

  return { node };
}

/* ---------- フォーカスの閉じ込め ---------- */

function focusScope() {
  return state ? state.root : null;
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
