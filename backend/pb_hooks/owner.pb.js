/// <reference path="../pb_data/types.d.ts" />

// Café owner login by phone + password (no registration):
//   POST /owner/login { phone, password } -> { token, name, role }

routerAdd("POST", "/owner/login", (e) => {
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const phone = norm(e.requestInfo().body.phone);
  const password = String(e.requestInfo().body.password || "");
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  let u = null;
  try { u = $app.findFirstRecordByFilter("users", "phone = {:phone}", { phone }); } catch (err) { u = null; }
  if (!u || u.getString("role") !== "admin") {
    return e.json(404, { error: "No owner account for this number", notRegistered: true });
  }
  if (!password) return e.json(400, { error: "Enter your password" });
  if (!u.validatePassword(password)) return e.json(401, { error: "Wrong password" });

  let cafeName = "";
  try {
    const card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id });
    if (card) cafeName = card.getString("cafe_name");
  } catch (err) {}

  const token = u.newAuthToken();
  return e.json(200, { token, name: u.getString("name"), role: u.getString("role"), cafe_name: cafeName });
});

// The owner's own café config — resolved from the auth token, never a client-
// supplied id, so one owner can never read/target another café's settings.
//   GET /owner/cafe  (admin auth) -> { id, cafe_name, staff_code, stamps_required, reward_expiry_days }
routerAdd("GET", "/owner/cafe", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  return e.json(200, {
    id: card.id,
    cafe_name: card.getString("cafe_name"),
    staff_code: card.getString("staff_code"),
    stamps_required: card.getInt("stamps_required"),
    reward_expiry_days: card.getInt("reward_expiry_days"),
    min_purchase: card.getInt("min_purchase"),
  });
}, $apis.requireAuth());

// Set the optional minimum-purchase amount (toman) on the owner's own café.
// 0 clears it. Informational only — staff enforce it, we just display it.
//   POST /owner/cafe/min-purchase  (admin auth) { min_purchase } -> { ok, min_purchase }
routerAdd("POST", "/owner/cafe/min-purchase", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let amt = parseInt((e.requestInfo().body || {}).min_purchase, 10);
  if (isNaN(amt) || amt < 0) amt = 0;
  if (amt > 100000000) amt = 100000000; // sane cap (100M toman)
  card.set("min_purchase", amt);
  $app.save(card);
  return e.json(200, { ok: true, min_purchase: amt });
}, $apis.requireAuth());
