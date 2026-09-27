#!/usr/bin/env bash
# One-shot check that the SMS provider is actually configured and sending.
#
# Sends a single pattern message — the EXACT request backend/pb_hooks/sms.js
# makes — and prints the provider's raw reply. Use it to tell a working key
# apart from a key that answers 200 and quietly sends nothing, which is the
# failure mode sms.js cannot currently detect (see its TODO(faraz-body-check)).
#
# This sends a REAL SMS to a REAL phone and spends real credit. One message.
#
#   export FARAZSMS_API_KEY='...'
#   export FARAZSMS_PATTERN_CODE='...'
#   export FARAZSMS_LINE_NUMBER='...'      # required by the API, see below
#   ./sms-check.sh 09123334455
#
# The key is read from the environment and never printed, so neither it nor
# your shell history ends up holding it.
set -euo pipefail

PHONE="${1:-}"
if [ -z "$PHONE" ]; then
  echo "usage: ./sms-check.sh 09XXXXXXXXX   (your own mobile number)" >&2
  exit 2
fi
if ! [[ "$PHONE" =~ ^09[0-9]{9}$ ]]; then
  echo "phone must be 11 digits starting 09 — got: $PHONE" >&2
  exit 2
fi
: "${FARAZSMS_API_KEY:?set FARAZSMS_API_KEY first (export FARAZSMS_API_KEY='...')}"
: "${FARAZSMS_PATTERN_CODE:?set FARAZSMS_PATTERN_CODE first (export FARAZSMS_PATTERN_CODE='...')}"

# 424242 is just a visible stand-in for the 6-digit OTP; the pattern's variable
# must be named "code" (lowercase) or the provider rejects this.
#
# line_number is REQUIRED — confirmed against the live API, which answers
# 422 {"line_number":["تکمیل گزینه line number الزامی است"]} without it, even
# for pattern sends on a shared line. sms.js omits the field when the env var
# is unset, so an unset FARAZSMS_LINE_NUMBER means every send fails.
if [ -n "${FARAZSMS_LINE_NUMBER:-}" ]; then
  BODY=$(printf '{"code":"%s","attributes":{"code":"424242"},"recipient":"%s","number_format":"english","line_number":"%s"}' \
    "$FARAZSMS_PATTERN_CODE" "$PHONE" "$FARAZSMS_LINE_NUMBER")
else
  echo "!! FARAZSMS_LINE_NUMBER is not set. The API requires it and will answer 422." >&2
  echo "   Sending anyway so you can see the raw refusal." >&2
  echo >&2
  BODY=$(printf '{"code":"%s","attributes":{"code":"424242"},"recipient":"%s","number_format":"english"}' \
    "$FARAZSMS_PATTERN_CODE" "$PHONE")
fi

echo "sending one pattern SMS to $PHONE ..."
echo

HTTP=$(curl -s -w '\n__STATUS__%{http_code}' -X POST \
  https://api.iranpayamak.com/ws/v1/sms/pattern \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Api-Key: $FARAZSMS_API_KEY" \
  -d "$BODY")

STATUS="${HTTP##*__STATUS__}"
REPLY="${HTTP%$'\n'__STATUS__*}"

echo "HTTP status : $STATUS"
echo "response    : $REPLY"
echo
echo "Now check the phone."
echo "  - SMS arrived            -> the key and pattern are good."
echo "  - no SMS but status 200  -> THIS is the silent-failure case. The body"
echo "                              above says the real reason (credit, pattern,"
echo "                              recipient). Send it to Claude to fix sms.js."
echo "  - status 422             -> a required field is missing; the response"
echo "                              body names it (e.g. line_number)."
echo "  - status 401/403         -> the API key is wrong."
echo "  - other 4xx/5xx          -> pattern code or recipient is wrong."
