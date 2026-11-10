/* 先の予定（AI）の中身の計算（2026-11-04。利用者の指示 Issue #13）。

   画面（js/upcoming.js）と AI（js/ai.js）から切り離した、素の計算だけを置く。
   DOM も localStorage も fetch も触らない（tests/events.test.mjs が Node で直接読む）。

   ■ 決めごと（Issue #13 のコメントで決めたもの）
   - **予測はしない。**扱うのは「日付が先に分かっている予定」だけ（選挙・FOMC・決算日・セール・休日など）。
     値動き（株価・買取価格）は取らない・出さない
   - 1件ごとに「確定 / 予定 / 噂」を持つ。噂は初めはチェックを外しておく
   - 今日へ出す日 = 予定の日 − 何日前（トピックごとの既定。行ごとに変えられる）
   - 同じ予定を二度入れない。印はバブルの本文の最後の行（`先の予定: <日付>|<題名>`）。
     本文は同期・CSV に乗るので、ほかの端末で入れたものも重ならない
   - **期間もの**（キャンペーン・セール・連休。end を持つ）は、もう始まっていても終わっていなければ出す。
     今日へ出す日は「始まる◯日前／始まる日／終わる◯日前／終わる日」から選ぶ（leadOptions）。
     エントリーが要るもの（entry）は既定で「始まる日」——還元はエントリーした日から数えるものが多いため
   - 調べ方の主は「調べたいことを 1 つ書いて送る」（2026-11-05 利用者の指示）。見るもののカードは既定ですべて外す
   - 1件ごとに短い説明を持ち、バブルの本文に書く（2026-11-05 利用者の指示）:
     投資の予定は「何の指標・出来事か」「予想値」「予想を上回った／下回ったときに一般に株価がどう動きやすいか」（一般論。予測ではない）。
     セール・キャンペーンは「概要」「上限・条件」「注意事項」 */

/* 見るもの（トピック）。lead = 何日前に今日へ出すか（既定） */
export const TOPICS = [
  { id: 'fomc',     group: '投資',   label: '金融政策', sub: 'FOMC・日銀', lead: 14,
    ask: 'FOMC（米連邦公開市場委員会）と日本銀行の金融政策決定会合の日程' },
  { id: 'macro',    group: '投資',   label: '米国の指標', sub: 'CPI・雇用統計', lead: 3,
    ask: '米国 CPI と雇用統計の発表日' },
  { id: 'earnings', group: '投資',   label: '決算発表', sub: '下の欄に書いた銘柄', lead: 7,
    ask: '「銘柄・商品」に書いた銘柄の決算発表日' },
  { id: 'election', group: '投資',   label: '選挙', sub: '米国・日本', lead: 14,
    ask: '米国と日本の国政選挙の投票日' },
  { id: 'sale',     group: 'せどり', label: '大型セール', sub: 'Amazon・楽天', lead: 7,
    ask: 'Amazon（プライムデー・ブラックフライデーなど）と楽天（スーパーセール・お買い物マラソン）の大型セールの開始日' },
  { id: 'console',  group: 'せどり', label: 'ゲーム機・VR', sub: 'セール・新型・値上げ', lead: 7,
    ask: 'PlayStation 5・Meta Quest・Nintendo Switch など、ゲーム機と VR 機の公式セール・新型の発売日・価格改定の実施日' },
  { id: 'china',    group: 'せどり', label: '中国の連休・商戦', sub: '春節・618・双11', lead: 7,
    ask: '中国の春節・労働節・国慶節の連休の始まりと、618・双11 の商戦の日' },
  { id: 'holiday',  group: '休日',   label: '各国の休日', sub: '日本・米国・中国・UAE', lead: 3,
    ask: '日本・米国・中国・アラブ首長国連邦（ドバイ）の祝日と、東京・米国・上海の市場の休場日' },
  /* お得（2026-11-04 追加。利用者の指示）。期間もの（始まり〜終わり）が中心。
     既定は「終わる3日前」に今日へ（使い忘れを防ぐ）。エントリーが要るものは「始まる日」に今日へ */
  { id: 'pay',      group: 'お得',   label: '支払いの還元', sub: 'PayPay・d払い・楽天ペイ・au PAY・エアウォレットなど', lead: 3,
    ask: 'PayPay・d払い・楽天ペイ・au PAY・メルペイ・エアウォレット・クレジットカードなど、日本のキャッシュレス決済の還元・割引キャンペーン（期間・エントリーの要否・上限）' },
  { id: 'points',   group: 'お得',   label: 'ポイント増量', sub: 'dポイント・楽天・V・Ponta など', lead: 3,
    ask: 'dポイント・楽天ポイント・Vポイント・Pontaポイント・PayPayポイントの増量・倍率アップ・交換レート優遇のキャンペーン（期間・エントリーの要否・上限）' },
];

