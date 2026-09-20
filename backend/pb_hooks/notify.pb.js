/// <reference path="../pb_data/types.d.ts" />

// "A new café just registered" — an email to whoever runs Reloy, not to the
// owner who registered. Carries what you need to actually onboard them: the
// staff code and the URL to write to their NFC tag.
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
// HOOKED ON nfc_tags, NOT cafe_card. /owner/register writes its records in a
// fixed order (owner.pb.js): users, users, cafe_card, staff_codes,
// reward_options, nfc_tags. The café card comes third, so a hook there fires
// before the staff code and the tag exist and cannot report either — which is
// the whole point of this email. The tag is written last, so by the time it
// lands every piece of the café is on disk.
//
// AfterCreateSuccess rather than AfterCreate: the record has really committed
// by then, so we can never email about a registration that later rolled back.
//
// Guarded on being the café's FIRST tag. Today /owner/register is the only
// code that creates one, so one tag means one registration — but if a
// "add another tag" feature ever lands, this keeps it from announcing a café
// that registered months ago.
//
// Everything here is wrapped: a notification that throws would take the
// owner's registration down with it, which is exactly backwards.
onRecordAfterCreateSuccess((e) => {
  try {
    const tag = e.record;
    const cafeId = tag.getString("cafe");
    if (!cafeId) return;

    // second or later tag for this café — not a registration
    let tagCount = 0;
    try { tagCount = $app.countRecords("nfc_tags", $dbx.hashExp({ cafe: cafeId })); } catch (err) { tagCount = 1; }
    if (tagCount > 1) return;

    let cafeName = "(unnamed)";
    let ownerName = "—", ownerEmail = "—", ownerPhone = "—";
    try {
      const card = $app.findRecordById("cafe_card", cafeId);
      if (card) {
        cafeName = card.getString("cafe_name") || "(unnamed)";
        const owner = $app.findRecordById("users", card.getString("owner_user"));
        if (owner) {
          ownerName = owner.getString("name") || "—";
          ownerEmail = owner.getString("email") || "—";
          ownerPhone = owner.getString("phone") || "—";
        }
      }
    } catch (err) {}

    let staffCode = "—";
    try {
      const sc = $app.findFirstRecordByFilter("staff_codes", "cafe = {:c}", { c: cafeId });
      if (sc) staffCode = sc.getString("code");
    } catch (err) {}

    // The tap URL the café's NFC tag has to carry. reloy.ir rather than
    // app.reloy.ir on purpose: index.guard.js lets a ?t= code override the
    // marketing-site redirect, so a tap reaches the wallet even signed out.
    const tapUrl = "https://reloy.ir/?t=" + tag.getString("code");

    let total = 0;
    try { total = $app.countRecords("cafe_card"); } catch (err) { total = 0; }

    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    const row = new Record($app.findCollectionByNameOrId("mail_outbox"));
    // NOTIFY_EMAIL so the address can change without a redeploy.
    row.set("to", $os.getenv("NOTIFY_EMAIL") || "info@reloy.ir");
    row.set("subject", "New café on Reloy: " + cafeName);
    row.set("body", [
      "<h2>A new café just registered</h2>",
      "<table cellpadding='6' style='border-collapse:collapse'>",
      "<tr><td><b>Café</b></td><td>", esc(cafeName), "</td></tr>",
      "<tr><td><b>Owner</b></td><td>", esc(ownerName), "</td></tr>",
      "<tr><td><b>Email</b></td><td>", esc(ownerEmail), "</td></tr>",
      "<tr><td><b>Phone</b></td><td>", esc(ownerPhone), "</td></tr>",
      "<tr><td><b>Staff code</b></td><td><code>", esc(staffCode), "</code></td></tr>",
      "<tr><td><b>Registered</b></td><td>", esc(new Date().toISOString()), "</td></tr>",
      "</table>",
      "<h3>Write this to their NFC tag</h3>",
      "<p><a href='", esc(tapUrl), "'>", esc(tapUrl), "</a></p>",
      "<p style='color:#666'>Treat that link as a secret — anyone holding the code can trigger a stamp for this café without the tag.</p>",
      "<p>That makes <b>", total, "</b> café", total === 1 ? "" : "s", " on Reloy.</p>",
    ].join(""));
    row.set("sent", false);
    row.set("attempts", 0);
    $app.save(row);
  } catch (err) {
    try { $app.logger().error("could not queue the new-café notification", "err", String(err)); } catch (e2) {}
  }
}, "nfc_tags");

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
