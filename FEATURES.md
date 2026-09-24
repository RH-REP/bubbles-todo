# 機能表

**最終更新**: 2026-09-24（F7 左のメニューを実装した）

このファイルは2部でできている。

1. **現行機能** — いま動いているもの。提案を省いたときに何が残るかを読むための土台
2. **提案機能** — まだ作っていないもの。**1件ずつ独立に採否を決められる**ように書いてある

提案は互いに依存しない（依存があるものは表に書いた）。省く場合は「採否」に × を書くだけでよく、
ほかの提案の仕様は変わらない。採る場合は「仕様」の節の手順どおりに作れる粒度にしてある。

決まったものは `README.md`（仕様）と `HANDOFF.md`（申し送り）へ移し、ここからは消す。
未決の論点は `DEV_NOTES.md` に置く（A-66・A-67 が該当）。

---

## 0. 触らない決めごと

どの提案もこれに触れない。触れる案は「衝突するので入れない」に分けてある（末尾）。

| 決めごと | 出どころ |
|---|---|
| 達成率・パーセント・分母のある数字を出さない | README「作らないと決めてある」 |
| 連続日数（ストリーク）を出さない | 同上 |
| 完了したときのご褒美演出をしない | 同上 |
| 命令形の文言を使わない | 同上 |
| 「はじめた」を立てるのは押したボタン。時計は判定しない | `js/focus.js` 冒頭、HANDOFF「はじめた」の記録 |
| 集中中のタイマーは止まらない。停止ボタンは作らない | `js/focus.js` 決めごと |
| 通信は一切しない（`fetch` も `XHR` も無い） | README 「動かす」 |
| `focus.js` / `bubble.js` は store を触らない（app.js が差し込む） | `js/app.js` 配線の節 |

---

## 1. 現行機能（実装済み）

| 機能 | どこ | 備考 |
|---|---|---|
| 海（タグ無し・タグ付き最大10・上＝長期保留・下＝完了） | `js/screens/sea.js` | 出すのは新しいほう20件。残りは「リスト表示」 |
| 今日（日付ごとの水面。左右で前後の日） | `js/screens/today.js` | 過去の日は読み取り専用 |
| きっかけ／すきま（同じ実装を2つの設定で） | `js/screens/cardlist.js` | 1件が複数の枠に入れる |
| ふりかえり（着手の記録。件数のみ、帯グラフ無し） | `js/screens/review.js` | 設定の中から開く |
| 設定（タグ・音・プロトタイプ操作） | `js/screens/settings.js` | 右上の歯車 |
| 5分の集中画面（**残り時間の時計つき**、過ぎたらカウントアップ） | `js/focus.js` | 2026-09-11 に時計を戻した |
| 「はじめた」の記録（早く終わった／今日は終わり） | `js/store.js` `start` / `logs` | 判定はボタン |
| 作業メモ → 次の一手（git のように積む）／履歴／直す | `js/store.js` `commitStep` ほか | 集中画面と盤の両方から |
| 最初の一手・リンク | `js/store.js` `firstStep` / `url` | http/https のみ |
| 長期保留と「もどってくる日」 | `js/store.js` `setHold` / `holdUntil` | 過ぎたら開いた時点で静かに戻す |
| **完了しても置いた日の水面に残る**（✓ が付く） | `js/screens/today.js` `dayItems`、`css/bubble.css` `.is-done` | 2026-09-18 |
| さいころ（無作為に1つ。完了は引かない） | `js/screens/today.js` `pickList` | 候補0なら押せない |
| リスト表示・さがす・フィルター | `js/screens/sea.js` | |
| タブへドラッグ＝状態を足す（移動ではない） | `js/bubble.js`、`js/app.js` | |
| 集中1回ぶんの控え（**内部のみ。表示しない**） | `js/store.js` `focusLog` / `logFocus` / `focusCount` / `focusMs` | 2026-09-11。出しどころは A-67 |
| 完了音（WebAudio 合成。既定オン、設定で切れる） | `js/sound.js` | 設定は store とは別の localStorage キー |
| ホーム画面に追加・オフライン | `manifest.json`、`sw.js` | |
| Android（Capacitor 6） | `android/`、`tools/build-www.mjs` | ビルドは app_dev 側で |
| 保存は localStorage のみ | `js/store.js` `KEY = 'bubble_todo_v1'` | **書き出し・読み込みは無い** |
| **左のメニュー**（最近つかった／お気に入り／長期保留／タグごと → 今日に置く。名前で盤が開く） | `js/app.js` `openDrawer` / `revealItem`、`js/store.js` `recentItems` / `favItems` / `setFav`、`js/bubble.js` `centerBubble` | 2026-09-24（元 F7）。9/25 にタグ区分・折り畳み・名前タップを追加。お気に入りは盤の ☆ |

