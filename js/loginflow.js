/* ログインの仕上げとログアウト（2026-11-18 ユーザーの指示「個人と個人サーバーが分かれている」「個人は全てのユーザーが１つもつ」
   「個人はオフラインでも使える」。モック docs/spec/mock/personal.html）。利用者の札（js/userchip.js）と設定の「海」（seapanel.js）が使う。

   finishLogin … 通行証を覚え、個人の海を 1 つにする（js/oneserver.js の loginPlan・applyLogin・replacePersonal）。
                  前に別の利用者がこの端末でログインしていたら、合わせずに聞く
   logoutFlow  … 個人の写しを残すか消すかを聞いて（既定は残す）、ログアウトする */
import { ensureServer, loginPlan, applyLogin, replacePersonal, logoutPersonal } from './oneserver.js';
import { regionConf, isPersonal } from './regions.js';
import { store } from './store.js';
import { sync } from './sync.js';
import { logoutPasskey } from './passkey.js';
import { fetchMe, saveMe, serverLogin } from './me.js';

export const AFTER_KEY = 'bubble_todo_after_login';   /* 読み直したあとに 1 回だけ出す知らせ（sessionStorage） */

/* 小さな確かめの札 → 押したボタンの番号（Escape・外を押したら最後のボタン） */
export function choose(title, text, buttons, name) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'space-sheet-back';
    const box = document.createElement('div');
    box.className = 'space-sheet';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    if (name) box.dataset.name = name;
    const h = document.createElement('h4');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(h);
    box.appendChild(p);
    const row = document.createElement('div');
    row.className = 'space-sheet-row';
    const done = (i) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(i); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); done(buttons.length - 1); } };
    buttons.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'btn is-primary' : 'btn';
      b.textContent = label;
      b.addEventListener('click', () => done(i));
      row.appendChild(b);
    });
    box.appendChild(row);
    back.appendChild(box);
    back.addEventListener('click', ev => { if (ev.target === back) done(buttons.length - 1); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    const first = row.querySelector('button');
    if (first) first.focus();
  });
}

function dropSession(rid, url) {
  if (rid === sync.region().id) sync.dropPasskeySession();
  else sync.configureRegion(rid, url, '', '');
}

/* ログインの答え（out）を覚え、個人の海を 1 つにする。やめたら Error（'ログインをやめた'）。→ {n: 合わせた泡の数, reload, rid} */
export async function finishLogin(url, out) {
  const r = ensureServer(url);
  if (!r) throw new Error('ログインを覚えられなかった');
  /* 通行証を覚える（＝同期が始まる）より先に決める。先に覚えると、同期が前の人の写しへ新しい人の個人を入れてしまう */
  const uid = out && out.user && out.user.id;
  const plan = loginPlan(uid);
  if (plan.kind === 'other') {
    const i = await choose('ほかの人の個人の写しがある',
      'この端末に、前にログインしていた別の利用者の個人の写しが残っている。ほかの人の個人と混ぜないため、写しは控えに移して、'
      + '「' + ((out.user && out.user.name) || out.name || '') + '」の個人を読む。',
      ['控えに移して読む', 'ログインをやめる'], '別の利用者の確かめ');
    if (i !== 0) {
      await logoutPasskey(url, out.session);
      throw new Error('ログインをやめた（前の写しはそのまま）');
    }
    replacePersonal(uid);
    /* 開いている個人の記録（メモリの中）も空にする。残すと、このあと始まる同期が前の人の泡を新しい人の個人へ送ってしまう */
    if (isPersonal(store.space())) store.applyState({ doc: {}, stamps: {} });
  }
  const n = applyLogin(uid, plan);
  if (!sync.usePasskeySessionRegion(r.id, url, out)) throw new Error('ログインを覚えられなかった');
  await fetchMe();
  if (n > 0) {
    try { sessionStorage.setItem(AFTER_KEY, 'この端末の個人の泡 ' + n + ' 件を、サーバーの個人と同じ記録にした（前の中身は控えに残した）'); } catch (e) { /* 出せなくても合わせてある */ }
  }
  /* 個人の箱を合わせた・入れ替えたら、画面を読み直す（開いている記録が前の箱のままなので） */
  return { n, reload: plan.kind !== 'none', rid: r.id };
}

/* ログアウト。個人の写しを残すか聞く（既定は残す）→ ログアウトしたか */
export async function logoutFlow(ask = true) {
  const L = serverLogin();
  if (!L) return false;
  let keep = true;
  if (ask) {
    const i = await choose('ログアウトする',
      'この端末に、個人の写しを残すか。残すと、ログインしていなくても読める・書ける。次に同じ利用者でログインしたら同じ記録にする。'
      + '共用の端末なら消す（サーバーには残る）。',
      ['写しを残す', '写しを消す', 'やめる'], 'ログアウトの確かめ');
    if (i === 2) return false;
    keep = i === 0;
  }
  const c = regionConf(L.rid) || {};
  dropSession(L.rid, c.url || L.url);
  await logoutPasskey(L.url, L.session);
  logoutPersonal(keep);
  saveMe(null);
  return true;
}
