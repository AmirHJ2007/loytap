/// <reference path="../pb_data/types.d.ts" />

// Clean marketing URL — the café-owner landing page (index.guard.js sends the
// reloy.ir / www.reloy.ir marketing hostname here when signed out) serves at
// /business instead of its literal filename, and the old /for-business.html
// path 301s to it so no existing link or bookmark breaks.
//
// NB: everything lives INSIDE the handler on purpose — pb_hooks handlers are
// re-evaluated in a pooled JSVM runtime that does NOT see this file's outer
// scope, so a module-level `const` reads back as "not defined" at request
// time (see headers.pb.js for the same note).

routerAdd("GET", "/business", (e) => {
  return e.fileFS($os.dirFS("pb_public"), "for-business.html");
});

routerAdd("GET", "/for-business.html", (e) => {
  return e.redirect(301, "/business");
});
