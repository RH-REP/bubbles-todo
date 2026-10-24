"""接続元ごとに使わせる量を決める（2026-10-24。公開して使うときの守り。server.py が使う）。

    同時の接続      接続元ごと max_conn_per_ip、全体で max_conn（超えたら読まずに 429 で閉じる）
    要求の数        接続元ごと、window 秒に max_requests まで（超えたら 429）
    入場の失敗      接続元ごと、fail_window 秒に max_fails まで（合言葉・パスキー・招待コードの失敗。超えたら 429）

数えるのは記憶の中だけ（再起動で消える）。覚える接続元は max_ips まで（溢れたら古い順に忘れる）。
"""
import threading
import time
from collections import OrderedDict, deque


class Guard:
    def __init__(self, *, max_conn=64, max_conn_per_ip=8, max_requests=120, window=60,
                 max_fails=10, fail_window=600, max_ips=20000, clock=time.monotonic):
        self.max_conn, self.max_conn_per_ip = max_conn, max_conn_per_ip
        self.max_requests, self.window = max_requests, window
        self.max_fails, self.fail_window = max_fails, fail_window
        self.max_ips = max_ips
        self.clock = clock
        self.lock = threading.Lock()
        self.active = 0
        self.conns = {}                 # ip → 今の接続数
        self.reqs = OrderedDict()       # ip → deque(時刻)
        self.fails = OrderedDict()      # ip → deque(時刻)

    # --- 接続 ---
    def open(self, ip, per_ip=True) -> bool:
        """接続を受けてよいか。よければ数に入れる（必ず close で返す）"""
        with self.lock:
            if self.active >= self.max_conn:
                return False
            if per_ip and self.conns.get(ip, 0) >= self.max_conn_per_ip:
                return False
            self.active += 1
            if per_ip:
                self.conns[ip] = self.conns.get(ip, 0) + 1
            return True

    def close(self, ip, per_ip=True):
        with self.lock:
            self.active = max(0, self.active - 1)
            if per_ip and ip in self.conns:
                self.conns[ip] -= 1
                if self.conns[ip] <= 0:
                    del self.conns[ip]

    # --- 要求と失敗（滑る窓で数える） ---
    def _hit(self, table, ip, limit, window, record):
        now = self.clock()
        q = table.get(ip)
        if q is None:
            if not record:
                return True
            q = table[ip] = deque()
            while len(table) > self.max_ips:
                table.popitem(last=False)
        else:
            table.move_to_end(ip)
        while q and now - q[0] >= window:
            q.popleft()
        if len(q) >= limit:
            return False
        if record:
            q.append(now)
        return True

    def request(self, ip) -> bool:
        """要求を受けてよいか（数に入れる）"""
        with self.lock:
            return self._hit(self.reqs, ip, self.max_requests, self.window, True)

    def auth_blocked(self, ip) -> bool:
        """入場の失敗が続いて、今は断る接続元か（数には入れない）"""
        with self.lock:
            return not self._hit(self.fails, ip, self.max_fails, self.fail_window, False)

    def auth_failed(self, ip):
        with self.lock:
            q = self.fails.get(ip)
            if q is None:
                q = self.fails[ip] = deque()
                while len(self.fails) > self.max_ips:
                    self.fails.popitem(last=False)
            q.append(self.clock())
            while len(q) > self.max_fails * 2:
                q.popleft()


class Devices:
    """同時に使っている端末（パスキー）を max_active 台までにする（2026-10-24 利用者の指示。既定 3）。

    window 秒以内に記録を読み書きした端末を「使っている」と数える。数に入っている端末はいつでも通す。
    入っていない端末は、使っている端末が max_active 台に届いていたら断る（429 devices）。
    window 秒使わなかった端末は数から外れる。出た（logout）端末はすぐ外す。数えるのは記憶の中だけ"""

    def __init__(self, max_active=3, window=1800, clock=time.monotonic):
        self.max_active, self.window, self.clock = max_active, window, clock
        self.lock = threading.Lock()
        self.last = {}   # cred_id → 最後に使った時刻

    def use(self, cred_id) -> bool:
        with self.lock:
            now = self.clock()
            self.last = {k: t for k, t in self.last.items() if now - t < self.window}
            if cred_id not in self.last and len(self.last) >= self.max_active:
                return False
            self.last[cred_id] = now
            return True

    def leave(self, cred_id):
        with self.lock:
            self.last.pop(cred_id, None)

    def active(self) -> int:
        with self.lock:
            now = self.clock()
            return sum(1 for t in self.last.values() if now - t < self.window)
