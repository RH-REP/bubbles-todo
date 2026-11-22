/* 泡を別の海へ移す（2026-11-18。モック 6「移すとき」）。長押しのメニューの［海を移す…］から開く。
   見える人が変わることを必ず出して確かめる:
     ・個人の海・この端末の海 → 共有の海 … 新しく見える人の名前
     ・共有の海 → 個人の海・この端末の海 … ほかの人の画面から消えること
     ・共有の海 → 別の共有の海 … 新しく見える人と、見えなくなる人
   見るだけ（viewer）の海へは移せない（書けないため）。移すのは store.moveOut（移す先の箱に写し、ここは墓石） */
import { store } from './store.js';
import { allSeas } from './regions.js';
import { meInfo, serverLogin, myRole } from './me.js';
import { toast } from './ui.js';

/* 海の見える人（自分以外の名前）。共有の海でなければ [] */
function othersOf(sea) {
  const me = meInfo();
  const L = serverLogin();
  if (!me || !L || !sea || sea.rid !== L.rid || sea.personal) return [];
  const s = me.seas.find(x => x && x.id === sea.id && x.kind === 'shared');
  return s && Array.isArray(s.members) ? s.members.filter(m => m.id !== me.user.id).map(m => m.name || m.id) : [];
}

function onServer(sea) {
  const L = serverLogin();
  return !!(L && sea && sea.rid === L.rid);
}

/* 移せる先の海 */
export function moveTargets(id) {
  if (!id || store.readOnly()) return [];
  return allSeas().filter(s => s.id !== store.space() && myRole(s.id) !== 'viewer');
}

/* 確かめの文 */
export function visibilityNote(from, to) {
  const a = othersOf(from);
  const b = othersOf(to);
  const gain = b.filter(n => a.indexOf(n) < 0);
  const lose = a.filter(n => b.indexOf(n) < 0);
  const lines = [];
  if (gain.length) lines.push(gain.join('・') + ' にも見えるようになります');
  if (lose.length) lines.push(lose.join('・') + ' の画面から消えます');
  if (!onServer(to)) lines.push('この端末だけの海です（ほかの端末・ほかの人には届きません）');
  else if (to.personal && !lose.length) lines.push('あなただけの海です');
  if (!lines.length) lines.push('見える人は変わりません');
  return lines;
}

export function openMoveSea(id) {
  const t = store.get(id);
  if (!t) return;
  const here = allSeas().find(s => s.id === store.space()) || { id: store.space(), name: 'この海' };
  const back = document.createElement('div');
  back.className = 'space-sheet-back';
  const box = document.createElement('div');
  box.className = 'space-sheet move-sheet';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '海を移す');
  box.dataset.name = '海を移す';
  back.appendChild(box);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', ev => { if (ev.target === back) close(); });

  const h = document.createElement('h4');
  h.textContent = '「' + t.text + '」を移す';
  const list = () => {
    box.textContent = '';
    box.appendChild(h);
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = here.name + ' から、どの海へ移すか';
    box.appendChild(p);
    moveTargets(id).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn move-to';
      b.textContent = (othersOf(s).length ? '👥 ' : '') + s.name;
      b.addEventListener('click', () => confirmTo(s));
      box.appendChild(b);
    });
    box.appendChild(row([['やめる', close]]));
  };
  const confirmTo = (to) => {
    box.textContent = '';
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = here.name + ' → ' + to.name;
    box.appendChild(p);
    visibilityNote(here, to).forEach(line => {
      const q = document.createElement('p');
      q.className = 'move-note';
      q.dataset.name = '見える人の変わり';
      q.textContent = line;
      box.appendChild(q);
    });
    box.appendChild(row([['移す', () => {
      if (!store.moveOut(id, to.id)) { toast('移せなかった'); return; }
      close();
      toast('「' + t.text + '」を ' + to.name + ' へ移した（移した先とは、開いたときにやりとりする）');
    }, true], ['やめる', close]]));
  };
  function row(btns) {
    const r = document.createElement('div');
    r.className = 'space-sheet-row';
    btns.forEach(([label, fn, main]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = main ? 'btn main' : 'btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      r.appendChild(b);
    });
    return r;
  }
  list();
  document.body.appendChild(back);
  const first = box.querySelector('button');
  if (first) first.focus();
}
