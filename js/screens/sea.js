/* 画面1「海」— 横一列に並ぶ面（利用者の指示：タグ付き海を10個まで）

     　　　　  ┌────────┐
     　　　　  │ 長期保留 │        ← 上下は**中央の列にだけ**付く固有枠
     ┌────────┼────────┬────────┬─────┐
     │ タグ無し │  海1   │  海2   │ …  │  ← 横一列（海は10個まで）
     └────────┼────────┴────────┴─────┘
     　　　　  │  完了   │
     　　　　  └────────┘

   ・中央（列の左端）= タグの付いていないものだけ（既定。しぼるで広げられる）
   ・上・下 = **固有枠**。上=長期保留 / 下=完了。ユーザーは動かせない
   ・海の列 = store.seas() の順（引きで並べ替える）。面の名前は 'sea:<タグid>'
   ・背景をドラッグ／スワイプ = 隣の列へ移る（上下は中央の列からだけ）
   ・バブルをドラッグして端へ = **隣の海のタグ**が付く。面は移らない
     この2つは混ぜない。指を置いた場所（バブルの上か、背景か）で分かれる
   ・海を長押し = 引き（全部の海の一覧）。並べ替え・名前と色・海をやめる・＋で足す

   store のタグ API がまだ無い版でも落ちないこと。
   その場合は面が中央1つだけになり、従来どおり store.floating() が漂う。

   物理は js/drift.js、バブルの DOM とジェスチャは js/bubble.js が持つ。
   この画面はその2つに「何を出すか」を渡し、返ってきた合図を store の操作へつなぐだけ。 */

import { store } from '../store.js';
import { el, toast, clamp, holdRing } from '../ui.js';
import { makeBubble, updateBubble, attachGestures, openMenu, diameterFor } from '../bubble.js';
import { createField } from '../drift.js';
import { openSeaMap, closeSeaMap, isOpen as seaMapOpen } from '../seamap.js';
import { playComplete } from '../sound.js';
/* 「今日」タブの落とし先は、今日の画面がいま映している日（利用者の指示）。
   today.js は sea.js を読まないので、循環にはならない。 */
import { dropDay } from './today.js';

/* --- 海に出すバブルの上限（利用者の指示）---

   海は増える一方なので、**新しいほうから数えて この数まで**しか出さない。
   隠れたぶんは「ならべる」（文字の一覧）で全部読める。

   隠すのは**古いほう**。古くて手つかずのものこそ「やっていないことの山」になるので、
   漂わせ続けないほうが憲章に合う（README の禁止事項）。

   **数を決めたのは重さではなく、混み具合のほう。**
   利用者の案は「50個など」だったので 50 で組んで測ったが、読めなかった：

     50個 … バブルの面積の合計が面の **220%**、1個あたり 8.1個と重なる
     17個 … 同 73%、重なり 18組（A-1 で測った値）

   面はスクロールしない1画面なので、入らないぶんはそのまま重なりになる。
   20個で面積 **88%**、1個あたり 1.9個の重なり。ここを上限にした。
   **引けば混み具合は下がる**（海そのものが広がるので）。実測、15個で：

     1.00 … 面積 65%、重なり 34組
     0.45 … 面積 13%、重なり **4組**（海は縦横 2.2倍＝面積 4.9倍）

   ただし上限はズームとは別に、これ単体で立っていなければならない。
   引いた状態は「眺める」状態で、そこで読み書きするわけではないため。

   重さのほうは、これで自動的に収まる。参考の実測：
   バブル1個は DOM 5ノード・グラデーション7層・影1枚・動く CSS アニメ1本。
   物理（drift の総当たり）は 400個で 1フレーム 0.82ms（この Mac。予算 16.7ms の 5%）。
   **塗りの費用はペインが裏に回っていて測れていない**（契約 §14）が、
   個数に素直に比例するので、個数を抑えれば効く。 */
const SEA_MAX = 20;

/* 着手（store.start）の印を、画面で何と呼ぶか（利用者の指示）。
   「はじめた」「開始した」と別々に呼んでいたが、同じ印を指している。
   実際にしていることは「今日ぶんはここまで」——押すとバブルが薄くなり、
   5時に戻る（契約 §5）。だから名前もそう呼ぶ。
   **記録している中身は変えていない。**ふりかえりの内訳は「はじめた」のまま
   （あちらは操作の名前ではなく、記録の名前。README の憲章がその言葉を使っている）。 */
const DONE_LB = '今日は終わり';

const GRID_D = 96;     /* 整列中のバブルの直径。枠の中と同じ一定サイズ（契約 §4） */
const SAVE_MS = 400;   /* 詳細の自動保存。打っている途中で毎回は書かない */

/* --- ランダムスタートのシャッフル（追補5 §4） ---
   押した瞬間に「決まりました」ではなく、混ざってから1つに決まる、と見えるようにする。
   ホップ = 光が次の玉へ移るまでの時間。だんだん遅くなる（＝止まりかけに見える）。
   合計 552ms + 最後の玉が大きくなる 200ms ≒ 0.63秒。始めたい人を待たせる長さにしない。 */
const SHUF_HOPS = [56, 58, 62, 70, 82, 100, 124];
const SHUF_WIN = 200;   /* 選ばれた玉が大きくなるまで */
const SHUF_MAX = 10;    /* 盤に出す玉の数の上限。これ以上は重なって粒に見える */
const SHUF_D = 46;      /* 玉の直径 px。CSS の .sea-shuffle .rnd-b と同じ値。片方だけ変えないこと */

/* --- 面（利用者の指示：タグ付き海を10個まで／横一列に並べる） ---

   前は十字（中央の上下左右）に4つまでだった。10個は十字に収まらないので、
   **横一列**にした（利用者が Android のホームを例に挙げたとおり）：

     上：長期保留
     中央（タグ無し） ↔ 海1 ↔ 海2 ↔ … ↔ 海10
     下：完了

   ・列は左端が中央。海は store.seas() の順（＝引きで並べ替えた順）
   ・**上下は列とは別の軸**で、中央の列にだけ付く（固有枠。store の FIXED_DIRS）
   ・面の名前は 'center' / 'up' / 'down' / 'sea:<タグid>'

   なぜ面をタグの数だけ作るか。3枚（前・いま・次）を使い回す作りも試せるが、
   滑らせ終わったあとに中身を入れ替えることになり、drift はノードを id で使い回す
   ので、**入れ替えた瞬間にバブルが並び直る**（毎回ちらつく）。
   器は数だけ作り、**中身（drift の field）は今いる列とその両隣にだけ持たせる**。
   器は空の div なので安い。 */
const EDGE_DIRS = ['up', 'left', 'right', 'down'];  /* 端の手がかりを出す場所 */
const SEA_PREFIX = 'sea:';

/* いまの海の並び（タグのコピー。左から順）。1回の描画のあいだは覚えておく */
let seaCache = null;
function forgetSeas() { seaCache = null; }
function seaTags() {
  if (seaCache) return seaCache;
  let list = [];
  if (has('seas')) { try { list = store.seas() || []; } catch (err) { list = []; } }
  seaCache = list;
  return seaCache;
}

const faceOfTag = id => SEA_PREFIX + id;
const tagIdOfFace = f => (typeof f === 'string' && f.indexOf(SEA_PREFIX) === 0) ? f.slice(SEA_PREFIX.length) : '';

/* いま在る面の一覧。中央・上下・海の列 */
function liveFaces() {
  const out = ['center'];
  if (fixedTag('up')) out.push('up');
  if (fixedTag('down')) out.push('down');
  seaTags().forEach(t => out.push(faceOfTag(t.id)));
  return out;
}

/* 面の列番号。中央と上下は 0、海は 1 から */
function colOf(face) {
  const id = tagIdOfFace(face);
  if (!id) return 0;
  const i = seaTags().findIndex(t => t.id === id);
  return i < 0 ? 0 : i + 1;
}

/* **バブルを落とすとタグが付く端**。下（完了）は入れない。

   理由は2つある。ひとつは場所——下の帯はタブバーのすぐ上（bottom:64px の 21px）で、
   「今日」タブへバブルを運ぶ指がその上を通る。離す位置が数十 px ずれただけで
   完了になるのは、取り消せるとしても筋が悪い。
   もうひとつは決め方——完了は「訊かれて答えるもの」ではなく
   「自分から押したいときに押すもの」として置いてある（README）。
   だから完了にするのは盤の [タスク完了] だけにして、端は見に行く口にとどめる。

   edgeHitAt() はもともと up/left/right しか見ていないので、
   ここは「その方針を名前にした」定数。両方を同じ並びから引く。 */
const DROP_DIRS = ['up', 'left', 'right'];

/* 看板の矢印。向きは「その海がある方角」を指す */
const SIGN_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
/* タグに色が入っていないときの控え。無彩色は「タグ無し」の意味なので使わない（追補3 §1）。
   列は10本あるので、順に配る（同じ色が隣に来ない並び） */
const FALLBACK_COLORS = [
  'var(--today-edge)', 'var(--slot-noon)', 'var(--slot-morning)', 'var(--slot-night)',
];
const CENTER_NAME = 'ぜんぶ';
/* 中央の海の**行き先としての名前**は「ぜんぶ」のまま（ならべる／しぼるで
   ぜんぶに届く場所なので）。**いま何が映っているか**の名前はこちら。
   既定はタグ無しだけを映すので、「ぜんぶ」と名乗ると嘘になる。 */
const CENTER_VIEW_NAME = 'タグ無し';
/* 絞っている間の面の名前。名前が変わることが「いま絞っている」の合図（追補4 §2） */
/* 絞っているのに名前が引けなかったときの逃げ（ふつうは通らない） */
const NARROW_NAME = 'しぼりこみ中';
/* 絞り込みが見るタグ。ユーザーの作ったタグは条件に入れない（追補4 §2）。
   完了はそもそも中央に出ないので入れない */

const AXIS_LOCK = 10;   /* この距離を超えた時点で縦か横かを決める */
const EDGE_BAND = 21;   /* 帯の厚み px。利用者の指示で 64 の 1/3。
                           CSS 側 .sea-edge の 21px と同じ値。片方だけ変えないこと */
/* 帯の「辺に沿った長さ」。1 = 辺の全長（利用者の指示で、中央1/3 から全長へ戻した）。
   狭めるのは長さではなく厚み（EDGE_BAND）のほう。 */
const EDGE_SPAN = 1;

let root, stage, view, world, hint, grid, gridCap, gridEmpty, moreLine;
let faceName, faceDot, faceLabel;
let gatherBtn, gatherLabel;
let narrowBtn, narrowLabel, centerEmpty;
let randomBtn;
let shuffle = null;         /* 混ぜている最中だけ { node, timer } が入る */
let sheet, sheetTitle, sheetBody;
let input, sendBtn, quickBtn, composer;

/* 面ごとの持ち物。フィールド（漂う物理）は必要になってから作る。
   4つ作りっぱなしにすると、タグが1つも無い版でも raf のループと DOM が3つ余る。 */
const faces = {};       /* face -> { el, field, gestures:Map, empty } */
const edges = {};       /* dir  -> { el, btn, dot, label } */

let curFace = 'center';
let gathering = false;

/* ---- 海のズーム（利用者の指示）----

   前の「引いて見る」は**バブルの直径だけ**を 0.8／0.6 倍にしていた。水面の広さは
   そのままなので、同じ面により多く収まる。けれど利用者の言うとおり、これは
   **ズームアウトではない**。ズームは「同じ世界を、遠くから見る」ことなので、
   遠ざかれば水面も枠も一緒に小さくなる。中身だけ縮むのは別の概念だった。

   面ごと縮める本物のズームに替えた。はじめは「世界の広さは変えない」で組んだが、
   それだと**引いても見えるものが増えない**（端まで最初から見えているので、
   出てくるのは水の外側の余白だけ）。そのとおりの指摘を受けて、いまは

     **引いたぶんだけ、海そのものが広がる。**

   世界の広さ ＝ 画面 ÷ 倍率（ただし 1.00 より近づくときは広げない）。
   0.45 まで引けば海は縦横 2.2倍＝**面積 4.9倍**になり、そのぶん余裕ができる。
   画面に映る海の大きさは、どの段でも画面いっぱいのまま（広げたぶんを同じ率で縮めるので）。

   広げ縮めの受け口は drift の ResizeObserver がもともと持っている。
   あれは**相対位置を保ったまま伸縮させる**ので、引くとバブルの間隔が世界の px で
   広がり、画面では「その場で小さくなって、すきまが空く」ように見える。戻せば戻る。

   1.00 より近づくときは世界を狭めない（狭めると、近づくほどバブルが押し込まれる）。
   代わりに、はみ出したぶんを寄せ（pan）で見て回る。

   ---- 座標系 ----

   .sea-view（新設）は**カメラの窓**——ステージいっぱいのまま、はみ出しを clip するだけ。
   倍率と寄せは、その中の .sea-world に掛ける。世界を広げてから同じ率で縮めるので、
   映る大きさは画面ぴったりに戻る。窓が clip するので、隣の面は外へ出てこない。

   （はじめは窓のほうを縮めていた。世界が画面と同じ大きさのうちは同じ絵になるが、
     世界が画面より広くなった途端に**窓が先に切り落とす**ので、広げたぶんが見えない。
     実際に、引くと水が細い帯になった。）

   CSS の変形は**3つの別々の口**を使う（合成の順は translate → scale → transform）：

     translate … 寄せ。     scale の**外**なので、値は画面の px
     scale     … 倍率
     transform … 面の切り替え。scale の**中**なので、値は世界の px

   3つは互いを上書きしない。おかげで面の切り替えの式は1文字も変えなくていい
   （もともと世界の px で書いてあり、それがそのまま正しい単位になる）。

   指の px から世界の px へ戻すのは、倍率で割るだけ。drift.js へは倍率を渡さない
   ——渡し忘れると静かにずれるので、あちらが host の
   getBoundingClientRect（倍率つき）と clientWidth（倍率なし）の比から自分で出す。

   段は 0.4〜2.4。0.4 まで引くと 78px のバブルが 31px になり、タップ目標 44 を割る。
   割ってよいことにしたのは、引いた状態が「眺める」状態だから——押すなら近づく。

   **段送りのボタン（「引いて見る」）は削除した**（利用者の指示）。
   動かす口はホイール（Mac の2本指スワイプ）とつまむ指の2つだけになる。
   海の上に浮いていた札が1枚減って、水が広く見えるのが狙い。
   **代わりに失うもの**：指1本しか使えない場面と、鍵盤だけで操作する人に、
   倍率を動かす道が無い（前はボタンがその道だった）。ここは申し送りに残す。

   ズームは画面を離れると 1.0 に戻す。小さいまま・寄せたまま開くと
   「なぜ端が見えないのか」が分からなくなるため。 */
const Z_MIN = 0.4, Z_MAX = 2.4;
const Z_WHEEL = 0.0022;      /* ホイール1px ぶんの指数。100px で約 1.25 倍 */

/* **2つ持つ理由。**ホイールは掛け算で効くので、引いて戻すと 0.99996 のような
   端数が残る。それをそのまま使うと「戻したのに枠が付いたまま・ボタンが〈もどす〉のまま」
   になる（実際になった）。そこで 1.00 の近くは 1.00 に吸い付かせる。
   吸い付かせた値だけを持つと、細かく刻むトラックパッドが谷から出られなくなるので、
   刻みを足していく生の値（zRaw）と、実際に掛ける値（zLevel）を分ける。 */
const Z_SNAP = 0.02;
let zRaw = 1;
let zLevel = 1;
let panX = 0, panY = 0;      /* 画面 px。倍率が 1 以下なら必ず 0（世界は真ん中） */
const zoom = () => zLevel;
const r3 = v => Math.round(v * 1000) / 1000;

/* 世界の広さ（世界の px）。引いたぶんだけ広げる。近づくときは広げない。
   これを .sea-world の width/height に入れる＝ .sea-face もそれに従い、
   drift の当たり判定（host.clientWidth/Height）もそのまま広がる。 */
