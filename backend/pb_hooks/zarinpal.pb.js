/// <reference path="../pb_data/types.d.ts" />

// Reloy — subscription payment through ZarinPal.
//
//   POST /subscription/pay      (owner auth) { plan: "monthly"|"yearly" }
//     -> { url, authority }     the gateway to send the browser to
//
//   GET  /zarinpal/callback     (no auth — ZarinPal sends the browser here)
//     -> 302 back to /owner with ?pay=ok|failed|error
//
// THE ORDER MATTERS. The pending payments row is written BEFORE ZarinPal is
// called, and ZarinPal is called before the owner leaves. Everything after
// that is outside our control — a closed tab, dead wifi, a redirect that
// 500s — so a charge whose callback never arrives has to still be recoverable
// from our own row plus ZarinPal's records. A row created on the way back
// would make a successful payment invisible to us.
//
// THE REDIRECT IS NOT PROOF OF PAYMENT. ZarinPal's Status=OK on the callback
// is just a query parameter on the customer's own browser: forgeable, and
// replayable. Nothing is granted from it. The subscription moves only after
// our own server-to-server verify call comes back 100 or 101.
//
// AMOUNTS ARE IN RIAL ON THE WIRE. Everything this product quotes — the
// /business page, the buy sheet, the amount column — is Toman, and ZarinPal's
// API takes Rial. The conversion happens at this boundary and nowhere else.
// Get it wrong and you charge ten times too much, or a tenth; both are worse
// than failing outright, because both look like success.
//
// NOTE: self-contained on purpose — PocketBase's JS hook runtime does not give
// a routerAdd callback access to sibling top-level declarations.


// SEC-22 — refuse to boot a production origin in sandbox mode.
//
// ZARINPAL_SANDBOX=1 sends every payment to a gateway that takes fake cards.
// On a developer's machine that is the whole point. In production it means
// every café "pays" with nothing, verification returns a clean 100, a ref_id
// is written, the subscription extends and a receipt goes out — a successful
// sandbox payment is indistinguishable from a real one in every field we can
// see. The product is being given away and nothing in the system says so; the
// first honest signal is the bank statement.
//
// It does not get there by sabotage. It gets there by an env file copied off a
// laptop, a line left in a deploy script, or someone setting it to debug a
// payment and not unsetting it.
//
// SO THIS REFUSES TO START, which is the loud half of the trade:
//
//   won't boot          found in seconds, nobody can use the app, env fixed.
//   boots in sandbox    looks perfectly normal for weeks.
//
// A bad hour against a bad quarter. On the money path, loud wins.
//
// "Production" is decided by APP_ORIGIN, already used for the links in the
// receipt and the reminder emails. An origin that is unset, localhost, or any
// of the test-ish hosts below is a developer's machine and may do as it likes.
onBootstrap((e) => {
  e.next();

  try {
    if ($os.getenv("ZARINPAL_SANDBOX") !== "1") return;

    const origin = String($os.getenv("APP_ORIGIN") || "").trim();
    // Unset is the local default: dev.sh does not set APP_ORIGIN, and the
    // places that read it fall back to the live URL only for building links.
    // Treating unset as production here would stop every laptop from booting.
    if (!origin) return;

    const local = /localhost|127\.0\.0\.1|\[::1\]|\.local(host)?(:|$)|\.test(:|$)|staging|sandbox|dev\./i;
    if (local.test(origin)) return;

    const msg =
      "SEC-22: refusing to start. ZARINPAL_SANDBOX=1 sends every payment to " +
      "ZarinPal's fake-card gateway, and APP_ORIGIN is " + origin + ", which " +
      "is not a development host. Every subscription would be free and would " +
      "look exactly like a real payment. Unset ZARINPAL_SANDBOX for this " +
      "deploy, or point APP_ORIGIN at the environment this really is.";
    $app.logger().error(msg);
    throw new Error(msg);
  } catch (err) {
    // Rethrown, not swallowed: unlike the other guards in this project, the
    // safe outcome here is NOT to carry on. Wrapped only so the message above
    // is logged before the error takes the process down.
    throw err;
  }
});

