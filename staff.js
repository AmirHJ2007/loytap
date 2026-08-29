// ===================================================================
// LoyTap — café staff scanner.
// Scans a customer's discount QR (which carries only the opaque code),
// sends it to the backend, and shows the server's verdict. A valid code
// is redeemed on the server in the same step.
// ===================================================================

// When the page is served by PocketBase (or a tunnel / Liara), the API is same-origin.
// When served from the standalone :8000 dev server, talk to PocketBase on :8090.
const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
const token = (function () { try { return localStorage.getItem("loytap_token") || ""; } catch (e) { return ""; } })();

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

// ---------------- Lookup + redeem (server-side) ----------------
async function handleCode(raw) {
  const code = String(raw).trim().toUpperCase().replace(/^LOYTAP[:/]*/, "");
  if (!code) return;

  showResult("warn", "Checking…", `<p class="result__code">${escapeHtml(code)}</p>`,
    [button("btn--ghost", "Cancel", closeResult)]);

  let res;
  try {
    const r = await fetch(API + "/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ code }),
    });
    res = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) {
      showResult("bad", "Not signed in", `<p class="result__desc">Sign in again as café staff to redeem.</p>`,
        [button("btn--ghost", "Close", closeResult)]);
      return;
    }
  } catch (err) {
    showResult("bad", "Can’t reach the server", `<p class="result__desc">Check the connection and try again.</p>`,
      [button("btn--primary", "Try again", () => { closeResult(); handleCode(code); }), button("btn--ghost", "Close", closeResult)]);
    return;
  }

  const scanAgain = button("btn--primary", "Scan another", () => { closeResult(); startScan(); });
  const close = button("btn--ghost", "Close", closeResult);

  if (res.status === "ok") {
    showResult("ok", "Redeemed ✓",
      couponHtml(res) + `<p class="result__desc" style="margin-top:10px">Applied — give the customer their discount.</p>`,
      [scanAgain, close]);
  } else if (res.status === "already") {
    showResult("warn", "Already used before", couponHtml(res), [scanAgain, close]);
  } else if (res.status === "expired") {
    showResult("warn", "This discount has expired", couponHtml(res), [scanAgain, close]);
  } else if (res.status === "wrong_cafe") {
    showResult("bad", "Not for your café",
      `<p class="result__code">${escapeHtml(code) || "—"}</p>
       <p class="result__desc" style="margin-top:10px">This reward belongs to <b>${escapeHtml(res.shop || "another café")}</b>, not yours — it can't be redeemed here.</p>`,
      [scanAgain, close]);
  } else {
    showResult("bad", "Not a valid code",
      `<p class="result__code">${escapeHtml(code) || "—"}</p>
       <p class="result__desc" style="margin-top:10px">No discount matches this QR.</p>`,
      [scanAgain, close]);
  }
}

function couponHtml(res) {
  return `<p class="result__deal">${escapeHtml(res.deal || "Reward")}</p>
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
