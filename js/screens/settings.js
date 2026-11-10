/* 設定。タグの管理・音のオン/オフ・サーバー・プロトタイプ確認用の操作。

   タグを置く向きは上・左・右の3つしかなく、タグは何個でも作れる。
   だから「どのタグをどの向きに置くか」を決める場所が要る。それがここ。
   本番に入れるつもりのものは「タグ」と「音」で、いちばん下の3つは確認用。 */

import { el, toast, escapeHtml } from '../ui.js';
import { store } from '../store.js';
import { isOn, setOn, isSfxOn, setSfxOn, playSfx } from '../sound.js';
import { isAffinityOn, setAffinityOn } from '../related.js';
import { sync, checkUrl } from '../sync.js';
import { passkeySupported, registerPasskey, loginPasskey, logoutPasskey, authMode, makeMoveKey,
  requestRegistration, requestStatus } from '../passkey.js';
import { toCsv, readCsv, importInto, csvFileName, csvSummary, deviceLabel } from '../csvio.js';
import { seaName, seaList, allEntries, mergeSeas, boxKey, ID_RE } from '../spacelist.js';
import { makePassphrase, buildPayload, encryptMove, decryptMove, readMoveHead, moveSummary, moveFileName,
  boxToState, stateToBox, mergeBox } from '../movefile.js';
import { NETWORKS, MAX_TX, CONFIG_KEY, loadConfig, saveConfig, rootFromPassphrase, keysFromRoot, makeRecoveryCode,
  readRecoveryCode, sealToMemos, openMemos, readLatestMemos, writeMemos, getBalance, requestAirdrop, needLamports,
  prfSupported, createPasskey, passkeyRoot, solText, FAUCET_URL, planSweep, sweep } from '../chain.js';
import { checkForUpdate, applyUpdate } from '../update.js';
import { getKey, setKey, hasKey, MODELS, getModel, setModel, askFull } from '../ai.js';
import { ITEMS, TAB_LABEL, PREFS_EVENT, loadPrefs, savePrefs, defaults, applyChanges, changeLines,
  changedFromDefault, buildPrefsPrompt, readPrefsReply, proposalText, proposalTitle } from '../prefs.js';
