/* サーバーは1つ（js/oneserver.js）。素の Node と assert だけで走る。

     node tests/oneserver.test.mjs

   2026-11-16 利用者の答え: ほかのサーバーの海は「この端末の海」にする（b）。何も送らず、記録の箱は消さない。 */

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

let pass = 0;
const failed = [];
function test(name, fn) {
  try { mem.clear(); fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.stack) || e).split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
  }
}

const { consolidate, theServer, serverUrl, ensureServer, canUnify, unifyPersonal, applyServerSeas, loginPlan, applyLogin, replacePersonal, logoutPersonal, OWNER_KEY, personalBackups, mergeBackup, bootUnify, serverPersonalBox } = await import(new URL('../js/oneserver.js', import.meta.url).href);
const { regionList, regionOfSpace } = await import(new URL('../js/regions.js', import.meta.url).href);
const { seaList } = await import(new URL('../js/spacelist.js', import.meta.url).href);

const box = (texts) => JSON.stringify({ todos: texts.map((t, i) => ({ id: 't' + i, text: t })) });
function twoServers() {
  mem.set('bubble_todo_regions', JSON.stringify([
    { id: 'local', name: 'この端末だけ' },
    { id: 'r0', name: 'サーバーA', legacyMe: true, legacyConf: true },
    { id: 'rb', name: 'サーバーB' },
  ]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S' }));
  mem.set('bubble_todo_sync_rb', JSON.stringify({ url: 'https://b.example', session: 'T' }));
  mem.set('bubble_todo_spaces', JSON.stringify([
    { id: 'saaa111', name: 'A の海', color: 'moss', at: 1, alive: 1, region: 'r0' },
    { id: 'sbbb111', name: 'B の海', color: 'dusk', at: 1, alive: 1, region: 'rb' },
  ]));
  mem.set('bubble_todo_me_rb_v1', box(['B の個人の泡']));
  mem.set('bubble_todo_sea_sbbb111_v1', box(['B の海の泡']));
}

test('サーバーが1つなら何もしない', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local' }, { id: 'r0', name: 'A', legacyMe: true, legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example' }));
  assert.equal(consolidate().changed, false);
  assert.equal(theServer().id, 'r0');
});

test('2つ目のサーバーの海と個人は、この端末の海になる。箱は消さず、何も送らない', () => {
  twoServers();
  const before = new Map(mem);
  const out = consolidate(1000);
  assert.equal(out.changed, true);
  assert.deepEqual(regionList().filter(r => r.kind === 'server').map(r => r.id), ['r0'], 'サーバーは前の版の住所のもの1つ');
  assert.equal(regionOfSpace('sbbb111'), 'local', 'B の海はこの端末の海');
  assert.equal(regionOfSpace('saaa111'), 'r0', 'A の海はそのまま');
  const copy = seaList().find(e => e.name === '個人（サーバーB）');
  assert.ok(copy, 'B の個人は「個人（サーバーB）」のこの端末の海として残る');
  assert.equal(regionOfSpace(copy.id), 'local');
  assert.equal(mem.get('bubble_todo_sea_' + copy.id + '_v1'), before.get('bubble_todo_me_rb_v1'), '中身を写した');
  for (const [k, v] of before) {
    if (k === 'bubble_todo_regions' || k === 'bubble_todo_spaces') continue;
    assert.equal(mem.get(k), v, k + ' は消さず、書き換えない');
  }
});

test('開いていた海が外した個人なら、写した海を開く', () => {
  twoServers();
  mem.set('bubble_todo_space', 'me.rb');
  const out = consolidate(1000);
  const copy = seaList().find(e => e.name === '個人（サーバーB）');
  assert.equal(out.reopen, copy.id);
  assert.equal(mem.get('bubble_todo_space'), copy.id);
});

test('空の個人は写さない。2回目は何もしない', () => {
  twoServers();
  mem.delete('bubble_todo_me_rb_v1');
  consolidate(1000);
  assert.equal(seaList().some(e => e.name === '個人（サーバーB）'), false);
  assert.equal(consolidate(2000).changed, false);
});

