/* 画面2「今日」— 今日やると決めたものが、一面に浮かぶだけの画面。

   決めごと（契約 §1 §3 §5）:
   - 枠で分割しない。朝／昼／夜は UI から撤去した。store の slot 系 API はここから呼ばない。
   - 漂う物理は海と同じ（drift.createField）。大きさは文字量で決まる。
   - 着手済みの見た目（文字を消して薄い円だけ）は bubble.js の仕事。
     ここは makeBubble/setItems に started を正しく渡すだけ。
   - 日が変わると rollover() が today を落として空になるが、そのことは画面に書かない。
     「昨日の◯件が消えました」は未達の名指しになるため（契約 §0）。 */

import { store } from '../store.js';
import { createField } from '../drift.js';
import { openMenu, attachGestures, makeBubble, diameterFor, centerBubble } from '../bubble.js';
import { createQuadView, dropToQuad, quadButton, syncQuadButton, QUAD_BUB } from '../quadview.js';
import { el, toast, fromFeedback } from '../ui.js';
import { playComplete, playSfx } from '../sound.js';
import { describe, eligible, localPicks, sendList, buildSuggestPrompt, parseSuggest, keyable, firstable } from '../suggest.js';
import { SIZES, FIRST_MAX, firstState, showFirstRow } from '../priority.js';
import { firstStartedAt, markFirstStarted, firstMinutes, PREFS_EVENT } from '../prefs.js';
import { hasKey, askFull } from '../ai.js';
import { aiOn } from '../edition.js';
import { dressJelly, dressTurtle, archSvg } from '../swim.js';

/* 詳細の入力を書き終わりまで待たずに保存する間隔（plan.js と同じ） */
const SAVE_MS = 400;

/* --- ランダムスタートのシャッフル（追補5 §4） ---
   海（sea.js）と同じ作り・同じ時間。値も見せ方もそろえてある。
   ホップ = 光が次の玉へ移るまでの時間。だんだん遅くなる（＝止まりかけに見える）。
   合計 552ms + 最後の玉が大きくなる 200ms ≒ 0.63秒。始めたい人を待たせる長さにしない。
   ※ 海と2か所に同じものを書いている。共通の置き場を作るには js/ 直下に新しい
      ファイルが要るが、いまは担当の外なので写している。まとめるときは両方を直すこと。 */
const SHUF_HOPS = [56, 58, 62, 70, 82, 100, 124];
const SHUF_WIN = 200;   /* 選ばれた玉が大きくなるまで */
const SHUF_MAX = 10;    /* 盤に出す玉の数の上限。これ以上は重なって粒に見える */
const SHUF_D = 46;      /* 玉の直径 px。CSS の .today-shuffle .rnd-b と同じ値。片方だけ変えないこと */

/* --- 泡が多くて面に入らないとき（2026-11-21 Issue #87） ---
   海（Issue #2）と同じ考えで、泡の面積の合計を面の TODAY_FILL までに収める：
     1. まず縮める。ただし TODAY_SHRINK 倍まで（それより小さいと字が読めない）
     2. それでも入らないときは、2段目の丸い ⇅ の縁を太く泡の色にして目立たせる（Issue #92 で丸い ⇅ にし、返事で字も無くした）
   海と違って**数は減らさない**。日付の水面は「その日に置いたという記録」なので、
   置いたものを隠すと置いた事実のほうが欠ける（上の dayItems の決めごと）。
   だから縮める下限は海（0.8）より一段小さくしてある（入らないぶんを隠す逃げ道が無いため）。
   件数は出さない（契約 §0）。広さは面（.today-stage）の寸法で見る */
const TODAY_FILL = 0.45;
const TODAY_SHRINK = 0.7;
let crowded = false;      /* 縮めても入りきらない。⇅ を目立たせる */
let fitW = 0;             /* 最後に大きさを決めたときの面の幅。回転などで変わったら決め直す */

/* 漂う面へ渡す前に、入りきらないぶん泡を縮める。縮めないときは渡されたまま返す
   （item.size を付けると bubble.js が一定の大きさの見た目にするので、要るときだけ付ける） */
function fitItems(items) {
  const w = stage ? stage.clientWidth : 0, h = stage ? stage.clientHeight : 0;
  if (w) fitW = w;
  const area = (w || 320) * (h || 420);
  const ds = items.map(it => diameterFor(it.text || '', w, h));
  const sum = ds.reduce((a, d) => a + Math.PI * d * d / 4, 0);
  const budget = area * TODAY_FILL;
  const k = sum > budget ? Math.max(TODAY_SHRINK, Math.sqrt(budget / sum)) : 1;
  crowded = sum * k * k > budget * 1.001;
  if (k >= 1) return items;
  return items.map((it, i) => Object.assign({}, it, { size: Math.round(ds[i] * k) }));
}

/* ---- 契約に書かれていないことの申し送り ----------------------------------
   契約 §12 は「attachGestures を誰が呼ぶか」を書いていない。
   実装された drift.createField は、自分でノードを作って attachGestures まで張り、
   handlers は opts の直下（opts.onMenu など）から読む。だからこの画面は
   createField の opts に handlers を平らに渡すだけで、自分では張らない。
   両方が張ると長押しでメニューが2枚開くので、必ずどちらか一方だけにすること。 */

let pane = null;
let stage = null;         /* バブルが漂う面。field の host */
let emptyNote = null;     /* 何も無いときのことば */
let field = null;         /* drift.createField の戻り */
let unsubscribe = null;
let ro = null;
let shown = false;
let menuHandle = null;
let detail = null;        /* { node, flush, sync, id } 再描画をまたいで使い回す */
let randomBtn = null;     /* ランダムスタート（追補5 §4） */
let shuffle = null;       /* 混ぜている最中だけ { node, timer } が入る */
/* 四つに分けて見る（優先度・利用者の指示 2026-10-25）。中身はその日の泡。
   分けている間は漂う面（field）を降ろし、js/quadview.js の箱に一定の大きさで並べる */
let quadOn = false;
let quad = null;
let quadBtn = null;

/* タグの名前。色と同じ並びで渡す。
   タグを色だけで表すと、色を見分けられない人に所属が伝わらない（WCAG 1.4.1）。
   バブルには文字を足さず、読み上げ文にだけ載せる。 */
