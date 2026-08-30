// ===================================================================
// Reloy — sign in / register. Phone + OTP for Customer and Cafe roles.
// Talks to the PocketBase backend: POST /otp/request + POST /otp/verify.
// In dev the backend returns the code (devCode) so it auto-fills — no SMS.
// ===================================================================

// Backend runs on port 8090 on the same host that serves this page.
// Same-origin when served by PocketBase / a tunnel / Liara; :8090 for the :8000 dev server.
const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;

let role = "customer";     // 'customer' | 'cafe'
let mode = "signin";       // 'signin' | 'register'
let resendTimer = null;
let signedUser = null;

const $ = (id) => document.getElementById(id);
const steps = { phone: $("stepPhone"), otp: $("stepOtp"), done: $("stepDone") };

// ---------------- role & mode toggles ----------------
$("roleSeg").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  role = b.dataset.role;
  [...$("roleSeg").children].forEach((c) => c.classList.toggle("is-on", c === b));
  showRoleStep();
});

// Customer -> phone/OTP step; Cafe -> shared-code step
function showRoleStep() {
  const cafe = role === "cafe";
  $("stepOwner").hidden = true;
  $("stepPhone").hidden = cafe;
  $("stepCafe").hidden = !cafe;
  if (!cafe) syncFields();
}

// Cafe staff sign in with the shared code (no phone/registration)
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
      $("cafeCodeErr").textContent = data.error || "Wrong code — try again.";
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
    $("cafeCodeErr").textContent = "Cannot reach the server.";
    $("cafeCodeErr").hidden = false;
  } finally {
    $("cafeEnterBtn").disabled = false;
  }
}
$("cafeEnterBtn").addEventListener("click", cafeLogin);
$("cafeCode").addEventListener("keydown", (e) => { if (e.key === "Enter") cafeLogin(); });

$("modeTabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tabs__btn"); if (!b) return;
  mode = b.dataset.mode;
  [...$("modeTabs").children].forEach((c) => c.classList.toggle("is-on", c === b));
  syncFields();
});

// show/hide name fields depending on register + role
function syncFields() {
  const registering = mode === "register";
  $("fieldName").hidden = !registering;
  $("fieldCafe").hidden = !(registering && role === "cafe");
  $("sendBtn").textContent = registering ? "Create account" : "Send code";
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
  if (mode === "register" && role === "cafe" && !$("cafeName").value.trim()) { $("cafeName").focus(); return; }
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
      $("phoneErr").textContent = data.error || "Could not send the code."; $("phoneErr").hidden = false; return;
    }
    $("otpPhone").textContent = prettyPhone($("phone").value);
    go("otp");
    startResend();
    if (data.devCode) fillOtp(data.devCode); // dev mode: no SMS, prefill the code
    otpInputs[0].focus();
  } catch (err) {
    $("phoneErr").textContent = "Cannot reach the server. Is the backend running?";
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
  flashToast("Not registered yet", "No account for this number — let's sign you up.", document.querySelector("#stepPhone .phone"));
  setTimeout(() => {
    mode = "register";
    [...$("modeTabs").children].forEach((c) => c.classList.toggle("is-on", c.dataset.mode === "register"));
    syncFields();
    if (!$("fieldName").hidden) $("name").focus();
  }, 1500);
}

// ---- Cafe owner login (phone + password, no registration) ----
$("ownerLink").addEventListener("click", () => { $("stepCafe").hidden = true; $("stepOwner").hidden = false; $("ownerPhone").focus(); });
$("ownerBack").addEventListener("click", () => { $("stepOwner").hidden = true; $("stepCafe").hidden = false; });

async function ownerLogin() {
  if (!validPhone($("ownerPhone").value)) {
    flashToast("Invalid number", "Enter a valid mobile number.", document.querySelector("#stepOwner .phone"));
    return;
  }
  const phone = normalizePhone($("ownerPhone").value);
  const password = $("ownerPass").value;
  $("ownerLoginBtn").disabled = true;
  $("ownerErr").hidden = true;
  try {
    const res = await fetch(API + "/owner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.notRegistered) { flashToast("Not an owner", "No owner account for this number.", document.querySelector("#stepOwner .phone")); return; }
      $("ownerErr").textContent = data.error || "Could not log in.";
      $("ownerErr").hidden = false;
      const p = $("ownerPass"); p.classList.remove("shake"); void p.offsetWidth; p.classList.add("shake");
      return;
    }
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_role", data.role || "admin");
      localStorage.setItem("loytap_owner", "1");
      localStorage.setItem("loytap_name", data.name || "");
      localStorage.setItem("loytap_cafe", data.cafe_name || "");
    } catch (_) {}
    location.href = "owner.html";
  } catch (err) {
    $("ownerErr").textContent = "Cannot reach the server.";
    $("ownerErr").hidden = false;
  } finally {
    $("ownerLoginBtn").disabled = false;
  }
}
$("ownerLoginBtn").addEventListener("click", ownerLogin);
$("ownerPass").addEventListener("keydown", (e) => { if (e.key === "Enter") ownerLogin(); });

// ---- Cafe owner self-registration (create a cafe) ----
let cTypeSel = "Cafe";
$("cType").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  cTypeSel = b.dataset.type;
  [...$("cType").children].forEach((c) => c.classList.toggle("is-on", c === b));
});

