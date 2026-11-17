#!/usr/bin/env bash
# Bubbles の記録を置くサーバー（server.py）を、Linux のサーバー（Oracle Cloud など）に公開して立ち上げる。
# 立てたサーバーが預かる海のまとまりを、画面では「海域」と呼ぶ（2026-11-10）。
# 入場はパスキーだけ（合言葉では入れない）。前段に Caddy（HTTPS）、あれば fail2ban。
#
#   git clone https://github.com/RH-REP/bubbles-todo.git
#   BUBBLES_DOMAIN=<名前> bash bubbles-todo/tools/server-setup.sh   # 立ち上げ（2回目からは更新として働く）
#   bash bubbles-todo/tools/server-setup.sh update     # コードを取り込んで起動し直す（名前は覚えている）
#   bash bubbles-todo/tools/server-setup.sh status     # 動いているか・住所
#   bash bubbles-todo/tools/server-setup.sh uninstall  # 常駐をやめる（記録とパスキーは消さない）
#
# 同じ VM に2つ目の bubble を別の名前で足す（2026-11-17。例 bubbles.app-laboratory.duckdns.org）:
#   BUBBLES_CADDY=site にすると、/etc/caddy/Caddyfile を書き直さず、節を /etc/caddy/sites/<サービス名>.caddy に置く
#   （Caddyfile に import /etc/caddy/sites/*.caddy の行が無ければ1行だけ足す）。caddy validate を通してから reload する
#   （通らなければ置いた節を外して止まる）。fail2ban の設定も <サービス名>.conf に分ける。uninstall は節と fail2ban の設定も外す。
#   BUBBLES_CADDY は記録の置き場の .setup.<サービス名> に覚える（update は置き場・サービス・ポートの環境変数だけでよい）。
#   前の住所のサービスと同じ記録の置き場を使ってよい（BUBBLES_DATA を同じにする。server.py はプロセスをまたぐ錠で書く。
#   パスキーは住所ごとに別で、登録の上限〈置き場ごとに 3〉は両方の住所のパスキーを合わせて数える）。
#     BUBBLES_CADDY=site BUBBLES_DOMAIN=bubbles.app-laboratory.duckdns.org BUBBLES_SERVICE=bubbles-lab \
#       BUBBLES_PORT=8933 BUBBLES_DATA=$HOME/bubbles-lab bash bubbles-lab-code/tools/server-setup.sh install
#   前の置き場の記録を写す（パスキー・通行証・招待・機械の鍵・秘書の許可は写さない。名前が変わるとパスキーは使えないため）:
#     BUBBLES_FROM=$HOME/bubbles-public BUBBLES_DATA=$HOME/bubbles-lab bash bubbles-lab-code/tools/server-setup.sh copy-data
#   写す先に state.json があれば何もせずに止まる（上書きしない）。install の前に打つ
#   前の名前を新しい名前へ転送する・外す（Caddyfile の中の前の名前の節だけを書き換える。validate が通らなければ戻す）:
#     BUBBLES_OLD_DOMAIN=bubbles-todo.duckdns.org BUBBLES_DATA=$HOME/bubbles-lab bash bubbles-lab-code/tools/server-setup.sh old-name redirect
#
# 招待とパスキー（止めずに効く）:
#   bash bubbles-todo/tools/server-setup.sh invite-add <名前> [me|me:<番号>|share|<海の ID> をコンマで]   招待コード（1回きり・24時間）
#     個人は人ごと（2026-11-03）。me は新しい人の個人（登録した順の番号）、me:<番号> はその人の2台目。
#     1 番はサーバーを立てた人（持ち主。どの海にも入れる）。自分の端末は me:1。
#     人を招く海は、その海の ID（アプリの「この海の名前・色」に出る）
#   bash bubbles-todo/tools/server-setup.sh invite-list / passkey-list / passkey-remove <名前>
#   bash bubbles-todo/tools/server-setup.sh passkey-person <名前> <番号|new>   そのパスキーをほかの人の個人へ移す
# 海の管理（2026-11-16。アプリからはできない。すべての海に入れる人はいない）:
#   bash bubbles-todo/tools/server-setup.sh sea-list                               海の一覧と入れる端末
#   bash bubbles-todo/tools/server-setup.sh sea-add <名前> [端末の海の ID] [色]    海を作る（ID を入れると端末のその海をサーバーの海にする）
#   bash bubbles-todo/tools/server-setup.sh sea-rename <ID> <名前> / sea-remove <ID>
#   bash bubbles-todo/tools/server-setup.sh passkey-space <端末の名前> add|remove <海の ID>
#   bash bubbles-todo/tools/server-setup.sh request-list                     端末から届いた登録の頼み（字・呼び名）
#   bash bubbles-todo/tools/server-setup.sh request-ok <字> [置き場]          認める（置き場は invite-add と同じ書き方。既定 share）
#   bash bubbles-todo/tools/server-setup.sh request-no <字>                  断る
#   bash bubbles-todo/tools/server-setup.sh limit / limit-set <数>           置き場ごとの登録の上限を見る・変える
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
#   BUBBLES_CADDY    main（既定。/etc/caddy/Caddyfile を雛形で書き直す）か site（/etc/caddy/sites/<サービス名>.caddy だけを置く）
#   BUBBLES_FROM     copy-data で写す元の記録の置き場
#
# 2026-10-25: Tailscale の形（合言葉で入り、tailscale serve で tailnet にだけ見せる）は外した（利用者の指示）。
#   手順と考え方は tech_stack の記録に残し、例のコードはこの repo の履歴（commit 0263e6a まで）にある。
set -euo pipefail

