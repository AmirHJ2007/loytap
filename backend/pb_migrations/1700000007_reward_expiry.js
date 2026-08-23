/// <reference path="../pb_data/types.d.ts" />

// Per-reward expiry: each reward_option says how long a won discount stays valid,
// as an amount + unit (e.g. 2 weeks). The card-completion hook computes the exact
// due date from the moment it's issued. Rewards without these fall back to the
// café-wide reward_expiry_days.
migrate((app) => {
  const rc = app.findCollectionByNameOrId("reward_options");
  rc.fields.add(new NumberField({ name: "expiry_amount", onlyInt: true, min: 0 }));
  rc.fields.add(new SelectField({ name: "expiry_unit", maxSelect: 1, values: ["day", "week", "month"] }));
  app.save(rc);

  // give the seeded rewards a sensible default (30 days) so existing ones keep working
  const opts = app.findRecordsByFilter("reward_options", "id != ''", "", 500, 0, {});
  for (const o of opts) {
    if (!o.getInt("expiry_amount")) {
      o.set("expiry_amount", 30);
      o.set("expiry_unit", "day");
      app.save(o);
    }
  }
}, (app) => {
  const rc = app.findCollectionByNameOrId("reward_options");
  rc.fields.removeByName("expiry_amount");
  rc.fields.removeByName("expiry_unit");
  app.save(rc);
});
