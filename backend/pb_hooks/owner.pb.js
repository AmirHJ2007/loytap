/// <reference path="../pb_data/types.d.ts" />

// Café owner login by phone + password, with an SMS second factor:
//   POST /owner/login        { phone, password } -> { otp_required:true, ttl }  (no token)
//   POST /owner/login/verify { phone, code }     -> { token, name, role, cafe_name }
// See the long note above /owner/login for why the password alone is no longer
// enough and why the challenge lives in its own collection.
//
// Forgot password, same SMS-code shape but no password needed to start it:
//   POST /owner/forgot-password        { phone }               -> { reset_required:true, ttl }
//   POST /owner/forgot-password/verify { phone, code, password } -> { ok:true }  (no token — sign in again)
// See the note above /owner/forgot-password for why this is yet another
// collection rather than reusing owner_login_challenges.

// Open self-serve café creation. Anyone can register: creates the admin (owner)
// user, a staff service-account, a cafe_card (name/tagline/accent + a generated
// staff code) and one NFC tag, then returns an owner token.
//
// The phone must be verified first: the client calls POST /otp/request for this
// phone (same OTP endpoint the customer flow uses), then submits the code here.
// A wrong or missing code fails before anything is created — no account, no
// café, nothing — so a mistyped/unowned phone number can never register a
// business.
//
// The code gets the same 5 guesses as everywhere else, and the 5th wrong one
// burns it and sends a replacement out of the same per-phone sms_budgets row
// /otp/request spends — never in addition to it. See /otp/verify in otp.pb.js,
// which consumes these same otp_codes rows with identical semantics.
//   POST /owner/register { name, phone, password, cafe_name, tagline?, accent?, code }
//     -> { token, name, role, cafe_name, staff_code, nfc }
//     401 { error }                                    no live code for this number
//     401 { error, attempts_left }                     wrong code, guesses remain
//     429 { error, regenerated:true, ttl, devCode? }   5th wrong code, new one sent
//     429 { error, regenerated:false, restart:true }   5th wrong code, none could be sent
routerAdd("POST", "/owner/register", (e) => {
  const MAX_ATTEMPTS = 5;
  const TTL_MS = 3 * 60 * 1000;
  const MAX_SENDS = 5;
  const SEND_WINDOW_MS = 15 * 60 * 1000;

  const now = Date.now();
  // pb stores/compares datetimes as "YYYY-MM-DD HH:MM:SS.sssZ"
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const b = e.requestInfo().body || {};
  const phone = norm(b.phone);
  const password = String(b.password || "");
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const cafeName = String(b.cafe_name || "").trim();
  const tagline = String(b.tagline || "").trim();
  const code = String(b.code || "").trim();
  let accent = String(b.accent || "#171717").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = "#171717";

  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Enter a valid mobile number." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return e.json(400, { error: "Enter a valid email address." });
  if (password.length < 6) return e.json(400, { error: "Password must be at least 6 characters." });
  if (!cafeName) return e.json(400, { error: "Enter your café's name." });
  if (!/^\d{6}$/.test(code)) return e.json(400, { error: "Enter the 6-digit code sent to your phone." });

  // verify the phone BEFORE creating anything — same rows /otp/verify uses.
  // Fetch by phone, not by phone+code: a wrong guess has to find the row in
  // order to be counted against it.
  let otp = null;
  try {
    otp = $app.findRecordsByFilter("otp_codes", "phone = {:phone} && expires > {:now}", "-created", 1, 0, { phone, now: dbTime(now) })[0];
  } catch (err) { otp = null; }
  if (!otp) return e.json(401, { error: "Invalid or expired code — try again." });

  // otp_codes stores "salt:sha256(salt:code)" — a legacy plaintext row has no
  // colon and matches nothing, so it just expires unused. Duplicated from
  // otp.pb.js: pb handlers run isolated and can't share a helper.
  const codeMatches = (stored, given) => {
    const t = String(stored || "");
    const i = t.indexOf(":");
    if (i < 1) return false;
    return $security.equal(t, t.slice(0, i) + ":" + $security.sha256(t.slice(0, i) + ":" + given));
  };

  if (!codeMatches(otp.getString("code_hash"), code)) {
    const attempts = otp.getInt("attempts") + 1;
    if (attempts < MAX_ATTEMPTS) {
      try {
        otp.set("attempts", attempts);
        $app.save(otp);
      } catch (err) {
        // the guess couldn't be recorded — destroy the code rather than leave
        // an uncounted one alive to be guessed at for free
        $app.logger().error("register attempt counter failed", "error", String(err));
        try { $app.delete(otp); } catch (err2) {}
        return e.json(401, { error: "Invalid or expired code — try again." });
      }
      return e.json(401, { error: "Incorrect code", attempts_left: MAX_ATTEMPTS - attempts });
    }

    // ---- 5th wrong code: burn it, try to send a fresh one in its place ----
    const restart = () => {
      try { $app.delete(otp); } catch (err) {}
      return e.json(429, { error: "Too many incorrect codes. Please start again.", regenerated: false, restart: true });
    };

    let bud = null;
    try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = 'otp'", { phone }); } catch (err) { bud = null; }
    let sends = bud ? bud.getInt("sends") : 0;
    let winStart = bud ? msOf(bud.get("window_start")) : 0;
    if (!winStart || now - winStart > SEND_WINDOW_MS) { sends = 0; winStart = now; }
    if (sends >= MAX_SENDS) return restart(); // regeneration is NOT exempt from the cap

    const fresh = $security.randomStringWithAlphabet(6, "0123456789");
    try {
      const salt = $security.randomString(16);
      otp.set("code_hash", salt + ":" + $security.sha256(salt + ":" + fresh));
      otp.set("expires", dbTime(now + TTL_MS));
      otp.set("attempts", 0); // a new code gets a fresh 5 guesses
      $app.save(otp);
    } catch (err) {
      $app.logger().error("register regenerate failed", "error", String(err));
      return restart();
    }

    // spend before sending: a provider that fails must never hand back a free send
    if (!bud) {
      bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
      bud.set("phone", phone);
      bud.set("purpose", "otp");
    }
    bud.set("sends", sends + 1);
    bud.set("window_start", dbTime(winStart));
    bud.set("last_sent", dbTime(now));
    try { $app.save(bud); } catch (err) { $app.logger().error("otp budget save failed", "error", String(err)); }

    const ttl = Math.round(TTL_MS / 1000);
    const msg = "Too many incorrect codes. We've sent you a new one.";
    const kavKey = $os.getenv("KAVENEGAR_API_KEY");
    if (kavKey) {
      try {
        $http.send({
          url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + fresh + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
          method: "GET",
          timeout: 10,
        });
      } catch (err) {
        $app.logger().error("register SMS resend failed", "error", String(err));
        return restart();
      }
      return e.json(429, { error: msg, regenerated: true, ttl });
    }

    // no provider: only echo the code when dev mode is explicitly opted into.
    // without it we must NOT hand it back — fail closed like /otp/request
    if ($os.getenv("OTP_DEV_MODE") === "1") {
      $app.logger().info("register OTP regenerated (dev)", "phone", phone, "code", fresh);
      return e.json(429, { error: msg, regenerated: true, ttl, devCode: fresh });
    }
    $app.logger().error("register OTP blocked: no SMS provider — set KAVENEGAR_API_KEY (or OTP_DEV_MODE=1 for local development)");
    return restart();
  }
  $app.delete(otp);

  // A phone may already have a customer account — that's a separate identity
  // from a business account, so only block on an existing *business* account.
  let exists = null;
  try { exists = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'admin'", { phone }); } catch (err) { exists = null; }
  if (exists) return e.json(409, { error: "This number already has a business registered. Sign in instead.", exists: true });

  let emailExists = null;
  try { emailExists = $app.findFirstRecordByFilter("users", "email = {:email}", { email }); } catch (err) { emailExists = null; }
  if (emailExists) return e.json(409, { error: "This email is already registered. Sign in instead.", exists: true });

  // owner (admin) account
  const owner = new Record($app.findCollectionByNameOrId("users"));
  owner.set("phone", phone);
  owner.set("email", email);
  owner.set("name", name || "Owner");
  owner.set("role", "admin");
  owner.set("verified", true);
  owner.setPassword(password);
  $app.save(owner);

  // staff service-account (staff sign in with the shared code, not a phone)
  const staffPhone = "staff-" + $security.randomStringWithAlphabet(10, "abcdefghijklmnopqrstuvwxyz0123456789");
  const staff = new Record($app.findCollectionByNameOrId("users"));
  staff.set("phone", staffPhone);
  staff.set("email", staffPhone + "@staff.loytap");
  staff.set("name", cafeName + " Staff");
  staff.set("role", "staff");
  staff.set("verified", true);
  staff.setPassword($security.randomString(30));
  $app.save(staff);

  // a readable, unique staff code: 3 letters of the café name + 5 random chars
  // from a confusable-free alphabet (no O/0, no I/1/L) — ~28M codes per prefix,
  // instead of the 10k of the old SLUG-NNNN.
  //
  // Handler functions run in their own JSVM context and can't see file-scope
  // helpers (same reason `norm` is redeclared in every route above), and
  // pb_migrations is a separate context again — so this generator is duplicated
  // in backend/pb_migrations/1700000018_rotate_staff_codes.js. Keep both in sync.
  const makeStaffCode = (name) => {
    const AB = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    // fa/ar café names contain no A-Z at all, so a name that yields fewer than
    // 3 usable letters falls back to CAF rather than a 0/1/2-letter prefix
    const letters = String(name || "").toUpperCase().replace(/[^A-Z]/g, "");
    const prefix = letters.length >= 3 ? letters.slice(0, 3) : "CAF";
    for (let i = 0; i < 8; i++) {
      const cand = prefix + "-" + $security.randomStringWithAlphabet(5, AB);
      let clash = null;
      try { clash = $app.findFirstRecordByFilter("staff_codes", "code = {:c}", { c: cand }); } catch (err) { clash = null; }
      if (!clash) return cand;
    }
    // every attempt clashed — widen the random part, never weaken it
    return prefix + "-" + $security.randomStringWithAlphabet(12, AB);
  };
  const staffCode = makeStaffCode(cafeName);

  // the café card
  const card = new Record($app.findCollectionByNameOrId("cafe_card"));
  card.set("cafe_name", cafeName);
  card.set("tagline", tagline);
  card.set("accent", accent);
  card.set("stamps_required", 8);
  card.set("reward_expiry_days", 30);
  card.set("stamp_cooldown_minutes", 0);
  card.set("min_purchase", 0);
  card.set("staff_user", staff.id);
  card.set("owner_user", owner.id);
  $app.save(card);

  // staff_code lives in its own locked-down collection — never exposed via
  // cafe_card's (intentionally public, for the customer wallet) read rules.
  const codeRec = new Record($app.findCollectionByNameOrId("staff_codes"));
  codeRec.set("cafe", card.id);
  codeRec.set("code", staffCode);
  $app.save(codeRec);

  // a starter 10% discount so the café has something to offer on day one
  const reward = new Record($app.findCollectionByNameOrId("reward_options"));
  reward.set("deal", "10% off");
  reward.set("description", "Welcome discount — redeem after your first stamp card.");
  reward.set("weight", 1);
  reward.set("active", true);
  reward.set("expiry_amount", 2);
  reward.set("expiry_unit", "week");
  reward.set("cafe", card.id);
  $app.save(reward);

  // one NFC tag so the owner has a link to program immediately
  const tagCode = $security.randomStringWithAlphabet(20, "abcdefghijklmnopqrstuvwxyz0123456789");
  const tag = new Record($app.findCollectionByNameOrId("nfc_tags"));
  tag.set("code", tagCode);
  tag.set("active", true);
  tag.set("type", "static");
  tag.set("cafe", card.id);
  $app.save(tag);

  const token = owner.newAuthToken();
  return e.json(200, { token, name: owner.getString("name"), role: "admin", cafe_name: cafeName, staff_code: staffCode, nfc: tagCode });
});

// Step 1 of owner sign-in. An owner token controls a café's analytics, its
// whole customer list, rewards, staff code and minimum purchase, so a password
// on its own is no longer enough to get one — this endpoint never returns a
// token, it only starts an SMS challenge that /owner/login/verify finishes.
//
//   POST /owner/login { phone, password }
//     200 { otp_required:true, ttl }   code sent (or already in flight)
//     400 invalid phone / missing password
//     404 { error, notRegistered:true }
//     401 wrong password
//     429 too many codes requested for this number
//     502 SMS provider refused   503 no SMS provider configured (see below)
//
// The SMS is minted ONLY after the password validates. Anything earlier and
// knowing an owner's phone number would be enough to spam their handset and
// burn the café's SMS credit — and the send caps below, which are keyed by
// phone, would become a way to lock a stranger out of their own resend.
//
// Resending is just calling this again (the client still has the password), so
// it has to be cheap to repeat: a call inside the 60s cooldown re-reports the
// live challenge instead of sending a second SMS, and there are at most 5 sends
// per number per 15 minutes. Each send mints a NEW code and resets that code's
// 5-guess budget, so the ceiling is 25 guesses per 15 minutes against fresh
// random 6-digit codes — and only for someone who already has the password.
//
// That 5-per-15-minutes is the WHOLE SMS budget for this number's sign-ins: the
// automatic regeneration in /owner/login/verify draws on the same row, so five
// wrong codes cannot conjure an extra send. It lives in sms_budgets rather than
// on the challenge for the reason spelled out at the lookup below.
//
// NO SMS, NO SIGN-IN. Unlike /otp/request (which echoes the code in the JSON
// whenever KAVENEGAR_API_KEY is missing, dev flag or not), this path refuses to
// start a challenge it cannot actually deliver: a production box with no API
// key returns 503 and nobody can sign in, rather than quietly falling back to
// password-only. The dev echo is gated on an explicit OTP_DEV_MODE=1 opt-in.
routerAdd("POST", "/owner/login", (e) => {
  const TTL_MS = 3 * 60 * 1000;            // matches the customer OTP window
  const RESEND_COOLDOWN_MS = 60 * 1000;
  const MAX_SENDS = 5;
  const SEND_WINDOW_MS = 15 * 60 * 1000;
  const PRUNE_AFTER_MS = 60 * 60 * 1000;

  const now = Date.now();
  // pb stores/compares datetimes as "YYYY-MM-DD HH:MM:SS.sssZ"
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const phone = norm(e.requestInfo().body.phone);
  const password = String(e.requestInfo().body.password || "");
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  // A phone can also have a separate customer account — fetch the business
  // (admin) one specifically, not whichever row happens to match first.
  let u = null;
  try { u = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'admin'", { phone }); } catch (err) { u = null; }
  if (!u) {
    return e.json(404, { error: "No owner account for this number", notRegistered: true });
  }
  if (!password) return e.json(400, { error: "Enter your password" });
  if (!u.validatePassword(password)) return e.json(401, { error: "Wrong password" });

  // ---- password is good; only now does anything get sent anywhere ----

  // opportunistic prune — a challenge an hour past its 3-minute expiry is dead
  // several times over, so dropping it just reclaims the row. Budgets are
  // pruned the same way, an hour after their 15-minute window opened.
  if (Math.random() < 0.05) {
    try {
      const stale = $app.findRecordsByFilter("owner_login_challenges", "expires < {:cut}", "", 200, 0, { cut: dbTime(now - PRUNE_AFTER_MS) });
      for (const r of stale) $app.delete(r);
    } catch (err) {}
    try {
      const spent = $app.findRecordsByFilter("sms_budgets", "window_start < {:cut}", "", 200, 0, { cut: dbTime(now - PRUNE_AFTER_MS) });
      for (const r of spent) $app.delete(r);
    } catch (err) {}
  }

  let ch = null;
  try { ch = $app.findFirstRecordByFilter("owner_login_challenges", "phone = {:phone}", { phone }); } catch (err) { ch = null; }
  // a row left over from a different account on this number is not this
  // owner's challenge — start clean rather than inherit its code
  if (ch && ch.getString("user") !== u.id) {
    try { $app.delete(ch); } catch (err) {}
    ch = null;
  }

  // The send counters do NOT live on the challenge: it is destroyed on lockout,
  // on expiry and on a failed send, and counters kept there died with it — five
  // deliberate wrong codes bought a caller a fresh budget and another instant
  // SMS. sms_budgets outlives the code it paid for.
  let bud = null;
  try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = 'owner_login'", { phone }); } catch (err) { bud = null; }

  // still inside the cooldown with a live code → say so, don't send a second
  // SMS. Impatient double-taps and page reloads cost nothing.
  if (ch && bud) {
    const exp = msOf(ch.get("expires"));
    const sent = msOf(bud.get("last_sent"));
    if (exp > now && sent && now - sent < RESEND_COOLDOWN_MS) {
      $app.logger().info("owner login resend suppressed (cooldown)", "phone", phone);
      return e.json(200, { otp_required: true, ttl: Math.max(1, Math.ceil((exp - now) / 1000)) });
    }
  }

  let sends = bud ? bud.getInt("sends") : 0;
  let winStart = bud ? msOf(bud.get("window_start")) : 0;
  if (!winStart || now - winStart > SEND_WINDOW_MS) { sends = 0; winStart = now; } // window rolled over
  if (sends >= MAX_SENDS) {
    const left = winStart + SEND_WINDOW_MS - now;
    try { e.response.header().set("Retry-After", String(Math.ceil(left / 1000))); } catch (err) {}
    return e.json(429, {
      error: "Too many codes requested for this number. Please wait a few minutes and try again.",
      retry_after: Math.ceil(left / 1000),
    });
  }

  // crypto RNG, not Math.random() — the code is the whole second factor
  const code = $security.randomStringWithAlphabet(6, "0123456789");
  const salt = $security.randomString(16);
  const expires = now + TTL_MS;

  if (!ch) {
    ch = new Record($app.findCollectionByNameOrId("owner_login_challenges"));
    ch.set("phone", phone);
  }
  ch.set("user", u.id);
  ch.set("salt", salt);
  ch.set("code_hash", $security.sha256(salt + ":" + code)); // hashed: a dump of this table is not a pile of live second factors
  ch.set("expires", dbTime(expires));
  ch.set("attempts", 0);                    // a new code gets a fresh 5 guesses
  try {
    $app.save(ch);
  } catch (err) {
    $app.logger().error("owner login challenge save failed", "error", String(err));
    return e.json(500, { error: "Could not start sign-in. Please try again." });
  }

  // spend the budget BEFORE sending: a provider that fails (or is made to fail)
  // must never hand back a free send
  if (!bud) {
    bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
    bud.set("phone", phone);
    bud.set("purpose", "owner_login");
  }
  bud.set("sends", sends + 1);
  bud.set("window_start", dbTime(winStart));
  bud.set("last_sent", dbTime(now));
  try { $app.save(bud); } catch (err) { $app.logger().error("owner login budget save failed", "error", String(err)); }

  // nothing was delivered → tear the challenge down, so a failed send can never
  // leave a code sitting there that only an attacker (or nobody) can use
  const abort = (status, msg, logMsg) => {
    try { $app.delete(ch); } catch (err) {}
    $app.logger().error(logMsg);
    return e.json(status, { error: msg });
  };

  const kavKey = $os.getenv("KAVENEGAR_API_KEY");
  if (kavKey) {
    let res = null;
    try {
      res = $http.send({
        url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + code + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
        method: "GET",
        timeout: 10,
      });
    } catch (err) {
      return abort(502, "Could not send the code. Please try again.", "owner login SMS send failed: " + String(err));
    }
    // a 200-shaped failure is still a failure — never assume it arrived
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      return abort(502, "Could not send the code. Please try again.", "owner login SMS rejected, status " + String(res && res.statusCode));
    }
    return e.json(200, { otp_required: true, ttl: Math.round(TTL_MS / 1000) });
  }

  // local dev: explicit opt-in only. OTP_DEV_MODE is never set in production,
  // so this branch cannot silently turn owner 2FA back into no 2FA.
  if ($os.getenv("OTP_DEV_MODE") === "1") {
    $app.logger().info("owner login OTP (dev)", "phone", phone, "code", code);
    return e.json(200, { otp_required: true, ttl: Math.round(TTL_MS / 1000), devCode: code });
  }

  // no provider and no dev opt-in: we cannot deliver a second factor, so we
  // refuse to sign anyone in at all rather than degrade to password-only
  return abort(
    503,
    "Sign-in is temporarily unavailable. Please try again later.",
    "owner login blocked: no SMS provider — set KAVENEGAR_API_KEY (or OTP_DEV_MODE=1 for local development)"
  );
});

// Step 2 of owner sign-in: trade the SMS code for the owner token. Returns the
// exact payload /owner/login used to return, so everything downstream of a
// successful owner login is unchanged.
//
//   POST /owner/login/verify { phone, code }
//     200 { token, name, role, cafe_name }
//     400 invalid phone
//     401 { error }                       wrong / expired / already-used code
//     401 { error, attempts_left }        wrong code, guesses remain
//     429 { error, regenerated:true, ttl, devCode? }  5th wrong code, new one sent
//     429 { error, regenerated:false, restart:true }  5th wrong code, none could be sent
//
// The challenge is single-use (deleted on success) and each code is capped at 5
// wrong guesses. The 5th one burns the code and mints a replacement rather than
// throwing the owner back to the password screen — but that SMS is spent from
// the SAME sms_budgets row /owner/login spends, never in addition to it, so
// looping "fail five times" cannot buy an attacker a single extra send. Once
// the budget is gone (or nothing can be delivered) the challenge is destroyed
// and the client is told to restart, which is what this endpoint always did.
//
// attempts_left deliberately tells the caller a challenge exists — the client
// needs the counter. The code itself is unguessable either way: 25 guesses per
// 15 minutes (5 codes x 5 guesses) against a fresh random 6-digit code.
//
// It lives in owner_login_challenges, NOT otp_codes: codes minted by the
// passwordless customer flow (/otp/request) are invisible here, so one can
// never stand in for the second factor on a business account.
routerAdd("POST", "/owner/login/verify", (e) => {
  const MAX_ATTEMPTS = 5;
  const TTL_MS = 3 * 60 * 1000;
  const MAX_SENDS = 5;
  const SEND_WINDOW_MS = 15 * 60 * 1000;

  const now = Date.now();
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const b = e.requestInfo().body || {};
  const phone = norm(b.phone);
  const code = String(b.code || "").trim();
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  // every code-shaped rejection answers the same way — no hint about whether a
  // challenge exists, has expired, or how close the guess was
  const bad = () => e.json(401, { error: "Invalid or expired code" });
  if (!/^\d{6}$/.test(code)) return bad();

  let ch = null;
  try { ch = $app.findFirstRecordByFilter("owner_login_challenges", "phone = {:phone}", { phone }); } catch (err) { ch = null; }
  if (!ch) return bad();

  const expires = msOf(ch.get("expires"));
  if (!expires || expires <= now) {
    try { $app.delete(ch); } catch (err) {}
    return bad();
  }

  const given = $security.sha256(ch.getString("salt") + ":" + code);
  if (!$security.equal(ch.getString("code_hash"), given)) {
    const attempts = ch.getInt("attempts") + 1;
    if (attempts < MAX_ATTEMPTS) {
      try {
        ch.set("attempts", attempts);
        $app.save(ch);
      } catch (err) {
        // the guess couldn't be recorded — destroy the challenge rather than
        // leave an uncounted one alive to be guessed at for free
        $app.logger().error("owner login attempt counter failed", "error", String(err));
        try { $app.delete(ch); } catch (err2) {}
        return bad();
      }
      return e.json(401, { error: "Incorrect code", attempts_left: MAX_ATTEMPTS - attempts });
    }

    // ---- guess budget spent: burn this code, try to send a fresh one ----
    // 429 (not 401) for this case — same shape as the staff-login lockout, and
    // it tells the client "stop guessing" rather than "wrong".

    // nothing could be sent → the challenge dies and the owner submits their
    // password again, exactly as this endpoint behaved before regeneration
    const restart = () => {
      try { $app.delete(ch); } catch (err) {}
      return e.json(429, { error: "Too many incorrect codes. Please sign in again to get a new one.", regenerated: false, restart: true });
    };

    let bud = null;
    try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = 'owner_login'", { phone }); } catch (err) { bud = null; }
    let sends = bud ? bud.getInt("sends") : 0;
    let winStart = bud ? msOf(bud.get("window_start")) : 0;
    if (!winStart || now - winStart > SEND_WINDOW_MS) { sends = 0; winStart = now; }
    if (sends >= MAX_SENDS) return restart(); // regeneration is NOT exempt from the cap

    const fresh = $security.randomStringWithAlphabet(6, "0123456789");
    const salt = $security.randomString(16);
    try {
      ch.set("salt", salt);
      ch.set("code_hash", $security.sha256(salt + ":" + fresh));
      ch.set("expires", dbTime(now + TTL_MS));
      ch.set("attempts", 0);                  // a new code gets a fresh 5 guesses
      $app.save(ch);
    } catch (err) {
      $app.logger().error("owner login regenerate failed", "error", String(err));
      return restart();
    }

    // spend before sending, same as /owner/login
    if (!bud) {
      bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
      bud.set("phone", phone);
      bud.set("purpose", "owner_login");
    }
    bud.set("sends", sends + 1);
    bud.set("window_start", dbTime(winStart));
    bud.set("last_sent", dbTime(now));
    try { $app.save(bud); } catch (err) { $app.logger().error("owner login budget save failed", "error", String(err)); }

    const ttl = Math.round(TTL_MS / 1000);
    const msg = "Too many incorrect codes. We've sent you a new one.";
    const kavKey = $os.getenv("KAVENEGAR_API_KEY");
    if (kavKey) {
      let res = null;
      try {
        res = $http.send({
          url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + fresh + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
          method: "GET",
          timeout: 10,
        });
      } catch (err) {
        $app.logger().error("owner login SMS resend failed", "error", String(err));
        return restart();
      }
      // a 200-shaped failure is still a failure — never assume it arrived
      if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        $app.logger().error("owner login SMS resend rejected, status " + String(res && res.statusCode));
        return restart();
      }
      return e.json(429, { error: msg, regenerated: true, ttl });
    }

    // same explicit dev opt-in as /owner/login — no provider and no opt-in means
    // we cannot deliver a second factor, so the challenge dies rather than sit
    // there holding a code nobody will ever receive
    if ($os.getenv("OTP_DEV_MODE") === "1") {
      $app.logger().info("owner login OTP regenerated (dev)", "phone", phone, "code", fresh);
      return e.json(429, { error: msg, regenerated: true, ttl, devCode: fresh });
    }
    $app.logger().error("owner login regenerate blocked: no SMS provider");
    return restart();
  }

  // right code → consume it before anything is minted, so a replay of the same
  // code (or two requests racing) can never produce a second token
  const userId = ch.getString("user");
  try { $app.delete(ch); } catch (err) {}

  let u = null;
  try { u = $app.findRecordById("users", userId); } catch (err) { u = null; }
  // the account must still be the admin on this very number — a challenge is
  // never a licence to sign in as anyone else
  if (!u || u.getString("role") !== "admin" || u.getString("phone") !== phone) return bad();

  let cafeName = "";
  try {
    const card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id });
    if (card) cafeName = card.getString("cafe_name");
  } catch (err) {}

  const token = u.newAuthToken();
  return e.json(200, { token, name: u.getString("name"), role: u.getString("role"), cafe_name: cafeName });
});

