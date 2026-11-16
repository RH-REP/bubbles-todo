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
  requestRegistration, requestStatus, makeInvite } from '../passkey.js';
import { COLORS, colorMark, addSea, updateSea, removeSea, setSeaRegion, mergeSeas } from '../spacelist.js';
import { allSeas, regionConf, entriesOf } from '../regions.js';
import { theServer, serverUrl, ensureServer } from '../oneserver.js';

const SKY = '#7cc3e8';                        /* 個人の水の色（css の空色に近い印） */
const REQ_KEY = 'bubble_todo_pk_request';     /* 登録の頼み（前の欄と同じ箱。続きから使える） */

function text(tag, cls, t) { const n = el(tag, cls); n.textContent = t; return n; }
function btn(label, cls = 'btn') { const b = el('button', cls); b.type = 'button'; b.textContent = label; return b; }

/* ログインの状態（サーバーの繋ぎ先の箱から読む。開いている海の繋ぎ先でも、sync.js が同じ箱に書いている） */
export function loginState() {
  const r = theServer();
  const c = r ? regionConf(r.id) : null;
  const live = !!(c && c.session && Number(c.sessionExpires) * 1000 > Date.now());
  const spaces = live && Array.isArray(c.sessionSpaces) ? c.sessionSpaces : [];
  const owner = live && (typeof c.sessionOwner === 'boolean' ? c.sessionOwner : spaces.indexOf('me') >= 0);
  return { region: r, url: (c && c.url) || '', live, name: live ? String(c.sessionName || '') : '', spaces, owner, session: live ? c.session : '' };
}

