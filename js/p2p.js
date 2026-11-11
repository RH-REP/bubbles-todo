/* 端末どうしの直の通信（p2p。2026-11-11 Issue #37 の返事「おすすめで」= ①顔合わせはブロックチェーン・②STUN は Cloudflare（設定で切れる）・
   ③つながらない間は未送の列・作る順は 1 = チャットから）。
   DOM は触らない（RTCPeerConnection は外から渡せる）。設定の画面 settings.js の openChat が使う。テストは tests/p2p.test.mjs。

   ■ 使い分け（2026-11-11 の返事「おすすめで」で見直した）
     直につながっている相手がいれば、直に送る（手数料なし・チェーンに残らない。履歴は端末にだけ）。
     いなければ、チェーンに書く（手数料あり。相手が後で開いても届く）。このとき端末の印を入れ、「ここにいる」の知らせを兼ねる。
     直に送ったものを残したいときは「ブロックチェーンにも残す」。残高が足りずに書けないときだけ「未送」として端末に貯める。
     サーバーに写すのは後回し（サーバーあり版にはチャットが無い）

   ■ 顔合わせ（シグナリング）。チャットの掲示板（board.js の chatBoardOf）に、署名して暗号化して書く
     msgs   … チェーンに書いたメッセージ { dev, msgs }。10 分のあいだ「ここにいる」の知らせになる
     hello  … 送らずにつなぎたいときに「相手を呼ぶ」で書く { dev }。10 分のあいだ有効
     offer  … 知らせ（msgs・hello）を見た側が書く { to, sid, sdp }。3 分のあいだ有効。
              両方から offer が出たら、端末の印（dev）の大きいほうの offer だけに答える
     answer … offer を受けた側が書く { to, sid, sdp }
   sdp は ICE の候補を集め終えてから書く（候補を小分けに送らない。書き込みの数を減らすため）。
   書き込みにはウォレットの署名が入り、名簿の人の書き込みだけを使う。sdp には暗号の鍵の指紋が入るので、なりすましはつながらない。

   ■ STUN
   違う Wi‑Fi どうしでつなぐため、外から見た住所を 1 度だけ尋ねる窓口。Cloudflare の公開の窓口を使う（登録・料金なし）。
   窓口には IP アドレスと時刻が分かる（中身は通らない）。設定で切ると、同じ Wi‑Fi の端末どうしだけになる。
   ブラウザの CSP（connect-src）は WebRTC を対象にしないので、窓口の住所はここだけで決める。

   ■ メッセージ
   1 通 = 署名した { kind: 'm', id, sea, g, at, by, text }（board.js の signedPost の包み）。
   p2p でも、ブロックチェーン（kind 'msgs' にまとめて）でも、同じ包みのまま運ぶ。受け取った側は、署名・名簿・海・代を確かめる。
   つながったら、互いに手元の新しい 100 通を送り合う（重なりは id で除く）。ほかのメンバーのメッセージも署名ごと渡せる */

import { signedPost, verifyPost, MSG_MAX } from './board.js';

export const STUN_URL = 'stun:stun.cloudflare.com:3478';
export const HELLO_MS = 10 * 60 * 1000;
export const SIG_MS = 3 * 60 * 1000;
export const GATHER_MS = 5000;
export const HIST_MAX = 300;
export const PREFS_KEY = 'bubble_todo_p2p_v1';
export const DEV_KEY = 'bubble_todo_p2p_dev';
const HIST_PREFIX = 'bubble_todo_chat_';

