/* 合言葉・復元コードを打つ欄（2026-11-13 Issue #53）。

   前は window.prompt で聞いていた。iPhone のホーム画面に置いた版で「窓は出るが打てない」が起きたため、
   ページの中の入力欄に替えた（貼り付け・パスワードの自動入力も使える）。
   ブラウザの窓と違い、待つ間に処理が止まらない（Promise で返る）。押した手の続きが要るパスキーの前には使わない
   （パスキーを呼ぶ前に await すると、パスキーが断られる端末がある）。

   askText(label, opts) → 打った文字（前後の空白を除く）。やめたら null。
   opts.document はテストで差し替える */

export function askText(label, opts = {}) {
  const doc = opts.document || globalThis.document;
  return new Promise(resolve => {
    const back = doc.createElement('div');
    back.className = 'ask-text';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', label);
    back.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;'
      + 'padding:16px;background:rgba(0,0,0,.4)';
    const form = doc.createElement('form');
    form.style.cssText = 'width:min(92vw,420px);padding:16px;border-radius:14px;background:var(--surface,#fff);color:var(--text,#111);'
      + 'box-shadow:0 14px 34px -12px rgba(0,0,0,.5);font:15px/1.5 system-ui,sans-serif;'
      + '-webkit-user-select:text;user-select:text';
    const p = doc.createElement('p');
    p.style.cssText = 'margin:0 0 10px;white-space:pre-wrap';
    p.textContent = label;
    const input = doc.createElement('input');
    input.type = 'text';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    /* iPhone は 16px 未満の欄に入ると画面を拡大するので 16px にする */
    input.style.cssText = 'box-sizing:border-box;width:100%;padding:10px;font-size:16px;border:1px solid var(--line-strong,#999);'
      + 'border-radius:10px;background:var(--bg,#fff);color:inherit;-webkit-user-select:text;user-select:text';
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px';
    const no = doc.createElement('button');
    no.type = 'button';
    no.className = 'btn';
    no.textContent = 'やめる';
    const yes = doc.createElement('button');
    yes.type = 'submit';
    yes.className = 'btn';
    yes.textContent = 'OK';
    row.appendChild(no);
    row.appendChild(yes);
    form.appendChild(p);
    form.appendChild(input);
    form.appendChild(row);
    back.appendChild(form);

    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      doc.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(v);
    };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); finish(null); } };
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const v = String(input.value || '').trim();
      finish(v || null);
    });
    no.addEventListener('click', () => finish(null));
    /* 欄の外を押してもやめない（打ちかけを失わないように）。やめるのは［やめる］か Esc だけ */
    doc.addEventListener('keydown', onKey, true);
    doc.body.appendChild(back);
    try { input.focus(); } catch (e) { /* 出ていればよい */ }
  });
}
