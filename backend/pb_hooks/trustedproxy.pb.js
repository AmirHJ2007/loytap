/// <reference path="../pb_data/types.d.ts" />

// Boot-time check on Settings > trustedProxy, because two security controls are
// worthless without it.
//
// The per-IP SMS cap in otp.pb.js and the staff-login lockout in staff.pb.js are
// both keyed on e.realIP(). That only returns the true client address when
// trustedProxy names a header to read it from. Unconfigured, behind Liara's
// edge, it falls back to remoteIP() — which is the proxy's address, identical
// for every visitor on earth. The per-IP cap then shares ONE bucket between all
// customers: the first fifteen codes of the hour work and everybody else is
// locked out, while an attacker is throttled no more than anyone else.
//
// This only warns; it never repairs. That asymmetry with rule_guard.pb.js is
// deliberate. Trusting X-Forwarded-For on a server that is NOT behind a proxy is
// strictly worse than not trusting it: the header becomes attacker-controlled,
// and every IP-keyed limit turns into a value the attacker rotates at will —
// one header line and the cap is gone. Whether something trustworthy sits in
// front is a deployment fact this process cannot observe, so a human sets it.

onBootstrap((e) => {
  e.next(); // let PocketBase finish coming up first

  try {
    let headers = [];
    try {
      const s = $app.settings();
      headers = (s.trustedProxy && s.trustedProxy.headers) || [];
    } catch (err) {
      // the settings shape moved under us — better a wrong-looking warning than
      // a silent one, since the thing it guards is a cost and lockout control
      $app.logger().warn(
        "could not read Settings > trustedProxy to verify it — check by hand that " +
        "it names X-Forwarded-For, or the per-IP SMS cap and staff lockout are " +
        "keyed on the proxy's address instead of the caller's",
        "error", String(err)
      );
      return;
    }

    if (headers && headers.length) return;

    $app.logger().warn(
      "Settings > trustedProxy names no header — e.realIP() reports the proxy's " +
      "address, so the per-IP SMS cap (otp.pb.js) and the staff-login lockout " +
      "(staff.pb.js) are keyed on one value shared by every visitor. Behind a " +
      "reverse proxy such as Liara, set headers to [\"X-Forwarded-For\"]. On a " +
      "directly exposed server leave it unset — trusting that header there would " +
      "let anyone forge their own address and bypass both limits."
    );
  } catch (err) {}
});
