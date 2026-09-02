/* データ層。localStorage に永続化する。
   画面モジュールはこの API だけを使い、localStorage を直接触らない。

   todo = {
     id:        string     一意
     text:      string     本文
     today:     boolean    「今日する」枠に入っているか
     createdAt: number     epoch ms
     fx, fy:    number     漂う位置。ステージに対する中心の割合 0..1
     slots:     string[]   時間帯タグ。朝/昼/夜の固定3値。複数可。
                           today:false のときは常に空（today と一緒に消える軸）
     anchors:   string[]   ぶら下げているアンカーの id。複数可。
                           today とは独立した軸で、日をまたいでも消えない（gap と同じ扱い）
     anchorAt:  {anchorId:number}  そのアンカーにぶら下げた順を表す通し番号。
                           inAnchor() の並び（＝先頭が主役）に使う
     started:   {[anchorId|'']:number}  はじめた記録。「着手した」時刻 epoch ms。
                           キーはアンカーの id、または '' （アンカー無しで始めた＝画面1から）。
                           キーが無ければ未着手。時間帯（slots）では記録しない
     firstStep: string     「最初の一手」のメモ。既定 ''
     url:       string     参照リンク。http/https に限る。既定 ''
     gap:       boolean    すきま時間（移動中など）にできる。既定 false
     plan:      boolean    きっかけの画面に属する。既定 false。
                           まだどのアンカーにもぶら下げていないもの（未分類）の置き場を
                           表すための軸で、anchors とは独立。gap と同じ形
     gapSlots:  string[]     すきま時間の枠の id。何個でも入る（アンカーと同じ）。
                           前の版は単数の gapSlot だった（1枠1件）。読み込みで移行する
                           固定4値、または null（未分類）。既定 null。
                           1枠に入るのは1件だけ。gap:false のときは常に null
                           （gap と一緒に消える軸。slots と today の関係と同じ）
     tags:      string[]   ユーザーが作ったタグの id。既定 []。
                           特別なタグ（today/plan/gap/done）はここに入れない。
                           あれは既存のフラグ（today / plan / gap / done）がそのまま実体で、
                           tagsOf() が読むときに合成する。同じ状態を2か所に持たない
     done:      boolean    完了。既定 false。項目は消えず、完了の海へ移るだけ。
                           done:true のものは「いま生きているもの」を返す問い合わせからは外れる
                           （floating / todays / inAnchor / gapItems ... ）。all() には出る
     doneAt:    number|null  完了した時刻 epoch ms。done:false なら null。
                           完了の海の並び（新しい順）と doneCount() の期間集計に使う
     trashed:   boolean    消した印（墓石）。既定 false。remove() はこれを立てるだけで、
                           項目そのものは配列から取り除かない。
                           「基本は記録として残し続ける」ため（利用者の指示）。
                           done との違い：
                           ・done は完了の海に見えていて、UI から取り消せる
                           ・trashed はどこにも見えない。UI から戻す道は作らない。
                             戻せるのは localStorage を直接いじるか、
                             コンソールから store.untrash(id) を叩いたときだけ
                           trashed:true のものは get() が null を返し、
                           「いま生きているもの」を返す問い合わせから全部外れる
                           （all / floating / todays / count / inSlot / unslotted /
                            inAnchor / planUnsorted / gapItems / inGapSlot / gapUnsorted /
                            inTag / doneItems / doneCount / writtenCount）。
                           全件を見るのは allIncludingTrashed() / trashedItems() だけ
     trashedAt: number|null  消した時刻 epoch ms。trashed:false なら null。
                           trashedItems() の並び（新しい順）に使う
     steps:     [{at,did,next}]  一手の記録。古い順に積み上がる。既定 []。
                           上書きしない（直近1件の書き損じを直す amendLastStep だけが例外）。
                           着手のログ（log）とは別系列で、ふりかえりの集計には出ない
     draft:     {did,next}  書きかけ。記録ではない。既定 { did:'', next:'' }。
                           打った文字を失わせないためだけの控えで、
                           commitStep で1件積んだ時点で空に戻る
   }
   fx/fy は画面サイズが変わっても位置が破綻しないよう割合で持つ。

   anchor = { id:string, name:string, hue:0|1|2|null }
   アンカー＝ユーザーが名前を決める「きっかけ」。「歯を磨いたら → ヨガマットを敷く」のように、
   時間帯ではなく既存の安定した行動をきっかけにするための軸。並び順はユーザーが決める。
   hue は色の割り当てで、先に作った3件だけが 0,1,2 を持ち、4件目以降は null（色を持たない）。

   時間帯タグ（slots）とアンカー（anchors）は別の軸。
   slots は「今日する」の中の粗い時間帯で、today と一緒に毎日消える。
   anchors は立てっぱなしの計画なので消えない。記録が付くのはアンカーの側だけ。

   firstStep は「知覚サイズを下げる」ための欄。やることの大きさそのものは変えられないが、
   最初の一手を書き出しておくと、取りかかるときの見かけの大きさが下がる。

   記録するのは「完了」ではなく「着手」。終わったかどうかは持たないし、聞かない。
   やらなかったものは翌日に持ち越さない（rollover 参照）。
   集計は件数だけを返す。分母つきの指標（達成率など）は作らない。

   tag = { id:string, name:string, color:string, special:boolean, dir:'up'|'left'|'right'|'down'|null }
         'up'（長期保留）と 'down'（完了）は固有枠。ユーザーが選べるのは left/right だけ
   タグ＝バブルの海の面。中央（ぜんぶ）以外の3つの向きに、ユーザーが好きなタグを割り当てる。
   向きは3つしかないが、タグは何個でも作れる（1向き1タグ）。
   today / plan / gap / done の4つは特別なタグで、名前を変えられず、消せない。
   実体は既存のフラグそのもので、タグとしての状態は別に持たない。

   保存形式 v2:
     { v:2, anchors:[anchor], tags:[tag], todos:[todo], log:[{id,text,slot,slotName,at}],
       todayLog:[{id,text,at}], lastDay:'YYYY-MM-DD' }
   firstStep / url / gap / gapSlots / gapAt / plan / anchors / steps / draft / tags / done /
   trashed は後から足したフィールドで、無ければ既定値で埋める。
   増えただけで読み方は変わらないので v は上げていない。
   log は着手のログ。古い順。text はその時点のスナップショットなので、
   あとから todo の本文が変わっても、消えても、ログ側は変わらない。
   log.slot は着手したアンカーの id（アンカー無しで始めたときは null）、
   slotName はその時点のアンカー名のスナップショット。
   アンカーを改名・削除しても過去の記録が読めるように、名前も一緒に残す。 */

const KEY = 'bubble_todo_v1';

/* 時間帯タグ。ユーザーが増やせない固定の3値。記録は付かない */
const SLOTS = ['morning', 'noon', 'night'];

/* すきま時間の枠。軸は 通信（あり／なし）× 使えるもの（耳だけ／画面）の固定4値。
   時間帯タグ（複数可）と違い、1件が入れるのは1枠だけ。1枠に入るのも1件だけ */
/* すきま時間の枠。**ユーザーが決める一覧**（利用者の指示。前は固定4値だった）。
   既定はいままでの4つで、名前を変えられる・足せる・消せる・並べ替えられる。
   1枠に入る数の上限も無くした（前は「1枠1件」で、2件目が古いほうを押し出していた）。
   持ち方はきっかけのアンカーとまったく同じ——画面も同じ形にするため。 */
const GAP_DEFAULTS = [
  { id: 'ears',       name: '耳だけ',           hue: 0 },
  { id: 'ears_off',   name: '耳だけ・保存済み', hue: 1 },
  { id: 'screen',     name: '画面',             hue: 2 },
  { id: 'screen_off', name: '画面・保存済み',   hue: 3 },
];

/* 一覧で見渡せる上限。アンカーと同じ数にそろえてある */
const MAX_GAP_SLOTS = 12;

/* 特別なタグ。既存のフラグ（today / plan / gap / hold / done）と同じものを指す。
   名前は変えられず、消せない。色と向きだけユーザーが決められる
   （完了だけは向きも固有枠に固定。下の FIXED_DIRS） */
const TAG_SPECIAL = ['today', 'plan', 'gap', 'hold', 'done'];

/* 海の向き。**左右は「並び」に置き換わった**（利用者の指示：タグ付き海を10個まで）。
   横一列に並べるので、左右という2つの枠ではなく**順番**を持つ（下の seaList）。
   この定数は、古い保存データ（dir: 'left' / 'right'）を読むときにだけ使う。 */
const TAG_DIRS = ['left', 'right'];

/* 海にできるタグの数（利用者の指示）。中央（タグ無し）と上下の固有枠は数に入れない。
   10 は「一列に並べて、引きで一望できる」上限として利用者が決めた数。 */
const MAX_SEAS = 10;

/* 固有枠（利用者の指示）。**上＝長期保留 / 下＝完了**。
   ここはタグの取り合いに出さない：この2つは枠から動かせず、ほかのタグも入れない。

   なぜ固定するか。どちらも「いまの海から外したもの」の行き先で、
   **外した先が無くなると、外す操作そのものが行き止まりになる**。
   上をユーザーが別のタグに譲れると、長期保留にしたものの居場所が消えて、
   どの海にも出ないまま見えなくなる。だから構造として置き、左右だけを取り合いにする。 */
const FIXED_DIRS = { hold: 'up', done: 'down' };

/* 面の向き全部（固有枠を含む）。tagDir() の引数を見るのに使う */
const ALL_DIRS = ['up', 'left', 'right', 'down'];

/* ---------- タグの色（パステルで統一） ----------

   ■ そろえ方
   12色すべてを OKLCH の **L = 0.87 / C = 0.062 に固定し、色相だけ 30度ずつ振る**。
   HSL ではなく OKLCH でそろえるのは、HSL の L が色相ごとに見た目の明るさを揃えないため
   （同じ L でも黄は明るく、青は暗く見える）。OKLCH の L は知覚的な明るさなので、
   L を固定すると 12色が本当に同じ重さに見える。これが「パステルの統一感」の実体。

   ・L = 0.87  … 灰でいえば #d8 あたりの明るさ。前は 0.82（#c9 相当）だったので一段白い
   ・C = 0.062 … その明るさで **全色相が sRGB に収まる最大値**（いちばん狭いのは H 260 の
                 青紫で Cmax 0.0638）から 3% 手前。前の 0.088 は L 0.82 での同じ取り方で、
                 **L を上げるとどの色相も取れるクロマが下がる**ので、白へ寄せるぶん
                 C は自動的に下がる（L 0.82→0.87 で Cmax 0.090→0.064）。
                 パステルの中では取れるかぎり鮮やかに振ってある——これ以上下げると
                 12色の見分けが付かなくなり、上げると青紫だけ sRGB からはみ出す
   ・色相は 20° から 30° 刻みの12スロット（20/50/80/…/350）。
     12色の**どの2色をとっても 30度以上**離れる（OKLab 上の差 ΔE 0.0310〜。
     前は 0.0448。白へ寄せたぶんクロマが下がるので、色どうしの差もその比で縮む）。
     8色で 45度ずつ取ると、特別な4色との間が 10度未満に詰まる組が出るので、
     特別な4色ごと1つの格子に載せてある

   ■ 「きっかけ」が濁って見えていた理由と、直し方（色相は動かしていない）
   その色相で sRGB がいちばん鮮やかになる明るさを cusp と呼ぶ。cusp より **下** の色は
   「その色相を暗くしたもの」に見え、上の色は「白で薄めたもの」に見える。
   茶・カーキ・オリーブは前者しか無い——黄の暗い版が茶であって、鮮やかな茶は存在しない。
     H 80（きっかけ）の cusp L = 0.824。前の L 0.82 は **ちょうど cusp の上**だった。
     ＝ 12色のうち H 80 だけが「淡くした金」ではなく「くすませた金」になり、
        タン／キャメルに寄って、他の11色より濁って見えていた。
     L 0.87 は cusp より 0.046 上。ここで初めて他の色と同じ「白で薄めた」側に入る。
   ほかの11色の cusp は 0.52〜0.97 で、どれも前の L 0.82 の時点で
   「暗くした」側には落ちていなかった（落ちていたのは H 80 だけ）。
   だから直したのは L であって、色相ではない。

   ■ 意味と色の対応は変えていない
   特別な4つは**色相をそのまま**にして、明るさと鮮やかさだけを動かしてある。
     今日     H 50   橙のまま
     きっかけ H 80   琥珀のまま（上のとおり、濁りの原因は色相ではなく L だった）
     すきま   H 230  青のまま
     完了     H 290  紫のまま
   最初から置いてある2つも同じ（仕事 H 200 青緑 / プライベート H 20 赤）。

   ■ 無彩色は入れない
   無彩色（r=g=b）は「タグ無し」の意味に取ってあり、tagColor() が弾く。
   白へ寄せても C = 0.062 は残してあるので、12色とも r/g/b が一致しない。

   ■ バブルの膜に載せたときのコントラストは css/bubble.css 側に数値がある。
   白くしたぶん膜の載せ方（--tint-mix / --tint-o）も動かしてあり、明暗とも 4.5:1 を上回る。 */

/* 特別なタグの既定値。トークン名ではなく実際の色文字列を保存するのは、
   保存データが CSS の都合に引きずられないようにするため */
/* 特別な4つ。日本の伝統色に寄せて 洗柿 / 卵色 / 空 / 藤。

   きっかけは 白橡 #fde0b2（H80）から 卵色 #ffe8a4（H92）へ移した。
   利用者から「今日ときっかけの色が似ている」との指摘。実測すると
   両者の色差は 0.0764 で、パレット45組のうち近い順に12番目——数値としては
   最悪ではないが、**淡い橙どうしで同じ系統に見える**うえ、
   隣り合うタブで毎日並ぶ2色なので、目に付くのはここになる。

   パステルの帯（L .85〜.94 / C .05〜.09）を総当たりし、
   他9色すべてに対する最小色差（正常＋色覚特性3型）を最大にする色を選んだ：

     いまの白橡 #fde0b2   今日との差 0.0764   全体の最小 0.0445
     卵色     #ffe8a4   今日との差 0.1001   全体の最小 0.0672  ← これ
     緑へ移す（若苗も動かす）今日との差 0.0845   全体の最小 0.0619

   卵色が両方の指標で勝ち、しかも1色の変更で済む。
   文字コントラストの下限は青竹 #adfde1 が決めているので、ここは動かない。 */
