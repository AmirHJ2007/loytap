/// <reference path="../pb_data/types.d.ts" />

// OTP_DEV_MODE=1 makes /otp/request, /owner/login and /owner/register return
// the verification code in the HTTP response instead of sending an SMS. That is
// how you sign in locally without a Kavenegar account — and it is a full
// account-takeover hole if it is ever set on a real deployment, since anyone can
// then ask for any phone number's login code.
//
// The flag is impossible to see from the outside, so say so loudly at boot.
// Anyone reading the logs of a server that should be secure will spot it.

onBootstrap((e) => {
  e.next();

  try {
    if ($os.getenv("OTP_DEV_MODE") !== "1") return;

    const hasProvider = !!$os.getenv("KAVENEGAR_API_KEY");

    // dev mode AND a real SMS provider means this is almost certainly a real
    // deployment with the flag left on by mistake — the codes are live
    if (hasProvider) {
      $app.logger().error(
        "!! OTP_DEV_MODE=1 WITH A REAL SMS PROVIDER — verification codes are being " +
        "returned in HTTP responses. Anyone can take over any account. Unset " +
        "OTP_DEV_MODE unless this is a local machine."
      );
      return;
    }

    $app.logger().warn(
      "OTP_DEV_MODE=1 — verification codes are returned in API responses instead " +
      "of sent by SMS. Local development only; never set this in production."
    );
  } catch (err) {}
});
