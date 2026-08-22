# LoyTap Backend — PocketBase

The LoyTap backend runs on **PocketBase** (single Go binary + SQLite) — chosen because it's
self-hostable on **Iranian infrastructure (Liara)**, so it's reachable inside Iran with no
sanctions issues. This folder holds the **database schema** as migrations. Auth (SMS OTP via
Kavenegar) and the stamp/redeem logic come next as `pb_hooks/`.

## Run locally

PocketBase isn't committed (it's platform-specific). Download the binary for your OS from
<https://github.com/pocketbase/pocketbase/releases> (this schema was built against **v0.39.11**),
put it in this folder, then:

```bash
./pocketbase serve
```

On first `serve` it **auto-applies the migrations** in `pb_migrations/`, creating all collections
and seeding the café config + reward pool. Open the Admin UI at <http://127.0.0.1:8090/_/> and
create your first superuser to manage data.

Useful commands: `./pocketbase migrate up` (apply), `./pocketbase migrate down 1` (revert last).

## Schema (single café · roles customer/staff/admin)

| Collection | Purpose |
|---|---|
| `users` (auth) | `name`, `phone` (unique login), `role` (customer/staff/admin), `stamp_count`, `cycles` |
| `stamp_events` | one row per stamp — audit trail + NFC rate-limiting |
| `discounts` | earned rewards: `code`, `deal`, `due_date`, `status`, `redeemed_by`, … |
| `cafe_card` | card definition — `stamps_required`, `reward_expiry_days`, `cafe_name`, `theme` |
| `reward_options` | the **weighted random reward pool** — `deal`, `weight`, `active` |
| `otp_codes` | short-lived SMS OTP codes (server only) |
| `nfc_tags` | NFC tap codes (server only) |

**Access rules (PocketBase's RLS):** customers read only their own `discounts`/`stamp_events` and
the public `cafe_card`/`reward_options`; staff/admin read all; `discounts` are redeemed by staff/admin.
**`stamp_count`, `role`, and `discounts` are never written by the client** — only by the server hooks
(next step). That's the anti-cheat foundation.

## Seeded data (edit in the Admin UI)

- `cafe_card`: Aurora Coffee · 8 stamps · 30-day expiry
- `reward_options`: `5% OFF` (weight 5), `10% OFF` (3), `15% OFF` (2), `Free coffee` (1)

Completing a card draws a **weighted-random active** reward and mints a `discounts` row.

## Deploy on Liara

Run the PocketBase binary as a Liara app with a **persistent disk** mounted at `pb_data/` (so the
SQLite DB + uploads survive restarts). Migrations auto-apply on boot. Add the **Kavenegar API key**
as an env var for the OTP hook (next step).

## Next step — `pb_hooks/` (JS)

- **OTP:** `POST /otp/request` (send code via Kavenegar) + `POST /otp/verify` (check code, find/create
  user by phone, return a session). Wires to `auth.js`.
- **Tap:** `POST /tap` — validate tag + rate-limit via `stamp_events`, `stamp_count++`, and on
  completion draw a weighted-random reward → mint a `discounts` row, reset count, `cycles++`. Wires to `app.js`.
- **Redeem:** `POST /redeem` (staff/admin) — mark a `discounts` row redeemed. Wires to `staff.js`.

## Verifying access rules (once auth exists)

With user tokens: confirm a customer cannot read another user's `discounts`, cannot `PATCH` their own
`stamp_count`/`role`, and cannot create `discounts` or `reward_options`; confirm staff can read all and
redeem. Until auth is wired, rules are stored and enforced by PocketBase but can't be exercised with a
real token.