routerAdd("POST", "/subscription/pay", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }

  const merchant = $os.getenv("ZARINPAL_MERCHANT_ID") || "";
  const callback = $os.getenv("ZARINPAL_CALLBACK_URL") || "";
  if (!merchant || !callback) {
    // fails closed and says so, the same way the push endpoints do without VAPID
    return e.json(503, { error: "Payments are not configured", code: "PAY_NOT_CONFIGURED" });
  }
  const sandbox = $os.getenv("ZARINPAL_SANDBOX") === "1";
  const base = sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";

  const plan = String((e.requestInfo().body || {}).plan || "").trim();
  if (plan !== "monthly" && plan !== "yearly") {
    return e.json(400, { error: "Unknown plan", code: "PLAN_UNKNOWN" });
  }

  // Priced HERE, never taken from the request. A price the client can send is
  // a price anyone can set to 1,000 Toman.
  const PRICE = { monthly: 3000000, yearly: 30000000 };   // Toman
  const toman = PRICE[plan];

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner", code: "NO_CAFE" });

  let sub = null;
  try { sub = $app.findFirstRecordByFilter("subscriptions", "cafe = {:c}", { c: card.id }); } catch (err) { sub = null; }

  // The row goes in first, with no authority yet — the partial unique index
  // allows that, and it means the attempt exists even if ZarinPal never answers.
  const pay = new Record($app.findCollectionByNameOrId("payments"));
  pay.set("cafe", card.id);
  pay.set("owner_user", u.id);
  if (sub) pay.set("subscription", sub.id);
  pay.set("plan", plan);
  pay.set("amount", toman);
  pay.set("status", "pending");
  // The credentials this attempt is being sent with, so the callback verifies
  // against the same ones even if the environment changed underneath it. Both
  // halves or neither: a payment that remembers its gateway but not its
  // merchant still breaks when the merchant rotates. See
  // 1700000041_payment_gateway.js and 1700000042_payment_merchant.js.
  pay.set("gateway", sandbox ? "sandbox" : "live");
  pay.set("merchant", merchant);
  $app.save(pay);

  let res = null;
  try {
    res = $http.send({
      url: base + "/pg/v4/payment/request.json",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 20,
      body: JSON.stringify({
        merchant_id: merchant,
        amount: toman * 10,                     // Toman -> Rial, the only place this happens
        callback_url: callback,
        description: "Reloy subscription (" + plan + ") - " + card.getString("cafe_name"),
      }),
    });
  } catch (err) {
    pay.set("status", "failed");
    pay.set("note", "gateway unreachable");     // deliberately not the raw error: it can carry the request body
    $app.save(pay);
    return e.json(502, { error: "Could not reach the payment gateway", code: "PAY_GATEWAY_DOWN" });
  }

  let body = null;
  try { body = JSON.parse(res.raw); } catch (err) { body = null; }
  const data = (body && body.data) || {};
  const authority = String(data.authority || "");

  if (Number(data.code) !== 100 || !authority) {
    // ZarinPal's own error codes live in body.errors; keep the code, not the prose
    const errCode = body && body.errors && body.errors.code ? String(body.errors.code) : "unknown";
    pay.set("status", "failed");
    pay.set("note", "request rejected: " + errCode);
    $app.save(pay);
    $app.logger().warn("zarinpal request rejected", "code", errCode, "cafe", card.id);
    return e.json(502, { error: "The payment gateway refused the request", code: "PAY_REQUEST_REFUSED" });
  }

  pay.set("authority", authority);
  $app.save(pay);

  return e.json(200, { url: base + "/pg/StartPay/" + authority, authority: authority });
}, $apis.requireAuth());


