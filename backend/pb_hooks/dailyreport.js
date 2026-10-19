/// <reference path="../pb_data/types.d.ts" />

// The café owner's nightly activity report — one email per café, listing every
// stamp given during the Iranian day that just ended.
//
// Required from daily.pb.js rather than living in it: PocketBase runs each
// handler in its own goja runtime with no access to the enclosing file's scope,
// so anything shared between a cron and a route has to arrive through
// require(). Same arrangement as webpush.js / push.pb.js.
//
// WHICH DAY IT REPORTS. Never "the day the cron happens to fire on" — always
// the Iran-local day BEFORE the Iran-local day containing the run time, derived
// from Date.now(). The cron is set for 00:00 Tehran, so in normal operation
// that is the day that ended thirty seconds ago. It also means a late, early or
// retried run still reports the correct day instead of a shifted one; the worst
// case is an email arriving at an odd hour with the right contents, rather than
// the wrong day's numbers at the right hour.
//
// The server clock is UTC (alpine with no tzdata, no TZ set — see Dockerfile),
// so Tehran is a fixed +3:30 with no DST. Iran abolished DST in 2022; before
// that this offset would have been wrong for half the year.

const IRAN_OFF = 3.5 * 3600000;

// Rows are one stamp each, so a café's busiest day is bounded by this. 5000
// stamps in a day is far beyond anything the product sees; the cap exists so a
// runaway cannot build a 50MB email, not as a real limit.
const MAX_ROWS = 5000;

const J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
                  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

// Indexed by getUTCDay() of the +3:30-shifted date, so 0 is Sunday.
const FA_DOW = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

// Gregorian -> Jalali (the standard 33-year-cycle conversion). PocketBase's JS
// runtime ships no date library and cannot load one, so this is written out.
// Takes a Gregorian y/m/d where m is 1-12, returns [jy, jm, jd] likewise.
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

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// Café and customer names are owner- and customer-supplied and land inside
// HTML, so they are escaped. A customer called <b> must not be able to style
// their café owner's email, let alone smuggle a link into it.
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A PocketBase datetime string ("YYYY-MM-DD HH:MM:SS.sssZ") -> epoch ms.
function ms(s) {
  const t = new Date(String(s).replace(" ", "T")).getTime();
  return isNaN(t) ? 0 : t;
}

// ... and back, for use in a filter.
function pbTime(msVal) {
  return new Date(msVal).toISOString().replace("T", " ");
}

// The Iran-local day before the Iran-local day containing nowMs.
// start/end are real UTC epoch ms; label is "یکشنبه، 26 مهر 1405".
function reportDay(nowMs) {
  const shifted = new Date(nowMs + IRAN_OFF);
  const midnightToday = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const start = midnightToday - 86400000 - IRAN_OFF;  // back to real UTC
  const end = midnightToday - IRAN_OFF;
  const d = new Date(start + IRAN_OFF);               // the reported day, shifted
  const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return {
    start: start,
    end: end,
    label: FA_DOW[d.getUTCDay()] + "، " + j[2] + " " + J_MONTHS[j[1] - 1] + " " + j[0],
  };
}

// Tehran wall-clock HH:MM for an instant.
function hhmm(msVal) {
  const d = new Date(msVal + IRAN_OFF);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}

