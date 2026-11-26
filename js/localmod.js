/* 見た目と言葉を AI に頼んで変える（この端末だけ。サーバーなし版だけ）。
   2026-11-21 Issue #91「サーバーなし版のローカル限定の仕様変更」の返事「おすすめで」= A 案。

   ■ 何をするか
   利用者が「完了の泡を緑にして」「『今日は終わり』を『また明日』にして」のように書くと、AI が
     ・CSS（見た目の上書き）
     ・言葉の置き換え（画面の文字がぴったり同じときだけ、別の字で見せる）
   を返す。確かめてから当て、変更を1件ずつ「ローカルの変更」として端末に残す。どれでも外せる。

   ■ やらないこと（A 案の柵）
   ・JavaScript は当てない（AI の書いたコードを動かさない。API キーと記録をページの中のコードから守るため。README「AI に訊く」）
   ・CSS でも、外へ繋ぐもの（url( @import など）と、ほかの書き方に化けるもの（\ の逃がし・< など）は当てない（cleanCss）。
     ページの CSP（img-src・font-src は 'self' と data: だけ）でも止まるが、ここでも先に捨てる
   ・設定の画面（#pane-settings）には効かせない（おかしくなっても、設定から必ず外せるように）。設定を開いている間は CSS を止め、
     言葉の置き換えも設定の中には入れない
   ・泡・一覧の行（[data-id] の中）の文字は置き換えない（利用者の書いたもの）。入力欄・本文の欄も触らない
   ・記録（泡・タグ・設定の値）は変えない。見せ方だけ

   ■ 置き場
   localStorage の LOCALMOD_KEY だけ。同期・引っ越しのファイル・ブロックチェーンの控えには乗らない（bubble_todo で始まるので、
   「すべて初期化」で消え、「前の版に戻す」の写しには入る）。

   ■ 当てたあとの試し（TRIAL_MS）
   当てた変更は、TRIAL_MS のうちに「残す」を押さなければ外れる（画面の解像度を変えたときと同じ形）。
   CSS で歯車や知らせが隠れて「残す」も外すボタンも押せなくなったときに、待つだけで戻るため。

   ■ 逃げ道
   住所に ?nolocal（または #nolocal）を付けて開くと、その窓の間はローカルの変更を当てない。

   DOM の無い所（テストの Node）でも読めるよう、画面を触るのは start・apply・pause の中だけ。 */

export const LOCALMOD_KEY = 'bubble_todo_localmod_v1';
export const LOCALMOD_EVENT = 'bubbles:localmod';
export const MAX_MODS = 30;        /* 残しておける変更の数 */
export const CSS_MAX = 4000;       /* 1件の CSS の字数 */
export const TEXT_MAX = 20;        /* 1件の言葉の置き換えの数 */
export const TEXT_LEN = 40;        /* 置き換える字・置き換えた字の長さ */
export const ASK_MAX = 1000;       /* 頼みの文の字数 */
export const TRIAL_MS = 30000;     /* 当ててから「残す」を待つ時間 */

/* ---- CSS を確かめる ----
   -> { ok: true, css } か { ok: false, why }。
   当てないもの: 外へ繋ぐ・読み込む（url( image-set( @import @font-face @namespace）、古いブラウザでスクリプトになるもの
   （expression( behavior -moz-binding javascript:）、逃がし（\。\75 rl( で url( に化けるため）、< と >（</style> で抜けるのを防ぐ。
   子の結合子 > は ' ' で書いてもらう）、括弧の数が合わないもの（後ろの守りの規則まで飲み込むため） */
