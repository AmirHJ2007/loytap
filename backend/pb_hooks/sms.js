/// <reference path="../pb_data/types.d.ts" />

// The one place an OTP actually leaves the building.
//
// Every code the app sends — customer sign-in, owner login, owner password
// reset, and the "wrong code, here's a fresh one" resends — is the same
// message: six digits, one variable. So there is one function here and seven
// call sites, rather than seven copies of a provider's URL.
//
// NB: this is a require()d module, NOT a .pb.js hook file. Hook files are
// re-evaluated in a pooled JSVM that cannot see each other's outer scope
// (see clean-urls.pb.js), which is why the handlers duplicate their little
// dbTime/norm helpers instead of sharing them. require() sidesteps that: the
// module is loaded fresh inside the calling handler, so this file's scope is
// its own. Verified against PocketBase 0.39.11.
//
// Provider order is deliberate: Faraz if it is configured, else Kavenegar,
// else nothing. Kavenegar stays as a fallback so a bad Faraz key or an empty
// Faraz balance can be undone by unsetting three env vars, with no redeploy.
//
// Returns one of:
//   { ok: true }                        delivered
//   { ok: false, configured: true,  error }   a provider tried and failed
//   { ok: false, configured: true, capped: true, error }
//                                       the daily ceiling below is spent
//   { ok: false, configured: false }    nothing is set up to deliver at all
//
// The configured flag is load-bearing for security, not just for logging: the
// callers only fall through to OTP_DEV_MODE (which hands the code back in the
// HTTP response) when configured is false. A provider that merely failed must
// never open that door, or a provider outage would downgrade the whole app to
// "tell me any number's code". A capped send reports configured:true for
// exactly that reason — hitting our own ceiling must not start echoing codes.

