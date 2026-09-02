/// <reference path="../pb_data/types.d.ts" />

// Café staff sign in with a shared CODE (no phone/OTP). The code logs into a
// hidden staff service-account for the café, which grants a staff session.
//
// Security fix: this migration used to seed a staff code as a string literal
// in this file. The repo is public and that same string was printed
// as the sign-in placeholder, so it was a published credential for
// POST /staff/login. The seeding is now a random code (same alphabet the signup
// path uses) — the owner reads it from GET /owner/cafe. Neutering it here only
// protects fresh deploys; 1700000018 rotates the codes in databases that
// already ran this. The staff service-account password moved off
// Math.random() to $security.randomString() for the same reason — it is never
// used to log in directly (staff auth goes through the code), but it should
// still not be predictable from the seeding time.

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
    staff.setPassword($security.randomString(30));
    app.save(staff);
  }

  // set the code + link on the single café
  const rec = app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  if (rec) {
    const name = String(rec.getString("cafe_name") || "").toUpperCase().replace(/[^A-Z]/g, "");
    const prefix = name.length >= 3 ? name.slice(0, 3) : "CAF";
    rec.set("staff_code", prefix + "-" + $security.randomStringWithAlphabet(5, "ABCDEFGHJKMNPQRSTUVWXYZ23456789"));
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
