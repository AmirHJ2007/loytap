// ===================================================================
// Reloy — business sign in: café Staff (shared code) or Owner
// (phone + password, or self-serve registration).
// ===================================================================

const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;

const $ = (id) => document.getElementById(id);

applyI18n();
document.getElementById("langSwitch").addEventListener("click", (e) => {
  const b = e.target.closest(".lang-switch__btn"); if (!b) return;
  setLang(b.dataset.lang);
});

// These fields are Latin-only (names/codes/email/password) regardless of UI language.
const PERSIAN_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌‏]/g;
["cCafe", "cName", "cafeCode", "cEmail", "cPass", "cPassConfirm", "ownerPass"].forEach((id) => {
  const el = $(id);
  el.addEventListener("input", () => {
    const filtered = el.value.replace(PERSIAN_RE, "");
    if (filtered !== el.value) {
      const pos = el.selectionStart - (el.value.length - filtered.length);
      el.value = filtered;
      el.setSelectionRange(pos, pos);
    }
  });
});

$("customerLink").addEventListener("click", () => { location.href = "auth.html"; });

function normalizePhone(v) {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);
  if (d.startsWith("98")) d = d.slice(2);
  return d;
}
function validPhone(v) { return /^9\d{9}$/.test(normalizePhone(v)); }

function flashToast(title, msg, shakeEl) {
  if (shakeEl) { shakeEl.classList.remove("shake"); void shakeEl.offsetWidth; shakeEl.classList.add("shake"); }
  const el = $("toast");
  $("toastTitle").textContent = title;
  $("toastMsg").textContent = msg;
  el.hidden = false; el.classList.remove("hide", "show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(flashToast._h);
  flashToast._h = setTimeout(() => { el.classList.remove("show"); el.classList.add("hide"); setTimeout(() => { el.hidden = true; }, 320); }, 2600);
}

// ---- wrong verification code, shared by both OTP steps ----
// 401 = wrong but tries are left; 429 = the code is burnt and the server has
// either texted a fresh one (regenerated) or given up (restart).
function wrongCodeMsg(data) {
  const n = data.attempts_left;
  if (typeof n === "number" && n > 0) return t("AUTH_ERR_CODE_ATTEMPTS_LEFT", { n, tries: t(n === 1 ? "AUTH_TRY_ONE" : "AUTH_TRY_MANY") });
  return data.error || t("AUTH_ERR_CODE_INVALID");
}

// ---------------- account type: Staff / Owner ----------------
function showBizStep(mode) {
  const staff = mode === "staff";
  stopCreateResend();
  stopOwnerResend();
  $("stepCafe").hidden = !staff;
  $("stepOwner").hidden = staff;
  $("stepCreate").hidden = true;
  $("stepCreateOtp").hidden = true;
  $("stepOwnerOtp").hidden = true;
  if (staff) return;
  // reset stepOwner's OWN sign-in/register pill only — stepCreate has its own
  // separate pill (defaults to "register") that must stay untouched here
  document.querySelectorAll("#stepOwner .tabs__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.omode === "signin"));
}
$("bizSeg").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  [...$("bizSeg").children].forEach((c) => c.classList.toggle("is-on", c === b));
  showBizStep(b.dataset.mode);
});

// ---- Staff sign in with the shared code (no phone/registration) ----
async function cafeLogin() {
  const input = $("cafeCode");
  const code = input.value.trim();
  if (!code) { input.focus(); return; }
  $("cafeEnterBtn").disabled = true;
  $("cafeCodeErr").hidden = true;
  try {
    const res = await fetch(API + "/staff/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $("cafeCodeErr").textContent = data.error || t("AUTH_ERR_WRONG_CODE");
      $("cafeCodeErr").hidden = false;
      input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
      return;
    }
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_role", data.role || "staff");
      localStorage.setItem("loytap_staff", "1");
      localStorage.setItem("loytap_cafe", data.cafe_name || "");
    } catch (_) {}
    location.href = "staff.html";
  } catch (err) {
    $("cafeCodeErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
    $("cafeCodeErr").hidden = false;
  } finally {
    $("cafeEnterBtn").disabled = false;
  }
}
$("cafeEnterBtn").addEventListener("click", cafeLogin);
$("cafeCode").addEventListener("keydown", (e) => { if (e.key === "Enter") cafeLogin(); });

