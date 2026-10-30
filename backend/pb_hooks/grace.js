/// <reference path="../pb_data/types.d.ts" />

// How long a café keeps working after its subscription ends.
//
// ONE NUMBER, THREE JOBS. This value used to be written out separately in
// every place that needed it: `7 * 86400000` named GRACE_MS in card.pb.js, the
// same literal unnamed and inline in staff.pb.js, and `GRACE_DAYS = 7` in
// subscriptions.pb.js under a comment saying "must match card.pb.js". A
// comment is not a mechanism, and the three are not copies of one decision —
// they answer different questions:
//
//   card.pb.js           when stamping ACTUALLY stops
//   staff.pb.js          whether the staff panel shows "stamping is paused"
//   subscriptions.pb.js  which warning goes out on which day, and when a row
//                        is finally marked expired
//
// So a disagreement does not produce one wrong answer, it produces three
// different ones at the same time: a café emailed "you have until Thursday",
// whose staff panel says all is well, whose tag stops on Monday. Every piece
// behaving correctly according to the number it happened to be given.
//
// BOTH UNITS ARE EXPORTED on purpose. Two of the callers want milliseconds to
// add to a timestamp and one wants whole days to count down with; deriving one
// from the other at each call site is how the next copy gets made.
//
// A PLAIN .js, NOT .pb.js — it must not be loaded as a hook file — and
// `require`d INSIDE each handler, never at a file's top level: PocketBase
// gives every handler its own goja runtime with no sight of its own file's
// outer scope, so a constant declared beside a routerAdd is not defined by the
// time the handler runs. Same arrangement as jalali.js and card-pattern.js.
//
// WHERE THIS SHOULD EVENTUALLY LIVE. The `dashboard` branch adds settings.js,
// a single platform-settings row that /hq can edit, and the grace period
// belongs there with the price rather than in a module of its own — an admin
// has at least as much reason to change "how long before we cut a café off"
// as to change what it costs. Folding it in is a one-line change to the three
// requires once those branches meet; until then this is the single place.
//
// CHANGING IT. The number is quoted to cafés in the renewal emails and the
// push notices, so a change takes effect for everyone mid-flight: a café three
// days into a 7-day grace is suddenly three days into a 10-day one. That is
// the forgiving direction. Shortening it cuts people off earlier than they
// were told, which is the direction to think twice about.

// WHICH DATE A CAFÉ'S CLOCK ACTUALLY RUNS OUT ON.
//
// A subscription carries two of them and only ever one is filled: trial_ends
// for a café that has never paid, current_period_end for one that has —
// written in exactly one place, the successful-payment branch of
// zarinpal.pb.js.
//
// Every reader used to choose between them by STATUS:
//
//     status === "trialing" ? trial_ends : current_period_end
//
// which made the word in the status column decide which column was read. The
// daily sweep writes that word. When it marked a lapsed trial "expired" — the
// only change it makes — every reader silently switched from the date that
// was set to the one that never would be, the gate saw no deadline, and its
// fail-open branch let the café stamp free forever. That was the ending of
// every café that did not convert.
//
// So the status no longer chooses. Whichever date is actually present wins,
// preferring the paid one, and renaming a row cannot change what is read.
//
// AN EMPTY DateField IS A TRUTHY OBJECT, which is the trap directly under
// this one and the reason these helpers exist rather than a `||` at four call
// sites. `sub.get("current_period_end")` on an unset field returns an object
// that is `true` in a boolean test while `String(...)` of it is "". So
// `a || b` ALWAYS yields `a`, empty or not, and the obvious one-line version
// of this fix silently breaks the trial case it was written to protect.
// Everything below compares the stringified value.
function dateStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

// The raw stored string, "" when the café has no usable deadline at all.
function deadline(sub) {
  return dateStr(sub.get("current_period_end")) || dateStr(sub.get("trial_ends"));
}

// The same instant in milliseconds, 0 when there is none or it cannot be
// parsed. Callers treat 0 as "no deadline" and fail open, deliberately: see
// the long comment in card.pb.js. The space→T swap is the stored-format
// difference described in CLAUDE.md.
function deadlineMs(sub) {
  const raw = deadline(sub);
  if (!raw) return 0;
  const t = new Date(raw.replace(" ", "T")).getTime();
  return isNaN(t) ? 0 : t;
}

module.exports = {
  GRACE_DAYS: 7,
  GRACE_MS: 7 * 86400000,
  deadline,
  deadlineMs,
};
