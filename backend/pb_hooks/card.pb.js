/// <reference path="../pb_data/types.d.ts" />

// LoyTap card — one authenticated stamp. The SERVER generates the stamp's look
// (off-centre offset, rotation, ink strength, colour) and stores it on the user,
// so it comes back identically on sign-in. On completion it draws a weighted-random
// reward, mints a discount, and resets the card.
//
//   POST /card/stamp  (auth)  -> { stamp, stamp_count, required, completed, discount? }

routerAdd("POST", "/card/stamp", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Not signed in" });

  const card = $app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  const required = card ? card.getInt("stamps_required") : 8;
  const inkColor = "#1c2b3a";

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

  // audit log
  const ev = new Record($app.findCollectionByNameOrId("stamp_events"));
  ev.set("user", u.id);
  ev.set("source", "manual");
  $app.save(ev);

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
