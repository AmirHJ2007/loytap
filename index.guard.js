// redirect to sign-in when the wallet has no session; stashes a ?t= tap code first.
// On the marketing hostnames (reloy.ir, www.reloy.ir) with no tap code, send
// anonymous visitors to the business site instead of the sign-in wall.
// app.reloy.ir (and every other host — localhost, the liara.run subdomain)
// keeps the old behaviour. NFC tags encode reloy.ir/?t=<code> and can't be
// reprogrammed, so a tap code always wins and still goes to auth.html.
try{if(localStorage.getItem('loytap_signed_in')!=='1'){var _t=new URLSearchParams(location.search).get('t');if(_t){localStorage.setItem('reloy_pending_tap',JSON.stringify({code:_t,at:Date.now()}));location.replace('auth.html');}else if(location.hostname==='reloy.ir'||location.hostname==='www.reloy.ir'){location.replace('for-business.html');}else{location.replace('auth.html');}}}catch(e){}
