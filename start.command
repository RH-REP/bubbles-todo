#!/bin/zsh -f
# Bubbles（bubble_todo）をダブルクリックで起動する。
# コードはこのフォルダ（開発側 repo の clone。update.command で pull して取り込む）。記録はブラウザの localStorage に入るので、このフォルダに置くのは起動口と実値の .env だけ。
# 止めるときはこのウィンドウで Ctrl+C。
set -u
USE_DIR="${0:A:h}"                                   # 利用側の clone
APP_DIR="$USE_DIR"                                   # コード（clone）
HOST="127.0.0.1"
PORT="${BUBBLE_TODO_PORT:-8931}"
if [[ ! -f "$APP_DIR/serve.py" ]]; then echo "コードが見つかりません: $APP_DIR/serve.py（update.command で取り込んでください）"; read; exit 1; fi
PYTHON=""
for cand in "$HOME/.pyenv/versions/3.11.8/bin/python3" "$(command -v python3 2>/dev/null)"; do
  if [[ -n "$cand" && -x "$cand" ]]; then PYTHON="$cand"; break; fi
done
if [[ -z "$PYTHON" ]]; then echo "python3 が見つかりませんでした。"; read; exit 1; fi
while command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
URL="http://${HOST}:${PORT}/"
echo "Bubbles (bubble_todo)"; echo "  コード: $APP_DIR"; echo "  データ: ブラウザの localStorage（このフォルダ: $USE_DIR）"; echo "  URL:    $URL"
echo "止める: このウィンドウで Ctrl+C"; echo
(sleep 1.2; open "$URL") &
cd "$APP_DIR" || exit 1
exec "$PYTHON" serve.py "$PORT"
