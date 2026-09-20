// No owner session? Back to the sign-in page that can actually mint one.
//
// /business/signin, NOT /signin: the latter is the customer OTP page, and an
// owner who signs in there gets a *customer* session (loytap_signed_in, no
// loytap_owner) and lands in the wallet — so the owner icon bounces them right
// back here next launch, however many times they sign in. See business.html.
try{if(localStorage.getItem('loytap_owner')!=='1')location.replace('/business/signin');}catch(e){}
