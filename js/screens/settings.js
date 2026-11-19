/* 設定。タグの管理・音のオン/オフ・サーバー・プロトタイプ確認用の操作。

   タグを置く向きは上・左・右の3つしかなく、タグは何個でも作れる。
   だから「どのタグをどの向きに置くか」を決める場所が要る。それがここ。
   本番に入れるつもりのものは「タグ」と「音」で、いちばん下の3つは確認用。 */

import { el, toast, escapeHtml } from '../ui.js';
import { store, SPACE_KEY } from '../store.js';
import { isOn, setOn, isSfxOn, setSfxOn, playSfx } from '../sound.js';
import { isAffinityOn, setAffinityOn } from '../related.js';
import { sync, checkUrl } from '../sync.js';
import { open as openUserCard, paintAvatar } from '../userchip.js';
import { meInfo as meNow, serverLogin as loggedIn, ME_EVENT as ME_EV } from '../me.js';
import { passkeySupported, registerPasskey, loginPasskey, logoutPasskey, authMode, makeMoveKey,
  requestRegistration, requestStatus } from '../passkey.js';
import { deviceLabel } from '../device.js';
import { seaName, seaList, allEntries, mergeSeas, boxKey, ID_RE,
  findSea, addSea, setSeaRegion, cleanId, NAME_MAX, colorMark, removeSea } from '../spacelist.js';
import { isPersonal, PERSONAL_RE, allSpaceIds, regionList, findRegion, personalId, seasOf, regionOfSpace, defaultRegionId,
  addServerRegion, renameRegion, removeRegion, localHasLegacy, REGION_NAME_MAX,
  allSeas, serverRegions, serverByUrl,
  regionsPayload, pickForPayload, importRegions, remapPayload } from '../regions.js';
import { makePassphrase, buildPayload, encryptMove, decryptMove, readMoveHead, moveSummary, moveFileName,
  boxToState, stateToBox, mergeBox } from '../movefile.js';
import { NETWORKS, MAX_TX, MAX_PARTS, backupSize, CONFIG_KEY, loadConfig, saveConfig, rootFromPassphrase, keysFromRoot, makeRecoveryCode,
  readRecoveryCode, sealToMemos, openMemos, readLatestMemos, writeMemos, getBalance, requestAirdrop, needLamports, rpc,
  prfSupported, createPasskey, passkeyRoot, solText, FAUCET_URL, planSweep, sweep,
  loadMove, saveMove, clearMove, moveStep, moveSteps, isAddress } from '../chain.js';
import { makeShareAddress, readShareAddress, newSeaKey, boardOf, wrapSeaKey, unwrapSeaKey, sealEnvelope, writeEnvelope,
  findInvites, postMemos, writePost, readBoard, loadShared, saveShared, sharedFor, cleanMembers, shortAddr,
  chatBoardOf, readChatPosts, MSG_MAX, SELF_SEA, GIFT_MESSAGES, giftPlan,
  makeInviteCode, readInviteCode, inviteBoxOf, sealInvite, writeInvite, findInviteByCode, joinsOf, acceptedSnaps, INVITE_DAYS,
  readBoardWith, readKeysOf, readBoardsOf } from '../board.js';
import { Mesh, loadP2pPrefs, saveP2pPrefs, iceServers, p2pSupported, deviceId, loadHistory, saveHistory, mergeHistory, markState,
  signMsg, messagesFromPosts, signSnap, HELLO_MS } from '../p2p.js';
/* ひとことの端末の印（消せるのは自分の端末で書いたものだけ）。p2p の deviceId とは別の印 */
import { deviceId as noteDevice, noteName, setNoteName, canRemove, NOTE_MAX, BY_MAX, chatCopies, CHAT_TODO } from '../notes.js';
import { signNote, holdWallet } from '../notesign.js';
import { checkForUpdate, applyUpdate, forceReload } from '../update.js';
import { openSeaSheet } from '../space.js';
import { seaPanel, loginState } from './seapanel.js';
import { personalBackups, backupState } from '../oneserver.js';
import { canServerBackup, saveServerBackup, listServerBackups, getServerBackup } from '../serverbackup.js';
import { replaceState, addState } from '../merge.js';
import { collectApps, deliverApps } from '../appbundles.js';
import { folderBackup, folderBackupSupported, openBackup, encryptedHead, backupFileName, buildBackup } from '../folderbackup.js';
import {
  hasKey, isKeyLocked, isKeyPlain, keyTail, keyLock, keyOpen, lockNow, saveKeyLocked, lockPlainKey, removeKey, getModelChoice, setModel, setCustomModel, validModelName, modelsFor, askFull,
  PROVIDER_IDS, getProvider, setProvider, providerInfo, providerLabel, canSearch,
} from '../ai.js';
import { aiOn } from '../edition.js';
import { PASS_MIN as AIKEY_PASS_MIN, OPEN_MS as AIKEY_OPEN_MS } from '../aikey.js';
import { ITEMS, PAGES, BOARD_SHOW_FEW, TAB_LABEL, PREFS_EVENT, loadPrefs, savePrefs, defaults, applyChanges, changeLines,
  changedFromDefault, buildPrefsPrompt, readPrefsReply, proposalText, proposalTitle } from '../prefs.js';
import { openHelp } from '../help.js';
import { askText } from '../asktext.js';
import { startChainWatch, markChainSeen } from '../chainwatch.js';
import { openUpcoming, lastLine } from '../upcoming.js';
import { clearAppStorage, confirmed, CONFIRM_WORD } from '../reset.js';

/* 海は横一列に並ぶようになった（利用者の指示：タグ付き海を10個まで）。
   前はここに「左／右／置かない」の選び欄があったが、10個に**向き**は無い。
   ここは「海にするか、しないか」だけを持つ。**並べ替えは海の引き**（長押し）にある
   ——順番はその場で見えているところで触るのが素直なので。 */

/* 固有枠に入っているタグの、向きの見出し。選び欄の代わりにこれを出す */
const FIXED_LABEL = { up: '上', down: '下', left: '左', right: '右' };

/* ブロックチェーンで海を共有する流れ（2026-11-15 Issue #68「どうやって操作したらいいのかわからない。相手の公開アドレス入れるの？」）。
   chainBox の中の group の説明は HTML として入る。宣言前の参照（Issue #63）にならないよう、ファイルの上に置く */
/* 招待コードの形にした（同日 Issue #68 の返事「招く側のみ…書き出して、招かれる側はそれを読み込むだけにできない？」→「おすすめで」）。
   相手から受け取りIDをもらう往復が無くなった */
/* 2026-11-16 Issue #68 の A 案で、共有の面（カード → ＋ 海を共有する → 招待コードを受け取る）の名前に合わせて書き直した */
/* ブロックチェーンの鍵とウォレットの箱の名前（2026-11-16 Issue #74。前は「ブロックチェーンを準備する」）。文の中の案内もこの名前で書く */
const PREP_NAME = 'ブロックチェーンの鍵とウォレット';
/* 招待コードの種類を形で見分ける（2026-11-16 Issue #74 の A 案の (d)。受け取る欄を 1 つにした）。
   'chain' = ブロックチェーンの招待コード（BTI1-…。js/board.js の makeInviteCode）、
   'server' = サーバーのパスキーの招待コード（ABCD-EFGH-JKLM の形。passkey_store.py の add_invite_full が _CODE_ABC から 12 字を作り、
              4 字ずつ - でつなぐ。サーバーは大文字にして区切りを無視する）、
   'unknown' = どちらでもない */
