/// <reference path="../pb_data/types.d.ts" />

// Crypto primitives for Web Push payload encryption (RFC 8188 + RFC 8291).
//
// WHY THIS FILE EXISTS AT ALL. Sending an encrypted web push needs four
// primitives. PocketBase's JSVM (Goja) has no WebCrypto, and the openssl CLI
// we shell out to for the other two refuses the one that matters:
//
//     $ openssl enc -aes-128-gcm ...
//     enc: AEAD ciphers not supported
//
// So AES-128-GCM — and the SHA-256/HMAC/HKDF chain feeding it — are written
// out longhand here. ECDH and ES256 stay in openssl (see webpush.js), because
// P-256 curve arithmetic in hand-written JS is a genuinely bad idea.
//
// NB: this is a require()d module, NOT a .pb.js hook — same reasoning as
// sms.js. Hook files cannot see each other's scope; require()d ones get their
// own.
//
// EVERY function here is verified against Node's native crypto and Python's
// `cryptography` in test/webpush_crypto.test.js — including the RFC 8291 §5
// worked example. Do not "tidy" anything in this file without re-running it.
// Byte-for-byte output is the only thing that matters; none of it is hot
// enough for cleverness to pay (a few pushes per café per day).

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------
// Everything moves as Uint8Array. Goja supports typed arrays, and they keep
// binary data out of JS strings — a string round-trip would silently mangle
// any byte that is not valid UTF-16, which is most of them.

function u8(n) { return new Uint8Array(n); }

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = u8(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function strToBytes(s) {
  // ASCII only — every string fed to this is an RFC-defined label.
  const out = u8(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] >>> 4).toString(16) + (b[i] & 15).toString(16);
  return s;
}

function hexToBytes(h) {
  const out = u8(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function b64urlEncode(bytes) {
  const alphabet = B64 + "-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += alphabet[b0 >>> 2];
    out += alphabet[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >>> 4)];
    if (b1 === undefined) break;
    out += alphabet[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >>> 6)];
    if (b2 === undefined) break;
    out += alphabet[b2 & 63];
  }
  return out; // unpadded, per RFC 7515
}

// Standard base64 WITH padding. Distinct from b64urlEncode because this feeds
// `base64 -d` in a shell, which rejects the url-safe alphabet and chokes on
// missing padding.
function b64Standard(bytes) {
  const alphabet = B64 + "+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += alphabet[b0 >>> 2];
    out += alphabet[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >>> 4)];
    out += b1 === undefined ? "=" : alphabet[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >>> 6)];
    out += b2 === undefined ? "=" : alphabet[b2 & 63];
  }
  return out;
}