test('住所: 繋ぎ先があればそれ、無ければパスキーのサーバーが配るページ', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }]));
  assert.equal(serverUrl('https://page.example', 'passkey'), 'https://page.example');
  assert.equal(serverUrl('https://page.example', null), '', 'サーバーが配っていないページでは決めない');
  const r = ensureServer('https://page.example', 1000);
  assert.equal(r.kind, 'server');
  assert.equal(ensureServer('https://other.example', 2000).id, r.id, '2つ目は作らない');
  assert.equal(serverUrl('https://x.example', 'passkey'), 'https://page.example');
  assert.equal(regionOfSpace('me'), 'local', 'この端末の個人は動かさない');
});

test('個人をまとめる: 2つの箱を重ねて1つの個人にし、サーバーと合わせる。作った海は動かさない', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }, { id: 'rs1', name: 'サーバー', legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S' }));
  mem.set('bubble_todo_spaces', JSON.stringify([{ id: 'shome11', name: '家', color: 'moss', at: 1, alive: 1 }]));
  const todo = (id, text, at) => ({ id, text, createdAt: at });
  mem.set('bubble_todo_v1', JSON.stringify({ todos: [todo('a1', '端末の泡', 1)], stamps: { 'todo:a1': [10, 1] } }));
  mem.set('bubble_todo_me_rs1_v1', JSON.stringify({ todos: [todo('b1', 'サーバーの泡', 1)], stamps: { 'todo:b1': [20, 1] } }));
  mem.set('bubble_todo_space', 'me.rs1');
  assert.equal(regionOfSpace('shome11'), 'local');
  assert.equal(canUnify(), 'toServer');
  assert.equal(unifyPersonal(5000), 'me');
  const box = JSON.parse(mem.get('bubble_todo_v1'));
  const texts = (box.todos || []).map(t => t.text).sort();
  assert.deepEqual(texts, ['サーバーの泡', '端末の泡'], '両方残る');
  assert.equal(regionOfSpace('me'), 'rs1', '個人はサーバーと合わせる');
  assert.equal(regionOfSpace('shome11'), 'local', '作った海は動かさない');
  assert.equal(mem.get('bubble_todo_space'), 'me');
  assert.ok(mem.get('bubble_todo_v1_before_unify_5000'), '前の中身の控え');
  assert.ok(mem.get('bubble_todo_me_rs1_v1'), 'サーバーの個人の箱も消さない');
  assert.equal(canUnify(), null, '2度目はしない');
});

test('前からサーバーにつないでいた端末: この端末だけの個人（me.local）をサーバーの個人へ重ね、一覧から消す', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local' }, { id: 'r0', name: 'サーバー', legacyMe: true, legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S' }));
  const todo = (id, text) => ({ id, text, createdAt: 1 });
  mem.set('bubble_todo_v1', JSON.stringify({ todos: [todo('s1', 'サーバーの泡')], stamps: { 'todo:s1': [10, 1] } }));
  assert.equal(canUnify(), null, 'この端末だけの個人が空なら出さない');
  mem.set('bubble_todo_me_local_v1', JSON.stringify({ todos: [todo('l1', '端末の泡')], stamps: { 'todo:l1': [20, 1] } }));
  mem.set('bubble_todo_space', 'me.local');
  assert.equal(canUnify(), 'intoServer');
  assert.equal(unifyPersonal(7000), 'me');
  assert.deepEqual(JSON.parse(mem.get('bubble_todo_v1')).todos.map(t => t.text).sort(), ['サーバーの泡', '端末の泡']);
  assert.equal(mem.has('bubble_todo_me_local_v1'), false, 'この端末だけの個人は空になり、一覧から消える');
  assert.ok(mem.get('bubble_todo_me_local_v1_before_unify_7000'), '中身は控えに残す');
  assert.equal(mem.get('bubble_todo_space'), 'me');
  assert.equal(canUnify(), null);
});

