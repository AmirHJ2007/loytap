/// <reference path="../pb_data/types.d.ts" />

// The platform settings row, for everyone who needs to read it.
//
// A plain .js rather than a .pb.js because PocketBase gives each handler its
// own goja runtime with no view of its own file's top-level scope — shared
// code has to arrive through require() *inside* the handler. Same arrangement
// as webpush.js and jalali.js.
//
// EVERY READ FALLS BACK. The numbers below are the prices this code shipped
// with, and they are returned whenever the row cannot be read — the migration
// has not run yet, the collection was renamed, the query threw. The reason is
// narrow and worth stating: the main caller is the ZarinPal charge path, and
// an owner trying to pay should be charged the right price rather than meet a
// 500 because a settings lookup failed. A stale price is a bad day; a payment
// page that cannot open is a lost customer.
//
// Consequence worth knowing: if you change the price in /hq and the row later
// becomes unreadable, billing silently returns to these constants. So they
// are kept in step with the seeded row, and nothing else in the codebase is
// allowed to hold a price literal.

const FALLBACK = { monthly: 3000000, yearly: 30000000 };   // Toman

// The oldest row wins. Nothing enforces a single row, so "oldest" makes the
// choice deterministic — a second row created by accident is ignored instead
// of being read half the time.
function row() {
  try {
    const rows = $app.findRecordsByFilter("platform_settings", "1=1", "created", 1, 0);
    return rows && rows.length ? rows[0] : null;
  } catch (err) {
    return null;
  }
}

// { monthly, yearly } in Toman. Never throws, never returns 0 — a plan whose
// price failed to load is priced at the constant above, not at nothing.
function prices() {
  const r = row();
  if (!r) return { monthly: FALLBACK.monthly, yearly: FALLBACK.yearly };
  const m = r.getInt("price_monthly");
  const y = r.getInt("price_yearly");
  return {
    monthly: m > 0 ? m : FALLBACK.monthly,
    yearly: y > 0 ? y : FALLBACK.yearly,
  };
}

// The letter-wording overrides, as a plain object. An unreadable or malformed
// value yields {} — which means "use what submail.js already says", the same
// as the seeded state.
function mailCopy() {
  const r = row();
  if (!r) return {};
  const v = r.get("mail_copy");
  if (v === null || v === undefined) return {};

  // A JSONField does NOT arrive as a JavaScript object. PocketBase hands back
  // types.JSONRaw — a byte slice — which goja wraps as an array-like. So
  // JSON.stringify on it yields "[123,34,...]", the bytes as numbers, and
  // parsing that gives an array rather than the saved map. That failure is
  // silent and total: it returns an empty override set, every letter reads as
  // though nothing was ever edited, and the row in the database looks correct
  // the whole time.
  //
  // toString() is the PocketBase global that turns a raw value into its real
  // string form, and is the only reliable way across both shapes — a string
  // column and a JSON one.
  let text = "";
  try {
    text = (typeof v === "string") ? v : toString(v);
  } catch (err) {
    return {};
  }
  if (!text || !text.trim()) return {};

  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { return {}; }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

// Pick one slot out of an override map, falling back to the wording in code.
// Blank and whitespace-only overrides count as absent: clearing a field in
// /hq restores the default rather than sending an empty subject line.
function pick(copy, key, fallback) {
  const v = copy && copy[key];
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t ? t : fallback;
}

module.exports = { row, prices, mailCopy, pick, FALLBACK };