import { openHelp } from '../help.js';
import { openUpcoming, lastLine } from '../upcoming.js';
import { clearAppStorage, confirmed, CONFIRM_WORD } from '../reset.js';

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
    /* 前の名前は「記録ごと初期化」。下の「すべて初期化」（設定も含めて）と取り違えないよう、
       消える範囲（いま開いている海だけ・設定は残る）を名前に入れた（Issue #32） */
    label: 'この海だけ初期化（設定は残す）',
    on: () => {
      store.wipe();
      toast('この海の todo と記録を消して、初期状態に戻した（設定はそのまま）');
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
    hpT.appendChild(el('span', 'sub', '画面の見方・海域と海の始め方'));
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

    /* 効果音（2026-11-07 利用者の指示 Issue #18）。完了音とは別のスイッチ */
    const sfxRow = el('label', 'setrow');
    const sfxCb = document.createElement('input');
    sfxCb.type = 'checkbox';
    sfxCb.checked = isSfxOn();
    sfxCb.addEventListener('change', () => {
      setSfxOn(sfxCb.checked);
      if (sfxCb.checked) playSfx('add');   /* どんな音かをその場で聞かせる */
      toast(sfxCb.checked ? '効果音を鳴らす' : '効果音を鳴らさない');
    });
    sfxRow.appendChild(sfxCb);
    sfxRow.appendChild(el('span', null, '泡を足す・はじめた・タブに置くときに小さく鳴らす'));
    box.appendChild(sfxRow);
    box.appendChild(el(
      'p', 'note',
      '完了の音は自分で「完了」を押したときだけ。消す・戻すときには鳴らない。'
      + '端末が消音のとき（iPhone の消音スイッチなど）や、'
      + '「視差効果を減らす」をオンにしているときは鳴らない。'
    ));

    /* 似ている泡を近くに寄せる（2026-11-07 Issue #23）。端末にだけ置く */
    const affRow = el('label', 'setrow');
    const affCb = document.createElement('input');
    affCb.type = 'checkbox';
    affCb.checked = isAffinityOn();
    affCb.addEventListener('change', () => {
      setAffinityOn(affCb.checked);
      toast(affCb.checked ? '似ている泡を近くに寄せる' : '似ている泡を寄せない');
    });
    affRow.appendChild(affCb);
    affRow.appendChild(el('span', null, '似ている泡（名前が似ている・同じタグ）を、海と今日でゆっくり近くに寄せる'));
    box.appendChild(affRow);

    /* --- この端末の表示（2026-11-10。Issue #36。js/prefs.js）--- */
    box.appendChild(prefsBox());

    /* --- サーバー（複数の端末で同じ記録を使う）---
       サーバーなし版（solo.html）では出さない。通信してよい先を決め打ちにしているので、サーバーには繋がらない */
    if (!isSolo()) box.appendChild(serverBox(this));

    /* --- 書き出し・読み込み（CSV。2026-10-24 利用者の指示：引っ越し）--- */
    box.appendChild(csvBox());
    /* --- 引っ越し（暗号化したファイル。2026-11-07 Issue #19）--- */
    box.appendChild(moveBox());
    /* --- ブロックチェーンに控え（2026-11-08 Issue #31。サーバーなし版だけ）--- */
    box.appendChild(chainBox());

    /* --- 最新の版を確認する（2026-11-02。利用者の指示）---
       ホーム画面に追加した iOS で、閉じて開き直しても新しい版に気づかないことがある
       （WebKit の既知の挙動）。その逃げ道として、押した人だけがその場で確かめて入れ替えられる */
    box.appendChild(updateBox());
    /* --- 前の版に戻す（2026-11-07。Issue #21）--- */
    box.appendChild(rollbackBox());

    /* --- ヘルプ（AI に訊く。2026-11-04。利用者の指示 Issue #9）---
       「ヘルプを開く」（キーが無くても押せる）・API キー・repo の URL */
    box.appendChild(helpAiBox());

    /* --- 先の予定（AI。2026-11-04。利用者の指示 Issue #13）---
       日付が先に分かっている予定を AI に Web で調べさせ、長期保留のバブルにする。押したときだけ調べる */
    box.appendChild(upcomingBox());

    /* --- 画面の大きさの記録（不具合を調べる用。2026-10-25）---
       立ち上げ直後に下のタブが隠れる件で、実機の値を見るため。js/boot-dvh.js が測った値を出し、写せる */
    box.appendChild(sizeBox());

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
      + '空の画面を見たいときは「この海だけ初期化」を使う（ほかの海と設定は残る）。'
    ));
    box.appendChild(proto);

    /* --- すべて初期化（設定も含めて。2026-11-08 Issue #32）---
       上の確認用の操作とは別の箱にし、いちばん下に置く */
    box.appendChild(resetAllBox());

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
  wrap.appendChild(el('h3', null, '海域（サーバー）'));
  wrap.appendChild(el(
    'p', 'note',
    /* 海域（2026-11-10 利用者の決定）＝1つのサーバーが預かる海のまとまり（個人・共有・作った海）。
       入る・記録を送る・持ち主、のときは「海域」。住所・コマンド・サーバーのプログラムのときは「サーバー」 */
    '海域は、自分で立てたサーバーが預かる海のまとまり。海域に繋ぐと、ほかの端末と同じ記録を使える。'
    + '食い違ったときは、項目ごとに新しく書き換えたほうが残る。'
    + '届かない間もこの端末には記録され、届いたら合わせる。'
    + '海は左上の ≡ の引き出しで作り、切り替える。自分の合言葉（個人に入れるパスキー）で、海域のどの海も合わせる。'
    + '人を招いた海は、招かれた人の端末とも同じ海になる。'
    + '公開した海域にはパスキーで入り、手元の海域には合言葉で入る。'
  ));

  const form = el('form', 'tagadd');
  form.style.flexWrap = 'wrap';
  const urlIn = document.createElement('input');
  urlIn.type = 'text';
  urlIn.inputMode = 'url';
  urlIn.autocomplete = 'off';
  urlIn.spellcheck = false;
  urlIn.placeholder = '住所（例 https://bubbles.example.org）';
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
  shareIn.placeholder = '「共有」の海の合言葉（招かれた人のぶん。空なら使わない）';
  shareIn.setAttribute('aria-label', '「共有」の海の合言葉');
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

  /* --- パスキー（2026-10-24。公開したサーバー＝ server.py --auth passkey のとき。開発版）---
     サーバーに入場の形を聞き、パスキーの形なら、合言葉の欄を隠してこちらを出す。
     登録は、持ち主がサーバーで作った招待コード（1回きり・24時間）で。入るときは Face ID・指紋・PIN */
  const pkBox = el('div', 'pkbox');
  pkBox.hidden = true;
  pkBox.style.cssText = 'margin-top:12px';
  pkBox.appendChild(el('p', 'note', 'この海域にはパスキーで入る。初めての端末は、招待コードを入れて登録する。'
    + '登録した端末は、次から「パスキーで入る」だけでよい（合言葉は使わない）。'));
  const pkForm = el('form', 'tagadd');
  const invIn = document.createElement('input');
  invIn.type = 'text';
  invIn.autocomplete = 'off';
  invIn.autocapitalize = 'characters';
  invIn.spellcheck = false;
  invIn.placeholder = '招待コード（例 ABCD-EFGH-JKLM）';
  invIn.setAttribute('aria-label', '招待コード');
  const regBtn = el('button', 'btn', 'この端末を登録');
  regBtn.type = 'submit';
  pkForm.appendChild(invIn);
  pkForm.appendChild(regBtn);
  pkBox.appendChild(pkForm);
  const pkRow = el('div', 'row');
  pkRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const inBtn = el('button', 'btn', 'パスキーで入る');
  inBtn.type = 'button';
  const outBtn = el('button', 'btn', 'この端末から出る');
  outBtn.type = 'button';
  pkRow.appendChild(inBtn);
  pkRow.appendChild(outBtn);
  pkBox.appendChild(pkRow);
  const pkLine = el('p', 'note');
  pkLine.setAttribute('aria-live', 'polite');
  pkBox.appendChild(pkLine);

  /* 端末から登録を頼む（2026-11-07 Issue #26）。招待コードが無いとき、こちらから先に頼み、
     持ち主がサーバーで認める（request-ok <字>）。送るのは呼び名だけ。頼みの鍵は端末の別の箱に置き、
     登録したら・やめたら消す */
  pkBox.appendChild(el('p', 'note', '招待コードが無いときは、この端末から登録を頼める。'
    + '画面に出る字を海域の持ち主に伝え、認めてもらってから「登録を仕上げる」を押す。'));
  const askForm = el('form', 'tagadd');
  const askIn = document.createElement('input');
  askIn.type = 'text';
  askIn.autocomplete = 'off';
  askIn.maxLength = 40;
  askIn.placeholder = 'この端末の呼び名（例 自分のスマホ）';
  askIn.setAttribute('aria-label', 'この端末の呼び名');
  const askBtn = el('button', 'btn', '登録を頼む');
  askBtn.type = 'submit';
  askForm.appendChild(askIn);
  askForm.appendChild(askBtn);
  pkBox.appendChild(askForm);
  const askBox = el('div');
  askBox.hidden = true;
  const askLine = el('p', 'note');
  askLine.setAttribute('aria-live', 'polite');
  const askCode = el('p');
  askCode.style.cssText = 'font-size:1.6em;letter-spacing:.12em;font-weight:600;margin:4px 0';
  const askHow = el('p', 'note');
  const askRow = el('div', 'row');
  askRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px';
  const doneBtn = el('button', 'btn', '登録を仕上げる');
  doneBtn.type = 'button';
  const lookBtn = el('button', 'btn', '様子を見る');
  lookBtn.type = 'button';
  const dropBtn = el('button', 'btn', '頼みをやめる');
  dropBtn.type = 'button';
  askRow.appendChild(doneBtn);
  askRow.appendChild(lookBtn);
  askRow.appendChild(dropBtn);
  askBox.appendChild(askLine);
  askBox.appendChild(askCode);
  askBox.appendChild(askHow);
  askBox.appendChild(askRow);
  pkBox.appendChild(askBox);
  wrap.appendChild(pkBox);

  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);

  /* 住所: 欄に入っていればそれ、無ければ今の設定、それも無ければこのページ（server.py が配っているとき） */
  function baseUrl() {
    const raw = urlIn.value.trim() || sync.config().url
      || (/^https?:$/.test(location.protocol) && !window.Capacitor ? location.origin : '');
    const u = checkUrl(raw);
    return u && u !== 'http' ? u : '';
  }
  let mode = null;
  async function lookMode() {
    const b = baseUrl();
    mode = b ? await authMode(b) : null;
    const pk = mode === 'passkey';
    pkBox.hidden = !pk;
    tokIn.hidden = pk;
    shareIn.hidden = pk;
    go.hidden = pk;
    paint();
  }
  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast((e && e.message) || '失敗した'); } finally { btn.disabled = false; paint(); }
  }
  pkForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const b = baseUrl();
    if (!b) { toast('住所を入れる（https:// で始める）'); return; }
    if (!invIn.value.trim()) { toast('招待コードを入れる'); return; }
    withBusy(regBtn, async () => {
      const out = await registerPasskey(b, invIn.value);
      sync.usePasskeySession(b, out);
      invIn.value = '';
      urlIn.value = b;
      toast('この端末を「' + out.name + '」として登録した');
    });
  });
  inBtn.addEventListener('click', () => {
    const b = baseUrl();
    if (!b) { toast('住所を入れる（https:// で始める）'); return; }
    withBusy(inBtn, async () => {
      const out = await loginPasskey(b);
      sync.usePasskeySession(b, out);
      urlIn.value = b;
      toast('「' + out.name + '」で入った');
    });
  });
  outBtn.addEventListener('click', () => withBusy(outBtn, async () => {
    const b = sync.config().url;
    const old = sync.dropPasskeySession();
    if (b && old) await logoutPasskey(b, old);
    toast('この端末から出た（記録はこの端末に残っている）');
  }));
  /* --- 登録の頼み（Issue #26）---
     {base, key, code, name, expires, approved} を 'bubble_todo_pk_request' に置く（設定を閉じても続きから） */
  const REQ_KEY = 'bubble_todo_pk_request';
  function readReq() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(REQ_KEY) || 'null'); } catch (e) { r = null; }
    if (!r || typeof r.key !== 'string' || typeof r.code !== 'string') return null;
    if (r.expires && r.expires * 1000 < Date.now()) { saveReq(null); reqMem = null; return null; }
    return r;
  }
  function saveReq(r) {
    try {
      if (r) localStorage.setItem(REQ_KEY, JSON.stringify(r));
      else localStorage.removeItem(REQ_KEY);
    } catch (e) { /* 入らなくても、この画面の間は続けられる */ }
  }
  let reqMem = null;   // localStorage に入らなかったとき用
  const getReq = () => readReq() || reqMem;
  const setReq = (r) => { reqMem = r; saveReq(r); };
  let pollTimer = 0;
  function paintReq() {
    const r = getReq();
    askBox.hidden = !r;
    askForm.hidden = !!r;
    if (!r) return;
    askCode.textContent = r.code;
    if (r.approved) {
      askLine.textContent = '「' + r.name + '」の登録が認められた。「登録を仕上げる」で、この端末のパスキーを作る。';
      askHow.textContent = '';
    } else {
      askLine.textContent = '「' + r.name + '」として頼んだ。海域の持ち主に、次の字を伝える（認められるまで待つ。24 時間）。';
      askHow.textContent = '持ち主はサーバーで request-list を見て、この字と同じものを request-ok ' + r.code
        + ' --space …（新しい人は me、持ち主の端末は me:1,share、招く海は海の ID）で認める。';
    }
    doneBtn.hidden = !r.approved;
    lookBtn.hidden = !!r.approved;
  }
  async function checkReq(quiet) {
    const r = getReq();
    if (!r || r.approved) return;
    try {
      const st = await requestStatus(r.base, r.key);
      if (st.state === 'approved') {
        setReq(Object.assign({}, r, { approved: true, name: st.name || r.name }));
        toast('登録が認められた。「登録を仕上げる」を押す');
      } else if (!quiet) toast('まだ認められていない');
    } catch (e) {
      if (/断られた|期限/.test((e && e.message) || '')) setReq(null);
      if (!quiet || !getReq()) toast((e && e.message) || '様子が分からない');
    }
    paintReq();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!wrap.isConnected) return;          // 設定を閉じたら止める（開き直すと続きから）
      const r = getReq();
      if (!r || r.approved) return;
      if (!pkBox.hidden && document.visibilityState !== 'hidden') await checkReq(true);
      schedulePoll();
    }, 8000);
  }
  askForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const b = baseUrl();
    if (!b) { toast('住所を入れる（https:// で始める）'); return; }
    const name = askIn.value.trim();
    if (!name) { toast('この端末の呼び名を入れる'); return; }
    withBusy(askBtn, async () => {
      const got = await requestRegistration(b, name);
      setReq({ base: b, key: got.key, code: got.code, name, expires: got.expires, approved: false });
      askIn.value = '';
      urlIn.value = b;
      paintReq();
      schedulePoll();
    });
  });
  lookBtn.addEventListener('click', () => withBusy(lookBtn, () => checkReq(false)));
  dropBtn.addEventListener('click', () => {
    setReq(null);
    paintReq();
    toast('頼みをやめた（サーバーの頼みは 24 時間で消える）');
  });
  /* パスキーを作るのは、押したときだけ（ブラウザは押した直後でないとパスキーを作らせない） */
  doneBtn.addEventListener('click', () => {
    const r = getReq();
    if (!r) return;
    withBusy(doneBtn, async () => {
      const out = await registerPasskey(r.base, r.key);
      sync.usePasskeySession(r.base, out);
      setReq(null);
      urlIn.value = r.base;
      paintReq();
      toast('この端末を「' + out.name + '」として登録した');
    });
  });
  paintReq();
  if (getReq()) { schedulePoll(); checkReq(true); }

  urlIn.addEventListener('change', lookMode);
  if (!passkeySupported()) regBtn.disabled = inBtn.disabled = askBtn.disabled = doneBtn.disabled = true;

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
    if (c.passkey) {
      const sp = c.passkey.spaces.map(x => x !== 'me' ? seaName(x) : (c.passkey.owner ? '個人とすべての海' : '自分の個人')).join('・');
      const until = new Date(c.passkey.expires * 1000);
      pkLine.textContent = c.passkey.valid
        ? '「' + c.passkey.name + '」で入っている（' + sp + '。' + (until.getMonth() + 1) + '/' + until.getDate() + ' まで）'
        : '入り直す（期限が切れた）';
    } else pkLine.textContent = passkeySupported() ? 'まだ入っていない' : 'このブラウザはパスキーを使えない';
    outBtn.disabled = !c.passkey;
    /* 字は、いま開いている持ち主（帯）のぶん */
    const who = seaName(sync.space()) + ': ';
    now.disabled = !sync.ready();
    off.disabled = !c.url;
    if (st.state === 'ok') line.textContent = who + '合わせた（' + hhmm(st.at) + '）: ' + c.url;
    else if (st.state === 'error') line.textContent = who + '届かない: ' + st.message + '（' + c.url + '）';
    else if (st.state === 'off' && c.url) {
      line.textContent = who + (sync.space() === 'me' ? '自分の合言葉が無い（個人はこの端末の中だけ）' : '合言葉が無い（この海はこの端末の中だけ）');
    } else line.textContent = who + (STATE_TEXT[st.state] || '');
  }
  const c0 = sync.config();
  urlIn.value = c0.url;
  tokIn.value = c0.token;
  shareIn.value = c0.shareToken || '';
  sync.on(paint);
  paint();
  lookMode();
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
   対象は、いま開いている海。形とやり方は js/csvio.js */
function csvBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '書き出し・読み込み（CSV）'));
  const shareNote = store.space() !== 'me' ? '人を招いた海で読み込むと、招いた人の端末にも届く。' : '';
  wrap.appendChild(el(
    'p', 'note',
    'いま開いている「' + seaName(store.space()) + '」の記録を、まるごと1つの CSV にする。'
    + '別の端末で読み込むと、同じ記録になる（引っ越し）。' + shareNote
  ));
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const out = el('button', 'btn', 'CSV で書き出す');
  out.type = 'button';
  out.addEventListener('click', () => {
    try { store.flush(); } catch (e) { /* 書き出しは止めない */ }
    const now = Date.now();
    const dev = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1);
    const csv = toCsv(store.exportState(), store.space(), now, seaName(store.space()), dev);
    const name = csvFileName(store.space(), now, seaName(store.space()));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    /* iPhone（とくにホーム画面のアプリ）は <a download> でファイルにならないことがある（Issue #7）。
       共有シートでファイルを渡せる端末では、そちらで「"ファイル"に保存」してもらう */
    let file = null;
    try { file = new File([blob], name, { type: 'text/csv' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share && touchDevice()) {
      let ok = false;
      try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
      if (ok) {
        navigator.share({ files: [file], title: name })
          .then(() => toast('書き出した（' + name + '）'))
          .catch(e => {
            if (e && e.name === 'AbortError') toast('書き出しをやめた');
            else download(blob, name);
          });
        return;
      }
    }
    download(blob, name);
  });
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = '.csv,text/csv';
  pick.hidden = true;
  const inBtn = el('button', 'btn', 'CSV を読み込む');
  inBtn.type = 'button';
  inBtn.addEventListener('click', () => {
    if (store.readOnly()) { toast('繋がると読み込める（いまは読むだけの間）'); return; }
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
    if (store.readOnly()) { toast('繋がると読み込める（いまは読むだけの間）'); return; }
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

/* 引っ越し（暗号化したファイル。2026-11-07 Issue #19）。
   すべての海の記録・海の一覧・サーバーの住所と入る鍵を1つのファイルにし、app が作った合言葉で暗号化する。
   新しい端末で開くと、記録が戻り、サーバーにも入り直せる（持ち主に招待コードを頼まなくてよい）。
   形と暗号は js/movefile.js。サーバーの「引っ越しの鍵」は server.py の /api/passkey/move */
function moveBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '引っ越し（暗号化したファイル）'));
  wrap.appendChild(el(
    'p', 'note',
    'すべての海の記録と、海域に入る鍵を1つのファイルにして、合言葉で暗号化する。'
    + '新しい端末でこのファイルを開いて合言葉を入れると、記録が戻り、招かれた海にもそのまま入れる（持ち主に招待を頼まなくてよい）。'
    + 'ファイルは iCloud Drive・Google Drive など自分の置き場へ。合言葉はファイルと別に書き留める（忘れたら開けない）。'
  ));
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const make = el('button', 'btn', '引っ越しのファイルを作る');
  make.type = 'button';
  const save = el('button', 'btn', 'ファイルを保存する');
  save.type = 'button';
  save.hidden = true;
  const openBtn = el('button', 'btn', '引っ越しのファイルを開く');
  openBtn.type = 'button';
  row.appendChild(make);
  row.appendChild(save);
  row.appendChild(openBtn);
  wrap.appendChild(row);
  const passLine = el('p', 'note');
  passLine.setAttribute('aria-live', 'polite');
  wrap.appendChild(passLine);

  /* 開く側: 合言葉の欄（ファイルを選んでから出す） */
  const passForm = el('form', 'tagadd');
  passForm.hidden = true;
  const passIn = document.createElement('input');
  passIn.type = 'text';
  passIn.autocomplete = 'off';
  passIn.autocapitalize = 'characters';
  passIn.spellcheck = false;
  passIn.placeholder = '合言葉（XXXX-XXXX-…）';
  passIn.setAttribute('aria-label', '引っ越しのファイルの合言葉');
  const passGo = el('button', 'btn', '開く');
  passGo.type = 'submit';
  passForm.appendChild(passIn);
  passForm.appendChild(passGo);
  wrap.appendChild(passForm);
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = '.json,application/json';
  pick.hidden = true;
  wrap.appendChild(pick);
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);
  /* パスキーを作るのは、押した手の続きでないと断る端末がある（iPhone）。だからボタンで始める */
  const retry = el('button', 'btn', '海域に入る（この端末のパスキーを作る）');
  retry.type = 'button';
  retry.hidden = true;
  wrap.appendChild(retry);

  let ready = null;      /* 作ったファイル { blob, name } */
  let fileText = '';
  let pendingServer = null;

  make.addEventListener('click', async () => {
    make.disabled = true;
    save.hidden = true;
    ready = null;
    try {
      try { store.flush(); } catch (e) { /* 作るのは止めない */ }
      const sec = sync.moveSecrets();
      let server = null, warn = '';
      if (sec && sec.session) {
        try {
          const got = await makeMoveKey(sec.url, sec.session);
          server = { url: sec.url, move: got.move };
        } catch (e) {
          server = { url: sec.url };
          warn = '（海域に入る鍵は入っていない: ' + e.message + '）';
        }
      } else if (sec && ('token' in sec)) {
        server = { url: sec.url, token: sec.token, shareToken: sec.shareToken };
      } else if (sec) {
        server = { url: sec.url };
        warn = '（パスキーで入っていないので、海域に入る鍵は入っていない）';
      }
      const now = Date.now();
      const dev = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1);
      const pass = makePassphrase();
      const payload = buildPayload({ boxes: collectBoxes(), seas: allEntries(), server, at: now, device: dev });
      const text = await encryptMove(payload, pass);
      const name = moveFileName(now);
      ready = { blob: new Blob([text], { type: 'application/json' }), name };
      const info = moveSummary(payload);
      passLine.textContent = '合言葉: ' + pass + '　← 書き留めてから「ファイルを保存する」。'
        + '海 ' + info.seas + ' つ・todo ' + info.todos + ' 件' + warn
        + (server && server.move ? '。前に作った引っ越しのファイルでは、もう海域に入れない（記録は戻せる）' : '');
      save.hidden = false;
      save.focus();
    } catch (e) {
      toast('作れなかった: ' + ((e && e.message) || e));
    } finally { make.disabled = false; }
  });

  /* 保存は押した瞬間に共有シートを出す（暗号の計算のあとだと、iPhone が共有シートを断ることがある） */
  save.addEventListener('click', () => {
    if (!ready) return;
    const { blob, name } = ready;
    let file = null;
    try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share && touchDevice()) {
      let ok = false;
      try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
      if (ok) {
        navigator.share({ files: [file], title: name })
          .then(() => toast('保存した（' + name + '）'))
          .catch(e => { if (e && e.name === 'AbortError') toast('保存をやめた'); else download(blob, name); });
        return;
      }
    }
    download(blob, name);
  });

  openBtn.addEventListener('click', () => { pick.value = ''; pick.click(); });
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    try {
      fileText = await f.text();
      readMoveHead(fileText);
    } catch (e) { toast((e && e.message) || '読めない'); fileText = ''; return; }
    passForm.hidden = false;
    passIn.value = '';
    passIn.focus();
    line.textContent = f.name + ' を開く。書き出したときの合言葉を入れる。';
  });

  passForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!fileText) return;
    passGo.disabled = true;
    let p;
    try { p = await decryptMove(fileText, passIn.value); } catch (e) {
      toast((e && e.message) || '開けない');
      passGo.disabled = false;
      return;
    }
    passGo.disabled = false;
    const info = moveSummary(p);
    const at = info.at ? new Date(info.at).toLocaleString() : '不明';
    if (!window.confirm('この端末に戻す？\n書き出した時刻: ' + at + (info.device ? '（' + info.device + '）' : '')
      + '\n海 ' + info.seas + ' つ・todo ' + info.todos + ' 件\nいまの記録は消さずに重ねる（新しく書き換えたほうが残る）。')) return;
    restore(p);
    passForm.hidden = true;
    passIn.value = '';
    fileText = '';
  });

  function restore(p) {
    const n = mergeIntoDevice(p);
    line.textContent = '海 ' + n + ' つの記録を戻した。';
    pendingServer = p.server && p.server.url ? p.server : null;
    if (pendingServer && pendingServer.move && !(sync.config().passkey && sync.config().passkey.valid)) {
      line.textContent += '続けて下のボタンで、海域に入る。';
      retry.hidden = false;
    } else if (pendingServer) joinServer();
  }

  /* サーバーに入る。パスキーの形は引っ越しの鍵で、この端末のパスキーを登録する */
  async function joinServer() {
    const s = pendingServer;
    if (!s) return;
    const cur = sync.config();
    if (cur.url && cur.url !== s.url) {
      line.textContent += 'この端末はほかの海域（' + cur.url + '）に繋いでいるので、繋ぐ先の設定は変えない。';
      pendingServer = null;
      return;
    }
    if (s.token || s.shareToken) {
      sync.configure(s.url, s.token || '', s.shareToken || '');
      line.textContent += '海域に合言葉で繋いだ。';
      pendingServer = null;
      return;
    }
    if (!s.move) {
      line.textContent += '海域に入る鍵は入っていない（住所だけ入れた。持ち主に招待コードを頼む）。';
      if (!cur.url) sync.configure(s.url, '', '');
      pendingServer = null;
      return;
    }
    if (cur.passkey && cur.passkey.valid) {
      line.textContent += 'この端末はもうパスキーで入っている（引っ越しの鍵は使わない）。';
      pendingServer = null;
      return;
    }
    retry.hidden = true;
    try {
      const out = await registerPasskey(s.url, s.move);
      sync.usePasskeySession(s.url, out);
      line.textContent += '「' + out.name + '」として海域に入った。この引っ越しの鍵は使い終わったので、'
        + '次の引っ越しのファイルはこの端末で作り直す。';
      pendingServer = null;
    } catch (e) {
      line.textContent += '海域に入れなかった: ' + ((e && e.message) || e) + '。';
      retry.hidden = false;
    }
  }
  retry.addEventListener('click', () => joinServer());
  return wrap;
}

