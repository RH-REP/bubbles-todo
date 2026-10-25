#!/usr/bin/env bash
# Bubbles の記録を置くサーバー（server.py）を、Linux のサーバー（Oracle Cloud など）に公開して立ち上げる。
# 入場はパスキーだけ（合言葉では入れない）。前段に Caddy（HTTPS）、あれば fail2ban。
#
#   git clone https://github.com/RH-REP/bubbles-todo.git
#   BUBBLES_DOMAIN=<名前> bash bubbles-todo/tools/server-setup.sh   # 立ち上げ（2回目からは更新として働く）
#   bash bubbles-todo/tools/server-setup.sh update     # コードを取り込んで起動し直す（名前は覚えている）
#   bash bubbles-todo/tools/server-setup.sh status     # 動いているか・住所
#   bash bubbles-todo/tools/server-setup.sh uninstall  # 常駐をやめる（記録とパスキーは消さない）
#
# 招待とパスキー（止めずに効く）:
#   bash bubbles-todo/tools/server-setup.sh invite-add <名前> [me|share|me,share]   招待コード（1回きり・24時間）
#   bash bubbles-todo/tools/server-setup.sh invite-list / passkey-list / passkey-remove <名前>
#
# すること（install）:
#   1. python3（3.8 以上）と git を確かめる。無ければ dnf / apt で入れる
#   2. このスクリプトの入っている clone を使う（無ければ BUBBLES_REPO から clone）。あれば git pull --ff-only
#   3. 記録の置き場（BUBBLES_DATA）を作る（chmod 700）
#   4. server.py のテストを走らせる
#   5. systemd のサービスを書いて常駐させる。server.py は --auth passkey で 127.0.0.1 だけで待ち受ける
#   6. 前段に Caddy（tools/public/Caddyfile.template を /etc/caddy/Caddyfile に書く）、fail2ban があればその設定。
#      ファイアウォールで 80 と 443 を開ける手順を出す（自動では開けない）
#   7. 住所と、最初の端末の招待の手順を出す
#
# 変えられるもの（環境変数）:
#   BUBBLES_DOMAIN   公開する名前（例 bubbles.example.org。必須。2回目からは覚えている）
#   BUBBLES_PORT     server.py のポート（既定 8931）
#   BUBBLES_DATA     記録とパスキーの置き場（既定 ~/bubbles-data）
#   BUBBLES_DIR      コードの clone（既定 このスクリプトの入っている clone、無ければ ~/bubbles-todo）
#   BUBBLES_REPO     clone する先（既定 https://github.com/RH-REP/bubbles-todo.git）
#   BUBBLES_SERVICE  systemd のサービス名（既定 bubbles-todo）
#   BUBBLES_BIND     Caddy が待ち受ける住所（既定 外へ出ていく道の住所）
#
# 2026-10-25: Tailscale の形（合言葉で入り、tailscale serve で tailnet にだけ見せる）は外した（利用者の指示）。
#   手順と考え方は library/tech_stack の記録に残し、例のコードはこの repo の履歴（commit 0263e6a まで）にある。
set -euo pipefail

PORT="${BUBBLES_PORT:-8931}"
DATA="${BUBBLES_DATA:-$HOME/bubbles-data}"
REPO="${BUBBLES_REPO:-https://github.com/RH-REP/bubbles-todo.git}"
SERVICE="${BUBBLES_SERVICE:-bubbles-todo}"
UNIT_DIR="${BUBBLES_UNIT_DIR:-/etc/systemd/system}"   # テストのときだけ替える
DOMAIN="${BUBBLES_DOMAIN:-}"
# 立ち上げたときの名前を覚えておく（update を環境変数なしで走らせても同じ形で立ち上げるため）
SETUP_FILE="$DATA/.setup"
OLD_MODE=""
if [[ -f "$SETUP_FILE" ]]; then
  while IFS='=' read -r k v; do
    case "$k" in MODE) OLD_MODE="$v" ;; DOMAIN) [[ -z "$DOMAIN" ]] && DOMAIN="$v" ;; esac
  done < "$SETUP_FILE"
fi
ETC="${BUBBLES_ETC:-/etc}"                             # テストのときだけ替える（Caddy・fail2ban の置き場）
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
  printf 'MODE=public\nDOMAIN=%s\n' "$DOMAIN" > "$SETUP_FILE"
  ok "$(ls -ld "$DATA")"
}

run_tests() {
  say "4. server.py のテスト"
  local t="tests/test_server.py tests/test_passkey_crypto.py tests/test_server_public.py"
  local out
  # shellcheck disable=SC2086
  if ! out="$(cd "$DIR" && "$PY" -m unittest $t 2>&1)"; then
    # どのテストが、なぜ落ちたかを出す（合計だけでは原因が分からなかった。2026-10-24）
    printf '%s\n' "$out" | grep -E '^(ERROR|FAIL):|Error:|Exception:|AssertionError' | head -20 >&2
    printf '%s\n' "$out" | grep -v '^bubbles:' | tail -3 >&2
    die "テストが通りません（上の行が、落ちたテストとわけ）"
  fi
  printf '%s\n' "$out" | grep -v '^bubbles:' | tail -3
}

need_mode() {
  if [[ -z "$DOMAIN" && "$OLD_MODE" == "tailscale" ]]; then
    die "Tailscale の形（合言葉）は 2026-10-25 に外しました。公開の形にするなら BUBBLES_DOMAIN=<名前> を付けて実行し直してください（記録はそのまま使えます。端末はパスキーで登録し直します）"
  fi
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "BUBBLES_DOMAIN=<名前>（例 bubbles.example.org）を付けてください"
}

server_args() { printf -- '--auth passkey --origin https://%s --trust-proxy' "$DOMAIN"; }

