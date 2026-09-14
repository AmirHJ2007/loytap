// ===================================================================
// EN/FA toggle for the standalone legal docs (terms.html, business-terms.html).
// External file, not inline — this site's CSP is script-src 'self' with no
// 'unsafe-inline', so an inline <script> block here would be silently blocked.
// Reuses the app's own "loytap_lang" localStorage key so a visitor's language
// choice stays consistent if they move between these pages and the app.
// ===================================================================
(function () {
  var KEY = "loytap_lang";
  // The URL is the authority: /fa/terms and /en/terms are separate pages so each
  // translation can be indexed and linked to. localStorage only decides for a
  // visitor who arrives without a prefix.
  function langFromPath() {
    var m = location.pathname.match(/^\/(fa|en)(\/|$)/);
    return m ? m[1] : null;
  }
  function getLang() {
    var fromPath = langFromPath();
    if (fromPath) {
      try { localStorage.setItem(KEY, fromPath); } catch (e) {}
      return fromPath;
    }
    try { var v = localStorage.getItem(KEY); if (v === "en" || v === "fa") return v; } catch (e) {}
    return "fa";
  }
  function setLang(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    // on a language-pathed page the switch navigates, so the URL keeps matching
    // what is on screen and stays shareable
    if (langFromPath()) {
      location.href = location.pathname.replace(/^\/(fa|en)/, "/" + lang) +
                      location.search + location.hash;
      return;
    }
    apply(lang);
  }
  function apply(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    document.getElementById("docEn").hidden = lang !== "en";
    document.getElementById("docFa").hidden = lang !== "fa";
    document.querySelectorAll(".lang-switch__btn").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.lang === lang);
    });
  }
  // Both language paths receive identical HTML, so the page names its own
  // canonical URL; a static one would be wrong for whichever path it is not.
  // Links to the other translated pages must carry the language prefix, or the
  // bare path redirects an English reader onto the Persian copy.
  (function localiseLinks() {
    var lang = langFromPath();
    if (!lang) return;
    var translated = /^\/(business|terms|business-terms)(\?|#|$)/;
    document.querySelectorAll('a[href^="/"]').forEach(function (a) {
      var href = a.getAttribute("href");
      if (!translated.test(href)) return;
      a.setAttribute("href", "/" + lang + href);
    });
  })();

  (function canonical() {
    if (!langFromPath()) return;
    var link = document.querySelector('link[rel="canonical"]') || document.createElement("link");
    link.rel = "canonical";
    link.href = location.origin + location.pathname;
    if (!link.parentNode) document.head.appendChild(link);
  })();

  document.querySelectorAll(".lang-switch__btn").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });
  apply(getLang());
})();
