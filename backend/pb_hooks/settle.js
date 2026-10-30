/// <reference path="../pb_data/types.d.ts" />

// Asking ZarinPal whether a payment happened, and acting on the answer.
//
// WHY THIS IS A MODULE AND NOT A BLOCK INSIDE THE CALLBACK. Two things need
// to settle a payment, not one. The callback runs when the owner's browser
// comes back — and that is the path that is NOT guaranteed to happen: a
// closed tab, dead wifi, a phone that slept, a redirect that 500s. The whole
// file around this one is arranged on the assumption that it may never
// arrive, which is why the payments row is written before the gateway is
// ever called.
//
// Until now nothing acted on that assumption. No cron touched `payments`, so
// a row that reached `pending` and lost its callback stayed `pending`
// forever: money taken at the gateway, subscription never extended, and no
// process anywhere that would notice. reconcile.pb.js is that process, and it
// has to reach exactly the same verdict as the callback by running the same
// code — a second implementation of "did this payment happen" is the last
// thing this path needs.
//
// WHAT settle() PROMISES
//
//   "paid"     ZarinPal confirmed it. The row is paid, the subscription is
//              extended, and a receipt is queued — once, even if two callers
//              race, because the transaction re-reads the row and the receipt
//              hangs off the same guard.
//   "failed"   ZarinPal answered and said no. Definitive; the row is closed.
//   "unknown"  We could not get a readable answer. NOTHING is written. The
//              row stays pending and stays recoverable, which is the only
//              honest thing to do when the money may have moved.
//
// It never throws. A caller gets a verdict or "unknown", because the one
// outcome worse than not knowing is a handler dying halfway through.

const MONTH_MS = 30 * 86400000;
const YEAR_MS = 365 * 86400000;

// The gateway and merchant a payment was STARTED against, not whatever the
// environment says now. A restart, redeploy or rotated key between the
// request and the answer used to mean charging one gateway and then asking a
// different one whether it happened. Each falls back to the environment
// independently, for rows written before 1700000041/42 — that is the
// behaviour those rows were created under.
function credentials(pay) {
  const envSandbox = $os.getenv("ZARINPAL_SANDBOX") === "1";
  const envMerchant = $os.getenv("ZARINPAL_MERCHANT_ID") || "";
  const wasGateway = pay.getString("gateway");
  const wasMerchant = pay.getString("merchant");

  const sandbox = wasGateway ? wasGateway === "sandbox" : envSandbox;

  if ((!!wasGateway && (wasGateway === "sandbox") !== envSandbox) ||
      (!!wasMerchant && wasMerchant !== envMerchant)) {
    // The merchant id itself is never logged — it is the account identifier
    // every request is signed with, and logs travel further than the database
    // does. Whether it moved is all a reader needs.
    $app.logger().warn("zarinpal credentials changed since this payment was started",
      "authority", pay.getString("authority"),
      "gateway_then", wasGateway || "(unrecorded)",
      "gateway_now", envSandbox ? "sandbox" : "live",
      "merchant_changed", !!wasMerchant && wasMerchant !== envMerchant);
  }

  return {
    merchant: wasMerchant || envMerchant,
    base: sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com",
  };
}

// "ZarinPal said no" and "we could not read the answer" are different facts.
// $http.send only throws when the connection itself fails, so a 502 carrying
// an HTML error page arrives as a perfectly ordinary response. An answer
// counts as read only on 2xx, a parsed body, and a number we recognise —
// data.code on success, errors.code on a real rejection (a decline arrives as
// errors.code -51 with no data.code, and is a genuine refusal).
function ask(pay) {
  const authority = pay.getString("authority");
  const cred = credentials(pay);

  let res = null;
  try {
    res = $http.send({
      url: cred.base + "/pg/v4/payment/verify.json",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 20,
      // against the amount WE recorded at request time, never anything that
      // came back with the browser
      body: JSON.stringify({
        merchant_id: cred.merchant,
        amount: pay.getInt("amount") * 10,      // Toman -> Rial
        authority: authority,
      }),
    });
  } catch (err) {
    $app.logger().error("zarinpal verify unreachable", "authority", authority);
    return { verdict: "unknown" };
  }

  let body = null;
  try { body = JSON.parse(res.raw); } catch (err) { body = null; }
  const data = (body && body.data) || {};
  const code = Number(data.code);
  const errRaw = body && body.errors ? body.errors.code : undefined;
  const errCode = (errRaw === undefined || errRaw === null) ? NaN : Number(errRaw);

  const httpOk = !!res && res.statusCode >= 200 && res.statusCode < 300;
  if (!(httpOk && body !== null && (isFinite(code) || isFinite(errCode)))) {
    $app.logger().error("zarinpal verify answer could not be read; payment left pending",
      "authority", authority,
      "http", res ? String(res.statusCode) : "(none)",
      "parsed", String(body !== null),
      "cafe", pay.getString("cafe"));
    return { verdict: "unknown" };
  }

  // 100 = verified now. 101 = verified before, which is a success we have
  // simply already been told about — and the answer a retry gets, which is
  // what makes reconciling safe to run as often as we like.
  if (code === 100 || code === 101) {
    return { verdict: "paid", refId: String(data.ref_id || "") };
  }

  return { verdict: "failed", code: isFinite(errCode) ? String(errCode) : String(code) };
}

