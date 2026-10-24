#!/usr/bin/env bash
# tools/server-setup.sh のテスト。Linux のサーバーが無くても走るよう、
# uname・sudo・systemctl・journalctl・tailscale を偽物に差し替えて、手順を最後まで通す。
#
#   bash tests/server-setup.test.sh
#
# 本物で確かめていないこと: systemd がこのサービスを本当に起動するか、Tailscale の本物の応答。
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
cat > "$T/bin/tailscale" <<EOF
#!/bin/sh
echo "tailscale \$*" >> "$T/calls.log"
case "\$1 \$2" in
  "status --json") echo '{"Self":{"DNSName":"bubbles.tail1234.ts.net."}}' ;;
esac
exit 0
EOF
chmod +x "$T/bin/"*

run() {
  PATH="$T/bin:$PATH" HOME="$T/home" BUBBLES_DIR="$T/code" BUBBLES_DATA="$T/home/bubbles-data" \
    BUBBLES_PORT="$PORT" BUBBLES_UNIT_DIR="$T/unit" bash "$T/code/tools/server-setup.sh" "$@" < /dev/null
}
mkdir -p "$T/home"

# --- 1回目: 立ち上げ ---
out="$(run install 2>&1)" || { echo "$out"; fail "install が止まった"; }
grep -q "http://127.0.0.1:$PORT/api/health が応えた" <<<"$out" || { echo "$out"; fail "health"; }
pass "install が最後まで通り、サーバーが応えた"

u="$T/unit/bubbles-todo.service"
grep -q "^ExecStart=.*server.py --host 127.0.0.1 --port $PORT --data-dir $T/home/bubbles-data$" "$u" || fail "unit の ExecStart: $(grep ExecStart "$u")"
grep -q "^ReadWritePaths=$T/home/bubbles-data$" "$u" || fail "unit の ReadWritePaths"
grep -q "^ProtectHome=read-only$" "$u" || fail "unit の ProtectHome"
pass "unit は 127.0.0.1 で待ち受け、書けるのは記録の置き場だけ"

[[ "$(stat -f %Lp "$T/home/bubbles-data" 2>/dev/null || stat -c %a "$T/home/bubbles-data")" == 700 ]] || fail "置き場が 700 でない"
for f in token.txt share_tokens.json; do
  [[ -f "$T/home/bubbles-data/$f" ]] || fail "$f が無い"
  [[ "$(stat -f %Lp "$T/home/bubbles-data/$f" 2>/dev/null || stat -c %a "$T/home/bubbles-data/$f")" == 600 ]] || fail "$f が 600 でない"
done
for tk in "$(cat "$T/home/bubbles-data/token.txt")" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["token"])' "$T/home/bubbles-data/share_tokens.json")"; do
  if grep -qF "$tk" "$T/server.log"; then fail "合言葉の値がサーバーの出力（journal に入るもの）に出た"; fi
done
pass "合言葉2つを作り（600）、値はサーバーの出力に出さない"

grep -q "tailscale serve --bg $PORT" "$T/calls.log" || fail "tailscale serve を呼んでいない"
grep -q "繋ぐ住所:     https://bubbles.tail1234.ts.net$" <<<"$out" || { echo "$out"; fail "住所が出ない"; }
pass "tailscale serve を呼び、繋ぐ住所を出した"

tok="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["token"])' "$T/home/bubbles-data/share_tokens.json")"
space="$(python3 - "$PORT" "$tok" <<'EOF'
import json, sys, urllib.request
r = urllib.request.Request(f'http://127.0.0.1:{sys.argv[1]}/api/data', headers={'Authorization': 'Bearer ' + sys.argv[2]})
print(json.load(urllib.request.urlopen(r))['space'])
EOF
)"
[[ "$space" == share ]] || fail "共有の合言葉で共有の置き場が開かない（$space）"
pass "作った共有の合言葉で、共有の置き場が開く"

# --- 合言葉の操作（止めずに効く） ---
outa="$(run share-add 母のスマホ 2>&1)" || { echo "$outa"; fail "share-add が止まった"; }
grep -q "母のスマホ" <<<"$(run share-list 2>&1)" || fail "share-list に出ない"
run share-remove 母のスマホ >/dev/null 2>&1 || fail "share-remove が止まった"
if grep -q "母のスマホ" <<<"$(run share-list 2>&1)"; then fail "取り消したのに一覧に残った"; fi
if run share-add >/dev/null 2>&1; then fail "名前なしの share-add が通った"; fi
pass "share-add・share-list・share-remove が通る（名前なしは断る）"

# --- 2回目: 実行し直しても壊れない（合言葉は変わらない） ---
before="$(cat "$T/home/bubbles-data/token.txt")"
out2="$(run install 2>&1)" || { echo "$out2"; fail "2回目の install が止まった"; }
[[ "$(cat "$T/home/bubbles-data/token.txt")" == "$before" ]] || fail "2回目で合言葉が変わった"
pass "2回目も通り、合言葉は変わらない"

