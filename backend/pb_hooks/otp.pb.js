/// <reference path="../pb_data/types.d.ts" />

// LoyTap phone OTP. Set KAVENEGAR_API_KEY (+ KAVENEGAR_TEMPLATE) to send a real
// SMS. With no key the code comes back in the response ONLY when OTP_DEV_MODE=1
// is set explicitly; with neither, the request fails closed (503) and the code
// row is destroyed. A missing API key must never hand an anonymous caller
// someone else's login code. Same rules as /owner/login in owner.pb.js.
//
// Codes are stored hashed, never in plaintext: code_hash holds
// "salt:sha256(salt:code)" with a fresh per-row salt, so a dump of otp_codes is
// not a pile of live login codes. (owner_login_challenges has a dedicated salt
// column; otp_codes has no such field, so the salt rides in the same column.)
//
//   POST /otp/request  { phone }              -> { ok:true, devCode? }
//   POST /otp/verify   { phone, code, name? }  -> { token, user }
//
// This endpoint only ever signs in/creates *customer* accounts. Business
// (admin) accounts are a separate identity and can only be created via the
// dedicated, higher-friction /owner/register flow — never accept a
// client-supplied role here, or anyone could mint themselves an admin
// account just by verifying their own phone number.
//
// NOTE: PocketBase runs each handler in an isolated runtime, so helper functions
// must be declared INSIDE the handler (no shared file-level scope).