// pb stores/compares datetimes as "YYYY-MM-DD HH:MM:SS.sssZ"
function dbTime(ms) { return new Date(ms).toISOString().replace("T", " "); }
function msOf(v) { const t = new Date(String(v || "").replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; }
function envInt(name, dflt) {
  const n = parseInt($os.getenv(name) || "", 10);
  return isNaN(n) || n < 0 ? dflt : n;
}

// ---- the global send ceiling ------------------------------------------------
//
// WHY THIS EXISTS. The per-phone budgets in otp.pb.js / owner.pb.js stop one
// number being spammed, and the per-IP budget in otp.pb.js stops one script.
// Neither bounds the BILL: five messages times every number an attacker cares
// to type is unlimited money, and /otp/request will send to any valid mobile
// number because that is how registration works. So the total is capped here,
// in the one place every send already passes through.
//
// The ceiling is a cost brake, not a throttle — when it trips, sign-in stops
// working. OTP_MAX_SENDS_PER_DAY exists so raising it is an env change, not a
// redeploy. Set it a little above a busy day's real traffic.
//
// Lives in sms_budgets under the reserved key "*" / purpose "otp_global". "*"
// cannot collide with a real bucket: phone keys are always 10 digits starting
// with 9, and the IP keys are "ip:"-prefixed.
const GLOBAL_KEY = "*";
const GLOBAL_PURPOSE = "otp_global";
const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

function globalBudget(now) {
  let rec = null;
  try {
    rec = $app.findFirstRecordByFilter(
      "sms_budgets", "phone = {:k} && purpose = {:p}", { k: GLOBAL_KEY, p: GLOBAL_PURPOSE }
    );
  } catch (err) { rec = null; }
  let sends = rec ? rec.getInt("sends") : 0;
  let start = rec ? msOf(rec.get("window_start")) : 0;
  if (!start || now - start > GLOBAL_WINDOW_MS) { sends = 0; start = now; } // window rolled over
  return { rec, sends, start };
}

// Counted on ACCEPTED sends only, unlike the per-phone and per-IP buckets,
// which deliberately spend before sending so that a forced provider failure
// buys no free retry. Those exist to throttle abuse. This one exists to bound
// money, and a message the provider never accepted costs nothing — charging
// failures here would let a ten-minute provider outage eat a whole day's
// ceiling and keep sign-in down long after the provider recovered. Abuse that
// only ever fails is already capped upstream, by buckets that do charge it.
function spendGlobal(b, now) {
  let rec = b.rec;
  if (!rec) {
    rec = new Record($app.findCollectionByNameOrId("sms_budgets"));
    rec.set("phone", GLOBAL_KEY);
    rec.set("purpose", GLOBAL_PURPOSE);
  }
  rec.set("sends", b.sends + 1);
  rec.set("window_start", dbTime(b.start));
  rec.set("last_sent", dbTime(now));
  try { $app.save(rec); } catch (err) {
    // a counter we cannot write is a ceiling we cannot enforce — say so loudly,
    // but never fail a message the provider has already accepted and billed
    $app.logger().error("global SMS ceiling counter failed to save", "error", String(err));
  }
}

module.exports = {
  // phone is the normalised national form the handlers already produce:
  // 10 digits starting with 9, no country code and no leading zero.
  sendOtpCode: function (phone, code) {
    const farazKey = $os.getenv("FARAZSMS_API_KEY");
    const farazPattern = $os.getenv("FARAZSMS_PATTERN_CODE");
    const farazLine = $os.getenv("FARAZSMS_LINE_NUMBER");
    const kavKey = $os.getenv("KAVENEGAR_API_KEY");
    const hasFaraz = !!(farazKey && farazPattern);

    // Nothing can deliver, so nothing can be billed: leave the ceiling alone
    // and report "not configured" exactly as before, so a machine with no
    // provider at all still reaches the callers' OTP_DEV_MODE branch.
    if (!hasFaraz && !kavKey) return { ok: false, configured: false };

    const now = Date.now();
    const maxPerDay = envInt("OTP_MAX_SENDS_PER_DAY", 300);
    const budget = globalBudget(now);
    if (budget.sends >= maxPerDay) {
      $app.logger().error(
        "!! SMS DAILY CEILING REACHED — no code will be sent until the window rolls over. " +
        "Sign-in is down. If this is real traffic and not an attack, raise OTP_MAX_SENDS_PER_DAY; " +
        "if it is an attack, the per-IP cap in otp.pb.js and the provider's own balance limit are " +
        "the next lines of defence.",
        "sent", budget.sends, "limit", maxPerDay, "window_start", dbTime(budget.start)
      );
      return {
        ok: false,
        configured: true, // NOT a licence to echo codes — see the header comment
        capped: true,
        error: "daily SMS ceiling reached (" + budget.sends + "/" + maxPerDay + ")",
      };
    }

    if (hasFaraz) {
      const payload = {
        code: farazPattern,
        // the pattern's variable is named "code" in the Faraz panel, so this
        // key has to stay spelled exactly that way; it is the OTP itself, not
        // the pattern code above
        attributes: { code: String(code) },
        recipient: "0" + phone,
        // the codes are generated as Latin digits and the pattern caps the
        // variable at 6 characters; Persian digits would blow that cap
        number_format: "english",
      };
      // We own no dedicated line, and pattern sends go out over the provider's
      // shared lines, so the line number is deliberately optional: set
      // FARAZSMS_LINE_NUMBER only if we ever buy one (or the API starts
      // demanding it), and the field simply disappears until then.
      if (farazLine) payload.line_number = farazLine;

      let res = null;
      try {
        res = $http.send({
          url: "https://api.iranpayamak.com/ws/v1/sms/pattern",
          method: "POST",
          timeout: 10,
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Api-Key": farazKey,
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        return { ok: false, configured: true, error: "Faraz send failed: " + String(err) };
      }

      // a 200-shaped failure is still a failure — never assume it arrived
      if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        return {
          ok: false,
          configured: true,
          error: "Faraz send rejected, status " + String(res && res.statusCode),
        };
      }

      // TODO(faraz-body-check): the status check above is NOT proof of
      // acceptance. This API can answer 200 with a failure payload in the body
      // — out of credit, unknown pattern code, blocked recipient — and we then
      // tell the customer their code is on its way, spend a slot in the
      // ceiling, and leave them waiting for an SMS that was never sent. Worse,
      // an exhausted balance looks exactly like normal operation. Parse
      // res.body and check the provider's own status/code field here, once the
      // response shape is confirmed against the panel's API docs.

      spendGlobal(budget, now);
      return { ok: true };
    }

    // kavKey is set: the no-provider case returned above.
    const tmpl = $os.getenv("KAVENEGAR_TEMPLATE") || "loytap";
    let res = null;
    try {
      res = $http.send({
        url:
          "https://api.kavenegar.com/v1/" + kavKey +
          "/verify/lookup.json?receptor=0" + phone +
          "&token=" + code + "&template=" + tmpl,
        method: "GET",
        timeout: 10,
      });
    } catch (err) {
      return { ok: false, configured: true, error: "Kavenegar send failed: " + String(err) };
    }
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      return {
        ok: false,
        configured: true,
        error: "Kavenegar send rejected, status " + String(res && res.statusCode),
      };
    }
    spendGlobal(budget, now);
    return { ok: true };
  },
};
