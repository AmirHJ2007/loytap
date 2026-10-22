// card-pattern.js — the server's copy of the pattern rules.
//
// A plain .js, required INSIDE each handler: a helper declared beside a
// routerAdd is invisible to the handler at request time (see "PocketBase hook
// scope" in CLAUDE.md), and this one is needed by both owner.pb.js and
// card.pb.js.
//
// The table below is the whitelist, generated from card-patterns/registry.json
// — ONLY the facts the server needs to validate a choice. Not the file paths,
// not the Persian names, not the tile sizes: the browser owns how a pattern is
// drawn, the server owns whether it is a pattern at all. If a pattern is added
// to the kit, add its id here too, or saving it comes back as null.
//
// normalize() mirrors CardPatterns.normalize() in the browser. The client
// already calls it before sending; this runs again because a client is not a
// place to enforce anything.

var PATTERNS = {
  "beans":     { art: false, motifOnly: false, tileOnly: false, upright: false },
  "leaves":    { art: false, motifOnly: false, tileOnly: false, upright: false },
  "cups":      { art: false, motifOnly: false, tileOnly: false, upright: true  },
  "iced":      { art: false, motifOnly: false, tileOnly: false, upright: true  },
  "tamper":    { art: false, motifOnly: false, tileOnly: false, upright: false },
  "grinder":   { art: false, motifOnly: false, tileOnly: false, upright: true  },
  "espresso":  { art: false, motifOnly: true, tileOnly: false, upright: true  },
  "cutlery":   { art: false, motifOnly: false, tileOnly: false, upright: true  },
  "forkknife": { art: false, motifOnly: false, tileOnly: false, upright: false },
  "pizza":     { art: false, motifOnly: false, tileOnly: false, upright: false },
  "croissant": { art: false, motifOnly: false, tileOnly: false, upright: false },
  "burger":    { art: false, motifOnly: false, tileOnly: false, upright: false },
  "girih":     { art: false, motifOnly: false, tileOnly: false, upright: false },
  "lattice":   { art: false, motifOnly: false, tileOnly: false, upright: false },
  "brick":     { art: false, motifOnly: false, tileOnly: true, upright: false },
  "basket":    { art: false, motifOnly: false, tileOnly: true, upright: false },
  "moon":      { art: false, motifOnly: false, tileOnly: false, upright: false },
  "stars":     { art: false, motifOnly: false, tileOnly: true, upright: false },
  "saturn":    { art: false, motifOnly: false, tileOnly: false, upright: false },
  "flow":      { art: true, motifOnly: false, tileOnly: false, upright: false },
  "stripes":   { art: true, motifOnly: false, tileOnly: false, upright: false },
  "arcs":      { art: true, motifOnly: false, tileOnly: false, upright: false },
  "waves":     { art: false, motifOnly: false, tileOnly: false, upright: false },
  "dots":      { art: false, motifOnly: false, tileOnly: false, upright: false },
  "tree":      { art: false, motifOnly: true, tileOnly: false, upright: true  },
  "sea":       { art: false, motifOnly: false, tileOnly: false, upright: true  },
  "flower":    { art: false, motifOnly: false, tileOnly: false, upright: false },
};

var FADES = ["none", "top", "corner"];
var PLACES = ["top", "bottom"];
var UPRIGHT_PLACES = ["bottom", "center"];
var MIN_STRENGTH = 4, MAX_STRENGTH = 40, DEFAULT_STRENGTH = 12;

// Which layout a pattern actually supports, regardless of what was asked for.
function layoutFor(p, wanted) {
  if (p.art) return "art";
  if (p.motifOnly) return "motif";
  if (p.tileOnly) return "tile";
  return wanted === "motif" ? "motif" : "tile";
}

// Anything in, a valid config or null out. null means "no pattern", which is
// also what every café that never chose one stores.
function normalize(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  var p = PATTERNS[cfg.pattern];
  if (!p) return null;

  var layout = layoutFor(p, cfg.layout);

  var s = Math.round(Number(cfg.strength));
  if (!isFinite(s)) s = DEFAULT_STRENGTH;
  if (s < MIN_STRENGTH) s = MIN_STRENGTH;
  if (s > MAX_STRENGTH) s = MAX_STRENGTH;

  var out = { pattern: cfg.pattern, layout: layout, strength: s };
  if (layout === "tile") {
    out.fade = FADES.indexOf(cfg.fade) >= 0 ? cfg.fade : "none";
  }
  if (layout === "motif") {
    var places = p.upright ? UPRIGHT_PLACES : PLACES;
    out.place = places.indexOf(cfg.place) >= 0 ? cfg.place : "bottom";
  }
  return out;
}

// What a card record hands back to a client.
//
// A JSONField does NOT arrive as a JS object. PocketBase stores it as
// types.JSONRaw and goja presents that as a BYTE ARRAY: typeof is "object",
// Array.isArray is true, property access gives undefined, and JSON.stringify
// returns [123,34,102,...]. Only String() turns it back into JSON text. So
// everything is funnelled through text and parsed, which also covers a row
// written by hand in the dashboard as a plain string.
//
// Then through normalize() on the way out as well as the way in: a pattern id
// that is retired later must not reach a client as something it cannot draw.
function read(rec) {
  var raw;
  try { raw = rec.get("pattern"); } catch (err) { return null; }
  if (raw === null || typeof raw === "undefined") return null;

  // the one case that is already an object (a value set earlier in this same
  // request, before the record was reloaded)
  if (typeof raw === "object" && !Array.isArray(raw) && typeof raw.pattern === "string") {
    return normalize(raw);
  }

  var txt = String(raw).trim();
  if (!txt || txt === "null" || txt === "[object Object]") return null;
  var obj;
  try { obj = JSON.parse(txt); } catch (err) { return null; }
  return normalize(obj);
}

module.exports = { normalize: normalize, read: read, PATTERNS: PATTERNS };
