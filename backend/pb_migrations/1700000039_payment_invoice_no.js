/// <reference path="../pb_data/types.d.ts" />

// A sequential invoice number on every payment that actually took money.
//
// WHY NOW, BEFORE THE FIRST REAL PAYMENT. An Iranian فاکتور is expected to
// carry a sequential number, and a sequence cannot be added retroactively
// without either renumbering invoices a café has already filed or starting
// mid-air with a gap. Today the merchant id is unset in production and every
// payment on record is a sandbox test, so the sequence can start at 1 and be
// honest. A month after going live this migration would be a problem instead
// of a field.
//
// NOT the payment id. That is a random 15-character string — fine as a
// database key, useless as something an accountant reads down a column.
//
// Assigned inside the same transaction that marks a payment paid
// (zarinpal.pb.js), so a number is only ever spent on money that moved, and
// two callbacks racing cannot both claim it. PocketBase serialises writes
// through a single connection, so "read the highest, add one" is safe there
// in a way it would not be against a concurrent database.
//
// Zero / unset means "no invoice": the attempt failed, was cancelled, or is
// still pending. The unique index below is partial for exactly that reason —
// without the WHERE, every unpaid row would collide on 0.

migrate((app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.fields.add(new NumberField({ name: "invoice_no", onlyInt: true, min: 0 }));
  c.indexes = c.indexes.concat([
    "CREATE UNIQUE INDEX `idx_payments_invoice_no` ON `payments` (`invoice_no`) WHERE `invoice_no` > 0",
  ]);
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.indexes = c.indexes.filter((ix) => ix.indexOf("idx_payments_invoice_no") === -1);
  c.fields.removeByName("invoice_no");
  app.save(c);
});
