/// <reference path="../pb_data/types.d.ts" />

// Web push for staff tills: subscribe/unsubscribe, the trigger that fires a
// notification when a customer asks for a stamp, and the cleanup that drops
// subscriptions the push services have declared dead.
//
// The protocol itself lives in webpush.js (and the primitives it needs in
// webpush_crypto.js). This file is only policy: who may subscribe, what the
// notification says, and when it is sent.
//
// NOTHING HERE MAY BREAK A STAMP REQUEST. The trigger runs inside the
// customer's /card/stamp/request call, so every path through it is wrapped:
// an unconfigured VAPID key, a café with no tills, a missing openssl — all of
// them must end in a logged line and a stamp request that still works. A
// notification nobody is waiting on must never take down the thing it reports.
//
// NOTE: each handler below is self-contained — no file-level helpers — for
// the same reason as otp.pb.js and card.pb.js: pb_hooks callbacks run in a
// pooled JSVM that cannot see this file's outer scope. Shared logic lives in
// webpush.js and is require()d inside each handler.

// ---------------------------------------------------------------------------
// the key the browser needs before it can subscribe
// ---------------------------------------------------------------------------
// Not a secret — it is handed to every subscribing device and travels in the
// clear in each push — but it is behind staff auth anyway, because only a
// signed-in till has any use for it.
routerAdd("GET", "/staff/push/key", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { error: "Staff access only", code: "STAFF_ONLY" });
  }
  const W = require(`${__hooks}/webpush.js`);
  const cfg = W.vapidConfig();
  if (!cfg) return e.json(503, { error: "Push is not configured on this server", code: "PUSH_NOT_CONFIGURED" });
  return e.json(200, { key: cfg.publicKey });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------
//   POST /staff/push/subscribe  { endpoint, keys: { p256dh, auth }, label?, lang? }
//
// Upserts on endpoint. Re-subscribing the same device — which browsers do on
// their own when a subscription is refreshed — must land on the existing row,
// or a till accumulates duplicates and gets four copies of every push.
routerAdd("POST", "/staff/push/subscribe", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { error: "Staff access only", code: "STAFF_ONLY" });
  }

  const W = require(`${__hooks}/webpush.js`);
  if (!W.vapidConfig()) {
    return e.json(503, { error: "Push is not configured on this server", code: "PUSH_NOT_CONFIGURED" });
  }

  const body = e.requestInfo().body || {};
  const endpoint = String(body.endpoint || "").trim();
  const keys = body.keys || {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  const label = String(body.label || "").trim().slice(0, 80);
  const lang = String(body.lang || "fa") === "en" ? "en" : "fa";

  if (!endpoint || !p256dh || !auth) {
    return e.json(400, { error: "Missing subscription fields", code: "MISSING_FIELDS" });
  }
  // See the note on PUSH_HOSTS in webpush.js — this is the SSRF guard, and it
  // is the only thing deciding where this server can be told to send requests.
  if (!W.allowedPushEndpoint(endpoint)) {
    return e.json(400, { error: "Unrecognised push endpoint", code: "BAD_ENDPOINT" });
  }
  // Length-check the keys here rather than at send time: a malformed key
  // should be refused by the device that offered it, not discovered later as
  // a push that silently never arrives.
  const C = require(`${__hooks}/webpush_crypto.js`);
  if (C.b64urlDecode(p256dh).length !== 65) {
    return e.json(400, { error: "p256dh must be a 65-byte P-256 point", code: "BAD_P256DH" });
  }
  if (C.b64urlDecode(auth).length !== 16) {
    return e.json(400, { error: "auth must be 16 bytes", code: "BAD_AUTH" });
  }

  // the café this till belongs to — staff sign in as the café's service account
  let cafe = null;
  try {
    cafe = $app.findFirstRecordByFilter("cafe_card", "staff_user = {:u} || owner_user = {:u}", { u: u.id });
  } catch (err) { cafe = null; }
  if (!cafe) return e.json(403, { error: "No café for this account", code: "NO_CAFE" });

  let row = null;
  try { row = $app.findFirstRecordByFilter("push_subs", "endpoint = {:ep}", { ep: endpoint }); }
  catch (err) { row = null; }
  if (!row) row = new Record($app.findCollectionByNameOrId("push_subs"));

  row.set("cafe", cafe.id);
  row.set("endpoint", endpoint);
  row.set("p256dh", p256dh);
  row.set("auth", auth);
  row.set("label", label);
  row.set("lang", lang);
  // Written explicitly rather than left to the field default, and written on
  // every upsert: this is also the path that RE-CLAIMS an endpoint. An owner
  // who turns subscription reminders off and then sets the same phone up as a
  // till must end up with a till row, not an owner row wearing a till's
  // label — the endpoint is unique, so this save lands on the existing row.
  row.set("scope", "till");
  $app.save(row);

  return e.json(200, { ok: true });
});