PORT="${BUBBLES_PORT:-8931}"
DATA="${BUBBLES_DATA:-$HOME/bubbles-data}"
REPO="${BUBBLES_REPO:-https://github.com/RH-REP/bubbles-todo.git}"
SERVICE="${BUBBLES_SERVICE:-bubbles-todo}"
UNIT_DIR="${BUBBLES_UNIT_DIR:-/etc/systemd/system}"   # テストのときだけ替える
DOMAIN="${BUBBLES_DOMAIN:-}"
CADDY="${BUBBLES_CADDY:-}"
# 立ち上げたときの名前を覚えておく（update を環境変数なしで走らせても同じ形で立ち上げるため）。
# サービスごとのファイル（.setup.<サービス名>。2026-11-17）。2つのサービス（前の住所と新しい住所）が同じ記録の置き場を
# 使っても、名前と形が混ざらないように。前の版の .setup は、そのサービスのファイルが無いときだけ読む（書くのは新しいほう）
SETUP_FILE="$DATA/.setup.$SERVICE"
SETUP_READ="$SETUP_FILE"
[[ -f "$SETUP_READ" ]] || SETUP_READ="$DATA/.setup"
OLD_MODE=""
if [[ -f "$SETUP_READ" ]]; then
  while IFS='=' read -r k v; do
    case "$k" in MODE) OLD_MODE="$v" ;; DOMAIN) [[ -z "$DOMAIN" ]] && DOMAIN="$v" ;; CADDY) [[ -z "$CADDY" ]] && CADDY="$v" ;; esac
  done < "$SETUP_READ"
fi
CADDY="${CADDY:-main}"
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
  ok "$("$PY" -V 2>&1)（${PY}）、$(git --version)"
}

get_code() {
  say "2. コード（${DIR}）"
  if [[ -d "$DIR/.git" ]]; then
    git -C "$DIR" pull --ff-only
  else
    git clone "$REPO" "$DIR"
  fi
  [[ -f "$DIR/server.py" ]] || die "$DIR に server.py がありません"
  ok "$(git -C "$DIR" log --oneline -1)"
}

make_data() {
  say "3. 記録の置き場（${DATA}）"
  mkdir -p "$DATA"
  chmod 700 "$DATA"
  printf 'MODE=public\nDOMAIN=%s\nCADDY=%s\n' "$DOMAIN" "$CADDY" > "$SETUP_FILE"
  ok "$(ls -ld "$DATA")"
}

