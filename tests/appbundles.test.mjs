/* 引っ越しのファイルで日記の束を運ぶ（2026-11-18 取り決め §8.3。js/appbundles.js・js/movefile.js）。fetch を差し替えて試す */
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { collectApps, deliverApps, diaryDays } = await import(new URL('../js/appbundles.js', import.meta.url).href);
const { buildPayload, moveSummary } = await import(new URL('../js/movefile.js', import.meta.url).href);

let n = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); n++; console.log('ok   - ' + name); } catch (e) { failed.push(name); console.log('FAIL - ' + name + '\n  ' + (e && e.stack || e)); }
}
const urls = { bubble: 'http://127.0.0.1:8931', gantt: '', diary: 'http://127.0.0.1:9999' };
const bundle = { app: 'diary', schema: 1, version: 3, data: { entries: { '2026-11-17': { text: 'きのう', mtime: 1 }, '2026-11-18': { text: 'きょう', mtime: 2 } } } };
const reply = (status, body) => ({ status, json: async () => body });

await test('作るとき: diary の束をもらって apps.diary に入れる（クッキーを付けて /api/export）', async () => {
  const calls = [];
  const got = await collectApps({ urls, fetchFn: async (u, o) => { calls.push([u, o.credentials, o.method || 'GET']); return reply(200, bundle); } });
  assert.deepEqual(calls, [['http://127.0.0.1:9999/api/export', 'include', 'GET']]);
  assert.deepEqual(got.apps, { diary: bundle });
  assert.deepEqual(got.notes, ['日記 2 日分']);
  assert.equal(diaryDays(bundle), 2);
});

await test('作るとき: diary にログインしていない・届かない・形が違う → 入れずに知らせる。住所が無ければ呼ばない', async () => {
  assert.deepEqual((await collectApps({ urls, fetchFn: async () => reply(401, { error: 'login' }) })), { apps: {}, notes: ['日記は入れていない（diary にログインしてから作り直すと入る）'] });
  assert.match((await collectApps({ urls, fetchFn: async () => { throw new TypeError('Failed to fetch'); } })).notes[0], /届かない/);
  assert.match((await collectApps({ urls, fetchFn: async () => reply(200, { app: 'gantt', data: {} }) })).notes[0], /形が違う/);
  let called = false;
  assert.deepEqual(await collectApps({ urls: Object.assign({}, urls, { diary: '' }), fetchFn: async () => { called = true; } }), { apps: {}, notes: [] });
  assert.equal(called, false);
});

await test('ファイルの中身: apps はそのまま入り、知らない app の束も残る。要約に日記の日の数', async () => {
  const p = buildPayload({ boxes: {}, seas: [], server: null, apps: { diary: bundle, notebook: { app: 'notebook', x: 1 } } });
  assert.deepEqual(p.apps, { diary: bundle, notebook: { app: 'notebook', x: 1 } });
  const back = JSON.parse(JSON.stringify(p));
  assert.deepEqual(back.apps.notebook, { app: 'notebook', x: 1 });
  const s = moveSummary(back);
  assert.deepEqual([s.apps, s.diaryDays], [['diary', 'notebook'], 2]);
  assert.equal('apps' in buildPayload({ boxes: {}, seas: [], server: null, apps: {} }), false, '空なら apps を書かない');
});

await test('読むとき: apps.diary を /api/import へ渡し、足した・新しくした・そのままを返す。知らない app は渡さない', async () => {
  const calls = [];
  const lines = await deliverApps({ diary: bundle, notebook: { app: 'notebook' } }, { urls, fetchFn: async (u, o) => {
    calls.push([u, o.method, o.credentials, o.headers['Content-Type'], JSON.parse(o.body)]);
    return reply(200, { ok: true, added: 1, updated: 1, kept: 0 });
  } });
  assert.deepEqual(calls, [['http://127.0.0.1:9999/api/import', 'POST', 'include', 'application/json', bundle]]);
  assert.deepEqual(lines, ['日記: 足した 1・新しくした 1・そのまま 0', 'この版の知らない app（notebook）の束は渡さなかった']);
});

await test('読むとき: 401・400・届かない・形が違う・住所が無い', async () => {
  assert.deepEqual(await deliverApps({ diary: bundle }, { urls, fetchFn: async () => reply(401, { error: 'login' }) }), ['日記: diary にログインしてから、同じファイルを読み込み直す']);
  assert.deepEqual(await deliverApps({ diary: bundle }, { urls, fetchFn: async () => reply(400, { error: 'schema' }) }), ['日記: diary が断った（schema）']);
  assert.match((await deliverApps({ diary: bundle }, { urls, fetchFn: async () => { throw new TypeError('x'); } }))[0], /届かなかった/);
  let called = false;
  assert.deepEqual(await deliverApps({ diary: { app: 'diary' } }, { urls, fetchFn: async () => { called = true; } }), ['日記: 形が違うので渡さなかった']);
  assert.match((await deliverApps({ diary: bundle }, { urls: Object.assign({}, urls, { diary: '' }), fetchFn: async () => { called = true; } }))[0], /住所が分からない/);
  assert.equal(called, false);
  assert.deepEqual(await deliverApps(undefined, { urls }), []);
});

console.log(`\n${n} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
