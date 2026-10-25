"""パスキー（WebAuthn）の確かめ（2026-10-24。公開して使うときの入場。server.py が使う）。

することは「確かめる」だけ。秘密の鍵は扱わない（秘密の鍵は利用者の端末の中にあり、外に出ない）。
    verify_registration  … 登録のとき、端末が作った公開鍵を取り出し、名前・問題・出どころを確かめる
    verify_assertion     … 入るとき、端末の署名を、登録した公開鍵で確かめる

署名の確かめは、Python の `cryptography` があればそれを使い、無ければ標準ライブラリだけで計算する
（ECDSA P-256 と RSA PKCS#1 v1.5。どちらも公開の値だけを使う計算）。
対応する鍵は ES256（-7）と RS256（-257）。登録の求めで、この2つだけを出す。
端末の種類の証明（attestation）は求めない（"none"）。どの端末でも入れてよく、守りたいのは
「登録した鍵を持つ端末だけが入れる」ことなので。
"""
import hashlib
import hmac
import json
from base64 import urlsafe_b64decode, urlsafe_b64encode

try:  # あれば使う（速く、広く確かめられている）。無くても動く
    from cryptography.hazmat.primitives import hashes as _hashes
    from cryptography.hazmat.primitives.asymmetric import ec as _ec, padding as _padding, rsa as _rsa
    from cryptography.exceptions import InvalidSignature as _InvalidSignature
    HAVE_CRYPTOGRAPHY = True
except ImportError:  # pragma: no cover - 入っているかどうかは環境しだい
    HAVE_CRYPTOGRAPHY = False

ALG_ES256 = -7
ALG_RS256 = -257
SUPPORTED_ALGS = (ALG_ES256, ALG_RS256)

FLAG_UP = 0x01   # 人が触れた（user present）
FLAG_UV = 0x04   # 本人だと確かめた（Face ID・指紋・PIN。user verified）
FLAG_AT = 0x40   # 公開鍵が入っている（登録のとき）


class VerifyError(Exception):
    """確かめに通らなかった。理由は利用者には出さない（記録にだけ残す）"""


def b64u_encode(b: bytes) -> str:
    return urlsafe_b64encode(b).rstrip(b'=').decode('ascii')


def b64u_decode(s: str) -> bytes:
    if not isinstance(s, str):
        raise VerifyError('base64url ではない')
    try:
        return urlsafe_b64decode(s + '=' * (-len(s) % 4))
    except Exception as e:  # noqa: BLE001 - 形の崩れはすべて同じ扱い
        raise VerifyError('base64url が読めない') from e


# ---------------------------------------------------------------- CBOR（読むだけ）

def cbor_decode(data: bytes, pos: int = 0, depth: int = 0):
    """(値, 次の位置)。WebAuthn に出てくる形（整数・バイト列・文字列・配列・写像・真偽）だけを読む。
    長さを決めない形・浮動小数は断る"""
    if depth > 16:
        raise VerifyError('CBOR が深すぎる')
    if pos >= len(data):
        raise VerifyError('CBOR が途中で切れている')
    ib = data[pos]
    major, info = ib >> 5, ib & 0x1f
    pos += 1
    if info < 24:
        val = info
    elif info in (24, 25, 26, 27):
        size = 1 << (info - 24)
        if pos + size > len(data):
            raise VerifyError('CBOR が途中で切れている')
        val = int.from_bytes(data[pos:pos + size], 'big')
        pos += size
    else:
        raise VerifyError('CBOR の長さの形が読めない')
    if major == 0:
        return val, pos
    if major == 1:
        return -1 - val, pos
    if major in (2, 3):
        if pos + val > len(data):
            raise VerifyError('CBOR が途中で切れている')
        raw = data[pos:pos + val]
        pos += val
        if major == 2:
            return bytes(raw), pos
        try:
            return raw.decode('utf-8'), pos
        except UnicodeDecodeError as e:
            raise VerifyError('CBOR の文字列が読めない') from e
    if major == 4:
        out = []
        for _ in range(val):
            item, pos = cbor_decode(data, pos, depth + 1)
            out.append(item)
        return out, pos
    if major == 5:
        out = {}
        for _ in range(val):
            k, pos = cbor_decode(data, pos, depth + 1)
            v, pos = cbor_decode(data, pos, depth + 1)
            if isinstance(k, (list, dict)):
                raise VerifyError('CBOR の写像の鍵が読めない')
            out[k] = v
        return out, pos
    if major == 6:  # 札（tag）は中身だけを読む
        return cbor_decode(data, pos, depth + 1)
    if major == 7:
        if val == 20:
            return False, pos
        if val == 21:
            return True, pos
        if val in (22, 23):
            return None, pos
    raise VerifyError('CBOR の形が読めない')