run_tests() {
  say "4. server.py のテスト"
  local t="tests/test_server.py tests/test_passkey_crypto.py tests/test_server_public.py tests/test_server_machine.py tests/test_server_oauth.py tests/test_filelock.py"
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
  [[ "$CADDY" == main || "$CADDY" == site ]] || die "BUBBLES_CADDY は main か site（いまは $CADDY）"
  [[ "$SERVICE" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || die "BUBBLES_SERVICE は英小文字・数字・- だけ（いまは $SERVICE）"
}

server_args() { printf -- '--auth passkey --origin https://%s --trust-proxy' "$DOMAIN"; }

write_unit() {
  say "5. 常駐（systemd: ${SERVICE}）"
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

# Caddy の入れ方は OS で違う。Amazon Linux には公式のパッケージが無い（https://caddyserver.com/docs/install に載っていない。2026-10-29）
caddy_install_hint() {
  local id=""
  [[ -r "$ETC/os-release" ]] && id="$(. "$ETC/os-release" && printf '%s' "${ID:-}")"
  case "$id" in
    amzn) printf '%s' "Amazon Linux には公式のパッケージがありません。静的バイナリを入れ（https://caddyserver.com/docs/install#static-binaries）、systemd の unit を手で置いてください（https://caddyserver.com/docs/running#manual-installation）" ;;
    debian|ubuntu|raspbian) printf '%s' "https://caddyserver.com/docs/install#debian-ubuntu-raspbian の手順" ;;
    fedora|rhel|centos|rocky|almalinux) printf '%s' "https://caddyserver.com/docs/install#fedora-redhat-centos の手順" ;;
    *) printf '%s' "https://caddyserver.com/docs/install から OS に合う手順" ;;
  esac
}