const TAG_DEFAULTS = [
  { id: 'today', name: '今日',     color: '#fdc09e', dir: null },   /* 洗柿 OKLCH .855 .084  50 */
  { id: 'plan',  name: 'きっかけ', color: '#ffe8a4', dir: null },   /* 卵色 同     .935 .090  92 */
  { id: 'gap',   name: 'すきま',   color: '#a6e1fe', dir: null },   /* 空   同     .880 .072 230 */
  /* 上の海（利用者の指示）。前はここが「完了」だった。**固有枠**なので動かせない。
     長期保留＝いつかやるが、いまは目に入れたくないもの。
     **どの海からも既定では出さない**（画面側が外す）。上の海だけに出る */
  { id: 'hold',  name: '長期保留', color: '#cec8ff', dir: 'up' },   /* 藤   同     .855 .076 290 */
  /* 下の海（利用者の指示）。**固有枠**なので dir は動かせない（上の FIXED_DIRS）。
     ふりかえりからの導線も残る（review.js は tag('done').dir を見て出す）。
     色は藤を長期保留へ渡したので、11色目を計算で選び直した
     （他10色に対する最小色差を最大にする色。これで色差の下限は動かない） */
  { id: 'done',  name: '完了',     color: '#dfdeb5', dir: 'down' },  /* 抹茶 同     .890 .054 106 */
];

/* ユーザーのタグの色。**色の出どころはここ1か所だけ**。
   ・色を指定せずにタグを作ったとき（nextTagHue）
   ・設定画面が「タグを足す」で配るとき（store.tagPalette() を読む）
   の両方がこの配列を使う。以前は設定画面が別のパレットを持っていて二重管理だった。

   並びは「順に配ったときに続けて似た色が出ない」ように色相を飛ばしてある
   （205 → 20 → 140 → 320 → 170 → 345。隣り合う2つは必ず 90度以上離れる）。

   明度・彩度は色相ごとに個別に選んである。前の版は全色を L.87 C.062 に固定していたが、
   人の目の感度は色相で違うので、固定すると黄緑だけ浮き、青だけ沈む。
   色覚特性のもとでの最小色差（OKLab ΔE）はこの並べ替えで
   2型 .0053→.0254 / 1型 .0127→.0283 / 3型 .0063→.0244 に上がっている。 */
const TAG_PALETTE = [
  '#b8eef5',  /* 瓶覗 OKLCH .915 .056 205  水  */
  '#f6c5c3',  /* 薄紅 同     .865 .056  20  赤  */
  '#d2f5ca',  /* 若苗 同     .935 .068 140  緑  */
  '#e0c4e7',  /* 薄紫 同     .855 .056 320  紫  */
  '#adfde1',  /* 青竹 同     .935 .088 170  緑青 */
  '#f7cae2',  /* 撫子 同     .885 .060 345  桃  */
];

/* パレットの世代。保存データに書いた世代がこれと違うときだけ、
   保存済みのタグの色を配り直す（下の repaintTags）。

   色を変える口は画面のどこにも無い（設定のタグ行に出ているのは見るだけの点で、
   色を選ばせていない）。つまり保存されている色は必ず「そのときの
   TAG_DEFAULTS / TAG_PALETTE が配った色」なので、配り直しで
   ユーザーの選択を踏み潰すことはない。
   色を選べるようにしたら、この配り直しはやめること。 */
const PAL_VER = 5;

/* 最初から置いてあるユーザーのタグ。特別ではないので、名前も色も変えられるし消せる。
   海の既定は 中央=すべて / 左=仕事 / 右=プライベート / 上=長期保留 / 下=完了（利用者の指示）。
   上下は固有枠で、左右だけがユーザーの取り合い。
   特別な3つ（今日・きっかけ・すきま）は、既定では海に置かない（専用のタブがあるため）。
   色はパレットの先頭2つ。ここでも別の色文字列を書かない（二重管理にしない）。 */
const TAG_STARTERS = [
  { id: 'work',    name: '仕事',       color: TAG_PALETTE[0], dir: 'left' },
  { id: 'private', name: 'プライベート', color: TAG_PALETTE[1], dir: 'right' },
];

/* アンカー。ユーザーが決めるので上限だけ置く。
   12 は「一覧で見渡せる」上限として決めた数で、意味のある区切りではない */
const MAX_ANCHORS = 12;

/* 色。カードを見分けるための印で、色そのものに意味は無い。
   **5色**（利用者の指示で3→5へ。すきまの既定だけで4つあり、3色では足りなかった）。
   空きがあれば再利用する。6色目を足すと色覚特性下の最小色差が落ちるので、ここで止める
   （数値は css/base.css の --slot-amber のコメントに書いてある）。 */
const HUES = [0, 1, 2, 3, 4];

/* 集計で「アンカー無しで始めたぶん」に付ける名前 */
/* 画面に出る言葉。中では anchor と呼んでいるが、UI では一貫して「きっかけ」
   （レビューの指摘。ここだけ内部の言葉が漏れていた） */
const NO_ANCHOR_NAME = 'きっかけ無し';

/* started / log で「アンカー無し」を表すキー。log 側では null で持つ */
const NO_ANCHOR_KEY = '';

/* 夜の枠が 17時〜翌5時 なので、日付の境も 5時に合わせる。
   深夜1時に着手したものは「前日ぶん」として数える。 */
const DAY_CUTOFF_HOUR = 5;

let items = [];
let anchorList = [];  /* アンカー。配列の並びがそのままユーザーの並び順 */
let gapList = [];     /* すきま時間の枠。同じく並びがユーザーの並び順 */
let tagList = [];     /* タグ。先頭4件は必ず特別なタグ（TAG_DEFAULTS の順） */
let seaList = [];     /* 横一列に並ぶ海（タグの id。左から順）。中央と上下は入らない */
/* 最初から置いてあるタグ（TAG_STARTERS）のうち、ユーザーが消したもの。
   これを覚えておかないと、消しても読み込みのたびによみがえる */
let removedStarters = [];
let logs = [];
let todayLogs = [];   /* 「今日する」に入れた記録。着手ログとは別に持つ */
let lastDay = null;
const listeners = new Set();

/* ぶら下げた順の通し番号。時刻ではなく連番で持つ。
   同じミリ秒に2件ぶら下げても順が決まるようにするため */
let seq = 1;

function uid() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function aid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function tid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function clamp01(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/* --- URL の検証 ---

   ユーザーが書いた文字列はそのまま href に入れない。
   通すのは http / https だけ。javascript: data: vbscript: file: などは弾く。
   判定は文字列比較ではなく new URL() の protocol で行う。
   大文字小文字・前後の空白・`java\tscript:` のような細工は URL パーサ側が
   正規化してくれる（タブや改行は取り除かれ、スキームは小文字になる）ので、
   そのうえで protocol を見れば素通りしない。

   -> 正規化した文字列 / '' （空＝クリア）/ null （不正なので保存しない） */
function safeUrl(raw) {
  const s = (raw === null || raw === undefined) ? '' : String(raw).trim();
  if (!s) return '';
  let u = null;
  try { u = new URL(s); } catch (e) { u = null; }
  if (!u) {
    /* ここに来るのは「スキームとして解釈できなかった」ものだけ。
       example.com/a のような書き方を拾うために https を補う。
       javascript: などは上で解釈できてしまうので、この補完は通らない */
    try { u = new URL('https://' + s); } catch (e) { return null; }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

/* --- 日付 --- */

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function ymd(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* epoch ms が「どの日のぶん」か。5時までは前日 */
function dayOf(ms) {
  return ymd(new Date(ms - DAY_CUTOFF_HOUR * 3600 * 1000));
}

/* ---------------- きっかけの日にち（利用者の指示） ----------------

   きっかけ（アンカー）に「いつの日のものか」を持たせる。
     days  … 曜日 0=日 1=月 … 6=土
     weeks … 1〜4 と 5（＝最終）

   ■ 数え方は「その月の n 回目のその曜日」（利用者の判断）
   「2週目の火曜」＝ その月の2回目の火曜日。ゴミ収集日や定例会と同じ言い方。
   だから **weeks は days が決まって初めて意味を持つ**。
   曜日を選んでいないのに「2週目」だけ選ぶことはできない
   （normalizeSchedule が days 空のとき weeks を落とす）。

   「最終」は 4回目とは別物で、その曜日が5回ある月だけ違う日を指す。
     2026年9月（火曜が5回）: 1→9/1 2→9/8 3→9/15 4→9/22 最終→9/29

   ■ 空＝毎日
   days が空なら、いつでもその日。既定はこれ（今までのきっかけは全部これになる）。

   ■ 日の境目は 5時（DAY_CUTOFF_HOUR）
   ここだけ別の境目にすると、深夜1時に「昨日の曜日」と「今日の曜日」が食い違う。
   dayOf() と同じ引き算を通してから曜日を読む。

   ■ **過ぎた日のことは何も持たない**
   「予定の日だったのに着手しなかった」を表す状態を、どこにも作っていない。
   作れば必ずどこかに出したくなり、それは未処理の山になる（§0）。 */

const WEEK_LAST = 5;                       /* weeks の 5 は「最終」の意味 */
const WEEK_VALUES = [1, 2, 3, 4, WEEK_LAST];
const DAY_VALUES = [0, 1, 2, 3, 4, 5, 6];

/* 保存されうる値だけを通し、重複を落として昇順にそろえる。
   days が空なら weeks も空にする（上の「数え方」を見よ）。 */
function normalizeSchedule(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const pick = (arr, allowed) => {
    const seen = new Set();
    (Array.isArray(arr) ? arr : []).forEach(x => {
      const n = Number(x);
      if (allowed.indexOf(n) >= 0) seen.add(n);
    });
    return [...seen].sort((a, b) => a - b);
  };
  const days = pick(src.days, DAY_VALUES);
  const weeks = days.length ? pick(src.weeks, WEEK_VALUES) : [];
  return { days, weeks };
}

/* その epoch ms の「日」で、このきっかけの日か。
   at を省くといま。days が空なら常に true（毎日）。 */
function scheduleHits(sch, at) {
  const s = normalizeSchedule(sch);
  if (!s.days.length) return true;                       /* 毎日 */
  const ms = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  /* 5時までは前日として読む（dayOf と同じ引き算） */
  const d = new Date(ms - DAY_CUTOFF_HOUR * 3600 * 1000);
  if (s.days.indexOf(d.getDay()) < 0) return false;
  if (!s.weeks.length) return true;                      /* 毎週その曜日 */

  const date = d.getDate();
  /* その月で何回目のその曜日か。1日〜7日なら1回目、8〜14なら2回目… */
  const nth = Math.floor((date - 1) / 7) + 1;
  if (s.weeks.indexOf(nth) >= 0) return true;
  /* 「最終」= 7日後が翌月に入る＝その曜日はこれが月内で最後 */
  if (s.weeks.indexOf(WEEK_LAST) >= 0) {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (date + 7 > end) return true;
  }
  return false;
}

/* ---------------- 今日の海を日付ごとに持つ（利用者の指示） ----------------

   前は `t.today` という真偽値ひとつで、`rollover()` が毎朝それを全部falseにしていた
   （持ち越さないため）。＝ 昨日なにを置いたかは、どこにも残らなかった。

   いまは **`t.days`（'YYYY-MM-DD' の配列）が本体**。
     ・今日の海  … days に今日のキーが入っているもの
     ・過去の海  … その日のキーが入っているもの（消えずに残る）
     ・未来の海  … 先の日付のキーを入れておける

   **持ち越さない、は保たれている。**明日の海が空なのは、
   明日のキーを持つものがまだ無いからで、勝手に運ばれることはない。

   `t.today` は**残してあるが、days から作り直す控え**。
   画面（30か所）は今までどおり `t.today` を読めばよい。
   書き換えてよいのは syncTodayFlags() と setDay() だけ。 */

/* epoch ms を日付キーに。dayOf と同じ（5時までは前日） */
function dayKey(ms) { return dayOf(ms); }
function todayKey() { return dayOf(Date.now()); }

/* 'YYYY-MM-DD' の形だけを通す。それ以外は null（無い扱い） */
function dayKeyOrNull(v) {
  return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
}

/* 日付キーに n 日足した日付キー。**正午に寄せてから動かす**ので、
   夏時間の切り替え日でも日が飛ばない（recentDays と同じやり方）。
   形が違えば null。 */
function addDays(key, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  d.setDate(d.getDate() + (Math.floor(Number(n)) || 0));
  return ymd(d);
}

/* 日付キーに n か月足す。**月末は月の長さでつぶす**（1/31 の1か月後は 2/28）。
   setMonth は溢れたぶんを翌月へ回すので（1/31 + 1か月 = 3/3）、
   いったん1日へ落として月を動かし、その月の日数へ丸め直す。 */
function addMonths(key, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const dd = Number(m[3]);
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + (Math.floor(Number(n)) || 0), 1, 12, 0, 0, 0);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0).getDate();
  d.setDate(Math.min(dd, last));
  return ymd(d);
}

/* 'YYYY-MM-DD' の形だけを通し、重複を落として古い順にそろえる */
function normalizeDays(v) {
  const seen = new Set();
  (Array.isArray(v) ? v : []).forEach(x => {
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) seen.add(x);
  });
  return [...seen].sort();
}

/* days から t.today を作り直す。変わったものがあれば true */
function syncTodayFlags() {
  const k = todayKey();
  let changed = false;
  items.forEach(t => {
    const on = t.days.indexOf(k) >= 0;
    if (t.today !== on) { t.today = on; changed = true; }
  });
  return changed;
}

/* 今日を含む直近 n 日ぶんの日付キー。古い順。ちょうど n 件 */
function recentDays(n) {
  const count = Math.max(0, Math.floor(Number(n)) || 0);
  const base = new Date(Date.now() - DAY_CUTOFF_HOUR * 3600 * 1000);
  /* 正午に寄せてから日をずらす。夏時間の切り替え日でも日付が飛ばないように */
  base.setHours(12, 0, 0, 0);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}

/* --- アンカーの小道具 --- */

/* 外に渡すのは毎回作り直したコピー。中の配列を触られても壊れないように */
function anchorCopy(a) {
  return {
    id: a.id, name: a.name, hue: a.hue,
    /* 呼び手が並べ替えても内部が壊れないよう、配列は複製して渡す */
    days: a.days.slice(), weeks: a.weeks.slice(),
  };
}

function findAnchor(id) {
  return (typeof id === 'string' && anchorList.find(a => a.id === id)) || null;
}

/* 名前の正規化。前後の空白を落とす。空なら '' （＝受け付けない） */
function anchorName(raw) {
  return (raw === null || raw === undefined) ? '' : String(raw).trim();
}

/* 未使用の hue を若い順に1つ。3つとも埋まっていれば null。
   1件消したあとに足すと、空いた hue がここで再利用される */
function freeHue() {
  const used = new Set(anchorList.map(a => a.hue));
  for (let i = 0; i < HUES.length; i++) {
    if (!used.has(HUES[i])) return HUES[i];
  }
  return null;
}

/* --- タグの小道具 --- */

function tagCopy(t) {
  return { id: t.id, name: t.name, color: t.color, special: t.special, dir: t.dir };
}

function findTag(id) {
  return (typeof id === 'string' && tagList.find(t => t.id === id)) || null;
}

function isSpecialTag(id) { return TAG_SPECIAL.indexOf(id) >= 0; }

/* 色の正規化。#rgb / #rrggbb だけを通し、小文字の #rrggbb にそろえる。
   無彩色（r=g=b）は弾く——無彩色は「タグ無し」の意味に取ってあるので、
   タグの色に使うと「付いていない」と見分けが付かなくなる（追補3 §1）
   -> '#rrggbb' / null（受け付けない） */
function tagColor(raw) {
  const s = (raw === null || raw === undefined) ? '' : String(raw).trim().toLowerCase();
  let hex = null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) hex = '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
  else if (/^#[0-9a-f]{6}$/.test(s)) hex = s;
  if (!hex) return null;
  if (hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7)) return null;
  return hex;
}

