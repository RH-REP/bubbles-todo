/* AI の API キー（js/ai.js）が、ほかの仕組みに混ざらないことを見るテスト（Issue #9・#14）。
   素の Node と assert だけで走る。

     node tests/ai.test.mjs

   見るもの:
     1. キーは専用の localStorage キー（bubble_todo_ai_key）にだけ置かれる
     2. 記録（bubble_todo_v1）・サーバー設定（bubble_todo_sync）には混ざらない
     3. CSV の書き出し（store.exportState() 経由）にキーの値が出てこない
     4. 改善のコメントの送信ペイロード（ask の例）にキーをそのまま入れていない
     5. キーが無いときは ask() がサーバーへ fetch せずに断る（送信をそもそも起こさない） */

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

const AI_URL = new URL('../js/ai.js', import.meta.url).href;
const STORE_URL = new URL('../js/store.js', import.meta.url).href;

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

await test('キーは bubble_todo_ai_key にだけ保存され、記録・サーバー設定のキーとは別', async () => {
  mem.clear();
  const { setKey, getKey, hasKey } = await import(AI_URL + '?case=1');
  assert.equal(hasKey(), false);
  setKey('sk-ant-SECRET-VALUE');
  assert.equal(getKey(), 'sk-ant-SECRET-VALUE');
  assert.equal(hasKey(), true);
  assert.equal(localStorage.getItem('bubble_todo_ai_key'), 'sk-ant-SECRET-VALUE');
  assert.equal(localStorage.getItem('bubble_todo_v1'), null);
  assert.equal(localStorage.getItem('bubble_todo_sync'), null);
});

await test('setKey("") は消す。getKey は空文字を返す', async () => {
  mem.clear();
  const { setKey, getKey, hasKey } = await import(AI_URL + '?case=2');
  setKey('sk-ant-TEMP');
  assert.equal(hasKey(), true);
  setKey('');
  assert.equal(getKey(), '');
  assert.equal(hasKey(), false);
  assert.equal(localStorage.getItem('bubble_todo_ai_key'), null);
});

await test('CSV の書き出し（store.exportState）に AI キーの値が出てこない', async () => {
  mem.clear();
  const { setKey } = await import(AI_URL + '?case=3');
  setKey('sk-ant-SHOULD-NOT-LEAK');
  const { store } = await import(STORE_URL + '?case=1');
  store.add('牛乳を買う');
  const dumped = JSON.stringify(store.exportState());
  assert.ok(!dumped.includes('SHOULD-NOT-LEAK'), 'exportState に AI キーが混ざっている');
});

await test('キーが無いときは ask() が fetch を呼ばずに断る', async () => {
  mem.clear();
  const { ask } = await import(AI_URL + '?case=4');
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({ content: [] }) }; };
  await assert.rejects(() => ask('system', []), /キー/);
  assert.equal(called, false, 'キーが無いのに fetch を呼んだ');
});

await test('ask() は x-api-key と anthropic-dangerous-direct-browser-access を送り、質問の文だけを渡す', async () => {
  mem.clear();
  const { setKey, ask } = await import(AI_URL + '?case=5');
  setKey('sk-ant-CALLKEY');
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };
  const reply = await ask('使い方の説明', [{ role: 'user', content: '質問だよ' }]);
  assert.equal(reply, 'ok');
  assert.equal(seen.headers['x-api-key'], 'sk-ant-CALLKEY');
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.body.system, '使い方の説明');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: '質問だよ' }]);
  /* バブルの本文などを勝手に足していない（渡したメッセージそのまま） */
  assert.equal(JSON.stringify(seen.body.messages).includes('質問だよ'), true);
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
