/// <reference path="../pb_data/types.d.ts" />

// Messages a café sends to the customers who hold its card.
//
// One row per (message, recipient) rather than one row with a recipient
// list: `read` is per-person, the access rule below is then a single
// comparison, and a customer can never see who else it went to. A café
// sending to 286 people writes 286 rows, which is the honest cost of
// per-person state.
//
// `discount` points at the reward minted for THIS recipient, when the café
// attached one. It is a relation, not a copy of the deal text, so the ticket
// in the message and the ticket in the Discounts tab are the same object —
// redeem it in one place and it is redeemed in both.
//
// Same rule shape as memberships/discounts (1700000009_multi_cafe.js): the
// owning customer and that café's own staff/owner can read a row, nobody
// else can. Nothing is written through the public API at all — a PocketBase
// updateRule says WHO may write, not WHICH fields, so letting the recipient
// flip `read` would equally let them rewrite the body of a message their
// café sent them. Marking read goes through a hook that touches that one
// field instead (POST /messages/seen, backend/pb_hooks/messages.pb.js), so
// these rules stay shut.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const cardId = app.findCollectionByNameOrId("cafe_card").id;
  const discId = app.findCollectionByNameOrId("discounts").id;
  const SELF_OR_CAFE_STAFF = '@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id';

  const msgs = new Collection({ type: "base", name: "messages" });
  msgs.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  msgs.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  msgs.fields.add(new TextField({ name: "body", required: true, max: 2000 }));
  msgs.fields.add(new RelationField({ name: "discount", maxSelect: 1, collectionId: discId, cascadeDelete: false }));
  msgs.fields.add(new BoolField({ name: "read" }));
  msgs.fields.add(new AutodateField({ name: "created", onCreate: true }));
  msgs.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  msgs.listRule = SELF_OR_CAFE_STAFF;
  msgs.viewRule = SELF_OR_CAFE_STAFF;
  msgs.createRule = null;
  msgs.updateRule = null;
  msgs.deleteRule = null;
  app.save(msgs);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("messages")); } catch (e) {}
});
