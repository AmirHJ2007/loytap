/// <reference path="../pb_data/types.d.ts" />

// Reloy card — one authenticated stamp, at one café. The SERVER generates the
// stamp's look (off-centre offset, rotation, ink strength, colour) and stores
// it on the customer's membership row for that café, so it comes back
// identically on sign-in. On completion it draws a weighted-random reward
// from that café's own prize pool, mints a discount, and resets the card.
//
//   POST /card/stamp  (auth) { tag }
//     -> { stamp, stamp_count, required, completed, discount?,
//          cafe: { id, name, stamps_required, theme } }
//
// A stamp is only granted for a real NFC tap: the request must carry the
// tag's secret `code`, which must match an ACTIVE row in nfc_tags. The tag
// itself says which café it belongs to — the client never picks the café.
// A per-user, per-café cooldown (cafe_card.stamp_cooldown_minutes) caps how
// often the same customer can earn a stamp at that café, so a copied
// static-tag URL is worth at most one stamp per window.

routerAdd("POST", "/card/stamp", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Not signed in" });

  // require a valid, active tag code
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

  const inkColor = "#1c2b3a";

  // this customer's progress AT THIS CAFÉ — find or start one
  let membership = null;
  try {
    membership = $app.findFirstRecordByFilter("memberships", "user = {:u} && cafe = {:c}", { u: u.id, c: cafe.id });
  } catch (err) { membership = null; }
  if (!membership) {
    membership = new Record($app.findCollectionByNameOrId("memberships"));
    membership.set("user", u.id);
    membership.set("cafe", cafe.id);
    membership.set("stamp_count", 0);
    membership.set("cycles", 0);
    membership.set("stamps", []);
  }

  // per-user-per-café cooldown: reject if this customer stamped too recently HERE
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

  // generate this stamp's hand-pressed look
  const stamp = {
    dx: +(Math.random() * 32 - 16).toFixed(1),
    dy: +(Math.random() * 32 - 16).toFixed(1),
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
  ev.set("user", u.id);
  ev.set("cafe", cafe.id);
  ev.set("source", "nfc");
  ev.set("tag", tagCode);
  $app.save(ev);

  // note when this tag was last tapped
  try { tag.set("last_used", new Date().toISOString()); $app.save(tag); } catch (err) {}

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
    d.set("user", u.id);
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

  return e.json(200, {
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
  });
}, $apis.requireAuth());
