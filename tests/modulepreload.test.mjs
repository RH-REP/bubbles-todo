/* 起動の先読み（<link rel="modulepreload">。Issue #95）の一覧が、js/app.js から静的な import で
   たどれるモジュールと食い違っていないかを見る。
   一覧に足りないと、そのモジュールは前どおり 1 段ずつ取りに行く（遅くなるだけで壊れはしない）。
   一覧に余計なもの（設定の画面など後から読むもの）があると、起動のときに要らないものを読む。
   どちらもここで落とす。import を足したり外したりしたら、index.html と noserver.html の一覧を合わせる。

     node --test tests/modulepreload.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/* 静的な import だけを拾う（`import x from './a.js'`・`export … from './a.js'`・`import './a.js'`）。
   import('./a.js') は後から読むものなので拾わない */
const FROM = /(?:^|[\s}])from\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
const BARE = /^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

function staticGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    for (const re of [FROM, BARE]) {
      for (const m of src.matchAll(re)) stack.push(normalize(join(dirname(file), m[1])).split('\\').join('/'));
    }
  }
  return seen;
}

const preloads = html => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);

test('先読みの一覧は、js/app.js から静的な import でたどれるモジュールと同じ', () => {
  const want = [...staticGraph('js/app.js')].sort();
  for (const page of ['index.html', 'noserver.html']) {
    const got = preloads(read(page));
    assert.equal(new Set(got).size, got.length, page + ' の先読みに同じものが 2 度ある');
    assert.deepEqual([...got].sort(), want, page + ' の先読みの一覧が import と合わない');
  }
});

test('後から読む設定の画面は先読みしない', () => {
  for (const page of ['index.html', 'noserver.html']) {
    const got = preloads(read(page));
    assert.ok(!got.includes('js/screens/settings.js'), page + ' が settings.js を先読みしている');
    assert.ok(!got.includes('js/screens/seapanel.js'), page + ' が seapanel.js を先読みしている');
  }
});

test('先読みするものは、どれも sw.js の箱（ASSETS）にあり、</head> の前に置く', () => {
  const sw = read('sw.js');
  for (const page of ['index.html', 'noserver.html']) {
    const html = read(page);
    for (const href of preloads(html)) assert.ok(sw.includes("'./" + href + "'"), href + ' が sw.js の ASSETS に無い');
    assert.ok(html.lastIndexOf('rel="modulepreload"') < html.indexOf('</head>'), page + ' の先読みが head の外にある');
  }
});
