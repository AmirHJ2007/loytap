/// <reference path="../pb_data/types.d.ts" />

// LoyTap card — one authenticated stamp. The SERVER generates the stamp's look
// (off-centre offset, rotation, ink strength, colour) and stores it on the user,
// so it comes back identically on sign-in. On completion it draws a weighted-random
// reward, mints a discount, and resets the card.
//
//   POST /card/stamp  (auth) { tag }  -> { stamp, stamp_count, required, completed, discount? }
//
// A stamp is only granted for a real NFC tap: the request must carry the tag's
// secret `code`, which must match an ACTIVE row in nfc_tags. The client `nfc=1`
// flag is gone — the server never trusts the browser to say "this was a tap".
// A per-user cooldown (cafe_card.stamp_cooldown_minutes) caps how often the same
// customer can earn a stamp, so a copied static-tag URL is worth at most one stamp
// per window.

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

  const card = $app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  const required = card ? card.getInt("stamps_required") : 8;
  const inkColor = "#1c2b3a";

  // per-user cooldown: reject if this customer stamped too recently
  const cooldownMin = card ? card.getInt("stamp_cooldown_minutes") : 0;
  if (cooldownMin > 0) {
    const last = $app.findRecordsByFilter("stamp_events", "user = {:u}", "-created", 1, 0, { u: u.id })[0];
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
    const raw = toString(u.get("stamps")); // JSON field comes back as raw bytes
    if (raw && raw !== "null") stamps = JSON.parse(raw);
  } catch (err) { stamps = []; }
  if (!Array.isArray(stamps)) stamps = [];
  stamps.push(stamp);
  let count = stamps.length;

  // audit log (records the real tap source + which tag)
  const ev = new Record($app.findCollectionByNameOrId("stamp_events"));
  ev.set("user", u.id);
  ev.set("source", "nfc");
  ev.set("tag", tagCode);
  $app.save(ev);

  // note when this tag was last tapped
  try { tag.set("last_used", new Date().toISOString()); $app.save(tag); } catch (err) {}

  let completed = false;
  let discount = null;

  if (count >= required) {
    // draw one active reward at random — every reward has an equal chance.
    // (To boost a reward's odds the owner simply adds it more than once, so it
    // holds more than one ticket in this uniform draw.)
    const opts = $app.findRecordsByFilter("reward_options", "active = true", "", 200, 0, {});
    const picked = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;

    // due date = issue time + the drawn reward's own "expires after" (amount + unit).
    // Falls back to the café-wide reward_expiry_days if the reward has none.
    const due = new Date();
    const amt = picked ? picked.getInt("expiry_amount") : 0;
    const unit = picked ? picked.getString("expiry_unit") : "";
    if (amt > 0 && unit === "day") due.setDate(due.getDate() + amt);
    else if (amt > 0 && unit === "week") due.setDate(due.getDate() + amt * 7);
    else if (amt > 0 && unit === "month") due.setMonth(due.getMonth() + amt);
    else due.setDate(due.getDate() + (card ? card.getInt("reward_expiry_days") : 30));
    const dueMs = due.getTime();
    const code = "LOY" + $security.randomStringWithAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

    const d = new Record($app.findCollectionByNameOrId("discounts"));
    d.set("user", u.id);
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
      shop: card ? card.getString("cafe_name") : "",
      due: z(due.getDate()) + "." + z(due.getMonth() + 1) + "." + String(due.getFullYear()).slice(2),
    };

    // reset the card for a fresh cycle
    stamps = [];
    count = 0;
    u.set("cycles", u.getInt("cycles") + 1);
    completed = true;
  }

  u.set("stamps", JSON.stringify(stamps));
  u.set("stamp_count", count);
  $app.save(u);

  return e.json(200, { stamp, stamp_count: count, required, completed, discount });
}, $apis.requireAuth());
