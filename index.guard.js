// redirect to sign-in when the wallet has no session; stashes a ?t= tap code first.
try{if(localStorage.getItem('loytap_signed_in')!=='1'){var _t=new URLSearchParams(location.search).get('t');if(_t)localStorage.setItem('reloy_pending_tap',JSON.stringify({code:_t,at:Date.now()}));location.replace('auth.html');}}catch(e){}
