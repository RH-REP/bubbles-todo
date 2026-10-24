"""passkey_crypto.py のテスト。署名は Node の暗号の部品（別の実装）で作り、Python の確かめと突き合わせる。

    python3 -m unittest tests/test_passkey_crypto.py

偽の端末（このファイルの FakeAuthenticator）が、本物の端末と同じ形の登録・入場のデータを作る。
"""
import hashlib
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import passkey_crypto as pc  # noqa: E402

RP_ID = 'bubbles.example.org'
ORIGIN = 'https://bubbles.example.org'

NODE_SIGNER = r"""
const crypto = require('node:crypto');
const req = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const out = {};
for (const [name, kind] of Object.entries(req.keys)) {
  const { publicKey, privateKey } = kind === 'ec'
    ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
  out[name] = { jwk: publicKey.export({ format: 'jwk' }),
    sigs: req.msgs.map(m => crypto.sign('sha256', Buffer.from(m, 'hex'), privateKey).toString('hex')) };
}
process.stdout.write(JSON.stringify(out));
"""


def cbor(v):
    """テスト用の小さな CBOR の書き手（整数・バイト列・文字列・配列・写像）"""
    def head(major, n):
        if n < 24:
            return bytes([major << 5 | n])
        for info, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
            if n < 1 << (8 * size):
                return bytes([major << 5 | info]) + n.to_bytes(size, 'big')
    if isinstance(v, bool):
        return b'\xf5' if v else b'\xf4'
    if isinstance(v, int):
        return head(0, v) if v >= 0 else head(1, -1 - v)
    if isinstance(v, bytes):
        return head(2, len(v)) + v
    if isinstance(v, str):
        b = v.encode()
        return head(3, len(b)) + b
    if isinstance(v, list):
        return head(4, len(v)) + b''.join(cbor(x) for x in v)
    if isinstance(v, dict):
        return head(5, len(v)) + b''.join(cbor(k) + cbor(x) for k, x in v.items())
    raise TypeError(v)


def b64u(s):
    return pc.b64u_decode(s)


