// redirect to sign-in when the wallet has no session; stashes a ?t= tap code first.
// On the marketing hostnames (reloy.ir, www.reloy.ir) with no tap code, send
// anonymous visitors to the business site instead of the sign-in wall.
// app.reloy.ir (and every other host — localhost, the liara.run subdomain)
// keeps the old behaviour. NFC tags encode reloy.ir/?t=<code> and can't be
// reprogrammed, so a tap code always wins and still goes to /signin.
//
// A signed-in owner or staff member landing here is NOT signed out: only the
// customer wallet sets loytap_signed_in (auth.js), while business.js sets
// loytap_owner / loytap_staff, so without the two branches below a live
// business session read as "anonymous" and got thrown at the sign-in wall.
// They stay behind the tap-code branch on purpose — tapping an NFC tag is a
// customer action, and a staff member who taps one wants their own card.
//
// !! THE INSTALLED CUSTOMER APP IS NEVER MARKETING TRAFFIC.
// manifest.json launches at /?app=1, and a launch in standalone display mode is
// the same signal by another route. Both mean a customer tapped their own home
// screen icon, so an anonymous one belongs at /signin — the page that can give
// them a session — and never at /business, which is the pitch for café owners.
//
// This was the bug: the icon is installed from reloy.ir (the hostname on the
// NFC tags and the one people type), so every anonymous launch matched the
// marketing branch below and opened the onboarding site. It hit signed-in
// customers too, because iOS gives a home-screen web app its own localStorage
// jar — loytap_signed_in, written while they were in Safari, simply is not
// there when the installed app reads it, so it looks anonymous every time.
try {
  if (localStorage.getItem('loytap_signed_in') !== '1') {
    var _q = new URLSearchParams(location.search);
    var _t = _q.get('t');
    // ?app=1 covers the launch itself; display-mode/navigator.standalone keep it
    // true after an in-app navigation has dropped the query string.
    var _app = _q.get('app') === '1' ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;

    if (_t) {
      localStorage.setItem('reloy_pending_tap', JSON.stringify({ code: _t, at: Date.now() }));
      location.replace('/signin');
    } else if (localStorage.getItem('loytap_owner') === '1') {
      location.replace('/owner');
    } else if (localStorage.getItem('loytap_staff') === '1') {
      location.replace('/staff');
    } else if (!_app && (location.hostname === 'reloy.ir' || location.hostname === 'www.reloy.ir')) {
      location.replace('/business');
    } else {
      location.replace('/signin');
    }
  }
} catch (e) {}
