"""機械の鍵（共有の記録 v1.2 §8。server.py machine-add など）のテスト。標準ライブラリだけで走る。

    python3 -m unittest tests/test_server_machine.py

公開の形（--auth passkey）のサーバーを一時フォルダで立て、架空の記録だけで試す。
鍵は CLI（server.main）で作り、表示された1行から取る（gantt・diary・秘書に渡すのと同じ手順）。
要求には Origin を付けない（サーバー同士の要求）。
"""
import contextlib
import io
import json
import re
import stat
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402
from guard import Devices, Guard  # noqa: E402
from passkey_store import PasskeyStore  # noqa: E402


class MachineKeyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.pk = PasskeyStore(self.dir)
        self.guard = Guard(max_requests=500, max_fails=5)
        # 端末は 0 台まで：パスキーの端末なら必ず 429 {"error":"devices"}。機械の鍵は数えないので通る
        self.devices = Devices(max_active=0)
        cfg = server.Config(auth='passkey', origin='http://localhost:1', rp_id='localhost', guard=self.guard,
                            passkeys=self.pk, stores=server.SeaStores(self.dir), devices=self.devices,
                            sea_list=server.SeaList(self.dir), machines=server.MachineKeys(self.dir), allow_origins=())
        httpd = server.Server(('127.0.0.1', 0), server.make_handler({}, cfg))
        httpd.guard = self.guard
        self.httpd = httpd
        self.base = f'http://127.0.0.1:{httpd.server_address[1]}'
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.err = io.StringIO()
        self._stderr = contextlib.redirect_stderr(self.err)
        self._stderr.__enter__()

    def tearDown(self):
        self._stderr.__exit__(None, None, None)
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    # --- 道具 ---
    def cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = server.main(['--data-dir', str(self.dir), *args])
        return code, out.getvalue()

    def add_key(self, name, space='me', read_only=False):
        code, out = self.cli('machine-add', name, '--space', space, *(['--read-only'] if read_only else []))
        self.assertEqual(code, 0)
        m = re.search(r'(bm_[A-Za-z0-9_-]+)', out)
        self.assertTrue(m, out)
        return m.group(1)

    def req(self, method, path, key=None, body=None, space=None, schema='1'):
        r = urllib.request.Request(self.base + path, method=method,
                                   data=json.dumps(body).encode() if body is not None else None)
        if key:
            r.add_header('Authorization', 'Bearer ' + key)
        if space is not None:
            r.add_header('X-Bubbles-Space', space)
        if schema:
            r.add_header('X-Bubbles-Schema', schema)
        if body is not None:
            r.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(r) as res:
                return res.status, json.loads(res.read() or b'null')
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw or b'null')
            except ValueError:
                return e.code, None

    def put(self, key, base, todo_text, **kw):
        doc = {'v': 2, 'todos': [{'id': 'gmach1', 'text': todo_text, 'createdAt': 1}], 'tags': []}
        return self.req('PUT', '/api/data', key, {'base': base, 'data': {'doc': doc, 'stamps': {}}}, **kw)

    # --- CLI ---
    def test_cli_add_list_remove_keeps_only_hash(self):
        key = self.add_key('gantt')
        self.assertTrue(key.startswith('bm_') and len(key) >= 40)
        path = self.dir / 'machine_keys.json'
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        text = path.read_text(encoding='utf-8')
        self.assertNotIn(key, text, '鍵そのものはファイルに残さない')
        rows = json.loads(text)
        self.assertEqual(rows[0]['name'], 'gantt')
        self.assertEqual(rows[0]['hash'], server.MachineKeys.digest(key))
        self.assertEqual((rows[0]['space'], rows[0]['person'], rows[0]['read_only']), ('me', 1, False))
        self.add_key('diary', read_only=True)
        code, out = self.cli('machine-list')
        self.assertIn('gantt', out)
        self.assertIn('diary', out)
        self.assertIn('読むだけ', out)
        self.assertNotIn('bm_', out, '一覧に鍵を出さない')
        with self.assertRaises(SystemExit):
            self.cli('machine-add', 'gantt', '--space', 'me')            # 同じ名前
        with self.assertRaises(SystemExit):
            self.cli('machine-add', 'x')                                 # 置き場が無い
        with self.assertRaises(SystemExit):
            self.cli('machine-add', 'x', '--space', 'share')             # 個人だけ
        with self.assertRaises(SystemExit):
            self.cli('machine-add', 'x', '--space', 'me:7')              # いない人
        self.assertEqual(self.cli('machine-remove', 'gantt')[0], 0)
        with self.assertRaises(SystemExit):
            self.cli('machine-remove', 'gantt')
        self.assertEqual([r['name'] for r in json.loads(path.read_text(encoding='utf-8'))], ['diary'])

    # --- 入る ---
    def test_key_reads_and_writes_owner_personal_without_origin_or_device_slot(self):
        key = self.add_key('gantt')
        code, out = self.req('GET', '/api/data', key)                    # X-Bubbles-Space を省く
        self.assertEqual(code, 200)
        self.assertEqual((out['space'], out['version'], out['data'], out['minSchema']), ('me', 0, None, 1))
        self.assertEqual((out['owner'], out['person']), (False, 1))
        self.assertEqual(self.put(key, 0, '架空の作業')[:2], (200, {'version': 1}))
        code, out = self.req('GET', '/api/data', key, space='me')
        self.assertEqual((code, out['version'], out['data']['doc']['todos'][0]['text']), (200, 1, '架空の作業'))
        state = json.loads((self.dir / 'state.json').read_text(encoding='utf-8'))
        self.assertEqual(state['data']['doc']['todos'][0]['id'], 'gmach1', '持ち主の個人（state.json）に入る')
        self.assertEqual(self.put(key, 0, '古い base')[0], 409, '版の突き合わせは端末と同じ')
        self.assertEqual(self.devices.active(), 0, '端末の数に数えない')

    def test_key_for_another_person_goes_to_that_persons_box(self):
        self.pk.add_invite('持ち主の端末', ['me'])        # 1 番
        self.pk.add_invite('家族の端末', ['me'])          # 2 番
        key = self.add_key('家族の秘書', space='me:2')
        self.assertEqual(self.put(key, 0, '2 番の人の作業')[0], 200)
        self.assertTrue((self.dir / 'people' / '2' / 'state.json').exists())
        self.assertFalse((self.dir / 'state.json').exists(), '持ち主の記録には書かない')
        self.assertEqual(self.req('GET', '/api/data', key)[1]['person'], 2)

    def test_read_only_key_cannot_put(self):
        rw = self.add_key('gantt')
        self.put(rw, 0, '元の記録')
        ro = self.add_key('diary', read_only=True)
        self.assertEqual(self.req('GET', '/api/data', ro)[0], 200)
        code, out = self.put(ro, 1, '書き換え')
        self.assertEqual((code, out), (403, {'error': 'read only'}))
        self.assertEqual(self.req('GET', '/api/data', rw)[1]['data']['doc']['todos'][0]['text'], '元の記録')
        self.assertFalse(self.guard.auth_blocked('127.0.0.1'), '正しい鍵の 403 は入場の失敗に数えない')

    def test_key_does_not_open_other_spaces_or_other_apis(self):
        key = self.add_key('gantt')
        for sp in ('share', 'abc123', 'me/2'):
            self.assertEqual(self.req('GET', '/api/data', key, space=sp), (403, {'error': 'forbidden'}), sp)
            self.assertEqual(self.put(key, 0, 'x', space=sp)[0], 403, sp)
        self.assertFalse((self.dir / 'share' / 'state.json').exists())
        # ほかの API（海の一覧・出る）には効かない
        self.assertEqual(self.req('POST', '/api/spaces', key, {'spaces': []})[0], 401)
        # 出る API はいつも 200（通行証が無くても）。機械の鍵には触れない
        self.req('POST', '/api/passkey/logout', key, {})
        self.assertEqual(self.req('POST', '/api/passkey/register/options', key, {'invite': 'x'})[0], 401)
        self.assertEqual(self.req('GET', '/api/data', key)[0], 200, '出る API で鍵が消えない')

    def test_schema_rule_still_applies(self):
        key = self.add_key('gantt')
        self.assertEqual(self.put(key, 0, 'x', schema=None), (426, {'error': 'upgrade', 'minSchema': 1}))
        self.assertFalse((self.dir / 'state.json').exists())

    def test_removed_or_wrong_key_is_401_and_counts_as_failure(self):
        key = self.add_key('gantt')
        self.assertEqual(self.req('GET', '/api/data', key)[0], 200)
        self.cli('machine-remove', 'gantt')
        self.assertEqual(self.req('GET', '/api/data', key)[0], 401, '消した鍵は次の要求から入れない')
        for _ in range(4):
            self.assertEqual(self.req('GET', '/api/data', 'bm_' + 'x' * 43)[0], 401)
        self.assertEqual(self.req('GET', '/api/data', 'bm_wrong')[0], 429, '失敗が続けば guard が止める')

    def test_key_never_appears_in_log(self):
        rw = self.add_key('gantt')
        ro = self.add_key('diary', read_only=True)
        self.put(rw, 0, 'x')
        self.put(ro, 1, 'y')
        self.req('GET', '/api/data', rw, space='share')
        self.req('GET', '/api/data', rw + 'zz')
        log = self.err.getvalue()
        self.assertIn('machine-forbidden', log)
        self.assertIn('name=diary', log)
        self.assertIn('name=gantt', log)
        for k in (rw, ro, rw + 'zz'):
            self.assertNotIn(k, log)
            self.assertNotIn(k[3:20], log)

    def test_token_mode_does_not_take_machine_keys(self):
        key = self.add_key('gantt')
        spaces = {'fake-token-1': ('me', server.Store(self.dir / 'tokmode'))}
        httpd = server.Server(('127.0.0.1', 0), server.make_handler(spaces, server.Config(machines=server.MachineKeys(self.dir))))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            base, self.base = self.base, f'http://127.0.0.1:{httpd.server_address[1]}'
            self.assertEqual(self.req('GET', '/api/data', key)[0], 401, '合言葉の形では token.txt だけ')
            self.assertEqual(self.req('GET', '/api/data', 'fake-token-1')[0], 200)
        finally:
            self.base = base
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
