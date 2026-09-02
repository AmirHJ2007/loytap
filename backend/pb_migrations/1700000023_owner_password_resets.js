/// <reference path="../pb_data/types.d.ts" />

// "Forgot password" for café owners: POST /owner/forgot-password sends a
// 6-digit SMS code to the account's own phone; POST /owner/forgot-password/verify
// trades that code for setting a brand-new password. This collection is the
// pending challenge in between.
//
// A SEPARATE COLLECTION FROM owner_login_challenges, same reasoning as that
// collection's own separation from otp_codes (see 1700000020): a code minted
// here proves "you received an SMS to this owner's phone", nothing more — it
// must never also be usable to complete a normal 2FA sign-in, and a live
// login code must never double as authorization to change the password. A
// separate table can't cross by construction; a shared `purpose` column only
// works if every query remembers to filter on it.
//
// Same shape as owner_login_challenges post-1700000021: the code is stored
// HASHED (sha256 over a per-row random salt + the code), `attempts` is
// enforced (5 wrong guesses destroys the row), and SMS sends are budgeted in
// sms_budgets under purpose "owner_reset" — its own bucket, so hammering
// forgot-password can't drain (or be drained by) the owner_login budget.
//
// Rules locked to nobody, exactly like owner_login_challenges/otp_codes — this
// is reachable only through $app in pb_hooks and is never read by a client.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const rs = new Collection({ type: "base", name: "owner_password_resets" });
  rs.fields.add(new TextField({ name: "phone", required: true }));
  rs.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  rs.fields.add(new TextField({ name: "code_hash", required: true })); // sha256(salt + ":" + code) — never the code itself
  rs.fields.add(new TextField({ name: "salt", required: true }));
  rs.fields.add(new DateField({ name: "expires" }));
  rs.fields.add(new NumberField({ name: "attempts", onlyInt: true, min: 0 })); // wrong codes so far; 5 destroys the row
  rs.fields.add(new AutodateField({ name: "created", onCreate: true }));
  rs.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  // one live reset per phone — a resend updates it in place instead of
  // leaving a pile of simultaneously-valid codes lying around
  rs.indexes = ["CREATE UNIQUE INDEX `idx_owner_password_resets_phone` ON `owner_password_resets` (`phone`)"];
  rs.listRule = null; rs.viewRule = null;
  rs.createRule = null; rs.updateRule = null; rs.deleteRule = null;
  app.save(rs);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("owner_password_resets")); } catch (e) {}
});
