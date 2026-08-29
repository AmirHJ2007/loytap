/// <reference path="../pb_data/types.d.ts" />

// Optional "minimum purchase for a stamp" per café. It's purely informational —
// we can't see the café's till, so we only DISPLAY it on the loyalty card; the
// staff are responsible for honouring it. 0 / empty = no minimum (show nothing).

migrate((app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new NumberField({ name: "min_purchase", onlyInt: true, min: 0 }));
  app.save(card);
}, (app) => {
  const card = app.findCollectionByNameOrId("cafe_card");
  const f = card.fields.getByName("min_purchase");
  if (f) card.fields.removeById(f.id);
  app.save(card);
});
