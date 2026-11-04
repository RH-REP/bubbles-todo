/* 先の予定（AI）の中身の計算（2026-11-04。利用者の指示 Issue #13）。

   画面（js/upcoming.js）と AI（js/ai.js）から切り離した、素の計算だけを置く。
   DOM も localStorage も fetch も触らない（tests/events.test.mjs が Node で直接読む）。

   ■ 決めごと（Issue #13 のコメントで決めたもの）
   - **予測はしない。**扱うのは「日付が先に分かっている予定」だけ（選挙・FOMC・決算日・セール・休日など）。
     値動き（株価・買取価格）は取らない・出さない
   - 1件ごとに「確定 / 予定 / 噂」を持つ。噂は初めはチェックを外しておく
   - 今日へ出す日 = 予定の日 − 何日前（トピックごとの既定。行ごとに変えられる）
   - 同じ予定を二度入れない。印はバブルの本文の最後の行（`先の予定: <日付>|<題名>`）。
     本文は同期・CSV に乗るので、ほかの端末で入れたものも重ならない */

/* 見るもの（トピック）。lead = 何日前に今日へ出すか（既定） */
export const TOPICS = [
  { id: 'fomc',     group: '投資',   label: 'FOMC・日銀の会合',             lead: 14,
    ask: 'FOMC（米連邦公開市場委員会）と日本銀行の金融政策決定会合の日程' },
  { id: 'macro',    group: '投資',   label: '米国の CPI・雇用統計',          lead: 3,
    ask: '米国 CPI と雇用統計の発表日' },
  { id: 'earnings', group: '投資',   label: '下の銘柄の決算発表',            lead: 7,
    ask: '「銘柄・商品」に書いた銘柄の決算発表日' },
  { id: 'election', group: '投資',   label: '選挙（米国・日本）',            lead: 14,
    ask: '米国と日本の国政選挙の投票日' },
  { id: 'sale',     group: 'せどり', label: 'Amazon・楽天の大型セール',      lead: 7,
    ask: 'Amazon（プライムデー・ブラックフライデーなど）と楽天（スーパーセール・お買い物マラソン）の大型セールの開始日' },
  { id: 'console',  group: 'せどり', label: 'ゲーム機・VR のセール・新型・値上げ', lead: 7,
    ask: 'PlayStation 5・Meta Quest・Nintendo Switch など、ゲーム機と VR 機の公式セール・新型の発売日・価格改定の実施日' },
  { id: 'china',    group: 'せどり', label: '中国の連休・商戦（春節・618・双11）', lead: 7,
    ask: '中国の春節・労働節・国慶節の連休の始まりと、618・双11 の商戦の日' },
  { id: 'holiday',  group: '休日',   label: '休日（日本・米国・中国・UAE）', lead: 3,
    ask: '日本・米国・中国・アラブ首長国連邦（ドバイ）の祝日と、東京・米国・上海の市場の休場日' },
];

export const DEFAULT_TOPICS = ['fomc', 'earnings', 'sale', 'console', 'china'];
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
    '今日は ' + today + '。' + today + ' から ' + end + ' までの予定だけ。日付が日まで分からないものは入れない。',
    '答えは JSON の配列だけ（前後に説明を書かない）。各要素は次の形:',
    '{"date":"YYYY-MM-DD","title":"日本語で30字以内","topic":"トピックID","status":"confirmed|planned|rumor","source":"根拠のURL"}',
    'status: 公式に発表済み=confirmed、例年や暫定の見込み=planned、報道・リーク=rumor。',
    '連休や期間ものは始まりの日を date にする。最大 ' + MAX_EVENTS + ' 件。',
  ].join('\n');
  const lines = ts.map(t => '- ' + t.id + ': ' + t.ask);
  const w = String(words || '').trim();
  const user = '次のトピックの予定を調べて。\n' + lines.join('\n')
    + (w ? '\n銘柄・商品: ' + w : '');
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

/* 返事を確かめて、画面に出せる形にそろえる。
   落とすもの: 日付の形が違う・過ぎた・見る範囲より先・題名が空・同じものの2つ目
   -> [{ date, title, topic, status, source, key }]（日付の近い順） */
export function normalizeEvents(raw, today) {
  const end = addDays(today, HORIZON_DAYS);
  const seen = new Set();
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    const date = String(r.date || '').trim();
    if (!validDay(date) || date < today || date > end) return;
    let title = String(r.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    if (Array.from(title).length > TITLE_MAX) title = Array.from(title).slice(0, TITLE_MAX).join('') + '…';
    const topic = topicOf(r.topic) ? r.topic : 'other';
    const status = STATUS[r.status] ? r.status : 'planned';
    const ev = { date, title, topic, status, source: safeUrl(r.source) };
    ev.key = eventKey(ev);
    if (seen.has(ev.key)) return;
    seen.add(ev.key);
    out.push(ev);
  });
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return out.slice(0, MAX_EVENTS);
}

export function defaultLead(topicId) {
  const t = topicOf(topicId);
  return t ? t.lead : 7;
}

/* 今日へ出す日。もう過ぎていれば今日 */
export function triggerDay(date, lead, today) {
  const d = addDays(date, -Math.max(0, Number(lead) || 0));
  return (!d || d < today) ? today : d;
}

/* 'YYYY-MM-DD' -> 'M/D' */
export function md(key) {
  const m = DAY_RE.exec(String(key || ''));
  return m ? (+m[2]) + '/' + (+m[3]) : '';
}

export function bubbleText(ev) { return ev.title + '（' + md(ev.date) + '）'; }

export function detailText(ev, today) {
  const t = topicOf(ev.topic);
  return [
    '日付: ' + ev.date + '（' + (STATUS[ev.status] || '予定') + '）',
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
    const day = triggerDay(ev.date, lead, today);
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
