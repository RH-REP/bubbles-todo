"""claude.ai の接続（OAuth 2.1。oauth_server.py）のテスト。標準ライブラリだけで走る（網には出ない）。

    python3 -m unittest tests/test_server_oauth.py

公開の形（--auth passkey）のサーバーを一時フォルダで立てる。相手の名乗り（Client ID Metadata Document）は
偽の取りに行くもの（FakeFetcher）が返し、パスキーは test_server_public.py の偽の端末（FakeAuthenticator）。
時計は偽物（期限切れを待たずに試す）。
"""
import base64
import contextlib
import hashlib
import http.client
import io
import json
import re
import secrets
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import oauth_server  # noqa: E402
import server  # noqa: E402
from guard import Guard  # noqa: E402
from passkey_store import PasskeyStore  # noqa: E402
from test_server_public import FakeAuthenticator  # noqa: E402

CLIENT = 'https://claude.ai/oauth/fake-client.json'
CALLBACK = 'https://claude.ai/api/mcp/auth_callback'


class FakeFetcher:
    """相手の名乗りを返す偽物。どの住所を取りに来たかを覚える"""

    def __init__(self):
        self.calls = []
        self.docs = {CLIENT: {'client_id': CLIENT, 'client_name': '秘書 <b>テスト</b>', 'redirect_uris': [CALLBACK],
                              'token_endpoint_auth_method': 'none'}}

    def __call__(self, url):
        self.calls.append(url)
        if url not in self.docs:
            return 404, b''
        return 200, json.dumps(self.docs[url]).encode('utf-8')


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    return verifier, challenge


class OAuthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.pk = PasskeyStore(self.dir)
        self.guard = Guard(max_requests=1000, max_fails=200)
        self.now = [int(time.time())]
        self.fetcher = FakeFetcher()
        httpd = server.Server(('127.0.0.1', 0), None)   # 後で handler を入れる（port を先に知るため）
        self.port = httpd.server_address[1]
        self.origin = f'http://localhost:{self.port}'
        self.oauth = oauth_server.OAuth(self.dir, self.origin, self.pk, ['claude.ai'], fetcher=self.fetcher,
                                        clock=lambda: self.now[0])
        cfg = server.Config(auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
                            stores=server.SeaStores(self.dir), sea_list=server.SeaList(self.dir),
                            machines=server.MachineKeys(self.dir), allow_origins=(), oauth=self.oauth)
        httpd.RequestHandlerClass = server.make_handler({}, cfg)
        httpd.guard = self.guard
        self.httpd = httpd
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.secrets = []          # 出てきた値（ファイル・記録に出ていないかを最後に見る）
        self.err = io.StringIO()
        self._stderr = contextlib.redirect_stderr(self.err)
        self._stderr.__enter__()

    def tearDown(self):
        self._stderr.__exit__(None, None, None)
        self.httpd.shutdown()
        self.httpd.server_close()
        f = self.dir / 'oauth.json'
        text = f.read_text(encoding='utf-8') if f.exists() else ''
        for v in self.secrets:
            self.assertNotIn(v, text, '値は oauth.json に置かない')
            self.assertNotIn(v, self.err.getvalue(), '値は記録に出さない')
        if f.exists():
            self.assertEqual(f.stat().st_mode & 0o777, 0o600)
        self.tmp.cleanup()

    # --- 道具 ---
    def raw(self, method, path, body=None, headers=None):
        """転送を追わずに1つ送る → (status, headers, bytes)"""
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
        c.close()
        return out

    def jpost(self, path, obj, headers=None):
        st, h, b = self.raw('POST', path, json.dumps(obj).encode(), dict({'Content-Type': 'application/json'}, **(headers or {})))
        return st, (json.loads(b) if b else None)

    def token(self, **form):
        st, h, b = self.raw('POST', '/oauth/token', urlencode(form).encode(),
                            {'Content-Type': 'application/x-www-form-urlencoded'})
        out = json.loads(b)
        if st == 200:
            self.assertEqual(h.get('cache-control'), 'no-store')
            self.assertEqual(h.get('pragma'), 'no-cache')
            self.secrets += [out['access_token'], out['refresh_token']]
        return st, out

    def mcp(self, tok, method='POST', body=None, headers=None):
        hd = dict(headers or {})
        if tok:
            hd['Authorization'] = 'Bearer ' + tok
        if body is not None:
            hd['Content-Type'] = 'application/json'
        st, h, b = self.raw(method, '/mcp', json.dumps(body).encode() if body is not None else None, hd)
        return st, h, b

    def owner(self, name='自分のスマホ', spaces=('me',), person=None):
        auth = FakeAuthenticator('localhost', self.origin)
        st, opts = self.jpost('/api/passkey/register/options', {'invite': self.pk.add_invite(name, list(spaces), person=person)})
        self.assertEqual(st, 200)
        st, out = self.jpost('/api/passkey/register', {'credential': auth.create(opts['publicKey'])})
        self.assertEqual(st, 200, out)
        self.secrets.append(out['session'])
        auth.session = out['session']
        return auth

    def authorize(self, **over):
        verifier, challenge = pkce()
        q = {'response_type': 'code', 'client_id': CLIENT, 'redirect_uri': CALLBACK, 'code_challenge': challenge,
             'code_challenge_method': 'S256', 'state': 'st-123', 'scope': 'todo', 'resource': self.origin + '/mcp'}
        q.update(over)
        q = {k: v for k, v in q.items() if v is not None}
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(q))
        return st, h, b.decode('utf-8'), verifier

    def approve(self, auth, page):
        rid = re.search(r'data-request="([^"]+)"', page).group(1)
        st, opts = self.jpost('/api/passkey/login/options', {})
        self.assertEqual(st, 200)
        return self.jpost('/oauth/approve', {'request': rid, 'credential': auth.get(opts['publicKey'])})

    def flow(self, auth):
        """許可の画面 → 許可 → code。→ (code, verifier, 戻る先の問い)"""
        st, h, page, verifier = self.authorize()
        self.assertEqual(st, 200, page)
        st, out = self.approve(auth, page)
        self.assertEqual(st, 200, out)
        u = urlsplit(out['redirect'])
        self.assertEqual(f'{u.scheme}://{u.netloc}{u.path}', CALLBACK)
        q = parse_qs(u.query)
        self.secrets.append(q['code'][0])
        return q['code'][0], verifier, q

    def tokens(self, auth):
        code, verifier, _ = self.flow(auth)
        st, out = self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                             code_verifier=verifier, resource=self.origin + '/mcp')
        self.assertEqual(st, 200, out)
        return out

    # --- テスト ---
    def test_metadata(self):
        st, h, b = self.raw('GET', '/.well-known/oauth-authorization-server')
        m = json.loads(b)
        self.assertEqual(st, 200)
        self.assertEqual(m['issuer'], self.origin)
        self.assertEqual(m['authorization_endpoint'], self.origin + '/oauth/authorize')
        self.assertEqual(m['token_endpoint'], self.origin + '/oauth/token')
        self.assertEqual(m['code_challenge_methods_supported'], ['S256'])
        self.assertEqual(m['token_endpoint_auth_methods_supported'], ['none'])
        self.assertEqual(m['grant_types_supported'], ['authorization_code', 'refresh_token'])
        self.assertEqual(m['scopes_supported'], ['todo', 'todo.read'])
        self.assertIs(m['client_id_metadata_document_supported'], True)
        self.assertIs(m['authorization_response_iss_parameter_supported'], True)
        self.assertNotIn('registration_endpoint', m)
        st, h, b = self.raw('GET', '/.well-known/oauth-protected-resource/mcp')
        p = json.loads(b)
        self.assertEqual((st, p['resource'], p['authorization_servers'], p['bearer_methods_supported']),
                         (200, self.origin + '/mcp', [self.origin], ['header']))
        self.assertEqual(json.loads(self.raw('GET', '/.well-known/oauth-protected-resource')[2])['resource'], self.origin)

    def test_mcp_without_token(self):
        st, h, b = self.mcp(None, body={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'})
        self.assertEqual(st, 401)
        self.assertEqual(h['www-authenticate'],
                         f'Bearer resource_metadata="{self.origin}/.well-known/oauth-protected-resource/mcp", scope="todo"')
        self.assertNotIn('auth-fail', self.err.getvalue(), '初めての呼び出しは失敗に数えない')

    def test_full_flow(self):
        me = self.owner()
        st, h, page, _ = self.authorize()
        self.assertEqual(st, 200)
        self.assertIn('text/html', h['content-type'])
        self.assertIn("script-src 'self'", h['content-security-policy'])
        self.assertIn('秘書 &lt;b&gt;テスト&lt;/b&gt;', page, '相手の名前は字のまま（HTML にしない）')
        self.assertIn('claude.ai', page)
        self.assertIn('パスキーでログインして許可', page)
        self.assertIn('/js/oauth-authorize.js', page)
        self.assertNotIn('<script>', page)
        # 許可 → code・state・iss
        code, verifier, q = self.flow(me)
        self.assertEqual((q['state'], q['iss']), (['st-123'], [self.origin]))
        # 違う verifier → 断る。その code は使えなくなる
        st, out = self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                             code_verifier=pkce()[0])
        self.assertEqual((st, out['error']), (400, 'invalid_grant'))
        st, out = self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                             code_verifier=verifier)
        self.assertEqual((st, out['error']), (400, 'invalid_grant'), '1度出した code は合っていても使えない')
        # やり直し → 正しい verifier
        tok = self.tokens(me)
        self.assertEqual((tok['token_type'], tok['expires_in'], tok['scope']), ('Bearer', 3600, 'todo'))
        self.assertTrue(tok['access_token'].startswith('ba_') and tok['refresh_token'].startswith('bf_'))
        st, h, b = self.mcp(tok['access_token'], body={'jsonrpc': '2.0', 'id': 7, 'method': 'tools/list'})
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(b), {'jsonrpc': '2.0', 'id': 7, 'error': {'code': -32601, 'message': '道具はまだ無い'}})
        self.assertEqual(self.mcp(tok['access_token'], method='GET')[0], 405)
        self.assertEqual(self.mcp(tok['access_token'], method='DELETE')[0], 405)
        # 通行証の取り違え: OAuth の通行証は /api/data に効かず、パスキーの通行証は /mcp に効かない
        st, h, b = self.raw('GET', '/api/data', headers={'Authorization': 'Bearer ' + tok['access_token'],
                                                         'X-Bubbles-Space': 'me', 'X-Bubbles-Schema': '1'})
        self.assertEqual(st, 401)
        self.assertEqual(self.raw('GET', '/api/data', headers={'Authorization': 'Bearer ' + me.session,
                                                               'X-Bubbles-Space': 'me'})[0], 200)
        st, h, b = self.mcp(me.session, body={'jsonrpc': '2.0', 'id': 1})
        self.assertEqual(st, 401)
        self.assertIn('error="invalid_token"', h['www-authenticate'])
        # 更新の札: 使うたびに替わる
        st, t2 = self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)
        self.assertEqual(st, 200, t2)
        self.assertNotEqual(t2['refresh_token'], tok['refresh_token'])
        self.assertEqual(self.mcp(t2['access_token'], body={'jsonrpc': '2.0', 'id': 1})[0], 200)
        st, t3 = self.token(grant_type='refresh_token', refresh_token=t2['refresh_token'], client_id=CLIENT, scope='todo')
        self.assertEqual(st, 200)
        # 使った札をもう一度 → 断り、許可ごと取り消す（新しい通行証も札も効かない）
        st, out = self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)
        self.assertEqual((st, out['error']), (400, 'invalid_grant'))
        self.assertIn('bubbles: oauth-refresh-reuse', self.err.getvalue())
        self.assertEqual(self.mcp(t3['access_token'], body={})[0], 401)
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=t3['refresh_token'], client_id=CLIENT)[0], 400)

    def test_code_reuse_revokes_grant(self):
        me = self.owner()
        code, verifier, _ = self.flow(me)
        st, tok = self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                             code_verifier=verifier)
        self.assertEqual(st, 200)
        self.assertEqual(self.mcp(tok['access_token'], body={})[0], 200)
        st, out = self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                             code_verifier=verifier)
        self.assertEqual((st, out['error']), (400, 'invalid_grant'))
        self.assertIn('bubbles: oauth-code-reuse', self.err.getvalue())
        self.assertEqual(self.mcp(tok['access_token'], body={})[0], 401, 'code を2度使われたら、その許可ごと取り消す')
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)[0], 400)

    def test_token_endpoint_checks(self):
        me = self.owner()
        st, h, b = self.raw('POST', '/oauth/token', json.dumps({'grant_type': 'refresh_token'}).encode(),
                            {'Content-Type': 'application/json'})
        self.assertEqual((st, json.loads(b)['error']), (400, 'invalid_request'))
        self.assertEqual(self.token(grant_type='password')[1]['error'], 'unsupported_grant_type')
        code, verifier, _ = self.flow(me)
        self.assertEqual(self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK,
                                    client_id='https://claude.ai/other.json', code_verifier=verifier)[1]['error'], 'invalid_grant')
        code, verifier, _ = self.flow(me)
        self.assertEqual(self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK + 'x',
                                    client_id=CLIENT, code_verifier=verifier)[1]['error'], 'invalid_grant')
        code, verifier, _ = self.flow(me)
        self.assertEqual(self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                                    code_verifier=verifier, resource='https://evil.example/mcp')[1]['error'], 'invalid_target')
        tok = self.tokens(me)
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT,
                                    scope='todo admin')[1]['error'], 'invalid_scope')
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT,
                                    resource='https://evil.example/')[1]['error'], 'invalid_target')
        st, out = self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT,
                             resource=self.origin + '/')
        self.assertEqual((st, out['error']), (400, 'invalid_target'),
                         '2026-11-18 から根の住所は記録の API の宛て（/mcp の許可とは別）')
        st, out = self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT,
                             resource=self.origin + '/mcp/')
        self.assertEqual(st, 200, '/mcp の宛ては末尾の / があっても同じ')
        self.assertIn('bubbles: oauth-fail', self.err.getvalue())

    def test_cli_revoke(self):
        me = self.owner()
        tok = self.tokens(me)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(server.main(['--data-dir', str(self.dir), 'oauth-list']), 0)
        listing = out.getvalue()
        gid = re.search(r'^(g_[0-9a-f]{8})\t', listing, re.M).group(1)
        self.assertIn('claude.ai', listing)
        self.assertNotIn(tok['access_token'], listing)
        self.assertNotIn(tok['refresh_token'], listing)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(server.main(['--data-dir', str(self.dir), 'oauth-revoke', gid]), 0)
        self.assertEqual(self.mcp(tok['access_token'], body={})[0], 401)
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)[0], 400)
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                server.main(['--data-dir', str(self.dir), 'oauth-revoke', gid])
        t2 = self.tokens(me)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(server.main(['--data-dir', str(self.dir), 'oauth-revoke', 'all']), 0)
        self.assertEqual(self.mcp(t2['access_token'], body={})[0], 401)

    def test_expiry(self):
        me = self.owner()
        tok = self.tokens(me)
        self.now[0] += 3601
        st, h, b = self.mcp(tok['access_token'], body={})
        self.assertEqual(st, 401)
        self.assertIn('error="invalid_token"', h['www-authenticate'])
        st, t2 = self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)
        self.assertEqual(st, 200, '通行証が切れても、更新の札で替えられる')
        self.now[0] += 30 * 24 * 3600 + 1
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=t2['refresh_token'], client_id=CLIENT)[0], 400)
        # code は 120 秒
        code, verifier, _ = self.flow(me)
        self.now[0] += 121
        self.assertEqual(self.token(grant_type='authorization_code', code=code, redirect_uri=CALLBACK, client_id=CLIENT,
                                    code_verifier=verifier)[1]['error'], 'invalid_grant')
        # 許可の画面は 10 分
        st, h, page, _ = self.authorize()
        self.now[0] += 601
        self.assertEqual(self.approve(me, page)[0], 400)

    def test_client_refusals(self):
        st, h, page, _ = self.authorize(client_id='https://evil.example/client.json')
        self.assertEqual(st, 400)
        self.assertNotIn('location', h)
        self.assertEqual(self.fetcher.calls, [], '許していない名前は取りに行かない')
        self.assertIn('bubbles: oauth-client-refused ip=127.0.0.1 host=evil.example', self.err.getvalue())
        for bad in ('http://claude.ai/oauth/fake-client.json', 'https://claude.ai/', 'https://u@claude.ai/x.json',
                    'https://claude.ai:8443/x.json', 'https://claude.ai/a/../x.json', 'not a url'):
            self.assertEqual(self.authorize(client_id=bad)[0], 400, bad)
        self.assertEqual(self.fetcher.calls, [])
        # 戻る先が名乗りに無い → 戻さずに断りの画面
        st, h, page, _ = self.authorize(redirect_uri='https://evil.example/cb')
        self.assertEqual(st, 400)
        self.assertNotIn('location', h)
        self.assertIn('redirect_uri', page)
        # 名乗りの client_id が違う・取れない
        self.fetcher.docs['https://claude.ai/bad.json'] = {'client_id': 'https://claude.ai/other.json', 'redirect_uris': [CALLBACK]}
        self.assertEqual(self.authorize(client_id='https://claude.ai/bad.json')[0], 400)
        self.assertEqual(self.authorize(client_id='https://claude.ai/none.json')[0], 400)
        # 秘密の鍵を使う相手
        self.fetcher.docs['https://claude.ai/secret.json'] = {'client_id': 'https://claude.ai/secret.json',
                                                             'redirect_uris': [CALLBACK], 'token_endpoint_auth_method': 'client_secret_basic'}
        self.assertEqual(self.authorize(client_id='https://claude.ai/secret.json')[0], 400)
        # 名乗りは 1 時間覚える
        self.authorize()
        self.authorize()
        self.assertEqual(self.fetcher.calls.count(CLIENT), 1)
        self.now[0] += 3601
        self.authorize()
        self.assertEqual(self.fetcher.calls.count(CLIENT), 2)

    def test_redirect_errors(self):
        def back(**over):
            st, h, page, _ = self.authorize(**over)
            self.assertEqual(st, 302, page)
            u = urlsplit(h['location'])
            self.assertEqual(f'{u.scheme}://{u.netloc}{u.path}', CALLBACK)
            q = parse_qs(u.query)
            self.assertEqual((q['state'], q['iss']), (['st-123'], [self.origin]))
            return q['error'][0]
        self.assertEqual(back(code_challenge_method='plain'), 'invalid_request')
        self.assertEqual(back(code_challenge_method=None), 'invalid_request')
        self.assertEqual(back(code_challenge=None), 'invalid_request')
        self.assertEqual(back(response_type='token'), 'unsupported_response_type')
        self.assertEqual(back(scope='todo admin'), 'invalid_scope')
        self.assertEqual(back(resource='https://evil.example/mcp'), 'invalid_target')
        self.assertEqual(back(resource=self.origin + '/other'), 'invalid_target')
        # 受けるもの: 根の住所・末尾の / ・大文字の名前・offline_access・resource なし
        for ok in ({'resource': self.origin}, {'resource': self.origin.upper().replace('HTTP', 'http') + '/mcp/'},
                   {'scope': 'todo offline_access'}, {'resource': None, 'scope': None}):
            self.assertEqual(self.authorize(**ok)[0], 200, ok)

    def test_deny(self):
        st, h, page, _ = self.authorize()
        rid = re.search(r'data-request="([^"]+)"', page).group(1)
        st, out = self.jpost('/oauth/deny', {'request': rid})
        q = parse_qs(urlsplit(out['redirect']).query)
        self.assertEqual((st, q['error'], q['state'], q['iss']), (200, ['access_denied'], ['st-123'], [self.origin]))
        self.assertEqual(self.jpost('/oauth/deny', {'request': rid})[0], 400, '1度だけ')

    def test_any_user_approves_only_their_own_records(self):
        """2026-11-18: どの利用者のパスキーでも許可できる。許したのは、その利用者の記録だけ"""
        self.owner()
        guest = self.owner('母', spaces=('share',))      # 共有だけに招かれた人も利用者（個人の海を持つ）
        st, h, page, _ = self.authorize()
        st, out = self.approve(guest, page)
        self.assertEqual(st, 200, out)
        g = [x for x in self.oauth.store.read()['grants']][-1]
        mom = self.pk.user_of_passkey(self.pk.find_passkey(base64.urlsafe_b64encode(guest.cred_id).rstrip(b'=').decode()))
        self.assertEqual((g['user'], g['person']), (mom['id'], mom['person']))
        self.assertNotEqual(mom['person'], 1)
        # 知らない端末
        st, h, page2, _ = self.authorize()
        stranger = FakeAuthenticator('localhost', self.origin)
        self.assertEqual(self.approve(stranger, page2)[0], 401)

    # --- gantt・diary（前もって登録した相手。2026-11-18 取り決め §2） ---
    def pre_tokens(self, auth, client='gantt', redirect='http://127.0.0.1:8766/auth/callback', **over):
        verifier, challenge = pkce()
        q = {'response_type': 'code', 'client_id': client, 'redirect_uri': redirect, 'code_challenge': challenge,
             'code_challenge_method': 'S256', 'state': 's1'}
        q.update(over)
        q = {k: v for k, v in q.items() if v is not None}
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(q))
        page = b.decode('utf-8')
        self.assertEqual(st, 200, page)
        self.assertIn('bubble でログイン', page, '許可の画面ではなくログインだけ')
        self.assertNotIn('自分で', page)
        st, out = self.approve(auth, page)
        self.assertEqual(st, 200, out)
        code = parse_qs(urlsplit(out['redirect']).query)['code'][0]
        self.secrets.append(code)
        st, out = self.token(grant_type='authorization_code', code=code, redirect_uri=redirect, client_id=client,
                             code_verifier=verifier)
        self.assertEqual(st, 200, out)
        return out

    def api(self, tok, method='GET', space='me', body=None):
        hd = {'Authorization': 'Bearer ' + tok, 'X-Bubbles-Schema': '1', 'X-Bubbles-Space': space}
        if body is not None:
            hd['Content-Type'] = 'application/json'
        st, h, b = self.raw(method, '/api/data', json.dumps(body).encode() if body is not None else None, hd)
        return st, (json.loads(b) if b else None)

    def test_gantt_and_diary_read_bubble_records_as_the_user(self):
        me = self.owner()
        self.pk.set_member('share', self.pk.users()[0]['id'], 'owner')
        server.SeaList(self.dir).merge([{'id': 'sfam01', 'name': '家族', 'color': 'moss', 'at': 1, 'alive': 1}])
        self.pk.set_member('sfam01', self.pk.users()[0]['id'], 'viewer')
        g = self.pre_tokens(me)
        self.assertEqual(g['scope'], 'todo')
        body = {'base': 0, 'data': {'doc': {'todos': []}, 'stamps': {}}}
        self.assertEqual(self.api(g['access_token'], 'PUT', 'me', body)[0], 200, 'gantt は個人の海に書ける')
        st, out = self.api(g['access_token'])
        self.assertEqual((st, out['user'], out['role']), (200, self.pk.users()[0]['id'], 'owner'))
        self.assertEqual(self.api(g['access_token'], 'PUT', 'share', body)[0], 200, '持ち主の共有の海にも書ける')
        self.assertEqual(self.api(g['access_token'], 'PUT', 'sfam01', body)[0], 403, '見るだけの海には書けない')
        self.assertEqual(self.api(g['access_token'], 'GET', 'sfam01')[0], 200)
        self.assertEqual(self.api(g['access_token'], 'GET', 'snot01')[0], 403, '仲間でない海は 403')
        self.assertEqual(self.mcp(g['access_token'], body={})[0], 401, 'gantt の通行証は /mcp に効かない')
        # /api/me
        st, h, b = self.raw('GET', '/api/me', None, {'Authorization': 'Bearer ' + g['access_token']})
        me_out = json.loads(b)
        self.assertEqual(st, 200)
        self.assertEqual(me_out['user']['id'], self.pk.users()[0]['id'])
        self.assertEqual([(s['id'], s['kind'], s['role']) for s in me_out['seas']],
                         [('me', 'personal', 'owner'), ('share', 'shared', 'owner'), ('sfam01', 'shared', 'viewer')])
        self.assertTrue(all(re.fullmatch(r'#[0-9a-f]{6}', s['color']) for s in me_out['seas']))
        self.assertEqual(me_out['seas'][2]['name'], '家族')
        # diary は読むだけ
        d = self.pre_tokens(me, 'diary', 'http://127.0.0.1:8780/auth/callback')
        self.assertEqual(d['scope'], 'todo.read')
        self.assertEqual(self.api(d['access_token'])[0], 200)
        self.assertEqual(self.api(d['access_token'], 'PUT', 'me', {'base': 1, 'data': {'doc': {}, 'stamps': {}}})[0], 403)
        # 端末の通行証でも /api/me
        st, h, b = self.raw('GET', '/api/me', None, {'Authorization': 'Bearer ' + me.session})
        self.assertEqual(st, 200)
        self.assertEqual(self.raw('GET', '/api/me')[0], 401)
        # 秘書（/mcp 宛て）の通行証は記録の API に効かない
        sec = self.tokens(me)
        self.assertEqual(self.api(sec['access_token'])[0], 401)
        # 期限切れは 401 だが失敗に数えない（gantt は同じ VM の 127.0.0.1 から 1 時間ごとに当たる）
        self.now[0] += 3601
        mark = len(self.err.getvalue())
        st, h, b = self.raw('GET', '/api/data', None, {'Authorization': 'Bearer ' + g['access_token'], 'X-Bubbles-Space': 'me'})
        self.assertEqual(st, 401)
        self.assertIn('invalid_token', h.get('www-authenticate', ''))
        self.assertFalse(self.guard.auth_blocked('127.0.0.1'))
        self.assertNotIn('auth-fail', self.err.getvalue()[mark:], '期限切れは失敗に数えない')

    def test_pre_registered_clients_are_strict(self):
        me = self.owner()
        verifier, challenge = pkce()
        base = {'response_type': 'code', 'code_challenge': challenge, 'code_challenge_method': 'S256'}
        # 登録していない戻る先は、戻さずに断る
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(dict(base, client_id='gantt',
                                                                          redirect_uri='https://evil.example/auth/callback')))
        self.assertEqual(st, 400)
        self.assertNotIn('location', h)
        # diary は todo（書き込み）を頼めない
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(dict(base, client_id='diary', scope='todo',
                                                                          redirect_uri='http://127.0.0.1:8780/auth/callback')))
        self.assertEqual(st, 302)
        self.assertIn('error=invalid_scope', h['location'])
        # gantt は /mcp を頼めない
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(dict(base, client_id='gantt', resource=self.origin + '/mcp',
                                                                          redirect_uri='http://127.0.0.1:8766/auth/callback')))
        self.assertIn('error=invalid_target', h['location'])
        self.assertEqual(self.fetcher.calls, [], '前もって登録した相手の名乗りは取りに行かない')
        # 本番の戻る先（取り決めの住所）も受ける
        st, h, b = self.raw('GET', '/oauth/authorize?' + urlencode(dict(base, client_id='gantt',
                                                                          redirect_uri='https://gantt.app-laboratory.duckdns.org/auth/callback')))
        self.assertEqual(st, 200)
        # 読むだけの更新の札では todo に広げられない
        d = self.pre_tokens(me, 'diary', 'http://127.0.0.1:8780/auth/callback')
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=d['refresh_token'], client_id='diary',
                                    scope='todo')[1]['error'], 'invalid_scope')
        st, out = self.token(grant_type='refresh_token', refresh_token=d['refresh_token'], client_id='diary')
        self.assertEqual((st, out['scope']), (200, 'todo.read'))

    def test_removing_passkey_cuts_token(self):
        me = self.owner()
        tok = self.tokens(me)
        self.assertEqual(self.mcp(tok['access_token'], body={})[0], 200)
        self.assertTrue(self.pk.remove_passkey('自分のスマホ'))
        self.assertEqual(self.mcp(tok['access_token'], body={})[0], 401)
        self.assertEqual(self.token(grant_type='refresh_token', refresh_token=tok['refresh_token'], client_id=CLIENT)[0], 400)

    def test_origin_at_mcp(self):
        me = self.owner()
        tok = self.tokens(me)
        self.assertEqual(self.mcp(tok['access_token'], body={}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.mcp(tok['access_token'], body={}, headers={'Origin': self.origin})[0], 200)
        self.assertEqual(self.jpost('/oauth/deny', {'request': 'x'}, headers={'Origin': 'https://evil.example'})[0], 403)

    def test_token_mode_has_no_oauth(self):
        cfg = server.Config(auth='token', allow_origins=())
        self.httpd.RequestHandlerClass = server.make_handler({}, cfg)
        for path in ('/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp',
                     '/oauth/authorize', '/mcp'):
            self.assertEqual(self.raw('GET', path)[0], 404, path)
        for path in ('/oauth/token', '/oauth/approve', '/mcp'):
            self.assertEqual(self.raw('POST', path, b'{}', {'Content-Type': 'application/json'})[0], 404, path)


if __name__ == '__main__':
    unittest.main()
