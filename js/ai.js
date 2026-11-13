/* AI に問い合わせる薄い層（2026-11-04。Issue #9。2026-11-12 Issue #46 で会社を選べるようにした）。

   ■ 決めごと（README「作り」の例外。手元の決まりに1行足した）
   - 呼ぶのは、設定で選んだ 1 社だけ（Issue #46 の A 案）。選べるのは下の PROVIDERS の 3 社
     （Anthropic・OpenAI・Google Gemini）に限り、送り先は CSP の connect-src に決め打ちで書いた窓口だけ。
     住所を自分で入れる形（OpenAI 互換の任意の住所）は作らない（CSP を広げることになるため。Issue #46 の B 案は採らない）。
   - 送るのはユーザーが書いた質問の文・この app の使い方の説明（1行の要約）・
     版・今の画面 ID・件数（海・今日・長期保留・完了・タグ）だけ。
     **バブルの本文は送らない。**（おすすめの案 a）
     例外（2026-11-05 Issue #17。利用者の頼み「本文を読んで関連情報を集める・整理する」）:
     本文の面の「AI で調べる」「AI で整理」「AI で名前」（#11）を押したときだけ、その泡の名前と本文を送る（js/research.js）。
     今日の画面の「おすすめ」の [AI で選び直す]（#12）を押したときだけ、端末で絞った候補 30 件までの名前と印を送る（js/suggest.js。本文は送らない）。
     右上の ! の「AI で題名」（#10）を押したときだけ、改善のコメントの文を送る（js/app.js の AppFeedback.install）。
     設定の「この端末の表示」の [頼む]（#36）を押したときだけ、書いた文と表示の項目・今の値を送る（js/prefs.js。泡の中身は送らない）。
     どの会社を選んでも、送る中身はこれと同じ。
   - 送り先はブラウザから選んだ会社の API へ直接（server.py を介さない。おすすめの案 a）。
     キーは端末の localStorage にだけ置く（サーバーへは一切送らない。sync.js の同期対象にも入れない）。
   - 会話は端末のメモリにだけ置く。閉じたら消える（保存しない）。
   - Web 検索（先の予定・AI で調べる）は Anthropic を選んだときだけ（Issue #46 の返事「おすすめで」= 最初は Anthropic だけ）。
     ほかの会社では askWithSearchFull が理由つきで断る（canSearch() で前もって分かる）。

   ■ キーの置き場（会社ごとに別の箱）
   Anthropic は前からの 'bubble_todo_ai_key'（入っているキーをそのまま使う）。
   OpenAI は 'bubble_todo_ai_key_openai'、Gemini は 'bubble_todo_ai_key_gemini'。
   どれも 'bubble_todo_ai_key' で始まる（rollback.js の写しはこの頭で外す）。
   記録（bubble_todo_v1）・サーバーの設定（bubble_todo_sync）とは別の箱。CSV 書き出し・サーバー同期・
   改善のコメント・エラーの記録のどれにも混ぜない（tests/ai.test.mjs がこれを見る）。
   選んだ会社は 'bubble_todo_ai_provider'。

   ■ ブラウザから直接呼ぶ
   Anthropic は既定でブラウザからの fetch を CORS で断るが、
   `anthropic-dangerous-direct-browser-access: true` ヘッダを付けると通す
   （鍵が使う人のブラウザに乗る前提の、Anthropic 自身の逃げ道）。
   OpenAI（Authorization: Bearer）と Gemini（x-goog-api-key）は、そのままブラウザから呼べる。
   鍵は使う人が自分で発行し、自分の端末にだけ置くので、ここではその前提を踏む。

   ■ モデル
   会社ごとに一覧から選ぶ。一覧に無いモデル名は「手で入れる」で入れられる（'custom:<名前>' で保存）。
   Anthropic の既定は Opus 5.5（2026-11-07 利用者の指示 Issue #13。前は Haiku 5.5）。 */

import { loadLock, saveLock, clearLock, loadSealed, encName, sealKey, openSealed, openLock, makeLock, forget, isOpen } from './aikey.js';

const PROVIDER_STORE = 'bubble_todo_ai_provider';

/* 送り先の窓口。CSP の connect-src（server.py の CSP・noserver.html の <meta>）と同じものだけ。
   tests/chain.test.mjs が CSP と突き合わせる */
