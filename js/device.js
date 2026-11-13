/* この端末の呼び名（2026-11-13。前は js/csvio.js にあった。Issue #50 の返事「B」で CSV の書き出し・読み込みを外したので、ここへ移した）。
   引っ越しのファイル・決めたフォルダの控えの中身に「どの端末で書いたか」を入れるのに使う。DOM には触らない。
   テストは tests/device.test.mjs */

/* userAgent から大まかに。touchMac = 指で触れる Mac の形（iPad の Safari は Mac を名乗る） */
export function deviceLabel(ua, touchMac) {
  const s = String(ua || '');
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && touchMac)) return 'iPad';
  if (/Android/.test(s)) return 'Android';
  if (/Macintosh|Mac OS X/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  if (/Linux/.test(s)) return 'Linux';
  return '';
}
