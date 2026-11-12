/* 決めたフォルダに自動で控える（js/folderbackup.js。2026-11-12 利用者の指示）のテスト。
   素の Node と assert だけで走る。データはすべて架空。フォルダ・許し・時計は作り物。

     node tests/folderbackup.test.mjs */

import assert from 'node:assert/strict';

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
let fakeNow = new Date(2026, 10, 12, 10, 0).getTime();
Date.now = () => fakeNow;

const FB_URL = new URL('../js/folderbackup.js', import.meta.url).href;
const STORE_URL = new URL('../js/store.js', import.meta.url).href;
const { mergeBox } = await import(new URL('../js/movefile.js', import.meta.url).href);

let pass = 0;
const failed = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('ok   - ' + name); }
  catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

/* 作り物のフォルダ。files に名前 → 中身 */
function fakeDir(name = '控えのフォルダ', perm = 'granted') {
  const d = {
    name, files: new Map(), perm, writes: 0, fail: null, asked: 0,
    async queryPermission() { return d.perm; },
    async requestPermission() { d.asked++; d.perm = d.grantOnAsk ? 'granted' : d.perm; return d.perm; },
    async getFileHandle(n, opts) {
      if (!d.files.has(n) && !(opts && opts.create)) throw new Error('無い');
      return {
        async createWritable() {
          let buf = '';
          return {
            async write(t) { if (d.fail) throw new Error(d.fail); buf += t; },
            async close() { d.files.set(n, buf); d.writes++; },
          };
        },
      };
    },
  };
  return d;
}
/* IndexedDB の代わり */
function fakeHandles() {
  let h = null, k = null;
  return { load: async () => h, save: async (x) => { h = x; }, clear: async () => { h = null; }, peek: () => h,
    loadKey: async () => k, saveKey: async (x) => { k = x; }, clearKey: async () => { k = null; }, peekKey: () => k };
}
/* 時計の代わり（呼ぶまで動かない） */
function fakeTimers() {
  const q = new Map(); let n = 0;
  return {
    setTimeout(f) { q.set(++n, f); return n; }, clearTimeout(id) { q.delete(id); },
    setInterval(f) { q.set(++n, f); return n; }, clearInterval(id) { q.delete(id); },
    fire() { const fs = [...q.values()]; q.clear(); fs.forEach(f => f()); },
    get size() { return q.size; },
  };
}

let seq = 0;
async function setup(over = {}) {
  mem.clear();
  mem.set('bubble_todo_v1', JSON.stringify({ v: 2, todos: [{ id: 'm1', text: '架空の個人の泡', createdAt: 1, days: [] }], tags: [],
    stamps: { 'todo:m1': [1, 1], 'order:todo': [1, 1] } }));
  mem.set('bubble_todo_spaces', JSON.stringify([{ id: 'sabc1234', name: '架空の海', color: 'sand', at: 1, alive: 1 }]));
  mem.set('bubble_todo_sea_sabc1234_v1', JSON.stringify({ v: 2, todos: [{ id: 's1', text: '架空の海の泡', createdAt: 2 }],
    stamps: { 'todo:s1': [2, 1], 'order:todo': [2, 1] } }));
  /* サーバーの住所と合言葉（控えに入ってはいけない） */
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'http://127.0.0.1:1', token: 'FAKE-TOKEN-must-not-leak' }));
  const { store } = await import(`${STORE_URL}?fb=${++seq}`);
  const fb = await import(`${FB_URL}?fb=${seq}`);
  const timers = fakeTimers();
  const handles = fakeHandles();
  const b = fb.createFolderBackup(Object.assign({ store, handles, timers, supported: true, device: 'Mac' }, over));
  return { store, fb, b, timers, handles };
}
const tick = () => new Promise(r => setTimeout(r, 5));

/* ============================================================ */

