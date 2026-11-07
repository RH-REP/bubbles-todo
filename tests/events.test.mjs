/* 先の予定（js/events.js・js/ai.js askWithSearch）のテスト（Issue #13）。素の Node と assert だけ。

     node tests/events.test.mjs

   見るもの:
     1. AI の返事から JSON の配列を拾える（```json の囲い・前置きがあっても）
     2. 過ぎた日・範囲の外・形の違う日付・空の題名・重なりを落とし、日付の近い順にそろえる
     3. 今日へ出す日 = 予定の日 − 何日前（過ぎていれば今日）
     4. 入れると長期保留＋その日に置かれ、その日に sweepHolds で今日の水面へ出る
     5. 同じ予定は二度入らない（本文の印で見分ける）
     6. 送る文に予測をさせない指示があり、バブルの本文が混ざらない
     7. askWithSearch は Web 検索ツールを max_uses 付きで送り、pause_turn なら続きを頼む */

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
const REAL_NOW = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
const ms = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();

const E = await import(new URL('../js/events.js', import.meta.url).href);
const STORE_URL = new URL('../js/store.js', import.meta.url).href;
const AI_URL = new URL('../js/ai.js', import.meta.url).href;
let seq = 0;
async function openStore(now) { fakeNow = now; return (await import(STORE_URL + '?ev=' + (++seq))).store; }

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const TODAY = '2026-11-04';