function tagNames(id) {
  if (typeof store.tagsOf !== 'function' || typeof store.tags !== 'function') return [];
  let ids, all;
  try { ids = store.tagsOf(id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(t => [t.id, t.name]));
  return ids.map(t => by.get(t)).filter(n => typeof n === 'string' && n);
}

/* 付いているタグの色。バブルはこの色になる（タグが無ければ空＝いまの青）。
   点（marks）でタグを表すのはやめたので、色だけを渡す（追補4 §1）。 */
function tagColors(id) {
  if (typeof store.tagsOf !== 'function' || typeof store.tags !== 'function') return [];
  let ids, all;
  try { ids = store.tagsOf(id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(t => [t.id, t.color]));
  return ids.map(t => by.get(t)).filter(c => typeof c === 'string' && c);
}

/* ---------------- 小物 ---------------- */

function trim(s, n = 18) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* 着手はこの画面ではアンカーに属さない。だからアンカーは常に null（契約 §11） */
/* 着手（store.start）の印を、画面で何と呼ぶか（利用者の指示）。
   「はじめた」「開始した」と別々に呼んでいたが、同じ印を指している。
   実際にしていることは「今日ぶんはここまで」——押すとバブルが薄くなり、
   日が変わると戻る（契約 §5）。だから名前もそう呼ぶ。
   **記録している中身は変えていない。**ふりかえりの内訳は「はじめた」のまま
   （あちらは操作の名前ではなく、記録の名前。README の憲章がその言葉を使っている）。 */
const DONE_LB = '今日は終わり';

function isStarted(id) {
  return typeof store.isStarted === 'function' && !!store.isStarted(id, null);
}
function markStarted(id) {
  if (typeof store.start !== 'function') return;
  if (isStarted(id)) return;
  store.start(id, null);
  playSfx('start');
  const t = store.get(id);
  toast('「' + trim(t ? t.text : '') + '」を ' + DONE_LB + ' にした', {
    label: '取り消す',
    on: () => { if (typeof store.unstart === 'function') store.unstart(id, null); },
  });
}

function detailOf(fn, id) {
  return (typeof store[fn] === 'function' && store[fn](id)) || '';
}

/* 完了音。読み込みは静的（sea.js / plan.js / settings.js と同じ）。

   前は「sound.js が無い／壊れている間この画面ごと読めなくなる」を避けるため
   動的 import にしてあった。その守りはもう効いていない——
   sea.js・plan.js・settings.js が静的に読んでいるので、sound.js が壊れれば
   どのみちアプリは立ち上がらない。残っていたのは不揃いと、
   **最初の1回だけ音が遅れる**という副作用だけ（モジュールの解決を待つため。
   音は操作に添うものなので、ここが遅れるのはいちばん困る）。
   （オン/オフ判定と prefers-reduced-motion の尊重は sound.js 側の責任） */
function playCompleteSound() {
  try { playComplete(); } catch (err) { console.error(err); }
}

/* ---------------- store へ流す ---------------- */

/* field に渡す形（契約 §12）。marks は海の「リスト表示」用なので、この画面では付けない */
/* ---------------- 見ている日（利用者の指示） ----------------

   前はこの画面が「今日」だけを映していた。いまは **日付ごとの海**で、
   左右になぞる／見出しの日付から選ぶ、の2つで日を移る。

   ・過去 … その日に置いたものを**全部**出す。着手したものを強調もしないし、
     しなかったものを沈めもしない。件数も出さない（利用者の判断）。
     並べ替えもしない——順番が違うこと自体が「こちらはやっていない」の印になる
   ・未来 … あらかじめ置いておける。その日が来たら、そのまま今日の海になる
   ・**書き換えられるのは今日と未来だけ。**過去は記録なので触らせない
     （うっかり足すと、その日の記録が後から変わる）

   「持ち越さない」は保たれている。明日の海が空なのは、
   明日のキーを持つものがまだ無いからで、勝手に運ばれることはない。 */

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/* いま見ている日。海がタブへのドロップ先を決めるのに読む。
   ＝ 「今日タブは、いま今日の画面が映している日の水面」。
   過去を映している間は null を返す（過去は記録なので書き換えさせない）。 */
/* 下タブの「今日」から日を選ぶ。長押しで呼ばれる（利用者の指示） */
export function openDayPicker(anchor) { openDayPop(anchor); }

/* タブに出す札。今日を映しているときは null（＝「今日」のまま） */
export function dayBadge() {
  const k = curDay();
  if (k === todayKey()) return null;
  const d = dayToDate(k);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

/* 映している日が変わったことを外へ知らせる。下タブの札がこれを見る。
   画面どうしを直接つながないため、window のイベントで渡す（app.js と同じやり方） */
function announceDay() {
  try {
    window.dispatchEvent(new CustomEvent('bubbles:dayview', {
      detail: { day: curDay(), badge: dayBadge() },
    }));
  } catch (_) { /* 古い環境。札が出ないだけ */ }
}

/* いま映している日（今日の画面を出していなくても、最後に映した日）。盤の「今日」の段が、どの日に入れるかを決めるのに使う（js/app.js） */
export function shownDay() { return curDay(); }

export function dropDay() {
  const k = curDay();
  return (k < todayKey()) ? null : k;
}

let viewDay = null;          /* 'YYYY-MM-DD'。null なら今日 */
let dayBtn = null, dayPrev = null, dayNext = null;
let dayPop = null;

const todayKey = () => (typeof store.todayKey === 'function' ? store.todayKey() : '');
const curDay = () => viewDay || todayKey();
const isToday = () => curDay() === todayKey();
const isPast = () => curDay() < todayKey();

/* 日付キーを Date に。ローカル時刻の正午に寄せる（夏時間で日が飛ばないように） */
function dayToDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return new Date();
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
}
function dateToDay(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function shiftDay(key, n) {
  const d = dayToDate(key);
  d.setDate(d.getDate() + n);
  return dateToDay(d);
}
/* 今日から何日ずれているか（負なら過去） */
function offsetOf(key) {
  return Math.round((dayToDate(key) - dayToDate(todayKey())) / 86400000);
}
/* 見出しの文字。近い日は言葉で、遠い日は日付で */
function dayLabel(key) {
  const n = offsetOf(key);
  const d = dayToDate(key);
  const md = (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）';
  if (n === 0) return '今日 ' + md;
  if (n === 1) return '明日 ' + md;
  if (n === 2) return '明後日 ' + md;
  if (n === -1) return '昨日 ' + md;
  if (n === -2) return '一昨日 ' + md;
  return md;
}

/* --- この画面の中身（利用者の指摘）---

   > 今日の海は、実質すべての海のフィルター版である

   そのとおりなので、**水面とランダムで別々に集めていたのをここ1か所にまとめた**。
   前は規則がずれていて、ここは「いま映している日」、ランダムは常に
   store.todays()（＝今日）を見ていた——明日を映していても、さいころは今日から引いていた。

   今日は完了したものを出さない。過去と未来は**その日の記録として残す**
   （済ませたぶんを抜くと、あとから見たときに顔ぶれが欠ける）。

   ■ **長期保留はここでは外さない**（利用者の指示）

   一度これを外していたが、間違いだった。長期保留は**一種のタグ**で、
   「既定では出さない」は**海の側の決まり**（すべての海＝中央と、タグの海）。
   日付の水面は**その日に置いたという記録**なので、タグの表示規則で消してよいものではない
   ——置いたのに消えると、置いた事実のほうが失われる。

   だから、日付の水面と、そこから引くさいころには、長期保留もそのまま出る。 */
/* **完了したものも出す**（利用者の指示 2026-09-18）。

   前は今日だけ store.todays() を見ていた。あれは `today && !done` なので、
   完了した瞬間に今日の水面から消えていた——**その日なにを達成したかが残らない**。
   ほかの日（itemsOnDay）は前から完了したものも出していたので、今日だけが
   食い違っていたことになる。両方 itemsOnDay に寄せて、食い違いごと無くす。

   complete() は days に触らない（置いた日そのものは記録なので消えない）ので、
   itemsOnDay(今日) は todays() に完了したぶんを足しただけのものになる。

   さいころ（pickList）は別で `!isDoneItem(t)` を掛けている——達成したものを
   もう一度引かせないため。あちらは今までどおり。 */
function dayItems(key) {
  const base = (typeof store.itemsOnDay === 'function')
    ? store.itemsOnDay(key)
    : store.todays();          /* 口が無い版への後ろ盾。今日ぶんしか返せない */
  return base || [];
}

function itemsForField() {
  return dayItems(curDay()).filter(passFilter).map(itemFor);
}

function itemFor(t) {
  return ({
    id: t.id,
    text: t.text,
    started: isStarted(t.id),
    /* 達成したことが見て分かるように（利用者の指示）。bubble.js が .is-done を付ける */
    done: isDoneItem(t),
    marks: [],
    colors: tagColors(t.id),
    tagNames: tagNames(t.id),
    anchorHue: null,
    /* 右上の区分の点（並べ替えはしない） */
    urgent: t.urgent,
    important: t.important,
    /* 2026-11-24（モック mock/choose-1124.html の 2）: 大事な泡は縁を太く、見当と外の約束を泡の中に小さく。今日の水面だけ */
    heavy: t.important === true,
    knote: kNoteOf(t),
  });
}

/* 泡の中に小さく出す字（「さっと・外の約束」など）。無ければ '' */
function kNoteOf(t) {
  const w = [];
  if (t && SIZES[t.size]) w.push(SIZES[t.size]);
  if (t && t.urgent === true && t.dueKind === 'ext') w.push('外の約束');
  return w.join('・');
}

/* ---------------- 今日大事なこと・先に済ませる（2026-11-24 ユーザーの決定「OK、推奨で実施」） ----------------
   app_spec の minutes/261124_選ぶときの基準.md。Issue #96 の返事で、面の上の枠をやめて角と色にした（2026-11-24）：
   > 先にすませる、今日大事なことを設定する場所が画面の中央少し上で横全体を使ってる。また、その上下でバブルの移動が妨げられてる。
   > 右下が右上か左下か左上にバブルを持って行ったら、設定できて、バブルの形は同じで色で区別できるようにできる？
   ・小さい画面では、入れた泡も、ほかの泡と同じ形のまま漂う面に出す。色で見分ける（今日大事なこと＝紫み .is-pin-key、先に済ませる＝青み .is-pin-first）。
     面に壁は置かない（前の枠は drift の keepOut で、その上下で泡が詰まっていた）
   ・入れる場所（Issue #96 の 6 回目の返事で、画面の大きさで分けた）：
     - 小さい画面（画面の幅 720px 未満。スマホ。isWideScreen）… 泡を掴んでいる間だけ出る左下・右下のエリア。そこで離すと入る。
       （掴んでいる間だけの角 → いつも見える滝 → 下の角の灯台と浮き → 魚 → 角のエリアに戻した（9 回目の返事）。renderCorners の説明）
     - 大きい画面（720px 以上）… いちばん最初の形：面の上の枠（先に済ませるの細い段＋今日大事なことの大きな枠）。renderWide の説明
   ・入れた泡を同じ所で離すと外す（今日には残る。［元に戻す］で入れ直せる）。もう片方で離すとそちらへ移す
   ・盤の［★ 今日大事なことにする］［↑ 先に済ませるに入れる］・おすすめの板からも、今までどおり入れられる・外せる
   ・どちらも日付ごとに記録する。今日と先の日に入れられる（Issue #98。過ぎた日は記録として色だけ）。
     先に済ませるは、今日になってから区切りの時間を数え、過ぎるか、入れた泡が全部済むと畳み、色が戻る（次の日へは移さない）
   ・今日大事なことは過ぎた日には入れない。一覧・四つに分けて見ている間はエリアも枠も出さない（一覧では行に色と字を付ける）
   言い方は命令形にしない。件数・割合は出さない。赤は使わない */
let plate = null;          /* 左下・右下のエリアの入れ物（.today-corners）。泡を掴んでいる間だけ。小さい画面だけ */
let wideBox = null;        /* 大きい画面の枠（.today-wide）。泡にとっては壁（drift の keepOut）。大きい画面だけ */
let wideOn = false;        /* いま大きい画面の形か */
let heldId = null;         /* 盤を開いている（中央に持っている）泡の id。drift の onHold から（大きい画面で、枠へ移る泡を閉じるまで残す） */
/* 大きい画面か（画面＝窓の幅が 720px 以上）。2026-11-25 Issue #96 の 8 回目の返事で直した：前は面（.today-stage）の幅で見ていたが、
   アプリの枠（.app）は最大 430px なので、大きい画面でも 720 に届かず、いつも小さい画面の形になっていた。
   大きい画面では、今日大事なこと・先に済ませるは上の枠（renderWide）、タグのフィルターと一覧は前のボタン（applySwimLayout）。
   海の画面も同じ境目（css/screens/sea.css の @media (min-width: 720px)） */
const WIDE_MQ = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(min-width: 720px)') : null;
function isWideScreen() { return !!(WIDE_MQ && WIDE_MQ.matches); }
let plateTimer = 0;
let lastPlate = { key: null, rows: [], st: { open: false }, showFirst: false };

/* 映している日の枠の中身。-> { key, rows, st }（st は firstState。区切りの時間を数えるのは今日だけ） */
function plateState() {
  const day = curDay();
  const key = (typeof store.keyItem === 'function') ? store.keyItem(day) : null;
  let rows = [], st = { open: false, endAt: null, canAdd: false, passed: false };
  /* 先に済ませるも、今日大事なことと同じく日付ごとに記録している（記録の鍵 first に日付）。
     Issue #98「大事、先には日付とセットで記録して／今日の海だけではなく別の日も対称的に／明日先にやること、大事なことを前日に入力したい」：
     ・先の日 … 入れられる（席 3 つ・さっとの泡だけは同じ）。区切りの時間はまだ数えない（その日が今日になって初めて見た時刻から数える）
     ・今日   … 今までどおり（区切りの時間が過ぎるか、全部済んだら畳む）
     ・過ぎた日 … 入れない・外さない。記録として色と字だけ出す */
  if (typeof store.firstItems === 'function') {
    rows = store.firstItems(day);
    if (isToday()) {
      let at = firstStartedAt(day);
      /* 前の日やほかの端末で入れた泡は、この端末で今日初めて見た時刻から数える */
      if (rows.length && at === null) at = markFirstStarted(day, Date.now());
      st = firstState(rows.map(t => ({ done: firstOver(t) })), at, firstMinutes(), Date.now());
    } else {
      /* 先の日も過ぎた日も同じ（2026-11-25 利用者の指示「今日以外の日付の海での操作が今日の海と対称的ではない（基本動作は同じにして）」）。
         区切りの時間を数えるのは今日だけ */
      st = firstState(rows.map(t => ({ done: firstOver(t) })), null, firstMinutes(), Date.now());
    }
  }
  /* 段を出すか（2026-11-24 ユーザーの指示「先にやるの枠がない」）。前は入れた泡があるときだけ出していたので、
     まだ 1 つも入れていない朝は段そのものが無く、入れる場所が見えなかった。
     今日・先の日で、区切りの時間が過ぎておらず、入れた泡がまだ済んでいない（open）か、1 つも入れていないときに出す。
     全部済んだ・区切りの時間が過ぎたときは今までどおり畳む。過ぎた日は、入れた泡があるときだけ記録として出す */
  const canFirst = typeof store.setFirst === 'function';
  const showFirst = canFirst && (showFirstRow(st, rows.length) || (isPast() && rows.length > 0));
  return { key, rows, st, showFirst };
}

function hhmm(ms) {
  const d = new Date(ms);
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* 色を付ける泡。id -> 'key'|'first'（先に済ませるは開いている間だけ。過ぎた日はその日の記録として全部。
   両方なら今日大事なことを先に） */
function pinsOf(ps) {
  const out = new Map();
  /* 済んだ泡（完了・今日はここまで）には色を付けない（2026-11-25）。過ぎた日は記録として全部 */
  if (ps.st.open || isPast()) ps.rows.forEach(t => { if (isPast() || !firstOver(t)) out.set(t.id, 'first'); });
  if (ps.key) out.set(ps.key.id, 'key');
  return out;
}

function renderPlate(ps) {
  if (plateTimer) { clearTimeout(plateTimer); plateTimer = 0; }
  /* 区切りの時間が来たら畳む（先に済ませるの泡の色を戻す・段を畳む） */
  if (ps.st.open && ps.st.endAt) plateTimer = setTimeout(() => { plateTimer = 0; render(); }, Math.max(1000, ps.st.endAt - Date.now() + 500));
  wideOn = isWideScreen();
  if (stage) stage.classList.toggle('is-wide', wideOn);
  applySwimLayout(wideOn);
  renderWide(ps);
  renderCorners(ps);
}

/* 枠に出している泡の id（大きい画面では漂う面に渡さない） */
function plateIds(ps) {
  const out = new Set();
  if (ps.key) out.add(ps.key.id);
  if (ps.st.open || (isPast() && ps.showFirst)) ps.rows.forEach(t => out.add(t.id));
  return out;
}

/* ---- 大きい画面：いちばん最初の形（Issue #96 の 6 回目の返事「画面が大きいのは1番最初の表示」）----
   面の上の枠。泡にとっては壁（drift の keepOut。海の端の札と同じ）。上から 先に済ませる（細い 1 段）→ 今日大事なこと（大きな枠）。
   ・先に済ませる … さっとの泡の席が 3 つと、区切りの時間（〜 9:30）。今日を映しているときだけ。空いた席は点線の＋（押すとおすすめ）
   ・今日大事なこと … 泡（押すと詳細）と次にやること。先に済ませるを畳んだあとは縁が光る
   ・決めていない日は点線の 1 行「今日大事なことは、まだ」と［選ぶ］。過ぎた日には出さない
   ・枠の中の泡（席・今日大事なことの泡）は掴んで枠の外で離すと外し、もう片方の枠で離すと移す（seatDrag） */
function renderWide(ps) {
  if (!wideBox) return;
  wideBox.textContent = '';
  if (!wideOn || listOn || quadOn) { wideBox.hidden = true; return; }
  const day = curDay();
  const word = isToday() ? '今日' : dayLabel(day).split(' ')[0];

  if (ps.showFirst) {
    const row = el('div', 'tp-first');
    const firstName = isToday() ? '先に済ませる' : word + 'の先に済ませる';
    row.dataset.name = '先に済ませる';
    row.dataset.drop = 'first';   /* 過ぎた日も入れられる（2026-11-25。前は記録として出すだけだった） */
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', ps.st.endAt ? firstName + '（区切りの時間 ' + hhmm(ps.st.endAt) + '）'
      : ps.rows.length ? firstName + '（区切りの時間は、その日に初めて開いたときから数える）'
      : firstName + '（まだ入れていない。泡をここへ落とすと入る）');
    row.appendChild(el('span', 'tp-first-h', firstName));
    if (ps.st.endAt) {
      const tm = el('span', 'tp-first-t', '〜 ' + hhmm(ps.st.endAt));
      tm.dataset.name = '区切りの時間';
      row.appendChild(tm);
    }
    const seats = el('div', 'tp-seats');
    ps.rows.forEach(t => {
      const done = firstOver(t);
      const b = el('button', 'tp-seat' + (done ? ' is-done' : ''));
      b.type = 'button';
      const nm = el('span', 'tp-seat-nm');
      nm.textContent = (done ? '✓ ' : '') + trim(t.text, 12);   /* ユーザーの文字。innerHTML には入れない */
      b.appendChild(nm);
      if (t.urgent === true && t.dueKind === 'ext') b.appendChild(el('span', 'tp-seat-k', '外の約束'));
      b.setAttribute('aria-label', t.text + (done ? '（済んだ）' : '') + '。詳細を開く');
      b.addEventListener('click', ev => { ev.preventDefault(); if (seatDragged(b)) return; openBoardFor(t.id, b); });
      seatDrag(b, t, 'first', day);
      seats.appendChild(b);
    });
    if (ps.st.canAdd || !ps.rows.length) {
      for (let i = ps.rows.length; i < FIRST_MAX; i++) {
        const add = el('button', 'tp-seat is-empty', '＋');
        add.type = 'button';
        add.dataset.name = '先に済ませるの空いた席';
        add.setAttribute('aria-label', '先に済ませるに入れる泡を、おすすめから選ぶ（泡を落としても入る）');
        add.addEventListener('click', ev => { ev.preventDefault(); openSuggest(); });
        seats.appendChild(add);
      }
    }
    row.appendChild(seats);
    wideBox.appendChild(row);
  }

  if (ps.key) {
    const t = ps.key;
    const done = isDoneItem(t);
    const box = el('div', 'tp-key');
    box.dataset.name = '今日大事なこと';
    box.dataset.drop = 'key';
    if (isToday() && ps.rows.length && !ps.st.open) box.classList.add('is-lit');
    if (done) box.classList.add('is-done');
    box.appendChild(el('span', 'tp-key-h', isToday() ? '今日大事なこと' : word + 'の大事なこと'));
    const body = el('div', 'tp-key-body');
    const bub = el('button', 'tp-key-bub');
    bub.type = 'button';
    bub.dataset.name = '今日大事なことの泡';
    const btx = el('span', 'tp-key-bub-tx');
    btx.textContent = (done ? '✓ ' : '') + trim(t.text, 24);   /* ユーザーの文字。innerHTML には入れない */
    bub.appendChild(btx);
    if (t.important === true) bub.classList.add('is-heavy');
    bub.setAttribute('aria-label', t.text + (done ? '（済んだ）' : '') + '。詳細を開く');
    bub.addEventListener('click', ev => { ev.preventDefault(); if (seatDragged(bub)) return; openBoardFor(t.id, bub); });
    seatDrag(bub, t, 'key', day);
    body.appendChild(bub);
    const tx = el('div', 'tp-key-tx');
    const next = detailOf('firstStepOf', t.id);
    if (next) {
      const p = el('p', 'tp-key-next');
      p.appendChild(el('span', 'tp-key-lb', '次にやること'));
      p.appendChild(document.createTextNode(' ' + next.split('\n')[0]));
      tx.appendChild(p);
    }
    const k = kNoteOf(t);
    if (k) tx.appendChild(el('p', 'tp-key-k', k));
    if (ps.st.open) tx.appendChild(el('p', 'tp-key-after', '先に済ませるのあと'));
    body.appendChild(tx);
    box.appendChild(body);
    wideBox.appendChild(box);
  } else {
    const none = el('div', 'tp-none');
    none.dataset.name = '今日大事なことは、まだ';
    none.dataset.drop = 'key';
    none.appendChild(el('span', 'tp-none-tx', (isToday() ? '今日大事なこと' : word + 'の大事なこと') + 'は、まだ'));
    const pick = el('button', 'tp-none-pick', '選ぶ');
    pick.type = 'button';
    pick.setAttribute('aria-label', (isToday() ? '今日大事なこと' : word + 'の大事なこと') + 'を、おすすめから選ぶ');
    pick.addEventListener('click', ev => { ev.preventDefault(); openSuggest(); });
    none.appendChild(pick);
    wideBox.appendChild(none);
  }
  wideBox.hidden = !wideBox.children.length;
}

/* 枠から出す（大きい画面の枠の席・今日大事なことの泡）。掴んで動かすと写しが指に付き、
     ・枠の外で離す   … その枠から外す（今日には残る。［元に戻す］で入れ直せる）
     ・もう片方の枠で離す … そちらへ移す
     ・同じ枠で離す・動かさない … 何もしない（押しただけなら盤を開く）
   下のタブの上で離したときも何もしない。動かしたかどうかは 8px で決め、動かしたあとの click は捨てる */
const SEAT_MOVE = 8;
function seatDragged(node) {
  if (node.dataset.dragged !== '1') return false;
  delete node.dataset.dragged;
  return true;
}
function seatDrag(node, t, kind, day) {
  node.style.touchAction = 'none';
  node.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const x0 = ev.clientX, y0 = ev.clientY;
    let ghost = null, ox = 0, oy = 0, pt = { x: x0, y: y0 };
    const move = e => {
      pt = { x: e.clientX, y: e.clientY };
      if (!ghost) {
        if (Math.hypot(pt.x - x0, pt.y - y0) < SEAT_MOVE) return;
        const r = node.getBoundingClientRect();
        ox = x0 - r.left; oy = y0 - r.top;
        ghost = node.cloneNode(true);
        ghost.classList.add('tp-ghost');
        ghost.style.width = r.width + 'px';
        ghost.style.height = r.height + 'px';
        (document.getElementById('drag-layer') || document.body).appendChild(ghost);
        node.classList.add('is-lifted');
        node.dataset.dragged = '1';
      }
      e.preventDefault();
      ghost.style.transform = 'translate(' + (pt.x - ox) + 'px,' + (pt.y - oy) + 'px)';
      const hit = plateHitAt(pt.x, pt.y);
      markPlateDrop(hit && hit.kind !== kind ? hit : null);
      ghost.classList.toggle('is-out', !hit);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!ghost) return;
      ghost.remove();
      node.classList.remove('is-lifted');
      markPlateDrop(null);
      setTimeout(() => { delete node.dataset.dragged; }, 400);
      const bar = document.getElementById('tabbar');
      if (bar) {
        const r = bar.getBoundingClientRect();
        if (pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom) return;
      }
      const hit = plateHitAt(pt.x, pt.y);
      if (hit && hit.kind === kind) return;
      if (hit) { moveSeat(t.id, kind, hit.kind, day); return; }
      takeOutSeat(t.id, kind, day);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
}

/* ---- 小さい画面：左下・右下のエリア（Issue #96 の 9 回目の返事。2026-11-25）----
   > 魚になった大事、急ぎ、は左下と右下のエリアで属性の付与に戻して（私の理解では魚はいなくなる）
   魚（6 回目の返事）をやめ、2 回目の返事の形（泡を掴んでいる間だけ出る下の角のエリア）に戻した：
   ・泡を掴んでいる間だけ、左下に「★ 今日大事なこと」、右下に「↑ 先に済ませる」のエリアが出る。そこで離すと入る。
     ふだんは何も出さない（泡の動きと泡を出す場所を減らさない。壁にもしない）
   ・エリアの中に、離すとどうなるか（入る・いまの泡と入れ替える・外す・席は 3 つまで・今日はもう畳んだ）を小さく出す
     （利用者の指示「右下、左下の表示で十分」。真ん中に吹き出しは出さない）
   ・入った泡は形を変えず、色と上の小さな「★ 大事」「↑ 先に」で分かる（css/bubble.css の .is-pin-*、js/bubble.js の .pinlb）。
     今日の一覧でも、行に同じ色と字を付ける（listRow）
   ・大事のエリアは過ぎた日にも出す（2026-11-25「基本動作は同じにして」）。先に済ませるのエリアは今日と先の日にも（Issue #98）。
     今日で畳んだあとは薄くし「今日はもう畳んだ」と言う。一覧・四つに分けて見ている間・大きい画面では出さない */
function renderCorners(ps) {
  if (!plate) return;
  renderFish(ps);
  plate.textContent = '';
  const id = bubDrag ? bubDrag.id : null;
  /* スキン「海の生き物」では、左下・右下のエリアの代わりに魚（renderFish） */
  if (!id || wideOn || listOn || quadOn || fishOn()) { plate.hidden = true; return; }
  const pin = pinsOf(ps).get(id) || null;
  const day = curDay();
  const word = isToday() ? '今日' : dayLabel(day).split(' ')[0];
  const keyName = isToday() ? '今日大事なこと' : word + 'の大事なこと';
  const keySub = pin === 'key' ? '離すと外す'
    : ps.key ? 'いまは「' + trim(ps.key.text, 8) + '」。離すと入れ替える'   /* ユーザーの文字。cornerBox が textContent で入れる */
    : '離すと入る';
  plate.appendChild(cornerBox('key', '★ ' + keyName, keySub, false));
  if (typeof store.setFirst === 'function') {
    const closed = isToday() && !ps.showFirst;   /* 畳むのは今日だけ（先の日はまだ区切りの時間を数えていない） */
    const firstName = isToday() ? '先に済ませる' : word + 'の先に済ませる';
    const firstSub = closed ? '今日はもう畳んだ' : pin === 'first' ? '離すと外す'
      : !ps.st.canAdd ? '席は 3 つまで'
      : (ps.st.endAt ? '〜 ' + hhmm(ps.st.endAt) + '・' : '') + '離すと入る';
    plate.appendChild(cornerBox('first', '↑ ' + firstName, firstSub, closed));
  }
  plate.hidden = false;
}
/* ---- スキン「海の生き物」の魚（2026-11-25 Issue #96 の返事「大事と魚をスキンに追加して切り替えできるようにして。
   魚は大事と先に設定した上に上がってくTODOの方にも近づいたり離れたりするようなアニメーションの移動を追加して」）----
   ・設定のスキンが海の生き物（body.skin-sea）で、小さい画面のときだけ、左下・右下のエリアの代わりに 2 匹の魚を出す。
     紫みの魚「大事」＝今日大事なこと、青みの魚「先に」＝先に済ませる。ふつうのボタンのスキンでは今までどおりエリア
   ・魚は泡の後ろ（.today-fishes。z-index を持たない）をゆっくり泳ぐ。その印の泡（比重で上へ浮いていく泡）があれば、
     その泡のまわりを回りながら、近づいたり離れたりする（半径が 30px ほど、ゆっくり伸び縮みする）。泡が無ければ面を左右にさまよう。
     位置は毎コマ JS で決め、transform だけを動かす（滑らかに）。向きは進む向きに合わせる
   ・泡を掴んでいる間は魚が止まって少し大きくなり、日を移す帯（z-index 9）より上に出る。魚の上で離すと入る（入れ方はエリアと同じ）
   ・動きを減らす設定では泳がせず、下の左右に置く */
let fishBox = null;
let fishRaf = 0;
const fish = { key: null, first: null };
const fishSt = { key: null, first: null };
const FISH_W = 64, FISH_H = 58;
function fishOn() {
  return !!fishBox && !wideOn && !listOn && !quadOn && !!document.body && document.body.classList.contains('skin-sea');
}
function renderFish(ps) {
  if (!fishBox) return;
  if (!fishOn()) { fishBox.hidden = true; stopFish(); return; }
  fishBox.hidden = false;
  const id = bubDrag ? bubDrag.id : null;
  const pin = id ? (pinsOf(ps).get(id) || null) : null;
  const day = curDay();
  const word = isToday() ? '今日' : dayLabel(day).split(' ')[0];
  const keyName = isToday() ? '今日大事なこと' : word + 'の大事なこと';
  const keySub = !id ? '' : pin === 'key' ? '離すと外す'
    : ps.key ? 'いまは「' + trim(ps.key.text, 8) + '」。離すと入れ替える' : '離すと入る';
  syncFish('key', true, '大事', keySub, keyName, false);
  const showFirst = typeof store.setFirst === 'function';
  const closed = isToday() && !ps.showFirst;
  const firstName = isToday() ? '先に済ませる' : word + 'の先に済ませる';
  const firstSub = !id ? '' : closed ? '今日はもう畳んだ' : pin === 'first' ? '離すと外す'
    : !ps.st.canAdd ? '席は 3 つまで' : '離すと入る';
  syncFish('first', showFirst, '先に', firstSub, firstName, closed);
  fishBox.classList.toggle('is-drag', !!id);
  if (reduceMotion()) { stopFish(); placeFishStatic(); }
  else startFish();
}
/* 魚 1 匹を出す・隠す・名前を替える。1 度だけ作って使い回す（作り直すと位置が跳ぶ）。
   el の第 3 引数は innerHTML に入るので、文字はすべて textContent・属性で入れる（泡の名前が混ざるため） */
function syncFish(kind, show, head, sub, name, closed) {
  let box = fish[kind];
  if (!box) {
    box = el('div', 'tp-fish tp-fish-' + kind);
    box.dataset.drop = kind;
    const swim = el('span', 'tp-fish-swim');
    swim.appendChild(fishSvg());
    box.appendChild(swim);
    const h = el('span', 'tp-fish-h');
    h.textContent = head;
    box.appendChild(h);
    fishBox.appendChild(box);
    fish[kind] = box;
  }
  box.hidden = !show;
  box.classList.toggle('is-closed', !!closed);
  box.dataset.name = name + 'の魚';
  box.title = name + '：泡を掴んでこの魚の上で離すと入る';
  box.setAttribute('aria-label', name + (sub ? '。' + sub : ''));
}
const SVG_NS_FISH = 'http://www.w3.org/2000/svg';
function fishSvg() {
  const svg = document.createElementNS(SVG_NS_FISH, 'svg');
  [['viewBox', '0 0 64 40'], ['width', '64'], ['height', '40'], ['class', 'tp-fish-ic'], ['aria-hidden', 'true'], ['focusable', 'false']]
    .forEach(([k, v]) => svg.setAttribute(k, v));
  [
    ['path', { class: 'tail', d: 'M44 20 L62 7 Q58 20 62 33 Z' }],
    ['path', { class: 'fin',  d: 'M24 9 Q30 1 38 8 Z M26 31 Q31 38 36 31 Z' }],
    ['ellipse', { class: 'body', cx: '26', cy: '20', rx: '21', ry: '12.5' }],
    ['path', { class: 'band', d: 'M30 8.6 Q34 20 30 31.4 L35 30.2 Q39 20 35 9.8 Z' }],
    ['circle', { class: 'eye', cx: '14', cy: '17', r: '2.6' }],
    ['path', { class: 'gill', d: 'M20 12 Q16 20 20 28' }],
  ].forEach(([tag, attrs]) => {
    const n = document.createElementNS(SVG_NS_FISH, tag);
    Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    svg.appendChild(n);
  });
  return svg;
}
function startFish() {
  if (fishRaf) return;
  let last = performance.now();
  const step = now => {
    fishRaf = 0;
    if (!fishBox || fishBox.hidden || !shown) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!bubDrag) moveFish(now / 1000, dt);   /* 掴んでいる間は止める（狙って離せるように） */
    fishRaf = requestAnimationFrame(step);
  };
  fishRaf = requestAnimationFrame(step);
}
function stopFish() {
  if (fishRaf) cancelAnimationFrame(fishRaf);
  fishRaf = 0;
}
/* その魚が寄っていく泡（漂う面の泡のノード）。大事は今日大事なことの泡、先には先に済ませるのまだの泡を 12 秒ごとに順に */
function pinnedNode(kind, t) {
  if (!stage) return null;
  let id = null;
  if (kind === 'key') id = lastPlate.key ? lastPlate.key.id : null;
  else if (lastPlate.st && lastPlate.st.open) {
    const rows = (lastPlate.rows || []).filter(r => !isDoneItem(r));
    if (rows.length) id = rows[Math.floor(t / 12) % rows.length].id;
  }
  if (!id) return null;
  try { return stage.querySelector('.bub[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }
  catch (e) { return null; }
}
function moveFish(t, dt) {
  const sr = stage.getBoundingClientRect();
  const w = sr.width, h = sr.height;
  if (!w || !h) return;
  ['key', 'first'].forEach(k => {
    const f = fish[k];
    if (!f || f.hidden) return;
    const s = fishSt[k] || (fishSt[k] = { x: w * (k === 'key' ? 0.25 : 0.7), y: h * (k === 'key' ? 0.55 : 0.3), face: 1, ph: k === 'key' ? 0.7 : 3.4 });
    let tx, ty;
    const node = pinnedNode(k, t);
    const r = node ? node.getBoundingClientRect() : null;
    if (r && r.width) {
      /* 泡のまわりを回りながら、近づいたり離れたりする */
      const cx = r.left + r.width / 2 - sr.left, cy = r.top + r.height / 2 - sr.top;
      const rad = r.width / 2 + 40 + 30 * Math.sin(t * 0.45 + s.ph);
      const a = t * 0.22 + s.ph;
      tx = cx + Math.cos(a) * rad;
      ty = cy + Math.sin(a) * rad * 0.6;
    } else {
      /* 泡が無いときは、面をゆっくり左右にさまよう */
      tx = w * (0.5 + 0.38 * Math.sin(t * 0.05 + s.ph));
      ty = h * (k === 'key' ? 0.5 : 0.25) + 24 * Math.sin(t * 0.13 + s.ph);
    }
    tx = Math.max(FISH_W / 2, Math.min(w - FISH_W / 2, tx));
    ty = Math.max(FISH_H / 2, Math.min(h - FISH_H / 2, ty));
    const e = Math.min(1, dt * 0.9);
    const nx = s.x + (tx - s.x) * e, ny = s.y + (ty - s.y) * e;
    const vx = dt ? (nx - s.x) / dt : 0;
    if (Math.abs(vx) > 4) s.face = vx > 0 ? -1 : 1;   /* 絵は左向き。右へ進むときは裏返す（小さな揺れでは向きを替えない） */
    s.x = nx; s.y = ny;
    placeFishNode(f, s);
  });
}
function placeFishNode(f, s) {
  f.style.transform = 'translate3d(' + (s.x - FISH_W / 2).toFixed(1) + 'px,' + (s.y - FISH_H / 2).toFixed(1) + 'px,0)';
  const sw = f.querySelector('.tp-fish-swim');
  if (sw) sw.style.transform = 'scaleX(' + s.face + ')';
}
function placeFishStatic() {
  const w = stage ? stage.clientWidth : 0, h = stage ? stage.clientHeight : 0;
  if (!w || !h) return;
  if (fish.key) placeFishNode(fish.key, fishSt.key = { x: FISH_W / 2 + 8, y: h - FISH_H / 2 - 8, face: 1, ph: 0 });
  if (fish.first) placeFishNode(fish.first, fishSt.first = { x: w - FISH_W / 2 - 8, y: h - FISH_H / 2 - 8, face: -1, ph: 0 });
}

/* エリア 1 つ。el の第 3 引数は innerHTML に入るので、文字はすべて textContent で入れる（泡の名前が混ざるため） */
/* 2026-11-25 利用者の決定「A、ただし、L字ではなくI字のエリアのみで実施」（モック app_spec の mock/corners-1125.html の案 A）：
   見える形は、下の縁に沿った細い帯（.tp-corner-rail。ふだん 6px）だけ。縞が角へ向かって流れ、掴んだ泡が近づくほど
   太く濃くなり（--near。onBubPointer の nearCorners）、指が乗ると塗りつぶす（.is-drop）。字は帯の上に短く「★ 大事」「↑ 先に」。
   落とす当たりは、帯を含む下の角の箱（幅 150・高さ 72。見えない）。説明（離すと入れ替える など）は読み上げにだけ渡す */
function cornerBox(kind, head, sub, closed) {
  const box = el('div', 'tp-corner tp-corner-' + kind);
  if (closed) box.classList.add('is-closed');
  box.dataset.drop = kind;
  box.dataset.name = (kind === 'key' ? '今日大事なこと' : '先に済ませる') + 'のエリア';
  box.setAttribute('aria-label', head + '。' + sub);
  const h = el('span', 'tp-corner-h');
  h.textContent = kind === 'key' ? '★ 大事' : '↑ 先に';
  box.appendChild(h);
  box.appendChild(el('span', 'tp-corner-rail'));
  return box;
}
/* 掴んだ泡（指先）が左下・右下の角にどれだけ近いか（0〜1）を、それぞれのエリアの --near に入れる */
function nearCorners(x, y) {
  if (!plate || plate.hidden) return;
  plate.querySelectorAll('.tp-corner').forEach(n => {
    const r = n.getBoundingClientRect();
    if (!r.width) return;
    const cx = n.classList.contains('tp-corner-key') ? r.left : r.right;
    const d = Math.hypot(x - cx, y - r.bottom);
    const near = x >= 0 ? Math.max(0, Math.min(1, 1 - (d - 90) / 260)) : 0;
    n.style.setProperty('--near', near.toFixed(3));
  });
}

/* 外す（入れた泡を同じ目印で離したとき）。今日には残す。［元に戻す］で入れ直す */
function takeOutSeat(id, kind, day) {
  const t = store.get(id);
  if (!t) return;
  const name = kind === 'key' ? (day === todayKey() ? '今日大事なこと' : '大事なこと') : '先に済ませる';
  const ok = kind === 'key' ? store.setKey(id, day, false) : store.setFirst(id, day, false) === 'ok';
  if (!ok) return;
  playSfx('place');
  toast('「' + trim(t.text) + '」を' + name + 'から外した', {
    label: '元に戻す',
    on: () => { if (kind === 'key') store.setKey(id, day, true); else store.setFirst(id, day, true); },
  });
}
/* もう片方の枠へ移す。入れられなければ（席がいっぱい・さっとでない）元の枠に残す */
function moveSeat(id, from, to, day) {
  if (to === 'key') {
    if (from === 'first') store.setFirst(id, day, false);
    const before = store.keyItem(day);
    placeKey(id, day);
    if (from === 'first' && !store.isKey(id, day) && (!before || before.id !== id)) store.setFirst(id, day, true);
    return;
  }
  /* 今日大事なこと → 先に済ませる。先に入れてみて、入ったときだけ大事なことから外す */
  placeFirst(id, true, day);
  if (store.isFirst(id, day)) store.setKey(id, day, false);
}

function setQuad(on) {
  if (!quad || quadOn === on) return;
  if (on && listOn) setList(false);      /* 一覧と四つは同時に出さない（Issue #86） */
  quadOn = on;
  closeMenu();
  quad.el.hidden = !on;
  if (stage) stage.classList.toggle('is-quad', on);
  syncQuadButton(quadBtn, on);
  if (on) { if (field) { field.stop(); field.setItems([]); } }
  else {
    quad.clear();
    render();
    if (field && shown) { field.relayout(); field.start(); }
    return;
  }
  render();
}

/* ---------------- タグのフィルター（2026-11-21 Issue #89） ----------------

   > 今日TODOにもタグのフィルターを追加して

   海の「▽ フィルター」と同じ形・同じ選び方（js/screens/sea.js の openNarrowPop）。
   ・1段目の ≡ の右に置く（Issue #92 で形と場所を海の「タグ無し ▽」にそろえた）。札は「ぜんぶ ▽」、選ぶとそのタグの名前を名乗る
   ・選んだタグの**どれかが付いているもの**を出す（「または」）。重ねて選べる。先頭の「ぜんぶ」で取り消す
   ・泡・四つに分ける・一覧・さいころの全部に効く（見えているものと引く対象を食い違わせない）
   ・並び：ぜんぶ → 自分のタグ → 最初からあるタグ → 「タグ無し」（海の一覧と同じ順。Issue #88）
     「今日」「完了」は出さない（この画面の泡はどれもその日に置いたもの。済んだものは一覧で分かれる）
   ・「タグ無し」は、今日・完了のほかにタグが付いていないもの
   ・選んだものは、アプリを開いている間だけ覚える（日を移っても残る。海のフィルターとは別に持つ）
   ・件数は出さない（契約 §0） */
const NO_TAG = '__none';
const ALL_NAME = 'ぜんぶ';
const FILTER_SKIP = ['today', 'done'];
const FILTER_GROUP_NAME = { mine: '自分のタグ', fixed: '最初からあるタグ', other: 'そのほか' };
const filterSet = new Set();
let filterBtn = null, filterLabel = null, filterPop = null;

function hasTagApi() {
  return typeof store.tags === 'function' && typeof store.tagsOf === 'function';
}

function filterChoices() {
  const out = [{ id: null, name: ALL_NAME, group: 'clear' }];
  if (!hasTagApi()) return out;
  const mine = [], fixed = [];
  try {
    (store.tags() || []).forEach(t => {
      if (!t || typeof t.id !== 'string' || FILTER_SKIP.indexOf(t.id) >= 0) return;
      /* 設定で隠したタグは出さない（Issue #90）。いま絞っているものだけは、外せるように残す */
      if (t.hidden && !filterSet.has(t.id)) return;
      const row = { id: t.id, name: t.name, color: t.color, group: t.special ? 'fixed' : 'mine' };
      (t.special ? fixed : mine).push(row);
    });
  } catch (e) { /* タグの無い版 */ }
  return out.concat(mine, fixed, [{ id: NO_TAG, name: 'タグ無し', group: 'other' }]);
}

/* その泡を出すか。何も選んでいなければ全部出す */
function passFilter(t) {
  if (!filterSet.size || !hasTagApi() || !t) return true;
  let tags;
  try { tags = (store.tagsOf(t.id) || []).filter(k => FILTER_SKIP.indexOf(k) < 0); }
  catch (e) { return true; }
  for (const k of filterSet) {
    if (k === NO_TAG) { if (!tags.length) return true; }
    else if (tags.indexOf(k) >= 0) return true;
  }
  return false;
}

/* 消えたタグを選んだままにしない（設定でタグを消したときなど） */
function pruneFilter() {
  if (!filterSet.size) return;
  const ok = new Set(filterChoices().map(c => c.id));
  [...filterSet].forEach(k => { if (!ok.has(k)) filterSet.delete(k); });
}

/* いま絞っているものの名前。絞っていなければ null。2つ以上は「◯◯ と 2つ」 */
function filterName() {
  if (!filterSet.size) return null;
  const all = filterChoices();
  const names = [...filterSet].map(k => (all.find(x => x.id === k) || {}).name)
    .filter(n => typeof n === 'string' && n);
  if (!names.length) return null;
  return names.length === 1 ? names[0] : names[0] + ' と ' + (names.length - 1) + 'つ';
}

function syncFilterBtn() {
  if (!filterBtn) return;
  filterBtn.hidden = !hasTagApi();
  if (filterBtn.hidden) { closeFilterPop(false); return; }
  const nm = filterName();
  filterLabel.textContent = nm || ALL_NAME;
  filterBtn.classList.toggle('is-on', !!nm);
  filterBtn.setAttribute('aria-pressed', nm ? 'true' : 'false');
  filterBtn.setAttribute('aria-label', nm
    ? '「' + nm + '」でフィルターしている。押すと選び直す'
    : 'いまは' + ALL_NAME + 'を表示している。押すとタグでフィルターする');
  filterBtn.title = 'タグでフィルター';
}

/* id が null なら全部やめる。それ以外は入れ／外しの切り替え */
function setFilter(id) {
  if (id === null) { if (!filterSet.size) return; filterSet.clear(); }
  else if (filterSet.has(id)) filterSet.delete(id);
  else filterSet.add(id);
  closeMenu();
  render();
}

function closeFilterPop(restoreFocus) {
  if (!filterPop) return false;
  filterPop.remove();
  filterPop = null;
  if (filterBtn) filterBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus && filterBtn && !filterBtn.hidden) filterBtn.focus({ preventScroll: true });
  return true;
}

function openFilterPop() {
  if (closeFilterPop(true)) return;
  if (!stage) return;
  const pop = el('div', 'today-filter-pop');
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'タグでフィルター');
  pop.dataset.screen = 'today.filter'; pop.dataset.screenLayer = '3';
  const rows = [];
  let lastGroup = 'clear';
  filterChoices().forEach(c => {
    /* まとまりが変わるところに小見出し。押せない文字なので矢印キーの移動には入らない */
    if (c.group !== lastGroup && FILTER_GROUP_NAME[c.group]) {
      const h = el('div', 'tf-head');
      h.setAttribute('role', 'presentation');
      h.textContent = FILTER_GROUP_NAME[c.group];
      pop.appendChild(h);
    }
    lastGroup = c.group;
    const b = el('button', 'tf-row');
    b.type = 'button';
    const isClear = c.id === null;
    b.setAttribute('role', isClear ? 'menuitem' : 'menuitemcheckbox');
    if (isClear) b.classList.add('is-clear');
    else b.setAttribute('aria-checked', filterSet.has(c.id) ? 'true' : 'false');
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    if (c.color) dot.style.setProperty('--tcd', c.color);
    else dot.classList.add('is-none');
    const nm = el('span', 'nm');
    nm.textContent = c.name;                 /* ユーザーの文字。innerHTML には入れない */
    b.appendChild(dot);
    b.appendChild(nm);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      setFilter(c.id);
      /* 重ねられるので、選んでも閉じない。「ぜんぶ」だけは押した時点で閉じる（海と同じ） */
      if (isClear) { closeFilterPop(true); return; }
      rows.forEach(r => { if (r.id !== null) r.btn.setAttribute('aria-checked', filterSet.has(r.id) ? 'true' : 'false'); });
    });
    rows.push({ id: c.id, btn: b });
    pop.appendChild(b);
  });
  pop.addEventListener('keydown', ev => {
    const bs = Array.from(pop.querySelectorAll('button'));
    const i = bs.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeFilterPop(true); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); bs[(i + 1 + bs.length) % bs.length].focus(); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); return; }
    if (ev.key === 'Tab') closeFilterPop(false);
  });
  stage.appendChild(pop);
  /* クラゲ（泳ぐフィルター。Issue #96 の 7 回目の返事）の真下に出す。面の左右からははみ出さない */
  try {
    const sr = stage.getBoundingClientRect(), br = filterBtn.getBoundingClientRect();
    if (br.width && sr.width) {
      const pw = pop.offsetWidth || 200;
      pop.style.left = Math.round(Math.max(10, Math.min(br.left - sr.left, sr.width - pw - 10))) + 'px';
      const top = Math.round(br.bottom - sr.top + 6);
      pop.style.top = top + 'px';
      pop.style.maxHeight = Math.max(160, Math.round(sr.height - top - 10)) + 'px';
    }
  } catch (e) { /* 測れなければ CSS の置き場のまま */ }
  filterPop = pop;
  filterBtn.setAttribute('aria-expanded', 'true');
  const first = pop.querySelector('[aria-checked="true"]') || pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