def node_sign(keys, msgs):
    r = subprocess.run(['node', '-e', NODE_SIGNER], input=json.dumps({'keys': keys, 'msgs': [m.hex() for m in msgs]}),
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def cose_from_jwk(jwk):
    if jwk['kty'] == 'EC':
        return cbor({1: 2, 3: -7, -1: 1, -2: b64u(jwk['x']), -3: b64u(jwk['y'])})
    return cbor({1: 3, 3: -257, -1: b64u(jwk['n']), -2: b64u(jwk['e'])})


def auth_data(flags, count, cred_id=None, cose=None, rp_id=RP_ID):
    ad = hashlib.sha256(rp_id.encode()).digest() + bytes([flags]) + count.to_bytes(4, 'big')
    if cred_id is not None:
        ad += b'\0' * 16 + len(cred_id).to_bytes(2, 'big') + cred_id + cose
    return ad


def client_data(kind, challenge, origin=ORIGIN):
    return json.dumps({'type': kind, 'challenge': challenge, 'origin': origin, 'crossOrigin': False}).encode()


class CryptoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 入場で署名するもの（authData ‖ sha256(clientDataJSON)）を先に作っておき、Node に署名させる
        cls.chal = pc.b64u_encode(os.urandom(32))
        cls.cd = client_data('webauthn.get', cls.chal)
        cls.ad1 = auth_data(pc.FLAG_UP | pc.FLAG_UV, 5)
        cls.msg = cls.ad1 + hashlib.sha256(cls.cd).digest()
        cls.keys = node_sign({'ec': 'ec', 'rsa': 'rsa'}, [cls.msg, b'other message'])

    def stored(self, name):
        return pc.b64u_encode(cose_from_jwk(self.keys[name]['jwk']))

    def assertion(self, name, **kw):
        args = dict(public_key=self.stored(name), sign_count=4, client_data_json=self.cd,
                    authenticator_data=self.ad1, signature=bytes.fromhex(self.keys[name]['sigs'][0]),
                    challenge=self.chal, origin=ORIGIN, rp_id=RP_ID, force_pure=True)
        args.update(kw)
        return pc.verify_assertion(**args)

    def test_es256_and_rs256_signed_by_node_pass(self):
        self.assertEqual(self.assertion('ec'), 5)
        self.assertEqual(self.assertion('rsa'), 5)

    def test_cryptography_path_agrees_when_installed(self):
        if not pc.HAVE_CRYPTOGRAPHY:
            self.skipTest('cryptography が入っていない（標準ライブラリだけの確かめを使う）')
        self.assertEqual(self.assertion('ec', force_pure=False), 5)
        self.assertEqual(self.assertion('rsa', force_pure=False), 5)

    def test_wrong_signature_fails(self):
        for name in ('ec', 'rsa'):
            other = bytes.fromhex(self.keys[name]['sigs'][1])   # 別の文に付けた署名
            with self.assertRaises(pc.VerifyError):
                self.assertion(name, signature=other)
            bad = bytearray(bytes.fromhex(self.keys[name]['sigs'][0]))
            bad[-1] ^= 1
            with self.assertRaises(pc.VerifyError):
                self.assertion(name, signature=bytes(bad))

    def test_other_key_fails(self):
        with self.assertRaises(pc.VerifyError):
            self.assertion('ec', public_key=self.stored('rsa'))

    def test_wrong_challenge_origin_rp_fail(self):
        with self.assertRaises(pc.VerifyError):
            self.assertion('ec', challenge=pc.b64u_encode(b'x' * 32))
        with self.assertRaises(pc.VerifyError):
            self.assertion('ec', origin='https://evil.example')
        with self.assertRaises(pc.VerifyError):
            self.assertion('ec', rp_id='evil.example')

    def test_flags_and_counter(self):
        with self.assertRaises(pc.VerifyError):
            self.assertion('ec', sign_count=5)       # 回数が増えていない（写しのしるし）
        cd = self.cd
        ad = auth_data(pc.FLAG_UP, 5)                # 本人の確かめが無い
        sig = node_sign({'k': 'ec'}, [ad + hashlib.sha256(cd).digest()])['k']
        args = dict(public_key=pc.b64u_encode(cose_from_jwk(sig['jwk'])), sign_count=0, client_data_json=cd,
                    authenticator_data=ad, signature=bytes.fromhex(sig['sigs'][0]), challenge=self.chal,
                    origin=ORIGIN, rp_id=RP_ID, force_pure=True)
        with self.assertRaises(pc.VerifyError):
            pc.verify_assertion(**args)
        self.assertEqual(pc.verify_assertion(**dict(args, require_uv=False)), 5)

    def test_registration(self):
        chal = pc.b64u_encode(os.urandom(32))
        cose = cose_from_jwk(self.keys['ec']['jwk'])
        cred = os.urandom(32)
        att = cbor({'fmt': 'none', 'attStmt': {}, 'authData': auth_data(pc.FLAG_UP | pc.FLAG_UV | pc.FLAG_AT, 0, cred, cose)})
        out = pc.verify_registration(client_data('webauthn.create', chal), att, challenge=chal, origin=ORIGIN, rp_id=RP_ID)
        self.assertEqual(out['cred_id'], pc.b64u_encode(cred))
        self.assertEqual(out['alg'], -7)
        with self.assertRaises(pc.VerifyError):   # 入場のデータを登録に使えない
            pc.verify_registration(client_data('webauthn.get', chal), att, challenge=chal, origin=ORIGIN, rp_id=RP_ID)

    def test_bad_inputs_do_not_crash(self):
        for junk in (b'', b'\xff', b'\x5f' * 3, b'\xbb' + b'\x00' * 10, os.urandom(40)):
            with self.assertRaises(pc.VerifyError):
                pc.verify_registration(client_data('webauthn.create', 'c'), junk, challenge='c', origin=ORIGIN, rp_id=RP_ID)
        off_curve = cbor({1: 2, 3: -7, -1: 1, -2: b'\1' * 32, -3: b'\2' * 32})
        with self.assertRaises(pc.VerifyError):
            pc.parse_cose_key(off_curve)
        weak = cbor({1: 3, 3: -257, -1: b'\xff' * 128, -2: b'\x01\x00\x01'})
        with self.assertRaises(pc.VerifyError):
            pc.parse_cose_key(weak)


if __name__ == '__main__':
    unittest.main()
