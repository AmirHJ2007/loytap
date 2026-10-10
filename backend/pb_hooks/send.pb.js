/// <reference path="../pb_data/types.d.ts" />

// A café writing to the customers who hold its card.
//
//   POST /owner/send  (admin auth)
//     { ids: [<membership id>, ...], body: "<text>", send_id?: "<key>",
//       discount?: { deal, description, expiry_amount, expiry_unit } }
//   -> { sent: <n>, skipped: <n>, duplicate: <bool> }
//
// RECIPIENTS ARE MEMBERSHIP IDS, NOT USER IDS. That is the whole of the
// authorisation story, and it is the same property /owner/customers was
// built around: the list an owner reads hands back membership ids, each
// membership names exactly one café, and this endpoint refuses any whose
// café is not the caller's own. An owner who invents ids reaches nothing —
// they can only ever address their own café's record of a person, and the
// user id never travels in either direction.
//
// One row per recipient, because `read` is per-person (see
// 1700000031_messages.js). An attached reward is minted per recipient too:
// the discount in the message IS a real discount row belonging to that
// customer, with its own code, so redeeming it in the message and redeeming
// it in the Discounts tab are the same act.
//
// Everything lands in ONE transaction. A send that half-finishes is the
// worst outcome here: some customers hold a reward their café does not know
// it gave, and the owner has no way to tell who got what. All or nothing.
//
// Self-contained callback, no shared top-level helpers — see the note at the
// top of card.pb.js for why that matters in the PocketBase JS hook runtime.

routerAdd("POST", "/owner/send", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner", code: "NO_CAFE" });

  let req = {};
  try { req = e.requestInfo().body || {}; } catch (err) { req = {}; }

  const body = String(req.body == null ? "" : req.body).trim();
  if (!body) return e.json(400, { error: "Write a message first", code: "SEND_EMPTY" });
  // the field itself is max 2000; refusing here says so instead of failing
  // on the save after the recipients have been resolved
  if (body.length > 2000) return e.json(400, { error: "Message is too long", code: "SEND_TOO_LONG" });

  // The key that makes a retry safe. The page sends the same one for the
  // same composed message, so pressing Send again after a connection drop
  // cannot write the broadcast twice. See 1700000032_message_send_id.js.
  const sendId = String(req.send_id == null ? "" : req.send_id).slice(0, 40);

  const ids = Array.isArray(req.ids) ? req.ids : [];
  if (!ids.length) return e.json(400, { error: "No one to send to", code: "SEND_NO_RECIPIENTS" });
  // A ceiling, not a target. 500 recipients with a reward attached is 1,000
  // rows in one transaction, which is about as much as one request should
  // ever carry; past that the page has to send in batches rather than this
  // endpoint quietly doing half the job.
  const MAX = 500;
  if (ids.length > MAX) {
    return e.json(400, { error: "Too many recipients in one send", code: "SEND_TOO_MANY" });
  }

  // ---- the optional reward ----
  const disc = req.discount && typeof req.discount === "object" ? req.discount : null;
  let deal = "", desc = "", amt = 0, unit = "";
  if (disc) {
    deal = String(disc.deal == null ? "" : disc.deal).trim();
    desc = String(disc.description == null ? "" : disc.description).trim();
    amt = parseInt(disc.expiry_amount, 10) || 0;
    unit = String(disc.expiry_unit == null ? "" : disc.expiry_unit);
    // A blank deal would reach the customer as an empty ticket. The page
    // already refuses to attach one; this is the same rule on the only side
    // that can enforce it.
    if (!deal) return e.json(400, { error: "The attached reward needs a deal", code: "SEND_DISCOUNT_EMPTY" });
    if (amt < 1 || amt > 365) return e.json(400, { error: "Invalid expiry on the attached reward", code: "SEND_DISCOUNT_EXPIRY" });
    if (unit !== "day" && unit !== "week" && unit !== "month") {
      return e.json(400, { error: "Invalid expiry unit on the attached reward", code: "SEND_DISCOUNT_EXPIRY" });
    }
  }

  // due date = now + the owner's "expires after", the same arithmetic
  // card.pb.js does when a card completes
  let dueISO = "";
  if (disc) {
    const due = new Date();
    if (unit === "day") due.setDate(due.getDate() + amt);
    else if (unit === "week") due.setDate(due.getDate() + amt * 7);
    else due.setMonth(due.getMonth() + amt);
    dueISO = due.toISOString();
  }

  let sent = 0, skipped = 0, duplicate = false;
  try {
    $app.runInTransaction((tx) => {
      const msgs = tx.findCollectionByNameOrId("messages");

      // Inside the transaction on purpose. SQLite serialises writers, so a
      // second attempt that reaches this point waits for the first to
      // commit and then finds its rows; checked outside, the two could both
      // look, both find nothing, and both write.
      if (sendId) {
        let prior = null;
        try { prior = tx.findFirstRecordByFilter("messages", "cafe = {:c} && send_id = {:k}", { c: card.id, k: sendId }); } catch (err) { prior = null; }
        if (prior) { duplicate = true; return; }
      }

      const discs = disc ? tx.findCollectionByNameOrId("discounts") : null;

      // Deduplicated: the same person twice in one send is two copies of the
      // same message and, worse, two rewards.
      const seen = {};
      for (const raw of ids) {
        const id = String(raw == null ? "" : raw);
        if (!id || seen[id]) { skipped++; continue; }
        seen[id] = true;

        let m = null;
        try { m = tx.findRecordById("memberships", id); } catch (err) { m = null; }
        // Not an error worth failing the whole send over: a membership can
        // be deleted between the owner reading the list and pressing Send.
        // A membership belonging to someone else's café is the same shape of
        // miss, and is where an invented id lands.
        if (!m || m.getString("cafe") !== card.id) { skipped++; continue; }
        const userId = m.getString("user");
        if (!userId) { skipped++; continue; }

        let discId = "";
        if (disc) {
          const d = new Record(discs);
          d.set("user", userId);
          d.set("cafe", card.id);
          d.set("code", "LOY" + $security.randomStringWithAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
          d.set("deal", deal);
          d.set("description", desc);
          d.set("one_time", true);
          d.set("due_date", dueISO);
          d.set("status", "active");
          // no reward_option: this one was written by hand for this send, it
          // is not a draw from the café's pool
          tx.save(d);
          discId = d.id;
        }

        const msg = new Record(msgs);
        msg.set("user", userId);
        msg.set("cafe", card.id);
        msg.set("body", body);
        if (discId) msg.set("discount", discId);
        msg.set("read", false);
        if (sendId) msg.set("send_id", sendId);
        tx.save(msg);
        sent++;
      }
    });
  } catch (err) {
    $app.logger().error("owner/send failed", "cafe", card.id, "error", String(err));
    return e.json(500, { error: "Could not send the message", code: "SEND_FAILED" });
  }

  if (duplicate) {
    // Not an error: this exact send already landed, and the owner pressing
    // again almost certainly means they never saw it succeed.
    $app.logger().info("owner/send duplicate", "cafe", card.id, "send_id", sendId);
    return e.json(200, { sent: 0, skipped: 0, duplicate: true });
  }

  $app.logger().info("owner/send", "cafe", card.id, "sent", sent, "skipped", skipped, "reward", disc ? deal : "");
  return e.json(200, { sent: sent, skipped: skipped, duplicate: false });
});
