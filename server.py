#!/usr/bin/env python3
"""Bubbles の記録を置くサーバー（2026-10-23）。Python の標準ライブラリだけで動く。
このサーバーは海（個人・共有・作った海）をいくつでも預かる。画面では海ごとに同期の先としてこのサーバーを選ぶ
（2026-11-12 Issue #47 の返事で「海域」の言葉をやめた）。

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
                             → {"spaces": [...], "access": [...]}  海の一覧。パスキーの形では書き換えず、入れる海と入れる置き場だけを返す（海の管理は VM の sea-add など）。合言葉の形で自分の合言葉なら合わせて全部を返し、
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
        --space me      … 新しい人（次の番号）の個人。1 番の人の記録は state.json のまま
        --space me:2    … 2 番の人の、もう1台の端末
        ほかの人の記録は <データの場所>/people/<番号>/state.json。すべての海に入れる人はいない（2026-11-16）
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
    POST /api/passkey/invite（Authorization: Bearer 通行証）{name, sea, newPerson?} → {code, spaces, person}
        端末から人を招く（2026-11-16）。自分の個人の2台目と、入れる海だけ（新しい人は VM の invite-add <名前> me）。
        範囲の外は 403 {"error": "scope"}、いっぱいなどは 409 {"error": "invite"}。招いた人の名前を by に残す（passkey-list に出る）
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
claude.ai の接続（2026-11-17。OAuth 2.1。oauth_server.py。パスキーの形だけ。合言葉の形では 404）:
    GET  /.well-known/oauth-authorization-server   許可のサーバーの案内（RFC 8414）
    GET  /.well-known/oauth-protected-resource[/mcp] /mcp の案内（RFC 9728）
    GET  /oauth/authorize    許可の画面（相手の名乗り＝client_id の住所の JSON を確かめてから出す。PKCE S256 だけ）
    POST /oauth/approve {request, credential} 持ち主のパスキーで許す → {redirect}
                             {request, session: true}＋Authorization: Bearer <端末の通行証> 前もって登録した相手（gantt・diary）だけ。パスキーの操作なしで許す（2026-11-18）   POST /oauth/deny {request} → {redirect}
    POST /oauth/token        code・更新の札 → 通行証（ba_…・1 時間）と更新の札（bf_…・30 日。使うたびに替わる）
    POST /mcp                Authorization: Bearer ba_…（まだ道具は無い。JSON-RPC の断りを返す）
    相手の住所の名前は --oauth-client-host（何度でも。環境変数 BUBBLE_TODO_OAUTH_CLIENT_HOSTS。既定 claude.ai）
    python3 server.py oauth-list / oauth-revoke <id|all>   許可の一覧・取り消し（値は出さない。止めずに効く）
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
from urllib.parse import parse_qs, urlsplit

import oauth_server
from filelock import DirLock
import passkey_crypto as pc
from guard import Devices, Guard
from passkey_store import PasskeyStore, valid_space, space_label, person_label, person_of, OWNER, clean_name, AVATARS

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
        # プロセスをまたぐ錠（2026-11-17。前の住所と新しい住所の2つの server.py が同じ置き場を書くため）
        self.lock = DirLock(data_dir / '.lock-state')
        self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)   # 新しく作るときは持ち主だけ（Issue #48）

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
        # 写しも本体と同じく持ち主だけが読める形にする（2026-11-13 Issue #48 の A 案）。
        # 前はサーバーの既定（多くは 644）で書いていた。前からあるフォルダも 700 に直す
        self.backup.mkdir(mode=0o700, exist_ok=True)
        try:
            os.chmod(self.backup, 0o700)
        except OSError:
            pass
        stamp = time.strftime('%Y%m%d-%H%M%S')
        dst = self.backup / f'state-{stamp}-{secrets.token_hex(8)}.json'   # 2 バイトでは毎秒数百回の書き込みで名前がぶつかった（2026-11-17）
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(self.path.read_bytes())
        olds = sorted(self.backup.glob('state-*.json'))
        for p in olds[:-BACKUP_KEEP]:
            p.unlink(missing_ok=True)


SNAP_KEEP = 30
SNAP_ID_RE = re.compile(r'^[0-9]{13}-[0-9a-f]{8}$')


class Snapshots:
    """押して取るバックアップ（2026-11-19 ユーザーの指示「能動的なバックアップを追加して」「サーバーバックアップをリストして、復元機能をつけて」）。
    置き場（海）のフォルダの snapshots/snap-<ms>-<hex>.json = {id, at, label, device, seas, todos, payload}（0600）。
    payload は端末の控え（js/folderbackup.js の buildBackup の形。中は見ずに預かる。数えるのは一覧に出す数だけ）。
    書くたびに作る自動の写し（backup/state-*.json）とは別。新しい SNAP_KEEP 個だけ残す"""

    def __init__(self, store_dir: Path):
        self.dir = store_dir / 'snapshots'
        self.lock = DirLock(store_dir / '.lock-snap')

    @staticmethod
    def _count(payload):
        boxes = payload.get('boxes') if isinstance(payload, dict) else None
        if not isinstance(boxes, dict):
            return 0, 0
        n = 0
        for b in boxes.values():
            todos = ((b or {}).get('doc') or {}).get('todos') if isinstance(b, dict) else None
            if isinstance(todos, list):
                n += sum(1 for t in todos if isinstance(t, dict) and not t.get('trashed'))
        return len(boxes), n

    def save(self, payload, label='', device=''):
        if not isinstance(payload, dict) or not isinstance(payload.get('boxes'), dict):
            raise ValueError('payload')
        seas, todos = self._count(payload)
        with self.lock:
            self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            # 同じミリ秒に 2 つ預けても並びが崩れないよう、前のものより後の時刻にする（一覧は名前の順）
            last = max((int(p.name[5:18]) for p in self.dir.glob('snap-*.json') if p.name[5:18].isdigit()), default=0)
            at = max(int(time.time() * 1000), last + 1)
            sid = f'{at}-{secrets.token_hex(4)}'
            rec = {'id': sid, 'at': at, 'label': str(label or '')[:60], 'device': str(device or '')[:60],
                   'seas': seas, 'todos': todos, 'payload': payload}
            fd = os.open(self.dir / f'snap-{sid}.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(rec, f, ensure_ascii=False)
            for p in sorted(self.dir.glob('snap-*.json'))[:-SNAP_KEEP]:
                p.unlink(missing_ok=True)
        return {k: rec[k] for k in ('id', 'at', 'label', 'device', 'seas', 'todos')}

    def list(self):
        out = []
        for p in sorted(self.dir.glob('snap-*.json'), reverse=True) if self.dir.exists() else []:
            try:
                with p.open(encoding='utf-8') as f:
                    rec = json.load(f)
                out.append({k: rec.get(k) for k in ('id', 'at', 'label', 'device', 'seas', 'todos')})
            except (OSError, ValueError):
                continue
        return out

    def get(self, sid):
        if not SNAP_ID_RE.match(str(sid or '')):
            return None
        p = self.dir / f'snap-{sid}.json'
        if not p.exists():
            return None
        with p.open(encoding='utf-8') as f:
            return json.load(f)


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
        self.lock = DirLock(data_dir / '.lock-seas')

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
        self.lock = DirLock(data_dir / '.lock-machines')

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
        with self.lock:
            rows = self.read()
            if any(r['name'] == name for r in rows):
                raise SystemExit(f'「{name}」はもうあります（作り直すなら machine-remove {name} のあとで）')
            key = self.PREFIX + secrets.token_urlsafe(32)
            rows.append({'name': name, 'hash': self.digest(key), 'space': 'me', 'person': int(person),
                         'read_only': bool(read_only), 'created': time.strftime('%Y-%m-%d')})
            self.write(rows)
        return key

    def remove(self, name: str) -> bool:
        with self.lock:
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
# Solana の公式 RPC（devnet・mainnet）は 2026-11-11 Issue #42 で足したが、2026-11-17 Issue #78
# 「サーバーあり版のwebRTCとブロックチェーンを使った箇所の機能とそれに関連する設定を削除」で外した。
# サーバーが配るページ（index.html）ではブロックチェーンの欄を出さない。ブロックチェーンはサーバーなし版（noserver.html）だけ。
# AI の会社を選べるようにし、OpenAI（api.openai.com）と Google Gemini（generativelanguage.googleapis.com）を
# 足した（2026-11-12 Issue #46 の返事「おすすめで」= A 案）。js/ai.js の PROVIDERS の origin と同じ窓口だけ。
# 設定で選んだ 1 社にだけ、押したときに送る。住所を自分で入れる形は作らない（CSP を広げないため）。
# AI の 3 社も 2026-11-17 Issue #78 の返事「AI機能と設定の関連を削除して」で外した（サーバーあり版では AI の機能を出さない。
# AI はサーバーなし版 noserver.html だけ）。
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self' https://api.open-meteo.com; font-src 'self'; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'none'")


def diary_origin(origin: str, app_urls: dict) -> str:
    """diary の住所の根（2026-11-18 取り決め §8.3。引っ越しのファイルに日記の束を入れる・戻すときだけ、画面が呼ぶ）。
    --app-url の diary を正とし、無ければ js/apps.js の deriveAppUrls と同じ決め方（手元は 127.0.0.1:8780、bubbles.<名前> → diary.<名前>）"""
    got = (app_urls or {}).get('diary') or ''
    if got:
        return got
    try:
        u = urlsplit(origin)
    except ValueError:
        return ''
    host = (u.hostname or '').lower()
    if host in ('localhost', '127.0.0.1'):
        return 'http://127.0.0.1:8780'
    if host.startswith('bubbles.'):
        return 'https://diary.' + host[len('bubbles.'):]
    return ''


def csp_for(origin: str, app_urls: dict) -> str:
    """配るページの CSP。connect-src に diary の住所の根だけを足す（ほかの外へは広げない）"""
    d = diary_origin(origin, app_urls)
    return CSP.replace("connect-src 'self' https://api.open-meteo.com",
                       "connect-src 'self' https://api.open-meteo.com" + (' ' + d if d else ''), 1)


def log_event(kind: str, ip: str, detail: str = ''):
    """守りの出来事を記録（journal）に1行出す。fail2ban がこれを読む。合言葉・通行証の値は出さない"""
    sys.stderr.write(f'bubbles: {kind} ip={ip}{(" " + detail) if detail else ""}\n')
    sys.stderr.flush()


class Config:
    """入場の仕方と守りの設定。token（合言葉。手元で使う）か passkey（公開して使う）"""

    def __init__(self, auth='token', origin='', rp_id='', trust_proxy=False, allow_origins=(),
                 guard=None, passkeys=None, stores=None, require_uv=True, devices=None, sea_list=None,
                 min_schema=1, machines=None, oauth=None, app_urls=None):
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
        self.oauth = oauth                    # claude.ai の接続（oauth_server.OAuth）。パスキーの形だけで効く
        self.app_urls = dict(app_urls or {})  # 3 つの app の住所の根（2026-11-18 取り決め §7.2。GET /api/apps）
        self.csp = csp_for(origin or '', self.app_urls)   # connect-src に diary の住所（2026-11-18 §8.3）


class DeviceCodeGuard:
    """端末を足す番号（数字 6 桁）の当て推量を止める（2026-11-18）。接続元を変えて試されても、
    全体で 10 分に 20 回外れたら、10 分のあいだ番号での登録を断る（正しい番号で登録できたら数え直す）"""

    def __init__(self, limit=20, window=600, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.fails = []
        self.lock = threading.Lock()

    def _trim(self):
        now = self.clock()
        self.fails = [t for t in self.fails if now - t < self.window]

    def failed(self):
        with self.lock:
            self._trim()
            self.fails.append(self.clock())

    def blocked(self):
        with self.lock:
            self._trim()
            return len(self.fails) >= self.limit

    def reset(self):
        with self.lock:
            self.fails = []


ROLE_LABEL = {'owner': '持ち主', 'editor': '書ける', 'viewer': '見るだけ'}
SEA_HEX = {'magma': '#c2412d', 'moss': '#3f8a4a', 'dusk': '#7a52b8', 'sand': '#b07a1c', 'ink': '#6b6b6b'}   # js/spacelist.js の COLORS
PERSONAL_HEX = '#2f7bbf'


def me_of(pk, sea_list, info):
    """GET /api/me の答え（2026-11-18 取り決め §2）。info は session_info の形"""
    rows = {r['id']: r for r in (sea_list.read() if sea_list else [])}
    users = {u['id']: u for u in pk.users()}
    seas = [{'id': 'me', 'name': 'わたし', 'kind': 'personal', 'role': 'owner', 'color': PERSONAL_HEX}]
    for sea, role in info.get('roles', {}).items():
        if sea == 'me':
            continue
        r = rows.get(sea) or {}
        if r and not r.get('alive', 1):
            continue
        members = [{'id': m['user'], 'name': users.get(m['user'], {}).get('name', ''), 'role': m['role'],
                    'avatar': pk.avatar_of(users.get(m['user']))}
                   for m in pk.members_of(sea)]
        seas.append({'id': sea, 'name': r.get('name') or ('共有' if sea == 'share' else sea), 'kind': 'shared',
                     'role': role, 'color': SEA_HEX.get(r.get('color'), SEA_HEX['magma']), 'members': members})
    user = {'id': info.get('user'), 'name': info.get('name', '')}
    if info.get('avatar'):
        user['avatar'] = info['avatar']      # 2026-11-18。足しただけ（3 つの app の左上のアイコン）
    if pk.is_admin(info.get('user')):
        user['admin'] = True                 # 2026-11-18。足しただけ（スーパーユーザーにだけ［新しい利用者を招く］を出す）
    return {'user': user, 'seas': seas}


def make_handler(spaces, cfg: Config = None):
    """spaces = {合言葉: (置き場の名前, Store)}、または current() でそれを返すもの（Spaces）。
    cfg.auth == 'passkey' なら合言葉では入れず、パスキーで出した通行証だけを通す"""
    cfg = cfg or Config()
    table = spaces.current if hasattr(spaces, 'current') else (lambda: spaces)
    device_guard = DeviceCodeGuard()
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
                self.send_header('Content-Security-Policy', cfg.csp)
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

        def gate(self, static=False):
            """要求の数を数える。多すぎたら 429 を返して False。
            static（/api/ 以外の GET・HEAD＝画面のファイル）は別の大きめの枠で数える（2026-11-12。guard.py の頭を見よ）。
            どちらも記録には rate-limit と出す（fail2ban が読む。画面のファイルの枠に当たるのは 1 分に数百回なので、締め出してよい）"""
            ok = cfg.guard.request_static(self.ip()) if static else cfg.guard.request(self.ip())
            if not ok:
                log_event('rate-limit', self.ip(), 'static' if static else '')
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

        def bearer(self):
            got = self.headers.get('Authorization', '')
            return got[7:] if got.startswith('Bearer ') else ''

        def session(self):
            tok = self.bearer()
            return cfg.passkeys.session_info(tok) if tok else None

        def principal(self):
            """記録の API・/api/me の呼び手（2026-11-18）→ (info, None) か (None, 'expired'|'none')。
            端末の通行証（パスキーで入った端末）か、利用者の OAuth の通行証（ba_。宛てが bubble の記録の API のもの。
            gantt・diary）。info は session_info と同じ形に kind（device|oauth）と write（書けるか）を足したもの"""
            tok = self.bearer()
            if not tok or cfg.auth != 'passkey':
                return None, 'none'
            info = cfg.passkeys.session_info(tok)
            if info:
                return dict(info, kind='device', write=True), None
            if cfg.oauth is not None and tok.startswith('ba_'):
                g, why = cfg.oauth.check_access(tok, resource=cfg.oauth.api_resource)
                if not g:
                    return None, why
                u = cfg.passkeys.find_user(cfg.oauth.grant_user(g))
                if u:
                    return dict(cfg.passkeys.info_of_user(u), kind='oauth',
                                write=oauth_server.SCOPE in g['scope'].split(), scope=g['scope']), None
            return None, 'none'

        def space(self, write=False):
            """(置き場の名前, Store)。入れなければ None（401）か 'forbidden'（403）か 'expired'（401・失敗に数えない）。
            どの海かは X-Bubbles-Space（無ければ me）。
            個人（me）は、その利用者の個人の海。海は、その利用者が仲間の海だけ（2026-11-18。海の仲間の表）。
            見るだけ（viewer）の海と、読むだけの通行証（todo.read）の書き込みは 'forbidden'"""
            want = self.headers.get('X-Bubbles-Space', 'me') or 'me'
            if cfg.auth == 'passkey':
                info, why = self.principal()
                if not info:
                    return 'expired' if why == 'expired' else None
                if not valid_space(want) or want not in cfg.stores:
                    return 'forbidden'
                if want == 'me':
                    key = 'me' if info['person'] == OWNER else f"me/{info['person']}"
                    if key not in cfg.stores:
                        return 'forbidden'
                    role = 'owner'
                else:
                    role = info['roles'].get(want)
                    if not role:
                        return 'forbidden'
                    key = want
                if write and (role == 'viewer' or not info['write']):
                    return 'forbidden'
                if info['kind'] == 'device' and not cfg.devices.use(info['cred_id']):
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
            """海の一覧のため。(持ち主か, 入れる置き場, 役割) か None。端末の数には入れない"""
            if cfg.auth == 'passkey':
                info, _ = self.principal()
                return (False, list(info['spaces']), info['roles']) if info else None
            hit = self.token_hit()
            return (hit[0] == 'me', [hit[0]], {}) if hit else None

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
            owner, allowed, roles = w
            # パスキーの形では、端末から書き換えられるのは、その利用者が持ち主（owner）の海の名前・色・消した印だけ
            # （2026-11-18 ユーザーの決定「海の管理は作成者が行う」。前は VM だけ。2026-11-16）。
            # 入れる海だけを返し、端末が鍵の入れる置き場を新しくできるよう access も返す
            if owner:
                rows = cfg.sea_list.merge(body.get('spaces'))
            elif cfg.auth == 'passkey' and isinstance(body.get('spaces'), list):
                mine = [e for e in body['spaces'] if isinstance(e, dict) and roles.get(e.get('id')) == 'owner']
                rows = cfg.sea_list.merge(mine) if mine else cfg.sea_list.read()
            else:
                rows = cfg.sea_list.read()
            if not owner:
                rows = [r for r in rows if r['id'] in allowed]
            out = {'spaces': rows, 'access': allowed}
            if roles:
                out['roles'] = roles
            return self.send_json(200, out)

        def sea_admin(self, path):
            """海の管理（2026-11-18 ユーザーの決定「海の管理は作成者が行う」）。端末の通行証だけ（OAuth の通行証では受けない）。
            POST /api/sea/create {id?, name, color}     共有の海を作る（作った人が owner）
                 /api/sea/update {sea, name?, color?}  名前・色（owner）
                 /api/sea/remove {sea}                 消す（owner。一覧に消した印を付け、仲間を外す。記録の置き場は残す）
                 /api/sea/role   {sea, user, role}     仲間の役割を editor / viewer に（owner）
                 /api/sea/kick   {sea, user}           仲間を外す（owner）
                 /api/sea/transfer {sea, user}         持ち主を渡す（owner。渡した人は editor になる）
                 /api/sea/leave  {sea}                 海を出る（owner は、ほかの仲間がいれば先に渡す。いなければ消す）
            答えは GET /api/me と同じ形（入れる海と仲間）。断りは 403 scope・404 sea・409 {error, message}"""
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            info = self.session()
            if not info:
                return self.deny('sea-admin')
            body = self.read_json()
            if body is None:
                return
            pk, sl, uid = cfg.passkeys, cfg.sea_list, info['user']
            if sl is None:
                return self.send_json(404, {'error': 'not found'})
            op = path[len('/api/sea/'):]
            now = int(time.time() * 1000)
            rows = {r['id']: r for r in sl.read()}

            def put(e):
                cur = rows.get(e['id'])
                e['at'] = max(now, (cur['at'] + 1) if cur else 0)
                sl.merge([e])

            def answer():
                fresh = pk.session_info(self.bearer()) or info
                return self.send_json(200, me_of(pk, sl, fresh))

            def conflict(err, msg):
                return self.send_json(409, {'error': err, 'message': msg})

            if op == 'create':
                name = clean_name(body.get('name'))[:16]
                color = str(body.get('color') or 'magma')
                if not name:
                    return conflict('name', '海の名前を入れる')
                if color not in SEA_COLORS:
                    return conflict('color', '色は ' + '・'.join(SEA_COLORS))
                sid = str(body.get('id') or '')
                if sid:
                    if not valid_space(sid) or sid in ('me', 'share'):
                        return conflict('id', '海の ID が違う')
                    if (sid in rows and rows[sid].get('alive', 1)) or pk.members_of(sid):
                        return conflict('taken', 'この ID の海はもうサーバーにある')
                else:
                    sid = new_sea_id(now)
                    while sid in rows:
                        sid = new_sea_id(now)
                put({'id': sid, 'name': name, 'color': color, 'alive': 1})
                pk.set_member(sid, uid, 'owner')
                log_event('sea-created', self.ip(), f'sea={sid}')
                return answer()
            sea = str(body.get('sea') or '')
            role = info['roles'].get(sea) if sea != 'me' else None
            if not role or (sea not in rows and sea != 'share'):
                return self.send_json(404, {'error': 'sea'})
            others = [m for m in pk.members_of(sea) if m['user'] != uid]
            if op == 'leave':
                if role == 'owner':
                    if others:
                        return conflict('owner', '持ち主は、ほかの仲間に持ち主を渡してから出る')
                    return conflict('last', 'ほかに仲間がいない。出るなら、この海を消す')
                pk.remove_member(sea, uid)
                log_event('sea-left', self.ip(), f'sea={sea}')
                return answer()
            if role != 'owner':
                return self.send_json(403, {'error': 'scope', 'message': 'この海の持ち主だけができる'})
            if op == 'update':
                cur = dict(rows.get(sea) or {'id': sea, 'name': '共有', 'color': 'magma', 'alive': 1})
                if 'name' in body:
                    name = clean_name(body.get('name'))[:16]
                    if not name:
                        return conflict('name', '海の名前を入れる')
                    cur['name'] = name
                if 'color' in body:
                    if body.get('color') not in SEA_COLORS:
                        return conflict('color', '色は ' + '・'.join(SEA_COLORS))
                    cur['color'] = body['color']
                put({'id': sea, 'name': cur['name'], 'color': cur['color'], 'alive': 1})
                return answer()
            if op == 'remove':
                cur = rows.get(sea) or {'id': sea, 'name': '共有', 'color': 'magma'}
                put({'id': sea, 'name': cur['name'], 'color': cur['color'], 'alive': 0})
                for m in pk.members_of(sea):
                    pk.remove_member(sea, m['user'])
                log_event('sea-removed', self.ip(), f'sea={sea}')
                return answer()
            target = str(body.get('user') or '')
            if target == uid or not any(m['user'] == target for m in others):
                return conflict('user', 'この海の、ほかの仲間を選ぶ')
            if op == 'role':
                if body.get('role') not in ('editor', 'viewer'):
                    return conflict('role', '役割は editor（書ける）か viewer（見るだけ）。持ち主は「持ち主を渡す」で')
                pk.set_member(sea, target, body['role'])
                return answer()
            if op == 'kick':
                pk.remove_member(sea, target)
                log_event('sea-kicked', self.ip(), f'sea={sea}')
                return answer()
            if op == 'transfer':
                pk.set_member(sea, target, 'owner')
                pk.set_member(sea, uid, 'editor')
                log_event('sea-transferred', self.ip(), f'sea={sea}')
                return answer()
            return self.send_json(404, {'error': 'not found'})

        def check_assertion(self, cred):
            """パスキーの署名を確かめる（/api/passkey/login と /oauth/approve で同じ）。
            通ればパスキーの行（sign_count を進めたもの）。だめなら 401 を返して None。形が悪ければ投げる"""
            pk = cfg.passkeys
            resp = cred.get('response') or {}
            cd = pc.b64u_decode(resp.get('clientDataJSON', ''))
            ch = json.loads(cd.decode('utf-8')).get('challenge', '')
            if not pk.take_challenge(ch, 'get'):
                self.deny('challenge')
                return None
            row = pk.find_passkey(str(cred.get('id', '')))
            if not row:
                self.deny('unknown-passkey')
                return None
            count = pc.verify_assertion(public_key=row['public_key'], sign_count=row['sign_count'],
                                        client_data_json=cd,
                                        authenticator_data=pc.b64u_decode(resp.get('authenticatorData', '')),
                                        signature=pc.b64u_decode(resp.get('signature', '')),
                                        challenge=ch, origin=cfg.origin, rp_id=cfg.rp_id,
                                        require_uv=cfg.require_uv)
            pk.touch_passkey(row['id'], count)
            return row

        def who_am_i(self, tok):
            """入ったあとに端末へ返す {spaces, person, owner, user, roles}"""
            info = cfg.passkeys.session_info(tok) or {}
            return {'spaces': info.get('spaces', []), 'person': info.get('person'), 'owner': bool(info.get('owner')),
                    'user': {'id': info.get('user'), 'name': info.get('name', ''), 'avatar': info.get('avatar')},
                    'roles': info.get('roles', {})}

        def me(self):
            """GET /api/me（2026-11-18 取り決め §2）→ {user, seas}。共有の海には仲間（id・名前・役割）も付ける"""
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            info, why = self.principal()
            if not info:
                if why == 'expired':
                    return self.send(401, json.dumps({'error': 'unauthorized'}).encode('utf-8'),
                                     extra={'WWW-Authenticate': cfg.oauth.challenge_header('invalid_token', api=True)})
                return self.deny('me')
            return self.send_json(200, me_of(cfg.passkeys, cfg.sea_list, info))

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
            sp = self.space(write)
            if sp == 'forbidden':
                # 入場の失敗ではない（ログインした利用者が、仲間でない海・見るだけの海に書こうとした）。失敗の数に入れない
                log_event('space-forbidden', self.ip())
                self.send_json(403, {'error': 'forbidden'})
                return None
            if sp == 'expired':
                self.send(401, json.dumps({'error': 'unauthorized'}).encode('utf-8'),
                          extra={'WWW-Authenticate': cfg.oauth.challenge_header('invalid_token', api=True)})
                return None
            if sp == 'devices':
                # 入場の失敗ではない（正しい端末が、混んでいるので待たされる）。失敗の数に入れない
                log_event('device-limit', self.ip())
                self.send_json(429, {'error': 'devices', 'max': cfg.devices.max_active})
                return None
            if not sp:
                return self.deny('data')
            return sp

        # --- 押して取るバックアップ（2026-11-19。Snapshots）。その人の個人の置き場だけ（X-Bubbles-Space は見ない） ---
        def snap_space(self, write=False):
            """個人（me）の置き場の Snapshots。入れなければ応答を返して None"""
            saved = self.headers.get('X-Bubbles-Space')
            try:
                if saved is not None:
                    self.headers.replace_header('X-Bubbles-Space', 'me')
                sp = self.authed_space(write=write)
            finally:
                if saved is not None:
                    self.headers.replace_header('X-Bubbles-Space', saved)
            if not sp:
                return None
            return Snapshots(sp[1].dir)

        def snapshots_get(self, path):
            snaps = self.snap_space()
            if snaps is None:
                return
            if path == '/api/snapshots':
                return self.send_json(200, {'snapshots': snaps.list(), 'keep': SNAP_KEEP})
            rec = snaps.get(path[len('/api/snapshots/'):])
            if rec is None:
                return self.send_json(404, {'error': 'not found'})
            return self.send_json(200, rec)

        def snapshots_post(self):
            snaps = self.snap_space(write=True)
            if snaps is None:
                return
            body = self.read_json()
            if body is None:
                return
            try:
                meta = snaps.save(body.get('payload'), body.get('label', ''), body.get('device', ''))
            except (ValueError, AttributeError):
                return self.send_json(400, {'error': 'bad body'})
            log_event('snapshot', self.ip(), meta['id'])
            return self.send_json(200, meta)

        def schema(self):
            """端末が言う記録の形の版（X-Bubbles-Schema）。無い・読めないときは 0"""
            v = (self.headers.get('X-Bubbles-Schema', '') or '').strip()
            return int(v) if v.isdigit() and len(v) < 6 else 0

        # --- claude.ai の接続（OAuth 2.1。oauth_server.py） ---
        def oauth_on(self):
            return cfg.auth == 'passkey' and cfg.oauth is not None

        def oauth_authorize(self):
            """GET /oauth/authorize。相手の名乗りを確かめてから許可の画面を出す（確かめられなければ戻さずに断りの画面）"""
            q = self.path.split('?', 1)[1] if '?' in self.path else ''
            try:
                params = parse_qs(q, keep_blank_values=True, max_num_fields=50)
            except ValueError:
                return self.send(400, cfg.oauth.error_page('問いの形が読めません'), 'text/html; charset=utf-8')
            logs, res = cfg.oauth.authorize(params)
            for kind, detail in logs:
                log_event(kind, self.ip(), detail)
            if res[0] == 'redirect':
                return self.send(302, b'', 'text/plain; charset=utf-8', extra={'Location': res[1]})
            return self.send(res[1], res[2], 'text/html; charset=utf-8')

        def oauth_post(self, path):
            """POST /oauth/approve・/oauth/deny・/oauth/token"""
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            if path == '/oauth/token':
                return self.oauth_token()
            if path not in ('/oauth/approve', '/oauth/deny'):
                return self.send_json(404, {'error': 'not found'})
            origin = self.headers.get('Origin', '')
            if origin and origin != cfg.origin:
                log_event('oauth-origin', self.ip())
                return self.send_json(403, {'error': 'forbidden'})
            body = self.read_json()
            if body is None:
                return
            rid = body.get('request')
            if path == '/oauth/deny':
                url = cfg.oauth.deny(rid)
                if not url:
                    return self.send_json(400, {'error': 'expired'})
                log_event('oauth-denied', self.ip())
                return self.send_json(200, {'redirect': url})
            pend = cfg.oauth.peek(rid)
            if not pend:
                return self.send_json(400, {'error': 'expired'})
            # 前もって登録した相手（gantt・diary）だけは、この端末のログイン（端末の通行証。Authorization: Bearer）で許せる
            # （2026-11-18 ユーザーの指示「直して」。取り決め §7.2「bubble でログイン済みならパスキーの操作なしで戻る」）。
            # 秘書（claude.ai などの名乗りの相手）は今までどおりパスキーの署名だけ。通行証が切れていれば 401（画面はパスキーへ戻る）
            if body.get('session') is True:
                if not pend.get('pre'):
                    log_event('oauth-session-not-pre', self.ip())
                    return self.send_json(403, {'error': 'passkey required'})
                info = cfg.passkeys.session_info(self.bearer())
                if not info:
                    return self.deny('oauth-session')
                row = cfg.passkeys.find_passkey(info.get('cred_id'))
                user = cfg.passkeys.find_user(info.get('user'))
                if not row or not user:
                    return self.deny('oauth-session')
                url = cfg.oauth.approve(rid, row, user)
                if not url:
                    return self.send_json(400, {'error': 'expired'})
                log_event('oauth-approved', self.ip(), 'session')
                return self.send_json(200, {'redirect': url})
            try:
                row = self.check_assertion(body.get('credential') or {})
            except (pc.VerifyError, ValueError, KeyError, TypeError, AttributeError) as e:
                return self.deny('passkey ' + type(e).__name__ + ': ' + str(e)[:60])
            if not row:
                return
            # 2026-11-18 から、どの利用者のパスキーでも許せる（許すのは、その利用者の記録だけ）
            user = cfg.passkeys.user_of_passkey(row)
            if not user:
                log_event('oauth-not-user', self.ip())
                return self.send_json(403, {'error': 'not user'})
            url = cfg.oauth.approve(rid, row, user)
            if not url:
                return self.send_json(400, {'error': 'expired'})
            log_event('oauth-approved', self.ip())
            return self.send_json(200, {'redirect': url})

        def oauth_token(self):
            """POST /oauth/token（application/x-www-form-urlencoded だけ）。答えは保存させない（no-store）"""
            def fail(err):
                cfg.guard.auth_failed(self.ip())
                kind = {'code-reuse': 'oauth-code-reuse', 'refresh-reuse': 'oauth-refresh-reuse'}.get(err.reason, 'oauth-fail')
                log_event(kind, self.ip(), err.reason)
                out = {'error': err.error}
                if err.description:
                    out['error_description'] = err.description
                return self.send(400, json.dumps(out).encode('utf-8'), extra={'Pragma': 'no-cache'})

            ctype = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
            try:
                n = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                n = -1
            if ctype != 'application/x-www-form-urlencoded':
                return fail(oauth_server.OAuthError('invalid_request', 'content-type', 'application/x-www-form-urlencoded only'))
            if n <= 0 or n > 64 * 1024:
                return fail(oauth_server.OAuthError('invalid_request', 'length'))
            try:
                form = parse_qs(self.rfile.read(n).decode('utf-8'), keep_blank_values=True, max_num_fields=30)
            except (ValueError, UnicodeDecodeError):
                return fail(oauth_server.OAuthError('invalid_request', 'body'))
            try:
                out, _ = cfg.oauth.token(form)
            except oauth_server.OAuthError as e:
                return fail(e)
            return self.send(200, json.dumps(out).encode('utf-8'), extra={'Pragma': 'no-cache'})

        def mcp(self):
            """/mcp（守る口）。通行証は claude.ai の接続のもの（ba_…）だけ。パスキーの通行証・機械の鍵は効かない"""
            origin = self.headers.get('Origin', '')
            if origin and origin != cfg.origin:
                log_event('mcp-origin', self.ip())
                return self.send_json(403, {'error': 'forbidden'})
            if cfg.guard.auth_blocked(self.ip()):
                log_event('auth-blocked', self.ip())
                return self.too_many()
            got = self.headers.get('Authorization', '')
            unauthorized = json.dumps({'error': 'unauthorized'}).encode('utf-8')
            if not got:
                # 初めての呼び出し（どこで許可をもらうかを知らせる）。入場の失敗には数えない
                return self.send(401, unauthorized, extra={'WWW-Authenticate': cfg.oauth.challenge_header()})
            g, why = cfg.oauth.check_access(got[7:] if got.startswith('Bearer ') else '')
            if not g:
                if why == 'expired':
                    # 期限切れはいつものこと（相手が更新の札で替える）。締め出しの数には入れない
                    log_event('oauth-expired', self.ip())
                else:
                    cfg.guard.auth_failed(self.ip())
                    log_event('auth-fail', self.ip(), 'mcp')
                return self.send(401, unauthorized,
                                 extra={'WWW-Authenticate': cfg.oauth.challenge_header('invalid_token')})
            if self.command != 'POST':
                return self.send(405, json.dumps({'error': 'method'}).encode('utf-8'), extra={'Allow': 'POST'})
            try:
                n = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                n = -1
            if n < 0 or n > MAX_BODY:
                return self.send_json(413 if n > MAX_BODY else 400, {'error': 'bad length'})
            try:
                msg = json.loads(self.rfile.read(n).decode('utf-8')) if n else None
            except (ValueError, UnicodeDecodeError):
                msg = None
            rid = msg.get('id') if isinstance(msg, dict) else None
            if not isinstance(rid, (str, int)) or isinstance(rid, bool):
                rid = None
            return self.send_json(200, {'jsonrpc': '2.0', 'id': rid,
                                        'error': {'code': -32601, 'message': '道具はまだ無い'}})

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
            path = self.path.split('?', 1)[0]
            if not self.gate(static=not (path.startswith(('/api/', '/oauth/')) or path == '/mcp')):
                return
            if self.oauth_on():
                if path == '/.well-known/oauth-authorization-server':
                    return self.send_json(200, cfg.oauth.as_metadata())
                if path in ('/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'):
                    return self.send_json(200, cfg.oauth.pr_metadata(root=not path.endswith('/mcp')))
                if path == '/oauth/authorize' and self.command == 'GET':
                    return self.oauth_authorize()
                if path == '/mcp':
                    return self.mcp()
            if path == '/api/health':
                return self.send_json(200, {'ok': True})
            if path == '/api/auth':
                return self.send_json(200, {'mode': cfg.auth, 'rp_id': cfg.rp_id if cfg.auth == 'passkey' else ''})
            if path == '/api/me' and cfg.auth == 'passkey':
                return self.me()
            if path == '/api/apps' and cfg.auth == 'passkey':
                # 3 つの app の住所の根（2026-11-18 取り決め §7.2 の app_urls）。だれが読んでもよい（住所だけ）
                return self.send_json(200, dict({'bubble': cfg.origin}, **cfg.app_urls))
            if path == '/api/avatars' and cfg.auth == 'passkey':
                # 利用者のアイコンのプリセット（2026-11-18）。だれが読んでもよい（絵文字と色だけ）
                return self.send_json(200, {'presets': [{'id': a, 'emoji': e, 'color': c} for a, e, c in AVATARS]})
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
                    info, _ = self.principal()
                    info = info or {}
                    out['owner'] = bool(info.get('owner'))
                    out['user'] = info.get('user')
                    out['role'] = (info.get('roles') or {}).get(sp[0])
                    if sp[0] == 'me':
                        out['person'] = info.get('person')
                return self.send_json(200, out)
            if path == '/api/snapshots' or path.startswith('/api/snapshots/'):
                return self.snapshots_get(path)
            if path.startswith('/api/'):
                return self.send_json(404, {'error': 'not found'})
            return self.static(path)

        do_HEAD = do_GET

        def do_DELETE(self):
            if not self.gate():
                return
            if self.path.split('?', 1)[0] == '/mcp' and self.oauth_on():
                return self.mcp()
            return self.send_json(404, {'error': 'not found'})

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
            if path.startswith('/oauth/') or path == '/mcp':
                if not self.oauth_on():
                    return self.send_json(404, {'error': 'not found'})
                return self.mcp() if path == '/mcp' else self.oauth_post(path)
            if path == '/api/spaces':
                return self.seas()
            if path == '/api/snapshots':
                return self.snapshots_post()
            if cfg.auth == 'passkey' and path.startswith('/api/sea/'):
                return self.sea_admin(path)
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
                    # 招待コード（invite）か、端末を足す番号（device。2026-11-18。10 分・1 回・数字 6 桁）
                    if body.get('device'):
                        if device_guard.blocked():
                            log_event('device-code-blocked', self.ip())
                            return self.too_many()
                        inv = pk.find_device_code(body.get('device'))
                        if not inv:
                            device_guard.failed()
                            return self.deny('device-code')
                    else:
                        inv = pk.find_invite(body.get('invite', ''))
                        if not inv:
                            return self.deny('invite')
                    full = pk.full_for(inv)
                    if full:
                        return self.send_json(409, {'error': 'full', 'spaces': full, 'max': pk.max_per_space})
                    # パスキーの user.id は利用者の番号（2026-11-18）。新しい利用者は、ここで番号を決めて登録で使う
                    kind, uid = pk.invite_target(inv)
                    if kind == 'user':
                        u = pk.find_user(uid) or {}
                        uname = u.get('name', '')
                    else:
                        uid = 'u_' + secrets.token_hex(4)
                        uname = clean_name(body.get('userName')) or inv.get('name', '')
                    dname = clean_name(body.get('deviceName')) or inv.get('name', '') or uname
                    chal = pk.new_challenge('create', inv['code_hash'],
                                           {'user_id': uid, 'user_name': uname, 'device_name': dname})
                    return self.send_json(200, {'publicKey': {
                        'challenge': chal,
                        'rp': {'id': cfg.rp_id, 'name': 'Bubbles'},
                        'user': {'id': pc.b64u_encode(uid.encode('ascii')), 'name': uname or dname,
                                 'displayName': uname or dname},
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
                    if inv.get('kind') == 'device':
                        device_guard.reset()
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
                    name, _u = pk.register(inv=inv, cred=out, name=got.get('device_name', ''),
                                           user_id=got.get('user_id'), user_name=got.get('user_name', ''))
                    tok, exp = pk.new_session(out['cred_id'])
                    log_event('passkey-registered', self.ip(), f'name={name}')
                    return self.send_json(200, dict(self.who_am_i(tok), session=tok, expires=exp, name=name))
                if path == '/api/passkey/login/options':
                    return self.send_json(200, {'publicKey': {
                        'challenge': pk.new_challenge('get'), 'rpId': cfg.rp_id,
                        'userVerification': 'required', 'timeout': 120000, 'allowCredentials': [],
                    }})
                if path == '/api/passkey/login':
                    row = self.check_assertion(body.get('credential') or {})
                    if not row:
                        return
                    tok, exp = pk.new_session(row['id'])
                    return self.send_json(200, dict(self.who_am_i(tok), session=tok, expires=exp, name=row['name']))
                if path == '/api/passkey/invite':
                    # 端末から人を招く（2026-11-16）。入っている端末だけ。招ける範囲は passkey_store.py の invite_from
                    info = self.session()
                    if not info:
                        return self.deny('invite-make')
                    try:
                        code, spaces, person = pk.invite_from(info, body.get('name', ''), str(body.get('sea', '')),
                                                              bool(body.get('newPerson')), str(body.get('role') or 'editor'))
                    except PermissionError as e:
                        return self.send_json(403, {'error': 'scope', 'message': str(e)})
                    except ValueError as e:
                        # 入場の失敗ではない（いっぱい・名前が無い）。失敗の数に入れない
                        return self.send_json(409, {'error': 'invite', 'message': str(e)})
                    log_event('invite-made', self.ip())
                    # 招待のリンク（2026-11-18）。開くと画面が招待コードを読み、登録か「この海に入る」を出す
                    link = cfg.origin + '/#invite=' + code
                    return self.send_json(200, {'code': code, 'spaces': spaces, 'person': person, 'link': link})
                if path == '/api/passkey/invite/peek':
                    # 招待の中身を見る（2026-11-18。登録の前に、だれからの・どの海への招待かを出すため）。コードは返さない
                    inv = pk.find_invite(body.get('invite', ''))
                    if not inv:
                        return self.deny('invite-peek')
                    out = pk.invite_info(inv)
                    names = {r['id']: r['name'] for r in (cfg.sea_list.read() if cfg.sea_list else [])}
                    for s in out['seas']:
                        s['name'] = names.get(s['id'], '共有' if s['id'] == 'share' else s['id'])
                    return self.send_json(200, out)
                if path == '/api/passkey/invite/accept':
                    # ログインしている利用者が、海への招待を受け取る（2026-11-18）
                    info = self.session()
                    if not info:
                        return self.deny('invite-accept')
                    try:
                        seas = pk.accept_invite(body.get('invite', ''), info['user'])
                    except ValueError as e:
                        return self.send_json(409, {'error': 'invite', 'message': str(e)})
                    if not seas:
                        return self.deny('invite-accept')
                    log_event('invite-accepted', self.ip())
                    return self.send_json(200, dict(self.who_am_i(self.bearer()), joined=[s for s, _ in seas]))
                if path in ('/api/passkey/devices', '/api/passkey/devices/remove'):
                    # わたしの端末（2026-11-18。モック 3）。自分のパスキーの一覧と、外す。今の端末は confirm が要る
                    info = self.session()
                    if not info:
                        return self.deny('devices')
                    mine = [r for r in pk.passkeys() if r.get('user') == info['user']]
                    if path.endswith('/remove'):
                        name = str(body.get('name') or '')
                        row = next((r for r in mine if r['name'] == name), None)
                        if not row:
                            return self.send_json(404, {'error': 'device'})
                        if row['id'] == info['cred_id'] and body.get('confirm') is not True:
                            return self.send_json(409, {'error': 'current', 'message': 'いま使っている端末。外すとこの端末はログアウトする'})
                        pk.remove_passkey(name)
                        cfg.devices.leave(row['id'])
                        log_event('device-removed', self.ip())
                        mine = [r for r in pk.passkeys() if r.get('user') == info['user']]
                    return self.send_json(200, {'devices': [
                        {'name': r['name'], 'created': r.get('created'), 'last_used': r.get('last_used'),
                         'current': r['id'] == info['cred_id']} for r in mine]})
                if path == '/api/passkey/avatar':
                    # 自分のアイコンをプリセットから選ぶ（2026-11-18）→ /api/me と同じ形
                    info = self.session()
                    if not info:
                        return self.deny('avatar')
                    try:
                        pk.set_avatar(info['user'], str(body.get('preset') or ''))
                    except ValueError as e:
                        return self.send_json(409, {'error': 'avatar', 'message': str(e)})
                    return self.send_json(200, me_of(pk, cfg.sea_list, pk.session_info(self.bearer()) or info))
                if path == '/api/passkey/device':
                    # 端末を足す番号（2026-11-18。10 分・1 回）。ログインしている端末が出し、新しい端末が入れる
                    info = self.session()
                    if not info:
                        return self.deny('device-make')
                    try:
                        code, exp = pk.add_device_code(info['user'])
                    except ValueError as e:
                        return self.send_json(409, {'error': 'device', 'message': str(e)})
                    log_event('device-code', self.ip())
                    return self.send_json(200, {'code': code, 'expires': exp})
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


def where_of(row, pk=None):
    """招待・パスキーの行の入れる先の表示（2026-11-18 から利用者の名前と海）"""
    if pk is not None:
        u = pk.find_user(row.get('user')) if row.get('user') else None
        seas = [s for s, _ in pk.invite_seas(row)] if 'code_hash' in row else [
            s for s in (pk.roles_of(u['id']) if u else {}) if s != 'me']
        who = f"{u['name']}（{u['id']}・個人 {u['person']}）" if u else ('新しい利用者' if 'code_hash' in row else '利用者なし')
        return '・'.join([who] + [space_label(s) for s in seas])
    return ','.join(person_label(person_of(row)) if s == 'me' else space_label(s) for s in row.get('spaces', []))


def passkey_command(data_dir: Path, cmd: str, name: str, space: str, max_passkeys: int = 3, value: str = '', extra: str = '') -> int:
    """パスキーの操作（公開の形）。動いているサーバーは止めなくてよい"""
    pk = PasskeyStore(data_dir, max_per_space=max_passkeys)
    pk.migrate()       # 前の人の番号を利用者へ（2026-11-18。済んでいれば何もしない）

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
        print(f'利用者ごとに登録できるパスキー: {pk.max_per_space} 台（変えるなら limit-set <数>）', flush=True)
    elif cmd == 'limit-set':
        try:
            n = pk.set_limit(name)
        except ValueError as e:
            raise SystemExit(str(e)) from None
        print(f'利用者ごとに登録できるパスキーを {n} 台にしました。動いているサーバーにも次の要求から効きます', flush=True)
        for lab, c in pk.over_limit():
            print(f'（{lab}は {c} 台。外さずに残しますが、{n} 台より少なくなるまで新しい登録を断ります）', flush=True)
    elif cmd == 'invite-list':
        rows = pk.list_invites()
        if not rows:
            print('使われていない招待コードはありません')
        for r in rows:
            if r.get('kind') == 'move':   # 引っ越しの鍵（Issue #19）
                print(f"{r['name']}\t{where_of(r, pk)}\t引っ越しの鍵（作った {time.strftime('%Y-%m-%d', time.localtime(r['created']))}）")
            else:
                by = f"\t招いた人 {r['by']}" if r.get('by') else ''
                print(f"{r['name']}\t{where_of(r, pk)}\t期限 {time.strftime('%m-%d %H:%M', time.localtime(r['expires']))}{by}")
    elif cmd == 'passkey-list':
        rows = pk.passkeys()
        if not rows:
            print('登録したパスキーはありません（invite-add <名前> で招待コードを作る）')
        for r in rows:
            last = time.strftime('%Y-%m-%d', time.localtime(r['last_used'])) if r.get('last_used') else '未使用'
            by = f"\t招いた人 {r['by']}" if r.get('by') else ''
            print(f"{r['name']}\t{where_of(r, pk)}\t登録 {time.strftime('%Y-%m-%d', time.localtime(r['created']))}\t最後 {last}{by}")
        counts = [f"{u['name']} {pk.count_user(u['id'])}/{pk.max_per_space}" for u in pk.users()]
        print('（利用者ごとのパスキー: ' + '・'.join(counts) + '）')
    elif cmd == 'user-list':
        users = pk.users()
        if not users:
            print('利用者はいません（invite-add <名前> me で招く）')
        for u in users:
            roles = pk.roles_of(u['id'])
            seas = '・'.join(f"{space_label(s)}（{ROLE_LABEL[r]}）" for s, r in roles.items() if s != 'me') or 'なし'
            keys = '・'.join(r['name'] for r in pk.passkeys() if r.get('user') == u['id']) or 'なし'
            print(f"{u['id']}\t{u['name']}\t個人 {u['person']}\tパスキー: {keys}\t共有の海: {seas}")
    elif cmd in ('admin-list', 'admin-add', 'admin-remove'):
        # スーパーユーザー（app から新しい利用者を招ける人）。2026-11-18
        if cmd != 'admin-list':
            try:
                u = pk.set_admin(name.strip(), cmd == 'admin-add')
            except ValueError as e:
                raise SystemExit(str(e)) from None
            print(f"{u['name']}（{u['id']}）を" + ('スーパーユーザーにしました' if cmd == 'admin-add' else 'スーパーユーザーから外しました'), flush=True)
        for u in pk.admins():
            print(f"{u['id']}\t{u['name']}\t個人 {u['person']}" + ('' if u.get('admin') is True else '\t（だれにも付いていないので 1 番の人）'))
    elif cmd == 'user-rename':
        try:
            got = pk.rename_user(name.strip(), value)
        except ValueError as e:
            raise SystemExit(str(e)) from None
        print(f'{name.strip()} の名前を「{got}」にしました', flush=True)
    elif cmd in ('member-set', 'member-remove'):
        # member-set <海の ID> <利用者の番号> <owner|editor|viewer> ／ member-remove <海の ID> <利用者の番号>
        sea, uid = name.strip(), value.strip()
        if not sea or not uid:
            raise SystemExit(f'使い方: {cmd} <海の ID> <利用者の番号>' + (' <owner|editor|viewer>' if cmd == 'member-set' else ''))
        if cmd == 'member-set':
            role = (extra or 'editor').strip()
            if role not in ('owner', 'editor', 'viewer'):
                raise SystemExit('役割は owner（持ち主）・editor（書ける）・viewer（見るだけ）')
            try:
                pk.set_member(sea, uid, role)
            except ValueError as e:
                raise SystemExit(str(e)) from None
            print(f'{space_label(sea)}の仲間: {uid}（{ROLE_LABEL[role]}）', flush=True)
        else:
            if not pk.remove_member(sea, uid):
                raise SystemExit(f'{uid} は {space_label(sea)}の仲間ではありません（user-list で確かめる）')
            print(f'{uid} を {space_label(sea)}の仲間から外しました（次の要求から入れない）', flush=True)
    elif cmd == 'users-migrate':
        print('前の人の番号を利用者へ移しました（済んでいれば何もしない）', flush=True)
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


def write_key_file(path: Path, key: str):
    """鍵をファイルに書く（2026-11-17）。親のフォルダが無ければ 700 で作り、ファイルは 600。
    すでにあれば（リンクでも）上書きせずに FileExistsError。リンクの先へは書かない"""
    # 無いフォルダを上から順に 700 で作る（mkdir(parents=True) は途中のフォルダを umask の形で作るため）
    missing = []
    d = path.parent
    while not d.exists():
        missing.append(d)
        d = d.parent
    for d in reversed(missing):
        d.mkdir(mode=0o700)
        os.chmod(d, 0o700)
    old = os.umask(0o077)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    finally:
        os.umask(old)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(key + '\n')
        f.flush()
        os.fsync(f.fileno())


def machine_command(data_dir: Path, cmd: str, name: str, space: str, read_only: bool, key_file: str = '') -> int:
    """機械の鍵の操作（公開の形。共有の記録 v1.2 §8）。動いているサーバーは止めなくてよい。
    key_file（--key-file）を付けると、鍵を画面に出さずにそのファイルへ書く（2026-11-17。画面とクリップボードを通さない）"""
    keys = MachineKeys(data_dir)
    if cmd == 'machine-add':
        kpath = Path(key_file).expanduser() if key_file else None
        if kpath is not None and (kpath.exists() or kpath.is_symlink()):
            raise SystemExit(f'{kpath} はもうあります（上書きしない。前の鍵なら machine-remove のあと、ファイルを消すか別の名前で）')
        m = re.fullmatch(r'me(?::([1-9][0-9]{0,5}))?', (space or '').strip())
        if not m:
            raise SystemExit('置き場は me（個人 1）か me:<番号>（その人の個人）。例: machine-add gantt --space me')
        person = int(m.group(1) or OWNER)
        if person != OWNER and person not in PasskeyStore(data_dir).persons():
            raise SystemExit(f'{person_label(person)}はいません（passkey-list で番号を確かめる）')
        key = keys.add(name, person, read_only)
        how = '読むだけ' if read_only else '読み書き'
        if kpath is not None:
            try:
                write_key_file(kpath, key)
            except OSError as e:
                keys.remove(name)       # 書けなかった鍵は残さない（誰も持たない鍵になる）
                raise SystemExit(f'{kpath} に書けませんでした（{e.strerror or type(e).__name__}）。作った鍵は消しました')
            print(f'「{name.strip()}」の機械の鍵（{person_label(person)}・{how}）を {kpath} に書きました（600。鍵は画面に出しません）。'
                  f'確かめの印: {MachineKeys.digest(key)[:8]}（machine-list の「印」と同じ）', flush=True)
            return 0
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
                  f"\t作った {r.get('created', '')}\t印 {r['hash'][:8]}")
    elif cmd == 'machine-remove':
        if not keys.remove(name):
            raise SystemExit(f'「{name}」は見つかりません（machine-list で名前を確かめる）')
        print(f'「{name}」の機械の鍵を消しました。その鍵は次の要求から入れません', flush=True)
    return 0


def oauth_command(data_dir: Path, cmd: str, name: str) -> int:
    """claude.ai の接続の許可の操作（2026-11-17）。動いているサーバーは止めなくてよい（次の要求から効く）。
    値（通行証・更新の札）は出さない（ファイルにも無い）"""
    st = oauth_server.OAuthStore(data_dir)
    day = lambda t: time.strftime('%Y-%m-%d %H:%M', time.localtime(t)) if t else '未使用'   # noqa: E731
    if cmd == 'oauth-list':
        rows = st.grants()
        if not rows:
            print('許した接続はありません（claude.ai のコネクタから接続し、許可の画面で許すとできる）')
        users = {u['id']: u['name'] for u in PasskeyStore(data_dir).users()}
        for g in rows:
            refresh = day(g['refresh_expires']) if g.get('refresh_expires') else 'なし（まだ code を替えていない）'
            who = users.get(g.get('user'), '1 番の人' if not g.get('user') else g.get('user'))
            what = '記録の API' if g.get('resource', '').rstrip('/') == g.get('resource', '').split('/mcp')[0].rstrip('/') and not g.get('resource', '').endswith('/mcp') else '/mcp'
            print(f"{g['id']}\t{who}\t{g.get('client_name', '')}（{g.get('scope', '')}・{what}）\t{oauth_server.host_of(g.get('client_id', '')) or g.get('client_id', '')}"
                  f"\t許した {day(g.get('created'))}\t最後 {day(g.get('last_used'))}\t更新の札の期限 {refresh}")
        if rows:
            print('取り消す: oauth-revoke <id>（全部なら oauth-revoke all）', flush=True)
    elif cmd == 'oauth-revoke':
        which = name.strip()
        if not which:
            raise SystemExit('取り消す許可の id か all を入れてください（例: oauth-revoke g_1a2b3c4d。oauth-list で見られる）')
        n = st.revoke(which)
        if not n:
            raise SystemExit(f'「{which}」の許可はありません（oauth-list で id を確かめる）')
        print(f'{n} 件の許可を取り消しました。その通行証と更新の札は次の要求から効きません', flush=True)
    return 0


SEA_COLORS = ('magma', 'moss', 'dusk', 'sand', 'ink')   # js/spacelist.js の COLORS


def parse_app_urls(items):
    """['gantt=https://…', 'diary=…'] → {'gantt': 'https://…'}（2026-11-18 取り決め §7.2）。名前は gantt・diary・bubble だけ、
    住所は http(s) の根だけ（道・問い・# は落とす）。合わないものは止める"""
    from urllib.parse import urlsplit
    out = {}
    for it in items or []:
        it = (it or '').strip()
        if not it:
            continue
        name, _, url = it.partition('=')
        name = name.strip()
        u = urlsplit(url.strip())
        if name not in ('bubble', 'gantt', 'diary') or u.scheme not in ('http', 'https') or not u.netloc:
            raise SystemExit(f'--app-url は gantt=https://… の形（名前は bubble・gantt・diary）: {it}')
        out[name] = f'{u.scheme}://{u.netloc}'
    return out