function worldSize() {
  const w = (stage && stage.clientWidth) || 0, h = (stage && stage.clientHeight) || 0;
  const k = 1 / Math.min(1, zLevel || 1);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/* 画面に映る海の大きさ（画面の px）＝ 世界 × 倍率。
   1.00 以下ではちょうど画面と同じ、1.00 を超えたぶんだけ画面からはみ出す。 */
function shownSize() {
  const ws = worldSize();
  return { w: ws.w * zLevel, h: ws.h * zLevel };
}

/* 寄せられる幅。はみ出した半分まで（＝世界の外は決して見えない）。
   はみ出していなければ 0＝真ん中に置く。 */
function panLimit() {
  const w = (stage && stage.clientWidth) || 0, h = (stage && stage.clientHeight) || 0;
  const sh = shownSize();
  return { x: Math.max(0, (sh.w - w) / 2), y: Math.max(0, (sh.h - h) / 2) };
}

/* 見え方だけを書き換える（毎フレーム呼ばれる側。看板の作り直しはしない） */
function applyView() {
  if (!view || !stage || !world) return;
  const w0 = stage.clientWidth || 0, h0 = stage.clientHeight || 0;
  /* 世界を広げ縮めする。左上を 0 に置いたまま負の余白で中心を合わせる
     （transform の3つの口は倍率・寄せ・面の切り替えで埋まっているので、
       位置合わせには余白を使う。互いを上書きしない） */
  const ws = worldSize();
  if (ws.w && ws.h && (ws.w !== world.clientWidth || ws.h !== world.clientHeight)) {
    world.style.width = ws.w + 'px';
    world.style.height = ws.h + 'px';
    world.style.marginLeft = Math.round((w0 - ws.w) / 2) + 'px';
    world.style.marginTop = Math.round((h0 - ws.h) / 2) + 'px';
    /* 広さが変わったことを、その場で drift へ伝える。
       drift 自身も ResizeObserver で見ているが、あれは「次の描画の前」なので、
       描画が来ない状況では遅れる。遅れると中身が古い広さのまま隅に残る。 */
    liveFaces().forEach(f => {
      const fl = faces[f] && faces[f].field;
      if (fl && fl.syncBounds) { try { fl.syncBounds(); } catch (err) { /* 測れないだけ */ } }
    });
  }
  const lim = panLimit();
  panX = clamp(panX, -lim.x, lim.x);
  panY = clamp(panY, -lim.y, lim.y);
  /* 端数（1e-14 など）は 0 にする。真なら translate を書いてしまうので */
  if (Math.abs(panX) < 0.5) panX = 0;
  if (Math.abs(panY) < 0.5) panY = 0;
  world.style.scale = zLevel === 1 ? '' : String(r3(zLevel));
  world.style.translate = (panX || panY)
    ? Math.round(panX) + 'px ' + Math.round(panY) + 'px' : '';
  stage.classList.toggle('is-zoomed', zLevel !== 1);
  stage.classList.toggle('is-zoomed-out', zLevel < 1);
  stage.style.setProperty('--sea-zoom', String(r3(zLevel)));

}
function applyZoom() { applyView(); }

/* 画面の点 (px,py) の下にあるものを動かさずに倍率を変える。
   ホイールならポインタの下、つまむ指なら2本の真ん中が動かない。
   .sea-world は負の余白で窓の真ん中に置いてあるので、変形の原点＝ステージの中心。 */
function zoomTo(nz, px, py) {
  if (!stage) return;
  const z0 = zLevel;
  zRaw = clamp(nz, Z_MIN, Z_MAX);
  const z1 = Math.abs(zRaw - 1) < Z_SNAP ? 1 : zRaw;
  /* 掛ける値が動かなくても zRaw は進めておく（谷から出られるように） */
  if (Math.abs(z1 - z0) < 0.0005) { zLevel = z1; return; }
  const r = stage.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ax = (px == null) ? cx : px;
  const ay = (py == null) ? cy : py;
  const wx = (ax - cx - panX) / z0, wy = (ay - cy - panY) / z0;
  zLevel = z1;
  panX = ax - cx - wx * z1;
  panY = ay - cy - wy * z1;
  applyZoom();
}

function resetZoom() {
  zRaw = 1; zLevel = 1; panX = 0; panY = 0;
  applyZoom();
}

/* 中央（ぜんぶ）の海の絞り込み（利用者の指示。タグごと → **複数選べる**）。

   選べるのは：
     PAST_ONLY / FUTURE_ONLY … 今日より前・今日より後の日が付いているもの
     タグの id               … そのタグが付いているもの

   **重ねると「または」**（選んだ種類のどれかが当てはまるもの）。

   **「まだどこにも」の行は外した**（利用者の指示）。既定の眺めが
   「タグ無しだけ」になった時点で、あの行はほとんど同じものを指していて、
   並んでいると「どちらを押せばいいのか」が生まれるだけだった。

   最初は「かつ」で組んだ。「絞る」という言葉から素直に考えたが、**言葉から考えて、
   データを見ていなかった。**このアプリでは1件が持つ置き場所のタグはふつう1つなので、
   **2つ選ぶと必ず0件になる**（実測：組み合わせ15通りすべてで0）。
   それでは重ねる意味が無い。

   「または」でも絞り込みではある——「ぜんぶ」から「この種類だけ」へ狭めている。
   狭め方が「全部を同時に持つもの」ではなく「どれかを持つもの」というだけ。
   実測：きっかけ＋すきま＝9件、今日＋きっかけ＝5件。どれも使える数になる。

   空っぽ＝絞らない（＝ぜんぶ）。「ぜんぶ」は一覧の先頭に置いた選択の取り消しで、
   トグルではない。

   **タグごとの絞り込みが要る理由**：向きは左右の2つしか無く、上下は固有枠なので、
   ユーザーのタグは3つ目から「海が無い」状態になる。絞り込みがその見に行く道になる。
   長期保留も、ふだんはどの海にも出ないが、ここから呼べば出る。 */
/* 日付での絞り込み（利用者の指示）。タグではないので、タグと同じ入れものに
   混ぜるための擬似 id を持たせる */
const PAST_ONLY = '\u0000past';
const FUTURE_ONLY = '\u0000future';
const PAST_NAME = '今日より前';
const FUTURE_NAME = '今日より後';
const narrowSet = new Set();
let shown = false;
let unsubscribe = null;
let ro = null;
let stopTimer = 0;

/* 整列グリッドのバブル。再描画をまたいで使い回す（掴んでいる最中に作り直さないため） */
const gridNodes = new Map();      /* id -> { node, detach } */

/* 開いている詳細。ノードは再描画をまたいで使い回す（入力中の値を落とさないため／契約 §14） */
const details = new Map();        /* id -> { node, flush, sync } */
let openDetailId = null;

/* ---------------- store への薄い当たり ----------------
   データ層は並行して書き換わっている。関数が無い間も画面が落ちないよう、
   既存 todo.js と同じく「無ければ何も無い」として扱う。
   タグ API（追補3 §7）はまだ無いかもしれないので、呼ぶたびに有無を見る。 */

function has(name) { return typeof store[name] === 'function'; }

function hasTags() { return has('tagDir') && has('inTag'); }

/* 固有枠（上＝長期保留 / 下＝完了）のタグ。無ければ null */
function fixedTag(dir) {
  if (!hasTags() || (dir !== 'up' && dir !== 'down')) return null;
  try { return store.tagDir(dir) || null; } catch (err) { return null; }
}

/* その**面**のタグ。中央は null（タグ無しの海なので） */
function faceTag(face) {
  if (!face || face === 'center') return null;
  if (face === 'up' || face === 'down') return fixedTag(face);
  const id = tagIdOfFace(face);
  if (!id) return null;
  return seaTags().find(t => t.id === id) || null;
}

/* いま居る面から見て、その**画面の向き**にある面。無ければ null。
     ・列の中     … 左＝1つ前の列 / 右＝1つ次の列
     ・中央だけ   … 上下の固有枠へも行ける（上下は列とは別の軸で、中央にだけ付く）
     ・上下から   … 下／上（＝中央）へ戻る */
function faceAt(dir, from) {
  const cur = from || curFace;
  if (cur === 'up') return dir === 'down' ? 'center' : null;
  if (cur === 'down') return dir === 'up' ? 'center' : null;
  const order = ['center'].concat(seaTags().map(t => faceOfTag(t.id)));
  const i = order.indexOf(cur);
  if (i < 0) return null;
  if (dir === 'left') return i > 0 ? order[i - 1] : null;
  if (dir === 'right') return i + 1 < order.length ? order[i + 1] : null;
  /* 上下は中央の列にだけ付く */
  if (cur !== 'center') return null;
  return fixedTag(dir) ? dir : null;
}

/* その向きの面のタグ */
function dirTagAt(dir, from) { return faceTag(faceAt(dir, from)); }

function daysOfSafe(id) {
  if (!has('daysOf')) return [];
  try { const r = store.daysOf(id); return Array.isArray(r) ? r : []; } catch (err) { return []; }
}

function todayKeySafe() {
  if (!has('todayKey')) return '';
  try { return String(store.todayKey() || ''); } catch (err) { return ''; }
}

/* 日付キーは YYYY-MM-DD なので、**文字列の大小がそのまま日の前後**になる
   （0 詰めの固定長。数に直す必要が無い） */
function hasFutureDay(t, key) {
  const k = key || todayKeySafe();
  return !!k && daysOfSafe(t.id).some(d => d > k);
}
function hasPastDay(t, key) {
  const k = key || todayKeySafe();
  return !!k && daysOfSafe(t.id).some(d => d < k);
}

function tagsOfSafe(id) {
  if (!has('tagsOf')) return [];
  try { const r = store.tagsOf(id); return Array.isArray(r) ? r : []; } catch (err) { return []; }
}

/* タグの色は store が持つ文字列。CSS 変数へ流す前にざっと形を見る
   （宣言値をそのまま流すと、思わぬものが混ざったときに崩れ方が読めない）。 */
const COLOR_OK = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([-0-9.,%\s/]+\)|var\(--[a-z0-9-]+\))$/i;

function colorOf(tag, dir) {
  const c = tag && typeof tag.color === 'string' ? tag.color.trim() : '';
  if (c && COLOR_OK.test(c)) return c;
  /* 控えは列の順に配る。dir には面の名前が来ることもある（'sea:xx'） */
  const i = colOf(dir);
  return FALLBACK_COLORS[(i + FALLBACK_COLORS.length) % FALLBACK_COLORS.length] || 'var(--bub-edge)';
}

function nameOf(tag) {
  const n = tag && typeof tag.name === 'string' ? tag.name : '';
  return n || 'タグ';
}

/* タグの色（id -> 色文字列）。バブルそのものを色づけるのに使う（追補4 §1）。
   store.tags() は毎回コピーを作るので、1回の描画のあいだは覚えておく。
   タグの色や名前が変わったときは store が render を呼ぶので、そこで捨てる。 */
let tagColorCache = null;

function forgetTagColors() { tagColorCache = null; }

function tagColorMap() {
  if (tagColorCache) return tagColorCache;
  const m = new Map();
  if (has('tags')) {
    try {
      (store.tags() || []).forEach(tg => {
        if (!tg || typeof tg.id !== 'string' || typeof tg.color !== 'string') return;
        const c = tg.color.trim();
        if (c && COLOR_OK.test(c)) m.set(tg.id, c);   /* 読めない値は捨てる＝タグ無し扱い */
      });
    } catch (err) { /* タグの無い版。色も無い */ }
  }
  tagColorCache = m;
  return m;
}

/* その項目に付いているタグの色。付いていなければ空配列（＝いまの青いバブル）。
   完了の海のバブルには、tagsOf が返す 'done' の色がそのまま入る。 */
/* タグの名前。色と同じ並び。色だけで表すと、色を見分けられない人に
   所属が伝わらない（WCAG 1.4.1）。バブルには文字を足さず、読み上げ文にだけ載せる。 */
function namesOf(t) {
  if (!has('tagsOf') || !has('tags')) return [];
  let ids, all;
  try { ids = store.tagsOf(t.id) || []; all = store.tags() || []; }
  catch (e) { return []; }
  const by = new Map(all.map(x => [x.id, x.name]));
  return ids.map(x => by.get(x)).filter(n => typeof n === 'string' && n);
}

function colorsOf(t) {
  const ids = tagsOfSafe(t.id);
  if (!ids.length) return [];
  const map = tagColorMap();
  const out = [];
  ids.forEach(id => { const c = map.get(id); if (c) out.push(c); });
  return out;
}

/* ---- 海に既定では出さないタグ（利用者の指示）----

   > 「全ての海のデフォルトを、今日 + 未整理 + プライベート + 仕事 だけにして
   >  正確に言えば以下三つが入っているものは除きたい（Not filter）
   >  きっかけ／すきま／長期保留：毎日考えるものではない」

   3つに共通するのは、**毎日は考えないもの**であること。そしてどれも、
   ここではない置き場所を自分で持っている：

     きっかけ … 「きっかけ」の画面（枠にぶら下がっている）
     すきま   … 「すきま」の画面
     長期保留 … 上の海（「いまは見ない」と決めたもの）

   だから海から外しても、行き場を失うものは無い。

   **UI は1つも増やしていない**（指示：UIを複雑化せずに）。
   絞り込み（▽しぼる）の一覧にはもともと全部のタグが並んでいるので、
   **そこでそのタグを選べば出る**。「または」の絞り込みはそのまま、
   既定で出さないものの数が 1つ（長期保留）から 3つに増えただけ。

   ならべる（一覧）はこの規則を継がない。あそこは「ぜんぶ読む場所」で、
   既定の眺めではないため（長期保留だけは前から外している——
   あれは自分で「見ない」と決めたものなので）。 */
const QUIET_TAGS = ['hold', 'plan', 'gap'];

/* その項目が持っている「静かなタグ」。except に渡した1つは数えない
   （その海そのもののタグ。長期保留の海が長期保留を出せなくなるのを防ぐ） */
function quietOf(t, except) {
  if (!t) return [];
  const ids = tagsOfSafe(t.id);
  return QUIET_TAGS.filter(k => k !== except && ids.indexOf(k) >= 0);
}

function isQuietItem(t, except, key) {
  if (quietOf(t, except).length) return true;
  /* 今日より後に置いてあるものも、その日になったら出てくる。いまは出さない */
  return hasFutureDay(t, key);
}

/* 長期保留。上の海（と、絞り込みで名指ししたとき）だけに出る。
   完了と同じ扱い方だが、意味は別もの——
   完了は「終わった」、長期保留は「まだ終わっていないが、いまは見ない」。 */
function isHoldItem(t) {
  if (!t) return false;
  if (has('isHold')) { try { return !!store.isHold(t.id); } catch (err) { /* 落ちない */ } }
  return !!t.hold;
}

function isDoneItem(t) {
  if (!t) return false;
  if (has('isDone')) { try { return !!store.isDone(t.id); } catch (err) { /* 落ちない */ } }
  return !!t.done;
}

/* 絞り込みが効いているか。
   タグ API が無い版では中央がもともと store.floating()（＝未分類だけ）なので、
   絞っても何も変わらない。そういう版では切り替え自体を出さない。 */
function narrowOn() { return narrowSet.size > 0 && hasTags(); }

/* 新しいほうから SEA_MAX 件だけ残す。**並びは元のまま**——
   drift はノードを id で使い回すので、並べ替えると使い回しが崩れる。
   どれを残すかだけを決めて、順番には触らない。 */
let seaClipped = false;

function capForSea(list) {
  seaClipped = list.length > SEA_MAX;      /* 直後に読むこと（syncMore を参照） */
  if (!seaClipped) return list;
  const newest = list.slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, SEA_MAX);
  const keep = new Set(newest.map(t => t.id));
  return list.filter(t => keep.has(t.id));
}

