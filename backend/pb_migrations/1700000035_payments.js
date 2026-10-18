/// <reference path="../pb_data/types.d.ts" />

// Payments against a café's subscription, through ZarinPal.
//
// A row is written BEFORE the owner is ever sent to the gateway. That ordering
// is the whole point: once they leave this site the next thing that happens is
// outside our control, and a charge whose callback never arrives — closed tab,
// dead wifi, a redirect that 500s — has to be recoverable from our own records
// plus ZarinPal's. Creating the row after the fact would make a successful
// payment invisible to us, which is the one failure nobody can be asked to
// tolerate.
//
// `authority` is ZarinPal's handle for the attempt and is what ties our row to
// theirs; it is unique so a replayed callback cannot be processed twice.
// `ref_id` only exists once money actually moved, so its presence is the real
// answer to "was this paid", not `status`.
//
// `amount` and `plan` are frozen here at request time. They are what we asked
// ZarinPal to charge, so they are what verification must be checked against —
// a price the client could still influence after this point is not a price.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const cafes = app.findCollectionByNameOrId("cafe_card");
  const subs  = app.findCollectionByNameOrId("subscriptions");

  const c = new Collection({ type: "base", name: "payments" });
  c.fields.add(new RelationField({ name: "cafe", maxSelect: 1, required: true, collectionId: cafes.id, cascadeDelete: false }));
  c.fields.add(new RelationField({ name: "owner_user", maxSelect: 1, collectionId: users.id, cascadeDelete: false }));
  c.fields.add(new RelationField({ name: "subscription", maxSelect: 1, collectionId: subs.id, cascadeDelete: false }));
  c.fields.add(new SelectField({ name: "plan", maxSelect: 1, required: true, values: ["monthly", "yearly"] }));
  c.fields.add(new NumberField({ name: "amount", onlyInt: true, min: 1, required: true }));   // Toman, as sent to ZarinPal
  c.fields.add(new SelectField({ name: "status", maxSelect: 1, required: true,
    values: ["pending", "paid", "failed", "cancelled"] }));
  c.fields.add(new TextField({ name: "authority", max: 100 }));   // ZarinPal's handle for the attempt
  c.fields.add(new TextField({ name: "ref_id", max: 60 }));       // only set once money moved
  c.fields.add(new TextField({ name: "note", max: 300 }));        // why a failure failed, for support
  c.fields.add(new DateField({ name: "paid_at" }));
  c.fields.add(new AutodateField({ name: "created", onCreate: true }));
  c.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  // A callback can arrive twice — ZarinPal retrying, or the owner refreshing
  // the return page. Uniqueness here is what makes replaying one harmless.
  c.addIndex("idx_payments_authority", true, "authority", "authority != ''");
  c.addIndex("idx_payments_cafe", false, "cafe", "");

  // Read-only over the public API, and only your own café's. Every write goes
  // through a hook: this table says who paid what, so the account it bills
  // must never be able to edit it. Same reasoning as subscriptions.
  c.listRule = "@request.auth.id != '' && @request.auth.id = cafe.owner_user.id";
  c.viewRule = c.listRule;
  c.createRule = null;
  c.updateRule = null;
  c.deleteRule = null;
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("payments"));
});
