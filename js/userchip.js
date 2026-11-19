/* 左上の利用者のアイコンと利用者の札（2026-11-18 ユーザーの決定「4 つとも案どおり」。モック docs/spec/mock/settings.html、
   取り決め 実装の取り決め.md §7.1）。サーバーあり版（index.html）だけ。サーバーなし版にはログインが無いので出さない。

     左上（left:10px）に 44px の丸。user.avatar の color に emoji（無ければ名前の頭 1 字）。ログインしていなければ点線の 👤。
     押すと利用者の札:
       ログイン中   … 名前とアイコン［変える］、app の切り替え（bubble・gantt・diary）、わたしの端末、ログアウト
       していない   … パスキーでログイン、はじめての端末（招待で登録・番号で足す・登録を頼む → 設定の「海」のログインの欄）
     2026-11-19（取り決め §7.1 v1.3）: 設定の行は外した。設定は右上の ⚙（「!」の左どなり）から（2 か所にしない）
     札の中の画面: アイコンを選ぶ（#avatar で開く）・わたしの端末（#devices で開く）・復元の鍵で戻る（ログインしていないとき）
     2026-11-19 復元の鍵: わたしの端末で作る・消す（作ったときだけ鍵を出す）。ログインしていない札の［復元の鍵で戻る］で使う。
     鍵で端末が足されたら、ほかの端末に次に開いたとき知らせる（/api/me の user.recoveryNotice。見た時刻は端末が覚える）
   ≡（引き出し）はこの右どなり（left:62px。css/base.css の html.has-userbtn）。⚙ は右上（right:62px。js/app.js の gearbtn）。 */
import { meInfo, serverLogin, fetchMe, saveMe, ME_EVENT } from './me.js';
import { myDevices, removeDevice, listAvatars, setAvatar } from './seaadmin.js';
import { loginPasskey, logoutPasskey, makeDeviceCode, authMode, registerPasskey, makeRecoveryKey, removeRecoveryKey } from './passkey.js';
import { deviceLabel } from './device.js';
import { theServer } from './oneserver.js';
import { finishLogin, logoutFlow, AFTER_KEY } from './loginflow.js';
import { regionConf } from './regions.js';
import { sync } from './sync.js';
import { toast } from './ui.js';
import { appUrls, APPS } from './apps.js';

/* 字は textContent で入れる（js/ui.js の el と違い innerHTML を使わない。名前は利用者が入れた字） */
function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* アイコンの丸に、アイコン（または名前の頭 1 字）を描く */
export function paintAvatar(node, user) {
  const av = user && user.avatar;
  node.classList.toggle('is-empty', !user);
  if (!user) { node.textContent = '👤'; node.style.background = ''; return; }
  if (av && av.emoji) { node.textContent = av.emoji; node.style.background = av.color || ''; }
  else { node.textContent = Array.from(user.name || '?')[0] || '?'; node.style.background = ''; }
}

function me() { return serverLogin() ? meInfo() : null; }

let btn = null;
let back = null;

function goSettings(after) {
  close();
  window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'settings' } }));
  if (after) setTimeout(() => window.dispatchEvent(new CustomEvent(after)), 50);
}

export function close() {
  if (!back) return;
  back.remove();
  back = null;
  document.removeEventListener('keydown', onKey, true);
  if (btn) { btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); btn.focus({ preventScroll: true }); }
}
function onKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); close(); } }