---

## 2. 提案機能（未着手）

**採否** は空欄。○ なら §3 の手順で作る。× なら何もしない（他の行に影響しない）。

| ID | 機能 | 由来（他アプリ） | 採否 | 依存 | 触るファイル | 規模 | 省くとどうなるか |
|---|---|---|---|---|---|---|---|
| F1 | 記録の書き出し・読み込み | Things / Todoist / TickTick | | なし | `settings.js` | 小 | localStorage が消えると記録は戻らない（現状のまま） |
| F2 | 集中の長さを選ぶ（5／15／25分） | Focus To-Do / Forest / Session | | なし | `store.js` `settings.js` `sea.js` `today.js` `todo.js` | 小 | 5分固定のまま（現状） |
| F3 | 約束の時刻に1回だけ音 | Tide / Be Focused | | なし（F2 があれば長さに追従） | `sound.js` `focus.js` `settings.js` | 小 | 画面を見ていないと区切りが分からない（現状） |
| F4 | 完了したバブルを水面の底に寄せる | Things Logbook / TickTick 折りたたみ | | なし | `drift.js` `today.js` `css/bubble.css` | **中** | ✓ 付きが未完了と混ざって漂う（現状） |
| F5 | 集中中に席を離れた回を控える（内部のみ） | Forest（記録側だけ） | | なし | `focus.js` `store.js` `tests/` | 小 | 控えに離席が残らない（現状） |
| F6 | どこからでも `/` で海の入力欄へ | Todoist `q` / Things クイック入力 | | なし | `app.js` `sea.js` | 小 | 書くには海タブへ戻る（現状） |
| F7 | 左のメニュー（最近つかった／お気に入り／長期保留 から今日へ置く） | 利用者の要望（2026-09-24） | **○ 実装済 9/24** | なし | `app.js` `store.js` `bubble.js` `css/base.css` `sea.css` `today.css` `tests/` | **中** | 長期保留は上の海から、最近のものは海を探して、今日へ運ぶ（現状） |

規模の目安：小＝1〜2時間・テスト数件、中＝半日・物理に手が入る。

---

## 3. 仕様

書き方はどれも同じ：目的 → 決めごと → データ → 画面 → 手順 → テスト → 未決。
手順のファイル名・関数名は 2026-09-19 時点のコードに合わせてある。

### F1. 記録の書き出し・読み込み

**目的** 唯一の正本が localStorage にしか無いので、消えたときに戻す手段を持つ。
端末間の同期ではない（通信しない決めごとはそのまま）。

**決めごと**
- 書き出すのは `localStorage['bubble_todo_v1']` の**生の文字列そのまま**。整形も抜粋もしない
  （store の形が変わっても、書き出し側を直す必要が無い）
- 読み込みは**置き換え**。混ぜない（混ぜると id の衝突と「消したはずのもの」の復活が起きる）
- 読み込む前に、いまの記録を自動で書き出す（取り違えたときの戻り道）
- 音の設定（`sound.js` の別キー）は対象外。記録ではなく端末の好みなので

**データ** 変更なし。

**画面** 設定 → 「プロトタイプ操作」の**上**に「記録」の節を1つ。
- 「書き出す」ボタン → `bubbles-YYYY-MM-DD.json` をブラウザが手元に落とす
- 「読み込む」ボタン → `<input type="file" accept=".json">` を開く。
  選ぶと「いまの記録を置き換える。置き換える前のぶんは先に書き出す」と**画面の中で**聞く（`confirm()` は使わない。既存の作法）

