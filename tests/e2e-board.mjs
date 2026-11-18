/* 泡の盤（取りかかる画面）の通しのテスト（2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」。モック docs/spec/mock/task-start.html）。

     node tests/e2e-board.mjs

   本物の Chrome（headless。前に出して、動きの描画を止めない）と、試し用の置き場の server.py で確かめる:
   1. 開いた時点で、始める・今日はここまで・完了にする・作業記録・日付・タグが見え、［書き留める］・次にやること・作業の記録の欄は無い
      （2026-11-19 ユーザーの指示: 次の一手・メモ・作業記録を、メモの位置の作業記録 1 つに）
   2. 個人の海ではコメント（前のひとこと）を出さない
   3. まれなもの（お気に入り・優先度・リンク・作業の記録・削除）は「その他」の中。開くと出る
   4. 作業記録から離れると保存し、「保存した」と出す。書き替えるたびに履歴に積み、［履歴を見る ›］で古い順に読める。1 行目が次にやること
   4b. 本文が無く次の一手だけある前の泡は、次の一手を作業記録の初めの中身として出す
   5. 前の版で置いた「名前だけ」の設定は、新しい既定に替わる
   6. 優先度は、押した札をもう一度押すと印が外れる（［印を外す］は無い）
   7. 日付の段（2026-11-19「7 つとも案どおり」。モック docs/spec/mock/dates.html）: やる日・期間・くりかえしの 3 つの札。
      1 つを開くとほかは閉じる。やる日は月の名前つきの暦と早く選ぶ札、期間は［開始日］［終了日］と同じ形の暦、
      くりかえしは 毎週＋曜日 で先の回を出し、閉じるときに書く（盤は閉じない・今日の海へ移らない間は盤のまま） */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-board-'));
const port = await freePort(), dbg = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', join(tmp, 'data'),
  '--auth', 'passkey', '--origin', origin], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

let ws, seq = 0;
const waiting = new Map();
const problems = [];
for (let i = 0; i < 50 && !ws; i++) {
  try { const p = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(p => p.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {}
  if (!ws) await sleep(200);
}
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const d = JSON.parse(e.data);
  if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (m, p = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result?.result?.value;
}
async function until(expr, ms = 8000) {
  const t0 = Date.now();
  const body = /^\s*return\b/.test(expr) ? expr : 'return ' + expr;
  while (Date.now() - t0 < ms) { if (await js(body).catch(() => false)) return true; await sleep(100); }
  throw new Error('待っても来なかった: ' + expr);
}
let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 1500, deviceScaleFactor: 1, mobile: true });
for (let i = 0; i < 50; i++) { try { await fetch(origin + '/'); break; } catch (e) { await sleep(200); } }

/* 見えているか（親が畳まれていても false） */
const VIS = `const vis = n => !!n && !!(n.offsetParent || n.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden';`;
async function openApp(prefs) {
  await send('Page.navigate', { url: origin + '/' });
  await until(`return !!document.querySelector('.userbtn')`, 15000);
  if (prefs !== undefined) {
    await js(`localStorage.setItem('bubble_todo_prefs_v1', ${JSON.stringify(JSON.stringify(prefs))}); location.reload();`);
    await sleep(500);
    await until(`return !!document.querySelector('.userbtn')`, 15000);
  }
}
async function openBoard(text) {
  await until(`return [...document.querySelectorAll('.bub')].some(b => b.textContent.includes(${JSON.stringify(text)}))`);
  await js(`const n = [...document.querySelectorAll('.bub')].find(b => b.textContent.includes(${JSON.stringify(text)}));
    (await import('/js/bubble.js')).centerBubble(n);`);
  await until(`return !!document.querySelector('.bc-fields .bc-act-start')`);
  await sleep(600);
}

