/* データ層のテスト。
   フレームワークは使わない。素の Node と assert だけで走る。

     node tests/store.test.mjs

   store.js は読み込み時に localStorage を触り、rollover() を1回走らせる。
   そのため「どんな保存データで起動したか」ごとにモジュールを読み直したい。
   import に ?case=N を付けると別モジュールとして読み込まれるので、それを使う。 */

import assert from 'node:assert/strict';

const KEY = 'bubble_todo_v1';
const STORE_URL = new URL('../js/store.js', import.meta.url).href;

/* --- localStorage のスタブ（Map ベース） --- */

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

/* --- 時計を固定する。システム時刻に依存させない --- */

const REAL_NOW = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
function setNow(ms) { fakeNow = ms; }

/* ローカル時刻で epoch ms を作る。store 側も端末のローカル時刻で日付を切るので、
   どのタイムゾーンで走らせても結果が変わらない */
function ms(y, m, d, h = 0, mi = 0) { return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); }

const NOW = ms(2026, 8, 20, 10, 0);   /* 2026-08-20 10:00。基準の「いま」 */

/* --- ストアを開き直す ---
   raw を渡すと保存データを入れ替えてから開く（null で空、文字列はそのまま、
   オブジェクト/配列は JSON にして入れる）。省くと今の保存内容のまま開き直す */

let seq = 0;
async function open({ raw, now = NOW } = {}) {
  if (raw !== undefined) {
    mem.clear();
    if (raw !== null) {
      localStorage.setItem(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
  }
  setNow(now);
  const mod = await import(`${STORE_URL}?case=${++seq}`);
  return mod.store;
}

function saved() { return JSON.parse(localStorage.getItem(KEY)); }

/* --- ごく小さいテストランナー --- */

let pass = 0;
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('ok   - ' + name);
  } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* ============================================================ */

/* 1. 旧形式（配列そのもの）が v2 に移行され、既存の todo が消えない */
await test('旧形式の配列が v2 に移行され、todo が消えない', async () => {
  const store = await open({ raw: [
    { id: 'a', text: '牛乳を買う', today: true, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.4, slots: ['morning'] },
    { id: 'b', text: '本を返す', today: false, createdAt: ms(2026, 8, 18, 9, 0) },
    { text: 'id の無いもの', today: false },
    null,
    { today: false },                       /* text が無いので落ちる */
  ] });

  assert.equal(store.count(), 3);
  assert.equal(store.get('a').text, '牛乳を買う');
  assert.equal(store.get('a').today, true);
  assert.deepEqual(store.slotsOf('a'), ['morning']);
  assert.deepEqual(store.get('a').started, {});      /* 旧データには無いので空で入る */
  assert.deepEqual(store.get('b').started, {});
  assert.deepEqual(store.log(), []);                 /* log: [] で移行 */
  assert.equal(store.get('a').fx, 0.3);

  const s = saved();
  assert.equal(s.v, 2);
  assert.equal(s.todos.length, 3);
  assert.deepEqual(s.log, []);
  assert.equal(s.lastDay, '2026-08-20');
  /* lastDay が無い移行直後は、いつのぶんか判らないので海に戻さない */
  assert.equal(store.get('a').today, true);
});

/* 2. start / isStarted / startedAt / unstart（記録はアンカーごと） */
await test('start / isStarted / startedAt / unstart が期待どおり', async () => {
  const store = await open({ raw: null });
  const t = store.add('部屋を片づける', { today: true });
  const a = store.addAnchor('歯を磨いたら');
  const b = store.addAnchor('風呂から出たら');
  assert.equal(store.setAnchor(t.id, a.id, true), true);

  assert.equal(store.isStarted(t.id, a.id), false);
  assert.equal(store.startedAt(t.id, a.id), null);

  assert.equal(store.start(t.id, a.id), true);
  assert.equal(store.isStarted(t.id, a.id), true);
  assert.equal(store.startedAt(t.id, a.id), NOW);
  assert.equal(store.isStarted(t.id, b.id), false);
  assert.equal(store.totalStarted(), 1);
  assert.deepEqual(store.log(), [
    { id: t.id, text: '部屋を片づける', slot: a.id, slotName: '歯を磨いたら', at: NOW },
  ]);

  /* 取り消すと、そのアンカーの着手も今日ぶんのログも消える */
  assert.equal(store.unstart(t.id, a.id), true);
  assert.equal(store.isStarted(t.id, a.id), false);
  assert.equal(store.startedAt(t.id, a.id), null);
  assert.deepEqual(store.log(), []);
  assert.equal(store.unstart(t.id, a.id), false);   /* 二重の取り消しは false */

  /* 保存されていて、開き直しても残る（アンカーごと） */
  assert.equal(store.start(t.id, a.id), true);
  const again = await open();
  assert.deepEqual(again.anchors().map(x => x.name), ['歯を磨いたら', '風呂から出たら']);
  assert.equal(again.isStarted(t.id, a.id), true);
  assert.equal(again.startedAt(t.id, a.id), NOW);
  assert.equal(again.totalStarted(), 1);
});

/* 3. ぶら下がっていない / 二重 start / その他の門前払い */
await test('ぶら下がっていない・二重 start・不正な指定は false', async () => {
  const store = await open({ raw: null });
  const a = store.addAnchor('コーヒーを淹れたら');
  const b = store.addAnchor('風呂から出たら');

  assert.equal(store.start('nosuchid', a.id), false);           /* todo が無い */

  const floating = store.add('あとで考える');                    /* today:false */
  assert.equal(store.start(floating.id, a.id), false);          /* ぶら下がっていない */
  /* アンカー無しなら、海に漂っているもの（today:false）でも記録できる。
     門前払いになるのは「アンカーを指定したのにぶら下がっていない」ときだけ */
  assert.equal(store.start(floating.id, null), true);
  assert.equal(store.start(floating.id, null), false);          /* 二重 start は false */
  assert.equal(store.unstart(floating.id, null), true);         /* この先の件数を数えるために戻す */
  assert.equal(store.totalStarted(), 0);

  const t = store.add('皿を洗う', { today: true });
  assert.equal(store.start(t.id, a.id), false);                 /* ぶら下がっていない */

  /* 時間帯タグに入れても、そちらでは記録できない（記録はアンカーの側だけ） */
  store.setSlot(t.id, 'noon', true);
  assert.equal(store.start(t.id, 'noon'), false);               /* 時間帯は アンカー id ではない */
  assert.equal(store.start(t.id, 'nosuchanchor'), false);       /* 無いアンカー */
  assert.equal(store.start(t.id, 5), false);                    /* 文字列でも null でもない */

  store.setAnchor(t.id, b.id, true);
  assert.equal(store.start(t.id, a.id), false);                 /* 別のアンカーには居る */
  assert.equal(store.start(t.id, b.id), true);
  assert.equal(store.start(t.id, b.id), false);                 /* 二重 start */
  assert.equal(store.totalStarted(), 1);                        /* ログも増えない */
});

/* 4a. 起動時の日またぎ。ログは消えない。アンカーも消えない */
await test('日が変わっていれば読み込み時に rollover が走り、ログは残る', async () => {
  const store = await open({ raw: {
    v: 2,
    anchors: [{ id: 'A', name: '歯を磨いたら', hue: 0 }],
    todos: [
      { id: 'a', text: '薬を飲む', today: true, createdAt: ms(2026, 8, 19, 8, 0), fx: 0.3, fy: 0.3,
        slots: ['morning', 'night'], anchors: ['A'], started: { A: ms(2026, 8, 19, 9, 0) } },
      { id: 'b', text: 'ごみを出す', today: true, createdAt: ms(2026, 8, 19, 8, 0), fx: 0.4, fy: 0.4,
        slots: ['noon'], started: {} },
      { id: 'c', text: '漂っているもの', today: false, createdAt: ms(2026, 8, 19, 8, 0), fx: 0.5, fy: 0.5 },
    ],
    log: [{ id: 'a', text: '薬を飲む', slot: 'A', slotName: '歯を磨いたら', at: ms(2026, 8, 19, 9, 0) }],
    lastDay: '2026-08-19',
  }, now: NOW });

  /* 着手済みかどうかに関係なく、全部 海（today:false）に戻る */
  assert.equal(store.todays().length, 0);
  assert.equal(store.count(), 3);
  ['a', 'b'].forEach(id => {
    assert.equal(store.get(id).today, false);
    assert.deepEqual(store.get(id).slots, [], '時間帯タグは today と一緒に消える');
    assert.deepEqual(store.get(id).started, {});
  });
  assert.equal(store.isStarted('a', 'A'), false, 'はじめた記録は毎日リセット');
  /* アンカーは立てっぱなしの計画なので、日をまたいでも外れない */
  assert.deepEqual(store.anchorsOf('a'), ['A']);
  assert.deepEqual(store.inAnchor('A').map(t => t.id), ['a']);

  /* ログは過去の事実なので消えない */
  assert.equal(store.totalStarted(), 1);
  assert.deepEqual(store.log(), [
    { id: 'a', text: '薬を飲む', slot: 'A', slotName: '歯を磨いたら', at: ms(2026, 8, 19, 9, 0) },
  ]);
  assert.equal(saved().lastDay, '2026-08-20');
  assert.equal(store.rollover(), 0);          /* 同じ日に2度は走らない */
});

/* 4b. 公開 API としての rollover。件数を返し、変化があれば通知する */
await test('rollover() は戻した件数を返し、通知する', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const anchor = store.addAnchor('歯を磨いたら');
  const a = store.add('朝やる', { today: true });
  const b = store.add('昼やる', { today: true });
  store.add('漂わせておく');
  store.setSlot(a.id, 'morning', true);
  store.setSlot(b.id, 'noon', true);
  store.setAnchor(a.id, anchor.id, true);
  store.start(a.id, anchor.id);

  assert.equal(store.rollover(), 0);          /* まだ同じ日 */

  let notified = 0;
  store.on(() => { notified++; });

  setNow(ms(2026, 8, 21, 10, 0));             /* 翌日になった */
  assert.equal(store.rollover(), 0);          /* 今日する枠にいた2件を海へ */
  assert.equal(notified, 1);
  assert.equal(store.todays().length, 0);
  assert.equal(store.count(), 3);             /* todo 自体は消さない */
  assert.equal(store.isStarted(a.id, anchor.id), false);
  assert.deepEqual(store.anchorsOf(a.id), [anchor.id], 'アンカーは残る');
  assert.deepEqual(store.slotsOf(a.id), [], '時間帯タグは消える');
  assert.equal(store.totalStarted(), 1);      /* ログは残る */

  assert.equal(store.rollover(), 0);
  assert.equal(notified, 1);                  /* 0 件なら通知しない */
  setNow(NOW);
});

/* 5. アンカーから外すと、そのアンカーの着手も消える。時間帯タグは記録に触らない */
await test('setAnchor(id, anchorId, false) でそのアンカーの started が消える', async () => {
  const store = await open({ raw: null });
  const t = store.add('洗濯', { today: true });
  const a = store.addAnchor('歯を磨いたら');
  const b = store.addAnchor('風呂から出たら');
  store.setAnchor(t.id, a.id, true);
  store.setAnchor(t.id, b.id, true);
  store.start(t.id, a.id);
  store.start(t.id, b.id);
  assert.equal(store.totalStarted(), 2);

  /* 時間帯タグの出し入れは、記録には一切さわらない */
  store.setSlot(t.id, 'morning', true);
  assert.equal(store.setSlot(t.id, 'morning', false), true);
  assert.equal(store.isStarted(t.id, a.id), true);
  assert.equal(store.isStarted(t.id, b.id), true);

  assert.equal(store.setAnchor(t.id, a.id, false), true);
  assert.equal(store.isStarted(t.id, a.id), false);
  assert.equal(store.isStarted(t.id, b.id), true);         /* もう片方は残る */
  assert.deepEqual(store.anchorsOf(t.id), [b.id]);
  assert.equal(store.totalStarted(), 2);                   /* ログは消さない */

  /* 「今日する」から戻すと、消えるのは時間帯タグだけ。着手の記録には触らない
     （追補3 §6。着手はどこに置いてあるものでも記録できるので、
     今日する枠から外したくらいで印を落とすと、印だけ消えてログが残る） */
  store.setSlot(t.id, 'night', true);
  store.setToday(t.id, true) || 0;                     /* すでに true。念のため */
  store.start(t.id, null);                             /* アンカー無しでも始めておく */
  assert.equal(store.isStarted(t.id, null), true);
  assert.equal(store.setToday(t.id, false), true);
  assert.deepEqual(store.slotsOf(t.id), []);
  assert.equal(store.isStarted(t.id, null), true, 'アンカー無しの記録も残る');
  assert.equal(store.isStarted(t.id, b.id), true, 'アンカーでの記録は残る');
  assert.deepEqual(store.anchorsOf(t.id), [b.id]);
  assert.equal(store.totalStarted(), 3);
});

/* 6-7. 集計。日ごと・アンカーごとの件数 */
const AGG = {
  v: 2,
  anchors: [
    { id: 'A', name: '歯を磨いたら', hue: 0 },
    { id: 'B', name: '風呂から出たら', hue: 1 },
    { id: 'C', name: '駅に着いたら', hue: 2 },
  ],
  todos: [
    { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.5, fy: 0.5 },
    { id: 'b', text: 'い', today: false, createdAt: ms(2026, 8, 18, 9, 0), fx: 0.5, fy: 0.5 },
    { id: 'c', text: 'う', today: false, createdAt: ms(2026, 8, 1, 9, 0), fx: 0.5, fy: 0.5 },
  ],
  log: [
    { id: 'c', text: 'う', slot: 'B', slotName: '風呂から出たら', at: ms(2026, 8, 10, 12, 0) },   /* 7日より前 */
    { id: 'b', text: 'い', slot: 'A', slotName: '歯を磨いたら', at: ms(2026, 8, 14, 6, 0) },      /* 窓のいちばん古い日 */
    { id: 'b', text: 'い', slot: 'A', slotName: '歯を磨いたら', at: ms(2026, 8, 18, 9, 0) },
    { id: 'b', text: 'い', slot: 'C', slotName: '駅に着いたら', at: ms(2026, 8, 18, 20, 0) },
    { id: 'b', text: 'い', slot: 'C', slotName: '駅に着いたら', at: ms(2026, 8, 19, 3, 0) },      /* 5時前なので 08-18 ぶん */
    { id: 'a', text: 'あ', slot: 'B', slotName: '風呂から出たら', at: ms(2026, 8, 20, 10, 0) },
  ],
  lastDay: '2026-08-20',
};

await test('startedByDay(7) はちょうど7件・古い順・0の日も含む', async () => {
  const store = await open({ raw: AGG, now: NOW });
  const by = store.startedByDay(7);

  assert.equal(by.length, 7);
  assert.deepEqual(by.map(x => x.day), [
    '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17',
    '2026-08-18', '2026-08-19', '2026-08-20',
  ]);
  assert.deepEqual(by.map(x => x.n), [1, 0, 0, 0, 3, 0, 1]);
  assert.equal(by[by.length - 1].day, store.today());     /* 最後が今日 */
  assert.equal(store.startedDays(7), 3);                  /* 1件以上あった日は3日 */
  assert.equal(store.startedByDay(1).length, 1);
  assert.deepEqual(store.startedByDay(1), [{ day: '2026-08-20', n: 1 }]);
});

await test('startedByAnchor と startedCount の件数が合う', async () => {
  const store = await open({ raw: AGG, now: NOW });

  assert.equal(store.totalStarted(), 6);        /* 全期間 */
  assert.equal(store.startedCount(7), 5);       /* 08-10 の1件は窓の外 */
  assert.equal(store.startedCount(30), 6);

  const byAnchor = store.startedByAnchor(7);
  assert.deepEqual(byAnchor, [
    { id: 'A', name: '歯を磨いたら', n: 2 },
    { id: 'B', name: '風呂から出たら', n: 1 },
    { id: 'C', name: '駅に着いたら', n: 2 },
  ]);
  /* アンカー無しの記録が無いので、末尾の行は足さない */
  assert.equal(byAnchor.length, store.anchors().length);
  const sum = byAnchor.reduce((n, x) => n + x.n, 0);
  assert.equal(sum, store.startedCount(7));

  const byDay = store.startedByDay(7);
  assert.equal(byDay.reduce((n, x) => n + x.n, 0), store.startedCount(7));

  const all = store.startedByAnchor(30);
  assert.equal(all.reduce((n, x) => n + x.n, 0), store.totalStarted());

  /* 書いた件数は createdAt で数える */
  assert.equal(store.writtenCount(7), 2);
  assert.equal(store.writtenCount(30), 3);

  /* log() はコピー。外から触っても中身が壊れない */
  const copy = store.log();
  copy.push({ id: 'x', text: 'x', slot: 'B', slotName: '風呂から出たら', at: NOW });
  copy[0].text = '書き換え';
  assert.equal(store.totalStarted(), 6);
  assert.equal(store.log()[0].text, 'う');

  /* anchors() もコピー。並べ替えても中の順は動かない */
  const as = store.anchors();
  as.reverse();
  assert.deepEqual(store.anchors().map(a => a.id), ['A', 'B', 'C']);
});

/* 8. 壊れた保存データ */
await test('壊れた保存データでも例外を投げずに空で立ち上がる', async () => {
  for (const raw of ['{ これは JSON ではない', '"ただの文字列"', 'null', '[', '42']) {
    const store = await open({ raw });
    assert.equal(store.count(), 0, raw);
    assert.deepEqual(store.log(), [], raw);
    assert.equal(store.today(), '2026-08-20', raw);
  }
  /* 形は JSON だが中身が違う */
  const store = await open({ raw: { v: 2, anchors: 'ちがう', todos: 'ちがう', log: 'ちがう', lastDay: 5 } });
  assert.equal(store.count(), 0);
  assert.deepEqual(store.log(), []);
  assert.deepEqual(store.anchors(), []);
  /* 壊れたアンカーの行だけを落とす */
  const anch = await open({ raw: {
    v: 2,
    anchors: [
      { id: 'A', name: '歯を磨いたら', hue: 0 },
      { id: 'A', name: '重複した id', hue: 1 },     /* id が重複 */
      { id: 'B', name: '   ', hue: 1 },             /* 名前が空 */
      { name: 'id が無い', hue: 1 },
      { id: 'C', name: 'hue が変', hue: 9 },        /* hue は null に倒す */
      null,
    ],
    todos: [], log: [], lastDay: '2026-08-20',
  } });
  /* days / weeks は「きっかけの日にち」。持たない旧データは空＝毎日で立ち上がる */
  assert.deepEqual(anch.anchors(), [
    { id: 'A', name: '歯を磨いたら', hue: 0, days: [], weeks: [] },
    { id: 'C', name: 'hue が変', hue: null, days: [], weeks: [] },
  ]);
  /* 壊れたログ行だけを落とす。
     いま存在しないアンカーの id は「壊れている」ではない（消したアンカーの記録）ので残す */
  const mixed = await open({ raw: {
    v: 2,
    anchors: [],
    todos: [{ id: 'a', text: 'あ', today: false, createdAt: NOW }],
    log: [
      { id: 'a', text: 'あ', slot: 'A', slotName: '歯を磨いたら', at: NOW },
      { id: 'a', text: 'あ', slot: null, at: NOW },   /* アンカー無しの行も許す */
      { id: 'a', slot: 5, at: NOW },                  /* slot が文字列でも null でもない */
      { id: 'a', slot: 'A' },                         /* 時刻が無い */
      null,
    ],
    lastDay: '2026-08-20',
  } });
  assert.equal(mixed.count(), 1);
  assert.equal(mixed.totalStarted(), 2);
  assert.deepEqual(mixed.log().map(e => e.slot), ['A', null]);
  assert.deepEqual(mixed.log().map(e => e.slotName), ['歯を磨いたら', '']);
});

/* 9. 日付の境。5時までは前日 */
await test('today() は午前5時までを前日として扱う', async () => {
  const store = await open({ raw: null });
  assert.equal(store.DAY_CUTOFF_HOUR, 5);

  const cases = [
    [ms(2026, 8, 20, 0, 0), '2026-08-19'],
    [ms(2026, 8, 20, 4, 59), '2026-08-19'],
    [ms(2026, 8, 20, 5, 0), '2026-08-20'],
    [ms(2026, 8, 20, 12, 0), '2026-08-20'],
    [ms(2026, 8, 20, 23, 59), '2026-08-20'],
    [ms(2026, 8, 21, 1, 0), '2026-08-20'],
    [ms(2026, 1, 1, 3, 0), '2025-12-31'],       /* 年をまたぐ */
    [ms(2026, 3, 1, 6, 0), '2026-03-01'],       /* 月をまたぐ手前 */
  ];
  cases.forEach(([now, want]) => {
    setNow(now);
    assert.equal(store.today(), want, String(now));
  });
  setNow(NOW);
});

/* 10. ログは todo を消しても残る */
await test('todo を削除してもログは残り、text は当時のまま', async () => {
  const store = await open({ raw: null });
  const t = store.add('郵便を出す', { today: true });
  const a = store.addAnchor('昼を食べたら');
  store.setAnchor(t.id, a.id, true);
  store.start(t.id, a.id);

  const snap = store.remove(t.id);
  assert.equal(store.count(), 0);
  assert.equal(store.totalStarted(), 1);
  assert.equal(store.log()[0].text, '郵便を出す');
  assert.equal(store.log()[0].id, t.id);
  assert.deepEqual(store.inAnchor(a.id), []);

  assert.equal(store.restore(snap), true);
  assert.equal(store.count(), 1);
  assert.equal(store.totalStarted(), 1);        /* restore で増えたりしない */
  assert.equal(store.isStarted(t.id, a.id), true);
  assert.deepEqual(store.inAnchor(a.id).map(x => x.id), [t.id]);
});

/* 11. 既存 API の素通し確認（画面1・画面2 が使っているもの） */
await test('既存 API の意味が変わっていない', async () => {
  const store = await open({ raw: null });
  assert.deepEqual(store.SLOTS, ['morning', 'noon', 'night']);

  const a = store.add('  前後の空白  ');
  assert.equal(a.text, '前後の空白');
  assert.equal(store.add('   '), null);
  assert.deepEqual(a.started, {});

  assert.equal(store.floating().length, 1);
  assert.equal(store.todays().length, 0);
  assert.equal(store.setToday(a.id, true), true);
  assert.equal(store.setToday(a.id, true), false);
  assert.equal(store.todays().length, 1);

  assert.equal(store.setSlot(a.id, 'morning'), true);          /* on 省略でトグル */
  assert.equal(store.inSlot('morning').length, 1);
  assert.equal(store.unslotted().length, 0);
  assert.equal(store.moveSlot(a.id, 'morning', 'night'), true);
  assert.deepEqual(store.slotsOf(a.id), ['night']);
  assert.equal(store.clearSlots(a.id), true);
  assert.equal(store.unslotted().length, 1);

  assert.equal(store.setPos(a.id, 0.9, 0.1), true);
  assert.equal(store.get(a.id).fx, 0.9);
  assert.equal(store.setPos(a.id, 5, -5), true);               /* 0..1 に丸める */
  assert.equal(store.get(a.id).fx, 1);
  assert.equal(store.get(a.id).fy, 0);

  store.seed(['たね1', 'たね2']);
  assert.equal(store.count(), 3);
  assert.equal(store.all().length, 3);
  store.all().forEach(t => assert.deepEqual(t.started, {}));

  store.clear();
  assert.equal(store.count(), 0);
});

