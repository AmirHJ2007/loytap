/// <reference path="../pb_data/types.d.ts" />

// SEC-14: tokens are stored in localStorage (readable by any script that
// executes on the page — the CSP added in 1700000012_security_headers.js
// closes off the injection paths that would let a script get there, but
// doesn't change anything once one does) and PocketBase's default
// authToken.duration was never overridden, leaving it at 432000s = 5 days.
// A real fix is moving auth off localStorage entirely (httpOnly cookies) —
// a bigger change to how every request in the app authenticates, not done
// here. Short of that, cutting the token lifetime shrinks the window a
// stolen token is worth anything, cheaply and with no flow changes: the
// customer wallet already silently re-mints its token on every page load
// (see the /api/collections/users/auth-refresh call in app.js's init()),
// so a signed-in customer who opens the app at least once a day never
// notices; owner/staff sessions that go a full day idle will need to sign
// in again.
//
// (The other half of SEC-14 — "revoke tokens when an account is removed" —
// needs no code: PocketBase's own auth middleware re-loads the record on
// every request and 401s the moment it's gone, verified live against a
// scratch DB by deleting a signed-in user's row mid-session and confirming
// their still-unexpired token was immediately rejected everywhere, not
// just on routes that touch that record directly.)

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authToken.duration = 86400; // 24h, was the PocketBase default of 432000 (5 days)
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authToken.duration = 432000;
  app.save(users);
});
