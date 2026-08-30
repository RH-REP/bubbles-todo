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
