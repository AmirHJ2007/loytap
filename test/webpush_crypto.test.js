// Verification for webpush_crypto.js. Run with:  node test/webpush_crypto.test.js
// Checks our hand-written primitives byte-for-byte against Node's native
// crypto. Run this after ANY change to webpush_crypto.js.
const crypto = require("crypto");
const C = require("../backend/pb_hooks/webpush_crypto.js");

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = Buffer.from(got).toString("hex");
  const w = Buffer.from(want).toString("hex");
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}
function rand(n) { return crypto.randomBytes(n); }

// --- SHA-256: empty, short, exactly one block, spanning blocks, long --------
for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 5000]) {
  const msg = rand(n);
  check(`sha256(${n} bytes)`, C.sha256(new Uint8Array(msg)),
        crypto.createHash("sha256").update(msg).digest());
}

// --- HMAC-SHA256: keys shorter than, equal to, and longer than the block ----
for (const [kn, dn] of [[1, 0], [16, 32], [32, 100], [64, 64], [65, 10], [200, 300]]) {
  const key = rand(kn), data = rand(dn);
  check(`hmac(key=${kn},data=${dn})`, C.hmacSha256(new Uint8Array(key), new Uint8Array(data)),
        crypto.createHmac("sha256", key).update(data).digest());
}

// --- HKDF (RFC 5869, single-block expand) -----------------------------------
for (const len of [12, 16, 32]) {
  const salt = rand(16), ikm = rand(32), info = Buffer.from("Content-Encoding: test\0");
  check(`hkdf(len=${len})`, C.hkdf(new Uint8Array(salt), new Uint8Array(ikm), new Uint8Array(info), len),
        crypto.hkdfSync("sha256", ikm, salt, info, len));
}

// --- AES-128 known-answer (FIPS-197 Appendix C.1) ---------------------------
// A generated S-box can be subtly wrong in a way that random round-trips
// against Node would still catch, but this names the failure instantly.
check("FIPS-197 C.1",
  C.aesEncryptBlock(
    C.aesExpandKey(Uint8Array.from(Array.from({ length: 16 }, (_, i) => i))),
    Uint8Array.from([0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff])),
  Buffer.from("69c4e0d86a7b0430d8cdb78070b4c55a", "hex"));

// --- AES-128 single block (ECB of one block == the raw block cipher) --------
for (let i = 0; i < 20; i++) {
  const key = rand(16), block = rand(16);
  const c = crypto.createCipheriv("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  check(`aes128 block #${i}`, C.aesEncryptBlock(C.aesExpandKey(new Uint8Array(key)), new Uint8Array(block)),
        Buffer.concat([c.update(block), c.final()]));
}

// --- AES-128-GCM: lengths around block boundaries, with and without AAD -----
for (const [pn, an] of [[0, 0], [1, 0], [15, 0], [16, 0], [17, 0], [64, 0], [100, 0],
                        [40, 16], [40, 13], [0, 20], [250, 7], [4096, 0]]) {
  const key = rand(16), iv = rand(12), pt = rand(pn), aad = rand(an);
  const c = crypto.createCipheriv("aes-128-gcm", key, iv);
  if (an) c.setAAD(aad);
  const want = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  check(`aes-128-gcm(pt=${pn},aad=${an})`,
        C.aesGcmEncrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(pt), new Uint8Array(aad)),
        want);
}

// --- base64url round-trip, including every padding remainder ----------------
for (const n of [0, 1, 2, 3, 4, 5, 16, 32, 65, 100]) {
  const b = rand(n);
  const enc = C.b64urlEncode(new Uint8Array(b));
  const want = b.toString("base64url");
  if (enc !== want) { fail++; console.log(`FAIL b64urlEncode(${n})\n  got  ${enc}\n  want ${want}`); }
  else pass++;
  check(`b64urlDecode(${n})`, C.b64urlDecode(enc), b);
}
// decode must also accept standard base64 with padding (hand-pasted env vars)
check("b64urlDecode accepts standard base64", C.b64urlDecode(Buffer.from([251, 255, 190]).toString("base64")),
      Buffer.from([251, 255, 190]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