function ls(st) { return st || globalThis.localStorage; }
function hex(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/* ---- 設定（この端末だけ。初めは両方入り） ---- */
export function loadP2pPrefs(st) {
  try {
    const p = JSON.parse(ls(st).getItem(PREFS_KEY) || 'null');
    if (p && typeof p === 'object') return { on: p.on !== false, stun: p.stun !== false };
  } catch (e) { /* 壊れていれば既定 */ }
  return { on: true, stun: true };
}
export function saveP2pPrefs(p, st) { ls(st).setItem(PREFS_KEY, JSON.stringify({ on: !!p.on, stun: !!p.stun })); }
export function iceServers(prefs) { return prefs && prefs.stun ? [{ urls: STUN_URL }] : []; }
export function p2pSupported(g = globalThis) { return typeof g.RTCPeerConnection === 'function'; }

/* この端末の印（同じウォレットのほかの端末と見分ける。秘密ではない） */
export function deviceId(st) {
  const s = ls(st);
  let d = null;
  try { d = s.getItem(DEV_KEY); } catch (e) { d = null; }
  if (!/^[0-9a-f]{16}$/.test(String(d || ''))) {
    d = hex(8);
    try { s.setItem(DEV_KEY, d); } catch (e) { /* 置けなくても、この開いている間は使える */ }
  }
  return d;
}

/* ---- 履歴（端末にだけ置く）。部屋 = 'sea:<海の ID>:<代>' か 'self:<アドレス>' ----
   1 件 = { id, by, at, text, env, state }。state = 'unsent'（まだどこにも届いていない）| 'p2p'（直に届けた・受け取った）| 'chain'（チェーンにある） */
export function histKey(room) { return HIST_PREFIX + String(room).replace(/[^0-9A-Za-z:_-]/g, '') + '_v1'; }
export function loadHistory(room, st) {
  try {
    const a = JSON.parse(ls(st).getItem(histKey(room)) || '[]');
    return Array.isArray(a) ? a.filter(m => m && typeof m.id === 'string') : [];
  } catch (e) { return []; }
}
export function saveHistory(room, list, st) {
  const keep = list.slice().sort((a, b) => a.at - b.at).slice(-HIST_MAX);
  ls(st).setItem(histKey(room), JSON.stringify(keep));
  return keep;
}
const RANK = { unsent: 0, p2p: 1, chain: 2 };
/* 重ねる。同じ id なら、届いた度合いの高いほう（chain > p2p > unsent）を残す。戻り値 { list, added（新しく足した数） } */
export function mergeHistory(list, incoming, state) {
  const byId = new Map(list.map(m => [m.id, m]));
  let added = 0;
  incoming.forEach(m => {
    const st = m.state || state || 'p2p';
    const cur = byId.get(m.id);
    if (!cur) { byId.set(m.id, Object.assign({}, m, { state: st })); added++; return; }
    if ((RANK[st] || 0) > (RANK[cur.state] || 0)) cur.state = st;
  });
  return { list: Array.from(byId.values()).sort((a, b) => a.at - b.at), added };
}
export function markState(list, ids, state) {
  const set = new Set(ids);
  list.forEach(m => { if (set.has(m.id) && (RANK[state] || 0) > (RANK[m.state] || 0)) m.state = state; });
  return list;
}

/* ---- メッセージの包み ---- */
export async function signMsg(wallet, { sea, g, text }) {
  const env = await signedPost(wallet, { kind: 'm', id: hex(8), sea, g, at: Date.now(), text: String(text).slice(0, MSG_MAX) });
  const inner = JSON.parse(env.p);
  return { id: inner.id, by: inner.by, at: inner.at, text: inner.text, env };
}
export async function openMsg(env, { sea, g, allowed }) {
  const inner = await verifyPost(env);
  if (!inner || inner.kind !== 'm' || inner.sea !== sea || Number(inner.g) !== g) return null;
  if (!(allowed || []).includes(inner.by) || typeof inner.text !== 'string' || !/^[0-9a-f]{16}$/.test(String(inner.id))) return null;
  return { id: inner.id, by: inner.by, at: Number(inner.at) || 0, text: inner.text.slice(0, MSG_MAX), env };
}
/* チャットの掲示板の書き込み → メッセージ（'msg' = 前の版の 1 通ずつの形、'msgs' = まとめた形）。state は 'chain' */
export async function messagesFromPosts(posts, { sea, g, allowed }) {
  const ok = new Set(allowed || []);
  const out = [];
  for (const p of posts) {
    if (p.sea !== sea || Number(p.g) !== g) continue;
    if (p.kind === 'msg' && ok.has(p.by) && typeof p.text === 'string') {
      /* 前の版の形には id が無い。書いた人・時刻・本文から作る */
      out.push({ id: 'c' + p.by.slice(0, 6) + String(p.at), by: p.by, at: Number(p.at) || 0, text: p.text.slice(0, MSG_MAX), env: null, state: 'chain' });
    } else if (p.kind === 'msgs' && Array.isArray(p.msgs)) {
      for (const env of p.msgs.slice(0, 200)) {
        const m = await openMsg(env, { sea, g, allowed });
        if (m) out.push(Object.assign(m, { state: 'chain' }));
      }
    }
  }
  return out;
}

/* ICE の候補を集め終えるのを待つ（集まらなくても limit で進む） */
export function waitGathering(pc, limit = GATHER_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); pc.removeEventListener && pc.removeEventListener('icegatheringstatechange', on); resolve(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, limit);
    if (pc.addEventListener) pc.addEventListener('icegatheringstatechange', on);
    else pc.onicegatheringstatechange = on;
  });
}

