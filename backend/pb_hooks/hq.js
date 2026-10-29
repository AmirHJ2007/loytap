/// <reference path="../pb_data/types.d.ts" />

// مرکز فرمان — the platform-wide aggregate behind /hq.
//
// The owner panel's /owner/stats answers "how is MY café doing". This answers
// the other axis: every café at once, the money, and the plumbing that costs
// money or silently breaks. Nothing here is scoped to one café, and nothing
// here is reachable without superuser auth (see hq.pb.js).
//
// A plain .js required inside the route handler, because PocketBase gives each
// handler its own goja runtime with no sight of its own file's top-level scope.
// Same arrangement as settings.js and webpush.js.
//
// ---------------------------------------------------------------------------
// TWO TRAPS THIS FILE IS BUILT AROUND
// ---------------------------------------------------------------------------
//
// 1. THE `created` COLUMNS HOLD TWO SPELLINGS OF THE SAME INSTANT.
//    PocketBase writes "2026-09-22 07:57:28.000Z" (space); rows inserted by
//    the seed scripts carry "2026-09-22T07:57:28.000Z" (T). A PocketBase
//    datetime filter is a STRING comparison and "T" (0x54) sorts above " "
//    (0x20), so a T-form row inside a day compares as greater than that day's
//    upper bound and vanishes from the result — no error, just a short answer.
//    Every range filter below is therefore widened by a day on each side, and
//    the exact boundary is applied in JS on parsed timestamps. Same rule as
//    dailyreport.js.
//
// 2. "TODAY" IS A TEHRAN DAY, NOT A UTC ONE.
//    The container is Alpine with no tzdata and no TZ, so the server clock is
//    UTC. Tehran is a fixed +3:30 with no DST (Iran abolished it in 2022).
//    Every day boundary here is derived from Date.now() plus that offset, so
//    a reading taken at 02:00 Tehran still reports the right day.

const IRAN_OFF = 3.5 * 3600000;
const DAY = 86400000;

// Rows scanned per collection. The product is at café-scale, not
// stamp-event-scale: memberships, discounts and payments are thousands of
// rows, and the one genuinely large table (stamp_events) is only ever read
// through a date filter. The cap exists so a runaway cannot build a response
// nobody can load, not as a real limit.
const MAX = 20000;

// A PocketBase datetime string -> epoch ms, tolerant of both spellings.
function ms(v) {
  if (!v) return 0;
  const t = new Date(String(v).replace(" ", "T")).getTime();
  return isNaN(t) ? 0 : t;
}