/* 選び札の外を押したら畳む。押した先のボタンを取りこぼさないよう capture で先に拾う（海と同じ） */
function onFilterOutside(ev) {
  if (!filterPop) return;
  const t = ev.target;
  if (t && t.closest && t.closest('.today-filter-pop, .today-filterbtn')) return;
  closeFilterPop(false);
}

/* ---------------- その日の海に直に書く（利用者の指示） ----------------

   前はこの画面に入力欄が無く、**海に書いてからタブへ運ぶ**しか道が無かった。
   「今日ぶんを今から書く」ときに、いったん海を経由するのは遠回り。

   ・書いたものは **いま映している日**に入る（今日でも、明日でも）
   ・**タグもその場で付けられる。**入力欄に触ると札が開く（ふだんは畳んでおく——
     常に出しておくと、書く前から選択肢が並んで水面が狭くなる）
   ・**過ぎた日には出さない。**過去はその日の記録なので、あとから足させない

   札に出さないタグが2つある：
     今日 … いま映している日に入るので、重ねて持つ意味が無い
     完了 … これから書くものに付ける意味が無い */

let composer = null, cInput = null, cSend = null, cTags = null;
/* 選んだタグは送ったあとも残す。同じタグのものを続けて書くのが楽になる。
   隠し持たない——札は出たままなので、何が付くかは目で見える */
