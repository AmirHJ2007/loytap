/// <reference path="../pb_data/types.d.ts" />

// A customer's birthday, so a café can greet them (and, later, send a birthday
// reward). Optional: most people will never fill it in, and nothing in the app
// may depend on it being there.
//
// Stored as a DateField like every other date here, for the same reason: these
// are compared and sorted server-side ("whose birthday is this week?"), and a
// Jalali string would sort and compare wrong. The Persian UI converts for
// display only — see formatDateLocal in i18n.js.
//
// The time component is meaningless; the hook writes Tehran midnight so the
// day never drifts across a timezone when it is read back.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new DateField({ name: "birthday" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("birthday");
  app.save(users);
});