// Moves the row to paid and extends the subscription, in one transaction, and
// returns what a receipt would need — or null when another caller got there
// first. Hanging the receipt off that same guard is what makes a café thanked
// once rather than twice.
function grant(pay, refId, now) {
  let receipt = null;

  $app.runInTransaction((tx) => {
    const p = tx.findRecordById("payments", pay.id);
    if (p.getString("status") === "paid") return;      // raced with another settler
    p.set("status", "paid");
    p.set("ref_id", refId);
    p.set("paid_at", now.toISOString().replace("T", " "));
    tx.save(p);

    const cafeId = p.getString("cafe");
    let s = null;
    try { s = tx.findFirstRecordByFilter("subscriptions", "cafe = {:c}", { c: cafeId }); } catch (err) { s = null; }
    if (!s) {
      s = new Record(tx.findCollectionByNameOrId("subscriptions"));
      s.set("cafe", cafeId);
      s.set("owner_user", p.getString("owner_user"));
    }

    // WHERE THE NEW PERIOD STARTS. Three cases, and the middle one is the
    // policy this product actually sells:
    //
    //   before the end    from the old end date. Buying early never throws
    //                     away time already held.
    //   inside the grace  ALSO from the old end date. The grace days are a
    //                     courtesy, not free service: a café that renews on
    //                     day 6 of a 7-day grace gets the remaining 24 of
    //                     its month, not a fresh 30. This is what the grace
    //                     letter has always told them, in those words.
    //   after shutdown    from today. The grace ran out, stamping stopped,
    //                     and what they are buying is a new start rather
    //                     than the tail of an old period.
    //
    // The condition is therefore "is the clock still running", not "is the
    // end date in the future" — and the clock runs until the end date plus
    // the grace. It used to test `prev > now`, which collapsed the middle
    // case into the last one and handed every late payer a full period from
    // the day they paid. Lapsing was cheaper than renewing, repeatably, and
    // the letter promising otherwise was the only thing that was accurate.
    //
    // Both values come from grace.js, for the same reason the gate's do.
    const G = require(`${__hooks}/grace.js`);
    const prev = G.deadlineMs(s);
    const from = (prev && now.getTime() < prev + G.GRACE_MS) ? prev : now.getTime();
    const end = new Date(from + (p.getString("plan") === "yearly" ? YEAR_MS : MONTH_MS));

    s.set("status", "active");
    s.set("plan", p.getString("plan"));
    s.set("current_period_end", end.toISOString().replace("T", " "));
    s.set("amount", p.getInt("amount"));
    tx.save(s);

    receipt = {
      cafeId: cafeId,
      ownerId: p.getString("owner_user"),
      plan: p.getString("plan"),
      amount: p.getInt("amount"),
      refId: refId,
      endMs: end.getTime(),
    };
  });

  return receipt;
}

// Queued after the transaction commits, never inside it: queueing inside
// would send a receipt for a payment a rollback then threw away, and mail
// cannot be unsent. Wrapped whole and never allowed to throw — the money has
// moved and the subscription is already extended by here, so an owner must
// land on a working panel even if the mail system is broken. A failure costs
// a receipt; the row still holds every number it would have carried.
function queueReceipt(receipt, now) {
  try {
    const mail = require(`${__hooks}/submail.js`);

    let owner = null;
    try { owner = $app.findRecordById("users", receipt.ownerId); } catch (err) { owner = null; }
    const to = owner ? String(owner.getString("email") || "").trim() : "";

    let cafeName = "";
    try { cafeName = $app.findRecordById("cafe_card", receipt.cafeId).getString("cafe_name"); } catch (err) { cafeName = ""; }

    if (!to) {
      // Not an error: some owner rows carry a placeholder address. Logged
      // because a café that paid and got no receipt is worth knowing about.
      $app.logger().warn("payment receipt skipped, no owner email",
        "cafe", receipt.cafeId, "ref", receipt.refId);
      return;
    }

    const shown = require(`${__hooks}/jalali.js`).faDate;
    // 3000000 -> "3,000,000". The owner is checking this against a bank SMS,
    // so it has to be groupable at a glance.
    const grouped = String(receipt.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const origin = $os.getenv("APP_ORIGIN") || "https://reloy.ir";

    const letter = mail.paymentReceipt({
      cafe: cafeName,
      planLabel: receipt.plan === "yearly" ? "سالانه" : "ماهانه",
      amount: grouped,
      paidAt: shown(now.getTime()),
      refId: receipt.refId || "—",
      endDate: shown(receipt.endMs),
      url: origin + "/owner",
    });

    const row = new Record($app.findCollectionByNameOrId("mail_outbox"));
    row.set("to", to);
    row.set("subject", letter.subject);
    row.set("body", letter.body);
    row.set("sent", false);
    row.set("attempts", 0);
    $app.save(row);
  } catch (err) {
    $app.logger().error("payment receipt failed", "ref", receipt.refId, "error", String(err));
  }
}

// The whole of it: ask, then act. Returns "paid" | "failed" | "unknown".
function settle(pay) {
  try {
    const answer = ask(pay);

    if (answer.verdict === "unknown") return "unknown";

    if (answer.verdict === "failed") {
      pay.set("status", "failed");
      pay.set("note", "verify refused: " + answer.code);
      $app.save(pay);
      $app.logger().warn("zarinpal verify refused",
        "authority", pay.getString("authority"), "code", answer.code);
      return "failed";
    }

    const now = new Date();
    const receipt = grant(pay, answer.refId, now);
    if (receipt) queueReceipt(receipt, now);
    return "paid";
  } catch (err) {
    // Deliberately "unknown" rather than a rethrow. If this blew up partway
    // the row may or may not have moved, and claiming either is worse than
    // admitting we do not know — the reconciler will pick it up and ask the
    // gateway again, which is the only source that can actually settle it.
    $app.logger().error("settling a payment threw; treating as unknown",
      "authority", pay.getString("authority"), "error", String(err));
    return "unknown";
  }
}

module.exports = { settle };
