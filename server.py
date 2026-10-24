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

公開して使う形（--auth passkey。2026-10-24 の開発版。Tailscale を使わない）:
    前段の Caddy で HTTPS にし、このサーバーは 127.0.0.1 のまま。入場はパスキーだけ（合言葉では入れない）。
    python3 server.py --auth passkey --origin https://<名前> --trust-proxy
    python3 server.py invite-add <名前> --space me,share   招待コード（1回きり・24時間）を作る
    python3 server.py passkey-list / passkey-remove <名前> / invite-list
    POST /api/passkey/register/options {invite} → 登録の問題   POST /api/passkey/register {credential} → 通行証
    POST /api/passkey/login/options {}  → 入場の問題           POST /api/passkey/login {credential}    → 通行証
    POST /api/passkey/logout（Authorization: Bearer 通行証）
    /api/data は Authorization: Bearer <通行証> と X-Bubbles-Space: me|share で使う
守り（どちらの形でも）: 接続元ごとの接続数・要求数・入場の失敗の数に上限（guard.py）、1接続の待ちは 15 秒、
    受け取る大きさは 4MB まで、配るページに CSP などのヘッダ、よそのオリジンは決めた相手だけ。
    守りの出来事は標準エラーに「bubbles: auth-fail ip=…」の形で出す（fail2ban が読む。値は出さない）
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

import passkey_crypto as pc
from guard import Guard
from passkey_store import PasskeyStore, SPACES as PASSKEY_SPACES

ROOT = Path(__file__).resolve().parent
# 配るのは app 本体だけ。.git・.env・data/・DEV_NOTES などは出さない
PUBLIC_FILES = {'index.html', 'manifest.json', 'sw.js'}
PUBLIC_DIRS = {'css', 'js', 'icons', 'docs'}   # docs/ は使い方の記事（スクリーンショットつき）
MAX_BODY = 4 * 1024 * 1024   # 記録に見合う大きさ（前は 32MB。大きすぎる要求でメモリを使わせない）
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


LOOPBACK = {'127.0.0.1', '::1'}
# 配るページの守り。外のスクリプト・外への接続・よそのページへの埋め込みを許さない。
# style は 'unsafe-inline'（画面が要素の style を使う。スクリプトほど危なくない）
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
       "frame-ancestors 'none'")


def log_event(kind: str, ip: str, detail: str = ''):
    """守りの出来事を記録（journal）に1行出す。fail2ban がこれを読む。合言葉・通行証の値は出さない"""
    sys.stderr.write(f'bubbles: {kind} ip={ip}{(" " + detail) if detail else ""}\n')
    sys.stderr.flush()


class Config:
    """入場の仕方と守りの設定。token（合言葉。Tailscale の中で使う）か passkey（公開して使う）"""

    def __init__(self, auth='token', origin='', rp_id='', trust_proxy=False, allow_origins=(),
                 guard=None, passkeys=None, stores=None, require_uv=True):
        self.auth, self.origin, self.rp_id = auth, origin, rp_id
        self.trust_proxy = trust_proxy
        self.allow_origins = set(allow_origins)
        self.guard = guard or Guard()
        self.passkeys = passkeys
        self.stores = stores or {}
        self.require_uv = require_uv


