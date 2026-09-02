/// <reference path="../pb_data/types.d.ts" />

// Per-phone SMS budget, split out of the code rows that spend it.
//
// WHY THIS EXISTS. The send caps used to live ON the challenge itself
// (owner_login_challenges.sends / send_window_start / last_sent). Every path
// that destroys a challenge — the 5-wrong-codes lockout, an expired code, a
// failed provider send — therefore destroyed the counters with it, handing the
// caller a brand-new budget: sends back to 1, no cooldown, another SMS out the
// door immediately. Deliberately failing five guesses was a free reset, i.e.
// the cap was unbounded in exactly the case it exists for. The budget has to
// outlive the code it paid for, so it lives in its own row.
//
// otp_codes had no cap at all: /otp/request deleted the phone's old row and
// minted a new one on every call, unlimited. Both flows now spend the same
// kind of budget row.
//
// ONE BUDGET PER (phone, purpose), NOT PER PHONE. "owner_login" sends only
// happen after a password check, so a stranger cannot spend them; "otp" sends
// are open to anyone who knows the number. Sharing one bucket would let
// anybody drain a café owner's login budget by hammering /otp/request at their
// number and lock them out of their own resend — the same reasoning that keeps
// the owner challenge behind the password in the first place.
//
// The row is never deleted by any code-lifecycle path — only pruned once its
// window is long gone (see the prune in /owner/login and /otp/request).
//
// Rules locked to nobody, exactly like otp_codes/staff_codes/nfc_tags — this is
// reachable only through $app in pb_hooks and is never read by a client.

migrate((app) => {
  const b = new Collection({ type: "base", name: "sms_budgets" });
  b.fields.add(new TextField({ name: "phone", required: true }));
  b.fields.add(new TextField({ name: "purpose", required: true }));            // "otp" | "owner_login"
  b.fields.add(new NumberField({ name: "sends", onlyInt: true, min: 0 }));     // SMS sent in the current window
  b.fields.add(new DateField({ name: "window_start" }));
  b.fields.add(new DateField({ name: "last_sent" }));                          // drives the resend cooldown
  b.fields.add(new AutodateField({ name: "created", onCreate: true }));
  b.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  b.indexes = ["CREATE UNIQUE INDEX `idx_sms_budgets_phone_purpose` ON `sms_budgets` (`phone`,`purpose`)"];
  b.listRule = null; b.viewRule = null;
  b.createRule = null; b.updateRule = null; b.deleteRule = null;
  app.save(b);

  // carry over whatever the old per-challenge counters were mid-window, so
  // upgrading doesn't hand every live challenge a fresh budget
  try {
    const live = app.findRecordsByFilter("owner_login_challenges", "phone != ''", "", 500, 0);
    for (const ch of live) {
      const row = new Record(app.findCollectionByNameOrId("sms_budgets"));
      row.set("phone", ch.getString("phone"));
      row.set("purpose", "owner_login");
      row.set("sends", ch.getInt("sends"));
      row.set("window_start", ch.get("send_window_start"));
      row.set("last_sent", ch.get("last_sent"));
      try { app.save(row); } catch (e) {}
    }
  } catch (e) {}

  // the challenge keeps only code state now; the send counters moved out
  const ch = app.findCollectionByNameOrId("owner_login_challenges");
  for (const name of ["sends", "send_window_start", "last_sent"]) {
    const f = ch.fields.getByName(name);
    if (f) ch.fields.removeById(f.id);
  }
  app.save(ch);
}, (app) => {
  try {
    const ch = app.findCollectionByNameOrId("owner_login_challenges");
    ch.fields.add(new NumberField({ name: "sends", onlyInt: true, min: 0 }));
    ch.fields.add(new DateField({ name: "send_window_start" }));
    ch.fields.add(new DateField({ name: "last_sent" }));
    app.save(ch);
  } catch (e) {}
  try { app.delete(app.findCollectionByNameOrId("sms_budgets")); } catch (e) {}
});
