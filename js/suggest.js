/* 今日のおすすめ（2026-11-07。利用者の指示 Issue #12「おすすめのとおり」）。
   計算だけ。DOM・保存・通信は触らない（板は js/screens/today.js、通信は js/ai.js askFull）。

   ■ 何をするか
   今日の画面の「おすすめ」を押すと、今日に置くとよさそうな泡を 3〜5 件、短い理由つきで出す。
   **自動では移さない。**選んだものだけを今日（映している日）に置く（README「未処理の山を、罰として突き返さない。」）。

   ■ 2段
   1. 端末の中の決まった規則（localPicks）。キーが無くても、電波が無くても出る。送らない。
   2. [AI で選び直す] を押したときだけ、端末で絞った候補（CAND_MAX 件まで）の **名前と印だけ** を Anthropic へ送り、
      名前の意味・季節・曜日も考えて選び直してもらう（buildSuggestPrompt / parseSuggest）。

   ■ 送るもの（Issue #12 で決めた案 a）
   候補の泡の名前と印（急ぐ・大事・お気に入り・タグ名・作った日・最後にはじめた日・次の一手があるか）と今日の日付。
   **本文・作業メモ（次の一手の文）・ひとこと・リンクは送らない。**候補に入らなかった泡も送らない。

   ■ 候補にしないもの
   完了・消したもの・もうその日にあるもの・長期保留（戻る日が来たものは store.sweepHolds が海へ戻している）・
   きっかけにぶら下げたもの（きっかけが来たら出る計画なので、ここで今日へ引かない）。

   ■ 言い方
   件数・割合・「◯日放置」のような文は出さない。理由は命令形にしない（〜しよう・〜すべき を使わない）。 */

export const CAND_MAX = 30;    /* AI へ送る候補の上限 */
export const PICK_MAX = 5;     /* 板に出す数の上限 */
export const PICK_MIN = 3;
export const REASON_MAX = 24;  /* 理由の字数の上限 */

const DAY = 86400000;
const RECENT_DAYS = 7;         /* 「最近はじめた」とみなす日数 */

function chars(s) { return Array.from(String(s == null ? '' : s)); }

