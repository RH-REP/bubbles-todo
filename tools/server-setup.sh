#!/usr/bin/env bash
# Bubbles の記録を置くサーバー（server.py）を、Linux のサーバー（Oracle Cloud など）に立ち上げる。
#
#   git clone https://github.com/RH-REP/bubbles-todo.git
#   bash bubbles-todo/tools/server-setup.sh            # 立ち上げ（2回目からは更新として働く）
#   bash bubbles-todo/tools/server-setup.sh update     # コードを取り込んで起動し直す
#   bash bubbles-todo/tools/server-setup.sh status     # 動いているか・住所
#   bash bubbles-todo/tools/server-setup.sh uninstall  # 常駐をやめる（記録と合言葉は消さない）
#
# すること（install）:
#   1. python3（3.8 以上）と git を確かめる。無ければ dnf / apt で入れる
#   2. このスクリプトの入っている clone を使う（無ければ BUBBLES_REPO から clone）。あれば git pull --ff-only
#   3. 記録の置き場（BUBBLES_DATA）を作る（chmod 700）
#   4. server.py のテストを走らせる
#   5. systemd のサービスを書いて、起動し、ログイン無しでも常駐させる
#      サーバーは 127.0.0.1 だけで待ち受ける（外からは直接届かない。ファイアウォールは開けない）
#   6. Tailscale に繋がっていれば `tailscale serve --bg <port>` で、tailnet の端末にだけ HTTPS で見せる
#   7. 繋ぐ住所と、合言葉のファイルの場所を出す（合言葉はサーバーが初回に作る）
#
# 変えられるもの（環境変数）:
#   BUBBLES_PORT     待ち受けるポート（既定 8931）
#   BUBBLES_DATA     記録と合言葉の置き場（既定 ~/bubbles-data）
#   BUBBLES_DIR      コードの clone（既定 このスクリプトの入っている clone、無ければ ~/bubbles-todo）
#   BUBBLES_REPO     clone する先（既定 https://github.com/RH-REP/bubbles-todo.git）
#   BUBBLES_SERVICE  systemd のサービス名（既定 bubbles-todo）
#   BUBBLES_INSTALL_TAILSCALE=1  Tailscale が無ければ、公式の手順（tailscale.com/install.sh）で入れる
#
# 合言葉: 個人は <置き場>/token.txt、共有は <置き場>/share_token.txt（初回に作る。chmod 600）。
#         共有に招く人には、住所と share_token.txt の中身だけを渡す。token.txt は渡さない。
set -euo pipefail

PORT="${BUBBLES_PORT:-8931}"
DATA="${BUBBLES_DATA:-$HOME/bubbles-data}"
REPO="${BUBBLES_REPO:-https://github.com/RH-REP/bubbles-todo.git}"
SERVICE="${BUBBLES_SERVICE:-bubbles-todo}"
UNIT_DIR="${BUBBLES_UNIT_DIR:-/etc/systemd/system}"   # テストのときだけ替える
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${BUBBLES_DIR:-}" ]]; then DIR="$BUBBLES_DIR"
elif [[ -f "$HERE/server.py" ]]; then DIR="$HERE"
else DIR="$HOME/bubbles-todo"; fi
UNIT="$UNIT_DIR/$SERVICE.service"

say()  { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok: %s\n' "$*"; }
warn() { printf '   注意: %s\n' "$*" >&2; }
die()  { printf '\n止めました: %s\n' "$*" >&2; exit 1; }

need_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die "Linux のサーバーで実行してください（いまは $(uname -s)）"
  command -v systemctl >/dev/null || die "systemd（systemctl）がありません"
  command -v sudo >/dev/null || die "sudo がありません"
}

pkg_install() {
  if command -v dnf >/dev/null; then sudo dnf install -y "$@"
  elif command -v apt-get >/dev/null; then sudo apt-get update -y && sudo apt-get install -y "$@"
  else die "$* を入れてください（dnf も apt-get もありません）"; fi
}

need_tools() {
  say "1. python3 と git"
  command -v git >/dev/null || pkg_install git
  command -v python3 >/dev/null || pkg_install python3
  PY="$(command -v python3)"
  "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' \
    || die "python3 が古い（$("$PY" -V 2>&1)）。3.8 以上が要ります"
  ok "$("$PY" -V 2>&1)（$PY）、$(git --version)"
}

get_code() {
  say "2. コード（$DIR）"
  if [[ -d "$DIR/.git" ]]; then
    git -C "$DIR" pull --ff-only
  else
    git clone "$REPO" "$DIR"
  fi
  [[ -f "$DIR/server.py" ]] || die "$DIR に server.py がありません"
  ok "$(git -C "$DIR" log --oneline -1)"
}

make_data() {
  say "3. 記録の置き場（$DATA）"
  mkdir -p "$DATA"
  chmod 700 "$DATA"
  ok "$(ls -ld "$DATA")"
}

run_tests() {
  say "4. server.py のテスト"
  (cd "$DIR" && "$PY" -m unittest tests/test_server.py 2>&1 | tail -3) || die "テストが通りません"
}

