/* 海域（js/regions.js。2026-11-12 利用者の指示「複数の場所からつなげるように」）のテスト。
   素の Node と assert だけで走る。データはすべて架空。

     node tests/regions.test.mjs

   1. 一覧・引き継ぎ・海と海域（同じ node の中で）
   2. 開いている海の海域で、繋ぐ先と送る海の ID が決まる（場面ごとに別の node。tests/fixtures/regions-sync-case.mjs） */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};

const R = await import(new URL('../js/regions.js', import.meta.url).href);
const SL = await import(new URL('../js/spacelist.js', import.meta.url).href);
const CASE = fileURLToPath(new URL('./fixtures/regions-sync-case.mjs', import.meta.url));

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); }
  catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}
function fresh(entries) { mem.clear(); Object.entries(entries || {}).forEach(([k, v]) => mem.set(k, typeof v === 'string' ? v : JSON.stringify(v))); }
function runCase(ls, server) {
  const lsStr = Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return JSON.parse(execFileSync(process.execPath, [CASE, JSON.stringify({ ls: lsStr, server })], { encoding: 'utf8' }).trim().split('\n').pop());
}

const ME_BOX = { v: 2, todos: [{ id: 'm1', text: '架空の個人の泡', createdAt: 1 }], stamps: { 'todo:m1': [1, 1] } };
const SEA = { id: 'sabc1234', name: '架空の海', color: 'sand', at: 5, alive: 1 };

/* ============================================================ */
/* 1. 一覧・引き継ぎ */

await test('引き継ぎ（サーバーに繋いでいた端末）: この端末だけ＋前のサーバー。記録の箱は書き換えない', async () => {
  fresh({ bubble_todo_sync: { url: 'https://srv-a.test', token: 'tk-a' }, bubble_todo_v1: ME_BOX, bubble_todo_spaces: [SEA] });
  const before = { me: mem.get('bubble_todo_v1'), list: mem.get('bubble_todo_spaces'), conf: mem.get('bubble_todo_sync') };
  const rs = R.regionList();
  assert.deepEqual(rs.map(r => [r.id, r.kind, r.legacyMe, r.legacyConf]), [['local', 'local', false, false], ['r0', 'server', true, true]]);
  assert.equal(rs[1].name, 'サーバー（srv-a.test）');
  assert.deepEqual([mem.get('bubble_todo_v1'), mem.get('bubble_todo_spaces'), mem.get('bubble_todo_sync')], [before.me, before.list, before.conf]);
  /* 前の版の個人・海はサーバーの海域のもの。この端末だけの海域には別の個人 */
  assert.equal(R.regionOfSpace('me'), 'r0');
  assert.equal(R.regionOfSpace('sabc1234'), 'r0');
  assert.equal(R.personalId('local'), 'me.local');
  assert.equal(R.regionOfSpace('me.local'), 'local');
  assert.equal(SL.boxKey('me.local'), 'bubble_todo_me_local_v1');
  assert.deepEqual(R.spacesOf('r0'), ['me', 'share', 'sabc1234']);
  assert.deepEqual(R.spacesOf('local'), ['me.local']);
  assert.equal(R.confKeyOf('r0'), 'bubble_todo_sync');
  assert.equal(R.confKeyOf('local'), '');
});

await test('引き継ぎ（繋いでいなかった端末）: この端末だけの1つで、前の版の個人はそこ', async () => {
  fresh({ bubble_todo_v1: ME_BOX });
  assert.deepEqual(R.regionList().map(r => [r.id, r.legacyMe]), [['local', true]]);
  assert.equal(R.personalId('local'), 'me');
  assert.equal(R.regionOfSpace('me'), 'local');
  assert.equal(R.anyServerUrl(), false);
});

await test('サーバーの海域を足す: 前の版の住所の箱が空いていればそこ、ほかは海域ごとの箱。個人は海域ごと', async () => {
  fresh({ bubble_todo_v1: ME_BOX });
  const a = R.addServerRegion('サーバーA', { url: 'https://srv-a.test', token: 'tk-a' }, 1000);
  const b = R.addServerRegion('', { url: 'https://srv-b.test' }, 2000);
  assert.equal(a.legacyConf, true);
  assert.equal(b.legacyConf, false);
  assert.equal(b.name, 'サーバー（srv-b.test）');
  assert.equal(R.confKeyOf(a.id), 'bubble_todo_sync');
  assert.equal(R.confKeyOf(b.id), 'bubble_todo_sync_' + b.id);
  assert.deepEqual(JSON.parse(mem.get('bubble_todo_sync')), { url: 'https://srv-a.test', token: 'tk-a', shareToken: '' });
  assert.equal(R.regionConf(b.id).url, 'https://srv-b.test');
  assert.equal(R.personalId(a.id), 'me.' + a.id);
  assert.notEqual(SL.boxKey(R.personalId(a.id)), SL.boxKey(R.personalId(b.id)));
  assert.equal(R.anyServerUrl(), true);
  assert.deepEqual(R.regionList().map(r => r.id), ['local', a.id, b.id]);
});