/* ============================================================ */

await test('todayedCount は「今日するに入れた」件数を期間で数える', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 18, 10) });
  const a = store.add('あ'), b = store.add('い'), c = store.add('う');

  /* 8/18 に2件、8/20 に1件入れる */
  store.setToday(a.id, true);
  store.setToday(b.id, true);
  setNow(ms(2026, 8, 20, 10));
  store.setToday(c.id, true);

  assert.equal(store.todayedCount(1), 1, '今日ぶんは1件');
  assert.equal(store.todayedCount(7), 3, '直近7日で3件');

  /* 外して入れ直したら、その回数ぶん数える（現在値ではなく出来事を数えている） */
  store.setToday(c.id, false);
  store.setToday(c.id, true);
  assert.equal(store.todayedCount(1), 2);
  assert.equal(store.todays().length, 3, 'todays() は現在値なので3のまま');

  /* 期間外は数えない */
  setNow(ms(2026, 8, 30, 10));
  assert.equal(store.todayedCount(1), 0);
  assert.equal(store.todayedCount(30), 4);

  /* 枠に直接書いた場合（setToday を通らない経路）も数える */
  store.add('直接', { today: true });
  assert.equal(store.todayedCount(1), 1);
  store.add('海へ');
  assert.equal(store.todayedCount(1), 1, '海に書いたものは数えない');
});

/* ============================================================ */

await test('clear() は todo だけ消し、記録は残す', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ');
  const anchor = store.addAnchor('歯を磨いたら');
  store.setToday(a.id, true);
  store.setAnchor(a.id, anchor.id, true);
  assert.equal(store.start(a.id, anchor.id), true);
  assert.equal(store.totalStarted(), 1);
  assert.equal(store.todayedCount(1), 1);

  store.clear();
  assert.equal(store.count(), 0, 'todo は消える');
  assert.equal(store.totalStarted(), 1, '着手の記録は残る');
  assert.equal(store.todayedCount(1), 1, '入れた記録も残る');
  assert.equal(store.log()[0].text, 'あ', 'ログの text は当時のまま');
  assert.deepEqual(store.anchors().map(x => x.id), [anchor.id], 'アンカーは消さない');
});

/* ============================================================ */

await test('アンカーから外れたら、どの経路でも着手印が落ちる（ログは残る）', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const B = store.addAnchor('風呂から出たら');
  const C = store.addAnchor('コーヒーを淹れたら');

  /* moveItemAnchor：A → B */
  const a = store.add('あ');
  store.setToday(a.id, true);
  store.setAnchor(a.id, A.id, true);
  store.start(a.id, A.id);
  assert.equal(store.isStarted(a.id, A.id), true);
  store.moveItemAnchor(a.id, A.id, B.id);
  assert.equal(store.isStarted(a.id, A.id), false, '外れたアンカーの印は落ちる');
  assert.equal(store.isStarted(a.id, B.id), false, '移した先は未着手');
  assert.deepEqual(store.anchorsOf(a.id), [B.id]);

  /* clearAnchors：全部外す */
  const b = store.add('い');
  store.setToday(b.id, true);
  store.setAnchor(b.id, C.id, true);
  store.start(b.id, C.id);
  store.clearAnchors(b.id);
  assert.equal(store.isStarted(b.id, C.id), false);
  assert.deepEqual(store.anchorsOf(b.id), []);

  /* 記録そのものは残っている */
  assert.equal(store.totalStarted(), 2, 'ログは消えない');
  const by = store.startedByAnchor(1);
  assert.equal(by.find(r => r.id === A.id).n, 1);
  assert.equal(by.find(r => r.id === C.id).n, 1);

  /* started のキーは必ず anchors（＋アンカー無しの ''）の部分集合になっている。
     '' はどこに置いてあっても立つので、today かどうかは問わない */
  store.all().forEach(t => {
    Object.keys(t.started || {}).forEach(k => {
      if (k === '') return;
      assert.ok(t.anchors.indexOf(k) >= 0, `started(${k}) が anchors に無い`);
    });
  });
});

/* ============================================================ */

await test('wipe() は記録ごと初期状態に戻す', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ');
  const anchor = store.addAnchor('歯を磨いたら');
  store.setToday(a.id, true);
  store.setAnchor(a.id, anchor.id, true);
  store.start(a.id, anchor.id);
  assert.equal(store.totalStarted(), 1);

  store.wipe();
  assert.equal(store.count(), 0);
  assert.equal(store.totalStarted(), 0, '着手の記録も消える');
  assert.equal(store.todayedCount(30), 0, '入れた記録も消える');
  assert.deepEqual(store.anchors(), [], 'アンカーも初期状態（空）に戻る');
  assert.deepEqual(store.startedByAnchor(30), []);

  /* 保存にも残らない */
  const raw = saved();
  assert.deepEqual(raw.log, []);
  assert.deepEqual(raw.todayLog, []);
  assert.deepEqual(raw.todos, []);
  assert.deepEqual(raw.anchors, []);
});

/* ============================================================ */
/* 最初の一手 / リンク / すきま時間 */

await test('これらのフィールドが無い旧データでも壊れず、既定値が入る', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3 },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4, slots: ['noon'] },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.count(), 2);
  ['a', 'b'].forEach(id => {
    const t = store.get(id);
    assert.equal(t.firstStep, '', id);
    assert.equal(t.url, '', id);
    assert.equal(t.gap, false, id);
    assert.equal(store.firstStepOf(id), '', id);
    assert.equal(store.urlOf(id), '', id);
    assert.equal(store.isGap(id), false, id);
  });
  assert.deepEqual(store.gapItems(), []);

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const old = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.equal(old.firstStepOf('z'), '');
  assert.equal(old.urlOf('z'), '');
  assert.equal(old.isGap('z'), false);

  /* 無い id を聞かれても落ちない */
  assert.equal(store.firstStepOf('nosuch'), '');
  assert.equal(store.urlOf('nosuch'), '');
  assert.equal(store.isGap('nosuch'), false);
  assert.equal(store.setFirstStep('nosuch', 'x'), false);
  assert.equal(store.setGap('nosuch'), false);
  assert.deepEqual(store.setUrl('nosuch', 'https://example.com/'), { ok: false, url: '' });
});

await test('setFirstStep / firstStepOf の往復。空白は落ち、空文字で消せる', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('確定申告をする');

  assert.equal(store.firstStepOf(t.id), '', '既定は空');
  assert.equal(store.setFirstStep(t.id, '  領収書の箱を机に出す  '), true);
  assert.equal(store.firstStepOf(t.id), '領収書の箱を机に出す', '前後の空白が落ちる');
  assert.equal(store.get(t.id).firstStep, '領収書の箱を机に出す', 'todo 本体にも入る');

  assert.equal(store.setFirstStep(t.id, '領収書の箱を机に出す'), false, '同じ値なら false');
  assert.equal(store.setFirstStep(t.id, '  領収書の箱を机に出す'), false, '空白違いも同じ値');

  /* 空文字・空白だけ・null で消せる */
  assert.equal(store.setFirstStep(t.id, ''), true);
  assert.equal(store.firstStepOf(t.id), '');
  assert.equal(store.setFirstStep(t.id, ''), false);
  assert.equal(store.setFirstStep(t.id, 'ひとまず開く'), true);
  assert.equal(store.setFirstStep(t.id, '   '), true, '空白だけでも消える');
  assert.equal(store.firstStepOf(t.id), '');

  /* 保存され、開き直しても残る */
  store.setFirstStep(t.id, 'メールを1通だけ書く');
  const again = await open();
  assert.equal(again.firstStepOf(t.id), 'メールを1通だけ書く');
});

await test('setUrl は http / https を通し、正規化した文字列を返す', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('参考ページを読む');

  assert.equal(store.urlOf(t.id), '', '既定は空');

  const r1 = store.setUrl(t.id, 'https://example.com/a?q=1#x');
  assert.deepEqual(r1, { ok: true, url: 'https://example.com/a?q=1#x' });
  assert.equal(store.urlOf(t.id), 'https://example.com/a?q=1#x');

  assert.deepEqual(store.setUrl(t.id, 'http://example.com/a'), { ok: true, url: 'http://example.com/a' });

  /* 正規化：ホストは小文字、前後の空白は落ちる、パスが無ければ / が付く */
  assert.deepEqual(store.setUrl(t.id, '  HTTPS://Example.COM/Path  '),
    { ok: true, url: 'https://example.com/Path' });
  assert.deepEqual(store.setUrl(t.id, 'https://example.com'), { ok: true, url: 'https://example.com/' });

  /* 空文字・空白だけはクリアの意味 */
  assert.deepEqual(store.setUrl(t.id, ''), { ok: true, url: '' });
  assert.equal(store.urlOf(t.id), '');
  assert.deepEqual(store.setUrl(t.id, '   '), { ok: true, url: '' });

  /* 保存され、開き直しても残る */
  store.setUrl(t.id, 'https://example.com/keep');
  const again = await open();
  assert.equal(again.urlOf(t.id), 'https://example.com/keep');
});

await test('setUrl は javascript: data: file: などを保存しない', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('リンクを持つもの');

  const KEEP = 'https://example.com/safe';
  assert.deepEqual(store.setUrl(t.id, KEEP), { ok: true, url: KEEP });

  const bad = [
    'javascript:alert(1)',
    ' JavaScript:alert(1)',          /* 前後の空白 + 大文字混じり */
    'JAVASCRIPT:alert(1)',
    'java\tscript:alert(1)',         /* タブでの細工 */
    'java\nscript:alert(1)',         /* 改行での細工 */
    '\u0000javascript:alert(1)',      /* NUL での細工 */
    '\u0001javascript:alert(1)',      /* 制御文字での細工 */
    ' \r\n javascript:alert(1) ',     /* 空白と改行で挟む */
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'about:blank',
    'mailto:someone@example.com',
    'ftp://example.com/x',
    'blob:https://example.com/1234',
    'chrome://settings',
  ];
  bad.forEach(raw => {
    const r = store.setUrl(t.id, raw);
    assert.equal(r.ok, false, `ok:false であること: ${JSON.stringify(raw)}`);
    assert.equal(r.url, KEEP, `既存の値が返ること: ${JSON.stringify(raw)}`);
    assert.equal(store.urlOf(t.id), KEEP, `既存の値が変わらないこと: ${JSON.stringify(raw)}`);
    assert.equal(store.get(t.id).url, KEEP, JSON.stringify(raw));
  });

  /* 保存にも入っていない */
  const s = saved();
  assert.equal(s.todos[0].url, KEEP);

  /* 保存データに直接 javascript: が入っていても、読み込みで落とす */
  const dirty = await open({ raw: {
    v: 2,
    todos: [{ id: 'x', text: 'あ', today: false, createdAt: NOW, fx: 0.5, fy: 0.5,
      url: 'javascript:alert(1)' }],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.equal(dirty.urlOf('x'), '', '危ない値は読み込み時に空になる');
});

await test('スキームの無い example.com/a は https:// が補われる', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('リンク');

  assert.deepEqual(store.setUrl(t.id, 'example.com/a'), { ok: true, url: 'https://example.com/a' });
  assert.deepEqual(store.setUrl(t.id, '  example.com  '), { ok: true, url: 'https://example.com/' });
  assert.deepEqual(store.setUrl(t.id, 'www.example.com/b?q=1'),
    { ok: true, url: 'https://www.example.com/b?q=1' });
});

await test('setGap はトグルでき、isGap で読める', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('本を返す');

  assert.equal(store.isGap(t.id), false, '既定は false');
  assert.equal(store.setGap(t.id), true, 'on 省略でトグル');
  assert.equal(store.isGap(t.id), true);
  assert.equal(store.setGap(t.id), true, 'もう一度トグルで戻る');
  assert.equal(store.isGap(t.id), false);

  assert.equal(store.setGap(t.id, true), true);
  assert.equal(store.setGap(t.id, true), false, '同じ値なら false');
  assert.equal(store.isGap(t.id), true);
  assert.equal(store.setGap(t.id, false), true);
  assert.equal(store.setGap(t.id, false), false);

  /* 保存され、開き直しても残る */
  store.setGap(t.id, true);
  const again = await open();
  assert.equal(again.isGap(t.id), true);
});

await test('gapItems() は gap:true だけを作成順で返し、今日する外のものも含む', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 20, 9, 0) });

  const a = store.add('いちばん古い');                 /* 09:00 */
  setNow(ms(2026, 8, 20, 9, 10));
  const b = store.add('まんなか', { today: true });    /* 09:10・今日する */
  setNow(ms(2026, 8, 20, 9, 20));
  const c = store.add('いちばん新しい');               /* 09:20 */
  setNow(ms(2026, 8, 20, 9, 30));
  const d = store.add('印を付けないもの');
  setNow(NOW);

  assert.deepEqual(store.gapItems(), [], '既定では空');

  /* わざと新しいほうから印を付ける。戻りは作成順になるはず */
  store.setGap(c.id, true);
  store.setGap(a.id, true);
  store.setGap(b.id, true);

  const got = store.gapItems();
  assert.deepEqual(got.map(t => t.id), [a.id, b.id, c.id], '作成順（createdAt 昇順）');
  assert.equal(got.length, 3, '印の無いものは入らない');
  assert.equal(got.indexOf(store.get(d.id)), -1);

  /* 「今日する」に入っているかは問わない */
  assert.equal(store.get(a.id).today, false);
  assert.equal(store.get(b.id).today, true);
  assert.ok(got.some(t => !t.today), '海に漂っているものも含む');
  assert.ok(got.some(t => t.today), '今日する枠のものも含む');

  /* 外すと消える */
  store.setGap(b.id, false);
  assert.deepEqual(store.gapItems().map(t => t.id), [a.id, c.id]);

  /* 戻り値は毎回作り直した配列。並べ替えても内部の順は動かない */
  const copy = store.gapItems();
  copy.reverse();
  assert.deepEqual(store.gapItems().map(t => t.id), [a.id, c.id]);
  assert.deepEqual(store.all().map(t => t.id), [a.id, b.id, c.id, d.id], 'all() の順も動かない');
});

await test('remove() → restore() でこれらのフィールドが失われない', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('図書館へ行く', { today: true });
  store.setFirstStep(t.id, 'かばんに本を入れる');
  store.setUrl(t.id, 'https://example.com/lib');
  store.setGap(t.id, true);
  store.setSlot(t.id, 'noon', true);

  const snap = store.remove(t.id);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.gapItems(), []);
  assert.equal(store.firstStepOf(t.id), '');

  assert.equal(store.restore(snap), true);
  assert.equal(store.firstStepOf(t.id), 'かばんに本を入れる');
  assert.equal(store.urlOf(t.id), 'https://example.com/lib');
  assert.equal(store.isGap(t.id), true);
  assert.deepEqual(store.gapItems().map(x => x.id), [t.id]);
  assert.deepEqual(store.slotsOf(t.id), ['noon'], '既存のフィールドも従来どおり');

  /* 保存にも書き戻っていて、開き直しても残る */
  const again = await open();
  assert.equal(again.firstStepOf(t.id), 'かばんに本を入れる');
  assert.equal(again.urlOf(t.id), 'https://example.com/lib');
  assert.equal(again.isGap(t.id), true);
});

await test('rollover や setToday で これらのフィールドは消えない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const t = store.add('持ち越し確認', { today: true });
  store.setFirstStep(t.id, '封筒を出す');
  store.setUrl(t.id, 'https://example.com/x');
  store.setGap(t.id, true);
  store.setSlot(t.id, 'morning', true);

  /* 「今日する」から外しても、枠と着手の印だけが落ちる */
  assert.equal(store.setToday(t.id, false), true);
  assert.deepEqual(store.slotsOf(t.id), []);
  assert.equal(store.firstStepOf(t.id), '封筒を出す');
  assert.equal(store.urlOf(t.id), 'https://example.com/x');
  assert.equal(store.isGap(t.id), true);

  /* 日をまたいでも残る（すきま時間の印は今日限りのものではない） */
  store.setToday(t.id, true);
  setNow(ms(2026, 8, 21, 10, 0));
  /* 日付ごとに持つようになり、rollover は「戻す」ことをしなくなった（いつでも 0）。
     今日の海が空くのは、今日のキーを持つものが無くなるため */
  assert.equal(store.rollover(), 0);
  assert.equal(store.get(t.id).today, false);
  assert.equal(store.firstStepOf(t.id), '封筒を出す');
  assert.equal(store.urlOf(t.id), 'https://example.com/x');
  assert.equal(store.isGap(t.id), true);
  assert.deepEqual(store.gapItems().map(x => x.id), [t.id]);
  setNow(NOW);
});

/* ============================================================ */

await test('すきま時間に入れたものは海から消え、外すと戻る', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ'), b = store.add('い'), c = store.add('う');
  assert.equal(store.floating().length, 3);

  store.setGap(b.id, true);
  assert.equal(store.floating().length, 2, '海から消える');
  assert.ok(!store.floating().some(t => t.id === b.id));
  assert.equal(store.gapItems().length, 1);
  assert.equal(store.count(), 3, 'todo 自体は消えない');

  /* 外すと海へ戻る。位置も保たれている */
  const fx = store.get(b.id).fx;
  store.setGap(b.id, false);
  assert.equal(store.floating().length, 3, '海へ戻る');
  assert.equal(store.get(b.id).fx, fx, '漂う位置は保たれる');

  /* 今日するに入っているものは、もともと海に居ない */
  store.setToday(c.id, true);
  store.setGap(c.id, true);
  assert.equal(store.floating().length, 2);
  assert.equal(store.todays().length, 1, '今日するには残る');
  assert.equal(store.gapItems().length, 1);
  assert.equal(store.gapItems()[0].id, c.id);
});

/* ============================================================ */
/* アンカー（きっかけ） */

await test('anchors の無い旧データを読んでも、slots の振り分けが1件も失われない', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: '薬を飲む', today: true, createdAt: ms(2026, 8, 20, 8, 0), fx: 0.3, fy: 0.3,
        slots: ['morning', 'night'] },
      { id: 'b', text: 'ごみを出す', today: true, createdAt: ms(2026, 8, 20, 8, 0), fx: 0.4, fy: 0.4,
        slots: ['noon'] },
      { id: 'c', text: '漂っているもの', today: false, createdAt: ms(2026, 8, 20, 8, 0), fx: 0.5, fy: 0.5 },
    ],
    log: [{ id: 'a', text: '薬を飲む', slot: 'morning', at: ms(2026, 8, 20, 9, 0) }],
    lastDay: '2026-08-20',
  }, now: NOW });

  /* 時間帯タグはそのまま。アンカーへ移し替えたりしない */
  assert.deepEqual(store.slotsOf('a'), ['morning', 'night']);
  assert.deepEqual(store.slotsOf('b'), ['noon']);
  assert.equal(store.inSlot('morning').length, 1);
  assert.equal(store.inSlot('noon').length, 1);
  assert.equal(store.inSlot('night').length, 1);
  assert.deepEqual(store.SLOTS, ['morning', 'noon', 'night']);

  /* アンカーは空から始まる */
  assert.deepEqual(store.anchors(), []);
  assert.equal(store.anchor('morning'), null, '朝/昼/夜はアンカーではない');
  ['a', 'b', 'c'].forEach(id => assert.deepEqual(store.anchorsOf(id), [], id));
  assert.deepEqual(store.startedByAnchor(7), [], 'アンカーが無いので並べるものが無い');

  /* 次に書き込むときに anchors:[] が入る（読んだだけでは書き戻さない）。
     開き直しても振り分けは残る */
  assert.equal(saved().anchors, undefined, '読んだだけでは保存に触らない');
  store.flush();
  assert.deepEqual(saved().anchors, []);
  assert.deepEqual(saved().todos.map(t => t.slots), [['morning', 'night'], ['noon'], []]);
  const again = await open();
  assert.deepEqual(again.slotsOf('a'), ['morning', 'night']);
  assert.deepEqual(again.anchors(), []);
});

await test('addAnchor / renameAnchor / moveAnchor / removeAnchor', async () => {
  const store = await open({ raw: null, now: NOW });

  assert.deepEqual(store.anchors(), []);
  assert.equal(store.addAnchor(''), null, '空名は作らない');
  assert.equal(store.addAnchor('   '), null, '空白だけも作らない');
  assert.equal(store.addAnchor(null), null);
  assert.deepEqual(store.anchors(), []);

  const a = store.addAnchor('  歯を磨いたら  ');
  assert.equal(a.name, '歯を磨いたら', '前後の空白は落ちる');
  const b = store.addAnchor('風呂から出たら');
  const c = store.addAnchor('コーヒーを淹れたら');
  assert.deepEqual(store.anchors().map(x => x.name),
    ['歯を磨いたら', '風呂から出たら', 'コーヒーを淹れたら'], '作った順に並ぶ');
  assert.deepEqual(store.anchor(a.id),
    { id: a.id, name: '歯を磨いたら', hue: 0, days: [], weeks: [] });
  assert.equal(store.anchor('nosuch'), null);

  /* 改名。空名は受け付けない */
  assert.equal(store.renameAnchor(b.id, '  湯船から出たら '), true);
  assert.equal(store.anchor(b.id).name, '湯船から出たら');
  assert.equal(store.renameAnchor(b.id, ''), false, '空名は false');
  assert.equal(store.renameAnchor(b.id, '   '), false);
  assert.equal(store.anchor(b.id).name, '湯船から出たら', '弾かれたので変わらない');
  assert.equal(store.renameAnchor('nosuch', 'x'), false, '無い id は false');

  /* 並べ替え。-1 で上へ、+1 で下へ。端では false */
  assert.equal(store.moveAnchor(a.id, -1), false, '先頭をさらに上へは false');
  assert.equal(store.moveAnchor(c.id, +1), false, '末尾をさらに下へは false');
  assert.equal(store.moveAnchor(a.id, +1), true);
  assert.deepEqual(store.anchors().map(x => x.id), [b.id, a.id, c.id]);
  assert.equal(store.moveAnchor(c.id, -1), true);
  assert.deepEqual(store.anchors().map(x => x.id), [b.id, c.id, a.id]);
  assert.equal(store.moveAnchor('nosuch', -1), false);
  assert.equal(store.moveAnchor(b.id, 0), false, '動かさないなら false');

  /* 上限12件 */
  for (let i = 4; i <= 12; i++) assert.ok(store.addAnchor('き' + i), '12件までは作れる: ' + i);
  assert.equal(store.anchors().length, 12);
  assert.equal(store.addAnchor('13件目'), null, '上限を超えたら作らない');
  assert.equal(store.anchors().length, 12);

  /* 消す */
  assert.equal(store.removeAnchor('nosuch'), false);
  assert.equal(store.removeAnchor(c.id), true);
  assert.equal(store.anchors().length, 11);
  assert.equal(store.anchor(c.id), null);
  assert.ok(store.addAnchor('また作れる'), '1件空いたので作れる');

  /* 保存され、開き直しても並び順ごと残る */
  const order = store.anchors().map(x => x.id);
  const again = await open();
  assert.deepEqual(again.anchors().map(x => x.id), order);
});

