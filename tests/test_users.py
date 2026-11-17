"""利用者と海の仲間（2026-11-18 ユーザーの決定。取り決め v1.2 §2）のテスト。標準ライブラリだけで走る。

    python3 -m unittest tests/test_users.py

・前の人の番号とパスキーの置き場を、利用者と海の仲間へ移す（全員。パスキーの行は残し、番号で引く）
・これから作るパスキーの user.id は利用者の番号
・GET /api/me、記録の API の 403（仲間でない・見るだけの書き込み）
・招待のリンク（新しい利用者の登録・ログインしている人の「この海に入る」）と、端末を足す番号（10 分・1 回）
"""
import base64
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402
import test_server_public as tsp  # noqa: E402  （クラスの名前をここに置くと、そのテストもここで走るので、モジュールで持つ）
FakeAuthenticator = tsp.FakeAuthenticator


class UsersTest(unittest.TestCase):
    # PublicServerTest の道具だけを借りる（そのテストはここでは走らせない）
    tearDown = tsp.PublicServerTest.tearDown
    req = tsp.PublicServerTest.req
    register = tsp.PublicServerTest.register
    login = tsp.PublicServerTest.login
    data = tsp.PublicServerTest.data

    def setUp(self):
        tsp.PublicServerTest.setUp(self)
        self.httpd.RequestHandlerClass = server.make_handler({}, server.Config(
            auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
            stores=server.SeaStores(self.dir), allow_origins=(), sea_list=server.SeaList(self.dir)))

    def cli(self, *a):
        return subprocess.run([sys.executable, str(Path(server.__file__)), '--data-dir', str(self.dir), *a],
                              capture_output=True, text=True)

    def me(self, session):
        return self.req('GET', '/api/me', headers={'Authorization': 'Bearer ' + session})

    def put(self, session, space, base=0):
        return self.req('PUT', '/api/data', {'base': base, 'data': {'doc': {'todos': []}, 'stamps': {}}},
                        {'Authorization': 'Bearer ' + session, 'X-Bubbles-Space': space})

    # --- 移す ---
    def test_migrate_people_and_spaces_to_users_and_members(self):
        rows = [
            {'id': 'a', 'name': '自分のスマホ', 'spaces': ['me', 'share', 'sfam01'], 'alg': -7, 'public_key': '', 'sign_count': 0,
             'created': 1, 'last_used': None},                                   # 番号なし → 1 番
            {'id': 'b', 'name': '自分のMac', 'spaces': ['me'], 'person': 1, 'alg': -7, 'public_key': '', 'sign_count': 0,
             'created': 2, 'last_used': None},
            {'id': 'c', 'name': '母のスマホ', 'spaces': ['me', 'sfam01'], 'person': 2, 'alg': -7, 'public_key': '',
             'sign_count': 0, 'created': 3, 'last_used': None},
            {'id': 'd', 'name': '友だち', 'spaces': ['share'], 'alg': -7, 'public_key': '', 'sign_count': 0,
             'created': 4, 'last_used': None},                                   # 共有だけ → 新しい利用者
        ]
        (self.dir / 'passkeys.json').write_text(json.dumps(rows))
        got = self.pk.migrate()
        self.assertEqual(got, {'users': 3, 'passkeys': 4, 'members': 4})
        self.assertEqual(self.pk.migrate(), {'users': 0, 'passkeys': 0, 'members': 0}, '2度目は何もしない')
        users = {u['person']: u for u in self.pk.users()}
        self.assertEqual(sorted(users), [1, 2, 3])
        self.assertEqual((users[1]['name'], users[2]['name'], users[3]['name']), ('自分のスマホ', '母のスマホ', '友だち'))
        keys = {r['id']: r for r in self.pk.passkeys()}
        self.assertEqual(keys['a']['user'], keys['b']['user'], '同じ人の端末は同じ利用者')
        self.assertEqual(keys['a']['spaces'], ['me', 'share', 'sfam01'], '前の欄は消さずに残す')
        me1 = users[1]['id']
        self.assertEqual(self.pk.roles_of(me1), {'me': 'owner', 'share': 'owner', 'sfam01': 'owner'},
                         '持ち主の無い海は 1 番の人を owner に')
        self.assertEqual(self.pk.roles_of(users[2]['id']), {'me': 'owner', 'sfam01': 'editor'})
        self.assertEqual(self.pk.roles_of(users[3]['id']), {'me': 'owner', 'share': 'editor'})
        for n in ('passkeys.json', 'users.json', 'members.json'):
            self.assertEqual((self.dir / n).stat().st_mode & 0o777, 0o600)
        # 移したあとも、前の端末はパスキーの番号で引ける（通行証の利用者・個人の番号）
        tok, _ = self.pk.new_session('c')
        info = self.pk.session_info(tok)
        self.assertEqual((info['user'], info['person'], info['roles']['sfam01']), (users[2]['id'], 2, 'editor'))
        out = self.cli('user-list').stdout
        self.assertIn('母のスマホ', out)
        self.assertIn('個人 2', out)

    def test_migrate_picks_first_member_when_person_1_is_not_in_sea(self):
        rows = [{'id': 'x', 'name': '母', 'spaces': ['me', 'sfam01'], 'person': 2, 'alg': -7, 'public_key': '',
                 'sign_count': 0, 'created': 1, 'last_used': None},
                {'id': 'y', 'name': '父', 'spaces': ['me', 'sfam01'], 'person': 3, 'alg': -7, 'public_key': '',
                 'sign_count': 0, 'created': 2, 'last_used': None}]
        (self.dir / 'passkeys.json').write_text(json.dumps(rows))
        self.pk.migrate()
        roles = sorted((m['role'], next(u['name'] for u in self.pk.users() if u['id'] == m['user']))
                       for m in self.pk.members_of('sfam01'))
        self.assertEqual(roles, [('editor', '父'), ('owner', '母')])

    # --- 登録と /api/me ---
    def test_new_passkey_user_id_is_user_number_and_api_me(self):
        code, opts, _ = self.req('POST', '/api/passkey/register/options',
                                 {'invite': self.pk.add_invite('iPhone', ['me', 'share']), 'userName': 'りょう'})
        self.assertEqual(code, 200)
        uid = base64.urlsafe_b64decode(opts['publicKey']['user']['id'] + '==').decode()
        self.assertRegex(uid, r'^u_[0-9a-f]{8}$')
        self.assertEqual(opts['publicKey']['user']['name'], 'りょう', 'OS の選択に利用者の名前が出る')
        code, out, _ = self.req('POST', '/api/passkey/register',
                                {'credential': FakeAuthenticator('localhost', self.origin).create(opts['publicKey'])})
        self.assertEqual(code, 200)
        self.assertEqual(out['user'], {'id': uid, 'name': 'りょう'})
        self.assertEqual(out['name'], 'iPhone', '端末の呼び名は招待の名前')
        code, me, _ = self.me(out['session'])
        self.assertEqual(code, 200)
        self.assertEqual(me['user'], {'id': uid, 'name': 'りょう'})
        self.assertEqual([(s['id'], s['kind'], s['role']) for s in me['seas']],
                         [('me', 'personal', 'owner'), ('share', 'shared', 'editor')])
        self.assertEqual(me['seas'][1]['members'], [{'id': uid, 'name': 'りょう', 'role': 'editor'}])
        self.assertEqual(self.req('GET', '/api/me')[0], 401)
        self.assertEqual(self.req('GET', '/api/me', headers={'Authorization': 'Bearer nope'})[0], 401)

    def test_viewer_cannot_write_and_non_member_gets_403(self):
        a = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('A', ['me', 'share']))[1]
        self.pk.set_member('share', a['user']['id'], 'viewer')
        self.assertEqual(self.data(a['session'], 'share')[0], 200)
        self.assertEqual(self.put(a['session'], 'share')[0], 403, '見るだけの海には書けない')
        self.assertEqual(self.put(a['session'], 'me')[0], 200)
        self.assertEqual(self.data(a['session'], 'sother1')[0], 403)
        self.assertFalse(self.guard.auth_blocked('127.0.0.1'), '403 は入場の失敗に数えない')
        out = self.cli('member-set', 'share', a['user']['id'], 'editor')
        self.assertIn('書ける', out.stdout, out.stderr)
        self.assertEqual(self.put(a['session'], 'share')[0], 200, 'VM で役割を変えると次の要求から効く')
        self.assertEqual(self.cli('member-set', 'share', a['user']['id'], 'boss').returncode, 1)
        self.assertEqual(self.cli('member-remove', 'share', a['user']['id']).returncode, 0)
        self.assertEqual(self.data(a['session'], 'share')[0], 403)

    # --- 招待のリンク ---
    def test_sea_invite_link_signup_and_accept(self):
        self.req('POST', '/api/spaces', {})
        server.SeaList(self.dir).merge([{'id': 'sfam01', 'name': '家族の買い物', 'color': 'sand', 'at': 1, 'alive': 1}])
        yuki = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('ゆきのスマホ', ['me']))[1]
        self.pk.set_member('sfam01', yuki['user']['id'], 'owner')
        hdr = {'Authorization': 'Bearer ' + yuki['session']}
        code, inv, _ = self.req('POST', '/api/passkey/invite', {'name': 'りょう', 'sea': 'sfam01'}, hdr)
        self.assertEqual(code, 200)
        self.assertTrue(inv['link'].startswith(self.origin + '/#invite='))
        code, peek, _ = self.req('POST', '/api/passkey/invite/peek', {'invite': inv['code']})
        self.assertEqual((code, peek['kind'], peek['by'], peek['seas']),
                         (200, 'sea', 'ゆきのスマホ', [{'id': 'sfam01', 'role': 'editor', 'name': '家族の買い物'}]))
        self.assertNotIn(inv['code'], json.dumps(peek))
        # ログインしていない人: 新しい利用者として登録し、海の仲間になる
        code, opts, _ = self.req('POST', '/api/passkey/register/options',
                                 {'invite': inv['code'], 'userName': 'りょう', 'deviceName': 'iPhone'})
        code, ryo, _ = self.req('POST', '/api/passkey/register',
                                {'credential': FakeAuthenticator('localhost', self.origin).create(opts['publicKey'])})
        self.assertEqual(code, 200, ryo)
        self.assertEqual((ryo['user']['name'], ryo['name'], ryo['roles']),
                         ('りょう', 'iPhone', {'me': 'owner', 'sfam01': 'editor'}))
        self.assertNotEqual(ryo['person'], yuki['person'], '新しい利用者は自分の個人の海を持つ')
        # ログインしている人: 「この海に入る」
        sora = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('そら', ['me']))[1]
        code, inv2, _ = self.req('POST', '/api/passkey/invite', {'name': 'そら', 'sea': 'sfam01', 'role': 'viewer'}, hdr)
        sh = {'Authorization': 'Bearer ' + sora['session']}
        self.assertEqual(self.req('POST', '/api/passkey/invite/accept', {'invite': inv2['code']})[0], 401, 'ログインが要る')
        code, out, _ = self.req('POST', '/api/passkey/invite/accept', {'invite': inv2['code']}, sh)
        self.assertEqual((code, out['joined'], out['roles']['sfam01']), (200, ['sfam01'], 'viewer'))
        self.assertEqual(len(self.pk.passkeys()), 3, '受け取りではパスキーを増やさない')
        self.assertEqual(self.req('POST', '/api/passkey/invite/accept', {'invite': inv2['code']}, sh)[0], 401, '1回だけ')
        # 端末の招待は受け取れない（ログインしていない端末で使う）
        dev = self.req('POST', '/api/passkey/invite', {'name': '自分のiPad', 'sea': 'me'}, sh)[1]
        self.assertEqual(self.req('POST', '/api/passkey/invite/accept', {'invite': dev['code']}, sh)[0], 409)
        # 書ける人は招けない・持ち主は招ける
        self.assertEqual(self.req('POST', '/api/passkey/invite', {'name': 'x', 'sea': 'sfam01'},
                                  {'Authorization': 'Bearer ' + ryo['session']})[0], 403)
        self.assertEqual(self.req('POST', '/api/passkey/invite', {'name': 'x', 'sea': 'sfam01', 'role': 'owner'}, hdr)[0], 409,
                         '持ち主の役割では招けない（editor か viewer）')

    # --- 端末を足す番号 ---
    def test_add_device_number(self):
        a = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('iPhone', ['me', 'share']))[1]
        hdr = {'Authorization': 'Bearer ' + a['session']}
        self.assertEqual(self.req('POST', '/api/passkey/device', {})[0], 401)
        code, got, _ = self.req('POST', '/api/passkey/device', {}, hdr)
        self.assertEqual(code, 200)
        self.assertRegex(got['code'], r'^[0-9]{3} [0-9]{3}$')
        self.assertNotIn(got['code'].replace(' ', ''), (self.dir / 'invites.json').read_text(), '番号そのものは置かない')
        code, opts, _ = self.req('POST', '/api/passkey/register/options', {'device': got['code'].replace(' ', ''), 'deviceName': 'Mac'})
        self.assertEqual(code, 200)
        uid = base64.urlsafe_b64decode(opts['publicKey']['user']['id'] + '==').decode()
        self.assertEqual(uid, a['user']['id'], '同じ利用者の番号でパスキーを作る')
        code, mac, _ = self.req('POST', '/api/passkey/register',
                                {'credential': FakeAuthenticator('localhost', self.origin).create(opts['publicKey'])})
        self.assertEqual((code, mac['user'], mac['name'], mac['roles']), (200, a['user'], 'Mac', a['roles']))
        self.assertEqual(self.req('POST', '/api/passkey/register/options', {'device': got['code']})[0], 401, '1回だけ')
        # 10 分で切れる
        code, got2, _ = self.req('POST', '/api/passkey/device', {}, hdr)
        self.pk.clock = lambda: got2['expires'] + 1
        self.assertEqual(self.req('POST', '/api/passkey/register/options', {'device': got2['code']})[0], 401)

    def test_device_number_guessing_is_stopped(self):
        a = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('iPhone', ['me']))[1]
        got = self.req('POST', '/api/passkey/device', {}, {'Authorization': 'Bearer ' + a['session']})[1]
        wrong = '000000' if got['code'].replace(' ', '') != '000000' else '111111'
        self.guard.max_fails = 10 ** 6          # 接続元ごとの守りは外して、全体の守りだけを見る
        for _ in range(20):
            self.assertEqual(self.req('POST', '/api/passkey/register/options', {'device': wrong})[0], 401)
        code, body, _ = self.req('POST', '/api/passkey/register/options', {'device': got['code']})
        self.assertEqual(code, 429, '全体で 20 回外れたら、正しい番号でもしばらく断る')


if __name__ == '__main__':
    unittest.main()
