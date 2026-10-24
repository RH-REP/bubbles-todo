/* 設定。タグの管理・音のオン/オフ・サーバー・プロトタイプ確認用の操作。

   タグを置く向きは上・左・右の3つしかなく、タグは何個でも作れる。
   だから「どのタグをどの向きに置くか」を決める場所が要る。それがここ。
   本番に入れるつもりのものは「タグ」と「音」で、いちばん下の3つは確認用。 */

import { el, toast, escapeHtml } from '../ui.js';
import { store } from '../store.js';
import { isOn, setOn } from '../sound.js';
import { sync, checkUrl } from '../sync.js';
import { toCsv, readCsv, importInto, csvFileName } from '../csvio.js';

/* 海は横一列に並ぶようになった（利用者の指示：タグ付き海を10個まで）。
   前はここに「左／右／置かない」の選び欄があったが、10個に**向き**は無い。
   ここは「海にするか、しないか」だけを持つ。**並べ替えは海の引き**（長押し）にある
   ——順番はその場で見えているところで触るのが素直なので。 */

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

    /* --- 使い方（2026-10-23。利用者の指示：app の中から使い方の記事へ）---
       記事は docs/guide/index.html。同じ窓で開き、記事の上の「アプリへ戻る」で戻る
       （Android 版でも、別の窓を開かずに WebView の中で読める） */
    const help = el('button', 'gorow');
    help.type = 'button';
    const hpT = el('span', 'tx');
    hpT.appendChild(el('span', 'nm', '使い方'));
    hpT.appendChild(el('span', 'sub', '画面の見方・サーバーと共有の始め方'));
    help.appendChild(hpT);
    const hpA = el('span', 'ar', '›');
    hpA.setAttribute('aria-hidden', 'true');
    help.appendChild(hpA);
    help.addEventListener('click', () => {
      try { store.flush(); } catch (e) { /* 開くのは止めない */ }
      location.href = 'docs/guide/index.html';
    });
    box.appendChild(help);

    /* --- タグ --- */
    /* store 側のタグ API がまだ無い版でも設定画面ごと落ちないよう、有無を見る */
    if (hasTags()) {
      const tagBox = el('div', 'tags');
      tagBox.appendChild(el('h3', null, 'タグ'));
      tagBox.appendChild(el(
        'p', 'note',
        'タグは海にできる（横一列に並ぶ。10個まで）。並べ替えは海を長押しして引きから。'
        + '上（長期保留）と下（完了）は動かせない。'
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

    /* --- サーバー（複数の端末で同じ記録を使う）--- */
    box.appendChild(serverBox(this));

    /* --- 書き出し・読み込み（CSV。2026-10-24 利用者の指示：引っ越し）--- */
    box.appendChild(csvBox());

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
    if (this._server) this._server();
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
    } else if (typeof store.isSea === 'function') {
      /* 海にするか、しないか。並べ替えは海の引き（長押し）にある */
      const isSea = store.isSea(tag.id);
      const full = !isSea && typeof store.canBeSea === 'function' && !store.canBeSea(tag.id);
      const b = el('button', 'tagdir is-sea', isSea ? '海にしている' : (full ? 'いっぱい' : '海にする'));
      b.type = 'button';
      b.disabled = full;
      b.classList.toggle('is-on', isSea);
      b.setAttribute('aria-pressed', isSea ? 'true' : 'false');
      b.setAttribute('aria-label', tag.name + (isSea ? ' を海から降ろす' : ' を海にする'));
      b.addEventListener('click', () => {
        if (isSea) {
          store.removeSea(tag.id);
          toast('「' + tag.name + '」を海から降ろした（タグは残る）', {
            label: '元に戻す', on: () => store.addSea(tag.id),
          });
        } else if (!store.addSea(tag.id)) {
          toast('海は ' + (store.MAX_SEAS || 10) + ' 個まで');
        }
        renderTags(list);
      });
      row.appendChild(b);
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

/* サーバーの欄。住所と合言葉を入れて繋ぐ。空にして繋ぐと、繋がない（記録は手元に残る）。
   状態の字は「繋いでいない／合わせている／合わせた（時刻）／届かない（わけ）」だけ。
   件数や「未送信 n 件」は出さない（分母のある数字を作らない、と同じ筋） */
const STATE_TEXT = {
  off: '繋いでいない（この端末の中だけに記録している）',
  idle: '繋ぐところ',
  syncing: '合わせている…',
};
function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function serverBox(screen) {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, 'サーバー'));
  wrap.appendChild(el(
    'p', 'note',
    '自分で立てたサーバーに繋ぐと、ほかの端末と同じ記録を使える。'
    + '食い違ったときは、項目ごとに新しく書き換えたほうが残る。'
    + '届かない間もこの端末には記録され、届いたら合わせる。'
    + '共有の合言葉も入れると、それを知っている人と共有の海を使える（左上の ≡ の引き出しで切り替える）。'
  ));

  const form = el('form', 'tagadd');
  form.style.flexWrap = 'wrap';
  const urlIn = document.createElement('input');
  urlIn.type = 'text';
  urlIn.inputMode = 'url';
  urlIn.autocomplete = 'off';
  urlIn.spellcheck = false;
  urlIn.placeholder = '住所（例 https://名前.tailxxxx.ts.net）';
  urlIn.setAttribute('aria-label', 'サーバーの住所');
  const tokIn = document.createElement('input');
  tokIn.type = 'password';
  tokIn.autocomplete = 'off';
  tokIn.placeholder = '自分の合言葉（個人の記録。token.txt）';
  tokIn.setAttribute('aria-label', 'サーバーの合言葉');
  /* 共有の合言葉（2026-10-23）。空なら共有は使わない。自分の合言葉と取り違えたら、
     サーバーが返す置き場の名前で sync.js が気づいて送らない */
  const shareIn = document.createElement('input');
  shareIn.type = 'password';
  shareIn.autocomplete = 'off';
  shareIn.placeholder = '共有の合言葉（招かれた人のぶん。空なら使わない）';
  shareIn.setAttribute('aria-label', '共有の合言葉');
  urlIn.style.flexBasis = '100%';
  tokIn.style.flexBasis = '100%';
  const go = el('button', 'btn', '繋ぐ');
  go.type = 'submit';
  form.appendChild(urlIn);
  form.appendChild(tokIn);
  form.appendChild(shareIn);
  form.appendChild(go);
  wrap.appendChild(form);

  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  /* このページを配っているサーバー（server.py で開いたとき）。Pages や file では出さない。
     Android 版（Capacitor）のページは https://localhost で、サーバーではないので出さない
     （エミュレーターから Mac へは adb reverse を通して http://localhost:<port>。README「サーバーで記録を共有する」） */
  if (/^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname) && !window.Capacitor) {
    const here = el('button', 'btn', 'このページのサーバー');
    here.type = 'button';
    here.addEventListener('click', () => { urlIn.value = location.origin; tokIn.focus(); });
    row.appendChild(here);
  }
  const now = el('button', 'btn', '今すぐ合わせる');
  now.type = 'button';
  now.addEventListener('click', () => sync.syncNow());
  const off = el('button', 'btn', '繋がない');
  off.type = 'button';
  off.addEventListener('click', () => {
    sync.configure('', '', '');
    urlIn.value = ''; tokIn.value = ''; shareIn.value = '';
    toast('サーバーに繋がないようにした（記録はこの端末に残っている）');
    paint();
  });
  row.appendChild(now);
  row.appendChild(off);
  wrap.appendChild(row);

  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!urlIn.value.trim()) { toast('住所を入れる'); return; }
    if (checkUrl(urlIn.value) === 'http') {
      toast('http では繋がない（合言葉と記録が暗号化されずに流れる）。https:// の住所を入れる');
      return;
    }
    if (!sync.configure(urlIn.value, tokIn.value, shareIn.value)) { toast('住所が読めない（https:// で始める）'); return; }
    urlIn.value = sync.config().url;
  });

  function paint() {
    const st = sync.status();
    const c = sync.config();
    /* 字は、いま開いている持ち主（帯）のぶん */
    const who = sync.space() === 'share' ? '共有: ' : '個人: ';
    now.disabled = !sync.ready();
    off.disabled = !c.url;
    if (st.state === 'ok') line.textContent = who + '合わせた（' + hhmm(st.at) + '）: ' + c.url;
    else if (st.state === 'error') line.textContent = who + '届かない: ' + st.message + '（' + c.url + '）';
    else if (st.state === 'off' && c.url) {
      line.textContent = who + (sync.space() === 'share' ? '共有の合言葉が無い（共有は読むだけ）' : '自分の合言葉が無い（個人はこの端末の中だけ）');
    } else line.textContent = who + (STATE_TEXT[st.state] || '');
  }
  const c0 = sync.config();
  urlIn.value = c0.url;
  tokIn.value = c0.token;
  shareIn.value = c0.shareToken || '';
  sync.on(paint);
  paint();
  screen._server = () => {
    const c = sync.config();
    if (document.activeElement !== urlIn) urlIn.value = c.url;
    if (document.activeElement !== tokIn) tokIn.value = c.token;
    if (document.activeElement !== shareIn) shareIn.value = c.shareToken || '';
    paint();
  };
  return wrap;
}

