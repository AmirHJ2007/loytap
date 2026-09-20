// No staff session? Back to the sign-in page that can actually mint one.
// /business/signin rather than the customer OTP page at /signin — see
// owner.guard.js for why signing in at the wrong one loops forever.
try{if(localStorage.getItem("loytap_staff")!=="1")location.replace("/business/signin");}catch(e){}
