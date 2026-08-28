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
  if (!d || d.getString("cafe") !== card.id) return e.json(200, { status: "invalid" });

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

  // valid → redeem it now
  d.set("status", "redeemed");
  d.set("redeemed_at", new Date().toISOString().replace("T", " "));
  d.set("redeemed_by", u.id);
  $app.save(d);

  return e.json(200, Object.assign({ status: "ok" }, coupon));
}, $apis.requireAuth());
