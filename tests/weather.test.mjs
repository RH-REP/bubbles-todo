/* 天気（日付で見るの列の見出し。Issue #30）。通信はしない（fetch は差し替え）。

     node --test tests/weather.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; },
  setItem(k, v) { mem.set(k, String(v)); },
  removeItem(k) { mem.delete(k); },
};

const W = await import('../js/weather.js');
const { POINTS, buildUrl, parseForecast, wxOf, forecastFor, sizeLabel, pointId, findPoint,
  loadArea, saveArea, loadData, fetchForecast, DATA_KEY, AREA_KEY } = W;

const DAYS = ['2026-11-08', '2026-11-09', '2026-11-10'];
function fake(n, codes = [0, 61, 3]) {
  return Array.from({ length: n }, (_, i) => ({
    latitude: POINTS[i] ? POINTS[i][3] : 0, longitude: POINTS[i] ? POINTS[i][4] : 0,
    daily_units: { time: 'iso8601' },
    daily: {
      time: DAYS, weather_code: codes, temperature_2m_max: [18.4, 12.5, null], temperature_2m_min: [9.6, 7, 5.2],
      precipitation_probability_max: [10, 80, null], precipitation_sum: [0, 12.34, null], wind_speed_10m_max: [3.4, 8.6, null],
    },
  }));
}

test('地点は約140。名前（ID）が重ならない・緯度経度が日本の中', () => {
  assert.ok(POINTS.length >= 130 && POINTS.length <= 150, String(POINTS.length));
  assert.equal(new Set(POINTS.map(pointId)).size, POINTS.length);
  POINTS.forEach(p => {
    assert.ok(p[3] > 20 && p[3] < 46 && p[4] > 122 && p[4] < 154, pointId(p));
  });
});

test('URL は全地点をいつも同じ形で頼む（選んだ地域が URL に出ない）', () => {
  const u = new URL(buildUrl());
  assert.equal(u.origin, 'https://api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude').split(',').length, POINTS.length);
  assert.equal(u.searchParams.get('longitude').split(',').length, POINTS.length);
  assert.equal(u.searchParams.get('forecast_days'), '7');
  assert.equal(u.searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'ms');
  assert.deepEqual(u.searchParams.get('daily').split(','), W.DAILY);
  assert.ok(W.DAILY.length <= 10);                  /* 10 を超えると回数を多めに数えられる */
  saveArea(5);
  assert.equal(buildUrl(), buildUrl(POINTS));       /* 選びは URL に効かない */
});

test('読み取り: 地点の数が違えば読めなかったことにする', () => {
  const d = parseForecast(fake(POINTS.length));
  assert.deepEqual(d.days, DAYS);
  assert.equal(d.pts.length, POINTS.length);
  assert.deepEqual(d.pts[0].hi, [18.4, 12.5, null]);
  assert.throws(() => parseForecast(fake(3)));
  assert.throws(() => parseForecast({ error: true, reason: 'x' }));
  /* 1地点だけ頼んだときは配列でなく物が返る */
  assert.equal(parseForecast(fake(1)[0], 1).pts.length, 1);
});

test('天気の番号 → 印と名前', () => {
  assert.equal(wxOf(0).name, '快晴');
  assert.equal(wxOf(3).name, 'くもり');
  assert.equal(wxOf(63).name, '雨');
  assert.equal(wxOf(73).name, '雪');
  assert.equal(wxOf(95).name, '雷雨');
  assert.equal(wxOf(null), null);
  assert.equal(wxOf(42).name, '不明');
});

test('その地点のその日の予報。四捨五入。無い日は null', () => {
  const d = parseForecast(fake(POINTS.length));
  assert.deepEqual(forecastFor(d, 0, '2026-11-08'), { icon: wxOf(0).icon, name: '快晴', hi: 18, lo: 10, pp: 10, pr: 0, wd: 3 });
  assert.deepEqual(forecastFor(d, 0, '2026-11-09'), { icon: wxOf(61).icon, name: '雨', hi: 13, lo: 7, pp: 80, pr: 12.3, wd: 9 });
  assert.equal(forecastFor(d, 0, '2026-11-10').hi, null);
  /* 前の版で取ったもの（降水確率などが無い）でも読める */
  const old = { days: DAYS, pts: [{ c: [3, 3, 3], hi: [10, 10, 10], lo: [5, 5, 5] }] };
  assert.deepEqual(forecastFor(old, 0, '2026-11-08'), { icon: wxOf(3).icon, name: 'くもり', hi: 10, lo: 5, pp: null, pr: null, wd: null });
  assert.equal(forecastFor(d, 0, '2026-12-01'), null);
  assert.equal(forecastFor(d, POINTS.length, '2026-11-08'), null);
  assert.equal(forecastFor(null, 0, '2026-11-08'), null);
});

test('日を押したときの1行。無い欄は書かない', () => {
  const d = parseForecast(fake(POINTS.length));
  assert.equal(W.detailText(forecastFor(d, 0, '2026-11-09')),
    wxOf(61).icon + ' 雨　最高 13℃／最低 7℃　降水確率 80%　降水量 12.3mm　風 最大 9m/s');
  assert.equal(W.detailText(forecastFor(d, 0, '2026-11-10')), wxOf(3).icon + ' くもり　最高 -℃／最低 5℃');
  assert.equal(W.detailText(null), '');
});

test('大きさの札', () => {
  assert.equal(sizeLabel(500), '500 B');
  assert.equal(sizeLabel(84 * 1024), '84 KB');
  assert.equal(sizeLabel(1.5 * 1024 * 1024), '1.5 MB');
});

test('地域は名前で覚える。知らない名前は選んでいないことにする', () => {
  saveArea(findPoint('東京都/東京地方'));
  assert.equal(mem.get(AREA_KEY), '東京都/東京地方');
  assert.equal(POINTS[loadArea()][2], '東京');
  mem.set(AREA_KEY, '無い県/無い地方');
  assert.equal(loadArea(), -1);
  saveArea(-1);
  assert.equal(mem.has(AREA_KEY), false);
});

test('取得: 全地点の URL を1回だけ頼み、端末に置く。大きさも覚える', async () => {
  const calls = [];
  const body = JSON.stringify(fake(POINTS.length));
  const got = await fetchForecast(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => body };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, buildUrl());
  assert.equal(calls[0].init.method, undefined);           /* GET。本文を送らない */
  assert.equal(got.bytes, new TextEncoder().encode(body).length);
  assert.deepEqual(loadData().days, DAYS);
  assert.ok(mem.has(DATA_KEY));
});

test('取得: 断られた・届かないときは理由を投げ、前のものは消さない', async () => {
  const before = mem.get(DATA_KEY);
  await assert.rejects(fetchForecast(async () => ({ ok: false, status: 429, text: async () => '{"reason":"Daily API request limit exceeded"}' })),
    /429：Daily API request limit exceeded/);
  await assert.rejects(fetchForecast(async () => { throw new TypeError('Failed to fetch'); }), /届かなかった/);
  assert.equal(mem.get(DATA_KEY), before);
});
