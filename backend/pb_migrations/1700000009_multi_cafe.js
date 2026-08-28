/// <reference path="../pb_data/types.d.ts" />

// Multi-café support: a customer can now hold a loyalty card at more than one
// café. Per-café progress moves off `users` into a new `memberships` row
// (user + cafe + stamp_count + cycles + stamps). Every café-scoped collection
// (nfc_tags, reward_options, discounts, stamp_events) gets a `cafe` relation so
// tags, prize pools, earned rewards and the audit log are all scoped to one café.
// cafe_card gets `owner_user` (mirrors the existing `staff_user`) so a café's
// admin/analytics hooks can resolve "my café" from the authenticated user.
//
// This also closes a cross-tenant leak: the old SELF_OR_STAFF rule let ANY
// café's staff/admin list ANY customer's discounts/stamp_events. Now scoped to
// that record's own café via `cafe.staff_user` / `cafe.owner_user`.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const card = app.findCollectionByNameOrId("cafe_card");

  card.fields.add(new RelationField({ name: "owner_user", maxSelect: 1, collectionId: usersId, cascadeDelete: false }));
  app.save(card);
  const cardId = card.id;

  const SELF_OR_CAFE_STAFF = '@request.auth.id = user.id || @request.auth.id = cafe.staff_user.id || @request.auth.id = cafe.owner_user.id';

  // ===== memberships (per-user, per-café progress) =====
  const memberships = new Collection({ type: "base", name: "memberships" });
  memberships.fields.add(new RelationField({ name: "user", required: true, maxSelect: 1, collectionId: usersId, cascadeDelete: true }));
  memberships.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  memberships.fields.add(new NumberField({ name: "stamp_count", onlyInt: true, min: 0 }));
  memberships.fields.add(new NumberField({ name: "cycles", onlyInt: true, min: 0 }));
  memberships.fields.add(new JSONField({ name: "stamps", maxSize: 2000000 }));
  memberships.fields.add(new AutodateField({ name: "created", onCreate: true }));
  memberships.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  memberships.indexes = ["CREATE UNIQUE INDEX `idx_membership_user_cafe` ON `memberships` (`user`,`cafe`)"];
  memberships.listRule = SELF_OR_CAFE_STAFF; memberships.viewRule = SELF_OR_CAFE_STAFF;
  memberships.createRule = null; memberships.updateRule = null; memberships.deleteRule = null;
  app.save(memberships);

  // ===== add `cafe` to every café-scoped collection =====
  const tags = app.findCollectionByNameOrId("nfc_tags");
  tags.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  app.save(tags);

  // reward_options write rules were '@request.auth.role = "admin"' — ANY café's
  // owner could create/edit/delete ANY café's rewards. Scope to that café's own owner.
  const rewards = app.findCollectionByNameOrId("reward_options");
  rewards.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  rewards.createRule = '@request.auth.id = cafe.owner_user.id';
  rewards.updateRule = '@request.auth.id = cafe.owner_user.id';
  rewards.deleteRule = '@request.auth.id = cafe.owner_user.id';
  app.save(rewards);

  const discounts = app.findCollectionByNameOrId("discounts");
  discounts.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  discounts.listRule = SELF_OR_CAFE_STAFF; discounts.viewRule = SELF_OR_CAFE_STAFF;
  app.save(discounts);

  const events = app.findCollectionByNameOrId("stamp_events");
  events.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  events.listRule = SELF_OR_CAFE_STAFF; events.viewRule = SELF_OR_CAFE_STAFF;
  app.save(events);

  // ===== backfill existing single-café data into the new model =====
  const defaultCafe = app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  if (defaultCafe) {
    try {
      const owner = app.findFirstRecordByFilter("users", "phone = '9121234567'");
      if (owner) { defaultCafe.set("owner_user", owner.id); app.save(defaultCafe); }
    } catch (e) {}

    for (const t of app.findRecordsByFilter("nfc_tags", "id != ''", "", 5000, 0, {})) {
      t.set("cafe", defaultCafe.id); app.save(t);
    }
    for (const r of app.findRecordsByFilter("reward_options", "id != ''", "", 5000, 0, {})) {
      r.set("cafe", defaultCafe.id); app.save(r);
    }
    for (const d of app.findRecordsByFilter("discounts", "id != ''", "", 20000, 0, {})) {
      d.set("cafe", defaultCafe.id); app.save(d);
    }
    for (const ev of app.findRecordsByFilter("stamp_events", "id != ''", "", 20000, 0, {})) {
      ev.set("cafe", defaultCafe.id); app.save(ev);
    }

    const membershipsColl = app.findCollectionByNameOrId("memberships");
    const custs = app.findRecordsByFilter("users", "role = 'customer'", "", 20000, 0, {});
    for (const c of custs) {
      const sc = c.getInt("stamp_count");
      const cy = c.getInt("cycles");
      let stamps = [];
      try { const raw = toString(c.get("stamps")); if (raw && raw !== "null") stamps = JSON.parse(raw); } catch (e) {}
      if (sc > 0 || cy > 0 || (Array.isArray(stamps) && stamps.length > 0)) {
        const m = new Record(membershipsColl);
        m.set("user", c.id);
        m.set("cafe", defaultCafe.id);
        m.set("stamp_count", sc);
        m.set("cycles", cy);
        m.set("stamps", stamps);
        app.save(m);
      }
    }
  }

  // ===== stamp_count/cycles/stamps now live on memberships, not users =====
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["stamp_count", "cycles", "stamps"]) {
    const fld = users.fields.getByName(f);
    if (fld) users.fields.removeById(fld.id);
  }
  app.save(users);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("memberships")); } catch (e) {}
  for (const name of ["nfc_tags", "reward_options", "discounts", "stamp_events"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      const fld = c.fields.getByName("cafe");
      if (fld) c.fields.removeById(fld.id);
      app.save(c);
    } catch (e) {}
  }
  try {
    const rc = app.findCollectionByNameOrId("reward_options");
    rc.createRule = '@request.auth.role = "admin"';
    rc.updateRule = '@request.auth.role = "admin"';
    rc.deleteRule = '@request.auth.role = "admin"';
    app.save(rc);
  } catch (e) {}
  try {
    const card = app.findCollectionByNameOrId("cafe_card");
    const fld = card.fields.getByName("owner_user");
    if (fld) card.fields.removeById(fld.id);
    app.save(card);
  } catch (e) {}
  try {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new NumberField({ name: "stamp_count", onlyInt: true, min: 0 }));
    users.fields.add(new NumberField({ name: "cycles", onlyInt: true, min: 0 }));
    users.fields.add(new JSONField({ name: "stamps", maxSize: 2000000 }));
    app.save(users);
  } catch (e) {}
});
