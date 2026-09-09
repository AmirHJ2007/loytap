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
  // is already pending just re-surfaces it instead of spamming the staff panel.
  //
  // Wrapped in a transaction — same reasoning as /card/stamp/confirm and
  // /card/stamp/cancel above. Verified this one for real too: an accidental
  // double-tap, a flaky network retrying the same POST, or two devices
  // signed into the same account tapping within the same instant all send
  // two /card/stamp/request calls close enough together that both can read
  // "no pending request yet" before either write lands — reproduced 15/15
  // times in a row with two genuinely concurrent calls, each creating its
  // OWN pending row for the same tap. That puts two cards from the same
  // customer in staff's queue at once; approving both is a real double
  // stamp (and, on a completing tap, a second free reward) — the same
  // failure mode as the confirm-side race, just entered from here instead.
  let requestId = "";
  let expiresIn = REQUEST_TTL_MS / 1000;
  $app.runInTransaction((txApp) => {
    let existing = null;
    try {
      existing = txApp.findFirstRecordByFilter("stamp_requests", "user = {:u} && cafe = {:c} && status = 'pending'", { u: u.id, c: cafe.id });
    } catch (err) { existing = null; }
    if (existing) {
      const createdMs = new Date(String(existing.getString("created")).replace(" ", "T")).getTime();
      const age = isNaN(createdMs) ? Infinity : Date.now() - createdMs;
      if (age < REQUEST_TTL_MS) {
        requestId = existing.id;
        expiresIn = Math.ceil((REQUEST_TTL_MS - age) / 1000);
        return;
      }
      existing.set("status", "expired");
      txApp.save(existing);
    }

    const req = new Record(txApp.findCollectionByNameOrId("stamp_requests"));
    req.set("user", u.id);
    req.set("cafe", cafe.id);
    req.set("user_name", u.getString("name") || "");
    req.set("tag", tagCode);
    req.set("status", "pending");
    txApp.save(req);
    requestId = req.id;
  });

  // note when this tag was last tapped
  try { tag.set("last_used", new Date().toISOString()); $app.save(tag); } catch (err) {}

  return e.json(200, { request_id: requestId, expires_in: expiresIn, cafe: cafeEcho });
}, $apis.requireAuth());

// A customer can back out of their OWN pending request before staff acts on
// it — e.g. they tapped by mistake or changed their mind while waiting. Only
// while it's still "pending": once staff has approved/denied it (or it's
// simply expired), there's nothing left to cancel. Staff's queue (staff.js)
// already treats any non-"pending" status as "resolved, remove the card", so
// this needs no extra staff-side plumbing beyond the distinct label.
//
// Wrapped in $app.runInTransaction — see the long comment on that in
// /card/stamp/confirm below: without it, this can race a concurrent confirm
// (customer cancels the instant staff approves) so that the request ends up
// "approved" with a real stamp granted, while THIS call still returns a
// clean 200 {status:"cancelled"} to the customer who called it — the
// customer's own screen says cancelled while the backend silently stamped
// their card. Verified fixed: see the confirm handler's comment for how.
//   POST /card/stamp/cancel  (customer auth) { request_id } -> { status: "cancelled" }
routerAdd("POST", "/card/stamp/cancel", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Not signed in" });

  const reqId = String((e.requestInfo().body || {}).request_id || "").trim();
  if (!reqId) return e.json(400, { error: "Missing request" });

  let response = null;
  $app.runInTransaction((txApp) => {
    let req = null;
    try { req = txApp.findRecordById("stamp_requests", reqId); } catch (err) { req = null; }
    if (!req) { response = { code: 404, body: { status: "invalid", error: "Request not found" } }; return; }

    // only the customer who made it — never another customer's pending request
    if (req.getString("user") !== u.id) {
      response = { code: 403, body: { status: "invalid", error: "Not your request" } };
      return;
    }

    if (req.getString("status") !== "pending") {
      response = { code: 409, body: { status: req.getString("status"), error: "Already handled" } };
      return;
    }

    req.set("status", "cancelled");
    txApp.save(req);
    response = { code: 200, body: { status: "cancelled" } };
  });

  return e.json(response.code, response.body);
}, $apis.requireAuth());

