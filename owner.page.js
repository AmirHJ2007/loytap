// ===================================================================
// Reloy — owner dashboard: café settings, rewards, staff code, print.
// Moved out of owner.html verbatim so the page needs no inline script.
// ===================================================================
    applyI18n();
    const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
    const token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();
    const $ = (id) => document.getElementById(id);
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
          stampsVal = d.stamps_required || 8; renderStamps();
          $("fMinPurchase").value = d.min_purchase ? d.min_purchase : "";
          showLogo(d.collection_id, d.logo);
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
        $("addForm").classList.remove("is-open"); $("addBtn").textContent = t("OWNER_BTN_ADD"); updatePreview();
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
      $("addBtn").textContent = open ? t("STAFF_BTN_CLOSE") : t("OWNER_BTN_ADD");
      if (open) { updatePreview(); $("fDeal").focus(); }
    };
    $("cancelBtn").onclick = () => { $("addForm").classList.remove("is-open"); $("addBtn").textContent = t("OWNER_BTN_ADD"); };
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
        if (r.ok) { $("fMinPurchase").value = d.min_purchase ? d.min_purchase : ""; $("minOk").hidden = false; setTimeout(() => { $("minOk").hidden = true; }, 1800); }
        else { $("minErr").textContent = d.error || t("OWNER_ERR_SAVE_FAILED"); $("minErr").hidden = false; }
      } catch (e) { $("minErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE"); $("minErr").hidden = false; }
      finally { $("minSave").disabled = false; }
    };
    // ---------------- café logo ----------------
    // Optional. No logo means the customer's card renders exactly as it always
    // has — there is no placeholder on the card, only in this preview.
    function showLogo(collectionId, name) {
      const img = $("logoImg"), prev = $("logoPrev");
      if (collectionId && name) {
        // cache-bust so a freshly replaced logo doesn't show the old one
        img.src = API + "/api/files/" + collectionId + "/" + cafeId + "/" + encodeURIComponent(name) +
          "?thumb=240x240&r=" + Date.now();
        img.hidden = false; $("logoEmpty").hidden = true; prev.classList.add("has-img");
        $("logoRemove").hidden = false;
      } else {
        img.removeAttribute("src"); img.hidden = true;
        $("logoEmpty").hidden = false; prev.classList.remove("has-img");
        $("logoRemove").hidden = true;
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

    $("signout").onclick = () => { ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} }); location.replace("auth.html"); };

    loadCafe().then(loadRewards);