write_unit() {
  say "5. 常駐（systemd: $SERVICE）"
  local user group tmp
  user="$(id -un)"; group="$(id -gn)"
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# tools/server-setup.sh が書いた（手で直さない。直すならスクリプトを直して実行し直す）
[Unit]
Description=Bubbles (bubble_todo) server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$user
Group=$group
WorkingDirectory=$DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$PY $DIR/server.py --host 127.0.0.1 --port $PORT --data-dir $DATA
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
  sudo mkdir -p "$UNIT_DIR"
  sudo install -m 644 "$tmp" "$UNIT"
  rm -f "$tmp"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE" >/dev/null 2>&1 || sudo systemctl enable "$SERVICE"
  sudo systemctl restart "$SERVICE"
  ok "$UNIT"
}

health() {
  local i
  for i in $(seq 1 20); do
    if "$PY" - "$PORT" <<'EOF' 2>/dev/null
import sys, urllib.request
with urllib.request.urlopen(f'http://127.0.0.1:{sys.argv[1]}/api/health', timeout=2) as r:
    sys.exit(0 if b'"ok": true' in r.read() else 1)
EOF
    then ok "http://127.0.0.1:$PORT/api/health が応えた"; return 0; fi
    sleep 1
  done
  sudo journalctl -u "$SERVICE" -n 20 --no-pager >&2 || true
  die "サーバーが応えません（上の記録を見てください）"
}

ts_url() {
  # tailnet の中での住所（https://<機械名>.<tailnet名>.ts.net）。分からなければ空
  tailscale status --json 2>/dev/null | "$PY" -c '
import json, sys
try:
    name = json.load(sys.stdin)["Self"]["DNSName"].rstrip(".")
    print("https://" + name if name else "")
except Exception:
    print("")'
}

tailscale_serve() {
  say "6. Tailscale（tailnet の端末にだけ HTTPS で見せる）"
  if ! command -v tailscale >/dev/null; then
    if [[ "${BUBBLES_INSTALL_TAILSCALE:-0}" == "1" ]]; then
      curl -fsSL https://tailscale.com/install.sh | sh
    else
      warn "Tailscale が入っていません。入れてから実行し直してください:"
      warn "  BUBBLES_INSTALL_TAILSCALE=1 bash $DIR/tools/server-setup.sh"
      warn "  （または https://tailscale.com/download の手順）"
      return 0
    fi
  fi
  if ! tailscale status >/dev/null 2>&1; then
    if [[ -t 0 ]]; then
      warn "Tailscale にまだログインしていません。出てくる URL をブラウザで開いてログインしてください"
      sudo tailscale up
    else
      warn "Tailscale にまだログインしていません: sudo tailscale up をしてから実行し直してください"
      return 0
    fi
  fi
  # HTTPS（MagicDNS と HTTPS 証明書）が管理画面で無効だと、ここで有効にする URL が出る
  sudo tailscale serve --bg "$PORT" || { warn "tailscale serve に失敗しました（管理画面の DNS で MagicDNS と HTTPS を有効にする）"; return 0; }
  ok "tailscale serve --bg $PORT"
}

summary() {
  local url
  url="$(command -v tailscale >/dev/null && ts_url || true)"
  say "7. できあがり"
  printf '   サービス:     %s（sudo systemctl status %s）\n' "$SERVICE" "$SERVICE"
  printf '   記録:         %s/state.json（個人）、%s/share/state.json（共有）\n' "$DATA" "$DATA"
  printf '   合言葉:       %s/token.txt（個人）、%s/share_token.txt（共有）\n' "$DATA" "$DATA"
  printf '                 中身を見る: cat %s/token.txt  /  cat %s/share_token.txt\n' "$DATA" "$DATA"
  if [[ -n "$url" ]]; then
    printf '   繋ぐ住所:     %s\n' "$url"
  else
    printf '   繋ぐ住所:     （Tailscale の設定が済むと https://<機械名>.<tailnet名>.ts.net）\n'
  fi
  printf '   端末では:     設定の「サーバー」に住所と合言葉を入れて「繋ぐ」。共有に招く人には住所と share_token.txt の中身だけを渡す\n'
  printf '   更新:         bash %s/tools/server-setup.sh update\n' "$DIR"
}

cmd_install() { need_linux; need_tools; get_code; make_data; run_tests; write_unit; health; tailscale_serve; summary; }
cmd_update()  { need_linux; need_tools; get_code; run_tests; sudo systemctl restart "$SERVICE"; health; summary; }
cmd_status() {
  need_linux; PY="$(command -v python3)"
  sudo systemctl --no-pager status "$SERVICE" | head -5 || true
  health
  command -v tailscale >/dev/null && { sudo tailscale serve status || true; } || warn "Tailscale が入っていません"
  summary
}
cmd_uninstall() {
  need_linux
  sudo systemctl disable --now "$SERVICE" 2>/dev/null || true
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  ok "常駐をやめました。記録と合言葉は $DATA に残っています"
  warn "tailscale serve を止めるなら: sudo tailscale serve status で確かめてから sudo tailscale serve --https=443 off"
}

case "${1:-install}" in
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) die "使い方: bash $0 [install|update|status|uninstall]" ;;
esac