/* キーワード（2026-11-04 追加。利用者の指示 Issue #13「sbi の投資信託のキャンペーン・楽天のお買い物マラソンの期間」）。
   見るもののカードとは別に、欄に書いた言葉を 1 つずつ調べる。返事の topic は 'kw' */
export const KW_TOPIC = { id: 'kw', group: 'キーワード', label: '送って調べたもの', sub: '', lead: 7, ask: '' };
export const KW_MAX = 5;
export const KW_LEN = 40;

/* 欄の文字 -> キーワードの並び（、 , 改行 で分ける。空・重なりを落とし、最大 KW_MAX 個） */
export function parseKeywords(s) {
  const out = [];
  String(s || '').split(/[,、，\n;；]+/).forEach(w => {
    const t = Array.from(w.replace(/\s+/g, ' ').trim()).slice(0, KW_LEN).join('');
    if (t && !out.includes(t) && out.length < KW_MAX) out.push(t);
  });
  return out;
}

/* 既定ではどれも選ばない（2026-11-05 利用者の指示「デフォルトで全部チェック外して、基本はメッセージ送信で調べる」） */
export const DEFAULT_TOPICS = [];
/* 見るものの版。上げたときに足したトピック（前の版で保存した端末にも、既定で付ける） */
export const TOPICS_VER = 3;
export const TOPICS_ADDED = { 2: ['pay', 'points'] };
/* この版より前に保存した選びは 1 回だけ空にする（前の既定で全部に印が付いていたため。v3 = 2026-11-05） */
export const TOPICS_RESET_VER = 3;

/* 保存してあった選び（p = localStorage の中身）から、今の選びを出す */
export function migrateTopics(p) {
  const q = (p && typeof p === 'object') ? p : {};
  if (!Array.isArray(q.topics)) return DEFAULT_TOPICS.slice();
  let topics = q.topics.filter(id => TOPICS.some(t => t.id === id));
  const ver = Number(q.ver) || 1;
  if (ver < TOPICS_RESET_VER) return [];
  for (let v = ver + 1; v <= TOPICS_VER; v++) {
    (TOPICS_ADDED[v] || []).forEach(id => { if (!topics.includes(id)) topics.push(id); });
  }
  return topics;
}

/* 送って調べる文（2026-11-05。下の欄に書いて送る）。空白をそろえ、MSG_MAX 字まで */
export const MSG_MAX = 200;
export function cleanMessage(s) {
  return Array.from(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, MSG_MAX).join('');
}

/* 説明の欄の長さ（バブルの本文に書く） */
export const ABOUT_MAX = 120;
export const FORECAST_MAX = 40;
export const MOVE_MAX = 80;
export const CAUTION_MAX = 100;
/* 1 回に頼む件数（説明が付いて 1 件が長くなったので、返事が切れないように 40 → 15） */
export const ASK_MAX = 15;
/* 送るたびに一覧へ足していくときの上限 */
export const KEEP_MAX = 60;
export const NOTE_MAX = 60;
export const LEADS = [0, 3, 7, 14, 30];        /* 行ごとに選べる「何日前」 */
export const HORIZON_DAYS = 180;                /* 今日からどこまで先を見るか */
export const MAX_EVENTS = 40;
export const TITLE_MAX = 40;
export const STATUS = { confirmed: '確定', planned: '予定', rumor: '噂' };
export const MARK = '先の予定: ';                /* 本文の最後の行の頭（重なりの印） */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* 支払いルート（2026-11-05 追加。利用者の指示 Issue #13「今どの支払いがお得か調べる機能」）。
   クレカ → チャージ → 支払い の流れ（例: カード → Revolut → ANA Pay → Edy → 楽天キャッシュ → 楽天ペイ）を、
   還元率・条件・上限・期間と一緒にまとめる。返事の topic は 'route' */
