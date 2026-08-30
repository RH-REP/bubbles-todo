#!/usr/bin/env python3
"""デザイン確認用の静的サーバ。開発補助であり、アプリ本体には含まれない。

ES module はブラウザに強くキャッシュされるので no-store を返す。
    python3 serve.py [port]     # 既定 8931
"""
import functools, http.server, socketserver, sys, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # アクセスログは出さない


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT),
                            functools.partial(Handler, directory=ROOT)) as httpd:
    print(f'serving {ROOT} on http://localhost:{PORT}/')
    httpd.serve_forever()