# ---------------------------------------------------------------- 鍵（COSE）

# P-256 の決まった値（SEC 2 / FIPS 186-4）
P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
A = P - 3
B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
     0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)


def _on_curve(pt) -> bool:
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def parse_cose_key(cose: bytes):
    """COSE の公開鍵 → (alg, 鍵の中身)。ES256 なら (x, y)、RS256 なら (n, e)"""
    key, end = cbor_decode(cose)
    if not isinstance(key, dict) or end != len(cose):
        raise VerifyError('COSE の鍵が読めない')
    kty, alg = key.get(1), key.get(3)
    if alg == ALG_ES256:
        if kty != 2 or key.get(-1) != 1:
            raise VerifyError('ES256 の鍵ではない')
        x, y = key.get(-2), key.get(-3)
        if not (isinstance(x, bytes) and isinstance(y, bytes) and len(x) == 32 and len(y) == 32):
            raise VerifyError('ES256 の座標が読めない')
        pt = (int.from_bytes(x, 'big'), int.from_bytes(y, 'big'))
        if not _on_curve(pt):
            raise VerifyError('ES256 の点が曲線の上にない')
        return alg, pt
    if alg == ALG_RS256:
        if kty != 3:
            raise VerifyError('RS256 の鍵ではない')
        n, e = key.get(-1), key.get(-2)
        if not (isinstance(n, bytes) and isinstance(e, bytes)):
            raise VerifyError('RS256 の鍵が読めない')
        n_i, e_i = int.from_bytes(n, 'big'), int.from_bytes(e, 'big')
        if n_i.bit_length() < 2048 or e_i < 3 or e_i % 2 == 0:
            raise VerifyError('RS256 の鍵が弱い')
        return alg, (n_i, e_i)
    raise VerifyError('対応していない鍵の種類')


# ---------------------------------------------------------------- 署名の確かめ（標準ライブラリだけ）

def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def _mul(k, pt):
    out = None
    while k:
        if k & 1:
            out = _add(out, pt)
        pt = _add(pt, pt)
        k >>= 1
    return out


def _der_sig(sig: bytes):
    """ECDSA の署名（DER の SEQUENCE{INTEGER r, INTEGER s}）→ (r, s)。崩れた形は断る"""
    def read_int(b, i):
        if i + 2 > len(b) or b[i] != 0x02:
            raise VerifyError('署名の形が読めない')
        ln = b[i + 1]
        if ln == 0 or ln > 33 or i + 2 + ln > len(b):
            raise VerifyError('署名の形が読めない')
        v = b[i + 2:i + 2 + ln]
        if v[0] & 0x80 or (ln > 1 and v[0] == 0 and not v[1] & 0x80):
            raise VerifyError('署名の形が読めない')
        return int.from_bytes(v, 'big'), i + 2 + ln
    if len(sig) < 8 or sig[0] != 0x30 or sig[1] != len(sig) - 2:
        raise VerifyError('署名の形が読めない')
    r, i = read_int(sig, 2)
    s, i = read_int(sig, i)
    if i != len(sig):
        raise VerifyError('署名の形が読めない')
    return r, s


def _verify_es256_pure(pt, msg: bytes, sig: bytes) -> bool:
    r, s = _der_sig(sig)
    if not (1 <= r < N and 1 <= s < N):
        return False
    e = int.from_bytes(hashlib.sha256(msg).digest(), 'big')
    w = pow(s, -1, N)
    X = _add(_mul(e * w % N, G), _mul(r * w % N, pt))
    return X is not None and X[0] % N == r


_SHA256_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')


def _verify_rs256_pure(key, msg: bytes, sig: bytes) -> bool:
    n, e = key
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, 'big')
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, 'big')
    t = _SHA256_PREFIX + hashlib.sha256(msg).digest()
    want = b'\x00\x01' + b'\xff' * (k - len(t) - 3) + b'\x00' + t
    return hmac.compare_digest(em, want)


