#!/usr/bin/env bash
# End-to-end check on the encrypted push body: encrypt in JS (as the server
# does), decrypt in Python (as the browser does). Run from the repo root.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

for text in \
  '{"title":"stamp request"}' \
  '{"title":"درخواست مهر جدید","body":"یک مشتری منتظر تأیید است"}' \
  '' \
  'x' \
  "$(python3 -c 'print("ط"*600)')"
do
  node -e '
    global.__hooks = process.cwd() + "/backend/pb_hooks";
    const crypto = require("crypto");
    const W = require("./backend/pb_hooks/webpush.js");

    const plaintext = process.argv[1];

    // stand in for a real browser subscription
    const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
    const authSecret = crypto.randomBytes(16);

    // what the server does per message: fresh ephemeral key + ECDH
    const as = crypto.createECDH("prime256v1"); as.generateKeys();
    const ecdhSecret = as.computeSecret(ua.getPublicKey());
    const salt = crypto.randomBytes(16);

    const body = W.encryptPayload({
      plaintext,
      uaPublic:   new Uint8Array(ua.getPublicKey()),
      authSecret: new Uint8Array(authSecret),
      asPublic:   new Uint8Array(as.getPublicKey()),
      ecdhSecret: new Uint8Array(ecdhSecret),
      salt:       new Uint8Array(salt),
    });

    process.stdout.write(JSON.stringify({
      body:         Buffer.from(body).toString("base64url"),
      uaPrivateHex: ua.getPrivateKey().toString("hex"),
      authSecret:   authSecret.toString("base64url"),
      plaintext,
    }));
  ' "$text" | python3 test/webpush_roundtrip.py
done

echo "round-trip: all cases decrypted"
