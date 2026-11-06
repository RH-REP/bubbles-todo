/* 取り消しの積み重ね（2026-11-07 Issue #22）。

   ■ 何を1つの塊にするか
   画面がトーストに「取り消す／元に戻す」を付けた操作1つを、1つの塊にする。
   完了・消す・今日に置く・タグを付ける／外す・海へ戻す・日を動かす・全部消す…と、
   戻す手順（action.on）はもう画面ごとに書いてあり、テストもある。ここはそれを
   **トーストが消えたあとも、新しいほうから順に**呼べるように控えるだけ。
   文字の書き換え（名前・本文）は塊にしない——欄の中ではブラウザの取り消し（⌘Z）が効き、
   面を閉じるたびに書き込むので、ここで1字ずつ控えると二重になる。

   ■ 決めごと
     ・控えるのは新しいほうから MAX 個まで。古いものは落とす
     ・TTL より古い塊は戻さない（ほかの端末で書き換わっていそうな昔の手を戻さない）
     ・トーストのボタンで戻したものは、ここからも外す（二重に戻さない）
     ・海を替えると読み直すので、積み重ねは消える（ほかの海の手は戻さない）

   DOM を触らない計算だけ。トーストとの繋ぎは js/ui.js、⌘Z／Ctrl+Z は js/app.js。 */

export const MAX = 20;
export const TTL = 10 * 60 * 1000;   /* 10分 */

export function createUndoStack({ max = MAX, ttl = TTL, now = () => Date.now() } = {}) {
  let list = [];

  function prune() {
    const t = now();
    list = list.filter(e => t - e.at <= ttl);
  }

  return {
    /* 控える。返り値の塊は remove() に渡せる */
    push(message, on) {
      if (typeof on !== 'function') return null;
      const e = { message: String(message || ''), on, at: now() };
      list.push(e);
      if (list.length > max) list = list.slice(list.length - max);
      return e;
    },
    remove(e) {
      list = list.filter(x => x !== e);
    },
    /* いちばん新しい塊を取り出す（無ければ null）。呼ぶのは取り出した側 */
    pop() {
      prune();
      return list.pop() || null;
    },
    size() {
      prune();
      return list.length;
    },
    clear() { list = []; },
  };
}