// Forgot password: POST /owner/forgot-password sends a 6-digit SMS code to the
// account's own phone (no password needed — that's the whole point); POST
// /owner/forgot-password/verify trades that code for setting a brand-new
// password. Mirrors /owner/login + /owner/login/verify's shape (fail-closed
// with no SMS provider, hashed single-use codes, 5-guess cap with auto-
// regeneration on the 5th wrong code) but lives in its own collection and its
// own sms_budgets purpose — see 1700000023_owner_password_resets.js for why.
//
//   POST /owner/forgot-password { phone }
//     200 { reset_required:true, ttl, devCode? }
//     400 invalid phone
//     404 { error, notRegistered:true }   no owner account on this number
//     429 { error, retry_after }          too many codes requested
//     502 / 503                           SMS could not be sent / no provider
//
//   POST /owner/forgot-password/verify { phone, code, password }
//     200 { ok:true }                     password changed — sign in again
//     400 invalid phone / code shape / password too short
//     401 { error }                       wrong / expired / already-used code
//     401 { error, attempts_left }        wrong code, guesses remain
//     429 { error, regenerated:true, ttl, devCode? }  5th wrong code, new one sent
//     429 { error, regenerated:false, restart:true }  5th wrong code, none could be sent
//
// Unlike login, a successful verify does NOT return a token — the owner goes
// back to the ordinary sign-in step and logs in with their new password,
// exactly the flow this was built for.
routerAdd("POST", "/owner/forgot-password", (e) => {
  const TTL_MS = 3 * 60 * 1000;
  const RESEND_COOLDOWN_MS = 60 * 1000;
  const MAX_SENDS = 5;
  const SEND_WINDOW_MS = 15 * 60 * 1000;
  const PRUNE_AFTER_MS = 60 * 60 * 1000;
  const PURPOSE = "owner_reset";

  const now = Date.now();
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const phone = norm(e.requestInfo().body.phone);
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  let u = null;
  try { u = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'admin'", { phone }); } catch (err) { u = null; }
  if (!u) return e.json(404, { error: "No owner account for this number", notRegistered: true });

  // opportunistic prune, same cadence as /owner/login
  if (Math.random() < 0.05) {
    try {
      const stale = $app.findRecordsByFilter("owner_password_resets", "expires < {:cut}", "", 200, 0, { cut: dbTime(now - PRUNE_AFTER_MS) });
      for (const r of stale) $app.delete(r);
    } catch (err) {}
  }

  let ch = null;
  try { ch = $app.findFirstRecordByFilter("owner_password_resets", "phone = {:phone}", { phone }); } catch (err) { ch = null; }
  // a row left over from a different account on this number is not this
  // owner's challenge — start clean rather than inherit its code
  if (ch && ch.getString("user") !== u.id) {
    try { $app.delete(ch); } catch (err) {}
    ch = null;
  }

  let bud = null;
  try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = {:p}", { phone, p: PURPOSE }); } catch (err) { bud = null; }

  // still inside the cooldown with a live code → say so, don't send a second SMS
  if (ch && bud) {
    const exp = msOf(ch.get("expires"));
    const sent = msOf(bud.get("last_sent"));
    if (exp > now && sent && now - sent < RESEND_COOLDOWN_MS) {
      $app.logger().info("owner password reset resend suppressed (cooldown)", "phone", phone);
      return e.json(200, { reset_required: true, ttl: Math.max(1, Math.ceil((exp - now) / 1000)) });
    }
  }

  let sends = bud ? bud.getInt("sends") : 0;
  let winStart = bud ? msOf(bud.get("window_start")) : 0;
  if (!winStart || now - winStart > SEND_WINDOW_MS) { sends = 0; winStart = now; }
  if (sends >= MAX_SENDS) {
    const left = winStart + SEND_WINDOW_MS - now;
    try { e.response.header().set("Retry-After", String(Math.ceil(left / 1000))); } catch (err) {}
    return e.json(429, {
      error: "Too many codes requested for this number. Please wait a few minutes and try again.",
      retry_after: Math.ceil(left / 1000),
    });
  }

  const code = $security.randomStringWithAlphabet(6, "0123456789");
  const salt = $security.randomString(16);
  const expires = now + TTL_MS;

  if (!ch) {
    ch = new Record($app.findCollectionByNameOrId("owner_password_resets"));
    ch.set("phone", phone);
  }
  ch.set("user", u.id);
  ch.set("salt", salt);
  ch.set("code_hash", $security.sha256(salt + ":" + code));
  ch.set("expires", dbTime(expires));
  ch.set("attempts", 0);
  try {
    $app.save(ch);
  } catch (err) {
    $app.logger().error("owner password reset challenge save failed", "error", String(err));
    return e.json(500, { error: "Could not start password reset. Please try again." });
  }

  // spend the budget BEFORE sending, same reasoning as /owner/login
  if (!bud) {
    bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
    bud.set("phone", phone);
    bud.set("purpose", PURPOSE);
  }
  bud.set("sends", sends + 1);
  bud.set("window_start", dbTime(winStart));
  bud.set("last_sent", dbTime(now));
  try { $app.save(bud); } catch (err) { $app.logger().error("owner password reset budget save failed", "error", String(err)); }

  const abort = (status, msg, logMsg) => {
    try { $app.delete(ch); } catch (err) {}
    $app.logger().error(logMsg);
    return e.json(status, { error: msg });
  };

  const kavKey = $os.getenv("KAVENEGAR_API_KEY");
  if (kavKey) {
    let res = null;
    try {
      res = $http.send({
        url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + code + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
        method: "GET",
        timeout: 10,
      });
    } catch (err) {
      return abort(502, "Could not send the code. Please try again.", "owner password reset SMS send failed: " + String(err));
    }
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      return abort(502, "Could not send the code. Please try again.", "owner password reset SMS rejected, status " + String(res && res.statusCode));
    }
    return e.json(200, { reset_required: true, ttl: Math.round(TTL_MS / 1000) });
  }

  if ($os.getenv("OTP_DEV_MODE") === "1") {
    $app.logger().info("owner password reset OTP (dev)", "phone", phone, "code", code);
    return e.json(200, { reset_required: true, ttl: Math.round(TTL_MS / 1000), devCode: code });
  }

  return abort(
    503,
    "Password reset is temporarily unavailable. Please try again later.",
    "owner password reset blocked: no SMS provider — set KAVENEGAR_API_KEY (or OTP_DEV_MODE=1 for local development)"
  );
});

