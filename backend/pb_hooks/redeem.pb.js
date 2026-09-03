/// <reference path="../pb_data/types.d.ts" />

// Staff redeems a customer's discount QR.  The QR carries ONLY the opaque code
// (e.g. "LOYK7M3PQ"); everything trusted is looked up here on the server.
//
//   POST /redeem { code }  (staff/admin auth) -> { status, deal?, shop?, ... }
//
// status:
//   "invalid"  — no discount matches this code (a foreign / fake QR)
//   "already"  — this code was already redeemed before
//   "expired"  — past its due date
//   "ok"       — was valid; NOW marked redeemed. The deal is returned to show.

routerAdd("POST", "/redeem", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { status: "invalid", error: "Staff access only" });
  }

  // this staff/owner account's own café — a discount can only be redeemed by
  // the café that issued it, never a different café's staff
  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "staff_user = {:u} || owner_user = {:u}", { u: u.id }); }
  catch (err) { card = null; }
  if (!card) return e.json(403, { status: "invalid", error: "No café linked to this account" });

  // normalise: uppercase, strip any "LOYTAP:" / URL prefix the QR might carry
  let code = String(e.requestInfo().body.code || "").trim().toUpperCase();
  code = code.replace(/^LOYTAP[:/]*/, "");
  if (!code) return e.json(400, { status: "invalid", error: "No code" });

  let d = null;
  try { d = $app.findFirstRecordByFilter("discounts", "code = {:code}", { code }); }
  catch (err) { d = null; }
  if (!d) return e.json(200, { status: "invalid" });
  // a real reward, but it belongs to a DIFFERENT café — never redeemable here
  if (d.getString("cafe") !== card.id) {
    let otherName = "another café";
    try { const oc = $app.findRecordById("cafe_card", d.getString("cafe")); if (oc) otherName = oc.getString("cafe_name") || otherName; } catch (err) {}
    return e.json(200, { status: "wrong_cafe", shop: otherName });
  }

  const shop = card.getString("cafe_name");
  const coupon = {
    deal: d.getString("deal"),
    description: d.getString("description"),
    shop: shop,
    code: code,
  };

  // already redeemed?
  if (d.getString("status") === "redeemed") {
    return e.json(200, Object.assign({ status: "already", redeemed_at: d.getString("redeemed_at") }, coupon));
  }

  // expired?  (due_date stored as "YYYY-MM-DD HH:MM:SS.sssZ")
  const dueStr = d.getString("due_date");
  if (dueStr) {
    const dueMs = new Date(String(dueStr).replace(" ", "T")).getTime();
    if (!isNaN(dueMs) && Date.now() > dueMs) {
      if (d.getString("status") !== "expired") { d.set("status", "expired"); $app.save(d); }
      return e.json(200, Object.assign({ status: "expired" }, coupon));
    }
  }

  // valid → redeem it now. The checks above (read d, compare its status) are
  // not atomic with this write, so two requests presenting the same QR in
  // the same instant could otherwise both pass them and both flip the
  // record — one coupon, redeemed twice. Guard the flip itself with a
  // conditional UPDATE (WHERE it's still in the exact state we just read):
  // a single SQL statement is atomic, so of two concurrent attempts only
  // one can ever affect a row. The loser affects zero rows and is treated
  // as "already redeemed" instead of "ok".
  const redeemedAt = new Date().toISOString().replace("T", " ");
  let affected = 0;
  try {
    affected = $app
      .db()
      .update(
        "discounts",
        { status: "redeemed", redeemed_at: redeemedAt, redeemed_by: u.id },
        $dbx.hashExp({ id: d.id, status: d.getString("status") })
      )
      .execute()
      .rowsAffected();
  } catch (err) { affected = 0; }

  if (affected < 1) {
    let actualRedeemedAt = "";
    try { actualRedeemedAt = $app.findRecordById("discounts", d.id).getString("redeemed_at"); } catch (err) {}
    return e.json(200, Object.assign({ status: "already", redeemed_at: actualRedeemedAt }, coupon));
  }

  // We won the race and the row is already updated (raw SQL above). Re-run
  // the write through the normal Record/save path too — same end values,
  // but this is what fires PocketBase's realtime broadcast, which the raw
  // UPDATE bypasses and which the customer's own "your discount was just
  // redeemed" watch (rtWatchDiscount in app.js) depends on.
  try {
    const fresh = $app.findRecordById("discounts", d.id);
    fresh.set("status", "redeemed");
    fresh.set("redeemed_at", redeemedAt);
    fresh.set("redeemed_by", u.id);
    $app.save(fresh);
  } catch (err) {}

  return e.json(200, Object.assign({ status: "ok" }, coupon));
}, $apis.requireAuth());
