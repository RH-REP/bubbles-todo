/* 漂う面（海・今日）。

   物理はぜんぶ js/screens/todo.js から持ち上げたもの。書き直していない。
     ・raf ループと SPEED（漂う速さ）
     ・投げた勢いの減衰（空気に受け止められる感じ）
     ・壁での反射
     ・重なりをやわらかく押し離す総当たり
     ・relayout（mount 時点では寸法が 0 なので、onShow から呼び直す）
     ・reduced motion のときの settle（漂わせず、重なりだけほどく）

   変えたところは4つ。
     ・「ならべる」。契約 §7 により、押している間の縮小配置ではなく
       スクロールするグリッドにした（全件が並ぶので、縮めると読めなくなるため）
     ・弱い重力。追補3 §2。漂いはそのままに、下向きの弱い力を足した。
       底では跳ね返さず止める（左右と上は今までどおり反射する）
     ・バブルどうしのぶつかり。位置を押し離すだけだったものを、
       作用・反作用のある撃力に作り替えた（質量は直径の3乗）。下の HIT_* を見ること
     ・引力のあるセル。追補5 §1。setWells() で渡した矩形の中にいるときだけ、
       中心へ 距離の2乗に反比例する力で引かれ、中心の近くで遅くなったら止まる。
       セルを1つも渡さなければ、この機能は丸ごと眠る。下の WELL_* を見ること
     ・「パチっとはまる」手ごたえ（利用者の指示）。引力だけだと寄り切るまで数秒かかり、
       「はまった瞬間」が無い。セルの近くで手を離した／ゆっくり入ってきたときは、
       力ではなく **時間で** 中心へ運んで止める（0.18秒）。下の SNAP_* を見ること
     ・摩擦を少し下げた（利用者の指示）。速度を減衰させている項だけを下げてある。
       REST_DRAG 1.2→1.0 ／ WELL_DRAG 2.0→1.8 ／ 空気抵抗の下駄 1.1→0.9 ／
       底に叩きつけたときの横の損 0.86→0.90。
       力の側（GRAV / GRAV_MAX / HIT_E / 質量 d³）と壁の跳ね返り 0.72 は触っていない。
       各所のコメントに載っている実測値は、下げたあとの値に取り直してある

   指の読み取りは js/bubble.js。ここは受け取った初速を載せるだけ。 */

import { store } from './store.js';
import { clamp, el } from './ui.js';
import { makeBubble, updateBubble, attachGestures, RM } from './bubble.js';

const SPEED = 16;      /* 漂う速さ px/秒 のおおよそ */

/* 弱い重力（追補3 §2）。
   面のいちばん上から下まで、およそ1分。756px の面なら 756/60 ≒ 12.6 px/s。
   加速し続けないよう、終端速度 GRAV_MAX まで「しか」加速しない。
   GRAV_MAX は漂う速さ SPEED=16 より遅い。海が滝にならないための上限。 */
const GRAV = 2;         /* 下向きの加速 px/s²。利用者の指示で 20 → 2（1/10）。
                           0 から終端まで 5.5 秒ほどかけて、そっと乗る。
                           落ち切るまでの時間はほぼ終端速度 GRAV_MAX が決めるので、
                           ここを下げても「上から下まで」の時間はあまり変わらない。 */
const GRAV_MAX = 1.1;   /* 終端速度 px/s。利用者の指示で 11 → 1.1（1/10）。
                           680px の海を落ち切るのに十数分かかる、ほとんど止まって見える速さ。
                           漂う速さ SPEED=16 のほうがずっと速いので、実際の見え方は
                           「ゆらぎながら、じわじわ下がる」になる。 */

/* 底に着いたものの扱い。跳ね返らせず、そこで止める。
   契約 §0（やり残しの山に見せない）があるので、底で密に詰めない。
   ・止まったものには重力を掛けない。下へ押し込み続けないので、詰まって固まらない
   ・止まる判定は毎 tick 引き直す。支えが横へ抜ければ、また落ちる
   ・止まる間合いを押し離し（4px）より狭くしてある。載ったものには必ず押し離しが
     届くので、既存の当たり判定だけで横へ広がる。積み上がらず、底に薄く散る
   ・着地の高さを 1バブルごとに少しずらす。底の線が定規で引いた棚にならない */
const REST_UP = 8;      /* これより速く上へ動いているものは止めない（投げ上げを殺さない） */
const REST_GAP = 3;     /* 支えとみなす隙間 px。押し離しの間合い HIT_GAP=4px より狭いこと */
const REST_DRAG = 1.0;  /* 止まったあとの横滑りを収める強さ 1/s。利用者の指示で 1.2 → 1.0。
                           底で 16px/s で滑り出したものが止まる（0.1px/s 未満）まで
                           4.19 秒・13.1px だったのが、5.04 秒・15.7px になる（実測）。
                           下げると横へ長く滑る＝底で詰まりにくくなる向きなので、
                           契約 §0（やり残しの山に見せない）には効く向きに動く。
                           実際、7個・14個を 1800/3600 秒 溜めた散らばりは
                           下げる前と同じか少し広い（種を5本変えて実測。下の検証3） */
const REST_PAD = 10;    /* 着地の高さのばらつき px */

/* バブルどうしのぶつかり（利用者の指示）。

   前は「押しのける側」と「押しのけられる側」が別物で、大きさも見ていなかった。
   ぶつかった2つは位置だけ押し離され、速度は誰も変わらないので、
   ぶつかった相手がその場で止まって見える（＝反作用がきいていない）。

   作り直した中身：
     ・質量 m = d³。直径の3乗。比しか使わないので比例定数は要らない
     ・中心を結ぶ線に沿った撃力 J で解く。接線（横滑り）方向は触らない
     ・作用と反作用は同じ大きさ・逆向き。片方だけを動かさない
     ・速度の変化は Δv = J/m。同じ撃力でも大きいほうはほとんど動かず、
       小さいほうがよく弾かれる
     ・近づいている組だけ弾く。離れかけを弾くと、くっついて震える

   反発係数 HIT_E=0.9 は「10 のうち 9 が両者に等分（4.5ずつ）返り、1 は熱として消える」。
   ここでいう 9:1 は“近づく速さ”の割合。離れる速さ = 近づく速さ × 0.9 になる。
   運動エネルギーで数えると減り方は 1-0.9² ＝ 19% で、10% ではない。
   （運動エネルギーで 10% にしたいなら HIT_E は √0.9 ≒ 0.9487。ここは指示どおり 0.9） */
const HIT_E = 0.9;      /* 反発係数。離れる速さ ÷ 近づく速さ */
const HIT_GAP = 4;      /* ぶつかったとみなす間合い px。REST_GAP=3 より広いこと。
                           底に載ったものへ必ず押し離しが届くので、積み上がらず横へ散る */
