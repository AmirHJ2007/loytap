/// <reference path="../pb_data/types.d.ts" />

// The id of the send a message came from.
//
// One broadcast writes one row per recipient, all carrying the same
// `send_id`. It exists for exactly one reason: a send can be reported as
// failed to the owner after it has already committed — the connection drops
// between the server's COMMIT and the response arriving — and the honest
// thing for an owner to do then is press Send again. Without a key to
// recognise that retry by, pressing it again writes the whole broadcast a
// second time and several hundred people get the message twice.
//
// So /owner/send looks for this value before it writes anything, inside the
// same transaction as the writes, and does nothing if it finds it. The
// lookup has to be inside the transaction: SQLite serialises writers, so a
// second attempt that gets that far waits for the first to commit and then
// sees its rows. Outside the transaction it would be a narrower window
// rather than a closed one.
//
// Not unique-indexed — the whole point is that it repeats once per
// recipient. Plain index, because it is only ever read as a lookup.
//
// Nullable, and the endpoint still works without it: rows written before
// this field existed simply carry "".

migrate((app) => {
  const msgs = app.findCollectionByNameOrId("messages");
  msgs.fields.add(new TextField({ name: "send_id", max: 40 }));
  msgs.indexes = msgs.indexes.concat(["CREATE INDEX `idx_messages_send` ON `messages` (`cafe`,`send_id`)"]);
  app.save(msgs);
}, (app) => {
  const msgs = app.findCollectionByNameOrId("messages");
  msgs.indexes = msgs.indexes.filter((x) => !x.includes("idx_messages_send"));
  msgs.fields.removeByName("send_id");
  app.save(msgs);
});