/* この端末の海の記録。開いている海は store から、ほかは箱から（引っ越しのファイルとチェーンの控えで共用） */
function collectBoxes() {
  const boxes = {};
  ['me'].concat(seaList().map(e => e.id)).forEach(id => {
    if (id === store.space()) { boxes[id] = store.exportState(); return; }
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(boxKey(id)) || 'null'); } catch (e) { raw = null; }
    const st = boxToState(raw);
    if (st) boxes[id] = st;
  });
  return boxes;
}

/* 引っ越しの中身（movefile.js の形）をこの端末に重ねる。戻り値 戻した海の数。
   記録は消さずに重ねる（記録ごとに新しいほうが残る）。サーバーの扱いは呼ぶ側 */
function mergeIntoDevice(p) {
  mergeSeas(p.seas || []);
  let n = 0;
  Object.keys(p.boxes || {}).forEach(id => {
    if (id !== 'me' && !ID_RE.test(id)) return;
    const fromFile = p.boxes[id];
    if (id === store.space()) {
      store.applyState(mergeBox(store.exportState(), fromFile));
    } else {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(boxKey(id)) || 'null'); } catch (e) { raw = null; }
      try { localStorage.setItem(boxKey(id), JSON.stringify(stateToBox(mergeBox(boxToState(raw), fromFile)))); } catch (e) {
        toast('入りきらない（端末の空きが足りない）');
        return;
      }
    }
    n++;
  });
  return n;
}

/* サーバーなし版（solo.html）か。head の <meta name="bubbles-edition" content="solo"> で見分ける */
function isSolo() {
  try { return !!document.querySelector('meta[name="bubbles-edition"][content="solo"]'); } catch (e) { return false; }
}

/* すべて初期化（設定も含めて。2026-11-08 Issue #32）。
   この端末に app が置いたものを全部消して、初めて開いたときの状態に戻す（消す範囲は js/reset.js）。
   上の確認用の「全部消す」「この海だけ初期化」は、いま開いている海の中身だけで、設定は残る。こちらは端末ごと。

   誤って押さないための作り：
   - 赤い枠の別の箱に入れ、設定のいちばん下に置く（ほかの欄の流れで指が来ない）
   - 1回目の的は「開く」だけ。開くと、消えるもの・残るものを並べる
   - 消す的は「初期化」と打つまで押せない（指が滑っても通らない。取り消しのトーストは出せないので、前で止める）
   - 開いた欄は、画面を離れると閉じる（開いたまま後で押すことが無いよう、mount のたびに閉じた形で作る） */
function resetAllBox() {
  const wrap = el('div', 'reset-all');
  wrap.appendChild(el('h3', null, 'すべて初期化（設定も含めて）'));
  wrap.appendChild(el('p', 'note',
    'この端末から、すべての海の記録と設定を消して、初めて開いたときの状態に戻す。元に戻せない。'
    + '上の「全部消す」「この海だけ初期化」は、いま開いている海の中身だけを消し、設定は残す。'));

  const open = el('button', 'btn is-danger', 'すべて初期化する…');
  open.type = 'button';
  const openRow = el('div', 'row');
  openRow.appendChild(open);
  wrap.appendChild(openRow);

  const panel = el('div');
  panel.hidden = true;
  panel.appendChild(el('p', 'note', 'この端末から消えるもの:'));
  const gone = el('ul');
  ['すべての海の todo・記録・メモ（個人・共有・作った海）と海の一覧',
    'タグ、音・効果音・似ている泡の切り替え',
    'サーバーの住所・合言葉・パスキーで入っている状態・登録の頼み',
    'AI のキーと型、先の予定・天気の取り置き、チェーンのバックアップの設定',
    '前の版に戻すための写し'].forEach(s => { const li = el('li'); li.textContent = s; gone.appendChild(li); });
  panel.appendChild(gone);
  panel.appendChild(el('p', 'note', '消えないもの:'));
  const kept = el('ul');
  ['海域に置いた記録（同じ海域にまた繋ぐと戻ってくる）',
    'ブロックチェーンに保存したバックアップ（消せない。同じパスキーか合言葉で戻せる）',
    '画面の「!」が覚えているエラーの記録と、app 本体'].forEach(s => { const li = el('li'); li.textContent = s; kept.appendChild(li); });
  panel.appendChild(kept);
  panel.appendChild(el('p', 'note',
    '残しておきたい記録があれば、先に上の「引っ越しのファイルを作る」か「CSV で書き出す」で控えを取る。'
    + 'サーバーなし版と通常版は、この端末では同じ記録を使うので、どちらも初期化される。'));

  const form = el('form', 'tagadd');
  const word = document.createElement('input');
  word.type = 'text';
  word.autocomplete = 'off';
  word.spellcheck = false;
  word.placeholder = '確かめのため「' + CONFIRM_WORD + '」と打つ';
  word.setAttribute('aria-label', 'すべて初期化の確かめ。「' + CONFIRM_WORD + '」と打つ');
  form.appendChild(word);
  panel.appendChild(form);

  const actRow = el('div', 'row');
  const cancel = el('button', 'btn', 'やめる');
  cancel.type = 'button';
  const go = el('button', 'btn is-danger is-go', '消して初期化する');
  go.type = 'button';
  go.disabled = true;
  actRow.appendChild(cancel);
  actRow.appendChild(go);
  panel.appendChild(actRow);
  wrap.appendChild(panel);

  function close() {
    panel.hidden = true;
    openRow.hidden = false;
    word.value = '';
    go.disabled = true;
  }
  open.addEventListener('click', () => {
    panel.hidden = false;
    openRow.hidden = true;
    word.value = '';
    go.disabled = true;
    word.focus();
  });
  cancel.addEventListener('click', () => { close(); toast('初期化はやめた（何も消していない）'); });
  word.addEventListener('input', () => { go.disabled = !confirmed(word.value); });
  /* Enter で消さない（打ち終えた勢いで消えないよう、消すのはボタンだけ） */
  form.addEventListener('submit', (ev) => { ev.preventDefault(); });
  go.addEventListener('click', () => {
    if (!confirmed(word.value)) { go.disabled = true; return; }
    go.disabled = true;
    /* 1) メモリの記録を書き戻させない 2) サーバーへ送るのを止める 3) 端末から消す 4) 読み直す */
    try { store.halt(); } catch (e) { /* 無い版でも消すのは進める */ }
    try { sync.configure('', '', ''); } catch (e) { /* 止められなくても、読み直せば設定は無い */ }
    const n = clearAppStorage(localStorage);
    toast('すべて初期化した（' + n + ' 項目）。読み直す');
    /* 待つ間に何かが書いても残らないよう、読み直す直前にもう一度消す */
    setTimeout(() => { clearAppStorage(localStorage); location.replace(location.pathname); }, 400);
  });
  return wrap;
}

/* ブロックチェーン（Solana）への控え（2026-11-08 Issue #31）。サーバーなし版だけに出す。
   仕組みと形は js/chain.js。鍵の元はパスキー（PRF）か、app が作って見せる合言葉。元はどこにも置かない。 */
