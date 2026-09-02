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
    $("signout").onclick = () => { ["loytap_token", "loytap_owner", "loytap_role", "loytap_staff", "loytap_signed_in", "loytap_name", "loytap_cafe"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} }); location.replace("auth.html"); };

    loadCafe().then(loadRewards);
