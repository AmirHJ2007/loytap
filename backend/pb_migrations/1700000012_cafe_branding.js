/// <reference path="../pb_data/types.d.ts" />

// Per-café branding so every café's card shows its own identity: an optional
// tagline (the card's sub-line) and an accent colour. Backfill gives existing
// cafés a default charcoal accent, and splits the seeded "Oram Cafe &
// Restaurant" into name "Oram" + tagline "Cafe & Restaurant" to keep its look.

migrate((app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new TextField({ name: "tagline" }));
  card.fields.add(new TextField({ name: "accent" }));
  app.save(card);

  for (const c of app.findRecordsByFilter("cafe_card", "id != ''", "", 5000, 0, {})) {
    if (!c.getString("accent")) c.set("accent", "#171717");
    const nm = c.getString("cafe_name") || "";
    if (/oram/i.test(nm) && !c.getString("tagline")) {
      c.set("cafe_name", "Oram");
      c.set("tagline", "Cafe & Restaurant");
    }
    app.save(c);
  }
}, (app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  for (const n of ["tagline", "accent"]) {
    const f = card.fields.getByName(n);
    if (f) card.fields.removeById(f.id);
  }
  app.save(card);
});