function chainBox() {
  const wrap = el('div', 'tags');
  /* 用語（2026-11-09 Issue #31 の返事で見直し）: ほかのウォレット・取引所と行き来するので、そちらと同じ言葉にそろえる。
     ウォレット・アドレス・バックアップ・Faucet。ボタンは「ウォレット」と「バックアップ」の2つに分けて並べる */
  wrap.appendChild(el('h3', null, 'ブロックチェーンにバックアップ（Solana・試し）'));
  if (!isSolo()) {
    wrap.appendChild(el('p', 'note',
      'ブロックチェーンへのバックアップは、サーバーなし版（このページと同じ場所の solo.html）で使える。'
      + 'サーバーなし版は、通信してよい先を決め打ちにして守っている。'));
    return wrap;
  }
  wrap.appendChild(el('p', 'note',
    '自分の記録を暗号化して、Solana の取引のメモに分けて書く。チェーンに書いたものは消せない（鍵が漏れれば、あとからでも読める）。'
    + '分けた取引が1つでも欠けると戻せない。サーバーの住所と鍵、AI のキーは書かない。'
    + '鍵は3種類: <b>パスキー</b>と<b>合言葉</b>は、ウォレット（手数料を払う）とバックアップの両方を開く。'
    + '<b>復元コード</b>はバックアップを読むだけ（お金は動かせず、書けない）。ウォレットは手数料ぶんの少額だけを入れる。'));

  let cfg = loadConfig();
  const netRow = el('label', 'setrow');
  const netSel = document.createElement('select');
  netSel.setAttribute('aria-label', 'ネット');
  Object.keys(NETWORKS).forEach(k => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = NETWORKS[k].label;
    netSel.appendChild(o);
  });
  netSel.value = cfg.network in NETWORKS ? cfg.network : 'devnet';
  netRow.appendChild(el('span', null, 'ネット: '));
  netRow.appendChild(netSel);
  wrap.appendChild(netRow);

  const info = el('p', 'note');
  info.setAttribute('aria-live', 'polite');
  wrap.appendChild(info);
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  wrap.appendChild(row);
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);

  row.style.cssText = 'margin-top:8px';
  let into = row;
  /* 見出しつきのまとまりを足し、以後の btn はそこへ並べる */
  function group(title, note) {
    const g = el('div', null);
    g.style.cssText = 'margin-top:10px';
    g.appendChild(el('h4', null, title));
    if (note) g.appendChild(el('p', 'note', note));
    const r = el('div', 'row');
    r.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px';
    g.appendChild(r);
    row.appendChild(g);
    into = r;
  }
  function btn(label, fn) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { line.textContent = (e && e.message) || String(e); }
      finally { b.disabled = false; }
    });
    into.appendChild(b);
    return b;
  }

  netSel.addEventListener('change', () => {
    cfg.network = netSel.value;
    saveConfig(cfg);
    line.textContent = '';
    paint();
  });

  /* 鍵の元を出してもらう（パスキーは押した手の続きで呼ぶ。ここより前で await しない） */
  async function unlock() {
    if (cfg.mode === 'passkey') {
      const got = await passkeyRoot(cfg.credId);
      return keysFromRoot(got.root);
    }
    if (cfg.mode === 'pass') {
      const pass = window.prompt('合言葉（始めたときに書き留めた 24 字）');
      if (!pass) throw new Error('やめた');
      line.textContent = '鍵を作っている…';
      return keysFromRoot(await rootFromPassphrase(pass));
    }
    throw new Error('まだ始めていない');
  }
  async function checkSame(keys) {
    if (cfg.address && keys.wallet.address !== cfg.address) {
      throw new Error('鍵が違う（このウォレットのアドレスと合わない）');
    }
  }

  async function start(mode, keys, credId) {
    cfg = Object.assign(loadConfig(), { network: netSel.value, mode, credId: credId || null, address: keys.wallet.address });
    saveConfig(cfg);
    await showRecovery(keys);
    paint();
  }
  async function showRecovery(keys) {
    const code = await makeRecoveryCode(keys.recordKey, keys.wallet.publicKey, netSel.value);
    line.textContent = '復元コード（' + NETWORKS[netSel.value].label + '）: ' + code
      + '　← 紙に書き留める。パスキーが使えなくなったとき（サイトの住所が変わった・OS を替えた）に、バックアップを読むために使う（お金は動かせない）。';
  }

  function paint() {
    row.textContent = '';
    into = row;
    const net = netSel.value;
    if (!cfg.mode) {
      info.textContent = 'まだ始めていない。';
      group('はじめて使う', '新しいウォレットとバックアップの鍵を作る。前にこの app のパスキーや合言葉を作ったことがあるなら、下の「前に作ったものを使う」へ（新しく作ると、別のウォレット・別のバックアップになる）。');
      btn('新しく作る（パスキー）', async () => {
        if (!prfSupported()) throw new Error('この端末ではパスキーを使えない（合言葉で始める）');
        const made = await createPasskey();
        let got = made;
        if (!made.root) {
          /* 作ったときに値を返さない端末がある。続けて使う（押した手の続きでないと断る端末では、もう一度押してもらう） */
          try { got = await passkeyRoot(made.credId); } catch (e) {
            throw new Error('パスキーは作れた。続けて「パスキーで開く」を押して、いま作ったパスキーを選ぶ');
          }
        }
        await start('passkey', await keysFromRoot(got.root), got.credId);
      });
      btn('新しく作る（合言葉）', async () => {
        const pass = makePassphrase();
        if (!window.confirm('合言葉: ' + pass + '\n\nこれを紙に書き留めてから OK を押す。'
          + '合言葉はウォレットとバックアップの両方を開く（漏れるとお金も記録も取られる）。忘れたら開けない。app はどこにも置かない。')) return;
        line.textContent = '鍵を作っている…';
        await start('pass', await keysFromRoot(await rootFromPassphrase(pass)), null);
      });
      group('前に作ったものを使う', 'ほかの端末で作ったパスキー・合言葉で、同じウォレットを開き、いちばん新しいバックアップを戻す。復元コードはバックアップを読むだけ。');
      btn('パスキーで開く', async () => {
        if (!prfSupported()) throw new Error('この端末ではパスキーを使えない');
        const got = await passkeyRoot(null);
        const keys = await keysFromRoot(got.root);
        cfg = Object.assign(loadConfig(), { network: net, mode: 'passkey', credId: got.credId, address: keys.wallet.address });
        saveConfig(cfg);
        paint();
        await restoreWith(keys.recordKey, keys.wallet.address, net);
      });
      btn('合言葉で開く', async () => {
        const pass = window.prompt('合言葉（24 字）');
        if (!pass) return;
        line.textContent = '鍵を作っている…';
        const keys = await keysFromRoot(await rootFromPassphrase(pass));
        cfg = Object.assign(loadConfig(), { network: net, mode: 'pass', credId: null, address: keys.wallet.address });
        saveConfig(cfg);
        paint();
        await restoreWith(keys.recordKey, keys.wallet.address, net);
      });
      btn('復元コードで復元（読むだけ）', restoreByCode);
      return;
    }
    info.textContent = 'ウォレットのアドレス: ' + cfg.address + '（' + (cfg.mode === 'passkey' ? 'パスキー' : '合言葉') + 'で開く）'
      + (cfg.lastAt ? '。最後に保存したバックアップ: ' + new Date(cfg.lastAt).toLocaleString() + '（取引 ' + cfg.lastCount + ' 件）' : '');

    group('ウォレット（手数料を払う）', 'バックアップを書くたびに、ここから手数料を払う。ほかのウォレット（Phantom など）には読み込めないので、やめる・替える前に残高を送り出す。');
    btn('アドレスをコピー', async () => {
      await navigator.clipboard.writeText(cfg.address);
      toast('アドレスをコピーした');
    });
    btn('残高を見る', async () => {
      line.textContent = '残高: ' + solText(await getBalance(net, cfg.address));
    });
    if (net === 'devnet') {
      btn('テスト用の SOL をもらう', async () => {
        line.textContent = 'もらっている…';
        try { await requestAirdrop(net, cfg.address); } catch (e) {
          throw new Error('もらえなかった（' + e.message + '）。「Solana Faucet を開く」で、アドレスを貼って devnet の SOL を頼む');
        }
        line.textContent = '頼んだ。少し待ってから「残高を見る」。';
      });
      /* 窓口の配りが止まっているとき（410 など）の逃げ道（Issue #31 の返事）。
         押すとアドレスをコピーしてから、Solana 公式の Faucet（テスト用 SOL の配布ページ）を新しい窓で開く
         （押した手の続きで開くので、窓を止められにくい）。app からは Faucet へ通信しない */
      btn('Solana Faucet を開く（アドレスをコピー）', async () => {
        /* 'noopener' を付けると戻り値がいつも null になり、開けたかが分からない。開いてから opener を切る */
        const w = window.open(FAUCET_URL, '_blank');
        if (w) { try { w.opener = null; } catch (e) { /* 切れなくても進む */ } }
        try { await navigator.clipboard.writeText(cfg.address); line.textContent = 'アドレスをコピーした。開いたページに貼り、devnet を選んで頼む。済んだら「残高を見る」。'; } catch (e) {
          line.textContent = '開いたページに、このアドレスを貼る: ' + cfg.address;
        }
        if (!w) line.textContent += '（窓が開かなかったときは ' + FAUCET_URL + ' を開く）';
      });
    }
    btn('残高を別のアドレスへ送る', sweepOut);
    if (prfSupported()) btn('パスキーを切り替える', switchPasskey);

    group('バックアップ', '保存すると、いまの記録を暗号化してチェーンに書く（手数料が掛かる）。復元は、いまの記録を消さずに重ねる。');
    btn('バックアップを保存', writeBackup);
    btn('バックアップから復元', async () => {
      const keys = await unlock();
      await checkSame(keys);
      await restoreWith(keys.recordKey, cfg.address, net);
    });
    btn('復元コードを表示', async () => {
      const keys = await unlock();
      await checkSame(keys);
      await showRecovery(keys);
    });
    btn('復元コードで復元（読むだけ）', restoreByCode);

    group('この端末', null);
    btn('この端末での設定を消す', async () => {
      if (!window.confirm('この端末のバックアップの設定を消す？（チェーンの上のバックアップとウォレットは消えない。パスキー・合言葉・復元コードがあれば、また開ける）\n'
        + 'ウォレットに SOL が残っているなら、先に「残高を別のアドレスへ送る」で送り出しておく（復元コードではお金は動かせない）。')) return;
      try { localStorage.removeItem(CONFIG_KEY); } catch (e) { /* 消せなくても進む */ }
      cfg = loadConfig();
      line.textContent = '';
      paint();
    });
  }

  async function writeBackup() {
    const net = netSel.value;
    const keys = await unlock();
    await checkSame(keys);
    try { store.flush(); } catch (e) { /* 書くのは止めない */ }
    line.textContent = 'バックアップを作っている…';
    const dev = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1);
    const payload = buildPayload({ boxes: collectBoxes(), seas: allEntries(), server: null, at: Date.now(), device: dev });
    const sum = moveSummary(payload);
    const memos = await sealToMemos(payload, keys.recordKey);
    if (memos.length > MAX_TX) {
      throw new Error('記録が大きすぎる（取引 ' + memos.length + ' 件に分かれる）。引っ越しのファイルを使う');
    }
    const [bal, need] = await Promise.all([getBalance(net, keys.wallet.address), needLamports(net, memos.length)]);
    if (bal < need.fee + need.rent) {
      throw new Error('ウォレットの残高が足りない（残高 ' + solText(bal) + '・要るのは 手数料 ' + solText(need.fee)
        + ' ＋ 残しておく最低の額 ' + solText(need.rent) + '）。アドレスに SOL を入れてから保存する');
    }
    if (!window.confirm(NETWORKS[net].label + ' にバックアップを保存する？\n海 ' + sum.seas + ' つ・todo ' + sum.todos + ' 件'
      + '\n取引 ' + memos.length + ' 件・手数料の目安 ' + solText(need.fee)
      + '\n書いたものは消せない（暗号化してある）。')) { line.textContent = 'やめた'; return; }
    const sigs = await writeMemos(net, keys.wallet, memos, {
      onStep: (i, n) => { line.textContent = '書いている… ' + i + '/' + n; },
    });
    const id = memos[0].split(' ')[1];
    cfg = Object.assign(loadConfig(), { lastAt: Date.now(), lastId: id, lastCount: sigs.length });
    saveConfig(cfg);
    line.textContent = 'バックアップを保存した（取引 ' + sigs.length + ' 件）。';
    paint();
  }

  /* 残高を全部ほかの住所へ移す（2026-11-09 Issue #31 の返事）。このお財布はほかのウォレットに読み込めないので、
     パスキーを替える・やめる前に、残りを新しいお財布や自分のウォレットへ移す。
     パスキーは押した手の続きで呼ぶ（住所を訊く prompt は待たないので、その後でも続きのまま） */
  async function sweepOut() {
    const net = netSel.value;
    const to = window.prompt('送り先のアドレス（Solana のアドレス。この app の別のウォレットなら、その端末の「アドレスをコピー」で写したもの）\n'
      + 'ネット: ' + NETWORKS[net].label);
    if (!to) return;
    const keys = await unlock();
    await checkSame(keys);
    line.textContent = '残高を確かめている…';
    const plan = await planSweep(net, keys.wallet.address, to);
    if (!window.confirm('残高を全部送る？\n送り先: ' + to.trim() + '\n送る額: ' + solText(plan.amount)
      + '（手数料 ' + solText(plan.fee) + ' を引いた残り）\nネット: ' + NETWORKS[net].label
      + '\n送ったものは取り消せない。アドレスが合っているかを確かめる。')) { line.textContent = 'やめた'; return; }
    line.textContent = '送っている…';
    await sweep(net, keys.wallet, to, plan.amount);
    line.textContent = solText(plan.amount) + ' を送った。このウォレットの残高は 0 になった（バックアップを保存するには、また SOL を入れる）。';
  }

  async function restoreWith(recordKey, address, net) {
    line.textContent = 'バックアップを探している…';
    const parts = await readLatestMemos(net, address);
    if (!parts) {
      line.textContent = 'このアドレスには、全部そろったバックアップが無い（' + NETWORKS[net].label + '）。'
        + (cfg.mode === 'passkey' ? 'この app のパスキーが複数あるなら、「パスキーを切り替える」で別のものを選ぶ（パスキーごとに別のウォレット・別のバックアップになる）。' : '');
      return false;
    }
    const p = await openMemos(parts, recordKey);
    const s = moveSummary(p);
    const at = s.at ? new Date(s.at).toLocaleString() : '不明';
    if (!window.confirm('このバックアップをこの端末に復元する？\n保存した時刻: ' + at + (s.device ? '（' + s.device + '）' : '')
      + '\n海 ' + s.seas + ' つ・todo ' + s.todos + ' 件\nいまの記録は消さずに重ねる（新しく書き換えたほうが残る）。')) {
      line.textContent = 'やめた';
      return true;
    }
    const n = mergeIntoDevice(p);
    line.textContent = '海 ' + n + ' つの記録を戻した。';
    return true;
  }

  /* パスキーを選び直す（Issue #31 の返事: パスキーが複数あると、読み込んだあとに別のものへ替えられなかった）。
     パスキーごとに別のお財布・別の控えになる。前のお財布に残高があれば、替える前に知らせる
     （替えたあとは、前のパスキーで選び直さない限り、前のお財布からは移せない）。
     パスキーは押した手の続きで呼ぶ（ここより前で await しない） */
  async function switchPasskey() {
    const net = netSel.value;
    const got = await passkeyRoot(null);
    const keys = await keysFromRoot(got.root);
    if (keys.wallet.address === cfg.address) {
      line.textContent = '同じパスキー（同じウォレット）を選んだ。変わらない。';
      return;
    }
    if (cfg.address) {
      let old = 0;
      try { old = await getBalance(net, cfg.address); } catch (e) { old = 0; }
      if (old > 0 && !window.confirm('前のウォレット（' + cfg.address + '）に ' + solText(old) + ' 残っている。\n'
        + '切り替えたあとで送り出すには、前のパスキーに切り替え直す必要がある。\n先に送るなら「キャンセル」→「残高を別のアドレスへ送る」に、選んだパスキーのウォレットのアドレスを貼る:\n'
        + keys.wallet.address + '\n切り替える？')) {
        line.textContent = 'やめた（前のパスキーのまま）。選んだパスキーのウォレットのアドレス: ' + keys.wallet.address;
        return;
      }
    }
    cfg = Object.assign(loadConfig(), { network: net, mode: 'passkey', credId: got.credId, address: keys.wallet.address,
      lastAt: null, lastId: null, lastCount: null });
    saveConfig(cfg);
    paint();
    await restoreWith(keys.recordKey, keys.wallet.address, net);
  }

  async function restoreByCode() {
    const code = window.prompt('復元コード（BT1-…）');
    if (!code) return;
    const r = await readRecoveryCode(code);
    netSel.value = r.network;
    await restoreWith(r.recordKey, r.address, r.network);
    if (!cfg.mode) line.textContent += '　復元コードでは読むだけ。続けてバックアップを保存するなら「新しく作る」で始める。';
  }

  paint();
  return wrap;
}

