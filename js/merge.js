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
];
/* 1つの値として丸ごと持つ欄（中の要素ごとには合わせない） */
const WHOLE_KEYS = ['seas', 'removedStarters'];

/* 保存データ → Map(key → 値)。並びは 'order:<頭>' に id の配列として入る */
export function recordsOf(doc) {
  const out = new Map();
  const d = doc || {};
  LIST_KEYS.forEach(([field, head, keyOf, ordered]) => {
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
    if (s[1]) recs.set(k, w === 'a' ? ra.get(k) : rb.get(k));
  });

  const doc = buildDoc(recs, Object.assign({}, B.doc, A.doc));
  /* 日付は進むだけ。新しいほう（日の切り替えはどちらの端末でも同じ結果になる） */
  const days = [A.doc && A.doc.lastDay, B.doc && B.doc.lastDay]
    .filter(x => typeof x === 'string').sort();
  doc.lastDay = days.length ? days[days.length - 1] : null;
  return { doc, stamps };
}

/* 記録の Map（recordsOf の形）から保存データを組み直す。base の、記録に分けない欄（v など）は残す。
   mergeState と、CSV の読み込み（csvio.js）が使う */
export function buildDoc(recs, base) {
  const doc = Object.assign({}, base || {});
  LIST_KEYS.forEach(([field, head, keyOf, ordered]) => {
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
