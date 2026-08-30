/// <reference path="../pb_data/types.d.ts" />

// Café owner login by phone + password (no registration):
//   POST /owner/login { phone, password } -> { token, name, role }

// Open self-serve café creation. Anyone can register: creates the admin (owner)
// user, a staff service-account, a cafe_card (name/tagline/accent + a generated
// staff code) and one NFC tag, then returns an owner token.
//   POST /owner/register { name, phone, password, cafe_name, tagline?, accent? }
//     -> { token, name, role, cafe_name, staff_code, nfc }
routerAdd("POST", "/owner/register", (e) => {
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const b = e.requestInfo().body || {};
  const phone = norm(b.phone);
  const password = String(b.password || "");
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const cafeName = String(b.cafe_name || "").trim();
  const tagline = String(b.tagline || "").trim();
  let accent = String(b.accent || "#171717").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = "#171717";

  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Enter a valid mobile number." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return e.json(400, { error: "Enter a valid email address." });
  if (password.length < 6) return e.json(400, { error: "Password must be at least 6 characters." });
  if (!cafeName) return e.json(400, { error: "Enter your café's name." });

  // A phone may already have a customer account — that's a separate identity
  // from a business account, so only block on an existing *business* account.
  let exists = null;
  try { exists = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'admin'", { phone }); } catch (err) { exists = null; }
  if (exists) return e.json(409, { error: "This number already has a business registered. Sign in instead.", exists: true });

  let emailExists = null;
  try { emailExists = $app.findFirstRecordByFilter("users", "email = {:email}", { email }); } catch (err) { emailExists = null; }
  if (emailExists) return e.json(409, { error: "This email is already registered. Sign in instead.", exists: true });

  // owner (admin) account
  const owner = new Record($app.findCollectionByNameOrId("users"));
  owner.set("phone", phone);
  owner.set("email", email);
  owner.set("name", name || "Owner");
  owner.set("role", "admin");
  owner.set("verified", true);
  owner.setPassword(password);
  $app.save(owner);

  // staff service-account (staff sign in with the shared code, not a phone)
  const staffPhone = "staff-" + $security.randomStringWithAlphabet(10, "abcdefghijklmnopqrstuvwxyz0123456789");
  const staff = new Record($app.findCollectionByNameOrId("users"));
  staff.set("phone", staffPhone);
  staff.set("email", staffPhone + "@staff.loytap");
  staff.set("name", cafeName + " Staff");
  staff.set("role", "staff");
  staff.set("verified", true);
  staff.setPassword($security.randomString(30));
  $app.save(staff);

  // a readable, unique staff code from the café name + 4 digits
  const slug = (cafeName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)) || "CAFE";
  let staffCode = "";
  for (let i = 0; i < 6; i++) {
    const cand = slug + "-" + $security.randomStringWithAlphabet(4, "0123456789");
    let clash = null;
    try { clash = $app.findFirstRecordByFilter("cafe_card", "staff_code = {:c}", { c: cand }); } catch (err) { clash = null; }
    if (!clash) { staffCode = cand; break; }
  }
  if (!staffCode) staffCode = slug + "-" + $security.randomStringWithAlphabet(6, "0123456789");

  // the café card
  const card = new Record($app.findCollectionByNameOrId("cafe_card"));
  card.set("cafe_name", cafeName);
  card.set("tagline", tagline);
  card.set("accent", accent);
  card.set("stamps_required", 8);
  card.set("reward_expiry_days", 30);
  card.set("stamp_cooldown_minutes", 0);
  card.set("min_purchase", 0);
  card.set("staff_code", staffCode);
  card.set("staff_user", staff.id);
  card.set("owner_user", owner.id);
  $app.save(card);

  // a starter 10% discount so the café has something to offer on day one
  const reward = new Record($app.findCollectionByNameOrId("reward_options"));
  reward.set("deal", "10% off");
  reward.set("description", "Welcome discount — redeem after your first stamp card.");
  reward.set("weight", 1);
  reward.set("active", true);
  reward.set("expiry_amount", 2);
  reward.set("expiry_unit", "week");
  reward.set("cafe", card.id);
  $app.save(reward);

  // one NFC tag so the owner has a link to program immediately
  const tagCode = $security.randomStringWithAlphabet(20, "abcdefghijklmnopqrstuvwxyz0123456789");
  const tag = new Record($app.findCollectionByNameOrId("nfc_tags"));
  tag.set("code", tagCode);
  tag.set("active", true);
  tag.set("type", "static");
  tag.set("cafe", card.id);
  $app.save(tag);

  const token = owner.newAuthToken();
  return e.json(200, { token, name: owner.getString("name"), role: "admin", cafe_name: cafeName, staff_code: staffCode, nfc: tagCode });
});

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

  // A phone can also have a separate customer account — fetch the business
  // (admin) one specifically, not whichever row happens to match first.
  let u = null;
  try { u = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'admin'", { phone }); } catch (err) { u = null; }
  if (!u) {
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

  let nfc = "";
  try {
    const t = $app.findRecordsByFilter("nfc_tags", "cafe = {:c} && active = true", "-created", 1, 0, { c: card.id })[0];
    if (t) nfc = t.getString("code");
  } catch (err) {}

  return e.json(200, {
    id: card.id,
    cafe_name: card.getString("cafe_name"),
    tagline: card.getString("tagline"),
    accent: card.getString("accent") || "#171717",
    staff_code: card.getString("staff_code"),
    stamps_required: card.getInt("stamps_required"),
    reward_expiry_days: card.getInt("reward_expiry_days"),
    min_purchase: card.getInt("min_purchase"),
    nfc: nfc,
  });
}, $apis.requireAuth());

// Edit the café's public identity (name / tagline / accent colour).
//   POST /owner/cafe/profile  (admin auth) { cafe_name?, tagline?, accent? }
routerAdd("POST", "/owner/cafe/profile", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  const b = e.requestInfo().body || {};
  const cafeName = String(b.cafe_name || "").trim();
  if (cafeName) card.set("cafe_name", cafeName);
  if (typeof b.tagline === "string") card.set("tagline", b.tagline.trim());
  let accent = String(b.accent || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) card.set("accent", accent);
  $app.save(card);

  return e.json(200, { ok: true, cafe_name: card.getString("cafe_name"), tagline: card.getString("tagline"), accent: card.getString("accent") });
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

// Set how many stamps a card needs. Changing it does NOT touch cards already in
// progress — card.pb.js locks each card's goal when it starts, so a change only
// applies to each customer's next card.
//   POST /owner/cafe/stamps-required  (admin auth) { stamps_required } -> { ok, stamps_required }
routerAdd("POST", "/owner/cafe/stamps-required", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let n = parseInt((e.requestInfo().body || {}).stamps_required, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 12) n = 12;
  card.set("stamps_required", n);
  $app.save(card);
  return e.json(200, { ok: true, stamps_required: n });
}, $apis.requireAuth());