/* 指で触る端末か（iPhone・iPad・Android）。パソコンでは共有シートより、ふつうのダウンロードがよい */
function touchDevice() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('書き出した（' + name + '）');
}

/* 最新の版を確認する（2026-11-02。利用者の指示）。
   ふだんは「閉じて開き直す」だけで次の版に入れ替わるが、iOS のホーム画面アプリは
   それでも気づかないことがある（WebKit の既知の挙動）。ここは押した人だけの逃げ道。
   service worker が無い環境（file:// など）では、箱ごと出さない */
function updateBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '最新の版を確認する'));
  wrap.appendChild(el(
    'p', 'note',
    '版は' + (window.BUBBLES_VERSION ? '「v' + window.BUBBLES_VERSION + '」' : '不明') + '。'
    + 'ホーム画面に追加した端末（とくに iPhone）で、閉じて開き直しても古いままに見えるときに押す。'
  ));
  if (!('serviceWorker' in navigator)) {
    wrap.appendChild(el('p', 'note', 'このブラウザでは確認できない。'));
    return wrap;
  }
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const btn = el('button', 'btn', '最新の版を確認する');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    checkForUpdate().then((found) => {
      if (found === null) { toast('この端末では確認できない'); btn.disabled = false; return; }
      if (!found) { toast('今のが最新の版'); btn.disabled = false; return; }
      toast('新しい版が見つかった。入れ替えて読み直す…');
      applyUpdate().catch(() => { toast('入れ替えられなかった'); btn.disabled = false; });
    }).catch((e) => { toast((e && e.message) || '確認できなかった'); btn.disabled = false; });
  });
  row.appendChild(btn);
  wrap.appendChild(row);
  return wrap;
}

/* 前の版に戻す（2026-11-07。Issue #21。仕組みは js/rollback.js と sw.js）。
   新しい版に不具合があったとき、その端末だけ1つ前の版で使い続けられる。
   戻している間は上に帯が出て、そこの「最新に戻る」で戻る。次の新しい版が届いても戻る。
   前の版の箱が残っていない（新しい版が入ったばかりでない端末・service worker の無い環境）ときは、そう書くだけ */
function rollbackBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '前の版に戻す'));
  const note = el('p', 'note', '新しい版で困ったとき（不具合・重い）に、この端末だけ1つ前の版に戻す。');
  wrap.appendChild(note);
  const RB = window.BubblesRollback;
  const status = el('p', 'note', '確かめている…');
  wrap.appendChild(status);
  if (!RB) { status.textContent = 'このブラウザでは戻せない。'; return wrap; }
  RB.available().then((prev) => {
    if (!prev) {
      status.textContent = '戻せる前の版はまだ無い（次に新しい版が入ると、今の版を1つだけ残す）。';
      return;
    }
    status.textContent = '戻すと、戻している間は海域へ送らない（この端末の中だけで書く）。'
      + '記録はそのまま使い、戻す前に写しを取る。最新に戻ったとき、前の版が落とした欄を写しから埋め戻す。'
      + '上の帯の「最新に戻る」か、次の新しい版が届くと最新に戻る。';
    const row = el('div', 'row');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
    const btn = el('button', 'btn', '前の版（v' + prev + '）に戻す');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (!window.confirm('この端末を前の版 v' + prev + ' に戻す？\n戻している間は海域へ送らない。上の帯の「最新に戻る」で戻せる。')) return;
      btn.disabled = true;
      RB.rollbackTo(prev).catch((e) => { toast((e && e.message) || '戻せなかった'); btn.disabled = false; });
    });
    row.appendChild(btn);
    wrap.appendChild(row);
  }).catch(() => { status.textContent = '戻せる版を確かめられなかった。'; });
  return wrap;
}

/* ヘルプ（AI に訊く。2026-11-04。利用者の指示 Issue #9）。
   「ヘルプを開く」・API キー（入っていれば末尾4字だけ・変える・消す）・repo の URL。
   キーは js/ai.js が localStorage の別の箱（bubble_todo_ai_key）に持つ。ここでは読み書きするだけ。
   「ヘルプを開く」は js/help.js の画面を開くだけで、質問や会話はここでは持たない。 */
const REPO = 'RH-REP/bubbles-todo';

/* 2026-11-04 UI 見直し（Issue #9）:
   ・「ヘルプを開く」はキーが無くても押せる（使い方の記事の目次はキー無しで読める。前はキーが無いと押せず、目次にも辿り着けなかった）
   ・キーは「入っている（…末尾4字）」の1行＋「変える」「消す」。入っていないときだけ入力欄（Enter でも保存）
   ・キーはヘルプと先の予定の両方で使うので、節の名前を「ヘルプと AI」にした */
