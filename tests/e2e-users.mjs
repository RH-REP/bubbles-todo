/* 利用者と海の仲間の通しのテスト（2026-11-18）。本物の Chrome 2 つ（別の利用者のつもり。別のプロフィール）と仮のパスキーで。

     node tests/e2e-users.mjs
     CHROME=/path/to/chrome node tests/e2e-users.mjs

   1. ゆき: 招待のリンク（/#invite=<コード>）で開く → 設定の「海」が開き、表示名と端末の呼び名で登録 →「ゆき」でログイン中
   2. VM の操作のつもり: 共有の海「家族の買い物」を作り、ゆきを持ち主にする
   3. ゆき: 海の ⚙ に仲間の一覧（ゆき・持ち主）が出て、［リンクを作る］で招待のリンクが出る
   4. りょう: そのリンクで開く → 招待の差出人と海が出る → 登録 → 家族の買い物の仲間（書ける）になる
   5. りょう: 家族の買い物に泡を足す → サーバーの記録に added_by（りょうの番号）が入る
   6. ゆき: 家族の買い物で、その泡の担当をりょうにすると泡に「り」の丸が出る。盤に担当の欄が出る
   7. その間に、CSP に止められた読み込みや画面のエラーが無いか
   Node 22 の WebSocket と child_process だけで動く。本物の端末（Face ID）ではない。 */

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || '';   /* フォルダを置けば、利用者の札・アイコンを選ぶ・設定を明るい／暗いで撮る */
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-users-'));
const data = join(tmp, 'data');
const port = await freePort();
const origin = `http://localhost:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', data,
  '--auth', 'passkey', '--origin', origin], { stdio: ['ignore', 'ignore', 'pipe'],
  /* 2 つの端末が同じ 127.0.0.1 から要求するので、接続元ごとの要求の上限（既定 1 分 120）を上げる */
  env: Object.assign({}, process.env, { BUBBLE_TODO_MAX_REQUESTS: '2000', BUBBLE_TODO_MAX_STATIC: '5000' }) });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });
const procs = [server];
const cleanup = () => { procs.forEach(p => { try { p.kill(); } catch (e) {} }); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);
const cli = (...a) => execFileSync('python3', [join(ROOT, 'server.py'), '--data-dir', data, ...a]).toString();

/* Chrome を 1 つ立てて、その 1 枚のページを動かす道具を返す（プロフィールは別。localStorage も別） */
async function openChrome(name) {
  const dbg = await freePort();
  const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome-' + name)}`,
    '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
  procs.push(p);
  let ws, seq = 0;
  const waiting = new Map();
  const problems = [];
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch (e) { /* まだ起きていない */ }
    if (!ws) await sleep(200);
  }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    if (d.method === 'Log.entryAdded' && /Content Security Policy|Refused to/.test(d.params.entry.text)) problems.push(name + ': ' + d.params.entry.text);
    if (d.method === 'Runtime.exceptionThrown') problems.push(name + ': ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(name + ': ' + expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 10000) => {
    const t0 = Date.now();
    const body = /^\s*return\b/.test(expr) ? expr : 'return ' + expr;
    while (Date.now() - t0 < ms) { if (await js(body)) return true; await sleep(100); }
    throw new Error(name + ': 待っても来なかった: ' + expr);
  };
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await send('WebAuthn.enable');
  await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });
  return { send, js, until, problems, go: (url) => send('Page.navigate', { url }) };
}