await test('繋いでいなかった端末が初めてサーバーを足すとき、今の個人と海を移せる（印だけ。箱は動かさない）', async () => {
  fresh({ bubble_todo_v1: ME_BOX, bubble_todo_spaces: [SEA] });
  const box = mem.get('bubble_todo_v1');
  assert.equal(R.localHasLegacy(), true);
  const a = R.addServerRegion('A', { url: 'https://srv-a.test', token: 'tk-a' }, 1000, undefined, { takeLocal: true });
  assert.equal(R.localHasLegacy(), false);
  assert.equal(R.regionOfSpace('me'), a.id, '今の個人がサーバーの海域に移っていない');
  assert.equal(R.regionOfSpace('sabc1234'), a.id, '今の海がサーバーの海域に移っていない');
  assert.equal(R.personalId(a.id), 'me');
  assert.equal(R.personalId('local'), 'me.local', 'この端末だけには空の個人が残る');
  assert.equal(R.confKeyOf(a.id), 'bubble_todo_sync');
  assert.equal(mem.get('bubble_todo_v1'), box);
  /* 移さないときは、サーバーの海域は空の個人から */
  fresh({ bubble_todo_v1: ME_BOX });
  const b = R.addServerRegion('B', { url: 'https://srv-b.test' }, 1000);
  assert.equal(R.regionOfSpace('me'), 'local');
  assert.equal(R.personalId(b.id), 'me.' + b.id);
});

await test('海を作ると今の海域の海。外した海域・知らない海域の海はどこにも出さない（ほかのサーバーへ送らない）', async () => {
  fresh({ bubble_todo_sync: { url: 'https://srv-a.test', token: 'tk-a' } });
  const b = R.addServerRegion('B', { url: 'https://srv-b.test', token: 'tk-b' }, 1000);
  const e = SL.addSea('B の海', 'moss', 1500, b.id);
  assert.equal(e.region, b.id);
  assert.equal(R.regionOfSpace(e.id), b.id);
  assert.deepEqual(R.seasOf(b.id).map(x => x.id), [e.id]);
  assert.ok(!R.seasOf('r0').some(x => x.id === e.id));
  /* 外せない海域 */
  assert.equal(R.removeRegion('local'), false);
  assert.equal(R.removeRegion('r0'), false, '前の版からの個人の海域は外せない');
  assert.equal(R.removeRegion(b.id), true);
  assert.equal(R.regionOfSpace(e.id), null, '外した海域の海が、ほかの海域に混ざった');
  assert.equal(R.regionOfSpace('me.' + b.id), null);
  assert.ok(!R.allSpaceIds().includes(e.id));
  assert.ok(mem.get('bubble_todo_sync_' + b.id), '外しても住所の箱は消さない');
  /* ほかの端末の海域の ID が付いた海（引っ越しのファイル）も出さない */
  SL.mergeSeas([{ id: 'sother99', name: 'よその海', color: 'ink', at: 9, alive: 1, region: 'rzzz' }]);
  assert.equal(R.regionOfSpace('sother99'), null);
});

await test('サーバーの一覧と合わせる: 新しく来た海はその海域。手元の海の海域は替えない。サーバーの region は信じない', async () => {
  fresh({ bubble_todo_sync: { url: 'https://srv-a.test', token: 'tk-a' } });
  const b = R.addServerRegion('B', { url: 'https://srv-b.test' }, 1000);
  const mine = SL.addSea('A の海', 'sand', 1200);           /* region 無し＝前の版からの海域（r0） */
  SL.mergeSeas([{ id: 'snewb001', name: 'B から来た海', color: 'moss', at: 3, alive: 1, region: 'r0' },
    Object.assign({}, mine, { name: 'A の海（直した）', at: 9999 })], b.id);
  assert.equal(R.regionOfSpace('snewb001'), b.id);
  assert.equal(R.regionOfSpace(mine.id), 'r0', '手元の海の海域を替えた');
  assert.equal(SL.findSea(mine.id).name, 'A の海（直した）');
});

