#!/usr/bin/env bash
# Bubbles の記録を置くサーバー（server.py）を、Linux のサーバー（Oracle Cloud など）に立ち上げる。
#
#   git clone https://github.com/RH-REP/bubbles-todo.git
#   bash bubbles-todo/tools/server-setup.sh            # 立ち上げ（2回目からは更新として働く）
#   bash bubbles-todo/tools/server-setup.sh update     # コードを取り込んで起動し直す
#   bash bubbles-todo/tools/server-setup.sh status     # 動いているか・住所
#   bash bubbles-todo/tools/server-setup.sh uninstall  # 常駐をやめる（記録と合言葉は消さない）
#
# 合言葉（止めずに効く）:
#   bash bubbles-todo/tools/server-setup.sh share-add <名前>     共有に招く人ごとに1つ作る（値はこのときだけ出る）
#   bash bubbles-todo/tools/server-setup.sh share-list           一覧（名前・作った日・末尾4文字）
#   bash bubbles-todo/tools/server-setup.sh share-remove <名前>  その人の合言葉を取り消す
#   bash bubbles-todo/tools/server-setup.sh rotate-me            自分の合言葉を作り直す
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
#   BUBBLES_TAILSCALE_SSH=1      Tailscale SSH を有効にする（tailnet から ssh。そのあとクラウドの 22 番を閉じられる）
#
# 公開して使う形（開発版。2026-10-24。Tailscale を使わない）:
#   BUBBLES_MODE=public BUBBLES_DOMAIN=<名前> bash bubbles-todo/tools/server-setup.sh
#   ・server.py を --auth passkey（パスキーだけで入る）で常駐させる。127.0.0.1 のまま
#   ・前段に Caddy（HTTPS・待ち時間・大きさの上限）。tools/public/Caddyfile.template を /etc/caddy/Caddyfile に書く
#   ・fail2ban があれば、失敗をくり返す接続元を締め出す（tools/public/fail2ban-*.conf）
#   ・ファイアウォールで 80 と 443 を開ける手順を出す（自動では開けない）
#   招待（パスキーの登録に使う。1回きり・24時間）:
#     bash bubbles-todo/tools/server-setup.sh invite-add <名前> [me|share|me,share]
#     bash bubbles-todo/tools/server-setup.sh invite-list / passkey-list / passkey-remove <名前>
#
# 合言葉: 個人は <置き場>/token.txt、共有は <置き場>/share_tokens.json（人ごと。初回に「最初の合言葉」を作る。chmod 600）。
#         共有に招く人には、住所と、その人のぶんの共有の合言葉だけを渡す。token.txt は渡さない。
set -euo pipefail

PORT="${BUBBLES_PORT:-8931}"
DATA="${BUBBLES_DATA:-$HOME/bubbles-data}"
REPO="${BUBBLES_REPO:-https://github.com/RH-REP/bubbles-todo.git}"
SERVICE="${BUBBLES_SERVICE:-bubbles-todo}"
UNIT_DIR="${BUBBLES_UNIT_DIR:-/etc/systemd/system}"   # テストのときだけ替える
MODE="${BUBBLES_MODE:-}"                                # tailscale（合言葉）か public（パスキー）
DOMAIN="${BUBBLES_DOMAIN:-}"
# 立ち上げたときの形を覚えておく（update を環境変数なしで走らせても、公開の形を合言葉の形に戻さないため）
SETUP_FILE="$DATA/.setup"
if [[ -z "$MODE" && -f "$SETUP_FILE" ]]; then
  while IFS='=' read -r k v; do
    case "$k" in MODE) MODE="$v" ;; DOMAIN) [[ -z "$DOMAIN" ]] && DOMAIN="$v" ;; esac
  done < "$SETUP_FILE"
fi
MODE="${MODE:-tailscale}"
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
  printf 'MODE=%s\nDOMAIN=%s\n' "$MODE" "$DOMAIN" > "$SETUP_FILE"
  ok "$(ls -ld "$DATA")"
}

run_tests() {
  say "4. server.py のテスト"
  local t="tests/test_server.py"
  [[ "$MODE" == "public" ]] && t="tests/test_server.py tests/test_passkey_crypto.py tests/test_server_public.py"
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
  if [[ "$MODE" == "public" ]]; then
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "BUBBLES_DOMAIN=<名前>（例 bubbles.example.org）を付けてください"
  elif [[ "$MODE" != "tailscale" ]]; then
    die "BUBBLES_MODE は tailscale か public"
  fi
}

