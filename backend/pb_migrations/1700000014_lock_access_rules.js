/// <reference path="../pb_data/types.d.ts" />

// Two access-control holes in the raw PocketBase REST API (the app itself
// never used these — every real cross-user feature goes through dedicated,
// properly-scoped custom endpoints in pb_hooks that check café ownership
// manually):
//
// 1. users.listRule/viewRule let ANY staff/admin (any café, anywhere) list
//    and view every user's phone number, name and role. users.deleteRule
//    let any admin delete any account. None of this was scoped to "your
//    own café" — combined with a role being attacker-controllable at
//    signup (fixed separately in otp.pb.js), this was a full data-exposure
//    and account-deletion hole reachable by anyone.
// 2. discounts.updateRule let any staff/admin (any café) directly PATCH any
//    discount record via the REST API — un-expire it, re-activate an
//    already-redeemed one, or rewrite its deal/code — bypassing every
//    same-café check the dedicated /redeem endpoint enforces.
//
// Locking both down to self-only / API-disabled doesn't remove any real
// feature: staff/owner flows (login, redeem, analytics, café management)
// all go through pb_hooks routes that use $app directly and are unaffected
// by these collection rules.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.listRule = "@request.auth.id = id";
  users.viewRule = "@request.auth.id = id";
  users.deleteRule = null;
  app.save(users);

  const discounts = app.findCollectionByNameOrId("discounts");
  discounts.updateRule = null;
  app.save(discounts);
}, (app) => {
  const STAFF = '@request.auth.role = "staff" || @request.auth.role = "admin"';
  const ADMIN = '@request.auth.role = "admin"';

  const users = app.findCollectionByNameOrId("users");
  users.listRule = "@request.auth.id = id || " + STAFF;
  users.viewRule = "@request.auth.id = id || " + STAFF;
  users.deleteRule = ADMIN;
  app.save(users);

  const discounts = app.findCollectionByNameOrId("discounts");
  discounts.updateRule = STAFF;
  app.save(discounts);
});
