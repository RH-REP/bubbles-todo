/* パスキーの通しのテスト（公開の形。2026-10-24）。本物の Chrome と、Chrome の仮のパスキーで確かめる。

     node tests/e2e-passkey.mjs
     CHROME=/path/to/chrome node tests/e2e-passkey.mjs

   1. 試し用の置き場で server.py を --auth passkey で起動する（住所は http://localhost:<port>。
      パスキーは localhost なら http でも使える）
   2. server.py invite-add で招待コードを作る
   3. headless の Chrome を DevTools の口つきで起動し、WebAuthn.addVirtualAuthenticator で仮のパスキーの
      置き場（Face ID 済みの端末のつもり）を付ける
   4. 設定の画面で招待コードを入れて「この端末を登録」→ 記録を1つ書く → サーバーの state.json に届くか
   5. 「この端末から出る」→「パスキーで入る」→ また合わせられるか
   6. その間に、CSP に止められた読み込みや、画面のエラーが無いか
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
const SHOT = process.env.SHOT || '';   /* 置けば、登録したあとの設定の画面を撮る */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const tmp = mkdtempSync(join(tmpdir(), 'bubbles-e2e-'));
const data = join(tmp, 'data');
const port = await freePort();
const dbg = await freePort();
const origin = `http://localhost:${port}`;
const server = spawn('python3', [join(ROOT, 'server.py'), '--port', String(port), '--data-dir', data,
  '--auth', 'passkey', '--origin', origin], { stdio: ['ignore', 'ignore', 'pipe'] });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${join(tmp, 'chrome')}`,
  '--no-first-run', '--lang=ja', 'about:blank'], { stdio: 'ignore' });
/* サーバーが配っていないページのつもり（GitHub Pages から入れた Chrome の app など）。ただの静的な配り（2026-11-16） */
const plainPort = await freePort();
const plain = spawn('python3', ['-m', 'http.server', String(plainPort), '--bind', '127.0.0.1', '-d', ROOT], { stdio: 'ignore' });
const cleanup = () => { try { plain.kill(); } catch (e) {} try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

const invite = execFileSync('python3', [join(ROOT, 'server.py'), '--data-dir', data, 'invite-add', '自分のスマホ', '--space', 'me,share'])
  .toString().match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];

let ws, seq = 0;
const waiting = new Map();
const problems = [];
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(p => p.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (e) { /* まだ起きていない */ }
  if (!ws) await sleep(200);
}
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const d = JSON.parse(e.data);
  if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Log.entryAdded' && /Content Security Policy|Refused to/.test(d.params.entry.text)) problems.push(d.params.entry.text);
  if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result?.result?.value;
}
async function until(expr, ms = 8000) {
  const t0 = Date.now();
  const body = /^\s*return\b/.test(expr) ? expr : 'return ' + expr;
  while (Date.now() - t0 < ms) { if (await js(body)) return true; await sleep(100); }
  throw new Error('待っても来なかった: ' + expr);
}

let pass = 0;
async function step(name, fn) { await fn(); pass++; console.log('ok   - ' + name); }

try {
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1.28, mobile: true });
  await send('WebAuthn.enable');
  const { result: { authenticatorId } } = await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });

  /* 2026-11-16「chromeのapp版から登録できない」: サーバーが配っていないページでは、行き止まりにせず、サーバーのページを開く道を出す */
  await send('Page.navigate', { url: `http://127.0.0.1:${plainPort}/index.html` });
  await sleep(1500);
  await step('サーバーが配っていないページでは、サーバーの住所の欄と［サーバーのページを開く］が出る', async () => {
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`document.querySelector('.gearbtn').click();`);
    await until(`return !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーにログイン')`);
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーにログイン').click();`);
    await until(`return !!document.querySelector('input[aria-label="サーバーの URL"]')`);
    assert.equal(await js(`return !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'サーバーのページを開く')`), true);
  });

  await send('Page.navigate', { url: origin + '/' });
  await sleep(1500);

  const button = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)}))`;
  /* 読み直したあとも使う。設定がもう開いていれば押さない（押すと閉じる） */
  const openSettings = async () => {
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`const g = document.querySelector('.gearbtn'); if (!g.classList.contains('is-open')) g.click();`);
    await until(`return !!${button('サーバーにログイン')} || !!${button('ログアウト')}`);
  };

  /* 2026-11-16 海と同期の作り直し（js/screens/seapanel.js）: サーバーの話は海の欄のいちばん下の1行だけ。
     ［サーバーにログイン］で欄を開き、招待コードで登録する。サーバーの個人は、ログインすると並ぶ */
  await step('設定の海の欄は、初めはサーバーの欄を出さず、［サーバーにログイン］で開く', async () => {
    /* ログインする前に、この端末の個人に1つ書いておく（あとで個人をまとめたとき、サーバーへ届くか見る） */
    await until(`return !!document.querySelector('.gearbtn')`);
    await js(`(await import('/js/store.js')).store.add('端末で書いた');`);
    await openSettings();
    assert.equal(await js(`return !!document.querySelector('.sea-panel input[aria-label="招待コード"]')`), false, '初めは招待コードの欄を出さない');
    await js(`${button('サーバーにログイン')}.click();`);
    await until(`return !!document.querySelector('.sea-panel input[aria-label="招待コード"]')`);
  });

  await step('招待コードで登録すると、この端末の個人の泡はサーバーの個人へ合わさり、個人は 1 つ（2026-11-18）', async () => {
    await js(`window.__beforeLogin = 1; const i = document.querySelector('.sea-panel input[aria-label="招待コード"]'); i.value = ${JSON.stringify(invite)};
      i.closest('form').requestSubmit();`);
    /* 合わせたら画面を読み直す。読み直しを待ってから次の手を打つ */
    await until(`return window.__beforeLogin !== 1 && document.readyState === 'complete'`, 15000).catch(() => {});
    await sleep(500);
    await until(`return !!(await import('/js/me.js')).meInfo()`, 15000);
    const creds = (await send('WebAuthn.getCredentials', { authenticatorId })).result.credentials;
    assert.equal(creds.length, 1, '仮のパスキーの置き場に1つ入った');
    assert.deepEqual(await js(`return (await import('/js/regions.js')).allSeas().filter(s => s.personal).map(s => s.name)`), ['個人'],
      '個人は 1 つ（個人（サーバー）を並べない）');
    await until(`return /1 件を、サーバーの個人に合わせた/.test(document.body.textContent)`);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
    assert.equal(await js(`return (await import('/js/store.js')).store.space()`), 'me');
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !(existsSync(f) && readFileSync(f, 'utf8').includes('端末で書いた')); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /端末で書いた/, 'この端末の個人の泡がサーバーの個人へ届いた');
    assert.ok(await js(`return Object.keys(localStorage).some(k => /_before_unify_/.test(k))`), '合わせる前の控えがある');
    const c = await js(`return (await import('/js/sync.js')).sync.config().passkey`);
    assert.equal(c.name, '自分のスマホ');
    assert.deepEqual(c.spaces, ['me', 'share']);
  });

  if (SHOT) {
    await openSettings();
    await js(`document.querySelector('.sea-panel').scrollIntoView({ block: 'start' });`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
    writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  }

  await step('書いた記録がサーバーに届く', async () => {
    await js(`(await import('/js/store.js')).store.add('パスキーで書いた');`);
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !(existsSync(f) && readFileSync(f, 'utf8').includes('パスキーで書いた')); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /パスキーで書いた/);
  });

  await step('オフラインでも個人に書け、繋がったらサーバーへ届く', async () => {
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    assert.equal(await js(`return (await import('/js/store.js')).store.readOnly()`), false, '読むだけにならない');
    await js(`(await import('/js/store.js')).store.add('オフラインで書いた');`);
    await js(`await (await import('/js/sync.js')).sync.syncNow();`);
    await until(`return /未送信 1/.test(document.querySelector('.space-state')?.textContent || '')`);
    const f = join(data, 'state.json');
    assert.doesNotMatch(readFileSync(f, 'utf8'), /オフラインで書いた/, 'オフラインの間は届かない');
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await js(`window.dispatchEvent(new Event('online'));`);
    for (let i = 0; i < 80 && !readFileSync(f, 'utf8').includes('オフラインで書いた'); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /オフラインで書いた/);
    await until(`return (await import('/js/sync.js')).sync.pending() === 0`);
  });

  await step('2 台で同じ個人の記録を直す: ほかの端末（API で書いたつもり）とこの端末の変更が、記録ごとに新しいほうで合わさる', async () => {
    const sess = await js(`return (await import('/js/sync.js')).sync.config().passkey && JSON.parse(localStorage.getItem('bubble_todo_sync') || '{}').session`);
    const H = { Authorization: 'Bearer ' + sess, 'X-Bubbles-Space': 'me', 'X-Bubbles-Schema': '1', 'Content-Type': 'application/json' };
    const got = await (await fetch(origin + '/api/data', { headers: H })).json();
    const doc = got.data.doc;
    const st = got.data.stamps;
    const t1 = doc.todos.find(x => x.text === 'パスキーで書いた');
    t1.text = 'ほかの端末で直した';
    st['todo:' + t1.id] = [Date.now() + 1000, 1];
    const put = await fetch(origin + '/api/data', { method: 'PUT', headers: H, body: JSON.stringify({ base: got.version, data: { doc, stamps: st } }) });
    assert.equal(put.status, 200);
    await js(`const { store } = await import('/js/store.js'); const t = store.all().find(x => x.text === 'オフラインで書いた'); store.setText(t.id, 'この端末で直した');`);
    await js(`await (await import('/js/sync.js')).sync.syncNow();`);
    await until(`return await (async () => { const { store } = await import('/js/store.js'); const a = store.all().map(x => x.text); return a.includes('ほかの端末で直した') && a.includes('この端末で直した'); })()`);
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !readFileSync(f, 'utf8').includes('この端末で直した'); i++) await sleep(100);
    const s = readFileSync(f, 'utf8');
    assert.match(s, /ほかの端末で直した/);
    assert.match(s, /この端末で直した/);
  });

  await step('bubble にログイン済みなら、gantt の「bubble でログイン」はパスキーの操作なしで戻る（取り決め §7.2。2026-11-18）', async () => {
    const seen = [];
    const onMsg = e => { const d = JSON.parse(e.data); if (d.method === 'Network.requestWillBeSent') seen.push(d.params.request.url); };
    ws.addEventListener('message', onMsg);
    await send('Network.enable');
    const q = new URLSearchParams({ response_type: 'code', client_id: 'gantt', redirect_uri: 'http://127.0.0.1:8766/auth/callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'e2e' });
    const mark = serverLog.length;
    await send('Page.navigate', { url: origin + '/oauth/authorize?' + q });
    for (let i = 0; i < 80 && !seen.some(u => u.startsWith('http://127.0.0.1:8766/auth/callback?')); i++) await sleep(100);
    ws.removeEventListener('message', onMsg);
    await send('Network.disable');
    const back = seen.find(u => u.startsWith('http://127.0.0.1:8766/auth/callback?'));
    assert.ok(back, 'gantt の戻る先へ移った: ' + seen.slice(-3).join(' '));
    const bq = new URL(back).searchParams;
    assert.ok(bq.get('code') && bq.get('state') === 'e2e', 'code と state が付く');
    const log = serverLog.slice(mark);
    assert.match(log, /oauth-approved ip=\S+ session/, '端末の通行証で許した');
    assert.ok(!seen.some(u => /\/api\/passkey\/login\/options/.test(u)), 'パスキーの問題を取りに行っていない（パスキーの操作なし）');
    assert.doesNotMatch(log, /auth-fail/, '失敗も無い');
    await send('Page.navigate', { url: origin + '/' });
    await until(`return !!document.querySelector('.userbtn')`, 15000);
  });

  await step('ログアウトしたあと、パスキーでログインし直せる（Face ID のつもりの確かめつき）', async () => {
    await openSettings();
    await js(`${button('ログアウト')}.click();`);
    await until(`return !!document.querySelector('[data-name="ログアウトの確かめ"]')`);
    await js(`${button('写しを残す')}.click();`);
    await sleep(1500);
    await until(`return !!document.querySelector('.userbtn.is-empty')`);
    assert.deepEqual(await js(`return (await import('/js/regions.js')).allSeas().filter(s => s.personal).map(s => s.name)`), ['個人'],
      'ログアウトしても個人は 1 つ（写し）');
    assert.equal(await js(`return (await import('/js/store.js')).store.all().some(x => x.text === 'ほかの端末で直した')`), true, '写しが読める');
    await js(`(await import('/js/store.js')).store.add('ログアウト中に書いた');`);
    await until(`return /ログイン\s*していない/.test(document.querySelector('.space-state')?.textContent || '')`);
    await openSettings();
    await until(`return !!${button('サーバーにログイン')}`);
    await js(`${button('サーバーにログイン')}.click();`);
    await until(`return !!${button('パスキーでログイン')}`);
    await js(`window.__beforeLogin = 1; ${button('パスキーでログイン')}.click();`);
    /* ログインのあと画面を読み直すことがある（2026-11-18）。読み直しの途中で次の手を打たないよう、読み直しを待つ */
    for (let i = 0; i < 40 && await js(`return window.__beforeLogin === 1`).catch(() => false); i++) await sleep(100);
    await until(`return document.readyState === 'complete' && /でログイン中/.test(document.querySelector('.userbtn')?.title || '')`, 15000);
    await until(`return (await import('/js/sync.js')).sync.config().passkey?.name === '自分のスマホ'`);
    await until(`return (await import('/js/sync.js')).sync.status().state === 'ok'`);
    const f = join(data, 'state.json');
    for (let i = 0; i < 60 && !readFileSync(f, 'utf8').includes('ログアウト中に書いた'); i++) await sleep(100);
    assert.match(readFileSync(f, 'utf8'), /ログアウト中に書いた/, '同じ利用者でログインし直すと、写しに書いた分も合わさる');
  });

  await step('個人の海の ⚙ から端末を足す: 6 桁の番号が出て、その番号で同じ利用者のパスキーを作れる（2026-11-18）', async () => {
    await openSettings();
    await js(`[...document.querySelectorAll('.sp-gear')][0].click();`);
    await until(`return !!${button('＋ 端末を足す')}`);
    await js(`${button('＋ 端末を足す')}.click();`);
    await until(`return /^[0-9]{3} [0-9]{3}$/.test(document.querySelector('[data-name="つなぐ番号"]')?.textContent || '')`);
    const code = await js(`return document.querySelector('[data-name="つなぐ番号"]').textContent`);
    const inv = JSON.parse(readFileSync(join(data, 'invites.json'), 'utf8'));
    const row = inv.find(r => r.kind === 'device');
    assert.ok(row && /^u_[0-9a-f]{8}$/.test(row.user), '番号の行は利用者に結び付く');
    assert.doesNotMatch(JSON.stringify(inv), new RegExp(code.replace(' ', '')), '番号そのものは置かない');
    const uid = await js(`const r = await fetch('/api/passkey/register/options', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: ${JSON.stringify(code)} }) });
      const j = await r.json(); return atob(j.publicKey.user.id.replace(/-/g, '+').replace(/_/g, '/'));`);
    assert.equal(uid, row.user, 'パスキーの user.id は利用者の番号');
  });

  await step('同じ招待コードは2度使えない', async () => {
    const st = await js(`const r = await fetch('/api/passkey/register/options', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite: ${JSON.stringify(invite)} }) }); return r.status;`);
    assert.equal(st, 401);
  });

  await step('別の利用者でこの端末にログイン: 合わせずに聞き、前の人の写しは控えへ移して空の個人から始まる', async () => {
    const other = execFileSync('python3', [join(ROOT, 'server.py'), '--data-dir', data, 'invite-add', 'ほかの人', '--space', 'me'])
      .toString().match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
    await openSettings();
    await js(`${button('ログアウト')}.click();`);
    await until(`return !!document.querySelector('[data-name="ログアウトの確かめ"]')`);
    await js(`${button('写しを残す')}.click();`);
    await sleep(1500);
    await openSettings();
    await js(`${button('サーバーにログイン')}.click();`);
    await until(`return !!document.querySelector('.sea-panel input[aria-label="招待コード"]')`);
    await js(`const i = document.querySelector('.sea-panel input[aria-label="招待コード"]'); i.value = ${JSON.stringify(other)};
      i.closest('form').requestSubmit();`);
    await until(`return !!document.querySelector('[data-name="別の利用者の確かめ"]')`, 15000);
    await js(`${button('控えに移して読む')}.click();`);
    await sleep(2500);
    await until(`return (await import('/js/me.js')).meInfo()?.user?.name === 'ほかの人'`, 15000);
    assert.equal(await js(`return (await import('/js/store.js')).store.all().some(x => /直した|書いた/.test(x.text))`), false, '前の人の泡は混ざらない');
    assert.equal(await js(`return Object.keys(localStorage).some(k => /_before_person_/.test(k))`), false,
      '聞く前に同期が入れ替えていない（通行証は聞いたあとに覚える）');
    assert.ok(await js(`return Object.keys(localStorage).some(k => /_before_user_/.test(k) && /ほかの端末で直した/.test(localStorage.getItem(k)))`), '前の人の写しは控えに');
    const f = join(data, 'state.json');
    assert.match(readFileSync(f, 'utf8'), /ほかの端末で直した/, '前の人のサーバーの個人はそのまま');
    await js(`(await import('/js/store.js')).store.add('ほかの人の泡'); await (await import('/js/sync.js')).sync.syncNow();`);
    const g = join(data, 'people', '2', 'state.json');
    for (let i = 0; i < 60 && !(existsSync(g) && readFileSync(g, 'utf8').includes('ほかの人の泡')); i++) await sleep(100);
    assert.match(readFileSync(g, 'utf8'), /ほかの人の泡/);
    assert.doesNotMatch(readFileSync(g, 'utf8'), /ほかの端末で直した|この端末で直した|ログアウト中に書いた/, '新しい人のサーバーの個人へ前の人の泡を送らない');
  });

  await step('設定の「記録」の「バックアップ」に、この端末の控えが並び、前の利用者の控え（替わる前に取ったもの）はログイン中は戻せない（2026-11-19 から［戻す］）', async () => {
    await openSettings();
    await js(`const g = [...document.querySelectorAll('#pane-settings details')].find(d => d.querySelector('[data-name="バックアップ"]')); if (g) { g.open = true; g.dispatchEvent(new Event('toggle')); }`);
    await until(`return !!document.querySelector('[data-name="バックアップ"] .pbk-local .pbk-row button')`);
    const rows = await js(`return [...document.querySelectorAll('[data-name="バックアップ"] .pbk-local .pbk-row')].map(r => [r.querySelector('span').textContent, r.querySelector('button').disabled, r.querySelector('button').textContent])`);
    assert.ok(rows.some(([t]) => /別の利用者に替わる前/.test(t)), '別の利用者に替わる前の控えが並ぶ: ' + JSON.stringify(rows));
    assert.ok(rows.every(([, d, b]) => d === true && b === '戻す'), 'どれも前の人の控えなので押せない: ' + JSON.stringify(rows));
  });

  await step('CSP に止められた読み込みや、画面のエラーが無い', async () => {
    await sleep(300);
    assert.deepEqual(problems, []);
  });

  assert.doesNotMatch(serverLog, new RegExp(invite), 'サーバーの記録に招待コードの値を出さない');
  console.log(`\n${pass} passed (headless Chrome + 仮のパスキー)`);
  process.exit(0);
} catch (e) {
  console.log('FAIL - ' + (e?.message || e));
  console.log('problems:', problems);
  console.log('server:', serverLog.slice(-800));
  process.exit(1);
}
