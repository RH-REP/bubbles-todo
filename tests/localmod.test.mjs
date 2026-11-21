/* 見た目と言葉を AI で変える（Issue #91 の A 案）。node --test tests/localmod.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCALMOD_KEY, CSS_MAX, TEXT_MAX, MAX_MODS, cleanCss, cleanTexts, normalizeMod, makeMod, loadMods, saveMods, addMod,
  setModOn, removeMod, keepMod, dropTrials, markVersion, combinedCss, textMap, buildModPrompt, readModReply,
} from '../js/localmod.js';

function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

test('CSS: ふつうの規則は通り、注釈は落とす', () => {
  const r = cleanCss('/* x */ .bub { background: #0a0 !important; }\n:root{--bg:#000}');
  assert.equal(r.ok, true);
  assert.ok(!r.css.includes('/*'));
  assert.ok(r.css.includes('.bub'));
  assert.deepEqual(cleanCss(''), { ok: true, css: '' });
});

test('CSS: 外へ繋ぐもの・化けるもの・抜け出すものは当てない', () => {
  [
    '.a{background:url(https://example.com/x.png)}',
    '.a{background:URL ( x )}',
    '@import "x.css"; .a{}',
    '@font-face{font-family:x} .a{}',
    '.a{background:image-set("x.png" 1x)}',
    '.a{width:expression(alert(1))}',
    '.a{-moz-binding:x}',
    '.a{background:\\75 rl(x)}',
    '.a{} </style><script>x</script>',
    '.a > .b{color:red}',
    '.a{color:red',
    '.a{color:red}}',
    '.a{color:red} /* 閉じない',
    'color: red',
    '.a{x:' + 'y'.repeat(CSS_MAX) + '}',
  ].forEach(s => assert.equal(cleanCss(s).ok, false, s.slice(0, 40)));
});

test('言葉: 空・同じ・長すぎる・改行・重複は捨て、数を限る', () => {
  assert.deepEqual(cleanTexts([['今日は終わり', 'また明日'], ['', 'x'], ['a', 'a'], ['a\nb', 'c'], ['今日は終わり', '別'], ['x'.repeat(41), 'y']]),
    [['今日は終わり', 'また明日']]);
  assert.deepEqual(cleanTexts({ 'タスク開始': 'はじめる' }), [['タスク開始', 'はじめる']]);
  assert.deepEqual(cleanTexts([{ from: '海', to: 'うみ' }]), [['海', 'うみ']]);
  const many = Array.from({ length: 30 }, (_, i) => ['k' + i, 'v' + i]);
  assert.equal(cleanTexts(many).length, TEXT_MAX);
  assert.deepEqual(cleanTexts(null), []);
});

test('1件: 中身が無いものは捨て、試しの印を持てる', () => {
  assert.equal(normalizeMod({ css: '', texts: [] }), null);
  assert.equal(normalizeMod({ css: '.a{background:url(x)}' }), null);   /* 当てられない CSS だけなら残さない */
  const m = makeMod({ ask: '緑に', css: '.bub{color:green}', texts: [], ver: 'v1', trial: true });
  assert.equal(m.on, true);
  assert.equal(m.trial, true);
  assert.match(m.id, /^[a-z0-9]+$/);
});

test('置き場: 書いて読み、空なら箱ごと消す。上限を超えて足さない', () => {
  const s = mem();
  const a = makeMod({ css: '.a{color:red}' });
  const b = makeMod({ texts: [['海', 'うみ']] });
  assert.ok(saveMods(addMod(addMod([], a), b), s));
  const got = loadMods(s);
  assert.equal(got.length, 2);
  assert.equal(got[0].id, a.id);
  assert.ok(saveMods(removeMod(removeMod(got, a.id), b.id), s));
  assert.equal(s.getItem(LOCALMOD_KEY), null);
  let list = [];
  for (let i = 0; i < MAX_MODS; i++) list = addMod(list, makeMod({ css: '.a' + i + '{color:red}' }));
  assert.equal(addMod(list, makeMod({ css: '.z{color:red}' })), null);
  s.setItem(LOCALMOD_KEY, '{壊れた');
  assert.deepEqual(loadMods(s), []);
});

test('入れ切り・残す・試しを外す・版の印', () => {
  const a = makeMod({ css: '.a{color:red}', ver: 'v1' });
  const b = makeMod({ css: '.b{color:blue}', ver: 'v1', trial: true });
  let list = [a, b];
  assert.ok(combinedCss(list).includes('.a{color:red}'));
  list = setModOn(list, a.id, false);
  assert.ok(!combinedCss(list).includes('.a{color:red}'));
  assert.equal(dropTrials(list).length, 1);
  assert.equal(dropTrials(keepMod(list, b.id)).length, 2);
  const r = markVersion(list, 'v2');
  assert.equal(r.changed, true);              /* b は入れていて v1 で作った */
  assert.ok(r.list.every(m => m.ver === 'v2'));
  assert.equal(markVersion(r.list, 'v2').changed, false);
});

test('言葉の置き換えは後の変更が勝ち、切ったものは効かない', () => {
  const a = makeMod({ texts: [['海', 'うみ'], ['今日', 'きょう']] });
  const b = makeMod({ texts: [['海', 'ウミ']] });
  const m = textMap([a, b]);
  assert.equal(m.get('海'), 'ウミ');
  assert.equal(m.get('今日'), 'きょう');
  assert.equal(textMap(setModOn([a, b], b.id, false)).get('海'), 'うみ');
});

test('AI への文: 頼み・部品・class・今の変更だけ（記録は入らない）', () => {
  const p = buildModPrompt('完了の泡を緑に', [makeMod({ summary: '泡を大きく', css: '.bub{scale:1.2}' })], ['bub', 'tabbar']);
  assert.equal(p.user, '完了の泡を緑に');
  assert.ok(p.system.includes('JSON'));
  assert.ok(p.system.includes('bub tabbar'));
  assert.ok(p.system.includes('泡を大きく'));
  assert.ok(p.system.includes('#pane-settings'));
  assert.equal(buildModPrompt('x'.repeat(2000), [], []).user.length, 1000);
});

test('AI の返事を読む: 当てられない CSS は捨てて理由を返す', () => {
  const ok = readModReply('はい {"css": ".bub{color:green}", "texts": [["海","うみ"]], "summary": "緑", "reply": "緑にした"}');
  assert.equal(ok.css, '.bub{color:green}');
  assert.deepEqual(ok.texts, [['海', 'うみ']]);
  assert.equal(ok.why, '');
  const bad = readModReply('{"css": ".a{background:url(x)}", "texts": [], "reply": "x"}');
  assert.equal(bad.css, '');
  assert.ok(bad.why);
  const txt = readModReply('できません');
  assert.equal(txt.css, '');
  assert.equal(txt.reply, 'できません');
});

test('サーバーなし版だけで動かし、設定の画面では止める（app.js）。service worker の箱に入れてある', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(isSolo\(\)\) \{[\s\S]{0,200}startLocalMods/);
  assert.match(app, /pauseLocalMods\(next\.id === 'settings'\)/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/localmod.js'"));
  assert.ok(sw.includes('holdingNow'));
});
