/// <reference path="../pb_data/types.d.ts" />

// A queue for the mail this app sends itself — right now just the "a new café
// registered" notification (see notify.pb.js).
//
// WHY A QUEUE AND NOT A DIRECT SEND. The obvious version emails from inside
// /owner/register, and it is the wrong shape for two reasons.
//
// First, latency lands on the person registering. An SMTP handshake is a
// round trip to Gmail from a server in Iran, and if those packets are dropped
// rather than refused the socket does not fail fast — it hangs until the dial
// times out. The registration request would hang with it. A notification that
// nobody is waiting for must never be able to stall the thing it reports on.
//
// Second, there is no second chance. Gmail's SMTP is not reliably reachable
// from Iranian server IPs; a send that fails inline is simply lost, and the
// one event this whole feature exists for is the one we would miss. A row in
// a table survives the failure and gets retried.
//
// So the hook writes a row (a local SQLite insert, microseconds) and a cron
// job drains it. If the SMTP settings are wrong, or Gmail is blocked that
// week, the rows sit here pending and go out the moment it works again —
// nothing is dropped, and the table itself is the log of what happened.
//
// Rules locked to nobody, like sms_budgets/otp_codes/staff_codes: this is
// reachable only through $app in pb_hooks and is never read by a client. It
// holds no secrets, but it does hold every new café's name and the owner's
// email, so it stays off the public API.

migrate((app) => {
  const c = new Collection({ type: "base", name: "mail_outbox" });
  c.fields.add(new TextField({ name: "to", required: true }));
  c.fields.add(new TextField({ name: "subject", required: true }));
  c.fields.add(new EditorField({ name: "body" }));                          // html
  c.fields.add(new BoolField({ name: "sent" }));                            // false until delivered
  c.fields.add(new DateField({ name: "sent_at" }));
  // Counts only attempts that actually reached a mail server and failed. A
  // run skipped because SMTP is not configured yet does NOT increment it, so
  // turning SMTP on later still delivers the backlog instead of finding it
  // already burnt through its retries.
  c.fields.add(new NumberField({ name: "attempts", onlyInt: true, min: 0 }));
  c.fields.add(new TextField({ name: "last_error" }));
  c.fields.add(new AutodateField({ name: "created", onCreate: true }));
  c.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  // the drain query is "unsent, oldest first"
  c.indexes = ["CREATE INDEX `idx_mail_outbox_sent_created` ON `mail_outbox` (`sent`,`created`)"];
  c.listRule = null; c.viewRule = null;
  c.createRule = null; c.updateRule = null; c.deleteRule = null;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("mail_outbox");
  app.delete(c);
});
