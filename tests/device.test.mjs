/* この端末の呼び名（js/device.js）のテスト。素の Node と assert だけで走る。

     node tests/device.test.mjs
*/

import assert from 'node:assert/strict';
import { deviceLabel } from '../js/device.js';

assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false), 'Mac');
assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true), 'iPad');
assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 15)'), 'Android');
assert.equal(deviceLabel(''), '');
console.log('ok device');
