/// <reference path="../pb_data/types.d.ts" />

// Café staff login by shared code:  POST /staff/login { code } -> { token, cafe_name }
// The code maps to that café's staff service-account and returns its session token.
// Each café has its own code, so this matches across every café, not just one.
//
// Brute-force protection (staff_login_attempts, migration 1700000019):
//   5 failures inside 15 minutes  -> that IP is refused for 15 minutes
//   5 more failures after serving a lockout -> escalates to 1 hour
//   a successful login clears the IP's record
// Counted PER CLIENT IP, never per café or per code: a café-keyed counter
// would let anyone knock a real café's till offline during service just by
// typing garbage at it. Nobody can ever trigger a lockout for someone else.
// While locked we answer 429 before the code is even looked at, and every
// rejection is the same opaque "Wrong code" — no hint about prefixes or how
// close a guess was.
//
// !! e.realIP() only returns the true client IP if Settings > trustedProxy is
// configured (headers: ["X-Forwarded-For"]). Unconfigured it falls back to
// remoteIP(), which behind Liara's proxy is the SAME address for every
// request on earth — the limiter would then lock out every café at once. The
// failure path logs a loud error when it detects that state; see the
// deployment note in the repo README/handover.
//
// NOTE: PocketBase runs each handler in an isolated JS runtime, so this
// callback is fully self-contained — no file-level helpers (same rule as
// otp.pb.js / card.pb.js).

routerAdd("POST", "/staff/login", (e) => {
  const MAX_FAILS = 5;
  const WINDOW_MS = 15 * 60 * 1000;
  const LOCK_MS = 15 * 60 * 1000;       // first lockout
  const LOCK_ESCALATED_MS = 60 * 60 * 1000; // second and beyond
  const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

  const now = Date.now();
  // pb stores/compares datetimes as "YYYY-MM-DD HH:MM:SS.sssZ"
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };

  // says roughly how long to wait, and nothing at all about the code tried
  const lockedOut = (until) => {
    const left = until - now;
    const mins = Math.max(1, Math.ceil(left / 60000));
    const wait = mins >= 60 ? "about an hour" : "about " + mins + (mins === 1 ? " minute" : " minutes");
    try { e.response.header().set("Retry-After", String(Math.ceil(left / 1000))); } catch (err) {}
    return e.json(429, {
      error: "Too many incorrect codes from this device. Please wait " + wait + " and try again.",
      // the client builds its own sentence from retry_after, so the wait never
      // has to be translated as pre-baked English prose
      code: "STAFF_LOCKED",
      retry_after: Math.ceil(left / 1000),
    });
  };

  let ip = "";
  try { ip = String(e.realIP() || ""); } catch (err) { ip = ""; }
  if (!ip) { try { ip = String(e.remoteIP() || ""); } catch (err) { ip = ""; } }
  if (!ip) ip = "unknown";

  // opportunistic prune so the collection can't grow without bound — a row
  // untouched for a day is past even the longest (1h) lockout, so dropping it
  // is the same as the clean slate it already represents
  if (Math.random() < 0.05) {
    try {
      const stale = $app.findRecordsByFilter("staff_login_attempts", "updated < {:cut}", "", 200, 0, { cut: dbTime(now - PRUNE_AFTER_MS) });
      for (const r of stale) $app.delete(r);
    } catch (err) {}
  }

  let att = null;
  try { att = $app.findFirstRecordByFilter("staff_login_attempts", "ip = {:ip}", { ip }); } catch (err) { att = null; }

  // already locked out → refuse before looking at the code at all
  if (att) {
    const until = msOf(att.get("locked_until"));
    if (until > now) return lockedOut(until);
  }

  // an empty box isn't a guess — never counted
  const code = String(e.requestInfo().body.code || "").trim().toUpperCase();
  if (!code) return e.json(400, { error: "Enter the café code", code: "STAFF_CODE_REQUIRED" });

  // codes are stored uppercase, so query the (uniquely indexed) column
  // directly — the old load-500-rows-and-linear-scan silently stopped
  // matching real cafés past the 500th row
  let codeRec = null;
  try { codeRec = $app.findFirstRecordByFilter("staff_codes", "code = {:code}", { code }); } catch (err) { codeRec = null; }

  if (!codeRec) {
    // ---- failure path: this is the only place the counter goes up ----
    let lockedUntil = 0;
    let left = 0; // guesses remaining after this one, for the client's warning
    try {
      if (!att) {
        att = new Record($app.findCollectionByNameOrId("staff_login_attempts"));
        att.set("ip", ip);
        att.set("fails", 0);
        att.set("lockouts", 0);
        att.set("window_start", dbTime(now));
      }

      let fails = att.getInt("fails");
      const winStart = msOf(att.get("window_start"));
      if (!winStart || now - winStart > WINDOW_MS) { fails = 0; att.set("window_start", dbTime(now)); } // window rolled over
      fails += 1;
      att.set("fails", fails);
      left = Math.max(0, MAX_FAILS - fails);

      if (fails >= MAX_FAILS) {
        const lockouts = att.getInt("lockouts") + 1;
        lockedUntil = now + (lockouts >= 2 ? LOCK_ESCALATED_MS : LOCK_MS);
        att.set("lockouts", lockouts);
        att.set("locked_until", dbTime(lockedUntil));
        att.set("fails", 0);                   // fresh count for after the lockout
        att.set("window_start", dbTime(now));
        $app.logger().warn("staff login locked out", "ip", ip, "lockouts", lockouts);

        // behind a proxy with no trustedProxy setting every request shares one
        // IP, so this lockout would hit every café at once — say so loudly
        try {
          const cfg = $app.settings().trustedProxy;
          const fwd = e.requestInfo().headers.x_forwarded_for;
          if (fwd && (!cfg || !cfg.headers || cfg.headers.length === 0)) {
            $app.logger().error(
              "staff login lockout on a possibly SHARED proxy IP — set Settings > trustedProxy (X-Forwarded-For) or every café is locked out together",
              "ip", ip
            );
          }
        } catch (err) {}
      }

      $app.save(att);
    } catch (err) {
      lockedUntil = 0; // nothing was recorded — don't claim a lockout we didn't store
      left = 0;        // and don't promise guesses we failed to count
      $app.logger().error("staff login attempt counter failed", "error", String(err));
    }

    // the failure that trips the limit says so straight away, rather than
    // leaving staff to hit "Wrong code" once more before being told to wait
    if (lockedUntil > now) return lockedOut(lockedUntil);
    // say how many guesses are left rather than letting the till be cut off
    // mid-service with no warning — same reasoning as /owner/login
    if (left > 0) return e.json(401, { error: "Wrong code", code: "STAFF_CODE_WRONG", attempts_left: left });
    return e.json(401, { error: "Wrong code", code: "STAFF_CODE_WRONG" });
  }

  let card = null;
  try { card = $app.findRecordById("cafe_card", codeRec.getString("cafe")); } catch (err) { card = null; }
  if (!card) return e.json(500, { error: "Café missing", code: "CAFE_MISSING" });

  let staff = null;
  try { staff = $app.findRecordById("users", card.getString("staff_user")); } catch (err) { staff = null; }
  if (!staff) return e.json(500, { error: "Staff account missing", code: "STAFF_ACCOUNT_MISSING" });

  // good code → this IP starts clean again
  try { if (att) $app.delete(att); } catch (err) {}

  // Static 24h token, deliberately not the (now 14-day, customer-only)
  // collection default — see owner.pb.js's /owner/register for the same
  // reasoning: a staff token can confirm/deny stamps and redeem rewards.
  const token = staff.newStaticAuthToken(24 * 60 * 60 * 1e9);
  return e.json(200, {
    token,
    cafe_name: card.getString("cafe_name"),
    name: staff.getString("name"),
    role: staff.getString("role"),
  });
});

