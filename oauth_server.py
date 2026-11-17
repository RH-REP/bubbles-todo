"""claude.ai の接続（コネクタ「秘書」など）に、持ち主が許した範囲で /mcp を使わせる（2026-11-17）。
OAuth 2.1 の許可のサーバー。server.py が --auth passkey のときだけ使う。Python の標準ライブラリだけで動く。

流れ（MCP 2026-07-28 の authorization）:
    1. 相手（claude.ai）が /mcp を呼び、401 と WWW-Authenticate の resource_metadata を受け取る
    2. /.well-known/oauth-protected-resource/mcp → /.well-known/oauth-authorization-server で窓口を知る
    3. 持ち主のブラウザが /oauth/authorize を開く。相手の名乗り（client_id は https の住所。そこに置いた JSON
       ＝Client ID Metadata Document）を取りに行き、戻る先（redirect_uri）がそこに載っているかを確かめる
    4. 許可の画面で、持ち主がパスキーでログインして「許可」→ 戻る先へ code・state・iss を付けて戻す
    5. 相手が /oauth/token で code と code_verifier（PKCE S256）を出し、通行証（ba_…）と更新の札（bf_…）を受け取る
    6. 相手は通行証で /mcp を使う。期限（1 時間）が来たら更新の札で新しい組に替える（札は使うたびに替わる）

守り:
    ・相手の住所の名前は許した名前だけ（--oauth-client-host。既定 claude.ai）。ほかは取りに行かずに断る
    ・許可できるのは持ち主（1 番の人の個人に入れるパスキー）だけ。そのパスキーを消すと、通行証も更新の札も効かなくなる
    ・<データの場所>/oauth.json（0600）には値を置かない（sha256 だけ）。値は記録（journal）にも出さない
    ・使い終わった code・更新の札をもう一度出されたら、盗まれたとみなし、その許可（grant）ごと取り消す
    ・取り消しは server.py oauth-list / oauth-revoke <id|all>（動いているサーバーに次の要求から効く）
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from filelock import DirLock
from passkey_store import OWNER, person_of

SCOPE = 'todo'
ACCESS_TTL = 3600
REFRESH_TTL = 30 * 24 * 3600
CODE_TTL = 120
PENDING_TTL = 600
PENDING_MAX = 50              # 待っている許可の画面の数（溢れさせない）
CODE_KEEP = 24 * 3600         # 使った code を覚えておく長さ（もう一度出されたら許可ごと取り消すため）
REVOKED_KEEP = 30 * 24 * 3600  # 取り消した許可の行を残す長さ
CIMD_TTL = 3600
CIMD_MAX = 64 * 1024
CIMD_TIMEOUT = 5
NAME_MAX = 100
GRANT_WHAT = 'bubble の個人の記録を読み書きする'
VERIFIER_RE = re.compile(r'^[A-Za-z0-9\-._~]{43,128}$')
CHALLENGE_RE = re.compile(r'^[A-Za-z0-9_-]{43}$')
LOCALHOSTS = {'localhost', '127.0.0.1', '::1'}


def _now() -> int:
    return int(time.time())


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def _write_private(path: Path, text: str):
    """所有者だけが読める形で、途中で落ちても半端なファイルを残さずに書く（server.py と同じ）"""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def is_owner(row) -> bool:
    """許可できるパスキーか。1 番の人（持ち主）の個人に入れるものだけ"""
    return bool(row) and 'me' in (row.get('spaces') or []) and person_of(row) == OWNER


def host_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or '').lower()
    except ValueError:
        return ''


def add_query(url: str, params: dict) -> str:
    """戻る先に問いを足す（もとの問いは残す。値の無いものは足さない）"""
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return url + ('&' if '?' in url else '?') + q


class OAuthError(Exception):
    """/oauth/token の断り。error は RFC 6749 の言葉、reason は記録に出す一言（値は入れない）"""

    def __init__(self, error, reason, description=None):
        super().__init__(reason)
        self.error, self.reason, self.description = error, reason, description


class ClientRefused(Exception):
    """相手の名乗りを受けられない（戻る先へは戻さず、画面で断る）。log は記録に出すなら (種類, 細目)"""

    def __init__(self, message, log=None):
        super().__init__(message)
        self.log = log


class OAuthStore:
    """<データの場所>/oauth.json（0600）= {"grants": [...], "codes": [...], "refresh": [...], "access": [...]}
    grants:  {id, client_id, client_name, redirect_uri, scope, resource, person, cred_id, created, last_used, revoked}
    codes:   {hash, grant, challenge, redirect_uri, redirect_given, expires, used}
    refresh: {hash, grant, expires, used}       access: {hash, grant, expires}
    値は置かない（sha256 だけ）。要求のたびに読み直す（CLI の oauth-revoke が次の要求から効く）"""

    def __init__(self, data_dir: Path, clock=_now):
        self.path = Path(data_dir) / 'oauth.json'
        self.clock = clock
        self.lock = DirLock(Path(data_dir) / '.lock-oauth')   # プロセスをまたぐ錠（2つの server.py・CLI）

    def read(self):
        try:
            d = json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            d = {}
        except (ValueError, OSError, UnicodeDecodeError):
            d = {}      # 読めなければ、どの通行証も効かない
        if not isinstance(d, dict):
            d = {}
        return {k: [r for r in (d.get(k) or []) if isinstance(r, dict)] if isinstance(d.get(k), list) else []
                for k in ('grants', 'codes', 'refresh', 'access')}

    def write(self, d):
        now = self.clock()
        d['codes'] = [r for r in d['codes'] if r['expires'] + (CODE_KEEP if r.get('used') else 0) > now]
        d['refresh'] = [r for r in d['refresh'] if r['expires'] > now]
        d['access'] = [r for r in d['access'] if r['expires'] > now]
        live = {r['grant'] for k in ('codes', 'refresh', 'access') for r in d[k] if not r.get('used')}
        d['grants'] = [g for g in d['grants']
                       if (g.get('revoked') and g['revoked'] + REVOKED_KEEP > now)
                       or (not g.get('revoked') and g['id'] in live)]
        _write_private(self.path, json.dumps(d, ensure_ascii=False, indent=1) + '\n')

    @staticmethod
    def find(rows, value):
        """値 → 行。比べるのは全部の行と、時間の一定な比較で"""
        h = _sha(value).encode('ascii')
        hit = None
        for r in rows:
            if hmac.compare_digest(h, str(r.get('hash', '')).encode('utf-8', 'replace')):
                hit = r
        return hit

    @staticmethod
    def _revoke_in(d, gid, now):
        for g in d['grants']:
            if g['id'] == gid and not g.get('revoked'):
                g['revoked'] = now
        for k in ('codes', 'refresh', 'access'):
            d[k] = [r for r in d[k] if r['grant'] != gid or (k == 'codes' and r.get('used'))]

    def revoke(self, which: str) -> int:
        """許可を取り消す（id か 'all'）。取り消した数"""
        with self.lock:
            d = self.read()
            now = self.clock()
            ids = [g['id'] for g in d['grants'] if not g.get('revoked') and (which == 'all' or g['id'] == which)]
            for gid in ids:
                self._revoke_in(d, gid, now)
            if ids:
                self.write(d)
            return len(ids)

    def grants(self):
        """取り消していない許可と、その更新の札の期限（いちばん遅いもの）"""
        d = self.read()
        now = self.clock()
        out = []
        for g in d['grants']:
            if g.get('revoked'):
                continue
            exp = [r['expires'] for r in d['refresh'] if r['grant'] == g['id'] and not r.get('used') and r['expires'] > now]
            out.append(dict(g, refresh_expires=max(exp) if exp else None))
        return out


class OAuth:
    """許可のサーバーの中身。server.py の Handler が呼ぶ。
    fetcher(url) → (status, bytes) は相手の名乗りを取りに行くもの（テストでは偽物を入れる）"""

    def __init__(self, data_dir: Path, origin: str, passkeys, client_hosts=('claude.ai',), fetcher=None, clock=_now):
        self.origin = origin.rstrip('/')
        self.issuer = self.origin
        self.resource = self.origin + '/mcp'
        self.passkeys = passkeys
        self.client_hosts = {h.strip().lower() for h in client_hosts if h and h.strip()}
        self.fetcher = fetcher or fetch_cimd
        self.clock = clock
        self.store = OAuthStore(data_dir, clock)
        self.pending = {}
        self.cimd = {}          # client_id → (期限, 名乗り)
        self.lock = threading.Lock()

    # --- 案内（metadata） ---
    def as_metadata(self):
        return {
            'issuer': self.issuer,
            'authorization_endpoint': self.origin + '/oauth/authorize',
            'token_endpoint': self.origin + '/oauth/token',
            'response_types_supported': ['code'],
            'grant_types_supported': ['authorization_code', 'refresh_token'],
            'code_challenge_methods_supported': ['S256'],
            'token_endpoint_auth_methods_supported': ['none'],
            'scopes_supported': [SCOPE],
            'client_id_metadata_document_supported': True,
            'authorization_response_iss_parameter_supported': True,
        }

    def pr_metadata(self, root=False):
        """RFC 9728。/mcp の案内は resource を /mcp に、根の案内は根にする（§3.3: 取りに来た住所と合わせる）"""
        return {
            'resource': self.origin if root else self.resource,
            'authorization_servers': [self.issuer],
            'scopes_supported': [SCOPE],
            'bearer_methods_supported': ['header'],
            'resource_name': 'Bubbles',
        }

    def challenge_header(self, error=None):
        h = f'Bearer resource_metadata="{self.origin}/.well-known/oauth-protected-resource/mcp", scope="{SCOPE}"'
        return h + (f', error="{error}"' if error else '')

    # --- 言葉の確かめ ---
    def norm_resource(self, value):
        """resource の値 → 正しい /mcp の住所。合わなければ None。無ければ /mcp"""
        if value is None or value == '':
            return self.resource
        try:
            u = urlsplit(value)
            mine = urlsplit(self.origin)
        except ValueError:
            return None
        if u.fragment or '#' in value or u.query or u.username or u.password:
            return None
        if (u.scheme.lower(), u.netloc.lower()) != (mine.scheme.lower(), mine.netloc.lower()):
            return None
        if u.path.rstrip('/') in ('', '/mcp'):
            return self.resource
        return None

    @staticmethod
    def norm_scope(value):
        """scope → 'todo'。offline_access は聞き流す。知らない言葉があれば None"""
        words = set((value or '').split())
        words.discard('offline_access')
        if words - {SCOPE}:
            return None
        return SCOPE

    # --- 相手の名乗り（Client ID Metadata Document） ---
    def client(self, client_id: str):
        """client_id → {client_id, name, redirect_uris}。受けられなければ ClientRefused"""
        if not client_id or len(client_id) > 2000:
            raise ClientRefused('相手の名乗り（client_id）がありません')
        try:
            u = urlsplit(client_id)
            port = u.port
        except ValueError:
            raise ClientRefused('相手の名乗り（client_id）が住所の形ではありません') from None
        segs = u.path.split('/')
        if (u.scheme != 'https' or not u.hostname or u.username is not None or u.password is not None
                or '@' in u.netloc or u.fragment or '#' in client_id or port not in (None, 443)
                or u.path in ('', '/') or '.' in segs or '..' in segs):
            raise ClientRefused('相手の名乗り（client_id）は https の住所でなければなりません')
        host = u.hostname.lower()
        if not re.fullmatch(r'[a-z0-9.\-]{1,253}', host):
            raise ClientRefused('相手の名乗り（client_id）の名前が読めません')
        if host not in self.client_hosts:
            # 取りに行かない。持ち主が許す名前を知れるよう、名前だけ記録に出す
            raise ClientRefused(f'この相手（{host}）からの接続は許していません。'
                                f'許すならサーバーの --oauth-client-host {host} で足してください',
                                log=('oauth-client-refused', f'host={host}'))
        now = self.clock()
        with self.lock:
            hit = self.cimd.get(client_id)
            if hit and hit[0] > now:
                return hit[1]
        try:
            status, body = self.fetcher(client_id)
        except Exception as e:          # 届かない・時間切れなど
            raise ClientRefused('相手の名乗りを取りに行けませんでした',
                                log=('oauth-client-fetch', f'host={host} {type(e).__name__}')) from None
        if status != 200 or body is None or len(body) > CIMD_MAX:
            raise ClientRefused('相手の名乗りを読めませんでした', log=('oauth-client-fetch', f'host={host} status={status}'))
        try:
            doc = json.loads(body.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise ClientRefused('相手の名乗りが JSON ではありません', log=('oauth-client-bad', f'host={host} json')) from None
        if not isinstance(doc, dict) or doc.get('client_id') != client_id:
            raise ClientRefused('相手の名乗りの client_id が住所と合いません', log=('oauth-client-bad', f'host={host} client_id'))
        uris = doc.get('redirect_uris')
        if not isinstance(uris, list) or not all(isinstance(x, str) for x in uris):
            raise ClientRefused('相手の名乗りに戻る先（redirect_uris）がありません', log=('oauth-client-bad', f'host={host} redirect_uris'))
        if doc.get('token_endpoint_auth_method', 'none') != 'none':
            raise ClientRefused('秘密の鍵を使う相手は受けられません（token_endpoint_auth_method は none だけ）',
                                log=('oauth-client-bad', f'host={host} auth_method'))
        name = doc.get('client_name')
        name = name.strip()[:NAME_MAX] if isinstance(name, str) and name.strip() else host
        c = {'client_id': client_id, 'name': name, 'redirect_uris': [x for x in uris if self.ok_redirect(x)]}
        with self.lock:
            self.cimd = {k: v for k, v in self.cimd.items() if v[0] > now}
            self.cimd[client_id] = (now + CIMD_TTL, c)
        return c

    @staticmethod
    def ok_redirect(uri: str) -> bool:
        """戻る先として受ける形か。https か、この機械（localhost）の http だけ。# は付けない"""
        try:
            u = urlsplit(uri)
            u.port
        except ValueError:
            return False
        if u.fragment or '#' in uri or not u.hostname or u.username is not None:
            return False
        return u.scheme == 'https' or (u.scheme == 'http' and u.hostname.lower() in LOCALHOSTS)

    # --- /oauth/authorize ---
    def authorize(self, params: dict):
        """params は {名前: [値, ...]}。返すのは (記録に出す [(種類, 細目)], 答え)。
        答えは ('page', status, html) か ('redirect', url)。client_id と戻る先が確かめられないうちは戻さない"""
        logs = []

        def one(k):
            v = params.get(k)
            return v[0] if v else None

        for k in ('client_id', 'redirect_uri'):
            if len(params.get(k) or []) > 1:
                return logs, ('page', 400, self.error_page(f'{k} が2つあります'))
        try:
            c = self.client(one('client_id') or '')
        except ClientRefused as e:
            if e.log:
                logs.append(e.log)
            return logs, ('page', 400, self.error_page(str(e)))
        redirect = one('redirect_uri')
        given = redirect is not None
        if redirect is None:
            if len(c['redirect_uris']) != 1:
                return logs, ('page', 400, self.error_page('戻る先（redirect_uri）がありません'))
            redirect = c['redirect_uris'][0]
        elif redirect not in c['redirect_uris']:
            logs.append(('oauth-client-bad', f'host={host_of(c["client_id"])} redirect_uri'))
            return logs, ('page', 400, self.error_page('戻る先（redirect_uri）が相手の名乗りに載っていません'))
        state = one('state')

        def back(error, desc=None):
            return logs, ('redirect', add_query(redirect, {'error': error, 'error_description': desc,
                                                           'state': state, 'iss': self.issuer}))

        if any(len(v) > 1 for v in params.values()):
            return back('invalid_request', 'repeated parameter')
        if one('response_type') != 'code':
            return back('unsupported_response_type')
        if one('code_challenge_method') != 'S256' or not CHALLENGE_RE.match(one('code_challenge') or ''):
            return back('invalid_request', 'PKCE S256 required')
        scope = self.norm_scope(one('scope'))
        if scope is None:
            return back('invalid_scope')
        resource = self.norm_resource(one('resource'))
        if resource is None:
            return back('invalid_target')
        now = self.clock()
        with self.lock:
            self.pending = {k: v for k, v in self.pending.items() if v['expires'] > now}
            if len(self.pending) >= PENDING_MAX:
                return logs, ('page', 429, self.error_page('待っている許可の画面が多すぎます。しばらくしてからやり直してください'))
            rid = secrets.token_urlsafe(24)
            self.pending[rid] = {'client_id': c['client_id'], 'client_name': c['name'], 'redirect_uri': redirect,
                                 'redirect_given': given, 'state': state, 'challenge': one('code_challenge'),
                                 'scope': scope, 'resource': resource, 'expires': now + PENDING_TTL}
        return logs, ('page', 200, self.consent_page(rid, c, redirect))

    def peek(self, rid):
        with self.lock:
            p = self.pending.get(rid) if isinstance(rid, str) else None
            return p if p and p['expires'] > self.clock() else None

    def take(self, rid):
        with self.lock:
            p = self.pending.pop(rid, None) if isinstance(rid, str) else None
            return p if p and p['expires'] > self.clock() else None

    def approve(self, rid, row):
        """持ち主のパスキー（row）で許す → 戻る先（code・state・iss つき）。頼みが無ければ None"""
        p = self.take(rid)
        if not p:
            return None
        code = 'bc_' + secrets.token_urlsafe(32)
        now = self.clock()
        gid = 'g_' + secrets.token_hex(4)
        with self.store.lock:
            d = self.store.read()
            while any(g['id'] == gid for g in d['grants']):
                gid = 'g_' + secrets.token_hex(4)
            d['grants'].append({'id': gid, 'client_id': p['client_id'], 'client_name': p['client_name'],
                                'redirect_uri': p['redirect_uri'], 'scope': p['scope'], 'resource': p['resource'],
                                'person': OWNER, 'cred_id': row['id'], 'created': now, 'last_used': None,
                                'revoked': None})
            d['codes'].append({'hash': _sha(code), 'grant': gid, 'challenge': p['challenge'],
                               'redirect_uri': p['redirect_uri'], 'redirect_given': p['redirect_given'],
                               'expires': now + CODE_TTL, 'used': False})
            self.store.write(d)
        return add_query(p['redirect_uri'], {'code': code, 'state': p['state'], 'iss': self.issuer})

    def deny(self, rid):
        p = self.take(rid)
        if not p:
            return None
        return add_query(p['redirect_uri'], {'error': 'access_denied', 'state': p['state'], 'iss': self.issuer})

    # --- /oauth/token ---
    def token(self, form: dict):
        """form は {名前: [値, ...]}。返すのは (通行証の答え, [])。断るときは OAuthError"""
        if any(len(v) > 1 for v in form.values()):
            raise OAuthError('invalid_request', 'repeated')
        f = {k: v[0] for k, v in form.items()}
        gt = f.get('grant_type')
        if not gt:
            raise OAuthError('invalid_request', 'no-grant-type')
        if gt == 'authorization_code':
            return self._code(f)
        if gt == 'refresh_token':
            return self._refresh(f)
        raise OAuthError('unsupported_grant_type', 'grant-type')

    def _issue(self, d, gid, now):
        access = 'ba_' + secrets.token_urlsafe(32)
        refresh = 'bf_' + secrets.token_urlsafe(32)
        d['access'].append({'hash': _sha(access), 'grant': gid, 'expires': now + ACCESS_TTL})
        d['refresh'].append({'hash': _sha(refresh), 'grant': gid, 'expires': now + REFRESH_TTL, 'used': False})
        g = next(x for x in d['grants'] if x['id'] == gid)
        g['last_used'] = now
        return {'access_token': access, 'token_type': 'Bearer', 'expires_in': ACCESS_TTL,
                'refresh_token': refresh, 'scope': g['scope']}

    def _grant_ok(self, g):
        """許可がまだ生きていて、許したパスキーがまだ持ち主のものか"""
        if not g or g.get('revoked') or g.get('resource') != self.resource:
            return False
        return is_owner(self.passkeys.find_passkey(g.get('cred_id', '')))

    def _code(self, f):
        code = f.get('code') or ''
        if not code:
            raise OAuthError('invalid_request', 'no-code')
        with self.store.lock:
            d = self.store.read()
            now = self.clock()
            row = self.store.find(d['codes'], code)
            if not row:
                raise OAuthError('invalid_grant', 'code-unknown')
            if row.get('used'):
                # 使った code をもう一度。盗まれたとみなし、その code から出した許可ごと取り消す
                self.store._revoke_in(d, row['grant'], now)
                self.store.write(d)
                raise OAuthError('invalid_grant', 'code-reuse')
            row['used'] = True          # 合っても合わなくても、1度出されたら使えない
            g = next((x for x in d['grants'] if x['id'] == row['grant']), None)
            try:
                if row['expires'] <= now:
                    raise OAuthError('invalid_grant', 'code-expired')
                if not f.get('client_id'):
                    raise OAuthError('invalid_client', 'no-client-id')
                if not g or f['client_id'] != g['client_id']:
                    raise OAuthError('invalid_grant', 'client-mismatch')
                if 'redirect_uri' in f or row.get('redirect_given'):
                    if f.get('redirect_uri') != row['redirect_uri']:
                        raise OAuthError('invalid_grant', 'redirect-mismatch')
                verifier = f.get('code_verifier') or ''
                if not VERIFIER_RE.match(verifier):
                    raise OAuthError('invalid_grant', 'verifier-form')
                got = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=')
                if not hmac.compare_digest(got, str(row['challenge']).encode('ascii', 'replace')):
                    raise OAuthError('invalid_grant', 'verifier')
                if 'resource' in f and self.norm_resource(f['resource']) != g['resource']:
                    raise OAuthError('invalid_target', 'resource')
                if not self._grant_ok(g):
                    raise OAuthError('invalid_grant', 'grant')
                out = self._issue(d, g['id'], now)
            finally:
                self.store.write(d)
        return out, []

    def _refresh(self, f):
        tok = f.get('refresh_token') or ''
        if not tok:
            raise OAuthError('invalid_request', 'no-refresh')
        with self.store.lock:
            d = self.store.read()
            now = self.clock()
            row = self.store.find(d['refresh'], tok)
            if not row:
                raise OAuthError('invalid_grant', 'refresh-unknown')
            if row.get('used'):
                # 使った更新の札をもう一度。盗まれたとみなし、許可ごと取り消す
                self.store._revoke_in(d, row['grant'], now)
                self.store.write(d)
                raise OAuthError('invalid_grant', 'refresh-reuse')
            if row['expires'] <= now:
                raise OAuthError('invalid_grant', 'refresh-expired')
            g = next((x for x in d['grants'] if x['id'] == row['grant']), None)
            if not f.get('client_id'):
                raise OAuthError('invalid_client', 'no-client-id')
            if not g or f['client_id'] != g['client_id']:
                raise OAuthError('invalid_grant', 'client-mismatch')
            if 'scope' in f and self.norm_scope(f['scope']) is None:
                raise OAuthError('invalid_scope', 'scope')
            if 'resource' in f and self.norm_resource(f['resource']) != g['resource']:
                raise OAuthError('invalid_target', 'resource')
            if not self._grant_ok(g):
                self.store._revoke_in(d, g['id'], now)
                self.store.write(d)
                raise OAuthError('invalid_grant', 'grant')
            row['used'] = True          # 札は使うたびに替える（前の札は使えない）
            out = self._issue(d, g['id'], now)
            self.store.write(d)
        return out, []

    # --- /mcp ---
    def check_access(self, tok: str):
        """通行証 → (許可の行, None) か (None, 理由)。理由は 'expired'（期限切れ。いつものこと）か 'invalid'"""
        if not tok.startswith('ba_') or len(tok) > 200:
            return None, 'invalid'
        d = self.store.read()
        now = self.clock()
        row = self.store.find(d['access'], tok)
        if not row:
            return None, 'invalid'
        g = next((x for x in d['grants'] if x['id'] == row['grant']), None)
        if not self._grant_ok(g):
            return None, 'invalid'
        if row['expires'] <= now:
            return None, 'expired'
        if not g.get('last_used') or now - g['last_used'] >= 60:   # 書くのは 1 分に 1 度まで
            with self.store.lock:
                d = self.store.read()
                for x in d['grants']:
                    if x['id'] == g['id']:
                        x['last_used'] = now
                self.store.write(d)
        return g, None

    # --- 画面 ---
    STYLE = ('body{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:0;background:#f4f1ea;color:#222;}'
             'main{max-width:30rem;margin:0 auto;padding:1.5rem 1rem;}'
             'h1{font-size:1.25rem;line-height:1.5;margin:0 0 1rem;}'
             '.host{font-size:1.4rem;font-weight:700;word-break:break-all;margin:.25rem 0 1rem;}'
             '.what{background:#fff;border-radius:.5rem;padding:.75rem 1rem;}'
             '.warn{background:#fff3cd;border-left:4px solid #c88a00;padding:.75rem 1rem;border-radius:.25rem;}'
             '.small{font-size:.8rem;color:#666;word-break:break-all;}'
             '.btns{display:flex;flex-direction:column;gap:.75rem;margin-top:1.5rem;}'
             'button{font-size:1.05rem;padding:.9rem 1rem;border-radius:.5rem;border:1px solid #888;background:#fff;}'
             'button#ok{background:#1f5c99;color:#fff;border-color:#1f5c99;}'
             'button:disabled{opacity:.5;}#msg{min-height:1.5em;margin-top:1rem;color:#a00;}'
             '@media (prefers-color-scheme:dark){body{background:#1b1b1b;color:#eee;}.what{background:#2a2a2a;}'
             '.warn{background:#3a3010;}.small{color:#aaa;}button{background:#2a2a2a;color:#eee;}}')

    def _page(self, title, body):
        return ('<!doctype html><html lang="ja"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<title>{html.escape(title)} - Bubbles</title><style>{self.STYLE}</style></head>'
                f'<body><main>{body}</main></body></html>').encode('utf-8')

    def error_page(self, message):
        return self._page('接続できません', '<h1>接続できません</h1>'
                          f'<p class="what">{html.escape(message)}</p>'
                          '<p class="small">この画面を閉じて、接続を始めたところ（claude.ai など）からやり直してください。</p>')

    def consent_page(self, rid, c, redirect):
        e = html.escape
        chost = host_of(c['client_id'])
        rhost = host_of(redirect)
        body = (f'<div id="oauth" data-request="{e(rid)}">'
                f'<h1>「{e(c["name"])}」が Bubbles につなぎたいと言っています</h1>'
                f'<p>許すと戻る先:</p><p class="host">{e(rhost)}</p>'
                f'<p class="what">許すと、この相手は <strong>{e(GRANT_WHAT)}</strong> ことができます。'
                '取り消すまで（サーバーの oauth-revoke）続きます。</p>'
                f'<p class="warn">自分で {e(chost)} から接続を始めたときだけ許可してください。'
                '覚えが無ければ「断る」を押してください。</p>'
                f'<p class="small">相手の名乗り: {e(c["client_id"])}<br>戻る先: {e(redirect)}</p>'
                '<div class="btns"><button id="ok" type="button">パスキーでログインして許可</button>'
                '<button id="no" type="button">断る</button></div>'
                '<p id="msg" role="status"></p></div>'
                '<script type="module" src="/js/oauth-authorize.js"></script>')
        return self._page('接続の許可', body)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None     # 転送は追わない（3xx はそのまま断りになる）


def fetch_cimd(url: str):
    """相手の名乗り（JSON）を取りに行く → (status, bytes)。転送は追わない・5 秒・64KB まで"""
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Bubbles-OAuth'})
    try:
        with opener.open(req, timeout=CIMD_TIMEOUT) as res:
            return res.status, res.read(CIMD_MAX + 1)
    except urllib.error.HTTPError as e:
        return e.code, None


def client_hosts_from(args_hosts):
    """--oauth-client-host（何度でも）→ 環境変数 BUBBLE_TODO_OAUTH_CLIENT_HOSTS（コンマで）→ claude.ai"""
    if args_hosts:
        return [h.strip().lower() for h in args_hosts if h.strip()]
    env = os.environ.get('BUBBLE_TODO_OAUTH_CLIENT_HOSTS', '').strip()
    if env:
        return [h.strip().lower() for h in env.split(',') if h.strip()]
    return ['claude.ai']
