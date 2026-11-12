"""server.py のテスト。標準ライブラリだけで走る。

    python3 -m unittest tests/test_server.py
"""
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

TOKEN = 'test-token'
SHARE = 'share-token'


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        spaces = {TOKEN: ('me', server.Store(self.data)), SHARE: ('share', server.Store(self.data / 'share'))}
        self.httpd = server.Server(('127.0.0.1', 0), server.make_handler(spaces))
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, token=TOKEN, schema='1'):
        r = urllib.request.Request(self.base + path, method=method,
                                   data=json.dumps(body).encode() if body is not None else None)
        if token is not None:
            r.add_header('Authorization', 'Bearer ' + token)
        if schema is not None:  # 記録の形の版（共有の記録 v1.1）。None で送らない（前の版の端末）
            r.add_header('X-Bubbles-Schema', schema)
        if body is not None:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_sw_assets_are_all_served(self):
        """sw.js の ASSETS は、全部が server.py から 200 で取れること。1つでも 404 だと addAll ごと失敗し、
        server.py から開いたページに service worker が入らない（2026-11-08 の 3f060cd で solo.html を足して踏んだ）。
        取れなくてよいもの（OPTIONAL）は、server.py が配らないことも確かめる"""
        import re
        src = (Path(server.__file__).parent / 'sw.js').read_text(encoding='utf-8')
        def listed(name):
            m = re.search(r'const ' + name + r' = \[(.*?)\];', src, re.S)
            self.assertIsNotNone(m, name)
            return re.findall(r"'(\./[^']*)'", m.group(1))
        assets, optional = listed('ASSETS'), listed('OPTIONAL')
        self.assertGreater(len(assets), 50)
        self.assertIn('./solo.html', optional)
        bad = [u for u in assets if self.req('GET', '/' + u[2:], token=None)[0] != 200]
        self.assertEqual(bad, [], 'server.py が配らないものが ASSETS に入っている（OPTIONAL へ移す）')
        for u in optional:
            self.assertNotIn(u, assets)

    def test_health_needs_no_token(self):
        code, body = self.req('GET', '/api/health', token=None)
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {'ok': True})

    def test_data_needs_token(self):
        self.assertEqual(self.req('GET', '/api/data', token=None)[0], 401)
        self.assertEqual(self.req('GET', '/api/data', token='wrong')[0], 401)
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {}}}, token='wrong')[0], 401)

    def test_empty_then_put_then_conflict(self):
        code, body = self.req('GET', '/api/data')
        self.assertEqual((code, json.loads(body)), (200, {'space': 'me', 'version': 0, 'data': None, 'minSchema': 1}))
        doc = {'doc': {'todos': [{'id': 'a', 'text': '牛乳'}]}, 'stamps': {'todo:a': [5, 1]}}
        code, body = self.req('PUT', '/api/data', {'base': 0, 'data': doc})
        self.assertEqual((code, json.loads(body)), (200, {'version': 1}))
        # 古い版の上に書こうとすると 409 と今の中身。上書きしない
        code, body = self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {}, 'stamps': {}}})
        self.assertEqual(code, 409)
        self.assertEqual(json.loads(body), {'space': 'me', 'version': 1, 'data': doc})
        code, body = self.req('GET', '/api/data')
        self.assertEqual(json.loads(body)['data'], doc)

    def test_backup_kept_on_overwrite(self):
        self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {'n': 1}}})
        self.req('PUT', '/api/data', {'base': 1, 'data': {'doc': {'n': 2}}})
        olds = list((self.data / 'backup').glob('state-*.json'))
        self.assertEqual(len(olds), 1)
        self.assertEqual(json.loads(olds[0].read_text())['data'], {'doc': {'n': 1}})

    def test_bad_body(self):
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0})[0], 400)
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': {'no_doc': 1}})[0], 400)

    def test_static_serves_app_only(self):
        self.assertEqual(self.req('GET', '/', token=None)[0], 200)
        self.assertEqual(self.req('GET', '/js/store.js', token=None)[0], 200)
        self.assertEqual(self.req('GET', '/docs/guide/index.html', token=None)[0], 200, '使い方の記事')
        self.assertEqual(self.req('GET', '/docs/guide/', token=None)[0], 200)
        self.assertEqual(self.req('GET', '/docs/guide/img/01_sea.jpg', token=None)[0], 200)
        # app 本体の外（記録・合言葉・repo の中身）は出さない
        (self.data / 'token.txt').write_text('x')
        for p in ['/server.py', '/.git/config', '/data/state.json', '/data/token.txt',
                  '/.env', '/DEV_NOTES.md', '/js/../server.py', '/css/../.git/HEAD']:
            self.assertEqual(self.req('GET', p, token=None)[0], 404, p)

    def test_share_token_opens_its_own_space_only(self):
        mine = {'doc': {'todos': [{'id': 'p', 'text': '個人のもの'}]}, 'stamps': {}}
        ours = {'doc': {'todos': [{'id': 's', 'text': '共有のもの'}]}, 'stamps': {}}
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': mine})[0], 200)
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': ours}, token=SHARE)[0], 200)
        code, body = self.req('GET', '/api/data', token=SHARE)
        got = json.loads(body)
        self.assertEqual((got['space'], got['data']), ('share', ours), '共有の合言葉では共有だけが見える')
        self.assertEqual(json.loads(self.req('GET', '/api/data')[1])['data'], mine)
        self.assertTrue((self.data / 'share' / 'state.json').exists())
        self.assertNotIn('個人のもの', (self.data / 'share' / 'state.json').read_text())

    def test_open_spaces_makes_tokens(self):
        d = self.data / 'fresh'
        d.mkdir()
        sp = server.open_spaces(d)
        self.assertEqual(sorted(v[0] for v in sp.values()), ['me', 'share'])
        self.assertTrue((d / 'token.txt').exists() and (d / 'share_tokens.json').exists())
        self.assertEqual((d / 'share_tokens.json').stat().st_mode & 0o777, 0o600)
        rows = json.loads((d / 'share_tokens.json').read_text())
        rows[0]['token'] = (d / 'token.txt').read_text().strip()
        (d / 'share_tokens.json').write_text(json.dumps(rows))
        with self.assertRaises(SystemExit):
            server.open_spaces(d)

    def test_legacy_share_token_is_migrated(self):
        d = self.data / 'old'
        d.mkdir()
        (d / 'share_token.txt').write_text('old-share-token\n')
        sp = server.open_spaces(d)
        self.assertEqual(sp['old-share-token'][0], 'share', '前の版の共有の合言葉はそのまま使える')
        rows = json.loads((d / 'share_tokens.json').read_text())
        self.assertEqual([(r['name'], r['token']) for r in rows], [('最初の合言葉', 'old-share-token')])
        self.assertFalse((d / 'share_token.txt').exists())

    def test_add_remove_rotate_without_restart(self):
        d = self.data / 'live'
        d.mkdir()
        spaces = server.Spaces(d)
        httpd = server.Server(('127.0.0.1', 0), server.make_handler(spaces))
        base = f'http://127.0.0.1:{httpd.server_address[1]}'
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            def get(tok):
                r = urllib.request.Request(base + '/api/data', headers={'Authorization': 'Bearer ' + tok})
                try:
                    with urllib.request.urlopen(r) as res:
                        return res.status, json.loads(res.read())['space']
                except urllib.error.HTTPError as e:
                    return e.code, None
            tok = server.ShareTokens(d).add('母のスマホ')
            self.assertEqual(get(tok), (200, 'share'), '足した合言葉は止めずに効く')
            self.assertTrue(server.ShareTokens(d).remove('母のスマホ'))
            self.assertEqual(get(tok)[0], 401, '取り消した合言葉は次の接続から入れない')
            old = (d / 'token.txt').read_text().strip()
            self.assertEqual(get(old), (200, 'me'))
            server.token_command(d, 'rotate-me', '')
            new = (d / 'token.txt').read_text().strip()
            self.assertNotEqual(new, old)
            self.assertEqual(get(old)[0], 401, '作り直した前の合言葉は入れない')
            self.assertEqual(get(new), (200, 'me'))
            self.assertEqual((d / 'token.txt').stat().st_mode & 0o777, 0o600)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_named_seas_with_own_token(self):
        """2026-11-02 Issue #4: 自分の合言葉はどの海にも入る。共有の合言葉は「共有」だけ。海の一覧"""
        d = self.data / 'seas'
        d.mkdir()
        spaces = server.Spaces(d)
        cfg = server.Config(sea_list=server.SeaList(d))
        httpd = server.Server(('127.0.0.1', 0), server.make_handler(spaces, cfg))
        base = f'http://127.0.0.1:{httpd.server_address[1]}'
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        me = (d / 'token.txt').read_text().strip()
        guest = server.ShareTokens(d).add('母のスマホ')

        def call(method, path, tok, space=None, body=None):
            r = urllib.request.Request(base + path, method=method,
                                       data=json.dumps(body).encode() if body is not None else None)
            r.add_header('Authorization', 'Bearer ' + tok)
            r.add_header('X-Bubbles-Schema', '1')
            if space:
                r.add_header('X-Bubbles-Space', space)
            if body is not None:
                r.add_header('Content-Type', 'application/json')
            try:
                with urllib.request.urlopen(r) as res:
                    return res.status, json.loads(res.read())
            except urllib.error.HTTPError as e:
                return e.code, None
        try:
            doc = {'doc': {'todos': [{'id': 'w1', 'text': '仕事のもの'}]}, 'stamps': {}}
            self.assertEqual(call('PUT', '/api/data', me, 'swork123', {'base': 0, 'data': doc}), (200, {'version': 1}))
            self.assertTrue((d / 'seas' / 'swork123' / 'state.json').exists(), '作った海は seas/<ID>/')
            self.assertEqual(call('GET', '/api/data', me, 'swork123')[1]['space'], 'swork123')
            self.assertEqual(call('GET', '/api/data', me)[1], {'space': 'me', 'version': 0, 'data': None, 'minSchema': 1},
                             '海を言わなければ個人')
            self.assertEqual(call('GET', '/api/data', me, 'share')[1]['space'], 'share', '自分の合言葉で共有にも入る')
            self.assertEqual(call('GET', '/api/data', me, '../etc')[0], 401, '形の違う海は断る')
            self.assertEqual(call('GET', '/api/data', guest, 'swork123')[1]['space'], 'share',
                             '共有の合言葉はほかの海を言っても共有（端末が取り違えに気づく）')
            # 海の一覧
            seas = [{'id': 'swork123', 'name': '仕事', 'color': 'sand', 'at': 10, 'alive': 1},
                    {'id': 'share', 'name': '家族', 'color': 'moss', 'at': 10, 'alive': 1},
                    {'id': 'me', 'name': '個人', 'color': 'sand', 'at': 10, 'alive': 1}]
            code, out = call('POST', '/api/spaces', me, body={'spaces': seas})
            self.assertEqual(code, 200)
            self.assertEqual(sorted(e['id'] for e in out['spaces']), ['share', 'swork123'], '個人は一覧に入れない')
            self.assertEqual((d / 'seas.json').stat().st_mode & 0o777, 0o600)
            old = [{'id': 'swork123', 'name': '古い', 'color': 'sand', 'at': 5, 'alive': 1}]
            out = call('POST', '/api/spaces', me, body={'spaces': old})[1]
            self.assertEqual([e['name'] for e in out['spaces'] if e['id'] == 'swork123'], ['仕事'], '新しいほうが残る')
            code, out = call('POST', '/api/spaces', guest, body={'spaces': [
                {'id': 'share', 'name': '書き換え', 'color': 'ink', 'at': 99, 'alive': 0}]})
            self.assertEqual((code, out['spaces']), (200, [{'id': 'share', 'name': '家族', 'color': 'moss', 'at': 10, 'alive': 1}]),
                             '招かれた人には入れる海だけを返し、書き換えは受けない')
            self.assertEqual(call('POST', '/api/spaces', 'wrong', body={'spaces': []})[0], 401)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_share_add_rejects_duplicate_and_list_hides_token(self):
        d = self.data / 'cli'
        d.mkdir()
        server.token_command(d, 'share-add', '父')
        with self.assertRaises(SystemExit):
            server.token_command(d, 'share-add', '父')
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            server.token_command(d, 'share-list', '')
        out = buf.getvalue()
        for r in json.loads((d / 'share_tokens.json').read_text()):
            self.assertNotIn(r['token'], out, '一覧に合言葉の値を出さない')
            self.assertIn('…' + r['token'][-4:], out)

    def test_cors_preflight(self):
        code, _ = self.req('OPTIONS', '/api/data', token=None)
        self.assertEqual(code, 204)

    def test_cors_allows_schema_header(self):
        r = urllib.request.Request(self.base + '/api/data', method='OPTIONS')
        with urllib.request.urlopen(r) as res:
            self.assertIn('X-Bubbles-Schema', res.headers.get('Access-Control-Allow-Headers', ''))

    def test_old_client_without_schema_is_refused_426(self):
        """共有の記録 v1.1 §6: 頭書きの無い端末（前の版の bubble）の書き込みは、記録に触れずに 426"""
        doc = {'doc': {'todos': [{'id': 'g1', 'text': '架空', 'start': '2026-11-12', 'due': '2026-11-20',
                                  'project': 'tp', 'ext': {'gantt': {'goal': 'x'}}}]},
               'stamps': {'todo:g1': [5, 1]}, 'futureTop': {'k': 1}}
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': doc})[0], 200)
        stripped = {'doc': {'todos': [{'id': 'g1', 'text': '架空'}]}, 'stamps': {'todo:g1': [5, 1]}}
        for schema in (None, '0', 'x'):
            code, body = self.req('PUT', '/api/data', {'base': 1, 'data': stripped}, schema=schema)
            self.assertEqual((code, json.loads(body)), (426, {'error': 'upgrade', 'minSchema': 1}), schema)
        # 共有の海でも同じ
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': stripped}, token=SHARE, schema=None)[0], 426)
        # 記録は残っている（欄も、data の頂上の知らない欄も）。GET は頭書きが無くても断らない
        code, body = self.req('GET', '/api/data', schema=None)
        got = json.loads(body)
        self.assertEqual((code, got['version'], got['data'], got['minSchema']), (200, 1, doc, 1))
        self.assertEqual(json.loads(self.req('GET', '/api/data', token=SHARE)[1])['data'], None)

    def test_min_schema_2_refuses_schema_1(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        spaces = {TOKEN: ('me', server.Store(self.data))}
        self.httpd = server.Server(('127.0.0.1', 0), server.make_handler(spaces, server.Config(min_schema=2)))
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        code, body = self.req('GET', '/api/data')
        self.assertEqual((code, json.loads(body)['minSchema']), (200, 2))
        code, body = self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {}}})
        self.assertEqual((code, json.loads(body)), (426, {'error': 'upgrade', 'minSchema': 2}))
        self.assertEqual(self.req('PUT', '/api/data', {'base': 0, 'data': {'doc': {}}}, schema='2')[0], 200)
        self.assertEqual(self.req('PUT', '/api/data', {'base': 1, 'data': {'doc': {}}}, schema='3')[0], 200)

    def test_token_file_created(self):
        d = self.data / 'other'
        d.mkdir()
        tok = server.load_token(d)
        self.assertTrue(len(tok) >= 20)
        self.assertEqual(server.load_token(d), tok, '2回目は同じ合言葉を読む')
        self.assertEqual((d / 'token.txt').stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
