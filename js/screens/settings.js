/* 設定。タグの管理・音のオン/オフ・プロトタイプ確認用の操作。

   タグを置く向きは上・左・右の3つしかなく、タグは何個でも作れる。
   だから「どのタグをどの向きに置くか」を決める場所が要る。それがここ。
   本番に入れるつもりのものは「タグ」と「音」で、いちばん下の3つは確認用。 */

import { el, toast, escapeHtml } from '../ui.js';
import { store } from '../store.js';
import { isOn, setOn } from '../sound.js';

/* ユーザーが選べる向きは左右だけ。中央は「ぜんぶ」なので割り当てない。
   上（長期保留）と下（完了）は固有枠なのでここに出さない
   ——出しても store.setTagDir が受け付けない */
const DIRS = [
  { id: 'left',  label: '左' },
  { id: 'right', label: '右' },
];

/* 固有枠に入っているタグの、向きの見出し。選び欄の代わりにこれを出す */
const FIXED_LABEL = { up: '上', down: '下', left: '左', right: '右' };

/* そのタグの向きが固定されているか。store がまだ答えられない版では null */
function fixedDirOf(id) {
  if (typeof store.tagDirFixed !== 'function') return null;
  try { return store.tagDirFixed(id) || null; } catch (err) { return null; }
}

/* 新しいタグに割り当てる色は **store が持っている**（store.tagPalette）。
   以前はここにも別のパレットが直書きしてあって、store の配り先と二重管理だった。
   同じ「タグの色」を2か所に持つと、片方だけ直したときに
   「設定から作ったタグ」と「色を省いて作ったタグ」で色の系統がずれる。
   store 側は保存データの正規化でも同じ配列を使うので、寄せるならそちら。

   tagPalette() がまだ無い版の store でも設定画面ごと落ちないように、
   無ければ空を返す（空なら色を指定せずに addTag し、store の配り先に任せる）。 */
const hasTags = () => typeof store.tags === 'function';
const paletteOf = () => (typeof store.tagPalette === 'function' ? store.tagPalette() : []);

const SEED = [
  '灯油を買う', '確定申告の資料をまとめる', '歯医者を予約',
  'あの論文を読む', '傘を修理に出す', '写真のバックアップ',
];

const ACTIONS = [
  {
    label: 'サンプルを6件入れる',
    on: () => { store.seed(SEED); toast('サンプルを入れた'); },
  },
  {
    label: '全部消す',
    on: () => {
      const before = store.all();
      if (!before.length) { toast('消すものが無い'); return; }
      store.clear();
      toast(before.length + '件を消した', {
        label: '元に戻す',
        on: () => { before.forEach(t => store.add(t.text, { fx: t.fx, fy: t.fy, today: t.today })); },
      });
    },
  },
  {
    label: '記録ごと初期化',
    on: () => {
      store.wipe();
      toast('todo も記録も消して、初期状態に戻した');
    },
  },
];

export default {
  id: 'settings',
  label: '設定',
  icon: '⚙',

  mount(pane) {
    const box = el('div', 'stub');
    /* 見出しは置かない（レビューの指摘）。ほかの画面はどれも見出しを持たない。
       いまどこに居るかは、右上の歯車が✕に変わっていることが言う */

    /* --- ふりかえりへ（利用者の指示：ふりかえりは設定の中に）---
       いちばん上に置く。設定の中身（タグ・音・確認用）は「決める」もので、
       ふりかえりは「見る」もの。混ぜず、先頭に1行だけ置いて別の画面へ渡す。 */
    const go = el('button', 'gorow');
    go.type = 'button';
    const goL = el('span', 'nm', 'ふりかえり');
    const goS = el('span', 'sub', '記録を眺める');
    const goT = el('span', 'tx');
    goT.appendChild(goL);
    goT.appendChild(goS);
    go.appendChild(goT);
    const goA = el('span', 'ar', '›');
    goA.setAttribute('aria-hidden', 'true');
    go.appendChild(goA);
    go.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'review' } }));
    });
    box.appendChild(go);

    /* --- タグ --- */
    /* store 側のタグ API がまだ無い版でも設定画面ごと落ちないよう、有無を見る */
    if (hasTags()) {
      const tagBox = el('div', 'tags');
      tagBox.appendChild(el('h3', null, 'タグ'));
      tagBox.appendChild(el(
        'p', 'note',
        '海の左と右に置けるのは1つずつ。上（長期保留）と下（完了）は動かせない。'
        + '中央の海には、どのタグのものも浮かぶ。'
      ));
      const list = el('div', 'taglist');
      tagBox.appendChild(list);

      /* 新しいタグ */
      const addRow = el('form', 'tagadd');
      const nameIn = document.createElement('input');
      nameIn.type = 'text';
      nameIn.placeholder = 'タグの名前';
      nameIn.setAttribute('aria-label', '新しいタグの名前');
      const addBtn = el('button', 'btn', 'タグを足す');
      addBtn.type = 'submit';
      addRow.appendChild(nameIn);
      addRow.appendChild(addBtn);
      addRow.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = nameIn.value.trim();
        if (!name) return;
        /* 色は store のパレットから、まだ使われていないものを順に取る。
           全部使われていたら位置で決める。パレットが取れない版の store なら
           色を渡さず、store 側の配り先に任せる（undefined は addTag が弾いて配り直す） */
        const pal = paletteOf();
        const used = new Set(store.tags().map(t => String(t.color || '').toLowerCase()));
        const color = pal.length
          ? (pal.find(c => !used.has(c)) || pal[store.tags().length % pal.length])
          : undefined;
        store.addTag(name, color);
        nameIn.value = '';
        renderTags(list);
      });
      tagBox.appendChild(addRow);

      box.appendChild(tagBox);
      this._taglist = list;
      renderTags(list);
    }

    /* --- 音 --- */
    const soundRow = el('label', 'setrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isOn();
    cb.addEventListener('change', () => {
      setOn(cb.checked);
      toast(cb.checked ? '完了の音を鳴らす' : '完了の音を鳴らさない');
    });
    soundRow.appendChild(cb);
    soundRow.appendChild(el('span', null, '完了したときに音を鳴らす'));
    box.appendChild(soundRow);
    box.appendChild(el(
      'p', 'note',
      '鳴るのは自分で「完了」を押したときだけ。はじめたときには鳴らない。'
      + '端末が消音のときに鳴るかどうかは、機種によって違う。'
    ));

    /* --- プロトタイプ操作 --- */
    const proto = el('div', 'proto');
    proto.appendChild(el('h3', null, 'プロトタイプ操作'));
    const row = el('div', 'row');
    ACTIONS.forEach(a => {
      const btn = el('button', 'btn', escapeHtml(a.label));
      btn.type = 'button';
      btn.addEventListener('click', a.on);
      row.appendChild(btn);
    });
    proto.appendChild(row);
    proto.appendChild(el(
      'p', 'note',
      'この操作は確認用で、本番には入れない。'
      + 'バブルの「消す」は画面から見えなくするだけで、データは記録として残り続ける。'
      + 'それに対して「全部消す」は、その残っているぶんまで本当に消す。'
      + '空の画面を見たいときは「記録ごと初期化」を使う。'
    ));
    box.appendChild(proto);

    pane.appendChild(box);
    this._cb = cb;
  },

  /* 音もタグも別のところから変わりうるので、開くたびに読み直す */
  onShow() {
    if (this._cb) this._cb.checked = isOn();
    if (this._taglist) renderTags(this._taglist);
  },
};

