// Verification for the date helpers in i18n.js. Run with:  node test/dates.test.js
//
// Those helpers turn an instant into the date a reader sees: Jalali on the
// Persian UI, Gregorian on the English one, both resolved in Tehran time.
// The anchors below are the cases that actually break calendar code — Nowruz
// (the Jalali new year, which lands mid-March), the day before it, a Gregorian
// leap day, and the 20:30 UTC instant where Tehran rolls into the next day.
//
// i18n.js is a classic browser script with no exports, so it is eval'd here
// with the two browser globals it touches stubbed out.
const fs = require("fs");
const path = require("path");

let LANG = "fa";
global.localStorage = { getItem: (k) => (k === "loytap_lang" ? LANG : null), setItem() {} };
global.document = { documentElement: {}, querySelectorAll: () => [], addEventListener() {} };
eval(fs.readFileSync(path.join(__dirname, "..", "i18n.js"), "utf8"));

let pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}
const fa = (fn) => { LANG = "fa"; return fn(); };
const en = (fn) => { LANG = "en"; return fn(); };

// --- Jalali conversion, against known Gregorian->Jalali anchors -------------
// "25 مهر 1405" is year, then month name, then day. The order is intentional:
// in a right-to-left line the first token is the rightmost, so it reads
// year -> month -> day to a Persian reader.
for (const [iso, want] of [
  ["2026-10-17T10:00:00Z", "25 مهر 1405"],
  ["2026-03-21T06:00:00Z", "1 فروردین 1405"],   // Nowruz 1405
  ["2025-03-21T06:00:00Z", "1 فروردین 1404"],   // Nowruz 1404
  ["2026-03-20T06:00:00Z", "29 اسفند 1404"],    // the day before Nowruz
  ["2025-01-01T10:00:00Z", "12 دی 1403"],
  ["2024-02-29T10:00:00Z", "10 اسفند 1402"],    // Gregorian leap day
]) check(`fa formatDateLocal(${iso})`, fa(() => formatDateLocal(iso)), want);

// every month name is reachable and in the right slot
for (const [iso, want] of [
  ["2026-03-25T10:00:00Z", "فروردین"],  ["2026-04-21T10:00:00Z", "اردیبهشت"],
  ["2026-05-22T10:00:00Z", "خرداد"],    ["2026-06-22T10:00:00Z", "تیر"],
  ["2026-07-23T10:00:00Z", "مرداد"],    ["2026-08-23T10:00:00Z", "شهریور"],
  ["2026-09-23T10:00:00Z", "مهر"],      ["2026-10-23T10:00:00Z", "آبان"],
  ["2026-11-22T10:00:00Z", "آذر"],      ["2026-12-22T10:00:00Z", "دی"],
  ["2027-01-21T10:00:00Z", "بهمن"],     ["2027-02-20T10:00:00Z", "اسفند"],
]) check(`fa month name ${iso}`, fa(() => formatDateLocal(iso)).split(" ")[1], want);

// --- Tehran time, not the device's -----------------------------------------
// +03:30 means 20:30 UTC is already midnight in Tehran. A date resolved in the
// device's zone would show the wrong day for anyone whose phone is set abroad.
check("fa 20:29Z is still the 25th", fa(() => formatDateLocal("2026-10-17T20:29:00Z")), "25 مهر 1405");
check("fa 20:30Z has rolled to the 26th", fa(() => formatDateLocal("2026-10-17T20:30:00Z")), "26 مهر 1405");
check("en 20:29Z is still the 17th", en(() => formatDateLocal("2026-10-17T20:29:00Z")), "17.10.26");
check("en 20:30Z has rolled to the 18th", en(() => formatDateLocal("2026-10-17T20:30:00Z")), "18.10.26");

// --- the English UI keeps the exact DD.MM.YY form it always had -------------
check("en formatDateLocal", en(() => formatDateLocal("2026-10-17T10:00:00Z")), "17.10.26");
check("en pads single digits", en(() => formatDateLocal("2026-01-05T10:00:00Z")), "05.01.26");

// --- chart labels, fed the backend's Iran-local "YYYY-MM-DD" ----------------
check("fa day+month", fa(() => formatDayMonthLocal("2026-10-17")), "25 مهر");
check("fa day+month at Nowruz", fa(() => formatDayMonthLocal("2026-03-21")), "1 فروردین");
check("en day+month", en(() => formatDayMonthLocal("2026-10-17")), "17 Oct");
check("fa day number", fa(() => formatDayNumLocal("2026-10-17")), "25");
check("fa day number pads", fa(() => formatDayNumLocal("2026-03-21")), "01");
check("en day number", en(() => formatDayNumLocal("2026-10-17")), "17");

// --- unusable input yields "", so callers can fall back to a placeholder ----
for (const bad of ["", "not a date", null, undefined, NaN, 0, false, {}, [], "   "]) {
  check(`fa rejects ${JSON.stringify(bad)}`, fa(() => formatDateLocal(bad)), "");
  check(`en rejects ${JSON.stringify(bad)}`, en(() => formatDateLocal(bad)), "");
  check(`day+month rejects ${JSON.stringify(bad)}`, fa(() => formatDayMonthLocal(bad)), "");
  check(`day number rejects ${JSON.stringify(bad)}`, fa(() => formatDayNumLocal(bad)), "");
}

// --- PocketBase's own wire format ------------------------------------------
// Records come back as "2026-11-07 23:28:43.725Z": a space where ISO 8601 wants
// a "T", which strict engines refuse. Both spellings must agree.
check("fa accepts a space separator", fa(() => formatDateLocal("2026-11-07 23:28:43.725Z")), "17 آبان 1405");
check("fa space matches the T form",
      fa(() => formatDateLocal("2026-11-07 23:28:43.725Z")),
      fa(() => formatDateLocal("2026-11-07T23:28:43.725Z")));
check("en accepts a space separator", en(() => formatDateLocal("2026-11-07 23:28:43.725Z")), "08.11.26");

// --- a date is one bidi-safe sequence --------------------------------------
// The project has been bitten by right-to-left reordering before (a "13-16"
// slot range flipping to "16-13"). A date is safe because each number is its
// own run with a word between them, but that only holds while the month sits
// in the middle and the digits stay Western — so assert both.
const s = fa(() => formatDateLocal("2026-10-17T10:00:00Z"));
check("month name separates the two numbers", /^\d+ \D+ \d+$/.test(s), true);
check("numerals stay Western", /[۰-۹٠-٩]/.test(s), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
