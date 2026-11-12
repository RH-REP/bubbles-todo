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
  readRecoveryCode, sealToMemos, openMemos, readLatestMemos, writeMemos, getBalance, requestAirdrop, needLamports, rpc,
  prfSupported, createPasskey, passkeyRoot, solText, FAUCET_URL, planSweep, sweep,
  loadMove, saveMove, clearMove, moveStep, moveSteps } from '../chain.js';
import { makeShareAddress, readShareAddress, newSeaKey, boardOf, wrapSeaKey, unwrapSeaKey, sealEnvelope, writeEnvelope,
  findInvites, postMemos, writePost, readBoard, loadShared, saveShared, sharedFor, cleanMembers, shortAddr,
  chatBoardOf, readChatPosts, MSG_MAX, SELF_SEA, GIFT_MESSAGES, giftPlan } from '../board.js';
import { Mesh, loadP2pPrefs, saveP2pPrefs, iceServers, p2pSupported, deviceId, loadHistory, saveHistory, mergeHistory, markState,
  signMsg, messagesFromPosts, signSnap } from '../p2p.js';
/* ひとことの端末の印（消せるのは自分の端末で書いたものだけ）。p2p の deviceId とは別の印 */
import { deviceId as noteDevice, noteName, setNoteName, canRemove, NOTE_MAX, BY_MAX, chatCopies } from '../notes.js';
import { checkForUpdate, applyUpdate, forceReload } from '../update.js';
import { openSeaSheet } from '../space.js';
import { folderBackup, folderBackupSupported, readBackup, backupSummary, backupFileName } from '../folderbackup.js';
import {
  getKey, setKey, hasKey, getModelChoice, setModel, setCustomModel, validModelName, modelsFor, askFull,
  PROVIDER_IDS, getProvider, setProvider, providerInfo, providerLabel, canSearch,
} from '../ai.js';
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
    const goL = el('span', 'nm', 'ふりかえる');
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
    hpT.appendChild(el('span', 'nm', '使い方を読む'));
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

    /* --- ヘルプ（2026-11-11 Issue #45: 「ヘルプと AI を使う」からヘルプを分けた）---
       ヘルプはキーが無くても開ける（使い方の記事の目次）ので、AI の設定の箱に入れず、使い方の下に1行で置く。
       AI に訊くのに要る API キーとモデルは「AI を使う設定をする」の箱にある */
    const ask = el('button', 'gorow');
    ask.type = 'button';
    const akT = el('span', 'tx');
    akT.appendChild(el('span', 'nm', 'ヘルプを開く'));
    akT.appendChild(el('span', 'sub', '記事の目次・AI に訊く'));
    ask.appendChild(akT);
    const akA = el('span', 'ar', '›');
    akA.setAttribute('aria-hidden', 'true');
    ask.appendChild(akA);
    ask.addEventListener('click', () => openHelpScreen(ask));
    box.appendChild(ask);

    /* --- タグ --- */
    /* store 側のタグ API がまだ無い版でも設定画面ごと落ちないよう、有無を見る */
    if (hasTags()) {
      const tagBox = el('div', 'tags');
      tagBox.appendChild(el('h3', null, 'タグを編集する'));
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

    /* --- 1行にまとめた箱（Issue #40。利用者の返事）---
       基本は個人の TODO なので、ふだん開いて見えるのは ふりかえり・使い方・タグ だけにし、
       ほかは「音と表示」「AI を使う設定をする」「他の人と一緒に使う」「記録の引っ越しと版」「その他」の
       1行ずつにまとめる。押すと中身が開く。
       「この端末の表示」で「あまり使わない機能も出す」にしていれば、開いた姿で始める */
    const allOpen = () => !!loadPrefs().allTools;
    const groups = [];
    const group = (title, sub) => {
      const d = document.createElement('details');
      d.className = 'set-more';
      d.open = allOpen();
      const s = document.createElement('summary');
      const tx = el('span', 'tx');
      tx.appendChild(el('span', 'nm', title));
      const subEl = el('span', 'sub', sub);
      subEl.setAttribute('data-gsub', '');   /* 説明なので ⓘ を押すまで隠す（markInfo。Issue #43 の返事） */
      tx.appendChild(subEl);
      s.appendChild(tx);
      d.appendChild(s);
      groups.push(d);
      return d;
    };
    window.addEventListener(PREFS_EVENT, () => { if (allOpen()) groups.forEach(d => { d.open = true; }); });

    /* 名前は「何をするか」で書く（2026-11-11 Issue #43 の返事:「バックアップという名詞じゃなくて、バックアップをするみたいな名前に」） */
    const gLook = group('音と表示を変える', '完了の音・効果音・似ている泡を寄せる・この端末の表示');
    /* 「AI を使う」ではなく「AI を使う設定をする」（Issue #45）。ヘルプそのものは上の1行へ分けた */
    const gAi = group('AI を使う設定をする', 'API キー・モデル・先の予定');
    const gShare = group('他の人と一緒に使う', 'サーバーを使う・ブロックチェーンを使う');
    /* 「記録を引っ越す」と「版を確かめる」は別の働きなので分けた（Issue #43 の返事）。
       引っ越し（CSV・暗号化したファイル）・サーバー・ブロックチェーンは、どれも「記録をどこかに置いて、あとで戻す」なので、
       「記録を保存する・読み込む」にまとめ、置き場を選ぶ形にした */
    const gSave = group('記録を保存する・読み込む', 'ファイル（CSV・暗号化）・決めたフォルダ・サーバー・ブロックチェーン');
    const gVer = group('版を確かめる・戻す', '最新の版を確かめる・前の版に戻す');
    const gEtc = group('不具合を調べる・初期化する', '画面の大きさの記録・プロトタイプで試す・すべて初期化');

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
    gLook.appendChild(soundRow);

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
    gLook.appendChild(sfxRow);
    gLook.appendChild(el(
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
    gLook.appendChild(affRow);

    /* --- この端末の表示（2026-11-10。Issue #36。js/prefs.js）--- */
    gLook.appendChild(prefsBox());

    /* --- サーバー（複数の端末で同じ記録を使う）---
       サーバーなし版（solo.html）では出さない。通信してよい先を決め打ちにしているので、サーバーには繋がらない */
    /* 「他の人と一緒に使う」は、開くとまず「サーバーを使う」「ブロックチェーンを使う」の選択肢だけを出し、
       選んだほうの欄だけを下に出す（2026-11-11 Issue #43 の返事: 選択肢で誘導する） */
    const shareChoice = choiceRow(gShare, 'どれで一緒に使うか');
    let serverEl = null;
    if (!isSolo()) {
      serverEl = serverBox(this);
      /* --- この海のチャット（サーバーあり版。2026-11-11 Issue #42）--- */
      shareChoice.add('server', 'サーバーを使う', [serverEl, serverChatBox(this)]);
    } else {
      serverEl = soloServerBox();
      shareChoice.add('server', 'サーバーを使う', [serverEl]);
    }

    /* --- 記録を保存する・読み込む（Issue #43 の返事）---
       置き場の選択肢: CSV のファイル・暗号化したファイル（この端末に書き出す）・サーバー・ブロックチェーン。
       サーバーとブロックチェーンの操作は「他の人と一緒に使う」にあるので、ここでは働きの違いを書き、そちらを開くボタンを置く */
    const saveChoice = choiceRow(gSave, 'どこに保存するか');
    /* --- 書き出し・読み込み（CSV。2026-10-24 利用者の指示：引っ越し）--- */
    saveChoice.add('csv', 'CSV ファイル', [csvBox()]);
    /* --- 引っ越し（暗号化したファイル。2026-11-07 Issue #19）--- */
    saveChoice.add('file', '暗号化したファイル', [moveBox()]);
    /* --- 決めたフォルダに自動で控える（2026-11-12 利用者の指示。js/folderbackup.js）--- */
    saveChoice.add('folder', '決めたフォルダ（自動）', [folderBox()]);
    const openShare = (k, then) => {
      gShare.open = true;
      shareChoice.pick(k);
      if (then) then();
      const t = k === 'chain' ? chainEl : serverEl;
      try { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 動かせなくても開いてある */ }
    };
    {
      const w = el('div', 'tags');
      w.appendChild(el('h3', null, 'サーバーに置く'));
      w.appendChild(el('p', 'note',
        'サーバー（海域）に繋いでいる間は、記録は自動でサーバーにも置かれ、ほかの端末と合う。押して保存・読み込みしなくてよい。'
        + 'ファイルやブロックチェーンのような「その時点の控え」ではなく、いつも今の記録と同じ中身になる（消したものも消える）。'));
      const st = el('p', 'note');
      st.setAttribute('aria-live', 'polite');
      const r = el('div', 'row');
      const b = el('button', 'btn', 'サーバーの設定を開く');
      b.type = 'button';
      b.addEventListener('click', () => openShare('server'));
      r.appendChild(b);
      w.appendChild(r);
      w.appendChild(st);
      saveChoice.add('server', 'サーバー', [w]);
      gSave.addEventListener('toggle', () => {
        if (gSave.open) st.textContent = sync.config().url ? 'いま: サーバーに繋いでいる（自動で置いている）。' : 'いま: サーバーには繋いでいない。';
      });
    }
    {
      const w = el('div', 'tags');
      w.appendChild(el('h3', null, 'ブロックチェーンに置く'));
      w.appendChild(el('p', 'note',
        '記録を暗号化して、Solana のチェーンにバックアップとして書く。押したときだけ書き（手数料が掛かる）、読み込みは今の記録に重ねる。'
        + 'パスキーか合言葉で開く。どの端末からでも戻せる。'));
      const r = el('div', 'row');
      const b = el('button', 'btn', 'ブロックチェーンでバックアップする');
      b.type = 'button';
      b.addEventListener('click', () => openShare('chain', () => chainEl.openTask && chainEl.openTask('backup')));
      r.appendChild(b);
      w.appendChild(r);
      saveChoice.add('chain', 'ブロックチェーン', [w]);
    }
    /* --- ブロックチェーンに控え（2026-11-08 Issue #31）---
       共有の海（Issue #37）もこの中にあるので「他の人と一緒に使う」へ。
       サーバーが配るページでも使える（2026-11-11 Issue #42 の A 案。server.py の CSP に Solana の RPC を足した） */
    const chainEl = chainBox();
    shareChoice.add('chain', 'ブロックチェーンを使う', [chainEl]);
    /* いま使っているほうを選んだ姿で始める（サーバーに繋いでいればサーバー、ブロックチェーンを始めていればそちら） */
    {
      const c = loadConfig();
      if (sync.config().url) shareChoice.pick('server');
      else if (c.mode || c.address) shareChoice.pick('chain');
    }

    /* --- 記録の置き場（2026-11-11 Issue #42 の A 案）---
       版（サーバーあり・なし）の違いを見せず、ここで置き場を選ぶ。選ぶと合うほうのページへ移るか、その欄を開く */
    box.appendChild(placeBox({ gShare, serverEl, chainEl, pick: shareChoice.pick }));

    /* --- 最新の版を確認する（2026-11-02。利用者の指示）---
       ホーム画面に追加した iOS で、閉じて開き直しても新しい版に気づかないことがある
       （WebKit の既知の挙動）。その逃げ道として、押した人だけがその場で確かめて入れ替えられる */
    gVer.appendChild(updateBox());
    /* --- 前の版に戻す（2026-11-07。Issue #21）--- */
    gVer.appendChild(rollbackBox());

    /* --- AI の API キーとモデル（2026-11-04 Issue #9。2026-11-11 Issue #45 で「ヘルプを開く」を上の1行へ分けた）--- */
    gAi.appendChild(helpAiBox());

    /* --- 先の予定（AI。2026-11-04。利用者の指示 Issue #13）---
       日付が先に分かっている予定を AI に Web で調べさせ、長期保留のバブルにする。押したときだけ調べる */
    gAi.appendChild(upcomingBox());

    /* --- 画面の大きさの記録（不具合を調べる用。2026-10-25）---
       立ち上げ直後に下のタブが隠れる件で、実機の値を見るため。js/boot-dvh.js が測った値を出し、写せる */
    gEtc.appendChild(sizeBox());

    /* --- プロトタイプ操作 --- */
    const proto = el('div', 'proto');
    proto.appendChild(el('h3', null, 'プロトタイプで試す'));
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
    gEtc.appendChild(proto);

    /* --- すべて初期化（設定も含めて。2026-11-08 Issue #32）---
       上の確認用の操作とは別の箱にし、いちばん下に置く */
    gEtc.appendChild(resetAllBox());

    /* 並び: 個人で使うもの → AI → 他の人と → 引っ越しと版 → その他 */
    groups.forEach(d => box.appendChild(d));

    /* 説明の文は ⓘ を押すまで畳む（Issue #40 の返事）。あとから描き直す節（ブロックチェーンなど）にも付くよう見張る */
    watchInfo(box);

    pane.appendChild(box);
    this._cb = cb;
  },

  /* 音もタグも別のところから変わりうるので、開くたびに読み直す */
  onShow() {
    if (this._cb) this._cb.checked = isOn();
    if (this._server) this._server();
    if (this._chat) this._chat();
    if (this._taglist) renderTags(this._taglist);
  },
};

/* ---- 説明の文を ⓘ の裏へ（2026-11-11。Issue #40 の返事）----
   > デフォルトで表示されてる文字による説明も info ボタンを押すかエラーが出るまで非表示にできない？
   見出し（h3・h4）のある節で、その節の中の説明の文（p.note）に .is-info を付けて隠し、見出しの横に ⓘ を置く。
   ⓘ を押すと節に .show-info が付いて出る（css/screens/stub.css）。
   隠さないもの:
     ・aria-live の付いた行（状態・知らせ・エラー。押したボタンの結果はここに出るので、エラーはいつも見える）
     ・この端末の表示の AI の返事（.prefs-out）
   見出しの無い所の文と、1行の箱の下の説明（.sub）は、箱の行（summary）の ⓘ で出す（Issue #43 の返事。下）
   節は描き直されることがあるので、MutationObserver で見張って付け直す（付いているものは飛ばす） */
/* 選択肢のボタンを1行に並べ、選んだものの欄だけを出す（2026-11-11 Issue #43 の返事: 選択肢で誘導する）。
   add(key, 字, [欄…]) で足し、pick(key) で選ぶ（null で畳む）。同じボタンをもう一度押すと畳む */
function choiceRow(parent, label) {
  const bar = el('div', 'row choice-row');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', label);
  parent.appendChild(bar);
  const items = new Map();
  let cur = null;
  function pick(k) {
    cur = k && items.has(k) ? k : null;
    items.forEach((it, key) => {
      const on = key === cur;
      it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      it.els.forEach(e => { e.hidden = !on; });
    });
  }
  return {
    add(k, text, els) {
      const b = el('button', 'btn');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => pick(cur === k ? null : k));
      bar.appendChild(b);
      els.forEach(e => { e.classList.add('choice-pane'); e.hidden = true; parent.appendChild(e); });
      items.set(k, { btn: b, els });
    },
    pick,
  };
}

