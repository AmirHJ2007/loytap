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

    function unitWord(unit, amt) {
      const key = { day: amt > 1 ? "OWNER_UNIT_DAYS" : "OWNER_UNIT_DAY",
        week: amt > 1 ? "OWNER_UNIT_WEEKS" : "OWNER_UNIT_WEEK",
        month: amt > 1 ? "OWNER_UNIT_MONTHS" : "OWNER_UNIT_MONTH" }[unit];
      return key ? t(key) : unit;
    }
    let cafeId = "";

    async function loadCafe() {
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
          stampsVal = d.stamps_required || 8; renderStamps();
          $("fMinPurchase").value = d.min_purchase ? d.min_purchase : "";
          refreshOwnPreviewMin(d.min_purchase);
          showLogo(d.collection_id, d.logo);
          $("fCafeName").value = d.cafe_name || "";
          refreshOwnPreviewName();
          setIdentType(d.tagline || "Cafe");
          identAccentSel = d.accent || "#171717";
          setIdentAccentUI(identAccentSel);
          savedCafeName = d.cafe_name || ""; savedTagline = d.tagline || "Cafe"; savedAccent = identAccentSel;
          showIdentitySummary();
          try { localStorage.setItem("loytap_cafe", d.cafe_name || ""); } catch (e) {}
        }
      } catch (e) {}
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
          const dial = `<span class="rw__dial${x.active ? "" : " rw__dial--off"}" style="--off:${off}"
              role="img" aria-label="${x.active ? esc(t("OWNER_RW_CHANCE", { p: pct[i] })) : esc(t("OWNER_TAG_HIDDEN"))}">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle class="rw__dial-t" cx="22" cy="22" r="19" />
              <circle class="rw__dial-v" cx="22" cy="22" r="19" />
            </svg>
            <span class="rw__dial-n" aria-hidden="true">${x.active ? pct[i] : "–"}<i>${x.active ? "%" : ""}</i></span>
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
      if (!deal) { $("fDeal").focus(); return; }
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

    // opening and closing live with the other sheets, further down — the
    // helper that does it is defined there
    $("saveBtn").onclick = addReward;
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
    $("ownPrevStamp").onclick = () => ownPreviewStamp();

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
    // Preview stamping state. Declared above rebuildOwnPreviewGrid because it
    // resets them and `let` has no hoisting — the functions below can be
    // defined after their caller, these cannot.
    const STAMPER_W = 120, BASE_OFFSET = 100;
    let ownPrevStamped = 0, ownPrevBusy = false;

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
        // same three children the wallet builds (app.js buildCard), so the
        // stamped state below has the same things to animate
        s.innerHTML = `<span class="halo"></span><span class="slot__num">${i + 1}</span>` +
          `<span class="stamp"><img class="stamp-mark" src="knot-stamp.png?v=1" alt="" /></span>`;
        grid.appendChild(s);
      }
      $("ownPrevTotal").textContent = n;
      resetOwnPreviewStamps();   // a card with a new number of slots starts empty
    }

    // ---------------- the preview's own Stamp button ----------------
    // A demo, and only a demo. It presses a stamp onto the preview card with
    // the animation a customer sees and stops there: no stamp_event, no
    // membership, no reward when the card fills, no confetti. The owner is
    // looking at their own card, not working a till — the real thing happens
    // on the customer's phone against the staff scanner.
    //
    // A full card starts over on the next press rather than going dead, so
    // the whole sequence can be watched more than once.
    function resetOwnPreviewStamps() {
      ownPrevStamped = 0;
      const grid = $("ownPrevGrid");
      if (grid) grid.querySelectorAll(".slot").forEach((s) => {
        s.classList.remove("is-stamped", "impact");
        ["--r", "--dx", "--dy", "--sa"].forEach((v) => s.style.removeProperty(v));
      });
      const count = document.querySelector("#ownPreview .oram-mini .count");
      if (count) count.textContent = "0";
    }

    function ownPreviewStamp() {
      if (ownPrevBusy) return;
      const slots = [...$("ownPrevGrid").querySelectorAll(".slot")];
      if (!slots.length) return;
      if (ownPrevStamped >= slots.length) { resetOwnPreviewStamps(); return; }

      const slot = slots[ownPrevStamped];
      ownPrevStamped++;
      // the jitter the backend sends with a real stamp, rolled here instead:
      // a few px of slop and a few degrees of tilt, so no two land identically
      const v = {
        dx: Math.round((Math.random() - 0.5) * 7),
        dy: Math.round((Math.random() - 0.5) * 7),
        r: Math.round((Math.random() - 0.5) * 24),
        sa: (0.86 + Math.random() * 0.14).toFixed(2),
      };
      ownPrevBusy = true;
      playOwnPreviewStamp(slot, v, () => {
        slot.style.setProperty("--r", v.r + "deg");
        slot.style.setProperty("--dx", v.dx + "px");
        slot.style.setProperty("--dy", v.dy + "px");
        slot.style.setProperty("--sa", v.sa);
        slot.classList.add("is-stamped");
        slot.classList.remove("impact"); void slot.offsetWidth; slot.classList.add("impact");
        const count = document.querySelector("#ownPreview .oram-mini .count");
        if (count) count.textContent = String(ownPrevStamped);
        const btn = $("ownPrevStamp");
        btn.classList.remove("pulse"); void btn.offsetWidth; btn.classList.add("pulse");
        const card = document.querySelector("#ownPreview .card");
        if (card && card.animate) card.animate(
          [{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" },
           { transform: "translate(3px,-1px)" }, { transform: "translate(0,0)" }],
          { duration: 260, easing: "ease" });
      }, () => { ownPrevBusy = false; });
    }

    // the tool's flight, lifted from app.js playStamp() — same keyframes, same
    // 336ms to contact, so the press lands on the beat a customer knows
    function playOwnPreviewStamp(slot, v, onContact, onDone) {
      const tool = $("ownStamper");
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!tool || reduced || !tool.animate) { onContact(); onDone(); return; }
      const rect = slot.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - STAMPER_W / 2 + v.dx;
      const yHit = rect.top + rect.height / 2 + v.dy - BASE_OFFSET;
      const up = yHit - 320;
      // the previous press leaves a fill:forwards animation in effect; two of
      // them on the same element composite into a half-faded tool
      tool.getAnimations().forEach((a) => a.cancel());
      clearTimeout(tool._bail);
      tool.style.opacity = "1";
      const anim = tool.animate([
        { transform: `translate(${x}px, ${up}px) rotate(-8deg) scale(1.08,1.08)`, opacity: 0, offset: 0 },
        { transform: `translate(${x}px, ${up + 150}px) rotate(-4deg) scale(1.08,1.08)`, opacity: 1, offset: 0.14 },
        { transform: `translate(${x}px, ${yHit}px) rotate(0deg) scale(1.07,0.9)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${x}px, ${yHit - 4}px) rotate(0deg) scale(0.99,1.02)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x}px, ${yHit - 16}px) rotate(2deg) scale(1,1)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${x}px, ${up}px) rotate(7deg) scale(1.05,1.05)`, opacity: 0, offset: 1 },
      ], { duration: 840, easing: "cubic-bezier(0.45,0.05,0.35,1)", fill: "forwards" });
      // Both halves run exactly once, by whichever path gets there first. A
      // backgrounded tab freezes the animation and onfinish never arrives, so
      // the timer below has to FINISH the press, not merely unlock the button
      // — the slot is counted the moment it is claimed, and a press that is
      // released without its stamp landing leaves the count ahead of the card.
      let touched = false, ended = false;
      const contact = () => { if (!touched) { touched = true; onContact(); } };
      const end = () => { if (ended) return; ended = true; tool.style.opacity = "0"; contact(); onDone(); };
      setTimeout(contact, 336);
      anim.onfinish = end;
      tool._bail = setTimeout(end, 1500);
    }

    let identTypeSel = "Cafe";
    let identAccentSel = ACCENTS[0];
    const identCustomWrap = $("fAccentCustomWrap");
    const identSwatchEls = {}; // hex -> button, filled in as they're built

    function setIdentType(type) {
      identTypeSel = type;
      [...$("fType").children].forEach((c) => c.classList.toggle("is-on", c.dataset.type === type));
      refreshOwnPreviewTag();
    }
    function setIdentAccentUI(hex) {
      Object.values(identSwatchEls).forEach((b) => b.classList.remove("is-on"));
      identCustomWrap.classList.remove("is-on");
      if (identSwatchEls[hex]) {
        identSwatchEls[hex].classList.add("is-on");
      } else {
        identCustomWrap.classList.add("is-on");
        identCustomWrap.style.background = hex;
        $("fAccentCustom").value = hex;
      }
      paintOwnPreviewAccent(hex);
    }
    $("fCafeName").addEventListener("input", refreshOwnPreviewName);

    $("fType").addEventListener("click", (e) => {
      const b = e.target.closest(".seg__btn"); if (!b) return;
      setIdentType(b.dataset.type);
    });

    (function buildIdentSwatches() {
      const wrap = $("fAccent");
      ACCENTS.forEach((hex) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "swatch";
        b.style.background = hex; b.setAttribute("aria-label", hex);
        b.onclick = () => { identAccentSel = hex; setIdentAccentUI(hex); };
        wrap.insertBefore(b, identCustomWrap);
        identSwatchEls[hex] = b;
      });
    })();
    $("fAccentCustom").addEventListener("input", (e) => {
      const picked = deepenForCard(e.target.value.toLowerCase());
      identAccentSel = picked;
      setIdentAccentUI(picked);
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
      $("identSummaryDot").style.background = savedAccent;
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
      identAccentSel = savedAccent; setIdentAccentUI(savedAccent);
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
          body: JSON.stringify({ cafe_name, tagline: identTypeSel, accent: identAccentSel }),
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

    // ---------------- café logo ----------------
    // Optional. No logo means the customer's card renders exactly as it always
    // has — there is no placeholder on the card, only in this preview.
    function showLogo(collectionId, name) {
      const img = $("logoImg"), prev = $("logoPrev");
      const prevImg = $("ownPrevLogo");
      if (collectionId && name) {
        // cache-bust so a freshly replaced logo doesn't show the old one
        const url = API + "/api/files/" + collectionId + "/" + cafeId + "/" + encodeURIComponent(name) +
          "?thumb=240x240&r=" + Date.now();
        img.src = url;
        img.hidden = false; $("logoEmpty").hidden = true; prev.classList.add("has-img");
        $("logoRemove").hidden = false;
        prevImg.src = url; prevImg.hidden = false;
      } else {
        img.removeAttribute("src"); img.hidden = true;
        $("logoEmpty").hidden = false; prev.classList.remove("has-img");
        $("logoRemove").hidden = true;
        prevImg.removeAttribute("src"); prevImg.hidden = true;
      }
    }

    function logoErr(msg) { $("logoErr").textContent = msg; $("logoErr").hidden = false; }
    function logoSaved() { $("logoOk").hidden = false; setTimeout(() => { $("logoOk").hidden = true; }, 1800); }

    async function uploadLogoBlob(blob) {
      const box = document.querySelector(".logo-box");
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
      const box = document.querySelector(".logo-box");
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

    $("signout").onclick = () => { ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} }); location.replace("/business/signin"); };

    // ---------------- analytics tab ----------------
    // Ported from the old standalone analytics.page.js (analytics.html is now
    // folded into this page as a fourth tab); its #content anchor became
    // #anContent here. The tab has no heading of its own — the cards say what
    // they are — so it opens straight into the deck. It fetches /owner/stats
    // lazily, the first time this tab is opened (see loadAnalytics()/
    // setOwnerTab below), not on every dashboard load.
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
          + `<circle class="cb-hit" data-i="${i}" data-x="${p[0].toFixed(1)}" data-y="${p[1].toFixed(1)}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="11" fill="transparent"><title>${esc(series[i].label)}: ${series[i].rate}%</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${esc(series[i].label)}</text>`
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
          cap: t("AN_CB_CAP_HTML", { days: cb.windowDays, label: isolateLTR(esc(x.label)), rate: x.rate, returners: x.returners, newMembers: x.newMembers }),
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
      const fmtY = (v) => (v % 1 ? v.toFixed(1) : v) + "d";
      const grid = [0, yMax / 2, yMax].map((v) => {
        const y = Y(v).toFixed(1);
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(20,20,20,0.08)" stroke-width="1"/>`
          + `<text x="${W - padR}" y="${(Y(v) - 3).toFixed(1)}" text-anchor="end" font-size="8.5" font-weight="700" fill="var(--faint)">${fmtY(v)}</text>`;
      }).join("");
      const dots = series.map((s, i) => {
        if (s.value == null) return "";
        const last = i === n - 1;
        return `<circle class="cb-dot${last ? " cb-dot--last" : ""}" cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="${last ? 3.4 : 2}"/>`
          + `<circle class="vr-hit" data-i="${i}" data-x="${X(i).toFixed(1)}" data-y="${Y(s.value).toFixed(1)}" cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="11" fill="transparent"><title>${esc(s.label)}: ${s.value}d</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${esc(series[i].label)}</text>`
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
            ? t("AN_VR_CAP_EMPTY_HTML", { days: vr.windowDays, label: isolateLTR(esc(x.label)) })
            : t("AN_VR_CAP_HTML", { days: vr.windowDays, label: isolateLTR(esc(x.label)), value: x.value, unit: unit(x.value), n: x.customers, customerWord: customerWord(x.customers) }),
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
        let lab = actPeriod === 7 ? dow(x.dow) : ((i % 5 === 0 || i === data.days.length - 1) ? x.date.slice(8) : "");
        return `<button class="act-bar${x.date === actSel ? " is-sel" : ""}" data-date="${x.date}" data-i="${i}" title="${esc(translateLabel(x.label))}"><span class="act-bar__fill" style="height:${h}%"></span><span class="act-bar__lab">${esc(lab)}</span></button>`;
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
          <div class="act-sel__head"><span class="act-sel__dot"></span><b>${esc(translateLabel(sel.label))}</b><span class="act-sel__tag">${t("AN_ACT_SELECTED_DAY")}</span></div>
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
        head.textContent = translateLabel(sel.label);
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

    // ---------------- customers ----------------
    // Lazy, like analytics: most sessions are an owner checking their card or
    // adding a reward, and this is a second round-trip they never asked for.
    let customersLoaded = false;
    async function loadCustomers() {
      try {
        const res = await fetch(API + "/owner/customers", { method: "POST", headers: { Authorization: token } });
        if (!res.ok) return customersError(t("OWNER_CUSTOMERS_ERR"));
        renderCustomers(await res.json());
      } catch (e) {
        customersError(t("AUTH_ERR_SERVER_UNREACHABLE"));
      }
    }
    function customersError(msg) {
      $("cuList").innerHTML = "";
      $("cuSub").textContent = "";
      $("cuMore").hidden = true;
      cuRows = []; cuShown = 0; cuTotal = 0;
      const note = $("cuNote");
      note.textContent = msg;
      note.hidden = false;
      // a failed load must not look like a café with no customers
      customersLoaded = false;
    }
    // The calendar an owner reads, for visits too old for "N days ago".
    //
    // Gregorian in BOTH languages. fa-IR would otherwise give Jalali, which
    // is Intl's default calendar for that locale — but nothing else in this
    // app speaks Jalali, and a single Jalali date among Gregorian ones is
    // worse than a Gregorian date everywhere. calendar:"gregory" pins it, so
    // the Persian page reads "6 سپتامبر 2026": Gregorian months, named in
    // Persian. -u-nu-latn keeps Latin digits, matching every other number on
    // this page. Asia/Tehran so the date can never disagree with the day
    // count the server worked out in that same zone.
    //
    // Built once rather than per row: constructing an Intl.DateTimeFormat is
    // the expensive part, and this runs 50 times a page. Keyed on the
    // language anyway — setLang() reloads the page today, so the key cannot
    // actually go stale, but a cached formatter that silently outlives a
    // language change is not a thing to leave lying around.
    let seenFmt = null, seenFmtLang = null;
    function seenOnDate(raw) {
      // "2026-10-05 19:17:00.000Z" — the space is not valid ISO 8601 and
      // Safari returns NaN for it, so normalise exactly as the hook does
      const at = Date.parse(String(raw || "").replace(" ", "T"));
      if (!at) return "";
      const lang = getLang();
      if (!seenFmt || seenFmtLang !== lang) {
        seenFmtLang = lang;
        try {
          seenFmt = new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-nu-latn" : "en-GB",
            { calendar: "gregory", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tehran" });
        } catch (e) { seenFmt = null; }
      }
      if (!seenFmt) return "";
      try { return seenFmt.format(new Date(at)); } catch (e) { return ""; }
    }

    // "Last visit: 3 days ago", or an actual date once that stops being
    // useful. The server hands over a whole-day delta in the café's own
    // timezone (see customers.pb.js), so the buckets below never touch Date;
    // only the dated branch does.
    function lastSeenLabel(c) {
      const d = c.daysAgo;
      if (d === null || d === undefined || d < 0) return "";
      if (d === 0) return t("OWNER_SEEN_TODAY");
      if (d === 1) return t("OWNER_SEEN_YESTERDAY");
      if (d < 7) return t("OWNER_SEEN_DAYS", { n: d });
      if (d < CU_AWAY_DAYS) { const w = Math.floor(d / 7); return w === 1 ? t("OWNER_SEEN_WEEK") : t("OWNER_SEEN_WEEKS", { n: w }); }
      // Past a month, "4 months ago" is not something an owner can act on —
      // the day itself is. Falls back to the old wording if the row carries
      // no parseable timestamp, or if Intl refuses the locale.
      const on = seenOnDate(c.lastSeen);
      if (on) return t("OWNER_SEEN_ON", { date: on });
      const mo = Math.floor(d / 30);
      return mo <= 1 ? t("OWNER_SEEN_MONTH") : t("OWNER_SEEN_MONTHS", { n: mo });
    }

    // The list is rendered a page at a time, not all at once. A busy café's
    // 500 rows is 500 glass cards with a backdrop-filter each, and an owner
    // looking someone up reads the top of the list — the rest is scrolled
    // past, if it is reached at all.
    const CU_PAGE = 50;
    // The one place the "away" line is defined: it is where lastSeenLabel
    // stops counting weeks and starts printing a date, and where a row is
    // marked. Two numbers here would drift apart.
    const CU_AWAY_DAYS = 30;
    let cuRows = [];    // everything the request returned
    let cuView = [];    // cuRows after the filter sheet, and in its sort order
    let cuShown = 0;    // how many of cuView are in the DOM
    let cuTotal = 0;    // how many exist at the café, which can exceed cuRows

    // Committed filter state, and the draft the open sheet is editing. Two
    // objects, not one: tapping chips must be undoable by shutting the sheet,
    // so nothing reaches the list until Apply.
    const CU_FILTER_OFF = { visit: "all", card: "all", sort: "recent" };
    let cuFilter = Object.assign({}, CU_FILTER_OFF);
    let cuDraft = Object.assign({}, CU_FILTER_OFF);

    function customerRowHtml(c, i) {
      const name = c.name || t("OWNER_CUSTOMERS_NONAME");
      // Array.from, not [0]: a name starting with an astral-plane character
      // (an emoji, say) would otherwise give half a surrogate pair and the
      // badge would render the replacement glyph.
      const initial = Array.from(name)[0] || "?";
      // the server only ever sends four digits — the dots stand for the
      // rest of a number this page never receives
      const phone = c.phone4 ? "\u00b7\u00b7\u00b7" + c.phone4 : "";
      const seen = lastSeenLabel(c);
      // `null >= 30` is false, so a row with no usable timestamp is never
      // marked — an unknown last visit is not evidence of a long absence.
      const away = c.daysAgo >= CU_AWAY_DAYS ? " cu--away" : "";
      // `i` is the row's index WITHIN ITS PAGE, so each batch staggers in from
      // the top rather than inheriting the delay of the batch before it.
      // Capped at 12: past that the delay outlasts the scroll to reach it.
      return (
        '<button type="button" class="cu' + away + '" data-id="' + esc(c.id || "") + '" style="--i:' + Math.min(i, 12) + '">' +
          '<span class="cu__badge" aria-hidden="true">' + esc(initial) + "</span>" +
          '<span class="cu__main">' +
            '<span class="cu__name">' + esc(name) + "</span>" +
            (phone ? '<span class="cu__phone">' + esc(phone) + "</span>" : "") +
            (seen ? '<span class="cu__seen">' + esc(seen) + "</span>" : "") +
          "</span>" +
          '<span class="cu__prog">' + c.stamps + "/" + c.required + "</span>" +
        "</button>"
      );
    }

    // One row against one filter. daysAgo is null when the timestamp was
    // unusable, and `null < 7` is true in JS — hence the explicit number
    // check, or every unknown row would answer to "this week".
    function customerMatches(c, f) {
      const d = typeof c.daysAgo === "number" ? c.daysAgo : null;
      if (f.visit === "week" && !(d !== null && d < 7)) return false;
      if (f.visit === "month" && !(d !== null && d < CU_AWAY_DAYS)) return false;
      if (f.visit === "away" && !(d !== null && d >= CU_AWAY_DAYS)) return false;

      const st = c.stamps | 0, req = c.required | 0;
      if (f.card === "empty" && st !== 0) return false;
      if (f.card === "started" && st <= 0) return false;
      // Read literally, as the chip says it: an untouched card IS less than
      // half full, so "no stamps" is a subset of this rather than its
      // opposite. These are alternatives to pick between, not a partition.
      if (f.card === "half" && !(req > 0 && st < req / 2)) return false;
      // strictly more than half, so an exactly-half card (4 of 8) belongs to
      // neither this nor "less than half" — the words on both chips would be
      // wrong about it
      if (f.card === "over" && !(req > 0 && st > req / 2)) return false;
      // the last slot before a reward — worth a nudge today. Guarded on req
      // so a malformed row can't make every empty card match.
      if (f.card === "nearly" && !(req > 1 && st >= req - 1 && st < req)) return false;
      return true;
    }

    function countMatches(f) {
      let n = 0;
      for (const c of cuRows) if (customerMatches(c, f)) n++;
      return n;
    }

    function sortCustomers(rows, how) {
      // "recent" is the order the server already sorted by (-updated), so it
      // is the no-op case — re-sorting would only risk disagreeing with it.
      if (how === "recent") return rows;
      const far = (c) => (typeof c.daysAgo === "number" ? c.daysAgo : -1);
      if (how === "away") return rows.slice().sort((a, b) => far(b) - far(a));
      if (how === "stamps") return rows.slice().sort((a, b) => (b.stamps | 0) - (a.stamps | 0));
      if (how === "name") {
        const loc = getLang() === "fa" ? "fa" : "en";
        return rows.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), loc));
      }
      return rows;
    }

    // Rebuilds the list from cuRows under the committed filter. Every path
    // that changes what should be on screen ends here, so paging, the count
    // line and the empty state can never describe a different set than the
    // rows do.
    function applyCustomerView() {
      cuView = sortCustomers(cuRows.filter((c) => customerMatches(c, cuFilter)), cuFilter.sort);
      cuShown = 0;
      $("cuList").innerHTML = "";
      $("cuMore").hidden = true;

      const filtered = cuFilter.visit !== "all" || cuFilter.card !== "all";
      // a non-default sort counts as "on" too: the list is not in the order
      // it opens in, and nothing else on screen would say so
      $("cuFilterBtn").classList.toggle("is-on", filtered || cuFilter.sort !== "recent");
      $("cuSub").textContent = filtered
        ? t("OWNER_CUSTOMERS_FILTERED", { n: cuView.length, total: cuTotal })
        : t("OWNER_CUSTOMERS_COUNT", { n: cuTotal });

      const note = $("cuNote");
      if (!cuView.length) {
        note.textContent = t(cuRows.length ? "OWNER_CUSTOMERS_NO_MATCH" : "OWNER_CUSTOMERS_EMPTY");
        note.hidden = false;
        return;
      }
      // the server's 500-row cap is only worth mentioning while the whole
      // fetched set is on show — under a filter it is not what is limiting
      if (!filtered && cuRows.length < cuTotal) {
        note.textContent = t("OWNER_CUSTOMERS_TRUNCATED", { n: cuRows.length });
        note.hidden = false;
      } else {
        note.hidden = true;
      }
      appendCustomerPage();
    }

    function appendCustomerPage() {
      const slice = cuView.slice(cuShown, cuShown + CU_PAGE);
      $("cuList").insertAdjacentHTML("beforeend", slice.map(customerRowHtml).join(""));
      cuShown += slice.length;

      const more = $("cuMore");
      const left = cuView.length - cuShown;
      if (left > 0) {
        $("cuMoreBtn").textContent = t("OWNER_CUSTOMERS_MORE", { n: Math.min(CU_PAGE, left) });
        // counted against whatever set is on screen: the café's real total
        // normally, the matching rows once a filter narrows it
        const of = (cuFilter.visit === "all" && cuFilter.card === "all") ? cuTotal : cuView.length;
        $("cuMoreCount").textContent = t("OWNER_CUSTOMERS_OF", { shown: cuShown, total: of });
        more.hidden = false;
      } else {
        more.hidden = true;
      }
    }

    function renderCustomers(data) {
      cuRows = data.customers || [];
      cuTotal = data.total || cuRows.length;
      // a fresh payload is a fresh list: an "away" filter left over from the
      // last render could otherwise hide every row of it
      cuFilter = Object.assign({}, CU_FILTER_OFF);
      cuDraft = Object.assign({}, CU_FILTER_OFF);
      syncSheetChips();
      applyCustomerView();
    }

    $("cuMoreBtn").onclick = appendCustomerPage;

    // ---------------- one customer's page ----------------
    const cdet = $("cDetail");
    const CD_MS = 470;              // must stay >= the .cdet transition
    let cdTimer = null, cdReturnTo = null;
    // bumped on every open, so a slow request for the customer you just
    // backed out of cannot paint itself over the one you opened next
    let cdSeq = 0;

    // Counts a number up to its final value. The final value is written
    // FIRST and the animation only replays the way there, so a browser that
    // never runs the frames — a background tab, where rAF is throttled to a
    // standstill — still shows the right number instead of a stuck zero.
    function countUp(el, to, decimals) {
      const end = Number(to) || 0;
      const fixed = (v) => (decimals ? v.toFixed(decimals) : String(Math.round(v)));
      el.textContent = fixed(end);
      if (typeof requestAnimationFrame !== "function") return;
      const t0 = performance.now(), dur = 850;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        // ease-out cubic: fast first, so the figure is readable almost at once
        el.textContent = fixed(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    const CD_DOW = ["OWNER_DOW_SAT", "OWNER_DOW_SUN", "OWNER_DOW_MON", "OWNER_DOW_TUE", "OWNER_DOW_WED", "OWNER_DOW_THU", "OWNER_DOW_FRI"];

    function cdDateLabel(raw) {
      const at = Date.parse(String(raw || "").replace(" ", "T"));
      if (!at) return "";
      return seenOnDate(raw);   // same Gregorian formatter the list uses
    }

    // Emptied while the page is still parked off-screen, never mid-slide:
    // tearing down a 365-column graph is as expensive as building one.
    function resetCustomerPage() {
      $("cdName").textContent = "…";
      $("cdPhone").textContent = "";
      $("cdAvatar").textContent = "";
      $("cdBadge").textContent = "";
      $("cdRingTxt").textContent = "";
      $("cdRingNote").textContent = "";
      $("cdStats").innerHTML = "";
      $("cdGraphTrack").innerHTML = "";
      $("cdRewards").innerHTML = "";
      $("cdRwSub").textContent = "";
      $("cdGraphSub").textContent = "";
      $("cdLegendFrom").textContent = "";
      $("cdLegendTo").textContent = "";
    }

    function openCustomer(id, returnTo) {
      cdReturnTo = returnTo || null;
      const mine = ++cdSeq;
      clearTimeout(cdTimer);
      resetCustomerPage();                     // while it is still off-screen
      cdet.hidden = false;
      cdet.setAttribute("aria-hidden", "false");
      void getComputedStyle(cdet).transform;   // resolve the parked position first
      cdet.classList.add("is-open");
      document.body.style.overflow = "hidden";
      $("cdScroll").scrollTop = 0;
      $("cdBack").focus();

      // The request goes out now — the network overlaps the slide for free —
      // but the DOM is only built once the page has LANDED. Rendering it
      // mid-flight means a thousand graph elements and a 1700px-wide flex
      // track laid out inside the transition, which eats the animation and
      // makes the page look like it simply appeared.
      Promise.all([fetchCustomer(id), new Promise((r) => setTimeout(r, CD_MS))])
        .then((both) => { if (mine === cdSeq && both[0]) renderCustomer(both[0]); });
    }

    function closeCustomer() {
      if (cdet.hidden) return;
      cdSeq++;                                 // abandon any request still in flight
      cdet.classList.remove("is-open");
      clearTimeout(cdTimer);
      cdTimer = setTimeout(() => {
        cdet.hidden = true;
        cdet.setAttribute("aria-hidden", "true");
        // Unlocked only now. Releasing it as the slide starts re-lays out
        // the whole list underneath on the transition's first frame, which
        // is the other half of what was swallowing the animation.
        releaseScrollLock();
        resetCustomerPage();
      }, CD_MS);
      if (cdReturnTo && document.contains(cdReturnTo)) cdReturnTo.focus({ preventScroll: true });
    }

    // Resolves to the payload, or null having already put the reason on screen.
    async function fetchCustomer(id) {
      try {
        const res = await fetch(API + "/owner/customer", {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({ id: id }),
        });
        if (!res.ok) { $("cdName").textContent = t("OWNER_CUSTOMERS_ERR"); return null; }
        return await res.json();
      } catch (e) {
        $("cdName").textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
        return null;
      }
    }

    function renderCustomer(d) {
      const p = d.profile, tt = d.totals, rh = d.rhythm;
      const name = p.name || t("OWNER_CUSTOMERS_NONAME");
      $("cdName").textContent = name;
      $("cdAvatar").textContent = Array.from(name)[0] || "?";
      $("cdPhone").textContent = p.phone4 ? "\u00b7\u00b7\u00b7" + p.phone4 : "";

      const badge = $("cdBadge");
      badge.textContent = p.active ? t("OWNER_CD_ACTIVE") : t("OWNER_CD_AWAY");
      badge.classList.toggle("is-away", !p.active);

      // current card as a ring
      const req = tt.required || 8, st = Math.min(tt.stamps | 0, req);
      const circ = 2 * Math.PI * 31;
      const ring = $("cdRingVal");
      ring.style.strokeDasharray = circ.toFixed(1);
      ring.style.strokeDashoffset = circ.toFixed(1);          // start empty…
      $("cdRingTxt").textContent = st + "/" + req;
      // …then let the transition draw it. Deferred a beat so the dasharray
      // above is the resolved start value rather than being coalesced away.
      setTimeout(() => { ring.style.strokeDashoffset = (circ * (1 - st / req)).toFixed(1); }, 60);
      // cards finished has its own tile below — the ring note said it twice
      $("cdRingNote").innerHTML = t("OWNER_CD_RING_NOTE", { left: "<b>" + Math.max(0, req - st) + "</b>" });

      // stat tiles
      const stats = [
        { v: rh.perMonth, dec: 1, k: t("OWNER_CD_PER_MONTH") },
        { v: tt.visits, dec: 0, k: t("OWNER_CD_TOTAL_VISITS") },
        { v: tt.cycles, dec: 0, k: t("OWNER_CD_CARDS_DONE") },
        { v: d.rewards.redeemed, dec: 0, k: t("OWNER_CD_REDEEMED") },
        { v: rh.avgGapDays, dec: 1, k: t("OWNER_CD_AVG_GAP"), dash: rh.avgGapDays === null },
        { v: tt.memberDays, dec: 0, k: t("OWNER_CD_MEMBER_DAYS") },
      ];
      $("cdStats").innerHTML = stats.map((x, i) =>
        '<div class="cdstat" style="--i:' + i + '"><span class="cdstat__v" data-v="' + (x.dash ? "" : x.v) +
        '" data-dec="' + x.dec + '">' + (x.dash ? "—" : "0") + '</span>' +
        '<span class="cdstat__k">' + esc(x.k) + "</span></div>").join("");
      $("cdStats").querySelectorAll(".cdstat__v").forEach((el) => {
        if (el.dataset.v === "") return;                 // the em-dash tiles stay as they are
        countUp(el, el.dataset.v, Number(el.dataset.dec));
      });

      if (rh.busiestDow !== null && rh.busiestDow !== undefined) {
        $("cdGraphSub").textContent = t("OWNER_CD_BUSIEST", { day: t(CD_DOW[rh.busiestDow]) });
      } else {
        $("cdGraphSub").textContent = "";
      }
      renderVisitGraph(d);

      const rw = d.rewards;
      $("cdRwSub").textContent = rw.issued
        ? t("OWNER_CD_RW_SUM", { issued: rw.issued, redeemed: rw.redeemed, active: rw.active, expired: rw.expired })
        : t("OWNER_CD_RW_NONE");
      $("cdRewards").innerHTML = rw.list.map((r) => {
        const st2 = r.status === "redeemed" ? "redeemed" : (r.status === "expired" ? "expired" : "active");
        const when = st2 === "redeemed"
          ? t("OWNER_CD_RW_REDEEMED_ON", { date: cdDateLabel(r.redeemedAt) || cdDateLabel(r.created) })
          : t("OWNER_CD_RW_WON_ON", { date: cdDateLabel(r.created) });
        return '<div class="cdrw"><div class="cdrw__main">' +
          '<p class="cdrw__deal">' + esc(r.deal || t("OWNER_CD_RW_UNNAMED")) + "</p>" +
          '<p class="cdrw__when">' + esc(when) + "</p></div>" +
          '<span class="cdrw__st cdrw__st--' + st2 + '">' + esc(t("OWNER_CD_RW_" + st2.toUpperCase())) + "</span></div>";
      }).join("");
    }

    // One column per DAY from the day they joined to today — the empty
    // columns are the point, since a fortnight's gap is invisible in a chart
    // that only plots the days somebody turned up.
    function renderVisitGraph(d) {
      const track = $("cdGraphTrack");
      const byDay = {};
      let peak = 1;
      for (const x of d.days) { byDay[x.d] = x.n; if (x.n > peak) peak = x.n; }

      const DAY = 86400000, IRAN_OFF = 3.5 * 3600000;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const key = (t2) => { const z = new Date(t2 + IRAN_OFF); return z.getUTCFullYear() + "-" + pad(z.getUTCMonth() + 1) + "-" + pad(z.getUTCDate()); };
      const joined = Date.parse(String(d.profile.joined || "").replace(" ", "T")) || Date.now();
      // a year is already 365 columns; past that the chart is a smear and
      // the early history is better told by the "member for N days" tile
      const span = Math.min(365, Math.max(1, Math.round((Date.now() - joined) / DAY) + 1));
      const start = Date.now() - (span - 1) * DAY;

      const cols = [];
      let lastMonth = "";
      const monthFmt = new Intl.DateTimeFormat(getLang() === "fa" ? "fa-IR-u-nu-latn" : "en-GB",
        { calendar: "gregory", month: "short", timeZone: "Asia/Tehran" });
      for (let i = 0; i < span; i++) {
        const at = start + i * DAY;
        const k = key(at);
        const n = byDay[k] || 0;
        const local = new Date(at + IRAN_OFF);
        const mk = k.slice(0, 7);
        const newMonth = mk !== lastMonth;
        lastMonth = mk;
        // Scaled from a floor, not from zero: with `n / peak` a customer whose
        // busiest day was a single stamp gets one bar at full height, which
        // reads as a spike when it is just "they came". One visit is always
        // 55%, the peak is always 100%, and days in between interpolate.
        const h = n ? (peak > 1 ? 55 + Math.round((45 * (n - 1)) / (peak - 1)) : 55) : 0;
        cols.push(
          '<span class="vgcol' + (n ? "" : " vgcol--none") + (newMonth && i ? " vgcol--m1" : "") + '" style="--i:' + Math.min(i, 60) + '"' +
          ' title="' + esc(k + " · " + n) + '">' +
          (newMonth ? '<span class="vgcol__m">' + esc(monthFmt.format(at)) + "</span>" : "") +
          '<span class="vgcol__bar" style="--h:' + h + '%"></span>' +
          '<span class="vgcol__d">' + local.getUTCDate() + "</span></span>"
        );
      }
      track.innerHTML = cols.join("");
      $("cdLegendFrom").textContent = t("OWNER_CD_GRAPH_SPAN", { n: span });
      $("cdLegendTo").textContent = t("OWNER_CD_GRAPH_TODAY");
      // open on today: the recent end is the one anybody reads first
      const vg = $("cdGraph");
      vg.scrollLeft = vg.scrollWidth;
    }

    // delegated, so the 50-rows-at-a-time paging needs no re-binding
    $("cuList").addEventListener("click", (e) => {
      const row = e.target.closest(".cu");
      if (!row || !row.dataset.id) return;
      openCustomer(row.dataset.id, row);
    });
    $("cdBack").onclick = closeCustomer;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !cdet.hidden) closeCustomer(); });

    // ---------------- filter sheet ----------------
    const sheet = $("cuSheet");
    const sheetPanel = $("cuSheetPanel");
    const CU_GROUPS = { fVisit: "visit", fCard: "card", fSort: "sort" };

    // Paints the chips from cuDraft. Also the reset path — one function, so
    // the buttons can never disagree with the state they are showing.
    function syncSheetChips() {
      for (const id in CU_GROUPS) {
        const key = CU_GROUPS[id];
        $(id).querySelectorAll(".chip").forEach((b) => {
          const on = b.dataset.v === cuDraft[key];
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
      }
      // the count is live: tapping a chip re-counts without committing, so
      // an owner can see a filter is empty before applying it
      $("cuApply").textContent = t("OWNER_FILTER_SHOW", { n: countMatches(cuDraft) });
    }

    for (const id in CU_GROUPS) {
      const key = CU_GROUPS[id];
      $(id).addEventListener("click", (e) => {
        const btn = e.target.closest(".chip");
        if (!btn) return;
        cuDraft[key] = btn.dataset.v;   // one value per group, radio-style
        syncSheetChips();
      });
    }

    // Three overlays can lock the page: the two sheets and the customer
    // page. Each used to clear the lock on its own way out, which releases
    // it while another is still open — closing the filter sheet back into
    // the send sheet, for one. Asking whether anything is still up makes
    // the lock behave like a count without keeping one.
    function releaseScrollLock() {
      const open = !$("cuSheet").hidden || !$("cuSend").hidden || !$("cDetail").hidden ||
        !$("addPage").hidden;
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
    addPageClose = addPage.close;
    $("addBtn").onclick = () => { addPage.open(); $("fDeal").focus(); };
    $("cancelBtn").onclick = () => addPage.close();

    // Set when the filter sheet was opened from inside the send sheet, so
    // dismissing it drops the owner back where they were instead of on the
    // bare list. One sheet on screen at a time: stacking two bottom sheets
    // over each other reads as a mistake, not a hierarchy.
    let filterReturnsToSend = false;

    const filterSheet = makeSheet(sheet, sheetPanel, $("cuFilterBtn"), () => {
      cuDraft = Object.assign({}, cuFilter);   // start from what is applied
      syncSheetChips();
    }, () => {
      if (!filterReturnsToSend) return;
      filterReturnsToSend = false;
      sendSheet.open();
    });
    const openSheet = filterSheet.open;
    const closeSheet = filterSheet.close;

    $("cuFilterBtn").onclick = openSheet;

    // The header lifts while it is stuck. An IntersectionObserver on a
    // 1px sentinel fires twice per scroll session instead of on every
    // frame, which a scroll listener over a 500-row list would not.
    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(
        (entries) => { $("cuHead").classList.toggle("is-stuck", !entries[0].isIntersecting); },
        { threshold: 0, rootMargin: "-11px 0px 0px 0px" }   // 1px past the sticky top
      ).observe($("cuSentinel"));
    }

    // ---------------- send sheet ----------------
    // Addressed to whoever the list is currently showing, which is why the
    // recipient line is filled on open rather than once at startup: the
    // filter can have narrowed 286 people to 77 since last time.
    function syncSendRecipients() {
      const filtered = cuFilter.visit !== "all" || cuFilter.card !== "all";
      $("cuSendCount").textContent = t("OWNER_SEND_TO_N", { n: cuView.length });
      $("cuSendWho").textContent = t(filtered ? "OWNER_SEND_TO_FILTERED" : "OWNER_SEND_TO_ALL");
      // the filter pill wears the same ink-when-on state as the one in the
      // header, so the two cannot tell different stories about the same
      // filter
      $("cuSendFilter").classList.toggle("is-on", filtered || cuFilter.sort !== "recent");
    }

    const sendSheet = makeSheet($("cuSend"), $("cuSendPanel"), $("cuSendBtn"), () => {
      syncSendRecipients();
      refreshSendReady();   // filtering to nobody must disable Send
      showSendConfirm(false, true);   // never reopen onto a half-answered question
    }, () => showSendConfirm(false, true), () => sending);
    $("cuSendBtn").onclick = sendSheet.open;

    // Filter from inside Send: swap one sheet for the other, and come back
    // here when it closes. The recipient count is re-read on the way in, so
    // it always matches whatever the filter just did.
    $("cuSendFilter").onclick = () => {
      filterReturnsToSend = true;
      sendSheet.close(() => filterSheet.open());
    };

    const sendMsg = $("cuSendMsg");

    // Mirrors updatePreview() in the discounts tab against this sheet's own
    // fields, so the dark ticket here is the same ticket composed there.
    function updateSendPreview() {
      const deal = $("cuFDeal").value.trim() || t("OWNER_PV_DEAL_DEFAULT");
      const desc = $("cuFDesc").value.trim();
      const amt = Math.max(1, parseInt($("cuFExpAmt").value, 10) || 1);
      $("cuPvDeal").textContent = deal;
      $("cuPvDesc").textContent = desc;
      $("cuPvExp").textContent = t("OWNER_PV_EXPIRES", { amt: amt, unit: unitWord($("cuFExpUnit").value, amt) });
    }
    ["cuFDeal", "cuFDesc", "cuFExpAmt", "cuFExpUnit"].forEach((id) => {
      $(id).addEventListener("input", () => { updateSendPreview(); refreshSendReady(); });
      $(id).addEventListener("change", () => { updateSendPreview(); refreshSendReady(); });
    });

    // Three states, one at a time: the press-row (nothing attached), the
    // form (composing), or the ticket (confirmed). A confirmed discount is
    // a decision, so it stops being an open form and becomes the object it
    // describes — which is also what makes Send unambiguous.
    let discAttached = null;

    function setDiscState(state) {
      const form = $("cuDiscForm"), toggle = $("cuDiscToggle"), att = $("cuDiscAttached");
      const composing = state === "form";
      form.classList.toggle("is-open", composing);
      toggle.classList.toggle("is-open", composing);
      toggle.setAttribute("aria-expanded", composing ? "true" : "false");
      // the press-row is only an invitation; once a ticket is attached it
      // would be a second way to do the same thing
      toggle.hidden = state === "attached";
      att.hidden = state !== "attached";
      refreshSendReady();
    }

    $("cuDiscToggle").onclick = () => {
      const composing = $("cuDiscForm").classList.contains("is-open");
      setDiscState(composing ? "none" : "form");
      if (!composing) { updateSendPreview(); $("cuFDeal").focus(); }
    };

    $("cuDiscCancel").onclick = () => {
      // cancelling out of an edit keeps whatever was already attached
      setDiscState(discAttached ? "attached" : "none");
    };

    $("cuDiscConfirm").onclick = () => {
      const deal = $("cuFDeal").value.trim();
      if (!deal) { $("cuFDeal").focus(); return; }   // the one required field
      discAttached = {
        deal: deal,
        desc: $("cuFDesc").value.trim(),
        amt: Math.max(1, parseInt($("cuFExpAmt").value, 10) || 1),
        unit: $("cuFExpUnit").value,
      };
      $("cuAttDeal").textContent = discAttached.deal;
      $("cuAttDesc").textContent = discAttached.desc;
      $("cuAttExp").textContent = t("OWNER_PV_EXPIRES", { amt: discAttached.amt, unit: unitWord(discAttached.unit, discAttached.amt) });
      setDiscState("attached");
    };

    $("cuDiscEdit").onclick = () => { setDiscState("form"); updateSendPreview(); $("cuFDeal").focus(); };

    $("cuDiscRemove").onclick = () => {
      discAttached = null;
      $("cuFDeal").value = ""; $("cuFDesc").value = "";
      $("cuFExpAmt").value = "2"; $("cuFExpUnit").value = "week";
      setDiscState("none");
    };

    // Ready means: somebody to send to, and something to send. A discount
    // left half-composed counts as unfinished — attaching a reward with no
    // deal on it would reach the customer as a blank ticket. A CONFIRMED
    // one never blocks, because confirming is what validated it.
    let sendWasReady = false;
    function refreshSendReady() {
      const hasText = sendMsg.value.trim().length > 0;
      const composing = $("cuDiscForm").classList.contains("is-open");
      const discOk = !composing || $("cuFDeal").value.trim().length > 0;
      const ready = hasText && discOk && cuView.length > 0;
      $("cuSendGo").disabled = !ready;
      // the sheen plays on the EDGE into ready, not for as long as it stays
      // ready — an animation that repeats on every keystroke is noise
      if (ready && !sendWasReady) {
        $("cuSendGo").classList.remove("is-ready");
        void $("cuSendGo").offsetWidth;        // restart the one-shot
        $("cuSendGo").classList.add("is-ready");
      }
      if (!ready) $("cuSendGo").classList.remove("is-ready");
      sendWasReady = ready;
    }

    sendMsg.addEventListener("input", () => {
      $("cuSendChars").textContent = sendMsg.value.length;
      refreshSendReady();
      // the confirm named a recipient count and a reward; editing either
      // makes it a question about something that no longer exists
      if (!$("cuConfirm").hidden) showSendConfirm(false);
    });

    // ---- sending ----
    // Addressed by MEMBERSHIP id, which is all /owner/customers ever handed
    // out: each one names exactly one café, so the server can refuse any
    // that is not this owner's without the user id ever travelling.
    //
    // `sending` guards the only mistake here that cannot be taken back. The
    // button is disabled for the round trip as well, but a disabled button
    // is a rendering detail and a double tap on a slow connection is a
    // second message to several hundred people.
    let sending = false;
    let sentNoteTimer = null;

    // One key per composed message, not per attempt. A retry after a dropped
    // connection carries the same key, which is how the server recognises it
    // as the same send rather than a second one (1700000032_message_send_id).
    //
    // It outlives the page, because the retry usually does too: when a send
    // appears to fail, the next thing people do is reload. A key held only
    // in a variable would be gone by then, and the retry would be a second
    // broadcast to everyone.
    //
    // Stored against a fingerprint of what was composed — the body and the
    // attached reward — so it is reused ONLY for an identical message that
    // has not landed. Change a word and it is a different send with its own
    // key, which is what stops a stale key from swallowing a real message.
    // Removed on success, so deliberately sending the same text again later
    // mints a fresh key and goes out properly.
    const SEND_RETRY_KEY = "loytap_send_retry";
    let sendKey = "";
    function newSendKey() {
      try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
      return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    function composedFingerprint(body) {
      const d = discAttached
        ? [discAttached.deal, discAttached.desc, discAttached.amt, discAttached.unit].join("\u0000")
        : "";
      return body + "\u0000" + d;
    }
    function keyForSend(body) {
      const fp = composedFingerprint(body);
      try {
        const saved = JSON.parse(localStorage.getItem(SEND_RETRY_KEY) || "null");
        if (saved && saved.key && saved.fp === fp) return saved.key;
      } catch (e) {}
      const key = newSendKey();
      try { localStorage.setItem(SEND_RETRY_KEY, JSON.stringify({ fp: fp, key: key })); } catch (e) {}
      return key;
    }

    // The browser's own "are you sure" while rows are being written. Not a
    // nicety: closing the tab mid-request can cancel it server-side, and the
    // owner would walk away believing a message went out that never did.
    function holdPage(e) { e.preventDefault(); e.returnValue = ""; return ""; }

    function sendError(code) {
      const key = "ERR_" + String(code || "");
      const box = $("cuSendErr");
      box.textContent = STRINGS.en[key] ? t(key) : t("ERR_SEND_FAILED");
      box.hidden = false;
    }

    function sendNote(msg) {
      const note = $("cuSent");
      note.textContent = msg;
      note.hidden = false;
      clearTimeout(sentNoteTimer);
      sentNoteTimer = setTimeout(() => { note.hidden = true; }, 9000);
    }

    // Cleared only after something actually landed — a send that failed
    // keeps its text and its key, so the owner can press again and the
    // server can tell it is the same send.
    function clearComposer() {
      sendKey = "";
      try { localStorage.removeItem(SEND_RETRY_KEY); } catch (e) {}
      sendMsg.value = "";
      $("cuSendChars").textContent = "0";
      discAttached = null;
      $("cuFDeal").value = ""; $("cuFDesc").value = "";
      $("cuFExpAmt").value = "2"; $("cuFExpUnit").value = "week";
      setDiscState("none");
    }

    // Send asks; it does not send. Nothing on this page reaches as far as
    // this button does, and there is no unsend — so the press that does it
    // is a separate, deliberate one, on a control that is not where the
    // first press was.
    // `instant` skips the choreography for the cases that are not a
    // transition at all: opening the sheet, and the hand-off into sending.
    let confirmTimer = null;
    function showSendConfirm(show, instant) {
      const box = $("cuConfirm"), btn = $("cuSendGo");
      clearTimeout(confirmTimer);

      if (!show) {
        if (instant || box.hidden) { box.hidden = true; box.classList.add("is-sealed"); btn.hidden = false; return; }
        // collapse back into one button, THEN hand the slot back to Send
        box.classList.add("is-sealed");
        confirmTimer = setTimeout(() => { box.hidden = true; btn.hidden = false; }, 420);
        return;
      }

      $("cuConfirmQ").textContent = t("OWNER_SEND_CONFIRM_Q", { n: cuView.length });
      const r = $("cuConfirmR");
      r.hidden = !discAttached;
      if (discAttached) r.textContent = t("OWNER_SEND_CONFIRM_REWARD", { deal: discAttached.deal });

      // "Yes" takes the pressed button's exact place in the same frame it
      // is hidden, so the swap is invisible and only the split is seen.
      box.classList.add("is-sealed");
      box.hidden = false;
      btn.hidden = true;
      // measured while sealed (max-height:0 does not stop scrollHeight from
      // reporting the content's real height), so the opening has a true
      // target rather than a guessed ceiling
      const say = $("cuConfirmSay");
      box.style.setProperty("--sayh", say.scrollHeight + "px");
      // resolve the sealed geometry before releasing it, or the transition
      // has no start value. rAF would do it too, except it is throttled to
      // a standstill in a background tab (see makeSheet).
      void getComputedStyle($("cuConfirmNo")).flexGrow;
      box.classList.remove("is-sealed");
      $("cuConfirmNo").focus();   // the safe half, not the one that sends
    }

    $("cuSendGo").onclick = () => {
      if (sending || $("cuSendGo").disabled) return;
      showSendConfirm(true);
    };
    $("cuConfirmNo").onclick = () => showSendConfirm(false);
    $("cuConfirmYes").onclick = () => doSend();

    async function doSend() {
      if (sending) return;
      const ids = cuView.map((c) => c.id).filter(Boolean);
      const body = sendMsg.value.trim();
      if (!body || !ids.length) { showSendConfirm(false); return; }
      sendKey = keyForSend(body);
      // back to the Send button, which carries the sending state — no
      // split to play backwards here, the press was accepted
      showSendConfirm(false, true);

      sending = true;                       // also bolts the sheet shut
      $("cuSend").classList.add("is-sending");
      $("cuSendGo").disabled = true;
      $("cuSendErr").hidden = true;
      $("cuSendGoLabel").textContent = t("OWNER_SEND_SENDING");
      window.addEventListener("beforeunload", holdPage);

      const payload = { ids: ids, body: body, send_id: sendKey };
      if (discAttached) {
        payload.discount = {
          deal: discAttached.deal,
          description: discAttached.desc,
          expiry_amount: discAttached.amt,
          expiry_unit: discAttached.unit,
        };
      }

      let data = null, failCode = null, offline = false;
      try {
        const r = await fetch(API + "/owner/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) data = d; else failCode = (d && d.code) || "SEND_FAILED";
      } catch (e) {
        offline = true;
      }

      // The round trip is over however it went, so the sheet is free to move
      // again and the page is free to leave. Both are released BEFORE the
      // outcome is acted on, because the success path closes the sheet.
      sending = false;
      $("cuSend").classList.remove("is-sending");
      window.removeEventListener("beforeunload", holdPage);
      $("cuSendGoLabel").textContent = t("OWNER_SEND_GO");
      refreshSendReady();

      if (offline) {
        // Deliberately not "nothing was sent": the request may have landed
        // and committed with only the answer lost. Pressing Send again is
        // safe — the key makes the retry a no-op if it did.
        $("cuSendErr").textContent = t("ERR_SEND_LOST");
        $("cuSendErr").hidden = false;
        return;
      }
      if (failCode) { sendError(failCode); return; }

      if (data.duplicate) {
        sendNote(t("OWNER_SEND_ALREADY"));
      } else {
        sendNote(data.skipped
          ? t("OWNER_SEND_DONE_SKIPPED", { n: data.sent, s: data.skipped })
          : t("OWNER_SEND_DONE", { n: data.sent }));
      }
      // Cleared whether or not the sheet is still open: if the owner shut it
      // between the response and here, the composer still has to be emptied
      // or the next open offers the same message again.
      clearComposer();
      sendSheet.close();
    }
    $("cuReset").onclick = () => { cuDraft = Object.assign({}, CU_FILTER_OFF); syncSheetChips(); };
    $("cuApply").onclick = () => {
      cuFilter = Object.assign({}, cuDraft);
      closeSheet(() => {
        applyCustomerView();
        // a narrowed list starts at the top; leaving the scroll where it was
        // can land an owner past the end of the new, shorter list
        $("panelCustomers").scrollIntoView({ block: "start" });
      });
    };

    // ---------------- bottom tab bar ----------------
    // Same sliding-indicator pattern as the customer wallet's tabbar
    // (index.html / app.js setTab): each tab maps to one .panel.
    const tabbarEl = $("tabbar");
    const panelBtns = { analytics: $("tabAnalytics"), customers: $("tabCustomers"), discounts: $("tabDiscounts"), card: $("tabCard"), settings: $("tabSettings") };
    const panels = { analytics: $("panelAnalytics"), customers: $("panelCustomers"), discounts: $("panelDiscounts"), card: $("panelCard"), settings: $("panelSettings") };
    // Positions in the bar, not the order of this file: card is the middle of
    // the five, which is why it is 2 and not 1. Must match the source order of
    // the buttons in owner.html — the indicator is placed off this number
    // alone, so a tab moved there and not here slides the pill to the wrong
    // button.
    const TAB_INDEX = { analytics: 0, customers: 1, card: 2, discounts: 3, settings: 4 };

    function setOwnerTab(name) {
      tabbarEl.style.setProperty("--ti", TAB_INDEX[name]);
      // card is the circular tab and carries its own fill, so the sliding
      // indicator hides rather than landing a square pill behind a circle
      tabbarEl.classList.toggle("is-card", name === "card");
      for (const k in panelBtns) panelBtns[k].classList.toggle("is-active", k === name);
      for (const k in panels) panels[k].hidden = k !== name;
      // fetch /owner/stats only the first time the owner actually opens this
      // tab, not on every dashboard load — analytics is a heavier call than
      // café/rewards and most sessions never visit it
      if (name === "analytics" && !analyticsLoaded) { analyticsLoaded = true; loadAnalytics(); }
      if (name === "customers" && !customersLoaded) { customersLoaded = true; loadCustomers(); }
    }
    $("tabAnalytics").onclick = () => setOwnerTab("analytics");
    $("tabCustomers").onclick = () => setOwnerTab("customers");
    $("tabDiscounts").onclick = () => setOwnerTab("discounts");
    $("tabCard").onclick = () => setOwnerTab("card");
    $("tabSettings").onclick = () => setOwnerTab("settings");

    // land on the tab the owner actually asked for — e.g. a bookmarked
    // "/owner#analytics" — instead of always resetting to Card, the static
    // HTML's default tab
    const initialTab = ["analytics", "customers", "discounts", "card", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "card";
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
