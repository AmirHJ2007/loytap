// ===================================================================
// Reloy — customer sign in / register. Phone + OTP.
// Talks to the PocketBase backend: POST /otp/request + POST /otp/verify.
// In dev the backend returns the code (devCode) so it auto-fills — no SMS.
// Business (staff/owner) sign in lives on its own page: business.html.
// ===================================================================

// Backend runs on port 8090 on the same host that serves this page.
// Same-origin when served by PocketBase / a tunnel / Liara; :8090 for the :8000 dev server.
const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;

let mode = "signin";       // 'signin' | 'register'
let resendTimer = null;
let signedUser = null;

const $ = (id) => document.getElementById(id);
const steps = { phone: $("stepPhone"), otp: $("stepOtp"), done: $("stepDone") };

applyI18n();
document.getElementById("langSwitch").addEventListener("click", (e) => {
  const b = e.target.closest(".lang-switch__btn"); if (!b) return;
  setLang(b.dataset.lang);
});

// The name field is Latin-only regardless of UI language — strip Persian/Arabic
// characters as they're typed, not just visually align them LTR.
const PERSIAN_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌‏]/g;
$("name").addEventListener("input", () => {
  const el = $("name");
  const filtered = el.value.replace(PERSIAN_RE, "");
  if (filtered !== el.value) {
    const pos = el.selectionStart - (el.value.length - filtered.length);
    el.value = filtered;
    el.setSelectionRange(pos, pos);
  }
});

$("businessLink").addEventListener("click", () => { location.href = "business.html"; });

$("modeTabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tabs__btn"); if (!b) return;
  mode = b.dataset.mode;
  [...$("modeTabs").children].forEach((c) => c.classList.toggle("is-on", c === b));
  syncFields();
});

// show/hide the name field depending on register vs sign in
function syncFields() {
  const registering = mode === "register";
  $("fieldName").hidden = !registering;
  $("sendBtn").textContent = registering ? t("AUTH_BTN_CREATE_ACCOUNT") : t("AUTH_BTN_SEND");
}

// ---------------- phone step ----------------
function normalizePhone(v) {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);       // 0912… -> 912…
  if (d.startsWith("98")) d = d.slice(2);      // 98912… -> 912…
  return d;                                    // expect 9XXXXXXXXX (10 digits)
}
function validPhone(v) {
  const d = normalizePhone(v);
  return /^9\d{9}$/.test(d);
}
function prettyPhone(v) {
  const d = normalizePhone(v);
  return `+98 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`.trim();
}

$("phone").addEventListener("input", () => $("phoneErr").hidden = true);

$("sendBtn").addEventListener("click", () => requestCode());

async function requestCode() {
  if (mode === "register" && !$("name").value.trim()) { $("name").focus(); return; }
  if (!validPhone($("phone").value)) { $("phoneErr").hidden = false; return; }

  const phone = normalizePhone($("phone").value);
  $("sendBtn").disabled = true;
  try {
    const res = await fetch(API + "/otp/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.notRegistered) { showNotRegistered(); return; }
      $("phoneErr").textContent = data.error || t("AUTH_ERR_SEND_FAILED"); $("phoneErr").hidden = false; return;
    }
    $("otpPhone").textContent = prettyPhone($("phone").value);
    go("otp");
    startResend();
    if (data.devCode) fillOtp(data.devCode); // dev mode: no SMS, prefill the code
    otpInputs[0].focus();
  } catch (err) {
    $("phoneErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE_BACKEND");
    $("phoneErr").hidden = false;
  } finally {
    $("sendBtn").disabled = false;
  }
}

function fillOtp(code) {
  const d = String(code).replace(/\D/g, "").slice(0, 6).split("");
  otpInputs.forEach((inp, k) => { inp.value = d[k] || ""; inp.classList.toggle("filled", !!d[k]); });
  $("otpErr").hidden = true;
}

// Sign-in with an unregistered number: shake, show an animated toast, then
// slide over to the Register tab (keeping the phone the user typed).
function flashToast(title, msg, shakeEl) {
  if (shakeEl) { shakeEl.classList.remove("shake"); void shakeEl.offsetWidth; shakeEl.classList.add("shake"); }
  const t = $("toast");
  t.querySelector(".toast__title").textContent = title;
  $("toastMsg").textContent = msg;
  t.hidden = false; t.classList.remove("hide", "show"); void t.offsetWidth; t.classList.add("show");
  clearTimeout(flashToast._h);
  flashToast._h = setTimeout(() => { t.classList.remove("show"); t.classList.add("hide"); setTimeout(() => { t.hidden = true; }, 320); }, 2600);
}

function showNotRegistered() {
  flashToast(t("AUTH_TOAST_NOT_REGISTERED_TITLE"), t("AUTH_TOAST_NOT_REGISTERED_MSG"), document.querySelector("#stepPhone .phone"));
  setTimeout(() => {
    mode = "register";
    [...$("modeTabs").children].forEach((c) => c.classList.toggle("is-on", c.dataset.mode === "register"));
    syncFields();
    if (!$("fieldName").hidden) $("name").focus();
  }, 1500);
}

