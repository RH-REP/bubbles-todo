/* くりかえしの日付の計算（js/repeat.js。2026-11-19「7 つとも案どおり」。モック docs/spec/mock/dates.html） */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepeat, occursOn, nextDay, nextSpan, spanAt, upcoming, repeatLabel, nthOf, mdw } from '../js/repeat.js';

test('前の形（毎月くりかえす）は 期間・1 か月 として読む', () => {
  assert.deepEqual(normalizeRepeat({ every: 'month', from: '2026-08-25', to: '2026-09-03', n: 2 }),
    { every: 'month', step: 1, of: 'span', from: '2026-08-25', to: '2026-09-03', n: 2 });
  assert.equal(normalizeRepeat({ every: 'day', from: '2026-01-01' }), null);
  assert.equal(normalizeRepeat({ every: 'week', of: 'day', from: '2026-11-19', dows: [] }), null, '曜日が要る');
  assert.equal(normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-19' }), null, '日か第 n 曜日が要る');
});

test('毎週 月・木（2026-11-19 は木曜）', () => {
  const r = normalizeRepeat({ every: 'week', of: 'day', from: '2026-11-19', dows: [4, 1] });
  assert.deepEqual(r.dows, [1, 4]);
  assert.deepEqual(upcoming(r, '2026-11-19', 4), ['2026-11-19', '2026-11-23', '2026-11-26', '2026-11-30']);
  assert.equal(nextDay(r, '2026-11-19'), '2026-11-23');
  assert.equal(nextDay(r, '2026-11-19', '2026-11-25'), '2026-11-26', 'min より前は飛ばす');
  assert.equal(occursOn(r, '2026-11-16'), false, 'from より前は回にしない');
});

test('2 週ごと: from の週から 1 週おき', () => {
  const r = normalizeRepeat({ every: 'week', step: 2, of: 'day', from: '2026-11-19', dows: [1, 4] });
  assert.deepEqual(upcoming(r, '2026-11-19', 4), ['2026-11-19', '2026-11-30', '2026-12-03', '2026-12-14']);
});

test('毎月 31 日は月の長さでつぶす・第 3 木曜・最終金曜', () => {
  const a = normalizeRepeat({ every: 'month', of: 'day', from: '2026-01-01', mday: 31 });
  assert.deepEqual(upcoming(a, '2026-01-01', 4), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  const b = normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-01', nth: 3, dow: 4 });
  assert.deepEqual(upcoming(b, '2026-11-01', 3), ['2026-11-19', '2026-12-17', '2027-01-21']);
  const c = normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-01', nth: 5, dow: 5 });
  assert.deepEqual(upcoming(c, '2026-11-01', 2), ['2026-11-27', '2026-12-25']);
  assert.equal(nthOf('2026-11-26'), 4);
  assert.equal(nthOf('2026-10-30'), 5);
});

test('毎月 いくつかの日（2026-11-19「毎月の繰り返しを複数日付を選べる様にして」）。前の形 mday も読む', () => {
  const r = normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-01', mdays: [20, 5, 31, 5] });
  assert.deepEqual(r.mdays, [5, 20, 31]);
  assert.deepEqual(upcoming(r, '2026-11-01', 6), ['2026-11-05', '2026-11-20', '2026-11-30', '2026-12-05', '2026-12-20', '2026-12-31']);
  assert.equal(repeatLabel(r), '毎月 5・20・31 日');
  assert.deepEqual(normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-01', mday: 19 }).mdays, [19]);
});

test('終わりの日より後の回は作らない', () => {
  const r = normalizeRepeat({ every: 'week', of: 'day', from: '2026-11-19', dows: [4], until: '2026-12-01' });
  assert.deepEqual(upcoming(r, '2026-11-19', 5), ['2026-11-19', '2026-11-26']);
  assert.equal(nextDay(r, '2026-11-26'), null);
});

test('期間をずらす: 毎週・2 週ごと・毎月（月をまたぐ期間・月末）', () => {
  const w = normalizeRepeat({ every: 'week', of: 'span', from: '2026-11-23', to: '2026-11-27' });
  assert.deepEqual(spanAt(w, 1), { start: '2026-11-30', due: '2026-12-04' });
  const w2 = normalizeRepeat({ every: 'week', step: 2, of: 'span', from: '2026-11-23', to: '2026-11-27' });
  assert.deepEqual(spanAt(w2, 1), { start: '2026-12-07', due: '2026-12-11' });
  const m = normalizeRepeat({ every: 'month', from: '2026-01-31', to: '2026-02-03' });
  assert.deepEqual(nextSpan(m, '2026-03-01'), { start: '2026-02-28', due: '2026-03-03', n: 1 });
  const mu = normalizeRepeat({ every: 'month', from: '2026-11-25', to: '2026-12-03', until: '2026-12-31' });
  assert.deepEqual(nextSpan(mu, '2026-12-04'), { start: '2026-12-25', due: '2027-01-03', n: 1 });
  assert.equal(nextSpan(Object.assign({}, mu, { n: 1 }), '2027-01-04'), null, '終わりの日の後に始まる回は作らない');
});

test('札の言葉', () => {
  assert.equal(repeatLabel(null), 'なし');
  assert.equal(repeatLabel(normalizeRepeat({ every: 'week', of: 'day', from: '2026-11-19', dows: [1, 4] })), '毎週 月・木');
  assert.equal(repeatLabel(normalizeRepeat({ every: 'week', step: 2, of: 'day', from: '2026-11-19', dows: [3] })), '2 週ごと 水');
  assert.equal(repeatLabel(normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-19', mdays: [19] })), '毎月 19 日');
  assert.equal(repeatLabel(normalizeRepeat({ every: 'month', of: 'day', from: '2026-11-19', nth: 3, dow: 4 })), '毎月 第 3 木曜');
  assert.equal(repeatLabel(normalizeRepeat({ every: 'month', from: '2026-11-25', to: '2026-12-03' })), '毎月（期間）');
  assert.equal(mdw('2026-11-23'), '11/23（月）');
});
