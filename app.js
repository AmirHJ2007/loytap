// ===================================================================
// Little Wallet — an Apple-Wallet-style stack of loyalty cards.
// Vanilla JS, no backend. Resets each visit. Edit CARDS to add/change cards.
// ===================================================================

const CARDS = [
  {
    id: "aurora", name: "Aurora Coffee", tag: "Collect 8 · earn a treat",
    stamps: 8, cols: 4,
    reward: { percent: "20% OFF", desc: "your next order", code: "AURORA20" },
    theme: {
      "--paper": "#fffaf0", "--paper-2": "#f6ead0", "--ink": "#4a2f1c",
      "--ink-dim": "#8a6a45", "--ink-faint": "#b79a70", "--line": "#cdb083",
      "--stamp-ink": "#6b3410", "--terra": "#c8703d", "--terra-deep": "#a8511f", "--gold": "#caa25a",
    },
    inks: ["#5a2e1b", "#6b3410", "#a8511f"],
    confetti: ["#c8703d", "#e0a458", "#f0c987", "#8a5a34", "#caa25a"],
    foil: ["#b98a45", "#e6c079", "#f5e0a8", "#d9ac60", "#b0803c"],
  },
  {
    id: "bloom", name: "Bloom Bakery", tag: "Collect 6 · one on us",
    stamps: 6, cols: 3,
    reward: { percent: "FREE", desc: "a pastry of your choice", code: "BLOOM01" },
    theme: {
      "--paper": "#fff7f8", "--paper-2": "#fbe7ec", "--ink": "#54263a",
      "--ink-dim": "#9a5c74", "--ink-faint": "#caa0b0", "--line": "#e2b6c5",
      "--stamp-ink": "#a83f63", "--terra": "#d9668a", "--terra-deep": "#b8436b", "--gold": "#e6a7bd",
    },
    inks: ["#8f2f50", "#a83f63", "#c85b83"],
    confetti: ["#d9668a", "#e89ab3", "#f3c6d5", "#b8436b", "#e6a7bd"],
    foil: ["#c98aa0", "#eec3d2", "#f8e0e8", "#e0aabf", "#c07f97"],
  },
  {
    id: "verde", name: "Verde Juice", tag: "Collect 10 · get refreshed",
    stamps: 10, cols: 5,
    reward: { percent: "25% OFF", desc: "any cold-press", code: "VERDE25" },
    theme: {
      "--paper": "#f8fcf4", "--paper-2": "#e9f3dd", "--ink": "#254028",
      "--ink-dim": "#5a7a52", "--ink-faint": "#9cbb8f", "--line": "#bcd8a9",
      "--stamp-ink": "#2f7a3c", "--terra": "#5aa860", "--terra-deep": "#398345", "--gold": "#9ccf7a",
    },
    inks: ["#245c2c", "#2f7a3c", "#4c9a4f"],
    confetti: ["#5aa860", "#9ccf7a", "#cfe8a8", "#398345", "#d7e6a0"],
    foil: ["#8fb87a", "#c7e0a8", "#e2f0cf", "#b0d090", "#84a86e"],
  },
  {
    id: "nordic", name: "Nordic Tea", tag: "Collect 8 · steep & save",
    stamps: 8, cols: 4,
    reward: { percent: "15% OFF", desc: "your pot of tea", code: "NORDIC15" },
    theme: {
      "--paper": "#f6f9fc", "--paper-2": "#e6eef6", "--ink": "#25384b",
      "--ink-dim": "#5a748d", "--ink-faint": "#9cb2c7", "--line": "#bcd0e2",
      "--stamp-ink": "#2f5f8a", "--terra": "#4f86b8", "--terra-deep": "#2f5f8a", "--gold": "#8fb4d6",
    },
    inks: ["#26496b", "#2f5f8a", "#4577a8"],
    confetti: ["#4f86b8", "#8fb4d6", "#c4dcf0", "#2f5f8a", "#a9c8e2"],
    foil: ["#8aa6c2", "#c2d6ea", "#e0ebf6", "#a9c2dc", "#7f97b2"],
  },
];

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STAMPER_W = 120, STAMPER_H = 150, BASE_OFFSET = 100;
const PEEK_GAP = 44;

const STAR_SVG = `<svg viewBox="0 0 120 120" filter="url(#roughInk)" fill="currentColor" aria-hidden="true"><path d="M60 6 L74 45 L116 45 L82 70 L95 112 L60 86 L25 112 L38 70 L4 45 L46 45 Z"/></svg>`;

const wallet = document.getElementById("wallet");
const stamper = document.getElementById("stamper");
const confetti = document.getElementById("confetti");
const cctx = confetti.getContext("2d");

let decks = [];
let activeIndex = 0;
let busy = false; // a stamp animation is playing on the active card