function b64urlDecode(str) {
  // Tolerates both base64url and plain base64, padded or not: subscription
  // keys arrive from the browser in base64url, but hand-pasted env vars have
  // a habit of being standard base64.
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const alphabet = B64 + "+/";
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = alphabet.indexOf(s[i]);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >>> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// SHA-256  (FIPS 180-4)
// ---------------------------------------------------------------------------

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function sha256(msg) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  // pad: 0x80, zeros, then the 64-bit bit-length big-endian
  const bitLenHi = Math.floor((msg.length * 8) / 0x100000000);
  const bitLenLo = (msg.length * 8) >>> 0;
  const padded = u8(((msg.length + 9 + 63) >>> 6) << 6);
  padded.set(msg, 0);
  padded[msg.length] = 0x80;
  const dv = padded.length;
  padded[dv - 8] = (bitLenHi >>> 24) & 0xff; padded[dv - 7] = (bitLenHi >>> 16) & 0xff;
  padded[dv - 6] = (bitLenHi >>> 8) & 0xff;  padded[dv - 5] = bitLenHi & 0xff;
  padded[dv - 4] = (bitLenLo >>> 24) & 0xff; padded[dv - 3] = (bitLenLo >>> 16) & 0xff;
  padded[dv - 2] = (bitLenLo >>> 8) & 0xff;  padded[dv - 1] = bitLenLo & 0xff;

  const w = new Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) |
              (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = u8(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff; out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff; out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 and HKDF  (RFC 2104, RFC 5869)
// ---------------------------------------------------------------------------
// Deliberately NOT $security.hs256(): that takes and returns JS strings, and
// every key here is raw binary (an ECDH secret, a 16-byte salt). Pushing those
// through a string would corrupt them.

function hmacSha256(key, data) {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const ipad = u8(64), opad = u8(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  return sha256(concat([opad, sha256(concat([ipad, data]))]));
}

// Web push only ever needs <= 32 bytes out, so this is the single-block form
// of HKDF-Expand: one HMAC, truncated. Asking for more would silently be
// wrong, hence the throw.
function hkdf(salt, ikm, info, length) {
  if (length > 32) throw new Error("hkdf: length > 32 not implemented");
  const prk = hmacSha256(salt, ikm);
  const okm = hmacSha256(prk, concat([info, Uint8Array.from([1])]));
  return okm.subarray(0, length);
}

// ---------------------------------------------------------------------------
// AES-128  (FIPS 197) — encryption direction only, which is all GCM uses
// ---------------------------------------------------------------------------

const SBOX = (function () {
  // Generated rather than typed out: a 256-entry hand-copied table is a typo
  // looking for somewhere to happen, and this runs once at load.
  //
  // s[i] = affine(i^-1), where i^-1 is the MULTIPLICATIVE INVERSE in GF(2^8).
  // Getting the inverse out of a log table means antilog[255 - log[i]] — NOT
  // log[i] itself. Mixing those two up produces a table that looks plausible,
  // encrypts happily, and is wrong in every byte; FIPS-197 C.1 in the test
  // file is what catches it.
  const antilog = u8(256), log = u8(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    antilog[i] = x;
    log[x] = i;
    x = (x ^ ((x << 1) ^ ((x & 0x80) ? 0x11b : 0))) & 0xff; // x *= 3
  }
  const s = u8(256);
  s[0] = 0x63; // 0 has no inverse; the spec maps it to itself before the affine step
  for (let i = 1; i < 256; i++) {
    let y = antilog[(255 - log[i]) % 255];
    let t = y;
    for (let j = 0; j < 4; j++) { t = ((t << 1) | (t >>> 7)) & 0xff; y ^= t; }
    s[i] = (y ^ 0x63) & 0xff;
  }
  return s;
})();

function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }

function aesExpandKey(key) {
  // AES-128: 11 round keys of 16 bytes.
  const rk = u8(176);
  rk.set(key, 0);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = rk[i - 4], t1 = rk[i - 3], t2 = rk[i - 2], t3 = rk[i - 1];
    if (i % 16 === 0) {
      const tmp = t0;
      t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[tmp];
      rcon = xtime(rcon);
    }
    rk[i] = rk[i - 16] ^ t0; rk[i + 1] = rk[i - 15] ^ t1;
    rk[i + 2] = rk[i - 14] ^ t2; rk[i + 3] = rk[i - 13] ^ t3;
  }
  return rk;
}

function aesEncryptBlock(rk, block) {
  const s = u8(16);
  for (let i = 0; i < 16; i++) s[i] = block[i] ^ rk[i];

  for (let round = 1; round <= 10; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // ShiftRows — state is column-major, so row r is bytes r, r+4, r+8, r+12
    let t;
    t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
    // MixColumns — skipped in the final round, per the spec
    if (round !== 10) {
      for (let c = 0; c < 16; c += 4) {
        const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
        const x = a0 ^ a1 ^ a2 ^ a3;
        s[c]     = a0 ^ x ^ xtime(a0 ^ a1);
        s[c + 1] = a1 ^ x ^ xtime(a1 ^ a2);
        s[c + 2] = a2 ^ x ^ xtime(a2 ^ a3);
        s[c + 3] = a3 ^ x ^ xtime(a3 ^ a0);
      }
    }
    // AddRoundKey
    for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
  }
  return s;
}

// ---------------------------------------------------------------------------
// GCM  (NIST SP 800-38D)
// ---------------------------------------------------------------------------

function ghashMul(X, Y) {
  // Carry-less multiply in GF(2^128). Bit 0 is the MSB of byte 0 — GCM's
  // big-endian-bit convention, which is the opposite of most GF code you
  // will find elsewhere.
  const Z = u8(16), V = u8(16);
  V.set(Y);
  for (let i = 0; i < 128; i++) {
    if ((X[i >>> 3] >>> (7 - (i & 7))) & 1) {
      for (let j = 0; j < 16; j++) Z[j] ^= V[j];
    }
    const lsb = V[15] & 1;
    for (let j = 15; j > 0; j--) V[j] = ((V[j] >>> 1) | ((V[j - 1] & 1) << 7)) & 0xff;
    V[0] = V[0] >>> 1;
    if (lsb) V[0] ^= 0xe1; // the reduction polynomial
  }
  return Z;
}

function ghash(H, data) {
  let Y = u8(16);
  for (let off = 0; off < data.length; off += 16) {
    const block = u8(16);
    block.set(data.subarray(off, Math.min(off + 16, data.length)));
    for (let j = 0; j < 16; j++) block[j] ^= Y[j];
    Y = ghashMul(block, H);
  }
  return Y;
}

function be64(n) {
  const b = u8(8);
  const hi = Math.floor(n / 0x100000000), lo = n >>> 0;
  b[0] = (hi >>> 24) & 0xff; b[1] = (hi >>> 16) & 0xff; b[2] = (hi >>> 8) & 0xff; b[3] = hi & 0xff;
  b[4] = (lo >>> 24) & 0xff; b[5] = (lo >>> 16) & 0xff; b[6] = (lo >>> 8) & 0xff; b[7] = lo & 0xff;
  return b;
}

// Returns ciphertext WITH the 16-byte auth tag appended, which is the layout
// RFC 8188 expects on the wire.
function aesGcmEncrypt(key, iv, plaintext, aad) {
  if (key.length !== 16) throw new Error("aesGcmEncrypt: key must be 16 bytes");
  if (iv.length !== 12) throw new Error("aesGcmEncrypt: iv must be 12 bytes (web push always is)");
  const A = aad || u8(0);
  const rk = aesExpandKey(key);
  const H = aesEncryptBlock(rk, u8(16));

  // 12-byte IV takes the short path: J0 = IV || 0x00000001
  const J0 = u8(16);
  J0.set(iv, 0);
  J0[15] = 1;

  // GCTR over the plaintext, counter starting at J0 + 1
  const ct = u8(plaintext.length);
  const counter = u8(16);
  counter.set(J0);
  for (let off = 0; off < plaintext.length; off += 16) {
    // inc32 on the trailing 4 bytes
    for (let j = 15; j >= 12; j--) { counter[j] = (counter[j] + 1) & 0xff; if (counter[j] !== 0) break; }
    const ks = aesEncryptBlock(rk, counter);
    const n = Math.min(16, plaintext.length - off);
    for (let j = 0; j < n; j++) ct[off + j] = plaintext[off + j] ^ ks[j];
  }

  // S = GHASH(A padded || C padded || len(A)bits || len(C)bits)
  const padA = (16 - (A.length % 16)) % 16;
  const padC = (16 - (ct.length % 16)) % 16;
  const S = ghash(H, concat([A, u8(padA), ct, u8(padC), be64(A.length * 8), be64(ct.length * 8)]));

  const EJ0 = aesEncryptBlock(rk, J0);
  const tag = u8(16);
  for (let i = 0; i < 16; i++) tag[i] = S[i] ^ EJ0[i];

  return concat([ct, tag]);
}

module.exports = {
  u8, concat, strToBytes, bytesToHex, hexToBytes,
  b64urlEncode, b64urlDecode, b64Standard,
  sha256, hmacSha256, hkdf,
  aesExpandKey, aesEncryptBlock, aesGcmEncrypt,
};