await test('返事から JSON の配列を拾う（囲い・前置きがあっても）。拾えなければ null', () => {
  assert.deepEqual(E.extractJsonArray('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(E.extractJsonArray('調べました。\n```json\n[{"a":2}]\n```\n以上'), [{ a: 2 }]);
  assert.deepEqual(E.extractJsonArray('前置き [ {"a":3} ] 後ろ'), [{ a: 3 }]);
  assert.equal(E.extractJsonArray('見つからなかった'), null);
  assert.equal(E.extractJsonArray('[壊れた'), null);
});

await test('落とすものを落とし、日付の近い順にそろえる', () => {
  const raw = [
    { date: '2026-12-10', title: 'FOMC', topic: 'fomc', status: 'confirmed', source: 'https://federalreserve.gov/x' },
    { date: '2026-11-27', title: 'ブラックフライデー', topic: 'sale', status: 'planned', source: 'javascript:alert(1)' },
    { date: '2026-11-01', title: '過ぎた', topic: 'fomc', status: 'confirmed' },
    { date: '2027-12-01', title: '遠すぎる', topic: 'fomc', status: 'confirmed' },
    { date: '2026-02-30', title: '無い日', topic: 'fomc' },
    { date: '2026/12/01', title: '形が違う', topic: 'fomc' },
    { date: '2026-12-01', title: '   ', topic: 'fomc' },
    { date: '2026-12-10', title: ' FOMC ', topic: 'fomc', status: 'planned' },
    { date: '2026-12-20', title: '新型の噂', topic: 'nope', status: 'leak' },
    null, 'x',
  ];
  const out = E.normalizeEvents(raw, TODAY);
  assert.deepEqual(out.map(e => e.title), ['ブラックフライデー', 'FOMC', '新型の噂']);
  assert.equal(out[0].source, '', 'http(s) 以外の出典は捨てる');
  assert.equal(out[1].source, 'https://federalreserve.gov/x');
  assert.equal(out[2].topic, 'other', '知らないトピックは other');
  assert.equal(out[2].status, 'planned', '知らない状態は「予定」');
  assert.equal(E.normalizeEvents('x', TODAY).length, 0);
});

await test('今日へ出す日 = 予定の日 − 何日前。過ぎていれば今日', () => {
  assert.equal(E.triggerDay('2026-12-10', 14, TODAY), '2026-11-26');
  assert.equal(E.triggerDay('2026-11-06', 7, TODAY), TODAY);
  assert.equal(E.triggerDay('2026-11-06', 0, TODAY), '2026-11-06');
  assert.equal(E.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(E.defaultLead('fomc'), 's14');
  assert.equal(E.defaultLead('other'), 's7');
  assert.equal(E.defaultLead({ date: '2026-12-10', topic: 'fomc' }, TODAY), 's14');
  assert.equal(E.defaultLead({ date: '2026-12-10', topic: 'macro' }, TODAY), 's3');
});

await test('キャンペーン（期間もの）: 開催中も残し、終わったものは落とす。end が変なら期間ものにしない', () => {
  const raw = [
    { date: '2026-11-01', end: '2026-11-30', title: 'エアウォレット 15% 還元', topic: 'pay', status: 'confirmed',
      entry: true, note: '上限 1,000 円／要エントリー', source: 'https://airwallet.example/cp' },
    { date: '2026-10-01', end: '2026-11-03', title: '終わったキャンペーン', topic: 'pay', status: 'confirmed' },
    { date: '2026-12-01', end: '2026-12-25', title: 'dポイント 増量', topic: 'points', status: 'planned', entry: 'yes' },
    { date: '2026-11-20', end: '2026-11-10', title: '終わりが前', topic: 'pay' },
    { date: '2026-11-04', end: '2026-11-04', title: '今日だけ', topic: 'pay' },
  ];
  const out = E.normalizeEvents(raw, TODAY);
  assert.deepEqual(out.map(e => e.title), ['エアウォレット 15% 還元', '今日だけ', '終わりが前', 'dポイント 増量']);
  const [air, oneDay, badEnd, dp] = out;
  assert.equal(air.end, '2026-11-30');
  assert.equal(air.entry, true);
  assert.equal(air.note, '上限 1,000 円／要エントリー');
  assert.equal(E.isRunning(air, TODAY), true, '始まっていて終わっていない＝開催中');
  assert.equal(E.isRunning(oneDay, TODAY), true);
  assert.equal(badEnd.end, null, '終わりが始まりより前なら、日だけのものとして扱う');
  assert.equal(dp.entry, false, 'true 以外はエントリー不要');
  assert.equal(E.isRunning(dp, TODAY), false);
  assert.equal(E.span(air), '11/1〜11/30');
  assert.equal(E.bubbleText(air), 'エアウォレット 15% 還元（11/1〜11/30）');
});

await test('キャンペーンの今日へ出す日: 既定は期間中ずっと（2026-11-05）。ほかに終わる3日前・始まる日なども選べる', () => {
  const air = { date: '2026-11-01', end: '2026-11-30', entry: false, topic: 'pay' };
  const airEntry = Object.assign({}, air, { entry: true });
  const dp = { date: '2026-12-01', end: '2026-12-25', entry: true, topic: 'points' };
  assert.equal(E.defaultLead(air, TODAY), 'p0');
  assert.equal(E.triggerDay(air, 'p0', TODAY), TODAY, '開催中なら今日から');
  assert.equal(E.triggerDay(air, 'e3', TODAY), '2026-11-27');
  assert.equal(E.triggerDay(air, 'e0', TODAY), '2026-11-30');
  assert.equal(E.defaultLead(airEntry, TODAY), 'p0');
  assert.equal(E.triggerDay(airEntry, 's0', TODAY), TODAY, 'もう始まっていれば今日');
  assert.equal(E.defaultLead(dp, TODAY), 'p0');
  assert.equal(E.triggerDay(dp, 'p0', TODAY), '2026-12-01', '先のものは始まる日から');
  assert.equal(E.triggerDay(dp, 's0', TODAY), '2026-12-01');
  assert.equal(E.triggerDay(dp, 's3', TODAY), '2026-11-28');
  assert.equal(E.triggerDay(dp, 'e7', TODAY), '2026-12-18');
  /* 選べるもの: 始まっているものは「始まる前」を出さない */
  const ids = o => E.leadOptions(o, TODAY).map(x => x.id);
  assert.deepEqual(ids(air), ['p0', 's0', 'e7', 'e3', 'e1', 'e0']);
  assert.deepEqual(ids(dp), ['p0', 's7', 's3', 's0', 'e7', 'e3', 'e1', 'e0']);
  assert.deepEqual(ids({ date: '2026-12-10' }), ['s0', 's3', 's7', 's14', 's30']);
});

await test('キャンペーンを入れる: 名前に期間、本文にエントリー・条件。終わる3日前に今日の水面へ', async () => {
  mem.clear();
  const store = await openStore(ms(2026, 11, 4));
  const [air] = E.normalizeEvents([{ date: '2026-11-01', end: '2026-11-30', title: 'エアウォレット 15% 還元',
    topic: 'pay', status: 'confirmed', entry: true, note: '上限 1,000 円', source: 'https://airwallet.example/cp' }], TODAY);
  const [t] = E.addEvents(store, [{ ev: air, lead: 'e3' }], TODAY).added;
  assert.equal(t.text, 'エアウォレット 15% 還元（11/1〜11/30）');
  assert.equal(store.holdUntil(t.id), '2026-11-27');
  const d = store.detailOf(t.id);
  assert.ok(d.includes('期間: 2026-11-01 〜 2026-11-30'));
  assert.ok(d.includes('エントリーが要る'));
  assert.ok(d.includes('条件: 上限 1,000 円'));
  const later = await openStore(ms(2026, 11, 27, 7));
  later.sweepHolds();
  assert.equal(later.todays().some(x => x.text.startsWith('エアウォレット')), true);
});

await test('送る文: 期間もの・開催中のもの・エントリー・条件を頼み、お得のトピックを渡せる', () => {
  const p = E.buildPrompt(['pay', 'points'], 'd払い, エアウォレット', TODAY);
  assert.ok(p.system.includes('"end"') && p.system.includes('"entry"') && p.system.includes('"note"'));
  assert.ok(p.system.includes('すでに始まっていて'));
  assert.ok(p.user.includes('pay:') && p.user.includes('points:') && p.user.includes('エアウォレット'));
  assert.deepEqual(E.TOPICS_ADDED[2], ['pay', 'points']);
});

await test('見るものは既定ですべて外す。前の版で保存した選びは 1 回だけ空にし、v3 以降の選びは残す', () => {
  assert.deepEqual(E.DEFAULT_TOPICS, []);
  assert.deepEqual(E.migrateTopics(null), []);
  assert.deepEqual(E.migrateTopics({ ver: 2, topics: ['fomc', 'pay', 'points'] }), [], '前の既定（全部に印）は外す');
  assert.deepEqual(E.migrateTopics({ topics: ['fomc'] }), [], 'ver の無い古い保存も外す');
  assert.deepEqual(E.migrateTopics({ ver: E.TOPICS_VER, topics: ['fomc', 'nope'] }), ['fomc'], '外したあとに選んだものは残す');
});

await test('送って調べる: 書いた文を 1 つの頼みとして送り、ほかのトピックを混ぜない。長さは MSG_MAX まで', () => {
  const p = E.buildPrompt([], '', TODAY, [], '  楽天   お買い物マラソンの次の期間 ');
  assert.ok(p.user.includes('「楽天 お買い物マラソンの次の期間」'));
  assert.ok(p.user.includes('topic は kw'));
  assert.ok(!p.user.includes('fomc:') && !p.user.includes('pay:'));
  assert.equal(Array.from(E.cleanMessage('あ'.repeat(500))).length, E.MSG_MAX);
  assert.ok(p.system.includes('最大 ' + E.ASK_MAX + ' 件'));
});

await test('説明: 投資は意味・予想・上回った/下回ったときの一般的な傾向、キャンペーンは概要・注意を頼み、本文に書く', () => {
  const p = E.buildPrompt(['macro', 'pay'], '', TODAY);
  ['"about"', '"forecast"', '"beat"', '"miss"', '"caution"'].forEach(k => assert.ok(p.system.includes(k), k));
  assert.ok(p.system.includes('一般に') && p.system.includes('断定しない'));
  const [pay, cpi] = E.normalizeEvents([   /* 始まりの近い順（PayPay 11/1 が先） */
    { date: '2026-11-12', title: '米国 CPI（10月分）', topic: 'macro', status: 'confirmed',
      about: '消費者物価の伸び。インフレの強さを表す', forecast: '前年比 2.9%',
      beat: '利下げが遠のくとみられ、株価は下がりやすい', miss: '利下げ期待で株価は上がりやすい', caution: 'null' },
    { date: '2026-11-01', end: '2026-11-30', title: 'PayPay 20% 還元', topic: 'pay', status: 'confirmed', entry: true,
      about: '対象の店で PayPay 払いが 20% 戻る', beat: 'なし', miss: null, note: '上限 1,000 円/回', caution: '付与は翌月。対象外の店あり' },
  ], TODAY);
  assert.equal(cpi.caution, '', '「null」と文字で書いてきたものは空');
  assert.equal(pay.beat, '', '「なし」も空');
  const d1 = E.detailText(cpi, TODAY);
  assert.ok(d1.includes('説明: 消費者物価の伸び') && d1.includes('予想: 前年比 2.9%'));
  assert.ok(d1.includes('予想を上回ったら: 利下げが遠のく') && d1.includes('予想を下回ったら: 利下げ期待'));
  assert.ok(d1.includes('一般的な傾向で、今回の予測ではない'));
  assert.ok(d1.endsWith(E.MARK + cpi.key), '重なりの印は最後の行のまま');
  const d2 = E.detailText(pay, TODAY);
  assert.ok(d2.includes('説明: 対象の店で') && d2.includes('条件: 上限 1,000 円/回') && d2.includes('注意: 付与は翌月'));
  assert.ok(!d2.includes('予想を上回ったら') && !d2.includes('今回の予測ではない'));
});

await test('送るたびに一覧へ足す: 前の結果を残し、同じものは新しい返事を使い、増えた分を返す', () => {
  const old = E.normalizeEvents([
    { date: '2026-12-10', title: 'FOMC', topic: 'fomc', about: '古い説明' },
    { date: '2026-11-20', title: 'お買い物マラソン', topic: 'kw' },
  ], TODAY);
  const got = E.normalizeEvents([
    { date: '2026-12-10', title: 'FOMC', topic: 'fomc', about: '新しい説明' },
    { date: '2026-11-12', title: '米国 CPI', topic: 'kw' },
  ], TODAY);
  const m = E.mergeEvents(got, old, TODAY);
  assert.deepEqual(m.events.map(e => e.title), ['米国 CPI', 'お買い物マラソン', 'FOMC']);
  assert.equal(m.events[2].about, '新しい説明');
  assert.deepEqual(Array.from(m.fresh), [got[0].key], '増えたのは CPI だけ');
  const many = Array.from({ length: 80 }, (_, i) => ({ date: E.addDays(TODAY, i + 1), title: 'x' + i }));
  assert.equal(E.mergeEvents(many, [], TODAY).events.length, E.KEEP_MAX);
});

await test('入れると長期保留＋その日に置かれ、その日に今日の水面へ出る', async () => {
  mem.clear();
  const store = await openStore(ms(2026, 11, 4));
  const evs = E.normalizeEvents([
    { date: '2026-12-10', title: 'FOMC', topic: 'fomc', status: 'confirmed', source: 'https://example.com/fomc' },
    { date: '2026-11-06', title: '雇用統計', topic: 'macro', status: 'confirmed' },
  ], TODAY);
  const r = E.addEvents(store, [{ ev: evs[0], lead: 3 }, { ev: evs[1], lead: 3 }], TODAY);
  assert.equal(r.added.length, 2);
  const [jobs, fomc] = r.added;
  assert.equal(jobs.text, '雇用統計（11/6）');
  assert.equal(store.isHold(jobs.id), false, '今日へ出す日が過ぎていれば保留にしない');
  assert.equal(store.get(jobs.id).today, true, 'そのまま今日に置く');
  assert.equal(fomc.text, 'FOMC（12/10）');
  assert.equal(store.isHold(fomc.id), true);
  assert.equal(store.holdUntil(fomc.id), '2026-12-07');
  assert.equal(store.urlOf(fomc.id), 'https://example.com/fomc');
  assert.ok(store.detailOf(fomc.id).includes('確定'));
  assert.ok(store.detailOf(fomc.id).endsWith(E.MARK + evs[1].key), 'evs は日付順なので FOMC は 2 つ目');
  assert.equal(store.todays().some(t => t.id === fomc.id), false, 'その日までは今日に出ない');

  const later = await openStore(ms(2026, 12, 7, 8));
  later.sweepHolds();
  assert.equal(later.todays().some(t => t.text === 'FOMC（12/10）'), true, 'その日の今日の水面に出る');
  assert.equal(later.holds().length, 0);
});

await test('同じ予定は二度入らない（題名の空白・記号の差も同じとみなす）', async () => {
  mem.clear();
  const store = await openStore(ms(2026, 11, 4));
  const a = E.normalizeEvents([{ date: '2026-12-10', title: 'FOMC 会合', topic: 'fomc' }], TODAY)[0];
  const b = E.normalizeEvents([{ date: '2026-12-10', title: 'FOMC・会合', topic: 'fomc' }], TODAY)[0];
  assert.equal(E.addEvents(store, [{ ev: a, lead: 7 }], TODAY).added.length, 1);
  const again = E.addEvents(store, [{ ev: b, lead: 7 }], TODAY);
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped, 1);
  assert.equal(store.holds().length, 1);
});

await test('送る文: 予測をさせない指示があり、トピックと銘柄だけを渡す', async () => {
  mem.clear();
  const store = await openStore(ms(2026, 11, 4));
  store.add('ひみつのバブル本文');
  const p = E.buildPrompt(['fomc', 'earnings', 'nope'], 'GOOG, NVDA', TODAY);
  assert.ok(p.system.includes('予測') && p.system.includes('一切しない'));
  assert.ok(p.system.includes(TODAY) && p.system.includes(E.addDays(TODAY, E.HORIZON_DAYS)));
  assert.ok(p.user.includes('fomc') && p.user.includes('earnings') && !p.user.includes('nope'));
  assert.ok(p.user.includes('GOOG, NVDA'));
  assert.ok(!(p.system + p.user).includes('ひみつのバブル本文'));
});

await test('askWithSearch: Web 検索ツールを max_uses 付きで送り、pause_turn なら続きを頼む', async () => {
  mem.clear();
  const ai = await import(AI_URL + '?ev=1');
  await assert.rejects(() => ai.askWithSearch('s', 'u'), /キー/);
  ai.setKey('sk-ant-TEST');
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    const first = seen.length === 1;
    return { ok: true, json: async () => ({
      stop_reason: first ? 'pause_turn' : 'end_turn',
      content: first
        ? [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'FOMC' } }, { type: 'text', text: '[{"date":' }]
        : [{ type: 'text', text: '"2026-12-10"}]' }],
    }) };
  };
  const text = await ai.askWithSearch('sys', 'ask');
  assert.equal(text, '[{"date":"2026-12-10"}]');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].tools[0].type, 'web_search_20250305');
  assert.equal(seen[0].tools[0].max_uses, ai.SEARCH_MAX_USES);
  assert.equal(seen[1].messages.length, 2, '続きを頼むときは、止まったところまでの返事を渡す');
  assert.equal(seen[1].messages[1].role, 'assistant');
});