def verify_signature(alg, key, msg: bytes, sig: bytes, force_pure: bool = False) -> bool:
    if HAVE_CRYPTOGRAPHY and not force_pure:
        try:
            if alg == ALG_ES256:
                pub = _ec.EllipticCurvePublicNumbers(key[0], key[1], _ec.SECP256R1()).public_key()
                pub.verify(sig, msg, _ec.ECDSA(_hashes.SHA256()))
            else:
                pub = _rsa.RSAPublicNumbers(key[1], key[0]).public_key()
                pub.verify(sig, msg, _padding.PKCS1v15(), _hashes.SHA256())
            return True
        except (_InvalidSignature, ValueError):
            return False
    if alg == ALG_ES256:
        try:
            return _verify_es256_pure(key, msg, sig)
        except VerifyError:
            return False
    return _verify_rs256_pure(key, msg, sig)


# ---------------------------------------------------------------- 登録と入場

def _client_data(raw: bytes, want_type: str, challenge: str, origin: str):
    try:
        cd = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as e:
        raise VerifyError('clientDataJSON が読めない') from e
    if not isinstance(cd, dict) or cd.get('type') != want_type:
        raise VerifyError('種類が違う')
    if not hmac.compare_digest(str(cd.get('challenge', '')), challenge):
        raise VerifyError('問題（challenge）が違う')
    if cd.get('origin') != origin:
        raise VerifyError('出どころ（origin）が違う')
    if cd.get('crossOrigin') is True:
        raise VerifyError('よそのページの中から呼ばれた')
    return cd


def parse_auth_data(ad: bytes):
    if len(ad) < 37:
        raise VerifyError('authenticatorData が短い')
    out = {'rp_id_hash': ad[:32], 'flags': ad[32], 'sign_count': int.from_bytes(ad[33:37], 'big')}
    if out['flags'] & FLAG_AT:
        if len(ad) < 55:
            raise VerifyError('authenticatorData が短い')
        ln = int.from_bytes(ad[53:55], 'big')
        if ln < 16 or ln > 1023 or 55 + ln > len(ad):
            raise VerifyError('鍵の id が読めない')
        out['cred_id'] = ad[55:55 + ln]
        _, end = cbor_decode(ad, 55 + ln)
        out['cose'] = ad[55 + ln:end]
    return out


def _check_flags(auth, rp_id: str, require_uv: bool):
    if not hmac.compare_digest(auth['rp_id_hash'], hashlib.sha256(rp_id.encode('utf-8')).digest()):
        raise VerifyError('名前（rp id）が違う')
    if not auth['flags'] & FLAG_UP:
        raise VerifyError('人が触れていない')
    if require_uv and not auth['flags'] & FLAG_UV:
        raise VerifyError('本人の確かめが無い')


def verify_registration(client_data_json: bytes, attestation_object: bytes, *, challenge: str,
                        origin: str, rp_id: str, require_uv: bool = True):
    """登録を確かめ、しまう物 {cred_id, alg, public_key, sign_count} を返す"""
    _client_data(client_data_json, 'webauthn.create', challenge, origin)
    att, end = cbor_decode(attestation_object)
    if not isinstance(att, dict) or end != len(attestation_object) or not isinstance(att.get('authData'), bytes):
        raise VerifyError('attestationObject が読めない')
    auth = parse_auth_data(att['authData'])
    _check_flags(auth, rp_id, require_uv)
    if 'cose' not in auth:
        raise VerifyError('公開鍵が入っていない')
    alg, _ = parse_cose_key(auth['cose'])
    if alg not in SUPPORTED_ALGS:
        raise VerifyError('対応していない鍵の種類')
    return {'cred_id': b64u_encode(auth['cred_id']), 'alg': alg,
            'public_key': b64u_encode(auth['cose']), 'sign_count': auth['sign_count']}


def verify_assertion(*, public_key: str, sign_count: int, client_data_json: bytes, authenticator_data: bytes,
                     signature: bytes, challenge: str, origin: str, rp_id: str, require_uv: bool = True,
                     force_pure: bool = False) -> int:
    """入場の署名を確かめ、新しい署名の回数を返す。
    回数が前より増えていなければ断る（鍵の写しが作られたしるし）。0 のままの端末（回数を数えない
    パスキー）は通す"""
    _client_data(client_data_json, 'webauthn.get', challenge, origin)
    auth = parse_auth_data(authenticator_data)
    _check_flags(auth, rp_id, require_uv)
    alg, key = parse_cose_key(b64u_decode(public_key))
    msg = authenticator_data + hashlib.sha256(client_data_json).digest()
    if not verify_signature(alg, key, msg, signature, force_pure=force_pure):
        raise VerifyError('署名が合わない')
    new = auth['sign_count']
    if (new or sign_count) and new <= sign_count:
        raise VerifyError('署名の回数が戻った')
    return new
