/* 書くときに選べる項目（2026-11-27 Issue #99「タグとか期間とかどの項目を選べるか設定で選択式にできる？」）。

   「思いついたことを書く」の上に出す札の列。海・今日・きっかけ・すきまの書く欄が、同じこの部品を使う。
   前は画面ごとに違っていた——海には札が無く、今日は欄に触っている間だけ、きっかけ・すきまは出しっぱなし。
   それで「選べる時と選べない時がある」ように見えていた。

   決めごと（どの画面でも同じ）:
     ・何を出すかは、設定の「書く欄で選べる項目」（js/prefs.js の composeParts）。既定は何も出さない（Issue #99 の返事）
     ・ふだんは畳む。書く欄に触ると開く。何か選んでいる間・打ちかけの間は開いたまま
       （畳んだまま何かが付くと、付くことが目に見えない）
     ・タグは送ったあとも残す（同じタグのものを続けて書くのが楽）。期間は 1 つごとに違うので、送ったら空にする
     ・設定で隠したタグ（Issue #90）は出さない。選んだままのものだけは、外せるように残す

   使い方:
     const opts = makeComposeOpts({ store, skip: () => ['done'] });
     form.prepend(opts.node);  input の focus で opts.open()、form の focusout で opts.closeSoon(form, input)
     足したあとで opts.apply(id) */

import { loadPrefs, PREFS_EVENT } from './prefs.js';

/* 設定で選んでいる項目（'tags'・'span'）。読めなければ既定のタグだけ */
export function composeParts() {
  try {
    const v = loadPrefs().composeParts;
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* store … tags()・setTag()・setSpan() を持つもの
   skip  … 札に出さないタグの id を返す関数（完了・その画面で必ず付くタグなど） */
export function makeComposeOpts({ store, skip }) {
  const node = el('div', 'tc-opts');
  const tagsEl = el('div', 'tc-tags');
  const spanEl = el('div', 'tc-span');
  node.appendChild(tagsEl);
  node.appendChild(spanEl);

  /* 選んだタグ。送ったあとも残す */
  const picked = new Set();

  /* 期間（開始日・終了日）。片方だけなら、その日 1 日（store.setSpan の決まり） */
  const startIn = el('input');
  startIn.type = 'date';
  startIn.setAttribute('aria-label', '期間の開始日');
  const dueIn = el('input');
  dueIn.type = 'date';
  dueIn.setAttribute('aria-label', '期間の終了日');
  const clearBtn = el('button', 'tc-span-clear', '外す');
  clearBtn.type = 'button';
  clearBtn.setAttribute('aria-label', '期間を外す');
  spanEl.appendChild(el('span', 'tc-span-lb', '期間'));
  spanEl.appendChild(startIn);
  spanEl.appendChild(el('span', 'tc-span-sep', '〜'));
  spanEl.appendChild(dueIn);
  spanEl.appendChild(clearBtn);
  const syncSpan = () => {
    const has = !!(startIn.value || dueIn.value);
    clearBtn.hidden = !has;
    if (has) open();
  };
  startIn.addEventListener('input', syncSpan);
  dueIn.addEventListener('input', syncSpan);
  startIn.addEventListener('change', syncSpan);
  dueIn.addEventListener('change', syncSpan);
  clearBtn.addEventListener('click', ev => {
    ev.preventDefault();
    startIn.value = ''; dueIn.value = '';
    syncSpan();
  });

  /* きっかけ・すきまの枠は、押した指で枠を動かす。札や欄を押した指は拾わせない */
  node.addEventListener('pointerdown', ev => ev.stopPropagation());

  function skipSet() {
    try { return new Set((typeof skip === 'function' && skip()) || []); } catch (e) { return new Set(); }
  }

  function tagList() {
    if (!store || typeof store.tags !== 'function') return [];
    const no = skipSet();
    try { return store.tags().filter(t => t && !no.has(t.id) && (!t.hidden || picked.has(t.id))); }
    catch (e) { return []; }
  }

  function chosen() {
    return picked.size > 0 || !!(startIn.value || dueIn.value);
  }

  function render() {
    const parts = composeParts();
    const useTags = parts.indexOf('tags') >= 0;
    const useSpan = parts.indexOf('span') >= 0;

    tagsEl.replaceChildren();
    const list = useTags ? tagList() : [];
    list.forEach(t => {
      const b = el('button', 'tc-tag');
      b.type = 'button';
      b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
      const dot = el('span', 'tc-dot');
      dot.setAttribute('aria-hidden', 'true');
      if (t.color) dot.style.setProperty('--tcd', t.color);
      const nm = el('span', 'tc-nm');
      nm.textContent = t.name;                          /* ユーザーの文字 */
      b.appendChild(dot);
      b.appendChild(nm);
      b.addEventListener('click', ev => {
        ev.preventDefault();
        if (picked.has(t.id)) picked.delete(t.id); else picked.add(t.id);
        b.setAttribute('aria-pressed', picked.has(t.id) ? 'true' : 'false');
        open();                                         /* 札を触ると欄から焦点が外れる。開いたままにする */
      });
      tagsEl.appendChild(b);
    });
    /* 消えたタグ・出さなくなったタグを選んだままにしない（見えないまま付くのを防ぐ） */
    [...picked].forEach(id => { if (!list.some(t => t.id === id)) picked.delete(id); });
    tagsEl.hidden = !list.length;

    if (!useSpan) { startIn.value = ''; dueIn.value = ''; }
    spanEl.hidden = !useSpan;
    clearBtn.hidden = !(startIn.value || dueIn.value);

    /* 出すものが 1 つも無ければ、枠ごと出さない */
    node.hidden = tagsEl.hidden && spanEl.hidden;
    if (!chosen() && !node.contains(document.activeElement)) node.classList.remove('is-open');
  }

  function open() {
    if (!node.hidden) node.classList.add('is-open');
  }

  /* 焦点が書く欄のまわりから出たら畳む。札を押したときは焦点が札へ移るだけなので畳まない。
     選んでいるもの・打ちかけがあれば開いたまま */
  function closeSoon(scope, input) {
    setTimeout(() => {
      if (scope && scope.contains(document.activeElement)) return;
      if (input && input.value.trim()) return;
      if (chosen()) return;
      node.classList.remove('is-open');
    }, 0);
  }

  /* 足したものに、選んだタグと期間を付ける。期間は空にする（タグは残す） */
  function apply(id) {
    if (!id || !store) return;
    if (typeof store.setTag === 'function') {
      picked.forEach(tg => { try { store.setTag(id, tg, true); } catch (e) { /* 無いタグ */ } });
    }
    if ((startIn.value || dueIn.value) && typeof store.setSpan === 'function') {
      try { store.setSpan(id, startIn.value || null, dueIn.value || null); } catch (e) { /* 読めない日 */ }
    }
    startIn.value = ''; dueIn.value = '';
    clearBtn.hidden = true;
  }

  window.addEventListener(PREFS_EVENT, render);
  render();

  return { node, render, open, closeSoon, apply };
}
