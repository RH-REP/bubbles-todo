"""パスキーでの入場に使うものを預かる（2026-10-24。server.py が使う）。

<データの場所>/ に置くもの（どれも所有者だけが読める 600。サーバーを止めずに書き換えてよい）:
    passkeys.json   登録したパスキー [{id, name, spaces, alg, public_key, sign_count, created, last_used}]
                    公開鍵だけ。秘密の鍵は端末の中にあり、ここには無い
    invites.json    招待コード [{name, spaces, code_hash, expires, created}]
                    コードそのものは置かない（sha256 だけ）。1回使えば消える。期限は既定 24 時間
                    kind 'move' の行は引っ越しの鍵（Issue #19。from = 作った端末のパスキー。期限 10 年）
    sessions.json   通行証 [{hash, cred_id, spaces, expires}]
                    パスキーで入ったあとに出す。値そのものは置かない（sha256 だけ）。期限は既定 30 日
    requests.json   端末からの登録の頼み（2026-11-07 Issue #26）[{code, name, key_hash, ip, created, expires}]
                    ip は接続元の sha256 の頭 16 字（1つの接続元から頼める数を数えるためだけ）
                    端末が先に頼み、持ち主がサーバーで request-ok <確かめの字> で認める。
                    認めると、端末が持っている鍵（key。sha256 だけ置く）がそのまま招待コード（kind 'request'）になる
    recovery.json   復元の鍵（2026-11-19）[{user, hash, created, last_used, notice}]
                    鍵そのものは置かない（sha256 だけ）。利用者 1 人に 1 つ。期限は無く、使っても消えない（消すまで有効）。
                    notice = 最後に鍵で端末を足したときの {at, cred, device}（ほかの端末に知らせる。鍵を消しても残す）
    limits.json     上限（Issue #26）{"max_per_space": n}。limit-set で書き、止めずに次の要求から効く。
                    無ければ --max-passkeys（既定 3）

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

from filelock import DirLock

INVITE_TTL = 24 * 3600
MAX_PER_SPACE = 3
SESSION_TTL = 30 * 24 * 3600
CHALLENGE_TTL = 300
MOVE_TTL = 10 * 365 * 24 * 3600   # 引っ越しの鍵（Issue #19）。ファイルに入れて長く置くので 10 年
MOVE_LEN = 24                     # 引っ越しの鍵の字数（32 種の字 × 24 ＝ 120 ビット）
REQUEST_TTL = 24 * 3600           # 端末からの登録の頼み（Issue #26）を待つ長さ
REQUEST_MAX = 10                  # 待っている頼みの数（溢れさせない）
REQUEST_PER_IP = 3                # 1つの接続元から待たせておける頼みの数
REQUEST_CODE_LEN = 6              # 持ち主が端末の画面と見比べる字（秘密ではない）
LIMIT_MAX = 100                   # limit-set で入れられる上限の上限
USER_RE = re.compile(r'^u_[0-9a-f]{8}$')     # 利用者の番号（2026-11-18）
ROLES = ('owner', 'editor', 'viewer')       # 海の仲間の役割
MEMBER_MAX = 50                             # 1 つの海の仲間の数の上限
DEVICE_TTL = 600                            # 端末を足す番号（10 分・1 回）
DEVICE_LEN = 6
RECOVERY_LEN = 24                           # 復元の鍵の字数（引っ越しの鍵と同じ 32 種の字 × 24 ＝ 120 ビット。4 字ずつ - で区切る）
RECOVERY_INVITE_TTL = 600                   # 鍵が合ってから登録を終えるまで（その間だけの 1 回の招待）
# 利用者のアイコン（2026-11-18 ユーザーの指示「左上にはuserアイコンをつけて、全てのアプリで同じユーザーでログインしていることがわかる様に
# （初期はランダムで、自分でプリセットからつけられる）」）。絵文字と背景の色の組。画像は使わない。id は変えない（users.json に残る）
AVATARS = (
    ('fox', '🦊', '#e8833a'), ('cat', '🐱', '#e0a526'), ('dog', '🐶', '#b07a1c'), ('bear', '🐻', '#8d6e63'),
    ('panda', '🐼', '#6b6b6b'), ('rabbit', '🐰', '#e57fa3'), ('frog', '🐸', '#3f8a4a'), ('owl', '🦉', '#7a52b8'),
    ('whale', '🐳', '#2f7bbf'), ('octopus', '🐙', '#c2412d'), ('penguin', '🐧', '#455a64'), ('turtle', '🐢', '#2e8b74'),
    ('bee', '🐝', '#c99a06'), ('sunflower', '🌻', '#c98a00'), ('cactus', '🌵', '#5b8c3a'), ('mushroom', '🍄', '#b5473a'),
)
AVATAR_IDS = tuple(a[0] for a in AVATARS)


def avatar_info(preset):
    """プリセットの id → {preset, emoji, color}。知らない id は None"""
    a = next((x for x in AVATARS if x[0] == preset), None)
    return {'preset': a[0], 'emoji': a[1], 'color': a[2]} if a else None


SPACES = ('me', 'share')   # 前の版からある置き場（ほかに名前を付けた海。valid_space）
SEA_RE = re.compile(r'^s[0-9a-z]{3,23}$')


def valid_space(space) -> bool:
    """置き場の名前として通すか。'me' か海の ID（'share' もこの形に入る）"""
    return isinstance(space, str) and (space == 'me' or bool(SEA_RE.match(space)))


def space_label(space: str) -> str:
    return {'me': '個人', 'share': '共有'}.get(space, '海 ' + space)


OWNER = 1   # 1 番の人の個人の番号（記録は前の版の置き場 state.json。2026-11-16 からは、ほかの人と同じ扱い）


def person_of(row):
    """パスキー・招待コードの行の個人の番号。個人に入れないなら None。番号の無い古い行は持ち主（1）"""
    if 'me' not in (row.get('spaces') or []):
        return None
    try:
        n = int(row.get('person') or OWNER)
    except (TypeError, ValueError):
        return OWNER
    return n if n >= 1 else OWNER


def clean_name(name) -> str:
    """利用者・端末の呼び名（制御文字を外し、40 字まで）"""
    return re.sub(r'[\x00-\x1f\x7f]', '', str(name or '')).strip()[:40]


def person_label(person) -> str:
    return f'個人 {person}'
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
        self.default_max = max_per_space
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        # プロセスをまたぐ錠（2026-11-17。2つの server.py と VM のコマンドが同じ置き場を書くため）
        self.lock = DirLock(self.dir / '.lock-passkeys')
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

    # --- 上限（Issue #26: あとから変えられる。limits.json が --max-passkeys より先）---
    @property
    def max_per_space(self) -> int:
        p = self._path('limits.json')
        try:
            with p.open(encoding='utf-8') as f:
                n = json.load(f).get('max_per_space')
            if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= LIMIT_MAX:
                return n
        except (OSError, ValueError, AttributeError):
            pass
        return self.default_max

    @max_per_space.setter
    def max_per_space(self, n):
        self.default_max = n

    def set_limit(self, n) -> int:
        """置き場ごとの登録の上限を変える（limits.json）。止めずに次の要求から効く。
        今の数より小さくしても、登録してあるパスキーは外さない（新しい登録だけを断る）"""
        try:
            n = int(str(n).strip())
        except (TypeError, ValueError):
            raise ValueError('上限は数で入れる（例 limit-set 5）') from None
        if not 1 <= n <= LIMIT_MAX:
            raise ValueError(f'上限は 1 から {LIMIT_MAX} まで')
        with self.lock:
            _write_private(self._path('limits.json'), {'max_per_space': n})
        return n

    def over_limit(self):
        """上限を下げたあと、上限より多く入っている置き場 → [(ラベル, 数)]"""
        rows = self.passkeys()
        out = [(person_label(n), self.count_in('me', n, rows)) for n in self.persons()]
        seas = dict.fromkeys(s for r in rows for s in r.get('spaces', []) if s != 'me')
        out += [(space_label(s), self.count_in(s, None, rows)) for s in seas]
        return [(lab, c) for lab, c in out if c > self.max_per_space]

    # --- 端末からの登録の頼み（2026-11-07 Issue #26）---
    # 端末が先に頼む（名前だけ送る）→ サーバーは確かめの字（code）と鍵（key）を返す。
    # 持ち主は request-list で端末の画面と同じ字を見つけ、request-ok <字> --space … で認める。
    # 認めると、鍵の sha256 を招待コードの行（kind 'request'）に入れる。端末は鍵を招待コードにして登録する。
    def add_request(self, name: str, ip: str = ''):
        """→ (鍵, 確かめの字, 期限)。名前は端末が付けた呼び名（40 字まで）"""
        name = re.sub(r'[\x00-\x1f\x7f]', '', str(name or '')).strip()[:40]
        if not name:
            raise ValueError('名前が要ります')
        key = ''.join(secrets.choice(_CODE_ABC) for _ in range(MOVE_LEN))
        ip = _sha(ip)[:16] if ip else ''   # 接続元は数えるためだけ。そのものは置かない
        with self.lock:
            now = self.clock()
            rows = [r for r in self._read('requests.json') if r['expires'] > now]
            if len(rows) >= REQUEST_MAX or sum(1 for r in rows if ip and r.get('ip') == ip) >= REQUEST_PER_IP:
                raise OverflowError('待っている頼みが多い')
            used = {r['code'] for r in rows}
            while True:
                raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(REQUEST_CODE_LEN))
                code = raw[:3] + '-' + raw[3:]
                if code not in used:
                    break
            rows.append({'code': code, 'name': name, 'key_hash': _sha(key), 'ip': ip,
                         'created': now, 'expires': now + REQUEST_TTL})
            self._write('requests.json', rows)
        return '-'.join(key[i:i + 4] for i in range(0, MOVE_LEN, 4)), code, now + REQUEST_TTL

    def list_requests(self):
        return [r for r in self._read('requests.json') if r['expires'] > self.clock()]

    def find_request(self, code: str):
        c = normalize_code(code)
        c = c[:3] + '-' + c[3:]
        return next((r for r in self.list_requests() if r['code'] == c), None)

    def request_state(self, key: str):
        """端末が聞く、頼みの様子 → 'approved' | 'waiting' | None（断られた・期限切れ・知らない鍵）"""
        h = _sha(normalize_code(key))
        inv = next((r for r in self.list_invites() if secrets.compare_digest(r['code_hash'], h)), None)
        if inv and inv.get('kind') == 'request':
            return 'approved', inv
        if any(secrets.compare_digest(r['key_hash'], h) for r in self.list_requests()):
            return 'waiting', None
        return None, None

    def approve_request(self, code: str, spaces, person=None):
        """頼みを認める → (名前, 個人の番号か None)。招待コードの行を作り、頼みは消す"""
        req = self.find_request(code)
        if not req:
            raise ValueError(f'「{code}」の頼みはありません（request-list で確かめる。期限は 24 時間）')
        name, person = self._invite_row(req['name'], spaces, person, req['key_hash'], kind='request')
        self.deny_request(req['code'])
        return name, person

    def deny_request(self, code: str) -> bool:
        req = self.find_request(code)
        if not req:
            return False
        with self.lock:
            rows = self._read('requests.json')
            self._write('requests.json', [r for r in rows if r['code'] != req['code']])
        return True

    # --- 利用者と海の仲間（2026-11-18 ユーザーの決定。取り決め AI_note/アプリのデザイン/261118_利用者登録と個人・共有の海/実装の取り決め.md §2）---
    # users.json    [{id: 'u_' + 16 進 8 桁, name, person, created}]
    #               person は個人の記録の置き場の番号（1 は state.json、ほかは people/<番号>/）。1 人に 1 つ必ずある
    # members.json  [{sea, user, role}]  role は owner（持ち主）・editor（書ける）・viewer（見るだけ）
    # パスキーの行は user を持つ（前の行は migrate() で人の番号から足す。行は消さない。ログインはパスキーの番号で引く）。
    # 前の行の spaces・person は消さずに残すが、入れる海は members で、個人は user で決める。
    # 登録の上限（max_per_space）は「利用者ごとのパスキーの数」（前は置き場ごと）。海の仲間は MEMBER_MAX 人まで
    def users(self):
        return [u for u in self._read('users.json') if isinstance(u, dict) and USER_RE.match(str(u.get('id', '')))
                and isinstance(u.get('person'), int) and not isinstance(u.get('person'), bool)]

    def find_user(self, uid):
        return next((u for u in self.users() if u['id'] == uid), None) if isinstance(uid, str) else None

    def user_of_person(self, person):
        return next((u for u in self.users() if u['person'] == person), None)

    def _new_user(self, users, name, uid=None, person=None):
        """users（読んだ一覧）に利用者を足して返す（書くのは呼んだ側）"""
        ids = {u['id'] for u in users}
        if not (isinstance(uid, str) and USER_RE.match(uid)) or uid in ids:
            uid = None
        while uid is None or uid in ids:
            uid = 'u_' + secrets.token_hex(4)
        if person is None:
            person = self._next_person(users)
        row = {'id': uid, 'name': clean_name(name) or f'個人 {person}', 'person': int(person), 'created': self.clock(),
               'avatar': secrets.choice(AVATAR_IDS)}      # 初めはランダム（2026-11-18）
        users.append(row)
        return row

    def _next_person(self, users):
        legacy = {p for p in (person_of(r) for r in self._read('passkeys.json') + self._read('invites.json')) if p is not None}
        got = {u['person'] for u in users} | legacy
        return (max(got) + 1) if got else OWNER

    def avatar_of(self, u):
        """利用者の行 → アイコン {preset, emoji, color}。持っていない行（移す前）は番号から決まった 1 つ"""
        got = avatar_info((u or {}).get('avatar'))
        if got:
            return got
        h = int(hashlib.sha256(str((u or {}).get('id', '')).encode('utf-8')).hexdigest(), 16)
        return avatar_info(AVATAR_IDS[h % len(AVATAR_IDS)])

    def set_avatar(self, uid, preset):
        """自分のアイコンをプリセットから選ぶ → {preset, emoji, color}"""
        if preset not in AVATAR_IDS:
            raise ValueError('アイコンはプリセットから選ぶ（' + '・'.join(AVATAR_IDS) + '）')
        with self.lock:
            users = self.users()
            u = next((x for x in users if x['id'] == uid), None)
            if not u:
                raise ValueError(f'利用者 {uid} はいません')
            u['avatar'] = preset
            self._write('users.json', users)
        return avatar_info(preset)

    def fill_avatars(self) -> int:
        """アイコンを持たない利用者（2026-11-18 より前に移した人）に、ランダムに 1 つ配る → 配った数"""
        with self.lock:
            users = self.users()
            n = 0
            for u in users:
                if u.get('avatar') not in AVATAR_IDS:
                    u['avatar'] = secrets.choice(AVATAR_IDS)
                    n += 1
            if n:
                self._write('users.json', users)
        return n

    def rename_user(self, uid, name) -> str:
        name = clean_name(name)
        if not name:
            raise ValueError('名前を入れる（40 字まで）')
        with self.lock:
            users = self.users()
            u = next((x for x in users if x['id'] == uid), None)
            if not u:
                raise ValueError(f'利用者 {uid} はいません（user-list で確かめる）')
            u['name'] = name
            self._write('users.json', users)
        return name

    # --- スーパーユーザー（2026-11-18 ユーザーの指示「新規ユーザーの登録を、スーパーユーザー（私）から招待できるように」） ---
    # users.json の行の admin: true。だれにも付いていなければ、サーバーを立てた 1 番の人（person 1）がスーパーユーザー。
    # できるのは「新しい利用者を app から招く」ことだけ（ほかの人の海・記録には入れない。2026-11-16 の「全ての海に入れる人はいない」は変えない）
    def is_admin(self, uid) -> bool:
        users = self.users()
        u = next((x for x in users if x['id'] == uid), None) if isinstance(uid, str) else None
        if not u:
            return False
        if any(x.get('admin') is True for x in users):
            return u.get('admin') is True
        return u['person'] == OWNER

    def admins(self):
        users = self.users()
        flagged = [u for u in users if u.get('admin') is True]
        return flagged or [u for u in users if u['person'] == OWNER]

    def set_admin(self, who: str, on: bool) -> dict:
        """who は利用者の番号（u_…）か名前。→ その利用者の行。最後の 1 人は外せない"""
        with self.lock:
            users = self.users()
            hit = [u for u in users if u['id'] == who] or [u for u in users if u['name'] == who]
            if len(hit) != 1:
                raise ValueError(f'利用者「{who}」が見つからないか、同じ名前が 2 人いる（user-list の番号で指す）')
            u = hit[0]
            if not any(x.get('admin') is True for x in users):
                for x in users:              # 前の決まり（1 番の人）を書き出してから変える
                    if x['person'] == OWNER:
                        x['admin'] = True
            if on:
                u['admin'] = True
            else:
                if sum(1 for x in users if x.get('admin') is True) <= 1 and u.get('admin') is True:
                    raise ValueError('スーパーユーザーが 1 人もいなくなる（先にほかの人を admin-add する）')
                u.pop('admin', None)
            self._write('users.json', users)
        return u

    def members(self):
        return [m for m in self._read('members.json') if isinstance(m, dict) and m.get('role') in ROLES
                and valid_space(m.get('sea')) and m.get('sea') != 'me' and USER_RE.match(str(m.get('user', '')))]

    def roles_of(self, uid):
        """利用者の入れる海 → {海: 役割}。個人（me）はいつも owner"""
        out = {'me': 'owner'}
        for m in self.members():
            if m['user'] == uid:
                out[m['sea']] = m['role']
        return out

    def members_of(self, sea):
        return [m for m in self.members() if m['sea'] == sea]

    def set_member(self, sea, uid, role='editor'):
        """海の仲間を足す・役割を変える → 変えたか。仲間が MEMBER_MAX 人いれば ValueError"""
        if not valid_space(sea) or sea == 'me':
            raise ValueError('海の ID（share か s で始まる名前）を入れる')
        if role not in ROLES:
            raise ValueError('役割は owner・editor・viewer')
        with self.lock:
            if not self.find_user(uid):
                raise ValueError(f'利用者 {uid} はいません')
            rows = self.members()
            cur = next((m for m in rows if m['sea'] == sea and m['user'] == uid), None)
            if cur:
                if cur['role'] == role:
                    return False
                cur['role'] = role
            else:
                if sum(1 for m in rows if m['sea'] == sea) >= MEMBER_MAX:
                    raise ValueError(f'{space_label(sea)}の仲間はいっぱい（{MEMBER_MAX} 人まで）')
                rows.append({'sea': sea, 'user': uid, 'role': role})
            self._write('members.json', rows)
        return True

    def remove_member(self, sea, uid) -> bool:
        with self.lock:
            rows = self.members()
            keep = [m for m in rows if not (m['sea'] == sea and m['user'] == uid)]
            if len(keep) == len(rows):
                return False
            self._write('members.json', keep)
        return True

    def user_of_passkey(self, row):
        """パスキーの行の利用者（移していない行なら移してから）"""
        if not row:
            return None
        u = self.find_user(row.get('user'))
        if u:
            return u
        self.migrate()
        fresh = self.find_passkey(row['id'])
        return self.find_user(fresh.get('user')) if fresh else None

    def migrate(self) -> dict:
        """前の人の番号と置き場を、利用者と海の仲間へ移す（2026-11-18）。何度呼んでも同じ（済んだ行は飛ばす）。
        ・個人に入れるパスキー（person 1, 2, …）→ その番号の利用者（無ければ作る。名前は最初のパスキーの名前）
        ・個人に入れないパスキー（共有だけの人）→ 1 行ごとに新しい利用者（個人の海を1つ持つ。番号は次の番号）
        ・行の spaces の海 → 海の仲間（editor）。持ち主の無い海は、1 番の人がいればその人、いなければ最初の仲間を owner に
        → {'users': 作った数, 'passkeys': 移した行の数, 'members': 足した数}"""
        out = {'users': 0, 'passkeys': 0, 'members': 0}
        if any(u.get('avatar') not in AVATAR_IDS for u in self.users()):
            self.fill_avatars()
        with self.lock:
            rows = self._read('passkeys.json')
            if all(USER_RE.match(str(r.get('user', ''))) for r in rows):
                return out
            users = self.users()
            members = self.members()
            ids = {u['id'] for u in users}
            for r in sorted(rows, key=lambda x: x.get('created') or 0):
                if r.get('user') in ids:
                    continue
                p = person_of(r)
                u = next((x for x in users if x['person'] == p), None) if p is not None else None
                if u is None:
                    u = self._new_user(users, r.get('name', ''), person=p)
                    ids.add(u['id'])
                    out['users'] += 1
                r['user'] = u['id']
                out['passkeys'] += 1
                for s in r.get('spaces') or []:
                    if s != 'me' and valid_space(s) and not any(m['sea'] == s and m['user'] == u['id'] for m in members):
                        members.append({'sea': s, 'user': u['id'], 'role': 'editor'})
                        out['members'] += 1
            first = {u['id']: u for u in users}
            for sea in dict.fromkeys(m['sea'] for m in members):
                ms = [m for m in members if m['sea'] == sea]
                if any(m['role'] == 'owner' for m in ms):
                    continue
                pick = next((m for m in ms if first.get(m['user'], {}).get('person') == OWNER), ms[0])
                pick['role'] = 'owner'
            self._write('users.json', users)
            self._write('members.json', members)
            self._write('passkeys.json', rows)
        return out

    # --- 数（上限は利用者ごとのパスキーの数）---
    def count_user(self, uid, rows=None, skip=None) -> int:
        rows = self.passkeys() if rows is None else rows
        return sum(1 for r in rows if r.get('user') == uid and r['id'] != skip)

    def count_in(self, space: str, person=None, rows=None) -> int:
        """前の版の口（passkey-list の数・テスト）。個人は person の利用者のパスキーの数、海は仲間の数"""
        if space == 'me':
            u = self.user_of_person(person if person is not None else OWNER)
            return self.count_user(u['id'], rows) if u else 0
        return len(self.members_of(space))

    def over_limit(self):
        """上限を下げたあと、上限より多くパスキーを持つ利用者 → [(ラベル, 数)]"""
        rows = self.passkeys()
        out = [(f"{u['name']}（{u['id']}）", self.count_user(u['id'], rows)) for u in self.users()]
        return [(lab, c) for lab, c in out if c > self.max_per_space]

    # --- 個人の番号（前の版の口。利用者の person と同じ）---
    def persons(self):
        """いる人の番号（利用者と、移していない前の行から）"""
        legacy = {p for p in (person_of(r) for r in self.passkeys() + self.list_invites()) if p is not None}
        return sorted({u['person'] for u in self.users()} | legacy)

    def next_person(self) -> int:
        return self._next_person(self.users())

    # --- 招待（招待コード・認めた頼み・引っ越しの鍵・端末を足す番号・海への招待）---
    # 招待の行（invites.json）: {name, code_hash, expires, created, kind?, by?, user?, new_user?, seas?, spaces?}
    #   user     … その利用者の端末を足す（me:<番号>・端末から足す・引っ越しの鍵・端末を足す番号）
    #   new_user … 登録で新しい利用者を作る（me・共有だけ・海への招待をログインしていない人が開いたとき）
    #   seas     … [[海, 役割], …] 登録・受け取りで仲間にする海
    #   spaces   … 表示のため（前の版の形。中身は上の 3 つで決まる）
    def add_invite(self, name: str, spaces, ttl: int = INVITE_TTL, person=None) -> str:
        """招待コードを作る。個人（me）を含むなら person の人の端末にする（省けば新しい人）"""
        return self.add_invite_full(name, spaces, ttl, person)[0]

    def add_invite_full(self, name: str, spaces, ttl: int = INVITE_TTL, person=None):
        """(コード, 個人の番号か None)"""
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(12))
        _, person = self._invite_row(name, spaces, person, _sha(raw), ttl=ttl)
        return '-'.join(raw[i:i + 4] for i in range(0, 12, 4)), person

    def _invite_row(self, name, spaces, person, code_hash, ttl: int = INVITE_TTL, kind=None, by=None, role='editor'):
        """前の版の書き方（me・me:<番号>・share・海の ID）で招待の行を足す → (名前, 個人の番号か None)。
        me:<番号> はその番号の利用者の端末。me だけ・海だけは新しい利用者（登録のときに作る）"""
        name = clean_name(name)
        spaces = list(dict.fromkeys(s for s in spaces if valid_space(s)))
        if not name or not spaces:
            raise ValueError('名前と置き場（me・share・海の ID）が要ります')
        row = {'name': name, 'spaces': spaces, 'code_hash': code_hash, 'expires': self.clock() + ttl, 'created': self.clock()}
        seas = [[s, role] for s in spaces if s != 'me']
        if seas:
            row['seas'] = seas
        if 'me' in spaces and person is not None:
            person = int(person)
            u = self.user_of_person(person)
            if not u:
                self.migrate()
                u = self.user_of_person(person)
            if not u:
                raise ValueError(f'個人 {person} の人はいません（user-list で番号を確かめる。新しい人なら番号を付けない）')
            if self.count_user(u['id']) >= self.max_per_space:
                raise ValueError(f"{u['name']}のパスキーはいっぱい（{self.max_per_space} 台まで）。passkey-remove で使わない端末を外してから")
            row['user'] = u['id']
            row['person'] = person
        else:
            row['new_user'] = True
            person = None
        for s, _ in seas:
            if len(self.members_of(s)) >= MEMBER_MAX:
                raise ValueError(f'{space_label(s)}の仲間はいっぱい（{MEMBER_MAX} 人まで）')
        if kind:
            row['kind'] = kind
        if by:
            row['by'] = by
        with self.lock:
            rows = [r for r in self._read('invites.json') if r['expires'] > self.clock()]
            rows.append(row)
            self._write('invites.json', rows)
        return name, person

    def invite_target(self, inv):
        """招待の行 → ('user', 利用者の番号) か ('new', None)。前の版の行（user も new_user も無い）も読む"""
        if inv.get('user'):
            return 'user', inv['user']
        if inv.get('new_user'):
            return 'new', None
        p = person_of(inv)
        if p is not None:
            u = self.user_of_person(p)
            if u:
                return 'user', u['id']
        return 'new', None

    def invite_seas(self, inv):
        """招待の行 → [(海, 役割)]"""
        if isinstance(inv.get('seas'), list):
            return [(s, r) for s, r in inv['seas'] if valid_space(s) and s != 'me' and r in ROLES]
        return [(s, 'editor') for s in inv.get('spaces') or [] if s != 'me' and valid_space(s)]

    # --- 端末から招く（2026-11-16。2026-11-18 から: 個人は自分の端末、海は持ち主だけ）---
    INVITE_BY_MAX = 5

    def invite_from(self, info, name: str, sea: str, new_person: bool = False, role: str = 'editor'):
        """info は session_info の答え。→ (コード, 置き場の一覧, 個人の番号か None)。範囲の外なら PermissionError。
        sea 'me' … 自分の端末を足す招待コード（24 時間）。ほかの海 … その海への招待（持ち主だけが出せる）。
        海への招待は、ログインしている人が開けば仲間に入るだけ、ログインしていない人なら新しい利用者として登録する"""
        pk = self.find_passkey(info['cred_id'])
        if not pk:
            raise PermissionError('このパスキーは登録されていない')
        by = pk['name']
        uid = info.get('user')
        if not valid_space(sea):
            raise ValueError('海の ID が違う')
        if role not in ('editor', 'viewer'):
            raise ValueError('役割は editor か viewer')
        if sum(1 for r in self.list_invites() if r.get('by') == by) >= self.INVITE_BY_MAX:
            raise ValueError(f'使われていない招待が多い（{self.INVITE_BY_MAX} まで。24 時間で消える）')
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(12))
        row = {'name': clean_name(name) or by, 'code_hash': _sha(raw), 'expires': self.clock() + INVITE_TTL,
               'created': self.clock(), 'by': by}
        if sea == 'me' and new_person:
            # 新しい利用者（その人だけの個人の海を持つ）を招く。スーパーユーザーだけ（2026-11-18）
            if not self.is_admin(uid):
                raise PermissionError('新しい利用者を招けるのはスーパーユーザーだけ')
            if not clean_name(name):
                raise ValueError('招く人の呼び名を入れる')
            row.update(new_user=True, spaces=['me'])
            person = None
        elif sea == 'me':
            if not clean_name(name):
                raise ValueError('足す端末の呼び名を入れる')
            if self.count_user(uid) >= self.max_per_space:
                raise ValueError(f'パスキーはいっぱい（{self.max_per_space} 台まで）')
            row.update(user=uid, spaces=['me'])
            person = info.get('person')
        else:
            if (info.get('roles') or {}).get(sea) != 'owner':
                raise PermissionError('この海に招けるのは持ち主だけ')
            if len(self.members_of(sea)) >= MEMBER_MAX:
                raise ValueError(f'仲間はいっぱい（{MEMBER_MAX} 人まで）')
            row.update(kind='sea', new_user=True, seas=[[sea, role]], spaces=[sea])
            person = None
        with self.lock:
            rows = [r for r in self._read('invites.json') if r['expires'] > self.clock()]
            rows.append(row)
            self._write('invites.json', rows)
        return '-'.join(raw[i:i + 4] for i in range(0, 12, 4)), row['spaces'], person

    def accept_invite(self, code: str, uid: str):
        """ログインしている利用者が、海への招待を受け取る → [(海, 役割)]。端末の招待なら ValueError"""
        inv = self.find_invite(code)
        if not inv:
            return None
        if inv.get('kind') in ('move', 'device', 'request') or self.invite_target(inv)[0] == 'user':
            raise ValueError('これは端末を登録するための招待（ログインしていない端末で使う）')
        seas = self.invite_seas(inv)
        if not seas:
            raise ValueError('入る海が無い招待')
        if not self.use_invite(inv['code_hash']):
            return None
        mine = self.roles_of(uid)
        for s, role in seas:
            if s not in mine:          # もう仲間なら役割は変えない（下げも上げもしない）
                self.set_member(s, uid, role)
        return seas

    def invite_info(self, inv):
        """招待の行 → 画面に出す {kind, name, by, seas:[{id, role}]}（コードは出さない）"""
        kind = inv.get('kind') or ('device' if self.invite_target(inv)[0] == 'user' else 'user')
        if kind in ('move', 'request'):
            kind = 'device' if self.invite_target(inv)[0] == 'user' else 'user'
        return {'kind': kind, 'name': inv.get('name', ''), 'by': inv.get('by', ''),
                'seas': [{'id': s, 'role': r} for s, r in self.invite_seas(inv)]}

    # --- 端末を足す番号（2026-11-18。10 分・1 回。数字 6 桁）---
    def add_device_code(self, uid):
        """ログイン中の利用者の、新しい端末のための番号 → (番号 'NNN NNN', 期限)。前に出した番号は使えなくなる"""
        if not self.find_user(uid):
            raise ValueError('利用者がいない')
        if self.count_user(uid) >= self.max_per_space:
            raise ValueError(f'パスキーはいっぱい（{self.max_per_space} 台まで）。使わない端末を外してから')
        digits = ''.join(secrets.choice('0123456789') for _ in range(DEVICE_LEN))
        with self.lock:
            now = self.clock()
            rows = [r for r in self._read('invites.json')
                    if r['expires'] > now and not (r.get('kind') == 'device' and r.get('user') == uid)]
            rows.append({'name': '', 'code_hash': _sha('device:' + digits), 'expires': now + DEVICE_TTL, 'created': now,
                         'kind': 'device', 'user': uid, 'spaces': ['me']})
            self._write('invites.json', rows)
        return digits[:3] + ' ' + digits[3:], now + DEVICE_TTL

    def find_device_code(self, code):
        digits = ''.join(c for c in str(code or '') if c.isdigit())
        if len(digits) != DEVICE_LEN:
            return None
        h = _sha('device:' + digits)
        for r in self._read('invites.json'):
            if r.get('kind') == 'device' and r['expires'] > self.clock() and secrets.compare_digest(r['code_hash'], h):
                return r
        return None

    # --- 引っ越しの鍵（2026-11-07 Issue #19。2026-11-18 から: 同じ利用者の端末を足す）---
    def add_move_key(self, cred_id: str):
        """パスキーで入っている端末が作る、引っ越しの鍵 → (鍵, 期限)。
        同じ利用者の次の端末を、持ち主の手を借りずに登録するために使う。1つのパスキーにつき1つだけ（作り直すと前のは使えない）。
        登録に使うと消える（使い切り）。引っ越しのファイルに入れて持ち出すので、期限は長い（MOVE_TTL）"""
        row = self.find_passkey(cred_id)
        if not row:
            raise ValueError('このパスキーは登録されていない')
        u = self.user_of_passkey(row)
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(MOVE_LEN))
        with self.lock:
            now = self.clock()
            rows = [r for r in self._read('invites.json') if r['expires'] > now and r.get('from') != cred_id]
            inv = {'name': row['name'], 'spaces': ['me'], 'code_hash': _sha(raw), 'user': u['id'],
                   'expires': now + MOVE_TTL, 'created': now, 'kind': 'move', 'from': cred_id}
            rows.append(inv)
            self._write('invites.json', rows)
        return '-'.join(raw[i:i + 4] for i in range(0, MOVE_LEN, 4)), inv['expires']

    # --- 復元の鍵（2026-11-19 ユーザーの指示「復元の鍵は削除するまで有効にして」）---
    # パスキーを全部なくした人が、自分だけで同じ利用者に戻るための鍵。期限は無く、使っても消えない。
    # 鍵が合うと、その利用者の 10 分・1 回の招待（kind 'recovery'）を作り、ふつうの登録の道（register）でパスキーを足す
    def add_recovery_key(self, uid):
        """ログイン中の利用者の復元の鍵を作る → (鍵, 作った時刻)。前の鍵は使えなくなる。鍵を返すのはこのときだけ"""
        if not self.find_user(uid):
            raise ValueError('利用者がいない')
        raw = ''.join(secrets.choice(_CODE_ABC) for _ in range(RECOVERY_LEN))
        with self.lock:
            now = self.clock()
            rows = self._read('recovery.json')
            old = next((r for r in rows if r.get('user') == uid), {})
            rows = [r for r in rows if r.get('user') != uid]
            row = {'user': uid, 'hash': _sha('recovery:' + raw), 'created': now, 'last_used': None}
            if old.get('notice'):
                row['notice'] = old['notice']
            rows.append(row)
            self._write('recovery.json', rows)
        return '-'.join(raw[i:i + 4] for i in range(0, RECOVERY_LEN, 4)), now

    def remove_recovery_key(self, uid) -> bool:
        """利用者の復元の鍵を消す（知らせは残す）→ 消したか"""
        with self.lock:
            rows = self._read('recovery.json')
            hit = False
            for r in rows:
                if r.get('user') == uid and r.get('hash'):
                    r['hash'] = None
                    r['created'] = None
                    r['last_used'] = None
                    hit = True
            self._write('recovery.json', [r for r in rows if r.get('hash') or r.get('notice')])
            return hit

    def recovery_of(self, uid):
        """利用者の復元の鍵の行（鍵の指紋は外す）か None。notice だけの行も返す（has で鍵の有無）"""
        r = next((x for x in self._read('recovery.json') if x.get('user') == uid), None)
        if not r:
            return None
        return {'has': bool(r.get('hash')), 'created': r.get('created'), 'last_used': r.get('last_used'),
                'notice': r.get('notice')}

    def recovery_list(self):
        return [dict(self.recovery_of(r['user']), user=r['user']) for r in self._read('recovery.json') if r.get('user')]

    def recovery_invite(self, key):
        """鍵が合えば、その利用者の 10 分・1 回の招待の行を作って返す。合わなければ None"""
        raw = normalize_code(key)
        if len(raw) != RECOVERY_LEN:
            return None
        h = _sha('recovery:' + raw)
        hit = None
        for r in self._read('recovery.json'):
            if r.get('hash') and secrets.compare_digest(r['hash'], h):
                hit = r
        if not hit or not self.find_user(hit['user']):
            return None
        with self.lock:
            now = self.clock()
            rows = [r for r in self._read('invites.json')
                    if r['expires'] > now and not (r.get('kind') == 'recovery' and r.get('user') == hit['user'])]
            inv = {'name': '', 'spaces': ['me'], 'code_hash': _sha('recovery-invite:' + secrets.token_hex(16)),
                   'user': hit['user'], 'expires': now + RECOVERY_INVITE_TTL, 'created': now, 'kind': 'recovery'}
            rows.append(inv)
            self._write('invites.json', rows)
        return inv

    def recovery_used(self, uid, cred_id, device=''):
        """鍵で端末を足した → 最後に使った日と、ほかの端末への知らせを書く"""
        with self.lock:
            rows = self._read('recovery.json')
            now = self.clock()
            for r in rows:
                if r.get('user') == uid:
                    r['last_used'] = now
                    r['notice'] = {'at': now, 'cred': cred_id, 'device': clean_name(device) or '端末'}
            self._write('recovery.json', rows)

    def _oldest_passkey(self, uid):
        """利用者のパスキーのうち、いちばん長く使っていないもの（復元の鍵でいっぱいのとき外す）"""
        mine = [r for r in self._read('passkeys.json') if r.get('user') == uid]
        if not mine:
            return None
        return min(mine, key=lambda r: (r.get('last_used') or r.get('created') or 0))

    def full_for(self, inv):
        """その招待で登録するとき、いっぱいのもの（置き場の名前の一覧）。空なら登録できる。
        引っ越しの鍵は、作った端末（引っ越す前の端末）のパスキーを外せば空くなら、いっぱいとしない"""
        out = []
        kind, uid = self.invite_target(inv)
        if kind == 'user':
            skip = inv.get('from') if inv.get('kind') == 'move' else None
            if inv.get('kind') == 'recovery':
                # 復元の鍵: 引っ越しの鍵と同じ考えで、いっぱいなら外せるもの（いちばん長く使っていないパスキー）を外す前提で数える
                old = self._oldest_passkey(uid)
                skip = old['id'] if old else None
            if self.count_user(uid, skip=skip) >= self.max_per_space:
                out.append('me')
        for s, _ in self.invite_seas(inv):
            if len(self.members_of(s)) >= MEMBER_MAX and not (kind == 'user' and s in self.roles_of(uid)):
                out.append(s)
        return out

    def retire_for(self, inv):
        """引っ越しの鍵で登録する直前。そのままでは利用者のパスキーがいっぱいなら、引っ越す前の端末のパスキーを外す。
        外したパスキーの名前（外さなければ None）"""
        if inv.get('kind') not in ('move', 'recovery'):
            return None
        kind, uid = self.invite_target(inv)
        if kind != 'user' or self.count_user(uid) < self.max_per_space:
            return None
        # 復元の鍵（2026-11-19）: 失くした端末のどれか。いちばん長く使っていないパスキーを外す
        old = self._oldest_passkey(uid) if inv.get('kind') == 'recovery' else self.find_passkey(inv.get('from') or '')
        if old and self.remove_passkey(old['name']):
            return old['name']
        return None

    def remove_move_keys(self, name: str) -> int:
        """名前のパスキーが作った引っ越しの鍵を消す（ファイルと合言葉が漏れたとき）。消した数"""
        with self.lock:
            rows = self._read('invites.json')
            keep = [r for r in rows if not (r.get('kind') == 'move' and r['name'] == name)]
            self._write('invites.json', keep)
            return len(rows) - len(keep)

    def find_invite(self, code: str):
        h = _sha(normalize_code(code))
        for r in self._read('invites.json'):
            if r.get('kind') != 'device' and r['expires'] > self.clock() and secrets.compare_digest(r['code_hash'], h):
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
    def new_challenge(self, kind: str, invite_hash: str = None, extra: dict = None) -> str:
        from passkey_crypto import b64u_encode
        c = b64u_encode(secrets.token_bytes(32))
        with self.lock:
            now = self.clock()
            self.challenges = {k: v for k, v in self.challenges.items() if v['expires'] > now}
            if len(self.challenges) > 2000:   # 溢れさせない（古いものから捨てる）
                for k in sorted(self.challenges, key=lambda k: self.challenges[k]['expires'])[:500]:
                    del self.challenges[k]
            self.challenges[c] = dict(extra or {}, kind=kind, invite_hash=invite_hash, expires=now + CHALLENGE_TTL)
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

    def register(self, *, inv, cred, name='', user_id=None, user_name='', by=None):
        """招待（招待コード・認めた頼み・引っ越しの鍵・端末を足す番号・海への招待）でパスキーを足す。
        新しい利用者なら user_id（登録の問題を出したときに決めた番号。パスキーの user.id と同じ）で作る。
        → (パスキーの名前, 利用者の行)。いっぱいなら ValueError"""
        kind, uid = self.invite_target(inv)
        with self.lock:
            rows = self._read('passkeys.json')
            if any(r['id'] == cred['cred_id'] for r in rows):
                raise ValueError('同じパスキーがもうある')
            users = self.users()
            if kind == 'user':
                u = next((x for x in users if x['id'] == uid), None)
                if not u:
                    raise ValueError('招待の利用者がいない')
                if self.count_user(u['id'], rows) >= self.max_per_space:
                    raise ValueError('登録はいっぱい')
            else:
                person = inv.get('person') if person_of(inv) is not None and not any(
                    x['person'] == person_of(inv) for x in users) else None
                u = self._new_user(users, user_name or inv.get('name', ''), uid=user_id, person=person)
                self._write('users.json', users)
            name = clean_name(name) or clean_name(inv.get('name', '')) or '端末'
            base, n, names = name, 2, {r['name'] for r in rows}
            while name in names:          # 同じ名前を2つにしない（取り消しを名前でするため）
                name = f'{base} ({n})'
                n += 1
            rows.append({'id': cred['cred_id'], 'name': name, 'user': u['id'], 'alg': cred['alg'],
                         'public_key': cred['public_key'], 'sign_count': cred['sign_count'],
                         'created': self.clock(), 'last_used': None})
            if by or inv.get('by'):
                rows[-1]['by'] = by or inv.get('by')
            self._write('passkeys.json', rows)
            mine = self.roles_of(u['id'])
            for s, role in self.invite_seas(inv):
                if s not in mine:
                    self.set_member(s, u['id'], role)
        return name, u

    def add_passkey(self, *, name, spaces, cred, person=None, by=None):
        """前の版の口（テスト）。spaces・person の招待と同じ形で足す"""
        inv = {'name': name, 'spaces': list(spaces)}
        if 'me' in spaces and person is not None:
            u = self.user_of_person(int(person))
            if u:
                inv['user'] = u['id']
            else:
                inv['person'] = int(person)
        got, _ = self.register(inv=inv, cred=cred, name=name, by=by)
        return got

    def set_space(self, name: str, space: str, on: bool) -> list:
        """名前のパスキーの利用者を、海の仲間に足す（editor）・外す（VM の passkey-space）→ その利用者の入れる置き場の一覧"""
        if not valid_space(space) or space == 'me':
            raise ValueError('海の ID（share か s で始まる名前）を入れる')
        r = next((x for x in self.passkeys() if x['name'] == name), None)
        if not r:
            raise ValueError(f'「{name}」は見つかりません（passkey-list で名前を確かめる）')
        u = self.user_of_passkey(r)
        if on:
            if space not in self.roles_of(u['id']):
                self.set_member(space, u['id'], 'editor')
        else:
            self.remove_member(space, u['id'])
        return list(self.roles_of(u['id']))

    def set_person(self, name: str, person) -> int:
        """名前のパスキーを、ほかの人（利用者）へ移す。person は番号か 'new'（新しい利用者）。移した先の番号を返す。
        通行証はそのまま（利用者は使うたびにパスキーの行から引くので、次の要求から移った先に入る）"""
        with self.lock:
            rows = self._read('passkeys.json')
            r = next((x for x in rows if x['name'] == name), None)
            if not r:
                raise ValueError(f'「{name}」は見つかりません（passkey-list で名前を確かめる）')
            users = self.users()
            if person == 'new':
                u = self._new_user(users, name)
                self._write('users.json', users)
            else:
                u = next((x for x in users if x['person'] == int(person)), None)
                if not u:
                    raise ValueError(f'個人 {person} の人はいません（新しい人にするなら new）')
                if r.get('user') != u['id'] and self.count_user(u['id'], rows) >= self.max_per_space:
                    raise ValueError(f'個人 {person} の登録はいっぱい（{self.max_per_space} 台まで）')
            r['user'] = u['id']
            r['person'] = u['person']
            if 'me' not in (r.get('spaces') or ['me']):
                r['spaces'] = ['me'] + list(r.get('spaces') or [])
            self._write('passkeys.json', rows)
        return u['person']

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
    def new_session(self, cred_id: str, spaces=None, ttl: int = SESSION_TTL):
        tok = secrets.token_urlsafe(32)
        with self.lock:
            now = self.clock()
            rows = [s for s in self._read('sessions.json') if s['expires'] > now]
            rows.append({'hash': _sha(tok), 'cred_id': cred_id, 'expires': now + ttl})
            self._write('sessions.json', rows)
        return tok, now + ttl

    def info_of_user(self, u, cred_id=None):
        """利用者 → 通行証の答えと同じ形 {user, name, person, spaces, roles, cred_id, owner}"""
        roles = self.roles_of(u['id'])
        return {'user': u['id'], 'name': u['name'], 'person': u['person'], 'spaces': list(roles), 'roles': roles,
                'cred_id': cred_id, 'owner': False, 'avatar': self.avatar_of(u)}

    def session_info(self, tok: str):
        """端末の通行証 → {user, name, person, spaces, roles, cred_id, owner}。期限切れ・取り消し済みなら None。
        利用者と入れる海は、いまのパスキーの行と海の仲間の表から引く（VM の passkey-space・passkey-person がすぐ効く）"""
        if not tok:
            return None
        h = _sha(tok)
        for s in self._read('sessions.json'):
            if s['expires'] > self.clock() and secrets.compare_digest(s['hash'], h):
                pk = self.find_passkey(s['cred_id'])
                if not pk:            # パスキーを消したら、その通行証は使えない
                    return None
                u = self.user_of_passkey(pk)
                return self.info_of_user(u, s['cred_id']) if u else None
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
