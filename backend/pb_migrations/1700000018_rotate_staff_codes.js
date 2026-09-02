/// <reference path="../pb_data/types.d.ts" />

// Security fix: every staff code issued so far is weak or public.
//   - 1700000004 hardcoded a literal staff code for the Oram café — that
//     string is in the public repo and was printed as the login placeholder on
//     the sign-in page, i.e. a published credential for POST /staff/login.
//   - codes minted by /owner/register were SLUG-NNNN: 4 digits, a 10,000-guess
//     space, brute-forceable in seconds.
//
// So rotate ALL of them (explicitly approved): every café's staff must get the
// new code from their owner (GET /owner/cafe shows it). Same format the signup
// path now issues — 3 letters of the café name + "-" + 5 chars of a
// confusable-free alphabet.

migrate((app) => {
  // duplicated from the makeStaffCode() helper in backend/pb_hooks/owner.pb.js
  // — hooks and migrations are separate JSVM contexts with no shared module in
  // this setup, so keep the two copies in sync.
  const AB = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const used = {};

  const prefixFor = (name) => {
    // fa/ar café names contain no A-Z at all, so a name that yields fewer than
    // 3 usable letters falls back to CAF rather than a 0/1/2-letter prefix
    const letters = String(name || "").toUpperCase().replace(/[^A-Z]/g, "");
    return letters.length >= 3 ? letters.slice(0, 3) : "CAF";
  };

  const mint = (name) => {
    const prefix = prefixFor(name);
    for (let i = 0; i < 8; i++) {
      const cand = prefix + "-" + $security.randomStringWithAlphabet(5, AB);
      if (!used[cand]) return cand;
    }
    // every attempt clashed — widen the random part, never weaken it
    return prefix + "-" + $security.randomStringWithAlphabet(12, AB);
  };

  let rows = [];
  try { rows = app.findRecordsByFilter("staff_codes", "id != ''", "", 5000, 0, {}); } catch (e) { rows = []; }

  // seed the used-set with the codes still in the table, so a new code can
  // never collide with a row we haven't rotated yet (the collection has a
  // UNIQUE index on `code` — a clash would abort the whole migration)
  for (const r of rows) used[r.getString("code")] = true;

  for (const r of rows) {
    try {
      let cafeName = "";
      try {
        const card = app.findRecordById("cafe_card", r.getString("cafe"));
        if (card) cafeName = card.getString("cafe_name");
      } catch (e) { cafeName = ""; }

      const code = mint(cafeName);
      used[code] = true;
      r.set("code", code);
      app.save(r);
    } catch (e) {}
  }
}, (app) => {
  // no-op on purpose: the old codes were destroyed deliberately (public /
  // brute-forceable) and are not recoverable — nor would we want them back.
});
