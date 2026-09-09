/// <reference path="../pb_data/types.d.ts" />

// Bumps the `users` collection's default auth token duration from 24h to 14
// days. This ONLY affects customers in practice: owner and staff logins
// (owner.pb.js /owner/register + /owner/login/verify, staff.pb.js
// /staff/login) were switched in the same change to mint a *static* token
// via newStaticAuthToken() instead of the regular newAuthToken() — owner at
// 72h, staff at 24h — so they run on their own fixed windows regardless of
// this setting, each kept alive across visits by their own
// /owner/session/refresh or /staff/session/refresh route (owner.pb.js /
// staff.pb.js) rather than PocketBase's core auth-refresh, which can't
// extend a static token's expiry. Their tokens reach a café's whole customer
// list, analytics, rewards and staff code, so they keep a shorter session
// than customers on purpose.
//
// The customer wallet still calls user.newAuthToken() in otp.pb.js's
// /otp/verify, so it picks up this 14-day duration directly. That token is
// also still refreshable: app.js's init() already silently re-mints it via
// POST /api/collections/users/auth-refresh on every page load (see
// 1700000024_shorter_auth_token.js), so an active customer effectively never
// sees this ceiling — it only matters for someone who stays away 14+ days,
// or who clears the browser's site data (which drops the token outright,
// unrelated to its duration).
//
// Why 14 days and not longer/forever: the token lives in localStorage with
// no per-session revocation anywhere in this app (see 1700000024's own
// comment) — the only way to kill a single leaked token is deleting the
// whole account. A longer window is a proportionally longer one for a lost
// or stolen device (or a future XSS bug) to stay live. 14 days was chosen as
// the tradeoff point for a loyalty-card app with no payment data and no
// customer-initiated stamps/redemptions (those require staff to physically
// confirm — see card.pb.js), where a leaked token exposes name/phone/stamp
// history but nothing an attacker can act on unilaterally.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authToken.duration = 14 * 24 * 60 * 60; // 14 days, was 86400 (24h)
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authToken.duration = 86400;
  app.save(users);
});
