/* 設定の「海」（2026-11-16 作り直し。利用者の指示。仕様とモックは docs/spec/）。

   > サーバーにつなぐが最初から出るのやめて
   > 海が自由につくれ、その上でサーバーに繋ぐ選択肢にして
   > サーバーを一つにする代わりに、パスキーログイン方式にして（ログイン後にアクセスできる海が表示される）

   並び（docs/spec/mock/index.html の 1・4・5）:
     ログイン中の札（ログインしているときだけ）
     サーバーの海（サーバーの繋ぎ先があるときだけ）→ この端末の海 → ［＋ 海をつくる］
     いちばん下に1行「ほかの端末・ほかの人と合わせる →［サーバーにログイン］」（ログインしていないときだけ）
   海の行を押すとその海へ移る。⚙ で名前・色・置き場（この端末／サーバー）・消す。
   作った海はいつも「この端末」から始まる。サーバーに置けるのは、ログインした持ち主だけ（サーバーが持ち主の書き込みだけを受けるため）。
   前の「海を設定する」（settings.js の seasBox。住所の欄・案内の枠・海域ごとの歯車）の代わり。 */

import { el, toast } from '../ui.js';
import { SPACE_KEY } from '../store.js';
import { sync } from '../sync.js';
import { registerPasskey, loginPasskey, logoutPasskey, authMode, passkeySupported,
  requestRegistration, requestStatus, makeInvite, makeDeviceCode, acceptInvite, peekInvite } from '../passkey.js';
import { fetchMe, saveMe, meInfo, ME_EVENT } from '../me.js';
import { finishLogin, logoutFlow, AFTER_KEY } from '../loginflow.js';
import { seaOp, myDevices, removeDevice } from '../seaadmin.js';
import { COLORS, colorMark, addSea, updateSea, removeSea, setSeaRegion, boxKey } from '../spacelist.js';
import { allSeas, regionConf } from '../regions.js';
import { theServer, serverUrl, ensureServer, canUnify, unifyPersonal, applyServerSeas } from '../oneserver.js';

const SKY = '#7cc3e8';                        /* 個人の水の色（css の空色に近い印） */
const REQ_KEY = 'bubble_todo_pk_request';     /* 登録の頼み（前の欄と同じ箱。続きから使える） */
/* 招待のリンク（https://<サーバー>/#invite=<コード>。2026-11-18）で開いたときのコード。app.js が置き、ここで使ったら消す */
export const LINK_KEY = 'bubble_todo_invite_link';
const ROLE_LABEL = { owner: '持ち主', editor: '書ける', viewer: '見るだけ' };
function readLink() { try { return sessionStorage.getItem(LINK_KEY) || ''; } catch (e) { return ''; } }
function dropLink() {
  try { sessionStorage.removeItem(LINK_KEY); } catch (e) { /* 残っても次で上書き */ }
  try { if (/^#invite=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 出ていても害は無い */ }
}

function text(tag, cls, t) { const n = el(tag, cls); n.textContent = t; return n; }
function btn(label, cls = 'btn') { const b = el('button', cls); b.type = 'button'; b.textContent = label; return b; }

/* ログインの状態（サーバーの繋ぎ先の箱から読む。開いている海の繋ぎ先でも、sync.js が同じ箱に書いている） */
export function loginState() {
  const r = theServer();
  const c = r ? regionConf(r.id) : null;
  const live = !!(c && c.session && Number(c.sessionExpires) * 1000 > Date.now());
  const spaces = live && Array.isArray(c.sessionSpaces) ? c.sessionSpaces : [];
  return { region: r, url: (c && c.url) || '', live, name: live ? String(c.sessionName || '') : '', spaces, session: live ? c.session : '',
    userName: live ? String(c.sessionUserName || '') : '' };
}

/* ログインしたあと、入れる海の一覧をサーバーから受け取る。端末からは一覧を書き換えない（海の管理は VM。2026-11-16） */
async function pullSeas(st) {
  if (!st.live || !st.region) return false;
  const mine = [];
  try {
    const res = await fetch(st.url + '/api/spaces', {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + st.session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaces: mine }),
    });
    const j = await res.json();
    if (res.status !== 200 || !j || !Array.isArray(j.spaces)) return false;
    applyServerSeas(st.region.id, j);
    return true;
  } catch (e) { return false; }
}

function goTo(id) {
  try { localStorage.setItem(SPACE_KEY, id); } catch (e) { toast('切り替えを覚えられなかった'); return; }
  location.reload();
}

