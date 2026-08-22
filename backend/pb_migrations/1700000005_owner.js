/// <reference path="../pb_data/types.d.ts" />

// Café owner (admin) account — phone + password login, no self-registration.
// Demo credentials: phone 09121234567 / password "oram1234".

migrate((app) => {
  let owner = null;
  try { owner = app.findFirstRecordByFilter("users", "phone = '9121234567'"); } catch (e) { owner = null; }
  if (!owner) {
    owner = new Record(app.findCollectionByNameOrId("users"));
    owner.set("phone", "9121234567");
    owner.set("email", "owner@oram.loytap");
    owner.set("name", "Oram Owner");
    owner.set("role", "admin");
    owner.set("stamp_count", 0);
    owner.set("cycles", 0);
    owner.set("verified", true);
    owner.setPassword("oram1234");
    app.save(owner);
  }
}, (app) => {
  try { const o = app.findFirstRecordByFilter("users", "phone = '9121234567'"); if (o) app.delete(o); } catch (e) {}
});
