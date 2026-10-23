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
for f in token.txt share_token.txt; do
  [[ -f "$T/home/bubbles-data/$f" ]] || fail "$f が無い"
  [[ "$(stat -f %Lp "$T/home/bubbles-data/$f" 2>/dev/null || stat -c %a "$T/home/bubbles-data/$f")" == 600 ]] || fail "$f が 600 でない"
  if grep -qF "$(cat "$T/home/bubbles-data/$f")" "$T/server.log"; then fail "$f の値がサーバーの出力（journal に入るもの）に出た"; fi
done
pass "合言葉2つを作り（600）、値はサーバーの出力に出さない"

grep -q "tailscale serve --bg $PORT" "$T/calls.log" || fail "tailscale serve を呼んでいない"
grep -q "繋ぐ住所:     https://bubbles.tail1234.ts.net$" <<<"$out" || { echo "$out"; fail "住所が出ない"; }
pass "tailscale serve を呼び、繋ぐ住所を出した"

tok="$(cat "$T/home/bubbles-data/share_token.txt")"
space="$(python3 - "$PORT" "$tok" <<'EOF'
import json, sys, urllib.request
r = urllib.request.Request(f'http://127.0.0.1:{sys.argv[1]}/api/data', headers={'Authorization': 'Bearer ' + sys.argv[2]})
print(json.load(urllib.request.urlopen(r))['space'])
EOF
)"
[[ "$space" == share ]] || fail "共有の合言葉で共有の置き場が開かない（$space）"
pass "作った共有の合言葉で、共有の置き場が開く"

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

echo
echo "server-setup: all passed"
