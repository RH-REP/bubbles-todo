/* 右上の !（js/feedback.js）の題名と、クリップボードに置く文を見る（Issue #5）。
   クリップボードには「題名、空行、コメント」だけを置き、画面・版・時刻などの付記は入れない。

     node --test tests/feedback.test.mjs */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../js/feedback.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const F = ctx.window.AppFeedback;

const r = { screen: 'sea', app: 'bubble_todo', version: '0.1.0', at: '2026-11-02T04:33:14.248Z',
  comment: '書き出したCSVを読み込むのによくわからない合言葉がいる。また、サーバーの接続情報とかも引き継げない。',
  context: { device: 'iOS・375×647', summary: '画面 sea ・ 海 0' } };

test('題名はコメントの最初の1文', () => {
  assert.equal(F.issueTitle(r), '[sea] 書き出したCSVを読み込むのによくわからない合言葉がいる。');
});

test('クリップボードの文は、題名・空行・コメントだけ', () => {
  const t = F.clipText(r);
  assert.equal(t, `[sea] 書き出したCSVを読み込むのによくわからない合言葉がいる。\n\n${r.comment}`);
  for (const x of ['**画面**', '**app**', '**時刻**', '今の状態', '### コメント', '<!--']) assert.ok(!t.includes(x), x);
});

test('句点の無い長いコメントは 50 字で切る', () => {
  const t = F.issueTitle({ screen: 'board', comment: 'あ'.repeat(80) });
  assert.equal(t, `[board] ${'あ'.repeat(50)}…`);
});

test('改行より前の1行目から取り、！？も文の終わりにする', () => {
  assert.equal(F.issueTitle({ screen: 'x', comment: '止まった!? 何度も\n2行目' }), '[x] 止まった!?');
  assert.equal(F.issueTitle({ screen: 'x', comment: '' }), '[x] （コメントなし）');
});

test('Issue の本文（URL で渡す方）は今までどおり付記を含む', () => {
  assert.ok(F.issueBody(r).includes('**画面**: `sea`'));
});
