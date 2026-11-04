/* AI（Anthropic Claude）に問い合わせる薄い層（2026-11-04。Issue #9）。

   ■ 決めごと（README「作り」の例外。手元の決まりに1行足した）
   - 呼ぶのは Anthropic だけ（おすすめの案 a）。ほかの会社へは送らない。
   - 送るのはユーザーが書いた質問の文・この app の使い方の説明（1行の要約）・
     版・今の画面 ID・件数（海・今日・長期保留・完了・タグ）だけ。
     **バブルの本文は送らない。**（おすすめの案 a）
   - 送り先はブラウザから Anthropic の API へ直接（server.py を介さない。おすすめの案 a）。
     キーは端末の localStorage にだけ置く（サーバーへは一切送らない。sync.js の同期対象にも入れない）。
   - 会話は端末のメモリにだけ置く。閉じたら消える（保存しない）。

   ■ キーの置き場
   localStorage の 'bubble_todo_ai_key'。記録（bubble_todo_v1）・サーバーの設定（bubble_todo_sync）
   とは別の箱。CSV 書き出し・サーバー同期・改善のコメント・エラーの記録のどれにも混ぜない
   （tests/ai.test.mjs がこれを見る）。

   ■ ブラウザから直接呼ぶ
   Anthropic は既定でブラウザからの fetch を CORS で断るが、
   `anthropic-dangerous-direct-browser-access: true` ヘッダを付けると通す
   （鍵が使う人のブラウザに乗る前提の、Anthropic 自身の逃げ道）。
   鍵は使う人が自分で発行し、自分の端末にだけ置くので、ここではその前提を踏む。

   ■ モデル
   既定は Haiku 系（速い・安い）。ヘルプの受け答えに十分な力で足りる。 */

const KEY_STORE = 'bubble_todo_ai_key';
const MODEL = 'claude-haiku-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}

export function setKey(v) {
  try {
    const s = String(v || '').trim();
    if (s) localStorage.setItem(KEY_STORE, s);
    else localStorage.removeItem(KEY_STORE);
    return true;
  } catch (e) { return false; }
}

export function hasKey() { return !!getKey(); }

/* system = 使い方の説明（1行）＋今の状態（版・画面ID・件数）。
   messages = [{ role: 'user'|'assistant', content: string }, ...]（会話はメモリのみ、呼び出し側が持つ）
   戻り値は Claude の返事（文字列）。失敗したら理由つきで投げる。 */
export async function ask(system, messages) {
  const key = getKey();
  if (!key) throw new Error('API キーが入っていない');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: String(system || ''),
      messages: (messages || []).map(m => ({ role: m.role, content: String(m.content || '') })),
    }),
  });
  if (!res.ok) {
    let msg = 'AI に届かなかった（' + res.status + '）';
    try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* 読めなくてもよい */ }
    if (res.status === 401) msg = 'API キーが正しくない';
    if (res.status === 429) msg = '混み合っている（しばらくして試す）';
    throw new Error(msg);
  }
  const data = await res.json();
  const block = Array.isArray(data.content) ? data.content.find(b => b.type === 'text') : null;
  return (block && block.text) || '';
}