export const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic（Claude）',
    origin: 'https://api.anthropic.com',
    keyStore: 'bubble_todo_ai_key',
    modelStore: 'bubble_todo_ai_model',
    models: [
      { id: 'claude-haiku-5-5',  label: 'Haiku 5.5（速い・安い）' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5（中くらい）' },
      { id: 'claude-opus-5-5',   label: 'Opus 5.5（既定。いちばん賢い・高い）' },
    ],
    defaultModel: 'claude-opus-5-5',   /* 2026-11-07 利用者の指示 Issue #13 */
    keyHint: 'sk-ant- で始まる字',
    keyPrefix: 'sk-ant-',
    keyPlace: 'Anthropic Console の API Keys',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    search: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI（GPT）',
    origin: 'https://api.openai.com',
    keyStore: 'bubble_todo_ai_key_openai',
    modelStore: 'bubble_todo_ai_model_openai',
    models: [
      { id: 'gpt-5-mini', label: 'GPT-5 mini（速い・安い）' },
      { id: 'gpt-5',      label: 'GPT-5（既定。賢い・高い）' },
    ],
    defaultModel: 'gpt-5',
    keyHint: 'sk- で始まる字',
    keyPrefix: 'sk-',
    keyPlace: 'OpenAI Platform の API keys',
    keyUrl: 'https://platform.openai.com/api-keys',
    search: false,
  },
  gemini: {
    id: 'gemini',
    label: 'Google（Gemini）',
    origin: 'https://generativelanguage.googleapis.com',
    keyStore: 'bubble_todo_ai_key_gemini',
    modelStore: 'bubble_todo_ai_model_gemini',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（速い・安い）' },
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro（既定。賢い・高い）' },
    ],
    defaultModel: 'gemini-2.5-pro',
    keyHint: 'AIza で始まる字',
    keyPrefix: 'AIza',
    keyPlace: 'Google AI Studio の API キー',
    keyUrl: 'https://aistudio.google.com/apikey',
    search: false,
  },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const DEFAULT_PROVIDER = 'anthropic';

/* 前からの名前（Anthropic の一覧と既定）。テストと古い呼び方のため残す */
export const MODELS = PROVIDERS.anthropic.models;
export const DEFAULT_MODEL = PROVIDERS.anthropic.defaultModel;

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

export function getProvider() {
  const v = lsGet(PROVIDER_STORE);
  return PROVIDERS[v] ? v : DEFAULT_PROVIDER;
}
export function setProvider(id) {
  try {
    if (PROVIDERS[id] && id !== DEFAULT_PROVIDER) localStorage.setItem(PROVIDER_STORE, id);
    else localStorage.removeItem(PROVIDER_STORE);
    return !!PROVIDERS[id];
  } catch (e) { return false; }
}
function prov(p) { return PROVIDERS[p] || PROVIDERS[getProvider()]; }
export function providerInfo(p) { return prov(p); }
export function providerLabel(p) { return prov(p).label; }
/* Web 検索（先の予定・AI で調べる）が使えるか（Issue #46: 最初は Anthropic だけ） */
export function canSearch(p) { return !!prov(p).search; }

/* 手で入れるモデル名。会社の API の住所（Gemini はパス）に入るので、英数字と . _ : - だけ */
const CUSTOM = 'custom:';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
export function validModelName(s) { return MODEL_RE.test(String(s || '')); }

/* -> { id, custom }  custom = 一覧に無い、手で入れた名前か */
export function getModelChoice(p) {
  const P = prov(p);
  const v = lsGet(P.modelStore);
  if (P.models.some(m => m.id === v)) return { id: v, custom: false };
  if (v.indexOf(CUSTOM) === 0 && validModelName(v.slice(CUSTOM.length))) return { id: v.slice(CUSTOM.length), custom: true };
  return { id: P.defaultModel, custom: false };
}
export function getModel(p) { return getModelChoice(p).id; }
/* 一覧のモデルを選ぶ。一覧に無い名前は消して既定に戻す（手で入れる名前は setCustomModel） */
export function setModel(id, p) {
  const P = prov(p);
  try {
    /* 既定と同じものも残す（既定が変わっても、自分で選んだものは変わらないように） */
    if (P.models.some(m => m.id === id)) localStorage.setItem(P.modelStore, id);
    else localStorage.removeItem(P.modelStore);
    return true;
  } catch (e) { return false; }
}
export function setCustomModel(name, p) {
  const P = prov(p);
  const s = String(name || '').trim();
  if (!validModelName(s)) return false;
  try { localStorage.setItem(P.modelStore, CUSTOM + s); return true; } catch (e) { return false; }
}
export function modelsFor(p) { return prov(p).models; }

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

/* 平文の箱（前からの置き方）。鍵をかけたキーは js/aikey.js の暗号文の箱にあり、ここでは見えない */
export function getKey(p) { return lsGet(prov(p).keyStore); }

