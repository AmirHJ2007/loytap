/// <reference path="../pb_data/types.d.ts" />

// SEC-21 — boot-time assertion for the rate limits on the money routes.
//
// WHY THIS EXISTS, and why it is a hook rather than a setting someone ticks.
// Rate limits are stored in the settings row, which is DATABASE state, exactly
// like the collection rules in rule_guard.pb.js. A box ticked in the dashboard
// writes no migration, leaves no trace in git, and a fresh deploy of the same
// code comes up with whatever the database happens to say. Asserting it here
// puts the limit in the repo, where it is reviewed, versioned and restored.
//
// WHAT WAS WRONG. Two separate things, and fixing either alone changes
// nothing:
//
//   1. rateLimits.enabled was false, so every configured rule sat idle.
//   2. Every configured rule was a tag (*:auth, *:create) or the /api/ prefix.
//      PocketBase matches a label as a tag, a complete path, or a path prefix
//      when it ends in "/". /subscription/pay and /zarinpal/callback are
//      custom routerAdd routes: they carry no tags and they do not begin with
//      /api/, so NO rule matched them. Switching rate limiting on without
//      adding a prefix for them would have left both doors exactly as open.
//
// WHAT ONE UNLIMITED CALL COSTS. /subscription/pay writes a payments row and
// then calls ZarinPal with a 20-second timeout, both before it answers. A loop
// therefore grows a table that is never pruned and holds outbound connections
// to the gateway open. Owner registration is self-serve — a phone and an OTP —
// so the population that can do this is "anyone", not "a café we onboarded".
//
// THE LIMITS ARE DELIBERATELY LOOSE. The aim is to stop a loop, not to police
// real use, and an owner wrongly refused here cannot pay us. A person clicks
// "pay" once, maybe twice if the first attempt looks stuck, so 10/minute is
// already far above honest traffic while being three orders of magnitude below
// what an unattended script does. The callback is looser still, on purpose: a
// 429 there is a payment that completed at the gateway but never extended the
// subscription, which is the one failure in this whole path worth bending over
// backwards to avoid, and the brute-force it would otherwise prevent is not
// realistic against a 36-character authority.
//
// ORDER MATTERS. PocketBase returns the FIRST rule whose label matches, so
// these two are prepended rather than appended — behind a broad prefix they
// would never be reached.
//
// CONSEQUENCE, ON PURPOSE, AND THE ONE TO READ TWICE: switching rateLimits on
// activates the rules that were already in the settings row as well, not only
// these two. Those are PocketBase's own defaults (*:auth 2/3s, *:create 20/5s,
// /api/batch 3/s, /api/ 300/10s) and they apply to the built-in collection
// API. They do NOT touch this project's custom auth routes — /owner/login/*,
// /staff/login and /otp/* are routerAdd routes and carry no tag — and those
// already enforce their own attempt limits in owner_login_attempts,
// staff_login_attempts and sms_budgets. To change a limit for real, change it
// HERE; a boot puts the asserted values back.
//
// Everything is inline for the usual reason: a pb_hooks file does not share an
// outer scope with the runtime that executes the callback.

onBootstrap((e) => {
  e.next(); // let PocketBase finish coming up before reading settings

  const WANT = [
    // the route that spends money and calls out to the gateway
    { label: "/subscription/", audience: "", duration: 60, maxRequests: 10 },
    // the return leg; loose, see the note above
    { label: "/zarinpal/", audience: "", duration: 60, maxRequests: 60 },
  ];

  try {
    const settings = $app.settings();
    const rl = settings.rateLimits;
    let changed = false;

    if (!rl.enabled) {
      $app.logger().warn("SEC-21 rate limit guard: rate limiting was OFF; switching it on");
      rl.enabled = true;
      changed = true;
    }

    // Copy the existing rules out of the Go slice into a plain array so the
    // whole list can be handed back in one assignment; mutating the slice in
    // place is not something the binding promises.
    const current = [];
    for (let i = 0; i < rl.rules.length; i++) {
      const r = rl.rules[i];
      current.push({
        label: r.label,
        audience: r.audience,
        duration: r.duration,
        maxRequests: r.maxRequests,
      });
    }

    const ours = [];
    for (const want of WANT) {
      let found = null;
      for (const r of current) {
        if (r.label === want.label && r.audience === want.audience) { found = r; break; }
      }
      if (!found) {
        $app.logger().warn("SEC-21 rate limit guard: adding a missing rule",
          "label", want.label, "limit", want.maxRequests + "/" + want.duration + "s");
        changed = true;
      } else if (found.duration !== want.duration || found.maxRequests !== want.maxRequests) {
        $app.logger().warn("SEC-21 rate limit guard: repaired a drifted rule",
          "label", want.label,
          "found", found.maxRequests + "/" + found.duration + "s",
          "restored", want.maxRequests + "/" + want.duration + "s");
        changed = true;
      }
      ours.push(want);
    }

    if (!changed) return;

    // ours first — the first matching label wins, and a broad prefix added
    // later must not be able to shadow these
    const rest = current.filter((r) => !WANT.some((w) => w.label === r.label && w.audience === r.audience));
    rl.rules = ours.concat(rest);

    $app.save(settings);
    $app.logger().info("SEC-21 rate limit guard: settings saved",
      "enabled", rl.enabled, "rules", ours.length + rest.length);
  } catch (err) {
    // A failure here must not stop the server booting: the app without an
    // asserted rate limit is the state it has been in all along, while an app
    // that refuses to start serves nobody. Loud enough to be found.
    $app.logger().error("SEC-21 rate limit guard: could not assert rate limits", "error", String(err));
  }
});