/* 中央の海の既定＝**タグが1つも付いておらず、今日より後の日も付いていないもの**
   （利用者の指示）。

   前は「今日・未整理・仕事・プライベートは出す／きっかけ・すきま・長期保留は出さない」
   という数え上げだったが、それでもまだ違和感が残ると言われた。いまは規則が1つになる：

     **既定 … タグの付いていないものだけ**
     **絞ると … 選んだタグのどれかが付いているもの（または）**

   タグを持つものは、そのタグの置き場所（今日の画面・きっかけ・すきま・上の海・
   左右の海）に必ず出る。だから中央から外しても、どこにも出ないものは生まれない。
   中央は**まだ行き先の決まっていないものが漂うところ**になる。

   **日付だけは特別にもう一段いる。**「今日より後」に置いたものはタグを持たない
   ことがある（days に未来の日が入っているだけ）。あれは「その日になったら出てくる」
   ものなので、いま漂わせない（利用者の言葉：いつか見るので）。
   「今日より前」は外さない——やろうとして、やらなかったもの。海に居るのが正しい。

   完了はどの場面でも出さない（下の海とふりかえりに専用の道がある）。 */
function centerItems() {
  if (!hasTags()) return capForSea(store.floating());
  const key = todayKeySafe();
  const live = store.all().filter(t => !isDoneItem(t));
  if (!narrowSet.size) {
    return capForSea(live.filter(t => !tagsOfSafe(t.id).length && !hasFutureDay(t, key)));
  }
  /* 選んだうちの**どれかが当てはまれば出す**（「または」）。
     絞ったあとにも上限はかける——絞り込みは「どれを見るか」で、
     一度に出す数の話とは別だから */
  return capForSea(live.filter(t => {
    const tags = tagsOfSafe(t.id);
    for (const k of narrowSet) {
      if (k === PAST_ONLY) { if (hasPastDay(t, key)) return true; }
      else if (k === FUTURE_ONLY) { if (hasFutureDay(t, key)) return true; }
      else if (tags.indexOf(k) >= 0) return true;
    }
    return false;
  }));
}

/* 絞り込みに出す一覧。**完了は出さない**（下の海とふりかえりに専用の道がある）。
   先頭の「ぜんぶ」は選択の取り消しで、重ねる対象ではない（id が null） */
function narrowChoices() {
  /* 先頭は選択の取り消し。**押すと既定の眺め（タグ無しだけ）に戻る**ので、
     「ぜんぶ」ではなくその眺めの名前を出す（押した先に在るものを名乗る） */
  const out = [
    { id: null, name: CENTER_VIEW_NAME },
    { id: PAST_ONLY, name: PAST_NAME },
    { id: FUTURE_ONLY, name: FUTURE_NAME },
  ];
  if (!has('tags')) return out;
  try {
    (store.tags() || []).forEach(t => {
      if (!t || typeof t.id !== 'string' || t.id === 'done') return;
      out.push({ id: t.id, name: nameOf(t), color: colorOf(t, null) });
    });
  } catch (err) { /* タグの無い版 */ }
  return out;
}

/* いま絞っているものの名前。絞っていなければ null。
   2つ以上あるときは「◯◯ と 2つ」——全部並べると札からはみ出すため */
function narrowName() {
  if (!narrowSet.size) return null;
  const all = narrowChoices();
  const names = [...narrowSet]
    .map(k => (all.find(x => x.id === k) || {}).name)
    .filter(n => typeof n === 'string' && n);
  if (!names.length) return null;
  return names.length === 1 ? names[0] : names[0] + ' と ' + (names.length - 1) + 'つ';
}

function faceItems(face) {
  if (face === 'center') return centerItems();
  const tag = faceTag(face);
  if (!tag) return [];
  if (tag.id === 'done') {
    if (has('doneItems')) { try { return capForSea(store.doneItems() || []); } catch (err) { return []; } }
    return capForSea(store.all().filter(isDoneItem));
  }
  let list;
  try { list = store.inTag(tag.id) || []; } catch (err) { return []; }
  /* タグの海も同じ規則。**その海そのもののタグだけは数えない**ので、
     長期保留の海は長期保留を出すし、きっかけを左右へ置いた人の海も空にならない */
  const key = todayKeySafe();
  return capForSea(list.filter(t => !isQuietItem(t, tag.id, key)));
}

function isStarted(t) {
  if (!has('isStarted')) return false;
  if (store.isStarted(t.id, null)) return true;
  const as = Array.isArray(t.anchors) ? t.anchors : [];
  return as.some(a => store.isStarted(t.id, a));
}

/* 「はじめた」をどのアンカーに付けるか。
   アンカーにぶら下がっていればそのアンカー、そうでなければ null（アンカー無しの記録）。
   海・すきま・きっかけ未分類でも記録できる（追補3 §6 で store の制限を外した）。 */
function startTarget(t) {
  if (!t) return undefined;
  const as = Array.isArray(t.anchors) ? t.anchors : [];
  return as.length ? as[0] : null;
}

function itemOf(t) {
  return { id: t.id, text: t.text, started: isStarted(t) };
}

/* 追補4 §1：タグは点（marks）ではなく、バブルそのものの色で表す。
   marks / anchorHue は渡すのをやめた（追補4 §1 が「消しても構わない」としている）。
   残したままにすると、点を描く側のコードが消えかけている間に落ちる——実際に落ちた
   （bubble.js の marks を描く枝が markColor を参照したまま消えていた）。
   点を組み立てていた marksOf() も、絞り込みが「まだどこにも」を持たなくなって
   使い道が無くなったので落とした（A-48）。 */
function optsOf(t, size) {
  return { size, colors: colorsOf(t), tagNames: namesOf(t) };
}

function detailOf(fn, id) {
  return (has(fn) && store[fn](id)) || '';
}

function trim(s) {
  const a = Array.from(String(s));
  return a.length > 14 ? a.slice(0, 14).join('') + '…' : String(s);
}

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* ---------------- 5分だけの集中 ----------------
   focus.js は動的に読む。静的 import にすると、focus.js が壊れている間は
   この画面ごと読めなくなるため（既存 todo.js と同じ）。
   押した時点では記録しない。5分にたどりついたときだけ「はじめた」を立てる。 */

function openFive(id) {
  const t = store.get(id);
  if (!t) return;
  import('../focus.js').then(m => {
    m.openFocus({
      id:        id,
      title:     t.text,
      firstStep: detailOf('firstStepOf', id),
      url:       detailOf('urlOf', id),
      minutes:   5,
      onClose(info) {
        /* 集中画面の [完了]。completed:true のとき reachedGoal は false に落ちている
           （完了と はじめた を両方立てない）。音・トースト・取り消しはこの画面の担当 */
        if (info && info.completed) { completeWithUndo(id); render(); return; }
        if (info && info.reachedGoal) {
          markStarted(id);
          render();   /* store 側が通知しなかったときのために引き直す */
        }
      },
    });
  }).catch(err => { console.error(err); toast('集中の画面をいま開けない。'); });
}

/* 記録できたら true。できないときは黙って落とさず、理由を出す
   （押しても何も起きない、が画面に残るのはいちばん困る） */
function markStarted(id) {
  if (!has('start')) return false;
  const t = store.get(id);
  const target = startTarget(t);
  if (target === undefined) return false;      /* 項目が見つからないときだけ */
  return store.start(id, target) !== false;
}

/* ---------------- 入力欄から足す ----------------
   送信（Enter）と「書いて、すぐ始める」（Cmd+Enter）で、足し方は同じ。
   違うのは、そのあと集中の画面を開くかどうかだけ。 */

/* 海へ足して、いまの面のタグを付ける。入力欄は空にする。
   戻り値は足したものの id（取れなかったときは null）。 */
function addFromComposer() {
  const text = input.value.trim();
  if (!text) return null;
  /* 入力欄のあたりから生まれて浮かび上がる見え方にする（位置は割合で渡す） */
  const added = store.add(text, { fx: 0.35 + Math.random() * 0.3, fy: 0.86 + Math.random() * 0.1 });
  const id = added && typeof added === 'object' ? added.id
    : (typeof added === 'string' ? added : null);
  /* 書いたものには、いまいる面のタグが付く。
     中央（ぜんぶ）では何も付かない。完了の海では付けない
     （書いた瞬間に完了になるのは筋が通らない）。 */
  const tag = faceTag(curFace);
  if (id && tag && tag.id !== 'done' && has('setTag')) store.setTag(id, tag.id, true);
  else if (tag && tag.id === 'done') toast('『' + nameOf(tag) + '』には書けないので、ぜんぶの海に入れた');
  input.value = '';
  syncSend();
  /* 焦点は入力欄に残す。この直後に集中の画面が開くときは、そちらへ移る。
     押したボタンに残すと、空になって disabled になった瞬間に焦点が body へ落ちる。 */
  input.focus();
  if (gathering) grid.scrollTop = grid.scrollHeight;   /* 整列中は末尾に生まれる */
  return id;
}

/* 書いて、すぐ始める。海に足して、そのまま5分の集中を開く。
   集中の経路は長押しメニューと同じ openFive を使い回す（新しい口を作らない）。 */
function quickStart() {
  if (!input || !input.value.trim()) return;
  const id = addFromComposer();
  if (!id) { toast('海には足した。集中の画面は開けなかった'); return; }
  openFive(id);
}

function syncSend() {
  const empty = !input.value.trim();
  sendBtn.disabled = empty;
  quickBtn.disabled = empty;
}

/* 時計の印。絵文字ではなく描く（外部画像も読まない／契約 §15）。
   文字盤と、12時を指す短針・5分を指す長針。色は currentColor に任せる */
const SVGNS = 'http://www.w3.org/2000/svg';

function clockIcon() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const face = document.createElementNS(SVGNS, 'circle');
  face.setAttribute('cx', '12');
  face.setAttribute('cy', '12.6');
  face.setAttribute('r', '8.2');
  svg.appendChild(face);

  const hands = document.createElementNS(SVGNS, 'path');
  /* 短針は12時、長針は「5分」の位置。5分だけの集中だと印で分かるように */
  hands.setAttribute('d', 'M12 12.6 V8.4 M12 12.6 L14.9 7.9');
  svg.appendChild(hands);

  return svg;
}

/* さいころの印。「無作為に1つ」を絵で言う。
   絵文字も外部画像も使わない（契約 §15）。色は currentColor に任せる */
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

/* 中央の盤に出す操作。副作用を持たせない（返すだけ）。
   これを渡すと、bubble.js は onMenu を横取りしなくなる。 */
function actionsFor(id) {
  return {
    isDone: has('isDone') ? !!store.isDone(id) : false,
    onStarted: () => { markStarted(id); render(); },
    onComplete: () => {
      if (has('isDone') && store.isDone(id)) { uncompleteWithUndo(id); return; }
      completeWithUndo(id);
    },
    onDelete: (node) => removeWithUndo(id, node),
  };
}

/* ---------------- 長押しメニューの中身（契約 §6） ---------------- */

let lastMenuAt = 0;

function menuFor(id, node) {
  /* 同じ操作が2経路（ジェスチャ層とキーボード）から届いても、メニューは1枚だけにする */
  const now = Date.now();
  if (now - lastMenuAt < 400) return;
  lastMenuAt = now;
  /* 完了したものの上では、メニューの「完了」が「海にもどす」に入れ替わる。
     完了の海から戻す道は、ここにしか無い。 */
  openMenu(node, {
    isDone: has('isDone') ? !!store.isDone(id) : false,
    onDetail:  () => openDetail(id),
    onFocus:   () => openFive(id),
    onStarted: () => { markStarted(id); render(); },
    onComplete: () => {
      if (has('isDone') && store.isDone(id)) { uncompleteWithUndo(id); return; }
      completeWithUndo(id);
    },
    onDelete:  () => removeWithUndo(id, node),
  });
}

/* 完了。音を鳴らし、トーストから取り消せる（契約 §6）。
   complete() の戻り値の形はデータ層側で変わりうる（追補3 §3 で「消さない」へ移る途中）ので、
   スナップショットでも項目そのものでも受けられるようにしておく。 */
function completeWithUndo(id) {
  if (!has('complete')) return;
  const before = store.get(id);
  const r = store.complete(id);
  if (!r) return;
  try { playComplete(); } catch (err) { console.error(err); }
  const text = (r.item && r.item.text) || r.text || (before && before.text) || '';
  toast('「' + trim(text) + '」を完了', {
    label: '取り消す',
    on: () => {
      if (has('uncomplete') && store.uncomplete(id) !== false) return;
      if (has('restore')) store.restore(r);
    },
  });
}

/* 完了の海から海へ戻す。音は鳴らさない（戻すのは達成ではない） */
function uncompleteWithUndo(id) {
  if (!has('uncomplete')) return;
  const t = store.get(id);
  const name = trim(t ? t.text : '');
  if (store.uncomplete(id) === false) return;
  toast('「' + name + '」を海にもどした', {
    label: '取り消す',
    on: () => { if (has('complete')) store.complete(id); },
  });
}

/* 消す = 従来どおり。音は鳴らさない */
function removeWithUndo(id, node) {
  if (node && node.isConnected) {
    node.classList.add('is-popping');   /* CSS があればはじける。無ければ何も起きない */
  }
  const snap = store.remove(id);
  if (!snap) return;
  toast('「' + trim(snap.item ? snap.item.text : '') + '」を消した', {
    label: '元に戻す', on: () => store.restore(snap),
  });
}

/* ---------------- タブへのドロップ（契約 §2） ----------------
   所属は「追加」であって「移動」ではない。today / gap / anchors は独立して足される。 */

/* トーストに出す日の言い方。今日なら「今日」、先なら「9/1（火）」 */
function dayWord(key) {
  if (typeof store.todayKey !== 'function' || key === store.todayKey()) return '今日';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '今日';
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  return (d.getMonth() + 1) + '/' + d.getDate()
    + '（' + ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] + '）';
}

function dropToTab(id, tabId) {
  const t = store.get(id);
  if (!t) return;

  if (tabId === 'today') {
    if (!has('setToday')) return;
    /* 落とし先は「今日の画面がいま映している日」。過去を映しているときは null
       ——過去はその日の記録なので、あとから足させない */
    const key = (typeof dropDay === 'function' && has('setDay')) ? dropDay() : store.todayKey();
    if (!key) { toast('過ぎた日には足せない'); return; }
    if (store.daysOf(id).indexOf(key) >= 0) {
      toast('「' + trim(t.text) + '」はもう ' + dayWord(key) + 'にある');
      return;
    }
    store.setDay(id, key, true);
    toast('「' + trim(t.text) + '」を' + dayWord(key) + 'へ', {
      label: '取り消す', on: () => store.setDay(id, key, false),
    });
    return;
  }

  if (tabId === 'gap') {
    if (!has('setGap')) return;
    if (t.gap) { toast('「' + trim(t.text) + '」はもうすきまにある'); return; }
    store.setGap(id, true);
    toast('「' + trim(t.text) + '」をすきまへ', {
      label: '取り消す', on: () => store.setGap(id, false),
    });
    return;
  }

  if (tabId === 'plan') {
    /* どのアンカーへぶら下げるかは、ここでは決めない（勝手に選ぶと知らない場所に付く）。
       store 側に「きっかけの未分類」が用意されたので、そこまで運んで手を止める。
       用意が無い版のときは、何も変えずに置き場所だけ伝える。 */
    if (!has('setPlan')) { toast('きっかけの画面で置いてください'); return; }
    store.setPlan(id, true);
    toast('「' + trim(t.text) + '」をきっかけの未分類へ', {
      label: '取り消す', on: () => store.setPlan(id, false),
    });
    return;
  }

  if (tabId === 'sea') {
    /* 海へのドロップは全解除（契約 §2）。整列中は分類済みも並ぶので、ここが呼び戻し口になる。
       もともと海にいるものは何も起きない。 */
    clearAll(id, t);
  }
}

