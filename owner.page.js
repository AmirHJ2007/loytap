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
      } catch (e) {}
      // no live token to refresh — same wall-clock expiry as before, just
      // caught here on page load instead of silently on the next fetch
      ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"]
        .forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      location.replace("/signin");
    })();
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function unitWord(unit, amt) {
      const key = { day: amt > 1 ? "OWNER_UNIT_DAYS" : "OWNER_UNIT_DAY",
        week: amt > 1 ? "OWNER_UNIT_WEEKS" : "OWNER_UNIT_WEEK",
        month: amt > 1 ? "OWNER_UNIT_MONTHS" : "OWNER_UNIT_MONTH" }[unit];
      return key ? t(key) : unit;
    }
    document.querySelectorAll('#fQty option[value]').forEach((opt) => {
      const n = parseInt(opt.value, 10);
      if (n >= 4) opt.textContent = t("OWNER_QTY_COPIES", { n });
    });

    try { $("ownerName").textContent = localStorage.getItem("loytap_name") || t("OWNER_NAME_FALLBACK"); } catch (e) {}
    $("ownHi").innerHTML = t("OWNER_HI_HTML", { name: esc($("ownerName").textContent) });

    let cafeId = "";

    async function loadCafe() {
      try {
        const r = await fetch(API + "/owner/cafe", { headers: { Authorization: token } });
        const d = await r.json();
        if (r.ok) {
          cafeId = d.id || "";
          $("cafeName").textContent = d.cafe_name || t("OWNER_CAFE_FALLBACK");
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
        list.innerHTML = items.map((x, i) => {
          const deal = x.deal || t("WALLET_REWARD_FALLBACK");
          const tag = x.active ? "" : `<span class="rw__off">${t("OWNER_TAG_HIDDEN")}</span>`;
          const amt = Number(x.expiry_amount) || 0;
          const unit = x.expiry_unit || "";
          const exp = amt && unit ? `<span class="rw__exp">⏳ ${amt} ${unitWord(unit, amt)}</span>` : "";
          const pctM = deal.match(/(\d+)\s*%/);
          const badge = pctM ? `<span class="rw__badge">${pctM[1]}%</span>` : `<span class="rw__badge rw__badge--emoji">🎁</span>`;
          return `<div class="rw${x.active ? "" : " rw--off"}" style="--i:${i}">
            ${badge}
            <div class="rw__main">
              <div class="rw__top"><span class="rw__deal">${esc(deal)}</span>${tag}</div>
              ${x.description ? `<p class="rw__desc">${esc(x.description)}</p>` : ""}
              ${exp}
            </div>
            <button class="rw__del" data-id="${x.id}" title="${t("OWNER_BTN_DELETE_TITLE")}">✕</button>
          </div>`;
        }).join("");
        list.querySelectorAll(".rw__del").forEach((b) => b.addEventListener("click", () => askDelete(b)));
      } catch (e) {
        list.innerHTML = `<p class="rw-empty">${t("OWNER_RW_LOAD_ERROR")}</p>`;
      }
    }

    function askDelete(btn) {
      const id = btn.dataset.id;
      const wrap = document.createElement("div");
      wrap.className = "rw__confirm";
      wrap.innerHTML = `<span class="rw__ask">${t("OWNER_CONFIRM_DELETE")}</span><button class="rw__yes" type="button">${t("OWNER_YES")}</button><button class="rw__no" type="button">${t("OWNER_NO")}</button>`;
      btn.replaceWith(wrap);
      wrap.querySelector(".rw__yes").onclick = () => delReward(id);
      wrap.querySelector(".rw__no").onclick = () => loadRewards();
    }

    async function delReward(id) {
      try {
        const r = await fetch(API + "/api/collections/reward_options/records/" + id, { method: "DELETE", headers: { Authorization: token } });
        if (r.ok || r.status === 204) loadRewards();
      } catch (e) {}
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
          active: $("fActive").checked,
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
        $("fDeal").value = ""; $("fDesc").value = ""; $("fQty").value = "1"; $("fActive").checked = true;
        $("fExpAmt").value = "2"; $("fExpUnit").value = "week";
        $("addForm").classList.remove("is-open"); $("addBtn").classList.remove("is-open"); updatePreview();
        loadRewards();
      } catch (e) {
        $("addErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE"); $("addErr").hidden = false;
      } finally {
        $("saveBtn").disabled = false;
      }
    }

    function updatePreview() {
      const deal = $("fDeal").value.trim() || t("OWNER_PV_DEAL_DEFAULT");
      const desc = $("fDesc").value.trim();
      const amt = Math.max(1, parseInt($("fExpAmt").value, 10) || 1);
      const unit = $("fExpUnit").value;
      $("pvDeal").textContent = deal;
      $("pvDesc").textContent = desc;
      $("pvExp").textContent = t("OWNER_PV_EXPIRES", { amt, unit: unitWord(unit, amt) });
    }
    ["fDeal", "fDesc", "fExpAmt", "fExpUnit"].forEach((id) => {
      const el = $(id); if (!el) return;
      el.addEventListener("input", updatePreview); el.addEventListener("change", updatePreview);
    });

    $("addBtn").onclick = () => {
      const open = $("addForm").classList.toggle("is-open");
      $("addBtn").classList.toggle("is-open", open);
      $("addBtn").setAttribute("aria-label", t(open ? "STAFF_BTN_CLOSE" : "OWNER_ARIA_ADD_DISCOUNT"));
      if (open) { updatePreview(); $("fDeal").focus(); }
    };
    $("cancelBtn").onclick = () => { $("addForm").classList.remove("is-open"); $("addBtn").classList.remove("is-open"); $("addBtn").setAttribute("aria-label", t("OWNER_ARIA_ADD_DISCOUNT")); };
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
        else { $("minErr").textContent = d.error || t("OWNER_ERR_SAVE_FAILED"); $("minErr").hidden = false; }
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
          $("cafeName").textContent = d.cafe_name || t("OWNER_CAFE_FALLBACK");
          $("setCafeName").textContent = d.cafe_name || t("OWNER_CAFE_FALLBACK");
          savedCafeName = d.cafe_name || ""; savedTagline = d.tagline || "Cafe"; savedAccent = d.accent || "#171717";
          showIdentitySummary();
          $("identityOk").hidden = false;
          setTimeout(() => { $("identityOk").hidden = true; }, 1800);
        } else { $("identityErr").textContent = d.error || t("OWNER_ERR_SAVE_FAILED"); $("identityErr").hidden = false; }
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
        else logoErr(d.error || t("OWNER_ERR_SAVE_FAILED"));
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
        else logoErr(d.error || t("OWNER_ERR_SAVE_FAILED"));
      } catch (e) { logoErr(t("AUTH_ERR_SERVER_UNREACHABLE")); }
      finally { box.classList.remove("is-busy"); }
    };

    $("signout").onclick = () => { ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} }); location.replace("/signin"); };

    // ---------------- analytics tab ----------------
    // Ported verbatim from the old standalone analytics.page.js (analytics.html
    // is now folded into this page as a fourth tab) — only its DOM anchors
    // changed: #content -> #anContent and #cafeName -> #anCafeName, since this
    // page already has its own #cafeName (the header banner on Settings). It
    // fetches /owner/stats lazily, the first time this tab is opened (see
    // loadAnalytics()/setOwnerTab below), not on every dashboard load.
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

      $("anContent").innerHTML = `
        <div class="card glass" id="actCard"></div>

        <div class="card glass" id="cbCard"></div>

        <div class="card glass" id="arCard"></div>

        <div class="card glass" id="vrCard"></div>

        <div class="card glass" id="nlCard"></div>

        <div class="card glass" id="hmCard"></div>

        <div class="card glass" id="ruCard">
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
        </div>`;

      if (d.comeback) setupComeback(d.comeback);
      if (d.visitRhythm) setupVisitRhythm(d.visitRhythm);
      if (d.activeRate) setupActiveRate(d.activeRate);
      if (d.newVsLoyal) setupNewVsLoyal(d.newVsLoyal);
      if (d.crowded) setupCrowded(d.crowded);
      if (d.activity) setupActivity(d.activity);

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
      const cellBg = (v) => (!max || v === 0) ? "rgba(20,20,20,0.045)" : `rgba(20,20,20,${(0.14 + 0.76 * (v / max)).toFixed(3)})`;
      const days = c.days.map(dow);

      let cells = `<div class="hm__corner"></div>` + c.slots.map((s) => `<div class="hm__sl">${esc(s)}</div>`).join("");
      c.grid.forEach((rowvals, r) => {
        cells += `<div class="hm__dl">${esc(days[r])}</div>`;
        cells += rowvals.map((v, s) =>
          `<button class="hm__cell" data-r="${r}" data-s="${s}" data-v="${v}" style="background:${cellBg(v)}" title="${esc(t("AN_HM_CELL_TITLE", { day: days[r], slot: isolateLTR(c.slots[s]), v, stampWord: stampWord(v) }))}"></button>`
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
        body = `
          <div class="nl-top"><div class="nl-v"><span class="count" data-count-to="${nl.newRate}" data-count-suffix="%">0%</span><span class="i18n-rtl">${t("AN_NL_NEW_LABEL")}</span></div></div>
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
        return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${last ? 3.4 : 2}" fill="${last ? "#171717" : "rgba(20,20,20,0.55)"}"/>`
          + `<circle class="cb-hit" data-i="${i}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="11" fill="transparent"><title>${esc(series[i].label)}: ${series[i].rate}%</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${esc(series[i].label)}</text>`
      ).join("");
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Comeback rate, last 14 days">
        ${grid}
        <path class="chart-area" d="${area}" fill="rgba(20,20,20,0.07)"/>
        <path class="chart-line" pathLength="1" d="${path}" fill="none" stroke="#171717" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}${xlab}
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
      const cap = $("cbCap");
      const setCap = (i) => { const x = s[i]; cap.innerHTML = t("AN_CB_CAP_HTML", { days: cb.windowDays, label: isolateLTR(esc(x.label)), rate: x.rate, returners: x.returners, newMembers: x.newMembers }); };
      setCap(s.length - 1);
      card.querySelectorAll(".cb-hit").forEach((el) => el.onclick = () => setCap(+el.dataset.i));
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
        return `<circle cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="${last ? 3.4 : 2}" fill="${last ? "#171717" : "rgba(20,20,20,0.55)"}"/>`
          + `<circle class="vr-hit" data-i="${i}" cx="${X(i).toFixed(1)}" cy="${Y(s.value).toFixed(1)}" r="11" fill="transparent"><title>${esc(s.label)}: ${s.value}d</title></circle>`;
      }).join("");
      const xi = [0, Math.floor((n - 1) / 2), n - 1];
      const xlab = xi.map((i) =>
        `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="8.5" font-weight="700" fill="var(--faint)">${esc(series[i].label)}</text>`
      ).join("");
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visit rhythm, last 14 days">
        ${grid}
        <path class="chart-line" pathLength="1" d="${path.trim()}" fill="none" stroke="#171717" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}${xlab}
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
          <div class="cb-today__v">${last.value == null ? "—" : `<span class="count" data-count-to="${last.value}" data-count-decimals="${Number.isInteger(last.value) ? 0 : 1}">0</span>`}${last.value == null ? "" : `<span class="cb-today__u">${unit(last.value)}</span>`}</div>
          <div class="cb-today__k">${t("AN_TODAY_LAST_DAYS", { days: vr.windowDays })}<span>${t("AN_VR_CUSTOMERS_MEASURED", { n: last.customers, customerWord: customerWord(last.customers) })}</span></div>
        </div>
        <div class="cb-chart">${vrLineChart(s)}</div>
        <p class="cb-cap" id="vrCap"></p>`;
      const info = card.querySelector(".cb-info");
      card.querySelector(".info-btn").onclick = () => { info.hidden = !info.hidden; };
      const cap = $("vrCap");
      const setCap = (i) => {
        const x = s[i];
        cap.innerHTML = x.value == null
          ? t("AN_VR_CAP_EMPTY_HTML", { days: vr.windowDays, label: isolateLTR(esc(x.label)) })
          : t("AN_VR_CAP_HTML", { days: vr.windowDays, label: isolateLTR(esc(x.label)), value: x.value, unit: unit(x.value), n: x.customers, customerWord: customerWord(x.customers) });
      };
      setCap(s.length - 1);
      card.querySelectorAll(".vr-hit").forEach((el) => el.onclick = () => setCap(+el.dataset.i));
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
        return `<button class="act-bar${x.date === actSel ? " is-sel" : ""}" data-date="${x.date}" title="${esc(translateLabel(x.label))}"><span class="act-bar__fill" style="height:${h}%"></span><span class="act-bar__lab">${esc(lab)}</span></button>`;
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
        <div class="act-chart"><span class="act-ymax">${max}</span><div class="act-bars">${bars}</div></div>
        <div class="act-stats">
          <div><b>${data.stamps}</b><span>${t("AN_STAMP_MANY")}</span></div>
          <div><b>${data.members}</b><span>${t("AN_MEMBER_MANY")}</span></div>
          <div><b>${data.rewards}</b><span>${t("AN_REWARD_MANY")}</span></div>
        </div>
        <p class="act-cmp ${cmpCls}">${esc(cmpTxt)}</p>`;
    }

    function renderActivity() {
      const card = $("actCard");
      if (!card || !ACT) return;
      card.innerHTML = activityCardHTML(actPeriod === 30 ? ACT.d30 : ACT.d7);
      card.querySelectorAll(".act-toggle button").forEach((b) => b.onclick = () => { actPeriod = parseInt(b.dataset.p, 10); actSel = null; renderActivity(); });
      card.querySelectorAll(".act-bar").forEach((b) => b.onclick = () => { actSel = b.dataset.date; renderActivity(); });
      const ib = card.querySelector(".info-btn");
      if (ib) ib.onclick = () => { actInfoOpen = !actInfoOpen; card.querySelector(".cb-info").hidden = !actInfoOpen; };
    }

    function setupActivity(activity) { ACT = activity; actPeriod = 7; actSel = null; renderActivity(); }

    let analyticsLoaded = false;
    async function loadAnalytics() {
      try { $("anCafeName").textContent = t("OWNER_CAFE_FALLBACK"); } catch (e) {}
      try {
        const cn = localStorage.getItem("loytap_cafe"); if (cn) $("anCafeName").textContent = cn;
      } catch (e) {}
      try {
        const res = await fetch(API + "/owner/stats", { method: "POST", headers: { Authorization: token } });
        if (!res.ok) { $("anContent").innerHTML = `<div class="card glass"><p class="empty">${t("AN_ERR_LOAD_FAILED")}</p></div>`; return; }
        const data = await res.json();
        if (data.cafe) $("anCafeName").textContent = data.cafe;
        renderAnalytics(data);
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
      // the café name / "Owner Dashboard" / "Hello, ___" banner only stays on
      // the Settings tab — Card, Discounts and Analytics all want the full screen
      const showHeader = name === "settings";
      $("ownHeaderBlock").hidden = !showHeader;
      $("own").classList.toggle("no-header", !showHeader);
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
