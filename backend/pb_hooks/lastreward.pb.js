/// <reference path="../pb_data/types.d.ts" />

// A café must always have at least one reward option.
//
// The customer card draws its prize from this collection (card.pb.js picks a
// random active option when a card completes). A café with none cannot finish
// a card at all: the customer fills every slot and gets nothing, which is the
// worst failure this product has — it happens at the counter, in front of the
// person who just earned it.
//
// Deleting rewards goes straight through PocketBase's own collection API from
// the owner dashboard, so there was nothing in the way of removing the last
// one. The UI now refuses too (owner.page.js), but the UI is not the guard:
// this endpoint is reachable with any owner's token and a one-line fetch.
//
// onRecordDeleteRequest, NOT onRecordDelete: the model-level hook fires for
// internal cascades as well, so it would block deleting a café — that cascade
// removes its rewards, and the last one would take the whole delete down with
// it. This hook only guards the HTTP path, which is the one an owner uses.
onRecordDeleteRequest((e) => {
  const cafe = e.record.getString("cafe");
  if (!cafe) return e.next(); // orphan row — nothing to protect

  let remaining = 0;
  try {
    // count the café's others, not its total: the row being deleted is still
    // present at this point, so a plain count is always >= 1 and would let the
    // last one through
    remaining = $app.findRecordsByFilter(
      "reward_options", "cafe = {:c} && id != {:id}", "", 2, 0,
      { c: cafe, id: e.record.id }
    ).length;
  } catch (err) {
    // A count we cannot take is not permission to delete the last reward:
    // failing closed here costs an owner one confusing refusal, where failing
    // open costs a customer the prize they filled a card for.
    $app.logger().error("last-reward check failed", "error", String(err));
    throw new BadRequestError("Could not verify the café's other rewards. Please try again.");
  }

  if (remaining === 0) {
    throw new BadRequestError("A café must keep at least one reward. Add another one first, then delete this.");
  }
  e.next();
}, "reward_options");