function clearAll(id, t) {
  const anchors = Array.isArray(t.anchors) ? t.anchors.slice() : [];
  const wasPlan = has('isPlan') && store.isPlan(id);
  if (!t.today && !t.gap && !anchors.length && !wasPlan) return;   /* もう海にいる */

  if (has('setToday')) store.setToday(id, false);
  if (has('setGap')) store.setGap(id, false);
  if (has('clearAnchors')) store.clearAnchors(id);
  else if (has('setAnchor')) anchors.forEach(a => store.setAnchor(id, a, false));
  if (has('setPlan')) store.setPlan(id, false);

  toast('「' + trim(t.text) + '」を海へ戻した', {
    label: '取り消す',
    on: () => {
      if (t.today && has('setToday')) store.setToday(id, true);
      if (t.gap && has('setGap')) store.setGap(id, true);
      if (has('setAnchor')) anchors.forEach(a => store.setAnchor(id, a, true));
      if (wasPlan && !anchors.length && has('setPlan')) store.setPlan(id, true);
    },
  });
}

/* ---------------- バブルを端へ運ぶ = タグが付く（追補3 §1） ----------------
   bubble.js が教えてくれるのは「タブバーへ落とした」だけ。
   画面の端で離したかどうかは、指先の座標を自分で見て決める（plan.js / gap.js と同じ）。 */

let bubbleDrag = null;              /* { id } */
let lastPt = { x: -1, y: -1 };
let tabDropped = false;             /* このドラッグをタブが受けたか。端の判定と二重にしない */
let overEdge = null;

function onBubblePointer(ev) {
  lastPt = { x: ev.clientX, y: ev.clientY };
  markEdge(edgeHitAt(lastPt.x, lastPt.y));
  markOff(offHitAt(lastPt.x, lastPt.y));
}

/* ---------------- タグを外す枠（利用者の指示） ----------------

   バブルを掴んでいる間だけ、**下の真ん中**に出す。そこへ持っていって
   **少し置いてから離す**と、いまの海のタグが外れる。

   なぜ「置いてから」なのか。端の帯（タグを付ける）は触れて離せばすぐ付くが、
   外すほうは戻す手間が違う（付け直すには、その海まで運び直すことになる）。
   だから、うっかり通り過ぎただけでは外れないようにした。時間は 0.5秒。

   **ぜんぶの海には出さない**（利用者の指示）。あそこは「すべて」で、
   外す相手のタグが1つに決まらないため。

   置いてある時間そのものは画面に出さない（0.5 と数字を出すと、
   このアプリが数えないことにしているものが1つ増える）。出すのは
   「まだ」と「離すと外れる」の2つの姿だけ。 */
const OFF_MS = 500;
let dropOff = null, offLabel = null;
let offTimer = 0, offArmed = false, offIn = false;

/* いまの海のタグ。ぜんぶの海なら null＝枠を出さない */
function offTag() {
  return faceTag(curFace);
}

/* 当たり判定は、出ている枠の矩形そのもの（見えている範囲＝当たる範囲）。
   ドロップ判定は指先の座標で（契約 §14。バブルの外形は広すぎる） */
function offHitAt(x, y) {
  if (!dropOff || dropOff.hidden) return false;
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) return false;
  const q = dropOff.getBoundingClientRect();
  if (!q.width || !q.height) return false;
  return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom;
}

function syncOffLabel() {
  if (!offLabel) return;
  const tag = offTag();
  if (!tag) return;
  const name = trim(nameOf(tag));
  /* 端の帯（「〈仕事〉 が付く」）と同じ言い方にそろえる＝「いま離すとどうなるか」 */
  offLabel.textContent = offArmed
    ? '離すと『' + name + '』が外れる'
    : 'ここに少し置くと『' + name + '』が外れる';
}

function setOffArmed(on) {
  if (offArmed === on) return;
  offArmed = on;
  if (dropOff) dropOff.classList.toggle('is-armed', on);
  syncOffLabel();
}

function markOff(inside) {
  if (inside === offIn) return;
  offIn = inside;
  if (dropOff) dropOff.classList.toggle('is-over', inside);
  clearTimeout(offTimer); offTimer = 0;
  if (!inside) { setOffArmed(false); return; }
  offTimer = setTimeout(() => { offTimer = 0; setOffArmed(true); }, OFF_MS);
}

function clearOff() {
  clearTimeout(offTimer); offTimer = 0;
  offIn = false; offArmed = false;
  if (dropOff) dropOff.classList.remove('is-over', 'is-armed');
}

function renderOff() {
  if (!dropOff) return;
  const tag = bubbleDrag ? offTag() : null;
  dropOff.hidden = !tag || gathering;
  if (!tag) return;
  syncOffLabel();
}

/* 外す。付けるほう（tagFromEdge）と対にしてある */
function untagHere(id, tag) {
  const t = store.get(id);
  if (!tag || !t) return;
  if (!has('setTag')) { toast('いまはタグを外せない'); return; }
  const name = nameOf(tag);
  if (tagsOfSafe(id).indexOf(tag.id) < 0) {
    toast('「' + trim(t.text) + '」に『' + trim(name) + '』は付いていない');
    return;
  }
  /* 長期保留を外すと、もどってくる日も一緒に落ちる。戻すときに書き戻せるよう控える */
  const until = (tag.id === 'hold' && has('holdUntil')) ? store.holdUntil(id) : null;
  if (store.setTag(id, tag.id, false) === false) return;
  const back = () => {
    if (!has('setTag')) return;
    store.setTag(id, tag.id, true);
    if (until && has('setHoldUntil')) store.setHoldUntil(id, until);
  };
  const nm = trim(t.text);
  if (tag.id === 'done') {
    toast('「' + nm + '」を、まだのほうへ戻した', { label: '取り消す', on: back });
    return;
  }
  if (tag.id === 'hold') {
    toast('「' + nm + '」の長期保留をやめた', { label: '取り消す', on: back });
    return;
  }
  toast('「' + nm + '」から『' + trim(name) + '』を外した', { label: '取り消す', on: back });
}

function beginBubbleDrag(id) {
  cancelSwipe();
  bubbleDrag = { id };
  tabDropped = false;
  lastPt = { x: -1, y: -1 };       /* 1度も動かなかったら判定しない */
  window.addEventListener('pointermove', onBubblePointer, true);
  window.addEventListener('pointerup', onBubblePointer, true);
  stage.classList.add('is-bubdrag');
  clearOff();
  renderEdges(); renderSigns(); renderOff();
}

function endBubbleDrag() {
  const d = bubbleDrag;
  bubbleDrag = null;
  window.removeEventListener('pointermove', onBubblePointer, true);
  window.removeEventListener('pointerup', onBubblePointer, true);
  stage.classList.remove('is-bubdrag');
  const pt = lastPt;
  /* 外す枠の判定は**畳む前に**。畳むと矩形が取れない。
     置いた時間が足りていなければ（offArmed が偽）、ここは何もしない */
  const offT = (offArmed && offHitAt(pt.x, pt.y)) ? offTag() : null;
  markEdge(null);
  clearOff();
  renderEdges(); renderSigns(); renderOff();
  if (!d) return;
  /* onDropToTab と onDragEnd のどちらが先に来るかは決まっていないので、
     マイクロタスク1つぶん待ってから見る（plan.js と同じ間合い） */
  Promise.resolve().then(() => {
    if (tabDropped) return;
    if (overTabbar(pt)) return;
    if (offT) { untagHere(d.id, offT); return; }
    const dir = edgeHitAt(pt.x, pt.y, true);
    if (dir) tagFromEdge(d.id, dir);
  });
}

/* 指先の下にある端。タグが置かれていない向きは端として扱わない
   （行けない・付かない向きは、そもそも反応しない）。

   帯は辺の全長ではなく、辺の中央 1/3 だけ（利用者の指示）。
   重力で底に溜まったバブルを少し横へ動かしただけでタグが付いてしまうのを避ける。
   ここの範囲は CSS の .sea-edge とそろえること（見えている範囲＝当たる範囲）。 */
function edgeHitAt(x, y, force) {
  if (!force && !bubbleDrag) return null;
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) return null;
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  /* 画面から大きく外れたところで離したなら、どの端でもない */
  if (x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40) return null;
  const band = Math.min(EDGE_BAND, r.width * 0.24, r.height * 0.24);
  /* 辺に沿った向きは、中央 1/3 の内側だけ */
  const inMidX = Math.abs(x - (r.left + r.width / 2)) <= r.width * EDGE_SPAN / 2;
  const inMidY = Math.abs(y - (r.top + r.height / 2)) <= r.height * EDGE_SPAN / 2;
  const near = [];
  if (inMidX && y - r.top <= band) near.push({ dir: 'up', d: y - r.top });
  if (inMidY && x - r.left <= band) near.push({ dir: 'left', d: x - r.left });
  if (inMidY && r.right - x <= band) near.push({ dir: 'right', d: r.right - x });
  near.sort((a, b) => a.d - b.d);
  for (let i = 0; i < near.length; i++) {
    const d = near[i].dir;
    if (DROP_DIRS.indexOf(d) >= 0 && dirTagAt(d)) return d;
  }
  return null;
}

/* ドロップ判定は指先の座標で（契約 §14）。バブルの外形はタブ6本ぶんを覆うため */
function overTabbar(pt) {
  const bar = document.getElementById('tabbar');
  if (!bar || !(pt.x >= 0)) return false;
  const r = bar.getBoundingClientRect();
  return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
}

function tagFromEdge(id, dir) {
  const tag = dirTagAt(dir);
  const t = store.get(id);
  if (!tag || !t) return;
  if (!has('setTag')) { toast('いまはタグを付けられない'); return; }
  const name = nameOf(tag);
  if (tagsOfSafe(id).indexOf(tag.id) >= 0) {
    toast('「' + trim(t.text) + '」には、もう『' + trim(name) + '』が付いている');
    return;
  }
  if (store.setTag(id, tag.id, true) === false) return;
  /* 「完了」の海へ落としたときは、完了そのもの。
     長押しメニューや集中画面からの完了と、音も言い方もそろえる
     （ここだけ「に『完了』」だと、タグを付けただけに読める）。 */
  if (tag.id === 'done') {
    try { playComplete(); } catch (err) { console.error(err); }
    toast('「' + trim(t.text) + '」を完了', {
      label: '取り消す',
      on: () => {
        if (has('uncomplete')) store.uncomplete(id);
        else if (has('setTag')) store.setTag(id, tag.id, false);
      },
    });
    return;
  }
  toast('「' + trim(t.text) + '」に『' + trim(name) + '』', {
    label: '取り消す', on: () => { if (has('setTag')) store.setTag(id, tag.id, false); },
  });
}

function markEdge(dir) {
  if (overEdge === dir) return;
  if (overEdge && edges[overEdge]) edges[overEdge].el.classList.remove('is-over');
  overEdge = dir;
  if (overEdge && edges[overEdge]) edges[overEdge].el.classList.add('is-over');
}

/* ---------------- 背景のドラッグ = 面の移動（追補3 §1） ----------------
   バブルの上から始めた指はタグ付け、背景から始めた指は面の移動。
   ここを混ぜないために、pointerdown の的でだけ振り分ける。 */

let swipe = null;   /* { pid, x0, y0, axis, dx, dy, to } */
/* 直前のなぞりで指が動いた時刻。看板の上から滑らせたとき、
   面が動いたうえに click まで走って二重に移るのを防ぐ */
let signSuppress = 0;

function isBackground(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (!stage.contains(target)) return false;
  /* バブル・ボタン・入力・グリッドの上から始めた指は、面の移動ではない。
     **矢印看板だけは例外**（.sea-sign）。あれは景色で、しかも端の広いところに居る。
     押す的でもあるが、そこから指を滑らせたら面が動いてほしい。
     滑らせたときに click まで走らないよう、下の signSuppress で押さえる。 */
  return !target.closest('.bub, button:not(.sea-sign), a, input, textarea, select, .sea-grid, .sea-sheet');
}

/* ---- 海の長押しで引き（利用者の指示） ----
   背景を押したまま HOLD_MS 動かさなければ、全部の海の一覧が開く。
   指が HOLD_PX 以上動いたら、それはなぞり（面の移動／寄せ）なので取り消す。
   バブルの上から始めた指はここへ来ない（isBackground が弾く）。 */
const HOLD_MS = 480;
const HOLD_PX = 8;
let holdTimer = 0;
let holdPt = null;
let holdFx = null;      /* 指の下で貯まる輪（利用者の指示） */

function cancelHold() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  if (holdFx) { holdFx.cancel(); holdFx = null; }
  holdPt = null;
}

function startHold(ev) {
  cancelHold();
  holdPt = { x: ev.clientX, y: ev.clientY };
  /* 押している間、指の下に輪が貯まる。貯まりきると開く＝
     途中で離せば何も起きないことも、同じ絵で分かる */
  holdFx = holdRing(ev.clientX, ev.clientY, HOLD_MS);
  holdTimer = setTimeout(() => {
    holdTimer = 0;
    if (!holdPt || gathering || bubbleDrag) { cancelHold(); return; }
    cancelSwipe(); closePan();
    signSuppress = Date.now();     /* 離したときの click を看板に拾わせない */
    openMap();
    cancelHold();                  /* 輪は役目を終えた（開いたので） */
  }, HOLD_MS);
}

function openMap() {
  openSeaMap({
    current: curFace,
    was: stage,
    onGo: face => {
      if (!face) return;
      if (face === curFace) return;
      if (gathering) setGathering(false);
      cancelSwipe();
      goFace(face);
    },
  });
}

function onStageDown(ev) {
  if (gathering || bubbleDrag || swipe || panning || pinch) return;
  if (ev.button != null && ev.button !== 0) return;
  if (!isBackground(ev.target)) return;
  startHold(ev);
  /* 近づいているとき（倍率 1 超）は、背景の指は**寄せ**。
     面の移動はここでは受けない——世界が画面より広いあいだ、
     同じ指の動きに「まだ見えていないところへ寄る」と「隣の面へ移る」の
     2つの意味を持たせると、どちらも出しにくくなる。
     面を移りたければ端の看板（.sea-edge-btn）を押す。あれは倍率に関係なく効く。 */
  if (zLevel > 1) { startPan(ev); return; }
  swipe = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, axis: null, dx: 0, dy: 0, to: null };
  window.addEventListener('pointermove', onSwipeMove, true);
  window.addEventListener('pointerup', onSwipeEnd, true);
  window.addEventListener('pointercancel', onSwipeCancel, true);
}

/* ---------------- 寄せ（近づいているときの背景ドラッグ） ---------------- */

let panning = null;   /* { pid, x0, y0, px0, py0, moved } */

function startPan(ev) {
  panning = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, px0: panX, py0: panY, moved: 0 };
  window.addEventListener('pointermove', onPanMove, true);
  window.addEventListener('pointerup', endPan, true);
  window.addEventListener('pointercancel', endPan, true);
}
function onPanMove(ev) {
  if (!panning || ev.pointerId !== panning.pid) return;
  const dx = ev.clientX - panning.x0, dy = ev.clientY - panning.y0;
  if (holdPt && Math.hypot(dx, dy) > HOLD_PX) cancelHold();
  panning.moved = Math.max(panning.moved, Math.hypot(dx, dy));
  /* 寄せは scale の**外**の口（translate）なので、値は画面の px のまま。
     指と1対1で付いてくる（世界の px へ直すと、近づくほど速く滑ってしまう） */
  panX = panning.px0 + dx;
  panY = panning.py0 + dy;
  applyView();
}
function endPan(ev) {
  if (!panning || (ev && ev.pointerId !== panning.pid)) return;
  if (panning.moved > 6) signSuppress = Date.now();
  closePan();
}
function closePan() {
  cancelHold();
  panning = null;
  window.removeEventListener('pointermove', onPanMove, true);
  window.removeEventListener('pointerup', endPan, true);
  window.removeEventListener('pointercancel', endPan, true);
}

/* ---------------- ホイール／つまむ指 ---------------- */

/* ホイールはページを動かさない（ステージはスクロールしない）ので横取りしてよい。
   Mac の2本指スワイプもここに来る＝そのまま拡大・縮小になる。 */
