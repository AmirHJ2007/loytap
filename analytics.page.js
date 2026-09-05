// ===================================================================
// Reloy — owner analytics: fetches /owner/stats and draws every card.
// Moved out of analytics.html verbatim so the page needs no inline script.
// ===================================================================
    applyI18n();
    const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
    const token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

    try { $("cafeName").textContent = t("OWNER_CAFE_FALLBACK"); } catch (e) {}

    // ---------------- bottom tab bar ----------------
    // Analytics is already the active tab here; the other three are a
    // different page (owner.html), which reads the hash to land on the right
    // one of its own tabs (see setOwnerTab/initial-tab logic in owner.page.js).
    $("tabCard").onclick = () => { location.href = "owner.html"; };
    $("tabDiscounts").onclick = () => { location.href = "owner.html#discounts"; };
    $("tabSettings").onclick = () => { location.href = "owner.html#settings"; };

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

    function render(d) {
      const tot = d.totals, r = d.rates;
      if (!tot.customers && !tot.issued) {
        // Every .card starts at opacity:0 and only becomes visible once
        // revealCards()'s IntersectionObserver adds .in to it (see below) —
        // the full dashboard always reaches that call at the end of render(),
        // but this early return skipped it entirely, leaving the "no data
        // yet" message permanently invisible instead of just empty.
        $("content").innerHTML = `<div class="card glass"><p class="empty">${t("AN_EMPTY_HTML")}</p></div>`;
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

      $("content").innerHTML = `
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
      const cards = Array.from(document.querySelectorAll("#content .card"));
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

    async function load() {
      try {
        const cn = localStorage.getItem("loytap_cafe"); if (cn) $("cafeName").textContent = cn;
      } catch (e) {}
      try {
        const res = await fetch(API + "/owner/stats", { method: "POST", headers: { Authorization: token } });
        if (!res.ok) { $("content").innerHTML = `<div class="card glass"><p class="empty">${t("AN_ERR_LOAD_FAILED")}</p></div>`; return; }
        const data = await res.json();
        if (data.cafe) $("cafeName").textContent = data.cafe;
        render(data);
      } catch (e) {
        $("content").innerHTML = `<div class="card glass"><p class="empty">${t("AUTH_ERR_SERVER_UNREACHABLE")}</p></div>`;
      }
    }
    load();
