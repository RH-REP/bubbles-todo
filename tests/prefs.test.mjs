/* この端末の表示（Issue #36）。node --test tests/prefs.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREFS_KEY, TAB_IDS, defaults, normalize, checkValue, applyChanges, changedFromDefault, changeLines,
  loadPrefs, savePrefs, buildPrefsPrompt, readPrefsReply, proposalText, proposalTitle, valueText, ITEMS, PAGES, BOARD_SHOW_FEW,
  visibleTabs,
} from '../js/prefs.js';

test('どの項目も、どの画面を変えるか（PAGES）のどれかに入る（Issue #49 の返事）', () => {
  const ids = new Set(PAGES.map(p => p[0]));
  ITEMS.forEach(it => {
    assert.ok(Array.isArray(it.pages) && it.pages.length, it.id + ' に pages が無い');
    it.pages.forEach(p => assert.ok(ids.has(p), it.id + ' の ' + p + ' は PAGES に無い'));
  });
});

test('盤の既定と、前の版で置いた値（2026-11-18 ユーザーの決定「5 つとも案どおりで実装して」）', () => {
  /* 2026-11-24 ユーザーの指示「作業記録より下はその他で畳んでみて」: 日付・タグを既定から外した（版 5） */
  const def = ['name', 'start', 'ended', 'done', 'notes', 'detail'];
  /* 毎回・ときどき使うものは畳まない。［書き留める］（ok）は選ぶものから外した */
  assert.deepEqual(defaults().boardShow, def);
  assert.equal(checkValue('boardShow', ['ok', 'name']).includes('ok'), false);
  /* 前の版で置いた値（印 boardShowV が 3 でない。11-17 の既定「名前だけ」など）は、新しい既定に替える */
  for (const old of [{ boardShow: ['name'] }, { boardShow: ['name'], boardShowV: 2 }, { boardShow: ['name', 'step'] }]) {
    const m = mem();
    m.setItem(PREFS_KEY, JSON.stringify(old));
    assert.deepEqual(loadPrefs(m).boardShow, def, JSON.stringify(old));
  }
  /* 今の版で「少なめ」にした値は、そのまま読む */
  const m2 = mem();
  savePrefs(applyChanges(loadPrefs(m2), { boardShow: BOARD_SHOW_FEW }).next, m2);
  assert.deepEqual(loadPrefs(m2).boardShow, ['name', 'start', 'done', 'detail']);
  assert.deepEqual(normalize(loadPrefs(m2)).boardShow, ['name', 'start', 'done', 'detail']);
  /* 2026-11-19: 次にやること（step）を出すと選んでいた今の版の値は、作業記録（detail）を出す */
  /* 2026-11-19: 版 3 の値はそのまま読み、期間を出すと選んでいればくりかえしも出す */
  const m4 = mem();
  m4.setItem(PREFS_KEY, JSON.stringify({ boardShow: ['name', 'span', 'start'], boardShowV: 3 }));
  assert.deepEqual(loadPrefs(m4).boardShow, ['name', 'start'], '版 3 の値も、作業記録より下（期間・くりかえし）は外す（版 5）');
  /* 2026-11-24 版 5: 版 4 の既定（日付・タグも出す）は、作業記録より下を外した値になる */
  const m5 = mem();
  m5.setItem(PREFS_KEY, JSON.stringify({ boardShow: ['name', 'start', 'ended', 'done', 'notes', 'detail', 'days', 'span', 'repeat', 'tags'], boardShowV: 4 }));
  assert.deepEqual(loadPrefs(m5).boardShow, def);
  const m6 = mem();
  m6.setItem(PREFS_KEY, JSON.stringify({ boardShow: ['name', 'detail', 'url', 'tags'], boardShowV: 4 }));
  assert.deepEqual(loadPrefs(m6).boardShow, ['name', 'detail', 'url'], '版 4 で選んでいたほかの欄（リンク）は残す');
  const m3 = mem();
  m3.setItem(PREFS_KEY, JSON.stringify({ boardShow: ['name', 'step', 'start', 'done'], boardShowV: 3 }));
  assert.deepEqual(loadPrefs(m3).boardShow, ['name', 'start', 'done', 'detail']);
});