function onWheel(ev) {
  if (gathering) return;
  const t = ev.target;
  /* 整列のグリッド・詳細シート・選び札の中は、素直にスクロールさせる */
  if (t && t.closest && t.closest('.sea-grid, .sea-sheet, .sea-narrow-pop, input, textarea')) return;
  ev.preventDefault();
  /* deltaMode 1 = 行、2 = ページ。px に揃えてから指数に掛ける */
  const unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? (stage.clientHeight || 600) : 1);
  zoomTo(zRaw * Math.exp(-ev.deltaY * unit * Z_WHEEL), ev.clientX, ev.clientY);
}

/* つまむ指。**背景から始めた指だけ**を数える。
   バブルの上から始めた指は bubble.js が掴んでいて、そこから取り上げる口が無い
   （取り上げれば、掴んだつもりのバブルが手から消える）。
   実機の指2本は、この環境（契約 §14）では合成イベントでしか動かせていない。 */
const pinchPts = new Map();
let pinch = null;     /* { d0, z0 } */

function trackDown(ev) {
  if (ev.pointerType === 'mouse') return;
  if (gathering || bubbleDrag) return;
  if (!isBackground(ev.target)) return;
  cancelHold();
  pinchPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinchPts.size === 2 && !pinch) {
    cancelSwipe(); closePan();
    const p = [...pinchPts.values()];
    pinch = { d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, z0: zRaw };
  }
}
function trackMove(ev) {
  if (!pinchPts.size) return;
  const rec = pinchPts.get(ev.pointerId);
  if (!rec) return;
  rec.x = ev.clientX; rec.y = ev.clientY;
  if (!pinch || pinchPts.size < 2) return;
  const p = [...pinchPts.values()];
  const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  if (!d) return;
  zoomTo(pinch.z0 * (d / pinch.d0), (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
}
function trackUp(ev) {
  if (!pinchPts.size) return;
  pinchPts.delete(ev.pointerId);
  if (pinchPts.size < 2) pinch = null;
}

/* 指の向きから「その先にある面」を言う。
   指を右へ動かすと世界が右へずれて、左にある面が出てくる。 */
function wayOf(axis, dx, dy) {
  if (axis === 'x') return dx > 0 ? 'left' : 'right';
  return dy > 0 ? 'up' : 'down';
}

/* いまの面から way の向きへ行けるか。行き先の面名、行けなければ null。
   列の中は左右で1つずつ。上下は中央の列にだけ付く（faceAt を見よ）。 */
function neighbor(face, way) { return faceAt(way, face); }

function faceBase(face) {
  /* 面は世界の大きさで並んでいる（1列＝世界1つぶん）。
     ステージの大きさで測ると、引いたときだけ隣の面が半端な位置で止まる */
  const w = (world && world.clientWidth) || 0, h = (world && world.clientHeight) || 0;
  if (face === 'up') return { x: 0, y: h };
  if (face === 'down') return { x: 0, y: -h };
  return { x: -colOf(face) * w, y: 0 };
}

function setWorldPx(x, y) {
  world.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}

/* 落ち着いた位置は割合で置く。幅が変わっても付いてくる（px だと測り直しが要る） */
function setWorldFace(face) {
  /* 落ち着いた位置は**割合**で置く。世界（.sea-world）の幅はちょうど1列ぶんなので、
     -100% × 列番号 でその列がぴったり画面に来る。px で置くと、
     ズームや画面の回転で世界の大きさが変わるたびに測り直しが要る。

     **ここは横一列にしたときに直し忘れていた。**古い版は
     center/up/down/left/right の対応表を引いていて、'sea:<id>' は表に無いので
     既定の '0,0' に落ちていた——つまり curFace と名札だけが変わって、
     **世界は中央に居座ったまま**だった（隣の海へ移れていなかった）。 */
  if (face === 'up') { world.style.transform = 'translate(0,100%)'; return; }
  if (face === 'down') { world.style.transform = 'translate(0,-100%)'; return; }
  const c = colOf(face);
  world.style.transform = 'translate(' + (c ? (-c * 100) + '%' : '0') + ',0)';
}

function onSwipeMove(ev) {
  if (!swipe || ev.pointerId !== swipe.pid) return;
  const dx = ev.clientX - swipe.x0, dy = ev.clientY - swipe.y0;
  if (holdPt && Math.hypot(dx, dy) > HOLD_PX) cancelHold();
  if (!swipe.axis) {
    if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
    swipe.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    stage.classList.add('is-swiping');
  }
  swipe.dx = dx; swipe.dy = dy;

  const to = neighbor(curFace, wayOf(swipe.axis, dx, dy));
  if (to && to !== swipe.to) {
    swipe.to = to;
    ensureField(to);       /* 出てくる面も動いていてほしい */
    startCurrent();
  }
  /* reduce-motion のときは追従させない（面は最後に切り替わるだけ） */
  if (reduceMotion()) return;

  /* ここから先は**世界の px**。指の動き（画面の px）を倍率で割って移す。
     割らないと、引いているときだけ面が指の倍の速さで滑る。
     しきい値のほう（AXIS_LOCK・振り切ったか）は画面の px のままにしてある——
     あれは「指がどれだけ動いたか」の話で、世界の広さとは関係がないため */
  const wx = dx / zLevel, wy = dy / zLevel;
  const base = faceBase(curFace);
  if (!to) { setWorldPx(base.x, base.y); return; }   /* 行けない向きへは動かない */
  const t = faceBase(to);
  if (swipe.axis === 'x') {
    setWorldPx(clamp(base.x + wx, Math.min(base.x, t.x), Math.max(base.x, t.x)), base.y);
  } else {
    setWorldPx(base.x, clamp(base.y + wy, Math.min(base.y, t.y), Math.max(base.y, t.y)));
  }
}

function onSwipeEnd(ev) {
  if (!swipe || ev.pointerId !== swipe.pid) return;
  const s = swipe;
  /* 指が動いていたなら、このあと来る click は捨てる（看板の上から滑らせた場合） */
  if (Math.hypot(s.dx, s.dy) > 6) signSuppress = Date.now();
  closeSwipe();
  if (!s.axis) { settle(); return; }
  const to = neighbor(curFace, wayOf(s.axis, s.dx, s.dy));
  const dist = s.axis === 'x' ? Math.abs(s.dx) : Math.abs(s.dy);
  const span = (s.axis === 'x' ? stage.clientWidth : stage.clientHeight) || 1;
  const need = reduceMotion() ? 40 : Math.max(44, span * 0.22);
  if (to && dist >= need) goFace(to);
  else settle();
}

function onSwipeCancel(ev) {
  if (!swipe || (ev && ev.pointerId !== swipe.pid)) return;
  if (Math.hypot(swipe.dx, swipe.dy) > 6) signSuppress = Date.now();
  closeSwipe();
  settle();
}

function closeSwipe() {
  cancelHold();
  swipe = null;
  stage.classList.remove('is-swiping');
  window.removeEventListener('pointermove', onSwipeMove, true);
  window.removeEventListener('pointerup', onSwipeEnd, true);
  window.removeEventListener('pointercancel', onSwipeCancel, true);
}

function cancelSwipe() {
  if (!swipe) return;
  closeSwipe();
  settle();
}

function settle() {
  setWorldFace(curFace);
  scheduleStop();
}

function goFace(face) {
  if (!faces[face]) return;
  closeNarrowPop(false);
  if (face !== 'center' && !faceTag(face)) face = 'center';
  /* 面が変われば候補の集合も変わる。混ぜている途中なら畳む
     （別の海へ移ったのに、前の海のものが開くのは筋が通らない） */
  if (face !== curFace) cancelShuffle();
  curFace = face;
  ensureField(face);
  setWorldFace(face);
  syncFaces();
  renderChrome();
  scheduleStop();     /* 滑っている間は出ていく面も動かしておく */
  startCurrent();
}

/* 見えなくなった面の raf は止める。ただし滑っている最中は止めない
   （切り替えの 320ms のあいだ、出ていく面が固まって見えるのを避ける）。
   ペインが裏に回っていると setTimeout は1秒単位に間引かれるが、止まったままにはならない。 */
function scheduleStop() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => { stopTimer = 0; startCurrent(); }, 420);
}

function startCurrent() {
  liveFaces().forEach(f => {
    const fl = faces[f].field;
    if (!fl) return;
    const live = shown && !gathering && (f === curFace || (swipe && swipe.to === f) || stopTimer);
    try { if (live) { if (fl.start) fl.start(); } else if (fl.stop) fl.stop(); } catch (err) { /* 止め損ねで転ばない */ }
  });
}

/* ---------------- 面のフィールド ---------------- */

/* ジェスチャの handlers。id を受け取るので中身は面によらず同じ */
function makeHandlers(hostFn) {
  return {
    onFocusRequest: id => openFive(id),
    onMenu: (id, node) => menuFor(id, node),
    onActions: (id) => actionsFor(id),
    onDropToTab: (id, tabId) => { tabDropped = true; dropToTab(id, tabId); },
    onDragStart: id => beginBubbleDrag(id),
    onDragEnd: () => endBubbleDrag(),
    getHost: hostFn,
  };
}

/* 必要になってから作る。タグが1つも置かれていない版では中央だけが作られる。 */
/* 面ごとの矢印看板。面を作るときに1回だけ張る（syncFaceEls から呼ぶ） */
function makeSignsFor(f) {
  const rec = {};
  EDGE_DIRS.forEach(dir => {
    const b = el('button', 'sea-sign');
    b.type = 'button';
    b.dataset.dir = dir;
    b.hidden = true;
    const ar = el('span', 'ar');
    ar.setAttribute('aria-hidden', 'true');
    ar.textContent = SIGN_ARROW[dir] || '';
    const nm = el('span', 'nm');
    b.appendChild(ar);
    b.appendChild(nm);
    b.addEventListener('click', ev => {
      ev.preventDefault();
      /* 指が滑ったなら、それはなぞり。押したことにしない */
      if (Date.now() - signSuppress < 400) return;
      const to = b.dataset.to;
      if (to) goFace(to);
    });
    /* いちばん先に足す＝いちばん後ろに描かれる（バブルより後ろ） */
    faces[f].el.insertBefore(b, faces[f].el.firstChild);
    rec[dir] = { btn: b, nm };
  });
  faces[f].signs = rec;
}

/* 面の器（div）を、いまの海の並びに合わせて作る／片づける。
   海が増えたり並べ替えられたりするたびに呼ぶ。
   **器は空の div なので安い**——中身（drift の field）は syncFaces が、
   いま居る列とその両隣にだけ持たせる。 */
function syncFaceEls() {
  if (!world) return;
  const want = liveFaces();
  const wantSet = new Set(want);
  /* 要らなくなった面を畳む */
  Object.keys(faces).forEach(f => {
    if (wantSet.has(f)) return;
    const rec = faces[f];
    detachGestures(f);
    if (rec.field && rec.field.destroy) { try { rec.field.destroy(); } catch (err) { /* 畳むだけ */ } }
    rec.el.remove();
    delete faces[f];
  });
  /* 足りない面を作る。並び順は DOM でも列の順にしておく（読み上げの順に効く） */
  want.forEach(f => {
    let rec = faces[f];
    if (!rec) {
      const fe = el('div', 'sea-face');
      fe.dataset.face = f;
      fe.setAttribute('role', 'group');
      rec = { el: fe, field: null, gestures: new Map(), empty: null };
      faces[f] = rec;
      /* 面ごとの空のときの言葉。中央だけは別（centerEmpty） */
      if (f !== 'center') {
        const q = el('p', 'sea-face-empty');
        q.hidden = true;
        rec.empty = q;
        fe.appendChild(q);
      }
      makeSignsFor(f);
    }
    /* 列の位置は CSS 変数で渡す（上下は列とは別の軸なので 0 のまま） */
    rec.el.style.setProperty('--col', String(colOf(f)));
    world.appendChild(rec.el);
  });
}

function ensureField(face) {
  const f = faces[face];
  if (!f || f.field) return f && f.field;
  const handlers = makeHandlers(() => f.el);
  /* handlers は createField の opts で渡す。drift が自分でノードを作って
     attachGestures まで張るので、画面側では張らない（張ると二重になり、
     離したときにバブルがドラッグ層に残って海の外に出る）。 */
  f.field = createField(f.el, Object.assign({ size: 'text', handlers: handlers }, handlers));
  if (shown && f.el.clientWidth && f.el.clientHeight && f.field.relayout) {
    try { f.field.relayout(); } catch (err) { /* 測れないだけ */ }
  }
  return f.field;
}

function detachGestures(face) {
  const g = faces[face].gestures;
  g.forEach(v => { if (typeof v.detach === 'function') v.detach(); });
  g.clear();
}

/* 中身（drift の field）を持たせるのは、いま居る面とその隣まで。
   10列ぶんのバブルを同時に持つと DOM が重い（1個で5ノード・7層）。
   隣まで持つのは、なぞっている最中に出てくる面が空だと「無い海」に見えるため。 */
function nearCur(face) {
  if (face === curFace) return true;
  return !!(faceAt('left', curFace) === face || faceAt('right', curFace) === face
    || faceAt('up', curFace) === face || faceAt('down', curFace) === face);
}

function syncFaces() {
  liveFaces().forEach(face => {
    const want = (face === 'center' || !!faceTag(face)) && nearCur(face);
    if (!want) {
      /* 遠い面・タグが外れた面。中身だけ降ろして器は残す */
      if (faces[face].field) { detachGestures(face); setFaceItems(face, []); }
      return;
    }
    ensureField(face);
    setFaceItems(face, faceItems(face));
  });
}

function setFaceItems(face, list) {
  const f = faces[face];
  const field = f.field;
  if (!field) return;
  if (typeof field.setItems === 'function') {
    /* drift へ渡す一件ぶん。色はここで決めて渡す（追補4 §1）。
       marks / anchorHue は渡さない——点は描かなくなったので。

       **直径はステージの寸法で決める。**引くと世界は広がるが、バブルは広がらない
       ——それが「引いたぶんだけ余裕ができる」の中身。drift へ渡さないと、
       あちらは host（＝広がった面）の寸法で上限を決めるので、
       画面の狭い機種では引くたびにバブルまで大きくなってしまう。 */
    const dw = stage.clientWidth, dh = stage.clientHeight;
    field.setItems(list.map(t => {
      const it = Object.assign(itemOf(t), { colors: colorsOf(t), tagNames: namesOf(t) });
      it.size = Math.round(diameterFor(it.text, dw, dh));
      return it;
    }));
  }
  if (typeof field.nodeOf !== 'function') return;

  const want = new Set(list.map(t => t.id));
  f.gestures.forEach((g, id) => {
    if (want.has(id)) return;
    if (typeof g.detach === 'function') g.detach();
    f.gestures.delete(id);
  });

  /* ジェスチャ本体は drift が張っている。キーボード経路だけは bubble.js に無いので、ここで足す */
  list.forEach(t => {
    const node = field.nodeOf(t.id);
    const g = f.gestures.get(t.id);
    if (g && g.node === node) return;            /* 同じノードなら付け直さない */
    if (g && typeof g.detach === 'function') g.detach();
    f.gestures.delete(t.id);
    if (!node) return;                            /* drift がまだ作っていない */
    f.gestures.set(t.id, { node, detach: attachKeys(node, t.id) });
  });
}

/* キーボードからも5項目に届くようにする（600ms 長押しは指のための経路なので）。
   Enter / Space には割り当てない。そこは bubble.js が「タップ」として使っている。 */
function attachKeys(node, id) {
  const onKey = ev => {
    if (ev.target !== node) return;
    const k = ev.key;
    if (k !== 'ContextMenu' && k !== 'm' && k !== 'M' && !(ev.shiftKey && k === 'F10')) return;
    ev.preventDefault();
    menuFor(id, node);
  };
  node.addEventListener('keydown', onKey);
  return () => node.removeEventListener('keydown', onKey);
}

/* 1つのバブルに、ジェスチャとキーボードの両方を付ける（整列グリッド用）。
   グリッドのノードは画面が自分で作るので、ここでは attachGestures を張ってよい。 */
function bindNode(node, id, hostFn) {
  const offGesture = attachGestures(node, makeHandlers(hostFn));
  const offKeys = attachKeys(node, id);
  return () => {
    if (typeof offGesture === 'function') offGesture();
    offKeys();
  };
}

