/// <reference path="../pb_data/types.d.ts" />

// Give every café that pre-dates billing the same 30-day trial a new one gets.
//
// READ THIS BEFORE DEPLOYING. This migration starts a clock. Every café on the
// production database gets 30 days from the moment it runs, after which the
// lapse policy applies: a 7-day grace, then stamping shuts down. Cafés that
// have been running happily for months are included — that is the intent, but
// it means the deploy date, not any business decision, is what sets their
// deadline. Deploy it when someone is ready to answer the emails it will
// eventually cause.
//
// Idempotent on purpose: a café that already has a subscription row is left
// exactly as it is. Re-running this must never reset a paying café to a trial,
// and migrations get re-run on fresh databases built from scratch.
//
// Cafés with no owner_user are skipped. There is nobody to bill, nobody to
// email, and a row whose payer is empty would just be a puzzle later.
migrate((app) => {
  const cafes = app.findRecordsByFilter("cafe_card", "owner_user != ''", "created", 2000, 0, {});
  const subs = app.findCollectionByNameOrId("subscriptions");
  const trialEnds = new Date(Date.now() + 30 * 86400000).toISOString().replace("T", " ");

  let made = 0, skipped = 0;
  for (const c of cafes) {
    let existing = null;
    try { existing = app.findFirstRecordByFilter("subscriptions", "cafe = {:c}", { c: c.id }); } catch (err) { existing = null; }
    if (existing) { skipped++; continue; }

    const s = new Record(subs);
    s.set("cafe", c.id);
    s.set("owner_user", c.getString("owner_user"));
    s.set("status", "trialing");
    s.set("trial_ends", trialEnds);
    s.set("amount", 0);
    app.save(s);
    made++;
  }
  // worth a line in the log: this is the one record of which cafés were put on
  // a clock and when, and the trial_ends date cannot be derived later
  app.logger().info("backfilled trial subscriptions", "created", made, "skipped", skipped, "trial_ends", trialEnds);
}, (app) => {
  // Only removes the rows this migration could have made: trials with nothing
  // paid against them. A café that has since paid keeps its subscription —
  // rolling back a schema change must not delete somebody's money.
  const rows = app.findRecordsByFilter("subscriptions", "status = 'trialing' && amount = 0", "", 2000, 0, {});
  let removed = 0;
  for (const s of rows) {
    let paid = null;
    try { paid = app.findFirstRecordByFilter("payments", "cafe = {:c} && status = 'paid'", { c: s.getString("cafe") }); } catch (err) { paid = null; }
    if (paid) continue;
    app.delete(s);
    removed++;
  }
  app.logger().info("removed backfilled trials", "removed", removed);
});
