/// <reference path="../pb_data/types.d.ts" />

// OTP_DEV_MODE=1 lets /otp/request, /owner/login, /owner/register and
// /owner/forgot-password continue when no SMS provider is configured, by
// writing the verification code to the server log instead of sending it. That
// is how you sign in locally without an SMS account.
//
// The code is NEVER returned in an HTTP response, in any mode — see the header
// of otp.pb.js. So this flag is no longer account-takeover-by-anyone: reading
// the code needs access to the server's logs, not just the ability to make a
// request. It is still wrong on a real deployment, for two reasons:
//
//   1. it writes live login codes into a log that ships to a log aggregator,
//      gets screenshotted, and is read by people who should not have them; and
//   2. for owners it means a sign-in completing with no second factor actually
//      delivered — 2FA in name only.
//
// The flag is impossible to see from the outside, so say so loudly at boot.

onBootstrap((e) => {
  e.next();

  try {
    if ($os.getenv("OTP_DEV_MODE") !== "1") return;

    // both providers, or this alarm goes quiet on the one actually in use —
    // it checked only Kavenegar while sms.js prefers Faraz
    const hasProvider =
      !!(($os.getenv("FARAZSMS_API_KEY") && $os.getenv("FARAZSMS_PATTERN_CODE"))) ||
      !!$os.getenv("KAVENEGAR_API_KEY");

    // With a provider configured, sends go out normally and this branch is
    // never reached — which makes the flag pure downside: no effect in normal
    // operation, and a provider outage silently downgrades to logged codes
    // instead of the 502/503 that would tell you something is wrong.
    if (hasProvider) {
      $app.logger().error(
        "!! OTP_DEV_MODE=1 WITH A REAL SMS PROVIDER — if the provider fails, " +
        "sign-in will quietly fall back to writing live verification codes to " +
        "this log instead of failing. Unset OTP_DEV_MODE unless this is a " +
        "local machine."
      );
      return;
    }

    $app.logger().warn(
      "OTP_DEV_MODE=1 with no SMS provider — verification codes are written to " +
      "this log instead of being sent. Local development only; never set this " +
      "in production."
    );
  } catch (err) {}
});