out3="$(run update 2>&1)" || { echo "$out3"; fail "update が止まった"; }
grep -q "が応えた" <<<"$out3" || fail "update のあと応えない"
pass "update で起動し直して応えた"

out4="$(run uninstall 2>&1)" || { echo "$out4"; fail "uninstall が止まった"; }
[[ ! -f "$u" ]] || fail "unit が残った"
[[ -f "$T/home/bubbles-data/token.txt" ]] || fail "uninstall で合言葉が消えた"
pass "uninstall は常駐だけをやめ、記録と合言葉は残す"

# --- 公開の形（BUBBLES_MODE=public。パスキー・Caddy・fail2ban） ---
kill "$(cat "$T/server.pid")" 2>/dev/null || true
rm -f "$T/server.pid"
mkdir -p "$T/etc/caddy" "$T/etc/fail2ban/filter.d" "$T/etc/fail2ban/jail.d" "$T/home2"
printf '#!/bin/sh\necho "1.1.1.1 via 10.0.0.1 dev ens3 src 10.0.0.42 uid 1001"\n' > "$T/bin/ip"; chmod +x "$T/bin/ip"
for c in caddy fail2ban-client; do printf '#!/bin/sh\necho "%s $*" >> "%s/calls.log"\n' "$c" "$T" > "$T/bin/$c"; chmod +x "$T/bin/$c"; done
run_public() {
  PATH="$T/bin:$PATH" HOME="$T/home2" BUBBLES_DIR="$T/code" BUBBLES_DATA="$T/home2/bubbles-data" \
    BUBBLES_PORT="$PORT" BUBBLES_UNIT_DIR="$T/unit" BUBBLES_ETC="$T/etc" "$@" < /dev/null
}
outp="$(run_public env BUBBLES_MODE=public BUBBLES_DOMAIN=bubbles.example.org bash "$T/code/tools/server-setup.sh" install 2>&1)" \
  || { echo "$outp"; fail "公開の形の install が止まった"; }
grep -q "が応えた" <<<"$outp" || { echo "$outp"; fail "公開の形で応えない"; }
grep -q -- "--auth passkey --origin https://bubbles.example.org --trust-proxy" "$u" || fail "unit がパスキーの形でない: $(grep ExecStart "$u")"
grep -q "^bubbles.example.org {" "$T/etc/caddy/Caddyfile" && grep -q "reverse_proxy 127.0.0.1:$PORT" "$T/etc/caddy/Caddyfile" \
  || fail "Caddyfile に名前とポートが入っていない"
grep -q "default_bind 10.0.0.42" "$T/etc/caddy/Caddyfile" || fail "Caddy が外向きの住所だけで待ち受けていない（tailscale serve と 443 を取り合う）"
if grep -q "__" "$T/etc/caddy/Caddyfile"; then fail "Caddyfile に埋め残しがある"; fi
grep -q "_SYSTEMD_UNIT=bubbles-todo.service" "$T/etc/fail2ban/filter.d/bubbles.conf" || fail "fail2ban の filter"
[[ -f "$T/etc/fail2ban/jail.d/bubbles.conf" ]] || fail "fail2ban の jail"
if grep -q "tailscale serve" <<<"$(grep -c . "$T/calls.log" >/dev/null; tail -20 "$T/calls.log")"; then :; fi
grep -q "invite-add 自分のスマホ me,share" <<<"$outp" || fail "最初の端末の招待の手順が出ない"
pass "公開の形: パスキーで常駐し、Caddy と fail2ban の設定を置き、招待の手順を出す"

auth="$(curl -s "http://127.0.0.1:$PORT/api/auth" 2>/dev/null || python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:$PORT/api/auth').read().decode())")"
grep -q '"mode": "passkey"' <<<"$auth" || fail "サーバーがパスキーの形でない: $auth"
outi="$(run_public bash "$T/code/tools/server-setup.sh" invite-add 母のスマホ share 2>&1)" || { echo "$outi"; fail "invite-add が止まった"; }
grep -Eq "[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}" <<<"$outi" || { echo "$outi"; fail "招待コードが出ない"; }
grep -q "母のスマホ" <<<"$(run_public bash "$T/code/tools/server-setup.sh" invite-list 2>&1)" || fail "invite-list に出ない"
pass "invite-add・invite-list が通る"

outu="$(run_public bash "$T/code/tools/server-setup.sh" update 2>&1)" || { echo "$outu"; fail "update が止まった"; }
grep -q -- "--auth passkey" "$u" || fail "環境変数なしの update で、公開の形が合言葉の形に戻った"
pass "環境変数なしの update でも、公開の形のまま"

if run_public env BUBBLES_MODE=public BUBBLES_DOMAIN='bad;name' bash "$T/code/tools/server-setup.sh" install >/dev/null 2>&1; then
  fail "おかしな名前でも通った"
fi
pass "おかしな名前（BUBBLES_DOMAIN）は断る"

echo
echo "server-setup: all passed"