export const ROUTE_TOPIC = { id: 'route', group: 'お得', label: '支払いルート', sub: '', lead: 0, ask: '' };
export const ROUTE_ASK_MAX = 8;
export const STEP_MAX = 8;
export const STEP_LEN = 24;
export const DEFAULT_SITES = 'https://toyama-go-z-house.com/\nhttps://poinmy.com/?p=798';

export function topicOf(id) {
  if (id === 'kw') return KW_TOPIC;
  if (id === 'route') return ROUTE_TOPIC;
  return TOPICS.find(t => t.id === id) || null;
}

/* 欄の文字 -> http(s) の URL の並び（5 つまで） */
export function parseSites(s) {
  const out = [];
  String(s || '').split(/[\s,、]+/).forEach(u => { const v = safeUrl(u); if (v && !out.includes(v) && out.length < 5) out.push(v); });
  return out;
}

/* 支払いルートを調べる文。送るのは持っているカード・支払いの欄と、参考にするサイトの URL だけ */
export function buildRoutePrompt(cards, sites, today) {
  const c = cleanMessage(cards);
  const ss = parseSites(sites);
  const system = [
    'あなたは日本のキャッシュレス決済の「お得な支払いルート」を Web で調べてまとめる係。',
    'ルートとは、クレジットカードから電子マネー・プリペイド・コード決済へチャージを重ね、最後に支払うまでの流れ'
      + '（例: 三井住友カード ゴールド（NL） → Revolut → ANA Pay → 楽天Edy → 楽天キャッシュ → 楽天ペイ）。',
    '今日は ' + today + '。今使えるルートと、' + today + ' 以降に始まると発表済みのものだけ。終わったもの・改悪で使えなくなったものは入れない。',
    '投資や売買の助言はしない。還元の仕組みと条件だけを書く。',
    '調べ終えたら、最後に答えを ```json の囲いの中に JSON の配列で 1 つだけ書く（配列の外に [ ] を書かない）。各要素は次の形:',
    '{"title":"ルートの名前 30字以内","card":"起点のカード・支払い","steps":["起点","チャージ先",…,"最後の支払い"],'
      + '"rate":"全体の還元率（例: 1.5%）","cap":"上限（例: 月5万円まで・1回1円）。無ければ null",'
      + '"date":"YYYY-MM-DD（期間があれば始まり。常設なら null）","end":"YYYY-MM-DD（終わり。常設なら null）",'
      + '"entry":true|false,"note":"条件 30字以内","about":"なぜお得か 60字以内","caution":"注意（改悪の予定・対象外・手数料など）50字以内",'
      + '"status":"confirmed|planned|rumor","source":"根拠のURL"}',
    'steps は 2〜' + STEP_MAX + ' 個。1 つは ' + STEP_LEN + ' 字以内。還元率の高い順に、最大 ' + ROUTE_ASK_MAX + ' 件。',
    '見つからなければ空の配列 [] を書く。',
  ].join('\n');
  const user = '今お得な支払いルートを調べて。'
    + (c ? '\n持っているカード・支払い（これを起点・経由にするルートを優先）: ' + c : '\n持っているカードの指定は無い。よく使われるルートを広く。')
    + (ss.length ? '\n参考にするサイト（まずここを読む。古い記事は今も使えるか確かめる）:\n' + ss.map(u => '- ' + u).join('\n') : '');
  return { system, user };
}

/* 支払いルートの返事 -> 一覧の形（予定と同じ形。steps・rate・cap・card は normalizeEvents が持つ）。
   期間の無いもの（常設）と、もう始まっているものは、始まりを今日にする */
export function normalizeRoutes(raw, today) {
  const rows = (Array.isArray(raw) ? raw : []).map(r => {
    if (!r || typeof r !== 'object') return null;
    const d0 = String(r.date || '').trim();
    return Object.assign({}, r, { date: validDay(d0) && d0 > today ? d0 : today, topic: 'route' });
  }).filter(Boolean);
  return normalizeEvents(rows, today);
}

export function isFixedRoute(ev) { return !!(ev && ev.topic === 'route' && !ev.end); }

export function routeLine(ev) { return (ev && Array.isArray(ev.steps) && ev.steps.length) ? ev.steps.join(' → ') : ''; }

