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

  var btns   = { scan: document.getElementById("tabScan"), two: document.getElementById("tabTwo") };
  var panels = { scan: document.getElementById("panelScan"), two: document.getElementById("panelTwo") };
  var INDEX  = { scan: 0, two: 1 };

  function setStaffTab(name) {
    if (!btns[name] || !panels[name]) return;
    bar.style.setProperty("--ti", INDEX[name]);
    for (var k in btns)   btns[k].classList.toggle("is-active", k === name);
    for (var p in panels) panels[p].hidden = p !== name;
    // keep the hash in step so a reload lands where staff left off, the way
    // /owner#analytics does — a till that reloads mid-shift should not jump
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
  }

  btns.scan.addEventListener("click", function () { setStaffTab("scan"); });
  btns.two.addEventListener("click",  function () { setStaffTab("two"); });

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
