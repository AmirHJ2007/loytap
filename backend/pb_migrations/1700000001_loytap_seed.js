/// <reference path="../pb_data/types.d.ts" />

// Seed the single café's config + the weighted random-reward pool.
// Idempotent: only seeds when the collections are empty. Edit later in the Admin UI.

migrate((app) => {
  // ----- café card config (one row) -----
  if (app.countRecords("cafe_card") === 0) {
    const card = new Record(app.findCollectionByNameOrId("cafe_card"));
    card.set("cafe_name", "Aurora Coffee");
    card.set("stamps_required", 8);
    card.set("reward_expiry_days", 30);
    app.save(card);
  }

  // ----- reward pool (weighted: bigger weight = more common) -----
  if (app.countRecords("reward_options") === 0) {
    const rc = app.findCollectionByNameOrId("reward_options");
    const pool = [
      ["5% OFF", "the common one", 5],
      ["10% OFF", "nice!", 3],
      ["15% OFF", "lucky you", 2],
      ["Free coffee", "jackpot ✨", 1],
    ];
    for (const [deal, desc, weight] of pool) {
      const r = new Record(rc);
      r.set("deal", deal);
      r.set("description", desc);
      r.set("weight", weight);
      r.set("active", true);
      app.save(r);
    }
  }
}, (app) => {
  // down — clear the seeded config/pool
  try { for (const r of app.findAllRecords("cafe_card")) app.delete(r); } catch (e) {}
  try { for (const r of app.findAllRecords("reward_options")) app.delete(r); } catch (e) {}
});
