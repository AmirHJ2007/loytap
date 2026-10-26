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
// Audited 2026-10: no CDN, no Google Fonts (self-hosted under fonts/), no service
// worker, no Worker, no eval/new Function, no inline on*= handlers, no javascript:
// URLs, no iframes.
//
// ONE inline <script> now exists: the application/ld+json structured-data block in
// for-business.html. It is deliberately NOT whitelisted and needs no hash. A script
// element whose type is not a JavaScript MIME type is never "prepared for
// execution", and CSP's script-src check happens only at that step — so the block
// is inert data the parser hands to crawlers, and script-src 'self' still means no
// executable inline script anywhere. Verified in Chrome against this exact CSP: a
// tracked reload of /fa/business reports zero violations. If you ever add a REAL
// inline <script>, it will be blocked, and that is correct — move it to a file.
//
// Absolute URLs: licence links in the vendored qrcode.js / jsQR.js comments, the SVG
// namespace, and the https://reloy.ir/... values in for-business.html's og:/twitter:
// meta and JSON-LD. Those last are strings read by crawlers, never fetched by the
// browser, so no directive governs them.
//
// NB: everything lives INSIDE the handler on purpose. pb_hooks handlers are
// re-evaluated in a pooled JSVM runtime that does NOT see this file's outer scope,
// so a module-level `const` reads back as "not defined" at request time.

routerUse(new Middleware((e) => {
  try {
    // TRADEOFF — style-src keeps 'unsafe-inline':
    //   owner/terms.html carry <style> blocks plus a few style="..."
    //   attributes. Inline STYLE cannot execute JS, so the residual risk is
    //   CSS-selector exfiltration / layout spoofing — orders of magnitude smaller
    //   than inline SCRIPT. Drop it once those blocks move into .css files.
    const csp = [
      "default-src 'self'",
      "script-src 'self'",                // no 'unsafe-inline', no hashes
      "style-src 'self' 'unsafe-inline'", // see TRADEOFF above
      // data: for the .grain background-image svg in styles.css.
      // trustseal.enamad.ir serves the Enamad badge in the /business footer —
      // without it the badge is blocked and vanishes with no visible error,
      // which reads to Enamad as a missing seal.
      "img-src 'self' data: https://trustseal.enamad.ir",
      "font-src 'self'",                  // fonts/*.woff2
      "connect-src 'self'",               // the API shares this origin
      // sw.js, for staff push notifications. Same-origin workers would be
      // allowed anyway by the worker-src -> child-src -> script-src fallback,
      // but spelling it out means a later tightening of script-src cannot
      // disable every till's notifications as a side effect.
      "worker-src 'self'",
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

    // Pages must revalidate; their assets must not.
    //
    // Nothing here sends Cache-Control, so a browser invents its own freshness
    // window from Last-Modified — and a wallet added to the home screen
    // resumes rather than reloads, with no service worker to update it and no
    // reload button to press. The effect is that a customer can keep running
    // a build from hours ago while the fix is already deployed, and nobody can
    // tell which one they have.
    //
    // "no-cache" does not mean "do not store": the copy is kept and
    // revalidated, so an unchanged page costs a 304 and no body. Only the
    // entry points need it — every script and stylesheet is already requested
    // with a ?v= that changes when its content does, and the images, fonts and
    // pattern masks are content-addressed by name.
    //
    // Decided by path, because this runs BEFORE the handler that would set the
    // content type: a clean URL has no extension in its last segment (/, /owner,
    // /fa/business), and the literal files end in .html. The API and the
    // superuser dashboard are left alone.
    if (path.indexOf("/api/") !== 0 && path !== "/_" && path.indexOf("/_/") !== 0) {
      const seg = path.slice(path.lastIndexOf("/") + 1);
      if (seg === "" || seg.indexOf(".") < 0 || /\.html$/.test(seg)) {
        h.set("Cache-Control", "no-cache");
      }
    }

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
