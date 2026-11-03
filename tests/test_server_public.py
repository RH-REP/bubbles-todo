"""公開の形（--auth passkey）と守り（guard.py・ヘッダ）のテスト。標準ライブラリだけで走る（Node は要らない）。

    python3 -m unittest tests/test_server_public.py

偽の端末は、本物と同じ形の登録・入場のデータを作る。署名は tests/fake_signer.py（標準ライブラリだけの ES256）。
確かめの側が別の実装の署名を通すことは、test_passkey_crypto.py が Node の署名で見ている。
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import passkey_crypto as pc  # noqa: E402
import server  # noqa: E402
from guard import Guard  # noqa: E402
from passkey_store import PasskeyStore  # noqa: E402
from test_passkey_crypto import cbor  # noqa: E402
from fake_signer import EcKey  # noqa: E402

class FakeAuthenticator:
    """パスキーを1つ持つ偽の端末"""

    def __init__(self, rp_id, origin):
        self.rp_id, self.origin = rp_id, origin
        self.key = EcKey()
        self.cose = self.key.cose(cbor)
        self.cred_id = os.urandom(32)
        self.count = 0

    def _ad(self, flags, extra=b''):
        return hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags]) + self.count.to_bytes(4, 'big') + extra

    def create(self, options, origin=None):
        cd = json.dumps({'type': 'webauthn.create', 'challenge': options['challenge'],
                         'origin': origin or self.origin}).encode()
        ad = self._ad(0x45, b'\0' * 16 + len(self.cred_id).to_bytes(2, 'big') + self.cred_id + self.cose)
        att = cbor({'fmt': 'none', 'attStmt': {}, 'authData': ad})
        return {'id': pc.b64u_encode(self.cred_id), 'type': 'public-key',
                'response': {'clientDataJSON': pc.b64u_encode(cd), 'attestationObject': pc.b64u_encode(att)}}

    def get(self, options, origin=None):
        self.count += 1
        cd = json.dumps({'type': 'webauthn.get', 'challenge': options['challenge'], 'origin': origin or self.origin}).encode()
        ad = self._ad(0x05)
        sig = self.key.sign(ad + hashlib.sha256(cd).digest())
        return {'id': pc.b64u_encode(self.cred_id), 'type': 'public-key',
                'response': {'clientDataJSON': pc.b64u_encode(cd), 'authenticatorData': pc.b64u_encode(ad),
                             'signature': pc.b64u_encode(sig)}}


class PublicServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.pk = PasskeyStore(self.dir)
        self.guard = Guard(max_requests=200, max_fails=10)
        httpd = server.Server(('127.0.0.1', 0), None)  # 後で handler を入れる（port を先に知るため）
        port = httpd.server_address[1]
        self.origin = f'http://localhost:{port}'
        cfg = server.Config(auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
                            stores={'me': server.Store(self.dir), 'share': server.Store(self.dir / 'share')},
                            allow_origins=())
        httpd.RequestHandlerClass = server.make_handler({}, cfg)
        httpd.guard = self.guard
        self.httpd = httpd
        self.base = f'http://127.0.0.1:{port}'
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, headers=None):
        r = urllib.request.Request(self.base + path, method=method,
                                   data=json.dumps(body).encode() if body is not None else None)
        for k, v in (headers or {}).items():
            r.add_header(k, v)
        if body is not None:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r) as res:
                raw = res.read()
                try:
                    return res.status, json.loads(raw or b'null'), dict(res.headers)
                except ValueError:
                    return res.status, None, dict(res.headers)   # HTML など
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw or b'null'), dict(e.headers)
            except ValueError:
                return e.code, None, dict(e.headers)

    def register(self, auth, invite):
        code, opts, _ = self.req('POST', '/api/passkey/register/options', {'invite': invite})
        self.assertEqual(code, 200)
        return self.req('POST', '/api/passkey/register', {'credential': auth.create(opts['publicKey'])})

    def login(self, auth):
        code, opts, _ = self.req('POST', '/api/passkey/login/options', {})
        self.assertEqual(code, 200)
        return self.req('POST', '/api/passkey/login', {'credential': auth.get(opts['publicKey'])})

    def data(self, session, space):
        return self.req('GET', '/api/data', headers={'Authorization': 'Bearer ' + session, 'X-Bubbles-Space': space})

    def test_register_login_and_use_spaces(self):
        self.assertEqual(self.req('GET', '/api/auth')[1], {'mode': 'passkey', 'rp_id': 'localhost'})
        owner = FakeAuthenticator('localhost', self.origin)
        code, out, _ = self.register(owner, self.pk.add_invite('自分のスマホ', ['me', 'share']))
        self.assertEqual((code, out['spaces'], out['name']), (200, ['me', 'share'], '自分のスマホ'))
        self.assertEqual(self.data(out['session'], 'me')[0], 200)
        self.assertEqual(self.data(out['session'], 'share')[0], 200)
        # 入り直す（署名で）
        code, out2, _ = self.login(owner)
        self.assertEqual(code, 200)
        put = self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {'todos': []}, 'stamps': {}}},
                       {'Authorization': 'Bearer ' + out2['session'], 'X-Bubbles-Space': 'me'})
        self.assertEqual(put[:2], (200, {'version': 1}))

    def test_share_only_invite_cannot_open_personal(self):
        guest = FakeAuthenticator('localhost', self.origin)
        code, out, _ = self.register(guest, self.pk.add_invite('母', ['share']))
        self.assertEqual(code, 200)
        self.assertEqual(self.data(out['session'], 'share')[0], 200)
        self.assertEqual(self.data(out['session'], 'me')[0], 401, '共有だけの人は個人に入れない')

    def test_named_sea_invite_and_owner_reaches_every_sea(self):
        """2026-11-02 Issue #4: 人を招くのは海の ID。個人に入れるパスキー（持ち主）はどの海にも入る"""
        self.httpd.RequestHandlerClass = server.make_handler({}, server.Config(
            auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
            stores=server.SeaStores(self.dir), allow_origins=(), sea_list=server.SeaList(self.dir)))
        owner = FakeAuthenticator('localhost', self.origin)
        own = self.register(owner, self.pk.add_invite('自分のスマホ', ['me']))[1]['session']
        self.assertEqual(self.data(own, 'shome123')[0], 200, '持ち主は作った海に入れる')
        self.assertEqual(self.data(own, 'share')[0], 200)
        hdr = {'Authorization': 'Bearer ' + own}
        self.req('POST', '/api/spaces', {'spaces': [
            {'id': 'shome123', 'name': '家', 'color': 'moss', 'at': 1, 'alive': 1},
            {'id': 'share', 'name': '共有', 'color': 'magma', 'at': 1, 'alive': 1}]}, hdr)
        guest = FakeAuthenticator('localhost', self.origin)
        code, out, _ = self.register(guest, self.pk.add_invite('母', ['shome123']))
        self.assertEqual((code, out['spaces']), (200, ['shome123']))
        self.assertEqual(self.data(out['session'], 'shome123')[1]['space'], 'shome123')
        self.assertEqual(self.data(out['session'], 'share')[0], 401, '招かれた海のほかには入れない')
        self.assertEqual(self.data(out['session'], 'me')[0], 401)
        code, got, _ = self.req('POST', '/api/spaces', {'spaces': []}, {'Authorization': 'Bearer ' + out['session']})
        self.assertEqual((code, [e['name'] for e in got['spaces']]), (200, ['家']), '招かれた人には入れる海の名前だけ')
        with self.assertRaises(ValueError):
            self.pk.add_invite('だめ', ['../x'])

    def test_personal_is_per_person(self):
        """2026-11-03: 個人は人ごと。ほかの人の個人は見えず、持ち主（1 番）だけがどの海にも入る"""
        self.httpd.RequestHandlerClass = server.make_handler({}, server.Config(
            auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
            stores=server.SeaStores(self.dir), allow_origins=(), sea_list=server.SeaList(self.dir)))

        def put(sess, base, mark):
            return self.req('PUT', '/api/data', {'base': base, 'data': {'doc': {'todos': [mark]}, 'stamps': {}}},
                            {'Authorization': 'Bearer ' + sess, 'X-Bubbles-Space': 'me'})[0]

        own = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('自分のスマホ', ['me']))[1]
        self.assertEqual((own['person'], own['owner']), (1, True), '最初の人が 1 番（持ち主）')
        self.assertEqual(put(own['session'], 0, 'mine'), 200)
        mom = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('母のスマホ', ['me', 'share']))[1]
        self.assertEqual((mom['person'], mom['owner']), (2, False), '番号を付けない me の招待は新しい人')
        code, got, _ = self.data(mom['session'], 'me')
        self.assertEqual((code, got['data'], got['person']), (200, None, 2), '持ち主の個人は見えない')
        self.assertEqual(put(mom['session'], 0, 'moms'), 200)
        self.assertEqual(self.data(own['session'], 'me')[1]['data']['doc']['todos'], ['mine'], '母の個人は持ち主の個人に入らない')
        self.assertEqual(self.data(mom['session'], 'shome123')[0], 401, '持ち主でない人は招かれていない海に入れない')
        self.assertEqual(self.data(mom['session'], 'share')[0], 200)
        self.assertTrue((self.dir / 'people' / '2' / 'state.json').exists())
        # 同じ人の2台目は番号を付けた招待（me:2）
        tab = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('母のタブレット', ['me'], person=2))[1]
        self.assertEqual(self.data(tab['session'], 'me')[1]['data']['doc']['todos'], ['moms'])
        with self.assertRaises(ValueError):
            self.pk.add_invite('だれ', ['me'], person=9)   # いない人の番号には作らない
        self.assertEqual((self.pk.count_in('me', 1), self.pk.count_in('me', 2)), (1, 2), '個人の登録は人ごとに数える')
        # 前の版で持ち主の個人に入れてしまったパスキーを移す（通行証はそのまま、次の要求から効く）
        self.assertEqual(self.pk.set_person('自分のスマホ', 'new'), 3)
        got = self.data(own['session'], 'me')[1]
        self.assertEqual((got['data'], got['person'], got['owner']), (None, 3, False))
        self.assertEqual(self.data(own['session'], 'shome123')[0], 401, '移したら持ち主ではない')
        self.assertEqual(self.pk.set_person('自分のスマホ', 1), 1)
        self.assertEqual(self.data(own['session'], 'me')[1]['data']['doc']['todos'], ['mine'])
        # X-Bubbles-Space でほかの人の個人の箱を名指ししても入れない
        self.assertEqual(self.data(mom['session'], 'me/1')[0], 401)

    def test_old_me_passkeys_without_person_stay_with_owner(self):
        """番号を持たない前の版の行は 1 番（持ち主）。passkey-list に番号が出て、passkey-person で移せる"""
        rows = [{'id': 'x', 'name': '古いスマホ', 'spaces': ['me', 'share'], 'alg': -7, 'public_key': '',
                 'sign_count': 0, 'created': 0, 'last_used': None}]
        (self.dir / 'passkeys.json').write_text(json.dumps(rows))
        self.assertEqual((self.pk.persons(), self.pk.next_person()), ([1], 2))

        def cli(*a):
            return subprocess.run([sys.executable, str(Path(server.__file__)), '--data-dir', str(self.dir), *a],
                                  capture_output=True, text=True).stdout
        self.assertIn('個人 1（持ち主）', cli('passkey-list'))
        self.assertIn('個人 2', cli('passkey-person', '古いスマホ', 'new'))
        self.assertIn('個人 2', cli('invite-add', '古いスマホの2台目', '--space', 'me:2'))

    def test_invite_is_single_use_and_bad_invite_is_refused(self):
        inv = self.pk.add_invite('父', ['share'])
        self.assertEqual(self.register(FakeAuthenticator('localhost', self.origin), inv)[0], 200)
        self.assertEqual(self.req('POST', '/api/passkey/register/options', {'invite': inv})[0], 401, '2度は使えない')
        self.assertEqual(self.req('POST', '/api/passkey/register/options', {'invite': 'AAAA-BBBB-CCCC'})[0], 401)

    def test_tokens_and_forged_logins_do_not_work(self):
        self.assertEqual(self.data('random-token', 'me')[0], 401)
        owner = FakeAuthenticator('localhost', self.origin)
        self.register(owner, self.pk.add_invite('自分', ['me']))
        # 別の住所（偽のサイト）で作った署名は通らない
        code, opts, _ = self.req('POST', '/api/passkey/login/options', {})
        bad = owner.get(opts['publicKey'], origin='https://evil.example')
        self.assertEqual(self.req('POST', '/api/passkey/login', {'credential': bad})[0], 401)
        # 登録していない鍵は通らない
        self.assertEqual(self.login(FakeAuthenticator('localhost', self.origin))[0], 401)
        # 問題（challenge）は使い回せない
        code, opts, _ = self.req('POST', '/api/passkey/login/options', {})
        cred = owner.get(opts['publicKey'])
        self.assertEqual(self.req('POST', '/api/passkey/login', {'credential': cred})[0], 200)
        self.assertEqual(self.req('POST', '/api/passkey/login', {'credential': cred})[0], 401)

    def test_remove_passkey_revokes_sessions(self):
        owner = FakeAuthenticator('localhost', self.origin)
        _, out, _ = self.register(owner, self.pk.add_invite('なくしたスマホ', ['me']))
        self.assertEqual(self.data(out['session'], 'me')[0], 200)
        self.assertTrue(self.pk.remove_passkey('なくしたスマホ'))
        self.assertEqual(self.data(out['session'], 'me')[0], 401, '取り消したら次の要求から入れない')
        self.assertEqual(self.login(owner)[0], 401)

    def test_three_passkeys_per_space(self):
        for n in ('A', 'B', 'C'):
            self.assertEqual(self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite(n, ['share']))[0], 200)
        with self.assertRaises(ValueError):
            self.pk.add_invite('D', ['share'])          # いっぱいの置き場には招待コードも作らない
        self.assertEqual(self.pk.count_in('share'), 3)
        # 個人は別に数える（個人と共有の端末は、両方に入る → 共有がいっぱいなので作れない）
        self.pk.add_invite('自分', ['me'])
        with self.assertRaises(ValueError):
            self.pk.add_invite('自分2', ['me', 'share'])
        # 先に作ってあった招待コードも、いっぱいになったら登録を受けない
        self.assertTrue(self.pk.remove_passkey('C'))
        early = self.pk.add_invite('E', ['share'])
        self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('F', ['share']))
        code, body, _ = self.req('POST', '/api/passkey/register/options', {'invite': early})
        self.assertEqual((code, body['error']), (409, 'full'))

    def test_three_devices_at_once(self):
        t = [0.0]
        self.httpd.RequestHandlerClass = server.make_handler({}, server.Config(
            auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
            stores={'me': server.Store(self.dir), 'share': server.Store(self.dir / 'share')},
            devices=server.Devices(max_active=3, window=1800, clock=lambda: t[0])))
        sessions = []
        for n in ('A', 'B', 'C', 'D'):
            space = ['share'] if n != 'D' else ['me']    # 置き場ごとの登録の上限に当たらないように
            sessions.append(self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite(n, space))[1]['session'])
        self.assertEqual([self.data(x, 'share')[0] for x in sessions[:3]], [200, 200, 200])
        code, body, _ = self.data(sessions[3], 'me')
        self.assertEqual((code, body['error']), (429, 'devices'), '4台目は断る')
        self.assertEqual(self.data(sessions[0], 'share')[0], 200, '使っている端末は通る')
        # 出た端末はすぐ外れる
        self.req('POST', '/api/passkey/logout', {}, {'Authorization': 'Bearer ' + sessions[1]})
        self.assertEqual(self.data(sessions[3], 'me')[0], 200, '1台出たので入れる')
        # 30分使わなかった端末は数から外れる
        t[0] = 1801
        self.assertEqual(self.data(sessions[2], 'share')[0], 200)
        self.assertFalse(self.guard.auth_blocked('127.0.0.1'), '混んでいて断ったのは、入場の失敗に数えない')

    def test_failures_are_limited(self):
        for _ in range(10):
            self.req('POST', '/api/passkey/register/options', {'invite': 'WRONG'})
        self.assertEqual(self.req('POST', '/api/passkey/register/options', {'invite': 'WRONG'})[0], 429)
        self.assertEqual(self.data('x', 'me')[0], 429, '失敗が続いた接続元は、記録にも入れない')

    def test_security_headers_and_origins(self):
        code, _, h = self.req('GET', '/', headers={'Origin': 'https://evil.example'})
        self.assertEqual(code, 200)
        self.assertIn("script-src 'self'", h.get('Content-Security-Policy', ''))
        self.assertEqual(h.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(h.get('X-Frame-Options'), 'DENY')
        self.assertNotIn('Access-Control-Allow-Origin', h, 'よそのオリジンには許さない')
        self.assertNotIn('Python', h.get('Server', ''), '版を名乗らない')

    def test_index_has_no_inline_script(self):
        html = (Path(server.ROOT) / 'index.html').read_text()
        import re
        inline = [m for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>', html)]
        self.assertEqual(inline, [], 'CSP の script-src \'self\' で止まる書き方が残っている')


class GuardTest(unittest.TestCase):
    def test_request_window(self):
        t = [0.0]
        g = Guard(max_requests=3, window=60, clock=lambda: t[0])
        self.assertEqual([g.request('a') for _ in range(4)], [True, True, True, False])
        self.assertTrue(g.request('b'), '接続元ごとに数える')
        t[0] = 61
        self.assertTrue(g.request('a'), '窓が過ぎれば戻る')

    def test_connection_limits(self):
        g = Guard(max_conn=3, max_conn_per_ip=2)
        self.assertEqual([g.open('a'), g.open('a'), g.open('a')], [True, True, False])
        self.assertTrue(g.open('b'))
        self.assertFalse(g.open('c'), '全体の上限')
        g.close('a')
        self.assertTrue(g.open('c'))

    def test_too_many_connections_get_429(self):
        tmp = tempfile.TemporaryDirectory()
        g = Guard(max_conn=50, max_conn_per_ip=2)
        httpd = server.Server(('127.0.0.1', 0), server.make_handler({}, server.Config(guard=g)))
        httpd.guard = g
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]
        try:
            held = [socket.create_connection(('127.0.0.1', port)) for _ in range(2)]   # 何も送らずに居座る
            time.sleep(0.2)
            s = socket.create_connection(('127.0.0.1', port))
            s.settimeout(3)
            self.assertIn(b'429', s.recv(100), '3本目は読まずに断る')
            s.close()
            for h in held:
                h.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            tmp.cleanup()


if __name__ == '__main__':
    unittest.main()