const HIT_PUSH = 0.32;  /* めり込みを 1コマで解く割合（2つぶんの合計）。従来と同じ強さ。
                           撃力とは別に要る。こちらも質量の逆比で配る */

/* 引力のあるセル（追補5 §1）。
   setWells() で矩形（セル）を渡すと、その中に中心があるバブルだけが
   セルの中心へ引かれる。矩形の外では何も起きない（＝「セルの中だけで感じ取れる強さ」）。
   セルを1つも渡さなければ、ここは丸ごと眠る（＝いままでと同じ面）。

   ・引力は加速度として掛ける（a = K/d²）。質量で割らない。
     割ると大きいバブルだけ吸い込まれなくなり、枠の意味が壊れる
   ・d には下限 WELL_DMIN を置く。中心で発散させないため
   ・「吸い込まれて固定」には、力だけでは足りない。
     保存力（k/d²）は中心でいちばん速くなるので、放っておくと中心を通り抜けて
     反対側へ登り、永久に往復する。エネルギーを捨てる項が要る。
     そこで **セルの中だけ** の粘り WELL_DRAG を足した。セルの外の漂いには一切触らない */
const WELL_K = 48000;    /* 引力の強さ px³/s²。a = K/d²。
                            強さを決めた物差しは「吸い込まれる速さが、漂う速さを超えないこと」。
                              ・粘りと釣り合う速さ（終端）は、下限のところで
                                a(40)/WELL_DRAG = 30/1.8 = 16.7 px/s。
                                ただし終端に届く前に固定されるので、実際に出る
                                いちばん速い速さは 15.1〜16.0 px/s（実測）。
                                漂う速さ SPEED=16 px/s を超えない。
                                いちばん速いところでも「漂いより速い」に見えないので、
                                引ったくられた感じにならない。
                                それでも重力の終端 GRAV_MAX=1.1 px/s の 14 倍なので、
                                セルの中では引力が主役だとはっきり分かる
                              ・力で見ると a(40) = 30 px/s²。重力 GRAV=2 の15倍
                              ・セルの縁のあたり a(64) = 11.7、a(90) = 5.9 px/s²。
                                直径 96 のバブル1個ぶんのセル（〜128px角）なら
                                いちばん遠い角でも重力の3倍あり、確実に中心へ寄る
                            強くしすぎない理由: 引力はセルの矩形の中にしか無いので
                            「近くを通ると吸い寄せられる」にはそもそもならないが、
                            速く吸い込むほど置き直しの猶予が短くなる。
                            上の速さなら、128px 角のセルの左端（中心から 62px）から
                            中心に届くまで 5.68 秒、そこから固定まで合わせて 6.8 秒。
                            角からなら 14.6 秒（いずれも実測）。指で掴み直せる速さ。
                            ※ 逆に、セルが 250px 角より大きいと、いちばん遠い角では
                              a < 3 px/s² で重力と同じくらいになる。広い「未分類」の
                              置き場を丸ごと1つのセルにすると、隅のものが中央へ
                              集まりきらない。井戸はバブル1個ぶんの升目に置くこと

                            ★ 上に書いてある「5.68 秒」「6.8 秒」「14.6 秒」は、
                              下の SNAP_* が入る前の、この力だけで寄り切ったときの値。
                              いまは **セルの中心から SNAP_R 以内は力を使わない**
                              （時間で 0.18 秒かけて運ぶ）ので、実際にこの時間が
                              出るのは SNAP_R より外だけ。きっかけ・すきま が渡す
                              96×96 のセルでは SNAP_R がセル全体を覆うので、
                              この力は「もっと広いセルを渡された画面」のためだけに残っている。
                              値そのものは変えていない */
const WELL_DMIN = 40;    /* d の下限 px。追補の例は 24 だが 40 にした。
                            2乗に反比例は近くで急に効くので、下限が小さいと
                            「縁では止まって見えるほど弱く、中心では叩きつける」になる。
                            下限 24 だと縁(60px)と下限の力の比が 6.25 倍、
                            40 なら 2.25 倍。固定のしきい値 WELL_PIN_D の
                            10倍以上あるので、最後の詰めのあいだ力はほぼ一定になり、
                            止まり方が読める。
                            ※ d > 40 では素直に 2乗に反比例する（検証2で実測） */
const WELL_DRAG = 1.8;   /* セルの中だけの粘り 1/s。時定数 0.56 秒。
                            セルに入ってきた漂い（16px/s）は 9px ほど滑って収まる。
                            「セルが受け止めた」と見える。セルの外の速度には触らない。

                            利用者の指示で 2.0 → 1.8（摩擦を少し下げる）。ここだけ
                            下げ幅を小さく（1割）してあるのは、この項が
                            「吸い込まれて固定」を成立させている当人だから。
                            保存力（K/d²）だけだと中心がいちばん速くなり、通り抜けて
                            反対側へ登り、永久に往復して固定できない。
                            下げると (a) 中心を行き過ぎる量が増えて止まる位置が中心から
                            ずれ、(b) 吸い込む速さが上がる。
                            2.0→1.8 で、止まった位置の中心からのずれは 1.99px → 2.51px
                            （固定のしきい値 WELL_PIN_D=3px の内側に留まる）、
                            いちばん速い速さは 14.4 → 16.0 px/s（漂う速さ 16px/s の内側）。
                            1.7 まで下げると 16.9 px/s で漂う速さを超え、ずれも 2.8px に
                            なって 3px の余白がほとんど無くなる（いずれも実測）ので、
                            1.8 で止めてある */
const WELL_PIN_D = 3;    /* この距離まで中心に近づいていて px。
                            追補の例は 12px だが 3px にした。理由は実測から。
                            この値は「止まってよい範囲」なので、そのまま
                            「中心からどれだけずれて止まるか」になる。12px にすると、
                            中心から 10px の所へそっと置いた（速さ 0）バブルは
                            0.03 秒でその場に固定され、**吸い込まれる動きが1度も出ない**。
                            利用者の指示は「吸い込まれるように固定される」なので、
                            置いた所で固まるのでは注文と違う。
                            3px なら同じ置き方で 1.36 秒かけて中心へ寄り、
                            中心から 2.00px で止まる（実測。WELL_DRAG=1.8 のとき。
                            2.0 だったころは 1.38 秒・1.71px）。
                            升目に並べる画面（きっかけ・すきま）でも、ずれが目に見えない */
const WELL_PIN_V = 3;    /* この速さより遅くなったら、その位置で止める px/s。
                            下限のところの終端 16.7 px/s より十分小さい。
                            つまり「通りがかりに止まる」ことはなく、
                            中心を行き過ぎたぶんが収まってから止まる。
                            投げられて速く通り抜けるものは掴まえない。
                            （PIN_D と数が同じなのは偶然。片方は px、片方は px/s）

                            ※ 隣の升目のバブルと押し合っている場合の注意。
                              ぶつかりの間合いは (d1+d2)/2 + HIT_GAP なので、
                              直径 96px を 96px 間隔の升目に並べると 4px 足りない。
                              押し合いが残って、中心から 1〜5px ずれた所で
                              いつまでも 0.2px/s ほど動き続ける（実測。13分回しても
                              ずれは 5px 以内で収まったまま。目には見えない速さ）。
                              升目の間隔を 直径+HIT_GAP（96 なら 100px）以上にすれば、
                              ずれ 0.000px でぴたりと止まる（実測） */

