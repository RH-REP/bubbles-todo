#!/usr/bin/env python3
"""Bubbles の記録を置くサーバー（2026-10-23）。Python の標準ライブラリだけで動く。

複数の端末から同じ記録を使うためのもの。app 本体（index.html・css・js・icons）も一緒に配る。
記録はサーバー上の JSON ファイル 1つ（<データの場所>/state.json）。
記録を合わせる計算は端末の側（js/merge.js）がする。ここは「版つきで1つの JSON を
預かる」だけで、中身は読まない。

    python3 server.py                       # http://127.0.0.1:8931/
    python3 server.py --port 8931 --host 127.0.0.1 --data-dir ./data

データの場所:  --data-dir → 環境変数 BUBBLE_TODO_DATA → このファイルの隣の data/
合言葉（無ければ作ってファイルに書く。値は端末で起動したときだけ画面に出す）:
    個人: 環境変数 BUBBLE_TODO_TOKEN → <データの場所>/token.txt   記録は state.json
    共有: 人ごとに1つ。<データの場所>/share_tokens.json（名前と合言葉の組）  記録は share/state.json
          環境変数 BUBBLE_TODO_SHARE_TOKEN も1人ぶんとして通す。前の版の share_token.txt は
          「最初の合言葉」として share_tokens.json へ引き継ぐ
    合言葉が置き場を決める。共有の合言葉だけを知る人は、個人の記録を読めない。
    API（/api/data）は合言葉がどれにも合わないと 401 を返す。
    ファイルを書き換えると、止めずに次の接続から効く（取り消しもすぐ効く）。

合言葉の操作（2026-10-23。止めずに使える）:
    python3 server.py share-add <名前>      共有の合言葉を1人ぶん作る（値はこのときだけ出す）
    python3 server.py share-list            共有の合言葉の一覧（名前・作った日・末尾4文字）
    python3 server.py share-remove <名前>   その人の合言葉を取り消す
    python3 server.py rotate-me             自分の合言葉（個人）を作り直す（各端末に入れ直す）
    どれも --data-dir（または BUBBLE_TODO_DATA）で置き場を選ぶ

API:
    GET /api/health          → {"ok": true}（合言葉は要らない。届くかを見るだけ）
    GET /api/data            → {"space": "me"|"share", "version": n, "data": {...} | null}
                               space はその合言葉の置き場（端末が取り違えに気づくため）
    PUT /api/data            ← {"base": n, "data": {...}}
                               base が今の版と違えば 409 と今の版・中身を返す（上書きしない）
                               同じなら書いて {"version": n+1}
書くたびに前の版を <データの場所>/backup/ に残す（新しいほうから BACKUP_KEEP 個）。

外へ出すときは、このサーバーを 127.0.0.1 で動かしたまま、Tailscale の
`tailscale serve` で HTTPS を付けて同じ tailnet の端末にだけ見せる（README「サーバーに置く」）。
"""
import argparse
import hmac
import http.server
import json
import os
import secrets
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# 配るのは app 本体だけ。.git・.env・data/・DEV_NOTES などは出さない
PUBLIC_FILES = {'index.html', 'manifest.json', 'sw.js'}
PUBLIC_DIRS = {'css', 'js', 'icons', 'docs'}   # docs/ は使い方の記事（スクリーンショットつき）
MAX_BODY = 32 * 1024 * 1024
BACKUP_KEEP = 50

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}


