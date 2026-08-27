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
      "--paper": "#f0f0f0", "--paper-2": "#e2e2e2", "--ink": "#171717",
      "--ink-dim": "#565656", "--ink-faint": "#9a9a9a", "--line": "#cccccc",
      "--stamp-ink": "#171717", "--terra": "#1c1c1c", "--terra-deep": "#161616", "--gold": "#8a8a8a",
    },
    inks: ["#161616", "#171717", "#5a5a5a"],
    confetti: ["#171717", "#5a5a5a", "#cccccc", "#1c1c1c", "#e2e2e2"],
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

// The stamp mark is an infinity-knot badge (a stamped brand-mark look).
const STAR_SVG = `<img class="stamp-mark" src="knot-stamp.png?v=1" alt="" />`;

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

// Local testing only: on localhost, show the manual Stamp button and drive the
// real tap flow with a seeded dev tag. Never active on the deployed site.
const DEV_MODE = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const DEV_TAG = "DEVTAG";

// Lightweight transient message (used for cooldown / invalid-tap feedback).
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 3200);
}

// ===================================================================
// Build the cards (front face only — reward is a full-screen ticket)
// ===================================================================
// The reward is a random draw from the café's pool, so we tease what could be won
// and count down the stamps remaining on the card itself.
let rewardPool = [];
function poolLine() {
  if (!rewardPool.length) return "a surprise reward awaits";
  const names = rewardPool.slice(0, 2).map(escapeHtml).join(" · ");
  return "win " + names + (rewardPool.length > 2 ? " & more" : "");
}
function updateTeaser(deck) {
  const box = deck && deck.el.querySelector(".reward-teaser");
  if (!box || !deck) return;
  const remaining = deck.cfg.stamps - deck.stamped;
  let gift, main, sub;
  if (remaining <= 0) {
    gift = "🎉"; main = "Reward ready — <b>tap Stamp!</b>"; sub = "";
  } else if (remaining === 1) {
    gift = "🎁"; main = "<b>1 stamp</b> away — so close!"; sub = poolLine();
  } else {
    gift = "🎁"; main = "Only <b>" + remaining + " stamps</b> away from a reward"; sub = poolLine();
  }
  box.innerHTML = `<span class="reward-teaser__gift">${gift}</span>
    <span class="reward-teaser__body"><span class="reward-teaser__main">${main}</span>${sub ? `<span class="reward-teaser__sub">${sub}</span>` : ""}</span>`;
  box.hidden = false;
}