def make_handler(spaces, cfg: Config = None):
    """spaces = {合言葉: (置き場の名前, Store)}、または current() でそれを返すもの（Spaces）。
    cfg.auth == 'passkey' なら合言葉では入れず、パスキーで出した通行証だけを通す"""
    cfg = cfg or Config()
    table = spaces.current if hasattr(spaces, 'current') else (lambda: spaces)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = 'Bubbles'
        sys_version = ''
        timeout = 15             # 1つの接続が送ってくるのを待つ長さ（ゆっくり送る攻撃で止められない）

        def log_message(self, fmt, *args):
            pass  # アクセスログは出さない（記録の中身も出さない）

        # --- 誰からか ---
        def ip(self):
            peer = self.client_address[0]
            if cfg.trust_proxy and peer in LOOPBACK:
                # 前段（Caddy）が付けた最後の1つを使う。それより前は送り手が自由に書ける
                xff = self.headers.get('X-Forwarded-For', '')
                if xff.strip():
                    return xff.split(',')[-1].strip()[:64]
            return peer

        # --- 返す ---
        def send(self, code, body=b'', ctype='application/json', extra=None):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            if ctype.startswith('text/html'):
                self.send_header('Content-Security-Policy', CSP)
            # よそのオリジンから呼んでよいのは、決めた相手だけ（既定は Android 版だけ。公開の形では無し）
            origin = self.headers.get('Origin', '')
            if origin and origin in cfg.allow_origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def send_json(self, code, obj):
            self.send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

        def too_many(self):
            return self.send_json(429, {'error': 'too many'}) or False

        def gate(self):
            """要求の数を数える。多すぎたら 429 を返して False"""
            if not cfg.guard.request(self.ip()):
                log_event('rate-limit', self.ip())
                return self.too_many()
            return True

        def deny(self, reason):
            cfg.guard.auth_failed(self.ip())
            log_event('auth-fail', self.ip(), reason)
            return self.send_json(401, {'error': 'unauthorized'})

        def read_json(self):
            try:
                n = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                n = -1
            if n <= 0 or n > MAX_BODY:
                self.send_json(413 if n > MAX_BODY else 400, {'error': 'bad length'})
                return None
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
            except (ValueError, UnicodeDecodeError):
                self.send_json(400, {'error': 'bad body'})
                return None
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'bad body'})
                return None
            return body

        # --- 入場 ---
        def space(self):
            """(置き場の名前, Store)。合わなければ None"""
            got = self.headers.get('Authorization', '')
            if cfg.auth == 'passkey':
                tok = got[7:] if got.startswith('Bearer ') else ''
                allowed = cfg.passkeys.check_session(tok) if tok else None
                want = self.headers.get('X-Bubbles-Space', 'me')
                if not allowed or want not in allowed or want not in cfg.stores:
                    return None
                return want, cfg.stores[want]
            # 比べるのは全部の合言葉と（どれに合ったかで時間が変わらないように）
            got_b = got.encode('utf-8')
            hit = None
            for tok, sp in table().items():
                if hmac.compare_digest(got_b, ('Bearer ' + tok).encode('utf-8')):
                    hit = sp
            return hit

        def authed_space(self):
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            sp = self.space()
            if not sp:
                return self.deny('data')
            return sp

        # --- 受ける ---
        def do_OPTIONS(self):
            if not self.gate():
                return
            self.send(204, extra={
                'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Bubbles-Space',
                'Access-Control-Max-Age': '600',
            })

        def do_GET(self):
            if not self.gate():
                return
            path = self.path.split('?', 1)[0]
            if path == '/api/health':
                return self.send_json(200, {'ok': True})
            if path == '/api/auth':
                return self.send_json(200, {'mode': cfg.auth, 'rp_id': cfg.rp_id if cfg.auth == 'passkey' else ''})
            if path == '/api/data':
                sp = self.authed_space()
                if not sp:
                    return
                cur = sp[1].read()
                return self.send_json(200, {'space': sp[0], 'version': cur['version'], 'data': cur['data']})
            if path.startswith('/api/'):
                return self.send_json(404, {'error': 'not found'})
            return self.static(path)

        do_HEAD = do_GET

        def do_PUT(self):
            if not self.gate():
                return
            if self.path.split('?', 1)[0] != '/api/data':
                return self.send_json(404, {'error': 'not found'})
            sp = self.authed_space()
            if not sp:
                return
            body = self.read_json()
            if body is None:
                return
            try:
                base = int(body['base'])
                data = body['data']
                if not isinstance(data, dict) or not isinstance(data.get('doc'), dict):
                    raise ValueError('data.doc')
            except (ValueError, KeyError, TypeError):
                return self.send_json(400, {'error': 'bad body'})
            ok, res = sp[1].write(base, data)
            if ok:
                return self.send_json(200, {'version': res})
            return self.send_json(409, {'space': sp[0], 'version': res['version'], 'data': res['data']})

        def do_POST(self):
            if not self.gate():
                return
            path = self.path.split('?', 1)[0]
            if cfg.auth != 'passkey' or not path.startswith('/api/passkey/'):
                return self.send_json(404, {'error': 'not found'})
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            body = self.read_json()
            if body is None:
                return
            pk = cfg.passkeys
            try:
                if path == '/api/passkey/register/options':
                    inv = pk.find_invite(body.get('invite', ''))
                    if not inv:
                        return self.deny('invite')
                    chal = pk.new_challenge('create', inv['code_hash'])
                    return self.send_json(200, {'publicKey': {
                        'challenge': chal,
                        'rp': {'id': cfg.rp_id, 'name': 'Bubbles'},
                        'user': {'id': pc.b64u_encode(secrets.token_bytes(16)), 'name': inv['name'], 'displayName': inv['name']},
                        'pubKeyCredParams': [{'type': 'public-key', 'alg': a} for a in pc.SUPPORTED_ALGS],
                        'authenticatorSelection': {'residentKey': 'required', 'requireResidentKey': True,
                                                   'userVerification': 'required'},
                        'attestation': 'none', 'timeout': 120000,
                        'excludeCredentials': [],
                    }})
                if path == '/api/passkey/register':
                    cred = body.get('credential') or {}
                    resp = cred.get('response') or {}
                    cd = pc.b64u_decode(resp.get('clientDataJSON', ''))
                    ch = json.loads(cd.decode('utf-8')).get('challenge', '')
                    got = pk.take_challenge(ch, 'create')
                    if not got:
                        return self.deny('challenge')
                    inv = next((r for r in pk.list_invites() if r['code_hash'] == got['invite_hash']), None)
                    if not inv:
                        return self.deny('invite-used')
                    out = pc.verify_registration(cd, pc.b64u_decode(resp.get('attestationObject', '')),
                                                 challenge=ch, origin=cfg.origin, rp_id=cfg.rp_id,
                                                 require_uv=cfg.require_uv)
                    if not pk.use_invite(inv['code_hash']):
                        return self.deny('invite-used')
                    name = pk.add_passkey(name=inv['name'], spaces=inv['spaces'], cred=out)
                    tok, exp = pk.new_session(out['cred_id'], inv['spaces'])
                    log_event('passkey-registered', self.ip(), f'name={name}')
                    return self.send_json(200, {'session': tok, 'expires': exp, 'spaces': inv['spaces'], 'name': name})
                if path == '/api/passkey/login/options':
                    return self.send_json(200, {'publicKey': {
                        'challenge': pk.new_challenge('get'), 'rpId': cfg.rp_id,
                        'userVerification': 'required', 'timeout': 120000, 'allowCredentials': [],
                    }})
                if path == '/api/passkey/login':
                    cred = body.get('credential') or {}
                    resp = cred.get('response') or {}
                    cd = pc.b64u_decode(resp.get('clientDataJSON', ''))
                    ch = json.loads(cd.decode('utf-8')).get('challenge', '')
                    if not pk.take_challenge(ch, 'get'):
                        return self.deny('challenge')
                    row = pk.find_passkey(str(cred.get('id', '')))
                    if not row:
                        return self.deny('unknown-passkey')
                    count = pc.verify_assertion(public_key=row['public_key'], sign_count=row['sign_count'],
                                                client_data_json=cd,
                                                authenticator_data=pc.b64u_decode(resp.get('authenticatorData', '')),
                                                signature=pc.b64u_decode(resp.get('signature', '')),
                                                challenge=ch, origin=cfg.origin, rp_id=cfg.rp_id,
                                                require_uv=cfg.require_uv)
                    pk.touch_passkey(row['id'], count)
                    tok, exp = pk.new_session(row['id'], row['spaces'])
                    return self.send_json(200, {'session': tok, 'expires': exp, 'spaces': row['spaces'], 'name': row['name']})
                if path == '/api/passkey/logout':
                    got = self.headers.get('Authorization', '')
                    pk.end_session(got[7:] if got.startswith('Bearer ') else '')
                    return self.send_json(200, {'ok': True})
            except (pc.VerifyError, ValueError, KeyError, TypeError, AttributeError) as e:
                return self.deny('passkey ' + type(e).__name__ + ': ' + str(e)[:60])
            return self.send_json(404, {'error': 'not found'})

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
    """接続ごとに1本のスレッド。ただし数を決める（Guard。超えたら読まずに 429 で閉じる）"""
    daemon_threads = True
    allow_reuse_address = True
    guard = None
    trust_proxy = False

    def _per_ip(self, ip):
        # 前段（Caddy）の後ろでは、接続はみな 127.0.0.1 から来る。接続元ごとの数は前段に任せ、全体の数だけを見る
        return not (self.trust_proxy and ip in LOOPBACK)

    def process_request(self, request, client_address):
        g = self.guard or Guard()
        self.guard = g
        ip = client_address[0]
        if not g.open(ip, self._per_ip(ip)):
            try:
                request.sendall(b'HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            log_event('conn-limit', ip)
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.guard.close(client_address[0], self._per_ip(client_address[0]))


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


def passkey_command(data_dir: Path, cmd: str, name: str, space: str) -> int:
    """パスキーの操作（公開の形）。動いているサーバーは止めなくてよい"""
    pk = PasskeyStore(data_dir)
    if cmd == 'invite-add':
        spaces = [s.strip() for s in (space or 'share').split(',') if s.strip()]
        if any(s not in PASSKEY_SPACES for s in spaces):
            raise SystemExit('置き場は me・share・me,share のどれか')
        code = pk.add_invite(name, spaces)
        where = '個人と共有' if set(spaces) == {'me', 'share'} else ('個人' if spaces == ['me'] else '共有')
        print(f'「{name}」の招待コード（{where}。24時間・1回だけ）: {code}', flush=True)
        print('相手には、住所とこのコードを渡す。相手は Bubbles の設定の「パスキー」で登録する', flush=True)
    elif cmd == 'invite-list':
        rows = pk.list_invites()
        if not rows:
            print('使われていない招待コードはありません')
        for r in rows:
            print(f"{r['name']}\t{','.join(r['spaces'])}\t期限 {time.strftime('%m-%d %H:%M', time.localtime(r['expires']))}")
    elif cmd == 'passkey-list':
        rows = pk.passkeys()
        if not rows:
            print('登録したパスキーはありません（invite-add <名前> で招待コードを作る）')
        for r in rows:
            last = time.strftime('%Y-%m-%d', time.localtime(r['last_used'])) if r.get('last_used') else '未使用'
            print(f"{r['name']}\t{','.join(r['spaces'])}\t登録 {time.strftime('%Y-%m-%d', time.localtime(r['created']))}\t最後 {last}")
    elif cmd == 'passkey-remove':
        if not pk.remove_passkey(name):
            raise SystemExit(f'「{name}」は見つかりません（passkey-list で名前を確かめる）')
        print(f'「{name}」のパスキーと通行証を取り消しました。その端末は次の要求から入れません', flush=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Bubbles の記録を置くサーバー')
    ap.add_argument('--host', default='127.0.0.1',
                    help='待ち受ける住所（既定 127.0.0.1。外へは tailscale serve か、前段の Caddy で出す）')
    ap.add_argument('--port', type=int, default=int(os.environ.get('BUBBLE_TODO_PORT', '8931')))
    ap.add_argument('--data-dir', default=os.environ.get('BUBBLE_TODO_DATA', str(ROOT / 'data')))
    ap.add_argument('--auth', choices=['token', 'passkey'], default=os.environ.get('BUBBLE_TODO_AUTH', 'token'),
                    help='token: 合言葉（Tailscale の中で使う） / passkey: パスキーだけ（公開して使う）')
    ap.add_argument('--origin', default=os.environ.get('BUBBLE_TODO_ORIGIN', ''),
                    help='passkey のとき要る。利用者が開く住所（例 https://bubbles.example.org）')
    ap.add_argument('--rp-id', default=os.environ.get('BUBBLE_TODO_RP_ID', ''),
                    help='パスキーを結び付ける名前（既定は --origin の名前）')
    ap.add_argument('--trust-proxy', action='store_true',
                    help='前段（Caddy）の X-Forwarded-For で接続元を数える（127.0.0.1 から来たときだけ）')
    ap.add_argument('--allow-origin', action='append', default=None,
                    help='よそのオリジンから呼んでよい相手（何度でも）。既定は token のとき Android 版、passkey のとき無し')
    ap.add_argument('--space', default='share', help='invite-add の置き場（me / share / me,share）')
    ap.add_argument('command', nargs='?', default='serve',
                    choices=['serve', 'share-add', 'share-list', 'share-remove', 'rotate-me',
                             'invite-add', 'invite-list', 'passkey-list', 'passkey-remove'],
                    help='serve（既定）か、合言葉・パスキーの操作')
    ap.add_argument('name', nargs='?', default='', help='share-add / share-remove / invite-add / passkey-remove の名前')
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    if args.command in ('invite-add', 'invite-list', 'passkey-list', 'passkey-remove'):
        if args.command in ('invite-add', 'passkey-remove') and not args.name.strip():
            raise SystemExit(f'名前を入れてください（例: {args.command} 母のスマホ）')
        return passkey_command(data_dir, args.command, args.name, args.space)
    if args.command != 'serve':
        return token_command(data_dir, args.command, args.name)

    from urllib.parse import urlsplit
    if args.auth == 'passkey':
        u = urlsplit(args.origin)
        local = u.hostname in ('localhost', '127.0.0.1')
        if not u.scheme or not u.hostname or (u.scheme != 'https' and not local):
            raise SystemExit('--auth passkey には --origin https://<名前> が要ります（開発で localhost のときだけ http）')
        origin = f'{u.scheme}://{u.netloc}'
        rp_id = args.rp_id or u.hostname
        if rp_id != u.hostname and not u.hostname.endswith('.' + rp_id):
            raise SystemExit('--rp-id は --origin の名前か、その親の名前にする')
        stores = {'me': Store(data_dir), 'share': Store(data_dir / 'share')}
        cfg = Config(auth='passkey', origin=origin, rp_id=rp_id, trust_proxy=args.trust_proxy,
                     allow_origins=args.allow_origin or (), passkeys=PasskeyStore(data_dir), stores=stores)
        spaces = {}
    else:
        cfg = Config(auth='token', trust_proxy=args.trust_proxy,
                     allow_origins=args.allow_origin if args.allow_origin is not None
                     else ('https://localhost', 'capacitor://localhost'))
        spaces = Spaces(data_dir)
    Server.guard, Server.trust_proxy = cfg.guard, cfg.trust_proxy
    httpd = Server((args.host, args.port), make_handler(spaces, cfg))
    print(f'Bubbles server: http://{args.host}:{args.port}/  data: {data_dir}  auth: {cfg.auth}'
          + (f'  origin: {cfg.origin}  rp_id: {cfg.rp_id}' if cfg.auth == 'passkey' else ''), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