/* 札を開く。page: 'main' | 'avatar' | 'devices' */
export function open(page = 'main') {
  if (back) close();
  back = mk('div', 'uc-back');
  back.addEventListener('click', ev => { if (ev.target === back) close(); });
  const card = mk('div', 'uc-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', '利用者の札');
  card.dataset.name = '利用者の札';
  back.appendChild(card);
  document.body.appendChild(back);
  document.addEventListener('keydown', onKey, true);
  if (btn) { btn.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
  render(card, page);
}

function row(icon, title, sub, onClick, cls) {
  const b = mk('button', 'uc-row' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.appendChild(mk('span', 'uc-ic', icon));
  const tx = mk('span', 'uc-tx');
  tx.appendChild(mk('b', null, title));
  if (sub) tx.appendChild(mk('small', null, sub));
  b.appendChild(tx);
  b.addEventListener('click', onClick);
  return b;
}

function head(card, title, backTo) {
  const h = mk('div', 'uc-head');
  if (backTo) {
    const bk = mk('button', 'uc-back-btn', '‹');
    bk.type = 'button';
    bk.setAttribute('aria-label', 'もどる');
    bk.addEventListener('click', () => render(card, backTo));
    h.appendChild(bk);
  }
  h.appendChild(mk('b', null, title));
  card.appendChild(h);
}

function render(card, page) {
  card.textContent = '';
  const u = me();
  if (!u && page !== 'main' && page !== 'recover') page = 'main';
  if (page === 'avatar') return renderAvatar(card, u);
  if (page === 'devices') return renderDevices(card, u);
  if (!u && page === 'recover') return renderRecover(card);
  if (!u) return renderLoggedOut(card);
  /* 名前とアイコン */
  const who = mk('div', 'uc-who');
  who.dataset.name = '利用者の名前とアイコン';
  const big = mk('span', 'uc-big');
  paintAvatar(big, u.user);
  who.appendChild(big);
  const nm = mk('div', 'uc-nm');
  nm.appendChild(mk('b', null, u.user.name || ''));
  const L = serverLogin();
  const c = L ? regionConf(L.rid) : null;
  nm.appendChild(mk('small', null, (c && c.sessionName ? c.sessionName + ' で' : '') + 'ログイン中'));
  who.appendChild(nm);
  const ch = mk('button', 'btn', '変える');
  ch.type = 'button';
  ch.dataset.name = 'アイコンを変える';
  ch.addEventListener('click', () => render(card, 'avatar'));
  who.appendChild(ch);
  card.appendChild(who);
  card.appendChild(appSwitch());
  card.appendChild(row('📱', 'わたしの端末', '一覧・外す・＋ 端末を足す', () => render(card, 'devices')));
  card.appendChild(row('↩', 'ログアウト', null, logout));
}

/* app の切り替え（bubble・gantt・diary。今の app に枠）。同じタブで移る（§7.2） */
function appSwitch() {
  const box = mk('div', 'uc-apps');
  box.dataset.name = 'app の切り替え';
  const urls = appUrls();
  APPS.forEach(([id, label, icon]) => {
    const here = id === 'bubble';
    const a = mk(here ? 'span' : 'a', 'uc-app' + (here ? ' is-cur' : ''));
    a.appendChild(mk('i', null, icon));
    a.appendChild(document.createTextNode(label));
    if (here) a.setAttribute('aria-current', 'page');
    else if (urls[id]) a.href = urls[id];
    else { a.classList.add('is-off'); a.title = 'この app の住所を知らない（サーバーの --app-url）'; }
    a.dataset.name = here ? 'bubble（今ここ）' : label + ' へ移る';
    box.appendChild(a);
  });
  return box;
}

function renderLoggedOut(card) {
  head(card, 'ログインしていない');
  card.appendChild(mk('p', 'uc-note', 'ログインすると、ほかの端末・ほかの人と合わせられる。gantt・diary も同じ利用者で使える。'));
  const go = mk('button', 'btn main uc-wide', '🔑 パスキーでログイン');
  go.type = 'button';
  go.dataset.name = 'パスキーでログインボタン';
  const line = mk('p', 'uc-note'); line.setAttribute('aria-live', 'polite');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { await loginHere(); }
    catch (e) { line.textContent = (e && e.message) || 'ログインできなかった'; go.disabled = false; }
  });
  card.appendChild(go);
  card.appendChild(line);
  card.appendChild(mk('p', 'uc-sec', 'はじめての端末'));
  card.appendChild(row('✉', '招待で登録する', 'リンクかコードを持っている人', () => goSettings('bubbles:open-login')));
  card.appendChild(row('#', '番号で足す', '自分のほかの端末に出した 6 桁', () => goSettings('bubbles:open-login')));
  card.appendChild(row('✋', '登録を頼む', 'サーバーの管理者に認めてもらう', () => goSettings('bubbles:open-login')));
  card.appendChild(mk('p', 'uc-sec', 'パスキーを全部なくした'));
  card.appendChild(row('🗝', '復元の鍵で戻る', '前に「わたしの端末」で作った鍵（24 字）', () => render(card, 'recover')));
}

/* このページのサーバーの住所（ログインの道と同じ）。サーバーが配っていないページなら投げる */
async function hereUrl() {
  const r0 = theServer();
  const c0 = r0 ? regionConf(r0.id) : null;
  let url = (c0 && c0.url) || '';
  if (!url) {
    const mode = await authMode(location.origin);
    if (mode !== 'passkey') throw new Error('このページはサーバーが配っていないので、ここではログインできない（設定の「海」から）');
    url = location.origin;
  }
  return url;
}