const picked = new Set();

function composerTags() {
  if (typeof store.tags !== 'function') return [];
  /* 設定で隠したタグ（Issue #90）は出さない。選んだままのものだけは、外せるように残す */
  try { return store.tags().filter(t => t && t.id !== 'today' && t.id !== 'done' && (!t.hidden || picked.has(t.id))); }
  catch (e) { return []; }
}

function renderComposerTags() {
  if (!cTags) return;
  const list = composerTags();
  cTags.replaceChildren();
  list.forEach(t => {
    const b = el('button', 'tc-tag');
    b.type = 'button';
    b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
    const dot = el('span', 'tc-dot');
    dot.setAttribute('aria-hidden', 'true');
    if (t.color) dot.style.setProperty('--tcd', t.color);
    const nm = el('span', 'tc-nm');
    nm.textContent = t.name;                          /* ユーザーの文字 */
    b.appendChild(dot);
    b.appendChild(nm);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      if (picked.has(t.id)) picked.delete(t.id); else picked.add(t.id);
      b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
      /* 札を触ると入力欄から焦点が外れる。開いたままにしておく */
      if (composer) composer.classList.add('is-open');
    });
    cTags.appendChild(b);
  });
  /* 消えたタグを選んだままにしない */
  [...picked].forEach(id => { if (!list.some(t => t.id === id)) picked.delete(id); });
}

function syncComposer() {
  if (!composer) return;
  composer.hidden = false;             /* 過ぎた日も出す（2026-11-25「基本動作は同じにして」。前は過ぎた日には出さなかった） */
  if (composer.hidden) return;
  const v = cInput ? cInput.value.trim() : '';
  if (cSend) cSend.disabled = !v;
  if (cInput) {
    cInput.placeholder = isToday() ? '今日ぶんを書く' : dayLabel(curDay()) + 'ぶんを書く';
    cInput.setAttribute('aria-label', cInput.placeholder);
  }
}

function addFromComposer() {
  if (!cInput) return;
  const body = cInput.value.trim();
  if (!body) return;
  const t = store.add(body);
  if (!t) return;
  playSfx('add');
  /* まず日に置く（日が本体）。そのあとタグを付ける */
  if (typeof store.setDay === 'function') store.setDay(t.id, curDay(), true);
  else store.setToday(t.id, true);
  if (typeof store.setTag === 'function') {
    picked.forEach(id => { try { store.setTag(t.id, id, true); } catch (e) { /* 無いタグ */ } });
  }
  cInput.value = '';
  syncComposer();
  cInput.focus({ preventScroll: true });
  render();
  /* フィルターの外のものを書いたら、消えたのではないと言う（Issue #89） */
  if (filterSet.size && !passFilter(t)) {
    toast('「' + trim(body) + '」を置いた。フィルターの外なので、いまは見えない', {
      label: ALL_NAME + 'を見る',
      on: () => setFilter(null),
    });
  }
}

/* 見出しの日付。押すと近い日が選べる。遠い日は左右になぞる */
/* 空のときのことば。日によって言うことが違う。
   **どれも未達を名指ししない・件数を出さない・命令形にしない**（§0）。
   過去について「なにもしなかった」とは言わない——置かなかっただけなので */
function syncEmptyNote() {
  if (!emptyNote) return;
  const l1 = emptyNote.querySelector('.l1');
  const l2 = emptyNote.querySelector('.l2');
  if (!l1 || !l2) return;
  const n = offsetOf(curDay());
  /* フィルターで全部外れたとき（Issue #89）。置いていないのとは違うので、戻し方を言う */
  if (filterSet.size && dayItems(curDay()).length) {
    l1.textContent = 'フィルターに当てはまるものは無い。';
    l2.textContent = '「' + (filterName() || '') + ' ▽」から「' + ALL_NAME + '」を選ぶと、もとの眺め。';
    return;
  }
  if (n === 0) {
    l1.textContent = '今日ぶんの水面。';
    l2.textContent = '海のバブルを、このタブに落とすと浮かぶ。';
  } else if (n < 0) {
    l1.textContent = dayLabel(curDay()) + 'の水面。';
    l2.textContent = 'この日には、まだ何も置いていなかった。';
  } else {
    l1.textContent = dayLabel(curDay()) + 'の水面。';
    l2.textContent = '先に置いておくと、その日にここへ浮かぶ。';
  }
}

function syncDayBtn() {
  if (!dayBtn) return;
  dayBtn.textContent = dayLabel(curDay());
  dayBtn.classList.toggle('is-past', isPast());
  dayBtn.classList.toggle('is-future', offsetOf(curDay()) > 0);
  dayBtn.setAttribute('aria-label', dayLabel(curDay()) + 'の水面。押すと日を選べる');
}

function goDay(key) {
  const next = (key === todayKey()) ? null : key;
  if (viewDay === next) return;
  viewDay = next;
  closeSuggest();
  syncDayBtn();
  announceDay();
  render();
}

function closeDayPop() {
  if (!dayPop) return;
  dayPop.back.remove();
  dayPop.box.remove();
  window.removeEventListener('keydown', dayPop.onKey, true);
  dayPop = null;
}

/* 選べる日。過去は「昨日」まで（それより前はなぞって行く——
   遠い過去を一覧にすると、それ自体が振り返りの装置になる）。
   未来は1週間ぶん。**「週末」は次の土曜**を指す */
function dayChoices() {
  const t = todayKey();
  const out = [
    { key: shiftDay(t, -1), label: '昨日' },
    { key: t, label: '今日' },
    { key: shiftDay(t, 1), label: '明日' },
    { key: shiftDay(t, 2), label: '明後日' },
  ];
  for (let i = 3; i <= 7; i++) {
    const k = shiftDay(t, i);
    const d = dayToDate(k);
    out.push({ key: k, label: (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）' });
  }
  /* 次の土曜。すでに候補に入っていれば足さない */
  const sat = (() => { let k = t; for (let i = 1; i <= 7; i++) { k = shiftDay(t, i); if (dayToDate(k).getDay() === 6) return k; } return null; })();
  const row = out.find(o => o.key === sat);
  if (row) row.label = '週末 ' + row.label;
  return out;
}

/* anchor を省くと見出しのボタンの下。下タブから呼ぶときは、その的の上に出す */
function openDayPop(anchor) {
  if (dayPop) { closeDayPop(); return; }
  const back = el('div', 'today-daypop-back');
  const box = el('div', 'today-daypop');
  box.setAttribute('role', 'menu');
  box.setAttribute('aria-label', '日を選ぶ');
  box.dataset.screen = 'today.daypick'; box.dataset.screenLayer = '4';

  dayChoices().forEach(c => {
    const b = el('button', 'today-daych');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const nm = el('span', 'nm');
    nm.textContent = c.label;
    const dt = el('span', 'dt');
    const d = dayToDate(c.key);
    dt.textContent = (d.getMonth() + 1) + '/' + d.getDate() + '（' + DOW[d.getDay()] + '）';
    b.appendChild(nm);
    if (!/\d\/\d/.test(c.label)) b.appendChild(dt);   /* 言葉の候補にだけ日付を添える */
    if (c.key === curDay()) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', ev => { ev.preventDefault(); closeDayPop(); goDay(c.key); });
    box.appendChild(b);
  });

  /* 今週・今月をまとめて見る（2026-11-22 Issue #80 の返事「週月のタブからの遷移にプラスして、…今日の長押しの中に項目を増やして
     そこから確認できるようにできる？」）。押すと海のリスト表示の「週」「月」（js/periodview.js）の今週・今月を開く。
     週・月のタブを隠していても開ける（画面はタブと別にある） */
  const sep = el('div', 'today-daysep');
  sep.setAttribute('role', 'separator');
  box.appendChild(sep);
  [['week', '今週をまとめて見る'], ['month', '今月をまとめて見る']].forEach(([face, label]) => {
    const b = el('button', 'today-daych is-period');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    const nm = el('span', 'nm');
    nm.textContent = label;
    b.appendChild(nm);
    const ar = el('span', 'dt');
    ar.textContent = '▦';
    ar.setAttribute('aria-hidden', 'true');
    b.appendChild(ar);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      closeDayPop();
      /* 2026-11-23 の返事で週・月はリスト表示の形に移ったので、海のリスト表示の週・月を開く */
      window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'sea', list: face } }));
    });
    box.appendChild(b);
  });

  const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
  back.addEventListener('pointerdown', eat);
  back.addEventListener('click', eat);
  back.addEventListener('pointerup', ev => { eat(ev); closeDayPop(); });
  const onKey = ev => {
    if (ev.key !== 'Escape' || fromFeedback(ev)) return;
    ev.preventDefault();
    const back2 = dayPop && dayPop.was;
    closeDayPop();
    if (back2 && back2.isConnected) back2.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(back);
  document.body.appendChild(box);
  dayPop = { back, box, onKey, was: anchor || dayBtn };
  /* 的の下に出す。入り切らないなら上へ返す（下タブから呼ぶとこちらになる）。
     画面の端からもはみ出させない */
  const a = anchor || dayBtn;
  const r = a.getBoundingClientRect();
  const M = 8;
  const w = box.offsetWidth, h = box.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - M) top = r.top - 6 - h;
  box.style.left = Math.round(Math.max(M, Math.min(r.left, window.innerWidth - w - M))) + 'px';
  box.style.top = Math.round(Math.max(M, top)) + 'px';
  const first = box.querySelector('.today-daych');
  if (first) first.focus({ preventScroll: true });
}

/* 左右になぞって隣の日へ。海の面送りと同じ間合い（44px か幅の 22%）。
   バブル・ボタンの上から始めた指は拾わない */
let swipe = null;
function onDayDown(ev) {
  if (swipe || dayPop) return;
  if (ev.button != null && ev.button !== 0) return;
  const t = ev.target;
  if (!t || !t.closest || t.closest('.bub, button, a, input, textarea, select, .today-filter-pop')) return;
  swipe = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, axis: null };
  window.addEventListener('pointermove', onDayMove, true);
  window.addEventListener('pointerup', onDayUp, true);
  window.addEventListener('pointercancel', onDayUp, true);
}
function onDayMove(ev) {
  if (!swipe || ev.pointerId !== swipe.pid) return;
  const dx = ev.clientX - swipe.x0, dy = ev.clientY - swipe.y0;
  if (!swipe.axis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swipe.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  }
  swipe.dx = dx;
  if (swipe.axis === 'x') stage.classList.add('is-daymove');
}
function onDayUp(ev) {
  if (!swipe || (ev && ev.pointerId !== swipe.pid)) return;
  const s = swipe;
  swipe = null;
  window.removeEventListener('pointermove', onDayMove, true);
  window.removeEventListener('pointerup', onDayUp, true);
  window.removeEventListener('pointercancel', onDayUp, true);
  stage.classList.remove('is-daymove');
  if (s.axis !== 'x') return;
  const need = Math.max(44, (stage.clientWidth || 320) * 0.22);
  if (Math.abs(s.dx) < need) return;
  /* 右へなぞる＝過去へ（紙をめくる向き）。左へなぞる＝先へ */
  goDay(shiftDay(curDay(), s.dx > 0 ? -1 : 1));
}

function render() {
  if (!field) return;
  pruneFilter();                 /* 消えたタグで絞ったまま全部が隠れないように、集める前に */
  crowded = false;               /* 漂う面に出すときだけ fitItems が決め直す */
  lastPlate = plateState();
  renderPlate(lastPlate);
  /* 今日大事なこと・先に済ませるの印（item.pin）。泡・四つ・一覧のどれでも同じ色と字で見分ける（Issue #96。
     bubble.js が .is-pin-key / .is-pin-first と .pinlb、一覧は listRow） */
  const pins = pinsOf(lastPlate);
  const items = itemsForField().map(it => pins.has(it.id) ? Object.assign({}, it, { pin: pins.get(it.id) }) : it);
  if (listOn && listBox) {
    /* 一覧で見ている間も漂う面に渡さない（同じものが泡と行の2つ出る。Issue #86） */
    renderList(items);
  } else if (quadOn && quad) {
    /* 分けている間は漂う面に渡さない（同じ泡が2つ出る） */
    quad.render(items.map(it => ({ id: it.id, item: it, opts: { size: QUAD_BUB, colors: it.colors, tagNames: it.tagNames, marks: [] } })));
  } else {
    /* 小さい画面：今日大事なこと・先に済ませるの泡も同じ形で漂わせ、色で見分ける（上の item.pin）。
       大きい画面：枠に出している泡は漂う面には渡さない。ただし盤を開いている泡は閉じるまで残す（消すと盤ごと閉じる。閉じたら onHold が描き直す） */
    const hide = wideOn ? plateIds(lastPlate) : new Set();
    if (heldId) hide.delete(heldId);
    field.setItems(fitItems(hide.size ? items.filter(it => !hide.has(it.id)) : items));
  }
  syncListBtn();                 /* 入りきらないかどうかで札の言い方が変わる（Issue #87） */
  syncFilterBtn();               /* タグが増減していることがある（Issue #89） */
  if (emptyNote) {
    emptyNote.hidden = items.length > 0 || quadOn;
    syncEmptyNote();
  }
  syncDayBtn();
  syncComposer();
  renderComposerTags();          /* 設定でタグが増減していることがある */
  syncRandomBtn();
  syncSuggest();
  /* 前は「過去は記録なので触らせない」として is-readonly でさいころ・おすすめを消していた。
     2026-11-25 利用者の指示「今日以外の日付の海での操作が今日の海と対称的ではない（基本動作は同じにして）」で外した
     （Issue #97 で左右の帯も過去で動くようにしてあり、過去だけ足せない・選べないのは食い違うため） */
  if (stage) stage.classList.remove('is-readonly');

  /* 外で状態が変わったら、開いている詳細を同期し直す（契約 §14） */
  if (detail) {
    if (!store.get(detail.id)) closeDetail();
    else detail.sync();
  }
}

/* ---------------- ランダムスタート（追補5 §4） ----------------
   選べないときに、選ばずに始めるためのもの。おすすめではない。
   だから重み付けはしない（古い順・放置順にすると「催促」になる／契約 §0）。
   候補は**いま画面に浮かんでいるもの**（dayItems）から、完了したものを除いたぶん。
   海の pickFace() と同じ規則：見えている面から選び、終わったものは選ばない
   （終わったものを「はじめる」のは筋が通らない）。
   過去の日を映しているときは、その日に置いたもののうち、まだ終わっていないものが候補。

   見せ方は海と同じ：玉が輪になって churn し、光が次々に移り、最後の1つが大きくなる。
   玉は候補そのものではなく「候補が混ざっている」ことの絵にしている
   （漂うバブルそのものを混ぜるには drift のノードを毎フレーム奪うことになるため）。
   **選ぶのは混ぜる前。**Math.random() を1回引いて決め、そのあとで絵を作るので、
   無作為さは見せ方に一切左右されない。 */

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* 先に済ませるの泡が、その日はもう済んだか：完了したか、今日なら［今日はここまで］（着手の印）を押したか。
   2026-11-25 利用者の指示「先にを今日はここまでにしても同じ様に光っている。終わったのだから目立たせなくして」。
   前は完了だけを見ていたので、今日はここまでにした泡も区切りの時間まで青みの色が付いたままだった */
function firstOver(t) {
  return isDoneItem(t) || (!!t && isToday() && isStarted(t.id));
}

function isDoneItem(t) {
  if (!t) return false;
  if (typeof store.isDone === 'function') {
    try { return !!store.isDone(t.id); } catch (e) { /* 落ちない */ }
  }
  return !!t.done;
}

function pickList() {
  /* フィルター（Issue #89）を掛けたあとの、見えているものから引く（海の pickFace と同じ） */
  try { return dayItems(curDay()).filter(t => !isDoneItem(t) && passFilter(t)); } catch (e) { return []; }
}

/* 光が渡り歩く順。うしろから組み立てるので、最後は必ず勝ち玉、
   かつ隣り合う2つが同じ玉にならない（同じだと光が止まって見える）。 */
function hopOrder(n, winner) {
  const seq = new Array(SHUF_HOPS.length);
  seq[seq.length - 1] = winner;
  for (let i = seq.length - 2; i >= 0; i--) {
    let k = Math.floor(Math.random() * n);
    if (n > 1 && k === seq[i + 1]) k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n;
    seq[i] = k;
  }
  return seq;
}