await test('フォルダを選ぶと、その日のファイルにすべての海の記録を書く（合言葉は入れない。海域の名前と住所は入れる）', async () => {
  const { fb, b } = await setup();
  const dir = fakeDir();
  const st = await b.useFolder(dir);
  assert.equal(st.state, 'ok');
  assert.deepEqual([...dir.files.keys()], ['bubbles-backup-2026-11-12.json']);
  const text = dir.files.get('bubbles-backup-2026-11-12.json');
  const p = JSON.parse(text);
  assert.equal(p.format, fb.FORMAT);
  assert.deepEqual(Object.keys(p.boxes).sort(), ['me', 'sabc1234']);
  assert.equal(p.boxes.me.doc.todos[0].text, '架空の個人の泡');
  assert.equal(p.boxes.sabc1234.doc.todos[0].text, '架空の海の泡');
  assert.ok(p.seas.some(e => e.id === 'sabc1234'), '海の一覧が入っていない');
  assert.equal(p.device, 'Mac');
  assert.ok(!('server' in p));
  assert.ok(!text.includes('FAKE-TOKEN'), '合言葉が入っている');
  /* 海域の一覧（段2）。住所は入れ、鍵は入れない */
  assert.ok(Array.isArray(p.regions) && p.regions.some(r => r.url === 'http://127.0.0.1:1'), '海域の一覧が無い');
  assert.ok(p.regions.every(r => !('token' in r) && !('session' in r)));
  const c = fb.loadConf();
  assert.deepEqual([c.on, c.folder, c.lastName], [true, '控えのフォルダ', 'bubbles-backup-2026-11-12.json']);
});

await test('中身が同じなら書かない。書き換えると 30 秒の時計のあとで書く。今すぐ控えるはいつでも書く', async () => {
  const { store, b, timers } = await setup();
  const dir = fakeDir();
  b.start();
  await b.useFolder(dir);
  await tick();
  const w0 = dir.writes;
  await b.runNow();
  assert.equal(dir.writes, w0, '同じ中身を書いた');
  store.add('架空の新しい泡');
  assert.ok(timers.size >= 1);
  timers.fire();
  await tick(); await tick();
  assert.equal(dir.writes, w0 + 1, '書き換えのあとに書いていない');
  assert.ok(dir.files.get('bubbles-backup-2026-11-12.json').includes('架空の新しい泡'));
  await b.runNow(true);
  assert.equal(dir.writes, w0 + 2);
  b.stop();
});

await test('日が変わると新しいファイルに書き、前の日のファイルは残す', async () => {
  const { b } = await setup();
  const dir = fakeDir();
  await b.useFolder(dir);
  fakeNow = new Date(2026, 10, 13, 0, 5).getTime();
  await b.runNow();
  assert.deepEqual([...dir.files.keys()].sort(), ['bubbles-backup-2026-11-12.json', 'bubbles-backup-2026-11-13.json']);
  fakeNow = new Date(2026, 10, 12, 10, 0).getTime();
});

await test('書く許しが無ければ書かずに need-permission。出し直すと書く', async () => {
  const { b, handles } = await setup();
  const dir = fakeDir('控え', 'prompt');
  await handles.save(dir);
  mem.set('bubble_todo_folder_backup', JSON.stringify({ on: true, folder: '控え' }));
  const seen = [];
  b.on(s => seen.push(s.state));
  assert.equal((await b.runNow()).state, 'need-permission');
  assert.equal(dir.writes, 0);
  assert.ok(seen.includes('need-permission'), '知らせていない');
  dir.grantOnAsk = true;
  assert.equal((await b.regrant()).state, 'ok');
  assert.equal(dir.asked, 1);
  assert.equal(dir.writes, 1);
});

await test('書けなければ error と理由を出し、次の回にまた試す', async () => {
  const { b } = await setup();
  const dir = fakeDir();
  dir.fail = '空きが無い';
  const st = await b.useFolder(dir);
  assert.deepEqual([st.state, st.message], ['error', '空きが無い']);
  dir.fail = null;
  assert.equal((await b.runNow()).state, 'ok');
  assert.equal(dir.writes, 1);
});

await test('止めるとフォルダの覚えを捨て、それ以後は書かない（書いたファイルは消さない）', async () => {
  const { fb, b, handles } = await setup();
  const dir = fakeDir();
  await b.useFolder(dir);
  assert.equal((await b.turnOff()).state, 'off');
  assert.equal(handles.peek(), null);
  assert.equal(fb.loadConf().on, false);
  const w = dir.writes;
  await b.runNow(true);
  assert.equal(dir.writes, w);
  assert.equal(dir.files.size, 1);
});

await test('使えないブラウザでは何もしない（unsupported）', async () => {
  const { b } = await setup({ supported: false });
  assert.equal((await b.runNow(true)).state, 'unsupported');
  assert.equal(b.status().state, 'unsupported');
});