// ... and back, in the space-separated form a filter wants.
function pbTime(t) {
  return new Date(t).toISOString().replace("T", " ");
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// Midnight Tehran, as a real UTC epoch, for the day containing `t`.
function dayStart(t) {
  const d = new Date(t + IRAN_OFF);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IRAN_OFF;
}

// "2026-10-27" for the Tehran day containing `t`.
function dayKey(t) {
  const d = new Date(t + IRAN_OFF);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

// Records in a half-open [from, to) window of real time, filtered with a
// day's slack on each side and then trimmed exactly in JS. See trap 1.
function inWindow(collection, field, from, to, extra, params) {
  const p = Object.assign({}, params || {}, {
    _lo: pbTime(from - DAY),
    _hi: pbTime(to + DAY),
  });
  let filter = "(" + field + " >= {:_lo} && " + field + " <= {:_hi})";
  if (extra) filter = filter + " && (" + extra + ")";
  let rows = [];
  try { rows = $app.findRecordsByFilter(collection, filter, "", MAX, 0, p); } catch (err) { rows = []; }
  const out = [];
  for (const r of rows) {
    const t = ms(r.getString(field));
    if (t >= from && t < to) out.push(r);
  }
  return out;
}

// Everything in a collection, unfiltered. Used for the café-scale tables.
function all(collection, sort) {
  try { return $app.findRecordsByFilter(collection, "1=1", sort || "", MAX, 0); } catch (err) { return []; }
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------
function report() {
  const NOW = Date.now();
  const today = dayStart(NOW);
  const tomorrow = today + DAY;

  // Month boundaries on the Gregorian calendar, deliberately. The Jalali month
  // is what an owner reads a date in, but a revenue figure is compared against
  // a bank statement and a ZarinPal settlement, both of which are Gregorian.
  const iNow = new Date(NOW + IRAN_OFF);
  const monthStart = Date.UTC(iNow.getUTCFullYear(), iNow.getUTCMonth(), 1) - IRAN_OFF;
  const prevMonthStart = Date.UTC(iNow.getUTCFullYear(), iNow.getUTCMonth() - 1, 1) - IRAN_OFF;

  const prices = require(`${__hooks}/settings.js`).prices();

  // ---- cafés, owners, subscriptions -------------------------------------
  const cafes = all("cafe_card", "created");
  const owners = {};
  for (const u of all("users", "")) {
    if (u.getString("role") === "admin") owners[u.id] = u;
  }

  const subByCafe = {};
  for (const sr of all("subscriptions", "")) subByCafe[sr.getString("cafe")] = sr;

  // ---- per-café activity, in two filtered passes ------------------------
  // Membership rows are one per (customer, café) and carry the café's whole
  // customer count; stamp events are read only for the last 60 Tehran days,
  // which is what keeps this cheap on the one big table.
  const memberCount = {}, memberNew30 = {};
  for (const m of all("memberships", "")) {
    const c = m.getString("cafe");
    memberCount[c] = (memberCount[c] || 0) + 1;
    if (ms(m.getString("created")) >= today - 30 * DAY) memberNew30[c] = (memberNew30[c] || 0) + 1;
  }

  const WINDOW = 60;
  const since = today - (WINDOW - 1) * DAY;
  const events = inWindow("stamp_events", "created", since, tomorrow, "", {});

  const stamps30 = {}, stamps14 = {}, lastStamp = {};
  const dayMap = {};
  for (let i = 0; i < WINDOW; i++) {
    const t = since + i * DAY;
    dayMap[dayKey(t)] = { date: dayKey(t), stamps: 0, customers: 0, cafes: 0 };
  }
  for (const ev of events) {
    const t = ms(ev.getString("created"));
    const c = ev.getString("cafe");
    const k = dayKey(t);
    if (dayMap[k]) dayMap[k].stamps++;
    if (t >= today - 30 * DAY) stamps30[c] = (stamps30[c] || 0) + 1;
    if (t >= today - 14 * DAY) stamps14[c] = (stamps14[c] || 0) + 1;
    if (t > (lastStamp[c] || 0)) lastStamp[c] = t;
  }

  // New customers and new cafés per day, on the same 60-day axis.
  for (const m of inWindow("memberships", "created", since, tomorrow, "", {})) {
    const k = dayKey(ms(m.getString("created")));
    if (dayMap[k]) dayMap[k].customers++;
  }
  for (const c of cafes) {
    const k = dayKey(ms(c.getString("created")));
    if (dayMap[k]) dayMap[k].cafes++;
  }
  const timeline = Object.keys(dayMap).sort().map((k) => dayMap[k]);

  // ---- money ------------------------------------------------------------
  // Only `paid` rows are money. A `pending` row is an attempt that opened a
  // gateway page; counting those as revenue would overstate it by every
  // abandoned checkout.
  const payments = all("payments", "");
  let collected = 0, thisMonth = 0, lastMonth = 0, paidCount = 0;
  let attempts = 0, failed = 0, pending = 0;
  const recent = [];
  for (const p of payments) {
    const st = p.getString("status");
    const amt = p.getInt("amount");
    attempts++;
    if (st === "failed" || st === "cancelled") failed++;
    else if (st === "pending") pending++;
    else if (st === "paid") {
      paidCount++;
      collected += amt;
      // paid_at, not created: an attempt opened before midnight and completed
      // after it belongs to the day the money moved.
      const t = ms(p.getString("paid_at")) || ms(p.getString("created"));
      if (t >= monthStart) thisMonth += amt;
      else if (t >= prevMonthStart) lastMonth += amt;
      recent.push({
        cafe: p.getString("cafe"), amount: amt, plan: p.getString("plan"),
        at: t, invoice: p.getInt("invoice_no"), ref: p.getString("ref_id"),
      });
    }
  }
  recent.sort((a, b) => b.at - a.at);

  // Why failures failed, from the note the payment hook leaves for support.
  // Grouped because one recurring message across many cafés is a bug, where
  // the same count spread over many messages is just people changing their
  // minds at a gateway.
  const failNotes = {};
  for (const p of payments) {
    const st = p.getString("status");
    if (st !== "failed" && st !== "cancelled") continue;
    const n = (p.getString("note") || "—").slice(0, 120);
    failNotes[n] = (failNotes[n] || 0) + 1;
  }

  // ---- the café table ---------------------------------------------------
  // One row per café, with the two derived signals that matter more than any
  // total: a café paying and not stamping, and a café that never started.
  const statusCount = { trialing: 0, active: 0, past_due: 0, cancelled: 0, expired: 0, none: 0 };
  const planCount = { monthly: 0, yearly: 0 };
  let mrr = 0, atRisk = 0, renew7 = 0, renew30 = 0, trialEnd7 = 0;
  let idleButPaying = 0, neverActivated = 0;
  const rows = [];

  for (const c of cafes) {
    const sr = subByCafe[c.id] || null;
    const status = sr ? sr.getString("status") : "none";
    const plan = sr ? sr.getString("plan") : "";
    const amount = sr ? sr.getInt("amount") : 0;
    const until = sr ? ms(status === "trialing" ? sr.get("trial_ends") : sr.get("current_period_end")) : 0;
    const owner = owners[c.getString("owner_user")] || null;

    statusCount[status] = (statusCount[status] || 0) + 1;

    const paying = status === "active" || status === "past_due";
    if (paying && plan) {
      planCount[plan] = (planCount[plan] || 0) + 1;
      // Normalised to a month so the two plans can be added up. The café's own
      // `amount` is what it was last charged, which is the honest basis — a
      // café on last quarter's price contributes last quarter's price, not
      // today's list price.
      const charged = amount > 0 ? amount : prices[plan] || 0;
      mrr += plan === "yearly" ? Math.round(charged / 12) : charged;
    }
    if (status === "past_due") atRisk += amount > 0 ? amount : prices[plan] || 0;
    if (status === "active" && until >= NOW && until < NOW + 7 * DAY) renew7++;
    if (status === "active" && until >= NOW && until < NOW + 30 * DAY) renew30++;
    if (status === "trialing" && until >= NOW && until < NOW + 7 * DAY) trialEnd7++;

    const s14 = stamps14[c.id] || 0;
    const last = lastStamp[c.id] || 0;
    // "Never activated" is about the café, not the window: no stamp has ever
    // been given, so a count from the last 60 days cannot answer it. Falls
    // back to a direct check only for cafés the window says are quiet.
    let everStamped = s14 > 0 || (stamps30[c.id] || 0) > 0;
    if (!everStamped) {
      try {
        everStamped = $app.findRecordsByFilter("stamp_events", "cafe = {:c}", "", 1, 0, { c: c.id }).length > 0;
      } catch (err) { everStamped = false; }
    }
    if (paying && s14 === 0) idleButPaying++;
    if (!everStamped) neverActivated++;

    rows.push({
      id: c.id,
      name: c.getString("cafe_name"),
      owner: owner ? owner.getString("name") : "",
      phone: owner ? owner.getString("phone") : "",
      email: owner ? owner.getString("email") : "",
      joined: ms(c.getString("created")),
      status: status,
      plan: plan,
      amount: amount,
      until: until,
      customers: memberCount[c.id] || 0,
      customers30: memberNew30[c.id] || 0,
      stamps30: stamps30[c.id] || 0,
      stamps14: s14,
      last_stamp: last,
      activated: everStamped,
    });
  }
  rows.sort((a, b) => b.stamps30 - a.stamps30 || b.customers - a.customers);

  // ---- churn and the grace list -----------------------------------------
  // `updated` is when the sweep moved the row, which for a lapse is the day
  // it lapsed. It is not a true event log — a café that lapsed and later
  // renewed no longer reads as churn — so this is "lapsed and still lapsed
  // this month", which is the number worth phoning about.
  let churned = 0, churnedToman = 0;
  const grace = [];
  for (const c of cafes) {
    const sr = subByCafe[c.id];
    if (!sr) continue;
    const status = sr.getString("status");
    if ((status === "expired" || status === "cancelled") && ms(sr.getString("updated")) >= monthStart) {
      churned++;
      const plan = sr.getString("plan");
      const amt = sr.getInt("amount") || prices[plan] || 0;
      churnedToman += plan === "yearly" ? Math.round(amt / 12) : amt;
    }
    if (status === "past_due") {
      const end = ms(sr.get("current_period_end"));
      // Which day of the grace they are on, counted in whole Tehran days so
      // it matches what the letters they received said.
      const used = Math.max(0, Math.round((dayStart(NOW) - dayStart(end)) / DAY));
      const owner = owners[c.getString("owner_user")] || null;
      grace.push({
        cafe: c.getString("cafe_name"),
        owner: owner ? owner.getString("name") : "",
        phone: owner ? owner.getString("phone") : "",
        email: owner ? owner.getString("email") : "",
        day: used,
        left: Math.max(0, require(`${__hooks}/submail.js`).GRACE_DAYS - used),
        ended: end,
        plan: sr.getString("plan"),
      });
    }
  }
  grace.sort((a, b) => a.left - b.left);

  // ---- platform totals --------------------------------------------------
  let customers = 0;
  try {
    customers = $app.findRecordsByFilter("users", 'role = "customer"', "", MAX, 0).length;
  } catch (err) { customers = 0; }

  let memberships = 0, cardsCompleted = 0, stampsTotal = 0;
  const reqByCafe = {};
  for (const c of cafes) reqByCafe[c.id] = c.getInt("stamps_required") || 8;
  for (const m of all("memberships", "")) {
    memberships++;
    const cy = m.getInt("cycles");
    cardsCompleted += cy;
    // Total stamps derived the way /owner/stats derives it — cycles × the
    // café's own requirement plus the part-filled card — so the big events
    // table is never scanned in full.
    stampsTotal += cy * (reqByCafe[m.getString("cafe")] || 8) + m.getInt("stamp_count");
  }

  let issued = 0, redeemed = 0, expiredRewards = 0, activeRewards = 0;
  for (const d of all("discounts", "")) {
    issued++;
    const st = d.getString("status");
    if (st === "redeemed") redeemed++;
    else if (st === "expired") expiredRewards++;
    else activeRewards++;
  }

  // ---- ops health -------------------------------------------------------
  // SMS is a real cost line here, and the only record of it is the per-phone
  // budget rows, which carry a rolling count rather than a log. `sends` is
  // therefore "in the current window", not lifetime — stated as such in the
  // response so the dashboard cannot label it as a total.
  const smsByPurpose = {};
  let smsWindow = 0;
  for (const b of all("sms_budgets", "")) {
    const purpose = b.getString("purpose") || "other";
    const n = b.getInt("sends");
    smsByPurpose[purpose] = (smsByPurpose[purpose] || 0) + n;
    smsWindow += n;
  }

  let mailUnsent = 0, mailRetrying = 0, mailLastError = "";
  for (const m of all("mail_outbox", "-created")) {
    if (m.get("sent")) continue;
    mailUnsent++;
    if (m.getInt("attempts") > 1) mailRetrying++;
    if (!mailLastError) mailLastError = (m.getString("last_error") || "").slice(0, 200);
  }

  const pushByScope = {};
  for (const p of all("push_subs", "")) {
    const scope = p.getString("scope") || "staff";
    pushByScope[scope] = (pushByScope[scope] || 0) + 1;
  }

  // OTP requested versus verified, as a signup-friction reading. otp_codes
  // rows are consumed on success, so this is deliberately only the last 7
  // days and is labelled as a window, not a rate.
  const otpRows = inWindow("otp_codes", "created", today - 7 * DAY, tomorrow, "", {});

  return {
    generated: NOW,
    pricing: prices,
    money: {
      mrr: mrr,
      collected: collected,
      this_month: thisMonth,
      last_month: lastMonth,
      arpc: statusCount.active > 0 ? Math.round(mrr / statusCount.active) : 0,
      at_risk: atRisk,
      renew_7: renew7,
      renew_30: renew30,
      paid_count: paidCount,
      attempts: attempts,
      failed: failed,
      pending: pending,
      gateway_rate: pct(paidCount, attempts),
      fail_notes: Object.keys(failNotes).map((k) => ({ note: k, count: failNotes[k] }))
        .sort((a, b) => b.count - a.count).slice(0, 8),
      recent: recent.slice(0, 12),
    },
    subs: {
      status: statusCount,
      plans: planCount,
      trial_end_7: trialEnd7,
      churned_month: churned,
      churned_toman: churnedToman,
      grace: grace,
    },
    cafes: {
      total: cafes.length,
      rows: rows,
      idle_but_paying: idleButPaying,
      never_activated: neverActivated,
    },
    growth: {
      customers: customers,
      memberships: memberships,
      stamps: stampsTotal,
      cards_completed: cardsCompleted,
      rewards_issued: issued,
      rewards_redeemed: redeemed,
      rewards_active: activeRewards,
      rewards_expired: expiredRewards,
      redemption_rate: pct(redeemed, issued),
      timeline: timeline,
    },
    ops: {
      sms_window: smsWindow,
      sms_by_purpose: Object.keys(smsByPurpose).map((k) => ({ purpose: k, sends: smsByPurpose[k] })),
      mail_unsent: mailUnsent,
      mail_retrying: mailRetrying,
      mail_last_error: mailLastError,
      push_by_scope: Object.keys(pushByScope).map((k) => ({ scope: k, count: pushByScope[k] })),
      otp_7d: otpRows.length,
    },
  };
}

module.exports = { report, dayKey, dayStart, ms, IRAN_OFF, DAY };
