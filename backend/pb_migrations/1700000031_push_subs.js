/// <reference path="../pb_data/types.d.ts" />

// Web push subscriptions for staff tills — one row per device that has
// agreed to receive "a customer is asking for a stamp" notifications.
//
// Scoped to the CAFÉ, not to a user. Staff sign in as their café's shared
// service account (staff.pb.js), so there is no personal identity to hang a
// subscription on; what matters is which café's till this device is, and a
// café may have two — the counter iPad and the owner's phone. Both get the
// push.
//
// The three fields the browser hands over are endpoint/p256dh/auth. They are
// not secrets in the usual sense, but anyone holding them can send that
// device a notification, so the collection is locked to nobody and reached
// only through $app in pb_hooks — same posture as staff_codes and otp_codes.
//
// cascadeDelete on cafe: a café that is deleted should not leave its tills
// subscribed to pushes nothing will ever send.

migrate((app) => {
  const cafeId = app.findCollectionByNameOrId("cafe_card").id;

  const c = new Collection({ type: "base", name: "push_subs" });
  c.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cafeId, cascadeDelete: true }));

  // The push service URL. Unique: re-subscribing the same device must update
  // the existing row rather than accumulate duplicates, which is how a till
  // ends up getting four copies of every notification.
  c.fields.add(new TextField({ name: "endpoint", required: true }));

  // The device's P-256 public key (65 bytes, base64url) and its 16-byte auth
  // secret. Both are needed to encrypt a payload this device can open.
  c.fields.add(new TextField({ name: "p256dh", required: true }));
  c.fields.add(new TextField({ name: "auth", required: true }));

  // Free text from the client — "iPad on the counter". Only ever shown back
  // to the owner so they can tell two tills apart.
  c.fields.add(new TextField({ name: "label" }));

  c.fields.add(new AutodateField({ name: "created", onCreate: true }));
  c.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  c.indexes = [
    "CREATE UNIQUE INDEX `idx_push_subs_endpoint` ON `push_subs` (`endpoint`)",
    "CREATE INDEX `idx_push_subs_cafe` ON `push_subs` (`cafe`)",
  ];

  c.listRule = null; c.viewRule = null;
  c.createRule = null; c.updateRule = null; c.deleteRule = null;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  app.delete(c);
});
