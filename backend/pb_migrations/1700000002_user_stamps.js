/// <reference path="../pb_data/types.d.ts" />

// Store the current card's stamp visuals on the user so the exact stars
// (position offset, rotation, ink strength, colour) come back on sign-in.
// Shape: [{ dx, dy, r, sa, color }, ...] — length = current stamp_count.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new JSONField({ name: "stamps", maxSize: 2000000 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const f = users.fields.getByName("stamps");
  if (f) users.fields.removeById(f.id);
  app.save(users);
});