**手順**
1. `js/screens/settings.js` `mount()`：`/* --- 音 --- */` と `/* --- プロトタイプ操作 --- */` の間に `/* --- 記録 --- */` を足す
2. 書き出し：
   ```js
   const raw = localStorage.getItem('bubble_todo_v1') || '{}';
   const blob = new Blob([raw], { type: 'application/json' });
   const a = document.createElement('a');
   a.href = URL.createObjectURL(blob);
   a.download = 'bubbles-' + store.todayKey() + '.json';
   a.click(); URL.revokeObjectURL(a.href);
   ```
3. 読み込み：`file.text()` → `JSON.parse` で壊れていないことだけ確かめる（`v` が数で `todos` が配列）
   → 手順2で退避 → `localStorage.setItem('bubble_todo_v1', raw)` → `location.reload()`
   （store は読み込み時に `load()` → `normalize*` を通すので、古い形でも直る）
4. Capacitor（Android）では `a.click()` のダウンロードが効かないことがある。
   `www/` へ写す前に実機で確かめ、駄目なら `@capacitor/filesystem` を足す（これは通信ではない）

**テスト** store には触らないので `tests/store.test.mjs` に足すものは無い。
確認は手動：書き出す → 「記録ごと初期化」 → 読み込む → 元の件数に戻る。

**未決** なし。

---

### F2. 集中の長さを選ぶ

**目的** ポモドーロとして使える長さにできるようにする。既定は5分のまま（A-66 の決定）。

**決めごと**
- 選べるのは **5 / 15 / 25 分**の3つだけ。自由入力にしない（分母のある数字の入口になる）
- 休憩フェーズは作らない（「5分が過ぎても『あと5分？』と聞かない」と同じ理由で、
  「休憩に入りますか」も聞かない）
- 変えても、開いている集中画面には効かない。次に開くときから

**データ** `store.js` の保存に `prefs: { focusMinutes: 5 }` を足す。
`load()` で無ければ既定、`[5,15,25]` に無い値は 5 に倒す。`wipe()` で既定に戻す。

**画面** 設定 → 「音」の上に「集中の長さ」を1行。3つの丸ボタン（`aria-pressed`）。
文言は「5分」「15分」「25分」だけ。「おすすめ」「標準」は書かない。

**手順**
1. `js/store.js`
   - `let prefs = { focusMinutes: 5 };` を `focusLogs` の隣に
   - `persist()` の `{ ... focusLog: focusLogs, lastDay }` に `prefs` を足す
   - `load()` に `prefs: normalizePrefs(parsed.prefs)` を足す（無ければ既定）
   - `blank()` / 旧形式の分岐 / `wipe()` にも `prefs` の既定を
   - 公開 API：`focusMinutes()` → 数、`setFocusMinutes(m)` → 変わったか（`[5,15,25]` 以外は false）
2. 呼び出し元3か所を `minutes: store.focusMinutes(),` に
   - `js/screens/sea.js:786`、`js/screens/today.js:720`、`js/screens/todo.js:411`
   - `store.focusMinutes` が無い版への後ろ盾は不要（同じ repo で一緒に入る）
3. `js/screens/settings.js` に行を足す。`onShow()` で読み直す（音と同じ作法）
4. `js/focus.js` は触らない（`opts.minutes` を既に受け、`durationLabel()` が文言を作る）

**テスト** `tests/store.test.mjs` に4件：
- 既定は 5／`setFocusMinutes(25)` → 25 で保存に残る／開き直しても 25
- `[5,15,25]` 以外（0, 7, '25', null）は false で変わらない
- この版より前の保存データ（`prefs` 無し）でも 5 で立ち上がる
- `wipe()` で 5 に戻る

**未決** なし。

---

### F3. 約束の時刻に1回だけ音

**目的** 画面を伏せて作業していても、区切りが来たことが分かるようにする。

**決めごと**
- 鳴るのは**1回だけ**。繰り返さない。過ぎたあとの経過時間では鳴らない
- **既定オフ**。完了音とは別のスイッチ（完了音は既定オン）
- `prefers-reduced-motion: reduce` なら鳴らさない（完了音と同じ）
- 音の中身は完了音より短く低い1音。「終わった」ではなく「来た」の音
- 通知（`Notification` API）は使わない。裏に回っているときに鳴らないのは受け入れる

