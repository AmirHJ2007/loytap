// redirect to sign-in when there is no staff session.
try{if(localStorage.getItem("loytap_staff")!=="1")location.replace("auth.html");}catch(e){}