await test('返事の取り出し（Issue #13 の不具合）: 説明の中の括弧・途中で切れた返事・末尾の , ・いちばん長い候補', () => {
  const t1 = '[FOMC] と [日銀] を調べます。\n検索しました。\n```json\n[{"date":"2026-12-10","title":"FOMC"},{"date":"2026-12-19","title":"日銀"}]\n```';
  assert.equal(E.extractJsonArray(t1).length, 2, '説明の中の [ ] で壊れない');
  const t2 = '結果: [{"date":"2026-12-10","title":"a]b"},{"date":"2026-12-11","title":"c"},{"date":"2026-12-1';
  assert.deepEqual(E.extractJsonArray(t2).map(x => x.title), ['a]b', 'c'], '途中で切れても閉じた要素までを拾う');
  assert.equal(E.extractJsonArray('[{"date":"2026-12-10"},]').length, 1, '末尾の , を許す');
  assert.equal(E.extractJsonArray('例 [] のあと [{"a":1},{"a":2}]').length, 2, '長いほうの候補');
  assert.deepEqual(E.extractJsonArray('見つからなかった。\n```json\n[]\n```'), []);
  assert.equal(E.extractJsonArray('[1, 2, 3]'), null, 'オブジェクトでない配列は拾わない');
});

await test('キーワード: 区切り・重なり・上限。送る文に 1 つずつ入り、topic kw の返事を残す', () => {
  assert.deepEqual(E.parseKeywords(' SBI 投資信託 キャンペーン、楽天  お買い物マラソン,SBI 投資信託 キャンペーン\n , '),
    ['SBI 投資信託 キャンペーン', '楽天 お買い物マラソン']);
  assert.equal(E.parseKeywords('a,b,c,d,e,f,g').length, E.KW_MAX);
  const p = E.buildPrompt([], '', TODAY, 'SBI 投資信託 キャンペーン、楽天 お買い物マラソン');
  assert.ok(p.user.includes('「SBI 投資信託 キャンペーン」') && p.user.includes('「楽天 お買い物マラソン」'));
  assert.ok(!p.user.includes('fomc'));
  const out = E.normalizeEvents([{ date: '2026-11-20', end: '2026-11-27', title: 'お買い物マラソン', topic: 'kw', status: 'confirmed' }], TODAY);
  assert.equal(out[0].topic, 'kw');
  assert.equal(E.defaultLead(out[0], TODAY), 'p0');
  assert.ok(E.detailText(out[0], TODAY).includes('見るもの: 送って調べたもの'));
});

