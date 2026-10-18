/// <reference path="../pb_data/types.d.ts" />

// Per-café subscription. Keyed to the café, not the owner: everything else has
// been café-scoped since 1700000009_multi_cafe.js, and an owner running three
// cafés has three sets of tags, staff and customers to pay for. `owner_user`
// records who pays, so a café can change hands without losing its billing
// history.
//
// The shape follows what /business already promises in for-business.js —
// monthly or yearly, a 30-day free trial, a flat fee and no commission — so
// the table cannot describe a product the marketing page does not sell.
//
// `amount` is stored per row rather than looked up from a price list: a past
// period must always say what was actually charged, and must not silently
// re-price itself when the list changes. Same reason `discounts` keeps its own
// `deal` text instead of pointing at the reward it came from.
//
// `trial_ends` is separate from `current_period_end` on purpose. A trial is a
// real state, not a paid period with the price set to zero — the café is live
// but has never paid, and that is exactly the group worth telling apart when
// chasing conversions.
//
// NOT DONE HERE, deliberately: no rows are created for existing cafés. Whether
// a café that is already live should be dropped onto a 30-day trial clock, or
// grandfathered as active, is a commercial decision and this product has real
// cafés on it. The backfill is a one-line follow-up once that is settled.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const cafes = app.findCollectionByNameOrId("cafe_card");

  const c = new Collection({ type: "base", name: "subscriptions" });
  c.fields.add(new RelationField({ name: "cafe", maxSelect: 1, required: true, collectionId: cafes.id, cascadeDelete: true }));
  c.fields.add(new RelationField({ name: "owner_user", maxSelect: 1, collectionId: users.id, cascadeDelete: false }));
  c.fields.add(new SelectField({ name: "status", maxSelect: 1, required: true,
    values: ["trialing", "active", "past_due", "cancelled", "expired"] }));
  c.fields.add(new SelectField({ name: "plan", maxSelect: 1, values: ["monthly", "yearly"] }));
  c.fields.add(new DateField({ name: "trial_ends" }));
  c.fields.add(new DateField({ name: "current_period_end" }));
  c.fields.add(new NumberField({ name: "amount", onlyInt: true, min: 0 }));   // Toman, as charged
  c.fields.add(new AutodateField({ name: "created", onCreate: true }));
  c.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  // One live row per café. History is kept by status, not by piling up rows.
  c.addIndex("idx_subscriptions_cafe", true, "cafe", "");

  // Read-only over the public API, and only by that café's own owner. Every
  // write goes through a hook: this table decides who has paid, so the account
  // it describes must never be able to edit it. Same reasoning as
  // lock_user_writes nulling users.updateRule.
  c.listRule = "@request.auth.id != '' && @request.auth.id = cafe.owner_user.id";
  c.viewRule = c.listRule;
  c.createRule = null;
  c.updateRule = null;
  c.deleteRule = null;
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("subscriptions"));
});
