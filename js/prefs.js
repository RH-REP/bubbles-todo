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
/* 2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」（モック docs/spec/mock/task-start.html）で、並び・言葉を作り直した。
   並びは盤の上からの順（js/bubble.js の arrangeBoard）。［書き留める］（ok）は外した（打ち終えた欄から自動で保存する） */
/* 2026-11-19 ユーザーの指示: 次にやること（step）・メモ（detail）・作業の記録（memo）を、メモの位置の「作業記録」（detail）1 つにした。
   step・memo・hist（作業の記録を見る。作業記録の見出しの行の［履歴を見る ›］になった）は選ぶものから外す */
export const BOARD_PARTS = [
  ['name', '名前'],
  /* 下のボタン（Issue #49 の返事）。畳むと「その他」を開いたときに出る。完了した泡の「海にもどす」は done と同じ扱い */
  ['start', '始める'], ['ended', '今日はここまで'], ['done', '完了にする'],
  ['notes', 'コメント'], ['detail', '作業記録'], ['days', 'やる日'], ['span', '期間'], ['repeat', 'くりかえし'], ['tags', 'タグ'],
  /* 印の段（大事・見当・急ぐ）と今日（今日大事なこと・先に済ませる）。2026-11-24 にタグの下へ移し、同じ日に選べる欄に戻した */
  ['prio', '大事・見当・急ぐ'], ['pick', '今日大事なこと・先に済ませる'],
  ['fav', 'お気に入り'], ['url', 'リンク'],
  ['del', '削除'],
];
/* 「少なめにする」で選ぶ欄（取りかかるのに要るものだけ） */
export const BOARD_SHOW_FEW = ['name', 'start', 'done', 'detail'];
/* 3 … 2026-11-18 の作り直し。前の版で置いた値（名前だけ、など）は新しい既定に替える（決めてほしいこと 1 の答え）
   4 … 2026-11-19 くりかえしの札を足した。3 の値はそのまま読み、期間を出すと選んでいればくりかえしも出す
   5 … 2026-11-24 ユーザーの指示「作業記録より下はその他で畳んでみて」。日付（やる日・期間・くりかえし）・タグを既定から外した。
       3・4 の値は読み、その 4 つを外す（中身の入っている期間・くりかえしは、選ばなくても今までどおり出る） */
const BOARD_SHOW_V = 5;
const BOARD_FOLD_1124 = ['days', 'span', 'repeat', 'tags'];
/* 隠している機能を 4 つのスイッチに分けた版の印（2026-11-22 Issue #80 の返事。savePrefs が置き、normalize が見る） */
const OPT_V = 1;
export const BOARD_PART_LABEL = Object.fromEntries(BOARD_PARTS);
/* 既定で出す欄（Issue #40 までの姿。お気に入り・優先度・リンクは畳む）。
   期間（開始日・終了日）は 2026-11-16 Issue #76「サーバーなし版のTODOの期限の設定がサーバーあり版と異なる？」で既定に足した。
   この設定はページの住所（オリジン）ごとの localStorage に置くので、サーバーあり版で「少なめにする」（期間を出す）を
   選んでいても、サーバーなし版は既定のまま＝期間が「その他」に畳まれ、期限の欄が無いように見えていた */
/* 2026-11-17 Issue #78 の返事「デフォルトで表示される盤の項目を1つにして」: 既定は名前だけにした。
   ほかの欄と下のボタンは「その他」に畳む（中身の入っている欄は、選ばなくても今までどおり出す）。
   前の既定: name detail notes tags days span step memo hist start ended ok done del。設定の値を置いた端末はその値のまま */
/* 2026-11-18 ユーザーの決定（モック task-start.html の決めてほしいこと 1。上の Issue #78 の「1つにして」を置き換える）:
   毎回使うもの（次にやること・始める・今日はここまで・完了にする）と、ときどき使うもの（メモ・日付・タグ）は畳まない。
   コメントは共有の海でだけ出る（個人の海では、書いたものが無ければ出さない。js/bubble.js）。まれなものは「その他」 */
/* 2026-11-19 ユーザーの決定「7 つとも案どおり」（モック docs/spec/mock/dates.html）: くりかえしを日付の段の 3 つ目の札に（既定で出す） */
/* 2026-11-24 ユーザーの指示「作業記録より下はその他で畳んでみて」: 作業記録より下（日付・タグ・大事・見当・急ぐ・今日）は既定で「その他」に */
const BOARD_SHOW_DEF = ['name', 'start', 'ended', 'done', 'notes', 'detail'];

