#!/usr/bin/env node
/* Claude Code のセッション記録から「問いのカード」の泡を作る（2026-11-07。利用者の指示）。
   思いつきで調べたことを、あとで見返すため。標準モジュールだけで動き、LLM も呼ばないし、どこへも送らない。

   ■ 流れ
     1. list … 期間内のセッションのうち、まだカードにしていないものを候補として出す
     2. （会話の中で Claude が、候補ごとに「問い」1文と「次の一手」1文に書き直す。このスクリプトはしない）
     3. csv  … 書き直したカードの JSON を受け取り、Bubbles の CSV（設定の「書き出し・読み込み（CSV）」の「足す」で読む形）を書く

   ■ 使い方
     node tools/session-cards.mjs list [--since-days 7] [--projects-dir <dir>] [--state <path>] [--json]
     node tools/session-cards.mjs csv <cards.json> [--days 3] [--out <path>] [--state <path>] [--projects-dir <dir>]

     cards.json = [{ "sessionId": "…", "question": "問い", "next": "次の一手" }, { "sessionId": "…", "skip": true }, …]

   ■ セッション記録の読み方
     置き場は <projects-dir>/<フォルダ>/<sessionId>.jsonl（フォルダの直下だけ。subagents などの下は読まない）。1行1 JSON。
     題名 … type:"custom-title" の customTitle（複数あれば最後のもの）
     人の質問 … type:"user"・isSidechain:false・origin.kind:"human" の行の message.content（文字列か、type:"text" の text を連結）。
                <system-reminder> などの差し込みは取り除き、<command-name> などのタグで始まるもの・ツールの結果は数えない
     最初と最後の時刻 … 行の timestamp のいちばん古いものと新しいもの

   ■ 置き場（既定）
     状態ファイルと CSV は repo 直下の session_cards/（.gitignore で外す）。
     state.json = { [sessionId]: { state: "carded" | "skipped", at: ISO } } */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toCsv } from '../js/csvio.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIR = path.join(REPO, 'session_cards');
export const DEFAULT_STATE = path.join(DEFAULT_DIR, 'state.json');
export const DEFAULT_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const SHORT = 300;

/* ---------- 人の質問の取り出し ---------- */
/* 人の入力ではない差し込み（スラッシュコマンド・! の実行・通知など）の頭 */
const NOT_HUMAN = /^<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification|user-prompt-submit-hook)\b/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  /* tool_result・画像などは読まない */
  return content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n');
}

/* 1行（JSON の値）→ 人の質問の文。人の質問でなければ null */
export function humanText(o) {
  if (!o || o.type !== 'user' || o.isSidechain !== false) return null;
  if (!o.origin || o.origin.kind !== 'human') return null;
  const raw = textOf(o.message && o.message.content);
  /* 差し込み（<system-reminder>…</system-reminder>）は人の文の前後に付くことがあるので、先に取り除いてから頭を見る */
  const s = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!s || NOT_HUMAN.test(s)) return null;
  return s;
}

export function cut(s, n = SHORT) {
  const a = Array.from(String(s || ''));
  return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
}

/* セッション1つ（.jsonl のファイル）を読む。大きいファイル（数十 MB）もあるので1行ずつ読み、
   JSON は要る行だけ解く。-> { sessionId, title, project, firstQuestion, firstQuestionShort, questions, firstAt, lastAt, file } */
export async function readSession(file) {
  const out = {
    sessionId: path.basename(file, '.jsonl'),
    title: '',
    project: path.basename(path.dirname(file)),
    firstQuestion: '',
    firstQuestionShort: '',
    questions: 0,
    firstAt: null,
    lastAt: null,
    file,
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const m = /"timestamp":"([^"]+)"/.exec(line);
    if (m && !Number.isNaN(Date.parse(m[1]))) {
      if (!out.firstAt || m[1] < out.firstAt) out.firstAt = m[1];
      if (!out.lastAt || m[1] > out.lastAt) out.lastAt = m[1];
    }
    const isTitle = line.includes('"custom-title"');
    if (!isTitle && !line.includes('"type":"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') { out.title = o.customTitle; continue; }
    const q = humanText(o);
    if (q === null) continue;
    out.questions++;
    if (!out.firstQuestion) out.firstQuestion = q;
  }
  out.firstQuestionShort = cut(out.firstQuestion);
  return out;
}

