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
try{if(localStorage.getItem('loytap_signed_in')!=='1'){var _t=new URLSearchParams(location.search).get('t');if(_t){localStorage.setItem('reloy_pending_tap',JSON.stringify({code:_t,at:Date.now()}));location.replace('/signin');}else if(localStorage.getItem('loytap_owner')==='1'){location.replace('/owner');}else if(localStorage.getItem('loytap_staff')==='1'){location.replace('/staff');}else if(location.hostname==='reloy.ir'||location.hostname==='www.reloy.ir'){location.replace('/business');}else{location.replace('/signin');}}}catch(e){}