// ZarinPal sends the owner's browser back here with ?Authority=&Status=OK|NOK.
// No auth: this is a plain browser redirect and carries no session of ours.
// It identifies the attempt by authority alone, which is why that column is
// unique — a replayed callback must not be able to pay for a second period.
routerAdd("GET", "/zarinpal/callback", (e) => {
  const q = e.requestInfo().query || {};
  const authority = String(q.Authority || q.authority || "");
  const status = String(q.Status || q.status || "");
  const home = "/owner?pay=";

  if (!authority) return e.redirect(302, home + "error");

  let pay = null;
  try { pay = $app.findFirstRecordByFilter("payments", "authority = {:a}", { a: authority }); } catch (err) { pay = null; }
  if (!pay) {
    $app.logger().warn("zarinpal callback for an unknown authority");
    return e.redirect(302, home + "error");
  }

  // Already settled: a refresh of the return page, or ZarinPal retrying. Say
  // what the row already says rather than paying for another period.
  if (pay.getString("status") === "paid") return e.redirect(302, home + "ok");

  if (status !== "OK") {
    pay.set("status", "cancelled");
    pay.set("note", "returned with status " + (status || "none"));
    $app.save(pay);
    return e.redirect(302, home + "failed");
  }

  // THE CREDENTIALS COME FROM THE ROW, NOT THE ENVIRONMENT. This runs minutes
  // after /subscription/pay, in a separate request — a restart, a redeploy or
  // a rotated key in between used to mean charging one gateway/merchant and
  // then asking a different one whether it happened, which fails verification
  // on a payment that genuinely took money. The row remembers what it was
  // sent with.
  //
  // BOTH VALUES OR NEITHER. Recording only the gateway left the identical bug
  // one field over, and a half-closed hole is worse than an open one because
  // the path reads as handled.
  //
  // Each falls back to the environment independently, for rows written before
  // its migration — that is the behaviour those rows were created under and so
  // the only correct guess for them.
  const envSandbox = $os.getenv("ZARINPAL_SANDBOX") === "1";
  const envMerchant = $os.getenv("ZARINPAL_MERCHANT_ID") || "";
  const wasGateway = pay.getString("gateway");
  const wasMerchant = pay.getString("merchant");

  const sandbox = wasGateway ? wasGateway === "sandbox" : envSandbox;
  const merchant = wasMerchant || envMerchant;
  const base = sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";

  const gatewayMoved = !!wasGateway && (wasGateway === "sandbox") !== envSandbox;
  const merchantMoved = !!wasMerchant && wasMerchant !== envMerchant;
  if (gatewayMoved || merchantMoved) {
    // Worth a line: the environment moved under a live payment, and without
    // the recorded values this verify would have gone somewhere that never
    // heard of it, stranding a café that paid.
    //
    // The merchant id itself is NOT logged — it is the account identifier
    // every request is signed with, and logs travel further than the database
    // does. Whether it changed is the whole of what a reader needs.
    $app.logger().warn("zarinpal credentials changed since this payment was started",
      "authority", authority,
      "gateway_then", wasGateway || "(unrecorded)",
      "gateway_now", envSandbox ? "sandbox" : "live",
      "merchant_changed", merchantMoved);
  }

  let res = null;
  try {
    res = $http.send({
      url: base + "/pg/v4/payment/verify.json",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 20,
      // verified against the amount WE recorded at request time, not anything
      // that came back with the browser
      body: JSON.stringify({ merchant_id: merchant, amount: pay.getInt("amount") * 10, authority: authority }),
    });
  } catch (err) {
    // Left pending ON PURPOSE. The money may well have moved; only
    // reconciliation against ZarinPal can say. Marking it failed here would
    // throw away the one record that makes the charge recoverable.
    $app.logger().error("zarinpal verify unreachable", "authority", authority);
    return e.redirect(302, home + "pending");
  }

  let body = null;
  try { body = JSON.parse(res.raw); } catch (err) { body = null; }
  const data = (body && body.data) || {};
  const code = Number(data.code);

  // 100 = verified now. 101 = verified before, which is a success we have
  // simply already been told about.
  if (code !== 100 && code !== 101) {
    const errCode = body && body.errors && body.errors.code ? String(body.errors.code) : "unknown";
    pay.set("status", "failed");
    pay.set("note", "verify refused: " + errCode);
    $app.save(pay);
    return e.redirect(302, home + "failed");
  }

  const now = new Date();
  const MONTH_MS = 30 * 86400000, YEAR_MS = 365 * 86400000;

  // Filled in ONLY by the invocation that actually moves the row to paid, and
  // read after the transaction commits. Two things depend on that:
  //
  //   exactly once   the `return` below is the race guard between two
  //                  callbacks for the same authority. Hanging the receipt off
  //                  the same guard means a café is thanked once, not twice.
  //   never early    queueing inside the transaction would send a receipt for
  //                  a payment a rollback then threw away. Mail cannot be
  //                  unsent; a database row can be.
  let receipt = null;

  $app.runInTransaction((tx) => {
    const p = tx.findRecordById("payments", pay.id);
    if (p.getString("status") === "paid") return;        // raced with another callback
    p.set("status", "paid");
    p.set("ref_id", String(data.ref_id || ""));
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

    // The new period starts when the current one ends — paid or trial — so
    // buying early never throws away time already held. Only a café with
    // nothing left starts from today.
    const prevRaw = s.getString("status") === "trialing" ? s.get("trial_ends") : s.get("current_period_end");
    const prev = prevRaw ? new Date(String(prevRaw).replace(" ", "T")).getTime() : 0;
    const from = (prev && prev > now.getTime()) ? prev : now.getTime();
    const end = new Date(from + (p.getString("plan") === "yearly" ? YEAR_MS : MONTH_MS));

    s.set("status", "active");
    s.set("plan", p.getString("plan"));
    s.set("current_period_end", end.toISOString().replace("T", " "));
    s.set("amount", p.getInt("amount"));
    tx.save(s);

    receipt = {
      payId: p.id,
      cafeId: cafeId,
      ownerId: p.getString("owner_user"),
      plan: p.getString("plan"),
      amount: p.getInt("amount"),
      refId: String(data.ref_id || ""),
      endMs: end.getTime(),
    };
  });

  // ---- the receipt -------------------------------------------------------
  //
  // Wrapped whole and never allowed to throw. The money has already moved and
  // the subscription is already extended by this point; an owner who paid must
  // land back on a working panel even if the mail system is broken. A failure
  // here costs a receipt, and the payment row still holds every number it
  // would have carried.
  if (receipt) {
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
      } else {
        // Jalali, resolved in Tehran — the same dates the reminder emails and
        // the dashboard print. See jalali.js.
        const shown = require(`${__hooks}/jalali.js`).faDate;
        // 3000000 -> "3,000,000". The owner is checking this against a bank
        // SMS, so it has to be groupable at a glance.
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
      }
    } catch (err) {
      $app.logger().error("payment receipt failed", "ref", receipt.refId, "error", String(err));
    }
  }

  return e.redirect(302, home + "ok");
});