// ---------------------------------------------------------------------------
// unsubscribe
// ---------------------------------------------------------------------------
// Deliberately NOT scoped to the caller's café. A device that is turning
// notifications off should always succeed; refusing because the row belongs
// to a café the till has since been re-registered to would leave it receiving
// pushes it cannot stop. The endpoint is unguessable, so holding one is
// enough to prove you are that device.
routerAdd("POST", "/staff/push/unsubscribe", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { error: "Staff access only", code: "STAFF_ONLY" });
  }
  const endpoint = String((e.requestInfo().body || {}).endpoint || "").trim();
  if (!endpoint) return e.json(400, { error: "Missing endpoint", code: "MISSING_FIELDS" });

  try {
    const row = $app.findFirstRecordByFilter("push_subs", "endpoint = {:ep}", { ep: endpoint });
    if (row) $app.delete(row);
  } catch (err) { /* already gone — the caller wanted it gone, so that is a success */ }

  return e.json(200, { ok: true });
});

// ===========================================================================
// the owner's own phone
// ===========================================================================
// Three routes mirroring the staff ones above, for a different audience and a
// different message: subscription deadlines, sent by the daily sweep in
// subscriptions.pb.js, with the text in subpush.js.
//
// WHY SEPARATE ROUTES AT ALL, when an owner is role "admin" and the staff
// routes already let one through. Two reasons, both about not having to be
// careful later:
//
//   the scope field  a device registered here is scope "owner" and a device
//                    registered there is scope "till". That distinction is
//                    the only thing keeping billing text off a barista's
//                    lock screen, so it belongs in the route, not in a flag
//                    the caller passes and could get wrong.
//   the role check   the staff routes accept "admin" because an owner
//                    standing at their own counter is a legitimate till. If
//                    that is ever tightened to staff-only, the owner's bell
//                    must not break with it.
//
// No label is taken. A till's label exists so the owner can tell two counters
// apart in a list; an owner's own phone is not in any list, and a free-text
// field nothing reads is a field that can only ever leak a user agent.

// The VAPID public key. Same key the tills get — it identifies this server to
// the push services, not the device — and not a secret, but behind auth
// anyway because only a signed-in owner has any use for it.
routerAdd("GET", "/owner/push/key", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }
  const W = require(`${__hooks}/webpush.js`);
  const cfg = W.vapidConfig();
  if (!cfg) return e.json(503, { error: "Push is not configured on this server", code: "PUSH_NOT_CONFIGURED" });
  return e.json(200, { key: cfg.publicKey });
});

// POST /owner/push/subscribe  { endpoint, keys: { p256dh, auth }, lang? }
//
// Upserts on endpoint, like the staff route, because browsers re-subscribe a
// device on their own and a second row means two copies of every reminder.
routerAdd("POST", "/owner/push/subscribe", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }

  const W = require(`${__hooks}/webpush.js`);
  if (!W.vapidConfig()) {
    return e.json(503, { error: "Push is not configured on this server", code: "PUSH_NOT_CONFIGURED" });
  }

  const body = e.requestInfo().body || {};
  const endpoint = String(body.endpoint || "").trim();
  const keys = body.keys || {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  const lang = String(body.lang || "fa") === "en" ? "en" : "fa";

  if (!endpoint || !p256dh || !auth) {
    return e.json(400, { error: "Missing subscription fields", code: "MISSING_FIELDS" });
  }
  // The SSRF guard — see the note on PUSH_HOSTS in webpush.js. This is the
  // only thing deciding where this server can later be told to send requests.
  if (!W.allowedPushEndpoint(endpoint)) {
    return e.json(400, { error: "Unrecognised push endpoint", code: "BAD_ENDPOINT" });
  }
  const C = require(`${__hooks}/webpush_crypto.js`);
  if (C.b64urlDecode(p256dh).length !== 65) {
    return e.json(400, { error: "p256dh must be a 65-byte P-256 point", code: "BAD_P256DH" });
  }
  if (C.b64urlDecode(auth).length !== 16) {
    return e.json(400, { error: "auth must be 16 bytes", code: "BAD_AUTH" });
  }

  // owner_user ONLY, unlike the staff route's `staff_user = {:u} ||
  // owner_user = {:u}`. A café's staff service account must not be able to
  // register itself for the owner's billing reminders, and the role check
  // above is not enough on its own — it asks what this account is, not whose
  // café this is.
  let cafe = null;
  try { cafe = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:u}", { u: u.id }); }
  catch (err) { cafe = null; }
  if (!cafe) return e.json(403, { error: "No café for this account", code: "NO_CAFE" });

  let row = null;
  try { row = $app.findFirstRecordByFilter("push_subs", "endpoint = {:ep}", { ep: endpoint }); }
  catch (err) { row = null; }
  if (!row) row = new Record($app.findCollectionByNameOrId("push_subs"));

  row.set("cafe", cafe.id);
  row.set("endpoint", endpoint);
  row.set("p256dh", p256dh);
  row.set("auth", auth);
  row.set("label", "");
  row.set("lang", lang);
  row.set("scope", "owner");
  $app.save(row);

  return e.json(200, { ok: true });
});

