#!/usr/bin/env bash
# Local development server.
#
# OTP_DEV_MODE=1 lets the OTP endpoints work without an SMS account: no message
# is sent, and the code is PRINTED IN THIS TERMINAL instead. Look for a line
# like:
#
#     INFO OTP (dev)
#     └─ {"code":"418302","phone":"9123334455"}
#
# then type those six digits into the app. Codes are never returned in the HTTP
# response, so there is nothing to auto-fill — reading this log is the only way
# in. Without the flag the OTP endpoints fail closed with a 503, which is
# deliberate, and is what production runs.
#
# NEVER set OTP_DEV_MODE in production: it writes live login codes to the
# server log, and lets owner sign-in complete without a real second factor.
#
#   ./dev.sh              # http://127.0.0.1:8090
#   ./dev.sh 8092         # a different port
set -euo pipefail

PORT="${1:-8090}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "port $PORT is already in use — stop that server first, or: ./dev.sh 8092" >&2
  exit 1
fi

# --publicDir points at the repo root so the frontend is served from the real
# files. backend/pb_public/ is a symlink farm that silently goes stale whenever
# a new page or script is added.
# --dev prints the hook logs (and SQL) to the console. Without it PocketBase
# files them in the logs DB only, and the OTP code above would be invisible
# here — you would have to go digging in Dashboard > Logs for every sign-in.
OTP_DEV_MODE=1 exec "$ROOT/backend/pocketbase" serve \
  --dev \
  --http="127.0.0.1:$PORT" \
  --dir="$ROOT/backend/pb_data" \
  --hooksDir="$ROOT/backend/pb_hooks" \
  --migrationsDir="$ROOT/backend/pb_migrations" \
  --publicDir="$ROOT"
