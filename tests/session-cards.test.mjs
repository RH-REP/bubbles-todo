/* Claude のセッションから泡を作る CLI（tools/session-cards.mjs）のテスト。素の Node と assert だけで走る。

     node tests/session-cards.test.mjs

   架空のセッション記録を一時フォルダに作って読む。本物の記録（ホームの下）は読まない。
   「端末」は store.js を読み直した別のモジュールで表す（csvio.test.mjs と同じやり方）。 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSession, listCandidates, writeCards, readState, cardId, dayAfter, humanText } from '../tools/session-cards.mjs';
import { readCsv, importInto, parseCsv } from '../js/csvio.js';

const STORE_URL = new URL('../js/store.js', import.meta.url).href;
const TOOL = fileURLToPath(new URL('../tools/session-cards.mjs', import.meta.url));
const mem = new Map();
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
const REAL_NOW = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? REAL_NOW.call(Date) : fakeNow);
const D = new Date(2026, 10, 7, 10, 0).getTime();
let seq = 0;
async function device(now = D) {
  mem.clear();
  fakeNow = now;
  return (await import(`${STORE_URL}?case=${++seq}`)).store;
}

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* ---------- 架空のセッション記録 ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cards-'));
const PROJ = path.join(TMP, 'projects');
const SID1 = '11111111-2222-3333-4444-555555555555';
const SID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SID3 = '99999999-0000-0000-0000-000000000000';   /* 人の質問なし */
const SID4 = '77777777-0000-0000-0000-000000000000';   /* 古い */

const human = (text, ts, extra = {}) => ({
  parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text },
  timestamp: ts, origin: { kind: 'human' }, cwd: '/somewhere', sessionId: 'x', ...extra,
});
const long = 'あ'.repeat(350);

function writeSession(dir, sid, lines, mtime) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(f, lines.map(o => JSON.stringify(o)).join('\n') + '\n');
  const t = new Date(mtime);
  fs.utimesSync(f, t, t);
  return f;
}

