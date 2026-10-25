#!/usr/bin/env bash
# tools/server-setup.sh のテスト。Linux のサーバーが無くても走るよう、
# uname・sudo・systemctl・journalctl・caddy・fail2ban-client・ip を偽物に差し替えて、手順を最後まで通す。
#
#   bash tests/server-setup.test.sh
#
# 本物で確かめていないこと: systemd がこのサービスを本当に起動するか、Caddy と fail2ban の本物の動き。
# 2026-10-25: Tailscale の形を外したので、公開の形（パスキー）だけを見る。
# 偽の systemctl は「restart」で server.py を unit の ExecStart どおりに裏で起動する。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
cleanup() { [[ -f "$T/server.pid" ]] && kill "$(cat "$T/server.pid")" 2>/dev/null || true; rm -rf "$T"; }
trap cleanup EXIT
fail() { echo "FAIL - $*"; exit 1; }
pass() { echo "ok   - $*"; }

# --- 作業ツリーの写しを、origin つきの clone にする（git pull --ff-only が通るように） ---
mkdir -p "$T/src"
(cd "$ROOT" && tar --exclude=./node_modules --exclude=./android --exclude=./www --exclude=./.git --exclude=./data -cf - .) | (cd "$T/src" && tar -xf -)
git -C "$T/src" init -q && git -C "$T/src" add -A && git -C "$T/src" -c user.name=t -c user.email=t@t commit -qm snapshot
git clone -q --bare "$T/src" "$T/origin.git"
git clone -q "$T/origin.git" "$T/code"

# --- 偽物 ---
mkdir -p "$T/bin" "$T/unit"
cat > "$T/bin/uname" <<'EOF'
#!/bin/sh
echo Linux
EOF
cat > "$T/bin/sudo" <<'EOF'
#!/bin/sh
exec "$@"
EOF
cat > "$T/bin/journalctl" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$T/bin/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >> "$T/calls.log"
case "\$1" in
  restart)
    [[ -f "$T/unit/\$2.service" ]] || exit 0    # bubbles 以外（fail2ban・caddy）は何もしない
    [[ -f "$T/server.pid" ]] && kill "\$(cat "$T/server.pid")" 2>/dev/null && sleep 0.3
    cmd="\$(sed -n 's/^ExecStart=//p' "$T/unit/\$2.service")"
    nohup \$cmd > "$T/server.log" 2>&1 &
    echo \$! > "$T/server.pid" ;;
esac
exit 0
EOF
printf '#!/bin/sh\necho "1.1.1.1 via 10.0.0.1 dev ens3 src 10.0.0.42 uid 1001"\n' > "$T/bin/ip"
for c in caddy fail2ban-client; do printf '#!/bin/sh\necho "%s $*" >> "%s/calls.log"\n' "$c" "$T" > "$T/bin/$c"; done
chmod +x "$T/bin/"*
mkdir -p "$T/etc/caddy" "$T/etc/fail2ban/filter.d" "$T/etc/fail2ban/jail.d"

run() {
  PATH="$T/bin:$PATH" HOME="$T/home" BUBBLES_DIR="$T/code" BUBBLES_DATA="$T/home/bubbles-data" \
    BUBBLES_PORT="$PORT" BUBBLES_UNIT_DIR="$T/unit" BUBBLES_ETC="$T/etc" "$@" < /dev/null
}
setup() { run bash "$T/code/tools/server-setup.sh" "$@"; }
mkdir -p "$T/home"
u="$T/unit/bubbles-todo.service"

# --- 名前が無ければ断る ---
if setup install >/dev/null 2>&1; then fail "BUBBLES_DOMAIN なしで install が通った"; fi
if run env BUBBLES_DOMAIN='bad;name' bash "$T/code/tools/server-setup.sh" install >/dev/null 2>&1; then fail "おかしな名前でも通った"; fi
pass "名前（BUBBLES_DOMAIN）が無い・おかしいときは断る"

# --- 1回目: 立ち上げ ---
out="$(run env BUBBLES_DOMAIN=bubbles.example.org bash "$T/code/tools/server-setup.sh" install 2>&1)" || { echo "$out"; fail "install が止まった"; }
grep -q "http://127.0.0.1:$PORT/api/health が応えた" <<<"$out" || { echo "$out"; fail "health"; }
pass "install が最後まで通り、サーバーが応えた"

grep -q "^ExecStart=.*server.py --host 127.0.0.1 --port $PORT --data-dir $T/home/bubbles-data --auth passkey --origin https://bubbles.example.org --trust-proxy$" "$u" \
  || fail "unit の ExecStart: $(grep ExecStart "$u")"
