/// <reference path="../pb_data/types.d.ts" />

// Take the café's shared staff account off the read rules for discounts,
// memberships and stamp_events.
//
// THE HOLE. Every employee at a café signs in with the same shared staff code
// and gets a token for the ONE staff_user that /owner/register created for
// that café (staff.pb.js /staff/login → card.staff_user). The read rules on
// these three collections named that account, so anyone holding the staff
// code could ask the plain REST API for
//
//   GET /api/collections/discounts/records?perPage=200
//
// and get back every unredeemed coupon code the café has outstanding, then
// burn them all through /redeem (which accepts staff role for its own café).
// Customers turn up to claim a reward that is already marked used, and there
// is nothing in the app to show what happened. memberships and stamp_events
// leaked the café's whole customer list and every customer's stamp history
// the same way. A former employee who still remembers the code is enough.
//
// WHY REMOVING IT COSTS NOTHING. No client ever used that access — staff.js
// reads only stamp_requests, owner.page.js reads only reward_options, and
// every other staff/owner feature goes through a pb_hooks route that uses
// $app directly and so bypasses collection rules entirely. In particular
// /redeem looks the discount up server-side by code (redeem.pb.js), which is
// why the scanner keeps working with no API read access at all: the phone
// sends one code and the server answers, it never downloads a list.
//
// Same reasoning as 1700000014_lock_access_rules.js, which locked down
// users.listRule and discounts.updateRule for exactly this class of bug: the
// real flows do not touch these rules, so tightening them removes an attack
// surface and no feature.
//
// The owner keeps their access — an owner reading their own café's data is
// the point — and the customer keeps theirs.

migrate((app) => {
  const SELF_OR_OWNER =
    '@request.auth.id != "" && (@request.auth.id = user.id || @request.auth.id = cafe.owner_user.id)';

  for (const name of ["discounts", "memberships", "stamp_events"]) {
    const c = app.findCollectionByNameOrId(name);
    c.listRule = SELF_OR_OWNER;
    c.viewRule = SELF_OR_OWNER;
    app.save(c);
  }
}, (app) => {
  const WITH_STAFF =
    '@request.auth.id != "" && (@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id)';

  for (const name of ["discounts", "memberships", "stamp_events"]) {
    const c = app.findCollectionByNameOrId(name);
    c.listRule = WITH_STAFF;
    c.viewRule = WITH_STAFF;
    app.save(c);
  }
});
