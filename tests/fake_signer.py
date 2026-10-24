"""テスト用の偽の端末の署名（ES256）。Node の無い機械（サーバー）でもテストを走らせるためのもの。

標準ライブラリだけで、ECDSA P-256 の署名を作る。曲線の計算は passkey_crypto の確かめと同じ部品を使うので、
これだけでは確かめの誤りを見落としうる。その穴は、Node で作った署名（tests/fixtures/node_signatures.json）を
確かめが通すか、のテストで埋める（test_passkey_crypto.py）。本物の端末の代わりにはしない。
"""
import hashlib
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import passkey_crypto as pc  # noqa: E402


def _der_int(v: int) -> bytes:
    b = v.to_bytes((v.bit_length() + 7) // 8 or 1, 'big')
    if b[0] & 0x80:
        b = b'\0' + b
    return b'\x02' + bytes([len(b)]) + b


class EcKey:
    def __init__(self):
        self.d = secrets.randbelow(pc.N - 1) + 1
        self.x, self.y = pc._mul(self.d, pc.G)

    def cose(self, cbor) -> bytes:
        return cbor({1: 2, 3: -7, -1: 1, -2: self.x.to_bytes(32, 'big'), -3: self.y.to_bytes(32, 'big')})

    def sign(self, msg: bytes) -> bytes:
        e = int.from_bytes(hashlib.sha256(msg).digest(), 'big')
        while True:
            k = secrets.randbelow(pc.N - 1) + 1
            r = pc._mul(k, pc.G)[0] % pc.N
            s = pow(k, -1, pc.N) * (e + r * self.d) % pc.N
            if r and s:
                body = _der_int(r) + _der_int(s)
                return b'\x30' + bytes([len(body)]) + body