const CSS_BAD = [
  [/url\s*\(/i, 'url( は使えない（外から読み込めるため）'],
  [/image-set\s*\(/i, 'image-set( は使えない'],
  [/@import/i, '@import は使えない'],
  [/@font-face/i, '@font-face は使えない'],
  [/@namespace/i, '@namespace は使えない'],
  [/@charset/i, '@charset は使えない'],
  [/expression\s*\(/i, 'expression( は使えない'],
  [/behavior\s*:/i, 'behavior は使えない'],
  [/-moz-binding/i, '-moz-binding は使えない'],
  [/javascript:/i, 'javascript: は使えない'],
  [/\\/, '\\（逃がしの字）は使えない'],
  [/[<>]/, '< と > は使えない（子の結合子 > の代わりに空白で書く）'],
];

export function cleanCss(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').trim();   /* 注釈は落とす（中に隠せないように） */
  if (!s) return { ok: true, css: '' };
  if (s.length > CSS_MAX) return { ok: false, why: 'CSS が長すぎる（' + CSS_MAX + ' 字まで）' };
  if (s.indexOf('/*') >= 0) return { ok: false, why: '閉じていない注釈がある' };
  for (const [re, why] of CSS_BAD) if (re.test(s)) return { ok: false, why };
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) return { ok: false, why: '括弧 { } の数が合わない' }; }
  }
  if (depth !== 0) return { ok: false, why: '括弧 { } の数が合わない' };
  if (!/\{/.test(s)) return { ok: false, why: 'CSS の規則の形になっていない' };
  return { ok: true, css: s };
}

/* ---- 言葉の置き換えを確かめる ----
   [[元の字, 見せる字], …] か { 元の字: 見せる字 }。どちらも空でない・改行なし・TEXT_LEN 字まで・同じでないものだけ残す */
export function cleanTexts(raw) {
  let pairs = [];
  if (Array.isArray(raw)) pairs = raw.map(p => (Array.isArray(p) ? [p[0], p[1]] : (p && typeof p === 'object' ? [p.from, p.to] : null))).filter(Boolean);
  else if (raw && typeof raw === 'object') pairs = Object.keys(raw).map(k => [k, raw[k]]);
  const out = [];
  const seen = new Set();
  for (const [a0, b0] of pairs) {
    const a = String(a0 == null ? '' : a0).trim();
    const b = String(b0 == null ? '' : b0).trim();
    if (!a || !b || a === b) continue;
    if (a.length > TEXT_LEN || b.length > TEXT_LEN) continue;
    if (/[\r\n]/.test(a + b)) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push([a, b]);
    if (out.length >= TEXT_MAX) break;
  }
  return out;
}

/* ---- 1件の変更 ---- */
function newId() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* 保存してある1件を読める形にする。読めなければ null */
export function normalizeMod(o) {
  if (!o || typeof o !== 'object') return null;
  const c = cleanCss(o.css);
  const css = c.ok ? c.css : '';
  const texts = cleanTexts(o.texts);
  if (!css && !texts.length) return null;
  return {
    id: typeof o.id === 'string' && /^[a-z0-9]{1,24}$/.test(o.id) ? o.id : newId(),
    ask: String(o.ask || '').slice(0, ASK_MAX),
    summary: String(o.summary || '').slice(0, 200),
    css,
    texts,
    on: o.on !== false,
    trial: !!o.trial,      /* 当てたばかりで、まだ「残す」を押していない（読み直したら外す） */
    at: Number(o.at) || 0,
    ver: String(o.ver || '').slice(0, 20),
  };
}

export function makeMod({ ask, summary, css, texts, ver, at, trial }) {
  return normalizeMod({ id: newId(), ask, summary, css, texts, on: true, trial: !!trial, at: at || Date.now(), ver });
}

/* 「残す」を押した */
export function keepMod(list, id) {
  return (list || []).map(m => (m.id === id ? Object.assign({}, m, { trial: false }) : m));
}

/* 試しのまま残っているもの（読み直した・閉じた）を外す -> 新しい一覧 */
export function dropTrials(list) {
  return (list || []).filter(m => !m.trial);
}

/* 版が変わったか。入れている変更が前の版で作られていたら true を返し、版の名前を今のものにした一覧を添える。
   -> { changed, list } */
export function markVersion(list, ver) {
  const v = String(ver || '');
  let changed = false;
  const next = (list || []).map(m => {
    if (m.ver === v) return m;
    if (m.on && m.ver) changed = true;
    return Object.assign({}, m, { ver: v });
  });
  return { changed, list: next };
}

/* ---- 端末に置く ---- */
function ls(s) {
  if (s) return s;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function loadMods(storage) {
  const s = ls(storage);
  let raw = null;
  try { raw = JSON.parse((s && s.getItem(LOCALMOD_KEY)) || 'null'); } catch (e) { raw = null; }
  const list = raw && Array.isArray(raw.mods) ? raw.mods : [];
  return list.map(normalizeMod).filter(Boolean).slice(0, MAX_MODS);
}

/* -> 置けたら true。空なら箱ごと消す */
export function saveMods(list, storage) {
  const s = ls(storage);
  if (!s) return false;
  const mods = (list || []).map(normalizeMod).filter(Boolean).slice(0, MAX_MODS);
  try {
    if (mods.length) s.setItem(LOCALMOD_KEY, JSON.stringify({ v: 1, mods }));
    else s.removeItem(LOCALMOD_KEY);
    return true;
  } catch (e) { return false; }
}

/* 新しい変更を後ろに足す（後ろほど強い）。数の上限を超えたら足さない -> 新しい一覧か null */
export function addMod(list, mod) {
  const m = normalizeMod(mod);
  if (!m) return null;
  if ((list || []).length >= MAX_MODS) return null;
  return (list || []).concat([m]);
}

export function setModOn(list, id, on) {
  return (list || []).map(m => (m.id === id ? Object.assign({}, m, { on: !!on }) : m));
}

export function removeMod(list, id) {
  return (list || []).filter(m => m.id !== id);
}

/* 当てる CSS（入れているものを古い順につなぐ） */
export function combinedCss(list) {
  return (list || []).filter(m => m.on && m.css).map(m => '/* ' + m.id + ' */\n' + m.css).join('\n');
}

/* 言葉の置き換え（後の変更が前のものに勝つ）-> Map 元の字 → 見せる字 */
export function textMap(list) {
  const map = new Map();
  (list || []).filter(m => m.on).forEach(m => m.texts.forEach(([a, b]) => map.set(a, b)));
  return map;
}

/* ---- AI に頼む ----
   送るのは、書いた文・下の部品の説明・今の画面にある class の名前（コードの名前。利用者の書いたものではない）・
   今入れている変更の要約だけ。泡の中身・タグの名前・記録は送らない */
export const CATALOG = [
  'CSS の変数（:root に書くと全体の色が変わる）: --bg（背景）・--surface（面）・--surface-2・--line・--line-strong（線）・'
    + '--text・--text-2・--text-3（字）・--sea-1・--sea-2・--sea-3（海の背景の色）・--bub-fill（泡の塗り）・--bub-edge（泡の縁）・'
    + '--bub-text（泡の字）・--today-edge・--today-fill（今日の色）・--accent-a・--accent-b（目立つ色）',
  '下のタブ: nav.tabbar（#tabbar）と、その中の button（今いる画面は .is-active）',
  '画面: section.pane（#pane-sea 海・#pane-today 今日・#pane-plan きっかけ・#pane-gap すきま・#pane-review ふりかえり）。今の画面は .pane.is-active',
  '泡: .bub（海と今日に漂う丸）。泡をタップして開く詳細: .bub-center',
  '知らせ: .toast（下に出る短い知らせ）',
  'メニュー（左上の ≡）: .drawer',
  '右上の歯車: .gearbtn（隠したり押せなくしたりしない）',
];

export function classNamesOf(root) {
  const set = new Set();
  try {
    const r = root || (typeof document !== 'undefined' ? document.body : null);
    if (!r) return [];
    r.querySelectorAll('[class]').forEach(n => {
      if (n.closest && n.closest('#pane-settings')) return;
      String(n.getAttribute('class') || '').split(/\s+/).forEach(c => {
        if (/^[a-zA-Z][\w-]{0,40}$/.test(c)) set.add(c);
      });
    });
  } catch (e) { /* 取れなければ部品の説明だけで頼む */ }
  return [...set].sort().slice(0, 300);
}

export function buildModPrompt(text, list, classNames) {
  const cur = (list || []).filter(m => m.on).map(m => '- ' + (m.summary || m.ask).slice(0, 80)).join('\n') || '（なし）';
  const system = 'あなたは todo アプリ「Bubbles」の見た目と画面の言葉を、この端末だけで変える手伝いをする。'
    + '利用者の頼みを、CSS と「画面の言葉の置き換え」に置き換える。JavaScript・HTML は書かない（書いても適用しない）。'
    + '返事は JSON だけ（前後に文を付けない）: {"css": "CSS の文字列（無ければ空）", "texts": [["今の画面の字", "見せたい字"], …], '
    + '"summary": "この変更の短い名前（日本語・30字まで）", "reply": "利用者への短い説明（日本語・2文まで）"}。\n'
    + '決まり:\n'
    + '- CSS では url( ・@import・@font-face・\\（逃がし）・< と > を使わない（使うと適用しない）。子の結合子 > は使わず空白で書く\n'
    + '- 設定の画面（#pane-settings）と右上の歯車（.gearbtn）は変えない。画面全体や下のタブを隠さない\n'
    + '- 必要なら !important を使ってよい。セレクタは下の部品と class の名前から選ぶ\n'
    + '- texts は、ボタンや見出しなど画面に出ている字が、ぴったり同じときだけ置き換わる。利用者が書いた字をそのまま元の字に使う\n'
    + '- 動き（新しいボタン・計算・保存のしかた）を変える頼みは、できないので css と texts を空にし、reply にそう書く\n\n'
    + '部品:\n' + CATALOG.map(s => '- ' + s).join('\n')
    + '\n\n今の画面にある class の名前: ' + (classNames && classNames.length ? classNames.join(' ') : '（取れなかった）')
    + '\n\n今入れている変更:\n' + cur;
  return { system, user: String(text || '').slice(0, ASK_MAX) };
}

/* AI の返事を読む -> { css, texts, summary, reply, why }。
   css が当てられない形なら css は空で why に理由。JSON が読めなければ全部空で reply に返事の文 */
export function readModReply(raw) {
  const s = String(raw || '');
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const c = cleanCss(o.css);
        return {
          css: c.ok ? c.css : '',
          texts: cleanTexts(o.texts),
          summary: String(o.summary || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          reply: String(o.reply || '').slice(0, 300),
          why: c.ok ? '' : c.why,
        };
      }
    } catch (e) { /* 下へ */ }
  }
  return { css: '', texts: [], summary: '', reply: s.replace(/\s+/g, ' ').trim().slice(0, 300), why: '' };
}

