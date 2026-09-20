/// <reference path="../pb_data/types.d.ts" />

// "A new café just registered" — an email to whoever runs Reloy, not to the
// owner who registered.
//
// The queue this writes to, and why it is a queue rather than a direct send,
// is explained in 1700000028_mail_outbox.js. Short version: the notification
// must never be able to slow down or break the registration it reports on.
//
// NB: everything lives INSIDE each handler on purpose — pb_hooks handlers are
// re-evaluated in a pooled JSVM runtime that does NOT see this file's outer
// scope, so a module-level `const` reads back as "not defined" at request
// time (see headers.pb.js and clean-urls.pb.js for the same note).

// ---------------------------------------------------------------------------
// queue it
// ---------------------------------------------------------------------------
// cafe_card is created in exactly one place at runtime — /owner/register in
// owner.pb.js — so "a cafe_card was created" IS "an owner registered", with no
// flag to keep in sync. AfterCreateSuccess rather than AfterCreate: the record
// has really committed by then, so we can never email about a registration
// that later rolled back.
//
// Everything here is wrapped: a notification that throws would take the
// owner's registration down with it, which is exactly backwards.
onRecordAfterCreateSuccess((e) => {
  try {
    const card = e.record;
    const cafeName = card.getString("cafe_name") || "(unnamed)";

    // the owner's own details live on the linked users record, not the card
    let ownerName = "—", ownerEmail = "—", ownerPhone = "—";
    try {
      const owner = $app.findRecordById("users", card.getString("owner_user"));
      if (owner) {
        ownerName = owner.getString("name") || "—";
        ownerEmail = owner.getString("email") || "—";
        ownerPhone = owner.getString("phone") || "—";
      }
    } catch (err) {}

    let total = 0;
    try { total = $app.countRecords("cafe_card"); } catch (err) { total = 0; }

    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    const row = new Record($app.findCollectionByNameOrId("mail_outbox"));
    // NOTIFY_EMAIL so the address can change without a redeploy; the default is
    // the Cloudflare-routed info@reloy.ir, which forwards to the Gmail inbox.
    row.set("to", $os.getenv("NOTIFY_EMAIL") || "info@reloy.ir");
    row.set("subject", "New café on Reloy: " + cafeName);
    row.set("body", [
      "<h2>A new café just registered</h2>",
      "<table cellpadding='6' style='border-collapse:collapse'>",
      "<tr><td><b>Café</b></td><td>", esc(cafeName), "</td></tr>",
      "<tr><td><b>Owner</b></td><td>", esc(ownerName), "</td></tr>",
      "<tr><td><b>Email</b></td><td>", esc(ownerEmail), "</td></tr>",
      "<tr><td><b>Phone</b></td><td>", esc(ownerPhone), "</td></tr>",
      "<tr><td><b>Registered</b></td><td>", esc(new Date().toISOString()), "</td></tr>",
      "</table>",
      "<p>That makes <b>", total, "</b> café", total === 1 ? "" : "s", " on Reloy.</p>",
    ].join(""));
    row.set("sent", false);
    row.set("attempts", 0);
    $app.save(row);
  } catch (err) {
    try { $app.logger().error("could not queue the new-café notification", "err", String(err)); } catch (e2) {}
  }
}, "cafe_card");

// ---------------------------------------------------------------------------
// drain it
// ---------------------------------------------------------------------------
// Every 5 minutes rather than every minute: the recipient is a human reading
// their inbox, five minutes is not a delay anyone notices, and it keeps the
// retries gentle on a provider that may be rate-limiting us in the first place.
// Runs on the cron goroutine, not a request, so blocking on SMTP here costs
// nobody anything.
cronAdd("mail-outbox", "*/5 * * * *", () => {
  try {
    // No mail transport configured? Leave everything pending and DON'T touch
    // attempts. PocketBase falls back to the sendmail binary when smtp is off,
    // and this image (alpine, see Dockerfile) has no sendmail — so every send
    // would fail and quietly burn the retry budget of mail that is perfectly
    // deliverable once the settings are filled in.
    let smtpOn = false;
    try { smtpOn = !!$app.settings().smtp.enabled; } catch (err) { smtpOn = false; }
    if (!smtpOn) return;

    // 12 attempts at 5-minute spacing is an hour of retrying, which covers a
    // provider blip. Past that it is a configuration problem that retrying
    // cannot fix, and the row stays put with its last_error for us to read.
    let pending = [];
    try { pending = $app.findRecordsByFilter("mail_outbox", "sent = false && attempts < 12", "created", 20, 0); }
    catch (err) { pending = []; }

    for (const row of pending) {
      try {
        const msg = new MailerMessage({
          from: {
            address: $app.settings().meta.senderAddress,
            name: $app.settings().meta.senderName,
          },
          to: [{ address: row.getString("to") }],
          subject: row.getString("subject"),
          html: row.getString("body"),
        });
        $app.newMailClient().send(msg);
        row.set("sent", true);
        row.set("sent_at", new Date().toISOString().replace("T", " "));
        row.set("last_error", "");
      } catch (err) {
        row.set("attempts", row.getInt("attempts") + 1);
        row.set("last_error", String(err).slice(0, 500));
      }
      try { $app.save(row); } catch (err) {}
    }

    // Keep the table from growing forever. 30 days is long enough to answer
    // "did that notification actually go out?" after the fact.
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ");
      const old = $app.findRecordsByFilter("mail_outbox", "sent = true && sent_at < {:c}", "created", 200, 0, { c: cutoff });
      for (const row of old) { try { $app.delete(row); } catch (err) {} }
    } catch (err) {}
  } catch (err) {
    try { $app.logger().error("mail-outbox drain failed", "err", String(err)); } catch (e2) {}
  }
});