await test('控えのファイルを読み、記録を重ねて戻せる。引っ越しのファイル・壊れたものは断る', async () => {
  const { fb, b, store } = await setup();
  const dir = fakeDir();
  await b.useFolder(dir);
  const p = fb.readBackup(dir.files.get('bubbles-backup-2026-11-12.json'));
  const sum = fb.backupSummary(p);
  assert.deepEqual([sum.seas, sum.todos, sum.server], [2, 2, false]);
  /* 消してしまった端末に戻す（記録ごとに新しいほうが残る） */
  const empty = { doc: { v: 2, todos: [], tags: [] }, stamps: {} };
  const back = mergeBox(empty, p.boxes.me);
  assert.equal(back.doc.todos.find(t => t.id === 'm1').text, '架空の個人の泡');
  /* いまの記録のほうが新しければ、そちらが残る */
  store.setText('m1', '架空の個人の泡（直した）');
  const cur = mergeBox(store.exportState(), p.boxes.me);
  assert.equal(cur.doc.todos.find(t => t.id === 'm1').text, '架空の個人の泡（直した）');
  assert.throws(() => fb.readBackup(JSON.stringify({ format: 'bubbles-move', v: 1 })), /引っ越しのファイル/);
  assert.throws(() => fb.readBackup('{not json'), /JSON/);
  assert.throws(() => fb.readBackup(JSON.stringify({ format: 'bubbles-backup', boxes: [] })), /壊れている/);
  const withServer = fb.readBackup(JSON.stringify({ format: 'bubbles-backup', boxes: {}, server: { url: 'x', token: 'y' } }));
  assert.ok(!('server' in withServer), '控えのサーバーの欄は使わない');
});

await test('暗号化して書く（Issue #48 の B 案）: 平文が残らず、この端末の鍵でも合言葉でも開け、やめると平文に戻る', async () => {
  const { fb, b, handles } = await setup();
  const dir = fakeDir();
  await b.useFolder(dir);
  const pass = await b.startEncrypt();
  assert.match(pass, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
  assert.ok(handles.peekKey(), '鍵を置いていない');
  assert.equal(handles.peekKey().extractable, false, '鍵を取り出せる形で置いている');
  assert.ok(b.status().conf.enc && b.status().conf.enc.salt);
  assert.ok(!JSON.stringify(b.status().conf).includes(pass.replace(/-/g, '')), '合言葉を設定に置いている');
  const text = dir.files.get('bubbles-backup-2026-11-12.json');
  assert.equal(JSON.parse(text).format, fb.FORMAT_ENC);
  assert.ok(!text.includes('架空の個人の泡'), '平文が残っている');
  assert.ok(fb.encryptedHead(text));
  /* 同じ端末: 置いた鍵で開く */
  const p1 = await fb.openBackup(text, { key: await b.deviceKey() });
  assert.equal(p1.boxes.me.doc.todos[0].text, '架空の個人の泡');
  /* ほかの端末: 合言葉で開く（小文字・- なしでもよい） */
  const p2 = await fb.openBackup(text, { pass: pass.toLowerCase().replace(/-/g, '') });
  assert.equal(p2.boxes.sabc1234.doc.todos[0].text, '架空の海の泡');
  await assert.rejects(fb.openBackup(text, { pass: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' }), /合言葉が違う/);
  assert.throws(() => fb.readBackup(text), /暗号化した控え/);
  /* 鍵が無くなったら平文に戻さず、書かずに止まる */
  await handles.clearKey();
  assert.equal((await b.runNow(true)).state, 'need-key');
  assert.equal(dir.files.get('bubbles-backup-2026-11-12.json'), text);
  /* やめると平文で書き、鍵の覚えも消える */
  await b.startEncrypt();
  await b.stopEncrypt();
  assert.equal(handles.peekKey(), null);
  assert.equal(b.status().conf.enc, null);
  assert.equal(JSON.parse(dir.files.get('bubbles-backup-2026-11-12.json')).format, fb.FORMAT);
  /* 止めると鍵も捨てる */
  await b.startEncrypt();
  await b.turnOff();
  assert.equal(handles.peekKey(), null);
  /* 平文の控えも openBackup で読める */
  const plain = await fb.openBackup(JSON.stringify({ format: 'bubbles-backup', boxes: {} }));
  assert.deepEqual(plain.boxes, {});
});

/* ============================================================ */

Date.now = REAL_NOW;
console.log('');
console.log(`${pass} passed, ${failed.length} failed`);
if (failed.length) {
  failed.forEach(n => console.log('  failed: ' + n));
  process.exit(1);
}
