/// <reference path="../pb_data/types.d.ts" />

// The sweep that finishes payments whose callback never came back.
//
// WHY IT HAS TO EXIST. zarinpal.pb.js is built on the premise that the
// browser returning is the step outside our control — a closed tab, dead
// wifi, a phone that slept at the gateway, a redirect that 500s — which is
// why the payments row is written BEFORE ZarinPal is ever called. That
// premise was only half honoured: the row was created so the charge would
// stay recoverable, and then nothing ever recovered it. No cron touched
// `payments`. A row that reached `pending` and lost its callback stayed
// `pending` forever, money taken at the gateway and a subscription never
// extended, with no process anywhere that would notice.
//
// So this asks ZarinPal about every pending attempt and acts on the answer,
// through the same settle() the callback uses. Two implementations of "did
// this payment happen" is the last thing this path needs.
//
// WHY RE-ASKING IS SAFE. Verify on an already-verified authority returns 101,
// which settle() treats as the success it is, and the transaction inside it
// re-reads the row and does nothing if another caller has moved it to paid. So
// a payment cannot be granted twice no matter how often this runs or how it
// races the callback, and a café is thanked once.
//
// THE AGE WINDOW, both ends.
//
//   young  A payment seconds old is probably mid-flight: the owner is still
//          at the gateway, or the callback is in the air. Asking then would
//          mostly collect "not paid yet" and close rows that are about to
//          succeed, so nothing newer than SETTLE_AFTER_MS is touched.
//   old    An authority ZarinPal no longer recognises answers -51, which
//          settle() records as a genuine refusal — correct, and how most
//          abandoned attempts close themselves. Past GIVE_UP_MS we stop
//          asking and say so once per run, because a row still unreadable
//          after that long needs a human and a gateway dashboard, not
//          another retry every ten minutes forever.
//
// Nothing here ever writes `failed` on its own judgement. Only the gateway's
// answer closes a row; an unreadable one leaves it exactly as it was.
//
// Self-contained apart from settle.js, which it requires inside the handler —
// a cron callback gets its own goja runtime and cannot see this file's
// top-level scope.

cronAdd("payment-reconcile", "*/10 * * * *", () => {
  const SETTLE_AFTER_MS = 10 * 60 * 1000;        // leave the callback its chance
  const GIVE_UP_MS = 14 * 86400000;              // past here, a human problem
  const MAX_PER_RUN = 40;                        // each one is an outbound call

  const settle = require(`${__hooks}/settle.js`).settle;
  const now = Date.now();

  let rows = [];
  try {
    // Every pending attempt that actually reached the gateway. A row with no
    // authority never got that far — /subscription/pay refuses rather than
    // hand one over it could not record — so there is nothing to ask about.
    rows = $app.findRecordsByFilter("payments",
      "status = 'pending' && authority != ''", "created", 200, 0, {});
  } catch (err) {
    $app.logger().error("payment reconcile could not read payments", "error", String(err));
    return;
  }

  let paid = 0, failed = 0, unknown = 0, stale = 0, asked = 0;

  for (const pay of rows) {
    if (asked >= MAX_PER_RUN) break;
    try {
      // created is written by PocketBase in the space form; the T form only
      // comes from the seed scripts, and parsing tolerates both.
      const made = new Date(String(pay.getString("created")).replace(" ", "T")).getTime();
      if (!made || isNaN(made)) continue;

      const age = now - made;
      if (age < SETTLE_AFTER_MS) continue;
      if (age > GIVE_UP_MS) { stale++; continue; }

      asked++;
      const verdict = settle(pay);
      if (verdict === "paid") {
        paid++;
        // Loud on purpose: this is a café that paid, lost its callback, and
        // has been without the subscription it bought until this moment.
        $app.logger().warn("payment reconciled — a lost callback was recovered",
          "authority", pay.getString("authority"),
          "cafe", pay.getString("cafe"),
          "age_hours", Math.round(age / 3600000));
      } else if (verdict === "failed") { failed++; } else { unknown++; }
    } catch (err) {
      unknown++;
      $app.logger().error("payment reconcile failed for one row",
        "pay", pay.id, "error", String(err));
    }
  }

  if (stale) {
    // One line per run, not per row. These need somebody to open ZarinPal's
    // own dashboard and compare; repeating them individually every ten
    // minutes would bury the rest of the log.
    $app.logger().error("payments still unsettled past the give-up window — reconcile by hand",
      "count", stale, "days", Math.round(GIVE_UP_MS / 86400000));
  }

  if (asked) {
    $app.logger().info("payment reconcile",
      "asked", asked, "paid", paid, "failed", failed, "unknown", unknown, "stale", stale);
  }
});