/* 盤を組み立てる。戻り値の total は「絵が終わるまで」の ms */
function buildShuffle(n, winner) {
  const wrap = el('div', 'today-shuffle');
  wrap.setAttribute('role', 'status');
  wrap.appendChild(el('span', 'sr', (isToday() ? '今日' : dayLabel(curDay())) + 'から1つ選んでいます'));

  const ring = el('div', 'rnd-ring');
  ring.setAttribute('aria-hidden', 'true');
  /* 玉が重ならない半径。直径の 1.15 倍を等間隔に置ける円周から逆算する。
     1.0 だと隣どうしが触れて、玉が9個10個のとき輪ではなく「1つの塊」に見える */
  const r = Math.max(52, Math.round(SHUF_D * 1.15 * n / (2 * Math.PI)));
  ring.style.setProperty('--r', r + 'px');
  ring.style.width = (r * 2 + SHUF_D + 8) + 'px';
  ring.style.height = ring.style.width;

  const seq = hopOrder(n, winner);
  const at = [];
  let t = 0;
  SHUF_HOPS.forEach(d => { at.push(t); t += d; });
  const end = at[at.length - 1];        /* 光が勝ち玉に着いた時刻 */
  const total = end + SHUF_WIN;
  ring.style.animationDuration = total + 'ms';

  for (let i = 0; i < n; i++) {
    const b = el('div', 'rnd-b');
    b.style.setProperty('--a', (360 * i / n) + 'deg');
    /* 玉ごとに息の位相をずらす。そろえると「輪が回っているだけ」に見えて混ざらない */
    b.style.animationDelay = (-i * 47) + 'ms';
    const face = el('i', 'rnd-face');
    /* 数字だけから組み立てる文字列。ユーザーの入力は混ぜない */
    const parts = [];
    seq.forEach((k, h) => {
      if (k !== i || h === seq.length - 1) return;
      parts.push('tdy-rnd-lit ' + SHUF_HOPS[h] + 'ms linear ' + at[h] + 'ms');
    });
    parts.push(i === winner
      ? 'tdy-rnd-win ' + SHUF_WIN + 'ms cubic-bezier(.2,.8,.3,1) ' + end + 'ms both'
      : 'tdy-rnd-dim ' + SHUF_WIN + 'ms ease-out ' + end + 'ms both');
    face.style.animation = parts.join(', ');
    b.appendChild(face);
    ring.appendChild(b);
  }
  wrap.appendChild(ring);
  return { node: wrap, total: total };
}

/* 途中でタブを離れた／もう一度押された、のときに絵ごと畳む。
   畳んだときは開かない（開くのは時間切れの1本道だけ） */
function cancelShuffle() {
  if (!shuffle) return;
  clearTimeout(shuffle.timer);
  if (shuffle.node) shuffle.node.remove();
  shuffle = null;
  syncRandomBtn();
}

function randomStart() {
  if (shuffle) return;                  /* 混ぜている最中は受け付けない */
  const list = pickList();
  if (!list.length) return;
  /* ここが唯一の抽選。重み付けはしない */
  const t = list[Math.floor(Math.random() * list.length)];
  if (!t) return;

  /* 混ぜないで開く場合：
     ・prefers-reduced-motion: reduce（追補5 §4）
     ・候補が1つしか無いとき——混ざりようがないのに混ぜて見せるのは嘘になる
     ・盤を置く先がまだ無いとき */
  if (reduceMotion() || list.length < 2 || !stage) { openFive(t.id); return; }

  const n = Math.min(list.length, SHUF_MAX);
  const winner = Math.floor(Math.random() * n);   /* 玉と項目は結び付いていない。位置も無作為 */
  const built = buildShuffle(n, winner);
  stage.appendChild(built.node);
  /* ペインが裏に回っていると setTimeout は1秒単位に間引かれる（契約 §14）。
     そのときは絵が少し長く出るだけで、開く経路は変わらない */
  const timer = setTimeout(() => {
    const cur = shuffle;
    shuffle = null;
    if (cur && cur.node) cur.node.remove();
    syncRandomBtn();
    openFive(t.id);                     /* 選んだあとの経路はいままでと同じ */
  }, built.total + 60);
  shuffle = { node: built.node, timer: timer };
  syncRandomBtn();
}

function syncRandomBtn() {
  if (!randomBtn) return;
  const n = pickList().length;
  randomBtn.disabled = n === 0 || !!shuffle;
  /* 映している日の名前で言う。「今日」と決め打つと、明日を映しているときに
     さいころだけ別の日の話をしているように読める（実際、前は本当にそうだった） */
  const word = isToday() ? '今日' : dayLabel(curDay());
  const say = word + 'から1つ選んで、5分だけ集中';
  randomBtn.title = n ? say : 'ここには選べるものが無い';
  randomBtn.setAttribute('aria-label', say);
}

/* さいころの印。「無作為に1つ」を絵で言う。
   絵文字も外部画像も使わない（契約 §15）。色は currentColor に任せる。
   海の diceIcon() と同じ形にそろえてある（同じ操作は同じ印） */
const SVGNS = 'http://www.w3.org/2000/svg';

function diceIcon() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const box = document.createElementNS(SVGNS, 'rect');
  box.setAttribute('x', '4'); box.setAttribute('y', '4');
  box.setAttribute('width', '16'); box.setAttribute('height', '16');
  box.setAttribute('rx', '4.4');
  svg.appendChild(box);

  [[8.6, 8.6], [12, 12], [15.4, 15.4]].forEach(p => {
    const pip = document.createElementNS(SVGNS, 'circle');
    pip.setAttribute('cx', String(p[0]));
    pip.setAttribute('cy', String(p[1]));
    pip.setAttribute('r', '1.35');
    pip.setAttribute('fill', 'currentColor');
    pip.setAttribute('stroke', 'none');
    svg.appendChild(pip);
  });

  return svg;
}

/* ---------------- 5分だけ集中 ---------------- */

/* 押した時点では何も記録しない。5分にたどりついたときだけ「はじめた」を立てる。
   focus.js は動的に読み込む（todo.js と同じ理由：壊れていてもこの画面は開ける） */
function openFive(id) {
  const t = store.get(id);
  if (!t) return;
  import('../focus.js').then(m => {
    m.openFocus({
      id: id,
      title: t.text,
      firstStep: detailOf('firstStepOf', id),
      url: detailOf('urlOf', id),
      minutes: 5,
      onClose(info) {
        /* 集中画面の [完了]。completed:true のとき reachedGoal は false（両方立てない） */
        if (info && info.completed) { completeWithUndo(id); render(); return; }
        if (info && info.reachedGoal) {
          if (typeof store.start === 'function' && !isStarted(id)) store.start(id, null);
          render();   /* store が通知しなかったときのために引き直す */
        }
      },
    });
  }).catch(() => { toast('集中の画面をいま開けない。'); });
}

/* ---------------- 完了・消す ---------------- */

function completeWithUndo(id) {
  if (typeof store.complete !== 'function') return;
  /* complete() は項目を消さなくなり、戻り値も「項目そのもの」に変わった
     （前は remove() と同じ {item, index}）。名前は呼ぶ前に取っておくのが確実。 */
  const t = store.get(id);
  const name = trim(t ? t.text : '');
  const snap = store.complete(id);
  if (!snap) return;
  playCompleteSound();
  toast('「' + name + '」を完了にした', {
    label: '取り消す',
    on: () => {
      /* restore() は項目そのものも受けるよう広げられているが、
         完了を戻すのは uncomplete() が本来の口 */
      if (typeof store.uncomplete === 'function') store.uncomplete(id);
      else store.restore(snap);
    },
  });
}

function removeWithUndo(id) {
  const snap = store.remove(id);          /* 消すときは音を鳴らさない（契約 §6） */
  if (!snap) return;
  toast('「' + trim(snap.item ? snap.item.text : '') + '」を消した', {
    label: '元に戻す',
    on: () => store.restore(snap),
  });
}

/* ---------------- タブへのドロップ ---------------- */

/* 海へ = 全解除（契約 §2）。取り消せるように、外す前の所属を控えておく */
function dropToSea(id) {
  const t = store.get(id);
  if (!t) return;
  const before = {
    today: !!t.today,
    gap: typeof store.isGap === 'function' ? !!store.isGap(id) : false,
    anchors: (typeof store.anchorsOf === 'function' && store.anchorsOf(id)) || [],
  };

  store.setToday(id, false);
  if (typeof store.setGap === 'function') store.setGap(id, false);
  if (typeof store.clearAnchors === 'function') store.clearAnchors(id);

  toast('「' + trim(t.text) + '」を海へ戻した', {
    label: '元に戻す',
    on: () => {
      if (before.today) store.setToday(id, true);
      if (before.gap && typeof store.setGap === 'function') store.setGap(id, true);
      if (typeof store.setAnchor === 'function') {
        before.anchors.forEach(a => store.setAnchor(id, typeof a === 'string' ? a : a && a.id, true));
      }
    },
  });
}

function dropToGap(id) {
  const t = store.get(id);
  if (!t || typeof store.setGap !== 'function') return;
  const was = typeof store.isGap === 'function' ? !!store.isGap(id) : false;
  if (was) { toast('「' + trim(t.text) + '」はもう すきま時間 にある'); return; }
  store.setGap(id, true);                 /* 追加であって移動ではない。today は残る */
  toast('「' + trim(t.text) + '」を すきま時間 にも入れた', {
    label: '元に戻す',
    on: () => store.setGap(id, false),
  });
}

function onDropToTab(id, tabId) {
  if (tabId === 'sea') { dropToSea(id); return; }
  if (tabId === 'gap') { dropToGap(id); return; }
  if (tabId === 'plan') {
    /* どのアンカーに付けるかは契約 §11 に無い。勝手にアンカーを選ばない。
       app.js の applyDrop が使う store.setPlan（＝きっかけの未分類）が実在すればそれに乗る。
       無ければ、行き先が分かることだけ伝える。どちらも命令形にはしない。
       ※ app.js を import すると循環参照になるので、ここでは store だけを見ている。 */
    const t = store.get(id);
    if (typeof store.setPlan === 'function') {
      store.setPlan(id, true);
      toast('「' + trim(t ? t.text : '') + '」を きっかけの未分類 へ入れた', {
        label: '元に戻す',
        on: () => store.setPlan(id, false),
      });
    } else {
      toast('きっかけは「きっかけ」の画面で選べる');
    }
    return;
  }
  /* 'today' はこの画面そのもの。何もしない */
}

/* 完了したものを、まだの状態へ戻す（Issue #29）。
   完了しても日付の水面に残るので、ここで戻せないと「完了を押し間違えた」
   「やり直すことになった」ときに、完了の海まで行かないと戻せなかった。
   前は盤の名前だけ「海にもどす」に入れ替わり、押すと complete() をもう一度呼んで
   （既に完了なので何も変わらず）音と「完了にした」が出ていた。
   日付・タグはそのまま残っているので、戻せば同じ水面に「まだ」として浮かぶ。
   音は鳴らさない（戻すのは達成ではない。海の画面と同じ） */
function uncompleteWithUndo(id) {
  if (typeof store.uncomplete !== 'function') return;
  const t = store.get(id);
  const name = trim(t ? t.text : '');
  if (store.uncomplete(id) === false) return;
  toast('「' + name + '」を未完了にもどした', {
    label: '取り消す',
    on: () => { if (typeof store.complete === 'function') store.complete(id); },
  });
}

function isDoneId(id) {
  return typeof store.isDone === 'function' ? !!store.isDone(id) : false;
}

/* 完了の釦。完了したものの上では「未完了にもどす」になる */
function toggleComplete(id) {
  if (isDoneId(id)) { uncompleteWithUndo(id); return; }
  completeWithUndo(id);
}

const REOPEN_LABEL = '未完了にもどす';

/* 中央の盤に出す操作。副作用を持たせない（返すだけ） */
function actionsFor(id) {
  return {
    isDone: isDoneId(id),
    reopenLabel: REOPEN_LABEL,
    onStarted: () => markStarted(id),
    onComplete: () => toggleComplete(id),
    onDelete: () => removeWithUndo(id),
  };
}

/* ---------------- 長押しメニュー ---------------- */

function closeMenu() {
  if (!menuHandle) return;
  const h = menuHandle;
  menuHandle = null;
  if (typeof h === 'function') h();
  else if (h && typeof h.close === 'function') h.close();
}

function onMenu(id, node) {
  if (!store.get(id)) return;
  closeMenu();
  menuHandle = openMenu(node, {
    isDone: isDoneId(id),
    reopenLabel: REOPEN_LABEL,
    onDetail: () => openDetail(id),
    onFocus: () => openFive(id),
    onStarted: () => markStarted(id),
    onComplete: () => toggleComplete(id),
    onDelete: () => removeWithUndo(id),
  });
}

/* ---------------- 詳細（最初の一手 / URL / 開始した） ---------------- */

/* ノードは1枚だけ作って使い回す。入力中の値を消さないため（契約 §14）。
   対象が変わるときは、書きかけを保存してから値を入れ替える。 */
function makeDetail() {
  const node = el('div', 'today-detail');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', '詳細');
  node.dataset.screen = 'today.detail'; node.dataset.screenLayer = '4';
  node.hidden = true;
  node.addEventListener('pointerdown', ev => ev.stopPropagation());

  const head = el('div', 'td-head');
  const title = el('p', 'td-title');
  head.appendChild(title);
  const close = el('button', 'td-close');
  close.type = 'button';
  close.textContent = '閉じる';
  close.addEventListener('click', () => closeDetail());
  head.appendChild(close);
  node.appendChild(head);

  /* --- 最初の一手 --- */
  const fs = el('label', 'td-field');
  fs.appendChild(el('span', 'td-lb', '最初の一手'));
  const fin = el('input', 'td-in');
  fin.type = 'text';
  fin.placeholder = 'まず何をする？';
  fin.autocomplete = 'off';
  fs.appendChild(fin);
  node.appendChild(fs);

  let ftimer = 0, pending = null;
  function saveFirst() {
    clearTimeout(ftimer); ftimer = 0;
    if (pending === null || !current()) return;
    const v = pending; pending = null;
    if (typeof store.setFirstStep === 'function') store.setFirstStep(current(), v);
  }
  fin.addEventListener('input', () => {
    pending = fin.value;
    clearTimeout(ftimer);
    ftimer = setTimeout(saveFirst, SAVE_MS);
  });
  fin.addEventListener('blur', saveFirst);
  fin.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    saveFirst();
  });

  /* --- URL --- */
  const ur = el('div', 'td-field');
  ur.appendChild(el('span', 'td-lb', 'URL'));
  const rw = el('div', 'td-row');
  const uin = el('input', 'td-in');
  uin.type = 'url';
  uin.placeholder = 'https://…';
  uin.autocomplete = 'off';
  rw.appendChild(uin);
  const open = el('a', 'td-open');
  open.textContent = '開く';
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.hidden = true;
  rw.appendChild(open);
  ur.appendChild(rw);
  const err = el('p', 'td-err');
  err.textContent = '開けないリンク';
  err.hidden = true;
  err.setAttribute('aria-live', 'polite');
  ur.appendChild(err);
  node.appendChild(ur);

  /* 「開く」は store が受け取った URL だけを出す。入力中の生の文字列は出さない */
  function syncLink() {
    const id = current();
    const u = id ? detailOf('urlOf', id) : '';
    const show = !!u && /^https?:\/\//i.test(u) && err.hidden;
    if (show) open.href = u; else open.removeAttribute('href');
    open.hidden = !show;
  }
  let utimer = 0;
  function saveUrl() {
    clearTimeout(utimer); utimer = 0;
    const id = current();
    if (!id || typeof store.setUrl !== 'function') return;
    const raw = uin.value.trim();
    if (!raw) { store.setUrl(id, ''); err.hidden = true; syncLink(); return; }
    const r = store.setUrl(id, raw);
    err.hidden = !!(r && r.ok);
    syncLink();
  }
  uin.addEventListener('input', () => {
    clearTimeout(utimer);
    utimer = setTimeout(saveUrl, SAVE_MS);
  });
  uin.addEventListener('blur', saveUrl);
  uin.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    saveUrl();
  });

  /* --- 開始した。5分を使わずに始めたときの別ルート。記録先は5分経過と同じ --- */
  const doneBtn = el('button', 'td-done');
  doneBtn.type = 'button';
  function syncDone() {
    const id = current();
    const on = !!id && isStarted(id);
    doneBtn.classList.toggle('on', on);
    doneBtn.textContent = on ? DONE_LB + ' ✓' : DONE_LB;
    doneBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  doneBtn.addEventListener('click', () => {
    const id = current();
    if (!id) return;
    if (isStarted(id)) { if (typeof store.unstart === 'function') store.unstart(id, null); }
    else if (typeof store.start === 'function') { store.start(id, null); playSfx('start'); }
    syncDone();
    render();
  });
  node.appendChild(doneBtn);

  function current() { return detail ? detail.id : null; }

  function fill() {
    const id = current();
    const t = id ? store.get(id) : null;
    title.textContent = t ? t.text : '';        /* 生の文字列は textContent で入れる */
    pending = null;
    clearTimeout(ftimer); ftimer = 0;
    clearTimeout(utimer); utimer = 0;
    fin.value = id ? detailOf('firstStepOf', id) : '';
    uin.value = id ? detailOf('urlOf', id) : '';
    err.hidden = true;
    syncDone();
    syncLink();
  }

  function flush() { saveFirst(); if (utimer) saveUrl(); }

  function sync() {
    const id = current();
    const t = id ? store.get(id) : null;
    if (t) title.textContent = t.text;
    syncDone();
    syncLink();
  }

  return { node, fill, flush, sync, id: null };
}

function openDetail(id) {
  if (!store.get(id)) return;
  if (!detail) { detail = makeDetail(); pane.appendChild(detail.node); }
  else detail.flush();                    /* 別の項目に切り替える前に書きかけを保存 */
  detail.id = id;
  detail.fill();
  detail.node.hidden = false;
}

function closeDetail() {
  if (!detail) return;
  detail.flush();
  detail.id = null;
  detail.node.hidden = true;
}

/* ---------------- ジェスチャの配線（契約 §12） ---------------- */

