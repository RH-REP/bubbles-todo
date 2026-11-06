#!/usr/bin/env node
/* 枝の点検（Issue #20）。main 以外の枝を並べ、どう片付けるかの目安を出す。
   書き換えはしない（消す・取り込むは README「枝の扱い」の手順で人かセッションが行う）。

     node tools/branches.mjs          … origin を fetch してから点検
     node tools/branches.mjs --no-fetch

   目安:
     取り込み済み … main に全部入っている。archive/<枝> の札を付けて消してよい
     未取り込み   … main に無いコミットがある。取り込むか、札を付けて消すかを決める
*/
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

export function classify(ahead, behind) {
  if (ahead === 0) return "取り込み済み";
  return behind === 0 ? "未取り込み（main から先に進んだだけ。早送りで取り込める）" : "未取り込み";
}

function main() {
  if (!process.argv.includes("--no-fetch")) {
    try { git("fetch", "--prune", "-q", "origin"); } catch { console.error("fetch できなかった（手元の情報で点検する）"); }
  }
  const refs = git("for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin")
    .split("\n").filter(Boolean)
    .filter(r => !/^(origin\/)?(main|HEAD)$/.test(r) && r !== "origin");
  const names = [...new Set(refs.map(r => r.replace(/^origin\//, "")))].sort();
  if (!names.length) { console.log("main 以外の枝は無い"); return; }
  for (const n of names) {
    const ref = refs.includes(`origin/${n}`) ? `origin/${n}` : n;
    const ahead = Number(git("rev-list", "--count", `main..${ref}`));
    const behind = Number(git("rev-list", "--count", `${ref}..main`));
    const last = git("log", "-1", "--format=%cs %s", ref).slice(0, 90);
    const where = [refs.includes(n) && "手元", refs.includes(`origin/${n}`) && "origin"].filter(Boolean).join("・");
    console.log(`${n}（${where}）: main より先 ${ahead}・遅れ ${behind} → ${classify(ahead, behind)}\n  最後: ${last}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
