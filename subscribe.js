/* Insights email signup. Off until SUBSCRIBE_LIVE is true (set it after the Brevo list and INSIGHTS_LIST_ID exist). */
(function(){
  var SUBSCRIBE_LIVE=false,ENDPOINT="https://clarity-report.leadwithfx.workers.dev",SITEKEY="0x4AAAAAAGAMYCBCD8b1_hAY";
  var box=document.getElementById("subscribe"),f=document.getElementById("sub-form");
  if(!box||!f||!SUBSCRIBE_LIVE)return;
  box.hidden=false;
  var msg=document.getElementById("sub-msg"),tok="",id=null,loaded=false;
  function draw(){if(id===null&&window.turnstile)id=window.turnstile.render("#sub-ts",{sitekey:SITEKEY,callback:function(t){tok=t},"expired-callback":function(){tok=""},"error-callback":function(){tok=""}})}
  function load(){if(loaded)return;loaded=true;if(window.turnstile)return draw();var s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";s.async=true;s.onload=draw;document.head.appendChild(s)}
  f.addEventListener("focusin",load);
  f.addEventListener("submit",function(e){
    e.preventDefault();
    var em=document.getElementById("sub-email").value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){msg.textContent="Please enter a valid email address.";return}
    if(!document.getElementById("sub-ok").checked){msg.textContent="Please tick the box to agree to receive emails.";return}
    if(!tok){msg.textContent="Please wait for the security check to finish, then try again.";load();return}
    msg.textContent="Sending...";
    fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stage:"subscribe",email:em,consent_news:true,hp:document.getElementById("sub-hp").value,ts:tok})})
      .then(function(r){if(!r.ok)throw 0;f.reset();msg.textContent="Thank you. You are on the list."})
      .catch(function(){msg.textContent="Something went wrong. Please try again in a moment, or email leadwithfx@gmail.com.";tok="";if(id!==null&&window.turnstile)window.turnstile.reset(id)})
  });
})();