/* 'YYYY-MM-DD' に n 日足す（ローカル時刻の正午で数える。夏時間でも日が飛ばない） */
export function addDays(key, n) {
  const m = DAY_RE.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const z = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function validDay(s) {
  const m = DAY_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

/* 題名をそろえる（重なりの比較用）。空白・記号の差で別物にしない */
export function normTitle(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・、。,.()（）「」【】\-–—:：]/g, '');
}

export function eventKey(ev) { return ev.date + '|' + normTitle(ev.title); }

/* AI に渡す文（system と user）。送るのは選んだトピックと、書いた銘柄・商品・調べたいことの文だけ */
export function buildPrompt(topicIds, words, today, keywords, message) {
  const ts = (topicIds || []).map(topicOf).filter(t => t && t.id !== 'kw');
  const kws = Array.isArray(keywords) ? keywords : parseKeywords(keywords);
  const msg = cleanMessage(message);
  const end = addDays(today, HORIZON_DAYS);
  const system = [
    'あなたは「日付が先に決まっている予定」を Web で調べて一覧にする係。',
    '株価・価格・相場の予測や、売買の助言は一切しない。日付と出来事と、その意味の説明だけを書く。',
    'ただし指標・金融政策・決算などは、結果が市場の予想を上回ったとき・下回ったときに、株価が一般にどう動きやすいかの'
      + '教科書的な傾向は書いてよい（「一般に〜しやすい」と書き、断定しない。今回どうなるかは書かない）。',
    '今日は ' + today + '。' + today + ' から ' + end + ' までに始まる予定だけ。日付が日まで分からないものは入れない。',
    '期間もの（キャンペーン・セール・連休）は date に始まりの日、end に終わりの日を入れる。',
    'すでに始まっていて ' + today + ' 以降に終わるキャンペーンも入れる（date は始まった日のまま）。',
    '調べ終えたら、最後に答えを ```json の囲いの中に JSON の配列で 1 つだけ書く（説明は短く。配列の外に [ ] を書かない）。各要素は次の形:',
    '{"date":"YYYY-MM-DD","end":"YYYY-MM-DD か null","title":"日本語で30字以内","topic":"トピックID",'
      + '"status":"confirmed|planned|rumor","entry":true|false,"note":"条件・上限など30字以内",'
      + '"about":"何の予定か・概要を60字以内","forecast":"市場の予想値（分かれば。無ければ null）",'
      + '"beat":"予想を上回ったときの株価の一般的な傾向40字以内（投資の予定だけ。ほかは null）",'
      + '"miss":"予想を下回ったときの株価の一般的な傾向40字以内（同上）",'
      + '"caution":"注意事項（対象外・上限・エントリー忘れ・支払い方法の条件など）50字以内。無ければ null","source":"根拠のURL"}',
    'about は、投資の予定なら「何を表す指標・会合か」、セール・キャンペーンなら「何がどれだけお得になるか」を書く。',
    'status: 公式に発表済み=confirmed、例年や暫定の見込み=planned、報道・リーク=rumor。',
    'entry: 参加にエントリー（申し込み）が要るなら true。',
    '同じキャンペーンを店や対象ごとに分けず、1件にまとめる。最大 ' + ASK_MAX + ' 件。',
    '見つからなければ空の配列 [] を書く。',
  ].join('\n');
  const lines = ts.map(t => '- ' + t.id + ': ' + t.ask);
  kws.forEach(k => lines.push('- kw: 「' + k + '」に当たる予定・キャンペーン・セールの日程（期間・エントリーの要否・条件）。topic は kw'));
  if (msg) lines.push('- kw: 利用者の頼み「' + msg + '」に当たる予定（指標・会合・決算・セール・キャンペーンなど）の日程と説明。topic は kw');
  const w = String(words || '').trim();
  const user = '次のトピックの予定を調べて。\n' + lines.join('\n')
    + (w ? '\n銘柄・商品・使っている支払い（決算日・新型・キャンペーンはこれに関わるものを優先）: ' + w : '');
  return { system, user };
}

