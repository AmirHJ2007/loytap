// redirect to sign-in when there is no owner session.
try{if(localStorage.getItem('loytap_owner')!=='1')location.replace('auth.html');}catch(e){}
