/* 今日のおすすめの計算（js/suggest.js。Issue #12）を見るテスト。素の Node と assert だけ。

     node tests/suggest.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const S = await import(new URL('../js/suggest.js', import.meta.url).href);

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const NOW = new Date(2026, 10, 7, 9).getTime();
const DAY = 86400000;
const TODAY = '2026-11-07';

function item(o) {
  return Object.assign({ id: 'x', text: '名前', days: [], done: false, trashed: false, hold: false, anchors: [],
    urgent: null, important: null, fav: false, createdAt: NOW - 30 * DAY, started: {} }, o);
}
const cand = (o, info) => S.describe(item(o), info || {});

await test('候補にしない: 完了・消した・保留・もうその日にある・きっかけ付き・名前が空', () => {
  assert.equal(S.eligible(item({}), TODAY), true);
  assert.equal(S.eligible(item({ done: true }), TODAY), false);
  assert.equal(S.eligible(item({ trashed: true }), TODAY), false);
  assert.equal(S.eligible(item({ hold: true }), TODAY), false);
  assert.equal(S.eligible(item({ days: [TODAY] }), TODAY), false);
  assert.equal(S.eligible(item({ days: ['2026-11-06'] }), TODAY), true);
  assert.equal(S.eligible(item({ anchors: ['a1'] }), TODAY), false);
  assert.equal(S.eligible(item({ text: '  ' }), TODAY), false);
});

await test('規則: 急ぐ・大事が上、最近はじめた・次の一手・お気に入りで足す。理由は2つまで', () => {
  const list = [
    cand({ id: 'a', text: 'ふつう' }),
    cand({ id: 'b', text: '両方', urgent: true, important: true }),
    cand({ id: 'c', text: '大事', important: true, fav: true }, { firstStep: true }),
    cand({ id: 'd', text: '最近', started: { _: NOW - 2 * DAY } }),
  ];
  const r = S.rank(list, NOW);
  assert.deepEqual(r.map(c => c.id), ['b', 'c', 'd', 'a']);
  assert.equal(r[0].reason, '急ぐ・大事');
  assert.equal(r[1].reason, '大事・次の一手が書いてある');
  assert.equal(r[2].reason, '最近はじめた');
});

await test('端末だけ: 点の付いたものが少なければ、新しく書いたもので 3 件まで埋める', () => {
  const list = [
    cand({ id: 'old', createdAt: NOW - 90 * DAY }),
    cand({ id: 'new', createdAt: NOW - 1 * DAY }),
    cand({ id: 'mid', createdAt: NOW - 10 * DAY }),
    cand({ id: 'u', urgent: true }),
  ];
  const p = S.localPicks(list, NOW);
  assert.deepEqual(p.map(c => c.id), ['u', 'new', 'mid']);
  assert.equal(p[1].reason, '最近書いた');
});

await test('端末だけ: 多くても 5 件まで', () => {
  const list = Array.from({ length: 12 }, (_, i) => cand({ id: 'i' + i, urgent: true }));
  assert.equal(S.localPicks(list, NOW).length, S.PICK_MAX);
});

await test('送る候補は 30 件まで', () => {
  const list = Array.from({ length: 50 }, (_, i) => cand({ id: 'i' + i }));
  assert.equal(S.sendList(list, NOW).length, 30);
});

await test('送る文: 名前と印だけ。本文・次の一手の文・リンク・ひとことは入らない', () => {
  const t = item({ text: '年賀状を出す', urgent: true, fav: true, detail: '秘密の本文', firstStep: '住所録を開く',
    url: 'https://example.com/x', started: { _: new Date(2026, 10, 1, 12).getTime() } });
  const c = S.describe(t, { tags: ['家'], firstStep: true });
  assert.equal('detail' in c || 'url' in c, false);
  const p = S.buildSuggestPrompt([c], TODAY);
  assert.match(p.user, /1\. 年賀状を出す ［急ぐ、お気に入り、次の一手あり、タグ:家、作った日:2026-10-08、最後にはじめた日:2026-11-01］/);
  assert.doesNotMatch(p.user + p.system, /秘密の本文|住所録を開く|example\.com/);
  assert.match(p.system, /2026-11-07（土）/);
  assert.match(p.system, /命令形/);
  assert.match(p.system, /JSON/);
});

await test('返事を読む: 番号で候補に戻し、重なり・範囲外は落とす。囲みや前置きがあっても読む', () => {
  const cs = [cand({ id: 'a', text: 'A' }), cand({ id: 'b', text: 'B', urgent: true })].map(c => Object.assign(c, S.scoreOf(c, NOW)));
  const txt = 'はい\n```json\n[{"n":2,"reason":"期限が近そう"},{"n":2,"reason":"重なり"},{"n":9,"reason":"外"},{"n":1,"reason":"冬の前に"}]\n```';
  const r = S.parseSuggest(txt, cs);
  assert.deepEqual(r.map(c => c.id), ['b', 'a']);
  assert.equal(r[0].reason, '期限が近そう');
  assert.equal(r[0].ai, true);
  assert.equal(S.parseSuggest('読めない', cs), null);
});

await test('理由: 命令形・責める言い方は捨てて規則の理由に戻す。24 字で切る', () => {
  assert.equal(S.cleanReason('今日やりましょう'), '');
  assert.equal(S.cleanReason('3日放置している'), '');
  assert.equal(S.cleanReason('季節に合う。'), '季節に合う');
  assert.equal(Array.from(S.cleanReason('あ'.repeat(40))).length, S.REASON_MAX);
  const cs = [Object.assign(cand({ id: 'b', urgent: true }), { reason: '急ぐ' })];
  assert.equal(S.parseSuggest('[{"n":1,"reason":"すぐやるべき"}]', cs)[0].reason, '急ぐ');
});

await test('今日の画面: 自動では置かず、[AI で選び直す] を押したときだけ送る', () => {
  const src = readFileSync(new URL('../js/screens/today.js', import.meta.url), 'utf8');
  const open = src.slice(src.indexOf('function toggleSuggest'), src.indexOf('function closeSuggest'));
  assert.doesNotMatch(open, /askFull|setDay/);
  const ask = src.slice(src.indexOf('async function askSuggest'));
  assert.match(ask.slice(0, ask.indexOf('askFull')), /if \(!hasKey\(\)\)/);
  assert.match(src, /押すと、候補の泡の名前と印（30 件まで）を設定で選んだ AI の会社へ送る/);
});

console.log('\n' + pass + ' passed, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
