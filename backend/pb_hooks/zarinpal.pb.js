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

  // NOT wrapped in a try. Every other guard in this project swallows its own
  // errors and carries on, because for those the safe outcome is a running
  // app. Here it is the opposite: the whole point is to stop. An unexpected
  // error in these few lines should take the boot down for the same reason a
  // deliberate one does — if we cannot tell which gateway this deploy is
  // pointed at, we must not start taking payments against it.
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
  // Logged as well as thrown: the throw ends the process with a bare message,
  // while this lands in the structured log where a deploy's output is read.
  $app.logger().error(msg);
  throw new Error(msg);
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

  // THE AUTHORITY IS THE ONLY THREAD BETWEEN OUR ROW AND ZARINPAL'S. The
  // callback finds the attempt by that column and nothing else, so a row that
  // never records it can never be matched on the way back.
  //
  // Which makes an unguarded save here the one failure this whole file is
  // arranged to prevent. Handing the owner the gateway URL after this write
  // failed would send them off to pay against a session we cannot recognise
  // when they return: money moves, the callback finds no row, and the only
  // record left is ZarinPal's.
  //
  // So we refuse rather than continue. Nothing has been charged at this point
  // — the authority is a session ZarinPal is holding open, and one the owner
  // never visits simply expires — so the cost of refusing is that they press
  // the button again, which is the cheapest outcome available here.
  //
  // The realistic cause is the unique index on `authority`: ZarinPal handing
  // back a handle some earlier row already carries. Logged WITH the authority
  // because it is the only thread back to the session being abandoned, and a
  // support question about a charge nobody can find starts there.
  try {
    pay.set("authority", authority);
    $app.save(pay);
  } catch (err) {
    $app.logger().error("zarinpal authority could not be recorded; abandoning the session",
      "authority", authority, "cafe", card.id, "pay", pay.id, "error", String(err));

    // Clear it before writing again. The likeliest reason the save failed is
    // the unique index on this very column, so leaving it set would fail the
    // second write for exactly the same reason and lose the status too. The
    // index is partial — it ignores empty — so an abandoned row is allowed to
    // sit there with none.
    try {
      pay.set("authority", "");
      pay.set("status", "failed");
      pay.set("note", "authority not recorded");
      $app.save(pay);
    } catch (err2) {
      $app.logger().error("zarinpal payment row left pending after a failed authority write",
        "pay", pay.id, "error", String(err2));
    }

    return e.json(500, { error: "Could not start the payment. Please try again.", code: "PAY_NOT_RECORDED" });
  }

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

  // Everything from here — asking ZarinPal, reading the answer, moving the
  // row, extending the subscription, queueing the receipt — lives in
  // settle.js, because this is not the only caller. The browser coming back
  // is the path that is NOT guaranteed to happen, and reconcile.pb.js has to
  // reach the same verdict about the same payment by running the same code.
  //
  // "unknown" means we could not get a readable answer and NOTHING was
  // written. The row stays pending and stays recoverable, which is the only
  // honest thing to say when the money may have moved — and the reconciler
  // will ask again.
  const verdict = require(`${__hooks}/settle.js`).settle(pay);

  if (verdict === "paid") return e.redirect(302, home + "ok");
  if (verdict === "failed") return e.redirect(302, home + "failed");
  return e.redirect(302, home + "pending");
});