test('盤にはじめから出す欄（Issue #49。set の項目）', () => {
  const d = defaults().boardShow;
  /* 既定（2026-11-18 ユーザーの決定。前は 2026-11-17 Issue #78 の返事で名前だけ） */
  assert.deepEqual(d, ['name', 'start', 'ended', 'done', 'notes', 'detail']);
  /* 知らない値は落とし、並びは選ぶものの順にそろえる。空でもよい */
  assert.deepEqual(checkValue('boardShow', ['url', 'name', 'xx', 'name']), ['name', 'url']);   /* 並びは BOARD_PARTS の順 */
  assert.deepEqual(checkValue('boardShow', []), []);
  assert.equal(checkValue('boardShow', 'name'), undefined);
  /* 既定と同じ中身なら、並びが違っても既定から変えたことにしない */
  assert.deepEqual(changedFromDefault({ boardShow: d.slice().reverse() }), {});
  const m = mem();
  savePrefs({ ...defaults(), boardShow: ['name', 'detail'] }, m);
  assert.deepEqual(loadPrefs(m).boardShow, ['name', 'detail']);
  assert.equal(valueText('boardShow', ['name', 'detail']), '名前・作業記録');
  assert.equal(valueText('boardShow', []), 'なし');
  assert.ok(buildPrefsPrompt('盤はリンクも出して', defaults()).system.includes('boardShow'));
});