/* 設定の「音と表示を変える」で、先に選ぶ「どの画面を変えるか」（Issue #49 の返事）。
   各項目の pages に、その項目が効く画面を書く（2つ以上の画面に効くものは両方に出る）。
   音・似ている泡を寄せるは js/screens/settings.js の側で同じ印を付ける */
export const PAGES = [
  ['all', '全体（音・起動・下のタブ）'],
  ['sea', '海'],
  ['today', '今日'],
  ['list', 'リスト表示'],
  ['board', '詳細（泡を押して開く面）'],
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
    /* 週・月は 2026-11-23 Issue #80 の返事でリスト表示の形に足した（js/periodview.js） */
    choices: [['list', '一覧（書いた順）'], ['days', '日付（終了日の近い順と天気）'], ['quad', '四つ（急ぐ・大事）'],
      ['week', '週（今週を日ごとに）'], ['month', '月（今月を日ごとに）']],
  },
  {
    /* Issue #69「デフォルトは新しい順で並びを入れ替えられるようにできる？」。
       リスト表示の一覧（とさがした結果・四つの中）の並び。一覧の見出しの横の「⇅」でも切り替わる（js/screens/sea.js の gridSortBtn）。
       完了の海の一覧は、完了した時刻の新しい順のまま（Issue #57） */
    id: 'listOrder', type: 'choice', def: 'new', pages: ['list'],
    label: 'リスト表示の一覧の並び',
    choices: [['new', '新しい順'], ['old', '古い順']],
  },
  {
    id: 'wind', type: 'bool', def: false, pages: ['list'],
    label: '日付で見るの日の見出しに、風の強さ（最大 m/s）も出す',
    note: '狭い画面（幅 360px 以下）では出さない。日を押すと出る1行には、これまでどおり出る',
  },
  {
    id: 'hideTags', type: 'bool', def: false, pages: ['board', 'drawer'],
    label: 'タグ類を隠す（詳細のタグの札と、引き出しのタグごとの区分）',
    note: '今日・きっかけ・すきま・長期保留の札は残す。タグそのものと海の並びは変わらない',
  },
  {
    /* Issue #40。既定ではあまり使わない機能を畳んでおく。オンにすると畳まずに全部出す。
       名前は 2026-11-22 Issue #80 の返事「(あまり使わない機能も出す)がよくわからない。適切な表現に直せる？」で、
       何が出るのかが名前で分かるように替えた（前の名前「あまり使わない機能も出す」） */
    /* 2026-11-22 Issue #80 の返事「週・月のタブ、今日のおすすめ など 分けれる？」で、週・月のタブ・はじめた日のカレンダー・
       おすすめ・四つに分けるは下の 4 つのスイッチに分けた。ここに残るのは、詳細の「その他」の中身と設定の箱だけ */
    id: 'allTools', type: 'bool', def: false, pages: ['all', 'board'],
    label: '詳細の「その他」の中身と、設定の箱を、はじめから開いて出す',
    note: 'オフでも、詳細は「その他」、設定はそれぞれの箱の行を押せば出る',
  },
  /* 隠している機能を 1 つずつ出す（2026-11-22 Issue #80 の返事「分けれる？」）。どれも既定は隠す。
     前の版で「ふだん隠している機能も表示する」（allTools）をオンにしていた端末は、3 つともオンで読む（normalize）。
     下のタブ「週・月」のスイッチ（showPeriod）は、2026-11-23 の返事で週・月をリスト表示の形に移したので外した */
  {
    id: 'showCal', type: 'bool', def: false, pages: ['sea'],
    label: '海の右上に「はじめた日」のカレンダーを出す（［始める］を押した日を濃さで見る）',
    note: '押した数の濃さで約半年ぶん並べる。0 の日は色を付けない。連続日数や割合は出さない',
  },
  {
    id: 'showSuggest', type: 'bool', def: false, pages: ['today'],
    label: '今日の画面に「おすすめ」を出す（今日に置くとよさそうな泡を選んで出す）',
  },
  {
    /* 先に済ませるの区切りの時間（2026-11-24 ユーザーの決定。app_spec の minutes/261124_選ぶときの基準.md）。
       その日に初めて先に済ませるへ入れた時刻から、この分だけたつと段を畳む（残った泡は今日の水面に戻る） */
    id: 'firstMin', type: 'choice', def: '30', pages: ['today'],
    label: '先に済ませるの区切りの時間（初めて入れた時刻から）',
    choices: [['15', '15 分'], ['30', '30 分'], ['45', '45 分'], ['60', '60 分'], ['90', '90 分']],
  },
  {
    id: 'showQuad', type: 'bool', def: false, pages: ['today'],
    label: '今日の画面に「四つに分ける」を出す（急ぐ・大事で 4 つに分けて見る）',
  },
  {
    /* 2026-11-21 Issue #84「サイコロ機能と github に書き込む機能は設定の中に移したらいいんじゃない？」。
       画面の小さい端末（iPhone SE2）で上の段が混むので、海と今日の右上のさいころは既定で隠し、ここで出す */
    id: 'dice', type: 'bool', def: false, pages: ['sea', 'today'],
    label: 'さいころ（無作為に1つ選んで始める）のボタンを出す',
    note: '海と今日の画面の右上に出す',
  },
  {
    /* 同じく Issue #84。右上の「!」は既定で隠し、設定の「改善のコメントを書く」から書く。
       「!」から書くと開いている画面の名前（画面 ID）が付くので、画面ごとに書きたい人はオンにする */
    id: 'fbBtn', type: 'bool', def: false, pages: ['all'],
    label: '画面の右上に「!」（改善のコメント）を出す',
    note: '出さなくても、設定の「改善のコメントを書く」から書ける。「!」から書くと、開いている画面の名前も付く',
  },
  {
    /* Issue #49。狭い画面（iPhone SE など）で盤が長く、下までなぞらないと届かないため。
       選ばなかった欄は盤の「その他」に畳む。ただし中身が入っている欄（本文・ひとこと・印・期間・リンク・書きかけの作業メモ）は畳まない */
    id: 'boardShow', type: 'set', def: BOARD_SHOW_DEF.slice(), pages: ['board'],
    label: '詳細（泡をタップして開く面）にはじめから出す欄',
    choices: BOARD_PARTS,
    note: '選ばなかった欄は詳細の「その他」に畳む。作業記録・コメント・期間・リンクは、'
      + '中身が入っていれば選ばなくても出す。ボタン（始める・今日はここまで・完了にする・削除）も選べ、'
      + '選ばなかったボタンは「その他」を開くと出る',
  },
  {
    id: 'tabOrder', type: 'order', def: TAB_IDS.slice(), pages: ['all'],
    label: '下のタブの並び',
  },
  {
    /* 2026-11-22 Issue #80 の返事「海、今日、きっかけ、すきま、週月の表示非表示も切り替えられる様にできる？」。
       設定では「下のタブの並び」の各行のスイッチで出し入れする（js/screens/settings.js）。
       全部を隠すことはできない（normalize が全部出すに戻す。設定も止める） */
    id: 'tabShow', type: 'set', def: TAB_IDS.slice(), pages: ['all'],
    label: '下のタブに出すもの',
    choices: TAB_IDS.map(id => [id, TAB_LABEL[id]]),
  },
];

