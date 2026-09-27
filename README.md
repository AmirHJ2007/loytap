# Reloy — café loyalty cards

A phone-first loyalty wallet for cafés. Customers collect stamps on an
Apple-Wallet-style card; staff approve each stamp from a till device; owners
run their café — branding, stamp count, rewards, stats — from a dashboard.

Persian (RTL) by default, English available. One PocketBase binary serves both
the API and the frontend from a single origin.

## Running it locally

```bash
./dev.sh              # http://127.0.0.1:8090
./dev.sh 8092         # a different port
```

`dev.sh` sets `OTP_DEV_MODE=1`, so you can sign in without an SMS account: no
message is sent and **the verification code is printed in the terminal**. Look
for

```
INFO OTP (dev)
└─ {"code":"418302","phone":"9123334455"}
```

and type those six digits into the app. Codes are never returned in an HTTP
response, in any mode — reading the log is the only way in. See `otp.pb.js`.

## The three roles

| Role | Signs in with | Page |
|---|---|---|
| **Customer** | phone + SMS code | `/` |
| **Staff** | the café's shared code (no OTP) | `/staff` |
| **Owner** | phone + password + SMS code | `/business/signin` → `/owner` |

Customer and owner accounts are separate identities even on the same phone
number. Staff sign in as their café's service account, deliberately without an
OTP — the till is shared, so there is no personal phone to send one to.

## Layout

```
*.html  *.js  *.css        frontend, served straight from the repo root
i18n.js                    every user-facing string, en + fa
backend/pb_hooks/          server logic (see below)
backend/pb_migrations/     schema, applied automatically in order
Dockerfile  liara.json     deployment
sms-check.sh               one-shot SMS provider test
```

### Hooks

| File | What it does |
|---|---|
| `otp.pb.js` | customer sign-in/registration codes |
| `owner.pb.js` | owner register, login (2FA), password reset, café settings |
| `staff.pb.js` | staff login by café code, with per-IP lockout |
| `card.pb.js` | stamp request/confirm/cancel |
| `redeem.pb.js` | reward redemption |
| `stats.pb.js` | owner dashboard figures |
| `sms.js` | the one place an OTP leaves the building |
| `notify.pb.js` | outbound email |
| `guard.pb.js`, `rule_guard.pb.js` | collection access rules, re-asserted at boot |
| `trustedproxy.pb.js`, `devmode.pb.js` | boot-time configuration alarms |

Hook files run in isolated JS runtimes and cannot see each other's scope, which
is why small helpers are repeated rather than shared. `sms.js` is `require()`d,
not a hook, so it is the exception.

## Environment

| Variable | Purpose |
|---|---|
| `FARAZSMS_API_KEY` | SMS provider key (primary) |
| `FARAZSMS_PATTERN_CODE` | approved pattern; its variable must be named `code` |
| `FARAZSMS_LINE_NUMBER` | **required** — the sender line, shared lines included |
| `KAVENEGAR_API_KEY` | fallback provider, used only if Faraz is unset |
| `OTP_MAX_SENDS_PER_DAY` | total SMS ceiling, default 300 — a cost brake |
| `OTP_MAX_SENDS_PER_IP` | per-IP hourly cap, default 15 |
| `OTP_DEV_MODE` | **local only.** Never set in production |

With no provider configured the OTP endpoints fail closed with a 503. That is
deliberate: a missing key must never downgrade sign-in.

Test the provider without touching the app:

```bash
export FARAZSMS_API_KEY=... FARAZSMS_PATTERN_CODE=... FARAZSMS_LINE_NUMBER=...
./sms-check.sh 09123334455
```

## Deployment

Liara, app `reloy`, at https://reloy.ir. `git push` does not deploy — run
`liara deploy`. `pb_data/` lives on a mounted disk and survives redeploys.

Two settings live in the PocketBase admin (`/_/`), not in code, and both matter:

- **IP proxy headers** — must be enabled, header `X-Forwarded-For`, priority
  **rightmost**. Without it every visitor shares one apparent IP: the per-IP SMS
  cap becomes a single global bucket and one wrong café code locks out every
  café at once. `trustedproxy.pb.js` warns at boot if it is unset.
- **`OTP_DEV_MODE` must not be present** in the environment variables.

Frontend assets are cache-busted with `?v=N` query strings. **Bump them when you
change a file** — a stale `i18n.js` paired with a fresh `auth.js` breaks sign-in
outright, because the newer file calls helpers the cached one does not have.

## Conventions worth knowing

- **Errors carry a stable `code` as well as English text.** The client
  translates by code via `tErr()` in `i18n.js` and falls back to the server's
  text for anything it does not recognise. Add a code and both `en` and `fa`
  entries whenever you add an error.
- **Rate limits are spent before the action, not after**, so a forced failure
  buys no free retry. The daily SMS ceiling is the exception — it counts only
  accepted sends, because it bounds money rather than abuse.
- **Comments explain why, not what.** Several of them are load-bearing security
  reasoning; if one looks wrong, verify before deleting it.