// ---- Owner sign in (phone + password, then an SMS code) ----
// Signing in is two-factor: /owner/login only SENDS a code, the token comes
// back from /owner/login/verify on the next step. The credentials are kept in
// memory so "resend code" can re-post the same pair.
let ownerCreds = null;

async function ownerLogin() {
  if (!validPhone($("ownerPhone").value)) {
    flashToast(t("AUTH_TOAST_INVALID_NUMBER_TITLE"), t("AUTH_TOAST_INVALID_NUMBER_MSG"), document.querySelector("#stepOwner .phone"));
    return;
  }
  ownerCreds = { phone: normalizePhone($("ownerPhone").value), password: $("ownerPass").value };
  requestOwnerOtp();
}

// posts /owner/login — used both for the first send and for "resend code"
async function requestOwnerOtp() {
  const resending = !$("stepOwnerOtp").hidden;
  const errEl = resending ? $("ownerOtpErr") : $("ownerErr");
  $("ownerLoginBtn").disabled = true;
  errEl.hidden = true;
  try {
    const res = await fetch(API + "/owner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ownerCreds),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.notRegistered) { flashToast(t("AUTH_TOAST_NOT_OWNER_TITLE"), t("AUTH_TOAST_NOT_OWNER_MSG"), document.querySelector("#stepOwner .phone")); return; }
      // the send path has its own failure modes (rate limit, provider down,
      // no SMS provider configured) — translate them rather than surfacing
      // the server's raw English on a Persian UI
      errEl.textContent =
        res.status === 429 ? t("AUTH_ERR_SEND_TOO_MANY") :
        res.status === 502 ? t("AUTH_ERR_SEND_FAILED") :
        res.status === 503 ? t("AUTH_ERR_SMS_UNAVAILABLE") :
        (data.error || t("AUTH_ERR_LOGIN_FAILED"));
      errEl.hidden = false;
      if (!resending) { const p = $("ownerPass"); p.classList.remove("shake"); void p.offsetWidth; p.classList.add("shake"); }
      return;
    }
    $("ownerOtpPhone").textContent = prettyPhone($("ownerPhone").value);
    $("stepOwner").hidden = true;
    $("stepOwnerOtp").hidden = false;
    startOwnerResend();
    if (data.devCode) fillOwnerOtp(data.devCode); // dev mode: no SMS, prefill the code
    ownerOtpInputs[0].focus();
  } catch (err) {
    errEl.textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
    errEl.hidden = false;
  } finally {
    $("ownerLoginBtn").disabled = false;
  }
}
$("ownerLoginBtn").addEventListener("click", ownerLogin);
$("ownerPass").addEventListener("keydown", (e) => { if (e.key === "Enter") ownerLogin(); });

$("ownerOtpBack").addEventListener("click", () => { stopOwnerResend(); $("stepOwnerOtp").hidden = true; $("stepOwner").hidden = false; });

const ownerOtpInputs = [...$("ownerOtp").querySelectorAll("input")];
ownerOtpInputs.forEach((inp, i) => {
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 1);
    inp.classList.toggle("filled", !!inp.value);
    if (inp.value && i < ownerOtpInputs.length - 1) ownerOtpInputs[i + 1].focus();
    $("ownerOtpErr").hidden = true;
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && i > 0) ownerOtpInputs[i - 1].focus();
  });
  inp.addEventListener("paste", (e) => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6).split("");
    digits.forEach((d, k) => { if (ownerOtpInputs[k]) { ownerOtpInputs[k].value = d; ownerOtpInputs[k].classList.add("filled"); } });
    (ownerOtpInputs[digits.length] || ownerOtpInputs[5]).focus();
  });
});
function fillOwnerOtp(code) {
  const d = String(code).replace(/\D/g, "").slice(0, 6).split("");
  ownerOtpInputs.forEach((inp, k) => { inp.value = d[k] || ""; inp.classList.toggle("filled", !!d[k]); });
  $("ownerOtpErr").hidden = true;
}

