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
const D = await import(new URL('../js/deadline.js', import.meta.url).href);

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

await test('名前: 頼む文に名前・本文・18 字の決めごとがある（Issue #11）', () => {
  const p = R.buildNamePrompt('来週の水曜までに区役所で住民票を2通とってくる', '');
  assert.match(p.user, /名前: 来週の水曜までに区役所で住民票を2通とってくる/);
  assert.match(p.user, /本文:\n（まだ無い）/);
  assert.match(p.system, /18 字以内/);
  assert.match(p.system, /本文に無いことは足さない/);
});

await test('cleanName: 1行目だけ・飾りを落とし・18 字で切る', () => {
  assert.equal(R.cleanName('「住民票を2通とる」。\n説明'), '住民票を2通とる');
  assert.equal(R.cleanName('名前: **区役所で住民票**'), '区役所で住民票');
  assert.equal(R.cleanName('\n\n- パスポート更新'), 'パスポート更新');
  assert.equal(Array.from(R.cleanName('あ'.repeat(30))).length, R.NAME_MAX);
  assert.equal(R.cleanName('  \n '), '');
});

await test('applyName: 本文が空で名前が長いときだけ、元の名前を本文へ移す', () => {
  const long = '来週の水曜までに区役所で住民票を2通とってくる';
  assert.deepEqual(R.applyName(long, '', '住民票を2通とる'), { name: '住民票を2通とる', detail: long });
  assert.deepEqual(R.applyName(long, '書いてある', '住民票を2通とる'), { name: '住民票を2通とる', detail: '書いてある' });
  assert.deepEqual(R.applyName('短い名前', '', '短い名'), { name: '短い名', detail: '' });
});

await test('本文の面に AI のボタンがあり、キーが無いときの案内がある（js/bubble.js）', () => {
  const src = readFileSync(new URL('../js/bubble.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'AI で調べる'") && src.includes("'AI で整理'") && src.includes("'AI で名前'"));
  assert.ok(src.includes('設定の「AI を使う設定をする」で AI の会社を選び、その API キーを入れると使える'));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/research.js'"), 'sw.js の ASSETS に js/research.js が無い');
});

await test('Issue の題名（#10）: 送るのはコメントの文だけで、題名1つ・字数の決めごとがある', () => {
  const p = R.buildIssueTitlePrompt('  iPhoneから送ると題名が長すぎる。本文の最初の文がそのまま入る  ');
  assert.equal(p.user, 'コメント:\niPhoneから送ると題名が長すぎる。本文の最初の文がそのまま入る');
  assert.ok(p.system.includes(R.ISSUE_TITLE_MAX + ' 字まで'));
  assert.ok(p.system.includes('1つだけ'));
  assert.ok(Array.from(R.buildIssueTitlePrompt('あ'.repeat(5000)).user).length < 4100, '長いコメントを切っていない');
});

await test('cleanIssueTitle: 前置き・括弧・句点・[画面ID] を外し、40 字で切る', () => {
  assert.equal(R.cleanIssueTitle('題名: 「改善のコメントの題名が長い」。\n説明'), '改善のコメントの題名が長い');
  assert.equal(R.cleanIssueTitle('[sea] **海で泡が重なる**'), '海で泡が重なる');
  assert.equal(R.cleanIssueTitle('タイトル：CSV の合言葉が分からない'), 'CSV の合言葉が分からない');
  assert.equal(Array.from(R.cleanIssueTitle('あ'.repeat(60))).length, R.ISSUE_TITLE_MAX);
  assert.equal(R.cleanIssueTitle(' \n '), '');
});

await test('右上の ! に「AI で題名」をつなぎ、キーが無ければ送らずに理由を返す（js/app.js）', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("makeTitleLabel: 'AI で題名'"));
  assert.ok(/makeTitle: async[\s\S]{0,80}if \(!hasKey\(\)\) throw/.test(src), 'キーの確かめが送る前に無い');
  assert.ok(src.includes('buildIssueTitlePrompt(comment)'));
});

/* ---- 書いて頼む（Issue #15 案 A）---- */
await test('書いて頼む: 送るのは名前と書いた文だけ（本文は入れようがない形）、JSON の形を頼む', () => {
  const p = R.buildAskPrompt(' ふるさと納税 ', ' 期限とお得な納税方法を調べて ', '2026-11-07');
  assert.equal(p.user, '名前: ふるさと納税\n頼みごと: 期限とお得な納税方法を調べて');
  assert.equal(R.buildAskPrompt.length, 3, '引数に本文が足されている（案 A は本文を送らない）');
  assert.ok(p.system.includes('今日は 2026-11-07'));
  assert.ok(p.system.includes('"deadline"') && p.system.includes('"todos"'));
  assert.ok(p.system.includes('出典: '));
  assert.equal(Array.from(R.buildAskPrompt('a', 'あ'.repeat(900), '2026-11-07').user.split('頼みごと: ')[1]).length, R.ASK_MAX);
});

