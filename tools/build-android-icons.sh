#!/bin/sh
# Android のランチャーアイコンを、icons/ の泡から作り直す。
#
# なぜ script なのか：android/ は生成物（.gitignore 済み）で、`npx cap add android`
# のたびに Capacitor の既定アイコンへ戻る。**手で置き換えると次の再生成で消える。**
# だから「作り直す手順」のほうを残す。
#
#   sh tools/build-android-icons.sh      # npm run android:icons と同じ
#
# 作るもの（Android の作法どおり3種類）：
#   ic_launcher.png            古い端末向けの四角いアイコン
#   ic_launcher_round.png      同・丸く抜いたもの
#   ic_launcher_foreground.png 適応アイコンの前景（泡だけ・透過）
#   ic_launcher_background.xml 適応アイコンの地（べた塗り。icon.svg の上端と同じ色）
#
# 道具：SVG を絵にするのは headless Chrome（ImageMagick の内蔵 SVG 描画は
# グラデーションを無視する）。拡大縮小と丸抜きだけ ImageMagick。

set -e
cd "$(dirname "$0")/.."
RES="android/app/src/main/res"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BG="#c8e6f2"          # icons/icon.svg の地の上端と同じ

[ -d "$RES" ] || { echo "android/ がまだ無い。先に npm run cap:add:android"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 原本を大きめに1枚ずつ出しておく（あとは縮小するだけ）
"$CHROME" --headless --disable-gpu --screenshot="$TMP/square.png" \
  --window-size=512,512 "file://$PWD/icons/icon.svg" 2>/dev/null
"$CHROME" --headless --disable-gpu --default-background-color=00000000 \
  --screenshot="$TMP/fg.png" --window-size=432,432 "file://$PWD/icons/icon-fg.svg" 2>/dev/null

# 四角・丸は 48/72/96/144/192、前景は 108/162/216/324/432（Android の決まり）
set -- "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"
for row in "$@"; do
  set -- $row
  d=$1; sq=$2; fg=$3
  magick "$TMP/square.png" -resize ${sq}x${sq} "$RES/mipmap-$d/ic_launcher.png"
  # 丸抜き。外周1px を残さないよう、マスクは同じ大きさで作る
  magick "$TMP/square.png" -resize ${sq}x${sq} \
    \( +clone -alpha extract -fill black -colorize 100 \
       -fill white -draw "circle $((sq/2)),$((sq/2)) $((sq/2)),0" -alpha off \) \
    -compose CopyOpacity -composite "$RES/mipmap-$d/ic_launcher_round.png"
  magick "$TMP/fg.png" -resize ${fg}x${fg} "$RES/mipmap-$d/ic_launcher_foreground.png"
done

cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$BG</color>
</resources>
XML

echo "アイコンを入れ替えた（5密度 × 3種 ＋ 地の色 $BG）"
