"""tests/e2e-oauth.mjs が使う試しのサーバー（2026-11-17）。網には出ない。

    python3 tests/e2e_oauth_harness.py <データの場所>

公開の形（--auth passkey）の server.py をこのプロセスの中で立て、相手の名乗り（Client ID Metadata Document）は
偽物が返す（戻る先は、この中で立てる http://127.0.0.1:<port>/cb）。持ち主の招待コードを1つ作り、
{"origin", "invite", "client_id", "callback"} を1行の JSON で標準出力に出す。
戻る先に来た問いは標準出力に {"hit": "<問い>"} の1行で出す。標準入力が閉じたら止まる。
"""
import http.server
import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import oauth_server  # noqa: E402
import server  # noqa: E402
from guard import Guard  # noqa: E402
from passkey_store import PasskeyStore  # noqa: E402

CLIENT = 'https://claude.ai/oauth/fake-client.json'


class Callback(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path, _, q = self.path.partition('?')
        if path == '/cb':           # ブラウザが取りに来る favicon などは数えない
            print(json.dumps({'hit': q}), flush=True)
        body = '<!doctype html><title>cb</title><p>戻ってきた</p>'.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    data = Path(sys.argv[1])
    data.mkdir(parents=True, exist_ok=True)
    cb = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Callback)
    callback = f'http://127.0.0.1:{cb.server_address[1]}/cb'
    threading.Thread(target=cb.serve_forever, daemon=True).start()

    def fetcher(url):
        if url != CLIENT:
            return 404, b''
        return 200, json.dumps({'client_id': CLIENT, 'client_name': '秘書（試し）', 'redirect_uris': [callback],
                                'token_endpoint_auth_method': 'none'}).encode('utf-8')

    pk = PasskeyStore(data)
    httpd = server.Server(('127.0.0.1', 0), None)
    origin = f'http://localhost:{httpd.server_address[1]}'
    guard = Guard()
    oauth = oauth_server.OAuth(data, origin, pk, ['claude.ai'], fetcher=fetcher)
    cfg = server.Config(auth='passkey', origin=origin, rp_id='localhost', guard=guard, passkeys=pk,
                        stores=server.SeaStores(data), sea_list=server.SeaList(data),
                        machines=server.MachineKeys(data), allow_origins=(), oauth=oauth)
    httpd.RequestHandlerClass = server.make_handler({}, cfg)
    httpd.guard = guard
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    invite = pk.add_invite('自分のスマホ', ['me'])
    print(json.dumps({'origin': origin, 'invite': invite, 'client_id': CLIENT, 'callback': callback}), flush=True)
    sys.stdin.read()        # 呼んだ側が閉じるまで動く
    httpd.shutdown()
    cb.shutdown()


if __name__ == '__main__':
    main()