/* 指定が無いときに配る色。並びの位置で決めるだけで、意味は無い。
   出どころは TAG_PALETTE 1か所（設定画面もここを読む） */
function nextTagHue(i) { return TAG_PALETTE[i % TAG_PALETTE.length]; }

/* その項目にそのタグが付いているか。
   特別なタグは既存のフラグをそのまま読む（タグ用の状態を別に持たない） */
function hasTag(t, tagId) {
  if (!t) return false;
  if (tagId === 'today') return !!t.today;
  if (tagId === 'plan') return !!t.plan;
  if (tagId === 'gap') return !!t.gap;
  if (tagId === 'done') return !!t.done;
  if (tagId === 'hold') return !!t.hold;
  return Array.isArray(t.tags) && t.tags.indexOf(tagId) >= 0;
}

/* ユーザーのタグの入れもの。無ければその場で作る
   （この版より前に作られた snapshot を restore() されても落ちないように） */
function tagBoxOf(t) {
  if (!t) return [];
  if (!Array.isArray(t.tags)) t.tags = [];
  return t.tags;
}

/* 引数のアンカー指定を started のキーに直す。
   null / undefined は「アンカー無し」。文字列以外は不正なので null を返す
   -> string（'' を含む）/ null（不正） */
function keyOf(anchorId) {
  if (anchorId === null || anchorId === undefined) return NO_ANCHOR_KEY;
  if (typeof anchorId !== 'string') return null;
  return anchorId;
}

/* --- 読み込み --- */

/* すきま時間の枠の一覧。保存データが無ければ既定の4つ。
   名前は変えられるので、保存された名前が正。id だけを既定と突き合わせる。
   色（hue）はアンカーと同じ持ち方——**個体に付く**ので、並べ替えても動かない。
   この版より前の保存データは hue を持たないので、並び順から配り直す */
function normalizeGapSlots(v) {
  const fresh = () => GAP_DEFAULTS.map(d => ({ id: d.id, name: d.name, hue: d.hue }));
  const arr = Array.isArray(v) ? v : null;
  if (!arr) return fresh();
  const out = [];
  const seen = new Set();
  arr.forEach(x => {
    if (!x || typeof x !== 'object') return;
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    const name = anchorName(x.name);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    /* hue を持たない旧データは、いまの並び順で先頭から配る（無ければ無彩色） */
    const hue = HUES.indexOf(x.hue) >= 0 ? x.hue
      : (out.length < HUES.length ? HUES[out.length] : null);
    out.push({ id, name, hue });
  });
  /* 保存データはあるが1つも読めなかった＝壊れている。既定で立て直す
     （空の一覧にすると、未分類しか無い画面になって置き場所が消える） */
  return out.length ? out : fresh();
}

/* すきまの枠で、まだ使われていない色。無ければ null（＝無彩色） */
function freeGapHue() {
  const used = new Set(gapList.map(g => g.hue));
  for (let i = 0; i < HUES.length; i++) if (!used.has(HUES[i])) return HUES[i];
  return null;
}

function findGapSlot(id) {
  return (typeof id === 'string' && gapList.find(g => g.id === id)) || null;
}

function normalizeAnchors(arr) {
  const out = [];
  const seen = new Set();
  arr.forEach(a => {
    if (!a || typeof a !== 'object') return;
    const id = typeof a.id === 'string' ? a.id.trim() : '';
    const name = anchorName(a.name);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    /* 日にちを持たない保存データ（この版より前）は、days/weeks 空＝毎日で立ち上がる */
    const sch = normalizeSchedule(a);
    out.push({
      id, name, hue: HUES.indexOf(a.hue) >= 0 ? a.hue : null,
      days: sch.days, weeks: sch.weeks,
    });
  });
  /* 色が空いていて、まだ持っていないものがあれば配る。
     色は3つしか無かったので、4つ目以降は null で保存されている——
     5つに増えた（利用者の指示）ぶんを、開いたときにそこへ渡す。
     すきまの枠と同じ規則。並び順で先頭から埋める */
  const used = new Set(out.map(a => a.hue).filter(h => h !== null));
  out.forEach(a => {
    if (a.hue !== null) return;
    const free = HUES.find(h => !used.has(h));
    if (free === undefined) return;
    a.hue = free;
    used.add(free);
  });
  return out;
}

/* タグ。特別なタグ4つは必ず先頭に、この順で作り直す（名前は固定）。
   保存されているのは色と向きだけを引き継ぐ。
   旧データ（tags が無い）なら、まるごと既定値で立ち上げる */
function normalizeTags(v) {
  const arr = Array.isArray(v) ? v : [];
  const kept = new Map();
  arr.forEach(x => {
    if (!x || typeof x !== 'object') return;
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    if (!id || kept.has(id)) return;
    kept.set(id, x);
  });

  const out = TAG_DEFAULTS.map(d => {
    const s = kept.get(d.id);
    return {
      id: d.id,
      name: d.name,                                   /* 名前は変えられない */
      color: (s && tagColor(s.color)) || d.color,
      /* 保存データにその行があるなら、向きは保存された値（外してあれば null）。
         行ごと無い＝旧データなので、既定の向きで立ち上げる */
      /* 固有枠のタグは、保存データに何が入っていてもその枠に戻す */
      dir: FIXED_DIRS[d.id]
        || (s ? (TAG_DIRS.indexOf(s.dir) >= 0 ? s.dir : null) : d.dir),
      special: true,
    };
  });

  /* 最初から置いてあるタグ。保存データに無ければ、既定の名前・色・向きで足す。
     消したものが毎回よみがえらないよう、「一度でも保存されたことがあるか」を
     removedStarters で覚えておく（消したら二度と勝手に戻らない）。 */
  TAG_STARTERS.forEach(d => {
    if (kept.has(d.id) || removedStarters.indexOf(d.id) >= 0) return;
    out.push({ id: d.id, name: d.name, color: d.color, dir: d.dir, special: false });
  });

  kept.forEach((x, id) => {
    if (isSpecialTag(id)) return;
    if (out.some(t => t.id === id)) return;      /* 上で足した starter は二重に入れない */
    const name = anchorName(x.name);
    if (!name) return;
    out.push({
      id,
      name,
      color: tagColor(x.color) || nextTagHue(out.length),
      dir: TAG_DIRS.indexOf(x.dir) >= 0 ? x.dir : null,
      special: false,
    });
  });

  /* 1向き1タグ。同じ向きを名乗るものが複数あったら、先に出てきたほうだけ残す */
  const taken = new Set();
  out.forEach(t => {
    if (!t.dir) return;
    if (taken.has(t.dir)) t.dir = null;
    else taken.add(t.dir);
  });
  return out;
}

/* 横一列に並ぶ海（タグの id。左から順）。
   中央（タグ無し）は列の左端で、この配列には入らない。上下の固有枠も入らない。

   **古い保存データからの引き継ぎ**：前は tag.dir が 'left' / 'right' の2枠だった。
   seas が保存されていなければ、左→右の順でこの配列に移す（見え方が変わらない）。 */
function normalizeSeas(raw, tags) {
  const known = new Set(tags.filter(t => !FIXED_DIRS[t.id]).map(t => t.id));
  const out = [];
  const add = id => {
    if (typeof id !== 'string' || !known.has(id)) return;
    if (out.indexOf(id) >= 0) return;
    if (out.length >= MAX_SEAS) return;
    out.push(id);
  };
  if (Array.isArray(raw)) { raw.forEach(add); return out; }
  /* 旧データ。dir から拾う（左→右） */
  TAG_DIRS.forEach(d => {
    const t = tags.find(x => x.dir === d);
    if (t) add(t.id);
  });
  return out;
}

/* 保存済みのタグに、いまのパレットの色を配り直す。
   ・特別な4つ … TAG_DEFAULTS の色をそのまま
   ・ユーザーのタグ … 作られた順に TAG_PALETTE を頭から（余ったら先頭へ戻る）

   「順に配る」のは、色が付いた元の規則と同じ。だから並びが変わらないかぎり、
   配り直しても各タグの色は同じ位置の新しい色に落ちる（総入れ替えにならない）。
   load() が世代のずれを見つけたときに1回だけ呼ぶ。 */
function repaintTags(tags) {
  let i = 0;
  tags.forEach(t => {
    if (t.special) {
      const d = TAG_DEFAULTS.find(x => x.id === t.id);
      if (d) t.color = d.color;
      return;
    }
    t.color = nextTagHue(i++);
  });
  return tags;
}

/* started のキーは「いまぶら下がっているアンカー」か '' だけを通す。
   '' （アンカー無しで始めた）は today とは無関係に読む。海のバブルでも
   すきま時間の枠でも、きっかけの未分類でも着手は記録できるので、
   today:false というだけで保存済みの記録を落とすと、開き直した瞬間に消える */
function normalizeStarted(v, anchors) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  anchors.forEach(id => {
    const n = Number(v[id]);
    if (Number.isFinite(n)) out[id] = n;
  });
  const n = Number(v[NO_ANCHOR_KEY]);
  if (Number.isFinite(n)) out[NO_ANCHOR_KEY] = n;
  return out;
}

/* --- 一手の記録 --- */

/* did / next の正規化。前後の空白を落とす。空文字も通す
   （両方空のときに積まないのは commitStep の側で見る） */
function stepText(raw) {
  return (raw === null || raw === undefined) ? '' : String(raw).trim();
}

/* 外に渡すのは毎回作り直したコピー（log() と同じ扱い）。
   中身を書き換えられても、積んだ記録が壊れないように */
function stepCopy(e) { return { at: e.at, did: e.did, next: e.next }; }

/* 積み上がった記録の正規化。at が読めない行だけを落とす。
   log と違って時刻では並べ替えない——保存された並びがそのまま「積んだ順」なので、
   同じミリ秒に2件積まれても書いた順のまま読める */
function normalizeSteps(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(e => e && typeof e === 'object' && Number.isFinite(Number(e.at)))
    .map(e => ({ at: Number(e.at), did: stepText(e.did), next: stepText(e.next) }));
}

/* 書きかけ。形が違えば空の下書きに倒す */
function normalizeDraft(v) {
  const o = (v && typeof v === 'object') ? v : {};
  return { did: stepText(o.did), next: stepText(o.next) };
}

function normalizeTodo(t, anchorIds, tagIds, gapSlotIds, migrateDay) {
  /* 長期保留。旧データには無いので false から始まる。
     holdUntil は「この日に海へ戻る」日付キー。null なら自分で外すまでそのまま。
     長期保留でないものが日付だけ持っていても意味が無いので、そこは落とす */
  const hold = !!t.hold;
  const holdUntil = hold ? dayKeyOrNull(t.holdUntil) : null;
  /* days が本体。無い保存データ（この版より前）は today:true のぶんだけ、
     その時点の日（保存されていた lastDay）へ移す。
     lastDay が過去なら、読み込んだ瞬間に today は false になる——
     前の版の rollover() が朝に落としていたのと同じ結果で、勝手には増やさない */
  let days = normalizeDays(t.days);
  if (!Array.isArray(t.days) && t.today) days = normalizeDays([migrateDay || todayKey()]);
  const today = days.indexOf(todayKey()) >= 0;
  const gap = !!t.gap;
  const done = !!t.done;
  /* 旧データには無い。無ければ「消していない」。
     done と同じ形で持つ（真偽＋時刻）。両方立つこともある（完了したものを消した） */
  const trashed = !!t.trashed;
  const slots = (today && Array.isArray(t.slots))
    ? t.slots.filter((x, i, arr) => SLOTS.indexOf(x) >= 0 && arr.indexOf(x) === i)
    : [];
  /* アンカーは today とは独立。today:false でもぶら下がったまま残る。
     いま存在しないアンカーの id は落とす（消したアンカーの残りかす） */
  const anchors = Array.isArray(t.anchors)
    ? t.anchors.filter((x, i, arr) => anchorIds.has(x) && arr.indexOf(x) === i)
    : [];
  const anchorAt = {};
  if (t.anchorAt && typeof t.anchorAt === 'object') {
    anchors.forEach(id => {
      const n = Number(t.anchorAt[id]);
      if (Number.isFinite(n)) anchorAt[id] = n;
    });
  }
  /* すきま時間の枠。**配列**（利用者の指示で複数ぶら下げられるようになった）。
     前の版は単数の gapSlot だったので、そこからも読む——
     旧データを開いたとき、入っていた枠がそのまま1件の配列になる。
     消した枠の id は落とす（anchors とまったく同じ扱い） */
  const rawGap = Array.isArray(t.gapSlots) ? t.gapSlots
    : (typeof t.gapSlot === 'string' && t.gapSlot ? [t.gapSlot] : []);
  const gapSlots = gap
    ? rawGap.filter((x, i, arr) => gapSlotIds.has(x) && arr.indexOf(x) === i)
    : [];
  const gapAt = {};
  if (t.gapAt && typeof t.gapAt === 'object') {
    gapSlots.forEach(id => {
      const n = Number(t.gapAt[id]);
      if (Number.isFinite(n)) gapAt[id] = n;
    });
  }
  return {
    id: typeof t.id === 'string' ? t.id : uid(),
    text: t.text,
    /* days が本体。today はそこから作った控え（画面はこちらを読む） */
    days,
    today,
    hold,
    holdUntil,
    createdAt: Number(t.createdAt) || Date.now(),
    fx: clamp01(t.fx, 0.5),
    fy: clamp01(t.fy, 0.5),
    /* 旧データには無い。無ければ空で入れる。
       today:false なら時間帯タグには入っていないのが正なので、そこも揃える */
    slots,
    anchors,
    anchorAt,
    started: normalizeStarted(t.started, anchors),
    /* あとから足したフィールド。旧データには無いので既定値で埋める。
       url は保存済みの値も読むたびに検証し直す（別経路で危ないものが
       入っていた場合に、画面へ渡さないため） */
    firstStep: typeof t.firstStep === 'string' ? t.firstStep.trim() : '',
    url: safeUrl(t.url) || '',
    gap,
    /* 枠は**配列**（利用者の指示で複数ぶら下げられるようになった）。
       前の版は単数の gapSlot だったので、そこからも読み込む。
       gap:false なら枠には入っていないのが正なので、そこも揃える。
       いま存在しない枠の id は落とす（消した枠の残りかす。anchors と同じ扱い） */
    gapSlots,
    /* 枠の中の並び順。アンカーの anchorAt と同じ持ち方 */
    gapAt,
    plan: !!t.plan,
    /* 旧データには無い。無ければ空の配列 / 空の下書き。
       today や gap と違い、どの軸とも連動しない（消える条件を持たない） */
    steps: normalizeSteps(t.steps),
    draft: normalizeDraft(t.draft),
    /* 旧データには無い。無ければ空。
       特別なタグの id は入れない（あれは today / plan / gap / done がそのまま実体で、
       ここに書くと同じ状態を2か所に持つことになる）。
       いま存在しないタグの id は落とす（消したタグの残りかす。anchors と同じ扱い） */
    tags: Array.isArray(t.tags)
      ? t.tags.filter((x, i, arr) => tagIds.has(x) && !isSpecialTag(x) && arr.indexOf(x) === i)
      : [],
    done,
    doneAt: (done && Number.isFinite(Number(t.doneAt))) ? Number(t.doneAt) : null,
    trashed,
    trashedAt: (trashed && Number.isFinite(Number(t.trashedAt))) ? Number(t.trashedAt) : null,
  };
}