/* 書き出し・読み込み（CSV）。記録をまるごと1つの CSV にして、別の端末へ引っ越す。
   対象は、いま開いている持ち主（個人か共有）。形とやり方は js/csvio.js */
function csvBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '書き出し・読み込み（CSV）'));
  const shareNote = store.space() === 'share' ? '共有で読み込むと、共有の合言葉を知っている人の端末にも届く。' : '';
  wrap.appendChild(el(
    'p', 'note',
    'いま開いている' + (store.space() === 'share' ? '共有' : '個人') + 'の記録を、まるごと1つの CSV にする。'
    + '別の端末で読み込むと、同じ記録になる（引っ越し）。' + shareNote
  ));
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const out = el('button', 'btn', 'CSV で書き出す');
  out.type = 'button';
  out.addEventListener('click', () => {
    try { store.flush(); } catch (e) { /* 書き出しは止めない */ }
    const csv = toCsv(store.exportState(), store.space());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFileName(store.space());
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast('書き出した（' + a.download + '）');
  });
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = '.csv,text/csv';
  pick.hidden = true;
  const inBtn = el('button', 'btn', 'CSV を読み込む');
  inBtn.type = 'button';
  inBtn.addEventListener('click', () => {
    if (store.readOnly()) { toast(sync.ready() ? '繋がると読み込める（共有は読むだけの間）' : '共有の合言葉を入れると読み込める'); return; }
    pick.value = '';
    pick.click();
  });
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    let got;
    try { got = readCsv(await f.text()); } catch (e) { toast('読み込めない: ' + e.message); return; }
    const mode = await askMode(f.name, got);
    if (!mode) return;
    if (store.readOnly()) { toast('繋がると読み込める（共有は読むだけの間）'); return; }
    const r = importInto(store.exportState(), got, mode);
    store.applyState(r.state);
    toast(mode === 'add'
      ? 'CSV にしかない記録を足した（todo ' + r.added + ' 件）'
      : 'CSV の中身で書き換えた（todo 書き換え ' + r.replaced + ' 件・足した ' + r.added + ' 件）');
  });
  row.appendChild(out);
  row.appendChild(inBtn);
  wrap.appendChild(row);
  wrap.appendChild(pick);
  wrap.appendChild(el(
    'p', 'note',
    '読み込むときに「足す」か「同じものは上書き」かを選ぶ。'
    + 'CSV は Excel でも開けるが、data の欄（記録の中身）を書き換えると読み込めなくなることがある。'
  ));
  return wrap;
}

