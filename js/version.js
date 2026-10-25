/* 画面の左上に出す版（2026-10-25 利用者の指示）。いちばん上の薄い帯の左端に出る（js/space.js）。
   正本は sw.js の VERSION（箱の名前。上げると利用者の端末で新しい版に入れ替わる）。
   sw.js を上げたら、ここも同じ値にする（tests/version.test.mjs が食い違いを見る）。
   module ではない普通の script（index.html の head で読む。CSP が script-src 'self' のため直書きしない） */
window.BUBBLES_VERSION = '2026-10-25f';