const now = Date.now();
const A = path.join(PROJ, '-proj-a');
const B = path.join(PROJ, '-proj-b');
writeSession(A, SID1, [
  { type: 'custom-title', customTitle: '古い題名', sessionId: SID1 },
  /* 人の質問ではないもの */
  human('<system-reminder>だれかの差し込み</system-reminder>', '2026-11-05T01:00:00.000Z'),
  human('<command-name>/clear</command-name>', '2026-11-05T01:00:01.000Z'),
  { ...human('ツールの結果', '2026-11-05T01:00:02.000Z'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ツールの結果' }] } },
  { ...human('サブエージェントへの指示', '2026-11-05T01:00:03.000Z'), isSidechain: true },
  { ...human('ほかのエージェントの報告', '2026-11-05T01:00:04.000Z'), origin: { kind: 'peer' } },
  { ...human('origin の無い行', '2026-11-05T01:00:05.000Z'), origin: undefined },
  { type: 'assistant', message: { content: [{ type: 'text', text: '"type":"user" を含む返事' }] }, timestamp: '2026-11-05T01:00:06.000Z' },
  /* 人の質問（配列。差し込みを取り除いて text を連結） */
  { ...human('', '2026-11-05T01:01:00.000Z'), message: { role: 'user', content: [
    { type: 'text', text: '<system-reminder>前置き</system-reminder>\n潮の満ち引きは' },
    { type: 'image', source: {} },
    { type: 'text', text: long },
  ] } },
  human('二つ目の質問', '2026-11-05T02:00:00.000Z'),
  { type: 'custom-title', customTitle: '潮の満ち引き', sessionId: SID1 },
], now - 1 * 86400000);
writeSession(B, SID2, [
  human('三日月はなぜ欠ける？', '2026-11-06T03:00:00.000Z'),
], now - 2 * 3600000);
writeSession(B, SID3, [
  { type: 'custom-title', customTitle: '質問なし', sessionId: SID3 },
  { ...human('<command-name>/model</command-name>', '2026-11-06T04:00:00.000Z') },
], now - 3600000);
writeSession(A, SID4, [human('古い質問', '2026-10-01T00:00:00.000Z')], now - 30 * 86400000);
/* フォルダの下のサブフォルダ（subagents など）は読まない */
writeSession(path.join(A, SID1, 'subagents'), 'agent-zzz', [human('下のもの', '2026-11-06T00:00:00.000Z')], now);

await test('人の質問の取り出し: 差し込み・ツールの結果・sidechain・human でない origin を外す。題名は最後のもの', async () => {
  const s = await readSession(path.join(A, SID1 + '.jsonl'));
  assert.equal(s.title, '潮の満ち引き');
  assert.equal(s.questions, 2);
  assert.ok(s.firstQuestion.startsWith('潮の満ち引きは\n'), s.firstQuestion.slice(0, 20));
  assert.ok(!s.firstQuestion.includes('前置き'));
  assert.equal(s.firstQuestion, '潮の満ち引きは\n' + long);
  assert.equal(Array.from(s.firstQuestionShort).length, 301, '300 字＋…');
  assert.ok(s.firstQuestionShort.endsWith('…'));
  assert.equal(s.firstAt, '2026-11-05T01:00:00.000Z');
  assert.equal(s.lastAt, '2026-11-05T02:00:00.000Z');
  assert.equal(s.project, '-proj-a');
  assert.equal(humanText({ type: 'user', isSidechain: false, origin: { kind: 'human' }, message: { content: '<local-command-stdout>x</local-command-stdout>' } }), null);
});

await test('list: 期間内・質問ありだけを新しい順に。状態ファイルにあるものは出ない', async () => {
  const statePath = path.join(TMP, 'st1', 'state.json');
  let l = await listCandidates({ projectsDir: PROJ, statePath, sinceDays: 7 });
  assert.deepEqual(l.map(s => s.sessionId), [SID2, SID1], '質問なし・古いもの・サブフォルダは出ない');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ [SID2]: { state: 'skipped', at: 'x' } }));
  l = await listCandidates({ projectsDir: PROJ, statePath, sinceDays: 7 });
  assert.deepEqual(l.map(s => s.sessionId), [SID1]);
  l = await listCandidates({ projectsDir: PROJ, statePath: path.join(TMP, 'none.json'), sinceDays: 60 });
  assert.ok(l.some(s => s.sessionId === SID4), '期間を広げれば古いものも出る');
});

await test('csv: 書いた CSV を「足す」で読むと、長期保留・次の一手・本文つきの泡が入り、2回読んでも増えない', async () => {
  const statePath = path.join(TMP, 'st2', 'state.json');
  const r = await writeCards([
    { sessionId: SID1, question: '潮の満ち引きは月だけで決まる？', next: '気象庁の潮位表を1つ開く' },
    { sessionId: SID2, skip: true },
  ], { projectsDir: PROJ, statePath, days: 3, now: D });
  assert.ok(r.out && r.out.startsWith(path.dirname(statePath)), '既定は状態ファイルの隣');
  assert.match(path.basename(r.out), /^bubbles-sessions-20261107-1000\.csv$/);
  assert.deepEqual(r.carded, [cardId(SID1)]);
  assert.equal(cardId(SID1), 'cs-111111112222');
  const csv = fs.readFileSync(r.out, 'utf8');
  assert.ok(csv.startsWith('﻿kind,id,text,date,data,stamp\r\n'));
  assert.equal(parseCsv(csv)[1][0], 'meta');

  const st = readState(statePath);
  assert.equal(st[SID1].state, 'carded');
  assert.equal(st[SID2].state, 'skipped');

  const dev = await device(D + 1000);
  const before = dev.all().length;
  const got = readCsv(csv);
  const r1 = importInto(dev.exportState(), got, 'add', D + 1000);
  assert.equal(r1.added, 1);
  dev.applyState(r1.state);
  const t = dev.get(cardId(SID1));
  assert.ok(t, '泡が入る');
  assert.equal(t.text, '潮の満ち引きは月だけで決まる？');
  assert.equal(dev.firstStepOf(t.id), '気象庁の潮位表を1つ開く');
  assert.equal(t.hold, true);
  assert.equal(dev.holdUntil(t.id), '2026-11-10');
  assert.equal(dayAfter(D, 3), '2026-11-10');
  assert.ok(dev.holds().some(x => x.id === t.id), '長期保留の海に出る');
  const lines = dev.detailOf(t.id).split('\n');
  assert.equal(lines[0], 'Claude セッション: 潮の満ち引き');
  assert.equal(lines[1], '最初の質問: 潮の満ち引きは');
  assert.equal(lines[lines.length - 1], 'session: ' + SID1);
  assert.ok(dev.detailOf(t.id).includes('あ'.repeat(10) + '…'));
  assert.equal(dev.all().length, before + 1);

  const r2 = importInto(dev.exportState(), readCsv(csv), 'add', D + 2000);
  assert.equal(r2.added, 0, '同じ CSV を2回読んでも増えない');
  dev.applyState(r2.state);
  assert.equal(dev.all().length, before + 1);

  /* 読み込み直後の記録が normalizeTodo を通っても変わらない（CSV の中身そのまま） */
  const raw = got.recs.get('todo:' + t.id);
  const saved = dev.exportState().doc.todos.find(x => x.id === t.id);
  for (const k of Object.keys(raw)) assert.deepEqual(saved[k], raw[k], k);

  /* 同じセッションをもう一度書いても同じ id（2つ目の CSV を読んでも増えない） */
  const again = await writeCards([{ sessionId: SID1, question: '書き直した問い', next: '' }], { projectsDir: PROJ, statePath, out: path.join(TMP, 'again.csv'), now: D + 60000 });
  assert.deepEqual(again.carded, [cardId(SID1)]);
  const r3 = importInto(dev.exportState(), readCsv(fs.readFileSync(again.out, 'utf8')), 'add');
  assert.equal(r3.added, 0);
});