/* 設定を開き、海の欄を開く（2026-11-18 から ⚙ は右上に無い。利用者の札の［設定］から） */
async function openSet(c) {
  await c.until(`return !!document.querySelector('.userbtn')`);
  await c.js(`if (!document.getElementById('pane-settings')?.classList.contains('is-active')) {
    document.querySelector('.userbtn').click(); [...document.querySelectorAll('.uc-row')].find(b => /設定/.test(b.textContent)).click(); }`);
  await c.until(`return document.getElementById('pane-settings')?.classList.contains('is-active') && !!document.querySelector('.sea-panel')`);
  await c.js(`document.querySelector('.sea-panel').open = true;`);
}
const button = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)}))`;
let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

const yuki = await openChrome('yuki');
const ryo = await openChrome('ryo');
try {
  const code1 = cli('invite-add', 'ゆき', '--space', 'me').match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
  let yukiId = '';

  await step('ゆき: 招待のリンクで開くと設定の「海」が開き、表示名と端末の呼び名で登録できる', async () => {
    await yuki.go(origin + '/#invite=' + code1);
    await yuki.until(`return !!document.querySelector('.sea-panel input[aria-label="表示名"]')`);
    assert.equal(await yuki.js(`return document.querySelector('.sea-panel input[aria-label="招待コード"]').value`), code1);
    await yuki.until(`return /招待/.test(document.querySelector('.sp-link')?.textContent || '')`);
    await yuki.js(`document.querySelector('input[aria-label="表示名"]').value = 'ゆき';
      document.querySelector('input[aria-label="招待コード"]').closest('form').querySelector('input[aria-label="この端末の呼び名"]').value = 'iPhone';
      document.querySelector('input[aria-label="招待コード"]').closest('form').requestSubmit();`);
    /* 登録すると個人を 1 つにまとめて読み直す（2026-11-18）。左上の利用者のアイコンと、覚えた端末の呼び名で見る */
    await yuki.until(`return document.querySelector('.userbtn')?.title === 'ゆき でログイン中'`, 15000);
    /* ログインのあとは読み直す。読み直しの途中で読まないよう、覚えた呼び名が出るまで待つ */
    await yuki.until(`return (await import('/js/sync.js')).sync.config().passkey?.name === 'iPhone'`, 15000);
    assert.deepEqual(await yuki.js(`return (await import('/js/regions.js')).allSeas().filter(s => s.personal).map(s => s.name)`), ['個人'], '個人は 1 つ');
    await openSet(yuki);
    assert.equal(await yuki.js(`return location.hash`), '', 'リンクのコードは URL から消す');
    yukiId = JSON.parse(readFileSync(join(data, 'users.json'), 'utf8'))[0].id;
    assert.match(yukiId, /^u_[0-9a-f]{8}$/);
  });

  let SEA = '';
  await step('ゆき: app から共有の海を作ると持ち主になり、帯に 👥 と右上に名前の丸、⚙ に仲間と［リンクを作る］が出る', async () => {
    await yuki.until(`return !!document.querySelector('.sea-panel input[aria-label="新しい海の名前"]')`);
    await yuki.js(`const f = document.querySelector('.sea-panel input[aria-label="新しい海の名前"]').closest('form');
      f.querySelector('input[aria-label="新しい海の名前"]').value = '家族の買い物';
      f.querySelector('input[aria-label="共有の海にする"]').checked = true; f.requestSubmit();`);
    await yuki.until(`return [...document.querySelectorAll('.sp-sea')].some(r => /家族の買い物/.test(r.textContent) && /サーバー/.test(r.textContent))`);
    const seas = JSON.parse(readFileSync(join(data, 'seas.json'), 'utf8'));
    SEA = seas.find(s => s.name === '家族の買い物').id;
    const m = JSON.parse(readFileSync(join(data, 'members.json'), 'utf8'));
    assert.deepEqual(m.filter(x => x.sea === SEA).map(x => [x.user, x.role]), [[yukiId, 'owner']], '作った人が持ち主');
    await yuki.until(`return [...document.querySelectorAll('.space-seg button')].some(b => b.textContent === '👥 家族の買い物')`);
    assert.equal(await yuki.js(`return document.querySelector('.userbtn').title`), 'ゆき でログイン中');
    assert.equal(await yuki.js(`return document.querySelector('.userbtn').textContent === (await import('/js/me.js')).meInfo().user.avatar.emoji`), true,
      '左上の利用者のアイコンに、サーバーの avatar の絵文字');
    await yuki.js(`[...document.querySelectorAll('.sp-sea')].find(r => /家族の買い物/.test(r.textContent)).querySelector('.sp-gear').click();`);
    await yuki.until(`return /ゆき（あなた）\\s*持ち主/.test(document.querySelector('.sp-members')?.textContent || '')`);
    await yuki.js(`const i = document.querySelector('input[aria-label="招く人の呼び名"]'); i.value = 'りょう'; i.closest('form').requestSubmit();`);
    await yuki.until(`return /#invite=/.test(document.querySelector('.sp-invite p[style]')?.textContent || '')`);
  });

  const link = await yuki.js(`return document.querySelector('.sp-invite p[style]').textContent`);
  let ryoId = '';
  await step('りょう: リンクで開くと差出人と海が出て、登録すると家族の買い物の仲間（書ける）になる', async () => {
    await ryo.go(link);
    await ryo.until(`return /iPhone からの招待：「家族の買い物」（書ける）/.test(document.querySelector('.sp-link')?.textContent || '')`);
    await ryo.js(`document.querySelector('input[aria-label="表示名"]').value = 'りょう';
      document.querySelector('input[aria-label="招待コード"]').closest('form').querySelector('input[aria-label="この端末の呼び名"]').value = 'Mac';
      document.querySelector('input[aria-label="招待コード"]').closest('form').requestSubmit();`);
    await ryo.until(`return document.querySelector('.userbtn')?.title === 'りょう でログイン中'`, 15000);
    /* ログインのあとは読み直す。読み直しの途中で読まないよう、覚えた呼び名が出るまで待つ */
    await ryo.until(`return (await import('/js/sync.js')).sync.config().passkey?.name === 'Mac'`, 15000);
    await openSet(ryo);
    const users = JSON.parse(readFileSync(join(data, 'users.json'), 'utf8'));
    ryoId = users.find(u => u.name === 'りょう').id;
    const m = JSON.parse(readFileSync(join(data, 'members.json'), 'utf8'));
    assert.deepEqual(m.filter(x => x.sea === SEA).map(x => [x.user, x.role]).sort(), [[ryoId, 'editor'], [yukiId, 'owner']].sort());
    assert.equal(await ryo.js(`return !!document.querySelector('.sp-link')`), false, '使った招待は消える');
  });

  await step('りょう: 家族の買い物に泡を足すと、サーバーの記録に足した人が入る', async () => {
    await ryo.until(`return [...document.querySelectorAll('.sp-sea')].some(r => /家族の買い物/.test(r.textContent))`);
    await ryo.js(`localStorage.setItem('bubble_todo_space', '${SEA}'); location.reload();`);
    await sleep(1500);
    await ryo.until(`return (await import('/js/store.js')).store.space() === '${SEA}'`);
    await ryo.until(`return !!(await import('/js/me.js')).meInfo()`);
    await ryo.js(`(await import('/js/store.js')).store.add('牛乳');`);
    const f = join(data, 'seas', SEA, 'state.json');
    for (let i = 0; i < 80 && !(existsSync(f) && readFileSync(f, 'utf8').includes('牛乳')); i++) await sleep(100);
    const t = JSON.parse(readFileSync(f, 'utf8')).data.doc.todos.find(x => x.text === '牛乳');
    assert.equal(t.added_by, ryoId);
  });

  await step('ゆき: 担当をりょうにすると泡に「り」の丸が出て、盤に担当の欄が出る', async () => {
    await yuki.js(`localStorage.setItem('bubble_todo_space', '${SEA}'); location.reload();`);
    await sleep(1500);
    await yuki.until(`return (await import('/js/store.js')).store.all().some(t => t.text === '牛乳')`, 15000);
    await yuki.until(`return !!(await import('/js/me.js')).seaMembers('${SEA}')`);
    await yuki.js(`const { store } = await import('/js/store.js'); const t = store.all().find(x => x.text === '牛乳');
      store.setAssignee(t.id, ${JSON.stringify(ryoId)});`);
    await yuki.until(`return [...document.querySelectorAll('.bub .who')].some(w => !w.hidden && w.textContent === 'り')`);
    await yuki.js(`const n = [...document.querySelectorAll('.bub')].find(b => /牛乳/.test(b.textContent));
      (await import('/js/bubble.js')).centerBubble(n);`);
    await yuki.until(`return !!document.querySelector('.bc-who select')`);
    assert.equal(await yuki.js(`return document.querySelector('.bc-who select').value`), ryoId);
    assert.match(await yuki.js(`return document.querySelector('.bc-who').textContent`), /足した: りょう/);
  });

  await step('ゆき: りょうを見るだけにすると、りょうの画面では書けず、盤とメニューが押せない', async () => {
    await yuki.js(`document.querySelector('.bub-center') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const g = document.querySelector('.gearbtn'); if (!g.classList.contains('is-open')) g.click();`);
    await yuki.until(`return [...document.querySelectorAll('.sp-sea')].some(r => /家族の買い物/.test(r.textContent))`);
    await yuki.js(`const r = [...document.querySelectorAll('.sp-sea')].find(r => /家族の買い物/.test(r.textContent));
      if (!document.querySelector('.sp-members')) r.querySelector('.sp-gear').click();`);
    await yuki.until(`return !!document.querySelector('select[aria-label="りょう の役割"]')`);
    await yuki.js(`const s = document.querySelector('select[aria-label="りょう の役割"]'); s.value = 'viewer'; s.dispatchEvent(new Event('change'));`);
    for (let i = 0; i < 50; i++) {
      const m = JSON.parse(readFileSync(join(data, 'members.json'), 'utf8'));
      if (m.some(x => x.sea === SEA && x.user === ryoId && x.role === 'viewer')) break;
      await sleep(100);
    }
    await ryo.js(`location.reload();`);
    await sleep(1500);
    await ryo.until(`return (await import('/js/store.js')).store.readOnly() === true`);
    assert.equal(await ryo.js(`return (await import('/js/store.js')).store.add('書けないはず')`), null);
    await ryo.until(`return [...document.querySelectorAll('input')].some(i => i.placeholder === '見るだけの海' && i.disabled)`);
    await ryo.js(`const n = [...document.querySelectorAll('.bub')].find(b => /牛乳/.test(b.textContent));
      (await import('/js/bubble.js')).centerBubble(n);`);
    await ryo.until(`return !!document.querySelector('.bub-center .bc-readonly')`);
    assert.equal(await ryo.js(`return [...document.querySelectorAll('.bub-center button')].every(b => b.disabled)`), true);
  });

  await step('ゆき: 泡を個人の海へ移すとき、りょうの画面から消えることを出し、移すと共有の海から消える', async () => {
    const id = await yuki.js(`return (await import('/js/store.js')).store.all().find(x => x.text === '牛乳').id`);
    await yuki.js(`(await import('/js/movesea.js')).openMoveSea(${JSON.stringify(id)});`);
    await yuki.until(`return [...document.querySelectorAll('.move-sheet .move-to')].length > 0`);
    const targets = await yuki.js(`return [...document.querySelectorAll('.move-sheet .move-to')].map(b => b.textContent)`);
    assert.ok(targets.length >= 1, '移せる海がある: ' + targets);
    await yuki.js(`[...document.querySelectorAll('.move-sheet .move-to')][0].click();`);
    await yuki.until(`return [...document.querySelectorAll('.move-sheet .move-note')].some(p => /りょう の画面から消えます/.test(p.textContent))`);
    await yuki.js(`[...document.querySelectorAll('.move-sheet button')].find(b => b.textContent === '移す').click();`);
    await yuki.until(`return !(await import('/js/store.js')).store.all().some(x => x.text === '牛乳')`);
    const f = join(data, 'seas', SEA, 'state.json');
    for (let i = 0; i < 80; i++) {
      const t = JSON.parse(readFileSync(f, 'utf8')).data.doc.todos.find(x => x.text === '牛乳');
      if (t && t.trashed) break;
      await sleep(100);
    }
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).data.doc.todos.find(x => x.text === '牛乳').trashed, true, '共有の海では消えた印');
  });

  await step('わたしの端末の一覧に「この端末」が出て、りょうは海を出られる', async () => {
    await yuki.js(`const g = document.querySelector('.gearbtn'); if (!g.classList.contains('is-open')) g.click();`);
    await yuki.until(`return /iPhone（この端末）/.test(document.querySelector('.sp-devices')?.textContent || '')`);
    await ryo.js(`const g = document.querySelector('.gearbtn'); if (!g.classList.contains('is-open')) g.click();`);
    await ryo.until(`return [...document.querySelectorAll('.sp-sea')].some(r => /家族の買い物/.test(r.textContent))`);
    await ryo.js(`[...document.querySelectorAll('.sp-sea')].find(r => /家族の買い物/.test(r.textContent)).querySelector('.sp-gear').click();`);
    await ryo.until(`return !!${button('この海を出る')}`);
    assert.equal(await ryo.js(`return !!document.querySelector('select[aria-label="りょう の役割"]') || !!${button('この海を消す')}`), false,
      '持ち主でない人には役割・消すが出ない');
    /* 2 度押す（設定の「海」は同期で描き直すことがあり、1 度目と 2 度目の間に描き直すと最初からになるので、同じボタンを続けて押す） */
    await ryo.js(`const b = ${button('この海を出る')}; b.click(); b.click();`);
    for (let i = 0; i < 50; i++) {
      const m = JSON.parse(readFileSync(join(data, 'members.json'), 'utf8'));
      if (!m.some(x => x.sea === SEA && x.user === ryoId)) break;
      await sleep(100);
    }
    const m = JSON.parse(readFileSync(join(data, 'members.json'), 'utf8'));
    assert.deepEqual(m.filter(x => x.sea === SEA).map(x => x.user), [yukiId]);
  });

  await step('左上の利用者のアイコン: ≡ は右どなり、⚙ は右上に無い。札に app の切り替え・設定・わたしの端末、#avatar でアイコンを変え、#devices で端末の一覧', async () => {
    await yuki.go(origin + '/');
    await yuki.until(`return !!document.querySelector('.userbtn') && !!document.querySelector('.menubtn')`);
    const pos = await yuki.js(`const a = document.querySelector('.userbtn').getBoundingClientRect(), m = document.querySelector('.menubtn').getBoundingClientRect(),
      app = document.querySelector('.app').getBoundingClientRect(), g = document.querySelector('.gearbtn');
      return [Math.round(a.left - app.left), Math.round(a.width), Math.round(m.left - app.left), !!(g && !g.hidden && g.offsetParent)]`);
    assert.deepEqual(pos, [10, 44, 62, false], '利用者のアイコン 10px・44px、≡ 62px、⚙ は出ていない');
    await yuki.js(`document.querySelector('.userbtn').click();`);
    await yuki.until(`return !!document.querySelector('.uc-card .uc-apps')`);
    const apps = await yuki.js(`return [...document.querySelectorAll('.uc-app')].map(a => a.textContent.trim() + '|' + (a.getAttribute('href') || (a.classList.contains('is-cur') ? 'cur' : '')))`);
    assert.deepEqual(apps, ['🫧bubble|cur', '📊gantt|http://127.0.0.1:8766', '📔diary|http://127.0.0.1:8780']);
    await yuki.js(`[...document.querySelectorAll('.uc-row')].find(b => /設定/.test(b.textContent)).click();`);
    await yuki.until(`return document.getElementById('pane-settings')?.classList.contains('is-active') && !document.querySelector('.uc-card')`);
    const order = await yuki.js(`return [...document.querySelectorAll('#pane-settings .set-sec > span:first-child, #pane-settings .set-common .nm, #pane-settings .sea-panel > summary .nm, #pane-settings .set-etc > summary .nm')].map(n => n.textContent)`);
    assert.deepEqual(order, ['利用者・app・端末', 'ゆき', 'わたしの端末', 'app', 'bubble', '海', 'そのほか'], '設定の並び（共通の節 → bubble → そのほか）');
    assert.equal(await yuki.js(`const g = document.querySelector('.gearbtn'); return !!(g && !g.hidden)`), true, '設定を開いている間だけ ✕ で閉じられる');
    await yuki.go(origin + '/#avatar');
    await yuki.until(`return document.querySelectorAll('.uc-card .uc-preset').length === 16`);
    await yuki.js(`document.querySelector('.uc-preset[data-preset="owl"]').click();`);
    await yuki.until(`return document.querySelector('.userbtn').textContent === '🦉'`);
    const u = JSON.parse(readFileSync(join(data, 'users.json'), 'utf8')).find(x => x.id === yukiId);
    assert.equal(u.avatar, 'owl', 'サーバーに残る');
    assert.equal(await yuki.js(`return location.hash`), '', '#avatar は URL から消す');
    await yuki.go(origin + '/#devices');
    await yuki.until(`return /iPhone/.test(document.querySelector('.uc-card .uc-devices')?.textContent || '')`);
  });

  await step('jump: ほかの海から #sea=<海>&todo=<id> で開くと、その海に替わって泡の盤が開き、盤に gantt・diary への飛び先が出る', async () => {
    /* 共有の海に期間のある泡を作ってサーバーへ送る */
    await yuki.js(`localStorage.setItem('bubble_todo_space', ${JSON.stringify(SEA)}); location.reload();`);
    await sleep(1500);
    await yuki.until(`return (await import('/js/store.js')).store.space() === ${JSON.stringify(SEA)}`);
    const id = await yuki.js(`const { store } = await import('/js/store.js'); const t = store.add('ガントの泡');
      store.setSpan(t.id, '2026-11-20', '2026-11-22'); return t.id;`);
    /* 個人の海へ移ってから飛ぶ */
    await yuki.js(`const { allSeas } = await import('/js/regions.js'); const p = allSeas().find(s => s.personal && s.rid !== 'local') || allSeas().find(s => s.personal);
      localStorage.setItem('bubble_todo_space', p.id); location.reload();`);
    await sleep(1500);
    await yuki.until(`return (await import('/js/store.js')).store.space() !== ${JSON.stringify(SEA)}`);
    await yuki.go(origin + '/#sea=' + SEA + '&todo=' + id);
    await sleep(1500);
    await yuki.until(`return (await import('/js/store.js')).store.space() === ${JSON.stringify(SEA)}`, 15000);
    await yuki.until(`return !!document.querySelector('.bub-center .bc-jump')`, 15000);
    const hrefs = await yuki.js(`return [...document.querySelectorAll('.bub-center .bc-jump-a')].map(a => a.textContent + '|' + a.getAttribute('href'))`);
    assert.deepEqual(hrefs, ['📊 gantt でこの期間を見る|http://127.0.0.1:8766/?date=2026-11-20&todo=' + id]);
    assert.equal(await yuki.js(`return location.hash`), '', '#sea= は URL から消す');
    /* 終えると diary への飛び先も出る */
    await yuki.js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); (await import('/js/store.js')).store.complete(${JSON.stringify(id)});`);
    const links = await yuki.js(`return (await import('/js/jump.js')).jumpLinks(${JSON.stringify(id)}).map(l => l.href)`);
    assert.equal(links.length, 2);
    assert.match(links[1], /^http:\/\/127\.0\.0\.1:8780\/#\d{4}-\d{2}-\d{2}$/);
    /* 入れない海 */
    await yuki.go(origin + '/#sea=snotmine1&todo=x');
    await yuki.until(`return /入れない海です/.test(document.body.textContent)`);
    assert.equal(await yuki.js(`return (await import('/js/store.js')).store.space()`), SEA, '入れない海には替えない');
  });

  if (SHOTS) {
    const shot = async (name) => { const s = await yuki.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(s.result.data, 'base64')); };
    for (const mode of ['light', 'dark']) {
      await yuki.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
      await yuki.go(origin + '/');
      await yuki.until(`return !!document.querySelector('.userbtn')`);
      await sleep(800);
      await shot(mode + '-home');
      await yuki.js(`document.querySelector('.userbtn').click();`);
      await yuki.until(`return !!document.querySelector('.uc-card .uc-apps')`);
      await sleep(300);
      await shot(mode + '-card');
      await yuki.js(`document.querySelector('.uc-card .btn').click();`);
      await yuki.until(`return document.querySelectorAll('.uc-preset').length === 16`);
      await sleep(300);
      await shot(mode + '-avatar');
      await yuki.go(origin + '/');
      await yuki.until(`return !!document.querySelector('.userbtn')`);
      await yuki.js(`document.querySelector('.userbtn').click(); [...document.querySelectorAll('.uc-row')].find(b => /設定/.test(b.textContent)).click();`);
      await yuki.until(`return document.getElementById('pane-settings')?.classList.contains('is-active')`);
      await sleep(500);
      await shot(mode + '-settings');
    }
  }

  await step('CSP に止められた読み込みや、画面のエラーが無い', async () => {
    await sleep(300);
    assert.deepEqual([...yuki.problems, ...ryo.problems], []);
  });

  assert.doesNotMatch(serverLog, new RegExp(code1), 'サーバーの記録に招待コードの値を出さない');
  console.log(`\n${pass} passed (headless Chrome 2 つ + 仮のパスキー)`);
  process.exit(0);
} catch (e) {
  console.log('FAIL - ' + (e?.message || e));
  console.log('problems:', [...yuki.problems, ...ryo.problems]);
  console.log('server:', serverLog.slice(-800));
  process.exit(1);
}
