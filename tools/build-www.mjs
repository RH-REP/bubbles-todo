/* Capacitor へ渡す www/ を作る。**アプリ本体はリポジトリ直下のまま**で、
   ここはその写しを1つ作るだけ。開発補助であり、アプリには含まれない。

   なぜ写すのか。GitHub Pages が見ているのはリポジトリのルートで、
   Pages が選べるのは「ルート」か「docs/」だけ。ソースを www/ へ動かすと公開が壊れる。
   かといって webDir に "." を渡すと、android/ や node_modules ごと
   ネイティブ側へ複写しようとして自分の中に自分を入れることになる。
   だから **www/ は生成物**にした（.gitignore 済み。消してよい）。

   写すものは sw.js の ASSETS と同じ顔ぶれ。**片方だけ足さないこと。**

     node tools/build-www.mjs        # npm run www と同じ */

import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');

/* 起動に要るものだけ。DEV_NOTES・tests・serve.py・.git は入れない */
const TAKE = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icons'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const name of TAKE) {
  await cp(join(ROOT, name), join(OUT, name), { recursive: true });
}
const got = (await readdir(OUT)).sort();
console.log('www/ を作り直した:', got.join(' '));