/* ---------------- バブルを左右の端へ運ぶと、日が変わる（利用者の指示） ----------------

   > 今日の海でバブルを左右にしたら、日付をその日に変更する機能

   掴んでいる間だけ、左右に帯を出す。そこで離すと、**いま映している日から外して
   隣の日に置き直す**（足すのではなく、動かす＝「変更」）。

   向きは画面に出ている ‹ › とそろえた。**左＝前の日／右＝次の日**。
   背景を右へなぞると前の日へ行く（紙をめくる向き）のと矛盾しないのは、
   なぞりは「面を動かす」、こちらは「バブルを置く」で、動かす対象が違うため
   ——‹ › が同じところに出ているので、目で見える手がかりのほうに合わせた。

   2026-11-24 Issue #97「日付の海でバブルをつまんで横に置けば翌日（左は前日）に移動し、ホールドで翌日にもコピー
   （明日も頑張る）。昨日以前のデータも対称的な挙動にして」:
     ・前は、過去を映しているときと、行き先が今日より前になるときは帯を出さなかった。どの日でも左右とも出す（対称）
     ・帯の上で止めて EDGE_COPY_MS 待つと「＋コピー」に変わり、離すと**今の日に残したまま**隣の日にも置く。
       待たずに離せば今までどおり移す。帯から指を外すと「移す」に戻る

   海の端の帯（.sea-edge）と同じ作り方にしてある：帯は指を透かし、
   判定は指先の座標でやる（バブルの外形は広すぎる。契約 §14）。 */
let dayEdges = null;        /* { left: {el, md, dw, mo}, right: {...} } */
let bubDrag = null;
let bubPt = { x: -1, y: -1 };
let overEdge = null;
let tabDropped = false;
const EDGE_COPY_MS = 700;   /* 帯の上でこれだけ止めると「コピー」になる */
const EDGE_SLOP = 28;      /* 乗っている帯から出たとみなすまでの、内側へのゆとり（px） */
let edgeCopy = false;
let edgeHoldTimer = 0;

/* その向きの行き先。どの日からでも、左＝前の日・右＝次の日（Issue #97 で過去も対称にした）。
   2026-11-25 の 10:20 に、今日を映しているときだけ左の帯を「海へ戻す」にしたが（Issue #96 の 10 回目の返事）、
   同じ日の利用者の指示「今日から左にいくときに、海に戻すのではなく、昨日に記録をつける動作にして（他と同じ）」で、
   今日も前の日へ送る（ほかの日と同じ。止めて待てば「＋コピー」）に戻した。海へ戻すのは下タブの「海」へ落とす */
function edgeDayFor(dir) {
  return shiftDay(curDay(), dir === 'left' ? -1 : 1) || null;
}

function renderDayEdges() {
  if (!dayEdges) return;
  const on = !!bubDrag;
  ['left', 'right'].forEach(dir => {
    const e = dayEdges[dir];
    const k = on ? edgeDayFor(dir) : null;
    e.el.hidden = !k;
    e.el.classList.toggle('is-over', overEdge === dir);
    const copy = overEdge === dir && edgeCopy;
    e.el.classList.toggle('is-copy', copy);
    if (!k) return;
    e.mo.textContent = copy ? '＋コピー' : '送る';
    const d = dayToDate(k);
    /* 帯は細いので、日と曜日を2行に分ける（横書きのまま読める）。
       縦書きにすると、掴んでいるバブルが真ん中を隠したときに読めなくなる */
    e.md.textContent = (d.getMonth() + 1) + '/' + d.getDate();
    e.dw.textContent = DOW[d.getDay()];
  });
}

function dayEdgeAt(x, y) {
  if (!dayEdges || !bubDrag) return null;
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) return null;
  for (const dir of ['left', 'right']) {
    const e = dayEdges[dir];
    if (e.el.hidden) continue;
    const r = e.el.getBoundingClientRect();
    if (!r.width) continue;
    if (y < r.top || y > r.bottom) continue;
    /* いま乗っている帯は、内側へ EDGE_SLOP だけ広く見る（いちど乗ったら、指の震えで外れない）。
       2026-11-25 利用者の指示「今日の海でホールドがすぐ解除される」: 帯の内側の縁あたりで止めた指が
       数 px 揺れて出入りすると、そのたびに markDayEdge が「＋コピー」を取り消して待ち直していた。
       外側（画面の端の向き）は、帯より外でも同じ帯とみなす（海の .sea-edge の半平面と同じ） */
    const slop = (overEdge === dir) ? EDGE_SLOP : 0;
    if (dir === 'left' && x <= r.right + slop) return dir;
    if (dir === 'right' && x >= r.left - slop) return dir;
  }
  return null;
}

function markDayEdge(dir) {
  if (overEdge === dir) return;
  overEdge = dir;
  edgeCopy = false;
  if (edgeHoldTimer) { clearTimeout(edgeHoldTimer); edgeHoldTimer = 0; }
  if (dir) {
    edgeHoldTimer = setTimeout(() => {
      edgeHoldTimer = 0;
      if (!bubDrag || overEdge !== dir) return;
      edgeCopy = true;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* 震えなくてよい */ }
      renderDayEdges();
    }, EDGE_COPY_MS);
  }
  renderDayEdges();
}

function onBubPointer(ev) {
  bubPt = { x: ev.clientX, y: ev.clientY };
  markDayEdge(dayEdgeAt(bubPt.x, bubPt.y));
  markPlateDrop(plateHitAt(bubPt.x, bubPt.y));
  nearCorners(bubPt.x, bubPt.y);
}

/* ---- 今日大事なこと・先に済ませるへ落とす（2026-11-24。Issue #96 で枠 → 角 → 滝 → 灯台と浮き → 魚 → 小さい画面は角のエリア・大きい画面は枠）----
   目印（data-drop="key"|"first"）の上で泡を離すと、そこへ入れる。入れた泡を同じ目印で離すと外し、もう片方の目印なら移す。
   掴んでいる間は、指の下の目印を濃くする（is-drop） */
/* 落とし先の入れ物：大きい画面の枠（wideBox）と、小さい画面の左下・右下のエリア（plate）。見えていないほうは幅 0 なので当たらない */
function dropNodes() {
  const out = [];
  [wideBox, plate, fishBox].forEach(c => { if (c && !c.hidden) c.querySelectorAll('[data-drop]:not([hidden])').forEach(n => out.push(n)); });
  return out;
}
function plateHitAt(x, y) {
  if (!(x >= 0)) return null;
  for (const n of dropNodes()) {
    const r = n.getBoundingClientRect();
    if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { kind: n.dataset.drop, node: n };
  }
  return null;
}
function markPlateDrop(hit) {
  dropNodes().forEach(n => { if (n.classList.contains('is-drop') && (!hit || n !== hit.node)) n.classList.remove('is-drop'); });
  if (hit) hit.node.classList.add('is-drop');
}
function dropToPlate(id, kind) {
  const day = curDay();
  const pin = pinsOf(plateState()).get(id) || null;
  if (pin === kind) { takeOutSeat(id, kind, day); return; }
  if (pin) { moveSeat(id, pin, kind, day); return; }
  if (kind === 'key') placeKey(id, day);
  else if (kind === 'first') placeFirst(id, true, day);
}

function beginBubDrag(id) {
  closeMenu();
  bubDrag = { id };
  tabDropped = false;
  bubPt = { x: -1, y: -1 };
  overEdge = null;
  window.addEventListener('pointermove', onBubPointer, true);
  window.addEventListener('pointerup', onBubPointer, true);
  if (stage) stage.classList.add('is-bubdrag');
  renderDayEdges();
  renderCorners(lastPlate);
}

function endBubDrag() {
  const d = bubDrag;
  const pt = bubPt;
  const hit = (d && !tabDropped) ? plateHitAt(pt.x, pt.y) : null;
  markPlateDrop(null);
  const dir = (d && !tabDropped && !hit) ? dayEdgeAt(pt.x, pt.y) : null;
  const to = dir ? edgeDayFor(dir) : null;
  const copy = !!(dir && edgeCopy && overEdge === dir);
  bubDrag = null;
  overEdge = null;
  edgeCopy = false;
  if (edgeHoldTimer) { clearTimeout(edgeHoldTimer); edgeHoldTimer = 0; }
  window.removeEventListener('pointermove', onBubPointer, true);
  window.removeEventListener('pointerup', onBubPointer, true);
  if (stage) stage.classList.remove('is-bubdrag');
  renderDayEdges();
  renderCorners(lastPlate);
  /* 角へ落とした（今日大事なこと・先に済ませる）。下タブへの落としと競るので、マイクロタスク 1 つぶん待つ */
  if (d && hit) {
    Promise.resolve().then(() => { if (!tabDropped) dropToPlate(d.id, hit.kind); });
    return;
  }
  /* 四つに分けている間は、区分へ落としたかを先に見る（日の帯より内側にある） */
  const qk = (d && quadOn && quad) ? quad.hitAt(pt.x, pt.y) : undefined;
  if (d && qk !== undefined && !to) {
    Promise.resolve().then(() => { if (!tabDropped && !dropToQuad(d.id, qk)) render(); });
    return;
  }
  if (!d || !to) return;
  /* onDropToTab と onDragEnd のどちらが先に来るかは決まっていないので、
     マイクロタスク1つぶん待ってから見る（海・きっかけと同じ間合い） */
  Promise.resolve().then(() => {
    if (tabDropped) return;
    moveDay(d.id, curDay(), to, copy);
  });
}

/* いま映している日から外して、行き先の日に置く。copy なら今の日に残したまま行き先にも置く（Issue #97）。取り消せる */
function moveDay(id, from, to, copy) {
  const t = store.get(id);
  if (!t || typeof store.setDay !== 'function') return;
  const had = (typeof store.daysOf === 'function' ? store.daysOf(id) : []) || [];
  const added = store.setDay(id, to, true);
  const removed = (!copy && from && from !== to) ? store.setDay(id, from, false) : false;
  const d = dayToDate(to);
  const md = (d.getMonth() + 1) + '/' + d.getDate();
  if (!added && !removed) {
    if (copy) toast('「' + trim(t.text) + '」は ' + md + ' にもう置いてある');
    return;
  }
  toast('「' + trim(t.text) + '」を ' + md + (copy ? ' にも' : ' へ'), {
    label: '元に戻す',
    on: () => {
      /* 掴む前の日をそのまま書き戻す。足し引きを逆にたどるより確か */
      const now = (typeof store.daysOf === 'function' ? store.daysOf(id) : []) || [];
      now.forEach(k => { if (had.indexOf(k) < 0) store.setDay(id, k, false); });
      had.forEach(k => { if (now.indexOf(k) < 0) store.setDay(id, k, true); });
    },
  });
}

/* ---------------- おすすめ（2026-11-07。利用者の指示 Issue #12） ----------------

   押すと板が開き、映している日に置くとよさそうな泡を 3〜5 件、短い理由つきで出す。
   **自動では今日へ移さない。**行の [置く] を押したものだけを置き、トーストで取り消せる（⌘Z でも）。
   はじめは端末の中の規則だけ（送らない）。[AI で選び直す] を押したときだけ、端末で絞った候補
   （30 件まで）の名前と印を Anthropic へ送る。本文・作業メモ・ひとこと・リンクは送らない。
   計算は js/suggest.js。過去の日には置けないので押せない。 */

let suggestBtn = null;
let suggest = null;      /* { box, list, note, aiBtn, picks, busy, seq, day } */

function suggestPool(day) {
  const all = (typeof store.all === 'function') ? store.all() : [];
  return all.filter(t => eligible(t, day)).map(t => describe(t, {
    tags: tagNames(t.id),
    firstStep: typeof store.firstStepOf === 'function' && !!store.firstStepOf(t.id),
  }));
}

function syncSuggest() {
  if (!suggestBtn) return;
  suggestBtn.disabled = false;   /* 過ぎた日も選べる（2026-11-25「基本動作は同じにして」） */
  const word = isToday() ? '今日' : dayLabel(curDay());
  suggestBtn.title = word + 'に置くとよさそうなものを出す';
  suggestBtn.setAttribute('aria-label', suggestBtn.title);
  suggestBtn.setAttribute('aria-expanded', suggest ? 'true' : 'false');
  if (suggest) renderSuggest();
}

function toggleSuggest() {
  if (suggest) { closeSuggest(); return; }
  if (!stage) return;
  closeMenu();
  const day = curDay();
  const box = el('div', 'today-suggestbox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'おすすめ');
  box.dataset.screen = 'today.suggest'; box.dataset.screenLayer = '3';
  const head = el('div', 'tsg-head');
  const ttl = el('span', 'tsg-ttl');
  head.appendChild(ttl);
  const x = el('button', 'tsg-close', '×');
  x.type = 'button';
  x.setAttribute('aria-label', '閉じる');
  x.addEventListener('click', ev => { ev.preventDefault(); closeSuggest(); });
  head.appendChild(x);
  box.appendChild(head);
  const list = el('ul', 'tsg-list');
  box.appendChild(list);
  const aiBtn = el('button', 'tsg-ai', 'AI で選び直す');
  aiBtn.type = 'button';
  aiBtn.addEventListener('click', ev => { ev.preventDefault(); askSuggest(); });
  box.appendChild(aiBtn);
  /* サーバーあり版では AI で選び直すを出さない（2026-11-17 Issue #78。手元の計算のおすすめは残す） */
  if (!aiOn()) aiBtn.hidden = true;
  const note = el('p', 'tsg-note');
  box.appendChild(note);
  stage.appendChild(box);
  suggest = { box, list, note, aiBtn, ttl, picks: localPicks(suggestPool(day), Date.now()), busy: false, seq: 0, day, msg: '', ai: false };
  syncSuggest();
}

/* おすすめの板を開く（今日大事なことの［選ぶ］・先に済ませるの［＋］から。開いていればそのまま） */
function openSuggest() {
  if (!suggest) toggleSuggest();
}

function closeSuggest() {
  if (!suggest) return;
  suggest.seq++;               /* 待っている返事は捨てる */
  suggest.box.remove();
  suggest = null;
  if (suggestBtn) suggestBtn.setAttribute('aria-expanded', 'false');
}

function renderSuggest() {
  const s = suggest;
  if (!s) return;
  const word = isToday() ? '今日' : dayLabel(curDay());
  s.ttl.textContent = word + 'のおすすめ' + (s.ai ? '（AI）' : '');
  s.list.textContent = '';
  const live = s.picks.filter(c => { const t = store.get(c.id); return t && eligible(t, s.day); });
  if (!live.length) {
    s.list.appendChild(el('li', 'tsg-empty', '海に、ここへ置けるものが見当たらない'));
  }
  const noKey = typeof store.keyItem === 'function' && !store.keyItem(s.day);
  const top = noKey ? live.find(c => keyable(c)) : null;
  const keyPick = top ? top.id : null;
  /* 先の日のおすすめにも［↑ 先に］を出す（Issue #98）。s.day は過ぎた日にはならない（おすすめは過ぎた日には開かない） */
  const firstOk = s.day >= todayKey() && s.day === curDay() && plateState().st.canAdd;
  live.forEach(c => {
    const li = el('li', 'tsg-row');
    const tx = el('span', 'tsg-tx');
    const nm = el('span', 'tsg-nm');
    nm.textContent = c.text;
    tx.appendChild(nm);
    if (c.reason) { const rs = el('span', 'tsg-why'); rs.textContent = c.reason; tx.appendChild(rs); }
    li.appendChild(tx);
    /* 2026-11-24（モック mock/choose-1124.html の 3）: 今日大事なことがまだなら、さっとでない一番上の候補に［★ 大事なことに］。
       外の約束のさっとの泡には［↑ 先に］（今日を映していて、先に済ませるに入れられるときだけ）。ほかは［置く］ */
    let put;
    if (c.id === keyPick) {
      put = el('button', 'tsg-put is-key', '★ 大事なことに');
      put.setAttribute('aria-label', '「' + trim(c.text) + '」を' + word + 'に置いて、大事なことにする');
      put.addEventListener('click', ev => { ev.preventDefault(); placeSuggestKey(c.id); });
    } else if (firstOk && firstable(c)) {
      put = el('button', 'tsg-put is-first', '↑ 先に');
      put.setAttribute('aria-label', '「' + trim(c.text) + '」を' + word + 'の先に済ませるに入れる');
      put.addEventListener('click', ev => { ev.preventDefault(); placeSuggestFirst(c.id); });
    } else {
      put = el('button', 'tsg-put', '置く');
      put.setAttribute('aria-label', '「' + trim(c.text) + '」を' + word + 'に置く');
      put.addEventListener('click', ev => { ev.preventDefault(); placeSuggest(c.id); });
    }
    put.type = 'button';
    li.appendChild(put);
    s.list.appendChild(li);
  });
  s.aiBtn.disabled = s.busy;
  s.aiBtn.textContent = s.busy ? 'AI が選んでいる…' : 'AI で選び直す';
  s.note.textContent = s.msg || (!aiOn() ? '' : hasKey()
    ? '押すと、候補の泡の名前と印（30 件まで）を設定で選んだ AI の会社へ送る。本文・作業メモは送らない'
    : '設定の「AI を使う設定をする」に API キーを入れると、名前の意味や季節も考えに入れて選べる');
}

function placeSuggest(id) {
  const s = suggest;
  const t = store.get(id);
  if (!s || !t || typeof store.setDay !== 'function') return;
  const day = s.day;
  if (!store.setDay(id, day, true)) return;
  playSfx('place');
  const d = dayToDate(day);
  const where = day === todayKey() ? '今日' : (d.getMonth() + 1) + '/' + d.getDate();
  toast('「' + trim(t.text) + '」を ' + where + ' に置いた', {
    label: '取り消す',
    on: () => { store.setDay(id, day, false); },
  });
}

/* ［★ 大事なことに］: その日に置いて、その日の大事なことにする（store.setKey が置くのも一緒にする）。取り消せる */
function placeSuggestKey(id) {
  if (suggest) placeKey(id, suggest.day);
}
/* その日の大事なことにする（おすすめの［★］と、枠へ落としたとき）。取り消せる */
function placeKey(id, day) {
  const t = store.get(id);
  if (!t || !day || typeof store.setKey !== 'function') return;
  const prev = store.keyItem(day);
  if (prev && prev.id === id) return;
  const had = store.daysOf ? (store.daysOf(id) || []).indexOf(day) >= 0 : false;
  if (!store.setKey(id, day, true)) return;
  playSfx('place');
  toast('「' + trim(t.text) + '」を' + (day === todayKey() ? '今日' : '') + '大事なことにした', {
    label: '取り消す',
    on: () => {
      store.setKey(id, day, false);
      if (!had) store.setDay(id, day, false);
      if (prev && store.get(prev.id)) store.setKey(prev.id, day, true);
    },
  });
}

/* ［↑ 先に］: その日の先に済ませるに入れる（その日に置くのも一緒）。取り消せる */
function placeSuggestFirst(id) { if (suggest) placeFirst(id, false, suggest.day); }
/* 先に済ませるに入れる。dropped は枠へ落としたとき：見当がまだの泡は、落とした＝さっとと決めたとみなして
   さっとにしてから入れる（取り消すと見当も戻す）。半日まで・何回もの泡は入れない（さっとの泡だけの席）。
   day は入れる日（Issue #98。今日か先の日。過ぎた日には入れない）。区切りの時間を数え始めるのは今日に入れたときだけ */
function placeFirst(id, dropped, day) {
  const t = store.get(id);
  if (!day) day = todayKey();
  if (!t || typeof store.setFirst !== 'function') return;
  if (day === todayKey() && plateState().st.passed) { toast('先に済ませるは、今日はもう畳んだ'); return; }
  const had = store.daysOf ? (store.daysOf(id) || []).indexOf(day) >= 0 : false;
  let sized = false;
  if (dropped && !t.size && typeof store.setSize === 'function') sized = store.setSize(id, 's');
  const r = store.setFirst(id, day, true);
  if (r !== 'ok') {
    if (sized) store.setSize(id, null);
    if (r === 'same') return;
    toast(r === 'full' ? '先に済ませるの席は 3 つまで' : r === 'size' ? '先に済ませるは、さっとの泡だけ' : '先に済ませるに入れられなかった');
    render();
    return;
  }
  if (day === todayKey()) markFirstStarted(day, Date.now());   /* 先の日は、その日に初めて開いたときから数える（plateState） */
  playSfx('place');
  const where = day === todayKey() ? '' : (dayToDate(day).getMonth() + 1) + '/' + dayToDate(day).getDate() + ' の';
  toast('「' + trim(t.text) + '」を' + where + '先に済ませるに入れた' + (sized ? '（さっとにした）' : ''), {
    label: '取り消す',
    on: () => {
      store.setFirst(id, day, false);
      if (!had) store.setDay(id, day, false);
      if (sized) store.setSize(id, null);
    },
  });
}

async function askSuggest() {
  const s = suggest;
  if (!s || s.busy) return;
  if (!hasKey()) {
    s.msg = 'API キーが入っていない。設定の「AI を使う設定をする」に入れると使える（いまは送っていない）';
    renderSuggest();
    return;
  }
  const cands = sendList(suggestPool(s.day), Date.now());
  if (!cands.length) { s.msg = '送る候補が無い（送っていない）'; renderSuggest(); return; }
  const p = buildSuggestPrompt(cands, s.day);
  const my = ++s.seq;
  s.busy = true; s.msg = '';
  renderSuggest();
  try {
    const r = await askFull(p.system, p.user, { maxTokens: 2000 });
    if (suggest !== s || s.seq !== my) return;
    const picks = parseSuggest(r.text, cands);
    if (!picks || !picks.length) {
      s.msg = r.stop === 'max_tokens' ? '返事が途中で切れた。もう一度押すと選び直す' : '返事を一覧にできなかった。もう一度押すと選び直す';
    } else { s.picks = picks; s.ai = true; }
  } catch (e) {
    if (suggest !== s || s.seq !== my) return;
    s.msg = '届かなかった: ' + String((e && e.message) || e).slice(0, 120);
  }
  s.busy = false;
  renderSuggest();
}

/* ---------------- 週・月で見るからその日へ（2026-11-22 Issue #80 の返事） ----------------
   前の版（2026-11-21）はこの画面に「週・月」の板を置いていた。下のタブの画面を経て、2026-11-23 からは海のリスト表示の形
   （js/periodview.js）。そこで日の見出しを押すと、この画面へ移ってから bubbles:showday { key } が届く（画面どうしは import しない）。
   id 付きの呼び方は、リスト表示に移ってからは使っていない（名前は海の側で詳細を開く）が、口は残す */
/* 海の面から、泡を今日大事なこと・先に済ませるへ落としたとき（2026-11-24 利用者の指示
   「先にするや重要に入れられるように、ドラッグで外に出せる様にして」）。入れ方・断り方・取り消しは今日の画面の枠と同じ。
   日はいつも今日（海には日を選ぶ札が無い） */
window.addEventListener('bubbles:place', ev => {
  const d = (ev && ev.detail) || {};
  if (!d.id) return;
  if (d.kind === 'key') placeKey(d.id, todayKey());
  else if (d.kind === 'first') placeFirst(d.id, true);
});

window.addEventListener('bubbles:showday', ev => {
  const d = (ev && ev.detail) || {};
  const key = d.key;
  if (typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)) goDay(key);
  /* 名前を押したときは、その泡の詳細をそのまま開く（2026-11-23 Issue #80 の返事「今週からTODOを選択した場合に遷移先にTODOが、
     表示されない場合がある」）。週・月の画面には、その日に置いたものだけでなく、期間の始まる日・終わる日・完了した日の泡も並ぶ。
     それらはその日の水面には浮かばず（置いた日ではないため）、フィルターで隠れていることもあるので、
     水面で探さずに、その場かぎりの泡から詳細を開く（一覧の行から開くのと同じ openBoardFor） */
  if (typeof d.id === 'string' && store.get(d.id)) {
    setTimeout(() => { if (stage && stage.clientWidth) openBoardFor(d.id, stage); }, 60);
  }
});

