/* 複数の端末の記録を合わせる。DOM も通信も触らない、ただの計算。
   store.js（印を付ける側）と sync.js（合わせる側）とテストが使う。

   ■ 考え方

   保存データ（store.js の persist() が書く形）を「1件ずつの記録」に分ける。
   1件 = todo 1つ、アンカー1つ、タグ1つ、着手ログ1行、… それと並び順。
   各記録に「最後に書き換えた時刻」（stamp）を持たせ、2つの端末で食い違ったら
   **記録ごとに新しいほうを残す**（利用者の指示）。

   stamps = { [key]: [at, alive] }
     at    … 書き換えた時刻 epoch ms。0 は「まだ誰も触っていない既定値」、
             1 は「印を持つ前の版から引き継いだ記録」（既定値には勝つ）
     alive … 1 ならある、0 なら消した（墓石。消したことも新しい順で勝ち負けを決める。
             これが無いと、片方で消したものがもう片方から戻ってくる）

   印は画面のコードが付けるのではなく、persist() のたびに前回の保存と比べて付ける
   （stampChanges）。書き込み口が60か所あるので、1か所ずつ付けると必ず漏れる。

   ■ 注意
   ・時刻は端末の時計。時計が大きくずれた端末の書き換えは、新しくても負けることがある
   ・同じ時刻の食い違いは、中身の文字列の大きいほうを残す（どの端末で計算しても同じ答えにするため） */

/* 記録の鍵。ログは id を持たない（id は todo の id）ので、中身から作る */
const LIST_KEYS = [
  /* [保存データの欄, 鍵の頭, 鍵の作り方, 並びを持つか] */
  ['todos',    'todo',   r => r.id, true],
  ['anchors',  'anchor', r => r.id, true],
  ['gapSlots', 'gap',    r => r.id, true],
  ['tags',     'tag',    r => r.id, true],
  ['log',      'log',    r => r.id + '|' + r.slot + '|' + r.at, false],
  ['todayLog', 'tlog',   r => r.id + '|' + r.at + '|' + (r.day || ''), false],
  ['focusLog', 'flog',   r => r.at + '|' + r.id + '|' + r.ms, false],
  /* 泡ごとのひとこと（Issue #25。js/notes.js）。足すのと消した印だけで、書き換えない */
  ['notes',    'note',   r => r.id, false],
  /* プロジェクト（記録の形の版 2。2026-11-24 ユーザーの決定。gantt が作る・直す。bubble は読むだけ）。
     1件 = { id: 'p_…', name, color, start, due, goal, lead, status, createdAt, ext, …知らない欄 }。
     ほかの記録と同じく記録ごとに新しいほうが残り、消すときは消した印。
     **この欄を持たない記録には足さない**（OPTIONAL_LIST）。足すと、版を上げただけで全部の端末に
     空の projects と order:project の印ができ、書き込みが起きるため */
  ['projects', 'project', r => r.id, true],
];
/* 記録にこの欄があるときだけ扱う種類（無い記録には空の欄も並びの印も作らない） */
const OPTIONAL_LIST = new Set(['projects']);
/* 1つの値として丸ごと持つ欄（中の要素ごとには合わせない） */
const WHOLE_KEYS = ['seas', 'removedStarters'];

/* 保存データ → Map(key → 値)。並びは 'order:<頭>' に id の配列として入る */
export function recordsOf(doc) {
  const out = new Map();
  const d = doc || {};
  LIST_KEYS.forEach(([field, head, keyOf, ordered]) => {
    if (OPTIONAL_LIST.has(field) && !Array.isArray(d[field])) return;
    const arr = Array.isArray(d[field]) ? d[field] : [];
    const order = [];
    arr.forEach(r => {
      if (!r || typeof r !== 'object') return;
      const k = head + ':' + keyOf(r);
      out.set(k, r);
      if (ordered) order.push(String(keyOf(r)));
    });
    if (ordered) out.set('order:' + head, order);
  });
  WHOLE_KEYS.forEach(f => { if (d[f] !== undefined) out.set('whole:' + f, d[f]); });
  return out;
}