server_args() {
  if [[ "$MODE" == "public" ]]; then
    printf -- '--auth passkey --origin https://%s --trust-proxy' "$DOMAIN"
  fi
}

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
  if [[ "${BUBBLES_TAILSCALE_SSH:-0}" == "1" ]]; then
    sudo tailscale set --ssh && ok "Tailscale SSH を有効にした（入れたら、クラウドのファイアウォールの 22 番を閉じてよい）"
  fi
}

# Caddy が待ち受ける住所。外へ出ていく道の住所（Oracle なら 10.0.0.x の内側の住所。公開の IP はその手前で変換される）。
# 全部の住所で待つと、tailscale serve が使う Tailscale の住所の 443 番とぶつかって起動しない。BUBBLES_BIND で決めてもよい
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
  if [[ "$MODE" == "public" ]]; then
    say "7. できあがり（公開・パスキー）"
    printf '   サービス:     %s（sudo systemctl status %s）\n' "$SERVICE" "$SERVICE"
    printf '   住所:         https://%s\n' "$DOMAIN"
    printf '   記録:         %s/state.json（個人）、%s/share/state.json（共有）\n' "$DATA" "$DATA"
    printf '   パスキー:     %s/passkeys.json（公開鍵だけ）\n' "$DATA"
    printf '   最初の端末:   bash %s/tools/server-setup.sh invite-add 自分のスマホ me,share\n' "$DIR"
    printf '                 出たコードを、その端末の Bubbles の設定の「パスキー」に入れて「この端末を登録」\n'
    printf '   人を招く:     bash %s/tools/server-setup.sh invite-add <名前> share\n' "$DIR"
    printf '   取り消す:     bash %s/tools/server-setup.sh passkey-remove <名前>\n' "$DIR"
    printf '   更新:         BUBBLES_MODE=public BUBBLES_DOMAIN=%s bash %s/tools/server-setup.sh update\n' "$DOMAIN" "$DIR"
    return
  fi
  local url
  url="$(command -v tailscale >/dev/null && ts_url || true)"
  say "7. できあがり"
  printf '   サービス:     %s（sudo systemctl status %s）\n' "$SERVICE" "$SERVICE"
  printf '   記録:         %s/state.json（個人）、%s/share/state.json（共有）\n' "$DATA" "$DATA"
  printf '   合言葉:       %s/token.txt（個人）、%s/share_tokens.json（共有。人ごと）\n' "$DATA" "$DATA"
  printf '                 自分の合言葉を見る: cat %s/token.txt\n' "$DATA"
  printf '                 共有に招く: bash %s/tools/server-setup.sh share-add <名前>（取り消しは share-remove <名前>）\n' "$DIR"
  if [[ -n "$url" ]]; then
    printf '   繋ぐ住所:     %s\n' "$url"
  else
    printf '   繋ぐ住所:     （Tailscale の設定が済むと https://<機械名>.<tailnet名>.ts.net）\n'
  fi
  printf '   端末では:     設定の「サーバー」に住所と合言葉を入れて「繋ぐ」。共有に招く人には住所とその人の共有の合言葉だけを渡す\n'
  printf '   更新:         bash %s/tools/server-setup.sh update\n' "$DIR"
}

front() { if [[ "$MODE" == "public" ]]; then public_front; else tailscale_serve; fi; }
cmd_install() { need_mode; need_linux; need_tools; get_code; make_data; run_tests; write_unit; health; front; summary; }
cmd_update()  { need_mode; need_linux; need_tools; get_code; run_tests; write_unit; health; [[ "$MODE" == "public" ]] && public_front; summary; }
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

token_cmd() {
  PY="$(command -v python3)" || die "python3 がありません"
  "$PY" "$DIR/server.py" --data-dir "$DATA" "$@"
}

case "${1:-install}" in
  share-add|share-remove) [[ -n "${2:-}" ]] || die "名前を入れてください（例: $1 母のスマホ）"; token_cmd "$1" "$2" ;;
  share-list|rotate-me) token_cmd "$1" ;;
  invite-add) [[ -n "${2:-}" ]] || die "名前を入れてください（例: invite-add 自分のスマホ me,share）"; token_cmd invite-add "$2" --space "${3:-share}" ;;
  passkey-remove) [[ -n "${2:-}" ]] || die "名前を入れてください（例: passkey-remove 母のスマホ）"; token_cmd passkey-remove "$2" ;;
  invite-list|passkey-list) token_cmd "$1" ;;
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) die "使い方: bash $0 [install|update|status|uninstall|share-add 名前|share-list|share-remove 名前|rotate-me|invite-add 名前 [me|share|me,share]|invite-list|passkey-list|passkey-remove 名前]" ;;
esac
