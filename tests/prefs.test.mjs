/* この端末の表示（Issue #36）。node --test tests/prefs.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREFS_KEY, TAB_IDS, defaults, normalize, checkValue, applyChanges, changedFromDefault, changeLines,
  loadPrefs, savePrefs, buildPrefsPrompt, readPrefsReply, proposalText, proposalTitle,
} from '../js/prefs.js';

function mem() {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

test('既定: 起動は海・風は出さない・タグは出す・タブはいつもの並び', () => {
  const d = defaults();
  assert.equal(d.start, 'sea');
  assert.equal(d.wind, false);
  assert.equal(d.hideTags, false);
  assert.deepEqual(d.tabOrder, TAB_IDS);
  assert.equal(PREFS_KEY.startsWith('bubble_todo'), true);
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
