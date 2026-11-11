/* ヘルプ画面（2026-11-04。利用者の指示 Issue #9）。

   設定の「ヘルプ」から開く。上に使い方の記事への目次（読むだけ）、下に AI（Anthropic・Claude）への
   チャット欄。入っているのは次の決めごと（README「AI に訊く」）：

     ・送るのは質問の文・この app の使い方の要約・版/画面 ID/件数だけ。バブルの本文は送らない
     ・会話は端末のメモリにだけ置く。この画面を閉じると消える（保存しない）
     ・API キーが無ければ、送る前に「設定に入れてください」と出す（質問は失わない）

   store・sync・feedback のどれも触らない。渡すのは呼び出し側（settings.js）から：
     opts = { getContext(), repo, app, version } */

import { el, escapeHtml, fromFeedback } from './ui.js';
import { ask, hasKey } from './ai.js';

/* 使い方の記事の目次と同じ並び（docs/guide/index.html の <nav class="toc">）。
   ここは読むだけのリンクなので、記事そのものは複製しない。リンク先が増えたら両方に足すこと。 */
const TOC = [
  ['screens', '画面の見方'],
  ['priority', '急ぐ・大事で分ける（優先度）'],
  ['space', '海を切り替える・つくる'],
  ['connect', '海域に繋ぐ（自分の端末）'],
  ['invited', '招かれた海に入る（招かれた人）'],
  ['offline', '繋がっていないとき'],
  ['host', '海域を立てる（持ち主）'],
  ['tokens', '招待とパスキーの管理'],
  ['csv', '引っ越し（CSV の書き出し・読み込み）'],
  ['security', '安全のための決まり'],
  ['faq', '困ったとき'],
];

/* AI に渡す「この app の使い方」の要約（1行）。README の冒頭の考え方だけを短く伝える。
   バブルの本文もタグ名も入れない——あくまで app の仕組みの説明。 */
const APP_SUMMARY = 'Bubbles は、思いついたことを泡として漂わせておく todo アプリ。'
  + '達成率・連続日数・ご褒美の演出は出さない。画面は 海(sea)・今日(today)・きっかけ(plan)・'
  + 'すきま(gap)・ふりかえり(review)・設定(settings) の6つ。海の泡はタップで中央の盤が開き、'
  + '次の一手・作業メモ・リンク・タグの付け外しができる。詳しい使い方は上の目次（docs/guide/）を見て答える。';

let root = null;   /* 開いているときの { back, box, ... } */

export function isOpen() { return !!root; }

export function closeHelp(restoreFocus) {
  if (!root) return false;
  const r = root;
  root = null;
  window.removeEventListener('keydown', r.onKey, true);
  r.back.remove();
  if (restoreFocus && r.was && r.was.isConnected) {
    try { r.was.focus({ preventScroll: true }); } catch (err) { /* 焦点は戻せなくてもよい */ }
  }
  return true;
}

/* よくある質問の例（押すと、そのまま訊く）。使い方の記事の目次と同じ範囲から */
const EXAMPLES = [
  '次の一手はどこで書く？',
  '長期保留の「もどってくる日」はどう使う？',
  '別の端末と記録を合わせるには？',
];

/* Issue の候補（2026-11-07。利用者の指示 Issue #28、案A）。
   返事のたびに、AI に「不具合らしい／仕様を見直したほうがよい」を判断させ、当たったときだけ
   返事の最後に決まった形の区切りを付けさせる。app はそれを返事から外して、会話の下に候補と
   [下書きを開く] を出す。押すと GitHub の新しい Issue の画面が下書き入りで開く（Create は人が押す）。
   追加の呼び出しはしない。送るものも増えない（指示の文が増えるだけ）。 */
const ISSUE_RULE = '\n\n返事の決まり: この会話から、この app の不具合（動きがおかしい）か、仕様を見直したほうがよい点'
  + '（使いにくい・分かりにくい・足りない）が読み取れるときだけ、返事の最後に次の形の区切りを1つ付ける。'
  + '使い方を訊かれただけで app に問題が無いとき・判断できないときは付けない。\n'
  + '<<<ISSUE\n種類: 不具合 または 仕様\n題名: 15〜40 字で何が問題か\n画面: 画面 ID（分からなければ空）\n'
  + '起きたこと: 1〜3 文\n期待したこと: 1〜3 文\n>>>\n'
  + '区切りの中身は公開の Issue になる。利用者が書いた泡の本文・名前・連絡先などは入れず、app の動きだけを書く。'
  + '区切りの外の返事は、いつもどおり利用者への答えだけを書く。';

