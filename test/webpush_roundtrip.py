#!/usr/bin/env python3
"""Decrypts a web push body produced by backend/pb_hooks/webpush.js.

Written straight from RFC 8188 + RFC 8291 against Python's `cryptography`,
deliberately WITHOUT looking at the JS. If both agree the construction is
right; if only the JS agrees with itself it proves nothing.

Driven by test/webpush_roundtrip.sh — not meant to be run bare.
"""
import base64, json, sys
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64d(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def main():
    case = json.load(sys.stdin)

    body = b64d(case["body"])
    ua_private_int = int(case["uaPrivateHex"], 16)
    auth_secret = b64d(case["authSecret"])
    expected = case["plaintext"]

    # --- unpack the aes128gcm header (RFC 8188 §2.1) ---
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    assert idlen == 65, f"keyid should be a 65-byte P-256 point, got {idlen}"
    as_public_raw = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    assert rs >= len(ciphertext), f"record size {rs} smaller than ciphertext {len(ciphertext)}"

    # --- ECDH, from the browser's side this time ---
    ua_private = ec.derive_private_key(ua_private_int, ec.SECP256R1())
    ua_public_raw = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    as_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public_raw)
    ecdh_secret = ua_private.exchange(ec.ECDH(), as_public)

    # --- RFC 8291 §3.3: auth secret salts the first extract ---
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret,
               info=b"WebPush: info\x00" + ua_public_raw + as_public_raw).derive(ecdh_secret)

    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt,
               info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt,
                 info=b"Content-Encoding: nonce\x00").derive(ikm)

    padded = AESGCM(cek).decrypt(nonce, ciphertext, None)

    # final record is delimited by 0x02, then any zero padding
    stripped = padded.rstrip(b"\x00")
    assert stripped[-1] == 0x02, f"expected final-record delimiter 0x02, got {stripped[-1]:#x}"
    got = stripped[:-1].decode("utf-8")

    if got != expected:
        print(f"MISMATCH\n  got  {got!r}\n  want {expected!r}")
        sys.exit(1)
    print(f"  ok  decrypted {len(got)} chars: {got[:48]}")


main()
