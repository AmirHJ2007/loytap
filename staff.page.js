// ===================================================================
// Reloy — staff page chrome: café name in the header + sign-out.
// Moved out of staff.html verbatim so the page needs no inline script.
// ===================================================================
    try {
      var cn = localStorage.getItem("loytap_cafe");
      if (cn) document.getElementById("cafeName").textContent = cn;
    } catch (e) {}
    document.getElementById("signoutBtn").addEventListener("click", function () {
      ["loytap_token","loytap_staff","loytap_owner","loytap_role","loytap_signed_in","loytap_name","loytap_cafe"]
        .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      location.replace("/business/signin");
    });

// ===================================================================
// Bottom tab bar — same sliding-indicator pattern as the owner panel
// (owner.page.js setOwnerTab) and the customer wallet (app.js setTab):
// one --ti index on the bar moves the pill, each tab maps to one .panel.
// ===================================================================
(function () {
  var bar = document.getElementById("tabbar");
  if (!bar) return;

  // QR sits at index 0 (first in the bar), scan at 1 — but scan is still the
  // tab this page opens on, below. A position is not a default: staff come
  // here to scan, and the owner panel lands on Card at index 1 for the same
  // reason. Change the fallback in setStaffTab's initial call to move it.
  var btns   = { qr: document.getElementById("tabQr"), scan: document.getElementById("tabScan") };
  var panels = { qr: document.getElementById("panelQr"), scan: document.getElementById("panelScan") };
  var INDEX  = { qr: 0, scan: 1 };

  function setStaffTab(name) {
    if (!btns[name] || !panels[name]) return;
    bar.style.setProperty("--ti", INDEX[name]);
    for (var k in btns)   btns[k].classList.toggle("is-active", k === name);
    for (var p in panels) panels[p].hidden = p !== name;
    // keep the hash in step so a reload lands where staff left off, the way
    // /owner#analytics does — a till that reloads mid-shift should not jump
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
  }

  btns.qr.addEventListener("click",   function () { setStaffTab("qr"); });
  btns.scan.addEventListener("click", function () { setStaffTab("scan"); });

  var initial = location.hash.slice(1);
  setStaffTab(INDEX.hasOwnProperty(initial) ? initial : "scan");

  // ---- pending-request badge -------------------------------------------
  // staff.js owns #requestQueue and pushes/removes cards in it over a
  // realtime subscription. Rather than reach into that file's internals,
  // watch the element: any change to its children re-counts. That keeps the
  // badge correct for every path that can alter the queue — a new request, an
  // approval, a cancel, the startup backfill — without staff.js needing to
  // know a tab bar exists.
  var queue = document.getElementById("requestQueue");
  var badge = document.getElementById("scanBadge");
  if (!queue || !badge || typeof MutationObserver === "undefined") return;

  function sync() {
    var n = queue.children.length;
    badge.textContent = n > 9 ? "9+" : String(n);
    badge.hidden = n === 0;
  }
  new MutationObserver(sync).observe(queue, { childList: true });
  sync();
})();

// ===================================================================
// QR code tab — draws the code a customer points their phone at.
// ===================================================================
(function () {
  var holder = document.getElementById("qrCode");
  if (!holder) return;

  // The code carries the café's TAP LINK — the same URL written to its
  // physical NFC tag. A customer whose phone will not tap scans this instead
  // and lands in exactly the same place: a pending stamp request for this
  // café, which staff approve from the other tab.
  //
  // It comes from GET /staff/cafe rather than being built here, because the
  // tag code is not something this page is allowed to know on its own —
  // nfc_tags is superuser-only and stays that way; that route reads it
  // server-side and hands back the finished URL. Same origin rule as the rest
  // of the page (staff.js line 10) so an :8000 dev front end still reaches the
  // :8090 API.
  var API = location.port === "8000"
    ? location.protocol + "//" + location.hostname + ":8090"
    : location.origin;

  // Lifted from app.js's qrSvgDotted so the code matches the one the customer
  // wallet already shows: round dots for data, rounded squares for the three
  // finder eyes. Copied rather than shared because this page deliberately does
  // not load app.js — it has no wallet in it.
  //
  // Error correction stays at "H", the highest level: a till screen gets
  // glare, fingerprints and knocked at an angle, and H tolerates roughly 30%
  // of the code being unreadable. It costs a denser grid, which the plate has
  // room for.
  function qrSvgDotted(text, color) {
    var qr = qrcode(0, "H");
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var q = 2; // quiet zone, in modules — cameras need the margin to lock on
    var size = n + q * 2;
    var inFinder = function (r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    };
    var dots = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c) && !inFinder(r, c)) {
          // r=0.55, matching app.js — see the measurements in its qrSvgDotted.
          // Short version: 0.42 leaves a gap on every side and does not decode
          // without blur; 0.50 only touches in the maths and antialiasing eats
          // the join at smaller render sizes; 0.55 overlaps enough to hold.
          dots += '<circle cx="' + (c + q + 0.5).toFixed(2) + '" cy="' + (r + q + 0.5).toFixed(2) + '" r="0.55"/>';
        }
      }
    }
    var eye = function (r, c) {
      var x = c + q, y = r + q;
      return '<rect x="' + (x + 0.5).toFixed(2) + '" y="' + (y + 0.5).toFixed(2) + '" width="6" height="6" rx="2" fill="none" stroke="' + color + '" stroke-width="1"/>'
           + '<rect x="' + (x + 2).toFixed(2) + '" y="' + (y + 2).toFixed(2) + '" width="3" height="3" rx="1"/>';
    };
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" fill="' + color + '" shape-rendering="geometricPrecision" aria-hidden="true">'
         + dots + eye(0, 0) + eye(0, n - 7) + eye(n - 7, 0) + '</svg>';
  }

  function fail() {
    // never leave a blank white plate that a customer keeps aiming a phone at
    holder.classList.add("is-error");
    holder.textContent = (typeof t === "function" ? t("STAFF_QR_ERROR") : "Could not build the code.");
  }

  function draw(payload) {
    try {
      if (typeof qrcode !== "function") throw new Error("qrcode.js did not load");
      if (!payload) throw new Error("no payload");
      // #171717, not pure black: it is the app's ink everywhere else, and the
      // contrast against white is still ~17:1 — far past anything a camera needs
      holder.innerHTML = qrSvgDotted(payload, "#171717");
      holder.classList.remove("is-error");
    } catch (err) {
      fail();
    }
  }

  function load() {
    var token = "";
    try { token = localStorage.getItem("loytap_token") || ""; } catch (e) {}
    fetch(API + "/staff/cafe", { headers: { Authorization: token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.tap_url) { fail(); return; }
        draw(d.tap_url);
        // the café name the route returns is authoritative; the localStorage
        // copy below is only the instant-paint fallback
        if (d.cafe_name) document.getElementById("qrShop").textContent = d.cafe_name;
      })
      .catch(fail);
  }

  // the café name the staff session already carries, so the customer can see
  // they are scanning the right shop's code
  try {
    var shop = localStorage.getItem("loytap_cafe");
    if (shop) document.getElementById("qrShop").textContent = shop;
  } catch (e) {}

  // no language listener needed: i18n.js's setLang() reloads the page, so a
  // switch redraws this from scratch
  load();
})();