routerAdd("POST", "/owner/forgot-password/verify", (e) => {
  const MAX_ATTEMPTS = 5;
  const TTL_MS = 3 * 60 * 1000;
  const MAX_SENDS = 5;
  const SEND_WINDOW_MS = 15 * 60 * 1000;
  const PURPOSE = "owner_reset";

  const now = Date.now();
  const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ");
  const msOf = (v) => { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const norm = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("98") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = d.slice(1);
    return d;
  };
  const b = e.requestInfo().body || {};
  const phone = norm(b.phone);
  const code = String(b.code || "").trim();
  const password = String(b.password || "");
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  const bad = () => e.json(401, { error: "Invalid or expired code" });
  if (!/^\d{6}$/.test(code)) return bad();
  // checked before touching the challenge: a wrong code should never be able
  // to tell an attacker whether the password they supplied was well-formed
  if (password.length < 6) return e.json(400, { error: "Password must be at least 6 characters." });

  let ch = null;
  try { ch = $app.findFirstRecordByFilter("owner_password_resets", "phone = {:phone}", { phone }); } catch (err) { ch = null; }
  if (!ch) return bad();

  const expires = msOf(ch.get("expires"));
  if (!expires || expires <= now) {
    try { $app.delete(ch); } catch (err) {}
    return bad();
  }

  const given = $security.sha256(ch.getString("salt") + ":" + code);
  if (!$security.equal(ch.getString("code_hash"), given)) {
    const attempts = ch.getInt("attempts") + 1;
    if (attempts < MAX_ATTEMPTS) {
      try {
        ch.set("attempts", attempts);
        $app.save(ch);
      } catch (err) {
        $app.logger().error("owner password reset attempt counter failed", "error", String(err));
        try { $app.delete(ch); } catch (err2) {}
        return bad();
      }
      return e.json(401, { error: "Incorrect code", attempts_left: MAX_ATTEMPTS - attempts });
    }

    // ---- guess budget spent: burn this code, try to send a fresh one ----
    const restart = () => {
      try { $app.delete(ch); } catch (err) {}
      return e.json(429, { error: "Too many incorrect codes. Please request a new one.", regenerated: false, restart: true });
    };

    let bud = null;
    try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = {:p}", { phone, p: PURPOSE }); } catch (err) { bud = null; }
    let sends = bud ? bud.getInt("sends") : 0;
    let winStart = bud ? msOf(bud.get("window_start")) : 0;
    if (!winStart || now - winStart > SEND_WINDOW_MS) { sends = 0; winStart = now; }
    if (sends >= MAX_SENDS) return restart();

    const fresh = $security.randomStringWithAlphabet(6, "0123456789");
    const salt = $security.randomString(16);
    try {
      ch.set("salt", salt);
      ch.set("code_hash", $security.sha256(salt + ":" + fresh));
      ch.set("expires", dbTime(now + TTL_MS));
      ch.set("attempts", 0);
      $app.save(ch);
    } catch (err) {
      $app.logger().error("owner password reset regenerate failed", "error", String(err));
      return restart();
    }

    if (!bud) {
      bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
      bud.set("phone", phone);
      bud.set("purpose", PURPOSE);
    }
    bud.set("sends", sends + 1);
    bud.set("window_start", dbTime(winStart));
    bud.set("last_sent", dbTime(now));
    try { $app.save(bud); } catch (err) { $app.logger().error("owner password reset budget save failed", "error", String(err)); }

    const ttl = Math.round(TTL_MS / 1000);
    const msg = "Too many incorrect codes. We've sent you a new one.";
    const kavKey = $os.getenv("KAVENEGAR_API_KEY");
    if (kavKey) {
      let res = null;
      try {
        res = $http.send({
          url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + fresh + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
          method: "GET",
          timeout: 10,
        });
      } catch (err) {
        $app.logger().error("owner password reset SMS resend failed", "error", String(err));
        return restart();
      }
      if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        $app.logger().error("owner password reset SMS resend rejected, status " + String(res && res.statusCode));
        return restart();
      }
      return e.json(429, { error: msg, regenerated: true, ttl });
    }

    if ($os.getenv("OTP_DEV_MODE") === "1") {
      $app.logger().info("owner password reset OTP regenerated (dev)", "phone", phone, "code", fresh);
      return e.json(429, { error: msg, regenerated: true, ttl, devCode: fresh });
    }
    $app.logger().error("owner password reset regenerate blocked: no SMS provider");
    return restart();
  }

  // right code → consume it before anything is changed, so a replay (or two
  // requests racing) can never set the password twice from one code
  const userId = ch.getString("user");
  try { $app.delete(ch); } catch (err) {}

  let u = null;
  try { u = $app.findRecordById("users", userId); } catch (err) { u = null; }
  // the account must still be the admin on this very number — a challenge is
  // never a licence to change a different account's password
  if (!u || u.getString("role") !== "admin" || u.getString("phone") !== phone) return bad();

  u.setPassword(password);
  try {
    $app.save(u);
  } catch (err) {
    $app.logger().error("owner password reset save failed", "error", String(err));
    return e.json(500, { error: "Could not set your new password. Please try again." });
  }

  // no token here on purpose — the owner goes back to the sign-in step and
  // logs in with the password they just set
  return e.json(200, { ok: true });
});

