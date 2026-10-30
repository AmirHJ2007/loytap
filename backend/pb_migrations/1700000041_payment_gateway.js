/// <reference path="../pb_data/types.d.ts" />

// Which ZarinPal gateway a payment was started against.
//
// WHY A ROW NEEDS TO REMEMBER THIS. ZarinPal has two gateways — the real one
// and a sandbox that takes fake cards — and which one we talk to is decided by
// the ZARINPAL_SANDBOX environment variable. That variable was read twice per
// payment: once in /subscription/pay when the attempt is created, and again in
// /zarinpal/callback minutes later when it comes back. Nothing tied the two
// reads together.
//
// So a restart, a redeploy, or an env edit in between meant asking the REAL
// gateway to take 3,000,000 Toman and then asking the SANDBOX whether it had
// happened. The sandbox has never heard of that authority, verification fails,
// and a café that genuinely paid gets nothing — recoverable from our row plus
// ZarinPal's records, which is exactly why the row is written first, but only
// after a human notices.
//
// Stamped at request time and read back at callback time, the environment can
// change under a payment without stranding it. The value is also the honest
// answer to "was this real money", which `amount` on its own cannot give.
//
// NOT required, and that is deliberate: rows written before this migration
// have no gateway recorded, and the callback falls back to the environment
// variable for them — the behaviour they were created under.
migrate((app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.fields.add(new SelectField({ name: "gateway", maxSelect: 1, values: ["live", "sandbox"] }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.fields.removeByName("gateway");
  app.save(c);
});
