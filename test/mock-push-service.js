// A stand-in for FCM/APNs, for testing the sender without the internet.
//
// Does what a real push service does, strictly: checks the VAPID JWT
// signature and claims, then — playing the browser — decrypts the body. Exits
// non-zero if anything is wrong, so it can gate a test run.
//
//   node test/mock-push-service.js <port> <subscription-json-out>
//
// Prints one JSON line per request received, on stdout.
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const port = parseInt(process.argv[2] || "8099", 10);
const subOut = process.argv[3];

// the "browser's" subscription keys
const ua = crypto.createECDH("prime256v1");
ua.generateKeys();
const authSecret = crypto.randomBytes(16);

const b64url = (b) => Buffer.from(b).toString("base64url");
fs.writeFileSync(subOut, JSON.stringify({
  endpoint: `http://127.0.0.1:${port}/push/test-device`,
  p256dh: b64url(ua.getPublicKey()),
  auth: b64url(authSecret),
}));

function fail(res, why) {
  console.log(JSON.stringify({ ok: false, error: why }));
  res.writeHead(400).end(why);
}

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    try {
      // --- VAPID: Authorization: vapid t=<jwt>, k=<pubkey> ---
      const auth = req.headers["authorization"] || "";
      const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(auth);
      if (!m) return fail(res, "malformed Authorization: " + auth.slice(0, 60));
      const [, jwt, k] = m;
      const [h64, p64, s64] = jwt.split(".");
      const header = JSON.parse(Buffer.from(h64, "base64url"));
      const claims = JSON.parse(Buffer.from(p64, "base64url"));
      if (header.alg !== "ES256") return fail(res, "alg must be ES256, got " + header.alg);
      if (claims.aud !== `http://127.0.0.1:${port}`) return fail(res, "wrong aud: " + claims.aud);
      if (claims.exp < Math.floor(Date.now() / 1000)) return fail(res, "token already expired");
      if (!claims.sub) return fail(res, "missing sub");

      // verify the ES256 signature against the public key in k=
      const pubPoint = Buffer.from(k, "base64url");
      const spki = Buffer.concat([
        Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), pubPoint]);
      const pubKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
      const sigDer = joseToDer(Buffer.from(s64, "base64url"));
      const verified = crypto.verify("sha256", Buffer.from(`${h64}.${p64}`), pubKey, sigDer);
      if (!verified) return fail(res, "VAPID signature does not verify");

      // --- headers a real service requires ---
      if (req.headers["content-encoding"] !== "aes128gcm")
        return fail(res, "bad Content-Encoding: " + req.headers["content-encoding"]);
      if (!req.headers["ttl"]) return fail(res, "missing TTL header");

      // --- decrypt, as the browser would ---
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const asPublic = body.subarray(21, 21 + idlen);
      const ciphertext = body.subarray(21 + idlen);
      const ecdhSecret = ua.computeSecret(asPublic);
      const ikm = crypto.hkdfSync("sha256", ecdhSecret, authSecret,
        Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32);
      const cek = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
      const nonce = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
      const d = crypto.createDecipheriv("aes-128-gcm", Buffer.from(cek), Buffer.from(nonce));
      d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
      const text = plain.subarray(0, plain.length - 1).toString("utf8"); // drop 0x02

      console.log(JSON.stringify({ ok: true, ttl: req.headers["ttl"],
        urgency: req.headers["urgency"], sub: claims.sub, decrypted: text }));
      res.writeHead(201).end();
    } catch (err) {
      fail(res, String(err && err.stack || err));
    }
  });
}).listen(port, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, port })));

function joseToDer(sig) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    const pad = v[0] & 0x80 ? Buffer.from([0]) : Buffer.alloc(0);
    const body = Buffer.concat([pad, v]);
    return Buffer.concat([Buffer.from([0x02, body.length]), body]);
  };
  const r = int(sig.subarray(0, 32)), s = int(sig.subarray(32));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}
