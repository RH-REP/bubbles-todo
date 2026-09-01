/* 画面モジュールが共通で使う小物。 */

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

let toastNode = null;
let toastTimer = 0;

/* トースト。action を渡すと取り消しボタンが付く。
   action = { label:string, on:Function } */
export function toast(message, action, ms = 4200) {
  clearTimeout(toastTimer);
  if (toastNode) toastNode.remove();

  toastNode = el('div', 'toast');
  toastNode.setAttribute('role', 'status');
  toastNode.appendChild(el('span', null, escapeHtml(message)));

  if (action && typeof action.on === 'function') {
    const btn = el('button', null, escapeHtml(action.label || '元に戻す'));
    btn.type = 'button';
    btn.addEventListener('click', () => {
      hideToast();
      action.on();
    });
    toastNode.appendChild(btn);
  }

  document.body.appendChild(toastNode);
  toastTimer = setTimeout(hideToast, ms);
}

export function hideToast() {
  clearTimeout(toastTimer);
  if (toastNode) { toastNode.remove(); toastNode = null; }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------------- 長押しの手応え（利用者の指示） ----------------

   > 長押しは円形のゲージがチャージされるエフェクトをつけて

   長押しは「触って初めて存在が分かる」操作で、しかも押している間ずっと
   何も起きないので、**効いているのか、無視されているのか**が分からない。
   指の下に輪を出して、貯まりきると開く——貯まる途中で指を離せば、何も起きない
   ことも同時に分かる。

   place は指の座標（画面）。ドラッグ層に置くので、指は透ける。
   返り値の cancel() を呼ぶまで残る（呼び忘れても、貯まりきったら自分で消える）。

   「演出を減らす」設定のときは、貯まる動きは出さない。代わりに輪郭だけ出す
   ——動かないが、「いま押しっぱなしを受け取っている」ことは伝わる。 */
const RMQ = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export function holdRing(x, y, ms) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { cancel() {} };
  const layer = document.getElementById('drag-layer') || document.body;
  const ring = el('div', 'holdring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.left = Math.round(x) + 'px';
  ring.style.top = Math.round(y) + 'px';
  if (RMQ.matches) ring.classList.add('is-still');
  else ring.style.setProperty('--hold-ms', (Number(ms) || 480) + 'ms');
  layer.appendChild(ring);
  let gone = false;
  return {
    cancel() {
      if (gone) return;
      gone = true;
      ring.remove();
    },
  };
}
