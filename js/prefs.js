/* この端末の表示（2026-11-10。Issue #36、案A と案X）。

   個人の好みで、見た目と動きの一部をこの端末だけ変える。変えられるのは決まった項目（ITEMS）だけ。
     ・設定の「この端末の表示」で手で変える
     ・同じ節のチャット（AI）に「起動時は今日にして」のように書くと、AI が ITEMS の中から変更案を返し、
       画面に「この変更をする？」と出す。押したときだけ変える（js/screens/settings.js の prefsBox）
     ・「この設定を全体に提案する」で、既定から変えた項目だけを書いた新しい Issue の画面を開く（案X。
       Create は人が押す。app は GitHub へ送らない）

   決めごと:
     ・保存は端末の localStorage（'bubble_todo_prefs_v1'）にだけ置く。同期・CSV・引っ越しのファイルには乗らない
       （それぞれ決まった箱しか読まない）。「すべて初期化」では消える（bubble_todo で始まるため）
     ・AI に送るのは、書いた文・項目の一覧・今の値だけ。泡の中身は送らない（buildPrefsPrompt）
     ・AI の返事は JSON として読み、ITEMS に無い項目・形の合わない値は捨てる（readPrefsReply）。
       返事を HTML として描かない。AI の書いた CSS やコードは当てない（案B は採らなかった）
     ・項目に無い変更は、ヘルプの「この会話から改善の Issue を書く」と同じく、Issue の下書きへ回す

   画面に当てる側は js/app.js（起動時の画面・タブの並び・body の印）と CSS（pref-wind・pref-hide-tags）。
   計算はここだけで DOM を触らないので、tests/prefs.test.mjs が見る。 */

export const PREFS_KEY = 'bubble_todo_prefs_v1';
export const PREFS_EVENT = 'bubbles:prefs';

/* 下タブ（js/app.js の TABS と同じ並び） */
export const TAB_IDS = ['sea', 'today', 'plan', 'gap'];
export const TAB_LABEL = { sea: '海', today: '今日', plan: 'きっかけ', gap: 'すきま' };

/* 盤（泡をタップすると下に開く面）の欄（Issue #49）。並びは盤の上からの順。
   [はじめた]・[完了]・[消す] の行と「もどってくる日」（長期保留の札を付けたときだけ出る）は、選ぶものに入れない */
export const BOARD_PARTS = [
  ['name', '名前'], ['detail', '本文'], ['notes', 'ひとこと'], ['fav', 'お気に入り'], ['prio', '優先度'],
  ['tags', 'タグ'], ['days', 'いつの日'], ['span', '期間'], ['step', '次の一手'], ['memo', '作業メモ'],
  ['hist', '履歴'], ['url', 'リンク'],
];
export const BOARD_PART_LABEL = Object.fromEntries(BOARD_PARTS);
/* 既定で出す欄（Issue #40 までの姿と同じ。お気に入り・優先度・期間・リンクは畳む） */
const BOARD_SHOW_DEF = ['name', 'detail', 'notes', 'tags', 'days', 'step', 'memo', 'hist'];

/* 設定の「音と表示を変える」で、先に選ぶ「どの画面を変えるか」（Issue #49 の返事）。
   各項目の pages に、その項目が効く画面を書く（2つ以上の画面に効くものは両方に出る）。
   音・似ている泡を寄せるは js/screens/settings.js の側で同じ印を付ける */
export const PAGES = [
  ['all', '全体（音・起動・下のタブ）'],
  ['sea', '海'],
  ['today', '今日'],
  ['list', 'リスト表示'],
  ['board', '盤（泡を押して開く面）'],
  ['drawer', '引き出し（左上の ≡）'],
];

/* 変えられる項目。type: 'choice'（choices の中から1つ）・'bool'・'order'（TAB_IDS の並べ替え）・
   'set'（choices の中からいくつでも。並びは choices の順にそろえる）。pages は上の PAGES の id */
