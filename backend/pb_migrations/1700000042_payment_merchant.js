/// <reference path="../pb_data/types.d.ts" />

// Which ZarinPal merchant a payment was started against.
//
// THE OTHER HALF OF 1700000041. That migration taught a payment to remember
// its GATEWAY, so an environment change between starting a payment and it
// coming back could no longer send the verify to the wrong host. It left
// ZARINPAL_MERCHANT_ID doing exactly what the gateway used to do: read fresh
// from the environment at both ends, with nothing tying the two reads
// together.
//
// A rotated credential between those two moments therefore produced the same
// failure the gateway fix had just closed — verify against the wrong merchant,
// a café charged with nothing to show for it — only now harder to spot,
// because the path looked handled. A payment has to carry everything it needs
// to verify itself, or none of it.
//
// HIDDEN, and that is the point of using this field type. `payments` is
// readable by the café's own owner, and a merchant id is not theirs to have:
// it is the account identifier every payment request to ZarinPal is signed
// with, and the raw material for a convincing fake checkout page. `hidden`
// keeps it out of API responses entirely while leaving it readable to hooks,
// which is the only place it is ever needed.
//
// NOT required, like `gateway`: rows written before this migration have no
// merchant recorded and the callback falls back to the environment for them,
// which is the behaviour they were created under.
migrate((app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.fields.add(new TextField({ name: "merchant", max: 100, hidden: true }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("payments");
  c.fields.removeByName("merchant");
  app.save(c);
});