function dayKeyOf(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 記録の1件から、比べるのに使う形を作る。
   t = store の項目。info = { tags:[名前], firstStep:bool }（store から画面が引いて渡す）。 */
export function describe(t, info) {
  const i = info || {};
  const started = (t && t.started && typeof t.started === 'object') ? Object.values(t.started).filter(Number.isFinite) : [];
  return {
    id: t.id,
    text: String(t.text || ''),
    urgent: t.urgent === true,
    important: t.important === true,
    fav: !!t.fav,
    tags: Array.isArray(i.tags) ? i.tags.filter(Boolean).map(String) : [],
    firstStep: !!i.firstStep,
    createdAt: Number(t.createdAt) || 0,
    lastStarted: started.length ? Math.max(...started) : 0,
  };
}

/* 候補にしてよいか。day = 置く先の日 'YYYY-MM-DD' */
export function eligible(t, day) {
  if (!t || t.trashed || t.done || t.hold) return false;
  if (Array.isArray(t.days) && t.days.indexOf(day) >= 0) return false;
  if (Array.isArray(t.anchors) && t.anchors.length) return false;
  return !!String(t.text || '').trim();
}

/* 決まった規則の点と理由。now = 時刻（ms） */
export function scoreOf(c, now) {
  const why = [];
  let s = 0;
  if (c.urgent && c.important) { s += 5; why.push('急ぐ・大事'); }
  else if (c.urgent) { s += 3; why.push('急ぐ'); }
  else if (c.important) { s += 2; why.push('大事'); }
  if (c.lastStarted && now - c.lastStarted <= RECENT_DAYS * DAY) { s += 2; why.push('最近はじめた'); }
  if (c.firstStep) { s += 1; why.push('次の一手が書いてある'); }
  if (c.fav) { s += 1; why.push('お気に入り'); }
  return { score: s, reason: why.slice(0, 2).join('・') };
}

/* 規則で並べた候補。-> [{ ...c, score, reason }]（点の高い順、同点は新しく書いた順） */
export function rank(list, now) {
  return list.map(c => Object.assign({}, c, scoreOf(c, now)))
    .sort((a, b) => (b.score - a.score) || (b.lastStarted - a.lastStarted) || (b.createdAt - a.createdAt));
}

/* 端末だけのおすすめ。点が付いたものから PICK_MAX 件。点の付いたものが PICK_MIN に満たなければ、
   新しく書いたもので PICK_MIN まで埋める（理由は「最近書いた」）。 */
export function localPicks(list, now) {
  const r = rank(list, now);
  const out = r.filter(c => c.score > 0).slice(0, PICK_MAX);
  if (out.length < PICK_MIN) {
    const rest = r.filter(c => c.score <= 0).sort((a, b) => b.createdAt - a.createdAt);
    rest.slice(0, PICK_MIN - out.length).forEach(c => out.push(Object.assign({}, c, { reason: '最近書いた' })));
  }
  return out;
}

/* AI へ送る候補。規則の上位から CAND_MAX 件 */
export function sendList(list, now) {
  return rank(list, now).slice(0, CAND_MAX);
}

/* 候補 1 件を、送る 1 行にする。名前と印だけ */
export function lineOf(c, n) {
  const marks = [];
  if (c.urgent) marks.push('急ぐ');
  if (c.important) marks.push('大事');
  if (c.fav) marks.push('お気に入り');
  if (c.firstStep) marks.push('次の一手あり');
  if (c.tags.length) marks.push('タグ:' + c.tags.slice(0, 5).join('/'));
  if (c.createdAt) marks.push('作った日:' + dayKeyOf(c.createdAt));
  if (c.lastStarted) marks.push('最後にはじめた日:' + dayKeyOf(c.lastStarted));
  const name = chars(c.text.replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
  return n + '. ' + name + (marks.length ? ' ［' + marks.join('、') + '］' : '');
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/* -> { system, user }。day = 置く先の日 'YYYY-MM-DD' */
export function buildSuggestPrompt(cands, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  const dow = m ? DOW[new Date(+m[1], +m[2] - 1, +m[3], 12).getDay()] : '';
  const system = [
    'あなたは todo の一覧から、その日に取りかかるとよさそうなものを選ぶ係。',
    'その日は ' + day + (dow ? '（' + dow + '）' : '') + '。',
    '考えに入れること: 急ぐ・大事の印、最近はじめたか、次の一手が書いてあるか、名前の意味（季節・時期・曜日に合うか、期限がありそうか）。',
    PICK_MIN + '〜' + PICK_MAX + ' 件を選ぶ。候補が少なければ少なくてよい。',
    '理由は ' + REASON_MAX + ' 字以内の短い言葉。命令形（〜しよう・〜すべき・〜しなさい）や、責める言い方（放置・遅れ・溜まっている）は使わない。',
    '件数や割合は書かない。',
    '返すのは JSON の配列だけ: [{"n": 番号, "reason": "理由"}]。前置き・説明・コードの囲みは書かない。',
  ].join('\n');
  const user = '候補:\n' + cands.map((c, i) => lineOf(c, i + 1)).join('\n');
  return { system, user };
}

const BAD_WORDS = /(ましょう|しよう|やろう|べき|なさい|放置|遅れ|溜ま)/;

/* 理由の文を整える。命令形・責める言い方を含むものは空にする（呼び手が規則の理由に戻す） */
export function cleanReason(s) {
  let r = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[*#`]/g, '').trim();
  r = r.replace(/[。．.]+$/, '');
  if (BAD_WORDS.test(r)) return '';
  return chars(r).slice(0, REASON_MAX).join('');
}

/* 返事を読む。-> [{ ...c, reason, ai:true }]（番号の重なり・範囲外は落とす）。読めなければ null */
export function parseSuggest(text, cands) {
  const s = String(text || '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let arr;
  try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  if (!Array.isArray(arr)) return null;
  const seen = new Set();
  const out = [];
  arr.forEach(x => {
    const n = Number(x && x.n);
    if (!Number.isInteger(n) || n < 1 || n > cands.length || seen.has(n)) return;
    if (out.length >= PICK_MAX) return;
    seen.add(n);
    const c = cands[n - 1];
    out.push(Object.assign({}, c, { reason: cleanReason(x.reason) || c.reason || '', ai: true }));
  });
  return out;
}