// Mint + send a code. Anyone who knows a number can call this, so it is capped:
// at most 5 SMS per number per 15 minutes, and a call inside the 60s cooldown
// re-reports the code already in flight instead of sending a second one.
// Impatient double-taps and page reloads cost nothing.
//
// The cap lives in sms_budgets, NOT on the otp_codes row: the code row is
// deleted on every mint, on success and on lockout, and a counter kept there
// would be wiped with it. See 1700000021_sms_budgets.js.
//
//   200 { ok:true, devCode? }   sent (or already in flight); devCode only when
//                               there is no provider AND OTP_DEV_MODE=1
//   400 invalid phone
//   404 { error, notRegistered:true }   mode:"signin" for an unknown number
//   429 { error, retry_after }   send cap reached for this number
//   502 SMS provider refused
//   503 nothing can deliver a code (no KAVENEGAR_API_KEY, no OTP_DEV_MODE)
routerAdd("POST", "/otp/request", (e) => {
  const TTL_MS = 3 * 60 * 1000;
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
  if (!/^9\d{9}$/.test(phone)) return e.json(400, { error: "Invalid phone number" });

  // Sign-in requires an existing account; register creates one on verify.
  if (e.requestInfo().body.mode === "signin") {
    let exists = null;
    try { exists = $app.findFirstRecordByFilter("users", "phone = {:phone}", { phone }); } catch (err) { exists = null; }
    if (!exists) return e.json(404, { error: "This number isn't registered yet", notRegistered: true });
  }

  // opportunistic prune — budgets whose window is an hour past are dead
  if (Math.random() < 0.05) {
    try {
      const stale = $app.findRecordsByFilter("sms_budgets", "window_start < {:cut}", "", 200, 0, { cut: dbTime(now - PRUNE_AFTER_MS) });
      for (const r of stale) $app.delete(r);
    } catch (err) {}
  }

  const kavKey = $os.getenv("KAVENEGAR_API_KEY");

  let bud = null;
  try { bud = $app.findFirstRecordByFilter("sms_budgets", "phone = {:phone} && purpose = 'otp'", { phone }); } catch (err) { bud = null; }

  // still inside the cooldown with a live code → say so, don't send a second SMS
  const lastSent = bud ? msOf(bud.get("last_sent")) : 0;
  if (lastSent && now - lastSent < RESEND_COOLDOWN_MS) {
    let live = null;
    try { live = $app.findRecordsByFilter("otp_codes", "phone = {:phone} && expires > {:now}", "-created", 1, 0, { phone, now: dbTime(now) })[0]; } catch (err) { live = null; }
    if (live) {
      // no devCode here even in dev mode: the row only holds a hash now, so the
      // code in flight cannot be re-read — the one already handed out still works
      $app.logger().info("OTP resend suppressed (cooldown)", "phone", phone);
      return e.json(200, { ok: true });
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

  // crypto RNG, not Math.random() — this code is the whole sign-in
  const code = $security.randomStringWithAlphabet(6, "0123456789");
  const salt = $security.randomString(16);
  const expires = dbTime(now + TTL_MS);

  try {
    const old = $app.findRecordsByFilter("otp_codes", "phone = {:phone}", "", 100, 0, { phone });
    for (const r of old) $app.delete(r);
  } catch (err) {}

  const rec = new Record($app.findCollectionByNameOrId("otp_codes"));
  rec.set("phone", phone);
  // hashed, salt first: "salt:sha256(salt:code)". otp_codes has no salt column,
  // so both halves live in this one field — a dump of the table is not a pile of
  // live login codes.
  rec.set("code_hash", salt + ":" + $security.sha256(salt + ":" + code));
  rec.set("expires", expires);
  rec.set("attempts", 0);
  $app.save(rec);

  // spend the budget BEFORE sending: a provider that fails (or is made to fail)
  // must never hand back a free send
  if (!bud) {
    bud = new Record($app.findCollectionByNameOrId("sms_budgets"));
    bud.set("phone", phone);
    bud.set("purpose", "otp");
  }
  bud.set("sends", sends + 1);
  bud.set("window_start", dbTime(winStart));
  bud.set("last_sent", dbTime(now));
  try { $app.save(bud); } catch (err) { $app.logger().error("otp budget save failed", "error", String(err)); }

  // nothing was delivered → tear the code row down, so a failed send can never
  // leave a live code sitting there that only an attacker (or nobody) can use
  const abort = (status, msg, logMsg) => {
    try { $app.delete(rec); } catch (err) {}
    $app.logger().error(logMsg);
    return e.json(status, { error: msg });
  };

  if (kavKey) {
    const tmpl = $os.getenv("KAVENEGAR_TEMPLATE") || "loytap";
    let res = null;
    try {
      res = $http.send({
        url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + code + "&template=" + tmpl,
        method: "GET",
        timeout: 10,
      });
    } catch (err) {
      return abort(502, "Could not send SMS", "Kavenegar send failed: " + String(err));
    }
    // a 200-shaped failure is still a failure — never assume it arrived
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      return abort(502, "Could not send SMS", "Kavenegar send rejected, status " + String(res && res.statusCode));
    }
    return e.json(200, { ok: true });
  }

  // local dev: explicit opt-in only. OTP_DEV_MODE is never set in production, so
  // a missing API key can never turn this endpoint into "tell me any number's code".
  if ($os.getenv("OTP_DEV_MODE") === "1") {
    $app.logger().info("OTP (dev)", "phone", phone, "code", code);
    return e.json(200, { ok: true, devCode: code });
  }

  // no provider and no dev opt-in: nothing can deliver this code, so it dies here
  return abort(
    503,
    "Sign-in is temporarily unavailable. Please try again later.",
    "otp blocked: no SMS provider — set KAVENEGAR_API_KEY (or OTP_DEV_MODE=1 for local development)"
  );
});

// Trade the code for a customer token.
//
//   200 { token, user }
//   400 malformed phone/code
//   401 { error }                          no live code for this number
//   401 { error, attempts_left }           wrong code, guesses remain
//   429 { error, regenerated:true, ttl, devCode? }   5th wrong code, new one sent
//                                    (devCode only with no provider AND OTP_DEV_MODE=1)
//   429 { error, regenerated:false, restart:true }   5th wrong code, none could be sent
//
// A 6-digit code gets 5 guesses. The 5th wrong one burns it and mints a
// replacement automatically, so a fumbled code doesn't dead-end the user — but
// that SMS comes out of the SAME per-phone budget /otp/request spends, so
// failing on purpose in a loop buys an attacker no extra sends at all. When the
// budget is gone (or nothing can be delivered) the code is destroyed and the
// client is sent back to the start.
routerAdd("POST", "/otp/verify", (e) => {
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
  // stored form is "salt:sha256(salt:code)" — a legacy plaintext row has no
  // colon and matches nothing, so it just expires unused
  const codeMatches = (stored, given) => {
    const s = String(stored || "");
    const i = s.indexOf(":");
    if (i < 1) return false;
    return $security.equal(s, s.slice(0, i) + ":" + $security.sha256(s.slice(0, i) + ":" + given));
  };

  const body = e.requestInfo().body;
  const phone = norm(body.phone);
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();

  if (!/^9\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
    return e.json(400, { error: "Invalid phone or code" });
  }

  // fetch by phone, not by phone+code: a wrong guess has to find the row in
  // order to be counted against it
  let otp = null;
  try {
    otp = $app.findRecordsByFilter("otp_codes", "phone = {:phone} && expires > {:now}", "-created", 1, 0, { phone, now: dbTime(now) })[0];
  } catch (err) { otp = null; }
  if (!otp) return e.json(401, { error: "Invalid or expired code" });

  if (!codeMatches(otp.getString("code_hash"), code)) {
    const attempts = otp.getInt("attempts") + 1;
    if (attempts < MAX_ATTEMPTS) {
      try {
        otp.set("attempts", attempts);
        $app.save(otp);
      } catch (err) {
        // the guess couldn't be recorded — destroy the code rather than leave
        // an uncounted one alive to be guessed at for free
        $app.logger().error("otp attempt counter failed", "error", String(err));
        try { $app.delete(otp); } catch (err2) {}
        return e.json(401, { error: "Invalid or expired code" });
      }
      return e.json(401, { error: "Incorrect code", attempts_left: MAX_ATTEMPTS - attempts });
    }

    // ---- 5th wrong code: burn it, try to send a fresh one in its place ----

    // nothing could be sent → the code dies with the attempt budget and the
    // client starts over, exactly as it did before auto-regeneration existed
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
    const salt = $security.randomString(16);
    try {
      otp.set("code_hash", salt + ":" + $security.sha256(salt + ":" + fresh)); // hashed, same as the mint above
      otp.set("expires", dbTime(now + TTL_MS));
      otp.set("attempts", 0); // a new code gets a fresh 5 guesses
      $app.save(otp);
    } catch (err) {
      $app.logger().error("otp regenerate failed", "error", String(err));
      return restart();
    }

    // spend before sending, same as /otp/request
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
      let res = null;
      try {
        res = $http.send({
          url: "https://api.kavenegar.com/v1/" + kavKey + "/verify/lookup.json?receptor=0" + phone + "&token=" + fresh + "&template=" + ($os.getenv("KAVENEGAR_TEMPLATE") || "loytap"),
          method: "GET",
          timeout: 10,
        });
      } catch (err) {
        $app.logger().error("Kavenegar send failed", "error", String(err));
        return restart();
      }
      // a 200-shaped failure is still a failure — never assume it arrived
      if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        $app.logger().error("Kavenegar resend rejected, status " + String(res && res.statusCode));
        return restart();
      }
      return e.json(429, { error: msg, regenerated: true, ttl });
    }

    // same explicit dev opt-in as /otp/request — with no provider and no opt-in
    // nothing can deliver the replacement, so it dies and the client starts over
    if ($os.getenv("OTP_DEV_MODE") === "1") {
      $app.logger().info("OTP regenerated (dev)", "phone", phone, "code", fresh);
      return e.json(429, { error: msg, regenerated: true, ttl, devCode: fresh });
    }
    $app.logger().error("otp regenerate blocked: no SMS provider — set KAVENEGAR_API_KEY (or OTP_DEV_MODE=1 for local development)");
    return restart();
  }

  // right code → consume it before anything is minted
  $app.delete(otp);

  // A phone can also have a separate business (admin) account — this endpoint
  // only ever signs in/creates the customer one, never that other row.
  let user = null;
  try {
    user = $app.findFirstRecordByFilter("users", "phone = {:phone} && role = 'customer'", { phone });
  } catch (err) { user = null; }

  if (!user) {
    user = new Record($app.findCollectionByNameOrId("users"));
    user.set("phone", phone);
    user.set("email", phone + "@phone.loytap"); // auth collection requires an email; phone is unique
    user.set("name", name || "Guest");
    user.set("role", "customer");
    user.set("verified", true);
    user.setPassword($security.randomString(30));
    $app.save(user);
  } else if (name && !user.getString("name")) {
    user.set("name", name);
    $app.save(user);
  }

  const token = user.newAuthToken();
  return e.json(200, {
    token,
    user: {
      id: user.id,
      name: user.getString("name"),
      phone: user.getString("phone"),
      role: user.getString("role"),
    },
  });
});
