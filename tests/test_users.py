"""利用者と海の仲間（2026-11-18 ユーザーの決定。取り決め v1.2 §2）のテスト。標準ライブラリだけで走る。

    python3 -m unittest tests/test_users.py

・前の人の番号とパスキーの置き場を、利用者と海の仲間へ移す（全員。パスキーの行は残し、番号で引く）
・これから作るパスキーの user.id は利用者の番号
・GET /api/me、記録の API の 403（仲間でない・見るだけの書き込み）
・招待のリンク（新しい利用者の登録・ログインしている人の「この海に入る」）と、端末を足す番号（10 分・1 回）
"""
import base64
import json
import re
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
        self.assertEqual((out['user']['id'], out['user']['name']), (uid, 'りょう'))
        self.assertEqual(out['name'], 'iPhone', '端末の呼び名は招待の名前')
        code, me, _ = self.me(out['session'])
        self.assertEqual(code, 200)
        self.assertEqual((me['user']['id'], me['user']['name']), (uid, 'りょう'))
        self.assertEqual([(s['id'], s['kind'], s['role']) for s in me['seas']],
                         [('me', 'personal', 'owner'), ('share', 'shared', 'editor')])
        self.assertEqual([(m['id'], m['name'], m['role']) for m in me['seas'][1]['members']], [(uid, 'りょう', 'editor')])
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

    # --- スーパーユーザーが新しい利用者を招く（2026-11-18） ---
    def test_superuser_invites_new_user(self):
        self.req('POST', '/api/spaces', {})
        yuki = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('ゆきのスマホ', ['me']))[1]
        ryo = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('りょう', ['me']))[1]
        self.assertEqual(yuki['person'], 1)
        yh = {'Authorization': 'Bearer ' + yuki['session']}
        rh = {'Authorization': 'Bearer ' + ryo['session']}
        self.assertTrue(self.me(yuki['session'])[1]['user'].get('admin'), 'だれにも付いていなければ 1 番の人')
        self.assertNotIn('admin', self.me(ryo['session'])[1]['user'])
        # スーパーユーザーは、海なしで新しい利用者を招ける（リンクつき）
        code, inv, _ = self.req('POST', '/api/passkey/invite', {'name': 'そら', 'sea': 'me', 'newPerson': True}, yh)
        self.assertEqual(code, 200, inv)
        self.assertTrue(inv['link'].startswith(self.origin + '/#invite='))
        code, peek, _ = self.req('POST', '/api/passkey/invite/peek', {'invite': inv['code']})
        self.assertEqual((code, peek['seas']), (200, []))
        code, opts, _ = self.req('POST', '/api/passkey/register/options', {'invite': inv['code'], 'userName': 'そら', 'deviceName': 'Pixel'})
        code, sora, _ = self.req('POST', '/api/passkey/register',
                                 {'credential': FakeAuthenticator('localhost', self.origin).create(opts['publicKey'])})
        self.assertEqual(code, 200, sora)
        self.assertEqual((sora['user']['name'], sora['roles']), ('そら', {'me': 'owner'}), '自分の個人の海だけ')
        self.assertNotIn(sora['person'], (yuki['person'], ryo['person']))
        self.assertNotIn(sora['user']['id'], (yuki['user']['id'], ryo['user']['id']), '招いた人の 2 台目ではなく、新しい利用者')
        # スーパーユーザーでない人は 403。名前が無ければ 409
        self.assertEqual(self.req('POST', '/api/passkey/invite', {'name': 'x', 'sea': 'me', 'newPerson': True}, rh)[0], 403)
        self.assertEqual(self.req('POST', '/api/passkey/invite', {'name': '', 'sea': 'me', 'newPerson': True}, yh)[0], 409)
        # VM で替える。最後の 1 人は外せない
        out = self.cli('admin-add', ryo['user']['id'])
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(self.me(ryo['session'])[1]['user'].get('admin'))
        self.assertTrue(self.me(yuki['session'])[1]['user'].get('admin'), '1 番の人は書き出されて残る')
        self.assertEqual(self.cli('admin-remove', yuki['user']['id']).returncode, 0)
        self.assertNotIn('admin', self.me(yuki['session'])[1]['user'])
        self.assertEqual(self.req('POST', '/api/passkey/invite', {'name': 'x', 'sea': 'me', 'newPerson': True}, yh)[0], 403)
        bad = self.cli('admin-remove', ryo['user']['id'])
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('1 人もいなくなる', bad.stderr)
        self.assertIn('りょう', self.cli('admin-list').stdout)

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


    # --- 海の管理は作成者が行う（2026-11-18 ユーザーの決定。前の「VM だけ」を置き換えた） ---
    def sea(self, session, op, **body):
        return self.req('POST', '/api/sea/' + op, body, {'Authorization': 'Bearer ' + session})

    def test_owner_manages_sea_from_app(self):
        yuki = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('ゆき', ['me']))[1]
        ryo = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('りょう', ['me']))[1]
        sora = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('そら', ['me']))[1]
        Y, R_, S = yuki['user']['id'], ryo['user']['id'], sora['user']['id']
        self.assertEqual(self.sea('nope', 'create', name='家族')[0], 401)
        code, me, _ = self.sea(yuki['session'], 'create', name='家族の買い物', color='sand', id='sfam01')
        self.assertEqual(code, 200, me)
        fam = next(s for s in me['seas'] if s['id'] == 'sfam01')
        self.assertEqual((fam['name'], fam['role'], fam['color']), ('家族の買い物', 'owner', '#b07a1c'), '作った人が持ち主')
        self.assertEqual(self.sea(ryo['session'], 'create', name='x', id='sfam01')[0], 409, '同じ ID はもうある')
        self.assertEqual(self.sea(yuki['session'], 'create', name='', color='sand')[0], 409)
        self.assertEqual(self.sea(yuki['session'], 'create', name='x', color='red')[0], 409)
        self.pk.set_member('sfam01', R_, 'editor')
        self.pk.set_member('sfam01', S, 'editor')
        # 名前・色は持ち主だけ
        self.assertEqual(self.sea(ryo['session'], 'update', sea='sfam01', name='乗っ取り')[0], 403)
        code, me, _ = self.sea(yuki['session'], 'update', sea='sfam01', name='家族', color='moss')
        self.assertEqual([(s['name'], s['color']) for s in me['seas'] if s['id'] == 'sfam01'], [('家族', '#3f8a4a')])
        # 端末の一覧の合わせ（/api/spaces）でも、持ち主の海だけ書き換えられる
        hr = {'Authorization': 'Bearer ' + ryo['session']}
        self.req('POST', '/api/spaces', {'spaces': [{'id': 'sfam01', 'name': '乗っ取り', 'color': 'ink', 'at': 10 ** 13, 'alive': 1}]}, hr)
        self.assertEqual(next(r for r in server.SeaList(self.dir).read() if r['id'] == 'sfam01')['name'], '家族')
        hy = {'Authorization': 'Bearer ' + yuki['session']}
        self.req('POST', '/api/spaces', {'spaces': [{'id': 'sfam01', 'name': '家族の海', 'color': 'moss', 'at': 10 ** 13, 'alive': 1}]}, hy)
        self.assertEqual(next(r for r in server.SeaList(self.dir).read() if r['id'] == 'sfam01')['name'], '家族の海')
        # 役割を変える・外す
        self.assertEqual(self.sea(ryo['session'], 'role', sea='sfam01', user=S, role='viewer')[0], 403)
        code, me, _ = self.sea(yuki['session'], 'role', sea='sfam01', user=S, role='viewer')
        self.assertEqual(self.pk.roles_of(S)['sfam01'], 'viewer')
        self.assertEqual(self.sea(yuki['session'], 'role', sea='sfam01', user=S, role='owner')[0], 409, '持ち主は渡すで')
        self.assertEqual(self.sea(yuki['session'], 'role', sea='sfam01', user=Y, role='viewer')[0], 409, '自分は変えない')
        self.assertEqual(self.put(sora['session'], 'sfam01')[0], 403, '見るだけになった')
        self.assertEqual(self.sea(yuki['session'], 'kick', sea='sfam01', user=S)[0], 200)
        self.assertEqual(self.data(sora['session'], 'sfam01')[0], 403, '外されたら次の要求から入れない')
        self.assertEqual(self.sea(yuki['session'], 'kick', sea='sfam01', user=S)[0], 409, 'もう仲間でない')
        # 持ち主は渡してから出る
        code, out, _ = self.sea(yuki['session'], 'leave', sea='sfam01')
        self.assertEqual((code, out['error']), (409, 'owner'))
        self.assertEqual(self.sea(yuki['session'], 'transfer', sea='sfam01', user=R_)[0], 200)
        self.assertEqual((self.pk.roles_of(R_)['sfam01'], self.pk.roles_of(Y)['sfam01']), ('owner', 'editor'))
        self.assertEqual(self.sea(yuki['session'], 'leave', sea='sfam01')[0], 200, '書ける人は出られる')
        self.assertNotIn('sfam01', self.pk.roles_of(Y))
        code, out, _ = self.sea(ryo['session'], 'leave', sea='sfam01')
        self.assertEqual((code, out['error']), (409, 'last'), 'ひとりの持ち主は、出るなら消す')
        # 消す
        self.assertEqual(self.sea(yuki['session'], 'remove', sea='sfam01')[0], 404, '仲間でない海は見えない')
        code, me, _ = self.sea(ryo['session'], 'remove', sea='sfam01')
        self.assertEqual(code, 200)
        self.assertNotIn('sfam01', [s['id'] for s in me['seas']])
        self.assertEqual(self.pk.members_of('sfam01'), [])
        self.assertIn('サーバーの海はありません', self.cli('sea-list').stdout)

    def test_my_devices_list_and_remove(self):
        a = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('iPhone', ['me']))[1]
        b = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('Mac', ['me'], person=a['person']))[1]
        other = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('ほかの人', ['me']))[1]
        hdr = {'Authorization': 'Bearer ' + a['session']}
        code, out, _ = self.req('POST', '/api/passkey/devices', {}, hdr)
        self.assertEqual(code, 200)
        self.assertEqual(sorted((d['name'], d['current']) for d in out['devices']), [('Mac', False), ('iPhone', True)],
                         '自分の端末だけ。今の端末に印')
        self.assertEqual(self.req('POST', '/api/passkey/devices/remove', {'name': 'ほかの人'}, hdr)[0], 404, 'ほかの人の端末は外せない')
        code, out, _ = self.req('POST', '/api/passkey/devices/remove', {'name': 'iPhone'}, hdr)
        self.assertEqual((code, out['error']), (409, 'current'), '今の端末は確かめてから')
        code, out, _ = self.req('POST', '/api/passkey/devices/remove', {'name': 'Mac'}, hdr)
        self.assertEqual([d['name'] for d in out['devices']], ['iPhone'])
        self.assertEqual(self.data(b['session'], 'me')[0], 401, '外した端末の通行証は止まる')
        self.assertEqual(self.req('POST', '/api/passkey/devices/remove', {'name': 'iPhone', 'confirm': True}, hdr)[0], 200)
        self.assertEqual(self.data(a['session'], 'me')[0], 401)
        self.assertEqual(self.data(other['session'], 'me')[0], 200)


    # --- 利用者のアイコン（2026-11-18） ---
    def test_avatar_presets_random_start_and_change(self):
        code, got, _ = self.req('GET', '/api/avatars')
        self.assertEqual(code, 200)
        self.assertEqual(len(got['presets']), 16)
        ids = [p['id'] for p in got['presets']]
        self.assertEqual(len(set(ids)), 16)
        self.assertTrue(all(re.fullmatch(r'#[0-9a-f]{6}', p['color']) and p['emoji'] for p in got['presets']))
        a = self.register(FakeAuthenticator('localhost', self.origin), self.pk.add_invite('りょう', ['me', 'share']))[1]
        self.assertIn(a['user']['avatar']['preset'], ids, '新しい利用者はランダムに 1 つ持つ（登録の答えにも出る）')
        code, me, _ = self.me(a['session'])
        av = me['user']['avatar']
        self.assertEqual(set(av), {'preset', 'emoji', 'color'})
        self.assertIn(av['preset'], ids)
        self.assertEqual(set(me['seas'][1]['members'][0]['avatar']), {'preset', 'emoji', 'color'}, '仲間のアイコンも出る')
        hdr = {'Authorization': 'Bearer ' + a['session']}
        code, me2, _ = self.req('POST', '/api/passkey/avatar', {'preset': 'owl'}, hdr)
        self.assertEqual((code, me2['user']['avatar']), (200, {'preset': 'owl', 'emoji': '🦉', 'color': '#7a52b8'}))
        self.assertEqual(self.me(a['session'])[1]['user']['avatar']['preset'], 'owl', '自分で選んだものが残る')
        self.assertEqual(self.req('POST', '/api/passkey/avatar', {'preset': 'dragon'}, hdr)[0], 409, 'プリセットの外は選べない')
        self.assertEqual(self.req('POST', '/api/passkey/avatar', {'preset': 'owl'})[0], 401)

    def test_users_without_avatar_get_one(self):
        rows = [{'id': 'a', 'name': '古い人', 'spaces': ['me'], 'person': 1, 'alg': -7, 'public_key': '', 'sign_count': 0,
                 'created': 1, 'last_used': None}]
        (self.dir / 'passkeys.json').write_text(json.dumps(rows))
        self.pk.migrate()
        users = json.loads((self.dir / 'users.json').read_text())
        self.assertIn(users[0]['avatar'], [x[0] for x in __import__('passkey_store').AVATARS], '移した利用者にも配る')
        del users[0]['avatar']                                   # 前の版で移した（アイコンの無い）利用者
        (self.dir / 'users.json').write_text(json.dumps(users))
        self.assertIsNotNone(self.pk.avatar_of(self.pk.users()[0]), '持っていなくても答えは出る')
        self.pk.migrate()
        self.assertIn('avatar', json.loads((self.dir / 'users.json').read_text())[0], '次に移すとき配る')


    # --- 3 つの app の住所の根（2026-11-18 取り決め §7.2） ---
    def test_api_apps(self):
        code, got, _ = self.req('GET', '/api/apps')
        self.assertEqual((code, got), (200, {'bubble': self.origin}), '決めていなければ bubble だけ（画面が住所から決める）')
        self.httpd.RequestHandlerClass = server.make_handler({}, server.Config(
            auth='passkey', origin=self.origin, rp_id='localhost', guard=self.guard, passkeys=self.pk,
            stores=server.SeaStores(self.dir), sea_list=server.SeaList(self.dir),
            app_urls=server.parse_app_urls(['gantt=https://gantt.example.org/', 'diary=https://diary.example.org'])))
        code, got, _ = self.req('GET', '/api/apps')
        self.assertEqual(got, {'bubble': self.origin, 'gantt': 'https://gantt.example.org', 'diary': 'https://diary.example.org'})
        with self.assertRaises(SystemExit):
            server.parse_app_urls(['gantt=javascript:alert(1)'])


if __name__ == '__main__':
    unittest.main()