await test('parseAskReply: まとめと JSON を分け、期限・候補をそろえる', () => {
  const txt = '## 期限\n- **12/31** まで\n出典: https://example.com/a\n\n```json\n'
    + '{"deadline":"2026-12-31","todos":["・寄付先を選ぶ。","寄付先を選ぶ","ワンストップ特例の申請書を出す","' + 'あ'.repeat(40) + '","","x","y","z"]}\n```';
  const r = R.parseAskReply(txt, '2026-11-07');
  assert.equal(r.summary, '【期限】\n・12/31 まで\n出典: https://example.com/a');
  assert.equal(r.deadline, '2026-12-31');
  assert.deepEqual(r.todos.slice(0, 2), ['寄付先を選ぶ', 'ワンストップ特例の申請書を出す']);
  assert.equal(Array.from(r.todos[2]).length, R.TODO_NAME_MAX);
  assert.equal(r.todos.length, R.TODO_MAX);
});

await test('parseAskReply: JSON が無い・壊れている・期限が過ぎた・日付でないときは、まとめだけ', () => {
  assert.deepEqual(R.parseAskReply('まとめだけ', '2026-11-07'), { summary: 'まとめだけ', deadline: null, todos: [] });
  const bad = R.parseAskReply('本文\n```json\n{"deadline": "2026-12-31", todos: [}\n```', '2026-11-07');
  assert.equal(bad.summary, '本文'); assert.equal(bad.deadline, null); assert.deepEqual(bad.todos, []);
  assert.equal(R.parseAskReply('a\n```json\n{"deadline":"2026-10-01","todos":[]}\n```', '2026-11-07').deadline, null);
  assert.equal(R.parseAskReply('a\n```json\n{"deadline":"2026-02-30","todos":[]}\n```', '2026-11-07').deadline, null);
  assert.equal(R.parseAskReply('a\n```json\n{"deadline":null,"todos":[1,"b"]}\n```', '2026-11-07').todos.join(), 'b');
  const bare = R.parseAskReply('まとめ\n{"deadline":"2026-12-31","todos":["申請する"]}', '2026-11-07');
  assert.equal(bare.summary, 'まとめ'); assert.equal(bare.deadline, '2026-12-31'); assert.deepEqual(bare.todos, ['申請する']);
});

await test('leadDay: 期限の 3 日前。それが過ぎていれば今日、期限が過ぎていれば null', () => {
  assert.equal(R.leadDay('2026-12-31', '2026-11-07'), '2026-12-28');
  assert.equal(R.leadDay('2027-01-02', '2026-11-07'), '2026-12-30');
  assert.equal(R.leadDay('2026-11-08', '2026-11-07'), '2026-11-07');
  assert.equal(R.leadDay('2026-11-07', '2026-11-07'), '2026-11-07');
  assert.equal(R.leadDay('2026-11-06', '2026-11-07'), null);
  assert.equal(R.leadDay('bad', '2026-11-07'), null);
});

await test('askSectionText・relatedDetail: 頼んだことと元の名前を残す', () => {
  assert.equal(R.askSectionText('期限を調べて\n2行目', 'まとめ'), '頼んだこと: 期限を調べて\nまとめ');
  const withD = R.askSectionText('期限を調べて', 'まとめ', '2026-12-31');
  assert.equal(withD, '頼んだこと: 期限を調べて\n日付: 2026-12-31（期限）\nまとめ');
  assert.equal(D.spanFromDetail('前の本文\n\n' + withD).end, '2026-12-31', '日付で見るが期限を読めない');
  assert.equal(R.askSectionText('x', 'y', 'bad'), '頼んだこと: x\ny');
  assert.equal(R.relatedDetail('ふるさと納税', '2026-11-07'), '元: ふるさと納税\n（AI の案から作った。11/7）');
});

await test('本文の面に「送る」欄をつなぎ、送るのは buildAskPrompt(name, request, today) だけ（js/bubble.js）', () => {
  const src = readFileSync(new URL('../js/bubble.js', import.meta.url), 'utf8');
  assert.ok(src.includes("run('ask')"));
  assert.ok(src.includes('buildAskPrompt(name, request, today)'), '書いて頼むで本文を送っている');
  assert.ok(/cb\.checked = false/.test(src), '候補が既定で選ばれている');
  assert.ok(!/el\('span', '', label\)/.test(src), 'AI の文を innerHTML に入れている');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('addRelated:') && app.includes('removeTodo:'));
});

console.log('');
console.log(pass + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