/* <projects-dir>/<フォルダ>/<id>.jsonl の一覧（フォルダの直下だけ） */
function sessionFiles(projectsDir) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsDir, d.name);
    let fs2 = [];
    try { fs2 = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const f of fs2) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, f.name);
      try { out.push({ file, mtime: fs.statSync(file).mtimeMs }); } catch (e) { /* 消えた */ }
    }
  }
  return out;
}

/* ---------- 状態ファイル ---------- */
export function readState(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

function writeState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/* ---------- list ---------- */
/* 最終更新が期間内で、状態ファイルに無いセッションを新しい順に。人の質問が0件のものは出さない */
export async function listCandidates({ projectsDir = DEFAULT_PROJECTS, statePath = DEFAULT_STATE, sinceDays = 7, now = Date.now() } = {}) {
  const st = readState(statePath);
  const from = now - Number(sinceDays) * 86400000;
  const files = sessionFiles(projectsDir)
    .filter(f => f.mtime >= from && !st[path.basename(f.file, '.jsonl')])
    .sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of files) {
    const s = await readSession(f.file);
    if (!s.questions) continue;
    s.updatedAt = new Date(f.mtime).toISOString();
    delete s.file;
    out.push(s);
  }
  return out;
}

/* ---------- csv ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* 今日（端末の日付。store.js と同じ0時の境目）に n 日足した日付キー 'YYYY-MM-DD'。正午に寄せてから動かす（夏時間でも日が飛ばない） */
export function dayAfter(now, n) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + (Math.floor(Number(n)) || 0));
  return ymd(d);
}

/* セッション id から決まる泡の id。同じセッションは何度書いても同じ id */
export function cardId(sessionId) {
  return 'cs-' + String(sessionId).replace(/-/g, '').slice(0, 12);
}

