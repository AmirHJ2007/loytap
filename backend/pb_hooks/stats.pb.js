/// <reference path="../pb_data/types.d.ts" />

// Café owner analytics.  Admin-only aggregate over users + discounts (the big
// stamp_events table is never scanned — total stamps is derived from users:
// Σ(cycles × stamps_required + stamp_count)).
//
//   POST /owner/stats  (admin auth) -> { cafe, totals, rates, byDeal, timeline }

routerAdd("POST", "/owner/stats", (e) => {
  const u = e.auth;
  if (!u || u.getString("role") !== "admin") {
    return e.json(403, { error: "Owner access only" });
  }

  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  const dayKey = (d) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  const dayLabel = (d) => pad(d.getUTCDate()) + "/" + pad(d.getUTCMonth() + 1);
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const ms = (s) => { const t = new Date(String(s).replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; };
  const NOW = Date.now();
  const cutoff14 = NOW - 14 * 86400000;   // "new" customers window
  const cutoff30 = NOW - 30 * 86400000;   // "recent" window for most-used rewards + redemption rate
  const soon7 = NOW + 7 * 86400000;       // "expiring soon" window
  // start of "today" in Iran local time (fixed +3:30, no DST) as a UTC timestamp
  const IRAN_OFF = 3.5 * 3600000;
  const iNow = new Date(NOW + IRAN_OFF);
  const todayStart = Date.UTC(iNow.getUTCFullYear(), iNow.getUTCMonth(), iNow.getUTCDate()) - IRAN_OFF;

  const card = $app.findRecordsByFilter("cafe_card", "stamps_required >= 0", "", 1, 0, {})[0];
  const req = card ? card.getInt("stamps_required") : 8;
  const cafe = card ? card.getString("cafe_name") : "";

  // ---- customers (loyalty + total stamps derived here) ----
  let customers = 0, returning = 0, repeat = 0, stamps = 0, cardsCompleted = 0;
  let newCustomers = 0, inProgress = 0, todayMembers = 0;
  const custs = $app.findRecordsByFilter("users", "role = 'customer'", "", 20000, 0, {});
  for (const c of custs) {
    customers++;
    const cy = c.getInt("cycles");
    const sc = c.getInt("stamp_count");
    if (cy >= 1) returning++;
    if (cy >= 2) repeat++;
    if (sc > 0) inProgress++;                       // mid-card right now
    const createdMs = ms(c.getString("created"));
    if (createdMs >= cutoff14) newCustomers++;
    if (createdMs >= todayStart) todayMembers++;
    cardsCompleted += cy;
    stamps += cy * req + sc;
  }

  // stamps given today — only today's rows are fetched, so this stays cheap
  let todayStamps = 0;
  try {
    const tStr = new Date(todayStart).toISOString().replace("T", " ");
    todayStamps = $app.findRecordsByFilter("stamp_events", "created >= {:t}", "", 20000, 0, { t: tStr }).length;
  } catch (err) { todayStamps = 0; }
  const avgStamps = customers > 0 ? Math.round((stamps / customers) * 10) / 10 : 0;


  // ---- discounts (status, per-deal usage, timeline) ----
  // lifetime status totals + a 30-day window for most-used rewards & redemption rate
  let issued = 0, redeemed = 0, expired = 0, active = 0, expiringSoon = 0, todayRewards = 0;
  let issued30 = 0, redeemed30 = 0;
  const dealMap = {}; // 30-day, per deal
  const discs = $app.findRecordsByFilter("discounts", "id != ''", "-created", 20000, 0, {});
  for (const d of discs) {
    issued++;
    const cMs = ms(d.getString("created"));
    if (cMs >= todayStart) todayRewards++;
    const st = d.getString("status");
    const deal = d.getString("deal") || "Reward";

    // most-used rewards + redemption rate are scoped to the last 30 days
    if (cMs >= cutoff30) {
      issued30++;
      if (!dealMap[deal]) dealMap[deal] = { deal: deal, issued: 0, redeemed: 0 };
      dealMap[deal].issued++;
      if (st === "redeemed") { redeemed30++; dealMap[deal].redeemed++; }
    }

    if (st === "redeemed") redeemed++;
    else if (st === "expired") expired++;
    else {
      active++;
      const due = ms(d.getString("due_date")); // active reward the customer hasn't claimed yet
      if (due >= NOW && due <= soon7) expiringSoon++;
    }
  }

  // seed byDeal with every reward in the pool so unused ones show as 0
  const opts = $app.findRecordsByFilter("reward_options", "id != ''", "", 500, 0, {});
  for (const o of opts) {
    const deal = o.getString("deal") || "Reward";
    if (!dealMap[deal]) dealMap[deal] = { deal: deal, issued: 0, redeemed: 0 };
  }
  const byDeal = Object.keys(dealMap).map((k) => dealMap[k])
    .sort((a, b) => (b.redeemed - a.redeemed) || (b.issued - a.issued));

  // ---- daily stamp activity (last 60 Iran-local days) ----
  // per day: stamps (events), members (distinct customers), rewards (discounts earned)
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const localKey = (t) => { const d = new Date(t + IRAN_OFF); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
  const NDAYS = 60;
  const dayArr = [], dayMap = {};
  const iMid = Date.UTC(iNow.getUTCFullYear(), iNow.getUTCMonth(), iNow.getUTCDate()); // Iran-midnight, shifted space
  for (let i = NDAYS - 1; i >= 0; i--) {
    const d = new Date(iMid - i * 86400000);
    const row = { date: localKey(d.getTime() - IRAN_OFF), dow: DOW[d.getUTCDay()],
      label: DOW[d.getUTCDay()] + " " + pad(d.getUTCDate()) + " " + MON[d.getUTCMonth()],
      stamps: 0, members: 0, rewards: 0, _m: {} };
    dayArr.push(row); dayMap[row.date] = row;
  }
  // stamps + distinct members from the last 60 days of events (filtered = cheap)
  try {
    const startStr = new Date(NOW - NDAYS * 86400000).toISOString().replace("T", " ");
    const evs = $app.findRecordsByFilter("stamp_events", "created >= {:t}", "", 200000, 0, { t: startStr });
    for (const ev of evs) {
      const row = dayMap[localKey(ms(ev.getString("created")))];
      if (!row) continue;
      row.stamps++;
      const uid = ev.getString("user"); if (uid) row._m[uid] = 1;
    }
  } catch (err) {}
  for (const row of dayArr) row.members = Object.keys(row._m).length;
  // rewards earned per day (reuse discounts already fetched)
  for (const d of discs) { const row = dayMap[localKey(ms(d.getString("created")))]; if (row) row.rewards++; }

  const windowSummary = (len) => {
    const cur = dayArr.slice(NDAYS - len);
    const prev = dayArr.slice(NDAYS - 2 * len, NDAYS - len);
    let s = 0, rw = 0, ps = 0; const mem = {};
    for (const r of cur) { s += r.stamps; rw += r.rewards; for (const u in r._m) mem[u] = 1; }
    for (const r of prev) ps += r.stamps;
    const days = cur.map((r) => ({ date: r.date, dow: r.dow, label: r.label, stamps: r.stamps, members: r.members, rewards: r.rewards }));
    return { stamps: s, members: Object.keys(mem).length, rewards: rw, prevStamps: ps, days: days };
  };

  return e.json(200, {
    cafe: cafe,
    today: { members: todayMembers, stamps: todayStamps, rewards: todayRewards },
    totals: { customers, newCustomers, returning, repeat, inProgress, avgStamps, stamps,
      cardsCompleted, issued, redeemed, expired, active, expiringSoon, issued30, redeemed30 },
    rates: { comeback: pct(returning, customers), redemption: pct(redeemed30, issued30) },
    byDeal: byDeal,
    activity: { d7: windowSummary(7), d30: windowSummary(30) },
  });
}, $apis.requireAuth());