def new_sea_id(now_ms=None) -> str:
    """新しい海の ID（js/spacelist.js の newId と同じ形: s ＋ 時刻の 36 進 ＋ 4 字）"""
    import string
    n = int(now_ms if now_ms is not None else time.time() * 1000)
    d = string.digits + string.ascii_lowercase
    out = ''
    while n:
        n, r = divmod(n, 36)
        out = d[r] + out
    return 's' + (out or '0') + ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(4))


def sea_command(data_dir: Path, args) -> int:
    """海の管理（2026-11-16 利用者の指示「海の管理はVMから直接行う。appからそのようなことはできない」）。
    動いているサーバーは止めなくてよい（端末は次に一覧を取りに来たときに知る）。
      sea-list                                   海の一覧（ID・名前・色・入れる端末）
      sea-add <名前> [--sea-id <ID>] [--color c] 海を作る。--sea-id に端末の海の ID を入れると、その海をサーバーの海にする
      sea-rename <ID> <新しい名前>
      sea-remove <ID>                            一覧から外す（記録の置き場は消さない）
      passkey-space <端末の名前> add|remove <ID>  その端末を海に入れる・外す（個人は passkey-person）"""
    sl = SeaList(data_dir)
    pk = PasskeyStore(data_dir)
    now = int(time.time() * 1000)
    rows = {r['id']: r for r in sl.read()}

    def put(e):
        cur = rows.get(e['id'])
        e['at'] = max(now, (cur['at'] + 1) if cur else 0)
        sl.merge([e])

    cmd = args.command
    if cmd == 'sea-list':
        alive = [r for r in rows.values() if r.get('alive', 1)]
        if not alive:
            print('サーバーの海はありません（sea-add <名前> で作る）')
        pk.migrate()
        users = {u['id']: u['name'] for u in pk.users()}
        for r in alive:
            who = [f"{users.get(m['user'], m['user'])}（{ROLE_LABEL[m['role']]}）" for m in pk.members_of(r['id'])]
            print(f"{r['id']}\t{r['name']}\t{r['color']}\t仲間: {'・'.join(who) if who else 'なし'}")
        return 0
    if cmd == 'sea-add':
        name = args.name.strip()[:16]
        if not name:
            raise SystemExit('名前を入れてください（例: sea-add 家族）')
        if args.color not in SEA_COLORS:
            raise SystemExit('色は ' + '・'.join(SEA_COLORS))
        sid = args.sea_id.strip()
        if sid:
            if not valid_space(sid) or sid == 'me':
                raise SystemExit('ID は share か、s と英小文字・数字（端末の海の ⚙ に出るもの）')
        else:
            import string
            def b36(n):
                d = string.digits + string.ascii_lowercase
                out = ''
                while n:
                    n, r = divmod(n, 36)
                    out = d[r] + out
                return out or '0'
            sid = 's' + b36(now) + ''.join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(4))
        if sid in rows and rows[sid].get('alive', 1):
            raise SystemExit(f'「{sid}」はもうあります（名前を変えるなら sea-rename）')
        put({'id': sid, 'name': name, 'color': args.color, 'alive': 1})
        print(f'海「{name}」を作りました: {sid}', flush=True)
        print(f'入れる端末を決める: passkey-space <端末の名前> add {sid}（人を招くなら invite-add <名前> {sid}）', flush=True)
        return 0
    sid = args.name.strip()
    if sid not in rows:
        if cmd != 'passkey-space':
            raise SystemExit(f'「{sid}」の海はありません（sea-list で ID を確かめる）')
    if cmd == 'sea-rename':
        name = args.value.strip()[:16]
        if not name:
            raise SystemExit('新しい名前を入れてください（例: sea-rename sxxxx 家族）')
        put(dict(rows[sid], name=name))
        print(f'{sid} の名前を「{name}」にしました', flush=True)
    elif cmd == 'sea-remove':
        put(dict(rows[sid], alive=0))
        print(f'{sid}（{rows[sid]["name"]}）を一覧から外しました。記録の置き場は残しています', flush=True)
    elif cmd == 'passkey-space':
        op, sea = args.value.strip(), args.extra.strip()
        if op not in ('add', 'remove') or not sea:
            raise SystemExit('使い方: passkey-space <端末の名前> add|remove <海の ID>')
        if op == 'add' and sea != 'share' and not (sea in rows and rows[sea].get('alive', 1)):
            raise SystemExit(f'「{sea}」の海はありません（sea-add で先に作る）')
        try:
            got = pk.set_space(args.name, sea, op == 'add')
        except ValueError as e:
            raise SystemExit(str(e)) from None
        print(f'「{args.name}」の利用者の入れる置き場: {"・".join(space_label(s) for s in got)}', flush=True)
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
                             'machine-add', 'machine-list', 'machine-remove',
                             'sea-list', 'sea-add', 'sea-rename', 'sea-remove', 'passkey-space',
                             'oauth-list', 'oauth-revoke',
                             'user-list', 'user-rename', 'member-set', 'member-remove', 'users-migrate',
                             'admin-list', 'admin-add', 'admin-remove'],
                    help='serve（既定）か、合言葉・パスキーの操作')
    ap.add_argument('name', nargs='?', default='',
                    help='share-add / share-remove / invite-add / passkey-remove の名前、request-ok / request-no の字、limit-set の数')
    ap.add_argument('value', nargs='?', default='', help='passkey-person の移す先（番号か new）、sea-rename の新しい名前、passkey-space の add / remove')
    ap.add_argument('extra', nargs='?', default='', help='passkey-space の海の ID')
    ap.add_argument('--sea-id', default='', help='sea-add で使う海の ID（端末の海の ⚙ に出る ID。省けば新しく作る）')
    ap.add_argument('--color', default='magma', help='sea-add の水の色（magma・moss・dusk・sand・ink）')
    ap.add_argument('--key-file', default='',
                    help='machine-add で、鍵を画面に出さずにこのファイルへ書く（600。親のフォルダが無ければ 700 で作る。あれば上書きしない）')
    ap.add_argument('--app-url', action='append', default=None,
                    help='3 つの app の住所の根（何度でも。例 --app-url gantt=https://gantt.example.org。'
                         '既定は環境変数 BUBBLE_TODO_APP_URLS（gantt=…,diary=…）。無ければ画面が住所から決める）')
    ap.add_argument('--oauth-client-host', action='append', default=None,
                    help='claude.ai の接続で受ける相手の住所の名前（何度でも。既定は環境変数 '
                         'BUBBLE_TODO_OAUTH_CLIENT_HOSTS（コンマで）か claude.ai）')
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)   # 新しく作るときは持ち主だけ（Issue #48）
    if args.command in ('sea-list', 'sea-add', 'sea-rename', 'sea-remove', 'passkey-space'):
        return sea_command(data_dir, args)
    if args.command in ('oauth-list', 'oauth-revoke'):
        return oauth_command(data_dir, args.command, args.name)
    if args.command in ('machine-add', 'machine-list', 'machine-remove'):
        if args.command != 'machine-list' and not args.name.strip():
            raise SystemExit(f'名前を入れてください（例: {args.command} gantt）')
        if args.command == 'machine-add' and args.space == 'share':
            raise SystemExit('置き場を --space me か --space me:<番号> で入れてください（例: machine-add gantt --space me）')
        if args.key_file and args.command != 'machine-add':
            raise SystemExit('--key-file は machine-add だけで使う')
        return machine_command(data_dir, args.command, args.name, args.space, args.read_only, args.key_file)
    if args.command in ('invite-add', 'invite-list', 'passkey-list', 'passkey-remove', 'passkey-person', 'move-remove',
                        'request-list', 'request-ok', 'request-no', 'limit', 'limit-set',
                        'user-list', 'user-rename', 'member-set', 'member-remove', 'users-migrate',
                        'admin-list', 'admin-add', 'admin-remove'):
        if args.command in ('request-ok', 'request-no') and not args.name.strip():
            raise SystemExit(f'端末の画面に出ている字を入れてください（例: {args.command} ABC-DEF。request-list で見られる）')
        if args.command == 'limit-set' and not args.name.strip():
            raise SystemExit('上限の数を入れてください（例: limit-set 5）')
        if args.command in ('invite-add', 'passkey-remove', 'passkey-person', 'move-remove') and not args.name.strip():
            raise SystemExit(f'名前を入れてください（例: {args.command} 母のスマホ）')
        return passkey_command(data_dir, args.command, args.name, args.space, args.max_passkeys, args.value, args.extra)
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
        passkeys = PasskeyStore(data_dir, max_per_space=args.max_passkeys)
        moved = passkeys.migrate()     # 前の人の番号を利用者へ（2026-11-18。済んでいれば何もしない）
        if any(moved.values()):
            print(f"利用者へ移した: 利用者 {moved['users']}・パスキー {moved['passkeys']}・海の仲間 {moved['members']}", flush=True)
        oauth = oauth_server.OAuth(data_dir, origin, passkeys, oauth_server.client_hosts_from(args.oauth_client_host))
        # 要求の数の上限（接続元ごと 1 分。既定 120、画面のファイルは 600）。試しで 2 つの端末を同じ 127.0.0.1 から動かし、
        # ログインのたびに読み直すときだけ上げる（2026-11-18）
        guard = Guard(max_requests=int(os.environ.get('BUBBLE_TODO_MAX_REQUESTS', '120')),
                      max_static=int(os.environ.get('BUBBLE_TODO_MAX_STATIC', '600')))
        cfg = Config(auth='passkey', origin=origin, rp_id=rp_id, trust_proxy=args.trust_proxy, guard=guard,
                     allow_origins=args.allow_origin or (), passkeys=passkeys,
                     stores=SeaStores(data_dir), devices=Devices(max_active=args.max_devices, window=args.device_window),
                     sea_list=SeaList(data_dir), min_schema=args.min_schema, machines=MachineKeys(data_dir), oauth=oauth,
                     app_urls=parse_app_urls(args.app_url or os.environ.get('BUBBLE_TODO_APP_URLS', '').split(',')))
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
          + (f'  origin: {cfg.origin}  rp_id: {cfg.rp_id}  oauth-client-host: {",".join(sorted(cfg.oauth.client_hosts))}'
             if cfg.auth == 'passkey' else ''), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
