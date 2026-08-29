/// <reference path="../pb_data/types.d.ts" />

// Per-card "required stamps" snapshot on each membership. The café's
// stamps_required is now editable, but a change must NOT move the goalposts for
// a card already in progress — it only applies to each customer's NEXT card.
// So the goal is locked onto the membership when a card starts (card.pb.js) and
// read from there. Backfill locks every existing card to its café's current value.

migrate((app) => {
  const m = app.findCollectionByNameOrId("memberships");
  m.fields.add(new NumberField({ name: "card_required", onlyInt: true, min: 0 }));
  app.save(m);

  const req = {}; // cafe id -> current stamps_required
  for (const rec of app.findRecordsByFilter("memberships", "id != ''", "", 50000, 0, {})) {
    const cid = rec.getString("cafe");
    if (!(cid in req)) {
      try { req[cid] = app.findRecordById("cafe_card", cid).getInt("stamps_required") || 8; } catch (e) { req[cid] = 8; }
    }
    rec.set("card_required", req[cid]);
    app.save(rec);
  }
}, (app) => {
  const m = app.findCollectionByNameOrId("memberships");
  const f = m.fields.getByName("card_required");
  if (f) m.fields.removeById(f.id);
  app.save(m);
});
