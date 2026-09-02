#!/usr/bin/env bash
# Local development server.
#
# OTP_DEV_MODE=1 makes every verification code come back in the HTTP response
# instead of an SMS, so you can sign in and create accounts in all three roles
# without a Kavenegar account. Without it the OTP endpoints fail closed with a
# 503 — that is deliberate, and it is what production runs.
#
# NEVER set OTP_DEV_MODE in production: it hands every phone's login code to
# anyone who asks for it.
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
OTP_DEV_MODE=1 exec "$ROOT/backend/pocketbase" serve \
  --http="127.0.0.1:$PORT" \
  --dir="$ROOT/backend/pb_data" \
  --hooksDir="$ROOT/backend/pb_hooks" \
  --migrationsDir="$ROOT/backend/pb_migrations" \
  --publicDir="$ROOT"