**データ** `sound.js` の localStorage に `bubble_todo_chime` を足す（`'1'`/`'0'`）。
完了音と同じ持ち方。store には入れない（端末の好み）。

**画面** 設定 → 「音」の節に2行目「約束の時刻に音を鳴らす」。

**手順**
1. `js/sound.js`
   - `isChimeOn()` / `setChimeOn(on)` を `isOn` / `setOn` と同じ形で
   - `playPromise()`：`playComplete()` を写し、`VOICES` の代わりに
     `PROMISE_VOICES = [[660, 0, 0.01, 0.35, 0.12]]` の1音。`isOn() && isChimeOn()` で門番
2. `js/focus.js` `tick()`：`state.over = true;` の直後に `try { playPromise(); } catch (_) {}`
   （`over` は1回しか立たないので、1回しか鳴らない）
3. `js/screens/settings.js`：音の節に行を足し、`onShow()` で読み直す
4. `js/focus.js` 冒頭の「決めごと」に1行足す：「約束の時刻に音は鳴る（設定で切れる）。それ以外の音は無い」

**テスト** 音は自動テストにしない（既存の完了音も同じ）。手動：25分は待てないので
`openFocus({ minutes: 0.05 })` で3秒に縮めて確認する（`js/focus.js` は分が整数でなければ秒で言い換える）。

**未決** 音の高さと長さ。上の数値は仮。

---

### F4. 完了したバブルを水面の底に寄せる

**目的** 完了が増えた日に、未完了が探しにくくならないようにする。達成は見えたまま。

**決めごと**
- 沈めるのは**今日の水面だけ**。海・きっかけ・すきまは触らない
- 沈んだバブルもタップできる（取り消し・履歴を読むため）。掴んで上に運べるが、離すとまた沈む
- 沈む動きは「演出」にならない速さで（0.5秒以内に落ち着く）。跳ねない・光らない
- 底の帯は線を引かない。完了が1つも無い日は帯そのものが無い

**データ** 変更なし（`item.done` は既に渡っている）。

**画面** 今日の水面の下端 96px を「底」にする。✓ 付きはそこに横一列（多ければ重なってよい）。

**手順**
1. `js/drift.js`：いまの `setWells()` は**升目1つに1件**で、近い順に**どのバブルでも**取る
   （`snapToWells` 参照。画面からは未使用）。これは使えない。代わりに
   - `item.sink === true` のバブルには、毎 tick で下向きの力を足す（`tick()` の中、壁の判定の前）
   - 底の帯の高さは `opts.sinkBand`（既定 0 ＝ 何もしない）で受ける
   - 沈んだものどうしは横にだけ押し合う（縦は帯の中で止める）
2. `js/screens/today.js` `itemsForField()`：`sink: isDoneItem(t)` を足す。
   `createField(host, { ..., sinkBand: 96 })`
3. `css/screens/today.css`：底の帯の分だけ入力欄との間を空ける（重ならないように）
4. `prefers-reduced-motion: reduce` では、沈める代わりに**最初から底に置く**（`settle()` の作法）

**テスト** drift は自動テストが無い。手動：完了3件・未完了2件で、完了だけが底に並び、
未完了は上を漂う／完了を掴んで上に置いても離すと戻る／取り消すと浮き上がる。

**未決**
- 沈んだものを掴めるようにするか、底では掴めなくするか（誤操作と取り消しのしやすさの天秤）
- 「明日」の水面でも沈めるか（過去の日は読み取り専用なので沈めなくてよい）

---

### F5. 集中中に席を離れた回を控える（内部のみ）

**目的** 控え（`focusLog`）に「離れたか」が残るようにする。**表示はしない**（A-67 と同じ扱い）。

**決めごと**
- 記録するのは回数と合計ミリ秒だけ。「離れた」と画面に出さない。集中画面の見た目も変えない
- 裏に回った理由は問わない（電話も、割り込みも、同じ1回）
- 5秒未満の離席は数えない（通知を見て戻る程度は「離れた」ではない）

**データ** `focusLog` の1件に `awayCount`（数）と `awayMs`（数）を足す。
無い保存データは 0 として読む。

