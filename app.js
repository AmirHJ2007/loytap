// ===================================================================
// LoyTap — customer wallet. Vanilla JS, no backend, resets each visit.
// Fill a card -> confetti -> full-screen "Congratulation!" barcode ticket.
// Edit CARDS to add/change cards.
// ===================================================================

const CARDS = [
  {
    id: "oram", name: "Oram Cafe & Restaurant", tag: "Collect 8 · earn a treat",
    stamps: 8, cols: 4,
    reward: { percent: "20% OFF", desc: "your next order", code: "ORAM20" },
    theme: {
      "--paper": "#ece5d3", "--paper-2": "#e2d9c3", "--ink": "#1c2b3a",
      "--ink-dim": "#586675", "--ink-faint": "#a99f86", "--line": "#c7bda3",
      "--stamp-ink": "#1c2b3a", "--terra": "#26384a", "--terra-deep": "#16232f", "--gold": "#7a8a5f",
    },
    inks: ["#16232f", "#1c2b3a", "#7a8a5f"],
    confetti: ["#1c2b3a", "#7a8a5f", "#c7bda3", "#26384a", "#e2d9c3"],
  },
];

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STAMPER_W = 120, STAMPER_H = 150, BASE_OFFSET = 100;
const PEEK_GAP = 44;
const QR_COLOR = "#1c2b3a";

// Backend on port 8090 on the same host that serves this page.
// Same-origin when served by PocketBase / a tunnel / Liara; :8090 for the :8000 dev server.
const API = location.port === "8000" ? location.protocol + "//" + location.hostname + ":8090" : location.origin;
let token = "";
try { token = localStorage.getItem("loytap_token") || ""; } catch (_) {}
let cafeName = "Aurora Coffee";

// The stamp mark is the Oram line-art logo (a stamped café-logo look).
const STAR_SVG = `<img class="stamp-mark" src="oram-stamp.png?v=9" alt="" />`;

// Dotted QR with rounded finder "eyes" (matches the reference look).
// High error-correction so the rounded styling stays scannable.
function qrSvgDotted(text, color) {
  const qr = qrcode(0, "H");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 2; // quiet zone (modules)
  const size = n + q * 2;
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c) && !inFinder(r, c))
        dots += `<circle cx="${(c + q + 0.5).toFixed(2)}" cy="${(r + q + 0.5).toFixed(2)}" r="0.42"/>`;
  const eye = (r, c) => {
    const x = c + q, y = r + q;
    return `<rect x="${(x + 0.5).toFixed(2)}" y="${(y + 0.5).toFixed(2)}" width="6" height="6" rx="2" fill="none" stroke="${color}" stroke-width="1"/>`
         + `<rect x="${(x + 2).toFixed(2)}" y="${(y + 2).toFixed(2)}" width="3" height="3" rx="1"/>`;
  };
  const eyes = eye(0, 0) + eye(0, n - 7) + eye(n - 7, 0);
  return `<svg viewBox="0 0 ${size} ${size}" fill="${color}" shape-rendering="geometricPrecision" aria-hidden="true">${dots}${eyes}</svg>`;
}

const wallet = document.getElementById("wallet");
const stamper = document.getElementById("stamper");
const confetti = document.getElementById("confetti");
const cctx = confetti.getContext("2d");

let decks = [];
let activeIndex = 0;
let busy = false;
let pendingReset = null; // deck to reset to empty after the congrats "Continue"

// ===================================================================
// Build the cards (front face only — reward is a full-screen ticket)
// ===================================================================
function buildCard(cfg, index) {
  const el = document.createElement("div");
  el.className = "wcard";
  el.dataset.index = index;
  for (const [k, v] of Object.entries(cfg.theme)) el.style.setProperty(k, v);

  const slotsHtml = Array.from({ length: cfg.stamps }, (_, i) => `
    <div class="slot"><span class="halo"></span><span class="slot__num">${i + 1}</span><span class="stamp">${STAR_SVG}</span></div>`).join("");

  el.innerHTML = `
    <div class="card">
      <section class="face face--front">
        <span class="notch notch--l"></span><span class="notch notch--r"></span>
        <div class="oram-sheen" aria-hidden="true"></div>
        <header class="oram-head">
          <div class="oram-logo"><img src="oram-logo.png?v=4" alt="Oram" /></div>
          <h1 class="oram-name">Oram</h1>
          <p class="oram-sub">Cafe &amp; Restaurant</p>
        </header>
        <div class="oram-progress">
          <span class="count">0</span><span class="counter__sep">/</span><span>${cfg.stamps}</span>
          <span class="oram-progress__label">stamps collected</span>
        </div>
        <div class="grid" style="--cols:${cfg.cols}">${slotsHtml}</div>
      </section>
    </div>`;

  const q = (s) => el.querySelector(s);
  const deck = {
    cfg, index, el,
    card: q(".card"),
    grid: q(".grid"),
    slots: [...el.querySelectorAll(".slot")],
    countEl: q(".count"),
    stampBtn: document.getElementById("stampFab"), // the fixed bottom button
    stamped: 0,
  };

  deck.stampBtn.onclick = () => addStamp(deck);
  return deck;
}