/* 海の底を「思いついたことを書く」の上端に合わせる。
   入力欄の高さはフォントや端末で変わるので、実寸を測って CSS 変数へ渡す。
   これを呼んだあとは、面の寸法が変わっているので relayout() が要る。 */
function syncFloor() {
  if (!root || !composer) return false;
  const h = Math.round(composer.getBoundingClientRect().height);
  if (!h) return false;                      /* まだ測れない（display:none 中など） */
  const cur = root.style.getPropertyValue('--sea-floor');
  const next = h + 'px';
  if (cur === next) return false;
  root.style.setProperty('--sea-floor', next);
  return true;                               /* 変わった＝置き直しが要る */
}

/* ---------------- 端の手がかり ----------------
   ・中央（ぜんぶ）の海 … ふだんは何も出さない。海を静かに保つため。
     バブルを掴んだときにだけ、落とすと何が付くかが端に出る
   ・タグの海 … 中央へ戻る口だけ常に出す（帰り道を隠さない）
   ・バブルを掴んでいる間 … 落とすと何が付くかを出す。帯そのものが光る
   割り当てが無い向きには、そもそも何も出さない（行けないと分かること） */

/* 矢印看板（A-9）。面の中の、バブルより後ろ。

   出すのは「そこから行ける向き」だけ。行けない向きには出さない
   ——出ていないこと自体が「その向きには海が無い」の合図になる。
   中央からは、タグの置かれている向きすべて。タグの海からは、中央へ戻る1つ。

   バブルを掴んでいる間と「ならべる」の間は引っ込める。
   掴んでいる間は端の札（.sea-edge）が同じ場所で別のことを言うので、
   両方出ると「行ける」と「付く」が同時に見えて読めなくなる。 */
function renderSigns() {
  const quiet = !!bubbleDrag || gathering;
  liveFaces().forEach(f => {
    const rec = faces[f] && faces[f].signs;
    if (!rec) return;
    EDGE_DIRS.forEach(dir => {
      const s = rec[dir];
      if (!s) return;
      const to = quiet ? null : neighbor(f, dir);
      if (!to) {
        s.btn.hidden = true;
        s.btn.removeAttribute('data-to');
        return;
      }
      const tag = faceTag(to);
      const name = to === 'center' ? CENTER_NAME : nameOf(tag);
      s.nm.textContent = name;                       /* タグ名はユーザーの文字 */
      s.btn.dataset.to = to;
      s.btn.setAttribute('aria-label', name + 'の海へ');
      /* 看板にもその海の色を1点だけ載せる。名前だけを手がかりにしない（1.4.1） */
      if (tag) s.btn.style.setProperty('--sign-c', colorOf(tag, to));
      else s.btn.style.removeProperty('--sign-c');
      s.btn.hidden = false;
    });
  });
}

function renderEdges() {
  const dragging = !!bubbleDrag;

  EDGE_DIRS.forEach(dir => {
    const e = edges[dir];
    const tag = dirTagAt(dir);
    let show = false, label = '', aria = '', color = '', target = null;

    if (dragging) {
      /* 掴んでいる間は「タグを付ける端」だけ。戻り口は出さない（役目が混ざる）。
         落とせない端（下＝完了）には出さない——出すと
         「光っているのに付かない」になる（edgeHitAt も down を返さない） */
      if (tag && DROP_DIRS.indexOf(dir) >= 0) {
        show = true; label = nameOf(tag) + ' が付く'; aria = label; color = colorOf(tag, dir);
      }
    }
    /* **ふだんは出さない。**行き先の案内は矢印看板（.sea-sign）が持つ。
       あちらは面の中の、バブルより後ろにある＝真下のバブルを掴めなくしない（A-8）。
       ここに残すのは「掴んでいる間だけ、指の上に出る落とし先の名前」だけ。
       この2つは役目が違う：看板は「どこへ行けるか」、札は「いま離すとどうなるか」。 */

    e.el.hidden = !show || gathering;
    e.el.classList.toggle('is-drop', dragging);
    if (!show) { e.el.classList.remove('is-over'); return; }
    /* 掴んでいる間も名前は出したままにする。
       「そこに何の海があるか」が先に見えていないと、端は狙えない。押す的ではなくなるだけ */
    e.label.textContent = label;              /* タグ名はユーザーの文字。textContent で入れる */
    e.btn.setAttribute('aria-label', aria);
    e.btn.disabled = dragging || !target;
    e.dot.hidden = !color;
    if (color) {
      e.el.style.setProperty('--edge-c', color);
      e.dot.style.setProperty('--edge-c', color);
    } else {
      e.el.style.removeProperty('--edge-c');
    }
    e.target = target;
  });
}

/* ---------------- 詳細（最初の一手 / URL / 開始した） ----------------
   plan.js のものを踏襲する。ノードは再描画をまたいで使い回し、
   外で状態が変わったときは sync() で同期し直す（契約 §14）。 */

function makeDetail(id) {
  const node = el('div', 'sea-detail');

  /* --- 最初の一手 --- */
  const fs = el('label', 'fs');
  fs.appendChild(el('span', 'lb', '最初の一手'));
  const fin = el('input', 'in');
  fin.type = 'text';
  fin.placeholder = 'まず何をする？';
  fin.autocomplete = 'off';
  fin.value = detailOf('firstStepOf', id);
  fs.appendChild(fin);
  node.appendChild(fs);

  let ftimer = 0, pending = null;
  function saveFirst() {
    clearTimeout(ftimer); ftimer = 0;
    if (pending === null) return;
    const v = pending; pending = null;
    if (has('setFirstStep')) store.setFirstStep(id, v);
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
  const ur = el('div', 'ur');
  ur.appendChild(el('span', 'lb', 'URL'));
  const rw = el('div', 'rw');
  const uin = el('input', 'in');
  uin.type = 'url';
  uin.placeholder = 'https://…';
  uin.autocomplete = 'off';
  uin.value = detailOf('urlOf', id);
  rw.appendChild(uin);
  const open = el('a', 'open', '開く');
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.hidden = true;
  rw.appendChild(open);
  ur.appendChild(rw);
  /* 弾かれたことは伝えるが、手は止めさせない（アラートは出さない） */
  const err = el('p', 'err', '開けないリンク');
  err.hidden = true;
  err.setAttribute('aria-live', 'polite');
  ur.appendChild(err);
  node.appendChild(ur);

  /* 「開く」は store が受け取った URL だけを出す。入力中の生の文字列は出さない */
  function syncLink() {
    const u = detailOf('urlOf', id);
    const show = !!u && /^https?:\/\//i.test(u) && err.hidden;
    if (show) open.href = u;
    else open.removeAttribute('href');
    open.hidden = !show;
  }
  let utimer = 0;
  function saveUrl() {
    clearTimeout(utimer); utimer = 0;
    if (!has('setUrl')) return;
    const raw = uin.value.trim();
    if (!raw) {
      store.setUrl(id, '');     /* 空はエラーではない。消したいだけ */
      err.hidden = true;
      syncLink();
      return;
    }
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
  syncLink();

  /* --- あとから「はじめた」を記録する --- */
  const doneBtn = el('button', 'sea-done');
  doneBtn.type = 'button';
  /* どこにあっても記録できるようになったので、断り書きは出さない（追補3 §6）。
     ノードは残す：外すと下の sync が参照を失う。常に隠したまま。 */
  const doneWhy = el('p', 'why', '');
  doneWhy.hidden = true;
  function syncDone() {
    const cur = store.get(id);
    const target = startTarget(cur);
    const can = target !== undefined;
    const on = can && has('isStarted') && !!store.isStarted(id, target);
    doneBtn.disabled = !can;
    doneWhy.hidden = true;
    doneBtn.classList.toggle('on', on);
    doneBtn.textContent = on ? DONE_LB + ' ✓' : DONE_LB;
    doneBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    doneBtn.setAttribute('aria-label',
      (cur ? cur.text : '') + ' を開始したと'
      + (on ? '記録しない' : '記録する'));
  }
  syncDone();
  doneBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    const target = startTarget(store.get(id));
    if (target !== undefined && has('isStarted') && store.isStarted(id, target)) {
      if (has('unstart')) store.unstart(id, target);
    } else {
      markStarted(id);
    }
    syncDone();
    render();   /* 着手済みの見た目（薄い円）へ切り替えるため */
  });
  node.appendChild(doneBtn);
  node.appendChild(doneWhy);

  function flush() {
    saveFirst();
    if (utimer) saveUrl();
  }
  function sync() {
    syncDone();
    syncLink();
  }

  return { node, flush, sync };
}

function detailFor(id) {
  let d = details.get(id);
  if (!d) { d = makeDetail(id); details.set(id, d); }
  return d;
}

function openDetail(id) {
  const t = store.get(id);
  if (!t) return;
  if (openDetailId && openDetailId !== id) closeDetail();
  openDetailId = id;
  const d = detailFor(id);
  sheetTitle.textContent = t.text;          /* 生の文字列は textContent で入れる */
  sheetBody.replaceChildren(d.node);
  d.sync();
  sheet.hidden = false;
  /* 入力欄そのものにはフォーカスを置かない（開いた瞬間にキーボードを出さない）。
     Escape で閉じられるよう、枠にだけフォーカスを移す */
  sheet.focus({ preventScroll: true });
}

function closeDetail() {
  if (!openDetailId) return;
  const d = details.get(openDetailId);
  details.delete(openDetailId);
  openDetailId = null;
  sheet.hidden = true;
  sheetBody.replaceChildren();
  if (d) d.flush();     /* 書きかけを取りこぼさない */
}

/* ---------------- 整列（ならべる） ----------------
   全件をスクロールするグリッドに並べる。面をまたいだ一覧なので、
   整列中は面の移動を止める（世界ごと隠れるので、動かしても見えない）。 */

function setGathering(on) {
  /* 整列を畳んだら、さがした文字も片づける。
     次に開いたときに前の結果が残っていると、「全部あるはず」が裏切られる */
  if (!on && gridQ) { gridQ = ''; if (gridFind) gridFind.value = ''; }
  if (gathering === on) return;
  cancelShuffle();          /* 整列に入る／戻るときは、混ぜかけを畳む */
  gathering = on;
  forgetTagColors();
  gatherLabel.textContent = on ? 'もどす' : 'ならべる';
  gatherBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  gatherBtn.title = on ? '押すと海へもどる' : '押すと全部が並ぶ';
  gatherBtn.classList.toggle('is-on', on);
  grid.hidden = !on;
  stage.classList.toggle('is-gathering', on);

  /* 整列中は、海の物理側のバブルを画面から降ろす。
     グリッドが全件を並べるので、浮遊ぶんを出したままだと同じものが2つ見える。
     隠すのではなく setItems([]) で落とすのは、DOM に残っていると
     「整列中の .bub は全件ちょうど」という数え方が成立しないため。 */
  if (on) {
    cancelSwipe();
    liveFaces().forEach(f => {
      const fl = faces[f].field;
      if (!fl) return;
      try { if (fl.setGathering) fl.setGathering(false); } catch (err) { /* 無い版もある */ }
      try { if (fl.stop) fl.stop(); } catch (err) { /* 同上 */ }
      detachGestures(f);
      try { if (fl.setItems) fl.setItems([]); } catch (err) { /* 同上 */ }
    });
    renderGrid();
  } else {
    clearGrid();
    syncFaces();
    liveFaces().forEach(f => {
      const fl = faces[f].field;
      if (fl && fl.relayout) { try { fl.relayout(); } catch (err) { /* 測れないだけ */ } }
    });
    startCurrent();
  }
  renderChrome();
}

/* ---------------- 絞り込み（中央の海だけ／追補4 §2） ----------------
   「今日に追加したいものを、既に登録したものを消して探しやすく」。
   切り替え。押したら絞り、もう一度押したら戻る。
   戻し方が画面に見えていること＝ボタンの文字が「しぼる」⇄「もどす」に変わる
   （「ならべる」⇄「もどす」と同じ言い方にそろえている）。

   「ならべる」との関係：**絞り込みは漂う海だけに効く。**
   ならべるは契約 §7 で「全件が並ぶ」と決まっているので、こちらへは掛けない。
   ならべている間はボタンごと引っ込め（面が丸ごと隠れるので絞る対象が無い）、
   もどしたときに元の絞り込みへ戻る。同時に2つのモードを重ねない。 */

/* id が null なら全部やめる。それ以外は入れ／外しの切り替え */
function setNarrow(tagId) {
  if (tagId === null || tagId === undefined) {
    if (!narrowSet.size) return;
    narrowSet.clear();
  } else if (narrowSet.has(tagId)) {
    narrowSet.delete(tagId);
  } else {
    narrowSet.add(tagId);
  }
  syncFaces();          /* 中央の顔ぶれが変わる */
  renderChrome();
}

/* 消えたタグを選んだままにしない（設定でタグを消したときなど） */
function pruneNarrow() {
  if (!narrowSet.size) return false;
  const ok = new Set(narrowChoices().map(c => c.id));
  let changed = false;
  [...narrowSet].forEach(k => { if (!ok.has(k)) { narrowSet.delete(k); changed = true; } });
  return changed;
}

/* --- 絞り込みの選び札（利用者の指示でタグごとに増やした） ---
   前は「しぼる」⇄「もどす」の2択トグルだった。タグが増えると2択では足りないので、
   小さな一覧を出す形にした。**戻し方は一覧の先頭（ぜんぶ）**——
   別のボタンにすると、絞っている間だけ現れる的が増える。 */
let narrowPop = null;

function closeNarrowPop(restoreFocus) {
  if (!narrowPop) return false;
  narrowPop.remove();
  narrowPop = null;
  if (narrowBtn) narrowBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus && narrowBtn && !narrowBtn.hidden) narrowBtn.focus({ preventScroll: true });
  return true;
}

function openNarrowPop() {
  if (closeNarrowPop(true)) return;
  const pop = el('div', 'sea-narrow-pop');
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'しぼりこみ');
  const rows = [];
  narrowChoices().forEach(c => {
    const b = el('button', 'sea-narrow-row');
    b.type = 'button';
    /* 「ぜんぶ」は選択の取り消しなので、印を持たない普通の項目。
       残りは重ねられるので、入り切りのある項目（menuitemcheckbox） */
    const isClear = c.id === null;
    b.setAttribute('role', isClear ? 'menuitem' : 'menuitemcheckbox');
    if (!isClear) b.setAttribute('aria-checked', narrowSet.has(c.id) ? 'true' : 'false');
    else b.classList.add('is-clear');
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
      setNarrow(c.id);
      /* **重ねられるので、選んでも閉じない。**続けて足せるようにしておく。
         「ぜんぶ」だけは、押した時点で選ぶものが無くなるので閉じる */
      if (c.id === null) { closeNarrowPop(true); return; }
      rows.forEach(r => {
        if (r.id === null) return;
        r.btn.setAttribute('aria-checked', narrowSet.has(r.id) ? 'true' : 'false');
      });
    });
    rows.push({ id: c.id, btn: b });
    pop.appendChild(b);
  });
  pop.addEventListener('keydown', ev => {
    const rows = Array.from(pop.querySelectorAll('button'));
    const i = rows.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); closeNarrowPop(true); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); rows[(i + 1 + rows.length) % rows.length].focus(); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); rows[(i - 1 + rows.length) % rows.length].focus(); return; }
    if (ev.key === 'Tab') closeNarrowPop(false);
  });
  stage.appendChild(pop);
  narrowPop = pop;
  narrowBtn.setAttribute('aria-expanded', 'true');
  const first = pop.querySelector('[aria-checked="true"]') || pop.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