export const ITEMS = [
  {
    id: 'start', type: 'choice', def: 'sea', pages: ['all'],
    label: '起動したときに開く画面',
    choices: TAB_IDS.map(id => [id, TAB_LABEL[id]]),
  },
  {
    /* Issue #40 の返事。海の「リスト表示」を押したときに、はじめに出す形（js/screens/sea.js の gatherBtn） */
    id: 'listStart', type: 'choice', def: 'list', pages: ['list'],
    label: 'リスト表示を開いたときの形',
    choices: [['list', '一覧（古い順）'], ['days', '日付（終了日の近い順と天気）'], ['quad', '四つ（急ぐ・大事）']],
  },
  {
    id: 'wind', type: 'bool', def: false, pages: ['list'],
    label: '日付で見るの日の見出しに、風の強さ（最大 m/s）も出す',
    note: '狭い画面（幅 360px 以下）では出さない。日を押すと出る1行には、これまでどおり出る',
  },
  {
    id: 'hideTags', type: 'bool', def: false, pages: ['board', 'drawer'],
    label: 'タグ類を隠す（盤のタグの札と、引き出しのタグごとの区分）',
    note: '今日・きっかけ・すきま・長期保留の札は残す。タグそのものと海の並びは変わらない',
  },
  {
    /* Issue #40。既定ではあまり使わない機能を畳んでおく。オンにすると畳まずに全部出す */
    id: 'allTools', type: 'bool', def: false, pages: ['all', 'sea', 'today', 'board'],
    label: 'あまり使わない機能も出す',
    note: '海の「はじめた日」、今日のおすすめ・四つに分ける、盤の「その他」の中身、設定の畳んだ箱（開いた姿で始める）。'
      + 'オフでも、盤は「その他」、設定はそれぞれの箱の行を押せば出る',
  },
  {
    /* Issue #49。狭い画面（iPhone SE など）で盤が長く、下までなぞらないと届かないため。
       選ばなかった欄は盤の「その他」に畳む。ただし中身が入っている欄（本文・ひとこと・印・期間・リンク・書きかけの作業メモ）は畳まない */
    id: 'boardShow', type: 'set', def: BOARD_SHOW_DEF.slice(), pages: ['board'],
    label: '盤（泡をタップして開く面）にはじめから出す欄',
    choices: BOARD_PARTS,
    note: '選ばなかった欄は盤の「その他」に畳む。本文・ひとこと・お気に入り・優先度・期間・リンク・書きかけの作業メモは、'
      + '中身が入っていれば選ばなくても出す。[はじめた]・[完了]・[消す] はいつも出す',
  },
  {
    id: 'tabOrder', type: 'order', def: TAB_IDS.slice(), pages: ['all'],
    label: '下のタブの並び',
  },
];

const byId = Object.fromEntries(ITEMS.map(it => [it.id, it]));

export function defaults() {
  const o = {};
  ITEMS.forEach(it => { o[it.id] = Array.isArray(it.def) ? it.def.slice() : it.def; });
  return o;
}

/* 1項目の値を確かめる。読めなければ undefined（＝使わない） */
export function checkValue(id, v) {
  const it = byId[id];
  if (!it) return undefined;
  if (it.type === 'bool') {
    if (v === true || v === false) return v;
    if (v === 'true' || v === 'on') return true;
    if (v === 'false' || v === 'off') return false;
    return undefined;
  }
  if (it.type === 'choice') {
    const s = String(v == null ? '' : v);
    return it.choices.some(c => c[0] === s) ? s : undefined;
  }
  if (it.type === 'order') {
    if (!Array.isArray(v)) return undefined;
    const a = v.map(String);
    if (a.length !== TAB_IDS.length) return undefined;
    if (new Set(a).size !== a.length) return undefined;
    if (!a.every(x => TAB_IDS.indexOf(x) >= 0)) return undefined;
    return a;
  }
  if (it.type === 'set') {
    if (!Array.isArray(v)) return undefined;
    const want = new Set(v.map(String));
    /* 知らない値は落とす。並びは choices の順（同じ中身なら同じ並び＝既定と比べられる） */
    return it.choices.map(c => c[0]).filter(x => want.has(x));
  }
  return undefined;
}

/* 保存の形を確かめて、足りない所を既定で埋める */
export function normalize(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  ITEMS.forEach(it => {
    const v = checkValue(it.id, raw[it.id]);
    if (v !== undefined) out[it.id] = v;
  });
  return out;
}

function same(a, b) {
  return Array.isArray(a) ? (Array.isArray(b) && a.join(',') === b.join(',')) : a === b;
}

/* 既定から変えた項目だけ（{ id: 値 }） */
export function changedFromDefault(p) {
  const d = defaults();
  const n = normalize(p);
  const out = {};
  ITEMS.forEach(it => { if (!same(n[it.id], d[it.id])) out[it.id] = n[it.id]; });
  return out;
}

/* 変更を重ねる。-> { next, applied: [id…], ignored: [名前…] }
   ITEMS に無い項目・読めない値は ignored に入れて捨てる。今と同じ値は applied に入れない */
export function applyChanges(p, changes) {
  const next = normalize(p);
  const applied = [], ignored = [];
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    Object.keys(changes).forEach(k => {
      const v = checkValue(k, changes[k]);
      if (v === undefined) { ignored.push(String(k).slice(0, 40)); return; }
      if (same(next[k], v)) return;
      next[k] = v;
      applied.push(k);
    });
  }
  return { next, applied, ignored };
}

/* 値を人の読む言葉に */
export function valueText(id, v) {
  const it = byId[id];
  if (!it) return '';
  if (it.type === 'bool') return v ? 'オン' : 'オフ';
  if (it.type === 'choice') { const c = it.choices.find(x => x[0] === v); return c ? c[1] : String(v); }
  if (it.type === 'order') return (Array.isArray(v) ? v : []).map(x => TAB_LABEL[x] || x).join('・');
  if (it.type === 'set') {
    const a = (Array.isArray(v) ? v : []).map(x => { const c = it.choices.find(y => y[0] === x); return c ? c[1] : x; });
    return a.length ? a.join('・') : 'なし';
  }
  return String(v);
}

