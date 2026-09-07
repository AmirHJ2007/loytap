// ===================================================================
// EN/FA toggle for the standalone legal docs (terms.html, business-terms.html).
// External file, not inline — this site's CSP is script-src 'self' with no
// 'unsafe-inline', so an inline <script> block here would be silently blocked.
// Reuses the app's own "loytap_lang" localStorage key so a visitor's language
// choice stays consistent if they move between these pages and the app.
// ===================================================================
(function () {
  var KEY = "loytap_lang";
  function getLang() {
    try { var v = localStorage.getItem(KEY); if (v === "en" || v === "fa") return v; } catch (e) {}
    return "fa";
  }
  function setLang(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
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
  document.querySelectorAll(".lang-switch__btn").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });
  apply(getLang());
})();
