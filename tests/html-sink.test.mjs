/* 利用者・ほかの端末の人・AI が書いた文字が、HTML として解釈される道を作っていないかを見るテスト（Issue #14）。
   js/ui.js の el(tag, className, html) は第3引数を innerHTML に入れる。ここに名前・本文・ひとことなどを
   渡すと、共同の海でほかの人が書いた文字がスクリプトとして動き、端末の API キーを読み出せる。
   素の Node だけで走る（コードを字として読むだけ）。

     node tests/html-sink.test.mjs

   見るもの:
     1. el( の第3引数に、データの欄（.text .name .by .title .note .about .detail .memo .reason .url .label）が
        escapeHtml を通さずに入っていない
     2. ひとこと（共同の海で、ほかの端末の人が書く）の書いた人と文は textContent で描く */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0;
const failed = [];
function test(name, fn) {
  try { fn(); pass++; console.log('ok   - ' + name); } catch (e) {
    failed.push(name);
    console.log('FAIL - ' + name);
    console.log(String((e && e.message) || e).split('\n').slice(0, 12).map(l => '       ' + l).join('\n'));
  }
}

const root = new URL('../js/', import.meta.url);
const files = [];
for (const d of ['', 'screens/']) {
  for (const f of readdirSync(new URL(d, root))) if (f.endsWith('.js')) files.push(d + f);
}

/* el( の引数を、括弧と文字列の入れ子を数えながら切り出す */
function elCalls(src) {
  const out = [];
  const re = /(^|[^\w.$])el\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, q = null, cur = '';
    const args = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { cur += c; if (c === '\\') { cur += src[++i]; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    args.push(cur.trim());
    out.push({ at: src.slice(0, m.index).split('\n').length, args });
  }
  return out;
}

/* 文字列の中身を外して、式の部分だけを見る */
const code = s => s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
const DATA = /\.(text|name|by|title|note|about|detail|memo|reason|url|label)\b/;

test('el( の第3引数に、データの欄が escapeHtml を通さずに入っていない', () => {
  const bad = [];
  for (const f of files) {
    if (f === 'ui.js') continue;                        /* el 自身と toast（escapeHtml 済み） */
    const src = readFileSync(new URL(f, root), 'utf8');
    for (const c of elCalls(src)) {
      const h = c.args[2];
      if (!h) continue;
      const e = code(h);
      if (DATA.test(e) && !/escapeHtml\(/.test(e)) bad.push(`js/${f}:${c.at}  ${h.slice(0, 80)}`);
    }
  }
  assert.ok(files.length > 10, 'js を読めていない（テストの前提が崩れている）');
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
});

test('ひとことの書いた人と文は textContent で描く', () => {
  const src = readFileSync(new URL('bubble.js', root), 'utf8');
  const i = src.indexOf('function renderNotes');
  assert.ok(i > 0, 'renderNotes が見つからない（テストの前提が崩れている）');
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  assert.match(body, /\.textContent = n\.by/);
  assert.match(body, /\.textContent = n\.gone \? '（消した）' : String\(n\.text/);
});

console.log(`\n${pass} ok, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
