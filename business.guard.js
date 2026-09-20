// Send an already-signed-in business user straight to their own dashboard.
//
// This page is the start_url of manifest-business.json, so it is where a
// home-screen icon installed from the owner/staff sign-in flow lands on every
// launch. Without this, that icon always showed the sign-in form — even with a
// live session sitting in localStorage — and signing in again only ever got
// you one session-worth of dashboard before the next launch asked again.
//
// Runs in <head>, before the form paints, so there is no flash of a sign-in
// screen nobody needed to see. Owner wins over staff: business.js sets exactly
// one of the two on login, but an owner who once signed in as their own staff
// on the same device would still have the stale staff flag lying around.
//
// No trap for someone who genuinely wants to switch accounts: both dashboards
// carry a sign-out button, which clears these flags and returns here.
try {
  if (localStorage.getItem("loytap_owner") === "1") location.replace("/owner");
  else if (localStorage.getItem("loytap_staff") === "1") location.replace("/staff");
} catch (e) {}
