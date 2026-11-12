/* AI のキーに鍵をかけて置く（js/aikey.js・js/ai.js の saveKeyLocked など。Issue #14 2026-11-13）。素の Node だけで走る。

     node tests/aikey.test.mjs

   パスキーは偽物（決まった 32 バイトを返す）に差し替える。合言葉は PBKDF2 の回数を減らして速くする。 */

import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { return Array.from(mem.keys())[i] ?? null; },
  get length() { return mem.size; },
};

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const K = await import(new URL('../js/aikey.js', import.meta.url).href);
const SECRET = 'sk-ant-api03-LOCKED-KEY-0123456789';
const ROOT = () => new Uint8Array(32).fill(7);
const fakePk = { createPasskey: async () => ({ credId: 'CRED1', root: ROOT() }), passkeyRoot: async () => ROOT(), iter: 1000 };

await test('合言葉で鍵をかけると、置くのは暗号文と末尾 4 字だけ。同じ合言葉で開ける・違えば開かない', async () => {
  mem.clear(); K.forget();
  const { lock, aes } = await K.makeLock('pass', async () => 'correct horse battery', { iter: 1000 });
  K.saveLock(lock);
  const sealed = await K.sealKey(aes, SECRET, 'anthropic');
  mem.set(K.encName('bubble_todo_ai_key'), JSON.stringify(sealed));
  for (const v of mem.values()) assert.ok(!v.includes(SECRET), '平文が置かれている');
  assert.equal(sealed.tail, '6789');
  K.forget();
  const aes2 = await K.openLock(K.loadLock(), async () => 'correct horse battery', { iter: 1000 });
  assert.equal(await K.openSealed(aes2, sealed, 'anthropic'), SECRET);
  K.forget();
  const bad = await K.openLock(K.loadLock(), async () => 'wrong horse battery!', { iter: 1000 });
  await assert.rejects(K.openSealed(bad, sealed, 'anthropic'), /開けなかった/);
});

await test('ほかの会社の箱に写した暗号文は開かない（AAD）', async () => {
  K.forget();
  const { aes } = await K.makeLock('passkey', null, fakePk);
  const sealed = await K.sealKey(aes, SECRET, 'anthropic');
  await assert.rejects(K.openSealed(aes, sealed, 'openai'), /開けなかった/);
});

await test('合言葉は PASS_MIN 字以上。やめたら止まる', async () => {
  K.forget();
  await assert.rejects(K.makeLock('pass', async () => 'short', { iter: 1000 }), /字以上/);
  await assert.rejects(K.makeLock('pass', async () => '', { iter: 1000 }), /やめた/);
});

await test('開いた錠は OPEN_MS のあいだだけ覚え、過ぎたらもう一度訊く', async () => {
  K.forget();
  let asked = 0;
  const lock = (await K.makeLock('passkey', null, Object.assign({}, fakePk, { now: () => 0 }))).lock;
  const deps = t => ({ passkeyRoot: async () => { asked++; return ROOT(); }, now: () => t });
  await K.openLock(lock, null, deps(1000));
  assert.equal(asked, 0, '作った直後は開いている');
  await K.openLock(lock, null, deps(K.OPEN_MS + 1));
  assert.equal(asked, 1, '時間が過ぎたら訊き直す');
  K.forget();
  await K.openLock(lock, null, deps(K.OPEN_MS + 2));
  assert.equal(asked, 2, 'forget のあとは訊き直す');
});

await test('パスキーの PRF の入力は、ブロックチェーンの控えと別（同じパスキーでも財布の元は出ない）', async () => {
  const { readFileSync } = await import('node:fs');
  const a = readFileSync(new URL('../js/aikey.js', import.meta.url), 'utf8');
  const c = readFileSync(new URL('../js/chain.js', import.meta.url), 'utf8');
  const salt = s => (/PRF_SALT = new TextEncoder\(\)\.encode\('([^']+)'\)/.exec(s) || [])[1];
  assert.ok(salt(a) && salt(c));
  assert.notEqual(salt(a), salt(c));
});

await test('ai.js: 鍵をかけて保存すると平文の箱は消え、hasKey は真。removeKey で錠も外れる', async () => {
  mem.clear(); K.forget();
  const ai = await import(new URL('../js/ai.js', import.meta.url).href);
  ai.setKey(SECRET);                                  /* 前の版で平文のまま入れたキー */
  assert.ok(ai.isKeyPlain() && !ai.isKeyLocked());
  await ai.lockPlainKey(undefined, { mode: 'pass', askNewPass: async () => 'a long enough pass' });
  assert.equal(mem.get('bubble_todo_ai_key'), undefined, '平文の箱が残っている');
  assert.ok(ai.hasKey() && ai.isKeyLocked() && !ai.isKeyPlain());
  assert.equal(ai.keyTail(), '6789');
  for (const v of mem.values()) assert.ok(!v.includes(SECRET), '平文が置かれている');
  ai.removeKey();
  assert.ok(!ai.hasKey());
  assert.equal(mem.get('bubble_todo_ai_key_lock'), undefined, '錠が残っている');
});

await test('置く名前はどれも bubble_todo_ai_key で始まる（前の版に戻す写しに入らない・すべて初期化で消える）', async () => {
  assert.equal(K.LOCK_STORE.indexOf('bubble_todo_ai_key'), 0);
  assert.equal(K.encName('bubble_todo_ai_key_openai').indexOf('bubble_todo_ai_key'), 0);
});

console.log(`\n${pass} ok, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
