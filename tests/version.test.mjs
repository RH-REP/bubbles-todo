/* 画面に出す版（js/version.js）が、sw.js の VERSION と同じかを見る。
   食い違うと、左上の番号が実際に入っている版と違って見える。

     node tests/version.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sw = read('sw.js').match(/const VERSION = '([^']+)'/);
const page = read('js/version.js').match(/BUBBLES_VERSION = '([^']+)'/);
assert.ok(sw && page, 'どちらかの版が読めない');
assert.equal(page[1], sw[1], 'js/version.js と sw.js の VERSION が違う');
assert.ok(read('sw.js').includes("'./js/version.js'"), 'sw.js の ASSETS に js/version.js が無い');
assert.ok(read('index.html').includes('src="js/version.js"'), 'index.html が js/version.js を読んでいない');
console.log('ok   - 画面の版と sw.js の版が同じ（' + sw[1] + '）');
console.log('');
console.log('1 passed, 0 failed');
