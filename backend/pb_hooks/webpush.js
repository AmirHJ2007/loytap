/// <reference path="../pb_data/types.d.ts" />

// Web Push sender — RFC 8291 (message encryption) over RFC 8188 (aes128gcm),
// authenticated with RFC 8292 VAPID.
//
// Split of labour, and why:
//   encryptPayload()  pure JS, no I/O — the whole aes128gcm construction.
//                     Pure on purpose: test/webpush.test.js drives it with
//                     ECDH values from Node and decrypts the result with an
//                     independent Python implementation. Nothing about it
//                     needs PocketBase to run.
//   ecdh(), send()    shell out to openssl and curl, because Goja has no
//                     P-256 arithmetic and $http.send() cannot carry a binary
//                     body (it takes a JS string; every byte above 0x7f would
//                     come out UTF-8-mangled).
//
// Primitives live in webpush_crypto.js. See the header there for why they are
// hand-written at all — short version: `openssl enc` refuses AEAD ciphers.
//
// NB: require()d module, not a .pb.js hook. See sms.js.

const C = require(`${__hooks}/webpush_crypto.js`);

// ---------------------------------------------------------------------------
// the encrypted body
// ---------------------------------------------------------------------------

// Everything the caller must have gathered already. Kept as explicit inputs
// rather than fetched in here so the function stays pure and testable:
//
//   plaintext   string, the JSON the service worker will read
//   uaPublic    65 bytes, the subscription's p256dh key (the DEVICE's key)
//   authSecret  16 bytes, the subscription's auth secret
//   asPublic    65 bytes, OUR ephemeral public key for this one message
//   ecdhSecret  32 bytes, ECDH(our ephemeral private, uaPublic)
//   salt        16 bytes, fresh random per message
//
// Returns the body to POST: header || ciphertext || tag.
function encryptPayload(o) {
  const plaintext = typeof o.plaintext === "string" ? utf8Bytes(o.plaintext) : o.plaintext;
  if (o.uaPublic.length !== 65) throw new Error("p256dh must be 65 bytes, got " + o.uaPublic.length);
  if (o.asPublic.length !== 65) throw new Error("ephemeral public key must be 65 bytes");
  if (o.ecdhSecret.length !== 32) throw new Error("ecdh secret must be 32 bytes");
  if (o.salt.length !== 16) throw new Error("salt must be 16 bytes");

  // RFC 8291 §3.3. The auth secret is the HKDF *salt* here and the ECDH output
  // is the input keying material — which is the reverse of how they are used
  // one step later. Swapping them yields a key the browser will not derive.
  const keyInfo = C.concat([
    C.strToBytes("WebPush: info\0"),
    o.uaPublic,   // receiver first
    o.asPublic,   // sender second — this order is normative
  ]);
  const ikm = C.hkdf(o.authSecret, o.ecdhSecret, keyInfo, 32);

  // RFC 8188 §2.1 — now the record salt takes over as the HKDF salt.
  const cek = C.hkdf(o.salt, ikm, C.strToBytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = C.hkdf(o.salt, ikm, C.strToBytes("Content-Encoding: nonce\0"), 12);

  // A single record, so it carries the final-record delimiter 0x02. A 0x01
  // here would tell the browser another record follows, and it would reject
  // the message when none did.
  const padded = C.concat([plaintext, Uint8Array.from([2])]);

  const ciphertext = C.aesGcmEncrypt(cek, nonce, padded, C.u8(0));

  // rs is the record size the receiver should expect. It has to be at least
  // plaintext + 1 delimiter + 16 tag; 4096 covers anything we would sensibly
  // send and matches what every browser accepts.
  const rs = 4096;
  const header = C.concat([
    o.salt,
    Uint8Array.from([(rs >>> 24) & 0xff, (rs >>> 16) & 0xff, (rs >>> 8) & 0xff, rs & 0xff]),
    Uint8Array.from([o.asPublic.length]),
    o.asPublic,
  ]);

  return C.concat([header, ciphertext]);
}

// Goja has no TextEncoder, and the notification text is Persian — so UTF-8
// encoding is done by hand rather than assumed.
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    // surrogate pair -> single code point
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000; i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// the VAPID Authorization header
// ---------------------------------------------------------------------------

// Builds the signing input for the JWT. The signature itself needs P-256,
// so it is produced by openssl in sign() below and pasted on here.
function vapidSigningInput(audience, subject, expSeconds) {
  const header = C.b64urlEncode(C.strToBytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = C.b64urlEncode(C.strToBytes(JSON.stringify({
    aud: audience,
    exp: expSeconds,
    sub: subject,
  })));
  return header + "." + claims;
}

// The push service's origin, which is what the JWT's `aud` must be — not the
// full endpoint URL. Sending the whole URL gets a 401 from FCM.
function originOf(url) {
  const m = /^(https?:\/\/[^/]+)/.exec(String(url));
  if (!m) throw new Error("push endpoint is not a URL: " + url);
  return m[1];
}

// openssl emits ECDSA signatures as an ASN.1 SEQUENCE of two INTEGERs. JOSE
// wants the bare r||s, 32 bytes each. The INTEGERs are signed, so a high bit
// in the first byte means openssl prefixed a 0x00 that must come off — and a
// short value must be left-padded back up to 32.
function derToJoseSignature(der) {
  if (der[0] !== 0x30) throw new Error("not a DER sequence");
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f); // long-form length
  const out = C.u8(64);
  for (let half = 0; half < 2; half++) {
    if (der[i] !== 0x02) throw new Error("expected DER INTEGER");
    let len = der[i + 1];
    let start = i + 2;
    while (len > 32 && der[start] === 0x00) { start++; len--; }  // strip sign padding
    if (len > 32) throw new Error("ECDSA integer longer than 32 bytes");
    out.set(der.subarray(start, start + len), half * 32 + (32 - len));
    i = i + 2 + der[i + 1];
  }
  return out;
}

module.exports = {
  encryptPayload,
  utf8Bytes,
  vapidSigningInput,
  originOf,
  derToJoseSignature,
};

// ---------------------------------------------------------------------------
// the parts Goja cannot do: P-256, and sending bytes
// ---------------------------------------------------------------------------
//
// SHELL SAFETY. Everything below runs `sh -c <script> sh <args...>`, so the
// script is a FIXED string and every variable arrives as a positional
// parameter ("$1", "$2"). This is not stylistic. `endpoint` and `p256dh` come
// straight from whatever posted to /staff/push/subscribe, and interpolating
// those into a script would be remote command execution on the server. Do not
// "simplify" these into template literals.
//
// $os.cmd(...).output() hands back a byte ARRAY (verified against PocketBase
// 0.39.11), which is what makes it safe to move raw key material and
// ciphertext through here at all — $http.send() takes a JS string and would
// UTF-8-mangle every byte above 0x7f.
//
// A non-zero exit throws GoError, so each call is wrapped by its caller.

// Goja's byte arrays are array-likes, not Uint8Arrays.
function toBytes(out) {
  const b = C.u8(out.length);
  for (let i = 0; i < out.length; i++) b[i] = out[i] & 0xff;
  return b;
}

function bytesToAscii(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

// Wraps a raw 65-byte P-256 point as a PEM public key. The prefix is the
// fixed DER SubjectPublicKeyInfo header for prime256v1 — 26 bytes, ending in
// the BIT STRING tag, then the point itself.
function pointToPem(point) {
  if (point.length !== 65) throw new Error("expected a 65-byte P-256 point, got " + point.length);
  const der = C.concat([
    C.hexToBytes("3059301306072a8648ce3d020106082a8648ce3d030107034200"),
    point,
  ]);
  const b64 = C.b64Standard(der); // wrapped at 64 columns below, as PEM requires
  let wrapped = "";
  for (let i = 0; i < b64.length; i += 64) wrapped += b64.slice(i, i + 64) + "\n";
  return "-----BEGIN PUBLIC KEY-----\n" + wrapped + "-----END PUBLIC KEY-----";
}

// One ephemeral keypair, one ECDH, one salt — a single process, because
// spawning three would triple the cost of every push for no benefit.
// Returns { asPublic (65), ecdhSecret (32), salt (16) }.
function ecdhAndSalt(uaPublic) {
  const script = [
    "set -e",
    'D=$(mktemp -d) || exit 1',
    'printf %s "$1" > "$D/peer.pem"',
    'openssl ecparam -genkey -name prime256v1 -noout -out "$D/e.pem" 2>/dev/null',
    'openssl ec -in "$D/e.pem" -pubout -outform DER 2>/dev/null | tail -c 65 > "$D/pub.bin"',
    'openssl pkeyutl -derive -inkey "$D/e.pem" -peerkey "$D/peer.pem" -out "$D/sec.bin" 2>/dev/null',
    'openssl rand 16 > "$D/salt.bin"',
    'cat "$D/pub.bin" "$D/sec.bin" "$D/salt.bin"',
    'rm -rf "$D"',
  ].join("\n");

  const out = toBytes($os.cmd("sh", "-c", script, "sh", pointToPem(uaPublic)).output());
  if (out.length !== 113) throw new Error("openssl ECDH returned " + out.length + " bytes, expected 113");
  return {
    asPublic: out.subarray(0, 65),
    ecdhSecret: out.subarray(65, 97),
    salt: out.subarray(97, 113),
  };
}

// Signs the VAPID JWT. openssl returns DER; JOSE wants raw r||s.
function signVapid(signingInput, vapidPrivatePemB64) {
  const script = [
    "set -e",
    'D=$(mktemp -d) || exit 1',
    'printf %s "$1" | base64 -d > "$D/vapid.pem"',
    'printf %s "$2" > "$D/input.txt"',
    'openssl dgst -sha256 -sign "$D/vapid.pem" "$D/input.txt"',
    'rm -rf "$D"',
  ].join("\n");

  const der = toBytes($os.cmd("sh", "-c", script, "sh", vapidPrivatePemB64, signingInput).output());
  return derToJoseSignature(der);
}

// Builds the full `Authorization: vapid t=..., k=...` value. Valid for 12
// hours — comfortably inside the 24h ceiling RFC 8292 allows, with room for
// clock skew on either side.
function vapidAuthHeader(endpoint, cfg) {
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const signingInput = vapidSigningInput(originOf(endpoint), cfg.subject, exp);
  const sig = signVapid(signingInput, cfg.privateKeyPemB64);
  return "vapid t=" + signingInput + "." + C.b64urlEncode(sig) + ", k=" + cfg.publicKey;
}

// POSTs one encrypted message. curl rather than $http.send() for the binary
// body; the body travels into the shell as base64 and is decoded there, so no
// raw bytes pass through an argv string.
//
// Returns { status, body }. Does NOT throw on an HTTP error — the caller
// decides what a 404/410 means (a dead subscription to delete) versus a 500
// (the push service having a bad day, leave the row alone).
// opts.spool: when set, the POST is DETACHED — curl is backgrounded with its
// output redirected into that file and this returns immediately, status 0.
//
// This matters more than it looks. The push fires from a stamp_requests
// create hook, which runs inside the CUSTOMER's /card/stamp/request call. A
// synchronous POST to FCM from Iran can hang until --max-time, so a blocked
// push service would add twenty seconds to the customer's tap. Detaching
// moves the whole network wait out of the request path; the trade is that the
// HTTP status is no longer available here, so dead subscriptions get reaped
// from the spool file by a cron instead (see push.pb.js).
function postPush(endpoint, body, authHeader, ttlSeconds, opts) {
  // Written as one plain string: the curl invocation has to stay on a single
  // logical line, and assembling it from an array needed escaping gymnastics
  // that were easier to get wrong than to read.
  const script =
    "set -e\n" +
    'D=$(mktemp -d) || exit 1\n' +
    'printf %s "$2" | base64 -d > "$D/body.bin"\n' +
    'code=$(curl -s -X POST -H "Authorization: $3" -H "Content-Encoding: aes128gcm" ' +
      '-H "Content-Type: application/octet-stream" -H "TTL: $4" -H "Urgency: high" ' +
      '--data-binary "@$D/body.bin" -o "$D/resp" -w "%{http_code}" --max-time 20 "$1") || code=000\n' +
    'printf "%s\\n" "$code"\n' +
    'head -c 400 "$D/resp" 2>/dev/null || true\n' +
    'rm -rf "$D"\n';

  // Detached: same request, but backgrounded with every stream redirected.
  // The redirects are load-bearing — a backgrounded curl that still holds the
  // inherited stdout would keep $os.cmd().output() blocking until it exits,
  // which is the exact thing being avoided.
  const detachedScript =
    "set -e\n" +
    'D=$(mktemp -d) || exit 1\n' +
    'printf %s "$2" | base64 -d > "$D/body.bin"\n' +
    '( curl -s -X POST -H "Authorization: $3" -H "Content-Encoding: aes128gcm" ' +
      '-H "Content-Type: application/octet-stream" -H "TTL: $4" -H "Urgency: high" ' +
      '--data-binary "@$D/body.bin" -o /dev/null -w "%{http_code} $1\\n" --max-time 20 "$1" ' +
      '>> "$5" 2>/dev/null; rm -rf "$D" ) </dev/null >/dev/null 2>&1 &\n';

  if (opts && opts.spool) {
    $os.cmd("sh", "-c", detachedScript, "sh", endpoint, C.b64Standard(body),
            authHeader, String(ttlSeconds), opts.spool).output();
    return { status: 0, body: "", detached: true };
  }

  const out = bytesToAscii(toBytes(
    $os.cmd("sh", "-c", script, "sh", endpoint, C.b64Standard(body), authHeader, String(ttlSeconds)).output()
  ));
  const nl = out.indexOf("\n");
  return {
    status: parseInt(nl < 0 ? out : out.slice(0, nl), 10) || 0,
    body: nl < 0 ? "" : out.slice(nl + 1),
  };
}

// The whole job for one subscription.
//   sub: { endpoint, p256dh, auth }   cfg: { subject, publicKey, privateKeyPemB64 }
function sendOne(sub, message, cfg, ttlSeconds, opts) {
  const uaPublic = C.b64urlDecode(sub.p256dh);
  const authSecret = C.b64urlDecode(sub.auth);
  if (uaPublic.length !== 65) throw new Error("subscription p256dh is not 65 bytes");
  if (authSecret.length !== 16) throw new Error("subscription auth is not 16 bytes");

  const k = ecdhAndSalt(uaPublic);
  const body = encryptPayload({
    plaintext: message,
    uaPublic, authSecret,
    asPublic: k.asPublic,
    ecdhSecret: k.ecdhSecret,
    salt: k.salt,
  });

  return postPush(sub.endpoint, body, vapidAuthHeader(sub.endpoint, cfg), ttlSeconds || 3600, opts);
}

module.exports.toBytes = toBytes;
module.exports.pointToPem = pointToPem;
module.exports.ecdhAndSalt = ecdhAndSalt;
module.exports.signVapid = signVapid;
module.exports.vapidAuthHeader = vapidAuthHeader;
module.exports.postPush = postPush;
module.exports.sendOne = sendOne;

// ---------------------------------------------------------------------------
// configuration and the endpoint allowlist
// ---------------------------------------------------------------------------

// Returns null when web push has not been set up, so callers can degrade
// quietly instead of throwing. Generate the keys with backend/vapid-keygen.sh.
function vapidConfig() {
  const publicKey = $os.getenv("VAPID_PUBLIC_KEY");
  const privateKeyPemB64 = $os.getenv("VAPID_PRIVATE_KEY_B64");
  const subject = $os.getenv("VAPID_SUBJECT") || "mailto:info@reloy.ir";
  if (!publicKey || !privateKeyPemB64) return null;
  return { publicKey, privateKeyPemB64, subject };
}

// WHY AN ALLOWLIST. The endpoint is chosen by whoever calls
// /staff/push/subscribe, and the server later POSTs to it. Left open, that is
// a server-side request forgery primitive: subscribe with
// http://169.254.169.254/... or an address inside the hosting network, and
// this server will dutifully send requests there on a schedule the attacker
// picks. So the host must be one a real browser would actually hand us.
//
// Shell injection is NOT what this defends against — endpoints travel as
// positional parameters, never interpolated into a script. This is purely
// about where the server can be made to connect.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge, Brave, Samsung
  /^[a-z0-9-]+\.push\.apple\.com$/,         // Safari, iOS home-screen apps
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge on Windows (WNS)
];

function allowedPushEndpoint(endpoint) {
  const url = String(endpoint || "");
  // Local dev only: the mock push service in test/ and a real device pointed
  // at this laptop. Gated on OTP_DEV_MODE so it cannot be reached in prod.
  if ($os.getenv("OTP_DEV_MODE") === "1" && /^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return true;

  const m = /^https:\/\/([a-z0-9.-]+)(?::\d+)?\//i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  for (const re of PUSH_HOSTS) if (re.test(host)) return true;
  return false;
}

// Where detached sends record their HTTP status for the reaper cron.
function spoolPath() {
  return $os.getenv("PUSH_SPOOL") || "/tmp/reloy-push-spool";
}

module.exports.vapidConfig = vapidConfig;
module.exports.allowedPushEndpoint = allowedPushEndpoint;
module.exports.spoolPath = spoolPath;