await test('hue は 0,1,2 の順に配られ、4件目以降は null。空きは再利用される', async () => {
  const store = await open({ raw: null, now: NOW });

  const a = store.addAnchor('あ');
  const b = store.addAnchor('い');
  const c = store.addAnchor('う');
  const d = store.addAnchor('え');
  assert.deepEqual([a.hue, b.hue, c.hue], [0, 1, 2]);
  assert.equal(d.hue, null, '4件目以降は色を持たない');
  assert.equal(store.addAnchor('お').hue, null);

  /* まんなかの1件を消すと、その hue が空く */
  assert.equal(store.removeAnchor(b.id), true);
  const e = store.addAnchor('か');
  assert.equal(e.hue, 1, '空いた hue を再利用する');
  assert.deepEqual(store.anchors().map(x => x.hue), [0, 2, null, null, 1]);

  /* 並べ替えても hue は動かない（色は並び順では決まらない） */
  store.moveAnchor(e.id, -1);
  assert.equal(store.anchor(e.id).hue, 1);
  assert.equal(store.anchor(a.id).hue, 0);

  const again = await open();
  assert.equal(again.anchor(e.id).hue, 1, '開き直しても同じ');
});

await test('setAnchor / moveItemAnchor / clearAnchors と inAnchor の並び', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const B = store.addAnchor('風呂から出たら');

  const x = store.add('ヨガマットを敷く');            /* 海のまま */
  const y = store.add('ストレッチ', { today: true });
  const z = store.add('日記を書く');

  assert.equal(store.setAnchor(x.id, 'nosuch', true), false, '無いアンカーには付かない');
  assert.equal(store.setAnchor('nosuchid', A.id, true), false);

  /* わざと作成順と違う順にぶら下げる。並びは「ぶら下げた順」になるはず */
  assert.equal(store.setAnchor(z.id, A.id, true), true);
  assert.equal(store.setAnchor(x.id, A.id, true), true);
  assert.equal(store.setAnchor(y.id, A.id, true), true);
  assert.deepEqual(store.inAnchor(A.id).map(t => t.id), [z.id, x.id, y.id]);
  assert.equal(store.inAnchor(A.id)[0].id, z.id, '先頭が主役');

  /* 「今日する」かどうかは問わない */
  assert.equal(store.get(x.id).today, false);
  assert.ok(store.inAnchor(A.id).some(t => !t.today));

  /* トグル。1つの todo を複数のアンカーに置ける */
  assert.equal(store.setAnchor(x.id, B.id), true, 'on 省略でトグル');
  assert.deepEqual(store.anchorsOf(x.id), [A.id, B.id]);
  assert.equal(store.setAnchor(x.id, B.id, true), false, '同じ値なら false');

  /* 移動は増えない。移した先では末尾に付く */
  assert.equal(store.setAnchor(z.id, B.id, true), true);
  assert.deepEqual(store.inAnchor(B.id).map(t => t.id), [x.id, z.id]);
  assert.equal(store.moveItemAnchor(y.id, A.id, B.id), true);
  assert.deepEqual(store.anchorsOf(y.id), [B.id], '増えずに移る');
  assert.deepEqual(store.inAnchor(B.id).map(t => t.id), [x.id, z.id, y.id]);
  assert.deepEqual(store.inAnchor(A.id).map(t => t.id), [z.id, x.id]);
  assert.equal(store.moveItemAnchor(y.id, B.id, 'nosuch'), false);

  /* 全部外す */
  assert.equal(store.clearAnchors(x.id), true);
  assert.deepEqual(store.anchorsOf(x.id), []);
  assert.equal(store.clearAnchors(x.id), false, '外すものが無ければ false');
  assert.deepEqual(store.inAnchor(A.id).map(t => t.id), [z.id]);

  /* ぶら下げた順は保存され、開き直しても変わらない */
  const order = store.inAnchor(B.id).map(t => t.id);
  const again = await open();
  assert.deepEqual(again.inAnchor(B.id).map(t => t.id), order);
  /* 開き直したあとに足したものは末尾に付く */
  const w = again.add('あとから');
  again.setAnchor(w.id, B.id, true);
  assert.deepEqual(again.inAnchor(B.id).map(t => t.id), order.concat([w.id]));
});

await test('removeAnchor で todo の anchors と started から落ちる。ログは残る', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const B = store.addAnchor('風呂から出たら');
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setAnchor(t.id, A.id, true);
  store.setAnchor(t.id, B.id, true);
  assert.equal(store.start(t.id, A.id), true);
  assert.equal(store.start(t.id, B.id), true);
  assert.equal(store.totalStarted(), 2);

  assert.equal(store.removeAnchor(A.id), true);
  assert.deepEqual(store.anchorsOf(t.id), [B.id], 'ぶら下がりから落ちる');
  assert.equal(store.isStarted(t.id, A.id), false, 'はじめた印も落ちる');
  assert.equal(store.isStarted(t.id, B.id), true, '別のアンカーはそのまま');
  assert.deepEqual(store.inAnchor(A.id), []);

  /* ログは消さない。当時の名前で読める */
  assert.equal(store.totalStarted(), 2, 'ログは残る');
  const gone = store.log().find(e => e.slot === A.id);
  assert.equal(gone.slotName, '歯を磨いたら', '消したあとも当時の名前で読める');
  assert.equal(gone.text, 'ヨガマットを敷く');

  /* 集計には出ない（並べる先が無いため）。消えたわけではない */
  assert.deepEqual(store.startedByAnchor(1), [{ id: B.id, name: '風呂から出たら', n: 1 }]);

  /* 開き直しても、ぶら下がりは戻らないしログも消えない */
  const again = await open();
  assert.deepEqual(again.anchorsOf(t.id), [B.id]);
  assert.equal(again.totalStarted(), 2);
  assert.equal(again.log().find(e => e.slot === A.id).slotName, '歯を磨いたら');
});

await test('rollover は毎日リセット。setToday はアンカーの記録に触らない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setSlot(t.id, 'morning', true);
  store.setAnchor(t.id, A.id, true);
  store.start(t.id, A.id);

  /* setToday(false) は時間帯タグと「アンカー無しの記録」だけを消す */
  assert.equal(store.setToday(t.id, false), true);
  assert.deepEqual(store.slotsOf(t.id), [], '時間帯タグは消える');
  assert.equal(store.isStarted(t.id, A.id), true, 'アンカーでの記録は残る');
  assert.deepEqual(store.anchorsOf(t.id), [A.id], 'アンカーは残る');
  assert.equal(store.totalStarted(), 1, 'ログは残る');

  /* rollover は、アンカーでの記録も含めて毎日リセットする */
  store.setToday(t.id, true);
  store.setSlot(t.id, 'night', true);
  assert.equal(store.isStarted(t.id, A.id), true);

  setNow(ms(2026, 8, 21, 10, 0));
  /* 日付ごとに持つようになり、rollover は「戻す」ことをしなくなった（いつでも 0）。
     今日の海が空くのは、今日のキーを持つものが無くなるため */
  assert.equal(store.rollover(), 0);
  assert.equal(store.get(t.id).today, false);
  assert.deepEqual(store.slotsOf(t.id), [], '時間帯タグは日をまたいで消える');
  assert.equal(store.isStarted(t.id, A.id), false, 'はじめた記録は毎日リセット');
  assert.deepEqual(store.anchorsOf(t.id), [A.id], 'アンカーは日をまたいでも消えない');
  assert.deepEqual(store.inAnchor(A.id).map(x => x.id), [t.id]);
  assert.equal(store.totalStarted(), 1, 'ログは残る');
  setNow(NOW);

  /* 今日する枠の外でも、アンカーからは始められる（そして翌日リセットされる） */
  assert.equal(store.get(t.id).today, false);
  assert.equal(store.start(t.id, A.id), true, 'アンカーは today とは無関係');
  setNow(ms(2026, 8, 22, 10, 0));
  assert.equal(store.rollover(), 0, '海に戻すものは無い');
  assert.equal(store.isStarted(t.id, A.id), false, 'それでも記録はリセットされる');
  setNow(NOW);
});

await test('start(id, null) はアンカー無しで始めた記録になる', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('ヨガマットを敷く', { today: true });

  /* 画面1の「今日する」から直接。ぶら下がっていなくても始められる */
  assert.deepEqual(store.anchorsOf(t.id), []);
  assert.equal(store.isStarted(t.id, null), false);
  assert.equal(store.startedAt(t.id, null), null);
  assert.equal(store.start(t.id, null), true);
  assert.equal(store.isStarted(t.id, null), true);
  assert.equal(store.startedAt(t.id, null), NOW);
  assert.equal(store.start(t.id, null), false, '二重 start は false');
  assert.deepEqual(store.log(), [
    { id: t.id, text: 'ヨガマットを敷く', slot: null, slotName: '', at: NOW },
  ]);

  /* アンカーからの着手とは別枠。両方立てられる */
  store.setAnchor(t.id, A.id, true);
  assert.equal(store.isStarted(t.id, A.id), false);
  assert.equal(store.start(t.id, A.id), true);
  assert.equal(store.isStarted(t.id, null), true);
  assert.equal(store.totalStarted(), 2);

  /* 集計。アンカー無しは末尾に来る */
  assert.deepEqual(store.startedByAnchor(1), [
    { id: A.id, name: '歯を磨いたら', n: 1 },
    { id: null, name: 'アンカー無し', n: 1 },
  ]);

  /* 取り消しも null で通る。消えるのはアンカー無しのぶんだけ */
  assert.equal(store.unstart(t.id, null), true);
  assert.equal(store.isStarted(t.id, null), false);
  assert.equal(store.isStarted(t.id, A.id), true);
  assert.equal(store.unstart(t.id, null), false, '二重の取り消しは false');
  assert.deepEqual(store.startedByAnchor(1), [{ id: A.id, name: '歯を磨いたら', n: 1 }],
    '0件なら「アンカー無し」の行は出ない');

  /* 保存され、開き直しても残る */
  assert.equal(store.start(t.id, null), true);
  const again = await open();
  assert.equal(again.isStarted(t.id, null), true);
  assert.equal(again.startedAt(t.id, null), NOW);

  /* 「今日する」から外しても、アンカー無しの記録は残る（追補3 §6）。
     落ちるのは時間帯タグだけ */
  const beforeToday = again.totalStarted();
  assert.equal(again.setToday(t.id, false), true);
  assert.equal(again.isStarted(t.id, null), true, '外しても印は残る');
  assert.equal(again.startedAt(t.id, null), NOW);

  /* 印が残っているので、もう一度押しても2件目は積まれない */
  assert.equal(again.start(t.id, null), false, '既に着手済みなので false');
  assert.equal(again.totalStarted(), beforeToday, 'ログも増えない');

  /* today:false のまま保存の往復をしても、記録は残る */
  const third = await open();
  assert.equal(third.get(t.id).today, false);
  assert.equal(third.isStarted(t.id, null), true, '読み込みで落とされない');
  assert.equal(third.startedAt(t.id, null), NOW);
});

/* 「今日する」に入れていなくても、どこに置いてあるものでも着手は記録できる。
   置き場所（海／すきま／きっかけの未分類）は「いつやるか」の軸で、
   「もう始めた」という事実とは別なので、記録の可否には効かない */
await test('海・すきま・きっかけの未分類、どこにあっても start(id, null) が通る', async () => {
  const store = await open({ raw: null, now: NOW });

  /* 海（未分類）。today:false / gap:false / anchors:[] */
  const sea = store.add('積んである本を開く');
  assert.equal(sea.today, false);
  assert.equal(store.isGap(sea.id), false);
  assert.deepEqual(store.anchorsOf(sea.id), []);
  assert.equal(store.isStarted(sea.id, null), false);
  assert.equal(store.start(sea.id, null), true, '海のものでも記録できる');
  assert.equal(store.isStarted(sea.id, null), true);
  assert.equal(store.startedAt(sea.id, null), NOW);
  assert.equal(store.start(sea.id, null), false, '二重 start は false');

  /* すきま時間だけに入れたもの（gap:true、枠にも入れてみる） */
  const gap = store.add('耳で聞く');
  store.setGap(gap.id, true);
  store.setGapSlot(gap.id, 'ears');
  assert.equal(store.get(gap.id).today, false);
  assert.equal(store.start(gap.id, null), true, 'すきま時間のものでも記録できる');
  assert.equal(store.isStarted(gap.id, null), true);

  /* きっかけの未分類（plan:true でアンカーにはぶら下がっていない） */
  const plan = store.add('やり方を調べる');
  store.setPlan(plan.id, true);
  assert.deepEqual(store.anchorsOf(plan.id), []);
  assert.equal(store.start(plan.id, null), true, 'きっかけの未分類でも記録できる');
  assert.equal(store.isStarted(plan.id, null), true);

  /* ログの形は変わらない。アンカー無しは slot:null / slotName:'' */
  assert.deepEqual(store.log().map(e => ({ id: e.id, slot: e.slot, slotName: e.slotName })), [
    { id: sea.id, slot: null, slotName: '' },
    { id: gap.id, slot: null, slotName: '' },
    { id: plan.id, slot: null, slotName: '' },
  ]);

  /* 集計。アンカーが1つも無いので「アンカー無し」の行だけが出る */
  assert.deepEqual(store.startedByAnchor(1), [{ id: null, name: 'アンカー無し', n: 3 }]);
  assert.equal(store.startedCount(1), 3);

  /* 取り消しも対称に効く。ログも1件減る */
  assert.equal(store.unstart(gap.id, null), true);
  assert.equal(store.isStarted(gap.id, null), false);
  assert.equal(store.startedAt(gap.id, null), null);
  assert.equal(store.unstart(gap.id, null), false, '二重の取り消しは false');
  assert.deepEqual(store.startedByAnchor(1), [{ id: null, name: 'アンカー無し', n: 2 }]);

  /* 保存の往復でも残る（today:false のまま） */
  const again = await open();
  assert.equal(again.get(sea.id).today, false);
  assert.equal(again.isStarted(sea.id, null), true);
  assert.equal(again.isStarted(plan.id, null), true);
  assert.equal(again.isStarted(gap.id, null), false);
});

await test('今日する枠の外で始めた記録も rollover で落ちる', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const sea = store.add('積んである本を開く');
  const gap = store.add('耳で聞く');
  store.setGap(gap.id, true);
  assert.equal(store.start(sea.id, null), true);
  assert.equal(store.start(gap.id, null), true);

  setNow(ms(2026, 8, 21, 10, 0));
  assert.equal(store.rollover(), 0, '今日する枠には誰も居ないので海へ戻すものは無い');
  assert.equal(store.isStarted(sea.id, null), false, 'はじめた記録は毎日リセット');
  assert.equal(store.isStarted(gap.id, null), false);
  assert.equal(store.startedAt(sea.id, null), null);
  assert.equal(store.isGap(gap.id), true, 'すきま時間は日をまたいでも消えない');
  assert.equal(store.totalStarted(), 2, 'ログは残る');

  /* 落ちたあとは、また始められる */
  assert.equal(store.start(sea.id, null), true);
  assert.equal(store.totalStarted(), 3);
  setNow(NOW);
});

await test('startedByAnchor はいまの並び順・いまの名前。ログは当時の名前のまま', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const B = store.addAnchor('風呂から出たら');
  const a = store.add('あ', { today: true });
  const b = store.add('い', { today: true });
  store.setAnchor(a.id, A.id, true);
  store.setAnchor(b.id, B.id, true);
  store.start(a.id, A.id);
  store.start(b.id, B.id);

  assert.deepEqual(store.startedByAnchor(7), [
    { id: A.id, name: '歯を磨いたら', n: 1 },
    { id: B.id, name: '風呂から出たら', n: 1 },
  ]);

  /* 並べ替えると集計の並びも変わる */
  assert.equal(store.moveAnchor(B.id, -1), true);
  assert.deepEqual(store.startedByAnchor(7).map(r => r.id), [B.id, A.id]);

  /* 改名すると集計はいまの名前になる。ログは記録した時点の名前のまま */
  assert.equal(store.renameAnchor(A.id, '歯みがきのあと'), true);
  assert.deepEqual(store.startedByAnchor(7), [
    { id: B.id, name: '風呂から出たら', n: 1 },
    { id: A.id, name: '歯みがきのあと', n: 1 },
  ]);
  assert.equal(store.log().find(e => e.slot === A.id).slotName, '歯を磨いたら',
    '過去の記録は当時の名前で読める');

  /* 記録の無いアンカーも n:0 で並ぶ（棒グラフに穴を開けないため） */
  const C = store.addAnchor('駅に着いたら');
  assert.deepEqual(store.startedByAnchor(7).map(r => r.n), [1, 1, 0]);
  assert.equal(store.startedByAnchor(7)[2].id, C.id);

  /* 期間の外は数えない */
  setNow(ms(2026, 9, 20, 10, 0));
  assert.deepEqual(store.startedByAnchor(7).map(r => r.n), [0, 0, 0]);
  setNow(NOW);
});

/* ============================================================ */

await test('きっかけにぶら下げたものは海に浮かばない', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const a = store.add('ヨガマットを敷く');
  const b = store.add('灯油を買う');
  assert.equal(store.floating().length, 2);

  store.setAnchor(a.id, A.id, true);
  assert.equal(store.floating().length, 1, 'ぶら下げたら海から消える');
  assert.ok(!store.floating().some(t => t.id === a.id));
  assert.equal(store.count(), 2, 'todo 自体は消えない');
  assert.deepEqual(store.inAnchor(A.id).map(t => t.id), [a.id]);

  /* 外すと海へ戻る */
  store.setAnchor(a.id, A.id, false);
  assert.equal(store.floating().length, 2, '外すと海へ戻る');

  /* アンカーごと消しても海へ戻る */
  store.setAnchor(a.id, A.id, true);
  assert.equal(store.floating().length, 1);
  store.removeAnchor(A.id);
  assert.equal(store.floating().length, 2, 'きっかけを消したら海へ戻る');
});

/* ============================================================ */
/* 完了 */

/* 追補3 §3 で complete() の意味が変わった。消さずに done を立てて完了の海へ移す。
   ログに何も積まないところ（＝ふりかえりに出るのは着手だけ）は従来どおり */
await test('complete() は項目を消さず done を立てる。ログには何も積まない', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('皿を洗う', { today: true });
  const other = store.add('残るもの');
  store.setAnchor(t.id, A.id, true);
  assert.equal(store.start(t.id, A.id), true);
  assert.equal(store.totalStarted(), 1, '着手のログは1件積まれている');

  const before = store.log();
  const got = store.complete(t.id);

  assert.ok(got, '戻り値は項目そのもの');
  assert.equal(got.id, t.id);
  assert.equal(got.done, true);
  assert.equal(store.isDone(t.id), true);
  assert.ok(store.get(t.id), '項目は消えない');
  assert.equal(store.count(), 2);
  assert.deepEqual(store.all().map(x => x.id), [t.id, other.id], 'all() には出る');
  assert.deepEqual(store.doneItems().map(x => x.id), [t.id], '完了の海に出る');

  /* 完了はどのログにも積まれない。着手のログは事実なのでそのまま残る */
  assert.equal(store.totalStarted(), 1, '完了でログは増えない');
  assert.deepEqual(store.log(), before, '着手のログは1文字も変わらない');
  assert.deepEqual(store.startedByAnchor(1), [{ id: A.id, name: '歯を磨いたら', n: 1 }]);
  assert.equal(store.todayedCount(30), 1, '「今日するに入れた」記録も増減しない');

  /* 保存にも書かれていて、開き直しても完了のまま */
  const again = await open();
  assert.equal(again.isDone(t.id), true);
  assert.equal(again.totalStarted(), 1);
  assert.deepEqual(again.doneItems().map(x => x.id), [t.id]);

  /* 無い id は null。二度押しても増えない */
  assert.equal(store.complete('nosuch'), null);
  assert.equal(store.complete(t.id).id, t.id, '既に完了なら、そのまま返す');
  assert.deepEqual(store.doneItems().map(x => x.id), [t.id]);
});

await test('complete() → restore() の旧経路も、uncomplete() も元どおりに戻す', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ');
  const t = store.add('い', { today: true });
  const c = store.add('う');
  store.setFirstStep(t.id, '袖をまくる');
  store.setUrl(t.id, 'https://example.com/x');
  store.setSlot(t.id, 'noon', true);
  store.setGapSlot(t.id, 'ears');

  const snap = store.complete(t.id);
  assert.deepEqual(store.all().map(x => x.id), [a.id, t.id, c.id], '並びは動かない');
  assert.deepEqual(store.todays(), [], '今日からは消える');
  assert.equal(store.inGapSlot('ears'), null, 'すきまの枠からも消える');
  assert.deepEqual(store.gapItems(), []);

  /* 画面側の取り消しは store.restore() を呼ぶ。complete() の戻り値でも通る */
  assert.equal(store.restore(snap), true);
  assert.equal(store.isDone(t.id), false);
  assert.deepEqual(store.all().map(x => x.id), [a.id, t.id, c.id], '並び位置も動かない');
  assert.equal(store.get(t.id).today, true);
  assert.deepEqual(store.slotsOf(t.id), ['noon']);
  assert.equal(store.firstStepOf(t.id), '袖をまくる');
  assert.equal(store.urlOf(t.id), 'https://example.com/x');
  assert.equal(store.isGap(t.id), true);
  assert.equal(store.gapSlotOf(t.id), 'ears');
  assert.equal(store.inGapSlot('ears').id, t.id);

  /* uncomplete() でも同じところへ戻る */
  store.complete(t.id);
  assert.equal(store.uncomplete(t.id), true);
  assert.equal(store.isDone(t.id), false);
  assert.equal(store.inGapSlot('ears').id, t.id);
  assert.equal(store.uncomplete(t.id), false, '完了していなければ false');
  assert.equal(store.uncomplete('nosuch'), false);

  /* 保存にも書き戻る */
  store.complete(t.id);
  const again = await open();
  assert.equal(again.isDone(t.id), true);
  assert.equal(again.gapSlotOf(t.id), 'ears', '枠は覚えたまま');
  assert.equal(again.uncomplete(t.id), true);
  assert.equal(again.inGapSlot('ears').id, t.id, '出せば枠に戻る');
});

