/// <reference path="../pb_data/types.d.ts" />

// Serves for-business.html with the live subscription price substituted in.
//
// WHY SERVER-SIDE AND NOT JUST JAVASCRIPT. for-business.js already paints
// every visible price from its own config, so the visitor-facing numbers were
// never the problem. The problem is the application/ld+json block: Google and
// the AI crawlers read `offers[].price` out of the HTML as delivered, and a
// price injected by a script afterwards is not reliably there when they look.
// A page that advertises one price in its structured data and charges another
// at the gateway is the one failure mode worth a render step.
//
// HOW. The file on disk carries {{TOKEN}} placeholders; this replaces them
// with the platform_settings figures and hands back a string. The page is
// otherwise untouched — same file, same assets, same CSP (headers.pb.js runs
// as global middleware, so a generated response gets exactly the headers a
// static one would).
//
// FALLS BACK TO THE FILE. render() returning null means "serve it the old
// way" — the file could not be read, or came back empty. The caller then
// hands off to e.fileFS and the visitor still gets the page, with whatever
// numbers are baked into it. A marketing page that 500s costs more than one
// quoting last month's price.
//
// AN UNSUBSTITUTED TOKEN IS VISIBLE ON PURPOSE. There is no cleverness that
// turns {{PRICE_MONTHLY}} back into a number if this file and the HTML ever
// disagree about a token's name. It renders literally, which is ugly and
// immediately noticed — the alternative, silently stripping unknown tokens,
// would ship a plan card with a blank price and look like a styling bug.

// 3000000 -> "3,000,000". Western digits with thousands separators, in both
// languages: Persian copy here uses 0-9, never ۰-۹ (see i18n.js).
function group(n) {
  const s = String(Math.max(0, Math.round(Number(n) || 0)));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

// How many months the yearly price waives against paying monthly all year.
// Derived rather than written down, the same way for-business.js and the
// owner's buy screen derive it — a hardcoded "2 months free" starts lying the
// first time a price moves, which is precisely what /hq makes easy.
function monthsFree(p) {
  if (!p.monthly || !p.yearly) return 0;
  return Math.round((p.monthly * 12 - p.yearly) / p.monthly);
}

// The substituted page, or null if it could not be built.
function render(filename) {
  const dir = $os.getenv("PB_PUBLIC_DIR") || "pb_public";
  let html = "";
  try {
    // maxBytes passed explicitly: the default cap is generous but this page is
    // ~100KB today and growing, and a silently truncated marketing page is a
    // worse failure than no substitution at all.
    html = toString($os.dirFS(dir).readFile(filename), 4000000);
  } catch (err) {
    $app.logger().warn("marketing page could not be read for substitution",
      "file", filename, "error", String(err));
    return null;
  }
  if (!html) return null;

  const p = require(`${__hooks}/settings.js`).prices();
  const tokens = {
    "{{PRICE_MONTHLY}}": String(p.monthly),
    "{{PRICE_YEARLY}}": String(p.yearly),
    "{{PRICE_MONTHLY_FMT}}": group(p.monthly),
    "{{PRICE_YEARLY_FMT}}": group(p.yearly),
    "{{PRICE_YEARLY_WAS_FMT}}": group(p.monthly * 12),
    "{{MONTHS_FREE}}": String(monthsFree(p)),
  };
  for (const k in tokens) {
    html = html.split(k).join(tokens[k]);
  }
  return html;
}

// Serve it, with an ETag so this costs no more than the static file did.
//
// headers.pb.js already sets Cache-Control: no-cache on this path, meaning
// "keep a copy but revalidate". Revalidation only saves the 100KB body if the
// response carries a validator, and e.fileFS got one for free from the file's
// modification time. A generated string has none, so without this every
// revalidation would re-download the whole page — the substitution would have
// quietly made the site heavier. The hash covers the rendered output, so it
// changes when the file changes AND when the price does.
function serve(e, filename) {
  const html = render(filename);
  if (html === null) {
    return e.fileFS($os.dirFS($os.getenv("PB_PUBLIC_DIR") || "pb_public"), filename);
  }

  let tag = "";
  try { tag = '"' + $security.md5(html) + '"'; } catch (err) { tag = ""; }
  if (tag) {
    let seen = "";
    try { seen = String(e.request.header.get("If-None-Match") || ""); } catch (err) { seen = ""; }
    e.response.header().set("ETag", tag);
    // A browser may send several candidates, or W/-prefixed ones; a substring
    // test accepts those without parsing the grammar. Over-matching here can
    // only serve a 304 for a page the client genuinely holds.
    if (seen && seen.indexOf(tag.slice(1, -1)) >= 0) {
      return e.noContent(304);
    }
  }
  return e.html(200, html);
}

module.exports = { render, serve, group, monthsFree };