function syncNarrowBtn() {
  if (!narrowBtn) return;
  if (pruneNarrow()) syncFaces();          /* 消えたタグを選んだままにしない */
  /* 中央（ぜんぶ）の海にだけ置く。タグの海には出さない（絞る意味が無い） */
  const show = curFace === 'center' && hasTags() && !gathering;
  narrowBtn.hidden = !show;
  if (!show) closeNarrowPop(false);
  const nm = narrowName();
  /* 絞っている間はボタンにその名前を出す。何で絞っているかが、
     面の名前とボタンの2か所に出ることになるが、面の名前は滑ると隠れるので残す */
  narrowLabel.textContent = nm || 'しぼる';
  narrowBtn.setAttribute('aria-pressed', nm ? 'true' : 'false');
  narrowBtn.classList.toggle('is-on', !!nm);
  narrowBtn.setAttribute('aria-label', nm
    ? '「' + nm + '」でしぼっている。押すと選び直す'
    : 'しぼりこみを選ぶ');
}

/* ---------------- ランダムスタート ----------------
   選べないときに、選ばずに始めるためのもの。おすすめではない。
   だから重み付けはしない（古い順・放置順にすると「催促」になる／契約 §0）。
   いま見えている面の中から素直に無作為。絞っている間は絞ったあとの集合から選ぶ
   （centerItems() が既に絞られているので、faceItems をそのまま使えばよい）。 */

function pickFace() {
  if (gathering) return [];
  if (curFace !== 'center') {
    const tag = faceTag(curFace);
    if (!tag) return [];
    /* 完了の海では選ばない。終わったものを「はじめる」のは筋が通らない */
    if (tag.id === 'done') return [];
  }
  return faceItems(curFace);
}

/* --- 混ぜて見せる（追補5 §4） -------------------------------------------
   見せ方は「玉が輪になって churn し、光が次々に移って、最後の1つが大きくなる」。
   玉は候補そのものではなく「候補が混ざっている」ことの絵にしている。
   漂っているバブルそのものを混ぜるには drift のノードを掴むことになるが、
   drift は別の人が同時に書き換えているうえ、毎フレーム transform を上書きするので、
   外から動かすと物理と喧嘩する。だから面の上に薄い盤を1枚置く。

   **選ぶのは混ぜる前。**Math.random() を1回引いて id を決め、そのあとで絵を作る。
   絵の側では選び直さないので、無作為さはこの見せ方に一切左右されない。 */

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
  const wrap = el('div', 'sea-shuffle');
  /* 目では玉を見るが、読み上げには何が起きているかを言葉で渡す */
  wrap.setAttribute('role', 'status');
  wrap.appendChild(el('span', 'sr', 'この海から1つ選んでいます'));

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
      parts.push('sea-rnd-lit ' + SHUF_HOPS[h] + 'ms linear ' + at[h] + 'ms');
    });
    parts.push(i === winner
      ? 'sea-rnd-win ' + SHUF_WIN + 'ms cubic-bezier(.2,.8,.3,1) ' + end + 'ms both'
      : 'sea-rnd-dim ' + SHUF_WIN + 'ms ease-out ' + end + 'ms both');
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
  const list = pickFace();
  if (!list.length) return;
  /* ここが唯一の抽選。重み付けはしない（古い順・放置順は「催促」になる／契約 §0） */
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
  const doneFace = (faceTag(curFace) || {}).id === 'done';
  const n = pickFace().length;
  randomBtn.disabled = n === 0 || !!shuffle;
  randomBtn.title = doneFace
    ? '完了の海では選ばない'
    : (n ? 'この海から1つ選んで、5分だけ集中' : 'この海には何も無い');
  randomBtn.setAttribute('aria-label', 'この海から1つ選んで、5分だけ集中');
}

function clearGrid() {
  gridNodes.forEach(g => {
    if (typeof g.detach === 'function') g.detach();
    g.node.remove();
  });
  gridNodes.clear();
}

/* 並びは古い順＝放置しているものが先頭。分類済みには行き先の点が付く。
   完了したものは出さない（追補3 §3。complete() は項目を消さなくなったので、
   store.all() をそのまま並べると完了の海の中身がここへ混ざる）。 */
/* さがす（レビューの指摘）。

   > 海は新しい20件まで、唯一の全件「ならべる」は古い順で絞り込みも文字検索も効かない。
   > 書き出す人ほど、書いたものに二度と会えません

   そのとおりだった。書くことを勧めておいて、書いたものへ戻る道が
   目で追うことしか無いのは、**書く**という中核の約束のほうを裏切る。

   置き場所は「ならべる」の中。あそこが「ぜんぶ読む場所」なので、
   さがすのもそこにあるのが素直（新しい画面もタブも増やさない）。

   **さがしている間は、ふだん外しているものも出す。**長期保留も完了も出す——
   さがすのは「どこへ行ったか分からないもの」を見つけるためで、
   そのときに「いまは見ないと決めたから隠す」を続けると、探し物が見つからない。
   代わりに、その行が**いまどこに居るか**を右端に出す（長期保留 / 完了）。

   件数は出さない（§0。分母のある数字を作らない）。無いときは「見つからない」とだけ。 */
let gridQ = '';
let gridFind = null;

function normQ(v) { return String(v || '').trim().toLowerCase(); }

/* さがす対象は本文・次の一手・リンク・積んだ記録。
   「あれ、なんて書いたっけ」は本文以外に書いてあることも多い */
function hay(t) {
  const parts = [t.text || ''];
  if (has('firstStepOf')) { try { parts.push(store.firstStepOf(t.id) || ''); } catch (err) { /* 無ければ空 */ } }
  if (has('urlOf')) { try { parts.push(store.urlOf(t.id) || ''); } catch (err) { /* 同上 */ } }
  if (has('stepsOf')) {
    try { (store.stepsOf(t.id) || []).forEach(x => { parts.push(x.did || ''); parts.push(x.next || ''); }); }
    catch (err) { /* 同上 */ }
  }
  return parts.join('\n').toLowerCase();
}

function renderGrid() {
  const q = normQ(gridQ);
  /* 契約 §7 は「ならべるは全件が並ぶ」だが、長期保留はここにも出さない。
     長期保留＝**自分で「いまは見ない」と決めたもの**なので、
     全部を読む場所にも出さない（完了を外しているのと同じ理由）。出したいときは上の海へ。
     **ただし、さがしている間は別**（上の注記を見よ）。 */
  const base = q
    ? store.all().filter(t => hay(t).indexOf(q) >= 0)
    : store.all().filter(t => !isDoneItem(t) && !isHoldItem(t));
  const list = base.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  gridEmpty.hidden = list.length > 0;
  gridEmpty.textContent = q
    ? '「' + gridQ.trim() + '」は見つからない。'
    : 'まだ何も無い。下に書くと、ここに並ぶ。';
  if (gridCap) gridCap.textContent = q ? 'さがした結果（古い順）' : '古い順';

  /* 行はバブルを組まずに作り直す。**海が新しいほうしか出さなくなったので、
     ここが「ぜんぶ読む場所」になった**——読む場所は、絵ではなく文字のほうが速い。
     バブルを1件ずつ組むと DOM 5ノード・グラデーション7層が件数ぶん増えるが、
     行なら3ノードで済む（実測：バブル1個で5ノード／7層／影1／動くアニメ1本）。

     押したら長押しメニューを開く。詳細・5分・はじめた・完了・消す が全部そこにある
     ——一覧のために別の操作を発明しない。 */
  gridNodes.forEach(g => { if (typeof g.detach === 'function') g.detach(); g.node.remove(); });
  gridNodes.clear();

  const map = tagColorMap();
  list.forEach(t => {
    const row = el('button', 'sea-row');
    row.type = 'button';
    row.dataset.id = t.id;

    /* 色の点。付いているタグのぶんだけ、最大3つ（それ以上は行が点で埋まる）。
       色だけを手がかりにしないので、読み上げ文にはタグの名前を入れる（1.4.1） */
    const dots = el('span', 'sea-row-dots');
    dots.setAttribute('aria-hidden', 'true');
    const ids = tagsOfSafe(t.id);
    const cols = ids.map(x => map.get(x)).filter(c => c);
    if (!cols.length) {
      const d = el('span', 'dot is-none');
      dots.appendChild(d);
    } else {
      cols.slice(0, 3).forEach(c => {
        const d = el('span', 'dot');
        d.style.setProperty('--tcd', c);
        dots.appendChild(d);
      });
    }
    row.appendChild(dots);

    const tx = el('span', 'sea-row-tx');
    tx.textContent = t.text;                 /* ユーザーの文字。innerHTML には入れない */
    row.appendChild(tx);

    if (isStarted(t)) {
      const st = el('span', 'sea-row-st', DONE_LB);
      row.appendChild(st);
    }

    /* さがしている間は、ふだん出さないものも出す。
       出す以上、**いまどこに居るか**を言わないと「なぜここに」になる */
    if (normQ(gridQ)) {
      const where = isDoneItem(t) ? nameOf(fixedTag('down'))
        : isHoldItem(t) ? nameOf(fixedTag('up')) : '';
      if (where) {
        const w = el('span', 'sea-row-where', where);
        row.appendChild(w);
      }
    }

    const names = namesOf(t);
    row.setAttribute('aria-label', t.text + (names.length ? '（' + names.join('、') + '）' : ''));
    row.addEventListener('click', ev => { ev.preventDefault(); menuFor(t.id, row); });

    gridNodes.set(t.id, { node: row, detach: null });
    grid.appendChild(row);
  });
}

/* ---------------- 画面まわりの表示 ---------------- */

function renderChrome() {
  const tag = faceTag(curFace);
  /* 絞っている間は面の名前が変わる。これが「いま絞っている」の常時の合図（追補4 §2） */
  const narrow = curFace === 'center' && narrowOn();
  const name = curFace !== 'center' ? nameOf(tag) : (narrow ? (narrowName() || NARROW_NAME) : CENTER_VIEW_NAME);

  /* 面が中央ひとつしか無いなら、名前を出さない（選びようがないものに名札は要らない）。
     ただし絞っている間は、名前そのものが合図なので必ず出す */
  const many = liveFaces().length > 1;
  faceName.hidden = (!many && !narrow) || gathering;
  faceLabel.textContent = name;
  faceName.classList.toggle('is-narrow', narrow);
  faceDot.hidden = !tag;
  if (tag) faceDot.style.setProperty('--edge-c', colorOf(tag, curFace));
  faceName.setAttribute('aria-label', name + 'の海');

  liveFaces().forEach(f => {
    const fe = faces[f].el;
    const t = faceTag(f);
    const n = f === 'center' ? CENTER_NAME : nameOf(t);
    fe.setAttribute('aria-label', n + 'の海');
    /* 面ごとにうっすら色を敷く。名札だけだと、滑っている最中に
       別の海へ移ったことが分からない（どの面も同じ絵に見える） */
    if (t) fe.style.setProperty('--face-c', colorOf(t, f));
    else fe.style.removeProperty('--face-c');
    /* 見えていない面は、指にもキーボードにも読み上げにも触らせない */
    if ('inert' in fe) fe.inert = (f !== curFace);
  });

  /* 面ごとの空のときの言葉 */
  liveFaces().forEach(d => {
    const f = faces[d];
    if (!f || !f.empty) return;
    const t = faceTag(d);
    const show = !!t && faceItems(d).length === 0;
    f.empty.hidden = !show;
    if (!show) return;
    /* 書いてあることが本当に起きること。端へ落とせない海に
       「端へ運ぶと付く」とは書かない（下＝完了。DROP_DIRS を見よ） */
    if (t.id === 'done') f.empty.textContent = 'ここには、[タスク完了] を押したものが集まる。';
    else if (t.id === 'hold') f.empty.textContent = 'ここには『' + nameOf(t) + '』にしたものが浮かぶ。バブルを上の端へ運ぶと入る。';
    else f.empty.textContent = 'ここには『' + nameOf(t) + '』が付いたものが浮かぶ。バブルを端へ運ぶと付く。';
  });

  syncHint();
  syncMore();
  syncNarrowBtn();
  syncRandomBtn();
  renderEdges(); renderSigns(); renderOff();
  syncComposer();
}

/* 出し切れていないときの1行（利用者の指示）。

   **数は出さない。**「あと120件」は、やっていないことの数を突き返すのと同じになる
   （README の禁止事項）。言うのは「新しいほうから出している」という**見え方の説明**と、
   全部を読む行き先だけ。

   出す条件は「いまの面が上限に当たっている」。当たっていなければ何も出さない
   ——ふだんの海には出ない1行にする。 */
function syncMore() {
  if (!moreLine) return;
  const shown = faceItems(curFace);         /* ここで seaClipped が立つ */
  const clipped = seaClipped && shown.length > 0;
  moreLine.hidden = !clipped || gathering || !!bubbleDrag;
}

/* 中央の海が空のときの言葉。
   絞っていないとき … 従来のヒント（書き方の案内）
   絞っていて0件 … 未達を名指ししない。「ここには何も無い」だけ言って、戻し方を添える
   （「全部片付いています」も「まだ0件です」も、どちらも数の話になってしまう／追補4 §2） */
/* 中央が空のとき、言うことは3つに分かれる。
   ・まだ何も書いていない        … はじめの案内
   ・絞った先に無い              … 戻り方
   ・書いたものが全部タグを持つ  … **既定はタグ無しだけ**なので、それを言う
     （ここを言わないと「書いたのに消えた」に見える。既定を絞った以上、要る） */
function syncHint() {
  const onCenter = !gathering && curFace === 'center';
  const empty = onCenter && centerItems().length === 0;
  const narrow = narrowOn();
  let anything = false;
  if (empty && !narrow) {
    try { anything = store.all().some(t => !isDoneItem(t)); } catch (err) { anything = false; }
  }
  hint.hidden = !(empty && !narrow && !anything);
  if (centerEmpty) {
    const show = empty && (narrow || anything);
    centerEmpty.hidden = !show;
    if (show) {
      centerEmpty.innerHTML = narrow
        ? 'しぼった先には何も無い。<br>しぼりこみで「' + CENTER_VIEW_NAME + '」を選ぶと、もとの眺め。'
        : 'ここに漂うのは、タグの付いていないものだけ。<br>'
          + 'タグの付いたものは「▽しぼる」から、<br>ぜんぶは「⇅ならべる」から見える。';
    }
  }
}

/* 書いたものには、いまいる面のタグが付く（下の form の submit を参照）。
   入力欄にそう書いておかないと、書いた先が分からない。 */
function syncComposer() {
  const tag = faceTag(curFace);
  const taggable = tag && tag.id !== 'done' && has('setTag');
  const base = '思いついたことを書く';
  input.placeholder = taggable ? '『' + nameOf(tag) + '』に書く' : base;
  input.setAttribute('aria-label', taggable ? base + '。『' + nameOf(tag) + '』が付く' : base);
}

/* ---------------- 描画 ---------------- */

function render() {
  forgetTagColors();   /* タグの色や名前が変わっているかもしれない。引き直す */
  forgetSeas();        /* 海が増減・並べ替えされているかもしれない */
  syncFaceEls();       /* 器を並びに合わせる（作る／畳む／列番号を配り直す） */

  /* 海から降ろされた面に立っていたら、中央へ戻す */
  if (curFace !== 'center' && !faceTag(curFace)) {
    curFace = 'center';
    setWorldFace('center');
    startCurrent();
  }

  /* 整列中は海の物理側を触らない。触ると drift がバブルを作り直し、
     グリッドと同じものが二重に見える。もどすときに setGathering が同期し直す */
  if (gathering) renderGrid();
  else syncFaces();

  /* 詳細の相手が消えたら閉じる。残っていれば外の変化を映し直す */
  if (openDetailId) {
    const t = store.get(openDetailId);
    if (!t) closeDetail();
    else {
      sheetTitle.textContent = t.text;
      const d = details.get(openDetailId);
      if (d) d.sync();
    }
  }

  renderChrome();
}

/* ---------------- 画面モジュール ---------------- */

