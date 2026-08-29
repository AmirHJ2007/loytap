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
let myUserId = "";
// The customer's loyalty cards, one per café — [{id, cafeId, cafeName, stampsRequired, theme, stampCount, cycles, stamps}]
let memberships = [];

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
let selectedIndex = null; // null = browse stack; a number = that card is expanded (detail view)
let busy = false;
let pendingReset = null; // deck to reset to empty after the congrats "Continue"
let pendingNextRequired = 0; // stamps the next card needs (may differ if the café changed its goal)

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
  el.style.setProperty("--accent", cfg.accent || "#171717");

  const slotsHtml = Array.from({ length: cfg.stamps }, (_, i) => `
    <div class="slot" style="--i:${i}"><span class="halo"></span><span class="slot__num">${i + 1}</span><span class="stamp">${STAR_SVG}</span></div>`).join("");

  el.innerHTML = `
    <div class="card">
      <section class="face face--front">
        <span class="notch notch--l"></span><span class="notch notch--r"></span>
        <div class="oram-sheen" aria-hidden="true"></div>
        <header class="oram-head">
          <div class="oram-head__id">
            <h1 class="oram-name">${escapeHtml(cfg.name || "Café")}</h1>
            ${cfg.tagline ? `<p class="oram-sub">${escapeHtml(cfg.tagline)}</p>` : ""}
          </div>
          <div class="oram-mini"><span class="count">0</span><span class="oram-mini__sep">/</span><span>${cfg.stamps}</span></div>
        </header>
        <div class="grid" style="--cols:${cfg.cols}">${slotsHtml}</div>
        ${cfg.minPurchase ? `<p class="oram-min">Min. purchase for a stamp · ${formatToman(cfg.minPurchase)} toman</p>` : ""}
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

  // in the browse stack, tapping a card opens it in detail view
  el.addEventListener("click", () => { if (selectedIndex == null) selectCard(deck.index); });

  // No manual/self-serve stamping in production — stamps are only granted by a real
  // NFC tap (see the ?t= handler in init). On localhost only, reveal the button and
  // wire it to a dev tag so the flow can be tested without a physical card.
  if (DEV_MODE) {
    document.querySelector(".stampbar")?.classList.add("dev-on");
    deck.stampBtn.onclick = () => handleTap(DEV_TAG);
  }
  return deck;
}

// ===================================================================
// Wallet stack layout
// ===================================================================
const STRIP = 84; // visible header height of a stacked card (shows its name + tagline + N/8)
const STEP = 64;  // vertical step between stacked cards (they overlap a touch)
function cardHeight(d) { return d.el.scrollHeight; } // full (fixed-aspect) card height, even while clipped

function layout() {
  if (!decks.length) return;
  decks.forEach((d) => { d.el.style.opacity = ""; d.el.style.pointerEvents = ""; });

  if (selectedIndex != null && decks[selectedIndex]) {
    // DETAIL VIEW — the chosen card grows to full; everything else slides + fades away
    const Hf = cardHeight(decks[selectedIndex]);
    decks.forEach((d) => {
      if (d.index === selectedIndex) {
        d.el.classList.add("is-open"); d.el.classList.remove("is-peek");
        d.el.style.height = Hf + "px";
        d.el.style.transform = "translateY(0) scale(1)";
        d.el.style.zIndex = "100";
      } else {
        d.el.classList.remove("is-peek", "is-open");
        d.el.style.transform = `translateY(${d.index < selectedIndex ? -90 : 130}px) scale(0.86)`;
        d.el.style.opacity = "0"; d.el.style.pointerEvents = "none"; d.el.style.zIndex = "0";
      }
    });
    wallet.style.height = Hf + "px";
    return;
  }

  // BROWSE STACK — cards top-to-bottom as header strips; the last one shown in full
  const last = decks.length - 1;
  const Hlast = cardHeight(decks[last]);
  let y = 0;
  decks.forEach((d, i) => {
    d.el.classList.remove("is-open");
    d.el.style.transform = `translateY(${y}px) scale(1)`;
    d.el.style.zIndex = String(10 + i); // later cards sit on top of earlier strips
    if (i === last) {
      d.el.classList.remove("is-peek");
      d.el.style.height = cardHeight(d) + "px";  // explicit px so expand/collapse can animate
    } else {
      d.el.classList.add("is-peek");
      d.el.style.height = STRIP + "px";
      y += STEP;
    }
  });
  wallet.style.height = ((decks.length - 1) * STEP + Hlast) + "px";
}

// expand one card to the detail view (others + toolbar hide, a ✕ appears)
function enterDetail(i) {
  selectedIndex = i;
  document.body.classList.add("card-open");
  if (tabbarEl) tabbarEl.classList.add("is-hidden");
  const wc = document.getElementById("walletClose"); if (wc) wc.hidden = false;
  // clip the growing card during the reveal, then free it so its shadow shows
  const el = decks[i].el;
  el.style.overflow = "hidden";
  clearTimeout(el._ovT);
  el._ovT = setTimeout(() => { if (selectedIndex === i) el.style.overflow = "visible"; }, 620);
  layout();
}
async function selectCard(i) {
  if (busy || selectedIndex === i || !decks[i]) return;
  enterDetail(i);
  const d = decks[i];
  if (d) { try { await loadRewardPool(d.cfg.cafeId); } catch (_) {} updateTeaser(d); }
}
// collapse back to the browse stack
function deselectCard() {
  if (busy) return;
  // re-clip the collapsing card so its height animation reads as a fold-down
  decks.forEach((d) => { d.el.style.overflow = ""; clearTimeout(d.el._ovT); });
  selectedIndex = null;
  document.body.classList.remove("card-open");
  if (tabbarEl) tabbarEl.classList.remove("is-hidden");
  const wc = document.getElementById("walletClose"); if (wc) wc.hidden = true;
  layout();
}

// build a card config from a stored membership, or from a /card/stamp café payload
function cfgFromMembership(m) {
  return Object.assign({}, CARDS[0], {
    cafeId: m.cafeId, name: m.cafeName, tagline: m.tagline || "", accent: m.accent || "#171717",
    stamps: m.stampsRequired, cols: Math.max(1, Math.ceil(m.stampsRequired / 2)),
    tag: `Collect ${m.stampsRequired} · earn a treat`, minPurchase: m.minPurchase || 0,
  });
}
function cfgFromCafe(c) {
  return Object.assign({}, CARDS[0], {
    cafeId: c.id, name: c.name, tagline: c.tagline || "", accent: c.accent || "#171717",
    stamps: c.stamps_required, cols: Math.max(1, Math.ceil(c.stamps_required / 2)),
    tag: `Collect ${c.stamps_required} · earn a treat`, minPurchase: c.min_purchase || 0,
  });
}

// ===================================================================
// Stamping
// ===================================================================
// The backend adds the stamp (and decides its look + any reward), so the
// exact same stars come back on sign-in and stamps can't be faked.
// A stamp is only ever granted by tapping the café's NFC card: `tagCode` is the
// tag's secret from the tap URL. The server validates it and enforces the cooldown.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One tap does everything automatically: the server records the stamp (and
// resolves WHICH café the tag belongs to), then we surface that café's card to
// the front of the wallet — creating it with a slide-in if this is the first
// visit — and press the stamp onto it.
async function handleTap(tagCode) {
  if (busy || !tagCode) return;
  busy = true;
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
    busy = false;
    if (res && res.error) toast(res.error);
    return;
  }
  const c = res.cafe || {};
  if (!c.id) { busy = false; return; }

  let idx = decks.findIndex((d) => d.cfg.cafeId === c.id);
  const isNew = idx === -1;
  if (isNew) {
    // first ever visit to this café — a fresh card slides into the wallet
    const empty = wallet.querySelector(".wallet-empty"); if (empty) empty.remove();
    const deck = buildCard(cfgFromCafe(c), decks.length);
    decks.push(deck);
    wallet.appendChild(deck.el);
    memberships.push({
      id: "", cafeId: c.id, cafeName: c.name, tagline: c.tagline || "", accent: c.accent || "#171717",
      stampsRequired: c.stamps_required, minPurchase: c.min_purchase || 0, stampCount: 0, cycles: 0, stamps: [],
    });
    idx = deck.index;
    deck.el.style.transform = "translateY(130%) scale(0.92)"; // start off-screen for the entrance
    void deck.el.offsetWidth;
  }

  enterDetail(idx); // the tapped café's card rises to the detail view (others + toolbar hide)
  await wait(isNew ? (REDUCED ? 0 : 620) : (REDUCED ? 60 : 560));
  try { await loadRewardPool(c.id); } catch (_) {}
  animateStamp(decks[idx], res); // press the stamp that was already recorded (frees busy in onLifted)
}

// Press an already-recorded stamp onto a deck (no network — res came from the tap).
function animateStamp(deck, res) {
  if (!deck || !res || !res.stamp) { busy = false; return; }
  if (deck.stamped >= deck.slots.length) { busy = false; updateTeaser(deck); return; }
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
    setTimeout(() => complete(deck, res.discount, res.next_required), REDUCED ? 120 : 350);
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
function complete(deck, discount, nextRequired) {
  const rec = discountToRec(discount);
  addDiscountToPocket(rec);
  celebrate(deck);
  pendingReset = deck; // once they hit "Continue", the card starts over from the top
  pendingNextRequired = nextRequired || 0; // the next card may need a different number of stamps
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
const drawerBack = document.getElementById("drawerBack");
const drawerTitle = document.getElementById("drawerTitle");
const drawerList = document.getElementById("drawerList");
const drawerEmpty = document.getElementById("drawerEmpty");

let discounts = [];
// null = showing the café list; otherwise the café whose discounts are shown
let drawerCafeId = null;

function shortDiscount(p) {
  const m = String(p).match(/(\d+)\s*%/);
  return m ? `-${m[1]}%` : p;
}
// group thousands for toman amounts, e.g. 50000 -> "50,000"
function formatToman(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v.toLocaleString("en-US");
}
// stored phone is normalized like "9121234567" -> display "0912 123 4567"
function formatPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "").replace(/^98/, "").replace(/^0/, "");
  if (!/^9\d{9}$/.test(d)) return raw ? String(raw) : "—";
  return "0" + d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6);
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
// backend /card/stamp discount payload -> pocket/congrats record
function discountToRec(d) {
  return {
    id: (d && d.id) || "",
    cafeId: (d && d.cafe_id) || "",
    shop: (d && d.shop) || "",
    deal: (d && d.deal) || "Reward",
    desc: (d && d.description) || "",
    code: (d && d.code) || "",
    short: shortDiscount((d && d.deal) || ""),
    due: (d && d.due) || dueDateStr(),
  };
}

// backend discounts collection record (expand=cafe) -> pocket record
function mapDiscount(item) {
  const days = daysUntil(item.due_date);
  const c = (item.expand && item.expand.cafe) || {};
  return {
    id: item.id,
    cafeId: item.cafe,
    shop: c.cafe_name || "",
    deal: item.deal || "Reward",
    desc: item.description || "",
    code: item.code || "",
    short: shortDiscount(item.deal || ""),
    due: formatDue(item.due_date),
    dueISO: item.due_date,
    days: days,
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
  updateBadges();
  renderDrawer();
  pocketBtn.classList.remove("pop"); void pocketBtn.offsetWidth; pocketBtn.classList.add("pop");
  pocketBadge.classList.remove("bump"); void pocketBadge.offsetWidth; pocketBadge.classList.add("bump");
}

function activeCoupon(d) {
  const c = document.createElement("div");
  const urgent = typeof d.days === "number" && d.days <= 5;
  c.className = "coupon-card" + (urgent ? " is-urgent" : "");
  c.setAttribute("role", "button");
  let expText = d.due || "—";
  if (urgent) expText = d.days <= 0 ? "Expires today" : d.days + " day" + (d.days > 1 ? "s" : "") + " left";
  const glow = urgent ? "rgba(255,90,74,0.55)" : "rgba(255,255,255,0.16)";
  c.innerHTML = `
    <span class="coupon-card__glow" style="background:${glow}"></span>
    <span class="coupon-card__shine" aria-hidden="true"></span>
    <span class="coupon-card__kicker">Reward</span>
    <p class="coupon-card__deal">${escapeHtml(d.deal)}</p>
    <p class="coupon-card__desc">${escapeHtml(d.desc)}</p>
    <span class="coupon-card__notch"></span>
    <p class="coupon-card__exp${urgent ? " is-urgent" : ""}">${urgent ? '<span class="coupon-card__dot"></span>' : ""}${escapeHtml(expText)}</p>`;
  c.addEventListener("click", () => {
    closeDrawer();
    setTimeout(() => showCongrats(d), 180);
  });
  return c;
}

function pastCoupon(d, kind) {
  const c = document.createElement("div");
  c.className = "coupon-card coupon-card--past";
  const label = kind === "used" ? "Used ✓" : "Expired";
  c.innerHTML = `
    <p class="coupon-card__deal">${escapeHtml(d.deal)}</p>
    <p class="coupon-card__desc">${escapeHtml(d.desc)}</p>
    <span class="coupon-card__notch"></span>
    <span class="coupon-card__stamp">${label}</span>`;
  return c;
}

// the tab badge / pocket badge always count ALL cafés' usable discounts
function updateBadges() {
  const count = discounts.filter((d) => !pocketState(d).past).length;
  pocketBadge.hidden = count === 0;
  pocketBadge.textContent = String(count);
  const tabBadge = document.getElementById("tabBadge");
  if (tabBadge) { tabBadge.hidden = count === 0; tabBadge.textContent = String(count); }
}

function clearDrawerBody() {
  drawerList.querySelectorAll(".cafe-list, .discounts-page").forEach((n) => n.remove());
}

// LEVEL 1 — the cafés this customer has a live loyalty card with
function renderCafeList() {
  clearDrawerBody();
  if (drawerTitle) drawerTitle.textContent = "My Cafés";
  if (drawerBack) drawerBack.hidden = true;

  if (!memberships.length) {
    drawerEmpty.innerHTML = "No cafés yet.<br/>Tap a café's card to start your first loyalty card.";
    drawerEmpty.style.display = "block";
    return;
  }
  drawerEmpty.style.display = "none";

  const list = document.createElement("div");
  list.className = "cafe-list";
  memberships.forEach((m) => {
    const rewardCount = discounts.filter((d) => d.cafeId === m.cafeId && !pocketState(d).past).length;
    const initial = (m.cafeName || "?").trim().charAt(0).toUpperCase();
    const row = document.createElement("button");
    row.className = "cafe-row";
    row.type = "button";
    row.innerHTML = `
      <span class="cafe-row__avatar">${escapeHtml(initial)}</span>
      <span class="cafe-row__body">
        <span class="cafe-row__name">${escapeHtml(m.cafeName)}</span>
        <span class="cafe-row__sub">${m.stampCount}/${m.stampsRequired} stamps${rewardCount ? " · " + rewardCount + " reward" + (rewardCount > 1 ? "s" : "") : ""}</span>
      </span>
      ${rewardCount ? `<span class="cafe-row__badge">${rewardCount}</span>` : ""}
      <span class="cafe-row__go" aria-hidden="true">›</span>`;
    row.addEventListener("click", () => { drawerCafeId = m.cafeId; renderDrawer(); });
    list.appendChild(row);
  });
  drawerList.appendChild(list);
}

// LEVEL 2 — one café's discount grid
function renderCafeDiscounts(cafeId) {
  const m = memberships.find((x) => x.cafeId === cafeId);
  if (drawerTitle) drawerTitle.textContent = (m && m.cafeName) || "Discounts";
  if (drawerBack) drawerBack.hidden = false;

  const active = [];
  const past = [];
  discounts.filter((d) => d.cafeId === cafeId).forEach((d) => {
    const st = pocketState(d);
    if (!st.past) active.push(d);
    else if (st.visible) past.push({ d: d, kind: st.kind });
  });
  // most urgent (soonest to expire) sits first in the grid
  active.sort((a, b) => (typeof a.days === "number" ? a.days : 1e9) - (typeof b.days === "number" ? b.days : 1e9));

  clearDrawerBody();

  // everything for this café lands in one wrapper so it can slide in as a unit
  const page = document.createElement("div");
  page.className = "discounts-page";
  drawerList.appendChild(page);

  drawerEmpty.innerHTML = "No discounts yet.<br/>Fill this card to earn one.";
  drawerEmpty.style.display = active.length || past.length ? "none" : "block";

  // active rewards as a grid of coupon cards
  if (active.length) {
    const grid = document.createElement("div");
    grid.className = "coupon-grid";
    active.forEach((d) => grid.appendChild(activeCoupon(d)));
    page.appendChild(grid);
  }

  // past (used/expired) below, dimmed
  if (past.length) {
    const h = document.createElement("p");
    h.className = "drawer__section";
    h.textContent = "Past";
    page.appendChild(h);
    const pastGrid = document.createElement("div");
    pastGrid.className = "coupon-grid coupon-grid--past";
    past.forEach((p) => pastGrid.appendChild(pastCoupon(p.d, p.kind)));
    page.appendChild(pastGrid);
  }
}

function renderDrawer() {
  if (drawerCafeId) renderCafeDiscounts(drawerCafeId);
  else renderCafeList();
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
function showScrim(hideTabbar) {
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add("show"));
  // the full-height drawer overlaps the toolbar's spot, so it hides it while open;
  // the settings sheet sits higher up and leaves the toolbar clear, so it stays put
  // and stays tappable — switching straight to another tab from Settings.
  if (hideTabbar && tabbarEl) tabbarEl.classList.add("is-hidden");
}
function maybeHideScrim() {
  const anyOpen = drawer.classList.contains("open") || (settingsSheet && settingsSheet.classList.contains("open"));
  if (!anyOpen) {
    scrim.classList.remove("show"); setTimeout(() => { scrim.hidden = true; }, 320);
    if (tabbarEl) tabbarEl.classList.remove("is-hidden");
  }
}

async function loadDiscounts() {
  try {
    const r = await fetch(API + "/api/collections/discounts/records?perPage=200&sort=-created&expand=cafe", { headers: { Authorization: token } });
    const data = await r.json();
    if (data && data.items) discounts = data.items.map(mapDiscount);
  } catch (_) {}
  updateBadges();
  renderDrawer();
}
async function openDrawer() {
  if (settingsSheet) closeSettings(true);
  showScrim(true);
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  setTab("discounts");
  drawerCafeId = null; // always start at the café list
  renderDrawer();
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
    const nEl = document.getElementById("setName"); if (nEl) nEl.textContent = nm || "—";
    const pEl = document.getElementById("setPhone"); if (pEl) pEl.textContent = formatPhone(localStorage.getItem("loytap_phone") || "");
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
  ["loytap_token", "loytap_owner", "loytap_staff", "loytap_role", "loytap_signed_in", "loytap_name", "loytap_cafe", "loytap_phone"]
    .forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
  location.replace("auth.html");
}

pocketBtn.addEventListener("click", openDrawer);
drawerClose.addEventListener("click", () => closeDrawer());
if (drawerBack) drawerBack.addEventListener("click", () => { drawerCafeId = null; renderDrawer(); });
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
  if (pendingReset) {
    // if the café changed its goal, the NEW card comes with the new number of
    // stamps; otherwise just wipe the current card clean
    if (pendingNextRequired && pendingNextRequired !== pendingReset.cfg.stamps) {
      rebuildCard(pendingReset, pendingNextRequired);
    } else {
      resetCard(pendingReset);
    }
    pendingReset = null; pendingNextRequired = 0;
  }
}

// rebuild the single card fresh with a new stamp goal (café changed its number)
function rebuildCard(deck, n) {
  const i = deck.index;
  const cfg = Object.assign({}, deck.cfg, { stamps: n, cols: Math.max(1, Math.ceil(n / 2)) });
  const mm = memberships.find((x) => x.cafeId === cfg.cafeId);
  if (mm) { mm.stampsRequired = n; mm.stamps = []; mm.stampCount = 0; }
  // swap just this card in place — the rest of the wallet stack stays put
  const fresh = buildCard(cfg, i);
  deck.el.replaceWith(fresh.el);
  decks[i] = fresh;
  const btn = fresh.stampBtn;
  if (btn) { btn.disabled = false; const lbl = btn.querySelector(".btn__label"); if (lbl) lbl.textContent = "Stamp"; }
  sizeConfetti();
  layout();
}
congratsContinue.addEventListener("click", hideCongrats);

const walletCloseBtn = document.getElementById("walletClose");
if (walletCloseBtn) walletCloseBtn.addEventListener("click", deselectCard);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!congrats.hidden) hideCongrats();
  else if (drawer.classList.contains("open")) closeDrawer();
  else if (selectedIndex != null) deselectCard();
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

// GET the signed-in customer's loyalty cards, one per café they've tapped into.
async function loadMemberships() {
  try {
    const r = await fetch(
      API + "/api/collections/memberships/records?perPage=100&sort=-updated&expand=cafe" +
      "&filter=" + encodeURIComponent(`(user='${myUserId}')`),
      { headers: { Authorization: token } }
    );
    const d = await r.json();
    memberships = ((d && d.items) || []).map((it) => {
      const c = (it.expand && it.expand.cafe) || {};
      return {
        id: it.id,
        cafeId: it.cafe,
        cafeName: c.cafe_name || "Café",
        tagline: c.tagline || "",
        accent: c.accent || "#171717",
        // an in-progress card keeps the goal locked onto it when it started; an
        // empty card (no stamps yet) isn't started, so it follows the café's
        // CURRENT number — a change takes effect right away on an empty card.
        stampsRequired: (Number(it.stamp_count) > 0 ? (it.card_required || c.stamps_required) : c.stamps_required) || 8,
        minPurchase: c.min_purchase || 0,
        theme: c.theme || "",
        stampCount: it.stamp_count || 0,
        cycles: it.cycles || 0,
        stamps: Array.isArray(it.stamps) ? it.stamps : [],
      };
    });
  } catch (_) { memberships = []; }
}

// the reward pool for ONE café — teased on that café's card ("win Free coffee · 20% OFF…")
async function loadRewardPool(cafeId) {
  try {
    const rr = await fetch(
      API + "/api/collections/reward_options/records?perPage=50&sort=-created" +
      "&filter=" + encodeURIComponent(`(active=true && cafe='${cafeId}')`)
    );
    const rd = await rr.json();
    rewardPool = ((rd && rd.items) || []).map((x) => x.deal).filter(Boolean);
  } catch (_) { rewardPool = []; }
}

// build + paint the wallet's card for one membership (its café, its saved stamps)
// Build the whole wallet — one card per café the customer has stamped at, stacked
// Apple-Wallet style (front card open, the rest peeking below).
function renderAllCards() {
  wallet.innerHTML = "";
  decks = [];
  selectedIndex = null;
  if (!memberships.length) { renderWalletEmpty(); return; }
  memberships.forEach((m, i) => {
    const deck = buildCard(cfgFromMembership(m), i);
    decks.push(deck);
    wallet.appendChild(deck.el);
    renderSaved(deck, m.stamps);
  });
  sizeConfetti();
  layout();
}

function renderWalletEmpty() {
  wallet.innerHTML = `
    <div class="wallet-empty">
      <p class="wallet-empty__title">No loyalty cards yet</p>
      <p class="wallet-empty__sub">Tap a café's card to start earning stamps.</p>
    </div>`;
}

async function init() {
  // signed-in user: refresh the session
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
  myUserId = user.id;
  try { if (user.phone) localStorage.setItem("loytap_phone", user.phone); } catch (_) {}

  const g = document.getElementById("greeting");
  if (g) g.textContent = `Welcome back, ${(user.name || "there").trim()} 👋`;

  await loadMemberships();

  // NFC tap: the card's URL carries the tag's secret code as ?t=<CODE>. If the
  // user had to sign in first, the code was stashed before the auth redirect and
  // is restored here (fresh taps only, consumed once). The server validates the
  // code, resolves which café it belongs to, and enforces the cooldown — the
  // client never decides whether it's a real tap or which café it's for.
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

  renderAllCards();
  // load the front card's reward pool so its teaser reads right
  if (decks[0]) { try { await loadRewardPool(decks[0].cfg.cafeId); updateTeaser(decks[0]); } catch (_) {} }
  // an NFC tap surfaces the right café's card (creating it on a first visit) and stamps it
  if (tapCode) setTimeout(() => handleTap(tapCode), decks.length ? 650 : 200);

  loadDiscounts(); // populate the Discounts tab badge + café list on load

  if (params.get("debugopen") === "discounts") {
    setTimeout(() => {
      openDrawer();
      if (params.get("autocafe") && memberships[0]) {
        setTimeout(() => { drawerCafeId = memberships[0].cafeId; renderDrawer(); }, 500);
      }
    }, 400);
  } // TEMP verification hook
}

window.addEventListener("resize", () => { if (decks.length) { sizeConfetti(); layout(); } });
init();
