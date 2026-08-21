// ===================================================================
// LoyTap — customer wallet. Vanilla JS, no backend, resets each visit.
// Fill a card -> confetti -> full-screen "Congratulation!" barcode ticket.
// Edit CARDS to add/change cards.
// ===================================================================

const CARDS = [
  {
    id: "aurora", name: "Aurora Coffee", tag: "Collect 8 · earn a treat",
    stamps: 8, cols: 4,
    reward: { percent: "20% OFF", desc: "your next order", code: "AURORA20" },
    theme: {
      "--paper": "#f4fbf6", "--paper-2": "#e2f1e7", "--ink": "#16442c",
      "--ink-dim": "#4e7d63", "--ink-faint": "#8bae99", "--line": "#bcdcc7",
      "--stamp-ink": "#157a45", "--terra": "#23a468", "--terra-deep": "#178a52", "--gold": "#7fce9f",
    },
    inks: ["#0f5c33", "#157a45", "#2aa869"],
    confetti: ["#2aa869", "#7fce9f", "#cfe8d3", "#178a52", "#a9dcbb"],
  },
];

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STAMPER_W = 120, STAMPER_H = 150, BASE_OFFSET = 100;
const PEEK_GAP = 44;
const QR_COLOR = "#178a52";

const STAR_SVG = `<svg viewBox="0 0 120 120" filter="url(#roughInk)" fill="currentColor" aria-hidden="true"><path d="M60 6 L74 45 L116 45 L82 70 L95 112 L60 86 L25 112 L38 70 L4 45 L46 45 Z"/></svg>`;

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
        <header class="brand">
          <div class="brand__text">
            <h1 class="brand__name">${cfg.name}</h1>
            <p class="brand__tag">${cfg.tag}</p>
          </div>
          <div class="counter"><span class="count">0</span><span class="counter__sep">/</span><span>${cfg.stamps}</span></div>
        </header>
        <div class="grid" style="--cols:${cfg.cols}">${slotsHtml}</div>
        <footer class="controls">
          <button class="btn btn--primary stampBtn"><span class="btn__label">Stamp</span></button>
          <button class="btn btn--ghost resetBtn">Reset</button>
        </footer>
      </section>
    </div>`;

  const q = (s) => el.querySelector(s);
  const deck = {
    cfg, index, el,
    card: q(".card"),
    grid: q(".grid"),
    slots: [...el.querySelectorAll(".slot")],
    countEl: q(".count"),
    stampBtn: q(".stampBtn"),
    resetBtn: q(".resetBtn"),
    stamped: 0,
  };

  el.addEventListener("click", () => { if (deck.index !== activeIndex) setActive(deck.index); });
  deck.stampBtn.addEventListener("click", (e) => { e.stopPropagation(); addStamp(deck); });
  deck.resetBtn.addEventListener("click", (e) => { e.stopPropagation(); resetCard(deck); });
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
function addStamp(deck) {
  if (busy || deck.index !== activeIndex || deck.stamped >= deck.cfg.stamps) return;
  busy = true;
  deck.stampBtn.disabled = true;
  const slot = deck.slots[deck.stamped];
  deck.stamped++;
  const dx = Math.random() * 32 - 16;
  const dy = Math.random() * 32 - 16;
  playStamp(deck, slot, dx, dy, () => onImpact(deck, slot, dx, dy), () => onLifted(deck));
}

function onImpact(deck, slot, dx, dy) {
  slot.style.setProperty("--r", (Math.random() * 14 - 7).toFixed(1) + "deg");
  slot.style.setProperty("--dx", dx.toFixed(1) + "px");
  slot.style.setProperty("--dy", dy.toFixed(1) + "px");
  slot.style.setProperty("--sa", (0.55 + Math.random() * 0.45).toFixed(2));
  slot.classList.add("is-stamped");
  deck.countEl.textContent = String(deck.stamped);
  deck.stampBtn.classList.remove("pulse"); void deck.stampBtn.offsetWidth; deck.stampBtn.classList.add("pulse");
  inkPuff(deck, slot, dx, dy);
  deck.card.animate(
    [{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(3px,-1px)" }, { transform: "translate(0,0)" }],
    { duration: 260, easing: "ease" }
  );
}

function onLifted(deck) {
  busy = false;
  if (deck.stamped >= deck.cfg.stamps) {
    deck.stampBtn.disabled = true;
    deck.stampBtn.querySelector(".btn__label").textContent = "Complete!";
    setTimeout(() => complete(deck), REDUCED ? 120 : 350);
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
function complete(deck) {
  const rec = addDiscount(deck);
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
  if (busy) return;
  deck.stamped = 0;
  deck.countEl.textContent = "0";
  deck.stampBtn.disabled = false;
  deck.stampBtn.querySelector(".btn__label").textContent = "Stamp";
  particles = [];
  cctx.clearRect(0, 0, confetti.width, confetti.height);
  deck.slots.forEach((s) => s.classList.remove("is-stamped"));
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

function addDiscount(deck) {
  const code = deck.cfg.reward.code;
  let rec = discounts.find((d) => d.code === code);
  if (rec) return rec;
  rec = {
    shop: deck.cfg.name,
    deal: deck.cfg.reward.percent,
    desc: deck.cfg.reward.desc,
    code,
    short: shortDiscount(deck.cfg.reward.percent),
    due: dueDateStr(),
    terra: deck.cfg.theme["--terra"],
  };
  discounts.unshift(rec);
  renderDiscounts();
  pocketBtn.classList.remove("pop"); void pocketBtn.offsetWidth; pocketBtn.classList.add("pop");
  pocketBadge.classList.remove("bump"); void pocketBadge.offsetWidth; pocketBadge.classList.add("bump");
  return rec;
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

function openDrawer() {
  scrim.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add("show"); drawer.classList.add("open"); });
  drawer.setAttribute("aria-hidden", "false");
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

// Greeting — name comes from sign-up (stored at sign-in); placeholder until then.
(() => {
  const g = document.getElementById("greeting");
  let name = "";
  try { name = (localStorage.getItem("loytap_name") || "").trim(); } catch (_) {}
  g.textContent = `Hello, ${name || "Sara"} 👋`;
})();

decks = CARDS.map((cfg, i) => { const d = buildCard(cfg, i); wallet.appendChild(d.el); return d; });
sizeConfetti();
window.addEventListener("resize", () => { sizeConfetti(); layout(); });
window.addEventListener("load", () => setTimeout(layout, 40));
layout();
