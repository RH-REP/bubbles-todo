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

test('題名の欄（#10）に書いたものがあればそれを使い、空なら最初の1文', () => {
  assert.equal(F.issueTitle({ ...r, title: '  CSV の合言葉が\n分からない ' }), '[sea] CSV の合言葉が 分からない');
  assert.equal(F.issueTitle({ ...r, title: '' }), F.issueTitle(r));
  assert.equal(F.issueTitle({ screen: 'x', comment: '', title: 'い'.repeat(90) }), `[x] ${'い'.repeat(80)}…`);
  assert.equal(F.clipText({ ...r, title: '合言葉' }), `[sea] 合言葉\n\n${r.comment}`);
  assert.ok(decodeURIComponent(F.newIssueUrl('o/r', { ...r, title: '合言葉' })).includes('title=[sea] 合言葉&'));
});

test('題名を作る差し込み口は、渡したときだけボタンを出す（feedback.js の中身）', () => {
  assert.ok(src.includes('typeof opts.makeTitle === "function"'));
  assert.ok(/class="fb-aititle" hidden/.test(src));
  assert.ok(src.includes('title: titleIn.value.trim()'));
});

test('Issue の本文（URL で渡す方）は今までどおり付記を含む', () => {
  assert.ok(F.issueBody(r).includes('**画面**: `sea`'));
});
