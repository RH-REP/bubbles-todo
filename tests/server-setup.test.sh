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
[[ "$(grep -c '^import /etc/caddy/sites/\*\.caddy$' "$T/etc/caddy/Caddyfile")" == 1 ]] \
  || fail "Caddyfile に、同じ機械のほかの app の節を読む import の行がちょうど1つ無い"
if grep -q "__" "$T/etc/caddy/Caddyfile"; then fail "Caddyfile に埋め残しがある"; fi
grep -q "_SYSTEMD_UNIT=bubbles-todo.service" "$T/etc/fail2ban/filter.d/bubbles.conf" || fail "fail2ban の filter"
[[ -f "$T/etc/fail2ban/jail.d/bubbles.conf" ]] || fail "fail2ban の jail"
grep -q "住所:         https://bubbles.example.org" <<<"$out" || { echo "$out"; fail "住所が出ない"; }
grep -q "invite-add 自分のスマホ me:1,share" <<<"$out" || fail "自分の端末の招待の手順が出ない"
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

# --- 同じ VM に2つ目の名前で足す（BUBBLES_CADDY=site。2026-11-17） ---
PORT2="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
OLD="$T/home/bubbles-data"
NEW="$T/home/bubbles-lab"
for f in passkeys.json sessions.json invites.json machine_keys.json oauth.json; do echo '[]' > "$OLD/$f"; done
[[ -f "$OLD/state.json" ]] || echo '{"version": 3, "data": {"doc": {}}}' > "$OLD/state.json"
mkdir -p "$OLD/people/2" && echo '{}' > "$OLD/people/2/state.json"
site() { PATH="$T/bin:$PATH" HOME="$T/home" BUBBLES_DIR="$T/code" BUBBLES_DATA="$NEW" BUBBLES_SERVICE=bubbles-lab \
  BUBBLES_PORT="$PORT2" BUBBLES_UNIT_DIR="$T/unit" BUBBLES_ETC="$T/etc" "$@" < /dev/null; }

outc="$(site env BUBBLES_FROM="$OLD" bash "$T/code/tools/server-setup.sh" copy-data 2>&1)" || { echo "$outc"; fail "copy-data が止まった"; }
[[ -f "$NEW/state.json" && -f "$NEW/people/2/state.json" ]] || fail "記録が写っていない"
for f in passkeys.json sessions.json invites.json machine_keys.json oauth.json .setup; do
  [[ ! -e "$NEW/$f" ]] || fail "写してはいけない $f が写った"
done
[[ "$(stat -f %Lp "$NEW" 2>/dev/null || stat -c %a "$NEW")" == 700 ]] || fail "写した先が 700 でない"
if site env BUBBLES_FROM="$OLD" bash "$T/code/tools/server-setup.sh" copy-data >/dev/null 2>&1; then fail "state.json がある先に写し直せた"; fi
pass "copy-data は記録だけを写し（パスキー・通行証・機械の鍵・秘書の許可は写さない）、写した先に記録があれば止まる"

cp "$T/etc/caddy/Caddyfile" "$T/main.before"
cp "$T/etc/fail2ban/filter.d/bubbles.conf" "$T/f2b.before"
: > "$T/calls.log"
outs="$(site env BUBBLES_CADDY=site BUBBLES_DOMAIN=bubbles.app-laboratry.duckdns.org bash "$T/code/tools/server-setup.sh" install 2>&1)" \
  || { echo "$outs"; fail "site の install が止まった"; }
grep -q "http://127.0.0.1:$PORT2/api/health が応えた" <<<"$outs" || { echo "$outs"; fail "site の health"; }
cmp -s "$T/main.before" "$T/etc/caddy/Caddyfile" || fail "site の形で Caddyfile が書き換わった"
s="$T/etc/caddy/sites/bubbles-lab.caddy"
grep -q "^bubbles.app-laboratry.duckdns.org {" "$s" && grep -q "reverse_proxy 127.0.0.1:$PORT2" "$s" || fail "sites/ の節に名前とポートが無い"
if grep -q "__" "$s"; then fail "節に埋め残しがある"; fi
grep -q -- "--origin https://bubbles.app-laboratry.duckdns.org --trust-proxy$" "$T/unit/bubbles-lab.service" || fail "新しい unit の origin"
grep -q "caddy validate" "$T/calls.log" && grep -q "systemctl reload caddy" "$T/calls.log" || fail "validate と reload をしていない"
if grep -q "systemctl restart caddy" "$T/calls.log"; then fail "site の形で Caddy を restart した（ほかの名前も止まる）"; fi
cmp -s "$T/f2b.before" "$T/etc/fail2ban/filter.d/bubbles.conf" || fail "前の bubble の fail2ban の設定が書き換わった"
grep -q "_SYSTEMD_UNIT=bubbles-lab.service" "$T/etc/fail2ban/filter.d/bubbles-lab.conf" && grep -q '^\[bubbles-lab\]$' "$T/etc/fail2ban/jail.d/bubbles-lab.conf" \
  && grep -q '^filter = bubbles-lab$' "$T/etc/fail2ban/jail.d/bubbles-lab.conf" || fail "fail2ban の設定がサービスごとに分かれていない"
