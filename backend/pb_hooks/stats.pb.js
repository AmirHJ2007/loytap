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

  let card = null;
  try { card = $app.findFirstRecordByFilter("cafe_card", "owner_user = {:o}", { o: u.id }); } catch (err) { card = null; }
  if (!card) return e.json(404, { error: "No café configured for this owner" });
  const req = card.getInt("stamps_required") || 8;
  const cafe = card.getString("cafe_name");

  // ---- customers (loyalty + total stamps derived here) ----
  // one row per (customer, THIS café) — memberships, not the global users table
  let customers = 0, returning = 0, repeat = 0, stamps = 0, cardsCompleted = 0;
  let newCustomers = 0, inProgress = 0, todayMembers = 0;
  const custs = $app.findRecordsByFilter("memberships", "cafe = {:c}", "", 20000, 0, { c: card.id });
  for (const c of custs) {
    customers++;
    const cy = c.getInt("cycles");
    const sc = c.getInt("stamp_count");
    if (cy >= 1) returning++;
    if (cy >= 2) repeat++;
    if (sc > 0) inProgress++;                       // mid-card right now
    const createdMs = ms(c.getString("created"));    // when they joined THIS café
    if (createdMs >= cutoff14) newCustomers++;
    if (createdMs >= todayStart) todayMembers++;
    cardsCompleted += cy;
    stamps += cy * req + sc;
  }

  // stamps given today — only today's rows are fetched, so this stays cheap
  let todayStamps = 0;
  try {
    const tStr = new Date(todayStart).toISOString().replace("T", " ");
    todayStamps = $app.findRecordsByFilter("stamp_events", "created >= {:t} && cafe = {:c}", "", 20000, 0, { t: tStr, c: card.id }).length;
  } catch (err) { todayStamps = 0; }
  const avgStamps = customers > 0 ? Math.round((stamps / customers) * 10) / 10 : 0;


  // ---- discounts (status, per-deal usage, timeline) ----
  // lifetime status totals + a 30-day window for most-used rewards & redemption rate
  let issued = 0, redeemed = 0, expired = 0, active = 0, expiringSoon = 0, todayRewards = 0;
  let issued30 = 0, redeemed30 = 0;
  const dealMap = {}; // 30-day, per deal
  const discs = $app.findRecordsByFilter("discounts", "cafe = {:c}", "-created", 20000, 0, { c: card.id });
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
  const opts = $app.findRecordsByFilter("reward_options", "cafe = {:c}", "", 500, 0, { c: card.id });
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
  // stamps + distinct members from the last 60 days of events (filtered = cheap).
  // Alongside, track each customer's two earliest stamps in this window (first =
  // join, second = "came back") — these feed the comeback-rate series below.
  const firstEv = {}, secondEv = {}, stampsByUser = {};
  try {
    const startStr = new Date(NOW - NDAYS * 86400000).toISOString().replace("T", " ");
    const evs = $app.findRecordsByFilter("stamp_events", "created >= {:t} && cafe = {:c}", "", 200000, 0, { t: startStr, c: card.id });
    for (const ev of evs) {
      const t = ms(ev.getString("created"));
      const uid = ev.getString("user");
      const row = dayMap[localKey(t)];
      if (row) { row.stamps++; if (uid) row._m[uid] = 1; }
      if (uid) {
        (stampsByUser[uid] || (stampsByUser[uid] = [])).push(t);
        if (firstEv[uid] === undefined || t < firstEv[uid]) { secondEv[uid] = firstEv[uid]; firstEv[uid] = t; }
        else if (secondEv[uid] === undefined || t < secondEv[uid]) { secondEv[uid] = t; }
      }
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

  // ---- comeback rate: 14-day series of new-member retention ----
  // For each of the last 14 day-boundaries, take the 30-day window ending there:
  //   newMembers = customers whose FIRST stamp at this café lands in the window
  //   returners  = those whose 2nd stamp also lands in that same window
  //   rate       = returners / newMembers × 100
  // firstEv/secondEv (the two earliest stamps per customer, computed above) give
  // the join + comeback times. Only members whose 60-day fetch contains their
  // true first stamp can qualify, which holds for every window here (≤ 43 days back).
  const CB_WIN = 30 * 86400000;
  const endToday = todayStart + 86400000;                 // exclusive end of today (Iran local)
  const cbEarliest = endToday - CB_WIN - 13 * 86400000;   // start of the oldest of the 14 windows
  const cj = [];
  for (const c of custs) {
    const j = ms(c.getString("created"));                 // membership join = first stamp here
    if (j >= cbEarliest) cj.push({ j: j, sec: secondEv[c.getString("user")] });
  }
  const cbSeries = [];
  for (let dI = 0; dI < 14; dI++) {
    const wEnd = endToday - (13 - dI) * 86400000;
    const wStart = wEnd - CB_WIN;
    let nm = 0, ret = 0;
    for (const m of cj) {
      if (m.j < wStart || m.j >= wEnd) continue;           // not a new member in this window
      nm++;
      if (m.sec !== undefined && m.sec >= wStart && m.sec < wEnd) ret++; // came back inside the window
    }
    const dayStart = wEnd - 86400000;
    const dd = new Date(dayStart + IRAN_OFF);
    cbSeries.push({
      date: localKey(dayStart),
      label: pad(dd.getUTCDate()) + " " + MON[dd.getUTCMonth()],
      rate: pct(ret, nm), newMembers: nm, returners: ret,
    });
  }

  // ---- visit rhythm: 14-day series of the typical gap between visits ----
  // Per 30-day window, for every customer with >1 stamp we take the mean gap
  // between their consecutive stamps ( = span / (stamps − 1) ), then report the
  // MEDIAN of those per-customer means, in days. Lower = customers return sooner.
  const VR_WIN = 30 * 86400000;
  const vrPoint = (wStart, wEnd) => {
    const means = [];
    for (const uid in stampsByUser) {
      const arr = stampsByUser[uid];
      let mn = Infinity, mx = -Infinity, cnt = 0;
      for (let k = 0; k < arr.length; k++) {
        const t = arr[k];
        if (t >= wStart && t < wEnd) { cnt++; if (t < mn) mn = t; if (t > mx) mx = t; }
      }
      if (cnt >= 2) means.push((mx - mn) / (cnt - 1) / 86400000); // mean consecutive gap, in days
    }
    if (!means.length) return { value: null, customers: 0 };
    means.sort((a, b) => a - b);
    const m = means.length, mid = m >> 1;
    const med = (m % 2) ? means[mid] : (means[mid - 1] + means[mid]) / 2;
    return { value: Math.round(med * 10) / 10, customers: m };
  };
  const vrSeries = [];
  for (let dI = 0; dI < 14; dI++) {
    const wEnd = endToday - (13 - dI) * 86400000;
    const p = vrPoint(wEnd - VR_WIN, wEnd);
    const dayStart = wEnd - 86400000;
    const dd = new Date(dayStart + IRAN_OFF);
    vrSeries.push({ date: localKey(dayStart), label: pad(dd.getUTCDate()) + " " + MON[dd.getUTCMonth()], value: p.value, customers: p.customers });
  }

  return e.json(200, {
    cafe: cafe,
    today: { members: todayMembers, stamps: todayStamps, rewards: todayRewards },
    comeback: { windowDays: 30, today: cbSeries[13].rate, series: cbSeries },
    visitRhythm: { windowDays: 30, today: vrSeries[13].value, todayCustomers: vrSeries[13].customers, series: vrSeries },
    totals: { customers, newCustomers, returning, repeat, inProgress, avgStamps, stamps,
      cardsCompleted, issued, redeemed, expired, active, expiringSoon, issued30, redeemed30 },
    rates: { comeback: pct(returning, customers), redemption: pct(redeemed30, issued30) },
    byDeal: byDeal,
    activity: { d7: windowSummary(7), d30: windowSummary(30) },
  });
}, $apis.requireAuth());