**手順**
1. `js/focus.js`
   - `state` に `away: { n: 0, ms: 0 }, awayAt: null` を足す
   - `state.onVisibility`（287行あたり）を次の形に：
     ```js
     if (document.visibilityState === 'hidden') { flushDrafts(); state.awayAt = Date.now(); }
     else if (state.awayAt) {
       const d = Date.now() - state.awayAt;
       if (d >= 5000) { state.away.n++; state.away.ms += d; }
       state.awayAt = null;
     }
     tick();
     ```
   - `reportSession()` に `awayCount: s.away.n, awayMs: s.away.ms` を足す。
     閉じる時点で裏にいるなら（`awayAt` が立っている）その分も足す
2. `js/store.js`：**`logFocus()` と `normalizeFocusLog()` は既知のフィールドしか写さない。**
   両方に `awayCount` / `awayMs` を足す（数でなければ 0）。ここを忘れると黙って落ちる
3. `js/app.js` は触らない（`setSessionHandler` はオブジェクトをそのまま渡す）

**テスト** `tests/store.test.mjs` に2件：
- `logFocus({ ..., awayCount: 2, awayMs: 12000 })` が保存に残り、開き直しても読める
- 無い保存データ（この版より前の `focusLog`）は `awayCount: 0, awayMs: 0` で読める

**未決** 5秒の閾値。

---

### F6. どこからでも `/` で海の入力欄へ

**目的** 「思いついたことを書き出す」を、どの画面にいても1打でできるようにする。

**決めごと**
- キーは `/` 1つ。修飾キーは要らない。入力欄にいる間は効かない（`/` を打ちたいことがある）
- 集中画面が開いている間は効かない（集中画面は閉じ込めないが、外へ飛ばさない）
- 海のタブに移ってから入力欄へフォーカスする。既に海なら入力欄へだけ
- タッチ端末には何も出さない（キーボードが無い）。ボタンは足さない

**データ** 変更なし。

**手順**
1. `js/screens/sea.js`：入力欄に `id="sea-compose"` を付ける（いまは placeholder でしか指せない）
2. `js/app.js`：既にある `bubbles:goto` の受け口（設定 → ふりかえりで使っている）を使う
   ```js
   document.addEventListener('keydown', (ev) => {
     if (ev.key !== '/' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
     const a = document.activeElement;
     if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
     if (isFocusOpen()) return;                       // focus.js から import
     ev.preventDefault();
     window.dispatchEvent(new CustomEvent('bubbles:goto', { detail: { screen: 'sea' } }));
     requestAnimationFrame(() => document.getElementById('sea-compose')?.focus());
   });
   ```
3. `README.md` 「触り方」に1行：「`/` … どの画面からでも海の入力欄へ」

**テスト** 自動テスト無し。手動：きっかけの画面で `/` → 海に移って入力欄にカーソル／
入力欄の中で `/` → 文字として入る／集中画面の中で `/` → 何も起きない。

**未決** なし。

---

### F7. 左のメニュー（取り出す場所）

> **実装済み（2026-09-24）。**仕様は README「触り方」と HANDOFF「左のメニュー」へ移した。
> 以下は決めた当時の記録として残す。「未決」のうち、お気に入りは印（`fav` 真偽）で作った。

**目的** 海・今日・きっかけのどの画面にいても、「最近つかった」「お気に入り」「長期保留」を
一覧で見て、**1タップで今日の水面に置ける**場所を持つ。置き場ではなく**入口**。
長期保留は上の海に、お気に入りはこれから付ける印に、最近つかったは記録に、それぞれ本体がある。

**利用者の決定（2026-09-24）**
- 開くのは**左上のボタンだけ**。左端スワイプは作らない
- 「よく使う」は「**最近つかった**」に読み替える（最後に触った順。回数ではない）
- 取り出す＝**今日の水面に置く**。それ以外（盤を開く・5分を始める・ドラッグ）はしない
- お気に入りは**新しい印（星）**。海にはしない

