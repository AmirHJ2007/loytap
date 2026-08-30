/// <reference path="../pb_data/types.d.ts" />

// cafe_card.listRule/viewRule are (intentionally) public — the customer wallet
// reads café name/tagline/theme via `expand=cafe` on memberships/discounts,
// which requires the expanded collection to be readable. But staff_code lived
// on that same row, so it was public too: anyone could GET
// /api/collections/cafe_card/records (or just load their own wallet) and read
// every café's staff login code in plaintext — the exact credential
// /staff/login accepts, no auth needed to obtain it.
//
// PocketBase rules are row-level, not field-level, so there's no way to keep
// cafe_card expandable while hiding just one field on it. Move staff_code
// into its own collection with rules locked to nobody (only reachable via
// $app in pb_hooks, same as nfc_tags/otp_codes already are).

migrate((app) => {
  const cardId = app.findCollectionByNameOrId("cafe_card").id;

  const codes = new Collection({ type: "base", name: "staff_codes" });
  codes.fields.add(new RelationField({ name: "cafe", required: true, maxSelect: 1, collectionId: cardId, cascadeDelete: true }));
  codes.fields.add(new TextField({ name: "code", required: true }));
  codes.fields.add(new AutodateField({ name: "created", onCreate: true }));
  codes.indexes = ["CREATE UNIQUE INDEX `idx_staff_codes_code` ON `staff_codes` (`code`)"];
  codes.listRule = null; codes.viewRule = null;
  codes.createRule = null; codes.updateRule = null; codes.deleteRule = null;
  app.save(codes);

  for (const c of app.findRecordsByFilter("cafe_card", "staff_code != ''", "", 5000, 0, {})) {
    const rec = new Record(codes);
    rec.set("cafe", c.id);
    rec.set("code", c.getString("staff_code"));
    app.save(rec);
  }

  const card = app.findCollectionByNameOrId("cafe_card");
  const fld = card.fields.getByName("staff_code");
  if (fld) card.fields.removeById(fld.id);
  app.save(card);
}, (app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new TextField({ name: "staff_code" }));
  app.save(card);

  try {
    const codes = app.findCollectionByNameOrId("staff_codes");
    for (const rec of app.findRecordsByFilter("staff_codes", "id != ''", "", 5000, 0, {})) {
      const c = app.findRecordById("cafe_card", rec.getString("cafe"));
      if (c) { c.set("staff_code", rec.getString("code")); app.save(c); }
    }
    app.delete(codes);
  } catch (e) {}
});
