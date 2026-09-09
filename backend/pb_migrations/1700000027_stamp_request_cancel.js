/// <reference path="../pb_data/types.d.ts" />

// Adds "cancelled" as a fourth stamp_requests outcome, alongside the
// existing pending/approved/denied/expired (1700000016_stamp_requests.js).
// Lets a customer back out of their own pending request — see the new
// POST /card/stamp/cancel route in card.pb.js — distinct from "denied"
// (staff said no) and "expired" (nobody responded in time), so staff's
// queue and any future reporting can tell the three apart.

migrate((app) => {
  const reqs = app.findCollectionByNameOrId("stamp_requests");
  const status = reqs.fields.getByName("status");
  status.values = ["pending", "approved", "denied", "expired", "cancelled"];
  app.save(reqs);
}, (app) => {
  const reqs = app.findCollectionByNameOrId("stamp_requests");
  const status = reqs.fields.getByName("status");
  status.values = ["pending", "approved", "denied", "expired"];
  app.save(reqs);
});
