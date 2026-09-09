/// <reference path="../pb_data/types.d.ts" />

// Clean URLs — every page in pb_public is a literal .html file on disk, but
// nobody should have to type (or see) the extension. Each route below serves
// a page's file at a short path, and the old literal-.html path 301s to it so
// no existing link, bookmark, or NFC tag breaks.
//
// The café-owner landing page (index.guard.js sends the reloy.ir / www.reloy.ir
// marketing hostname here when signed out) is the oldest of these and keeps its
// own /business name rather than /for-business — everything else below just
// drops the .html suffix.
//
// NB: everything lives INSIDE each handler on purpose — pb_hooks handlers are
// re-evaluated in a pooled JSVM runtime that does NOT see this file's outer
// scope, so a module-level `const` reads back as "not defined" at request
// time (see headers.pb.js for the same note).

routerAdd("GET", "/business", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "for-business.html");
});

routerAdd("GET", "/for-business.html", (e) => {
  return e.redirect(301, "/business");
});

routerAdd("GET", "/signin", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "auth.html");
});

routerAdd("GET", "/auth.html", (e) => {
  return e.redirect(301, "/signin");
});

// business.html is the separate staff/owner sign-in + registration flow
// linked from the customer /signin page's "businessLink".
routerAdd("GET", "/business/signin", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "business.html");
});

routerAdd("GET", "/business.html", (e) => {
  return e.redirect(301, "/business/signin");
});

routerAdd("GET", "/owner", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "owner.html");
});

routerAdd("GET", "/owner.html", (e) => {
  return e.redirect(301, "/owner");
});

routerAdd("GET", "/staff", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "staff.html");
});

routerAdd("GET", "/staff.html", (e) => {
  return e.redirect(301, "/staff");
});

routerAdd("GET", "/analytics", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "analytics.html");
});

routerAdd("GET", "/analytics.html", (e) => {
  return e.redirect(301, "/analytics");
});

routerAdd("GET", "/terms", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "terms.html");
});

routerAdd("GET", "/terms.html", (e) => {
  return e.redirect(301, "/terms");
});

routerAdd("GET", "/business-terms", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "business-terms.html");
});

routerAdd("GET", "/business-terms.html", (e) => {
  return e.redirect(301, "/business-terms");
});

// index.html is already served at "/" by PocketBase's static file server —
// no route needed there — but the literal path still 301s for anyone who
// has it bookmarked or linked.
routerAdd("GET", "/index.html", (e) => {
  return e.redirect(301, "/");
});