let ownerResendTimer = null;
function startOwnerResend() {
  let secs = 60;
  const render = (s) => t("AUTH_RESEND_COUNTDOWN", { s }).replace(String(s), "<b>" + s + "</b>");
  $("ownerResend").classList.remove("ready");
  $("ownerResend").innerHTML = render(secs);
  ownerResendTimer = setInterval(() => {
    secs -= 1;
    if (secs <= 0) {
      stopOwnerResend();
      $("ownerResend").classList.add("ready");
      $("ownerResend").textContent = t("AUTH_RESEND_READY");
      $("ownerResend").onclick = () => { requestOwnerOtp(); };
    } else {
      $("ownerResend").innerHTML = render(secs);
    }
  }, 1000);
}
function stopOwnerResend() { if (ownerResendTimer) clearInterval(ownerResendTimer); ownerResendTimer = null; $("ownerResend").onclick = null; }

// 5 wrong codes and the code is dead: either the server just texted a new one
// (start over on this step, with the countdown reset) or it couldn't, and the
// whole sign-in has to begin again.
function burnOwnerOtp(data) {
  if (data.regenerated) {
    fillOwnerOtp("");                        // the old code no longer works — wipe the boxes
    stopOwnerResend(); startOwnerResend();   // a new code just went out, so the cooldown restarts
    if (data.devCode) fillOwnerOtp(data.devCode);
    $("ownerOtpErr").textContent = t("AUTH_ERR_CODE_REGENERATED");
    $("ownerOtpErr").hidden = false;
    flashToast(t("AUTH_TOAST_NEW_CODE_TITLE"), t("AUTH_TOAST_NEW_CODE_MSG"), $("ownerOtp"));
    ownerOtpInputs[0].focus();
    return;
  }
  if (data.restart) {
    fillOwnerOtp("");                         // nothing here is usable any more
    stopOwnerResend();
    $("stepOwnerOtp").hidden = true;
    $("stepOwner").hidden = false;
    $("ownerErr").textContent = t("AUTH_ERR_CODE_RESTART");
    $("ownerErr").hidden = false;
    $("ownerPass").focus();
    return;
  }
  $("ownerOtpErr").textContent = t("AUTH_ERR_CODE_TOO_MANY"); // a 429 without the newer fields
  $("ownerOtpErr").hidden = false;
}

async function verifyOwnerLogin() {
  const code = ownerOtpInputs.map((i) => i.value).join("");
  if (code.length < 6) { $("ownerOtpErr").textContent = t("AUTH_OTP_ERR_INCOMPLETE"); $("ownerOtpErr").hidden = false; return; }

  $("ownerOtpVerifyBtn").disabled = true;
  try {
    const res = await fetch(API + "/owner/login/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: ownerCreds.phone, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 429 = too many wrong codes, the old one is burnt (see burnOwnerOtp)
      if (res.status === 429) { burnOwnerOtp(data); return; }
      $("ownerOtpErr").textContent = wrongCodeMsg(data);
      $("ownerOtpErr").hidden = false;
      return;
    }
    stopOwnerResend();
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_role", data.role || "admin");
      localStorage.setItem("loytap_owner", "1");
      localStorage.setItem("loytap_name", data.name || "");
      localStorage.setItem("loytap_cafe", data.cafe_name || "");
    } catch (_) {}
    location.href = "owner.html";
  } catch (err) {
    $("ownerOtpErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
    $("ownerOtpErr").hidden = false;
  } finally {
    $("ownerOtpVerifyBtn").disabled = false;
  }
}
$("ownerOtpVerifyBtn").addEventListener("click", verifyOwnerLogin);

// ---- Owner self-registration (create a business) ----
let cTypeSel = "Cafe";
$("cType").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  cTypeSel = b.dataset.type;
  [...$("cType").children].forEach((c) => c.classList.toggle("is-on", c === b));
});