write_unit() {
  say "5. 常駐（systemd: $SERVICE）"
  local user group tmp extra
  extra="$(server_args)"
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
ExecStart=$PY $DIR/server.py --host 127.0.0.1 --port $PORT --data-dir $DATA${extra:+ $extra}
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

# Caddy が待ち受ける住所。外へ出ていく道の住所（Oracle なら 10.0.0.x の内側の住所。公開の IP はその手前で変換される）。
# 全部の住所で待つと、同じ機械でほかに 443 番を使うもの（VPN の受け口など）とぶつかって起動しないことがある。BUBBLES_BIND で決めてもよい
bind_addr() {
  if [[ -n "${BUBBLES_BIND:-}" ]]; then printf '%s' "$BUBBLES_BIND"; return; fi
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1
}

public_front() {
  say "6. 前段（Caddy・fail2ban）と、ファイアウォール"
  if command -v caddy >/dev/null; then
    local bind
    bind="$(bind_addr)"
    [[ "$bind" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Caddy が待ち受ける住所が分かりません（BUBBLES_BIND=10.0.0.x のように付けて実行し直す）"
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" -e "s/__BIND__/$bind/g" "$DIR/tools/public/Caddyfile.template" | sudo tee "$ETC/caddy/Caddyfile" >/dev/null
    # 前に起動に失敗していると reload は効かないので、起動し直す
    sudo systemctl restart caddy
    if systemctl is-active --quiet caddy 2>/dev/null || [[ -n "${BUBBLES_ETC:-}" ]]; then
      ok "Caddy: $ETC/caddy/Caddyfile（https://$DOMAIN → 127.0.0.1:$PORT。待ち受けは $bind の 80・443）"
    else
      sudo journalctl -u caddy -n 5 --no-pager >&2 || true
      die "Caddy が起動しません（上の記録を見てください）"
    fi
  else
    warn "Caddy が入っていません。入れてから実行し直してください（https://caddyserver.com/docs/install の Debian/Ubuntu の手順）"
  fi
  if command -v fail2ban-client >/dev/null; then
    sed -e "s/__SERVICE__/$SERVICE/g" "$DIR/tools/public/fail2ban-filter.conf" | sudo tee "$ETC/fail2ban/filter.d/bubbles.conf" >/dev/null
    sudo install -m 644 "$DIR/tools/public/fail2ban-jail.conf" "$ETC/fail2ban/jail.d/bubbles.conf"
    sudo systemctl restart fail2ban 2>/dev/null || true
    ok "fail2ban: 失敗をくり返す接続元を1時間締め出す"
  else
    warn "fail2ban が入っていません（入れるなら: sudo apt-get install -y fail2ban のあと実行し直す）"
  fi
  warn "ファイアウォールは自動では開けません。次の2か所で 80 と 443 だけを開けてください:"
  warn "  ・クラウドの側（Oracle の Security List / Network Security Group）"
  warn "  ・サーバーの中（Oracle の Ubuntu は iptables で 22 番以外を閉じていることがある）:"
  warn "      sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT"
  warn "      sudo netfilter-persistent save"
  warn "  名前（$DOMAIN）がこのサーバーの公開の IP を指していること（DuckDNS などで）も確かめる"
}

summary() {
  say "7. できあがり（公開・パスキー）"
  printf '   サービス:     %s（sudo systemctl status %s）\n' "$SERVICE" "$SERVICE"
  printf '   住所:         https://%s\n' "$DOMAIN"
  printf '   記録:         %s/state.json（個人）、%s/share/state.json（共有）\n' "$DATA" "$DATA"
  printf '   パスキー:     %s/passkeys.json（公開鍵だけ）\n' "$DATA"
  printf '   最初の端末:   bash %s/tools/server-setup.sh invite-add 自分のスマホ me,share\n' "$DIR"
  printf '                 出たコードを、その端末の Bubbles の設定の「パスキー」に入れて「この端末を登録」\n'
  printf '   人を招く:     bash %s/tools/server-setup.sh invite-add <名前> share\n' "$DIR"
  printf '   取り消す:     bash %s/tools/server-setup.sh passkey-remove <名前>\n' "$DIR"
  printf '   更新:         bash %s/tools/server-setup.sh update\n' "$DIR"
}

cmd_install() { need_mode; need_linux; need_tools; get_code; make_data; run_tests; write_unit; health; public_front; summary; }
cmd_update()  { need_mode; need_linux; need_tools; get_code; run_tests; write_unit; health; public_front; summary; }
cmd_status() {
  need_linux; PY="$(command -v python3)"
  sudo systemctl --no-pager status "$SERVICE" | head -5 || true
  health
  summary
}
cmd_uninstall() {
  need_linux
  sudo systemctl disable --now "$SERVICE" 2>/dev/null || true
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  ok "常駐をやめました。記録とパスキーは $DATA に残っています"
}

token_cmd() {
  PY="$(command -v python3)" || die "python3 がありません"
  "$PY" "$DIR/server.py" --data-dir "$DATA" "$@"
}

case "${1:-install}" in
  invite-add) [[ -n "${2:-}" ]] || die "名前を入れてください（例: invite-add 自分のスマホ me,share）"; token_cmd invite-add "$2" --space "${3:-share}" ;;
  passkey-remove) [[ -n "${2:-}" ]] || die "名前を入れてください（例: passkey-remove 母のスマホ）"; token_cmd passkey-remove "$2" ;;
  invite-list|passkey-list) token_cmd "$1" ;;
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) die "使い方: bash $0 [install|update|status|uninstall|invite-add 名前 [me|share|me,share]|invite-list|passkey-list|passkey-remove 名前]" ;;
esac