await test('消している間に枠が埋まったら、戻ってきたほうが未分類へ回る', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('先に入れたもの');
  const u = store.add('あとから入れたもの');
  store.setGapSlot(t.id, 'screen');

  const snap = store.complete(t.id);
  assert.equal(store.setGapSlot(u.id, 'screen').pushedOut, null, '空いた枠なので押し出さない');

  assert.equal(store.restore(snap), true);
  assert.equal(store.get(t.id).id, t.id, '項目そのものは戻る');
  assert.equal(store.inGapSlot('screen').id, u.id, 'いま置かれているほうを押しのけない');
  assert.equal(store.gapSlotOf(t.id), null);
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [t.id], '戻ったほうは未分類へ');
});

/* ============================================================ */
/* すきま時間の枠 */

await test('GAP_SLOTS は固定4値。既定は未分類で、枠に入れると gap も立つ', async () => {
  const store = await open({ raw: null, now: NOW });
  assert.deepEqual(store.GAP_SLOTS, ['ears', 'ears_off', 'screen', 'screen_off']);

  const t = store.add('落語を聴く');
  assert.equal(store.get(t.id).gapSlot, null, '既定は未分類');
  assert.equal(store.gapSlotOf(t.id), null);
  assert.equal(store.isGap(t.id), false);
  store.GAP_SLOTS.forEach(s => assert.equal(store.inGapSlot(s), null, s + ' は空'));

  /* 枠へ入れると、すきま時間の印も一緒に立つ */
  assert.deepEqual(store.setGapSlot(t.id, 'ears'), { pushedOut: null });
  assert.equal(store.isGap(t.id), true, 'gap:false なら true にする');
  assert.equal(store.gapSlotOf(t.id), 'ears');
  assert.equal(store.inGapSlot('ears').id, t.id);
  assert.equal(store.inGapSlot('ears_off'), null, '似た名前の枠に漏れない');
  assert.deepEqual(store.gapItems().map(x => x.id), [t.id]);
  assert.deepEqual(store.gapUnsorted(), [], '枠に入ったので未分類ではない');

  /* 枠から枠へ。移動であって追加ではない（1件が入れるのは1枠だけ） */
  assert.deepEqual(store.setGapSlot(t.id, 'screen_off'), { pushedOut: null });
  assert.equal(store.gapSlotOf(t.id), 'screen_off');
  assert.equal(store.inGapSlot('ears'), null, '元の枠は空く');

  /* null で未分類へ。すきま時間からは外れない */
  assert.deepEqual(store.setGapSlot(t.id, null), { pushedOut: null });
  assert.equal(store.gapSlotOf(t.id), null);
  assert.equal(store.isGap(t.id), true, '未分類も「すきま時間」の中');
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [t.id]);

  /* 保存され、開き直しても残る */
  store.setGapSlot(t.id, 'screen');
  const again = await open();
  assert.equal(again.gapSlotOf(t.id), 'screen');
  assert.equal(again.inGapSlot('screen').id, t.id);
});

await test('埋まっている枠へ入れると、古いほうが黙って未分類へ移る', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 20, 9, 0) });
  const a = store.add('先客');
  setNow(ms(2026, 8, 20, 9, 10));
  const b = store.add('あとから');
  setNow(ms(2026, 8, 20, 9, 20));
  const c = store.add('さらにあとから');
  setNow(NOW);

  store.setGapSlot(a.id, 'ears');

  /* 断らない。古いほうを押し出して入る */
  assert.deepEqual(store.setGapSlot(b.id, 'ears'), { pushedOut: a.id });
  assert.equal(store.inGapSlot('ears').id, b.id, '新しいほうが枠に入る');
  assert.equal(store.gapSlotOf(a.id), null, '古いほうは未分類へ');
  assert.equal(store.isGap(a.id), true, '押し出されてもすきま時間からは外れない');
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [a.id]);

  /* もう一度押し出す。今度は b が未分類へ落ち、未分類は作成順に並ぶ */
  assert.deepEqual(store.setGapSlot(c.id, 'ears'), { pushedOut: b.id });
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [a.id, b.id], '未分類は作成順');
  assert.equal(store.inGapSlot('ears').id, c.id);

  /* 既に自分が入っている枠に入れ直しても、自分を押し出さない */
  assert.deepEqual(store.setGapSlot(c.id, 'ears'), { pushedOut: null });
  assert.equal(store.inGapSlot('ears').id, c.id);

  /* 別の枠は巻き込まない */
  assert.deepEqual(store.setGapSlot(a.id, 'screen'), { pushedOut: null });
  assert.equal(store.inGapSlot('ears').id, c.id);
  assert.equal(store.inGapSlot('screen').id, a.id);
});

await test('setGapSlot の門前払いと、変化したときだけの通知', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('あ');

  /* 無い id / 不正な slot。形は同じまま、何も起きない */
  assert.deepEqual(store.setGapSlot('nosuch', 'ears'), { pushedOut: null });
  assert.equal(store.inGapSlot('ears'), null);
  assert.deepEqual(store.setGapSlot(t.id, 'morning'), { pushedOut: null }, '時間帯タグの値は通さない');
  assert.deepEqual(store.setGapSlot(t.id, 'EARS'), { pushedOut: null });
  assert.deepEqual(store.setGapSlot(t.id, 1), { pushedOut: null });
  assert.equal(store.isGap(t.id), false, '弾いたときは gap も立てない');
  assert.equal(store.gapSlotOf(t.id), null);

  /* 不正な枠を聞かれても落ちない */
  assert.equal(store.inGapSlot('morning'), null);
  assert.equal(store.inGapSlot(null), null, 'null は「未分類の枠」ではない');
  assert.equal(store.gapSlotOf('nosuch'), null);

  /* 変わったときだけ通知する */
  let n = 0;
  const off = store.on(() => n++);
  store.setGapSlot(t.id, 'ears');
  assert.equal(n, 1);
  store.setGapSlot(t.id, 'ears');
  assert.equal(n, 1, '同じ枠へ入れ直しても通知しない');
  store.setGapSlot(t.id, null);
  assert.equal(n, 2);
  off();
});

await test('setGap(id,false) で枠も空く。rollover は枠に触らない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const t = store.add('podcast を聴く', { today: true });
  store.setSlot(t.id, 'morning', true);
  store.setGapSlot(t.id, 'ears_off');
  assert.equal(store.inGapSlot('ears_off').id, t.id);

  /* すきま時間から外すと枠も空く（today と slots の関係と同じ） */
  assert.equal(store.setGap(t.id, false), true);
  assert.equal(store.gapSlotOf(t.id), null);
  assert.equal(store.get(t.id).gapSlot, null);
  assert.equal(store.inGapSlot('ears_off'), null);
  assert.deepEqual(store.gapUnsorted(), []);

  /* 印を付け直しても枠は戻らない（未分類から始まる） */
  assert.equal(store.setGap(t.id, true), true);
  assert.equal(store.gapSlotOf(t.id), null);

  /* 日をまたいでも枠は残る。落ちるのは today と slots だけ */
  store.setGapSlot(t.id, 'screen');
  setNow(ms(2026, 8, 21, 10, 0));
  /* 日付ごとに持つようになり、rollover は「戻す」ことをしなくなった（いつでも 0）。
     今日の海が空くのは、今日のキーを持つものが無くなるため */
  assert.equal(store.rollover(), 0);
  assert.equal(store.get(t.id).today, false);
  assert.deepEqual(store.slotsOf(t.id), []);
  assert.equal(store.gapSlotOf(t.id), 'screen', 'すきま時間の枠は日をまたいでも消えない');
  assert.equal(store.inGapSlot('screen').id, t.id);
  setNow(NOW);
});

await test('gapSlot の無い旧データを読んでも壊れず、未分類から始まる', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3, gap: true },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4, slots: ['noon'] },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.count(), 2);
  ['a', 'b'].forEach(id => {
    assert.equal(store.get(id).gapSlot, null, id);
    assert.equal(store.gapSlotOf(id), null, id);
  });
  assert.equal(store.isGap('a'), true, 'gap の印は従来どおり読める');
  assert.deepEqual(store.gapUnsorted().map(t => t.id), ['a'], 'gap:true は未分類として出る');
  store.GAP_SLOTS.forEach(s => assert.equal(store.inGapSlot(s), null));

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const old = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.equal(old.gapSlotOf('z'), null);
  assert.deepEqual(old.gapUnsorted(), []);

  /* 壊れた値・gap:false なのに枠を持つデータは未分類に直す。
     同じ枠を名乗るものが2件あったら、先頭だけ残す */
  const odd = await open({ raw: {
    v: 2,
    todos: [
      { id: 'p', text: 'ぴ', createdAt: ms(2026, 8, 19, 9, 0), gap: true, gapSlot: 'nosuch' },
      { id: 'q', text: 'きゅ', createdAt: ms(2026, 8, 19, 9, 1), gap: false, gapSlot: 'ears' },
      { id: 'r', text: 'る', createdAt: ms(2026, 8, 19, 9, 2), gap: true, gapSlot: 'screen' },
      { id: 's', text: 'す', createdAt: ms(2026, 8, 19, 9, 3), gap: true, gapSlot: 'screen' },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.equal(odd.gapSlotOf('p'), null, '知らない枠の値は未分類へ');
  assert.equal(odd.gapSlotOf('q'), null, 'gap:false なら枠は持たない');
  assert.equal(odd.isGap('q'), false);
  assert.equal(odd.inGapSlot('ears'), null);
  assert.equal(odd.gapSlotOf('r'), 'screen', '同じ枠の2件は先頭だけ残る');
  assert.equal(odd.gapSlotOf('s'), null);
  assert.equal(odd.inGapSlot('screen').id, 'r');
  assert.deepEqual(odd.gapUnsorted().map(t => t.id), ['p', 's'], '溢れたぶんは未分類で見える');
});

/* ============================================================ */
/* きっかけの画面の未分類 */

await test('setPlan / isPlan と planUnsorted。アンカーが付けば外れる', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 20, 9, 0) });
  const A = store.addAnchor('歯を磨いたら');
  const a = store.add('いちばん古い');
  setNow(ms(2026, 8, 20, 9, 10));
  const b = store.add('まんなか');
  setNow(ms(2026, 8, 20, 9, 20));
  const c = store.add('印を付けないもの');
  setNow(NOW);

  assert.equal(store.isPlan(a.id), false, '既定は false');
  assert.equal(store.get(a.id).plan, false);
  assert.deepEqual(store.planUnsorted(), [], '既定では空');

  /* わざと新しいほうから印を付ける。戻りは作成順になるはず */
  assert.equal(store.setPlan(b.id, true), true);
  assert.equal(store.setPlan(a.id, true), true);
  assert.equal(store.setPlan(a.id, true), false, '同じ値では書き込まない');
  assert.equal(store.isPlan(a.id), true);
  assert.deepEqual(store.planUnsorted().map(t => t.id), [a.id, b.id], '作成順（createdAt 昇順）');
  assert.equal(store.planUnsorted().indexOf(store.get(c.id)), -1, '印の無いものは入らない');

  /* アンカーに付くと未分類から外れる。印そのものは落とさない
     （所属は「追加」であって「移動」ではない） */
  assert.equal(store.setAnchor(a.id, A.id, true), true);
  assert.deepEqual(store.planUnsorted().map(t => t.id), [b.id], 'ぶら下がったら未分類から外れる');
  assert.equal(store.isPlan(a.id), true, 'plan の印は落ちない');
  assert.deepEqual(store.inAnchor(A.id).map(t => t.id), [a.id]);

  /* 外すと未分類へ戻る（印が残っているので拾い直せる） */
  assert.equal(store.setAnchor(a.id, A.id, false), true);
  assert.deepEqual(store.planUnsorted().map(t => t.id), [a.id, b.id], '外すと未分類へ戻る');

  /* トグルと、無い id */
  assert.equal(store.setPlan(b.id), true, 'on を省くとトグル');
  assert.equal(store.isPlan(b.id), false);
  assert.deepEqual(store.planUnsorted().map(t => t.id), [a.id]);
  assert.equal(store.isPlan('nosuch'), false);
  assert.equal(store.setPlan('nosuch', true), false);

  /* 戻り値は毎回作り直した配列 */
  const copy = store.planUnsorted();
  copy.length = 0;
  assert.deepEqual(store.planUnsorted().map(t => t.id), [a.id]);
});

await test('きっかけの画面へ入れたものは海に浮かばない', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ'), b = store.add('い');
  assert.equal(store.floating().length, 2);

  store.setPlan(b.id, true);
  assert.equal(store.floating().length, 1, '海から消える');
  assert.ok(!store.floating().some(t => t.id === b.id), 'きっかけの未分類が海に二重に出ない');
  assert.equal(store.count(), 2, 'todo 自体は消えない');
  assert.deepEqual(store.planUnsorted().map(t => t.id), [b.id]);

  /* 外すと海へ戻る。位置も保たれている */
  const fx = store.get(b.id).fx;
  store.setPlan(b.id, false);
  assert.equal(store.floating().length, 2, '海へ戻る');
  assert.equal(store.get(b.id).fx, fx, '漂う位置は保たれる');

  /* すきま時間・今日する と同時に持てる（所属は独立した軸） */
  store.setPlan(a.id, true);
  store.setGap(a.id, true);
  store.setToday(a.id, true);
  assert.equal(store.isPlan(a.id), true);
  assert.equal(store.isGap(a.id), true);
  assert.equal(store.get(a.id).today, true);
  assert.deepEqual(store.planUnsorted().map(t => t.id), [a.id]);
  assert.deepEqual(store.gapItems().map(t => t.id), [a.id]);
});

await test('plan は保存の往復・restore・rollover で保たれる', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setPlan(t.id, true);

  /* 保存され、開き直しても残る */
  const again = await open();
  assert.equal(again.isPlan(t.id), true);
  assert.equal(again.get(t.id).plan, true);
  assert.deepEqual(again.planUnsorted().map(x => x.id), [t.id]);
  assert.equal(saved().todos[0].plan, true, '保存データにも書かれている');

  /* remove / complete → restore で失われない */
  const snap = again.complete(t.id);
  assert.deepEqual(again.planUnsorted(), []);
  assert.equal(again.restore(snap), true);
  assert.equal(again.isPlan(t.id), true);
  assert.deepEqual(again.planUnsorted().map(x => x.id), [t.id]);

  /* 日をまたいでも残る。落ちるのは today と slots だけ */
  again.setSlot(t.id, 'morning', true);
  setNow(ms(2026, 8, 21, 10, 0));
  assert.equal(again.rollover(), 0);
  assert.equal(again.get(t.id).today, false);
  assert.deepEqual(again.slotsOf(t.id), []);
  assert.equal(again.isPlan(t.id), true, 'きっかけの画面の印は日をまたいでも消えない');
  assert.deepEqual(again.planUnsorted().map(x => x.id), [t.id]);
  setNow(NOW);
});

await test('plan の無い旧データを読んでも壊れず、false から始まる', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3 },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4, slots: ['noon'] },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.count(), 2);
  ['a', 'b'].forEach(id => {
    assert.equal(store.get(id).plan, false, id);
    assert.equal(store.isPlan(id), false, id);
  });
  assert.deepEqual(store.planUnsorted(), []);
  assert.deepEqual(store.floating().map(t => t.id), ['a'], '海の中身は従来どおり');

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const old = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.equal(old.isPlan('z'), false);
  assert.deepEqual(old.planUnsorted(), []);

  /* 真偽でない値が入っていても真偽に直る */
  const odd = await open({ raw: {
    v: 2,
    todos: [{ id: 'p', text: 'ぴ', createdAt: ms(2026, 8, 19, 9, 0), plan: 'yes' }],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.equal(odd.get('p').plan, true);
  assert.equal(odd.isPlan('p'), true);
});

/* ============================================================ */
/* 一手の記録（steps）と書きかけ（draft） */

await test('commitStep は1件積み、next があれば「開始の１手」になる', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('確定申告をする');

  assert.deepEqual(store.stepsOf(t.id), [], '既定は空');
  assert.equal(store.lastStep(t.id), null);
  assert.equal(store.firstStepOf(t.id), '');

  const s1 = store.commitStep(t.id, { did: '  領収書を箱から出した  ', next: '  日付で仕分ける  ' });
  assert.deepEqual(s1, { at: NOW, did: '領収書を箱から出した', next: '日付で仕分ける' },
    '前後の空白は落ちる');
  assert.deepEqual(store.stepsOf(t.id), [s1], '1件だけ積まれる');
  assert.deepEqual(store.lastStep(t.id), s1);
  assert.equal(store.firstStepOf(t.id), '日付で仕分ける', 'next が「開始の１手」になる');

  /* 2件目。上書きではなく積み上がる */
  setNow(ms(2026, 8, 20, 11, 0));
  const s2 = store.commitStep(t.id, { did: '日付で仕分けた', next: '交通費を合計する' });
  assert.deepEqual(store.stepsOf(t.id).map(e => e.did), ['領収書を箱から出した', '日付で仕分けた'],
    '古い順に積み上がる');
  assert.equal(store.stepsOf(t.id)[0].at, NOW, '古いほうの at は動かない');
  assert.equal(s2.at, ms(2026, 8, 20, 11, 0));
  assert.deepEqual(store.lastStep(t.id), s2, '直近は新しいほう');
  assert.equal(store.firstStepOf(t.id), '交通費を合計する', '「開始の１手」は入れ替わる');
  setNow(NOW);

  /* 記録には「次の一手」が要る（git のコミットが必ず次を指すのと同じ）。
     did だけでは積めない。next だけなら積める。 */
  const only = store.add('片方だけ');
  assert.equal(store.commitStep(only.id, { did: '本文だけ書いた' }), null,
    'next が無ければ積めない');
  assert.deepEqual(store.stepsOf(only.id), [], '1件も積まれない');
  assert.equal(store.firstStepOf(only.id), '', '「開始の１手」にも触らない');

  assert.ok(store.commitStep(only.id, { next: 'つぎの一手' }),
    'did が空でも next があれば積める');
  assert.equal(store.stepsOf(only.id).length, 1);
  assert.equal(store.stepsOf(only.id)[0].did, '', 'did は空のまま');
  assert.equal(store.firstStepOf(only.id), 'つぎの一手');

  /* 戻り値も stepsOf もコピー。外から触っても中身が壊れない */
  const copy = store.stepsOf(t.id);
  copy.push({ at: NOW, did: 'x', next: 'x' });
  copy[0].did = '書き換え';
  s1.did = '書き換え';
  assert.equal(store.stepsOf(t.id).length, 2);
  assert.equal(store.stepsOf(t.id)[0].did, '領収書を箱から出した');

  /* 無い id は null */
  assert.equal(store.commitStep('nosuch', { did: 'あ', next: 'い' }), null);
  assert.deepEqual(store.stepsOf('nosuch'), []);
  assert.equal(store.lastStep('nosuch'), null);
});

await test('next が空なら何も積まず null（記録には次の一手が要る）', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('あ');
  store.setFirstStep(t.id, 'もとの一手');

  [undefined, {}, { did: '', next: '' }, { did: '   ', next: '  ' },
    { did: null, next: null },
    /* 「今回なにをしてたか」だけ書いても、次の一手が無ければ積まない */
    { did: '本文だけ書いた', next: '' }, { did: '本文だけ書いた' }].forEach((arg, i) => {
    assert.equal(store.commitStep(t.id, arg), null, 'next が空なら null: ' + i);
  });
  assert.deepEqual(store.stepsOf(t.id), [], '1件も積まれない');
  assert.equal(store.firstStepOf(t.id), 'もとの一手', '「開始の１手」にも触らない');

  /* 弾いたときは通知もしない */
  let n = 0;
  const off = store.on(() => n++);
  assert.equal(store.commitStep(t.id, { did: '  ', next: '' }), null);
  assert.equal(n, 0);
  assert.ok(store.commitStep(t.id, { did: '書いた', next: 'つぎ' }));
  assert.equal(n, 1, '積んだときは通知する');
  off();
});

await test('commitStep は書きかけを消す', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('原稿を書く');

  assert.equal(store.setDraft(t.id, { did: '書きかけの本文', next: '書きかけの次' }), true);
  assert.deepEqual(store.draftOf(t.id), { did: '書きかけの本文', next: '書きかけの次' });

  store.commitStep(t.id, { did: '見出しを決めた', next: '書き出しを書く' });
  assert.deepEqual(store.draftOf(t.id), { did: '', next: '' }, '記録したら下書きは空になる');
  assert.deepEqual(store.get(t.id).draft, { did: '', next: '' });

  /* 積んだ記録のほうは残っている */
  assert.deepEqual(store.lastStep(t.id),
    { at: NOW, did: '見出しを決めた', next: '書き出しを書く' });

  /* 開き直しても下書きは空のまま */
  const again = await open();
  assert.deepEqual(again.draftOf(t.id), { did: '', next: '' });
  assert.equal(again.stepsOf(t.id).length, 1);
});

await test('amendLastStep は直近の did だけを直す。記録が無ければ false', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('部屋を片づける');

  assert.equal(store.amendLastStep(t.id, { did: 'あ' }), false, '記録が無ければ false');
  assert.deepEqual(store.stepsOf(t.id), [], '積まれもしない');
  assert.equal(store.amendLastStep('nosuch', { did: 'あ' }), false, '無い id も false');

  store.commitStep(t.id, { did: '本棚を片づけた', next: '机を片づける' });
  setNow(ms(2026, 8, 20, 11, 0));
  store.commitStep(t.id, { did: '机を片づけあ', next: '床を片づける' });
  setNow(ms(2026, 8, 20, 12, 0));      /* 直したあとに at が動いていないことを見るため */

  assert.equal(store.amendLastStep(t.id, { did: '机を片づけた' }), true);
  const list = store.stepsOf(t.id);
  assert.equal(list.length, 2, '件数は増えない');
  assert.equal(list[1].did, '机を片づけた', '直近の did だけ直る');
  assert.equal(list[1].at, ms(2026, 8, 20, 11, 0), 'at は変わらない');
  assert.equal(list[1].next, '床を片づける', 'next は変わらない');
  assert.equal(list[0].did, '本棚を片づけた', '古いほうは触らない');
  assert.equal(store.firstStepOf(t.id), '床を片づける', '「開始の１手」も変わらない');

  /* 前後の空白は落ちる。空にもできる。同じ値なら書き込まずに true */
  assert.equal(store.amendLastStep(t.id, { did: '  机を拭いた  ' }), true);
  assert.equal(store.lastStep(t.id).did, '机を拭いた');
  let n = 0;
  const off = store.on(() => n++);
  assert.equal(store.amendLastStep(t.id, { did: '机を拭いた' }), true, '同じ値でも true');
  assert.equal(n, 0, '書き込みは起きない');
  assert.equal(store.amendLastStep(t.id, { did: '' }), true, '空にもできる');
  assert.equal(n, 1);
  assert.equal(store.lastStep(t.id).did, '');
  off();

  /* 保存され、開き直しても直ったまま */
  store.amendLastStep(t.id, { did: '机を片づけた' });
  const again = await open();
  assert.equal(again.stepsOf(t.id).length, 2);
  assert.equal(again.lastStep(t.id).did, '机を片づけた');
  assert.equal(again.lastStep(t.id).at, ms(2026, 8, 20, 11, 0));
  setNow(NOW);
});

