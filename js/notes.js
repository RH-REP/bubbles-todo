/* 泡ごとの「ひとこと」（Issue #25。#19 から分けた）。DOM も通信も触らない、ただの計算。
   store.js（記録を持つ側）と bubble.js（盤の「ひとこと」の面）とテスト（tests/notes.test.mjs）が使う。

   ■ 何のためか
   共同 TODO（人を招く海）で「ここまでやった」「詰まっている」を伝える道が、泡の名前と本文の
   書き換えしか無かった。書き換えると、誰がいつ書いたかが残らず、相手の書いたものを上書きする。
   ひとことは、泡ごとに積む短い書き込み（書いた人・時刻・短い文）。本文を汚さずに進捗を残す。

   ■ 記録の形（保存データの notes 欄。1件 = 1つの記録）
     { id, todo, at, by, dev, text }      gone: 1 が付いたら消したもの（text は空）
       id   … 'n' + 時刻 + 乱数。端末をまたいでも重ならない
       todo … どの泡のひとことか（todo の id）
       at   … 書いた時刻 epoch ms
       by   … 書いた人の名前（この端末の設定。初めはパスキーの名前）。空なら名前なし
       dev  … 書いた端末の印（ランダム。localStorage の 'bubble_todo_device'）。
              消せるのは自分の端末で書いたものだけ、の見分けに使う
   合わせ方は merge.js の1件ずつの記録（鍵は note:<id>）。**書き換えはしない**——
   足すのと、消した印（gone）を付けるのだけ。消しても記録は残り「（消した）」と出る。

   ■ 新しいひとことの点
   この端末で最後に開いた時刻を泡ごとに覚え（'bubble_todo_notes_seen_<海>'）、
   それより新しい、ほかの端末のひとことがあれば泡に小さな点を出す。数は出さない。
   覚えを持たない端末（この版を初めて開いた）は、開いた時刻から数える（前からあるものに点を付けない）。

   ■ 置き場
   その海の記録と同じ所（自分のサーバー）。新しい送り先は足していない。
   中身は泡の本文と同じ扱い（自分のサーバーに平文で置く）。

   ■ 海のチャット（サーバーあり版。2026-11-11 Issue #42。#37 の作る順の 3）
   泡に付かない、海ごとのメッセージ。形はひとことと同じで、todo に泡でない宛先 CHAT_TODO を入れる。
   同じ notes 欄・同じ鍵（note:<id>）なので、合わせ方・サーバーへの写し・CSV・消し方はひとことのまま。
   新しい欄を足さないのは、前の版の端末も notes をそのまま合わせて残すため（新しい頂上の欄だと、
   前の版が合わせるたびに自分の古い写しで上書きし、印を落とす）。泡の id は 'b' で始まるので重ならない。 */

export const NOTE_MAX = 280;      /* 1件の字数の上限 */
export const BY_MAX = 20;         /* 名前の字数の上限 */
const DEVICE_KEY = 'bubble_todo_device';
const NAME_KEY = 'bubble_todo_note_name';
const SEEN_HEAD = 'bubble_todo_notes_seen_';

function chars(s) { return Array.from(String(s == null ? '' : s)); }

/* 前後の空白を落とし、上限で切る。改行は残す（3つ以上続く空行は2つにまとめる） */
export function cleanNote(text) {
  const t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return chars(t).slice(0, NOTE_MAX).join('');
}

export function cleanBy(name) {
  return chars(String(name == null ? '' : name).replace(/\s+/g, ' ').trim()).slice(0, BY_MAX).join('');
}

export function noteId(now, rnd) {
  const r = typeof rnd === 'number' ? rnd : Math.random();
  return 'n' + Math.floor(now).toString(36) + Math.floor(r * 1e9).toString(36);
}

/* 1件を読める形にする。読めないものは null */
export function normalizeNote(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !r.id || typeof r.todo !== 'string' || !r.todo) return null;
  const at = Number(r.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const out = { id: r.id, todo: r.todo, at, by: cleanBy(r.by), dev: typeof r.dev === 'string' ? r.dev : '' };
  if (r.gone) { out.text = ''; out.gone = 1; }
  else {
    out.text = cleanNote(r.text);
    if (!out.text) return null;
  }
  return out;
}

