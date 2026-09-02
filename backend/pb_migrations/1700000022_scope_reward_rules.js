/// <reference path="../pb_data/types.d.ts" />

// RE-APPLICATION OF A SECURITY RULE THAT REGRESSED, plus two holes found while
// verifying it. Do not delete this file as a duplicate of 1700000009 — it is
// not redundant, it is the repair.
//
// (1) THE REGRESSION. 1700000009 already scoped reward_options writes to the
// café's own owner. The live database was found back on the pre-9 rule
// ('@request.auth.role = "admin"' for create/update/delete) with no migration
// in between that touches it, i.e. it was reverted by hand in the PocketBase
// dashboard — which writes no migration file, so nothing in the repo records
// the change and nothing re-applies it on the next deploy. That rule constrains
// the CALLER'S ROLE and nothing else, so it never names the record's café.
// /owner/register is open self-serve and mints role="admin", so anyone who
// signs up passes it for EVERY café: reproduced end to end as create on a
// foreign café (200), PATCH of a foreign café's reward (200), DELETE (204).
//
// (2) EMPTY RELATION == EMPTY AUTH ID. `@request.auth.id = cafe.owner_user.id`
// alone is NOT enough. PocketBase compares the unset relation as an empty
// string, and an unauthenticated request's @request.auth.id is also empty, so
// the rule is TRUE FOR GUESTS on any café whose owner_user is blank. That is
// not hypothetical: 1700000017 deleted the seeded Oram owner and left
// cafe_card.owner_user empty on that row, and an anonymous POST/PATCH/DELETE
// against Oram's rewards succeeded (200/200/204) under the bare rule. The same
// blank-target match applies to the read rules on memberships/discounts/
// stamp_events/stamp_requests, where an anonymous list of that café returned
// every membership, every discount code and 543 stamp events. Every rule that
// compares @request.auth.id to a relation therefore gets an explicit
// `@request.auth.id != ""` guard — it costs a signed-in caller nothing and it
// is the only thing standing between a blank relation and the public.
//
// (3) MOVING A RECORD OUT OF ITS TENANT. PocketBase checks an update rule
// against the record as it is STORED, not as it will be, so an owner could
// PATCH cafe -> someone else's café id and have it accepted (verified: 200,
// row moved). Ownership of the OLD café is not permission to write to the NEW
// one, so the update rule now also pins `cafe` to its current value.
//
// Rules are database state, not code. Anyone can revert this again from the
// dashboard, so treat an unexpected diff against these rules as an incident,
// not a cleanup.

migrate((app) => {
  const AUTHED = '@request.auth.id != ""';

  // reward_options: only the owner of THAT café writes it, and cannot move a
  // reward into a café that is not theirs.
  const OWNER_OF_THIS_CAFE = AUTHED + ' && @request.auth.id = cafe.owner_user.id';
  const rewards = app.findCollectionByNameOrId("reward_options");
  rewards.createRule = OWNER_OF_THIS_CAFE;
  rewards.updateRule = OWNER_OF_THIS_CAFE + ' && (@request.body.cafe:isset = false || @request.body.cafe = cafe.id)';
  rewards.deleteRule = OWNER_OF_THIS_CAFE;
  // list/view stay public (empty rule): the customer wallet reads the prize
  // pool unauthenticated. Only the writes were ever the hole.
  app.save(rewards);

  // the customer-data reads: same rule as before, guarded against the blank
  // relation described in (2). No legitimate reader is anonymous.
  const SELF_OR_CAFE_STAFF = AUTHED +
    ' && (@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id)';
  for (const name of ["memberships", "discounts", "stamp_events", "stamp_requests"]) {
    const c = app.findCollectionByNameOrId(name);
    c.listRule = SELF_OR_CAFE_STAFF;
    c.viewRule = SELF_OR_CAFE_STAFF;
    app.save(c);
  }
}, (app) => {
  // Deliberately a no-op, like 1700000017's down.
  //
  // A down() exists to undo a change, but the change here is "stop letting any
  // registered account rewrite every café's rewards, and stop letting anonymous
  // callers read and write a café that has no owner". Restoring the previous
  // state would restore both, and a rollback is normally run in a hurry to
  // escape an unrelated problem — the worst moment to silently re-open a
  // cross-tenant write. The scoped reward rules are also the ones 9 sets, so
  // leaving them keeps a rollback to 21 consistent with the repo's own intent
  // rather than with a dashboard edit nobody recorded.
  //
  // Nothing depends on this up() being reversible: it adds no field, table or
  // row, so leaving the rules scoped costs a rollback nothing.
  //
  // NOTE for anyone rolling back further: 1700000009's own down() DOES restore
  // '@request.auth.role = "admin"' on the three reward rules (it predates
  // knowing that this is the bug). Rolling back past 9 re-opens SEC-20.
});
