/* 1件の todo について AI に「調べる」「整理する」を頼む、その計算だけ（2026-11-05。Issue #17）。
   DOM・保存・通信は触らない（呼ぶのは js/bubble.js の本文の面、通信は js/ai.js）。

   ■ 何をするか
   - 調べる: 名前と本文を読んで、取りかかるのに役立つことを Web で調べ、短くまとめる。
     本文の末尾に「── AI で調べた（M/D）──」の見出しを付けて**足す**（書いてあったものは消さない）。
   - 整理する: 本文を見出しと箇条書きに並べ替える。事実・数字・URL・日付は残し、新しい事実は足さない。
     本文を**置き換える**ので、先に見せて押したときだけ入れる。元の URL が消えていたら知らせる。

   ■ 送るもの
   押したときだけ、その泡の名前と本文（と今日の日付）を Anthropic へ送る。
   ほかの泡・作業メモ・タグ・記録は送らない。 */

export const SEND_MAX = 4000;          /* 送る本文の上限（字）。長すぎる本文は頭から切って送る */
export const SECTION_HEAD = '── AI で調べた';

function chars(s) { return Array.from(String(s == null ? '' : s)); }

export function clipSend(s, n) {
  const a = chars(s);
  const m = n || SEND_MAX;
  return a.length > m ? a.slice(0, m).join('') + '\n（ここから先は長いので送っていない）' : a.join('');
}

function md(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  return m ? (+m[2]) + '/' + (+m[3]) : '';
}

const PLAIN = '書式はプレーンテキスト。Markdown の #・**・表は使わない。見出しは【】、箇条書きは行頭の「・」。';

/* 調べる。-> { system, user } */
export function buildResearchPrompt(name, detail, today) {
  const system = [
    'あなたは todo の1件について、取りかかるのに役立つ情報を Web で調べて、短く整理する係。',
    '今日は ' + today + '。',
    '書くこと: 手順・必要なもの・期限や受付時間・費用の目安・気をつけること・公式の窓口 のうち、この todo に関わるものだけ。',
    '本文にすでに書いてあることは繰り返さない。調べて分からなかったことは書かない（推測で埋めない）。',
    '医療・法律・税・投資は一般的な情報に留め、個別の判断や売買の助言はしない。',
    '命令形（〜しなさい・〜しましょう）を使わない。',
    PLAIN,
    '全体で 600 字以内。最後の行は「出典: 」に続けて、根拠にした URL を3つまで（空白で区切る）。',
    '前置き（「調べます」など）やあとがきは書かず、まとめだけを返す。',
  ].join('\n');
  const d = String(detail || '').trim();
  const user = '名前: ' + String(name || '').trim()
    + '\n本文:\n' + (d ? clipSend(d) : '（まだ無い）');
  return { system, user };
}

/* 整理する。-> { system, user } */
export function buildTidyPrompt(name, detail) {
  const system = [
    'あなたは todo の本文を読みやすく整える係。',
    '書かれている事実・数字・日付・URL・固有名詞はすべて残す。新しい事実は足さない。意味を変えない。',
    '重なりをまとめ、見出しと箇条書きに並べ替える。「── AI で調べた（…）──」の区切りがあれば、その中身も同じように整えてよい。',
    PLAIN,
    '返すのは整えた本文だけ（前置き・あとがき・説明は書かない）。',
  ].join('\n');
  const user = '名前: ' + String(name || '').trim() + '\n本文:\n' + clipSend(String(detail || '').trim());
  return { system, user };
}

