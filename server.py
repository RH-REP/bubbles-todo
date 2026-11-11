#!/usr/bin/env python3
"""Bubbles の記録を置くサーバー（2026-10-23）。Python の標準ライブラリだけで動く。
このサーバーが預かる海のまとまり（個人・共有・作った海）を、画面では「海域」と呼ぶ（2026-11-10）。

複数の端末から同じ記録を使うためのもの。app 本体（index.html・css・js・icons）も一緒に配る。
記録はサーバー上の JSON ファイル 1つ（<データの場所>/state.json）。
記録を合わせる計算は端末の側（js/merge.js）がする。ここは「版つきで1つの JSON を
預かる」だけで、中身は読まない。

    python3 server.py                       # http://127.0.0.1:8931/
    python3 server.py --port 8931 --host 127.0.0.1 --data-dir ./data

データの場所:  --data-dir → 環境変数 BUBBLE_TODO_DATA → このファイルの隣の data/
合言葉（無ければ作ってファイルに書く。値は端末で起動したときだけ画面に出す）:
    個人: 環境変数 BUBBLE_TODO_TOKEN → <データの場所>/token.txt   記録は state.json
    共有: 人ごとに1つ。<データの場所>/share_tokens.json（名前と合言葉の組）  記録は share/state.json
          環境変数 BUBBLE_TODO_SHARE_TOKEN も1人ぶんとして通す。前の版の share_token.txt は
          「最初の合言葉」として share_tokens.json へ引き継ぐ
    合言葉が置き場を決める。共有の合言葉だけを知る人は、個人の記録を読めない。
    名前を付けた海（2026-11-02 Issue #4）: 「共有」は、名前を付けて複数作れる海の1つになった。
          海はアプリの中で作り、記録は <データの場所>/seas/<海の ID>/state.json（「共有」だけは share/）。
          自分の合言葉（と、個人に入れるパスキー）はどの海にも入れる。どの海かは X-Bubbles-Space で言う。
          共有の合言葉は「共有」の海だけ。ほかの海に人を招くのはパスキーの招待コード（invite-add <名前> --space <海の ID>）。
          海の一覧（名前・色）は <データの場所>/seas.json（POST /api/spaces で端末と合わせる）
    API（/api/data）は合言葉がどれにも合わないと 401 を返す。
    ファイルを書き換えると、止めずに次の接続から効く（取り消しもすぐ効く）。

合言葉の操作（2026-10-23。止めずに使える）:
    python3 server.py share-add <名前>      共有の合言葉を1人ぶん作る（値はこのときだけ出す）
    python3 server.py share-list            共有の合言葉の一覧（名前・作った日・末尾4文字）
    python3 server.py share-remove <名前>   その人の合言葉を取り消す
    python3 server.py rotate-me             自分の合言葉（個人）を作り直す（各端末に入れ直す）
    どれも --data-dir（または BUBBLE_TODO_DATA）で置き場を選ぶ

API:
    GET /api/health          → {"ok": true}（合言葉は要らない。届くかを見るだけ）
    GET /api/data            → {"space": "me"|"share", "version": n, "data": {...} | null, "minSchema": n}
                               space はその合言葉の置き場（端末が取り違えに気づくため）
                               minSchema は受け付ける最も古い記録の形の版（下の「記録の形の版」）。GET は版で断らない
    POST /api/spaces         ← {"spaces": [{id, name, color, at, alive}, ...]}
                             → {"spaces": [...]}  海の一覧。持ち主の鍵なら合わせて全部を返し、
                               招かれた鍵なら書き換えず、入れる海のぶんだけ返す
    PUT /api/data            ← {"base": n, "data": {...}}
                               base が今の版と違えば 409 と今の版・中身を返す（上書きしない）
                               同じなら書いて {"version": n+1}
                               頭書き X-Bubbles-Schema が無いか minSchema より小さければ、書かずに
                               426 {"error": "upgrade", "minSchema": n}（個人・共有・作った海のどれでも）

記録の形の版（2026-11-10。共有の記録 v1.1 §6）:
    記録は bubble・gantt_todo・diary が読み書きする。古い版の端末は新しい欄を知らずに落とし、
    印が変わらないまま広げてしまう。そこで端末は分かる記録の形の版を X-Bubbles-Schema で送り、
    このサーバーは --min-schema（環境変数 BUBBLE_TODO_MIN_SCHEMA。既定 1）より古い書き込みを断る。
    互換性の無い変更を入れるときは、端末の SCHEMA を上げた版を配ってから --min-schema を上げる（DEV_NOTES.md）。
書くたびに前の版を <データの場所>/backup/ に残す（新しいほうから BACKUP_KEEP 個）。

入場の形は2つ:
    token   … 合言葉。この Mac など手元で使う形（start.command）。外へは出さない
    passkey … パスキーだけ。公開して使う形（tools/server-setup.sh が立ち上げる）
    （2026-10-25 に、合言葉で入って tailscale serve で tailnet にだけ見せる形は外した。履歴の commit 0263e6a まで）

公開して使う形（--auth passkey。2026-10-24）:
    前段の Caddy で HTTPS にし、このサーバーは 127.0.0.1 のまま。入場はパスキーだけ（合言葉では入れない）。
    python3 server.py --auth passkey --origin https://<名前> --trust-proxy
    python3 server.py invite-add <名前> --space me,share   招待コード（1回きり・24時間）を作る
                                                          （--space は me・share・海の ID をコンマで）
    python3 server.py passkey-list / passkey-remove <名前> / invite-list
    python3 server.py move-remove <名前>   その端末が作った引っ越しの鍵を消す（Issue #19）
    個人は人ごと（2026-11-03 利用者の指示）。人はサーバーに登録した順の番号で分ける（passkey_store.py）。
        --space me      … 新しい人（次の番号）の個人。1 番はサーバーを立てた人（持ち主）で、記録は state.json のまま
        --space me:2    … 2 番の人の、もう1台の端末
        ほかの人の記録は <データの場所>/people/<番号>/state.json。持ち主だけがどの海にも入れる
    python3 server.py passkey-person <名前> <番号|new>   そのパスキーをほかの人の個人へ移す
    端末から先に頼む形（2026-11-07 Issue #26。招待コードを先に作らなくてよい）:
        端末の設定の「パスキー」→「登録を頼む」で、端末の画面に確かめの字（例 ABC-DEF）が出る
        python3 server.py request-list                       待っている頼み（字・名前・期限 24 時間）
        python3 server.py request-ok <字> --space me:1,share  認める（--space は invite-add と同じ）
        python3 server.py request-no <字>                     断る
        端末は「登録を仕上げる」でパスキーを作る（認めたあと 24 時間）
    python3 server.py limit / limit-set <数>   置き場ごとの登録の上限を見る・変える（limits.json。止めずに効く。
                                               --max-passkeys より先。下げても登録済みは外さず、新しい登録を断る）
    登録できるパスキーは置き場ごとに 3 つ（--max-passkeys か limit-set）、同時に使える端末は 3 台（--max-devices。
    30 分以内に記録を読み書きした端末を数える。--device-window）。4 台目は 429 {"error": "devices"}
    POST /api/passkey/register/options {invite} → 登録の問題   POST /api/passkey/register {credential} → 通行証
    POST /api/passkey/login/options {}  → 入場の問題           POST /api/passkey/login {credential}    → 通行証
    POST /api/passkey/logout（Authorization: Bearer 通行証）
    POST /api/passkey/request {name} → {key, code, expires}（待っている頼みが多すぎれば 429 {"error": "requests"}）
    POST /api/passkey/request/status {key} → {state: "waiting"} | {state: "approved", name, spaces}
                                            断った・期限切れは 401。認めたあとは key を招待コードにして登録する
    /api/data は Authorization: Bearer <通行証> と X-Bubbles-Space: me|<海の ID> で使う
    機械の鍵（2026-11-11。共有の記録 v1.2 §8。gantt・diary・秘書がパスキーなしで入る）:
        python3 server.py machine-add <名前> --space me[:<番号>] [--read-only]   鍵（bm_…）を1度だけ表示
        python3 server.py machine-list / machine-remove <名前>
        鍵は <データの場所>/machine_keys.json に sha256 だけ（0600）。効くのは GET・PUT /api/data だけで、
        Authorization: Bearer <鍵>。置き場は鍵に決めた個人1つ（X-Bubbles-Space は省くか me。違えば 403）。
        --read-only の鍵の PUT は 403。端末の数には数えない。入場の失敗・要求数の守りは端末と同じ。
        記録（journal）には鍵の名前だけを出す（machine-forbidden name=…）
守り（どちらの形でも）: 接続元ごとの接続数・要求数・入場の失敗の数に上限（guard.py）、1接続の待ちは 15 秒、
    受け取る大きさは 4MB まで、配るページに CSP などのヘッダ、よそのオリジンは決めた相手だけ。
    守りの出来事は標準エラーに「bubbles: auth-fail ip=…」の形で出す（fail2ban が読む。値は出さない）
"""
import argparse
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