/* ---- 画面に当てる（ブラウザだけ）---- */
const STYLE_ID = 'localmod-style';
const GUARD_ID = 'localmod-guard';
/* 歯車だけは、どの変更よりも強く出す（id ではないので class を重ねて強さを上げる。後ろに置くので同じ強さなら勝つ） */
const GUARD_CSS = '.gearbtn.gearbtn.gearbtn.gearbtn{visibility:visible!important;opacity:1!important;pointer-events:auto!important;}';
/* 置き換える字を探す所（ボタン・見出し・札）。泡と一覧の行（[data-id]）・設定・入力欄の中は見ない */
const TEXT_SEL = 'button, a, h1, h2, h3, h4, label, summary, legend, th, option, [role="tab"], .nm, .sub, .lb';
const SKIP_SEL = '[data-id], #pane-settings, textarea, [contenteditable], .toast';

let started = false;
let paused = false;
let disabled = false;     /* ?nolocal で開いた窓 */
let map = new Map();
let shown = new WeakMap();  /* テキストノード → 元の字（外したときに戻す） */
let observer = null;
let pending = false;

function styleNode(id) {
  let n = document.getElementById(id);
  if (!n) {
    n = document.createElement('style');
    n.id = id;
    document.head.appendChild(n);
  }
  return n;
}

