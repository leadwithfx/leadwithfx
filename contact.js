/* "Drop me a message": the visitor writes a message, gets a 6-digit code by email, and the message is sent only after the code is entered. */
(function(){
  var LIVE=true,ENDPOINT="https://clarity-report.leadwithfx.workers.dev",SITEKEY="0x4AAAAAAGAMYCBCD8b1_hAY";
  var open=document.getElementById("msg-open"),f=document.getElementById("msg-form");
  if(!open||!f||!LIVE)return;
  open.hidden=false;
  var s1=document.getElementById("msg-step1"),s2=document.getElementById("msg-step2"),st=document.getElementById("msg-status"),done=document.getElementById("msg-done");
  var $=function(id){return document.getElementById(id)};
  var tsTok="",tsId=null,loaded=false,tok="",step=1,busy=false;
  function draw(){if(tsId===null&&window.turnstile)tsId=window.turnstile.render("#msg-ts",{sitekey:SITEKEY,callback:function(t){tsTok=t},"expired-callback":function(){tsTok=""},"error-callback":function(){tsTok=""}})}
  function load(){if(loaded)return;loaded=true;if(window.turnstile)return draw();var s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";s.async=true;s.onload=draw;document.head.appendChild(s)}
  function show(n){step=n;s1.hidden=n!==1;s2.hidden=n!==2;st.textContent=""}
  open.addEventListener("click",function(){f.hidden=false;open.hidden=true;open.setAttribute("aria-expanded","true");load();$("msg-name").focus()});
  f.addEventListener("focusin",load);
  $("msg-back").addEventListener("click",function(){tok="";$("msg-code").value="";show(1);$("msg-name").focus()});
  function post(payload){
    return fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error("x");e.kind=j.error||"";e.status=r.status;throw e}return j})});
  }
  function base(){return{name:$("msg-name").value.trim(),email:$("msg-email").value.trim(),message:$("msg-text").value.trim(),consent_msg:true,hp:$("msg-hp").value}}
  function fail(e){
    busy=false;
    var m="Something went wrong. Please try again in a moment, or email leadwithfx@gmail.com.";
    if(e&&e.kind==="code")m="That code did not match, or it has expired. Check the email and try again, or go back to get a new code.";
    else if(e&&e.status===429)m="Too many tries. Please wait a minute and try again.";
    else if(e&&e.kind==="human")m="The security check did not pass. Please try again.";
    st.textContent=m;
    if(step===1){tsTok="";if(tsId!==null&&window.turnstile)window.turnstile.reset(tsId)}
  }
  f.addEventListener("submit",function(ev){
    ev.preventDefault();if(busy)return;
    if(step===1){
      var b=base();
      if(!b.name){st.textContent="Please enter your name.";return}
      if(!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(b.email)){st.textContent="Please enter a valid email address.";return}
      if(!b.message){st.textContent="Please write a message.";return}
      if(!$("msg-ok").checked){st.textContent="Please tick the box to agree.";return}
      if(!tsTok){st.textContent="Please wait for the security check to finish, then try again.";load();return}
      busy=true;st.textContent="Sending your code...";b.stage="msg_code";b.ts=tsTok;
      post(b).then(function(j){busy=false;tok=j.tok;$("msg-sent-to").textContent="I emailed a 6-digit code to "+b.email+". Enter it below to confirm it is you and send your message. Check spam or promotions if it does not arrive.";show(2);$("msg-code").focus()}).catch(fail);
    }else{
      var code=$("msg-code").value.trim();
      if(!/^\d{6}$/.test(code)){st.textContent="Please enter the 6-digit code from the email.";return}
      busy=true;st.textContent="Sending...";var p=base();p.stage="msg_send";p.tok=tok;p.code=code;
      post(p).then(function(){busy=false;f.hidden=true;done.hidden=false;done.textContent="Thank you. I have your message and I've emailed you a copy. I'll reply as soon as I see it, but please allow up to 72 hours.";done.focus()}).catch(fail);
    }
  });
})();
