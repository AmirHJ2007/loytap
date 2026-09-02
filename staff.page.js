// ===================================================================
// Reloy — staff page chrome: café name in the header + sign-out.
// Moved out of staff.html verbatim so the page needs no inline script.
// ===================================================================
    try {
      var cn = localStorage.getItem("loytap_cafe");
      if (cn) document.getElementById("cafeName").textContent = cn;
    } catch (e) {}
    document.getElementById("signoutBtn").addEventListener("click", function () {
      ["loytap_token","loytap_staff","loytap_owner","loytap_role","loytap_signed_in","loytap_name","loytap_cafe"]
        .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      location.replace("auth.html");
    });