// ===================================================================
// Wallet stack layout
// ===================================================================
function layout() {
  const H = decks[0].el.offsetHeight;
  let peek = 0;
  decks.forEach((d) => {
    if (d.index === activeIndex) {
      d.el.style.transform = "translateY(0) scale(1)";
      d.el.style.zIndex = "100";
      d.el.classList.add("is-active"); d.el.classList.remove("is-peek");
    } else {
      peek++;
      const y = H + (peek - 1) * PEEK_GAP;
      d.el.style.transform = `translateY(${y}px) scale(${(1 - 0.02 * peek).toFixed(3)})`;
      d.el.style.zIndex = String(40 + peek);
      d.el.classList.add("is-peek"); d.el.classList.remove("is-active");
    }
  });
  wallet.style.height = H + (decks.length > 1 ? (decks.length - 1) * PEEK_GAP + 46 : 0) + "px";
}
function setActive(i) { if (busy) return; activeIndex = i; layout(); }

// ===================================================================
// Stamping
// ===================================================================
// The backend adds the stamp (and decides its look + any reward), so the
// exact same stars come back on sign-in and stamps can't be faked.
async function addStamp(deck) {
  if (busy || deck.stamped >= deck.cfg.stamps) return;
  busy = true;
  deck.stampBtn.disabled = true;
  let res = null;
  try {
    const r = await fetch(API + "/card/stamp", { method: "POST", headers: { Authorization: token } });
    res = await r.json();
    if (!r.ok) throw new Error((res && res.error) || "stamp failed");
  } catch (err) {
    busy = false; deck.stampBtn.disabled = false;
    return;
  }
  const slot = deck.slots[deck.stamped];
  deck.stamped++;
  const v = res.stamp;
  playStamp(deck, slot, v.dx, v.dy, () => onImpact(deck, slot, v), () => onLifted(deck, res));
}