const byId = Object.fromEntries(ITEMS.map(it => [it.id, it]));

export function defaults() {
  const o = {};
  ITEMS.forEach(it => { o[it.id] = Array.isArray(it.def) ? it.def.slice() : it.def; });
  /* 手元で組んだ値（defaults・normalize の返り値）は新しい版の値。normalize で古い値と取り違えて
     ボタンを足し直さないよう、印を持たせる（項目ではないので、比べる・保存する対象にはならない） */
  o.boardShowV = BOARD_SHOW_V;
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
  /* 2026-11-22 Issue #80 の返事「分けれる？」: 前は allTools 1 つで 週・月のタブ・はじめた日・おすすめ・四つに分ける も出していた。
     その版でオンにしていた端末（4 つの値をまだ置いていない）は、4 つともオンで読む（急に消えないように） */
  if (raw.allTools === true && raw.optV !== OPT_V) {
    ['showCal', 'showSuggest', 'showQuad'].forEach(id => { if (raw[id] === undefined) out[id] = true; });
  }
  /* 下のタブを 1 つも出さない値は読まない（2026-11-22 Issue #80 の返事。設定の歯車からは戻れるが、画面を移る道が無くなる） */
  if (Array.isArray(out.tabShow) && !out.tabShow.length) out.tabShow = TAB_IDS.slice();
  /* 前の版（boardShowV が 3 でない）で置いた boardShow は、新しい既定に替える（2026-11-18 ユーザーの決定。
     前は「名前だけ」を既定にしていて、その値を置いた端末が多い。並びと言葉も替わったので、そのまま読むと畳まれすぎる） */
  if (Array.isArray(raw.boardShow) && raw.boardShowV === 3 && Array.isArray(out.boardShow)) {
    if (out.boardShow.includes('span') && !out.boardShow.includes('repeat')) out.boardShow = checkValue('boardShow', out.boardShow.concat('repeat'));
  }
  if (Array.isArray(raw.boardShow) && raw.boardShowV !== BOARD_SHOW_V && raw.boardShowV !== 3 && raw.boardShowV !== 4) {
    out.boardShow = BOARD_SHOW_DEF.slice();
  } else if (Array.isArray(raw.boardShow) && (raw.boardShowV === 3 || raw.boardShowV === 4) && Array.isArray(out.boardShow)) {
    /* 版 5（2026-11-24）: 前の値から、作業記録より下の 4 つを外す */
    out.boardShow = out.boardShow.filter(p => BOARD_FOLD_1124.indexOf(p) < 0);
    if (raw.boardShow.some(p => p === 'step' || p === 'memo') && !out.boardShow.includes('detail')) out.boardShow = checkValue('boardShow', out.boardShow.concat('detail'));
  } else if (Array.isArray(raw.boardShow) && Array.isArray(out.boardShow)
    && raw.boardShow.some(p => p === 'step' || p === 'memo') && !out.boardShow.includes('detail')) {
    /* 2026-11-19: 次にやること・作業の記録を出すと選んでいた値は、まとめた先の作業記録を出す */
    out.boardShow = checkValue('boardShow', out.boardShow.concat('detail'));
  }
  return out;
}

