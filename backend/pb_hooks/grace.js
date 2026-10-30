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

module.exports = {
  GRACE_DAYS: 7,
  GRACE_MS: 7 * 86400000,
};
