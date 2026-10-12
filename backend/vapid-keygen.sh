#!/usr/bin/env bash
# Generates the VAPID keypair that identifies this server to the push
# services (RFC 8292). Run it ONCE per environment.
#
#   ./backend/vapid-keygen.sh > vapid.env.local     # local dev, gitignored
#   ./backend/vapid-keygen.sh                       # then paste into Liara env vars
#
# Rotating these invalidates every existing subscription: the public key is
# baked into what the browser stored at subscribe time, so every till would
# have to re-enable notifications. Generate once and keep it.
#
# The private key NEVER goes in git. It is printed base64-wrapped so it
# survives being pasted into a single-line env var field.
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl ecparam -genkey -name prime256v1 -noout -out "$TMP/vapid.pem" 2>/dev/null

# The public half goes to the browser as applicationServerKey, and to the push
# service in the Authorization header. Both want the raw 65-byte uncompressed
# point in base64url — not the DER, and not padded.
PUB_B64URL="$(openssl ec -in "$TMP/vapid.pem" -pubout -outform DER 2>/dev/null \
  | tail -c 65 | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"

PRIV_B64="$(base64 < "$TMP/vapid.pem" | tr -d '\n')"

cat <<EOF
# VAPID keys for web push — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# PRIVATE KEY: never commit, never log, never send to the client.
VAPID_PUBLIC_KEY=$PUB_B64URL
VAPID_PRIVATE_KEY_B64=$PRIV_B64
# Contact address the push service can reach you at if your pushes misbehave.
# Must be a mailto: or https: URL — some services reject anything else.
VAPID_SUBJECT=mailto:info@reloy.ir
EOF
