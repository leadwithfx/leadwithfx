/* Mobile menu: toggles the nav links on small screens. */
(function(){
  var nav=document.querySelector(".nav"),btn=document.getElementById("nav-toggle"),links=document.getElementById("nav-links");
  if(!nav||!btn||!links)return;
  document.documentElement.classList.add("navjs");
  function set(open){nav.classList.toggle("open",open);btn.setAttribute("aria-expanded",open?"true":"false");btn.setAttribute("aria-label",open?"Close menu":"Open menu")}
  btn.addEventListener("click",function(){set(!nav.classList.contains("open"))});
  links.addEventListener("click",function(e){if(e.target.closest("a"))set(false)});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&nav.classList.contains("open")){set(false);btn.focus()}});
  document.addEventListener("click",function(e){if(nav.classList.contains("open")&&!nav.contains(e.target))set(false)});
  window.addEventListener("resize",function(){if(window.innerWidth>1340)set(false)});
})();
