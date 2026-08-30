/* 画面4「すきま」— すきま時間にできることを、状況ごとに置いておく画面。

   もとは「通信（あり／なし）× 使えるもの（耳だけ／画面）」の固定4枠で、
   1枠に置けるのは1個だけだった。利用者の指示で作り替えてある：

     ・枠はユーザーが決める（既定は前と同じ4つ。名前を変える・足す・消す・並べ替え）
     ・1枠に何個でもぶら下がる
     ・UI はきっかけと同じ（＝ cardlist.js。ここは設定を渡すだけ）

   きっかけとの違いは2つだけ。
     ・**日にちを持たない**（すきま時間は予定ではなく、来たときに来るもの）
     ・**「はじめた」を枠ごとに数えない**。枠は「いつ」ではなく「どんな状況か」なので、
       枠ごとに数え分けると、同じ着手が枠の数だけ増えてしまう */

import { store } from '../store.js';
import { makeCardScreen } from './cardlist.js';

export default makeCardScreen({
  id: 'gap',
  label: 'すきま',
  icon: '△',
  word: 'すきま',

  /* この画面の軸に当たる特別なタグ。入力欄の札からは外す（必ず付くので） */
  axisTag: 'gap',

  schedule: false,
  startPerCard: false,

  hint: 'すきまは、手が空いたときの「状況」のこと。'
    + '<br>耳だけ空いている / 画面が見られる / 電波が無い——'
    + 'その状況で進むものを繋いでおくと、探さずに始まる。'
    + '<br>まずは1つ、書いてみる。',
  namePlaceholder: '耳だけ / 画面 / 手が空いている …',
  unsortedNote: 'どの状況にも決めていないものが、ここに溜まる。'
    + '上の枠へドラッグすると、その状況に繋がる。',

  /* この画面が触る軸＝すきま時間の枠。
     きっかけと違い、「この画面に居る」印（gap）は枠と同じ軸が兼ねている */
  axis: {
    list:      () => store.gapSlots(),
    get:       (id) => store.gapSlot(id),
    add:       (name) => store.addGapSlot(name),
    rename:    (id, name) => store.renameGapSlot(id, name),
    remove:    (id) => store.removeGapSlot(id),
    move:      (id, d) => store.moveGapSlot(id, d),
    itemsIn:   (id) => store.inGapSlot(id),
    membersOf: (id) => (typeof store.gapSlotsOf === 'function' ? store.gapSlotsOf(id) : []),
    setMember: (todoId, cardId, on) => store.setGapSlot(todoId, cardId, on),
    moveItem:  (todoId, from, to) => store.moveToGapSlot(todoId, from, to),
    clearAll:  (todoId) => store.clearGapSlots(todoId),
    unsorted:  () => (typeof store.gapUnsorted === 'function' ? store.gapUnsorted() : []),
    setHere:   (todoId, on) => (typeof store.setGap === 'function' ? store.setGap(todoId, on) : false),
    isHere:    (todoId) => (typeof store.isGap === 'function' ? !!store.isGap(todoId) : false),
  },
});
