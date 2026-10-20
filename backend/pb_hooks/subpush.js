/// <reference path="../pb_data/types.d.ts" />

// The seven subscription notifications, as lock-screen text.
//
// Same seven moments as the emails in submail.js — 7 / 3 / 1 days before the
// period ends, the three inside the grace, and the shutdown — because they
// are driven by the same sweep (subscriptions.pb.js) and an owner who gets
// one and not the other would think something was broken.
//
// WHY THIS IS NOT submail.js WITH THE TAGS STRIPPED. A lock screen is a
// different medium, not a smaller one:
//
//   LENGTH   Android shows roughly two lines of body and truncates without
//            ceremony. iOS shows more, but the first line is what gets read.
//            So each body is one sentence of state plus one of consequence,
//            and the café name lives in the body where there is room, never
//            in the title where it would push the deadline off the screen.
//   NO LINK  there is no CTA button to carry the "renew now and lose nothing"
//            reassurance the emails lead with, so the text has to stand on
//            its own and the tap just opens the panel.
//   REPEATED the emails arrive in an inbox and are read once. These replace
//            each other on the lock screen (see the tag in the sweep), so
//            each one must make sense as the ONLY one the owner ever sees.
//
// Persian digits, unlike the emails — which interpolate 7 and 3 as Latin
// numerals. The app's own fixed Persian strings use ۱۰ and ۱۵ (i18n.js), so
// these match the app and the emails are the ones out of step.

// ---------------------------------------------------------------------------
// bidi
// ---------------------------------------------------------------------------
// A notification body is plain text with no dir attribute, so the renderer
// guesses paragraph direction from the first strong character. Café names are
// very often Latin — "Oram", "Filo" — and "اشتراک Oram ۳ روز دیگر…" would be
// laid out left-to-right around that O, throwing the whole Persian sentence
// backwards.
//
//   RLM ‏   an invisible strong RTL character that pins the direction
//   FSI ⁨ … PDI ⁩   isolates the name so its own direction cannot
//                             reorder the sentence around it
//
// Both are zero-width: they change layout only, never what is read aloud.
// Same treatment as the stamp-request push in push.pb.js — see the longer
// note there.
function faName(n) { return "‏⁨" + n + "⁩"; }
function enName(n) { return "‎⁨" + n + "⁩"; }

// ۷ not 7. Only ever applied to the small integers below.
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function faNum(n) {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}

// ---------------------------------------------------------------------------
// 1. the period is about to end  (days = 7 | 3 | 1)
// ---------------------------------------------------------------------------
function renewalReminder(o) {
  const days = Number(o.days);
  const tomorrow = days <= 1;

  if (o.lang === "en") {
    return {
      title: tomorrow ? "Your subscription ends tomorrow"
                      : "Subscription ends in " + days + " days",
      body: tomorrow
        // On the last day the reason to act stops being "you lose nothing"
        // and becomes the consequence — the same turn the email takes.
        ? "After that you have 7 days' grace. If it is not renewed, your QR code and NFC tag stop giving stamps."
        : "The subscription for " + enName(o.cafe) + " ends in " + days + " days. Renew now and you lose nothing.",
    };
  }

  return {
    title: tomorrow ? "اشتراک فردا تمام می‌شود"
                    : "اشتراک تا " + faNum(days) + " روز دیگر تمام می‌شود",
    body: tomorrow
      ? "بعد از آن ۷ روز مهلت دارید. اگر تمدید نشود، کد QR و تگ NFC شما مهر نمی‌دهند."
      : "اشتراک " + faName(o.cafe) + " تا " + faNum(days) + " روز دیگر تمام می‌شود. تمدید کنید تا یک روز از دست نرود.",
  };
}

// ---------------------------------------------------------------------------
// 2. inside the grace  (graceDays = 7 | 3 | 1)
// ---------------------------------------------------------------------------
function graceStarted(o) {
  const left = Number(o.graceDays);
  const tomorrow = left <= 1;
  const start = left >= 7;        // the day the period actually ended

  if (o.lang === "en") {
    return {
      title: tomorrow ? "Stamps stop tomorrow"
           : start    ? "Subscription ended — 7 days left"
                      : left + " days until stamps stop",
      body: tomorrow
        ? "Everything works until tonight. From tomorrow your QR code and NFC tag stop giving stamps."
        : start
          ? "Everything still works as before. You have 7 days to renew."
          : "The grace period for " + enName(o.cafe) + " is nearly over. After it, customers cannot collect stamps.",
    };
  }

  return {
    title: tomorrow ? "فردا جمع‌کردن مهر متوقف می‌شود"
         : start    ? "اشتراک تمام شد — ۷ روز مهلت"
                    : faNum(left) + " روز تا توقف جمع‌کردن مهر",
    body: tomorrow
      ? "تا امشب همه‌چیز کار می‌کند. از فردا کد QR و تگ NFC شما مهر نمی‌دهند."
      : start
        ? "فعلاً همه‌چیز مثل قبل کار می‌کند. تا ۷ روز فرصت تمدید دارید."
        : "مهلت تمدید " + faName(o.cafe) + " رو به پایان است. بعد از آن مشتری‌ها نمی‌توانند مهر جمع کنند.",
  };
}

// ---------------------------------------------------------------------------
// 3. the grace ran out
// ---------------------------------------------------------------------------
// The one message that reports something already done rather than something
// coming. It still says what SURVIVED: an owner who reads only "متوقف شد" on
// a lock screen will assume their regulars just lost what they collected, and
// the next thing they do is apologise to a customer for nothing.
function shutdown(o) {
  if (o.lang === "en") {
    return {
      title: "Stamps have stopped",
      body: "Your QR code and NFC tag are not giving stamps for now. Rewards already earned stay valid.",
    };
  }
  return {
    title: "جمع‌کردن مهر متوقف شد",
    body: "کد QR و تگ NFC شما فعلاً مهر نمی‌دهند. جایزه‌هایی که مشتری‌ها گرفته‌اند معتبر می‌مانند.",
  };
}

module.exports = { renewalReminder, graceStarted, shutdown, faNum };