/* 復元の鍵で戻る（2026-11-19）。鍵が合えば、この端末に新しいパスキーを作り、前と同じ利用者でログインする */
function renderRecover(card) {
  head(card, '復元の鍵で戻る', 'main');
  card.dataset.page = 'recover';
  card.appendChild(mk('p', 'uc-note', 'パスキーを全部なくしたときに。前に「わたしの端末」で作った復元の鍵を入れると、この端末に新しいパスキーを作り、前と同じ利用者に戻る（記録・海・アイコンもそのまま）。'));
  const f = mk('form', 'uc-form');
  f.dataset.name = '復元の鍵の欄';
  const lab = (t, inp) => { const l = mk('label', 'uc-fld'); l.appendChild(mk('span', null, t)); l.appendChild(inp); f.appendChild(l); return inp; };
  const key = mk('input', 'uc-in uc-key');
  key.type = 'text';
  key.autocomplete = 'off';
  key.spellcheck = false;
  key.setAttribute('autocapitalize', 'characters');
  key.placeholder = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
  lab('復元の鍵', key);
  const dev = mk('input', 'uc-in');
  dev.type = 'text';
  dev.maxLength = 40;
  try { dev.value = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1); } catch (e) { dev.value = ''; }
  lab('この端末の呼び名', dev);
  const go = mk('button', 'btn main uc-wide', 'この端末にパスキーを作って戻る');
  go.type = 'submit';
  f.appendChild(go);
  const line = mk('p', 'uc-note'); line.setAttribute('aria-live', 'polite');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const k = key.value.replace(/[^0-9a-z]/gi, '');
    if (k.length !== 24) { line.textContent = '復元の鍵は 24 字（区切りの - は無くてもよい）'; return; }
    go.disabled = true;
    line.textContent = 'パスキーを作っている…';
    try {
      const url = await hereUrl();
      const out = await registerPasskey(url, null, { recovery: k, deviceName: dev.value });
      await finishLogin(url, out);
      try { sessionStorage.setItem(AFTER_KEY, '復元の鍵で「' + ((out.user && out.user.name) || out.name) + '」に戻った'); } catch (e) { /* 出せなくても戻ってある */ }
      location.reload();
    } catch (e) {
      line.textContent = (e && e.message) || '戻れなかった';
      go.disabled = false;
    }
  });
  card.appendChild(f);
  card.appendChild(line);
  setTimeout(() => key.focus({ preventScroll: true }), 0);
}

/* このページのサーバーにパスキーでログインする（設定の「海」の［パスキーでログイン］と同じ） */
async function loginHere() {
  const url = await hereUrl();
  const out = await loginPasskey(url);
  await finishLogin(url, out);      /* 個人の海を 1 つにする（2026-11-18。js/loginflow.js） */
  try { if (!sessionStorage.getItem(AFTER_KEY)) sessionStorage.setItem(AFTER_KEY, '「' + ((out.user && out.user.name) || out.name) + '」でログインした'); } catch (e) { /* 出せなくてもログインしてある */ }
  location.reload();
}

/* ログアウト（個人の写しを残すか聞く。2026-11-18。js/loginflow.js）。ask:false は聞かずに残す（今の端末を外したとき） */
async function logout(ask = true) {
  close();
  if (!(await logoutFlow(ask))) return;
  try { sessionStorage.setItem(AFTER_KEY, 'ログアウトした'); } catch (e) { /* 出せなくてもログアウトしてある */ }
  location.reload();
}

let presets = null;
function renderAvatar(card, u) {
  head(card, 'アイコンを選ぶ', 'main');
  card.dataset.page = 'avatar';
  card.appendChild(mk('p', 'uc-note', 'はじめはランダム。3 つの app（bubble・gantt・diary）で同じアイコンが出る。'));
  const grid = mk('div', 'uc-presets');
  grid.dataset.name = 'アイコンのプリセット';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'アイコン');
  card.appendChild(grid);
  const line = mk('p', 'uc-note'); line.setAttribute('aria-live', 'polite');
  card.appendChild(line);
  const draw = () => {
    grid.textContent = '';
    const cur = u.user.avatar && u.user.avatar.preset;
    (presets || []).forEach(p => {
      const b = mk('button', 'uc-preset' + (p.id === cur ? ' is-on' : ''), p.emoji);
      b.type = 'button';
      b.style.background = p.color;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', p.id === cur ? 'true' : 'false');
      b.setAttribute('aria-label', p.id);
      b.dataset.preset = p.id;
      b.addEventListener('click', async () => {
        try {
          const j = await setAvatar(p.id);
          u = j;
          paint();
          draw();
          line.textContent = 'アイコンを変えた（gantt・diary にも出る）';
        } catch (e) { line.textContent = (e && e.message) || '変えられなかった'; }
      });
      grid.appendChild(b);
    });
  };
  if (presets) draw();
  else listAvatars().then(p => { presets = p; draw(); }).catch(e => { line.textContent = (e && e.message) || '読めなかった'; });
}