/* 「パチっとはまる」（利用者の指示）。

   引力（K/d²）だけだと、セルの縁から中心まで 6.8秒、角からなら 14.6秒かかる。
   なめらかだが「はまった瞬間」がどこにも無い。そこで **決まる所では力をやめて、
   時間で運ぶ**。掛かっているあいだ 重力・引力・粘り・ぶつかりの押し戻しは
   いっさい位置に効かせない（下の b.lock）。目的地は動かないので、寄り方が読める。

   ■ いつ始まるか（＝「規定の場所の近く」）
   セルの中心から SNAP_R 以内に中心があり、かつ次のどちらか。
     (a) そこで指を離した   … 利用者の「ここに置く」という意思表示。速さは見ない
     (b) 速さが SNAP_V 以下 … 漂って入ってきた／押し出されて流れ着いた
   **セルの矩形の外では何も起きない**（引力と同じ範囲。遠くから吸い寄せない）。

   ■ SNAP_R = min(セルの半対角, バブルの直径)
   きっかけ・すきま が渡してくるセルは バブルの外形ちょうどの 96×96
   （plan.js `applyWells` / gap.js `wellsFor`）。半対角は 96·√2/2 = 67.9px で
   バブルの直径 96 より小さいので、**セルの中ならどこで離しても はまる**。
   ＝「規定の場所」＝ そのバブル1個ぶんの升目、そのもの。これがいちばん素直な
   「近く」の切り方で、境目（セルの縁）が画面に見えている。

   直径のほうの上限は保険。画面が うっかり広い矩形を1つ渡したとき
   （追補5 §1 が戒めている「未分類の置き場を丸ごと1つのセルにする」）に、
   遠くからパチっと吸い寄せられるのを防ぐ。バブル1個ぶんより遠ければ、
   そこは「近く」ではないので、いままでどおり引力だけがゆっくり効く。
   96×96 のセルでは常に半対角のほうが小さいので、この上限は効かない。 */
const SNAP_R_MAX = 1.0;  /* 上限＝バブルの直径の何倍か。1.0 ＝ 直径ぶん */
const SNAP_T = 0.18;     /* 中心へ運ぶ時間 秒。指示の目安 0.15〜0.25 の中ほど。
                            0.15 を切ると瞬間移動に見え、0.25 を超えると
                            「決まった」より「寄っていった」に見える。
                            実測: 離してから止まるまで 0.192 秒（16ms コマの丸めぶん）。
                            移り方は ease-out（1-(1-u)³）。出だしがいちばん速く、
                            中心で止まる。行き過ぎ（跳ね返り）は入れていない ──
                            跳ねは祝祭側の表現で、契約 §0 に触れる */
const SNAP_V = SPEED;    /* 指を離していないときに はまる速さの上限 px/s。
                            漂う速さ SPEED=16 と同じにしてある。
                            「漂いで入ってきたものはセルが受け止める。
                              投げつけられて速く通り抜けるものは掴まえない」。
                            速いものは、いままでどおり引力と粘りに削られてから収まる */
const SNAP_FX_MS = 300;  /* 見た目の合図（.is-snap）を外すまで。CSS の 0.22 秒より長く取る */

/* host にバブルの面を作る。
     opts = {
       size: number|'text',        既定 'text'
       persist: bool,              既定 true（store の fx/fy を読み書きする）
       onFocusRequest, onMenu, onDropToTab, onDragStart, onDragEnd,
     }
   返り値 = { setItems, relayout, start, stop, setGathering,
              setWells, wellOf, nodeOf, pop, destroy } */