/* AI の返事を、本文に入れられる形にそろえる（Markdown の印を外す）。 */
export function cleanText(text) {
  let s = String(text || '').replace(/\r\n?/g, '\n');
  s = s.replace(/^```[^\n]*\n?/gm, '');                       /* 囲いの線 */
  s = s.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '【$1】'); /* # 見出し -> 【】 */
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  s = s.replace(/^(\s*)[-*+]\s+/gm, '$1・');                  /* - 箇条 -> ・ */
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2');  /* [字](URL) -> 字 URL */
  s = s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/* 調べた結果を本文の末尾に足す。本文が空なら見出しから始める */
export function appendSection(detail, text, today) {
  const d = String(detail || '').replace(/\s+$/, '');
  const t = String(text || '').trim();
  if (!t) return d;
  const head = SECTION_HEAD + (md(today) ? '（' + md(today) + '）' : '') + ' ──';
  return (d ? d + '\n\n' : '') + head + '\n' + t;
}

function urls(s) {
  return String(s || '').match(/https?:\/\/[^\s)\]」』>、。]+/g) || [];
}

/* 整理の前にあった URL のうち、整理のあとに無いもの（置き換える前に知らせるため） */
export function lostUrls(before, after) {
  const have = new Set(urls(after));
  return Array.from(new Set(urls(before))).filter(u => !have.has(u));
}

/* 失敗の理由を、画面に出す1行にする */
export function failLine(kind, stop, searchError) {
  if (stop === 'max_tokens') return '返事が途中で切れた。本文が長いと起きる。もう一度押すか、本文を短くして試す。';
  if (searchError) return 'Web 検索が使えなかった（' + searchError + '）。しばらくして試す。';
  if (stop === 'refusal') return 'AI が答えなかった。';
  if (kind === 'name') return '名前の案が返ってこなかった。';
  return kind === 'tidy' ? '整えた本文が返ってこなかった。' : '調べた結果が返ってこなかった。';
}

/* ---- 名前を作る（2026-11-07。Issue #11）----
   泡の名前は 18 字で切れる（js/app.js trimText）。長い名前や本文から、泡に収まる短い名前の案を作らせる。
   送るのは押したときだけ、その泡の名前と本文（上と同じ）。 */
export const NAME_MAX = 18;

/* -> { system, user } */
export function buildNamePrompt(name, detail) {
  const system = [
    'あなたは todo の短い名前を付ける係。',
    '名前と本文を読み、何をする todo かが一目で分かる名前を1つだけ返す。',
    NAME_MAX + ' 字以内（' + Math.round(NAME_MAX / 2) + '〜' + NAME_MAX + ' 字がよい）。動詞で終えるか、「〜の〜」の形にする。',
    '固有名詞・日付・数字は、要るものだけ残す。本文に無いことは足さない。',
    '括弧・引用符・句点・絵文字・前置き・説明は付けず、名前の文字だけを1行で返す。',
  ].join('\n');
  const d = String(detail || '').trim();
  const user = '名前: ' + String(name || '').trim()
    + '\n本文:\n' + (d ? clipSend(d) : '（まだ無い）');
  return { system, user };
}

/* AI の返事を名前1つにそろえる。読めなければ '' */
export function cleanName(text) {
  let s = cleanText(text).split('\n').map(l => l.trim()).find(l => l) || '';
  s = s.replace(/^(名前|案)\s*[:：]\s*/, '').replace(/^・/, '');
  s = s.replace(/[。．.]+$/, '').replace(/^[「『"'“‘【(（]+|[」』"'”’】)）]+$/g, '').replace(/[。．.]+$/, '').trim();
  const a = chars(s);
  return a.length > NAME_MAX ? a.slice(0, NAME_MAX).join('') : s;
}

/* 名前を案に替えるとき、本文が空なら元の長い名前を本文へ移す（打った全文を失わないため）。
   -> { name, detail } */
export function applyName(oldName, detail, newName) {
  const o = String(oldName || '').trim();
  const d = String(detail || '');
  const moved = !d.trim() && chars(o).length > NAME_MAX && o !== newName;
  return { name: newName, detail: moved ? o : d };
}

/* ---- 改善のコメントの題名を作る（2026-11-07。Issue #10）----
   右上の ! の「AI で題名」を押したときだけ、そのコメントの文を送る（画面 ID・件数・写真・泡の中身は送らない）。
   返った題名は欄に入るだけで、直してから GitHub を開く。`[画面ID] ` は js/feedback.js が前に付ける。 */
export const ISSUE_TITLE_MAX = 40;

/* -> { system, user } */
export function buildIssueTitlePrompt(comment) {
  const system = [
    'あなたは、アプリの改善のコメントから GitHub の Issue の題名を付ける係。',
    'コメントを読み、何を直してほしいか（どこで・何が）が一目で分かる題名を1つだけ返す。',
    '15〜30 字（' + ISSUE_TITLE_MAX + ' 字まで）。体言止めか「〜したい」「〜しない」の形にする。',
    'コメントに無いことは足さない。原因の推測は書かない。',
    '括弧・引用符・句点・絵文字・前置き・説明は付けず、題名の文字だけを1行で返す。',
  ].join('\n');
  return { system, user: 'コメント:\n' + clipSend(String(comment || '').trim()) };
}

/* AI の返事を題名1つにそろえる。読めなければ '' */
export function cleanIssueTitle(text) {
  let s = cleanText(text).split('\n').map(l => l.trim()).find(l => l) || '';
  s = s.replace(/^(題名|タイトル|案)\s*[:：]\s*/, '').replace(/^・/, '').replace(/^\[[^\]]*\]\s*/, '');
  s = s.replace(/[。．.]+$/, '').replace(/^[「『"'“‘【(（]+|[」』"'”’】)）]+$/g, '').replace(/[。．.]+$/, '').trim();
  const a = chars(s);
  return a.length > ISSUE_TITLE_MAX ? a.slice(0, ISSUE_TITLE_MAX).join('') : s;
}

/* ---- 書いて頼む（2026-11-07。Issue #15 案 A）----
   本文の面の欄に「期限とお得な納税方法を調べて」のように書いて送ると、Web で調べて
   まとめ・期限・関連 TODO の候補を返させる。
   送るのは**その泡の名前と書いた文だけ**（と今日の日付）。本文・作業メモ・タグ・記録は送らない（案 A）。
   返事は「まとめ」の文のあとに ```json {"deadline":..,"todos":[..]} ``` を付けさせ、parseAskReply で分ける。 */
export const ASK_MAX = 500;            /* 書いた文の上限（字） */
export const TODO_MAX = 5;             /* 関連 TODO の候補の数 */
export const TODO_NAME_MAX = 30;       /* 関連 TODO の名前の上限（字） */
export const DEADLINE_LEAD = 3;        /* 期限の何日前に置くか */

/* -> { system, user } */
export function buildAskPrompt(name, request, today) {
  const system = [
    'あなたは todo の1件について、頼まれたことを Web で調べて短く整理する係。',
    '今日は ' + today + '。',
    '頼まれたことに答える。調べて分からなかったことは書かない（推測で埋めない）。期間・期限・キャンペーンは、今日より後に有効なものを優先し、日付をはっきり書く。',
    '医療・法律・税・投資は一般的な情報に留め、個別の判断や売買の助言はしない。',
    '命令形（〜しなさい・〜しましょう）を使わない。',
    PLAIN,
    'まとめは 600 字以内。まとめの最後の行は「出典: 」に続けて、根拠にした URL を3つまで（空白で区切る）。',
    'まとめのあとに、```json で囲んだ JSON を1つだけ付ける。形は {"deadline": "YYYY-MM-DD" または null, "todos": ["…", …]}。',
    'deadline: この todo を済ませるべき期限が調べて分かったときだけ、その日付。分からなければ null。',
    'todos: この todo を済ませるために別に要る作業（例: 書類をそろえる・申請する）を ' + TODO_MAX + ' 件まで。各 ' + TODO_NAME_MAX + ' 字以内の短い名前（動詞で終える）。要らなければ []。',
    '前置き（「調べます」など）やあとがきは書かない。',
  ].join('\n');
  const r = chars(String(request || '').trim()).slice(0, ASK_MAX).join('');
  const user = '名前: ' + String(name || '').trim() + '\n頼みごと: ' + r;
  return { system, user };
}

function validDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) ? m[0] : null;
}

/* 'YYYY-MM-DD' に n 日足す */
export function addDaysKey(key, n) {
  const k = validDay(key);
  if (!k) return null;
  const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/* 期限から、今日へ出す日（期限の DEADLINE_LEAD 日前。それが過ぎていれば今日）。期限が今日より前なら null */
export function leadDay(deadline, today) {
  const d = validDay(deadline);
  const t = validDay(today);
  if (!d || !t || d < t) return null;
  const k = addDaysKey(d, -DEADLINE_LEAD);
  return k < t ? t : k;
}

/* 返事を { summary, deadline, todos } に分ける。JSON が読めなければ summary だけ */
export function parseAskReply(text, today) {
  const s = String(text || '');
  const re = /```json\s*([\s\S]*?)```/gi;
  let m, last = null;
  while ((m = re.exec(s))) last = m;
  let obj = null;
  let body = s;
  if (last) {
    body = s.slice(0, last.index) + s.slice(last.index + last[0].length);
    try { obj = JSON.parse(last[1]); } catch (e) { obj = null; }
  } else {
    /* 囲いが無く、最後に {…"todos"…} だけ置いた返事も拾う */
    const i = s.lastIndexOf('{"');
    if (i >= 0 && /"todos"|"deadline"/.test(s.slice(i))) {
      try { obj = JSON.parse(s.slice(i)); body = s.slice(0, i); } catch (e) { obj = null; }
    }
  }
  const summary = cleanText(body);
  let deadline = (obj && typeof obj === 'object') ? validDay(obj.deadline) : null;
  const t = validDay(today);
  if (deadline && t && deadline < t) deadline = null;     /* 過ぎた期限は使わない */
  const seen = new Set();
  const todos = (obj && Array.isArray(obj.todos) ? obj.todos : [])
    .map(x => cleanText(typeof x === 'string' ? x : '').split('\n')[0].replace(/^・/, '').replace(/[。．.]+$/, '').trim())
    .filter(x => x && !seen.has(x) && seen.add(x))
    .map(x => { const a = chars(x); return a.length > TODO_NAME_MAX ? a.slice(0, TODO_NAME_MAX).join('') : x; })
    .slice(0, TODO_MAX);
  return { summary, deadline, todos };
}

/* 本文に足す文（頼んだことを頭に置く）。期限が分かったら「日付: YYYY-MM-DD（期限）」の行を足す
   （js/deadline.js の「日付で見る」がこの行を終了日として読む） */
export function askSectionText(request, summary, deadline) {
  const r = String(request || '').trim().split('\n')[0];
  const s = String(summary || '').trim();
  const d = validDay(deadline);
  return (r ? '頼んだこと: ' + r + '\n' : '') + (d ? '日付: ' + d + '（期限）\n' : '') + s;
}

/* 関連 TODO の本文 */
export function relatedDetail(fromName, today) {
  return '元: ' + String(fromName || '').trim() + '\n（AI の案から作った。' + (md(today) || String(today || '')) + '）';
}
