/// <reference path="../pb_data/types.d.ts" />

// Café staff sign in with a shared CODE (no phone/OTP). The code logs into a
// hidden staff service-account for the café, which grants a staff session.

migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  // cafe_card gets: staff_code (the shared code) + staff_user (who the code logs into)
  const card = app.findCollectionByNameOrId("cafe_card");
  card.fields.add(new TextField({ name: "staff_code" }));
  card.fields.add(new RelationField({ name: "staff_user", maxSelect: 1, collectionId: usersId, cascadeDelete: false }));
  app.save(card);

  // create the café's staff service-account (if missing)
  let staff = null;
  try { staff = app.findFirstRecordByFilter("users", "phone = 'staff-oram'"); } catch (e) { staff = null; }
  if (!staff) {
    staff = new Record(app.findCollectionByNameOrId("users"));
    staff.set("phone", "staff-oram");
    staff.set("email", "staff@oram.loytap");
    staff.set("name", "Oram Staff");
    staff.set("role", "staff");
    staff.set("stamp_count", 0);
    staff.set("cycles", 0);
    staff.set("verified", true);
    staff.setPassword("oram-staff-" + Math.random().toString(36).slice(2) + Date.now());
    app.save(staff);
  }

  // set the code + link on the single café
  const rec = app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  if (rec) {
    rec.set("staff_code", "ORAM-4821");
    rec.set("staff_user", staff.id);
    app.save(rec);
  }
}, (app) => {
  try {
    const card = app.findCollectionByNameOrId("cafe_card");
    for (const f of ["staff_code", "staff_user"]) {
      const fld = card.fields.getByName(f);
      if (fld) card.fields.removeById(fld.id);
    }
    app.save(card);
  } catch (e) {}
  try {
    const staff = app.findFirstRecordByFilter("users", "phone = 'staff-oram'");
    if (staff) app.delete(staff);
  } catch (e) {}
});