try {
  await openApp();
  await js(`const { store } = await import('/js/store.js'); store.add('歯医者の予約をする');`);

  await step('開いた時点で、始める・今日はここまで・完了にする・作業記録・日付・タグが見え、［書き留める］・次にやること・作業の記録の欄は無い', async () => {
    await openBoard('歯医者');
    const got = await js(`${VIS} const f = document.querySelector('.bc-fields');
      const txt = s => [...f.querySelectorAll(s)].filter(vis).map(n => n.textContent.trim());
      return { lbs: txt('.bc-lb'), acts: txt('.bc-act'), more: txt('.bc-more'), name: vis(f.querySelector('.bc-name-in')),
        ok: !!f.querySelector('.bc-act-ok') || /書き留め/.test(f.textContent), start: vis(f.querySelector('.bc-act-start')) }`);
    assert.equal(got.name, true, '名前（題）');
    for (const l of ['作業記録', '日付', 'タグ']) assert.ok(got.lbs.includes(l), l + ' が見える: ' + got.lbs);
    for (const l of ['次にやること', 'メモ', '作業の記録']) assert.ok(!got.lbs.includes(l), l + ' の欄は無い: ' + got.lbs);
    assert.deepEqual(got.acts, ['始める5 分のタイマー', '今日はここまで', '✓ 完了にする']);
    assert.equal(got.ok, false, '［書き留める］は無い');
    assert.deepEqual(got.more, ['その他 ▾']);
    const heads = await js(`return [...document.querySelectorAll('.bc-dates .bc-cal-head')].filter(n => n.offsetParent).map(n => n.textContent.replace(/\\s+/g, ''))`);
    assert.deepEqual(heads, ['やる日未定', '期間未定', 'くりかえしなし']);
  });

  await step('個人の海ではコメントを出さない。まれなものは「その他」の中で、開くと出る', async () => {
    const got = await js(`${VIS} const f = document.querySelector('.bc-fields');
      return { chat: vis(f.querySelector('.bc-chat')), fav: vis(f.querySelector('[data-part="fav"]')), del: vis(f.querySelector('[data-part="del"]')) }`);
    assert.deepEqual(got, { chat: false, fav: false, del: false });
    await js(`document.querySelector('.bc-more').click();`);
    await sleep(300);
    const open = await js(`${VIS} const f = document.querySelector('.bc-fields');
      const after = [...f.children].slice([...f.children].indexOf(f.querySelector('.bc-more')) + 1).filter(vis).map(n => n.dataset.part).filter(Boolean);
      return { after, chat: vis(f.querySelector('.bc-chat')), del: f.querySelector('[data-part="del"]')?.textContent }`);
    assert.deepEqual(open.after, ['fav', 'prio', 'url', 'del'], '「その他」の中の並び');
    assert.equal(open.chat, false, '「その他」を開いてもコメントは出ない（個人の海）');
    assert.equal(open.del, '削除');
  });

  await step('優先度: 押した札をもう一度押すと印が外れる（［印を外す］は無い）', async () => {
    const got = await js(`${VIS} const box = document.querySelector('.bc-fields [data-part="prio"]');
      const u = [...box.querySelectorAll('.bc-prio-b')].find(b => b.dataset.key === 'urgent');
      u.click(); const on = u.getAttribute('aria-pressed'); u.click(); const off = u.getAttribute('aria-pressed');
      return { on, off, clear: vis(box.querySelector('.bc-prio-clear')), note: /まだ分けていない/.test(box.textContent) }`);
    assert.deepEqual(got, { on: 'true', off: 'false', clear: false, note: false });
  });

  await step('作業記録から離れると保存し「保存した」と出す。書き替えるたびに履歴に積み、［履歴を見る ›］で読める。1 行目が次にやること', async () => {
    const write = (t) => js(`const m = document.querySelector('.bc-fields .bc-memo-in'); m.focus(); m.value = ${JSON.stringify(t)};
      m.dispatchEvent(new Event('input', { bubbles: true })); m.blur();`);
    const of = (fn) => js(`const { store } = await import('/js/store.js'); const id = store.all().find(t => t.text === '歯医者の予約をする').id; return store.${fn}(id);`);
    assert.equal(await js(`${VIS} return vis(document.querySelector('.bc-fields .bc-hist-open'))`), false, '記録が無い間は［履歴を見る ›］を出さない');
    await write('予約の電話をかける\n保険証を持っていく');
    await until(`return document.querySelector('.bc-saved')?.textContent === '保存した'`);
    assert.equal(await of('detailOf'), '予約の電話をかける\n保険証を持っていく');
    assert.equal(await of('firstStepOf'), '予約の電話をかける', '1 行目が次にやること');
    await write('電話した。木曜 10 時\n保険証を持っていく');
    await until(`return (async () => { const { store } = await import('/js/store.js'); return store.stepsOf(store.all().find(t => t.text === '歯医者の予約をする').id).length === 2; })()`);
    assert.equal(await of('firstStepOf'), '電話した。木曜 10 時');
    await write('電話した。木曜 10 時\n保険証を持っていく');   /* 同じ中身では積まない */
    await sleep(300);
    assert.equal((await of('stepsOf')).length, 2, '変わっていなければ積まない');
    /* 見出しの行の［履歴を見る ›］ */
    const head = await js(`${VIS} const h = document.querySelector('.bc-fields .bc-memo-in').parentElement.querySelector('.bc-lb-row');
      return [...h.children].filter(vis).map(n => n.textContent.trim())`);
    assert.deepEqual(head, ['作業記録', '履歴を見る ›', '全体を開く ›']);
    await js(`document.querySelector('.bc-fields .bc-hist-open').click();`);
    await until(`return !!document.querySelector('.bc-hist:not([hidden]) .bh-item')`);
    const hist = await js(`return { title: document.querySelector('.bc-hist .bh-title').textContent,
      items: [...document.querySelectorAll('.bc-hist .bh-item')].map(li => [...li.querySelectorAll('.bh-line')].map(l => l.querySelector('.bh-k').textContent + ':' + l.querySelector('.bh-v').textContent)) }`);
    assert.equal(hist.title, '作業記録の履歴');
    assert.deepEqual(hist.items, [['作業記録:予約の電話をかける\n保険証を持っていく'], ['作業記録:電話した。木曜 10 時\n保険証を持っていく']], '古い順に、1 つの文として');
    await js(`document.querySelector('.bc-hist .bh-close').click();`);
    assert.ok(await js(`return !!document.querySelector('.bc-fields .bc-act-start')`), '盤は開いたまま');
  });

  await step('本文が無く次の一手だけある前の泡は、次の一手を作業記録の初めの中身として出す（触らなければ書かない）', async () => {
    await js(`const { store } = await import('/js/store.js'); store.add('前の形の泡');
      const id = store.all().find(t => t.text === '前の形の泡').id; store.setFirstStep(id, '書類をそろえる');`);
    await sleep(300);
    await openApp();                       /* 前の盤を閉じてから開く */
    await openBoard('前の形の泡');
    assert.equal(await js(`return document.querySelector('.bc-fields .bc-memo-in').value`), '書類をそろえる');
    await js(`document.querySelector('.bc-fields .bc-memo-in').focus(); document.querySelector('.bc-fields .bc-memo-in').blur();`);
    await sleep(300);
    assert.equal(await js(`const { store } = await import('/js/store.js'); const id = store.all().find(t => t.text === '前の形の泡').id;
      return store.detailOf(id) + '|' + store.stepsOf(id).length`), '|0');
  });

  await step('日付の段: 3 つの札。やる日は月の名前つきの暦（前の月へは戻れない）と早く選ぶ札。1 つを開くとほかは閉じる', async () => {
    await openApp();
    await js(`const { store } = await import('/js/store.js'); store.add('架空のゴミ出し'); store.add('架空の請求書');`);
    await openBoard('架空のゴミ出し');
    const tile = (i) => js(`document.querySelectorAll('.bc-dates .bc-cal-head')[${i}].click()`);
    const exp = () => js(`return [...document.querySelectorAll('.bc-dates .bc-date-box:not([hidden]) > .bc-cal-head')].map(h => h.getAttribute('aria-expanded'))`);
    await tile(0);
    const cal = await js(`const b = document.querySelector('.bc-cal .bc-cal-body'); return { hidden: b.hidden, ttl: b.querySelector('.bc-mcal-ttl').textContent,
      prev: b.querySelector('.bc-mcal-nav').disabled, today: b.querySelector('.bc-cal-d.is-today')?.dataset.key, quick: [...b.querySelectorAll('.bc-cal-quick button')].map(x => x.textContent) }`);
    const now = await js(`const { store } = await import('/js/store.js'); return store.todayKey()`);
    assert.equal(cal.hidden, false);
    assert.equal(cal.ttl, Number(now.slice(0, 4)) + '年' + Number(now.slice(5, 7)) + '月');
    assert.equal(cal.prev, true, '前の月へは戻れない（過ぎた日は変えられない）');
    assert.equal(cal.today, now);
    assert.deepEqual(cal.quick, ['今日', '明日', '今度の土曜', '未定にする']);
    await js(`[...document.querySelectorAll('.bc-cal-quick button')].find(b => b.textContent === '明日').click()`);
    const tomorrow = await js(`const { store } = await import('/js/store.js'); return store.dayAfter ? store.dayAfter(1) : null`);
    const sum = await js(`return document.querySelector('.bc-cal .bc-cal-sum').textContent`);
    if (tomorrow) assert.equal(sum, Number(tomorrow.slice(5, 7)) + '/' + Number(tomorrow.slice(8, 10)));
    await tile(2);
    assert.deepEqual(await exp(), ['false', 'false', 'true'], 'くりかえしを開くと、やる日は閉じる');
    await js(`[...document.querySelectorAll('.bc-cal-quick button')].find(b => b.textContent === '明日')?.click()`);   /* 外す（閉じていても札は同じもの） */
  });

  await step('くりかえし: 毎週＋曜日で先の 3 回を出し、閉じるときに書く。今日がその曜日ならやる日は今日', async () => {
    const now = await js(`const { store } = await import('/js/store.js'); return store.todayKey()`);
    await js(`[...document.querySelectorAll('.bc-rep .bc-seg-b')].find(b => b.textContent === '毎週').click()`);
    const s1 = await js(`const r = document.querySelector('.bc-rep'); return { sum: r.querySelector('.bc-cal-sum').textContent,
      dows: [...r.querySelectorAll('.bc-dow')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent),
      next: r.querySelector('.bc-rep-next').textContent, board: !!document.querySelector('.bc-fields .bc-act-start') }`);
    const dn = '日月火水木金土'[new Date(now + 'T12:00:00').getDay()];
    assert.equal(s1.sum, '毎週 ' + dn, '既定の曜日は今日の曜日');
    assert.deepEqual(s1.dows, [dn]);
    assert.match(s1.next, /^次の回　\d+\/\d+（.）・\d+\/\d+（.）・\d+\/\d+（.）$/);
    assert.equal(s1.board, true, '盤は開いたまま（書くのは閉じるとき）');
    assert.equal(await js(`const { store } = await import('/js/store.js'); return store.repeatOf(store.all().find(t => t.text === '架空のゴミ出し').id)`), null, 'まだ書かない');
    /* 曜日を足す（今日でない曜日） */
    const other = '日月火水木金土'[(new Date(now + 'T12:00:00').getDay() + 4) % 7];
    await js(`[...document.querySelectorAll('.bc-rep .bc-dow')].find(b => b.textContent === ${JSON.stringify(other)}).click()`);
    assert.match(await js(`return document.querySelector('.bc-rep .bc-cal-sum').textContent`), /^毎週 .・.$/);
    /* 盤を閉じる（flush） */
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await until(`return !document.querySelector('.bc-fields .bc-act-start')`);
    const got = await js(`const { store } = await import('/js/store.js'); const id = store.all().find(t => t.text === '架空のゴミ出し').id;
      return { r: store.repeatOf(id), days: store.daysOf(id) }`);
    assert.equal(got.r.every, 'week');
    assert.equal(got.r.of, 'day');
    assert.equal(got.r.dows.length, 2);
    assert.deepEqual(got.days, [now], '今日がその曜日なので、やる日は今日');
  });

  await step('期間: ［開始日］［終了日］を押してから同じ形の暦の日を押す。帯で出て、くりかえしの「期間」が選べるようになる', async () => {
    await openApp();
    await openBoard('架空の請求書');
    await js(`document.querySelectorAll('.bc-dates .bc-cal-head')[1].click()`);
    const keys = await js(`return [...document.querySelectorAll('.bc-span .bc-cal-d:not(.is-out)')].map(b => b.dataset.key)`);
    const [k1, k2] = [keys[keys.length - 6], keys[keys.length - 2]];
    await js(`document.querySelector('.bc-span .bc-cal-d[data-key="${k1}"]').click()`);
    await js(`document.querySelector('.bc-span .bc-cal-d[data-key="${k2}"]').click()`);
    const got = await js(`return { band: document.querySelectorAll('.bc-span .bc-cal-d.is-band').length, seg: [...document.querySelectorAll('.bc-span .bc-seg-b')].map(b => b.getAttribute('aria-pressed')),
        sum: document.querySelector('.bc-span .bc-cal-sum').textContent, ofSpan: [...document.querySelectorAll('.bc-rep .bc-seg-b')].find(b => b.textContent === '期間').disabled }`);
    const md = k => Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10));
    assert.equal(got.band, 5);
    assert.deepEqual(got.seg, ['false', 'true'], '開始日を選んだら、終了日へ移る');
    assert.equal(got.sum, md(k1) + '–' + md(k2));
    assert.equal(got.ofSpan, false, '期間を選ぶと、くりかえしの「期間」が選べる');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await until(`return !document.querySelector('.bc-fields .bc-act-start')`);
    assert.deepEqual(await js(`const { store } = await import('/js/store.js'); return store.spanOf(store.all().find(t => t.text === '架空の請求書').id)`),
      { start: k1, due: k2 }, '閉じるときに書く');
  });

  await step('前の版で置いた「名前だけ」の設定は、新しい既定に替わる（始めるが見える）', async () => {
    await openApp({ boardShow: ['name'], boardShowV: 2 });
    await openBoard('歯医者');
    assert.equal(await js(`${VIS} return vis(document.querySelector('.bc-fields .bc-act-start'))`), true);
    assert.deepEqual((await js(`return JSON.parse(localStorage.getItem('bubble_todo_prefs_v1') || 'null')`)), { boardShow: ['name'], boardShowV: 2 },
      '置いた値はそのまま（読むときに替える）');
  });

  await step('画面のエラーが無い', async () => { assert.deepEqual(problems, []); });
} catch (e) {
  console.log('FAIL - ' + (e && e.message || e));
  console.log('problems:', problems);
  process.exit(1);
}
console.log(`\n${pass} passed (headless Chrome)`);
process.exit(0);