/* AI の返事（文字）から JSON の配列を取り出す。
   2026-11-04 Issue #13「何回やっても一覧にできない」で強くした:
   - Web 検索のときは、検索の前後に説明の文（「[FOMC] を調べます」など）が混ざる。最初の [ から最後の ] までを
     読む前のやり方では、説明の中の括弧で壊れていた → 文字列の中を飛ばして括弧の対を数え、配列の候補を全部拾う
   - 返事が途中で切れた（max_tokens）ときは、閉じている要素までを拾う
   - 末尾の余分な , は許す
   候補のうち、要素がオブジェクトの配列で、いちばん長いものを返す。拾えなければ null */
function tryParse(t) {
  try { return JSON.parse(t); } catch (e) { /* 次へ */ }
  try { return JSON.parse(t.replace(/,\s*([\]}])/g, '$1')); } catch (e) { return undefined; }
}

/* s[i] が '[' のところから、対になる ']' まで（文字列の中は飛ばす）。
   閉じなければ { text: 閉じた要素までを ] で閉じたもの, cut: true } */
function scanArray(s, i) {
  let depth = 0, inStr = false, esc = false, lastTop = -1;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 1 && c === '}') lastTop = j;      /* 配列の直下の要素が閉じた */
      if (depth === 0) return { text: s.slice(i, j + 1), cut: false, end: j };
    }
  }
  return { text: lastTop > 0 ? s.slice(i, lastTop + 1) + ']' : '', cut: true, end: s.length };
}

export function extractJsonArray(text) {
  const s = String(text || '');
  let best = null;
  const consider = v => {
    if (!Array.isArray(v)) return;
    if (v.length && !v.some(x => x && typeof x === 'object' && !Array.isArray(x))) return;
    if (!best || v.length > best.length) best = v;
  };
  for (let i = s.indexOf('['); i >= 0; ) {
    /* 配列の頭らしいところだけ（[ のあとが { か ]） */
    if (/^\[\s*[{\]]/.test(s.slice(i, i + 64))) {
      const r = scanArray(s, i);
      if (r.text) consider(tryParse(r.text));
      i = s.indexOf('[', r.cut ? i + 1 : r.end + 1);
    } else {
      i = s.indexOf('[', i + 1);
    }
  }
  return best;
}

/* 説明の欄。AI が「null」「なし」と文字で書いてきたものは空にする */
function opt(s, n) {
  const t = String(s == null ? '' : s).trim();
  return /^(null|none|n\/a|なし|無し|特になし|不明|-|―|—)$/i.test(t) ? '' : clip(t, n);
}

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return Array.from(t).length > n ? Array.from(t).slice(0, n).join('') + '…' : t;
}

/* 返事を確かめて、画面に出せる形にそろえる。
   落とすもの: 日付の形が違う・過ぎた（期間ものは終わった）・見る範囲より先に始まる・題名が空・同じものの2つ目
   end が date より前・形が違うときは、期間ものとして扱わない（end を落とす）
   -> [{ date, end, title, topic, status, entry, note, source, key }]（始まりの近い順。始まっているものが先） */
export function normalizeEvents(raw, today, max) {
  const horizon = addDays(today, HORIZON_DAYS);
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    const date = String(r.date || '').trim();
    if (!validDay(date) || date > horizon) return;
    let end = String(r.end || '').trim();
    if (!validDay(end) || end < date) end = '';
    if ((end || date) < today) return;               /* 終わったもの（期間ものでなければ、過ぎたもの） */
    const title = clip(r.title, TITLE_MAX);
    if (!title) return;
    const topic = topicOf(r.topic) ? r.topic : 'other';
    const status = STATUS[r.status] ? r.status : 'planned';
    const ev = { date, end: end || null, title, topic, status, entry: r.entry === true,
      note: opt(r.note, NOTE_MAX), source: safeUrl(r.source),
      about: opt(r.about, ABOUT_MAX), forecast: opt(r.forecast, FORECAST_MAX),
      beat: opt(r.beat, MOVE_MAX), miss: opt(r.miss, MOVE_MAX), caution: opt(r.caution, CAUTION_MAX),
      /* 支払いルートの欄（ほかの予定では空） */
      steps: (Array.isArray(r.steps) ? r.steps : []).map(x => clip(x, STEP_LEN)).filter(Boolean).slice(0, STEP_MAX),
      rate: opt(r.rate, 20), cap: opt(r.cap, 40), card: opt(r.card, 30) };
    ev.key = eventKey(ev);
    if (seen.has(ev.key)) return;
    seen.add(ev.key);
    out.push(ev);
  });
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return out.slice(0, max || MAX_EVENTS);
}