/* 読み込みのやり方を選ばせる。'add' / 'overwrite' / null（やめる） */
function askMode(fileName, got) {
  return new Promise(resolve => {
    const back = el('div', 'csv-ask-back');
    const box = el('div', 'csv-ask');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'CSV の読み込み方を選ぶ');
    const from = got.meta && got.meta.space === 'share' ? '共有' : '個人';
    const to = store.space() === 'share' ? '共有' : '個人';
    box.appendChild(el('h4', null, 'CSV をどう読み込む？'));
    const p = el('p', 'note');
    p.textContent = fileName + '（' + from + 'の記録）を、いま開いている' + to + 'に読み込む。'
      + (from !== to ? '持ち主が違うので、気をつけて。' : '');
    box.appendChild(p);
    const done = v => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); done(null); } };
    [['add', '足す', 'いまの記録はそのまま、CSV にしかない記録だけを足す。何度読んでも増えない'],
     ['overwrite', '同じものは上書き', 'CSV と同じ記録を CSV の中身で書き換え、無いものは足す。この端末にしかない記録は残る']]
      .forEach(([v, label, sub]) => {
        const b = el('button', 'csv-ask-choice');
        b.type = 'button';
        const t = el('span', 'nm'); t.textContent = label;
        const u = el('span', 'sub'); u.textContent = sub;
        b.appendChild(t); b.appendChild(u);
        b.addEventListener('click', () => done(v));
        box.appendChild(b);
      });
    const cancel = el('button', 'btn', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => done(null));
    box.appendChild(cancel);
    back.appendChild(box);
    back.addEventListener('click', ev => { if (ev.target === back) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    box.querySelector('button').focus();
  });
}
