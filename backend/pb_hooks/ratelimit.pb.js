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
// TWO STEPS, NOT ONE. The rules are asserted on every boot; enforcement waits
// for RATE_LIMITS=on in the environment. Switching rateLimits on activates
// the rules already sitting in the settings row as well as these two —
// PocketBase's defaults (*:auth 2/3s, *:create 20/5s, /api/batch 3/s, /api/
// 300/10s) against the built-in collection API, which the customer wallet and
// the staff till both use and which have never been enforced against real
// traffic. Doing that inside a deploy would apply it to every café at once
// with no way back but another deploy, so it is a separate, reversible step.
//
// The defaults do NOT touch this project's custom auth routes — /owner/login/*,
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
    // The route that spends money and calls out to the gateway.
    //
    // SPLIT BY AUDIENCE, because the limiter runs BEFORE authentication: an
    // unauthenticated request is counted and then refused by the handler, so
    // with one shared rule anonymous traffic drew down the very same per-IP
    // budget the café owner needs. Under Iranian carrier NAT, where a great
    // many subscribers leave through one address, a stranger could have kept
    // a real owner from paying without ever holding a token.
    //
    // Ten a minute for an owner — far above a person clicking "pay" once and
    // maybe twice. Five for a guest, who has no legitimate reason to be here
    // at all and only ever receives a 403; the budget exists to absorb a
    // misrouted retry, not to serve anybody.
    { label: "/subscription/", audience: "@auth", duration: 60, maxRequests: 10 },
    { label: "/subscription/", audience: "@guest", duration: 60, maxRequests: 5 },
    // The return leg stays shared: ZarinPal sends the owner's browser back
    // carrying no session of ours, so every legitimate callback is a guest.
    // Loose for the reason in the note above.
    { label: "/zarinpal/", audience: "", duration: 60, maxRequests: 60 },
  ];

  try {
    const settings = $app.settings();
    const rl = settings.rateLimits;
    let changed = false;

    // THE MASTER SWITCH IS NOT FLIPPED BY A DEPLOY. The rules below are
    // always asserted; whether rate limiting is actually ON waits for
    // RATE_LIMITS=on in the environment.
    //
    // WHY, when every other guard in this file asserts its state outright.
    // Turning the switch on does not only activate the two rules this file
    // adds. It also wakes the ones already sitting in the settings row —
    // PocketBase's defaults against the generic collection API, which the
    // customer wallet and the staff till both use, and which have never once
    // been enforced against real traffic. Flipping it inside a deploy applies
    // all of that to every café simultaneously, with no gradual rollout and
    // no way back except another deploy. The failure mode is a 429 at
    // somebody's till during service.
    //
    // It is also the one thing here that depends on a setting this file does
    // not control: the limiter keys on realIP(), which reports the proxy's
    // address for everyone unless Settings > trustedProxy names
    // X-Forwarded-For. Get that wrong and these are not per-visitor budgets
    // at all, they are one budget for the whole platform.
    //
    // So: deploy, read the log, confirm trustedproxy.pb.js is quiet and the
    // rules landed, then set RATE_LIMITS=on and restart. Two steps, and the
    // second one is reversible by unsetting a variable rather than by
    // shipping code.
    const enforce = $os.getenv("RATE_LIMITS") === "on";

    if (enforce && !rl.enabled) {
      $app.logger().warn("SEC-21 rate limit guard: RATE_LIMITS=on — switching rate limiting ON");
      rl.enabled = true;
      changed = true;
    } else if (!enforce && !rl.enabled) {
      $app.logger().info(
        "SEC-21 rate limit guard: rules asserted but rate limiting is OFF — set RATE_LIMITS=on to enforce them");
    } else if (!enforce && rl.enabled) {
      // Deliberately NOT switched back off. Someone turned it on, here or by
      // hand, and quietly removing a protection because an env var is absent
      // is the opposite of what this file is for.
      $app.logger().warn(
        "SEC-21 rate limit guard: rate limiting is ON but RATE_LIMITS is not set — leaving it on");
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
        ours.push(want);
        continue;
      }

      // A HAND-TIGHTENED LIMIT IS LEFT ALONE, the same way rule_guard refuses
      // on principle to loosen a rule somebody made stricter than it asserts.
      //
      // This used to compare symmetrically and restore in both directions, so
      // an operator who clamped /subscription/ to 1/60 during an incident had
      // it quietly reopened to 10/60 by the next crash-restart. The two
      // sibling guards disagreed about whether a tightening counts as drift,
      // and this one was wrong: a limit below what we ask for is somebody
      // protecting the system, not the regression we are here to catch.
      //
      // Stricter means fewer requests per second. Compare the rates rather
      // than the pair of numbers, so 1/60 and 10/600 are judged on what they
      // actually permit.
      const wantRate = want.maxRequests / want.duration;
      const foundRate = found.maxRequests / found.duration;

      if (foundRate <= wantRate) {
        if (foundRate < wantRate) {
          $app.logger().info("SEC-21 rate limit guard: leaving a hand-tightened limit as it is",
            "label", want.label,
            "found", found.maxRequests + "/" + found.duration + "s",
            "would_assert", want.maxRequests + "/" + want.duration + "s");
        }
        ours.push(found);          // keep theirs, not ours
        continue;
      }

      $app.logger().warn("SEC-21 rate limit guard: repaired a loosened rule",
        "label", want.label,
        "found", found.maxRequests + "/" + found.duration + "s",
        "restored", want.maxRequests + "/" + want.duration + "s");
      changed = true;
      ours.push(want);
    }

    // Anything else carrying a label we manage has to go, and this is keyed on
    // the LABEL ALONE rather than on label-plus-audience.
    //
    // PocketBase validates that a label appears once across the whole list,
    // audience or no audience. So leaving an older shared "/subscription/"
    // rule in place beside the two that replace it does not merely duplicate
    // it — the whole settings save is rejected with "already exists or
    // conflicts with another rule", every rule stays as it was, and the only
    // sign is one line in the log. Found exactly that way: the first version
    // of this filter matched on label and audience, kept the stale rule, and
    // silently asserted nothing on every boot.
    const owned = {};
    for (const w of WANT) owned[w.label] = true;
    const rest = current.filter((r) => !owned[r.label]);
    if (rest.length !== current.length - ours.length) changed = true;   // something of ours is being dropped

    if (!changed) return;

    // ours first — the first matching label wins, and a broad prefix added
    // later must not be able to shadow these
    rl.rules = ours.concat(rest);

    $app.save(settings);
    $app.logger().info("SEC-21 rate limit guard: settings saved",
      "enforcing", rl.enabled, "rules", ours.length + rest.length);
  } catch (err) {
    // A failure here must not stop the server booting: the app without an
    // asserted rate limit is the state it has been in all along, while an app
    // that refuses to start serves nobody. Loud enough to be found.
    $app.logger().error("SEC-21 rate limit guard: could not assert rate limits", "error", String(err));
  }
});