// Deliberately not scoped to the caller's café, for the same reason as the
// staff route: turning notifications off must always succeed, and holding an
// unguessable endpoint is proof enough of being that device.
routerAdd("POST", "/owner/push/unsubscribe", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }
  const endpoint = String((e.requestInfo().body || {}).endpoint || "").trim();
  if (!endpoint) return e.json(400, { error: "Missing endpoint", code: "MISSING_FIELDS" });

  try {
    const row = $app.findFirstRecordByFilter("push_subs", "endpoint = {:ep}", { ep: endpoint });
    if (row) $app.delete(row);
  } catch (err) { /* already gone — the caller wanted it gone, so that is a success */ }

  return e.json(200, { ok: true });
});

// ---------------------------------------------------------------------------
// the trigger
// ---------------------------------------------------------------------------
// AfterCreateSuccess, so the request has really committed — never notify
// staff about a stamp request that then rolled back.
//
// The expensive part (ECDH + encryption, two openssl spawns per device) runs
// inline because it is local and fast. The POST does not: see the comment on
// postPush's spool option. A café with two tills therefore costs roughly
// 60-100ms of local crypto on the customer's request, and zero network wait.
onRecordAfterCreateSuccess((e) => {
  // The body is a nested function purely so its early returns cannot skip the
  // e.next() below — see the comment there for why that matters.
  (function sendStampRequestPush() {
   try {
    const req = e.record;
    if (req.getString("status") !== "pending") return;

    const cafeId = req.getString("cafe");
    if (!cafeId) return;

    const W = require(`${__hooks}/webpush.js`);
    const cfg = W.vapidConfig();
    if (!cfg) return; // push not set up on this server — nothing to do, quietly

    // scope != "owner" keeps this off the owner's own phone. The owner is a
    // café's admin and may well have a till subscribed too, which is fine —
    // what must never happen is the reverse: a device that subscribed to be
    // told about SUBSCRIPTION deadlines (owner.push.js) receiving a customer
    // name on its lock screen. Rows written before the scope field exists
    // read back as "" and are tills, which is what they are.
    let subs = [];
    try { subs = $app.findRecordsByFilter("push_subs", 'cafe = {:c} && scope != "owner"', "-created", 20, 0, { c: cafeId }); }
    catch (err) { subs = []; }
    if (!subs.length) return;

    // The customer's name, as card.pb.js copied it onto the request. It is
    // user-supplied, so it gets cleaned before going anywhere near a lock
    // screen: control characters stripped, whitespace collapsed, and capped
    // so a 200-character "name" cannot push the actual point off the display.
    // Nothing here is an injection risk — a notification body is plain text,
    // never markup — this is purely about staying legible.
    const name = (req.getString("user_name") || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);

    // No name on the account falls back to the generic sentence rather than
    // the staff panel's "A customer" placeholder — "A customer is waiting"
    // reads as a sentence, "یک مشتری منتظر تأیید است" does too, and neither
    // pretends to know something it does not.
    // BIDIRECTIONAL TEXT. A notification body is plain text with no dir
    // attribute, so the renderer guesses the paragraph direction from the
    // first strong character. "Milad منتظر تأیید است" starts with a Latin M,
    // so the whole line is laid out left-to-right and the name lands on the
    // LEFT — wrong for a Persian sentence, where it belongs on the right.
    // A Persian name in the English sentence has the mirror-image problem.
    //
    //   RLM \u200f / LRM \u200e  an invisible strong character that pins the
    //                            paragraph direction regardless of the name
    //   FSI \u2068 ... PDI \u2069  isolates the name so its own direction
    //                            cannot reorder the sentence around it
    //
    // Both are zero-width: they change layout, never what is read aloud or
    // what the text compares equal to.
    const rtl = (n) => "\u200f\u2068" + n + "\u2069";
    const ltr = (n) => "\u200e\u2068" + n + "\u2069";

    // A stamp request dies 30s after it is created (REQUEST_TTL_MS in
    // card.pb.js). The notification says so, and the service worker closes
    // itself at the deadline — see sw.js. Kept in step with card.pb.js by
    // hand: there is no shared constant across the Go/JS boundary.
    const TTL_SECONDS = 30;

    // Every string the service worker needs travels with the message. It
    // cannot read i18n.js — a service worker has no access to the page's
    // scripts — so the server, which knows this till's language, sends the
    // button labels and result lines rather than the worker guessing.
    const TEXT = {
      fa: {
        title: "درخواست مهر جدید",
        body: (name ? rtl(name) + " منتظر تأیید است" : "یک مشتری منتظر تأیید است")
              + " · " + TTL_SECONDS + " ثانیه فرصت",
        approve: "تأیید",
        deny: "رد",
        approved: "مهر ثبت شد",
        denied: "درخواست رد شد",
        expired: "فرصت تمام شد — درخواست منقضی شده بود",
        failed: "انجام نشد — پنل را باز کنید",
      },
      en: {
        title: "New stamp request",
        body: (name ? ltr(name) + " is waiting for approval" : "A customer is waiting for approval")
              + " · " + TTL_SECONDS + "s to respond",
        approve: "Approve",
        deny: "Deny",
        approved: "Stamp added",
        denied: "Request denied",
        expired: "Too late — the request had expired",
        failed: "Did not go through — open the panel",
      },
    };

    const spool = W.spoolPath();
    for (const s of subs) {
      try {
        const t = TEXT[s.getString("lang") === "en" ? "en" : "fa"];
        const message = JSON.stringify({
          title: t.title,
          body: t.body,
          url: "/staff",
          // What the Approve/Deny buttons act on, and when they stop being
          // valid. expiresAt is absolute epoch-ms rather than a duration: a
          // push can sit in a queue for a while, and a device that computed
          // "now + 30s" on arrival would keep a dead button alive.
          requestId: req.id,
          expiresAt: Date.now() + TTL_SECONDS * 1000,
          i18n: {
            approve: t.approve, deny: t.deny, approved: t.approved,
            denied: t.denied, expired: t.expired, failed: t.failed,
          },
          // Per-request, NOT a shared "stamp-request" tag. A shared tag
          // collapses repeats into one notification, which was right while
          // every message was identical — but now that the body names a
          // person, replacing "Ali is waiting" with "Sara is waiting" would
          // quietly drop Ali, and staff would never know he was there. Two
          // customers waiting is exactly when the till most needs telling.
          tag: req.id,
        });
        W.sendOne({
          endpoint: s.getString("endpoint"),
          p256dh: s.getString("p256dh"),
          auth: s.getString("auth"),
        }, message, cfg, 45, { spool: spool });
        // TTL 45s, just over the 30s a stamp request lives for.
        //
        // This was 600, which contradicted its own comment: it told the push
        // service to hold an undelivered message for TEN MINUTES. On a
        // network where FCM is throttled — which is the normal case for
        // Chrome in Iran — Google queues the push and releases it when the
        // device reconnects, so staff get "Ali منتظر تأیید است" long after
        // Ali gave up and left. Worse, the notification looks actionable:
        // tapping تأیید just reports that the request expired.
        //
        // 45 seconds means a push that cannot be delivered while it still
        // matters is dropped by the push service instead of arriving as a
        // lie. Late and useless is worse than absent.
      } catch (err) {
        try { $app.logger().warn("push send failed", "sub", s.id, "err", String(err)); } catch (e2) {}
      }
    }
   } catch (err) {
    try { $app.logger().error("stamp-request push hook failed", "err", String(err)); } catch (e2) {}
   }
  })();

  // MUST be called, and must be called on EVERY path out of this handler.
  //
  // PocketBase hooks are a chain, and its own realtime broadcast is a link in
  // it. A handler that returns without e.next() stops the chain dead — so
  // omitting this does not merely skip some internal bookkeeping, it stops
  // the staff panel's live request queue from ever seeing a new stamp
  // request. That is the in-app path staff actually rely on, silently broken
  // by a notification feature that is supposed to be additive.
  //
  // Hence the structure: every early return above is inside the try, and the
  // single exit point is here. Do not add a bare `return` to this handler.
  e.next();
}, "stamp_requests");