/* 平文で置く（前からの置き方。テストと、鍵をかける前の移し替えのため残す。設定の画面は saveKeyLocked を使う） */
export function setKey(v, p) {
  try {
    const s = String(v || '').trim();
    const k = prov(p).keyStore;
    if (s) localStorage.setItem(k, s);
    else localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
}

/* ---- 鍵をかけて置く（2026-11-13 Issue #14） ---- */
/* 鍵をかけたキーがあるか */
export function isKeyLocked(p) { return !!loadSealed(prov(p).keyStore); }
/* 平文のまま置いてあるか（鍵をかける前の古い置き方） */
export function isKeyPlain(p) { return !!getKey(p); }
/* 末尾 4 字（見分け用） */
export function keyTail(p) {
  const s = loadSealed(prov(p).keyStore);
  if (s) return String(s.tail || '');
  return getKey(p).slice(-4);
}
export function keyLock() { return loadLock(); }
export const lockNow = forget;
export const keyOpen = isOpen;

function askPassPrompt() {
  return typeof window !== 'undefined' && window.prompt ? window.prompt('AI のキーの合言葉（鍵をかけたときに決めたもの）') : '';
}

/* キーに鍵をかけて置く。錠がまだ無ければ mode（'passkey' | 'pass'）で作る。askNewPass = 新しい合言葉を訊く関数。
   置いたら平文の箱は消す。押した手の続きで呼ぶ（パスキー） */
export async function saveKeyLocked(v, p, opts = {}) {
  const P = prov(p);
  const s = String(v || '').trim();
  if (!s) throw new Error('キーが空');
  let lock = loadLock();
  let aes;
  if (!lock) {
    const made = await makeLock(opts.mode === 'passkey' ? 'passkey' : 'pass', opts.askNewPass || (() => ''));
    lock = made.lock; aes = made.aes;
    saveLock(lock);
  } else {
    aes = await openLock(lock, opts.askPass || askPassPrompt);
  }
  const sealed = await sealKey(aes, s, P.id);
  localStorage.setItem(encName(P.keyStore), JSON.stringify(sealed));
  localStorage.removeItem(P.keyStore);
  return true;
}

/* 平文で置いてあるキーに鍵をかける（古い置き方からの移し替え） */
export async function lockPlainKey(p, opts = {}) {
  const v = getKey(p);
  if (!v) return false;
  return saveKeyLocked(v, p, opts);
}

/* キーを消す（平文・暗号文の両方）。どの会社のキーも無くなったら錠も外す */
export function removeKey(p) {
  const P = prov(p);
  try { localStorage.removeItem(P.keyStore); localStorage.removeItem(encName(P.keyStore)); } catch (e) { return false; }
  if (!PROVIDER_IDS.some(id => hasKey(id))) clearLock();
  return true;
}

/* 使う時だけ取り出す。平文の箱があればそれ、鍵をかけたものは錠を開けて復号する。
   錠は OPEN_MS のあいだ開いたまま（キーの平文は呼び出しが終われば捨てる） */
async function useKey(p) {
  const P = prov(p);
  const plain = getKey(p);
  if (plain) return plain;
  const sealed = loadSealed(P.keyStore);
  if (!sealed) throw new Error('API キーが入っていない');
  const aes = await openLock(loadLock(), askPassPrompt);
  try { return await openSealed(aes, sealed, P.id); } catch (e) { forget(); throw e; }
}

/* 今選んでいる会社のキーがあるか（平文でも、鍵をかけたものでも） */
export function hasKey(p) { return !!getKey(p) || isKeyLocked(p); }

/* 2026-11-04 Issue #13「何回やっても一覧にできない」: 4096 では、考える分（Haiku 5.5 は既定で考える）と
   検索の結果を読む分に食われ、JSON が途中で切れていた（stop_reason: max_tokens）。
   ストリームでない呼び方の目安の 16000 にする */
const SEARCH_MAX_TOKENS = 16000;
/* OpenAI の GPT-5 系・Gemini 2.5 系は、考える分も出力の上限に数える。1024 などでは考えるだけで尽きて
   返事が空になるので、この 2 社には少なくともこれだけ渡す（使った分だけ課金される） */
const THINK_MIN_TOKENS = 8000;

function failMsg(status, j) {
  let msg = 'AI に届かなかった（' + status + '）';
  const e = j && (Array.isArray(j) ? j[0] && j[0].error : j.error);
  if (e && e.message) msg = String(e.message);
  if (status === 401 || status === 403) msg = 'API キーが正しくない';
  if (status === 400 && /api key/i.test(msg)) msg = 'API キーが正しくない';
  if (status === 429) msg = '混み合っている（しばらくして試す）';
  return msg;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let j = null;
    try { j = await res.json(); } catch (e) { /* 読めなくてもよい */ }
    throw new Error(failMsg(res.status, j));
  }
  return res.json();
}

