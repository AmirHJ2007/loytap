# Project conventions

## The brand name

- **English: `Reloy`** — capital R, nothing else. Not "ReLoy", not "reloy" in prose.
- **Persian: `ریلوی`** — this exact spelling.

`رِلوی` is **wrong**. It is a plausible-looking transliteration and the easy
mistake to make, since the English spelling has no "i" in it. It is not the
brand. The correct form carries the ی: **ریلوی**.

`for-business.js` is the reference — the name appears there many times in
customer-facing Persian copy and is correct throughout. Match it.

The domain is `reloy.ir`, and the product was previously called LoyTap and
Oram; both names survive in older identifiers (`loytap_schema`, the `oram-*`
image files). Those are history, not something to propagate into new code or
new user-facing text.

## Numerals in Persian text

Persian copy uses **Western digits (0-9), not Persian-Indic digits (۰-۹)**, in
both languages. This is deliberate and stated at the top of `i18n.js`. So a
date renders as `26 مهر 1405`, never `۲۶ مهر ۱۴۰۵`.

Applies everywhere user-facing: the panel, the customer card, emails.

## Right-to-left text

Never judge RTL layout by reading transcribed text — terminal and tool output
reorders bidirectional strings, so the order you read is not the order on
screen. Verify by measuring rendered positions (`getBoundingClientRect`) or by
looking at a screenshot.

Two specific traps:

- A Latin-digit time like `09:15` inside an RTL cell renders as `15:09` unless
  that element carries its own `dir="ltr"`.
- Chart SVGs are laid out LTR; Persian labels inside them need a bidi isolate
  rather than a direction flip.

## Timestamps in the database

The `created` columns hold **two spellings of the same instant**: PocketBase
writes `2026-09-22 07:57:28.000Z` (space), while rows inserted directly by the
seed scripts carry `2026-09-22T07:57:28.000Z` (T).

A PocketBase datetime filter is a **string** comparison, and `T` (0x54) sorts
above the space (0x20). So a T-form row inside a day compares as greater than
that day's upper bound and silently disappears from the result — no error, just
a short answer — and sorts into the wrong place.

When filtering a date range, widen the filter by a day on each side and apply
the exact boundary and any ordering in JS on parsed timestamps. See
`backend/pb_hooks/dailyreport.js`.

## PocketBase hook scope

Every handler runs in its own goja runtime and **cannot see its own file's
top-level scope**. A helper declared beside a `routerAdd` or `cronAdd` is not
defined by the time the handler runs; it fails at request time, not at load
time, and surfaces as a bare 400.

Shared code goes in a plain `.js` (no `.pb.js`) and is `require`d *inside* each
handler: `require(`${__hooks}/webpush.js`)`. See `push.pb.js`, `daily.pb.js`.

## Time zone

The container is Alpine with no `tzdata` and no `TZ` set, so the server clock is
**UTC** and PocketBase schedules crons on UTC. Tehran is a fixed **+3:30** with
no DST (Iran abolished it in 2022). Midnight Tehran is `30 20 * * *`.

Prefer deriving "which day" from `Date.now()` plus the offset rather than from
when a cron happened to fire — a late or retried run then still reports the
right day.