// The owner's own café config — resolved from the auth token, never a client-
// supplied id, so one owner can never read/target another café's settings.
//   GET /owner/cafe  (admin auth) -> { id, cafe_name, staff_code, stamps_required, reward_expiry_days }
routerAdd("GET", "/owner/cafe", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let nfc = "";
  try {
    const t = $app.findRecordsByFilter("nfc_tags", "cafe = {:c} && active = true", "-created", 1, 0, { c: card.id })[0];
    if (t) nfc = t.getString("code");
  } catch (err) {}

  let staffCode = "";
  try {
    const sc = $app.findFirstRecordByFilter("staff_codes", "cafe = {:c}", { c: card.id });
    if (sc) staffCode = sc.getString("code");
  } catch (err) {}

  return e.json(200, {
    id: card.id,
    cafe_name: card.getString("cafe_name"),
    tagline: card.getString("tagline"),
    accent: card.getString("accent") || "#171717",
    staff_code: staffCode,
    stamps_required: card.getInt("stamps_required"),
    reward_expiry_days: card.getInt("reward_expiry_days"),
    min_purchase: card.getInt("min_purchase"),
    nfc: nfc,
    // filename only — the dashboard builds the URL itself, same as the wallet does
    logo: card.getString("logo"),
    collection_id: card.collection().id,
  });
}, $apis.requireAuth());