function maskKey(k) { const s = String(k || ''); return s ? '…' + s.slice(-4) : ''; }

function helpAiBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, 'ヘルプと AI'));

  const askRow = el('div', 'row');
  askRow.style.cssText = 'margin-top:4px';
  const askBtn = el('button', 'btn', 'ヘルプを開く');
  askBtn.type = 'button';
  askRow.appendChild(askBtn);
  wrap.appendChild(askRow);
  wrap.appendChild(el('p', 'note',
    '使い方の記事の目次と、AI（Anthropic・Claude）への質問。AI は下の API キーで動く（先の予定でも使う）。'
    + '送るのは質問の文とこの app の説明・版・画面だけ（バブルの本文は送らない）。'));

  /* --- API キー --- */
  const keyBox = el('div', 'aikey');
  wrap.appendChild(keyBox);
  function renderKey(editing) {
    keyBox.textContent = '';
    const row = el('div', 'row');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';
    if (hasKey() && !editing) {
      const st = el('span', 'aikey-st');
      st.textContent = 'API キー: 入っている（' + maskKey(getKey()) + '）';
      st.style.cssText = 'flex:1;min-width:160px;font-size:13.5px';
      const ch = el('button', 'btn', '変える');
      ch.type = 'button';
      ch.addEventListener('click', () => renderKey(true));
      const rm = el('button', 'btn', '消す');
      rm.type = 'button';
      rm.addEventListener('click', () => { setKey(''); toast('キーを消した'); renderKey(false); });
      row.appendChild(st); row.appendChild(ch); row.appendChild(rm);
      keyBox.appendChild(row);
      return;
    }
    const keyIn = document.createElement('input');
    keyIn.type = 'password';
    keyIn.autocomplete = 'off';
    keyIn.placeholder = 'sk-ant-…（Anthropic Console で発行）';
    keyIn.setAttribute('aria-label', 'Anthropic の API キー');
    keyIn.style.cssText = 'flex:1;min-width:160px;font:inherit;font-size:16px;min-height:44px;'
      + 'padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';
    const save = () => {
      const v = keyIn.value.trim();
      if (!v) { toast('キーを貼り付けてから保存する'); return; }
      if (!setKey(v)) { toast('保存できなかった'); return; }
      toast(/^sk-ant-/.test(v) ? 'キーを保存した' : 'キーを保存した（sk-ant- で始まっていない。違うキーかもしれない）');
      renderKey(false);
    };
    keyIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); save(); } });
    const sv = el('button', 'btn', '保存');
    sv.type = 'button';
    sv.addEventListener('click', save);
    row.appendChild(keyIn); row.appendChild(sv);
    if (editing) {
      const cancel = el('button', 'btn', 'やめる');
      cancel.type = 'button';
      cancel.addEventListener('click', () => renderKey(false));
      row.appendChild(cancel);
    }
    keyBox.appendChild(row);
    keyBox.appendChild(el('p', 'note', 'キーはこの端末にだけ置く（海域・CSV・同期には入らない）。'
      + 'Anthropic Console で、この app 専用のワークスペースと使える上限額を決めておくと安心。'));
    if (editing) setTimeout(() => keyIn.focus(), 0);
  }
  renderKey(false);

  /* --- モデル（2026-11-05 Issue #13「使っているモデルはなに？どうやって変える？」） --- */
  const modelRow = el('label', 'row');
  modelRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;font-size:13.5px';
  modelRow.appendChild(el('span', null, 'AI のモデル'));
  const modelSel = document.createElement('select');
  modelSel.setAttribute('aria-label', 'AI のモデル');
  modelSel.style.cssText = 'font:inherit;font-size:16px;min-height:40px;padding:0 8px;border-radius:10px;'
    + 'border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';
  MODELS.forEach(m => { const op = document.createElement('option'); op.value = m.id; op.textContent = m.label; modelSel.appendChild(op); });
  modelSel.value = getModel();
  modelSel.addEventListener('change', () => {
    toast(setModel(modelSel.value) ? 'モデルを変えた（次に訊くときから）' : '保存できなかった');
  });
  modelRow.appendChild(modelSel);
  wrap.appendChild(modelRow);
  wrap.appendChild(el('p', 'note', 'ヘルプ・先の予定・本文の AI のどれもこのモデルで動く。上ほど賢いが、1 回ごとの料金も上がる。この端末にだけ置く。'));

  const repoRow = el('p', 'note');
  const repoLink = el('a', null, 'GitHub: ' + REPO);
  repoLink.href = 'https://github.com/' + REPO;
  repoLink.target = '_blank';
  repoLink.rel = 'noopener noreferrer';
  repoRow.appendChild(repoLink);
  wrap.appendChild(repoRow);

  askBtn.addEventListener('click', () => {
    openHelp({
      repo: REPO, app: 'bubble_todo', version: '0.1.0', was: askBtn,
      getContext: () => {
        const n = (f) => { try { const a = f(); return Array.isArray(a) ? a.length : '?'; } catch (err) { return '?'; } };
        return {
          summary: '版 ' + (window.BUBBLES_VERSION || '?') + ' ・ 画面 settings'
            + ' ・ 海 ' + n(() => store.floating())
            + ' ・ 今日 ' + n(() => store.todays())
            + ' ・ 長期保留 ' + n(() => store.holds())
            + ' ・ 完了 ' + n(() => store.doneItems())
            + ' ・ タグ ' + n(() => store.tags()),
        };
      },
    });
  });

  return wrap;
}

/* この端末の表示（2026-11-10。Issue #36。案A と案X）。
   決まった項目（js/prefs.js の ITEMS）を、手でも AI のチャットでも変えられる。どれもこの端末にだけ置く。
     ・チャット: 書いた文・項目の一覧・今の値だけを AI に送り、返ってきた変更案を「この変更をする？」で見せる。
       押したときだけ変える。変えたあとのトーストに「元に戻す」。項目に無い頼みは改善の Issue の下書きへ
     ・「全体に提案する」: 既定から変えた項目だけを書いた新しい Issue の画面を開く（Create は人が押す）
   AI の返事は textContent で出す（HTML として描かない） */
/* 文字を textContent で入れる el（el の第3引数は innerHTML なので、項目の説明はこちらで入れる） */
function textEl(tag, cls, text) {
  const n = el(tag, cls);
  n.textContent = String(text == null ? '' : text);
  return n;
}
const selStyle = 'font:inherit;font-size:16px;min-height:40px;padding:0 8px;border-radius:10px;'
  + 'border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';

