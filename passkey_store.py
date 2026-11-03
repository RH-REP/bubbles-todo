"""パスキーでの入場に使うものを預かる（2026-10-24。server.py が使う）。

<データの場所>/ に置くもの（どれも所有者だけが読める 600。サーバーを止めずに書き換えてよい）:
    passkeys.json   登録したパスキー [{id, name, spaces, alg, public_key, sign_count, created, last_used}]
                    公開鍵だけ。秘密の鍵は端末の中にあり、ここには無い
    invites.json    招待コード [{name, spaces, code_hash, expires, created}]
                    コードそのものは置かない（sha256 だけ）。1回使えば消える。期限は既定 24 時間
    sessions.json   通行証 [{hash, cred_id, spaces, expires}]
                    パスキーで入ったあとに出す。値そのものは置かない（sha256 だけ）。期限は既定 30 日

置き場（space）は 'me'（個人）と、名前を付けた海の ID（'share' は前の版の「共有」。
ほかは 's' と英小文字・数字。2026-11-02 Issue #4）。招待コードを作るときに、どこに入れるかを決める。
登録できるパスキーは、置き場ごとに max_per_space（既定 3）まで（2026-10-24 利用者の指示）。
「個人と共有」の端末は両方の数に入る。いっぱいの置き場には、招待コードも作らず、登録も受けない。

■ 個人は人ごと（2026-11-03 利用者の指示：個人は、その人の端末どうしだけで共有する箱）
'me' は「その人の個人」で、人はサーバーに登録した順の番号（person。1, 2, 3…）で分ける。
'me' に入れるパスキーと招待コードは person を持つ（無い古い行は 1）。
1 番はサーバーを立てた人（持ち主）。記録は前の版の個人の置き場のまま、どの海にも入れる（server.py）。
ほかの番号の人は、自分の個人と、招かれた海だけ。個人の登録の数は、人ごとに数える。
"""
import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path

INVITE_TTL = 24 * 3600
MAX_PER_SPACE = 3
SESSION_TTL = 30 * 24 * 3600
CHALLENGE_TTL = 300
SPACES = ('me', 'share')   # 前の版からある置き場（ほかに名前を付けた海。valid_space）
SEA_RE = re.compile(r'^s[0-9a-z]{3,23}$')


def valid_space(space) -> bool:
    """置き場の名前として通すか。'me' か海の ID（'share' もこの形に入る）"""
    return isinstance(space, str) and (space == 'me' or bool(SEA_RE.match(space)))


def space_label(space: str) -> str:
    return {'me': '個人', 'share': '共有'}.get(space, '海 ' + space)


OWNER = 1   # 持ち主（サーバーを立てた人）の個人の番号


def person_of(row):
    """パスキー・招待コードの行の個人の番号。個人に入れないなら None。番号の無い古い行は持ち主（1）"""
    if 'me' not in (row.get('spaces') or []):
        return None
    try:
        n = int(row.get('person') or OWNER)
    except (TypeError, ValueError):
        return OWNER
    return n if n >= 1 else OWNER


