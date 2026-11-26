/* ほかの app の束を引っ越しのファイルで運ぶ（2026-11-18 ユーザーの決定「案Cで進めて」。取り決め §8.3）。
   日記（diary）は bubble の記録（海）にも画面にも入れない。引っ越しのファイルの apps.diary に、diary の束（§8.1）をそのまま入れて運ぶ。
     作るとき  … GET <diary>/api/export（diary のクッキーで本人）→ apps.diary。diary にログインしていなければ 401 → 入れずに知らせる
     読むとき  … apps.diary を POST <diary>/api/import へ渡す → {ok, added, updated, kept}（日ごとに新しい版を残す。消さない）
   知らない app の束は、ファイルの中でそのまま運ぶ（読むときは、知っている app にだけ渡す）。
   DOM は触らない。テストは tests/appbundles.test.mjs（fetch を差し替える） */
import { appUrls } from './apps.js';

/* 運び先を知っている app → その住所の根を返す関数 */
const KNOWN = { diary: (urls) => urls.diary || '' };

function isBundle(b, app) {
  return !!(b && typeof b === 'object' && !Array.isArray(b) && b.app === app && b.data && typeof b.data === 'object');
}

/* 束の要約（日記の日の数）。形が違えば 0 */
export function diaryDays(b) {
  const e = isBundle(b, 'diary') && b.data.entries;
  return e && typeof e === 'object' && !Array.isArray(e) ? Object.keys(e).length : 0;
}

/* 作るとき: 運ぶ束を集める → { apps: {diary: 束}|{}, notes: ['…'] }。
   diary の住所が無ければ何もしない。届かない・ログインしていない・形が違うときは入れずに notes に書く（ファイルは作る） */
export async function collectApps({ urls = appUrls(), fetchFn = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  const apps = {};
  const notes = [];
  const base = KNOWN.diary(urls);
  if (!base || !fetchFn) return { apps, notes };
  let res;
  try {
    res = await fetchFn(base + '/api/export', { credentials: 'include', cache: 'no-store' });
  } catch (e) {
    notes.push('日記は入れていない（diary に届かない）');
    return { apps, notes };
  }
  if (res.status === 401) { notes.push('日記は入れていない（diary にログインしてから作り直すと入る）'); return { apps, notes }; }
  if (res.status !== 200) { notes.push('日記は入れていない（diary が断った ' + res.status + '）'); return { apps, notes }; }
  let b = null;
  try { b = await res.json(); } catch (e) { b = null; }
  if (!isBundle(b, 'diary')) { notes.push('日記は入れていない（diary の束の形が違う）'); return { apps, notes }; }
  apps.diary = b;
  notes.push('日記 ' + diaryDays(b) + ' 日分');
  return { apps, notes };
}

/* 読むとき: ファイルの apps を、知っている app に渡す → ['日記: 足した 3・新しくした 1・そのまま 9', …]。
   知らない app の束は渡さない（ファイルには残っている）。日記の中身は bubble の記録に入れない */
export async function deliverApps(apps, { urls = appUrls(), fetchFn = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  const out = [];
  if (!apps || typeof apps !== 'object' || Array.isArray(apps)) return out;
  const unknown = Object.keys(apps).filter(k => !KNOWN[k]);
  if (apps.diary !== undefined) {
    const base = KNOWN.diary(urls);
    if (!isBundle(apps.diary, 'diary')) out.push('日記: 形が違うので渡さなかった');
    else if (!base || !fetchFn) out.push('日記: diary の URL が分からないので渡さなかった（ファイルには残っている）');
    else {
      let res = null;
      try {
        res = await fetchFn(base + '/api/import', {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apps.diary),
        });
      } catch (e) { res = null; }
      let j = null;
      if (res) { try { j = await res.json(); } catch (e) { j = null; } }
      if (!res) out.push('日記: diary に届かなかった（あとで同じファイルを読み込み直せる）');
      else if (res.status === 401) out.push('日記: diary にログインしてから、同じファイルを読み込み直す');
      else if (res.status === 200 && j && j.ok) {
        out.push('日記: 追加した ' + (Number(j.added) || 0) + '・新しくした ' + (Number(j.updated) || 0) + '・そのまま ' + (Number(j.kept) || 0));
      } else out.push('日記: diary が断った（' + ((j && j.error) || res.status) + '）');
    }
  }
  if (unknown.length) out.push('このバージョンの知らない app（' + unknown.join('・') + '）の束は渡さなかった');
  return out;
}