function prefsBox() {
  const wrap = el('div', 'tags prefs-box');
  wrap.appendChild(el('h3', null, 'この端末の表示'));
  wrap.appendChild(el('p', 'note', '好みで見た目と動きを変える。この端末にだけ置く（同期・CSV・引っ越しには乗らない）。'));

  let cur = loadPrefs();
  const controls = el('div', 'prefs-ctl');
  wrap.appendChild(controls);

  function commit(next, msg, undoTo) {
    const before = cur;
    if (!savePrefs(next)) { toast('保存できなかった'); return false; }
    cur = loadPrefs();
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
    renderControls();
    if (msg) {
      toast(msg, undoTo === false ? null : {
        label: '元に戻す',
        on: () => { savePrefs(before); cur = loadPrefs(); window.dispatchEvent(new CustomEvent(PREFS_EVENT)); renderControls(); },
      });
    }
    return true;
  }

  function renderControls() {
    controls.textContent = '';
    ITEMS.forEach(it => {
      if (it.type === 'bool') {
        const row = el('label', 'setrow');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!cur[it.id];
        cb.addEventListener('change', () => {
          commit(applyChanges(cur, { [it.id]: cb.checked }).next, it.label.replace(/（.*$/, '') + ': ' + (cb.checked ? 'オン' : 'オフ'));
        });
        row.appendChild(cb);
        row.appendChild(textEl('span', null, it.label));
        controls.appendChild(row);
        if (it.note) controls.appendChild(textEl('p', 'note', it.note));
        return;
      }
      if (it.type === 'choice') {
        const row = el('label', 'row');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;font-size:13.5px';
        row.appendChild(textEl('span', null, it.label));
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', it.label);
        sel.style.cssText = selStyle;
        it.choices.forEach(c => { const op = document.createElement('option'); op.value = c[0]; op.textContent = c[1]; sel.appendChild(op); });
        sel.value = cur[it.id];
        sel.addEventListener('change', () => {
          commit(applyChanges(cur, { [it.id]: sel.value }).next, it.label + ': ' + sel.options[sel.selectedIndex].textContent + '（次に開いたときから）');
        });
        row.appendChild(sel);
        controls.appendChild(row);
        return;
      }
      if (it.type === 'order') {
        controls.appendChild(textEl('p', 'note', it.label + '（↑↓ で動かす）'));
        const list = el('div', 'prefs-order');
        list.setAttribute('role', 'list');
        cur[it.id].forEach((id, i, arr) => {
          const r = el('div', 'prefs-order-row');
          r.setAttribute('role', 'listitem');
          r.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;font-size:13.5px';
          const nm = el('span', null, TAB_LABEL[id] || id);
          nm.style.cssText = 'flex:1';
          r.appendChild(nm);
          [[-1, '↑', '上へ'], [1, '↓', '下へ']].forEach(([d, mk, lb]) => {
            const b = el('button', 'btn', mk);
            b.type = 'button';
            b.setAttribute('aria-label', (TAB_LABEL[id] || id) + 'を' + lb);
            b.style.cssText = 'min-width:44px';
            const j = i + d;
            b.disabled = j < 0 || j >= arr.length;
            b.addEventListener('click', () => {
              const a = arr.slice();
              [a[i], a[j]] = [a[j], a[i]];
              commit(applyChanges(cur, { [it.id]: a }).next, '下のタブを並べ替えた');
            });
            r.appendChild(b);
          });
          list.appendChild(r);
        });
        controls.appendChild(list);
      }
    });
    const row = el('div', 'row');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
    const reset = el('button', 'btn', '既定に戻す');
    reset.type = 'button';
    reset.disabled = !Object.keys(changedFromDefault(cur)).length;
    reset.addEventListener('click', () => commit(defaults(), 'この端末の表示を既定に戻した'));
    const propose = el('button', 'btn', 'この設定を全体に提案する');
    propose.type = 'button';
    propose.disabled = reset.disabled;
    propose.addEventListener('click', () => openProposal());
    row.appendChild(reset);
    row.appendChild(propose);
    controls.appendChild(row);
    controls.appendChild(el('p', 'note',
      '「全体に提案する」は、既定から変えた項目と値だけを書いた新しい Issue の画面を GitHub で開く（送るのは開いた画面で Create を押したとき。公開の repo なので誰でも読める）。'
      + '全体の既定にするかはそこで決め、決まれば版の更新で届く。'));
  }

  /* GitHub の新しい Issue の画面を開く（右上の ! と同じ仕組み。押した操作の中で開く） */
  function openIssue(comment, title) {
    if (!window.AppFeedback || typeof window.AppFeedback.newIssueUrl !== 'function') { toast('GitHub の画面を開けない（部品が無い）'); return; }
    const payload = {
      screen: 'prefs', comment, title: title || '', app: 'bubble_todo', version: '0.1.0',
      at: new Date().toISOString(), context: null, screenshot: null,
    };
    window.open(window.AppFeedback.newIssueUrl(REPO, payload), '_blank', 'noopener');
    try {
      const p = navigator.clipboard && navigator.clipboard.writeText(
        window.AppFeedback.issueTitle(payload) + '\n\n' + window.AppFeedback.issueBody(payload));
      if (p && p.catch) p.catch(() => { /* 置けなくても開くのは済んでいる */ });
    } catch (e) { /* 同上 */ }
    toast('GitHub を開いた。空欄で開いたら、コピーした題名・本文を貼り付けてください');
  }
  function openProposal() {
    const body = proposalText(cur);
    if (!body) { toast('既定から変えた項目が無い'); return; }
    openIssue(body, proposalTitle(cur));
  }

  /* --- チャット（AI に頼む）--- */
  const chat = el('div', 'prefs-chat');
  chat.style.cssText = 'margin-top:14px';
  chat.appendChild(el('p', 'note',
    'AI に頼んで変える（例: 「起動したら今日を開いて」「天気に風も出して」「タグを隠して」）。'
    + '送るのは書いた文と、上の項目・今の値だけ（泡の中身は送らない）。変える前に確かめる。API キーは「ヘルプと AI」で入れる。'));
  const inRow = el('div', 'row');
  inRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:flex-end';
  const ta = document.createElement('textarea');
  ta.rows = 2;
  ta.maxLength = 1000;
  ta.placeholder = 'どう変えたいか';
  ta.setAttribute('aria-label', 'この端末の表示を AI に頼む');
  ta.style.cssText = 'flex:1;min-width:160px;font:inherit;font-size:16px;padding:8px 12px;border-radius:10px;'
    + 'border:1px solid var(--line-strong);background:var(--bg);color:var(--text);resize:vertical';
  const send = el('button', 'btn', '頼む');
  send.type = 'button';
  inRow.appendChild(ta);
  inRow.appendChild(send);
  chat.appendChild(inRow);
  const out = el('div', 'prefs-out');
  out.setAttribute('role', 'status');
  chat.appendChild(out);
  wrap.appendChild(chat);

  let busy = false;
  async function ask() {
    const text = ta.value.trim();
    if (busy || !text) return;
    out.textContent = '';
    if (!hasKey()) { out.appendChild(el('p', 'note', 'API キーがまだ入っていない。下の「ヘルプと AI」に入れると使える（上の項目は手でも変えられる）。')); return; }
    busy = true; send.disabled = true;
    out.appendChild(el('p', 'note', '考えています…'));
    let r = null, err = '';
    try {
      const p = buildPrefsPrompt(text, cur);
      const res = await askFull(p.system, p.user, { maxTokens: 2000 });
      r = readPrefsReply(res.text);
    } catch (e) { err = (e && e.message) || '届かなかった'; }
    busy = false; send.disabled = false;
    out.textContent = '';
    if (err) { out.appendChild(el('p', 'note', 'AI に届かなかった: ' + err)); return; }
    const { next, applied, ignored } = applyChanges(cur, r.changes);
    if (r.reply) { const p = el('p', 'note'); p.textContent = 'AI: ' + r.reply; out.appendChild(p); }   /* AI の文。innerHTML には入れない */
    if (!applied.length) {
      out.appendChild(el('p', 'note', ignored.length || !Object.keys(r.changes).length
        ? 'いまの項目では変えられない（または、すでにその設定）。新しい項目が欲しいときは改善の Issue にできる。'
        : 'すでにその設定になっている。'));
      const row = el('div', 'row');
      row.style.cssText = 'margin-top:6px';
      const b = el('button', 'btn', '改善の Issue の下書きを開く');
      b.type = 'button';
      b.addEventListener('click', () => openIssue('この端末の表示で、次のことをしたい（いまの項目では変えられなかった）:\n\n' + text, ''));
      row.appendChild(b);
      out.appendChild(row);
      return;
    }
    const lines = changeLines(cur, next, applied);
    out.appendChild(el('p', 'note', 'この変更をする？'));
    const ul = el('ul', 'note');
    lines.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    out.appendChild(ul);
    const row = el('div', 'row');
    row.style.cssText = 'display:flex;gap:8px;margin-top:6px';
    const ok = el('button', 'btn', 'この変更をする');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      if (commit(next, '変えた（' + lines.length + '項目）')) { out.textContent = ''; ta.value = ''; }
    });
    const no = el('button', 'btn', 'やめる');
    no.type = 'button';
    no.addEventListener('click', () => { out.textContent = ''; });
    row.appendChild(ok);
    row.appendChild(no);
    out.appendChild(row);
  }
  send.addEventListener('click', ask);
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && !ev.isComposing) { ev.preventDefault(); ask(); }
  });

  renderControls();
  return wrap;
}

/* 先の予定（AI。2026-11-04。利用者の指示 Issue #13）。
   説明・前に調べた日・「先の予定を開く」だけ。中身（トピック・調べる・一覧・入れる）は js/upcoming.js の板。
   キーが無くても開ける（トピックを選んでおける）。調べるボタンはキーが無いと押せない */
function upcomingBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '先の予定（AI）'));
  wrap.appendChild(el('p', 'note',
    '調べたい予定やキャンペーン（FOMC・決算日・セール・支払いの還元など）を書いて送ると、AI が日付と説明を調べ、その少し前に今日へ出す。'));
  const last = el('p', 'note');
  const refresh = () => { last.textContent = lastLine(store.todayKey()); };
  refresh();
  wrap.appendChild(last);
  const row = el('div', 'row');
  row.style.cssText = 'margin-top:10px';
  const btn = el('button', 'btn', '先の予定を開く');
  btn.type = 'button';
  btn.addEventListener('click', () => openUpcoming({ was: btn, onClose: refresh }));
  row.appendChild(btn);
  wrap.appendChild(row);
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
    const fromId = (got.meta && got.meta.space) || 'me';
    const from = seaName(fromId) || '別の海';
    const to = seaName(store.space());
    box.appendChild(el('h4', null, 'CSV をどう読み込む？'));
    const p = el('p', 'note');
    const info = csvSummary(got);
    p.textContent = fileName + '（' + from + 'の記録）を、いま開いている' + to + 'に読み込む。'
      + (fromId !== store.space() ? '別の海の記録なので、気をつけて。' : '');
    box.appendChild(p);
    /* どの端末でいつ書き出したものかを見せる。取り違え（別の端末の CSV）に気づけるように（Issue #7） */
    const q = el('p', 'note');
    q.textContent = '書き出した時刻: ' + (info.at || '不明') + '／todo ' + info.todos + ' 件'
      + (info.device ? '／書き出した端末: ' + info.device : '');
    box.appendChild(q);
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

/* 画面の大きさの記録。js/boot-dvh.js が立ち上げから測った値（大きさだけ。記録の中身は入らない） */
function sizeBox() {
  const d = document.createElement('details');
  d.className = 'size-log';
  const sum = document.createElement('summary');
  sum.textContent = '画面の大きさの記録（不具合を調べる用）';
  d.appendChild(sum);
  const pre = document.createElement('pre');
  const copy = el('button', 'btn', '写す');
  copy.type = 'button';
  const text = () => {
    const log = window.__bubblesSize || [];
    const head = 'UA: ' + navigator.userAgent + '\n' + '今: inner ' + window.innerHeight + ' / screen ' + (screen && screen.height)
      + ' / app ' + Math.round(document.querySelector('.app').getBoundingClientRect().height)
      + ' / tabbar下 ' + Math.round(document.getElementById('tabbar').getBoundingClientRect().bottom) + '\n';
    return head + log.map(e => [e.t + 'ms', e.why, 'inner ' + e.inner, 'vv ' + e.vv, 'client ' + e.client,
      'page ' + e.page, e.mode, e.standalone ? 'standalone' : 'browser'].join(' ')).join('\n');
  };
  d.addEventListener('toggle', () => { if (d.open) pre.textContent = text(); });
  copy.addEventListener('click', async () => {
    pre.textContent = text();
    try { await navigator.clipboard.writeText(pre.textContent); toast('写した'); }
    catch (e) { toast('写せなかった。字を長押しして選んでください'); }
  });
  d.appendChild(pre);
  d.appendChild(copy);
  return d;
}
