/* AI（Anthropic Claude）に問い合わせる薄い層（2026-11-04。Issue #9）。

   ■ 決めごと（README「作り」の例外。手元の決まりに1行足した）
   - 呼ぶのは Anthropic だけ（おすすめの案 a）。ほかの会社へは送らない。
   - 送るのはユーザーが書いた質問の文・この app の使い方の説明（1行の要約）・
     版・今の画面 ID・件数（海・今日・長期保留・完了・タグ）だけ。
     **バブルの本文は送らない。**（おすすめの案 a）
     例外（2026-11-05 Issue #17。利用者の頼み「本文を読んで関連情報を集める・整理する」）:
     本文の面の「AI で調べる」「AI で整理」を押したときだけ、その泡の名前と本文を送る（js/research.js）。
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
/* モデルは設定の「ヘルプと AI」で選べる（2026-11-05 利用者の質問 Issue #13）。
   端末の localStorage 'bubble_todo_ai_model' にだけ置く（キーと同じく同期・CSV に乗らない）。
   既定は Haiku（速い・安い）。上ほど賢いが、1 回ごとの料金も上がる（料金はキーの持ち主に掛かる） */
const MODEL_STORE = 'bubble_todo_ai_model';
export const MODELS = [
  { id: 'claude-haiku-5-5',  label: 'Haiku 5.5（既定。速い・安い）' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5（中くらい）' },
  { id: 'claude-opus-5-5',   label: 'Opus 5.5（いちばん賢い・高い）' },
];
export const DEFAULT_MODEL = MODELS[0].id;
export function getModel() {
  let v = '';
  try { v = localStorage.getItem(MODEL_STORE) || ''; } catch (e) { v = ''; }
  return MODELS.some(m => m.id === v) ? v : DEFAULT_MODEL;
}
export function setModel(id) {
  try {
    if (MODELS.some(m => m.id === id) && id !== DEFAULT_MODEL) localStorage.setItem(MODEL_STORE, id);
    else localStorage.removeItem(MODEL_STORE);
    return true;
  } catch (e) { return false; }
}
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
      model: getModel(),
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

/* ---- Web で調べて答える（2026-11-04。Issue #13「先の予定」）----
   Anthropic の Web 検索ツール（サーバー側で Anthropic が検索する。ブラウザからよそへは繋がない
   ので、CSP の connect-src は api.anthropic.com のまま）。
   料金: 検索 1 回ごとに課金（1,000 回で $10）＋トークン代。1 回押すごとの検索は SEARCH_MAX_USES まで。
   返事が長くなって pause_turn で止まったら、そこまでの中身を渡して続けさせる（PAUSE_MAX 回まで）。
   戻り値は返事の文字（text の塊をつないだもの）。 */
const SEARCH_TOOL = 'web_search_20250305';   /* Haiku は基本の版（dynamic filtering の版は Opus・Sonnet だけ） */
export const SEARCH_MAX_USES = 5;
export const SEARCH_USES_CAP = 10;            /* キーワードを足したときの上限 */
/* 2026-11-04 Issue #13「何回やっても一覧にできない」: 4096 では、考える分（Haiku 5.5 は既定で考える）と
   検索の結果を読む分に食われ、JSON が途中で切れていた（stop_reason: max_tokens）。
   ストリームでない呼び方の目安の 16000 にする */
const SEARCH_MAX_TOKENS = 16000;
const PAUSE_MAX = 3;

async function post(body) {
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
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = 'AI に届かなかった（' + res.status + '）';
    try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* 読めなくてもよい */ }
    if (res.status === 401) msg = 'API キーが正しくない';
    if (res.status === 429) msg = '混み合っている（しばらくして試す）';
    throw new Error(msg);
  }
  return res.json();
}

/* -> { text, stop, searchError }
   text = text の塊をつないだもの。stop = 最後の stop_reason（'max_tokens' なら途中で切れた）。
   searchError = 検索ツールが返したエラーの印（例 'max_uses_exceeded'。HTTP は 200 のまま返る） */
export async function askWithSearchFull(system, userText, opts) {
  if (!getKey()) throw new Error('API キーが入っていない');
  const o = opts || {};
  const uses = Math.max(1, Math.min(SEARCH_USES_CAP, Number(o.maxUses) || SEARCH_MAX_USES));
  const messages = [{ role: 'user', content: String(userText || '') }];
  const texts = [];
  let stop = '';
  let searchError = '';
  for (let i = 0; i <= PAUSE_MAX; i++) {
    const data = await post({
      model: getModel(),
      max_tokens: SEARCH_MAX_TOKENS,
      system: String(system || ''),
      messages,
      tools: [{ type: SEARCH_TOOL, name: 'web_search', max_uses: uses }],
    });
    const content = Array.isArray(data.content) ? data.content : [];
    content.forEach(b => {
      if (b && b.type === 'text' && b.text) texts.push(b.text);
      if (b && b.type === 'web_search_tool_result' && b.content && !Array.isArray(b.content) && b.content.error_code) {
        searchError = String(b.content.error_code);
      }
    });
    stop = String(data.stop_reason || '');
    if (stop !== 'pause_turn') break;
    messages.push({ role: 'assistant', content });
  }
  return { text: texts.join(''), stop, searchError };
}

/* 検索なしで1回だけ訊く。-> { text, stop }（2026-11-05 Issue #17「整理する」。
   本文を書き直して返すので、ask の 1024 では長い本文が切れる。切れたかを stop で知る） */
export async function askFull(system, userText, opts) {
  const o = opts || {};
  const data = await post({
    model: getModel(),
    max_tokens: Math.max(256, Math.min(SEARCH_MAX_TOKENS, Number(o.maxTokens) || MAX_TOKENS)),
    system: String(system || ''),
    messages: [{ role: 'user', content: String(userText || '') }],
  });
  const content = Array.isArray(data.content) ? data.content : [];
  return {
    text: content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join(''),
    stop: String(data.stop_reason || ''),
  };
}

export async function askWithSearch(system, userText, opts) {
  return (await askWithSearchFull(system, userText, opts)).text;
}