await test('setDraft / draftOf の往復。空白は落ち、開き直しても残る', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('メールを書く');

  assert.deepEqual(store.draftOf(t.id), { did: '', next: '' }, '既定は空');
  assert.deepEqual(store.draftOf('nosuch'), { did: '', next: '' }, '無い id でも落ちない');
  assert.equal(store.setDraft('nosuch', { did: 'あ' }), false);

  assert.equal(store.setDraft(t.id, { did: '  下書き中  ', next: '  つぎ  ' }), true);
  assert.deepEqual(store.draftOf(t.id), { did: '下書き中', next: 'つぎ' });
  assert.equal(store.setDraft(t.id, { did: '下書き中', next: 'つぎ' }), false, '同じ値なら false');
  assert.equal(store.setDraft(t.id, { did: '下書き中' }), true, '片方だけ渡すと片方は空になる');
  assert.deepEqual(store.draftOf(t.id), { did: '下書き中', next: '' });
  assert.equal(store.setDraft(t.id), true, '引数を省くと空に戻る');
  assert.deepEqual(store.draftOf(t.id), { did: '', next: '' });

  /* 下書きは記録ではない。steps も「開始の１手」も増えない */
  store.setDraft(t.id, { did: '書きかけ', next: '書きかけの次' });
  assert.deepEqual(store.stepsOf(t.id), [], '下書きだけでは1件も積まれない');
  assert.equal(store.firstStepOf(t.id), '', '「開始の１手」にもならない');

  /* 戻り値はコピー */
  const d = store.draftOf(t.id);
  d.did = '書き換え';
  assert.equal(store.draftOf(t.id).did, '書きかけ');

  /* 閉じて開き直しても、書きかけがそのまま入っている */
  const again = await open();
  assert.deepEqual(again.draftOf(t.id), { did: '書きかけ', next: '書きかけの次' });
  assert.deepEqual(saved().todos[0].draft, { did: '書きかけ', next: '書きかけの次' },
    '保存データにも書かれている');
});

await test('rollover / setToday は steps と draft に触らない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const t = store.add('原稿を書く', { today: true });
  store.setSlot(t.id, 'morning', true);
  store.commitStep(t.id, { did: '見出しを決めた', next: '書き出しを書く' });
  store.setDraft(t.id, { did: '書きかけ', next: '書きかけの次' });

  /* 「今日する」から外しても残る */
  assert.equal(store.setToday(t.id, false), true);
  assert.equal(store.stepsOf(t.id).length, 1);
  assert.deepEqual(store.draftOf(t.id), { did: '書きかけ', next: '書きかけの次' });

  /* 日をまたいでも残る。落ちるのは today と slots と着手の印だけ */
  store.setToday(t.id, true);
  setNow(ms(2026, 8, 21, 10, 0));
  /* 日付ごとに持つようになり、rollover は「戻す」ことをしなくなった（いつでも 0）。
     今日の海が空くのは、今日のキーを持つものが無くなるため */
  assert.equal(store.rollover(), 0);
  assert.equal(store.get(t.id).today, false);
  assert.deepEqual(store.slotsOf(t.id), []);
  assert.deepEqual(store.stepsOf(t.id),
    [{ at: NOW, did: '見出しを決めた', next: '書き出しを書く' }], '一手の記録は日をまたいで残る');
  assert.deepEqual(store.draftOf(t.id), { did: '書きかけ', next: '書きかけの次' },
    '書きかけも消えない');
  assert.equal(store.firstStepOf(t.id), '書き出しを書く');
  setNow(NOW);
});

await test('steps / draft の無い旧データを読んでも壊れず、既定値が入る', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3 },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4, slots: ['noon'] },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.count(), 2);
  ['a', 'b'].forEach(id => {
    assert.deepEqual(store.get(id).steps, [], id);
    assert.deepEqual(store.get(id).draft, { did: '', next: '' }, id);
    assert.deepEqual(store.stepsOf(id), [], id);
    assert.equal(store.lastStep(id), null, id);
    assert.deepEqual(store.draftOf(id), { did: '', next: '' }, id);
  });
  /* 読んだあとも普通に積める */
  assert.ok(store.commitStep('a', { did: 'やった', next: 'つぎ' }));
  assert.equal(store.stepsOf('a').length, 1);

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const old = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.deepEqual(old.stepsOf('z'), []);
  assert.equal(old.lastStep('z'), null);
  assert.deepEqual(old.draftOf('z'), { did: '', next: '' });

  /* 壊れた値は既定値に倒し、壊れた行だけ落とす */
  const odd = await open({ raw: {
    v: 2,
    todos: [
      { id: 'p', text: 'ぴ', createdAt: ms(2026, 8, 19, 9, 0), steps: 'ちがう', draft: 'ちがう' },
      { id: 'q', text: 'きゅ', createdAt: ms(2026, 8, 19, 9, 1),
        steps: [
          { at: ms(2026, 8, 19, 10, 0), did: ' あ ', next: ' い ' },
          { did: '時刻が無い', next: 'x' },
          null,
          'ちがう',
          { at: 'ちがう', did: 'x' },
          { at: ms(2026, 8, 19, 11, 0), did: 5, next: undefined },
        ],
        draft: { did: '  下書き  ', next: 7 } },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.deepEqual(odd.stepsOf('p'), [], '配列でなければ空');
  assert.deepEqual(odd.draftOf('p'), { did: '', next: '' }, 'オブジェクトでなければ空');
  assert.deepEqual(odd.stepsOf('q'), [
    { at: ms(2026, 8, 19, 10, 0), did: 'あ', next: 'い' },
    { at: ms(2026, 8, 19, 11, 0), did: '5', next: '' },
  ], 'at の読めない行だけ落ちる');
  assert.deepEqual(odd.draftOf('q'), { did: '下書き', next: '7' });
});

await test('保存の往復で steps の順序と at が保たれる', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 20, 9, 0) });
  const t = store.add('長い作業');

  const times = [
    ms(2026, 8, 20, 9, 0), ms(2026, 8, 20, 9, 5),
    ms(2026, 8, 20, 9, 5),                        /* 同じミリ秒でも順は入れ替わらない */
    ms(2026, 8, 20, 8, 0),                        /* 時刻が戻っても積んだ順のまま */
    ms(2026, 8, 20, 10, 0),
  ];
  times.forEach((at, i) => {
    setNow(at);
    store.commitStep(t.id, { did: 'その' + i, next: 'つぎ' + i });
  });
  setNow(NOW);

  const want = times.map((at, i) => ({ at, did: 'その' + i, next: 'つぎ' + i }));
  assert.deepEqual(store.stepsOf(t.id), want);

  /* 保存データの中身も同じ並び */
  assert.deepEqual(saved().todos[0].steps, want);

  /* 開き直しても並びも at も変わらない */
  const again = await open();
  assert.deepEqual(again.stepsOf(t.id), want, '積んだ順のまま読める');
  assert.deepEqual(again.lastStep(t.id), want[want.length - 1]);
  assert.equal(again.firstStepOf(t.id), 'つぎ4');

  /* complete は消さないので、完了している間も一手の記録はそのまま読める */
  const snap = again.complete(t.id);
  assert.deepEqual(again.stepsOf(t.id), want, '完了しても記録は消えない');
  assert.equal(again.restore(snap), true);
  assert.equal(again.isDone(t.id), false);
  assert.deepEqual(again.stepsOf(t.id), want, '戻しても並びごと残る');
  again.setDraft(t.id, { did: '書きかけ', next: '' });
  const snap2 = again.remove(t.id);
  assert.equal(again.restore(snap2), true);
  assert.deepEqual(again.stepsOf(t.id), want);
  assert.deepEqual(again.draftOf(t.id), { did: '書きかけ', next: '' });
});

await test('一手の記録は log（はじめた記録）を1件も増やさない', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setAnchor(t.id, A.id, true);
  assert.equal(store.start(t.id, A.id), true);

  const before = store.log();
  const startedBefore = store.startedByAnchor(7);
  const byDayBefore = store.startedByDay(7);
  assert.equal(store.totalStarted(), 1);

  /* 積む・直す・下書き。どれも着手の記録には触らない */
  store.commitStep(t.id, { did: 'マットを出した', next: '5分だけ伸ばす' });
  setNow(ms(2026, 8, 20, 11, 0));
  store.commitStep(t.id, { did: '5分伸ばした', next: '次は10分' });
  setNow(NOW);
  store.amendLastStep(t.id, { did: '5分だけ伸ばした' });
  store.setDraft(t.id, { did: '書きかけ', next: '' });

  assert.equal(store.stepsOf(t.id).length, 2, '一手の記録のほうは積まれている');
  assert.equal(store.totalStarted(), 1, 'はじめた記録は増えない');
  assert.deepEqual(store.log(), before, 'log() は1文字も変わらない');
  assert.deepEqual(store.startedByAnchor(7), startedBefore);
  assert.deepEqual(store.startedByDay(7), byDayBefore);
  assert.equal(store.startedCount(7), 1);
  assert.equal(store.startedDays(7), 1);
  assert.equal(store.isStarted(t.id, A.id), true, '着手の印もそのまま');
  assert.equal(store.startedAt(t.id, A.id), NOW);
  assert.equal(store.todayedCount(7), 1, '「今日するに入れた」記録も増えない');

  /* 開き直しても同じ */
  const again = await open();
  assert.equal(again.totalStarted(), 1);
  assert.deepEqual(again.log(), before);
  assert.equal(again.stepsOf(t.id).length, 2);
});

/* ============================================================ */
/* タグ（海の面）と完了の海 — 追補3 §7 */

await test('特別なタグ5つが既定で立っていて、名前・向き・色を持つ', async () => {
  const store = await open({ raw: null, now: NOW });

  assert.deepEqual(store.TAG_SPECIAL, ['today', 'plan', 'gap', 'hold', 'done']);
  const tags = store.tags();
  assert.deepEqual(tags.map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private'], '特別なタグが先頭に並ぶ');
  assert.deepEqual(tags.map(t => t.special),
    [true, true, true, true, true, false, false], '特別なのは先頭5つだけ');
  assert.deepEqual(tags.map(t => t.name), ['今日', 'きっかけ', 'すきま', '長期保留', '完了', '仕事', 'プライベート']);
  /* 既定の向き（利用者の指示）:
     中央=すべて / 上=長期保留 / 下=完了（固有枠）/ 左=仕事 / 右=プライベート。
     今日・きっかけ・すきま は専用のタブがあるので、既定では海に置かない */
  assert.deepEqual(tags.map(t => t.dir),
    [null, null, null, 'up', 'down', 'left', 'right']);
  assert.equal(store.tagDir('left').id, 'work');
  /* 旧データでは「上」が完了だった。完了は下の固有枠へ移り、
     長期保留が「上」に入る（利用者の指示。移行はここで起きる） */
  assert.equal(store.tag('done').dir, 'down', '完了は下の固有枠');
  assert.equal(store.tagDir('down').id, 'done');
  assert.equal(store.tagDir('up').id, 'hold', '上は長期保留になる');
  assert.equal(store.tagDir('right').id, 'private');
  assert.equal(store.tagDir('nosuch'), null);
  assert.equal(store.tagDir(null), null);

  /* 色は実際の色文字列。無彩色は使わない（無彩色は「タグ無し」の意味） */
  tags.forEach(t => {
    assert.ok(/^#[0-9a-f]{6}$/.test(t.color), t.id + ' の色: ' + t.color);
    const [r, g, b] = [t.color.slice(1, 3), t.color.slice(3, 5), t.color.slice(5, 7)];
    assert.ok(!(r === g && g === b), t.id + ' は無彩色ではない');
  });

  /* 戻り値はコピー。並べ替えても中の順は動かない */
  tags.reverse();
  tags[0].name = '書き換え';
  assert.deepEqual(store.tags().map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private']);
  assert.equal(store.tags()[0].name, '今日');
  assert.equal(store.tag('today').name, '今日');
  assert.equal(store.tag('nosuch'), null);
});

await test('特別なタグは名前を変えられないし、消せない。色は変えられる', async () => {
  const store = await open({ raw: null, now: NOW });

  store.TAG_SPECIAL.forEach(id => {
    assert.equal(store.renameTag(id, 'あたらしい名前'), false, id + ' は改名できない');
    assert.equal(store.removeTag(id), false, id + ' は消せない');
  });
  assert.deepEqual(store.tags().map(t => t.name), ['今日', 'きっかけ', 'すきま', '長期保留', '完了', '仕事', 'プライベート']);
  assert.equal(store.tags().length, 7, '特別な5つと、最初から置いてある2つ');

  /* 色と向きはユーザーのもの */
  assert.equal(store.setTagColor('today', '#3f7ac0'), true);
  assert.equal(store.tag('today').color, '#3f7ac0');
  assert.equal(store.setTagColor('today', '#888888'), false, '無彩色は受け付けない');
  assert.equal(store.setTagColor('today', 'red'), false, '色名は受け付けない');
  assert.equal(store.setTagColor('today', ''), false);
  assert.equal(store.setTagColor('nosuch', '#3f7ac0'), false);
  assert.equal(store.tag('today').color, '#3f7ac0', '弾かれたので変わらない');

  /* 保存され、開き直しても残る */
  const again = await open();
  assert.equal(again.tag('today').color, '#3f7ac0');
  assert.deepEqual(again.tags().map(t => t.name), ['今日', 'きっかけ', 'すきま', '長期保留', '完了', '仕事', 'プライベート']);
});

await test('addTag / renameTag / removeTag。色は #rgb も通る', async () => {
  const store = await open({ raw: null, now: NOW });

  assert.equal(store.addTag(''), null, '空名は作らない');
  assert.equal(store.addTag('   '), null);
  assert.equal(store.addTag(null), null);
  assert.equal(store.tags().length, 7);

  const a = store.addTag('  読みもの  ', '#4a8');
  assert.equal(a.name, '読みもの', '前後の空白は落ちる');
  assert.equal(a.color, '#44aa88', '#rgb は #rrggbb に伸びる');
  assert.equal(a.special, false);
  assert.equal(a.dir, null, '向きは持たずに生まれる');

  const b = store.addTag('しごと');
  assert.ok(/^#[0-9a-f]{6}$/.test(b.color), '色を省くと配られる: ' + b.color);
  const c = store.addTag('からだ', '#777777');
  assert.notEqual(c.color, '#777777', '無彩色は受け付けず、配られた色になる');

  assert.deepEqual(store.tags().map(t => t.id),
    ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private', a.id, b.id, c.id],
    'ユーザーのタグは作った順で後ろに付く（最初から置いてある2つの後ろ）');

  /* 改名 */
  assert.equal(store.renameTag(a.id, '  読むもの '), true);
  assert.equal(store.tag(a.id).name, '読むもの');
  assert.equal(store.renameTag(a.id, ''), false, '空名は false');
  assert.equal(store.renameTag('nosuch', 'x'), false);
  assert.equal(store.tag(a.id).name, '読むもの');

  /* 消す */
  assert.equal(store.removeTag(b.id), true);
  assert.equal(store.tag(b.id), null);
  assert.equal(store.removeTag(b.id), false, '二度は消せない');
  assert.deepEqual(store.tags().map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private', a.id, c.id]);

  /* 保存され、開き直しても残る */
  const again = await open();
  assert.deepEqual(again.tags().map(t => t.name),
    ['今日', 'きっかけ', 'すきま', '長期保留', '完了', '仕事', 'プライベート', '読むもの', 'からだ']);
});

/* パレットは store の1か所にしか無い（設定画面も store.tagPalette() を読む）。
   ここで縛るのは「色の並び」ではなく、パレットが満たしていなければならない性質だけ。
   色そのものを直書きすると、色を振り直すたびにテストが落ちて意味が薄れる。 */
await test('tagPalette は無彩色を含まず、重複せず、配り先と設定画面の唯一の出どころ', async () => {
  const store = await open({ raw: null, now: NOW });

  const pal = store.tagPalette();
  assert.ok(Array.isArray(pal) && pal.length >= 6, '色が配れるだけの数がある: ' + pal.length);
  pal.forEach(c => assert.ok(/^#[0-9a-f]{6}$/.test(c), '#rrggbb にそろっている: ' + c));

  /* 無彩色（r=g=b）は「タグ無し」の意味なので、パレットに入っていてはいけない。
     入っていると setTagColor / addTag に弾かれて、配ったつもりの色が付かない */
  pal.forEach(c => {
    assert.notEqual(c.slice(1, 3) + c.slice(3, 5), c.slice(3, 5) + c.slice(5, 7), '無彩色: ' + c);
    assert.equal(store.setTagColor('today', c), true, 'タグの色として受け付ける: ' + c);
    assert.equal(store.tag('today').color, c);
  });

  assert.equal(new Set(pal).size, pal.length, '同じ色が2つ入っていない');

  /* 返るのはコピー。呼び手が壊しても内部は変わらない */
  pal[0] = '#000000';
  assert.notEqual(store.tagPalette()[0], '#000000');

  /* 色を省いて作ったタグは、このパレットから配られる */
  const fresh = await open({ raw: null, now: NOW });
  const made = [];
  for (let i = 0; i < fresh.tagPalette().length; i++) made.push(fresh.addTag('た' + i).color);
  made.forEach(c => assert.ok(fresh.tagPalette().indexOf(c) >= 0, '配り先はパレットの中: ' + c));

  /* 最初から置いてある2つも、別の色文字列を持たずパレットから取っている */
  const starters = fresh.tags().filter(t => t.id === 'work' || t.id === 'private');
  assert.equal(starters.length, 2);
  starters.forEach(t => assert.ok(fresh.tagPalette().indexOf(t.color) >= 0,
    t.name + ' の色もパレットの中: ' + t.color));
});

/* 11色（特別な5つ＋パレット6つ）が満たすべき性質を縛る。
   色そのものではなく、色を振り直しても守られていなければならない性質だけを見る。

   前の版は「1つの OKLCH 格子（L と C を全色そろえる）」を縛っていた。それはやめた。
   人の目の感度は色相で違うので、L と C を固定すると黄緑だけ浮き、青だけ沈む。
   代わりに縛るのは、パステルであること（帯の中に収まる）と、見分けが付くこと。

   ・L がパステルの帯（0.84〜0.95）に収まっている
   ・L が H80 の cusp（0.824）より上にある。cusp より下の琥珀は「淡くした金」ではなく
     「くすませた金」＝タン／カーキになり、そこだけ濁って見える（store.js の解説を見よ）
   ・C が無彩色（0.02 未満＝「タグ無し」の意味）にも、パステルを外れる濃さにも行かない
   ・どの2色も OKLab で離れている。**色覚特性のもとでも離れている**
     （バブルの色でしかタグを表さないので、見分けが付かなくなると情報が消える） */
await test('タグの11色はパステルの帯に収まり、色覚特性のもとでも見分けが付く', async () => {
  const store = await open({ raw: null, now: NOW });

  /* sRGB -> OKLab。外部依存を足さないためここに置く */
  const toLin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const toSrgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const chan = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

  function oklabOf(rgbLin) {
    const [r, g, b] = rgbLin;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  const oklab = hex => oklabOf(chan(hex).map(toLin));

  /* 色覚特性のシミュレーション（Machado, Oliveira & Fernandes 2009、程度 1.0）。
     線形 RGB に 3x3 を掛けるだけ。医学的な再現ではなく、
     「この2色は同じに見えうるか」を機械的に測るための道具として使う。 */
  const CVD = {
    '2型（deutan）': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    '1型（protan）': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    '3型（tritan）': [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  };
  const simulate = (hex, M) => {
    const c = chan(hex).map(toLin);
    const out = M.map(row => row[0] * c[0] + row[1] * c[1] + row[2] * c[2])
      .map(v => Math.min(1, Math.max(0, v)));
    /* 一度 sRGB へ丸めてから読み直す。画面に出るのは丸めたあとの色なので */
    const hex2 = '#' + out.map(v => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0')).join('');
    return oklab(hex2);
  };

  /* 特別な4つの既定色は、まっさらな store の tags() から読む */
  const colors = store.tags().filter(t => t.special).map(t => t.color)
    .concat(store.tagPalette());
  assert.equal(colors.length, 11, '特別な5つ＋パレット6つ');
  assert.equal(new Set(colors).size, 11, '同じ色が2つ入っていない');

  const labs = colors.map(oklab);
  const Ls = labs.map(v => v[0]);
  const Cs = labs.map(v => Math.hypot(v[1], v[2]));

  assert.ok(Math.min(...Ls) > 0.84 && Math.max(...Ls) < 0.95,
    'パステルの帯に収まっている: ' + Math.min(...Ls).toFixed(3) + '〜' + Math.max(...Ls).toFixed(3));

  /* H80（きっかけ）の cusp は 0.824。ここを割ると琥珀だけが濁る */
  assert.ok(Math.min(...Ls) > 0.83,
    'H80 の cusp（0.824）より上: ' + Math.min(...Ls).toFixed(3));

  /* 無彩色は「タグ無し」の意味なので、クロマは 0 であってはいけない。
     上限は「パステルを外れない」ところ */
  assert.ok(Math.min(...Cs) > 0.02, '無彩色に落ちていない: ' + Math.min(...Cs).toFixed(3));
  assert.ok(Math.max(...Cs) < 0.11, 'パステルを外れていない: ' + Math.max(...Cs).toFixed(3));

  const worstOf = (list) => {
    let d = Infinity;
    let pair = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const v = Math.hypot(
          list[i][0] - list[j][0], list[i][1] - list[j][1], list[i][2] - list[j][2]);
        if (v < d) { d = v; pair = [colors[i], colors[j]]; }
      }
    }
    return [d, pair];
  };

  /* いまの最小は 0.0390（完了 #cec8ff / 薄紫 #e0c4e7）。
     0.03 は「大きな面どうしなら確かに違って見える」あたりの下限として置いた床 */
  const [worst, pair] = worstOf(labs);
  assert.ok(worst > 0.03,
    '最小の色差: ' + worst.toFixed(4) + ' (' + pair.join(' / ') + ')');

  /* 色覚特性のもとでの最小色差。この床（0.02）が、パレットを差し替えた理由そのもの。
     前の版（L と C を全色そろえていたもの）はここで
     2型 0.0048 / 1型 0.0127 / 3型 0.0055 まで落ちていた。
     いまは 2型 0.0243 / 1型 0.0285 / 3型 0.0250。 */
  Object.keys(CVD).forEach(name => {
    const [d, p] = worstOf(colors.map(c => simulate(c, CVD[name])));
    assert.ok(d > 0.02,
      name + ' での最小の色差: ' + d.toFixed(4) + ' (' + p.join(' / ') + ')');
  });
});

/* パレットを差し替えたときの、保存済みデータの扱い。

   色を選ぶ口は画面のどこにも無い（設定のタグ行の点は見るだけ）。
   だから保存されている色は必ず「そのときのパレットが配った色」で、
   配り直してもユーザーの選択を踏み潰さない。
   これをしないと、前からあるタグだけ古い色のまま残り、新しく作ったタグと混ざる。 */
await test('パレットの世代が古い保存データは、開いたときに色を配り直す', async () => {
  const old = {
    v: 2,
    /* palVer が無い＝差し替え前の保存データ */
    tags: [
      { id: 'today', name: '今日', color: '#f7c9b0', dir: null },
      { id: 'plan', name: 'きっかけ', color: '#ead0a7', dir: null },
      { id: 'gap', name: 'すきま', color: '#abddf6', dir: null },
      { id: 'done', name: '完了', color: '#d3cefb', dir: 'up' },
      { id: 'work', name: '仕事', color: '#a4e1e4', dir: 'left' },
      { id: 'private', name: 'プライベート', color: '#fbc5c3', dir: 'right' },
      { id: 'read', name: '読みもの', color: '#d6d8aa', dir: null },
    ],
    todos: [], log: [], todayLog: [], lastDay: null,
  };
  const store = await open({ raw: old, now: NOW });

  const pal = store.tagPalette();
  assert.equal(store.tag('today').color, '#fdc09e', '特別なタグは既定の色に戻る');
  assert.equal(store.tag('plan').color, '#ffe8a4');
  assert.equal(store.tag('gap').color, '#a6e1fe');
  assert.equal(store.tag('hold').color, '#cec8ff');

  /* ユーザーのタグは「作られた順に頭から」。元の規則と同じなので、
     並びが変わらないかぎり各タグは同じ位置の新しい色に落ちる */
  assert.equal(store.tag('work').color, pal[0], '1つめは新しいパレットの1色目');
  assert.equal(store.tag('private').color, pal[1]);
  assert.equal(store.tag('read').color, pal[2]);

  /* 名前・向き・特別かどうかは触らない */
  assert.equal(store.tag('read').name, '読みもの');
  assert.equal(store.tagDir('left').id, 'work');
  assert.equal(store.tagDir('right').id, 'private');
  assert.equal(store.tagDir('up').id, 'hold', '上は長期保留');

  /* 世代は保存に書かれ、次に開いたときはもう配り直さない（＝一度きり） */
  assert.ok(Number(saved().palVer) > 0, '世代が保存される');
  const again = await open();
  assert.equal(again.tag('work').color, pal[0]);
  assert.equal(again.tag('read').color, pal[2]);
});

/* 保存に失敗したときに黙らない（B-4）。
   前は容量超過を握り潰していたので、書いたものが保存されていないのに
   画面はふつうに動き続け、次に開いたときだけ消えている、という壊れ方をした。 */
await test('保存に失敗したら、落ちずに、失敗したことを外へ出す', async () => {
  const store = await open({ raw: null, now: NOW });
  const seen = [];
  const off = store.onSaveError(e => seen.push(e));

  assert.equal(store.saveError(), null, 'はじめは失敗していない');

  /* 容量超過を起こす */
  const real = localStorage.setItem;
  const boom = new Error('QuotaExceededError');
  localStorage.setItem = () => { throw boom; };

  const t = store.add('保存できない項目');
  assert.ok(t, '保存に失敗しても操作そのものは通る');
  assert.equal(store.get(t.id).text, '保存できない項目', 'メモリ上には入っている');
  assert.deepEqual(seen, [boom], '失敗が1回通知される');
  assert.equal(store.saveError(), boom, '直近の失敗が読める');

  store.add('もう1件');
  assert.equal(seen.length, 2, '失敗のたびに通知される（黙らせるのは受け手の仕事）');

  /* 直ったら、失敗の印も消える */
  localStorage.setItem = real;
  store.add('保存できる項目');
  assert.equal(store.saveError(), null, '通ったら null に戻る');
  assert.equal(seen.length, 2, '成功では通知しない');

  off();
  localStorage.setItem = () => { throw boom; };
  store.add('解除したあと');
  assert.equal(seen.length, 2, '解除したら届かない');
  localStorage.setItem = real;
});

/* きっかけの日にち（利用者の指示）。

   数え方は「その月の n 回目のその曜日」。「2週目の火曜」＝ その月の2回目の火曜日。
   2026年9月は火曜が5回ある（1/8/15/22/29）ので、**4回目と最終が別の日**になる。
   ここが取り違えのいちばん起きやすいところなので、その月で確かめる。 */
await test('きっかけの日にち：第n曜日の数え方と「最終」', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.addAnchor('歯を磨いたら');

  /* 既定は毎日（days も weeks も空） */
  assert.deepEqual(store.anchorSchedule(a.id), { days: [], weeks: [] });
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 1, 10, 0)), true, '日にち無しは常にその日');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 4, 10, 0)), true);

  /* 毎週火曜（週を選ばない） */
  assert.equal(store.setAnchorSchedule(a.id, { days: [2] }), true);
  assert.deepEqual(store.anchorSchedule(a.id), { days: [2], weeks: [] });
  [1, 8, 15, 22, 29].forEach(d =>
    assert.equal(store.anchorDue(a.id, ms(2026, 9, d, 10, 0)), true, '9/' + d + ' は火曜'));
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 2, 10, 0)), false, '水曜は外れる');

  /* 第2火曜だけ */
  store.setAnchorSchedule(a.id, { days: [2], weeks: [2] });
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 8, 10, 0)), true, '2回目の火曜');
  [1, 15, 22, 29].forEach(d =>
    assert.equal(store.anchorDue(a.id, ms(2026, 9, d, 10, 0)), false, '9/' + d + ' は違う'));

  /* 4回目と「最終」は別物。9月は火曜が5回あるので、ここで割れる */
  store.setAnchorSchedule(a.id, { days: [2], weeks: [4] });
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 22, 10, 0)), true, '4回目は 9/22');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 29, 10, 0)), false, '9/29 は4回目ではない');

  store.setAnchorSchedule(a.id, { days: [2], weeks: [store.WEEK_LAST] });
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 29, 10, 0)), true, '最終は 9/29');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 22, 10, 0)), false, '9/22 は最終ではない');

  /* 火曜が4回しかない月なら、4回目と最終は同じ日を指す。
     2026年8月の火曜は 4/11/18/25 の4回 */
  assert.equal(new Date(2026, 7, 25).getDay(), 2, '前提：8/25 は火曜');
  store.setAnchorSchedule(a.id, { days: [2], weeks: [4] });
  assert.equal(store.anchorDue(a.id, ms(2026, 8, 25, 10, 0)), true);
  store.setAnchorSchedule(a.id, { days: [2], weeks: [store.WEEK_LAST] });
  assert.equal(store.anchorDue(a.id, ms(2026, 8, 25, 10, 0)), true, '4回しかなければ同じ日');

  /* 複数選べる。第1・第3の木曜 */
  store.setAnchorSchedule(a.id, { days: [4], weeks: [1, 3] });
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 3, 10, 0)), true, '1回目の木曜 9/3');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 17, 10, 0)), true, '3回目の木曜 9/17');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 10, 10, 0)), false, '2回目は外れる');
});