import passkey_crypto as pc
from guard import Devices, Guard
from passkey_store import PasskeyStore, valid_space, space_label, person_label, person_of, OWNER

ROOT = Path(__file__).resolve().parent
# 配るのは app 本体だけ。.git・.env・data/・DEV_NOTES などは出さない
PUBLIC_FILES = {'index.html', 'manifest.json', 'sw.js'}
PUBLIC_DIRS = {'css', 'js', 'icons', 'docs'}   # docs/ は使い方の記事（スクリーンショットつき）
MAX_BODY = 4 * 1024 * 1024   # 記録に見合う大きさ（前は 32MB。大きすぎる要求でメモリを使わせない）
BACKUP_KEEP = 50

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}


class Store:
    """版つきで JSON を1つ預かる。書き込みは1本ずつ（lock）"""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.path = data_dir / 'state.json'
        self.backup = data_dir / 'backup'
        self.lock = threading.Lock()
        self.dir.mkdir(parents=True, exist_ok=True)

    def read(self):
        if not self.path.exists():
            return {'version': 0, 'data': None}
        with self.path.open(encoding='utf-8') as f:
            return json.load(f)

    def write(self, base, data):
        """(True, 新しい版) か (False, 今の中身)"""
        with self.lock:
            cur = self.read()
            if base != cur['version']:
                return False, cur
            nxt = {'version': cur['version'] + 1, 'data': data, 'savedAt': int(time.time() * 1000)}
            if self.path.exists():
                self._backup()
            # 一時ファイルに書いて fsync してから置き換える（途中で落ちても前の版が残る）
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix='.state.', suffix='.json')
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(nxt, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
            return True, nxt['version']

    def _backup(self):
        self.backup.mkdir(exist_ok=True)
        stamp = time.strftime('%Y%m%d-%H%M%S')
        dst = self.backup / f'state-{stamp}-{secrets.token_hex(2)}.json'
        dst.write_bytes(self.path.read_bytes())
        olds = sorted(self.backup.glob('state-*.json'))
        for p in olds[:-BACKUP_KEEP]:
            p.unlink(missing_ok=True)


SPACES = {
    # 置き場: (合言葉の環境変数, 合言葉のファイル, 記録のフォルダ（データの場所から）, 画面に出す名前)
    'me': ('BUBBLE_TODO_TOKEN', 'token.txt', '.', '個人'),
    'share': ('BUBBLE_TODO_SHARE_TOKEN', 'share_token.txt', 'share', '共有'),
}


class SeaStores:
    """置き場の名前 → Store。'me' と、名前を付けた海の ID（valid_space）だけを、使うときに作る。
    dict と同じく `in` と `[]` で使う（Config.stores・Spaces.stores）"""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self._m = {}
        self._lock = threading.Lock()

    @staticmethod
    def _person(space):
        """'me/<番号>'（持ち主でない人の個人）の番号。違えば None"""
        m = re.fullmatch(r'me/([1-9][0-9]{0,5})', space) if isinstance(space, str) else None
        return int(m.group(1)) if m else None

    def __contains__(self, space):
        return valid_space(space) or self._person(space) is not None

    def __getitem__(self, space):
        if space not in self:
            raise KeyError(space)
        with self._lock:
            if space not in self._m:
                n = self._person(space)
                if n is not None:
                    d = self.dir / 'people' / str(n)   # 持ち主でない人の個人（2026-11-03）
                elif space == 'me':
                    d = self.dir
                elif space == 'share':
                    d = self.dir / 'share'      # 前の版の「共有」の置き場をそのまま使う
                else:
                    d = self.dir / 'seas' / space
                self._m[space] = Store(d)
            return self._m[space]


SEA_COLOR_RE = re.compile(r'^[a-z]{1,12}$')


class SeaList:
    """海の一覧 <データの場所>/seas.json = [{id, name, color, at, alive}]。海ごとに新しいほうを残す"""

    def __init__(self, data_dir: Path):
        self.path = data_dir / 'seas.json'
        self.lock = threading.Lock()

    @staticmethod
    def clean(e):
        if not isinstance(e, dict):
            return None
        sid = e.get('id')
        if not valid_space(sid) or sid == 'me':
            return None
        name = str(e.get('name') or '').strip()[:40]
        color = str(e.get('color') or '')
        try:
            at = max(0, int(e.get('at') or 0))
        except (TypeError, ValueError):
            return None
        if not name or not SEA_COLOR_RE.match(color):
            return None
        return {'id': sid, 'name': name, 'color': color, 'at': at, 'alive': 0 if e.get('alive') == 0 else 1}

    def read(self):
        if not self.path.exists():
            return []
        try:
            with self.path.open(encoding='utf-8') as f:
                rows = json.load(f)
        except (OSError, ValueError):
            return []
        return [r for r in (self.clean(x) for x in (rows if isinstance(rows, list) else [])) if r]

    def merge(self, entries):
        """端末の一覧を合わせる（海ごとに新しいほう）。合わせたあとの一覧を返す"""
        with self.lock:
            rows = {r['id']: r for r in self.read()}
            changed = False
            for e in entries if isinstance(entries, list) else []:
                e = self.clean(e)
                if not e:
                    continue
                cur = rows.get(e['id'])
                if cur is None or e['at'] > cur['at']:
                    rows[e['id']] = e
                    changed = True
            out = list(rows.values())
            if changed and len(out) <= 500:
                _write_private(self.path, json.dumps(out, ensure_ascii=False, indent=1) + '\n')
            return out


def load_token(data_dir: Path, space: str = 'me') -> str:
    env_name, file_name, _, label = SPACES[space]
    env = os.environ.get(env_name, '').strip()
    if env:
        return env
    path = data_dir / file_name
    if path.exists():
        tok = path.read_text(encoding='utf-8').strip()
        if tok:
            return tok
    tok = secrets.token_urlsafe(24)
    _write_private(path, tok + '\n')
    # 端末で起動したときだけ値を出す。systemd などでは出力が記録（journal）に残るので、場所だけにする
    _show_token(label, str(path), tok)
    return tok


def _write_private(path: Path, text: str):
    """所有者だけが読める形で、途中で落ちても半端なファイルを残さずに書く"""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _show_token(label: str, where: str, tok: str):
    if sys.stdout.isatty():
        print(f'{label}の合言葉を作りました（{where}）: {tok}', flush=True)
    else:
        print(f'{label}の合言葉を作りました: {where}', flush=True)


class ShareTokens:
    """共有の合言葉の一覧 <データの場所>/share_tokens.json = [{"name","token","created"}]"""

    def __init__(self, data_dir: Path):
        self.path = data_dir / 'share_tokens.json'
        self.legacy = data_dir / 'share_token.txt'

    def read(self):
        if not self.path.exists():
            return []
        with self.path.open(encoding='utf-8') as f:
            rows = json.load(f)
        return [r for r in rows if isinstance(r, dict) and r.get('name') and r.get('token')]

    def write(self, rows):
        _write_private(self.path, json.dumps(rows, ensure_ascii=False, indent=1) + '\n')

    def ensure(self):
        """一覧が無ければ作る。前の版の share_token.txt があれば、それを最初の1人ぶんにする"""
        if self.path.exists():
            return
        today = time.strftime('%Y-%m-%d')
        if self.legacy.exists() and self.legacy.read_text(encoding='utf-8').strip():
            tok = self.legacy.read_text(encoding='utf-8').strip()
            self.write([{'name': '最初の合言葉', 'token': tok, 'created': today}])
            self.legacy.rename(self.legacy.with_suffix('.txt.migrated'))
            print(f'共有の合言葉を {self.path.name} へ引き継ぎました（「最初の合言葉」）', flush=True)
            return
        if os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip():
            self.write([])
            return
        tok = secrets.token_urlsafe(24)
        self.write([{'name': '最初の合言葉', 'token': tok, 'created': today}])
        _show_token('共有', f'{self.path} の「最初の合言葉」', tok)

    def add(self, name: str) -> str:
        name = name.strip()
        if not name:
            raise SystemExit('名前を入れてください（例: share-add 母のスマホ）')
        rows = self.read()
        if any(r['name'] == name for r in rows):
            raise SystemExit(f'「{name}」はもうあります（取り消すなら share-remove {name}）')
        tok = secrets.token_urlsafe(24)
        rows.append({'name': name, 'token': tok, 'created': time.strftime('%Y-%m-%d')})
        self.write(rows)
        return tok

    def remove(self, name: str) -> bool:
        rows = self.read()
        keep = [r for r in rows if r['name'] != name]
        if len(keep) == len(rows):
            return False
        self.write(keep)
        return True


class Spaces:
    """合言葉 → (置き場の名前, Store)。合言葉のファイルが変わったら読み直す（止めずに効く）"""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.stores = SeaStores(data_dir)
        self.shares = ShareTokens(data_dir)
        load_token(data_dir, 'me')
        self.shares.ensure()
        self._key = None
        self._map = {}
        self._lock = threading.Lock()
        self.current()

    def _stamp(self):
        out = []
        for p in (self.dir / 'token.txt', self.shares.path):
            try:
                st = p.stat()
                out.append((st.st_mtime_ns, st.st_size))
            except FileNotFoundError:
                out.append(None)
        return tuple(out)

    def current(self):
        with self._lock:
            key = self._stamp()
            if key == self._key:
                return self._map
            m = {load_token(self.dir, 'me'): ('me', self.stores['me'])}
            shares = [r['token'] for r in self.shares.read()]
            env = os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip()
            if env:
                shares.append(env)
            for tok in shares:
                if tok in m and m[tok][0] == 'me':
                    raise SystemExit('自分の合言葉と同じ共有の合言葉があります。どちらかを作り直してください')
                m[tok] = ('share', self.stores['share'])
            self._key, self._map = key, m
            return m


class MachineKeys:
    """機械の鍵（共有の記録 v1.2 §8。2026-11-11）。公開の形（パスキー）のサーバーに、gantt・diary・秘書などの
    機械がパスキーなしで入るための鍵。<データの場所>/machine_keys.json（0600）=
    [{"name","hash","space":"me","person":番号,"read_only":bool,"created"}]

    ・鍵（頭 bm_）は machine-add で作ったときに1度だけ表示する。ファイルには sha256 だけを残す
      （鍵は 256 ビットの乱数なので、遅いハッシュは要らない）
    ・比べるのは全部の行と、時間の一定な比較で（どれに合ったかで時間が変わらないように）
    ・効くのは GET・PUT /api/data だけ。置き場は鍵に決めた個人1つ。端末の数（--max-devices）には数えない
    ・要求のたびに読み直すので、machine-add・machine-remove は動いているサーバーに次の要求から効く"""

    PREFIX = 'bm_'

    def __init__(self, data_dir: Path):
        self.path = data_dir / 'machine_keys.json'

    @staticmethod
    def digest(key: str) -> str:
        return hashlib.sha256(key.encode('utf-8')).hexdigest()

    def read(self):
        try:
            rows = json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return []
        except (ValueError, OSError, UnicodeDecodeError):
            return []      # 読めなければ、どの鍵でも入れない
        if not isinstance(rows, list):
            return []
        return [r for r in rows if isinstance(r, dict) and isinstance(r.get('name'), str) and r['name']
                and isinstance(r.get('hash'), str) and r.get('space') == 'me'
                and isinstance(r.get('person'), int) and not isinstance(r.get('person'), bool) and r['person'] >= 1]

    def write(self, rows):
        _write_private(self.path, json.dumps(rows, ensure_ascii=False, indent=1) + '\n')

    def add(self, name: str, person: int, read_only: bool) -> str:
        name = name.strip()
        if not name or len(name) > 60 or any(c in name for c in '\t\r\n') or not name.isprintable():
            raise SystemExit('名前を入れてください（60字まで、改行・タブなし。例: machine-add gantt --space me）')
        rows = self.read()
        if any(r['name'] == name for r in rows):
            raise SystemExit(f'「{name}」はもうあります（作り直すなら machine-remove {name} のあとで）')
        key = self.PREFIX + secrets.token_urlsafe(32)
        rows.append({'name': name, 'hash': self.digest(key), 'space': 'me', 'person': int(person),
                     'read_only': bool(read_only), 'created': time.strftime('%Y-%m-%d')})
        self.write(rows)
        return key

    def remove(self, name: str) -> bool:
        rows = self.read()
        keep = [r for r in rows if r['name'] != name.strip()]
        if len(keep) == len(rows):
            return False
        self.write(keep)
        return True

    def find(self, key: str):
        """鍵 → 行。合わなければ None"""
        if not key.startswith(self.PREFIX) or len(key) > 200:
            return None
        h = self.digest(key).encode('ascii')
        hit = None
        for r in self.read():
            if hmac.compare_digest(h, r['hash'].encode('utf-8', 'replace')):
                hit = r
        return hit


def open_spaces(data_dir: Path):
    """{合言葉: (置き場の名前, Store)}（今の合言葉で。テストと前の版の呼び方のため）"""
    return Spaces(data_dir).current()


LOOPBACK = {'127.0.0.1', '::1'}
# 配るページの守り。外のスクリプト・外への接続・よそのページへの埋め込みを許さない。
# style は 'unsafe-inline'（画面が要素の style を使う。スクリプトほど危なくない）
# connect-src に api.anthropic.com を足した（2026-11-04 Issue #9・#14）。設定で API キーを
# 入れたときだけ、ヘルプ画面からブラウザが直接呼ぶ（js/ai.js）。
# api.open-meteo.com を足した（2026-11-08 Issue #30）。日付で見るの [天気を取得] を押したときだけ、
# 全国の約140地点の予報をまとめて取る（js/weather.js。選んだ地域・todo は送らない）。ほかの外部サービスへは広げない。
# Solana の公式 RPC（devnet・mainnet）を足した（2026-11-11 Issue #42 の返事「おすすめで」= A 案）。
# サーバーに繋いだままブロックチェーンのバックアップ・共有の海・チャットを使うため。solo.html の <meta> の CSP と同じ窓口だけ
# （js/chain.js の NETWORKS）。押したときだけ呼び、書くのは暗号化した記録だけ。
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self' https://api.anthropic.com https://api.open-meteo.com "
       "https://api.devnet.solana.com https://api.mainnet-beta.solana.com; font-src 'self'; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'none'")