/* ---------------- 一覧で見る（2026-11-21 Issue #86） ----------------

   > 今日のTODOが多い時、泡のUIだと見にくい
   > 今日のTODOの分だけ一覧表示で完了と未完了をわけて確認できるいいUIを検討して実装して

   2段目の右の丸い ⇅（Issue #92。前は左の札「一覧」）で、映している日の泡（dayItems と同じ顔ぶれ）を行に並べ替えて見る。
   もう一度押す（札は「泡」になる）と漂う面に戻る。四つに分けるのと同じく、見ている間は field を降ろす。
   ・上に「まだ」、下に「済んだ」。それぞれの中は水面と同じ順（並べ替えない）
   ・行の頭の丸で完了にする／未完了にもどす（泡の［完了］と同じ。音とトーストの取り消しも同じ）
   ・名前を押すと、泡を押したときと同じ詳細が開く（海の一覧と同じ作り。openBoardFor）
   ・「今日は終わり」にしたものは、名前の右に小さくそう出す（まだのほうに残す。日が変わると戻る印なので）
   ・件数・割合は出さない（契約 §0。週・月の板と同じ）
   ・一覧で見ているかどうかは、この端末に覚える（多い日が続く人が、開くたびに押し直さないように） */

const LIST_KEY = 'bubble_todo_today_list_v1';
let listOn = false;
let listBox = null;
let listBtn = null;
let swimBand = null;      /* 泳ぐ生き物の帯（.today-swim。クラゲ＝フィルター、カメ＝一覧。Issue #96 の 7 回目の返事） */
let listIc = null;        /* 丸い ⇅ ⇄ ✕ の記号（Issue #92） */
let rowBoard = null;      /* { node, off } 行から開いた詳細の、その場かぎりの泡。2枚目は開かない */

function loadListOn() {
  try { return localStorage.getItem(LIST_KEY) === '1'; } catch (e) { return false; }
}
function saveListOn(on) {
  try { if (on) localStorage.setItem(LIST_KEY, '1'); else localStorage.removeItem(LIST_KEY); }
  catch (e) { /* 覚えられないだけ */ }
}

function syncListBtn() {
  if (!listBtn) return;
  /* 泡が多くて縮めても入りきらないときは、縁を太く泡の色にして目立たせる（Issue #87）。
     赤や点滅は使わない。件数も言わない（契約 §0） */
  const crowd = !listOn && crowded;
  /* 海のリスト表示と同じ丸い記号（Issue #92）。泡の眺めでは ⇅、一覧の間は ✕。
     字はいつも出さない（Issue #92 の返事「海と同じ記号で日本語の説明表示なくせる？」。前は入りきらないときだけ
     「⇅ 一覧で見る」に伸びていた）。名前は aria-label と title が渡す */
  if (listIc) listIc.textContent = listOn ? '✕' : '⇅';
  listBtn.classList.toggle('is-crowded', crowd);
  listBtn.classList.toggle('is-on', listOn);
  listBtn.setAttribute('aria-pressed', listOn ? 'true' : 'false');
  listBtn.title = listOn ? '泡の眺めにもどす'
    : crowd ? '泡が多くて重なっている。一覧のほうが読みやすい（まだ・済んだに分けて並べる）'
    : '一覧で見る（まだ・済んだに分けて並べる）';
  listBtn.setAttribute('aria-label', listOn ? '泡の眺めにもどす'
    : crowd ? '泡が多くて重なっている。一覧で見る' : '一覧で見る');
}

function setList(on) {
  if (!listBox || listOn === on) return;
  if (on && quadOn) setQuad(false);
  listOn = on;
  saveListOn(on);
  closeMenu();
  listBox.hidden = !on;
  if (stage) stage.classList.toggle('is-list', on);
  syncListBtn();
  if (on) {
    if (field) { field.stop(); field.setItems([]); }
    render();
    return;
  }
  listBox.textContent = '';
  render();
  if (field && shown) { field.relayout(); field.start(); }
}

