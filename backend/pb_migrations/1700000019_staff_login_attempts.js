/// <reference path="../pb_data/types.d.ts" />

// POST /staff/login trades a shared café code for a staff auth token that can
// issue stamps and redeem customer discounts. Until now it had no rate limit
// and no attempt counter at all: the code is 5 characters from a 31-symbol
// alphabet behind a known prefix, so it was freely brute-forceable at line
// speed. This collection is the counter staff.pb.js keeps.
//
// Keyed by CLIENT IP, never by café or by code. Locking a café (or a code)
// would let anybody take a real café's till offline mid-service just by
// typing garbage at it — an attacker must never be able to trigger a lockout
// for someone else, so the only thing that can ever get locked out is the
// source doing the guessing.
//
// It has to be a collection, not a module-level JS variable: PocketBase runs
// each hook handler in an isolated JS runtime out of a pool (see the notes in
// otp.pb.js and card.pb.js — even sibling top-level functions are not visible
// to a handler at request time), so file-level state is not shared across
// requests and is lost on restart. Every other piece of cross-request state in
// this project (otp_codes, stamp_requests) is persisted the same way.
//
// Rules locked to nobody, exactly like staff_codes/otp_codes/nfc_tags — this
// is reachable only through $app in pb_hooks. It is never listed or read by a
// client, and leaking "this IP is 4 failures in" would itself be a hint.

migrate((app) => {
  const att = new Collection({ type: "base", name: "staff_login_attempts" });
  att.fields.add(new TextField({ name: "ip", required: true }));
  att.fields.add(new NumberField({ name: "fails", onlyInt: true, min: 0 }));      // failures in the current window
  att.fields.add(new NumberField({ name: "lockouts", onlyInt: true, min: 0 }));   // lockouts served so far → escalation
  att.fields.add(new DateField({ name: "window_start" }));
  att.fields.add(new DateField({ name: "locked_until" }));
  att.fields.add(new AutodateField({ name: "created", onCreate: true }));
  att.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true })); // drives the opportunistic prune
  att.indexes = ["CREATE UNIQUE INDEX `idx_staff_login_attempts_ip` ON `staff_login_attempts` (`ip`)"];
  att.listRule = null; att.viewRule = null;
  att.createRule = null; att.updateRule = null; att.deleteRule = null;
  app.save(att);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("staff_login_attempts")); } catch (e) {}
});