function markInfo(root) {
  root.querySelectorAll('h3, h4').forEach(h => {
    const sec = h.parentElement;
    if (!sec) return;
    const notes = [...sec.querySelectorAll('p.note')].filter(p =>
      !p.hasAttribute('aria-live') && !p.closest('.prefs-out') && !p.classList.contains('is-info')
      && (p.textContent || '').trim());
    notes.forEach(p => p.classList.add('is-info'));
    if (h.querySelector('.info-btn')) return;
    if (!sec.querySelector('p.is-info')) return;
    const b = el('button', 'info-btn', 'ⓘ');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', '説明を出す');
    b.addEventListener('click', ev => {
      ev.preventDefault();
      const on = !sec.classList.contains('show-info');
      sec.classList.toggle('show-info', on);
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? '説明を隠す' : '説明を出す');
    });
    h.appendChild(b);
  });
  /* 見出しの無い所の文と、1行の箱の行の下の小さな説明（.sub）も隠し、箱の行（summary）の ⓘ で出す
     （2026-11-11 Issue #43 の返事:「文字による説明はデフォルト非表示で、info ボタンを押した時やエラーの時だけ」）。
     見出しの節の文は上で印を付けてあるので、ここに残るのは見出しの無い所の文だけ。
     状態を出す .sub（記録の置き場の「この端末＋…」）は data-gsub を付けないので隠さない */
  root.querySelectorAll('details.set-more').forEach(d => {
    const sum = d.querySelector(':scope > summary');
    if (!sum) return;
    const loose = [...d.querySelectorAll('p.note')].filter(p =>
      !p.hasAttribute('aria-live') && !p.closest('.prefs-out') && !p.classList.contains('is-info')
      && (p.textContent || '').trim());
    loose.concat([...sum.querySelectorAll('.sub[data-gsub]:not(.is-info)')]).forEach(p => {
      p.classList.add('is-info');
      p.setAttribute('data-ginfo', '');
    });
    if (sum.querySelector('.info-btn')) return;
    if (!d.querySelector('[data-ginfo]')) return;
    const b = el('button', 'info-btn', 'ⓘ');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', '説明を出す');
    b.addEventListener('click', ev => {
      ev.preventDefault();     /* 箱を開け閉めしない */
      ev.stopPropagation();
      const on = !d.classList.contains('show-ginfo');
      d.classList.toggle('show-ginfo', on);
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? '説明を隠す' : '説明を出す');
    });
    sum.appendChild(b);
  });
}
function watchInfo(root) {
  markInfo(root);
  if (!window.MutationObserver) return;
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    /* 描き直しが終わってからまとめて付ける */
    setTimeout(() => { queued = false; markInfo(root); }, 0);
  }).observe(root, { childList: true, subtree: true });
}

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
  wrap.appendChild(el('h3', null, '海域（サーバー）に繋ぐ'));
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
  askHow.setAttribute('aria-live', 'polite');   /* 頼んだあとの案内。説明の文として畳まない（Issue #40） */
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
    else if (st.state === 'outdated') line.textContent = who + st.message + '（' + c.url + '）';
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

/* この海のチャット（サーバーあり版。2026-11-11 Issue #42。#37 の作る順の 3「サーバーあり版のチャットとサーバーへの写し」）。
   メッセージは、いま開いている海の記録に積む（js/notes.js の CHAT_TODO。ひとことと同じ notes 欄）。
   だから送り先は増えない: ふだんの同期（js/sync.js）が、ほかの記録と一緒に自分のサーバーへ写し、
   その海に入れる人の端末へ届ける（開いている間は 20 秒ごと・送った直後）。履歴はサーバーと各端末に残る。
   個人の海では、自分の端末どうしのメモになる。招かれた海は、サーバーと合わせられた間だけ書ける（ほかの記録と同じ）。
   件数は出さない（サーバーの欄と同じ筋）。本文と名前はほかの人が書くので、文字として入れる */
const CHAT_SHOW = 100;
function serverChatBox(screen) {
  const wrap = el('div', 'tags');
  /* 見出しの字は span に入れる（h3 には説明の ⓘ が後から足されるので、h3 ごと書き換えない） */
  const h3 = el('h3', null);
  const head = el('span', null);
  h3.appendChild(head);
  wrap.appendChild(h3);
  wrap.appendChild(el('p', 'note',
    '海域に繋いでいるとき、この海に入れる人どうしで短いメッセージを送り合う（個人の海では、自分の端末どうしのメモ）。'
    + 'メッセージはこの海の記録と一緒に自分のサーバーへ写り、ほかの端末には次に合わせたとき（開いている間はおよそ 20 秒ごと）に届く。'
    + '履歴はサーバーと端末に残る。消せるのはこの端末で書いたものだけで、消しても「（消した）」と残る。'
    + '名前は泡の「ひとこと」と同じ（この端末だけの設定）。'));

  const list = el('div', null);
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.style.cssText = 'max-height:16em;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:6px;'
    + 'padding:8px;border:1px solid rgba(127,127,127,.35);border-radius:8px';
  wrap.appendChild(list);

  const form = el('form', null);
  form.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.maxLength = BY_MAX;
  nameIn.autocomplete = 'off';
  nameIn.placeholder = '名前';
  nameIn.setAttribute('aria-label', '名前（ひとことと同じ）');
  nameIn.style.cssText = 'flex:0 1 7em;min-width:5em';
  nameIn.addEventListener('change', () => { nameIn.value = setNoteName(nameIn.value); });
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = NOTE_MAX;
  input.autocomplete = 'off';
  input.style.cssText = 'flex:1 1 14em;min-width:10em';
  const send = el('button', 'btn', '送る');
  send.type = 'submit';
  form.appendChild(nameIn);
  form.appendChild(input);
  form.appendChild(send);
  wrap.appendChild(form);
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);

  const has = typeof store.chatOf === 'function' && typeof store.addChat === 'function';
  const mine = () => store.space() === 'me';
  let said = '';   /* 押した結果の字（状態の字より先に出す） */

  function paint() {
    head.textContent = mine() ? '自分あてのメモ（海域・自分の端末どうし）' : 'この海のチャット（海域）「' + seaName(store.space()) + '」';
    input.placeholder = mine() ? 'メモ（自分の端末どうし）' : 'メッセージ（この海に入れる人が読める）';
    input.setAttribute('aria-label', mine() ? 'メモ' : 'メッセージ');
    if (document.activeElement !== nameIn) nameIn.value = noteName();

    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    list.textContent = '';
    const rows = has ? store.chatOf().slice(-CHAT_SHOW) : [];
    /* p.note にしない（説明の文として ⓘ の裏に畳まれるため） */
    if (!rows.length) list.appendChild(el('div', 'note', 'まだメッセージは無い。'));
    const dev = noteDevice();
    rows.forEach(n => {
      const item = el('div', null);
      const who = el('span', 'note');
      who.textContent = (n.by || '名前なし') + '・' + new Date(n.at).toLocaleString() + '　';
      const body = el('span', null);
      body.textContent = n.gone ? '（消した）' : n.text;
      body.style.whiteSpace = 'pre-wrap';
      item.appendChild(who);
      item.appendChild(body);
      if (canRemove(n, dev)) {
        const rm = el('button', 'btn', '消す');
        rm.type = 'button';
        rm.style.cssText = 'margin-left:6px;padding:0 6px;font-size:12px';
        rm.addEventListener('click', () => {
          if (!window.confirm('このメッセージを消す？\nほかの端末でも「（消した）」になる（すでに読んだ人の画面からは消せない）。')) return;
          said = store.removeNote(n.id, dev) ? '消した。' : '消せなかった（読むだけの間は書けない）。';
          paint();
        });
        item.appendChild(rm);
      }
      list.appendChild(item);
    });
    if (atBottom) list.scrollTop = list.scrollHeight;

    /* 書けるか: 海域に繋いでいて、この海の鍵があること。読むだけ（招かれた海で合わせる前）は待つ */
    const st = sync.status();
    let state = '';
    if (!has) state = 'この版ではチャットを使えない。';
    else if (!sync.ready()) state = sync.config().url
      ? 'この海の鍵が無いので使えない（海域の欄でパスキーか合言葉を入れる）。'
      : '海域に繋ぐと使える（上の「海域（サーバー）に繋ぐ」）。';
    else if (store.readOnly()) state = 'サーバーと合わせてから書ける（合わせている…）。';
    else if (st.state === 'error') state = 'サーバーに届かない: ' + st.message + '（送ったものはこの端末に残り、届いたら写る）。';
    else if (st.state === 'outdated') state = st.message;
    else if (st.state === 'ok') state = '合わせた（' + hhmm(st.at) + '）。';
    const can = has && sync.ready() && !store.readOnly();
    input.disabled = send.disabled = !can;
    line.textContent = (said ? said + ' ' : '') + state;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (send.disabled) return;
    const text = input.value;
    if (!text.trim()) return;
    nameIn.value = setNoteName(nameIn.value);
    const n = store.addChat(text, noteName(), noteDevice());
    if (!n) { said = '送れなかった（読むだけの間は書けない）。'; paint(); return; }
    input.value = '';
    said = '送った（自分のサーバーへ写している）。';
    paint();
    list.scrollTop = list.scrollHeight;
    /* 少し待ってまとめる同期を待たずに、すぐ写す */
    sync.syncNow();
  });

  if (typeof store.on === 'function') store.on(paint);
  sync.on(paint);
  screen._chat = () => { said = ''; paint(); };
  paint();
  return wrap;
}

/* 書き出し・読み込み（CSV）。記録をまるごと1つの CSV にして、別の端末へ引っ越す。
   対象は、いま開いている海。形とやり方は js/csvio.js */
function csvBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '書き出す・読み込む（CSV）'));
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
  wrap.appendChild(el('h3', null, '暗号化したファイルに書き出す・読み込む'));
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

/* 決めたフォルダに自動で控える（2026-11-12 利用者の指示：公開サーバーに繋がらないときの保険）。
   仕組みは js/folderbackup.js。ここはフォルダを選ぶ・止める・許しを出し直す・控えから戻すボタンと、状態の1行 */
function folderBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '決めたフォルダに自動で控える'));
  wrap.appendChild(el('p', 'note',
    'フォルダを1度選ぶと、この app を開いている間、書き換えて 30 秒たったときと 10 分ごと（と画面を裏に回したとき）に、'
    + 'そのフォルダの「bubbles-backup-日付.json」へ、この端末のすべての海の記録を書く。1日1つのファイルで、その日のうちは上書きする。'
    + '古い日のファイルは消さない（要らなくなったら自分で消す）。サーバーに繋がらない間の保険になる。'));
  wrap.appendChild(el('p', 'note',
    '暗号化はしない（中の todo はそのまま読める）。サーバーの住所・合言葉・鍵は入れない。'
    + 'iCloud Drive などのフォルダを選ぶと、そこにも記録が置かれる。'));
  const ok = folderBackupSupported() && !!folderBackup;
  if (!ok) {
    wrap.appendChild(el('p', 'note',
      'このブラウザでは使えない（フォルダに書く仕組みが無い）。Chrome か Edge で開く（Mac の Chrome でインストールした app でもよい）。'
      + '下の「控えのファイルから戻す」は、どのブラウザでも使える。'));
  }
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const pickBtn = el('button', 'btn', 'フォルダを選ぶ');
  pickBtn.type = 'button';
  const nowBtn = el('button', 'btn', '今すぐ控える');
  nowBtn.type = 'button';
  const permBtn = el('button', 'btn', '書く許しを出し直す');
  permBtn.type = 'button';
  const offBtn = el('button', 'btn', '止める');
  offBtn.type = 'button';
  const restoreBtn = el('button', 'btn', '控えのファイルから戻す');
  restoreBtn.type = 'button';
  [pickBtn, nowBtn, permBtn, offBtn].forEach(b => { if (ok) row.appendChild(b); });
  row.appendChild(restoreBtn);
  wrap.appendChild(row);
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = '.json,application/json';
  pick.hidden = true;
  wrap.appendChild(pick);

  function when(ms) {
    if (!ms) return '';
    const d = new Date(ms), z = x => String(x).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function paint() {
    if (!ok) { line.textContent = ''; return; }
    const s = folderBackup.status();
    const c = s.conf;
    const where = c.folder ? '「' + c.folder + '」' : '選んだフォルダ';
    const last = c.lastAt ? '最後に書いたのは ' + when(c.lastAt) + '（' + c.lastName + '）。' : 'まだ書いていない。';
    pickBtn.textContent = c.on ? 'フォルダを選び直す' : 'フォルダを選ぶ';
    nowBtn.hidden = !c.on;
    offBtn.hidden = !c.on;
    permBtn.hidden = s.state !== 'need-permission';
    if (s.state === 'off') line.textContent = '止めてある（フォルダを選ぶと始まる）。';
    else if (s.state === 'no-folder') line.textContent = 'フォルダを覚えていない。もう一度選ぶ。';
    else if (s.state === 'need-permission') line.textContent = where + 'に書く許しが切れている。「書く許しを出し直す」を押すまで控えない。' + last;
    else if (s.state === 'error') line.textContent = where + 'に書けなかった: ' + s.message + '。' + last;
    else line.textContent = where + 'に控えている。' + last;
  }
  if (ok) folderBackup.on(paint);
  paint();

  pickBtn.addEventListener('click', async () => {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'bubbles-backup', mode: 'readwrite' }); }
    catch (e) { if (e && e.name !== 'AbortError') toast((e && e.message) || '選べなかった'); return; }
    pickBtn.disabled = true;
    try { await folderBackup.useFolder(dir); } catch (e) { toast((e && e.message) || '覚えられなかった'); }
    pickBtn.disabled = false;
    paint();
    if (folderBackup.status().state === 'ok') toast('「' + dir.name + '」に控えた（' + backupFileName() + '）');
  });
  nowBtn.addEventListener('click', async () => {
    nowBtn.disabled = true;
    await folderBackup.runNow(true);
    nowBtn.disabled = false;
    paint();
  });
  permBtn.addEventListener('click', async () => {
    try { await folderBackup.regrant(); } catch (e) { toast((e && e.message) || '許しを得られなかった'); }
    paint();
  });
  offBtn.addEventListener('click', async () => {
    if (!window.confirm('フォルダへの控えを止める？（書いたファイルは消さない）')) return;
    await folderBackup.turnOff();
    paint();
  });
  restoreBtn.addEventListener('click', () => { pick.value = ''; pick.click(); });
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    let p;
    try { p = readBackup(await f.text()); } catch (e) { toast((e && e.message) || '読めない'); return; }
    const info = backupSummary(p);
    const at = info.at ? new Date(info.at).toLocaleString() : '不明';
    if (!window.confirm('この控えから戻す？\n' + f.name + '\n控えた時刻: ' + at + (info.device ? '（' + info.device + '）' : '')
      + '\n海 ' + info.seas + ' つ・todo ' + info.todos + ' 件\nいまの記録は消さずに重ねる（新しく書き換えたほうが残る）。')) return;
    const n = mergeIntoDevice(p);
    line.textContent = '海 ' + n + ' つの記録を、' + f.name + ' から戻した。';
  });
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