// ---------------------------------------------------------------------------
// the email itself
// ---------------------------------------------------------------------------
// Table-based layout with inline styles and no webfonts, because that is what
// Gmail and Outlook actually render. Vazirmatn is named first so recipients who
// happen to have it installed get the panel's typeface; everyone else falls to
// Tahoma, which every Windows and macOS machine has and which draws Persian
// correctly.
//
// Times carry dir="ltr" individually: inside an RTL cell the bidi algorithm
// will otherwise render 09:15 as 15:09. Verified by measuring rendered
// positions, not by reading the markup.
function render(opts) {
  const cafeName = esc(opts.cafeName);
  const rows = opts.rows;

  const cell = "font-size:14px;padding:9px 0;";
  const line = "border-bottom:1px solid #f5f5f5;";
  const th = "font-size:11px;font-weight:700;color:#9a9a9a;padding:0 0 10px 0;border-bottom:1px solid #ededed;";

  let body;
  if (!rows.length) {
    body =
      '<tr><td dir="rtl" align="right" style="padding:22px 28px 30px 28px;">' +
        '<div style="font-size:14px;color:#565656;line-height:2;background:#f7f7f7;border-radius:12px;padding:18px 20px;">' +
          'در این روز مهری ثبت نشد.' +
        '</div>' +
      '</td></tr>';
  } else {
    let trs = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const b = i === rows.length - 1 ? "" : line;   // no rule under the last row
      trs +=
        '<tr>' +
          '<td align="right" style="' + cell + 'color:#171717;' + b + '">' + esc(r.name) + '</td>' +
          '<td align="center" dir="ltr" style="' + cell + 'color:#565656;' + b + '">' + r.time + '</td>' +
          '<td align="center" style="' + cell + (r.first ? 'color:#171717;' : 'color:#cfcfcf;') + b + '">' +
            (r.first ? '✓' : '—') +
          '</td>' +
        '</tr>';
    }

    body =
      // summary strip
      '<tr><td style="padding:18px 28px 0 28px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background:#f7f7f7;border-radius:12px;">' +
        '<tr>' +
          '<td align="center" style="padding:14px 10px;width:50%;">' +
            '<div style="font-size:24px;font-weight:700;color:#171717;line-height:1.3;">' + opts.totalStamps + '</div>' +
            '<div style="font-size:12px;color:#9a9a9a;line-height:1.8;">مهر ثبت‌شده</div>' +
          '</td>' +
          '<td align="center" style="padding:14px 10px;width:50%;border-right:1px solid #e4e4e4;">' +
            '<div style="font-size:24px;font-weight:700;color:#171717;line-height:1.3;">' + opts.firstTimers + '</div>' +
            '<div style="font-size:12px;color:#9a9a9a;line-height:1.8;">مشتری برای اولین بار</div>' +
          '</td>' +
        '</tr></table>' +
      '</td></tr>' +
      // the table
      '<tr><td style="padding:20px 28px 8px 28px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:collapse;">' +
          '<tr>' +
            '<th align="right" width="50%" style="' + th + '">نام</th>' +
            '<th align="center" width="25%" style="' + th + '">ساعت</th>' +
            '<th align="center" width="25%" style="' + th + '">اولین بار</th>' +
          '</tr>' + trs +
        '</table>' +
      '</td></tr>' +
      // total line
      '<tr><td dir="rtl" align="right" style="padding:16px 28px 26px 28px;">' +
        '<div style="font-size:13px;color:#9a9a9a;line-height:2;">در مجموع ' + opts.totalStamps +
        ' مهر ثبت شد — ' + opts.firstTimers + ' مشتری برای اولین بار.</div>' +
      '</td></tr>';
  }

  return '' +
'<div dir="rtl" lang="fa">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f0f0;padding:24px 12px;">' +
'<tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Vazirmatn,Tahoma,Arial,sans-serif;">' +
    '<tr><td dir="rtl" align="right" style="padding:28px 28px 20px 28px;border-bottom:1px solid #ededed;">' +
      '<div style="font-size:20px;font-weight:700;color:#171717;line-height:1.6;">' + cafeName + '</div>' +
      '<div style="font-size:13px;color:#9a9a9a;line-height:1.8;margin-top:2px;">' + opts.dateLabel + '</div>' +
    '</td></tr>' +
    '<tr><td dir="rtl" align="right" style="padding:22px 28px 4px 28px;">' +
      '<div style="font-size:15px;font-weight:700;color:#171717;line-height:1.9;">گزارش فعالیت روزانه شما</div>' +
      '<div style="font-size:14px;color:#565656;line-height:2;margin-top:6px;">' +
        'در ادامه خلاصه‌ای از فعالیت‌های ثبت‌شده در مجموعه شما طی روز گذشته را مشاهده می‌کنید.' +
      '</div>' +
    '</td></tr>' +
    body +
    '<tr><td dir="rtl" align="right" style="padding:18px 28px;background:#fafafa;border-top:1px solid #ededed;">' +
      '<div style="font-size:12px;color:#9a9a9a;line-height:2;">' +
        '<a href="https://reloy.ir/owner" style="color:#171717;text-decoration:none;font-weight:700;">مشاهده پنل مدیریت</a>' +
        '&nbsp;·&nbsp; ریلوی' +
      '</div>' +
    '</td></tr>' +
  '</table>' +
'</td></tr></table>' +
'</div>';
}