const ACCENTS = ["#171717", "#1f7a4d", "#7a4a24", "#2f5aa8", "#9a2b52", "#b0862a", "#17726b", "#6b3a86"];
let cAccentSel = ACCENTS[0];
(function buildSwatches() {
  const wrap = $("cAccent");
  ACCENTS.forEach((hex, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch" + (i === 0 ? " is-on" : "");
    b.style.background = hex; b.setAttribute("aria-label", hex);
    b.onclick = () => { cAccentSel = hex; wrap.querySelectorAll(".swatch").forEach((s) => s.classList.remove("is-on")); b.classList.add("is-on"); };
    wrap.appendChild(b);
  });
})();

// ---- Sign in / Register sub-tabs (shared between stepOwner and stepCreate) ----
document.querySelectorAll(".owner-tabs .tabs__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const toRegister = btn.dataset.omode === "register";
    $("stepOwner").hidden = toRegister;
    $("stepCreate").hidden = !toRegister;
    $(toRegister ? "cCafe" : "ownerPhone").focus();
  });
});

// Creating a business is phone-verified: submitting the form only SENDS a
// code (via the same /otp/request the customer flow uses); the business
// itself is only created if the code entered on the next step is right —
// see the check in owner.pb.js /owner/register.
function prettyPhone(v) {
  const d = normalizePhone(v);
  return `+98 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`.trim();
}

async function requestCreateOtp() {
  const cafe_name = $("cCafe").value.trim();
  const email = $("cEmail").value.trim();
  const password = $("cPass").value;
  const passwordConfirm = $("cPassConfirm").value;
  const err = (msg) => { $("createErr").textContent = msg; $("createErr").hidden = false; };
  $("createErr").hidden = true;
  if (!cafe_name) { $("cCafe").focus(); return err(t("AUTH_ERR_BUSINESS_NAME_REQUIRED")); }
  if (!validPhone($("cPhone").value)) { $("cPhone").focus(); return err(t("AUTH_ERR_PHONE_INVALID")); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("cEmail").focus(); return err(t("AUTH_ERR_EMAIL_INVALID")); }
  if (password.length < 6) { $("cPass").focus(); return err(t("AUTH_ERR_PASSWORD_SHORT")); }
  if (password !== passwordConfirm) { $("cPassConfirm").focus(); return err(t("AUTH_ERR_PASSWORD_MISMATCH")); }

  const phone = normalizePhone($("cPhone").value);
  $("createBtn").disabled = true;
  try {
    const res = await fetch(API + "/otp/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, mode: "register" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return err(data.error || t("AUTH_ERR_SEND_FAILED"));
    $("createOtpPhone").textContent = prettyPhone($("cPhone").value);
    $("stepCreate").hidden = true;
    $("stepCreateOtp").hidden = false;
    startCreateResend();
    if (data.devCode) fillCreateOtp(data.devCode); // dev mode: no SMS, prefill the code
    createOtpInputs[0].focus();
  } catch (e) {
    err(t("AUTH_ERR_SERVER_UNREACHABLE"));
  } finally {
    $("createBtn").disabled = false;
  }
}
$("createBtn").addEventListener("click", requestCreateOtp);

$("createOtpBack").addEventListener("click", () => { stopCreateResend(); $("stepCreateOtp").hidden = true; $("stepCreate").hidden = false; });

const createOtpInputs = [...$("createOtp").querySelectorAll("input")];
createOtpInputs.forEach((inp, i) => {
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 1);
    inp.classList.toggle("filled", !!inp.value);
    if (inp.value && i < createOtpInputs.length - 1) createOtpInputs[i + 1].focus();
    $("createOtpErr").hidden = true;
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && i > 0) createOtpInputs[i - 1].focus();
  });
  inp.addEventListener("paste", (e) => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6).split("");
    digits.forEach((d, k) => { if (createOtpInputs[k]) { createOtpInputs[k].value = d; createOtpInputs[k].classList.add("filled"); } });
    (createOtpInputs[digits.length] || createOtpInputs[5]).focus();
  });
});
function fillCreateOtp(code) {
  const d = String(code).replace(/\D/g, "").slice(0, 6).split("");
  createOtpInputs.forEach((inp, k) => { inp.value = d[k] || ""; inp.classList.toggle("filled", !!d[k]); });
  $("createOtpErr").hidden = true;
}

