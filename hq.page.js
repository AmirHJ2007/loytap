// ===================================================================
// Reloy — مرکز فرمان (/hq): the platform-wide dashboard, and the two
// things it can change: the subscription price and the wording of the
// subscription letters.
//
// Its own file rather than inline script, because the CSP carries no
// 'unsafe-inline' (backend/pb_hooks/headers.pb.js).
//
// SESSION. A PocketBase superuser token, kept under its own localStorage key.
// It deliberately does NOT reuse "loytap_token": that key holds a café
// owner's or a customer's session, and sharing one slot would mean signing in
// here signs you out of a café panel you had open — and worse, that a stale
// owner token could be sent to an endpoint expecting a superuser one.
// ===================================================================
(function () {
  "use strict";

  // Same rule as every other page: port 8000 is dev.sh serving the repo root
  // with PocketBase on 8090 beside it; in production the API shares the origin.
  var API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
  var KEY = "reloy_hq_token";

  var $ = function (id) { return document.getElementById(id); };
  var token = "";
  try { token = localStorage.getItem(KEY) || ""; } catch (e) { token = ""; }

  // ---- numbers and dates ------------------------------------------------
  // Western digits throughout, in Persian text too. Intl is asked for
  // 'nu-latn' explicitly, and mapped afterwards as well: a browser that
  // ignores the numbering-system subtag would otherwise hand back ۱۴۰۵ and
  // quietly break the one typographic rule this product holds to everywhere.
  var FA_DIGITS = /[۰-۹٠-٩]/g;
  function latin(s) {
    return String(s).replace(FA_DIGITS, function (d) {
      var c = d.charCodeAt(0);
      return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
    });
  }

  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }

  // Toman, in full, with thousands separators.
  //
  // Deliberately NOT abbreviated to "3 م". Every figure on this page is a
  // number somebody will read out loud, write into a spreadsheet, or check
  // against a bank statement, and a rounded headline is the one that gets
  // quoted. The tiles are wide enough for eleven digits, so there is nothing
  // to buy by shortening them except ambiguity.
  function toman(n) { return fmt(n); }

  var jDate = null, jTime = null;
  try {
    jDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn",
      { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Tehran" });
    jTime = new Intl.DateTimeFormat("fa-IR-u-nu-latn",
      { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tehran" });
  } catch (e) { jDate = null; jTime = null; }

  // "26 مهر 1405". Falls back to an ISO date rather than to a Gregorian
  // Persian-language date, which would be the one shape that looks right and
  // is wrong.
  function faDate(msVal) {
    if (!msVal) return "—";
    if (!jDate) return new Date(msVal).toISOString().slice(0, 10);
    return latin(jDate.format(new Date(msVal)));
  }
  function faTime(msVal) {
    if (!msVal) return "—";
    if (!jTime) return "";
    return latin(jTime.format(new Date(msVal)));
  }

  // Whole Tehran days between now and then, signed. Used for "N روز" columns,
  // which must agree with what the letters told the café — so it counts day
  // boundaries, not elapsed hours.
  var IRAN_OFF = 3.5 * 3600000, DAY = 86400000;
  function dayStart(t) {
    var d = new Date(t + IRAN_OFF);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IRAN_OFF;
  }
  function daysFromNow(t) {
    if (!t) return null;
    return Math.round((dayStart(t) - dayStart(Date.now())) / DAY);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // A Latin number or code sitting inside an RTL cell needs its own isolate,
  // or it is reordered around its own punctuation — a time renders as 15:09
  // instead of 09:15. Every numeric cell below goes through this.
  function n(v) { return '<span class="num ltr">' + esc(v) + "</span>"; }

  // ---- gate -------------------------------------------------------------
  var STATUS_FA = {
    trialing: "آزمایشی", active: "فعال", past_due: "در مهلت",
    cancelled: "لغو شده", expired: "منقضی", none: "بدون اشتراک",
  };
  var PLAN_FA = { monthly: "ماهانه", yearly: "سالانه", "": "—" };

  // The ops tables read keys straight out of the database, so anything not
  // named here falls through as its raw key rather than as a blank. A purpose
  // or scope added later then shows up looking unfinished, which is the right
  // signal — where an empty cell would just look like no data.
  var PURPOSE_FA = {
    otp: "ورود مشتری", owner_login: "ورود کافه‌دار",
    otp_ip: "ورود مشتری (به‌ازای IP)",
  };
  var SCOPE_FA = { staff: "صندوق", owner: "کافه‌دار" };
  function label(map, k) { return map[k] || k; }

  function showGate(msg) {
    $("gate").hidden = false;
    $("app").hidden = true;
    if (msg) $("gErr").textContent = msg;
  }
  function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
  }

  $("gateForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    $("gErr").textContent = "";
    $("gBtn").disabled = true;
    // The superuser collection's own password endpoint — the same credential
    // as the PocketBase dashboard at /_/.
    fetch(API + "/api/collections/_superusers/auth-with-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: $("gEmail").value.trim(), password: $("gPass").value }),
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      $("gBtn").disabled = false;
      if (!res.ok || !res.d.token) {
        $("gErr").textContent = "ایمیل یا گذرواژه درست نیست.";
        return;
      }
      token = res.d.token;
      try { localStorage.setItem(KEY, token); } catch (e) {}
      $("gPass").value = "";
      showApp();
      boot();
    }).catch(function () {
      $("gBtn").disabled = false;
      $("gErr").textContent = "ارتباط با سرور برقرار نشد.";
    });
  });

  $("signOut").addEventListener("click", function () {
    token = "";
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  });

  function api(path, body) {
    return fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { Authorization: token, "Content-Type": "application/json" }
        : { Authorization: token },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        // The token is dead, not merely unlucky — a network failure throws
        // instead of answering, so this really is a rejection.
        token = "";
        try { localStorage.removeItem(KEY); } catch (e) {}
        showGate("نشست منقضی شده؛ دوباره وارد شوید.");
        throw new Error("unauthorized");
      }
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d && d.error ? d.error : "خطا");
        return d;
      });
    });
  }

  // ---- nav --------------------------------------------------------------
  var TITLES = {
    money: "پول", subs: "اشتراک‌ها", cafes: "کافه‌ها",
    growth: "رشد", ops: "سلامت سیستم", settings: "تنظیمات",
  };
  $("nav").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-sec]");
    if (!b) return;
    var sec = b.getAttribute("data-sec");
    Array.prototype.forEach.call($("nav").children, function (x) { x.classList.toggle("on", x === b); });
    ["money", "subs", "cafes", "growth", "ops", "settings"].forEach(function (s) {
      $("sec-" + s).classList.toggle("on", s === sec);
    });
    $("secTitle").textContent = TITLES[sec];
    location.hash = sec;
    if (sec === "settings" && !settingsLoaded) loadSettings();
  });

  // ---- rendering helpers ------------------------------------------------
  function tile(k, v, note, tone) {
    return '<div class="tile' + (tone ? " tile--" + tone : "") + '">' +
      '<div class="tile__k">' + esc(k) + "</div>" +
      '<div class="tile__v num ltr">' + v + "</div>" +
      '<div class="tile__n">' + (note || "") + "</div></div>";
  }

  function table(head, rows, empty) {
    if (!rows.length) return '<p class="t-empty">' + esc(empty || "چیزی برای نشان دادن نیست.") + "</p>";
    return '<div class="t-wrap"><table><thead><tr>' +
      head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
  }

  function pill(status) {
    return '<span class="pill pill--' + esc(status) + '">' + esc(STATUS_FA[status] || status) + "</span>";
  }

  // ---- the report -------------------------------------------------------
  var D = null;

  function paintMoney() {
    var m = D.money;
    $("moneyTiles").innerHTML = [
      tile("درآمد ماهانهٔ تکرارشو (MRR)", toman(m.mrr),
        "تومان · سهم هر طرح سالانه تقسیم بر 12"),
      tile("این ماه", toman(m.this_month),
        "تومان · ماه قبل " + fmt(m.last_month),
        m.this_month >= m.last_month ? "good" : "warn"),
      tile("کل دریافتی تا امروز", toman(m.collected),
        "تومان · " + fmt(m.paid_count) + " پرداخت موفق"),
      tile("میانگین درآمد هر کافه", toman(m.arpc), "تومان · بر پایهٔ کافه‌های فعال"),
    ].join("");

    var g = [
      tile("تلاش پرداخت", fmt(m.attempts), "شامل نیمه‌کاره‌ها"),
      tile("موفق", fmt(m.paid_count), m.gateway_rate + "٪ از تلاش‌ها", "good"),
      tile("ناموفق یا لغو", fmt(m.failed), "", m.failed ? "warn" : ""),
      tile("در جریان", fmt(m.pending), "باز شده و تمام نشده"),
    ].join("");
    $("gateway").innerHTML = '<div class="tiles" style="margin:0">' + g + "</div>" +
      '<p class="derived">در خطر: <b>' + fmt(m.at_risk) + " تومان</b> روی " +
      fmt(D.subs.status.past_due || 0) + " کافه در مهلت · تمدید تا 7 روز آینده: <b>" +
      fmt(m.renew_7) + "</b> کافه · تا 30 روز: <b>" + fmt(m.renew_30) + "</b></p>";

    $("failNotes").innerHTML = table(["دلیل", "تعداد"],
      m.fail_notes.map(function (f) {
        return "<tr><td>" + esc(f.note) + "</td><td>" + n(fmt(f.count)) + "</td></tr>";
      }), "هیچ پرداخت ناموفقی ثبت نشده.");

    var byId = {};
    D.cafes.rows.forEach(function (r) { byId[r.id] = r.name; });
    $("recentPays").innerHTML = table(["کافه", "طرح", "مبلغ", "تاریخ", "شماره پیگیری", "فاکتور"],
      m.recent.map(function (p) {
        return "<tr><td>" + esc(byId[p.cafe] || "—") + "</td>" +
          "<td>" + esc(PLAN_FA[p.plan] || p.plan) + "</td>" +
          "<td>" + n(fmt(p.amount)) + "</td>" +
          "<td>" + esc(faDate(p.at)) + "</td>" +
          '<td class="mono">' + n(p.ref || "—") + "</td>" +
          "<td>" + n(p.invoice > 0 ? p.invoice : "—") + "</td></tr>";
      }), "هنوز پرداخت موفقی ثبت نشده.");
  }

  function paintSubs() {
    var s = D.subs;
    $("statusTiles").innerHTML = ["active", "trialing", "past_due", "expired", "cancelled"]
      .map(function (k) {
        var tone = k === "active" ? "good" : k === "past_due" ? "warn" : k === "expired" ? "bad" : "";
        return tile(STATUS_FA[k], fmt(s.status[k] || 0), "", tone);
      }).join("");

    $("subTiles").innerHTML = [
      tile("آزمایشی‌های رو به پایان", fmt(s.trial_end_7), "تا 7 روز آینده — فرصت تبدیل",
        s.trial_end_7 ? "warn" : ""),
      tile("ریزش این ماه", fmt(s.churned_month),
        fmt(s.churned_toman) + " تومان از درآمد ماهانه", s.churned_month ? "bad" : ""),
      tile("ترکیب طرح‌ها", fmt(s.plans.monthly || 0) + " / " + fmt(s.plans.yearly || 0),
        "ماهانه / سالانه"),
    ].join("");

    $("graceList").innerHTML = table(["کافه", "مدیر", "تلفن", "ایمیل", "روز چندم", "روز باقی", "پایان دوره"],
      s.grace.map(function (gr) {
        return "<tr><td>" + esc(gr.cafe) + "</td>" +
          "<td>" + esc(gr.owner || "—") + "</td>" +
          '<td class="mono">' + n(gr.phone || "—") + "</td>" +
          "<td>" + n(gr.email || "—") + "</td>" +
          "<td>" + n(gr.day) + "</td>" +
          "<td>" + n(gr.left) + "</td>" +
          "<td>" + esc(faDate(gr.ended)) + "</td></tr>";
      }), "هیچ کافه‌ای در مهلت نیست.");
  }

  // ---- the café table, sortable ----------------------------------------
  var COLS = [
    { k: "name", label: "کافه", cell: function (r) { return esc(r.name || "—"); } },
    { k: "owner", label: "مدیر", cell: function (r) { return esc(r.owner || "—"); } },
    { k: "phone", label: "تلفن", cell: function (r) { return '<span class="mono">' + n(r.phone || "—") + "</span>"; } },
    { k: "status", label: "وضعیت", cell: function (r) { return pill(r.status); } },
    { k: "plan", label: "طرح", cell: function (r) { return esc(PLAN_FA[r.plan] || "—"); } },
    { k: "until", label: "تا تاریخ", cell: function (r) {
        if (!r.until) return "—";
        var d = daysFromNow(r.until);
        return esc(faDate(r.until)) + ' <span style="color:#9a9a9a">(' + n(d) + " روز)</span>";
      } },
    { k: "joined", label: "عضویت", cell: function (r) { return esc(faDate(r.joined)); } },
    { k: "customers", label: "مشتری", cell: function (r) { return n(fmt(r.customers)); } },
    { k: "customers30", label: "تازه (30 روز)", cell: function (r) { return n(fmt(r.customers30)); } },
    { k: "stamps30", label: "مهر (30 روز)", cell: function (r) { return n(fmt(r.stamps30)); } },
    { k: "last_stamp", label: "آخرین مهر", cell: function (r) {
        if (!r.last_stamp) return '<span class="flag flag--cold">هیچ‌وقت</span>';
        var d = daysFromNow(r.last_stamp);
        return esc(faDate(r.last_stamp)) + ' <span style="color:#9a9a9a">(' + n(-d) + " روز پیش)</span>";
      } },
    { k: "_flag", label: "نشانه", sort: false, cell: function (r) {
        if (!r.activated) return '<span class="flag flag--cold">فعال نشده</span>';
        var paying = r.status === "active" || r.status === "past_due";
        if (paying && r.stamps14 === 0) return '<span class="flag flag--idle">پرداخت بی‌استفاده</span>';
        return "";
      } },
  ];
  var sortKey = "stamps30", sortDir = -1;

  function paintCafes() {
    var c = D.cafes;
    $("cafeTiles").innerHTML = [
      tile("کافه‌ها", fmt(c.total), "روی پلتفرم"),
      tile("پرداخت بی‌استفاده", fmt(c.idle_but_paying),
        "اشتراک فعال، 14 روز بدون مهر — ریزش پیش از ریزش", c.idle_but_paying ? "warn" : ""),
      tile("هیچ‌وقت فعال نشده", fmt(c.never_activated),
        "ثبت‌نام کرده و یک مهر هم نداده", c.never_activated ? "bad" : ""),
    ].join("");

    var rows = c.rows.slice().sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (typeof x === "string" || typeof y === "string") {
        return String(x || "").localeCompare(String(y || ""), "fa") * sortDir;
      }
      return ((Number(y) || 0) - (Number(x) || 0)) * (sortDir === -1 ? 1 : -1);
    });

    var head = COLS.map(function (col) {
      if (col.sort === false) return "<th>" + esc(col.label) + "</th>";
      var caret = col.k === sortKey ? (sortDir === -1 ? " ▾" : " ▴") : "";
      return '<th class="sortable" data-k="' + col.k + '">' + esc(col.label) +
        '<span class="caret">' + caret + "</span></th>";
    }).join("");

    var body = rows.map(function (r) {
      return "<tr>" + COLS.map(function (col) { return "<td>" + col.cell(r) + "</td>"; }).join("") + "</tr>";
    }).join("");

    $("cafeTable").innerHTML = rows.length
      ? '<div class="t-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>"
      : '<p class="t-empty">هیچ کافه‌ای ثبت نشده.</p>';
  }

  $("cafeTable").addEventListener("click", function (ev) {
    var th = ev.target.closest("th.sortable");
    if (!th) return;
    var k = th.getAttribute("data-k");
    if (k === sortKey) sortDir = -sortDir;
    else { sortKey = k; sortDir = -1; }
    paintCafes();
  });

  // ---- the chart --------------------------------------------------------
  // A bar per Tehran day, 60 of them. Hand-rolled SVG for the same reason the
  // owner panel's charts are: the CSP allows no external script, so a chart
  // library would have to be vendored to draw sixty rectangles.
  //
  // NO PERSIAN INSIDE THE SVG. The figure is direction:ltr because its axis is
  // time, and Persian text placed in an LTR SVG needs a bidi isolate per label
  // to render in the right order — an easy thing to get wrong and impossible
  // to spot by reading transcribed output. So the axis carries only dates and
  // numbers, and every word belongs to the HTML legend beside it.
  function chart(el, series, key, cls) {
    var W = 1000, H = 190, padL = 42, padR = 8, padT = 12, padB = 22;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = 0;
    series.forEach(function (d) { if (d[key] > max) max = d[key]; });
    var top = Math.max(1, max);
    var bw = iw / series.length;

    var bars = series.map(function (d, i) {
      var h = (d[key] / top) * ih;
      var x = padL + i * bw + bw * 0.14;
      return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + (padT + ih - h).toFixed(1) +
        '" width="' + (bw * 0.72).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) +
        '" rx="1"><title>' + d.date + " · " + d[key] + "</title></rect>";
    }).join("");

    // Three gridlines and their values; more would be noise at this height.
    var grid = [0, 0.5, 1].map(function (f) {
      var y = padT + ih - f * ih;
      return '<line class="axis" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) +
        '" y2="' + y.toFixed(1) + '" opacity="' + (f === 0 ? 1 : 0.45) + '"/>' +
        '<text class="axis-t" x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) +
        '" text-anchor="end">' + Math.round(f * top) + "</text>";
    }).join("");

    // A date every ten days, as MM-DD — short enough not to collide at this
    // width, and unambiguous without a year on a 60-day axis.
    var labels = series.map(function (d, i) {
      if (i % 10 !== 0) return "";
      var x = padL + i * bw + bw / 2;
      return '<text class="axis-t" x="' + x.toFixed(1) + '" y="' + (H - 6) +
        '" text-anchor="middle">' + d.date.slice(5) + "</text>";
    }).join("");

    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="نمودار 60 روز گذشته">' +
      grid + bars + labels + "</svg>";
  }

  function paintGrowth() {
    var g = D.growth;
    $("growthTiles").innerHTML = [
      tile("مشتری‌ها", fmt(g.customers), fmt(g.memberships) + " کارت در کافه‌های مختلف"),
      tile("مهرهای ثبت‌شده", fmt(g.stamps), fmt(g.cards_completed) + " کارت کامل شده"),
      tile("جایزه‌های صادرشده", fmt(g.rewards_issued),
        fmt(g.rewards_active) + " فعال · " + fmt(g.rewards_expired) + " منقضی"),
      tile("نرخ استفاده از جایزه", g.redemption_rate + "٪",
        fmt(g.rewards_redeemed) + " جایزه استفاده شده"),
    ].join("");
    chart($("chartStamps"), g.timeline, "stamps", "bar");
    chart($("chartCustomers"), g.timeline, "customers", "bar--dim");
  }

  function paintOps() {
    var o = D.ops;
    $("opsTiles").innerHTML = [
      tile("پیامک — پنجرهٔ فعلی", fmt(o.sms_window), "مجموع ارسال‌های پنجرهٔ باز هر شماره"),
      tile("ایمیل در صف", fmt(o.mail_unsent),
        fmt(o.mail_retrying) + " بار دوم به بعد", o.mail_unsent ? "warn" : "good"),
      tile("دستگاه‌های اعلان", fmt(o.push_by_scope.reduce(function (a, x) { return a + x.count; }, 0)), ""),
      tile("درخواست کد ورود — 7 روز", fmt(o.otp_7d), "ردیف‌های otp_codes در 7 روز گذشته"),
    ].join("");

    $("smsTable").innerHTML = table(["منظور", "ارسال"],
      o.sms_by_purpose.map(function (s) {
        return "<tr><td>" + esc(label(PURPOSE_FA, s.purpose)) + "</td><td>" + n(fmt(s.sends)) + "</td></tr>";
      }), "هیچ ارسالی در پنجرهٔ فعلی نیست.");

    $("pushTable").innerHTML = table(["نقش", "دستگاه"],
      o.push_by_scope.map(function (p) {
        return "<tr><td>" + esc(label(SCOPE_FA, p.scope)) + "</td><td>" + n(fmt(p.count)) + "</td></tr>";
      }), "هیچ دستگاهی ثبت نشده.");

    $("mailBox").innerHTML = o.mail_unsent
      ? '<p class="derived"><b>' + fmt(o.mail_unsent) + "</b> ایمیل ارسال نشده" +
        (o.mail_last_error ? "<br>آخرین خطا: <span class=\"mono ltr\">" + esc(o.mail_last_error) + "</span>" : "") + "</p>"
      : '<p class="derived">صف خالی است؛ همهٔ ایمیل‌ها ارسال شده‌اند.</p>';
  }

  function paintAll() {
    $("when").textContent = "آخرین خوانش: " + faDate(D.generated) + "، ساعت " + faTime(D.generated);
    paintMoney(); paintSubs(); paintCafes(); paintGrowth(); paintOps();
  }

  function boot() {
    $("when").textContent = "در حال خواندن…";
    api("/hq/stats").then(function (d) {
      D = d;
      paintAll();
      // Deep link: /hq#cafes opens that section directly.
      var h = (location.hash || "").replace("#", "");
      if (h && TITLES[h]) {
        var b = $("nav").querySelector('button[data-sec="' + h + '"]');
        if (b) b.click();
      }
    }).catch(function (err) {
      if (String(err.message) === "unauthorized") return;
      $("when").textContent = "خواندن آمار ممکن نشد: " + err.message;
    });
  }

  $("reload").addEventListener("click", boot);

  // =====================================================================
  // settings: price, and the letters
  // =====================================================================
  var settingsLoaded = false;
  var LETTERS = [], draft = {}, saved = {}, current = "";

  function loadSettings() {
    api("/hq/settings").then(function (d) {
      settingsLoaded = true;
      LETTERS = d.letters || [];
      saved = d.mail_copy || {};
      draft = {};
      for (var k in saved) draft[k] = saved[k];
      $("pM").value = d.pricing.monthly;
      $("pY").value = d.pricing.yearly;
      paintDerived();
      paintLetterList();
      pickLetter(LETTERS.length ? LETTERS[0].id : "");
    }).catch(function (err) {
      if (String(err.message) === "unauthorized") return;
      $("priceMsg").innerHTML = '<span class="no">' + esc(err.message) + "</span>";
    });
  }

  // The same three derivations the marketing page and the buy screen make, so
  // a price can be judged here before it is saved anywhere.
  function paintDerived() {
    var m = Number($("pM").value), y = Number($("pY").value);
    if (!(m > 0) || !(y > 0)) { $("priceDerived").textContent = ""; return; }
    var free = Math.round((m * 12 - y) / m);
    var perDayM = Math.round(m / 30 / 1000) * 1000;
    var perDayY = Math.round(y / 365 / 1000) * 1000;
    $("priceDerived").innerHTML =
      "سالانه در برابر 12 ماه: <b>" + fmt(y) + "</b> به‌جای <b>" + fmt(m * 12) + "</b> تومان، یعنی <b>" +
      free + " ماه رایگان</b>." +
      "<br>روزی حدود <b>" + fmt(perDayM) + "</b> تومان با طرح ماهانه، و <b>" + fmt(perDayY) +
      "</b> تومان با طرح سالانه." +
      (y >= m * 12 ? '<br><span style="color:#b02020">قیمت سالانه باید کمتر از 12 برابر ماهانه باشد، وگرنه «ماه رایگان» معنا ندارد.</span>' : "");
  }
  $("pM").addEventListener("input", paintDerived);
  $("pY").addEventListener("input", paintDerived);

  $("priceSave").addEventListener("click", function () {
    $("priceMsg").textContent = "";
    $("priceSave").disabled = true;
    api("/hq/settings", { pricing: { monthly: Number($("pM").value), yearly: Number($("pY").value) } })
      .then(function (d) {
        $("priceSave").disabled = false;
        $("pM").value = d.pricing.monthly;
        $("pY").value = d.pricing.yearly;
        paintDerived();
        $("priceMsg").innerHTML = '<span class="ok">ذخیره شد.</span>';
        // The preview quotes the price, so it is now stale.
        if (current === "receipt") preview();
      }).catch(function (err) {
        $("priceSave").disabled = false;
        if (String(err.message) === "unauthorized") return;
        $("priceMsg").innerHTML = '<span class="no">' + esc(err.message) + "</span>";
      });
  });

  function letterById(id) {
    for (var i = 0; i < LETTERS.length; i++) if (LETTERS[i].id === id) return LETTERS[i];
    return null;
  }

  // How many slots of a letter differ from their default. Shown as a dot in
  // the list, so it is visible which letters have been reworded without
  // opening each one.
  function changedCount(L) {
    var c = 0;
    L.slots.forEach(function (s) {
      var v = draft[L.id + "." + s.k];
      if (typeof v === "string" && v.trim() && v.trim() !== s.def) c++;
    });
    return c;
  }

  function paintLetterList() {
    $("letterList").innerHTML = LETTERS.map(function (L) {
      var c = changedCount(L);
      return '<button data-id="' + L.id + '"' + (L.id === current ? ' class="on"' : "") + ">" +
        (c ? '<span class="dot"></span>' : "") + esc(L.label) + "</button>";
    }).join("");
  }

  $("letterList").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-id]");
    if (b) pickLetter(b.getAttribute("data-id"));
  });

  function pickLetter(id) {
    current = id;
    var L = letterById(id);
    paintLetterList();
    if (!L) { $("slots").innerHTML = ""; return; }

    $("letterVars").innerHTML = "جای‌گذاری‌های این نامه: " +
      L.vars.map(function (v) { return "<code>{" + esc(v) + "}</code>"; }).join("");

    $("slots").innerHTML = L.slots.map(function (s) {
      var key = L.id + "." + s.k;
      var val = typeof draft[key] === "string" ? draft[key] : "";
      var changed = val.trim() && val.trim() !== s.def;
      return '<div class="slot' + (changed ? " slot--changed" : "") + '" data-key="' + key + '">' +
        // The reset link is always in the markup and shown by CSS only while
        // the slot differs from its default. Rendering it conditionally meant
        // it did not appear until the whole letter was redrawn, so a field you
        // had just edited offered no way back to its default.
        '<div class="slot__h"><span>' + esc(s.label) + "</span>" +
        '<button type="button" data-reset="' + key + '">بازگردانی به پیش‌فرض</button>' +
        "</div><textarea rows=\"2\" placeholder=\"" + esc(s.def) + "\">" + esc(val) + "</textarea></div>";
    }).join("");

    preview();
  }

  var previewTimer = null;
  $("slots").addEventListener("input", function (ev) {
    if (ev.target.tagName !== "TEXTAREA") return;
    var slot = ev.target.closest(".slot");
    var key = slot.getAttribute("data-key");
    var L = letterById(current);
    var def = "";
    L.slots.forEach(function (s) { if (L.id + "." + s.k === key) def = s.def; });
    draft[key] = ev.target.value;
    slot.classList.toggle("slot--changed", !!(ev.target.value.trim() && ev.target.value.trim() !== def));
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { preview(); paintLetterList(); }, 420);
  });

  $("slots").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-reset]");
    if (!b) return;
    delete draft[b.getAttribute("data-reset")];
    pickLetter(current);
    paintLetterList();
  });

  $("copyReset").addEventListener("click", function () {
    var L = letterById(current);
    if (!L) return;
    L.slots.forEach(function (s) { delete draft[L.id + "." + s.k]; });
    pickLetter(current);
  });

  // The preview is rendered by the server, by submail.js — the same file the
  // cron sends from — so what is read here cannot flatter copy the real
  // sender would break.
  function preview() {
    if (!current) return;
    api("/hq/mail/preview", { letter: current, mail_copy: draft }).then(function (d) {
      $("prevSubject").innerHTML = "<b>موضوع:</b> " + esc(d.subject);
      // Written into an about:blank iframe rather than set as srcdoc: these
      // are whole HTML documents with their own <body> background, and the
      // CSP governs frame sources. A same-origin blank frame is scriptable
      // from here and inherits that policy, which the inline styles in the
      // email are allowed under ('unsafe-inline' for style only).
      var f = $("prevFrame");
      try {
        var doc = f.contentDocument;
        doc.open(); doc.write(d.body); doc.close();
      } catch (e) {
        $("prevSubject").innerHTML += ' <span class="no">پیش‌نمایش نمایش داده نشد.</span>';
      }
    }).catch(function (err) {
      if (String(err.message) === "unauthorized") return;
      $("prevSubject").innerHTML = '<span class="no">' + esc(err.message) + "</span>";
    });
  }

  $("copySave").addEventListener("click", function () {
    $("copyMsg").textContent = "";
    $("copySave").disabled = true;
    api("/hq/settings", { mail_copy: draft }).then(function (d) {
      $("copySave").disabled = false;
      saved = d.mail_copy || {};
      draft = {};
      for (var k in saved) draft[k] = saved[k];
      pickLetter(current);
      $("copyMsg").innerHTML = '<span class="ok">ذخیره شد؛ از همین حالا نامه‌ها با این متن می‌روند.</span>';
    }).catch(function (err) {
      $("copySave").disabled = false;
      if (String(err.message) === "unauthorized") return;
      $("copyMsg").innerHTML = '<span class="no">' + esc(err.message) + "</span>";
    });
  });

  // ---- start ------------------------------------------------------------
  if (token) { showApp(); boot(); } else { showGate(); }
}());
