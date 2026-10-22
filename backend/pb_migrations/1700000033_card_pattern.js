/// <reference path="../pb_data/types.d.ts" />

// An optional background pattern on a café's loyalty card, stored next to
// `accent` on cafe_card. One JSON field rather than four columns because the
// shape depends on the layout — a tiled pattern carries a `fade`, a single
// motif carries a `place`, and a whole-card drawing carries neither:
//
//   { "pattern": "girih",    "layout": "tile",  "fade": "corner", "strength": 12 }
//   { "pattern": "espresso", "layout": "motif", "place": "bottom", "strength": 12 }
//   { "pattern": "flow",     "layout": "art",                      "strength": 14 }
//
// NO BACKFILL, deliberately. Existing records are left null, which is what the
// card renderer already treats as "no pattern" — so every café that has not
// chosen one keeps exactly the card it has today.

migrate((app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new JSONField({ name: "pattern" }));
  app.save(card);
}, (app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  const f = card.fields.getByName("pattern");
  if (f) card.fields.removeById(f.id);
  app.save(card);
});
