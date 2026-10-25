"""パスキーでの入場に使うものを預かる（2026-10-24。server.py が使う）。

<データの場所>/ に置くもの（どれも所有者だけが読める 600。サーバーを止めずに書き換えてよい）:
    passkeys.json   登録したパスキー [{id, name, spaces, alg, public_key, sign_count, created, last_used}]
                    公開鍵だけ。秘密の鍵は端末の中にあり、ここには無い
    invites.json    招待コード [{name, spaces, code_hash, expires, created}]
                    コードそのものは置かない（sha256 だけ）。1回使えば消える。期限は既定 24 時間
    sessions.json   通行証 [{hash, cred_id, spaces, expires}]
                    パスキーで入ったあとに出す。値そのものは置かない（sha256 だけ）。期限は既定 30 日

置き場（space）は 'me'（個人）と 'share'（共有）。招待コードを作るときに、どちらに入れるかを決める。
登録できるパスキーは、置き場ごとに max_per_space（既定 3）まで（2026-10-24 利用者の指示）。
「個人と共有」の端末は両方の数に入る。いっぱいの置き場には、招待コードも作らず、登録も受けない。
"""
import hashlib
import json
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path

INVITE_TTL = 24 * 3600
MAX_PER_SPACE = 3
SESSION_TTL = 30 * 24 * 3600
CHALLENGE_TTL = 300
SPACES = ('me', 'share')
_CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # 読み違えやすい I・O・0・1 を外す


def _now() -> int:
    return int(time.time())


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def _write_private(path: Path, rows):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def normalize_code(code: str) -> str:
    return ''.join(c for c in str(code or '').upper() if c in _CODE_ABC)


