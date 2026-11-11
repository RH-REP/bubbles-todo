/* 前の版に戻す（Issue #21）。js/rollback.js の計算と、sw.js の箱の残し方・戻している間の出し方を見る。
   sw.js は vm の中で、偽の caches・fetch・self で動かす（ブラウザは使わない）。

     node --test tests/rollback.test.mjs */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const RB_SRC = read('js/rollback.js');
const SW_SRC = read('sw.js');

/* rollback.js を document の無い所で読む（画面のことはしない） */
function loadRB() {
  const ctx = vm.createContext({ console });
  vm.runInContext(RB_SRC, ctx);
  return ctx.BubblesRollback;
}
const RB = loadRB();
const plain = v => JSON.parse(JSON.stringify(v));

function fakeLS(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

test('fillMissing: 前の版が落とした欄だけを埋め、戻している間の変更は残す', () => {
  const snap = { todos: [
    { id: 'a', text: '前', detail: '本文', urgent: true },
    { id: 'b', text: '消したもの', detail: 'x' },
  ], newBox: { on: true } };
  /* 前の版: detail・urgent・newBox を知らない。a の text を書き換え、b を消し、c を足した */
  const cur = { todos: [{ id: 'a', text: '後' }, { id: 'c', text: '足した' }] };
  assert.deepEqual(plain(RB.fillMissing(cur, snap)), {
    todos: [{ id: 'a', text: '後', detail: '本文', urgent: true }, { id: 'c', text: '足した' }],
    newBox: { on: true },
  });
});

test('fillMissing: 今にある値（null・false・空）は上書きしない', () => {
  assert.deepEqual(plain(RB.fillMissing({ x: null, y: false, z: '' }, { x: 1, y: true, z: 'a' })), { x: null, y: false, z: '' });
  assert.deepEqual(plain(RB.fillMissing([1, 2], [3])), [1, 2]);
});

test('snapshotStorage: bubble_todo… だけ。API キーと写しそのものは写さない', () => {
  const ls = fakeLS({ bubble_todo_v1: '{}', bubble_todo_ai_key: 'sk-secret', bubble_todo_ai_key_openai: 'sk-o',
    bubble_todo_ai_key_gemini: 'AIza-g', [RB.SNAP_KEY]: 'old', other: '1' });
  assert.deepEqual(plain(RB.snapshotStorage(ls)), { bubble_todo_v1: '{}' });
});

test('restoreMissing: 今に無いキーは戻さない・JSON でないものは触らない', () => {
  const ls = fakeLS({
    bubble_todo_v1: JSON.stringify({ todos: [{ id: 'a', text: '後' }] }),
    bubble_todo_space: 'me',
  });
  const n = RB.restoreMissing(ls, {
    bubble_todo_v1: JSON.stringify({ todos: [{ id: 'a', text: '前', detail: '本文' }] }),
    bubble_todo_space: 'share',
    bubble_todo_sync: JSON.stringify({ token: 'logged-out' }),
  });
  assert.equal(n, 1);
  assert.deepEqual(JSON.parse(ls.getItem('bubble_todo_v1')), { todos: [{ id: 'a', text: '後', detail: '本文' }] });
  assert.equal(ls.getItem('bubble_todo_space'), 'me');
  assert.equal(ls.getItem('bubble_todo_sync'), null);
});

test('previousVersion: 今より前で最も新しい版。meta とよその箱は数えない', () => {
  const names = ['bubbles-2026-11-05a', 'bubbles-2026-11-07a', 'bubbles-2026-11-07b', 'bubbles-meta', 'other'];
  assert.equal(RB.previousVersion(names, '2026-11-07b'), '2026-11-07a');
  assert.equal(RB.previousVersion(names, '2026-11-05a'), null);
});

test('injectScript: <head> の直後（無ければ </body> の前）に差し込む。版の名前が変なら差し込まない', () => {
  const tag = '<script src="js/rollback.js" data-pinned="2026-11-07a" data-latest="2026-11-07b"></script>';
  assert.equal(RB.injectScript('<html lang="ja"><head><meta></head><body>x</body></html>', '2026-11-07a', '2026-11-07b'),
    '<html lang="ja"><head>' + tag + '<meta></head><body>x</body></html>');
  assert.equal(RB.injectScript('<body>x</body></html>', '2026-11-07a', '2026-11-07b'), '<body>x' + tag + '</body></html>');
  assert.equal(RB.injectScript('<body></body>', '"><script>', '2026-11-07b'), '<body></body>');
});

test('戻している間に読まれた head の rollback.js は、写しに触らない', () => {
  const snapRaw = JSON.stringify({ data: { bubble_todo_v1: '{"a":1}' } });
  const ls = fakeLS({ bubble_todo_v1: '{}', [RB.SNAP_KEY]: snapRaw });
  const scripts = [{ dataset: { pinned: '2026-11-07a' } }, { dataset: {} }];   /* 差し込んだ分 → 前の版の head の分 */
  const ctx = vm.createContext({ console, localStorage: ls, document: { body: null, addEventListener() {}, currentScript: null } });
  for (const s of scripts) { ctx.document.currentScript = s; vm.runInContext(RB_SRC, ctx); }
  assert.equal(ctx.BUBBLES_PINNED, '2026-11-07a');
  assert.equal(ls.getItem(RB.SNAP_KEY), snapRaw);
  assert.equal(ls.getItem('bubble_todo_v1'), '{}');
  /* 最新に戻った（印の無い head だけ）なら埋め戻して写しを消す */
  const ctx2 = vm.createContext({ console, localStorage: ls, document: { body: null, addEventListener() {}, currentScript: { dataset: {} } } });
  vm.runInContext(RB_SRC, ctx2);
  assert.equal(ls.getItem(RB.SNAP_KEY), null);
  assert.deepEqual(JSON.parse(ls.getItem('bubble_todo_v1')), { a: 1 });
});

test('index.html は rollback.js を module（app.js）より前の head で読み、sw.js の箱にも入れる', () => {
  const html = read('index.html');
  const i = html.indexOf('src="js/rollback.js"');
  assert.ok(i > 0 && i < html.indexOf('</head>') && i < html.indexOf('js/app.js'));
  assert.ok(SW_SRC.includes("'./js/rollback.js'"));
});

/* ---- sw.js を偽の環境で動かす ---- */

const SCOPE = 'https://app.example/';
function fakeCaches() {
  const boxes = new Map();
  const keyOf = r => { const u = new URL(typeof r === 'string' ? r : r.url, SCOPE); u.search = ''; return u.href; };
  const boxOf = name => {
    if (!boxes.has(name)) boxes.set(name, new Map());
    const m = boxes.get(name);
    return {
      match: async r => (m.has(keyOf(r)) ? m.get(keyOf(r)).clone() : undefined),
      put: async (r, res) => { m.set(keyOf(r), res.clone()); },
      delete: async r => m.delete(keyOf(r)),
      addAll: async reqs => { for (const r of reqs) m.set(keyOf(r), await serverFetch(r)); },
    };
  };
  let files = {};
  const serverFetch = async r => {
    const u = new URL(typeof r === 'string' ? r : r.url, SCOPE);
    const path = u.pathname === '/' ? '/index.html' : u.pathname;
    return new Response(files[path] ?? 'file ' + path, { headers: { 'Content-Type': 'text/plain', 'Content-Length': '1' } });
  };
  return {
    api: {
      open: async n => boxOf(n),
      keys: async () => [...boxes.keys()],
      has: async n => boxes.has(n),
      delete: async n => boxes.delete(n),
    },
    setFiles: f => { files = f; },
    serverFetch,
  };
}

function loadSW(version, env) {
  const handlers = {};
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  const ctx = vm.createContext({
    self, caches: env.api, fetch: async r => env.serverFetch(r),
    /* node の Request は相対の住所を受けないので、住所だけを持つ偽物にする */
    Request: class { constructor(u) { this.url = new URL(u, SCOPE).href; } },
    Response, Headers, URL, console,
    importScripts: () => vm.runInContext(RB_SRC, ctx),
  });
  self.BubblesRollback = undefined;
  ctx.self = self;
  vm.runInContext(SW_SRC.replace(/const VERSION = '[^']+'/, "const VERSION = '" + version + "'"), ctx);
  const life = async type => { let p; handlers[type]({ waitUntil: x => { p = x; } }); await p; };
  const fetchEv = async (url, init = {}) => {
    let p = null;
    handlers.fetch({ request: { url: new URL(url, SCOPE).href, method: init.method || 'GET', mode: init.mode || 'no-cors' }, respondWith: x => { p = x; } });
    return p ? await p : null;   /* null = 素通し（網へ） */
  };
  return { install: () => life('install'), activate: () => life('activate'), fetch: fetchEv };
}

async function upTo(version, env) {
  env.setFiles({ '/index.html': '<html><body>' + version + '</body></html>', '/js/app.js': 'app ' + version });
  const sw = loadSW(version, env);
  await sw.install();
  await sw.activate();
  return sw;
}

test('sw.js: 新しい版が入っても1つ前の箱だけ残し、それより古い箱は消す', async () => {
  const env = fakeCaches();
  await upTo('2026-11-01a', env);
  await upTo('2026-11-02a', env);
  assert.deepEqual((await env.api.keys()).filter(n => n !== 'bubbles-meta').sort(), ['bubbles-2026-11-01a', 'bubbles-2026-11-02a']);
  await upTo('2026-11-03a', env);
  assert.deepEqual((await env.api.keys()).filter(n => n !== 'bubbles-meta').sort(), ['bubbles-2026-11-02a', 'bubbles-2026-11-03a']);
});

test('sw.js: 印が無ければ今の版の箱だけから出す（古い箱のものが混ざらない）', async () => {
  const env = fakeCaches();
  await upTo('2026-11-01a', env);
  const sw = await upTo('2026-11-02a', env);
  assert.equal(await (await sw.fetch('/js/app.js')).text(), 'app 2026-11-02a');
  assert.equal(await (await sw.fetch('/', { mode: 'navigate' })).text(), '<html><body>2026-11-02a</body></html>');
  assert.equal(await sw.fetch('/api/data', { method: 'PUT' }), null);
});

test('sw.js: 印があれば前の版から出し、帯を差し込み、サーバーへの書き込みを止める', async () => {
  const env = fakeCaches();
  await upTo('2026-11-01a', env);
  const sw = await upTo('2026-11-02a', env);
  await (await env.api.open('bubbles-meta')).put(SCOPE + '__rollback_pin', new Response(JSON.stringify({ to: '2026-11-01a' })));

  const page = await sw.fetch('/', { mode: 'navigate' });
  const html = await page.text();
  assert.match(html, /<html><body>2026-11-01a<script src="js\/rollback\.js" data-pinned="2026-11-01a" data-latest="2026-11-02a"><\/script><\/body>/);
  assert.equal(page.headers.get('Content-Length'), null);
  assert.equal(await (await sw.fetch('/js/app.js')).text(), 'app 2026-11-01a');
  /* 前の版の箱に無いもの（rollback.js）は今の版の箱から */
  assert.ok(await sw.fetch('/js/rollback.js'));

  const put = await sw.fetch('/api/data', { method: 'PUT' });
  assert.equal(put.status, 503);
  /* よそのオリジンのサーバー（GitHub Pages から自分のサーバーへ）も止める */
  assert.equal((await sw.fetch('https://server.example/api/data', { method: 'PUT' })).status, 503);
  /* 読むのは通す */
  assert.equal(await sw.fetch('/api/data'), null);
});

test('sw.js: 新しい版が activate したら印は外れる', async () => {
  const env = fakeCaches();
  await upTo('2026-11-01a', env);
  await upTo('2026-11-02a', env);
  await (await env.api.open('bubbles-meta')).put(SCOPE + '__rollback_pin', new Response(JSON.stringify({ to: '2026-11-01a' })));
  const sw = await upTo('2026-11-03a', env);
  assert.equal(await (await sw.fetch('/', { mode: 'navigate' })).text(), '<html><body>2026-11-03a</body></html>');
  assert.equal(await sw.fetch('/api/data', { method: 'PUT' }), null);
});

test('sw.js: 印の版の箱が無ければ印は効かない', async () => {
  const env = fakeCaches();
  const sw = await upTo('2026-11-02a', env);
  await (await env.api.open('bubbles-meta')).put(SCOPE + '__rollback_pin', new Response(JSON.stringify({ to: '2026-10-01a' })));
  assert.equal(await (await sw.fetch('/', { mode: 'navigate' })).text(), '<html><body>2026-11-02a</body></html>');
});