await test('きっかけの日にち：受け取らない値・境目・保存', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.addAnchor('風呂から出たら');

  /* 範囲外・重複・順不同は正規化される */
  store.setAnchorSchedule(a.id, { days: [7, -1, 3, 3, 1], weeks: [0, 9, 2, 2] });
  assert.deepEqual(store.anchorSchedule(a.id), { days: [1, 3], weeks: [2] });

  /* 曜日を選ばなければ、週は意味を持たないので落ちる */
  store.setAnchorSchedule(a.id, { days: [], weeks: [2, 3] });
  assert.deepEqual(store.anchorSchedule(a.id), { days: [], weeks: [] }, '週だけは残さない');

  /* 無いアンカーは false。ただし anchorDue は通す側へ倒す */
  assert.equal(store.setAnchorSchedule('nosuch', { days: [1] }), false);
  assert.equal(store.anchorDue('nosuch'), true, '知らない id は隠さない');

  /* 日の境目は 5時。月曜の午前1時は「日曜のぶん」 */
  store.setAnchorSchedule(a.id, { days: [0] });                 /* 日曜 */
  assert.equal(new Date(2026, 8, 6).getDay(), 0, '前提：9/6 は日曜');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 7, 1, 0)), true, '月曜1時は日曜のぶん');
  assert.equal(store.anchorDue(a.id, ms(2026, 9, 7, 6, 0)), false, '月曜6時はもう月曜');

  /* dueAnchors は並びを保ったまま、その日のものだけ返す */
  const b = store.addAnchor('コーヒーを淹れたら');            /* 日にち無し＝毎日 */
  const at = ms(2026, 9, 7, 10, 0);                            /* 月曜 */
  assert.deepEqual(store.dueAnchors(at).map(x => x.id), [b.id], '日曜のぶんは出ない');
  assert.deepEqual(store.anchors().map(x => x.id), [a.id, b.id], 'anchors() は全部返す');

  /* 保存の往復で残る */
  store.setAnchorSchedule(a.id, { days: [2, 5], weeks: [1, store.WEEK_LAST] });
  const again = await open();
  assert.deepEqual(again.anchorSchedule(a.id), { days: [2, 5], weeks: [1, 5] });
  assert.deepEqual(again.anchorSchedule(b.id), { days: [], weeks: [] });
});

/* 今日の海を日付ごとに持つ（利用者の指示）。

   前は t.today という真偽値ひとつで、rollover が毎朝それを全部落としていた。
   いまは t.days（'YYYY-MM-DD' の配列）が本体で、today はそこから作る控え。
   **「持ち越さない」は保たれている**——明日の海が空なのは、
   明日のキーを持つものがまだ無いからで、勝手に運ばれることはない。 */
await test('日付ごとの海：置く・外す・日をまたぐ', async () => {
  const store = await open({ raw: null, now: NOW });          /* 2026-08-20 10:00 */
  const t = store.add('積んである本を開く');

  assert.equal(store.todayKey(), '2026-08-20');
  assert.deepEqual(store.daysOf(t.id), [], '作った直後はどの日にも置かれていない');

  store.setToday(t.id, true);
  assert.deepEqual(store.daysOf(t.id), ['2026-08-20']);
  assert.equal(store.get(t.id).today, true, 'today は days から作った控え');
  assert.deepEqual(store.todays().map(x => x.id), [t.id]);
  assert.deepEqual(store.itemsOnDay('2026-08-20').map(x => x.id), [t.id]);

  /* 未来の日に置ける。今日の海は変わらない */
  assert.equal(store.setDay(t.id, '2026-08-22', true), true);
  assert.deepEqual(store.daysOf(t.id), ['2026-08-20', '2026-08-22'], '古い順にそろう');
  assert.deepEqual(store.itemsOnDay('2026-08-22').map(x => x.id), [t.id]);
  assert.deepEqual(store.itemsOnDay('2026-08-21'), [], '間の日は空');

  /* 日をまたぐ。**昨日ぶんは消えない**。今日の海は空 */
  setNow(ms(2026, 8, 21, 10, 0));
  store.rollover();
  assert.deepEqual(store.todays(), [], '今日の海は空（持ち越さない）');
  assert.equal(store.get(t.id).today, false);
  assert.deepEqual(store.daysOf(t.id), ['2026-08-20', '2026-08-22'], '置いた日は残る');
  assert.deepEqual(store.itemsOnDay('2026-08-20').map(x => x.id), [t.id], '昨日を遡れる');

  /* 未来の日になったら、自然に今日の海へ出てくる */
  setNow(ms(2026, 8, 22, 10, 0));
  store.rollover();
  assert.deepEqual(store.todays().map(x => x.id), [t.id], '置いておいた日が来た');
  assert.equal(store.get(t.id).today, true);

  /* 外す */
  assert.equal(store.setDay(t.id, '2026-08-22', false), true);
  assert.deepEqual(store.todays(), []);
  assert.deepEqual(store.daysOf(t.id), ['2026-08-20'], '外すのはその日だけ');
  setNow(NOW);
});

await test('日付ごとの海：受け取らない値・完了・墓石・保存', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('置くもの', { today: true });
  const d = store.add('終わったもの', { today: true });

  /* 変な日付は受け取らない。同じ状態を入れ直しても書かない */
  assert.equal(store.setDay(t.id, '2026-8-1', true), false, '桁が違う');
  assert.equal(store.setDay(t.id, 'きのう', true), false);
  assert.equal(store.setDay('nosuch', '2026-08-21', true), false);
  assert.equal(store.setDay(t.id, '2026-08-20', true), false, 'すでにその状態');

  /* 完了したものは今日の海からは外れるが、**その日の記録には残る**
     （過去はその日にあったものの記録なので、済ませたぶんを抜くと欠ける） */
  store.complete(d.id);
  assert.deepEqual(store.todays().map(x => x.id), [t.id], '今日の海からは外れる');
  assert.deepEqual(store.itemsOnDay('2026-08-20').map(x => x.id).sort(),
    [t.id, d.id].sort(), 'その日の記録には残る');

  /* 消したもの（墓石）は、どの日からも見えない */
  store.remove(t.id);
  assert.deepEqual(store.itemsOnDay('2026-08-20').map(x => x.id), [d.id]);

  /* 保存の往復で残る */
  const again = await open();
  assert.deepEqual(again.daysOf(d.id), ['2026-08-20']);
  assert.deepEqual(again.itemsOnDay('2026-08-20').map(x => x.id), [d.id]);
});

await test('日付ごとの海：today しか持たない旧データを読む', async () => {
  /* 保存されていた lastDay の日に置いてあったものとして移す */
  const store = await open({ raw: {
    v: 2, lastDay: '2026-08-19',
    todos: [
      { id: 'a', text: '昨日の今日', today: true, createdAt: ms(2026, 8, 19, 9, 0) },
      { id: 'b', text: '海にいたもの', today: false, createdAt: ms(2026, 8, 19, 9, 0) },
    ],
    log: [], todayLog: [],
  }, now: NOW });                                    /* いまは 2026-08-20 */

  assert.deepEqual(store.daysOf('a'), ['2026-08-19'], 'lastDay の日へ移る');
  assert.deepEqual(store.daysOf('b'), []);
  assert.deepEqual(store.todays(), [], '昨日ぶんは今日の海に出てこない');
  assert.deepEqual(store.itemsOnDay('2026-08-19').map(x => x.id), ['a'], '昨日として遡れる');
});

await test('setTagDir は1向き1タグ。既に居たタグは null へ押し出される', async () => {
  const store = await open({ raw: null, now: NOW });
  const mine = store.addTag('読みもの', '#4a8');

  /* 既定では left は「仕事」 */
  assert.equal(store.tagDir('left').id, 'work');
  assert.equal(store.setTagDir(mine.id, 'left'), true);
  assert.equal(store.tagDir('left').id, mine.id, '新しいほうが入る');
  assert.equal(store.tag('work').dir, null, '居たほうは null へ押し出される');
  assert.equal(store.tag(mine.id).dir, 'left');

  /* 押し出されるのは同じ向きだけ。ほかの向きは巻き込まない */
  assert.equal(store.tag('hold').dir, 'up', '上は長期保留（利用者の指示）');
  assert.equal(store.tag('private').dir, 'right');

  /* null でどの向きにも置かない状態に戻せる */
  assert.equal(store.setTagDir(mine.id, null), true);
  assert.equal(store.tagDir('left'), null, '空いたままで、押し出されたタグは戻らない');
  assert.equal(store.tag(mine.id).dir, null);

  /* **上下は固有枠**（利用者の指示）。上=長期保留 / 下=完了。
     どちらも動かせないし、外せないし、ほかのタグに横取りされない */
  assert.equal(store.tagDirFixed('hold'), 'up');
  assert.equal(store.tagDirFixed('done'), 'down');
  assert.equal(store.tagDirFixed(mine.id), null, 'ふつうのタグは固定されない');

  [['hold', 'up'], ['done', 'down']].forEach(([tid, dir]) => {
    assert.equal(store.tag(tid).dir, dir);
    assert.equal(store.tagDir(dir).id, tid);
    assert.equal(store.setTagDir(tid, 'right'), false, tid + ' は動かせない');
    assert.equal(store.setTagDir(tid, null), false, tid + ' は外せない');
    assert.equal(store.tag(tid).dir, dir, 'どちらも弾かれて変わらない');
    assert.equal(store.setTagDir(mine.id, dir), false, dir + ' は選べない');
    assert.equal(store.tagDir(dir).id, tid, '横取りされない');
  });
  assert.equal(store.tagDir('right').id, 'private', '押し出しも起きない');

  /* 不正な向き・無いタグ */
  assert.equal(store.setTagDir(mine.id, 'LEFT'), false);
  assert.equal(store.setTagDir('nosuch', 'left'), false);
  assert.equal(store.tagDir('left'), null, '弾かれたので空いたまま');

  /* 保存され、開き直しても向きはそのまま（外した null も残る） */
  assert.equal(store.setTagDir(mine.id, 'left'), true);
  const again = await open();
  assert.equal(again.tagDir('left').id, mine.id);
  assert.equal(again.tag('work').dir, null, '押し出された状態が保たれる');
  assert.equal(again.tag('hold').dir, 'up', '上は固有枠のまま');
  assert.equal(again.tag('done').dir, 'down', '下も固有枠のまま');
});

await test('特別なタグの setTag は既存のフラグに委ねる（二重の状態を持たない）', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('皿を洗う');

  assert.deepEqual(store.tagsOf(t.id), [], '既定はどのタグも付いていない');
  assert.deepEqual(store.tagsOf('nosuch'), []);

  /* タグ → フラグ */
  assert.equal(store.setTag(t.id, 'today', true), true);
  assert.equal(store.get(t.id).today, true, 'today のフラグが立つ');
  assert.deepEqual(store.todays().map(x => x.id), [t.id]);
  assert.equal(store.setTag(t.id, 'gap', true), true);
  assert.equal(store.isGap(t.id), true);
  assert.equal(store.setTag(t.id, 'plan', true), true);
  assert.equal(store.isPlan(t.id), true);
  assert.deepEqual(store.tagsOf(t.id), ['today', 'plan', 'gap'], '並びは tags() と同じ');

  /* フラグ → タグ（逆向きも一致する） */
  const u = store.add('本を返す');
  store.setToday(u.id, true);
  assert.deepEqual(store.tagsOf(u.id), ['today']);
  store.setGap(u.id, true);
  store.setPlan(u.id, true);
  assert.deepEqual(store.tagsOf(u.id), ['today', 'plan', 'gap']);
  store.setToday(u.id, false);
  assert.deepEqual(store.tagsOf(u.id), ['plan', 'gap'], '外したタグは消える');

  /* 外すのも委ねる。on を省くとトグル */
  assert.equal(store.setTag(t.id, 'today', false), true);
  assert.equal(store.get(t.id).today, false);
  assert.equal(store.setTag(t.id, 'today', false), false, '変化しなければ false');
  assert.equal(store.setTag(t.id, 'gap'), true, 'on 省略でトグル');
  assert.equal(store.isGap(t.id), false);

  /* 保存データには特別なタグの id を書かない（状態は既存のフラグ側にしかない） */
  store.setTag(t.id, 'today', true);
  const row = saved().todos.find(x => x.id === t.id);
  assert.deepEqual(row.tags, [], '項目の tags に特別なタグは入らない');
  assert.equal(row.today, true, '状態は today フラグだけが持つ');

  /* 無い id / 無いタグ */
  assert.equal(store.setTag('nosuch', 'today', true), false);
  assert.equal(store.setTag(t.id, 'nosuchtag', true), false);
});

await test("特別なタグ 'done' の setTag は完了に委ねる", async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('確定申告をする', { today: true });

  assert.equal(store.setTag(t.id, 'done', true), true);
  assert.equal(store.isDone(t.id), true, 'done のフラグが立つ');
  assert.deepEqual(store.tagsOf(t.id), ['today', 'done'], 'ほかのタグは残っている');
  assert.deepEqual(store.doneItems().map(x => x.id), [t.id]);
  assert.equal(store.setTag(t.id, 'done', true), false, '既に完了なら false');

  assert.equal(store.setTag(t.id, 'done', false), true);
  assert.equal(store.isDone(t.id), false);
  assert.deepEqual(store.tagsOf(t.id), ['today'], '完了を外すと元の場所へ戻る');

  /* complete() 側から立てても、タグとして読める（同じ状態を1か所で持っている） */
  store.complete(t.id);
  assert.deepEqual(store.tagsOf(t.id), ['today', 'done']);
  store.uncomplete(t.id);
  assert.deepEqual(store.tagsOf(t.id), ['today']);
});

await test('ユーザーのタグは項目に付け外しでき、inTag で引ける', async () => {
  const store = await open({ raw: null, now: NOW });
  const read = store.addTag('読みもの', '#4a8');
  const body = store.addTag('からだ', '#c65f6b');
  const a = store.add('積んである本を開く');
  const b = store.add('ストレッチ');

  assert.deepEqual(store.inTag(read.id), [], '既定は空');
  assert.equal(store.setTag(a.id, read.id, true), true);
  assert.equal(store.setTag(a.id, read.id, true), false, '同じ値なら false');
  assert.equal(store.setTag(b.id, body.id, true), true);
  assert.deepEqual(store.tagsOf(a.id), [read.id]);
  assert.deepEqual(store.inTag(read.id).map(x => x.id), [a.id]);
  assert.deepEqual(store.inTag(body.id).map(x => x.id), [b.id]);
  assert.deepEqual(store.inTag('nosuch'), []);

  /* 1件に複数のタグを付けられる。特別なタグとも混ざる */
  assert.equal(store.setTag(a.id, body.id, true), true);
  store.setToday(a.id, true);
  assert.deepEqual(store.tagsOf(a.id), ['today', read.id, body.id]);
  assert.deepEqual(store.inTag(body.id).map(x => x.id), [a.id, b.id]);
  assert.deepEqual(store.inTag('today').map(x => x.id), [a.id]);

  /* トグルと外し */
  assert.equal(store.setTag(a.id, read.id), true, 'on 省略でトグル');
  assert.deepEqual(store.tagsOf(a.id), ['today', body.id]);
  assert.deepEqual(store.inTag(read.id), []);

  /* 完了したものはタグの海には出さない（完了の海にだけ出す） */
  store.complete(b.id);
  assert.deepEqual(store.inTag(body.id).map(x => x.id), [a.id]);
  assert.deepEqual(store.tagsOf(b.id), ['done', body.id], 'タグ自体は付いたまま');
  assert.deepEqual(store.inTag('done'), [], "完了の海は doneItems() で読む");

  /* 保存され、開き直しても残る */
  const again = await open();
  assert.deepEqual(again.tagsOf(a.id), ['today', body.id]);
  assert.deepEqual(again.inTag(body.id).map(x => x.id), [a.id]);
});