class Store:
    """版つきで JSON を1つ預かる。書き込みは1本ずつ（lock）"""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.path = data_dir / 'state.json'
        self.backup = data_dir / 'backup'
        self.lock = threading.Lock()
        self.dir.mkdir(parents=True, exist_ok=True)

    def read(self):
        if not self.path.exists():
            return {'version': 0, 'data': None}
        with self.path.open(encoding='utf-8') as f:
            return json.load(f)

    def write(self, base, data):
        """(True, 新しい版) か (False, 今の中身)"""
        with self.lock:
            cur = self.read()
            if base != cur['version']:
                return False, cur
            nxt = {'version': cur['version'] + 1, 'data': data, 'savedAt': int(time.time() * 1000)}
            if self.path.exists():
                self._backup()
            # 一時ファイルに書いて fsync してから置き換える（途中で落ちても前の版が残る）
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix='.state.', suffix='.json')
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(nxt, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
            return True, nxt['version']

    def _backup(self):
        self.backup.mkdir(exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S')
        dst = self.backup / f'state-{stamp}-{secrets.token_hex(2)}.json'
        dst.write_bytes(self.path.read_bytes())
        olds = sorted(self.backup.glob('state-*.json'))
        for p in olds[:-BACKUP_KEEP]:
            p.unlink(missing_ok=True)


SPACES = {
    # 置き場: (合言葉の環境変数, 合言葉のファイル, 記録のフォルダ（データの場所から）, 画面に出す名前)
    'me': ('BUBBLE_TODO_TOKEN', 'token.txt', '.', '個人'),
    'share': ('BUBBLE_TODO_SHARE_TOKEN', 'share_token.txt', 'share', '共有'),
}


def load_token(data_dir: Path, space: str = 'me') -> str:
    env_name, file_name, _, label = SPACES[space]
    env = os.environ.get(env_name, '').strip()
    if env:
        return env
    path = data_dir / file_name
    if path.exists():
        tok = path.read_text(encoding='utf-8').strip()
        if tok:
            return tok
    tok = secrets.token_urlsafe(24)
    _write_private(path, tok + '\n')
    # 端末で起動したときだけ値を出す。systemd などでは出力が記録（journal）に残るので、場所だけにする
    _show_token(label, str(path), tok)
    return tok


def _write_private(path: Path, text: str):
    """所有者だけが読める形で、途中で落ちても半端なファイルを残さずに書く"""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _show_token(label: str, where: str, tok: str):
    if sys.stdout.isatty():
        print(f'{label}の合言葉を作りました（{where}）: {tok}', flush=True)
    else:
        print(f'{label}の合言葉を作りました: {where}', flush=True)


class ShareTokens:
    """共有の合言葉の一覧 <データの場所>/share_tokens.json = [{"name","token","created"}]"""

    def __init__(self, data_dir: Path):
        self.path = data_dir / 'share_tokens.json'
        self.legacy = data_dir / 'share_token.txt'

    def read(self):
        if not self.path.exists():
            return []
        with self.path.open(encoding='utf-8') as f:
            rows = json.load(f)
        return [r for r in rows if isinstance(r, dict) and r.get('name') and r.get('token')]

    def write(self, rows):
        _write_private(self.path, json.dumps(rows, ensure_ascii=False, indent=1) + '\n')

    def ensure(self):
        """一覧が無ければ作る。前の版の share_token.txt があれば、それを最初の1人ぶんにする"""
        if self.path.exists():
            return
        today = time.strftime('%Y-%m-%d')
        if self.legacy.exists() and self.legacy.read_text(encoding='utf-8').strip():
            tok = self.legacy.read_text(encoding='utf-8').strip()
            self.write([{'name': '最初の合言葉', 'token': tok, 'created': today}])
            self.legacy.rename(self.legacy.with_suffix('.txt.migrated'))
            print(f'共有の合言葉を {self.path.name} へ引き継ぎました（「最初の合言葉」）', flush=True)
            return
        if os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip():
            self.write([])
            return
        tok = secrets.token_urlsafe(24)
        self.write([{'name': '最初の合言葉', 'token': tok, 'created': today}])
        _show_token('共有', f'{self.path} の「最初の合言葉」', tok)

    def add(self, name: str) -> str:
        name = name.strip()
        if not name:
            raise SystemExit('名前を入れてください（例: share-add 母のスマホ）')
        rows = self.read()
        if any(r['name'] == name for r in rows):
            raise SystemExit(f'「{name}」はもうあります（取り消すなら share-remove {name}）')
        tok = secrets.token_urlsafe(24)
        rows.append({'name': name, 'token': tok, 'created': time.strftime('%Y-%m-%d')})
        self.write(rows)
        return tok

    def remove(self, name: str) -> bool:
        rows = self.read()
        keep = [r for r in rows if r['name'] != name]
        if len(keep) == len(rows):
            return False
        self.write(keep)
        return True


class Spaces:
    """合言葉 → (置き場の名前, Store)。合言葉のファイルが変わったら読み直す（止めずに効く）"""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.stores = {'me': Store(data_dir), 'share': Store(data_dir / 'share')}
        self.shares = ShareTokens(data_dir)
        load_token(data_dir, 'me')
        self.shares.ensure()
        self._key = None
        self._map = {}
        self._lock = threading.Lock()
        self.current()

    def _stamp(self):
        out = []
        for p in (self.dir / 'token.txt', self.shares.path):
            try:
                st = p.stat()
                out.append((st.st_mtime_ns, st.st_size))
            except FileNotFoundError:
                out.append(None)
        return tuple(out)

    def current(self):
        with self._lock:
            key = self._stamp()
            if key == self._key:
                return self._map
            m = {load_token(self.dir, 'me'): ('me', self.stores['me'])}
            shares = [r['token'] for r in self.shares.read()]
            env = os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip()
            if env:
                shares.append(env)
            for tok in shares:
                if tok in m and m[tok][0] == 'me':
                    raise SystemExit('自分の合言葉と同じ共有の合言葉があります。どちらかを作り直してください')
                m[tok] = ('share', self.stores['share'])
            self._key, self._map = key, m
            return m


def open_spaces(data_dir: Path):
    """{合言葉: (置き場の名前, Store)}（今の合言葉で。テストと前の版の呼び方のため）"""
    return Spaces(data_dir).current()


def make_handler(spaces):
    """spaces = {合言葉: (置き場の名前, Store)}、または current() でそれを返すもの（Spaces）"""
    table = spaces.current if hasattr(spaces, 'current') else (lambda: spaces)
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = 'Bubbles'

        def log_message(self, fmt, *args):
            pass  # アクセスログは出さない（記録の中身も出さない）

        # --- 返す ---
        def send(self, code, body=b'', ctype='application/json', extra=None):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            # 合言葉はヘッダで送るのでクッキーは使っていない。どのオリジンから呼ばれても、
            # 合言葉を知らなければ読めない（Android 版は capacitor://localhost から呼ぶ）
            self.send_header('Access-Control-Allow-Origin', '*')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def send_json(self, code, obj):
            self.send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

        def space(self):
            """合言葉に合う (置き場の名前, Store)。合わなければ None。
            比べるのは全部の合言葉と（どれに合ったかで時間が変わらないように）"""
            got = self.headers.get('Authorization', '').encode('utf-8')
            hit = None
            for tok, sp in table().items():
                if hmac.compare_digest(got, ('Bearer ' + tok).encode('utf-8')):
                    hit = sp
            return hit

        # --- 受ける ---
        def do_OPTIONS(self):
            self.send(204, extra={
                'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Max-Age': '600',
            })

        def do_GET(self):
            path = self.path.split('?', 1)[0]
            if path == '/api/health':
                return self.send_json(200, {'ok': True})
            if path == '/api/data':
                sp = self.space()
                if not sp:
                    return self.send_json(401, {'error': 'unauthorized'})
                cur = sp[1].read()
                return self.send_json(200, {'space': sp[0], 'version': cur['version'], 'data': cur['data']})
            if path.startswith('/api/'):
                return self.send_json(404, {'error': 'not found'})
            return self.static(path)

        do_HEAD = do_GET

        def do_PUT(self):
            if self.path.split('?', 1)[0] != '/api/data':
                return self.send_json(404, {'error': 'not found'})
            sp = self.space()
            if not sp:
                return self.send_json(401, {'error': 'unauthorized'})
            store = sp[1]
            try:
                n = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                n = -1
            if n <= 0 or n > MAX_BODY:
                return self.send_json(413 if n > MAX_BODY else 400, {'error': 'bad length'})
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
                base = int(body['base'])
                data = body['data']
                if not isinstance(data, dict) or not isinstance(data.get('doc'), dict):
                    raise ValueError('data.doc')
            except (ValueError, KeyError, TypeError, UnicodeDecodeError):
                return self.send_json(400, {'error': 'bad body'})
            ok, res = store.write(base, data)
            if ok:
                return self.send_json(200, {'version': res})
            return self.send_json(409, {'space': sp[0], 'version': res['version'], 'data': res['data']})

        def static(self, path):
            rel = path.lstrip('/') or 'index.html'
            if rel.endswith('/'):
                rel += 'index.html'
            parts = rel.split('/')
            if '..' in parts or not (rel in PUBLIC_FILES or (len(parts) > 1 and parts[0] in PUBLIC_DIRS)):
                return self.send_json(404, {'error': 'not found'})
            f = (ROOT / rel).resolve()
            if ROOT not in f.parents or not f.is_file():
                return self.send_json(404, {'error': 'not found'})
            ctype = TYPES.get(f.suffix, 'application/octet-stream')
            return self.send(200, f.read_bytes(), ctype)

    return Handler


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def token_command(data_dir: Path, cmd: str, name: str) -> int:
    """合言葉の操作。動いているサーバーは止めなくてよい（次の接続から効く）"""
    shares = ShareTokens(data_dir)
    load_token(data_dir, 'me')
    shares.ensure()
    if cmd == 'share-add':
        tok = shares.add(name)
        _show_token('共有', f'{shares.path} の「{name.strip()}」', tok)
        print('この人には、住所とこの合言葉だけを渡してください', flush=True)
    elif cmd == 'share-list':
        rows = shares.read()
        if not rows:
            print('共有の合言葉はありません（share-add <名前> で作る）')
        for r in rows:
            print(f"{r['name']}\t{r.get('created', '')}\t…{r['token'][-4:]}")
        if os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip():
            print('（ほかに環境変数 BUBBLE_TODO_SHARE_TOKEN の1つ）')
    elif cmd == 'share-remove':
        if not shares.remove(name):
            raise SystemExit(f'「{name}」は見つかりません（share-list で名前を確かめる）')
        print(f'「{name}」の合言葉を取り消しました。その端末は次の接続から入れません', flush=True)
    elif cmd == 'rotate-me':
        if os.environ.get('BUBBLE_TODO_TOKEN', '').strip():
            raise SystemExit('自分の合言葉は環境変数 BUBBLE_TODO_TOKEN から来ています。そちらを替えてください')
        tok = secrets.token_urlsafe(24)
        _write_private(data_dir / 'token.txt', tok + '\n')
        _show_token('個人', str(data_dir / 'token.txt'), tok)
        print('自分の端末すべてで、設定の「自分の合言葉」を入れ直してください', flush=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Bubbles の記録を置くサーバー')
    ap.add_argument('--host', default='127.0.0.1',
                    help='待ち受ける住所（既定 127.0.0.1。外へは tailscale serve で出す）')
    ap.add_argument('--port', type=int, default=int(os.environ.get('BUBBLE_TODO_PORT', '8931')))
    ap.add_argument('--data-dir', default=os.environ.get('BUBBLE_TODO_DATA', str(ROOT / 'data')))
    ap.add_argument('command', nargs='?', default='serve',
                    choices=['serve', 'share-add', 'share-list', 'share-remove', 'rotate-me'],
                    help='serve（既定）か、合言葉の操作')
    ap.add_argument('name', nargs='?', default='', help='share-add / share-remove の名前')
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    if args.command != 'serve':
        return token_command(data_dir, args.command, args.name)
    httpd = Server((args.host, args.port), make_handler(Spaces(data_dir)))
    print(f'Bubbles server: http://{args.host}:{args.port}/  data: {data_dir}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
