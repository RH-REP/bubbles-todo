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
  ['space', '個人と共有'],
  ['connect', 'サーバーに繋ぐ（自分の端末）'],
  ['invited', '共有の海に入る（招かれた人）'],
  ['offline', '繋がっていないとき'],
  ['host', 'サーバーを立てる（持ち主）'],
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

/* opts = { getContext() -> { summary }, repo, app, version, was } */
export function openHelp(opts) {
  const o = opts || {};
  if (root) closeHelp(false);

  const back = el('div', 'help-back');
  const box = el('div', 'help');
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

  /* ---- 使い方の目次（読むだけ） ---- */
  const tocBox = el('div', 'help-toc');
  tocBox.appendChild(el('h3', null, '使い方の記事'));
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
  box.appendChild(tocBox);

  /* ---- チャット（会話はメモリにだけ。閉じると消える） ---- */
  const chatBox = el('div', 'help-chat');
  chatBox.appendChild(el('h3', null, 'AI に訊く'));
  chatBox.appendChild(el('p', 'note',
    '使い方や、不具合っぽい動きについて尋ねられる。送るのは質問の文とこの app の説明・版・画面だけ。'
    + 'バブルの本文は送らない。会話はこの画面を閉じると消える。'));

  const log = el('div', 'help-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  chatBox.appendChild(log);

  const history = [];   /* { role, content } の配列。メモリにだけ。閉じたら破棄 */

  const form = el('form', 'help-form');
  const input = document.createElement('textarea');
  input.rows = 2;
  input.placeholder = hasKey() ? '質問を書く' : 'API キーを設定に入れると訊ける';
  input.setAttribute('aria-label', 'AI への質問');
  const send = el('button', 'btn help-send', '送る');
  send.type = 'submit';
  form.appendChild(input);
  form.appendChild(send);
  chatBox.appendChild(form);

  const issueRow = el('div', 'help-issuerow');
  const issueBtn = el('button', 'btn', 'この内容で改善の Issue を書く');
  issueBtn.type = 'button';
  issueBtn.disabled = true;   /* 会話が無いうちは押せない */
  issueRow.appendChild(issueBtn);
  chatBox.appendChild(issueRow);

  box.appendChild(chatBox);
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

  function addBubble(role, text) {
    const b = el('p', 'help-msg is-' + role);
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function systemPrompt() {
    const ctx = (() => { try { return (o.getContext && o.getContext()) || {}; } catch (err) { return {}; } })();
    return APP_SUMMARY + '\n今の状態: ' + (ctx.summary || '');
  }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (!hasKey()) {
      addBubble('system', 'API キーが入っていない。設定の「ヘルプ」で入れてから訊いてください。');
      return;
    }
    addBubble('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    send.disabled = true;
    const waiting = addBubble('ai', '…');
    try {
      const reply = await ask(systemPrompt(), history);
      waiting.textContent = reply || '（返事が空だった）';
      history.push({ role: 'assistant', content: reply || '' });
      issueBtn.disabled = false;
    } catch (err) {
      waiting.remove();
      addBubble('system', (err && err.message) || '届かなかった');
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  const issueMsg = el('p', 'note');
  chatBox.appendChild(issueMsg);

  issueBtn.addEventListener('click', async () => {
    if (!window.AppFeedback) return;
    const lastUser = history.filter(h => h.role === 'user').slice(-1)[0];
    const lastAi = history.filter(h => h.role === 'assistant').slice(-1)[0];
    const lines = ['AI に訊いた内容から:', '', '質問: ' + ((lastUser && lastUser.content) || '')];
    if (lastAi) lines.push('', '返事: ' + lastAi.content);
    const payload = {
      screen: 'help', comment: lines.join('\n'), app: o.app, version: o.version,
      at: new Date().toISOString(), context: null, screenshot: null,
    };
    const url = window.AppFeedback.newIssueUrl(o.repo, payload);
    window.open(url, '_blank', 'noopener');
    /* iPhone の GitHub アプリが空欄で開くことがある件への備え（Issue #5 と同じ仕組み） */
    try {
      await navigator.clipboard.writeText(
        window.AppFeedback.issueTitle(payload) + '\n\n' + window.AppFeedback.issueBody(payload));
      issueMsg.textContent = 'GitHub を開いた。書けないときは、コピーした題名・本文を貼り付けてください。';
    } catch (err) { issueMsg.textContent = 'GitHub を開いた。'; }
  });

  setTimeout(() => input.focus(), 0);
  return true;
}
