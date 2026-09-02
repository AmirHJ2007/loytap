/// <reference path="../pb_data/types.d.ts" />

// Owner login is now two-factor: POST /owner/login validates the password and
// only *sends* a 6-digit SMS code; POST /owner/login/verify trades that code
// for the owner token. This collection is the pending challenge in between.
//
// WHY A SEPARATE COLLECTION INSTEAD OF REUSING otp_codes:
// otp_codes is keyed by phone alone and has no notion of what a code is *for*.
// /otp/request mints rows there for the PASSWORDLESS customer sign-in flow,
// and /owner/register consumes the same rows. If owner 2FA read otp_codes, a
// code obtained with no password at all (customer sign-in) would satisfy owner
// verification — the second factor would be worth nothing. A `purpose` column
// would also work, but only if every existing query on otp_codes gained a
// `purpose = ...` clause; miss one and the two flows silently cross again. A
// separate table cannot cross by construction: no filter on otp_codes can ever
// return an owner challenge and no filter here can ever return a customer OTP,
// and otp.pb.js / owner.pb.js's /owner/register keep working byte-identical.
//
// The code is stored HASHED (sha256 over a per-row random salt + the code), so
// a dump of this table doesn't hand over live second factors — unlike
// otp_codes.code_hash, which is named for a hash but holds plaintext.
//
// `attempts` is enforced, not decorative: owner.pb.js destroys the challenge on
// the 5th wrong code, so a 6-digit code gets 5 guesses, not unlimited ones.
//
// `sends` / `send_window_start` cap SMS per phone. The row is only ever created
// AFTER the password validates, so a stranger who only knows an owner's number
// can neither burn the café's SMS credit nor lock the owner out of a resend.
// SUPERSEDED by 1700000021_sms_budgets.js — keeping the counters here meant
// every path that destroys a challenge also reset the cap. They now live in
// sms_budgets and 21 drops these three columns; see the note there.
//
// Rules locked to nobody, exactly like otp_codes/staff_codes/nfc_tags — this is
// reachable only through $app in pb_hooks and is never read by a client.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const ch = new Collection({ type: "base", name: "owner_login_challenges" });
  ch.fields.add(new TextField({ name: "phone", required: true }));
  ch.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  ch.fields.add(new TextField({ name: "code_hash", required: true })); // sha256(salt + ":" + code) — never the code itself
  ch.fields.add(new TextField({ name: "salt", required: true }));
  ch.fields.add(new DateField({ name: "expires" }));
  ch.fields.add(new NumberField({ name: "attempts", onlyInt: true, min: 0 }));           // wrong codes so far; 5 destroys the row
  ch.fields.add(new NumberField({ name: "sends", onlyInt: true, min: 0 }));              // SMS sent in the current send window
  ch.fields.add(new DateField({ name: "send_window_start" }));
  ch.fields.add(new DateField({ name: "last_sent" }));                                   // drives the resend cooldown
  ch.fields.add(new AutodateField({ name: "created", onCreate: true }));
  ch.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  // one live challenge per phone — a resend updates it in place instead of
  // leaving a pile of simultaneously-valid codes lying around
  ch.indexes = ["CREATE UNIQUE INDEX `idx_owner_login_challenges_phone` ON `owner_login_challenges` (`phone`)"];
  ch.listRule = null; ch.viewRule = null;
  ch.createRule = null; ch.updateRule = null; ch.deleteRule = null;
  app.save(ch);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("owner_login_challenges")); } catch (e) {}
});
