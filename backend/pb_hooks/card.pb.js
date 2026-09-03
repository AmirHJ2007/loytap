/// <reference path="../pb_data/types.d.ts" />

// Reloy card — a stamp is a two-step, REAL-TIME confirmed event:
//
//   POST /card/stamp/request  (customer auth) { tag }
//     -> { request_id, expires_in, cafe: {...} }
//     Validates the tap (active nfc_tags row) and the per-café cooldown, then
//     creates a PENDING stamp_requests row. No stamp is granted yet.
//
//   POST /card/stamp/confirm  (staff/admin auth) { request_id, approve }
//     -> { status: "approved"|"denied"|"expired", result? }
//     Only that café's own staff/owner may act on it, and only within 30s of
//     creation. Approving is what actually runs the stamp logic below
//     (SERVER generates the stamp's look, draws a reward on completion,
//     etc.) — exactly what /card/stamp used to do synchronously.
//
// Both the customer and the café's staff panel watch the stamp_requests row
// over PocketBase realtime (see rtWatch in app.js / staff.js), so the
// customer's "waiting…" screen resolves the instant staff taps Confirm/Deny —
// no polling, no refresh.
//
// Why: a static NFC tag's code is plain text on the chip — any NFC-reader app
// can read it, so it can never be kept secret from the customer holding the
// card. Requiring a human at the café to confirm every stamp means a captured
// or replayed code is worthless on its own; a stamp can only ever happen with
// staff physically present and paying attention.
//
// NOTE: each routerAdd callback below is fully self-contained (no shared
// top-level helper functions). PocketBase's JS hook runtime does not give a
// routerAdd callback access to sibling top-level `function` declarations from
// the same file at request time — calling one throws "X is not defined" even
// though it's plainly in scope in the source. Every other hook file in this
// project already follows this same self-contained-callback shape; this file
// briefly deviated (via a `commitStamp`/`cafeEcho` helper split) and every
// real tap silently failed as a result. Keep new routes self-contained too.

routerAdd("POST", "/card/stamp/request", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Not signed in" });

  const REQUEST_TTL_MS = 30000;
  const tagCode = String((e.requestInfo().body || {}).tag || "").trim();
  if (!tagCode) return e.json(400, { error: "Tap your café's card to collect a stamp." });
  let tag = null;
  try { tag = $app.findFirstRecordByFilter("nfc_tags", "code = {:c}", { c: tagCode }); } catch (err) { tag = null; }
  if (!tag || !tag.getBool("active")) {
    return e.json(400, { error: "This card isn't recognised." });
  }

  const cafeId = tag.getString("cafe");
  let cafe = null;
  try { cafe = $app.findRecordById("cafe_card", cafeId); } catch (err) { cafe = null; }
  if (!cafe) return e.json(400, { error: "This card isn't recognised." });

  const logoName = cafe.getString("logo");
  const cafeEcho = {
    id: cafe.id,
    name: cafe.getString("cafe_name"),
    tagline: cafe.getString("tagline"),
    accent: cafe.getString("accent") || "#171717",
    // ready-to-use URL — this payload isn't a raw record, so the client has no
    // collectionId to build one from (see fileUrl() in app.js)
    logo: logoName ? "/api/files/" + cafe.collection().id + "/" + cafe.id + "/" + logoName + "?thumb=240x240" : "",
    stamps_required: cafe.getInt("stamps_required"),
    min_purchase: cafe.getInt("min_purchase"),
    theme: cafe.getString("theme"),
  };

  // per-user, per-café cooldown — caps how often the same customer's tap can
  // even START a confirmation request
  const cooldownMin = cafe.getInt("stamp_cooldown_minutes");
  if (cooldownMin > 0) {
    const last = $app.findRecordsByFilter("stamp_events", "user = {:u} && cafe = {:c}", "-created", 1, 0, { u: u.id, c: cafe.id })[0];
    if (last) {
      const lastMs = new Date(String(last.getString("created")).replace(" ", "T")).getTime();
      const elapsed = Date.now() - lastMs;
      const windowMs = cooldownMin * 60000;
      if (!isNaN(lastMs) && elapsed < windowMs) {
        const retryAfter = Math.ceil((windowMs - elapsed) / 60000);
        return e.json(429, { error: "You already collected a stamp recently. Come back soon!", retry_after: retryAfter });
      }
    }
  }

  // one outstanding request per customer per café — a re-tap while a request
  // is already pending just re-surfaces it instead of spamming the staff panel
  let existing = null;
  try {
    existing = $app.findFirstRecordByFilter("stamp_requests", "user = {:u} && cafe = {:c} && status = 'pending'", { u: u.id, c: cafe.id });
  } catch (err) { existing = null; }
  if (existing) {
    const createdMs = new Date(String(existing.getString("created")).replace(" ", "T")).getTime();
    const age = isNaN(createdMs) ? Infinity : Date.now() - createdMs;
    if (age < REQUEST_TTL_MS) {
      return e.json(200, { request_id: existing.id, expires_in: Math.ceil((REQUEST_TTL_MS - age) / 1000), cafe: cafeEcho });
    }
    existing.set("status", "expired");
    $app.save(existing);
  }

  const req = new Record($app.findCollectionByNameOrId("stamp_requests"));
  req.set("user", u.id);
  req.set("cafe", cafe.id);
  req.set("user_name", u.getString("name") || "");
  req.set("tag", tagCode);
  req.set("status", "pending");
  $app.save(req);

  // note when this tag was last tapped
  try { tag.set("last_used", new Date().toISOString()); $app.save(tag); } catch (err) {}

  return e.json(200, { request_id: req.id, expires_in: REQUEST_TTL_MS / 1000, cafe: cafeEcho });
}, $apis.requireAuth());

