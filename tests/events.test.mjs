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
  assert.equal(E.defaultLead('fomc'), 14);
  assert.equal(E.defaultLead('other'), 7);
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

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
