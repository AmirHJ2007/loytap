/// <reference path="../pb_data/types.d.ts" />

// Marking a customer's messages as seen.
//
//   POST /messages/seen  (customer auth) -> { marked: <n> }
//
// This exists because a PocketBase updateRule says WHO may write a record,
// not WHICH fields of it. Opening `messages` to its recipient so they could
// flip `read` would equally let them rewrite the body of a message their café
// sent them, or re-point it at a different reward. So the collection stays
// shut to the API (1700000031_messages.js) and this endpoint is the only way
// `read` ever changes — it touches that one field and nothing else.
//
// The filter pins `user` to the caller's own id, so there is no id to pass in
// and no way to spend this endpoint on somebody else's inbox. Nothing here
// trusts the request body at all.
//
// Self-contained callback, no shared top-level helpers — see the note at the
// top of card.pb.js for why that matters in the PocketBase JS hook runtime.

routerAdd("POST", "/messages/seen", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Sign in first", code: "AUTH_REQUIRED" });

  let rows = [];
  try {
    // Capped: a bell badge is not worth an unbounded write loop, and nobody
    // has 500 unread messages from a café without something else being wrong.
    rows = $app.findRecordsByFilter("messages", "user = {:u} && read = false", "-created", 500, 0, { u: u.id });
  } catch (err) {
    $app.logger().error("messages/seen lookup failed", "error", String(err));
    return e.json(500, { error: "Could not read your messages", code: "MESSAGES_READ_FAILED" });
  }

  let marked = 0;
  for (const r of rows) {
    r.set("read", true);
    try { $app.save(r); marked++; } catch (err) {
      // One row that will not save is not a reason to leave the rest unread;
      // the badge is allowed to be one too high until the next open.
      $app.logger().error("messages/seen save failed", "id", r.id, "error", String(err));
    }
  }

  return e.json(200, { marked: marked });
});
