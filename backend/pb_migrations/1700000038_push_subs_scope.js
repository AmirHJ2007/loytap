/// <reference path="../pb_data/types.d.ts" />

// Who this device belongs to: a till, or the owner.
//
// WHY IT HAS TO EXIST. Until now every push_subs row was a till, so "notify
// this café" and "notify every device of this café" were the same sentence.
// Subscription reminders break that: they are about money, they name a
// deadline the owner is responsible for, and they have no business on a
// barista's lock screen. Without this field there is no way to address the
// owner's phone without addressing the whole counter.
//
// NO BACKFILL, ON PURPOSE. An unset select reads back as "", and every
// consumer is written to treat anything that is not exactly "owner" as a
// till:
//
//   the stamp fan-out   filters `scope != "owner"`  — "" is a till
//   the subscription    filters `scope = "owner"`   — "" is excluded
//
// So rows written before this migration keep behaving exactly as they did,
// and the dangerous direction (an old row accidentally counting as an owner)
// cannot happen. A migration that UPDATEd every row would reach the same
// state while giving a half-applied deploy the chance to be wrong.
//
// Same reasoning as the lang field in 1700000032 — see the note there.

migrate((app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.add(new SelectField({ name: "scope", maxSelect: 1, values: ["till", "owner"] }));
  // Paired with the cafe column rather than on its own: every query that
  // reads scope also names a café, and none of them ever wants "every owner
  // device on the server".
  c.indexes = c.indexes.concat(["CREATE INDEX `idx_push_subs_cafe_scope` ON `push_subs` (`cafe`, `scope`)"]);
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("push_subs");
  c.fields.removeByName("scope");
  c.indexes = c.indexes.filter((ix) => ix.indexOf("idx_push_subs_cafe_scope") === -1);
  app.save(c);
});