grep -q "^ReadWritePaths=$T/home/bubbles-data$" "$u" || fail "unit の ReadWritePaths"
grep -q "^ProtectHome=read-only$" "$u" || fail "unit の ProtectHome"
[[ "$(stat -f %Lp "$T/home/bubbles-data" 2>/dev/null || stat -c %a "$T/home/bubbles-data")" == 700 ]] || fail "置き場が 700 でない"
pass "unit はパスキーの形で 127.0.0.1 だけで待ち受け、書けるのは記録の置き場（700）だけ"

grep -q "^bubbles.example.org {" "$T/etc/caddy/Caddyfile" && grep -q "reverse_proxy 127.0.0.1:$PORT" "$T/etc/caddy/Caddyfile" \
  || fail "Caddyfile に名前とポートが入っていない"
grep -q "default_bind 10.0.0.42" "$T/etc/caddy/Caddyfile" || fail "Caddy が外向きの住所だけで待ち受けていない"
if grep -q "__" "$T/etc/caddy/Caddyfile"; then fail "Caddyfile に埋め残しがある"; fi
grep -q "_SYSTEMD_UNIT=bubbles-todo.service" "$T/etc/fail2ban/filter.d/bubbles.conf" || fail "fail2ban の filter"
[[ -f "$T/etc/fail2ban/jail.d/bubbles.conf" ]] || fail "fail2ban の jail"
grep -q "住所:         https://bubbles.example.org" <<<"$out" || { echo "$out"; fail "住所が出ない"; }
grep -q "invite-add 自分のスマホ me,share" <<<"$out" || fail "最初の端末の招待の手順が出ない"
if grep -qi "tailscale" <<<"$out"; then fail "出力に Tailscale が残っている"; fi
pass "Caddy と fail2ban の設定を置き、住所と招待の手順を出す（Tailscale は出ない）"

auth="$(python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:$PORT/api/auth').read().decode())")"
grep -q '"mode": "passkey"' <<<"$auth" || fail "サーバーがパスキーの形でない: $auth"
outi="$(setup invite-add 母のスマホ share 2>&1)" || { echo "$outi"; fail "invite-add が止まった"; }
grep -Eq "[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}" <<<"$outi" || { echo "$outi"; fail "招待コードが出ない"; }
grep -q "母のスマホ" <<<"$(setup invite-list 2>&1)" || fail "invite-list に出ない"
if setup share-add 母のスマホ >/dev/null 2>&1; then fail "合言葉の操作（share-add）が残っている"; fi
pass "invite-add・invite-list が通り、合言葉の操作は無い"

# --- 2回目・update（名前は覚えている） ---
out2="$(setup install 2>&1)" || { echo "$out2"; fail "2回目の install が止まった"; }
out3="$(setup update 2>&1)" || { echo "$out3"; fail "update が止まった"; }
grep -q "が応えた" <<<"$out3" || fail "update のあと応えない"
grep -q -- "--auth passkey --origin https://bubbles.example.org" "$u" || fail "環境変数なしの update で形が変わった"
pass "2回目も update も、環境変数なしで同じ形のまま通る"

out4="$(setup uninstall 2>&1)" || { echo "$out4"; fail "uninstall が止まった"; }
[[ ! -f "$u" ]] || fail "unit が残った"
[[ -d "$T/home/bubbles-data" ]] || fail "uninstall で記録の置き場が消えた"
pass "uninstall は常駐だけをやめ、記録は残す"

# --- 前の Tailscale の形で立ち上げていた置き場 ---
kill "$(cat "$T/server.pid")" 2>/dev/null || true
rm -f "$T/server.pid"
mkdir -p "$T/old/bubbles-data"
printf 'MODE=tailscale\nDOMAIN=\n' > "$T/old/bubbles-data/.setup"
outo="$(PATH="$T/bin:$PATH" HOME="$T/old" BUBBLES_DIR="$T/code" BUBBLES_DATA="$T/old/bubbles-data" BUBBLES_PORT="$PORT" \
  BUBBLES_UNIT_DIR="$T/unit" BUBBLES_ETC="$T/etc" bash "$T/code/tools/server-setup.sh" update 2>&1 < /dev/null)" && fail "Tailscale の形の置き場で update が通った"
grep -q "Tailscale の形（合言葉）は 2026-10-25 に外しました" <<<"$outo" || { echo "$outo"; fail "わけが出ない"; }
pass "前の Tailscale の形の置き場では、わけ（BUBBLES_DOMAIN を付ける）を出して止まる"

echo
echo "server-setup: all passed"