routerAdd("POST", "/card/stamp/confirm", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { error: "Staff access only" });
  }

  const REQUEST_TTL_MS = 30000;
  const body = e.requestInfo().body || {};
  const reqId = String(body.request_id || "").trim();
  const approve = !!body.approve;
  if (!reqId) return e.json(400, { error: "Missing request" });

  let req = null;
  try { req = $app.findRecordById("stamp_requests", reqId); } catch (err) { req = null; }
  if (!req) return e.json(404, { status: "invalid", error: "Request not found" });

  // this staff/owner's own café only — never someone else's pending request
  let cafe = null;
  try {
    cafe = $app.findFirstRecordByFilter("cafe_card", "id = {:c} && (staff_user = {:u} || owner_user = {:u})", { c: req.getString("cafe"), u: u.id });
  } catch (err) { cafe = null; }
  if (!cafe) return e.json(403, { status: "invalid", error: "Not your café" });

  if (req.getString("status") !== "pending") {
    return e.json(409, { status: req.getString("status"), error: "Already handled" });
  }

  const createdMs = new Date(String(req.getString("created")).replace(" ", "T")).getTime();
  if (isNaN(createdMs) || Date.now() - createdMs > REQUEST_TTL_MS) {
    req.set("status", "expired");
    $app.save(req);
    return e.json(410, { status: "expired", error: "This request expired" });
  }

  if (!approve) {
    req.set("status", "denied");
    $app.save(req);
    return e.json(200, { status: "denied" });
  }

  // ---- the actual stamp: server-generated look, audit row, and — on ----
  // ---- completion — a weighted-random reward draw + minted discount ----
  const userId = req.getString("user");
  const tagCode = req.getString("tag");
  const inkColor = "#1c2b3a";

  let membership = null;
  try {
    membership = $app.findFirstRecordByFilter("memberships", "user = {:u} && cafe = {:c}", { u: userId, c: cafe.id });
  } catch (err) { membership = null; }
  if (!membership) {
    membership = new Record($app.findCollectionByNameOrId("memberships"));
    membership.set("user", userId);
    membership.set("cafe", cafe.id);
    membership.set("stamp_count", 0);
    membership.set("cycles", 0);
    membership.set("stamps", []);
  }

  const stamp = {
    dx: 0, // always dead-center in the slot circle — no scatter
    dy: 0,
    r: +(Math.random() * 14 - 7).toFixed(1),
    sa: +(0.55 + Math.random() * 0.45).toFixed(2),
    color: inkColor,
  };

  let stamps = [];
  try {
    const raw = toString(membership.get("stamps")); // JSON field comes back as raw bytes
    if (raw && raw !== "null") stamps = JSON.parse(raw);
  } catch (err) { stamps = []; }
  if (!Array.isArray(stamps)) stamps = [];
  stamps.push(stamp);
  let count = stamps.length;

  // Lock the goal to the café's value at the moment a card STARTS. A later change
  // to stamps_required must not move the goalposts for a card already in progress —
  // only the customer's NEXT card picks up the new number.
  let required;
  if (count === 1) {
    required = cafe.getInt("stamps_required") || 8;
    membership.set("card_required", required);
  } else {
    required = membership.getInt("card_required") || cafe.getInt("stamps_required") || 8;
  }

  // audit log (records the real tap source, café, and which tag)
  const ev = new Record($app.findCollectionByNameOrId("stamp_events"));
  ev.set("user", userId);
  ev.set("cafe", cafe.id);
  ev.set("source", "nfc");
  ev.set("tag", tagCode);
  $app.save(ev);

  let completed = false;
  let discount = null;

  if (count >= required) {
    // draw one active reward from THIS café's pool at random — every reward
    // has an equal chance. (To boost a reward's odds the owner simply adds it
    // more than once, so it holds more than one ticket in this uniform draw.)
    const opts = $app.findRecordsByFilter("reward_options", "active = true && cafe = {:c}", "", 200, 0, { c: cafe.id });
    const picked = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;

    // due date = issue time + the drawn reward's own "expires after" (amount + unit).
    // Falls back to the café-wide reward_expiry_days if the reward has none.
    const due = new Date();
    const amt = picked ? picked.getInt("expiry_amount") : 0;
    const unit = picked ? picked.getString("expiry_unit") : "";
    if (amt > 0 && unit === "day") due.setDate(due.getDate() + amt);
    else if (amt > 0 && unit === "week") due.setDate(due.getDate() + amt * 7);
    else if (amt > 0 && unit === "month") due.setMonth(due.getMonth() + amt);
    else due.setDate(due.getDate() + cafe.getInt("reward_expiry_days"));
    const dueMs = due.getTime();
    const code = "LOY" + $security.randomStringWithAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

    const d = new Record($app.findCollectionByNameOrId("discounts"));
    d.set("user", userId);
    d.set("cafe", cafe.id);
    if (picked) d.set("reward_option", picked.id);
    d.set("code", code);
    d.set("deal", picked ? picked.getString("deal") : "Reward");
    d.set("description", picked ? picked.getString("description") : "");
    d.set("one_time", true);
    d.set("due_date", new Date(dueMs).toISOString());
    d.set("status", "active");
    $app.save(d);

    const z = (n) => (n < 10 ? "0" + n : "" + n);
    discount = {
      id: d.id,
      code,
      deal: d.getString("deal"),
      description: d.getString("description"),
      shop: cafe.getString("cafe_name"),
      cafe_id: cafe.id,
      due: z(due.getDate()) + "." + z(due.getMonth() + 1) + "." + String(due.getFullYear()).slice(2),
    };

    // reset the card for a fresh cycle; the next card adopts the café's CURRENT goal
    stamps = [];
    count = 0;
    membership.set("cycles", membership.getInt("cycles") + 1);
    membership.set("card_required", cafe.getInt("stamps_required") || 8);
    completed = true;
  }

  membership.set("stamps", stamps);
  membership.set("stamp_count", count);
  $app.save(membership);

  const result = {
    stamp, stamp_count: count, required, completed, discount,
    // the goal the NEXT card will use — after a completion this is the café's
    // current (possibly changed) value, so the client can rebuild with it
    next_required: membership.getInt("card_required") || required,
    cafe: {
      id: cafe.id,
      name: cafe.getString("cafe_name"),
      tagline: cafe.getString("tagline"),
      accent: cafe.getString("accent") || "#171717",
      stamps_required: required,
      min_purchase: cafe.getInt("min_purchase"),
      theme: cafe.getString("theme"),
    },
  };

  req.set("status", "approved");
  req.set("result", result);
  $app.save(req);

  return e.json(200, { status: "approved", result });
}, $apis.requireAuth());