await test('askWithSearchFull: 途中で切れた・検索のエラーを返し、検索の回数を変えられる（上限あり）', async () => {
  mem.clear();
  const ai = await import(AI_URL + '?ev=2');
  ai.setKey('sk-ant-TEST');
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [
      { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      { type: 'text', text: '[{"date":' }] }) };
  };
  const r = await ai.askWithSearchFull('s', 'u', { maxUses: 99 });
  assert.equal(r.stop, 'max_tokens');
  assert.equal(r.searchError, 'max_uses_exceeded');
  assert.equal(seen[0].tools[0].max_uses, ai.SEARCH_USES_CAP);
  assert.ok(seen[0].max_tokens >= 16000, '考える分と検索の結果で JSON が切れないだけの長さ');
});

await test('期間中ずっと: 始まる日（開催中なら今日）から終わる日まで毎日の今日に置き、その日ごとに今日の水面へ出る', async () => {
  mem.clear();
  const store = await openStore(ms(2026, 11, 4));
  const [run, later] = E.normalizeEvents([
    { date: '2026-11-01', end: '2026-11-07', title: '開催中の還元', topic: 'pay', status: 'confirmed' },
    { date: '2026-11-20', end: '2026-11-22', title: '先のセール', topic: 'sale', status: 'confirmed' },
  ], TODAY);
  assert.deepEqual(E.floatDays(run, 'p0', TODAY), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.deepEqual(E.floatDays(run, 'e3', TODAY), ['2026-11-04'], 'ほかの選び方は 1 日だけ');
  assert.equal(E.floatDays({ date: TODAY, end: '2027-03-01' }, 'p0', TODAY).length, E.FLOAT_MAX, '長い期間は上限まで');
  const [a, b] = E.addEvents(store, [{ ev: run, lead: 'p0' }, { ev: later, lead: 'p0' }], TODAY).added;
  assert.equal(store.todays().some(t => t.id === a.id), true);
  assert.equal(store.isHold(b.id), true);
  assert.equal(store.holdUntil(b.id), '2026-11-20');
  for (const [d, h, inA, inB] of [[6, 9, true, false], [8, 9, false, false], [21, 9, false, true], [23, 9, false, false]]) {
    const s2 = await openStore(ms(2026, 11, d, h));
    s2.sweepHolds();
    const ids = s2.todays().map(t => t.id);
    assert.equal(ids.includes(a.id), inA, '開催中の還元 11/' + d);
    assert.equal(ids.includes(b.id), inB, '先のセール 11/' + d);
  }
});

await test('支払いルート: 持っているカードと参考のサイトだけを送り、ルート・還元率・上限を一覧と本文に持つ', () => {
  const p = E.buildRoutePrompt('三井住友ゴールドNL, マネックスカード', 'https://toyama-go-z-house.com/\njavascript:alert(1)\nhttps://poinmy.com/?p=798', TODAY);
  assert.ok(p.user.includes('三井住友ゴールドNL, マネックスカード'));
  assert.ok(p.user.includes('- https://toyama-go-z-house.com/') && p.user.includes('- https://poinmy.com/?p=798'));
  assert.ok(!p.user.includes('javascript:'));
  ['"steps"', '"rate"', '"cap"', '"end"', '"caution"'].forEach(k => assert.ok(p.system.includes(k), k));
  assert.deepEqual(E.parseSites(E.DEFAULT_SITES), ['https://toyama-go-z-house.com/', 'https://poinmy.com/?p=798']);
  const out = E.normalizeRoutes([
    { title: 'NL → ANA Pay → 楽天ペイ', card: '三井住友ゴールドNL', steps: ['三井住友ゴールドNL', 'Revolut', 'ANA Pay', '楽天Edy', '楽天キャッシュ', '楽天ペイ'],
      rate: '1.5%', cap: '1回1円', date: null, end: null, note: '年100万円修行中', caution: '改悪の予定あり', status: 'confirmed', source: 'https://poinmy.com/?p=798' },
    { title: 'マネックス → JAL Pay → nanaco', steps: ['マネックスカード', 'JAL Pay', 'nanaco'], rate: '1.2%',
      date: '2026-10-01', end: '2026-11-15', status: 'confirmed' },
  ], TODAY);
  const fixed = out.find(e => E.isFixedRoute(e));
  const timed = out.find(e => !E.isFixedRoute(e));
  assert.equal(fixed.date, TODAY, '常設は今日の予定');
  assert.equal(E.routeLine(fixed), '三井住友ゴールドNL → Revolut → ANA Pay → 楽天Edy → 楽天キャッシュ → 楽天ペイ');
  assert.deepEqual(E.leadOptions(fixed, TODAY).map(x => x.id), ['s0']);
  assert.equal(E.bubbleText(fixed), 'NL → ANA Pay → 楽天ペイ', '常設は名前に日付を付けない');
  assert.equal(timed.date, TODAY, 'もう始まっているものは今日から');
  assert.equal(timed.end, '2026-11-15');
  assert.equal(E.defaultLead(timed, TODAY), 'p0');
  const d = E.detailText(fixed, TODAY);
  assert.ok(d.includes('ルート: 三井住友ゴールドNL → Revolut') && d.includes('還元率: 1.5%') && d.includes('上限: 1回1円'));
  assert.ok(d.includes('注意: 改悪の予定あり') && d.includes('常設のルート'));
  const m = E.mergeEvents(out, [], TODAY);
  assert.equal(E.routeLine(m.events.find(E.isFixedRoute)).split(' → ').length, 6, '一覧に足しても（保存し直しても）ルートが残る');
});

await test('モデル: 既定は Opus 5.5（2026-11-07）。設定で選んだものを使い、知らない名前は既定に戻す', async () => {
  mem.clear();
  const ai = await import(AI_URL + '?ev=3');
  ai.setKey('sk-ant-TEST');
  assert.equal(ai.getModel(), ai.DEFAULT_MODEL);
  assert.equal(ai.DEFAULT_MODEL, 'claude-opus-5-5');
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[]' }] }) }; };
  assert.equal(ai.setModel('claude-sonnet-5-5'), true);
  await ai.askWithSearchFull('s', 'u');
  assert.equal(seen[0].model, 'claude-sonnet-5-5');
  ai.setModel('nope');
  assert.equal(ai.getModel(), ai.DEFAULT_MODEL);
  await ai.askWithSearchFull('s', 'u');
  assert.equal(seen[1].model, 'claude-opus-5-5');
  ai.setModel('claude-haiku-5-5');
  assert.equal(localStorage.getItem('bubble_todo_ai_model'), 'claude-haiku-5-5', '自分で選んだ Haiku は既定が変わっても残る');
  assert.equal(ai.getModel(), 'claude-haiku-5-5');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
