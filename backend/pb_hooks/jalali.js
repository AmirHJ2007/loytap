/// <reference path="../pb_data/types.d.ts" />

// Gregorian -> Jalali, for the server side.
//
// NB: require()d module, not a .pb.js hook. See sms.js.
//
// The browser gets this conversion from Intl (formatDateLocal in i18n.js), but
// goja ships neither Intl nor the Persian calendar data and cannot load a date
// library, so the arithmetic is written out. One copy, required by everything
// that prints a date a Persian reader will see: the nightly summary
// (dailyreport.js) and the subscription letters (subscriptions.pb.js,
// zarinpal.pb.js).
//
// Numerals stay Western, in Persian as in English — see CLAUDE.md.

// Tehran is a fixed +3:30. Iran abolished DST in 2022, so there is no seasonal
// case; the server clock is UTC (alpine, no tzdata, no TZ — see Dockerfile).
const IRAN_OFF = 3.5 * 3600000;

const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
                  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

// Indexed by getUTCDay() of the +3:30-shifted date, so 0 is Sunday.
const FA_DOW = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

// The standard 33-year-cycle conversion. Takes a Gregorian y/m/d where m is
// 1-12, returns [jy, jm, jd] likewise.
function toJalali(gy, gm, gd) {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + (365 * gy) + ~~((gy2 + 3) / 4) - ~~((gy2 + 99) / 100)
             + ~~((gy2 + 399) / 400) + gd + gDaysInMonth[gm - 1];
  let jy = -1595 + (33 * ~~(days / 12053));
  days %= 12053;
  jy += 4 * ~~(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += ~~((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + ~~(days / 31) : 7 + ~~((days - 186) / 30);
  const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
  return [jy, jm, jd];
}

// The Jalali parts of an instant as it falls in Tehran.
function partsAt(msVal) {
  const d = new Date(msVal + IRAN_OFF);
  return { j: toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), dow: d.getUTCDay() };
}

// "26 مهر 1405" — day, month name, year. The same shape faDateLong() renders
// in the panel, so a date an owner reads in an email matches the one the
// dashboard shows them for the same subscription.
function faDate(msVal) {
  const p = partsAt(msVal);
  return p.j[2] + " " + J_MONTHS[p.j[1] - 1] + " " + p.j[0];
}

// "یکشنبه، 26 مهر 1405" — the nightly summary names the weekday too, because
// it is read the morning after and "yesterday" needs saying which day it was.
function faDateWithDow(msVal) {
  const p = partsAt(msVal);
  return FA_DOW[p.dow] + "، " + p.j[2] + " " + J_MONTHS[p.j[1] - 1] + " " + p.j[0];
}

module.exports = {
  IRAN_OFF: IRAN_OFF,
  J_MONTHS: J_MONTHS,
  FA_DOW: FA_DOW,
  toJalali: toJalali,
  faDate: faDate,
  faDateWithDow: faDateWithDow,
};