grep -q "^CADDY=site$" "$NEW/.setup" || fail ".setup に CADDY=site が無い"
grep -q "BUBBLES_DATA=$NEW BUBBLES_SERVICE=bubbles-lab BUBBLES_PORT=$PORT2 bash .*invite-add 自分のスマホ" <<<"$outs" || { echo "$outs"; fail "打つコマンドに置き場が付いていない"; }
pass "site の形: Caddyfile と前の fail2ban に触れず、sites/ に節を置いて validate → reload する"

: > "$T/calls.log"
outu="$(site bash "$T/code/tools/server-setup.sh" update 2>&1)" || { echo "$outu"; fail "site の update が止まった"; }
cmp -s "$T/main.before" "$T/etc/caddy/Caddyfile" || fail "site の update で Caddyfile が書き換わった"
if grep -q "systemctl restart caddy" "$T/calls.log"; then fail "site の update で Caddy を restart した"; fi
grep -q "test_server_oauth" "$T/code/tools/server-setup.sh" || fail "VM のテストに OAuth のテストが入っていない"
pass "site の update は BUBBLES_CADDY なしでも site の形のまま（oracle_apps の ENV と同じ渡し方）"

# import の行が無い Caddyfile には1行だけ足す。Caddy が設定を断ったら、節も足した行も戻して止まる
grep -v '^import /etc/caddy/sites/' "$T/main.before" > "$T/etc/caddy/Caddyfile"
cp "$T/etc/caddy/Caddyfile" "$T/main.noimport"
cp "$s" "$T/site.before"
printf '#!/bin/sh\necho "caddy $*" >> "%s/calls.log"\n[ "$1" = validate ] && [ -f "%s/caddy_fail" ] && { echo "Error: bad" >&2; exit 1; }\nexit 0\n' "$T" "$T" > "$T/bin/caddy"
chmod +x "$T/bin/caddy"
touch "$T/caddy_fail"
if site env BUBBLES_DOMAIN=other.app-laboratry.duckdns.org bash "$T/code/tools/server-setup.sh" update >/dev/null 2>&1; then fail "Caddy が断っても update が通った"; fi
cmp -s "$T/main.noimport" "$T/etc/caddy/Caddyfile" || fail "断られたあと、足した import の行が戻っていない"
cmp -s "$T/site.before" "$s" || fail "断られたあと、前の節に戻っていない"
rm -f "$T/caddy_fail"
site bash "$T/code/tools/server-setup.sh" update >/dev/null 2>&1 || fail "import の行が無い Caddyfile で update が止まった"
[[ "$(grep -c '^import /etc/caddy/sites/\*\.caddy$' "$T/etc/caddy/Caddyfile")" == 1 ]] || fail "import の行がちょうど1つ足されていない"
pass "import の行が無ければ1行足し、Caddy が断ったら節と足した行を戻して止まる"

outx="$(site bash "$T/code/tools/server-setup.sh" uninstall 2>&1)" || { echo "$outx"; fail "site の uninstall が止まった"; }
[[ ! -f "$s" && ! -f "$T/etc/fail2ban/jail.d/bubbles-lab.conf" ]] || fail "site の uninstall で節か fail2ban の設定が残った"
[[ -f "$T/etc/fail2ban/jail.d/bubbles.conf" && -f "$NEW/state.json" ]] || fail "site の uninstall が前の bubble の設定か記録を消した"
pass "site の uninstall は自分の節と fail2ban の設定だけを外し、記録は残す"