/* 入口を1つにした（2026-11-11 Issue #38）。開いたときに js/boot-edition.js が、サーバーに繋いでいなければ
   サーバーなし版（solo.html）へ移す。サーバーに繋ぐときは、ここからサーバーありの版（index.html）を開く。
   その窓の間だけ移さない印（sessionStorage）を置く。住所を入れて繋げば、次からはずっとサーバーありの版で開く */
const EDITION_STAY_KEY = 'bubble_todo_edition_stay';   /* js/boot-edition.js の STAY_KEY */
function soloServerBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, 'サーバーに繋ぐ（複数の端末で同じ記録を使う）'));
  wrap.appendChild(el('p', 'note',
    'いまはサーバーに繋がないページ（通信してよい先を決め打ちにして守っている）で開いている。'
    + 'サーバーに繋ぐときは、下のボタン（または上の「記録の置き場を選ぶ」の「自分のサーバー」）でサーバーに繋ぐページを開き、住所を入れる。繋いだあとは、開くとそのページになる'
    + '（サーバーが配るページでは、サーバーと一緒にブロックチェーンのバックアップ・共有の海・チャットも使える）。'));
  const b = el('button', 'btn', 'サーバーに繋ぐページを開く');
  b.type = 'button';
  b.addEventListener('click', () => {
    try { sessionStorage.setItem(EDITION_STAY_KEY, 'server'); } catch (e) { /* 置けなければ、開いた先でまた戻る */ }
    location.href = 'index.html';
  });
  const row = el('div', 'row');
  row.appendChild(b);
  wrap.appendChild(row);
  return wrap;
}

/* 記録の置き場（2026-11-11 Issue #42 の返事「おすすめで」= A 案）。
   > サーバーあり版とサーバーなし版の区別を無くして、設定で記録場所にサーバー使うかブロックチェーンを使うかを選択する
   ページは裏で 2 つのまま（通信してよい先の決め打ち＝CSP は読み込みの時点で決まり、1 つのページの中で切り替えられないため）。
   使う人には版を見せず、ここで置き場を選ぶ。選ぶと、合うほうのページへ移るか、その欄を開く。
     ・この端末だけ   … サーバーを外す（記録は端末とサーバーの両方に残る）。サーバーでない所で開いていれば solo.html へ
     ・自分のサーバー … solo.html なら index.html へ移って住所を入れる。index.html なら海域の欄を開く
     ・ブロックチェーン … ブロックチェーンの欄を開く（どちらのページでも使える。サーバーと一緒にも使える）
   1 行に畳む（Issue #40。ふだん開いて見えるのは ふりかえり・使い方・タグ だけ） */
function placeBox({ gShare, serverEl, chainEl, pick }) {
  const d = document.createElement('details');
  d.className = 'set-more';
  d.open = !!loadPrefs().allTools;
  const s = document.createElement('summary');
  const tx = el('span', 'tx');
  tx.appendChild(el('span', 'nm', '記録の置き場を選ぶ'));
  const sub = el('span', 'sub');
  tx.appendChild(sub);
  s.appendChild(tx);
  d.appendChild(s);

  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, '記録をどこに置くかを選ぶ'));
  wrap.appendChild(el('p', 'note',
    '記録はいつもこの端末に置く。加えて、自分のサーバー（海域。ほかの端末・招いた人と自動で合わせる）と、'
    + 'ブロックチェーン（暗号化したバックアップ・共有の海・チャット。押したときだけ書き、手数料が掛かる）を選べる。'
    + 'サーバーとブロックチェーンは両方使える。サーバーに繋いでいると、チャットの履歴もサーバーに写る。'));
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  let said = '';

  const onServer = () => !!sync.config().url;
  const onChain = () => { const c = loadConfig(); return !!(c.mode || c.address); };
  const ownServerPage = () => /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname) && !window.Capacitor;

  function show(target) {
    gShare.open = true;
    if (!target) return;
    /* 「他の人と一緒に使う」の中は選んだ欄だけを出す（Issue #43）。開く欄を選んだ姿にする */
    if (pick) pick(target === chainEl ? 'chain' : 'server');
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 動かせなくても開いてある */ }
  }
  function choice(label, on) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.addEventListener('click', on);
    row.appendChild(b);
    return b;
  }
  const bLocal = choice('この端末だけ', () => {
    if (!onServer()) { said = 'いまもサーバーには繋いでいない。'; paint(); return; }
    if (!window.confirm('サーバー（海域）を外す？\nこの端末の記録はそのまま残る。サーバーに置いた記録も消えない（また繋ぐと合わさる）。')) return;
    sync.configure('', '', '');
    if (!isSolo() && !ownServerPage()) {
      said = 'サーバーを外した。サーバーなしのページに切り替える…';
      paint();
      try { sessionStorage.removeItem(EDITION_STAY_KEY); } catch (e) { /* 消せなくても移る */ }
      setTimeout(() => { location.href = 'solo.html'; }, 400);
      return;
    }
    said = 'サーバーを外した。';
    paint();
  });
  const bServer = choice('自分のサーバー（海域）', () => {
    if (isSolo()) {
      /* solo.html はサーバーに繋がらない（CSP）。サーバーに繋ぐページへ移り、住所を入れる */
      try { sessionStorage.setItem(EDITION_STAY_KEY, 'server'); } catch (e) { /* 置けなければ、開いた先でまた戻る */ }
      said = 'サーバーに繋ぐページに切り替える（「他の人と一緒に使う」→「サーバーを使う」の「海域（サーバー）に繋ぐ」に住所を入れる）…';
      paint();
      setTimeout(() => { location.href = 'index.html'; }, 300);
      return;
    }
    show(serverEl);
  });
  const bChain = choice('ブロックチェーン', () => show(chainEl));

  function paint() {
    const parts = ['この端末'];
    if (onServer()) parts.push('自分のサーバー');
    if (onChain()) parts.push('ブロックチェーン');
    sub.textContent = parts.join('＋');
    line.textContent = (said ? said + ' ' : '') + 'いま: ' + parts.join('＋') + '。';
    bLocal.setAttribute('aria-pressed', String(!onServer()));
    bServer.setAttribute('aria-pressed', String(onServer()));
    bChain.setAttribute('aria-pressed', String(onChain()));
  }
  wrap.appendChild(row);
  wrap.appendChild(line);
  d.appendChild(wrap);
  sync.on(() => paint());
  d.addEventListener('toggle', () => { if (d.open) { said = ''; paint(); } });
  paint();
  return d;
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
  wrap.appendChild(el('h3', null, 'すべて初期化する（設定も含めて）'));
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
    '残しておきたい記録があれば、先に上の「記録を保存する・読み込む」の「引っ越しのファイルを作る」か「CSV で書き出す」で控えを取る。'
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
    /* フォルダへの控えを止め、フォルダの覚え（IndexedDB）も捨てる。書いたファイルは消さない */
    if (folderBackup) { try { folderBackup.stop(); folderBackup.turnOff().catch(() => {}); } catch (e) { /* 続ける */ } }
    const n = clearAppStorage(localStorage);
    toast('すべて初期化した（' + n + ' 項目）。読み直す');
    /* 待つ間に何かが書いても残らないよう、読み直す直前にもう一度消す */
    setTimeout(() => { clearAppStorage(localStorage); location.replace(location.pathname); }, 400);
  });
  return wrap;
}

/* ブロックチェーン（Solana）への控え（2026-11-08 Issue #31）。2026-11-11 Issue #42 から、サーバーが配るページにも出す。
   仕組みと形は js/chain.js。鍵の元はパスキー（PRF）か、app が作って見せる合言葉。元はどこにも置かない。 */