// ---------------------------------------------------------------------------
// gathering a café's day
// ---------------------------------------------------------------------------
// Returns { cafeName, dateLabel, rows, totalStamps, firstTimers } for one café.
//
// FIRST-TIME DETECTION. A membership row is created lazily, in the same
// transaction as a customer's very first stamp at that café (card.pb.js) — so
// "joined this café today" and "first stamp here today" are the same event, and
// one query over the day's memberships identifies every first-timer without
// asking per customer. Only a customer's EARLIEST stamp of the day is marked:
// their second visit that evening is no longer a first.
// WHY THE WINDOW IS WIDENED AND THEN NARROWED IN JS. A datetime filter is a
// string comparison in SQLite, and this database holds two spellings of the
// same instant: PocketBase writes "2026-09-22 07:57:28.000Z" while anything
// inserted directly (the seed scripts) writes "2026-09-22T07:57:28.000Z". "T"
// is 0x54 and " " is 0x20, so a T-form row at 07:57 compares as GREATER than
// the day's 20:30 upper bound and silently vanishes from the result — no error,
// just a short report. The same comparison mis-sorts it.
//
// So the filter asks for a day either side, which both spellings satisfy, and
// the exact boundary and the ordering are applied here on parsed timestamps,
// where both spellings mean what they say.
function collect(card, day) {
  const cafeId = card.id;

  const raw = $app.findRecordsByFilter(
    "stamp_events",
    "cafe = {:c} && created >= {:s} && created < {:e}",
    "", MAX_ROWS, 0,
    { c: cafeId, s: pbTime(day.start - 86400000), e: pbTime(day.end + 86400000) }
  );

  const events = [];
  for (const ev of raw) {
    const t = ms(ev.getString("created"));
    if (t >= day.start && t < day.end) events.push({ rec: ev, t: t });
  }
  events.sort((a, b) => a.t - b.t);

  const joinedToday = {};
  try {
    const fresh = $app.findRecordsByFilter(
      "memberships",
      "cafe = {:c} && created >= {:s} && created < {:e}",
      "", 5000, 0,
      { c: cafeId, s: pbTime(day.start - 86400000), e: pbTime(day.end + 86400000) }
    );
    for (const m of fresh) {
      const t = ms(m.getString("created"));
      if (t >= day.start && t < day.end) joinedToday[m.getString("user")] = 1;
    }
  } catch (err) {}

  const names = {};   // user id -> display name, fetched once each
  const seen = {};    // user id -> already had a row today
  const rows = [];
  let firstTimers = 0;

  for (const item of events) {
    const ev = item.rec;
    const uid = ev.getString("user");
    if (!uid) continue;

    if (!(uid in names)) {
      let n = "";
      try { n = $app.findRecordById("users", uid).getString("name"); } catch (err) { n = ""; }
      names[uid] = n || "مشتری";
    }

    const first = !!joinedToday[uid] && !seen[uid];
    if (first) firstTimers++;
    seen[uid] = 1;

    rows.push({ name: names[uid], time: hhmm(item.t), first: first });
  }

  return {
    cafeName: card.getString("cafe_name") || "کافه",
    dateLabel: day.label,
    rows: rows,
    totalStamps: rows.length,
    firstTimers: firstTimers,
  };
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------
// Queues one mail_outbox row per café owner and returns a short summary. It
// never sends: the existing drain in notify.pb.js picks the rows up within five
// minutes, which keeps every retry, every failure log and the whole SMTP story
// in one place.
//
// Every café is reported every night, including ones with no stamps at all —
// a quiet day is itself information, and the owner learns the report is
// dependable rather than wondering whether it failed.
function run(nowMs) {
  const day = reportDay(nowMs || Date.now());
  const out = { day: day.label, queued: 0, skipped: 0, cafes: [] };

  let cards = [];
  try { cards = $app.findRecordsByFilter("cafe_card", "id != ''", "", 500, 0, {}); }
  catch (err) { cards = []; }

  for (const card of cards) {
    try {
      const ownerId = card.getString("owner_user");
      if (!ownerId) { out.skipped++; continue; }

      let email = "";
      try { email = $app.findRecordById("users", ownerId).getString("email"); } catch (err) { email = ""; }
      if (!email) { out.skipped++; continue; }

      const data = collect(card, day);

      const row = new Record($app.findCollectionByNameOrId("mail_outbox"));
      row.set("to", email);
      row.set("subject", "گزارش فعالیت روزانه شما");
      row.set("body", render(data));
      row.set("sent", false);
      row.set("attempts", 0);
      $app.save(row);

      out.queued++;
      out.cafes.push({ cafe: data.cafeName, stamps: data.totalStamps, firstTimers: data.firstTimers });
    } catch (err) {
      out.skipped++;
      try { $app.logger().error("daily report failed for a café", "cafe", card.id, "err", String(err)); } catch (e2) {}
    }
  }

  return out;
}

// A query-string reader for the dev routes. It lives here rather than in
// daily.pb.js because a handler cannot see its own file's top-level scope —
// only what require() hands it.
function q(e, name, fallback) {
  try {
    const v = e.requestInfo().query[name];
    return v === undefined || v === null || v === "" ? fallback : v;
  } catch (err) { return fallback; }
}

module.exports = { run, render, collect, reportDay, toJalali, q };
