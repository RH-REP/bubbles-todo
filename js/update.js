/* 設定の「最新の版を確認する」から呼ぶ、手で更新する仕組み（2026-11-02。利用者の指示）。

   ■ なぜ要るか
   sw.js は「次に開いたときに新しい版へ入れ替える」形（skipWaiting() を呼ばない）。
   iOS のホーム画面アプリは、閉じて開き直しても service worker の確認そのものが
   走らないことがある（WebKit の既知の挙動。裏で凍結されたまま戻る）。
   そのときの逃げ道として、**押した人だけ**その場で確認・入れ替えができるようにする。

   ■ やること
     1. 登録済みの service worker に update() を呼び、新しい sw.js を取りに行かせる
     2. 新しい版が「待機中（installed）」になったら、postMessage で skipWaiting を頼む
        （sw.js 側は、ふだんは呼ばない skipWaiting() を、この頼みが来たときだけ呼ぶ）
     3. controllerchange（入れ替わった合図）を受けたら、画面を読み直す

   ■ やらないこと
   勝手には呼ばない。**押した人の操作のときだけ**。走っている module を足元から
   差し替える副作用（sw.js の元のコメントが避けていたもの）は、ここでは
   「押した人が納得のうえでページを読み直す」ことで引き受ける。 */

/* 新しい版を確認する。見つかれば true（呼び出し側が applyUpdate を呼べる）、
   無ければ false。service worker が無い・登録できていない環境では null */
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  try { await reg.update(); } catch (e) { throw new Error('サーバーに届かない（網を確かめてください）'); }
  /* すでに待機中があれば、取りに行った結果それが育ったとみてよい */
  if (reg.waiting) return true;
  /* いま取りに行った分がインストールを終えるまで少し待つ（installing → installed） */
  if (reg.installing) {
    await new Promise((resolve) => {
      const sw = reg.installing;
      const onChange = () => {
        if (sw.state === 'installed' || sw.state === 'redundant') { sw.removeEventListener('statechange', onChange); resolve(); }
      };
      sw.addEventListener('statechange', onChange);
      setTimeout(resolve, 8000);   /* 固まらないための上限 */
    });
  }
  return !!reg.waiting;
}

/* 見つかった新しい版をいま適用する。終わるとページが読み直る（戻ってこない） */
export function applyUpdate() {
  return new Promise(async (resolve, reject) => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.waiting) { reject(new Error('新しい版が見当たらない')); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    reg.waiting.postMessage({ type: 'skipWaiting' });
    setTimeout(() => resolve(), 4000);   /* controllerchange が来なくても固まらない */
  });
}