/* ログインしたあと、入れる海の一覧をサーバーから受け取る（持ち主ならこの端末のサーバーの海も届ける） */
async function pullSeas(st) {
  if (!st.live || !st.region) return false;
  const mine = st.owner ? entriesOf(st.region.id).map(e => { const o = Object.assign({}, e); delete o.region; return o; }) : [];
  try {
    const res = await fetch(st.url + '/api/spaces', {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + st.session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaces: mine }),
    });
    const j = await res.json();
    if (res.status !== 200 || !j || !Array.isArray(j.spaces)) return false;
    mergeSeas(j.spaces, st.region.id);
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
    row.appendChild(dot); row.appendChild(go); row.appendChild(gear);
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

  /* ---- 海の ⚙（名前・色・置き場・消す）---- */
  function gearBox(s, st) {
    const g = el('div', 'sp-gearbox');
    g.style.cssText = 'margin:0 0 10px 24px;padding:8px 10px;border-left:2px solid var(--line)';
    if (!s.personal) {
      const f = el('form', 'tagadd');
      const nm = document.createElement('input');
      nm.type = 'text'; nm.maxLength = 16; nm.value = s.name; nm.setAttribute('aria-label', '海の名前');
      const col = colorSelect(s.color);
      const save = el('button', 'btn'); save.type = 'submit'; save.textContent = '名前・色を変える';
      f.appendChild(nm); f.appendChild(col); f.appendChild(save);
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!updateSea(s.id, { name: nm.value, color: col.value })) { toast('名前を入れる'); return; }
        toast('変えた'); paint();
      });
      g.appendChild(f);
    }
    /* 置き場 */
    g.appendChild(text('p', 'prefs-pages-lb', '置き場'));
    const seg = el('div', 'row');
    seg.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const here = btn('この端末');
    const srv = btn('サーバー');
    (onServer(s, st) ? srv : here).classList.add('on');
    here.setAttribute('aria-pressed', String(!onServer(s, st)));
    srv.setAttribute('aria-pressed', String(onServer(s, st)));
    seg.appendChild(here); seg.appendChild(srv);
    g.appendChild(seg);
    const why = el('p', 'note');
    why.setAttribute('aria-live', 'polite');
    g.appendChild(why);
    if (s.personal) {
      here.disabled = srv.disabled = true;
      why.textContent = onServer(s, st)
        ? 'サーバーの個人は、ログインした人だけの海（ほかの人には見えない）。置き場は変えられない。'
        : 'この端末の個人。置き場は変えられない（サーバーの個人は、ログインすると並ぶ）。';
    } else if (!onServer(s, st)) {
      if (!st.live) why.textContent = 'サーバーに置くには、先にログインする（下の［サーバーにログイン］）。';
      else if (!st.owner) why.textContent = 'サーバーに海を置けるのは、サーバーの持ち主だけ。';
      srv.addEventListener('click', () => {
        if (!st.live) { loginOpen = true; openGear = null; paint(); scrollToLogin(); return; }
        if (!st.owner) { toast('サーバーに海を置けるのは、サーバーの持ち主だけ'); return; }
        if (!setSeaRegion(s.id, st.region.id)) { toast('変えられなかった'); return; }
        toast('サーバーに置いた。中身は次に合わせたときに送る');
        if (s.id === cur) location.reload(); else paint();
      });
    } else {
      why.textContent = 'この端末へ戻すと、サーバーとは合わせなくなる（この端末の中身は残る。サーバーの中身も消さない）。';
      here.addEventListener('click', () => {
        if (!setSeaRegion(s.id, 'local')) { toast('変えられなかった'); return; }
        toast('この端末の海にした');
        if (s.id === cur) location.reload(); else paint();
      });
    }
    if (onServer(s, st) && st.live) g.appendChild(inviteBox(s, st));
    /* 消す（2度押す。記録の箱は残し、一覧に消した印を付ける） */
    if (!s.personal) {
      const del = btn('この海を消す');
      let armed = false;
      del.addEventListener('click', () => {
        if (!armed) { armed = true; del.textContent = 'もう一度押すと消す'; return; }
        if (!removeSea(s.id)) { toast('消せなかった'); return; }
        toast('「' + s.name + '」を消した');
        if (s.id === cur) goTo('me'); else { openGear = null; paint(); }
      });
      const r = el('div', 'row'); r.style.marginTop = '8px'; r.appendChild(del); g.appendChild(r);
    }
    return g;
  }

  /* 人を招く（2026-11-16 利用者の指示「招けるようにして」）。招待コードはサーバーが作る（24 時間・1回きり）。
     サーバーの個人 … 自分の端末を足す。持ち主なら、新しい人（その人だけの個人）も招ける
     ほかのサーバーの海 … その海に人を招く。持ち主なら「その人だけの個人もつける」を選べる */
  function inviteBox(s, st) {
    const w = el('div', 'sp-invite');
    w.dataset.name = '人を招く';
    w.appendChild(text('p', 'prefs-pages-lb', s.personal ? '端末を足す・人を招く' : 'この海に人を招く'));
    const f = el('form', 'tagadd');
    const nm = document.createElement('input');
    nm.type = 'text'; nm.maxLength = 40; nm.setAttribute('aria-label', '招く端末の呼び名');
    nm.placeholder = s.personal ? '足す端末の呼び名（例 自分のタブレット）' : '招く人の呼び名（例 母のスマホ）';
    f.appendChild(nm);
    let who = null;
    if (st.owner) {
      who = document.createElement('select');
      who.setAttribute('aria-label', '誰を招くか');
      const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; who.appendChild(o); };
      if (s.personal) { opt('mine', '自分の端末'); opt('new', '新しい人（その人だけの個人）'); }
      else { opt('sea', 'この海だけ'); opt('new', 'この海と、その人だけの個人'); }
      f.appendChild(who);
    }
    const b = el('button', 'btn'); b.type = 'submit'; b.textContent = '招待コードを作る';
    f.appendChild(b);
    w.appendChild(f);
    const out = el('div');
    out.setAttribute('aria-live', 'polite');
    w.appendChild(out);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = nm.value.trim();
      if (!name) { toast('呼び名を入れる'); return; }
      b.disabled = true;
      out.textContent = '';
      try {
        const got = await makeInvite(st.url, st.session, { name, sea: s.personal ? 'me' : s.id, newPerson: !!(who && who.value === 'new') });
        const code = text('p', null, got.code);
        code.style.cssText = 'font-size:1.5em;letter-spacing:.1em;font-weight:600;margin:4px 0;user-select:all';
        out.appendChild(code);
        out.appendChild(text('p', null, '「' + name + '」の招待コード（24 時間・1回だけ）。相手にこのページの住所とコードを渡す。'
          + '相手は設定の「海」の［サーバーにログイン］→［招待コードで登録］。'));
        const cp = btn('コードを写す');
        cp.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(got.code); toast('写した'); }
          catch (e) { try { getSelection().selectAllChildren(code); toast(document.execCommand('copy') ? '写した' : '選んだので ⌘C で'); } catch (_) { toast('コードを長押しして写す'); } }
        });
        out.appendChild(cp);
        nm.value = '';
      } catch (e) {
        out.appendChild(text('p', 'note', (e && e.message) || '作れなかった'));
      } finally { b.disabled = false; }
    });
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
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const e = addSea(nm.value, col.value, Date.now(), 'local');
      if (!e) { toast('名前を入れる'); return; }
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
      w.appendChild(text('p', 'note', pageMode === undefined
        ? 'サーバーを確かめている…'
        : 'ログインできるのは、サーバーが配っているページで開いたときだけ（パスキーはそのページの住所に結び付くため）。サーバーのページを開き、そこで同じ［サーバーにログイン］を押す。'));
      return w;
    }
    if (!passkeySupported()) { w.appendChild(text('p', 'note', 'このブラウザはパスキーを使えない。')); return w; }
    const line = el('p', 'note'); line.setAttribute('aria-live', 'polite');
    const busy = async (b, fn) => { b.disabled = true; try { await fn(); } catch (e) { line.textContent = (e && e.message) || '失敗した'; } finally { b.disabled = false; } };
    const done = async (out) => {
      const r = ensureServer(url);
      if (!r || !sync.usePasskeySessionRegion(r.id, url, out)) throw new Error('ログインを覚えられなかった');
      saveReq(null);
      loginOpen = false;
      await pullSeas(loginState());
      toast('「' + out.name + '」でログインした');
      /* 開いている海がサーバーの海なら、読み直して合わせ始める */
      if (findRegionOfCur(r.id)) location.reload(); else paint();
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
      const inv = el('form', 'tagadd');
      const code = document.createElement('input');
      code.type = 'text'; code.autocomplete = 'off'; code.placeholder = '招待コード（ABCD-EFGH-JKLM）'; code.setAttribute('aria-label', '招待コード');
      const reg = el('button', 'btn'); reg.type = 'submit'; reg.textContent = '招待コードで登録';
      inv.appendChild(code); inv.appendChild(reg);
      inv.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!code.value.trim()) { line.textContent = '招待コードを入れる'; return; }
        busy(reg, async () => done(await registerPasskey(url, code.value)));
      });
      w.appendChild(inv);
    }
    w.appendChild(line);
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
    if (st.live) {
      const who = el('div', 'sp-who');
      who.dataset.name = 'ログイン中の札';
      who.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:10px;padding:8px 10px;margin:6px 0;border:1px solid var(--line)';
      who.appendChild(text('span', null, '「' + st.name + '」でログイン中' + (st.owner ? '（持ち主）' : '')));
      const out = btn('ログアウト');
      out.addEventListener('click', async () => {
        out.disabled = true;
        const old = st.session;
        if (st.region && st.region.id === sync.region().id) sync.dropPasskeySession();
        else if (st.region) sync.configureRegion(st.region.id, st.url, '', '');
        if (old) await logoutPasskey(st.url, old);
        toast('ログアウトした（どの海の記録もこの端末に残っている）');
        paint();
      });
      who.appendChild(out);
      wrap.appendChild(who);
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

  paint();
  /* 前の seasBox と同じ口（settings.js の goServer・「サーバーの設定を開く」から） */
  d.openServer = () => {
    d.open = true;
    if (!loginState().live) loginOpen = true;
    paint();
    scrollToLogin();
  };
  return d;
}

function hhmm(ms) {
  const t = new Date(ms);
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
}