// ---------------------------------------------------------------------------
// reaping dead subscriptions
// ---------------------------------------------------------------------------
// Because the POST is detached, its HTTP status is not available where the
// push is sent — the backgrounded curl appends "<status> <endpoint>" to a
// spool file instead, and this drains it.
//
// 404 and 410 are the push services saying a subscription is permanently
// gone: the app was uninstalled, the browser data cleared, the subscription
// rotated. Those rows are deleted. Everything else (a 5xx, a timeout showing
// as 000) is left completely alone — a café's wifi being down for an hour
// must not unsubscribe their till.
cronAdd("push-reap", "*/5 * * * *", () => {
  try {
    const W = require(`${__hooks}/webpush.js`);
    const spool = W.spoolPath();

    let text = "";
    try {
      const raw = W.toBytes($os.cmd("sh", "-c", 'cat "$1" 2>/dev/null || true', "sh", spool).output());
      for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
    } catch (err) { return; }
    if (!text.trim()) return;

    // Truncate first. If deleting throws halfway we would rather lose a
    // cleanup hint than re-process the same lines every five minutes.
    try { $os.cmd("sh", "-c", ': > "$1"', "sh", spool).output(); } catch (err) {}

    let removed = 0;
    for (const line of text.split("\n")) {
      const m = /^(\d{3})\s+(\S+)/.exec(line.trim());
      if (!m) continue;
      const status = parseInt(m[1], 10);
      if (status !== 404 && status !== 410) continue;
      try {
        const row = $app.findFirstRecordByFilter("push_subs", "endpoint = {:ep}", { ep: m[2] });
        if (row) { $app.delete(row); removed++; }
      } catch (err) {}
    }
    if (removed) {
      try { $app.logger().info("push-reap removed dead subscriptions", "count", removed); } catch (e2) {}
    }
  } catch (err) {
    try { $app.logger().error("push-reap failed", "err", String(err)); } catch (e2) {}
  }
});