**決めごと**
- 3つの区分は固定。増やせない・並べ替えない（増やせるとタグと二重になる）
- 「最近つかった」は**順番だけ**。回数も日数も「◯日前」も出さない
- メニューの中でできるのは「今日に置く」と、その取り消しだけ。完了・消す・タグの付け替えは盤の仕事
- 置いても**閉じない**（続けて数件置ける）。置いた行は「今日にある」に変わり、もう一度押すと外す
- **長期保留を今日に置くと、保留は解ける**（`setHold(id, false)`）。行は長期保留から消え、最近つかったに現れる。
  トーストの「取り消す」で保留に戻す（`holdUntil` も戻す）
- 完了したもの・消したものは、3区分のどこにも出さない
- 映している日が明日でも、置く先は**今日**（`todayKey()`）。メニューは日付を知らない
- 集中画面が開いている間はボタンを隠す。集中は閉じ込めないが、外へ出る入口は増やさない
- 命令形を使わない。空の区分は「まだ無い」の一言だけ。「追加しましょう」とは言わない

**なぜ左端スワイプを作らないか（根拠）**
`js/screens/sea.js:1434` `if (bubbleDrag || rowDrag || swipe || panning || pinch) return;` と
`js/screens/today.js:126` 「左右になぞる／見出しの日付から選ぶ、の2つで日を移る」——
海は背景の横なぞりで隣の海へ、今日は前後の日へ移る。左端から始まるなぞりを
メニューに取ると、左へ移るつもりの指が毎回メニューを引く。

**データ**
- 項目に `fav: boolean`（既定 false）を足す。**タグ一覧には入れない。**
  理由：タグにすると (1) バブルを1色染める（色は最大3つ。星が1枠を食う）、
  (2) 海にできる（`canBeSea`）、(3) フィルターに並ぶ。印は「取り出す場所に出る」ことだけが役目なので、
  `hold` と同じ**真偽の場**として持ち、`hasTag` の分岐にも足さない
- 「最近つかった」は保存しない。**読むたびに記録から出す派生値**：
  `lastTouchedOf(t) = max(createdAt, started の各値, steps[].at, doneAt, todayLogs[id].at, focusLog[id].at)`
  （`anchorAt` / `gapAt` は通し番号で時刻ではないので使わない）

**画面**
- 左上に丸ボタン（`.menubtn`）。`.gearbtn`（`css/base.css:166`）の鏡：`left: 10px`、同じ大きさ・同じ影。印は「≡」
- **ぶつかる部品をずらす**：
  - 海の `.sea-face-name`（`css/screens/sea.css:169` `left: 10px`）→ `left: 62px`
  - 今日の `.today-dayrow`（`js/screens/today.js` `dayRow`）→ `padding-left: 52px`
  - きっかけ／すきま（`cardlist.js`）の左上に部品があれば同じだけ。無ければ触らない
- 開くと、左から幅 `min(78vw, 320px)` の板が出て、右側は覆い（`.drawer-back`）。覆いをタップで閉じる。
  板の右上に「✕」（44px）
- 板の中：3つの節。見出しは「最近つかった」「お気に入り」「長期保留」。各節は最大20件。
  1行＝本文（18字で切る。`trim()` と同じ）と、右端に「今日に」ボタン（44px）。
  今日にあるものは行を薄くし、ボタンの文言を「今日にある」に。押すと外す
- 長期保留の行だけ、本文の下に「◯/◯ にもどる」を小さく（`holdUntil` があるときだけ。無ければ何も出さない）
- 空の節：「まだ無い」の1行
- 出入りの動きは 0.2 秒以内。`prefers-reduced-motion: reduce` なら動かさない（`focus.js` の `is-still` と同じ判定）

**手順**
1. `js/store.js`
   - 項目の既定に `fav: false` を足す：`add()` の定義、`normalizeTodos()`（無ければ false）
   - `setFav(id, on)` → 変わったか／`isFav(id)`／`favItems()`（`isLive && !done && fav`、新しく付けた順は持たないので `createdAt` 降順）
   - `lastTouchedOf(t)`（内部）と `recentItems(n = 20)`：`isLive && !done && !hold` を `lastTouchedOf` 降順で n 件
   - `heldItems()`：上の海が使っている問い合わせがあればそれを公開する。無ければ `isLive && !done && hold` を `holdUntil` 昇順（null は最後）
   - `wipe()` は項目ごと消すので追加なし
