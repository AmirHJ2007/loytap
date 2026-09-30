/// <reference path="../pb_data/types.d.ts" />

// POST /owner/login checked the password with nothing counting failures: no
// per-IP lockout, no per-account lockout, and PocketBase's own rate limiter
// left disabled. Verified against production before this migration — 25 login
// attempts in about two seconds were all served, and a 60-request burst on
// /api/health returned 60 x 200. An owner's password was freely guessable at
// line speed, against a 6-character minimum.
//
// The SMS second factor meant this was never account takeover on its own, but
// three things made it worth closing first: the owner gets NO signal while it
// happens (nothing is sent until the password validates, so their phone stays
// silent through every wrong guess), a 6-character floor invites passwords a
// few hours of guessing will find, and a café owner's password is very likely
// their email password too — a loss entirely outside this app's reach.
//
// This collection is the counter owner.pb.js keeps. It is a deliberate copy of
// staff_login_attempts (1700000019) rather than a shared table: the unique
// index there is on `ip` alone, and merging the two would mean a staff member
// fumbling the café code at the till could lock the owner out of the dashboard
// — and the reverse. Two guessers, two budgets, no way for either to spend the
// other's.
//
// Keyed by CLIENT IP, never by phone or account, for the reason spelled out in
// 1700000019: a counter keyed on the victim lets anyone lock a real owner out
// of their own café by typing garbage at it. The only thing that can ever get
// locked out is the source doing the guessing.
//
// Rules locked to nobody, like staff_login_attempts and otp_codes — reachable
// only through $app inside pb_hooks. Leaking "this IP is 4 failures in" would
// itself tell a guesser how much budget is left.

migrate((app) => {
  const att = new Collection({ type: "base", name: "owner_login_attempts" });
  att.fields.add(new TextField({ name: "ip", required: true }));
  att.fields.add(new NumberField({ name: "fails", onlyInt: true, min: 0 }));      // failures in the current window
  att.fields.add(new NumberField({ name: "lockouts", onlyInt: true, min: 0 }));   // lockouts served so far → escalation
  att.fields.add(new DateField({ name: "window_start" }));
  att.fields.add(new DateField({ name: "locked_until" }));
  att.fields.add(new AutodateField({ name: "created", onCreate: true }));
  att.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true })); // drives the opportunistic prune
  att.indexes = ["CREATE UNIQUE INDEX `idx_owner_login_attempts_ip` ON `owner_login_attempts` (`ip`)"];
  att.listRule = null; att.viewRule = null;
  att.createRule = null; att.updateRule = null; att.deleteRule = null;
  app.save(att);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("owner_login_attempts")); } catch (e) {}
});