let createResendTimer = null;
function startCreateResend() {
  let secs = 60;
  const render = (s) => t("AUTH_RESEND_COUNTDOWN", { s }).replace(String(s), "<b>" + s + "</b>");
  $("createResend").classList.remove("ready");
  $("createResend").innerHTML = render(secs);
  createResendTimer = setInterval(() => {
    secs -= 1;
    if (secs <= 0) {
      stopCreateResend();
      $("createResend").classList.add("ready");
      $("createResend").textContent = t("AUTH_RESEND_READY");
      $("createResend").onclick = () => { requestCreateOtp(); };
    } else {
      $("createResend").innerHTML = render(secs);
    }
  }, 1000);
}
function stopCreateResend() { if (createResendTimer) clearInterval(createResendTimer); createResendTimer = null; $("createResend").onclick = null; }

// same deal as burnOwnerOtp, one step earlier: registration falls back to the
// form so the owner can send a code to their number again.
function burnCreateOtp(data) {
  if (data.regenerated) {
    fillCreateOtp("");                         // the old code no longer works — wipe the boxes
    stopCreateResend(); startCreateResend();   // a new code just went out, so the cooldown restarts
    if (data.devCode) fillCreateOtp(data.devCode);
    $("createOtpErr").textContent = t("AUTH_ERR_CODE_REGENERATED");
    $("createOtpErr").hidden = false;
    flashToast(t("AUTH_TOAST_NEW_CODE_TITLE"), t("AUTH_TOAST_NEW_CODE_MSG"), $("createOtp"));
    createOtpInputs[0].focus();
    return;
  }
  if (data.restart) {
    fillCreateOtp("");                         // nothing here is usable any more
    stopCreateResend();
    $("stepCreateOtp").hidden = true;
    $("stepCreate").hidden = false;
    $("createErr").textContent = t("AUTH_ERR_CODE_RESTART");
    $("createErr").hidden = false;
    $("cPhone").focus();
    return;
  }
  $("createOtpErr").textContent = t("AUTH_ERR_CODE_TOO_MANY"); // a 429 without the newer fields
  $("createOtpErr").hidden = false;
}

async function createCafe() {
  const code = createOtpInputs.map((i) => i.value).join("");
  if (code.length < 6) { $("createOtpErr").hidden = false; return; }

  const cafe_name = $("cCafe").value.trim();
  const tagline = cTypeSel;
  const name = $("cName").value.trim();
  const email = $("cEmail").value.trim();
  const password = $("cPass").value;
  const phone = normalizePhone($("cPhone").value);

  $("createOtpVerifyBtn").disabled = true;
  try {
    const res = await fetch(API + "/owner/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email, password, cafe_name, tagline, accent: cAccentSel, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) { burnCreateOtp(data); return; }
      $("createOtpErr").textContent = res.status === 401 ? wrongCodeMsg(data) : (data.error || t("AUTH_ERR_CREATE_FAILED"));
      $("createOtpErr").hidden = false;
      return;
    }
    stopCreateResend();
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_role", data.role || "admin");
      localStorage.setItem("loytap_owner", "1");
      localStorage.setItem("loytap_name", data.name || "");
      localStorage.setItem("loytap_cafe", data.cafe_name || "");
    } catch (_) {}
    $("stepCreateOtp").hidden = true;
    $("stepDone").hidden = false;
  } catch (e) {
    $("createOtpErr").textContent = t("AUTH_ERR_SERVER_UNREACHABLE");
    $("createOtpErr").hidden = false;
  } finally {
    $("createOtpVerifyBtn").disabled = false;
  }
}
$("createOtpVerifyBtn").addEventListener("click", createCafe);

showBizStep("staff");