function normalizeTodos(arr, anchors, tags, gapSlots, migrateDay) {
  const ids = new Set(anchors.map(a => a.id));
  const tagIds = new Set((tags || []).map(t => t.id));
  const gapIds = new Set((gapSlots || []).map(g => g.id));
  const list = arr.filter(t => t && typeof t.text === 'string')
    .map(t => normalizeTodo(t, ids, tagIds, gapIds, migrateDay));
  /* 通し番号を復元する。保存済みの最大値の次から続ける。
     番号を持っていないもの（この版より前に付けたぶら下げ）は、
     いまの並び順のまま後ろへ足していく。
     アンカーとすきまの枠は**同じ番号の列**を使う（順番さえ付けばよいので、
     2本持つと復元も2本ぶん要る） */
  let max = 0;
  list.forEach(t => Object.keys(t.anchorAt).forEach(k => {
    if (t.anchorAt[k] > max) max = t.anchorAt[k];
  }));
  list.forEach(t => Object.keys(t.gapAt).forEach(k => {
    if (t.gapAt[k] > max) max = t.gapAt[k];
  }));
  seq = max + 1;
  list.forEach(t => t.anchors.forEach(id => {
    if (!Number.isFinite(t.anchorAt[id])) t.anchorAt[id] = seq++;
  }));
  return list;
}

/* ログの slot は「そのときのアンカーの id」。null（アンカー無し）も許す。
   いま存在しないアンカーの id もそのまま残す——消したアンカーの記録を、
   slotName（当時の名前）と一緒に読めるようにしておくため */
function normalizeLog(arr) {
  return arr
    .filter(e => e && typeof e.id === 'string'
      && (e.slot === null || typeof e.slot === 'string')
      && Number.isFinite(Number(e.at)))
    .map(e => ({
      id: e.id,
      text: typeof e.text === 'string' ? e.text : '',
      slot: (typeof e.slot === 'string' && e.slot) ? e.slot : null,
      slotName: typeof e.slotName === 'string' ? e.slotName : '',
      at: Number(e.at),
    }))
    .sort((a, b) => a.at - b.at);
}

/* started は必ずあるはずだが、外から作った snapshot を restore() された場合などに
   備えて、読むときは空扱いにしておく */
function startedOf(t) {
  return (t && t.started && typeof t.started === 'object') ? t.started : {};
}

/* 同じく、ぶら下げた順の入れもの。無ければその場で作る */
function anchorAtOf(t) {
  if (!t) return {};
  if (!t.anchorAt || typeof t.anchorAt !== 'object') t.anchorAt = {};
  return t.anchorAt;
}

/* 同じく、積み上がった記録と書きかけの入れもの。無ければその場で作る
   （この版より前に作られた snapshot を restore() されても落ちないように） */
function stepListOf(t) {
  if (!t) return [];
  if (!Array.isArray(t.steps)) t.steps = [];
  return t.steps;
}

function draftBoxOf(t) {
  if (!t) return { did: '', next: '' };
  if (!t.draft || typeof t.draft !== 'object') t.draft = { did: '', next: '' };
  return t.draft;
}

/* ぶら下げた順。番号が無いものは末尾に回す */
/* 消えた枠の残りかすを落とす。並び順の番号も一緒に落とす */
function dropDeadGapSlots(t) {
  if (!t || !Array.isArray(t.gapSlots)) return;
  t.gapSlots.filter(id => !findGapSlot(id)).forEach(id => {
    t.gapSlots = t.gapSlots.filter(x => x !== id);
    delete gapAtOf(t)[id];
  });
}

/* ぶら下げた順の入れもの（すきま時間の枠ぶん）。無ければその場で作る */
function gapAtOf(t) {
  if (!t) return {};
  if (!t.gapAt || typeof t.gapAt !== 'object') t.gapAt = {};
  return t.gapAt;
}

/* 枠の中でぶら下げた順。番号が無いものは末尾に回す */
function gapOrderIn(t, slotId) {
  const n = Number(gapAtOf(t)[slotId]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function orderIn(t, anchorId) {
  const n = Number(anchorAtOf(t)[anchorId]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/* 「今日する」に入れた記録。集計を期間で数えるために要る（todays() は現在値なので使えない） */
function normalizeTodayLog(arr) {
  return arr
    .filter(e => e && typeof e.id === 'string' && Number.isFinite(Number(e.at)))
    .map(e => ({
      id: e.id, text: typeof e.text === 'string' ? e.text : '', at: Number(e.at),
      /* どの日のぶんか。古い記録には無いので、そのときは省く（読む側が at から出す） */
      day: /^\d{4}-\d{2}-\d{2}$/.test(e.day) ? e.day : undefined,
    }))
    .sort((a, b) => a.at - b.at);
}

function blank() {
  const tags = normalizeTags(null);
  return {
    anchors: [], gapSlots: normalizeGapSlots(null), tags,
    seas: normalizeSeas(null, tags),
    todos: [], logs: [], todayLogs: [], lastDay: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    /* 旧形式（配列そのもの）。todos として取り込み、ログ無しで移行する */
    if (Array.isArray(parsed)) {
      const tags = normalizeTags(null);
      const gaps = normalizeGapSlots(null);
      return {
        anchors: [], gapSlots: gaps, tags, seas: normalizeSeas(null, tags),
        todos: normalizeTodos(parsed, [], tags, gaps),
        logs: [], todayLogs: [], lastDay: null,
      };
    }
    if (!parsed || typeof parsed !== 'object') return blank();
    /* anchors が無い保存データ（この版より前）は、空のまま読む。
       時間帯タグ（slots）はそのまま残るので、移し替えるものは無い */
    const anchors = Array.isArray(parsed.anchors) ? normalizeAnchors(parsed.anchors) : [];
    /* 消された starter を先に復元してから正規化する（normalizeTags がこれを見る） */
    removedStarters = Array.isArray(parsed.removedStarters)
      ? parsed.removedStarters.filter(x => typeof x === 'string') : [];
    /* tags が無い保存データ（この版より前）は、特別なタグ4つを既定値で立てる */
    let tags = normalizeTags(parsed.tags);
    /* パレットを差し替えた版。保存データは古い色を持ったままなので、ここで配り直す。
       これをしないと、新しく作ったタグだけ新しい色になり、前からあるタグは古い色のまま
       混ざる（＝「パステルに統一」が保存データの上では起きない） */
    if (Number(parsed.palVer) !== PAL_VER) tags = repaintTags(tags);
    /* すきま時間の枠。無い保存データ（この版より前）は既定の4つで立ち上がる。
       項目側は単数の gapSlot からその4つへ移る（normalizeTodo） */
    const gapSlots = normalizeGapSlots(parsed.gapSlots);
    return {
      anchors,
      gapSlots,
      tags,
      /* 海の並び。無い保存データ（この版より前）は tag.dir から移す */
      seas: normalizeSeas(parsed.seas, tags),
      /* 移行用の日付＝保存されていた lastDay。過去なら読み込んだ瞬間に today が外れる */
      todos: Array.isArray(parsed.todos)
        ? normalizeTodos(parsed.todos, anchors, tags, gapSlots,
            /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastDay) ? parsed.lastDay : null)
        : [],
      logs: Array.isArray(parsed.log) ? normalizeLog(parsed.log) : [],
      todayLogs: Array.isArray(parsed.todayLog) ? normalizeTodayLog(parsed.todayLog) : [],
      lastDay: /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastDay) ? parsed.lastDay : null,
    };
  } catch (e) {
    /* 壊れた保存データで起動不能にしない */
    return blank();
  }
}

/* 保存に失敗したことを知りたい人（いまは app.js だけ）。
   store は UI を知らないので、文言も出し方も向こうに任せる。 */
const saveErrorListeners = new Set();
let lastSaveError = null;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 2, palVer: PAL_VER, anchors: anchorList, gapSlots: gapList, tags: tagList,
      seas: seaList, todos: items,
      removedStarters,
      log: logs, todayLog: todayLogs, lastDay,
    }));
    lastSaveError = null;
  } catch (e) {
    /* 落とさないのは前と同じ。**ただし黙らない**（B-4）。

       ここは容量超過（QuotaExceededError）がいちばん起きやすい。
       前は握り潰していたので、**書いたものが保存されていないのに
       画面はふつうに動き続け、次に開いたときだけ消えている**という壊れ方をした。
       いちばん最初に当たるのは、長く使った項目の一手の記録と、完了の海。

       上限を作って古い記録を間引く手もあるが、それは
       「記録として残し続ける」という前提に触るので、勝手にはやらない。
       ここでは「保存できなかった」ことを外へ出すところまで。 */
    lastSaveError = e;
    saveErrorListeners.forEach(fn => { try { fn(e); } catch (_) { /* 通知で落とさない */ } });
  }
}

function emit() {
  listeners.forEach(fn => fn());
}

/* 日が変わったら、今日する枠に入っていたものを着手の有無に関係なく海へ戻す。
   持ち越さないのがこのアプリの前提。やらなかったものを翌日に積み上げない。

   消えるのは today / slots（時間帯タグ）/ started（はじめた記録）の3つ。
   アンカー（anchors）は消さない。あれは「立てっぱなしの計画」で、
   今日やったかどうかとは関係が無いため。started は毎日まっさらに戻る。
   すきま時間（gap / gapSlots）も消さない。すきま時間は今日の予定とは別に訪れる。
   きっかけの画面に置いたもの（plan）も同じ理由で消さない。
   一手の記録（steps）と書きかけ（draft）にも触らない。あれは「前回どこまでやったか」で、
   今日やるかどうかとは別の軸。日をまたいだ翌朝こそ読みたいものなので消さない。
   タグ（tags）と完了（done）にも触らない。タグは立てっぱなしの分類で、
   完了は取り消せるところに置いておくもの。どちらも今日の予定とは別の軸。
   消した項目（墓石）にも触らない。あれは「消した時点の姿」を残しておくものなので、
   日をまたいだくらいで中身を書き換えない。 */
function rollover() {
  const day = dayOf(Date.now());
  if (lastDay === day) return 0;
  /* lastDay が無い＝旧形式からの移行直後。いつのぶんか判らないので、
     この一回だけは戻さずに今日として引き継ぐ（勝手に消さないことを優先） */
  const first = lastDay === null;
  let n = 0;
  let changed = false;
  if (!first) {
    items.forEach(t => {
      if (t.trashed) return;                 /* 墓石には触らない */
      /* **days は消さない。**その日の海はその日の記録として残る（利用者の指示）。
         「持ち越さない」は保たれている——明日の海が空なのは、
         明日のキーを持つものがまだ無いからで、勝手に運ばれることはない。
         昨日ぶんが n（海へ戻した件数）に数えられていたが、
         もう戻さないので数えるものが無い（n は 0 のまま） */
      if (t.slots.length) { t.slots = []; changed = true; }   /* 時間帯は today の中の軸 */
      /* 今日する枠の外でも、アンカーからは始められる。
         そのぶんの記録もここで落とす */
      if (Object.keys(startedOf(t)).length) {
        t.started = {};
        changed = true;
      }
    });
  }
  /* today は days から作り直す（日が変わったので、昨日ぶんは自然に外れる） */
  if (syncTodayFlags()) changed = true;
  lastDay = day;
  persist();
  if (changed) emit();
  /* 戻り値は「海へ戻した件数」だった。日付ごとに持つようになって
     **戻す動作そのものが無くなった**ので、いつでも 0。
     呼んでいるのは review.js / plan.js の2か所だけで、どちらも戻り値を見ていない。 */
  return n;
}

{
  const data = load();
  anchorList = data.anchors;
  gapList = data.gapSlots;
  tagList = data.tags;
  seaList = data.seas;
  items = data.todos;
  logs = data.logs;
  todayLogs = data.todayLogs;
  lastDay = data.lastDay;
  rollover();
}

/* 生きている項目か。消した項目（墓石 trashed:true）は、
   「いま生きているもの」を返す問い合わせから全部外れる。
   完了（done）と違って all() にも count() にも出ない——
   画面が all() を並べる場所（海の「ならべる」など）に墓石を混ぜないため */