function buildCard(cfg, index) {
  const el = document.createElement("div");
  el.className = "wcard";
  el.dataset.index = index;
  for (const [k, v] of Object.entries(cfg.theme)) el.style.setProperty(k, v);

  const slotsHtml = Array.from({ length: cfg.stamps }, (_, i) => `
    <div class="slot" style="--i:${i}"><span class="halo"></span><span class="slot__num">${i + 1}</span><span class="stamp">${STAR_SVG}</span></div>`).join("");

  el.innerHTML = `
    <div class="card">
      <section class="face face--front">
        <span class="notch notch--l"></span><span class="notch notch--r"></span>
        <div class="oram-sheen" aria-hidden="true"></div>
        <header class="oram-head">
          <h1 class="oram-name">Oram</h1>
          <p class="oram-sub">Cafe &amp; Restaurant</p>
        </header>
        <div class="oram-progress">
          <span class="count">0</span><span class="counter__sep">/</span><span>${cfg.stamps}</span>
          <span class="oram-progress__label">stamps collected</span>
        </div>
        <div class="grid" style="--cols:${cfg.cols}">${slotsHtml}</div>
        <div class="reward-teaser" aria-live="polite" hidden></div>
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

  // No manual/self-serve stamping in production — stamps are only granted by a real
  // NFC tap (see the ?t= handler in init). On localhost only, reveal the button and
  // wire it to a dev tag so the flow can be tested without a physical card.
  if (DEV_MODE) {
    document.querySelector(".stampbar")?.classList.add("dev-on");
    deck.stampBtn.onclick = () => addStamp(deck, DEV_TAG);
  }
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
// A stamp is only ever granted by tapping the café's NFC card: `tagCode` is the
// tag's secret from the tap URL. The server validates it and enforces the cooldown.
async function addStamp(deck, tagCode) {
  if (busy || deck.stamped >= deck.cfg.stamps) return;
  if (!tagCode) return; // no self-serve stamping — a real tap is required
  busy = true;
  deck.stampBtn.disabled = true;
  let res = null, r = null;
  try {
    r = await fetch(API + "/card/stamp", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ tag: tagCode }),
    });
    res = await r.json();
    if (!r.ok) throw new Error((res && res.error) || "stamp failed");
  } catch (err) {
    busy = false; deck.stampBtn.disabled = false;
    if (res && res.error) toast(res.error);
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
  updateTeaser(deck);
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
  updateTeaser(deck);
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
// fanned-stack state for the active coupons
let activeEls = [];
let stackEl = null;
let spread = false;

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

// whole days left until the discount expires (negative = already expired)
function daysUntil(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return Infinity;
  return Math.ceil((t - Date.now()) / 864e5);
}
// stripe tone by urgency (monochrome): darker = more urgent
function urgencyColor(days) {
  if (days <= 2) return "#171717"; // urgent — near black
  if (days <= 5) return "#6f6f6f"; // soon — mid grey
  return "#b8b8b8";                // plenty of time — light grey
}

// backend /card/stamp discount payload -> pocket/congrats record
function discountToRec(d) {
  return {
    id: (d && d.id) || "",
    shop: (d && d.shop) || cafeName,
    deal: (d && d.deal) || "Reward",
    desc: (d && d.description) || "",
    code: (d && d.code) || "",
    short: shortDiscount((d && d.deal) || ""),
    due: (d && d.due) || dueDateStr(),
    terra: "#b8b8b8",
  };
}

// backend discounts collection record -> pocket record
function mapDiscount(item) {
  const days = daysUntil(item.due_date);
  return {
    id: item.id,
    shop: cafeName,
    deal: item.deal || "Reward",
    desc: item.description || "",
    code: item.code || "",
    short: shortDiscount(item.deal || ""),
    due: formatDue(item.due_date),
    dueISO: item.due_date,
    days: days,
    terra: urgencyColor(days),
    status: item.status,
    redeemedAt: item.redeemed_at || "",
  };
}

// Used/expired coupons linger in a dimmed "Past" section, then auto-hide from the
// pocket after this grace window. The backend row is always kept for the café.
const POCKET_GRACE_MS = 7 * 864e5;
function pocketState(d) {
  const now = Date.now();
  const expired = d.status === "expired" || (typeof d.days === "number" && d.days < 0);
  if (d.status === "redeemed") {
    const t = new Date(d.redeemedAt).getTime();
    return { past: true, kind: "used", visible: isNaN(t) ? true : now < t + POCKET_GRACE_MS };
  }
  if (expired) {
    const t = new Date(d.dueISO).getTime();
    return { past: true, kind: "expired", visible: isNaN(t) ? true : now < t + POCKET_GRACE_MS };
  }
  return { past: false, kind: null, visible: true };
}

function addDiscountToPocket(rec) {
  if (discounts.find((d) => d.code === rec.code)) return;
  discounts.unshift(rec);
  renderDiscounts();
  pocketBtn.classList.remove("pop"); void pocketBtn.offsetWidth; pocketBtn.classList.add("pop");
  pocketBadge.classList.remove("bump"); void pocketBadge.offsetWidth; pocketBadge.classList.add("bump");
}

function activeCoupon(d) {
  const c = document.createElement("div");
  c.className = "coupon";
  c.setAttribute("role", "button");
  // expiry line — always red; adds a countdown when ≤5 days
  let expText = "Expires " + (d.due || "—");
  if (typeof d.days === "number" && d.days <= 5) {
    expText = "Expires " + d.due + " · " + d.days + " day" + (d.days > 1 ? "s" : "") + " left";
  }
  c.innerHTML = `
    <span class="coupon__stripe" style="background:${d.terra}"></span>
    <div class="coupon__body">
      <p class="coupon__shop">${escapeHtml(d.shop)}</p>
      <p class="coupon__deal">${escapeHtml(d.deal)}</p>
      <p class="coupon__desc">${escapeHtml(d.desc)}</p>
      <p class="coupon__exp">${escapeHtml(expText)}</p>
    </div>
    <span class="coupon__go" aria-hidden="true">›</span>`;
  c.addEventListener("click", () => {
    // collapsed multi-card stack: first tap spreads the fan; then a tap opens the reward
    if (activeEls.length > 1 && !spread) { setSpread(true); return; }
    closeDrawer();
    setTimeout(() => showCongrats(d), 180);
  });
  return c;
}

function pastCoupon(d, kind) {
  const c = document.createElement("div");
  c.className = "coupon coupon--past";
  const label = kind === "used" ? "Used ✓" : "Expired";
  c.innerHTML = `
    <span class="coupon__stripe" style="background:#c7bda3"></span>
    <div class="coupon__body">
      <p class="coupon__shop">${escapeHtml(d.shop)}</p>
      <p class="coupon__deal">${escapeHtml(d.deal)}</p>
      <p class="coupon__desc">${escapeHtml(d.desc)}</p>
    </div>
    <span class="coupon__stamp">${label}</span>`;
  return c;
}

// Fan geometry
const STACK = { CARD: 96, GAP: 12, PEEK: 54, TIGHT: 9, CAP: 3 };

// Position the active coupons — either a compact fan (collapsed) or a full
// scrollable spread. The fan caps its depth so even 20 rewards stay short.
function layoutStack() {
  if (!stackEl) return;
  const n = activeEls.length;
  const S = STACK;
  if (spread || n === 1) {
    activeEls.forEach((c, i) => {
      c.style.transform = `translateY(${i * (S.CARD + S.GAP)}px) scale(1)`;
      c.style.zIndex = String(n - i);
      c.style.opacity = "1";
    });
    stackEl.style.height = (n * (S.CARD + S.GAP) - S.GAP) + "px";
  } else {
    let maxY = 0;
    activeEls.forEach((c, i) => {
      let ty, sc, op;
      if (i <= S.CAP) { ty = i * S.PEEK; sc = 1 - i * 0.04; op = i < 3 ? 1 : 0.94; }
      else { ty = S.CAP * S.PEEK + (i - S.CAP) * S.TIGHT; sc = 1 - S.CAP * 0.04 - 0.03; op = 0.72; }
      c.style.transform = `translateY(${ty}px) scale(${sc})`;
      c.style.zIndex = String(n - i);
      c.style.opacity = String(op);
      maxY = Math.max(maxY, ty);
    });
    stackEl.style.height = (maxY + S.CARD) + "px";
  }
}

function setSpread(v) {
  spread = v;
  if (stackEl) stackEl.classList.toggle("is-spread", v);
  const t = document.getElementById("stackToggle");
  if (t) t.textContent = v ? "Stack them back" : "Browse all " + activeEls.length;
  layoutStack();
}
function toggleSpread() { setSpread(!spread); }

function renderDiscounts() {
  const active = [];
  const past = [];
  discounts.forEach((d) => {
    const st = pocketState(d);
    if (!st.past) active.push(d);
    else if (st.visible) past.push({ d: d, kind: st.kind });
  });
  // most urgent (soonest to expire) sits at the front of the fan
  active.sort((a, b) => (typeof a.days === "number" ? a.days : 1e9) - (typeof b.days === "number" ? b.days : 1e9));

  // badge counts only usable (active) discounts
  pocketBadge.hidden = active.length === 0;
  pocketBadge.textContent = String(active.length);
  const tabBadge = document.getElementById("tabBadge");
  if (tabBadge) { tabBadge.hidden = active.length === 0; tabBadge.textContent = String(active.length); }
  drawerEmpty.style.display = active.length || past.length ? "none" : "block";

  drawerList.querySelectorAll(".coupon-stack, .stack-toggle, .drawer__section, .coupon").forEach((n) => n.remove());

  // active rewards as a fanned wallet stack
  activeEls = [];
  stackEl = null;
  spread = false;
  if (active.length) {
    const stack = document.createElement("div");
    stack.className = "coupon-stack";
    active.forEach((d) => { const c = activeCoupon(d); stack.appendChild(c); activeEls.push(c); });
    drawerList.appendChild(stack);
    stackEl = stack;
    layoutStack();
    if (active.length > 1) {
      const t = document.createElement("button");
      t.id = "stackToggle";
      t.className = "stack-toggle";
      t.type = "button";
      t.textContent = "Browse all " + active.length;
      t.addEventListener("click", toggleSpread);
      drawerList.appendChild(t);
    }
  }

  // past (used/expired) below, dimmed
  if (past.length) {
    const h = document.createElement("p");
    h.className = "drawer__section";
    h.textContent = "Past";
    drawerList.appendChild(h);
    past.forEach((p) => drawerList.appendChild(pastCoupon(p.d, p.kind)));
  }
}

// ---- shared scrim + bottom-nav overlays ----
const settingsSheet = document.getElementById("settings");
const tabbarEl = document.getElementById("tabbar");
const tabBtns = {
  discounts: document.getElementById("tabDiscounts"),
  wallet: document.getElementById("tabWallet"),
  settings: document.getElementById("tabSettings"),
};
const TAB_INDEX = { discounts: 0, wallet: 1, settings: 2 };

function setTab(name) {
  if (tabbarEl) tabbarEl.style.setProperty("--ti", TAB_INDEX[name]);
  for (const k in tabBtns) if (tabBtns[k]) tabBtns[k].classList.toggle("is-active", k === name);
}
function showScrim() { scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add("show")); }
function maybeHideScrim() {
  const anyOpen = drawer.classList.contains("open") || (settingsSheet && settingsSheet.classList.contains("open"));
  if (!anyOpen) { scrim.classList.remove("show"); setTimeout(() => { scrim.hidden = true; }, 320); }
}

async function loadDiscounts() {
  try {
    const r = await fetch(API + "/api/collections/discounts/records?perPage=100&sort=-created", { headers: { Authorization: token } });
    const data = await r.json();
    if (data && data.items) { discounts = data.items.map(mapDiscount); renderDiscounts(); }
  } catch (_) {}
}
async function openDrawer() {
  if (settingsSheet) closeSettings(true);
  showScrim();
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  setTab("discounts");
  loadDiscounts();
}
function closeDrawer(keepTab) {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  maybeHideScrim();
  if (!keepTab) setTab("wallet");
}

function openSettings() {
  closeDrawer(true);
  try {
    const nm = (localStorage.getItem("loytap_name") || "").trim();
    const cf = (localStorage.getItem("loytap_cafe") || cafeName || "").trim();
    const nEl = document.getElementById("setName"); if (nEl) nEl.textContent = nm || "—";
    const cEl = document.getElementById("setCafe"); if (cEl) cEl.textContent = cf || "—";
  } catch (_) {}
  showScrim();
  settingsSheet.classList.add("open");
  settingsSheet.setAttribute("aria-hidden", "false");
  setTab("settings");
}
function closeSettings(keepTab) {
  if (!settingsSheet) return;
  settingsSheet.classList.remove("open");
  settingsSheet.setAttribute("aria-hidden", "true");
  maybeHideScrim();
  if (!keepTab) setTab("wallet");
}

function doSignout() {
  ["loytap_token", "loytap_owner", "loytap_staff", "loytap_role", "loytap_signed_in", "loytap_name", "loytap_cafe"]
    .forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
  location.replace("auth.html");
}

pocketBtn.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", () => closeDrawer());
scrim.addEventListener("click", () => { closeDrawer(); closeSettings(); });

if (tabBtns.discounts) tabBtns.discounts.addEventListener("click", () => { drawer.classList.contains("open") ? closeDrawer() : openDrawer(); });
if (tabBtns.wallet) tabBtns.wallet.addEventListener("click", () => { closeDrawer(true); closeSettings(true); setTab("wallet"); });
if (tabBtns.settings) tabBtns.settings.addEventListener("click", () => { settingsSheet.classList.contains("open") ? closeSettings() : openSettings(); });

const setSignout = document.getElementById("setSignout");
if (setSignout) setSignout.addEventListener("click", doSignout);
const signoutBtn = document.getElementById("signoutBtn");
if (signoutBtn) signoutBtn.addEventListener("click", doSignout);

// ===================================================================
// Congratulation ticket (with barcode)
// ===================================================================
const congrats = document.getElementById("congrats");
const congratsSub = document.getElementById("congratsSub");
const congratsContinue = document.getElementById("congratsContinue");
const ticketDiscount = document.getElementById("ticketDiscount");
const ticketDue = document.getElementById("ticketDue");
const ticketQr = document.getElementById("ticketQr");
const ticketHint = document.getElementById("ticketHint");
const ticketCode = document.getElementById("ticketCode");
const ticketUsed = document.getElementById("ticketUsed");

// ---- Realtime: watch for the cashier redeeming the ticket that's on screen ----
// PocketBase realtime is Server-Sent Events: open /api/realtime, grab the clientId
// from the PB_CONNECT event, then POST the subscription (authenticated). When the
// staff /redeem hook saves status=redeemed, PB pushes an "update" to this client.
let rtSource = null, rtTopic = null, rtHandler = null, rtOnRedeem = null;

function rtStop() {
  if (rtSource) {
    try { if (rtTopic && rtHandler) rtSource.removeEventListener(rtTopic, rtHandler); } catch (_) {}
    try { rtSource.close(); } catch (_) {}
  }
  rtSource = null; rtTopic = null; rtHandler = null; rtOnRedeem = null;
}

function rtWatchDiscount(id, onRedeem) {
  rtStop();
  if (!id || !token || typeof EventSource === "undefined") return;
  rtTopic = "discounts/" + id;
  rtOnRedeem = onRedeem;
  rtSource = new EventSource(API + "/api/realtime");
  // (re)subscribe on every connect — EventSource reconnects transparently
  rtSource.addEventListener("PB_CONNECT", (e) => {
    let clientId = "";
    try { clientId = JSON.parse(e.data).clientId; } catch (_) {}
    if (!clientId) return;
    fetch(API + "/api/realtime", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ clientId: clientId, subscriptions: [rtTopic] }),
    }).catch(() => {});
  });
  rtHandler = (e) => {
    let rec = null;
    try { rec = JSON.parse(e.data).record; } catch (_) {}
    if (rec && rec.status === "redeemed" && rtOnRedeem) rtOnRedeem(rec);
  };
  rtSource.addEventListener(rtTopic, rtHandler);
}

// Fly the rubber-stamp tool down onto the ticket (same tool as the loyalty card),
// press, and lift away — revealing the "Used" mark at the moment of contact.
function playUsedStamp(onContact, onDone) {
  const t = congrats.querySelector(".ticket");
  if (!t || REDUCED || typeof stamper.animate !== "function") { onContact(); onDone(); return; }
  const S = 1.7; // scale the tool up so its ink face matches the ~150px "Used" circle
  const rect = t.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - STAMPER_W / 2;
  // transform-origin is bottom-centre; the rubber face sits ~55px above the base,
  // so lower the tool as it grows to keep the ink landing on the ticket centre.
  const yHit = rect.top + rect.height / 2 - (STAMPER_H - 55 * S);
  const up = yHit - 320;
  const prevZ = stamper.style.zIndex;
  stamper.style.zIndex = "230"; // above the congrats overlay (z 205)
  stamper.style.opacity = "1";
  const anim = stamper.animate([
    { transform: `translate(${x}px, ${up}px) rotate(-8deg) scale(${1.08 * S},${1.08 * S})`, opacity: 0, offset: 0 },
    { transform: `translate(${x}px, ${up + 150}px) rotate(-4deg) scale(${1.08 * S},${1.08 * S})`, opacity: 1, offset: 0.14 },
    { transform: `translate(${x}px, ${yHit}px) rotate(0deg) scale(${1.07 * S},${0.9 * S})`, opacity: 1, offset: 0.4 },
    { transform: `translate(${x}px, ${yHit - 4}px) rotate(0deg) scale(${0.99 * S},${1.02 * S})`, opacity: 1, offset: 0.5 },
    { transform: `translate(${x}px, ${yHit - 16}px) rotate(2deg) scale(${1 * S},${1 * S})`, opacity: 1, offset: 0.62 },
    { transform: `translate(${x}px, ${up}px) rotate(7deg) scale(${1.05 * S},${1.05 * S})`, opacity: 0, offset: 1 },
  ], { duration: 840, easing: "cubic-bezier(0.45,0.05,0.35,1)", fill: "forwards" });
  setTimeout(onContact, 336); // reveal the mark as the tool presses down
  anim.onfinish = () => { stamper.style.opacity = "0"; stamper.style.zIndex = prevZ || ""; onDone(); };
}

// Reveal the "Used" mark over the ticket. `animate` = play the stamp-tool press
// (live redeem); false = show instantly (reopening an already-used ticket).
function markTicketUsed(rec, animate) {
  if (congrats.hidden) return;
  // reflect in memory so the pocket already shows it as used
  const d = discounts.find((x) => (rec.id && x.id === rec.id) || x.code === rec.code);
  if (d) { d.status = "redeemed"; d.redeemedAt = rec.redeemed_at || new Date().toISOString(); }
  rtStop();
  const reveal = () => {
    ticketUsed.hidden = false;
    ticketUsed.classList.remove("stamp-in"); void ticketUsed.offsetWidth; ticketUsed.classList.add("stamp-in");
    congrats.classList.add("is-used");
    if (ticketHint) ticketHint.textContent = "Redeemed — enjoy your reward 🎉";
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (_) {} }
  };
  if (animate) playUsedStamp(reveal, () => {});
  else reveal();
}

function showCongrats(rec) {
  congratsSub.innerHTML = `Show this to <b>${escapeHtml(rec.shop)}</b> staff to claim your reward`;
  ticketDiscount.textContent = rec.short || shortDiscount(rec.deal);
  ticketDue.textContent = rec.due || dueDateStr();
  try { ticketQr.innerHTML = qrSvgDotted(rec.code, QR_COLOR); } catch (_) {}
  if (ticketCode) ticketCode.textContent = rec.code || "—";
  // fresh state (in case this ticket was previously shown used)
  congrats.classList.remove("is-used");
  ticketUsed.hidden = true; ticketUsed.classList.remove("stamp-in");
  if (ticketHint) ticketHint.textContent = "Show this QR to the staff";
  congrats.hidden = false;
  congrats.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => congrats.classList.add("show"));
  // if it's already redeemed (e.g. reopened from Past), show the stamp immediately;
  // otherwise watch live and play the stamp-tool press when the cashier redeems it
  if (rec.status === "redeemed") { markTicketUsed(rec, false); }
  else { rtWatchDiscount(rec.id, () => markTicketUsed(rec, true)); }
}
function hideCongrats() {
  rtStop();
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
  updateTeaser(deck);
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

  // the reward pool — teased on the card ("win Free coffee · 20% OFF…")
  try {
    const rr = await fetch(API + "/api/collections/reward_options/records?perPage=50&filter=(active=true)&sort=-created");
    const rd = await rr.json();
    rewardPool = ((rd && rd.items) || []).map((x) => x.deal).filter(Boolean);
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
  if (g) g.textContent = `Welcome back, ${(user.name || "there").trim()} 👋`;

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
  // NFC tap: the card's URL carries the tag's secret code as ?t=<CODE>. If the
  // user had to sign in first, the code was stashed before the auth redirect and
  // is restored here (fresh taps only, consumed once). The server validates the
  // code and enforces the cooldown — the client never decides whether it's a real tap.
  const params = new URLSearchParams(window.location.search);
  let tapCode = params.get("t");
  if (!tapCode) {
    try {
      const raw = localStorage.getItem("reloy_pending_tap");
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.code && Date.now() - (p.at || 0) < 120000) tapCode = p.code;
      }
    } catch (_) {}
  }
  try { localStorage.removeItem("reloy_pending_tap"); } catch (_) {}
  // strip ?t= from the address bar so a refresh/copy can't re-trigger a stamp
  if (params.get("t")) {
    try { history.replaceState(null, "", location.pathname); } catch (_) {}
  }

  if (tapCode) {
    setTimeout(() => {
      if (decks[0] && !busy && decks[0].stamped < decks[0].cfg.stamps) {
        addStamp(decks[0], tapCode);
      }
    }, 700);
  }

  sizeConfetti();
  layout();
  loadDiscounts(); // populate the Discounts tab badge on load
}

window.addEventListener("resize", () => { if (decks.length) { sizeConfetti(); layout(); } });
init();