function stampOf(stamps, key) {
  const s = stamps && stamps[key];
  return Array.isArray(s) ? s : [0, 1];
}

/* 前回の保存（prev: Map(key → JSON 文字列)）と今の保存データを比べ、
   変わった記録に at の印を付ける。stamps は書き換える。
   戻り値は今回の Map(key → JSON 文字列)（次の比較に使う） */
export function stampChanges(prev, doc, stamps, at) {
  const now = new Map();
  recordsOf(doc).forEach((v, k) => {
    const j = JSON.stringify(v);
    now.set(k, j);
    if (prev.get(k) !== j) {
      /* 印は戻さない。日の切り替えは「その日の0時」で付けるので、
         それより新しい印を持つ記録を古い時刻で上書きしないため */
      const old = stampOf(stamps, k)[0];
      stamps[k] = [Math.max(at, old), 1];
    }
  });
  prev.forEach((_, k) => {
    if (!now.has(k)) stamps[k] = [Math.max(at, stampOf(stamps, k)[0]), 0];
  });
  return now;
}

/* 印をまだ持たない保存データに、最初の印を付ける。
   at = 0（既定値。新しい端末の空の状態）か 1（前の版から引き継いだ記録） */
export function initialStamps(doc, at) {
  const stamps = {};
  recordsOf(doc).forEach((_, k) => { stamps[k] = [at, 1]; });
  return stamps;
}