test('サーバーの海の一覧を受け取る: 新しい海を足し、同じ ID のこの端末の海はサーバーの海にし、入れる置き場を入れ直す', () => {
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }, { id: 'rs1', name: 'サーバー', legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S', sessionSpaces: ['me'], sessionExpires: 9e9 }));
  mem.set('bubble_todo_spaces', JSON.stringify([{ id: 'shome11', name: '家', color: 'moss', at: 1, alive: 1, region: 'local' }]));
  const changed = applyServerSeas('rs1', { spaces: [
    { id: 'shome11', name: '家', color: 'moss', at: 2, alive: 1 },
    { id: 'swork22', name: '仕事', color: 'dusk', at: 3, alive: 1 }], access: ['me', 'shome11', 'swork22'] });
  assert.equal(changed, true);
  assert.equal(regionOfSpace('shome11'), 'rs1', '管理者が同じ ID で作った海はサーバーの海になる');
  assert.equal(regionOfSpace('swork22'), 'rs1');
  assert.deepEqual(JSON.parse(mem.get('bubble_todo_sync')).sessionSpaces, ['me', 'shome11', 'swork22']);
  assert.equal(applyServerSeas('rs1', { spaces: [], access: ['me', 'shome11', 'swork22'] }), false, '変わらなければ false');
});

/* ---- 個人の海は利用者 1 人に 1 つ（2026-11-18） ---- */
const { allSeas } = await import(new URL('../js/regions.js', import.meta.url).href);
function freshLogin() {
  /* この端末の個人（前の版からの個人）に泡があり、はじめてログインした端末 */
  mem.set('bubble_todo_regions', JSON.stringify([{ id: 'local', legacyMe: true }, { id: 'rs1', name: 'サーバー', legacyConf: true }]));
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S', sessionExpires: 9e9 }));
  const todo = (id, text) => ({ id, text, createdAt: 1 });
  mem.set('bubble_todo_v1', JSON.stringify({ todos: [todo('a1', '端末の泡1'), todo('a2', '端末の泡2')], stamps: { 'todo:a1': [10, 1], 'todo:a2': [10, 1] } }));
}

test('はじめてログイン: この端末の個人の泡を数え、合わせると個人は 1 つ（個人（サーバー）は出ない）', () => {
  freshLogin();
  assert.equal(allSeas().filter(s => s.personal).length, 2, '前: 個人が 2 つ並ぶ');
  const plan = loginPlan('u_aaaaaaaa');
  assert.deepEqual(plan, { kind: 'merge', n: 2 });
  assert.equal(applyLogin('u_aaaaaaaa', plan, 7000), 2);
  assert.equal(allSeas().filter(s => s.personal).length, 1, '後: 個人は 1 つ');
  assert.equal(allSeas().find(s => s.personal).name, '個人');
  assert.ok(mem.get('bubble_todo_v1_before_unify_7000'), '合わせる前の控え');
  assert.equal(mem.get(OWNER_KEY), 'u_aaaaaaaa', 'だれの写しかを覚える');
  assert.deepEqual(loginPlan('u_aaaaaaaa'), { kind: 'none' }, '同じ利用者でもう一度ログインしても何もしない（合わせは同期がする）');
});

test('別の利用者でログイン: 合わせずに聞く。控えへ移すと空の個人から始まる', () => {
  freshLogin();
  applyLogin('u_aaaaaaaa', loginPlan('u_aaaaaaaa'), 7000);
  const plan = loginPlan('u_bbbbbbbb');
  assert.deepEqual(plan, { kind: 'other', prev: 'u_aaaaaaaa' });
  const keep = replacePersonal('u_bbbbbbbb', 8000);
  assert.equal(keep, 'bubble_todo_v1_before_user_8000');
  assert.match(mem.get(keep), /端末の泡1/, '前の人の写しは控えに残る');
  assert.equal(mem.get('bubble_todo_v1'), undefined, '個人は空から');
  assert.equal(mem.get(OWNER_KEY), 'u_bbbbbbbb');
  assert.equal(allSeas().filter(s => s.personal).length, 1);
});

