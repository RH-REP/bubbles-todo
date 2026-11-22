"""プロセスをまたぐ錠（2026-11-17）。同じ記録の置き場を、2つの server.py（例: 前の住所と新しい住所）と
VM のコマンド（oauth-revoke・machine-add など）が同時に書いても、読んでから書くまでの間に割り込まれないようにする。

    lock = DirLock(<置き場>/.lock-state)
    with lock:          # 同じスレッドの中では入れ子にしてよい（深さを数える）
        ...読む・確かめる・書く...

中身はスレッドの錠（RLock）と、錠のファイルへの flock（排他）。flock はプロセスが落ちると OS が外すので、残った錠で止まらない。
錠のファイルは置き場ごと・種類ごとに分ける（同じファイルを同じプロセスの別の錠で取ると、互いに待ってしまうため）。
fcntl の無い OS（Windows）ではスレッドの錠だけになる（サーバーは Linux・macOS で動かす）。
"""
import os
import threading
from pathlib import Path

try:
    import fcntl
except ImportError:      # pragma: no cover  Windows
    fcntl = None


class DirLock:
    def __init__(self, path):
        self.path = Path(path)
        self._t = threading.RLock()
        self._depth = 0
        self._fd = None

    def __enter__(self):
        self._t.acquire()
        if self._depth == 0 and fcntl is not None:
            try:
                self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                except BaseException:
                    os.close(fd)
                    raise
                self._fd = fd
            except BaseException:
                self._t.release()
                raise
        self._depth += 1
        return self

    def __exit__(self, *exc):
        self._depth -= 1
        if self._depth == 0 and self._fd is not None:
            fd, self._fd = self._fd, None
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
        self._t.release()
        return False