function renderList(items) {
  const box = listBox;
  if (!box) return;
  const keep = box.scrollTop;            /* 完了にしたたびに先頭へ飛ばない */
  box.textContent = '';
  if (!items.length) return;             /* 何も無いときのことば（emptyNote）に任せる */
  /* まだのものは、今日大事なこと → 先に済ませる → ほか の順（Issue #96 の 4 回目の返事。印の付いた行を上に） */
  const rank = it => it.pin === 'key' ? 0 : it.pin === 'first' ? 1 : 2;
  const todo = items.filter(it => !it.done).map((it, i) => [it, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(p => p[0]);
  const done = items.filter(it => it.done);
  box.appendChild(listSection('まだ', todo, 'まだのものは無い'));
  if (done.length) box.appendChild(listSection('済んだ', done, ''));
  box.scrollTop = keep;
}

function listSection(title, rows, emptyText) {
  const sec = el('section', 'tl-sec');
  const h = el('h3', 'tl-head', title);
  sec.appendChild(h);
  if (!rows.length) {
    sec.appendChild(el('p', 'tl-empty', emptyText));
    return sec;
  }
  const ul = el('ul', 'tl-rows');
  rows.forEach(it => ul.appendChild(listRow(it)));
  sec.appendChild(ul);
  return sec;
}

function listRow(it) {
  const li = el('li', 'tl-row');
  if (it.done) li.classList.add('is-done');
  if (it.started) li.classList.add('is-started');
  /* 今日大事なこと・先に済ませるの行は、泡と同じ色（左の帯）と字「★ 大事」「↑ 先に」（Issue #96 の 4 回目の返事） */
  if (it.pin === 'key' || it.pin === 'first') li.classList.add('is-pin-' + it.pin);

  const ck = el('button', 'tl-check', it.done ? '✓' : '');
  ck.type = 'button';
  ck.setAttribute('aria-pressed', it.done ? 'true' : 'false');
  ck.setAttribute('aria-label', '「' + trim(it.text) + '」を' + (it.done ? REOPEN_LABEL : '完了にする'));
  ck.addEventListener('click', ev => { ev.preventDefault(); toggleComplete(it.id); });
  li.appendChild(ck);

  const b = el('button', 'tl-item');
  b.type = 'button';
  /* タグの色の点（海の一覧と同じ。最大3つ。色だけに頼らず、名前は読み上げに入れる） */
  const dots = el('span', 'tl-dots');
  dots.setAttribute('aria-hidden', 'true');
  const cols = (it.colors || []).slice(0, 3);
  if (!cols.length) dots.appendChild(el('span', 'dot is-none'));
  cols.forEach(c => {
    const d = el('span', 'dot');
    d.style.setProperty('--tcd', c);
    dots.appendChild(d);
  });
  b.appendChild(dots);
  const pinName = it.pin === 'key' ? '今日大事なこと' : it.pin === 'first' ? '先に済ませる' : '';
  if (pinName) {
    const pb = el('span', 'tl-pin');
    pb.setAttribute('aria-hidden', 'true');
    pb.textContent = it.pin === 'key' ? '★ 大事' : '↑ 先に';
    b.appendChild(pb);
  }
  const nm = el('span', 'tl-nm');
  nm.textContent = it.text;              /* ユーザーの文字。innerHTML には入れない */
  b.appendChild(nm);
  if (it.started && !it.done) b.appendChild(el('span', 'tl-st', DONE_LB));
  const names = it.tagNames || [];
  b.setAttribute('aria-label', it.text + (names.length ? '（' + names.join('、') + '）' : '')
    + (pinName ? '。' + pinName : '')
    + (it.started && !it.done ? '。' + DONE_LB : '') + '。詳細を開く');
  b.addEventListener('click', ev => { ev.preventDefault(); openBoardFor(it.id, b); });
  /* 前からの5項目のメニューは、右クリック・メニューキーに残す（海の一覧と同じ） */
  b.addEventListener('contextmenu', ev => { ev.preventDefault(); onMenu(it.id, b); });
  li.appendChild(b);
  return li;
}

/* 行から、泡を押したときと同じ詳細を開く。
   詳細は bubble.js の attachGestures が泡のノードに付けて開くものなので、
   行の上にその場かぎりの泡を1つ作って中央へ寄せ、詳細を閉じたら捨てる（海の一覧と同じ作り） */
function openBoardFor(id, row) {
  const t = store.get(id);
  if (!t || !row || rowBoard) return;
  const r = row.getBoundingClientRect();
  const dw = stage ? stage.clientWidth : 0, dh = stage ? stage.clientHeight : 0;
  const d = Math.max(44, Math.round(diameterFor(t.text, dw, dh)));
  const it = itemFor(t);
  const node = makeBubble(it, { size: d, colors: it.colors, tagNames: it.tagNames });
  node.style.left = Math.round(r.left + Math.min(r.width, 120) / 2 - d / 2) + 'px';
  node.style.top = Math.round(r.top + r.height / 2 - d / 2) + 'px';
  (document.getElementById('drag-layer') || document.body).appendChild(node);

  const rec = { node, off: null };
  rowBoard = rec;
  const drop = () => {
    if (rowBoard !== rec) return;
    rowBoard = null;
    /* 閉じる処理の途中で呼ばれるので、抜けてから片づける */
    setTimeout(() => {
      if (typeof rec.off === 'function') rec.off();
      node.remove();
    }, 0);
  };
  const h = Object.assign({}, handlers, { onHold: (hid, on) => { if (!on) drop(); } });
  rec.off = attachGestures(node, h);
  if (!centerBubble(node)) {
    /* 寄せられなかった（寸法が取れない等）。前からの入口で開く */
    drop();
    onMenu(id, row);
  }
}

const handlers = {
  /* 盤を開いた・閉じた（drift が知らせる）。大きい画面で、閉じた泡が枠に移るものなら描き直す */
  onHold: (id, on) => {
    if (on) { heldId = id; return; }
    if (heldId === id) heldId = null;
    if (wideOn && plateIds(lastPlate).has(id)) setTimeout(() => { if (!heldId) render(); }, 0);
  },
  onFocusRequest: id => openFive(id),
  onMenu: (id, node) => onMenu(id, node),
  /* 中央の盤に出す操作。これを渡すと bubble.js は onMenu を横取りしない */
  onActions: (id) => actionsFor(id),
  onDropToTab: (id, tabId) => { tabDropped = true; onDropToTab(id, tabId); },
  onDragStart: (id) => beginBubDrag(id),
  onDragEnd: () => endBubDrag(),
  getHost: () => stage,
};

/* ---------------- 日付と ‹ › の置き場（2026-11-24 Issue #97） ----------------
   「アンドロイドから今日の海のうえのボタン類が………で読めない。レイアウト見直して」。
   1段目の並び（.today-top）は ≡・利用者のアイコンと歯車・「!」の間にしか無く、幅 411 の Android では
   約 180px。そこへフィルター（4割まで）と ‹ 日付 › （‹ › だけで 92px）を入れていたので、
   フィルターの名前も日付も「…」に縮んでいた（前の狭い画面の詰め方は幅 400 以下だけ）。
   1段目に DAYROW_NEED より狭いときは、日付と ‹ › を 2段目の並び（.today-tools）の左へ下ろし、
   1段目はフィルターだけにする（.today-top.is-solo）。広い画面は今までどおり 1段目の右（Issue #92 の返事）。
   1段目の幅は左右の端で決まり、中身では変わらないので、行き来して揺れない。
   2026-11-25（Issue #96 の 7 回目の返事「今日タブのタグの選択ボタンがあくから、日付選択ボタンが一段下なってるから上に上げて」）：
   タグのフィルターは 1段目から外れて泳ぐ生き物になった（applySwimLayout）ので、日付と ‹ › はいつも 1段目に置く。
   2026-11-25（8 回目の返事「日付け切り替えは中央に置いて、前の日次の日ボタン(前の表示)を出しても他のUIに被らないと思う」）：
   小さい画面では日付と ‹ › を 1段目の真ん中に置き、‹ › はいつも出す（.today-top.is-center。前の 230px 未満で畳む決まりはやめた）。
   大きい画面では前の形（左にタグのフィルター、右に日付と ‹ ›。applySwimLayout）。
   2026-11-25（9 回目の返事「フィルターなどをくらげにする機能はスキンとして実装して（configから設定）」）：
   クラゲ・カメはスキン（設定の「スキン」＝海の生き物）を選んだときだけ。ふつうのボタンのスキン（既定）と大きい画面では、
   フィルターが 1段目の左に戻るので、Issue #97 の決まり（1段目が DAYROW_NEED より狭ければ日付と ‹ › を 2段目の左へ下ろす）も戻す */
const DAYROW_NEED = 330;    /* フィルター（約 95）＋間 8＋‹ ›（88＋間 4）＋「一昨日 12/31（水）」の日付（約 130） */
let topRowEl = null, toolsEl = null, dayRowEl = null;
function placeDayRow() {
  if (!topRowEl || !toolsEl || !dayRowEl) return;
  const filterTop = !!filterBtn && filterBtn.parentNode === topRowEl;
  let low = false;
  if (filterTop) {
    const w = topRowEl.clientWidth;
    low = w ? w < DAYROW_NEED : dayRowEl.parentNode === toolsEl;   /* 寸法が無い（隠れている）間は今の置き場のまま */
  }
  if (low) { if (dayRowEl.parentNode !== toolsEl) toolsEl.insertBefore(dayRowEl, toolsEl.firstChild); }
  else if (dayRowEl.parentNode !== topRowEl) topRowEl.appendChild(dayRowEl);
  topRowEl.classList.toggle('is-solo', low);
}
/* 泳ぐ形にするか：スキンが海の生き物で、小さい画面のとき */
function swimOn(wide) {
  return !wide && !!document.body && document.body.classList.contains('skin-sea');
}

/* ---------------- 泳ぐ生き物：タグのフィルターと一覧の切り替え（2026-11-25 Issue #96 の 7・8 回目の返事） ----------------
   > タグの選択ボタンとリストボタンもイメージにあう海の生き物に置き換えて、1番前のレイヤーで上の方でゆっくり動かすことできる？
   > クラゲとカメの位置を離して、海のタブも同じUIにして。スクリーン画面が大きい場合はいままでのUIにして。
   ・タグのフィルター … クラゲ。傘の下にいま選んでいるタグの名前（「ぜんぶ ▽」）。押すと今までどおりタグを選ぶ板が開く
   ・一覧の切り替え … カメ。甲羅に ⇅（一覧の間は ✕）。押すと今までどおり一覧と泡の眺めを切り替える
   ・小さい画面では、面の上のほう（2段目の帯。.today-swim）を、泡より前（いちばん前の層）でゆっくり左右に泳ぐ。
     クラゲは帯の左半分、カメは右半分だけを泳ぎ、重ならない（8 回目の返事）。
     指を乗せている間・焦点がある間・一覧の間は止まる。動きを減らす設定では、左右の端で止まっている
   ・大きい画面（isWideScreen）では、前のボタンに戻す：フィルターは 1段目の左、⇅ は 2段目の右（絵は CSS が隠す）
   ・絵と包みは js/swim.js（海の画面と同じもの）。中身（filterLabel・listIc・aria-label・title）は前のボタンのまま
   ・泡を掴んでいる間・押している間は、前と同じく消す（css の .is-bubdrag など） */
function applySwimLayout(wide) {
  if (!swimBand || !filterBtn || !listBtn || !topRowEl || !toolsEl || !dayRowEl) return;
  const swim = swimOn(wide);
  if (!swim) {
    if (filterBtn.parentNode !== topRowEl) topRowEl.insertBefore(filterBtn, topRowEl.firstChild);
    if (listBtn.parentNode !== toolsEl) toolsEl.appendChild(listBtn);
  } else {
    if (filterBtn.parentNode !== swimBand) swimBand.appendChild(filterBtn);
    if (listBtn.parentNode !== swimBand) swimBand.appendChild(listBtn);
  }
  swimBand.hidden = !swim;
  topRowEl.classList.toggle('is-center', swim);
  placeDayRow();
}

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'today',
  label: '今日',
  icon: '◎',

  mount(node) {
    pane = node;

    stage = el('div', 'today-stage');
    pane.appendChild(stage);

    /* 何も無いときのことば。
       未達を名指ししない・件数を出さない・命令形にしない（契約 §0）。
       日が変わると空になることも書かない。ここが何の面で、どうすれば浮かぶかだけ言う。 */
    /* --- 左右の帯（掴んでいる間だけ出る。離すと日が変わる）---
       面の子。指は透かす（判定は指先の座標でやるので当たり判定は要らず、
       持たせると帯の下のバブルを掴めなくなる） */
    dayEdges = {};
    ['left', 'right'].forEach(dir => {
      const box = el('div', 'today-edge');
      box.dataset.dir = dir;
      box.hidden = true;
      box.setAttribute('aria-hidden', 'true');
      const ar = el('span', 'ar', dir === 'left' ? '‹' : '›');
      const lb = el('span', 'lb');
      const md = el('span', 'md');
      const dw = el('span', 'dw');
      const mo = el('span', 'mo', '送る');    /* 止めて待つと「＋コピー」（Issue #97） */
      lb.appendChild(md);
      lb.appendChild(dw);
      lb.appendChild(mo);
      box.appendChild(archSvg());   /* スキン「海の生き物」では帯の代わりに真ん中の岩のアーチ（css/screens/today.css。Issue #96） */
      box.appendChild(ar);
      box.appendChild(lb);
      stage.appendChild(box);
      dayEdges[dir] = { el: box, md, dw, mo };
    });

    emptyNote = el('p', 'today-empty');
    emptyNote.appendChild(el('span', 'l1', ''));
    emptyNote.appendChild(el('span', 'l2', ''));
    syncEmptyNote();
    stage.appendChild(emptyNote);

    /* --- ランダムスタート（追補5 §4）---
       海と同じ形・同じ印・同じ言い方。海では「リスト表示」の下に置いているが、
       この画面には他のボタンが無いので右上に置く（親指の届く角は同じ側）。 */
    /* 見出しの日付。押すと近い日が選べる（利用者の判断）。
       遠い日は左右になぞって行く。

       **両脇に ‹ › を置く**（利用者の指摘）。左右になぞれば日が移ることは
       前から動いていたが、画面のどこにもそう書いていなかった——
       海には矢印の看板があるのに、ここには手がかりが無かった。
       札としてだけでなく**押しても移れる**ようにする（指だけの経路にしない／A-9 と同じ）。 */
    const dayRow = el('div', 'today-dayrow');

    dayPrev = el('button', 'today-daystep');
    dayPrev.type = 'button';
    dayPrev.textContent = '‹';
    dayPrev.setAttribute('aria-label', '前の日へ');
    dayPrev.addEventListener('click', ev => { ev.preventDefault(); goDay(shiftDay(curDay(), -1)); });
    dayRow.appendChild(dayPrev);

    dayBtn = el('button', 'today-day');
    dayBtn.type = 'button';
    dayBtn.addEventListener('click', ev => { ev.preventDefault(); openDayPop(dayBtn); });
    dayRow.appendChild(dayBtn);

    dayNext = el('button', 'today-daystep');
    dayNext.type = 'button';
    dayNext.textContent = '›';
    dayNext.setAttribute('aria-label', '次の日へ');
    dayNext.addEventListener('click', ev => { ev.preventDefault(); goDay(shiftDay(curDay(), 1)); });
    dayRow.appendChild(dayNext);

    /* 1段目の並び（2026-11-22 Issue #92 の返事「今日のタブの明日に切り替えるボタンを右に移動して、
       海と同じ位置にタブのボタンを移動できる？」）。≡ の右に海と同じくタグのフィルター「ぜんぶ ▽」
       （下で先頭に差し込む）、日付と ‹ › は右へ寄せて歯車の手前に置く。前は日付が ≡ の右、フィルターは 2段目の左 */
    const topRow = el('div', 'today-top');
    topRow.appendChild(dayRow);
    stage.appendChild(topRow);
    syncDayBtn();
    stage.addEventListener('pointerdown', onDayDown);

    randomBtn = el('button', 'today-random');
    randomBtn.type = 'button';
    randomBtn.appendChild(diceIcon());
    randomBtn.addEventListener('click', ev => {
      ev.preventDefault();
      randomStart();
    });
    stage.appendChild(randomBtn);

    /* おすすめ（Issue #12）。さいころの下。押すと板が開く（送るのは板の [AI で選び直す] を押したときだけ） */
    suggestBtn = el('button', 'today-suggest', 'おすすめ');
    suggestBtn.type = 'button';
    suggestBtn.classList.add('opt-suggest');  /* 既定は隠す。設定の「今日の画面に『おすすめ』を出す」で出す（2026-11-22 Issue #80 の返事。前は .is-extra） */
    suggestBtn.addEventListener('click', ev => { ev.preventDefault(); toggleSuggest(); });
    stage.appendChild(suggestBtn);

    /* 四つに分ける切り替え。さいころの左（海ではフィルターの隣） */
    quadBtn = quadButton(() => setQuad(!quadOn));
    quadBtn.classList.add('today-quadbtn');
    quadBtn.classList.add('opt-quad');     /* 設定の「今日の画面に『四つに分ける』を出す」で出す（同上） */
    /* 置くのは下の 2段目の並び（.today-tools。Issue #92）、⇅ の左どなり */

    /* drift は opts の直下から handlers を読む。将来 opts.handlers を見る作りに
       変わっても落ちないよう、まとめたものも一緒に渡しておく（余分なキーは無視される） */
    /* 今日大事なこと・先に済ませる（Issue #96。2026-11-24）。renderPlate の説明。
       小さい画面の左下・右下のエリア（.today-corners）：泡を掴んでいる間だけ出す。壁にしない。
       名前は .today-corners（前の版の枠 .today-plate と分ける。css/screens/today.css の説明）。
       大きい画面の枠（.today-wide）：泡にとっては壁（drift の keepOut）。隠れている間（小さい画面）は drift が数えない */
    plate = el('div', 'today-corners');
    plate.dataset.screen = 'today.corners'; plate.dataset.screenLayer = '2';
    plate.hidden = true;
    stage.appendChild(plate);
    wideBox = el('div', 'today-wide');
    wideBox.dataset.screen = 'today.wide'; wideBox.dataset.screenLayer = '2';
    wideBox.hidden = true;
    stage.appendChild(wideBox);
    /* スキン「海の生き物」の魚（renderFish）。泡（field）より先に入れて z-index を持たせないので、泡の後ろを泳ぐ */
    fishBox = el('div', 'today-fishes');
    fishBox.dataset.screen = 'today.fishes'; fishBox.dataset.screenLayer = '2';
    fishBox.hidden = true;
    stage.appendChild(fishBox);
    field = createField(stage, Object.assign({ size: 'text', handlers, keepOut: '.today-wide' }, handlers));
    quad = createQuadView(stage, { className: 'today-quad', bind: (node) => attachGestures(node, handlers) });
    quad.el.dataset.screen = 'today.quad';

    /* 一覧で見る（Issue #86）。2段目の左の札と、面いっぱいの一覧。札は既定で出す（頼まれた働きなので畳まない） */
    listBox = el('div', 'today-list');
    listBox.dataset.screen = 'today.list'; listBox.dataset.screenLayer = '2';
    listBox.setAttribute('role', 'region');
    listBox.setAttribute('aria-label', '一覧');
    listBox.hidden = true;
    stage.appendChild(listBox);
    /* 2段目の並び（2026-11-22 Issue #92「海と今日のタグの選択とリストの選択のUIを海に似せて統一できる？」）。
       海と同じ形にそろえた: 右に「四つ」（出しているとき）と丸い ⇅（海のリスト表示と同じ。一覧の間は ✕。字は出さない）。
       タグのフィルター「ぜんぶ ▽」は、返事で海と同じ 1段目の ≡ の右へ上げた（上の .today-top）。
       前（Issue #86・#89）は 2段目の左に字の札「一覧」と「ぜんぶ ▽」を並べていた */
    const tools = el('div', 'today-tools');
    filterBtn = el('button', 'today-filterbtn');
    filterBtn.type = 'button';
    filterLabel = el('span', 'lb', ALL_NAME);
    const fic = el('span', 'ic', '▽');
    fic.setAttribute('aria-hidden', 'true');
    filterBtn.appendChild(filterLabel);
    filterBtn.appendChild(fic);
    filterBtn.setAttribute('aria-haspopup', 'menu');
    filterBtn.setAttribute('aria-expanded', 'false');
    filterBtn.addEventListener('click', ev => { ev.preventDefault(); openFilterPop(); });
    tools.appendChild(quadBtn);
    listBtn = el('button', 'today-listbtn');
    listBtn.type = 'button';
    listIc = el('span', 'ic', '⇅');
    listIc.setAttribute('aria-hidden', 'true');
    listBtn.appendChild(listIc);                /* 字は出さない（Issue #92 の返事。名前は aria-label・title が渡す） */
    listBtn.addEventListener('click', ev => { ev.preventDefault(); setList(!listOn); });
    stage.appendChild(tools);
    /* タグのフィルター（クラゲ）と一覧の切り替え（カメ）。小さい画面では面の上のほうを泳ぐ帯に、大きい画面では前の場所に
       （Issue #96 の 7・8 回目の返事。applySwimLayout）。帯は面の最後に入れて、泡より前に描く */
    dressJelly(filterBtn);
    dressTurtle(listBtn);
    swimBand = el('div', 'today-swim');
    swimBand.dataset.screen = 'today.swim'; swimBand.dataset.screenLayer = '2';
    stage.appendChild(swimBand);
    topRowEl = topRow; toolsEl = tools; dayRowEl = dayRow;
    placeDayRow();
    applySwimLayout(isWideScreen());
    /* 画面の幅が境目をまたいだら（窓の大きさ・回転）、形を切り替える */
    if (WIDE_MQ) {
      const onWide = () => { if (field) render(); else applySwimLayout(isWideScreen()); };
      if (WIDE_MQ.addEventListener) WIDE_MQ.addEventListener('change', onWide);
      else if (WIDE_MQ.addListener) WIDE_MQ.addListener(onWide);
    }
    /* 設定のスキンを変えたら（Issue #96 の 9 回目の返事）。body の印（skin-sea）は js/app.js の applyPrefs が付けるので、そのあとで */
    window.addEventListener(PREFS_EVENT, () => setTimeout(() => { applySwimLayout(isWideScreen()); renderCorners(lastPlate); }, 0));
    /* 起動の直後に印がまだ付いていないことがあるので、1 回だけ見直す */
    setTimeout(() => { applySwimLayout(isWideScreen()); renderCorners(lastPlate); }, 0);
    document.addEventListener('pointerdown', onFilterOutside, true);
    syncFilterBtn();
    /* 前に一覧で見ていたら、一覧で始める。入力欄がまだ無いので setList（render を呼ぶ）は使わず、
       印だけ立てる。漂う面は onShow が listOn を見て動かさない */
    if (loadListOn()) {
      listOn = true;
      listBox.hidden = false;
      stage.classList.add('is-list');
    }
    syncListBtn();

    /* --- その日の海に直に書く（利用者の指示）---
       面（.today-stage）の**兄弟**として下に置く。面は flex:1 なので自然に縮み、
       drift が測る clientHeight もそのまま正しくなる
       ——海のように重ねると、床の高さを CSS 変数で渡す配管が要る。 */
    composer = el('form', 'today-composer');
    cTags = el('div', 'tc-tags');
    composer.appendChild(cTags);

    const row = el('div', 'tc-row');
    cInput = el('input');
    cInput.type = 'text';
    cInput.autocomplete = 'off';
    cSend = el('button', null, '送信');
    cSend.type = 'submit';
    cSend.disabled = true;
    row.appendChild(cInput);
    row.appendChild(cSend);
    composer.appendChild(row);

    cInput.addEventListener('input', syncComposer);
    /* 入力欄に触っている間だけ札を開く。ふだん畳んでおくのは、
       書く前から選択肢が並ぶと水面が狭くなるため */
    cInput.addEventListener('focus', () => composer.classList.add('is-open'));
    composer.addEventListener('focusout', () => {
      /* 札を押したときは焦点が札へ移るだけ。畳まない */
      setTimeout(() => {
        if (!composer) return;
        if (composer.contains(document.activeElement)) return;
        if (cInput && cInput.value.trim()) return;    /* 打ちかけは開いたまま */
        composer.classList.remove('is-open');
      }, 0);
    });
    composer.addEventListener('submit', ev => { ev.preventDefault(); addFromComposer(); });
    pane.appendChild(composer);
    renderComposerTags();
    syncComposer();

    unsubscribe = store.on(render);

    /* ペインの寸法が変わったら並べ直す。mount 時点では 0 なので、
       ここでは寸法を使う計算をしない（契約 §14） */
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (!shown || !field) return;
        if (!stage.clientWidth || !stage.clientHeight) return;
        placeDayRow();
        field.relayout();
        /* 幅が変わったら（回転・窓の大きさ）泡の大きさを決め直す（Issue #87）。
           高さだけの変化（キーボードの出入り）では決め直さない——打つたびに泡が縮み広がりするため */
        if (!listOn && !quadOn && Math.abs(stage.clientWidth - fitW) > 1) render();
      });
      ro.observe(stage);
    }

    render();
  },

  /* 今日へ戻す（引き出しの名前タップ用。利用者の指示 2026-09-25）。
     明日を映したまま引き出しから「今日に置いたもの」を開こうとすると、
     その泡はこの面に無い。開く前に今日へ戻してから探す */
  showToday() { goDay(todayKey()); },

  onShow() {
    shown = true;
    /* 見ている日が過ぎていたら、今日に戻す。
       「明日」を映したまま2日放っておくと、開き直したときに過去を映していて、
       しかもタブの落とし先がそこになる——という置き去りを防ぐ。
       自分で過去へなぞって見に行くぶんは、この後いつでもできる */
    if (viewDay && viewDay < todayKey()) { viewDay = null; announceDay(); }
    placeDayRow();
    /* ここで初めてペインが display:flex になる。寸法が取れるのはこの時点から */
    if (field && !quadOn && !listOn) { field.relayout(); field.start(); }
    render();
  },

  /* 戻る（Android の戻るボタン）。開いているものを畳む。
     日を移していたら今日へ戻す——「最終的にホームへ」の途中の1段。 */
  onBack() {
    if (filterPop) { closeFilterPop(true); return true; }
    if (dayPop) { closeDayPop(); return true; }
    if (suggest) { closeSuggest(); return true; }
    if (detail) { closeDetail(); return true; }
    if (viewDay) { goDay(todayKey()); return true; }
    return false;
  },

  onHide() {
    shown = false;
    closeMenu();
    closeDetail();
    closeSuggest();
    closeFilterPop(false);
    cancelShuffle();         /* 混ぜかけのまま裏に回ったら畳む。開かない */
    if (field) field.stop();
    if (typeof store.flush === 'function') store.flush();
  },

  /* テスト・後片付け用。app.js は今のところ呼ばない */
  destroy() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (plateTimer) { clearTimeout(plateTimer); plateTimer = 0; }
    if (ro) { ro.disconnect(); ro = null; }
    document.removeEventListener('pointerdown', onFilterOutside, true);
    if (field) { field.destroy(); field = null; }
  },
};