/* ============================================================ */
/* 2. 開いている海の海域で、繋ぐ先が決まる */

const LS_TWO = (extra) => Object.assign({
  bubble_todo_sync: { url: 'https://srv-a.test', token: 'tk-a' },
  bubble_todo_sync_rb1: { url: 'https://srv-b.test', token: 'tk-b' },
  bubble_todo_regions: [
    { id: 'local', name: 'この端末だけ' },
    { id: 'r0', name: 'A', legacyMe: true, legacyConf: true },
    { id: 'rb1', name: 'B' },
  ],
  bubble_todo_spaces: [{ id: 'sinb0001', name: 'B の海', color: 'moss', at: 1, alive: 1, region: 'rb1' }, SEA],
  bubble_todo_v1: ME_BOX,
}, extra);

await test('前の版からの個人（A）を開くと、A の住所・合言葉で X-Bubbles-Space: me', async () => {
  const out = runCase(LS_TWO({ bubble_todo_space: 'me' }), { space: 'me' });
  assert.equal(out.region.id, 'r0');
  const data = out.calls.filter(c => c.url.endsWith('/api/data'));
  assert.ok(data.length >= 1);
  data.forEach(c => {
    assert.ok(c.url.startsWith('https://srv-a.test/'));
    assert.equal(c.headers.Authorization, 'Bearer tk-a');
    assert.equal(c.headers['X-Bubbles-Space'], 'me');
  });
});

await test('B の個人を開くと、B の住所・合言葉で X-Bubbles-Space: me。記録は B の個人の箱で、A の個人と混ざらない', async () => {
  const out = runCase(LS_TWO({ bubble_todo_space: 'me.rb1' }), { space: 'me' });
  assert.equal(out.space, 'me.rb1');
  assert.equal(out.region.id, 'rb1');
  const data = out.calls.filter(c => c.url.endsWith('/api/data'));
  assert.ok(data.length >= 1);
  data.forEach(c => {
    assert.ok(c.url.startsWith('https://srv-b.test/'), c.url);
    assert.equal(c.headers.Authorization, 'Bearer tk-b');
    assert.equal(c.headers['X-Bubbles-Space'], 'me');
  });
  assert.equal(out.state, 'ok');
  assert.equal(out.ls.bubble_todo_v1, JSON.stringify(ME_BOX), 'A の個人の箱に触った');
});

await test('B の海を開くと B のサーバーへ。一覧は B の海だけを region を外して送り、届いた海を B の海にする', async () => {
  const out = runCase(LS_TWO({ bubble_todo_space: 'sinb0001' }),
    { space: 'sinb0001', spaces: [{ id: 'sinb0001', name: 'B の海', color: 'moss', at: 1, alive: 1 }, { id: 'sinb0002', name: 'B の2つめ', color: 'ink', at: 2, alive: 1 }] });
  const post = out.calls.find(c => c.url.endsWith('/api/spaces'));
  assert.ok(post && post.url.startsWith('https://srv-b.test/'));
  assert.deepEqual(post.body.spaces.map(e => e.id), ['sinb0001'], 'ほかの海域の海を送った');
  assert.ok(post.body.spaces.every(e => !('region' in e)), '海域の ID を送った');
  const list = JSON.parse(out.ls.bubble_todo_spaces);
  assert.equal(list.find(e => e.id === 'sinb0002').region, 'rb1');
});

await test('この端末だけの海域の海を開くと、どこにも送らず、繋ぐ先も決められない', async () => {
  const out = runCase(LS_TWO({ bubble_todo_space: 'me.local' }), { space: 'me' });
  assert.equal(out.region.kind, 'local');
  assert.equal(out.calls.length, 0, '送った: ' + JSON.stringify(out.calls.map(c => c.url)));
  assert.equal(out.ready, false);
  assert.equal(out.configureLocal, false);
});

await test('外した海域の海を開こうとしたら、前の版からの個人へ戻る', async () => {
  const ls = LS_TWO({ bubble_todo_space: 'sinb0001' });
  ls.bubble_todo_regions = ls.bubble_todo_regions.map(r => r.id === 'rb1' ? Object.assign({}, r, { alive: 0 }) : r);
  const out = runCase(ls, { space: 'me' });
  assert.equal(out.space, 'me');
  assert.ok(out.calls.every(c => c.url.startsWith('https://srv-a.test/')));
});

/* ============================================================ */

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