/* ---- つながりの網（部屋 1 つ・開いている間だけ） ----
   o = { sea, g, dev, allowed()（使ってよいアドレス）, post(inner)（顔合わせを掲示板に書く）, history()（手元の履歴）,
         onMessages(list, peer), onPeerOpen(peer), onState(), ice, RTC } */
export class Mesh {
  constructor(o) {
    Object.assign(this, o);
    this.peers = new Map();
    this.seen = new Set();
    this.closed = false;
    if (!this.RTC) this.RTC = globalThis.RTCPeerConnection;
  }
  openCount() {
    let n = 0;
    this.peers.forEach(p => { if (p.ch && p.ch.readyState === 'open') n++; });
    return n;
  }
  hello() { return this.post({ kind: 'hello', sea: this.sea, g: this.g, dev: this.dev, at: Date.now() }); }

  /* 掲示板の書き込み（新しい順・署名を確かめたもの）を見て、顔合わせを進める */
  async onPosts(posts) {
    if (this.closed) return;
    const now = Date.now();
    const ok = new Set(this.allowed());
    for (const p of posts.slice().reverse()) {
      if (!['hello', 'msgs', 'offer', 'answer'].includes(p.kind)) continue;
      if (!ok.has(p.by) || p.sea !== this.sea || Number(p.g) !== this.g) continue;
      if (typeof p.dev !== 'string' || p.dev === this.dev) continue;
      const key = [p.kind, p.dev, p.sid || '', p.at].join('|');
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const age = now - (Number(p.at) || 0);
      try {
        /* チェーンに書いたメッセージ（msgs）にも端末の印を入れ、「ここにいる」の知らせを兼ねる（2026-11-11 返事: 「開いた」の代わりに 1 通目を書く） */
        if ((p.kind === 'hello' || p.kind === 'msgs') && age < HELLO_MS) {
          /* 知らせを見た側が offer を書く（知らせは片方だけのこともある: 1 通送っただけの相手）。
             両方が互いの知らせを見て両方から offer が来たときは、answer の側で印の大きいほうの offer を残す */
          if (!this.peers.has(p.dev)) await this.offer(p.dev, p.by);
        } else if (p.kind === 'offer' && p.to === this.dev && age < SIG_MS && typeof p.sdp === 'string') {
          await this.answer(p);
        } else if (p.kind === 'answer' && p.to === this.dev && age < SIG_MS && typeof p.sdp === 'string') {
          await this.accept(p);
        }
      } catch (e) { if (this.onError) this.onError(e); }
    }
  }