export function createField(host, opts = {}) {
  const size = (opts.size == null) ? 'text' : opts.size;
  const persist = opts.persist !== false;

  const bubbles = new Map();   /* id -> {id, el, d, cx, cy, vx, vy, held, rest, pad, placed, order, well, pin, detach} */
  let wells = [];              /* 引力のあるセル [{id,x,y,w,h,cx,cy}]（追補5 §1） */
  const fx = new Map();        /* id -> はまった合図を外すタイマー */
  let raf = 0, lastT = 0, running = false;
  let lastW = 0, lastH = 0;
  let gathering = false;
  let dead = false;
  let ro = null;
  let booted = false;

  host.classList.add('bub-field');
  /* 「ならべる」で縦にあふれたぶんをスクロールさせるための高さ持ち */
  const spacer = el('div', 'bub-spacer');
  spacer.setAttribute('aria-hidden', 'true');
  host.appendChild(spacer);

  /* ---------------- 位置 ---------------- */

  function place(b) {
    if (b.held) return;
    const t = `translate(${(b.cx - b.d / 2).toFixed(1)}px, ${(b.cy - b.d / 2).toFixed(1)}px)`;
    b.el.style.transform = t;
  }

  function posOf(id) {
    if (!persist || typeof store.get !== 'function') return null;
    const t = store.get(id);
    if (!t) return null;
    return { fx: Number(t.fx), fy: Number(t.fy) };
  }

  function savePos(b) {
    if (!persist || typeof store.setPos !== 'function') return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h || !b.placed) return;    /* 寸法が取れないときに 0 を書き込まない */
    store.setPos(b.id, b.cx / w, b.cy / h);
  }

  function saveAllPos() {
    bubbles.forEach(savePos);
    if (persist && typeof store.flush === 'function') store.flush();
  }

  /* 保存されている割合から実座標を引き直す。
     ステージが 0 幅のときに作られたバブルは潰れているので、ここから復帰させる */
  function placeFromStore(b, w, h) {
    const r = b.d / 2;

    /* 升目を指定されていれば、そこに置く（追補5 §1）。
       これが無いと、画面が「この項目はこの升目」と言っても drift は聞かず、
       全部が重力で下まで落ちてしまう。実際、きっかけの画面が
       「頼んだ升目の外に置かれる」ので面に載せられずにいた。
       保存位置（fx/fy）より升目の指定を優先する。升目は画面が毎回組み直すもので、
       保存位置は前回のなごりだから。 */
    const wl = b.item && b.item.well != null ? wellById(b.item.well) : null;
    if (wl) {
      b.cx = clamp(wl.cx, r, Math.max(r, w - r));
      b.cy = clamp(wl.cy, r, Math.max(r, h - r));
      b.well = wl;
      place(b);
      return;
    }

    const p = posOf(b.id);
    const fx = (p && Number.isFinite(p.fx)) ? p.fx : (0.2 + Math.random() * 0.6);
    const fy = (p && Number.isFinite(p.fy)) ? p.fy : (0.2 + Math.random() * 0.6);
    b.cx = clamp(fx * w, r, Math.max(r, w - r));
    b.cy = clamp(fy * h, r, Math.max(r, h - r));
    place(b);
  }

  /* id で升目を引く。setWells が呼ばれていなければ null */
  function wellById(id) {
    for (let i = 0; i < wells.length; i++) if (wells[i].id === id) return wells[i];
    return null;
  }

  /* 寸法が取れるようになった時点で、未配置のバブルを保存位置から置き直す。
     ResizeObserver の発火順に依存せず、onShow から必ず呼ぶ */
  function relayout() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    let fixed = false;
    bubbles.forEach(b => {
      if (b.placed) return;
      syncSize(b, w, h);
      placeFromStore(b, w, h);
      b.placed = true;
      fixed = true;
    });
    lastW = w; lastH = h;
    if (gathering) gatherLayout();
    return fixed;
  }

  function syncSize(b, w, h) {
    updateBubble(b.el, b.item, {
      size: (b.item.size == null) ? size : b.item.size,   /* makeOne と同じ決め方 */
      marks: b.item.marks || [], anchorHue: b.item.anchorHue,
      /* タグの色。落とすと、海と今日のバブルだけ染まらなくなる */
      colors: b.item.colors || [],
      tagNames: b.item.tagNames || [],
      startedLook: b.item.startedLook,
      w: w || lastW, h: h || lastH,
    });
    b.d = parseFloat(b.el.style.width) || b.d;
  }

  /* ---------------- ならべる（スクロールするグリッド） ----------------
     契約 §7：全件が並ぶ。海の物理配置とは別レイアウト。
     大きさ（＝文字量）は保ったまま、古い順（setItems で渡された順）に
     左上から右下へ棚積みし、あふれたぶんは host をスクロールさせる。 */
  function gatherLayout() {
    const w = host.clientWidth;
    if (!w) return;

    const list = [...bubbles.values()].sort((a, b) => a.order - b.order);
    if (!list.length) { spacer.style.height = '0px'; return; }

    const GAP = 8, PAD = 14, TOP = 44;   /* TOP は見出しとボタンのぶん */
    const rowW = Math.max(w - PAD * 2, 80);

    const rows = [];
    let row = [], x = 0, natW = 0;
    list.forEach(b => {
      if (row.length && x + b.d > rowW) { rows.push({ items: row, w: x - GAP }); row = []; x = 0; }
      row.push(b);
      x += b.d + GAP;
    });
    if (row.length) rows.push({ items: row, w: x - GAP });

    /* 行の高さが確定してから縦中央に置く。上端揃えだと行として読めない */
    let y = TOP;
    rows.forEach(r => {
      r.h = r.items.reduce((m, b) => Math.max(m, b.d), 0);
      natW = Math.max(natW, r.w);
      let rx = PAD + (rowW - r.w) / 2;
      r.items.forEach(b => {
        b.gx = rx + b.d / 2;
        b.gy = y + r.h / 2;
        rx += b.d + GAP;
      });
      y += r.h + GAP;
    });

    spacer.style.height = (y - GAP + PAD) + 'px';
  }

  function setGathering(on) {
    on = !!on;
    if (gathering === on) return;
    gathering = on;
    host.classList.toggle('is-gathering', on);
    if (on) {
      /* 並べているあいだ tick はセルを見ない。寄せの途中で止めると
         そのまま凍って、解除したときに起点から飛ぶので、ここでほどく */
      bubbles.forEach(b => { clearSnap(b); b.lock = null; });
      gatherLayout();
      /* 演出を減らす設定では tick が回っていないので、その場で並べる */
      if (RM.matches) {
        bubbles.forEach(b => {
          if (b.held || b.gx == null) return;
          b.cx = b.gx; b.cy = b.gy; place(b);
        });
      }
    } else {
      host.scrollTop = 0;
      spacer.style.height = '0px';
      bubbles.forEach(b => { b.gx = null; b.gy = null; });
      if (RM.matches) settle();     /* 重なったままにしない */
    }
  }

  /* ---------------- 引力のあるセル（追補5 §1） ----------------

     wells = [{ id, x, y, w, h }]  面の座標系（cx/cy と同じ。host の左上が原点、
     スクロールぶんは含まない）での矩形。
     バブルの「中心」がこの矩形の中にいるときだけ、その矩形の中心へ引かれる。

     枠を DOM で持っている画面は、枠の矩形を
     getBoundingClientRect の差（枠 - host）で出してここへ渡すこと。
     伸縮したら渡し直す（面のほうは覚え直さない）。 */

  function setWells(list) {
    const next = [];
    (Array.isArray(list) ? list : []).forEach(o => {
      if (!o) return;
      const x = Number(o.x), y = Number(o.y), w = Number(o.w), h = Number(o.h);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!(w > 0) || !(h > 0)) return;
      next.push({ id: o.id, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
    });
    wells = next;
    if (!wells.length) {
      /* セルが無くなったら、掛かっていたものを全部ほどく。
         いままでと寸分違わない面に戻る */
      bubbles.forEach(b => { b.well = null; b.pin = false; b.lock = null; clearSnap(b); });
    }
    /* 「演出を減らす」設定のときは、そもそも tick が回らない。
       そのままだと きっかけ／すきま の枠が一切機能しない（バブルが収まらない）ので、
       ここで升目の中心へ即座に置く。動かさずに結果だけ与える、という扱い。 */
    if (RM.matches && wells.length) snapToWells();

    /* セルが動いた／消えたぶんは次の tick が引き直す（b.pin は毎 tick 検算される） */
  }

  /* 升目の中心へ、順に1つずつ置く。tick が回らない環境（reduce）で使う。
     1つの升目に2つ入れない（入れると押し合うが、押し合いも動かないので重なったまま残る）。 */
  function snapToWells() {
    const free = wells.slice();
    const list = [...bubbles.values()].filter(b => !b.held);
    /* いま近いものから順に取らせる。並び替えの見た目が毎回変わらないよう order で安定させる */
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    list.forEach(b => {
      if (!free.length) return;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < free.length; i++) {
        const d = Math.hypot(free[i].cx - b.cx, free[i].cy - b.cy);
        if (d < bd) { bd = d; bi = i; }
      }
      const wl = free.splice(bi, 1)[0];
      b.cx = wl.cx; b.cy = wl.cy;
      b.vx = 0; b.vy = 0;
      b.well = wl; b.pin = true; b.rest = false;
      clearSnap(b);
      place(b);
      savePos(b);
    });
  }

  /* その点を含むセル。重なっていたら中心がいちばん近いもの。無ければ null */
  function wellAt(x, y) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < wells.length; i++) {
      const wl = wells[i];
      if (x < wl.x || x > wl.x + wl.w || y < wl.y || y > wl.y + wl.h) continue;
      const dx = wl.cx - x, dy = wl.cy - y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = wl; }
    }
    return best;
  }

  /* いまどのセルに収まっているか（中心が入っているか）。無ければ null。
     掴んでいる間も答える（指の下のセルを画面が光らせられるように） */
  function wellOf(id) {
    const b = bubbles.get(id);
    if (!b || !wells.length) return null;
    const wl = wellAt(b.cx, b.cy);
    return wl ? wl.id : null;
  }

  /* ---------------- パチっとはまる（上の SNAP_* を見ること） ---------------- */

  /* このバブルにとっての「近く」の半径 */
  function snapR(b, wl) {
    return Math.min(Math.hypot(wl.w, wl.h) / 2, b.d * SNAP_R_MAX);
  }

  /* 中心が「近く」に入っているか */
  function nearWell(b, wl) {
    return !!wl && Math.hypot(wl.cx - b.cx, wl.cy - b.cy) <= snapR(b, wl);
  }

  /* 寄せを始める。ここから SNAP_T 秒かけて時間で運ぶ（力はもう掛けない） */
  function beginSnap(b, wl) {
    b.snap = { id: wl.id, well: wl, t: 0, x0: b.cx, y0: b.cy };
    b.vx = 0; b.vy = 0;
    b.rest = false; b.pin = false;
  }

  /* 寄せを1コマ進める。着いたら固定して、見た目の合図を出す。
     目的地はそのつど b.well から取り直す（枠が動いても取り残されない） */
  function stepSnap(b, wl, dt) {
    const s = b.snap;
    s.t += dt;
    const u = (s.t >= SNAP_T) ? 1 : s.t / SNAP_T;
    const k = 1 - u;
    const e = 1 - k * k * k;                  /* ease-out。出だしがいちばん速い */
    b.cx = s.x0 + (wl.cx - s.x0) * e;
    b.cy = s.y0 + (wl.cy - s.y0) * e;
    b.vx = 0; b.vy = 0;
    /* この位置は「決まった位置」。ぶつかりの押し戻しに逸らされないよう控えておく
       （tick の最後で書き戻す）。次のコマの頭で必ず消えるので、持ち越さない */
    b.lock = { x: b.cx, y: b.cy };
    if (u >= 1) {
      b.snap = null;
      b.well = wl;
      b.pin = true;
      savePos(b);
      flashSnap(b);
    }
  }

  function clearSnap(b) { b.snap = null; }

  /* はまった瞬間の合図。ごく短い縮みと、縁が締まる輪（css/bubble.css の .is-snap）。
     祝祭にしない（§0）ので、跳ねない・光らない・色を変えない。
     「演出を減らす」設定では出さない（収まる結果だけ残る）。 */
  function flashSnap(b) {
    if (RM.matches || !b.el || !b.el.classList) return;
    const prev = fx.get(b.id);
    if (prev) clearTimeout(prev);
    b.el.classList.remove('is-snap');
    void b.el.offsetWidth;                    /* 続けて出すときに、いったん切る */
    b.el.classList.add('is-snap');
    fx.set(b.id, setTimeout(() => {
      fx.delete(b.id);
      if (b.el && b.el.classList) b.el.classList.remove('is-snap');
    }, SNAP_FX_MS));
  }

  function clearFx(id) {
    const t = fx.get(id);
    if (t) { clearTimeout(t); fx.delete(id); }
  }

  /* ---------------- 物理 ---------------- */

  /* 底に着いた／底のものに載ったバブルに印を付ける（追補3 §2）。
     毎 tick 下にあるものから決め直すので、支えが横へ抜ければ次の tick で落ち直す。
     「止まっている」を速さではなく接触で決めているので、横へ投げたものが
     いつまでも床を滑り続けることがない（REST_DRAG が収める）。 */
  function markRest(list, h) {
    const order = list.slice().sort((a, b) => b.cy - a.cy);   /* 下にあるものから */
    order.forEach(b => {
      b.rest = false;
      if (b.held) return;
      if (b.well) return;                       /* セルの中では底に着かない。位置はセルが決める。
                                                   （ここで rest にすると vy を毎コマ 0 にされて、
                                                     引力が上へ持ち上げられなくなる） */
      if (b.vy < -REST_UP) return;              /* 投げ上げられた最中は止めない */
      const r = b.d / 2;
      if (b.cy >= h - r - b.pad - 1) { b.rest = true; return; }
      for (const c of order) {
        if (c === b || !c.rest) continue;
        const dx = c.cx - b.cx, dy = c.cy - b.cy;
        if (dy <= 0) continue;                  /* 下にいるものだけが支えになる */
        if (dy < Math.abs(dx) * 0.6) continue;  /* 横に並んでいるだけのものは支えでない */
        if (Math.hypot(dx, dy) > (b.d + c.d) / 2 + REST_GAP) continue;
        b.rest = true;
        return;
      }
    });
  }

  function tick(now) {
    if (!running || dead) return;
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0);
    lastT = now;

    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) { raf = requestAnimationFrame(tick); return; }   /* 非表示中は動かさない */
    const list = [...bubbles.values()];

    /* 並べている間は漂わせず、並べた位置へなめらかに寄せる */
    if (gathering) {
      const e = Math.min(1, dt * 9);
      list.forEach(b => {
        if (b.held || b.gx == null) return;
        b.cx += (b.gx - b.cx) * e;
        b.cy += (b.gy - b.cy) * e;
        place(b);
      });
      raf = requestAnimationFrame(tick);
      return;
    }

    /* いま入っているセル。セルが1つも無ければここは走らない（＝従来どおりの面） */
    if (wells.length) list.forEach(b => { b.well = wellAt(b.cx, b.cy); });

    markRest(list, h);

    list.forEach(b => {
      /* 掴んでいる間は引力も寄せも掛けない。指が位置を持っている */
      if (b.held) { b.pin = false; clearSnap(b); return; }

      /* パチっと寄せている最中。力はいっさい掛けず、時間で中心へ運ぶ。
         セルが消えた／別のセルへ移ったら、その場でほどけて物理へ戻る */
      if (b.snap) {
        const wl = b.well;
        if (wl && (wl === b.snap.well || (b.snap.id != null && wl.id === b.snap.id))) {
          b.snap.well = wl;
          stepSnap(b, wl, dt);
          place(b);
          return;
        }
        clearSnap(b);
      }

      /* 吸い込まれて固定（追補5 §1）。重力も引力も掛からない。
         セルから外れた／ぶつかられて中心から離れたら、その場でほどける。
         毎コマ引き直すので、setWells で枠が動いても取り残されない */
      if (b.pin) {
        if (b.well && Math.hypot(b.well.cx - b.cx, b.well.cy - b.cy) <= WELL_PIN_D) {
          b.vx = 0; b.vy = 0;
          place(b);
          return;
        }
        b.pin = false;
      }

      if (b.rest) {
        /* 底に着いている。落とさない・跳ね返さない。横滑りだけ静かに収める */
        b.vy = 0;
        b.vx *= Math.max(0, 1 - dt * REST_DRAG);
      } else {
        /* 弱い重力。終端速度 GRAV_MAX へ寄せる。
           速すぎるぶんも同じ強さで戻す。片側だけにすると、下の「たまに向きを変える」
           ゆらぎで下向きに速くなったぶんが戻らず、落ちる速さが少しずつ増える */
        const dv = GRAV * dt;
        b.vy = (b.vy < GRAV_MAX) ? Math.min(GRAV_MAX, b.vy + dv)
                                 : Math.max(GRAV_MAX, b.vy - dv);
      }

      /* セルの引力（追補5 §1）。中心へ向かって a = K/d²。
         d の下限 WELL_DMIN より内側では一定（発散させない）。
         そのあと、このセルの中だけの粘りで速さを削る。
         削らないと中心を通り抜けて反対側へ登り、いつまでも往復して固定できない */
      if (b.well) {
        const dx = b.well.cx - b.cx, dy = b.well.cy - b.cy;
        const dist = Math.hypot(dx, dy);

        /* 「近く」で十分ゆっくりになった ＝ はまる。
           ここから先は力ではなく時間で運ぶ（上の SNAP_* を見ること）。
           速いもの（投げつけられて通り抜けるもの）は掴まえない。
           手を離した瞬間の判定は onDragEnd 側にある（速さを見ない） */
        if (dist <= snapR(b, b.well) && Math.hypot(b.vx, b.vy) <= SNAP_V) {
          beginSnap(b, b.well);
          stepSnap(b, b.well, dt);
          place(b);
          return;
        }

        if (dist > 1e-6) {
          const dd = Math.max(dist, WELL_DMIN);
          const a = WELL_K / (dd * dd) * dt;
          b.vx += a * dx / dist;
          b.vy += a * dy / dist;
        }
        const f = Math.max(0, 1 - dt * WELL_DRAG);
        b.vx *= f; b.vy *= f;

        /* 中心の近くで十分遅くなった。その位置で止める */
        if (dist <= WELL_PIN_D && Math.hypot(b.vx, b.vy) <= WELL_PIN_V) {
          b.pin = true; b.vx = 0; b.vy = 0;
          place(b);
          return;
        }
      }

      b.cx += b.vx * dt;
      b.cy += b.vy * dt;

      /* たまに向きをわずかに変える。一定方向に流れ続けないように
         （止まっているものは揺らさない。揺らすと底で跳ねて見える） */
      if (!b.rest && Math.random() < dt * 0.35) {
        b.vx += (Math.random() * 2 - 1) * 4;
        b.vy += (Math.random() * 2 - 1) * 4;
      }

      /* 生まれた直後の浮上や、投げた勢い。速すぎるぶんを減衰させて漂う速さへ戻す。
         速いほど強く効かせて、シャボン玉らしく空気に受け止められる感じにする。

         下駄の 1.1 は、利用者の指示で 0.9 に下げた（摩擦を少し下げる）。
         速さに比例するぶん（sp/420）はそのまま。下駄だけを下げたので、
         遅いところほどよく効き、速いところの効きはあまり変わらない。
         400px/s で投げたとき、2秒で進む距離が 240px → 266px（実測）。
         漂う上限 28.8px/s へ戻るまでは 1.9 秒 → 2.2 秒。 */
      const sp = Math.hypot(b.vx, b.vy);
      const vmax = SPEED * 1.8;
      if (sp > vmax) {
        const f = Math.max(vmax / sp, 1 - dt * (0.9 + sp / 420));
        b.vx *= f; b.vy *= f;
      }

      /* 壁で跳ね返る。投げられて速くなっているときだけ、ぶつかった分だけ勢いを失う。
         底だけは跳ね返さない（追補3 §2）。位置を止めて下向きの速さを捨てる。

         この 0.72 は跳ね返りの係数（＝ぶつかったときの損）で、
         バブルどうしの HIT_E=0.9 と同じたぐいのもの。HIT_E は利用者が値を決めていて
         触れないので、そろえて 0.72 も動かしていない。
         底の 0.90 は、底へ叩きつけたときに横向きの速さが失われるぶん。
         こちらは摩擦なので 0.86 → 0.90 に下げた（利用者の指示）。
         ただし普通に落ちてきたものは、底の線に届く前に markRest が拾って
         rest になるので、ここは通らない。効くのは底へ投げつけたときだけで、
         斜めに投げつけた1個が横へ伸びる距離は 130.3px → 132.3px（実測）。
         下げても見た目はほとんど変わらない */
      const bounce = sp > vmax ? 0.72 : 1;
      const r = b.d / 2;
      if (b.cx < r)     { b.cx = r;     b.vx = Math.abs(b.vx) * bounce;  b.vy *= bounce; }
      if (b.cx > w - r) { b.cx = w - r; b.vx = -Math.abs(b.vx) * bounce; b.vy *= bounce; }
      if (b.cy < r)     { b.cy = r;     b.vy = Math.abs(b.vy) * bounce;  b.vx *= bounce; }
      if (b.cy > h - r) { b.cy = h - r; if (b.vy > 0) b.vy = 0; b.vx *= 0.90; }
    });

    /* ぶつかり。数が少ない前提の総当たり。
       中心を結ぶ線に沿った撃力で弾き合い（作用・反作用）、
       そのあとで、めり込んでいるぶんの位置を質量の逆比で分けて押し戻す。

       つかんでいるバブル（held）は指が位置を持っているので、質量が無限大。
       動かないが、相手は正しく弾かれる。両方 held なら何もしない。
       held の速度は指のもので b.vx/b.vy には入っていないので、
       撃力を組み立てるときは 0 とみなす（＝相手が飛び込んできたぶんだけ弾く）。
       ドラッグで海をかき分ける手ごたえは、下の押し戻しが受け持つ
       （held 側の配分が 0 なので、相手が従来どおり2倍量ぶん動く）。 */
    if (list.length > 1 && list.length <= 60) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], c = list[j];
          if (a.held && c.held) continue;
          const dx = c.cx - a.cx, dy = c.cy - a.cy;
          const min = (a.d + c.d) / 2 + HIT_GAP;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist >= min) continue;

          const nx = dx / dist, ny = dy / dist;      /* a から c へ向かう単位ベクトル */

          /* 質量の逆数。held は無限大の質量なので 0。
             両方 held は上で抜けているので、和が 0 になることはない */
          const ia = a.held ? 0 : 1 / (a.d * a.d * a.d);
          const ic = c.held ? 0 : 1 / (c.d * c.d * c.d);
          const isum = ia + ic;

          /* 撃力。近づいているときだけ */
          const avx = a.held ? 0 : a.vx, avy = a.held ? 0 : a.vy;
          const cvx = c.held ? 0 : c.vx, cvy = c.held ? 0 : c.vy;
          const vn = (cvx - avx) * nx + (cvy - avy) * ny;   /* 負なら近づいている */
          if (vn < 0) {
            const J = -(1 + HIT_E) * vn / isum;     /* 2つが受け取る大きさは互いに等しい */
            a.vx -= J * nx * ia; a.vy -= J * ny * ia;
            c.vx += J * nx * ic; c.vy += J * ny * ic;
          }

          /* めり込みの押し戻し。合計の動く量は従来と同じ。重いほうを動かさない */
          const corr = (min - dist) * HIT_PUSH;
          const wa = corr * (ia / isum), wc = corr * (ic / isum);
          a.cx -= nx * wa; a.cy -= ny * wa;
          c.cx += nx * wc; c.cy += ny * wc;
        }
      }
    }

    /* 押し離しは壁の判定より後なので、押された先が面の外のことがある。
       重力で底に詰まっていると毎フレーム押され続けて、はみ出しが居座る。
       描く前にここで面へ戻す（描いてから戻すと、はみ出したコマが見えてしまう） */
    list.forEach(b => {
      /* 寄せの最中は、上のぶつかりの押し戻しに逸らされない。
         位置は時間が決めている（＝はまり方が読める）。相手のほうは正しく押される。
         セルが1つも無い面では b.lock は常に null なので、ここは素通りする */
      if (b.lock) { b.cx = b.lock.x; b.cy = b.lock.y; b.lock = null; }
      if (!b.held) {
        const r = b.d / 2;
        b.cx = clamp(b.cx, r, Math.max(r, w - r));
        b.cy = clamp(b.cy, r, Math.max(r, h - r));
      }
      place(b);
    });
    raf = requestAnimationFrame(tick);
  }

  /* reduced motion のとき用：漂わせず、重なりだけほどいて静止させる。
     ここは速度を持たないので撃力の話は出てこない。ほどく向きも左右対称のまま
     （質量で配分すると、演出を減らす設定の並びだけが変わってしまう）。 */
  function settle() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const list = [...bubbles.values()].filter(b => !b.held);
    for (let k = 0; k < 24; k++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], c = list[j];
          const dx = c.cx - a.cx, dy = c.cy - a.cy;
          const min = (a.d + c.d) / 2 + HIT_GAP;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist >= min) continue;
          const push = (min - dist) / dist * 0.25;
          a.cx -= dx * push; a.cy -= dy * push;
          c.cx += dx * push; c.cy += dy * push;
        }
      }
    }
    list.forEach(b => {
      const r = b.d / 2;
      b.cx = clamp(b.cx, r, Math.max(r, w - r));
      b.cy = clamp(b.cy, r, Math.max(r, h - r));
      place(b);
    });
  }

  /* ---------------- ジェスチャの受け口 ---------------- */

  const gestures = {
    getHost: () => host,
    /* この面は座標を自分で持っている（cx/cy）ので、中央の窓が閉じたときに
       元の場所へ戻す必要がない。そのまま中央で解放して、そこから漂わせる。
       枠に並べる画面は DOM の並び順が位置なので、この旗を立てない。 */
    releaseInPlace: true,
    onFocusRequest: id => { if (opts.onFocusRequest) opts.onFocusRequest(id); },
    onMenu: (id, node) => { if (opts.onMenu) opts.onMenu(id, node); },
    onDropToTab: (id, tab) => { if (opts.onDropToTab) opts.onDropToTab(id, tab); },
    onDragStart: id => { if (opts.onDragStart) opts.onDragStart(id); },
    /* 位置の主導権。持ち出されている間は tick が触らない */
    onHold: (id, on) => {
      const b = bubbles.get(id);
      if (!b) return;
      b.held = on;
      /* 掴まれたら固定も寄せもほどける。手を離せば、そこからまた吸い込まれる */
      if (on) { b.pin = false; clearSnap(b); }
    },
    /* ドラッグ中の現在位置。漂う仲間をかき分けるため物理へ伝える */
    onDragMove: (id, info) => {
      const b = bubbles.get(id);
      if (!b) return;
      const r = host.getBoundingClientRect();
      b.cx = info.left + b.d / 2 - r.left;
      b.cy = info.top + b.d / 2 - r.top;
    },
    onDragEnd: (id, info) => {
      const b = bubbles.get(id);
      if (b) {
        const r = host.getBoundingClientRect();
        const rad = b.d / 2;
        b.cx = clamp(info.left - r.left + rad, rad, Math.max(rad, host.clientWidth - rad));
        b.cy = clamp(info.top - r.top + rad, rad, Math.max(rad, host.clientHeight - rad));
        b.held = false;

        /* 離した位置がセルの「近く」なら、迷わず中心へ収める。
           投げた勢いは載せない ── 指が「ここ」と言っているので、
           そのうえに勢いを足すと寄せ先が揺れて、決まった感じが消える。
           ここだけは速さを見ない（利用者の指示「離した位置がセルの近くなら」）。
           タブへ落としたもの（droppedTo）は、この面から出ていくので触らない。 */
        const wl = (wells.length && !info.droppedTo) ? wellAt(b.cx, b.cy) : null;
        const snapping = !!wl && nearWell(b, wl);
        if (snapping) {
          b.well = wl; b.rest = false;
          if (RM.matches) {
            /* 「演出を減らす」設定。動きは見せず、結果だけ与える */
            b.cx = wl.cx; b.cy = wl.cy; b.vx = 0; b.vy = 0;
            b.pin = true; clearSnap(b);
          } else {
            beginSnap(b, wl);
          }
        } else if (!RM.matches && !info.droppedTo && Number.isFinite(info.vx)) {
          /* 投げた勢いを載せる。速すぎるぶんは tick 側で空気抵抗のように減衰する。
             タブへ落としたときと reduced motion のときは勢いを付けない */
          b.vx = info.vx; b.vy = info.vy;
        }
        place(b);
        savePos(b);
        /* 収まり先が決まったものを、重なりほどきで押し出さない */
        if (RM.matches && !snapping) settle();
      }
      if (opts.onDragEnd) opts.onDragEnd(id);
    },
  };

  /* ---------------- 差し替え ---------------- */

  function makeOne(item, w, h, bornIdx, initial) {
    const node = makeBubble(item, {
      /* 大きさは面ごとの既定（opts.size）。**item.size があればそちらが勝つ**。
         海のズームアウト（利用者の指示）が、1件ずつ縮めた直径を渡してくるため。
         渡さない画面は今までどおり opts.size がそのまま効く。 */
      size: (item.size == null) ? size : item.size,
      marks: item.marks || [], anchorHue: item.anchorHue,
      colors: item.colors || [],
      tagNames: item.tagNames || [],
      startedLook: item.startedLook,
      w: w || lastW, h: h || lastH,
    });
    node.classList.add('is-floating');
    const d = parseFloat(node.style.width) || 96;
    const b = {
      id: item.id, el: node, item, d,
      cx: 0, cy: 0,
      vx: (Math.random() * 2 - 1) * SPEED,
      vy: (Math.random() * 2 - 1) * SPEED,
      held: false,
      /* mount 時点ではペインがまだ display:none で寸法が 0 になる。
         そのとき置いた座標は当てにならないので、後で置き直す目印を残す */
      placed: !!(w && h),
      order: 0, gx: null, gy: null,
      /* 底で止まっているか（毎 tick 決め直す）と、着地の高さのばらつき */
      rest: false,
      pad: Math.random() * REST_PAD,
      /* 引力のあるセル（追補5 §1）。well は毎 tick 引き直す。
         pin は「吸い込まれて固定された」印。
         snap は「パチっと寄せている最中」、lock はそのコマの決まった位置
         （どちらもセルのある面でしか立たない） */
      well: null, pin: false, snap: null, lock: null,
    };
    if (w && h) placeFromStore(b, w, h);

    /* ここで作られるものは、この面にとって必ず新入り。
       開いた瞬間（initial）は順に、書いた直後は下から浮かび上がる */
    {
      node.classList.add('is-new');
      let delay = 0;
      if (initial) {
        /* 開いた瞬間は順番にぷるんと現れる */
        delay = Math.min(bornIdx * 55, 600);
        const skin = node.querySelector('.skin');
        if (skin) skin.style.setProperty('--bd', delay + 'ms');
      } else if (!RM.matches) {
        /* 書いた直後は下からふわっと浮かび上がる（余分な速さは tick が減衰させる） */
        b.vy = -(SPEED * 2.2 + Math.random() * SPEED);
        b.vx = (Math.random() * 2 - 1) * SPEED * 0.5;
      }
      setTimeout(() => node.classList.remove('is-new'), 550 + delay);
    }

    b.detach = attachGestures(node, gestures);
    host.appendChild(node);
    bubbles.set(item.id, b);
    return b;
  }

  function dropOne(b) {
    if (b.detach) b.detach();
    clearFx(b.id);
    b.el.remove();
    bubbles.delete(b.id);
  }

  /* items = [{id, text, started, marks, anchorHue}] */
  function setItems(items) {
    if (dead) return;
    const list = Array.isArray(items) ? items : [];
    const want = new Set(list.map(i => i.id));
    bubbles.forEach(b => { if (!want.has(b.id)) dropOne(b); });

    const w = host.clientWidth, h = host.clientHeight;
    const initial = !booted;
    booted = true;
    let bornIdx = 0;

    list.forEach((item, i) => {
      let b = bubbles.get(item.id);
      if (b) {
        b.item = item;
        syncSize(b, w, h);
      } else {
        b = makeOne(item, w, h, bornIdx++, initial);
      }
      b.order = i;
    });

    if (gathering) gatherLayout();
    if (RM.matches) settle();
    /* 「演出を減らす」設定では tick が回らないので、
       新しく来たバブルも自分では升目へ寄れない。ここで置いてやる。 */
    if (RM.matches && wells.length) snapToWells();

  }

  /* ---------------- 出入り ---------------- */

  function start() {
    if (dead) return;
    relayout();
    if (RM.matches) { settle(); return; }   /* 演出を減らす：漂わせない */
    if (running) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    saveAllPos();
  }

  /* 消えるときの飛沫。画面が「消した／完了した」と分かっているときだけ呼ぶ
     （タブへ移しただけのものを、はじけさせないため） */
  function pop(id) {
    const b = bubbles.get(id);
    if (!b) return;
    b.held = true;
    clearSnap(b);
    if (!RM.matches) {
      popBits(b.el.getBoundingClientRect());
      b.el.classList.add('is-popping');
    }
  }

  function popBits(rect) {
    const layer = document.getElementById('drag-layer') || document.body;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const ring = el('div', 'pop-ring');
    ring.style.left = rect.left + 'px';
    ring.style.top = rect.top + 'px';
    ring.style.width = rect.width + 'px';
    ring.style.height = rect.height + 'px';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 440);
    for (let i = 0; i < 7; i++) {
      const bit = el('span', 'pop-bit');
      const ang = (i / 7) * Math.PI * 2 + Math.random() * 0.6;
      const dist = rect.width * 0.4 + 16 + Math.random() * 26;
      bit.style.setProperty('--x0', (cx - 3) + 'px');
      bit.style.setProperty('--y0', (cy - 3) + 'px');
      bit.style.setProperty('--x1', (cx - 3 + Math.cos(ang) * dist) + 'px');
      bit.style.setProperty('--y1', (cy - 3 + Math.sin(ang) * dist) + 'px');
      layer.appendChild(bit);
      setTimeout(() => bit.remove(), 520);
    }
  }

  function nodeOf(id) {
    const b = bubbles.get(id);
    return b ? b.el : null;
  }

  function destroy() {
    dead = true;
    stop();
    if (ro) { ro.disconnect(); ro = null; }
    fx.forEach(t => clearTimeout(t));
    fx.clear();
    bubbles.forEach(b => { if (b.detach) b.detach(); b.el.remove(); });
    bubbles.clear();
    spacer.remove();
    host.classList.remove('bub-field', 'is-gathering', 'is-focusing');
    window.removeEventListener('pagehide', saveAllPos);
    if (typeof RM.removeEventListener === 'function') RM.removeEventListener('change', onRM);
  }

  /* 画面サイズが変わったら、はみ出したバブルを引き戻す */
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;               /* 非表示。寸法は覚えない */
      relayout();                          /* 未配置のものがあれば先に救う */
      if (lastW && lastH && (w !== lastW || h !== lastH)) {
        /* 相対位置を保ったまま伸縮させる（回転・分割表示でも散らばらない） */
        const sx = w / lastW, sy = h / lastH;
        bubbles.forEach(b => {
          const r = b.d / 2;
          b.cx = clamp(b.cx * sx, r, Math.max(r, w - r));
          b.cy = clamp(b.cy * sy, r, Math.max(r, h - r));
          place(b);
        });
      }
      lastW = w; lastH = h;
      if (gathering) gatherLayout();
    });
    ro.observe(host);
  }

  /* 「演出を減らす」設定がその場で切り替わったら、漂いを止める／再開する */
  function onRM() {
    if (RM.matches) { running = false; cancelAnimationFrame(raf); settle(); }
    else if (!running) { running = true; lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }
  if (typeof RM.addEventListener === 'function') RM.addEventListener('change', onRM);

  window.addEventListener('pagehide', saveAllPos);

  return { setItems, relayout, start, stop, setGathering, setWells, wellOf, nodeOf, pop, destroy };
}