await test('ユーザーのタグを消すと、項目からはタグだけが外れる（項目は残る）', async () => {
  const store = await open({ raw: null, now: NOW });
  const read = store.addTag('読みもの', '#4a8');
  const body = store.addTag('からだ', '#c65f6b');
  const a = store.add('積んである本を開く');
  const b = store.add('ストレッチ');
  store.setTag(a.id, read.id, true);
  store.setTag(a.id, body.id, true);
  store.setTag(b.id, read.id, true);
  store.setToday(b.id, true);

  assert.equal(store.removeTag(read.id), true);
  assert.equal(store.count(), 2, '項目は消えない');
  assert.deepEqual(store.all().map(x => x.id), [a.id, b.id]);
  assert.deepEqual(store.tagsOf(a.id), [body.id], '消したタグだけが外れる');
  assert.deepEqual(store.tagsOf(b.id), ['today'], 'ほかのタグは残る');
  assert.deepEqual(store.inTag(read.id), []);
  assert.deepEqual(store.inTag(body.id).map(x => x.id), [a.id]);

  /* 保存にも書かれている */
  assert.deepEqual(saved().todos.map(t => t.tags), [[body.id], []]);
  const again = await open();
  assert.deepEqual(again.tagsOf(a.id), [body.id]);
  assert.equal(again.count(), 2);
});

await test('完了したものは「いま生きているもの」の問い合わせから全部外れる', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('皿を洗う', { today: true });
  const keep = store.add('残るもの', { today: true });
  store.setSlot(t.id, 'noon', true);
  store.setAnchor(t.id, A.id, true);
  store.setPlan(t.id, true);
  store.setGapSlot(t.id, 'ears');

  assert.deepEqual(store.todays().map(x => x.id), [t.id, keep.id]);
  assert.deepEqual(store.inSlot('noon').map(x => x.id), [t.id]);
  assert.deepEqual(store.unslotted().map(x => x.id), [keep.id]);
  assert.deepEqual(store.inAnchor(A.id).map(x => x.id), [t.id]);
  assert.deepEqual(store.gapItems().map(x => x.id), [t.id]);
  assert.equal(store.inGapSlot('ears').id, t.id);

  store.complete(t.id);

  assert.deepEqual(store.todays().map(x => x.id), [keep.id], 'today から消える');
  assert.deepEqual(store.inSlot('noon'), [], '時間帯の枠から消える');
  assert.deepEqual(store.unslotted().map(x => x.id), [keep.id]);
  assert.deepEqual(store.inAnchor(A.id), [], 'きっかけの枠から消える');
  assert.deepEqual(store.gapItems(), [], 'すきまから消える');
  assert.equal(store.inGapSlot('ears'), null, 'すきまの枠から消える');
  assert.deepEqual(store.gapUnsorted(), []);
  assert.deepEqual(store.floating(), [], '海にも出てこない');

  /* きっかけの未分類からも消える */
  store.setAnchor(t.id, A.id, false);
  assert.deepEqual(store.planUnsorted(), [], 'きっかけの未分類からも消える');

  /* all() と count() には出る（消えていないので） */
  assert.deepEqual(store.all().map(x => x.id), [t.id, keep.id]);
  assert.equal(store.count(), 2);

  /* 海に漂っていたものも同じ */
  const sea = store.add('海のもの');
  assert.deepEqual(store.floating().map(x => x.id), [sea.id]);
  store.complete(sea.id);
  assert.deepEqual(store.floating(), [], '海から消える');
  assert.equal(store.isDone(sea.id), true);
});

await test('doneItems は新しい順。doneCount は期間で数える', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' },
    now: ms(2026, 8, 18, 10) });
  const a = store.add('あ'), b = store.add('い'), c = store.add('う');

  assert.deepEqual(store.doneItems(), []);
  assert.equal(store.doneCount(30), 0);

  store.complete(a.id);                       /* 8/18 */
  setNow(ms(2026, 8, 20, 9, 0));
  store.complete(b.id);                       /* 8/20 */
  setNow(ms(2026, 8, 20, 10, 0));
  store.complete(c.id);                       /* 8/20 */

  assert.deepEqual(store.doneItems().map(x => x.id), [c.id, b.id, a.id], '新しい順');
  assert.equal(store.doneCount(1), 2, '今日ぶんは2件');
  assert.equal(store.doneCount(7), 3);
  assert.equal(store.doneCount(0), 0);

  /* 取り消したら完了の海から出る */
  assert.equal(store.uncomplete(b.id), true);
  assert.deepEqual(store.doneItems().map(x => x.id), [c.id, a.id]);
  assert.equal(store.doneCount(7), 2);

  /* 期間の外は数えない */
  setNow(ms(2026, 9, 20, 10, 0));
  assert.equal(store.doneCount(7), 0);
  assert.deepEqual(store.doneItems().map(x => x.id), [c.id, a.id], '並びは残る');
  setNow(NOW);

  /* 戻り値は毎回作り直した配列 */
  const copy = store.doneItems();
  copy.reverse();
  assert.deepEqual(store.doneItems().map(x => x.id), [c.id, a.id]);
});

await test('setToday(id,false) はアンカー無しの着手印を落とさない（追補3 §6）', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const t = store.add('積んである本を開く');

  /* 海で「はじめた」 → 今日へ入れる → 今日から外す */
  assert.equal(store.start(t.id, null), true);
  assert.equal(store.totalStarted(), 1);
  assert.equal(store.setToday(t.id, true), true);
  assert.equal(store.isStarted(t.id, null), true);
  assert.equal(store.setToday(t.id, false), true);

  assert.equal(store.isStarted(t.id, null), true, '印が残る');
  assert.equal(store.startedAt(t.id, null), NOW);
  assert.equal(store.start(t.id, null), false, 'もう一度押しても2件目は積まれない');
  assert.equal(store.totalStarted(), 1, 'ログも1件のまま');

  /* 落ちるのは時間帯タグだけ。保存の往復でも残る */
  store.setToday(t.id, true);
  store.setSlot(t.id, 'morning', true);
  store.setToday(t.id, false);
  assert.deepEqual(store.slotsOf(t.id), [], '時間帯タグは today と一緒に消える');
  const again = await open();
  assert.equal(again.isStarted(t.id, null), true);

  /* 日をまたげば従来どおりリセットされる（消えるのは rollover のときだけ） */
  setNow(ms(2026, 8, 21, 10, 0));
  again.rollover();
  assert.equal(again.isStarted(t.id, null), false, 'rollover では落ちる');
  setNow(NOW);
});

await test('rollover は tags / done に触らない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const mine = store.addTag('読みもの', '#4a8');
  const t = store.add('積んである本を開く', { today: true });
  const d = store.add('終わったもの', { today: true });
  store.setTag(t.id, mine.id, true);
  store.setSlot(t.id, 'morning', true);
  store.complete(d.id);

  setNow(ms(2026, 8, 21, 10, 0));
  assert.equal(store.rollover(), 0, 'もう戻さない（日付ごとに残る）');
  assert.equal(store.get(t.id).today, false);
  assert.deepEqual(store.slotsOf(t.id), []);
  assert.deepEqual(store.tagsOf(t.id), [mine.id], 'ユーザーのタグは日をまたいでも残る');
  assert.equal(store.isDone(d.id), true, '完了は日をまたいでも解けない');
  assert.deepEqual(store.doneItems().map(x => x.id), [d.id]);
  assert.equal(store.get(d.id).today, false,
    '完了したものの today も落ちる（取り消したときに古い「今日」を復活させないため）');
  assert.deepEqual(store.tags().map(x => x.id),
    ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private', mine.id], 'タグの一覧も変わらない');
  setNow(NOW);
});

await test('タグと完了は log（はじめた記録）の形を変えない', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setAnchor(t.id, A.id, true);
  assert.equal(store.start(t.id, A.id), true);

  const before = store.log();
  const byAnchorBefore = store.startedByAnchor(7);
  const byDayBefore = store.startedByDay(7);

  const mine = store.addTag('からだ', '#c65f6b');
  store.setTag(t.id, mine.id, true);
  store.setTagDir(mine.id, 'up');
  store.setTagColor(mine.id, '#5f9e6e');
  store.complete(t.id);
  store.uncomplete(t.id);
  store.complete(t.id);
  store.removeTag(mine.id);

  assert.deepEqual(store.log(), before, 'log() は1文字も変わらない');
  assert.equal(store.totalStarted(), 1, '完了ではログが増えない');
  assert.deepEqual(store.startedByAnchor(7), byAnchorBefore);
  assert.deepEqual(store.startedByDay(7), byDayBefore);
  assert.equal(store.todayedCount(7), 1, '「今日するに入れた」記録も増えない');
  assert.equal(store.isStarted(t.id, A.id), true, '着手の印もそのまま');

  const again = await open();
  assert.deepEqual(again.log(), before);
  assert.equal(again.isDone(t.id), true);
});