  newPeer(dev, addr) {
    const pc = new this.RTC({ iceServers: this.ice || [] });
    const peer = { pc, ch: null, dev, addr, sid: null };
    this.peers.set(dev, peer);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(dev);
      if (this.onState) this.onState();
    };
    return peer;
  }
  wire(peer, ch) {
    peer.ch = ch;
    ch.onopen = () => {
      /* つながったら、手元の新しい 100 通を送る（相手が持っていない分を埋める。未送もここで届く） */
      this.sendTo(peer, { t: 'msgs', msgs: (this.history() || []).filter(m => m.env).slice(-100).map(m => m.env) });
      if (this.onPeerOpen) this.onPeerOpen(peer);
      if (this.onState) this.onState();
    };
    ch.onclose = () => { if (this.onState) this.onState(); };
    ch.onmessage = ev => { this.onData(peer, ev.data); };
  }
  async localSdp(pc, kind) {
    const d = kind === 'offer' ? await pc.createOffer() : await pc.createAnswer();
    await pc.setLocalDescription(d);
    await waitGathering(pc);
    return pc.localDescription.sdp;
  }
  async offer(dev, addr) {
    const peer = this.newPeer(dev, addr);
    peer.sid = hex(8);
    this.wire(peer, peer.pc.createDataChannel('chat'));
    const sdp = await this.localSdp(peer.pc, 'offer');
    await this.post({ kind: 'offer', sea: this.sea, g: this.g, dev: this.dev, to: dev, sid: peer.sid, sdp, at: Date.now() });
  }
  async answer(p) {
    const cur = this.peers.get(p.dev);
    if (cur && cur.ch && cur.ch.readyState === 'open') return;
    /* 互いに offer を出し合った: 印の大きいほうの offer を生かす（こちらが大きければ、相手がこちらの offer に答える） */
    if (cur && cur.pc.signalingState === 'have-local-offer' && this.dev > p.dev) return;
    if (cur) this.drop(p.dev);
    const peer = this.newPeer(p.dev, p.by);
    peer.sid = p.sid;
    peer.pc.ondatachannel = ev => this.wire(peer, ev.channel);
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
    const sdp = await this.localSdp(peer.pc, 'answer');
    await this.post({ kind: 'answer', sea: this.sea, g: this.g, dev: this.dev, to: p.dev, sid: p.sid, sdp, at: Date.now() });
  }
  async accept(p) {
    const peer = this.peers.get(p.dev);
    if (!peer || peer.sid !== p.sid || peer.addr !== p.by) return;
    if (peer.pc.signalingState !== 'have-local-offer') return;
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
  }

  sendTo(peer, obj) {
    try {
      if (peer.ch && peer.ch.readyState === 'open') { peer.ch.send(JSON.stringify(obj)); return true; }
    } catch (e) { /* 送れなければ届かなかった扱い */ }
    return false;
  }
  /* 包んだメッセージを、つながっている全員へ。戻り値 届けた相手の数 */
  broadcast(envs) {
    let n = 0;
    this.peers.forEach(peer => { if (this.sendTo(peer, { t: 'msgs', msgs: envs })) n++; });
    return n;
  }
  async onData(peer, data) {
    let o;
    try { o = JSON.parse(String(data)); } catch (e) { return; }
    if (!o || o.t !== 'msgs' || !Array.isArray(o.msgs)) return;
    const list = [];
    for (const env of o.msgs.slice(0, 200)) {
      const m = await openMsg(env, { sea: this.sea, g: this.g, allowed: this.allowed() });
      if (m) list.push(m);
    }
    if (list.length && this.onMessages) this.onMessages(list, peer);
  }
  drop(dev) {
    const peer = this.peers.get(dev);
    if (!peer) return;
    this.peers.delete(dev);
    try { if (peer.ch) peer.ch.close(); } catch (e) { /* 閉じられなくても進む */ }
    try { peer.pc.close(); } catch (e) { /* 同じ */ }
  }
  close() {
    this.closed = true;
    Array.from(this.peers.keys()).forEach(d => this.drop(d));
  }
}
