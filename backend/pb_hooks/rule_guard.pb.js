/// <reference path="../pb_data/types.d.ts" />

// SEC-20 — boot-time assertion for the tenant-isolation API rules.
//
// WHY THIS EXISTS. Collection rules are DATABASE state, not code. A migration
// sets them once and is then recorded in _migrations, so it never runs again;
// an edit in the PocketBase dashboard writes no migration file and leaves no
// trace in git. That combination already bit this project once: 1700000009
// scoped reward_options writes to the café's own owner, someone put
// '@request.auth.role = "admin"' back by hand, and because /owner/register is
// open self-serve, every registered owner could rewrite and delete every other
// café's rewards. Nothing in the deploy pipeline could have noticed — a fresh
// deploy of the same code reproduces the vulnerable database exactly.
//
// So the repo asserts the rules it depends on at every boot: mismatch is logged
// loudly WITH the value it found, and repaired. Same spirit as guard.pb.js,
// which exists so a loosened `users` rule still cannot change role/phone.
//
// CONSEQUENCE, ON PURPOSE: the rules below can no longer be changed from the
// dashboard — a boot puts them back. That is the point. To change one for real,
// change it HERE and in a migration, together; the migration keeps a fresh
// database correct and this keeps a live one from drifting. If you tightened a
// rule by hand during an incident and this reverted it, the log line below names
// exactly what it replaced.
//
// The `@request.auth.id != ""` prefix is load-bearing, not noise: PocketBase
// compares an unset relation as an empty string and an anonymous request's
// @request.auth.id is also empty, so without it every rule below is TRUE FOR
// GUESTS on any café whose owner_user is blank (which is the state
// 1700000017 left the Oram café in). See 1700000022_scope_reward_rules.js.
//
// WHY `subscriptions` AND `payments` ARE ON THIS LIST, asserted as null.
// They decide who has paid. The migrations lock every write to superusers so
// that the only way a period moves is the gateway callback — but a lock that
// lives in the database is exactly the kind that gets opened by hand and
// never put back, which is the whole reason this file exists. Loosened,
// `subscriptions.updateRule` lets any owner PATCH their own row through the
// ordinary record API and set `current_period_end` to whenever they like;
// card.pb.js reads that very field, so the café simply never stops working.
// Nothing in git would show it and no redeploy would undo it.
//
// NULL IS NOT THE SAME AS EMPTY. In PocketBase a null rule means superusers
// only, while an empty string means ANYONE — so the repair below must put
// back null itself, not "". That is also why the null check in the loop stays
// where it is: a rule that is already null needs no repair, and a rule that
// has been opened reads back as a string (or ""), falls through, and is reset.

