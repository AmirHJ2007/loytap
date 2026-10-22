// card-patterns/patterns.js — background patterns for the loyalty card.
// Classic script (no modules), same style as the rest of the app. Exposes window.CardPatterns.
//
// A café's saved choice is a small object, stored on the card record next to `accent`:
//   { pattern: "girih", layout: "tile", fade: "corner", strength: 12 }        // repeating
//   { pattern: "espresso", layout: "motif", place: "bottom", strength: 12 }   // one big drawing
//   null                                                                       // no pattern (default)
//
// Every drawing is a single-colour alpha mask. The colour comes from CSS (white at
// `strength` %), so one file works on every card colour.
(function () {
  "use strict";
  var BASE = "/card-patterns/";

  var LIST = [
  {
    "id": "beans",
    "name": "دانهٔ قهوه",
    "group": "کافه",
    "tile": "patterns/beans-tile.png",
    "motif": "patterns/beans.png",
    "size": 80
  },
  {
    "id": "leaves",
    "name": "برگ",
    "group": "کافه",
    "tile": "patterns/leaves-tile.png",
    "motif": "patterns/leaves.png",
    "size": 76
  },
  {
    "id": "cups",
    "name": "فنجان",
    "group": "کافه",
    "tile": "patterns/cups-tile.png",
    "motif": "patterns/cups.png",
    "size": 76,
    "upright": true,
    "drop": "-22%"
  },
  {
    "id": "iced",
    "name": "قهوه سرد",
    "group": "کافه",
    "tile": "patterns/iced-tile.png",
    "motif": "patterns/iced.png",
    "size": 72,
    "upright": true,
    "drop": "-36%"
  },
  {
    "id": "tamper",
    "name": "تمپر",
    "group": "کافه",
    "tile": "patterns/tamper-tile.png",
    "motif": "patterns/tamper.png",
    "size": 72
  },
  {
    "id": "grinder",
    "name": "آسیاب",
    "group": "کافه",
    "tile": "patterns/grinder-tile.png",
    "motif": "patterns/grinder.png",
    "size": 72,
    "upright": true,
    "drop": "-38%"
  },
  {
    "id": "espresso",
    "name": "دستگاه قهوه",
    "group": "کافه",
    "motif": "patterns/espresso.png",
    "upright": true,
    "motifOnly": true
  },
  {
    "id": "cutlery",
    "name": "قاشق و چنگال",
    "group": "رستوران",
    "tile": "patterns/cutlery-tile.png",
    "motif": "patterns/cutlery.png",
    "size": 72,
    "upright": true,
    "drop": "-34%"
  },
  {
    "id": "forkknife",
    "name": "چنگال و کارد",
    "group": "رستوران",
    "tile": "patterns/forkknife-tile.png",
    "motif": "patterns/forkknife.png",
    "size": 72
  },
  {
    "id": "pizza",
    "name": "پیتزا",
    "group": "رستوران",
    "tile": "patterns/pizza-tile.png",
    "motif": "patterns/pizza.png",
    "size": 74
  },
  {
    "id": "croissant",
    "name": "کروسان",
    "group": "رستوران",
    "tile": "patterns/croissant-tile.png",
    "motif": "patterns/croissant.png",
    "size": 88
  },
  {
    "id": "burger",
    "name": "همبرگر",
    "group": "رستوران",
    "tile": "patterns/burger-tile.png",
    "motif": "patterns/burger.png",
    "size": 76
  },
  {
    "id": "girih",
    "name": "گره‌چینی",
    "group": "ایرانی",
    "tile": "patterns/girih-tile.svg",
    "motif": "patterns/girih.svg",
    "size": 54
  },
  {
    "id": "lattice",
    "name": "کاشی",
    "group": "ایرانی",
    "tile": "patterns/lattice-tile.svg",
    "motif": "patterns/lattice.svg",
    "size": 46
  },
  {
    "id": "brick",
    "name": "آجری",
    "group": "ایرانی",
    "tile": "patterns/brick-tile.svg",
    "size": 60,
    "tileOnly": true
  },
  {
    "id": "basket",
    "name": "آجر حصیری",
    "group": "ایرانی",
    "tile": "patterns/basket-tile.svg",
    "size": 64,
    "tileOnly": true
  },
  {
    "id": "moon",
    "name": "ماه",
    "group": "آسمان",
    "tile": "patterns/moon-tile.png",
    "motif": "patterns/moon.png",
    "size": 70
  },
  {
    "id": "stars",
    "name": "آسمان پرستاره",
    "group": "آسمان",
    "tile": "patterns/stars-tile.svg",
    "size": 190,
    "tileOnly": true
  },
  {
    "id": "saturn",
    "name": "زحل",
    "group": "آسمان",
    "tile": "patterns/saturn-tile.png",
    "motif": "patterns/saturn.png",
    "size": 96
  },
  {
    "id": "flow",
    "name": "جریان",
    "group": "خط و نقش",
    "art": "patterns/flow.svg"
  },
  {
    "id": "stripes",
    "name": "نوار",
    "group": "خط و نقش",
    "art": "patterns/stripes.svg"
  },
  {
    "id": "arcs",
    "name": "قوس",
    "group": "خط و نقش",
    "art": "patterns/arcs.svg"
  },
  {
    "id": "waves",
    "name": "موج",
    "group": "خط و نقش",
    "tile": "patterns/waves-tile.svg",
    "motif": "patterns/waves.svg",
    "size": 40
  },
  {
    "id": "dots",
    "name": "نقطه",
    "group": "خط و نقش",
    "tile": "patterns/dots-tile.svg",
    "motif": "patterns/dots.svg",
    "size": 26
  },
  {
    "id": "tree",
    "name": "درخت",
    "group": "طبیعت",
    "motif": "patterns/tree.png",
    "upright": true,
    "drop": "-36%",
    "motifOnly": true
  },
  {
    "id": "sea",
    "name": "موج دریا",
    "group": "طبیعت",
    "tile": "patterns/sea-tile.png",
    "motif": "patterns/sea.png",
    "size": 96,
    "upright": true,
    "drop": "-22%"
  },
  {
    "id": "flower",
    "name": "گل",
    "group": "طبیعت",
    "tile": "patterns/flower-tile.png",
    "motif": "patterns/flower.png",
    "size": 78
  }
];

  var BY_ID = {};
  LIST.forEach(function (p) { BY_ID[p.id] = p; });

  var GROUPS = [];
  LIST.forEach(function (p) { if (GROUPS.indexOf(p.group) < 0) GROUPS.push(p.group); });

  var FADES = ["none", "top", "corner"];            // tile layout only
  var PLACES = ["top", "bottom"];                   // motif layout, normal drawings
  var UPRIGHT_PLACES = ["bottom", "center"];        // motif layout, drawings that stand on their feet
  var MIN_STRENGTH = 4, MAX_STRENGTH = 22, DEFAULT_STRENGTH = 12;

  // Which layout a pattern actually uses: "art" fills the whole card, some are motif-only
  // or tile-only, the rest follow the café's choice.
  function layoutFor(p, wanted) {
    if (!p) return null;
    if (p.art) return "art";
    if (p.motifOnly) return "motif";
    if (p.tileOnly) return "tile";
    return wanted === "motif" ? "motif" : "tile";
  }

  // Turn anything (saved JSON, form state, old/garbage data) into a valid config or null.
  // Use the same rules on the server before saving.
  function normalize(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    var p = BY_ID[cfg.pattern];
    if (!p) return null;
    var layout = layoutFor(p, cfg.layout);
    var s = Math.round(Number(cfg.strength));
    if (!isFinite(s)) s = DEFAULT_STRENGTH;
    var out = { pattern: p.id, layout: layout, strength: Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, s)) };
    if (layout === "tile") out.fade = FADES.indexOf(cfg.fade) >= 0 ? cfg.fade : "none";
    if (layout === "motif") {
      var places = p.upright ? UPRIGHT_PLACES : PLACES;
      out.place = places.indexOf(cfg.place) >= 0 ? cfg.place : (p.upright ? "bottom" : "bottom");
    }
    return out;
  }

  function fileFor(p, layout) {
    if (layout === "art") return p.art;
    if (layout === "motif") return p.motif;
    return p.tile;
  }

  function setMask(el, url, size, repeat) {
    var u = 'url("' + url + '")';
    el.style.webkitMaskImage = u; el.style.maskImage = u;
    el.style.webkitMaskSize = size; el.style.maskSize = size;
    el.style.webkitMaskRepeat = repeat; el.style.maskRepeat = repeat;
  }

  // Paint (or clear) the pattern layer on a card face (the `.face` element).
  // Safe to call repeatedly, e.g. on every change in the designer.
  function apply(faceEl, cfg) {
    if (!faceEl) return;
    var layer = faceEl.querySelector(":scope > .pattern");
    var c = normalize(cfg);
    if (!c) { if (layer) layer.remove(); return; }
    var p = BY_ID[c.pattern];
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "pattern";
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML = '<div class="pattern__ink"></div>';
      faceEl.insertBefore(layer, faceEl.firstChild);
    }
    layer.dataset.layout = c.layout;
    layer.dataset.fade = c.fade || "none";
    layer.dataset.place = c.place || "bottom";
    layer.dataset.upright = p.upright ? "1" : "0";
    layer.style.setProperty("--pat-strength", (c.strength / 100).toFixed(2));
    if (p.drop) layer.style.setProperty("--drop", p.drop); else layer.style.removeProperty("--drop");
    var ink = layer.firstElementChild;
    var url = BASE + fileFor(p, c.layout);
    if (c.layout === "tile") setMask(ink, url, p.size + "px " + p.size + "px", "repeat");
    else if (c.layout === "art") setMask(ink, url, "100% 100%", "no-repeat");
    else setMask(ink, url, "contain", "no-repeat");
  }

  // Thumbnail for a picker button: paints pattern `id` into `el` (give el a background
  // colour + overflow:hidden; the mask is drawn by a child span).
  function swatch(el, id, wantedLayout) {
    var p = BY_ID[id];
    var ink = el.querySelector(".pattern-swatch__ink");
    if (!ink) { ink = document.createElement("span"); ink.className = "pattern-swatch__ink"; el.appendChild(ink); }
    if (!p) { ink.style.display = "none"; return; }
    ink.style.display = "";
    var layout = layoutFor(p, wantedLayout);
    var url = BASE + fileFor(p, layout);
    if (layout === "tile") { ink.style.inset = "0"; setMask(ink, url, Math.round(p.size * 0.55) + "px", "repeat"); }
    else if (layout === "art") { ink.style.inset = "0"; setMask(ink, url, "100% 100%", "no-repeat"); }
    else { ink.style.inset = "12%"; setMask(ink, url, "contain", "no-repeat"); }
  }

  window.CardPatterns = {
    list: LIST, byId: BY_ID, groups: GROUPS,
    FADES: FADES, PLACES: PLACES, UPRIGHT_PLACES: UPRIGHT_PLACES,
    MIN_STRENGTH: MIN_STRENGTH, MAX_STRENGTH: MAX_STRENGTH, DEFAULT_STRENGTH: DEFAULT_STRENGTH,
    layoutFor: layoutFor, normalize: normalize, apply: apply, swatch: swatch,
  };
})();
