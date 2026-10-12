/// <reference path="../pb_data/types.d.ts" />

// Which language this till wants its notifications in.
//
// The text is built on the server (it travels inside the encrypted payload),
// but language is a per-device choice made in the browser — and a service
// worker cannot read the localStorage where the staff panel keeps it. So the
// device states its preference once, at subscribe time, and it is stored
// alongside the keys.
//
// Defaults to "fa": the app is Persian-first, and a row written before this
// field existed should keep behaving the way it already did.

migrate((app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.add(new SelectField({ name: "lang", maxSelect: 1, values: ["fa", "en"] }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.removeByName("lang");
  app.save(c);
});