/* 送るたびに一覧へ足す（2026-11-05）。同じものは新しい返事のほうを残す。
   -> { events, fresh: 新しく増えた key の Set } */
export function mergeEvents(fresh, old, today) {
  const before = new Set((Array.isArray(old) ? old : []).map(e => e && e.key));
  const events = normalizeEvents([].concat(Array.isArray(fresh) ? fresh : [], Array.isArray(old) ? old : []), today, KEEP_MAX);
  return { events, fresh: new Set(events.filter(e => !before.has(e.key)).map(e => e.key)) };
}

/* いま開催中か（始まっていて、終わっていない期間もの） */
export function isRunning(ev, today) { return !!(ev && ev.end && ev.date <= today && today <= ev.end); }

/* 今日へ出す日の決め方。's<n>' = 始まる n 日前、'e<n>' = 終わる n 日前。
   数だけ渡されたら 's<n>'（前の版の形） */
function parseLead(lead) {
  if (typeof lead === 'number' && Number.isFinite(lead)) return { base: 's', days: Math.max(0, lead) };
  const m = /^([sep])(\d{1,3})$/.exec(String(lead || ''));
  return m ? { base: m[1], days: +m[2] } : { base: 's', days: 7 };
}

/* 行ごとに選べる決め方。期間ものは「始まる前／始まる日／終わる前／終わる日」、
   日だけのものは「当日〜30日前」。すでに始まっている期間ものは、終わりを基準にしたものだけ */
export function leadOptions(ev, today) {
  if (ev && ev.topic === 'route' && !ev.end) return [{ id: 's0', label: '今日' }];   /* 常設のルート */
  if (ev && ev.end) {
    const started = !!today && ev.date <= today;
    /* 始まっているものの 's0' は、今日へ出す日が過ぎているので「今日」になる */
    const s = started ? [['s0', 'すぐ（開催中）']] : [['s7', '始まる7日前'], ['s3', '始まる3日前'], ['s0', '始まる日']];
    /* 'p0' = 期間中ずっと今日に（2026-11-05 利用者の指示）。始まる日（開催中なら今日）から終わる日まで毎日 */
    return [['p0', started ? '終わるまで毎日今日に' : '期間中ずっと今日に']].concat(s).concat([['e7', '終わる7日前'], ['e3', '終わる3日前'], ['e1', '終わる前の日'], ['e0', '終わる日']])
      .map(([id, label]) => ({ id, label }));
  }
  return LEADS.map(n => ({ id: 's' + n, label: n ? n + '日前' : '当日' }));
}

/* 既定の決め方。
   ・期間もので、エントリーが要る → 始まる日（もう始まっていれば今日）。エントリーした日から数えるものが多い
   ・期間もの → 終わる3日前（使い忘れを防ぐ。トピックの日数ではなく 3 日に揃える）
   ・日だけのもの → トピックの日数前
   ev の代わりにトピック ID を渡すと 's<日数>' */
export function defaultLead(ev, today) {
  if (typeof ev === 'string') { const t = topicOf(ev); return 's' + (t ? t.lead : 7); }
  if (ev && ev.end) return 'p0';   /* 期間中ずっと今日に浮かべる（2026-11-05 利用者の指示。前は終わる3日前／エントリー要は始まる日） */
  const t = topicOf(ev && ev.topic);
  const want = t ? t.lead : 7;
  return 's' + (LEADS.includes(want) ? want : 7);
}

/* 今日へ出す日。もう過ぎていれば今日。ev の代わりに 'YYYY-MM-DD' を渡してもよい（始まりの日として） */
export function triggerDay(ev, lead, today) {
  const e = typeof ev === 'string' ? { date: ev, end: null } : (ev || {});
  const { base, days } = parseLead(lead);
  const from = (base === 'e' && e.end) ? e.end : e.date;
  const d = addDays(from, -days);
  return (!d || d < today) ? today : d;
}

/* 今日に置く日の並び。'p'（期間中ずっと）なら今日へ出す日から終わる日まで毎日（FLOAT_MAX 日まで）。
   ほかは今日へ出す日の 1 日だけ */
