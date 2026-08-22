/// <reference path="../pb_data/types.d.ts" />

// Rebrand the single café to Oram.
migrate((app) => {
  try {
    const c = app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
    if (c) { c.set("cafe_name", "Oram Cafe & Restaurant"); app.save(c); }
  } catch (e) {}
}, (app) => {});