/* 返事から Issue の候補の区切りを外す。
   返すのは { text: 区切りを外した返事, issue: { kind: 'bug'|'spec', title, screen, happened, expected } | null }。
   区切りが壊れている・題名が無いときは候補なし（区切りらしき行は返事からは外す） */
export function splitIssue(reply) {
  const s = String(reply || '').replace(/\r\n?/g, '\n');
  const m = s.match(/<<<ISSUE[ \t]*\n([\s\S]*?)\n?>>>/);
  if (!m) return { text: s.replace(/<<<ISSUE[\s\S]*$/, '').trim(), issue: null };
  const text = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  const f = {};
  let cur = null;
  m[1].split('\n').forEach(line => {
    const k = line.match(/^\s*(種類|題名|画面|起きたこと|期待したこと)\s*[:：]\s*(.*)$/);
    if (k) { cur = k[1]; f[cur] = k[2].trim(); }
    else if (cur && line.trim()) f[cur] += (f[cur] ? '\n' : '') + line.trim();
  });
  const title = (f['題名'] || '').replace(/\s+/g, ' ').trim();
  if (!title) return { text, issue: null };
  return {
    text,
    issue: {
      kind: /仕様/.test(f['種類'] || '') ? 'spec' : 'bug',
      title: [...title].length > 60 ? [...title].slice(0, 60).join('') + '…' : title,
      screen: (f['画面'] || '').replace(/[^\w-]/g, '').slice(0, 30),
      happened: f['起きたこと'] || '',
      expected: f['期待したこと'] || '',
    },
  };
}

/* 候補から、Issue のコメント欄に入れる文を作る（元の質問も添える） */
export function issueDraft(issue, question) {
  const L = ['AI に訊いた内容から（AI が' + (issue.kind === 'spec' ? '仕様の見直し' : '不具合') + 'と判断した下書き）:', ''];
  if (issue.screen) L.push('画面: ' + issue.screen, '');
  if (issue.happened) L.push('起きたこと: ' + issue.happened, '');
  if (issue.expected) L.push('期待したこと: ' + issue.expected, '');
  if (question) L.push('元の質問: ' + question);
  return L.join('\n').trim();
}

/* AI の返事の Markdown の飾り（**太字**・# 見出し・`コード`・行頭の - * ）を落として、素の文にする。
   HTML としては扱わない（textContent で出す）——飾りの記号が残って読みにくいのを直すだけ */