// ===================================================================
// Build the cards
// ===================================================================
function buildCard(cfg, index) {
  const el = document.createElement("div");
  el.className = "wcard";
  el.dataset.index = index;
  for (const [k, v] of Object.entries(cfg.theme)) el.style.setProperty(k, v);

  const slotsHtml = Array.from({ length: cfg.stamps }, (_, i) => `
    <div class="slot">
      <span class="halo"></span>
      <span class="slot__num">${i + 1}</span>
      <span class="stamp">${STAR_SVG}</span>
    </div>`).join("");

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
      <section class="face face--back">
        <span class="notch notch--l"></span><span class="notch notch--r"></span>
        <div class="reward">
          <p class="reward__eyebrow">Card full ✦</p>
          <div class="reward__prize">
            <div class="reward__hidden">
              <p class="reward__percent">${cfg.reward.percent}</p>
              <p class="reward__desc">${cfg.reward.desc}</p>
              <button class="code"><span class="code__value">${cfg.reward.code}</span><span class="code__copy">Copy</span></button>
            </div>
            <canvas class="scratch"></canvas>
          </div>
          <p class="reward__hint">Scratch the foil to reveal your code</p>
          <div class="reward__actions">
            <button class="btn btn--ghost reward__reveal">Reveal</button>
            <button class="btn btn--primary reward__restart">↺ New card</button>
          </div>
        </div>
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
    prize: q(".reward__prize"),
    scratch: q(".scratch"),
    sctx: q(".scratch").getContext("2d"),
    scratchHint: q(".reward__hint"),
    revealBtn: q(".reward__reveal"),
    restartBtn: q(".reward__restart"),
    codeBtn: q(".code"),
    codeCopy: q(".code__copy"),
    stamped: 0, cleared: false, scratchReady: false, scratching: false, sampleThrottle: 0,
  };

  // ---- wiring ----
  el.addEventListener("click", (e) => {
    if (deck.index !== activeIndex) { setActive(deck.index); }
  });
  deck.stampBtn.addEventListener("click", (e) => { e.stopPropagation(); addStamp(deck); });
  deck.resetBtn.addEventListener("click", (e) => { e.stopPropagation(); resetCard(deck); });
  deck.restartBtn.addEventListener("click", (e) => { e.stopPropagation(); resetCard(deck); });
  deck.revealBtn.addEventListener("click", (e) => { e.stopPropagation(); revealCode(deck); });
  deck.codeBtn.addEventListener("click", (e) => { e.stopPropagation(); copyCode(deck); });
  deck.scratch.addEventListener("pointerdown", (e) => { deck.scratching = true; deck.scratch.setPointerCapture(e.pointerId); scratchAt(deck, e); });
  deck.scratch.addEventListener("pointermove", (e) => { if (deck.scratching) scratchAt(deck, e); });

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
      d.el.classList.add("is-active");
      d.el.classList.remove("is-peek");
    } else {
      peek++;
      const y = H + (peek - 1) * PEEK_GAP;
      d.el.style.transform = `translateY(${y}px) scale(${(1 - 0.02 * peek).toFixed(3)})`;
      d.el.style.zIndex = String(40 + peek); // later peeks sit in front
      d.el.classList.add("is-peek");
      d.el.classList.remove("is-active");
    }
  });
  wallet.style.height = H + (decks.length - 1) * PEEK_GAP + 46 + "px";
}

function setActive(i) {
  if (busy) return;
  activeIndex = i;
  layout();
}

// ===================================================================
// Stamping (operates on the active deck)
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

  deck.stampBtn.classList.remove("pulse");
  void deck.stampBtn.offsetWidth;
  deck.stampBtn.classList.add("pulse");

  inkPuff(deck, slot, dx, dy);

  deck.el.classList.remove("shake");
  void deck.el.offsetWidth;
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
// Completion → confetti → flip → scratch
// ===================================================================
function complete(deck) {
  celebrate(deck);
  setTimeout(() => { deck.card.classList.add("is-flipped"); setTimeout(() => initScratch(deck), REDUCED ? 0 : 980); }, REDUCED ? 0 : 250);
}

function celebrate(deck) {
  const r = deck.card.getBoundingClientRect();
  spawnParticles(r.left + r.width / 2, r.top + r.height * 0.35, REDUCED ? 30 : 150, {
    spread: Math.max(window.innerWidth, 500), size: [4, 9], life: 2500, gravity: 0.18, confetti: true, colors: deck.cfg.confetti,
  });
}

