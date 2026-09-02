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
  if (!code) return e.json(400, { error: "Enter the café code" });

  // codes are stored uppercase, so query the (uniquely indexed) column
  // directly — the old load-500-rows-and-linear-scan silently stopped
  // matching real cafés past the 500th row
  let codeRec = null;
  try { codeRec = $app.findFirstRecordByFilter("staff_codes", "code = {:code}", { code }); } catch (err) { codeRec = null; }

  if (!codeRec) {
    // ---- failure path: this is the only place the counter goes up ----
    let lockedUntil = 0;
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
      $app.logger().error("staff login attempt counter failed", "error", String(err));
    }

    // the failure that trips the limit says so straight away, rather than
    // leaving staff to hit "Wrong code" once more before being told to wait
    if (lockedUntil > now) return lockedOut(lockedUntil);
    return e.json(401, { error: "Wrong code" });
  }

  let card = null;
  try { card = $app.findRecordById("cafe_card", codeRec.getString("cafe")); } catch (err) { card = null; }
  if (!card) return e.json(500, { error: "Café missing" });

  let staff = null;
  try { staff = $app.findRecordById("users", card.getString("staff_user")); } catch (err) { staff = null; }
  if (!staff) return e.json(500, { error: "Staff account missing" });

  // good code → this IP starts clean again
  try { if (att) $app.delete(att); } catch (err) {}

  const token = staff.newAuthToken();
  return e.json(200, {
    token,
    cafe_name: card.getString("cafe_name"),
    name: staff.getString("name"),
    role: staff.getString("role"),
  });
});