export function normalizeNotes(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  arr.forEach(r => {
    const n = normalizeNote(r);
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
  });
  return out.sort(byTime);
}

/* 時刻順（古い順）。同じ時刻は id で決める（どの端末でも同じ並びにするため） */
export function byTime(a, b) {
  return (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/* その泡のひとこと（古い順の写し） */
export function notesFor(list, todoId) {
  return (Array.isArray(list) ? list : []).filter(n => n.todo === todoId).sort(byTime).map(n => ({ ...n }));
}

/* 海のチャットの宛先（泡の id とは重ならない）と、その一覧（古い順の写し） */
export const CHAT_TODO = '~chat';
export function chatFor(list) { return notesFor(list, CHAT_TODO); }

/* 新しい1件。text が空なら null */
export function makeNote(todoId, text, by, dev, now, rnd) {
  const t = cleanNote(text);
  if (!t || typeof todoId !== 'string' || !todoId) return null;
  return { id: noteId(now, rnd), todo: todoId, at: now, by: cleanBy(by), dev: String(dev || ''), text: t };
}

/* 消してよいか。自分の端末で書いた、まだ消していないもの */
export function canRemove(note, dev) {
  return !!(note && !note.gone && dev && note.dev === dev);
}

/* 点を出すか。seenAt より新しい、ほかの端末の、消していないひとことがあれば true */
export function hasUnseen(notes, seenAt, dev) {
  const s = Number(seenAt) || 0;
  return (Array.isArray(notes) ? notes : []).some(n => !n.gone && n.at > s && n.dev !== dev);
}

/* いちばん新しい時刻（消したものも含む）。開いたときに「ここまで読んだ」として覚える */
export function latestAt(notes) {
  return (Array.isArray(notes) ? notes : []).reduce((m, n) => Math.max(m, n.at), 0);
}

/* ---------- この端末の覚え（localStorage。サーバーへは送らない） ---------- */

function ls() { try { return globalThis.localStorage || null; } catch (e) { return null; } }

/* この端末の印。無ければ作って覚える */
export function deviceId() {
  const s = ls();
  try {
    const v = s && s.getItem(DEVICE_KEY);
    if (v && /^[a-z0-9]{6,40}$/.test(v)) return v;
    const id = 'd' + Math.floor(Date.now()).toString(36) + Math.floor(Math.random() * 1e12).toString(36);
    if (s) s.setItem(DEVICE_KEY, id);
    return id;
  } catch (e) { return ''; }
}

/* ひとことに付ける名前。設定していなければ、パスキーの名前（招待で付いた名前） */
export function noteName() {
  const s = ls();
  try {
    const v = s && s.getItem(NAME_KEY);
    if (v !== null && v !== undefined) return cleanBy(v);
    const c = JSON.parse((s && s.getItem('bubble_todo_sync')) || 'null');
    return cleanBy(c && c.sessionName);
  } catch (e) { return ''; }
}
export function setNoteName(name) {
  const s = ls();
  try { if (s) s.setItem(NAME_KEY, cleanBy(name)); } catch (e) { /* 覚えられなくても書ける */ }
  return cleanBy(name);
}

/* 泡ごとの「最後に開いた時刻」。{ since, at: { [todoId]: ms } } */
function readSeen(space) {
  const s = ls();
  try {
    const o = JSON.parse((s && s.getItem(SEEN_HEAD + space)) || 'null');
    if (o && typeof o === 'object' && Number(o.since) > 0) {
      return { since: Number(o.since), at: (o.at && typeof o.at === 'object') ? o.at : {} };
    }
  } catch (e) { /* 読めなければ作り直す */ }
  const fresh = { since: Date.now(), at: {} };
  try { if (s) s.setItem(SEEN_HEAD + space, JSON.stringify(fresh)); } catch (e) { /* 覚えられなくても動く */ }
  return fresh;
}
export function seenAt(space, todoId) {
  const o = readSeen(space);
  return Math.max(o.since, Number(o.at[todoId]) || 0);
}
export function markSeen(space, todoId, at) {
  const s = ls();
  const o = readSeen(space);
  const n = Number(at) || 0;
  if ((Number(o.at[todoId]) || 0) >= n) return;
  o.at[todoId] = n;
  try { if (s) s.setItem(SEEN_HEAD + space, JSON.stringify(o)); } catch (e) { /* 覚えられなくても動く */ }
}