function resetCard(deck) {
  if (busy) return;
  deck.stamped = 0;
  deck.countEl.textContent = "0";
  deck.stampBtn.disabled = false;
  deck.stampBtn.querySelector(".btn__label").textContent = "Stamp";
  deck.card.classList.remove("is-flipped");
  particles = [];
  cctx.clearRect(0, 0, confetti.width, confetti.height);
  deck.slots.forEach((s) => { s.classList.remove("is-stamped"); });
  setTimeout(() => initScratch(deck), REDUCED ? 0 : 650);
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
  const { spread = 100, size = [3, 6], life = 1200, gravity = 0.06, confetti: conf = false, splash = false, colors = ["#c8703d"] } = opts;
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
// Scratch-off (per card)
// ===================================================================
function initScratch(deck) {
  deck.cleared = false;
  deck.scratch.classList.remove("is-cleared");
  deck.scratchHint.classList.remove("is-hidden");
  deck.scratchHint.textContent = "Scratch the foil to reveal your code";
  deck.revealBtn.classList.remove("is-hidden");

  const rect = deck.scratch.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width || 210, h = rect.height || 132;
  deck.scratch.width = Math.round(w * dpr); deck.scratch.height = Math.round(h * dpr);
  const c = deck.sctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const f = deck.cfg.foil;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, f[0]); g.addColorStop(0.35, f[1]); g.addColorStop(0.5, f[2]); g.addColorStop(0.65, f[3]); g.addColorStop(1, f[4]);
  c.globalCompositeOperation = "source-over"; c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalAlpha = 0.12; c.strokeStyle = "#ffffff"; c.lineWidth = 6;
  for (let x = -h; x < w; x += 22) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + h, h); c.stroke(); }
  c.globalAlpha = 1;
  c.fillStyle = "rgba(40,40,50,0.6)"; c.font = "700 12px Fraunces, serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("✦ SCRATCH HERE ✦", w / 2, h / 2);
  deck.scratchReady = true;
}

function scratchAt(deck, e) {
  if (!deck.scratchReady || deck.cleared) return;
  const rect = deck.scratch.getBoundingClientRect();
  const c = deck.sctx;
  c.globalCompositeOperation = "destination-out";
  c.beginPath(); c.arc(e.clientX - rect.left, e.clientY - rect.top, 18, 0, Math.PI * 2); c.fill();
  deck.scratchHint.classList.add("is-hidden");
  const now = performance.now();
  if (now - deck.sampleThrottle < 120) return;
  deck.sampleThrottle = now;
  const img = c.getImageData(0, 0, deck.scratch.width, deck.scratch.height).data;
  let clear = 0, counted = 0;
  for (let i = 3; i < img.length; i += 64) { counted++; if (img[i] < 40) clear++; }
  if (clear / counted > 0.5) revealCode(deck);
}

function revealCode(deck) {
  if (deck.cleared) return;
  deck.cleared = true;
  deck.scratch.classList.add("is-cleared");
  deck.scratchHint.classList.add("is-hidden");
  deck.revealBtn.classList.add("is-hidden");
  addDiscount(deck);
  if (!REDUCED) {
    deck.prize.classList.add("shine");
    setTimeout(() => deck.prize.classList.remove("shine"), 800);
    const r = deck.prize.getBoundingClientRect();
    spawnParticles(r.left + r.width / 2, r.top + r.height / 2, 24, { size: [3, 6], life: 1400, gravity: 0.05, confetti: true, colors: deck.cfg.confetti });
  }
}

async function copyCode(deck) {
  try { await navigator.clipboard.writeText(deck.codeBtn.querySelector(".code__value").textContent.trim()); } catch (_) {}
  deck.codeCopy.textContent = "Copied!";
  setTimeout(() => (deck.codeCopy.textContent = "Copy"), 1500);
}

// ===================================================================
// Discounts pocket (session-only collection of revealed codes)
// ===================================================================
const pocketBtn = document.getElementById("pocketBtn");
const pocketBadge = document.getElementById("pocketBadge");
const scrim = document.getElementById("scrim");
const drawer = document.getElementById("drawer");
const drawerClose = document.getElementById("drawerClose");
const drawerList = document.getElementById("drawerList");
const drawerEmpty = document.getElementById("drawerEmpty");

let discounts = [];
const seenCodes = new Set();

function addDiscount(deck) {
  const code = deck.cfg.reward.code;
  if (seenCodes.has(code)) return;
  seenCodes.add(code);
  discounts.unshift({
    shop: deck.cfg.name,
    deal: deck.cfg.reward.percent,
    desc: deck.cfg.reward.desc,
    code,
    terra: deck.cfg.theme["--terra"],
    terraDeep: deck.cfg.theme["--terra-deep"],
  });
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
    c.innerHTML = `
      <span class="coupon__stripe" style="background:${d.terra}"></span>
      <div class="coupon__body">
        <p class="coupon__shop">${d.shop}</p>
        <p class="coupon__deal">${d.deal}</p>
        <p class="coupon__desc">${d.desc}</p>
      </div>
      <div class="coupon__code">
        <span class="coupon__value">${d.code}</span>
        <button class="coupon__copy" style="background:${d.terraDeep}">Copy</button>
      </div>`;
    const btn = c.querySelector(".coupon__copy");
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(d.code); } catch (_) {}
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

// ===================================================================
// Init
// ===================================================================
decks = CARDS.map((cfg, i) => { const d = buildCard(cfg, i); wallet.appendChild(d.el); return d; });
sizeConfetti();
window.addEventListener("resize", () => { sizeConfetti(); layout(); });
window.addEventListener("load", () => setTimeout(layout, 40));
layout();