// Edit the café's public identity (name / tagline / accent colour).
//   POST /owner/cafe/profile  (admin auth) { cafe_name?, tagline?, accent? }
routerAdd("POST", "/owner/cafe/profile", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  const b = e.requestInfo().body || {};
  const cafeName = String(b.cafe_name || "").trim();
  if (cafeName) card.set("cafe_name", cafeName);
  if (typeof b.tagline === "string") card.set("tagline", b.tagline.trim());
  let accent = String(b.accent || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) card.set("accent", accent);
  $app.save(card);

  return e.json(200, { ok: true, cafe_name: card.getString("cafe_name"), tagline: card.getString("tagline"), accent: card.getString("accent") });
}, $apis.requireAuth());

// Set the optional minimum-purchase amount (toman) on the owner's own café.
// 0 clears it. Informational only — staff enforce it, we just display it.
//   POST /owner/cafe/min-purchase  (admin auth) { min_purchase } -> { ok, min_purchase }
routerAdd("POST", "/owner/cafe/min-purchase", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let amt = parseInt((e.requestInfo().body || {}).min_purchase, 10);
  if (isNaN(amt) || amt < 0) amt = 0;
  if (amt > 100000000) amt = 100000000; // sane cap (100M toman)
  card.set("min_purchase", amt);
  $app.save(card);
  return e.json(200, { ok: true, min_purchase: amt });
}, $apis.requireAuth());