function chainBox() {
  const wrap = el('div', 'tags');
  /* 用語（2026-11-09 Issue #31 の返事で見直し）: ほかのウォレット・取引所と行き来するので、そちらと同じ言葉にそろえる。
     ウォレット・アドレス・バックアップ・Faucet。ボタンは「ウォレット」と「バックアップ」の2つに分けて並べる */
  wrap.appendChild(el('h3', null, 'ブロックチェーンを使う（Solana・試し）'));
  /* サーバーが配るページでも使う（2026-11-11 Issue #42 の返事「おすすめで」= A 案）。
     server.py の CSP に Solana の公式 RPC を足したので、サーバーに繋いだままバックアップ・共有の海・チャットを使える。
     サーバーでない所（GitHub Pages・Android の app）で繋いでいない index.html は、開いたときに solo.html へ移る（js/boot-edition.js） */
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
  /* 知らせの行（2026-11-10 Issue #31 の返事: 押したボタンと知らせが離れて見にくい）。
     まとまりごとにボタンのすぐ下へ知らせの行を置き、押したボタンのまとまりの行に出す。
     画面を描き直しても同じ名前のまとまりの行へ出す。無ければ上の共通の行へ */
  const mainLine = el('p', 'note');
  mainLine.setAttribute('aria-live', 'polite');
  wrap.appendChild(mainLine);
  const row = el('div', 'row');
  row.style.cssText = 'margin-top:8px';
  wrap.appendChild(row);
  const lines = new Map();
  let curKey = null;
  const target = () => (curKey && lines.get(curKey)) || mainLine;
  const line = {
    get textContent() { return target().textContent; },
    set textContent(v) { target().textContent = v; },
  };

  let into = row;
  let groupKey = null;
  /* やりたいこと（2026-11-11 Issue #43）。始めたあとは、ボタンを全部並べずに「やりたいこと」のボタンだけを出し、
     押したものの操作だけを下に出す。もう一度押すと畳む。paint をまたいで覚える（設定を開き直しても同じ所） */
  let task = null;
  const TASKS = [
    /* 名前は「何をするか」で書く（Issue #43 の返事:「バックアップという名詞じゃなくて、バックアップをするみたいな名前に」） */
    ['backup', 'バックアップする', '保存・復元・復元コードを表示'],
    ['wallet', 'ウォレットを見る', '残高を見る・テスト用の SOL・送る'],
    ['key', '鍵を替える', '新しい鍵へ移し替える・パスキー／合言葉を切り替える'],
    ['share', '海を共有する', '招待を受ける・自分の海に人を招く・共有中の海'],
    ['memo', '自分にメモを送る', '自分の端末どうしで短いメモを送り合う'],
    ['lost', '鍵を失ったときに読む', '復元コードで読む・この端末での設定を消す'],
  ];
  /* 見出しつきのまとまりを足し、以後の btn はそこへ並べる。parent は畳む箱（fold）に入れるとき */
  function group(key, title, note, parent = row) {
    const g = el('div', null);
    g.style.cssText = 'margin-top:10px';
    g.appendChild(el('h4', null, title));
    if (note) g.appendChild(el('p', 'note', note));
    const r = el('div', 'row');
    r.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center';
    g.appendChild(r);
    const st = el('p', 'note');
    st.setAttribute('aria-live', 'polite');
    g.appendChild(st);
    lines.set(key, st);
    parent.appendChild(g);
    into = r;
    groupKey = key;
  }
  /* ふだんは畳んでおく箱（パスキーが使えない端末・パスキーを失ったとき用） */
  function fold(summary, open) {
    const d = document.createElement('details');
    d.style.cssText = 'margin-top:12px';
    if (open) d.open = true;
    d.appendChild(el('summary', null, summary));
    row.appendChild(d);
    return d;
  }
  function btn(label, fn) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    const key = groupKey;
    b.addEventListener('click', async () => {
      b.disabled = true;
      curKey = key;
      line.textContent = '';
      try { await fn(); } catch (e) {
        const msg = (e && e.message) || String(e);
        line.textContent = msg;
        /* 残高・手数料・SOL に関わる失敗なら、知らせのすぐ横に「ウォレットを開く」を出す（Issue #40 の返事・#43）。
           押したときだけウォレットに切り替える（共有の海などを見ている途中で勝手に替えない） */
        if (cfg.mode && task !== 'wallet' && /残高|手数料|SOL/.test(msg)) offerTask('wallet', 'ウォレットを開く（残高を見る・SOL を足す）');
      }
      finally { b.disabled = false; }
    });
    into.appendChild(b);
    return b;
  }
  /* やりたいことのボタンを並べる（Issue #43） */
  function taskBar(counts) {
    const bar = el('div', 'row choice-row');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'やりたいこと');
    TASKS.forEach(([k, label, sub]) => {
      const b = el('button', 'btn');
      b.type = 'button';
      b.textContent = label + (counts[k] ? '（' + counts[k] + '）' : '');
      b.title = sub;
      b.setAttribute('aria-pressed', task === k ? 'true' : 'false');
      b.addEventListener('click', () => {
        task = task === k ? null : k;
        line.textContent = '';
        paint();
      });
      bar.appendChild(b);
    });
    row.appendChild(bar);
  }
  /* 失敗の知らせの横に、別のやりたいことへ移るボタンを出す */
  function offerTask(k, label) {
    const t = target();
    const b = el('button', 'btn');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'margin-left:8px';
    b.addEventListener('click', () => {
      task = k;
      paint();
      curKey = k;
      line.textContent = '';
    });
    t.appendChild(b);
  }
  /* ボタンの横に並べる文字（残高など） */
  function inlineText(text) {
    const s = el('span', 'note', text);
    s.setAttribute('aria-live', 'polite');
    into.appendChild(s);
    return s;
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
  async function showRecovery(keys, net = netSel.value) {
    const code = await makeRecoveryCode(keys.recordKey, keys.wallet.publicKey, net);
    line.textContent = '復元コード（' + NETWORKS[net].label + '）: ' + code
      + '　← 紙に書き留める。パスキーが使えなくなったとき（このページを開くドメインが変わった・OS を替えた）に、バックアップを読むために使う（お金は動かせない）。';
  }

  function paint() {
    closeChat();
    row.textContent = '';
    lines.clear();
    into = row;
    const net = netSel.value;
    const pk = prfSupported();
    if (!cfg.mode) {
      /* 鍵の選び方（2026-11-10 Issue #31 の返事）。パスキーを先に置くが、合言葉も畳まずに並べる。
         パスキーが使える端末でも、パスキーが引き継がれない端末どうし（iPhone と Windows・Android など）で
         同じウォレットを使うなら、合言葉のほうが向くため。畳むのは、パスキーを失ったときの復元コードだけ */
      info.textContent = 'まだ始めていない。鍵をパスキーか合言葉から選ぶ（あとから替えると、別のウォレット・別のバックアップになる）。';
      if (pk) {
        group('start', 'パスキーで始める',
          '同じ Apple アカウント（または同じ Google アカウント）の端末だけで使うなら、こちら。Face ID・指紋で開け、パスキーは端末どうしで自動で引き継がれる。'
          + '前にこの app のパスキーを作ったことがあるなら「パスキーで開く」（同じウォレットを開き、いちばん新しいバックアップを戻す）。'
          + '初めてなら「パスキーを新しく作る」（作るたびに別のウォレット・別のバックアップになる）。');
        btn('パスキーで開く', async () => {
          const got = await passkeyRoot(null);
          const keys = await keysFromRoot(got.root);
          cfg = Object.assign(loadConfig(), { network: net, mode: 'passkey', credId: got.credId, address: keys.wallet.address });
          saveConfig(cfg);
          paint();
          await restoreWith(keys.recordKey, keys.wallet.address, net);
        });
      }
      group('pass', '合言葉で始める',
        (pk ? '' : 'この端末（ブラウザ）では、鍵を作れるパスキーが使えない。')
        + 'OS をまたいで複数の端末で使う（iPhone と Windows・Android など、パスキーが引き継がれない組み合わせ）なら、こちら。'
        + '合言葉（24 字）はパスキーの代わりで、ウォレットとバックアップの両方を開く。紙に書き留め、どの端末でも同じ合言葉を打つ。'
        + '漏れるとお金も記録も取られるので、パスキーより扱いに気をつける。'
        + 'パスキーで使っていた記録を合言葉へ移すときは、先にパスキーで開き、「鍵を替える」→「新しい鍵へ移し替える」を押す（鍵を作る → 残高を送る → バックアップする、を順に案内する）。');
      btn('合言葉で新しく作る', async () => {
        const pass = makePassphrase();
        if (!window.confirm('合言葉: ' + pass + '\n\nこれを紙に書き留めてから OK を押す。'
          + '合言葉はウォレットとバックアップの両方を開く（漏れるとお金も記録も取られる）。忘れたら開けない。app はどこにも置かない。')) return;
        line.textContent = '鍵を作っている…';
        await start('pass', await keysFromRoot(await rootFromPassphrase(pass)), null);
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
      const alt = fold('パスキー・合言葉を失ったとき', false);
      group('code', '復元コードで読む', 'パスキーを失った・このページを開くドメインが変わったときに、バックアップを読むだけ（お金は動かせず、新しく保存もできない）。', alt);
      btn('復元コードで復元（読むだけ）', restoreByCode);
      if (pk) {
        /* 新しく作るのは最後に置く（前に作った人が押し間違えて別のウォレットを作らないように） */
        into = lines.get('start').previousSibling;
        groupKey = 'start';
        btn('パスキーを新しく作る', async () => {
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
      }
      return;
    }
    info.textContent = 'ウォレットのアドレス: ' + cfg.address + '（' + (cfg.mode === 'passkey' ? 'パスキー' : '合言葉') + 'で開く）'
      + (cfg.lastAt ? '。最後に保存したバックアップ: ' + new Date(cfg.lastAt).toLocaleString() + '（取引 ' + cfg.lastCount + ' 件）' : '');

    /* 鍵の移し替えの途中なら、いちばん上に段と次のボタンを出す（Issue #39） */
    const mv = currentMove();
    if (mv) paintMove(mv);

    /* やりたいこと（2026-11-11 Issue #43）。前はウォレット・バックアップ・共有・困ったときのボタンを全部並べていた。
       いまは「やりたいこと」のボタンだけを並べ、押したものの操作だけを下に出す。
       残高・手数料が足りないなどの失敗が出たら、知らせの横に「ウォレットを開く」を出す（btn() の offerTask） */
    taskBar({ share: sharedFor(loadShared(), cfg.address, net).length });
    if (task === 'wallet') paintWallet(net);
    else if (task === 'key') paintKey(net, mv, pk);
    else if (task === 'backup') paintBackup(net);
    else if (task === 'share') paintShare(net);
    else if (task === 'memo') {
      /* 自分だけが読み書きできる掲示板（同じパスキー・合言葉で開く自分の端末どうし）。段2のチャットの1つ */
      group('self-chat', '自分にメモを送る（端末どうし）',
        '同じパスキーか合言葉で開いた自分の端末どうしで、短いメモを送り合う。自分しか読めない。1 件ごとに手数料が掛かる。');
      btn('メモを開く', () => openChat('self-chat', null));
    } else if (task === 'lost') paintLost();
  }

  function paintWallet(net) {
    group('wallet', 'ウォレットを見る（手数料を払う）','バックアップを書くたびに、ここから手数料を払う。ほかのウォレット（Phantom など）には読み込めないので、やめる・替える前に残高を送り出す。');
    btn('アドレスをコピー', async () => {
      await navigator.clipboard.writeText(cfg.address);
      toast('アドレスをコピーした');
    });
    /* 残高はボタンのすぐ横に出す（2026-11-10 Issue #31 の返事: 離れていて見にくい） */
    btn('残高を見る', async () => {
      balEl.textContent = '確かめている…';
      try { balEl.textContent = '残高 ' + solText(await getBalance(net, cfg.address)); } catch (e) { balEl.textContent = ''; throw e; }
    });
    const balEl = inlineText('');
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
  }

  function paintKey(net, mv, pk) {
    group('key', '鍵を替える',
      '新しい鍵を作って移すなら「新しい鍵へ移し替える」（鍵を作る → 残高を送る → バックアップする、を順に案内する）。'
      + '作ってある別の鍵へ替えるなら「パスキーを切り替える」「合言葉を切り替える」（替えると別のウォレット・別のバックアップになる。先に残高を送り出しておく）。');
    if (!mv) {
      btn('新しい鍵へ移し替える', async () => {
        /* 前の鍵（いま開いているもの）を覚えて、1段目へ。秘密は置かない */
        saveMove({ network: net, from: { mode: cfg.mode, credId: cfg.credId, address: cfg.address }, startedAt: Date.now() });
        paint();
        curKey = 'move';
        line.textContent = '移し替えを始めた。上の「鍵の移し替え」の1から順に押す。';
      });
    }
    if (pk) btn('パスキーを切り替える', switchPasskey);
    btn('合言葉を切り替える', switchPassphrase);
  }

  function paintBackup(net) {
    group('backup', 'バックアップする','保存すると、いまの記録を縮めて暗号化し、チェーンに書く（手数料が掛かる）。復元は、いまの記録を消さずに重ねる。'
      + '復元コードは、パスキーを失ったときにバックアップを読むためのもの。始めたときに控えていなければ表示して書き留める。');
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
  }

  function paintLost() {
    group('code', '復元コードで読む', '別のウォレットのバックアップも、復元コードがあれば読める（読むだけ）。');
    btn('復元コードで復元（読むだけ）', restoreByCode);
    group('device', 'この端末での設定を消す', null);
    btn('この端末での設定を消す', async () => {
      if (!window.confirm('この端末のバックアップの設定を消す？（チェーンの上のバックアップとウォレットは消えない。パスキー・合言葉・復元コードがあれば、また開ける）\n'
        + 'ウォレットに SOL が残っているなら、先に「残高を別のアドレスへ送る」で送り出しておく（復元コードではお金は動かせない）。')) return;
      try { localStorage.removeItem(CONFIG_KEY); } catch (e) { /* 消せなくても進む */ }
      cfg = loadConfig();
      line.textContent = '';
      paint();
    });
  }

  /* ---- 共有の海（2026-11-11 Issue #37。#31 の2段目。仕組みと形は js/board.js） ----
     名前を付けた海を1つずつ、特定の人と共有する。渡すのは受け取りID（BTA1-…。js/board.js の「共有用のアドレス」。人に見られてよい）だけ。
     招く・外すのは海の持ち主（共有を始めた人）だけ。保存・読み込みはボタンで（押したときだけ手数料が掛かる）。
     海の鍵は自分の記録のカギで包んで端末に置くので、どの操作でもパスキーか合言葉で開く */
  function paintShare(net) {
    /* 招く側と招かれる側でまとまりを分け、番号の順に押せばよいようにした（2026-11-11 Issue #37 の返事:
       「このアドレスを相手に渡せばいい？」「相手はどのボタンで取り込むの？」。アドレスが向かう向き＝招かれる人 → 招く人、が分かりにくかった） */
    /* 名前と操作を易しくした（2026-11-11 Issue #37 の返事:「名前と操作が難しい」「海の選択を文字でなくタップで」）。
       - 「共有用のアドレス」→「受け取りID」（ウォレットのアドレスと取り違えないよう、別の言葉にした）
       - 海は番号を打たず、海の名前のボタンをタップして選ぶ。招く相手の受け取りIDは、海の行の入力欄に貼る
       - 「保存／読み込む」→「自分の変更を送る／みんなの変更を取り込む」。外す・やめるは畳んでおく */
    group('share-in', '招待を受ける',
      '① 「受け取りIDをコピー」を押して、招いてくれる人に送る（メッセージなど。人に見られてよい）。'
      + '② 招かれたら「届いた招待を受け取る」を押す。海はこの端末に自動で足される（自分で作らなくてよい）。');
    btn('① 受け取りIDをコピー', async () => {
      const keys = await unlock();
      await checkSame(keys);
      const addr = await makeShareAddress(keys, net);
      cfg = Object.assign(loadConfig(), { share: addr });
      saveConfig(cfg);
      const tail = '　← これを招いてくれる人に送る。招かれたら「② 届いた招待を受け取る」を押す。';
      try { await navigator.clipboard.writeText(addr); line.textContent = '受け取りIDをコピーした: ' + addr + tail; } catch (e) {
        line.textContent = '受け取りID: ' + addr + tail;
      }
    });
    btn('② 届いた招待を受け取る', acceptInvites);

    const shared = loadShared();
    /* 前の版の「共有」（ID が share）は、どの端末でも同じ ID なので、ほかの人の同じ海とまざる。共有させない */
    const cands = seaList().filter(e => e.id !== 'share' && !shared[e.id]);
    group('share', '自分の海に人を招く',
      '① 共有する海をタップする（無ければ「＋ 新しい海」）。② 招く人から受け取りID（BTA1-…）を送ってもらい、下に出る海の欄に貼って「招く」。'
      + '中身はメンバーだけが読める。ただし、誰と誰が同じ海にいるかと、書いた時刻・大きさは、チェーンの上で誰でも見られる。書いたものは消せない。');
    /* group・btn の字は HTML として入る。海の名前は必ず escapeHtml を通す */
    cands.forEach(sea => btn('「' + escapeHtml(sea.name) + '」を共有', () => shareSea(sea)));
    /* 設定の画面で海の作り方を探していた（2026-11-11 Issue #37 の返事）。引き出しと同じ「海をつくる」板をここからも開き、
       作ったらそのまま共有へ進む（その海へは切り替えない） */
    btn('＋ 新しい海', async () => { makeSeaThenShare(); });

    const mine = sharedFor(shared, cfg.address, net);
    mine.forEach(rec => {
      const ent = allEntries().find(e => e.id === rec.id);
      const name = ent ? ent.name : rec.id;
      const owner = rec.owner === cfg.address;
      const who = (rec.members || []).map(m => (m.a === cfg.address ? '自分' : (m.n || shortAddr(m.a)))).join('・');
      /* group の見出しと説明は HTML として入る。海の名前と呼び名はほかのメンバーが書くので、必ず escapeHtml を通す */
      group('sea:' + rec.id, '共有中の海「' + escapeHtml(name) + '」' + (owner ? '' : '（招かれた）'),
        'メンバー ' + ((rec.members || []).length || '?') + ' 人' + (who ? '（' + escapeHtml(who) + '）' : '')
        + (rec.savedAt ? '・最後に送った ' + new Date(rec.savedAt).toLocaleString() : '')
        + (rec.readAt ? '・最後に取り込んだ ' + new Date(rec.readAt).toLocaleString() : ''));
      btn('自分の変更を送る', () => saveShared1(rec.id));
      btn('みんなの変更を取り込む', () => readShared1(rec.id));
      btn('チャット', () => openChat('sea:' + rec.id, rec));
      if (owner) {
        /* 招く相手の受け取りIDは、この海の欄に貼る（前は押してから文字の窓に貼っていた） */
        const idIn = document.createElement('input');
        idIn.type = 'text';
        idIn.autocomplete = 'off';
        idIn.spellcheck = false;
        idIn.placeholder = '招く人の受け取りID（BTA1-…）を貼る';
        idIn.setAttribute('aria-label', '招く人の受け取りID');
        idIn.style.cssText = 'flex:1 1 16em;min-width:12em';
        const nickIn = document.createElement('input');
        nickIn.type = 'text';
        nickIn.autocomplete = 'off';
        nickIn.maxLength = 24;
        nickIn.placeholder = '呼び名（空でもよい）';
        nickIn.setAttribute('aria-label', '招く人の呼び名');
        nickIn.style.cssText = 'flex:0 1 9em;min-width:6em';
        const form = el('div', 'row');
        form.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center;width:100%';
        form.appendChild(idIn);
        form.appendChild(nickIn);
        into.appendChild(form);
        const keep = into;
        into = form;
        btn('招く', async () => {
          await inviteTo(rec.id, idIn.value, nickIn.value);
        });
        into = keep;
      }
      /* 新しいメンバーへ手数料を送る（2026-11-11 Issue #37 の返事）。招かれた人は、受け取る（招待を探す・取り込む）だけなら手数料は要らないが、
         自分の変更を送る・チャットには SOL が要る。始めの一歩を持ち主などが肩代わりできるように */
      (rec.members || []).filter(m => m.a !== cfg.address).forEach(m => {
        btn('手数料を送る: ' + escapeHtml(m.n || shortAddr(m.a)) + '（約' + GIFT_MESSAGES + '通ぶん）', () => giftTo(rec, m));
      });
      /* ふだんは使わないものは畳む */
      const more = document.createElement('details');
      more.style.cssText = 'margin-top:6px;width:100%';
      more.appendChild(el('summary', null, owner ? '人を外す・共有をやめる' : '共有をやめる'));
      const moreRow = el('div', 'row');
      moreRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center';
      more.appendChild(moreRow);
      into.appendChild(more);
      const keep = into;
      into = moreRow;
      if (owner) {
        (rec.members || []).filter(m => m.a !== rec.owner).forEach(m => {
          btn('外す: ' + escapeHtml(m.n || shortAddr(m.a)), () => removeFrom(rec.id, m.a));
        });
      }
      btn('この端末で共有をやめる', async () => {
        if (!window.confirm('この端末で「' + name + '」の共有をやめる？\n海と記録はこの端末に残る（ほかのメンバーには知らせない。チェーンの上の記録も消えない）。'
          + '\nまた使うときは「届いた招待を受け取る」で受け取り直す。')) return;
        const all = loadShared();
        delete all[rec.id];
        saveShared(all);
        paint();
        curKey = 'share';
        line.textContent = '「' + name + '」の共有をやめた（この端末だけ）。';
      });
      into = keep;
    });
  }

  /* ---- チャット（段2。2026-11-11 Issue #37 の返事「OK」。仕組みは js/board.js の chatBoardOf） ----
     共有中の海ごとに「チャット」、自分の端末どうしには「自分あてのメモ」。メッセージ 1 件 = 取引 1〜2 件（書いた人が手数料を払う）。
     開いている間は 15 秒ごとに読みに行く（公式の窓口の回数の上限に当たらない間隔）。閉じている間は読まない（知らせは出ない）。
     開くときに 1 度だけパスキーか合言葉で鍵を開け、開いている間は鍵をメモリに置く（毎回の送信でパスキーを求めないため）。
     閉じる・画面を描き直す・設定を離れる・10 分たつ、のどれかで捨てる。端末には置かない */
  /* 端末どうしの直の通信（p2p。2026-11-11 Issue #37 の返事「おすすめで」。仕組みは js/p2p.js）。
     開いている間、メッセージはまず p2p で送る。誰ともつながっていなければ「未送」として端末に貯め、
     相手とつながったら届ける。閉じるとき（確かめてから）か「ブロックチェーンにも残す」でチェーンに書く */
  let chat = null;
  function closeChat() {
    if (!chat) return;
    clearInterval(chat.timer);
    try { if (chat.mesh) chat.mesh.close(); } catch (e) { /* 閉じられなくても進む */ }
    if (chat.panel && chat.panel.parentNode) chat.panel.parentNode.removeChild(chat.panel);
    chat = null;
  }
  async function openChat(gkey, rec) {
    closeChat();
    const net = rec ? rec.net : netSel.value;
    const keys = await unlock();   /* パスキーは押した手の続きで呼ぶ。ここより前で await しない */
    await checkSame(keys);
    const base = rec ? await unwrapSeaKey(rec, keys.recordKey) : keys.recordKey;
    const board = await chatBoardOf(base);
    const sea = rec ? rec.id : SELF_SEA;
    const gen = rec ? rec.gen : 0;
    const allowed = () => (rec ? [rec.owner].concat(((loadShared()[rec.id] || rec).members || []).map(m => m.a)) : [keys.wallet.address]);
    const members = () => (rec ? ((loadShared()[rec.id] || rec).members || []) : []);
    const nameOf = a => (a === keys.wallet.address ? '自分' : ((members().find(m => m.a === a) || {}).n || shortAddr(a)));

    const anchor = lines.get(gkey);
    if (!anchor) throw new Error('チャットを開けなかった（画面を開き直す）');
    const panel = el('div', null);
    panel.style.cssText = 'margin-top:6px;padding:8px;border:1px solid rgba(127,127,127,.35);border-radius:8px';
    const list = el('div', null);
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'polite');
    list.style.cssText = 'max-height:16em;overflow:auto;display:flex;flex-direction:column;gap:4px';
    panel.appendChild(list);
    const form = el('form', null);
    form.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MSG_MAX;
    input.autocomplete = 'off';
    input.placeholder = rec ? 'メッセージ（メンバーだけが読める）' : 'メモ（自分の端末どうしだけが読める）';
    input.setAttribute('aria-label', rec ? 'メッセージ' : 'メモ');
    input.style.cssText = 'flex:1 1 14em;min-width:10em';
    const send = el('button', 'btn', '送る');
    send.type = 'submit';
    const shut = el('button', 'btn', '閉じる');
    shut.type = 'button';
    form.appendChild(input);
    form.appendChild(send);
    form.appendChild(shut);
    panel.appendChild(form);
    /* つながりの様子と、直の通信の切り替え（この端末だけの設定） */
    const conn = el('p', 'note');
    conn.setAttribute('aria-live', 'polite');
    panel.appendChild(conn);
    const prefs = loadP2pPrefs();
    const toggles = el('div', null);
    toggles.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:4px';
    function toggle(label, key, note) {
      const lab = el('label', 'note');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!prefs[key];
      cb.addEventListener('change', () => {
        prefs[key] = cb.checked;
        saveP2pPrefs(prefs);
        status.textContent = note + '（次に開いたときから効く）';
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + label));
      toggles.appendChild(lab);
    }
    toggle('端末どうしで直につなぐ（p2p）', 'on', '切ると、メッセージは未送として貯め、ブロックチェーンにだけ書く');
    toggle('違う Wi‑Fi でもつなぐ（Cloudflare の STUN）', 'stun',
      '入れると、つなぐときに Cloudflare の窓口へ IP アドレスが届く（中身は届かない）。切ると同じ Wi‑Fi どうしだけ');
    panel.appendChild(toggles);
    const keepRow = el('div', null);
    keepRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px';
    const keepBtn = el('button', 'btn', 'ブロックチェーンにも残す');
    keepBtn.type = 'button';
    keepRow.appendChild(keepBtn);
    /* 送らずに直につなぎたいとき（読むだけで開いているとき）に「ここにいる」を書く。押したときだけ手数料 */
    const callBtn = el('button', 'btn', '相手を呼ぶ（直につなぐ）');
    callBtn.type = 'button';
    keepRow.appendChild(callBtn);
    panel.appendChild(keepRow);
    const status = el('p', 'note');
    status.setAttribute('aria-live', 'polite');
    /* 使い分け（2026-11-11 返事「おすすめで」）: 直につながっていれば直に（手数料なし）、いなければチェーンに書く（手数料あり。相手が後で開いても届く）。
       チェーンに書いたメッセージが「ここにいる」の知らせを兼ねるので、開いただけでは何も書かない */
    status.textContent = '直につながっている相手がいれば直に送る（手数料なし・チェーンに残らない）。いなければブロックチェーンに書く（手数料あり・相手が後で開いても届く）。'
      + '直に送ったものの履歴はこの端末にだけ置く（残したいときは「ブロックチェーンにも残す」）。'
      + (rec ? '直につながると、この海の記録も互いに直に送り合って重ねる（手数料なし）。' : '');
    panel.appendChild(status);
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);

    const room = rec ? 'sea:' + rec.id + ':' + rec.gen : 'self:' + keys.wallet.address;
    let hist = loadHistory(room);
    /* サーバーへの写し（2026-11-11 Issue #42 の返事「おすすめで」= A 案・写す）。
       サーバーに繋いでいるページなら、履歴の新しい分を海の記録のチャット（js/notes.js の CHAT_TODO）にも重ねる。
       共有の海はその海の記録へ、自分あてのメモは個人（me）の記録へ。開いている海ならすぐ、ほかの海はその海を開いたときにサーバーへ写る。
       未送（まだ誰にも届いていない）は写さない。写すのはこの端末で見えた分だけ */
    const copied = new Set();
    function copyToServer() {
      if (isSolo() || !sync.config().url) return;
      const fresh = hist.filter(m => m.state !== 'unsent' && !copied.has(m.id));
      if (!fresh.length) return;
      fresh.forEach(m => copied.add(m.id));
      try { mergeIntoDevice({ seas: [], boxes: { [rec ? rec.id : 'me']: chatCopies(fresh, nameOf) } }); } catch (e) { /* 写せなくてもチャットは続ける */ }
    }
    const putHist = (list) => { hist = saveHistory(room, list); copyToServer(); };
    const unsentList = () => hist.filter(m => m.state === 'unsent' && m.env);

    function render() {
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
      list.textContent = '';
      if (!hist.length) list.appendChild(el('p', 'note', 'まだメッセージは無い。'));
      const mark = { unsent: '（未送）', p2p: '', chain: '' };
      hist.slice(-100).forEach(m => {
        const item = el('div', null);
        const head = el('span', 'note');
        /* 呼び名・本文はほかの人が書くので文字として入れる */
        head.textContent = nameOf(m.by) + '・' + new Date(m.at).toLocaleString() + (mark[m.state] || '') + '　';
        const body = el('span', null);
        body.textContent = m.text;
        item.appendChild(head);
        item.appendChild(body);
        list.appendChild(item);
      });
      if (atBottom) list.scrollTop = list.scrollHeight;
      const n = mesh ? mesh.openCount() : 0;
      const un = unsentList().length;
      conn.textContent = (mesh ? (n ? '直につながっている: ' + n + ' 台' : '直のつながり: まだ無い（どちらかが送るか「相手を呼ぶ」と、相手も開いていれば数十秒でつながる）')
        : '直のつながり: 使っていない（いつもブロックチェーンに書く）')
        + (un ? '・未送 ' + un + ' 件' : '');
    }

    /* チェーンに書く（顔合わせ・まとめたメッセージ）。手数料が要る */
    async function postChain(inner) {
      const memos = await postMemos(keys.wallet, inner, board);
      if (memos.length > MAX_TX) throw new Error('大きすぎる（取引 ' + memos.length + ' 件）');
      await needFunds(net, memos.length);
      await writePost(net, keys.wallet, memos, board);
      return memos.length;
    }
    const myDev = deviceId();
    async function writeToChain(items, why) {
      if (!items.length) return 0;
      /* 端末の印（dev）を入れ、「ここにいる」の知らせを兼ねる（js/p2p.js の Mesh.onPosts） */
      const count = await postChain({ kind: 'msgs', sea, g: gen, at: Date.now(), dev: myDev, msgs: items.slice(-100).map(m => m.env) });
      putHist(markState(hist, items.slice(-100).map(m => m.id), 'chain'));
      render();
      status.textContent = why + '（' + Math.min(items.length, 100) + ' 件・取引 ' + count + ' 件）。';
      return count;
    }

    /* この海の記録の写し（署名つき。js/p2p.js の signSnap）。記録が無ければ null */
    async function snapOf() {
      const box = seaBox(rec.id);
      if (!box) return null;
      return signSnap(keys.wallet, { sea: rec.id, g: gen, entry: allEntries().find(e => e.id === rec.id) || null, box });
    }

    let mesh = null;
    if (prefs.on && p2pSupported()) {
      mesh = new Mesh({
        sea, g: gen, dev: myDev, allowed, ice: iceServers(prefs), history: () => hist,
        post: (inner) => postChain(inner),
        onMessages: (msgs) => { putHist(mergeHistory(hist, msgs, 'p2p').list); render(); },
        onPeerOpen: () => {
          /* つながった相手には、手元の新しい 100 通（未送を含む）が送られた。未送は直に届いた扱いにする */
          putHist(markState(hist, unsentList().map(m => m.id), 'p2p'));
          render();
        },
        onState: () => render(),
        onError: (e) => { status.textContent = '直のつながりで困った: ' + ((e && e.message) || String(e)); },
        /* 共有の海の記録も直に送り合う（2026-11-11 Issue #41。作る順の 2）。自分あてのメモには記録を載せない */
        snapshot: rec ? snapOf : null,
        onSnap: rec ? (inner) => {
          /* 写しの中の海の ID は見ず、この海の箱にだけ重ねる（readWith と同じ。メンバーがほかの海を書き換えられないように）。
             設定の画面は描き直さない（描き直すとチャットが閉じる） */
          const entry = inner.entry && inner.entry.id === rec.id ? inner.entry : null;
          mergeIntoDevice({ seas: entry ? [entry] : [], boxes: { [rec.id]: inner.box } });
          try { putShared(Object.assign(sharedRec(rec.id), { readAt: Date.now() })); } catch (e) { /* 共有をやめていれば印は付けない */ }
          status.textContent = nameOf(inner.by) + ' の記録を直に受け取って重ねた（' + new Date(Number(inner.at) || Date.now()).toLocaleString() + ' の写し・手数料なし）。';
        } : null,
      });
    } else if (prefs.on) {
      status.textContent = 'このブラウザは端末どうしの直の通信（WebRTC）を使えない。メッセージはいつもブロックチェーンに書く。';
    }
    callBtn.hidden = !mesh;

    const until = Date.now() + 10 * 60 * 1000;
    let busy = false;
    async function refresh() {
      if (!chat || chat.panel !== panel) return;
      if (!panel.isConnected || Date.now() > until) {
        const left = unsentList().length;
        closeChat();
        if (Date.now() > until) {
          curKey = gkey;
          line.textContent = '10 分たったので閉じた（鍵をメモリから捨てた）。' + (left ? '未送 ' + left + ' 件は端末に残してある。次に開いたときに書ける。' : '')
            + '続けるときは、もう一度開く。';
        }
        return;
      }
      if (busy) return;
      busy = true;
      try {
        const posts = await readChatPosts(net, board);
        const fromChain = await messagesFromPosts(posts, { sea, g: gen, allowed: allowed() });
        putHist(mergeHistory(hist, fromChain, 'chain').list);
        render();
        if (mesh) await mesh.onPosts(posts);
      } catch (e) {
        status.textContent = '読めなかった: ' + ((e && e.message) || String(e));
      } finally { busy = false; }
    }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      try {
        const m = await signMsg(keys.wallet, { sea, g: gen, text });
        const n = mesh ? mesh.broadcast([m.env]) : 0;
        input.value = '';
        if (n) {
          putHist(mergeHistory(hist, [m], 'p2p').list);
          render();
          status.textContent = n + ' 台に直に送った（手数料なし）。';
          return;
        }
        /* 直につながっている相手がいない: チェーンに書く。前に書けなかった未送も一緒に書く。
           残高が足りないなどで書けなければ、未送として貯める（相手とつながったら届く。あとで「ブロックチェーンにも残す」で書ける） */
        putHist(mergeHistory(hist, [m], 'unsent').list);
        render();
        status.textContent = 'ブロックチェーンに書いている…';
        try {
          await writeToChain(unsentList(), '直につながっている相手がいないので、ブロックチェーンに書いた');
        } catch (e) {
          status.textContent = 'ブロックチェーンに書けなかった: ' + ((e && e.message) || String(e)) + '（未送として端末に貯めた。相手とつながったら届く）';
        }
      } catch (e) {
        status.textContent = '送れなかった: ' + ((e && e.message) || String(e));
      } finally { send.disabled = false; }
    });
    callBtn.addEventListener('click', async () => {
      if (!mesh) return;
      callBtn.disabled = true;
      try {
        status.textContent = '「ここにいる」を書いている…';
        await mesh.hello();
        status.textContent = '「ここにいる」を書いた（手数料が掛かった）。相手がチャットを開いていれば、数十秒でつながる。';
      } catch (e) {
        status.textContent = '書けなかった: ' + ((e && e.message) || String(e));
      } finally { callBtn.disabled = false; }
    });
    keepBtn.addEventListener('click', async () => {
      keepBtn.disabled = true;
      try {
        const items = hist.filter(m => m.state !== 'chain' && m.env);
        if (!items.length) { status.textContent = 'ブロックチェーンに残していないメッセージは無い。'; return; }
        if (!window.confirm('まだブロックチェーンに無いメッセージ ' + Math.min(items.length, 100) + ' 件をまとめて書く？\n'
          + '手数料が掛かる。書いたものは消せない（' + (rec ? 'メンバー' : '自分') + 'だけが読める）。')) return;
        await writeToChain(items, 'ブロックチェーンに残した');
      } catch (e) {
        status.textContent = '残せなかった: ' + ((e && e.message) || String(e));
      } finally { keepBtn.disabled = false; }
    });
    shut.addEventListener('click', async () => {
      const un = unsentList();
      if (un.length && window.confirm('未送のメッセージが ' + un.length + ' 件ある（まだ誰にも届いていない）。ブロックチェーンに書いて届ける？\n'
        + '手数料が掛かる。「キャンセル」なら端末に残し、次に開いたときに届けるか書くかを選べる。')) {
        shut.disabled = true;
        try { await writeToChain(un, 'ブロックチェーンに書いた'); } catch (e) {
          status.textContent = '書けなかった: ' + ((e && e.message) || String(e)) + '（未送は端末に残してある）';
          shut.disabled = false;
          return;
        }
      }
      closeChat();
    });
    /* 「自分の変更を送る」が、つながっている間は直に送るための口（saveShared1 が使う） */
    const sendSnap = rec && mesh ? async () => {
      const env = await snapOf();
      if (!env) throw new Error('この海の記録がこの端末に無い');
      return mesh.broadcastSnap(env);
    } : null;
    chat = { panel, mesh, gkey, sendSnap, timer: setInterval(refresh, 15000) };
    curKey = gkey;
    line.textContent = '';
    render();
    const left = unsentList().length;
    if (left) status.textContent = '前に書けなかった未送が ' + left + ' 件ある。相手とつながれば届く。次に送るとき一緒にブロックチェーンに書く（「ブロックチェーンにも残す」でもよい）。';
    /* 開いただけでは何も書かない（手数料を掛けない）。相手の「ここにいる」（10 分以内のメッセージか呼び出し）があれば、ここで offer を書く */
    await refresh();
    input.focus();
  }

  /* メンバーのウォレットへ、メッセージ約 100 通ぶんの SOL を送る（額は js/board.js の giftPlan）。送り先は名簿のアドレスだけ（貼らせない） */
  async function giftTo(rec, m) {
    const net = rec.net;
    const keys = await unlock();   /* パスキーは押した手の続きで呼ぶ */
    await checkSame(keys);
    line.textContent = '残高を確かめている…';
    const [myBalance, destBalance, rentRaw] = await Promise.all([
      getBalance(net, keys.wallet.address), getBalance(net, m.a), rpc(net, 'getMinimumBalanceForRentExemption', [0])]);
    const plan = giftPlan({ myBalance, destBalance, rent: Number(rentRaw) || 890880 });
    if (!plan.ok) {
      throw new Error('残高が足りない（残高 ' + solText(myBalance) + '・要るのは ' + solText(plan.need) + '。送る額＋手数料＋自分に残す最低の額）');
    }
    const who = m.n || m.a;
    if (!window.confirm((m.n ? m.n + ' さん' : 'このメンバー') + 'のウォレットへ ' + solText(plan.amount) + ' を送る？（' + NETWORKS[net].label + '）\n'
      + '送り先: ' + m.a + '\n'
      + 'メッセージ約 ' + GIFT_MESSAGES + ' 通ぶんの手数料' + (plan.withRent ? '＋相手のウォレットを開くための最低の額' : '') + '。\n'
      + '送ったものは取り消せない（相手のウォレットのお金になる）。')) { line.textContent = 'やめた'; return; }
    line.textContent = '送っている…';
    await sweep(net, keys.wallet, m.a, plan.amount);
    line.textContent = solText(plan.amount) + ' を ' + who + ' に送った。';
  }

  function sharedRec(id) {
    const rec = loadShared()[id];
    if (!rec || rec.me !== cfg.address) throw new Error('この海の共有がこの端末に無い');
    return rec;
  }
  function putShared(rec) {
    const all = loadShared();
    all[rec.id] = rec;
    saveShared(all);
  }
  /* 鍵を開け（パスキーは押した手の続きで呼ぶ。ここより前で await しない）、海の鍵を出す */
  async function openShared(rec) {
    const keys = await unlock();
    await checkSame(keys);
    const seaKey = await unwrapSeaKey(rec, keys.recordKey);
    return { keys, seaKey };
  }
  async function needFunds(net, count) {
    const [bal, need] = await Promise.all([getBalance(net, cfg.address), needLamports(net, count)]);
    if (bal < need.fee + need.rent) {
      throw new Error('ウォレットの残高が足りない（残高 ' + solText(bal) + '・要るのは 手数料 ' + solText(need.fee)
        + ' ＋ 残しておく最低の額 ' + solText(need.rent) + '）。アドレスに SOL を入れてから押す');
    }
    return need;
  }
  function seaBox(id) {
    try { store.flush(); } catch (e) { /* 書くのは止めない */ }
    return collectBoxes()[id] || null;
  }
  function rosterInner(rec) {
    return { kind: 'roster', sea: rec.id, g: rec.gen, at: Date.now(), members: rec.members };
  }

  /* 「海をつくる」板を開き、作ったらその海で共有を始める。板の「つくる」を押した手の続きで鍵を開く（パスキーはそこで出る） */
  function makeSeaThenShare() {
    openSeaSheet(null, {
      note: '作ったら、続けてこの海の共有を始める（パスキーか合言葉を求め、チェーンに書く前に確かめる）。'
        + 'やめても海はこの端末に残り、あとで「自分の海に人を招く」の海の名前をタップすれば共有できる。',
      onMade: async (sea) => {
        curKey = 'share';
        line.textContent = '海「' + sea.name + '」を作った。共有を始める…';
        try { await shareSea(sea); } catch (e) {
          paint();
          curKey = 'share';
          line.textContent = ((e && e.message) || String(e)) + '（海はこの端末に残っている。上の海の名前をタップするとやり直せる）';
        }
      },
    });
  }

  /* 共有を始める（持ち主になる）。自分宛ての招待も書く（自分のほかの端末が「届いた招待を受け取る」で受け取れるように） */
  async function shareSea(sea) {
    const net = netSel.value;
    const keys = await unlock();
    await checkSame(keys);
    line.textContent = '鍵を作っている…';
    const myShare = await makeShareAddress(keys, net);
    const to = await readShareAddress(myShare);
    const seaKey = newSeaKey();
    const board = await boardOf(seaKey);
    const rec = { id: sea.id, net, gen: 1, owner: keys.wallet.address, me: keys.wallet.address,
      wrapped: await wrapSeaKey(seaKey, keys.recordKey, sea.id, 1, keys.wallet.address), board: board.address,
      members: [{ a: keys.wallet.address, x: myShare, n: '' }], savedAt: null, readAt: null };
    const env = await sealEnvelope({ network: net, sea, key: seaKey, gen: 1, owner: keys.wallet }, to);
    const roster = await postMemos(keys.wallet, rosterInner(rec), board);
    const need = await needFunds(net, 1 + roster.length);
    if (!window.confirm('「' + sea.name + '」を共有する？（' + NETWORKS[net].label + '）\n'
      + 'この海の鍵を作り、自分宛ての招待と名簿をチェーンに書く（取引 ' + (1 + roster.length) + ' 件・手数料の目安 ' + solText(need.fee) + '）。\n'
      + '続けて、招く人の受け取りIDを、この海の欄に貼って「招く」。')) { line.textContent = 'やめた'; return; }
    line.textContent = '書いている…';
    await writeEnvelope(net, keys.wallet, env, to.wallet);
    await writePost(net, keys.wallet, roster, board);
    putShared(rec);
    cfg = Object.assign(loadConfig(), { share: myShare });
    saveConfig(cfg);
    paint();
    curKey = 'sea:' + rec.id;
    line.textContent = '共有を始めた。招く人の受け取りIDを、この海の欄に貼って「招く」。自分の記録は「自分の変更を送る」で書く。';
  }

  /* 招く（持ち主だけ）。海の欄に貼った受け取りIDの人へ、封筒と新しい名簿を書く */
  async function inviteTo(id, text, nickRaw) {
    const net = netSel.value;
    const rec = sharedRec(id);
    if (!String(text || '').trim()) throw new Error('招く人の受け取りID（BTA1-…）を欄に貼ってから「招く」を押す');
    const nick = String(nickRaw || '').trim().slice(0, 24);
    /* パスキーは押した手の続きで呼ぶ（iPhone）。受け取りIDの確かめ（sha256 を待つ）は鍵を開けたあと */
    const { keys, seaKey } = await openShared(rec);
    const to = await readShareAddress(text);
    if (to.network !== net) throw new Error('相手の受け取りIDは ' + NETWORKS[to.network].label + ' のもの。ネットをそろえる');
    if ((rec.members || []).some(m => m.a === to.wallet)) throw new Error('この人はもうメンバー');
    if (rec.owner !== keys.wallet.address) throw new Error('招けるのは海の持ち主だけ');
    const board = await boardOf(seaKey);
    const next = Object.assign({}, rec, { members: cleanMembers((rec.members || []).concat([{ a: to.wallet, x: to.text, n: nick }])) });
    const sea = allEntries().find(e => e.id === id) || { id, name: id, color: 'magma', at: 0 };
    const env = await sealEnvelope({ network: net, sea, key: seaKey, gen: rec.gen, owner: keys.wallet }, to);
    const roster = await postMemos(keys.wallet, rosterInner(next), board);
    const need = await needFunds(net, 1 + roster.length);
    if (!window.confirm('「' + sea.name + '」に招く？\n相手のウォレット: ' + to.wallet + (nick ? '（' + nick + '）' : '')
      + '\n招待と新しい名簿をチェーンに書く（取引 ' + (1 + roster.length) + ' 件・手数料の目安 ' + solText(need.fee) + '）。'
      + '\n招いたことは取り消せない（外すときは「人を外す」で鍵を作り替える）。'
      + '\n相手のアドレスとこのウォレットのアドレスが、同じ海にいることはチェーンの上で見える。')) { line.textContent = 'やめた'; return; }
    line.textContent = '書いている…';
    await writeEnvelope(net, keys.wallet, env, to.wallet);
    await writePost(net, keys.wallet, roster, board);
    putShared(next);
    paint();
    curKey = 'sea:' + id;
    line.textContent = '招いた。相手に「届いた招待を受け取る」を押してもらう。自分の記録がまだなら「自分の変更を送る」。';
  }

  /* メンバーを外す（持ち主だけ）。海の欄の「外す: 名前」をタップした人を外し、海の鍵を作り替え、残る人にだけ新しい招待を書く */
  async function removeFrom(id, addr) {
    const net = netSel.value;
    const rec = sharedRec(id);
    const gone = (rec.members || []).find(m => m.a === addr && m.a !== rec.owner);
    if (!gone) throw new Error('この人はメンバーにいない');
    const { keys } = await openShared(rec);
    if (rec.owner !== keys.wallet.address) throw new Error('外せるのは海の持ち主だけ');
    const stay = (rec.members || []).filter(m => m.a !== gone.a);
    const lost = stay.filter(m => !m.x);
    if (lost.length) throw new Error('受け取りIDが分からないメンバーがいる（' + lost.map(m => m.n || shortAddr(m.a)).join('・') + '）。先に「みんなの変更を取り込む」で名簿を読む');
    const tos = await Promise.all(stay.map(m => readShareAddress(m.x)));
    const seaKey = newSeaKey();
    const gen = rec.gen + 1;
    const board = await boardOf(seaKey);
    const sea = allEntries().find(e => e.id === id) || { id, name: id, color: 'magma', at: 0 };
    const next = Object.assign({}, rec, { gen, board: board.address, members: stay,
      wrapped: await wrapSeaKey(seaKey, keys.recordKey, id, gen, keys.wallet.address), savedAt: null, readAt: null });
    const envs = [];
    for (const to of tos) envs.push({ to, text: await sealEnvelope({ network: net, sea, key: seaKey, gen, owner: keys.wallet }, to) });
    const roster = await postMemos(keys.wallet, rosterInner(next), board);
    const box = seaBox(id);
    const snap = box ? await postMemos(keys.wallet, { kind: 'snap', sea: id, g: gen, at: Date.now(), entry: sea, box }, board) : [];
    if (envs.length + roster.length + snap.length > MAX_TX * 2) throw new Error('取引が多すぎる（記録が大きい）');
    const count = envs.length + roster.length + snap.length;
    const need = await needFunds(net, count);
    if (!window.confirm('「' + sea.name + '」から ' + (gone.n || gone.a) + ' を外す？\n'
      + '海の鍵を作り替え（代 ' + rec.gen + ' → ' + gen + '）、残る ' + stay.length + ' 人（自分を含む）に新しい招待を書き、新しい掲示板に名簿と自分の記録を書く'
      + '（取引 ' + count + ' 件・手数料の目安 ' + solText(need.fee) + '）。\n'
      + '外した人は、これからの記録を読めない。ただし、これまでに書かれた記録は読める（チェーンの上のものは消せない）。\n'
      + 'ほかのメンバーには「届いた招待を受け取る」を押してもらう（押すまでは前の鍵のままで、新しい記録が見えない）。')) { line.textContent = 'やめた'; return; }
    let done = 0;
    for (const e of envs) {
      await writeEnvelope(net, keys.wallet, e.text, e.to.wallet);
      line.textContent = '書いている… ' + (++done) + '/' + count;
    }
    await writePost(net, keys.wallet, roster.concat(snap), board, {
      onStep: (i) => { line.textContent = '書いている… ' + (done + i) + '/' + count; },
    });
    if (snap.length) next.savedAt = Date.now();
    putShared(next);
    paint();
    curKey = 'sea:' + id;
    line.textContent = '外した（鍵の代 ' + gen + '）。残るメンバーに「届いた招待を受け取る」を押してもらう。';
  }

  /* 自分の記録を掲示板に書く */
  async function saveShared1(id) {
    const net = netSel.value;
    const rec = sharedRec(id);
    /* この海のチャットで直につながっている相手がいれば、チェーンではなく直に送る（2026-11-11 Issue #41。手数料なし・チェーンに残らない）。
       鍵はチャットを開いたときに開けてあるので、パスキーは求めない。画面は描き直さない（描き直すとチャットが閉じる） */
    if (chat && chat.gkey === 'sea:' + id && chat.sendSnap && chat.mesh && chat.mesh.openCount()) {
      curKey = 'sea:' + id;
      line.textContent = '直に送っている…';
      const n = await chat.sendSnap();
      if (n) {
        line.textContent = n + ' 台に直に送った（手数料なし・チェーンに残らない）。相手の端末では、届いたときに重なる。'
          + 'あとから開くメンバーにも届けたいときは、チャットを閉じてから「自分の変更を送る」でブロックチェーンに書く。';
        return;
      }
      /* ここからパスキーを求めると、押した手の続きでなくなる（iPhone で断られる）。もう一度押してもらう */
      line.textContent = '直に送れなかった（つながりが切れたかもしれない）。もう一度押すと、つながっていなければブロックチェーンに書く。';
      return;
    }
    const { keys, seaKey } = await openShared(rec);
    const board = await boardOf(seaKey);
    const box = seaBox(id);
    if (!box) throw new Error('この海の記録がこの端末に無い');
    const sea = allEntries().find(e => e.id === id);
    line.textContent = '作っている…';
    const memos = await postMemos(keys.wallet, { kind: 'snap', sea: id, g: rec.gen, at: Date.now(), entry: sea || null, box }, board);
    if (memos.length > MAX_TX) throw new Error('記録が大きすぎる（取引 ' + memos.length + ' 件に分かれる）');
    const need = await needFunds(net, memos.length);
    const todos = Array.isArray(box.doc && box.doc.todos) ? box.doc.todos.filter(t => t && !t.trashed).length : 0;
    if (!window.confirm('「' + (sea ? sea.name : id) + '」の自分の記録を共有の掲示板に書く？\ntodo ' + todos + ' 件・取引 ' + memos.length
      + ' 件・手数料の目安 ' + solText(need.fee) + '\n書いたものは消せない（メンバーだけが読める）。')) { line.textContent = 'やめた'; return; }
    await writePost(net, keys.wallet, memos, board, { onStep: (i, n) => { line.textContent = '書いている… ' + i + '/' + n; } });
    putShared(Object.assign(sharedRec(id), { savedAt: Date.now() }));
    paint();
    curKey = 'sea:' + id;
    line.textContent = '送った（取引 ' + memos.length + ' 件）。ほかのメンバーは「みんなの変更を取り込む」で重ねる。';
  }

  /* 掲示板を読み、メンバーごとにいちばん新しい記録を重ねる */
  async function readShared1(id) {
    const rec = sharedRec(id);
    const { seaKey } = await openShared(rec);
    await readWith(rec, seaKey);
  }
  async function readWith(rec, seaKey) {
    const id = rec.id;
    line.textContent = '掲示板を読んでいる…';
    const got = await readBoard(rec.net, rec, seaKey);
    let next = sharedRec(id);
    if (got.members) next = Object.assign(next, { members: got.members });
    const snaps = got.snaps;
    if (!snaps.length) {
      putShared(next);
      paint();
      curKey = 'sea:' + id;
      line.textContent = 'まだ誰も記録を書いていない（鍵の代 ' + rec.gen + '）。読めないときは、持ち主が鍵を作り替えたかもしれないので「届いた招待を受け取る」を押す。';
      return;
    }
    const nameOf = a => (a === cfg.address ? '自分' : ((next.members || []).find(m => m.a === a) || {}).n || shortAddr(a));
    if (!window.confirm('共有の記録を重ねる？\n' + snaps.map(s => nameOf(s.by) + '（' + new Date(s.at).toLocaleString() + '）').join('\n')
      + '\nいまの記録は消さずに重ねる（記録ごとに新しく書き換えたほうが残る）。')) { line.textContent = 'やめた'; return; }
    /* 写しの中の海の ID は見ず、この海の箱にだけ重ねる（メンバーがほかの海を書き換えられないように） */
    snaps.forEach(s => {
      const entry = s.entry && s.entry.id === id ? s.entry : null;
      mergeIntoDevice({ seas: entry ? [entry] : [], boxes: { [id]: s.box } });
    });
    putShared(Object.assign(next, { readAt: Date.now() }));
    paint();
    curKey = 'sea:' + id;
    line.textContent = snaps.length + ' 人ぶんの記録を重ねた。';
  }

  /* 自分のウォレットに届いた招待を開け、新しいもの（初めての海・新しい代の鍵）を受け取る */
  async function acceptInvites() {
    const net = netSel.value;
    const keys = await unlock();
    await checkSame(keys);
    line.textContent = '招待を探している…';
    const found = await findInvites(net, keys);
    const all = loadShared();
    const fresh = found.filter(f => {
      const r = all[f.sea.id];
      return !r || r.me !== keys.wallet.address || f.gen > r.gen;
    });
    if (!fresh.length) {
      line.textContent = found.length ? '新しい招待は無い（受け取った招待は ' + found.length + ' 件。どれも受け取り済み）。' : '招待は届いていない（' + NETWORKS[net].label + '）。';
      return;
    }
    let took = 0;
    for (const f of fresh) {
      const mine = f.owner === keys.wallet.address;
      const local = allEntries().find(e => e.id === f.sea.id && e.alive);
      if (local && !all[f.sea.id] && !mine) {
        line.textContent = '「' + f.sea.name + '」の招待は受け取れない（この端末に同じ ID の別の海がある）。';
        continue;
      }
      const again = all[f.sea.id] && all[f.sea.id].me === keys.wallet.address;
      if (!window.confirm((again ? '「' + f.sea.name + '」の新しい鍵（代 ' + f.gen + '）を受け取る？' : '海「' + f.sea.name + '」に招かれている。受け取る？')
        + '\n招いた人のウォレット: ' + (mine ? '自分' : f.owner)
        + '\n受け取ると、この海がこの端末に足され、メンバーの記録を読み込む。')) continue;
      const board = await boardOf(f.key);
      const prev = all[f.sea.id];
      const rec = { id: f.sea.id, net, gen: f.gen, owner: f.owner, me: keys.wallet.address,
        wrapped: await wrapSeaKey(f.key, keys.recordKey, f.sea.id, f.gen, keys.wallet.address), board: board.address,
        members: (prev && prev.me === keys.wallet.address && prev.members) || [], savedAt: null, readAt: null };
      putShared(rec);
      all[f.sea.id] = rec;
      if (!local) mergeSeas([f.sea]);
      took++;
      curKey = 'share-in';
      await readWith(rec, f.key);
    }
    paint();
    curKey = 'share-in';
    line.textContent = took ? '招待を ' + took + ' 件受け取った。' : (line.textContent || 'どれも受け取らなかった。');
  }

  async function writeBackup() {
    const net = netSel.value;
    const keys = await unlock();
    await checkSame(keys);
    const r = await saveBackup(keys, net);
    if (!r) return;
    cfg = Object.assign(loadConfig(), { lastAt: r.at, lastId: r.id, lastCount: r.count });
    saveConfig(cfg);
    line.textContent = 'バックアップを保存した（取引 ' + r.count + ' 件）。';
    paint();
  }

  /* いまの記録を keys のウォレットでチェーンに書く → { id, count, at }。確かめの画面でやめたら null */
  async function saveBackup(keys, net) {
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
    /* 縮めた効き目を見せる（Issue #31 の返事: 圧縮で節約できているか） */
    const rawBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    const sealedBytes = Math.round(memos.reduce((n, m) => n + m.slice(m.lastIndexOf(' ') + 1).length, 0) * 3 / 4);
    const kb = b => (b / 1024).toFixed(1) + ' KB';
    if (!window.confirm(NETWORKS[net].label + ' にバックアップを保存する？\n海 ' + sum.seas + ' つ・todo ' + sum.todos + ' 件'
      + '\n大きさ ' + kb(rawBytes) + ' → 縮めて暗号化 ' + kb(sealedBytes)
      + '（' + Math.round(sealedBytes / Math.max(1, rawBytes) * 100) + '%）'
      + '\n取引 ' + memos.length + ' 件・手数料の目安 ' + solText(need.fee)
      + '\n書いたものは消せない（暗号化してある）。')) { line.textContent = 'やめた'; return null; }
    const sigs = await writeMemos(net, keys.wallet, memos, {
      onStep: (i, n) => { line.textContent = '書いている… ' + i + '/' + n; },
    });
    return { id: memos[0].split(' ')[1], count: sigs.length, at: Date.now() };
  }

  /* ---- 鍵の移し替え（2026-11-11 Issue #39。#31 の2段目） ----
     1. 新しい鍵を作る → 2. 前のウォレットの残高を新しいアドレスへ送る → 3. 記録を新しいウォレットにバックアップする。
     段ごとにボタンを分ける（パスキーは押した手の続きで1回しか呼べない端末があるため、1回押すと鍵を1つだけ出す）。
     いま開いている鍵（cfg）は、3 が済むまで前の鍵のまま。済んだら新しい鍵に替えて、移し替えの記録を消す。
     途中の様子は chain.js の loadMove・saveMove（秘密は置かない）。 */
  function currentMove() {
    const m = loadMove();
    /* 前の鍵で開いているときだけ続ける（ほかの鍵へ切り替えたら出さない。前の鍵に戻せば、また出る） */
    return m && m.from && m.from.address === cfg.address ? m : null;
  }

  function paintMove(m) {
    const step = moveStep(m);
    const what = s => (s && s.mode === 'passkey') ? 'パスキー' : '合言葉';
    group('move', '鍵の移し替え（途中）',
      '前の鍵（' + what(m.from) + '）のウォレットから、新しい鍵のウォレットへ移す。1から順に押す。途中でやめても、ここに続きが残る。'
      + 'ネット: ' + NETWORKS[m.network].label + '。');
    const list = el('ol', 'note');
    list.style.cssText = 'margin:4px 0 0 1.4em;padding:0';
    moveSteps(m).forEach(s => {
      const mark = s.state === 'done' ? '✓ 済み' : (s.state === 'next' ? '→ 次' : 'まだ');
      const li = el('li', null);
      li.textContent = s.label + '　' + mark + (s.detail ? '（' + s.detail + '）' : '');   /* アドレスは端末に置いた値なので文字として入れる */
      if (s.state === 'next') li.style.fontWeight = 'bold';
      list.appendChild(li);
    });
    into.parentNode.insertBefore(list, into);
    if (netSel.value !== m.network) {
      inlineText('移し替えは ' + NETWORKS[m.network].label + ' で始めた。上のネットを戻すと続けられる。');
    } else if (step === 'key') {
      if (m.to && m.to.credId && !m.to.address) {
        btn('1. いま作ったパスキーで続ける', async () => {
          const got = await passkeyRoot(m.to.credId);
          await moveKeyReady(m, 'passkey', await keysFromRoot(got.root), got.credId);
        });
      }
      if (prfSupported()) {
        btn('1. パスキーを新しく作る', async () => {
          const made = await createPasskey();
          let got = made;
          if (!made.root) {
            /* 作ったときに値を返さない端末がある。続けて出す。断られたら、もう一度押してもらう */
            try { got = await passkeyRoot(made.credId); } catch (e) {
              saveMove(Object.assign(m, { to: { mode: 'passkey', credId: made.credId, address: null } }));
              paint();
              curKey = 'move';
              throw new Error('パスキーは作れた。続けて「1. いま作ったパスキーで続ける」を押す');
            }
          }
          await moveKeyReady(m, 'passkey', await keysFromRoot(got.root), got.credId);
        });
      }
      btn('1. 合言葉で新しく作る', async () => {
        const pass = makePassphrase();
        if (!window.confirm('新しい合言葉: ' + pass + '\n\nこれを紙に書き留めてから OK を押す。3（バックアップ）でもう一度打つ。'
          + '合言葉はウォレットとバックアップの両方を開く（漏れるとお金も記録も取られる）。忘れたら開けない。app はどこにも置かない。')) return;
        line.textContent = '鍵を作っている…';
        await moveKeyReady(m, 'pass', await keysFromRoot(await rootFromPassphrase(pass)), null);
      });
    } else if (step === 'send') {
      btn('2. 前のウォレットの残高を送る', async () => {
        const keys = await unlock();   /* 前の鍵（いま開いているもの）。パスキーは押した手の続きで呼ぶ */
        await checkSame(keys);
        line.textContent = '残高を確かめている…';
        let plan;
        try { plan = await planSweep(m.network, keys.wallet.address, m.to.address); } catch (e) {
          throw new Error(e.message + '。送れないときは「2. 送らずに次へ」');
        }
        if (!window.confirm('前のウォレットの残高を全部、新しいウォレットへ送る？\n送り先（新しい' + what(m.to) + 'のウォレット）: ' + m.to.address
          + '\n送る額: ' + solText(plan.amount) + '（手数料 ' + solText(plan.fee) + ' を引いた残り）\nネット: ' + NETWORKS[m.network].label
          + '\n送ったものは取り消せない。')) { line.textContent = 'やめた'; return; }
        line.textContent = '送っている…';
        const tx = await sweep(m.network, keys.wallet, m.to.address, plan.amount);
        saveMove(Object.assign(m, { sent: { amount: plan.amount, tx, at: Date.now() } }));
        paint();
        curKey = 'move';
        line.textContent = solText(plan.amount) + ' を送った。続けて「3. 新しいウォレットにバックアップする」。';
      });
      btn('2. 送らずに次へ', async () => {
        if (!window.confirm('前のウォレットの残高を送らずに次へ進む？\n'
          + '前のウォレットに残った SOL は、あとで前の鍵に切り替え直さないと送り出せない。')) return;
        saveMove(Object.assign(m, { sent: { amount: 0, skipped: true, at: Date.now() } }));
        paint();
        curKey = 'move';
        line.textContent = '送らずに進めた。新しいウォレットに SOL が無ければ、3 の前に新しいアドレスへ入れる。';
      });
    } else if (step === 'backup') {
      btn('3. 新しいウォレットにバックアップする', async () => {
        const keys = await unlockNew(m);
        const r = await saveBackup(keys, m.network);
        if (!r) return;
        saveMove(Object.assign(m, { backup: { id: r.id, count: r.count, at: r.at } }));
        finishMove(m, { lastAt: r.at, lastId: r.id, lastCount: r.count });
        line.textContent = '移し替えが済んだ。これからは新しい' + what(m.to) + 'で開く（バックアップ: 取引 ' + r.count + ' 件）。'
          + (m.from.mode === 'passkey' ? '前のパスキーが要らなければ、端末のパスワードの管理で消す（app からは消せない）。' : '前の合言葉の紙は、もう要らない。');
      });
      btn('3. 保存せずに新しい鍵に切り替える', async () => {
        if (!window.confirm('バックアップを保存せずに、新しい' + what(m.to) + 'に切り替える？\n'
          + '記録はこの端末に残るが、チェーンの上の新しいウォレットにはまだバックアップが無い（あとで「バックアップを保存」で書ける）。')) return;
        saveMove(Object.assign(m, { backup: { skipped: true, at: Date.now() } }));
        finishMove(m, { lastAt: null, lastId: null, lastCount: null });
        line.textContent = '新しい' + what(m.to) + 'に切り替えた。新しいウォレットに SOL を入れてから「バックアップを保存」を押す。';
      });
    }
    btn('移し替えをやめる', async () => {
      const warn = m.sent && !m.sent.skipped
        ? '残高はもう新しいウォレット（' + m.to.address + '）へ送ってある。やめると前の鍵のままになり、新しいウォレットの SOL は新しい鍵に切り替えないと使えない。\n'
        : '';
      if (!window.confirm(warn + '鍵の移し替えをやめる？（前の鍵のまま。作った新しい鍵・合言葉は使わない）')) return;
      clearMove();
      paint();
      line.textContent = '移し替えをやめた。';
    });
  }

  /* 1 が済んだ: 新しい鍵のアドレスを覚え、新しい鍵の復元コードを見せる */
  async function moveKeyReady(m, mode, keys, credId) {
    if (keys.wallet.address === m.from.address) {
      throw new Error('前と同じ鍵（同じウォレット）になった。別のパスキーか、新しい合言葉を作る');
    }
    saveMove(Object.assign(m, { to: { mode, credId: credId || null, address: keys.wallet.address } }));
    paint();
    curKey = 'move';
    await showRecovery(keys, m.network);
    line.textContent = '新しい鍵を作った（新しいアドレス ' + keys.wallet.address + '）。'
      + line.textContent + '　続けて「2. 前のウォレットの残高を送る」。';
  }

  /* 新しい鍵を出してもらう（パスキーは押した手の続きで呼ぶ。ここより前で await しない） */
  async function unlockNew(m) {
    let keys;
    if (m.to.mode === 'passkey') {
      keys = await keysFromRoot((await passkeyRoot(m.to.credId)).root);
    } else {
      const pass = window.prompt('新しい合言葉（1 で書き留めた 24 字）');
      if (!pass) throw new Error('やめた');
      line.textContent = '鍵を作っている…';
      keys = await keysFromRoot(await rootFromPassphrase(pass));
    }
    if (keys.wallet.address !== m.to.address) throw new Error('鍵が違う（1 で作った新しいウォレットのアドレスと合わない）');
    return keys;
  }

  /* 3 が済んだ（または保存せずに進めた）: 開く鍵を新しいものに替え、移し替えの記録を消す */
  function finishMove(m, last) {
    cfg = Object.assign(loadConfig(), { network: m.network, mode: m.to.mode, credId: m.to.credId || null, address: m.to.address }, last);
    saveConfig(cfg);
    clearMove();
    paint();
    curKey = 'wallet';
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
    const got = await passkeyRoot(null);
    await switchTo('passkey', await keysFromRoot(got.root), got.credId);
  }
  /* 合言葉を切り替える（2026-11-11 Issue #31 の返事: パスキーを切り替えると対になるもの）。
     ほかの合言葉（＝別のウォレット）を打って替える。パスキーで開いていても、合言葉のウォレットへ替えられる */
  async function switchPassphrase() {
    const pass = window.prompt('切り替える先の合言葉（24 字）');
    if (!pass) return;
    line.textContent = '鍵を作っている…';
    await switchTo('pass', await keysFromRoot(await rootFromPassphrase(pass)), null);
  }
  async function switchTo(mode, keys, credId) {
    const net = netSel.value;
    const what = mode === 'passkey' ? 'パスキー' : '合言葉';
    if (keys.wallet.address === cfg.address) {
      line.textContent = '同じ' + what + '（同じウォレット）を選んだ。変わらない。';
      return;
    }
    if (cfg.address) {
      let old = 0;
      try { old = await getBalance(net, cfg.address); } catch (e) { old = 0; }
      if (old > 0 && !window.confirm('前のウォレット（' + cfg.address + '）に ' + solText(old) + ' 残っている。\n'
        + '切り替えたあとで送り出すには、前の鍵に切り替え直す必要がある。\n新しい鍵を作って移すなら「キャンセル」→「新しい鍵へ移し替える」（残高と記録を順に移す）。'
        + '\n作ってある鍵へ先に送るなら「キャンセル」→「残高を別のアドレスへ送る」に、選んだ' + what + 'のウォレットのアドレスを貼る:\n'
        + keys.wallet.address + '\n切り替える？')) {
        line.textContent = 'やめた（前の鍵のまま）。選んだ' + what + 'のウォレットのアドレス: ' + keys.wallet.address;
        return;
      }
    }
    cfg = Object.assign(loadConfig(), { network: net, mode, credId: credId || null, address: keys.wallet.address,
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

  /* ほかの箱から「やりたいこと」を選んで開く（Issue #43 の返事:「記録を保存する・読み込む」→ ブロックチェーン）。
     まだ始めていなければ、鍵を選ぶ画面のまま */
  wrap.openTask = k => { if (cfg.mode) { task = k; paint(); } };

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
  /* service worker の登録が無い（このブラウザに仕組みが無いときも）ときは、強制更新する
     （画面のキャッシュを消して読み直す。2026-11-12 利用者の指示） */
  const force = () => {
    try { store.flush(); } catch (e) { /* 読み直すのは止めない */ }
    toast('この端末は自動の入れ替えを使っていない。画面のキャッシュを消して、最新の版を読み直す…');
    setTimeout(() => { forceReload(); }, 600);
  };
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const btn = el('button', 'btn', '最新の版を確認する');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    if (!('serviceWorker' in navigator)) { force(); return; }
    checkForUpdate().then((found) => {
      if (found === null) { force(); return; }
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
  status.setAttribute('aria-live', 'polite');   /* 状態の行。説明の文として畳まない（Issue #40） */
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
   ・キーはヘルプと先の予定の両方で使うので、節の名前を「ヘルプと AI」にした
   ・2026-11-11 Issue #45: ヘルプは設定の上の1行へ分け、箱の名前を「AI を使う設定をする」、節を「AI の API キーとモデル」にした */
function maskKey(k) { const s = String(k || ''); return s ? '…' + s.slice(-4) : ''; }

/* 2026-11-11 Issue #45: 「ヘルプを開く」は設定の上の1行（使い方の下）へ分けた。ここは AI の API キーとモデルだけ。
   キーの欄が空の欄と「保存」だけでは何を入れるのか分からない、という指摘で、欄の上に「何を入れるか・何に使うか・どこで取るか」を
   いつも見える字で出す（p.note ではないので ⓘ の裏に隠れない） */
function helpAiBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, 'AI の API キーとモデル'));
  const selCss = 'font:inherit;font-size:16px;min-height:40px;padding:0 8px;border-radius:10px;'
    + 'border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';

  /* --- AI の会社（2026-11-12 Issue #46 の A 案）。選べるのは js/ai.js の PROVIDERS の 3 社だけ。
     キーとモデルは会社ごとに別に覚える。切り替えても、ほかの会社のキーは消さない --- */
  const provRow = el('label', 'row');
  provRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center;font-size:13.5px';
  provRow.appendChild(el('span', null, 'AI の会社'));
  const provSel = document.createElement('select');
  provSel.setAttribute('aria-label', 'AI の会社');
  provSel.style.cssText = selCss;
  PROVIDER_IDS.forEach(id => {
    const op = document.createElement('option');
    op.value = id;
    op.textContent = providerLabel(id) + (hasKey(id) ? '（キーあり）' : '');
    provSel.appendChild(op);
  });
  provSel.value = getProvider();
  provRow.appendChild(provSel);
  wrap.appendChild(provRow);

  const body = el('div', 'aibody');
  wrap.appendChild(body);
  provSel.addEventListener('change', () => {
    if (!setProvider(provSel.value)) { toast('保存できなかった'); return; }
    toast(providerLabel() + ' を使う（次に訊くときから）');
    renderAll();
  });

  function renderAll() {
  body.textContent = '';
  const P = providerInfo();
  /* 選択肢の「（キーあり）」を今の状態に合わせる */
  [...provSel.options].forEach(op => { op.textContent = providerLabel(op.value) + (hasKey(op.value) ? '（キーあり）' : ''); });
  body.appendChild(textEl('p', 'note',
    'AI（' + P.label + '）は、ここに入れた API キーで動く。ヘルプで訊く・本文の AI・おすすめの選び直し・この端末の表示をチャットで変えるときに使う。'
    + 'ヘルプで送るのは質問の文とこの app の説明・版・画面だけ（バブルの本文は送らない）。'));
  /* Web で調べるものが使えないことは、ⓘ の裏に隠さない（p.note にしない） */
  if (!canSearch()) {
    const ns = textEl('p', 'aikey-lb', '先の予定と「AI で調べる」「AI に訊く」（Web で調べるもの）は、今は Anthropic を選んだときだけ使える。');
    ns.style.cssText = 'margin:6px 0 0;font-size:13px';
    body.appendChild(ns);
  }

  /* --- API キー --- */
  const keyBox = el('div', 'aikey');
  body.appendChild(keyBox);
  function renderKey(editing) {
    keyBox.textContent = '';
    if (!hasKey() || editing) {
      /* 何を入れる欄かを、欄の上に出す（Issue #45） */
      const lb = el('p', 'aikey-lb');
      lb.style.cssText = 'margin:8px 0 0;font-size:13.5px';
      lb.appendChild(textEl('span', null, editing
        ? '新しい ' + P.label + ' の API キーを貼り付けて「キーを保存」を押す。'
        : 'AI を使うには、' + P.label + ' の API キー（' + P.keyHint + '）を下の欄に貼り付けて「キーを保存」を押す。キーが無くてもヘルプの記事は読める。'));
      keyBox.appendChild(lb);
      const how = el('p', 'aikey-lb');
      how.style.cssText = 'margin:4px 0 0;font-size:13px';
      const a = el('a', null);
      a.textContent = 'キーを取る（' + P.keyPlace + '）';
      a.href = P.keyUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      how.appendChild(a);
      keyBox.appendChild(how);
    }
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
      rm.addEventListener('click', () => { setKey(''); toast('キーを消した'); renderAll(); });
      row.appendChild(st); row.appendChild(ch); row.appendChild(rm);
      keyBox.appendChild(row);
      return;
    }
    const keyIn = document.createElement('input');
    keyIn.type = 'password';
    keyIn.autocomplete = 'off';
    keyIn.placeholder = P.keyPrefix + '…（' + P.keyPlace + ' で発行）';
    keyIn.setAttribute('aria-label', P.label + ' の API キー');
    keyIn.style.cssText = 'flex:1;min-width:160px;font:inherit;font-size:16px;min-height:44px;'
      + 'padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';
    const save = () => {
      const v = keyIn.value.trim();
      if (!v) { toast('キーを貼り付けてから保存する'); return; }
      if (!setKey(v)) { toast('保存できなかった'); return; }
      toast(v.indexOf(P.keyPrefix) === 0 ? 'キーを保存した'
        : 'キーを保存した（' + P.keyPrefix + ' で始まっていない。違う会社のキーかもしれない）');
      renderAll();
    };
    keyIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); save(); } });
    const sv = el('button', 'btn', 'キーを保存');
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
      + P.keyPlace + ' の側で、この app 専用のキーと使える上限額を決めておくと安心。'));
    if (editing) setTimeout(() => keyIn.focus(), 0);
  }
  renderKey(false);

  /* --- モデル（2026-11-05 Issue #13「使っているモデルはなに？どうやって変える？」）。
     会社ごとの一覧＋「手で入れる」（一覧に無い新しいモデル名。Issue #46） --- */
  const CUSTOM_OPT = '__custom__';
  const modelRow = el('label', 'row');
  modelRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;font-size:13.5px';
  modelRow.appendChild(el('span', null, 'AI のモデル'));
  const modelSel = document.createElement('select');
  modelSel.setAttribute('aria-label', 'AI のモデル');
  modelSel.style.cssText = selCss;
  modelsFor().forEach(m => { const op = document.createElement('option'); op.value = m.id; op.textContent = m.label; modelSel.appendChild(op); });
  const cOp = document.createElement('option');
  cOp.value = CUSTOM_OPT;
  cOp.textContent = '一覧に無いモデル名を手で入れる…';
  modelSel.appendChild(cOp);
  const choice = getModelChoice();
  modelSel.value = choice.custom ? CUSTOM_OPT : choice.id;
  modelRow.appendChild(modelSel);
  body.appendChild(modelRow);

  const customRow = el('div', 'row');
  customRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';
  const customIn = document.createElement('input');
  customIn.type = 'text';
  customIn.autocomplete = 'off';
  customIn.spellcheck = false;
  customIn.placeholder = 'モデル名（例 ' + P.defaultModel + '）';
  customIn.setAttribute('aria-label', '手で入れるモデル名');
  customIn.value = choice.custom ? choice.id : '';
  customIn.style.cssText = 'flex:1;min-width:160px;font:inherit;font-size:16px;min-height:44px;'
    + 'padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';
  const customSave = el('button', 'btn', 'このモデルにする');
  customSave.type = 'button';
  const saveCustom = () => {
    const v = customIn.value.trim();
    if (!validModelName(v)) { toast('モデル名は英数字と . _ : - だけで書く'); return; }
    toast(setCustomModel(v) ? 'モデルを ' + v + ' にした（次に訊くときから）' : '保存できなかった');
  };
  customSave.addEventListener('click', saveCustom);
  customIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); saveCustom(); } });
  customRow.appendChild(customIn); customRow.appendChild(customSave);
  /* style の display:flex が hidden 属性に勝つので、出し入れは display で行う */
  const showCustom = on => { customRow.style.display = on ? 'flex' : 'none'; };
  showCustom(choice.custom);
  body.appendChild(customRow);

  modelSel.addEventListener('change', () => {
    if (modelSel.value === CUSTOM_OPT) {
      showCustom(true);
      setTimeout(() => customIn.focus(), 0);
      return;
    }
    showCustom(false);
    toast(setModel(modelSel.value) ? 'モデルを変えた（次に訊くときから）' : '保存できなかった');
  });
  body.appendChild(el('p', 'note', 'ヘルプ・先の予定・本文の AI のどれもこのモデルで動く。上ほど賢いが、1 回ごとの料金も上がる。'
    + '料金はキーを出した会社からキーの持ち主に掛かる。この端末にだけ置く。'));
  }
  renderAll();

  const repoRow = el('p', 'note');
  const repoLink = el('a', null, 'GitHub: ' + REPO);
  repoLink.href = 'https://github.com/' + REPO;
  repoLink.target = '_blank';
  repoLink.rel = 'noopener noreferrer';
  repoRow.appendChild(repoLink);
  wrap.appendChild(repoRow);

  return wrap;
}

/* ヘルプの画面を開く（設定の上の「ヘルプを開く」から。Issue #45 で helpAiBox から分けた） */
function openHelpScreen(was) {
  openHelp({
    repo: REPO, app: 'bubble_todo', version: '0.1.0', was,
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
  wrap.appendChild(el('h3', null, 'この端末の表示を変える'));
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
    + '送るのは書いた文と、上の項目・今の値だけ（泡の中身は送らない）。変える前に確かめる。API キーは「AI を使う設定をする」で入れる。'));
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
    if (!hasKey()) { out.appendChild(el('p', 'note', 'API キーがまだ入っていない。「AI を使う設定をする」に入れると使える（上の項目は手でも変えられる）。')); return; }
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
  wrap.appendChild(el('h3', null, '先の予定を AI で探す'));
  wrap.appendChild(el('p', 'note',
    '調べたい予定やキャンペーン（FOMC・決算日・セール・支払いの還元など）を書いて送ると、AI が日付と説明を調べ、その少し前に今日へ出す。'));
  const last = el('p', 'note');
  last.setAttribute('aria-live', 'polite');     /* 前に調べた日（状態の行）。説明の文として畳まない（Issue #40） */
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
  sum.textContent = '画面の大きさを記録する（不具合を調べる用）';
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