/* 下のタブに出ているものを、出る順に（2026-11-22 Issue #80 の返事） */
export function visibleTabs(p) {
  const n = normalize(p);
  const show = new Set(n.tabShow || TAB_IDS);
  const out = n.tabOrder.filter(id => show.has(id));
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
  if (diff.boardShow) diff.boardShowV = BOARD_SHOW_V;   /* 下のボタンも選べる版の値（normalize を見る） */
  /* 4 つのスイッチに分けたあとの版で置いた値の印（normalize が allTools から 4 つを読み替えるのは、印の無い前の版の値だけ）。
     読み替えが起きるのは allTools がオンのときだけなので、そのときだけ置く */
  if (diff.allTools === true) diff.optV = OPT_V;
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

/* ---- 先に済ませるを始めた時刻（2026-11-24）----
   その日に初めて先に済ませるへ入れた時刻を、この端末にだけ覚える（区切りの時間＝この時刻＋firstMin 分）。
   記録（同期・引っ越し）には乗らない。ほかの端末で入れた泡は、この端末で初めて見た時刻から数える。
   日は 7 日ぶんだけ残す（古いものは落とす） */
export const FIRST_AT_KEY = 'bubble_todo_first_at_v1';
function readFirstAt(s) {
  try {
    const o = JSON.parse((s && s.getItem(FIRST_AT_KEY)) || 'null');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}
/* その日に始めた時刻（ms）。無ければ null */
export function firstStartedAt(day, storage) {
  const v = Number(readFirstAt(ls(storage))[day]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
/* まだ覚えていなければ、その日に始めた時刻として at を覚える。-> 覚えている時刻 */
export function markFirstStarted(day, at, storage) {
  const s = ls(storage);
  const o = readFirstAt(s);
  const cur = Number(o[day]);
  if (Number.isFinite(cur) && cur > 0) return cur;
  o[day] = at;
  const keep = Object.keys(o).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-7);
  const out = {};
  keep.forEach(k => { out[k] = o[k]; });
  try { if (s) s.setItem(FIRST_AT_KEY, JSON.stringify(out)); } catch (e) { /* 置けなくても段は出る（この開いている間だけ） */ }
  return at;
}
/* 区切りの時間の分（設定の firstMin） */
export function firstMinutes(storage) {
  return Number(loadPrefs(storage).firstMin) || 30;
}