# --- 前の名前の節を転送にする・外す（old-name） ---
cp "$T/main.before" "$T/etc/caddy/Caddyfile"
old() { site env BUBBLES_OLD_DOMAIN="$1" bash "$T/code/tools/server-setup.sh" old-name "$2"; }
old bubbles.example.org redirect >/dev/null 2>&1 || fail "old-name redirect が止まった"
c="$T/etc/caddy/Caddyfile"
grep -q '^	redir https://bubbles.app-laboratry.duckdns.org{uri} 308$' "$c" || fail "転送の行が無い"
if grep -q "reverse_proxy" "$c"; then fail "前の名前の reverse_proxy が残った"; fi
grep -q "default_bind 10.0.0.42" "$c" && [[ "$(grep -c '^import /etc/caddy/sites/\*\.caddy$' "$c")" == 1 ]] || fail "全体の設定か import の行が消えた"
cmp -s "$T/main.before" "$c.before-old-name" || fail "前の形が控えに残っていない"
cp "$T/main.before" "$c"
old bubbles.example.org remove >/dev/null 2>&1 || fail "old-name remove が止まった"
if grep -q "bubbles.example.org" "$c"; then fail "前の名前の節が残った"; fi
grep -q "default_bind 10.0.0.42" "$c" || fail "remove で全体の設定が消えた"
cp "$c" "$T/after.remove"
if old bubbles.example.org remove >/dev/null 2>&1; then fail "節が無いのに通った"; fi
cmp -s "$T/after.remove" "$c" || fail "節が無いときに Caddyfile が変わった"
cp "$T/main.before" "$c"; touch "$T/caddy_fail"
if old bubbles.example.org redirect >/dev/null 2>&1; then fail "Caddy が断っても通った"; fi
cmp -s "$T/main.before" "$c" || fail "Caddy が断ったあと元に戻っていない"
rm -f "$T/caddy_fail"
pass "old-name: 前の名前の節だけを転送・外すに書き換え、無ければ・Caddy が断れば元のまま止まる"

# --- 前の Tailscale の形で立ち上げていた置き場 ---
kill "$(cat "$T/server.pid")" 2>/dev/null || true
rm -f "$T/server.pid"
mkdir -p "$T/old/bubbles-data"
printf 'MODE=tailscale\nDOMAIN=\n' > "$T/old/bubbles-data/.setup"
outo="$(PATH="$T/bin:$PATH" HOME="$T/old" BUBBLES_DIR="$T/code" BUBBLES_DATA="$T/old/bubbles-data" BUBBLES_PORT="$PORT" \
  BUBBLES_UNIT_DIR="$T/unit" BUBBLES_ETC="$T/etc" bash "$T/code/tools/server-setup.sh" update 2>&1 < /dev/null)" && fail "Tailscale の形の置き場で update が通った"
grep -q "Tailscale の形（合言葉）は 2026-10-25 に外しました" <<<"$outo" || { echo "$outo"; fail "わけが出ない"; }
pass "前の Tailscale の形の置き場では、わけ（BUBBLES_DOMAIN を付ける）を出して止まる"

# --- Caddy が無いときの案内は OS ごとに替わる（関数だけを取り出して、偽の os-release で呼ぶ） ---
hint_fn="$(sed -n '/^caddy_install_hint()/,/^}/p' "$ROOT/tools/server-setup.sh")"
hint() { mkdir -p "$T/os/$1"; [[ "$1" == none ]] || printf 'NAME="x"\nID=%s\n' "$1" > "$T/os/$1/os-release"; ETC="$T/os/$1" bash -c "$hint_fn"$'\ncaddy_install_hint'; }
grep -q "Amazon Linux には公式のパッケージがありません" <<<"$(hint amzn)" && grep -q "#static-binaries" <<<"$(hint amzn)" || fail "Amazon Linux で静的バイナリの案内が出ない"
grep -q "#debian-ubuntu-raspbian" <<<"$(hint ubuntu)" || fail "Ubuntu で Debian の手順が出ない"
grep -q "#fedora-redhat-centos" <<<"$(hint rhel)" || fail "RHEL で Fedora/RHEL の手順が出ない"
grep -q "OS に合う手順" <<<"$(hint none)" || fail "os-release が無いときに一般の案内が出ない"
pass "Caddy が無いときの案内は OS ごとに替わる（Amazon Linux は静的バイナリ）"

echo
echo "server-setup: all passed"