/* 最初の期間（todo の firstSpan。2026-11-24）は書いたら変えない欄なので、記録ごとの新しいほうに任せない。
   勝ったほうに無くても（firstSpan を知らない古い写しが後から書いても）、両方のうち早く書いたほう（at の小さいほう）を残す。
   受け取った記録は書き換えない（写しを返す） */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function okFirstSpan(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && DAY_RE.test(v.due)
    && (v.start === null || v.start === undefined || DAY_RE.test(v.start))
    && Number.isFinite(Number(v.at)) && Number(v.at) > 0;
}
function keepFirstSpan(k, win, ra, rb) {
  if (!k.startsWith('todo:') || !win || typeof win !== 'object') return win;
  const c = [ra, rb].map(r => r && r.firstSpan).filter(okFirstSpan)
    .sort((x, y) => (Number(x.at) - Number(y.at)) || (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
  if (!c.length) return win;
  if (JSON.stringify(win.firstSpan) === JSON.stringify(c[0])) return win;
  return Object.assign({}, win, { firstSpan: JSON.parse(JSON.stringify(c[0])) });
}

/* どちらを残すか。新しいほう。同じ時刻なら中身の文字列で決める */
function pick(sa, va, sb, vb) {
  if (sa[0] !== sb[0]) return sa[0] > sb[0] ? 'a' : 'b';
  const ja = sa[1] ? JSON.stringify(va === undefined ? null : va) : '';
  const jb = sb[1] ? JSON.stringify(vb === undefined ? null : vb) : '';
  return ja >= jb ? 'a' : 'b';
}

/* 並びを組み直す。勝った並びをそのまま使い、そこに無い生きている記録を後ろへ足す */
function rebuild(recs, head, orderIds, keyOf) {
  const seen = new Set();
  const out = [];
  (Array.isArray(orderIds) ? orderIds : []).forEach(id => {
    const r = recs.get(head + ':' + id);
    if (r && !seen.has(id)) { seen.add(id); out.push(r); }
  });
  const rest = [];
  recs.forEach((r, k) => {
    if (!k.startsWith(head + ':')) return;
    const id = String(keyOf(r));
    if (!seen.has(id)) { seen.add(id); rest.push(r); }
  });
  rest.sort((x, y) => (Number(x.createdAt) || 0) - (Number(y.createdAt) || 0));
  return out.concat(rest);
}

/* 2つの状態 { doc, stamps } を合わせて、新しい { doc, stamps } を返す。
   a・b のどちらも書き換えない。a と b を入れ替えても同じ答えになる */
export function mergeState(a, b) {
  const A = a || { doc: {}, stamps: {} };
  const B = b || { doc: {}, stamps: {} };
  const ra = recordsOf(A.doc), rb = recordsOf(B.doc);
  const keys = new Set([...Object.keys(A.stamps || {}), ...Object.keys(B.stamps || {}),
    ...ra.keys(), ...rb.keys()]);
  const stamps = {};
  const recs = new Map();
  keys.forEach(k => {
    /* 記録があるのに印が無い＝誰も触っていない既定値。印が言う「ある」に記録が無ければ、
       それは読めなかった記録なので相手に任せる */
    let sa = stampOf(A.stamps, k), sb = stampOf(B.stamps, k);
    if (sa[1] && !ra.has(k)) sa = [-1, 0];
    if (sb[1] && !rb.has(k)) sb = [-1, 0];
    const w = pick(sa, ra.get(k), sb, rb.get(k));
    const s = w === 'a' ? sa : sb;
    if (s[0] < 0) return;                       /* どちらにも無い */
    stamps[k] = s;
    if (s[1]) recs.set(k, keepFirstSpan(k, w === 'a' ? ra.get(k) : rb.get(k), ra.get(k), rb.get(k)));
  });

  const doc = buildDoc(recs, Object.assign({}, B.doc, A.doc));
  /* 日付は進むだけ。新しいほう（日の切り替えはどちらの端末でも同じ結果になる） */
  const days = [A.doc && A.doc.lastDay, B.doc && B.doc.lastDay]
    .filter(x => typeof x === 'string').sort();
  doc.lastDay = days.length ? days[days.length - 1] : null;
  return { doc, stamps };
}

/* 記録の Map（recordsOf の形）から保存データを組み直す。base の、記録に分けない欄（v など）は残す。
   mergeState が使う（前は CSV の読み込みも使っていた。Issue #50 で外した） */
export function buildDoc(recs, base) {
  const doc = Object.assign({}, base || {});
  LIST_KEYS.forEach(([field, head, keyOf, ordered]) => {
    /* 記録に無い種類（プロジェクトの無い海）は欄を作らない。どちらかの端末が持っていれば、記録から組み直す
       （手元の古い写し base[field] は使わない＝合わせた記録だけが残る） */
    if (OPTIONAL_LIST.has(field)) {
      const has = recs.has('order:' + head) || [...recs.keys()].some(k => k.startsWith(head + ':'));
      if (!has) { delete doc[field]; return; }
    }
    if (ordered) {
      doc[field] = rebuild(recs, head, recs.get('order:' + head), keyOf);
    } else {
      const list = [];
      recs.forEach((r, k) => { if (k.startsWith(head + ':')) list.push(r); });
      list.sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
      doc[field] = list;
    }
  });
  WHOLE_KEYS.forEach(f => {
    if (recs.has('whole:' + f)) doc[f] = recs.get('whole:' + f);
    else delete doc[f];
  });
  return doc;
}

/* 印が同じか（＝合わせても何も変わらないか） */
export function sameStamps(a, b) {
  const x = a || {}, y = b || {};
  const kx = Object.keys(x), ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  return kx.every(k => Array.isArray(y[k]) && y[k][0] === x[k][0] && y[k][1] === x[k][1]);
}

/* **上書き**（2026-11-19 ユーザーの指示「新しいデータを完全に差し替える」「読み出したものは上書きするか追加するかきいて」）。
   cur（今の状態）を next（読み込んだ控え）で丸ごと置き換えた { doc, stamps } を返す。
   ただ next をそのまま入れると、印が古いので、合わせたときにサーバー・ほかの端末の新しい記録が勝って戻ってくる。
   そこで、next の記録には今の時刻（今ある印のどれよりも新しい時刻）の印を付け直し、
   next に無い記録（今あるもの・印だけあるもの）には同じ時刻の墓石を付ける。これで合わせても next の中身が残る。
   日付（lastDay）は進むだけ（新しいほう）。cur・next は書き換えない */
export function replaceState(cur, next, at = Date.now()) {
  const C = cur || { doc: {}, stamps: {} };
  const N = next || { doc: {}, stamps: {} };
  let top = Math.floor(Number(at)) || Date.now();
  [C.stamps, N.stamps].forEach(st => Object.keys(st || {}).forEach(k => {
    const s = st[k];
    if (Array.isArray(s) && Number(s[0]) >= top) top = Number(s[0]) + 1;
  }));
  const rn = recordsOf(N.doc), rc = recordsOf(C.doc);
  const stamps = {};
  new Set([...Object.keys(C.stamps || {}), ...Object.keys(N.stamps || {}), ...rc.keys()])
    .forEach(k => { if (!rn.has(k)) stamps[k] = [top, 0]; });
  rn.forEach((_, k) => { stamps[k] = [top, 1]; });
  const doc = buildDoc(rn, Object.assign({}, C.doc, N.doc));
  const days = [C.doc && C.doc.lastDay, N.doc && N.doc.lastDay].filter(x => typeof x === 'string').sort();
  doc.lastDay = days.length ? days[days.length - 1] : null;
  return { doc, stamps };
}

/* **追加**（2026-11-19。上書きと対の、読み込んだものを今の記録に足す）。
   ふつうに重ねる（mergeState。記録ごとに新しいほうが残る）うえで、読み込んだものにあって今は無い（消した・まだ無い）記録は、
   今の時刻の印で戻す。印だけで重ねると、控えを取った後に消した泡は、消した印のほうが新しくて戻らないため。
   並び・丸ごとの欄（order:・whole:）は重ねたままにする */
export function addState(cur, add, at = Date.now()) {
  const m = mergeState(cur, add);
  const A = add || { doc: {}, stamps: {} };
  const rm = recordsOf(m.doc), ra = recordsOf(A.doc);
  let top = Math.floor(Number(at)) || Date.now();
  Object.keys(m.stamps).forEach(k => { const s = m.stamps[k]; if (Array.isArray(s) && Number(s[0]) >= top) top = Number(s[0]) + 1; });
  let changed = false;
  ra.forEach((v, k) => {
    if (k.startsWith('order:') || k.startsWith('whole:') || rm.has(k)) return;
    rm.set(k, v);
    m.stamps[k] = [top, 1];
    changed = true;
  });
  if (!changed) return m;
  const doc = buildDoc(rm, m.doc);
  doc.lastDay = m.doc.lastDay;
  return { doc, stamps: m.stamps };
}

/* ■ 3 方向の合わせ（2026-11-26。泡の記録が古い写しで丸ごと戻った件）

   todo は 1 件が 1 つの記録なので、記録ごとに新しいほうを残すと、古い写しを持った端末が
   別の欄（日に置く・先に済ませる…）を 1 つ直しただけで、その間にほかの書き手（秘書など）が
   直した本文・最初の一手・記録・足した日を、写しの古い値で丸ごと上書きしてしまう
   （2026-11-25・11-26 に 2 回。ログなど別の記録は残り、todo だけが戻った）。

   そこで、端末が最後にサーバーと一致していたときの todo（base。sync.js が端末の中だけに持つ）と比べ、
   手元（a）と相手（b）の**両方**が base から変えた todo だけ、欄ごとに合わせる。
     ・a と b が同じ → そのまま
     ・a が base のまま → b の値。b が base のまま → a の値
     ・両方が変えた → 記録の新しいほう（mergeState の勝ち）の値。ただし日の並び（days・key・first）は
       両方の足した日・外した日を base に当てて合わせる（足したものはすべて残り、外したものは外れる）
     ・片方にしか無い欄は「無い」という値として同じ決まりで比べる（足した欄・消した欄も残る）
   合わせた結果が勝ったほうの中身と違えば、印を「両方の新しいほう＋1 ms」にする。
   同じ時刻で中身が違うと、次に合わせたとき互いに動かず、サーバーとこの端末で食い違ったまま残るため。
   計算は a・b を入れ替えても同じ答え（勝ちの決め方が mergeState と同じなので）。
   base が無い・読めない・その todo が base に無い・片方が消した、のどれかなら mergeState のまま。
   firstSpan は合わせたあとも keepFirstSpan（早く書いたほう）を通す。
   記録の形・印の鍵・サーバーは何も変えない */

/* 日の並びの欄（store.js の days と、choiceFields の key・first）。順は古い順 */
const DAY_SET_FIELDS = new Set(['days', 'key', 'first']);
const ABSENT = '\u0000absent';
function jsonOf(v) { return v === undefined ? ABSENT : JSON.stringify(v); }

/* 日の並びを 3 方向で合わせる。並びでない値が混ざっていれば null（ふつうの欄として扱う） */
function mergeDaySet(b, l, r) {
  const ok = v => v === undefined || (Array.isArray(v) && v.every(x => typeof x === 'string'));
  if (!ok(b) || !ok(l) || !ok(r)) return null;
  const B = new Set(b || []), L = new Set(l || []), R = new Set(r || []);
  const out = new Set();
  [...L, ...R].forEach(x => {
    /* base にあったのに、どちらかが外したものは外す */
    if (B.has(x) && (!L.has(x) || !R.has(x))) return;
    out.add(x);
  });
  const list = [...out].sort();
  /* 空になったら、片方でも欄を置いていなければ欄ごと省く（key・first は空なら欄を置かない形） */
  if (!list.length && (l === undefined || r === undefined)) return { absent: true };
  return { value: list };
}

/* todo 1 件を 3 方向で合わせる。win は記録の新しいほう、lose はもう片方。どれも書き換えない */
export function mergeTodo3(base, win, lose) {
  const out = {};
  const keys = [];
  [win, lose, base].forEach(o => Object.keys(o || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
  keys.forEach(k => {
    const vb = base ? base[k] : undefined, vw = win[k], vl = lose[k];
    const jb = jsonOf(vb), jw = jsonOf(vw), jl = jsonOf(vl);
    let v;
    if (jw === jl) v = vw;
    else if (jw === jb) v = vl;               /* 勝ったほうは変えていない → 変えたほう */
    else if (jl === jb) v = vw;
    else if (DAY_SET_FIELDS.has(k)) {
      const d = mergeDaySet(vb, vw, vl);
      v = !d ? vw : (d.absent ? undefined : d.value);
    } else v = vw;                            /* 両方が変えた → 新しいほう */
    if (v !== undefined) out[k] = JSON.parse(JSON.stringify(v));
  });
  return out;
}

/* mergeState に 3 方向の合わせを足したもの。base は { todos: [...] }（最後にサーバーと一致していたときの todo）か null。
   a・b・base のどれも書き換えない */
export function mergeState3(base, a, b) {
  const m = mergeState(a, b);
  const rbase = base && Array.isArray(base.todos) ? recordsOf({ todos: base.todos }) : null;
  if (!rbase) return m;
  const A = a || { doc: {}, stamps: {} };
  const B = b || { doc: {}, stamps: {} };
  const ra = recordsOf(A.doc), rb = recordsOf(B.doc), rm = recordsOf(m.doc);
  const fixed = new Map();
  rm.forEach((cur, k) => {
    if (!k.startsWith('todo:') || !rbase.has(k) || !ra.has(k) || !rb.has(k)) return;
    const sa = stampOf(A.stamps, k), sb = stampOf(B.stamps, k);
    if (!sa[1] || !sb[1]) return;               /* 片方が消した → 新しいほうのまま */
    const va = ra.get(k), vb = rb.get(k), v0 = rbase.get(k);
    const ja = JSON.stringify(va), jb = JSON.stringify(vb), j0 = JSON.stringify(v0);
    if (ja === jb || ja === j0 || jb === j0) return;   /* 片方しか変えていない → 新しいほうで正しい */
    const w = pick(sa, va, sb, vb);
    const merged = keepFirstSpan(k, mergeTodo3(v0, w === 'a' ? va : vb, w === 'a' ? vb : va), va, vb);
    if (JSON.stringify(merged) === JSON.stringify(cur)) return;
    fixed.set(String(cur.id), merged);
    m.stamps[k] = [Math.max(Number(sa[0]) || 0, Number(sb[0]) || 0) + 1, 1];
  });
  if (!fixed.size) return m;
  m.doc.todos = m.doc.todos.map(t => (t && fixed.has(String(t.id))) ? fixed.get(String(t.id)) : t);
  return m;
}