// ---------------------------------------------------------------------------
// reaping subscriptions nothing has checked in on
// ---------------------------------------------------------------------------
// The 404/410 reaper above only removes subscriptions a push service admits
// are dead. Observed in practice: it does not catch everything. Delete a
// home-screen web app on iOS and its subscription dies with it, but APNs kept
// answering 201 for that endpoint rather than 410 — so the row survived, the
// reinstall added a second row beside it, and the till was notified twice for
// every stamp request.
//
// This is the other direction: instead of waiting to be told a device is
// gone, require every device to say it is still here. staff.push.js
// re-registers an existing subscription on each page load, which upserts the
// row and bumps `updated`. Anything that has not checked in for 30 days is a
// device that is not coming back.
//
// WHY 30 DAYS. A staff session lasts 7 (staff.pb.js), so a till still in use
// signs in — and therefore checks in — at least weekly. 30 days is four times
// that, which is the margin this wants: the failure mode of reaping too eagerly
// is silently unsubscribing working tills, and nobody would notice until a
// café complained that notifications stopped.
//
// Depends on PocketBase bumping `updated` on a save whose values are
// unchanged. Verified on 0.39.11 against a real re-registration. If that ever
// changes, this cron starts deleting live rows — the generous window and the
// log line below are what buy time to notice.
cronAdd("push-stale", "17 4 * * *", () => {
  try {
    const CUTOFF_DAYS = 30;
    // Capped per run. Nothing legitimate deletes dozens of rows in one night,
    // so if this ever starts sweeping it does so slowly and visibly rather
    // than wiping every café's tills in a single pass.
    const MAX_PER_RUN = 50;

    const cutoff = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().replace("T", " ");

    let stale = [];
    try {
      stale = $app.findRecordsByFilter("push_subs", "updated < {:c}", "updated", MAX_PER_RUN, 0, { c: cutoff });
    } catch (err) { return; }
    if (!stale.length) return;

    let removed = 0;
    for (const row of stale) {
      try {
        // Logged individually and before the delete: this is the only record
        // that a till stopped being notified, and "my notifications just
        // stopped" is otherwise an unanswerable support question.
        $app.logger().info("push-stale removing subscription",
          "sub", row.id, "label", row.getString("label"), "last_seen", row.getString("updated"));
      } catch (e2) {}
      try { $app.delete(row); removed++; } catch (err) {}
    }
    try { $app.logger().info("push-stale done", "removed", removed, "cutoff_days", CUTOFF_DAYS); } catch (e2) {}
  } catch (err) {
    try { $app.logger().error("push-stale failed", "err", String(err)); } catch (e2) {}
  }
});
