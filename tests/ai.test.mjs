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

await test('ヘルプの返事: Markdown の飾り（**・#・`・行頭の -）を落として素の文にする', async () => {
  /* help.js が DOM を触るのは openHelp の中だけ。ただし読み込む ui.js が読み込み時に window を見るので、
     その分だけ小さな代わりを置く */
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const { plainReply } = await import(new URL('../js/help.js', import.meta.url).href);
  assert.equal(plainReply('## 見出し\n**次の一手**は `盤` に書く。\n- ひとつ\n* ふたつ\n\n\n\n終わり'),
    '見出し\n次の一手は 盤 に書く。\n・ひとつ\n・ふたつ\n\n終わり');
  assert.equal(plainReply('<b>そのまま</b>'), '<b>そのまま</b>', 'HTML は落とさない（textContent で出すので文字のまま）');
  assert.equal(plainReply(''), '');
  assert.equal(plainReply(null), '');
});

await test('ヘルプの返事: Issue の候補の区切りを外して、候補として読む（Issue #28）', async () => {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const { splitIssue, issueDraft } = await import(new URL('../js/help.js', import.meta.url).href);
  const r = splitIssue('答えです。\n\n<<<ISSUE\n種類: 不具合\n題名: 長期保留の泡が今日に戻らない\n画面: today\n'
    + '起きたこと: もどってくる日を過ぎても出ない。\n続きの行。\n期待したこと: その日に今日へ出る。\n>>>');
  assert.equal(r.text, '答えです。', '区切りは返事から外す');
  assert.deepEqual(r.issue, {
    kind: 'bug', title: '長期保留の泡が今日に戻らない', screen: 'today',
    happened: 'もどってくる日を過ぎても出ない。\n続きの行。', expected: 'その日に今日へ出る。',
  });
  assert.equal(splitIssue('x\n<<<ISSUE\n種類：仕様\n題名：ボタンが分かりにくい\n>>>').issue.kind, 'spec', '全角のコロンも読む');
  assert.deepEqual(splitIssue('ふつうの答え'), { text: 'ふつうの答え', issue: null }, '区切りが無ければ候補なし');
  assert.deepEqual(splitIssue('答え\n<<<ISSUE\n種類: 不具合\n>>>'), { text: '答え', issue: null }, '題名が無ければ候補なし');
  assert.deepEqual(splitIssue('答え\n<<<ISSUE\n種類: 不具合\n題名: 途中で切れ'), { text: '答え', issue: null }, '閉じていない区切りも返事から外す');
  assert.equal(splitIssue('a\n<<<ISSUE\n題名: t\n画面: <b>today</b>\n>>>').issue.screen, 'btodayb', '画面 ID は英数字と - _ だけ');
  const d = issueDraft({ kind: 'spec', title: 't', screen: 'sea', happened: 'h', expected: 'e' }, '質問');
  assert.equal(d, 'AI に訊いた内容から（AI が仕様の見直しと判断した下書き）:\n\n画面: sea\n\n起きたこと: h\n\n期待したこと: e\n\n元の質問: 質問');
});

console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
