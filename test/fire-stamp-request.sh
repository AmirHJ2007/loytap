#!/usr/bin/env bash
# Pretends a customer tapped the café's tag, so a stamp request lands on the
# till — which is what fires a push notification.
#
#   ./test/fire-stamp-request.sh              # Oram's DEVTAG, default customer
#   ./test/fire-stamp-request.sh 9100300003   # as a different demo customer
#
# Needs ./dev.sh running (it reads the OTP out of the server log, which only
# exists in OTP_DEV_MODE).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

API="${API:-http://127.0.0.1:8090}"
TAG="${TAG:-DEVTAG}"
PHONE="${1:-9100300001}"
LOG="${DEV_LOG:-/tmp/reloy-dev.log}"

[ -f "$LOG" ] || { echo "no server log at $LOG — is ./dev.sh running (and logging there)?" >&2; exit 1; }

curl -s -X POST "$API/otp/request" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" > /dev/null
sleep 1

CODE="$(grep -o '"code":"[0-9]\{6\}"' "$LOG" | tail -1 | grep -o '[0-9]\{6\}')"
[ -n "$CODE" ] || { echo "no OTP found in $LOG — is OTP_DEV_MODE on?" >&2; exit 1; }

TOKEN="$(curl -s -X POST "$API/otp/verify" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')"
[ -n "$TOKEN" ] || { echo "could not sign the demo customer in" >&2; exit 1; }

curl -s -X POST "$API/card/stamp/request" -H "Authorization: $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("stamp request:", d.get("request_id") or d.get("error"), "| expires in", d.get("expires_in","?"), "s")'
