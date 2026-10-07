/// <reference path="../pb_data/types.d.ts" />

// Café owner's customer list.
//
//   POST /owner/customers  (admin auth) -> { total, shown, customers: [...] }
//
// One row per membership in THIS café — the same scoping /owner/stats counts,
// not the global users table, so an owner only ever sees people who actually
// hold a card with them.
//
// The phone number is cut to its last four digits HERE, in the response, not
// in the page that renders it. An owner has no need for the other six, and a
// number that never leaves the database cannot leak from a screenshot, a
// browser extension, or a devtools Network tab. `phone4` is the whole of what
// this endpoint will say about how to reach someone.
//
// Self-contained callback, no shared top-level helpers — see the note at the
// top of card.pb.js for why that matters in the PocketBase JS hook runtime.

routerAdd("POST", "/owner/customers", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner", code: "NO_CAFE" });
  const cafeRequired = card.getInt("stamps_required") || 8;

  // Capped, and the cap is reported back as `total` vs `shown` so the page can
  // say so rather than quietly truncating. -updated is last-stamp order:
  // memberships are only ever written when a stamp lands (card.pb.js is their
  // only writer), so `updated` IS the last visit and the people who were in
  // yesterday sort to the top — the order an owner reads a customer list in.
  // Derived from the membership rather than from stamp_events on purpose:
  // the exact answer would mean scanning every event this café has ever
  // recorded, for a line that says "3 days ago".
  // Iran local time (fixed +3:30, no DST), the same convention /owner/stats
  // counts its days in. The day DELTA is worked out here rather than in the
  // page because this is where that convention lives — a browser in another
  // timezone would otherwise call last night's visit "2 days ago".
  const IRAN_OFF = 3.5 * 3600000;
  const dayIndex = (t) => Math.floor((t + IRAN_OFF) / 86400000);
  const ms = (v) => { const t = new Date(String(v).replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const todayIdx = dayIndex(Date.now());

  const LIMIT = 500;
  const rows = $app.findRecordsByFilter("memberships", "cafe = {:c}", "-updated", LIMIT, 0, { c: card.id });

  let total = rows.length;
  if (total === LIMIT) {
    // only pay for the full count when the page is actually truncated
    try { total = $app.findRecordsByFilter("memberships", "cafe = {:c}", "", 20000, 0, { c: card.id }).length; } catch (err) { total = LIMIT; }
  }

  // one query for every customer on the page instead of one per row
  try { $app.expandRecords(rows, ["user"], null); } catch (err) { /* fall back per row below */ }

  const out = [];
  for (const m of rows) {
    let who = null;
    try { who = m.expandedOne("user"); } catch (err) { who = null; }
    if (!who) { try { who = $app.findRecordById("users", m.getString("user")); } catch (err) { who = null; } }
    if (!who) continue; // membership whose user was deleted — nothing to show

    const phone = who.getString("phone") || "";
    const seenMs = ms(m.getString("updated"));
    out.push({
      // the membership id, which is what /owner/customer takes — never the
      // user id, so a row from this list cannot address anything but this
      // café's own record of that person
      id: m.id,
      name: who.getString("name") || "",
      phone4: phone.length >= 4 ? phone.slice(-4) : "",
      stamps: m.getInt("stamp_count"),
      required: m.getInt("card_required") || cafeRequired,
      cycles: m.getInt("cycles"),
      lastSeen: m.getString("updated"),
      // whole Iran-local days between that visit and today; null when the
      // row carries no usable timestamp, which the page renders as no line
      // rather than as "today"
      daysAgo: seenMs ? todayIdx - dayIndex(seenMs) : null,
      joined: m.getString("created"),
    });
  }

  return e.json(200, { total: total, shown: out.length, customers: out });
}, $apis.requireAuth());

// One customer's history at this café.
//
//   POST /owner/customer { id }  (admin auth) -> { profile, totals, rhythm, days, rewards }
//
// `id` is a MEMBERSHIP id, never a user id. A membership already names the
// café it belongs to, so the ownership check below is a single comparison —
// and an owner who guesses another café's membership id learns nothing,
// because the row is rejected before anything is read off it. Passing a user
// id instead would mean trusting this endpoint to re-scope every query it
// makes, and one missed filter would leak another café's history.
//
// Same phone rule as the list: four digits, cut server-side.
//
// Self-contained callback — see the note at the top of card.pb.js.

routerAdd("POST", "/owner/customer", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only", code: "OWNER_ONLY" });
  }

  let body = {};
  try { body = e.requestInfo().body || {}; } catch (err) { body = {}; }
  const mid = String(body.id || "");
  if (!mid) return e.json(400, { error: "Missing customer", code: "MISSING_CUSTOMER" });

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner", code: "NO_CAFE" });

  let m = null;
  try { m = $app.findRecordById("memberships", mid); } catch (err) { m = null; }
  if (!m || m.getString("cafe") !== card.id) {
    return e.json(404, { error: "Customer not found", code: "CUSTOMER_NOT_FOUND" });
  }

  let who = null;
  try { who = $app.findRecordById("users", m.getString("user")); } catch (err) { who = null; }
  if (!who) return e.json(404, { error: "Customer not found", code: "CUSTOMER_NOT_FOUND" });

  const IRAN_OFF = 3.5 * 3600000;          // fixed +3:30, no DST — as everywhere else
  const DAY = 86400000;
  const ms = (v) => { const t = new Date(String(v).replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  const dayIndex = (t) => Math.floor((t + IRAN_OFF) / DAY);
  const dayKey = (t) => { const d = new Date(t + IRAN_OFF); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
  const monthKey = (t) => { const d = new Date(t + IRAN_OFF); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
  const NOW = Date.now();
  const todayIdx = dayIndex(NOW);

  const userId = who.id;
  const req = m.getInt("card_required") || card.getInt("stamps_required") || 8;

  // ---- visits ----
  // Every stamp this person has had at THIS café. Both filters matter: the
  // same customer can hold cards at other cafés, and their events live in
  // the same table.
  let events = [];
  try { events = $app.findRecordsByFilter("stamp_events", "user = {:u} && cafe = {:c}", "created", 5000, 0, { u: userId, c: card.id }); } catch (err) { events = []; }

  const dayCount = {}, monthCount = {}, dow = [0, 0, 0, 0, 0, 0, 0];
  let firstMs = 0, lastMs = 0, visitDays = 0, last30 = 0;
  for (const ev of events) {
    const t = ms(ev.getString("created"));
    if (!t) continue;
    // Counted in whole Iran-local days, the same boundary `active` below
    // uses. A rolling 30x24h window from this instant looks equivalent and
    // is not: on the edge it disagreed with the badge, and two customers in
    // this café were reading "Away" above "1 visit in the last 30 days".
    // Sharing the boundary makes active <=> last30 > 0 true by construction.
    if (todayIdx - dayIndex(t) < 30) last30++;
    if (!firstMs || t < firstMs) firstMs = t;
    if (t > lastMs) lastMs = t;
    const dk = dayKey(t);
    if (!dayCount[dk]) { dayCount[dk] = 0; visitDays++; }
    dayCount[dk]++;
    const mk = monthKey(t);
    monthCount[mk] = (monthCount[mk] || 0) + 1;
    // weekday in Iran local terms, Saturday-first the way an Iranian week runs
    const local = new Date(t + IRAN_OFF);
    dow[(local.getUTCDay() + 1) % 7]++;
  }

  const days = Object.keys(dayCount).sort().map((k) => ({ d: k, n: dayCount[k] }));
  const months = Object.keys(monthCount).sort().map((k) => ({ m: k, n: monthCount[k] }));

  // ---- rhythm ----
  const joinedMs = ms(m.getString("created")) || firstMs || NOW;
  const spanDays = Math.max(1, Math.round((NOW - joinedMs) / DAY));
  const totalVisits = events.length;

  // Mean visits per month: total visits over months as a member.
  //
  // The divisor is clamped to a whole month, and that clamp is the whole
  // point. Dividing by a PARTIAL month extrapolates — 14 visits in 27 days
  // came out as "15.6 a month" sitting next to "14 in total", and nobody
  // averages more visits per month than they have ever made. Under a month,
  // the mean is simply the visits so far: that first partial month is the
  // only month there is, and guessing at the rest of it is what produced a
  // number larger than the data.
  const monthsAsMember = Math.max(1, spanDays / 30);
  const perMonth = Math.round((totalVisits / monthsAsMember) * 10) / 10;

  const avgGapDays = visitDays > 1 ? Math.round(((lastMs - firstMs) / DAY / (visitDays - 1)) * 10) / 10 : null;
  let busiestDow = null, busiestN = 0;
  for (let i = 0; i < 7; i++) if (dow[i] > busiestN) { busiestN = dow[i]; busiestDow = i; }
  if (!busiestN) busiestDow = null;

  // ---- rewards ----
  let discs = [];
  try { discs = $app.findRecordsByFilter("discounts", "user = {:u} && cafe = {:c}", "-created", 500, 0, { u: userId, c: card.id }); } catch (err) { discs = []; }
  let redeemed = 0, active = 0, expired = 0;
  const rewards = discs.map((d) => {
    const st = d.getString("status");
    if (st === "redeemed") redeemed++;
    else if (st === "expired") expired++;
    else active++;
    return {
      deal: d.getString("deal") || "",
      description: d.getString("description") || "",
      status: st,
      created: d.getString("created"),
      dueDate: d.getString("due_date"),
      redeemedAt: d.getString("redeemed_at"),
    };
  });

  const phone = who.getString("phone") || "";
  const lastMsAny = ms(m.getString("updated")) || lastMs;

  return e.json(200, {
    profile: {
      name: who.getString("name") || "",
      phone4: phone.length >= 4 ? phone.slice(-4) : "",
      joined: m.getString("created"),
      joinedDaysAgo: todayIdx - dayIndex(joinedMs),
      lastSeen: m.getString("updated"),
      daysAgo: lastMsAny ? todayIdx - dayIndex(lastMsAny) : null,
      // the café's own definition: at least one stamp in the last 30 days
      active: !!lastMs && todayIdx - dayIndex(lastMs) < 30,
    },
    totals: {
      stamps: m.getInt("stamp_count"),
      required: req,
      cycles: m.getInt("cycles"),
      visits: totalVisits,
      visitDays: visitDays,
      memberDays: spanDays,
    },
    rhythm: { perMonth: perMonth, last30: last30, avgGapDays: avgGapDays, busiestDow: busiestDow, months: months },
    days: days,
    rewards: { issued: rewards.length, redeemed: redeemed, active: active, expired: expired, list: rewards },
  });
}, $apis.requireAuth());