function onImpact(deck, slot, v) {
  slot.style.setProperty("--r", v.r + "deg");
  slot.style.setProperty("--dx", v.dx + "px");
  slot.style.setProperty("--dy", v.dy + "px");
  slot.style.setProperty("--sa", v.sa);
  if (v.color) slot.querySelector(".stamp").style.color = v.color;
  slot.classList.add("is-stamped");
  deck.countEl.textContent = String(deck.stamped);
  deck.stampBtn.classList.remove("pulse"); void deck.stampBtn.offsetWidth; deck.stampBtn.classList.add("pulse");
  inkPuff(deck, slot, v.dx, v.dy);
  deck.card.animate(
    [{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(3px,-1px)" }, { transform: "translate(0,0)" }],
    { duration: 260, easing: "ease" }
  );
}

function onLifted(deck, res) {
  busy = false;
  if (res.completed) {
    deck.stampBtn.disabled = true;
    deck.stampBtn.querySelector(".btn__label").textContent = "Complete!";
    setTimeout(() => complete(deck, res.discount), REDUCED ? 120 : 350);
  } else {
    deck.stampBtn.disabled = false;
  }
}

function playStamp(deck, slot, dx, dy, onContact, onDone) {
  const rect = slot.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - STAMPER_W / 2 + dx;
  const yHit = rect.top + rect.height / 2 + dy - BASE_OFFSET;
  if (REDUCED) { onContact(); onDone(); return; }
  const up = yHit - 320;
  stamper.style.opacity = "1";
  const anim = stamper.animate([
    { transform: `translate(${x}px, ${up}px) rotate(-8deg) scale(1.08,1.08)`, opacity: 0, offset: 0 },
    { transform: `translate(${x}px, ${up + 150}px) rotate(-4deg) scale(1.08,1.08)`, opacity: 1, offset: 0.14 },
    { transform: `translate(${x}px, ${yHit}px) rotate(0deg) scale(1.07,0.9)`, opacity: 1, offset: 0.4 },
    { transform: `translate(${x}px, ${yHit - 4}px) rotate(0deg) scale(0.99,1.02)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${x}px, ${yHit - 16}px) rotate(2deg) scale(1,1)`, opacity: 1, offset: 0.62 },
    { transform: `translate(${x}px, ${up}px) rotate(7deg) scale(1.05,1.05)`, opacity: 0, offset: 1 },
  ], { duration: 840, easing: "cubic-bezier(0.45,0.05,0.35,1)", fill: "forwards" });
  setTimeout(onContact, 336);
  anim.onfinish = () => { stamper.style.opacity = "0"; onDone(); };
}

function inkPuff(deck, slot, dx, dy) {
  if (REDUCED) return;
  const rect = slot.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 + dx;
  const cy = rect.top + rect.height / 2 + dy;
  spawnParticles(cx, cy, 11, { size: [3, 7], life: 720, gravity: 0.16, splash: true, colors: deck.cfg.inks });
  spawnParticles(cx, cy, 20, { size: [0.8, 2.6], life: 560, gravity: 0.1, splash: true, colors: deck.cfg.inks });
}

// ===================================================================
// Completion → confetti → congrats ticket
// ===================================================================
function complete(deck, discount) {
  const rec = discountToRec(discount);
  addDiscountToPocket(rec);
  celebrate(deck);
  pendingReset = deck; // once they hit "Continue", the card starts over from the top
  setTimeout(() => showCongrats(rec), REDUCED ? 0 : 250);
}

function celebrate(deck) {
  const r = deck.card.getBoundingClientRect();
  spawnParticles(r.left + r.width / 2, r.top + r.height * 0.3, REDUCED ? 30 : 150, {
    spread: Math.max(window.innerWidth, 500), size: [4, 9], life: 2500, gravity: 0.18, confetti: true, colors: deck.cfg.confetti,
  });
}

function resetCard(deck) {
  deck.stamped = 0;
  deck.countEl.textContent = "0";
  deck.stampBtn.disabled = false;
  deck.stampBtn.querySelector(".btn__label").textContent = "Stamp";
  particles = [];
  cctx.clearRect(0, 0, confetti.width, confetti.height);
  deck.slots.forEach((s) => {
    s.classList.remove("is-stamped");
    const st = s.querySelector(".stamp");
    if (st) st.style.color = "";
  });
}

// ===================================================================
// Particle engine
// ===================================================================
let particles = [];
let rafId = null;

function sizeConfetti() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = confetti.getBoundingClientRect();
  confetti.width = Math.round(r.width * dpr);
  confetti.height = Math.round(r.height * dpr);
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawnParticles(x, y, n, opts = {}) {
  const { spread = 100, size = [3, 6], life = 1200, gravity = 0.06, confetti: conf = false, splash = false, colors = ["#1f9d63"] } = opts;
  for (let i = 0; i < n; i++) {
    const angle = conf ? (-Math.PI / 2 + (Math.random() - 0.5) * 1.6) : Math.random() * Math.PI * 2;
    const speed = conf ? (4 + Math.random() * 9) : splash ? (2 + Math.random() * 6) : (0.4 + Math.random() * 2.6);
    particles.push({
      x: x + (Math.random() - 0.5) * (conf ? spread * 0.3 : 6), y,
      vx: Math.cos(angle) * speed + (conf ? (Math.random() - 0.5) * 4 : 0),
      vy: Math.sin(angle) * speed, g: gravity,
      r: size[0] + Math.random() * (size[1] - size[0]),
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      life, born: performance.now(), color: colors[(Math.random() * colors.length) | 0], square: conf, splash,
    });
  }
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function tick(now) {
  cctx.clearRect(0, 0, confetti.width, confetti.height);
  particles = particles.filter((p) => now - p.born < p.life);
  for (const p of particles) {
    const age = (now - p.born) / p.life;
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    cctx.save();
    cctx.globalAlpha = Math.max(0, 1 - age);
    cctx.translate(p.x, p.y);
    cctx.fillStyle = p.color;
    if (p.square) { cctx.rotate(p.rot); cctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2); }
    else if (p.splash) { const sp = Math.hypot(p.vx, p.vy); cctx.rotate(Math.atan2(p.vy, p.vx)); cctx.beginPath(); cctx.ellipse(0, 0, p.r * Math.min(1 + sp * 0.16, 2.8), p.r, 0, 0, Math.PI * 2); cctx.fill(); }
    else { cctx.beginPath(); cctx.arc(0, 0, p.r, 0, Math.PI * 2); cctx.fill(); }
    cctx.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(tick);
  else { cctx.clearRect(0, 0, confetti.width, confetti.height); rafId = null; }
}

// ===================================================================
// Discounts pocket
// ===================================================================
const pocketBtn = document.getElementById("pocketBtn");
const pocketBadge = document.getElementById("pocketBadge");
const scrim = document.getElementById("scrim");
const drawer = document.getElementById("drawer");
const drawerClose = document.getElementById("drawerClose");
const drawerList = document.getElementById("drawerList");
const drawerEmpty = document.getElementById("drawerEmpty");

let discounts = [];

function shortDiscount(p) {
  const m = String(p).match(/(\d+)\s*%/);
  return m ? `-${m[1]}%` : p;
}
function dueDateStr() {
  const d = new Date(Date.now() + 30 * 864e5);
  const z = (n) => String(n).padStart(2, "0");
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

function formatDue(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const z = (n) => String(n).padStart(2, "0");
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

// backend /card/stamp discount payload -> pocket/congrats record
function discountToRec(d) {
  return {
    shop: (d && d.shop) || cafeName,
    deal: (d && d.deal) || "Reward",
    desc: (d && d.description) || "",
    code: (d && d.code) || "",
    short: shortDiscount((d && d.deal) || ""),
    due: (d && d.due) || dueDateStr(),
    terra: "#23a468",
  };
}

// backend discounts collection record -> pocket record
function mapDiscount(item) {
  return {
    shop: cafeName,
    deal: item.deal || "Reward",
    desc: item.description || "",
    code: item.code || "",
    short: shortDiscount(item.deal || ""),
    due: formatDue(item.due_date),
    terra: "#23a468",
    status: item.status,
  };
}

function addDiscountToPocket(rec) {
  if (discounts.find((d) => d.code === rec.code)) return;
  discounts.unshift(rec);
  renderDiscounts();
  pocketBtn.classList.remove("pop"); void pocketBtn.offsetWidth; pocketBtn.classList.add("pop");
  pocketBadge.classList.remove("bump"); void pocketBadge.offsetWidth; pocketBadge.classList.add("bump");
}

function renderDiscounts() {
  pocketBadge.hidden = discounts.length === 0;
  pocketBadge.textContent = String(discounts.length);
  drawerEmpty.style.display = discounts.length ? "none" : "block";
  drawerList.querySelectorAll(".coupon").forEach((n) => n.remove());
  discounts.forEach((d) => {
    const c = document.createElement("div");
    c.className = "coupon";
    c.setAttribute("role", "button");
    c.innerHTML = `
      <span class="coupon__stripe" style="background:${d.terra}"></span>
      <div class="coupon__body">
        <p class="coupon__shop">${escapeHtml(d.shop)}</p>
        <p class="coupon__deal">${escapeHtml(d.deal)}</p>
        <p class="coupon__desc">${escapeHtml(d.desc)}</p>
      </div>
      <span class="coupon__go" aria-hidden="true">›</span>`;
    c.addEventListener("click", () => { closeDrawer(); setTimeout(() => showCongrats(d), 180); });
    drawerList.appendChild(c);
  });
}

async function openDrawer() {
  scrim.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add("show"); drawer.classList.add("open"); });
  drawer.setAttribute("aria-hidden", "false");
  // load the signed-in user's discounts from the backend
  try {
    const r = await fetch(API + "/api/collections/discounts/records?perPage=100&sort=-created", { headers: { Authorization: token } });
    const data = await r.json();
    if (data && data.items) { discounts = data.items.map(mapDiscount); renderDiscounts(); }
  } catch (_) {}
}
function closeDrawer() {
  scrim.classList.remove("show");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => { scrim.hidden = true; }, 320);
}
pocketBtn.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

// ===================================================================
// Congratulation ticket (with barcode)
// ===================================================================
const congrats = document.getElementById("congrats");
const congratsSub = document.getElementById("congratsSub");
const congratsContinue = document.getElementById("congratsContinue");
const ticketDiscount = document.getElementById("ticketDiscount");
const ticketDue = document.getElementById("ticketDue");
const ticketQr = document.getElementById("ticketQr");

function showCongrats(rec) {
  congratsSub.innerHTML = `Show this to <b>${escapeHtml(rec.shop)}</b> staff to claim your reward`;
  ticketDiscount.textContent = rec.short || shortDiscount(rec.deal);
  ticketDue.textContent = rec.due || dueDateStr();
  try { ticketQr.innerHTML = qrSvgDotted(rec.code, QR_COLOR); } catch (_) {}
  congrats.hidden = false;
  congrats.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => congrats.classList.add("show"));
}
function hideCongrats() {
  congrats.classList.remove("show");
  congrats.setAttribute("aria-hidden", "true");
  setTimeout(() => { congrats.hidden = true; }, 320);
  if (pendingReset) { resetCard(pendingReset); pendingReset = null; } // start fresh from the top
}
congratsContinue.addEventListener("click", hideCongrats);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!congrats.hidden) hideCongrats();
  else if (drawer.classList.contains("open")) closeDrawer();
});

