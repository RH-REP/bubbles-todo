/* 画面3「きっかけ」

   時計を持ち込まない画面。朝/昼/夜 という固定の枠はやめて、
   ユーザー自身が決めた「きっかけ」（歯を磨いたら、風呂から出たら…）の
   枠に、やることを入れる。狙いは実装意図——「もし〈状況〉なら〈行動〉」——で、
   〈状況〉を時刻ではなく、すでに毎日必ず起きている行動に置く。
   時刻は自分では起こらないが、歯磨きは自分で起きるため。

   だからこの画面には時刻表示も「いま」の強調も無い。並び順はユーザーが決める。

   **中身は cardlist.js。**すきまと同じUIにする指示があったので、
   画面の作りはあちらに1つだけ置いて、ここは「どの軸を触るか」と文言だけを渡す。
   きっかけだけが持つのは**日にち**（第n曜日・最終週）で、それが schedule:true。 */

import { store } from '../store.js';
import { makeCardScreen } from './cardlist.js';

export default makeCardScreen({
  id: 'plan',
  label: 'きっかけ',
  icon: '◇',
  word: 'きっかけ',

  /* きっかけは日にちを持てる（第n曜日・最終週）。すきまは持たない */
  /* この画面の軸に当たる特別なタグ。入力欄の札からは外す（必ず付くので） */
  axisTag: 'plan',

  schedule: true,
  /* 「はじめた」はきっかけごとに数える。
     同じことでも「歯を磨いたら」と「風呂から出たら」では別の着手なので */
  startPerCard: true,

  hint: 'きっかけは、すでに毎日かならず起きている行動のこと。'
    + '<br>歯を磨いたら / 風呂から出たら / コーヒーを淹れたら——'
    + 'そのあとに繋ぐと、思い出さなくても始まる。'
    + '<br>まずは1つ、書いてみる。',
  namePlaceholder: '歯を磨いたら / 風呂から出たら …',
  unsortedNote: 'きっかけを決めていないものが、ここに溜まる。'
    + '上の枠へドラッグすると、そのきっかけに繋がる。',

  /* この画面が触る軸＝アンカー */
  axis: {
    list:      () => store.anchors(),
    get:       (id) => store.anchor(id),
    add:       (name) => store.addAnchor(name),
    rename:    (id, name) => store.renameAnchor(id, name),
    remove:    (id) => store.removeAnchor(id),
    move:      (id, d) => store.moveAnchor(id, d),
    itemsIn:   (id) => store.inAnchor(id),
    membersOf: (id) => (typeof store.anchorsOf === 'function' ? store.anchorsOf(id) : []),
    setMember: (todoId, cardId, on) => store.setAnchor(todoId, cardId, on),
    moveItem:  (todoId, from, to) => store.moveItemAnchor(todoId, from, to),
    clearAll:  (todoId) => store.clearAnchors(todoId),
    /* 「この画面に来たが、まだどのカードにも入っていない」の軸 */
    unsorted:  () => (typeof store.planUnsorted === 'function' ? store.planUnsorted() : []),
    setHere:   (todoId, on) => (typeof store.setPlan === 'function' ? store.setPlan(todoId, on) : false),
    isHere:    (todoId) => (typeof store.isPlan === 'function' ? !!store.isPlan(todoId) : false),
  },
});