// Staff session refresh — same reasoning and pattern as owner.pb.js's
// /owner/session/refresh: staff tokens are static (non-refreshable), so
// PocketBase's core auth-refresh endpoint can't extend one — it just hands
// back an equivalent token with the same unchanged expiry. This route mints
// a fresh 24h static token instead. staff.js calls it once per page load:
// a staff member who opens the scanner at least once every 24h never sees
// the wall-clock expiry; anyone who stays away longer has to sign back in
// with the café code.
//   POST /staff/session/refresh  (staff auth) -> { token }
routerAdd("POST", "/staff/session/refresh", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "staff") return e.json(403, { error: "Staff access only", code: "STAFF_ONLY" });
  return e.json(200, { token: u.newStaticAuthToken(24 * 60 * 60 * 1e9) });
}, $apis.requireAuth());

// The café's own tap link, for the QR the staff page shows customers.
//   GET /staff/cafe  (staff or owner auth) -> { cafe_name, tap_url }
//
// READ ONLY, and deliberately a route rather than opened-up collection rules.
// nfc_tags stays listRule/viewRule null — superusers only — exactly as it was;
// this handler reads it through $app, which bypasses API rules by design. So
// staff gain the ability to SEE their own café's tap link and nothing else:
// not another café's, not the tag record, and no way to write one.
//
// Scoped "staff_user OR owner_user" like /redeem in redeem.pb.js, so an owner
// who opens the staff page on a till also gets a working code.
//
// WHAT THIS LINK IS. The same URL the café's physical NFC tag carries. A
// customer whose phone will not tap — an older iPhone, an Android without NFC,
// a tag that has worn out — scans the screen and lands in exactly the same
// place. It only ever creates a PENDING stamp request; a human still has to
// approve it from this same page, which is what keeps a photographed screen
// from being free stamps.
//
//   403 not staff/owner   404 no café, or the café has no active tag
routerAdd("GET", "/staff/cafe", (e) => {
  const u = e.auth;
  const role = u ? u.getString("role") : "";
  if (role !== "staff" && role !== "admin") {
    return e.json(403, { error: "Staff access only", code: "STAFF_ONLY" });
  }

  let card = null;
  try {
    card = $app.findFirstRecordByFilter("cafe_card", "staff_user = {:u} || owner_user = {:u}", { u: u.id });
  } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café linked to this account", code: "NO_CAFE_LINKED" });

  // oldest active tag first: a café is created with one, and if more are ever
  // added the original is the one already printed on whatever is on the counter
  let tag = null;
  try {
    tag = $app.findRecordsByFilter("nfc_tags", "cafe = {:c} && active = true", "created", 1, 0, { c: card.id })[0];
  } catch (err) { tag = null; }
  if (!tag) return e.json(404, { error: "This café has no active tag yet", code: "NO_TAG" });

  // Built here, not on the client, so the origin lives in one place — the same
  // reloy.ir form notify.pb.js writes into the tag-programming email. app. is
  // deliberately not used: index.guard.js lets ?t= override the marketing
  // redirect, so this reaches the wallet even for a signed-out customer.
  return e.json(200, {
    cafe_name: card.getString("cafe_name"),
    tap_url: "https://reloy.ir/?t=" + tag.getString("code"),
  });
}, $apis.requireAuth());