await test('tags / done の無い旧データを読んでも壊れず、既定値が入る', async () => {
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3 },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4,
        slots: ['noon'] },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.count(), 2);
  ['a', 'b'].forEach(id => {
    assert.deepEqual(store.get(id).tags, [], id);
    assert.equal(store.get(id).done, false, id);
    assert.equal(store.get(id).doneAt, null, id);
    assert.equal(store.isDone(id), false, id);
  });
  assert.deepEqual(store.tagsOf('a'), [], 'タグは付いていない');
  assert.deepEqual(store.tagsOf('b'), ['today'], 'フラグから合成される');
  assert.deepEqual(store.doneItems(), []);
  assert.deepEqual(store.tags().map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private'],
    '特別なタグは既定値で立ち上がる');
  assert.deepEqual(store.tags().map(t => t.dir),
    [null, null, null, 'up', 'down', 'left', 'right'], '既定の向き（上は長期保留・下は完了の固有枠）');
  assert.deepEqual(store.todays().map(t => t.id), ['b'], '既存の問い合わせも従来どおり');
  assert.deepEqual(store.floating().map(t => t.id), ['a']);

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const old = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.deepEqual(old.tagsOf('z'), []);
  assert.equal(old.isDone('z'), false);
  assert.deepEqual(old.tags().map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private']);

  /* 壊れたタグの行・項目側の壊れた値は落とす */
  const odd = await open({ raw: {
    v: 2,
    tags: [
      { id: 'today', color: '#999999', dir: 'right', name: '名前は無視される' },  /* 無彩色は既定へ */
      { id: 'u1', name: '読みもの', color: '#4a8', dir: 'right' },
      { id: 'u1', name: '重複した id', color: '#4a8' },
      { id: 'u2', name: '   ', color: '#4a8' },                                   /* 名前が空 */
      { name: 'id が無い' },
      { id: 'u3', name: '色が変', color: 'ちがう', dir: 'ちがう' },
      null,
    ],
    todos: [
      { id: 'p', text: 'ぴ', createdAt: ms(2026, 8, 19, 9, 0),
        tags: ['u1', 'u1', 'today', 'nosuch', 5], done: 'yes', doneAt: 'ちがう' },
      { id: 'q', text: 'きゅ', createdAt: ms(2026, 8, 19, 9, 1), tags: 'ちがう' },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.deepEqual(odd.tags().map(t => t.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private', 'u1', 'u3'],
    '壊れた行だけ落ちる');
  assert.equal(odd.tag('today').name, '今日', '特別なタグの名前は保存データで上書きされない');
  assert.equal(odd.tag('today').color, '#fdc09e', '無彩色は既定の色に戻す');
  assert.ok(/^#[0-9a-f]{6}$/.test(odd.tag('u3').color), '読めない色は配り直す');
  /* 1向き1タグ。先に出てきた today が right を取り、u1 は null になる */
  assert.equal(odd.tagDir('right').id, 'today');
  assert.equal(odd.tag('u1').dir, null);
  assert.equal(odd.tag('u3').dir, null, '不正な向きは null');

  assert.deepEqual(odd.get('p').tags, ['u1'],
    '重複・特別なタグ・知らない id・文字列でないものは落ちる');
  assert.deepEqual(odd.tagsOf('p'), ['done', 'u1'], 'done は真偽に直る');
  assert.equal(odd.get('p').doneAt, null, '読めない時刻は null');
  assert.deepEqual(odd.doneItems().map(t => t.id), ['p']);
  assert.equal(odd.doneCount(30), 0, '時刻が無いものは期間には数えない');
  assert.deepEqual(odd.get('q').tags, [], '配列でなければ空');
});

await test('タグと完了は保存の往復・restore で保たれる', async () => {
  const store = await open({ raw: null, now: NOW });
  const mine = store.addTag('読みもの', '#4a8');
  store.setTagDir(mine.id, 'left');   /* 上下は固有枠なので、取れるのは左右だけ */
  const t = store.add('積んである本を開く');
  const gone = store.add('消すもの');
  store.setTag(t.id, mine.id, true);
  store.complete(t.id);

  /* 保存データの形 */
  const s = saved();
  assert.deepEqual(s.tags.map(x => x.id), ['today', 'plan', 'gap', 'hold', 'done', 'work', 'private', mine.id]);
  assert.equal(s.todos[0].done, true);
  assert.equal(s.todos[0].doneAt, NOW);
  assert.deepEqual(s.todos[0].tags, [mine.id]);

  const again = await open();
  assert.equal(again.isDone(t.id), true);
  assert.deepEqual(again.tagsOf(t.id), ['done', mine.id]);
  assert.equal(again.tagDir('left').id, mine.id);
  assert.equal(again.tag('hold').dir, 'up', '上は固有枠のまま');
  assert.equal(again.tag('done').dir, 'down', '下も固有枠のまま');

  /* 完了したまま消して戻しても、完了のまま戻る（勝手に取り消さない） */
  const snap = again.remove(t.id);
  assert.deepEqual(again.doneItems(), []);
  assert.equal(again.restore(snap), true);
  assert.equal(again.isDone(t.id), true, '完了のまま戻る');
  assert.deepEqual(again.tagsOf(t.id), ['done', mine.id]);

  /* 消している間にタグが消えていたら、そのタグだけ落ちる（anchors と同じ扱い） */
  const snap2 = again.remove(gone.id);
  again.setTag(t.id, mine.id, false);
  assert.equal(again.removeTag(mine.id), true);
  assert.equal(again.restore(snap2), true);
  assert.deepEqual(again.tagsOf(gone.id), []);

  const third = await open();
  assert.equal(third.isDone(t.id), true);
  assert.deepEqual(third.tagsOf(t.id), ['done']);
});

/* ============================================================ */
/* 消す（墓石）— remove() は消さずに印を立てるだけ。
   「表示上は完全に消しているが、基本は記録として残し続ける」（利用者の指示）。

   完了（done）との違い：
     完了 … 完了の海に見えている。UI から取り消せる
     消す … どこにも見えない。UI から戻す道は無い。
            戻せるのは localStorage を直接いじるか store.untrash() を叩いたときだけ */

await test('長期保留は「もどってくる日」を持てる。決めなくてもよい', async () => {
  const store = await open({ raw: null, now: NOW });   /* 2026-08-20 10:00 */
  const a = store.add('傘を修理に出す');

  assert.equal(store.isHold(a.id), false);
  assert.equal(store.holdUntil(a.id), null);

  /* 日を決めずに長期保留にできる。自分で外すまで上の海に居る */
  assert.equal(store.setHold(a.id, true), true);
  assert.equal(store.isHold(a.id), true);
  assert.equal(store.holdUntil(a.id), null, '決めなければ日は無い');

  /* あとから日を足せる */
  assert.equal(store.setHoldUntil(a.id, '2026-09-15'), true);
  assert.equal(store.holdUntil(a.id), '2026-09-15');
  assert.equal(store.setHoldUntil(a.id, '2026-09-15'), false, '同じ日なら書かない');

  /* 形の違うものは「決めない」になる（例外は投げない） */
  assert.equal(store.setHoldUntil(a.id, 'あした'), true);
  assert.equal(store.holdUntil(a.id), null);
  assert.equal(store.setHoldUntil(a.id, '2026-9-15'), false, '0詰めでない形も弾く（既に null）');

  /* 長期保留でないものには日が付かない */
  const b = store.add('牛乳を買う');
  assert.equal(store.setHoldUntil(b.id, '2026-09-15'), false);
  assert.equal(store.holdUntil(b.id), null);

  /* setHold に日を一緒に渡せる。外すと日も必ず落ちる */
  assert.equal(store.setHold(b.id, true, '2026-10-01'), true);
  assert.equal(store.holdUntil(b.id), '2026-10-01');
  assert.equal(store.setHold(b.id, false), true);
  assert.equal(store.isHold(b.id), false);
  assert.equal(store.holdUntil(b.id), null, '外したら日も残さない');
  assert.equal(store.setHold(b.id, true), true);
  assert.equal(store.holdUntil(b.id), null, '外したときに落ちているので、漏れて戻らない');

  /* 省略すると、いまの日をそのまま持ち越す */
  store.setHoldUntil(b.id, '2026-11-11');
  assert.equal(store.setHold(b.id, true), false, '同じ状態なら書かない');
  assert.equal(store.holdUntil(b.id), '2026-11-11');

  /* 保存の往復でも残る */
  const again = await open();
  assert.equal(again.holdUntil(b.id), '2026-11-11');
  assert.equal(again.isHold(b.id), true);
});

await test('もどってくる日が来たら、静かに海へ戻る（sweepHolds）', async () => {
  const store = await open({ raw: null, now: NOW });   /* 2026-08-20 */
  const soon  = store.add('傘を修理に出す');
  const later = store.add('確定申告の書類');
  const never = store.add('読みかけの本');

  store.setHold(soon.id,  true, '2026-08-25');
  store.setHold(later.id, true, '2026-09-30');
  store.setHold(never.id, true);                       /* 日を決めない */

  /* まだどれも来ていない */
  assert.deepEqual(store.sweepHolds(), []);
  assert.equal(store.holds().length, 3);

  /* 当日に戻る（「8/25 に戻る」なら 8/25 の朝から） */
  const d25 = await open({ now: ms(2026, 8, 25, 9, 0) });
  const back = d25.sweepHolds();
  assert.deepEqual(back.map(t => t.text), ['傘を修理に出す']);
  assert.equal(d25.isHold(soon.id), false);
  assert.equal(d25.holdUntil(soon.id), null, '戻ったら日も落ちる');
  assert.equal(d25.holds().length, 2, '日を決めていないものは残る');
  assert.deepEqual(d25.sweepHolds(), [], '二度目は何も戻さない');

  /* 5時の境目。8/25 の 4:00 は「8/24 のぶん」なので、まだ戻らない */
  const early = await open({ raw: null, now: NOW });
  const x = early.add('朝の一件');
  early.setHold(x.id, true, '2026-08-25');
  const at4 = await open({ now: ms(2026, 8, 25, 4, 0) });
  assert.deepEqual(at4.sweepHolds(), [], '5時までは前日のあつかい');
  const at6 = await open({ now: ms(2026, 8, 25, 6, 0) });
  assert.deepEqual(at6.sweepHolds().map(t => t.text), ['朝の一件']);

  /* 開いていなかった間に過ぎた日も、開いた時点で拾う（何日過ぎたかは数えない） */
  const late = await open({ raw: null, now: NOW });
  const y = late.add('ずっと前の一件');
  late.setHold(y.id, true, '2026-08-21');
  const much = await open({ now: ms(2027, 3, 1, 12, 0) });
  assert.deepEqual(much.sweepHolds().map(t => t.text), ['ずっと前の一件']);
  assert.equal(much.isHold(y.id), false);

  /* 墓石には触らない */
  const gone = await open({ raw: null, now: NOW });
  const z = gone.add('消したもの');
  gone.setHold(z.id, true, '2026-08-21');
  gone.remove(z.id);
  const after = await open({ now: ms(2026, 9, 1, 12, 0) });
  assert.deepEqual(after.sweepHolds(), [], '消したものは戻さない');
});

await test('上の海は、もどってくる日が近い順。決めていないものは後ろ', async () => {
  const store = await open({ raw: null, now: NOW });
  const c = store.add('三番目');
  const a = store.add('一番目');
  const n = store.add('日なし');
  const b = store.add('二番目');
  store.setHold(c.id, true, '2026-12-01');
  store.setHold(a.id, true, '2026-09-01');
  store.setHold(n.id, true);
  store.setHold(b.id, true, '2026-10-01');
  assert.deepEqual(store.holds().map(t => t.text), ['一番目', '二番目', '三番目', '日なし']);
});

await test('dayAfter / monthAfter は日付キーを作る。月末はつぶれる', async () => {
  const store = await open({ raw: null, now: ms(2026, 8, 20, 10, 0) });
  assert.equal(store.todayKey(), '2026-08-20');
  assert.equal(store.dayAfter(7), '2026-08-27');
  assert.equal(store.dayAfter(0), '2026-08-20');
  assert.equal(store.monthAfter(1), '2026-09-20');
  assert.equal(store.monthAfter(3), '2026-11-20');
  /* 年をまたぐ */
  const dec = await open({ now: ms(2026, 12, 20, 10, 0) });
  assert.equal(dec.monthAfter(3), '2027-03-20');
  /* 1/31 の1か月後は 3/3 ではなく 2/28（その月の日数へ丸める） */
  const jan = await open({ now: ms(2027, 1, 31, 10, 0) });
  assert.equal(jan.todayKey(), '2027-01-31');
  assert.equal(jan.monthAfter(1), '2027-02-28');
  /* うるう年は 2/29 まで伸びる */
  const jan28 = await open({ now: ms(2028, 1, 31, 10, 0) });
  assert.equal(jan28.monthAfter(1), '2028-02-29');
});

await test('remove() は項目を消さず、消した印を立てるだけ', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('消すもの');
  const keep = store.add('残るもの');

  assert.equal(store.isTrashed(t.id), false, '既定は false');
  assert.equal(store.get(t.id).trashed, false);
  assert.equal(store.get(t.id).trashedAt, null);
  assert.deepEqual(store.trashedItems(), [], '既定では空');

  const snap = store.remove(t.id);
  assert.ok(snap && snap.item, '戻り値の形は今までどおり { item, index }');
  assert.equal(snap.item.id, t.id);
  assert.equal(snap.index, 0);

  /* 画面からは完全に消える */
  assert.equal(store.get(t.id), null, 'get() は null（消したものは無いものとして扱う）');
  assert.equal(store.count(), 1, 'count() から外れる');
  assert.deepEqual(store.all().map(x => x.id), [keep.id], 'all() からも外れる');

  /* でも配列からは消えていない */
  assert.deepEqual(store.allIncludingTrashed().map(x => x.id), [t.id, keep.id],
    '全件の口には残る。並び位置も動かない');
  assert.equal(store.isTrashed(t.id), true);
  assert.equal(store.allIncludingTrashed().find(x => x.id === t.id).trashedAt, NOW);
  assert.deepEqual(store.trashedItems().map(x => x.id), [t.id]);

  /* 二度消せない。無い id も null */
  assert.equal(store.remove(t.id), null, 'もう消してあるので null');
  assert.equal(store.remove('nosuch'), null);

  /* 通知は消したときだけ */
  let n = 0;
  const off = store.on(() => n++);
  store.remove(t.id);
  assert.equal(n, 0, '何も起きなければ通知しない');
  store.remove(keep.id);
  assert.equal(n, 1);
  off();
});

await test('消したものは、画面が使う問い合わせから1つずつ全部外れる', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const mine = store.addTag('読みもの', '#4a8');

  /* いろいろな軸に属している1件 */
  const t = store.add('全部に属するもの', { today: true });
  store.setSlot(t.id, 'noon', true);
  store.setAnchor(t.id, A.id, true);
  store.setGapSlot(t.id, 'ears');
  store.setTag(t.id, mine.id, true);
  store.setFirstStep(t.id, 'かばんを開ける');
  store.setUrl(t.id, 'https://example.com/x');
  store.commitStep(t.id, { did: 'やった', next: 'つぎ' });

  const sea = store.add('海に漂うもの');                 /* floating 用 */
  const plan = store.add('きっかけの未分類');            /* planUnsorted 用 */
  store.setPlan(plan.id, true);
  const unsl = store.add('今日する・枠なし', { today: true });   /* unslotted 用 */
  const gapU = store.add('すきまの未分類');              /* gapUnsorted 用 */
  store.setGap(gapU.id, true);
  const dn = store.add('完了したもの');                  /* doneItems / doneCount 用 */
  store.complete(dn.id);

  /* 消す前 */
  assert.deepEqual(store.floating().map(x => x.id), [sea.id]);
  assert.deepEqual(store.todays().map(x => x.id), [t.id, unsl.id]);
  assert.deepEqual(store.inSlot('noon').map(x => x.id), [t.id]);
  assert.deepEqual(store.unslotted().map(x => x.id), [unsl.id]);
  assert.deepEqual(store.inAnchor(A.id).map(x => x.id), [t.id]);
  assert.deepEqual(store.planUnsorted().map(x => x.id), [plan.id]);
  assert.deepEqual(store.gapItems().map(x => x.id), [t.id, gapU.id]);
  assert.equal(store.inGapSlot('ears').id, t.id);
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [gapU.id]);
  assert.deepEqual(store.inTag(mine.id).map(x => x.id), [t.id]);
  assert.deepEqual(store.inTag('today').map(x => x.id), [t.id, unsl.id]);
  assert.deepEqual(store.doneItems().map(x => x.id), [dn.id]);
  assert.equal(store.doneCount(1), 1);
  assert.equal(store.count(), 6);
  assert.equal(store.writtenCount(1), 6);

  /* 全部消す */
  [t, sea, plan, unsl, gapU, dn].forEach(x => assert.ok(store.remove(x.id), x.text));

  /* 消したあと。1つずつ確かめる */
  assert.deepEqual(store.all(), [], 'all()');
  assert.equal(store.count(), 0, 'count()');
  assert.equal(store.get(t.id), null, 'get()');
  assert.deepEqual(store.floating(), [], 'floating()');
  assert.deepEqual(store.todays(), [], 'todays()');
  assert.deepEqual(store.inSlot('noon'), [], 'inSlot()');
  assert.deepEqual(store.unslotted(), [], 'unslotted()');
  assert.deepEqual(store.inAnchor(A.id), [], 'inAnchor()');
  assert.deepEqual(store.planUnsorted(), [], 'planUnsorted()');
  assert.deepEqual(store.gapItems(), [], 'gapItems()');
  assert.equal(store.inGapSlot('ears'), null, 'inGapSlot()');
  assert.deepEqual(store.gapUnsorted(), [], 'gapUnsorted()');
  assert.deepEqual(store.inTag(mine.id), [], 'inTag()（ユーザーのタグ）');
  assert.deepEqual(store.inTag('today'), [], 'inTag()（特別なタグ）');
  assert.deepEqual(store.inTag('gap'), [], 'inTag(gap)');
  assert.deepEqual(store.inTag('plan'), [], 'inTag(plan)');
  assert.deepEqual(store.doneItems(), [], 'doneItems()');
  assert.equal(store.doneCount(1), 0, 'doneCount()');
  assert.equal(store.writtenCount(1), 0, 'writtenCount()');
  assert.equal(store.writtenCount(30), 0);

  /* 1件ぶんの読みも、消したものは既定値に落ちる（get() が null なので） */
  assert.deepEqual(store.tagsOf(t.id), [], 'tagsOf()');
  assert.deepEqual(store.slotsOf(t.id), [], 'slotsOf()');
  assert.deepEqual(store.anchorsOf(t.id), [], 'anchorsOf()');
  assert.equal(store.gapSlotOf(t.id), null, 'gapSlotOf()');
  assert.equal(store.isGap(t.id), false, 'isGap()');
  assert.equal(store.isPlan(plan.id), false, 'isPlan()');
  assert.equal(store.isDone(dn.id), false, 'isDone()');
  assert.equal(store.firstStepOf(t.id), '', 'firstStepOf()');
  assert.equal(store.urlOf(t.id), '', 'urlOf()');
  assert.deepEqual(store.stepsOf(t.id), [], 'stepsOf()');
  assert.equal(store.lastStep(t.id), null, 'lastStep()');
  assert.deepEqual(store.draftOf(t.id), { did: '', next: '' }, 'draftOf()');

  /* 書き込みの口も、消したものには効かない（裏で書き換わらない） */
  assert.equal(store.setToday(t.id, true), false, 'setToday()');
  assert.equal(store.setSlot(t.id, 'morning', true), false, 'setSlot()');
  assert.equal(store.setAnchor(t.id, A.id, true), false, 'setAnchor()');
  assert.equal(store.setPlan(t.id, true), false, 'setPlan()');
  assert.equal(store.setGap(t.id, true), false, 'setGap()');
  assert.deepEqual(store.setGapSlot(t.id, 'screen'), { pushedOut: null }, 'setGapSlot()');
  assert.equal(store.setTag(t.id, mine.id, true), false, 'setTag()');
  assert.equal(store.setFirstStep(t.id, 'x'), false, 'setFirstStep()');
  assert.deepEqual(store.setUrl(t.id, 'https://example.com/y'), { ok: false, url: '' }, 'setUrl()');
  assert.equal(store.start(t.id, null), false, 'start()');
  assert.equal(store.setPos(t.id, 0.1, 0.1), false, 'setPos()');
  assert.equal(store.complete(t.id), null, 'complete()');
  assert.equal(store.commitStep(t.id, { next: 'x' }), null, 'commitStep()');

  /* それでも配列には全部残っている */
  assert.equal(store.allIncludingTrashed().length, 6, '全件の口には6件とも残る');
  /* 同じ時刻に消したので並びは元のまま（時刻が違うときの並びは別のテストで見る） */
  assert.deepEqual(store.trashedItems().map(x => x.id).sort(),
    [t.id, sea.id, plan.id, unsl.id, gapU.id, dn.id].sort(), '消したものが全部そろう');
  const row = store.allIncludingTrashed().find(x => x.id === t.id);
  assert.equal(row.today, true, '消した時点の姿がそのまま残っている');
  assert.deepEqual(row.slots, ['noon']);
  assert.deepEqual(row.anchors, [A.id]);
  assert.equal(row.gapSlot, 'ears');
  assert.deepEqual(row.tags, [mine.id]);
  assert.equal(row.firstStep, 'つぎ', 'commitStep が入れた「開始の１手」もそのまま');
  assert.equal(row.steps.length, 1);
  assert.equal(row.url, 'https://example.com/x');
});

await test('消しても log（はじめた記録）と steps（一手の記録）は残る', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('ヨガマットを敷く', { today: true });
  store.setAnchor(t.id, A.id, true);
  assert.equal(store.start(t.id, A.id), true);
  assert.equal(store.start(t.id, null), true);
  store.commitStep(t.id, { did: 'マットを出した', next: '5分だけ伸ばす' });
  store.setDraft(t.id, { did: '書きかけ', next: '' });

  const before = store.log();
  const byAnchorBefore = store.startedByAnchor(7);
  const byDayBefore = store.startedByDay(7);

  store.remove(t.id);

  assert.deepEqual(store.log(), before, 'log() は1文字も変わらない');
  assert.equal(store.log()[0].text, 'ヨガマットを敷く', 'text も当時のまま');
  assert.equal(store.totalStarted(), 2, '着手の件数も変わらない');
  assert.deepEqual(store.startedByAnchor(7), byAnchorBefore);
  assert.deepEqual(store.startedByDay(7), byDayBefore);
  assert.equal(store.startedCount(7), 2);
  assert.equal(store.startedDays(7), 1);
  assert.equal(store.todayedCount(7), 1, '「今日するに入れた」記録も残る');

  /* 一手の記録は項目の中に残っている（画面からは読めないだけ） */
  const row = store.allIncludingTrashed().find(x => x.id === t.id);
  assert.equal(row.steps.length, 1, 'steps は消えない');
  assert.deepEqual(row.steps[0], { at: NOW, did: 'マットを出した', next: '5分だけ伸ばす' });
  assert.deepEqual(row.draft, { did: '書きかけ', next: '' }, '書きかけも残る');
  assert.deepEqual(row.started, { [A.id]: NOW, '': NOW }, '着手の印も残る');

  /* 掘り起こせば、そのまま読めるところへ戻る */
  assert.equal(store.untrash(t.id), true);
  assert.equal(store.stepsOf(t.id).length, 1);
  assert.equal(store.isStarted(t.id, A.id), true);
  assert.equal(store.totalStarted(), 2, '掘り起こしてもログは増えない');

  /* 開き直しても同じ */
  store.remove(t.id);
  const again = await open();
  assert.deepEqual(again.log(), before);
  assert.equal(again.allIncludingTrashed().find(x => x.id === t.id).steps.length, 1);
});

await test('restore() で消したものが戻る（トーストの「元に戻す」）', async () => {
  const store = await open({ raw: null, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const mine = store.addTag('読みもの', '#4a8');
  const first = store.add('先にあるもの');
  const t = store.add('図書館へ行く', { today: true });
  const last = store.add('あとにあるもの');
  store.setSlot(t.id, 'noon', true);
  store.setAnchor(t.id, A.id, true);
  store.setTag(t.id, mine.id, true);
  store.setGapSlot(t.id, 'screen');
  store.setFirstStep(t.id, 'かばんに本を入れる');

  const snap = store.remove(t.id);
  assert.equal(store.count(), 2);

  assert.equal(store.restore(snap), true);
  assert.equal(store.isTrashed(t.id), false, '印が下りる');
  assert.equal(store.count(), 3);
  assert.deepEqual(store.all().map(x => x.id), [first.id, t.id, last.id],
    '並び位置も動かない（消しても動かしていないので）');
  assert.equal(store.allIncludingTrashed().length, 3, '二重に増えない');

  /* 属していた軸が全部戻る */
  assert.equal(store.get(t.id).today, true);
  assert.deepEqual(store.slotsOf(t.id), ['noon']);
  assert.deepEqual(store.anchorsOf(t.id), [A.id]);
  assert.deepEqual(store.tagsOf(t.id), ['today', 'gap', mine.id]);
  assert.equal(store.gapSlotOf(t.id), 'screen');
  assert.equal(store.inGapSlot('screen').id, t.id);
  assert.equal(store.firstStepOf(t.id), 'かばんに本を入れる');

  /* 二度戻しても壊れない */
  assert.equal(store.restore(snap), true);
  assert.equal(store.allIncludingTrashed().length, 3);

  /* 消している間に枠が埋まっていたら、戻ってきたほうが未分類へ回る
     （uncomplete と同じ理屈。いま置かれているものを押しのけない） */
  const u = store.add('あとから置いたもの');
  const snap2 = store.remove(t.id);
  assert.equal(store.setGapSlot(u.id, 'screen').pushedOut, null, '空いた枠なので押し出さない');
  assert.equal(store.restore(snap2), true);
  assert.equal(store.inGapSlot('screen').id, u.id);
  assert.equal(store.gapSlotOf(t.id), null);
  assert.deepEqual(store.gapUnsorted().map(x => x.id), [t.id], '戻ったほうは未分類へ');

  /* 消している間にタグ・アンカーが消えていたら、その残りかすだけ落ちる */
  const snap3 = store.remove(t.id);
  assert.equal(store.removeTag(mine.id), true);
  assert.equal(store.removeAnchor(A.id), true);
  assert.equal(store.restore(snap3), true);
  assert.deepEqual(store.anchorsOf(t.id), []);
  assert.deepEqual(store.tagsOf(t.id), ['today', 'gap']);

  /* 保存にも書き戻る */
  const again = await open();
  assert.equal(again.isTrashed(t.id), false);
  assert.equal(again.count(), 4);
});

await test('消す と 完了 は別物。両方立つが、消したものはどこにも見えない', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('皿を洗う', { today: true });

  /* 完了は「見えていて、UI から戻せる」 */
  assert.ok(store.complete(t.id));
  assert.equal(store.isDone(t.id), true);
  assert.equal(store.isTrashed(t.id), false, '完了しただけでは消していない');
  assert.deepEqual(store.doneItems().map(x => x.id), [t.id], '完了の海に見えている');
  assert.equal(store.uncomplete(t.id), true, 'UI から戻せる');

  /* 完了したものを消すと、両方の印が立つ */
  store.complete(t.id);
  assert.ok(store.remove(t.id));
  const row = store.allIncludingTrashed().find(x => x.id === t.id);
  assert.equal(row.done, true, 'done の印は残る');
  assert.equal(row.trashed, true, 'trashed も立つ');
  assert.deepEqual(store.doneItems(), [], '完了の海からも消える');
  assert.equal(store.doneCount(30), 0);
  assert.equal(store.isDone(t.id), false, '外からは「完了」としても見えない');

  /* 消したものは「完了」の口では戻せない（UI から戻る道は無い） */
  assert.equal(store.uncomplete(t.id), false, 'uncomplete では戻らない');
  assert.equal(store.setTag(t.id, 'done', false), false, 'タグ経由でも戻らない');
  assert.equal(store.complete(t.id), null, '完了も立て直せない');
  assert.equal(store.setTag(t.id, 'done', true), false);
  assert.equal(store.isTrashed(t.id), true, '消したままで変わらない');

  /* 内部の口（コンソール）からだけ戻る。完了は完了のまま戻る */
  assert.equal(store.untrash(t.id), true);
  assert.equal(store.isDone(t.id), true, '勝手に完了は取り消さない');
  assert.deepEqual(store.doneItems().map(x => x.id), [t.id]);
  assert.equal(store.untrash(t.id), false, '消していなければ false');
  assert.equal(store.untrash('nosuch'), false);

  /* 完了していないものを消したら、完了の印は立たないまま */
  const u = store.add('別のもの');
  store.remove(u.id);
  assert.equal(store.allIncludingTrashed().find(x => x.id === u.id).done, false);
});

await test('消した印は保存の往復で保たれ、印の無い旧データも壊れない', async () => {
  const store = await open({ raw: null, now: NOW });
  const t = store.add('消すもの');
  const keep = store.add('残るもの');
  store.remove(t.id);

  /* 保存データに書かれている */
  const s = saved();
  assert.equal(s.todos.length, 2, '保存データからも消えない');
  assert.equal(s.todos[0].trashed, true);
  assert.equal(s.todos[0].trashedAt, NOW);
  assert.equal(s.todos[1].trashed, false);
  assert.equal(s.todos[1].trashedAt, null);

  /* 開き直しても消えたまま・残ったまま */
  const again = await open();
  assert.equal(again.get(t.id), null);
  assert.equal(again.isTrashed(t.id), true);
  assert.equal(again.count(), 1);
  assert.deepEqual(again.all().map(x => x.id), [keep.id]);
  assert.deepEqual(again.allIncludingTrashed().map(x => x.id), [t.id, keep.id], '並びも同じ');
  assert.equal(again.allIncludingTrashed()[0].trashedAt, NOW);

  /* 掘り起こしたことも保存される */
  assert.equal(again.untrash(t.id), true);
  const third = await open();
  assert.equal(third.isTrashed(t.id), false);
  assert.equal(third.count(), 2);

  /* 印の無い旧データ（v2） */
  const old = await open({ raw: {
    v: 2,
    todos: [
      { id: 'a', text: 'あ', today: false, createdAt: ms(2026, 8, 19, 9, 0), fx: 0.3, fy: 0.3 },
      { id: 'b', text: 'い', today: true, createdAt: ms(2026, 8, 20, 9, 0), fx: 0.4, fy: 0.4 },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.equal(old.count(), 2);
  ['a', 'b'].forEach(id => {
    assert.equal(old.get(id).trashed, false, id);
    assert.equal(old.get(id).trashedAt, null, id);
    assert.equal(old.isTrashed(id), false, id);
  });
  assert.deepEqual(old.trashedItems(), []);
  assert.deepEqual(old.floating().map(t2 => t2.id), ['a'], '海の中身は従来どおり');

  /* 旧形式（配列そのもの）からの移行でも同じ */
  const arr = await open({ raw: [{ id: 'z', text: 'う', today: false }] });
  assert.equal(arr.isTrashed('z'), false);
  assert.equal(arr.count(), 1);

  /* 壊れた値は真偽・null に倒す */
  const odd = await open({ raw: {
    v: 2,
    todos: [
      { id: 'p', text: 'ぴ', createdAt: ms(2026, 8, 19, 9, 0), trashed: 'yes', trashedAt: 'ちがう' },
      { id: 'q', text: 'きゅ', createdAt: ms(2026, 8, 19, 9, 1), trashed: false, trashedAt: 5 },
      { id: 'r', text: 'る', createdAt: ms(2026, 8, 19, 9, 2), trashed: true,
        trashedAt: ms(2026, 8, 19, 12, 0) },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });
  assert.equal(odd.isTrashed('p'), true, '真偽に直る');
  assert.equal(odd.allIncludingTrashed().find(x => x.id === 'p').trashedAt, null,
    '読めない時刻は null');
  assert.equal(odd.isTrashed('q'), false);
  assert.equal(odd.get('q').trashedAt, null, '消していないなら時刻は持たない');
  assert.equal(odd.allIncludingTrashed().find(x => x.id === 'r').trashedAt, ms(2026, 8, 19, 12, 0));
  assert.equal(odd.count(), 1, '生きているのは q だけ');
  assert.deepEqual(odd.trashedItems().map(x => x.id), ['r', 'p'], '消した新しい順');
});

await test('rollover は墓石に触らない', async () => {
  const store = await open({ raw: { v: 2, todos: [], log: [], lastDay: '2026-08-20' }, now: NOW });
  const A = store.addAnchor('歯を磨いたら');
  const t = store.add('消してから日をまたぐもの', { today: true });
  const keep = store.add('残るもの', { today: true });
  store.setSlot(t.id, 'morning', true);
  store.setAnchor(t.id, A.id, true);
  store.start(t.id, A.id);
  store.setGapSlot(t.id, 'ears');

  store.remove(t.id);

  setNow(ms(2026, 8, 21, 10, 0));
  assert.equal(store.rollover(), 0, 'もう戻さない（墓石にも触らない）');
  setNow(NOW);

  const row = store.allIncludingTrashed().find(x => x.id === t.id);
  assert.equal(row.trashed, true, '掘り起こされない');
  /* 記録そのもの（days）に触らない、が契約。
     today は days から作る控えなので、日が変われば false になるのが正しい
     （置いたのは 8/20 で、いまは 8/21）。戻したときも 8/20 の海に残る */
  assert.deepEqual(row.days, ['2026-08-20'], '置いた日は落とさない');
  assert.equal(row.today, false, 'today は days から作り直した結果');
  assert.deepEqual(row.slots, ['morning'], '時間帯タグも落とさない');
  assert.deepEqual(row.started, { [A.id]: NOW }, 'はじめた記録も落とさない');
  assert.equal(row.gapSlot, 'ears', 'すきまの枠も従来どおり触らない');

  /* 生きているほうは従来どおり海へ戻る */
  assert.equal(store.get(keep.id).today, false);
});

await test('clear() / wipe() の意味は変わらない。墓石ごと本当に消す', async () => {
  const store = await open({ raw: null, now: NOW });
  const a = store.add('あ');
  const b = store.add('い');
  store.remove(a.id);
  assert.equal(store.allIncludingTrashed().length, 2);

  store.clear();
  assert.equal(store.count(), 0);
  assert.deepEqual(store.allIncludingTrashed(), [], '墓石も残らない');
  assert.deepEqual(store.trashedItems(), []);
  assert.deepEqual(saved().todos, []);

  const c = store.add('う');
  store.remove(c.id);
  store.wipe();
  assert.deepEqual(store.allIncludingTrashed(), [], 'wipe も墓石ごと消す');
  assert.equal(store.isTrashed(c.id), false);
  assert.equal(b.id === c.id, false);
});

await test('墓石はすきま時間の枠を、生きている項目から奪わない', async () => {
  /* 保存データに、墓石と生きている項目が同じ枠を名乗る形で入っていることがある
     （枠に入れたまま消して、あとから同じ枠へ別のものを置いた、など）。
     読み込みで生きているほうが枠を取れないと、画面のどこにも現れない項目ができる */
  const store = await open({ raw: {
    v: 2,
    todos: [
      { id: 'gone', text: '消したもの', createdAt: ms(2026, 8, 19, 9, 0),
        gap: true, gapSlot: 'ears', trashed: true, trashedAt: ms(2026, 8, 19, 10, 0) },
      { id: 'live', text: '生きているもの', createdAt: ms(2026, 8, 19, 9, 1),
        gap: true, gapSlot: 'ears' },
    ],
    log: [],
    lastDay: '2026-08-20',
  }, now: NOW });

  assert.equal(store.inGapSlot('ears').id, 'live', '生きているほうが枠を取る');
  assert.equal(store.allIncludingTrashed().find(x => x.id === 'gone').gapSlot, null,
    '墓石のほうが未分類へ落ちる');
  assert.deepEqual(store.gapUnsorted(), [], '墓石は未分類にも出てこない');

  /* 生きているうちに枠へ置き直しても、墓石は黙って空くだけ（トーストで知らせない） */
  const s2 = await open({ raw: null, now: NOW });
  const a = s2.add('先に入れたもの');
  const b = s2.add('あとから入れたもの');
  s2.setGapSlot(a.id, 'screen');
  s2.remove(a.id);
  assert.deepEqual(s2.setGapSlot(b.id, 'screen'), { pushedOut: null },
    '見えていない墓石を「未分類へ移した」とは知らせない');
  assert.equal(s2.inGapSlot('screen').id, b.id);
  assert.equal(s2.allIncludingTrashed().find(x => x.id === a.id).gapSlot, null);
});

/* ============================================================ */

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
