/* 未実装タブの共通プレースホルダ。
   画面2以降が決まったら、このファイルを使う代わりに
   js/screens/<名前>.js を足して js/app.js の SCREENS に並べる。 */

import { el, escapeHtml } from '../ui.js';

/* opts = {
     id, label, icon,
     lead:    string    この画面が何を担うつもりかの1行
     bullets: string[]  未定の論点
     actions: [{label, on}]   任意。プロトタイプ操作
     note:    string          任意
   } */
export function makeStub(opts) {
  return {
    id: opts.id,
    label: opts.label,
    icon: opts.icon,

    mount(pane) {
      const box = el('div', 'stub');
      box.appendChild(el('span', 'tag', '未実装'));
      box.appendChild(el('h2', null, escapeHtml(opts.label)));
      if (opts.lead) box.appendChild(el('p', null, escapeHtml(opts.lead)));

      if (opts.bullets && opts.bullets.length) {
        box.appendChild(el('p', null, '決めていないこと：'));
        const ul = el('ul');
        opts.bullets.forEach(b => ul.appendChild(el('li', null, escapeHtml(b))));
        box.appendChild(ul);
      }

      if (opts.actions && opts.actions.length) {
        const proto = el('div', 'proto');
        proto.appendChild(el('h3', null, 'プロトタイプ操作'));
        const row = el('div', 'row');
        opts.actions.forEach(a => {
          const btn = el('button', 'btn', escapeHtml(a.label));
          btn.type = 'button';
          btn.addEventListener('click', a.on);
          row.appendChild(btn);
        });
        proto.appendChild(row);
        if (opts.note) proto.appendChild(el('p', 'note', escapeHtml(opts.note)));
        box.appendChild(proto);
      }

      pane.appendChild(box);
    },
  };
}