onBootstrap((e) => {
  e.next(); // let PocketBase finish coming up (and run migrations) first

  // Everything is inline for the same reason headers.pb.js keeps its config in
  // the handler: pb_hooks files do not share an outer scope with the runtime.
  const AUTHED = '@request.auth.id != ""';
  const OWNER_OF_THIS_CAFE = AUTHED + ' && @request.auth.id = cafe.owner_user.id';
  // The café's shared staff account is NOT on this one, and that is the whole
  // point of 1700000029. Every employee signs in with the same code and gets
  // a token for one staff_user, so naming it in a read rule let anyone
  // holding that code — a former employee included — GET the plain REST API
  // for every unredeemed coupon the café has and burn them through /redeem,
  // and read the entire customer list and stamp history besides.
  //
  // THIS CONSTANT USED TO INCLUDE cafe.staff_user.id, and this file asserted
  // it at every boot — so the guard written to stop rules drifting away from
  // the migrations was itself dragging these three back to the vulnerable
  // shape, on every single start, logging it each time as a repair. The live
  // database was found already reverted.
  //
  // Spelled to match 1700000029 byte for byte, because the check below is a
  // string comparison: a stray quote style would have this rewriting a
  // correct rule forever.
  const SELF_OR_OWNER = AUTHED +
    ' && (@request.auth.id = user.id || @request.auth.id = cafe.owner_user.id)';

  // stamp_requests is the exception and genuinely needs staff: the till lists
  // the taps waiting to be approved, and subscribes to this collection over
  // realtime. 1700000029 deliberately left it alone.
  const SELF_OR_CAFE_STAFF = AUTHED +
    ' && (@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id)';

  // The same rule as OWNER_OF_THIS_CAFE, spelled with single quotes.
  //
  // NOT a tidy-up waiting to happen. 1700000034/35 wrote the billing rules
  // with single quotes while 1700000022 wrote the reward ones with double;
  // PocketBase parses the two identically, but the check below is a STRING
  // comparison and does not. Asserting the wrong style here would rewrite a
  // perfectly correct rule on every single boot and log a drift warning each
  // time, which is how a guard like this stops being read.
  const OWNER_OF_THIS_CAFE_SQ =
    "@request.auth.id != '' && @request.auth.id = cafe.owner_user.id";

  const EXPECTED = [
    // collection, rule name, required value
    ["reward_options", "createRule", OWNER_OF_THIS_CAFE],
    ["reward_options", "updateRule", OWNER_OF_THIS_CAFE + ' && (@request.body.cafe:isset = false || @request.body.cafe = cafe.id)'],
    ["reward_options", "deleteRule", OWNER_OF_THIS_CAFE],
    ["memberships", "listRule", SELF_OR_OWNER],
    ["memberships", "viewRule", SELF_OR_OWNER],
    ["discounts", "listRule", SELF_OR_OWNER],
    ["discounts", "viewRule", SELF_OR_OWNER],
    ["stamp_events", "listRule", SELF_OR_OWNER],
    ["stamp_events", "viewRule", SELF_OR_OWNER],
    ["stamp_requests", "listRule", SELF_OR_CAFE_STAFF],
    ["stamp_requests", "viewRule", SELF_OR_CAFE_STAFF],

    // Billing. Readable by the café's own owner, writable by nobody but a
    // superuser — see the long note at the top of this file.
    ["subscriptions", "listRule", OWNER_OF_THIS_CAFE_SQ],
    ["subscriptions", "viewRule", OWNER_OF_THIS_CAFE_SQ],
    ["subscriptions", "createRule", null],
    ["subscriptions", "updateRule", null],
    ["subscriptions", "deleteRule", null],
    ["payments", "listRule", OWNER_OF_THIS_CAFE_SQ],
    ["payments", "viewRule", OWNER_OF_THIS_CAFE_SQ],
    ["payments", "createRule", null],
    ["payments", "updateRule", null],
    ["payments", "deleteRule", null],
  ];

  // group by collection so a drifting collection is saved once
  const byCollection = {};
  for (const row of EXPECTED) {
    if (!byCollection[row[0]]) byCollection[row[0]] = [];
    byCollection[row[0]].push([row[1], row[2]]);
  }

  for (const name of Object.keys(byCollection)) {
    try {
      const coll = $app.findCollectionByNameOrId(name);
      let drifted = false;

      for (const pair of byCollection[name]) {
        const rule = pair[0];
        const want = pair[1];
        const got = coll[rule];
        // a null rule means "superusers only" — stricter than every rule we
        // assert and never the regression we are guarding against, so leave
        // it alone rather than loosening it from a hook. For the billing
        // rules, where null IS what we want, this is also the "already
        // correct" path and the reason they cost nothing on a normal boot.
        if (got === null || got === undefined) continue;
        if (want !== null && toString(got) === want) continue;

        $app.logger().warn(
          "SEC-20 rule guard: repaired a drifted API rule",
          "collection", name,
          "rule", rule,
          // an opened rule reads back as "" as readily as it does a filter
          // string, and an empty value in a log line looks like a missing
          // one, so both ends are named rather than printed raw
          "found", got === "" ? "(empty — public)" : toString(got),
          "restored", want === null ? "(null — superusers only)" : want
        );
        coll[rule] = want;
        drifted = true;
      }

      if (drifted) $app.save(coll);
    } catch (err) {
      // a collection that does not exist yet (fresh database, migrations not
      // applied) is not an error worth refusing to boot over
      $app.logger().warn("SEC-20 rule guard: skipped a collection", "collection", name, "error", String(err));
    }
  }
});
