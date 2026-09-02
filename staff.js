// ===================================================================
// Reloy — café staff scanner.
// Scans a customer's discount QR (which carries only the opaque code),
// sends it to the backend, and shows the server's verdict. A valid code
// is redeemed on the server in the same step.
// ===================================================================

// When the page is served by PocketBase (or a tunnel / Liara), the API is same-origin.
// When served from the standalone :8000 dev server, talk to PocketBase on :8090.
const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
const token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();

applyI18n();

const PERSIAN_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌‏]/g;
document.getElementById("manualInput").addEventListener("input", (e) => {
  const el = e.target;
  const filtered = el.value.replace(PERSIAN_RE, "");
  if (filtered !== el.value) {
    const pos = el.selectionStart - (el.value.length - filtered.length);
    el.value = filtered;
    el.setSelectionRange(pos, pos);
  }
});

const ICONS = {
  ok:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>`,
  bad:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
};

const el = {
  scanner: document.getElementById("scanner"),
  video: document.getElementById("video"),
  scanBtn: document.getElementById("scanBtn"),
  note: document.getElementById("scannerNote"),
  manualForm: document.getElementById("manualForm"),
  manualInput: document.getElementById("manualInput"),
  result: document.getElementById("result"),
  resultScrim: document.getElementById("resultScrim"),
  resultIcon: document.getElementById("resultIcon"),
  resultStatus: document.getElementById("resultStatus"),
  resultBody: document.getElementById("resultBody"),
  resultActions: document.getElementById("resultActions"),
};

let stream = null;
let scanning = false;
let rafId = null;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// ---------------- Camera scanning ----------------
async function startScan() {
  if (scanning) { stopScan(); return; }
  if (!window.isSecureContext) {
    el.note.textContent = t("STAFF_ERR_HTTPS");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.note.textContent = t("STAFF_ERR_NO_CAMERA_API");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    el.video.srcObject = stream;
    await el.video.play();
    scanning = true;
    el.scanner.classList.add("is-live");
    el.scanBtn.textContent = t("STAFF_BTN_STOP");
    el.note.textContent = t("STAFF_NOTE_SCANNING");
    rafId = requestAnimationFrame(loop);
  } catch (err) {
    el.note.textContent = err && err.name === "NotAllowedError"
      ? t("STAFF_ERR_CAMERA_DENIED")
      : t("STAFF_ERR_CAMERA_START_FAILED");
  }
}

function stopScan() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  el.scanner.classList.remove("is-live");
  el.scanBtn.textContent = t("STAFF_BTN_START");
  el.note.textContent = "";
}

function loop() {
  if (!scanning) return;
  const v = el.video;
  if (v.readyState === v.HAVE_ENOUGH_DATA) {
    const w = v.videoWidth, h = v.videoHeight;
    if (w && h) {
      canvas.width = w; canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        stopScan();
        handleCode(code.data);
        return;
      }
    }
  }
  rafId = requestAnimationFrame(loop);
}

// ---------------- Lookup + redeem (server-side) ----------------
async function handleCode(raw) {
  const code = String(raw).trim().toUpperCase().replace(/^LOYTAP[:/]*/, "");
  if (!code) return;

  showResult("warn", t("STAFF_STATUS_CHECKING"), `<p class="result__code">${escapeHtml(code)}</p>`,
    [button("btn--ghost", t("STAFF_BTN_CANCEL"), closeResult)]);

  let res;
  try {
    const r = await fetch(API + "/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ code }),
    });
    res = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) {
      showResult("bad", t("STAFF_STATUS_NOT_SIGNED_IN"), `<p class="result__desc">${t("STAFF_DESC_SIGN_IN_AGAIN")}</p>`,
        [button("btn--ghost", t("STAFF_BTN_CLOSE"), closeResult)]);
      return;
    }
  } catch (err) {
    showResult("bad", t("STAFF_STATUS_UNREACHABLE"), `<p class="result__desc">${t("STAFF_DESC_CHECK_CONNECTION")}</p>`,
      [button("btn--primary", t("STAFF_BTN_TRY_AGAIN"), () => { closeResult(); handleCode(code); }), button("btn--ghost", t("STAFF_BTN_CLOSE"), closeResult)]);
    return;
  }

  const scanAgain = button("btn--primary", t("STAFF_BTN_SCAN_ANOTHER"), () => { closeResult(); startScan(); });
  const close = button("btn--ghost", t("STAFF_BTN_CLOSE"), closeResult);

  if (res.status === "ok") {
    showResult("ok", t("STAFF_STATUS_REDEEMED"),
      couponHtml(res) + `<p class="result__desc" style="margin-top:10px">${t("STAFF_DESC_APPLIED")}</p>`,
      [scanAgain, close]);
  } else if (res.status === "already") {
    showResult("warn", t("STAFF_STATUS_ALREADY"), couponHtml(res), [scanAgain, close]);
  } else if (res.status === "expired") {
    showResult("warn", t("STAFF_STATUS_EXPIRED"), couponHtml(res), [scanAgain, close]);
  } else if (res.status === "wrong_cafe") {
    showResult("bad", t("STAFF_STATUS_WRONG_CAFE"),
      `<p class="result__code">${escapeHtml(code) || "—"}</p>
       <p class="result__desc" style="margin-top:10px">${t("STAFF_DESC_WRONG_CAFE", { shop: escapeHtml(res.shop || t("STAFF_FALLBACK_ANOTHER_CAFE")) })}</p>`,
      [scanAgain, close]);
  } else {
    showResult("bad", t("STAFF_STATUS_INVALID"),
      `<p class="result__code">${escapeHtml(code) || "—"}</p>
       <p class="result__desc" style="margin-top:10px">${t("STAFF_DESC_NO_MATCH")}</p>`,
      [scanAgain, close]);
  }
}

function couponHtml(res) {
  return `<p class="result__deal">${escapeHtml(res.deal || t("WALLET_REWARD_FALLBACK"))}</p>
    <p class="result__shop">${escapeHtml(res.shop || "")}</p>
    ${res.description ? `<p class="result__desc">${escapeHtml(res.description)}</p>` : ""}
    <span class="result__code">${escapeHtml(res.code || "")}</span>`;
}

function showResult(kind, status, bodyHtml, actions) {
  el.resultIcon.className = "result__icon " + kind;
  el.resultIcon.innerHTML = ICONS[kind];
  el.resultStatus.textContent = status;
  el.resultBody.innerHTML = bodyHtml;
  el.resultActions.innerHTML = "";
  actions.forEach((b) => el.resultActions.appendChild(b));
  el.result.hidden = false;
  el.result.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => el.result.classList.add("show"));
}

function closeResult() {
  el.result.classList.remove("show");
  el.result.setAttribute("aria-hidden", "true");
  setTimeout(() => { el.result.hidden = true; }, 240);
}

function button(cls, label, onClick) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- Incoming stamp-tap requests (realtime, no refresh) ----------------
// A customer's tap no longer stamps instantly — it creates a pending
// stamp_requests row and the customer watches it live. This panel is the
// other end: PocketBase pushes every pending request for OUR café straight
// to this page over SSE (row-level scoped by the collection's viewRule —
// see 1700000016_stamp_requests.js), and Approve/Deny resolves it for both
// sides at once, no polling on either end.
const REQUEST_TTL_MS = 30000;
const queueEl = document.getElementById("requestQueue");
const incoming = new Map(); // request id -> { el, num, bar, timer }

let rtSource = null;
function rtWatchCollection(name, onEvent) {
  if (!token || typeof EventSource === "undefined") return;
  rtSource = new EventSource(API + "/api/realtime");
  rtSource.addEventListener("PB_CONNECT", (e) => {
    let clientId = "";
    try { clientId = JSON.parse(e.data).clientId; } catch (_) {}
    if (!clientId) return;
    fetch(API + "/api/realtime", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ clientId, subscriptions: [name] }),
    }).catch(() => {});
  });
  rtSource.addEventListener(name, (e) => {
    let rec = null;
    try { rec = JSON.parse(e.data).record; } catch (_) {}
    if (rec) onEvent(rec);
  });
}

function recordAgeMs(rec) {
  const ms = new Date(String(rec.created || "").replace(" ", "T")).getTime();
  return isNaN(ms) ? REQUEST_TTL_MS : Date.now() - ms;
}

function addIncoming(rec) {
  if (incoming.has(rec.id)) return;
  const remaining = Math.max(0, Math.ceil((REQUEST_TTL_MS - recordAgeMs(rec)) / 1000));
  if (remaining <= 0) return; // arrived already stale — ignore

  const rawName = (rec.user_name || "").trim();
  const name = rawName || t("STAFF_INCOMING_FALLBACK_NAME");
  const initial = (rawName || "?").charAt(0).toUpperCase();

  const card = document.createElement("div");
  card.className = "incoming";
  card.innerHTML = `
    <div class="incoming__head">
      <span class="incoming__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <div class="incoming__body">
        <p class="incoming__name"><bdi>${escapeHtml(name)}</bdi></p>
        <p class="incoming__sub">${escapeHtml(t("STAFF_INCOMING_WANTS"))}</p>
      </div>
      <div class="incoming__ringwrap">
        <svg class="incoming__ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="incoming__track" cx="32" cy="32" r="27" />
          <circle class="incoming__bar" cx="32" cy="32" r="27" />
        </svg>
        <span class="incoming__num"></span>
      </div>
    </div>
    <div class="incoming__actions">
      <button class="incoming__btn incoming__btn--deny" type="button">${ICONS.bad}<span>${escapeHtml(t("STAFF_BTN_DENY"))}</span></button>
      <button class="incoming__btn incoming__btn--approve" type="button">${ICONS.ok}<span>${escapeHtml(t("STAFF_BTN_APPROVE"))}</span></button>
    </div>`;
  queueEl.appendChild(card);
  void card.offsetWidth;
  requestAnimationFrame(() => card.classList.add("show"));
  setTimeout(() => card.classList.add("show"), 40); // fallback if rAF is throttled

  const bar = card.querySelector(".incoming__bar");
  const num = card.querySelector(".incoming__num");
  const CIRC = 2 * Math.PI * 27;
  bar.style.strokeDasharray = String(CIRC);
  bar.style.transition = "none";
  bar.style.strokeDashoffset = String(CIRC * (1 - remaining / (REQUEST_TTL_MS / 1000)));
  void bar.offsetWidth;
  bar.style.transition = `stroke-dashoffset ${remaining}s linear`;
  requestAnimationFrame(() => { bar.style.strokeDashoffset = String(CIRC); });

  let left = remaining;
  num.textContent = String(left);
  const timer = setInterval(() => {
    left -= 1;
    num.textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(entry.timer);
      resolveIncoming(rec.id, "expired");
    }
  }, 1000);

  const entry = { el: card, timer };
  incoming.set(rec.id, entry);

  card.querySelector(".incoming__btn--approve").addEventListener("click", () => respondIncoming(rec.id, true));
  card.querySelector(".incoming__btn--deny").addEventListener("click", () => respondIncoming(rec.id, false));
}

async function respondIncoming(id, approve) {
  const entry = incoming.get(id);
  if (!entry || entry.el.classList.contains("is-busy")) return;
  entry.el.classList.add("is-busy");
  try {
    const r = await fetch(API + "/card/stamp/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ request_id: id, approve }),
    });
    const res = await r.json().catch(() => ({}));
    resolveIncoming(id, res.status || (approve ? "approved" : "denied"));
  } catch (err) {
    entry.el.classList.remove("is-busy"); // offline/failed — leave it live so staff can retry
  }
}

function resolveIncoming(id, status) {
  const entry = incoming.get(id);
  if (!entry) return;
  clearInterval(entry.timer);
  incoming.delete(id);
  entry.el.classList.remove("is-busy");
  entry.el.classList.add(status === "approved" ? "is-approved" : status === "denied" ? "is-denied" : "is-expired");
  if (status === "expired") { const p = entry.el.querySelector(".incoming__sub"); if (p) p.textContent = t("STAFF_INCOMING_EXPIRED"); }
  setTimeout(() => entry.el.remove(), 900);
}

// Pull any requests that are ALREADY pending when the panel opens — so a
// customer who tapped a moment before staff opened the page (or during the
// realtime handshake) still shows up. Every café's own pending requests are
// visible here (viewRule-scoped); each becomes its own card.
async function loadPendingRequests() {
  try {
    const url = API + "/api/collections/stamp_requests/records?perPage=100&sort=created&filter=" + encodeURIComponent("status='pending'");
    const r = await fetch(url, { headers: { Authorization: token } });
    const d = await r.json().catch(() => ({}));
    (d.items || []).forEach(addIncoming);
  } catch (_) {}
}

if (queueEl) {
  // subscribe first so nothing created during the initial fetch is lost,
  // then backfill anything already pending (addIncoming dedupes by id)
  rtWatchCollection("stamp_requests", (rec) => {
    if (rec.status === "pending") addIncoming(rec);
    else resolveIncoming(rec.id, rec.status);
  });
  loadPendingRequests();
}

// ---------------- Wiring ----------------
el.scanBtn.addEventListener("click", startScan);
el.resultScrim.addEventListener("click", closeResult);
el.manualForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el.manualInput.value.trim();
  if (!v) return;
  stopScan();
  handleCode(v);
  el.manualInput.value = "";
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.result.hidden) closeResult(); });