def person_label(person) -> str:
    return f'個人 {person}' + ('（持ち主）' if person == OWNER else '')
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
    def count_in(self, space: str, person=None, rows=None) -> int:
        """その置き場のパスキーの数。個人（me）は person の人のぶんだけ数える"""
        rows = self.passkeys() if rows is None else rows
        if space == 'me':
            return sum(1 for r in rows if person_of(r) == person)
        return sum(1 for r in rows if space in r.get('spaces', []))

    def full_spaces(self, spaces, person=None, rows=None):
        """spaces のうち、もう max_per_space 台のパスキーがある置き場"""
        return [s for s in spaces if self.count_in(s, person, rows) >= self.max_per_space]

    # --- 個人の番号 ---
    def persons(self):
        """いる人の番号（パスキーと、使われていない招待コードから）"""
        rows = self.passkeys() + self.list_invites()
        return sorted({p for p in (person_of(r) for r in rows) if p is not None})

    def next_person(self) -> int:
        """新しい人の番号（登録した順）。まだ誰もいなければ持ち主の 1"""
        got = self.persons()
        return (max(got) + 1) if got else OWNER

    # --- 招待コード ---
    def add_invite(self, name: str, spaces, ttl: int = INVITE_TTL, person=None) -> str:
        """招待コードを作る。個人（me）を含むなら person の人の端末にする（省けば新しい人）"""
        return self.add_invite_full(name, spaces, ttl, person)[0]

    def add_invite_full(self, name: str, spaces, ttl: int = INVITE_TTL, person=None):
        """(コード, 個人の番号か None)"""
        name = (name or '').strip()
        spaces = list(dict.fromkeys(s for s in spaces if valid_space(s)))
        if not name or not spaces:
            raise ValueError('名前と置き場（me・share・海の ID）が要ります')
        if 'me' in spaces:
            if person is None:
                person = self.next_person()
            else:
                person = int(person)
                if person != OWNER and person not in self.persons():
                    raise ValueError(f'個人 {person} の人はいません（passkey-list で番号を確かめる。新しい人なら番号を付けない）')
        else:
            person = None
        full = self.full_spaces(spaces, person)
        if full:
            raise ValueError('登録はいっぱい（' + '・'.join(person_label(person) if s == 'me' else space_label(s) for s in full)
                             + f'は {self.max_per_space} 台まで）。passkey-remove で使わない端末を外してから')
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(12))
        with self.lock:
            rows = [r for r in self._read('invites.json') if r['expires'] > self.clock()]
            row = {'name': name, 'spaces': spaces, 'code_hash': _sha(raw),
                   'expires': self.clock() + ttl, 'created': self.clock()}
            if person is not None:
                row['person'] = person
            rows.append(row)
            self._write('invites.json', rows)
        return '-'.join(raw[i:i + 4] for i in range(0, 12, 4)), person

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

    def add_passkey(self, *, name, spaces, cred, person=None):
        person = (person or OWNER) if 'me' in spaces else None
        with self.lock:
            rows = self._read('passkeys.json')
            if any(r['id'] == cred['cred_id'] for r in rows):
                raise ValueError('同じパスキーがもうある')
            if self.full_spaces(spaces, person, rows):
                raise ValueError('登録はいっぱい')
            base, n, names = name, 2, {r['name'] for r in rows}
            while name in names:          # 同じ名前を2つにしない（取り消しを名前でするため）
                name = f'{base} ({n})'
                n += 1
            rows.append({'id': cred['cred_id'], 'name': name, 'spaces': list(spaces), 'alg': cred['alg'],
                         'public_key': cred['public_key'], 'sign_count': cred['sign_count'],
                         'created': self.clock(), 'last_used': None})
            if person is not None:
                rows[-1]['person'] = person
            self._write('passkeys.json', rows)
        return name

    def set_person(self, name: str, person) -> int:
        """名前のパスキーを、ほかの人の個人へ移す。person は番号か 'new'（新しい人）。移した先の番号を返す。
        通行証はそのまま（個人の番号は使うたびにパスキーの行から引くので、次の要求から移った先に入る）"""
        new = person == 'new'
        target = self.next_person() if new else int(person)
        with self.lock:
            rows = self._read('passkeys.json')
            hit = [r for r in rows if r['name'] == name]
            if not hit:
                raise ValueError(f'「{name}」は見つかりません（passkey-list で名前を確かめる）')
            r = hit[0]
            if 'me' not in r.get('spaces', []):
                raise ValueError(f'「{name}」は個人に入れないパスキーです')
            known = {person_of(x) for x in rows + self.list_invites()}
            if not new and target != OWNER and target not in known:
                raise ValueError(f'個人 {target} の人はいません（新しい人にするなら new）')
            if person_of(r) != target and self.count_in('me', target, rows) >= self.max_per_space:
                raise ValueError(f'{person_label(target)}の登録はいっぱい（{self.max_per_space} 台まで）')
            r['person'] = target
            self._write('passkeys.json', rows)
        return target

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
        """通行証 → {spaces, cred_id, person, owner}。期限切れ・取り消し済みなら None。
        person（個人の番号）は、いまのパスキーの行から引く（set_person がすぐ効く）"""
        if not tok:
            return None
        h = _sha(tok)
        keys = {r['id']: r for r in self.passkeys()}
        for s in self._read('sessions.json'):
            if s['expires'] > self.clock() and secrets.compare_digest(s['hash'], h):
                pk = keys.get(s['cred_id'])
                if not pk:            # パスキーを消したら、その通行証は使えない
                    return None
                spaces = [sp for sp in s['spaces'] if sp in pk['spaces']]
                person = person_of(pk) if 'me' in spaces else None
                return {'spaces': spaces, 'cred_id': s['cred_id'], 'person': person, 'owner': person == OWNER}
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
