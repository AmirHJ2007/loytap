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

  // >>> THE PAYLOAD <<<
  // What the code encodes. Still a placeholder — replace this one string
  // with the real value and nothing else here changes.
  //
  // If it ends up being the café's tap link (the same thing the NFC tag
  // carries, "https://reloy.ir/?t=<tag code>"), note that staff cannot read
  // nfc_tags — that collection is locked to superusers — so the tag code has
  // to arrive from a server route, the way /owner/cafe feeds the owner panel.
  // Anything self-contained — a URL, a code, plain text — needs no backend.
  var QR_PAYLOAD = "https://reloy.ir";

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
          // r=0.5, NOT the 0.42 app.js uses. At 0.42 each dot stops short of
          // its module edge, leaving a pale gap on all four sides, and a
          // decoder reading this off a screen fails on it: measured here with
          // jsQR — the same reader the scan tab uses — the identical payload
          // decoded as solid squares and at r=0.5, and failed at r=0.42 unless
          // ~4px of blur was added to bridge the gaps. A camera's own softness
          // is what rescues it in practice, which is a thin thing to rely on
          // for a code a customer is holding a phone up to. At 0.5 the dots
          // meet exactly: same rounded look, nothing left to bridge.
          dots += '<circle cx="' + (c + q + 0.5).toFixed(2) + '" cy="' + (r + q + 0.5).toFixed(2) + '" r="0.5"/>';
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

  function draw() {
    try {
      if (typeof qrcode !== "function") throw new Error("qrcode.js did not load");
      // #171717, not pure black: it is the app's ink everywhere else, and the
      // contrast against white is still ~17:1 — far past anything a camera needs
      holder.innerHTML = qrSvgDotted(QR_PAYLOAD, "#171717");
      holder.classList.remove("is-error");
    } catch (err) {
      // never leave a blank white square that a customer keeps aiming at
      holder.classList.add("is-error");
      holder.textContent = (typeof t === "function" ? t("STAFF_QR_ERROR") : "Could not build the code.");
    }
  }

  // the café name the staff session already carries, so the customer can see
  // they are scanning the right shop's code
  try {
    var shop = localStorage.getItem("loytap_cafe");
    if (shop) document.getElementById("qrShop").textContent = shop;
  } catch (e) {}

  // no language listener needed: i18n.js's setLang() reloads the page, so a
  // switch redraws this from scratch
  draw();
})();