// ===================================================================
// Helpers + init
// ===================================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Paint saved stamps instantly (no press animation), exactly as stored.
function renderSaved(deck, stamps) {
  stamps.forEach((v, i) => {
    const slot = deck.slots[i];
    if (!slot) return;
    slot.style.setProperty("--r", (v.r || 0) + "deg");
    slot.style.setProperty("--dx", (v.dx || 0) + "px");
    slot.style.setProperty("--dy", (v.dy || 0) + "px");
    slot.style.setProperty("--sa", v.sa != null ? v.sa : 1);
    const st = slot.querySelector(".stamp");
    if (st) {
      if (v.color) st.style.color = v.color;
      st.style.animationDelay = (i * 0.08).toFixed(2) + "s"; // cascade in
    }
    slot.classList.add("is-stamped");
  });
  deck.stamped = stamps.length;
  deck.countEl.textContent = String(stamps.length);
}

async function init() {
  // public café config
  let stampsRequired = 8;
  try {
    const r = await fetch(API + "/api/collections/cafe_card/records?perPage=1");
    const d = await r.json();
    if (d.items && d.items[0]) {
      stampsRequired = d.items[0].stamps_required || 8;
      cafeName = d.items[0].cafe_name || cafeName;
    }
  } catch (_) {}

  // signed-in user: refresh the session and load their card state
  let user = null;
  try {
    const r = await fetch(API + "/api/collections/users/auth-refresh", { method: "POST", headers: { Authorization: token } });
    if (r.ok) {
      const d = await r.json();
      user = d.record;
      token = d.token;
      try { localStorage.setItem("loytap_token", token); } catch (_) {}
    }
  } catch (_) {}

  if (!user) {
    try { localStorage.removeItem("loytap_signed_in"); } catch (_) {}
    location.replace("auth.html");
    return;
  }

  const g = document.getElementById("greeting");
  if (g) g.textContent = `Hello, ${(user.name || "there").trim()} 👋`;

  // build the single card from the café config
  const cfg = Object.assign({}, CARDS[0], {
    name: cafeName,
    stamps: stampsRequired,
    cols: Math.max(1, Math.ceil(stampsRequired / 2)),
    tag: `Collect ${stampsRequired} · earn a treat`,
  });
  decks = [buildCard(cfg, 0)];
  wallet.appendChild(decks[0].el);

  // restore the saved stamps exactly as they were
  const saved = Array.isArray(user.stamps) ? user.stamps : [];
  renderSaved(decks[0], saved);
  if (saved.length >= stampsRequired) {
    decks[0].stampBtn.disabled = true;
    decks[0].stampBtn.querySelector(".btn__label").textContent = "Complete!";
  }

  sizeConfetti();
  layout();
}

window.addEventListener("resize", () => { if (decks.length) { sizeConfetti(); layout(); } });
init();
