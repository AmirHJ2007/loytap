// ===================================================================
// LoyTap — café staff scanner (frontend only, mock data for now).
// Scans a customer's discount QR, shows it, and lets staff redeem it.
// Later this talks to the backend instead of the mock ISSUED map.
// ===================================================================

// Mock "issued discounts" — normally these come from the backend.
const ISSUED = {
  AURORA20: { shop: "Aurora Coffee", deal: "20% OFF", desc: "your next order", used: false },
  BLOOM01:  { shop: "Bloom Bakery",  deal: "FREE",    desc: "a pastry of your choice", used: false },
  VERDE25:  { shop: "Verde Juice",   deal: "25% OFF", desc: "any cold-press", used: false },
  NORDIC15: { shop: "Nordic Tea",    deal: "15% OFF", desc: "your pot of tea", used: false },
};

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
    el.note.textContent = "Camera needs HTTPS. Use “enter code” below, or open the site over https.";
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.note.textContent = "This browser can’t use the camera. Use “enter code” below.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    el.video.srcObject = stream;
    await el.video.play();
    scanning = true;
    el.scanner.classList.add("is-live");
    el.scanBtn.textContent = "Stop scanning";
    el.note.textContent = "Point at the customer’s discount QR";
    rafId = requestAnimationFrame(loop);
  } catch (err) {
    el.note.textContent = err && err.name === "NotAllowedError"
      ? "Camera permission denied. Allow it, or use “enter code” below."
      : "Couldn’t start the camera. Use “enter code” below.";
  }
}

function stopScan() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  el.scanner.classList.remove("is-live");
  el.scanBtn.textContent = "Start scanning";
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

// ---------------- Lookup + result ----------------
function handleCode(raw) {
  const code = String(raw).trim().toUpperCase().replace(/^LOYTAP[:/]*/, "");
  const rec = ISSUED[code];

  if (!rec) {
    showResult("bad", "Not a valid code", `<p class="result__code">${escapeHtml(code) || "—"}</p>
      <p class="result__desc" style="margin-top:10px">No discount matches this QR.</p>`,
      [button("btn--primary", "Scan another", () => { closeResult(); startScan(); }), button("btn--ghost", "Close", closeResult)]);
    return;
  }
  if (rec.used) {
    showResult("warn", "Already redeemed", couponHtml(rec, code),
      [button("btn--ghost", "Close", closeResult)]);
    return;
  }
  // valid + unused
  showResult("ok", "Valid discount", couponHtml(rec, code), [
    button("btn--primary", "Mark as redeemed", () => redeem(code)),
    button("btn--ghost", "Cancel", closeResult),
  ]);
}

function redeem(code) {
  const rec = ISSUED[code];
  if (!rec || rec.used) return;
  rec.used = true; // later: POST to backend
  showResult("ok", "Redeemed ✓", couponHtml(rec, code) + `<p class="result__desc" style="margin-top:10px">Applied — give the customer their discount.</p>`,
    [button("btn--primary", "Scan another", () => { closeResult(); startScan(); }), button("btn--ghost", "Close", closeResult)]);
}

function couponHtml(rec, code) {
  return `<p class="result__deal">${escapeHtml(rec.deal)}</p>
    <p class="result__shop">${escapeHtml(rec.shop)}</p>
    <p class="result__desc">${escapeHtml(rec.desc)}</p>
    <span class="result__code">${escapeHtml(code)}</span>`;
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