/* 「起動したときに開く画面: 海 → 今日」の行 */
export function changeLines(before, after, ids) {
  const b = normalize(before), a = normalize(after);
  return (ids || ITEMS.map(it => it.id)).filter(id => byId[id] && !same(b[id], a[id]))
    .map(id => byId[id].label + ': ' + valueText(id, b[id]) + ' → ' + valueText(id, a[id]));
}

/* ---- 端末に置く ---- */
function ls(s) {
  if (s) return s;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function loadPrefs(storage) {
  const s = ls(storage);
  let raw = null;
  try { raw = JSON.parse((s && s.getItem(PREFS_KEY)) || 'null'); } catch (e) { raw = null; }
  return normalize(raw);
}

/* 既定のままの項目は書かない（既定が変わったら、自分で変えていない項目は新しい既定に付いていく）。
   全部が既定なら箱ごと消す。-> 置けたら true */
export function savePrefs(p, storage) {
  const s = ls(storage);
  if (!s) return false;
  const diff = changedFromDefault(p);
  try {
    if (Object.keys(diff).length) s.setItem(PREFS_KEY, JSON.stringify(diff));
    else s.removeItem(PREFS_KEY);
    return true;
  } catch (e) { return false; }
}

/* ---- AI に頼む（チャット） ----
   送るのは、書いた文・項目の一覧（id・説明・選べる値）・今の値だけ */
export function itemsForPrompt(p) {
  const n = normalize(p);
  return ITEMS.map(it => {
    let can = '';
    if (it.type === 'bool') can = 'true / false';
    else if (it.type === 'choice') can = it.choices.map(c => '"' + c[0] + '"（' + c[1] + '）').join(' / ');
    else if (it.type === 'order') can = TAB_IDS.map(x => '"' + x + '"（' + TAB_LABEL[x] + '）').join('・') + ' の4つを並べた配列';
    else if (it.type === 'set') can = it.choices.map(c => '"' + c[0] + '"（' + c[1] + '）').join('・') + ' から、出すものだけを入れた配列';
    return '- ' + it.id + ': ' + it.label + '。値: ' + can + '。今: ' + JSON.stringify(n[it.id]);
  }).join('\n');
}

export function buildPrefsPrompt(text, p) {
  const system = 'あなたは todo アプリ「bubble_todo」の表示の設定を手伝う。'
    + '利用者の頼みを、下の決まった項目の変更に置き換える。項目に無いことはできない。'
    + '返事は JSON だけ（前後に文を付けない）: {"changes": {項目のid: 値, …}, "reply": "利用者への短い説明（日本語・2文まで）"}。'
    + '変える項目が無いときは "changes": {} にし、reply に「その変更は設定の項目に無い」ことと、できる近いことがあればそれを書く。'
    + '値は各項目の「値」に書いた形だけを使う。\n\n変えられる項目:\n' + itemsForPrompt(p);
  return { system, user: String(text || '').slice(0, 1000) };
}

/* AI の返事を読む。-> { changes: {…}, reply: '' }。JSON が読めなければ changes は空、reply は返事の文を短くしたもの */
export function readPrefsReply(raw) {
  const s = String(raw || '');
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      if (o && typeof o === 'object') {
        const ch = (o.changes && typeof o.changes === 'object' && !Array.isArray(o.changes)) ? o.changes : {};
        return { changes: ch, reply: String(o.reply || '').slice(0, 300) };
      }
    } catch (e) { /* 下へ */ }
  }
  return { changes: {}, reply: s.replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/* ---- 全体に提案する（案X）----
   Issue の本文。既定から変えた項目と値だけ（泡の中身・端末の情報は入れない） */
export function proposalText(p) {
  const diff = changedFromDefault(p);
  const ids = Object.keys(diff);
  if (!ids.length) return '';
  const d = defaults();
  const L = ['この端末の表示の設定から、全体の既定にするかの提案（既定から変えた項目だけ）:', ''];
  ids.forEach(id => {
    L.push('- ' + byId[id].label + ': ' + valueText(id, d[id]) + ' → ' + valueText(id, diff[id]) + '（' + id + '）');
  });
  L.push('', '全体の既定にするか、この端末だけにするかを決めてください。');
  return L.join('\n');
}

export function proposalTitle(p) {
  const ids = Object.keys(changedFromDefault(p));
  if (!ids.length) return '';
  const first = byId[ids[0]].label.replace(/（.*$/, '');
  return '既定の提案: ' + (first.length > 24 ? first.slice(0, 24) + '…' : first) + (ids.length > 1 ? ' ほか' + (ids.length - 1) + '件' : '');
}
