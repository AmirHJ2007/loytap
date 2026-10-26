// ===================================================================
// Reloy — owner dashboard: café settings, rewards, staff code, print.
// Moved out of owner.html verbatim so the page needs no inline script.
// ===================================================================
    applyI18n();
    const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
    let token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();
    const $ = (id) => document.getElementById(id);

    // Owner tokens are static (see owner.pb.js), so PocketBase's core
    // auth-refresh can't extend one — it just hands back the same unchanged
    // expiry. This mirrors the customer wallet's silent refresh-on-load
    // (app.js's init()) but calls our own /owner/session/refresh instead,
    // which mints a fresh 72h token. Runs once per page load, same as the
    // customer wallet: an owner who opens the dashboard at least once every
    // 72h never sees the wall-clock expiry.
    (async function refreshOwnerSession() {
      try {
        const r = await fetch(API + "/owner/session/refresh", { method: "POST", headers: { Authorization: token } });
        if (r.ok) {
          const d = await r.json();
          token = d.token;
          try { localStorage.setItem("loytap_token", token); } catch (e) {}
          return;
        }
      } catch (e) {
        // A network failure is NOT the server rejecting the token: a bad token
        // comes back as a 401/403 response, never a throw. Wiping the session
        // here signed people out whenever the request simply could not be made
        // — worst of all on a home-screen launch, where the page can load
        // before the connection is up. Keep the session, carry on with the
        // token we have, and let a genuine problem surface on the next call.
        return;
      }
      // the server actually turned this token down — it is dead, not merely
      // unreachable, so clear it rather than loop on a session that cannot work
      ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"]
        .forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      location.replace("/business/signin");
    })();
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // Transient message. The wallet's copy lives in app.js with its CSS in
    // styles.css, and this page loads neither — so the two calls below
    // (payment failed, and the result of coming back from the gateway) were
    // throwing a ReferenceError, which meant an owner who had just paid was
    // returned to a dashboard that said nothing at all about it. The .toast
    // rule is reproduced in owner.html's own <style>.
    let toastTimer = null;
    function toast(msg) {
      let el = document.getElementById("toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "toast";
        el.className = "toast";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.classList.add("is-on");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("is-on"), 3600);
    }

    function unitWord(unit, amt) {
      const key = { day: amt > 1 ? "OWNER_UNIT_DAYS" : "OWNER_UNIT_DAY",
        week: amt > 1 ? "OWNER_UNIT_WEEKS" : "OWNER_UNIT_WEEK",
        month: amt > 1 ? "OWNER_UNIT_MONTHS" : "OWNER_UNIT_MONTH" }[unit];
      return key ? t(key) : unit;
    }

    let cafeId = "";

    async function loadCafe() {
      let sub = null;
      try {
        const r = await fetch(API + "/owner/cafe", { headers: { Authorization: token } });
        const d = await r.json();
        if (r.ok) {
          cafeId = d.id || "";
          $("staffCode").textContent = d.staff_code || "—";
          $("setOwnerName").textContent = d.name || t("OWNER_NAME_FALLBACK");
          $("setOwnerPhone").textContent = d.phone || "—";
          $("setOwnerEmail").textContent = d.email || "—";
          $("setCafeName").textContent = d.cafe_name || t("OWNER_CAFE_FALLBACK");
          paintSubscription(d.subscription);
          stampsVal = d.stamps_required || 8; renderStamps();
          $("fMinPurchase").value = d.min_purchase ? d.min_purchase : "";
          refreshOwnPreviewMin(d.min_purchase);
          showLogo(d.collection_id, d.logo);
          $("fCafeName").value = d.cafe_name || "";
          refreshOwnPreviewName();
          setIdentType(d.tagline || "Cafe");
          savedCafeName = d.cafe_name || ""; savedTagline = d.tagline || "Cafe";
          savedAccent = d.accent || "#171717";
          paintOwnPreviewAccent(savedAccent);   // the Card tab preview wears it
          savedPattern = (window.CardPatterns && d.pattern) ? window.CardPatterns.normalize(d.pattern) : null;
          patState = savedPattern;
          if (savedPattern) paintPreviewPattern();   // the Card tab preview shows it too
          showIdentitySummary();
          try { localStorage.setItem("loytap_cafe", d.cafe_name || ""); } catch (e) {}
          sub = d.subscription || null;
        }
      } catch (e) {}

      // Back from the gateway with a verified payment: the row behind the
      // screen is now the extended one, so the confirmation can open on top
      // of it. Outside the ok-branch on purpose — the money moved whether or
      // not this dashboard could redraw itself, and "the panel failed to
      // load" must not become "nobody ever told me the payment worked". With
      // no subscription in hand the screen simply opens without the line
      // about the new period.
      if (paidPending) { paidPending = false; showPaid(sub); }
    }

    async function loadRewards() {
      const list = $("rewardList");
      if (!cafeId) { list.innerHTML = `<p class="rw-empty">${t("OWNER_RW_EMPTY")}</p>`; return; }
      try {
        const r = await fetch(API + "/api/collections/reward_options/records?perPage=100&sort=created&filter=" + encodeURIComponent("(cafe='" + cafeId + "')"));
        const d = await r.json();
        const items = (d && d.items) || [];
        if (!items.length) { list.innerHTML = `<p class="rw-empty">${t("OWNER_RW_EMPTY")}</p>`; return; }

        // Copies are separate rows in the database — that is what makes one
        // reward likelier than another, since the draw picks a row. They are
        // not separate rewards to look at, though: three identical lines in
        // a column reads as a mistake. Identical rows collapse into one card
        // with the pile drawn behind it and the count on its face.
        const groups = [];
        const byKey = {};
        items.forEach((x) => {
          const key = [x.deal, x.description, x.expiry_amount, x.expiry_unit, x.active].join("\u0000");
          if (byKey[key]) { byKey[key].ids.push(x.id); return; }
          byKey[key] = { row: x, ids: [x.id] };
          groups.push(byKey[key]);
        });

        // ---- odds ----
        // card.pb.js draws uniformly from the ACTIVE rows of this café
        // (`opts[Math.floor(Math.random() * opts.length)]`), so a reward's
        // chance is simply its share of those rows. Copies are the only
        // lever: three copies out of twelve rows is one in four. Hidden
        // rewards are not in the draw at all, so they are out of both the
        // numerator and the denominator.
        //
        // Nothing caches this. It is derived here, on the rows the server
        // just returned, which is why adding or deleting a reward — both of
        // which end in loadRewards() — repaints every percentage on the list
        // and not just the one that changed.
        const activeRows = items.filter((x) => x.active).length;
        const shares = groups.map((g) => (g.row.active && activeRows ? (g.ids.length / activeRows) * 100 : 0));
        // Largest remainder, so what is on screen adds up to 100 rather than
        // to 99 from three honest 33.3s.
        const pct = shares.map((v) => Math.floor(v));
        let spare = 100 - pct.reduce((a, b) => a + b, 0);
        shares
          .map((v, i) => ({ i, frac: v - Math.floor(v) }))
          .sort((a, b) => b.frac - a.frac)
          .forEach((e) => { if (spare > 0 && shares[e.i] > 0) { pct[e.i]++; spare--; } });

        list.innerHTML = groups.map((g, i) => {
          const x = g.row, n = g.ids.length;
          const deal = x.deal || t("WALLET_REWARD_FALLBACK");
          const tag = x.active ? "" : `<span class="rw__off">${t("OWNER_TAG_HIDDEN")}</span>`;
          const amt = Number(x.expiry_amount) || 0;
          const unit = x.expiry_unit || "";
          const exp = amt && unit ? `<span class="rw__exp">⏳ ${amt} ${unitWord(unit, amt)}</span>` : "";
          const count = n > 1 ? `<span class="rw__count">${t("OWNER_RW_COPIES", { n })}</span>` : "";
          // The dial replaces what used to be a 🎁 on every row: four
          // identical gift boxes in a column carried no information, while
          // the one number that differs per reward was a grey chip at the
          // bottom. C is the circumference of the r=19 track; the arc is
          // drawn by holding back the rest of it.
          const C = 119.38;
          const off = (C * (1 - (x.active ? pct[i] : 0) / 100)).toFixed(2);
          // The ring alone left the owner to work out what the number was.
          // One word under it says so, without repeating the figure.
          const dial = `<span class="rw__odds">
            <span class="rw__dial${x.active ? "" : " rw__dial--off"}" style="--off:${off}"
              role="img" aria-label="${x.active ? esc(t("OWNER_RW_CHANCE", { p: pct[i] })) : esc(t("OWNER_TAG_HIDDEN"))}">
              <svg viewBox="0 0 44 44" aria-hidden="true">
                <circle class="rw__dial-t" cx="22" cy="22" r="19" />
                <circle class="rw__dial-v" cx="22" cy="22" r="19" />
              </svg>
              <span class="rw__dial-n" aria-hidden="true">${x.active ? pct[i] : "–"}<i>${x.active ? "%" : ""}</i></span>
            </span>
            <span class="rw__dial-c" aria-hidden="true">${t("OWNER_RW_CHANCE_LABEL")}</span>
          </span>`;
          // Two sheets at most, however deep the pile: a stack says "more
          // than one" by being a stack, and the number on the card says how
          // many. Ten slivers would just be ten slivers.
          const sheets = n > 1
            ? `<span class="rwg__sheet rwg__sheet--2" aria-hidden="true"></span>` +
              (n > 2 ? "" : "") + `<span class="rwg__sheet rwg__sheet--1" aria-hidden="true"></span>`
            : "";
          // deleting a stack takes the whole pile, so the lock is about
          // whether anything would be left afterwards, not about row count
          const last = n === items.length;
          return `<div class="rwg${n > 1 ? " rwg--stack" : ""}" style="--i:${i}">
            ${sheets}
            <div class="rw${x.active ? "" : " rw--off"}">
              ${dial}
              <div class="rw__main">
                <div class="rw__top"><span class="rw__deal">${esc(deal)}</span>${count}${tag}</div>
                ${x.description ? `<p class="rw__desc">${esc(x.description)}</p>` : ""}
                <span class="rw__meta">${exp}</span>
              </div>
              <button class="rw__del${last ? " rw__del--locked" : ""}" data-ids="${g.ids.join(",")}" data-n="${n}"
                title="${last ? t("OWNER_RW_LAST_TITLE") : t("OWNER_BTN_DELETE_TITLE")}">✕</button>
            </div>
          </div>`;
        }).join("");
        // The last reward is not deletable — a café with none cannot finish a
        // customer's card at all. Say why on the spot instead of opening a
        // confirm that is only going to be refused by the server.
        list.querySelectorAll(".rw__del").forEach((b) => b.addEventListener("click", () => {
          if (b.classList.contains("rw__del--locked")) { rewardNote(t("OWNER_RW_LAST_MSG")); return; }
          askDelete(b);
        }));
      } catch (e) {
        list.innerHTML = `<p class="rw-empty">${t("OWNER_RW_LOAD_ERROR")}</p>`;
      }
    }

    function askDelete(btn) {
      const ids = (btn.dataset.ids || "").split(",").filter(Boolean);
      const n = ids.length;
      const ask = n > 1 ? t("OWNER_CONFIRM_DELETE_N", { n }) : t("OWNER_CONFIRM_DELETE");
      const wrap = document.createElement("div");
      wrap.className = "rw__confirm";
      wrap.innerHTML = `<span class="rw__ask">${ask}</span><button class="rw__yes" type="button">${t("OWNER_YES")}</button><button class="rw__no" type="button">${t("OWNER_NO")}</button>`;
      btn.replaceWith(wrap);
      wrap.querySelector(".rw__yes").onclick = () => delReward(ids);
      wrap.querySelector(".rw__no").onclick = () => loadRewards();
    }

    // a short-lived message under the reward list — used for the "last one"
    // refusal, which has no field of its own to hang an error on
    let rewardNoteTimer = null;
    function rewardNote(msg) {
      const box = $("rewardNote");
      if (!box) return;
      box.textContent = msg;
      box.hidden = false;
      box.classList.remove("is-in"); void box.offsetWidth; box.classList.add("is-in");
      clearTimeout(rewardNoteTimer);
      rewardNoteTimer = setTimeout(() => { box.hidden = true; }, 6000);
    }

    // Takes every copy in the stack. One at a time rather than in parallel:
    // lastreward.pb.js counts what is left on each delete, and a burst of
    // concurrent deletes can all read "one other remains" and empty the café
    // between them.
    async function delReward(ids) {
      try {
        for (const id of ids) {
          const r = await fetch(API + "/api/collections/reward_options/records/" + id, { method: "DELETE", headers: { Authorization: token } });
          if (r.ok || r.status === 204) continue;
          // the server keeps the same rule (lastreward.pb.js) and is the one
          // that actually enforces it — a refusal here used to vanish silently
          if (r.status === 400) { loadRewards(); rewardNote(t("OWNER_RW_LAST_MSG")); return; }
          loadRewards(); rewardNote(t("OWNER_RW_DELETE_FAILED")); return;
        }
        loadRewards();
      } catch (e) { rewardNote(t("AUTH_ERR_SERVER_UNREACHABLE")); }
    }

    async function addReward() {
      const deal = $("fDeal").value.trim();
      // Saying nothing and moving the cursor looked like the button was
      // broken. The reason goes in the footer, which is pinned, so it is
      // read even when the field itself has scrolled out of the form.
      if (!deal) {
        $("addErr").textContent = t("OWNER_ERR_DEAL_REQUIRED");
        $("addErr").hidden = false;
        $("fDeal").classList.add("is-bad");
        $("fDeal").setAttribute("aria-invalid", "true");
        $("fDeal").focus();
        return;
      }
      $("addErr").hidden = true;
      $("saveBtn").disabled = true;
      try {
        const qty = Math.max(1, Math.min(10, parseInt($("fQty").value, 10) || 1));
        const body = {
          deal,
          description: $("fDesc").value.trim(),
          weight: 1,
          // Always live. The only control for this was on the add form, and
          // nothing in the dashboard could switch a reward back on once it
          // was off — so "add a hidden reward" was a one-way door to a row
          // that did nothing. Rewards you no longer want are deleted.
          active: true,
          expiry_amount: Math.max(1, Math.min(365, parseInt($("fExpAmt").value, 10) || 30)),
          expiry_unit: $("fExpUnit").value,
          cafe: cafeId,
        };
        let failed = false;
        for (let i = 0; i < qty; i++) {
          const r = await fetch(API + "/api/collections/reward_options/records", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(body),
          });
          if (!r.ok) { failed = true; break; }
        }
        if (failed) { $("addErr").textContent = t("OWNER_ERR_SAVE_FAILED"); $("addErr").hidden = false; loadRewards(); return; }
        $("fDeal").value = ""; $("fDesc").value = ""; $("fQty").value = "1";
        $("fExpAmt").value = "2"; $("fExpUnit").value = "week";
        updatePreview();
        // the list is rebuilt once the page is gone: fifty backdrop-filtered
        // rows redrawn on the closing animation's first frame eats it
        closeAddPage(loadRewards);
      } catch (e) {
        $("addErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE"); $("addErr").hidden = false;
      } finally {
        $("saveBtn").disabled = false;
      }
    }

    // addReward() runs before the page object exists in source order; this
    // is the hop between them.
    function closeAddPage(after) { if (typeof addPageClose === "function") addPageClose(after); }
    let addPageClose = null;

    // The segmented control and the two steppers are painted FROM the inputs
    // rather than holding their own state, so there is one source of truth
    // and the reset after a save (which writes the inputs directly) brings
    // the whole form back with it. updatePreview is the single sync point —
    // it already runs on every edit and after every reset.
    function syncAddControls() {
      const unit = $("fExpUnit").value;
      [...$("fExpSeg").children].forEach((b) => b.classList.toggle("is-on", b.dataset.v === unit));
      const amt = Math.max(1, parseInt($("fExpAmt").value, 10) || 1);
      $("expDec").disabled = amt <= 1;
      $("expInc").disabled = amt >= 365;
      const qty = Math.min(10, Math.max(1, parseInt($("fQty").value, 10) || 1));
      $("qtyVal").textContent = String(qty);
      $("qtyDec").disabled = qty <= 1;
      $("qtyInc").disabled = qty >= 10;
      $("qtyOdds").textContent = qty === 1 ? t("OWNER_ODDS_EVEN") : t("OWNER_ODDS_N", { n: qty });
    }

    function updatePreview() {
      const deal = $("fDeal").value.trim() || t("OWNER_PV_DEAL_DEFAULT");
      const desc = $("fDesc").value.trim();
      const amt = Math.max(1, parseInt($("fExpAmt").value, 10) || 1);
      const unit = $("fExpUnit").value;
      $("pvDeal").textContent = deal;
      $("pvDesc").textContent = desc;
      $("pvExp").textContent = t("OWNER_PV_EXPIRES", { amt, unit: unitWord(unit, amt) });
      syncAddControls();
    }

    // a hidden input does not fire `input` when script sets .value, so each
    // control calls the sync itself
    $("fExpSeg").addEventListener("click", (e) => {
      const b = e.target.closest(".af-seg__b");
      if (!b) return;
      $("fExpUnit").value = b.dataset.v;
      updatePreview();
    });
    function nudgeExp(by) {
      const n = Math.min(365, Math.max(1, (parseInt($("fExpAmt").value, 10) || 1) + by));
      $("fExpAmt").value = String(n);
      updatePreview();
    }
    function nudgeQty(by) {
      const n = Math.min(10, Math.max(1, (parseInt($("fQty").value, 10) || 1) + by));
      $("fQty").value = String(n);
      updatePreview();
    }
    $("expDec").onclick = () => nudgeExp(-1);
    $("expInc").onclick = () => nudgeExp(1);
    $("qtyDec").onclick = () => nudgeQty(-1);
    $("qtyInc").onclick = () => nudgeQty(1);
    ["fDeal", "fDesc", "fExpAmt", "fExpUnit"].forEach((id) => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", updatePreview); el.addEventListener("change", updatePreview);
    });
    // the complaint goes away as soon as it is being answered
    $("fDeal").addEventListener("input", () => {
      if (!$("fDeal").value.trim()) return;
      $("addErr").hidden = true;
      $("fDeal").classList.remove("is-bad");
      $("fDeal").removeAttribute("aria-invalid");
    });

    // opening and closing live with the other sheets, further down — the
    // helper that does it is defined there
    $("saveBtn").onclick = addReward;

    // ---- the add-a-discount page ----
    // Ported from version-two without the customer sheets it was written
    // alongside: the add page is the only overlay on this branch, so the
    // scroll lock has just the one thing to ask about.
    function releaseScrollLock() {
      // Any full-screen page still open keeps the lock. These stack now — the
      // package page opens over the buy page — and restoring the scrollbar
      // under one that is still up jumps the layout behind it.
      const open = [...document.querySelectorAll(".addpage")].some((el) => !el.hidden);
      if (!open) document.body.style.overflow = "";
    }
    const SHEET_MS = 440;   // must stay >= the .sheet__panel transition

    // Shared by every bottom sheet on this page. Written once because the
    // two fiddly parts — resolving the parked transform before the class
    // lands, and releasing the scroll lock only after the slide finishes —
    // are exactly the parts that were silently dropping the animation when
    // the filter sheet had its own copy.
    // `blocked` is consulted by close(), so every way out goes through it:
    // the ✕, Escape, the backdrop, and any code that calls close() itself.
    // The send sheet uses it to stay put while a broadcast is in flight —
    // walking away mid-send leaves the owner with no idea whether several
    // hundred people got the message.
    function makeSheet(el, panel, opener, onOpen, onClosed, blocked) {
      let timer = null;
      function open() {
        if (onOpen) onOpen();
        clearTimeout(timer);
        el.hidden = false;
        el.setAttribute("aria-hidden", "false");
        if (opener) opener.setAttribute("aria-expanded", "true");
        // The panel is parked at translateY(100%) — or, for the add page,
        // clipped to a zero-radius circle — and only travels if the browser
        // has resolved that start value before the class lands. Reading the
        // panel's OWN computed style forces exactly that; both properties
        // are read because the element that moves is not always the one that
        // transforms. rAF would do it too, except it is throttled to a
        // standstill in a background tab, which opens the sheet with no
        // animation at all.
        const parked = getComputedStyle(panel);
        void parked.transform; void parked.clipPath;
        el.classList.add("is-open");
        document.body.style.overflow = "hidden";
        const first = el.querySelector(".sheet__close");
        if (first) first.focus();
      }
      // `after` runs once the panel is actually gone. Apply uses it to hold
      // the list rebuild back: redrawing fifty backdrop-filtered rows on the
      // transition's first frame ate the closing animation.
      function close(after) {
        if (el.hidden) return;
        if (blocked && blocked()) return;
        el.classList.remove("is-open");
        if (opener) opener.setAttribute("aria-expanded", "false");
        clearTimeout(timer);
        timer = setTimeout(() => {
          el.hidden = true;
          el.setAttribute("aria-hidden", "true");
          // released here, not as the slide begins: restoring the scrollbar
          // re-lays out the list underneath on the first frame
          releaseScrollLock();
          if (typeof after === "function") after();
          // runs however the sheet was dismissed — button, backdrop, Escape
          // or an action — which is what makes "return to where I came
          // from" work without every exit having to remember to do it
          if (onClosed) onClosed();
        }, SHEET_MS);
        if (opener) opener.focus();
      }
      // backdrop only — a tap inside the panel must not shut it
      el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) close(); });
      const closeBtn = el.querySelector(".sheet__close");
      if (closeBtn) closeBtn.onclick = () => close();
      return { open: open, close: close };
    }

    // The add-a-discount page. Same plumbing as the bottom sheets — scroll
    // lock, focus, Escape, aria — and a different arrival: the circle it is
    // revealed through is centred on the + that opened it.
    //
    // The origin is measured at open time, not once at startup: the + moves
    // with the header, the page scrolls, and phones rotate.
    const addPage = makeSheet($("addPage"), $("addPage"), $("addBtn"), () => {
      const el = $("addPage"), r = $("addBtn").getBoundingClientRect();
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      // radius out to the furthest corner, so the circle finishes by
      // covering the screen rather than stopping short of a corner
      const reach = Math.max(
        Math.hypot(ox, oy), Math.hypot(window.innerWidth - ox, oy),
        Math.hypot(ox, window.innerHeight - oy), Math.hypot(window.innerWidth - ox, window.innerHeight - oy));
      el.style.setProperty("--ox", ox.toFixed(1) + "px");
      el.style.setProperty("--oy", oy.toFixed(1) + "px");
      el.style.setProperty("--r", Math.ceil(reach) + "px");
      $("addBtn").classList.add("is-open");
      $("addBtn").setAttribute("aria-label", t("STAFF_BTN_CLOSE"));
      updatePreview();
    }, () => {
      $("addBtn").classList.remove("is-open");
      $("addBtn").setAttribute("aria-label", t("OWNER_ARIA_ADD_DISCOUNT"));
    });
    // ---- buy page ----------------------------------------------------
    // Prices live here as constants for now, mirroring for-business.js. They
    // belong on the server before any money moves — a price the client can
    // edit is not a price — but this page only has to show the offer.
    const BUY_PRICE = { monthly: 3000000, yearly: 30000000 };   // Toman
    let buyPlan = "monthly";
    let buySub = null;                       // the café's current subscription

    const money = (n) => Number(n).toLocaleString("en-US");

    // How many months the yearly price effectively waives against paying
    // monthly all year. Derived, not written down: the two prices are what
    // move, and a hardcoded "2 months free" would quietly start lying the
    // first time one of them changed. Same calculation as for-business.js.
    const monthsFree = () => Math.round((BUY_PRICE.monthly * 12 - BUY_PRICE.yearly) / BUY_PRICE.monthly);

    // A per-day figure lands harder than a per-month one on a café owner who
    // thinks in covers and cups. Rounded to the nearest 1,000 so it reads as
    // the honest approximation it is rather than false precision.
    const perDay = (total, days) => money(Math.round(total / days / 1000) * 1000);

    function paintBuy() {
      const yearly = buyPlan === "yearly";
      const price = BUY_PRICE[buyPlan];

      $("buyAmount").textContent = money(price);
      $("buyPer").textContent = t(yearly ? "OWNER_BUY_PER_YEAR_FULL" : "OWNER_BUY_PER_MONTH_FULL");

      // the struck-through figure is what twelve months would have cost, which
      // is the only honest way to show what "2 months free" is measured against
      const anchor = $("buyAnchor"), was = $("buyWas");
      anchor.hidden = !yearly;
      if (yearly) {
        was.textContent = money(BUY_PRICE.monthly * 12);
        was.setAttribute("aria-label", t("OWNER_BUY_WAS_LABEL", { amount: money(BUY_PRICE.monthly * 12) }));
        $("buySave").textContent = t("OWNER_BUY_SAVE_N", { n: monthsFree() });
      }

      // One reframe each, not both: for a month the useful retelling is the
      // daily cost; for a year it is what it works out to monthly, which is
      // the comparison the owner is actually making.
      $("buyDay").textContent = yearly
        ? t("OWNER_BUY_EQUIV", { amount: money(Math.round(BUY_PRICE.yearly / 12)) })
        : t("OWNER_BUY_PER_DAY", { amount: perDay(price, 30) });

      // The nudge always offers the OTHER plan, and tapping it is the same
      // action as moving the toggle — so the two can never disagree.
      $("buyNudge").innerHTML = yearly
        ? esc(t("OWNER_BUY_NUDGE_MONTHLY", { amount: money(BUY_PRICE.monthly) }))
        : esc(t("OWNER_BUY_NUDGE_YEARLY", {
            amount: money(BUY_PRICE.yearly), was: money(BUY_PRICE.monthly * 12), n: monthsFree() }));

      $("buySeg").classList.toggle("is-yearly", yearly);
      document.querySelectorAll(".buy-seg__btn").forEach((b) => {
        const on = b.dataset.plan === buyPlan;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      $("buySeg").querySelector(".buy-seg__save").textContent =
        t("OWNER_BUY_SAVE_N", { n: monthsFree() });
      $("buyPayLabel").textContent = t("OWNER_BUY_PAY", { amount: money(price) });

      // replay the entrance on the whole figure — a price that changes
      // silently under a toggle reads as a rendering glitch rather than a choice
      const box = $("buyPriceBox");
      box.classList.remove("is-swap"); void box.offsetWidth; box.classList.add("is-swap");

      // When the café still has time left — paid or trial — buying must not
      // throw that time away, and the owner needs telling so before they pay.
      const live = buySub && (buySub.status === "trialing" || buySub.status === "active");
      const until = live && buySub.until ? formatDateLocal(buySub.until) : "";
      $("buyStarts").textContent = until
        ? t(buySub.status === "trialing" ? "OWNER_BUY_STARTS_TRIAL" : "OWNER_BUY_STARTS", { date: until })
        : t("OWNER_BUY_STARTS_NOW");
    }

    // Leaves the app for ZarinPal's gateway. The amount is NOT sent: the
    // server prices the plan itself, so there is nothing here worth forging.
    let paySending = false;
    async function startPayment() {
      if (paySending) return;
      paySending = true;
      const btn = $("buyPay"), label = $("buyPayLabel"), was = label.textContent;
      btn.disabled = true;
      label.textContent = t("OWNER_BUY_SENDING");
      try {
        const r = await fetch(API + "/subscription/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({ plan: buyPlan }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) throw d;
        // assign, not replace: the owner must be able to come back with the
        // browser's own Back button if they change their mind at the gateway
        window.location.assign(d.url);
      } catch (err) {
        paySending = false;
        btn.disabled = false;
        label.textContent = was;
        toast(tErr(err, "OWNER_PAY_ERROR"));
      }
    }

    // The gateway sends the browser back to /owner?pay=… — say what happened
    // and clear the parameter so a refresh does not repeat the message.
    //
    // A verified payment gets the confirmation screen instead of a toast, and
    // it has to WAIT: everything on that screen comes from /owner/cafe, which
    // is still in flight when this runs. paintSubscription() opens it once the
    // row it has just painted is the extended one, so the screen can never
    // announce a period that is not on screen behind it.
    //
    // The quieter outcomes stay toasts. A failure took no money and a pending
    // one is a sentence of instruction; neither has anything to celebrate or
    // any figures to show.
    let paidPending = false;
    (function payResult() {
      const r = new URLSearchParams(location.search).get("pay");
      if (!r) return;
      if (r === "ok") {
        paidPending = true;
      } else {
        const key = { failed: "OWNER_PAY_FAILED", pending: "OWNER_PAY_PENDING",
                      error: "OWNER_PAY_ERROR" }[r];
        if (key) setTimeout(() => toast(t(key)), 600);
      }
      try { history.replaceState(null, "", location.pathname); } catch (_) {}
    })();

    // ---- the confirmation screen (owner.html .paid) ------------------
    // Nothing on it is read from the URL. A screen that says "3,000,000 paid,
    // code 7251701" because the query string said so is not a receipt, it is
    // a sentence anyone can type into their own address bar. The subscription
    // says what the café now has; the ledger row says what was actually
    // charged and under which code, and both come from the server.
    const PAID_MS = 420;            // must stay >= the .paid opacity transition
    async function showPaid(sub) {
      const el = $("paidPage");
      if (!el) return;

      $("paidLede").textContent = sub && sub.until
        ? t("OWNER_PAID_UNTIL", { date: formatDateLocal(sub.until) }) : "";

      // The ledger is readable by the café that owns it (the payments
      // listRule), so this needs no endpoint of its own. If it cannot be
      // reached the screen still opens: the amount falls back to the period's
      // own price and the code shows a dash, which is a confirmation with one
      // fact missing rather than no confirmation at all.
      let pay = null;
      try {
        const r = await fetch(API + "/api/collections/payments/records?perPage=1&sort=-paid_at&filter="
          + encodeURIComponent("(status='paid')"), { headers: { Authorization: token } });
        const d = await r.json();
        if (r.ok && d.items && d.items.length) pay = d.items[0];
      } catch (e) { pay = null; }

      const amount = (pay && pay.amount) || (sub && sub.amount) || 0;
      $("paidAmount").textContent = amount ? money(amount) : "—";
      $("paidRef").textContent = (pay && pay.ref_id) || "—";
      $("paidOn").textContent = formatDateLocal((pay && pay.paid_at) || Date.now());

      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      // Resolve the parked transform before the class lands, for the same
      // reason makeSheet() does: without this the card is simply there, with
      // no arrival at all.
      void getComputedStyle(el.querySelector(".paid__card")).transform;
      el.classList.add("is-on");
      document.body.style.overflow = "hidden";
      $("paidGo").focus();
    }

    function closePaid() {
      const el = $("paidPage");
      if (!el || el.hidden) return;
      el.classList.remove("is-on");
      setTimeout(() => {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
        releaseScrollLock();
      }, PAID_MS);
    }

    const buyPage = makeSheet($("buyPage"), $("buyPage"), $("subBuy"), () => {
      const el = $("buyPage"), r = $("subBuy").getBoundingClientRect();
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const reach = Math.max(
        Math.hypot(ox, oy), Math.hypot(window.innerWidth - ox, oy),
        Math.hypot(ox, window.innerHeight - oy), Math.hypot(window.innerWidth - ox, window.innerHeight - oy));
      el.style.setProperty("--ox", ox.toFixed(1) + "px");
      el.style.setProperty("--oy", oy.toFixed(1) + "px");
      el.style.setProperty("--r", Math.ceil(reach) + "px");
      paintBuy();
    }, null, () => !$("incPage").hidden);   // Escape closes the top page only
    $("subBuy").onclick = () => buyPage.open();
    $("buyPay").onclick = startPayment;
    // Continue is the way out. The backdrop deliberately is not — this is the
    // one screen on the page a stray tap must not dismiss — but Escape is,
    // because a keyboard user should never be held in a dialog.
    $("paidGo").onclick = () => closePaid();
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePaid(); });
    $("buyPage").querySelector(".buypage__back").onclick = () => buyPage.close();

    // What the package includes. Opens OVER the buy page rather than
    // replacing it: an owner comparing the two plans is mid-decision, and
    // coming back should put them exactly where they left off.
    const incPage = makeSheet($("incPage"), $("incPage"), $("buyIncBtn"), () => {
      const el = $("incPage"), r = $("buyIncBtn").getBoundingClientRect();
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const reach = Math.max(
        Math.hypot(ox, oy), Math.hypot(window.innerWidth - ox, oy),
        Math.hypot(ox, window.innerHeight - oy), Math.hypot(window.innerWidth - ox, window.innerHeight - oy));
      el.style.setProperty("--ox", ox.toFixed(1) + "px");
      el.style.setProperty("--oy", oy.toFixed(1) + "px");
      el.style.setProperty("--r", Math.ceil(reach) + "px");
      el.querySelector(".addpage__body").scrollTop = 0;
    });
    $("buyIncBtn").onclick = () => incPage.open();
    document.querySelectorAll(".buy-seg__btn").forEach((b) => {
      b.onclick = () => { buyPlan = b.dataset.plan; paintBuy(); };
    });
    $("buyNudge").onclick = () => { buyPlan = buyPlan === "yearly" ? "monthly" : "yearly"; paintBuy(); };

    addPageClose = addPage.close;
    $("addBtn").onclick = () => { addPage.open(); $("fDeal").focus(); };
    $("cancelBtn").onclick = () => addPage.close();

    // The loyalty-card design page. Same arrival as the add page — a circle
    // grown from the control that opened it — measured at open time because
    // the card sits in a scrolling column.
    //
    // Save is a no-op until the page has controls to save; it closes like
    // Cancel so neither button is a dead end while the body is empty.
    const designPage = makeSheet($("designPage"), $("designPage"), $("designEditBtn"), () => {
      const el = $("designPage"), r = $("designEditBtn").getBoundingClientRect();
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const reach = Math.max(
        Math.hypot(ox, oy), Math.hypot(window.innerWidth - ox, oy),
        Math.hypot(ox, window.innerHeight - oy), Math.hypot(window.innerWidth - ox, window.innerHeight - oy));
      el.style.setProperty("--ox", ox.toFixed(1) + "px");
      el.style.setProperty("--oy", oy.toFixed(1) + "px");
      el.style.setProperty("--r", Math.ceil(reach) + "px");
      $("designEditBtn").classList.add("is-open");
      setDesignAccentUI(savedAccent);      // always opens on the saved colour
      if (CP && !$("dpPatterns").children.length) buildPatternPicker();
      // With a pattern saved, commitPatternState below sets the switch from
      // it. With none there is nothing to derive it from, and the switch —
      // which now decides what the picker lists — would still be showing
      // whatever the last visit left it on.
      if (!savedPattern) designLayoutSel = LAYOUT_DEFAULT;
      commitPatternState(savedPattern);    // and on the saved pattern
      lendPreviewToPage();
    }, () => {
      $("designEditBtn").classList.remove("is-open");
      closeTune(true);                 // no sheet left hanging over the panel
      returnPreviewToCardTab();
    });

    // The card at the top of the design page is the Card tab's live preview,
    // moved across and moved back — not a clone. A clone would need a second
    // set of ids and its own copy of every refresh (name, logo, stamp count,
    // minimum, colour), and the two would disagree the first time one of them
    // was missed. Moving it also means what the owner judges a design against
    // is literally the thing the customer gets.
    //
    // Where it came from is remembered rather than assumed: the Card tab's
    // column is built in a fixed order today, but putting it back by anchor
    // survives anything being inserted above it later.
    let previewHome = null;
    function lendPreviewToPage() {
      const wrap = document.querySelector(".ownpv-wrap");
      if (!wrap || wrap.parentNode === $("designBody")) return;
      previewHome = { parent: wrap.parentNode, next: wrap.nextSibling };
      $("designBody").insertBefore(wrap, $("designBody").firstChild);
    }
    function returnPreviewToCardTab() {
      const wrap = document.querySelector(".ownpv-wrap");
      if (!wrap || !previewHome) return;
      previewHome.parent.insertBefore(wrap, previewHome.next);
      previewHome = null;
    }

    async function copyStaffCode() {
      const code = $("staffCode").textContent.trim();
      if (!code || code === "—") return;
      try {
        await navigator.clipboard.writeText(code);
        $("codeTile").classList.add("copied"); $("codeHint").textContent = t("OWNER_COPIED");
        setTimeout(() => { $("codeTile").classList.remove("copied"); $("codeHint").textContent = t("OWNER_TAP_TO_COPY"); }, 1500);
      } catch (e) {}
    }
    $("codeTile").onclick = copyStaffCode;
    $("codeTile").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyStaffCode(); } });

    // editable stamps-per-reward stepper (debounced save; does not affect in-progress cards)
    let stampsVal = 8, stampsTimer = null;
    function renderStamps() {
      $("stampsReq").textContent = stampsVal;
      $("stampsDec").disabled = stampsVal <= 1;
      $("stampsInc").disabled = stampsVal >= 12;
      rebuildOwnPreviewGrid(stampsVal);
    }
    function saveStamps() {
      clearTimeout(stampsTimer);
      stampsTimer = setTimeout(async () => {
        try {
          const r = await fetch(API + "/owner/cafe/stamps-required", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify({ stamps_required: stampsVal }),
          });
          const d = await r.json();
          if (r.ok) {
            stampsVal = d.stamps_required; renderStamps();
            const h = $("stampsHint"); h.textContent = t("OWNER_SAVED"); h.classList.add("is-ok");
            setTimeout(() => { h.textContent = t("OWNER_STAMPS_HINT"); h.classList.remove("is-ok"); }, 1500);
          }
        } catch (e) {}
      }, 500);
    }
    $("stampsDec").onclick = () => { if (stampsVal > 1) { stampsVal--; renderStamps(); saveStamps(); } };
    $("stampsInc").onclick = () => { if (stampsVal < 12) { stampsVal++; renderStamps(); saveStamps(); } };

    $("minSave").onclick = async () => {
      let amt = parseInt($("fMinPurchase").value, 10); if (isNaN(amt) || amt < 0) amt = 0;
      $("minErr").hidden = true; $("minOk").hidden = true; $("minSave").disabled = true;
      try {
        const r = await fetch(API + "/owner/cafe/min-purchase", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({ min_purchase: amt }),
        });
        const d = await r.json();
        if (r.ok) { $("fMinPurchase").value = d.min_purchase ? d.min_purchase : ""; refreshOwnPreviewMin(d.min_purchase); $("minOk").hidden = false; setTimeout(() => { $("minOk").hidden = true; }, 1800); }
        else { $("minErr").textContent = tErr(d, "OWNER_ERR_SAVE_FAILED"); $("minErr").hidden = false; }
      } catch (e) { $("minErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE"); $("minErr").hidden = false; }
      finally { $("minSave").disabled = false; }
    };
    // ---------------- business identity (name / type / card colour) ----------------
    // Same three controls business.html builds at registration, now editing an
    // existing café instead of creating one, via /owner/cafe/profile.
    const ACCENTS = ["#171717", "#1f7a4d", "#7a4a24", "#2f5aa8", "#9a2b52", "#b0862a", "#17726b", "#6b3a86"];

    // The card paints its name/counter/stamp numbers in white on the accent's
    // --paper stop, so a hand-picked colour is deepened until it clears the
    // same contrast floor the 8 presets above already meet — identical maths
    // to business.js's deepenForCard(), kept in sync with it.
    const MIN_CARD_CONTRAST = 3.85;
    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const mix = (v) => (amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
      [r, g, b] = [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(mix(v)))));
      return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    }
    function relLuminance(hex) {
      const n = parseInt(hex.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrastWithWhite(hex) { return 1.05 / (relLuminance(hex) + 0.05); }
    function deepenForCard(hex) {
      for (let step = 0; step <= 95; step++) {
        const candidate = step === 0 ? hex : shade(hex, -step / 100);
        if (contrastWithWhite(shade(candidate, -0.08)) >= MIN_CARD_CONTRAST) return candidate;
      }
      return shade(hex, -0.95);
    }

    // ---------------- live card preview ----------------
    // Card colours, set on #ownPreview exactly as the wallet sets them per card
    // — the tokens shadow this page's own --paper/--ink values for the preview
    // subtree only (see the .pcard comment in owner.html).
    function paintOwnPreviewAccent(accent) {
      const el = $("ownPreview");
      el.style.setProperty("--accent", accent);
      el.style.setProperty("--paper", shade(accent, -0.08));
      el.style.setProperty("--paper-2", shade(accent, -0.30));
      el.style.setProperty("--ink", "#ffffff");
      el.style.setProperty("--ink-dim", "rgba(255,255,255,0.86)");
      el.style.setProperty("--ink-faint", "rgba(255,255,255,0.56)");
      el.style.setProperty("--gold", "rgba(255,255,255,0.72)");
    }
    function refreshOwnPreviewName() {
      $("ownPrevName").textContent = $("fCafeName").value.trim() || t("WALLET_CAFE_FALLBACK");
    }
    function refreshOwnPreviewTag() {
      const tag = $("ownPrevTag");
      tag.textContent = identTypeSel;
      tag.hidden = !identTypeSel;
    }
    // group thousands for toman amounts, e.g. 50000 -> "50,000" — same as app.js's formatToman()
    function formatToman(n) {
      const v = Math.max(0, Math.round(Number(n) || 0));
      return v.toLocaleString("en-US");
    }
    // The real card only shows this note at all when a minimum is set — an
    // empty/zero amount means no note, not a "min. purchase: 0" one.
    function refreshOwnPreviewMin(amount) {
      const el = $("ownPrevMin");
      const n = parseInt(amount, 10) || 0;
      if (n > 0) { el.textContent = t("WALLET_MIN_PURCHASE", { amt: formatToman(n) }); el.hidden = false; }
      else { el.hidden = true; }
    }
    // Rebuilt whenever the stamps-per-reward count changes, same cols maths as
    // app.js's cfgFromCafe: Math.ceil(n / 2), so the preview always matches the
    // real 2-row grid a customer's card actually gets.
    function rebuildOwnPreviewGrid(n) {
      const grid = $("ownPrevGrid");
      grid.style.setProperty("--cols", Math.max(1, Math.ceil(n / 2)));
      grid.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const s = document.createElement("div");
        s.className = "slot";
        s.style.setProperty("--i", i);
        s.innerHTML = `<span class="slot__num">${i + 1}</span>`;
        grid.appendChild(s);
      }
      $("ownPrevTotal").textContent = n;
    }

    let identTypeSel = "Cafe";

    function setIdentType(type) {
      identTypeSel = type;
      [...$("fType").children].forEach((c) => c.classList.toggle("is-on", c.dataset.type === type));
      refreshOwnPreviewTag();
    }
    $("fCafeName").addEventListener("input", refreshOwnPreviewName);

    $("fType").addEventListener("click", (e) => {
      const b = e.target.closest(".seg__btn"); if (!b) return;
      setIdentType(b.dataset.type);
    });


    // ---------------- summary / edit toggle ----------------
    // The card opens as a read-only summary; "Edit" swaps in the same three
    // controls, and only a successful Save (or a real page reload) commits a
    // change to the "saved" values below — Cancel just throws the in-progress
    // selection away and puts the form back to whatever was last saved.
    let savedCafeName = "", savedTagline = "Cafe", savedAccent = ACCENTS[0];

    function renderIdentitySummary() {
      $("identSummaryName").textContent = savedCafeName || t("OWNER_CAFE_FALLBACK");
      $("identSummaryType").textContent = savedTagline;
      // The colour is not an identity row any more: it belongs to the card's
      // look, which is the design card's subject. Rendered from here all the
      // same, because this is the function every save path already calls.
      renderDesignSummary();
    }

    // The design card, closed: the colour, and the pattern as its own square
    // on that colour. A name alone ("گره‌چینی") means nothing to someone who
    // chose by eye a week ago.
    function renderDesignSummary() {
      $("designSummaryDot").style.background = savedAccent;
      const CPl = window.CardPatterns;
      const p = (CPl && savedPattern) ? CPl.byId[savedPattern.pattern] : null;
      const sq = $("designSummarySq");
      $("designSummaryPat").textContent = p ? p.name : t("OWNER_DESIGN_NONE");
      sq.hidden = !p;
      if (!p) return;
      sq.style.setProperty("--sw-paper", shade(savedAccent, -0.08));
      sq.style.setProperty("--sw-paper2", shade(savedAccent, -0.30));
      CPl.swatch(sq, p.id, savedPattern.layout);   // already the resolved one
    }
    function showIdentitySummary() {
      renderIdentitySummary();
      $("identitySummary").hidden = false;
      $("identityForm").hidden = true;
    }
    function showIdentityForm() {
      $("identitySummary").hidden = true;
      $("identityForm").hidden = false;
      $("identityErr").hidden = true;
    }
    $("identityEditBtn").onclick = showIdentityForm;
    $("identityCancel").onclick = () => {
      // put the form's own state back to what's actually saved, so reopening
      // Edit later (or the live card preview) doesn't show the discarded pick
      $("fCafeName").value = savedCafeName; refreshOwnPreviewName();
      setIdentType(savedTagline);
      showIdentitySummary();
    };

    $("identitySave").onclick = async () => {
      const cafe_name = $("fCafeName").value.trim();
      $("identityErr").hidden = true; $("identityOk").hidden = true;
      if (!cafe_name) { $("fCafeName").focus(); return; }
      $("identitySave").disabled = true;
      try {
        const r = await fetch(API + "/owner/cafe/profile", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
          // the accent is the design page's to change; sent as-is so this
          // save cannot move it
          body: JSON.stringify({ cafe_name, tagline: identTypeSel, accent: savedAccent }),
        });
        const d = await r.json();
        if (r.ok) {
          $("setCafeName").textContent = d.cafe_name || t("OWNER_CAFE_FALLBACK");
          savedCafeName = d.cafe_name || ""; savedTagline = d.tagline || "Cafe"; savedAccent = d.accent || "#171717";
          showIdentitySummary();
          $("identityOk").hidden = false;
          setTimeout(() => { $("identityOk").hidden = true; }, 1800);
        } else { $("identityErr").textContent = tErr(d, "OWNER_ERR_SAVE_FAILED"); $("identityErr").hidden = false; }
      } catch (e) { $("identityErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE"); $("identityErr").hidden = false; }
      finally { $("identitySave").disabled = false; }
    };

    // ---- the colour the design page is working on ----
    //
    // Staged, exactly like the identity form: picking paints the card so the
    // colour is judged at card size, but nothing is committed until Save.
    // Cancel — on the window or on the page — puts the card back, so an
    // abandoned experiment never leaks into what the customer sees.
    let designAccentSel = savedAccent;     // what the page would save
    let colourAtOpen = savedAccent;        // what the window would revert to
    const dpCustomWrap = $("dpAccentCustomWrap");
    const dpSwatchEls = {};

    function setDesignAccentUI(hex) {
      designAccentSel = hex;
      Object.values(dpSwatchEls).forEach((b) => b.classList.remove("is-on"));
      dpCustomWrap.classList.remove("is-on");
      if (dpSwatchEls[hex]) {
        dpSwatchEls[hex].classList.add("is-on");
      } else {
        dpCustomWrap.classList.add("is-on");
        dpCustomWrap.style.background = hex;
        $("dpAccentCustom").value = hex;
      }
      $("designRowDot").style.background = hex;
      paintOwnPreviewAccent(hex);          // the card behind the window
      refreshSwatches();                   // thumbnails sit on that colour too
    }

    (function buildDesignSwatches() {
      const wrap = $("dpAccent");
      ACCENTS.forEach((hex, i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "swatch";
        b.style.background = hex; b.setAttribute("aria-label", hex);
        b.style.setProperty("--i", String(i));   // its place in the entrance stagger
        b.onclick = () => { setDesignAccentUI(hex); popSwatch(b); };
        wrap.insertBefore(b, dpCustomWrap);
        dpSwatchEls[hex] = b;
      });
      dpCustomWrap.style.setProperty("--i", String(ACCENTS.length));
    })();

    // Restart-able: the class has to come off before it can go on again, or a
    // second pick on the same swatch would do nothing. It is also taken off
    // when the animation ends, so a swatch is not left wearing a state it is
    // no longer in — `once` because a fresh listener is added on every pick.
    function popSwatch(el) {
      el.classList.remove("just-picked");
      void el.offsetWidth;                       // forces the removal to take
      el.classList.add("just-picked");
      el.addEventListener("animationend", () => el.classList.remove("just-picked"), { once: true });
    }
    $("dpAccentCustom").addEventListener("input", (e) => {
      // same deepening the identity picker applies — a colour chosen on a
      // white swatch is lighter than it reads behind white card text
      setDesignAccentUI(deepenForCard(e.target.value.toLowerCase()));
      popSwatch(dpCustomWrap);
    });

    // ---- the background pattern ----
    //
    // CardPatterns (card-patterns/patterns.js) owns the library, the drawing
    // and the rules; this code is only the form around it. The screen's state
    // lives in `patState` and is pushed at the preview card on every change —
    // the point of having the card at the top of the page is that a pattern is
    // judged on a card, not on a 62px thumbnail.
    //
    // The two vocabularies do not match and must not be confused: the layout
    // switch says "repeat"/"single" because that is what an owner is choosing
    // between, while CardPatterns says "tile"/"motif"/"art". segToLayout()
    // is the only place they meet.
    const CP = window.CardPatterns;
    const LAYOUT_DEFAULT = "single";
    let designLayoutSel = LAYOUT_DEFAULT;          // what the switch shows
    let patState = null;                           // staged config, or null for "no pattern"
    let savedPattern = null;                       // what the server last confirmed

    const segToLayout = (seg) => (seg === "repeat" ? "tile" : "motif");
    const layoutToSeg = (l) => (l === "tile" ? "repeat" : "single");

    // The preview card, repainted from the staged state.
    function paintPreviewPattern() {
      const face = $("ownPreview") && $("ownPreview").querySelector(".face");
      if (face && CP) CP.apply(face, patState);
    }

    // ---- the picker ----
    // Built once. The thumbnails are redrawn (not rebuilt) whenever the layout
    // switch or the card colour changes, because each one shows the tile or
    // motif version to match what the card would actually get.
    function buildPatternPicker() {
      if (!CP) return;
      const host = $("dpPatterns");
      host.innerHTML = "";

      // No corner tags on the thumbnails: the list is filtered to the layout
      // in the switch, so a locked pattern is simply absent from the half it
      // cannot do, and a whole-card one says so through the switch and its
      // hint once it is chosen. A drawing should be read as a drawing.
      const mkBtn = (id, name) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "dp-pat" + (id ? "" : " dp-pat--none");
        b.dataset.pat = id || "";
        b.setAttribute("aria-pressed", "false");
        b.innerHTML = '<span class="dp-pat__sq"></span><span class="dp-pat__name"></span>';
        b.querySelector(".dp-pat__name").textContent = name;
        b.onclick = () => selectPattern(id || null);
        return b;
      };

      // "no pattern" leads, in a group of its own so it is never mistaken for
      // a member of the first category
      const lead = document.createElement("div");
      lead.className = "dp-group";
      const leadGrid = document.createElement("div");
      leadGrid.className = "dp-grid";
      leadGrid.appendChild(mkBtn("", t("OWNER_DESIGN_NONE")));
      lead.appendChild(leadGrid);
      host.appendChild(lead);

      CP.groups.forEach((g) => {
        const wrap = document.createElement("div");
        wrap.className = "dp-group";
        const h = document.createElement("p");
        h.className = "dp-group__name"; h.textContent = g;
        const grid = document.createElement("div");
        grid.className = "dp-grid";
        CP.list.filter((p) => p.group === g).forEach((p) => {
          grid.appendChild(mkBtn(p.id, p.name));
        });
        wrap.appendChild(h); wrap.appendChild(grid);
        host.appendChild(wrap);
      });
      refreshSwatches();
    }

    // Only the patterns the chosen layout can actually use. The switch used to
    // leave the others in place and grey out half of itself once one was
    // picked; showing a shorter list says the same thing before the tap.
    //
    // A whole-card "art" pattern repeats nothing, so it is listed under the
    // single half only — which is also the half it belongs to, being one
    // drawing rather than a tile. It has to appear in one of them or it
    // would be unreachable.
    function filterPickerToLayout(animate) {
      if (!CP) return;
      const wantTile = designLayoutSel === "repeat";
      $("dpPatterns").querySelectorAll(".dp-group").forEach((g) => {
        const grid = g.querySelector(".dp-grid");
        let shown = 0;
        g.querySelectorAll(".dp-pat").forEach((b) => {
          const p = b.dataset.pat ? CP.byId[b.dataset.pat] : null;
          // the "no pattern" button has no pattern behind it and always stays
          const ok = !p || (wantTile ? !!p.tile : (!!p.motif || !!p.art));
          b.classList.toggle("is-out", !ok);
          if (ok) b.style.setProperty("--i", shown++);
        });
        g.hidden = shown === 0;              // no heading over an empty grid
        if (!animate || !grid) return;
        grid.classList.remove("refilter");
        void grid.offsetWidth;               // restart, same as the swatch pop
        grid.classList.add("refilter");
      });
    }

    function refreshSwatches() {
      if (!CP) return;
      // thumbnails sit on the café's current colour, so they have to follow it
      const sq = (btn) => btn.querySelector(".dp-pat__sq");
      $("dpPatterns").querySelectorAll(".dp-pat").forEach((b) => {
        const el = sq(b);
        el.style.setProperty("--sw-paper", shade(designAccentSel, -0.08));
        el.style.setProperty("--sw-paper2", shade(designAccentSel, -0.30));
        if (b.dataset.pat) CP.swatch(el, b.dataset.pat, segToLayout(designLayoutSel));
      });
      if (tuneUp) syncTuneHead();          // the sheet's head is one of them
      filterPickerToLayout(false);         // and the list follows the switch
    }

    // ---- the chosen pattern's own settings, as a sheet ----
    //
    // Choosing a pattern raises a sheet carrying that pattern's two controls.
    // It is deliberately not modal: the picker stays live underneath, so the
    // next pattern is one tap away and the sheet re-aims itself instead of
    // closing and coming back. The scrolling column is padded by the sheet's
    // measured height while it is up, so the last row of swatches can still
    // be reached.
    const tune = $("dpTune");
    let tuneUp = false;
    let tuneHeadId = null;              // the pattern the head is showing

    // the head repeats the swatch that was tapped — same square, same card
    // colour — so there is no doubt which pattern is being adjusted
    function syncTuneHead() {
      const p = patState && CP ? CP.byId[patState.pattern] : null;
      if (!p) return;
      const sq = $("dpTuneSq"), nm = $("dpTuneName");
      sq.style.setProperty("--sw-paper", shade(designAccentSel, -0.08));
      sq.style.setProperty("--sw-paper2", shade(designAccentSel, -0.30));
      CP.swatch(sq, p.id, segToLayout(designLayoutSel));
      nm.textContent = p.name;
      if (tuneUp && tuneHeadId && tuneHeadId !== p.id) {
        [sq, nm].forEach((el) => {
          el.classList.remove("swap");
          void el.offsetWidth;          // restart, same as the colour swatches
          el.classList.add("swap");
          el.addEventListener("animationend", () => el.classList.remove("swap"), { once: true });
        });
      }
      tuneHeadId = p.id;
    }

    // how much room the sheet needs is its own business — measured, not
    // guessed, because an art pattern drops the position control and the
    // sheet is then shorter
    function measureTune() {
      $("designPage").style.setProperty("--tune-h", Math.ceil(tune.getBoundingClientRect().height + 14) + "px");
    }

    function openTune() {
      if (!patState) return;
      if (!tuneUp) {
        tuneUp = true;
        tuneHeadId = null;              // a fresh open is not a swap
        tune.hidden = false;
        syncTuneHead();
        measureTune();
        void tune.offsetWidth;          // park first, then travel
        tune.classList.add("is-up");
        $("designPage").classList.add("tune-open");
      } else {
        syncTuneHead();
        measureTune();
      }
      syncTuneAffordance();
    }

    function closeTune(instant) {
      if (!tuneUp) return;
      tuneUp = false;
      tune.classList.remove("is-up");
      $("designPage").classList.remove("tune-open");
      if (instant) tune.hidden = true;
      // left in the DOM until it has finished leaving, and only if nothing
      // raised it again in the meantime
      else setTimeout(() => { if (!tuneUp) tune.hidden = true; }, 340);
      syncTuneAffordance();
    }

    // the way back in: a pattern stays chosen after the sheet is dismissed,
    // so its settings must not become unreachable
    function syncTuneAffordance() {
      $("dpTuneOpen").classList.toggle("is-on", !!patState && !tuneUp);
    }

    $("dpTuneDone").onclick = () => closeTune();
    $("dpTuneOpen").onclick = () => openTune();

    // Escape takes the sheet before it takes the page — capture, so the
    // page's own handler never sees the key while the sheet is up.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !tuneUp) return;
      e.stopPropagation();
      closeTune();
    }, true);

    // ... and a drag down on the head dismisses it, the way a sheet should.
    (() => {
      const zone = $("dpTuneDrag");
      let held = null, y0 = 0, dy = 0;
      zone.addEventListener("pointerdown", (e) => {
        if (!tuneUp || e.target.closest("#dpTuneDone")) return;
        held = e.pointerId; y0 = e.clientY; dy = 0;
        tune.classList.add("is-dragging");
        zone.setPointerCapture(held);
      });
      zone.addEventListener("pointermove", (e) => {
        if (held === null || e.pointerId !== held) return;
        const raw = e.clientY - y0;
        dy = raw < 0 ? raw / 5 : raw;   // upward pulls against a rubber band
        tune.style.transform = "translateY(" + dy.toFixed(1) + "px)";
      });
      const release = () => {
        if (held === null) return;
        held = null;
        tune.classList.remove("is-dragging");
        tune.style.transform = "";      // back to whatever the class says
        if (dy > 70) closeTune();
      };
      zone.addEventListener("pointerup", release);
      zone.addEventListener("pointercancel", release);
    })();

    function markSelected() {
      const cur = patState ? patState.pattern : "";
      $("dpPatterns").querySelectorAll(".dp-pat").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.pat === cur));
      });
    }

    // ---- the controls that depend on the choice ----
    function syncPatternControls() {
      const p = patState ? CP.byId[patState.pattern] : null;
      const has = !!p;
      $("dpPlaceGroup").hidden = !has || patState.layout === "art";
      $("dpStrengthGroup").hidden = !has;

      // the layout switch: locked patterns disable the half they cannot use
      const lockMotif = !!(p && p.motifOnly), lockTile = !!(p && p.tileOnly), isArt = !!(p && p.art);
      [...$("dpLayout").children].forEach((b) => {
        const wantsTile = b.dataset.layout === "repeat";
        b.disabled = isArt || (lockMotif && wantsTile) || (lockTile && !wantsTile);
      });
      const hint = isArt ? t("OWNER_DESIGN_HINT_ART")
                 : lockMotif ? t("OWNER_DESIGN_HINT_MOTIF")
                 : lockTile ? t("OWNER_DESIGN_HINT_TILE") : "";
      $("dpLayoutHint").textContent = hint;
      $("dpLayoutHint").hidden = !hint;

      if (!has || patState.layout === "art") return;

      // one control, two questions
      const isTile = patState.layout === "tile";
      $("dpPlaceLabel").textContent = t(isTile ? "OWNER_DESIGN_FADE" : "OWNER_DESIGN_PLACE");
      const opts = isTile
        ? [["none", t("OWNER_DESIGN_FADE_NONE")], ["top", t("OWNER_DESIGN_FADE_TOP")], ["corner", t("OWNER_DESIGN_FADE_CORNER")]]
        : (p.upright
            ? [["bottom", t("OWNER_DESIGN_PLACE_BR")], ["center", t("OWNER_DESIGN_PLACE_CENTER")]]
            : [["top", t("OWNER_DESIGN_PLACE_TOP")], ["bottom", t("OWNER_DESIGN_PLACE_BOTTOM")]]);
      const seg = $("dpPlace");
      seg.classList.toggle("seg--3", opts.length === 3);
      const cur = isTile ? (patState.fade || "none") : (patState.place || "bottom");
      seg.innerHTML = "";
      opts.forEach(([val, label]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "seg__btn" + (val === cur ? " is-on" : "");
        b.dataset.val = val; b.textContent = label;
        seg.appendChild(b);
      });
    }

    // What the slider says, and where its track stops being filled.
    //
    // The stored strength is an ink alpha in per cent (4-40) — a café owner
    // reading "40%" has no way to know that is as far as it goes. So the
    // number shown is the share of the maximum: 40 reads 100%, the default 12
    // reads 30%, the floor 4 reads 10%. Western digits, per the house rule,
    // and the element carries dir="ltr" so the % cannot swap sides.
    const strengthPct = (s) => Math.round((s / CP.MAX_STRENGTH) * 100);
    // the fill, unlike the label, is where the thumb physically is
    const strengthFill = (s) =>
      Math.round(((s - CP.MIN_STRENGTH) / (CP.MAX_STRENGTH - CP.MIN_STRENGTH)) * 100);

    function paintStrength(s) {
      const el = $("dpStrength"), pct = strengthPct(s);
      $("dpStrengthVal").textContent = pct + "%";
      el.style.setProperty("--fill", strengthFill(s) + "%");
      el.setAttribute("aria-valuetext", pct + "%");   // and the same to a reader
    }

    // Everything funnels through here: stage, normalise, redraw, repaint.
    function commitPatternState(next) {
      patState = CP ? CP.normalize(next) : null;
      if (patState) designLayoutSel = layoutToSeg(patState.layout);
      paintLayoutSwitch();
      markSelected();
      syncPatternControls();
      if (tuneUp) { syncTuneHead(); measureTune(); }
      syncTuneAffordance();
      refreshSwatches();
      paintPreviewPattern();
      if (patState) $("dpStrength").value = String(patState.strength);
      paintStrength(patState ? patState.strength : CP.DEFAULT_STRENGTH);
    }

    function selectPattern(id) {
      if (!id) { commitPatternState(null); closeTune(); return; }
      const keep = patState || {};
      commitPatternState({
        pattern: id,
        layout: segToLayout(designLayoutSel),
        fade: keep.fade, place: keep.place,
        strength: typeof keep.strength === "number" ? keep.strength : CP.DEFAULT_STRENGTH,
      });
      openTune();                      // chosen — now adjust it
    }

    function paintLayoutSwitch() {
      [...$("dpLayout").children].forEach((b) => b.classList.toggle("is-on", b.dataset.layout === designLayoutSel));
    }
    function setDesignLayout(v) {
      if (v === designLayoutSel) return;
      designLayoutSel = v;
      paintLayoutSwitch();
      if (patState) commitPatternState(Object.assign({}, patState, { layout: segToLayout(v) }));
      else refreshSwatches();
      filterPickerToLayout(true);
    }
    $("dpLayout").addEventListener("click", (e) => {
      const b = e.target.closest(".seg__btn"); if (!b || b.disabled) return;
      setDesignLayout(b.dataset.layout);
    });
    $("dpPlace").addEventListener("click", (e) => {
      const b = e.target.closest(".seg__btn"); if (!b || !patState) return;
      const k = patState.layout === "tile" ? "fade" : "place";
      commitPatternState(Object.assign({}, patState, { [k]: b.dataset.val }));
    });
    $("dpStrength").addEventListener("input", (e) => {
      const v = Number(e.target.value);
      paintStrength(v);
      if (!patState) return;
      // the slider is dragged, so the heavy path (rebuilding the segmented
      // control, redrawing 28 thumbnails) is skipped — only the number the
      // layer reads actually changes
      patState.strength = v;
      paintPreviewPattern();
    });

    const colourModal = $("colourModal");
    function openColourWindow() {
      colourAtOpen = designAccentSel;
      setDesignAccentUI(designAccentSel);
      colourModal.hidden = false;
      colourModal.setAttribute("aria-hidden", "false");
      $("designColourRow").setAttribute("aria-expanded", "true");
      $("colourDone").focus();
    }
    function closeColourWindow(revert) {
      if (colourModal.hidden) return;
      if (revert) setDesignAccentUI(colourAtOpen);
      colourModal.hidden = true;
      colourModal.setAttribute("aria-hidden", "true");
      $("designColourRow").setAttribute("aria-expanded", "false");
      $("designColourRow").focus();
    }
    $("designColourRow").onclick = openColourWindow;
    $("colourDone").onclick = () => closeColourWindow(false);
    $("colourCancel").onclick = () => closeColourWindow(true);
    // backdrop only, same as the sheets
    colourModal.addEventListener("pointerdown", (e) => { if (e.target === colourModal) closeColourWindow(true); });
    // Escape closes the window, and must not also close the page under it
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !colourModal.hidden) { e.stopPropagation(); closeColourWindow(true); }
    }, true);

    $("designEditBtn").onclick = () => designPage.open();
    $("designCancel").onclick = () => {
      setDesignAccentUI(savedAccent);
      commitPatternState(savedPattern);    // discards an unsaved pattern too
      designPage.close();
    };
    $("designSave").onclick = async () => {
      const nextPattern = CP ? CP.normalize(patState) : null;
      const patUnchanged = JSON.stringify(nextPattern) === JSON.stringify(savedPattern);
      if (designAccentSel === savedAccent && patUnchanged) { designPage.close(); return; }
      const btn = $("designSave");
      btn.disabled = true;
      try {
        // The name and type come from what is already saved, not from the
        // identity form's live inputs: an edit half-typed up there must not
        // ride along with a colour saved down here.
        const r = await fetch(API + "/owner/cafe/profile", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({
            cafe_name: savedCafeName, tagline: savedTagline,
            accent: designAccentSel, pattern: nextPattern,
          }),
        });
        const d = await r.json();
        if (r.ok) {
          savedAccent = d.accent || designAccentSel;
          // the server's answer, not the form's — it is the one that validated
          savedPattern = CP ? CP.normalize(d.pattern) : null;
          commitPatternState(savedPattern);
          renderIdentitySummary();
          designPage.close();
        } else { btn.disabled = false; }
      } catch (e) { btn.disabled = false; }
    };

    // ---------------- café logo ----------------
    // Optional. No logo means the customer's card renders exactly as it always
    // has — there is no placeholder on the card, only in this preview.
    function showLogo(collectionId, name) {
      const img = $("logoImg"), prev = $("logoPrev");
      const prevImg = $("ownPrevLogo");
      // the identity card's row shows the same circle from the same source,
      // so it cannot fall behind the form it summarises
      const sum = $("identSummaryLogo"), sumImg = $("identSummaryLogoImg");
      if (collectionId && name) {
        // cache-bust so a freshly replaced logo doesn't show the old one
        const url = API + "/api/files/" + collectionId + "/" + cafeId + "/" + encodeURIComponent(name) +
          "?thumb=240x240&r=" + Date.now();
        img.src = url;
        img.hidden = false; $("logoEmpty").hidden = true; prev.classList.add("has-img");
        $("logoRemove").hidden = false;
        prevImg.src = url; prevImg.hidden = false;
        sumImg.src = url; sumImg.hidden = false; sum.classList.add("has-img");
      } else {
        img.removeAttribute("src"); img.hidden = true;
        $("logoEmpty").hidden = false; prev.classList.remove("has-img");
        $("logoRemove").hidden = true;
        prevImg.removeAttribute("src"); prevImg.hidden = true;
        sumImg.removeAttribute("src"); sumImg.hidden = true; sum.classList.remove("has-img");
      }
    }

    function logoErr(msg) { $("logoErr").textContent = msg; $("logoErr").hidden = false; }
    function logoSaved() { $("logoOk").hidden = false; setTimeout(() => { $("logoOk").hidden = true; }, 1800); }

    async function uploadLogoBlob(blob) {
      const box = document.querySelector(".ident-box");
      box.classList.add("is-busy");
      try {
        const fd = new FormData();
        fd.append("logo", blob, "logo.png");
        // no Content-Type header — the browser sets the multipart boundary
        const r = await fetch(API + "/owner/cafe/logo", {
          method: "POST", headers: { Authorization: token }, body: fd,
        });
        const d = await r.json();
        if (r.ok) { showLogo(d.collection_id, d.logo); logoSaved(); }
        else logoErr(tErr(d, "OWNER_ERR_SAVE_FAILED"));
      } catch (e) { logoErr(t("AUTH_ERR_SERVER_UNREACHABLE")); }
      finally { box.classList.remove("is-busy"); }
    }

    $("logoPick").onclick = () => $("logoFile").click();

    // ---- position-in-circle step ----
    // The picked photo rarely IS a clean square logo, so instead of uploading
    // it as-is (and letting object-fit:cover on the card pick an arbitrary
    // crop), the owner drags/zooms it inside a circle here first. What gets
    // uploaded is a fresh square render of exactly that framing, not the
    // original file — so the 2MB/type limits on the server are about the
    // EXPORT, not what the owner's camera produced; the raw pick only gets a
    // generous sanity cap so a huge photo doesn't hang the browser decoding it.
    const cropStage = $("cropStage"), cropImg = $("cropImg"), cropZoom = $("cropZoom");
    const STAGE = 240, EXPORT = 480;
    let crop = null; // { iw, ih, baseScale, s, x, y }, or null while the modal is closed
    let dragging = null; // { startX, startY, x0, y0 }

    function clampCrop() {
      const dw = crop.iw * crop.s, dh = crop.ih * crop.s;
      crop.x = Math.min(0, Math.max(STAGE - dw, crop.x));
      crop.y = Math.min(0, Math.max(STAGE - dh, crop.y));
    }
    function renderCrop() {
      cropImg.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${crop.s})`;
    }
    function setZoom(pct) {
      const sNew = crop.baseScale * (pct / 100);
      // keep whatever image point is currently at the stage's centre still
      // centred after the rescale, instead of re-centring the whole image
      const cx = STAGE / 2, cy = STAGE / 2;
      const ix = (cx - crop.x) / crop.s, iy = (cy - crop.y) / crop.s;
      crop.s = sNew;
      crop.x = cx - ix * sNew;
      crop.y = cy - iy * sNew;
      clampCrop();
      renderCrop();
    }

    let cropFailTimer = 0;

    function closeCropper() {
      $("cropModal").hidden = true;
      $("cropModal").setAttribute("aria-hidden", "true");
      crop = null;
      clearTimeout(cropFailTimer);
      cropImg.onload = cropImg.onerror = null;
      cropImg.removeAttribute("src");
      $("logoFile").value = "";
    }

    // A photo that can't actually be shown must never leave the modal open
    // with an empty circle and no way out — this is the one thing that
    // happened live and is exactly what every guard below exists to prevent.
    function cropLoadFailed() {
      closeCropper();
      logoErr(t("OWNER_LOGO_ERR_LOAD_FAILED"));
    }

    function openCropper(file) {
      // data: URL, not URL.createObjectURL() — the CSP's img-src allows
      // 'self' and data: but not blob:, so an object URL silently fails to
      // load here (a real bug caught testing this, not a hypothetical)
      const reader = new FileReader();
      reader.onerror = cropLoadFailed;
      reader.onload = () => {
        cropImg.onerror = cropLoadFailed;
        cropImg.onload = () => {
          clearTimeout(cropFailTimer);
          const iw = cropImg.naturalWidth, ih = cropImg.naturalHeight;
          // some browsers fire "load" for a resource that didn't actually
          // decode (a blocked or corrupt image comes back as 0×0) — that is
          // a failure here, not a valid empty photo
          if (!iw || !ih) { cropLoadFailed(); return; }
          const baseScale = STAGE / Math.min(iw, ih); // just covers the circle at zoom 100
          crop = { iw, ih, baseScale, s: baseScale, x: (STAGE - iw * baseScale) / 2, y: (STAGE - ih * baseScale) / 2 };
          cropZoom.value = 100;
          renderCrop();
          $("cropModal").hidden = false;
          $("cropModal").setAttribute("aria-hidden", "false");
        };
        cropImg.src = reader.result;
        // belt-and-suspenders: if neither load nor error ever fires, don't
        // leave the owner stuck — fail out after a few seconds
        clearTimeout(cropFailTimer);
        cropFailTimer = setTimeout(cropLoadFailed, 8000);
      };
      reader.readAsDataURL(file);
    }

    // second and third way out, on top of the Cancel button: tapping the
    // dimmed backdrop, and Escape — a stuck modal with no exit is the thing
    // being fixed here
    $("cropModal").addEventListener("pointerdown", (e) => { if (e.target === $("cropModal")) closeCropper(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("cropModal").hidden) closeCropper(); });

    cropStage.addEventListener("pointerdown", (e) => {
      if (!crop) return;
      dragging = { startX: e.clientX, startY: e.clientY, x0: crop.x, y0: crop.y };
      cropStage.setPointerCapture(e.pointerId);
    });
    cropStage.addEventListener("pointermove", (e) => {
      if (!dragging || !crop) return;
      crop.x = dragging.x0 + (e.clientX - dragging.startX);
      crop.y = dragging.y0 + (e.clientY - dragging.startY);
      clampCrop();
      renderCrop();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => cropStage.addEventListener(ev, () => { dragging = null; }));
    cropZoom.addEventListener("input", () => { if (crop) setZoom(+cropZoom.value); });

    $("cropCancel").onclick = closeCropper;

    $("cropSave").onclick = () => {
      if (!crop) return;
      const canvas = document.createElement("canvas");
      canvas.width = EXPORT; canvas.height = EXPORT;
      const ctx = canvas.getContext("2d");
      const k = EXPORT / STAGE;
      ctx.drawImage(cropImg, crop.x * k, crop.y * k, crop.iw * crop.s * k, crop.ih * crop.s * k);
      canvas.toBlob((blob) => {
        closeCropper();
        if (blob) uploadLogoBlob(blob);
        else logoErr(t("OWNER_ERR_SAVE_FAILED"));
      }, "image/png");
    };

    $("logoFile").onchange = () => {
      const f = $("logoFile").files && $("logoFile").files[0];
      if (!f) return;
      $("logoErr").hidden = true; $("logoOk").hidden = true;
      // a generous sanity cap so a huge camera photo can't hang the browser
      // decoding it — the exported crop below is always small regardless
      if (f.size > 15728640) { logoErr(t("OWNER_LOGO_ERR_TOO_BIG")); $("logoFile").value = ""; return; }
      if (["image/jpeg", "image/png", "image/webp"].indexOf(f.type) === -1) {
        logoErr(t("OWNER_LOGO_ERR_TYPE")); $("logoFile").value = ""; return;
      }
      openCropper(f);
    };

    $("logoRemove").onclick = async () => {
      $("logoErr").hidden = true; $("logoOk").hidden = true;
      const box = document.querySelector(".ident-box");
      box.classList.add("is-busy");
      try {
        const r = await fetch(API + "/owner/cafe/logo/remove", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
        });
        const d = await r.json();
        if (r.ok) { showLogo("", ""); logoSaved(); }
        else logoErr(tErr(d, "OWNER_ERR_SAVE_FAILED"));
      } catch (e) { logoErr(t("AUTH_ERR_SERVER_UNREACHABLE")); }
      finally { box.classList.remove("is-busy"); }
    };

    // AWAITED, and before localStorage is touched: ownerPushSignout (in
    // owner.push.js) unsubscribes this phone from subscription reminders, and
    // that request authenticates with the token the next line deletes.
    // Without it, a signed-out phone keeps being told when a café it no
    // longer administers is about to lapse — and the switch that would turn
    // that off is now behind someone else's sign-in.
    //
    // Guarded on existence rather than assumed: owner.push.js returns early
    // on a browser with no push support, so the export may legitimately not
    // be there. Sign-out must never depend on it.
    $("signout").onclick = async () => {
      try { if (typeof window.ownerPushSignout === "function") await window.ownerPushSignout(); } catch (e) {}
      ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      location.replace("/business/signin");
    };

    // ---------------- analytics tab ----------------
    // Ported from the old standalone analytics.page.js (analytics.html is now
    // folded into this page as a fourth tab); its #content anchor became
    // #anContent here. The tab has no heading of its own — the cards say what
    // they are — so it opens straight into the deck. It fetches /owner/stats
    // lazily, the first time this tab is opened (see loadAnalytics()/
    // setOwnerTab below), not on every dashboard load.
    // The subscription row in Settings. Null means the café has no row yet —
    // said plainly rather than guessed at, because whether a café that
    // pre-dates billing counts as trialing or grandfathered is a commercial
    // decision, not something a dashboard should assert.
    const SUB_STATE = {
      trialing: "OWNER_SUB_TRIAL",
      past_due: "OWNER_SUB_PAST_DUE",
      cancelled: "OWNER_SUB_CANCELLED",
      expired: "OWNER_SUB_EXPIRED",
    };
    // The same button says different things depending on where the café is:
    // a trial has never paid, a lapsed one is being asked to come back, and a
    // café already paid up is only being offered more time — so that last one
    // steps back to an outline instead of selling at someone who already bought.
    function paintSubCta(sub, health) {
      const btn = $("subBuy"), label = $("subBuyLabel");
      if (!btn || !label) return;
      const status = (sub && sub.status) || "none";
      // health wins over status: a café inside its grace reads `active`, and
      // offering it a quiet "extend" would understate the situation
      const lapsing = health === "is-grace" || health === "is-off";
      const key = lapsing ? "OWNER_SUB_RENEW"
        : status === "active" ? "OWNER_SUB_EXTEND"
        : (status === "past_due" || status === "expired" || status === "cancelled") ? "OWNER_SUB_RENEW"
        : "OWNER_SUB_BUY";
      label.textContent = t(key);
      // Solid from the yellow state onwards. The quiet outline is for a café
      // with real time left and nothing to do; once the row has started
      // warning, the way to act on it should not be the faintest thing on the
      // screen. Green is the only state that gets the understated button.
      btn.classList.toggle("is-quiet", health === "is-ok");
    }

    // The row's colour comes from the DATE, not from `status`. Nothing moves
    // a subscription out of `active` when its period simply runs out — only a
    // payment rewrites that field — so trusting the status here would paint a
    // lapsed café green while the counter refuses its customers.
    const GRACE_DAYS = 7;                       // must match card.pb.js
    function paintSubscription(sub) {
      const row = $("setSubRow"), stateEl = $("setSubState"), pill = $("setSubPill"),
            capEl = $("setSubCap"), dateEl = $("setSubUntil");
      if (!row || !stateEl || !pill || !capEl || !dateEl) return;
      buySub = sub;

      if (!sub || !sub.status) {
        row.className = "srow subrow is-none";
        stateEl.textContent = t("OWNER_SUB_NONE");
        pill.hidden = true;
        capEl.textContent = "";
        dateEl.textContent = "—";
        paintSubCta(null);
        return;
      }

      const trial = sub.status === "trialing";
      stateEl.textContent = t(trial ? "OWNER_SUB_TRIAL"
        : sub.status === "active" ? (sub.plan === "yearly" ? "OWNER_SUB_ACTIVE_YEARLY" : "OWNER_SUB_ACTIVE")
        : (SUB_STATE[sub.status] || "OWNER_SUB_NONE"));

      // whole days, rounded UP: with six hours left an owner has "1 day", not 0
      const endMs = sub.until ? new Date(String(sub.until).replace(" ", "T")).getTime() : 0;
      const days = endMs ? Math.ceil((endMs - Date.now()) / 86400000) : null;
      const past = days !== null && days <= 0;

      // the caption carries the meaning the date cannot carry alone, and flips
      // tense once the date is behind them
      capEl.textContent = endMs
        ? t(trial ? (past ? "OWNER_SUB_TRIAL_ENDED_CAP" : "OWNER_SUB_TRIAL_ENDS_CAP")
                  : (past ? "OWNER_SUB_ENDED_CAP" : "OWNER_SUB_ENDS_CAP"))
        : "";
      dateEl.textContent = sub.until ? formatDateLocal(sub.until) : "—";

      let health = "is-ok", badge = "";
      if (days === null) {
        health = "is-none";
      } else if (days > GRACE_DAYS) {
        health = "is-ok";  badge = t("OWNER_SUB_PILL_DAYS", { n: days });
      } else if (days > 0) {
        health = "is-soon";
        badge = days === 1 ? t("OWNER_SUB_PILL_LAST") : t("OWNER_SUB_PILL_DAYS", { n: days });
      } else if (days > -GRACE_DAYS) {
        health = "is-grace";
        badge = t("OWNER_SUB_PILL_GRACE", { n: GRACE_DAYS + days });
      } else {
        health = "is-off";  badge = t("OWNER_SUB_PILL_OFF");
      }
      row.className = "srow subrow " + health;
      pill.textContent = badge;
      pill.hidden = !badge;
      paintSubCta(sub, health);
    }

    const plural1 = (n, one, many) => t(n === 1 ? one : many);
    const stampWord = (n) => plural1(n, "AN_STAMP_LC_ONE", "AN_STAMP_LC_MANY");
    // a "13-16" time-slot range reorders to "16-13" when embedded in Persian text —
    // isolate control chars keep its internal digit-hyphen-digit order intact.
    const isolateLTR = (s) => "⁦" + s + "⁩";
    // backend sends English 3-letter weekday abbreviations (dow / days / the leading
    // token of "label" strings like "Mon 31 Aug") — translate just that token client-side.
    const DOW_KEYS = { Sun: "DOW_SUN", Mon: "DOW_MON", Tue: "DOW_TUE", Wed: "DOW_WED", Thu: "DOW_THU", Fri: "DOW_FRI", Sat: "DOW_SAT" };
    const dow = (abbr) => (DOW_KEYS[abbr] ? t(DOW_KEYS[abbr]) : abbr);
    const translateLabel = (label) => {
      const sp = String(label).indexOf(" ");
      if (sp < 0) return label;
      const head = label.slice(0, sp);
      return DOW_KEYS[head] ? dow(head) + label.slice(sp) : label;
    };
    // The backend's `label` is English and Gregorian ("Sat 17 Oct"), which is
    // only a fallback now: every day row also carries its Iran-local `date`, so
    // the label gets rebuilt here in the reader's own calendar (Jalali on the
    // Persian UI) with the weekday translated. Rows without a date — the empty
    // "—" placeholder — keep going through translateLabel.
    // The trend charts (comeback rate, visit gap) carry the same pair as the day
    // rows: an English Gregorian `label` and an Iran-local `date`. Rebuild from
    // the date so they read in the viewer's calendar too, falling back to the
    // server's label if a row ever arrives without one.
    const seriesLabel = (x) => (x && x.date && formatDayMonthLocal(x.date)) || (x && x.label) || "";
    // A date needs isolating so neighbouring text cannot reorder its parts — the
    // same reason isolateLTR exists for "13-16" ranges. A Persian label's first
    // strong character is its month name, so first-strong isolation (U+2068)
    // keeps it RTL while the English form stays LTR.
    //
    // This also pins the chart labels. The chart containers are direction:ltr so
    // the time axis runs left to right, which would otherwise lay a Persian date
    // out day-first — the mirror image of the same date elsewhere in the app.
    // Isolating fixes the run's own direction without touching text-anchor,
    // which flipping the element's `direction` would have moved.
    const isolateDate = (s) => (getLang() === "fa" ? "\u2068" : "\u2066") + s + "\u2069";
    const dayLabel = (row) => {
      if (!row) return "";
      if (!row.date) return translateLabel(row.label);
      const dm = formatDayMonthLocal(row.date);
      return dm ? (row.dow ? dow(row.dow) + " " : "") + dm : translateLabel(row.label);
    };

    // ---- SVG donut helper (single-value ring, monochrome) ----
    function ring(pct, sub) {
      const r = 52, c = 2 * Math.PI * r, on = Math.max(0, Math.min(100, pct)) / 100 * c;
      return `<svg viewBox="0 0 130 130" class="donut">
        <circle cx="65" cy="65" r="${r}" fill="none" stroke="rgba(20,20,20,0.08)" stroke-width="14"/>
        <circle class="donut__val" cx="65" cy="65" r="${r}" fill="none" stroke="#171717" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${on.toFixed(1)} ${(c - on).toFixed(1)}" stroke-dashoffset="${on.toFixed(1)}" transform="rotate(-90 65 65)"/>
        <text x="65" y="66" text-anchor="middle" class="donut__num count" data-count-to="${pct}" data-count-suffix="%">0%</text>
        <text x="65" y="84" text-anchor="middle" class="donut__sub">${esc(sub)}</text>
      </svg>`;
    }

    function renderAnalytics(d) {
      const tot = d.totals, r = d.rates;
      if (!tot.customers && !tot.issued) {
        // Every .card starts at opacity:0 and only becomes visible once
        // revealCards()'s IntersectionObserver adds .in to it (see below) —
        // the full dashboard always reaches that call at the end of render(),
        // but this early return skipped it entirely, leaving the "no data
        // yet" message permanently invisible instead of just empty.
        $("anContent").innerHTML = `<div class="card glass"><p class="empty">${t("AN_EMPTY_HTML")}</p></div>`;
        revealCards();
        return;
      }

      // reward used rate — per-reward redemption %, last 30 days
      const usedRate = r.redemption;                 // pct(redeemed30, issued30)
      const rewardBars = d.byDeal.length ? d.byDeal.map((x) => {
        const p = x.issued > 0 ? Math.round(x.redeemed / x.issued * 100) : 0;
        return `<div class="ru-row">
          <div class="ru-row__top"><span class="ru-row__label">${esc(x.deal)}</span><span class="ru-row__val i18n-rtl">${t("AN_RU_ROW_VAL", { redeemed: x.redeemed, issued: x.issued })}${x.issued > 0 ? t("WALLET_LIST_SEP") + p + "%" : ""}</span></div>
          <div class="ru-row__track"><div class="ru-row__fill" style="width:${x.issued > 0 ? Math.max(p, 2) : 0}%"></div></div>
        </div>`;
      }).join("") : `<p class="empty">${t("AN_RU_NO_REWARDS")}</p>`;

      // The headline strip. These four are the answer to "how is the café
      // doing" at a glance; everything below is the working-out. Deltas are
      // only shown where the backend actually supplies a prior period —
      // inventing a comparison for the others would be worse than none.
      const d7 = (d.activity && d.activity.d7) || {};
      const stampDelta = (typeof d7.prevStamps === "number" && d7.prevStamps > 0)
        ? Math.round((d7.stamps - d7.prevStamps) / d7.prevStamps * 100) : null;
      const arrow = (n) => n > 0 ? "▲" : n < 0 ? "▼" : "•";
      const dirOf = (n) => n > 0 ? "up" : n < 0 ? "down" : "flat";
      const kpiDelta = (n, label) => n === null ? ""
        : `<i class="an-kpi__d ${dirOf(n)}">${arrow(n)} ${Math.abs(n)}% ${esc(label)}</i>`;
      const arDelta = d.activeRate && typeof d.activeRate.delta === "number" ? Math.round(d.activeRate.delta) : null;

      $("anContent").innerHTML = `
        <div class="an">
          <div class="an-hero">
            <div class="an-kpi an-kpi--stamps">
              <span class="an-kpi__k">${t("AN_KPI_STAMPS")}</span>
              <b class="an-kpi__v count" data-count-to="${tot.stamps}">0</b>
              ${kpiDelta(stampDelta, t("AN_KPI_VS_PREV"))}
            </div>
            <div class="an-kpi an-kpi--people">
              <span class="an-kpi__k">${t("AN_KPI_CUSTOMERS")}</span>
              <b class="an-kpi__v count" data-count-to="${tot.customers}">0</b>
              ${kpiDelta(arDelta, t("AN_KPI_ACTIVE"))}
            </div>
            <div class="an-kpi an-kpi--rate">
              <span class="an-kpi__k">${t("AN_KPI_COMEBACK")}</span>
              <b class="an-kpi__v count" data-count-to="${r.comeback}" data-count-suffix="%">0%</b>
            </div>
            <div class="an-kpi an-kpi--reward">
              <span class="an-kpi__k">${t("AN_KPI_REWARDS")}</span>
              <b class="an-kpi__v count" data-count-to="${tot.redeemed}">0</b>
              <i class="an-kpi__d flat">${t("AN_KPI_OF_ISSUED", { n: tot.issued })}</i>
            </div>
          </div>

          <div class="an-grid">
            <div class="card an-tile an-tile--wide" id="actCard"></div>
            <div class="card an-tile an-tile--wide" id="hmCard"></div>
            <div class="card an-tile" id="cbCard"></div>
            <div class="card an-tile" id="arCard"></div>
            <div class="card an-tile" id="vrCard"></div>
            <div class="card an-tile" id="nlCard"></div>
            <div class="card an-tile an-tile--wide" id="ruCard">
          <h2 class="card__title">${t("AN_RU_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
          <p class="card__sub">${t("AN_RU_SUB")}</p>
          <div class="cb-info" hidden>
            ${t("AN_RU_INFO_HTML")}
          </div>
          <div class="ru-hero">
            ${ring(usedRate, t("AN_RU_RING_SUB"))}
            <div class="ru-hero__txt">${t("AN_RU_HERO_HTML", { redeemed: tot.redeemed30, issued: tot.issued30 })}</div>
          </div>
              <div class="ru-list">${rewardBars}</div>
            </div>
          </div>
        </div>`;

      if (d.comeback) setupComeback(d.comeback);
      if (d.visitRhythm) setupVisitRhythm(d.visitRhythm);
      if (d.activeRate) setupActiveRate(d.activeRate);
      if (d.newVsLoyal) setupNewVsLoyal(d.newVsLoyal);
      if (d.crowded) setupCrowded(d.crowded);
      if (d.activity) setupActivity(d.activity);

      // The headline strip is not a .card, so revealCards()'s observer never
      // reaches it — its figures would sit at 0 forever. Count them up directly.
      const kpis = document.querySelector("#anContent .an-hero");
      if (kpis) runCounts(kpis, !matchMedia("(prefers-reduced-motion: reduce)").matches);

      const ruBtn = document.querySelector("#ruCard .info-btn");
      if (ruBtn) ruBtn.onclick = () => { const i = document.querySelector("#ruCard .cb-info"); i.hidden = !i.hidden; };

      revealCards();
    }

    // ---- entrance choreography: reveal cards on scroll + count up their numbers ----
    function countUp(el, to, dec, suf) {
      const dur = 950, t0 = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const v = to * e;
        el.textContent = (dec ? v.toFixed(dec) : Math.round(v)) + (suf || "");
        if (p < 1) requestAnimationFrame(tick);
      })(performance.now());
    }
    function runCounts(card, animate) {
      card.querySelectorAll("[data-count-to]").forEach((el) => {
        const to = parseFloat(el.dataset.countTo) || 0;
        const dec = parseInt(el.dataset.countDecimals || "0", 10);
        const suf = el.dataset.countSuffix || "";
        if (animate) countUp(el, to, dec, suf);
        else el.textContent = (dec ? to.toFixed(dec) : Math.round(to)) + suf;
      });
    }
    function revealCards() {
      const cards = Array.from(document.querySelectorAll("#anContent .card"));
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !("IntersectionObserver" in window)) {
        cards.forEach((c) => { c.classList.add("in"); runCounts(c, false); });
        return;
      }
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          el.classList.add("in");
          runCounts(el, true);
          setTimeout(() => { el.style.transitionDelay = ""; }, 750);
          obs.unobserve(el);
        });
      }, { threshold: 0.16, rootMargin: "0px 0px -6% 0px" });
      cards.forEach((c, i) => { c.style.transitionDelay = Math.min(i, 4) * 70 + "ms"; io.observe(c); });
    }

    // ---- crowded times: day × time-slot stamp heatmap ----
    function setupCrowded(c) {
      const card = $("hmCard");
      const max = c.max ? c.max.count : 0;
      // 0..1 intensity per cell; .hm__cell turns it into an alpha on the
      // panel accent, so the colour lives in one place in the stylesheet
      const cellV = (v) => (!max || v === 0) ? "0" : (0.12 + 0.88 * (v / max)).toFixed(3);
      const days = c.days.map(dow);

      let cells = `<div class="hm__corner"></div>` + c.slots.map((s) => `<div class="hm__sl">${esc(s)}</div>`).join("");
      c.grid.forEach((rowvals, r) => {
        cells += `<div class="hm__dl">${esc(days[r])}</div>`;
        cells += rowvals.map((v, s) =>
          `<button class="hm__cell" data-r="${r}" data-s="${s}" data-v="${v}" style="--v:${cellV(v)}" title="${esc(t("AN_HM_CELL_TITLE", { day: days[r], slot: isolateLTR(c.slots[s]), v, stampWord: stampWord(v) }))}"></button>`
        ).join("");
      });

      const ex = (o, kicker) => o
        ? `<div class="hm-ex"><span>${kicker}</span><b>${esc(dow(o.day))} · ${isolateLTR(esc(o.slot))}</b><br><i>${o.count} ${stampWord(o.count)}</i></div>`
        : `<div class="hm-ex"><span>${kicker}</span><b>—</b></div>`;

      card.innerHTML = `
        <h2 class="card__title">${t("AN_HM_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_HM_SUB", { days: c.windowDays })}</p>
        <div class="cb-info" hidden>
          ${t("AN_HM_INFO_HTML", { days: c.windowDays })}
        </div>
        <div class="hm">${cells}</div>
        <p class="cb-cap" id="hmCap">${max ? t("AN_HM_CAP_DEFAULT") : t("AN_HM_CAP_EMPTY", { days: c.windowDays })}</p>
        <div class="hm-extremes">${ex(c.max, t("AN_HM_BUSIEST"))}${ex(c.min, t("AN_HM_QUIETEST"))}</div>`;

      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
      const cap = $("hmCap");
      let selEl = null;
      card.querySelectorAll(".hm__cell").forEach((el) => el.onclick = () => {
        if (selEl) selEl.classList.remove("is-sel");
        el.classList.add("is-sel"); selEl = el;
        const v = +el.dataset.v;
        cap.innerHTML = t("AN_HM_SEL_CAP_HTML", { day: esc(days[+el.dataset.r]), slot: isolateLTR(esc(c.slots[+el.dataset.s])), v, stampWord: stampWord(v), days: c.windowDays });
      });
    }

    // ---- active rate: active-vs-all members bar + month-over-month arrow ----
    function setupActiveRate(ar) {
      const card = $("arCard");
      const up = ar.delta > 0, down = ar.delta < 0;
      const cls = up ? "up" : (down ? "down" : "flat");
      const arrow = up
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`
        : down
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`;
      const deltaTxt = (up ? "+" : down ? "−" : "") + Math.abs(ar.delta) + " " + t("AN_PTS");
      const fill = ar.total ? Math.max(3, (ar.active / ar.total) * 100) : 0;
      card.innerHTML = `
        <h2 class="card__title">${t("AN_AR_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_AR_SUB", { days: ar.windowDays })}</p>
        <div class="cb-info" hidden>
          ${t("AN_AR_INFO_HTML", { days: ar.windowDays })}
        </div>
        <div class="ar-top">
          <div class="ar-v"><span class="count" data-count-to="${ar.rate}" data-count-suffix="%">0%</span></div>
          <span class="ar-delta ${cls}">${arrow}<span class="i18n-rtl">${cls === "flat" ? t("AN_NO_CHANGE") : deltaTxt}</span></span>
        </div>
        <p class="ar-sub">${cls === "flat" ? t("AN_SAME_AS") : (up ? t("AN_UP_FROM") : t("AN_DOWN_FROM"))} ${t("AN_A_MONTH_AGO", { rate: ar.prevRate })}</p>
        <div class="ar-bar"><div class="ar-bar__fill" style="width:${fill}%"></div></div>
        <div class="ar-legend">
          <span><span class="dot dot--on"></span><b>${ar.active}</b><span class="i18n-rtl">${t("AN_AR_LEGEND_ACTIVE", { days: ar.windowDays })}</span></span>
          <span><span class="dot dot--all"></span><b>${ar.total}</b><span class="i18n-rtl">${t("AN_AR_LEGEND_TOTAL")}</span></span>
        </div>`;
      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
    }

    // ---- new vs loyal: split of the last-30-day active base ----
    function setupNewVsLoyal(nl) {
      const card = $("nlCard");
      let body;
      if (!nl.active) {
        body = `<p class="empty">${t("AN_NL_EMPTY", { days: nl.windowDays })}</p>`;
      } else {
        const newW = (nl.new / nl.active) * 100;
        // Taken off newRate rather than computed from nl.loyal: both come from
        // the same rounding, so pct(new) + pct(loyal) can land on 99 or 101 —
        // wrong-looking for two halves of one bar that add up by definition.
        const loyalRate = 100 - nl.newRate;
        body = `
          <div class="nl-top">
            <div class="nl-v"><span class="count" data-count-to="${nl.newRate}" data-count-suffix="%">0%</span><span class="i18n-rtl">${t("AN_NL_NEW_LABEL")}</span></div>
            <div class="nl-v"><span class="count" data-count-to="${loyalRate}" data-count-suffix="%">0%</span><span class="i18n-rtl">${t("AN_NL_LOYAL_LABEL")}</span></div>
          </div>
          <div class="nl-bar">
            <div class="nl-bar__seg nl-bar__seg--new" style="width:${newW}%"></div>
            <div class="nl-bar__seg nl-bar__seg--loyal" style="width:${100 - newW}%"></div>
          </div>
          <div class="nl-legend">
            <span><span class="dot dot--new"></span><b>${nl.new}</b><span class="i18n-rtl">${t("AN_NL_LEGEND_NEW", { days: nl.windowDays })}</span></span>
            <span><span class="dot dot--loyal"></span><b>${nl.loyal}</b><span class="i18n-rtl">${t("AN_NL_LEGEND_LOYAL")}</span></span>
          </div>`;
      }
      card.innerHTML = `
        <h2 class="card__title">${t("AN_NL_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_NL_SUB", { days: nl.windowDays })}</p>
        <div class="cb-info" hidden>
          ${t("AN_NL_INFO_HTML", { days: nl.windowDays })}
        </div>
        ${body}`;
      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
    }

    // ---- selected-point marker, shared by the two line charts ----
    // Drawn inside the SVG so it is expressed in viewBox units and scales with
    // the chart — no pixel measuring, unlike the activity chart's dot, whose
    // bars are real DOM elements. Sits between the line and the dots so the
    // transparent hit circles stay clickable on top of it.
    function chartMarkerSVG(padT, ih) {
      return `<g class="cb-marker" aria-hidden="true">
        <line class="cb-marker__rule" x1="0" y1="${padT}" x2="0" y2="${(padT + ih).toFixed(1)}"/>
        <g class="cb-marker__pt"><circle class="cb-marker__ring" r="5.5"/><circle class="cb-marker__core" r="1.9"/></g>
      </g>`;
    }

    // x rides on the outer group, y on the inner one — two transitions with
    // slightly different curves, which reads as a small arc rather than a slide.
    function moveChartMarker(card, x, y, animate) {
      const m = card.querySelector(".cb-marker");
      const pt = m && m.querySelector(".cb-marker__pt");
      if (!m || !pt) return;
      // a day with no reading has no point to mark — park the marker instead
      if (x == null) { m.classList.remove("is-on"); return; }
      if (!animate) { m.style.transition = "none"; pt.style.transition = "none"; }
      m.style.transform = "translateX(" + x + "px)";
      pt.style.transform = "translateY(" + y + "px)";
      if (!animate) {
        m.getBoundingClientRect();
        m.style.transition = ""; pt.style.transition = "";
      } else {
        restartAnim(m, "is-pop");
      }
      m.classList.add("is-on");
    }

    // Wire one line chart's points up to its headline, sub-line and caption.
    // Both cards behaved identically before — a tap rewrote the caption and
    // nothing else, so the big number kept showing the last day whatever you
    // touched. read(i) returns what that day should display.
    function wireChartSelection(card, hitSel, capEl, read) {
      let cur = -1;
      const num = card.querySelector(".cb-today__v .count");
      const unitEl = card.querySelector(".cb-today__u");
      const subEl = card.querySelector(".cb-today__k span");
      const select = (i, animate) => {
        if (i === cur) return;
        const dir = cur === -1 || i > cur ? 1 : -1;
        const d = read(i);
        cur = i;
        moveChartMarker(card, d.x, d.y, animate);
        if (num) {
          if (d.value == null) { num.textContent = "—"; }
          else if (animate) countBetween(num, parseFloat(num.textContent) || 0, d.value, 420, d.decimals, d.suffix);
          else num.textContent = (d.decimals ? d.value.toFixed(d.decimals) : String(Math.round(d.value))) + (d.suffix || "");
        }
        if (unitEl) unitEl.textContent = d.unit || "";
        if (subEl) {
          subEl.innerHTML = d.sub;
          subEl.style.setProperty("--dir", dir);
          if (animate) restartAnim(subEl, "is-swap");
        }
        if (capEl) {
          capEl.innerHTML = d.cap;
          capEl.style.setProperty("--dir", dir);
          if (animate) restartAnim(capEl, "is-swap");
        }
      };
      card.querySelectorAll(hitSel).forEach((el) => el.onclick = () => select(+el.dataset.i, true));
      return select;
    }

    // ---- comeback rate: today's number + a 14-day line chart ----
    function cbLineChart(series) {
      const W = 320, H = 132, padL = 6, padR = 6, padT = 10, padB = 20;
      const n = series.length, iw = W - padL - padR, ih = H - padT - padB;
      const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
      const Y = (v) => padT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
      const pts = series.map((s, i) => [X(i), Y(s.rate)]);
      const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const area = path + " L" + X(n - 1).toFixed(1) + " " + (padT + ih).toFixed(1) + " L" + X(0).toFixed(1) + " " + (padT + ih).toFixed(1) + " Z";
      const grid = [0, 50, 100].map((v) => {
        const y = Y(v).toFixed(1);
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(20,20,20,0.08)" stroke-width="1"/>`
          + `<text x="${W - padR}" y="${(Y(v) - 3).toFixed(1)}" text-anchor="end" font-size="8.5" font-weight="700" fill="var(--faint)">${v}%</text>`;
      }).join("");
      const dots = pts.map((p, i) => {
        const last = i === n - 1;
        return `<circle class="cb-dot${last ? " cb-dot--last" : ""}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${last ? 3.4 : 2}"/>`
          + `<circle class="cb-hit" data-i="${i}" data-x="${p[0].toFixed(1)}" data-y="${p[1].toFixed(1)}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="11" fill="transparent"><title>${isolateDate(esc(seriesLabel(series[i])))}: ${series[i].rate}%</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${isolateDate(esc(seriesLabel(series[i])))}</text>`
      ).join("");
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Comeback rate, last 14 days">
        ${grid}
        <path class="chart-area" d="${area}" fill="rgba(20,20,20,0.07)"/>
        <path class="chart-line" pathLength="1" d="${path}" fill="none" stroke="#171717" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${chartMarkerSVG(padT, ih)}${dots}${xlab}
      </svg>`;
    }

    function setupComeback(cb) {
      const card = $("cbCard");
      const s = cb.series || [];
      if (!s.length) { card.remove(); return; }
      const last = s[s.length - 1];
      card.innerHTML = `
        <h2 class="card__title">${t("AN_CB_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_CB_SUB", { days: cb.windowDays })}</p>
        <div class="cb-info" hidden>
          ${t("AN_CB_INFO_HTML", { days: cb.windowDays })}
        </div>
        <div class="cb-today">
          <div class="cb-today__v"><span class="count" data-count-to="${last.rate}" data-count-suffix="%">0%</span></div>
          <div class="cb-today__k">${t("AN_TODAY_LAST_DAYS", { days: cb.windowDays })}<span>${t("AN_CB_RETURNERS", { returners: last.returners, newMembers: last.newMembers })}</span></div>
        </div>
        <div class="cb-chart">${cbLineChart(s)}</div>
        <p class="cb-cap" id="cbCap"></p>`;
      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
      const hits = card.querySelectorAll(".cb-hit");
      const select = wireChartSelection(card, ".cb-hit", $("cbCap"), (i) => {
        const x = s[i], hit = hits[i];
        return {
          x: +hit.dataset.x, y: +hit.dataset.y,
          value: x.rate, decimals: 0, suffix: "%",
          sub: t("AN_CB_RETURNERS", { returners: x.returners, newMembers: x.newMembers }),
          cap: t("AN_CB_CAP_HTML", { days: cb.windowDays, label: isolateDate(esc(seriesLabel(x))), rate: x.rate, returners: x.returners, newMembers: x.newMembers }),
        };
      });
      select(s.length - 1, false);  // today, parked without a transition
    }

    // ---- visit rhythm: median gap between visits + a 14-day line chart ----
    function vrLineChart(series) {
      const vals = series.map((s) => s.value).filter((v) => v != null);
      if (!vals.length) return `<p class="empty">${t("AN_VR_NOT_ENOUGH")}</p>`;
      const W = 320, H = 132, padL = 6, padR = 6, padT = 10, padB = 20;
      const n = series.length, iw = W - padL - padR, ih = H - padT - padB;
      let maxV = Math.max(...vals); if (maxV <= 0) maxV = 1;
      const step = maxV <= 5 ? 1 : (maxV <= 10 ? 2 : (maxV <= 30 ? 5 : 10));
      const yMax = Math.max(step, Math.ceil(maxV / step) * step);
      const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
      const Y = (v) => padT + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
      let path = "", pen = false;
      series.forEach((s, i) => { if (s.value == null) { pen = false; return; } path += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(s.value).toFixed(1) + " "; pen = true; });
      // "3 روز" / "3 days", never a bare English "d": this axis is read by a
      // Persian owner, and the caption under the chart already says "روز".
      const dayWord = (v) => plural1(v, "OWNER_UNIT_DAY", "OWNER_UNIT_DAYS");
      const fmtY = (v) => { const n = v % 1 ? v.toFixed(1) : v; return n + " " + dayWord(v); };
      const grid = [0, yMax / 2, yMax].map((v) => {
        const y = Y(v).toFixed(1);
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(20,20,20,0.08)" stroke-width="1"/>`
          + `<text x="${W - padR}" y="${(Y(v) - 3).toFixed(1)}" text-anchor="end" font-size="8.5" font-weight="700" fill="var(--faint)">${fmtY(v)}</text>`;
      }).join("");
      const dots = series.map((s, i) => {
        if (s.value == null) return "";
        const last = i === n - 1;
        return `<circle class="cb-dot${last ? " cb-dot--last" : ""}" cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="${last ? 3.4 : 2}"/>`
          + `<circle class="vr-hit" data-i="${i}" data-x="${X(i).toFixed(1)}" data-y="${Y(s.value).toFixed(1)}" cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="11" fill="transparent"><title>${isolateDate(esc(seriesLabel(s)))}: ${s.value} ${dayWord(s.value)}</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${isolateDate(esc(seriesLabel(series[i])))}</text>`
      ).join("");
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visit rhythm, last 14 days">
        ${grid}
        <path class="chart-line" pathLength="1" d="${path.trim()}" fill="none" stroke="#171717" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${chartMarkerSVG(padT, ih)}${dots}${xlab}
      </svg>`;
    }

    function setupVisitRhythm(vr) {
      const card = $("vrCard");
      const s = vr.series || [];
      if (!s.length) { card.remove(); return; }
      const last = s[s.length - 1];
      const unit = (v) => plural1(v, "OWNER_UNIT_DAY", "OWNER_UNIT_DAYS");
      const customerWord = (n) => plural1(n, "AN_CUSTOMER_LC_ONE", "AN_CUSTOMER_LC_MANY");
      card.innerHTML = `
        <h2 class="card__title">${t("AN_VR_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_VR_SUB", { days: vr.windowDays })}</p>
        <div class="cb-info" hidden>
          ${t("AN_VR_INFO_HTML", { days: vr.windowDays })}
        </div>
        <div class="cb-today">
          <!-- both spans are always present, even on a day with no reading, so
               picking a different point can fill them in (the old markup left
               them out entirely and the headline could never recover) -->
          <div class="cb-today__v"><span class="count"${last.value == null ? "" : ` data-count-to="${last.value}" data-count-decimals="${Number.isInteger(last.value) ? 0 : 1}"`}>${last.value == null ? "—" : "0"}</span><span class="cb-today__u">${last.value == null ? "" : unit(last.value)}</span></div>
          <div class="cb-today__k">${t("AN_TODAY_LAST_DAYS", { days: vr.windowDays })}<span>${t("AN_VR_CUSTOMERS_MEASURED", { n: last.customers, customerWord: customerWord(last.customers) })}</span></div>
        </div>
        <div class="cb-chart">${vrLineChart(s)}</div>
        <p class="cb-cap" id="vrCap"></p>`;
      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
      // a day with no reading has no dot and so no hit circle — index by date
      // rather than by position in the NodeList
      const hits = {};
      card.querySelectorAll(".vr-hit").forEach((el) => { hits[el.dataset.i] = el; });
      const select = wireChartSelection(card, ".vr-hit", $("vrCap"), (i) => {
        const x = s[i], hit = hits[i];
        return {
          x: hit ? +hit.dataset.x : null, y: hit ? +hit.dataset.y : null,
          value: x.value, decimals: Number.isInteger(x.value) ? 0 : 1, suffix: "",
          unit: x.value == null ? "" : unit(x.value),
          sub: t("AN_VR_CUSTOMERS_MEASURED", { n: x.customers, customerWord: customerWord(x.customers) }),
          cap: x.value == null
            ? t("AN_VR_CAP_EMPTY_HTML", { days: vr.windowDays, label: isolateDate(esc(seriesLabel(x))) })
            : t("AN_VR_CAP_HTML", { days: vr.windowDays, label: isolateDate(esc(seriesLabel(x))), value: x.value, unit: unit(x.value), n: x.customers, customerWord: customerWord(x.customers) }),
        };
      });
      select(s.length - 1, false);  // today, parked without a transition
    }

    // ---- interactive daily stamp activity card ----
    let ACT = null, actPeriod = 7, actSel = null, actInfoOpen = false;

    function activityCardHTML(data) {
      if (!actSel || !data.days.some((x) => x.date === actSel)) actSel = data.days[data.days.length - 1].date;
      const sel = data.days.find((x) => x.date === actSel) || { label: "—", stamps: 0, members: 0, rewards: 0 };
      let cmpCls = "flat", cmpTxt;
      if (data.prevStamps > 0) {
        const chg = Math.round((data.stamps - data.prevStamps) / data.prevStamps * 100);
        cmpCls = chg > 0 ? "up" : (chg < 0 ? "down" : "flat");
        cmpTxt = chg === 0
          ? t("AN_ACT_CMP_FLAT", { period: actPeriod })
          : t("AN_ACT_CMP_CHANGE", { pct: Math.abs(chg), period: actPeriod, dir: t(chg > 0 ? "AN_ACT_CMP_UP" : "AN_ACT_CMP_DOWN") });
      } else {
        cmpTxt = data.stamps > 0 ? t("AN_ACT_CMP_FIRST") : t("AN_ACT_CMP_NONE");
      }
      // daily mean of each metric over the last 30 days (always the 30-day window)
      const d30 = (ACT && ACT.d30 && ACT.d30.days) ? ACT.d30.days : [];
      const mean = (key) => d30.length ? Math.round(d30.reduce((a, x) => a + x[key], 0) / d30.length * 10) / 10 : 0;
      const mStamps = mean("stamps"), mMembers = mean("members"), mRewards = mean("rewards");
      const max = Math.max(1, ...data.days.map((x) => x.stamps));
      const bars = data.days.map((x, i) => {
        const h = (x.stamps / max * 100).toFixed(1);
        let lab = actPeriod === 7 ? dow(x.dow) : ((i % 5 === 0 || i === data.days.length - 1) ? formatDayNumLocal(x.date) : "");
        return `<button class="act-bar${x.date === actSel ? " is-sel" : ""}" data-date="${x.date}" data-i="${i}" title="${isolateDate(esc(dayLabel(x)))}"><span class="act-bar__fill" style="height:${h}%"></span><span class="act-bar__lab">${esc(lab)}</span></button>`;
      }).join("");
      return `
        <h2 class="card__title">${t("AN_ACT_TITLE")} <button class="info-btn" type="button" aria-label="${t("AN_ARIA_INFO")}">i</button></h2>
        <p class="card__sub">${t("AN_ACT_SUB")}</p>
        <div class="cb-info"${actInfoOpen ? "" : " hidden"}>
          ${t("AN_ACT_INFO_HTML")}
        </div>
        <div class="act-toggle">
          <button data-p="7" class="${actPeriod === 7 ? "is-on" : ""}">${t("AN_ACT_7DAYS")}</button>
          <button data-p="30" class="${actPeriod === 30 ? "is-on" : ""}">${t("AN_ACT_30DAYS")}</button>
        </div>
        <div class="act-sel">
          <div class="act-sel__head"><span class="act-sel__dot"></span><b>${esc(dayLabel(sel))}</b><span class="act-sel__tag">${t("AN_ACT_SELECTED_DAY")}</span></div>
          <div class="act-sel__stats">
            <div class="act-sel__stat act-sel__stat--hero"><b>${sel.stamps}</b><span>${plural1(sel.stamps, "AN_STAMP_ONE", "AN_STAMP_MANY")}</span><i class="i18n-rtl">${t("AN_30DAY_AVG", { n: mStamps })}</i></div>
            <div class="act-sel__stat"><b>${sel.members}</b><span>${plural1(sel.members, "AN_MEMBER_ONE", "AN_MEMBER_MANY")}</span><i class="i18n-rtl">${t("AN_30DAY_AVG", { n: mMembers })}</i></div>
            <div class="act-sel__stat"><b>${sel.rewards}</b><span>${plural1(sel.rewards, "AN_REWARD_ONE", "AN_REWARD_MANY")}</span><i class="i18n-rtl">${t("AN_30DAY_AVG", { n: mRewards })}</i></div>
          </div>
        </div>
        <div class="act-chart"><span class="act-ymax">${max}</span><span class="act-cursor" aria-hidden="true"></span><div class="act-bars">${bars}</div></div>
        <div class="act-stats">
          <div><b>${data.stamps}</b><span>${t("AN_STAMP_MANY")}</span></div>
          <div><b>${data.members}</b><span>${t("AN_MEMBER_MANY")}</span></div>
          <div><b>${data.rewards}</b><span>${t("AN_REWARD_MANY")}</span></div>
        </div>
        <p class="act-cmp ${cmpCls}">${esc(cmpTxt)}</p>`;
    }

    const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Replay a one-shot entrance class on an element that is already in the DOM.
    // Removing and re-adding in the same frame is a no-op without the forced
    // reflow in between, so the animation would only ever play once.
    function restartAnim(el, cls) {
      el.classList.remove(cls);
      if (reduceMotion()) return;
      el.getBoundingClientRect();  // forces the reflow; works on SVG nodes too, unlike offsetWidth
      el.classList.add(cls);
    }

    // Roll a figure from where it currently reads to its new value. countUp()
    // above always starts at zero, which is right for a card appearing for the
    // first time and wrong for swapping between two days — 22 → 16 should count
    // down, not drop to 0 and climb back.
    function countBetween(el, from, to, dur, dec, suf) {
      const d = dec || 0, s = suf || "";
      const show = (v) => (d ? v.toFixed(d) : String(Math.round(v))) + s;
      if (reduceMotion() || from === to) { el.textContent = show(to); return; }
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);  // easeOutCubic, same curve as countUp
        el.textContent = show(from + (to - from) * e);
        if (p < 1) requestAnimationFrame(tick);
      })(performance.now());
    }

    // Park the ink dot above the selected bar. Both the bar and its fill are
    // static, so .act-chart (position: relative) is their offsetParent and the
    // two measurements share its origin. animate=false snaps it there without a
    // transition, for a fresh render or a resize.
    function placeActCursor(card, btn, animate) {
      const cur = card.querySelector(".act-cursor");
      if (!cur) return;
      const fill = btn && btn.querySelector(".act-bar__fill");
      // no layout yet (panel still hidden) — leave the dot off rather than at 0,0
      if (!fill || !btn.offsetWidth) { cur.style.opacity = "0"; return; }
      const xy = "translate(" + (btn.offsetLeft + btn.offsetWidth / 2) + "px," + fill.offsetTop + "px)";
      if (animate) {
        cur.style.transform = xy;
      } else {
        cur.style.transition = "none";
        cur.style.transform = xy;
        void cur.offsetWidth;
        cur.style.transition = "";
      }
      cur.style.opacity = "1";
    }

    // Picking a day patches the card in place instead of re-rendering it. The
    // old handler reassigned innerHTML, which replaced the very elements the
    // transitions run on — so the ink, the dot and the figures had nothing to
    // animate from. Only the selection changes here: bar heights, the totals row
    // and the comparison line all belong to the 7/30 window, not to one day.
    function selectActivityDay(date) {
      const card = $("actCard");
      if (!card || !ACT) return;
      const data = actPeriod === 30 ? ACT.d30 : ACT.d7;
      const sel = data.days.find((x) => x.date === date);
      const btn = card.querySelector('.act-bar[data-date="' + date + '"]');
      if (!sel || !btn || date === actSel) return;
      const prev = card.querySelector(".act-bar.is-sel");
      const dir = prev && parseInt(btn.dataset.i, 10) < parseInt(prev.dataset.i, 10) ? -1 : 1;
      actSel = date;

      if (prev) prev.classList.remove("is-sel");
      btn.classList.add("is-sel");
      placeActCursor(card, btn, true);

      const head = card.querySelector(".act-sel__head b");
      if (head) {
        head.textContent = dayLabel(sel);
        head.style.setProperty("--dir", dir);
        restartAnim(head, "is-swap");
      }
      const vals = [sel.stamps, sel.members, sel.rewards];
      card.querySelectorAll(".act-sel__stat").forEach((s, i) => {
        const b = s.querySelector("b");
        if (b) countBetween(b, parseInt(b.textContent, 10) || 0, vals[i], 420);
        restartAnim(s, "is-swap");
      });
    }

    function renderActivity() {
      const card = $("actCard");
      if (!card || !ACT) return;
      card.innerHTML = activityCardHTML(actPeriod === 30 ? ACT.d30 : ACT.d7);
      card.querySelectorAll(".act-toggle button").forEach((b) => b.onclick = () => { actPeriod = parseInt(b.dataset.p, 10); actSel = null; renderActivity(); });
      card.querySelectorAll(".act-bar").forEach((b) => b.onclick = () => selectActivityDay(b.dataset.date));
      const ib = card.querySelector(".info-btn");
      if (ib) ib.onclick = () => { actInfoOpen = !actInfoOpen; card.querySelector(".cb-info").hidden = !actInfoOpen; };
      placeActCursor(card, card.querySelector(".act-bar.is-sel"), false);
    }

    // the dot is positioned in pixels, so it has to be re-measured when the bars
    // are re-laid out
    addEventListener("resize", () => {
      const card = $("actCard");
      if (card) placeActCursor(card, card.querySelector(".act-bar.is-sel"), false);
    });

    function setupActivity(activity) { ACT = activity; actPeriod = 7; actSel = null; renderActivity(); }

    let analyticsLoaded = false;
    async function loadAnalytics() {
      try {
        const res = await fetch(API + "/owner/stats", { method: "POST", headers: { Authorization: token } });
        if (!res.ok) { $("anContent").innerHTML = `<div class="card glass"><p class="empty">${t("AN_ERR_LOAD_FAILED")}</p></div>`; return; }
        renderAnalytics(await res.json());
      } catch (e) {
        $("anContent").innerHTML = `<div class="card glass"><p class="empty">${t("AUTH_ERR_SERVER_UNREACHABLE")}</p></div>`;
      }
    }

    // ---------------- bottom tab bar ----------------
    // Same sliding-indicator pattern as the customer wallet's tabbar
    // (index.html / app.js setTab): each tab maps to one .panel.
    const tabbarEl = $("tabbar");
    const panelBtns = { analytics: $("tabAnalytics"), discounts: $("tabDiscounts"), card: $("tabCard"), settings: $("tabSettings") };
    const panels = { analytics: $("panelAnalytics"), discounts: $("panelDiscounts"), card: $("panelCard"), settings: $("panelSettings") };
    const TAB_INDEX = { analytics: 0, card: 1, discounts: 2, settings: 3 };

    function setOwnerTab(name) {
      tabbarEl.style.setProperty("--ti", TAB_INDEX[name]);
      for (const k in panelBtns) panelBtns[k].classList.toggle("is-active", k === name);
      for (const k in panels) panels[k].hidden = k !== name;
      // fetch /owner/stats only the first time the owner actually opens this
      // tab, not on every dashboard load — analytics is a heavier call than
      // café/rewards and most sessions never visit it
      if (name === "analytics" && !analyticsLoaded) { analyticsLoaded = true; loadAnalytics(); }
    }
    $("tabAnalytics").onclick = () => setOwnerTab("analytics");
    $("tabDiscounts").onclick = () => setOwnerTab("discounts");
    $("tabCard").onclick = () => setOwnerTab("card");
    $("tabSettings").onclick = () => setOwnerTab("settings");

    // land on the tab the owner actually asked for — e.g. a bookmarked
    // "/owner#analytics" — instead of always resetting to Card, the static
    // HTML's default tab
    const initialTab = ["analytics", "discounts", "card", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "card";
    setOwnerTab(initialTab);

    loadCafe().then(loadRewards);

    // First-visit welcome tip — the flag business.js sets right after a
    // self-serve registration succeeds. Consumed (and cleared) here so it
    // only ever shows once, the moment the owner actually reaches their new
    // dashboard, rather than on every later sign-in.
    (function () {
      let seen = false;
      try { seen = localStorage.getItem("loytap_owner_first_visit") === "1"; } catch (e) {}
      if (!seen) return;
      try { localStorage.removeItem("loytap_owner_first_visit"); } catch (e) {}
      const tip = $("firstVisitTip");
      tip.hidden = false;
      tip.setAttribute("aria-hidden", "false");
      function closeTip() {
        tip.hidden = true;
        tip.setAttribute("aria-hidden", "true");
      }
      $("firstVisitTipClose").addEventListener("click", closeTip);
      // same dismiss pattern as #cropModal above: click the backdrop, or Escape
      tip.addEventListener("pointerdown", (e) => { if (e.target === tip) closeTip(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tip.hidden) closeTip(); });
    })();