export const FLOAT_MAX = 62;
export function floatDays(ev, lead, today) {
  const first = triggerDay(ev, lead, today);
  if (parseLead(lead).base !== 'p' || !ev || !ev.end || ev.end < first) return [first];
  const out = [];
  for (let d = first; d <= ev.end && out.length < FLOAT_MAX; d = addDays(d, 1)) out.push(d);
  return out;
}

/* 'YYYY-MM-DD' -> 'M/D' */
export function md(key) {
  const m = DAY_RE.exec(String(key || ''));
  return m ? (+m[2]) + '/' + (+m[3]) : '';
}

/* 一覧と名前に出す日付。期間ものは 'M/D〜M/D' */
export function span(ev) { return ev.end ? md(ev.date) + '〜' + md(ev.end) : md(ev.date); }

export function bubbleText(ev) { return ev.topic === 'route' && !ev.end ? ev.title : ev.title + '（' + span(ev) + '）'; }

export function detailText(ev, today) {
  const t = topicOf(ev.topic);
  return [
    (ev.topic === 'route' && !ev.end ? '常設のルート（' + today + ' に使えた）'
      : (ev.end ? '期間: ' + ev.date + ' 〜 ' + ev.end : '日付: ' + ev.date)) + '（' + (STATUS[ev.status] || '予定') + '）',
    routeLine(ev) ? 'ルート: ' + routeLine(ev) : '',
    ev.rate ? '還元率: ' + ev.rate : '',
    ev.cap ? '上限: ' + ev.cap : '',
    ev.about ? '説明: ' + ev.about : '',
    ev.forecast ? '予想: ' + ev.forecast : '',
    ev.beat ? '予想を上回ったら: ' + ev.beat : '',
    ev.miss ? '予想を下回ったら: ' + ev.miss : '',
    (ev.beat || ev.miss) ? '（値動きは一般的な傾向で、今回の予測ではない）' : '',
    ev.entry ? 'エントリーが要る' : '',
    ev.note ? '条件: ' + ev.note : '',
    ev.caution ? '注意: ' + ev.caution : '',
    t ? '見るもの: ' + t.label : '',
    ev.source ? '出典: ' + ev.source : '',
    '調べた日: ' + today + '（AI が Web で調べた。日付は出典で確かめる）',
    MARK + ev.key,
  ].filter(Boolean).join('\n');
}

/* もう入れてある予定の印の集まり（生きているバブルの本文から読む） */
export function addedKeys(items) {
  const set = new Set();
  (items || []).forEach(t => {
    const d = String((t && t.detail) || '');
    const i = d.lastIndexOf(MARK);
    if (i >= 0) set.add(d.slice(i + MARK.length).split('\n')[0].trim());
  });
  return set;
}

/* 選んだ予定をバブルにする。picks = [{ ev, lead }]
   今日へ出す日が先なら「長期保留（その日にもどる）＋その日に置く」。
   その日になると sweepHolds が保留を解き、days に入っているので今日の水面に出る。
   今日へ出す日が今日なら、そのまま今日に置く。
   -> { added: [todo], skipped: n }（もう入れてある・読むだけの海などで入らなかった数） */
export function addEvents(store, picks, today) {
  const added = [];
  let skipped = 0;
  const have = addedKeys(store.all ? store.all() : []);
  (picks || []).forEach(({ ev, lead }) => {
    if (!ev || have.has(ev.key)) { skipped++; return; }
    const days = floatDays(ev, lead, today);      /* ev ごと渡す（期間ものは終わりの日も見る） */
    const day = days[0];
    const t = store.add(bubbleText(ev));
    if (!t) { skipped++; return; }
    store.setDetail(t.id, detailText(ev, today));
    /* 期間の正本は start・due（共有の記録 v1.1）。本文の「期間:」「日付:」の行は予定の説明として残す */
    if (typeof store.setSpan === 'function' && !(ev.topic === 'route' && !ev.end)) store.setSpan(t.id, ev.date, ev.end || ev.date);
    if (ev.source) store.setUrl(t.id, ev.source);
    if (day > today) store.setHold(t.id, true, day);
    days.forEach(d => store.setDay(t.id, d, true));   /* 期間中ずっと: 終わる日まで毎日の今日に置く */
    have.add(ev.key);
    added.push(t);
  });
  return { added, skipped };
}