/* 0..1 の決まった値（同じ id なら同じ漂う位置） */
function frac(s, salt) {
  let h = 2166136261 >>> 0;
  for (const c of salt + s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

/* 泡（todo の記録）。欄は store.js の add() と同じで、normalizeTodo を通ってもそのまま残る形 */
export function makeTodo(session, card, { now = Date.now(), days = 3 } = {}) {
  const id = cardId(session.sessionId);
  const detail = [
    'Claude セッション: ' + (session.title || '（題名なし）'),
    '最初の質問: ' + cut(session.firstQuestion),
    'session: ' + session.sessionId,
  ].join('\n');
  return {
    id,
    text: String(card.question).trim(),
    days: [],
    hold: true,
    holdUntil: dayAfter(now, days),
    createdAt: now,
    fx: Math.round((0.2 + frac(id, 'x') * 0.6) * 1000) / 1000,
    fy: Math.round((0.2 + frac(id, 'y') * 0.5) * 1000) / 1000,
    slots: [],
    anchors: [],
    anchorAt: {},
    started: {},
    firstStep: String(card.next || '').trim(),
    url: '',
    detail: detail.trim(),
    gap: false,
    gapSlots: [],
    gapAt: {},
    plan: false,
    steps: [],
    draft: { did: '', next: '' },
    tags: [],
    done: false,
    doneAt: null,
    trashed: false,
    trashedAt: null,
    fav: false,
    urgent: null,
    important: null,
  };
}

/* sessionId → ファイル（フォルダの直下から名前で探す。中身は読まない） */
function findSessionFile(projectsDir, sessionId) {
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch (e) { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(projectsDir, d.name, sessionId + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

export function csvFileNameFor(now) {
  const d = new Date(now);
  return `bubbles-sessions-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

/* カードの配列から CSV を書き、状態ファイルに足す。
   -> { out, carded: [id…], skipped: [sessionId…] }（泡が0件なら CSV は書かず out は null） */
export async function writeCards(cards, { projectsDir = DEFAULT_PROJECTS, statePath = DEFAULT_STATE, out, days = 3, now = Date.now() } = {}) {
  if (!Array.isArray(cards)) throw new Error('cards.json は配列にする');
  const todos = [], carded = [], skipped = [], problems = [];
  const seen = new Set();
  const prepared = [];
  for (const [i, c] of cards.entries()) {
    const sid = c && typeof c.sessionId === 'string' ? c.sessionId.trim() : '';
    if (!sid || !/^[\w-]+$/.test(sid)) { problems.push(`${i + 1} 件目: sessionId が無いか形が違う`); continue; }
    if (seen.has(sid)) { problems.push(`${i + 1} 件目: sessionId ${sid} が重なっている`); continue; }
    seen.add(sid);
    if (c.skip === true) { prepared.push({ sid, skip: true }); continue; }
    if (typeof c.question !== 'string' || !c.question.trim()) { problems.push(`${i + 1} 件目: question が空`); continue; }
    const file = findSessionFile(projectsDir, sid);
    if (!file) { problems.push(`${i + 1} 件目: セッション ${sid} の記録が見つからない`); continue; }
    prepared.push({ sid, card: c, file });
  }
  if (problems.length) throw new Error('cards.json を直す:\n  ' + problems.join('\n  '));

  for (const p of prepared) {
    if (p.skip) { skipped.push(p.sid); continue; }
    const s = await readSession(p.file);
    const t = makeTodo(s, p.card, { now, days });
    todos.push(t);
    carded.push(p.sid);
  }

  let outPath = null;
  if (todos.length) {
    const stamps = {};
    todos.forEach(t => { stamps['todo:' + t.id] = [now, 1]; });
    /* 並び（order の行）は importInto が読まない（今の端末の並びの後ろに足す）が、toCsv の形のまま残す */
    const csv = toCsv({ doc: { todos }, stamps }, 'me', now, undefined, 'Claude セッション');
    outPath = out || path.join(path.dirname(statePath), csvFileNameFor(now));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, csv);
  }

  const st = readState(statePath);
  const at = new Date(now).toISOString();
  carded.forEach(sid => { st[sid] = { state: 'carded', at }; });
  skipped.forEach(sid => { st[sid] = { state: 'skipped', at }; });
  if (carded.length || skipped.length) writeState(statePath, st);
  return { out: outPath, carded: todos.map(t => t.id), skipped };
}

/* ---------- コマンド ---------- */
function parseArgs(argv) {
  const opts = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(a + ' に値が無い');
      opts[a.slice(2)] = v; i++;
    } else rest.push(a);
  }
  return { opts, rest };
}

function expand(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function num(v, def, name) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} は 0 以上の数`);
  return n;
}

const USAGE = `使い方:
  node tools/session-cards.mjs list [--since-days 7] [--projects-dir <dir>] [--state <path>] [--json]
  node tools/session-cards.mjs csv <cards.json> [--days 3] [--out <path>] [--state <path>] [--projects-dir <dir>]`;

export async function main(argv) {
  const [cmd, ...args] = argv;
  const { opts, rest } = parseArgs(args);
  const projectsDir = expand(opts['projects-dir']) || DEFAULT_PROJECTS;
  const statePath = expand(opts.state) || DEFAULT_STATE;
  if (cmd === 'list') {
    const list = await listCandidates({ projectsDir, statePath, sinceDays: num(opts['since-days'], 7, 'since-days') });
    if (opts.json) { console.log(JSON.stringify(list, null, 2)); return 0; }
    if (!list.length) { console.log('候補なし'); return 0; }
    list.forEach((s, i) => {
      const d = new Date(s.lastAt || s.updatedAt);
      const when = `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;   /* 端末の時刻で */
      console.log(`${i + 1}. [${when}] ${s.title || '（題名なし）'}  （質問 ${s.questions} 件・${s.project}）`);
      console.log('   ' + s.sessionId);
      console.log('   ' + cut(s.firstQuestion.replace(/\s+/g, ' '), 120));
    });
    return 0;
  }
  if (cmd === 'csv') {
    if (!rest[0]) throw new Error('cards.json を渡す\n' + USAGE);
    const cards = JSON.parse(fs.readFileSync(expand(rest[0]), 'utf8'));
    const r = await writeCards(cards, {
      projectsDir, statePath, out: expand(opts.out), days: num(opts.days, 3, 'days'),
    });
    if (r.out) console.log(`泡 ${r.carded.length} 件の CSV: ${r.out}`);
    else console.log('泡にするものは無かった（CSV は書いていない）');
    if (r.skipped.length) console.log(`見送り ${r.skipped.length} 件を状態に記録した`);
    console.log(`状態: ${statePath}`);
    return 0;
  }
  console.log(USAGE);
  return cmd ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
    console.error(String((e && e.message) || e));
    process.exitCode = 1;
  });
}
