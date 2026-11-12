/* tests/regions.test.mjs が場面ごとに別の node で走らせる（sync.js・store.js は読み込んだ時点の海で決まるため）。
   引数: JSON { ls: {キー: 値}, server: { space, spaces? } }。偽の localStorage と fetch で sync.js を開き、
   要求の一覧と、そのあとの localStorage を JSON で1行出す。データはすべて架空。 */

const arg = JSON.parse(process.argv[2]);
const mem = new Map(Object.entries(arg.ls || {}));
globalThis.localStorage = {
  getItem(k) { const s = String(k); return mem.has(s) ? mem.get(s) : null; },
  setItem(k, v) { mem.set(String(k), String(v)); },
  removeItem(k) { mem.delete(String(k)); },
  clear() { mem.clear(); },
  key(i) { const ks = Array.from(mem.keys()); return i < ks.length ? ks[i] : null; },
  get length() { return mem.size; },
};
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ method: init.method, url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  const reply = (status, obj) => ({ status, json: async () => obj });
  if (String(url).endsWith('/api/spaces')) return reply(200, { spaces: (arg.server && arg.server.spaces) || [] });
  if (init.method === 'GET') return reply(200, { space: (arg.server && arg.server.space) || 'me', version: 0, data: null, minSchema: 1 });
  return reply(200, { version: 1 });
};
const { store } = await import('../../js/store.js');
const { sync } = await import('../../js/sync.js');
await new Promise(r => setTimeout(r, 300));
const out = {
  space: store.space(), region: sync.region(), state: sync.status().state, ready: sync.ready(),
  configureLocal: sync.region().kind === 'local' ? sync.configure('https://x.test', 't') : null,
  calls, ls: Object.fromEntries(mem),
};
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