export default {
  id: 'sea',
  label: '海',
  icon: '○',

  mount(pane) {
    root = pane;
    pane.classList.add('sea-pane');

    /* --- ステージ（画面の全高）--- */
    stage = el('div', 'sea-stage');
    stage.id = 'sea-stage';

    /* --- ズームの窓。ここに倍率と寄せが掛かる ---
       世界（.sea-world）を直に縮めると、面が ±100% の位置に置いてあるぶん、
       引いたときに隣の面が余白へはみ出して見える。窓を1枚かぶせて clip する。
       倍率 1.00 のときは窓はステージと同じ大きさなので、何も変わらない。 */
    view = el('div', 'sea-view');

    /* --- 4つの面。世界ごと動かして切り替える --- */
    world = el('div', 'sea-world');
    syncFaceEls();
    setWorldFace('center');

    /* 空のときの案内。**書いてあることが本当に起きること**。
       前の文は3つとも古くなっていた：
         「もう一度タップで5分」… 2度目のタップで開く経路は廃止（盤の [まずは開始] だけ）
         「長押しでメニュー」  … 長押しでは開かない（メニューは盤に統合、鍵盤の経路のみ）
         「背景を…なぞると」   … 矢印看板を押しても移れるようになった */
    hint = el('p', 'sea-hint',
      '思いついたことを、下に書く。<br>書いたものはここを漂う。<br><br>' +
      'タップすると真ん中に来て、そこから5分。<br>' +
      '矢印の看板か、背景をなぞって、となりの海。');
    faces.center.el.appendChild(hint);

    /* 絞った結果が0件のときの言葉。未達を名指ししない（追補4 §2）。
       戻し方は「もどす」から「しぼりこみの一覧の先頭」へ変わったので、そう書く
       ——画面に無いボタンの名前を書かない */
    /* 文は syncHint が場面ごとに入れ替える（作るときの文は初期値） */
    centerEmpty = el('p', 'sea-face-empty',
      'しぼった先には何も無い。');
    centerEmpty.hidden = true;
    faces.center.el.appendChild(centerEmpty);



    /* --- 矢印看板（利用者の指示。A-9 / A-8 / A-10）---

       「中央から隣の面へ移る手がかりが、背景をなぞる以外に無い」への答え。
       行ける向きすべてに、矢印とその海の名前を出す。

       置き場所が肝で、**面の中の、バブルより後ろ**に入れる（DOM で先に足す＝先に描かれる）。
         ・後ろにあるので、看板の上にバブルが来ても、指はバブルに当たる
           （前は端の札が前にいて、真下のバブルがその一点で掴めなかった＝A-8）
         ・面と一緒に動くので、なぞっている最中も景色として付いてくる
         ・空いているところを押せば移れる（押す的が無くなった、も同時に解ける）

       ふだんはこれ。バブルを掴んでいる間は、代わりに端の札（.sea-edge、
       バブルより前）が「{タグ名} が付く」を出す——持っている指の下に隠れては困るため。 */

    view.appendChild(world);
    stage.appendChild(view);

    /* --- いまどの面にいるか（常に見えていること） --- */
    faceName = el('div', 'sea-face-name');
    faceName.setAttribute('role', 'status');
    faceDot = el('span', 'dot');
    faceDot.setAttribute('aria-hidden', 'true');
    faceLabel = el('span', 'nm', CENTER_NAME);
    faceName.appendChild(faceDot);
    faceName.appendChild(faceLabel);
    stage.appendChild(faceName);

    /* --- 端の手がかり。押しても移れる（指だけの経路にしない） --- */
    EDGE_DIRS.forEach(dir => {
      const box = el('div', 'sea-edge');
      box.dataset.dir = dir;
      box.hidden = true;
      const btn = el('button', 'sea-edge-btn');
      btn.type = 'button';
      const dot = el('span', 'dot');
      dot.setAttribute('aria-hidden', 'true');
      const label = el('span', 'nm');
      btn.appendChild(dot);
      btn.appendChild(label);
      box.appendChild(btn);
      const rec = { el: box, btn, dot, label, target: null };
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        if (rec.target) goFace(rec.target);
      });
      edges[dir] = rec;
      stage.appendChild(box);
    });

    /* --- 出し切れていないときの1行（利用者の指示）--- */
    moreLine = el('p', 'sea-more', '新しいほうから出している。<br>「ならべる」で、ぜんぶ。');
    moreLine.hidden = true;
    stage.appendChild(moreLine);

    /* --- タグを外す枠（掴んでいる間だけ、下の真ん中に出る）---
       ステージの子。倍率が掛かると狙いにくくなるので、面の中には置かない。
       指は透かす——判定は指先の座標でやるので、当たり判定を持つ必要がない
       （持つと、真下に居るバブルを掴めなくする） */
    dropOff = el('div', 'sea-dropoff');
    dropOff.hidden = true;
    dropOff.setAttribute('aria-hidden', 'true');
    offLabel = el('span', 'lb');
    dropOff.appendChild(offLabel);
    stage.appendChild(dropOff);

    /* --- ならべる（トグル） --- */
    gatherBtn = el('button', 'sea-gather');
    gatherBtn.type = 'button';
    const ic = el('span', 'ic', '⇅');
    ic.setAttribute('aria-hidden', 'true');
    gatherLabel = el('span', 'lb', 'ならべる');
    gatherBtn.appendChild(ic);
    gatherBtn.appendChild(gatherLabel);
    gatherBtn.setAttribute('aria-pressed', 'false');
    gatherBtn.title = '押すと全部が並ぶ';
    gatherBtn.addEventListener('click', ev => {
      ev.preventDefault();
      setGathering(!gathering);
    });
    stage.appendChild(gatherBtn);

    /* --- しぼる（中央の海だけ／トグル） ---
       面の名前のすぐ下に置く。名前（いま何が浮かんでいるか）と
       その切り替えが縦に並ぶので、対で読める。
       「ならべる」は右上のまま。2つのモードのボタンを隣り合わせない。 */
    narrowBtn = el('button', 'sea-narrow');
    narrowBtn.type = 'button';
    const nic = el('span', 'ic', '▽');
    nic.setAttribute('aria-hidden', 'true');
    narrowLabel = el('span', 'lb', 'しぼる');
    narrowBtn.appendChild(nic);
    narrowBtn.appendChild(narrowLabel);
    narrowBtn.hidden = true;
    narrowBtn.setAttribute('aria-haspopup', 'menu');
    narrowBtn.setAttribute('aria-expanded', 'false');
    narrowBtn.addEventListener('click', ev => {
      ev.preventDefault();
      openNarrowPop();
    });
    stage.appendChild(narrowBtn);

    /* --- ランダムスタート（いま開いている面から1つ、無作為に） --- */
    randomBtn = el('button', 'sea-random');
    randomBtn.type = 'button';
    randomBtn.appendChild(diceIcon());
    randomBtn.addEventListener('click', ev => {
      ev.preventDefault();
      randomStart();
    });
    stage.appendChild(randomBtn);

    /* --- 整列中のグリッド（海の物理配置とは別レイアウト） --- */
    grid = el('div', 'sea-grid');
    grid.hidden = true;
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'すべてのバブル');
    /* 並びは古い順のまま。海が新しいほうしか出さなくなったので、
       **ここの先頭が「海から隠れたもの」**になる＝探しに来た人が最初に見る場所。
       ただし「放置しているものが先頭」という言い方はやめた——
       出す範囲が広がったぶん、その札は未達の名指しに寄りすぎる（§0）。 */
    /* --- さがす（レビューの指摘）---
       「ぜんぶ読む場所」の先頭に置く。新しい画面もタブも増やさない。 */
    const findBox = el('div', 'sea-find');
    gridFind = el('input', 'in');
    gridFind.type = 'search';
    gridFind.placeholder = 'さがす';
    gridFind.autocomplete = 'off';
    gridFind.setAttribute('aria-label', '書いたものをさがす');
    gridFind.addEventListener('input', () => { gridQ = gridFind.value; renderGrid(); });
    gridFind.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();          /* 整列そのものは畳まない。文字だけ消す */
      if (!gridQ) return;
      gridQ = ''; gridFind.value = ''; renderGrid();
    });
    findBox.appendChild(gridFind);
    grid.appendChild(findBox);

    gridCap = el('p', 'sea-grid-cap', '古い順');
    grid.appendChild(gridCap);
    gridEmpty = el('p', 'sea-grid-empty', 'まだ何も無い。下に書くと、ここに並ぶ。');
    gridEmpty.hidden = true;
    grid.appendChild(gridEmpty);
    stage.appendChild(grid);

    /* overflow:clip を知らないブラウザでは、ステージがスクロール容器のままになる。
       中のバブルに focus が当たると勝手にスクロールして中身が丸ごとずれるので、戻す。 */
    stage.addEventListener('scroll', () => {
      if (stage.scrollLeft) stage.scrollLeft = 0;
      if (stage.scrollTop) stage.scrollTop = 0;
    });

    /* 背景から始めた指だけが面を動かす。バブルから始めた指はタグ付け（bubble.js が拾う） */
    stage.addEventListener('pointerdown', onStageDown);

    /* ズーム。ホイールは既定の動き（ページのスクロール）を止めるので passive にできない */
    stage.addEventListener('wheel', onWheel, { passive: false });
    /* つまむ指の数を数える。捕捉（capture）で先に拾うのは、
       下の誰かが stopPropagation しても本数を数え損ねないため。
       上げるほうは window で受ける——ステージの外で指を離すことがある */
    stage.addEventListener('pointerdown', trackDown, true);
    window.addEventListener('pointermove', trackMove, true);
    window.addEventListener('pointerup', trackUp, true);
    window.addEventListener('pointercancel', trackUp, true);
    /* 選び札の外を押したら畳む。押した先のボタンを取りこぼさないよう capture で先に拾う */
    document.addEventListener('pointerdown', ev => {
      if (!narrowPop) return;
      const t = ev.target;
      if (t && t.closest && t.closest('.sea-narrow-pop, .sea-narrow')) return;
      closeNarrowPop(false);
    }, true);

    pane.appendChild(stage);

    /* --- 詳細（最初の一手 / URL / 開始した） --- */
    sheet = el('section', 'sea-sheet');
    sheet.hidden = true;
    const sheetHead = el('div', 'sea-sheet-head');
    sheetTitle = el('h2', 'tt');
    sheetHead.appendChild(sheetTitle);
    const closeBtn = el('button', 'cl');
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', closeDetail);
    sheetHead.appendChild(closeBtn);
    sheet.appendChild(sheetHead);
    sheetBody = el('div', 'sea-sheet-body');
    sheet.appendChild(sheetBody);
    sheet.tabIndex = -1;
    sheet.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      closeDetail();
    });
    pane.appendChild(sheet);

    /* --- 入力（いちばん下）。面が変わっても書ける --- */
    composer = el('form', 'sea-composer');
    input = el('input');
    input.type = 'text';
    input.placeholder = '思いついたことを書く';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '思いついたことを書く');
    sendBtn = el('button', null, '送信');
    sendBtn.type = 'submit';
    sendBtn.disabled = true;

    /* 送信の右。押すと海に足して、そのまま5分の集中が開く。
       送信と見分けが付くように、形も色も変える（塗りつぶしの角丸 ↔ 縁だけの丸）。
       時計の印だけでは何のボタンか分からないので、読み上げの名前を付ける */
    quickBtn = el('button', 'sea-quick');
    quickBtn.type = 'button';           /* submit にすると通常の Enter でも発火する */
    quickBtn.disabled = true;
    quickBtn.setAttribute('aria-label', '書いて、すぐ始める（5分だけ集中）');
    quickBtn.title = '書いて、すぐ始める（5分だけ集中） Cmd+Enter / Ctrl+Enter';
    quickBtn.appendChild(clockIcon());
    quickBtn.addEventListener('click', ev => {
      ev.preventDefault();
      quickStart();
    });

    composer.appendChild(input);
    composer.appendChild(sendBtn);
    composer.appendChild(quickBtn);
    input.addEventListener('input', syncSend);

    /* Cmd+Enter（Windows / Linux のために Ctrl+Enter も）＝ 書いて、すぐ始める。
       入力欄に付ける。window に付けると画面のどこでも発火してしまう。
       通常の Enter には触らない（form の submit のまま）。 */
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      if (!ev.metaKey && !ev.ctrlKey) return;
      if (ev.isComposing || ev.keyCode === 229) return;   /* 変換の確定は拾わない */
      ev.preventDefault();
      ev.stopPropagation();
      quickStart();
    });

    composer.addEventListener('submit', ev => {
      ev.preventDefault();
      addFromComposer();
    });
    pane.appendChild(composer);

    /* --- 物理（中央の面だけ先に作る。タグの海は必要になってから） --- */
    ensureField('center');

    unsubscribe = store.on(render);

    /* mount の時点ではペインが display:none で寸法が 0。
       サイズが取れるようになったら drift に置き直させる（契約 §14） */
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        syncFloor();                   /* 入力欄の高さが変わることもある */
        if (!stage.clientWidth || !stage.clientHeight) return;
        liveFaces().forEach(f => {
          const fl = faces[f].field;
          if (fl && fl.relayout) { try { fl.relayout(); } catch (err) { /* 測れないだけ */ } }
        });
        if (!swipe) setWorldFace(curFace);   /* 幅が変わっても面の位置がずれないように */
      });
      ro.observe(stage);
    }

    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAll();
    });

    render();
  },

  onShow() {
    shown = true;
    /* ここで初めてペインが display:flex になる。寸法が取れるのはこの時点から */
    syncFloor();                       /* 面の高さが決まってから relayout する */
    liveFaces().forEach(f => {
      const fl = faces[f].field;
      if (fl && fl.relayout) { try { fl.relayout(); } catch (err) { /* 測れないだけ */ } }
    });
    setWorldFace(curFace);
    applyZoom();                       /* 寄せられる幅は面の高さで決まる。測れてから掛け直す */
    render();
    startCurrent();
  },

  onHide() {
    shown = false;
    cancelHold();
    if (seaMapOpen()) closeSeaMap(false);
    cancelSwipe();
    closePan(); pinchPts.clear(); pinch = null;
    resetZoom();              /* 小さいまま・寄せたまま開き直すと、端が無いように見える */
    cancelShuffle();          /* 混ぜかけのまま裏に回ったら畳む。開かない */
    setGathering(false);      /* タブを離れたら整列は解除（契約 §7） */
    closeDetail();
    clearTimeout(stopTimer); stopTimer = 0;
    liveFaces().forEach(f => {
      const fl = faces[f].field;
      if (fl && fl.stop) { try { fl.stop(); } catch (err) { /* 止め損ねで転ばない */ } }
    });
    flushAll();
  },

  /* 外から面を指定して開く（追補5 §5 の「ふりかえり → 完了の海」の受け口）。
     app.js が show('sea') のあとで呼ぶ。mount 済み・onShow 済みが前提。

     face は 'center' | 'up' | 'left' | 'right' のほか、タグの id でも受ける。
     タグの id なら、そのタグが**いま置かれている向き**へ移る。
     置かれていなければ何もしない（勝手に向きを割り当てない）。戻り値は移れたかどうか。

     移動のアニメーションは付けない。goFace() は setWorldFace() で面を差し替えるだけで、
     滑らせるのは指でなぞったときの cancelSwipe/settle 経路。タブを切り替えた直後なので、
     ここは「もうその面が開いている」状態で見えるのが素直。 */
  openFace(face) {
    if (typeof face !== 'string' || !face) return false;
    forgetSeas();
    let dir = null;
    if (face === 'center') dir = 'center';
    else if (liveFaces().indexOf(face) >= 0) dir = faceTag(face) ? face : null;
    else {
      /* タグの id で来た。その海があればそこへ */
      const f = (face === 'hold') ? 'up' : (face === 'done') ? 'down' : faceOfTag(face);
      dir = (liveFaces().indexOf(f) >= 0 && faceTag(f)) ? f : null;
    }
    if (!dir) return false;                 /* 割り当てが無い＝開けない */
    if (gathering) setGathering(false);     /* 整列中なら解いてから移る */
    cancelSwipe();
    /* 絞り込み（しぼる）はそのままにする。指でなぞって面を移ったときも解けないので、
       ここだけ解くと戻ってきたときの見え方が食い違う */
    goFace(dir);
    return true;
  },
};

function flushAll() {
  details.forEach(d => d.flush());
  if (has('flush')) store.flush();
}