test('ログアウト: 残すなら写しとだれのかを残す。消すなら写しを消す', () => {
  freshLogin();
  applyLogin('u_aaaaaaaa', loginPlan('u_aaaaaaaa'), 7000);
  logoutPersonal(true);
  assert.ok(mem.get('bubble_todo_v1'));
  assert.equal(mem.get(OWNER_KEY), 'u_aaaaaaaa');
  logoutPersonal(false);
  assert.equal(mem.get('bubble_todo_v1'), undefined);
  assert.equal(mem.get(OWNER_KEY), undefined);
  assert.equal(allSeas().filter(s => s.personal).length, 1, '消しても個人は 1 つ（空）');
});


test('控え: 設定の「記録」に新しい順に並び、今の個人に重ねる（消さない）。前の利用者の控えはログイン中は重ねない', () => {
  freshLogin();
  applyLogin('u_aaaaaaaa', loginPlan('u_aaaaaaaa'), 7000);
  replacePersonal('u_bbbbbbbb', 8000);
  const list = personalBackups();
  assert.deepEqual(list.map(b => [b.kind, b.at, b.n, b.other]), [['user', 8000, 2, true], ['unify', 7000, 2, true]],
    '替わる前に取った合わせる前の控えも、前の人のもの');
  const cur = { doc: { todos: [{ id: 'b1', text: '今の泡', createdAt: 2 }] }, stamps: { 'todo:b1': [20, 1] } };
  assert.equal(mergeBackup('bubble_todo_v1_before_user_8000', cur, true), null, 'ログイン中は別の利用者の控えを重ねない');
  assert.equal(mergeBackup('bubble_todo_v1_before_unify_7000', cur, true), null, 'ログイン中は前の人の合わせる前の控えも重ねない');
  mem.set('bubble_todo_v1_before_unify_9000', mem.get('bubble_todo_v1_before_unify_7000'));
  const got = mergeBackup('bubble_todo_v1_before_unify_9000', cur, true);
  assert.deepEqual(got.doc.todos.map(t => t.text).sort(), ['今の泡', '端末の泡1', '端末の泡2'], '替わったあとの控えは重ねられる');
  assert.equal(mergeBackup('bubble_todo_v1_before_user_8000', cur, false).doc.todos.length, 3, 'ログアウト中なら重ねられる');
  assert.equal(mergeBackup('bubble_todo_ai_key', cur, false), null, '控えでない箱は読まない');
});

test('前の版からログインしていた端末: 開いたときに個人を 1 つにする（ログインし直さなくても）', () => {
  freshLogin();
  mem.set('bubble_todo_me_v1', JSON.stringify({ user: { id: 'u_aaaaaaaa', name: 'ゆき' }, seas: [] }));
  assert.equal(allSeas().filter(s => s.personal).length, 2, '前: 個人と個人（サーバー）が並ぶ');
  assert.equal(bootUnify(9100), 2);
  assert.equal(allSeas().filter(s => s.personal).length, 1, '後: 個人は 1 つ');
  assert.ok(mem.get('bubble_todo_v1_before_unify_9100'), '合わせる前の控え');
  assert.equal(mem.get(OWNER_KEY), 'u_aaaaaaaa');
  assert.equal(bootUnify(9200), 0, '2 回目は何もしない');
});

test('開いたとき: 通行証が切れている・別の人の写しなら合わせない', () => {
  freshLogin();
  mem.set('bubble_todo_sync', JSON.stringify({ url: 'https://a.example', session: 'S', sessionExpires: 1 }));
  assert.equal(bootUnify(9100), 0, '切れていれば合わせない');
  freshLogin();
  mem.set('bubble_todo_me_v1', JSON.stringify({ user: { id: 'u_bbbbbbbb' }, seas: [] }));
  mem.set(OWNER_KEY, 'u_aaaaaaaa');
  mem.set(serverPersonalBox(), JSON.stringify({ todos: [{ id: 'z1', text: '前の人の泡', createdAt: 1 }], stamps: { 'todo:z1': [5, 1] } }));
  assert.equal(loginPlan('u_bbbbbbbb').kind, 'other');
  const keys = [...mem.keys()].sort().join();
  assert.equal(bootUnify(9100), 0, '別の人の写しなら合わせない');
  assert.equal([...mem.keys()].sort().join(), keys, '何も書き換えない');
});

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
process.exit(0);
