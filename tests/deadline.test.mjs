/* 日付で見る（終了日の近い順。Issue #24）。node --test tests/deadline.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deadlineOf, deadlineRows, columnCount, columns, cellMark, inSpan, leftLabel, spanFromDetail, daysBetween,
  COLS_MIN, COLS_MAX,
} from '../js/deadline.js';
import { holidaysOf, holidayName } from '../js/holiday.js';

const T = '2026-11-07';

test('終了日は、今日から先の置いた日の最後', () => {
  const d = deadlineOf({ id: 'a', text: 'a', days: ['2026-11-01', '2026-11-10', '2026-11-08'] }, T);
  assert.equal(d.end, '2026-11-10');
  assert.deepEqual(d.days, ['2026-11-08', '2026-11-10']);   /* 過ぎた日は数えない */
});

test('過ぎた日しか無い・日が無い・完了・消したものは並べない', () => {
  assert.equal(deadlineOf({ days: ['2026-11-06'] }, T), null);
  assert.equal(deadlineOf({ days: [] }, T), null);
  assert.equal(deadlineOf({ days: ['2026-11-09'], done: true }, T), null);
  assert.equal(deadlineOf({ days: ['2026-11-09'], trashed: true }, T), null);
});

test('先の予定の本文の期間・日付も読む', () => {
  assert.deepEqual(spanFromDetail('期間: 2026-11-01 〜 2026-11-30（予定）\n先の予定: x'), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(spanFromDetail('日付: 2026-12-10（確定）'), { start: '2026-12-10', end: '2026-12-10' });
  assert.equal(spanFromDetail('メモ 期間: 2026-11-01 〜 2026-11-30'), null);    /* 行の頭だけ */
  assert.equal(spanFromDetail('日付: 2026-02-30'), null);                          /* 無い日 */
  const d = deadlineOf({ days: ['2026-11-20'], detail: '期間: 2026-11-01 〜 2026-11-30（予定）' }, T);
  assert.equal(d.end, '2026-11-30');
  assert.equal(d.from, 'detail');
  /* 終わった期間は使わない */
  assert.equal(deadlineOf({ days: [], detail: '期間: 2026-10-01 〜 2026-11-06' }, T), null);
});

test('近い順。同じ日は書いた順', () => {
  const rows = deadlineRows([
    { id: 'far', text: 'far', days: ['2026-12-01'], createdAt: 1 },
    { id: 'none', text: 'none', days: [] },
    { id: 'b', text: 'b', days: ['2026-11-09'], createdAt: 5 },
    { id: 'a', text: 'a', days: ['2026-11-09'], createdAt: 2 },
    { id: 'now', text: 'now', days: [T], createdAt: 9 },
  ], T);
  assert.deepEqual(rows.map(r => r.id), ['now', 'a', 'b', 'far']);
  assert.deepEqual(rows.map(r => r.left), [0, 2, 2, 24]);
});

test('列は2週間から60日まで、いちばん遠い終了日まで', () => {
  assert.equal(columnCount([{ left: 3 }]), COLS_MIN);
  assert.equal(columnCount([{ left: 24 }]), 25);
  assert.equal(columnCount([{ left: 400 }]), COLS_MAX);
  const c = columns('2026-11-29', 4);
  assert.deepEqual(c.map(x => x.key), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(c.map(x => x.m), ['11月', '', '12月', '']);
  assert.equal(c[0].wd, '日');
});

test('印と札', () => {
  const r = deadlineRows([{ id: 'x', text: 'x', days: ['2026-11-08'], detail: '期間: 2026-11-07 〜 2026-11-12' }], T)[0];
  assert.equal(cellMark(r, '2026-11-12'), 'end');
  assert.equal(cellMark(r, '2026-11-08'), 'day');
  assert.equal(cellMark(r, '2026-11-10'), 'span');
  assert.equal(cellMark(r, '2026-11-13'), '');
  assert.ok(inSpan(r, '2026-11-08') && inSpan(r, '2026-11-12') && !inSpan(r, '2026-11-13'));
  assert.equal(leftLabel(0), '今日');
  assert.equal(leftLabel(1), 'あした');
  assert.equal(leftLabel(5), 'あと5日');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);   /* 夏時間をまたいでもずれない */
});

/* 祝日（Issue #24 の返事）。内閣府の公表どおりの日 */
test('2026 年の祝日（振替休日・国民の休日を含む）', () => {
  const want = {
    '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日', '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日', '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
    '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日', '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
  };
  assert.deepEqual(Object.fromEntries([...holidaysOf(2026)].sort()), want);
});

test('2027 年の振替休日と春分・秋分', () => {
  assert.equal(holidayName('2027-03-21'), '春分の日');
  assert.equal(holidayName('2027-03-22'), '振替休日');
  assert.equal(holidayName('2027-09-23'), '秋分の日');
  assert.equal(holidayName('2027-11-24'), '');
  assert.equal(holidayName('2026-11-24'), '');
  assert.equal(holidayName('x'), '');
});

test('列に祝日と休みの印が付く', () => {
  const c = columns('2026-11-21', 4);   /* 土・日・月(勤労感謝の日)・火 */
  assert.deepEqual(c.map(x => [x.sat, x.off, x.hol]),
    [[true, false, ''], [false, true, ''], [false, true, '勤労感謝の日'], [false, false, '']]);
});
