/// <reference path="../pb_data/types.d.ts" />

// Security hardening:
//   1. Lock down the `users` collection so a customer can no longer PATCH their
//      own record via the public API (which previously let them set stamp_count,
//      cycles, stamps, or even role). All legit user mutations happen inside hooks
//      via the app DAO, which bypasses collection rules, so nulling updateRule is safe.
//   2. Add cafe_card.stamp_cooldown_minutes — the minimum gap between two stamps
//      for the same customer (anti-farming for copyable static NFC tags).

migrate((app) => {
  // 1. no public-API updates to users (hooks/superuser only)
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = null;
  app.save(users);

  // 2. per-user stamp cooldown, tunable per café (default 3h)
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new NumberField({ name: "stamp_cooldown_minutes", onlyInt: true, min: 0 }));
  app.save(card);

  const rec = app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  if (rec) {
    rec.set("stamp_cooldown_minutes", 180);
    app.save(rec);
  }
}, (app) => {
  // restore the previous (permissive) self-update rule
  try {
    const users = app.findCollectionByNameOrId("users");
    users.updateRule = "@request.auth.id = id";
    app.save(users);
  } catch (e) {}
  try {
    const card = app.findCollectionByNameOrId("cafe_card");
    const fld = card.fields.getByName("stamp_cooldown_minutes");
    if (fld) card.fields.removeById(fld.id);
    app.save(card);
  } catch (e) {}
});