function renderDevices(card) {
  head(card, 'わたしの端末', 'main');
  card.dataset.page = 'devices';
  const list = mk('div', 'uc-devices');
  list.dataset.name = '端末の一覧';
  card.appendChild(list);
  const line = mk('p', 'uc-note'); line.setAttribute('aria-live', 'polite');
  const draw = (devs) => {
    list.textContent = '';
    devs.forEach(d => {
      const r = mk('div', 'uc-device');
      const last = d.last_used ? new Date(d.last_used * 1000) : null;
      const tx = mk('span', 'uc-tx');
      tx.appendChild(mk('b', null, (d.current ? '📱 ' : '') + d.name));
      tx.appendChild(mk('small', null, d.current ? 'この端末' : (last ? (last.getMonth() + 1) + '/' + last.getDate() + ' に使った' : 'まだ使っていない')));
      r.appendChild(tx);
      const rm = mk('button', 'btn', '外す');
      rm.type = 'button';
      rm.setAttribute('aria-label', d.name + ' を外す');
      let armed = false;
      rm.addEventListener('click', async () => {
        if (!armed) { armed = true; rm.textContent = d.current ? 'この端末を外す（ログアウト）' : 'もう一度押すと外す'; return; }
        rm.disabled = true;
        try {
          const rest = await removeDevice(d.name, !!d.current);
          if (d.current) { await logout(false); return; }
          line.textContent = '「' + d.name + '」を外した（その端末の通行証も止まった）';
          draw(rest);
        } catch (e) { line.textContent = (e && e.message) || '外せなかった'; rm.disabled = false; }
      });
      r.appendChild(rm);
      list.appendChild(r);
    });
  };
  myDevices().then(draw).catch(e => { line.textContent = (e && e.message) || '読めなかった'; });
  const add = mk('button', 'btn main', '＋ 端末を足す');
  add.type = 'button';
  add.dataset.name = '端末を足すボタン';
  const code = mk('div', 'uc-code');
  add.addEventListener('click', async () => {
    add.disabled = true;
    try {
      const L = serverLogin();
      const got = await makeDeviceCode(L.url, L.session);
      code.textContent = '';
      const n = mk('b', 'uc-num', got.code);
      n.dataset.name = 'つなぐ番号';
      code.appendChild(n);
      const t = new Date(got.expires * 1000);
      code.appendChild(mk('small', null, '新しい端末の［番号で足す］に入れる。' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ' まで・1 回だけ'));
    } catch (e) { line.textContent = (e && e.message) || '番号を出せなかった'; }
    finally { add.disabled = false; }
  });
  card.appendChild(add);
  card.appendChild(code);
  card.appendChild(line);
  card.appendChild(mk('p', 'uc-note', '外すと、その端末の通行証も止まる。3 つの app で同じ端末の一覧。'));
  card.appendChild(recoveryBox());
}

/* 復元の鍵（2026-11-19 ユーザーの指示「復元の鍵は削除するまで有効にして」）。
   作った日・最後に使った日。［復元の鍵を作る］（あれば［作り直す］）・［復元の鍵を消す］。鍵を出すのは作ったときだけ */