/* Anthropic の Messages API。body はそのまま渡す */
async function postAnthropic(key, body) {
  return postJson(PROVIDERS.anthropic.origin + '/v1/messages', {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }, body);
}

/* 会社ごとの呼び方の差をここで吸う。-> { text, stop }
   stop は、上限で切れたときは会社に関わらず 'max_tokens'（呼び出し側はこれだけを見る） */
async function chat(system, messages, maxTokens) {
  const p = getProvider();
  const key = await useKey(p);
  const model = getModel(p);
  const sys = String(system || '');
  const msgs = (messages || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));

  if (p === 'openai') {
    const data = await postJson(PROVIDERS.openai.origin + '/v1/chat/completions', { authorization: 'Bearer ' + key }, {
      model,
      max_completion_tokens: Math.max(THINK_MIN_TOKENS, maxTokens),
      messages: (sys ? [{ role: 'system', content: sys }] : []).concat(msgs),
    });
    const c = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const fin = String((c && c.finish_reason) || '');
    return { text: String((c && c.message && c.message.content) || ''), stop: fin === 'length' ? 'max_tokens' : fin };
  }

  if (p === 'gemini') {
    const body = {
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: Math.max(THINK_MIN_TOKENS, maxTokens) },
    };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    const data = await postJson(PROVIDERS.gemini.origin + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'x-goog-api-key': key }, body);
    const c = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    const parts = (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : [];
    const fin = String((c && c.finishReason) || '');
    return {
      text: parts.filter(x => x && typeof x.text === 'string' && !x.thought).map(x => x.text).join(''),
      stop: fin === 'MAX_TOKENS' ? 'max_tokens' : fin,
    };
  }

  const data = await postAnthropic(key, { model, max_tokens: maxTokens, system: sys, messages: msgs });
  const content = Array.isArray(data.content) ? data.content : [];
  return {
    text: content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join(''),
    stop: String(data.stop_reason || ''),
  };
}

/* system = 使い方の説明（1行）＋今の状態（版・画面ID・件数）。
   messages = [{ role: 'user'|'assistant', content: string }, ...]（会話はメモリのみ、呼び出し側が持つ）
   戻り値は AI の返事（文字列）。失敗したら理由つきで投げる。 */
export async function ask(system, messages) {
  return (await chat(system, messages, MAX_TOKENS)).text;
}

/* ---- Web で調べて答える（2026-11-04。Issue #13「先の予定」）----
   Anthropic の Web 検索ツール（サーバー側で Anthropic が検索する。ブラウザからよそへは繋がない
   ので、CSP の connect-src は api.anthropic.com のまま）。
   料金: 検索 1 回ごとに課金（1,000 回で $10）＋トークン代。1 回押すごとの検索は SEARCH_MAX_USES まで。
   返事が長くなって pause_turn で止まったら、そこまでの中身を渡して続けさせる（PAUSE_MAX 回まで）。
   2026-11-12 Issue #46: ほかの会社を選んでいるときは断る（最初は Anthropic だけ）。 */
const SEARCH_TOOL = 'web_search_20250305';   /* Haiku は基本の版（dynamic filtering の版は Opus・Sonnet だけ） */
export const SEARCH_MAX_USES = 5;
export const SEARCH_USES_CAP = 10;            /* キーワードを足したときの上限 */
const PAUSE_MAX = 3;

export function searchUnavailableMessage() {
  return 'Web で調べるのは、設定の「AI を使う設定をする」で Anthropic を選んだときだけ使える（今は '
    + providerLabel() + '）。';
}

/* -> { text, stop, searchError }
   text = text の塊をつないだもの。stop = 最後の stop_reason（'max_tokens' なら途中で切れた）。
   searchError = 検索ツールが返したエラーの印（例 'max_uses_exceeded'。HTTP は 200 のまま返る） */
export async function askWithSearchFull(system, userText, opts) {
  if (!hasKey()) throw new Error('API キーが入っていない');
  if (!canSearch()) throw new Error(searchUnavailableMessage());
  const key = await useKey();
  const o = opts || {};
  const uses = Math.max(1, Math.min(SEARCH_USES_CAP, Number(o.maxUses) || SEARCH_MAX_USES));
  const messages = [{ role: 'user', content: String(userText || '') }];
  const texts = [];
  let stop = '';
  let searchError = '';
  for (let i = 0; i <= PAUSE_MAX; i++) {
    const data = await postAnthropic(key, {
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
  const maxTokens = Math.max(256, Math.min(SEARCH_MAX_TOKENS, Number(o.maxTokens) || MAX_TOKENS));
  return chat(system, [{ role: 'user', content: String(userText || '') }], maxTokens);
}

export async function askWithSearch(system, userText, opts) {
  return (await askWithSearchFull(system, userText, opts)).text;
}