def log_event(kind: str, ip: str, detail: str = ''):
    """守りの出来事を記録（journal）に1行出す。fail2ban がこれを読む。合言葉・通行証の値は出さない"""
    sys.stderr.write(f'bubbles: {kind} ip={ip}{(" " + detail) if detail else ""}\n')
    sys.stderr.flush()


class Config:
    """入場の仕方と守りの設定。token（合言葉。手元で使う）か passkey（公開して使う）"""

    def __init__(self, auth='token', origin='', rp_id='', trust_proxy=False, allow_origins=(),
                 guard=None, passkeys=None, stores=None, require_uv=True, devices=None, sea_list=None,
                 min_schema=1, machines=None):
        self.auth, self.origin, self.rp_id = auth, origin, rp_id
        self.trust_proxy = trust_proxy
        self.allow_origins = set(allow_origins)
        self.guard = guard or Guard()
        self.passkeys = passkeys
        self.stores = stores or {}
        self.require_uv = require_uv
        self.devices = devices or Devices()   # パスキーの形で、同時に使える端末の数
        self.sea_list = sea_list              # 海の一覧（SeaList）。無ければ /api/spaces は 404
        self.min_schema = int(min_schema)     # 受け付ける最も古い記録の形の版（X-Bubbles-Schema）
        self.machines = machines              # 機械の鍵（MachineKeys）。パスキーの形だけで効く


