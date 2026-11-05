/* 本文の面の「AI で調べる」「AI で整理」の計算（js/research.js。Issue #17）と、
   キーが無いときに送らないこと（js/ai.js askFull）を見るテスト。素の Node と assert だけ。

     node tests/research.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { return mem.has(String(k)) ? mem.get(String(k)) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
};

const R = await import(new URL('../js/research.js', import.meta.url).href);
const AI = await import(new URL('../js/ai.js', import.meta.url).href);

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

await test('調べる: 名前・本文・今日が入り、出典と字数の決めごとがある', () => {
  const p = R.buildResearchPrompt('パスポートの更新', '期限 12/20\n写真が要る', '2026-11-05');
  assert.match(p.user, /名前: パスポートの更新/);
  assert.match(p.user, /期限 12\/20\n写真が要る/);
  assert.match(p.system, /今日は 2026-11-05/);
  assert.match(p.system, /出典: /);
  assert.match(p.system, /600 字以内/);
  assert.match(p.system, /推測で埋めない/);
});

await test('調べる: 本文が空でも送れる（名前だけで調べる）', () => {
  const p = R.buildResearchPrompt('確定申告', '', '2026-11-05');
  assert.match(p.user, /本文:\n（まだ無い）/);
});

await test('長い本文は上限で切って送る', () => {
  const long = 'あ'.repeat(R.SEND_MAX + 50);
  const p = R.buildTidyPrompt('x', long);
  assert.ok(!p.user.includes('あ'.repeat(R.SEND_MAX + 1)));
  assert.match(p.user, /長いので送っていない/);
});

await test('整理: 事実・URL を残し、足さない決めごとがある', () => {
  const p = R.buildTidyPrompt('引っ越し', '電気 https://example.com/a\nガス');
  assert.match(p.system, /URL.*すべて残す/);
  assert.match(p.system, /新しい事実は足さない/);
  assert.match(p.user, /https:\/\/example\.com\/a/);
});

await test('cleanText: Markdown の印を外す', () => {
  const t = R.cleanText('```\n## 手順\n- **窓口**へ行く\n* [公式](https://ex.jp/p)\n\n\n\n終わり  \n```');
  assert.equal(t, '【手順】\n・窓口へ行く\n・公式 https://ex.jp/p\n\n終わり');
});

await test('appendSection: 本文の末尾に見出し付きで足す（元の本文は残る）', () => {
  assert.equal(R.appendSection('元の本文\n\n', '調べた', '2026-11-05'),
    '元の本文\n\n── AI で調べた（11/5） ──\n調べた');
  assert.equal(R.appendSection('', '調べた', '2026-11-05'), '── AI で調べた（11/5） ──\n調べた');
  assert.equal(R.appendSection('元', '  ', '2026-11-05'), '元');
});

await test('lostUrls: 整理で消えた URL だけを返す', () => {
  const before = 'a https://a.jp/x\nb https://b.jp/y。';
  assert.deepEqual(R.lostUrls(before, 'まとめ https://a.jp/x'), ['https://b.jp/y']);
  assert.deepEqual(R.lostUrls(before, 'https://a.jp/x https://b.jp/y'), []);
});

await test('failLine: 切れた・検索エラー・空 を言い分ける', () => {
  assert.match(R.failLine('tidy', 'max_tokens', ''), /途中で切れた/);
  assert.match(R.failLine('research', 'end_turn', 'too_many_requests'), /Web 検索が使えなかった/);
  assert.match(R.failLine('research', 'end_turn', ''), /調べた結果が返ってこなかった/);
});

await test('キーが無いとき askFull は fetch せずに断る', async () => {
  mem.clear();
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(() => AI.askFull('s', 'u'), /API キーが入っていない/);
  assert.equal(called, 0);
});

await test('askFull: 本文のテキストと stop を返し、上限の max_tokens を送る', async () => {
  mem.clear();
  AI.setKey('sk-ant-TEST');
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: 'thinking' }, { type: 'text', text: '整えた' }], stop_reason: 'end_turn' }) };
  };
  const r = await AI.askFull('sys', 'user', { maxTokens: 8000 });
  assert.deepEqual(r, { text: '整えた', stop: 'end_turn' });
  assert.equal(sent.max_tokens, 8000);
  assert.equal(sent.messages[0].content, 'user');
  assert.ok(!JSON.stringify(sent).includes('sk-ant-TEST'), 'キーが本文に入っている');
  AI.setKey('');
});

await test('本文の面に AI のボタンがあり、キーが無いときの案内がある（js/bubble.js）', () => {
  const src = readFileSync(new URL('../js/bubble.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'AI で調べる'") && src.includes("'AI で整理'"));
  assert.ok(src.includes('設定の「ヘルプと AI」に Anthropic の API キーを入れると使える'));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/research.js'"), 'sw.js の ASSETS に js/research.js が無い');
});

console.log('');
console.log(pass + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
