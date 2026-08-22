/// <reference path="../pb_data/types.d.ts" />

// LoyTap schema — single café, roles customer/staff/admin, random weighted rewards.
// See ../README.md. Sensitive fields (stamp_count, discounts) are written only by
// server hooks (next step); the collection rules below lock out direct client writes.
//
// Rule values: ""  = public (anyone);  null = superusers/hooks only;  "<expr>" = filtered.
// NOTE: in this PB version, fields must be added via `.fields.add(...)` — the
// `new Collection({ fields: [...] })` constructor form silently drops them.

migrate((app) => {
  const SELF_OR_STAFF = '@request.auth.id = user.id || @request.auth.role = "staff" || @request.auth.role = "admin"';
  const STAFF = '@request.auth.role = "staff" || @request.auth.role = "admin"';
  const ADMIN = '@request.auth.role = "admin"';

  // ===== extend the default `users` (auth) collection =====
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "phone", required: true }));
  users.fields.add(new SelectField({ name: "role", maxSelect: 1, values: ["customer", "staff", "admin"] }));
  users.fields.add(new NumberField({ name: "stamp_count", onlyInt: true, min: 0 }));
  users.fields.add(new NumberField({ name: "cycles", onlyInt: true, min: 0 }));
  users.indexes = users.indexes.concat(["CREATE UNIQUE INDEX `idx_users_phone` ON `users` (`phone`)"]);
  users.listRule = '@request.auth.id = id || ' + STAFF;
  users.viewRule = '@request.auth.id = id || ' + STAFF;
  users.createRule = null;
  users.updateRule = "@request.auth.id = id"; // hook rejects changes to stamp_count/role/cycles
  users.deleteRule = ADMIN;
  app.save(users);
  const usersId = users.id;

  // ===== reward_options (the prize pool) =====
  const rewards = new Collection({ type: "base", name: "reward_options" });
  rewards.fields.add(new TextField({ name: "deal", required: true }));
  rewards.fields.add(new TextField({ name: "description" }));
  rewards.fields.add(new NumberField({ name: "weight", min: 0 }));
  rewards.fields.add(new BoolField({ name: "active" }));
  rewards.fields.add(new AutodateField({ name: "created", onCreate: true }));
  rewards.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  rewards.listRule = ""; rewards.viewRule = "";
  rewards.createRule = null; rewards.updateRule = null; rewards.deleteRule = null;
  app.save(rewards);
  const rewardsId = rewards.id;

  // ===== cafe_card (the card definition) =====
  const card = new Collection({ type: "base", name: "cafe_card" });
  card.fields.add(new TextField({ name: "cafe_name" }));
  card.fields.add(new NumberField({ name: "stamps_required", onlyInt: true, min: 1 }));
  card.fields.add(new NumberField({ name: "reward_expiry_days", onlyInt: true, min: 0 }));
  card.fields.add(new TextField({ name: "theme" }));
  card.fields.add(new AutodateField({ name: "created", onCreate: true }));
  card.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  card.listRule = ""; card.viewRule = "";
  card.createRule = null; card.updateRule = null; card.deleteRule = null;
  app.save(card);

  // ===== stamp_events (audit log) =====
  const events = new Collection({ type: "base", name: "stamp_events" });
  events.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  events.fields.add(new SelectField({ name: "source", maxSelect: 1, values: ["nfc", "manual", "staff"] }));
  events.fields.add(new TextField({ name: "tag" }));
  events.fields.add(new AutodateField({ name: "created", onCreate: true }));
  events.listRule = SELF_OR_STAFF; events.viewRule = SELF_OR_STAFF;
  events.createRule = null; events.updateRule = null; events.deleteRule = null;
  app.save(events);

  // ===== discounts (earned rewards) =====
  const discounts = new Collection({ type: "base", name: "discounts" });
  discounts.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  discounts.fields.add(new RelationField({ name: "reward_option", maxSelect: 1, collectionId: rewardsId, cascadeDelete: false }));
  discounts.fields.add(new TextField({ name: "code", required: true }));
  discounts.fields.add(new TextField({ name: "deal" }));
  discounts.fields.add(new TextField({ name: "description" }));
  discounts.fields.add(new BoolField({ name: "one_time" }));
  discounts.fields.add(new DateField({ name: "due_date" }));
  discounts.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["active", "redeemed", "expired"] }));
  discounts.fields.add(new DateField({ name: "redeemed_at" }));
  discounts.fields.add(new RelationField({ name: "redeemed_by", maxSelect: 1, collectionId: usersId, cascadeDelete: false }));
  discounts.fields.add(new AutodateField({ name: "created", onCreate: true }));
  discounts.indexes = ["CREATE UNIQUE INDEX `idx_discounts_code` ON `discounts` (`code`)"];
  discounts.listRule = SELF_OR_STAFF; discounts.viewRule = SELF_OR_STAFF;
  discounts.createRule = null; discounts.updateRule = STAFF; discounts.deleteRule = null; // redeem = staff/admin
  app.save(discounts);

  // ===== otp_codes (SMS OTP flow — server only) =====
  const otp = new Collection({ type: "base", name: "otp_codes" });
  otp.fields.add(new TextField({ name: "phone", required: true }));
  otp.fields.add(new TextField({ name: "code_hash", required: true }));
  otp.fields.add(new DateField({ name: "expires" }));
  otp.fields.add(new NumberField({ name: "attempts", onlyInt: true, min: 0 }));
  otp.fields.add(new AutodateField({ name: "created", onCreate: true }));
  otp.listRule = null; otp.viewRule = null; otp.createRule = null; otp.updateRule = null; otp.deleteRule = null;
  app.save(otp);

  // ===== nfc_tags (tap system — server only) =====
  const tags = new Collection({ type: "base", name: "nfc_tags" });
  tags.fields.add(new TextField({ name: "code", required: true }));
  tags.fields.add(new BoolField({ name: "active" }));
  tags.fields.add(new SelectField({ name: "type", maxSelect: 1, values: ["static", "dynamic"] }));
  tags.fields.add(new DateField({ name: "last_used" }));
  tags.fields.add(new AutodateField({ name: "created", onCreate: true }));
  tags.indexes = ["CREATE UNIQUE INDEX `idx_nfc_code` ON `nfc_tags` (`code`)"];
  tags.listRule = null; tags.viewRule = null; tags.createRule = null; tags.updateRule = null; tags.deleteRule = null;
  app.save(tags);
}, (app) => {
  for (const name of ["nfc_tags", "otp_codes", "discounts", "stamp_events", "cafe_card", "reward_options"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) {}
  }
  try {
    const users = app.findCollectionByNameOrId("users");
    for (const f of ["phone", "role", "stamp_count", "cycles"]) {
      const fld = users.fields.getByName(f);
      if (fld) users.fields.removeById(fld.id);
    }
    users.indexes = users.indexes.filter((x) => !x.includes("idx_users_phone"));
    app.save(users);
  } catch (e) {}
});