function replaceIn(root) {
  if (!root || !root.querySelectorAll) return;
  const els = root.matches && root.matches(TEXT_SEL) ? [root] : [];
  root.querySelectorAll(TEXT_SEL).forEach(n => els.push(n));
  for (const e of els) {
    if (e.closest(SKIP_SEL)) continue;
    for (const t of e.childNodes) {
      if (t.nodeType !== 3) continue;
      const raw = t.nodeValue;
      /* 前に置き換えたノードで、字がそのままなら元の字から考え直す（外した・変えたときに戻すため）。
         app が字を書き替えていたら、その新しい字を元の字とみる */
      const rec = shown.get(t);
      let base = raw;
      if (rec && raw === rec.set) base = rec.base;
      const key = base.trim();
      const to = key ? map.get(key) : undefined;
      const next = to ? base.replace(key, to) : base;
      if (next !== raw) t.nodeValue = next;
      if (to) shown.set(t, { base, set: next });
      else shown.delete(t);
    }
  }
}

function sweep() {
  pending = false;
  if (!started || typeof document === 'undefined') return;
  if (observer) observer.disconnect();
  try { replaceIn(document.body); } catch (e) { /* 置き換えで画面を止めない */ }
  if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function schedule() {
  if (pending) return;
  pending = true;
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(sweep);
}

/* 保存してある変更を当て直す（設定で変えたとき・起動したとき） */
export function applyLocalMods(list) {
  if (typeof document === 'undefined' || !started) return;
  const mods = disabled ? [] : (list || loadMods());
  const st = styleNode(STYLE_ID);
  st.textContent = combinedCss(mods);     /* textContent で入れる（HTML として読まない） */
  st.disabled = paused;
  styleNode(GUARD_ID).textContent = mods.some(m => m.on && m.css) ? GUARD_CSS : '';
  /* 守りは後ろに置く（同じ強さなら後ろが勝つ） */
  document.head.appendChild(document.getElementById(GUARD_ID));
  const prev = map;
  map = textMap(mods);
  if (map.size || prev.size) schedule();
}

/* 設定を開いている間は CSS を止める（設定の画面は変えない） */
export function pauseLocalMods(on) {
  paused = !!on;
  if (typeof document === 'undefined') return;
  const st = document.getElementById(STYLE_ID);
  if (st) st.disabled = paused;
}

export function localModsDisabled() { return disabled; }

/* 起動のとき1回。サーバーなし版だけ呼ぶ（js/app.js）。
   -> { versionChanged }（入れている変更が前の版で作られていたら true。app.js が知らせる） */
export function startLocalMods(ver) {
  if (started || typeof document === 'undefined') return { versionChanged: false };
  started = true;
  try { disabled = /(?:^|[?&#])nolocal\b/.test(location.search + location.hash); } catch (e) { disabled = false; }
  /* 試しのまま読み直された変更は外す（崩れて「残す」を押せなかったときも、開き直せば戻る） */
  let versionChanged = false;
  const before = loadMods();
  let list = dropTrials(before);
  if (ver) { const r = markVersion(list, ver); versionChanged = r.changed; list = r.list; }
  if (JSON.stringify(list) !== JSON.stringify(before)) saveMods(list);
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => { if (map.size) schedule(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  applyLocalMods();
  window.addEventListener(LOCALMOD_EVENT, () => applyLocalMods());
  /* ほかの窓で変えたとき */
  window.addEventListener('storage', (ev) => { if (ev.key === LOCALMOD_KEY) applyLocalMods(); });
  return { versionChanged: versionChanged && !disabled };
}