class PasskeyStore:
    def __init__(self, data_dir: Path, clock=_now, max_per_space: int = MAX_PER_SPACE):
        self.max_per_space = max_per_space
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.lock = threading.Lock()
        self.challenges = {}   # challenge → {kind, invite_hash, expires}

    # --- ファイル ---
    def _path(self, name):
        return self.dir / name

    def _read(self, name):
        p = self._path(name)
        if not p.exists():
            return []
        with p.open(encoding='utf-8') as f:
            rows = json.load(f)
        return rows if isinstance(rows, list) else []

    def _write(self, name, rows):
        _write_private(self._path(name), rows)

    # --- 置き場ごとの数 ---
    def count_in(self, space: str) -> int:
        return sum(1 for r in self.passkeys() if space in r.get('spaces', []))

    def full_spaces(self, spaces):
        """spaces のうち、もう max_per_space 台のパスキーがある置き場"""
        return [s for s in spaces if self.count_in(s) >= self.max_per_space]

    # --- 招待コード ---
    def add_invite(self, name: str, spaces, ttl: int = INVITE_TTL) -> str:
        name = (name or '').strip()
        spaces = [s for s in spaces if s in SPACES]
        if not name or not spaces:
            raise ValueError('名前と置き場（me / share）が要ります')
        full = self.full_spaces(spaces)
        if full:
            raise ValueError('登録はいっぱい（' + '・'.join({'me': '個人', 'share': '共有'}[s] for s in full)
                             + f'は {self.max_per_space} 台まで）。passkey-remove で使わない端末を外してから')
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(12))
        with self.lock:
            rows = [r for r in self._read('invites.json') if r['expires'] > self.clock()]
            rows.append({'name': name, 'spaces': spaces, 'code_hash': _sha(raw),
                         'expires': self.clock() + ttl, 'created': self.clock()})
            self._write('invites.json', rows)
        return '-'.join(raw[i:i + 4] for i in range(0, 12, 4))

    def find_invite(self, code: str):
        h = _sha(normalize_code(code))
        for r in self._read('invites.json'):
            if r['expires'] > self.clock() and secrets.compare_digest(r['code_hash'], h):
                return r
        return None

    def use_invite(self, code_hash: str) -> bool:
        with self.lock:
            rows = self._read('invites.json')
            keep = [r for r in rows if r['code_hash'] != code_hash and r['expires'] > self.clock()]
            hit = len(keep) != len([r for r in rows if r['expires'] > self.clock()])
            self._write('invites.json', keep)
            return hit

    def list_invites(self):
        return [r for r in self._read('invites.json') if r['expires'] > self.clock()]

    # --- 問題（challenge）。1回きり・5分 ---
    def new_challenge(self, kind: str, invite_hash: str = None) -> str:
        from passkey_crypto import b64u_encode
        c = b64u_encode(secrets.token_bytes(32))
        with self.lock:
            now = self.clock()
            self.challenges = {k: v for k, v in self.challenges.items() if v['expires'] > now}
            if len(self.challenges) > 2000:   # 溢れさせない（古いものから捨てる）
                for k in sorted(self.challenges, key=lambda k: self.challenges[k]['expires'])[:500]:
                    del self.challenges[k]
            self.challenges[c] = {'kind': kind, 'invite_hash': invite_hash, 'expires': now + CHALLENGE_TTL}
        return c

    def take_challenge(self, c: str, kind: str):
        """問題を取り出す（2度は使えない）。合わなければ None"""
        with self.lock:
            v = self.challenges.pop(c, None) if isinstance(c, str) else None
        if not v or v['kind'] != kind or v['expires'] <= self.clock():
            return None
        return v

    # --- パスキー ---
    def passkeys(self):
        return self._read('passkeys.json')

    def find_passkey(self, cred_id: str):
        for r in self.passkeys():
            if r['id'] == cred_id:
                return r
        return None

    def add_passkey(self, *, name, spaces, cred):
        with self.lock:
            rows = self._read('passkeys.json')
            if any(r['id'] == cred['cred_id'] for r in rows):
                raise ValueError('同じパスキーがもうある')
            if any(sum(1 for r in rows if s in r.get('spaces', [])) >= self.max_per_space for s in spaces):
                raise ValueError('登録はいっぱい')
            base, n, names = name, 2, {r['name'] for r in rows}
            while name in names:          # 同じ名前を2つにしない（取り消しを名前でするため）
                name = f'{base} ({n})'
                n += 1
            rows.append({'id': cred['cred_id'], 'name': name, 'spaces': list(spaces), 'alg': cred['alg'],
                         'public_key': cred['public_key'], 'sign_count': cred['sign_count'],
                         'created': self.clock(), 'last_used': None})
            self._write('passkeys.json', rows)
        return name

    def touch_passkey(self, cred_id: str, sign_count: int):
        with self.lock:
            rows = self._read('passkeys.json')
            for r in rows:
                if r['id'] == cred_id:
                    r['sign_count'] = sign_count
                    r['last_used'] = self.clock()
            self._write('passkeys.json', rows)

    def remove_passkey(self, name: str) -> bool:
        """名前のパスキーを消し、その通行証もすべて消す（その端末は次の要求から入れない）"""
        with self.lock:
            rows = self._read('passkeys.json')
            gone = {r['id'] for r in rows if r['name'] == name}
            if not gone:
                return False
            self._write('passkeys.json', [r for r in rows if r['id'] not in gone])
            self._write('sessions.json', [s for s in self._read('sessions.json') if s['cred_id'] not in gone])
            return True

    # --- 通行証 ---
    def new_session(self, cred_id: str, spaces, ttl: int = SESSION_TTL):
        tok = secrets.token_urlsafe(32)
        with self.lock:
            now = self.clock()
            rows = [s for s in self._read('sessions.json') if s['expires'] > now]
            rows.append({'hash': _sha(tok), 'cred_id': cred_id, 'spaces': list(spaces), 'expires': now + ttl})
            self._write('sessions.json', rows)
        return tok, now + ttl

    def session_info(self, tok: str):
        """通行証 → {spaces, cred_id}。期限切れ・取り消し済みなら None"""
        if not tok:
            return None
        h = _sha(tok)
        keys = {r['id']: r for r in self.passkeys()}
        for s in self._read('sessions.json'):
            if s['expires'] > self.clock() and secrets.compare_digest(s['hash'], h):
                pk = keys.get(s['cred_id'])
                if not pk:            # パスキーを消したら、その通行証は使えない
                    return None
                return {'spaces': [sp for sp in s['spaces'] if sp in pk['spaces']], 'cred_id': s['cred_id']}
        return None

    def check_session(self, tok: str):
        """通行証 → その置き場の一覧。期限切れ・取り消し済みなら None"""
        info = self.session_info(tok)
        return info['spaces'] if info else None

    def end_session(self, tok: str):
        """通行証を捨てる。その通行証のパスキーの id を返す（無ければ None）"""
        info = self.session_info(tok)
        h = _sha(tok or '')
        with self.lock:
            rows = self._read('sessions.json')
            self._write('sessions.json', [s for s in rows if s['hash'] != h])
        return info['cred_id'] if info else None
