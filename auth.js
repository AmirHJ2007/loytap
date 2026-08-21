// ===================================================================
// LoyTap — sign in / register (frontend mock).
// Phone + OTP for both Customer and Café roles. No real SMS yet:
// later, "Send code" calls the backend (Kavenegar) and "Verify" checks it.
// ===================================================================

let role = "customer";     // 'customer' | 'cafe'
let mode = "signin";       // 'signin' | 'register'
let resendTimer = null;

const $ = (id) => document.getElementById(id);
const steps = { phone: $("stepPhone"), otp: $("stepOtp"), done: $("stepDone") };

// ---------------- role & mode toggles ----------------
$("roleSeg").addEventListener("click", (e) => {
  const b = e.target.closest(".seg__btn"); if (!b) return;
  role = b.dataset.role;
  [...$("roleSeg").children].forEach((c) => c.classList.toggle("is-on", c === b));
  syncFields();
});

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

$("sendBtn").addEventListener("click", () => {
  if (mode === "register" && !$("name").value.trim()) { $("name").focus(); return; }
  if (mode === "register" && role === "cafe" && !$("cafeName").value.trim()) { $("cafeName").focus(); return; }
  if (!validPhone($("phone").value)) { $("phoneErr").hidden = false; return; }

  // TODO backend: POST /auth/send { phone, role } -> Kavenegar sends the code
  $("otpPhone").textContent = prettyPhone($("phone").value);
  go("otp");
  startResend();
  otpInputs[0].focus();
});

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

$("verifyBtn").addEventListener("click", () => {
  const code = otpInputs.map((i) => i.value).join("");
  if (code.length < 6) { $("otpErr").hidden = false; return; }
  // TODO backend: POST /auth/verify { phone, code } -> session (JWT)
  stopResend();
  finish();
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
      $("resend").onclick = () => { startResend(); /* TODO backend resend */ };
    } else {
      $("resend").innerHTML = 'Resend code in <b>' + t + "</b>s";
    }
  }, 1000);
}
function stopResend() { if (resendTimer) clearInterval(resendTimer); resendTimer = null; $("resend").onclick = null; }

// ---------------- done ----------------
function finish() {
  const name = $("name").value.trim();
  if (role === "cafe") {
    $("doneTitle").textContent = mode === "register" ? "Café registered!" : "Welcome back!";
    $("doneSub").textContent = "Opening your scanner…";
    $("continueBtn").textContent = "Open scanner";
    $("continueBtn").href = "staff.html";
  } else {
    $("doneTitle").textContent = mode === "register" ? `Welcome, ${name || "there"}!` : "Welcome back!";
    $("doneSub").textContent = "Opening your wallet…";
    $("continueBtn").textContent = "Open my wallet";
    $("continueBtn").href = "index.html";
  }
  go("done");
}

// ---------------- helpers ----------------
function go(name) {
  Object.entries(steps).forEach(([k, sec]) => { sec.hidden = k !== name; });
}
syncFields();
