/// <reference path="../pb_data/types.d.ts" />

// A stamp is no longer granted the instant a tag is tapped. The tap creates a
// PENDING stamp_requests row; a staff member at that café must confirm it
// (POST /card/stamp/confirm) before the stamp actually lands — closing the
// "customer captures the tag code and re-stamps themselves" hole, since
// possessing the code is no longer enough on its own.
//
// Same access-rule shape as memberships/discounts (1700000009_multi_cafe.js):
// the owning customer and that café's own staff/owner can see a request;
// nobody else can, and nothing is ever created/updated through the public API
// — only pb_hooks (card.pb.js) touches this collection via $app.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const cardId = app.findCollectionByNameOrId("cafe_card").id;
  const SELF_OR_CAFE_STAFF = '@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id';

  const reqs = new Collection({ type: "base", name: "stamp_requests" });
  reqs.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  reqs.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  reqs.fields.add(new TextField({ name: "user_name" })); // denormalised so staff sees who tapped without an expand
  reqs.fields.add(new TextField({ name: "tag" }));
  reqs.fields.add(new SelectField({ name: "status", required: true, maxSelect: 1, values: ["pending", "approved", "denied", "expired"] }));
  reqs.fields.add(new JSONField({ name: "result", maxSize: 2000000 })); // filled in on approve: the stamp/reward payload the customer's client needs
  reqs.fields.add(new AutodateField({ name: "created", onCreate: true }));
  reqs.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  reqs.listRule = SELF_OR_CAFE_STAFF; reqs.viewRule = SELF_OR_CAFE_STAFF;
  reqs.createRule = null; reqs.updateRule = null; reqs.deleteRule = null;
  app.save(reqs);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("stamp_requests")); } catch (e) {}
});