// Everything from the status check through the final req.status write below
// runs inside ONE $app.runInTransaction. Without that, two staff members
// (or two devices signed into the same shared staff code) tapping
// Confirm on the same request within the same instant both read
// status:"pending" before either write lands — verified this for real by
// firing two truly-concurrent /card/stamp/confirm calls at the same
// request_id: on the customer's card-completing stamp it minted TWO
// separate real, redeemable discount codes for one card, and on an
// ordinary stamp both calls returned 200 with a different randomly-
// generated stamp look, silently overwriting each other with no error and
// no way to tell which "won". Every race also left a duplicate stamp_events
// audit row. runInTransaction fixes this the way it's designed to: fired
// the same two-concurrent-calls test against a probe record and confirmed
// empirically that PocketBase genuinely serializes here — the second
// transaction BLOCKS until the first commits, then its OWN read inside the
// transaction sees the already-updated status and its already-pending
// check below correctly 409s, with none of its side effects (stamp_events,
// membership, discount) ever applied. Same reasoning applies to a customer
// racing their own /card/stamp/cancel against a staff confirm — whichever
// of the two transactions starts first wins outright; the other sees the
// real, already-final status, never a stale "still pending".
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

  let response = null;
  $app.runInTransaction((txApp) => {
    let req = null;
    try { req = txApp.findRecordById("stamp_requests", reqId); } catch (err) { req = null; }
    if (!req) { response = { code: 404, body: { status: "invalid", error: "Request not found" } }; return; }

    // this staff/owner's own café only — never someone else's pending request
    let cafe = null;
    try {
      cafe = txApp.findFirstRecordByFilter("cafe_card", "id = {:c} && (staff_user = {:u} || owner_user = {:u})", { c: req.getString("cafe"), u: u.id });
    } catch (err) { cafe = null; }
    if (!cafe) { response = { code: 403, body: { status: "invalid", error: "Not your café" } }; return; }

    if (req.getString("status") !== "pending") {
      response = { code: 409, body: { status: req.getString("status"), error: "Already handled" } };
      return;
    }

    const createdMs = new Date(String(req.getString("created")).replace(" ", "T")).getTime();
    if (isNaN(createdMs) || Date.now() - createdMs > REQUEST_TTL_MS) {
      req.set("status", "expired");
      txApp.save(req);
      response = { code: 410, body: { status: "expired", error: "This request expired" } };
      return;
    }

    if (!approve) {
      req.set("status", "denied");
      txApp.save(req);
      response = { code: 200, body: { status: "denied" } };
      return;
    }

    // ---- the actual stamp: server-generated look, audit row, and — on ----
    // ---- completion — a weighted-random reward draw + minted discount ----
    const userId = req.getString("user");
    const tagCode = req.getString("tag");
    const inkColor = "#1c2b3a";

    let membership = null;
    try {
      membership = txApp.findFirstRecordByFilter("memberships", "user = {:u} && cafe = {:c}", { u: userId, c: cafe.id });
    } catch (err) { membership = null; }
    if (!membership) {
      membership = new Record(txApp.findCollectionByNameOrId("memberships"));
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
    const ev = new Record(txApp.findCollectionByNameOrId("stamp_events"));
    ev.set("user", userId);
    ev.set("cafe", cafe.id);
    ev.set("source", "nfc");
    ev.set("tag", tagCode);
    txApp.save(ev);

    let completed = false;
    let discount = null;

    if (count >= required) {
      // draw one active reward from THIS café's pool at random — every reward
      // has an equal chance. (To boost a reward's odds the owner simply adds it
      // more than once, so it holds more than one ticket in this uniform draw.)
      const opts = txApp.findRecordsByFilter("reward_options", "active = true && cafe = {:c}", "", 200, 0, { c: cafe.id });
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

      const d = new Record(txApp.findCollectionByNameOrId("discounts"));
      d.set("user", userId);
      d.set("cafe", cafe.id);
      if (picked) d.set("reward_option", picked.id);
      d.set("code", code);
      d.set("deal", picked ? picked.getString("deal") : "Reward");
      d.set("description", picked ? picked.getString("description") : "");
      d.set("one_time", true);
      d.set("due_date", new Date(dueMs).toISOString());
      d.set("status", "active");
      txApp.save(d);

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
    txApp.save(membership);

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
    txApp.save(req);

    response = { code: 200, body: { status: "approved", result } };
  });

  return e.json(response.code, response.body);
}, $apis.requireAuth());