/* タグの一覧。1行 = 色 / 名前 / 置く向き / 消す。
   特別なタグ（今日・きっかけ・すきま・完了）は名前を変えられず、消せない。 */
function renderTags(list) {
  if (!hasTags()) return;
  list.replaceChildren();

  store.tags().forEach(tag => {
    const row = el('div', 'tagrow');

    const dot = el('span', 'tagdot');
    dot.style.setProperty('--tc', tag.color || 'var(--text-2)');
    dot.setAttribute('aria-hidden', 'true');
    row.appendChild(dot);

    /* 名前。特別なタグは読むだけ */
    if (tag.special) {
      const nm = el('span', 'tagname is-fixed');
      nm.textContent = tag.name;                   /* innerHTML には入れない */
      row.appendChild(nm);
    } else {
      const nm = document.createElement('input');
      nm.type = 'text';
      nm.className = 'tagname';
      nm.value = tag.name;
      nm.setAttribute('aria-label', tag.name + ' の名前');
      const save = () => {
        const v = nm.value.trim();
        if (!v) { nm.value = tag.name; return; }   /* 空の名前は作らせない */
        if (v !== tag.name) store.renameTag(tag.id, v);
      };
      nm.addEventListener('blur', save);
      nm.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') nm.blur(); });
      row.appendChild(nm);
    }

    /* 固有枠のタグは向きを選ばせない。**選べない欄を灰色で出すのではなく、
       欄そのものを出さない**——押せない的を置くと、押せる的と見分けがつかない。
       代わりに「どこに在るか」だけを字で置く（消えると場所が分からなくなる）。 */
    const fixed = fixedDirOf(tag.id);
    if (fixed) {
      const fx = el('span', 'tagdir is-fixed', FIXED_LABEL[fixed] || fixed);
      fx.setAttribute('aria-label', tag.name + ' は ' + (FIXED_LABEL[fixed] || fixed) + ' の海（動かせない）');
      row.appendChild(fx);
    } else {
      /* 置く向き。1向き1タグなので、選ぶと先客は外れる */
      const sel = document.createElement('select');
      sel.className = 'tagdir';
      sel.setAttribute('aria-label', tag.name + ' を置く向き');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '置かない';
      sel.appendChild(none);
      DIRS.forEach(d => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.label;
        sel.appendChild(o);
      });
      sel.value = tag.dir || '';
      sel.addEventListener('change', () => {
        const taken = sel.value ? store.tagDir(sel.value) : null;
        store.setTagDir(tag.id, sel.value || null);
        if (taken && taken.id !== tag.id) toast('「' + taken.name + '」は置かないことにした');
        renderTags(list);                            /* 押し出された行も描き直す */
      });
      row.appendChild(sel);
    }

    /* 消す。特別なタグは消せないのでボタンごと出さない */
    if (!tag.special) {
      const del = el('button', 'tagdel', '消す');
      del.type = 'button';
      del.setAttribute('aria-label', tag.name + ' を消す');
      del.addEventListener('click', () => {
        store.removeTag(tag.id);
        toast('「' + tag.name + '」を消した（付いていたものからタグが外れた）');
        renderTags(list);
      });
      row.appendChild(del);
    }

    list.appendChild(row);
  });
}
