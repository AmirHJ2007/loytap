/// <reference path="../pb_data/types.d.ts" />

// Reloy — the customer's own profile fields.
//
//   POST /me/birthday  (customer auth)  { birthday: "YYYY-MM-DD" | "" }
//     -> { birthday: "<iso>" | "" }
//
// Why a hook at all: lock_user_writes nulled users.updateRule, so a customer
// cannot PATCH their own record (that is what once let them set their own
// stamp_count and role). Hooks run through the app DAO, which bypasses
// collection rules, so this route is the only way a customer edits anything
// about themselves — and it writes exactly one field.
//
// The date arrives as a plain Gregorian "YYYY-MM-DD". The client does the
// Jalali conversion, because Goja has neither Intl nor the Persian calendar;
// the server's job is to distrust what arrives and store a real date.
//
// NOTE: self-contained on purpose — PocketBase's JS hook runtime does not give
// a routerAdd callback access to sibling top-level declarations.
routerAdd("POST", "/me/birthday", (e) => {
  const u = e.auth;
  if (!u) return e.json(401, { error: "Not signed in", code: "NOT_SIGNED_IN" });
  // staff and owner records live in the same collection; this is a customer field
  if (u.getString("role") === "admin") {
    return e.json(403, { error: "Not a customer account", code: "NOT_CUSTOMER" });
  }

  const raw = String((e.requestInfo().body || {}).birthday || "").trim();

  // empty clears it — removing a birthday has to be as easy as setting one
  if (raw === "") {
    u.set("birthday", "");
    $app.save(u);
    return e.json(200, { birthday: "" });
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return e.json(400, { error: "Bad date", code: "BIRTHDAY_INVALID" });
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);

  // Reject a date that does not exist rather than let Date roll it over:
  // "2026-02-31" would otherwise be stored quietly as the 3rd of March.
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return e.json(400, { error: "Bad date", code: "BIRTHDAY_INVALID" });
  }
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return e.json(400, { error: "Bad date", code: "BIRTHDAY_INVALID" });
  }

  // Sane range. Not in the future (a birthday that has not happened is a typo),
  // and not absurdly old — 120 years covers anyone alive.
  const now = Date.now();
  const t = probe.getTime();
  if (t > now) return e.json(400, { error: "Birthday is in the future", code: "BIRTHDAY_FUTURE" });
  if (now - t > 120 * 365.25 * 86400000) {
    return e.json(400, { error: "Bad date", code: "BIRTHDAY_INVALID" });
  }

  // Tehran midnight (UTC+03:30), so reading the day back never lands on the
  // one before. Same offset the stats hook uses; Iran dropped DST in 2022.
  const iso = new Date(t - 3.5 * 3600000).toISOString().replace("T", " ");
  u.set("birthday", iso);
  $app.save(u);
  return e.json(200, { birthday: iso });
});
