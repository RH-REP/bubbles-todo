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
     エントリーが要るもの（entry）は既定で「始まる日」——還元はエントリーした日から数えるものが多いため */

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

export const DEFAULT_TOPICS = ['fomc', 'earnings', 'sale', 'console', 'china', 'pay', 'points'];
/* 見るものの版。上げたときに足したトピック（前の版で保存した端末にも、既定で付ける） */
export const TOPICS_VER = 2;
export const TOPICS_ADDED = { 2: ['pay', 'points'] };
export const NOTE_MAX = 40;
export const LEADS = [0, 3, 7, 14, 30];        /* 行ごとに選べる「何日前」 */
export const HORIZON_DAYS = 180;                /* 今日からどこまで先を見るか */
export const MAX_EVENTS = 40;
export const TITLE_MAX = 40;
export const STATUS = { confirmed: '確定', planned: '予定', rumor: '噂' };
export const MARK = '先の予定: ';                /* 本文の最後の行の頭（重なりの印） */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function topicOf(id) { return TOPICS.find(t => t.id === id) || null; }

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

/* AI に渡す文（system と user）。送るのは選んだトピックと、書いた銘柄・商品だけ */
export function buildPrompt(topicIds, words, today) {
  const ts = (topicIds || []).map(topicOf).filter(Boolean);
  const end = addDays(today, HORIZON_DAYS);
  const system = [
    'あなたは「日付が先に決まっている予定」を Web で調べて一覧にする係。',
    '株価・価格・相場の予測や、売買の助言は一切しない。日付と出来事だけを書く。',
    '今日は ' + today + '。' + today + ' から ' + end + ' までに始まる予定だけ。日付が日まで分からないものは入れない。',
    '期間もの（キャンペーン・セール・連休）は date に始まりの日、end に終わりの日を入れる。',
    'すでに始まっていて ' + today + ' 以降に終わるキャンペーンも入れる（date は始まった日のまま）。',
    '答えは JSON の配列だけ（前後に説明を書かない）。各要素は次の形:',
    '{"date":"YYYY-MM-DD","end":"YYYY-MM-DD か null","title":"日本語で30字以内","topic":"トピックID",'
      + '"status":"confirmed|planned|rumor","entry":true|false,"note":"条件・上限など20字以内","source":"根拠のURL"}',
    'status: 公式に発表済み=confirmed、例年や暫定の見込み=planned、報道・リーク=rumor。',
    'entry: 参加にエントリー（申し込み）が要るなら true。',
    '同じキャンペーンを店や対象ごとに分けず、1件にまとめる。最大 ' + MAX_EVENTS + ' 件。',
  ].join('\n');
  const lines = ts.map(t => '- ' + t.id + ': ' + t.ask);
  const w = String(words || '').trim();
  const user = '次のトピックの予定を調べて。\n' + lines.join('\n')
    + (w ? '\n銘柄・商品・使っている支払い（決算日・新型・キャンペーンはこれに関わるものを優先）: ' + w : '');
  return { system, user };
}

/* AI の返事（文字）から JSON の配列を取り出す。```json の囲いや前置きがあっても拾う */
export function extractJsonArray(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(body.slice(a, b + 1));
    return Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return Array.from(t).length > n ? Array.from(t).slice(0, n).join('') + '…' : t;
}

/* 返事を確かめて、画面に出せる形にそろえる。
   落とすもの: 日付の形が違う・過ぎた（期間ものは終わった）・見る範囲より先に始まる・題名が空・同じものの2つ目
   end が date より前・形が違うときは、期間ものとして扱わない（end を落とす）
   -> [{ date, end, title, topic, status, entry, note, source, key }]（始まりの近い順。始まっているものが先） */
export function normalizeEvents(raw, today) {
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
      note: clip(r.note, NOTE_MAX), source: safeUrl(r.source) };
    ev.key = eventKey(ev);
    if (seen.has(ev.key)) return;
    seen.add(ev.key);
    out.push(ev);
  });
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return out.slice(0, MAX_EVENTS);
}

/* いま開催中か（始まっていて、終わっていない期間もの） */
export function isRunning(ev, today) { return !!(ev && ev.end && ev.date <= today && today <= ev.end); }

/* 今日へ出す日の決め方。's<n>' = 始まる n 日前、'e<n>' = 終わる n 日前。
   数だけ渡されたら 's<n>'（前の版の形） */
function parseLead(lead) {
  if (typeof lead === 'number' && Number.isFinite(lead)) return { base: 's', days: Math.max(0, lead) };
  const m = /^([se])(\d{1,3})$/.exec(String(lead || ''));
  return m ? { base: m[1], days: +m[2] } : { base: 's', days: 7 };
}

/* 行ごとに選べる決め方。期間ものは「始まる前／始まる日／終わる前／終わる日」、
   日だけのものは「当日〜30日前」。すでに始まっている期間ものは、終わりを基準にしたものだけ */
export function leadOptions(ev, today) {
  if (ev && ev.end) {
    const started = !!today && ev.date <= today;
    /* 始まっているものの 's0' は、今日へ出す日が過ぎているので「今日」になる */
    const s = started ? [['s0', 'すぐ（開催中）']] : [['s7', '始まる7日前'], ['s3', '始まる3日前'], ['s0', '始まる日']];
    return s.concat([['e7', '終わる7日前'], ['e3', '終わる3日前'], ['e1', '終わる前の日'], ['e0', '終わる日']])
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
  if (ev && ev.end) return ev.entry ? 's0' : 'e3';
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

/* 'YYYY-MM-DD' -> 'M/D' */
export function md(key) {
  const m = DAY_RE.exec(String(key || ''));
  return m ? (+m[2]) + '/' + (+m[3]) : '';
}

/* 一覧と名前に出す日付。期間ものは 'M/D〜M/D' */
export function span(ev) { return ev.end ? md(ev.date) + '〜' + md(ev.end) : md(ev.date); }

export function bubbleText(ev) { return ev.title + '（' + span(ev) + '）'; }

export function detailText(ev, today) {
  const t = topicOf(ev.topic);
  return [
    (ev.end ? '期間: ' + ev.date + ' 〜 ' + ev.end : '日付: ' + ev.date) + '（' + (STATUS[ev.status] || '予定') + '）',
    ev.entry ? 'エントリーが要る' : '',
    ev.note ? '条件: ' + ev.note : '',
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
    const day = triggerDay(ev, lead, today);      /* ev ごと渡す（期間ものは終わりの日も見る） */
    const t = store.add(bubbleText(ev));
    if (!t) { skipped++; return; }
    store.setDetail(t.id, detailText(ev, today));
    if (ev.source) store.setUrl(t.id, ev.source);
    if (day > today) store.setHold(t.id, true, day);
    store.setDay(t.id, day, true);
    have.add(ev.key);
    added.push(t);
  });
  return { added, skipped };
}