function mem() {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

test('隠している機能を 1 つずつのスイッチに分ける（Issue #80 の返事「分けれる？」）', () => {
  const three = ['showCal', 'showSuggest', 'showQuad'];
  three.forEach(id => assert.equal(defaults()[id], false, id + ' の既定は隠す'));
  /* 週・月はリスト表示の形に移ったので、スイッチは無い（2026-11-23 の返事） */
  assert.equal(ITEMS.some(it => it.id === 'showPeriod'), false);
  /* 前の版で allTools をオンにしていた端末は、3 つともオンで読む */
  const old = normalize({ allTools: true });
  three.forEach(id => assert.equal(old[id], true, id));
  /* 分けた版で 1 つだけ切ったら、読み直しても切ったまま（印 optV で読み替えない） */
  const m = mem();
  m.setItem(PREFS_KEY, JSON.stringify({ allTools: true }));
  savePrefs(applyChanges(loadPrefs(m), { showSuggest: false }).next, m);
  const p = loadPrefs(m);
  assert.equal(p.showSuggest, false);
  assert.equal(p.showCal, true);
  assert.equal(p.allTools, true);
  /* 1 つだけ出す（allTools は触らない） */
  const m2 = mem();
  savePrefs(applyChanges(loadPrefs(m2), { showCal: true }).next, m2);
  assert.deepEqual(JSON.parse(m2.getItem(PREFS_KEY)), { showCal: true });
});

test('リスト表示を開いたときの形に、週・月がある（Issue #80 の返事「リスト表示の…週と月を増やして」）', () => {
  assert.equal(checkValue('listStart', 'week'), 'week');
  assert.equal(checkValue('listStart', 'month'), 'month');
});

test('下のタブの出し入れ（Issue #80 の返事「海、今日、きっかけ、すきま、週月の表示非表示」）', () => {
  assert.deepEqual(defaults().tabShow, TAB_IDS);
  assert.deepEqual(visibleTabs(defaults()), TAB_IDS);
  const p = applyChanges(defaults(), { tabShow: ['today', 'gap'] }).next;
  assert.deepEqual(visibleTabs(p), ['today', 'gap']);
  /* 並べ替えにも付いていく */
  assert.deepEqual(visibleTabs(applyChanges(p, { tabOrder: ['gap', 'plan', 'sea', 'today'] }).next), ['gap', 'today']);
  /* 1 つも出さない値は、全部出すに戻す */
  assert.deepEqual(normalize({ tabShow: [] }).tabShow, TAB_IDS);
});

test('既定: 起動は海・風は出さない・タグは出す・タブはいつもの並び', () => {
  const d = defaults();
  assert.equal(d.start, 'sea');
  assert.equal(d.wind, false);
  assert.equal(d.hideTags, false);
  assert.deepEqual(d.tabOrder, TAB_IDS);
  assert.equal(PREFS_KEY.startsWith('bubble_todo'), true);
});

test('リスト表示の一覧の並び: 既定は新しい順、古い順に切り替えて端末に残る（Issue #69）', () => {
  assert.equal(defaults().listOrder, 'new');
  assert.equal(checkValue('listOrder', 'old'), 'old');
  assert.equal(checkValue('listOrder', 'random'), undefined);
  const m = mem();
  savePrefs(applyChanges(loadPrefs(m), { listOrder: 'old' }).next, m);
  assert.equal(loadPrefs(m).listOrder, 'old');
  assert.deepEqual(JSON.parse(m.getItem(PREFS_KEY)), { listOrder: 'old' });
  /* 新しい順（既定）に戻せば、箱ごと消える */
  savePrefs(applyChanges(loadPrefs(m), { listOrder: 'new' }).next, m);
  assert.equal(m.getItem(PREFS_KEY), null);
});

test('読めない値は既定で埋める', () => {
  const n = normalize({ start: 'settings', wind: 'yes', hideTags: 1, tabOrder: ['sea', 'sea', 'plan', 'gap'], other: 1 });
  assert.deepEqual(n, defaults());
  assert.equal(normalize(null).start, 'sea');
  assert.equal(checkValue('tabOrder', ['gap', 'plan', 'today', 'sea']).join(','), 'gap,plan,today,sea');
  assert.equal(checkValue('tabOrder', ['gap', 'plan', 'today']), undefined);
  assert.equal(checkValue('nope', true), undefined);
});

test('変更を重ねる: 項目に無いもの・形の違うものは捨てる。同じ値は数えない', () => {
  const r = applyChanges(defaults(), { start: 'today', wind: true, hideTags: false, css: 'body{}', tabOrder: 'x' });
  assert.equal(r.next.start, 'today');
  assert.equal(r.next.wind, true);
  assert.deepEqual(r.applied.sort(), ['start', 'wind']);
  assert.deepEqual(r.ignored.sort(), ['css', 'tabOrder']);
  assert.deepEqual(applyChanges(defaults(), null).applied, []);
  assert.deepEqual(applyChanges(defaults(), ['start']).applied, []);
});

test('保存は既定から変えた項目だけ。全部既定なら箱ごと消す', () => {
  const s = mem();
  assert.equal(savePrefs({ ...defaults(), wind: true }, s), true);
  assert.deepEqual(JSON.parse(s.getItem(PREFS_KEY)), { wind: true });
  assert.equal(loadPrefs(s).wind, true);
  assert.equal(loadPrefs(s).start, 'sea');
  savePrefs(defaults(), s);
  assert.equal(s.getItem(PREFS_KEY), null);
  s.setItem(PREFS_KEY, '{壊れた');
  assert.deepEqual(loadPrefs(s), defaults());
});

test('AI に送る文: 書いた文と項目・今の値だけ（泡の中身を入れる口が無い）', () => {
  const p = buildPrefsPrompt('起動したら今日を開いて', { ...defaults(), hideTags: true });
  assert.equal(p.user, '起動したら今日を開いて');
  assert.ok(p.system.includes('start'));
  assert.ok(p.system.includes('"today"'));
  assert.ok(p.system.includes('今: true'));
  assert.equal(buildPrefsPrompt('あ'.repeat(5000), defaults()).user.length, 1000);
});

test('AI の返事を読む: 前後に文があっても JSON を拾う。読めなければ変更なし', () => {
  const r = readPrefsReply('はい。\n{"changes": {"start": "today"}, "reply": "起動時を今日にします"}\n以上');
  assert.deepEqual(r.changes, { start: 'today' });
  assert.equal(r.reply, '起動時を今日にします');
  const bad = readPrefsReply('その変更はできません');
  assert.deepEqual(bad.changes, {});
  assert.equal(bad.reply, 'その変更はできません');
  assert.deepEqual(readPrefsReply('{"changes": [1]}').changes, {});
});

test('変更の行と、全体への提案の文（変えた項目だけ）', () => {
  const after = { ...defaults(), start: 'today', tabOrder: ['today', 'sea', 'plan', 'gap'] };
  const lines = changeLines(defaults(), after);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('海 → 今日'));
  assert.deepEqual(Object.keys(changedFromDefault(after)).sort(), ['start', 'tabOrder']);
  const body = proposalText(after);
  assert.ok(body.includes('（start）'));
  assert.ok(body.includes('今日・海・きっかけ・すきま'));
  assert.ok(!body.includes('wind'));
  assert.ok(proposalTitle(after).startsWith('既定の提案: '));
  assert.ok(proposalTitle(after).endsWith('ほか1件'));
  assert.equal(proposalText(defaults()), '');
});

test('sw.js の ASSETS に prefs.js がある', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/prefs.js'"));
});

test('書く欄で選べる項目（2026-11-27 Issue #99。composeParts）', () => {
  /* 既定はタグだけ（前から今日・きっかけ・すきまで出ていたもの） */
  assert.deepEqual(defaults().composeParts, ['tags']);
  /* 並びは選ぶものの順。知らない値は落とす。空（何も出さない）でもよい */
  assert.deepEqual(checkValue('composeParts', ['span', 'xx', 'tags']), ['tags', 'span']);
  assert.deepEqual(checkValue('composeParts', []), []);
  const m = mem();
  savePrefs(applyChanges(loadPrefs(m), { composeParts: ['span'] }).next, m);
  assert.deepEqual(loadPrefs(m).composeParts, ['span']);
  /* 部品は先に取っておく（網が無くても書く欄が開く） */
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/composeopts.js'"));
});