public_front() {
  say "6. 前段（Caddy・fail2ban）と、ファイアウォール"
  if command -v caddy >/dev/null && [[ "$CADDY" == site ]]; then
    caddy_site
  elif command -v caddy >/dev/null; then
    local bind
    bind="$(bind_addr)"
    [[ "$bind" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Caddy が待ち受ける住所が分かりません（BUBBLES_BIND=10.0.0.x のように付けて実行し直す）"
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" -e "s/__BIND__/$bind/g" "$DIR/tools/public/Caddyfile.template" | sudo tee "$ETC/caddy/Caddyfile" >/dev/null
    # 前に起動に失敗していると reload は効かないので、起動し直す
    sudo systemctl restart caddy
    if systemctl is-active --quiet caddy 2>/dev/null || [[ -n "${BUBBLES_ETC:-}" ]]; then
      ok "Caddy: $ETC/caddy/Caddyfile（https://$DOMAIN → 127.0.0.1:${PORT}。待ち受けは $bind の 80・443）"
    else
      sudo journalctl -u caddy -n 5 --no-pager >&2 || true
      die "Caddy が起動しません（上の記録を見てください）"
    fi
  else
    warn "Caddy が入っていません。入れてから実行し直してください（$(caddy_install_hint)）"
  fi
  if command -v fail2ban-client >/dev/null; then
    # site の形では、サービスごとに名前を分ける（同じ VM の前の bubble の bubbles.conf を書き換えない）
    local f2b=bubbles
    [[ "$CADDY" == site ]] && f2b="$SERVICE"
    sed -e "s/__SERVICE__/$SERVICE/g" "$DIR/tools/public/fail2ban-filter.conf" | sudo tee "$ETC/fail2ban/filter.d/$f2b.conf" >/dev/null
    sed -e "s/^\[bubbles\]$/[$f2b]/" -e "s/^filter = bubbles$/filter = $f2b/" "$DIR/tools/public/fail2ban-jail.conf" \
      | sudo tee "$ETC/fail2ban/jail.d/$f2b.conf" >/dev/null
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
  warn "  名前（${DOMAIN}）がこのサーバーの公開の IP を指していること（DuckDNS などで）も確かめる"
}

# 同じ VM に2つ目の名前で足す形（BUBBLES_CADDY=site）。Caddyfile は書き直さず、節を sites/ に置く。
# 全体の設定（default_bind・待ち時間）は Caddyfile の側のもの（前の bubble の雛形）がそのまま効く
caddy_site() {
  local main="$ETC/caddy/Caddyfile" dir="$ETC/caddy/sites" site n old="" added=""
  site="$dir/$SERVICE.caddy"
  [[ -f "$main" ]] || die "$main がありません（先に Caddy を入れ、ほかの app の Caddyfile があることを確かめる）"
  n="$(grep -c '^import /etc/caddy/sites/\*\.caddy$' "$main" || true)"
  if [[ "$n" -gt 1 ]]; then die "$main に import /etc/caddy/sites/*.caddy の行が $n 行あります。1行にしてから実行し直してください"; fi
  sudo mkdir -p "$dir"
  if [[ -f "$site" ]]; then old="$(mktemp)"; sudo cat "$site" > "$old"; fi
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$DIR/tools/public/site.caddy.template" | sudo tee "$site" >/dev/null
  if [[ "$n" == 0 ]]; then
    printf '\nimport /etc/caddy/sites/*.caddy\n' | sudo tee -a "$main" >/dev/null
    added=1
  fi
  if ! sudo caddy validate --config "$main" --adapter caddyfile >/dev/null 2>"${TMPDIR:-/tmp}/bubbles-caddy-validate.$$"; then
    cat "${TMPDIR:-/tmp}/bubbles-caddy-validate.$$" >&2 || true
    rm -f "${TMPDIR:-/tmp}/bubbles-caddy-validate.$$"
    if [[ -n "$old" ]]; then sudo install -m 644 "$old" "$site"; else sudo rm -f "$site"; fi
    if [[ -n "$added" ]]; then sudo sed -i.bak '$d' "$main" && sudo sed -i.bak '$d' "$main" && sudo rm -f "$main.bak"; fi
    [[ -n "$old" ]] && rm -f "$old"
    die "Caddy の設定が通りません（上の記録）。置いた節を戻しました"
  fi
  rm -f "${TMPDIR:-/tmp}/bubbles-caddy-validate.$$"
  [[ -n "$old" ]] && rm -f "$old"
  # reload はほかの名前を止めない（restart は全部の名前を一度止める）
  sudo systemctl reload caddy
  ok "Caddy: $site（https://$DOMAIN → 127.0.0.1:${PORT}）${added:+。$main に import の行を足した}"
}

summary() {
  # 既定でない置き場・サービスで立てたときは、打つコマンドに環境変数を付けて出す（付けないと既定の置き場 ~/bubbles-data を触る）
  local PRE=""
  [[ "$DATA" != "$HOME/bubbles-data" ]] && PRE="BUBBLES_DATA=$DATA "
  [[ "$SERVICE" != bubbles-todo ]] && PRE="${PRE}BUBBLES_SERVICE=$SERVICE "
  [[ "$PORT" != 8931 ]] && PRE="${PRE}BUBBLES_PORT=$PORT "
  say "7. できあがり（公開・パスキー）"
  printf '   サービス:     %s（sudo systemctl status %s）\n' "$SERVICE" "$SERVICE"
  if [[ "$CADDY" == site ]]; then
    printf '   Caddy の節:   %s/caddy/sites/%s.caddy（Caddyfile は書き直さない）\n' "$ETC" "$SERVICE"
  fi
  printf '   住所:         https://%s\n' "$DOMAIN"
  printf '   記録:         %s/state.json（個人 1）、%s/people/<番号>/（ほかの人の個人）、%s/share/state.json（共有）、%s/seas/<海の ID>/（作った海）\n' "$DATA" "$DATA" "$DATA" "$DATA"
  printf '   パスキー:     %s/passkeys.json（公開鍵だけ）\n' "$DATA"
  printf '   自分の端末:   %sbash %s/tools/server-setup.sh invite-add 自分のスマホ me:1,share\n' "$PRE" "$DIR"
  printf '                 出たコードを、その端末の Bubbles の設定の「パスキー」に入れて「この端末を登録」\n'
  printf '   人を招く:     %sbash %s/tools/server-setup.sh invite-add <名前> me,<海の ID>（me はその人だけの個人。新しい番号になる）\n' "$PRE" "$DIR"
  printf '   その人の2台目: %sbash %s/tools/server-setup.sh invite-add <名前> me:<番号>（番号は passkey-list に出る）\n' "$PRE" "$DIR"
  printf '   個人を移す:   %sbash %s/tools/server-setup.sh passkey-person <名前> <番号|new>\n' "$PRE" "$DIR"
  printf '   取り消す:     %sbash %s/tools/server-setup.sh passkey-remove <名前>\n' "$PRE" "$DIR"
  printf '   更新:         %sbash %s/tools/server-setup.sh update\n' "$PRE" "$DIR"
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
  if [[ "$CADDY" == site ]]; then
    sudo rm -f "$ETC/caddy/sites/$SERVICE.caddy" "$ETC/fail2ban/filter.d/$SERVICE.conf" "$ETC/fail2ban/jail.d/$SERVICE.conf"
    sudo systemctl reload caddy 2>/dev/null || true
    sudo systemctl restart fail2ban 2>/dev/null || true
    ok "Caddy の節と fail2ban の設定（$SERVICE）を外しました"
  fi
  ok "常駐をやめました。記録とパスキーは $DATA に残っています"
}

# 前の置き場の記録を写す（2026-11-17。名前を変えて立て直すとき）。写すのは記録だけ。
# パスキー（名前に結び付く）・通行証・招待・登録の頼み・機械の鍵・秘書の許可（OAuth）・.setup は写さない
cmd_copy_data() {
  local from="${BUBBLES_FROM:-}" item n=0
  [[ -n "$from" && -d "$from" ]] || die "BUBBLES_FROM=<前の記録の置き場>（例 \$HOME/bubbles-public）を付けてください"
  from="$(cd "$from" && pwd)"
  [[ "$from" != "$(mkdir -p "$DATA" && cd "$DATA" && pwd)" ]] || die "写す元と先が同じです"
  [[ -f "$from/state.json" ]] || die "$from に state.json がありません（記録の置き場か確かめる）"
  [[ ! -e "$DATA/state.json" ]] || die "$DATA にはもう state.json があります（上書きしない。写すなら空の置き場で）"
  say "前の記録を写す（$from → $DATA）"
  chmod 700 "$DATA"
  for item in state.json backup people share seas seas.json limits.json; do
    if [[ -e "$from/$item" ]]; then cp -Rp "$from/$item" "$DATA/"; ok "$item"; n=$((n + 1)); fi
  done
  ok "$n 個を写しました。写さないもの: passkeys.json・sessions.json・invites.json・requests.json・machine_keys.json・oauth.json・.setup*"
  warn "端末は新しい住所で招待コードから登録し直します。gantt・diary の機械の鍵も新しく作ります（machine-add）"
}

# 前の名前の節を始末する（2026-11-17。名前を変えて立て直したあと）。/etc/caddy/Caddyfile の中の
# 「<前の名前> {」から閉じるまでを、転送（redirect：新しい名前へ 308）か、外す（remove）に書き換える。
# 全体の設定と import の行には触れない。caddy validate が通らなければ元に戻して止まる。
# 前の名前のサービスの常駐を止め（oracle-apps remove と uninstall）、Caddyfile を書き直すものが無くなってから打つ
cmd_old_name() {
  local old="${BUBBLES_OLD_DOMAIN:-}" how="${1:-}" main="$ETC/caddy/Caddyfile" bak tmp
  [[ "$old" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "BUBBLES_OLD_DOMAIN=<前の名前>（例 bubbles-todo.duckdns.org）を付けてください"
  [[ "$how" == redirect || "$how" == remove ]] || die "使い方: old-name redirect|remove"
  if [[ "$how" == redirect ]]; then
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "転送する先の名前が分かりません（BUBBLES_DATA を新しい記録の置き場にする）"
    [[ "$old" != "$DOMAIN" ]] || die "前の名前と新しい名前が同じです"
  fi
  [[ -f "$main" ]] || die "$main がありません"
  PY="$(command -v python3)" || die "python3 がありません"
  tmp="$(mktemp)"; bak="$main.before-old-name"
  if ! sudo cat "$main" | "$PY" -c '
import sys
old, how, new = sys.argv[1:4]
lines = sys.stdin.read().split("\n")
start = next((i for i, l in enumerate(lines) if l.strip() == old + " {"), None)
if start is None:
    sys.exit(3)
depth, end = 0, None
for j in range(start, len(lines)):
    depth += lines[j].count("{") - lines[j].count("}")
    if depth == 0:
        end = j
        break
if end is None:
    sys.exit(4)
repl = [old + " {", "\tredir https://" + new + "{uri} 308", "}"] if how == "redirect" else []
sys.stdout.write("\n".join(lines[:start] + repl + lines[end + 1:]))
' "$old" "$how" "$DOMAIN" > "$tmp"; then
    rm -f "$tmp"
    die "$main に「$old {」の節が見つかりません（もう始末したか、名前の綴りを確かめる）"
  fi
  sudo cp -p "$main" "$bak"
  sudo tee "$main" < "$tmp" >/dev/null
  rm -f "$tmp"
  if ! sudo caddy validate --config "$main" --adapter caddyfile >/dev/null; then
    sudo cp -p "$bak" "$main"
    die "Caddy の設定が通りません。$main を元に戻しました"
  fi
  sudo systemctl reload caddy
  if [[ "$how" == redirect ]]; then ok "https://$old は https://$DOMAIN へ転送します（前の形は $bak）"
  else ok "$old の節を外しました（前の形は $bak）。DuckDNS の名前を消すかは別に決める"; fi
}

token_cmd() {
  PY="$(command -v python3)" || die "python3 がありません"
  "$PY" "$DIR/server.py" --data-dir "$DATA" "$@"
}

case "${1:-install}" in
  invite-add) [[ -n "${2:-}" ]] || die "名前を入れてください（例: invite-add 自分のスマホ me:1,share）"; token_cmd invite-add "$2" --space "${3:-share}" ;;
  passkey-person) [[ -n "${2:-}" && -n "${3:-}" ]] || die "名前と移す先を入れてください（例: passkey-person 母のスマホ new）"; token_cmd passkey-person "$2" "$3" ;;
  passkey-remove) [[ -n "${2:-}" ]] || die "名前を入れてください（例: passkey-remove 母のスマホ）"; token_cmd passkey-remove "$2" ;;
  invite-list|passkey-list) token_cmd "$1" ;;
  # 端末からの登録の頼み（Issue #26）と登録の上限。server.py の同じ名前のコマンドをそのまま呼ぶ（Issue #25 の返事で足した）
  request-list|limit) token_cmd "$1" ;;
  sea-list) token_cmd sea-list ;;
  sea-add) [[ -n "${2:-}" ]] || die "名前を入れてください（例: sea-add 家族 [端末の海の ID] [色]）"; token_cmd sea-add "$2" ${3:+--sea-id "$3"} ${4:+--color "$4"} ;;
  sea-rename) [[ -n "${2:-}" && -n "${3:-}" ]] || die "海の ID と新しい名前を入れてください（例: sea-rename sxxxx 家族）"; token_cmd sea-rename "$2" "$3" ;;
  sea-remove) [[ -n "${2:-}" ]] || die "海の ID を入れてください（sea-list で見られる）"; token_cmd sea-remove "$2" ;;
  passkey-space) [[ -n "${2:-}" && -n "${3:-}" && -n "${4:-}" ]] || die "使い方: passkey-space <端末の名前> add|remove <海の ID>"; token_cmd passkey-space "$2" "$3" "$4" ;;
  request-ok) [[ -n "${2:-}" ]] || die "端末の画面に出ている字を入れてください（例: request-ok ABC-DEF me）"; token_cmd request-ok "$2" --space "${3:-share}" ;;
  request-no) [[ -n "${2:-}" ]] || die "端末の画面に出ている字を入れてください（例: request-no ABC-DEF）"; token_cmd request-no "$2" ;;
  limit-set) [[ -n "${2:-}" ]] || die "数を入れてください（例: limit-set 5）"; token_cmd limit-set "$2" ;;
  copy-data) cmd_copy_data ;;
  old-name) cmd_old_name "${2:-}" ;;
  machine-add) [[ -n "${2:-}" ]] || die "名前を入れてください（例: machine-add gantt --key-file ~/gantt-secrets/bubble_key.txt [--read-only]）"
    mname="$2"; shift 2; token_cmd machine-add "$mname" --space me "$@" ;;
  machine-list) token_cmd machine-list ;;
  machine-remove) [[ -n "${2:-}" ]] || die "名前を入れてください（例: machine-remove diary）"; token_cmd machine-remove "$2" ;;
  oauth-list) token_cmd oauth-list ;;
  oauth-revoke) [[ -n "${2:-}" ]] || die "id か all を入れてください（oauth-list で見られる）"; token_cmd oauth-revoke "$2" ;;
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  uninstall) cmd_uninstall ;;
  *) die "使い方: bash $0 [install|update|status|uninstall|copy-data|old-name redirect|remove|machine-add 名前 [--key-file パス] [--read-only]|machine-list|machine-remove 名前|oauth-list|oauth-revoke id|invite-add 名前 [me|me:<番号>|share|海の ID をコンマで]|invite-list|passkey-list|passkey-person 名前 <番号|new>|passkey-space 名前 add|remove ID|sea-list|sea-add 名前 [ID] [色]|sea-rename ID 名前|sea-remove ID|passkey-remove 名前|request-list|request-ok 字 [置き場]|request-no 字|limit|limit-set 数]" ;;
esac
