/// <reference path="../pb_data/types.d.ts" />

// One row holding the things the business changes without a deploy: the
// subscription price, and the wording of the subscription letters.
//
// WHY A COLLECTION AND NOT A CONSTANT. The price was a literal in five places
// — the ZarinPal charge, the owner's buy screen, the marketing page's plan
// card, that page's JSON-LD, and its FAQ sentence. Five literals are not a
// price, they are five chances to charge one number and advertise another.
// This row is the price; everything else reads it.
//
// SEEDED WITH TODAY'S NUMBERS. 3,000,000 and 30,000,000 Toman are what the
// code charges right now, so applying this migration changes nothing that a
// café can see. The row exists to be edited later, from /hq.
//
// HISTORICAL RECEIPTS ARE UNAFFECTED. payments.amount records what was
// actually charged at the time and every receipt and invoice renders from that
// record, so raising the price tomorrow does not rewrite what a café paid last
// month.
//
// mail_copy IS AN OVERRIDE MAP, NOT THE TEMPLATES. submail.js keeps the
// layout, the Jalali dates and the HTML escaping; this holds replacement
// strings keyed by template and slot (e.g. "renewal.subject"). Empty — the
// seeded state — means every letter reads exactly as it does today. The
// markup is deliberately not editable from a browser: a mistyped tag in a
// payment receipt is a silent failure a paying café sees before we do.
//
// SINGLETON BY CONVENTION. Nothing in PocketBase enforces one row, so readers
// take the oldest row rather than assuming an id, and /hq only ever updates
// that same one. A stray second row is then inert rather than a coin toss.

migrate((app) => {
  const c = new Collection({ type: "base", name: "platform_settings" });

  // Toman. onlyInt because Toman has no subunit, and min 1 because a plan
  // priced at zero would sail past ZarinPal's minimum as a 400 the owner
  // cannot act on.
  c.fields.add(new NumberField({ name: "price_monthly", onlyInt: true, min: 1, required: true }));
  c.fields.add(new NumberField({ name: "price_yearly", onlyInt: true, min: 1, required: true }));

  // Subscription-letter wording, keyed "<template>.<slot>". 20KB is far more
  // than a dozen sentences and still small enough to read on every send.
  c.fields.add(new JSONField({ name: "mail_copy", maxSize: 20000 }));

  c.fields.add(new AutodateField({ name: "created", onCreate: true }));
  c.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  // Superusers and hooks only, on every operation. The price is read by
  // server code that already has full access; no browser needs to fetch this
  // collection directly, and the /hq routes are themselves superuser-gated.
  c.listRule = null; c.viewRule = null;
  c.createRule = null; c.updateRule = null; c.deleteRule = null;
  app.save(c);

  const row = new Record(c);
  row.set("price_monthly", 3000000);
  row.set("price_yearly", 30000000);
  row.set("mail_copy", {});
  app.save(row);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("platform_settings")); } catch (e) {}
});