const ymd = (sec) => { if (!sec) return 'まだ'; const d = new Date(sec * 1000); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
function recoveryBox() {
  const w = mk('div', 'uc-recovery');
  w.dataset.name = '復元の鍵';
  const draw = (shown) => {
    w.textContent = '';
    const u = me();
    const rec = u && u.user && u.user.recovery;
    w.appendChild(mk('p', 'uc-sec', '復元の鍵'));
    w.appendChild(mk('p', 'uc-note', rec
      ? '作った日 ' + ymd(rec.created) + '・最後に使った日 ' + ymd(rec.lastUsed) + '。消すまで使える（使っても消えない）。'
      : 'パスキーを全部なくしても、この鍵があれば自分で同じ利用者に戻れる。まだ作っていない。'));
    if (shown) {
      const box = mk('div', 'uc-code uc-rkey');
      const k = mk('b', 'uc-num uc-keytx', shown);
      k.dataset.name = '復元の鍵（作ったときだけ出る）';
      box.appendChild(k);
      box.appendChild(mk('small', null, '鍵を見せるのは今だけ。紙に書くか、パスワードの管理に入れる。人に見せない（この鍵があれば、だれでもあなたとして端末を足せる）。'));
      const cp = mk('button', 'btn', '写す');
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(shown); cp.textContent = '写した'; } catch (e) { cp.textContent = '写せなかった（手で書き写す）'; }
      });
      box.appendChild(cp);
      w.appendChild(box);
    }
    const r = mk('div', 'uc-row2');
    const make = mk('button', 'btn' + (rec ? '' : ' main'), rec ? '作り直す' : '復元の鍵を作る');
    make.type = 'button';
    make.dataset.name = rec ? '復元の鍵を作り直す' : '復元の鍵を作る';
    const line = mk('p', 'uc-note'); line.setAttribute('aria-live', 'polite');
    make.addEventListener('click', async () => {
      if (rec && !window.confirm('作り直すと、前の復元の鍵は使えなくなる。作り直す？')) return;
      make.disabled = true;
      try {
        const L = serverLogin();
        const got = await makeRecoveryKey(L.url, L.session);
        await fetchMe();
        draw(got.key);
      } catch (e) { line.textContent = (e && e.message) || '作れなかった'; make.disabled = false; }
    });
    r.appendChild(make);
    if (rec) {
      const rm = mk('button', 'btn', '復元の鍵を消す');
      rm.type = 'button';
      rm.dataset.name = '復元の鍵を消す';
      let armed = false;
      rm.addEventListener('click', async () => {
        if (!armed) { armed = true; rm.textContent = 'もう一度押すと消す'; return; }
        rm.disabled = true;
        try {
          const L = serverLogin();
          await removeRecoveryKey(L.url, L.session);
          await fetchMe();
          draw(null);
          w.querySelector('.uc-note').textContent = '消した。その鍵ではもう戻れない。';
        } catch (e) { line.textContent = (e && e.message) || '消せなかった'; rm.disabled = false; }
      });
      r.appendChild(rm);
    }
    w.appendChild(r);
    w.appendChild(line);
  };
  draw(null);
  return w;
}

/* 復元の鍵で端末が足されたことを、ほかの端末に知らせる（次に開いたとき 1 回。2026-11-19） */
const RECOVERY_SEEN = 'bubble_todo_recovery_seen_v1';
function recoveryNotice() {
  const u = me();
  const n = u && u.user && u.user.recoveryNotice;
  if (!n || !n.at) return;
  let seen = 0;
  try { seen = Number(localStorage.getItem(RECOVERY_SEEN)) || 0; } catch (e) { seen = 0; }
  if (n.at <= seen) return;
  try { localStorage.setItem(RECOVERY_SEEN, String(n.at)); } catch (e) { /* 次も出るだけ */ }
  const d = new Date(n.at * 1000);
  toast('復元の鍵で新しい端末が足されました（' + (n.device || '端末') + '・' + (d.getMonth() + 1) + '/' + d.getDate() + ' '
    + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    + '）。心当たりが無ければ「わたしの端末」で外し、復元の鍵を消す', null, 12000);
}

/* 左上の丸を描き直す */
export function paint() {
  if (!btn) return;
  const u = me();
  paintAvatar(btn, u && u.user);
  const name = u ? u.user.name + ' でログイン中' : 'ログインしていない';
  btn.setAttribute('aria-label', '利用者の札（' + name + '）');
  btn.title = name;
}

/* 置く（app.js が、サーバーあり版のときだけ呼ぶ）。#avatar・#devices で開いたら、その画面を出す（§7.2） */
export function mountUserChip(parent) {
  btn = mk('button', 'userbtn');
  btn.type = 'button';
  btn.dataset.name = '利用者のアイコン';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => (back ? close() : open('main')));
  parent.appendChild(btn);
  document.documentElement.classList.add('has-userbtn');
  paint();
  window.addEventListener(ME_EVENT, paint);
  window.addEventListener(ME_EVENT, recoveryNotice);
  setTimeout(recoveryNotice, 0);
  const onHash = () => {
    const h = location.hash;
    if (h !== '#avatar' && h !== '#devices') return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 残っても害は無い */ }
    const go = () => open(h === '#avatar' ? 'avatar' : 'devices');
    if (me()) setTimeout(go, 0);
    else fetchMe().then(() => setTimeout(go, 0));
  };
  onHash();
  /* 開いているページで住所の # だけが替わったとき（gantt・diary から同じタブで戻ったときなど） */
  window.addEventListener('hashchange', onHash);
  return btn;
}