export function inviteKind(text) {
  const t = String(text || '').trim();
  if (/^BTI1-/i.test(t)) return 'chain';
  const core = t.replace(/[\s-]/g, '').toUpperCase();
  if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(core) && /^[A-Za-z0-9]+(?:[\s-][A-Za-z0-9]+)*$/.test(t)) return 'server';
  return 'unknown';
}
const SHARE_FLOW = '2人とも先に鍵（パスキーか合言葉）を選び、同じネット（devnet など）にそろえる（この面の「ブロックチェーンで共有する：鍵を選ぶ」）。<br>'
  + '0. （すぐメンバーにするなら）<b>招かれる人</b>: 「招待コードを受け取る」の「自分のウォレットのアドレスをコピー」で、アドレスを招く人に送る。<br>'
  + '1. <b>招く人</b>: 「＋ 海を共有する」で海を選び、もらったアドレスを入れて（無ければ空のまま）「招待コードを作る」。出た招待コード（BTI1-…）を相手にだけ送る。<br>'
  + '2. <b>招かれる人</b>: 「招待コードを受け取る」に貼って「受け取る」。海が足され、みんなの記録が読める。<br>'
  + '3. アドレスを入れなかったときは、<b>招かれる人</b>がカードの「同期」で記録を送ると、<b>招く人</b>が次に「同期」したときにメンバーに足される。<br>'
  + '招待コードは合言葉と同じで、持っている人は誰でも受け取れる。使えるのは ' + INVITE_DAYS + ' 日・最初の 1 人だけ。<br>'
  + 'そのあとは、カードの「同期」か盤のひとことの横の「同期」で合わせる（送るときに手数料）。アプリを開いている間は、ほかの人の変更を自動で読む（手数料なし）。<br>'
  + 'チャット（カードの「チャット」）と盤のひとことは別のもの: ひとことは泡に付き「同期」で届く。チャットは海ぜんたいの話で 1 件ずつ届く（直につながっていれば手数料なし）。';

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
    hpT.appendChild(el('span', 'sub', '画面の見方・海とサーバーの始め方'));
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
    /* サーバーあり版では出さない（ヘルプの中心は AI に訊く。記事は上の「使い方を読む」で読める。2026-11-17 Issue #78） */
    if (aiOn()) box.appendChild(ask);

    /* --- 1行にまとめた箱（Issue #40。利用者の返事）---
       基本は個人の TODO なので、ふだん開いて見えるのは ふりかえり・使い方・ヘルプ・海域 だけにし、
       ほかは「タグを編集する」「音と表示」「AI を使う設定をする」「他の人と一緒に使う」「ブロックチェーンを準備する」「記録を保存する・読み込む」「版」「その他」の
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

    /* --- タグ ---
       2026-11-12 Issue #47「タグを編集するが表にでないように」: 前は設定を開くとすぐ一覧が見えていた。
       ほかの箱と同じ1行に畳み、押したときだけ中身を出す（並びは箱のいちばん上） */
    /* store 側のタグ API がまだ無い版でも設定画面ごと落ちないよう、有無を見る */
    if (hasTags()) {
      const gTag = group('タグを編集する', 'タグの名前を直す・足す・消す');
      const tagBox = el('div', 'tags');
      tagBox.appendChild(el('h3', null, 'タグ'));
      tagBox.appendChild(el(
        'p', 'note',
        'タグは泡に付ける印。ここでは名前を直す・足す・消すだけをする。'
        + 'タグを画面の横一列に並べる・外す・並べ替えるのは、画面を長押しして出る引きから。'
        + '上（長期保留）と下（完了）は動かせない。'
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

      gTag.appendChild(tagBox);
      this._taglist = list;
      renderTags(list);
    }

    /* 名前は「何をするか」で書く（2026-11-11 Issue #43 の返事:「バックアップという名詞じゃなくて、バックアップをするみたいな名前に」） */
    const gLook = group('表示と音', '全体・海・今日・リスト・盤・引き出しごとに');
    /* 「AI を使う」ではなく「AI を使う設定をする」（Issue #45）。ヘルプそのものは上の1行へ分けた */
    /* サーバーあり版では作らない（AI の機能を出さない。2026-11-17 Issue #78 の返事「AI機能と設定の関連を削除して」） */
    const gAi = aiOn() ? group('AI を使う設定をする', 'API キー・モデル・先の予定') : null;
    /* 2026-11-12 Issue #45（A 案）: 「他の人と一緒に使う」は、海を共有する・チャットする だけにし、それぞれの中で
       「サーバーで／ブロックチェーンで」を選ぶ。サーバーに繋ぐ設定と、ブロックチェーンの始め方・ウォレット・鍵は
       「サーバー・ブロックチェーンを準備する」へ。ブロックチェーンのバックアップは「記録を保存する・読み込む」へ移した */
    /* 2026-11-16 Issue #74（A 案「推奨で実施」）: 箱を「何を使うか」ではなく「何をしたいか」で分ける。
       他の人と一緒に使う（共有の海・人を招く・招待コードを受け取る。ブロックチェーンの鍵選びもこの中で済む）／
       自分の端末どうしで使う（自分のほかの端末と合わせる・自分にメモを送る）／記録を保存する・読み込む（バックアップだけ）／
       ブロックチェーンの鍵とウォレット（前の「ブロックチェーンを準備する」。共有の前提の箱が共有より下にあって行き来が要ったので、
       始め方は共有の面にも出し、ここは後から使うウォレット・鍵の替え・失ったときを主にする） */
    /* 2026-11-17 Issue #78「サーバーあり版のwebRTCとブロックチェーンを使った箇所の機能とそれに関連する設定を削除してすっきりさせれる？」:
       サーバーあり版（index.html）では、ブロックチェーン（共有の海・チャット・バックアップ・自分にメモ・鍵とウォレット）と
       直の通信（WebRTC。チェーンの共有の海の上で動く）の欄を出さない。サーバーなし版（noserver.html）は今までどおり */
    const chainOn = isSolo();
    const gShare = group('他の人と一緒に使う', chainOn ? '共有の海（人を招く・招待コードを受け取る・同期・チャット）' : '共有の海（人を招く・招待コードを受け取る・チャット）');
    const gSelf = group('自分の端末どうしで使う', chainOn ? '自分のほかの端末と合わせる・自分にメモを送る' : '自分のほかの端末と合わせる');
    /* 「記録を引っ越す」と「版を確かめる」は別の働きなので分けた（Issue #43 の返事）。
       引っ越し（CSV・暗号化したファイル）・サーバー・ブロックチェーンは、どれも「記録をどこかに置いて、あとで戻す」なので、
       「記録を保存する・読み込む」にまとめ、置き場を選ぶ形にした */
    const gSave = group('記録を保存する・読み込む', chainOn
      ? 'その時点の控え（バックアップ）をファイル・フォルダ・ブロックチェーンに書き出す・読み込む'
      : 'その時点の控え（バックアップ）をファイル・フォルダに書き出す・読み込む');
    /* 2026-11-13 Issue #47 の返事「全部」（C）: サーバーに繋ぐ・入るのは「海を設定する」の ⚙ 1か所にした。ここはブロックチェーンだけ。
       サーバーあり版では作らない（Issue #78） */
    const gPrep = chainOn ? group(PREP_NAME, 'ブロックチェーンを始める・ウォレットを見る・鍵を替える・鍵を失ったとき') : null;
    const gVer = group('版を確かめる・戻す', '最新の版を確かめる・前の版に戻す');
    const gEtc = group('不具合を調べる・初期化する', '画面の大きさの記録・プロトタイプで試す・すべて初期化');

    /* --- どの画面を変えるか（2026-11-13 Issue #49 の返事「ごちゃごちゃしてきたので、どのページを変えるかを間に挟む」）---
       先に画面を1つ選び、その画面に効く項目だけを下に出す。項目の画面は js/prefs.js の pages（data-pages）。
       AI に頼む欄・既定に戻す・全体に提案するは、どの画面でも出す（data-pages を付けない）。選んだ画面は設定を開き直しても覚える */
    const pageRow = el('div', 'prefs-pages');
    pageRow.setAttribute('role', 'group');
    pageRow.setAttribute('aria-label', 'どの画面を変えるか');
    pageRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px';
    const pageHint = el('p', 'note');
    pageHint.setAttribute('aria-live', 'polite');   /* 選んだ画面の説明。状態の行なので隠さない */
    const pageBtns = PAGES.map(([pid, name]) => {
      const b = el('button', 'btn', name);
      b.type = 'button';
      b.dataset.page = pid;
      b.addEventListener('click', () => { lookPage = pid; applyLookPage(); });
      pageRow.appendChild(b);
      return b;
    });
    /* 2026-11-18（ユーザーの決定「4 つとも案どおり」）: 「どの画面を変えるか」を選ぶ段をやめ、画面ごとの見出しで縦に並べる。
       項目は data-pages の最初の画面の見出しの下へ動かす（prefsBox は描き直すたびに新しい項目を作るので、そのたびに並べ直す）。
       上の pageRow（選ぶボタン）は作るが置かない */
    void pageRow; void pageHint;
    const lookSecs = new Map();
    const lookRows = [];
    const applyLookPage = () => {
      PAGES.forEach(([pid, name]) => {
        if (!lookSecs.has(pid)) {
          const s = el('div', 'look-sec');
          s.dataset.page = pid;
          const h = el('h4', 'look-h', name);
          h.style.cssText = 'margin:14px 0 4px;font-size:13.5px';
          s.appendChild(h);
          lookSecs.set(pid, s);
        }
      });
      lookSecs.forEach(s => s.querySelectorAll(':scope > .prefs-item').forEach(n => n.remove()));
      const first = (n) => (n.dataset.pages || 'all').split(' ')[0];
      lookRows.forEach(n => { const s = lookSecs.get(first(n)) || lookSecs.get('all'); s.appendChild(n); });
      gLook.querySelectorAll('.prefs-ctl > [data-pages]').forEach(n => { const s = lookSecs.get(first(n)) || lookSecs.get('all'); s.appendChild(n); });
      lookSecs.forEach(s => { gLook.appendChild(s); s.hidden = s.children.length <= 1; });
    };

    /* --- 音 --- */
    const soundRow = el('label', 'setrow');
    soundRow.dataset.pages = 'all';
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
    lookRows.push(soundRow);

    /* 効果音（2026-11-07 利用者の指示 Issue #18）。完了音とは別のスイッチ */
    const sfxRow = el('label', 'setrow');
    sfxRow.dataset.pages = 'all';
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
    lookRows.push(sfxRow);
    const sndNote = el(
      'p', 'note',
      '完了の音は自分で「完了」を押したときだけ。消す・戻すときには鳴らない。'
      + '端末が消音のとき（iPhone の消音スイッチなど）や、'
      + '「視差効果を減らす」をオンにしているときは鳴らない。'
    );
    sndNote.dataset.pages = 'all';
    gLook.appendChild(sndNote);
    lookRows.push(sndNote);

    /* 似ている泡を近くに寄せる（2026-11-07 Issue #23）。端末にだけ置く */
    const affRow = el('label', 'setrow');
    affRow.dataset.pages = 'sea today';
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
    lookRows.push(affRow);

    /* --- この端末の表示（2026-11-10。Issue #36。js/prefs.js）--- */
    gLook.appendChild(prefsBox(() => applyLookPage()));
    applyLookPage();

    /* --- サーバー・ブロックチェーンを準備する（Issue #45）---
       サーバーなし版（noserver.html）のサーバーの欄は、繋ぐページへの案内だけ（通信してよい先を決め打ちにしているので繋がらない）。
       開くとまず「サーバー」「ブロックチェーン」の選択肢だけを出し、選んだほうの欄だけを下に出す（Issue #43 の返事: 選択肢で誘導する） */
    /* サーバーに入る欄（合言葉・パスキー・登録の頼み）。「海を設定する」の、開いている海の ⚙ の中に出す（Issue #47 の C）。
       サーバーなし版（noserver.html）では、繋ぐページへの案内（通信してよい先を決め打ちにしているので繋がらない） */
    /* サーバーなし版だけ、海の欄のいちばん下に「サーバーありの版を開く」を出す（サーバーありの版はログインの1行。js/screens/seapanel.js） */
    const serverEl = isSolo() ? soloServerBox() : null;
    let seasEl = null;
    /* ブロックチェーンの始め方・ウォレット・鍵を開く（ほかの箱の「ブロックチェーンを準備する」「ウォレットを開く」から） */
    const goSetup = (k) => {
      if (!chainEl) return;   /* サーバーあり版にはブロックチェーンの箱が無い（Issue #78） */
      gPrep.open = true;
      if (k && chainEl.openTask) chainEl.openTask(k);
      try { chainEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 動かせなくても開いてある */ }
    };
    /* サーバーの設定 = 「海を設定する」の、開いている海の ⚙ */
    const goServer = () => { if (seasEl) seasEl.openServer(); };
    /* --- ブロックチェーン（2026-11-08 Issue #31）。始め方・ネット・ウォレット・鍵・鍵を失ったとき ---
       サーバーが配るページでも使える（2026-11-11 Issue #42 の A 案。server.py の CSP に Solana の RPC を足した） */
    const chainEl = chainOn ? chainBox({ setup: true, tasks: ['wallet', 'key', 'lost'], title: 'ブロックチェーンを始める・ウォレットと鍵（Solana・試し）' }) : null;
    if (chainEl) gPrep.appendChild(chainEl);

    /* --- 他の人と一緒に使う ---
       2026-11-16 Issue #68 の返事（「設定のUIの配置やナビや説明文などを改良できる？」→ A 案「おすすめで」）:
       「海を共有する／共有中の海を同期する／チャットする」×「サーバーで／ブロックチェーンで」の 3 段の選択をやめ、開いたらすぐ 1 つの面
       （共有中の海のカード → ＋ 海を共有する → 招待コードを受け取る → 畳んだ説明・自分あてのメモ）を出す。
       サーバーの共有・チャットは、サーバーあり版だけ下に畳んで置く（サーバーなし版では出さない） */
    /* 2026-11-16 Issue #74 の A 案: サーバーで共有する道（serverShare）と、サーバーの招待コードの受け取り（serverInvite）も
       この面に入れる。前は下の畳んだ箱に「『海を設定する』の［＋ 海を追加］で…」と道順を文で書き、受け取る欄も「海を設定する」の ⚙ の中だけだった */
    /* 2026-11-17 kura の main との統合: 前の「この海のサーバーに入る」（serverBox）は海の作り直しで無くなったので、
       サーバーの招待コードは「海」のログインの「招待コード」の欄（［招待コードで登録］）へ入れる */
    const serverInvite = (code) => {
      if (seasEl && typeof seasEl.fillInvite === 'function' && seasEl.fillInvite(code)) {
        return 'サーバーの招待コード。設定の「海」の［サーバーにログイン］の「招待コード」の欄に入れた。そこで［招待コードで登録］を押す（この端末のパスキーを作る）。';
      }
      if (loginState().live) {
        return 'サーバーの招待コード。この端末はもうログインしている（入れる海は設定の「海」に並ぶ）。招待コードは、まだログインしていない端末で［招待コードで登録］に入れる。';
      }
      goServer();
      return 'サーバーの招待コード。設定の「海」の［サーバーにログイン］を開いた。「招待コード」の欄に貼って［招待コードで登録］を押す。';
    };
    /* サーバーあり版は serverOnly: サーバーの海のカード・サーバーで共有する・サーバーの招待コードだけを出す（Issue #78） */
    const shareHub = chainBox({ tasks: ['share'], part: 'hub', title: isSolo() ? '共有の海（ブロックチェーン）' : '共有の海（サーバー）', goSetup,
      serverShare: isSolo() ? null : goServer, serverInvite: isSolo() ? null : serverInvite, serverOnly: !chainOn });
    gShare.appendChild(shareHub);
    /* チャットを開いている間は描き直さない（2026-11-16 Issue #68 の返事「設定のチャットを押してもなにも起こらない？」:
       チャットを開くと「見た」の印を付け、その知らせで面を描き直していたので、開いたチャットがすぐ閉じていた） */
    /* 知らせの［開く］から、その海のチャットを開く（Issue #68）。設定の画面に移ったあとで呼ばれる。描き直すたびに付け替える */
    if (openChatHandler) window.removeEventListener('bubbles:open-sea-chat', openChatHandler);
    openChatHandler = (ev) => {
      const id = ev && ev.detail && ev.detail.id;
      if (!id) return;
      gShare.open = true;
      setTimeout(() => { if (typeof shareHub.openSeaChat === 'function') shareHub.openSeaChat(id); }, 50);
    };
    window.addEventListener('bubbles:open-sea-chat', openChatHandler);
    const shareRefresh = () => {
      if (!gShare.open || typeof shareHub.refresh !== 'function') return;
      if (typeof shareHub.hasChat === 'function' && shareHub.hasChat()) return;
      shareHub.refresh();
    };
    /* 自動の読み込みで新しいチャットが来たら、カードの件数を描き直す（開いているときだけ） */
    window.addEventListener('bubbles:chat-unread', shareRefresh);
    /* 直につながった・切れたら、カードの「⇄台数」と「直の通信: …」を描き直す（Issue #68） */
    window.addEventListener('bubbles:p2p-state', shareRefresh);
    if (!isSolo()) {
      /* サーバーあり版だけ: サーバーのチャット（開いている海）。
         2026-11-16 Issue #74: 前はここに「サーバーで共有する」の案内も畳んで置き、上のカードと 2 か所に出ていた。
         案内は面の「＋ 海を共有する（サーバーで）」へ移し、ここはカードの［チャット］で開くチャットだけにした */
      const srv = document.createElement('details');
      srv.style.cssText = 'margin-top:12px';
      srv.appendChild(el('summary', null, 'サーバーのチャット（開いている海）'));
      srv.appendChild(serverChatBox(this));
      gShare.appendChild(srv);
      /* 共有の面のサーバーの海のカードの［チャット］［人を招く］から開く（Issue #68 の X 案）。描き直すたびに前の受け口を外す */
      if (srvHandlers) {
        window.removeEventListener('bubbles:open-server-chat', srvHandlers.chat);
        window.removeEventListener('bubbles:open-server-settings', srvHandlers.settings);
      }
      srvHandlers = {
        chat: () => {
          srv.open = true;
          try { srv.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* 進む */ }
          if (serverChatUnread(store.space()) > 0) markChatSeen('srv:' + store.space());
        },
        settings: () => goServer(),
      };
      window.addEventListener('bubbles:open-server-chat', srvHandlers.chat);
      window.addEventListener('bubbles:open-server-settings', srvHandlers.settings);
    }

    /* --- 記録を保存する・読み込む（Issue #43 の返事）---
       置き場の選択肢: 暗号化したファイル（この端末に書き出す。CSV は Issue #50 で外した）・決めたフォルダ・サーバー・ブロックチェーン。
       ブロックチェーンのバックアップは、ここにだけ置く（2026-11-12 Issue #45 の返事:「完全にうつしてしまう方が迷わない」） */
    /* 引っ越しとバックアップの違い（2026-11-13 Issue #48 の返事「わかりやすく表現できない？端末を変えるなど、もしくは i ボタン」）。
       選択肢の字を「何のために使うか」にし、使い分けを箱の行の ⓘ の裏に置く（見出しの無い p.note は markInfo が ⓘ へ畳む） */
    /* 引っ越しと控えを［控え］1つにまとめた（2026-11-13 Issue #48 の返事「おすすめで」= A 案）。
       サーバーに入る鍵は、押して作る控えのチェックボックスで入れる（入れたら暗号化は必須）。自動の控えには入れない */
    /* 字を「書き出す先を選ぶ」動詞の形にし、CSV は「ファイルに書き出す」の形の1つにした
       （2026-11-13 Issue #48 の返事「控えとかわかりにくい」「書き出す場所を選ぶみたいな動詞にして、選択肢を示す形」「控えと CSV まとめれる？」） */
    /* 書き出すと読み込むを分け、どの置き場も同じ並びで出す（2026-11-13 Issue #48 の返事
       「ファイル・サーバー・ブロックチェーンを選んだ時に出る UI を統一できる？」「書き出すに読み込むボタンが紛れてる。分離できる」）。
       1段目 ［書き出す］［読み込む］ → 2段目 ［ファイル］［フォルダ（自動）］［サーバー］［ブロックチェーン］ →
       どの欄も「見出し → 説明（ⓘ）→ 選ぶもの → ボタン → 知らせ」の順 */
    [
      'どれを使う？',
      '・自分のほかの端末といつも同じ記録にするのは、上の「自分の端末どうしで使う」（同じサーバーに繋いだ端末どうしは自動）。ここはその時点の控え（バックアップ）。',
      '・ファイル… 押したときに1つ作る。新しい端末をつなぐ・替えるときは「サーバーに入る鍵も入れる」に印を付ける（招かれた海にも、招待を頼み直さずに入れる。合言葉で暗号化）。すべての海が1つのファイルに入る。',
      '・フォルダ（自動）… もしものための保険。選んだフォルダに、開いている間ずっと自動で書く（記録だけ。鍵は入らない）。読み込むときは「ファイル」から選ぶ。',
      chainOn ? '・ブロックチェーン… 端末もフォルダも失くしたときの保険。押したときだけ書く（手数料が掛かる）。いつも暗号化する。' : '',
      '読み込むときは、上書き（今の記録をサーバーに控えてから、読み込んだもので丸ごと入れ替える）か、追加（今の記録に重ねる。記録ごとに新しいほうが残る）かを聞く。',
      '・サーバーのバックアップ… ログインしていれば、［今バックアップを取る］でサーバーに預ける（新しい 30 個まで）。下の「バックアップ」の一覧から戻す。',
    ].filter(Boolean).forEach(t => gSave.appendChild(el('p', 'note', t)));
    /* 問いなので .note にしない（ⓘ の裏に隠さない） */
    gSave.appendChild(el('p', 'prefs-pages-lb', '何をする？'));
    const modeChoice = choiceRow(gSave, '書き出すか読み込むか');
    const outWrap = el('div');
    const inWrap = el('div');
    /* ［ほかの端末と同期する］（2026-11-13 Issue #52）。一度 U1 で外したが、返事「バックアップと同期するが区別がつかなくなる。
       同期するボタンをつけて明示的に書き出せるようにした方が迷わない」で戻した。
       書き出す・読み込む = その時点の控え（バックアップ）、同期する = ほかの端末と同じ記録にする、と言葉で分ける。
       サーバーは自動（［今すぐ合わせる］もある）、ブロックチェーンは［同期する］で送り、受け取りは画面の下の知らせ（js/chainwatch.js） */
    /* 2026-11-16 Issue #74 の A 案: 自分のほかの端末と合わせる欄は、新しい箱「自分の端末どうしで使う」へ移した
       （この箱は書き出す・読み込む＝バックアップだけ）。「同期」の言葉は共有の海の［🔑 同期］にだけ使い、ここは「合わせる」 */
    const syncWrap = el('div');
    gSelf.appendChild(el('p', 'note', '自分のほかの端末（iPhone と PC など）と、いつも同じ記録にする。'
      + '人と一緒に使う海は「他の人と一緒に使う」、その時点の控え（バックアップ）は「記録を保存する・読み込む」。'));
    gSelf.appendChild(syncWrap);
    modeChoice.add('out', '書き出す（バックアップ）', [outWrap]);
    modeChoice.add('in', '読み込む（バックアップから）', [inWrap]);
    outWrap.appendChild(el('p', 'prefs-pages-lb', 'どこに書き出す？'));
    inWrap.appendChild(el('p', 'prefs-pages-lb', 'どこから読み込む？'));
    const outChoice = choiceRow(outWrap, '書き出す先');
    const inChoice = choiceRow(inWrap, '読み込む元');

    /* ファイルの欄（すべての海。暗号化できる・鍵も入れられる）。書き出す・読み込むで1つずつ。
       2026-11-13 Issue #50 の返事「B」: 形を選ぶ欄と「表（CSV）」は外した（簡素にするため） */
    const fileFormats = (mode) => moveBox(mode);
    /* サーバーの欄（書き出す・読み込むとも、繋いでいる間は自動。押す操作は無い） */
    const serverPane = (mode) => {
      const w = el('div', 'tags');
      w.appendChild(el('h3', null, mode === 'out' ? 'サーバーに書き出す' : mode === 'sync' ? 'サーバーで合わせる（自動）' : 'サーバーから読み込む'));
      w.appendChild(el('p', 'note', mode === 'sync'
        ? '同じサーバーの同じ海を開いている端末どうしは、自動で同じ記録になる（保存して数秒で送り、開いている間は 20 秒ごと・画面に戻ったときに読む）。今すぐ合わせたいときは［今すぐ合わせる］。'
        : mode === 'out'
        ? 'サーバーに繋いでいる間は、記録は自動でサーバーに書かれ、ほかの端末と合う（保存して数秒で送る）。ふだんは押さなくてよい。'
          + (chainOn ? 'ファイルやブロックチェーンのような' : 'ファイルのような') + '「その時点の控え」ではなく、いつも今の記録と同じ中身になる（消したものも消える）。'
        : 'サーバーに繋いでいる間は、ほかの端末で書いたものも自動で読み込まれる（開いている間は 20 秒ごと・画面に戻ったとき）。ふだんは押さなくてよい。'));
      /* もう1台の端末で同じ記録を使う手順（2026-11-13 Issue #52 の返事「サーバーあり版はおすすめで」）。同期するの欄にだけ出す */
      if (mode === 'sync') {
        [
          'もう1台（例: iPhone と Android）で同じ記録を使う手順:',
          '1. その端末のブラウザでサーバーのページを開く（Android は Chrome で開いてホーム画面に置く。Android の app の中ではパスキーを使えないので、公開したサーバーには入れない）。',
          '2. 設定の「海」のいちばん下の［サーバーにログイン］で、呼び名を入れて「登録を頼む」。',
          '3. 出た確かめの字を、サーバーの持ち主が認める（自分の端末なら置き場は me:1,share）。認められたら「登録を仕上げる」。',
          '4. 終わり。以後は自動。両方の端末で別々に打った同じ名前の泡は、別の泡として両方残る（片方を消す）。',
          '5. ログインすると、入れる海（サーバーの個人と、招かれた海）が設定の「海」に並ぶ。押すとその海へ移る。前の端末で作った「サーバーに入る鍵も入れた」ファイルを読み込んでもよい。',
        ].forEach(t => w.appendChild(el('p', null, t)));   /* 手順は ⓘ の裏に隠さない */
      }
      const st = el('p', 'note');
      st.setAttribute('aria-live', 'polite');
      const r = el('div', 'row');
      /* ［今すぐ合わせる］と最後に合わせた時刻（Issue #52 の U1。ブロックチェーンの［書き出す］［読み込む］と同じく押す所を置く） */
      const now = el('button', 'btn', '今すぐ合わせる');
      now.type = 'button';
      const hhmm = t => { const d = new Date(t); return (d.toDateString() === new Date().toDateString() ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ')
        + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
      const showState = () => {
        if (!sync.config().url) { st.textContent = 'いま: この海はサーバーと合わせていない（下の「ログインの欄を開く」、または設定の「海」の ⚙ で置き場を選ぶ）。'; return; }
        const at = sync.seenAt();
        st.textContent = 'いま: サーバーに繋いでいる（自動で合わせている）。' + (at ? '最後に合わせた: ' + hhmm(at) : 'まだ合わせていない');
      };
      now.addEventListener('click', async () => {
        if (!sync.config().url) { showState(); return; }
        now.disabled = true;
        st.textContent = '合わせている…';
        try {
          const ok = await sync.syncNow();
          const s = sync.status();
          if (ok) showState();
          else if (s.state === 'syncing') st.textContent = 'いま合わせている途中（終わるとすぐもう1回合わせる）。';
          else st.textContent = '合わせられなかった: ' + (s.message || s.state);
        } finally { now.disabled = false; }
      });
      r.appendChild(now);
      /* 押して取るバックアップ（2026-11-19「能動的なバックアップを追加して」）。書き出すの欄だけ。一覧と戻すは下の「バックアップ」 */
      if (mode === 'out') {
        const take = el('button', 'btn', '今バックアップを取る');
        take.type = 'button';
        take.dataset.name = '今バックアップを取る';
        take.addEventListener('click', async () => {
          if (!canServerBackup()) { st.textContent = 'サーバーのバックアップは、ログインすると使える。'; return; }
          take.disabled = true;
          st.textContent = '預けている…';
          try {
            const m = await takeServerBackup('手で取った');
            st.textContent = 'サーバーに預けた（' + backupWhen(m.at) + '・海 ' + m.seas + '・泡 ' + m.todos + '）。戻すときは「読み込む」の下の「バックアップ」から。';
            window.dispatchEvent(new CustomEvent('bubbles:server-backups'));
          } catch (e) { st.textContent = '預けられなかった: ' + ((e && e.message) || e); }
          finally { take.disabled = false; }
        });
        r.appendChild(take);
      }
      const b = el('button', 'btn', 'ログインの欄を開く');
      b.type = 'button';
      b.addEventListener('click', goServer);
      r.appendChild(b);
      w.appendChild(r);
      w.appendChild(st);
      const owner = mode === 'sync' ? gSelf : gSave;   /* 合わせる欄は「自分の端末どうしで使う」の中（Issue #74） */
      owner.addEventListener('toggle', () => { if (owner.open) showState(); });
      return w;
    };
    /* ブロックチェーンの欄（書き出す＝保存・復元コードを表示、読み込む＝復元・復元コードで復元） */
    const chainPane = (mode) => {
      const e = chainBox({ tasks: ['backup'], only: mode, goSetup,
        title: mode === 'out' ? 'ブロックチェーンに書き出す（Solana・試し）' : mode === 'sync' ? 'ブロックチェーンで合わせる（Solana・試し）' : 'ブロックチェーンから読み込む（Solana・試し）' });
      e.insertBefore(el('p', 'note', mode === 'sync'
        ? 'サーバーなしで、同じパスキーか同じ合言葉で開いた端末どうしを合わせる。送るのは［自分のほかの端末へ送る］を押したときだけ（手数料が掛かる）。'
          + 'ほかの端末が送ったものは、開いたとき・画面に戻ったとき・泡を開いたとき・5 分ごとに見に行き、画面の下の知らせ［読み込む］で受け取る（受け取りは手数料なし）。'
        : mode === 'out'
        ? '記録を暗号化して、Solana のチェーンに書く。押したときだけ書く（手数料が掛かる）。パスキーか合言葉で開く。始め方・ウォレット・鍵は「' + PREP_NAME + '」にある。'
          + 'サーバーなし版のほかの端末（同じパスキーか同じ合言葉で開いたもの）では、書いたものが「新しい記録がある」の知らせで出る。'
        : 'チェーンに書いた記録を、今の記録に重ねる（消さない。手数料は掛からない）。パスキーか合言葉、失くしたときは復元コードで開く。どの端末からでも読み込める。'
          + 'サーバーなし版では、ほかの端末が新しく書いたら、開いている間に画面の下に知らせが出る（そこからも読み込める）。'),
        e.children[1] || null);
      return e;
    };
    /* --- 書き出す --- */
    outChoice.add('file', 'ファイル', [fileFormats('out')]);
    outChoice.add('folder', 'フォルダ（自動）', [folderBox()]);
    outChoice.add('server', 'サーバー', [serverPane('out')]);
    if (chainOn) outChoice.add('chain', 'ブロックチェーン', [chainPane('out')]);
    /* --- 読み込む（フォルダに自動で書いたものは「ファイル」から選ぶ）--- */
    inChoice.add('file', 'ファイル', [fileFormats('in')]);
    inChoice.add('server', 'サーバー', [serverPane('in')]);
    if (chainOn) inChoice.add('chain', 'ブロックチェーン', [chainPane('in')]);
    /* 個人の控え（合わせる・入れ替える前に取ったもの）。読み込むの欄の下に、控えがあるときだけ出す（2026-11-18） */
    gSave.appendChild(personalBackupBox(gSave));
    /* --- 自分のほかの端末と合わせる（Issue #52。2026-11-16 Issue #74 で「自分の端末どうしで使う」へ移した）。
       サーバーなし版にはサーバーの欄を出さない。サーバーあり版にはブロックチェーンの欄を出さない（Issue #78） --- */
    if (!isSolo()) syncWrap.appendChild(serverPane('sync'));
    const selfChain = chainOn ? chainPane('sync') : null;
    if (selfChain) syncWrap.appendChild(selfChain);
    /* 自分にメモを送る（前は「他の人と一緒に使う」の面のいちばん下。自分だけのものなので、ここへ移した。Issue #74） */
    const selfMemo = chainOn ? chainBox({ tasks: ['memo'], selfOnly: true, goSetup, title: '自分にメモを送る（Solana・試し）' }) : null;
    if (selfMemo) gSelf.appendChild(selfMemo);
    /* 箱を開くたびに、ブロックチェーンの欄を読み直す（別の箱で始めた・鍵を替えたのを映す。Issue #45） */
    [gShare, gSelf, gPrep, gSave].filter(Boolean).forEach(d => d.addEventListener('toggle', () => {
      if (!d.open) return;
      d.querySelectorAll('.choice-pane').forEach(p => { if (!p.hidden && typeof p.refresh === 'function') p.refresh(); });
      if (d === gPrep && chainEl && typeof chainEl.refresh === 'function') chainEl.refresh();
      if (d === gShare && typeof shareHub.refresh === 'function') shareHub.refresh();
      if (d === gSelf) [selfChain, selfMemo].forEach(x => { if (x && typeof x.refresh === 'function') x.refresh(); });
    }));

    /* 「記録の置き場を選ぶ」（Issue #42）は外した（2026-11-13 Issue #47 の C）。
       その［この端末だけ］は、開いている海のサーバーの住所を消し、同じサーバーのほかの海まで止めていた。
       サーバーは海ごとに「海を設定する」の ⚙ で決める */
    /* --- 海を設定する（2026-11-12 Issue #47 の返事。前は「海域を設定する」。js/regions.js）--- */
    /* --- 海（2026-11-16 作り直し。js/screens/seapanel.js。前の seasBox・serverBox の代わり）--- */
    seasEl = seaPanel({ solo: serverEl });
    box.appendChild(seasEl);

    /* --- 最新の版を確認する（2026-11-02。利用者の指示）---
       ホーム画面に追加した iOS で、閉じて開き直しても新しい版に気づかないことがある
       （WebKit の既知の挙動）。その逃げ道として、押した人だけがその場で確かめて入れ替えられる */
    gVer.appendChild(updateBox());
    /* --- 前の版に戻す（2026-11-07。Issue #21）--- */
    gVer.appendChild(rollbackBox());

    /* --- AI の API キーとモデル（2026-11-04 Issue #9。2026-11-11 Issue #45 で「ヘルプを開く」を上の1行へ分けた）--- */
    if (gAi) gAi.appendChild(helpAiBox());

    /* --- 先の予定（AI。2026-11-04。利用者の指示 Issue #13）---
       日付が先に分かっている予定を AI に Web で調べさせ、長期保留のバブルにする。押したときだけ調べる */
    if (gAi) gAi.appendChild(upcomingBox());

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

    /* 並び: 個人で使うもの → AI → 他の人と → 引っ越しと版 → その他（サーバーなし版）。
       サーバーあり版は 2026-11-18 ユーザーの決定（「4 つとも案どおり」。モック docs/spec/mock/settings.html）:
         利用者・app・端末（3 つの app で共通の節）→ bubble（ふだん使う順: 海・タグ・ふりかえる・表示と音・記録・チャット）→ そのほか（畳む）
       「他の人と一緒に使う」の共有の海の面と「自分の端末どうしで使う」は外した（海の設定・わたしの端末と重なっていた） */
    if (isSolo()) {
      groups.forEach(d => box.appendChild(d));
    } else {
      const sec = (title, note) => {
        const h = el('p', 'set-sec');
        h.style.cssText = 'display:flex;justify-content:space-between;margin:18px 2px 6px;font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--text-2)';
        h.appendChild(el('span', null, title));
        if (note) { const n = el('span', null, note); n.style.fontWeight = '500'; h.appendChild(n); }
        return h;
      };
      box.appendChild(sec('利用者・app・端末', '3 つの app で同じ'));
      box.appendChild(commonRows());
      box.appendChild(sec('bubble', 'ふだん使う順'));
      seasEl.open = false;
      box.appendChild(seasEl);
      const gTagEl = groups.find(d => (d.querySelector('.nm') || {}).textContent === 'タグを編集する');
      if (gTagEl) { gTagEl.querySelector('.nm').textContent = 'タグ'; box.appendChild(gTagEl); }
      box.appendChild(go);
      box.appendChild(gLook);
      gSave.querySelector('.nm').textContent = '記録';
      box.appendChild(gSave);
      /* チャット（サーバーの海の仲間と）。共有の海の面は出さない */
      shareHub.hidden = true;
      gShare.querySelector('.nm').textContent = 'この海のチャット';
      gShare.querySelector('.sub').textContent = 'サーバーの海の仲間と話す';
      box.appendChild(gShare);
      const etc = document.createElement('details');
      etc.className = 'set-more set-etc';
      const es = document.createElement('summary');
      const et = el('span', 'tx');
      et.appendChild(el('span', 'nm', 'そのほか'));
      et.appendChild(el('span', 'sub', '使い方・版を確かめる・不具合を調べる・初期化'));
      es.appendChild(et);
      etc.appendChild(es);
      etc.appendChild(help);
      if (aiOn()) etc.appendChild(ask);
      etc.appendChild(gVer);
      etc.appendChild(gEtc);
      box.appendChild(etc);
      /* 利用者の札の［はじめての端末］から: 海の欄のログインを開く */
      window.addEventListener('bubbles:open-login', () => { seasEl.open = true; if (typeof seasEl.openServer === 'function') seasEl.openServer(); });
    }

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

/* 3 つの app で共通の節（利用者・わたしの端末・app。2026-11-18 ユーザーの決定。取り決め §7.1）。中身は利用者の札（js/userchip.js） */
function commonRows() {
  const wrap = document.createElement('div');
  wrap.className = 'set-common';
  wrap.dataset.name = '3 つの app で共通の節';
  const mk = (cls, title, sub, page) => {
    const b = el('button', 'gorow ' + cls);
    b.type = 'button';
    const tx = el('span', 'tx');
    /* 利用者の名前は利用者が入れた字なので、textContent で入れる（el は innerHTML） */
    const nm = el('span', 'nm'); nm.textContent = title;
    const sb = el('span', 'sub'); sb.textContent = sub;
    tx.appendChild(nm);
    tx.appendChild(sb);
    b.appendChild(tx);
    const ar = el('span', 'ar', '›');
    ar.setAttribute('aria-hidden', 'true');
    b.appendChild(ar);
    b.addEventListener('click', () => openUserCard(page));
    return b;
  };
  const draw = () => {
    wrap.textContent = '';
    const me = loggedIn() ? meNow() : null;
    const u = mk('set-user', me ? me.user.name : 'ログインしていない', me ? 'アイコン・名前を変える' : 'ログイン・はじめての端末', me ? 'avatar' : 'main');
    const av = el('span', 'set-av');
    av.style.cssText = 'width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:20px;margin-right:10px;flex:none;background:var(--surface-2)';
    paintAvatar(av, me && me.user);
    u.insertBefore(av, u.firstChild);
    wrap.appendChild(u);
    if (me) wrap.appendChild(mk('set-devices', 'わたしの端末', '一覧・外す・＋ 端末を足す', 'devices'));
    wrap.appendChild(mk('set-apps', 'app', 'bubble ・ gantt ・ diary', 'main'));
  };
  draw();
  window.addEventListener(ME_EV, draw);
  return wrap;
}

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
      /* 選んで出したとき、欄に読み直しがあれば呼ぶ（ブロックチェーンの欄。Issue #45） */
      if (on) it.els.forEach(e => { if (typeof e.refresh === 'function') e.refresh(); });
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
      return b;
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
      fx.setAttribute('aria-label', tag.name + ' は ' + (FIXED_LABEL[fixed] || fixed) + ' に置かれる（動かせない）');
      row.appendChild(fx);
    }
    /* 2026-11-13 Issue #47 の返事「仕事・プライベートなどに海にするという項目がある。タグと海が混在している」:
       「海」は1画面＝1つの同期の単位の名前になったので、タグの編集には「海にする」を置かない。
       タグを画面の横一列に並べる・外すのは、海の画面の長押しの引き（js/seamap.js）だけにした */

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


/* 時刻を「15:30」の形で（サーバーのチャットなどが使う） */
function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
    'サーバーと合わせている海で、この海に入れる人どうしで短いメッセージを送り合う（個人の海では、自分の端末どうしのメモ）。'
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
  const mine = () => isPersonal(store.space());
  let said = '';   /* 押した結果の字（状態の字より先に出す） */

  function paint() {
    head.textContent = mine() ? '自分あてのメモ（サーバー・自分の端末どうし）' : 'この海のチャット（サーバー）「' + seaName(store.space()) + '」';
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
    /* 見えているときは、この海のチャットを見たことにする（共有の面のカードの「新しい N 件」を消す。Issue #68 の X 案）。
       件数があるときだけ書く（書くと面を描き直すので、毎回は書かない） */
    if (!mine() && wrap.offsetParent !== null && serverChatUnread(store.space()) > 0) markChatSeen('srv:' + store.space());

    /* 書けるか: 海域に繋いでいて、この海の鍵があること。読むだけ（招かれた海で合わせる前）は待つ */
    const st = sync.status();
    let state = '';
    if (!has) state = 'この版ではチャットを使えない。';
    else if (!sync.ready()) state = sync.config().url
      ? 'ログインしていないので使えない（設定の「海」の［サーバーにログイン］）。'
      : 'この海をサーバーに置くと使える（設定の「海」の ⚙ で置き場を「サーバー」に）。';
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

/* 引っ越し（暗号化したファイル。2026-11-07 Issue #19）。
   すべての海の記録・海の一覧・サーバーの住所と入る鍵を1つのファイルにし、app が作った合言葉で暗号化する。
   新しい端末で開くと、記録が戻り、サーバーにも入り直せる（持ち主に招待コードを頼まなくてよい）。
   形と暗号は js/movefile.js。サーバーの「引っ越しの鍵」は server.py の /api/passkey/move */
function moveBox(mode) {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, mode === 'out' ? 'ファイルに書き出す（すべての海）'
    : mode === 'in' ? 'ファイルから読み込む（すべての海・フォルダに自動で書いたものも）' : 'ファイルに書き出す・読み込む（すべての海）'));
  if (mode === 'in') {
    wrap.appendChild(el('p', 'note',
      'このアプリで書き出したファイル（フォルダに自動で書いたものも）を選ぶ。暗号化したものは合言葉を入れる（フォルダに自動で暗号化して書いたものは、同じ端末なら合言葉なしで開く）。'
      + '今の記録は消さずに重ねる（記録ごとに新しいほうが残る）。サーバーに入る鍵が入っていれば、続けてサーバーに入り直す。'));
  }
  const outNotes = [];
  outNotes.push(el(
    'p', 'note',
    '選んだ海の記録を1つのファイルに書き出す（押したときに1つ作る）。'
    + '新しい端末をつなぐ・替えるときは「サーバーに入る鍵も入れる」に印を付ける。新しい端末でこのファイルを開いて合言葉を入れると、記録が戻り、招かれた海にもそのまま入れる（持ち主に招待を頼まなくてよい）。'
    + '鍵を入れるときは、必ず合言葉で暗号化する。ファイルは iCloud Drive・Google Drive など自分の置き場へ。合言葉はファイルと別に書き留める（忘れたら開けない）。'
  ));
  outNotes.push(el('p', 'note',
    'サーバーに入る鍵（パスキーのサーバーの「引っ越しの鍵」）は使い切りで、作るたびに前のファイルの鍵は使えなくなる（記録は前のファイルからも戻せる）。'
    + '1つのパスキーで入れる端末は 3 台まで。いっぱいのときに新しい端末で使うと、このファイルを作った端末のパスキーが外れる。'));
  if (mode !== 'in') outNotes.forEach(n => wrap.appendChild(n));
  /* 鍵を入れるか・暗号化するか（Issue #48 の A 案）。鍵を入れたら暗号化は外せない */
  const keysLb = el('label', 'setrow');
  const keysCb = document.createElement('input');
  keysCb.type = 'checkbox';
  keysLb.appendChild(keysCb);
  keysLb.appendChild(document.createTextNode(' サーバーに入る鍵も入れる（別の端末をつなぐ・替えるとき）'));
  wrap.appendChild(keysLb);
  const encLb = el('label', 'setrow');
  const encCb = document.createElement('input');
  encCb.type = 'checkbox';
  encCb.checked = true;
  encLb.appendChild(encCb);
  encLb.appendChild(document.createTextNode(' 合言葉で暗号化する（鍵を入れるときは必ず）'));
  wrap.appendChild(encLb);
  let encWanted = true;
  encCb.addEventListener('change', () => { encWanted = encCb.checked; });
  keysCb.addEventListener('change', () => {
    encCb.disabled = keysCb.checked;
    encCb.checked = keysCb.checked ? true : encWanted;
  });
  const row = el('div', 'row');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  const movePick = regionPicker('ファイル');
  wrap.appendChild(movePick.el);
  const make = el('button', 'btn', '書き出す');
  make.type = 'button';
  const save = el('button', 'btn', 'ファイルを保存する');
  save.type = 'button';
  save.hidden = true;
  const openBtn = el('button', 'btn', 'ファイルから読み込む');
  openBtn.type = 'button';
  if (mode !== 'in') { row.appendChild(make); row.appendChild(save); }
  if (mode !== 'out') row.appendChild(openBtn);
  if (mode === 'in') { keysLb.remove(); encLb.remove(); movePick.el.remove(); }
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
  const retry = el('button', 'btn', 'サーバーに入る（この端末のパスキーを作る）');
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
      /* 選んだ海域ごとに、住所と入る鍵を入れる（段2）。パスキーの海域は、その海域のサーバーに引っ越しの鍵を頼む */
      const chosen = movePick.chosen();
      if (!chosen.length) { toast('入れる海を選ぶ'); return; }
      const withKeys = keysCb.checked;
      const encrypt = withKeys || encCb.checked;
      const servers = {};
      const warns = [];
      let anyMove = false;
      for (const rid of (withKeys ? chosen : [])) {
        const r = findRegion(rid);
        if (!r || r.kind !== 'server') continue;
        const sec = sync.moveSecretsOf(rid);
        if (!sec) continue;
        if ('session' in sec) {
          if (!sec.session) { servers[rid] = { url: sec.url }; warns.push(r.name + ': パスキーの通行証が切れている'); continue; }
          try {
            const got = await makeMoveKey(sec.url, sec.session);
            servers[rid] = { url: sec.url, move: got.move };
            anyMove = true;
          } catch (e) {
            servers[rid] = { url: sec.url };
            warns.push(r.name + ': ' + e.message);
          }
        } else if (sec.token || sec.shareToken) {
          servers[rid] = { url: sec.url, token: sec.token, shareToken: sec.shareToken };
        } else {
          servers[rid] = { url: sec.url };
          warns.push(r.name + ': 入る鍵が無い');
        }
      }
      const warn = warns.length ? '（サーバーに入る鍵が入っていないもの: ' + warns.join('、') + '）' : '';
      /* 前の版の app のために、開いている海域（無ければ選んだ最初のサーバー）の1つを server にも入れる */
      const legacyRid = servers[sync.region().id] ? sync.region().id : Object.keys(servers)[0];
      const server = legacyRid ? servers[legacyRid] : null;
      const now = Date.now();
      const dev = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1);
      const picked = pickForPayload(chosen, collectBoxes(), allEntries());
      /* ほかの app の束（日記。2026-11-18 取り決め §8.3）。diary に届かなければ入れずに知らせる */
      const extra = await collectApps();
      const payload = buildPayload({ boxes: picked.boxes, seas: picked.seas, server, at: now, device: dev,
        regions: regionsPayload(chosen), servers: withKeys ? servers : undefined, apps: extra.apps });
      const info = moveSummary(payload);
      const what = (info.regions.length ? '同期の先 ' + info.regions.join('・') + '・' : '')
        + '海 ' + info.seas + ' つ・todo ' + info.todos + ' 件' + (withKeys ? '・サーバーに入る鍵' : '（鍵は入れていない）')
        + (extra.notes.length ? '・' + extra.notes.join('・') : '');
      if (encrypt) {
        const pass = makePassphrase();
        const text = await encryptMove(payload, pass);
        ready = { blob: new Blob([text], { type: 'application/json' }), name: moveFileName(now) };
        passLine.textContent = '合言葉: ' + pass + '　← 書き留めてから「ファイルを保存する」。' + what + warn
          + (anyMove ? '。前に作った控えの鍵では、もうサーバーに入れない（記録は戻せる）' : '');
      } else {
        /* 鍵を入れず、暗号化もしない控え（毎日の控えと同じ形 bubbles-backup） */
        const plain = buildBackup({ boxes: picked.boxes, seas: picked.seas, at: now, device: dev, regions: regionsPayload(chosen), apps: extra.apps });
        ready = { blob: new Blob([JSON.stringify(plain, null, 1) + '\n'], { type: 'application/json' }),
          name: moveFileName(now).replace('bubbles-move', 'bubbles-backup') };
        passLine.textContent = '暗号化していない控えを作った（中の todo はそのまま読める）。「ファイルを保存する」で置く。' + what;
      }
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
    try { fileText = await f.text(); } catch (e) { toast((e && e.message) || '読めない'); fileText = ''; return; }
    /* どの形の控えも、このボタン1つで開く（Issue #48 の A 案）:
       bubbles-move（合言葉で暗号化）… 下の合言葉の欄で開く
       bubbles-backup-enc（毎日の控えの暗号化）… この端末の鍵で、だめなら合言葉で
       bubbles-backup（平文）… そのまま */
    let isMove = false;
    try { readMoveHead(fileText); isMove = true; } catch (e) { isMove = false; }
    if (!isMove) {
      let p;
      try {
        if (encryptedHead(fileText)) {
          const k = folderBackup ? await folderBackup.deviceKey() : null;
          p = null;
          if (k) { try { p = await openBackup(fileText, { key: k }); } catch (e) { p = null; } }
          if (!p) {
            const pass = await askText('暗号化した控え。合言葉（暗号化を始めたときに書き留めた 24 字）');
            if (!pass) { fileText = ''; return; }
            p = await openBackup(fileText, { pass });
          }
        } else {
          p = await openBackup(fileText);
        }
      } catch (e) { toast((e && e.message) || '読めない'); fileText = ''; return; }
      fileText = '';
      const info = moveSummary(p);
      const at = info.at ? new Date(info.at).toLocaleString() : '不明';
      const mode = await askReplaceOrAdd('このファイルから読み込む', [f.name, '書き出した時刻: ' + at + (info.device ? '（' + info.device + '）' : ''),
        '海 ' + info.seas + ' つ・todo ' + info.todos + ' 件' + appsLine(info).replace(/\n/g, '・')]);
      if (!mode) return;
      await restore(p, mode);
      return;
    }
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
    const mode = await askReplaceOrAdd('この端末に戻す', ['書き出した時刻: ' + at + (info.device ? '（' + info.device + '）' : ''),
      '海 ' + info.seas + ' つ・todo ' + info.todos + ' 件' + appsLine(info).replace(/\n/g, '・')]);
    if (!mode) return;
    await restore(p, mode);
    passForm.hidden = true;
    passIn.value = '';
    fileText = '';
  });

  /* 戻したあと、海域ごとに入り直すボタン（パスキーを作るのは押した手の続きでないと断る端末があるため。段2） */
  const joinRow = el('div', 'row');
  joinRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
  wrap.appendChild(joinRow);

  async function restore(p, mode = 'add') {
    let said = '';
    if (mode === 'replace') { line.textContent = '今の記録を控えている…'; said = await backupBeforeReplace(); }
    const got = importIntoDevice(p, { askLocal: true, replace: mode === 'replace', add: mode === 'add' });
    const n = got.n;
    line.textContent = (said ? said + '。' : '') + '海 ' + n + ' つの記録を' + (mode === 'replace' ? '入れ替えた。' : '戻した（今の記録に重ねた）。');
    /* ほかの app の束は、その app へ渡す（日記は diary の /api/import。bubble の記録には入れない。2026-11-18 §8.3） */
    if (p.apps) {
      deliverApps(p.apps).then(lines => { if (lines.length) line.textContent += lines.join('。') + '。'; })
        .catch(e => { line.textContent += '日記を渡せなかった（' + ((e && e.message) || e) + '）。'; });
    }
    if (Array.isArray(p.regions) && p.regions.length) {
      if (got.added.length) line.textContent += 'サーバー ' + got.added.map(r => r.name).join('・') + ' を足した。';
      joinRegions(p, got.map);
      return;
    }
    pendingServer = p.server && p.server.url ? p.server : null;
    if (pendingServer && pendingServer.move && !(sync.config().passkey && sync.config().passkey.valid)) {
      line.textContent += '続けて下のボタンで、サーバーに入る。';
      retry.hidden = false;
    } else if (pendingServer) joinServer();
  }

  /* 海域ごとに入り直す（段2。regions と servers のあるファイル）。
     合言葉 … その海域にまだ鍵が無ければ、その合言葉で繋ぐ（ある海域は替えない）
     引っ越しの鍵 … その海域でまだパスキーで入っていなければ、［「名前」に入る］を出す */
  function joinRegions(p, map) {
    joinRow.textContent = '';
    const said = [];
    Object.keys(p.servers || {}).forEach(fid => {
      const rid = map[fid];
      const s = p.servers[fid];
      const r = rid && findRegion(rid);
      /* サーバーの海域を「この端末だけ」へ付け替えたとき（Issue #62）は、その鍵で繋がない */
      if (!r || r.kind !== 'server' || !s || !s.url) return;
      const now = sync.regionSummary(rid);
      if (s.token || s.shareToken) {
        if (now.token || now.passkey) { said.push(r.name + 'はもう鍵がある（替えない）'); return; }
        if (sync.configureRegion(rid, s.url, s.token || '', s.shareToken || '')) said.push(r.name + 'に合言葉で繋いだ');
        return;
      }
      if (s.move) {
        if (now.passkeyValid) { said.push(r.name + 'にはもうパスキーで入っている'); return; }
        const b = el('button', 'btn', '「' + escapeHtml(r.name) + '」に入る（パスキーを作る）');
        b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const out = await registerPasskey(s.url, s.move);
            sync.usePasskeySessionRegion(rid, s.url, out);
            b.remove();
            line.textContent += '「' + r.name + '」に「' + out.name + '」として入った。';
          } catch (e) {
            b.disabled = false;
            line.textContent += '「' + r.name + '」に入れなかった: ' + ((e && e.message) || e) + '。';
          }
        });
        joinRow.appendChild(b);
        return;
      }
      said.push(r.name + 'は住所だけ（入る鍵が無い。歯車から合言葉を入れるか、持ち主に招待を頼む）');
    });
    if (said.length) line.textContent += said.join('。') + '。';
    if (joinRow.children.length) line.textContent += '続けて下のボタンで、サーバーごとに入る。';
  }

  /* サーバーに入る。パスキーの形は引っ越しの鍵で、この端末のパスキーを登録する */
  async function joinServer() {
    const s = pendingServer;
    if (!s) return;
    const cur = sync.config();
    if (cur.url && cur.url !== s.url) {
      line.textContent += 'この端末はほかのサーバー（' + cur.url + '）に繋いでいるので、繋ぐ先の設定は変えない。';
      pendingServer = null;
      return;
    }
    if (s.token || s.shareToken) {
      sync.configure(s.url, s.token || '', s.shareToken || '');
      line.textContent += 'サーバーに合言葉で繋いだ。';
      pendingServer = null;
      return;
    }
    if (!s.move) {
      line.textContent += 'サーバーに入る鍵は入っていない（住所だけ入れた。持ち主に招待コードを頼む）。';
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
      line.textContent += '「' + out.name + '」としてサーバーに入った。この引っ越しの鍵は使い終わったので、'
        + '次の引っ越しのファイルはこの端末で作り直す。';
      pendingServer = null;
    } catch (e) {
      line.textContent += 'サーバーに入れなかった: ' + ((e && e.message) || e) + '。';
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
  wrap.appendChild(el('h3', null, 'フォルダに自動で書き出す'));
  wrap.appendChild(el('p', 'note',
    'フォルダを1度選ぶと、この app を開いている間、書き換えて 30 秒たったときと 10 分ごと（と画面を裏に回したとき）に、'
    + 'そのフォルダの「bubbles-backup-日付.json」へ、この端末のすべての海の記録を書く。1日1つのファイルで、その日のうちは上書きする。'
    + '古い日のファイルは消さない（要らなくなったら自分で消す）。サーバーに繋がらない間の保険になる。'));
  wrap.appendChild(el('p', 'note',
    '既定では暗号化しない（中の todo はそのまま読める）。合言葉・鍵は入れない（同期の先のサーバーの名前と住所は入れる。新しい端末で戻したとき、海ごとに同期の先を戻すため）。'
    + 'iCloud Drive などのフォルダを選ぶと、そこにも記録が置かれるので、「暗号化して書く」を勧める。'));
  wrap.appendChild(el('p', 'note',
    '「暗号化して書く」: app が合言葉（24 字）を作って1度だけ見せ、その合言葉から作った鍵をこの端末のブラウザに置く（取り出せない形）。'
    + '書くたびの確認は無い。この端末ではそのまま戻せ、ほかの端末では合言葉で開く。合言葉を失くすと、ほかの端末では開けない。'));
  const ok = folderBackupSupported() && !!folderBackup;
  if (!ok) {
    wrap.appendChild(el('p', 'note',
      'このブラウザでは使えない（フォルダに書く仕組みが無い）。Chrome か Edge で開く（Mac の Chrome でインストールした app でもよい）。'
      + '書いたファイルは「ファイルに書き出す」の［ファイルから読み込む］で開ける（どのブラウザでも使える）。'));
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
  const encBtn = el('button', 'btn', '暗号化して書く');
  encBtn.type = 'button';
  /* 読み込むボタンは「ファイルに書き出す」の［ファイルから読み込む］1つにまとめた（Issue #48） */
  [pickBtn, nowBtn, permBtn, encBtn, offBtn].forEach(b => { if (ok) row.appendChild(b); });
  wrap.appendChild(row);
  const line = el('p', 'note');
  line.setAttribute('aria-live', 'polite');
  wrap.appendChild(line);
  const encPassLine = el('p', 'note');
  encPassLine.hidden = true;
  wrap.appendChild(encPassLine);

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
    encBtn.hidden = !c.on;
    encBtn.textContent = c.enc ? '暗号化をやめる' : '暗号化して書く';
    permBtn.hidden = s.state !== 'need-permission';
    const how = c.enc ? '（暗号化して）' : '（暗号化せずに）';
    if (s.state === 'off') line.textContent = '止めてある（フォルダを選ぶと始まる）。';
    else if (s.state === 'need-key') line.textContent = 'この端末に暗号化の鍵が無いので控えていない。「暗号化をやめる」を押してから、もう一度「暗号化して書く」を押す。' + last;
    else if (s.state === 'no-folder') line.textContent = 'フォルダを覚えていない。もう一度選ぶ。';
    else if (s.state === 'need-permission') line.textContent = where + 'に書く許しが切れている。「書く許しを出し直す」を押すまで控えない。' + last;
    else if (s.state === 'error') line.textContent = where + 'に書けなかった: ' + s.message + '。' + last;
    else line.textContent = where + 'に' + how + '控えている。' + last;
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
  encBtn.addEventListener('click', async () => {
    const c = folderBackup.status().conf;
    encBtn.disabled = true;
    try {
      if (c.enc) {
        if (!window.confirm('暗号化をやめて、次から平文で書く？（前に書いた暗号化した控えは、合言葉で開ける）')) return;
        await folderBackup.stopEncrypt();
        encPassLine.hidden = true;
      } else {
        if (!window.confirm('次から暗号化して書く？\n合言葉を1度だけ出す。ほかの端末で戻すときに要るので、書き留める（パスワードの管理に入れる）。')) return;
        const pass = await folderBackup.startEncrypt();
        encPassLine.textContent = '合言葉: ' + pass + '　← 書き留める。この画面を閉じると、もう出せない（失くしたら「暗号化をやめる」→「暗号化して書く」で作り直す）。';
        encPassLine.hidden = false;
      }
    } catch (e) {
      toast('切り替えられなかった: ' + ((e && e.message) || e));
    } finally { encBtn.disabled = false; paint(); }
  });
  return wrap;
}

/* どの海域を入れるかを選ぶ（段2。利用者の指示「海域ごとに引越しとすべてを選べる様に」）。
   「すべての海域」（既定）と、海域ごとのチェック。海域が1つなら何も出さず、その1つを入れる。
   戻り値 { el, chosen() → 海域の ID の配列 } */
function regionPicker(what) {
  const wrap = el('div', 'region-pick');
  const regions = regionList();
  if (regions.length < 2) return { el: wrap, chosen: () => regions.map(r => r.id) };
  wrap.appendChild(el('p', 'note', escapeHtml(what) + 'に入れる海（同期の先ごと）'));
  const allRow = el('label', 'setrow');
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.checked = true;
  allRow.appendChild(allCb);
  allRow.appendChild(el('span', null, 'すべての海'));
  wrap.appendChild(allRow);
  const cbs = regions.map(r => {
    const row = el('label', 'setrow region-pick-one');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.disabled = true;
    cb.dataset.region = r.id;
    row.appendChild(cb);
    row.appendChild(el('span', null, escapeHtml(r.name) + (r.kind === 'local' ? '（この端末だけ）' : '')));
    wrap.appendChild(row);
    return cb;
  });
  allCb.addEventListener('change', () => {
    cbs.forEach(cb => { cb.disabled = allCb.checked; if (allCb.checked) cb.checked = true; });
  });
  return { el: wrap, chosen: () => (allCb.checked ? regions.map(r => r.id) : cbs.filter(cb => cb.checked).map(cb => cb.dataset.region)) };
}

/* この端末の海の記録。開いている海は store から、ほかは箱から（引っ越しのファイルとチェーンの控えで共用） */
function collectBoxes() {
  const boxes = {};
  /* すべての海域の個人と海（2026-11-12。js/regions.js）。海域の外れた海も箱があれば入れる */
  const ids = ['me'].concat(allSpaceIds(), seaList().map(e => e.id)).filter((v, i, a) => a.indexOf(v) === i);
  ids.forEach(id => {
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
function mergeIntoDevice(p, opts) { return importIntoDevice(p, opts).n; }

/* 海域の一覧（regions）のあるファイルは、この端末の海域へ付け替えてから重ねる（段2。js/regions.js）。
   戻り値 { n: 戻した海の数, map: { ファイルの海域の ID: この端末の海域の ID }, added: 足した海域 }
   opts.askLocal: ファイルに「この端末だけ」（サーバーなし版など）の記録があり、いま開いている海がサーバーと合わせる海なら、
   その記録をこのサーバーに入れるかを聞く（2026-11-13 Issue #50 の返事「サーバーなし版で作った TODO をサーバーあり版に移せる？」）。
   入れると、ファイルの個人はこのサーバーの個人へ、作った海はこのサーバーと合わせる海になる（ふだんの同期でサーバーへ写る）。
   断ると前のとおり「この端末だけ」の海に入る。
   逆向き（2026-11-14 Issue #62「サーバーあり版からサーバーなし版に TODO 移せる？」）: サーバーなし版で opts.askLocal の道から読み、
   ファイルにサーバーと合わせる記録があれば、それを「この端末だけ」の海に入れるかを聞く。入れると、サーバーの個人はこの端末の個人へ
   （いくつあっても記録ごとに重ねる）、作った海はこの端末だけの海になる。サーバーの海域は足さない・どこへも送らない。
   断ると前のとおりサーバーの海として入る（サーバーなし版では、開くとサーバーに繋ぐページへ移る） */
function importIntoDevice(p, opts = {}) {
  /* 上書き（2026-11-19）: 読み込んだ海の記録で、この端末のその海を丸ごと入れ替える（js/merge.js の replaceState）。読み込んだものに無い海には触らない */
  /* 追加（opts.add）: 重ねたうえで、読み込んだものにあって今は消えている泡も戻す（js/merge.js の addState）。どちらでもなければ前のとおり重ねる */
  const combine = opts.replace ? ((local, fromFile) => (fromFile ? replaceState(local, fromFile) : local))
    : opts.add ? ((local, fromFile) => (fromFile ? addState(local, fromFile) : local)) : mergeBox;
  if (p && Array.isArray(p.regions) && p.regions.length) {
    const fileServers = serverRegionsInFile(p.regions);
    const toLocal = !!(opts.askLocal && isSolo() && fileServers.length
      && window.confirm('このファイルには、サーバーと合わせる記録がある（' + fileServers.map(r => '「' + r.name + '」').join('・') + '）。\n'
        + 'それを、この端末だけの海に入れる？（個人は個人へ、作った海はこの端末だけの海になる。サーバーへは送らない）\n'
        + 'キャンセルなら、サーバーの海として入れる（開くとサーバーに繋ぐページへ移る）。'));
    const rest = toLocal ? p.regions.filter(r => fileServers.indexOf(r) < 0) : p.regions;
    const { map, added } = importRegions(rest);
    if (toLocal) {
      fileServers.forEach(r => { map[r.id] = 'local'; });
      const r = remapPayload(p, map, undefined, mergeBox);
      const n = mergeBoxes({ seas: r.seas, boxes: r.boxes }, combine);
      return { n, map, added };
    }
    /* 入れる先: 開いている海のサーバー。開いている海が この端末だけ なら、前からの個人のサーバーか、最初に足したサーバー
       （2026-11-13 Issue #50 の返事「ブロックチェーン経由で移したら、先の選択が出てこなかった」） */
    const cur0 = sync.region();
    const srvs = serverRegions();
    const here = cur0.kind === 'server' ? cur0
      : (srvs.find(r => r.id === defaultRegionId()) || srvs[0] || cur0);
    const locals = Object.keys(map).filter(k => map[k] === 'local');
    if (opts.askLocal && locals.length && here.kind === 'server'
      && window.confirm('このファイルには「この端末だけ」（サーバーなし版など）の記録がある。\n'
        + 'それを、サーバー「' + here.name + '」に入れる？（個人は個人へ、作った海はこのサーバーと合わせる海になり、サーバーへ写る）\n'
        + 'キャンセルなら、この端末だけの海に入れる（サーバーへは送らない）。')) {
      locals.forEach(k => { map[k] = here.id; });
    }
    const r = remapPayload(p, map);
    const n = mergeBoxes({ seas: r.seas, boxes: r.boxes }, combine);
    return { n, map, added };
  }
  return { n: mergeBoxes(p, combine), map: {}, added: [] };
}

/* ファイルの海域の一覧のうち、サーバーと合わせるもの（住所のあるもの。importRegions が付け替えられるもの） */
function serverRegionsInFile(fileRegions) {
  return (fileRegions || []).filter(r => r && r.id !== 'local' && r.kind !== 'local' && String(r.url || ''));
}

function mergeBoxes(p, combine = mergeBox) {
  mergeSeas(p.seas || []);
  let n = 0;
  Object.keys(p.boxes || {}).forEach(id => {
    if (id !== 'me' && !ID_RE.test(id) && !PERSONAL_RE.test(id)) return;
    const fromFile = p.boxes[id];
    if (id === store.space()) {
      store.applyState(combine(store.exportState(), fromFile));
    } else {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(boxKey(id)) || 'null'); } catch (e) { raw = null; }
      try { localStorage.setItem(boxKey(id), JSON.stringify(stateToBox(combine(boxToState(raw), fromFile)))); } catch (e) {
        toast('入りきらない（端末の空きが足りない）');
        return;
      }
    }
    n++;
  });
  return n;
}

/* サーバーなし版（noserver.html）か。head の <meta name="bubbles-edition" content="solo"> で見分ける */
function isSolo() {
  try { return !!document.querySelector('meta[name="bubbles-edition"][content="solo"]'); } catch (e) { return false; }
}

/* 入口を1つにした（2026-11-11 Issue #38）。開いたときに js/boot-edition.js が、サーバーに繋いでいなければ
   サーバーなし版（noserver.html）へ移す。サーバーに繋ぐときは、ここからサーバーありの版（index.html）を開く。
   その窓の間だけ移さない印（sessionStorage）を置く。住所を入れて繋げば、次からはずっとサーバーありの版で開く */
const EDITION_STAY_KEY = 'bubble_todo_edition_stay';   /* js/boot-edition.js の STAY_KEY */
function soloServerBox() {
  const wrap = el('div', 'tags');
  wrap.appendChild(el('h3', null, 'サーバーに繋ぐ（複数の端末で同じ記録を使う）'));
  wrap.appendChild(el('p', 'note',
    'いまはサーバーに繋がないページ（通信してよい先を決め打ちにして守っている）で開いている。'
    + 'サーバーに繋ぐときは、下のボタンでサーバーに繋ぐページを開き、この ⚙ で住所を入れる。繋いだあとは、開くとそのページになる'
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
  ['サーバーに置いた記録（同じサーバーにまた繋ぐと戻ってくる）',
    'ブロックチェーンに保存したバックアップ（消せない。同じパスキーか合言葉で戻せる）',
    '画面の「!」が覚えているエラーの記録と、app 本体'].forEach(s => { const li = el('li'); li.textContent = s; kept.appendChild(li); });
  panel.appendChild(kept);
  panel.appendChild(el('p', 'note',
    '残しておきたい記録があれば、先に上の「記録を保存する・読み込む」の「ファイルに書き出す」で書き出しておく。'
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
/* ブロックチェーンの欄。2026-11-12 Issue #45（A 案）で、1つの欄を働きごとの箱に分けて置けるようにした:
     opts.setup  … 始め方（パスキー・合言葉）・ネット・鍵の移し替えを出す欄（「サーバー・ブロックチェーンを準備する」）
     opts.tasks  … この欄で出す「やりたいこと」（TASKS の key）。1つだけならボタンを並べずに、その操作を出す
     opts.title  … 見出し
     opts.goSetup(k) … この欄に無いやりたいこと（ウォレット・始め方）へ移るとき。準備の箱を開く
   どの欄も鍵と設定は同じもの（localStorage の CONFIG_KEY）を読む。別の欄で変えたら refresh() で読み直す */
/* 盤のひとことを送ったときの読み込みで使う鍵（{ id, gen, keys, seaKey, until }）。メモリにだけ 10 分置く（Issue #68）。
   ひとことの署名の鍵（js/notesign.js）と同じ置き方。ページを閉じると消える */
const READ_HOLD_MS = 10 * 60 * 1000;
let readHold = null;
/* 共有の面のサーバーの海のカードから、サーバーのチャット・サーバーの設定を開く受け口（Issue #68 の X 案。設定を描き直すたびに付け替える） */
let srvHandlers = null;
/* 知らせの［開く］から共有の海のチャットを開く受け口（Issue #68。設定を描き直すたびに付け替える） */
let openChatHandler = null;

/* ---- 読むための鍵と、開いている間の読み込み（2026-11-15 Issue #68 の返事「おすすめで」= A 案・B 案） ----
   A: 海の鍵を開けたときに、読むための鍵（js/board.js の readKeysOf）を共有の海の控えに置く。以後、読むだけならパスキー・合言葉は要らない。
   B: アプリを開いている間（画面が見えている間）、開いたときと 5 分ごとに共有の海を読み、
      記録（盤のひとことを含む）は確かめずに重ね（消さないので）、チャットの新しいメッセージは端末の履歴に足して「新しい件数」を出す。
      読むだけなので手数料は掛からない。アプリを閉じている間は読まない */
async function keepReadKeys(id, seaKey, gen) {
  try {
    const rk = await readKeysOf(seaKey, gen);
    const all = loadShared();
    if (!all[id]) return;
    all[id] = Object.assign({}, all[id], { rk });
    saveShared(all);
  } catch (e) { /* 置けなくても、鍵を開ければ読める */ }
}
/* 記録の中身の目印（同期で「新しい書き込みがあるか」を見る。中身を写さず短い数字にする） */
function sigOfBox(b) {
  if (!b || !b.doc) return '';
  const s = JSON.stringify(b.doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return s.length.toString(36) + '.' + h.toString(36);
}
function seaStateById(id) {
  /* 読むだけなので保存しない（2026-11-19）。前は store.flush() を呼んでいて、保存の知らせ（store.onPersist）で同期がもう 1 回走り、
     同期の知らせでここがまた呼ばれる、の繰り返しになっていた（共有の海で設定を開いている間、1 秒に約 100 回 /api/data を読み、サーバーの回数の上限に当たる） */
  if (id === store.space()) return store.exportState();
  try { return boxToState(JSON.parse(localStorage.getItem(boxKey(id)) || 'null')); } catch (e) { return null; }
}
function pendingNotesIn(st) {
  const dev = noteDevice();
  return (st && st.doc && Array.isArray(st.doc.notes) ? st.doc.notes : []).filter(n => n && !n.gone && !n.sg && n.dev === dev && n.text);
}
/* チャットを最後に見た時刻（部屋ごと。端末にだけ置く） */
const CHAT_SEEN_KEY = 'bubble_todo_chat_seen_v1';
function chatSeen() { try { return JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
/* quiet: 知らせ（面の描き直し）を出さない。チャットを開く途中で呼ぶとき（2026-11-16 Issue #68 の返事「共有の海のチャットボタンを押しても
   チャットメッセージを送る画面が表示されない」: 知らせはその場で面を描き直すので、組み立て中のチャットの欄が画面から外れていた） */
function markChatSeen(room, quiet) {
  const all = chatSeen();
  all[room] = Date.now();
  try { localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(all)); } catch (e) { /* 覚えられなくても進む */ }
  if (quiet) return;
  try { window.dispatchEvent(new CustomEvent('bubbles:chat-unread')); } catch (e) { /* 知らせなくても進む */ }
}
/* その共有の海のチャットの、まだ見ていないほかの人のメッセージの数（端末の履歴から数える） */
function chatUnread(rec) {
  if (!rec) return 0;
  const room = 'sea:' + rec.id + ':' + rec.gen;
  const seen = Number(chatSeen()[room]) || 0;
  return loadHistory(room).filter(m => m.by !== rec.me && Number(m.at) > seen).length;
}
/* サーバーで合わせる海のチャット（海の記録の CHAT_TODO）の、まだ見ていないほかの端末のメッセージの数（2026-11-16 Issue #68 の X 案）。
   見た時刻は部屋 'srv:<海の ID>' として同じ所に置く */
function serverChatUnread(id) {
  const st = seaStateById(id);
  const seen = Number(chatSeen()['srv:' + id]) || 0;
  const dev = noteDevice();
  return (st && st.doc && Array.isArray(st.doc.notes) ? st.doc.notes : [])
    .filter(n => n && n.todo === CHAT_TODO && !n.gone && n.dev !== dev && Number(n.at) > seen).length;
}
/* 共有の海 1 つを、読むための鍵で読む（鍵を求めない）。記録は確かめずに重ね、チャットは履歴に足す。新しく足したチャットの数 */
/* 記録の写しを重ねる（自動の読み込み・直の通信の受け取り）。cur は共有の海の控え（書き換える。保存は呼ぶ側）。
   重ねる直前に「前の同期のあとの書き込みが無いか」を見て、無ければ重ねたあとの中身を目印にする（ここから書くまで await しない） */
/* ほかのメンバーが写しに入れた「海の一覧の 1 件」から、名前・色・書き換えた時刻だけを使う（2026-11-16 Issue #68 の点検）。
   そのまま重ねると、消した印（alive 0）でこちらの端末の海が消え（共有の控えも外れる）、
   同期の先（region）でこちらの海の繋ぎ先（自分のサーバー など）が変わってしまえた */
function memberEntry(entry, id) {
  if (!entry || typeof entry !== 'object' || entry.id !== id) return null;
  return { id, name: entry.name, color: entry.color, at: entry.at, alive: 1 };
}
function mergeSnapsInto(cur, snaps) {
  const id = cur.id;
  const before = seaStateById(id);
  const clean = !!cur.syncMark && !pendingNotesIn(before).length && sigOfBox(before) === cur.syncMark;
  snaps.forEach(s => {
    const entry = memberEntry(s.entry, id);
    mergeIntoDevice({ seas: entry ? [entry] : [], boxes: { [id]: s.box } });
  });
  cur.readAt = Date.now();
  if (clean) cur.syncMark = sigOfBox(seaStateById(id));
}

/* ---- 直の通信（2026-11-16 Issue #68 の返事「おすすめで」= C1） ----
   「同期」の写しに「ここにいる」（端末の印 dev と時刻）を入れる（手数料は増えない）。アプリを開いている間、自動の読み込みで
   10 分以内の「ここにいる」を見つけたら、js/p2p.js の網（Mesh）で「つなぎたい」を書き、相手の端末が「つなぐ」を返す（1 回つなぐごとに 2 件の手数料）。
   つながったら、盤のひとこと・記録・チャットをその線で直に送り合う（手数料なし）。
   書くにはウォレットの署名が要るので、「同期」で鍵を開けたら、ページを閉じるまでウォレットの鍵をメモリに置く（sessionKeys。端末には置かない）。
   鍵を開けていない端末は、つなぎにいかない（「ここにいる」も書かない）。設定のチャットを開いている海は、チャットの網に任せる */
let sessionKeys = null;
const SESSION_HOLD_MS = 12 * 60 * 60 * 1000;   /* ひとことの署名の鍵も、同じく開いている間（長くても 12 時間）置く */
const meshes = new Map();   /* 海の ID → { mesh, gen } */
const offered = new Map();  /* 海|相手の端末 → 「つなぎたい」を書いた時刻（同じ相手へ 10 分に 1 度まで。手数料の無駄を防ぐ） */
let chatOpenSea = null;
/* 設定のチャットの網（{ id, send()（記録を直に送る。届けた台数）, count()（つながっている台数） }）。チャットを開いている間だけ */
let chatLink = null;
let fastTimer = 0;
function holdSessionKeys(keys) {
  if (keys && keys.wallet) sessionKeys = keys;
}
function meshFor(rec) {
  if (!sessionKeys || !rec || sessionKeys.wallet.address !== rec.me || chatOpenSea === rec.id) return null;
  const prefs = loadP2pPrefs();
  if (!prefs.on || !p2pSupported()) return null;
  const rb = readBoardsOf(rec);
  if (!rb || !rb.chat) return null;
  const had = meshes.get(rec.id);
  if (had && had.gen === rec.gen) return had.mesh;
  if (had) { try { had.mesh.close(); } catch (e) { /* 閉じられなくても進む */ } meshes.delete(rec.id); }
  const id = rec.id, gen = rec.gen, net = rec.net, chat = rb.chat, wallet = sessionKeys.wallet;
  const room = 'sea:' + id + ':' + gen;
  const now = () => loadShared()[id] || rec;
  const seaName0 = () => { const e = allEntries().find(x => x.id === id); return e ? e.name : id; };
  const mesh = new Mesh({
    sea: id, g: gen, dev: deviceId(), ice: iceServers(prefs),
    allowed: () => [now().owner].concat((now().members || []).map(m => m.a)),
    post: async (inner) => {
      /* 「つなぎたい」も「つなぐ」も、同じ相手へは 10 分に 1 度まで（2026-11-16 Issue #68 の点検: メンバーが「つなぎたい」を
         何度も書くと、こちらがそのたびに「つなぐ」を書いて手数料が減っていった） */
      if (inner.kind === 'offer' || inner.kind === 'answer') {
        const k = id + '|' + inner.kind + '|' + inner.to;
        if (Date.now() - (offered.get(k) || 0) < HELLO_MS) throw new Error('この相手へは、少し前につなぎに行った');
        offered.set(k, Date.now());
      }
      await writePost(net, wallet, await postMemos(wallet, inner, chat), chat);
    },
    history: () => loadHistory(room),
    onMessages: (list) => {
      const r = mergeHistory(loadHistory(room), list, 'p2p');
      if (r.added) { saveHistory(room, r.list); try { window.dispatchEvent(new CustomEvent('bubbles:chat-unread')); } catch (e) { /* 進む */ } }
    },
    snapshot: async () => {
      const box = collectBoxes()[id];
      if (!box) return null;
      return signSnap(wallet, { sea: id, g: gen, entry: allEntries().find(e => e.id === id) || null, box });
    },
    onSnap: (inner) => {
      const all = loadShared();
      if (!all[id] || all[id].gen !== gen) return;
      mergeSnapsInto(all[id], [inner]);
      saveShared(all);
    },
    onPeerOpen: () => { toast('「' + seaName0() + '」の相手と直につながった（ひとことは手数料なしで届く）'); },
    /* つなぐ途中の失敗を覚えて、カードに出す（Issue #68 の返事「webRTC動いてないように見える。確認できる？」） */
    onError: (e) => { const m = meshes.get(id); if (m) m.lastError = String((e && e.message) || e).slice(0, 120); },
    onState: () => { try { window.dispatchEvent(new CustomEvent('bubbles:p2p-state')); } catch (e) { /* 進む */ } },
  });
  meshes.set(id, { mesh, gen });
  /* 顔合わせは「つなぎたい」「つなぐ」が 3 分で切れるので、網があるあいだはチャットの掲示板だけを 20 秒ごとに読む */
  if (!fastTimer) fastTimer = setInterval(fastPoll, 20000);
  return mesh;
}
async function fastPoll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!meshes.size) { clearInterval(fastTimer); fastTimer = 0; return; }
  for (const [id, m] of meshes) {
    const rec = loadShared()[id];
    const rb = rec && rec.gen === m.gen ? readBoardsOf(rec) : null;
    if (!rb || !rb.chat || chatOpenSea === id) continue;
    try { await m.mesh.onPosts(await readChatPosts(rec.net, rb.chat)); } catch (e) { /* 次に読む */ }
  }
}
/* 直につながっている相手へ、その海の記録をすぐ送る（盤のひとことを積んだあと。手数料なし）。送った相手の数 */
export async function pushSeaDirect(id) {
  /* 設定のチャットを開いている海は、裏の網を閉じてチャットの網に任せている。そのときはチャットの線で送る
     （2026-11-16 Issue #68 の返事「設定のチャットはwebRTC動いてるように見える。TODOのひとことを…送るをした後、同期するボタンを押したけど動いてないように見える」:
     前は裏の網しか見ていなかったので、チャットで直につながっていても、ひとことは直に送られなかった） */
  if (chatLink && chatLink.id === id && chatLink.count() > 0) return chatLink.send();
  const m = meshes.get(id);
  if (!m || !m.mesh.openCount() || !m.mesh.snapshot) return 0;
  const env = await m.mesh.snapshot();
  return env ? m.mesh.broadcastSnap(env) : 0;
}
/* 直につながっている台数（裏の網とチャットの網の両方から。盤とカードの様子に使う） */
export function directCount(id) {
  if (chatLink && chatLink.id === id) return chatLink.count();
  const m = meshes.get(id);
  return m ? m.mesh.openCount() : 0;
}

async function watchOne(rec) {
  const rb = readBoardsOf(rec);
  if (!rb) return 0;
  const id = rec.id;
  const got = await readBoardWith(rec.net, rec, rb.board);
  const all = loadShared();
  const cur = all[id];
  if (!cur || cur.gen !== rec.gen) return 0;
  if (got.members) {
    cur.members = got.members.map(m => {
      const old = (cur.members || []).find(x => x.a === m.a && x.x);
      return m.x || !old ? m : Object.assign({}, m, { x: old.x });
    });
  }
  if (got.snaps.length) mergeSnapsInto(cur, got.snaps);
  all[id] = cur;
  saveShared(all);
  /* チャット */
  if (!rb.chat) return 0;
  const room = 'sea:' + id + ':' + cur.gen;
  const allowed = [cur.owner].concat((cur.members || []).map(m => m.a));
  const posts = await readChatPosts(cur.net, rb.chat);
  /* 直の通信（C1）: 同期の写しに入っている「ここにいる」と、チャットの掲示板の顔合わせを網へ渡す */
  const mesh = meshFor(cur);
  if (mesh) {
    const here = got.posts.filter(p => p.kind === 'snap' && p.sea === id && Number(p.g) === cur.gen && typeof p.dev === 'string')
      .map(p => ({ kind: 'hello', sea: id, g: cur.gen, dev: p.dev, at: Number(p.at) || 0, by: p.by }));
    mesh.onPosts(posts.concat(here)).catch(() => { /* つながらなくても読み込みは済んでいる */ });
  }
  const msgs = await messagesFromPosts(posts, { sea: id, g: cur.gen, allowed });
  const old = loadHistory(room);
  const oldIds = new Set(old.map(m => m.id));
  const r = mergeHistory(old, msgs, 'chain');
  if (r.added) saveHistory(room, r.list);
  /* 新しく足した、ほかの人のメッセージの数 */
  return msgs.filter(m => !oldIds.has(m.id) && m.by !== cur.me).length;
}
const WATCH_MS = 5 * 60 * 1000;
let watchTimer = 0;
let watching = false;
async function watchAll() {
  if (watching || (typeof document !== 'undefined' && document.hidden)) return;
  watching = true;
  try {
    const me = loadConfig().address;
    const recs = Object.values(loadShared()).filter(r => r && r.me === me && readBoardsOf(r));
    for (const rec of recs) {
      try {
        const n = await watchOne(rec);
        if (n > 0) {
          const ent = allEntries().find(e => e.id === rec.id);
          /* 短くし、［開く］でその海のチャットへ移る（2026-11-16 Issue #68 の返事「届いたメッセージが長すぎて枠からはみ出てる」「タップしたらその画面に遷移できない？」）。
             海の名前が長いときは切る */
          const nm = String(ent ? ent.name : rec.id);
          const id = rec.id;
          toast('新しいチャット ' + n + ' 件「' + (nm.length > 10 ? nm.slice(0, 9) + '…' : nm) + '」', {
            label: '開く', undo: false,
            on: () => {
              try { window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'settings' } })); } catch (e) { /* 進む */ }
              setTimeout(() => { try { window.dispatchEvent(new CustomEvent('bubbles:open-sea-chat', { detail: { id } })); } catch (e) { /* 進む */ } }, 80);
            },
          }, 8000);
          try { window.dispatchEvent(new CustomEvent('bubbles:chat-unread')); } catch (e) { /* 知らせなくても進む */ }
        }
      } catch (e) { /* 1 つ読めなくても、ほかは読む */ }
    }
  } finally { watching = false; }
}
/* アプリを開いたときに 1 度呼ぶ（js/app.js）。開いたとき・画面に戻ったとき・5 分ごとに読む */
export function startSharedWatch() {
  if (watchTimer || typeof window === 'undefined') return;
  setTimeout(() => { watchAll(); }, 3000);
  watchTimer = setInterval(() => { watchAll(); }, WATCH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watchAll(); });
}

function chainBox(opts = {}) {
  const setup = !!opts.setup;
  const ALLOWED = opts.tasks || ['backup', 'wallet', 'key', 'share', 'memo', 'lost'];
  /* 控えに入れる海域を選ぶ（段2。利用者の指示「海域ごとに…すべてを選べる様に」） */
  const chainPick = regionPicker('ブロックチェーンの控え');
  const wrap = el('div', 'tags');
  /* 共有の面（招待）だけ、まとまりを枠に入れて見せる（2026-11-16 Issue #75「招待画面の枠のレイアウトがスマホで良くない」） */
  if (opts.part === 'hub') wrap.classList.add('share-hub');
  /* 用語（2026-11-09 Issue #31 の返事で見直し）: ほかのウォレット・取引所と行き来するので、そちらと同じ言葉にそろえる。
     ウォレット・アドレス・バックアップ・Faucet。ボタンは「ウォレット」と「バックアップ」の2つに分けて並べる */
  /* 見出しは字として入れる（呼ぶ側の title を HTML として読まない。tests/html-sink.test.mjs） */
  const chainTitle = el('h3');
  chainTitle.textContent = opts.title || 'ブロックチェーンを使う（Solana・試し）';
  wrap.appendChild(chainTitle);
  /* サーバーが配るページでも使う（2026-11-11 Issue #42 の返事「おすすめで」= A 案）。
     server.py の CSP に Solana の公式 RPC を足したので、サーバーに繋いだままバックアップ・共有の海・チャットを使える。
     サーバーでない所（GitHub Pages・Android の app）で繋いでいない index.html は、開いたときに noserver.html へ移る（js/boot-edition.js） */
  if (setup) {
    wrap.appendChild(el('p', 'note',
      '自分の記録を暗号化して、Solana の取引のメモに分けて書く。チェーンに書いたものは消せない（鍵が漏れれば、あとからでも読める）。'
      + '分けた取引が1つでも欠けると戻せない。サーバーの住所と鍵、AI のキーは書かない。'
      + '鍵は3種類: <b>パスキー</b>と<b>合言葉</b>は、ウォレット（手数料を払う）とバックアップの両方を開く。'
      + '<b>復元コード</b>はバックアップを読むだけ（お金は動かせず、書けない）。ウォレットは手数料ぶんの少額だけを入れる。'
      + 'ここで始めたあと、海の共有とチャットは「他の人と一緒に使う」、自分のほかの端末と合わせる・自分にメモを送るのは「自分の端末どうしで使う」、'
      + 'バックアップは「記録を保存する・読み込む」で使う（「他の人と一緒に使う」の面からも、ここと同じ鍵を選べる）。'));
  }

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
  /* ネットを選ぶのは準備の欄だけ。ほかの欄は、準備の欄で選んだネット（cfg.network）で動く */
  if (setup) wrap.appendChild(netRow);

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
    /* opts.say: 設定の画面の外（盤）から使うときに、知らせを呼んだ側へも渡す（Issue #68。syncSharedSea） */
    set textContent(v) { target().textContent = v; if (typeof opts.say === 'function') { try { opts.say(v); } catch (e) { /* 知らせで止めない */ } } },
  };

  let into = row;
  let groupKey = null;
  /* やりたいこと（2026-11-11 Issue #43）。始めたあとは、ボタンを全部並べずに「やりたいこと」のボタンだけを出し、
     押したものの操作だけを下に出す。もう一度押すと畳む。paint をまたいで覚える（設定を開き直しても同じ所） */
  const TASKS = [
    /* 名前は「何をするか」で書く（Issue #43 の返事:「バックアップという名詞じゃなくて、バックアップをするみたいな名前に」） */
    ['backup', 'バックアップする', '保存・復元・復元コードを表示'],
    ['wallet', 'ウォレットを見る', '残高を見る・テスト用の SOL・送る'],
    ['key', '鍵を替える', '新しい鍵へ移し替える・パスキー／合言葉を切り替える'],
    ['share', '海を共有する', '自分の海に人を招く・招待を受ける・共有中の海'],
    ['memo', '自分にメモを送る', '自分の端末どうしで短いメモを送り合う'],
    ['lost', '鍵を失ったときに読む', '復元コードで読む・この端末での設定を消す'],
  ].filter(([k]) => ALLOWED.includes(k));
  /* やりたいことが1つだけの欄（バックアップ・共有など）は、ボタンを並べずにその操作をいつも出す */
  const single = TASKS.length === 1 ? TASKS[0][0] : null;
  let task = single;
  /* 「招く」で選んでいる共有中の海の ID（Issue #68 の返事「他の人と一緒に使うの設定の流れで出てきた方がわかりやすい？」）。paint をまたいで覚える */
  let inviteSel = null;
  /* いちばん最近作った招待コード（{ id, code }）。この画面を開いている間だけ。端末には残さない（Issue #68） */
  let lastCode = null;
  /* 見出しつきのまとまりを足し、以後の btn はそこへ並べる。parent は畳む箱（fold）に入れるとき */
  function group(key, title, note, parent = row) {
    /* cb-group・cb-row: 共有の面（.share-hub）で、まとまりを枠に入れ、スマホでは欄とボタンを1行ずつにする（2026-11-16 Issue #75。css/screens/stub.css） */
    const g = el('div', 'cb-group');
    g.style.cssText = 'margin-top:10px';
    g.appendChild(el('h4', null, title));
    if (note) g.appendChild(el('p', 'note', note));
    const r = el('div', 'row cb-row');
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
  /* 共有の流れ（読むだけの説明）。見出し（h4）とボタンの並びと同じ形だと、押せる所と見分けにくかった（Issue #68 の返事
     「共有の流れの項目 ボタンとかないけど同じ太白文字なので、見え方など工夫できる？」）。
     畳んだ説明の箱にし、細い字・左の線・薄い地で、操作のまとまりと見分ける。初めて開いたとき（共有中の海が無い）だけ開いた姿で始める */
  function flowBox(open) {
    const d = document.createElement('details');
    d.className = 'share-flow';
    d.style.cssText = 'margin-top:10px;padding:6px 10px;border-left:3px solid rgba(127,127,127,.5);'
      + 'background:rgba(127,127,127,.08);border-radius:4px;font-weight:normal';
    if (open) d.open = true;
    const s = el('summary', null, 'ⓘ 共有の流れ（招く人と招かれる人の2人で）');
    s.style.cssText = 'cursor:pointer;font-weight:normal;opacity:.85';
    d.appendChild(s);
    const body = el('div', null, SHARE_FLOW);
    body.style.cssText = 'margin-top:6px;font-size:.92em;font-weight:normal;line-height:1.6;opacity:.9';
    d.appendChild(body);
    row.appendChild(d);
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
    const here = TASKS.some(([key]) => key === k);
    if (!here && !opts.goSetup) return;
    const t = target();
    const b = el('button', 'btn');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'margin-left:8px';
    b.addEventListener('click', () => {
      /* この欄に無いもの（ウォレットなど）は、準備の箱のその操作を開く（Issue #45） */
      if (!here) { opts.goSetup(k); return; }
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
    /* 鍵の選び方は、押したときに端末の設定から読み直す（Issue #68 の返事「招待コードを読み取る時に合言葉のみでてきた。ウォレットはパス…で設定してる」）。
       欄ごとに設定の写しを持っていて、別の欄（準備の箱）でパスキーへ切り替えても、開いたままの欄は前の「合言葉」のままだった。
       読み直しは await の前なので、パスキーを押した手の続きのまま呼べる */
    const fresh = loadConfig();
    if (fresh.mode && (fresh.mode !== cfg.mode || fresh.address !== cfg.address || fresh.credId !== cfg.credId)) {
      cfg = Object.assign({}, cfg, { mode: fresh.mode, credId: fresh.credId, address: fresh.address });
    }
    if (cfg.mode === 'passkey') {
      const got = await passkeyRoot(cfg.credId);
      return keysFromRoot(got.root);
    }
    if (cfg.mode === 'pass') {
      /* どのウォレットの合言葉かを出す（パスキーのつもりで合言葉を聞かれたときに気づけるように） */
      const pass = await askText('合言葉（始めたときに書き留めた 24 字。このウォレット ' + shortAddr(cfg.address) + ' は合言葉で始めた）');
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
    info.hidden = false;
    into = row;
    /* サーバーあり版の共有の面（Issue #78）: ブロックチェーンの鍵選び・共有中のチェーンの海・直の通信は出さず、
       サーバーの海のカード → ＋ 海を共有する（サーバーで）→ 招待コードを受け取る（サーバーの形だけ）にする */
    if (opts.serverOnly) {
      info.hidden = true;
      const cards = serverSeaCards();
      if (!cards.length) group('sea-none', '共有中の海', 'まだ無い。サーバーにログインすると、入れる海がここに並ぶ。');
      paintServerCards(cards);
      paintServerShare();
      paintReceive();
      return;
    }
    const net = netSel.value;
    const pk = prfSupported();
    if (!cfg.mode && !setup) {
      /* 共有の面（hub）は、鍵の選び方をその場で出す（2026-11-16 Issue #74 の A 案の (a)。
         前は「先に『ブロックチェーンを準備する』で…」と出して下の箱へ飛ばし、鍵を作ったら自分で上の箱へ戻る必要があった） */
      if (ALLOWED.includes('share') && opts.part === 'hub') { paintHubStart(net, pk); return; }
      /* ほかの欄（バックアップ・自分あてのメモなど）は、鍵の箱へ移るボタンだけ（Issue #45） */
      info.textContent = 'ブロックチェーンをまだ始めていない。先に「' + PREP_NAME + '」で鍵（パスキーか合言葉）を選ぶ。';
      if (ALLOWED.includes('share')) flowBox(true);
      if (opts.goSetup) {
        group('go-setup', '始める', null);
        btn('「' + PREP_NAME + '」を開く', async () => opts.goSetup(null));
      }
      /* 鍵を失ったときの読むだけの復元は、バックアップの欄からも出す（始めていなくても使える） */
      if (ALLOWED.includes('backup')) {
        group('code', '復元コードで読む', 'パスキー・合言葉を失ったときに、バックアップを読むだけ（お金は動かせず、新しく保存もできない）。');
        btn('復元コードで復元（読むだけ）', restoreByCode);
      }
      return;
    }
    if (!cfg.mode) { paintStart(net, pk); return; }
    paintStarted(net, pk);
  }

  /* 共有の面（hub）の、ブロックチェーンを始める前の姿（2026-11-16 Issue #74 の A 案）。
     上から サーバーの海のカード → ＋ 海を共有する（サーバーで）→ ブロックチェーンで共有する：鍵を選ぶ → 招待コードを受け取る → 畳んだ共有の流れ。
     鍵を選ぶと start()／paint() で、この面がそのまま共有の面（paintShare）になる */
  function paintHubStart(net, pk) {
    paintServerCards(serverSeaCards());
    paintServerShare();
    group('chain-start', 'ブロックチェーンで共有する：鍵を選ぶ',
      'ブロックチェーンで海を共有する・招待コード（BTI1-…）を受け取るには、先に鍵（パスキーか合言葉）を選ぶ。'
      + '選ぶとウォレットができ、この面がそのまま共有の面になる。招く人と招かれる人で、ネットをそろえる。'
      + 'あとからウォレットを見る・鍵を替えるのは「' + PREP_NAME + '」。');
    into.appendChild(netRow);
    paintStart(net, pk);
    /* paintStart は info に「まだ始めていない…」を書く。この面では上の見出しが言うので、面のいちばん上には出さない */
    info.textContent = '';
    info.hidden = true;
    paintReceive();
    flowBox(true);
  }

  /* 鍵の選び方（始める前）。準備の箱と、共有の面（paintHubStart）の両方から呼ぶ */
  function paintStart(net, pk) {
    {
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
          /* 押した手応えを先に出す（Issue #53: パスキーの画面が出ないと、押しても反応しないように見えた）。await の前なので押した手の続きのまま */
          line.textContent = 'パスキーの画面を開いている…（出ないときは、この端末・ブラウザでパスキーが使えない。合言葉を使う）';
          const got = await passkeyRoot(null);
          const keys = await keysFromRoot(got.root);
          cfg = Object.assign(loadConfig(), { network: net, mode: 'passkey', credId: got.credId, address: keys.wallet.address });
          saveConfig(cfg);
          paint();
          await restoreWith(keys.recordKey, keys.wallet.address, net);
        });
      }
      group('pass', '合言葉で始める',
        (pk ? '' : 'この端末（ブラウザ）では、鍵を作れるパスキーが使えない。'
          /* Issue #68 の返事「合言葉のみ出てきてパスキーでアドレス作った場合はつかえない？」 */
          + 'ほかの端末でパスキーで作ったウォレットは、ここでは開けない（パスキーが鍵の元なので）。'
          + '同じウォレットを使うなら、パスキーの端末で「鍵を替える」→「新しい鍵へ移し替える」で合言葉へ移し、ここで「合言葉で開く」。'
          + 'この端末だけで使うなら「合言葉で新しく作る」（別のウォレット・別のアドレスになる。共有の海には、この新しいアドレスで招いてもらう）。')
        + 'OS をまたいで複数の端末で使う（iPhone と Windows・Android など、パスキーが引き継がれない組み合わせ）なら、こちら。'
        + '合言葉（24 字）はパスキーの代わりで、ウォレットとバックアップの両方を開く。紙に書き留め、どの端末でも同じ合言葉を打つ。'
        + '漏れるとお金も記録も取られるので、パスキーより扱いに気をつける。'
        + '前にこの app の合言葉を作ったことがあるなら「合言葉で開く」（同じウォレットを開き、いちばん新しいバックアップを戻す）。'
        + '初めてなら「合言葉で新しく作る」（作るたびに別のウォレット・別のバックアップになる）。'
        + 'パスキーで使っていた記録を合言葉へ移すときは、先にパスキーで開き、「鍵を替える」→「新しい鍵へ移し替える」を押す（鍵を作る → 残高を送る → バックアップする、を順に案内する）。');
      /* パスキーと同じく「開く → 新しく作る」の順に並べる（Issue #53。前に作った人が押し間違えないように） */
      btn('合言葉で開く', async () => {
        /* ページの中の欄で聞く（Issue #53: iPhone のホーム画面版で、ブラウザの入力の窓に打てなかった） */
        const pass = await askText('合言葉（24 字）');
        if (!pass) { line.textContent = 'やめた'; return; }
        line.textContent = '鍵を作っている…';
        const keys = await keysFromRoot(await rootFromPassphrase(pass));
        cfg = Object.assign(loadConfig(), { network: net, mode: 'pass', credId: null, address: keys.wallet.address });
        saveConfig(cfg);
        paint();
        await restoreWith(keys.recordKey, keys.wallet.address, net);
      });
      btn('合言葉で新しく作る', async () => {
        const pass = makePassphrase();
        if (!window.confirm('合言葉: ' + pass + '\n\nこれを紙に書き留めてから OK を押す。'
          + '合言葉はウォレットとバックアップの両方を開く（漏れるとお金も記録も取られる）。忘れたら開けない。app はどこにも置かない。')) return;
        line.textContent = '鍵を作っている…';
        await start('pass', await keysFromRoot(await rootFromPassphrase(pass)), null);
      });
      const alt = fold('パスキー・合言葉を失ったとき', false);
      group('code', '復元コードで読む', 'パスキーを失った・このページを開くドメインが変わったときに、バックアップを読むだけ（お金は動かせず、新しく保存もできない）。', alt);
      btn('復元コードで復元（読むだけ）', restoreByCode);
      if (pk) {
        /* 新しく作るのは最後に置く（前に作った人が押し間違えて別のウォレットを作らないように） */
        into = lines.get('start').previousSibling;
        groupKey = 'start';
        btn('パスキーを新しく作る', async () => {
          line.textContent = 'パスキーを作る画面を開いている…（出ないときは、この端末・ブラウザでパスキーが使えない。合言葉を使う）';
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
    }
  }

  /* 始めたあとの姿（やりたいこと・共有の面など） */
  function paintStarted(net, pk) {
    /* ウォレットのアドレスと最後のバックアップは、準備の欄とバックアップの欄にだけ出す（2026-11-15 Issue #68 の返事
       「同期→ブロックチェーンを選んだ後に出るメッセージはここでなくてもいいのでは？下のウォレットのアドレスとか」）。
       共有・同期・チャットの欄では空にする（自分のアドレスが要るときは「招かれる」の「自分のウォレットのアドレスをコピー」） */
    info.textContent = (setup || ALLOWED.includes('backup'))
      ? 'ウォレットのアドレス: ' + cfg.address + '（' + (cfg.mode === 'passkey' ? 'パスキー' : '合言葉') + 'で開く）'
        + (cfg.lastAt ? '。最後に保存したバックアップ: ' + new Date(cfg.lastAt).toLocaleString() + '（取引 ' + cfg.lastCount + ' 件）' : '')
      : '';
    info.hidden = !info.textContent;

    /* 鍵の移し替えの途中なら、いちばん上に段と次のボタンを出す（Issue #39） */
    const mv = currentMove();
    if (mv && setup) paintMove(mv);

    /* やりたいこと（2026-11-11 Issue #43）。前はウォレット・バックアップ・共有・困ったときのボタンを全部並べていた。
       いまは「やりたいこと」のボタンだけを並べ、押したものの操作だけを下に出す。
       残高・手数料が足りないなどの失敗が出たら、知らせの横に「ウォレットを開く」を出す（btn() の offerTask）。
       やりたいことが1つだけの欄（Issue #45）は、ボタンを並べない */
    if (!single) taskBar({ share: sharedFor(loadShared(), cfg.address, net).length });
    if (task === 'wallet') paintWallet(net);
    else if (task === 'key') paintKey(net, mv, pk);
    else if (task === 'backup') paintBackup(net);
    else if (task === 'share') paintShare(net);
    else if (task === 'memo') {
      /* 共有中の海ごとのチャットも、ここに並べる（Issue #68 の返事「チャットは相手をどのように選ぶ？アドレス入れるとことかある？」）。
         相手はアドレスで選ばず、海で選ぶ（その海のメンバー全員と話す）。前は「共有中の海を同期する」の、その海の欄にしか無かった */
      /* opts.selfOnly（2026-11-16 Issue #74）: 「自分の端末どうしで使う」の箱では、自分あてのメモだけを出す
         （共有の海のチャットは「他の人と一緒に使う」のカードの［チャット］） */
      const seas = opts.selfOnly ? [] : sharedFor(dropGoneShared(loadShared()), cfg.address, net);
      if (!seas.length && !opts.selfOnly) {
        group('sea-chat-none', '共有の海のチャット', 'チャットの相手は、アドレスではなく共有の海で選ぶ（その海のメンバー全員と話す）。'
          + 'まだ共有中の海が無い。「海を共有する」で人を招く・招待を受け取ると、ここにその海のチャットが出る。');
      }
      seas.forEach(rec => {
        const ent = allEntries().find(e => e.id === rec.id);
        const who = (rec.members || []).filter(m => m.a !== cfg.address).map(m => m.n || shortAddr(m.a)).join('・');
        /* 海の名前と呼び名はほかのメンバーが書くので、必ず escapeHtml を通す */
        /* 新しいメッセージの数（開いている間の自動の読み込みで履歴に足したもの。Issue #68 の B 案） */
        const unread = chatUnread(rec);
        group('sea:' + rec.id, '「' + escapeHtml(ent ? ent.name : rec.id) + '」のチャット' + (unread ? '（新しい ' + unread + ' 件）' : ''),
          '相手: ' + (who ? escapeHtml(who) : '（まだ自分だけ。メンバーを招くと話せる）') + '。メンバーだけが読める。1 件ごとに手数料が掛かる。');
        btn('チャットを開く', async () => peekChat('sea:' + rec.id, rec));
      });
      /* 自分だけが読み書きできる掲示板（同じパスキー・合言葉で開く自分の端末どうし）。段2のチャットの1つ */
      group('self-chat', '自分にメモを送る（端末どうし）',
        '同じパスキーか合言葉で開いた自分の端末どうしで、短いメモを送り合う。自分しか読めない。1 件ごとに手数料が掛かる。');
      btn('メモを開く', async () => peekChat('self-chat', null));
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
    /* opts.only: 'sync'（ほかの端末と同期する。Issue #52 の返事「同期するボタンをつけて明示的に書き出せるように」） */
    if (opts.only === 'sync') {
      group('backup', '自分のほかの端末へ送る',
        '押すと、先にほかの端末の新しい控えがあれば重ね（消さない）、そのうえで今の記録をチェーンに書く（手数料が掛かる）。'
        + 'iPhone と Android のようにパスキーが引き継がれない端末どうしは、両方を同じ合言葉で開く。');
      if (into && into.parentElement) into.parentElement.insertBefore(chainPick.el, into);
      btn('自分のほかの端末へ送る', syncChain);
      return;
    }
    group('backup', opts.only === 'out' ? 'ブロックチェーンに書き出す' : opts.only === 'in' ? 'ブロックチェーンから読み込む' : 'バックアップする','保存すると、いまの記録を縮めて暗号化し、チェーンに書く（手数料が掛かる）。復元は、いまの記録を消さずに重ねる。'
      + '復元コードは、パスキーを失ったときにバックアップを読むためのもの。始めたときに控えていなければ表示して書き留める。');
    /* opts.only: 'out'（書き出すだけ）／'in'（読み込むだけ）。書き出すと読み込むを分けて出す（2026-11-13 Issue #48 の返事） */
    const only = opts.only || '';
    if (only !== 'in' && into && into.parentElement) into.parentElement.insertBefore(chainPick.el, into);
    if (only !== 'in') btn('バックアップを保存', writeBackup);
    if (only !== 'out') btn('バックアップから復元', async () => {
      const keys = await unlock();
      await checkSame(keys);
      await restoreWith(keys.recordKey, cfg.address, net);
    });
    if (only === 'in') btn('復元コードで復元（読むだけ）', restoreByCode);
    if (only !== 'in') btn('復元コードを表示', async () => {
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
  /* 消した海の共有の控えを、この端末から外す（Issue #68 の返事「海を消しても共有中の海が消えない」）。
     海の一覧に消した印（alive 0）が残っている海だけを外す（一覧にまだ無い海は、受け取りの途中かもしれないので残す）。
     チェーンの上の記録とほかのメンバーには触らない（「この端末で共有をやめる」と同じ） */
  /* 招かれた海をこの端末の一覧に足す。前に消した海（消した印が残る）は、印のほうが新しいので重ねるだけでは戻らない。
     そのときは同じ ID で作り直す（Issue #68。消した海の招待を受け取り直したとき） */
  function addInvitedSea(sea) {
    const e = allEntries().find(x => x.id === sea.id);
    if (e && !e.alive) { addSea(sea.name, sea.color, Date.now(), undefined, sea.id); return; }
    mergeSeas([sea]);
  }
  function dropGoneShared(shared) {
    const entries = allEntries();
    let changed = false;
    Object.keys(shared).forEach(id => {
      const e = entries.find(x => x.id === id);
      if (e && !e.alive) { delete shared[id]; changed = true; }
    });
    if (changed) { try { saveShared(shared); } catch (e) { /* 書けなくても画面からは外す */ } }
    return shared;
  }
  function paintShare(net) {
    /* 招く側と招かれる側でまとまりを分け、番号の順に押せばよいようにした（2026-11-11 Issue #37 の返事:
       「このアドレスを相手に渡せばいい？」「相手はどのボタンで取り込むの？」。アドレスが向かう向き＝招かれる人 → 招く人、が分かりにくかった） */
    /* 名前と操作を易しくした（2026-11-11 Issue #37 の返事:「名前と操作が難しい」「海の選択を文字でなくタップで」）。
       - 「共有用のアドレス」→「受け取りID」（ウォレットのアドレスと取り違えないよう、別の言葉にした）
       - 海は番号を打たず、海の名前のボタンをタップして選ぶ。招く相手の受け取りIDは、海の行の入力欄に貼る
       - 「保存／読み込む」→「自分の変更を送る／みんなの変更を取り込む」。外す・やめるは畳んでおく */
    /* 2026-11-15 Issue #68「招くが先じゃない？」「相手の公開アドレス入れるの？」: 流れを先に1か所で示し、
       招く側（海を選ぶ・新しく作る）を上、招かれる側を下に並べ替えた。相手に入れてもらうのはウォレットのアドレスではなく受け取りID */
    const shared = dropGoneShared(loadShared());
    /* opts.part（Issue #68 の返事「他の人と一緒に使うに、新規で海を共有する、チャットする、同期するって並べるのは不自然？」）:
       'invite' = 共有の流れ・招く・招かれる、'sync' = 共有中の海（送る・取り込む・チャット・人を外す）。無ければ両方 */
    const part = opts.part || '';
    if (part === 'sync') { paintSharedSeas(net, shared, false); return; }
    /* 'hub'（2026-11-16 Issue #68 の返事「設定のUIの配置やナビや説明文などを改良できる？」→ A 案「おすすめで」）:
       共有中の海のカードを先に、その下に［＋ 海を共有する］と［招待コードを受け取る］、いちばん下に畳んだ説明と自分あてのメモ */
    const hub = part === 'hub';
    if (hub) {
      /* サーバーで合わせる海もカードで並べる（Issue #68 の X 案。サーバーあり版だけ） */
      const srvSeas = serverSeaCards();
      paintSharedSeas(net, shared, true, true, srvSeas.length > 0);
      paintServerCards(srvSeas);
      /* サーバーで共有する道（サーバーあり版。Issue #74 の A 案の (c)）。ブロックチェーンで招く欄の前に置き、どちらで共有するかを見出しで分ける */
      paintServerShare();
    } else flowBox(!sharedFor(shared, cfg.address, net).length);
    /* 前の版の「共有」（ID が share）は、どの端末でも同じ ID なので、ほかの人の同じ海とまざる。共有させない */
    const cands = seaList().filter(e => e.id !== 'share' && !shared[e.id]);
    group('share', hub ? (opts.serverShare ? '＋ 海を共有する（ブロックチェーンで。押したとき・手数料あり）' : '＋ 海を共有する（人を招く）') : '招く（自分の海に人を招く）',
      '① 海を選ぶ（共有中の海・まだ共有していない海・「＋ 新しい海」・個人の海を「写して共有」）。② 下の欄で招待コードを作り、相手にだけ送る。'
      + '中身はメンバーだけが読める。誰と誰が同じ海にいるかと、書いた時刻・大きさはチェーンの上で誰でも見られる。書いたものは消せない。');
    /* 招待コードの欄は、共有中の海ごとの欄ではなく、この「招く」の流れの中に置く（Issue #68 の返事
       「共有中の海に…招待コードを作るが表示されてる。他の人と一緒に使うの設定の流れで出てきた方がわかりやすい？」）。
       ① で海を選び、② で招く。自分が持ち主の共有中の海も ① に並べる */
    const ownedSeas = sharedFor(shared, cfg.address, net).filter(r => r.owner === cfg.address);
    if (!ownedSeas.some(r => r.id === inviteSel)) inviteSel = ownedSeas.length === 1 ? ownedSeas[0].id : null;
    ownedSeas.forEach(r => {
      const ent = allEntries().find(e => e.id === r.id);
      /* group・btn の字は HTML として入る。海の名前は必ず escapeHtml を通す */
      const on = inviteSel === r.id;
      const b = btn((on ? '✓ ' : '') + '「' + escapeHtml(ent ? ent.name : r.id) + '」（共有中）', async () => { inviteSel = r.id; paint(); curKey = 'share'; });
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    cands.forEach(sea => btn('「' + escapeHtml(sea.name) + '」を共有', () => shareSea(sea)));
    /* 設定の画面で海の作り方を探していた（2026-11-11 Issue #37 の返事）。引き出しと同じ「海をつくる」板をここからも開き、
       作ったらそのまま共有へ進む（その海へは切り替えない） */
    btn('＋ 新しい海', async () => { makeSeaThenShare(); });
    /* 個人の海と前の版の「共有」は、そのままでは共有できない（個人は自分の端末どうしの海、「共有」はどの端末でも同じ ID）。
       前は黙って外していたので「新しい海しか出てこない」と見えた（2026-11-15 Issue #68 の返事）。
       中身を新しい海へ写してから、その新しい海を共有する選択肢として出す（元の海はそのまま残る）。
       「個人の海は新規と『写して共有』の2つに」（同日の返事）: 「＋ 新しい海」（空から）のすぐ後ろに並べ、2 つから選ぶ形にした */
    const copyFrom = allSeas().filter(s => s.personal || (s.id === 'share' && !shared.share));
    copyFrom.forEach(s => btn('「' + escapeHtml(s.name) + '」を写して共有', () => copyThenShare(s)));

    /* ② 選んだ海に招く（招待コード。Issue #68 の返事「おすすめで」）。作って相手に送るだけ。相手の受け取りIDは要らない。
       相手のウォレットのアドレスを先にもらっていれば、同じ押しで名簿に足し、手数料も送れる（同日の返事「送れるようにして」
       「最初に招く相手のアドレスをもらっていれば、登録まで一回でいける？」）。空なら、相手が記録を送ってから足す */
    const selRec = ownedSeas.find(r => r.id === inviteSel);
    if (selRec) {
      const ent = allEntries().find(e => e.id === selRec.id);
      group('share-code', '②「' + escapeHtml(ent ? ent.name : selRec.id) + '」に招く', null);
      const addrIn = document.createElement('input');
      addrIn.type = 'text';
      addrIn.autocomplete = 'off';
      addrIn.spellcheck = false;
      addrIn.placeholder = '相手のウォレットのアドレス（あれば。すぐメンバーにする）';
      addrIn.setAttribute('aria-label', '招く相手のウォレットのアドレス');
      addrIn.style.cssText = 'flex:1 1 16em;min-width:12em';
      const nameIn = document.createElement('input');
      nameIn.type = 'text';
      nameIn.autocomplete = 'off';
      nameIn.maxLength = 24;
      nameIn.placeholder = '呼び名（空でもよい）';
      nameIn.setAttribute('aria-label', '招く相手の呼び名');
      nameIn.style.cssText = 'flex:0 1 9em;min-width:6em';
      /* 手数料はアドレスがあるときだけ送れる。アドレスが空の間はチェックを押せなくする
         （同日の返事「アドレス入れずに手数料送るチェック入れたままだとどうなる？」: 前は黙って送らなかった） */
      const giftLab = el('label', 'note');
      const giftChk = document.createElement('input');
      giftChk.type = 'checkbox';
      giftChk.checked = true;
      giftLab.appendChild(giftChk);
      giftLab.appendChild(document.createTextNode(' 手数料も送る（約' + GIFT_MESSAGES + '通ぶん）'));
      const giftNow = () => {
        const has = !!addrIn.value.trim();
        giftChk.disabled = !has;
        giftLab.style.opacity = has ? '' : '.5';
        giftLab.title = has ? '' : '相手のアドレスを入れると選べる（アドレスが無いと送り先が分からない）';
      };
      addrIn.addEventListener('input', giftNow);
      giftNow();
      into.appendChild(addrIn);
      into.appendChild(nameIn);
      into.appendChild(giftLab);
      /* 今の自分の記録も同じ押しで送る（Issue #68 の返事「招待コードを送るとTODOの書き出しの2回しないと、招待された側にTODOが表示されない。
         招待コード送る時にTODO書き出してもいい？」）。受け取った人は、受け取ってすぐ持ち主の記録が見える */
      const snapLab = el('label', 'note');
      const snapChk = document.createElement('input');
      snapChk.type = 'checkbox';
      snapChk.checked = true;
      snapLab.appendChild(snapChk);
      snapLab.appendChild(document.createTextNode(' 今の自分の記録も送る（受け取った人がすぐ見られる）'));
      into.appendChild(snapLab);
      btn('🔑 招待コードを作る', () => createInvite(selRec.id, addrIn.value, nameIn.value, giftChk.checked && !giftChk.disabled, snapChk.checked));
      /* アドレスを入れずにコードを送ったあとで、相手のアドレスをもらったとき（Issue #68 の返事「相手のウォレットを空にして招待を送ったあと、
         相手のウォレット情報をどこから入れれる？」）。コードは作らず、同じ欄のアドレスで名簿に足し、手数料も送る */
      btn('🔑 アドレスでメンバーに足すだけ（コードを送ったあと）', () => addByAddress(selRec.id, addrIn.value, nameIn.value, giftChk.checked && !giftChk.disabled));
      /* 作ったコードは、説明の文に埋めず、ここに字とコピーのボタンで出す（Issue #68 の返事「コードコピーできるボタンあれば便利？」） */
      if (lastCode && lastCode.id === selRec.id) {
        const codeRow = el('div', 'row');
        codeRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center;width:100%';
        const codeTx = el('code', null, lastCode.code);
        codeTx.style.cssText = 'font-size:1.05em;padding:4px 8px;border:1px solid rgba(127,127,127,.45);border-radius:6px;user-select:all;word-break:break-all';
        codeTx.setAttribute('aria-label', '作った招待コード');
        codeRow.appendChild(el('span', 'note', '作った招待コード:'));
        codeRow.appendChild(codeTx);
        into.appendChild(codeRow);
        const keepCode = into;
        into = codeRow;
        const code = lastCode.code;
        btn('招待コードをコピー', async () => {
          try { await navigator.clipboard.writeText(code); line.textContent = '招待コードをコピーした。相手にだけ送る。'; } catch (e) {
            line.textContent = 'コピーできなかった。コードの字を長押しして選んで写す。';
          }
        });
        into = keepCode;
      }
      const open =(selRec.invites || []).filter(i => !i.used && i.exp > Date.now()).length;
      /* コードそのものは端末に残さない（合言葉と同じ秘密なので）。画面を閉じると見直せないことを添える（Issue #68 の返事
         「使われていない招待コード 1 件となり、タブを閉じると招待コードは読めなくなる？」） */
      if (open) into.appendChild(el('span', 'note', 'まだ誰も使っていない招待コード ' + open + ' 件（' + INVITE_DAYS + ' 日のうちは、送ったコードで受け取れる。'
        + 'コードはこの画面を開いている間だけ上に出る。閉じたあとは見直せないので、送り忘れたら作り直す）'));
    }

    /* 招かれる側。招く側のすぐ下に置く（Issue #68 の返事「招かれるが下の方にある。招く招かれるで近くにあった方がわかりやすくない？」。
       前は共有中の海の欄のさらに下だった） */
    paintReceive();

    if (hub) {
      /* 読むだけの説明は畳んで下に（Issue #68 の A 案）。
         自分にメモを送る（自分の端末どうし）は、2026-11-16 Issue #74 で「自分の端末どうしで使う」の箱へ移した */
      flowBox(false);
      group('share-keys', '🔑 の付いたボタン', '🔑 の付いたボタンは、パスキーか合言葉を求める（書く・招く・受け取る）。'
        + '読むだけ（チャットを読む・自動の読み込み）は求めない。「同期」で 1 度開けると、ページを閉じるまで求めない。');
      return;
    }
    if (part === 'invite') return;
    paintSharedSeas(net, shared, true);
  }

  /* 共有中の海（送る・取り込む・チャット・手数料・人を外す）。linkInvite = 同じ欄に「招く」があるとき（そこへ移るボタンを出す）。
     「共有中の海を同期する」の欄（opts.part === 'sync'）では「招く」が別の欄なので出さない（Issue #68 の返事） */
  /* card: 共有の海の面（Issue #68 の A 案）のカードの形。今の様子（立場・最後の同期・直のつながり・新しいチャット）を 1 行で出し、
     ボタンは［同期］［チャット］［人を招く］だけ。手数料・外す・やめるは畳む */
  /* 招待コードを受け取る（2026-11-16 Issue #74 の A 案の (d)）。欄を 1 つにし、貼ったコードの形で振り分ける。
     BTI1-… はブロックチェーンの招待（acceptCode）、ABCD-EFGH-JKLM の形はサーバーのパスキーの招待（opts.serverInvite が
     設定の「海」のログインの「招待コード」の欄へ入れる。js/screens/seapanel.js の fillInvite）。前はサーバーの招待コードを受け取る欄が海の ⚙ の中にしか無く、
     同じ「招待コード」の名前でこちらに貼ると形が合わずに失敗した */
  function paintReceive() {
    const srvOnly = !!opts.serverOnly;   /* サーバーあり版（Issue #78）: サーバーの招待コードだけ */
    const started = !srvOnly && !!cfg.mode;
    const srv = typeof opts.serverInvite === 'function';
    group('share-in', opts.part === 'hub' ? '招待コードを受け取る' : '招かれる（招待を受ける）',
      srvOnly
        ? '届いたサーバーの招待コード（ABCD-EFGH-JKLM の形）を貼って「受け取る」。設定の「海」のログインの［招待コードで登録］の欄へ入れる。'
        : '届いた招待コードを貼って「受け取る」。'
      + 'ブロックチェーンの招待コード（BTI1-…）なら、海が自動で足される（受け取るだけなら手数料なし。先に鍵を選んでおく）。'
      + (srv ? 'サーバーの招待コード（ABCD-EFGH-JKLM の形）なら、設定の「海」のログインの［招待コードで登録］の欄へ入れる。' : '')
      + (started ? '先に自分のアドレスを招く人に送っておくと、受け取ってすぐメンバーになり、手数料も送ってもらえる。'
        + '送っていなければ、「同期」で記録を送ったときに招いた人の端末がメンバーに足す（送るには SOL が要る）。' : ''));
    const codeIn = document.createElement('input');
    codeIn.type = 'text';
    codeIn.autocomplete = 'off';
    codeIn.spellcheck = false;
    codeIn.placeholder = srvOnly ? '招待コード（ABCD-EFGH-JKLM）を貼る' : srv ? '招待コード（BTI1-… か ABCD-EFGH-JKLM）を貼る' : '招待コード（BTI1-…）を貼る';
    codeIn.setAttribute('aria-label', '招待コード');
    codeIn.style.cssText = 'flex:1 1 16em;min-width:12em';
    into.appendChild(codeIn);
    /* パスキーは押した手の続きで呼ぶので、acceptCode の前で await しない */
    btn(started ? '🔑 受け取る' : '受け取る', async () => {
      const v = codeIn.value;
      const kind = inviteKind(v);
      if (kind === 'chain' && srvOnly) {
        throw new Error('ブロックチェーンの招待コード（BTI1-…）。サーバーあり版では受け取れない。サーバーなし版（noserver.html）で受け取る。');
      }
      if (kind === 'chain') {
        if (!cfg.mode) throw new Error('ブロックチェーンの招待コード。先に上の「ブロックチェーンで共有する：鍵を選ぶ」で鍵を選ぶ（招いた人と同じネット）。');
        return acceptCode(v);
      }
      if (kind === 'server') {
        if (srv) { line.textContent = opts.serverInvite(v.trim()); return; }
        throw new Error(isSolo()
          ? 'サーバーの招待コードの形。このページはサーバーに繋がない版なので、設定の「海」のいちばん下の「サーバーに繋ぐページを開く」から、サーバーに繋ぐページで入れる。'
          : 'サーバーの招待コードの形。設定の「海」の［サーバーにログイン］→［招待コードで登録］に入れる。');
      }
      throw new Error(String(v || '').trim() ? '招待コードの形ではない（ブロックチェーンは BTI1-…、サーバーは ABCD-EFGH-JKLM の形）。' : '招待コードを貼る。');
    });
    if (!started) return;
    /* 先に自分のアドレスを招く人に送っておくと、受け取ってすぐメンバーになり、手数料も送ってもらえる（Issue #68 の返事） */
    btn('自分のウォレットのアドレスをコピー（先に招く人へ）', async () => {
      const tail = '　← 招く人に送ると、招待コードと同時にメンバーに足され、手数料も送ってもらえる（送らなくても受け取れる）。';
      try { await navigator.clipboard.writeText(cfg.address); line.textContent = 'アドレスをコピーした: ' + cfg.address + tail; } catch (e) {
        line.textContent = 'アドレス: ' + cfg.address + tail;
      }
    });
    /* 鍵を作り替えたとき（人を外したとき）の新しい鍵は、前と同じく受け取りIDあての封筒で届くので、この受け取りは残す。
       前の形の「受け取りIDをコピー」は外した（Issue #68 の返事「前の形 使わないので消せる？」） */
    btn('🔑 届いた招待を受け取る（鍵が作り替えられたとき）', acceptInvites);
  }
  /* ＋ 海を共有する（サーバーで）。サーバーあり版だけ（opts.serverShare = 設定の「海」を開く。ログインしていなければログインの欄）。
     2026-11-16 Issue #74 の A 案の (c): 前は面の下の畳んだ箱に置き、上のカードと 2 か所に出ていた。
     2026-11-17 kura の main との統合で、作り直した海（招待コードはログインした人が海の ⚙ の［人を招く］で作る）に合わせて文を直した。
     サーバーへの通信・鍵の扱いは変えていない（案内と、前からある「海」を開くボタンだけ） */
  function paintServerShare() {
    if (typeof opts.serverShare !== 'function') return;
    group('srv-share', '＋ 海を共有する（サーバーで。自動・手数料なし）',
      'サーバーの海は、招いた人の端末とも同じ海になる（自動で合う。手数料は掛からない）。'
      + '<b>招く人</b>: サーバーにログインし、設定の「海」で共有するサーバーの海の ⚙ →［人を招く］で招待コードを作り、相手にこのページの住所とコードを渡す（24 時間・1回だけ）。'
      + 'この端末だけの海をサーバーに置くのは、サーバーの管理者が VM で行う。'
      + '<b>招かれる人</b>: 下の「招待コードを受け取る」に貼る（設定の「海」の［招待コードで登録］へ入る）。');
    btn('設定の「海」を開く', async () => opts.serverShare());
  }
  /* サーバーで合わせる海（サーバーあり版だけ。個人の海は除く）→ [{ sea, region }]（2026-11-16 Issue #68 の X 案） */
  function serverSeaCards() {
    if (isSolo()) return [];
    const srvs = serverRegions();
    if (!srvs.length) return [];
    return allSeas().filter(s => !s.personal).map(s => ({ sea: s, region: srvs.find(r => r.id === s.rid) })).filter(x => x.region);
  }
  /* サーバーの海のカード。今の様子（サーバー「名前」で自動で合う・合わせた時刻・新しいチャット）と［チャット］／［この海を開く］・［人を招く］ */
  function paintServerCards(list) {
    list.forEach(({ sea, region }) => {
      const here = sea.id === store.space();
      const st = here ? sync.status() : null;
      const unread = serverChatUnread(sea.id);
      /* 海の名前とサーバーの名前は文字として入れる（見出しの字は HTML として入るので escapeHtml） */
      group('srv:' + sea.id, '「' + escapeHtml(sea.name) + '」（サーバー）', null);
      const stLine = el('div', 'note');
      stLine.style.cssText = 'width:100%';
      stLine.textContent = 'サーバー「' + (region.name || '') + '」で自動で合う'
        + (here ? (st && st.state === 'ok' && st.at ? '・合わせた ' + new Date(st.at).toLocaleString() : '・開いている海') : '・開くと合う')
        + (unread ? '・新しいチャット ' + unread + ' 件' : '');
      /* 2026-11-16 Issue #74 で海の ID をここに出したが、作り直した海では招待コードが海を運ぶので、相手に ID を伝えなくてよい。2026-11-17 の統合で外した */
      into.appendChild(stLine);
      if (here) {
        btn('チャット' + (unread ? '（新しい ' + unread + ' 件）' : ''), async () => {
          try { window.dispatchEvent(new CustomEvent('bubbles:open-server-chat')); } catch (e) { /* 進む */ }
        });
      } else {
        /* サーバーのチャットは開いている海のものだけ出せるので、その海へ移ってから見る */
        btn('この海を開く' + (unread ? '（新しいチャット ' + unread + ' 件）' : ''), async () => {
          try { store.flush(); } catch (e) { /* 移るのは止めない */ }
          try { localStorage.setItem(SPACE_KEY, sea.id); } catch (e) { throw new Error('切り替えを覚えられなかった'); }
          location.reload();
        });
      }
      btn('人を招く（サーバーの設定）', async () => {
        try { window.dispatchEvent(new CustomEvent('bubbles:open-server-settings')); } catch (e) { /* 進む */ }
      });
    });
  }
  function paintSharedSeas(net, shared, linkInvite, card, quietEmpty) {
    const mine = sharedFor(shared, cfg.address, net);
    if (!mine.length && quietEmpty) return;
    if (!mine.length && (card || !linkInvite)) {
      group('sea-none', '共有中の海', card ? 'まだ無い。下の［＋ 海を共有する］で人を招くか、［招待コードを受け取る］から始める。'
        : 'まだ無い。「海を共有する」で招く・招待を受け取ると、ここに出る。');
      return;
    }
    mine.forEach(rec => {
      const ent = allEntries().find(e => e.id === rec.id);
      const name = ent ? ent.name : rec.id;
      const owner = rec.owner === cfg.address;
      const member = owner || (rec.members || []).some(m => m.a === cfg.address);
      const who = (rec.members || []).map(m => (m.a === cfg.address ? '自分' : (m.n || shortAddr(m.a)))).join('・');
      const last = Math.max(Number(rec.savedAt) || 0, Number(rec.readAt) || 0);
      const m0 = meshes.get(rec.id);
      const direct = directCount(rec.id);   /* チャットの線でつながっているときも数える（Issue #68） */
      const unread = chatUnread(rec);
      /* group の見出しと説明は HTML として入る。海の名前と呼び名はほかのメンバーが書くので、必ず escapeHtml を通す */
      const desc = card
        ? (owner ? '持ち主' : member ? 'メンバー' : '読むだけ（「同期」で記録を送るとメンバーになる）')
          + '・メンバー ' + ((rec.members || []).length || '?') + ' 人' + (who ? '（' + escapeHtml(who) + '）' : '')
          + '・最後の同期 ' + (last ? new Date(last).toLocaleString() : 'まだ')
          + (direct ? '・直につながっている ' + direct + ' 台' : '')
          + (unread ? '・新しいチャット ' + unread + ' 件' : '')
        : 'メンバー ' + ((rec.members || []).length || '?') + ' 人' + (who ? '（' + escapeHtml(who) + '）' : '')
          + (rec.savedAt ? '・最後に送った ' + new Date(rec.savedAt).toLocaleString() : '')
          + (rec.readAt ? '・最後に取り込んだ ' + new Date(rec.readAt).toLocaleString() : '');
      group('sea:' + rec.id, (card ? '「' + escapeHtml(name) + '」' : '共有中の海「' + escapeHtml(name) + '」' + (owner ? '' : '（招かれた）')), desc);
      if (card) {
        /* 説明は ⓘ に畳まれるので、今の様子はボタンの上に 1 行で見せる（文字として入れる） */
        const st = el('div', 'note');
        st.style.cssText = 'width:100%';
        st.textContent = (owner ? '持ち主' : member ? 'メンバー' : '読むだけ') + '・最後の同期 ' + (last ? new Date(last).toLocaleString() : 'まだ')
          + (direct ? '・直につながっている ' + direct + ' 台' : '') + (unread ? '・新しいチャット ' + unread + ' 件' : '');
        into.appendChild(st);
        /* 直の通信の様子（Issue #68 の返事「webRTC動いてないように見える。確認できる？」）。つながらない理由が分かるように 1 行で出す */
        const p2 = el('div', 'note');
        p2.style.cssText = 'width:100%';
        const prefs = loadP2pPrefs();
        p2.textContent = '直の通信: ' + (!prefs.on ? '切ってある（チャットの欄の「端末どうしで直につなぐ」）'
          : !p2pSupported() ? 'このブラウザでは使えない'
          : !sessionKeys ? 'まだ（この海で「同期」すると始まる。ページを読み直すと止まる）'
          : !member ? '読むだけの間は、ほかの人から見つけてもらえない（メンバーになると始まる）'
          : direct ? 'つながっている ' + direct + ' 台（ひとことは手数料なしで届く）'
          : m0 ? 'つなぐ相手を待っている（相手もこの 10 分のうちに新しい書き込みを「同期」すると、つなぎに行く）'
          : 'これから始める（次の自動の読み込みで）')
          + (m0 && m0.lastError ? '・前の失敗: ' + m0.lastError : '');
        into.appendChild(p2);
      }
      /* 同期する（Issue #68 の返事「送るの近くに同期ボタン作れる？読み込みと新規書込みがあれば書込みも」）。取り込み＋新しい書き込みがあれば送る */
      /* 「自分の変更を送る」「みんなの変更を取り込む」は外し、同期だけにした（同日の返事「設定の所も同期でまとめて自分の書き込みと読み込みの2つ消した方がわかりやすい？」） */
      /* 直につながっていれば、盤と同じく「⇄台数」を付ける（Issue #68 の返事「設定画面でも同期1みたいな表示でる？」） */
      btn(card ? '🔑 同期' + (direct ? ' ⇄' + direct : '') : '同期する（取り込み・新しい書き込みがあれば送る）', () => syncShared1(rec.id));
      btn('チャット' + (card && unread ? '（新しい ' + unread + ' 件）' : ''), async () => peekChat('sea:' + rec.id, rec));
      if (owner && linkInvite) {
        /* 招待コードの欄は上の「招く」の ② へ移した（Issue #68 の返事）。ここからはその海を選んで移る */
        btn(card ? '人を招く' : 'この海に人を招く（上の「招く」へ）', async () => { inviteSel = rec.id; paint(); curKey = 'share-code'; });
        /* 前の形（受け取りIDで招く）は外した（Issue #68 の返事「前の形 使わないので消せる？」） */
      }
      /* ふだんは使わないものは畳む（カードでは手数料もここへ） */
      const more = document.createElement('details');
      more.style.cssText = 'margin-top:6px;width:100%';
      more.appendChild(el('summary', null, (card ? '手数料を送る・' : '') + (owner ? '人を外す・共有をやめる' : '共有をやめる')));
      if (!card) {
        /* 新しいメンバーへ手数料を送る（2026-11-11 Issue #37 の返事）。招かれた人は、受け取る（招待を探す・取り込む）だけなら手数料は要らないが、
           自分の変更を送る・チャットには SOL が要る。始めの一歩を持ち主などが肩代わりできるように */
        (rec.members || []).filter(m => m.a !== cfg.address).forEach(m => {
          btn('手数料を送る: ' + escapeHtml(m.n || shortAddr(m.a)) + '（約' + GIFT_MESSAGES + '通ぶん）', () => giftTo(rec, m));
        });
      }
      const moreRow = el('div', 'row');
      moreRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center';
      more.appendChild(moreRow);
      into.appendChild(more);
      const keep = into;
      into = moreRow;
      if (card) {
        (rec.members || []).filter(m => m.a !== cfg.address).forEach(m => {
          btn('🔑 手数料を送る: ' + escapeHtml(m.n || shortAddr(m.a)) + '（約' + GIFT_MESSAGES + '通ぶん）', () => giftTo(rec, m));
        });
      }
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
    if (chat.mesh) {
      chatOpenSea = null;   /* 直の通信（C1）を、裏の網へ戻す */
      chatLink = null;
      /* 裏の網ですぐつなぎ直しに行く（チャットの「ここにいる」は 10 分有効なので、相手もまだ開いていれば見つかる） */
      setTimeout(() => { watchAll(); }, 1000);
    }
    chat = null;
  }
  /* 鍵を開けずに、この端末に届いている履歴だけを読む（Issue #68 の返事「チャットを開く時に、合言葉とパスキーが求められるけど、送る時だけでいいのでは？
     すでにあるやつはよめてもいいのでは？」）。履歴はもともと端末に置いている（js/p2p.js の loadHistory）ので、鍵の扱いは変わらない。
     新しいもの（チェーンにあって、まだこの端末に無いもの）を読む・送る・直につなぐときだけ「開いて送る」で鍵を開ける（openChat） */
  function peekChat(gkey, rec) {
    closeChat();
    const anchor = lines.get(gkey);
    if (!anchor) throw new Error('チャットを開けなかった（画面を開き直す）');
    const room = rec ? 'sea:' + rec.id + ':' + rec.gen : 'self:' + cfg.address;
    const members = rec ? ((loadShared()[rec.id] || rec).members || []) : [];
    const nameOf = a => (a === cfg.address ? '自分' : ((members.find(m => m.a === a) || {}).n || shortAddr(a)));
    const panel = el('div', null);
    panel.style.cssText = 'margin-top:6px;padding:8px;border:1px solid rgba(127,127,127,.35);border-radius:8px';
    const list = el('div', null);
    list.setAttribute('role', 'log');
    list.style.cssText = 'max-height:16em;overflow:auto;display:flex;flex-direction:column;gap:4px';
    const draw = () => {
      const hist = loadHistory(room);
      list.textContent = '';
      if (!hist.length) list.appendChild(el('p', 'note', 'まだメッセージが無い。'));
      hist.slice(-100).forEach(m => {
        const item = el('div', null);
        const head = el('span', 'note');
        /* 呼び名・本文はほかの人が書くので文字として入れる */
        head.textContent = nameOf(m.by) + '・' + new Date(m.at).toLocaleString() + (m.state === 'unsent' ? '（未送）' : '') + '　';
        const body = el('span', null);
        body.textContent = m.text;
        item.appendChild(head);
        item.appendChild(body);
        list.appendChild(item);
      });
      list.scrollTop = list.scrollHeight;
    };
    draw();
    panel.appendChild(list);
    /* 読むための鍵があれば、鍵を求めずにチェーンの新しいメッセージも読んで足す（Issue #68 の A 案） */
    const canRead = !!(rec && readBoardsOf(rec) && readBoardsOf(rec).chat);
    panel.appendChild(el('p', 'note', canRead
      ? '新しいメッセージも、鍵なしで読んで出す。送るときはパスキーか合言葉を求める（ページを閉じるまで 1 度だけ）。'
      : 'この端末に届いている分だけを、鍵なしで表示している。送ると、パスキーか合言葉を求め、新しいメッセージも読む。'));
    if (rec) markChatSeen(room, true);
    if (canRead) {
      watchOne(sharedRec(rec.id)).then(() => { if (chat && chat.panel === panel) { draw(); markChatSeen(room, true); } }, () => { /* 読めなくても履歴は出ている */ });
    }
    /* 送る欄は最初から出す（Issue #68 の返事「チャットメッセージを送る画面が表示されない」）。
       送るを押すと、その押しの続きで鍵を開け（🔑）、開いたチャットからそのまま送る */
    const form2 = el('form', null);
    form2.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center';
    const input2 = document.createElement('input');
    input2.type = 'text';
    input2.maxLength = MSG_MAX;
    input2.autocomplete = 'off';
    input2.placeholder = rec ? 'メッセージ（メンバーだけが読める）' : 'メモ（自分の端末どうしだけが読める）';
    input2.setAttribute('aria-label', rec ? 'メッセージ' : 'メモ');
    input2.style.cssText = 'flex:1 1 14em;min-width:10em';
    const send2 = el('button', 'btn', '🔑 送る');
    send2.type = 'submit';
    const shut = el('button', 'btn', '閉じる');
    shut.type = 'button';
    shut.addEventListener('click', () => closeChat());
    form2.appendChild(input2);
    form2.appendChild(send2);
    form2.appendChild(shut);
    /* 押した手の続きで openChat を呼ぶ（パスキーは押した手の続きでないと断る端末がある） */
    form2.addEventListener('submit', (ev) => {
      ev.preventDefault();
      curKey = gkey;
      openChat(gkey, rec, input2.value).catch(e => { curKey = gkey; line.textContent = (e && e.message) || String(e); });
    });
    panel.appendChild(form2);
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    list.scrollTop = list.scrollHeight;
    chat = { panel, timer: null, mesh: null, gkey };
    /* watchOne の読み込みが返る前に chat を置いたので、上の then で同じ panel かを見られる */
  }
  /* firstText: 読むだけの欄で打ってから送ったメッセージ。開いたらそのまま送る（Issue #68） */
  async function openChat(gkey, rec, firstText) {
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
    status.textContent = '直につながっている相手がいれば直に送る（手数料なし・チェーンに残らない）。いなければ、聞いてからブロックチェーンに書く（手数料あり・相手が後で開いても届く）。'
      + 'メッセージの横の（直）（チェーン）（未送）が、どの道で届いたかを表す。'
      + '直に送ったものの履歴はこの端末にだけ置く（残したいときは「ブロックチェーンにも残す」）。'
      + (rec ? '直につながると、この海の記録も互いに直に送り合って重ねる（手数料なし）。' : '');
    panel.appendChild(status);
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);

    const room = rec ? 'sea:' + rec.id + ':' + rec.gen : 'self:' + keys.wallet.address;
    if (rec) markChatSeen(room, true);   /* 開いたら、新しいメッセージの数を 0 に（Issue #68 の B 案。組み立て中なので面は描き直さない） */
    if (rec) {
      /* チャットを開いている間は、チャットの網で直につなぐ（裏の網 C1 は閉じる。同じ端末の印で 2 つの網がつなぎに行かないように） */
      chatOpenSea = rec.id;
      const bg = meshes.get(rec.id);
      if (bg) { try { bg.mesh.close(); } catch (e) { /* 進む */ } meshes.delete(rec.id); }
      holdSessionKeys(keys);
    }
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
      /* どの道で届いたかを 1 件ずつ出す（Issue #68 の返事「送れているようにみえる。許可なくブロックチェーンに書き込んでる？」） */
      const mark = { unsent: '（未送）', p2p: '（直）', chain: '（チェーン）' };
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
        /* 裏の網と同じく、「つなぎたい」「つなぐ」は同じ相手へ 10 分に 1 度まで（手数料を減らされないように。2026-11-16 の点検） */
        post: (inner) => {
          if (inner.kind === 'offer' || inner.kind === 'answer') {
            /* 裏の網と鍵を分ける（チャットで使った回数で、チャットを閉じたあとの裏の網のつなぎ直しを 10 分止めないように） */
            const k = 'chat|' + sea + '|' + inner.kind + '|' + inner.to;
            if (Date.now() - (offered.get(k) || 0) < HELLO_MS) return Promise.reject(new Error('この相手へは、少し前につなぎに行った'));
            offered.set(k, Date.now());
          }
          return postChain(inner);
        },
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
          /* 名前・色・時刻だけを使う（消した印・同期の先は受け取らない。2026-11-16 の点検の直し漏れ） */
          const entry = memberEntry(inner.entry, rec.id);
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
    let chainOk = false;   /* つながっていないときにチェーンに書いてよいと聞いたか（開いている間だけ） */
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
        /* 書く前に、この開いている間に 1 度だけ聞く（2026-11-16 Issue #68 の返事「許可なくブロックチェーンに書き込んでる？」:
           前は知らせの行に書くだけで聞かなかったので、直に送れたように見えた） */
        if (!chainOk) {
          if (!window.confirm('直につながっている相手がいない。このメッセージをブロックチェーンに書く？（1 件ごとに手数料が掛かる）\n'
            + 'OK にすると、このチャットを開いている間は、つながっていないときに聞かずに書く。\n'
            + 'キャンセルなら未送として端末に残す（相手と直につながったら届く）。')) {
            status.textContent = '書かずに未送として残した（相手と直につながったら届く）。';
            return;
          }
          chainOk = true;
        }
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
    /* 盤のひとことも、このチャットの線で直に送れるようにする（Issue #68） */
    if (rec && mesh && sendSnap) chatLink = { id: rec.id, send: sendSnap, count: () => mesh.openCount() };
    curKey = gkey;
    line.textContent = '';
    render();
    const left = unsentList().length;
    if (left) status.textContent = '前に書けなかった未送が ' + left + ' 件ある。相手とつながれば届く。次に送るとき一緒にブロックチェーンに書く（「ブロックチェーンにも残す」でもよい）。';
    /* 開いただけでは何も書かない（手数料を掛けない）。相手の「ここにいる」（10 分以内のメッセージか呼び出し）があれば、ここで offer を書く */
    await refresh();
    input.focus();
    /* 読むだけの欄で打ってあったメッセージは、開いたらそのまま送る（Issue #68） */
    if (firstText && String(firstText).trim()) {
      input.value = String(firstText);
      if (typeof form.requestSubmit === 'function') form.requestSubmit(send);
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }

  /* メンバーのウォレットへ、メッセージ約 100 通ぶんの SOL を送る（額は js/board.js の giftPlan）。送り先は名簿のアドレスだけ（貼らせない） */
  async function giftTo(rec, m) {
    const keys = await unlock();   /* パスキーは押した手の続きで呼ぶ */
    await checkSame(keys);
    await giftWith(rec.net, keys, m);
  }
  /* 鍵を開けたあとの続き（招待コードを作るのと同じ押しで送るときにも使う。パスキーを 2 度求めないため。Issue #68） */
  async function giftWith(net, keys, m) {
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
    /* 読むための鍵（rk。Issue #68 の A 案）は別に書くので、読み直す前の写しで上書きしても落とさない（同じ代のときだけ） */
    const old = all[rec.id];
    if (old && old.rk && !rec.rk && old.gen === rec.gen) rec = Object.assign({}, rec, { rk: old.rk });
    all[rec.id] = rec;
    saveShared(all);
  }
  /* 鍵を開け（パスキーは押した手の続きで呼ぶ。ここより前で await しない）、海の鍵を出す */
  async function openShared(rec) {
    const keys = await unlock();
    await checkSame(keys);
    const seaKey = await unwrapSeaKey(rec, keys.recordKey);
    /* 開けたついでに、読むための鍵を置く（次からは読むだけなら鍵を求めない。Issue #68 の A 案） */
    if (!readBoardsOf(rec)) await keepReadKeys(rec.id, seaKey, rec.gen);
    /* 直の通信（C1）のため、共有の海の鍵を開けたら、ページを閉じるまでウォレットの鍵をメモリに置く。
       前は「同期」で書いたときだけだったので、新しい書き込みが無くて書かなかった同期・送る・招待では、直の通信が始まらなかった
       （2026-11-16 Issue #68 の返事「TODOのひとことでwebRTC動いてないように見える」） */
    holdSessionKeys(keys);
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
        + 'やめても海はこの端末に残り、あとで「招く」の海の名前をタップすれば共有できる。',
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

  /* 個人の海・前の版の「共有」の中身を新しい海へ写し、その海の共有を始める（2026-11-15 Issue #68 の返事
     「新しい海だけでてきて既存の海を選べない」）。元の海は消さない。
     パスキーは押した手の続きで呼ぶ（iPhone）ので、shareSea の鍵を開けるまで await しない */
  function copyThenShare(s) {
    if (!window.confirm('「' + s.name + '」の記録をすべて写した新しい海を作り、その海を共有する？\n'
      + '「' + s.name + '」はそのまま残る（このあと「' + s.name + '」に足したものは、共有した海には入らない）。\n'
      + '写した記録はすべて、招いた人に見える。')) return;
    let src = null;
    if (s.id === store.space()) { try { store.flush(); } catch (e) { /* 読むのは止めない */ } src = store.exportState(); }
    else { try { src = boxToState(JSON.parse(localStorage.getItem(boxKey(s.id)) || 'null')); } catch (e) { src = null; } }
    if (!src) throw new Error('「' + s.name + '」の記録が読めなかった');
    const name = String(s.name || '').replace(/（.*）$/, '') || '共有';
    const sea = addSea(name, s.color || 'magma', Date.now(), s.rid || undefined);
    if (!sea) throw new Error('海を作れなかった（端末の空きが足りない）');
    try { localStorage.setItem(boxKey(sea.id), JSON.stringify(stateToBox(src))); } catch (e) {
      removeSea(sea.id);
      throw new Error('写せなかった（端末の空きが足りない）');
    }
    window.dispatchEvent(new CustomEvent('bubbles:seas'));
    if (!isSolo()) { try { sync.syncSeas(); } catch (e) { /* 一覧はあとで合わせる */ } }
    curKey = 'share';
    line.textContent = '「' + s.name + '」を写した海「' + sea.name + '」を作った。共有を始める…';
    const left = msg => {
      paint();
      curKey = 'share';
      line.textContent = msg + '（写した海「' + sea.name + '」はこの端末に残っている。上の海の名前をタップすると共有をやり直せる）';
    };
    return shareSea(sea).then(() => { if (!loadShared()[sea.id]) left('やめた'); },
      e => left((e && e.message) || String(e)));
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
      + '続けて、「招く」の ② で招待コードを作る。')) { line.textContent = 'やめた'; return; }
    line.textContent = '書いている…';
    await writeEnvelope(net, keys.wallet, env, to.wallet);
    await writePost(net, keys.wallet, roster, board);
    putShared(rec);
    await keepReadKeys(rec.id, seaKey, rec.gen);
    cfg = Object.assign(loadConfig(), { share: myShare });
    saveConfig(cfg);
    /* 続けて招けるよう、「招く」の ② にこの海を選んで出す（Issue #68 の返事） */
    inviteSel = rec.id;
    paint();
    curKey = 'share-code';
    line.textContent = '共有を始めた。この欄で相手のアドレス（あれば）を入れて「招待コードを作る」。招待コードを作るときに今の記録も送れる（あとからはカードの「同期」）。';
  }

  /* 受け取りIDで招く inviteTo は外した（Issue #68 の返事「前の形 使わないので消せる？」）。招くのは招待コード（createInvite）だけ */

  /* 招待コードを作る（持ち主だけ。Issue #68 の返事「おすすめで」= A 案）。
     コードの受け口に招待を 1 件書き（取引 1 件）、コードを見せてコピーする。コードは端末に残さない（受け口だけを控える） */
  async function createInvite(id, addrRaw, nickRaw, withGift, withSnap) {
    const net = netSel.value;
    const rec = sharedRec(id);
    const addr = String(addrRaw || '').trim();
    const nick = String(nickRaw || '').trim().slice(0, 24);
    /* アドレスの形は鍵を開ける前に確かめてよい（await しないので、押した手の続きのまま） */
    if (addr && !isAddress(addr)) throw new Error('相手のウォレットのアドレスの形が違う（Solana のアドレスを貼る。BTA1- で始まる受け取りIDではない）');
    const { keys, seaKey } = await openShared(rec);
    if (rec.owner !== keys.wallet.address) throw new Error('招待コードを作れるのは海の持ち主だけ');
    if (addr === keys.wallet.address) throw new Error('自分のアドレスが入っている（相手のアドレスを入れる）');
    const already = addr && (rec.members || []).some(m => m.a === addr);
    const code = await makeInviteCode(net);
    const box = await inviteBoxOf((await readInviteCode(code)).secret);
    const sea = allEntries().find(e => e.id === id) || { id, name: id, color: 'magma', at: 0 };
    const now = Date.now();
    const text = await sealInvite({ network: net, sea, key: seaKey, gen: rec.gen, owner: keys.wallet, now }, box);
    /* アドレスがあれば名簿にも足す（受け取りIDはまだ分からないので空。相手が記録を送ると埋まる） */
    const board = await boardOf(seaKey);
    const nextMembers = addr && !already ? cleanMembers((rec.members || []).concat([{ a: addr, x: '', n: nick }])) : null;
    const roster = nextMembers ? await postMemos(keys.wallet, rosterInner(Object.assign({}, rec, { members: nextMembers })), board) : [];
    /* 今の自分の記録も送る（Issue #68 の返事「招待コード送る時にTODO書き出してもいい？」）。saveShared1 と同じ写し */
    const sbox = withSnap ? seaBox(id) : null;
    const snap = sbox ? await postMemos(keys.wallet, { kind: 'snap', sea: id, g: rec.gen, at: Date.now(), entry: sea, box: sbox }, board) : [];
    if (snap.length > MAX_TX) throw new Error('記録が大きすぎる（取引 ' + snap.length + ' 件に分かれる）。「今の自分の記録も送る」を外して作る');
    const count = 1 + roster.length + snap.length;
    const need = await needFunds(net, count);
    const parts = ['招待'].concat(nextMembers ? [(nick || shortAddr(addr)) + ' を足した名簿'] : []).concat(snap.length ? ['今の自分の記録'] : []);
    if (!window.confirm('「' + sea.name + '」の招待コードを作る？（' + NETWORKS[net].label + '）\n'
      + parts.join('と') + 'をチェーンに書く'
      + '（取引 ' + count + ' 件・手数料の目安 ' + solText(need.fee) + '）。\n'
      + 'コードは合言葉と同じで、持っている人は誰でもこの海を読める。相手にだけ送る。\n'
      + (addr ? '相手は受け取ればすぐメンバーとして書ける。' + (withGift ? '続けて手数料を送るかを聞く。' : '')
        : 'メンバーに足すのは、このコードで最初に記録を送った 1 人だけ（' + INVITE_DAYS + ' 日のうち）。'))) { line.textContent = 'やめた'; return; }
    line.textContent = '書いている…';
    await writeInvite(net, keys.wallet, text, box);
    if (roster.length || snap.length) {
      await writePost(net, keys.wallet, roster.concat(snap), board, { onStep: (i, n) => { line.textContent = '書いている… ' + (1 + i) + '/' + (1 + n); } });   /* 1 件目は招待 */
    }
    const next = sharedRec(id);
    if (snap.length) next.savedAt = Date.now();
    /* アドレスで足したコードは、もう使い済みにする（ほかの人が同じコードで入ってきても足さない） */
    next.invites = (next.invites || []).filter(i => i && i.exp > now - 30 * 86400000)
      .concat([{ inv: box.address, at: now, exp: now + INVITE_DAYS * 86400000, used: addr ? now : null }]);
    if (nextMembers) next.members = nextMembers;
    putShared(next);
    /* コードは知らせの文に埋めず、② の欄の「招待コードをコピー」の横に出す（Issue #68 の返事「コードコピーできるボタンあれば便利？
       いま、説明文に埋もれて見えにくい」）。この画面を開いている間だけメモリに置く（端末には残さない） */
    lastCode = { id, code };
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { /* ボタンで写す */ }
    let msg = (copied ? '招待コードを作ってコピーした。' : '招待コードを作った。下の「招待コードをコピー」で写す。')
      + '相手にだけ送る（メッセージなど）。' + (addr ? '' : '相手が記録を送ったら、次に「同期する」ときにメンバーに足す。');
    curKey = 'share-code';
    line.textContent = msg;
    /* 同じ押しの続きで手数料を送る（鍵は開けてある。パスキーを 2 度求めない） */
    if (addr && withGift) {
      try { await giftWith(net, keys, { a: addr, n: nick }); msg += '　' + line.textContent; } catch (e) {
        msg += '　手数料は送れなかった（' + ((e && e.message) || String(e)) + '）。あとでこの海の「手数料を送る」から送れる。';
      }
    }
    inviteSel = id;
    paint();
    curKey = 'share-code';
    line.textContent = msg;
  }

  /* アドレスでメンバーに足す（持ち主だけ。招待コードは作らない。Issue #68 の返事）。
     招待コードを受け取って読むだけになっている人を、記録を送る前に（SOL が無くても）メンバーにし、続けて手数料を送る */
  async function addByAddress(id, addrRaw, nickRaw, withGift) {
    const net = netSel.value;
    const rec = sharedRec(id);
    const addr = String(addrRaw || '').trim();
    const nick = String(nickRaw || '').trim().slice(0, 24);
    if (!addr) throw new Error('相手のウォレットのアドレスを上の欄に入れてから押す');
    if (!isAddress(addr)) throw new Error('相手のウォレットのアドレスの形が違う（Solana のアドレスを貼る。BTA1- で始まる受け取りIDではない）');
    const { keys, seaKey } = await openShared(rec);
    if (rec.owner !== keys.wallet.address) throw new Error('メンバーを足せるのは海の持ち主だけ');
    if (addr === keys.wallet.address) throw new Error('自分のアドレスが入っている（相手のアドレスを入れる）');
    const already = (rec.members || []).some(m => m.a === addr);
    const board = await boardOf(seaKey);
    const members = already ? null : cleanMembers((rec.members || []).concat([{ a: addr, x: '', n: nick }]));
    if (members) {
      const roster = await postMemos(keys.wallet, rosterInner(Object.assign({}, rec, { members })), board);
      const need = await needFunds(net, roster.length);
      if (!window.confirm('「' + (nick || shortAddr(addr)) + '」をメンバーに足す？\n'
        + '新しい名簿をチェーンに書く（取引 ' + roster.length + ' 件・手数料の目安 ' + solText(need.fee) + '）。\n'
        + '相手がまだ招待を受け取っていなければ、前に送った招待コードで受け取ってもらう（コードが無ければ「招待コードを作る」）。')) { line.textContent = 'やめた'; return; }
      line.textContent = '名簿を書いている…';
      await writePost(net, keys.wallet, roster, board);
      const next = sharedRec(id);
      next.members = members;
      putShared(next);
    } else if (!withGift) {
      throw new Error('この人はもうメンバー（手数料を送るなら「手数料も送る」にチェックを入れる）');
    }
    let msg = members ? '「' + (nick || shortAddr(addr)) + '」をメンバーに足した。相手はカードの「同期」で自分の記録を送れる。' : '';
    curKey = 'share-code';
    line.textContent = msg;
    /* 同じ押しの続きで手数料を送る（鍵は開けてある。パスキーを 2 度求めない） */
    if (withGift) {
      try { await giftWith(net, keys, { a: addr, n: nick }); msg += (msg ? '　' : '') + line.textContent; } catch (e) {
        msg += (msg ? '　' : '') + '手数料は送れなかった（' + ((e && e.message) || String(e)) + '）。';
      }
    }
    inviteSel = id;
    paint();
    curKey = 'share-code';
    line.textContent = msg;
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
    if (lost.length) throw new Error('受け取りIDが分からないメンバーがいる（' + lost.map(m => m.n || shortAddr(m.a)).join('・') + '）。先に「同期する」で名簿を読む');
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
    delete next.rk;   /* 代が変わったので、前の代の読むための鍵は捨てて作り直す */
    putShared(next);
    await keepReadKeys(id, seaKey, gen);
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
    await saveWith(rec, keys, seaKey);
  }

  /* 記録の中身の目印（同期で「この端末に新しい書き込みがあるか」を見るため。Issue #68）。中身を写さず、短い数字にする */
  function boxSig(id) { return sigOf(seaBox(id)); }
  function sigOf(b) {
    if (!b || !b.doc) return '';
    const s = JSON.stringify(b.doc);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length.toString(36) + '.' + h.toString(36);
  }
  /* 同期する（Issue #68 の返事「送るの近くに同期ボタン作れる？読み込みと新規書込みがあれば書込みも」）。
     鍵は 1 度だけ開け、みんなの変更を取り込み、この端末に前の同期（送った・取り込んだ）のあとの書き込みがあれば、続けて送る */
  async function syncShared1(id) {
    const rec = sharedRec(id);
    const { keys, seaKey } = await openShared(rec);
    /* まだ署名していない自分のひとことがあれば、送っていないもの（Issue #68） */
    /* 目印の欄は syncMark（前の版の syncSig は、読んでいる間に書いたものまで含めてしまっていたので使わない。最初の同期は送る） */
    const dirty = !rec.syncMark || hasPendingNotes(id) || boxSig(id) !== rec.syncMark;
    await readWith(rec, seaKey, keys);
    const readMsg = line.textContent;
    if (!dirty) {
      curKey = 'sea:' + id;
      line.textContent = readMsg + '　この端末には新しい書き込みが無いので、送らなかった（手数料なし）。';
      /* 鍵を開けたので、ほかのメンバーの「ここにいる」をすぐ見に行く（直の通信 C1） */
      setTimeout(() => { watchAll(); }, 1500);
      return;
    }
    const wrote = await saveWith(sharedRec(id), keys, seaKey);
    if (wrote) { curKey = 'sea:' + id; line.textContent = readMsg + '　' + line.textContent; }
  }
  /* 鍵を開けたあとの「自分の変更を送る」。書いたら true */
  async function saveWith(rec, keys, seaKey) {
    const id = rec.id;
    const net = netSel.value;
    const board = await boardOf(seaKey);
    /* この端末で書いた、まだ署名の無いひとことに、開けた鍵でまとめて署名してから写しを作る（Issue #68 の返事。書くときは鍵を求めない） */
    const signedN = await signPendingNotes(id, keys.wallet);
    /* 直の通信（C1）のため、ページを閉じるまでウォレットの鍵をメモリに置く。ひとことの署名にも同じ間使う */
    holdSessionKeys(keys);
    holdWallet(keys.wallet, Date.now(), SESSION_HOLD_MS);
    const box = seaBox(id);
    if (!box) throw new Error('この海の記録がこの端末に無い');
    const sea = allEntries().find(e => e.id === id);
    line.textContent = '作っている…' + (signedN ? '（ひとこと ' + signedN + ' 件に署名した）' : '');
    /* dev・at は「ここにいる」の知らせを兼ねる（直の通信 C1。10 分のあいだ、ほかのメンバーの端末がつなぎに来る） */
    const inner = { kind: 'snap', sea: id, g: rec.gen, at: Date.now(), entry: sea || null, box, dev: deviceId() };
    /* 招待コードで受け取って、まだ名簿にいないなら、コードの受け口と受け取りIDを入れる（持ち主の端末がこれを見て名簿に足す。Issue #68） */
    const myEntry = (rec.members || []).find(m => m.a === keys.wallet.address);
    const joining = rec.inv && rec.owner !== keys.wallet.address && !myEntry;
    if (joining) Object.assign(inner, { inv: rec.inv });
    /* アドレスで名簿に足された人（受け取りIDが空）も、受け取りIDを入れて知らせる（鍵を作り替えたときの招待の宛先になる） */
    if (joining || (myEntry && !myEntry.x && rec.owner !== keys.wallet.address)) inner.x = await makeShareAddress(keys, net);
    const memos = await postMemos(keys.wallet, inner, board);
    if (memos.length > MAX_TX) throw new Error('記録が大きすぎる（取引 ' + memos.length + ' 件に分かれる）');
    /* 「ここにいる」を、写しとは別の小さな書き込み（チャットの掲示板の hello。取引 1 件）として先に書く（2026-11-16 Issue #68 の返事
       「送るTODOの数が多くなったから、トランザクションが別れて開始の合図がみえないのでは？」）。
       写しに入れた「ここにいる」は、写しの切れ端が全部そろって開けないと読めず、TODO が多いと見つけてもらいにくかった。
       直の通信を切っている・使えないときは書かない */
    const p2pOn = loadP2pPrefs().on && p2pSupported();
    const chatB = p2pOn ? await chatBoardOf(seaKey) : null;
    const hello = chatB ? await postMemos(keys.wallet, { kind: 'hello', sea: id, g: rec.gen, dev: deviceId(), at: Date.now() }, chatB) : [];
    const need = await needFunds(net, memos.length + hello.length);
    const todos = Array.isArray(box.doc && box.doc.todos) ? box.doc.todos.filter(t => t && !t.trashed).length : 0;
    if (!window.confirm('「' + (sea ? sea.name : id) + '」の自分の記録を共有の掲示板に書く？\ntodo ' + todos + ' 件・取引 ' + (memos.length + hello.length)
      + ' 件' + (hello.length ? '（うち 1 件は直の通信の「ここにいる」）' : '') + '・手数料の目安 ' + solText(need.fee)
      + '\n書いたものは消せない（メンバーだけが読める）。')) { line.textContent = 'やめた'; return false; }
    if (hello.length) {
      line.textContent = '「ここにいる」を書いている…';
      try { await writePost(net, keys.wallet, hello, chatB); } catch (e) { /* 書けなくても記録は送る */ }
    }
    await writePost(net, keys.wallet, memos, board, { onStep: (i, n) => { line.textContent = '書いている… ' + i + '/' + n; } });
    /* 送った中身の目印を残す（次の同期で、これより後の書き込みがあるかを見る） */
    /* 目印は、送った写しの中身から作る（書いている間に足したひとことを「送った」ことにしない。Issue #68） */
    putShared(Object.assign(sharedRec(id), { savedAt: Date.now(), syncMark: sigOf(box) }));
    /* 送ったあと、ほかのメンバーの「ここにいる」をすぐ見に行く（直の通信 C1。10 分のうちに開いていれば、つなぎに行く） */
    setTimeout(() => { watchAll(); }, 1500);
    paint();
    curKey = 'sea:' + id;
    line.textContent = '送った（取引 ' + memos.length + ' 件）。ほかのメンバーは「同期する」で重ねる。'
      + (joining ? '招いた人が「同期する」を押すと、メンバーに足される。' : '');
    return true;
  }

  /* この端末で書いた、まだ署名の無いひとこと（その海の分）に署名する（Issue #68 の返事「TODOのメッセージを送る時に…その場で同期しないのであれば不要なのでは？」）。
     開いている海は store.signedNotes で置き換え（記録の印も付く）、ほかの海は箱を直に書き換えて印を進める。署名した数 */
  function seaStateOf(id) {
    /* 読むだけなので保存しない（2026-11-19）。前は store.flush() を呼んでいて、保存の知らせ（store.onPersist）で同期がもう 1 回走り、
     同期の知らせでここがまた呼ばれる、の繰り返しになっていた（共有の海で設定を開いている間、1 秒に約 100 回 /api/data を読み、サーバーの回数の上限に当たる） */
  if (id === store.space()) return store.exportState();
    try { return boxToState(JSON.parse(localStorage.getItem(boxKey(id)) || 'null')); } catch (e) { return null; }
  }
  const pendingOf = (st, dev) => (st && st.doc && Array.isArray(st.doc.notes) ? st.doc.notes : [])
    .filter(n => n && !n.gone && !n.sg && n.dev === dev && n.text);
  /* この端末で書いて、まだ署名していない（送っていない）ひとことがあるか */
  function hasPendingNotes(id) { return pendingOf(seaStateOf(id), noteDevice()).length > 0; }
  async function signPendingNotes(id, wallet) {
    const dev = noteDevice();
    const st = seaStateOf(id);
    const notes = st && st.doc && Array.isArray(st.doc.notes) ? st.doc.notes : [];
    const todo = pendingOf(st, dev);
    if (!todo.length) return 0;
    const signed = [];
    for (const n of todo) signed.push(await signNote(n, wallet));
    if (id === store.space()) return store.signedNotes(signed);
    const byId = new Map(signed.map(n => [n.id, n]));
    const now = Date.now();
    st.doc.notes = notes.map(n => (n && byId.has(n.id) ? byId.get(n.id) : n));
    st.stamps = st.stamps || {};
    byId.forEach((_, nid) => { st.stamps['note:' + nid] = [now, 1]; });
    try { localStorage.setItem(boxKey(id), JSON.stringify(stateToBox(st))); } catch (e) { return 0; }
    return byId.size;
  }

  /* 掲示板を読み、メンバーごとにいちばん新しい記録を重ねる */
  async function readShared1(id) {
    const rec = sharedRec(id);
    const { keys, seaKey } = await openShared(rec);
    await readWith(rec, seaKey, keys);
  }
  /* 名簿の受け取りIDが空の人（アドレスで足した人。Issue #68）を、前に分かっていたものか、その人が写しに入れた受け取りIDで埋める。
     受け取りIDの中のウォレットが本人のものでなければ使わない */
  async function fillShareIds(members, posts, prev, net) {
    const out = [];
    for (const m of members) {
      if (m.x) { out.push(m); continue; }
      const old = (prev || []).find(p => p.a === m.a && p.x);
      if (old) { out.push(Object.assign({}, m, { x: old.x })); continue; }
      let x = '';
      for (const p of posts) {
        if (p.by !== m.a || typeof p.x !== 'string') continue;
        try { const to = await readShareAddress(p.x); if (to.wallet === m.a && to.network === net) { x = to.text; break; } } catch (e) { /* 次へ */ }
      }
      out.push(Object.assign({}, m, { x }));
    }
    return out;
  }
  /* 招待コードで入ってきた人を名簿に足す（持ち主だけ。Issue #68）。足したら新しい members を返す。足さなければ null */
  async function addJoiners(next, got, seaKey, keys) {
    if (!keys || next.owner !== keys.wallet.address) return null;
    if (!(next.invites || []).some(i => !i.used)) return null;
    const cands = joinsOf(got.posts, { sea: next.id, gen: next.gen, owner: next.owner, members: next.members, invites: next.invites });
    const ok = [];
    for (const j of cands) {
      /* 受け取りIDが書いた人のものか（ほかの人の受け取りIDを入れて、鍵を作り替えたときの招待を横取りさせない） */
      try { const to = await readShareAddress(j.x); if (to.wallet === j.a && to.network === next.net) ok.push(j); } catch (e) { /* 捨てる */ }
    }
    if (!ok.length) return null;
    const members = cleanMembers((next.members || []).concat(ok.map(j => ({ a: j.a, x: j.x, n: j.n }))));
    const board = await boardOf(seaKey);
    const roster = await postMemos(keys.wallet, rosterInner(Object.assign({}, next, { members })), board);
    const need = await needFunds(next.net, roster.length);
    if (!window.confirm('招待コードで ' + ok.length + ' 人が入ってきた: ' + ok.map(j => j.n || shortAddr(j.a)).join('・') + '\n'
      + 'メンバーに足す？ 新しい名簿をチェーンに書く（取引 ' + roster.length + ' 件・手数料の目安 ' + solText(need.fee) + '）。\n'
      + '足すと、その人の記録とチャットも使うようになる。足さなければ、その人は読むだけのまま。')) return null;
    line.textContent = '名簿を書いている…';
    await writePost(next.net, keys.wallet, roster, board);
    const used = new Set(ok.map(j => j.inv));
    next.invites = (next.invites || []).map(i => (used.has(i.inv) ? Object.assign({}, i, { used: Date.now() }) : i));
    next.members = members;
    return members;
  }
  /* quiet: 重ねる確かめを出さない（盤のひとことを送ったときの読み込み。重ねるのは消さないので確かめなしでよい。Issue #68） */
  /* board: 海の鍵の代わりに読むための鍵（Issue #68 の A 案）で読むとき。そのときは鍵を開けていないので、名簿に人を足さない */
  async function readWith(rec, seaKey, keys, quiet, board) {
    const id = rec.id;
    line.textContent = '掲示板を読んでいる…';
    const got = board ? await readBoardWith(rec.net, rec, board) : await readBoard(rec.net, rec, seaKey);
    let next = sharedRec(id);
    if (got.members) next = Object.assign(next, { members: await fillShareIds(got.members, got.posts, next.members, next.net) });
    let snaps = got.snaps;
    let added = null;
    /* 名簿に足せなくても（残高が足りない など）、記録の取り込みは続ける */
    try { added = await addJoiners(next, got, seaKey, keys); } catch (e) {
      toast('招待コードで入ってきた人を足せなかった: ' + ((e && e.message) || String(e)));
    }
    if (added) {
      putShared(next);
      snaps = acceptedSnaps(got.posts, { owner: next.owner, members: added, sea: id, gen: next.gen });
    }
    if (!snaps.length) {
      putShared(next);
      paint();
      curKey = 'sea:' + id;
      line.textContent = 'まだ誰も記録を書いていない（鍵の代 ' + rec.gen + '）。読めないときは、持ち主が鍵を作り替えたかもしれないので「届いた招待を受け取る」を押す。';
      return;
    }
    const nameOf = a => (a === cfg.address ? '自分' : ((next.members || []).find(m => m.a === a) || {}).n || shortAddr(a));
    if (!quiet && !window.confirm('共有の記録を重ねる？\n' + snaps.map(s => nameOf(s.by) + '（' + new Date(s.at).toLocaleString() + '）').join('\n')
      + '\nいまの記録は消さずに重ねる（記録ごとに新しく書き換えたほうが残る）。')) { line.textContent = 'やめた'; return; }
    /* 重ねる直前に、前の同期のあとの書き込みが無かったかを見る（無ければ、重ねたあとの中身を新しい目印にする。Issue #68 の同期）。
       ここから目印を書くまで await しない。前は読み始めに見ていたので、読んでいる間に書いたひとことまで「送った」ことになり、
       次の「同期」で送られなかった（2026-11-15 Issue #68 の返事「TODOの同期を押しても、招待された側に反映されない」） */
    const fresh = sharedRec(id);
    const wasClean = !!fresh.syncMark && !hasPendingNotes(id) && boxSig(id) === fresh.syncMark;
    /* 写しの中の海の ID は見ず、この海の箱にだけ重ねる（メンバーがほかの海を書き換えられないように） */
    snaps.forEach(s => {
      const entry = memberEntry(s.entry, id);
      mergeIntoDevice({ seas: entry ? [entry] : [], boxes: { [id]: s.box } });
    });
    putShared(Object.assign(next, { readAt: Date.now() }, wasClean ? { syncMark: boxSig(id) } : {}));
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
      /* 代が変わったときは前の代の読むための鍵を捨て、受け取った鍵で作り直す（Issue #68 の A 案） */
      const allNow = loadShared();
      if (allNow[f.sea.id]) { delete allNow[f.sea.id].rk; saveShared(allNow); }
      putShared(rec);
      await keepReadKeys(rec.id, f.key, f.gen);
      all[f.sea.id] = rec;
      if (!local) addInvitedSea(f.sea);
      took++;
      curKey = 'share-in';
      await readWith(rec, f.key);
    }
    paint();
    curKey = 'share-in';
    line.textContent = took ? '招待を ' + took + ' 件受け取った。' : (line.textContent || 'どれも受け取らなかった。');
  }

  /* 招待コードで受け取る（Issue #68 の返事「おすすめで」）。読むだけなので手数料は掛からない */
  async function acceptCode(code) {
    if (!String(code || '').trim()) throw new Error('招待コード（BTI1-…）を欄に貼ってから「受け取る」を押す');
    const keys = await unlock();   /* パスキーは押した手の続きで呼ぶ。ここより前で await しない */
    await checkSame(keys);
    const c = await readInviteCode(code);
    const net = netSel.value;
    if (c.network !== net) throw new Error('この招待コードは ' + NETWORKS[c.network].label + ' のもの。「' + PREP_NAME + '」でネットをそろえる（招いた人と同じネットで鍵を開く）');
    line.textContent = '招待を探している…';
    const f = await findInviteByCode(code);
    if (!f) throw new Error('招待が見つからない（期限切れ・写し間違い・まだ書き終わっていない）。少し待ってもう一度押すか、招いた人に作り直してもらう');
    const all = loadShared();
    const prev = all[f.sea.id];
    if (prev && prev.me === keys.wallet.address && prev.gen >= f.gen) throw new Error('「' + f.sea.name + '」はもう受け取っている');
    if (f.owner === keys.wallet.address) throw new Error('自分が作った招待コード（相手に送る）');
    const local = allEntries().find(e => e.id === f.sea.id && e.alive);
    if (local && !prev) throw new Error('「' + f.sea.name + '」の招待は受け取れない（この端末に同じ ID の別の海がある）');
    if (!window.confirm('海「' + f.sea.name + '」に招かれている。受け取る？\n招いた人のウォレット: ' + f.owner
      + '\n受け取ると、この海がこの端末に足され、メンバーの記録を読み込む（手数料は掛からない）。'
      + '\n「同期する」で自分の記録を送ると、招いた人の端末があなたをメンバーに足す。')) { line.textContent = 'やめた'; return; }
    const board = await boardOf(f.key);
    const rec = { id: f.sea.id, net, gen: f.gen, owner: f.owner, me: keys.wallet.address,
      wrapped: await wrapSeaKey(f.key, keys.recordKey, f.sea.id, f.gen, keys.wallet.address), board: board.address,
      members: [], inv: f.inv, savedAt: null, readAt: null };
    putShared(rec);
    await keepReadKeys(rec.id, f.key, f.gen);
    if (!local) addInvitedSea(f.sea);
    curKey = 'share-in';
    await readWith(rec, f.key);
    paint();
    curKey = 'share-in';
    const member = ((loadShared()[f.sea.id] || {}).members || []).some(m => m.a === keys.wallet.address);
    line.textContent = '「' + f.sea.name + '」を受け取った。' + (member ? 'もうメンバーなので、「同期する」で自分の記録を送れ、チャットも使える。'
      : '「同期する」で自分の記録を送ると、招いた人がメンバーに足す（それまでは読むだけ）。');
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

  /* 同期する（Issue #52）。鍵は1回だけ出してもらう（パスキーは押した手の続きで1回しか呼べない端末があるため）。
     1. いちばん新しい控えがこの端末で書いた・読み込んだものでなければ、確かめずに重ねる（消さないので。ほかの端末の変更を上書きで落とさないため）
     2. 今の記録を書く（手数料が掛かるので saveBackup の確かめは出す） */
  async function syncChain() {
    const net = netSel.value;
    const keys = await unlock();
    await checkSame(keys);
    line.textContent = 'ほかの端末の控えを探している…';
    const parts = await readLatestMemos(net, keys.wallet.address);
    const c0 = loadConfig();
    let head = '';
    if (parts && parts[0].id !== c0.lastId && parts[0].id !== c0.seenId) {
      const n = mergeIntoDevice(await openMemos(parts, keys.recordKey), { askLocal: true });
      markChainSeen(parts[0].id);
      head = 'ほかの端末の記録を重ねた（海 ' + n + ' つ）。';
    }
    const r = await saveBackup(keys, net);
    if (!r) { line.textContent = head + '送るのはやめた（ほかの端末には、まだ届いていない）。'; return; }
    cfg = Object.assign(loadConfig(), { lastAt: r.at, lastId: r.id, lastCount: r.count });
    saveConfig(cfg);
    paint();
    line.textContent = head + '送った（取引 ' + r.count + ' 件）。ほかの端末では、開いている間に画面の下に知らせが出る。';
  }

  /* いまの記録を keys のウォレットでチェーンに書く → { id, count, at }。確かめの画面でやめたら null */
  async function saveBackup(keys, net) {
    try { store.flush(); } catch (e) { /* 書くのは止めない */ }
    line.textContent = 'バックアップを作っている…';
    const dev = deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1);
    /* 選んだ海域の記録と、海域の一覧（名前と住所。鍵は入れない）だけ（段2） */
    const chosen = chainPick.chosen();
    if (!chosen.length) { line.textContent = '入れる海を選ぶ'; return null; }
    const picked = pickForPayload(chosen, collectBoxes(), allEntries());
    const payload = buildPayload({ boxes: picked.boxes, seas: picked.seas, server: null, at: Date.now(), device: dev,
      regions: regionsPayload(chosen) });
    const sum = moveSummary(payload);
    const memos = await sealToMemos(payload, keys.recordKey);
    /* MAX_TX を超えても、手数料の目安を見せて「それでも書く」を選べる（2026-11-15 Issue #67）。メモの形の上限（MAX_PARTS 超）だけは書かない */
    const size = backupSize(memos.length);
    if (size === 'too-big') {
      throw new Error('記録が大きすぎる（取引 ' + memos.length + ' 件に分かれる。1 つのバックアップは ' + MAX_PARTS
        + ' 件まで）。入れる海を減らすか、引っ越しのファイルを使う');
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
    const over = size === 'over'
      ? '\n\n【ふだんの上限 ' + MAX_TX + ' 件を超える】取引 ' + memos.length + ' 件・手数料の目安 ' + solText(need.fee)
        + '\n書き終わるまで 約 ' + Math.max(1, Math.ceil(memos.length * 0.6 / 60)) + ' 分掛かる（画面を閉じない）。'
        + '途中で止まると、その控えは戻せない（手数料は戻らない）。'
        + '引っ越しのファイルなら手数料は掛からない。\nそれでも書くなら OK、やめるならキャンセル。'
      : '';
    if (!window.confirm(NETWORKS[net].label + ' にバックアップを保存する？\n海 ' + sum.seas + ' つ・todo ' + sum.todos + ' 件'
      + '\n大きさ ' + kb(rawBytes) + ' → 縮めて暗号化 ' + kb(sealedBytes)
      + '（' + Math.round(sealedBytes / Math.max(1, rawBytes) * 100) + '%）'
      + '\n取引 ' + memos.length + ' 件・手数料の目安 ' + solText(need.fee)
      + '\n書いたものは消せない（暗号化してある）。' + over)) { line.textContent = 'やめた'; return null; }
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
      const pass = await askText('新しい合言葉（1 で書き留めた 24 字）');
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
    const mode = await askReplaceOrAdd('このバックアップをこの端末に復元する', ['保存した時刻: ' + at + (s.device ? '（' + s.device + '）' : ''),
      (s.regions.length ? '同期の先 ' + s.regions.join('・') + '・' : '') + '海 ' + s.seas + ' つ・todo ' + s.todos + ' 件',
      s.regions.length ? 'サーバーの鍵は入っていない（設定の「海」の［サーバーにログイン］で入り直す）。' : '']);
    if (!mode) {
      line.textContent = 'やめた';
      return true;
    }
    if (mode === 'replace') line.textContent = (await backupBeforeReplace()) + '。';
    const n = mergeIntoDevice(p, { askLocal: true, replace: mode === 'replace', add: mode === 'add' });
    /* 読み込んだ控えは「新しい記録がある」の知らせに出さない（Issue #52。js/chainwatch.js） */
    if (address === cfg.address) markChainSeen(parts[0].id);
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
    const pass = await askText('切り替える先の合言葉（24 字）');
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
    const code = await askText('復元コード（BT1-…）');
    if (!code) return;
    const r = await readRecoveryCode(code);
    netSel.value = r.network;
    await restoreWith(r.recordKey, r.address, r.network);
    if (!cfg.mode) line.textContent += '　復元コードでは読むだけ。続けてバックアップを保存するなら「新しく作る」で始める。';
  }

  /* ほかの箱から「やりたいこと」を選んで開く（Issue #43 の返事:「記録を保存する・読み込む」→ ブロックチェーン）。
     まだ始めていなければ、鍵を選ぶ画面のまま */
  wrap.openTask = k => { if (cfg.mode && TASKS.some(([key]) => key === k)) { task = k; paint(); } };
  /* 別の欄（準備の箱など）で始めた・鍵やネットを替えたあとに読み直す（Issue #45 で欄が分かれたため）。
     箱を開いたとき・選択肢で選んだときに呼ぶ */
  wrap.refresh = () => {
    cfg = loadConfig();
    netSel.value = cfg.network in NETWORKS ? cfg.network : 'devnet';
    paint();
  };
  /* 共有中の海を同期する（盤のひとことの「同期」から。Issue #68） */
  wrap.syncSea = id => syncShared1(id);
  /* チャット（読むだけの面か、鍵を開けたチャット）を開いているか。開いている間は外から描き直さない（Issue #68） */
  wrap.hasChat = () => !!chat;
  /* その海のチャットを開く（知らせの［開く］から。2026-11-16 Issue #68 の返事「タップしたらその画面に遷移できない？」）。
     読むだけの欄を開いて、その欄まで画面を動かす */
  wrap.openSeaChat = id => {
    const rec = loadShared()[id];
    if (!rec || rec.me !== cfg.address) return false;
    paint();
    try { peekChat('sea:' + id, rec); } catch (e) { return false; }
    if (chat && chat.panel) { try { chat.panel.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 進む */ } }
    return true;
  };
  /* 読み込みだけ（盤のひとことを送ったとき。Issue #68 の返事「TODOのメッセージを送る時に読み込みだけは行った方がいいのでは？」）。
     開けた鍵と海の鍵は 10 分だけメモリに置き（readHold）、そのあいだはパスキー・合言葉を求めない。端末には置かない */
  wrap.readSea = async id => {
    const rec = sharedRec(id);
    /* 読むための鍵があれば、鍵を求めずに読む（Issue #68 の A 案） */
    const rb = readBoardsOf(rec);
    if (rb) { await readWith(rec, null, null, true, rb.board); return; }
    const h = readHold && readHold.id === id && readHold.gen === rec.gen && Date.now() < readHold.until ? readHold : null;
    let keys, seaKey;
    if (h) ({ keys, seaKey } = h);
    else {
      ({ keys, seaKey } = await openShared(rec));
      readHold = { id, gen: rec.gen, keys, seaKey, until: Date.now() + READ_HOLD_MS };
      holdWallet(keys.wallet);
    }
    await readWith(rec, seaKey, keys, true);
  };

  paint();
  return wrap;
}

/* 盤（泡の詳しい欄）のひとことの「同期」から呼ぶ（2026-11-15 Issue #68 の返事「同期ボタンは、盤（TODO）のひとことの『送る』の横にも」→「こっちにも」）。
   設定の画面と同じ同期（取り込み・新しい書き込みがあれば送る）を、画面に出さない欄で行い、知らせは say へ渡す。
   パスキーは押した手の続きで呼ぶので、この中で鍵を開けるまで await しない */
export function syncSharedSea(id, say) {
  const box = chainBox({ tasks: ['share'], part: 'sync', say });
  return box.syncSea(id);
}
/* 盤のひとことの「送る」のあとに、読み込みだけをする（Issue #68）。書かないので手数料は掛からない */
export function readSharedSea(id, say) {
  const box = chainBox({ tasks: ['share'], part: 'sync', say });
  return box.readSea(id);
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
    status.textContent = '戻すと、戻している間はサーバーへ送らない（この端末の中だけで書く）。'
      + '記録はそのまま使い、戻す前に写しを取る。最新に戻ったとき、前の版が落とした欄を写しから埋め戻す。'
      + '上の帯の「最新に戻る」か、次の新しい版が届くと最新に戻る。';
    const row = el('div', 'row');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
    const btn = el('button', 'btn', '前の版（v' + prev + '）に戻す');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (!window.confirm('この端末を前の版 v' + prev + ' に戻す？\n戻している間はサーバーへ送らない。上の帯の「最新に戻る」で戻せる。')) return;
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
    /* 鍵のかけ方（Issue #14 2026-11-13）。錠があればその方法、無ければパスキー（使える端末）か合言葉を選ぶ */
    const lock = keyLock();
    const lockName = l => (l && l.mode === 'passkey') ? 'パスキー' : '合言葉';
    const askNewPass = () => {
      const a = window.prompt('キーに鍵をかける合言葉を決める（' + AIKEY_PASS_MIN + ' 字以上。忘れたらキーを入れ直す）');
      if (!a) return '';
      if (a.length < AIKEY_PASS_MIN) { toast('合言葉は ' + AIKEY_PASS_MIN + ' 字以上にする'); return ''; }
      const b = window.prompt('確かめのため、同じ合言葉をもう一度');
      if (a !== b) { toast('合言葉が合わなかった'); return ''; }
      return a;
    };
    /* 押した手の続きで呼ぶ（パスキーの確認は、押してからすぐでないと断られる） */
    const runLock = async (fn, done) => {
      try { await fn(); toast(done); }
      catch (e) { toast((e && e.message) || '鍵をかけられなかった'); }
      renderAll();
    };
    const lockButtons = (label, fn) => {
      const out = [];
      if (lock) return out;
      if (prfSupported()) {
        const b = el('button', 'btn', 'パスキーで' + label);
        b.type = 'button';
        b.addEventListener('click', () => fn('passkey'));
        out.push(b);
      }
      const b2 = el('button', 'btn', '合言葉で' + label);
      b2.type = 'button';
      b2.addEventListener('click', () => fn('pass'));
      out.push(b2);
      return out;
    };

    if (hasKey() && !editing) {
      const st = el('span', 'aikey-st');
      st.textContent = isKeyLocked()
        ? 'API キー: 入っている（…' + keyTail() + '・' + lockName(lock) + 'で鍵をかけてある'
          + (keyOpen() ? '・今は開いている' : '') + '）'
        : 'API キー: 入っている（…' + keyTail() + '）・鍵がかかっていない';
      st.style.cssText = 'flex:1;min-width:160px;font-size:13.5px';
      row.appendChild(st);
      if (isKeyPlain()) {
        /* 平文のまま置いてあるキー（前の版で入れたもの）に鍵をかける */
        const doLock = mode => runLock(() => lockPlainKey(undefined, { mode, askNewPass }), 'キーに鍵をかけた');
        if (lock) {
          const b = el('button', 'btn', lockName(lock) + 'で鍵をかける');
          b.type = 'button';
          b.addEventListener('click', () => doLock(lock.mode));
          row.appendChild(b);
        } else lockButtons('鍵をかける', doLock).forEach(b => row.appendChild(b));
      }
      if (isKeyLocked() && keyOpen()) {
        const cl = el('button', 'btn', '今すぐ閉じる');
        cl.type = 'button';
        cl.addEventListener('click', () => { lockNow(); toast('閉じた（次に使うときに開ける）'); renderAll(); });
        row.appendChild(cl);
      }
      const ch = el('button', 'btn', '変える');
      ch.type = 'button';
      ch.addEventListener('click', () => renderKey(true));
      const rm = el('button', 'btn', '消す');
      rm.type = 'button';
      rm.addEventListener('click', () => { removeKey(); toast('キーを消した'); renderAll(); });
      row.appendChild(ch); row.appendChild(rm);
      keyBox.appendChild(row);
      keyBox.appendChild(el('p', 'note', isKeyLocked()
        ? 'キーは暗号化して置いてある。AI を使うときに' + lockName(lock) + 'で開け、開いたままにするのは '
          + Math.round(AIKEY_OPEN_MS / 60000) + ' 分まで（ページを閉じると閉じる）。開いている間にページで悪いコードが動けば読まれうるので、'
          + '使える上限額は ' + P.keyPlace + ' の側でも決めておく。'
        : 'このキーは平文で置いてある。鍵をかけると、使っていない間に読まれなくなる。'));
      return;
    }
    const keyIn = document.createElement('input');
    keyIn.type = 'password';
    keyIn.autocomplete = 'off';
    keyIn.placeholder = P.keyPrefix + '…（' + P.keyPlace + ' で発行）';
    keyIn.setAttribute('aria-label', P.label + ' の API キー');
    keyIn.style.cssText = 'flex:1;min-width:160px;font:inherit;font-size:16px;min-height:44px;'
      + 'padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg);color:var(--text)';
    /* 鍵をかけて保存する。錠がまだ無ければ mode（'passkey' | 'pass'）で作る */
    const save = mode => {
      const v = keyIn.value.trim();
      if (!v) { toast('キーを貼り付けてから保存する'); return; }
      const msg = v.indexOf(P.keyPrefix) === 0 ? 'キーに鍵をかけて保存した'
        : 'キーに鍵をかけて保存した（' + P.keyPrefix + ' で始まっていない。違う会社のキーかもしれない）';
      runLock(() => saveKeyLocked(v, undefined, { mode, askNewPass }), msg);
    };
    /* 保存の前の警告（Issue #14 2026-11-13 利用者の指示「E 用に保存する時に警告文出して」= 上限額の運用）。
       window.confirm にしないのは、確認の窓を挟むとパスキーの確認が「押した手の続き」でなくなり断られるため。欄のすぐ上に出す */
    const warn = el('div', 'aikey-warn');
    warn.setAttribute('role', 'note');
    warn.style.cssText = 'margin:8px 0 0;padding:8px 10px;border-radius:10px;border:1px solid var(--line-strong);'
      + 'background:var(--bg);font-size:13px;line-height:1.55';
    const wt = el('b');
    wt.textContent = '保存する前に（大事）';
    warn.appendChild(wt);
    [
      'このキーは、AI を使っている間（鍵を開けている間）は、ページの中で悪いコードが動けば読まれうる。暗号化しても、そのときは守れない。',
      P.keyPlace + ' の側で、この app 専用のキーを作り、使える上限額（月の上限）を決めておく。漏れても被害がそこで止まる。',
      'ほかの用途に使っているキー・上限の無いキーは入れない。しばらく使わないときは「消す」、ときどき作り直して古いキーを取り消す。',
    ].forEach(t => { const p = el('p'); p.style.cssText = 'margin:4px 0 0'; p.textContent = '・' + t; warn.appendChild(p); });
    keyBox.appendChild(warn);
    row.appendChild(keyIn);
    if (lock) {
      keyIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); save(lock.mode); } });
      const sv = el('button', 'btn', 'キーを保存（' + lockName(lock) + 'で鍵）');
      sv.type = 'button';
      sv.addEventListener('click', () => save(lock.mode));
      row.appendChild(sv);
    } else {
      keyIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) ev.preventDefault(); });
      lockButtons('鍵をかけて保存', save).forEach(b => row.appendChild(b));
    }
    if (editing) {
      const cancel = el('button', 'btn', 'やめる');
      cancel.type = 'button';
      cancel.addEventListener('click', () => renderKey(false));
      row.appendChild(cancel);
    }
    keyBox.appendChild(row);
    keyBox.appendChild(el('p', 'note', 'キーはこの端末にだけ、暗号化して置く（サーバー・同期・引っ越しのファイルには入らない）。'
      + (lock ? '鍵は前に決めた' + lockName(lock) + '。'
        : (prfSupported() ? 'パスキー（指・顔）か、自分で決める合言葉で鍵をかける。パスキーが使えない端末は合言葉。'
          : 'この端末はパスキーが使えないので、自分で決める合言葉（' + AIKEY_PASS_MIN + ' 字以上）で鍵をかける。'))
      + 'AI を使うときに開ける。' + P.keyPlace + ' の側で、この app 専用のキーと使える上限額を決めておくと安心。'));
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

/* 「音と表示を変える」で選んでいる画面（js/prefs.js の PAGES の id）。設定を開き直しても覚える */
let lookPage = 'all';

/* onRender: 項目を描き直したあとに呼ぶ（「どの画面を変えるか」の出し入れをかけ直すため） */
function prefsBox(onRender) {
  const wrap = el('div', 'tags prefs-box');
  wrap.appendChild(el('h3', null, 'この端末の表示を変える'));
  wrap.appendChild(el('p', 'note', '好みで見た目と動きを変える。この端末にだけ置く（同期・引っ越しには乗らない）。'));
  /* Issue #76。設定はページの住所（オリジン）ごとの localStorage にあるので、サーバーあり版とサーバーなし版で別になる */
  wrap.appendChild(el('p', 'note', 'サーバーあり版とサーバーなし版（開いているページの住所が違うもの）では、この設定は別々に置かれる。'
    + '片方で変えたら、もう片方でも同じように変える。'));

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
    const outer = controls;
    ITEMS.forEach(it => {
      /* 項目ごとの囲い。data-pages で「どの画面を変えるか」の選びに合わせて出し入れする（Issue #49 の返事） */
      const controls = el('div', 'prefs-item');
      controls.dataset.pages = (it.pages || ['all']).join(' ');
      outer.appendChild(controls);
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
      if (it.type === 'set') {
        /* いくつでも選ぶ（Issue #49。盤にはじめから出す欄）。押したらすぐ置く */
        const box = el('fieldset', 'prefs-set');
        box.style.cssText = 'border:0;padding:0;margin:10px 0 0;font-size:13.5px';
        const lg = textEl('legend', null, it.label);
        lg.style.cssText = 'padding:0;margin-bottom:4px';
        box.appendChild(lg);
        const grid = el('div', 'prefs-set-grid');
        grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px 14px';
        const on = new Set(cur[it.id] || []);
        it.choices.forEach(([val, name]) => {
          const row = el('label', 'setrow');
          row.style.cssText = 'margin:0;min-height:40px';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = on.has(val);
          cb.addEventListener('change', () => {
            const next = it.choices.map(c => c[0]).filter(x => (x === val ? cb.checked : on.has(x)));
            commit(applyChanges(cur, { [it.id]: next }).next, '盤の「' + name + '」: ' + (cb.checked ? 'はじめから出す' : '「その他」に畳む') + '（次に盤を開いたときから）');
          });
          row.appendChild(cb);
          row.appendChild(textEl('span', null, name));
          grid.appendChild(row);
        });
        box.appendChild(grid);
        /* まとめて選ぶ（Issue #49 の返事「本文・タイトル・終了のみデフォルトで表示しときたい」） */
        if (it.id === 'boardShow') {
          const pr = el('div', 'row');
          pr.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px';
          const few = el('button', 'btn', '少なめにする（名前・本文・期間だけ）');
          few.type = 'button';
          few.addEventListener('click', () => commit(applyChanges(cur, { boardShow: BOARD_SHOW_FEW }).next,
            '盤は 名前・本文・期間 だけを出し、ほかは「その他」に畳む（次に盤を開いたときから）'));
          const all = el('button', 'btn', '全部出す');
          all.type = 'button';
          all.addEventListener('click', () => commit(applyChanges(cur, { boardShow: it.choices.map(c => c[0]) }).next,
            '盤の欄とボタンを全部出す（次に盤を開いたときから）'));
          pr.appendChild(few);
          pr.appendChild(all);
          box.appendChild(pr);
        }
        controls.appendChild(box);
        if (it.note) controls.appendChild(textEl('p', 'note', it.note));
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
    if (onRender) onRender();
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
  /* サーバーあり版では AI に頼む欄を出さない（2026-11-17 Issue #78。項目は手で変える） */
  if (aiOn()) wrap.appendChild(chat);

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

/* サーバーなし版: ほかの端末の新しい控えを画面の下に知らせる（2026-11-13 Issue #52 の R1。js/chainwatch.js）。
   ［読み込む］は押した手の続きで鍵を出してもらい（パスキーは await の前に呼ぶ）、いちばん新しい控えを重ねる（消さない・確かめの窓は出さない） */
if (typeof document !== 'undefined' && isSolo()) {
  startChainWatch({
    open: async () => {
      const c = loadConfig();
      let keys;
      if (c.mode === 'passkey') keys = await keysFromRoot((await passkeyRoot(c.credId)).root);
      else if (c.mode === 'pass') {
        const pass = await askText('合言葉（始めたときに書き留めた 24 字）');
        if (!pass) return false;
        keys = await keysFromRoot(await rootFromPassphrase(pass));
      } else throw new Error('まだ始めていない');
      if (c.address && keys.wallet.address !== c.address) throw new Error('鍵が違う（このウォレットのアドレスと合わない）');
      const parts = await readLatestMemos(c.network, keys.wallet.address);
      if (!parts) throw new Error('全部そろったバックアップが見つからない');
      const n = mergeIntoDevice(await openMemos(parts, keys.recordKey), { askLocal: true });
      markChainSeen(parts[0].id);
      toast('ほかの端末の記録を重ねた（海 ' + n + ' つ）');
      return true;
    },
  });
}

/* ブロックチェーンで共有している海を、アプリを開いている間に読む（2026-11-15 Issue #68 の B 案）。
   読むための鍵（rk）がある海だけ。ファイルの下で始める（上の定数を先に作ってから） */
/* サーバーあり版では見張らない（チェーンの読み込みも、その上の直の通信 WebRTC も始めない。2026-11-17 Issue #78） */
if (typeof document !== 'undefined' && isSolo()) startSharedWatch();

/* この端末のすべての海の控え（サーバーのバックアップ・上書きの前の控え。フォルダの控えと同じ形）。2026-11-19 */
function deviceBackupPayload() {
  const rids = regionList().map(r => r.id);
  const picked = pickForPayload(rids, collectBoxes(), allEntries());
  return buildBackup({ boxes: picked.boxes, seas: picked.seas, at: Date.now(), device: deviceLabel(navigator.userAgent, (navigator.maxTouchPoints || 0) > 1),
    regions: regionsPayload(rids) });
}

/* 今の記録をサーバーに預ける（押して取るバックアップ。2026-11-19「能動的なバックアップを追加して」）→ 一覧の 1 行 */
async function takeServerBackup(label) {
  try { store.flush(); } catch (e) { /* 預けるのは止めない */ }
  const p = deviceBackupPayload();
  return saveServerBackup(p, label || '', p.device);
}

/* 上書きの前に、今の記録をサーバーに控える（2026-11-19「古いものをサーバーにバックアップをとって、新しいデータを完全に差し替える」）。
   ログインしていない・届かないときは、この端末にファイルで書き出す（控えを取らずに入れ替えない）→ 知らせる文 */
async function backupBeforeReplace() {
  if (canServerBackup()) {
    try {
      const m = await takeServerBackup('上書きの前');
      window.dispatchEvent(new CustomEvent('bubbles:server-backups'));
      return '今の記録をサーバーに控えた（' + backupWhen(m.at) + '・上書きの前）';
    } catch (e) { /* 下のファイルへ */ }
  }
  const p = deviceBackupPayload();
  const name = moveFileName(p.at).replace('bubbles-move', 'bubbles-backup-before-replace');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 1) + '\n'], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'サーバーに控えられなかったので、今の記録をファイル（' + name + '）に書き出した';
}

function backupWhen(ms) {
  const d = new Date(ms);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* 上書きか追加かを聞く（2026-11-19「読み出したものは上書きするか追加するかきいて」）→ 'replace' | 'add' | null（やめる）。
   板の形は泡の記録を直す板（css/bubble.css の .bh-edit-*）と同じ */
function askReplaceOrAdd(title, lines) {
  return new Promise(resolve => {
    const back = el('div', 'bh-edit-back');
    const box = el('div', 'bh-edit-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.dataset.name = '上書きか追加かを聞く板';
    const tt = el('p', 'tt');
    tt.textContent = title + '？';
    box.appendChild(tt);
    (lines || []).filter(Boolean).forEach(t => { const p = el('p', 'why'); p.textContent = t; box.appendChild(p); });
    const how = el('p', 'why');
    how.textContent = '上書き … 今の記録をサーバーに控えてから（ログインしていなければファイルに書き出してから）、読み込んだもので丸ごと入れ替える（読み込んだものに無い泡は消える）。'
      + '追加 … 今の記録に足す（今の泡は消さない。両方にある泡は新しく書き換えたほうが残り、読み込んだものにあって今は無い泡は戻る）。';
    box.appendChild(how);
    const row = el('div', 'row');
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const mk = (tx, cls, v) => { const b = el('button', cls); b.type = 'button'; b.textContent = tx; b.dataset.v = v || ''; b.addEventListener('click', () => done(v)); row.appendChild(b); return b; };
    mk('やめる', 'ca', null);
    mk('上書きする', 'ca', 'replace');
    const add = mk('追加する', 'ok', 'add');
    box.appendChild(row);
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', ev => { if (ev.target === back) done(null); });
    back.appendChild(box);
    document.body.appendChild(back);
    add.focus({ preventScroll: true });
  });
}

/* バックアップ（2026-11-19。前の「個人の控え」の場所）。
   ・サーバー（ログイン中）: ［今バックアップを取る］と、預けたものの一覧（新しい順）。［戻す］で上書きか追加かを聞く
   ・この端末の控え（合わせる・入れ替える前に取った個人の海の前の中身。2026-11-18）: 同じく［戻す］
   前は控えを［今の個人に重ねる］の 1 通りだけだった（「重ねる」と「戻す」の 2 段）。今は戻すときに上書きか追加かを聞く */
function personalBackupBox(owner) {
  const w = document.createElement('div');
  w.className = 'pbk';
  w.dataset.name = 'バックアップ';
  const KIND = { unify: 'ログインで合わせる前', person: '前の版で入れ替える前', user: '別の利用者に替わる前' };
  const fmt = backupWhen;
  const rowOf = (text, onBack, blocked) => {
    const r = document.createElement('div');
    r.className = 'row pbk-row';
    r.style.cssText = 'align-items:center;gap:8px;margin:4px 0';
    const t = document.createElement('span');
    t.style.flex = '1';
    t.textContent = text;
    r.appendChild(t);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '戻す';
    if (blocked) { btn.disabled = true; btn.title = blocked; }
    btn.addEventListener('click', async () => { btn.disabled = true; try { await onBack(); } finally { btn.disabled = !!blocked; } });
    r.appendChild(btn);
    return r;
  };
  const say = document.createElement('p');
  say.className = 'note pbk-say';
  say.setAttribute('aria-live', 'polite');
  let seq = 0;
  const paint = async () => {
    const my = ++seq;
    w.textContent = '';
    const h = document.createElement('p');
    h.className = 'prefs-pages-lb';
    h.textContent = 'バックアップ';
    w.appendChild(h);
    /* --- サーバー --- */
    const sh = document.createElement('p');
    sh.className = 'pbk-sub';
    sh.textContent = 'サーバー';
    w.appendChild(sh);
    if (!canServerBackup()) {
      const p = document.createElement('p');
      p.className = 'pbk-none';
      p.textContent = 'ログインすると、サーバーにバックアップを預けて、ここから戻せる。';
      w.appendChild(p);
    } else {
      const r = document.createElement('div');
      r.className = 'row';
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'btn';
      take.textContent = '今バックアップを取る';
      take.dataset.name = '今バックアップを取る';
      take.addEventListener('click', async () => {
        take.disabled = true;
        say.textContent = '預けている…';
        try { const m = await takeServerBackup('手で取った'); say.textContent = 'サーバーに預けた（' + fmt(m.at) + '・海 ' + m.seas + '・泡 ' + m.todos + '）'; paint(); }
        catch (e) { say.textContent = '預けられなかった: ' + ((e && e.message) || e); }
        finally { take.disabled = false; }
      });
      r.appendChild(take);
      w.appendChild(r);
      const list = document.createElement('div');
      list.className = 'pbk-list pbk-srv';
      list.textContent = '読んでいる…';
      w.appendChild(list);
      listServerBackups().then(items => {
        if (my !== seq) return;
        list.textContent = '';
        if (!items.length) { const p = document.createElement('p'); p.className = 'pbk-none'; p.textContent = 'まだ預けていない。'; list.appendChild(p); return; }
        items.forEach(m => list.appendChild(rowOf(fmt(m.at) + '　' + (m.label || '') + '・海 ' + m.seas + '・泡 ' + m.todos, async () => {
          say.textContent = '読んでいる…';
          let got;
          try { got = await getServerBackup(m.id); } catch (e) { say.textContent = '読めなかった: ' + ((e && e.message) || e); return; }
          const info = moveSummary(got.payload);
          const mode = await askReplaceOrAdd('サーバーのバックアップから戻す', [fmt(m.at) + '　' + (m.label || '') + (m.device ? '（' + m.device + '）' : ''),
            '海 ' + info.seas + ' つ・todo ' + info.todos + ' 件']);
          if (!mode) { say.textContent = ''; return; }
          const pre = mode === 'replace' ? (await backupBeforeReplace()) + '。' : '';
          /* 同じ利用者が預けたもの。この端末だけの海はこの端末だけの海へ戻す（版をまたぐ引っ越しの問い askLocal は出さない） */
          const n = mergeIntoDevice(got.payload, { replace: mode === 'replace', add: mode === 'add' });
          say.textContent = pre + '海 ' + n + ' つの記録を' + (mode === 'replace' ? '入れ替えた。' : '戻した（今の記録に重ねた）。');
          toast(mode === 'replace' ? 'バックアップ（' + fmt(m.at) + '）で入れ替えた' : 'バックアップ（' + fmt(m.at) + '）を重ねた');
          paint();
        })));
      }).catch(e => { if (my === seq) list.textContent = '一覧を読めなかった: ' + ((e && e.message) || e); });
    }
    /* --- この端末の控え --- */
    const locals = personalBackups();
    if (locals.length) {
      const lh = document.createElement('p');
      lh.className = 'pbk-sub';
      lh.textContent = 'この端末の控え（' + locals.length + '）';
      w.appendChild(lh);
      const ln = document.createElement('p');
      ln.className = 'note';
      ln.textContent = '合わせる・入れ替える前に取った、個人の海の前の中身。';
      w.appendChild(ln);
      const here = isPersonal(store.space());
      const login = !!loggedIn();
      const llist = document.createElement('div');
      llist.className = 'pbk-list pbk-local';
      w.appendChild(llist);
      locals.forEach(b => {
        const blocked = !here ? '個人の海を開いてから' : (b.other && login) ? 'ログアウトしてから（前の利用者の控え）' : '';
        llist.appendChild(rowOf(fmt(b.at) + '　' + (KIND[b.kind] || '') + '・泡 ' + b.n, async () => {
          const mode = await askReplaceOrAdd('この端末の控えから個人の海に戻す', [fmt(b.at) + '　' + (KIND[b.kind] || '') + '・泡 ' + b.n]);
          if (!mode) return;
          let got;
          const raw = backupState(b.key, !!loggedIn());
          if (mode === 'replace') {
            const pre = raw ? (await backupBeforeReplace()) + '。' : '';
            got = raw ? replaceState(store.exportState(), raw) : null;
            say.textContent = pre;
          } else got = raw ? addState(store.exportState(), raw) : null;
          if (!got || !store.applyState(got)) { toast('戻せなかった'); return; }
          say.textContent += '控え（' + fmt(b.at) + '）' + (mode === 'replace' ? 'で個人の海を入れ替えた。' : 'を個人の海に重ねた。');
          toast(mode === 'replace' ? '控えで入れ替えた' : '控えを重ねた');
        }, blocked));
      });
    }
    w.appendChild(say);
  };
  /* 一覧はサーバーに聞くので、箱が開いているときだけ読む（閉じた設定の画面で何度も聞かない） */
  const open = () => !owner || owner.open;
  if (open()) paint();
  if (owner) owner.addEventListener('toggle', () => { if (owner.open) paint(); });
  window.addEventListener('bubbles:server-backups', () => { if (w.isConnected && open()) paint(); });
  return w;
}

/* 読む前の確かめに出す、ほかの app の束の行（日記。2026-11-18 §8.3） */
function appsLine(info) {
  if (!info || !info.apps || !info.apps.length) return '';
  const parts = info.apps.map(a => a === 'diary' ? '日記 ' + (info.diaryDays || 0) + ' 日分（diary へ渡す）' : a + '（この版では渡さない）');
  return '\n' + parts.join('・');
}
