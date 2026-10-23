#!/bin/zsh -f
# Bubbles（bubble_todo）をダブルクリックで起動する。
# コードはこのフォルダ（開発側 repo の clone。update.command で pull して取り込む）。
# server.py を起動する。記録はこのフォルダの data/（state.json。合言葉は data/token.txt）に置き、
# ほかの端末は設定の「サーバー」から繋ぐ。ブラウザの localStorage にも同じ記録が入る。
# 止めるときはこのウィンドウで Ctrl+C。
set -u
USE_DIR="${0:A:h}"                                   # 利用側の clone
APP_DIR="$USE_DIR"                                   # コード（clone）
HOST="127.0.0.1"
PORT="${BUBBLE_TODO_PORT:-8931}"
if [[ ! -f "$APP_DIR/server.py" ]]; then echo "コードが見つかりません: $APP_DIR/server.py（update.command で取り込んでください）"; read; exit 1; fi
PYTHON=""
for cand in "$HOME/.pyenv/versions/3.11.8/bin/python3" "$(command -v python3 2>/dev/null)"; do
  if [[ -n "$cand" && -x "$cand" ]]; then PYTHON="$cand"; break; fi
done
if [[ -z "$PYTHON" ]]; then echo "python3 が見つかりませんでした。"; read; exit 1; fi
while command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
URL="http://${HOST}:${PORT}/"
echo "Bubbles (bubble_todo)"; echo "  コード: $APP_DIR"; echo "  データ: $USE_DIR/data/state.json（合言葉: $USE_DIR/data/token.txt）"; echo "  URL:    $URL"
echo "止める: このウィンドウで Ctrl+C"; echo
(sleep 1.2; open "$URL") &
cd "$APP_DIR" || exit 1
exec "$PYTHON" server.py --host "$HOST" --port "$PORT" --data-dir "$USE_DIR/data"