2. `js/app.js`（歯車と同じ場所・同じ作法で）
   - `menubtn` を `appRoot` に足す。`body.is-dragging` で薄くする（歯車と同じ）
   - `openDrawer()` / `closeDrawer()`。開いている間 `store` の変更通知で中身を引き直す
   - `closeTopOverlay()` の**先頭**に `.drawer-back` を足す（戻るボタンで最初に畳む）
   - 「今日に」：`store.setDay(id, store.todayKey(), true)`。長期保留の行なら先に `holdUntil` を控えてから `setHold(id, false)`。
     トースト「『◯◯』を今日に置いた」＋「取り消す」（`setDay(false)`、保留なら `setHold(id, true, 控えた holdUntil)`）
   - 「今日にある」：`store.setDay(id, todayKey(), false)`
   - `isFocusOpen()` が true の間はボタンを `hidden`
3. `js/bubble.js` 中央の盤：「今日は終わり」の並びに星の入り切り（`bc-act-fav`。`aria-pressed`）。
   `setCenterHandler` に `isFav` / `setFav` を足す（`js/app.js:401` の並び）
4. `css/base.css`：`.menubtn`、`.drawer-back`、`.drawer`、`.drawer h3`、`.drawer-row`、`.drawer-row.is-today`
5. `css/screens/sea.css` / `css/screens/today.css`：上の「ぶつかる部品をずらす」
6. `README.md` 「触り方」に1行、「6つの画面」の表の下に「左のメニュー」を1段落

**テスト** `tests/store.test.mjs` に6件：
- `setFav` の往復。保存に残り、開き直しても残る。この版より前の保存データ（`fav` 無し）は false
- `favItems()` は完了・消したものを含まない
- `recentItems()` の順：着手 → 記録（commitStep）→ 今日に置く、の順で触ると、最後に触ったものが先頭
- `recentItems()` は `hold` と `done` を含まない。`createdAt` しか無い項目も末尾に出る
- `heldItems()` の順：`holdUntil` の近い順、null は最後
- 長期保留を今日に置く手順（`setHold(false)` → `setDay(true)`）と、その取り消しで `holdUntil` が戻る

**未決**
- お気に入りを**タグとして**持つ案（色で染まる・海にできる）に切り替えるか。上の「データ」の理由で印にしたが、覆せる
- 「最近つかった」の20件の上限
- きっかけ／すきまの画面でもボタンを出すか（出さないと「どの画面からでも」が嘘になるので、出す想定で書いた）

---

## 4. 衝突するので入れない

利点はあるが、§0 に触れるもの。**採否欄は無い**（入れない）。

| 他アプリの利点 | ぶつかる決めごと |
|---|---|
| タスクごとの見込みポモ数、今日の合計見込み時間（Pomofocus / Llama Life） | 分母のある数字 |
| 連続日数・レベル・バッジ（Streaks / Habitica） | ストリーク、ご褒美演出 |
| 期限の押し通知（Due / Reminders） | 「過ぎた日は、開いた時点で戻すだけ」 |
| 端末間同期（Todoist / TickTick） | 通信しない（最小限は F1 で代替） |
| 「昨日の残り」をおすすめ（Microsoft To Do「My Day」） | 未完了の山を突き返さない |
| 休憩フェーズと「休憩に入りますか」（標準ポモドーロ） | 「あと5分？」と聞かない、と同じ理由 |

「今日集中した時間」を出すかは `DEV_NOTES.md` A-67 に未決で置いてある。ここには入れない。

---

## 5. 採る順の目安

| 順 | ID | 理由 |
|---|---|---|
| 1 | F1 | 失うと戻らないものを守る。他と依存しない |
| — | F7 | 実装済み（2026-09-24） |
| 2 | F2 | 時計を戻したぶんを「ポモドーロとして使える」ところまで運ぶ |
| 3 | F3 | F2 の長さに追従する。F2 が無くても5分で成立する |
| 4 | F5 | 小さく、既存の控えの上に乗るだけ |
| 5 | F6 | 小さいが、キーボードのある端末でしか効かない |
| 6 | F4 | 物理に手が入るので最後 |