// Set how many stamps a card needs. Changing it does NOT touch cards already in
// progress — card.pb.js locks each card's goal when it starts, so a change only
// applies to each customer's next card.
//   POST /owner/cafe/stamps-required  (admin auth) { stamps_required } -> { ok, stamps_required }
routerAdd("POST", "/owner/cafe/stamps-required", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let n = parseInt((e.requestInfo().body || {}).stamps_required, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 12) n = 12;
  card.set("stamps_required", n);
  $app.save(card);
  return e.json(200, { ok: true, stamps_required: n });
}, $apis.requireAuth());

// Upload the café's logo — shown as a circle before the name on the customer's
// card. Multipart, single field "logo".
//
// Goes through a hook rather than a direct PATCH because cafe_card.updateRule is
// null (and rule_guard.pb.js keeps it that way): the café is resolved from the
// auth token, so an owner can only ever replace their OWN logo, and there is no
// request shape that lets them name a different café.
//
// Size and MIME are enforced by the field definition in
// 1700000025_cafe_logo.js, and that is deliberately the ONLY MIME check:
// PocketBase sniffs the actual bytes, whereas anything we could read here is
// the client-supplied Content-Type, which an uploader controls freely. A save
// failure is turned into a readable message below rather than pre-guessing.
//   POST /owner/cafe/logo  (admin auth, multipart) -> { ok, logo }
routerAdd("POST", "/owner/cafe/logo", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  let files = [];
  try { files = e.findUploadedFiles("logo") || []; } catch (err) { files = []; }
  if (!files.length || !files[0]) return e.json(400, { error: "No image was uploaded" });

  const f = files[0];
  if ((f.size || 0) > 2097152) return e.json(413, { error: "That image is too large — 2MB maximum" });

  // assigning replaces the old file; PocketBase deletes the orphan on save
  card.set("logo", f);
  try {
    $app.save(card);
  } catch (err) {
    // the overwhelmingly likely cause is the field's own mimeTypes rejecting a
    // non-raster upload (an SVG, a PDF renamed to .png), so say that plainly
    $app.logger().error("cafe logo upload failed", "cafe", card.id, "error", String(err));
    return e.json(415, { error: "Use a JPG, PNG or WebP image" });
  }

  return e.json(200, { ok: true, logo: card.getString("logo"), collection_id: card.collection().id });
}, $apis.requireAuth());

// Clear the café's logo — the card goes back to name-and-tagline only.
//   POST /owner/cafe/logo/remove  (admin auth) -> { ok }
routerAdd("POST", "/owner/cafe/logo/remove", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") return e.json(403, { error: "Owner access only" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });

  card.set("logo", null); // PocketBase removes the stored file on save
  try { $app.save(card); } catch (err) {
    $app.logger().error("cafe logo remove failed", "cafe", card.id, "error", String(err));
    return e.json(400, { error: "That didn't work — try again" });
  }
  return e.json(200, { ok: true });
}, $apis.requireAuth());
