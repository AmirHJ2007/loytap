/// <reference path="../pb_data/types.d.ts" />

// SEC-09 — global security response headers.
//
// PocketBase serves the API and the frontend from ONE origin (--publicDir), so a
// single global middleware covers both. routerUse() runs for every matched route,
// including the catch-all static-file route, so .html/.css/.js/.png get these too.
//
// Why a CSP at all: auth tokens live in localStorage. Without one, any injected
// script can read a live session and post it off-origin. `script-src 'self'` with
// no 'unsafe-inline' and no hashes is the wall; every page script is a real file.
//
// Audited 2026-09: no CDN, no Google Fonts (self-hosted under fonts/), no service
// worker, no Worker, no eval/new Function, no inline on*= handlers, no javascript:
// URLs, no iframes, no inline <script> blocks. The only absolute URLs anywhere are
// licence links in the vendored qrcode.js / jsQR.js comments plus the SVG namespace.
//
// NB: everything lives INSIDE the handler on purpose. pb_hooks handlers are
// re-evaluated in a pooled JSVM runtime that does NOT see this file's outer scope,
// so a module-level `const` reads back as "not defined" at request time.

routerUse(new Middleware((e) => {
  try {
    // TRADEOFF — style-src keeps 'unsafe-inline':
    //   analytics/owner/terms.html carry <style> blocks plus a few style="..."
    //   attributes. Inline STYLE cannot execute JS, so the residual risk is
    //   CSS-selector exfiltration / layout spoofing — orders of magnitude smaller
    //   than inline SCRIPT. Drop it once those blocks move into .css files.
    const csp = [
      "default-src 'self'",
      "script-src 'self'",                // no 'unsafe-inline', no hashes
      "style-src 'self' 'unsafe-inline'", // see TRADEOFF above
      "img-src 'self' data:",             // data: for the .grain background-image svg in styles.css
      "font-src 'self'",                  // fonts/*.woff2
      "connect-src 'self'",               // the API shares this origin
      "manifest-src 'self'",              // <link rel="manifest" href="manifest.json">
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    // explicit deny-list, not a blanket "*=()", so an unlisted feature keeps its
    // browser default instead of silently breaking later.
    //   camera=(self) — REQUIRED: staff.js calls getUserMedia({video:{facingMode:
    //     "environment"}}) to scan customer QR codes. Denying it kills stamping.
    //     audio is false there, so microphone stays denied.
    //   deliberately NOT denied: clipboard-write (owner.page.js copies the staff
    //     code) and vibrate (app.js haptics).
    const permissions = [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      "accelerometer=()",
      "gyroscope=()",
      "magnetometer=()",
      "display-capture=()",
      "encrypted-media=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "serial=()",
      "usb=()",
      "xr-spatial-tracking=()",
      "browsing-topics=()",
    ].join(", ");

    const h = e.response.header();

    // the superuser dashboard (/_/) ships its OWN CSP — it whitelists the
    // openstreetmap tile/geocode hosts for the geo picker — so leave that subtree
    // alone rather than overwrite it and break the dashboard.
    let path = "";
    try { path = e.request.url.path; } catch (_) { path = ""; }
    if (path !== "/_" && path.indexOf("/_/") !== 0) {
      // safety valve: CSP_REPORT_ONLY=1 reports without blocking. unset = enforce.
      h.set(
        $os.getenv("CSP_REPORT_ONLY") === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
        csp
      );
    }

    h.set("Referrer-Policy", "no-referrer");
    h.set("Permissions-Policy", permissions);

    // HSTS only when the connection really is https. TLS terminates at Liara's
    // edge, so trust the forwarded scheme; over plain http (localhost dev) we send
    // nothing, so a dev browser can never get wedged into https://localhost.
    // No `preload` on purpose — that is a one-way, apex-wide commitment; an
    // operator who wants it appends it here after submitting the domain.
    let proto = "";
    try { proto = String(e.request.header.get("X-Forwarded-Proto") || "").split(",")[0].trim().toLowerCase(); }
    catch (_) { proto = ""; }
    let tls = false;
    try { tls = e.isTLS(); } catch (_) { tls = false; }
    if (tls || proto === "https") {
      h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // X-Content-Type-Options and X-Frame-Options are PocketBase defaults and are
    // deliberately left untouched. frame-ancestors 'none' is the modern
    // replacement for X-Frame-Options, but Safari < 15.4 and older mobile browsers
    // honour only the legacy header — keeping both costs nothing and closes a gap.
  } catch (_) {
    // headers are best-effort: never let this middleware fail a request
  }

  return e.next();
}, -99999, "securityHeaders"));
