/// <reference path="../pb_data/types.d.ts" />

// Security fix: 1700000005 seeded an admin (owner) account whose phone and
// password were committed to the public repo, so anyone could POST /owner/login
// and get a full admin token for the "Oram" café. Neutering 1700000005 only
// protects fresh deploys — PocketBase records applied migrations in the DB, so
// it never re-runs on an existing one. This migration deletes the account from
// databases that already have it.
//
// Fallout, accepted on purpose: cafe_card.owner_user is a cascadeDelete:false
// relation, so the Oram café (linked to this user in 1700000009) is left with
// no owner and its owner-scoped rules/hooks stop resolving — no /owner/cafe,
// no reward_options writes, no analytics for that café until a real owner is
// attached by hand. Any cafe_card row is orphaned rather than deleted, which is
// the right trade: a public-credential admin token is worse than a café that
// temporarily has no admin. Customer data (memberships, discounts,
// stamp_events, stamp_requests) belongs to customer users and is untouched.

migrate((app) => {
  // by phone (what /owner/login and 1700000009 match on)
  try {
    const o = app.findFirstRecordByFilter("users", "phone = '9121234567'");
    if (o) app.delete(o);
  } catch (e) {}

  // defensively by email too, in case the phone was edited after seeding
  try {
    const o = app.findFirstRecordByFilter("users", "email = 'owner@oram.loytap'");
    if (o) app.delete(o);
  } catch (e) {}
}, (app) => {
  // no-op on purpose: never recreate an account whose credentials are public.
});