function isLive(t) { return !!t && !t.trashed; }

/* 墓石も含めた全件から id で引く。remove / untrash / restore の内部だけが使う。
   外向きの get() は墓石を null で返す（消したものは画面から見えない） */
function findAny(id) {
  return items.find(t => t.id === id) || null;
}

export const store = {
  /* --- 読み ---
     完了（done）したものは「いま生きているもの」を返す問い合わせからは全部外れる。
     消えたのではなく完了の海へ移っただけなので、all() と doneItems() には出る。

     消した（trashed）ものは all() からも外れる。どこにも見えない。
     全件を見るのは allIncludingTrashed() / trashedItems() だけ */
  all()      { return items.filter(isLive); },

  /* 墓石も含めた全件。画面はここを読まない。
     「内部メタデータを操作しない限り戻せる」の、その内部側の口 */
  allIncludingTrashed() { return items.slice(); },
  /* 海を漂うもの。次のものは出さない：
     ・「今日する」に入れたもの
     ・「すきま時間に」へ入れたもの
     ・きっかけにぶら下げたもの（立てっぱなしの計画であって、思いつきの海ではない）
     ・きっかけの画面へ入れたもの（まだアンカーが決まっていない未分類も、海には戻さない。
       ここを外すと、きっかけの未分類に置いたものが海にも二重に出る）
     ・完了したもの（完了の海にだけ出す）
     いずれも必要ならユーザーがまた書けばいい、という前提 */
  floating() {
    return items.filter(t => isLive(t) && !t.done && !t.today && !t.gap && !t.plan
      && !(Array.isArray(t.anchors) && t.anchors.length));
  },
  todays()   { return items.filter(t => isLive(t) && t.today && !t.done); },
  /* 消したもの（墓石）は無いものとして扱う。remove() が項目を配列から取り除いていた
     ころと同じで、消したあとの get() は null。
     これで setToday / setSlot / complete / start ... の書き込み口も、
     墓石には一切効かなくなる（消したものが裏で書き換わらない） */
  get(id)    { return items.find(t => t.id === id && isLive(t)) || null; },
  /* 書いたものの総数。完了したものも含む（消えていないので）。all() と数が合う。
     消したものは含まない */
  count()    { return items.reduce((n, t) => n + (isLive(t) ? 1 : 0), 0); },

  /* --- 書き --- */
  /* opts = { fx, fy, today }
     today:true なら漂わせずに最初から「今日する」枠へ入れる。
     fx/fy は枠から戻したときの浮上位置に使うので、指定が無くても必ず入れておく。 */
  add(text, opts) {
    const body = String(text).trim();
    if (!body) return null;
    const o = opts || {};
    const t = {
      id: uid(),
      text: body,
      /* days が本体。today:true で作るときは今日のキーを1つ入れる */
      days: o.today ? [todayKey()] : [],
      today: !!o.today,
      hold: false,
      holdUntil: null,
      createdAt: Date.now(),
      fx: Number.isFinite(o.fx) ? o.fx : 0.2 + Math.random() * 0.6,
      fy: Number.isFinite(o.fy) ? o.fy : 0.2 + Math.random() * 0.5,
      slots: [],
      anchors: [],
      anchorAt: {},
      started: {},
      firstStep: '',
      url: '',
      gap: false,
      gapSlots: [],
      gapAt: {},
      plan: false,
      steps: [],
      draft: { did: '', next: '' },
      tags: [],
      done: false,
      doneAt: null,
      trashed: false,
      trashedAt: null,
    };
    items.push(t);
    /* 「今日する」枠に直接書いた場合も「入れた」記録に残す（setToday を通らない経路） */
    if (t.today) todayLogs.push({ id: t.id, text: t.text, at: t.createdAt });
    persist(); emit();
    return t;
  },

  /* 消す。項目は配列から取り除かず、消した印（trashed）を立てるだけ（墓石）。
     「表示上は完全に消しているが、基本は記録として残し続ける」ため（利用者の指示）。

     画面からは完全に消える：get() は null を返し、
     「いま生きているもの」を返す問い合わせからは全部外れる。
     完了（done）と違って UI から戻す道は作らない——
     戻せるのは localStorage を直接いじるか、コンソールから untrash() を叩いたときだけ。

     着手のログ（log）も一手の記録（steps）も消さない
     （過去に着手したことは事実なので）。

     戻り値の形は今までどおり { item, index }。トーストの「元に戻す」は
     これをそのまま restore() へ渡せばよい。index は消した時点の並び位置で、
     いまは項目が動かないので restore() 側では使われない（形を変えないために残す）。
     -> { item, index } / null（id が無い・もう消してある） */
  remove(id) {
    const i = items.findIndex(t => t.id === id && isLive(t));
    if (i < 0) return null;
    const t = items[i];
    t.trashed = true;
    t.trashedAt = Date.now();
    persist(); emit();
    return { item: t, index: i };
  },

  /* --- 墓石（消したもの） ---
     画面はこの3つを呼ばない。消したものを見る／戻すための内部の口で、
     コンソールから store を叩くときにだけ使う */

  isTrashed(id) {
    const t = findAny(id);
    return !!(t && t.trashed);
  },

  /* 消したものの一覧。新しい順（消した時刻の降順）。
     時刻を持っていない古いデータは、書いた時刻で並べる（doneItems と同じ扱い） */
  trashedItems() {
    return items.filter(t => t.trashed)
      .sort((a, b) => (b.trashedAt || b.createdAt || 0) - (a.trashedAt || a.createdAt || 0));
  },

  /* 墓石を掘り起こす。並び位置は動かない（消しても動かしていないので）
     -> 変化したか */
  untrash(id) {
    const t = findAny(id);
    if (!t || !t.trashed) return false;
    t.trashed = false;
    t.trashedAt = null;
    /* 消している／完了している間に枠そのものが消されていることがある。
       残りかすを落とす（アンカーの下と同じ扱い。1枠1件だった頃の
       「押し出し」はもう無い——枠には何個でもぶら下がるので） */
    dropDeadGapSlots(t);
    persist(); emit();
    return true;
  },

  /* --- 完了 ---
     完了は「消す」ではない。項目は残したまま done を立てて、完了の海へ移す。
     消さないのは、完了の海から出せば元に戻せるようにするため（追補3 §3）。
     ログには何も積まない——ふりかえりに出す件数は doneItems から数えるので、
     出来事のログを増やす必要が無い（log の形は変えない）。
     done:true のものは floating / todays / inAnchor / gapItems ... からは外れる。
     音を鳴らす／鳴らさないの分岐は、従来どおり画面側にある */

  /* -> 完了になった項目 / null（id が無い）。既に完了なら何も書かずにその項目を返す */
  complete(id) {
    const t = store.get(id);
    if (!t) return null;
    if (t.done) return t;
    t.done = true;
    t.doneAt = Date.now();
    persist(); emit();
    return t;
  },

  /* 完了の海から出す。タグ（today / gap / plan / ユーザーのタグ）はそのまま残っているので、
     出せば元居た場所へ戻る -> 変化したか */
  uncomplete(id) {
    const t = store.get(id);
    if (!t || !t.done) return false;
    t.done = false;
    t.doneAt = null;
    /* 消している／完了している間に枠そのものが消されていることがある。
       残りかすを落とす（アンカーの下と同じ扱い。1枠1件だった頃の
       「押し出し」はもう無い——枠には何個でもぶら下がるので） */
    dropDeadGapSlots(t);
    persist(); emit();
    return true;
  },

  isDone(id) {
    const t = store.get(id);
    return !!(t && t.done);
  },

  /* 完了の海の中身。新しい順（完了した時刻の降順）。
     時刻を持っていない古いデータは、書いた時刻で並べる */
  doneItems() {
    return items.filter(t => isLive(t) && t.done)
      .sort((a, b) => (b.doneAt || b.createdAt || 0) - (a.doneAt || a.createdAt || 0));
  },

  /* 直近 days 日（今日を含む）に完了した件数。件数だけ。分母は持たない */
  doneCount(days) {
    const set = new Set(recentDays(days));
    return items.reduce((n, t) =>
      n + ((isLive(t) && t.done && Number.isFinite(t.doneAt) && set.has(dayOf(t.doneAt))) ? 1 : 0), 0);
  },

  /* remove() の戻り値をそのまま渡すと元に戻る。
     消している間にアンカーが消されていることがあるので、そこだけ拾い直す。

     complete() が項目を消さなくなったので、戻り値の形も変わった（{item,index} ではなく項目）。
     取り消しの経路を1つに保つために、ここは「項目そのもの」を渡されても受ける：
     ・まだ一覧に居る（＝完了しただけ）なら uncomplete() と同じ
     ・一覧に居ない（外から持ってきた項目）なら末尾へ入れ直す
     消す→取り消す の経路（{item,index}）は今までどおり動く。

     remove() が項目を配列から取り除かなくなった（墓石になった）ので、
     {item,index} の経路も「掘り起こす」に変わった。項目はもう一覧に居るので、
     入れ直すと二重になる。並び位置も動いていないので index は使わない。 */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.item) {
      if (typeof snapshot.id !== 'string' || typeof snapshot.text !== 'string') return false;
      /* 消してある（墓石）なら、この取り消しはもう効かない。
         完了の取り消しの経路であって、消したものを戻す経路ではないため */
      if (store.isTrashed(snapshot.id)) return false;
      const cur = store.get(snapshot.id);
      if (cur) { store.uncomplete(cur.id); return true; }
      return store.restore({ item: snapshot, index: items.length });
    }
    const t = snapshot.item;
    /* 完了したまま消したものを戻すときは、完了のまま戻す（勝手に取り消さない） */
    t.done = !!t.done;
    if (!t.done) t.doneAt = null;
    /* 消している間にタグが消されていることがある。残りかすは落とす（anchors と同じ扱い） */
    if (Array.isArray(t.tags)) {
      t.tags = t.tags.filter(id => !isSpecialTag(id) && findTag(id));
    }
    /* 消している／完了している間に枠そのものが消されていることがある。
       残りかすを落とす（アンカーの下と同じ扱い。1枠1件だった頃の
       「押し出し」はもう無い——枠には何個でもぶら下がるので） */
    dropDeadGapSlots(t);
    if (Array.isArray(t.anchors)) {
      t.anchors.filter(id => !findAnchor(id)).forEach(id => {
        t.anchors = t.anchors.filter(x => x !== id);
        delete anchorAtOf(t)[id];
        delete startedOf(t)[id];
      });
    }
    /* もう一覧に居るなら（remove が墓石にしただけなら）掘り起こすだけ。
       入れ直すと同じ項目が2つになる */
    if (items.indexOf(t) >= 0) {
      t.trashed = false;
      t.trashedAt = null;
      persist(); emit();
      return true;
    }
    /* 同じ id の別の項目が既に居るなら、二重には入れない */
    if (findAny(t.id)) return false;
    const at = Math.min(Math.max(0, snapshot.index | 0), items.length);
    items.splice(at, 0, t);
    persist(); emit();
    return true;
  },

  /* --- 日付ごとの海（利用者の指示） --- */

  /* 今日の日付キー。画面はこれを起点に前後の日を作る */
  todayKey,
  /* epoch ms の日付キー（5時までは前日） */
  dayKey,

  /* その項目が置かれている日（古い順）。コピーを返す */
  daysOf(id) {
    const t = store.get(id);
    return t ? t.days.slice() : [];
  },

  /* その日の海。完了したものも**含める**——過去はその日の記録なので、
     済ませたものを抜くと「置いたのに消えた」ように見える。
     消したもの（墓石）だけは出さない。 */
  itemsOnDay(key) {
    if (typeof key !== 'string') return [];
    return items.filter(t => isLive(t) && t.days.indexOf(key) >= 0);
  },

  /* 置く／外す。過去でも未来でも同じ口を使う。
     -> 変わったか（無い項目・変な日付・すでにその状態なら false） */
  setDay(id, key, on) {
    const t = store.get(id);
    if (!t || typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const has = t.days.indexOf(key) >= 0;
    if (has === !!on) return false;
    t.days = on ? normalizeDays(t.days.concat(key)) : t.days.filter(d => d !== key);
    const wasToday = t.today;
    t.today = t.days.indexOf(todayKey()) >= 0;
    /* 今日から外れたときだけ、時間帯タグを落とす（あれは today の中の軸） */
    if (wasToday && !t.today) t.slots = [];
    /* ログには「いつ決めたか（at）」と「どの日のぶんか（day）」の両方を残す。
       未来の日に置いたとき、決めた日で数えると期間の集計がずれるため */
    if (on) todayLogs.push({ id: t.id, text: t.text, at: Date.now(), day: key });
    persist(); emit();
    return true;
  },

  /* --- 長期保留（利用者の指示） ---
     いつかやるが、いまは目に入れたくないもの。上の海に集まる。
     **どの海からも既定では出さない**（外すのは画面側の仕事。ここは印を持つだけ）。
     完了とは別物——完了は「終わった」、長期保留は「まだ終わっていないが、いまは見ない」。 */
  /* until を渡すと、戻ってくる日も一緒に決める。
       'YYYY-MM-DD' … その日に海へ戻る
       null         … 日を決めない（自分で外すまでそのまま）
       省略         … いまの日をそのまま持ち越す
     外すとき（on=false）は日も必ず落とす。外れているのに日だけ残ると、
     次に長期保留にしたときへ古い日が漏れる。 */
  setHold(id, on, until) {
    const t = store.get(id);
    if (!t) return false;
    const next = !!on;
    const key = !next ? null
      : (until === undefined ? (t.holdUntil || null) : dayKeyOrNull(until));
    if (t.hold === next && (t.holdUntil || null) === key) return false;
    t.hold = next;
    t.holdUntil = key;
    persist(); emit();
    return true;
  },

  isHold(id) {
    const t = store.get(id);
    return !!(t && t.hold);
  },

  /* 戻ってくる日。決めていなければ null。長期保留でなければ常に null */
  holdUntil(id) {
    const t = store.get(id);
    return (t && t.hold && t.holdUntil) || null;
  },

  /* 戻ってくる日だけを付け替える。長期保留でないものには付かない
     （付くと、外れているのに日だけ在る状態が作れてしまう） */
  setHoldUntil(id, key) {
    const t = store.get(id);
    if (!t || !t.hold) return false;
    const k = dayKeyOrNull(key);
    if ((t.holdUntil || null) === k) return false;
    t.holdUntil = k;
    persist(); emit();
    return true;
  },

  /* 今日から n 日後の日付キー。画面が「1週間」「1か月」を日付に直すのに使う。
     日付の作り方を画面ごとに書かないための1か所（5時の境目もここに入っている） */
  dayAfter(n) { return addDays(todayKey(), n); },

  /* 今日から n か月後。月末はつぶれる（1/31 の1か月後は 2/28） */
  monthAfter(n) { return addMonths(todayKey(), n); },

  /* --- 戻ってくる日を過ぎたものを、海へ戻す ---

     **静かに戻す。**「期限切れ」も「◯日放置」も出さない（README の禁止事項）。
     戻ってきたという事実だけを、呼び手がひとこと言えるように配列で返す。

     日の境目は 5時（DAY_CUTOFF_HOUR）で、todayKey() と同じ。
     「9月15日に戻る」なら、9月15日の5時を回った時点で戻る。
     過ぎた日（アプリを開いていなかった間に来た日）も同じ判定で拾える。

     -> 戻した項目の配列（古い順ではなく、items の並び順）。1件も無ければ [] */
  sweepHolds() {
    const k = todayKey();
    const out = [];
    items.forEach(t => {
      if (t.trashed || !t.hold || !t.holdUntil) return;
      if (t.holdUntil > k) return;                  /* まだ先。文字列比較で足りる形 */
      t.hold = false;
      t.holdUntil = null;
      out.push(t);
    });
    if (out.length) { persist(); emit(); }
    return out;
  },

  /* 上の海の中身。完了したものは出さない（あちらはふりかえりから見る）。
     戻ってくる日が近い順、日を決めていないものは後ろ */
  holds() {
    return items.filter(t => isLive(t) && t.hold && !t.done).sort((a, b) => {
      const x = a.holdUntil || '', y = b.holdUntil || '';
      if (x === y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? -1 : 1;
    });
  },

  setToday(id, on) {
    const t = store.get(id);
    if (!t || t.today === !!on) return false;
    return store.setDay(id, todayKey(), on);
  },

  /* --- 時間帯タグ：朝 / 昼 / 夜 ---
     「今日する」の中の粗い時間帯。固定の3値で、ユーザーは増やせない。
     today と一緒に毎日消える。ここには記録（started）は付かない */

  SLOTS,

  slotsOf(id) {
    const t = store.get(id);
    return t ? t.slots.slice() : [];
  },

  /* 枠への出し入れ。on を省くとトグル。1つの todo は複数の枠に置ける */
  setSlot(id, slot, on) {
    const t = store.get(id);
    if (!t || !t.today || SLOTS.indexOf(slot) < 0) return false;
    const has = t.slots.indexOf(slot) >= 0;
    const want = (on === undefined) ? !has : !!on;
    if (has === want) return false;
    t.slots = want ? t.slots.concat([slot]) : t.slots.filter(x => x !== slot);
    persist(); emit();
    return true;
  },

  /* 枠から枠へ動かす（追加ではなく移動） */
  moveSlot(id, from, to) {
    const t = store.get(id);
    if (!t || !t.today) return false;
    if (SLOTS.indexOf(to) < 0) return false;
    const next = t.slots.filter(x => x !== from);
    if (next.indexOf(to) < 0) next.push(to);
    if (next.length === t.slots.length && next.every((x, i) => x === t.slots[i])) return false;
    t.slots = next;
    persist(); emit();
    return true;
  },

  /* すべての枠から外す（＝未割り当ての置き場に戻る） */
  clearSlots(id) {
    const t = store.get(id);
    if (!t || !t.slots.length) return false;
    t.slots = [];
    persist(); emit();
    return true;
  },

  /* その枠に入っているもの。並びは登録順 */
  inSlot(slot) {
    return items.filter(t => isLive(t) && t.today && !t.done && t.slots.indexOf(slot) >= 0);
  },

  /* 「今日する」に入っているが、まだどの枠にも入れていないもの */
  unslotted() { return items.filter(t => isLive(t) && t.today && !t.done && !t.slots.length); },

  /* --- アンカー（きっかけ） ---
     「もし〈状況〉なら〈行動〉」の〈状況〉にあたる軸。時間帯ではなく、
     すでに毎日やっている安定した行動をきっかけにする。
     ぶら下げたものは日をまたいでも消えない（立てっぱなしの計画なので） */

  MAX_ANCHORS,

  /* ユーザーが決めた並び順。中身はコピー */
  anchors() { return anchorList.map(anchorCopy); },

  anchor(id) {
    const a = findAnchor(id);
    return a ? anchorCopy(a) : null;
  },

  /* 空名は作らない。上限に達していても作らない -> 作ったアンカー / null */
  addAnchor(name) {
    const body = anchorName(name);
    if (!body) return null;
    if (anchorList.length >= MAX_ANCHORS) return null;
    /* 作った直後は日にち無し＝毎日。決めるのは画面から */
    const a = { id: aid(), name: body, hue: freeHue(), days: [], weeks: [] };
    anchorList.push(a);
    persist(); emit();
    return anchorCopy(a);
  },

  /* --- きっかけの日にち --- */

  /* 週の値のうち 5 は「最終」。画面はこれを見て札を組む */
  WEEK_LAST,
  /* 選べる値。画面が自前で 0..6 / 1..5 を書かなくて済むように出す */
  weekValues() { return WEEK_VALUES.slice(); },
  dayValues() { return DAY_VALUES.slice(); },

  /* { days, weeks } を返す。持っていなければどちらも空（＝毎日） */
  anchorSchedule(id) {
    const a = findAnchor(id);
    return a ? { days: a.days.slice(), weeks: a.weeks.slice() } : { days: [], weeks: [] };
  },

  /* 決め直す。受け取れない値は落とし、days が空なら weeks も空にする。
     -> 受け付けたか（無いアンカーなら false） */
  setAnchorSchedule(id, v) {
    const a = findAnchor(id);
    if (!a) return false;
    const s = normalizeSchedule(v);
    const same = a.days.join() === s.days.join() && a.weeks.join() === s.weeks.join();
    if (same) return true;                 /* 同じ内容なら書かない */
    a.days = s.days; a.weeks = s.weeks;
    persist(); emit();
    return true;
  },

  /* 今日（at を渡せばその日）が、このきっかけの日か。
     日にちを持たないきっかけは常に true。無いアンカーも true——
     画面が「知らない id は隠す」ことにならないように、通す側へ倒す */
  anchorDue(id, at) {
    const a = findAnchor(id);
    return a ? scheduleHits(a, at) : true;
  },

  /* 今日の日のきっかけだけ。並びは anchors() と同じ */
  dueAnchors(at) {
    return anchorList.filter(a => scheduleHits(a, at)).map(anchorCopy);
  },

  /* 改名。空名は受け付けない。
     -> 受け付けたか（同じ名前を入れ直したときも true。書き込みは起きない） */
  renameAnchor(id, name) {
    const a = findAnchor(id);
    if (!a) return false;
    const body = anchorName(name);
    if (!body) return false;
    if (a.name !== body) { a.name = body; persist(); emit(); }
    return true;
  },

  /* 消す。ぶら下がっていた todo からも、はじめた印からも外す。
     ログは消さない（過去に着手したことは事実なので）。
     ログ側は当時の名前を slotName に持っているので、消したあとも読める */
  removeAnchor(id) {
    const i = anchorList.findIndex(a => a.id === id);
    if (i < 0) return false;
    anchorList.splice(i, 1);
    items.forEach(t => {
      if (Array.isArray(t.anchors) && t.anchors.indexOf(id) >= 0) {
        t.anchors = t.anchors.filter(x => x !== id);
      }
      delete anchorAtOf(t)[id];
      delete startedOf(t)[id];
    });
    persist(); emit();
    return true;
  },

  /* 並べ替え。delta=-1 で1つ上へ、+1 で1つ下へ。端では動かさない -> 動いたか */
  moveAnchor(id, delta) {
    const i = anchorList.findIndex(a => a.id === id);
    if (i < 0) return false;
    const d = Math.trunc(Number(delta)) || 0;
    const j = i + d;
    if (d === 0 || j < 0 || j >= anchorList.length) return false;
    const [a] = anchorList.splice(i, 1);
    anchorList.splice(j, 0, a);
    persist(); emit();
    return true;
  },

  /* --- todo とアンカー --- */

  anchorsOf(id) {
    const t = store.get(id);
    return (t && Array.isArray(t.anchors)) ? t.anchors.slice() : [];
  },

  /* ぶら下げる／外す。on を省くとトグル。1つの todo を複数のアンカーに置ける。
     「今日する」に入っているかは問わない（アンカーは today と別の軸） */
  setAnchor(id, anchorId, on) {
    const t = store.get(id);
    if (!t || !findAnchor(anchorId)) return false;
    const has = t.anchors.indexOf(anchorId) >= 0;
    const want = (on === undefined) ? !has : !!on;
    if (has === want) return false;
    if (want) {
      t.anchors = t.anchors.concat([anchorId]);
      anchorAtOf(t)[anchorId] = seq++;     /* 末尾にぶら下がる */
    } else {
      t.anchors = t.anchors.filter(x => x !== anchorId);
      delete anchorAtOf(t)[anchorId];
      /* 外したら、そのアンカーでの着手の印も消す（ログは残る） */
      delete startedOf(t)[anchorId];
    }
    persist(); emit();
    return true;
  },

  /* アンカーからアンカーへ動かす（追加ではなく移動）。移した先では末尾に付く */
  moveItemAnchor(id, from, to) {
    const t = store.get(id);
    if (!t || !findAnchor(to)) return false;
    const next = t.anchors.filter(x => x !== from);
    const added = next.indexOf(to) < 0;
    if (added) next.push(to);
    if (next.length === t.anchors.length && next.every((x, i) => x === t.anchors[i])) return false;
    /* 外れたほうの着手印は落とす（setAnchor と挙動を揃える。ログは残る） */
    if (from && next.indexOf(from) < 0) {
      delete anchorAtOf(t)[from];
      delete startedOf(t)[from];
    }
    if (added) anchorAtOf(t)[to] = seq++;
    t.anchors = next;
    persist(); emit();
    return true;
  },

  /* すべてのアンカーから外す */
  clearAnchors(id) {
    const t = store.get(id);
    if (!t || !t.anchors.length) return false;
    t.anchors.forEach(anchorId => {
      delete anchorAtOf(t)[anchorId];
      delete startedOf(t)[anchorId];
    });
    t.anchors = [];
    persist(); emit();
    return true;
  },

  /* そのアンカーにぶら下がっているもの。「今日する」かどうかは問わない。
     並びはぶら下げた順で、先頭が主役（そのきっかけで最初にやること） */
  inAnchor(anchorId) {
    return items
      .filter(t => isLive(t) && !t.done
        && Array.isArray(t.anchors) && t.anchors.indexOf(anchorId) >= 0)
      .sort((a, b) => orderIn(a, anchorId) - orderIn(b, anchorId));
  },

  /* --- きっかけの画面に属する印 ---
     どのアンカーにぶら下げるかを決めないまま、きっかけの画面へ置いたものの行き先。
     anchors とは独立した軸で、gap と同じ形で持つ。
     アンカーにぶら下げても落とさない——所属は「追加」であって「移動」ではない。
     ぶら下がれば planUnsorted() からは自然に外れるので、落とす必要が無い */

  /* on を省くとトグル -> 変化したか */
  setPlan(id, on) {
    const t = store.get(id);
    if (!t) return false;
    const want = (on === undefined) ? !t.plan : !!on;
    if (t.plan === want) return false;
    t.plan = want;
    persist(); emit();
    return true;
  },

  isPlan(id) {
    const t = store.get(id);
    return !!(t && t.plan);
  },

  /* きっかけの画面に置いたが、まだどのアンカーにもぶら下げていないもの。作成順（古い順） */
  planUnsorted() {
    return items
      .filter(t => isLive(t) && t.plan && !t.done
        && !(Array.isArray(t.anchors) && t.anchors.length))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  /* --- 最初の一手 / リンク / すきま時間 ---
     どれも「今日する」に入っているかどうかとは無関係に持てる。
     海に漂っているうちに最初の一手だけ書いておく、という使い方をするため */

  /* 最初の一手のメモ。前後の空白は落とす。空文字で消せる -> 変化したか */
  setFirstStep(id, text) {
    const t = store.get(id);
    if (!t) return false;
    const next = (text === null || text === undefined) ? '' : String(text).trim();
    if (t.firstStep === next) return false;
    t.firstStep = next;
    persist(); emit();
    return true;
  },

  firstStepOf(id) {
    const t = store.get(id);
    return (t && typeof t.firstStep === 'string') ? t.firstStep : '';
  },

  /* 参照リンク。http/https だけを、正規化して保存する。
     弾いたときは保存せず、いまの値をそのまま返す
     -> { ok:boolean, url:string }（url は保存後の現在値） */
  setUrl(id, raw) {
    const t = store.get(id);
    if (!t) return { ok: false, url: '' };
    const next = safeUrl(raw);
    if (next === null) return { ok: false, url: store.urlOf(id) };
    if (t.url !== next) { t.url = next; persist(); emit(); }
    return { ok: true, url: next };
  },

  urlOf(id) {
    const t = store.get(id);
    return (t && typeof t.url === 'string') ? t.url : '';
  },

  /* すきま時間にできる印。on を省くとトグル -> 変化したか */
  setGap(id, on) {
    const t = store.get(id);
    if (!t) return false;
    const want = (on === undefined) ? !t.gap : !!on;
    if (t.gap === want) return false;
    t.gap = want;
    /* すきま時間から外れたら枠も空ける（today と slots の関係と同じ） */
    if (!t.gap) { t.gapSlots = []; t.gapAt = {}; }
    persist(); emit();
    return true;
  },

  isGap(id) {
    const t = store.get(id);
    return !!(t && t.gap);
  },

  /* すきま時間にできるもの。作成順（古い順）。
     「今日する」に入っているかは問わない。すきま時間は今日の予定とは別に訪れる */
  gapItems() {
    return items.filter(t => isLive(t) && t.gap && !t.done)
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  /* --- すきま時間の枠（利用者の指示で作り替え） ---
     **持ち方はきっかけのアンカーとまったく同じ。**画面も同じ形にするため。
       ・枠はユーザーが決める一覧（既定は4つ。名前を変えられる・足せる・消せる・並べ替え）
       ・1枠に何個でもぶら下がる（前は1枠1件で、2件目が古いほうを押し出していた）
       ・1つの項目を複数の枠にぶら下げられる
     日をまたいでも消えない（すきま時間は今日の予定とは別に訪れるので、
     rollover() はここに触らない） */

  MAX_GAP_SLOTS,

  /* ユーザーが決めた並び順。中身はコピー */
  gapSlots() { return gapList.map(g => ({ id: g.id, name: g.name, hue: g.hue })); },

  gapSlot(id) {
    const g = findGapSlot(id);
    return g ? { id: g.id, name: g.name, hue: g.hue } : null;
  },

  /* 空名は作らない。上限に達していても作らない -> 作った枠 / null */
  addGapSlot(name) {
    const body = anchorName(name);
    if (!body) return null;
    if (gapList.length >= MAX_GAP_SLOTS) return null;
    const g = { id: aid(), name: body, hue: freeGapHue() };
    gapList.push(g);
    persist(); emit();
    return { id: g.id, name: g.name, hue: g.hue };
  },

  renameGapSlot(id, name) {
    const g = findGapSlot(id);
    if (!g) return false;
    const body = anchorName(name);
    if (!body) return false;
    if (g.name !== body) { g.name = body; persist(); emit(); }
    return true;
  },

  /* 消す。ぶら下がっていた項目からも外す。**項目そのものは消さない**
     （枠から外れるだけで、すきま時間の未分類へ移る）。removeAnchor と同じ */
  removeGapSlot(id) {
    const i = gapList.findIndex(g => g.id === id);
    if (i < 0) return false;
    gapList.splice(i, 1);
    items.forEach(t => {
      if (Array.isArray(t.gapSlots) && t.gapSlots.indexOf(id) >= 0) {
        t.gapSlots = t.gapSlots.filter(x => x !== id);
      }
      delete gapAtOf(t)[id];
    });
    persist(); emit();
    return true;
  },

  /* 並べ替え。delta=-1 で1つ上へ、+1 で1つ下へ。端では動かさない -> 動いたか */
  moveGapSlot(id, delta) {
    const i = gapList.findIndex(g => g.id === id);
    if (i < 0) return false;
    const d = Math.trunc(Number(delta)) || 0;
    const j = i + d;
    if (d === 0 || j < 0 || j >= gapList.length) return false;
    const [g] = gapList.splice(i, 1);
    gapList.splice(j, 0, g);
    persist(); emit();
    return true;
  },

  /* --- 項目と枠 --- */

  gapSlotsOf(id) {
    const t = store.get(id);
    return (t && Array.isArray(t.gapSlots)) ? t.gapSlots.slice() : [];
  },

  /* ぶら下げる／外す。on を省くとトグル。
     ぶら下げると、すきま時間に入っていなければここで入れる（gap:true）。
     setAnchor と違うのはそこだけ——アンカーには「きっかけの画面に居る」に当たる
     plan が別にあるが、すきまは gap がその役目を兼ねているため */
  setGapSlot(id, slotId, on) {
    const t = store.get(id);
    if (!t || !findGapSlot(slotId)) return false;
    if (!Array.isArray(t.gapSlots)) t.gapSlots = [];
    const has = t.gapSlots.indexOf(slotId) >= 0;
    const want = (on === undefined) ? !has : !!on;
    if (has === want && (!want || t.gap)) return false;
    if (want) {
      if (!has) {
        t.gapSlots = t.gapSlots.concat([slotId]);
        gapAtOf(t)[slotId] = seq++;          /* 末尾にぶら下がる */
      }
      t.gap = true;
    } else {
      t.gapSlots = t.gapSlots.filter(x => x !== slotId);
      delete gapAtOf(t)[slotId];
    }
    persist(); emit();
    return true;
  },

  /* 枠の中の並べ替え。to の末尾へ移す（アンカーの moveToAnchor と同じ形）。
     from が null なら、未分類から入れる -> 動いたか */
  moveToGapSlot(id, from, to) {
    const t = store.get(id);
    if (!t || !findGapSlot(to)) return false;
    if (!Array.isArray(t.gapSlots)) t.gapSlots = [];
    let changed = false;
    if (from && t.gapSlots.indexOf(from) >= 0) {
      t.gapSlots = t.gapSlots.filter(x => x !== from);
      delete gapAtOf(t)[from];
      changed = true;
    }
    if (t.gapSlots.indexOf(to) < 0) {
      t.gapSlots = t.gapSlots.concat([to]);
      changed = true;
    }
    gapAtOf(t)[to] = seq++;
    if (!t.gap) { t.gap = true; changed = true; }
    if (changed) { persist(); emit(); }
    return changed;
  },

  /* すべての枠から外す（clearAnchors と同じ。すきま時間の印は残す） */
  clearGapSlots(id) {
    const t = store.get(id);
    if (!t || !Array.isArray(t.gapSlots) || !t.gapSlots.length) return false;
    t.gapSlots.forEach(sid => { delete gapAtOf(t)[sid]; });
    t.gapSlots = [];
    persist(); emit();
    return true;
  },

  /* その枠にぶら下がっているもの。ぶら下げた順（＝先頭が古い） */
  inGapSlot(slotId) {
    return items
      .filter(t => isLive(t) && !t.done && t.gap
        && Array.isArray(t.gapSlots) && t.gapSlots.indexOf(slotId) >= 0)
      .sort((a, b) => gapOrderIn(a, slotId) - gapOrderIn(b, slotId));
  },

  /* すきま時間に入れてあるが、まだどの枠にも入れていないもの。作成順（古い順） */
  gapUnsorted() {
    return items
      .filter(t => isLive(t) && t.gap && !t.done
        && !(Array.isArray(t.gapSlots) && t.gapSlots.length))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  /* --- タグ ---
     海の面。中央（ぜんぶ）のほかに、上・左・右の3つの向きがあり、
     そこへどのタグを置くかはユーザーが決める。タグは何個でも作れるが、向きは3つしかない。

     today / plan / gap / done の4つは特別なタグ。名前を変えられず、消せない。
     実体は既存のフラグそのもので、タグとしての状態を別に持たない——
     持つと「タグは付いているが today は false」のような食い違いが必ず出る。
     項目側の tags に入るのはユーザーのタグの id だけで、特別なタグの id は入らない。 */

  TAG_SPECIAL,
  TAG_DIRS,

  /* ユーザーのタグに配る色の一覧（パステル8色）。**色の出どころはここだけ**。
     設定画面が「タグを足す」で色を選ぶときもこれを読む。
     addTag() に色を渡さなかったときの配り先も同じ配列（nextTagHue）。
     返すのはコピー。呼び手が並べ替えても内部は壊れない */
  tagPalette() { return TAG_PALETTE.slice(); },

  /* 並びは 特別なタグ5つ（today / plan / gap / hold / done）→ 作った順のユーザーのタグ。
     中身はコピー */
  tags() { return tagList.map(tagCopy); },

  tag(id) {
    const t = findTag(id);
    return t ? tagCopy(t) : null;
  },

  /* ユーザーのタグを足す。空名は作らない。
     色は #rgb / #rrggbb。省いた・受け付けられない色のときは順に配る
     （無彩色は受け付けない。無彩色は「タグ無し」の意味に取ってあるため）
     -> 作ったタグ / null */
  addTag(name, color) {
    const body = anchorName(name);
    if (!body) return null;
    const tag = {
      id: tid(),
      name: body,
      color: tagColor(color) || nextTagHue(tagList.length),
      dir: null,
      special: false,
    };
    tagList.push(tag);
    persist(); emit();
    return tagCopy(tag);
  },

  /* 改名。特別なタグは名前を変えられない。空名も受け付けない
     -> 受け付けたか（同じ名前を入れ直したときも true。書き込みは起きない） */
  renameTag(id, name) {
    const tag = findTag(id);
    if (!tag || tag.special) return false;
    const body = anchorName(name);
    if (!body) return false;
    if (tag.name !== body) { tag.name = body; persist(); emit(); }
    return true;
  },

  /* 色を変える。特別なタグでも色は変えられる（向きと色だけはユーザーのもの）
     -> 受け付けたか */
  setTagColor(id, color) {
    const tag = findTag(id);
    if (!tag) return false;
    const next = tagColor(color);
    if (next === null) return false;
    if (tag.color !== next) { tag.color = next; persist(); emit(); }
    return true;
  },

  /* 消す。特別なタグは消せない。
     付いていた項目からは、そのタグだけが外れる（項目は消えない。追補3 §8） */
  removeTag(id) {
    const i = tagList.findIndex(t => t.id === id);
    if (i < 0 || tagList[i].special) return false;
    tagList.splice(i, 1);
    /* 海になっていたなら、列からも降ろす（消えたタグの列が残らないように） */
    const si = seaList.indexOf(id);
    if (si >= 0) seaList.splice(si, 1);
    /* 最初から置いてあったタグなら、消したことを覚える（読み込みでよみがえらせない） */
    if (TAG_STARTERS.some(d => d.id === id) && removedStarters.indexOf(id) < 0) {
      removedStarters.push(id);
    }
    items.forEach(t => {
      const box = tagBoxOf(t);
      if (box.indexOf(id) >= 0) t.tags = box.filter(x => x !== id);
    });
    persist(); emit();
    return true;
  },

  /* 向きの割り当て。dir は 'left' / 'right' / null（どの向きにも置かない）。
     上下は固有枠なので受け付けない。
     1向き1タグ。既に別のタグがその向きに居たら、そちらを null に落としてから入れる
     -> 受け付けたか（タグが無い・向きが不正なら false） */
  /* 固有枠に入っているタグなら、その向き。ふつうのタグなら null。
     画面はこれを見て「向き」の選び欄を出すかどうかを決める */
  tagDirFixed(id) { return FIXED_DIRS[id] || null; },

  /* ---- 横一列に並ぶ海（利用者の指示：タグ付き海を10個まで） ----

     前は左右の2枠の取り合いだった。10個になると「向き」では足りないので、
     **並び**を持つ。中央（タグ無し）は列の左端で、この配列には入らない。
     上下の固有枠（長期保留・完了）も入らない——あれは列とは別の軸。 */
  MAX_SEAS,

  /* 左から順のタグ。中身はコピー */
  seas() {
    return seaList.map(id => findTag(id)).filter(Boolean).map(tagCopy);
  },

  /* 左から何番目か。海になっていなければ -1 */
  seaIndex(id) { return seaList.indexOf(id); },

  isSea(id) { return seaList.indexOf(id) >= 0; },

  /* 海にできるか。固有枠と、もう海になっているものは受けない */
  canBeSea(id) {
    const t = findTag(id);
    if (!t || FIXED_DIRS[id]) return false;
    return seaList.indexOf(id) < 0 && seaList.length < MAX_SEAS;
  },

  /* 列のいちばん右に足す -> 足せたか */
  addSea(id) {
    if (!store.canBeSea(id)) return false;
    seaList.push(id);
    persist(); emit();
    return true;
  },

  /* 列から降ろす。**タグも中身も消えない**——しぼるから見えるまま -> 降ろせたか */
  removeSea(id) {
    const i = seaList.indexOf(id);
    if (i < 0) return false;
    seaList.splice(i, 1);
    persist(); emit();
    return true;
  },

  /* 並べ替え。delta は ±1 が基本。端では動かない -> 動いたか */
  moveSea(id, delta) {
    const i = seaList.indexOf(id);
    const d = Math.trunc(Number(delta) || 0);
    if (i < 0 || !d) return false;
    const j = Math.max(0, Math.min(seaList.length - 1, i + d));
    if (j === i) return false;
    seaList.splice(i, 1);
    seaList.splice(j, 0, id);
    persist(); emit();
    return true;
  },

  setTagDir(id, dir) {
    const tag = findTag(id);
    if (!tag) return false;
    const next = (dir === null || dir === undefined) ? null : dir;
    if (next !== null && TAG_DIRS.indexOf(next) < 0) return false;
    /* 固有枠は動かせない。その枠のタグを外すことも、別のタグを入れることもできない
       （next が 'down' なら上の TAG_DIRS 判定で既に落ちている） */
    if (FIXED_DIRS[id]) return false;
    let changed = false;
    if (next !== null) {
      tagList.forEach(x => {
        if (x !== tag && x.dir === next) { x.dir = null; changed = true; }
      });
    }
    if (tag.dir !== next) { tag.dir = next; changed = true; }
    if (changed) { persist(); emit(); }
    return true;
  },

  /* その向きに置かれているタグ。空なら null */
  tagDir(dir) {
    if (ALL_DIRS.indexOf(dir) < 0) return null;
    const tag = tagList.find(t => t.dir === dir);
    return tag ? tagCopy(tag) : null;
  },

  /* --- 項目のタグ --- */

  /* その項目に付いているタグの id。並びは tags() と同じ（特別なタグが先） */
  tagsOf(id) {
    const t = store.get(id);
    if (!t) return [];
    return tagList.filter(tag => hasTag(t, tag.id)).map(tag => tag.id);
  },

  /* 付ける／外す。on を省くとトグル。
     特別なタグは既存の書き込み口へそのまま委ねる（状態を2か所に持たないため）：
       today → setToday / plan → setPlan / gap → setGap / done → complete・uncomplete
     -> 変化したか */
  setTag(id, tagId, on) {
    const t = store.get(id);
    const tag = findTag(tagId);
    if (!t || !tag) return false;
    const want = (on === undefined) ? !hasTag(t, tag.id) : !!on;
    if (tag.id === 'today') return store.setToday(id, want);
    if (tag.id === 'plan') return store.setPlan(id, want);
    if (tag.id === 'gap') return store.setGap(id, want);
    if (tag.id === 'done') {
      if (!want) return store.uncomplete(id);
      if (t.done) return false;
      return !!store.complete(id);
    }
    if (tag.id === 'hold') return store.setHold(id, want);
    const box = tagBoxOf(t);
    const has = box.indexOf(tag.id) >= 0;
    if (has === want) return false;
    t.tags = want ? box.concat([tag.id]) : box.filter(x => x !== tag.id);
    persist(); emit();
    return true;
  },

  /* そのタグの海の中身。完了したものは出さない（あれは完了の海にだけ出す）。
     完了の海の中身は doneItems() で読む——なので inTag('done') は常に空になる */
  inTag(tagId) {
    if (!findTag(tagId)) return [];
    return items.filter(t => isLive(t) && !t.done && hasTag(t, tagId));
  },

  /* --- 一手の記録 ---
     集中画面で「今回なにをしてたか / 次の一手」を残すところ。
     git のコミットと同じで、押したときにだけ1件積み、あとから上書きしない。
     直せるのは直近1件の did だけ（書き損じ用。--amend と同じ）。

     着手のログ（log）とは別系列。あちらは「はじめた」という出来事の記録で、
     ふりかえりの集計に出る。こちらは次に開いたときに続きが分かるためのもので、
     集計には出さない（件数を数え始めると、このアプリが避けている作りに戻る）。

     日をまたいでも消えない。rollover() はここに触らない——
     「前回どこまでやったか」は今日の予定とは別の情報なので */

  /* 積み上がった記録。古い順。無ければ []。中身も含めてコピーを返す */
  stepsOf(id) {
    return stepListOf(store.get(id)).map(stepCopy);
  },

  /* 直近の1件。無ければ null。コピーを返す */
  lastStep(id) {
    const list = stepListOf(store.get(id));
    return list.length ? stepCopy(list[list.length - 1]) : null;
  },

  /* 1件積む。
     ・did / next はどちらも空でよいが、両方空なら何もせず null
     ・next が空でなければ、それが「開始の１手」（firstStep）になる
     ・書きかけ（draft）は積んだ時点で消える
     -> 積んだ記録 { at, did, next } のコピー / null（id が無い・両方空） */
  commitStep(id, entry) {
    const t = store.get(id);
    if (!t) return null;
    const o = entry || {};
    const did = stepText(o.did);
    const next = stepText(o.next);
    /* 記録には「次の一手」が要る。git のコミットが必ず次を指すのと同じで、
       積んだ記録は必ず「次はここから」を持つ。
       「今回なにをしてたか」は空でもよい（次の一手だけを更新する道を残す）。 */
    if (!next) return null;
    const step = { at: Date.now(), did, next };
    stepListOf(t).push(step);
    /* 次の一手を書いたなら、それが次に開いたときの「開始の１手」になる。
       setFirstStep() を呼ばずに直接入れるのは、保存と通知を1回にまとめるため
       （書き込む値は setFirstStep と同じく前後の空白を落としたもの） */
    if (next) t.firstStep = next;
    t.draft = { did: '', next: '' };
    persist(); emit();
    return stepCopy(step);
  },

  /* **積んだ記録を直す**（利用者の指示：記録の履歴に編集ボタンを用意して、修正を許可して）。

     git に喩えてきたので言い方を揃えると、これは commit --amend にあたる操作を
     直近1件だけでなく**どの記録にも許す**もの。積み直しではないので `at` は変えない
     ——「いつ手をつけたか」は起きた事実で、書き直せるのは**書いた文だけ**。

     ・at で1件を指す（同じ項目の中では重ならない）
     ・did / next の両方を直せる
     ・**next は空にできない。**記録は必ず「次はここから」を持つ（commitStep と同じ決まり）
     ・直したのが**いちばん新しい記録**なら、firstStep も一緒に付いていく
       ——あれは「次に開いたときの開始の１手」で、いちばん新しい next のことだから
     -> 直せたか（項目・記録が無い／next が空なら false） */
  editStep(id, at, entry) {
    const t = store.get(id);
    if (!t) return false;
    const key = Number(at);
    if (!Number.isFinite(key)) return false;
    const list = stepListOf(t);
    const i = list.findIndex(x => x && Number(x.at) === key);
    if (i < 0) return false;
    const o = entry || {};
    const did = stepText(o.did);
    const next = stepText(o.next);
    if (!next) return false;                 /* 記録は必ず次を指す */
    const row = list[i];
    if (row.did === did && row.next === next) return true;   /* 同じなら書かない */
    row.did = did;
    row.next = next;
    /* いちばん新しい記録を直したなら、開始の１手も付いていく */
    if (i === list.length - 1) t.firstStep = next;
    persist(); emit();
    return true;
  },

  /* 直近1件の did だけを直す。書き損じ用。
     ・新しい記録は増やさない。at も next も変えない（firstStep にも触らない）
     ・同じ値を入れ直したときは書き込まずに true（renameAnchor と同じ扱い）
     ・空にもできる（書き損じを消せないと直せないため）
     -> 直せたか。記録が1件も無ければ false */
  amendLastStep(id, entry) {
    const t = store.get(id);
    if (!t) return false;
    const list = stepListOf(t);
    if (!list.length) return false;
    const last = list[list.length - 1];
    const did = stepText((entry || {}).did);
    if (last.did !== did) { last.did = did; persist(); emit(); }
    return true;
  },

  /* --- 書きかけ（記録ではない） ---
     打った文字が消えるのは事故なので、記録とは別に控えておくだけのもの。
     ふりかえりにも履歴にも出ない */

  /* { did, next }。無ければ { did:'', next:'' }。コピーを返す */
  draftOf(id) {
    const d = draftBoxOf(store.get(id));
    return { did: d.did, next: d.next };
  },

  /* 上書き保存 -> 変化したか */
  setDraft(id, draft) {
    const t = store.get(id);
    if (!t) return false;
    const o = draft || {};
    const did = stepText(o.did);
    const next = stepText(o.next);
    const cur = draftBoxOf(t);
    if (cur.did === did && cur.next === next) return false;
    t.draft = { did, next };
    persist(); emit();
    return true;
  },

  /* 漂う位置の保存。頻繁に呼ばれるので既定では通知しない（再描画を誘発させない） */
  setPos(id, fx, fy, { silent = true } = {}) {
    const t = store.get(id);
    if (!t) return false;
    t.fx = clamp01(fx, t.fx);
    t.fy = clamp01(fy, t.fy);
    if (!silent) emit();
    return true;
  },

  flush() { persist(); },

  /* todo を全部消す。記録（着手・今日するに入れた）は事実なので残す。
     アンカーとタグも残す（入れものであって、中身ではない）。

     こちらは remove() と違って本当に取り除く。墓石も残らない。
     プロトタイプ操作なので、その意味は変えていない（消したものを掃除する唯一の道） */
  clear() { items = []; persist(); emit(); },

  /* todo も記録もアンカーもタグも全部消して、初期状態に戻す。
     タグは空にはならない——特別なタグ4つは既定値で立て直す（消せないものなので）。
     プロトタイプの確認用（空の画面を見るため）で、本番のUIには出さない */
  wipe() {
    items = []; anchorList = []; gapList = normalizeGapSlots(null); tagList = normalizeTags(null);
    seaList = normalizeSeas(null, tagList);
    logs = []; todayLogs = []; lastDay = dayOf(Date.now());
    persist(); emit();
  },

  seed(texts) {
    texts.forEach(text => {
      items.push({
        id: uid(), text, days: [], today: false, hold: false, holdUntil: null, createdAt: Date.now(),
        fx: 0.15 + Math.random() * 0.7, fy: 0.15 + Math.random() * 0.6,
        slots: [], anchors: [], anchorAt: {}, started: {},
        firstStep: '', url: '', gap: false, gapSlots: [], gapAt: {}, plan: false,
        steps: [], draft: { did: '', next: '' },
        tags: [], done: false, doneAt: null, trashed: false, trashedAt: null,
      });
    });
    persist(); emit();
  },

  /* --- 日付 --- */

  DAY_CUTOFF_HOUR,

  today() { return dayOf(Date.now()); },

  /* 日またぎ。読み込み時に自動で1回走る。画面から明示的に呼んでもよい
     （タブに戻ってきたとき、日付が変わっていないかを確かめる用）。
     -> 海に戻した件数 */
  rollover,

  /* --- 着手 --- */

  /* 着手を記録し、ログに1件積む。記録するのはアンカーごと（時間帯では記録しない）。
     anchorId に null を渡すと「アンカー無しで始めた」。
     アンカー無しの着手は、その項目がどこにあっても記録できる——海（未分類）でも、
     すきま時間の枠でも、きっかけの未分類でも。どこに置いたかは「いつやるか」の話で、
     「もう始めた」という事実とは別の軸なので、置き場所で門前払いにはしない。

     false になるのは：todo が無い / anchorId がそのアンカーにぶら下がっていない /
     アンカーが無い / 既に着手済み。
     ログには、そのときのアンカー名も一緒に残す（あとで改名・削除されても読めるように） */
  start(id, anchorId) {
    const t = store.get(id);
    if (!t) return false;
    const key = keyOf(anchorId);
    if (key === null) return false;
    let name = '';
    if (key !== NO_ANCHOR_KEY) {
      const a = findAnchor(key);
      if (!a) return false;
      if (!Array.isArray(t.anchors) || t.anchors.indexOf(key) < 0) return false;
      name = a.name;
    }
    if (!t.started || typeof t.started !== 'object') t.started = {};
    if (Number.isFinite(t.started[key])) return false;
    const at = Date.now();
    t.started[key] = at;
    logs.push({
      id: t.id,
      text: t.text,
      slot: key === NO_ANCHOR_KEY ? null : key,
      slotName: name,
      at,
    });
    persist(); emit();
    return true;
  },

  /* 着手の取り消し。押し間違い用。その (id, anchorId) の今日ぶんのログも1件消す */
  unstart(id, anchorId) {
    const t = store.get(id);
    if (!t) return false;
    const key = keyOf(anchorId);
    if (key === null) return false;
    const at = startedOf(t)[key];
    if (!Number.isFinite(at)) return false;
    delete t.started[key];
    const slot = key === NO_ANCHOR_KEY ? null : key;
    const day = dayOf(Date.now());
    let hit = -1;
    for (let i = logs.length - 1; i >= 0; i--) {
      const e = logs[i];
      if (e.id !== id || e.slot !== slot) continue;
      if (e.at === at) { hit = i; break; }
      /* 記録の時刻が判らない古いログでも、今日ぶんの最後の1件なら消す */
      if (hit < 0 && dayOf(e.at) === day) hit = i;
    }
    if (hit >= 0) logs.splice(hit, 1);
    persist(); emit();
    return true;
  },

  isStarted(id, anchorId) {
    const key = keyOf(anchorId);
    return key === null ? false : Number.isFinite(startedOf(store.get(id))[key]);
  },

  startedAt(id, anchorId) {
    const key = keyOf(anchorId);
    if (key === null) return null;
    const at = startedOf(store.get(id))[key];
    return Number.isFinite(at) ? at : null;
  },

  /* --- 集計 ---
     件数だけを返す。分母を持つ指標（達成率・消化率）は作らない。
     「何件やれたか」は見えても「何件やれなかったか」は見えないようにする */

  /* 着手のログ。古い順。コピーを返す。
     slot は着手したアンカーの id（アンカー無しなら null）、
     slotName は記録した時点のアンカー名。いまのアンカーを引き直さないので、
     改名・削除のあとでも当時の名前のまま読める */
  log() {
    return logs.map(e => ({
      id: e.id, text: e.text, slot: e.slot, slotName: e.slotName, at: e.at,
    }));
  },

  /* 全期間の着手件数 */
  totalStarted() { return logs.length; },

  /* 直近 days 日（今日を含む）の着手件数 */
  startedCount(days) {
    const set = new Set(recentDays(days));
    return logs.reduce((n, e) => n + (set.has(dayOf(e.at)) ? 1 : 0), 0);
  },

  /* 直近 days 日ぶんの日ごとの着手件数。古い順、ちょうど days 件。
     着手0の日も n:0 で含める（棒グラフに穴を開けないため） */
  startedByDay(days) {
    const list = recentDays(days);
    const idx = new Map(list.map((day, i) => [day, i]));
    const ns = list.map(() => 0);
    logs.forEach(e => {
      const i = idx.get(dayOf(e.at));
      if (i !== undefined) ns[i]++;
    });
    return list.map((day, i) => ({ day, n: ns[i] }));
  },

  /* 直近 days 日の、アンカーごとの着手件数。
     並びはいまのアンカーの並び順。名前もいまの名前（改名はここに効く）。
     アンカー無しで始めたぶんは末尾に { id:null, name:'アンカー無し', n } として足す
     （0件なら足さない）。

     もう存在しないアンカーの記録は、ここには出ない。並べる先が無いため。
     消えたわけではなく、log() には当時の名前（slotName）と一緒に残っている */
  startedByAnchor(days) {
    const set = new Set(recentDays(days));
    const counts = new Map(anchorList.map(a => [a.id, 0]));
    let none = 0;
    logs.forEach(e => {
      if (!set.has(dayOf(e.at))) return;
      if (e.slot === null) { none++; return; }
      if (counts.has(e.slot)) counts.set(e.slot, counts.get(e.slot) + 1);
    });
    const out = anchorList.map(a => ({ id: a.id, name: a.name, n: counts.get(a.id) }));
    if (none) out.push({ id: null, name: NO_ANCHOR_NAME, n: none });
    return out;
  },

  /* 直近 days 日に「今日する」へ入れた件数。
     todays() は現在の件数なので、期間の比較にはこちらを使う */
  todayedCount(days) {
    const set = new Set(recentDays(days));
    /* day を持つのは新しい記録だけ。無い古い記録は、決めた時刻から日を出す
       （前と同じ数え方。未来へ置いた記録が出てくるのは day を持つ版から） */
    return todayLogs.reduce((n, e) => n + (set.has(e.day || dayOf(e.at)) ? 1 : 0), 0);
  },

  /* 直近 days 日に書かれた todo の件数。
     消したものは数えない（count() と同じ扱い。数の側から消したものの存在が
     見えてしまうと「表示上完全に消す」が崩れる）。
     着手のログ（log）から数える集計のほうは、消しても件数が変わらない——
     あちらは出来事の記録で、項目の現在値ではないため */
  writtenCount(days) {
    const set = new Set(recentDays(days));
    return items.reduce((n, t) =>
      n + ((isLive(t) && set.has(dayOf(t.createdAt))) ? 1 : 0), 0);
  },

  /* 直近 days 日のうち、1件以上着手した日の数 */
  startedDays(days) {
    const set = new Set(recentDays(days));
    const hit = new Set();
    logs.forEach(e => { const d = dayOf(e.at); if (set.has(d)) hit.add(d); });
    return hit.size;
  },

  /* --- 購読 --- */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* 保存に失敗したときだけ呼ばれる。引数は投げられた例外そのもの。
     戻り値は解除する関数（on() と同じ形）。 */
  onSaveError(fn) {
    if (typeof fn !== 'function') return () => {};
    saveErrorListeners.add(fn);
    return () => saveErrorListeners.delete(fn);
  },

  /* 直近の保存が失敗していれば、その例外。成功していれば null */
  saveError() { return lastSaveError; },
};