export function plainReply(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '・')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* opts = { getContext() -> { summary }, repo, app, version, was } */
export function openHelp(opts) {
  const o = opts || {};
  if (root) closeHelp(false);

  const back = el('div', 'help-back');
  const box = el('div', 'help has-chat');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'ヘルプ');
  box.dataset.screen = 'help'; box.dataset.screenLayer = '7';

  const head = el('div', 'help-head');
  head.appendChild(el('span', 'tt', 'ヘルプ'));
  const closeBtn = el('button', 'cl', '閉じる');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeHelp(true));
  head.appendChild(closeBtn);
  box.appendChild(head);

  /* 中身（目次＋会話）だけが流れ、見出しと入力欄は板の上下に留まる */
  const scroller = el('div', 'help-scroll');
  box.appendChild(scroller);

  /* ---- 使い方の目次（読むだけ。畳める。会話が始まったら畳む） ---- */
  const tocBox = document.createElement('details');
  tocBox.className = 'help-toc';
  tocBox.open = true;
  const tocSum = document.createElement('summary');
  tocSum.textContent = '使い方の記事（' + TOC.length + '）';
  tocBox.appendChild(tocSum);
  const tocList = el('ul', 'help-toclist');
  TOC.forEach(([id, label]) => {
    const li = document.createElement('li');
    const a = el('a', null, escapeHtml(label));
    a.href = 'docs/guide/index.html#' + id;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
    tocList.appendChild(li);
  });
  tocBox.appendChild(tocList);
  scroller.appendChild(tocBox);

  /* ---- チャット（会話はメモリにだけ。閉じると消える） ---- */
  const chatBox = el('div', 'help-chat');
  chatBox.appendChild(el('h3', null, 'AI に訊く'));
  chatBox.appendChild(el('p', 'note',
    '送るのは質問の文とこの app の説明・版・画面だけ（バブルの本文は送らない）。会話は閉じると消える。'));

  /* キーが無いときは、入力欄の前に「どこで入れるか」をはっきり出す（打ってから断られないように） */
  if (!hasKey()) {
    chatBox.appendChild(el('p', 'help-nokey',
      'API キーがまだ入っていない。設定の「AI を使う設定をする」で AI の会社を選び、その API キーを入れると訊ける。'));
  }

  /* 例の質問（会話がまだ無いときだけ出す） */
  const examples = el('div', 'help-examples');
  EXAMPLES.forEach(q => {
    const b = el('button', 'help-ex');
    b.type = 'button';
    b.textContent = q;
    b.disabled = !hasKey();
    b.addEventListener('click', () => { input.value = q; form.requestSubmit(); });
    examples.appendChild(b);
  });
  chatBox.appendChild(examples);

  const log = el('div', 'help-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  chatBox.appendChild(log);
  scroller.appendChild(chatBox);

  const history = [];   /* { role, content } の配列。メモリにだけ。閉じたら破棄 */

  /* ---- 下に留まる欄（入力・送る・Issue） ---- */
  const foot = el('div', 'help-foot');
  const form = el('form', 'help-form');
  const input = document.createElement('textarea');
  input.rows = 1;
  input.placeholder = hasKey() ? '質問を書く' : 'キーを入れると訊ける';
  input.title = 'Enter で改行、⌘/Ctrl+Enter で送る';
  input.setAttribute('aria-label', 'AI への質問');
  input.disabled = !hasKey();
  const send = el('button', 'btn help-send', '送る');
  send.type = 'submit';
  form.appendChild(input);
  form.appendChild(send);
  foot.appendChild(form);

  /* 会話ができてから出す（それまでは押しても何もできないので見せない） */
  const issueRow = el('div', 'help-issuerow');
  issueRow.hidden = true;
  const issueBtn = el('button', 'help-link', 'この会話から改善の Issue を書く');
  issueBtn.type = 'button';
  const issueMsg = el('span', 'help-issuemsg');
  issueMsg.setAttribute('role', 'status');
  issueRow.appendChild(issueBtn);
  issueRow.appendChild(issueMsg);
  foot.appendChild(issueRow);
  box.appendChild(foot);

  back.appendChild(box);
  back.addEventListener('pointerdown', ev => { if (ev.target === back) closeHelp(true); });

  const onKey = ev => {
    if (ev.key !== 'Escape' || fromFeedback(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeHelp(true);
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  root = { back, box, onKey, was: o.was };

  function scrollDown() { scroller.scrollTop = scroller.scrollHeight; }

  function addBubble(role, text) {
    const b = el('p', 'help-msg is-' + role);
    b.textContent = text;            /* 利用者の文・AI の返事。innerHTML には入れない */
    log.appendChild(b);
    scrollDown();
    return b;
  }

  /* 待っている間の印（3つの点。動きを減らす設定なら止まった点） */
  function addWaiting() {
    const b = el('p', 'help-msg is-ai is-wait');
    b.setAttribute('aria-label', '返事を待っている');
    for (let i = 0; i < 3; i++) b.appendChild(el('span', 'dot'));
    log.appendChild(b);
    scrollDown();
    return b;
  }

  /* 失敗したとき。質問は入力欄に戻し、「もう一度」で同じ質問を送り直せる */
  function addError(msg, text) {
    const b = el('div', 'help-msg is-system is-error');
    const p = el('span');
    p.textContent = msg;
    b.appendChild(p);
    const retry = el('button', 'help-link', 'もう一度送る');
    retry.type = 'button';
    retry.addEventListener('click', () => { b.remove(); input.value = text; form.requestSubmit(); });
    b.appendChild(retry);
    log.appendChild(b);
    scrollDown();
  }

  /* 入力欄は中身に合わせて伸びる（5行まで） */
  function fit() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  }
  input.addEventListener('input', fit);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  function systemPrompt() {
    const ctx = (() => { try { return (o.getContext && o.getContext()) || {}; } catch (err) { return {}; } })();
    return APP_SUMMARY + '\n今の状態: ' + (ctx.summary || '') + ISSUE_RULE;
  }

  /* GitHub の新しい Issue の画面を、書き込んだ状態で開く（右上の ! と同じ仕組み）。
     押した操作の中で開く（後回しにするとポップアップとして止められる） */
  async function openIssue(comment, title, msgEl) {
    if (!window.AppFeedback) return;
    const payload = {
      screen: 'help', comment, title: title || '', app: o.app, version: o.version,
      at: new Date().toISOString(), context: null, screenshot: null,
    };
    const url = window.AppFeedback.newIssueUrl(o.repo, payload);
    window.open(url, '_blank', 'noopener');
    /* iPhone の GitHub アプリが空欄で開くことがある件への備え（Issue #5 と同じ仕組み） */
    try {
      await navigator.clipboard.writeText(
        window.AppFeedback.issueTitle(payload) + '\n\n' + window.AppFeedback.issueBody(payload));
      msgEl.textContent = 'GitHub を開いた。書けないときは、コピーした題名・本文を貼り付けてください。';
    } catch (err) { msgEl.textContent = 'GitHub を開いた。'; }
  }

  /* AI が不具合・仕様の見直しと判断したときだけ、会話の中に候補を出す */
  function addCandidate(issue, question) {
    const b = el('div', 'help-msg is-system help-cand');
    const p = el('span', 'help-cand-t');
    p.textContent = 'Issue にする候補（' + (issue.kind === 'spec' ? '仕様の見直し' : '不具合') + '）: ' + issue.title;
    b.appendChild(p);
    const open = el('button', 'help-link', '下書きを開く');
    open.type = 'button';
    const msg = el('span', 'help-issuemsg');
    msg.setAttribute('role', 'status');
    open.addEventListener('click', () => openIssue(issueDraft(issue, question), issue.title, msg));
    b.appendChild(open);
    b.appendChild(msg);
    b.appendChild(el('span', 'help-cand-n', '開くのは GitHub の画面まで。中身を直してから Create を押すと Issue になる（公開）'));
    log.appendChild(b);
    scrollDown();
  }

  let busy = false;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy) return;
    const text = input.value.trim();
    if (!text) return;
    if (!hasKey()) {
      addBubble('system', 'API キーが入っていない。設定の「AI を使う設定をする」で入れてから訊いてください。');
      return;
    }
    /* 会話が始まったら、目次と例は畳む（会話の場所を広く使う） */
    tocBox.open = false;
    examples.hidden = true;
    addBubble('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    fit();
    busy = true;
    send.disabled = true;
    send.textContent = '待っている…';
    const waiting = addWaiting();
    try {
      const reply = await ask(systemPrompt(), history);
      waiting.remove();
      const { text: shown, issue } = splitIssue(reply);
      addBubble('ai', plainReply(shown) || '（返事が空だった）');
      history.push({ role: 'assistant', content: shown || '' });   /* 区切りは会話の続きに入れない */
      if (issue) addCandidate(issue, text);
      issueRow.hidden = false;
    } catch (err) {
      waiting.remove();
      history.pop();                         /* 届かなかった質問は、会話の続きに入れない */
      log.lastChild && log.lastChild.classList.contains('is-user') && log.lastChild.remove();
      addError((err && err.message) || '届かなかった', text);
    } finally {
      busy = false;
      send.disabled = false;
      send.textContent = '送る';
      if (root) input.focus();
    }
  });

  /* 人が判断して書くとき（AI の候補が出なくても使える） */
  issueBtn.addEventListener('click', () => {
    const lastUser = history.filter(h => h.role === 'user').slice(-1)[0];
    const lastAi = history.filter(h => h.role === 'assistant').slice(-1)[0];
    const lines = ['AI に訊いた内容から:', '', '質問: ' + ((lastUser && lastUser.content) || '')];
    if (lastAi) lines.push('', '返事: ' + lastAi.content);
    openIssue(lines.join('\n'), '', issueMsg);
  });

  /* 開いた直後は入力欄に焦点を置かない（スマホでキーボードが出て、目次と例が隠れるため）。
     焦点は見出しの「閉じる」へ。会話を始めてからは入力欄へ戻す */
  setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* そのまま */ } }, 0);
  return true;
}
