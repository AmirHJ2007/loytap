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
//   { ok: false, configured: false }    nothing is set up to deliver at all
//
// The configured flag is load-bearing for security, not just for logging: the
// callers only fall through to OTP_DEV_MODE (which hands the code back in the
// HTTP response) when configured is false. A provider that merely failed must
// never open that door, or a provider outage would downgrade the whole app to
// "tell me any number's code".

module.exports = {
  // phone is the normalised national form the handlers already produce:
  // 10 digits starting with 9, no country code and no leading zero.
  sendOtpCode: function (phone, code) {
    const farazKey = $os.getenv("FARAZSMS_API_KEY");
    const farazPattern = $os.getenv("FARAZSMS_PATTERN_CODE");
    const farazLine = $os.getenv("FARAZSMS_LINE_NUMBER");

    if (farazKey && farazPattern) {
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
      return { ok: true };
    }

    const kavKey = $os.getenv("KAVENEGAR_API_KEY");
    if (kavKey) {
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
      return { ok: true };
    }

    return { ok: false, configured: false };
  },
};
