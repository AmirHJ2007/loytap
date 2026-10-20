/// <reference path="../pb_data/types.d.ts" />

// Which subscription email was last sent, so the daily sweep does not send the
// same one twice.
//
// It stores a TAG, not a date: "r3|2026-12-17" is the three-days-left reminder
// for the period ending on the 17th. Carrying the period end inside the tag is
// what makes a renewal reset the sequence for free — the new period produces
// tags nothing has seen, so its own reminders go out without anybody having to
// remember to clear a flag.
//
// A cron that runs twice, or a server that restarts mid-sweep, is the ordinary
// case rather than the exception, so the guard has to live in the database
// rather than in a variable.
migrate((app) => {
  const c = app.findCollectionByNameOrId("subscriptions");
  c.fields.add(new TextField({ name: "last_mail", max: 60 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("subscriptions");
  c.fields.removeByName("last_mail");
  app.save(c);
});
