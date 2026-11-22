"""プロセスをまたぐ錠（filelock.py）のテスト。2つの server.py が同じ記録の置き場を書く形（2026-11-17）。

    python3 -m unittest tests/test_filelock.py

別々のプロセスが同じ置き場へ「読む → 1 足す → 版つきで書く（合わなければ読み直す）」を同時にくり返し、
足した数が1つも消えないことを見る。錠が無いと、版を確かめてから書くまでの間に割り込まれて、足した数が消えうる。
"""
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

WRITER = textwrap.dedent('''
    import sys
    sys.path.insert(0, sys.argv[1])
    from pathlib import Path
    import server
    st = server.Store(Path(sys.argv[2]))
    n = int(sys.argv[3])
    done = 0
    while done < n:
        cur = st.read()
        data = cur['data'] or {'doc': {'count': 0}}
        data = {'doc': {'count': data['doc']['count'] + 1}}
        ok, _ = st.write(cur['version'], data)
        if ok:
            done += 1
''')

INVITER = textwrap.dedent('''
    import sys
    sys.path.insert(0, sys.argv[1])
    from pathlib import Path
    from passkey_store import PasskeyStore
    pk = PasskeyStore(Path(sys.argv[2]), max_per_space=1000)
    for i in range(int(sys.argv[3])):
        pk.add_invite(sys.argv[4] + str(i), ['share'])
''')


class FileLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_all(self, script, args_list):
        procs = [subprocess.Popen([sys.executable, '-c', script, str(ROOT), str(self.dir), *a]) for a in args_list]
        for p in procs:
            self.assertEqual(p.wait(timeout=120), 0)

    def test_two_processes_do_not_lose_writes(self):
        self.run_all(WRITER, [['150'], ['150'], ['150']])
        cur = json.loads((self.dir / 'state.json').read_text(encoding='utf-8'))
        self.assertEqual(cur['data']['doc']['count'], 450, '足した数が消えた（プロセスの間で割り込まれた）')
        self.assertEqual(cur['version'], 450)

    def test_two_processes_add_invites(self):
        self.run_all(INVITER, [['40', 'a'], ['40', 'b'], ['40', 'c']])
        rows = json.loads((self.dir / 'invites.json').read_text(encoding='utf-8'))
        self.assertEqual(len(rows), 120, '招待コードの行が消えた')

    def test_nested_in_one_thread(self):
        sys.path.insert(0, str(ROOT))
        from filelock import DirLock
        lock = DirLock(self.dir / '.lock-x')
        with lock:
            with lock:
                pass
        with lock:      # 外したあとにもう一度取れる
            pass


if __name__ == '__main__':
    unittest.main()