await test('csv: 形の違うカードはわけを付けて断り、何も書かない', async () => {
  const statePath = path.join(TMP, 'st3', 'state.json');
  await assert.rejects(writeCards([{ sessionId: SID1, question: '' }], { projectsDir: PROJ, statePath }), /question が空/);
  await assert.rejects(writeCards([{ sessionId: 'nope', question: 'q' }], { projectsDir: PROJ, statePath }), /見つからない/);
  await assert.rejects(writeCards([{ sessionId: '../x', question: 'q' }], { projectsDir: PROJ, statePath }), /形が違う/);
  await assert.rejects(writeCards({}, { projectsDir: PROJ, statePath }), /配列/);
  assert.ok(!fs.existsSync(statePath));
  /* 見送りだけなら CSV は書かず、状態だけ足す */
  const r = await writeCards([{ sessionId: SID2, skip: true }], { projectsDir: PROJ, statePath });
  assert.equal(r.out, null);
  assert.equal(readState(statePath)[SID2].state, 'skipped');
});

await test('コマンドとして: list --json と csv が動く', async () => {
  const statePath = path.join(TMP, 'st4', 'state.json');
  const run = (...a) => execFileSync(process.execPath, [TOOL, ...a], { encoding: 'utf8' });
  const list = JSON.parse(run('list', '--json', '--projects-dir', PROJ, '--state', statePath));
  assert.deepEqual(list.map(s => s.sessionId), [SID2, SID1]);
  assert.ok(run('list', '--projects-dir', PROJ, '--state', statePath).includes('潮の満ち引き'));
  const cards = path.join(TMP, 'cards.json');
  fs.writeFileSync(cards, JSON.stringify([{ sessionId: SID2, question: '月の満ち欠けの仕組みは？', next: '図を1枚描く' }]));
  const out = path.join(TMP, 'out.csv');
  run('csv', cards, '--days', '5', '--out', out, '--projects-dir', PROJ, '--state', statePath);
  const got = readCsv(fs.readFileSync(out, 'utf8'));
  assert.equal(got.recs.get('todo:' + cardId(SID2)).text, '月の満ち欠けの仕組みは？');
  assert.equal(got.meta.device, 'Claude セッション');
  const after = JSON.parse(run('list', '--json', '--projects-dir', PROJ, '--state', statePath));
  assert.deepEqual(after.map(s => s.sessionId), [SID1], 'カードにしたものは次の list に出ない');
});

fs.rmSync(TMP, { recursive: true, force: true });
Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) { failed.forEach(n => console.log('  failed: ' + n)); process.exit(1); }
