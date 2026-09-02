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
// CONSEQUENCE, ON PURPOSE: these six rules can no longer be changed from the
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

onBootstrap((e) => {
  e.next(); // let PocketBase finish coming up (and run migrations) first

  // Everything is inline for the same reason headers.pb.js keeps its config in
  // the handler: pb_hooks files do not share an outer scope with the runtime.
  const AUTHED = '@request.auth.id != ""';
  const OWNER_OF_THIS_CAFE = AUTHED + ' && @request.auth.id = cafe.owner_user.id';
  const SELF_OR_CAFE_STAFF = AUTHED +
    ' && (@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id)';

  const EXPECTED = [
    // collection, rule name, required value
    ["reward_options", "createRule", OWNER_OF_THIS_CAFE],
    ["reward_options", "updateRule", OWNER_OF_THIS_CAFE + ' && (@request.body.cafe:isset = false || @request.body.cafe = cafe.id)'],
    ["reward_options", "deleteRule", OWNER_OF_THIS_CAFE],
    ["memberships", "listRule", SELF_OR_CAFE_STAFF],
    ["memberships", "viewRule", SELF_OR_CAFE_STAFF],
    ["discounts", "listRule", SELF_OR_CAFE_STAFF],
    ["discounts", "viewRule", SELF_OR_CAFE_STAFF],
    ["stamp_events", "listRule", SELF_OR_CAFE_STAFF],
    ["stamp_events", "viewRule", SELF_OR_CAFE_STAFF],
    ["stamp_requests", "listRule", SELF_OR_CAFE_STAFF],
    ["stamp_requests", "viewRule", SELF_OR_CAFE_STAFF],
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
        // a null rule means "superusers only" — stricter than expected and
        // never the regression we are guarding against, so leave it alone
        // rather than loosening it from a hook.
        if (got === null || got === undefined) continue;
        if (toString(got) === want) continue;

        $app.logger().warn(
          "SEC-20 rule guard: repaired a drifted API rule",
          "collection", name,
          "rule", rule,
          "found", toString(got),
          "restored", want
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