def make_handler(spaces, cfg: Config = None):
    """spaces = {合言葉: (置き場の名前, Store)}、または current() でそれを返すもの（Spaces）。
    cfg.auth == 'passkey' なら合言葉では入れず、パスキーで出した通行証だけを通す"""
    cfg = cfg or Config()
    table = spaces.current if hasattr(spaces, 'current') else (lambda: spaces)
    sea_stores = getattr(spaces, 'stores', None)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = 'Bubbles'
        sys_version = ''
        timeout = 15             # 1つの接続が送ってくるのを待つ長さ（ゆっくり送る攻撃で止められない）

        def log_message(self, fmt, *args):
            pass  # アクセスログは出さない（記録の中身も出さない）

        # --- 誰からか ---
        def ip(self):
            peer = self.client_address[0]
            if cfg.trust_proxy and peer in LOOPBACK:
                # 前段（Caddy）が付けた最後の1つを使う。それより前は送り手が自由に書ける
                xff = self.headers.get('X-Forwarded-For', '')
                if xff.strip():
                    return xff.split(',')[-1].strip()[:64]
            return peer

        # --- 返す ---
        def send(self, code, body=b'', ctype='application/json', extra=None):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            if ctype.startswith('text/html'):
                self.send_header('Content-Security-Policy', CSP)
            # よそのオリジンから呼んでよいのは、決めた相手だけ（既定は Android 版だけ。公開の形では無し）
            origin = self.headers.get('Origin', '')
            if origin and origin in cfg.allow_origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def send_json(self, code, obj):
            self.send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

        def too_many(self):
            return self.send_json(429, {'error': 'too many'}) or False

        def gate(self):
            """要求の数を数える。多すぎたら 429 を返して False"""
            if not cfg.guard.request(self.ip()):
                log_event('rate-limit', self.ip())
                return self.too_many()
            return True

        def deny(self, reason):
            cfg.guard.auth_failed(self.ip())
            log_event('auth-fail', self.ip(), reason)
            return self.send_json(401, {'error': 'unauthorized'})

        def read_json(self):
            try:
                n = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                n = -1
            if n <= 0 or n > MAX_BODY:
                self.send_json(413 if n > MAX_BODY else 400, {'error': 'bad length'})
                return None
            try:
                body = json.loads(self.rfile.read(n).decode('utf-8'))
            except (ValueError, UnicodeDecodeError):
                self.send_json(400, {'error': 'bad body'})
                return None
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'bad body'})
                return None
            return body

        # --- 入場 ---
        def token_hit(self):
            """合言葉に合った (置き場の名前, Store)。合わなければ None"""
            got_b = self.headers.get('Authorization', '').encode('utf-8')
            hit = None
            # 比べるのは全部の合言葉と（どれに合ったかで時間が変わらないように）
            for tok, sp in table().items():
                if hmac.compare_digest(got_b, ('Bearer ' + tok).encode('utf-8')):
                    hit = sp
            return hit

        def session(self):
            got = self.headers.get('Authorization', '')
            tok = got[7:] if got.startswith('Bearer ') else ''
            return cfg.passkeys.session_info(tok) if tok else None

        def space(self):
            """(置き場の名前, Store)。合わなければ None。どの海かは X-Bubbles-Space（無ければ me）。
            個人（me）は、その鍵の人の個人（2026-11-03。人ごとに別の箱）。
            持ち主（1 番の人）の鍵はどの海にも入れる"""
            want = self.headers.get('X-Bubbles-Space', 'me') or 'me'
            if cfg.auth == 'passkey':
                info = self.session()
                if not info or not valid_space(want) or want not in cfg.stores:
                    return None
                if want == 'me':
                    if info['person'] is None:
                        return None
                    key = 'me' if info['person'] == OWNER else f"me/{info['person']}"
                    if key not in cfg.stores:
                        return None
                elif want in info['spaces'] or info['owner']:
                    key = want
                else:
                    return None
                if not cfg.devices.use(info['cred_id']):
                    return 'devices'
                return want, cfg.stores[key]
            hit = self.token_hit()
            if not hit or hit[0] != 'me' or want == 'me':
                # 共有の合言葉は「共有」だけ（ほかの海を言われても共有を返す。端末が取り違えに気づく）
                return hit
            if sea_stores is not None:
                return (want, sea_stores[want]) if want in sea_stores else None
            # 置き場の表だけを渡されたとき（テスト）: 表にある置き場だけ
            return next(((n, st) for n, st in table().values() if n == want), None)

        def who(self):
            """海の一覧のため。(持ち主か, 入れる置き場) か None。端末の数には入れない"""
            if cfg.auth == 'passkey':
                info = self.session()
                return (info['owner'], list(info['spaces'])) if info else None
            hit = self.token_hit()
            return (hit[0] == 'me', [hit[0]]) if hit else None

        def seas(self):
            """POST /api/spaces。持ち主は一覧を合わせて全部を、招かれた人は入れる海だけを受け取る"""
            if cfg.sea_list is None:
                return self.send_json(404, {'error': 'not found'})
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            w = self.who()
            if not w:
                return self.deny('spaces')
            body = self.read_json()
            if body is None:
                return
            owner, allowed = w
            rows = cfg.sea_list.merge(body.get('spaces')) if owner else cfg.sea_list.read()
            if not owner:
                rows = [r for r in rows if r['id'] in allowed]
            return self.send_json(200, {'spaces': rows})

        def who_am_i(self, tok):
            """入ったあとに端末へ返す {spaces, person, owner}"""
            info = cfg.passkeys.session_info(tok) or {}
            return {'spaces': info.get('spaces', []), 'person': info.get('person'), 'owner': bool(info.get('owner'))}

        def machine(self):
            """機械の鍵の行（パスキーの形で、頭が bm_ の鍵が合ったとき）。それ以外は None"""
            if cfg.auth != 'passkey' or cfg.machines is None:
                return None
            got = self.headers.get('Authorization', '')
            key = got[7:] if got.startswith('Bearer ') else ''
            return cfg.machines.find(key) if key.startswith(MachineKeys.PREFIX) else None

        def machine_space(self, m, write):
            """機械の鍵の置き場。(置き場の名前, Store, 行) か、断ったら None。端末の数には数えない"""
            want = self.headers.get('X-Bubbles-Space', '')
            if want and want != m['space']:
                log_event('machine-forbidden', self.ip(), f'name={m["name"]} space')
                self.send_json(403, {'error': 'forbidden'})
                return None
            if write and m.get('read_only'):
                log_event('machine-forbidden', self.ip(), f'name={m["name"]} read-only')
                self.send_json(403, {'error': 'read only'})
                return None
            key = 'me' if m['person'] == OWNER else f"me/{m['person']}"
            if key not in cfg.stores:
                log_event('machine-forbidden', self.ip(), f'name={m["name"]} no-store')
                self.send_json(403, {'error': 'forbidden'})
                return None
            return m['space'], cfg.stores[key], m

        def authed_space(self, write=False):
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            m = self.machine()
            if m is not None:
                return self.machine_space(m, write)
            sp = self.space()
            if sp == 'devices':
                # 入場の失敗ではない（正しい端末が、混んでいるので待たされる）。失敗の数に入れない
                log_event('device-limit', self.ip())
                self.send_json(429, {'error': 'devices', 'max': cfg.devices.max_active})
                return None
            if not sp:
                return self.deny('data')
            return sp

        def schema(self):
            """端末が言う記録の形の版（X-Bubbles-Schema）。無い・読めないときは 0"""
            v = (self.headers.get('X-Bubbles-Schema', '') or '').strip()
            return int(v) if v.isdigit() and len(v) < 6 else 0

        # --- 受ける ---
        def do_OPTIONS(self):
            if not self.gate():
                return
            self.send(204, extra={
                'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Bubbles-Space, X-Bubbles-Schema',
                'Access-Control-Max-Age': '600',
            })

        def do_GET(self):
            if not self.gate():
                return
            path = self.path.split('?', 1)[0]
            if path == '/api/health':
                return self.send_json(200, {'ok': True})
            if path == '/api/auth':
                return self.send_json(200, {'mode': cfg.auth, 'rp_id': cfg.rp_id if cfg.auth == 'passkey' else ''})
            if path == '/api/data':
                sp = self.authed_space()
                if not sp:
                    return
                cur = sp[1].read()
                out = {'space': sp[0], 'version': cur['version'], 'data': cur['data'], 'minSchema': cfg.min_schema}
                if len(sp) > 2:
                    # 機械の鍵。持ち主の力（どの海にも入れる）は無い。誰の個人かだけを返す
                    out['owner'] = False
                    out['person'] = sp[2]['person']
                elif cfg.auth == 'passkey':
                    # 端末が「誰の個人か」「持ち主か」を知るため（パスキーを移したとき、手元の箱を入れ替える）
                    info = self.session() or {}
                    out['owner'] = bool(info.get('owner'))
                    if sp[0] == 'me':
                        out['person'] = info.get('person')
                return self.send_json(200, out)
            if path.startswith('/api/'):
                return self.send_json(404, {'error': 'not found'})
            return self.static(path)

        do_HEAD = do_GET

        def do_PUT(self):
            if not self.gate():
                return
            if self.path.split('?', 1)[0] != '/api/data':
                return self.send_json(404, {'error': 'not found'})
            sp = self.authed_space(write=True)
            if not sp:
                return
            body = self.read_json()
            if body is None:
                return
            try:
                base = int(body['base'])
                data = body['data']
                if not isinstance(data, dict) or not isinstance(data.get('doc'), dict):
                    raise ValueError('data.doc')
            except (ValueError, KeyError, TypeError):
                return self.send_json(400, {'error': 'bad body'})
            # 記録の形の版。古い版（頭書きの無い前の版を含む）の書き込みは、記録に触れずに断る
            if self.schema() < cfg.min_schema:
                log_event('schema', self.ip(), f'{self.schema()} < {cfg.min_schema}')
                return self.send_json(426, {'error': 'upgrade', 'minSchema': cfg.min_schema})
            ok, res = sp[1].write(base, data)
            if ok:
                return self.send_json(200, {'version': res})
            return self.send_json(409, {'space': sp[0], 'version': res['version'], 'data': res['data']})

        def do_POST(self):
            if not self.gate():
                return
            path = self.path.split('?', 1)[0]
            if path == '/api/spaces':
                return self.seas()
            if cfg.auth != 'passkey' or not path.startswith('/api/passkey/'):
                return self.send_json(404, {'error': 'not found'})
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            body = self.read_json()
            if body is None:
                return
            pk = cfg.passkeys
            try:
                if path == '/api/passkey/request':
                    # 端末からの登録の頼み（Issue #26）。名前だけを受け取り、持ち主が request-ok で認めるまで待たせる
                    try:
                        key, code, exp = pk.add_request(body.get('name', ''), self.ip())
                    except OverflowError:
                        log_event('request-full', self.ip())
                        return self.send_json(429, {'error': 'requests'})
                    log_event('passkey-request', self.ip(), f'code={code}')
                    return self.send_json(200, {'key': key, 'code': code, 'expires': exp})
                if path == '/api/passkey/request/status':
                    state, inv = pk.request_state(body.get('key', ''))
                    if not state:
                        return self.deny('request')   # 断られた・期限切れ・知らない鍵
                    out = {'state': state}
                    if inv:
                        out.update(name=inv['name'], spaces=inv['spaces'])
                    return self.send_json(200, out)
                if path == '/api/passkey/register/options':
                    inv = pk.find_invite(body.get('invite', ''))
                    if not inv:
                        return self.deny('invite')
                    full = pk.full_for(inv)
                    if full:
                        return self.send_json(409, {'error': 'full', 'spaces': full, 'max': pk.max_per_space})
                    chal = pk.new_challenge('create', inv['code_hash'])
                    return self.send_json(200, {'publicKey': {
                        'challenge': chal,
                        'rp': {'id': cfg.rp_id, 'name': 'Bubbles'},
                        'user': {'id': pc.b64u_encode(secrets.token_bytes(16)), 'name': inv['name'], 'displayName': inv['name']},
                        'pubKeyCredParams': [{'type': 'public-key', 'alg': a} for a in pc.SUPPORTED_ALGS],
                        'authenticatorSelection': {'residentKey': 'required', 'requireResidentKey': True,
                                                   'userVerification': 'required'},
                        'attestation': 'none', 'timeout': 120000,
                        'excludeCredentials': [],
                    }})
                if path == '/api/passkey/register':
                    cred = body.get('credential') or {}
                    resp = cred.get('response') or {}
                    cd = pc.b64u_decode(resp.get('clientDataJSON', ''))
                    ch = json.loads(cd.decode('utf-8')).get('challenge', '')
                    got = pk.take_challenge(ch, 'create')
                    if not got:
                        return self.deny('challenge')
                    inv = next((r for r in pk.list_invites() if r['code_hash'] == got['invite_hash']), None)
                    if not inv:
                        return self.deny('invite-used')
                    out = pc.verify_registration(cd, pc.b64u_decode(resp.get('attestationObject', '')),
                                                 challenge=ch, origin=cfg.origin, rp_id=cfg.rp_id,
                                                 require_uv=cfg.require_uv)
                    full = pk.full_for(inv)
                    if full:
                        return self.send_json(409, {'error': 'full', 'spaces': full, 'max': pk.max_per_space})
                    if not pk.use_invite(inv['code_hash']):
                        return self.deny('invite-used')
                    # 引っ越しの鍵（Issue #19）: いっぱいなら、引っ越す前の端末のパスキーを外して空ける
                    retired = pk.retire_for(inv)
                    if retired:
                        cfg.devices.leave(inv.get('from'))
                        log_event('passkey-retired', self.ip(), f'name={retired}')
                    name = pk.add_passkey(name=inv['name'], spaces=inv['spaces'], cred=out, person=inv.get('person'))
                    tok, exp = pk.new_session(out['cred_id'], inv['spaces'])
                    log_event('passkey-registered', self.ip(), f'name={name}')
                    return self.send_json(200, dict(self.who_am_i(tok), session=tok, expires=exp, name=name))
                if path == '/api/passkey/login/options':
                    return self.send_json(200, {'publicKey': {
                        'challenge': pk.new_challenge('get'), 'rpId': cfg.rp_id,
                        'userVerification': 'required', 'timeout': 120000, 'allowCredentials': [],
                    }})
                if path == '/api/passkey/login':
                    cred = body.get('credential') or {}
                    resp = cred.get('response') or {}
                    cd = pc.b64u_decode(resp.get('clientDataJSON', ''))
                    ch = json.loads(cd.decode('utf-8')).get('challenge', '')
                    if not pk.take_challenge(ch, 'get'):
                        return self.deny('challenge')
                    row = pk.find_passkey(str(cred.get('id', '')))
                    if not row:
                        return self.deny('unknown-passkey')
                    count = pc.verify_assertion(public_key=row['public_key'], sign_count=row['sign_count'],
                                                client_data_json=cd,
                                                authenticator_data=pc.b64u_decode(resp.get('authenticatorData', '')),
                                                signature=pc.b64u_decode(resp.get('signature', '')),
                                                challenge=ch, origin=cfg.origin, rp_id=cfg.rp_id,
                                                require_uv=cfg.require_uv)
                    pk.touch_passkey(row['id'], count)
                    tok, exp = pk.new_session(row['id'], row['spaces'])
                    return self.send_json(200, dict(self.who_am_i(tok), session=tok, expires=exp, name=row['name']))
                if path == '/api/passkey/move':
                    # 引っ越しの鍵を作る（Issue #19）。入っている端末だけ。前に作った鍵は使えなくなる
                    info = self.session()
                    if not info:
                        return self.deny('move')
                    key, exp = pk.add_move_key(info['cred_id'])
                    log_event('move-key', self.ip())
                    return self.send_json(200, {'move': key, 'expires': exp})
                if path == '/api/passkey/logout':
                    got = self.headers.get('Authorization', '')
                    cred = pk.end_session(got[7:] if got.startswith('Bearer ') else '')
                    if cred:
                        cfg.devices.leave(cred)
                    return self.send_json(200, {'ok': True})
            except (pc.VerifyError, ValueError, KeyError, TypeError, AttributeError) as e:
                return self.deny('passkey ' + type(e).__name__ + ': ' + str(e)[:60])
            return self.send_json(404, {'error': 'not found'})

        def static(self, path):
            rel = path.lstrip('/') or 'index.html'
            if rel.endswith('/'):
                rel += 'index.html'
            parts = rel.split('/')
            if '..' in parts or not (rel in PUBLIC_FILES or (len(parts) > 1 and parts[0] in PUBLIC_DIRS)):
                return self.send_json(404, {'error': 'not found'})
            f = (ROOT / rel).resolve()
            if ROOT not in f.parents or not f.is_file():
                return self.send_json(404, {'error': 'not found'})
            ctype = TYPES.get(f.suffix, 'application/octet-stream')
            return self.send(200, f.read_bytes(), ctype)

    return Handler


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """接続ごとに1本のスレッド。ただし数を決める（Guard。超えたら読まずに 429 で閉じる）"""
    daemon_threads = True
    allow_reuse_address = True
    guard = None
    trust_proxy = False

    def _per_ip(self, ip):
        # 前段（Caddy）の後ろでは、接続はみな 127.0.0.1 から来る。接続元ごとの数は前段に任せ、全体の数だけを見る
        return not (self.trust_proxy and ip in LOOPBACK)

    def process_request(self, request, client_address):
        g = self.guard or Guard()
        self.guard = g
        ip = client_address[0]
        if not g.open(ip, self._per_ip(ip)):
            try:
                request.sendall(b'HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            log_event('conn-limit', ip)
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.guard.close(client_address[0], self._per_ip(client_address[0]))


def token_command(data_dir: Path, cmd: str, name: str) -> int:
    """合言葉の操作。動いているサーバーは止めなくてよい（次の接続から効く）"""
    shares = ShareTokens(data_dir)
    load_token(data_dir, 'me')
    shares.ensure()
    if cmd == 'share-add':
        tok = shares.add(name)
        _show_token('共有', f'{shares.path} の「{name.strip()}」', tok)
        print('この人には、住所とこの合言葉だけを渡してください', flush=True)
    elif cmd == 'share-list':
        rows = shares.read()
        if not rows:
            print('共有の合言葉はありません（share-add <名前> で作る）')
        for r in rows:
            print(f"{r['name']}\t{r.get('created', '')}\t…{r['token'][-4:]}")
        if os.environ.get('BUBBLE_TODO_SHARE_TOKEN', '').strip():
            print('（ほかに環境変数 BUBBLE_TODO_SHARE_TOKEN の1つ）')
    elif cmd == 'share-remove':
        if not shares.remove(name):
            raise SystemExit(f'「{name}」は見つかりません（share-list で名前を確かめる）')
        print(f'「{name}」の合言葉を取り消しました。その端末は次の接続から入れません', flush=True)
    elif cmd == 'rotate-me':
        if os.environ.get('BUBBLE_TODO_TOKEN', '').strip():
            raise SystemExit('自分の合言葉は環境変数 BUBBLE_TODO_TOKEN から来ています。そちらを替えてください')
        tok = secrets.token_urlsafe(24)
        _write_private(data_dir / 'token.txt', tok + '\n')
        _show_token('個人', str(data_dir / 'token.txt'), tok)
        print('自分の端末すべてで、設定の「自分の合言葉」を入れ直してください', flush=True)
    return 0


def where_of(row):
    """passkey-list・invite-list に出す置き場。個人は番号つき"""
    return ','.join(person_label(person_of(row)) if s == 'me' else space_label(s) for s in row.get('spaces', []))


def passkey_command(data_dir: Path, cmd: str, name: str, space: str, max_passkeys: int = 3, value: str = '') -> int:
    """パスキーの操作（公開の形）。動いているサーバーは止めなくてよい"""
    pk = PasskeyStore(data_dir, max_per_space=max_passkeys)

    def parse_spaces():
        spaces, person = [], None
        for s in (x.strip() for x in (space or 'share').split(',')):
            m = re.fullmatch(r'me:([1-9][0-9]{0,5})', s)
            if m:                      # me:2 … 2 番の人の、もう1台
                spaces.append('me')
                person = int(m.group(1))
            elif s:
                spaces.append(s)
        if not spaces or any(not valid_space(s) for s in spaces):
            raise SystemExit('置き場は me（新しい人）・me:<番号>（その人の端末）・share・海の ID をコンマで')
        return spaces, person

    if cmd == 'invite-add':
        spaces, person = parse_spaces()
        try:
            code, person = pk.add_invite_full(name, spaces, person=person)
        except ValueError as e:
            raise SystemExit(str(e)) from None
        where = 'と'.join(person_label(person) if s == 'me' else space_label(s) for s in spaces)
        print(f'「{name}」の招待コード（{where}。24時間・1回だけ）: {code}', flush=True)
        print('相手には、住所とこのコードを渡す。相手は Bubbles の設定の「パスキー」で登録する', flush=True)
        print('（招待コードを先に作らなくても、相手の端末から「登録を頼む」→ request-list・request-ok でもよい）', flush=True)
    elif cmd == 'request-list':
        # 端末からの登録の頼み（Issue #26）
        rows = pk.list_requests()
        if not rows:
            print('待っている頼みはありません（端末の設定の「パスキー」→「登録を頼む」で届く）')
        for r in rows:
            print(f"{r['code']}\t{r['name']}\t頼んだ {time.strftime('%m-%d %H:%M', time.localtime(r['created']))}"
                  f"\t期限 {time.strftime('%m-%d %H:%M', time.localtime(r['expires']))}")
        if rows:
            print('端末の画面に出ている字と同じものを認める: request-ok <字> --space me（新しい人）／me:1,share（自分の端末）／share', flush=True)
    elif cmd == 'request-ok':
        spaces, person = parse_spaces()
        try:
            got, person = pk.approve_request(name, spaces, person=person)
        except ValueError as e:
            raise SystemExit(str(e)) from None
        where = 'と'.join(person_label(person) if s == 'me' else space_label(s) for s in spaces)
        print(f'「{got}」の頼みを認めました（{where}）。端末の画面で「登録を仕上げる」を押すと登録できます（24時間）', flush=True)
    elif cmd == 'request-no':
        if not pk.deny_request(name):
            raise SystemExit(f'「{name}」の頼みはありません（request-list で確かめる）')
        print(f'「{name}」の頼みを断りました', flush=True)
    elif cmd == 'limit':
        print(f'置き場ごとに登録できるパスキー: {pk.max_per_space} 台（変えるなら limit-set <数>）', flush=True)
    elif cmd == 'limit-set':
        try:
            n = pk.set_limit(name)
        except ValueError as e:
            raise SystemExit(str(e)) from None
        print(f'置き場ごとに登録できるパスキーを {n} 台にしました。動いているサーバーにも次の要求から効きます', flush=True)
        for lab, c in pk.over_limit():
            print(f'（{lab}は {c} 台。外さずに残しますが、{n} 台より少なくなるまで新しい登録を断ります）', flush=True)
    elif cmd == 'invite-list':
        rows = pk.list_invites()
        if not rows:
            print('使われていない招待コードはありません')
        for r in rows:
            if r.get('kind') == 'move':   # 引っ越しの鍵（Issue #19）
                print(f"{r['name']}\t{where_of(r)}\t引っ越しの鍵（作った {time.strftime('%Y-%m-%d', time.localtime(r['created']))}）")
            else:
                print(f"{r['name']}\t{where_of(r)}\t期限 {time.strftime('%m-%d %H:%M', time.localtime(r['expires']))}")
    elif cmd == 'passkey-list':
        rows = pk.passkeys()
        if not rows:
            print('登録したパスキーはありません（invite-add <名前> で招待コードを作る）')
        for r in rows:
            last = time.strftime('%Y-%m-%d', time.localtime(r['last_used'])) if r.get('last_used') else '未使用'
            print(f"{r['name']}\t{where_of(r)}\t登録 {time.strftime('%Y-%m-%d', time.localtime(r['created']))}\t最後 {last}")
        used = list(dict.fromkeys(['share'] + [s for r in rows for s in r.get('spaces', []) if s != 'me']))
        counts = [f'{person_label(n)} {pk.count_in("me", n)}/{pk.max_per_space}' for n in pk.persons()]
        print('（' + '・'.join(counts + [f'{space_label(s)} {pk.count_in(s)}/{pk.max_per_space}' for s in used]) + '）')
    elif cmd == 'passkey-person':
        if not value.strip():
            raise SystemExit('移す先を入れてください（例: passkey-person 母のスマホ new ／ passkey-person 母のタブレット 2）')
        to = value.strip()
        if to != 'new' and not re.fullmatch(r'[1-9][0-9]{0,5}', to):
            raise SystemExit('移す先は番号か new（新しい人）')
        try:
            got = pk.set_person(name, to if to == 'new' else int(to))
        except ValueError as e:
            raise SystemExit(str(e)) from None
        print(f'「{name}」を{person_label(got)}へ移しました。その端末は次に合わせたときから{person_label(got)}の記録を使います', flush=True)
    elif cmd == 'passkey-remove':
        if not pk.remove_passkey(name):
            raise SystemExit(f'「{name}」は見つかりません（passkey-list で名前を確かめる）')
        print(f'「{name}」のパスキーと通行証を取り消しました。その端末は次の要求から入れません', flush=True)
        print(f'（「{name}」が作った引っ越しの鍵は残しています。失くした端末の引っ越しに使うため。消すなら move-remove {name}）', flush=True)
    elif cmd == 'move-remove':
        n = pk.remove_move_keys(name)
        if not n:
            raise SystemExit(f'「{name}」の引っ越しの鍵はありません（invite-list で確かめる）')
        print(f'「{name}」の引っ越しの鍵を消しました。その鍵の入った引っ越しのファイルでは登録できません'
              '（記録はファイルから戻せます）', flush=True)
    return 0


def machine_command(data_dir: Path, cmd: str, name: str, space: str, read_only: bool) -> int:
    """機械の鍵の操作（公開の形。共有の記録 v1.2 §8）。動いているサーバーは止めなくてよい"""
    keys = MachineKeys(data_dir)
    if cmd == 'machine-add':
        m = re.fullmatch(r'me(?::([1-9][0-9]{0,5}))?', (space or '').strip())
        if not m:
            raise SystemExit('置き場は me（持ち主の個人）か me:<番号>（その人の個人）。例: machine-add gantt --space me')
        person = int(m.group(1) or OWNER)
        if person != OWNER and person not in PasskeyStore(data_dir).persons():
            raise SystemExit(f'{person_label(person)}はいません（passkey-list で番号を確かめる）')
        key = keys.add(name, person, read_only)
        how = '読むだけ' if read_only else '読み書き'
        # 鍵はここで1度だけ出す。サーバーにはハッシュだけが残る（失くしたら作り直す）
        print(f'「{name.strip()}」の機械の鍵（{person_label(person)}・{how}）: {key}', flush=True)
        print('この鍵はもう出せません。使う機械のファイルに入れ（例: chmod 600 の bubble_key.txt）、'
              '画面・ログ・会話には出さないでください', flush=True)
    elif cmd == 'machine-list':
        rows = keys.read()
        if not rows:
            print('機械の鍵はありません（machine-add <名前> --space me で作る）')
        for r in rows:
            print(f"{r['name']}\t{person_label(r['person'])}\t{'読むだけ' if r.get('read_only') else '読み書き'}"
                  f"\t作った {r.get('created', '')}")
    elif cmd == 'machine-remove':
        if not keys.remove(name):
            raise SystemExit(f'「{name}」は見つかりません（machine-list で名前を確かめる）')
        print(f'「{name}」の機械の鍵を消しました。その鍵は次の要求から入れません', flush=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Bubbles の記録を置くサーバー')
    ap.add_argument('--host', default='127.0.0.1',
                    help='待ち受ける住所（既定 127.0.0.1。外へは前段の Caddy で出す）')
    ap.add_argument('--port', type=int, default=int(os.environ.get('BUBBLE_TODO_PORT', '8931')))
    ap.add_argument('--data-dir', default=os.environ.get('BUBBLE_TODO_DATA', str(ROOT / 'data')))
    ap.add_argument('--auth', choices=['token', 'passkey'], default=os.environ.get('BUBBLE_TODO_AUTH', 'token'),
                    help='token: 合言葉（手元で使う） / passkey: パスキーだけ（公開して使う）')
    ap.add_argument('--origin', default=os.environ.get('BUBBLE_TODO_ORIGIN', ''),
                    help='passkey のとき要る。利用者が開く住所（例 https://bubbles.example.org）')
    ap.add_argument('--rp-id', default=os.environ.get('BUBBLE_TODO_RP_ID', ''),
                    help='パスキーを結び付ける名前（既定は --origin の名前）')
    ap.add_argument('--trust-proxy', action='store_true',
                    help='前段（Caddy）の X-Forwarded-For で接続元を数える（127.0.0.1 から来たときだけ）')
    ap.add_argument('--allow-origin', action='append', default=None,
                    help='よそのオリジンから呼んでよい相手（何度でも）。既定は token のとき Android 版、passkey のとき無し')
    ap.add_argument('--space', default='share',
                    help='invite-add の置き場（me＝新しい人 / me:<番号>＝その人の端末 / share / 海の ID をコンマで）')
    ap.add_argument('--max-passkeys', type=int, default=int(os.environ.get('BUBBLE_TODO_MAX_PASSKEYS', '3')),
                    help='置き場ごとに登録できるパスキーの数（既定 3）')
    ap.add_argument('--max-devices', type=int, default=int(os.environ.get('BUBBLE_TODO_MAX_DEVICES', '3')),
                    help='同時に使える端末の数（既定 3。--device-window 秒以内に使った端末を数える）')
    ap.add_argument('--device-window', type=int, default=int(os.environ.get('BUBBLE_TODO_DEVICE_WINDOW', '1800')))
    ap.add_argument('--read-only', action='store_true',
                    help='machine-add で、読むだけ（PUT できない）の鍵にする')
    ap.add_argument('--min-schema', type=int, default=int(os.environ.get('BUBBLE_TODO_MIN_SCHEMA', '1')),
                    help='受け付ける最も古い記録の形の版（既定 1）。これより古い端末の書き込みは 426 で断る')
    ap.add_argument('command', nargs='?', default='serve',
                    choices=['serve', 'share-add', 'share-list', 'share-remove', 'rotate-me',
                             'invite-add', 'invite-list', 'passkey-list', 'passkey-remove', 'passkey-person',
                             'move-remove', 'request-list', 'request-ok', 'request-no', 'limit', 'limit-set',
                             'machine-add', 'machine-list', 'machine-remove'],
                    help='serve（既定）か、合言葉・パスキーの操作')
    ap.add_argument('name', nargs='?', default='',
                    help='share-add / share-remove / invite-add / passkey-remove の名前、request-ok / request-no の字、limit-set の数')
    ap.add_argument('value', nargs='?', default='', help='passkey-person の移す先（番号か new）')
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    if args.command in ('machine-add', 'machine-list', 'machine-remove'):
        if args.command != 'machine-list' and not args.name.strip():
            raise SystemExit(f'名前を入れてください（例: {args.command} gantt）')
        if args.command == 'machine-add' and args.space == 'share':
            raise SystemExit('置き場を --space me か --space me:<番号> で入れてください（例: machine-add gantt --space me）')
        return machine_command(data_dir, args.command, args.name, args.space, args.read_only)
    if args.command in ('invite-add', 'invite-list', 'passkey-list', 'passkey-remove', 'passkey-person', 'move-remove',
                        'request-list', 'request-ok', 'request-no', 'limit', 'limit-set'):
        if args.command in ('request-ok', 'request-no') and not args.name.strip():
            raise SystemExit(f'端末の画面に出ている字を入れてください（例: {args.command} ABC-DEF。request-list で見られる）')
        if args.command == 'limit-set' and not args.name.strip():
            raise SystemExit('上限の数を入れてください（例: limit-set 5）')
        if args.command in ('invite-add', 'passkey-remove', 'passkey-person', 'move-remove') and not args.name.strip():
            raise SystemExit(f'名前を入れてください（例: {args.command} 母のスマホ）')
        return passkey_command(data_dir, args.command, args.name, args.space, args.max_passkeys, args.value)
    if args.command != 'serve':
        return token_command(data_dir, args.command, args.name)

    from urllib.parse import urlsplit
    if args.auth == 'passkey':
        u = urlsplit(args.origin)
        local = u.hostname in ('localhost', '127.0.0.1')
        if not u.scheme or not u.hostname or (u.scheme != 'https' and not local):
            raise SystemExit('--auth passkey には --origin https://<名前> が要ります（開発で localhost のときだけ http）')
        origin = f'{u.scheme}://{u.netloc}'
        rp_id = args.rp_id or u.hostname
        if rp_id != u.hostname and not u.hostname.endswith('.' + rp_id):
            raise SystemExit('--rp-id は --origin の名前か、その親の名前にする')
        cfg = Config(auth='passkey', origin=origin, rp_id=rp_id, trust_proxy=args.trust_proxy,
                     allow_origins=args.allow_origin or (), passkeys=PasskeyStore(data_dir, max_per_space=args.max_passkeys),
                     stores=SeaStores(data_dir), devices=Devices(max_active=args.max_devices, window=args.device_window),
                     sea_list=SeaList(data_dir), min_schema=args.min_schema, machines=MachineKeys(data_dir))
        spaces = {}
    else:
        cfg = Config(auth='token', trust_proxy=args.trust_proxy,
                     allow_origins=args.allow_origin if args.allow_origin is not None
                     else ('https://localhost', 'capacitor://localhost'),
                     sea_list=SeaList(data_dir), min_schema=args.min_schema)
        spaces = Spaces(data_dir)
    Server.guard, Server.trust_proxy = cfg.guard, cfg.trust_proxy
    httpd = Server((args.host, args.port), make_handler(spaces, cfg))
    print(f'Bubbles server: http://{args.host}:{args.port}/  data: {data_dir}  auth: {cfg.auth}  min-schema: {cfg.min_schema}'
          + (f'  origin: {cfg.origin}  rp_id: {cfg.rp_id}' if cfg.auth == 'passkey' else ''), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