/* opts.solo … サーバーなし版の欄（noserver.html。ログインの代わりに出す） */
export function seaPanel(opts = {}) {
  const d = document.createElement('details');
  d.className = 'set-more sea-panel';
  d.open = true;
  const sum = document.createElement('summary');
  const tx = el('span', 'tx');
  tx.appendChild(text('span', 'nm', '海'));
  sum.appendChild(tx);
  d.appendChild(sum);
  const wrap = el('div', 'tags');
  d.appendChild(wrap);

  const cur = (() => { try { return localStorage.getItem(SPACE_KEY) || 'me'; } catch (e) { return 'me'; } })();
  let openGear = null;       /* ⚙ を開いている海 */
  let loginOpen = false;     /* ログインの欄を開いているか */
  let pageMode;              /* このページの /api/auth の答え（undefined = まだ） */
  let pollTimer = 0;
  let pendingInvite = readLink();   /* 招待のリンクのコードか、「招待コードを受け取る」に貼られたサーバーの招待コード（fillInvite） */
  let linkInfo = null;              /* 招待の中身（peekInvite。だれから・どの海へ） */
  let deviceShown = null;           /* 「端末を足す」で出した番号 {code, expires} */
  if (pendingInvite) loginOpen = true;

  /* ---- 海の行 ---- */
  function seaRow(s, st) {
    const row = el('div', 'sp-sea');
    row.dataset.name = '海の行';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;margin:6px 0';
    const dot = el('span');
    dot.style.cssText = 'width:14px;height:14px;border-radius:50%;flex:none;background:' + (s.personal ? SKY : colorMark(s.color));
    const go = el('button', 'sp-go');
    go.type = 'button';
    go.style.cssText = 'flex:1;min-width:0;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;display:flex;flex-direction:column;gap:2px';
    const nm = text('span', null, s.name);
    nm.style.cssText = 'overflow-wrap:anywhere' + (s.id === cur ? ';font-weight:700' : '');
    go.appendChild(nm);
    /* 置き場の印は名前の下に小さく（名前を狭めない） */
    const where = text('span', 'sp-where', (s.id === cur ? '今の海・' : '') + whereOf(s, st));
    where.dataset.name = '置き場の印';
    where.style.cssText = 'font-size:12px;color:var(--muted, #6b7a86)';
    go.appendChild(where);
    go.addEventListener('click', () => { if (s.id !== cur) goTo(s.id); });
    const gear = btn('⚙', 'btn sp-gear');
    gear.setAttribute('aria-label', s.name + ' の設定');
    gear.addEventListener('click', () => { openGear = openGear === s.id ? null : s.id; paint(); });
    row.appendChild(dot); row.appendChild(go);
    if (s.personal && !onServer(s, st) && canUnify()) row.appendChild(unifyButton());
    row.appendChild(gear);
    const box = el('div');
    box.appendChild(row);
    if (openGear === s.id) box.appendChild(gearBox(s, st));
    return box;
  }
  function onServer(s, st) { return !!(st.region && s.rid === st.region.id); }
  function whereOf(s, st) {
    if (!onServer(s, st)) return 'この端末';
    if (!st.live) return 'サーバー・ログインしていない';
    if (s.id === cur) { const at = sync.seenAt(); return at ? 'サーバー・合わせた ' + hhmm(at) : 'サーバー'; }
    return 'サーバー';
  }

  /* ---- 海の ⚙ ----
     この端末の海 … 名前・色を変える、消す。サーバーに置くのは管理者が VM で（ID を出す）
     サーバーの海 … 名前・色・消すはアプリからできない（海の管理は VM。2026-11-16 利用者の指示）。人を招く・この端末へ戻す */
  function gearBox(s, st) {
    const g = el('div', 'sp-gearbox');
    g.style.cssText = 'margin:0 0 10px 24px;padding:8px 10px;border-left:2px solid var(--line)';
    const server = onServer(s, st);
    const me = meInfo();
    const sea = server && me ? me.seas.find(x => x && x.id === s.id) : null;
    const role = s.personal ? 'owner' : (sea ? sea.role : null);
    const owner = role === 'owner';
    const note = (t2) => { const p = text('p', 'note', t2); g.appendChild(p); return p; };
    const line = el('p', 'note'); line.setAttribute('aria-live', 'polite');
    const fail = (e) => { line.textContent = (e && e.message) || 'できなかった'; };
    const refresh = async () => { await pullSeas(loginState()); await fetchMe(); try { sync.relock(); } catch (e) { /* 次に合わせたとき */ } paint(); };
    /* 名前・色（この端末の海はいつも。サーバーの海は持ち主だけ。2026-11-18「海の管理は作成者が行う」） */
    if (!s.personal && (!server || owner)) {
      const f = el('form', 'tagadd');
      f.dataset.name = '海の名前と色';
      const nm = document.createElement('input');
      nm.type = 'text'; nm.maxLength = 16; nm.value = s.name; nm.setAttribute('aria-label', '海の名前');
      const col = colorSelect(s.color);
      const save = el('button', 'btn'); save.type = 'submit'; save.textContent = '名前・色を変える';
      f.appendChild(nm); f.appendChild(col); f.appendChild(save);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!nm.value.trim()) { toast('名前を入れる'); return; }
        if (server) {
          save.disabled = true;
          try { await seaOp('update', { sea: s.id, name: nm.value, color: col.value }); updateSea(s.id, { name: nm.value, color: col.value }); toast('変えた（仲間の画面にも届く）'); await refresh(); }
          catch (e) { fail(e); } finally { save.disabled = false; }
          return;
        }
        if (!updateSea(s.id, { name: nm.value, color: col.value })) { toast('名前を入れる'); return; }
        toast('変えた'); paint();
      });
      g.appendChild(f);
    }
    if (s.personal) {
      note(server ? 'サーバーの個人の海。あなたの端末どうしだけで合わせる（ほかの人には見えない）。' : 'この端末の個人。');
    } else if (!server) {
      if (st.live) {
        /* この端末の海をサーバーの共有の海にする（作った人が持ち主。2026-11-18） */
        note('この端末だけの海。サーバーの共有の海にすると、あなたが持ち主になり、仲間をリンクで招ける（中身は開いたときに送る）。');
        const up = btn('👥 サーバーの共有の海にする');
        up.dataset.name = '共有の海にするボタン';
        up.addEventListener('click', async () => {
          up.disabled = true;
          try {
            await seaOp('create', { id: s.id, name: s.name, color: s.color });
            setSeaRegion(s.id, st.region.id);
            toast('「' + s.name + '」をサーバーの共有の海にした（あなたが持ち主）');
            if (s.id === cur) location.reload(); else await refresh();
          } catch (e) { fail(e); up.disabled = false; }
        });
        const r = el('div', 'row'); r.appendChild(up); g.appendChild(r);
      } else {
        note('この端末だけの海。ログインすると、サーバーの共有の海にできる。');
      }
    } else {
      note(owner ? 'サーバーの共有の海。あなたが持ち主（名前・色・仲間・消すを決める）。'
        : 'サーバーの共有の海。名前・色・仲間は持ち主が決める（あなたは「' + (ROLE_LABEL[role] || role || '?') + '」）。');
    }
    if (server && st.live && !s.personal) g.appendChild(membersBox(s, refresh, fail));
    if (server && st.live) g.appendChild(s.personal ? deviceBox(st) : inviteBox(s, st));
    if (server && st.live && !s.personal) g.appendChild(leaveBox(s, owner, sea, refresh, fail));
    if (server && !s.personal) {
      const back = btn('この端末へ戻す（合わせるのをやめる）');
      back.addEventListener('click', () => {
        if (!setSeaRegion(s.id, 'local')) { toast('変えられなかった'); return; }
        toast('この端末の海にした（この端末の中身は残る。サーバーの中身も消さない）');
        if (s.id === cur) location.reload(); else paint();
      });
      const r = el('div', 'row'); r.style.marginTop = '8px'; r.appendChild(back); g.appendChild(r);
    }
    /* 消す（この端末の海・持ち主のサーバーの海。2 度押す） */
    if (!s.personal && (!server || (owner && st.live))) {
      const del = btn(server ? 'この海を消す（仲間もみな外れる）' : 'この海を消す');
      del.dataset.name = '海を消すボタン';
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.textContent = 'もう一度押すと消す'; return; }
        if (server) {
          del.disabled = true;
          try { await seaOp('remove', { sea: s.id }); setSeaRegion(s.id, 'local'); }
          catch (e) { fail(e); del.disabled = false; return; }
        }
        if (!removeSea(s.id)) { toast('消せなかった'); return; }
        toast('「' + s.name + '」を消した');
        if (s.id === cur) goTo('me'); else { openGear = null; paint(); }
      });
      const r = el('div', 'row'); r.style.marginTop = '8px'; r.appendChild(del); g.appendChild(r);
    }
    g.appendChild(line);
    return g;
  }

  /* この海を出る（2026-11-18。モック 5）。持ち主は、ほかの仲間に持ち主を渡してから出る。仲間がいなければ消すかを聞く */
  function leaveBox(s, owner, sea, refresh, fail) {
    const w = el('div', 'sp-leave');
    w.style.marginTop = '8px';
    const me = meInfo();
    const others = sea && Array.isArray(sea.members) ? sea.members.filter(m => me && m.id !== me.user.id) : [];
    const out = async () => {
      setSeaRegion(s.id, 'local');
      removeSea(s.id);
      toast('「' + s.name + '」を出た（この端末の写しは消した）');
      try { localStorage.removeItem(boxKey(s.id)); } catch (e) { /* 一覧からは外れている */ }
      if (s.id === cur) goTo('me'); else { openGear = null; await refresh(); }
    };
    if (owner && !others.length) {
      w.appendChild(text('p', 'note', 'ほかに仲間がいないので、出るならこの海を消す（下の［この海を消す］）。'));
      return w;
    }
    let pick = null;
    if (owner) {
      w.appendChild(text('p', 'note', '持ち主が出るときは、先にほかの仲間に持ち主を渡す。'));
      pick = document.createElement('select');
      pick.setAttribute('aria-label', '持ち主を渡す人');
      others.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = (m.name || m.id) + 'に渡す'; pick.appendChild(o); });
      w.appendChild(pick);
    }
    const b = btn(owner ? '持ち主を渡して出る' : 'この海を出る');
    b.dataset.name = '海を出るボタン';
    let armed = false;
    b.addEventListener('click', async () => {
      if (!armed) { armed = true; b.textContent = 'もう一度押すと出る'; return; }
      b.disabled = true;
      try {
        if (owner) await seaOp('transfer', { sea: s.id, user: pick.value });
        await seaOp('leave', { sea: s.id });
        await out();
      } catch (e) { fail(e); b.disabled = false; }
    });
    const r = el('div', 'row'); r.appendChild(b); w.appendChild(r);
    return w;
  }

  /* 個人を1つにまとめる（2026-11-16「端末個人とサーバー個人に分かれるのは？ 統合…」「『個人』の横あたりにサーバーに統合ボタンが欲しい」）。
     サーバーの個人もあるときだけ、この端末の個人の行に［サーバーに統合］を出す（2度押す）。中身は js/oneserver.js の unifyPersonal */
  function unifyButton() {
    const b = btn('サーバーに統合', 'btn sp-unify');
    b.dataset.name = 'サーバーに統合ボタン';
    b.title = '両方の泡を残して1つの「個人」にし、サーバーと合わせる';
    let armed = false;
    b.addEventListener('click', () => {
      if (!armed) { armed = true; b.textContent = 'もう一度押す'; toast('もう一度押すと、両方の泡を残して1つの個人にまとめ、サーバーと合わせる'); return; }
      if (!unifyPersonal()) { toast('まとめられなかった'); return; }
      toast('個人を1つにまとめた');
      location.reload();
    });
    return b;
  }

  /* 海の仲間（2026-11-18。モック 5）。/api/me の控えから出す（入れるかどうかはサーバーが決める）。
     持ち主は、ほかの仲間の役割（書ける・見るだけ）を変え、外せる */
  function membersBox(s, refresh, fail) {
    const w = el('div', 'sp-members');
    w.dataset.name = '仲間の一覧';
    const me = meInfo();
    const sea = me && me.seas.find(x => x && x.id === s.id);
    if (!sea || !Array.isArray(sea.members)) return w;
    const owner = sea.role === 'owner';
    w.appendChild(text('p', 'prefs-pages-lb', '仲間'));
    sea.members.forEach(m => {
      const row = el('div', 'sp-member');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 0';
      const mine = me.user.id === m.id;
      row.appendChild(text('span', null, (m.name || m.id) + (mine ? '（あなた）' : '')));
      if (owner && !mine && m.role !== 'owner') {
        const box = el('span');
        box.style.cssText = 'display:flex;gap:6px;align-items:center';
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', (m.name || m.id) + ' の役割');
        [['editor', '書ける'], ['viewer', '見るだけ']].forEach(([v, lb]) => { const o = document.createElement('option'); o.value = v; o.textContent = lb; if (v === m.role) o.selected = true; sel.appendChild(o); });
        sel.addEventListener('change', async () => {
          sel.disabled = true;
          try { await seaOp('role', { sea: s.id, user: m.id, role: sel.value }); toast('役割を変えた'); await refresh(); }
          catch (e) { fail(e); sel.disabled = false; }
        });
        const kick = btn('外す');
        kick.setAttribute('aria-label', (m.name || m.id) + ' を外す');
        let armed = false;
        kick.addEventListener('click', async () => {
          if (!armed) { armed = true; kick.textContent = 'もう一度'; return; }
          kick.disabled = true;
          try { await seaOp('kick', { sea: s.id, user: m.id }); toast('外した（次の要求から入れない）'); await refresh(); }
          catch (e) { fail(e); kick.disabled = false; }
        });
        box.appendChild(sel); box.appendChild(kick);
        row.appendChild(box);
      } else {
        row.appendChild(text('span', 'note', ROLE_LABEL[m.role] || m.role));
      }
      w.appendChild(row);
    });
    return w;
  }

  /* わたしの端末（2026-11-18。モック 3）。端末の呼び名・最後に使った日・この端末。外すとその端末の通行証も止まる。
     今の端末を外すときは確かめ、外したらこの端末はログアウトする */
  let devList = null;
  function devicesBox(st) {
    const w = el('div', 'sp-devices');
    w.dataset.name = '端末の一覧';
    w.style.cssText = 'margin:6px 0 10px;padding:6px 10px;border:1px solid var(--line);border-radius:10px';
    w.appendChild(text('p', 'prefs-pages-lb', 'わたしの端末'));
    const line = el('p', 'note'); line.setAttribute('aria-live', 'polite');
    if (!devList) {
      w.appendChild(text('p', 'note', '読んでいる…'));
      myDevices().then(d => { devList = d; if (wrap.isConnected) paint(); }).catch(e => { line.textContent = (e && e.message) || '読めなかった'; });
    } else {
      devList.forEach(d => {
        const row = el('div', 'sp-device');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 0';
        const last = d.last_used ? new Date(d.last_used * 1000) : null;
        row.appendChild(text('span', null, (d.current ? '📱 ' : '') + d.name + (d.current ? '（この端末）' : '')
          + '・' + (last ? (last.getMonth() + 1) + '/' + last.getDate() + ' に使った' : 'まだ使っていない')));
        const rm = btn('外す');
        rm.setAttribute('aria-label', d.name + ' を外す');
        let armed = false;
        rm.addEventListener('click', async () => {
          if (!armed) { armed = true; rm.textContent = d.current ? 'この端末を外す（ログアウトする）' : 'もう一度押すと外す'; return; }
          rm.disabled = true;
          try {
            devList = await removeDevice(d.name, !!d.current);
            if (d.current) {
              if (st.region && st.region.id === sync.region().id) sync.dropPasskeySession();
              else if (st.region) sync.configureRegion(st.region.id, st.url, '', '');
              saveMe(null);
              toast('この端末を外した（ログアウトした）');
            } else toast('「' + d.name + '」を外した（その端末の通行証も止まった）');
            paint();
          } catch (e) { line.textContent = (e && e.message) || '外せなかった'; rm.disabled = false; }
        });
        row.appendChild(rm);
        w.appendChild(row);
      });
    }
    w.appendChild(line);
    return w;
  }

  /* 端末を足す（2026-11-18。モック 3）。ログイン中の端末で番号（10 分・1 回）を出し、新しい端末の［番号で足す］に入れる */
  function deviceBox(st) {
    const w = el('div', 'sp-invite');
    w.dataset.name = '端末を足す';
    w.appendChild(text('p', 'prefs-pages-lb', '自分の端末を足す'));
    w.appendChild(text('p', 'note', '新しい端末でこのページを開き、［サーバーにログイン］→［番号で足す］にこの番号を入れる。'
      + '同じ利用者の端末として足す（10 分・1 回だけ）。iCloud などで同期したパスキーなら要らない。'));
    const out = el('div');
    out.setAttribute('aria-live', 'polite');
    const b = btn('＋ 端末を足す（番号を出す）');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        deviceShown = await makeDeviceCode(st.url, st.session);
        paintCode();
      } catch (e) { out.textContent = (e && e.message) || '番号を出せなかった'; }
      finally { b.disabled = false; }
    });
    const paintCode = () => {
      out.textContent = '';
      if (!deviceShown || deviceShown.expires * 1000 < Date.now()) return;
      const code = text('p', null, deviceShown.code);
      code.dataset.name = 'つなぐ番号';
      code.style.cssText = 'font-size:1.8em;letter-spacing:.12em;font-weight:600;margin:4px 0;font-variant-numeric:tabular-nums';
      out.appendChild(code);
      out.appendChild(text('p', 'note', '「' + (st.userName || st.name) + '」の端末として足す。' + hhmm(deviceShown.expires * 1000) + ' まで・1 回だけ。'));
    };
    const r = el('div', 'row'); r.appendChild(b); w.appendChild(r);
    w.appendChild(out);
    paintCode();
    return w;
  }

  /* 仲間を招く（2026-11-18。モック 5。持ち主だけ）。招待のリンクを作る（24 時間・1 回）。
     開いた人がログインしていれば「この海に入る」、まだ利用者でなければ登録（その人の個人の海もできる） */
  function inviteBox(s, st) {
    const w = el('div', 'sp-invite');
    w.dataset.name = '仲間を招くボタン';
    const me = meInfo();
    const sea = me && me.seas.find(x => x && x.id === s.id);
    if (!sea || sea.role !== 'owner') {
      w.appendChild(text('p', 'note', '仲間を招けるのは、この海の持ち主' + (sea ? '（あなたは「' + (ROLE_LABEL[sea.role] || sea.role) + '」）' : '') + '。'));
      return w;
    }
    w.appendChild(text('p', 'prefs-pages-lb', '仲間を招く（リンク）'));
    const f = el('form', 'tagadd');
    const nm = document.createElement('input');
    nm.type = 'text'; nm.maxLength = 40; nm.setAttribute('aria-label', '招く人の呼び名');
    nm.placeholder = '招く人の呼び名（例 そら）';
    const role = document.createElement('select');
    role.setAttribute('aria-label', '役割');
    [['editor', '書ける'], ['viewer', '見るだけ']].forEach(([v, lb]) => { const o = document.createElement('option'); o.value = v; o.textContent = lb; role.appendChild(o); });
    f.appendChild(nm); f.appendChild(role);
    const b = el('button', 'btn'); b.type = 'submit'; b.textContent = 'リンクを作る';
    f.appendChild(b);
    w.appendChild(f);
    const out = el('div');
    out.setAttribute('aria-live', 'polite');
    w.appendChild(out);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      b.disabled = true;
      out.textContent = '';
      try {
        const got = await makeInvite(st.url, st.session, { name: nm.value.trim() || '招待', sea: s.id, role: role.value });
        const link = got.link || (st.url.replace(/\/$/, '') + '/#invite=' + got.code);
        const p = text('p', null, link);
        p.style.cssText = 'font-family:ui-monospace,monospace;font-size:13px;overflow-wrap:anywhere;user-select:all;margin:4px 0';
        out.appendChild(p);
        out.appendChild(text('p', 'note', '24 時間・1 回だけ。相手に、チャットの外の道で渡す。'
          + '開いた人がまだ利用者でなければ登録の画面になり、その人の個人の海「わたし」もできる。'));
        const cp = btn('リンクを写す');
        cp.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(link); toast('写した'); }
          catch (e) { try { getSelection().selectAllChildren(p); toast(document.execCommand('copy') ? '写した' : '選んだので ⌘C で'); } catch (_) { toast('リンクを長押しして写す'); } }
        });
        out.appendChild(cp);
        nm.value = '';
      } catch (e) {
        out.appendChild(text('p', 'note', (e && e.message) || '作れなかった'));
      } finally { b.disabled = false; }
    });
    return w;
  }

  /* 招待のリンクで開いたとき（2026-11-18）。ログインしていれば「この海に入る」、していなければ下のログインの欄で登録 */
  function linkBox(st) {
    const w = el('div', 'sp-link');
    w.dataset.name = '招待の差出人';
    w.style.cssText = 'border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:6px 0';
    const seas = linkInfo && Array.isArray(linkInfo.seas) ? linkInfo.seas : [];
    const what = seas.map(x => '「' + (x.name || x.id) + '」（' + (ROLE_LABEL[x.role] || x.role) + '）').join('・');
    w.appendChild(text('p', null, (linkInfo && linkInfo.by ? linkInfo.by + ' からの招待' : '招待のリンク')
      + (what ? '：' + what : '')));
    const line = el('p', 'note'); line.setAttribute('aria-live', 'polite');
    if (st.live) {
      if (linkInfo && linkInfo.kind !== 'sea') {
        w.appendChild(text('p', 'note', 'これは新しい端末・新しい利用者を登録するための招待。この端末はもうログインしているので使わない。'));
      } else {
        const go = btn('この海に入る', 'btn main');
        go.dataset.name = '海に入るボタン';
        go.addEventListener('click', async () => {
          go.disabled = true;
          try {
            await acceptInvite(st.url, st.session, pendingInvite);
            dropLink(); pendingInvite = ''; linkInfo = null;
            await pullSeas(loginState());
            await fetchMe();
            toast('海に入った');
            paint();
          } catch (e) { line.textContent = (e && e.message) || '入れなかった'; go.disabled = false; }
        });
        const r = el('div', 'row'); r.appendChild(go); w.appendChild(r);
      }
    } else {
      w.appendChild(text('p', 'note', '下の［招待コードで登録］で、この端末のパスキーを作る。'
        + (linkInfo && linkInfo.kind === 'device' ? '' : '登録すると、あなたの個人の海「わたし」も 1 つできる。')));
    }
    const drop = btn('この招待を使わない');
    drop.addEventListener('click', () => { dropLink(); pendingInvite = ''; linkInfo = null; paint(); });
    const r2 = el('div', 'row'); r2.style.marginTop = '6px'; r2.appendChild(drop); w.appendChild(r2);
    w.appendChild(line);
    return w;
  }

  function colorSelect(val) {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', '水の色');
    COLORS.forEach(([id, name]) => { const o = document.createElement('option'); o.value = id; o.textContent = name; if (id === val) o.selected = true; sel.appendChild(o); });
    return sel;
  }

  /* ---- ＋ 海をつくる（サーバーは聞かない。この端末の海になる）---- */
  function makeBox() {
    const f = el('form', 'tagadd');
    f.dataset.name = '海をつくる';
    const nm = document.createElement('input');
    nm.type = 'text'; nm.maxLength = 16; nm.placeholder = '新しい海の名前'; nm.setAttribute('aria-label', '新しい海の名前');
    const col = colorSelect('moss');
    const b = el('button', 'btn'); b.type = 'submit'; b.textContent = '＋ 海をつくる';
    f.appendChild(nm); f.appendChild(col); f.appendChild(b);
    /* ログインしていれば、サーバーの共有の海としても作れる（作った人が持ち主。2026-11-18） */
    const st = loginState();
    let shared = null;
    if (st.live) {
      const lb = el('label', 'sp-shared');
      shared = document.createElement('input');
      shared.type = 'checkbox';
      shared.setAttribute('aria-label', '共有の海にする');
      lb.appendChild(shared);
      lb.appendChild(document.createTextNode(' 👥 共有の海にする'));
      f.appendChild(lb);
    }
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const e = addSea(nm.value, col.value, Date.now(), 'local');
      if (!e) { toast('名前を入れる'); return; }
      if (shared && shared.checked) {
        b.disabled = true;
        try {
          await seaOp('create', { id: e.id, name: e.name, color: e.color });
          setSeaRegion(e.id, st.region.id);
          await pullSeas(loginState()); await fetchMe();
          toast('「' + e.name + '」を共有の海としてつくった（あなたが持ち主）');
        } catch (err) { toast('サーバーに置けなかった（この端末の海としてつくった）: ' + ((err && err.message) || '')); }
        finally { b.disabled = false; }
        paint();
        return;
      }
      toast('「' + e.name + '」をつくった（この端末の海）');
      paint();
    });
    return f;
  }

  /* ---- ログイン（パスキー）---- */
  function loginBox(st) {
    const w = el('div', 'sp-login');
    w.style.cssText = 'margin-top:8px';
    const url = serverUrl(location.origin, pageMode);
    if (!url) {
      if (pageMode === undefined) { w.appendChild(text('p', 'note', 'サーバーを確かめている…')); return w; }
      w.appendChild(otherPageBox());
      return w;
    }
    if (!passkeySupported()) { w.appendChild(text('p', 'note', 'このブラウザはパスキーを使えない。')); return w; }
    const line = el('p', 'note'); line.setAttribute('aria-live', 'polite');
    const busy = async (b, fn) => { b.disabled = true; try { await fn(); } catch (e) { line.textContent = (e && e.message) || '失敗した'; } finally { b.disabled = false; } };
    const done = async (out) => {
      /* 個人の海を 1 つにする（2026-11-18。js/loginflow.js。合わせた・入れ替えたら読み直す） */
      const fin = await finishLogin(url, out);
      const r = { id: fin.rid };
      saveReq(null);
      loginOpen = false;
      await pullSeas(loginState());
      await fetchMe();
      if (out.joinedLink) { dropLink(); pendingInvite = ''; linkInfo = null; }
      toast('「' + ((out.user && out.user.name) || out.name) + '」でログインした');
      /* 個人を合わせた・開いている海がサーバーの海なら、読み直して合わせ始める */
      if (fin.reload || findRegionOfCur(r.id)) {
        try { if (!sessionStorage.getItem(AFTER_KEY)) sessionStorage.setItem(AFTER_KEY, '「' + ((out.user && out.user.name) || out.name) + '」でログインした'); } catch (e) { /* 出せなくてもよい */ }
        location.reload();
      } else paint();
    };
    const inBtn = btn('パスキーでログイン', 'btn main');
    inBtn.dataset.name = 'パスキーでログインボタン';
    inBtn.addEventListener('click', () => busy(inBtn, async () => done(await loginPasskey(url))));
    const r1 = el('div', 'row'); r1.appendChild(inBtn); w.appendChild(r1);

    /* 初めての端末: 登録を頼む（持ち主がサーバーで request-ok）か、招待コード */
    w.appendChild(text('p', 'prefs-pages-lb', '初めての端末'));
    const req = readReq();
    if (req) {
      w.appendChild(text('p', null, req.approved
        ? '「' + req.name + '」の登録が認められた。［登録を仕上げる］でこの端末のパスキーを作る。'
        : '「' + req.name + '」として頼んだ。次の字をサーバーの持ち主に伝える（24 時間）。'));
      const code = text('p', null, req.code);
      code.style.cssText = 'font-size:1.6em;letter-spacing:.12em;font-weight:600;margin:4px 0';
      w.appendChild(code);
      const rr = el('div', 'row'); rr.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      if (req.approved) {
        const fin = btn('登録を仕上げる', 'btn main');
        fin.addEventListener('click', () => busy(fin, async () => done(await registerPasskey(req.base, req.key))));
        rr.appendChild(fin);
      } else {
        const look = btn('様子を見る');
        look.addEventListener('click', () => busy(look, () => checkReq(false)));
        rr.appendChild(look);
        schedulePoll();
      }
      const drop = btn('頼みをやめる');
      drop.addEventListener('click', () => { saveReq(null); paint(); });
      rr.appendChild(drop);
      w.appendChild(rr);
    } else {
      const f = el('form', 'tagadd');
      const nm = document.createElement('input');
      nm.type = 'text'; nm.maxLength = 40; nm.placeholder = 'この端末の呼び名（例 自分のスマホ）'; nm.setAttribute('aria-label', 'この端末の呼び名');
      const ask = el('button', 'btn'); ask.type = 'submit'; ask.textContent = '登録を頼む';
      f.appendChild(nm); f.appendChild(ask);
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = nm.value.trim();
        if (!name) { line.textContent = 'この端末の呼び名を入れる'; return; }
        busy(ask, async () => {
          const got = await requestRegistration(url, name);
          saveReq({ base: url, key: got.key, code: got.code, name, expires: got.expires, approved: false });
          paint();
        });
      });
      w.appendChild(f);
      /* 招待コード（リンクで開いたときは入っている）。表示名はまだ利用者でない人のとき（新しい利用者の名前）。2026-11-18 */
      const inv = el('form', 'tagadd');
      inv.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      const code = document.createElement('input');
      code.type = 'text'; code.autocomplete = 'off'; code.placeholder = '招待コード（ABCD-EFGH-JKLM）'; code.setAttribute('aria-label', '招待コード');
      code.value = pendingInvite;
      const uname = document.createElement('input');
      uname.type = 'text'; uname.maxLength = 40; uname.autocomplete = 'nickname'; uname.placeholder = '表示名（例 りょう。はじめての人だけ）';
      uname.setAttribute('aria-label', '表示名');
      uname.dataset.name = '表示名の欄';
      const dname = document.createElement('input');
      dname.type = 'text'; dname.maxLength = 40; dname.placeholder = 'この端末の呼び名（例 iPhone）'; dname.setAttribute('aria-label', 'この端末の呼び名');
      dname.dataset.name = '端末の呼び名の欄';
      const reg = el('button', 'btn'); reg.type = 'submit'; reg.textContent = '招待コードで登録';
      reg.dataset.name = 'パスキーを作るボタン';
      inv.appendChild(code); inv.appendChild(uname); inv.appendChild(dname); inv.appendChild(reg);
      inv.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!code.value.trim()) { line.textContent = '招待コードを入れる'; return; }
        const fromLink = code.value.trim() === pendingInvite;
        busy(reg, async () => {
          const out = await registerPasskey(url, code.value, { userName: uname.value, deviceName: dname.value });
          if (fromLink) out.joinedLink = true;
          return done(out);
        });
      });
      w.appendChild(inv);
      /* 2 台目からは「番号で足す」（ログイン中の端末の［＋ 端末を足す］で出した 6 桁。10 分・1 回） */
      w.appendChild(text('p', 'prefs-pages-lb', '自分の 2 台目の端末'));
      const dev = el('form', 'tagadd');
      dev.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      const num = document.createElement('input');
      num.type = 'text'; num.inputMode = 'numeric'; num.autocomplete = 'one-time-code'; num.placeholder = '番号（6 桁）'; num.setAttribute('aria-label', 'つなぐ番号');
      const dn2 = document.createElement('input');
      dn2.type = 'text'; dn2.maxLength = 40; dn2.placeholder = 'この端末の呼び名（例 Mac）'; dn2.setAttribute('aria-label', 'この端末の呼び名（番号）');
      const add = el('button', 'btn'); add.type = 'submit'; add.textContent = '番号で足す';
      dev.appendChild(num); dev.appendChild(dn2); dev.appendChild(add);
      dev.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const n = num.value.replace(/\D/g, '');
        if (n.length !== 6) { line.textContent = '6 桁の番号を入れる（ログイン中の端末の［＋ 端末を足す］で出る）'; return; }
        busy(add, async () => done(await registerPasskey(url, '', { device: n, deviceName: dn2.value })));
      });
      w.appendChild(dev);
    }
    w.appendChild(line);
    return w;
  }
  /* サーバーが配っていないページ（GitHub Pages・Android の app・Chrome で GitHub Pages からインストールした app）で開いているとき。
     パスキーはページの住所に結び付くので、ここでは登録もログインもできない。サーバーのページへ移る道を出す（2026-11-16
     「chromeのapp版から登録できない」。作り直しで住所の欄を外し、行き止まりになっていた） */
  function otherPageBox() {
    const w = el('div');
    const inApp = !!window.Capacitor;
    w.appendChild(text('p', null, inApp
      ? 'この app の中ではパスキーを使えないので、サーバーにはログインできない。Chrome でサーバーのページを開き、そこで［サーバーにログイン］を押す（Chrome の「ホーム画面に追加」で置き直すと、次からそこから開ける）。'
      : 'このページはサーバーが配っているページではないので、ここではログインできない（パスキーはページの住所に結び付くため）。'
        + 'サーバーの住所を入れて［サーバーのページを開く］を押し、開いたページで［サーバーにログイン］を押す。'
        + 'アプリとして使うなら、開いたページで Chrome の「アプリをインストール」（スマホは「ホーム画面に追加」）をし直す。'));
    w.appendChild(text('p', 'note', 'この端末のこのページの記録は、サーバーのページには移らない（住所ごとに別の置き場）。'
      + '移すときは、ここで「記録を保存する・読み込む」→ ファイルに書き出し、サーバーのページで読み込む。'));
    const f = el('form', 'tagadd');
    const u = document.createElement('input');
    u.type = 'url'; u.autocomplete = 'url'; u.placeholder = 'https://（サーバーの住所）'; u.setAttribute('aria-label', 'サーバーの住所');
    const go = el('button', 'btn'); go.type = 'submit'; go.textContent = 'サーバーのページを開く';
    f.appendChild(u); f.appendChild(go);
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      let raw = u.value.trim();
      if (!raw) { toast('サーバーの住所を入れる'); return; }
      if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
      let target;
      try { target = new URL(raw); } catch (e) { toast('住所が読めない'); return; }
      if (target.protocol !== 'https:') { toast('https:// の住所だけ'); return; }
      /* 新しいタブ（Chrome の app の窓からは、ふつうの Chrome のタブ）で開く */
      window.open(target.origin + '/', '_blank', 'noopener');
    });
    w.appendChild(f);
    return w;
  }
  function findRegionOfCur(rid) { return allSeas().some(s => s.id === cur && s.rid === rid); }

  function readReq() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(REQ_KEY) || 'null'); } catch (e) { r = null; }
    if (!r || typeof r.key !== 'string' || typeof r.code !== 'string') return null;
    if (r.expires && r.expires * 1000 < Date.now()) { saveReq(null); return null; }
    return r;
  }
  function saveReq(r) {
    try { if (r) localStorage.setItem(REQ_KEY, JSON.stringify(r)); else localStorage.removeItem(REQ_KEY); } catch (e) { /* 入らなくても続けられる */ }
  }
  async function checkReq(quiet) {
    const r = readReq();
    if (!r || r.approved) return;
    try {
      const st = await requestStatus(r.base, r.key);
      if (st.state === 'approved') { saveReq(Object.assign({}, r, { approved: true, name: st.name || r.name })); toast('登録が認められた。［登録を仕上げる］を押す'); paint(); }
      else if (!quiet) toast('まだ認められていない');
    } catch (e) {
      if (/断られた|期限/.test((e && e.message) || '')) { saveReq(null); paint(); }
      if (!quiet) toast((e && e.message) || '様子が分からない');
    }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!wrap.isConnected) return;
      if (document.visibilityState !== 'hidden') await checkReq(true);
      const r = readReq();
      if (r && !r.approved) schedulePoll();
    }, 8000);
  }
  function scrollToLogin() {
    const n = wrap.querySelector('.sp-login');
    if (n) { try { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 出ている */ } }
  }

  /* ---- 描く ---- */
  function paint() {
    const st = loginState();
    wrap.textContent = '';
    if (pendingInvite && readLink() === pendingInvite) wrap.appendChild(linkBox(st));
    if (st.live) {
      const who = el('div', 'sp-who');
      who.dataset.name = 'ログイン中の札';
      who.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:10px;padding:8px 10px;margin:6px 0;border:1px solid var(--line)';
      who.appendChild(text('span', null, st.userName ? '「' + st.userName + '」でログイン中（' + st.name + '）' : '「' + st.name + '」でログイン中'));
      const out = btn('ログアウト');
      out.addEventListener('click', async () => {
        out.disabled = true;
        /* 個人の写しを残すか聞く（2026-11-18。js/loginflow.js） */
        if (!(await logoutFlow(true))) { out.disabled = false; return; }
        try { sessionStorage.setItem(AFTER_KEY, 'ログアウトした'); } catch (e) { /* 出せなくてもログアウトしてある */ }
        location.reload();
      });
      who.appendChild(out);
      wrap.appendChild(who);
      wrap.appendChild(devicesBox(st));
    }
    const seas = allSeas();
    const srvSeas = seas.filter(s => onServer(s, st) && !(s.personal && st.live && st.spaces.indexOf('me') < 0));
    const localSeas = seas.filter(s => !onServer(s, st));
    if (srvSeas.length) {
      wrap.appendChild(text('p', 'prefs-pages-lb', st.live ? 'サーバーの海（入れる海）' : 'サーバーの海（ログインすると合わせる）'));
      srvSeas.forEach(s => wrap.appendChild(seaRow(s, st)));
    }
    wrap.appendChild(text('p', 'prefs-pages-lb', 'この端末の海'));
    localSeas.forEach(s => wrap.appendChild(seaRow(s, st)));
    wrap.appendChild(makeBox());

    /* いちばん下: サーバーの行（ログインしていないときだけ。たたんだ姿は1行） */
    if (opts.solo) {
      wrap.appendChild(opts.solo);
    } else if (!st.live) {
      const q = el('div', 'sp-server');
      q.dataset.name = 'サーバーの行';
      q.style.cssText = 'margin-top:16px;padding-top:10px;border-top:1px solid var(--line)';
      const r = el('div', 'row');
      r.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
      r.appendChild(text('span', 'note', 'ほかの端末・ほかの人と合わせる'));
      const open = btn(loginOpen ? 'とじる' : 'サーバーにログイン');
      open.addEventListener('click', () => { loginOpen = !loginOpen; paint(); if (loginOpen) scrollToLogin(); });
      r.appendChild(open);
      q.appendChild(r);
      if (loginOpen) q.appendChild(loginBox(st));
      wrap.appendChild(q);
    }
  }

  /* このページを配っているのがパスキーのサーバーか（住所の決まらないときだけ要る） */
  if (!opts.solo && /^https?:$/.test(location.protocol) && !window.Capacitor) {
    authMode(location.origin).then(m => { pageMode = m; if (loginOpen) paint(); });
  } else {
    pageMode = null;
  }
  /* ログイン中なら、入れる海の一覧を取り直す（ほかの端末・持ち主の足した海が並ぶ） */
  const st0 = loginState();
  if (st0.live) pullSeas(st0).then(ok => { if (ok) paint(); });
  sync.onSeas(() => { if (wrap.isConnected) paint(); });
  window.addEventListener(ME_EVENT, () => { if (wrap.isConnected) paint(); });
  /* 招待のリンクで開いたとき、だれから・どの海への招待かを読む（コードは画面に出さない） */
  if (pendingInvite) {
    const base = serverUrl(location.origin, 'passkey') || location.origin;
    peekInvite(base, pendingInvite).then(j => { linkInfo = j; if (wrap.isConnected) paint(); });
  }
  /* 仲間の一覧・役割を新しくする（ログイン中） */
  if (st0.live) fetchMe().then(j => { if (j && wrap.isConnected) paint(); });

  paint();
  /* 前の seasBox と同じ口（settings.js の goServer・「サーバーの設定を開く」から） */
  d.openServer = () => {
    d.open = true;
    if (!loginState().live) loginOpen = true;
    paint();
    scrollToLogin();
  };
  /* サーバーの招待コードを、ログインの「招待コード」の欄へ入れる（2026-11-16 Issue #74 の A 案の (d) を、作り直した海に合わせた）。
     登録（パスキーを作る）は押した手の続きで呼ぶので、ここでは入れるだけ。欄が出ない（ログイン中・サーバーなし版・
     サーバーが配っていないページ・登録を頼んでいる最中）ときは false */
  d.fillInvite = (code) => {
    if (opts.solo || loginState().live) return false;
    pendingInvite = String(code || '').trim();
    d.openServer();
    const inp = wrap.querySelector('input[aria-label="招待コード"]');
    if (!inp) return false;
    inp.value = pendingInvite;
    try { inp.focus(); } catch (e) { /* 入れてはある */ }
    return true;
  };
  return d;
}

function hhmm(ms) {
  const t = new Date(ms);
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
}