const ACCENTS = ["#171717", "#1f7a4d", "#7a4a24", "#2f5aa8", "#9a2b52", "#b0862a", "#17726b", "#6b3a86"];
let cAccentSel = ACCENTS[0];
(function buildSwatches() {
  const wrap = $("cAccent"); if (!wrap) return;
  ACCENTS.forEach((hex, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch" + (i === 0 ? " is-on" : "");
    b.style.background = hex; b.setAttribute("aria-label", hex);
    b.onclick = () => { cAccentSel = hex; wrap.querySelectorAll(".swatch").forEach((s) => s.classList.remove("is-on")); b.classList.add("is-on"); };
    wrap.appendChild(b);
  });
})();

$("createBack").addEventListener("click", () => { $("stepCreate").hidden = true; $("stepCafe").hidden = false; });

// ---- Owner / register tabs (shared between stepOwner and stepCreate) ----
document.querySelectorAll(".owner-tabs .tabs__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const toRegister = btn.dataset.omode === "register";
    $("stepOwner").hidden = toRegister;
    $("stepCreate").hidden = !toRegister;
    $(toRegister ? "cCafe" : "ownerPhone").focus();
  });
});

async function createCafe() {
  const cafe_name = $("cCafe").value.trim();
  const tagline = cTypeSel;
  const name = $("cName").value.trim();
  const email = $("cEmail").value.trim();
  const password = $("cPass").value;
  const passwordConfirm = $("cPassConfirm").value;
  const err = (msg) => { $("createErr").textContent = msg; $("createErr").hidden = false; };
  $("createErr").hidden = true;
  if (!cafe_name) { $("cCafe").focus(); return err("Enter your business's name."); }
  if (!validPhone($("cPhone").value)) { $("cPhone").focus(); return err("Enter a valid mobile number."); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("cEmail").focus(); return err("Enter a valid email address."); }
  if (password.length < 6) { $("cPass").focus(); return err("Password must be at least 6 characters."); }
  if (password !== passwordConfirm) { $("cPassConfirm").focus(); return err("Passwords do not match."); }
  const phone = normalizePhone($("cPhone").value);
  $("createBtn").disabled = true;
  try {
    const res = await fetch(API + "/owner/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email, password, cafe_name, tagline, accent: cAccentSel }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { return err(data.error || "Could not create your cafe."); }
    try {
      localStorage.setItem("loytap_token", data.token || "");
      localStorage.setItem("loytap_role", data.role || "admin");
      localStorage.setItem("loytap_owner", "1");
      localStorage.setItem("loytap_name", data.name || "");
      localStorage.setItem("loytap_cafe", data.cafe_name || "");
    } catch (_) {}
    $("stepCreate").hidden = true;
    $("doneTitle").textContent = "Business registered!";
    $("doneSub").textContent = "Our support team will be in touch soon to hand over your NFC tag — you'll need it before customers can start collecting stamps.";
    $("continueBtn").textContent = "Open dashboard";
    $("continueBtn").href = "owner.html";
    $("stepDone").hidden = false;
  } catch (e) {
    err("Cannot reach the server.");
  } finally {
    $("createBtn").disabled = false;
  }
}
$("createBtn").addEventListener("click", createCafe);

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
      body: JSON.stringify({ phone, code, name: $("name").value.trim(), role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $("otpErr").textContent = data.error || "Invalid or expired code."; $("otpErr").hidden = false; return; }
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
    $("otpErr").textContent = "Cannot reach the server.";
    $("otpErr").hidden = false;
  } finally {
    $("verifyBtn").disabled = false;
  }
});

function startResend() {
  let t = 60;
  $("resendT").textContent = t;
  $("resend").classList.remove("ready");
  $("resend").innerHTML = 'Resend code in <b id="resendT">' + t + "</b>s";
  resendTimer = setInterval(() => {
    t -= 1;
    if (t <= 0) {
      stopResend();
      $("resend").classList.add("ready");
      $("resend").textContent = "Resend code";
      $("resend").onclick = () => { requestCode(); };
    } else {
      $("resend").innerHTML = 'Resend code in <b>' + t + "</b>s";
    }
  }, 1000);
}
function stopResend() { if (resendTimer) clearInterval(resendTimer); resendTimer = null; $("resend").onclick = null; }

// ---------------- done ----------------
function finish() {
  const name = (signedUser && signedUser.name) || $("name").value.trim();
  const isCafe = role === "cafe" || (signedUser && (signedUser.role === "admin" || signedUser.role === "staff"));
  const dest = isCafe ? "staff.html" : "index.html";
  // signing in (existing account) skips the confirmation screen and goes straight in
  if (mode === "signin") { location.href = dest; return; }
  if (isCafe) {
    $("doneTitle").textContent = "Business registered!";
    $("doneSub").textContent = "Opening your scanner…";
    $("continueBtn").textContent = "Open scanner";
    $("continueBtn").href = dest;
  } else {
    $("doneTitle").textContent = `Welcome, ${name || "there"}!`;
    $("doneSub").textContent = "Opening your wallet…";
    $("continueBtn").textContent = "Open my wallet";
    $("continueBtn").href = dest;
  }
  go("done");
}

// ---------------- helpers ----------------
function go(name) {
  Object.entries(steps).forEach(([k, sec]) => { sec.hidden = k !== name; });
}
showRoleStep();