// ---------------- otp step ----------------
const otpInputs = [...$("otp").querySelectorAll("input")];
otpInputs.forEach((inp, i) => {
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 1);
    inp.classList.toggle("filled", !!inp.value);
    if (inp.value && i < otpInputs.length - 1) otpInputs[i + 1].focus();
    $("otpErr").hidden = true;
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && i > 0) otpInputs[i - 1].focus();
  });
  inp.addEventListener("paste", (e) => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6).split("");
    digits.forEach((d, k) => { if (otpInputs[k]) { otpInputs[k].value = d; otpInputs[k].classList.add("filled"); } });
    (otpInputs[digits.length] || otpInputs[5]).focus();
  });
});

$("backBtn").addEventListener("click", () => { stopResend(); go("phone"); });

$("verifyBtn").addEventListener("click", async () => {
  const code = otpInputs.map((i) => i.value).join("");
  if (code.length < 6) { $("otpErr").hidden = false; return; }
  $("verifyBtn").disabled = true;
  try {
    const phone = normalizePhone($("phone").value);
    const res = await fetch(API + "/otp/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, name: $("name").value.trim(), role: "customer" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 429 = too many wrong codes, the old one is burnt (see burnOtp)
      if (res.status === 429) { burnOtp(data); return; }
      $("otpErr").textContent = wrongCodeMsg(data); $("otpErr").hidden = false; return;
    }
    stopResend();
    signedUser = data.user || null;
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_signed_in", "1");
      if (signedUser) {
        localStorage.setItem("loytap_name", signedUser.name || "");
        localStorage.setItem("loytap_role", signedUser.role || "customer");
        if (signedUser.phone) localStorage.setItem("loytap_phone", signedUser.phone);
      }
    } catch (_) {}
    finish();
  } catch (err) {
    $("otpErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
    $("otpErr").hidden = false;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

// 401 = wrong but tries are left; say how many so nobody burns the code blind
function wrongCodeMsg(data) {
  const n = data.attempts_left;
  if (typeof n === "number" && n > 0) return t("AUTH_ERR_CODE_ATTEMPTS_LEFT", { n, tries: t(n === 1 ? "AUTH_TRY_ONE" : "AUTH_TRY_MANY") });
  return data.error || t("AUTH_ERR_CODE_INVALID");
}

// 5 wrong codes and the code is dead: either the server just texted a new one
// (stay here, boxes cleared, countdown restarted) or it couldn't, and the flow
// starts again from the phone step.
function burnOtp(data) {
  if (data.regenerated) {
    fillOtp("");                 // the old code no longer works — wipe the boxes
    stopResend(); startResend(); // a new code just went out, so the cooldown restarts
    if (data.devCode) fillOtp(data.devCode);
    $("otpErr").textContent = t("AUTH_ERR_CODE_REGENERATED");
    $("otpErr").hidden = false;
    flashToast(t("AUTH_TOAST_NEW_CODE_TITLE"), t("AUTH_TOAST_NEW_CODE_MSG"), $("otp"));
    otpInputs[0].focus();
    return;
  }
  if (data.restart) {
    fillOtp("");                 // nothing here is usable any more
    stopResend();
    go("phone");
    $("phoneErr").textContent = t("AUTH_ERR_CODE_RESTART");
    $("phoneErr").hidden = false;
    $("phone").focus();
    return;
  }
  $("otpErr").textContent = t("AUTH_ERR_CODE_TOO_MANY"); // a 429 without the newer fields
  $("otpErr").hidden = false;
}

function startResend() {
  let secs = 60;
  const render = (s) => t("AUTH_RESEND_COUNTDOWN", { s }).replace(String(s), "<b>" + s + "</b>");
  $("resend").classList.remove("ready");
  $("resend").innerHTML = render(secs);
  resendTimer = setInterval(() => {
    secs -= 1;
    if (secs <= 0) {
      stopResend();
      $("resend").classList.add("ready");
      $("resend").textContent = t("AUTH_RESEND_READY");
      $("resend").onclick = () => { requestCode(); };
    } else {
      $("resend").innerHTML = render(secs);
    }
  }, 1000);
}
function stopResend() { if (resendTimer) clearInterval(resendTimer); resendTimer = null; $("resend").onclick = null; }

// ---------------- done ----------------
function finish() {
  const name = (signedUser && signedUser.name) || $("name").value.trim();
  // signing in (existing account) skips the confirmation screen and goes straight in
  if (mode === "signin") { location.href = "index.html"; return; }
  $("doneTitle").textContent = t("AUTH_WELCOME", { name: name || t("AUTH_THERE") });
  $("doneSub").textContent = t("AUTH_OPENING_WALLET");
  $("continueBtn").textContent = t("AUTH_BTN_OPEN_WALLET");
  $("continueBtn").href = "index.html";
  go("done");
}

// ---------------- helpers ----------------
function go(name) {
  Object.entries(steps).forEach(([k, sec]) => { sec.hidden = k !== name; });
}
syncFields();
